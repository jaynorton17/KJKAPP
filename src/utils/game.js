/**
 * @typedef {import('../types').PlayerId} PlayerId
 * @typedef {import('../types').QuestionTemplate} QuestionTemplate
 * @typedef {import('../types').RoundResult} RoundResult
 * @typedef {import('../types').GameSettings} GameSettings
 * @typedef {import('../types').RoundType} RoundType
 */

export const SCHEMA_VERSION = 6;

export const PLAYERS = [
  { id: 'jay', name: 'Jay' },
  { id: 'kim', name: 'Kim' },
];

export const PLAYER_LABEL = {
  jay: 'Jay',
  kim: 'Kim',
  tie: 'Tie',
};

export const ROUND_TYPES = [
  { id: 'numeric', label: 'Numeric', shortLabel: 'Numeric' },
  { id: 'multipleChoice', label: 'Multiple Choice', shortLabel: 'Multiple Choice' },
  { id: 'trueFalse', label: 'True or False', shortLabel: 'True / False' },
  { id: 'text', label: 'Text Answer', shortLabel: 'Text Answer' },
  { id: 'sortIntoOrder', label: 'Sort Into Order', shortLabel: 'Sort Into Order' },
  { id: 'preference', label: 'Preference / This-or-That', shortLabel: 'Preference' },
  { id: 'favourite', label: 'Favourite', shortLabel: 'Favourite' },
  { id: 'petPeeve', label: 'Pet Peeve', shortLabel: 'Pet Peeve' },
  { id: 'ranked', label: 'Ranked / Top 3', shortLabel: 'Ranked / Top 3' },
  { id: 'manual', label: 'Manual / Custom', shortLabel: 'Manual / Custom' },
];

export const ROUND_TYPE_LABEL = Object.fromEntries(ROUND_TYPES.map((type) => [type.id, type.shortLabel]));

export const TEXT_ROUND_TYPES = new Set([
  'favourite',
  'petPeeve',
  'preference',
  'ranked',
  'sortIntoOrder',
  'manual',
  'multipleChoice',
  'trueFalse',
  'text',
]);

export const ANSWER_MASK = 'Answered';
export const DEFAULT_TRUE_FALSE_OPTIONS = ['True', 'False'];

export const SCORING_MODES = [
  { id: 'direct_penalty_entry', label: 'Direct Penalty Entry' },
  { id: 'assisted_numeric', label: 'Assisted Numeric Mode' },
  { id: 'fixed_penalty_outcome', label: 'Fixed Penalty Outcome' },
  { id: 'manual_outcome', label: 'Manual Outcome Mode' },
];

export const SCORING_OUTCOME_TYPES = [
  { id: 'direct_manual', label: 'Direct Manual' },
  { id: 'closest_gets_zero_other_gets_fixed_penalty', label: 'Closest Gets 0 / Other Gets Fixed Penalty' },
  { id: 'exact_match_else_fixed_penalty', label: 'Exact Match Else Fixed Penalty' },
  { id: 'winner_gets_zero_loser_gets_fixed_penalty', label: 'Winner 0 / Loser Fixed Penalty' },
  { id: 'split_penalty', label: 'Split Penalty' },
  { id: 'custom', label: 'Custom' },
];

const CATEGORY_NAMES = [
  'Sexual',
  'Relationships',
  'Dating',
  'Romance',
  'Food & Drink',
  'Travel',
  'Sports',
  'Fitness',
  'Health & Wellness',
  'Music',
  'Films & TV',
  'Celebrities',
  'Fashion & Style',
  'Shopping',
  'Money',
  'Work & Career',
  'Childhood',
  'Family',
  'Friends',
  'Home',
  'Habits',
  'Social Media',
  'Technology',
  'Cars & Driving',
  'Nightlife',
  'Holidays',
  'Future / Goals',
  'Opinions',
  'Personality',
  'Embarrassing Moments',
  'Pet Peeves',
  'Favorites',
  'General Knowledge About Me',
  'Lifestyle',
  'Hypotheticals',
  'Memories',
  'Random / Wildcard',
];

const CATEGORY_COLORS = [
  '#ff3158',
  '#f15bb5',
  '#00f5d4',
  '#ffd166',
  '#4cc9f0',
  '#a855f7',
  '#fb7185',
  '#fee440',
  '#38bdf8',
  '#22c55e',
];

export const DEFAULT_CATEGORIES = CATEGORY_NAMES.map((name, index) => ({
  id: `category-${index + 1}`,
  name,
  color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
}));

export const STARTER_QUESTIONS = [
  {
    question: 'What is your favourite takeaway order?',
    category: 'Food & Drink',
    roundType: 'favourite',
    tags: ['favourites', 'takeaway'],
    fixedPenalty: 5,
    notes: 'Exact match is 0. Use manual override for close enough guesses.',
  },
  {
    question: 'What is your biggest food pet peeve?',
    category: 'Pet Peeves',
    roundType: 'petPeeve',
    tags: ['food', 'annoyances'],
    fixedPenalty: 5,
  },
  {
    question: 'Tea or coffee?',
    category: 'Food & Drink',
    roundType: 'preference',
    tags: ['this-or-that', 'drinks'],
    fixedPenalty: 3,
  },
  {
    question: 'Top 3 dream travel destinations',
    category: 'Travel',
    roundType: 'ranked',
    tags: ['holidays', 'top-3'],
    fixedPenalty: 2,
  },
  {
    question: 'How many countries have you visited?',
    category: 'Travel',
    roundType: 'numeric',
    tags: ['travel', 'count'],
    unitLabel: 'countries',
    scoringDivisor: 1,
  },
  {
    question: 'What is your favourite sports team?',
    category: 'Sports',
    roundType: 'favourite',
    tags: ['sports', 'favourites'],
    fixedPenalty: 5,
  },
  {
    question: 'How many live sports matches have you been to?',
    category: 'Sports',
    roundType: 'numeric',
    tags: ['sports', 'events'],
    unitLabel: 'matches',
    scoringDivisor: 1,
  },
  {
    question: 'What is your favourite holiday destination?',
    category: 'Travel',
    roundType: 'favourite',
    tags: ['holidays', 'favourites'],
    fixedPenalty: 5,
  },
  {
    question: 'What is your biggest pet peeve when driving?',
    category: 'Cars & Driving',
    roundType: 'petPeeve',
    tags: ['driving', 'annoyances'],
    fixedPenalty: 5,
  },
  {
    question: 'Beach or city break?',
    category: 'Holidays',
    roundType: 'preference',
    tags: ['this-or-that', 'travel'],
    fixedPenalty: 3,
  },
  {
    question: 'How much have you spent on clothes in the last 12 months?',
    category: 'Shopping',
    roundType: 'numeric',
    tags: ['money', 'fashion'],
    unitLabel: 'pounds',
    scoringDivisor: 10,
  },
  {
    question: 'What is your favourite thing about Jay and Kim together?',
    category: 'Relationships',
    roundType: 'favourite',
    tags: ['romance', 'couple'],
    fixedPenalty: 5,
  },
  {
    question: 'What personality trait gets you into trouble most often?',
    category: 'Personality',
    roundType: 'favourite',
    tags: ['personality', 'self-knowledge'],
    fixedPenalty: 5,
  },
  {
    question: 'What is your boldest sexual preference or fantasy category?',
    category: 'Sexual',
    roundType: 'manual',
    tags: ['private', 'adult'],
    fixedPenalty: 5,
    notes: 'Use manual points if the host wants nuance.',
  },
  {
    question: 'Night out or night in?',
    category: 'Nightlife',
    roundType: 'preference',
    tags: ['this-or-that'],
    fixedPenalty: 3,
  },
  {
    question: 'Top 3 favourite foods',
    category: 'Favorites',
    roundType: 'ranked',
    tags: ['food', 'top-3'],
    fixedPenalty: 2,
  },
  {
    question: 'What is your most embarrassing memory that still makes you cringe?',
    category: 'Embarrassing Moments',
    roundType: 'manual',
    tags: ['memories'],
    fixedPenalty: 5,
  },
  {
    question: 'How many hours a week do you spend on social media?',
    category: 'Social Media',
    roundType: 'numeric',
    tags: ['habits'],
    unitLabel: 'hours',
    scoringDivisor: 1,
  },
].map((question, index) => ({
  ...question,
  id: `starter-${index + 1}`,
  source: 'starter',
}));

