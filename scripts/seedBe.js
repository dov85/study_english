'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const CATEGORY = 'Be / Been / Being';

const grammarRule = {
  category: CATEGORY,
  title: 'Be / Been / Being',
  icon: '🔀',
  rules: [
    {
      heading: 'When to use "be"',
      content: `<p><strong>Be</strong> is the <em>base form</em> (infinitive). Use it:</p>
<ul>
  <li>After modals: <em>will be, can be, should be, must be, might be</em></li>
  <li>After "to": <em>I want <u>to be</u> a doctor.</em></li>
  <li>In subjunctive / imperative: <em>Be quiet!</em></li>
</ul>
<table><thead><tr><th>Pattern</th><th>Example</th></tr></thead><tbody>
<tr><td>modal + be + adjective/noun</td><td>She <u>will be</u> happy.</td></tr>
<tr><td>modal + be + past participle (passive)</td><td>It <u>should be</u> finished soon.</td></tr>
<tr><td>to + be</td><td>He wants <u>to be</u> promoted.</td></tr>
</tbody></table>`
    },
    {
      heading: 'When to use "been"',
      content: `<p><strong>Been</strong> is the <em>past participle</em> of "be". Use it after <strong>have / has / had</strong>:</p>
<ul>
  <li>Present Perfect: <em>I <u>have been</u> busy.</em></li>
  <li>Past Perfect: <em>She <u>had been</u> there before.</em></li>
  <li>Present Perfect Continuous: <em>They <u>have been</u> studying.</em></li>
  <li>Present Perfect Passive: <em>The report <u>has been</u> submitted.</em></li>
</ul>
<table><thead><tr><th>Tense</th><th>Structure</th><th>Example</th></tr></thead><tbody>
<tr><td>Present Perfect</td><td>have/has + been</td><td>He <u>has been</u> sick.</td></tr>
<tr><td>Past Perfect</td><td>had + been</td><td>We <u>had been</u> warned.</td></tr>
<tr><td>Perfect Continuous</td><td>have/has/had + been + -ing</td><td>I <u>have been</u> working.</td></tr>
</tbody></table>`
    },
    {
      heading: 'When to use "being"',
      content: `<p><strong>Being</strong> is the <em>present participle / gerund</em> of "be". Use it:</p>
<ul>
  <li>In continuous passive: <em>The house <u>is being</u> painted.</em></li>
  <li>After prepositions: <em>After <u>being</u> promoted, she moved.</em></li>
  <li>As a gerund (subject/object): <em><u>Being</u> honest is important.</em></li>
  <li>To describe temporary behavior: <em>He is <u>being</u> rude.</em></li>
</ul>
<table><thead><tr><th>Usage</th><th>Example</th></tr></thead><tbody>
<tr><td>Continuous passive</td><td>The car <u>is being</u> repaired.</td></tr>
<tr><td>After preposition</td><td>Despite <u>being</u> tired, she continued.</td></tr>
<tr><td>Gerund as subject</td><td><u>Being</u> a leader requires patience.</td></tr>
</tbody></table>`
    },
    {
      heading: 'Quick Comparison',
      content: `<table><thead><tr><th>Form</th><th>After…</th><th>Example</th></tr></thead><tbody>
<tr><td><strong>be</strong></td><td>modals / to</td><td>It must <u>be</u> done. / I want to <u>be</u> ready.</td></tr>
<tr><td><strong>been</strong></td><td>have / has / had</td><td>She has <u>been</u> promoted.</td></tr>
<tr><td><strong>being</strong></td><td>is/am/are / prepositions</td><td>The project is <u>being</u> reviewed.</td></tr>
</tbody></table>`
    }
  ]
};

