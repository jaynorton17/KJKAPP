import path from 'node:path';
import {
  QUESTION_TYPE_TO_ANSWER_TYPE,
  compactSingleLine,
  getAllowedValues,
  getGameDirectory,
  jaccardSimilarity,
  loadGameSchema,
  normalizeExistingCsvQuestions,
  normalizeKey,
  openerKey,
  optionPoolKey,
  parseCsvFile,
  parseOptionList,
  questionKey,
  questionTemplateKey,
  tokenizeQuestion,
} from '../shared.mjs';
import { buildFailedRowRegenerationRequest, MAX_BATCH_SIZE } from '../generators/service.mjs';

const FIXED_CHOICE_GAME_SLUGS = new Set([
  'true-or-false',
  'whos-more-likely-to',
  'red-flag-green-flag',
]);

const CHOICE_TYPES_REQUIRING_OPTIONS = new Set([
  'Multiple Choice',
  'Preference',
  'Would you rather',
  'Sort Into Order',
  'Ranking',
]);

const EXCLUDED_OPTION_REQUIREMENT_TYPES = new Set([
  'Who is more likely to',
  'True or False',
]);

const PLACEHOLDER_VALUES = /^(n\/a|na|none|null|tbc|unknown|placeholder)$/i;

const TYPE_CHECKERS = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  null: (value) => value === null,
  object: (value) => value != null && typeof value === 'object' && !Array.isArray(value),
};

const buildPropertyLabel = (name) => name;

const validateSchemaProperty = (propertyName, definition, value) => {
  const errors = [];
  const label = buildPropertyLabel(propertyName);
  const allowedTypes = Array.isArray(definition.type) ? definition.type : definition.type ? [definition.type] : [];

  if (definition.const !== undefined && value !== definition.const) {
    errors.push(`${label} must equal "${definition.const}".`);
    return errors;
  }

  if (value == null) {
    if (allowedTypes.length && !allowedTypes.includes('null')) {
      errors.push(`${label} cannot be null.`);
    }
    return errors;
  }

  if (allowedTypes.length && !allowedTypes.some((type) => TYPE_CHECKERS[type]?.(value))) {
    errors.push(`${label} must be of type ${allowedTypes.join(' or ')}.`);
    return errors;
  }

  if (definition.enum && !definition.enum.includes(value)) {
    errors.push(`${label} must be one of: ${definition.enum.join(', ')}.`);
  }

  if (definition.minLength && typeof value === 'string' && value.length < definition.minLength) {
    errors.push(`${label} must be at least ${definition.minLength} characters.`);
  }

  if (definition.pattern && typeof value === 'string' && value !== '' && !(new RegExp(definition.pattern).test(value))) {
    errors.push(`${label} does not match required format.`);
  }

  return errors;
};

const validateAgainstSchema = (schema, question) => {
  const errors = [];
  const allowedFields = new Set(Object.keys(schema.properties || {}));
  const providedFields = Object.keys(question || {});

  (schema.required || []).forEach((field) => {
    const value = question?.[field];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      errors.push(`${field} is required.`);
    }
  });

  if (schema.additionalProperties === false) {
    providedFields
      .filter((field) => !allowedFields.has(field))
      .forEach((field) => errors.push(`Unexpected property "${field}".`));
  }

  Object.entries(schema.properties || {}).forEach(([propertyName, definition]) => {
    if (!(propertyName in question)) return;
    errors.push(...validateSchemaProperty(propertyName, definition, question[propertyName]));
  });

  return errors;
};

const validateAnswerTypeMapping = (question) => {
  const expectedType = QUESTION_TYPE_TO_ANSWER_TYPE[question.questionType];
  const errors = [];
  if (!expectedType) return errors;
  if (question.defaultAnswerType !== expectedType) {
    errors.push(`defaultAnswerType must be "${expectedType}" for question type "${question.questionType}".`);
  }
  if (question.answerType !== expectedType) {
    errors.push(`answerType must be "${expectedType}" for question type "${question.questionType}".`);
  }
  return errors;
};

