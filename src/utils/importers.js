import {
  createQuestionTemplate,
  findMatchingQuestion,
  matchesQuestionTemplate,
  normalizeQuestionKey,
  normalizeText,
} from './game.js';

const FIELD_ALIASES = {
  question: ['question', 'text', 'prompt', 'title'],
  category: ['category', 'cat', 'theme', 'section', 'group', 'topic'],
  tags: ['tags', 'tag'],
  roundType: ['roundtype', 'type', 'questiontype', 'style', 'format', 'kind', 'round'],
  addedBy: ['addedby', 'sourceaddedby'],
  active: ['active', 'enabled'],
  unitLabel: ['unitlabel', 'unit', 'units'],
  scoringDivisor: ['scoringdivisor', 'divisor', 'scoredivisor'],
  roundingMode: ['roundingmode', 'rounding', 'round'],
  roundPenaltyValue: ['roundpenaltyvalue', 'questionworth', 'worth'],
  fixedPenalty: ['fixedpenalty', 'penalty', 'wrongpenalty'],
  scoringMode: ['scoringmode', 'scoremode'],
  scoringOutcomeType: ['scoringoutcometype', 'outcometype'],
  notes: ['notes', 'note'],
  sourceLabel: ['sourcelabel', 'importsourcelabel', 'originlabel'],
  defaultAnswerType: ['defaultanswertype'],
  answerType: ['answertype'],
};

const GOOGLE_SHEET_DIRECT_ID = /^[A-Za-z0-9-_]{20,}$/;
const GOOGLE_SHEET_TYPE_ALIASES = new Set([
  'numeric',
  'number',
  'closestwins',
  'closest',
  'multiplechoice',
  'multiple',
  'mcq',
  'multiselect',
  'truefalse',
  'binary',
  'yesno',
  'text',
  'textanswer',
  'written',
  'sortintoorder',
  'sorting',
  'ordering',
  'sequence',
  'sortorder',
  'matchpair',
  'matchthepair',
  'matching',
  'preference',
  'thisorthat',
  'choice',
  'favourite',
  'favorite',
  'favourites',
  'favorites',
  'petpeeve',
  'petpeeves',
  'peeve',
  'ranked',
  'top3',
  'topthree',
  'multianswer',
  'manual',
  'custom',
]);

const GOOGLE_SHEET_GID_REGEX = /[?&#]gid=([0-9]+)/g;

const normalizeHeader = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const mapRow = (row) => {
  const mapped = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const cleanKey = normalizeHeader(key);
    const target = Object.entries(FIELD_ALIASES).find(([, aliases]) => aliases.includes(cleanKey))?.[0];
    if (target) mapped[target] = value;
  });
  return mapped;
};

const parseBooleanish = (value, fallback = true) => {
  const normalized = normalizeHeader(value);
  if (!normalized) return fallback;
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  return fallback;
};

const isSupportedGoogleSheetType = (value) => GOOGLE_SHEET_TYPE_ALIASES.has(normalizeHeader(value));

const hasQuestionTemplateChanged = (existingQuestion, nextQuestion) => {
  const comparable = (question) =>
    JSON.stringify({
      question: question.question,
      roundType: question.roundType,
      category: question.category,
      tags: question.tags || [],
      notes: question.notes,
      source: question.source,
      sourceLabel: question.sourceLabel || '',
      addedBy: question.addedBy || '',
      importedFromGoogleSheet: Boolean(question.importedFromGoogleSheet),
      unitLabel: question.unitLabel,
      scoringDivisor: question.scoringDivisor,
      roundingMode: question.roundingMode,
      fixedPenalty: question.fixedPenalty,
      scoringMode: question.scoringMode,
      scoringOutcomeType: question.scoringOutcomeType,
      defaultAnswerType: question.defaultAnswerType,
      answerType: question.answerType,
      multipleChoiceOptions: question.multipleChoiceOptions || [],
      bankType: question.bankType || 'game',
      correctAnswer: question.correctAnswer || '',
      normalizedCorrectAnswer: question.normalizedCorrectAnswer || '',
    });

  return comparable(existingQuestion) !== comparable(nextQuestion);
};