const questions = [
  { sentence: "The report will ____ submitted by Friday.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After the modal 'will', use the base form 'be'." },
  { sentence: "She has ____ working here for five years.", correct_answer: "been", options: ["be", "been", "being"], explanation: "After 'has' (present perfect), use the past participle 'been'." },
  { sentence: "The building is ____ renovated right now.", correct_answer: "being", options: ["be", "been", "being"], explanation: "Present continuous passive: 'is being' + past participle." },
  { sentence: "He wants to ____ a software engineer.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After 'to' (infinitive), use the base form 'be'." },
  { sentence: "I have never ____ to Japan.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Have + been' forms the present perfect of 'be'." },
  { sentence: "____ polite is important in a job interview.", correct_answer: "Being", options: ["Be", "Been", "Being"], explanation: "'Being' is used as a gerund (subject of the sentence)." },
  { sentence: "The issue should ____ resolved before the deadline.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After the modal 'should', use the base form 'be'." },
  { sentence: "They had ____ informed about the changes.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Had + been' forms the past perfect passive." },
  { sentence: "The new system is ____ tested by the QA team.", correct_answer: "being", options: ["be", "been", "being"], explanation: "Present continuous passive: 'is being tested'." },
  { sentence: "The project might ____ delayed due to the storm.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After the modal 'might', use the base form 'be'." },
  { sentence: "Have you ever ____ to a tech conference?", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Have + been' in a question form (present perfect)." },
  { sentence: "Despite ____ exhausted, she finished the report.", correct_answer: "being", options: ["be", "been", "being"], explanation: "After the preposition 'despite', use the gerund 'being'." },
  { sentence: "The documents must ____ signed by the manager.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After the modal 'must', use the base form 'be'." },
  { sentence: "The server has ____ down since this morning.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Has been' forms the present perfect: continuous state." },
  { sentence: "He is ____ very rude today.", correct_answer: "being", options: ["be", "been", "being"], explanation: "'Being' describes temporary behavior in progress." },
  { sentence: "The students need to ____ more focused.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After 'to' (infinitive), use the base form 'be'." },
  { sentence: "She has ____ promoted to team leader.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Has been' + past participle forms the present perfect passive." },
  { sentence: "The road is ____ repaired at the moment.", correct_answer: "being", options: ["be", "been", "being"], explanation: "Present continuous passive: 'is being repaired'." },
  { sentence: "This can ____ done in two hours.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After the modal 'can', use the base form 'be'." },
  { sentence: "We had ____ waiting for over an hour.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Had been waiting' is the past perfect continuous." },
  { sentence: "After ____ rejected twice, he tried again.", correct_answer: "being", options: ["be", "been", "being"], explanation: "After the preposition 'after', use the gerund 'being'." },
  { sentence: "The homework will ____ checked tomorrow.", correct_answer: "be", options: ["be", "been", "being"], explanation: "Future passive: 'will be' + past participle." },
  { sentence: "I have ____ studying English for three months.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Have been studying' is the present perfect continuous." },
  { sentence: "____ a good listener is a valuable skill.", correct_answer: "Being", options: ["Be", "Been", "Being"], explanation: "'Being' as a gerund is the subject of the sentence." },
  { sentence: "The results could ____ better if we practiced more.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After the modal 'could', use the base form 'be'." },
  { sentence: "She has ____ absent from class all week.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Has been' forms the present perfect for a continuing state." },
  { sentence: "The email is ____ drafted by my assistant.", correct_answer: "being", options: ["be", "been", "being"], explanation: "Present continuous passive: 'is being drafted'." },
  { sentence: "You should ____ more careful with your spelling.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After the modal 'should', use the base form 'be'." },
  { sentence: "They have ____ friends since childhood.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Have been' (present perfect) for a state that started in the past." },
  { sentence: "The suspect is ____ questioned by the police.", correct_answer: "being", options: ["be", "been", "being"], explanation: "Present continuous passive: 'is being questioned'." },
  { sentence: "It would ____ a great opportunity for you.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After the modal 'would', use the base form 'be'." },
  { sentence: "The package had ____ delivered before I arrived.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Had been delivered' is the past perfect passive." },
  { sentence: "Without ____ aware of the rules, you may fail.", correct_answer: "being", options: ["be", "been", "being"], explanation: "After the preposition 'without', use the gerund 'being'." },
  { sentence: "The contract appears to ____ valid.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After 'to' (infinitive), use the base form 'be'." },
  { sentence: "How long have you ____ living in this city?", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Have been living' is the present perfect continuous." },
  { sentence: "The data is ____ analyzed by the research team.", correct_answer: "being", options: ["be", "been", "being"], explanation: "Present continuous passive: 'is being analyzed'." },
  { sentence: "All employees must ____ present at the meeting.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After the modal 'must', use the base form 'be'." },
  { sentence: "She has ____ chosen as the project manager.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Has been chosen' is the present perfect passive." },
  { sentence: "He apologized for ____ late to the meeting.", correct_answer: "being", options: ["be", "been", "being"], explanation: "After the preposition 'for', use the gerund 'being'." },
  { sentence: "The new policy will ____ announced next week.", correct_answer: "be", options: ["be", "been", "being"], explanation: "Future passive: 'will be announced'." },
  { sentence: "I had ____ told about the party, but I forgot.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Had been told' is the past perfect passive." },
  { sentence: "The patient is ____ treated in the emergency room.", correct_answer: "being", options: ["be", "been", "being"], explanation: "Present continuous passive: 'is being treated'." },
  { sentence: "This task seems to ____ very difficult.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After 'to' (infinitive), use the base form 'be'." },
  { sentence: "They have ____ married for twenty years.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Have been' (present perfect) for a continuing state." },
  { sentence: "____ honest with yourself is the first step.", correct_answer: "Being", options: ["Be", "Been", "Being"], explanation: "'Being' as a gerund serves as the subject of the sentence." },
  { sentence: "The application may ____ rejected if incomplete.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After the modal 'may', use the base form 'be'." },
  { sentence: "He has ____ working on this bug for hours.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Has been working' is the present perfect continuous." },
  { sentence: "The new feature is ____ developed by our team.", correct_answer: "being", options: ["be", "been", "being"], explanation: "Present continuous passive: 'is being developed'." },
  { sentence: "You ought to ____ more responsible.", correct_answer: "be", options: ["be", "been", "being"], explanation: "After 'to' (in 'ought to'), use the base form 'be'." },
  { sentence: "She had never ____ so happy before.", correct_answer: "been", options: ["be", "been", "being"], explanation: "'Had been' forms the past perfect of 'be'." }
];

async function main() {
  console.log(`Seeding category "${CATEGORY}" ...`);

  // 1. Insert grammar rule
  console.log('Inserting grammar rule...');
  const { error: ruleError } = await supabase
    .from('grammar_rules')
    .upsert(grammarRule, { onConflict: 'category' });

  if (ruleError) {
    console.error('Failed to insert grammar rule:', ruleError.message);
    process.exit(1);
  }
  console.log('Grammar rule inserted.');

  // 2. Delete any existing questions for this category
  console.log('Cleaning old questions...');
  await supabase.from('questions').delete().eq('category', CATEGORY);

  // 3. Insert questions
  const payload = questions.map(q => ({
    category: CATEGORY,
    sentence: q.sentence,
    correct_answer: q.correct_answer,
    options: q.options,
    explanation: q.explanation
  }));

  console.log(`Inserting ${payload.length} questions...`);
  const { error: qError } = await supabase.from('questions').insert(payload);

  if (qError) {
    console.error('Failed to insert questions:', qError.message);
    process.exit(1);
  }

  console.log(`✅ Done! Seeded "${CATEGORY}" with ${payload.length} questions and grammar rules.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