export const PALETTES = [
  {
    name: 'Stars & Stripes',
    accent: '#ff355d',
    accent2: '#2d5bff',
    accent3: '#ffffff',
    glow: 'rgba(45, 91, 255, 0.28)',
    wash: 'rgba(45, 91, 255, 0.08)',
  },
  {
    name: 'Union Jack',
    accent: '#0f3cff',
    accent2: '#ff355d',
    accent3: '#f8fbff',
    glow: 'rgba(255, 53, 93, 0.28)',
    wash: 'rgba(255, 53, 93, 0.08)',
  },
  {
    name: 'Midnight Victory',
    accent: '#ffffff',
    accent2: '#ff355d',
    accent3: '#2d5bff',
    glow: 'rgba(255, 255, 255, 0.24)',
    wash: 'rgba(255, 255, 255, 0.06)',
  },
  {
    name: 'Navy Club',
    accent: '#ff355d',
    accent2: '#ffffff',
    accent3: '#2d5bff',
    glow: 'rgba(255, 53, 93, 0.26)',
    wash: 'rgba(255, 53, 93, 0.06)',
  },
];

export const CATEGORY_COLOR_MAP = {
  Sexual: '#ff4d6d',
  Relationships: '#3b82f6',
  Travel: '#22c55e',
  'Food & Drink': '#f59e0b',
  Music: '#8b5cf6',
  'Films & TV': '#ec4899',
  Lifestyle: '#14b8a6',
  Sports: '#ef4444',
  'Health & Wellness': '#10b981',
  'Fashion & Style': '#6366f1',
  Memories: '#f97316',
  'Hypotheticals': '#84cc16',
  'Cars & Driving': '#06b6d4',
  'Random / Wildcard': '#eab308',
  'Pet Peeves': '#a855f7',
  Nightlife: '#d946ef',
  Childhood: '#0ea5e9',
  'Future / Goals': '#f43f5e',
  Money: '#64748b',
  'General Knowledge About Me': '#9333ea',
};

const LEGACY_DEFAULT_GOOGLE_SHEET = {
  input: 'https://docs.google.com/spreadsheets/d/19vPN5Kuu5nUM5PyXlC4eW3NcMhpvrszYbJvGt7F2vZo/edit?usp=sharing',
  id: '19vPN5Kuu5nUM5PyXlC4eW3NcMhpvrszYbJvGt7F2vZo',
  gid: '',
};

const DEFAULT_GOOGLE_SHEET = {
  input: 'https://docs.google.com/spreadsheets/d/1uWV1v1uVv_SzVUYlLaJ01A5ymT8y1BuN/edit?gid=1585986873#gid=1585986873',
  id: '1uWV1v1uVv_SzVUYlLaJ01A5ymT8y1BuN',
  gid: '1585986873',
};

export const DEFAULT_SETTINGS = {
  gameMode: 'standard',
  selectedCategory: '',
  selectedTag: '',
  selectedRoundType: '',
  allowRepeats: false,
  unusedOnly: true,
  skipDuplicates: true,
  allowDecimals: false,
  integerScores: true,
  requireNotes: false,
  lockDivisorFromTemplate: false,
  editableDivisorBeforeSave: true,
  googleSheetInput: DEFAULT_GOOGLE_SHEET.input,
  googleSheetId: DEFAULT_GOOGLE_SHEET.id,
  googleSheetGid: DEFAULT_GOOGLE_SHEET.gid,
  googleSheetConnectedAt: null,
  googleSheetLastSyncedAt: null,
  googleSheetOverwriteExisting: false,
};

export const emptyTotals = () => ({ jay: 0, kim: 0 });

export const makeId = (prefix = 'id') => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const roundTo = (value, places = 3) => {
  const factor = 10 ** places;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
};

export const addScores = (a, b) => roundTo(Number(a || 0) + Number(b || 0), 3);

export const parseNumber = (value, fallback = 0) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[£$,%]/g, '')
    .replace(/,/g, '');
  if (!cleaned) return fallback;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const toScore = (value) => {
  const parsed = parseNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) {
    throw new Error('Penalty values must be valid numbers.');
  }
  return roundTo(parsed, 3);
};

export const normalizeText = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

export const normalizeQuestionKey = (value) => normalizeText(value).toLowerCase();
export const normalizeQuestionCategoryKey = (question, category = '') =>
  `${normalizeQuestionKey(question)}::${normalizeText(category).toLowerCase()}`;

export const matchesQuestionTemplate = (existingQuestion, candidateQuestion) => {
  const existingId = normalizeText(existingQuestion?.id).toLowerCase();
  const candidateId = normalizeText(candidateQuestion?.id).toLowerCase();
  if (existingId && candidateId && existingId === candidateId) return true;

  const existingQuestionKey = normalizeQuestionKey(existingQuestion?.question);
  const candidateQuestionKey = normalizeQuestionKey(candidateQuestion?.question);
  const existingCategoryKey = normalizeQuestionCategoryKey(existingQuestion?.question, existingQuestion?.category);
  const candidateCategoryKey = normalizeQuestionCategoryKey(candidateQuestion?.question, candidateQuestion?.category);
  if (existingCategoryKey && candidateCategoryKey && existingCategoryKey === candidateCategoryKey) {
    return normalizeRoundType(existingQuestion?.roundType) === normalizeRoundType(candidateQuestion?.roundType);
  }

  return Boolean(
    existingQuestionKey &&
      candidateQuestionKey &&
      existingQuestionKey === candidateQuestionKey &&
      normalizeRoundType(existingQuestion?.roundType) === normalizeRoundType(candidateQuestion?.roundType),
  );
};

