import fs from 'node:fs';
import path from 'node:path';
import {
  FIELD_ALIASES,
  QUESTION_TYPE_TO_ANSWER_TYPE,
  buildEmptyNormalizedQuestion,
  compactSingleLine,
  getConstValue,
  loadGameSchema,
  normalizeText,
  slugify,
  toDelimitedString,
} from '../shared.mjs';

const MAX_GENERATION_BATCH_SIZE = 20;

const invertAliasMap = () => {
  const map = new Map();
  Object.entries(FIELD_ALIASES).forEach(([target, aliases]) => {
    aliases.forEach((alias) => map.set(alias, target));
  });
  return map;
};

const ALIAS_TO_FIELD = invertAliasMap();

const normalizeFieldValue = (field, value) => {
  if (value == null) return null;
  if (['options', 'tags', 'avoidIf', 'gameSuitability', 'aiUseCase'].includes(field)) {
    return toDelimitedString(value);
  }
  if (field === 'question' || field === 'notes') return normalizeText(value);
  if (typeof value === 'string') return compactSingleLine(value);
  return value;
};

export const normalizeGeneratedQuestion = ({ gameSlug, rawQuestion, index = 0 }) => {
  const schema = loadGameSchema(gameSlug);
  const question = buildEmptyNormalizedQuestion();

  Object.entries(rawQuestion || {}).forEach(([rawKey, rawValue]) => {
    const targetField = ALIAS_TO_FIELD.get(rawKey) || rawKey;
    if (!(targetField in question)) return;
    question[targetField] = normalizeFieldValue(targetField, rawValue);
  });

  const constFields = ['sheet', 'game', 'active', 'sourceLabel', 'addedBy'];
  constFields.forEach((field) => {
    if (question[field] == null) question[field] = getConstValue(schema, field) ?? null;
  });

  if (!question.defaultAnswerType && question.questionType) {
    question.defaultAnswerType = QUESTION_TYPE_TO_ANSWER_TYPE[question.questionType] || null;
  }
  if (!question.answerType && question.defaultAnswerType) {
    question.answerType = question.defaultAnswerType;
  }
  if (!question.repeatGroup && question.category && question.question) {
    question.repeatGroup = slugify(`${question.category}-${question.question}`).slice(0, 64) || `row-${index + 1}`;
  }
  if (!question.originalSheet) question.originalSheet = question.sheet;
  if (!question.originalQuestionType) question.originalQuestionType = question.questionType;

  return question;
};

export const parseGeneratedBatchInput = ({ filePath, rawText, value }) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && !rawText && fs.existsSync(path.resolve(value))) {
    return JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
  }
  if (filePath) return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  if (rawText) return JSON.parse(rawText);
  if (typeof value === 'string') return JSON.parse(value);
  throw new Error('Generator input must be a JSON array or a path to a JSON file.');
};

export const normalizeGeneratedBatch = ({ gameSlug, filePath, rawText, value }) => {
  const parsed = parseGeneratedBatchInput({ filePath, rawText, value });
  if (!Array.isArray(parsed)) {
    throw new Error('Generator output must be a JSON array of structured question objects.');
  }
  if (parsed.length > MAX_GENERATION_BATCH_SIZE) {
    throw new Error(`Generator batch contains ${parsed.length} objects. Generation batches must be 20 objects or fewer.`);
  }
  return parsed.map((rawQuestion, index) => normalizeGeneratedQuestion({ gameSlug, rawQuestion, index }));
};

export const buildFailedRowRegenerationRequest = ({
  gameSlug,
  failedRows = [],
  batchMode = 'generation',
}) => ({
  gameSlug,
  batchMode: failedRows.length && batchMode !== 'generation' ? batchMode : 'regeneration',
  rowCount: failedRows.length,
  failedRows: failedRows.map((entry) => ({
    arrayIndex: entry.index,
    rowNumber: entry.index + 1,
    repeatGroup: entry.question?.repeatGroup || null,
    questionType: entry.question?.questionType || null,
    category: entry.question?.category || null,
    reasons: entry.errors || [],
  })),
  instruction: 'Regenerate only these failed rows as structured JSON objects. Do not regenerate any passing rows.',
});

export const MAX_BATCH_SIZE = MAX_GENERATION_BATCH_SIZE;
