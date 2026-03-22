Jח# 📚 Study English

An interactive English learning quiz app to master grammar and vocabulary — one sentence at a time.

**[🔗 Open the App](https://dov85.github.io/study_english/)**

---

## Features

- **Grammar Quiz** — Fill-in-the-blank questions across multiple grammar categories
- **AI-Powered Questions** — Generates fresh questions using Google Gemini AI
- **Word Translations** — Click any word to see its Hebrew translation (תרגום לעברית)
- **AI Category Creation** — Describe a grammar topic and AI creates a full category with 50 questions
- **Progress Tracking** — Streaks, scores, and per-category statistics saved locally
- **Grammar Rules** — View grammar rules and examples for each category before starting
- **Mobile Friendly** — Fully responsive, works great on phones and tablets

## Categories

| Category | Description |
|----------|------------|
| Present Simple vs Continuous | When to use each present tense |
| Past Simple vs Continuous | Differences between past tenses |
| Future Tenses | Will, going to, present continuous for future |
| Conditionals | Zero, first, second, third conditionals |
| Be / Been / Being | Correct usage of be, been, and being |
| + AI-generated | Create your own categories! |

## Screenshots

The app features a clean, modern UI with:
- Category selection grid with icons
- Quiz interface with instant feedback
- Score results with confetti animation
- Grammar rules modal
- Dark-themed design

## Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES2020+)
- **Database**: [Supabase](https://supabase.com/) (PostgreSQL + RLS)
- **AI**: [Google Gemini API](https://ai.google.dev/) (question generation + translations)
- **Hosting**: GitHub Pages (static files, no build step)

## Getting Started

### Use the App

Simply open **https://dov85.github.io/study_english/** on any device.

### Run Locally

1. Clone the repo:
   ```bash
   git clone https://github.com/dov85/study_english.git
   cd study_english
   ```

2. Open `index.html` in a browser — that's it! No build tools needed.

### Seed Scripts (Optional)

To run the database seed scripts, you need a `.env` file with your Supabase credentials:

```bash
npm install
# Create .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
node scripts/seedSupabase.js
```

## Project Structure

```
├── index.html              # App shell (3 screens, 5 modals)
├── css/styles.css           # All styling (responsive + dark theme)
├── js/app.js                # Main app logic (EnglishLearningApp class)
├── scripts/
│   ├── seedSupabase.js      # Database seed script
│   ├── seedBe.js            # Be/Been/Being category seed
│   └── testGemini.js        # Gemini API test
├── supabase/schema.sql      # Database schema
├── PROJECT.md               # Detailed technical documentation
└── .env                     # Secrets (not committed)
```

## License

MIT