export const findMatchingQuestion = (questions = [], candidateQuestion) =>
  questions.find((question) => matchesQuestionTemplate(question, candidateQuestion)) || null;

export const parseTags = (value) => {
  if (Array.isArray(value)) {
    return value.map((tag) => normalizeText(tag)).filter(Boolean);
  }
  return String(value || '')
    .split(/[|,;]/)
    .map((tag) => normalizeText(tag))
    .filter(Boolean);
};

export const normalizeRoundType = (value) => {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['favorite', 'favourite', 'favourites', 'favorites'].includes(raw)) return 'favourite';
  if (['petpeeve', 'petpeeves', 'peeve'].includes(raw)) return 'petPeeve';
  if (['preference', 'thisorthat', 'preferencethisorthat', 'choice'].includes(raw)) return 'preference';
  if (
    [
      'truefalse',
      'trueorfalse',
      'truefalsequestion',
      'trueorfalsequestion',
      'binary',
      'yesno',
      'yesorno',
      'boolean',
      'bool',
      'tf',
      'tfquestion',
    ].includes(raw)
    || raw.startsWith('truefalse')
    || raw.startsWith('trueorfalse')
    || raw.startsWith('boolean')
  ) {
    return 'trueFalse';
  }
  if (['sortintoorder', 'sorting', 'ordering', 'sequence', 'sequenceordering', 'sortorder', 'matchpair', 'matchthepair', 'matching'].includes(raw)) {
    return 'sortIntoOrder';
  }
  if (['ranked', 'top3', 'topthree', 'rankedtop3', 'multianswer', 'multi'].includes(raw)) return 'ranked';
  if (['manual', 'custom', 'manualcustom'].includes(raw)) return 'manual';
  if (['multiplechoice', 'multiple', 'mcq', 'multiselect'].includes(raw)) return 'multipleChoice';
  if (['text', 'textanswer', 'written', 'exactmatch'].includes(raw)) return 'text';
  if (['closestwins', 'closest'].includes(raw)) return 'numeric';
  return 'numeric';
};

export const isNumericRoundType = (roundType) => normalizeRoundType(roundType) === 'numeric';
export const isListRoundType = (roundType) => {
  const normalizedRoundType = normalizeRoundType(roundType);
  return normalizedRoundType === 'ranked' || normalizedRoundType === 'sortIntoOrder';
};
export const isChoiceRoundType = (roundType) => {
  const normalizedRoundType = normalizeRoundType(roundType);
  return normalizedRoundType === 'multipleChoice' || normalizedRoundType === 'trueFalse';
};
export const isSingleAnswerRoundType = (roundType) => {
  const normalizedRoundType = normalizeRoundType(roundType);
  return normalizedRoundType === 'text' || isChoiceRoundType(normalizedRoundType);
};
export const isPairedTextRoundType = (roundType) =>
  !isNumericRoundType(roundType) && !isListRoundType(roundType) && !isSingleAnswerRoundType(roundType);

export const getDefaultAnswerType = (roundType) => {
  const normalizedRoundType = normalizeRoundType(roundType);
  if (isChoiceRoundType(normalizedRoundType)) return 'multipleChoice';
  if (normalizedRoundType === 'text') return 'text';
  if (isListRoundType(normalizedRoundType)) return 'ranked';
  if (normalizedRoundType === 'numeric') return 'number';
  return 'pairedText';
};

export const normalizeAnswerType = (value, roundType = 'numeric') => {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!raw) return getDefaultAnswerType(roundType);
  if (raw === 'multiplechoice' || raw === 'mcq') return 'multipleChoice';
  if (raw === 'text') return 'text';
  if (raw === 'ranked') return 'ranked';
  if (raw === 'pairedtext' || raw === 'pairtext') return 'pairedText';
  if (raw === 'number' || raw === 'currency' || raw === 'percentage' || raw === 'count' || raw === 'time' || raw === 'custom') {
    return raw;
  }
  return getDefaultAnswerType(roundType);
};

export const getDefaultScoringMode = (roundType) =>
  normalizeRoundType(roundType) === 'numeric' ? 'assisted_numeric' : 'direct_penalty_entry';

export const normalizeScoringMode = (value, roundType = 'numeric') => {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!raw) return getDefaultScoringMode(roundType);
  if (raw === 'directpenaltyentry' || raw === 'directmanual') return 'direct_penalty_entry';
  if (raw === 'assistednumeric' || raw === 'numericassistant' || raw === 'assistant') return 'assisted_numeric';
  if (raw === 'fixedpenaltyoutcome' || raw === 'fixedoutcome') return 'fixed_penalty_outcome';
  if (raw === 'manualoutcome' || raw === 'manualmode') return 'manual_outcome';
  return getDefaultScoringMode(roundType);
};

export const getDefaultScoringOutcomeType = (roundType) => {
  const normalizedRoundType = normalizeRoundType(roundType);
  if (normalizedRoundType === 'numeric') return 'custom';
  if (isListRoundType(normalizedRoundType)) return 'custom';
  if (isChoiceRoundType(normalizedRoundType) || normalizedRoundType === 'text') return 'exact_match_else_fixed_penalty';
  return 'direct_manual';
};

export const normalizeScoringOutcomeType = (value, roundType = 'numeric') => {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!raw) return getDefaultScoringOutcomeType(roundType);
  if (raw === 'directmanual') return 'direct_manual';
  if (raw === 'closestgetszeroothergetsfixedpenalty' || raw === 'closestwins') {
    return 'closest_gets_zero_other_gets_fixed_penalty';
  }
  if (raw === 'exactmatchelsefixedpenalty' || raw === 'exactmatch') return 'exact_match_else_fixed_penalty';
  if (raw === 'winnergetszerolosergetsfixedpenalty' || raw === 'winnerloserfixed') {
    return 'winner_gets_zero_loser_gets_fixed_penalty';
  }
  if (raw === 'splitpenalty') return 'split_penalty';
  if (raw === 'custom') return 'custom';
  return getDefaultScoringOutcomeType(roundType);
};

export const isAnsweredValue = (value) => normalizeText(value).toLowerCase() === ANSWER_MASK.toLowerCase();

export const isHiddenAnswerType = (answerType, roundType = 'numeric') => {
  const normalized = normalizeAnswerType(answerType, roundType);
  return normalized === 'text' || normalized === 'multipleChoice';
};

export const getRoundAnswerType = (round) => normalizeAnswerType(round?.answerType, round?.roundType);

