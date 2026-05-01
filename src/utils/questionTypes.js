const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const compactText = (value) => String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

const parseDelimitedItems = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => compactText(item)).filter(Boolean);
  }
  return String(value || '')
    .split(/\n|,|;/)
    .map((item) => item.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean);
};

export const DEFAULT_TRUE_FALSE_OPTIONS = ['True', 'False'];
export const DEFAULT_PLAYER_CHOICE_OPTIONS = ['Jay', 'Kim', 'Both', 'Neither'];

export const QUESTION_TYPE_CONFIGS = [
  {
    id: 'numeric',
    label: 'Numeric',
    shortLabel: 'Numeric',
    googleSheetLabel: 'Numeric',
    title: 'Numeric',
    summary: 'Great for totals, counts, amounts, or number guesses.',
    playFlow: 'Later play uses the numeric helper flow.',
    inputMode: 'number',
    scoringFamily: 'numeric',
    defaultAnswerType: 'number',
    aliases: ['numeric', 'number', 'closestwins', 'closest'],
  },
  {
    id: 'multipleChoice',
    label: 'Multiple Choice',
    shortLabel: 'Multiple Choice',
    googleSheetLabel: 'Multiple Choice',
    title: 'Multiple Choice',
    summary: 'Use this when the live round should present selectable options.',
    playFlow: 'Later play opens the multiple choice UI.',
    inputMode: 'choice',
    scoringFamily: 'choice',
    defaultAnswerType: 'multipleChoice',
    aliases: ['multiplechoice', 'multiple', 'mcq', 'multiselect', 'whoismorelikely', 'mostlikely'],
  },
  {
    id: 'trueFalse',
    label: 'True or False',
    shortLabel: 'True / False',
    googleSheetLabel: 'True or False',
    title: 'True or False',
    summary: 'Built-in binary question type.',
    playFlow: 'Later play uses a simple True / False choice flow.',
    inputMode: 'choice',
    scoringFamily: 'choice',
    defaultAnswerType: 'multipleChoice',
    aliases: [
      'truefalse',
      'trueorfalse',
      'truefalsequestion',
      'trueorfalsequestion',
      'boolean',
      'bool',
      'binary',
      'tf',
      'tfquestion',
      'yesno',
      'yesorno',
    ],
  },
  {
    id: 'text',
    label: 'Text Answer',
    shortLabel: 'Text Answer',
    googleSheetLabel: 'Text Answer',
    title: 'Text Answer',
    summary: 'Open text response without preloading the answer now.',
    playFlow: 'Later play uses the text answer UI.',
    inputMode: 'text',
    scoringFamily: 'text',
    defaultAnswerType: 'text',
    aliases: ['text', 'textanswer', 'written', 'openanswer', 'fillintheblank', 'blank', 'shortanswer'],
  },
  {
    id: 'sortIntoOrder',
    label: 'Sort Into Order',
    shortLabel: 'Sort Into Order',
    googleSheetLabel: 'Sort Into Order',
    title: 'Sort Into Order',
    summary: 'Best for sequence, ordering, or full ranking prompts.',
    playFlow: 'Later play uses the ordering/list flow.',
    inputMode: 'list',
    scoringFamily: 'list',
    defaultAnswerType: 'ranked',
    aliases: ['sortintoorder', 'sorting', 'ordering', 'sequence', 'sequenceordering', 'sortorder', 'matchpair', 'matchthepair', 'matching', 'ranking'],
  },
  {
    id: 'preference',
    label: 'Preference / This-or-That',
    shortLabel: 'Preference',
    googleSheetLabel: 'Preference',
    title: 'Preference / This-or-That',
    summary: 'For personal preference or side-vs-side prompts.',
    playFlow: 'Later play uses a flexible preference choice flow.',
    inputMode: 'choice',
    scoringFamily: 'manual',
    defaultAnswerType: 'multipleChoice',
    aliases: ['preference', 'thisorthat', 'preferencethisorthat', 'choice', 'wouldyourather'],
  },
  {
    id: 'favourite',
    label: 'Favourite',
    shortLabel: 'Favourite',
    googleSheetLabel: 'Favourite',
    title: 'Favourite',
    summary: 'Ask for a favourite item, place, person, or thing.',
    playFlow: 'Later play uses the favourite answer UI.',
    inputMode: 'text',
    scoringFamily: 'manual',
    defaultAnswerType: 'text',
    aliases: ['favorite', 'favourite', 'favourites', 'favorites'],
  },
  {
    id: 'petPeeve',
    label: 'Pet Peeve',
    shortLabel: 'Pet Peeve',
    googleSheetLabel: 'Pet Peeve',
    title: 'Pet Peeve',
    summary: 'Ask for annoyances, turn-offs, or irritations.',
    playFlow: 'Later play uses the pet peeve answer UI.',
    inputMode: 'text',
    scoringFamily: 'manual',
    defaultAnswerType: 'text',
    aliases: ['petpeeve', 'petpeeves', 'peeve'],
  },
  {
    id: 'ranked',
    label: 'Ranked / Top 3',
    shortLabel: 'Ranked / Top 3',
    googleSheetLabel: 'Ranked / Top 3',
    title: 'Ranked / Top 3',
    summary: 'For ranked lists, top 3 answers, or shortlist rounds.',
    playFlow: 'Later play uses the ranked list flow.',
    inputMode: 'list',
    scoringFamily: 'list',
    defaultAnswerType: 'ranked',
    aliases: ['ranked', 'top3', 'topthree', 'rankedtop3', 'multianswer'],
  },
  {
    id: 'rating',
    label: 'Rating',
    shortLabel: 'Rating',
    googleSheetLabel: 'Rating',
    title: 'Rating',
    summary: 'For 1 to 10 style rating prompts.',
    playFlow: 'Later play uses a 1 to 10 selector.',
    inputMode: 'rating',
    scoringFamily: 'manual',
    defaultAnswerType: 'number',
    aliases: ['rating', 'ratingscale', 'scale', 'scoreoutof10', 'onetoten'],
  },
  {
    id: 'manual',
    label: 'Manual / Custom',
    shortLabel: 'Manual / Custom',
    googleSheetLabel: 'Manual / Custom',
    title: 'Manual / Custom',
    summary: 'Use when the host wants to judge the round live.',
    playFlow: 'Later play goes straight to direct penalty entry.',
    inputMode: 'text',
    scoringFamily: 'manual',
    defaultAnswerType: 'pairedText',
    aliases: ['manual', 'custom', 'manualcustom'],
  },
];

