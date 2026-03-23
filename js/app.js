// ============================
// English Learning App - Main Logic
// ============================

const SUPABASE_URL = 'https://fjliapgwwhplftoxdpyz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Zct9fKl_HZOMS49pSiY29w_c8FWjIlr';

// Gemini API key loaded from cloud (app_config table)
let GEMINI_API_KEY = '';

// Model config loaded from cloud — fallback defaults from Google AI Studio rate limits
let GEMINI_MODELS_CONFIG = [
  { model: 'gemini-3-flash-preview', rpd: 20, tpm: 250000 },
  { model: 'gemini-2.5-flash', rpd: 20, tpm: 250000 },
  { model: 'gemini-2.5-flash-lite', rpd: 20, tpm: 250000 },
  { model: 'gemini-3.1-flash-lite', rpd: 500, tpm: 250000 }
];

// Today's usage cache (loaded from cloud)
let _todayUsageCache = null;
let _todayUsageCacheTime = 0;

function geminiUrl(model) {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not loaded. Please refresh the page.');
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
}

// ─── Load secrets & config from Supabase app_config ────
async function loadAppConfig() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('app_config')
      .select('key, value')
      .in('key', ['gemini_api_key', 'gemini_models_config']);
    if (error) throw error;
    if (data) {
      data.forEach(row => {
        if (row.key === 'gemini_api_key') GEMINI_API_KEY = row.value;
        if (row.key === 'gemini_models_config') {
          try {
            const parsed = JSON.parse(row.value);
            if (Array.isArray(parsed) && parsed.length > 0) GEMINI_MODELS_CONFIG = parsed;
          } catch {}
        }
      });
    }
    if (GEMINI_API_KEY) {
      console.log('✅ Config loaded from cloud');
    } else {
      console.warn('⚠️ Gemini API key not found in app_config table');
    }
  } catch (err) {
    console.error('Failed to load app config:', err);
  }
}

// ─── Cloud-based Usage Tracking ─────────
async function getTodayUsageFromCloud(forceRefresh = false) {
  if (!supabaseClient) return {};
  // Cache for 10 seconds to avoid hammering the DB
  const now = Date.now();
  if (!forceRefresh && _todayUsageCache && (now - _todayUsageCacheTime < 10000)) {
    return _todayUsageCache;
  }
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data, error } = await supabaseClient
      .from('gemini_logs')
      .select('model, total_tokens')
      .gte('created_at', todayStart.toISOString());
    if (error) throw error;
    // Aggregate per model: count requests + sum tokens
    const usage = {};
    (data || []).forEach(row => {
      if (!usage[row.model]) usage[row.model] = { requests: 0, tokens: 0 };
      usage[row.model].requests++;
      usage[row.model].tokens += (row.total_tokens || 0);
    });
    _todayUsageCache = usage;
    _todayUsageCacheTime = now;
    return usage;
  } catch (err) {
    console.warn('Failed to fetch today usage:', err);
    return _todayUsageCache || {};
  }
}

function invalidateUsageCache() {
  _todayUsageCache = null;
  _todayUsageCacheTime = 0;
}

function getAvailableModelsSync(todayUsage) {
  return GEMINI_MODELS_CONFIG.filter(m => {
    const u = todayUsage[m.model] || { requests: 0, tokens: 0 };
    return u.requests < m.rpd;
  });
}

async function getAvailableModels() {
  const usage = await getTodayUsageFromCloud();
  return getAvailableModelsSync(usage);
}
const hasSupabaseCredentials = typeof SUPABASE_URL === 'string'
  && SUPABASE_URL.startsWith('https://')
  && typeof SUPABASE_ANON_KEY === 'string'
  && !SUPABASE_ANON_KEY.startsWith('PASTE_');
const supabaseClient = (window.supabase && hasSupabaseCredentials)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
if (supabaseClient) window.supabaseClient = supabaseClient;

class EnglishLearningApp {
  constructor() {
    this.MAX_QUIZ_QUESTIONS = 50;
    this.QUIZ_ALL = '__all__';
    this.QUIZ_MIXED = '__mixed__';
    this.VOCAB_FLASHCARDS = '__vocab_flashcards__';
    this.VOCAB_STORAGE_KEY = 'english-app-vocab-deck';

    this.questions = [];
    this.questionCatalog = [];
    this.remainingQuestionIds = [];
    this.remainingQuestionSet = new Set();

    this.currentQuestionIndex = 0;
    this.score = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.answered = false;
    this.results = [];
    this.selectedCategory = null;
    this.currentQuizKey = this.QUIZ_ALL;
    this.categories = [];
    this.progress = {};
    this.vocabDeck = [];
    this.currentFlashcards = [];
    this.currentFlashcardIndex = 0;
    this.flashcardShowTranslation = false;
    this.wordPickerCategory = null;
    this.supabase = supabaseClient;
    this.loadedFromRemote = false;
    this.grammarRules = {};
    this.supportsPronunciationColumn = null;

    this.initializeApp();
  }

  async initializeApp() {
    this.showLoadingState('Loading configuration…');
    await loadAppConfig();
    this.showLoadingState('Loading questions from cloud…');
    await Promise.all([this.loadQuestions(), this.loadGrammarRules()]);
    await this.init();
  }

  showLoadingState(message) {
    const grid = document.querySelector('#category-screen .category-grid');
    if (grid) {
      grid.innerHTML = `<div style="width:100%;padding:24px;text-align:center;color:var(--text-muted, #6b7280);font-size:0.95rem;">${message}</div>`;
    }
  }

