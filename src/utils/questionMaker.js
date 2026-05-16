import {
  createQuestionTemplate,
  makeId,
  normalizeText,
  parseAnswerList,
} from './game.js';

export const QUESTION_MAKER_BATCH_SIZE = 30;

const GAME_QUESTION_POOL = [
  {
    question: 'What tiny habit from the other person makes you smile even when you try not to?',
    category: 'Relationships',
    roundType: 'favourite',
    tags: 'relationship, affection, favourites',
    answerHint: 'No fixed answer. Each player answers live.',
  },
  {
    question: 'Which first-date moment would tell you the chemistry is definitely there?',
    category: 'Dating',
    roundType: 'manual',
    tags: 'dating, chemistry',
    answerHint: 'No fixed answer. Judge the story live.',
  },
  {
    question: 'Slow teasing or bold directness?',
    category: 'Sexual',
    roundType: 'preference',
    tags: 'spicy, preference',
    multipleChoiceOptions: 'Slow teasing\nBold directness',
    answerHint: 'Preference round. The answer is chosen during play.',
  },
  {
    question: 'What is the most dangerous outfit the other person could wear around you?',
    category: 'Fashion & Style',
    roundType: 'favourite',
    tags: 'style, attraction, spicy',
    answerHint: 'No fixed answer. Each player answers live.',
  },
  {
    question: 'Top 3 places you would sneak a kiss if nobody was watching',
    category: 'Romance',
    roundType: 'ranked',
    tags: 'romance, top-3',
    answerHint: 'Ranked list. Each player builds their own live answer.',
  },
  {
    question: 'What flirty message would be most likely to distract you at work?',
    category: 'Work & Career',
    roundType: 'manual',
    tags: 'flirty, work, messages',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'How many minutes into a good date before you know it is going well?',
    category: 'Dating',
    roundType: 'numeric',
    tags: 'dating, numeric',
    unitLabel: 'minutes',
    answerHint: 'Numeric round. The actual answer is entered during play.',
  },
  {
    question: 'Which is more tempting: a secret weekend away or a lazy day in bed?',
    category: 'Romance',
    roundType: 'preference',
    tags: 'romance, this-or-that',
    multipleChoiceOptions: 'Secret weekend away\nLazy day in bed',
    answerHint: 'Preference round. The answer is chosen during play.',
  },
  {
    question: 'What food would you use as bait to get the other person over instantly?',
    category: 'Food & Drink',
    roundType: 'favourite',
    tags: 'food, favourites',
    answerHint: 'No fixed answer. Each player answers live.',
  },
  {
    question: 'What is your biggest turn-off in a message conversation?',
    category: 'Pet Peeves',
    roundType: 'petPeeve',
    tags: 'messages, pet-peeves',
    answerHint: 'No fixed answer. Each player answers live.',
  },
  {
    question: 'Who is more likely to start trouble on a night out?',
    category: 'Nightlife',
    roundType: 'multipleChoice',
    tags: 'nightlife, who-is-more-likely',
    multipleChoiceOptions: 'Jay\nKim\nBoth\nNeither',
    answerHint: 'Choice round. No stored correct answer for standard games.',
  },
  {
    question: 'What song would immediately change the mood between you two?',
    category: 'Music',
    roundType: 'favourite',
    tags: 'music, romance',
    answerHint: 'No fixed answer. Each player answers live.',
  },
  {
    question: 'What movie scene has the kind of tension you secretly like?',
    category: 'Films & TV',
    roundType: 'manual',
    tags: 'films, tension',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'Top 3 compliments that would actually land with you',
    category: 'Personality',
    roundType: 'ranked',
    tags: 'compliments, top-3',
    answerHint: 'Ranked list. Each player builds their own live answer.',
  },
  {
    question: 'What small act of confidence is secretly attractive?',
    category: 'Personality',
    roundType: 'manual',
    tags: 'confidence, attraction',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'How much would you spend on the perfect date night?',
    category: 'Money',
    roundType: 'numeric',
    tags: 'date-night, money',
    unitLabel: 'pounds',
    scoringDivisor: 10,
    answerHint: 'Numeric round. The actual answer is entered during play.',
  },
  {
    question: 'Beach bar flirting or city rooftop flirting?',
    category: 'Travel',
    roundType: 'preference',
    tags: 'travel, flirting, this-or-that',
    multipleChoiceOptions: 'Beach bar\nCity rooftop',
    answerHint: 'Preference round. The answer is chosen during play.',
  },
  {
    question: 'What is the most underrated way to make someone feel wanted?',
    category: 'Relationships',
    roundType: 'manual',
    tags: 'relationship, affection',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'What household chore becomes strangely attractive when the other person does it?',
    category: 'Home',
    roundType: 'favourite',
    tags: 'home, attraction',
    answerHint: 'No fixed answer. Each player answers live.',
  },
  {
    question: 'Who would crack first during a no-touch challenge?',
    category: 'Sexual',
    roundType: 'multipleChoice',
    tags: 'spicy, challenge',
    multipleChoiceOptions: 'Jay\nKim\nBoth\nNeither',
    answerHint: 'Choice round. No stored correct answer for standard games.',
  },
  {
    question: 'How long could you last in a deliberate eye-contact challenge?',
    category: 'Romance',
    roundType: 'numeric',
    tags: 'romance, challenge',
    unitLabel: 'seconds',
    answerHint: 'Numeric round. The actual answer is entered during play.',
  },
  {
    question: 'What is a harmless secret that would still make you blush?',
    category: 'Embarrassing Moments',
    roundType: 'manual',
    tags: 'blush, secrets',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'Top 3 rules for the perfect private game night',
    category: 'Random / Wildcard',
    roundType: 'ranked',
    tags: 'game-night, top-3',
    answerHint: 'Ranked list. Each player builds their own live answer.',
  },
  {
    question: 'What fitness move would you most want the other person to demonstrate?',
    category: 'Fitness',
    roundType: 'manual',
    tags: 'fitness, playful',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'True or false: you are easier to tempt when you are already laughing.',
    category: 'Personality',
    roundType: 'trueFalse',
    tags: 'personality, playful',
    answerHint: 'True / False opinion round. No stored correct answer for standard games.',
  },
  {
    question: 'What is the best excuse to cancel plans and stay in together?',
    category: 'Nightlife',
    roundType: 'manual',
    tags: 'night-in, excuses',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'What object in the room could be turned into a dare?',
    category: 'Random / Wildcard',
    roundType: 'manual',
    tags: 'dare, wildcard',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'How many texts is too many before it becomes suspiciously needy?',
    category: 'Social Media',
    roundType: 'numeric',
    tags: 'messages, numeric',
    unitLabel: 'texts',
    answerHint: 'Numeric round. The actual answer is entered during play.',
  },
  {
    question: 'Which is harder to resist: a confident look or a quiet compliment?',
    category: 'Romance',
    roundType: 'preference',
    tags: 'romance, this-or-that',
    multipleChoiceOptions: 'Confident look\nQuiet compliment',
    answerHint: 'Preference round. The answer is chosen during play.',
  },
  {
    question: 'What is the most unfair advantage the other person has over you?',
    category: 'Relationships',
    roundType: 'manual',
    tags: 'relationship, attraction',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'What private joke would make you lose composure instantly?',
    category: 'Friends',
    roundType: 'manual',
    tags: 'jokes, memories',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'Top 3 things that make a normal night feel dangerous in a good way',
    category: 'Nightlife',
    roundType: 'ranked',
    tags: 'nightlife, top-3, spicy',
    answerHint: 'Ranked list. Each player builds their own live answer.',
  },
  {
    question: 'What would be the funniest punishment for losing a close round?',
    category: 'Random / Wildcard',
    roundType: 'manual',
    tags: 'forfeit, funny',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
  {
    question: 'How many compliments would it take before you get suspicious?',
    category: 'Personality',
    roundType: 'numeric',
    tags: 'compliments, numeric',
    unitLabel: 'compliments',
    answerHint: 'Numeric round. The actual answer is entered during play.',
  },
  {
    question: 'What holiday would be most dangerous for your self-control?',
    category: 'Holidays',
    roundType: 'favourite',
    tags: 'holidays, self-control',
    answerHint: 'No fixed answer. Each player answers live.',
  },
  {
    question: 'What is one future plan that would make you nervous in a good way?',
    category: 'Future / Goals',
    roundType: 'manual',
    tags: 'future, nerves',
    answerHint: 'No fixed answer. Host judges the live answers.',
  },
];

const QUIZ_QUESTION_POOL = [
  {
    question: 'Which word means clear, active agreement before anything intimate?',
    category: 'Health & Wellness',
    roundType: 'multipleChoice',
    tags: 'quiz, consent',
    multipleChoiceOptions: 'Consent\nChemistry\nCuriosity\nConfidence',
    correctAnswer: 'Consent',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: a safe word should pause the scene immediately.',
    category: 'Health & Wellness',
    roundType: 'trueFalse',
    tags: 'quiz, safety',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'How many fixed players does KJK use?',
    category: 'General Knowledge About Me',
    roundType: 'multipleChoice',
    tags: 'quiz, app',
    multipleChoiceOptions: '2\n3\n4\n5',
    correctAnswer: '2',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which round type is best for a top-three answer?',
    category: 'General Knowledge About Me',
    roundType: 'multipleChoice',
    tags: 'quiz, app',
    multipleChoiceOptions: 'Ranked\nNumeric\nTrue or False\nPet Peeve',
    correctAnswer: 'Ranked',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: Quick Fire Quiz uses points instead of normal penalty scoring during each answer.',
    category: 'General Knowledge About Me',
    roundType: 'trueFalse',
    tags: 'quiz, app',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which answer type usually needs selectable options?',
    category: 'General Knowledge About Me',
    roundType: 'multipleChoice',
    tags: 'quiz, app',
    multipleChoiceOptions: 'Multiple choice\nNumeric\nManual\nFavourite',
    correctAnswer: 'Multiple choice',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'What is the name of the player from England in this app?',
    category: 'General Knowledge About Me',
    roundType: 'text',
    tags: 'quiz, players',
    correctAnswer: 'Jay',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'What is the name of the player from the USA in this app?',
    category: 'General Knowledge About Me',
    roundType: 'text',
    tags: 'quiz, players',
    correctAnswer: 'Kim',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: a replay request lets a normal game question appear again in the future.',
    category: 'General Knowledge About Me',
    roundType: 'trueFalse',
    tags: 'quiz, app',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which category would usually fit a question about favourite takeaway orders?',
    category: 'Food & Drink',
    roundType: 'multipleChoice',
    tags: 'quiz, categories',
    multipleChoiceOptions: 'Food & Drink\nTravel\nSports\nMoney',
    correctAnswer: 'Food & Drink',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: private question notes are stored per user.',
    category: 'General Knowledge About Me',
    roundType: 'trueFalse',
    tags: 'quiz, privacy',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which game mode uses wagers before the questions begin?',
    category: 'General Knowledge About Me',
    roundType: 'multipleChoice',
    tags: 'quiz, app',
    multipleChoiceOptions: 'Quick Fire Quiz\nStandard Game\nDiary\nForfeit Store',
    correctAnswer: 'Quick Fire Quiz',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'What does AMA usually stand for?',
    category: 'Social Media',
    roundType: 'multipleChoice',
    tags: 'quiz, abbreviation',
    multipleChoiceOptions: 'Ask Me Anything\nAlways Match Answers\nAdd More Analytics\nAutomatic Manual Answer',
    correctAnswer: 'Ask Me Anything',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: a favourite round has one universal correct answer.',
    category: 'General Knowledge About Me',
    roundType: 'trueFalse',
    tags: 'quiz, round-types',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'False',
    notes: 'Favourite rounds are subjective.',
  },
  {
    question: 'Which answer is a good safe-word quality?',
    category: 'Health & Wellness',
    roundType: 'multipleChoice',
    tags: 'quiz, safety',
    multipleChoiceOptions: 'Easy to remember\nHard to pronounce\nSecret from both people\nChanged every minute',
    correctAnswer: 'Easy to remember',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: boundaries can change during a game or date.',
    category: 'Health & Wellness',
    roundType: 'trueFalse',
    tags: 'quiz, boundaries',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which category fits a question about dream travel destinations?',
    category: 'Travel',
    roundType: 'multipleChoice',
    tags: 'quiz, categories',
    multipleChoiceOptions: 'Travel\nHome\nTechnology\nWork & Career',
    correctAnswer: 'Travel',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which category fits a question about annoying habits?',
    category: 'Pet Peeves',
    roundType: 'multipleChoice',
    tags: 'quiz, categories',
    multipleChoiceOptions: 'Pet Peeves\nMusic\nFashion & Style\nCars & Driving',
    correctAnswer: 'Pet Peeves',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: exact-match quiz answers should be short and unambiguous.',
    category: 'General Knowledge About Me',
    roundType: 'trueFalse',
    tags: 'quiz, quality',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which question type is best for "tea or coffee"?',
    category: 'Food & Drink',
    roundType: 'multipleChoice',
    tags: 'quiz, round-types',
    multipleChoiceOptions: 'Preference\nNumeric\nRanked\nManual',
    correctAnswer: 'Preference',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'What is the standard spelling used by the app for the round type Favourite?',
    category: 'General Knowledge About Me',
    roundType: 'text',
    tags: 'quiz, app',
    correctAnswer: 'Favourite',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: Quick Fire questions can be multiple choice.',
    category: 'General Knowledge About Me',
    roundType: 'trueFalse',
    tags: 'quiz, app',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which category fits a question about spending on clothes?',
    category: 'Money',
    roundType: 'multipleChoice',
    tags: 'quiz, categories',
    multipleChoiceOptions: 'Money\nSports\nFriends\nMusic',
    correctAnswer: 'Money',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: "Both" can be a valid option in a who-is-more-likely question.',
    category: 'Opinions',
    roundType: 'trueFalse',
    tags: 'quiz, options',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which mode should be used when the host wants to judge the answer live?',
    category: 'General Knowledge About Me',
    roundType: 'multipleChoice',
    tags: 'quiz, round-types',
    multipleChoiceOptions: 'Manual\nNumeric\nTrue or False\nText',
    correctAnswer: 'Manual',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which answer best describes good flirting?',
    category: 'Dating',
    roundType: 'multipleChoice',
    tags: 'quiz, dating',
    multipleChoiceOptions: 'Playful and respectful\nPushy and vague\nSilent and confusing\nRushed and careless',
    correctAnswer: 'Playful and respectful',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: an answer can be edited before final scoring if the game flow allows it.',
    category: 'General Knowledge About Me',
    roundType: 'trueFalse',
    tags: 'quiz, app',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which category fits a question about private jokes and shared stories?',
    category: 'Memories',
    roundType: 'multipleChoice',
    tags: 'quiz, categories',
    multipleChoiceOptions: 'Memories\nTechnology\nShopping\nFitness',
    correctAnswer: 'Memories',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'What is the safest answer to "Can consent be withdrawn?"',
    category: 'Health & Wellness',
    roundType: 'multipleChoice',
    tags: 'quiz, consent',
    multipleChoiceOptions: 'Yes\nNo\nOnly before a date\nOnly in writing',
    correctAnswer: 'Yes',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: quiz questions should avoid having two equally correct answers.',
    category: 'General Knowledge About Me',
    roundType: 'trueFalse',
    tags: 'quiz, quality',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which category fits a question about bold future plans?',
    category: 'Future / Goals',
    roundType: 'multipleChoice',
    tags: 'quiz, categories',
    multipleChoiceOptions: 'Future / Goals\nFood & Drink\nCars & Driving\nSocial Media',
    correctAnswer: 'Future / Goals',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which player label is paired with the Kim account?',
    category: 'General Knowledge About Me',
    roundType: 'text',
    tags: 'quiz, players',
    correctAnswer: 'Kim',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which player label is paired with the Jay account?',
    category: 'General Knowledge About Me',
    roundType: 'text',
    tags: 'quiz, players',
    correctAnswer: 'Jay',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: a question maker draft should be reviewed before it enters the live bank.',
    category: 'General Knowledge About Me',
    roundType: 'trueFalse',
    tags: 'quiz, admin',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'Which category fits a question about a perfect night out?',
    category: 'Nightlife',
    roundType: 'multipleChoice',
    tags: 'quiz, categories',
    multipleChoiceOptions: 'Nightlife\nHome\nTechnology\nFamily',
    correctAnswer: 'Nightlife',
    notes: 'Quiz answer supplied by Question Maker.',
  },
  {
    question: 'True or false: a text quiz answer is easier to score when the expected answer is concise.',
    category: 'General Knowledge About Me',
    roundType: 'trueFalse',
    tags: 'quiz, quality',
    multipleChoiceOptions: 'True\nFalse',
    correctAnswer: 'True',
    notes: 'Quiz answer supplied by Question Maker.',
  },
];

const hashString = (value = '') =>
  [...String(value)].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);

