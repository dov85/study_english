# Study English — Project Documentation

> English Learning Quiz App — a single-page vanilla HTML/CSS/JS application with Supabase cloud backend and Gemini AI question generation.

---

## Table of Contents

- [Architecture](#architecture)
- [File Structure](#file-structure)
- [Tech Stack](#tech-stack)
- [Key Features](#key-features)
- [Database Schema (Supabase)](#database-schema-supabase)
- [API Integrations](#api-integrations)
- [File Details](#file-details)
- [localStorage Keys](#localstorage-keys)
- [App Class: EnglishLearningApp](#app-class-englishlearningapp)
- [UI Screens & Modals](#ui-screens--modals)
- [Flows](#flows)

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Browser                      │
│  index.html + css/styles.css + js/app.js      │
│                                               │
│  ┌─────────────┐    ┌──────────────────────┐ │
│  │ Supabase SDK │    │ Gemini REST API      │ │
│  │ (CDN)        │    │ (fetch)              │ │
│  └──────┬───────┘    └──────────┬───────────┘ │
└─────────┼───────────────────────┼─────────────┘
          │                       │
          ▼                       ▼
┌─────────────────┐    ┌─────────────────────┐
│ Supabase Cloud  │    │ Google Gemini API    │
│ (PostgreSQL)    │    │ (AI generation)      │
│ - grammar_rules │    │ - gemini-3-flash     │
│ - questions     │    │ - gemini-2.5-flash   │
└─────────────────┘    │ - gemini-3.1-flash   │
                       └─────────────────────┘
```

**No build tools.** Pure client-side app served as static files. The Supabase JS SDK is loaded from CDN. Node.js is only used for the seed script (`scripts/seedSupabase.js`).

---

## File Structure

```
study-english/
├── index.html              # App shell — screens, modals, script tags
├── package.json             # Node.js config (only for seed script dependency)
├── PROJECT.md               # This file
├── css/
│   └── styles.css           # All styling (~1,420 lines) — variables, components, responsive
├── js/
│   ├── app.js               # Main application logic (~1,750 lines) — EnglishLearningApp class
│   └── data.js              # Local seed data — 350 questions + 7 grammar rule sets (fallback)
├── scripts/
│   ├── seedSupabase.js      # Node.js script to seed Supabase from data.js
│   ├── seedBe.js            # Node.js script to seed "Be / Been / Being" category
│   └── testGemini.js        # Dev/debug script to test Gemini API
└── supabase/
    └── schema.sql           # Database schema + RLS policies
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML5, CSS3, JavaScript (ES2020+) |
| Database | Supabase (PostgreSQL + Row Level Security) |
| AI | Google Gemini API (REST, with system instructions) |
| CDN | Supabase JS SDK v2 |
| Seed script | Node.js + `@supabase/supabase-js` |

---

## Key Features

1. **Multi-category grammar quizzes** — fill-in-the-blank format with shuffled options
2. **Cloud-synced data** via Supabase — auto-seeds from local data on first run
3. **Adaptive question pool** — correctly answered questions are permanently deleted (from memory and cloud)
4. **AI question generation** — replaces entire category with 50 new Gemini-generated questions
5. **AI category creation** — create entirely new categories via free-text description; Gemini generates grammar rules + 50 questions, auto-syncs to cloud
6. **Word translation tooltips** — click any word in a sentence to see its Hebrew translation (when available); Gemini generates translations automatically for new questions
7. **Multi-model fallback** with daily quota tracking (per-model RPD limits)
8. **Generation history** — full audit log with date, model, question count, token usage
9. **Mixed quiz mode** — round-robin across all categories, capped at 50 questions
10. **Grammar rules modal** per category with detailed HTML tables
11. **Streak tracking** — with fire animation at 5+ consecutive correct answers
12. **Progress persistence** — best scores saved per category with completion badges (≥80%)
13. **Confetti celebration** on scores ≥ 80%
14. **Responsive mobile-first design** with animations
15. **Hebrew pronunciation support** for vocabulary words (`pronunciation` field), including AI auto-fill for missing pronunciations

---

## Database Schema (Supabase)

**Project URL:** `https://fjliapgwwhplftoxdpyz.supabase.co`

### Table: `grammar_rules`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated via `uuid_generate_v4()` |
| `category` | TEXT | NOT NULL, UNIQUE |
| `title` | TEXT | NOT NULL |
| `icon` | TEXT | Emoji |
| `rules` | JSONB | Array of `{ heading, content }` objects (HTML content) |
| `created_at` | TIMESTAMPTZ | Default `now()` |

### Table: `questions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated via `uuid_generate_v4()` |
| `category` | TEXT | NOT NULL, FK → `grammar_rules.category` ON DELETE CASCADE |
| `sentence` | TEXT | NOT NULL — contains `____` as the blank |
| `correct_answer` | TEXT | NOT NULL |
| `options` | JSONB | Array of 3-4 strings (includes correct answer) |
| `explanation` | TEXT | Why the answer is correct |
| `translations` | JSONB | Object mapping lowercase English words to Hebrew translations, e.g. `{"the": "ה", "cat": "חתול"}`. Default `{}` |
| `created_at` | TIMESTAMPTZ | Default `now()` |

### Table: `vocab_words`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated via `uuid_generate_v4()` |
| `word` | TEXT | NOT NULL (normalized lowercase in app) |
| `translation` | TEXT | NOT NULL (Hebrew meaning) |
| `pronunciation` | TEXT | Optional Hebrew pronunciation of the English word |
| `source_category` | TEXT | Origin category or `Manual` |
| `created_at` | TIMESTAMPTZ | Default `now()` |

### Table: `gemini_logs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated via `uuid_generate_v4()` |
| `action` | TEXT | `generate_questions`, `create_category`, `generate_pronunciations` |
| `category` | TEXT | Related category or context |
| `model` | TEXT | Gemini model used |
| `prompt_tokens` | INT | Prompt token count |
| `response_tokens` | INT | Response token count |
| `total_tokens` | INT | Total tokens for the call |
| `questions_generated` | INT | Reused metric for generated item count |
| `success` | BOOLEAN | Whether the call succeeded |
| `error_message` | TEXT | Error details when failed |
| `created_at` | TIMESTAMPTZ | Default `now()` |

### RLS Policies

| Table | Role | Operations |
|-------|------|-----------|
| `grammar_rules` | anon | SELECT, INSERT |
| `grammar_rules` | service_role | INSERT |
| `questions` | anon | SELECT, DELETE, INSERT |
| `questions` | service_role | INSERT |
| `vocab_words` | anon | SELECT, INSERT, DELETE, UPDATE |
| `gemini_logs` | anon | SELECT, INSERT |

---

## API Integrations

### Supabase

- **SDK:** Loaded from CDN (`@supabase/supabase-js@2`)
- **Auth mode:** Anonymous (anon key)
- **Operations:** SELECT, INSERT, DELETE, UPDATE (questions, rules, vocab words, usage logs)

### Google Gemini API

- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Auth:** API key as query parameter
- **Models (with daily free-tier limits):**

| Model | RPD (Requests/Day) |
|-------|---------------------|
| `gemini-3-flash-preview` | 20 |
| `gemini-2.5-flash` | 20 |
| `gemini-2.5-flash-lite` | 20 |
| `gemini-3.1-flash-lite` | 500 |

- **Features used:** `system_instruction`, `generationConfig` (temperature, maxOutputTokens), usage metadata (token counts)
- **Retry logic:** Up to 3 attempts per model on HTTP 429/503 with exponential backoff

---

## File Details

### `js/app.js` (~1,750 lines)

The main application file. Contains:

1. **Constants** — Supabase URL/key, Gemini API key, model configs
2. **Free functions** — Gemini quota tracking (localStorage-based, resets daily)
3. **Class `EnglishLearningApp`** — all app logic (see [full method list below](#app-class-englishlearningapp))
4. **Global bootstrap** — `initEnglishApp()` creates singleton `window.app`

### `js/data.js` (~650 lines)

Local seed data, used as fallback if Supabase is unavailable:

- **`grammarRules`** object — 7 categories, each with title, icon, and rules array:
  - Present Simple (6 rules)
  - Present Continuous (4 rules)
  - Past Simple (6 rules)
  - Future Simple (5 rules)
  - Vocabulary - Work (3 rule sections with tables)
  - Have / Has / Had (5 rules)
  - Verb Endings (4 rules)

- **`questionsData`** array — 350 questions (50 per category), each: `{ category, sentence, correct_answer, options, explanation }`

**Note:** `data.js` is NOT loaded in the browser via `<script>` tag. It's only used by the seed script and as a fallback data source via `getLocalQuestionSeed()` / `getLocalGrammarRules()`.

### `index.html` (~170 lines)

App shell with 4 screens and multiple modals (grammar, confirm, generate, history, create category, word picker, manual word). No inline JavaScript event handlers.

### `css/styles.css` (~1,420 lines)

All styling. Major sections:
- CSS variables, reset, base typography
- Category grid (cards, badges, actions)
- Quiz screen (progress bar, question card, options, explanation)
- Results screen (score circle, stats, review)
- Modals (grammar rules, confirm, generate, history, create category)
- Create category button & textarea
- Streak display & fire animation
- Confetti animation
- Model selector & usage stats
- Flashcards pronunciation line + AI pronunciation status
- Responsive breakpoints

### `scripts/seedSupabase.js`

Node.js script that:
1. Loads `data.js` via `vm.Script` sandboxing
2. Generates deterministic UUIDs via SHA-1 hashing
3. Wipes both Supabase tables
4. Inserts grammar rules and questions in chunks of 75
5. Uses **service role key** for elevated permissions

### `scripts/seedBe.js`

Node.js script that seeds the "Be / Been / Being" category:
1. Inserts grammar rule with 4 detailed rule sections (be, been, being, comparison)
2. Inserts 50 curated questions covering modals, infinitives, perfect tenses, continuous passive, gerunds
3. Uses upsert for grammar rule (idempotent)

### `scripts/testGemini.js`

Dev/debug script — sends a single prompt to Gemini, validates the JSON response structure.

### `supabase/schema.sql`

PostgreSQL DDL: creates tables, enables RLS, defines access policies.

---

## localStorage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `gemini_usage_YYYY-MM-DD` | Object | Daily per-model Gemini API call count. Auto-cleaned (old dates removed) |
| `english-app-version` | String | Data version tag (`v9`). Triggers pool/progress reset on mismatch |
| `english-app-question-pool` | Array | IDs of remaining unanswered questions |
| `english-app-progress` | Object | `{ "category_name": best_score_percentage }` |
| `english-app-vocab-deck` | Array | Local fallback cache for cloud vocabulary data, now including optional pronunciation |

---

## App Class: EnglishLearningApp

### Constructor Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_QUIZ_QUESTIONS` | 50 | Max questions per quiz session |
| `QUIZ_ALL` | `'__all__'` | Key for "All Categories" mode |
| `QUIZ_MIXED` | `'__mixed__'` | Key for "Mixed Quiz" mode |

### Method Groups

#### Data Loading
| Method | Description |
|--------|------------|
| `initializeApp()` | Loads questions + grammar rules in parallel, then calls `init()` |
| `loadQuestions()` | Loads from Supabase; seeds from local data if empty; falls back to local |
| `loadGrammarRules()` | Same pattern for grammar rules |
| `fetchQuestionsFromSupabase()` | `SELECT *` from questions, ordered by category |
| `fetchGrammarRulesFromSupabase()` | `SELECT *` from grammar_rules, ordered by category |
| `seedSupabaseWithLocalData()` | Inserts local questions in chunks of 75 |
| `seedGrammarRulesWithLocalData()` | Inserts local rules in chunks of 50 |

#### State Management
| Method | Description |
|--------|------------|
| `init()` | Migrates localStorage, loads pool, categories, progress, renders UI |
| `migrateLocalStorage()` | Checks `DATA_VERSION`; clears pool/progress on version mismatch |
| `prepareQuestionCatalog()` | Normalizes raw data into `this.questionCatalog` |
| `prepareGrammarRules()` | Normalizes rules into `this.grammarRules` |
| `loadProgress()` / `saveProgress()` | Persists best % per category |
| `loadQuestionPool()` / `saveQuestionPool()` | Manages remaining unanswered question IDs |
| `removeQuestionFromCatalog()` | Removes question from in-memory catalog |
| `removeFromQuestionPool()` | Removes from remaining pool + saves |
| `resetQuestionPool()` | Restores all questions back into pool |

#### Quiz Logic
| Method | Description |
|--------|------------|
| `startQuiz(quizKey)` | Shuffles matching questions, caps at 50, shows quiz screen |
| `getQuestionsForQuiz(quizKey)` | Filters available questions; MIXED mode round-robins across categories |
| `selectAnswer(selected, btn)` | Checks answer, deletes correct from catalog+pool+cloud, updates streak |
| `nextQuestion()` | Advances to next question or shows results |
| `showResults()` | Score circle, stats, mistake review, confetti if ≥80% |

#### AI Generation
| Method | Description |
|--------|------------|
| `showGenerateModal(category)` | Opens modal with model selector showing quota per model |
| `handleGenerate()` | 3-step: delete old → generate via Gemini → upload new; saves history |
| `callGeminiForQuestions(category, amount, model)` | Sends system instruction + prompt; retries on 429/503; returns questions + token stats |
| `uploadGeneratedQuestions(questions)` | Bulk inserts to Supabase, returns rows with IDs |

#### AI Category Creation
| Method | Description |
|--------|------------|
| `showCreateCategoryModal()` | Opens modal with text input and model selector |
| `closeCreateCategoryModal()` | Closes the modal |
| `handleCreateCategory()` | 4-step flow: validate → Gemini call → insert rules & questions → update UI |
| `callGeminiForNewCategory(description, model)` | Sends free-text description to Gemini; returns grammar rules + 50 questions or rejection message |

#### Vocabulary + Pronunciation
| Method | Description |
|--------|------------|
| `loadVocabDeck()` / `saveVocabDeck()` | Loads cloud vocabulary and keeps local fallback cache |
| `addWordToDeck(word, translation, source, pronunciation)` | Saves vocabulary word with optional pronunciation |
| `handleGeneratePronunciations()` | Sends only words missing pronunciation to Gemini and updates deck |
| `callGeminiForPronunciations(items)` | Requests Hebrew pronunciation mapping from Gemini |
| `savePronunciationsToCloud(updates)` | Persists generated pronunciations to Supabase when column is available |
| `renderFlashcard()` | Displays word, translation, source, and pronunciation |

### Gemini Usage History
| Method | Description |
|--------|------------|
| `logGeminiCall(entry)` | Inserts usage log into `gemini_logs` |
| `saveGenerationHistory(entry)` | Wrapper that writes generation usage to cloud logs |
| `showHistoryModal()` | Displays summary + detailed list |

#### UI Rendering
| Method | Description |
|--------|------------|
| `renderCategoryScreen()` | Builds category grid with stats, history button, generate buttons, create category button |
| `renderQuestion()` | Shows sentence with blank, shuffled options |
| `showEmptyQuizScreen()` | No questions left; offers pool reset |
| `updateCategoryBadges()` | Shows completion badges (≥80%) |
| `showScreen(id)` | Toggles `.active` class on screen divs |

#### Utility
| Method | Description |
|--------|------------|
| `shuffleArray(arr)` | Fisher-Yates shuffle |
| `escapeHtml(text)` | XSS prevention |
| `launchConfetti()` | Creates 50 animated confetti DOM elements |
| `updateStreakDisplay()` | Shows streak counter (≥2), fire animation (≥5) |
| `getCategoryIcon(name)` | Returns emoji for known category names |

---

## UI Screens & Modals

### Screens (4)
1. **Category Selection** (`#category-screen`) — category grid, total remaining count, history button, mixed quiz button, create category button
2. **Quiz** (`#quiz-screen`) — progress bar, question with blank, options, explanation, next button
3. **Results** (`#results-screen`) — score circle, correct/wrong/streak stats, mistake review
4. **Vocabulary Flashcards** (`#flashcards-screen`) — word/translation card, pronunciation display, AI pronunciation fill button

### Modals (7)
1. **Grammar Rules** (`#modal-overlay`) — HTML-rendered rules for current category
2. **Confirm Exit** (`#confirm-overlay`) — "Leave Quiz?" with continue/leave options
3. **Generate Questions** (`#generate-overlay`) — model selector, status, usage stats, replace button
4. **Generation History** (`#history-overlay`) — summary totals + detailed per-generation log
5. **Create Category** (`#create-cat-overlay`) — free-text input, model selector, status, AI response display
6. **Word Picker** (`#word-picker-overlay`) — choose translated words from category into flashcards
7. **Manual Word** (`#manual-word-overlay`) — add custom word, translation, and optional pronunciation

---

## Flows

### App Startup
```
1. Create EnglishLearningApp instance
2. Load questions from Supabase (fallback: local data.js)
3. Load grammar rules from Supabase (fallback: local data.js)
4. Check localStorage version → migrate if needed
5. Load question pool (remaining unanswered IDs)
6. Render category screen
```

### Quiz Flow
```
1. User clicks category card → startQuiz(categoryName)
2. Filter available questions → shuffle → cap at 50
3. Show question with blank + 3-4 option buttons
4. User selects answer:
   ✓ Correct → delete from catalog + pool + cloud, increment streak
   ✗ Wrong → show correct answer, reset streak
5. Show explanation → Next question
6. After last question → showResults()
7. If score ≥80% → confetti + completion badge
```

### AI Generation Flow
```
1. User clicks 🔄 on category card → showGenerateModal()
2. User selects model from dropdown
3. User clicks "Replace & Generate"
4. Step 1: DELETE all existing questions for category from Supabase
5. Step 2: Call Gemini API with system instruction + prompt
   - System instruction defines role, schema, categories, style
   - User prompt requests 50 questions for specific category
   - Retry up to 3x on 429/503 errors
6. Step 3: INSERT new questions to Supabase
7. Update local catalog + pool
8. Save generation history entry
9. Show usage stats (model, questions, tokens)
```

### AI Category Creation Flow
```
1. User clicks "➕ Create New Category with AI" → showCreateCategoryModal()
2. User types free-text description of desired category
3. User selects Gemini model from dropdown
4. User clicks "✨ Create Category"
5. Step 1: Send description to Gemini with special system instruction
   - Gemini evaluates if description is a valid English learning topic
   - If INVALID: returns { valid: false, message: "..." }
     → The rejection message is displayed in the modal (yellow/red box)
   - If VALID: returns { valid: true, categoryName, grammarRule, questions[] }
6. Step 2: INSERT grammar rule to Supabase (grammar_rules table)
7. Step 3: INSERT 50 questions to Supabase (questions table)
8. Step 4: Update local catalog, pool, grammar rules, and categories
9. Save generation history entry
10. Auto-close modal → re-render category screen with new category card
```

### AI Pronunciation Flow
```
1. User opens Vocabulary Flashcards screen
2. User clicks "🗣 Fill Pronunciations (AI)"
3. App collects only words with missing pronunciation
4. App sends words to Gemini and asks for Hebrew pronunciation mapping
5. App updates local vocab deck and saves fallback cache
6. If Supabase column exists, app updates pronunciation in cloud (`vocab_words.pronunciation`)
7. Status message shows success/error and usage is logged to `gemini_logs`
```

### Question Categories
| Category | Focus |
|----------|-------|
| Present Simple | am/is/are, do/does, third-person -s |
| Present Continuous | am/is/are + verb-ing |
| Past Simple | was/were, regular -ed, did/didn't |
| Future Simple | will + base verb |
| Vocabulary - Work | Professional terms (deadline, promotion, salary) |
| Have / Has / Had | Present Perfect & Past Perfect |
| Verb Endings | Suffixes: -s, -ed, -ing, or none |
| Be / Been / Being | Choosing between be (modals/infinitive), been (perfect tenses), being (continuous passive/gerund) |
| *Custom (AI-created)* | *Any valid English grammar/vocabulary topic created via the Create Category feature* |
