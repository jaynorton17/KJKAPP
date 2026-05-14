import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('question-bank-drafts', 'new-games-may-2026');

const headers = [
  'question',
  'category',
  'roundType',
  'defaultAnswerType',
  'answerType',
  'multipleChoiceOptions',
  'correctAnswer',
  'tags',
  'intensity',
  'tone',
  'relationshipArea',
  'avoidIf',
  'gameSuitability',
  'aiUseCase',
  'repeatGroup',
  'unitLabel',
  'scoringDivisor',
  'roundingMode',
  'roundPenaltyValue',
  'fixedPenalty',
  'scoringMode',
  'scoringOutcomeType',
  'notes',
  'sourceLabel',
  'addedBy',
  'active',
];

const answerTypeByRoundType = {
  numeric: 'number',
  rating: 'number',
  multipleChoice: 'multipleChoice',
  trueFalse: 'multipleChoice',
  preference: 'multipleChoice',
  sortIntoOrder: 'ranked',
  ranked: 'ranked',
  favourite: 'text',
  petPeeve: 'text',
  text: 'text',
};

const csvEscape = (value) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const slug = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const unique = (rows) => {
  const seen = new Set();
  return rows.filter((row) => {
    const key = slug(row.question);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const makeRow = ({
  question,
  category,
  roundType = 'text',
  options = '',
  tags = [],
  intensity = 2,
  tone = 'playful',
  relationshipArea = category,
  avoidIf = '',
  gameSuitability = '',
  aiUseCase = '',
  repeatGroup = '',
  unitLabel = '',
  roundPenaltyValue = 5,
  fixedPenalty = 5,
  scoringMode = 'manual',
  scoringOutcomeType = 'memory',
  notes = '',
  sourceLabel = '',
}) => {
  const answerType = answerTypeByRoundType[roundType] || 'text';
  return {
    question,
    category,
    roundType,
    defaultAnswerType: answerType,
    answerType,
    multipleChoiceOptions: Array.isArray(options) ? options.join('|') : options,
    correctAnswer: '',
    tags: Array.isArray(tags) ? tags.join(';') : tags,
    intensity,
    tone,
    relationshipArea,
    avoidIf,
    gameSuitability,
    aiUseCase,
    repeatGroup: repeatGroup || slug(`${category}-${question}`).slice(0, 44),
    unitLabel,
    scoringDivisor: '1',
    roundingMode: 'nearest',
    roundPenaltyValue,
    fixedPenalty,
    scoringMode,
    scoringOutcomeType,
    notes,
    sourceLabel,
    addedBy: 'Codex',
    active: 'TRUE',
  };
};

const writeCsv = (filename, rows) => {
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, filename), `${csv}\n`, 'utf8');
};

const redFlagCategories = {
  'Dating & Romance': [
    'plans a surprise date but keeps every detail secret until you arrive',
    'remembers a tiny romantic detail you mentioned once months ago',
    'expects a big romantic gesture every time you have a disagreement',
    'turns a normal errand into a little date without making a fuss',
    'posts a flirty photo caption about you before asking if you are comfortable with it',
    'keeps a running note of date ideas you might both enjoy',
  ],
  Communication: [
    'says they need twenty minutes to cool down before a serious conversation',
    'uses sarcasm when they are embarrassed instead of saying what they feel',
    'sends a long voice note instead of trying to argue by text',
    'checks whether you want advice or comfort before responding',
    'goes quiet and expects you to guess what is wrong',
    'admits they were defensive after they have had time to think',
  ],
  Boundaries: [
    'asks before sharing a private story about the two of you',
    'expects to know your phone password because you are together',
    'respects a no even when they are clearly disappointed',
    'makes a joke about your boundary in front of friends',
    'checks consent before trying something new in bed',
    'keeps pushing for an answer after you say you need time',
  ],
  Jealousy: [
    'gets protective when someone is clearly flirting with you',
    'asks a calm question about someone from your past instead of snooping',
    'makes a joke every time an ex is mentioned',
    'wants reassurance after seeing a flirty comment online',
    'compares themselves to someone you used to date',
    'turns jealousy into playful flirting rather than an argument',
  ],
  'Social Media': [
    'likes an exs photo but never speaks to them privately',
    'soft launches you online before you have agreed what to post',
    'keeps your relationship mostly private but is affectionate in real life',
    'checks your stories to see who has viewed them',
    'sends you spicy memes during a family event',
    'posts a joke about your argument after you have made up',
  ],
  Money: [
    'secretly saves for something you both want',
    'expects every bill to be split exactly even no matter the situation',
    'buys an expensive gift as an apology instead of talking properly',
    'is honest about money stress before it becomes a problem',
    'jokes about your spending in front of other people',
    'plans a cheap date and makes it feel thoughtful',
  ],
  'Friends & Family': [
    'defends you gently when family teasing goes too far',
    'tells their friends private details from your relationship',
    'makes real effort with your family even when they are nervous',
    'gets annoyed when you want separate time with friends',
    'checks in after a family event that felt tense',
    'expects you to take their side before hearing the full story',
  ],
  Trust: [
    'tells you about an awkward message before you discover it',
    'deletes messages because they think it will avoid drama',
    'admits a small mistake before it becomes a bigger secret',
    'asks to look through your phone after a bad dream',
    'keeps a private note of gift ideas and personal details',
    'says they trust you but keeps testing you anyway',
  ],
  'Sex & Intimacy': [
    'sends a risky text while you are both meant to be concentrating',
    'asks what kind of teasing is actually fun for you',
    'buys something naughty for you both without checking first',
    'remembers aftercare without being asked',
    'makes a private joke in public that only you two understand',
    'turns every cuddle into a negotiation for more',
    'asks for a clear yes before trying a new fantasy',
    'brags to a friend about something private between you',
  ],
  Habits: [
    'knows your routine well enough to make your day easier',
    'leaves small messes because they know you will tidy them',
    'makes a drink for you exactly how you like it',
    'uses weaponised helplessness for basic chores',
    'starts doing a habit you love because it matters to you',
    'keeps score of every little favour',
  ],
  Lifestyle: [
    'wants one lazy day together with no plans at all',
    'books a busy weekend without checking your energy first',
    'encourages your solo hobbies without making it about them',
    'needs constant plans to feel connected',
    'turns bedtime into a gossip debrief',
    'expects your routines to merge completely',
  ],
  'Future Plans': [
    'talks about the future in practical detail rather than vague promises',
    'avoids every future conversation with a joke',
    'has a five-year plan and quietly assumes you are in it',
    'asks what kind of life would actually make you happy',
    'changes a big plan without telling you until after',
    'dreams out loud but does not pressure you to decide now',
  ],
  Conflict: [
    'apologises without adding a but at the end',
    'keeps bringing up old arguments during new ones',
    'can laugh with you once the tension has genuinely passed',
    'needs to win the argument more than understand you',
    'suggests a reset cuddle after you have both said your piece',
    'uses silent treatment until you chase them',
  ],
  'Funny / Petty': [
    'steals your chips but offers you the best bite of theirs',
    'starts a fake rivalry over who is the better passenger princess',
    'hides the remote as a flirting tactic',
    'sends a thirst trap and then pretends it was accidental',
    'uses an inside joke to rescue a tense moment',
    'keeps a ridiculous scoreboard for tiny household wins',
  ],
  'Serious / Deep': [
    'shares a fear they usually hide',
    'asks what kind of support actually helps when you spiral',
    'turns a vulnerable moment into a joke too quickly',
    'remembers the hard anniversary without needing a reminder',
    'admits they are scared of needing you too much',
    'listens without trying to fix everything immediately',
  ],
};

const redFlagFrames = [
  (scenario) => `Your partner ${scenario}`,
  (scenario) => `Someone you are dating ${scenario}`,
  (scenario) => `In a long-term relationship, your partner ${scenario}`,
  (scenario) => `After a stressful week, your partner ${scenario}`,
  (scenario) => `During a playful night together, your partner ${scenario}`,
];

const buildRedFlagRows = () => {
  const rows = [];
  Object.entries(redFlagCategories).forEach(([category, scenarios], categoryIndex) => {
    scenarios.forEach((scenario, scenarioIndex) => {
      const frame = redFlagFrames[(categoryIndex + scenarioIndex) % redFlagFrames.length];
      rows.push(makeRow({
        question: frame(scenario),
        category,
        roundType: 'multipleChoice',
        options: ['Green Flag', 'Red Flag', 'Depends'],
        tags: [slug(category), 'judgement', scenario.includes('naughty') || category === 'Sex & Intimacy' ? 'naughty' : 'relationship'],
        intensity: category === 'Serious / Deep' || category === 'Boundaries' ? 4 : category === 'Sex & Intimacy' ? 3 : 2,
        tone: category === 'Serious / Deep' ? 'deep' : category === 'Sex & Intimacy' ? 'naughty-playful' : 'playful',
        relationshipArea: category,
        avoidIf: category === 'Sex & Intimacy' ? 'Skip if either player wants a non-spicy session' : '',
        gameSuitability: 'Red Flag Green Flag',
        aiUseCase: 'relationship judgement;diary insight',
        repeatGroup: `red-flag-${slug(category)}-${scenarioIndex}`,
        roundPenaltyValue: 10,
        fixedPenalty: 10,
        scoringMode: 'automatic',
        scoringOutcomeType: 'choice-match',
        notes: 'Players judge the scenario as Green Flag, Red Flag, or Depends, then guess each other.',
        sourceLabel: 'Red Flag Green Flag Draft May 2026',
      }));
    });
  });

  const twists = [
    'but only when they think it will make you laugh',
    'without mentioning it until later',
    'and checks afterwards whether it landed well',
    'in front of friends',
    'after you have already said you are tired',
    'as a private joke between the two of you',
    'because they think it proves they care',
    'then apologises properly when it feels off',
  ];
  const baseRows = [...rows];
  baseRows.forEach((row, index) => {
    if (rows.length >= 300) return;
    rows.push({
      ...row,
      question: `${row.question} ${twists[index % twists.length]}`,
      repeatGroup: `${row.repeatGroup}-twist-${index % twists.length}`,
      intensity: Math.min(5, Number(row.intensity || 2) + (index % 5 === 0 ? 1 : 0)),
      notes: `${row.notes} Variation adds context so it does not feel like a duplicate.`,
    });
  });

  const extraContexts = [
    'before a night out',
    'after a few drinks',
    'when family are nearby',
    'when one of you is already insecure',
    'during a cosy private night',
    'after a flirty message',
    'when you are both overtired',
    'when the relationship feels very secure',
    'when you have not seen each other much',
    'after one of you has opened up',
    'on holiday',
    'in a group chat',
  ];
  for (let index = 0; rows.length < 300; index += 1) {
    const row = baseRows[index % baseRows.length];
    const twist = twists[index % twists.length];
    const context = extraContexts[Math.floor(index / baseRows.length) % extraContexts.length];
    rows.push({
      ...row,
      question: `${row.question} ${twist} ${context}`,
      repeatGroup: `${row.repeatGroup}-extra-${index}`,
      intensity: Math.min(5, Number(row.intensity || 2) + (context.includes('insecure') || context.includes('opened up') ? 1 : 0)),
      notes: `${row.notes} Extra variation for larger import batches.`,
    });
  }

  return unique(rows).slice(0, 300);
};

const compatibilityPrompts = [
  {
    category: 'Values',
    type: 'sortIntoOrder',
    question: 'Sort these from most to least important in a long-term relationship',
    options: ['Trust', 'Fun', 'Stability', 'Passion'],
    tags: ['values', 'future'],
    tone: 'thoughtful',
  },
  {
    category: 'Romance',
    type: 'multipleChoice',
    question: 'What kind of romantic gesture lands best for you?',
    options: ['A planned date', 'A thoughtful message', 'Practical help', 'Physical affection'],
    tags: ['romance', 'love-language'],
    tone: 'warm',
  },
  {
    category: 'Sex & Intimacy',
    type: 'preference',
    question: 'Which private vibe would you choose more often?',
    options: ['Slow and soft', 'Naughty and teasing'],
    tags: ['intimacy', 'naughty'],
    tone: 'naughty-playful',
    intensity: 4,
  },
  {
    category: 'Lifestyle',
    type: 'multipleChoice',
    question: 'What is your ideal Sunday together?',
    options: ['Lie-in and cuddles', 'Food and a walk', 'Seeing people', 'Getting jobs done'],
    tags: ['weekend', 'routine'],
  },
  {
    category: 'Future Plans',
    type: 'multipleChoice',
    question: 'Which future goal feels most exciting to build together?',
    options: ['A home', 'Travel', 'Financial freedom', 'A calmer life'],
    tags: ['future', 'goals'],
  },
  {
    category: 'Money',
    type: 'preference',
    question: 'When money is tight, what feels more natural?',
    options: ['Cut back hard', 'Keep small treats'],
    tags: ['money', 'stress'],
    tone: 'practical',
  },
  {
    category: 'Home',
    type: 'sortIntoOrder',
    question: 'Sort these home priorities from most to least important',
    options: ['Clean kitchen', 'Cosy bedroom', 'Quiet space', 'Nice food'],
    tags: ['home', 'routine'],
  },
  {
    category: 'Travel',
    type: 'preference',
    question: 'What is your ideal holiday pace?',
    options: ['Slow and relaxed', 'Packed with plans'],
    tags: ['travel', 'planning'],
  },
  {
    category: 'Food & Drink',
    type: 'multipleChoice',
    question: 'Pick the date-night food mood you would choose first',
    options: ['Takeaway in bed', 'Fancy restaurant', 'Street food adventure', 'Home-cooked comfort'],
    tags: ['food', 'date-night'],
  },
  {
    category: 'Communication',
    type: 'rating',
    question: 'Rate how much reassurance you like during a difficult week',
    tags: ['communication', 'reassurance'],
    tone: 'thoughtful',
  },
  {
    category: 'Conflict',
    type: 'multipleChoice',
    question: 'What helps you reset fastest after tension?',
    options: ['Space first', 'Talk immediately', 'A cuddle', 'A joke once calm'],
    tags: ['conflict', 'repair'],
  },
  {
    category: 'Family',
    type: 'multipleChoice',
    question: 'How involved should family be in big decisions?',
    options: ['Very involved', 'Asked for advice only', 'Told after deciding', 'Kept mostly separate'],
    tags: ['family', 'boundaries'],
  },
  {
    category: 'Social Life',
    type: 'preference',
    question: 'What feels better after a long week?',
    options: ['A night out with people', 'A private night in'],
    tags: ['social', 'energy'],
  },
  {
    category: 'Personality',
    type: 'rating',
    question: 'Rate how competitive you secretly are',
    tags: ['personality', 'competition'],
    tone: 'playful',
  },
  {
    category: 'Dreams & Goals',
    type: 'ranked',
    question: 'Name your top three dreams you would love support with',
    tags: ['dreams', 'support'],
    tone: 'deep',
  },
  {
    category: 'Daily Habits',
    type: 'numeric',
    question: 'How many quiet minutes alone do you ideally need each day?',
    tags: ['daily-habits', 'alone-time'],
    unitLabel: 'minutes',
    tone: 'practical',
  },
  {
    category: 'Sex & Intimacy',
    type: 'rating',
    question: 'Rate how much playful teasing you like when you are both in the mood',
    tags: ['intimacy', 'teasing', 'naughty'],
    tone: 'naughty-playful',
    intensity: 4,
  },
  {
    category: 'Romance',
    type: 'favourite',
    question: 'What is your favourite kind of affection when no one else is around?',
    tags: ['affection', 'private'],
    tone: 'warm',
  },
  {
    category: 'Communication',
    type: 'text',
    question: 'What phrase instantly makes you feel understood?',
    tags: ['communication', 'reassurance'],
    tone: 'warm',
  },
  {
    category: 'Lifestyle',
    type: 'petPeeve',
    question: 'What tiny household habit would quietly test your patience?',
    tags: ['habits', 'pet-peeve'],
    tone: 'playful',
  },
];

const compatibilityVariants = [
  'when life is calm',
  'when one of you is stressed',
  'on a lazy weekend',
  'during a romantic night in',
  'when you are both feeling playful',
  'after a disagreement',
  'on holiday',
  'when planning the future',
  'when money is tighter than usual',
  'when you both need reassurance',
  'during a naughty private mood',
  'when family or friends are around',
  'when you have not had enough sleep',
  'when you want the night to feel special',
  'when everything has been a bit too serious',
];

const buildCompatibilityRows = () => {
  const rows = [];
  compatibilityPrompts.forEach((prompt, promptIndex) => {
    compatibilityVariants.forEach((variant, variantIndex) => {
      if (rows.length >= 300) return;
      const isQuestionAlreadyContextual = /\bwhen\b|\bduring\b|\bafter\b|\bon\b/i.test(prompt.question);
      const question = isQuestionAlreadyContextual
        ? `${prompt.question} (${variant})`
        : `${prompt.question} ${variant}?`;
      rows.push(makeRow({
        question,
        category: prompt.category,
        roundType: prompt.type,
        options: prompt.options || '',
        tags: [...(prompt.tags || []), slug(variant)],
        intensity: prompt.intensity || (prompt.category === 'Sex & Intimacy' ? 4 : prompt.tone === 'deep' ? 3 : 2),
        tone: prompt.tone || 'playful',
        relationshipArea: prompt.category,
        avoidIf: prompt.category === 'Sex & Intimacy' ? 'Skip if either player wants a non-spicy session' : '',
        gameSuitability: 'Compatibility Meter',
        aiUseCase: 'compatibility scoring;analytics;diary insight',
        repeatGroup: `compat-${slug(prompt.category)}-${promptIndex}-${variantIndex}`,
        unitLabel: prompt.unitLabel || '',
        roundPenaltyValue: 0,
        fixedPenalty: 0,
        scoringMode: 'automatic',
        scoringOutcomeType: 'compatibility',
        notes: 'Both players answer the same prompt. Matching or similar answers produce a stronger compatibility score.',
        sourceLabel: 'Compatibility Draft May 2026',
      }));
    });
  });
  return unique(rows).slice(0, 300);
};

const memoryPrompts = [
  {
    category: 'Us / Relationship Memories',
    type: 'text',
    question: 'What is the first tiny moment you remember thinking this could become something?',
    tags: ['relationship', 'firsts'],
    tone: 'romantic',
    intensity: 3,
  },
  {
    category: 'Earliest Memories',
    type: 'text',
    question: 'What is your earliest clear memory of feeling completely safe?',
    tags: ['earliest', 'safe'],
    tone: 'warm',
  },
  {
    category: 'Childhood',
    type: 'ranked',
    question: 'Name your top three childhood places that still feel important',
    tags: ['childhood', 'places'],
    tone: 'nostalgic',
  },
  {
    category: 'Achievements',
    type: 'text',
    question: 'What achievement are you prouder of than people realise?',
    tags: ['achievement', 'pride'],
    tone: 'deep',
  },
  {
    category: 'Embarrassments',
    type: 'text',
    question: 'What embarrassing moment can you laugh about now but absolutely could not laugh about then?',
    tags: ['embarrassment', 'funny'],
    tone: 'playful',
  },
  {
    category: 'Firsts',
    type: 'favourite',
    question: 'What first experience would you happily replay once?',
    tags: ['firsts', 'replay'],
    tone: 'warm',
  },
  {
    category: 'Funny Moments',
    type: 'text',
    question: 'What memory still makes you laugh for a stupid reason?',
    tags: ['funny', 'laughter'],
    tone: 'playful',
  },
  {
    category: 'Family',
    type: 'multipleChoice',
    question: 'Which kind of family memory sticks with you most?',
    options: ['Funny chaos', 'Warm tradition', 'Awkward drama', 'Quiet support'],
    tags: ['family', 'memory-style'],
    tone: 'nostalgic',
  },
  {
    category: 'Friends',
    type: 'text',
    question: 'What friend memory shaped the way you trust people?',
    tags: ['friends', 'trust'],
    tone: 'thoughtful',
  },
  {
    category: 'School',
    type: 'petPeeve',
    question: 'What school memory still irritates you a little bit?',
    tags: ['school', 'pet-peeve'],
    tone: 'playful',
  },
  {
    category: 'Work',
    type: 'text',
    question: 'What work moment made you realise you were tougher than you thought?',
    tags: ['work', 'resilience'],
    tone: 'deep',
  },
  {
    category: 'Travel',
    type: 'favourite',
    question: 'What place from your past would you take the other person to first?',
    tags: ['travel', 'places'],
    tone: 'romantic',
  },
  {
    category: 'Milestones',
    type: 'numeric',
    question: 'How old were you when you first felt properly independent?',
    tags: ['milestone', 'age'],
    unitLabel: 'years old',
    tone: 'thoughtful',
  },
  {
    category: 'Songs / Places / Food',
    type: 'favourite',
    question: 'What song instantly drops you back into a specific memory?',
    tags: ['song', 'nostalgia'],
    tone: 'nostalgic',
  },
  {
    category: 'Forgotten Details',
    type: 'multipleChoice',
    question: 'Which detail do you usually remember best?',
    options: ['Exact words', 'Faces', 'Feelings', 'Places'],
    tags: ['memory-style', 'details'],
    tone: 'curious',
  },
  {
    category: 'Sex & Intimacy Memories',
    type: 'text',
    question: 'What flirty or naughty moment between you still makes you grin?',
    tags: ['naughty', 'relationship', 'private'],
    tone: 'naughty-playful',
    intensity: 4,
    avoidIf: 'Skip if either player wants a non-spicy session',
  },
  {
    category: 'Us / Relationship Memories',
    type: 'rating',
    question: 'Rate how strongly you remember the first time the chemistry felt obvious',
    tags: ['chemistry', 'relationship'],
    tone: 'romantic',
    intensity: 4,
  },
  {
    category: 'Embarrassments',
    type: 'trueFalse',
    question: 'True or false: you still replay one embarrassing memory even though nobody else remembers it',
    tags: ['embarrassment', 'true-false'],
    tone: 'playful',
  },
  {
    category: 'Childhood',
    type: 'sortIntoOrder',
    question: 'Sort these childhood memory triggers from strongest to weakest for you',
    options: ['Smell', 'Song', 'Place', 'Photo'],
    tags: ['childhood', 'memory-triggers'],
    tone: 'nostalgic',
  },
  {
    category: 'Firsts',
    type: 'multipleChoice',
    question: 'Which first is easiest for you to remember clearly?',
    options: ['First crush', 'First big win', 'First heartbreak', 'First adventure'],
    tags: ['firsts', 'memory-style'],
    tone: 'playful',
  },
];

const memoryVariants = [
  'from before you met',
  'from the early days of Jay and Kim',
  'that you have never fully explained',
  'that would make the other person understand you better',
  'that feels funnier now than it did then',
  'that still feels a bit tender',
  'that you would put in a private diary chapter',
  'that involved a place, song, food, or smell',
  'that changed how you see yourself',
  'that you would only tell someone you really trust',
  'that was slightly naughty but still sweet',
  'that deserves to be remembered properly',
  'that made you feel chosen',
  'that made you grow up a bit',
  'that you wish you had a photo of',
];

const buildMemoryRows = () => {
  const rows = [];
  memoryPrompts.forEach((prompt, promptIndex) => {
    memoryVariants.forEach((variant, variantIndex) => {
      if (rows.length >= 300) return;
      const question = `${prompt.question.replace(/[?!.]+$/, '')} ${variant}?`;
      rows.push(makeRow({
        question,
        category: prompt.category,
        roundType: prompt.type,
        options: prompt.options || (prompt.type === 'trueFalse' ? ['True', 'False'] : ''),
        tags: [...(prompt.tags || []), slug(variant)],
        intensity: prompt.intensity || (prompt.tone === 'deep' ? 3 : 2),
        tone: prompt.tone || 'nostalgic',
        relationshipArea: prompt.category,
        avoidIf: prompt.avoidIf || '',
        gameSuitability: 'Memory Lane',
        aiUseCase: 'memory prompt;diary insight;relationship history',
        repeatGroup: `memory-${slug(prompt.category)}-${promptIndex}-${variantIndex}`,
        unitLabel: prompt.unitLabel || '',
        roundPenaltyValue: 5,
        fixedPenalty: 5,
        scoringMode: 'manual',
        scoringOutcomeType: 'memory',
        notes: 'Sheet prompt for Memory Lane. The app also generates separate past-answer recall rounds automatically.',
        sourceLabel: 'Memory Lane Draft May 2026',
      }));
    });
  });
  return unique(rows).slice(0, 300);
};

const files = [
  ['Red Flag Green Flag.csv', buildRedFlagRows()],
  ['Compatibility.csv', buildCompatibilityRows()],
  ['Memory Lane.csv', buildMemoryRows()],
];

files.forEach(([filename, rows]) => {
  writeCsv(filename, rows);
  console.log(`${filename}: ${rows.length} rows`);
});