const rotatePool = (pool, seed = '') => {
  if (!pool.length) return [];
  const start = hashString(seed) % pool.length;
  return [...pool.slice(start), ...pool.slice(0, start)];
};

const normalizeCandidate = (raw, bankType, seed, index) => ({
  localId: makeId('maker'),
  bankType,
  question: normalizeText(raw.question),
  category: normalizeText(raw.category),
  roundType: raw.roundType || (bankType === 'quiz' ? 'multipleChoice' : 'manual'),
  tags: normalizeText(raw.tags),
  notes: normalizeText(raw.notes),
  unitLabel: normalizeText(raw.unitLabel),
  scoringDivisor: raw.scoringDivisor ? String(raw.scoringDivisor) : '',
  multipleChoiceOptions: String(raw.multipleChoiceOptions || '').trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
  correctAnswer: bankType === 'quiz' ? normalizeText(raw.correctAnswer) : '',
  answerHint: normalizeText(raw.answerHint) || (bankType === 'quiz' ? 'Correct answer supplied below.' : 'No fixed answer. Each player answers live.'),
  sourceLabel: 'Admin Question Maker',
  generatedSeed: `${seed}-${index}`,
});

export const buildQuestionMakerBatch = ({ bankType = 'game', count = QUESTION_MAKER_BATCH_SIZE, seed = String(Date.now()) } = {}) => {
  const normalizedBankType = bankType === 'quiz' ? 'quiz' : 'game';
  const pool = normalizedBankType === 'quiz' ? QUIZ_QUESTION_POOL : GAME_QUESTION_POOL;
  const rotated = rotatePool(pool, seed);
  const selected = [];

  for (let index = 0; selected.length < count && index < rotated.length * 2; index += 1) {
    const item = rotated[index % rotated.length];
    selected.push(normalizeCandidate(item, normalizedBankType, seed, selected.length + 1));
  }

  return selected;
};

