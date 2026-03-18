'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL.startsWith('https://')) {
  throw new Error('Please set SUPABASE_URL (e.g., https://xyzcompany.supabase.co) before running the seeder.');
}

if (!SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY.startsWith('PASTE_')) {
  throw new Error('Please set SUPABASE_SERVICE_ROLE_KEY to your service role key (can be stored in .env).');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function loadLocalData() {
  const dataFile = path.resolve(__dirname, '..', 'js', 'data.js');
  const source = fs.readFileSync(dataFile, 'utf8');
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  const script = new vm.Script(`${source}\nmodule.exports = { questionsData, grammarRules };`, { filename: 'data.js' });
  script.runInContext(sandbox);
  const exported = sandbox.module.exports || {};
  if (!Array.isArray(exported.questionsData) || typeof exported.grammarRules !== 'object') {
    throw new Error('Failed to read questionsData/grammarRules from js/data.js');
  }
  return exported;
}

function toUuidFromText(text) {
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-');
}

function mapGrammarRules(grammarRules) {
  return Object.entries(grammarRules).map(([category, ruleSet]) => ({
    id: toUuidFromText(`rule::${category}`),
    category,
    title: ruleSet.title || category,
    icon: ruleSet.icon || '📚',
    rules: Array.isArray(ruleSet.rules) ? ruleSet.rules : []
  }));
}

function mapQuestions(questions) {
  return questions.map((question, index) => ({
    id: question.id || toUuidFromText(`question::${question.category || 'unknown'}::${question.sentence || index}`),
    category: question.category,
    sentence: question.sentence,
    correct_answer: question.correct_answer,
    options: Array.isArray(question.options) ? question.options : [],
    explanation: question.explanation || ''
  }));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function wipeTables() {
  await supabase.from('questions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('grammar_rules').delete().neq('id', '00000000-0000-0000-0000-000000000000');
}

async function insertInChunks(table, rows) {
  const chunks = chunkArray(rows, 75);
  for (const chunk of chunks) {
    const { error } = await supabase.from(table).insert(chunk);
    if (error) {
      throw new Error(`Insert into ${table} failed: ${error.message}`);
    }
  }
}

async function main() {
  console.log('Loading local data from js/data.js ...');
  const { questionsData, grammarRules } = loadLocalData();
  const ruleRows = mapGrammarRules(grammarRules);
  const questionRows = mapQuestions(questionsData);

  console.log(`Loaded ${ruleRows.length} grammar rule groups and ${questionRows.length} questions.`);

  console.log('Clearing existing rows in Supabase ...');
  await wipeTables();

  console.log('Uploading grammar rules ...');
  await insertInChunks('grammar_rules', ruleRows);

  console.log('Uploading questions ...');
  await insertInChunks('questions', questionRows);

  console.log('Done! Supabase now mirrors js/data.js');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