const validateChoiceRules = (gameSlug, question) => {
  const errors = [];
  const options = parseOptionList(question.options);
  const optionKey = optionPoolKey(question.options);
  const isFixedChoiceGame = FIXED_CHOICE_GAME_SLUGS.has(gameSlug);
  const typeRequiresOptions = CHOICE_TYPES_REQUIRING_OPTIONS.has(question.questionType) && !EXCLUDED_OPTION_REQUIREMENT_TYPES.has(question.questionType);

  if (isFixedChoiceGame) {
    if (question.options) errors.push('options must be blank because the app supplies the choices for this game.');
    if (question.correctAnswer) errors.push('correctAnswer must be blank because the app supplies the choices for this game.');
  }

  if (question.questionType === 'Who is more likely to') {
    if (question.options) errors.push('options must be blank for "Who is more likely to" questions.');
    if (!/who\s+is\s+more\s+likely\s+to/i.test(question.question || '')) {
      errors.push('question should clearly use the "Who is more likely to" format.');
    }
  }

  if (question.questionType === 'True or False' && gameSlug !== 'quick-fire-quiz') {
    if (question.options) errors.push('options must be blank for "True or False" questions.');
    if (question.correctAnswer) errors.push('correctAnswer must be blank for "True or False" questions outside Quick Fire Quiz.');
  }

  if (gameSlug === 'quick-fire-quiz') {
    if (!question.correctAnswer) {
      errors.push('correctAnswer is required for Quick Fire Quiz.');
    }
    if (question.questionType === 'Multiple Choice' && question.correctAnswer && !options.includes(question.correctAnswer)) {
      errors.push('correctAnswer must appear inside options for Quick Fire Quiz multiple-choice rows.');
    }
    if (question.questionType === 'True or False' && options.length) {
      errors.push('options must be blank for Quick Fire Quiz true/false rows.');
    }
  }

  if (gameSlug === 'memory-lane') {
    if (question.memoryLaneMode === 'pastAnswerRecall') {
      if (question.questionType !== 'Multiple Choice') {
        errors.push('Memory Lane pastAnswerRecall rows must use questionType "Multiple Choice".');
      }
      if (!question.correctAnswer) errors.push('Memory Lane pastAnswerRecall rows require correctAnswer.');
      if (question.correctAnswer && !options.includes(question.correctAnswer)) {
        errors.push('Memory Lane pastAnswerRecall correctAnswer must appear in options.');
      }
      if (options.length < 3) errors.push('Memory Lane pastAnswerRecall rows need at least three options.');
    }
    if (question.memoryLaneMode === 'memoryPrompt') {
      if (question.correctAnswer) errors.push('Memory Lane memoryPrompt rows must leave correctAnswer blank.');
      if (question.questionType === 'Text Answer' && options.length) {
        errors.push('Memory Lane text memory prompts must leave options blank.');
      }
    }
  }

  if (gameSlug === 'this-or-that' && options.length !== 2) {
    errors.push('This or That rows must include exactly two options.');
  }

  if (typeRequiresOptions && options.length < 2) {
    errors.push(`${question.questionType} rows must include at least two options.`);
  }

  if (question.questionType === 'Sort Into Order' && options.length < 3) {
    errors.push('Sort Into Order rows need at least three options.');
  }

  if (question.questionType === 'Ranked / Top 3' && options.length && options.length < 3) {
    errors.push('Ranked / Top 3 rows with fixed choices need at least three options.');
  }

  if (options.length !== new Set(options.map((item) => item.toLowerCase())).size) {
    errors.push('options must be unique within the row.');
  }

  if (optionKey && /^(jay|kim|both|neither)(\|(jay|kim|both|neither))*$/i.test(optionKey) && gameSlug !== 'quick-fire-quiz') {
    errors.push('options must not use the built-in player-choice pool unless the app supplies it.');
  }

  return errors;
};