export const getMaskedAnswerValue = (value, answerType, roundType, adminMode = false) => {
  const normalized = normalizeText(value);
  if (!normalized) return '-';
  if (adminMode || !isHiddenAnswerType(answerType, roundType)) {
    return isAnsweredValue(normalized) ? ANSWER_MASK : normalized;
  }
  return ANSWER_MASK;
};

const toRoundScore = (value) => roundTo(parseNumber(value, 0), 3);

export const getRoundPenaltyMap = (round = {}) => ({
  jay: toRoundScore(round?.penaltyAdded?.jay ?? round?.scores?.jay ?? round?.jayScore ?? 0),
  kim: toRoundScore(round?.penaltyAdded?.kim ?? round?.scores?.kim ?? round?.kimScore ?? 0),
});

export const getRoundPenalty = (round, playerId) => getRoundPenaltyMap(round)[playerId];

export const getRoundPenaltyValue = (round = {}) =>
  Math.max(0, parseNumber(round.roundPenaltyValue ?? round.fixedPenalty ?? round.penalty, 5));

export const getRoundPenaltyTotals = (round = {}) =>
  round.totalsAfterRound || round.totalPenaltyAfterRound || emptyTotals();

export const createCategory = (input, index = 0) => {
  if (typeof input === 'string') {
    return {
      id: `category-${normalizeText(input).toLowerCase().replace(/[^a-z0-9]+/g, '-') || makeId('category')}`,
      name: normalizeText(input),
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    };
  }

  const name = normalizeText(input?.name);
  return {
    id: input?.id || `category-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || makeId('category')}`,
    name,
    color: normalizeText(input?.color) || CATEGORY_COLORS[index % CATEGORY_COLORS.length],
  };
};

export const mergeCategories = (...categoryLists) => {
  const byName = new Map();
  categoryLists.flat().filter(Boolean).forEach((category, index) => {
    const normalized = createCategory(category, index);
    const key = normalized.name.toLowerCase();
    if (normalized.name && !byName.has(key)) byName.set(key, normalized);
  });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const normalizeRoundingMode = (value) => {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'floor' || mode === 'ceil' || mode === 'nearest') return mode;
  if (mode === 'round') return 'nearest';
  return 'nearest';
};

export const createQuestionTemplate = (input = {}) => {
  const now = new Date().toISOString();
  const question = normalizeText(input.question ?? input.text ?? input.title);
  const roundType = normalizeRoundType(input.roundType ?? input.type);
  const roundPenaltyValue = Math.max(0, parseNumber(input.roundPenaltyValue ?? input.fixedPenalty ?? input.penalty, roundType === 'preference' ? 3 : 5));
  const defaultAnswerType = normalizeAnswerType(input.defaultAnswerType, roundType);
  const multipleChoiceOptions = parseAnswerList(input.multipleChoiceOptions ?? input.options);
  const normalizedOptions = roundType === 'trueFalse' && !multipleChoiceOptions.length ? DEFAULT_TRUE_FALSE_OPTIONS : multipleChoiceOptions;
  const bankType = normalizeText(input.bankType).toLowerCase() === 'quiz' ? 'quiz' : 'game';
  const correctAnswer = normalizeText(input.correctAnswer || '');
  const normalizedCorrectAnswer = normalizeText(input.normalizedCorrectAnswer || '')
    || normalizeText(correctAnswer).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const stableId =
    input.id ||
    `question-${normalizeQuestionKey(question)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')}-${normalizeText(input.category).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'uncategorised'}-${roundType}`;

  return {
    id: stableId || makeId('question'),
    question,
    roundType,
    category: normalizeText(input.category),
    tags: parseTags(input.tags),
    unitLabel: normalizeText(input.unitLabel ?? input.unit ?? input.units),
    scoringDivisor: Math.max(0.000001, parseNumber(input.scoringDivisor ?? input.divisor, 1) || 1),
    roundingMode: normalizeRoundingMode(input.roundingMode ?? input.rounding),
    roundPenaltyValue,
    fixedPenalty: roundPenaltyValue,
    scoringMode: normalizeScoringMode(input.scoringMode, roundType),
    scoringOutcomeType: normalizeScoringOutcomeType(input.scoringOutcomeType, roundType),
    notes: normalizeText(input.notes),
    defaultAnswerType,
    answerType: normalizeAnswerType(input.answerType ?? defaultAnswerType, roundType),
    multipleChoiceOptions: normalizedOptions,
    source: normalizeText(input.source) || 'manual',
    sourceLabel: normalizeText(input.sourceLabel ?? input.importSourceLabel ?? input.sourceNote ?? input.originLabel),
    addedBy: normalizeText(input.addedBy ?? input.sourceAddedBy ?? input.author),
    importedFromGoogleSheet: Boolean(input.importedFromGoogleSheet ?? input.fromGoogleSheet),
    bankType,
    correctAnswer,
    normalizedCorrectAnswer,
    importDate:
      typeof input.importDate === 'string' && !Number.isNaN(Date.parse(input.importDate))
        ? input.importDate
        : null,
    used: Boolean(input.used),
    timesPlayed: Math.max(0, Number.parseInt(input.timesPlayed || 0, 10) || 0),
    lastPlayedAt:
      typeof input.lastPlayedAt === 'string' && !Number.isNaN(Date.parse(input.lastPlayedAt))
        ? input.lastPlayedAt
        : null,
    createdAt:
      typeof input.createdAt === 'string' && !Number.isNaN(Date.parse(input.createdAt))
        ? input.createdAt
        : now,
    updatedAt: now,
  };
};

const normalizeAnswer = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const parseAnswerList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  return String(value || '')
    .split(/\n|,|;/)
    .map((item) => item.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean);
};

export const calculateTextMatchScore = ({
  actualAnswer,
  guess,
  fixedPenalty = 5,
  manualScore,
  manualScores = false,
}) => {
  if (manualScores) return toScore(manualScore || 0);
  const actual = normalizeAnswer(actualAnswer);
  const guessed = normalizeAnswer(guess);
  if (!actual && !guessed) return 0;
  return actual && guessed && actual === guessed ? 0 : Math.max(0, parseNumber(fixedPenalty, 5));
};

export const calculateRankedScore = ({
  actualList,
  guessedList,
  fixedPenalty = 2,
  manualScore,
  manualScores = false,
}) => {
  if (manualScores) return toScore(manualScore || 0);
  const actual = parseAnswerList(actualList).map(normalizeAnswer).filter(Boolean);
  const guesses = parseAnswerList(guessedList).map(normalizeAnswer).filter(Boolean);
  const slots = Math.max(3, actual.length, guesses.length);
  const matches = guesses.filter((guess, index) => actual.includes(guess) && guesses.indexOf(guess) === index).length;
  return Math.max(0, slots - matches) * Math.max(0, parseNumber(fixedPenalty, 2));
};