const QUESTION_TYPE_CONFIG_MAP = new Map(QUESTION_TYPE_CONFIGS.map((config) => [config.id, config]));
const QUESTION_TYPE_ALIAS_MAP = new Map(
  QUESTION_TYPE_CONFIGS.flatMap((config) => [
    [normalizeKey(config.id), config.id],
    ...config.aliases.map((alias) => [normalizeKey(alias), config.id]),
  ]),
);

const resolveFallbackType = (fallback = 'text') => {
  const normalizedFallback = QUESTION_TYPE_ALIAS_MAP.get(normalizeKey(fallback)) || 'text';
  return QUESTION_TYPE_CONFIG_MAP.has(normalizedFallback) ? normalizedFallback : 'text';
};

export const normalizeQuestionType = (value, fallback = 'text') => {
  const fallbackType = resolveFallbackType(fallback);
  const normalized = QUESTION_TYPE_ALIAS_MAP.get(normalizeKey(value));
  return normalized || fallbackType;
};

export const getQuestionTypeConfig = (type, fallback = 'text') =>
  QUESTION_TYPE_CONFIG_MAP.get(normalizeQuestionType(type, fallback)) || QUESTION_TYPE_CONFIG_MAP.get('text');

export const getGoogleSheetQuestionTypeOptions = () =>
  QUESTION_TYPE_CONFIGS.map((config) => config.googleSheetLabel || config.label);

export const getSupportedQuestionTypeIds = () => QUESTION_TYPE_CONFIGS.map((config) => config.id);

export const parseQuestionTypeAnswerList = (value) => parseDelimitedItems(value);

export const buildEitherOrOptions = (question = '') => {
  const cleaned = compactText(question).replace(/[?!.]+$/, '');
  const patterns = [
    /would you rather (.+?) or (.+)$/i,
    /do you prefer (.+?) or (.+)$/i,
    /are you more of (.+?) or (.+)$/i,
    /would you choose (.+?) or (.+)$/i,
    /between (.+?) and (.+),/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const left = compactText(match[1]).replace(/^(to |be |have )/i, '');
    const right = compactText(match[2]).replace(/^(to |be |have )/i, '');
    if (left && right) return [left, right];
  }

  return [];
};