export const parseGoogleSheetReference = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const directId = raw.match(GOOGLE_SHEET_DIRECT_ID)?.[0];
  const urlMatch = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9-_]+)/);
  const id = urlMatch?.[1] || (directId === raw ? raw : '');
  if (!id) return null;

  const gids = [...new Set([...raw.matchAll(GOOGLE_SHEET_GID_REGEX)].map((match) => match[1]).filter(Boolean))];
  const gid = gids[0] || '';
  const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`;

  return {
    raw,
    id,
    gid,
    gids,
    csvUrl,
  };
};

const parseCsvRows = (rawText) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' && !inQuotes) {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map(normalizeText);
  const parsedRows = rows.slice(1).filter((cells) => cells.some(Boolean)).map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = cells[index] ?? '';
    });
    return item;
  });
  return { headers, rows: parsedRows };
};

export const parseCsv = (rawText) => {
  const parsed = parseCsvRows(rawText);
  return parsed.rows.map((row) => mapRow(row));
};

const parseBlockText = (rawText) => {
  const blocks = String(rawText || '')
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const parsed = [];
  blocks.forEach((block) => {
    const item = {};
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const hasKeyValue = lines.some((line) => /^[A-Za-z ]+\s*:/.test(line));

    if (hasKeyValue) {
      lines.forEach((line) => {
        const match = line.match(/^([A-Za-z ]+)\s*:\s*(.*)$/);
        if (!match) return;
        const key = normalizeHeader(match[1]);
        const target = Object.entries(FIELD_ALIASES).find(([, aliases]) => aliases.includes(key))?.[0];
        if (target) item[target] = match[2];
      });
      parsed.push(item);
      return;
    }

    lines.forEach((line) => {
      const question = line.replace(/^[-*]\s*/, '').trim();
      if (question) parsed.push({ question });
    });
  });

  if (!parsed.length) {
    return String(rawText || '')
      .split('\n')
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
      .map((question) => ({ question }));
  }

  return parsed;
};

const parseJsonQuestions = (rawText) => {
  const parsed = JSON.parse(rawText);
  const source = Array.isArray(parsed) ? parsed : parsed.questions || parsed.questionBank || [];
  if (!Array.isArray(source)) {
    throw new Error('JSON must be an array or contain a questions array.');
  }
  return source.map(mapRow);
};

const detectFormat = (rawText, explicitFormat) => {
  if (explicitFormat && explicitFormat !== 'auto') return explicitFormat;
  const text = String(rawText || '').trim();
  if (text.startsWith('{') || text.startsWith('[')) return 'json';
  const firstLine = text.split(/\r?\n/)[0] || '';
  if (firstLine.includes(',') && /question|prompt|category|divisor/i.test(firstLine)) return 'csv';
  return 'text';
};

export const parseQuestionImport = ({ rawText, existingQuestions = [], format = 'auto', skipDuplicates = true }) => {
  const selectedFormat = detectFormat(rawText, format);
  let rows = [];

  if (selectedFormat === 'json') rows = parseJsonQuestions(rawText);
  if (selectedFormat === 'csv') rows = parseCsv(rawText);
  if (selectedFormat === 'text') rows = parseBlockText(rawText);

  const existingKeys = new Set(existingQuestions.map((question) => normalizeQuestionKey(question.question)));
  const seenQuestions = [];

  const preview = rows.map((row, index) => {
    const question = createQuestionTemplate({ ...row, source: 'imported' });
    const key = normalizeQuestionKey(question.question);
    const errors = [];
    if (!question.question) errors.push('Missing question text');
    if (Number(question.scoringDivisor) <= 0) errors.push('Divisor must be greater than zero');
    const duplicateExisting = Boolean(findMatchingQuestion(existingQuestions, question)) || existingKeys.has(key);
    const duplicateImport = seenQuestions.some((seenQuestion) => matchesQuestionTemplate(seenQuestion, question));
    if (!duplicateImport) seenQuestions.push(question);
    const duplicate = duplicateExisting || duplicateImport;
    const willImport = !errors.length && (!duplicate || !skipDuplicates);

    return {
      index,
      question,
      errors,
      duplicate,
      duplicateExisting,
      duplicateImport,
      willImport,
    };
  });

  const questions = preview.filter((row) => row.willImport).map((row) => row.question);

  return {
    format: selectedFormat,
    preview,
    questions,
    summary: {
      total: preview.length,
      valid: preview.filter((row) => !row.errors.length).length,
      duplicates: preview.filter((row) => row.duplicate).length,
      imported: questions.length,
      skipped: preview.filter((row) => !row.willImport).length,
    },
  };
};

export const parseGoogleSheetImport = ({
  rawText,
  existingQuestions = [],
  overwriteExisting = false,
  importedAt = new Date().toISOString(),
  sourceLabel = '',
}) => {
  const rows = parseCsv(rawText);
  const seenQuestions = [];
  const imports = [];
  const updates = [];
  let duplicates = 0;
  let invalid = 0;
  let skipped = 0;

  const preview = rows.map((row, index) => {
    const rawQuestion = normalizeText(row.question);
    const rawCategory = normalizeText(row.category) || 'Uncategorised';
    const rawType = normalizeText(row.roundType) || 'text';
    const isActive = parseBooleanish(row.active, true);
    const errors = [];

    if (!rawQuestion) errors.push('Missing question text');

    const question = createQuestionTemplate({
      ...row,
      category: rawCategory,
      roundType: rawType,
      source: 'googleSheet',
      sourceLabel,
      addedBy: row.addedBy,
      importedFromGoogleSheet: true,
      importDate: importedAt,
    });

    if (errors.length) {
      invalid += 1;
      return {
        index,
        question,
        errors,
        status: 'invalid',
      };
    }

    if (!isActive) {
      skipped += 1;
      return {
        index,
        question,
        errors,
        status: 'inactive',
      };
    }

    const duplicateImport = seenQuestions.some((seenQuestion) => matchesQuestionTemplate(seenQuestion, question));
    if (duplicateImport) {
      duplicates += 1;
      return {
        index,
        question,
        errors,
        status: 'duplicate',
      };
    }
    seenQuestions.push(question);

    const existingMatch = findMatchingQuestion(existingQuestions, question);
    if (!existingMatch) {
      imports.push(question);
      return {
        index,
        question,
        errors,
        status: 'import',
      };
    }

    if (!overwriteExisting) {
      duplicates += 1;
      return {
        index,
        question,
        errors,
        status: 'duplicate',
        existingId: existingMatch.id,
      };
    }

    const updatedQuestion = createQuestionTemplate({
      ...existingMatch,
      ...question,
      id: existingMatch.id,
      used: existingMatch.used,
      timesPlayed: existingMatch.timesPlayed,
      lastPlayedAt: existingMatch.lastPlayedAt,
      createdAt: existingMatch.createdAt,
      importDate: importedAt,
    });

    if (hasQuestionTemplateChanged(existingMatch, updatedQuestion)) {
      updates.push(updatedQuestion);
      return {
        index,
        question: updatedQuestion,
        errors,
        status: 'update',
        existingId: existingMatch.id,
      };
    }

    skipped += 1;
    return {
      index,
      question: existingMatch,
      errors,
      status: 'skipped',
      existingId: existingMatch.id,
    };
  });

  return {
    format: 'googleSheetCsv',
    preview,
    imports,
    updates,
    summary: {
      total: rows.length,
      imported: imports.length,
      updated: updates.length,
      duplicates,
      invalid,
      skipped,
    },
  };
};

const normalizeQuizQuestionType = (value) => {
  const normalized = normalizeHeader(value);
  if (normalized === 'truefalse' || normalized === 'trueorfalse' || normalized === 'boolean') return 'trueFalse';
  if (normalized === 'multiplechoice' || normalized === 'multiple' || normalized === 'mcq') return 'multipleChoice';
  if (normalized === 'text' || normalized === 'written' || normalized === 'shortanswer') return 'text';
  return 'text';
};

const normalizeLooseAnswer = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const parseGoogleSheetQuizImport = ({
  rawText,
  existingQuestions = [],
  overwriteExisting = true,
  importedAt = new Date().toISOString(),
  sourceLabel = '',
}) => {
  const parsed = parseCsvRows(rawText);
  const seenQuestions = [];
  const imports = [];
  const updates = [];
  let duplicates = 0;
  let invalid = 0;
  let skipped = 0;

  const preview = parsed.rows.map((rawRow, index) => {
    const row = Object.fromEntries(Object.entries(rawRow).map(([key, value]) => [normalizeHeader(key), value]));
    const questionText = normalizeText(row.question || '');
    const category = normalizeText(row.category || '') || 'Uncategorised';
    const roundType = normalizeQuizQuestionType(row.type);
    const correctAnswer = normalizeText(row.correctanswer || row.answer || '');
    const options = [
      normalizeText(row.multi1 || ''),
      normalizeText(row.multi2 || ''),
      normalizeText(row.multi3 || ''),
      normalizeText(row.multi4 || ''),
    ].filter(Boolean);

    const errors = [];
    if (!questionText) errors.push('Missing question text');
    if (!correctAnswer) errors.push('Missing correct answer');
    if (roundType === 'multipleChoice' && options.length < 2) errors.push('Multiple choice needs at least 2 options');

    const question = createQuestionTemplate({
      question: questionText,
      category,
      roundType,
      answerType: roundType === 'text' ? 'text' : 'multipleChoice',
      defaultAnswerType: roundType === 'text' ? 'text' : 'multipleChoice',
      multipleChoiceOptions: roundType === 'multipleChoice' || roundType === 'trueFalse' ? options : [],
      source: 'googleSheetQuiz',
      sourceLabel,
      importedFromGoogleSheet: true,
      importDate: importedAt,
      bankType: 'quiz',
      correctAnswer,
      normalizedCorrectAnswer: normalizeLooseAnswer(correctAnswer),
    });

    if (errors.length) {
      invalid += 1;
      return { index, question, errors, status: 'invalid' };
    }

    const duplicateImport = seenQuestions.some((entry) => matchesQuestionTemplate(entry, question));
    if (duplicateImport) {
      duplicates += 1;
      return { index, question, errors, status: 'duplicate' };
    }
    seenQuestions.push(question);

    const existingMatch = findMatchingQuestion(existingQuestions, question);
    if (!existingMatch) {
      imports.push(question);
      return { index, question, errors, status: 'import' };
    }

    if (!overwriteExisting) {
      duplicates += 1;
      return { index, question, errors, status: 'duplicate', existingId: existingMatch.id };
    }

    const updatedQuestion = createQuestionTemplate({
      ...existingMatch,
      ...question,
      id: existingMatch.id,
      used: existingMatch.used,
      timesPlayed: existingMatch.timesPlayed,
      lastPlayedAt: existingMatch.lastPlayedAt,
      createdAt: existingMatch.createdAt,
      importDate: importedAt,
    });

    if (hasQuestionTemplateChanged(existingMatch, updatedQuestion)) {
      updates.push(updatedQuestion);
      return { index, question: updatedQuestion, errors, status: 'update', existingId: existingMatch.id };
    }

    skipped += 1;
    return { index, question: existingMatch, errors, status: 'skipped', existingId: existingMatch.id };
  });

  return {
    format: 'googleSheetQuizCsv',
    preview,
    imports,
    updates,
    summary: {
      total: parsed.rows.length,
      imported: imports.length,
      updated: updates.length,
      duplicates,
      invalid,
      skipped,
    },
  };
};