export const calculateScore = ({
  actualAnswer,
  guess,
  divisor = 1,
  roundingMode = 'nearest',
  allowDecimals = false,
  integerScores = true,
}) => {
  const actual = parseNumber(actualAnswer, Number.NaN);
  const guessed = parseNumber(guess, Number.NaN);
  const safeDivisor = Math.max(0.000001, parseNumber(divisor, 1) || 1);

  if (!Number.isFinite(actual) || !Number.isFinite(guessed)) {
    throw new Error('Actual answer and guesses must be valid numbers.');
  }

  const raw = Math.abs(guessed - actual) / safeDivisor;
  if (allowDecimals && !integerScores) return roundTo(raw, 3);
  if (roundingMode === 'floor') return Math.floor(raw);
  if (roundingMode === 'ceil') return Math.ceil(raw);
  return Math.round(raw);
};

export const compareScores = (left, right) => {
  if (Number(left) === Number(right)) return 'tie';
  return Number(left) < Number(right) ? 'jay' : 'kim';
};

export const comparePlayerScores = (scores) => compareScores(scores.jay, scores.kim);

export const formatScore = (value) =>
  Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(Number(value || 0)) ? 0 : 1,
    maximumFractionDigits: 3,
  });

export const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getTotals = (rounds) => {
  if (!rounds.length) return emptyTotals();
  return { ...getRoundPenaltyTotals(rounds[rounds.length - 1]) };
};

export const getLeader = (totals) => compareScores(totals.jay, totals.kim);