const validateQualityRules = (gameSlug, questions) => {
  const perRowErrors = new Map();
  const pushError = (index, message) => {
    const list = perRowErrors.get(index) || [];
    list.push(message);
    perRowErrors.set(index, list);
  };

  const existingRows = normalizeExistingCsvQuestions(parseCsvFile(path.join(getGameDirectory(gameSlug), 'existing-questions.csv')));
  const remainingRows = normalizeExistingCsvQuestions(parseCsvFile(path.join(getGameDirectory(gameSlug), 'remaining-questions.csv')));
  const historicalQuestions = [...existingRows, ...remainingRows];
  const historicalQuestionKeys = new Set(historicalQuestions.map((row) => questionKey(row.question)).filter(Boolean));
  const historicalOptionKeys = new Set(historicalQuestions.map((row) => optionPoolKey(row.options)).filter(Boolean));

  const seenQuestionKeys = new Map();
  const seenTemplateKeys = new Map();
  const seenOptionKeys = new Map();
  const openerBuckets = new Map();

  questions.forEach((question, index) => {
    const exactKey = questionKey(question.question);
    const templateKey = questionTemplateKey(question.question);
    const optionsKey = optionPoolKey(question.options);
    const opener = openerKey(question.question);

    if (historicalQuestionKeys.has(exactKey)) {
      pushError(index, 'question duplicates an existing question in the bank.');
    }
    if (historicalOptionKeys.has(optionsKey) && optionsKey) {
      pushError(index, 'options duplicate an existing option pool in the bank.');
    }
    if (exactKey && seenQuestionKeys.has(exactKey)) {
      const firstIndex = seenQuestionKeys.get(exactKey);
      pushError(firstIndex, `question duplicates row ${index + 1}.`);
      pushError(index, `question duplicates row ${firstIndex + 1}.`);
    } else if (exactKey) {
      seenQuestionKeys.set(exactKey, index);
    }
    if (templateKey && seenTemplateKeys.has(templateKey) && seenTemplateKeys.get(templateKey) !== index) {
      const firstIndex = seenTemplateKeys.get(templateKey);
      pushError(firstIndex, `question is a near-duplicate of row ${index + 1}.`);
      pushError(index, `question is a near-duplicate of row ${firstIndex + 1}.`);
    } else if (templateKey) {
      seenTemplateKeys.set(templateKey, index);
    }
    if (optionsKey && seenOptionKeys.has(optionsKey)) {
      const firstIndex = seenOptionKeys.get(optionsKey);
      pushError(firstIndex, `options repeat the option pool used in row ${index + 1}.`);
      pushError(index, `options repeat the option pool used in row ${firstIndex + 1}.`);
    } else if (optionsKey) {
      seenOptionKeys.set(optionsKey, index);
    }
    if (opener) {
      const bucket = openerBuckets.get(opener) || [];
      bucket.push(index);
      openerBuckets.set(opener, bucket);
    }
  });

  questions.forEach((leftQuestion, leftIndex) => {
    for (let rightIndex = leftIndex + 1; rightIndex < questions.length; rightIndex += 1) {
      const rightQuestion = questions[rightIndex];
      const leftTokens = new Set(tokenizeQuestion(leftQuestion.question));
      const rightTokens = new Set(tokenizeQuestion(rightQuestion.question));
      const wordingSimilarity = jaccardSimilarity(leftTokens, rightTokens);
      if (wordingSimilarity >= 0.82) {
        pushError(leftIndex, `question wording is too similar to row ${rightIndex + 1}.`);
        pushError(rightIndex, `question wording is too similar to row ${leftIndex + 1}.`);
      }

      const leftOptions = parseOptionList(leftQuestion.options).map((item) => item.toLowerCase());
      const rightOptions = parseOptionList(rightQuestion.options).map((item) => item.toLowerCase());
      if (leftOptions.length >= 2 && rightOptions.length >= 2) {
        const optionSimilarity = jaccardSimilarity(leftOptions, rightOptions);
        if (optionSimilarity >= 0.8) {
          pushError(leftIndex, `options overlap too heavily with row ${rightIndex + 1}.`);
          pushError(rightIndex, `options overlap too heavily with row ${leftIndex + 1}.`);
        }
      }
    }
  });

  const openerLimit = Math.max(2, Math.ceil(questions.length * 0.2));
  [...openerBuckets.entries()]
    .filter(([, indexes]) => indexes.length > openerLimit)
    .forEach(([opener, indexes]) => {
      indexes.forEach((index) => pushError(index, `question opening "${opener}" is overused in this batch.`));
    });

  return perRowErrors;
};

