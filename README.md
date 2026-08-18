# Study English

An English practice app: fill-in-the-blank grammar quizzes, AI-generated questions, and a
vocabulary deck with Hebrew translations and pronunciations.

Live: <https://dov85.github.io/study_english/>

Vanilla HTML, CSS and JavaScript — no build step, no framework, no bundler. Supabase holds
the data, and Gemini generates new questions when a category runs low.

## Features

- Fill-in-the-blank grammar quizzes, organised by category
- AI question generation with Gemini, including creating whole new categories
- Click any word in a quiz sentence to see its Hebrew translation, and add it to your deck
- Vocabulary flashcards with Hebrew pronunciation, tap to reveal
- Progress and streak tracking
- Works on mobile and desktop

Correctly answered questions are deleted rather than repeated, so the pool shrinks as you
learn it and AI generation refills it.

## Architecture

```
index.html ─── js/app.js ────► Supabase (Postgres + RLS)
                    │
                    └────────► Edge Function "gemini" ──► Google Gemini API
                                  (holds the API key)
```

Three model families are tried in order with per-model daily quotas tracked in the database:
Flash, Flash-Lite, then Pro. On a 429 or 503 the client retries, then fails over to the next
model. Every call is logged to `gemini_logs`, successes and failures alike.

## Security model

This is a static site, so **everything the browser holds is public** — including the
Supabase URL and publishable key in `js/app.js`. That is how publishable keys are meant to
work; the protection comes from row-level security, not from hiding them.

Two consequences worth being explicit about:

**The Gemini key is not in the client.** It lives as a secret on the `gemini` Edge Function.
An earlier version of this project stored it in the `app_config` table and read it from the
browser, which made it retrievable by anyone with the publishable key — one REST call. If you
are forking this, that is the mistake to avoid: a table the client can read is a public table.

**The deployed database is open to writes.** The app has no login, and its RLS policies let
anonymous callers insert and delete rows, because the app itself needs to do that. Anyone who
reads this repository can therefore modify the data in the deployed instance. That is an
accepted trade-off for a single-user practice app with no sensitive content. If you deploy
your own copy and care about the data, add authentication and scope the policies to a user id.

## Setup

**1. Create a Supabase project** and run `supabase/schema.sql` in the SQL editor. It is
idempotent, so re-running it is safe.

**2. Deploy the Gemini proxy** with your key as a secret:

```bash
supabase login
supabase link --project-ref your-project-ref
supabase secrets set GEMINI_API_KEY=your-gemini-key
supabase functions deploy gemini
```

**3. Point the app at your project** — edit the two constants at the top of `js/app.js`:

```js
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-publishable-key';
```

**4. Open `index.html`**, or serve the folder with any static server. Pushing to `master`
deploys to GitHub Pages via `.github/workflows/deploy.yml`.

### Seeding content

`scripts/seedBe.js` adds a "Be / Been / Being" category and is self-contained. It needs a
`.env` with the service-role key:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-secret-key
```

`.env` is gitignored — the service-role key bypasses RLS entirely, so it must never be
committed or shipped to the browser.

```bash
npm install
node scripts/seedBe.js
```

## Repository layout

```
index.html                     app shell: 4 screens, 7 modals
js/app.js                      all application logic, one class
css/styles.css                 all styling
supabase/schema.sql            tables and RLS policies
supabase/functions/gemini/     Edge Function that proxies Gemini
scripts/                       seeding and dev scripts
PROJECT.md                     full documentation
```

`scripts/seedSupabase.js` is broken — it depends on a `js/data.js` that no longer exists.

## License

MIT — see [`LICENSE`](LICENSE).