const getAnalyticsEventTime = (value) => {
  if (!value) return 0;
  if (typeof value?.seconds === 'number') {
    return (value.seconds * 1000) + Math.round((value.nanoseconds || 0) / 1_000_000);
  }
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getPenaltyAdjustmentDelta = (event = {}) => {
  const rawPlayer = normalizeText(event.player || event.playerId || event.seat || event.pointsDeductedFromPlayerId).toLowerCase();
  const player = rawPlayer === 'kim' ? 'kim' : rawPlayer === 'jay' ? 'jay' : '';
  const amount = Number(event.amount ?? event.delta ?? event.points ?? event.itemCost ?? event.cost ?? 0);
  if (!player || !Number.isFinite(amount) || amount === 0) return emptyTotals();
  return {
    jay: player === 'jay' ? amount : 0,
    kim: player === 'kim' ? amount : 0,
  };
};

const buildCumulativePenaltySeries = (rounds = [], penaltyAdjustments = []) => {
  const roundEvents = rounds.map((round, index) => ({
    type: 'round',
    id: round.id || `round-${index + 1}`,
    round: round.number || index + 1,
    order: index,
    time: getAnalyticsEventTime(round.completedAt || round.createdAt || round.updatedAt),
    delta: getRoundPenaltyMap(round),
  }));

  const adjustmentEvents = penaltyAdjustments
    .map((event, index) => ({
      type: event.type || 'adjustment',
      id: event.id || event.redemptionId || `adjustment-${index + 1}`,
      round: event.round || `S${index + 1}`,
      order: rounds.length + index,
      time: getAnalyticsEventTime(event.redeemedAt || event.completedAt || event.createdAt || event.updatedAt),
      delta: getPenaltyAdjustmentDelta(event),
    }))
    .filter((event) => event.delta.jay || event.delta.kim);

  const events = [...roundEvents, ...adjustmentEvents].sort(
    (left, right) => (left.time || 0) - (right.time || 0) || left.order - right.order,
  );

  let running = emptyTotals();
  return events.map((event, index) => {
    running = {
      jay: Math.max(0, addScores(running.jay, event.delta.jay)),
      kim: Math.max(0, addScores(running.kim, event.delta.kim)),
    };
    return {
      round: event.round,
      eventId: `${event.type}-${event.id}-${index}`,
      eventType: event.type,
      jay: running.jay,
      kim: running.kim,
    };
  });
};

export const createRoundResult = (input, nextNumber = 1, priorTotals = emptyTotals()) => {
  const roundType = normalizeRoundType(input.roundType);
  const answerType = normalizeAnswerType(input.answerType ?? input.defaultAnswerType, roundType);
  const defaultAnswerType = normalizeAnswerType(input.defaultAnswerType, roundType);
  const penaltyAdded = {
    jay: toScore(input.penaltyAdded?.jay ?? input.scores?.jay ?? input.jayPenalty ?? input.jayScore ?? 0),
    kim: toScore(input.penaltyAdded?.kim ?? input.scores?.kim ?? input.kimPenalty ?? input.kimScore ?? 0),
  };
  const scores = { ...penaltyAdded };
  const totalsAfterRound = {
    jay: addScores(priorTotals.jay, penaltyAdded.jay),
    kim: addScores(priorTotals.kim, penaltyAdded.kim),
  };
  const roundPenaltyValue = Math.max(0, parseNumber(input.roundPenaltyValue ?? input.fixedPenalty ?? input.penalty, 5));

  return {
    id: input.id || makeId('round'),
    number: nextNumber,
    questionId: input.questionId || null,
    question: normalizeText(input.question),
    roundType,
    answerType,
    defaultAnswerType,
    category: normalizeText(input.category),
    tags: parseTags(input.tags),
    unitLabel: normalizeText(input.unitLabel),
    notes: normalizeText(input.notes),
    actualAnswer: parseNumber(input.actualAnswer ?? input.actual, 0),
    guesses: {
      jay: parseNumber(input.guesses?.jay ?? input.jayGuess, 0),
      kim: parseNumber(input.guesses?.kim ?? input.kimGuess, 0),
    },
    actualText: normalizeText(input.actualText),
    guessText: {
      jay: normalizeText(input.guessText?.jay ?? input.jayTextGuess),
      kim: normalizeText(input.guessText?.kim ?? input.kimTextGuess),
    },
    actualAnswers: {
      jay: normalizeText(input.actualAnswers?.jay ?? input.jayActualAnswer),
      kim: normalizeText(input.actualAnswers?.kim ?? input.kimActualAnswer),
    },
    guessedAnswers: {
      jay: normalizeText(input.guessedAnswers?.jay ?? input.jayGuessedAnswer),
      kim: normalizeText(input.guessedAnswers?.kim ?? input.kimGuessedAnswer),
    },
    actualList: {
      jay: parseAnswerList(input.actualList?.jay ?? input.jayActualList),
      kim: parseAnswerList(input.actualList?.kim ?? input.kimActualList),
    },
    guessedList: {
      jay: parseAnswerList(input.guessedList?.jay ?? input.jayGuessedList),
      kim: parseAnswerList(input.guessedList?.kim ?? input.kimGuessedList),
    },
    multipleChoiceOptions:
      roundType === 'trueFalse'
        ? DEFAULT_TRUE_FALSE_OPTIONS
        : parseAnswerList(input.multipleChoiceOptions ?? input.options),
    penaltyAdded,
    scores,
    manualScores: Boolean(input.manualScores),
    scoringMode: normalizeScoringMode(input.scoringMode, roundType),
    scoringOutcomeType: normalizeScoringOutcomeType(input.scoringOutcomeType, roundType),
    scoringDivisor: Math.max(0.000001, parseNumber(input.scoringDivisor ?? input.divisor, 1) || 1),
    roundingMode: normalizeRoundingMode(input.roundingMode),
    roundPenaltyValue,
    fixedPenalty: roundPenaltyValue,
    scoreExplanation: normalizeText(input.scoreExplanation ?? input.explanation),
    allowDecimals: Boolean(input.allowDecimals),
    integerScores: input.integerScores !== false,
    winner: comparePlayerScores(penaltyAdded),
    overallLeader: getLeader(totalsAfterRound),
    totalPenaltyAfterRound: totalsAfterRound,
    totalsAfterRound,
    createdAt:
      typeof input.createdAt === 'string' && !Number.isNaN(Date.parse(input.createdAt))
        ? input.createdAt
        : new Date().toISOString(),
  };
};

export const recalculateRounds = (rounds = []) => {
  let totals = emptyTotals();
  return rounds.map((round, index) => {
    const next = createRoundResult(round, index + 1, totals);
    totals = { ...next.totalsAfterRound };
    return next;
  });
};

export const migrateLegacyRoundToQuestion = (round) =>
  createQuestionTemplate({
    id: round.questionId || makeId('question'),
    question: round.question,
    roundType: round.roundType || 'numeric',
    category: round.category,
    roundPenaltyValue: getRoundPenaltyValue(round),
    used: true,
    timesPlayed: 1,
    lastPlayedAt: round.createdAt,
    createdAt: round.createdAt,
  });

const resolveGoogleSheetSettings = (settings = {}) => {
  const nextSettings = { ...settings };
  const currentInput = normalizeText(nextSettings.googleSheetInput);
  const currentId = normalizeText(nextSettings.googleSheetId);
  const currentGid = normalizeText(nextSettings.googleSheetGid);
  const usesLegacyDefault =
    currentInput === LEGACY_DEFAULT_GOOGLE_SHEET.input ||
    currentId === LEGACY_DEFAULT_GOOGLE_SHEET.id;

  if (!currentInput && !currentId) {
    nextSettings.googleSheetInput = DEFAULT_GOOGLE_SHEET.input;
    nextSettings.googleSheetId = DEFAULT_GOOGLE_SHEET.id;
    nextSettings.googleSheetGid = DEFAULT_GOOGLE_SHEET.gid;
    return nextSettings;
  }

  if (usesLegacyDefault) {
    nextSettings.googleSheetInput = DEFAULT_GOOGLE_SHEET.input;
    nextSettings.googleSheetId = DEFAULT_GOOGLE_SHEET.id;
    nextSettings.googleSheetGid = DEFAULT_GOOGLE_SHEET.gid;
    return nextSettings;
  }

  if (currentInput && !currentId) {
    nextSettings.googleSheetInput = currentInput;
    nextSettings.googleSheetGid = currentGid;
    return nextSettings;
  }

  return nextSettings;
};

export const buildInitialGameState = (payload = {}) => {
  const rounds = recalculateRounds(Array.isArray(payload.rounds) ? payload.rounds : []);
  const rawQuestions = Array.isArray(payload.questions)
    ? payload.questions.map(createQuestionTemplate).filter((question) => question.question)
    : [];
  const shouldSeedStarters = !Array.isArray(payload.questions) && !rounds.length;
  const questions = shouldSeedStarters
    ? STARTER_QUESTIONS.map((question) => createQuestionTemplate({ ...question, source: 'starter' }))
    : rawQuestions;

  const questionKeys = new Set(questions.map((question) => normalizeQuestionKey(question.question)));
  rounds.forEach((round) => {
    const key = normalizeQuestionKey(round.question);
    if (round.question && !questionKeys.has(key)) {
      const migrated = migrateLegacyRoundToQuestion(round);
      questions.push(migrated);
      questionKeys.add(key);
    }
  });

  const discoveredCategories = [
    ...questions.map((question) => question.category),
    ...rounds.map((round) => round.category),
  ]
    .filter(Boolean)
    .map((name, index) => createCategory(name, index));
  const baseCategories = Array.isArray(payload.categories) ? payload.categories : DEFAULT_CATEGORIES;
  const categories = mergeCategories(baseCategories, discoveredCategories);

  return {
    schemaVersion: SCHEMA_VERSION,
    rounds,
    questions,
    categories,
    settings: resolveGoogleSheetSettings({
      ...DEFAULT_SETTINGS,
      ...(payload.settings || {}),
    }),
  };
};

export const deriveCategories = (questions = [], rounds = [], categories = []) =>
  mergeCategories(
    categories,
    [...questions.map((q) => q.category), ...rounds.map((r) => r.category)].filter(Boolean),
  );

export const deriveTags = (questions = []) =>
  [...new Set(questions.flatMap((q) => q.tags || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));

export const pickRandom = (items) => items[Math.floor(Math.random() * items.length)] || null;

export const filterQuestionsForDraw = (questions, settings, overrides = {}) => {
  const category = overrides.category ?? settings.selectedCategory;
  const tag = overrides.tag ?? settings.selectedTag;
  const roundType = overrides.roundType ?? settings.selectedRoundType;
  const allowRepeats = overrides.allowRepeats ?? settings.allowRepeats ?? settings.gameMode === 'repeat';
  const unusedOnly = overrides.unusedOnly ?? settings.unusedOnly ?? settings.gameMode === 'unused';

  return questions.filter((question) => {
    if (!allowRepeats && unusedOnly && question.used) return false;
    if (category && question.category !== category) return false;
    if (tag && !(question.tags || []).includes(tag)) return false;
    if (roundType && question.roundType !== roundType) return false;
    return true;
  });
};

export const markQuestionPlayed = (question, playedAt = new Date().toISOString()) => ({
  ...question,
  used: true,
  timesPlayed: Number(question.timesPlayed || 0) + 1,
  lastPlayedAt: playedAt,
  updatedAt: playedAt,
});

export const setQuestionUsed = (question, used) => ({
  ...question,
  used: Boolean(used),
  lastPlayedAt: used ? question.lastPlayedAt || new Date().toISOString() : null,
  updatedAt: new Date().toISOString(),
});

export const exportRoundsCsv = (rounds) => {
  const headers = [
    'round',
    'createdAt',
    'question',
    'roundType',
    'category',
    'answerType',
    'scoringMode',
    'scoringOutcomeType',
    'roundPenaltyValue',
    'actualAnswer',
    'jayGuess',
    'kimGuess',
    'actualText',
    'jayActualAnswer',
    'kimActualAnswer',
    'jayGuessedAnswer',
    'kimGuessedAnswer',
    'jayActualList',
    'kimActualList',
    'jayGuessedList',
    'kimGuessedList',
    'multipleChoiceOptions',
    'jayPenaltyAdded',
    'kimPenaltyAdded',
    'jayTotalPenaltyAfterRound',
    'kimTotalPenaltyAfterRound',
    'winner',
    'overallLeader',
    'scoringDivisor',
    'roundingMode',
    'notes',
  ];

  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = rounds.map((round) =>
    [
      round.number,
      round.createdAt,
      round.question,
      round.roundType,
      round.category,
      getRoundAnswerType(round),
      round.scoringMode,
      round.scoringOutcomeType,
      getRoundPenaltyValue(round),
      round.roundType === 'numeric' ? round.actualAnswer : getMaskedAnswerValue(round.actualText, round.answerType, round.roundType),
      round.guesses.jay,
      round.guesses.kim,
      getMaskedAnswerValue(round.actualText, round.answerType, round.roundType),
      getMaskedAnswerValue(round.actualAnswers.jay, round.answerType, round.roundType),
      getMaskedAnswerValue(round.actualAnswers.kim, round.answerType, round.roundType),
      round.guessedAnswers.jay,
      round.guessedAnswers.kim,
      round.actualList.jay.join('|'),
      round.actualList.kim.join('|'),
      round.guessedList.jay.join('|'),
      round.guessedList.kim.join('|'),
      (round.multipleChoiceOptions || []).join('|'),
      getRoundPenalty(round, 'jay'),
      getRoundPenalty(round, 'kim'),
      getRoundPenaltyTotals(round).jay,
      getRoundPenaltyTotals(round).kim,
      round.winner,
      round.overallLeader,
      round.scoringDivisor,
      round.roundingMode,
      round.notes,
    ].map(escape),
  );

  return [headers.map(escape), ...rows].map((row) => row.join(',')).join('\n');
};

export const calculateAnalytics = (rounds = [], options = {}) => {
  const penaltyAdjustments = Array.isArray(options?.penaltyAdjustments) ? options.penaltyAdjustments : [];
  const totals = getTotals(rounds);
  const totalRounds = rounds.length;
  const roundWins = { jay: 0, kim: 0, tie: 0 };
  const bestRounds = { jay: null, kim: null };
  const worstRounds = { jay: null, kim: null };
  const categoryCounts = new Map();
  const categoryStats = new Map();
  const roundTypeStats = new Map();
  const distribution = {
    jay: { zero: 0, low: 0, mid: 0, high: 0 },
    kim: { zero: 0, low: 0, mid: 0, high: 0 },
  };
  let closestRound = null;
  let biggestBlowoutRound = null;

  const updateCategory = (round) => {
    const category = round.category || 'Uncategorised';
    const penalties = getRoundPenaltyMap(round);
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    const next = categoryStats.get(category) || {
      category,
      rounds: 0,
      totals: emptyTotals(),
      wins: { jay: 0, kim: 0, tie: 0 },
      blowoutTotal: 0,
    };
    next.rounds += 1;
    next.totals.jay = addScores(next.totals.jay, penalties.jay);
    next.totals.kim = addScores(next.totals.kim, penalties.kim);
    next.wins[round.winner] += 1;
    next.blowoutTotal += Math.abs(penalties.jay - penalties.kim);
    categoryStats.set(category, next);
  };

  const updateRoundType = (round) => {
    const roundType = round.roundType || 'numeric';
    const penalties = getRoundPenaltyMap(round);
    const next = roundTypeStats.get(roundType) || {
      roundType,
      label: ROUND_TYPE_LABEL[roundType] || roundType,
      rounds: 0,
      totals: emptyTotals(),
      wins: { jay: 0, kim: 0, tie: 0 },
    };
    next.rounds += 1;
    next.totals.jay = addScores(next.totals.jay, penalties.jay);
    next.totals.kim = addScores(next.totals.kim, penalties.kim);
    next.wins[round.winner] += 1;
    roundTypeStats.set(roundType, next);
  };

  rounds.forEach((round) => {
    const penalties = getRoundPenaltyMap(round);
    roundWins[round.winner] += 1;
    updateCategory(round);
    updateRoundType(round);

    PLAYERS.forEach(({ id }) => {
      const score = penalties[id];
      if (!bestRounds[id] || score < bestRounds[id].score) {
        bestRounds[id] = { score, number: round.number, question: round.question };
      }
      if (!worstRounds[id] || score > worstRounds[id].score) {
        worstRounds[id] = { score, number: round.number, question: round.question };
      }
      if (score === 0) distribution[id].zero += 1;
      else if (score <= 3) distribution[id].low += 1;
      else if (score <= 10) distribution[id].mid += 1;
      else distribution[id].high += 1;
    });

    const gap = Math.abs(penalties.jay - penalties.kim);
    if (!closestRound || gap < Math.abs(getRoundPenalty(closestRound, 'jay') - getRoundPenalty(closestRound, 'kim'))) {
      closestRound = round;
    }
    if (!biggestBlowoutRound || gap > Math.abs(getRoundPenalty(biggestBlowoutRound, 'jay') - getRoundPenalty(biggestBlowoutRound, 'kim'))) {
      biggestBlowoutRound = round;
    }
  });

  const categoryRows = [...categoryStats.values()].map((row) => ({
    ...row,
    averages: {
      jay: row.rounds ? roundTo(row.totals.jay / row.rounds, 2) : 0,
      kim: row.rounds ? roundTo(row.totals.kim / row.rounds, 2) : 0,
    },
    volatility: row.rounds ? roundTo(row.blowoutTotal / row.rounds, 2) : 0,
    averageGap: row.rounds ? roundTo(row.blowoutTotal / row.rounds, 2) : 0,
    winRate: {
      jay: row.rounds ? roundTo((row.wins.jay / row.rounds) * 100, 1) : 0,
      kim: row.rounds ? roundTo((row.wins.kim / row.rounds) * 100, 1) : 0,
      tie: row.rounds ? roundTo((row.wins.tie / row.rounds) * 100, 1) : 0,
    },
    winner: compareScores(row.totals.jay, row.totals.kim),
  })).sort((a, b) => b.rounds - a.rounds || a.category.localeCompare(b.category));

  const roundTypeRows = [...roundTypeStats.values()].map((row) => ({
    ...row,
    averages: {
      jay: row.rounds ? roundTo(row.totals.jay / row.rounds, 2) : 0,
      kim: row.rounds ? roundTo(row.totals.kim / row.rounds, 2) : 0,
    },
    winner: compareScores(row.totals.jay, row.totals.kim),
  })).sort((a, b) => b.rounds - a.rounds || a.label.localeCompare(b.label));

  const mostCommonCategory =
    [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '-';

  const getCurrentStreak = () => {
    if (!rounds.length) return { winner: 'tie', count: 0 };
    const winner = rounds.at(-1).winner;
    let count = 0;
    for (let index = rounds.length - 1; index >= 0; index -= 1) {
      if (rounds[index].winner !== winner) break;
      count += 1;
    }
    return { winner, count };
  };

  const getLongestStreak = () => {
    let best = { winner: 'tie', count: 0 };
    let active = { winner: 'tie', count: 0 };
    rounds.forEach((round) => {
      if (round.winner === active.winner) {
        active.count += 1;
      } else {
        active = { winner: round.winner, count: 1 };
      }
      if (active.winner !== 'tie' && active.count > best.count) {
        best = { ...active };
      }
    });
    return best;
  };

  const leader = getLeader(totals);
  const averageLeader = compareScores(
    totalRounds ? totals.jay / totalRounds : 0,
    totalRounds ? totals.kim / totalRounds : 0,
  );

  const cumulativeSeries = buildCumulativePenaltySeries(rounds, penaltyAdjustments);

  const roundBars = rounds.map((round) => ({
    round: round.number,
    jay: getRoundPenalty(round, 'jay'),
    kim: getRoundPenalty(round, 'kim'),
    category: round.category || 'Uncategorised',
  }));

  const outcomeTimeline = rounds.map((round) => ({
    round: round.number,
    winner: round.winner,
    gap: Math.abs(getRoundPenalty(round, 'jay') - getRoundPenalty(round, 'kim')),
  }));

  const categoryTrend = rounds.map((round) => ({
    round: round.number,
    category: round.category || 'Uncategorised',
    winner: round.winner,
    jay: getRoundPenalty(round, 'jay'),
    kim: getRoundPenalty(round, 'kim'),
    gap: Math.abs(getRoundPenalty(round, 'jay') - getRoundPenalty(round, 'kim')),
  }));

  const categoryRoundTypeMap = new Map();
  rounds.forEach((round) => {
    const category = round.category || 'Uncategorised';
    const roundType = round.roundType || 'numeric';
    const key = `${category}::${roundType}`;
    const next = categoryRoundTypeMap.get(key) || {
      category,
      roundType,
      label: ROUND_TYPE_LABEL[roundType] || roundType,
      rounds: 0,
      totals: emptyTotals(),
    };
    next.rounds += 1;
    next.totals.jay = addScores(next.totals.jay, getRoundPenalty(round, 'jay'));
    next.totals.kim = addScores(next.totals.kim, getRoundPenalty(round, 'kim'));
    categoryRoundTypeMap.set(key, next);
  });

  const categoryRoundTypeRows = [...categoryRoundTypeMap.values()]
    .map((row) => ({
      ...row,
      averages: {
        jay: row.rounds ? roundTo(row.totals.jay / row.rounds, 2) : 0,
        kim: row.rounds ? roundTo(row.totals.kim / row.rounds, 2) : 0,
      },
      winner: compareScores(row.totals.jay, row.totals.kim),
    }))
    .sort((a, b) => b.rounds - a.rounds || a.category.localeCompare(b.category) || a.label.localeCompare(b.label));

  const bestCategoryFor = (playerId) =>
    categoryRows
      .filter((row) => row.rounds)
      .sort((a, b) => a.averages[playerId] - b.averages[playerId])[0]?.category || '-';

  const worstCategoryFor = (playerId) =>
    categoryRows
      .filter((row) => row.rounds)
      .sort((a, b) => b.averages[playerId] - a.averages[playerId])[0]?.category || '-';

  const volatileCategory =
    categoryRows.slice().sort((a, b) => b.volatility - a.volatility)[0]?.category || '-';
  const closestCategory =
    categoryRows.slice().sort((a, b) => a.averageGap - b.averageGap)[0]?.category || '-';
  const oneSidedCategory =
    categoryRows.slice().sort((a, b) => b.averageGap - a.averageGap)[0]?.category || '-';
  const favouriteRoundType = roundTypeRows[0]?.label || '-';

  const insights = [
    totalRounds ? `Jay keeps penalties lowest in ${bestCategoryFor('jay')}.` : 'Add rounds to unlock player trends.',
    totalRounds ? `Kim keeps penalties lowest in ${bestCategoryFor('kim')}.` : 'Draw a question to start analytics.',
    closestRound ? `Closest contest was Round ${closestRound.number}.` : 'Closest contest will appear after play.',
    closestCategory !== '-' ? `${closestCategory} has the tightest average penalty gap.` : 'Category competitiveness needs history.',
    oneSidedCategory !== '-' ? `${oneSidedCategory} is the most one-sided category.` : 'One-sided category trends need more rounds.',
    volatileCategory !== '-' ? `${volatileCategory} rounds are the most unpredictable.` : 'Category volatility needs history.',
    favouriteRoundType !== '-' ? `${favouriteRoundType} is the most used round type.` : 'Round type usage will appear after play.',
    `Lowest average penalty belongs to ${PLAYER_LABEL[averageLeader]}.`,
    `Current lowest total belongs to ${PLAYER_LABEL[leader]}.`,
  ];

  return {
    totalRounds,
    totals,
    averages: {
      jay: totalRounds ? roundTo(totals.jay / totalRounds, 2) : 0,
      kim: totalRounds ? roundTo(totals.kim / totalRounds, 2) : 0,
    },
    bestRounds,
    worstRounds,
    mostCommonCategory,
    closestRound,
    biggestBlowoutRound,
    currentStreak: getCurrentStreak(),
    longestWinningStreak: getLongestStreak(),
    leaderboardSummary:
      leader === 'tie'
        ? 'Total penalties are level.'
        : `${PLAYER_LABEL[leader]} leads by ${formatScore(Math.abs(totals.jay - totals.kim))} penalty points.`,
    roundWins,
    categoryRows,
    roundTypeRows,
    favouriteRoundType,
    closestCategory,
    mostCompetitiveCategory: closestCategory,
    mostOneSidedCategory: oneSidedCategory,
    categoryLeaderboard: categoryRows,
    bestCategory: {
      jay: bestCategoryFor('jay'),
      kim: bestCategoryFor('kim'),
    },
    worstCategory: {
      jay: worstCategoryFor('jay'),
      kim: worstCategoryFor('kim'),
    },
    cumulativeSeries,
    roundBars,
    distribution,
    outcomeTimeline,
    categoryTrend,
    categoryRoundTypeRows,
    insights,
    leader,
    averageLeader,
  };
};

export const validateImportedGame = (payload) => {
  const state = buildInitialGameState(payload);
  if (!Array.isArray(state.rounds)) {
    throw new Error('Import must contain rounds or a valid game backup.');
  }
  return state;
};
