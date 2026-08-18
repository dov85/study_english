# CLAUDE.md

## What this is

**Study English** — a single-page English learning quiz app (fill-in-the-blank grammar quizzes, AI question generation, vocabulary flashcards with Hebrew translations). Vanilla HTML/CSS/JS, **no build tools, no framework, no bundler**. Served as static files; open `index.html` (or any static server) to run. Node.js is used only for the seed scripts in `scripts/`.

See `PROJECT.md` for full documentation (architecture, schema, method lists, flows).

## File map

- `index.html` — app shell: 4 screens + 7 modals, loads Supabase SDK from CDN then `js/app.js`
- `js/app.js` — ALL application logic (~3,000+ lines), one class `EnglishLearningApp`
- `css/styles.css` — all styling
- `supabase/schema.sql` — tables + RLS policies (idempotent, safe to re-run)
- `scripts/seedBe.js` — seeds "Be / Been / Being" category (self-contained inline data, idempotent)
- `scripts/seedSupabase.js` — ⚠️ BROKEN: depends on `js/data.js` which was deleted from the repo
- `scripts/testGemini.js` — dev script to test the Gemini API

## Backend: Supabase (project `study_english`)

- **URL:** `https://fjliapgwwhplftoxdpyz.supabase.co`
- Anon (publishable) key is **hardcoded** in `js/app.js` top constants — that is the intended pattern here, not a mistake.
- Secret (service role) key + Gemini key live in `.env` (used only by `scripts/*.js`). `.env` is gitignored — never commit keys.
- Tables: `grammar_rules`, `questions` (FK → grammar_rules.category, ON DELETE CASCADE), `vocab_words`, `gemini_logs`, `app_config`. All use RLS with permissive anon policies (single-user app, no auth).
- **`app_config` holds no secrets.** It previously stored `gemini_api_key`, which the browser read with the publishable key — that published the key to anyone who opened `js/app.js`. The key is now a secret on the `gemini` Edge Function, and the table's anon policy is restricted to the single `gemini_models_config` row. Never put a credential in a table the client can read.

## Gemini AI integration

- The browser calls the `gemini` Edge Function (`supabase/functions/gemini`), which holds the API key as a secret and forwards to `generativelanguage.googleapis.com`. Google's status codes and error bodies are passed through unchanged, because the client's retry and model-fallback logic parses them.
- Eight models in `GEMINI_MODELS_CONFIG` (top of `js/app.js`), quotas verified against AI Studio's Rate Limit page: five Flash models at 5rpm/**20rpd** each, then `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` at 15rpm/**500rpd**, then `gemini-2.5-flash-lite`. About 1,120 requests/day in total. The Pro models are granted 0/0 on this key and are omitted. **The list is not loaded from the database** — an `app_config` row used to override it silently, so edits to this file had no effect.
- Multi-model fallback with per-model daily quotas (RPD is enforced; RPM is display-only), tracked in the cloud via `gemini_logs` (not localStorage)
- Retries on 429/503 with backoff; failed attempts are also logged (`success: false`)
- **Raw logging:** every call stores `raw_request` + `raw_response` in `gemini_logs`, shown expandable in the History modal. Requires the two columns — run `supabase/add_raw_logging.sql` in the SQL editor. Code falls back gracefully (`supportsRawLogColumns` flag) if they're missing.

## Conventions & gotchas

- One class, one file: new features go into `EnglishLearningApp` in `js/app.js`. Match existing style (no modules, no imports, ES2020+).
- Correctly answered questions are **permanently deleted** from Supabase — the question pool shrinks by design; AI generation refills it.
- Category deletion must delete the `grammar_rules` row (cascade removes questions) — see commit history for the delete-policy fix.
- `js/data.js` local seed data no longer exists; `getLocalQuestionSeed()` / `getLocalGrammarRules()` in app.js return empty — the app now depends entirely on the cloud + AI generation for content.
- localStorage keys are prefixed `english-app-*`; `english-app-version` (`v9`) mismatch wipes pool/progress.
- UI text is English; translations/pronunciations target **Hebrew**.
- After editing `supabase/schema.sql`, run it in the Supabase SQL editor — there are no migrations.