export const validateQuestionMakerCandidate = (candidate = {}) => {
  const errors = [];
  const bankType = candidate.bankType === 'quiz' ? 'quiz' : 'game';
  const roundType = candidate.roundType || (bankType === 'quiz' ? 'multipleChoice' : 'manual');
  const options = parseAnswerList(candidate.multipleChoiceOptions);
  const correctAnswer = normalizeText(candidate.correctAnswer);

  if (!normalizeText(candidate.question)) errors.push('Question text is required.');
  if (!normalizeText(candidate.category)) errors.push('Category is required.');

  if (roundType === 'multipleChoice' && options.length < 2) {
    errors.push('Multiple choice needs at least two options.');
  }

  if (bankType === 'quiz') {
    if (!correctAnswer) errors.push('Quiz questions need a correct answer.');
    if (roundType === 'trueFalse' && correctAnswer && !['true', 'false'].includes(correctAnswer.toLowerCase())) {
      errors.push('True / False quiz answers must be True or False.');
    }
    if (roundType === 'multipleChoice' && correctAnswer && options.length && !options.some((option) => option.toLowerCase() === correctAnswer.toLowerCase())) {
      errors.push('The correct answer should match one of the options.');
    }
  }

  return errors;
};

export const questionMakerCandidateToTemplate = (candidate = {}, { addedBy = '' } = {}) => {
  const bankType = candidate.bankType === 'quiz' ? 'quiz' : 'game';
  return createQuestionTemplate({
    question: candidate.question,
    category: candidate.category,
    roundType: candidate.roundType,
    tags: candidate.tags,
    notes: candidate.notes,
    unitLabel: candidate.unitLabel,
    scoringDivisor: candidate.scoringDivisor,
    multipleChoiceOptions: candidate.multipleChoiceOptions,
    source: 'questionMaker',
    sourceLabel: candidate.sourceLabel || 'Admin Question Maker',
    addedBy,
    bankType,
    ...(bankType === 'quiz' ? { correctAnswer: candidate.correctAnswer } : {}),
  });
};