export const getDefaultOptionsForQuestionType = (type, { question = '', options = [] } = {}) => {
  const normalizedType = normalizeQuestionType(type, 'text');
  const providedOptions = parseDelimitedItems(options);
  if (providedOptions.length) return providedOptions;
  if (normalizedType === 'trueFalse') return [...DEFAULT_TRUE_FALSE_OPTIONS];
  if (normalizedType === 'multipleChoice') {
    if (/who is more likely|who is most likely/i.test(compactText(question))) {
      return [...DEFAULT_PLAYER_CHOICE_OPTIONS];
    }
    return [...DEFAULT_PLAYER_CHOICE_OPTIONS];
  }
  if (normalizedType === 'preference') {
    const eitherOrOptions = buildEitherOrOptions(question);
    return eitherOrOptions.length ? eitherOrOptions : ['Option A', 'Option B'];
  }
  return [];
};

export const usesNumberInputForQuestionType = (type) => getQuestionTypeConfig(type).inputMode === 'number';
export const usesChoiceInputForQuestionType = (type) => getQuestionTypeConfig(type).inputMode === 'choice';
export const usesListInputForQuestionType = (type) => getQuestionTypeConfig(type).inputMode === 'list';
export const usesRatingInputForQuestionType = (type) => getQuestionTypeConfig(type).inputMode === 'rating';
export const usesTextareaInputForQuestionType = (type) => {
  const config = getQuestionTypeConfig(type);
  return config.inputMode === 'text' && config.id !== 'text' ? true : config.id === 'text' || config.id === 'manual';
};

export const getQuestionTypeListCount = (type, options = []) => {
  const normalizedType = normalizeQuestionType(type, 'text');
  if (normalizedType === 'ranked') return 3;
  const providedOptions = parseDelimitedItems(options);
  return Math.max(3, providedOptions.length || 4);
};

export const getQuestionTypeListLabels = (type, options = []) => {
  const normalizedType = normalizeQuestionType(type, 'text');
  const listCount = getQuestionTypeListCount(normalizedType, options);
  if (normalizedType === 'ranked') {
    return Array.from({ length: listCount }, (_, index) => `#${index + 1}`);
  }
  return Array.from({ length: listCount }, (_, index) => `Step ${index + 1}`);
};

const toTrueFalseValue = (value) => {
  if (value === true) return 'True';
  if (value === false) return 'False';
  const normalized = normalizeKey(value);
  if (['true', 'yes', 'y', '1'].includes(normalized)) return 'True';
  if (['false', 'no', 'n', '0'].includes(normalized)) return 'False';
  return compactText(value);
};

export const serialiseAnswerForQuestionType = (type, rawAnswer) => {
  const normalizedType = normalizeQuestionType(type, 'text');

  if (usesListInputForQuestionType(normalizedType)) {
    return parseDelimitedItems(rawAnswer)
      .map((item) => item.replace(/\r?\n/g, ' '))
      .join('\n');
  }

  if (normalizedType === 'trueFalse') {
    return toTrueFalseValue(rawAnswer);
  }

  if (usesRatingInputForQuestionType(normalizedType)) {
    const trimmed = compactText(rawAnswer);
    if (!trimmed) return '';
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) return trimmed;
    return String(Math.max(1, Math.min(10, parsed)));
  }

  return compactText(rawAnswer);
};

export const formatAnswerForDisplay = (type, answer, { emptyFallback = '-' } = {}) => {
  const normalizedType = normalizeQuestionType(type, 'text');

  if (answer === null || typeof answer === 'undefined') return emptyFallback;

  if (usesListInputForQuestionType(normalizedType)) {
    const list = parseDelimitedItems(answer);
    return list.length ? list.map((item, index) => `${index + 1}. ${item}`).join(' • ') : emptyFallback;
  }

  if (normalizedType === 'trueFalse') {
    const value = toTrueFalseValue(answer);
    return value || emptyFallback;
  }

  const text = compactText(answer);
  return text || emptyFallback;
};
