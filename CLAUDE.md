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

- **URL:** `https://utafnfhqiiwtisptminz.supabase.co` (recreated 2026-07-08; the old `fjliapgwwhplftoxdpyz` project was deleted, all its data is gone)
- Anon (publishable) key is **hardcoded** in `js/app.js` top constants — that is the intended pattern here, not a mistake.
- Secret (service role) key + Gemini key live in `.env` (used only by `scripts/*.js`). `.env` is gitignored — never commit keys.
- Tables: `grammar_rules`, `questions` (FK → grammar_rules.category, ON DELETE CASCADE), `vocab_words`, `gemini_logs`, `app_config`. All use RLS with permissive anon policies (single-user app, no auth).
- **`app_config` is critical:** the browser app loads `gemini_api_key` (and optionally `gemini_models_config` JSON) from this table at startup. Without the `gemini_api_key` row, all AI features fail. Row inserted on 2026-07-08.

## Gemini AI integration

- Direct REST calls from the browser: `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Three model families in `GEMINI_MODELS_CONFIG` (top of `js/app.js`): **Flash** `gemini-2.5-flash` (default, 15rpm/1500rpd), **Flash-Lite** `gemini-3.1-flash-lite` (30rpm/1500rpd), **Pro** `gemini-2.5-pro` (5rpm/50rpd — often 429s, used last).
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
