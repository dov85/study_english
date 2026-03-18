require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY in .env file');
}

const prompt = `You are an English language teacher creating quiz questions for Hebrew-speaking students learning English.

Category: "Present Simple"

Grammar rules for this category:
To Be - am / is / are: I am, He/She/It is, You/We/They are
Action Verbs: No am/is/are. For he/she/it add -s/-es.
do/does Questions: I/you/we/they use do. he/she/it use does.
don't/doesn't Negatives: I/you/we/they don't + base verb. he/she/it doesn't + base verb.
After do/does/don't/doesn't always use the base verb (no -s).

Generate exactly 5 NEW and UNIQUE quiz questions for the category "Present Simple".

Each question MUST follow this exact JSON structure:
{
  "category": "Present Simple",
  "sentence": "A sentence with ____ as the blank to fill",
  "correct_answer": "the correct word",
  "options": ["option1", "option2", "option3"],
  "explanation": "Brief explanation why this is correct."
}

IMPORTANT RULES:
- The "options" array must contain exactly 3 items, one of which must be the correct_answer
- Use ____ (four underscores) for the blank in the sentence
- Make questions varied in difficulty
- Make sure explanations are clear and educational
- Return ONLY a valid JSON array of 5 question objects, nothing else
- Do NOT wrap in markdown code blocks`;

const body = JSON.stringify({
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { temperature: 0.8, maxOutputTokens: 8192 }
});

fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body
}).then(r => r.json()).then(d => {
  if (d.error) {
    console.error('API Error:', d.error.message);
    return;
  }
  console.log('Raw response keys:', Object.keys(d));
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error('No text in response. Full response:', JSON.stringify(d, null, 2).substring(0, 1000));
    return;
  }
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const questions = JSON.parse(cleaned);
  console.log('Got', questions.length, 'questions\n');
  questions.forEach((q, i) => {
    const valid = q.category === 'Present Simple' && q.sentence.includes('____') && q.options.length === 3 && q.options.includes(q.correct_answer);
    console.log(`${i+1}. [${valid ? 'VALID' : 'INVALID'}]`);
    console.log(`   Sentence: ${q.sentence}`);
    console.log(`   Answer: ${q.correct_answer} | Options: ${q.options.join(', ')}`);
    console.log(`   Explanation: ${q.explanation}\n`);
  });
}).catch(e => console.error('ERROR:', e));
