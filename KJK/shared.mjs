import fs from 'node:fs';
import path from 'node:path';

export const KJK_ROOT = path.resolve('KJK');
export const GAMES_ROOT = path.join(KJK_ROOT, 'games');

export const TEMPLATE_COLUMN_TO_FIELD = {
  Sheet: 'sheet',
  Game: 'game',
  Question: 'question',
  Category: 'category',
  'Question Type': 'questionType',
  Options: 'options',
  'Correct Answer': 'correctAnswer',
  Active: 'active',
  Intensity: 'intensity',
  Tone: 'tone',
  'Relationship Area': 'relationshipArea',
  Tags: 'tags',
  Notes: 'notes',
  'Memory Lane Mode': 'memoryLaneMode',
  'Avoid If': 'avoidIf',
  'Game Suitability': 'gameSuitability',
  'AI Use Case': 'aiUseCase',
  'Repeat Group': 'repeatGroup',
  'Default Answer Type': 'defaultAnswerType',
  'Answer Type': 'answerType',
  'Unit Label': 'unitLabel',
  'Scoring Divisor': 'scoringDivisor',
  'Rounding Mode': 'roundingMode',
  'Round Penalty Value': 'roundPenaltyValue',
  'Fixed Penalty': 'fixedPenalty',
  'Scoring Mode': 'scoringMode',
  'Scoring Outcome Type': 'scoringOutcomeType',
  'Source Label': 'sourceLabel',
  'Added By': 'addedBy',
  'Original Sheet': 'originalSheet',
  'Original Question Type': 'originalQuestionType',
};

export const FIELD_ALIASES = {
  sheet: ['sheet'],
  game: ['game'],
  question: ['question', 'prompt', 'text'],
  category: ['category'],
  questionType: ['questionType', 'type', 'roundType'],
  options: ['options', 'multipleChoiceOptions', 'choices'],
  correctAnswer: ['correctAnswer', 'answer'],
  active: ['active'],
  intensity: ['intensity'],
  tone: ['tone'],
  relationshipArea: ['relationshipArea'],
  tags: ['tags'],
  notes: ['notes'],
  memoryLaneMode: ['memoryLaneMode'],
  avoidIf: ['avoidIf'],
  gameSuitability: ['gameSuitability'],
  aiUseCase: ['aiUseCase'],
  repeatGroup: ['repeatGroup'],
  defaultAnswerType: ['defaultAnswerType'],
  answerType: ['answerType'],
  unitLabel: ['unitLabel'],
  scoringDivisor: ['scoringDivisor'],
  roundingMode: ['roundingMode'],
  roundPenaltyValue: ['roundPenaltyValue'],
  fixedPenalty: ['fixedPenalty'],
  scoringMode: ['scoringMode'],
  scoringOutcomeType: ['scoringOutcomeType'],
  sourceLabel: ['sourceLabel'],
  addedBy: ['addedBy'],
  originalSheet: ['originalSheet'],
  originalQuestionType: ['originalQuestionType'],
};

export const QUESTION_TYPE_TO_ANSWER_TYPE = {
  Favourite: 'text',
  'Fill in the Blank': 'text',
  'Multiple Choice': 'multipleChoice',
  Numeric: 'number',
  'Open Answer': 'text',
  'Pet Peeve': 'text',
  Preference: 'multipleChoice',
  'Ranked / Top 3': 'ranked',
  Ranking: 'ranked',
  Rating: 'number',
  'Text Answer': 'text',
  'True or False': 'multipleChoice',
  'Who is more likely to': 'multipleChoice',
  'Would you rather': 'multipleChoice',
  'Sort Into Order': 'ranked',
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'both',
  'do',
  'for',
  'from',
  'how',
  'if',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'them',
  'these',
  'those',
  'to',
  'what',
  'when',
  'which',
  'who',
  'would',
  'you',
  'your',
]);

export const normalizeText = (value) =>
  String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

export const compactSingleLine = (value) => normalizeText(value).replace(/\s+/g, ' ');

export const normalizeKey = (value) => compactSingleLine(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

export const slugify = (value) =>
  compactSingleLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const toDelimitedString = (value) => {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const items = value.map((item) => compactSingleLine(item)).filter(Boolean);
    return items.length ? items.join('|') : null;
  }
  const text = compactSingleLine(value);
  return text || null;
};

export const escapeCsvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const parseCsv = (rawText = '') => {
  const rows = [];
  const text = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n' && !inQuotes) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => String(cell || '').trim()));
};

export const parseCsvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return [];
  return parseCsv(fs.readFileSync(filePath, 'utf8'));
};

export const readJsonFile = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

export const getGameDirectory = (gameSlug) => path.join(GAMES_ROOT, gameSlug);

export const loadGameSchema = (gameSlug) => readJsonFile(path.join(getGameDirectory(gameSlug), 'schema.json'));

export const loadTemplateColumns = (gameSlug) => {
  const rows = parseCsvFile(path.join(getGameDirectory(gameSlug), 'upload-template.csv'));
  return rows[0] || [];
};

export const getAllowedValues = (schema, propertyName) => {
  const property = schema?.properties?.[propertyName];
  if (!property || !Array.isArray(property.enum)) return [];
  return property.enum.slice();
};

export const getConstValue = (schema, propertyName) => schema?.properties?.[propertyName]?.const;

export const listGameSlugs = () =>
  fs.readdirSync(GAMES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

export const buildEmptyNormalizedQuestion = () => ({
  sheet: null,
  game: null,
  question: null,
  category: null,
  questionType: null,
  options: null,
  correctAnswer: null,
  active: null,
  intensity: null,
  tone: null,
  relationshipArea: null,
  tags: null,
  notes: null,
  memoryLaneMode: null,
  avoidIf: null,
  gameSuitability: null,
  aiUseCase: null,
  repeatGroup: null,
  defaultAnswerType: null,
  answerType: null,
  unitLabel: null,
  scoringDivisor: null,
  roundingMode: null,
  roundPenaltyValue: null,
  fixedPenalty: null,
  scoringMode: null,
  scoringOutcomeType: null,
  sourceLabel: null,
  addedBy: null,
  originalSheet: null,
  originalQuestionType: null,
});

export const tokenizeQuestion = (value) =>
  compactSingleLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

export const meaningfulTokens = (value) =>
  tokenizeQuestion(value).filter((token) => !STOP_WORDS.has(token));

export const questionKey = (value) => meaningfulTokens(value).join(' ');

export const questionTemplateKey = (value) => questionKey(value).replace(/\b\d+\b/g, '').trim();

export const openerKey = (value, size = 5) => meaningfulTokens(value).slice(0, size).join(' ');

export const parseOptionList = (value) =>
  String(value ?? '')
    .split('|')
    .map((item) => compactSingleLine(item))
    .filter(Boolean);

export const optionPoolKey = (value) => parseOptionList(value).map((item) => item.toLowerCase()).sort().join('|');

export const jaccardSimilarity = (leftValues = [], rightValues = []) => {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  if (!left.size && !right.size) return 1;
  const intersection = [...left].filter((item) => right.has(item)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
};

export const normalizeExistingCsvQuestions = (rows = []) => {
  if (!rows.length) return [];
  const [headers, ...dataRows] = rows;
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  return dataRows.map((cells) => ({
    question: compactSingleLine(cells[columnIndex.get('Question')] || ''),
    options: compactSingleLine(cells[columnIndex.get('Options')] || ''),
  })).filter((row) => row.question);
};
