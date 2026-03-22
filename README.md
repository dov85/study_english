# Study English

An interactive English learning app for grammar and vocabulary practice, with AI-generated content and cloud-backed progress data.

Open the app: https://dov85.github.io/study_english/

## Features

- Grammar quiz with fill-in-the-blank questions.
- AI generation with Gemini for creating categories and replacing questions.
- Clickable word translations inside quiz sentences.
- Add words directly from quiz sentences to a practice deck.
- Vocabulary flashcards screen (tap to reveal translation).
- Delete known words from flashcards.
- Delete full categories (questions + grammar rules).
- Cloud-backed vocabulary deck using Supabase (`vocab_words` table), so words remain even if questions/categories are removed.
- Progress and streak tracking.
- Responsive UI for mobile and desktop.

## Tech Stack

- Frontend: Vanilla HTML, CSS, JavaScript.
- Backend/data: Supabase (PostgreSQL + RLS policies).
- AI: Google Gemini API.
- Hosting: GitHub Pages.

## Setup

1. Clone repository:

```bash
git clone https://github.com/dov85/study_english.git
cd study_english
```

2. Configure Supabase:

- Run `supabase/schema.sql` in SQL Editor.
- The schema is rerunnable (uses `drop policy if exists` before `create policy`).

3. Open app:

- Open `index.html` directly in browser, or use GitHub Pages URL.

## Notes about Cloud Vocabulary

- Words added from sentence tooltips are inserted into `public.vocab_words`.
- Duplicate words are prevented by a unique constraint on `(word, translation)`.
- Removing a category does not remove saved vocabulary words.

## Project Structure

```text
index.html
css/styles.css
js/app.js
supabase/schema.sql
scripts/seedSupabase.js
scripts/seedBe.js
scripts/testGemini.js
PROJECT.md
README.md
```

## License

MIT