const validateDistribution = (schema, questions, mode) => {
  const errors = [];
  const rowCount = questions.length;
  const typeValues = new Set(questions.map((question) => question.questionType).filter(Boolean));
  const categoryValues = new Set(questions.map((question) => question.category).filter(Boolean));
  const toneValues = new Set(questions.map((question) => question.tone).filter(Boolean));
  const intensityValues = new Set(questions.map((question) => question.intensity).filter(Boolean));
  const allowedQuestionTypes = getAllowedValues(schema, 'questionType');
  const allowedCategories = getAllowedValues(schema, 'category');

  if (mode === 'generation' && (rowCount < 10 || rowCount > MAX_BATCH_SIZE)) {
    errors.push(`Generation batches must contain 10 to ${MAX_BATCH_SIZE} objects. Received ${rowCount}.`);
  }
  if (mode === 'regeneration' && (rowCount < 1 || rowCount > MAX_BATCH_SIZE)) {
    errors.push(`Regeneration batches must contain 1 to ${MAX_BATCH_SIZE} objects. Received ${rowCount}.`);
  }

  if (rowCount >= 10) {
    if (allowedQuestionTypes.length > 1 && typeValues.size < Math.min(3, allowedQuestionTypes.length)) {
      errors.push(`Batch needs broader question-type spread. Found ${typeValues.size} distinct question types.`);
    }
    if (allowedCategories.length > 1 && categoryValues.size < Math.min(4, allowedCategories.length)) {
      errors.push(`Batch needs broader category spread. Found ${categoryValues.size} distinct categories.`);
    }
    if (toneValues.size < 2) {
      errors.push('Batch needs at least two tone values.');
    }
    if (intensityValues.size < 2) {
      errors.push('Batch needs at least two intensity values.');
    }
  }

  return errors;
};

export const validateQuestionBatch = ({ gameSlug, questions, mode = 'generation' }) => {
  const schema = loadGameSchema(gameSlug);
  const batchErrors = [];
  const rowReports = questions.map((question, index) => {
    const errors = [
      ...validateAgainstSchema(schema, question),
      ...validateAnswerTypeMapping(question),
      ...validateChoiceRules(gameSlug, question),
    ];

    ['tags', 'notes', 'avoidIf', 'gameSuitability', 'aiUseCase', 'repeatGroup'].forEach((field) => {
      if (question[field] && PLACEHOLDER_VALUES.test(question[field])) {
        errors.push(`${field} must be blank rather than a placeholder value.`);
      }
    });

    return {
      index,
      question,
      errors,
    };
  });

  const qualityErrors = validateQualityRules(gameSlug, questions);
  rowReports.forEach((report) => {
    report.errors.push(...(qualityErrors.get(report.index) || []));
  });

  batchErrors.push(...validateDistribution(schema, questions, mode));

  const failedRows = rowReports.filter((report) => report.errors.length);
  const passedRows = rowReports.filter((report) => !report.errors.length);

  return {
    gameSlug,
    mode,
    valid: failedRows.length === 0 && batchErrors.length === 0,
    schemaTitle: schema.title,
    batchErrors,
    rowReports,
    failedRows,
    passedRows,
    regenerationPlan: failedRows.length
      ? buildFailedRowRegenerationRequest({ gameSlug, failedRows, batchMode: mode })
      : null,
    distribution: {
      questionTypes: [...new Set(questions.map((question) => question.questionType).filter(Boolean))],
      categories: [...new Set(questions.map((question) => question.category).filter(Boolean))],
      tones: [...new Set(questions.map((question) => question.tone).filter(Boolean))],
      intensities: [...new Set(questions.map((question) => question.intensity).filter(Boolean))],
    },
  };
};