  normalizeOptions(options) {
    if (Array.isArray(options)) return options;
    if (typeof options === 'string') {
      try {
        const parsed = JSON.parse(options);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  getLocalQuestionSeed() {
    return (typeof questionsData !== 'undefined' && Array.isArray(questionsData)) ? questionsData : [];
  }

  getLocalGrammarRules() {
    return (typeof grammarRules !== 'undefined' && grammarRules && typeof grammarRules === 'object')
      ? grammarRules
      : {};
  }

  async loadQuestions() {
    const localSeed = this.getLocalQuestionSeed();

    if (!this.supabase) {
      this.loadedFromRemote = false;
      this.prepareQuestionCatalog(localSeed);
      return;
    }

    try {
      let remoteData = await this.fetchQuestionsFromSupabase();

      if ((!remoteData || remoteData.length === 0) && localSeed.length > 0) {
        this.showLoadingState('Uploading local questions to Supabase…');
        await this.seedSupabaseWithLocalData(localSeed);
        remoteData = await this.fetchQuestionsFromSupabase();
      }

      if (remoteData && remoteData.length > 0) {
        this.loadedFromRemote = true;
        const normalized = remoteData.map((row, index) => ({
          id: row.id || row.uuid || `remote-${index + 1}`,
          category: row.category,
          sentence: row.sentence,
          correct_answer: row.correct_answer,
          options: this.normalizeOptions(row.options),
          explanation: row.explanation || '',
          translations: row.translations || {}
        })).filter(q => q.category && q.sentence && q.correct_answer && q.options.length);

        this.prepareQuestionCatalog(normalized);
        return;
      }
    } catch (error) {
      console.error('Failed to load questions from Supabase', error);
    }

    this.loadedFromRemote = false;
    this.prepareQuestionCatalog(localSeed);
  }

  async loadGrammarRules() {
    const localRules = this.getLocalGrammarRules();

    if (!this.supabase) {
      this.prepareGrammarRules(localRules);
      return;
    }

    try {
      let remoteRules = await this.fetchGrammarRulesFromSupabase();

      if ((!remoteRules || remoteRules.length === 0) && Object.keys(localRules).length > 0) {
        await this.seedGrammarRulesWithLocalData(localRules);
        remoteRules = await this.fetchGrammarRulesFromSupabase();
      }

      if (remoteRules && remoteRules.length > 0) {
        this.prepareGrammarRules(remoteRules);
        return;
      }
    } catch (error) {
      console.error('Failed to load grammar rules from Supabase', error);
    }

    this.prepareGrammarRules(localRules);
  }

  async fetchQuestionsFromSupabase() {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from('questions')
      .select('id, category, sentence, correct_answer, options, explanation, translations')
      .order('category', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async seedSupabaseWithLocalData(localData) {
    if (!this.supabase || !Array.isArray(localData) || localData.length === 0) return;

    const payload = localData.map(item => ({
      category: item.category,
      sentence: item.sentence,
      correct_answer: item.correct_answer,
      options: this.normalizeOptions(item.options),
      explanation: item.explanation || '',
      translations: item.translations || {}
    }));

    const chunkSize = 75;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await this.supabase.from('questions').insert(chunk);
      if (error) {
        console.error('Failed to seed Supabase', error);
        throw error;
      }
    }
  }

  async fetchGrammarRulesFromSupabase() {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from('grammar_rules')
      .select('id, category, title, icon, rules')
      .order('category', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async seedGrammarRulesWithLocalData(localRules) {
    if (!this.supabase || !localRules || typeof localRules !== 'object') return;

    const payload = Object.entries(localRules).map(([category, ruleSet]) => ({
      category,
      title: ruleSet.title || category,
      icon: ruleSet.icon || '📚',
      rules: Array.isArray(ruleSet.rules) ? ruleSet.rules : []
    }));

    if (payload.length === 0) return;

    const chunkSize = 50;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await this.supabase.from('grammar_rules').insert(chunk);
      if (error) {
        console.error('Failed to seed grammar rules', error);
        throw error;
      }
    }
  }

  async init() {
    this.migrateLocalStorage();
    this.loadQuestionPool();
    this.categories = this.getCategories();
    await this.loadVocabDeck();
    this.loadProgress();
    this.renderCategoryScreen();
    this.updateStreakDisplay();
    this.bindEvents();
  }

  migrateLocalStorage() {
    const DATA_VERSION = 'v9';
    const storedVersion = localStorage.getItem('english-app-version');
    if (storedVersion !== DATA_VERSION) {
      localStorage.removeItem('english-app-question-pool');
      localStorage.removeItem('english-app-progress');
      localStorage.setItem('english-app-version', DATA_VERSION);
    }
  }

  prepareQuestionCatalog(source = []) {
    const data = Array.isArray(source) ? source : [];
    this.questionCatalog = data.map((question, index) => ({
      ...question,
      id: question.id || `q-${index + 1}`,
      options: this.normalizeOptions(question.options),
      explanation: question.explanation || '',
      translations: question.translations || {}
    }));
  }

  prepareGrammarRules(source = {}) {
    if (Array.isArray(source)) {
      this.grammarRules = source.reduce((acc, row) => {
        if (row && row.category) {
          acc[row.category] = {
            title: row.title || row.category,
            icon: row.icon || '📚',
            rules: Array.isArray(row.rules) ? row.rules : []
          };
        }
        return acc;
      }, {});
      return;
    }

    if (source && typeof source === 'object') {
      this.grammarRules = { ...source };
    } else {
      this.grammarRules = {};
    }
  }

  bindEvents() {
    const bindClick = (id, handler) => {
      const element = document.getElementById(id);
      if (!element) return;
      element.addEventListener('click', handler);
    };

    // Close translation tooltips when clicking outside
    document.addEventListener('click', () => {
      document.querySelectorAll('.word-tooltip').forEach(t => t.remove());
    });

    bindClick('back-btn', () => this.handleBack());
    bindClick('rules-btn', () => this.showGrammarRules());

    bindClick('next-btn', () => this.nextQuestion());

    bindClick('modal-overlay', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });

    const modalContent = document.getElementById('modal-content');
    if (modalContent) modalContent.addEventListener('click', (e) => e.stopPropagation());

    bindClick('modal-close-btn', () => this.closeModal());

    bindClick('confirm-overlay', (e) => {
      if (e.target === e.currentTarget) this.closeConfirm();
    });

    const confirmContent = document.getElementById('confirm-content');
    if (confirmContent) confirmContent.addEventListener('click', (e) => e.stopPropagation());

    bindClick('confirm-close-btn', () => this.closeConfirm());
    bindClick('confirm-continue-btn', () => this.closeConfirm());
    bindClick('confirm-leave-btn', () => this.confirmBack());

    // Generate modal events
    bindClick('generate-overlay', (e) => {
      if (e.target === e.currentTarget) this.closeGenerateModal();
    });
    bindClick('generate-close-btn', () => this.closeGenerateModal());
    bindClick('generate-cancel-btn', () => this.closeGenerateModal());
    bindClick('generate-submit-btn', () => this.handleGenerate());

    // History modal
    bindClick('history-overlay', (e) => {
      if (e.target === e.currentTarget) this.closeHistoryModal();
    });
    bindClick('history-close-btn', () => this.closeHistoryModal());

    // Create Category modal
    bindClick('create-cat-overlay', (e) => {
      if (e.target === e.currentTarget) this.closeCreateCategoryModal();
    });
    bindClick('create-cat-close-btn', () => this.closeCreateCategoryModal());
    bindClick('create-cat-cancel-btn', () => this.closeCreateCategoryModal());
    bindClick('create-cat-submit-btn', () => this.handleCreateCategory());

    // Word Picker modal
    bindClick('word-picker-overlay', (e) => {
      if (e.target === e.currentTarget) this.closeWordPickerModal();
    });
    bindClick('word-picker-close-btn', () => this.closeWordPickerModal());
    bindClick('word-picker-cancel-btn', () => this.closeWordPickerModal());
    bindClick('word-picker-select-all-btn', () => this.toggleWordPickerSelection(true));
    bindClick('word-picker-clear-btn', () => this.toggleWordPickerSelection(false));
    bindClick('word-picker-save-btn', () => this.saveWordPickerSelection());

    // Flashcards screen
    bindClick('flashcards-back-btn', () => this.goToCategories());
    bindClick('flashcards-add-btn', () => this.showManualWordModal());
    bindClick('flashcards-pronunciation-btn', () => this.handleGeneratePronunciations());
    bindClick('flashcards-prev-btn', () => this.showPreviousFlashcard());
    bindClick('flashcards-next-btn', () => this.showNextFlashcard());
    bindClick('flashcards-toggle-btn', () => this.toggleFlashcardTranslation());
    bindClick('flashcard', () => this.toggleFlashcardTranslation());
    bindClick('flashcards-remove-btn', () => this.removeCurrentFlashcardWord());

    // Manual word modal
    bindClick('manual-word-overlay', (e) => {
      if (e.target === e.currentTarget) this.closeManualWordModal();
    });
    bindClick('manual-word-close-btn', () => this.closeManualWordModal());
    bindClick('manual-word-cancel-btn', () => this.closeManualWordModal());
    bindClick('manual-word-save-btn', () => this.handleManualWordSave());
  }

  getCategories() {
    const categoryMap = {};
    this.questionCatalog.forEach(question => {
      if (!categoryMap[question.category]) {
        categoryMap[question.category] = { name: question.category, count: 0, available: 0 };
      }
      categoryMap[question.category].count++;
      if (this.remainingQuestionSet.has(question.id)) {
        categoryMap[question.category].available++;
      }
    });
    return Object.values(categoryMap);
  }

  getCategoryIcon(name) {
    const icons = {
      "Present Simple (To Be)": "📝",
      "Present Simple (Do/Does/Don't/Doesn't)": "✅",
      "Present Continuous": "🔄",
      "Past Simple": "⏪",
      "Past Simple (To Be)": "⏪",
      "Past Simple (Did/Didn't)": "⏪",
      "Future Simple": "🔮",
      "Vocabulary - Work": "💼",
      "Verb Endings": "✍️",
      "Be / Been / Being": "🔀"
    };
    return icons[name] || "📚";
  }

  loadProgress() {
    try {
      const saved = localStorage.getItem('english-app-progress');
      this.progress = saved ? JSON.parse(saved) : {};
    } catch {
      this.progress = {};
    }
    this.updateCategoryBadges();
  }

  saveProgress(category, score, total) {
    if (!total) return;
    const pct = Math.round((score / total) * 100);
    if (!this.progress[category] || this.progress[category] < pct) {
      this.progress[category] = pct;
    }
    localStorage.setItem('english-app-progress', JSON.stringify(this.progress));
    this.updateCategoryBadges();
  }

  normalizeWord(word = '') {
    return String(word).trim().toLowerCase();
  }

  normalizePronunciation(value = '') {
    return String(value || '').trim();
  }

  hasHebrewNiqqud(value = '') {
    // Hebrew niqqud marks are in U+05B0-U+05C7 (includes shin/sin dots and qamatz qatan).
    return /[\u05B0-\u05C7]/.test(String(value || ''));
  }

  truncateText(value = '', maxLen = 260) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLen - 3))}...`;
  }

  extractGeminiFailureInfo(rawBody = '') {
    const raw = String(rawBody || '').trim();
    if (!raw) {
      return {
        reason: 'Empty response body.',
        geminiText: ''
      };
    }

    try {
      const parsed = JSON.parse(raw);
      const apiErrorMessage = String(parsed?.error?.message || '').trim();
      const geminiText = String(parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

      if (apiErrorMessage || geminiText) {
        return {
          reason: apiErrorMessage || 'Gemini response could not be used.',
          geminiText
        };
      }
    } catch {
      // Not JSON - return raw text preview below.
    }

    return {
      reason: this.truncateText(raw, 220),
      geminiText: ''
    };
  }

  buildGeminiRetryMessage({ model, attempt, statusCode = '', reason = '', geminiText = '', nextStep = '' }) {
    const lines = [];
    const statusPart = statusCode ? ` (${statusCode})` : '';
    lines.push(`⚠️ ${model} attempt ${attempt} failed${statusPart}.`);

    const cleanReason = this.truncateText(reason, 220) || 'Unknown error.';
    lines.push(`Reason: ${cleanReason}`);

    const cleanGeminiText = this.truncateText(geminiText, 280);
    if (cleanGeminiText) {
      lines.push(`Gemini said: ${cleanGeminiText}`);
    }

    if (nextStep) {
      lines.push(nextStep);
    }

    return lines.join('\n');
  }

  async loadVocabDeck() {
    const localDeck = this.loadVocabDeckFromLocal();

    if (!this.supabase) {
      this.vocabDeck = localDeck;
      return;
    }

    try {
      let data = null;
      let error = null;

      const withPronunciation = await this.supabase
        .from('vocab_words')
        .select('id, word, translation, pronunciation, source_category, created_at')
        .order('created_at', { ascending: false });

      data = withPronunciation.data;
      error = withPronunciation.error;

      if (error) {
        const msg = String(error.message || '').toLowerCase();
        if (msg.includes('pronunciation') && msg.includes('does not exist')) {
          this.supportsPronunciationColumn = false;
          const legacy = await this.supabase
            .from('vocab_words')
            .select('id, word, translation, source_category, created_at')
            .order('created_at', { ascending: false });
          data = legacy.data;
          error = legacy.error;
        }
      }

      if (error) throw error;

      if (this.supportsPronunciationColumn !== false) {
        this.supportsPronunciationColumn = true;
      }

      this.vocabDeck = (data || [])
        .filter(item => item && item.word && item.translation)
        .map(item => ({
          id: item.id,
          word: this.normalizeWord(item.word),
          translation: String(item.translation).trim(),
          pronunciation: this.normalizePronunciation(item.pronunciation),
          sourceCategory: item.source_category || 'Unknown'
        }));

      this.saveVocabDeckToLocal();
      return;
    } catch (error) {
      console.warn('Failed to load vocab words from cloud. Using local copy.', error);
      this.vocabDeck = localDeck;
    }
  }

  loadVocabDeckFromLocal() {
    try {
      const saved = localStorage.getItem(this.VOCAB_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter(item => item && item.word && item.translation)
        .map(item => ({
          id: item.id || null,
          word: this.normalizeWord(item.word),
          translation: String(item.translation).trim(),
          pronunciation: this.normalizePronunciation(item.pronunciation),
          sourceCategory: item.sourceCategory || 'Unknown'
        }));
    } catch {
      return [];
    }
  }

  saveVocabDeck() {
    this.saveVocabDeckToLocal();
  }

  saveVocabDeckToLocal() {
    localStorage.setItem(this.VOCAB_STORAGE_KEY, JSON.stringify(this.vocabDeck));
  }

  getVocabEntryKey(item) {
    return `${this.normalizeWord(item.word)}||${String(item.translation).trim()}`;
  }

  async addWordToDeck(word, translation, sourceCategory = 'Question', pronunciation = '') {
    const normalized = {
      word: this.normalizeWord(word),
      translation: String(translation || '').trim(),
      pronunciation: this.normalizePronunciation(pronunciation),
      sourceCategory: sourceCategory || 'Question'
    };

    if (!normalized.word || !normalized.translation) {
      return { added: false, reason: 'invalid' };
    }

    const key = this.getVocabEntryKey(normalized);
    const exists = this.vocabDeck.some(item => this.getVocabEntryKey(item) === key);
    if (exists) {
      return { added: false, reason: 'exists' };
    }

    let cloudId = null;
    let syncedToCloud = false;
    if (this.supabase) {
      try {
        const insertPayload = {
          word: normalized.word,
          translation: normalized.translation,
          source_category: normalized.sourceCategory
        };
        if (this.supportsPronunciationColumn !== false) {
          insertPayload.pronunciation = normalized.pronunciation || null;
        }

        const { data, error } = await this.supabase
          .from('vocab_words')
          .insert(insertPayload)
          .select('id')
          .single();

        if (error) throw error;
        cloudId = data?.id || null;
        syncedToCloud = true;
        if (this.supportsPronunciationColumn !== false) {
          this.supportsPronunciationColumn = true;
        }
      } catch (error) {
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
          await this.loadVocabDeck();
          return { added: false, reason: 'exists' };
        }
        if (msg.includes('pronunciation') && msg.includes('does not exist')) {
          this.supportsPronunciationColumn = false;
          try {
            const { data, error: legacyError } = await this.supabase
              .from('vocab_words')
              .insert({
                word: normalized.word,
                translation: normalized.translation,
                source_category: normalized.sourceCategory
              })
              .select('id')
              .single();
            if (legacyError) throw legacyError;
            cloudId = data?.id || null;
            syncedToCloud = true;
          } catch (legacyErr) {
            const legacyMsg = String(legacyErr?.message || '').toLowerCase();
            if (legacyMsg.includes('duplicate') || legacyMsg.includes('unique')) {
              await this.loadVocabDeck();
              return { added: false, reason: 'exists' };
            }
            console.warn('Cloud save failed for vocab word, using local fallback.', legacyErr);
          }
        } else {
        // Fallback to local save so the button always works for the learner.
        console.warn('Cloud save failed for vocab word, using local fallback.', error);
        }
      }
    }

    this.vocabDeck.unshift({ ...normalized, id: cloudId });
    this.saveVocabDeck();
    return { added: true, syncedToCloud };
  }

  async removeWordFromDeck(wordItem) {
    if (!wordItem || !wordItem.word || !wordItem.translation) return;

    if (this.supabase) {
      try {
        let query = this.supabase.from('vocab_words').delete();
        if (wordItem.id) {
          query = query.eq('id', wordItem.id);
        } else {
          query = query
            .eq('word', this.normalizeWord(wordItem.word))
            .eq('translation', String(wordItem.translation).trim());
        }

        const { error } = await query;
        if (error) throw error;
      } catch (error) {
        console.error('Failed to delete vocab word from cloud', error);
        window.alert(`Could not delete word from cloud: ${error.message}`);
        return;
      }
    }

    const key = this.getVocabEntryKey(wordItem);
    this.vocabDeck = this.vocabDeck.filter(item => this.getVocabEntryKey(item) !== key);
    this.saveVocabDeck();
  }

  loadQuestionPool() {
    const key = 'english-app-question-pool';
    const allIds = this.questionCatalog.map(q => q.id);

    try {
      const saved = localStorage.getItem(key);
      if (!saved) {
        this.remainingQuestionIds = [...allIds];
      } else {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const allowed = new Set(allIds);
          const existingIds = [...new Set(parsed.filter(id => allowed.has(id)))];
          const existingSet = new Set(existingIds);
          const newlyAddedIds = allIds.filter(id => !existingSet.has(id));

          this.remainingQuestionIds = [...existingIds, ...newlyAddedIds];
          if (this.remainingQuestionIds.length === 0) {
            this.remainingQuestionIds = [...allIds];
          }
        } else {
          this.remainingQuestionIds = [...allIds];
        }
      }
    } catch {
      this.remainingQuestionIds = [...allIds];
    }

    this.remainingQuestionSet = new Set(this.remainingQuestionIds);
    localStorage.setItem(key, JSON.stringify(this.remainingQuestionIds));
  }

  saveQuestionPool() {
    localStorage.setItem('english-app-question-pool', JSON.stringify(this.remainingQuestionIds));
  }

  removeQuestionFromCatalog(questionId) {
    if (!questionId) return;
    const originalLength = this.questionCatalog.length;
    this.questionCatalog = this.questionCatalog.filter(q => q.id !== questionId);
    if (originalLength !== this.questionCatalog.length) {
      this.categories = this.getCategories();
    }
  }

  async deleteQuestionFromCloud(questionId) {
    if (!this.loadedFromRemote || !this.supabase || !questionId) return;
    try {
      const { error } = await this.supabase.from('questions').delete().eq('id', questionId);
      if (error) throw error;
    } catch (error) {
      console.error(`Failed to delete question ${questionId} from Supabase`, error);
    }
  }

  removeFromQuestionPool(questionId) {
    if (!this.remainingQuestionSet.has(questionId)) return;
    this.remainingQuestionSet.delete(questionId);
    this.remainingQuestionIds = this.remainingQuestionIds.filter(id => id !== questionId);
    this.saveQuestionPool();
    this.categories = this.getCategories();
  }

  resetQuestionPool() {
    this.remainingQuestionIds = this.questionCatalog.map(q => q.id);
    this.remainingQuestionSet = new Set(this.remainingQuestionIds);
    this.saveQuestionPool();
    this.categories = this.getCategories();
  }

  updateCategoryBadges() {
    if (!this.progress) this.progress = {};

    document.querySelectorAll('.category-card').forEach(card => {
      const name = card.dataset.category;
      if (this.progress[name] && this.progress[name] >= 80) {
        card.classList.add('completed');
        const badge = card.querySelector('.completion-badge');
        if (badge) badge.textContent = `${this.progress[name]}%`;
      }
    });
  }

  renderCategoryScreen() {
    this.categories = this.getCategories();

    const screen = document.getElementById('category-screen');
    const grid = screen.querySelector('.category-grid');
    grid.innerHTML = '';

    if (!this.questionCatalog.length) {
      grid.innerHTML = `
        <div style="width:100%;padding:24px;text-align:center;color:var(--text-muted, #6b7280);font-size:1rem;">No questions available. You can still practice saved vocabulary flashcards.</div>
        <button class="all-categories-btn" id="empty-vocab-btn" style="background: linear-gradient(135deg, #0ea5e9, #0284c7);"><span>🗂</span> Vocabulary Flashcards (${this.vocabDeck.length} words)</button>
      `;
      const emptyVocabBtn = document.getElementById('empty-vocab-btn');
      if (emptyVocabBtn) {
        emptyVocabBtn.addEventListener('click', () => this.startQuiz(this.VOCAB_FLASHCARDS));
      }
      this.showScreen('category-screen');
      return;
    }

    const availableAll = this.questionCatalog.filter(q => this.remainingQuestionSet.has(q.id)).length;

    const totalInfo = document.createElement('div');
    totalInfo.className = 'total-remaining-info';
    totalInfo.innerHTML = `📊 Total questions remaining: <strong>${availableAll}</strong>`;
    grid.appendChild(totalInfo);

    // History button
    const historyBtn = document.createElement('button');
    historyBtn.className = 'history-btn';
    historyBtn.innerHTML = `📜 API Usage History`;
    historyBtn.addEventListener('click', () => this.showHistoryModal());
    grid.appendChild(historyBtn);

    const mixedBtn = document.createElement('button');
    mixedBtn.className = 'all-categories-btn';
    mixedBtn.innerHTML = `<span>🧠</span> Mixed Quiz (${this.MAX_QUIZ_QUESTIONS} max)`;
    mixedBtn.addEventListener('click', () => this.startQuiz(this.QUIZ_MIXED));
    grid.appendChild(mixedBtn);

    const vocabBtn = document.createElement('button');
    vocabBtn.className = 'all-categories-btn';
    vocabBtn.style.background = 'linear-gradient(135deg, #0ea5e9, #0284c7)';
    vocabBtn.innerHTML = `<span>🗂</span> Vocabulary Flashcards (${this.vocabDeck.length} words)`;
    vocabBtn.addEventListener('click', () => this.startQuiz(this.VOCAB_FLASHCARDS));
    grid.appendChild(vocabBtn);

    // Load quota from cloud then render AI buttons
    getTodayUsageFromCloud().then(todayUsage => {
      const noQuota = getAvailableModelsSync(todayUsage).length === 0;

      // Create Category button
      const createCatBtn = document.createElement('button');
      createCatBtn.className = `create-cat-btn${noQuota ? ' exhausted' : ''}`;
      createCatBtn.innerHTML = `<span>➕</span> Create New Category with AI`;
      if (!noQuota) {
        createCatBtn.addEventListener('click', () => this.showCreateCategoryModal());
      }
      // Insert before first category card
      const firstCard = grid.querySelector('.category-card');
      if (firstCard) grid.insertBefore(createCatBtn, firstCard);
      else grid.appendChild(createCatBtn);

      // Update generate buttons
      grid.querySelectorAll('.generate-icon-btn').forEach(btn => {
        if (noQuota) {
          btn.classList.add('exhausted');
          btn.disabled = true;
          btn.title = 'No AI quota remaining today';
        }
      });
    });

    this.categories.forEach(cat => {
      const card = document.createElement('div');
      card.className = 'category-card';
      card.dataset.category = cat.name;
      card.innerHTML = `
        <span class="completion-badge"></span>
        <div class="icon">${this.getCategoryIcon(cat.name)}</div>
        <h3>${cat.name}</h3>
        <div class="question-count">${cat.available} available</div>
        <div class="card-actions">
          <button class="generate-icon-btn" title="Replace with 50 new questions" data-cat="${cat.name}">🔄</button>
          <button class="delete-icon-btn" title="Delete category" data-cat="${cat.name}">🗑</button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.generate-icon-btn')) return;
        this.startQuiz(cat.name);
      });

      const genBtn = card.querySelector('.generate-icon-btn');
      if (genBtn) {
        genBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showGenerateModal(cat.name);
        });
      }

      const deleteBtn = card.querySelector('.delete-icon-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.deleteCategory(cat.name);
        });
      }

      grid.appendChild(card);
    });

    this.showScreen('category-screen');
    this.updateCategoryBadges();
  }

  getQuizLabel() {
    if (this.currentQuizKey === this.QUIZ_ALL) return 'All Categories';
    if (this.currentQuizKey === this.QUIZ_MIXED) return 'Mixed Quiz';
    return this.currentQuizKey;
  }

  getAvailableQuestions() {
    return this.questionCatalog.filter(q => this.remainingQuestionSet.has(q.id));
  }

  getQuestionsForQuiz(quizKey) {
    const available = this.getAvailableQuestions();

    if (quizKey === this.QUIZ_ALL) {
      return this.shuffleArray([...available]);
    }

    if (quizKey === this.QUIZ_MIXED) {
      const grouped = {};
      available.forEach(q => {
        if (!grouped[q.category]) grouped[q.category] = [];
        grouped[q.category].push(q);
      });

      Object.keys(grouped).forEach(category => {
        grouped[category] = this.shuffleArray(grouped[category]);
      });

      const categories = this.shuffleArray(Object.keys(grouped));
      const mixed = [];

      while (mixed.length < this.MAX_QUIZ_QUESTIONS) {
        let added = false;
        categories.forEach(category => {
          if (grouped[category].length > 0 && mixed.length < this.MAX_QUIZ_QUESTIONS) {
            mixed.push(grouped[category].shift());
            added = true;
          }
        });
        if (!added) break;
      }

      return mixed;
    }

    return this.shuffleArray(available.filter(q => q.category === quizKey));
  }

  startQuiz(quizKey) {
    if (quizKey === this.VOCAB_FLASHCARDS) {
      this.openFlashcardsScreen();
      return;
    }

    this.currentQuizKey = quizKey || this.QUIZ_ALL;
    this.selectedCategory = this.currentQuizKey.startsWith('__') ? null : this.currentQuizKey;
    this.currentQuestionIndex = 0;
    this.score = 0;
    this.streak = 0;
    this.results = [];
    this.answered = false;

    const matchingQuestions = this.getQuestionsForQuiz(this.currentQuizKey);
    this.questions = matchingQuestions.slice(0, this.MAX_QUIZ_QUESTIONS);

    if (this.questions.length === 0) {
      this.showEmptyQuizScreen();
      return;
    }

    this.showScreen('quiz-screen');
    this.renderQuestion();
  }

  showEmptyQuizScreen() {
    const resultsScreen = document.getElementById('results-screen');
    resultsScreen.innerHTML = `
      <div class="results-card">
        <div class="trophy">📭</div>
        <h2>No matching questions left</h2>
        <p class="subtitle">All correctly answered questions were removed from the pool for this quiz.</p>
        <div class="results-actions">
          <button class="btn-primary" id="reset-pool-btn">♻️ Reset Question Pool</button>
          <button class="btn-secondary" id="results-categories-btn">📂 Categories</button>
        </div>
      </div>
    `;

    this.showScreen('results-screen');
    document.getElementById('reset-pool-btn').addEventListener('click', () => {
      this.resetQuestionPool();
      this.startQuiz(this.currentQuizKey);
    });
    document.getElementById('results-categories-btn').addEventListener('click', () => this.goToCategories());
  }

  refreshCurrentQuiz() {
    this.startQuiz(this.currentQuizKey);
  }

  renderQuestion() {
    const q = this.questions[this.currentQuestionIndex];
    const total = this.questions.length;
    const current = this.currentQuestionIndex + 1;

    const remainingEl = document.getElementById('remaining-count');
    if (remainingEl) {
      const totalRemaining = this.questionCatalog.length;
      remainingEl.textContent = `📊 ${totalRemaining} questions left`;
    }

    document.getElementById('category-label').textContent = this.currentQuizKey === this.QUIZ_MIXED
      ? this.getQuizLabel()
      : `${this.getQuizLabel()} · ${q.category}`;
    document.getElementById('progress-text').textContent = `${current} / ${total}`;

    const pct = ((current - 1) / total) * 100;
    document.getElementById('progress-bar').style.width = `${pct}%`;

    document.getElementById('question-number').textContent = `Question ${current}`;

    const sentenceEl = document.getElementById('question-sentence');
    const parts = q.sentence.split('____');
    const translations = q.translations || {};
    const hasTranslations = Object.keys(translations).length > 0;

    const makeClickableWords = (text) => {
      if (!hasTranslations) return this.escapeHtml(text);
      return text.split(/\b/).map(token => {
        const clean = token.replace(/[^a-zA-Z']/g, '').toLowerCase();
        if (clean && translations[clean]) {
          return `<span class="translatable-word" data-word="${this.escapeHtml(clean)}" data-translation="${this.escapeHtml(translations[clean])}" data-category="${this.escapeHtml(q.category)}">${this.escapeHtml(token)}</span>`;
        }
        return this.escapeHtml(token);
      }).join('');
    };

    sentenceEl.innerHTML = `${makeClickableWords(parts[0])}<span class="blank" id="blank-slot">____</span>${makeClickableWords(parts[1] || '')}`;

    // Bind click events on translatable words
    sentenceEl.querySelectorAll('.translatable-word').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        // Remove any existing tooltip
        document.querySelectorAll('.word-tooltip').forEach(t => t.remove());

        const word = this.normalizeWord(el.dataset.word || el.textContent || '');
        const translation = String(el.dataset.translation || '').trim();
        const category = el.dataset.category || q.category;
        const exists = this.vocabDeck.some(item => this.getVocabEntryKey(item) === this.getVocabEntryKey({ word, translation }));

        const tooltip = document.createElement('div');
        tooltip.className = 'word-tooltip';
        tooltip.innerHTML = `
          <span class="word-tooltip-translation">${this.escapeHtml(translation)}</span>
          <div class="word-tooltip-actions">
            <button class="word-tooltip-add-btn${exists ? ' saved' : ''}" ${exists ? 'disabled' : ''}>${exists ? '✅ Saved' : '➕ Add to Practice'}</button>
          </div>
        `;
        el.appendChild(tooltip);

        const addBtn = tooltip.querySelector('.word-tooltip-add-btn');
        if (addBtn && !exists) {
          addBtn.addEventListener('pointerdown', async (evt) => {
            evt.stopPropagation();
            evt.preventDefault();
            addBtn.disabled = true;
            addBtn.textContent = '⏳ Saving...';
            const result = await this.addWordToDeck(word, translation, category);
            if (result.added) {
              addBtn.classList.add('saved');
              addBtn.textContent = result.syncedToCloud ? '✅ Saved' : '✅ Saved (local)';
              if (document.getElementById('category-screen')?.classList.contains('active')) {
                this.renderCategoryScreen();
              }
            } else if (result.reason === 'exists') {
              addBtn.classList.add('saved');
              addBtn.textContent = '✅ Saved';
            } else {
              addBtn.disabled = false;
              addBtn.textContent = '⚠️ Retry';
            }
          });
        }

        setTimeout(() => tooltip.classList.add('show'), 10);
      });
    });

    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';
    const shuffledOptions = this.shuffleArray([...q.options]);
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

    shuffledOptions.forEach((opt, index) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.innerHTML = `
        <span class="option-letter">${letters[index]}</span>
        <span>${this.escapeHtml(opt)}</span>
      `;
      btn.addEventListener('click', () => this.selectAnswer(opt, btn));
      optionsContainer.appendChild(btn);
    });

    const explanation = document.getElementById('explanation-box');
    explanation.className = 'explanation-box';
    explanation.style.display = 'none';

    document.getElementById('next-btn-container').classList.remove('show');

    this.answered = false;
  }

  selectAnswer(selected, btnElement) {
    if (this.answered) return;
    this.answered = true;

    const q = this.questions[this.currentQuestionIndex];
    const isCorrect = selected === q.correct_answer;
    const blankSlot = document.getElementById('blank-slot');

    blankSlot.textContent = selected;
    blankSlot.classList.add(isCorrect ? 'correct' : 'wrong');

    btnElement.classList.add(isCorrect ? 'correct' : 'wrong');

    document.querySelectorAll('.option-btn').forEach(btn => {
      btn.classList.add('disabled');
      const optText = btn.querySelector('span:last-child').textContent;
      if (optText === q.correct_answer && !isCorrect) {
        btn.classList.add('correct');
      }
    });

    if (isCorrect) {
      this.removeQuestionFromCatalog(q.id);
      this.removeFromQuestionPool(q.id);
      this.deleteQuestionFromCloud(q.id);
      this.score++;
      this.streak++;
      if (this.streak > this.maxStreak) this.maxStreak = this.streak;
    } else {
      this.streak = 0;
    }

    this.updateStreakDisplay();

    this.results.push({
      sentence: q.sentence,
      category: q.category,
      correct_answer: q.correct_answer,
      selected,
      isCorrect,
      explanation: q.explanation
    });

    const explanation = document.getElementById('explanation-box');
    explanation.className = `explanation-box show ${isCorrect ? 'correct' : 'wrong'}`;
    explanation.style.display = 'flex';
    explanation.innerHTML = `
      <span class="icon">${isCorrect ? '✅' : '❌'}</span>
      <span>${isCorrect ? 'Correct! ' : `The correct answer is "<strong>${this.escapeHtml(q.correct_answer)}</strong>". `}${this.escapeHtml(q.explanation)}</span>
    `;

    document.getElementById('next-btn-container').classList.add('show');

    const isLast = this.currentQuestionIndex === this.questions.length - 1;
    document.getElementById('next-btn').textContent = isLast ? '📊 See Results' : 'Next Question →';
  }

  nextQuestion() {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.currentQuestionIndex++;
      this.renderQuestion();
    } else {
      this.showResults();
    }
  }

  showResults() {
    const total = this.questions.length;
    const pct = total ? Math.round((this.score / total) * 100) : 0;

    if (this.selectedCategory) {
      this.saveProgress(this.selectedCategory, this.score, total);
    } else {
      this.categories.forEach(cat => {
        const catResults = this.results.filter(r => r.category === cat.name);
        if (catResults.length > 0) {
          const catScore = catResults.filter(r => r.isCorrect).length;
          this.saveProgress(cat.name, catScore, catResults.length);
        }
      });
    }

    let trophy, title, subtitle, scoreClass;
    if (pct >= 90) {
      trophy = '🏆'; title = 'Excellent!'; subtitle = 'Outstanding performance!'; scoreClass = 'excellent';
    } else if (pct >= 70) {
      trophy = '⭐'; title = 'Great Job!'; subtitle = 'Keep practicing to reach perfection!'; scoreClass = 'good';
    } else if (pct >= 50) {
      trophy = '💪'; title = 'Good Effort!'; subtitle = 'Review mistakes and refresh new questions.'; scoreClass = 'good';
    } else {
      trophy = '📖'; title = 'Keep Learning!'; subtitle = "Practice again with updated questions."; scoreClass = 'needs-work';
    }

    const wrong = total - this.score;
    const wrongResults = this.results.filter(r => !r.isCorrect);

    const resultsScreen = document.getElementById('results-screen');
    resultsScreen.innerHTML = `
      <div class="results-card">
        <div class="trophy">${trophy}</div>
        <h2>${title}</h2>
        <p class="subtitle">${subtitle}</p>

        <div class="score-circle ${scoreClass}">
          <span class="score-value">${pct}%</span>
          <span class="score-label">Score</span>
        </div>

        <div class="stats-row">
          <div class="stat-item correct-stat">
            <span class="stat-number">${this.score}</span>
            <span class="stat-label">Correct</span>
          </div>
          <div class="stat-item wrong-stat">
            <span class="stat-number">${wrong}</span>
            <span class="stat-label">Wrong</span>
          </div>
          <div class="stat-item">
            <span class="stat-number">${this.maxStreak}🔥</span>
            <span class="stat-label">Best Streak</span>
          </div>
        </div>

        <div class="results-actions">
          <button class="btn-primary" id="results-retry-btn">🔄 Try Again</button>
          <button class="btn-secondary" id="results-categories-btn">📂 Categories</button>
        </div>

        ${wrongResults.length > 0 ? `
          <div class="review-section">
            <h3>📋 Review Mistakes</h3>
            ${wrongResults.map(r => `
              <div class="review-item">
                <div class="review-sentence">${this.escapeHtml(r.sentence)}</div>
                <div class="review-answer">
                  Your answer: <span style="color: var(--error); font-weight: 600;">${this.escapeHtml(r.selected)}</span>
                  &nbsp;|&nbsp; Correct: <strong>${this.escapeHtml(r.correct_answer)}</strong>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;

    this.showScreen('results-screen');

    document.getElementById('results-retry-btn').addEventListener('click', () => this.restartSameCategory());
    document.getElementById('results-categories-btn').addEventListener('click', () => this.goToCategories());

    document.getElementById('progress-bar').style.width = '100%';
    if (pct >= 80) this.launchConfetti();
  }

  restartSameCategory() {
    this.startQuiz(this.currentQuizKey);
  }

  goToCategories() {
    this.renderCategoryScreen();
  }

  // ─── Gemini Logging (Cloud) ─────────────────────
  async logGeminiCall(entry) {
    invalidateUsageCache();
    if (!this.supabase) return;
    try {
      await this.supabase.from('gemini_logs').insert({
        action: entry.action || 'unknown',
        category: entry.category || null,
        model: entry.model || 'unknown',
        prompt_tokens: entry.promptTokens || 0,
        response_tokens: entry.responseTokens || 0,
        total_tokens: entry.tokensUsed || 0,
        questions_generated: entry.questionsGenerated || 0,
        success: entry.success !== false,
        error_message: entry.errorMessage || null
      });
    } catch (err) {
      console.warn('Failed to log Gemini call:', err);
    }
  }

  async getGeminiLogsFromCloud() {
    if (!this.supabase) return [];
    try {
      const { data, error } = await this.supabase
        .from('gemini_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.warn('Failed to fetch Gemini logs:', err);
      return [];
    }
  }

  saveGenerationHistory(entry) {
    // Log to cloud (replaces localStorage)
    this.logGeminiCall(entry);
  }

  async showHistoryModal() {
    const body = document.getElementById('history-body');
    body.innerHTML = `<p style="text-align:center; color: var(--text-muted); padding: 24px 0;">⏳ Loading usage data from cloud...</p>`;
    document.getElementById('history-overlay').classList.add('show');

    const logs = await this.getGeminiLogsFromCloud();

    if (logs.length === 0) {
      body.innerHTML = `<p style="text-align:center; color: var(--text-muted); padding: 24px 0;">No API usage history yet.</p>`;
      return;
    }

    // Today's date for filtering
    const todayStr = new Date().toISOString().slice(0, 10);

    // ─── Per-model summary (today + all-time) ───
    const modelTodayMap = {};
    const modelAllMap = {};
    logs.forEach(l => {
      const day = l.created_at.slice(0, 10);
      // All-time
      if (!modelAllMap[l.model]) modelAllMap[l.model] = { requests: 0, tokens: 0 };
      modelAllMap[l.model].requests++;
      modelAllMap[l.model].tokens += (l.total_tokens || 0);
      // Today
      if (day === todayStr) {
        if (!modelTodayMap[l.model]) modelTodayMap[l.model] = { requests: 0, tokens: 0 };
        modelTodayMap[l.model].requests++;
        modelTodayMap[l.model].tokens += (l.total_tokens || 0);
      }
    });

    const actionLabel = (a) => {
      if (a === 'create_category') return '➕ Create Category';
      if (a === 'generate_pronunciations') return '🗣 Fill Pronunciations';
      return '🔄 Replace Questions';
    };

    body.innerHTML = `
      <h3 style="margin:0 0 10px; font-size:1rem; color:var(--text-secondary);">📊 Today's Usage by Model</h3>
      <div class="history-model-breakdown">
        ${GEMINI_MODELS_CONFIG.map(m => {
          const t = modelTodayMap[m.model] || { requests: 0, tokens: 0 };
          const reqLeft = Math.max(0, m.rpd - t.requests);
          const pct = Math.min(100, (t.requests / m.rpd) * 100);
          return `
            <div class="model-stat-row">
              <span class="model-stat-name">${this.escapeHtml(m.model)}</span>
              <div class="model-stat-bar-wrap">
                <div class="model-stat-bar" style="width:${pct}%;${pct >= 90 ? 'background:var(--error,#ef4444);' : ''}"></div>
              </div>
              <span class="model-stat-detail">${t.requests}/${m.rpd} req</span>
              <span class="model-stat-detail">${(t.tokens / 1000).toFixed(1)}K / ${(m.tpm / 1000).toFixed(0)}K tokens</span>
            </div>`;
        }).join('')}
      </div>

      <h3 style="margin:18px 0 10px; font-size:1rem; color:var(--text-secondary);">🤖 All-Time Usage by Model</h3>
      <div class="history-model-breakdown">
        ${Object.entries(modelAllMap).map(([model, stats]) => `
          <div class="model-stat-row">
            <span class="model-stat-name">${this.escapeHtml(model)}</span>
            <span class="model-stat-detail">${stats.requests} req</span>
            <span class="model-stat-detail">${(stats.tokens / 1000).toFixed(1)}K tokens</span>
          </div>
        `).join('')}
      </div>

      <h3 style="margin:18px 0 10px; font-size:1rem; color:var(--text-secondary);">📜 All API Calls</h3>
      <div class="history-list">
        ${logs.map(l => {
          const d = new Date(l.created_at);
          const dateStr = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
          const timeStr = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
          return `
            <div class="history-entry${!l.success ? ' history-entry-error' : ''}">
              <div class="history-entry-header">
                <span class="history-date">${dateStr} ${timeStr}</span>
                <span class="history-action-badge">${actionLabel(l.action)}</span>
                ${l.success ? '<span class="history-success-badge">✅</span>' : '<span class="history-fail-badge">❌</span>'}
              </div>
              <div class="history-details">
                <span>🤖 ${this.escapeHtml(l.model || 'unknown')}</span>
                <span>📊 ${(l.total_tokens || 0).toLocaleString()} tokens</span>
                <span>📥 ${(l.prompt_tokens || 0).toLocaleString()} / 📤 ${(l.response_tokens || 0).toLocaleString()}</span>
              </div>
              ${l.category ? `<div class="history-details-extra"><span>📂 ${this.escapeHtml(l.category)}</span></div>` : ''}
              ${!l.success && l.error_message ? `<div class="history-details-extra"><span style="color:var(--error);">${this.escapeHtml(l.error_message)}</span></div>` : ''}
            </div>`;
        }).join('')}
      </div>
    `;
  }

  closeHistoryModal() {
    document.getElementById('history-overlay').classList.remove('show');
  }

  // ─── Create New Category with Gemini ────────
  async showCreateCategoryModal() {
    const overlay = document.getElementById('create-cat-overlay');

    const input = document.getElementById('create-cat-input');
    input.value = '';

    const statusEl = document.getElementById('create-cat-status');
    statusEl.style.display = 'none';
    statusEl.className = 'generate-status';

    const usageStats = document.getElementById('create-cat-usage-stats');
    usageStats.style.display = 'none';

    const responseEl = document.getElementById('create-cat-response');
    responseEl.style.display = 'none';
    responseEl.className = 'create-cat-response';

    const submitBtn = document.getElementById('create-cat-submit-btn');
    const modelSelect = document.getElementById('create-cat-model-select');

    const todayUsage = await getTodayUsageFromCloud(true);
    const available = getAvailableModelsSync(todayUsage);

    modelSelect.innerHTML = '';
    GEMINI_MODELS_CONFIG.forEach(m => {
      const u = todayUsage[m.model] || { requests: 0, tokens: 0 };
      const reqLeft = Math.max(0, m.rpd - u.requests);
      const opt = document.createElement('option');
      opt.value = m.model;
      opt.textContent = `${m.model}  (${reqLeft}/${m.rpd} req | ${(u.tokens / 1000).toFixed(0)}K tokens used)`;
      opt.disabled = reqLeft === 0;
      modelSelect.appendChild(opt);
    });

    const firstAvailable = available[0];
    if (firstAvailable) modelSelect.value = firstAvailable.model;

    if (available.length === 0) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⛔ No quota left today';
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = '✨ Create Category';
    }

    overlay.classList.add('show');
    setTimeout(() => input.focus(), 100);
  }

  closeCreateCategoryModal() {
    document.getElementById('create-cat-overlay').classList.remove('show');
  }

  async handleCreateCategory() {
    const input = document.getElementById('create-cat-input');
    const description = input.value.trim();
    const statusEl = document.getElementById('create-cat-status');
    const submitBtn = document.getElementById('create-cat-submit-btn');
    const usageStats = document.getElementById('create-cat-usage-stats');
    const responseEl = document.getElementById('create-cat-response');
    const selectedModel = document.getElementById('create-cat-model-select').value;

    responseEl.style.display = 'none';
    usageStats.style.display = 'none';

    if (!description) {
      statusEl.style.display = 'block';
      statusEl.className = 'generate-status error';
      statusEl.textContent = '⚠️ Please describe the category you want to create.';
      return;
    }

    // Check if description is too short
    if (description.length < 3) {
      statusEl.style.display = 'block';
      statusEl.className = 'generate-status error';
      statusEl.textContent = '⚠️ Please provide a more detailed description.';
      return;
    }

    // Check quota from cloud
    const todayUsage = await getTodayUsageFromCloud(true);
    const modelConfig = GEMINI_MODELS_CONFIG.find(m => m.model === selectedModel);
    const u = todayUsage[selectedModel] || { requests: 0, tokens: 0 };
    if (!modelConfig || u.requests >= modelConfig.rpd) {
      statusEl.style.display = 'block';
      statusEl.className = 'generate-status error';
      statusEl.textContent = `⛔ No quota remaining for ${selectedModel}. Choose another model.`;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Creating...';
    statusEl.style.display = 'block';
    statusEl.className = 'generate-status info';
    statusEl.textContent = 'Step 1/4: Sending to Gemini AI for validation...';

    try {
      const result = await this.callGeminiForNewCategory(description, selectedModel);

      // Check if Gemini rejected the category
      if (result.rejected) {
        statusEl.style.display = 'none';
        responseEl.style.display = 'block';
        responseEl.className = 'create-cat-response error-response';
        responseEl.textContent = result.message || 'Gemini could not create this category.';
        submitBtn.disabled = false;
        submitBtn.textContent = '✨ Create Category';
        return;
      }

      const { categoryName, grammarRule, questions } = result;

      // Check if category already exists
      const existing = this.questionCatalog.find(q => q.category === categoryName);
      if (existing) {
        statusEl.className = 'generate-status error';
        statusEl.textContent = `⚠️ Category "${categoryName}" already exists. Use the 🔄 button to regenerate its questions.`;
        submitBtn.disabled = false;
        submitBtn.textContent = '✨ Create Category';
        return;
      }

      // Step 2: Insert grammar rule to Supabase
      statusEl.textContent = `Step 2/4: Saving grammar rules for "${categoryName}"...`;
      if (this.supabase) {
        const { error: ruleError } = await this.supabase
          .from('grammar_rules')
          .insert({
            category: categoryName,
            title: grammarRule.title || categoryName,
            icon: grammarRule.icon || '📚',
            rules: grammarRule.rules || []
          });
        if (ruleError) throw new Error(`Failed to save grammar rules: ${ruleError.message}`);
      }

      // Add grammar rule locally
      this.grammarRules[categoryName] = {
        title: grammarRule.title || categoryName,
        icon: grammarRule.icon || '📚',
        rules: grammarRule.rules || []
      };

      // Step 3: Insert questions to Supabase
      statusEl.textContent = `Step 3/4: Uploading ${questions.length} questions to cloud...`;
      let insertedQuestions = [];
      if (this.supabase) {
        const payload = questions.map(q => ({
          category: categoryName,
          sentence: q.sentence,
          correct_answer: q.correct_answer,
          options: q.options,
          explanation: q.explanation || '',
          translations: q.translations || {}
        }));

        const { data, error } = await this.supabase
          .from('questions')
          .insert(payload)
          .select('id, category, sentence, correct_answer, options, explanation, translations');

        if (error) throw new Error(`Failed to upload questions: ${error.message}`);
        insertedQuestions = data || [];
      }

      // Step 4: Update local state
      statusEl.textContent = 'Step 4/4: Updating local state...';
      insertedQuestions.forEach(q => {
        const normalized = {
          id: q.id,
          category: q.category,
          sentence: q.sentence,
          correct_answer: q.correct_answer,
          options: this.normalizeOptions(q.options),
          explanation: q.explanation || '',
          translations: q.translations || {}
        };
        this.questionCatalog.push(normalized);
        this.remainingQuestionIds.push(q.id);
        this.remainingQuestionSet.add(q.id);
      });
      this.saveQuestionPool();
      this.categories = this.getCategories();

      statusEl.className = 'generate-status success';
      statusEl.textContent = `✅ Created "${categoryName}" with ${insertedQuestions.length} questions!`;

      // Save to generation history
      this.saveGenerationHistory({
        action: 'create_category',
        date: new Date().toISOString(),
        category: categoryName,
        model: result.modelUsed,
        questionsGenerated: insertedQuestions.length,
        tokensUsed: result.tokensUsed,
        promptTokens: result.promptTokens,
        responseTokens: result.responseTokens
      });

      // Show usage stats
      usageStats.style.display = 'block';
      usageStats.innerHTML = `
        <div class="usage-stat"><span>🤖 Model:</span><strong>${result.modelUsed}</strong></div>
        <div class="usage-stat"><span>� Tokens used:</span><strong>${result.tokensUsed.toLocaleString()}</strong></div>
        <div class="usage-stat"><span>📥 Prompt / 📤 Response:</span><strong>${result.promptTokens.toLocaleString()} / ${result.responseTokens.toLocaleString()}</strong></div>
      `;

      submitBtn.textContent = '✅ Done';

      setTimeout(() => {
        this.closeCreateCategoryModal();
        this.renderCategoryScreen();
      }, 3000);

    } catch (err) {
      console.error('Create category failed:', err);
      statusEl.className = 'generate-status error';
      statusEl.textContent = `❌ Error: ${err.message}`;
      submitBtn.disabled = false;
      submitBtn.textContent = '✨ Retry';
      // Log failed call
      this.logGeminiCall({
        action: 'create_category',
        category: description.substring(0, 100),
        model: selectedModel || 'unknown',
        success: false,
        errorMessage: err.message
      });
    }
  }

  async callGeminiForNewCategory(description, selectedModel) {
    const systemInstruction = `Role:
You are an expert English Language Teacher and Content Creator for a specialized study app.

Your task is to evaluate whether a user's free-text description represents a valid, teachable English grammar or vocabulary category.

If the description IS a valid English learning category:
Return a JSON object with this EXACT structure:
{
  "valid": true,
  "categoryName": "Short Category Title (2-5 words)",
  "grammarRule": {
    "title": "Category Title",
    "icon": "📚",
    "rules": [
      {
        "heading": "Rule Section Title",
        "content": "<p>HTML content explaining the rule with examples</p><table>...</table>"
      }
    ]
  },
  "questions": [
    {
      "category": "MUST match categoryName exactly",
      "sentence": "A sentence with ____ blank to fill.",
      "correct_answer": "correct word",
      "options": ["option1", "option2", "option3"],
      "explanation": "Why this answer is correct.",
      "translations": {"a": "א", "sentence": "משפט", "with": "עם", "blank": "ריק", "to": "ל", "fill": "למלא"}
    }
  ]
}

Requirements for a VALID response:
- categoryName: A concise, professional 2-5 word title (e.g. "Prepositions of Time", "Modal Verbs", "Comparative Adjectives")
- grammarRule.icon: A single relevant emoji
- grammarRule.rules: 3-5 rule sections with detailed HTML content, examples, and tables where appropriate
- questions: Exactly 50 unique quiz questions in fill-in-the-blank format
- Each question must have exactly 3 options including the correct answer
- Each question MUST include a "translations" object mapping every unique word in the sentence (lowercased, no punctuation) to its Hebrew translation
- All content must be in English (except translations which are in Hebrew)
- Complexity: Suitable for adult learners / computer science students
- The "category" field in EVERY question object MUST be EXACTLY the same as "categoryName"

If the description is NOT a valid English learning category (e.g. nonsense, non-English topic, too vague, offensive, or not related to language learning):
Return a JSON object:
{
  "valid": false,
  "message": "A friendly explanation in English of why this cannot be created as a category, and suggest what would work instead."
}

CRITICAL: Return ONLY valid JSON. No markdown, no code blocks, no text before or after the JSON.`;

    const prompt = `The user wants to create a new English learning category. Here is their description:

"${description}"

Evaluate this description. If it's a valid, teachable English grammar or vocabulary topic, create the full category with grammar rules and 50 questions. If not, explain why and suggest alternatives.

Return ONLY valid JSON as specified in your instructions.`;

    const body = JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 32768
      }
    });

    let response;
    let lastError;
    const statusEl = document.getElementById('create-cat-status');
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const modelsToTry = selectedModel
      ? [{ model: selectedModel }]
      : await getAvailableModels();
    if (modelsToTry.length === 0) {
      throw new Error('Daily API quota exhausted for all models. Try again tomorrow.');
    }

    let usedModel = '';

    for (const { model } of modelsToTry) {
      const url = geminiUrl(model);

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (statusEl) {
            statusEl.className = 'generate-status info';
            statusEl.textContent = `⏳ Trying ${model}${attempt > 1 ? ` (attempt ${attempt})` : ''}...`;
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 90000);

          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (response.ok) break;

          const errBody = await response.text();

          if (response.status === 429 || response.status === 503) {
            const retryMatch = errBody.match(/retryDelay.*?(\d+)s/i);
            const waitSec = retryMatch ? Math.min(parseInt(retryMatch[1], 10) + 3, 45) : 15;
            const failure = this.extractGeminiFailureInfo(errBody);
            if (statusEl) {
              statusEl.className = 'generate-status error';
              statusEl.textContent = this.buildGeminiRetryMessage({
                model,
                attempt,
                statusCode: response.status,
                reason: failure.reason,
                geminiText: failure.geminiText,
                nextStep: `Retrying in ${waitSec}s...`
              });
            }
            lastError = new Error(this.buildGeminiRetryMessage({
              model,
              attempt,
              statusCode: response.status,
              reason: failure.reason,
              geminiText: failure.geminiText
            }));
            await sleep(waitSec * 1000);
            response = null;
            continue;
          }

          const failure = this.extractGeminiFailureInfo(errBody);
          const failMessage = this.buildGeminiRetryMessage({
            model,
            attempt,
            statusCode: response.status,
            reason: failure.reason,
            geminiText: failure.geminiText,
            nextStep: 'Trying next model...'
          });
          if (statusEl) {
            statusEl.className = 'generate-status error';
            statusEl.textContent = failMessage;
          }
          lastError = new Error(failMessage);
          response = null;
          break;
        } catch (fetchErr) {
          const reason = fetchErr.name === 'AbortError'
            ? 'Request timed out (90s).'
            : (fetchErr?.message || 'Unknown network error.');
          const failMessage = this.buildGeminiRetryMessage({
            model,
            attempt,
            reason,
            nextStep: attempt < 3 ? 'Retrying now...' : 'Trying next model...'
          });
          if (statusEl) {
            statusEl.className = 'generate-status error';
            statusEl.textContent = failMessage;
          }
          lastError = new Error(failMessage);
          response = null;
          continue;
        }
      }

      if (response && response.ok) {
        usedModel = model;
        break;
      }
    }

    if (!response || !response.ok) {
      throw lastError || new Error('All Gemini models failed. Try again in a minute.');
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini.');

    const usageMetadata = result?.usageMetadata || {};
    const promptTokens = usageMetadata.promptTokenCount || 0;
    const responseTokens = usageMetadata.candidatesTokenCount || usageMetadata.totalTokenCount || 0;
    const totalTokens = usageMetadata.totalTokenCount || (promptTokens + responseTokens);

    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // If we can't parse JSON, treat as a rejection message
      return {
        rejected: true,
        message: text.substring(0, 500),
        modelUsed: usedModel,
        tokensUsed: totalTokens,
        promptTokens,
        responseTokens
      };
    }

    // Check if Gemini rejected the category
    if (parsed.valid === false) {
      return {
        rejected: true,
        message: parsed.message || 'This description cannot be used as an English learning category.',
        modelUsed: usedModel,
        tokensUsed: totalTokens,
        promptTokens,
        responseTokens
      };
    }

    // Validate the response structure
    if (!parsed.categoryName || !parsed.grammarRule || !Array.isArray(parsed.questions)) {
      return {
        rejected: true,
        message: 'Gemini returned an incomplete response. Please try a clearer description.',
        modelUsed: usedModel,
        tokensUsed: totalTokens,
        promptTokens,
        responseTokens
      };
    }

    // Validate and normalize questions
    const validQuestions = parsed.questions
      .filter(q =>
        q.sentence && q.sentence.includes('____') &&
        q.correct_answer &&
        Array.isArray(q.options) && (q.options.length === 3 || q.options.length === 4) &&
        q.options.includes(q.correct_answer)
      )
      .map(q => ({ ...q, category: parsed.categoryName }));

    if (validQuestions.length < 5) {
      return {
        rejected: true,
        message: `Gemini could only generate ${validQuestions.length} valid questions. Please try a more specific description.`,
        modelUsed: usedModel,
        tokensUsed: totalTokens,
        promptTokens,
        responseTokens
      };
    }

    return {
      rejected: false,
      categoryName: parsed.categoryName,
      grammarRule: parsed.grammarRule,
      questions: validQuestions,
      modelUsed: usedModel,
      tokensUsed: totalTokens,
      promptTokens,
      responseTokens
    };
  }

  // ─── Generate Questions with Gemini ────────
  async showGenerateModal(category) {
    const overlay = document.getElementById('generate-overlay');
    document.getElementById('generate-category-name').textContent = category;
    overlay.dataset.category = category;
    const notesInput = document.getElementById('generate-notes-input');
    if (notesInput) notesInput.value = '';

    const statusEl = document.getElementById('generate-status');
    statusEl.style.display = 'none';
    statusEl.className = 'generate-status';

    const usageStats = document.getElementById('generate-usage-stats');
    usageStats.style.display = 'none';

    const submitBtn = document.getElementById('generate-submit-btn');
    const modelSelect = document.getElementById('generate-model-select');

    const todayUsage = await getTodayUsageFromCloud(true);
    const available = getAvailableModelsSync(todayUsage);

    // Populate model selector
    modelSelect.innerHTML = '';
    GEMINI_MODELS_CONFIG.forEach(m => {
      const u = todayUsage[m.model] || { requests: 0, tokens: 0 };
      const reqLeft = Math.max(0, m.rpd - u.requests);
      const opt = document.createElement('option');
      opt.value = m.model;
      opt.textContent = `${m.model}  (${reqLeft}/${m.rpd} req | ${(u.tokens / 1000).toFixed(0)}K tokens used)`;
      opt.disabled = reqLeft === 0;
      modelSelect.appendChild(opt);
    });

    // Select first available model
    const firstAvailable = available[0];
    if (firstAvailable) modelSelect.value = firstAvailable.model;

    if (available.length === 0) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⛔ No quota left today';
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = '🔄 Replace & Generate';
    }

    overlay.classList.add('show');
  }

  closeGenerateModal() {
    document.getElementById('generate-overlay').classList.remove('show');
  }

  async handleGenerate() {
    const overlay = document.getElementById('generate-overlay');
    const category = overlay.dataset.category;
    const amount = 50;
    const statusEl = document.getElementById('generate-status');
    const submitBtn = document.getElementById('generate-submit-btn');
    const usageStats = document.getElementById('generate-usage-stats');
    const selectedModel = document.getElementById('generate-model-select').value;
    const notesInput = document.getElementById('generate-notes-input');
    const generationNotes = String(notesInput?.value || '').trim().slice(0, 500);

    usageStats.style.display = 'none';

    // Check quota from cloud
    const todayUsage = await getTodayUsageFromCloud(true);
    const modelConfig = GEMINI_MODELS_CONFIG.find(m => m.model === selectedModel);
    const u = todayUsage[selectedModel] || { requests: 0, tokens: 0 };
    if (!modelConfig || u.requests >= modelConfig.rpd) {
      statusEl.style.display = 'block';
      statusEl.className = 'generate-status error';
      statusEl.textContent = `⛔ No quota remaining for ${selectedModel}. Choose another model.`;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Generating...';
    statusEl.style.display = 'block';
    statusEl.className = 'generate-status info';
    statusEl.textContent = `Step 1/3: Deleting old "${category}" questions...`;

    try {
      // Step 1: Delete existing questions for this category from cloud
      const { error: delError } = await this.supabase
        .from('questions')
        .delete()
        .eq('category', category);
      if (delError) throw new Error(`Failed to delete old questions: ${delError.message}`);

      // Remove from local catalog and pool
      const oldIds = this.questionCatalog.filter(q => q.category === category).map(q => q.id);
      this.questionCatalog = this.questionCatalog.filter(q => q.category !== category);
      oldIds.forEach(id => {
        this.remainingQuestionSet.delete(id);
      });
      this.remainingQuestionIds = this.remainingQuestionIds.filter(id => !oldIds.includes(id));

      // Step 2: Generate new questions
      statusEl.textContent = `Step 2/3: Generating ${amount} new questions with ${selectedModel}...`;
      const genResult = await this.callGeminiForQuestions(category, amount, selectedModel, generationNotes);

      if (!genResult.questions || genResult.questions.length === 0) {
        throw new Error('Gemini returned no valid questions.');
      }

      // Step 3: Upload to cloud
      statusEl.textContent = `Step 3/3: Uploading ${genResult.questions.length} questions to cloud...`;
      const inserted = await this.uploadGeneratedQuestions(genResult.questions);

      // Add to local catalog and pool
      inserted.forEach(q => {
        const normalized = {
          id: q.id,
          category: q.category,
          sentence: q.sentence,
          correct_answer: q.correct_answer,
          options: this.normalizeOptions(q.options),
          explanation: q.explanation || '',
          translations: q.translations || {}
        };
        this.questionCatalog.push(normalized);
        this.remainingQuestionIds.push(q.id);
        this.remainingQuestionSet.add(q.id);
      });
      this.saveQuestionPool();
      this.categories = this.getCategories();

      statusEl.className = 'generate-status success';
      statusEl.textContent = `✅ Replaced with ${inserted.length} new questions in "${category}"!`;

      // Save to generation history
      this.saveGenerationHistory({
        action: 'generate_questions',
        date: new Date().toISOString(),
        category,
        model: genResult.modelUsed,
        questionsGenerated: inserted.length,
        tokensUsed: genResult.tokensUsed,
        promptTokens: genResult.promptTokens,
        responseTokens: genResult.responseTokens
      });

      // Show usage stats
      usageStats.style.display = 'block';
      usageStats.innerHTML = `
        <div class="usage-stat"><span>🤖 Model:</span><strong>${genResult.modelUsed}</strong></div>
        <div class="usage-stat"><span>� Tokens used:</span><strong>${genResult.tokensUsed.toLocaleString()}</strong></div>
        <div class="usage-stat"><span>📥 Prompt / 📤 Response:</span><strong>${genResult.promptTokens.toLocaleString()} / ${genResult.responseTokens.toLocaleString()}</strong></div>
      `;

      submitBtn.textContent = '✅ Done';

      setTimeout(() => {
        this.closeGenerateModal();
        this.renderCategoryScreen();
      }, 3000);

    } catch (err) {
      console.error('Generate failed:', err);
      statusEl.className = 'generate-status error';
      statusEl.textContent = `❌ Error: ${err.message}`;
      submitBtn.disabled = false;
      submitBtn.textContent = '🔄 Retry';
      // Log failed call
      this.logGeminiCall({
        action: 'generate_questions',
        category,
        model: selectedModel || 'unknown',
        success: false,
        errorMessage: err.message
      });
    }
  }

  async callGeminiForQuestions(category, amount, specificModel = null, generationNotes = '') {
    const systemInstruction = `Role:
You are an expert English Language Teacher and Content Creator for a specialized study app. Your goal is to generate high-quality practice questions that fit a specific database schema.

Database Schema (Supabase):
All responses must be a JSON array of objects with the following keys:

category: Must match one of the predefined categories exactly.

sentence: A sentence containing a "____" blank for the user to fill.

correct_answer: The correct word/phrase for the blank.

options: An array of 3 strings (including the correct one).

explanation: A brief, helpful explanation in English of why the answer is correct based on grammar rules.

translations: An object mapping each unique word in the sentence (lowercased, without punctuation) to its Hebrew translation. Include all meaningful words. Example: {"the": "ה", "cat": "חתול", "is": "הוא/היא", "sitting": "יושב/ת", "on": "על", "mat": "מחצלת"}

Predefined Categories & Context:

Present Simple: Focus on am/is/are, do/does, and third-person -s.

Present Continuous: Focus on am/is/are + verb-ing for actions happening now.

Past Simple: Focus on was/were, regular -ed endings, and did/didn't.

Future Simple: Focus on "will + base verb" for predictions and plans.

Vocabulary - Work: Focus on professional terms (deadline, promotion, salary, etc.).

Have / Has / Had: Focus on Present Perfect and Past Perfect structures.

Verb Endings: Focus specifically on choosing the right suffix (-s, -ed, -ing, or none).

Be / Been / Being: Focus on choosing between "be", "been", and "being" in various grammatical contexts — passive voice, perfect tenses, continuous forms, infinitives, and after prepositions.

Style Guidelines:

Tone: Professional, encouraging, and clear.

Complexity: Suitable for adult students and computer science students. Occasionally use work-related or tech-related contexts.

English Only: All content (sentence, options, explanation) must be in English.

Strict JSON: Return ONLY the JSON array. Do not include conversational text before or after the code block.`;

    // Get a few existing examples to avoid duplicates
    const existingSentences = this.questionCatalog
      .filter(q => q.category === category)
      .slice(0, 5)
      .map(q => q.sentence);

    const notesBlock = generationNotes
      ? `Additional user notes for these new sentences (follow these exactly when possible):\n${generationNotes}\n`
      : '';

    const prompt = `Generate exactly ${amount} NEW and UNIQUE quiz questions for the category "${category}".

CRITICAL: The "category" field in every object MUST be exactly "${category}" — no subcategories, no suffixes, no variations.

${existingSentences.length > 0 ? `Do NOT repeat or rephrase any of these existing questions:
${existingSentences.join('\n')}` : ''}

${notesBlock}

Return ONLY a valid JSON array with ${amount} objects. No markdown, no explanation outside the array.`;

    const body = JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 16384
      }
    });

    let response;
    let lastError;
    const statusEl = document.getElementById('generate-status');

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Build model list: use specific model if provided, otherwise available models
    const modelsToTry = specificModel
      ? [{ model: specificModel }]
      : await getAvailableModels();
    if (modelsToTry.length === 0) {
      throw new Error('Daily API quota exhausted for all models. Try again tomorrow.');
    }

    let usedModel = '';

    for (const { model } of modelsToTry) {
      const url = geminiUrl(model);

      // Try up to 3 attempts per model (with retry on 429/503)
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (statusEl) {
            statusEl.className = 'generate-status info';
            statusEl.textContent = `⏳ Trying ${model}${attempt > 1 ? ` (attempt ${attempt})` : ''}...`;
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 45000);

          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (response.ok) break;

          const errBody = await response.text();

          if (response.status === 429 || response.status === 503) {
            const retryMatch = errBody.match(/retryDelay.*?(\d+)s/i);
            const waitSec = retryMatch ? Math.min(parseInt(retryMatch[1], 10) + 3, 45) : 15;
            const failure = this.extractGeminiFailureInfo(errBody);

            if (statusEl) {
              statusEl.className = 'generate-status error';
              statusEl.textContent = this.buildGeminiRetryMessage({
                model,
                attempt,
                statusCode: response.status,
                reason: failure.reason,
                geminiText: failure.geminiText,
                nextStep: `Retrying in ${waitSec}s...`
              });
            }
            lastError = new Error(this.buildGeminiRetryMessage({
              model,
              attempt,
              statusCode: response.status,
              reason: failure.reason,
              geminiText: failure.geminiText
            }));
            await sleep(waitSec * 1000);
            response = null; // reset so we retry
            continue;
          }

          const failure = this.extractGeminiFailureInfo(errBody);
          const failMessage = this.buildGeminiRetryMessage({
            model,
            attempt,
            statusCode: response.status,
            reason: failure.reason,
            geminiText: failure.geminiText,
            nextStep: 'Trying next model...'
          });
          if (statusEl) {
            statusEl.className = 'generate-status error';
            statusEl.textContent = failMessage;
          }
          lastError = new Error(failMessage);
          response = null;
          break; // don't retry other errors, try next model
        } catch (fetchErr) {
          const reason = fetchErr.name === 'AbortError'
            ? 'Request timed out (45s).'
            : (fetchErr?.message || 'Unknown network error.');
          const failMessage = this.buildGeminiRetryMessage({
            model,
            attempt,
            reason,
            nextStep: attempt < 3 ? 'Retrying now...' : 'Trying next model...'
          });
          if (statusEl) {
            statusEl.className = 'generate-status error';
            statusEl.textContent = failMessage;
          }
          lastError = new Error(failMessage);
          response = null;
          continue;
        }
      }

      if (response && response.ok) {
        usedModel = model;
        break;
      }
    }

    if (!response || !response.ok) {
      throw lastError || new Error('All Gemini models failed. Try again in a minute.');
    }

    const rawResult = await response.text();
    let result;
    try {
      result = JSON.parse(rawResult);
    } catch {
      throw new Error(`Gemini returned invalid JSON envelope: ${this.truncateText(rawResult, 260)}`);
    }
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini.');

    // Extract token usage
    const usageMetadata = result?.usageMetadata || {};
    const promptTokens = usageMetadata.promptTokenCount || 0;
    const responseTokens = usageMetadata.candidatesTokenCount || usageMetadata.totalTokenCount || 0;
    const totalTokens = usageMetadata.totalTokenCount || (promptTokens + responseTokens);

    // Clean possible markdown code blocks
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Gemini returned non-JSON question payload: ${this.truncateText(text, 320)}`);
    }

    if (!Array.isArray(parsed)) throw new Error('Gemini did not return an array.');

    // Validate each question and normalize category
    const validQuestions = parsed
      .filter(q =>
        q.sentence && q.sentence.includes('____') &&
        q.correct_answer &&
        Array.isArray(q.options) && (q.options.length === 3 || q.options.length === 4) &&
        q.options.includes(q.correct_answer)
      )
      .map(q => ({ ...q, category })); // Force correct category

    return {
      questions: validQuestions,
      modelUsed: usedModel,
      tokensUsed: totalTokens,
      promptTokens,
      responseTokens
    };
  }

  async uploadGeneratedQuestions(questions) {
    if (!this.supabase || questions.length === 0) return [];

    const payload = questions.map(q => ({
      category: q.category,
      sentence: q.sentence,
      correct_answer: q.correct_answer,
      options: q.options,
      explanation: q.explanation || '',
      translations: q.translations || {}
    }));

    const { data, error } = await this.supabase
      .from('questions')
      .insert(payload)
      .select('id, category, sentence, correct_answer, options, explanation, translations');

    if (error) throw new Error(`Supabase insert failed: ${error.message}`);
    return data || [];
  }

  getWordsFromCategory(categoryName) {
    const categoryQuestions = this.questionCatalog.filter(q => q.category === categoryName);
    const wordsMap = new Map();

    categoryQuestions.forEach(question => {
      const translations = question.translations || {};
      Object.entries(translations).forEach(([rawWord, translation]) => {
        const word = this.normalizeWord(rawWord);
        const tr = String(translation || '').trim();
        if (!word || !tr) return;
        if (!wordsMap.has(word)) {
          wordsMap.set(word, {
            word,
            translation: tr,
            sourceCategory: categoryName
          });
        }
      });
    });

    return [...wordsMap.values()].sort((a, b) => a.word.localeCompare(b.word));
  }

  showWordPickerModal(categoryName) {
    this.wordPickerCategory = categoryName;
    const words = this.getWordsFromCategory(categoryName);

    document.getElementById('word-picker-category-name').textContent = categoryName;

    const listEl = document.getElementById('word-picker-list');
    listEl.innerHTML = '';

    if (words.length === 0) {
      listEl.innerHTML = '<div class="word-picker-empty">No translated words were found in this category yet.</div>';
      document.getElementById('word-picker-overlay').classList.add('show');
      return;
    }

    const existingKeys = new Set(
      this.vocabDeck
        .filter(item => item.sourceCategory === categoryName)
        .map(item => this.getVocabEntryKey(item))
    );

    words.forEach((item, index) => {
      const key = this.getVocabEntryKey(item);
      const row = document.createElement('label');
      row.className = 'word-picker-item';
      row.innerHTML = `
        <span class="word-picker-left">
          <input type="checkbox" class="word-picker-checkbox" data-word="${this.escapeHtml(item.word)}" data-translation="${this.escapeHtml(item.translation)}" ${existingKeys.has(key) ? 'checked' : ''}>
          <span class="word-picker-word">${this.escapeHtml(item.word)}</span>
        </span>
        <span class="word-picker-translation">${this.escapeHtml(item.translation)}</span>
      `;
      row.htmlFor = `word-picker-${index}`;
      const input = row.querySelector('.word-picker-checkbox');
      if (input) input.id = `word-picker-${index}`;
      listEl.appendChild(row);
    });

    document.getElementById('word-picker-overlay').classList.add('show');
  }

  closeWordPickerModal() {
    document.getElementById('word-picker-overlay').classList.remove('show');
    this.wordPickerCategory = null;
  }

  toggleWordPickerSelection(checked) {
    document.querySelectorAll('.word-picker-checkbox').forEach(cb => {
      cb.checked = checked;
    });
  }

  async saveWordPickerSelection() {
    if (!this.wordPickerCategory) {
      this.closeWordPickerModal();
      return;
    }

    const selected = [...document.querySelectorAll('.word-picker-checkbox:checked')].map(cb => ({
      word: this.normalizeWord(cb.dataset.word || ''),
      translation: String(cb.dataset.translation || '').trim(),
      sourceCategory: this.wordPickerCategory
    })).filter(item => item.word && item.translation);

    for (const item of selected) {
      await this.addWordToDeck(item.word, item.translation, item.sourceCategory);
    }

    this.closeWordPickerModal();
    this.renderCategoryScreen();
  }

  openFlashcardsScreen() {
    this.currentFlashcards = [...this.vocabDeck];
    this.currentFlashcardIndex = 0;
    this.flashcardShowTranslation = false;
    this.showFlashcardsPronunciationStatus('', '');

    this.showScreen('flashcards-screen');
    this.renderFlashcard();
  }

  showFlashcardsPronunciationStatus(type, message) {
    const statusEl = document.getElementById('flashcards-pronunciation-status');
    if (!statusEl) return;

    if (!type || !message) {
      statusEl.style.display = 'none';
      statusEl.className = 'generate-status';
      statusEl.textContent = '';
      return;
    }

    statusEl.style.display = 'block';
    statusEl.className = `generate-status ${type}`;
    statusEl.textContent = message;
  }

  getWordsMissingPronunciation() {
    return this.vocabDeck.filter(item => item && item.word && item.translation && !this.normalizePronunciation(item.pronunciation));
  }

  async callGeminiForPronunciations(wordItems) {
    if (!Array.isArray(wordItems) || wordItems.length === 0) {
      return { map: {}, modelUsed: '', tokensUsed: 0, promptTokens: 0, responseTokens: 0 };
    }

    const availableModels = await getAvailableModels();
    if (!availableModels.length) {
      throw new Error('No AI quota remaining today.');
    }

    const selectedModel = availableModels[0].model;
    const url = geminiUrl(selectedModel);

    const systemInstruction = `You are a Hebrew pronunciation assistant for English learners.
Return ONLY valid JSON in this exact format:
{
  "items": [
    {
      "word": "english word in lowercase",
      "pronunciation_he": "hebrew text that describes how to pronounce the english word"
    }
  ]
}
Rules:
- Hebrew letters only for pronunciation (you may include apostrophe if needed).
- Every pronunciation_he value MUST include Hebrew niqqud marks.
- Never return pronunciation without niqqud.
- Keep each pronunciation short and practical.
- Preserve the same words that the user sends.
- If uncertain, still provide the closest common pronunciation in Hebrew.
- No markdown, no extra keys, no explanations.`;

    const promptItems = wordItems.map(item => ({
      word: this.normalizeWord(item.word),
      translation: String(item.translation || '').trim()
    }));

    const body = JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: `Create Hebrew pronunciations for these words:\n${JSON.stringify(promptItems)}` }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048
      }
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errBody.substring(0, 200)}`);
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini.');

    const usageMetadata = result?.usageMetadata || {};
    const promptTokens = usageMetadata.promptTokenCount || 0;
    const responseTokens = usageMetadata.candidatesTokenCount || usageMetadata.totalTokenCount || 0;
    const totalTokens = usageMetadata.totalTokenCount || (promptTokens + responseTokens);

    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error('Gemini returned invalid pronunciation structure.');
    }

    const map = {};
    parsed.items.forEach(row => {
      const word = this.normalizeWord(row?.word || '');
      const pronunciation = this.normalizePronunciation(row?.pronunciation_he || '');
      if (!word || !pronunciation || !this.hasHebrewNiqqud(pronunciation)) return;
      map[word] = pronunciation;
    });

    return {
      map,
      modelUsed: selectedModel,
      tokensUsed: totalTokens,
      promptTokens,
      responseTokens
    };
  }

  async savePronunciationsToCloud(updates) {
    if (!this.supabase || this.supportsPronunciationColumn === false || !Array.isArray(updates) || updates.length === 0) {
      return;
    }

    for (const item of updates) {
      try {
        const pronunciation = this.normalizePronunciation(item.pronunciation);
        if (!pronunciation) continue;

        let query = this.supabase
          .from('vocab_words')
          .update({ pronunciation })
          .eq('word', this.normalizeWord(item.word))
          .eq('translation', String(item.translation || '').trim());

        if (item.id) {
          query = this.supabase
            .from('vocab_words')
            .update({ pronunciation })
            .eq('id', item.id);
        }

        const { error } = await query;
        if (error) throw error;
      } catch (error) {
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('pronunciation') && msg.includes('does not exist')) {
          this.supportsPronunciationColumn = false;
          return;
        }
      }
    }

    this.supportsPronunciationColumn = true;
  }

  async handleGeneratePronunciations() {
    const missing = this.getWordsMissingPronunciation();
    if (!missing.length) {
      this.showFlashcardsPronunciationStatus('success', 'All words already have pronunciation.');
      return;
    }

    const button = document.getElementById('flashcards-pronunciation-btn');
    if (button) {
      button.disabled = true;
      button.textContent = '⏳ Generating...';
    }

    this.showFlashcardsPronunciationStatus('info', `Sending ${missing.length} words to Gemini (with niqqud)...`);

    try {
      const result = await this.callGeminiForPronunciations(missing);
      const updates = [];

      this.vocabDeck = this.vocabDeck.map(item => {
        const key = this.normalizeWord(item.word);
        const currentPronunciation = this.normalizePronunciation(item.pronunciation);
        if (currentPronunciation) return item;

        const generated = this.normalizePronunciation(result.map[key]);
        if (!generated) return item;

        const next = { ...item, pronunciation: generated };
        updates.push(next);
        return next;
      });

      if (!updates.length) {
        this.showFlashcardsPronunciationStatus('error', 'Gemini did not return valid pronunciations with niqqud. Try again.');
        return;
      }

      this.saveVocabDeck();
      await this.savePronunciationsToCloud(updates);

      this.currentFlashcards = [...this.vocabDeck];
      this.renderFlashcard();

      this.showFlashcardsPronunciationStatus(
        'success',
        `Added pronunciation for ${updates.length}/${missing.length} words · ${result.modelUsed}`
      );

      this.saveGenerationHistory({
        action: 'generate_pronunciations',
        date: new Date().toISOString(),
        category: 'vocabulary',
        model: result.modelUsed,
        questionsGenerated: updates.length,
        tokensUsed: result.tokensUsed,
        promptTokens: result.promptTokens,
        responseTokens: result.responseTokens
      });
    } catch (error) {
      this.showFlashcardsPronunciationStatus('error', `Could not generate pronunciations: ${error.message}`);
      this.logGeminiCall({
        action: 'generate_pronunciations',
        category: 'vocabulary',
        model: 'unknown',
        success: false,
        errorMessage: error.message
      });
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = '🗣 Fill Pronunciations (AI)';
      }
    }
  }

  renderFlashcard() {
    const countEl = document.getElementById('flashcards-count');
    const cardEl = document.getElementById('flashcard');
    const toggleBtn = document.getElementById('flashcards-toggle-btn');
    const removeBtn = document.getElementById('flashcards-remove-btn');
    const prevBtn = document.getElementById('flashcards-prev-btn');
    const nextBtn = document.getElementById('flashcards-next-btn');

    if (!countEl || !cardEl || !toggleBtn || !removeBtn || !prevBtn || !nextBtn) return;

    if (!this.currentFlashcards.length) {
      countEl.textContent = '0 words selected';
      toggleBtn.disabled = true;
      removeBtn.disabled = true;
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      removeBtn.textContent = '🗑 Remove Word';
      cardEl.innerHTML = `
        <div>
          <div class="flashcard-word">No flashcards yet</div>
          <span class="flashcard-meta">Click any translated word in a question and add it to practice.</span>
        </div>
      `;
      return;
    }

    toggleBtn.disabled = false;
    removeBtn.disabled = false;
    prevBtn.disabled = false;
    nextBtn.disabled = false;

    const total = this.currentFlashcards.length;
    const current = this.currentFlashcardIndex + 1;
    const item = this.currentFlashcards[this.currentFlashcardIndex];
    countEl.textContent = `${current} / ${total}`;
    removeBtn.textContent = `🗑 Remove "${item.word}"`;

    if (this.flashcardShowTranslation) {
      cardEl.innerHTML = `
        <div>
          <div class="flashcard-translation">${this.escapeHtml(item.translation)}</div>
          <span class="flashcard-meta">${this.escapeHtml(item.word)} · ${this.escapeHtml(item.sourceCategory)}</span>
          <span class="flashcard-pronunciation">🗣 ${this.escapeHtml(item.pronunciation || 'אין הגייה עדיין')}</span>
        </div>
      `;
      toggleBtn.textContent = 'Show Word';
    } else {
      cardEl.innerHTML = `
        <div>
          <div class="flashcard-word">${this.escapeHtml(item.word)}</div>
          <span class="flashcard-pronunciation">🗣 ${this.escapeHtml(item.pronunciation || 'אין הגייה עדיין')}</span>
          <span class="flashcard-meta">${this.escapeHtml(item.sourceCategory)}</span>
        </div>
      `;
      toggleBtn.textContent = 'Show Translation';
    }
  }

  toggleFlashcardTranslation() {
    if (!this.currentFlashcards.length) return;
    this.flashcardShowTranslation = !this.flashcardShowTranslation;
    this.renderFlashcard();
  }

  showNextFlashcard() {
    if (!this.currentFlashcards.length) return;
    this.currentFlashcardIndex = (this.currentFlashcardIndex + 1) % this.currentFlashcards.length;
    this.flashcardShowTranslation = false;
    this.renderFlashcard();
  }

  showPreviousFlashcard() {
    if (!this.currentFlashcards.length) return;
    this.currentFlashcardIndex = (this.currentFlashcardIndex - 1 + this.currentFlashcards.length) % this.currentFlashcards.length;
    this.flashcardShowTranslation = false;
    this.renderFlashcard();
  }

  async removeCurrentFlashcardWord() {
    if (!this.currentFlashcards.length) return;

    const item = this.currentFlashcards[this.currentFlashcardIndex];
    const confirmed = window.confirm(`Remove "${item.word}" from practice words?`);
    if (!confirmed) return;

    await this.removeWordFromDeck(item);
    this.currentFlashcards = [...this.vocabDeck];

    if (this.currentFlashcardIndex >= this.currentFlashcards.length) {
      this.currentFlashcardIndex = Math.max(0, this.currentFlashcards.length - 1);
    }

    this.flashcardShowTranslation = false;
    this.renderFlashcard();
  }

  showManualWordModal() {
    const wordInput = document.getElementById('manual-word-input');
    const translationInput = document.getElementById('manual-translation-input');
    const pronunciationInput = document.getElementById('manual-pronunciation-input');
    const statusEl = document.getElementById('manual-word-status');
    const saveBtn = document.getElementById('manual-word-save-btn');

    if (!wordInput || !translationInput || !pronunciationInput || !statusEl || !saveBtn) return;

    wordInput.value = '';
    translationInput.value = '';
    pronunciationInput.value = '';
    statusEl.style.display = 'none';
    statusEl.className = 'generate-status';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Word';

    document.getElementById('manual-word-overlay').classList.add('show');
    setTimeout(() => wordInput.focus(), 50);
  }

  closeManualWordModal() {
    const overlay = document.getElementById('manual-word-overlay');
    if (overlay) overlay.classList.remove('show');
  }

  async handleManualWordSave() {
    const wordInput = document.getElementById('manual-word-input');
    const translationInput = document.getElementById('manual-translation-input');
    const pronunciationInput = document.getElementById('manual-pronunciation-input');
    const statusEl = document.getElementById('manual-word-status');
    const saveBtn = document.getElementById('manual-word-save-btn');

    if (!wordInput || !translationInput || !pronunciationInput || !statusEl || !saveBtn) return;

    const word = wordInput.value.trim();
    const translation = translationInput.value.trim();
    const pronunciation = pronunciationInput.value.trim();

    if (!word || !translation) {
      statusEl.style.display = 'block';
      statusEl.className = 'generate-status error';
      statusEl.textContent = 'Please enter both the word and its translation.';
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    statusEl.style.display = 'block';
    statusEl.className = 'generate-status info';
    statusEl.textContent = 'Saving word...';

    const result = await this.addWordToDeck(word, translation, 'Manual', pronunciation);

    if (result.added) {
      statusEl.className = 'generate-status success';
      statusEl.textContent = result.syncedToCloud ? '✅ Word saved.' : '✅ Word saved locally (cloud unavailable).';
      this.currentFlashcards = [...this.vocabDeck];
      this.currentFlashcardIndex = 0;
      this.flashcardShowTranslation = false;
      this.renderFlashcard();
      setTimeout(() => this.closeManualWordModal(), 500);
      return;
    }

    if (result.reason === 'exists') {
      statusEl.className = 'generate-status info';
      statusEl.textContent = 'This word already exists in your practice list.';
    } else {
      statusEl.className = 'generate-status error';
      statusEl.textContent = 'Could not save the word. Please try again.';
    }

    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Word';
  }

  async deleteCategory(categoryName) {
    const confirmed = window.confirm(`Delete category "${categoryName}"?\nThis will remove all questions and grammar rules in this category.`);
    if (!confirmed) return;

    if (this.supabase) {
      try {
        const { error: questionsError } = await this.supabase
          .from('questions')
          .delete()
          .eq('category', categoryName);
        if (questionsError) throw questionsError;

        const { error: rulesError } = await this.supabase
          .from('grammar_rules')
          .delete()
          .eq('category', categoryName);
        if (rulesError) throw rulesError;
      } catch (error) {
        console.error('Failed to delete category from cloud', error);
        window.alert(`Could not delete category from cloud: ${error.message}`);
        return;
      }
    }

    const deletedIds = this.questionCatalog
      .filter(q => q.category === categoryName)
      .map(q => q.id);

    this.questionCatalog = this.questionCatalog.filter(q => q.category !== categoryName);
    this.remainingQuestionSet = new Set(this.remainingQuestionIds.filter(id => !deletedIds.includes(id)));
    this.remainingQuestionIds = [...this.remainingQuestionSet];
    this.saveQuestionPool();

    delete this.grammarRules[categoryName];
    delete this.progress[categoryName];
    localStorage.setItem('english-app-progress', JSON.stringify(this.progress));

    this.categories = this.getCategories();
    this.renderCategoryScreen();
  }

  handleBack() {
    if (this.results.length === 0) {
      this.goToCategories();
    } else {
      document.getElementById('confirm-overlay').classList.add('show');
    }
  }

  confirmBack() {
    this.closeConfirm();
    this.goToCategories();
  }

  closeConfirm() {
    document.getElementById('confirm-overlay').classList.remove('show');
  }

  showGrammarRules() {
    const q = this.questions[this.currentQuestionIndex];
    if (q) this.showGrammarRulesForCategory(q.category);
  }

  showGrammarRulesForCategory(categoryName) {
    const rules = this.grammarRules[categoryName];
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');

    if (!rules) {
      modalTitle.textContent = categoryName;
      modalBody.innerHTML = `<p style="text-align:center; color: var(--text-muted);">No grammar rules available for this category yet.</p>`;
    } else {
      modalTitle.innerHTML = `${rules.icon} ${rules.title}`;
      modalBody.innerHTML = rules.rules.map(rule => `
        <div class="grammar-rule-section">
          <h3>${rule.heading}</h3>
          <div class="rule-content">${rule.content}</div>
        </div>
      `).join('');
    }

    document.getElementById('modal-overlay').classList.add('show');
  }

  closeModal() {
    document.getElementById('modal-overlay').classList.remove('show');
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  }

  updateStreakDisplay() {
    const el = document.getElementById('streak-display');
    if (this.streak >= 2) {
      el.textContent = `🔥 ${this.streak} Streak!`;
      el.style.opacity = '1';
      el.classList.toggle('on-fire', this.streak >= 5);
    } else {
      el.style.opacity = '0';
    }
  }

  shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  launchConfetti() {
    const colors = ['#4f46e5', '#16a34a', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];
    for (let i = 0; i < 50; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 2 + 's';
      piece.style.animationDuration = (2 + Math.random() * 2) + 's';
      piece.style.width = (6 + Math.random() * 8) + 'px';
      piece.style.height = (6 + Math.random() * 8) + 'px';
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 5000);
    }
  }
}

// ─── Initialize App ─────────────────────────
var app;

function initEnglishApp() {
  if (window.app) return true;
  try {
    app = new EnglishLearningApp();
    window.app = app;
    return true;
  } catch (error) {
    const existing = document.getElementById('runtime-error-banner');
    if (!existing) {
      const banner = document.createElement('div');
      banner.id = 'runtime-error-banner';
      banner.style.position = 'fixed';
      banner.style.left = '10px';
      banner.style.right = '10px';
      banner.style.bottom = '10px';
      banner.style.background = '#fee2e2';
      banner.style.border = '1px solid #fca5a5';
      banner.style.color = '#991b1b';
      banner.style.padding = '10px 12px';
      banner.style.borderRadius = '10px';
      banner.style.zIndex = '9999';
      banner.style.fontSize = '13px';
      banner.textContent = `Runtime error: ${error.message}`;
      document.body.appendChild(banner);
    }
    return false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEnglishApp);
} else {
  initEnglishApp();
}

window.addEventListener('load', initEnglishApp);

window.quizBack = function quizBack() {
  if (!window.app) {
    const ok = initEnglishApp();
    if (!ok) return;
  }
  window.app.handleBack();
};

window.quizRules = function quizRules() {
  if (!window.app) {
    const ok = initEnglishApp();
    if (!ok) return;
  }
  window.app.showGrammarRules();
};

window.quizNext = function quizNext() {
  if (!window.app) {
    const ok = initEnglishApp();
    if (!ok) return;
  }
  window.app.nextQuestion();
};

window.quizRefresh = function quizRefresh() {
  if (!window.app) {
    const ok = initEnglishApp();
    if (!ok) return;
  }
  window.app.refreshCurrentQuiz();
};
