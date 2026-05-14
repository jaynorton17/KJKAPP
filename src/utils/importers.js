import {
  createQuestionTemplate,
  findMatchingQuestion,
  matchesQuestionTemplate,
  normalizeQuestionCategoryKey,
  normalizeQuestionKey,
  normalizeQuestionBankType,
  normalizeText,
} from './game.js';
import {
  DEFAULT_PLAYER_CHOICE_OPTIONS,
  DEFAULT_TRUE_FALSE_OPTIONS,
  QUESTION_TYPE_CONFIGS,
  normalizeQuestionType,
} from './questionTypes.js';

const FIELD_ALIASES = {
  question: ['question', 'text', 'prompt', 'title'],
  category: ['category', 'cat', 'theme', 'section', 'group', 'topic'],
  tags: ['tags', 'tag'],
  roundType: ['roundtype', 'type', 'questiontype', 'style', 'format', 'kind', 'round'],
  intensity: ['intensity', 'heat', 'spiciness'],
  tone: ['tone', 'mood', 'vibe'],
  relationshipArea: ['relationshiparea', 'relationship', 'area'],
  avoidIf: ['avoidif', 'avoid', 'avoidwhen'],
  gameSuitability: ['gamesuitability', 'gamesuitablefor', 'suitability'],
  aiUseCase: ['aiusecase', 'aiuse', 'usecase'],
  repeatGroup: ['repeatgroup', 'repeatbucket', 'repeatcluster'],
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
  multipleChoiceOptions: ['multiplechoiceoptions', 'options', 'choices', 'optionlist', 'answeroptions', 'rankoptions', 'orderoptions'],
  correctAnswer: ['correctanswer', 'answer', 'correct', 'solution'],
  memoryLaneMode: ['memorylanemode', 'memorytype', 'memorymode', 'recalltype', 'prompttype'],
};

const GOOGLE_SHEET_DIRECT_ID = /^[A-Za-z0-9-_]{20,}$/;
const GOOGLE_SHEET_GID_REGEX = /[?&#]gid=([0-9]+)/g;
const GOOGLE_SHEET_IMPORT_ROW_LIMIT = 5000;
const OPTION_FIELD_ALIASES = new Set(['options', 'choices', 'answeroptions', 'rankoptions', 'orderoptions', 'optionlist']);
const OPTION_INDEX_FIELD_REGEX = /^(option|choice|item|rankitem|orderitem|answeroption|preferenceoption|thisorthatoption|multi|multioption|multianswer)([0-9]+|[a-z])$/;

const normalizeHeader = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const limitGoogleSheetRows = (rows = []) => rows.slice(0, GOOGLE_SHEET_IMPORT_ROW_LIMIT);

const mapRow = (row) => {
  const mapped = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const cleanKey = normalizeHeader(key);
    const target = Object.entries(FIELD_ALIASES).find(([, aliases]) => aliases.includes(cleanKey))?.[0];
    if (target) mapped[target] = value;
  });
  return mapped;
};

const extractOptionsFromRawRow = (row = {}) => {
  const options = [];

  Object.entries(row || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeHeader(key);
    if (!normalizedKey || !String(value ?? '').trim()) return;
    if (normalizedKey === 'correctanswer' || normalizedKey === 'answer') return;
    if (OPTION_FIELD_ALIASES.has(normalizedKey)) {
      String(value)
        .split(/\n|,|;/)
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .forEach((item) => options.push(item));
      return;
    }
    if (OPTION_INDEX_FIELD_REGEX.test(normalizedKey)) {
      options.push(normalizeText(value));
    }
  });

  return [...new Set(options.filter(Boolean))];
};

const parseImportedOptionList = (value) => {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean);
  return String(value || '')
    .split(/\n|,|;|\|/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
};

const isGenericPlayerChoiceOptionList = (options = []) => {
  const keys = options.map((option) => normalizeHeader(option));
  const hasFirstPlayer = keys.includes('jay') || keys.includes('player1') || keys.includes('p1');
  const hasSecondPlayer = keys.includes('kim') || keys.includes('player2') || keys.includes('p2');
  const hasSharedChoice = keys.includes('both') || keys.includes('neither') || keys.includes('either');
  return hasFirstPlayer && hasSecondPlayer && hasSharedChoice;
};

const isPutYourPointsPlayerChoiceType = (typeText = '') =>
  [
    'whoismorelikely',
    'whoismorelikelyto',
    'whoismostlikely',
    'whoismostlikelyto',
    'mostlikely',
    'mostlikelyto',
  ].includes(normalizeHeader(typeText));

const isPutYourPointsPlayerChoicePrompt = (questionText = '', typeText = '') =>
  isPutYourPointsPlayerChoiceType(typeText)
  || /\bwho\b.*\b(more|most)\s+likely\b/i.test(questionText)
  || /\bwhich\s+(?:player|one\s+of\s+you|of\s+you|of\s+us)\b/i.test(questionText)
  || /\b(jay|kim|player\s*1|player\s*2)\b.*\b(jay|kim|player\s*1|player\s*2)\b/i.test(questionText);

const isPutYourPointsOrderingPrompt = (questionText = '') =>
  /\b(sort|sequence|arrange)\b/i.test(questionText)
  || /\bput\s+.+\s+in\s+order\b/i.test(questionText)
  || /\border\s+(?:these|the|them)\b/i.test(questionText);

const inferPutYourPointsQuestionType = (questionText = '', fallbackType = 'text', options = [], typeText = '') => {
  const normalizedQuestion = normalizeText(questionText);
  if (!normalizedQuestion) return fallbackType;
  if (fallbackType === 'sortIntoOrder') return 'sortIntoOrder';
  if (/\btrue\s+or\s+false\b|\btrue\/false\b/i.test(normalizedQuestion)) return 'trueFalse';
  if (isPutYourPointsPlayerChoicePrompt(normalizedQuestion, typeText)) return 'multipleChoice';
  if (/\b(would\s+you\s+rather|which\s+would\s+you\s+choose|do\s+you\s+prefer|prefer|this\s+or\s+that|either\s+or)\b/i.test(normalizedQuestion)) {
    return 'preference';
  }
  if (/\b(1\s*(?:-|to)\s*10|one\s*(?:-|to)\s*ten|out\s+of\s+10|rate|rating|scale)\b/i.test(normalizedQuestion)) {
    return 'rating';
  }
  if (isPutYourPointsOrderingPrompt(normalizedQuestion)) {
    return 'sortIntoOrder';
  }
  if (/\b(top\s*\d+|top\s+three|name\s+(?:your\s+)?(?:top\s+)?three|list\s+three|three\s+.+memories|rank(?:ed|ing)?)\b/i.test(normalizedQuestion)) {
    return 'ranked';
  }
  if (/\b(how\s+many|how\s+much|what\s+(?:number|age|year|percentage|percent|amount)|age\b|year\b|percentage|percent|amount|count)\b/i.test(normalizedQuestion)) {
    return 'numeric';
  }
  if (/\bfavou?rite\b/i.test(normalizedQuestion)) return 'favourite';
  if (/\b(pet\s+peeve|annoy|irritat|turns?\s+you\s+off)\b/i.test(normalizedQuestion)) return 'petPeeve';
  if (options.length >= 2 && !isGenericPlayerChoiceOptionList(options)) {
    return fallbackType === 'text' ? 'multipleChoice' : fallbackType;
  }
  return fallbackType === 'multipleChoice' ? 'text' : fallbackType;
};

const normalizePutYourPointsSheetRow = (row = {}) => {
  const questionText = normalizeText(row.question);
  const providedOptions = parseImportedOptionList(row.multipleChoiceOptions);
  const roundType = normalizeQuestionType(row.roundType, 'text');
  const hasGenericPlayerOptions = isGenericPlayerChoiceOptionList(providedOptions);
  const inferredType = inferPutYourPointsQuestionType(questionText, roundType, providedOptions, row.roundType);
  const nextRow = { ...row };
  nextRow.roundType = inferredType;

  if (inferredType === 'trueFalse') {
    nextRow.multipleChoiceOptions = DEFAULT_TRUE_FALSE_OPTIONS.join('\n');
    return nextRow;
  }

  if (inferredType === 'multipleChoice' && isPutYourPointsPlayerChoicePrompt(questionText, row.roundType)) {
    const optionKeys = providedOptions.map((option) => normalizeHeader(option));
    if (optionKeys[0] === 'player1' && optionKeys[1] === 'player2') {
      nextRow.multipleChoiceOptions = DEFAULT_PLAYER_CHOICE_OPTIONS.join('\n');
    }
    if (!providedOptions.length) nextRow.multipleChoiceOptions = DEFAULT_PLAYER_CHOICE_OPTIONS.join('\n');
    return nextRow;
  }

  if (hasGenericPlayerOptions) {
    nextRow.multipleChoiceOptions = '';
  }

  return nextRow;
};

const enrichMappedRow = (row = {}) => {
  const mapped = mapRow(row);
  const extractedOptions = extractOptionsFromRawRow(row);

  if (!mapped.multipleChoiceOptions && extractedOptions.length) {
    mapped.multipleChoiceOptions = extractedOptions.join('\n');
  }

  if (!mapped.correctAnswer) {
    const correctAnswerKey = Object.keys(row || {}).find((key) => ['correctanswer', 'correct', 'solution'].includes(normalizeHeader(key)));
    if (correctAnswerKey) mapped.correctAnswer = row[correctAnswerKey];
  }

  if (mapped.roundType) {
    mapped.roundType = normalizeQuestionType(mapped.roundType, 'text');
  }

  return mapped;
};

const parseBooleanish = (value, fallback = true) => {
  const normalized = normalizeHeader(value);
  if (!normalized) return fallback;
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  return fallback;
};

const isSupportedGoogleSheetType = (value) =>
  QUESTION_TYPE_CONFIGS.some((config) =>
    [config.id, ...(config.aliases || [])].some((entry) => normalizeHeader(entry) === normalizeHeader(value)),
  );

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
      intensity: Number(question.intensity || 0),
      tone: question.tone || '',
      relationshipArea: question.relationshipArea || '',
      avoidIf: question.avoidIf || [],
      gameSuitability: question.gameSuitability || [],
      aiUseCase: question.aiUseCase || [],
      repeatGroup: question.repeatGroup || '',
      unitLabel: question.unitLabel,
      scoringDivisor: question.scoringDivisor,
      roundingMode: question.roundingMode,
      fixedPenalty: question.fixedPenalty,
      scoringMode: question.scoringMode,
      scoringOutcomeType: question.scoringOutcomeType,
      defaultAnswerType: question.defaultAnswerType,
      answerType: question.answerType,
      multipleChoiceOptions: question.multipleChoiceOptions || [],
      bankType: normalizeQuestionBankType(question.bankType),
      correctAnswer: question.correctAnswer || '',
      normalizedCorrectAnswer: question.normalizedCorrectAnswer || '',
    });

  return comparable(existingQuestion) !== comparable(nextQuestion);
};

const findSheetQuestionMatch = (
  questions = [],
  candidateQuestion,
  { allowTypeMigration = false, allowTemplateMatch = true, allowIdMatch = true } = {},
) => {
  const candidateId = normalizeText(candidateQuestion?.id).toLowerCase();
  const exactIdMatch = allowIdMatch && candidateId
    ? questions.find((question) => normalizeText(question?.id).toLowerCase() === candidateId) || null
    : null;
  if (exactIdMatch || !allowTemplateMatch) return exactIdMatch;

  const exactTemplateMatch = allowIdMatch
    ? findMatchingQuestion(questions, candidateQuestion)
    : questions.find((question) => {
      if (normalizeQuestionBankType(question?.bankType) !== normalizeQuestionBankType(candidateQuestion?.bankType)) return false;
      const existingQuestionKey = normalizeQuestionKey(question?.question);
      const candidateQuestionKey = normalizeQuestionKey(candidateQuestion?.question);
      const existingCategoryKey = normalizeQuestionCategoryKey(question?.question, question?.category);
      const candidateCategoryKey = normalizeQuestionCategoryKey(candidateQuestion?.question, candidateQuestion?.category);
      if (existingCategoryKey && candidateCategoryKey && existingCategoryKey === candidateCategoryKey) {
        return normalizeQuestionType(question?.roundType, 'text') === normalizeQuestionType(candidateQuestion?.roundType, 'text');
      }
      return Boolean(
        existingQuestionKey
          && candidateQuestionKey
          && existingQuestionKey === candidateQuestionKey
          && normalizeQuestionType(question?.roundType, 'text') === normalizeQuestionType(candidateQuestion?.roundType, 'text'),
      );
    }) || null;
  if (exactTemplateMatch || !allowTypeMigration) return exactTemplateMatch;
  const candidateCategoryKey = normalizeQuestionCategoryKey(candidateQuestion?.question, candidateQuestion?.category);
  if (!candidateCategoryKey) return null;
  return questions.find((question) => {
    if (normalizeQuestionBankType(question?.bankType) !== normalizeQuestionBankType(candidateQuestion?.bankType)) return false;
    if (normalizeQuestionCategoryKey(question?.question, question?.category) !== candidateCategoryKey) return false;
    return Boolean(question?.importedFromGoogleSheet || question?.source === 'googleSheet' || question?.source === 'googleSheetQuiz');
  }) || null;
};

const sanitizeQuestionIdPart = (value = '') =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const createGoogleSheetQuestionTemplate = (input = {}, { sourceLabel = '', index = 0, bankType = '' } = {}) => {
  const question = createQuestionTemplate(input);
  const normalizedBankType = normalizeQuestionBankType(bankType || question.bankType);
  const rowNumber = index + 2;
  const sourcePart = sanitizeQuestionIdPart(sourceLabel || question.sourceLabel || question.source || 'sheet').slice(0, 180) || 'sheet';
  const rowKey = `${sourceLabel || question.sourceLabel || question.source || 'sheet'}:row:${rowNumber}`;
  return {
    ...question,
    id: `question-${normalizedBankType}-${sourcePart}-row-${rowNumber}`,
    sheetRowNumber: rowNumber,
    sheetRowKey: rowKey,
  };
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
  return parsed.rows.map((row) => enrichMappedRow(row));
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
  allowIdMatch = true,
  allowTemplateMatch = false,
}) => {
  const parsed = parseCsvRows(rawText);
  const rows = limitGoogleSheetRows(parsed.rows).map((row) => enrichMappedRow(row));
  const seenQuestions = [];
  const imports = [];
  const updates = [];
  let duplicates = 0;
  let invalid = 0;
  let skipped = 0;

  const preview = rows.map((row, index) => {
    const rawQuestion = normalizeText(row.question);
    const rawCategory = normalizeText(row.category) || 'Uncategorised';
    const rawType = normalizeQuestionType(row.roundType, 'text');
    const isActive = parseBooleanish(row.active, true);
    const errors = [];

    if (!rawQuestion) errors.push('Missing question text');

    const question = createGoogleSheetQuestionTemplate({
      ...row,
      category: rawCategory,
      roundType: rawType,
      source: 'googleSheet',
      sourceLabel,
      addedBy: row.addedBy,
      importedFromGoogleSheet: true,
      importDate: importedAt,
    }, { sourceLabel, index, bankType: 'game' });

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

    seenQuestions.push(question);

    const existingMatch = findSheetQuestionMatch(existingQuestions, question, {
      allowTypeMigration: overwriteExisting,
      allowTemplateMatch,
      allowIdMatch,
    });
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

export const parseGoogleSheetPutYourPointsImport = ({
  rawText,
  existingQuestions = [],
  overwriteExisting = true,
  importedAt = new Date().toISOString(),
  sourceLabel = '',
  allowIdMatch = true,
  allowTemplateMatch = false,
}) => {
  const parsed = parseCsvRows(rawText);
  const rows = limitGoogleSheetRows(parsed.rows).map((row) => normalizePutYourPointsSheetRow(enrichMappedRow(row)));
  const seenQuestions = [];
  const imports = [];
  const updates = [];
  let duplicates = 0;
  let invalid = 0;
  let skipped = 0;

  const preview = rows.map((row, index) => {
    const rawQuestion = normalizeText(row.question);
    const rawCategory = normalizeText(row.category) || 'Put Your Points';
    const rawType = normalizeQuestionType(row.roundType, 'text');
    const isActive = parseBooleanish(row.active, true);
    const errors = [];

    if (!rawQuestion) errors.push('Missing question text');

    const question = createGoogleSheetQuestionTemplate({
      ...row,
      category: rawCategory,
      roundType: rawType,
      source: 'googleSheetPutYourPoints',
      sourceLabel,
      addedBy: row.addedBy,
      importedFromGoogleSheet: true,
      importDate: importedAt,
      bankType: 'putYourPointsGame',
    }, { sourceLabel, index, bankType: 'putYourPointsGame' });

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

    seenQuestions.push(question);

    const existingMatch = findSheetQuestionMatch(
      existingQuestions.filter((entry) => normalizeQuestionBankType(entry?.bankType) === 'putYourPointsGame'),
      question,
      { allowTypeMigration: overwriteExisting, allowTemplateMatch, allowIdMatch },
    );
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
  if (
    [
      'truefalse',
      'trueorfalse',
      'truefalsequestion',
      'boolean',
      'bool',
      'tf',
      'binary',
      'yesno',
      'yesorno',
    ].includes(normalized)
    || normalized.startsWith('truefalse')
    || normalized.startsWith('trueorfalse')
    || normalized.startsWith('boolean')
  ) {
    return 'trueFalse';
  }
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
  allowIdMatch = true,
  allowTemplateMatch = false,
}) => {
  const parsed = parseCsvRows(rawText);
  const rows = limitGoogleSheetRows(parsed.rows);
  const seenQuestions = [];
  const imports = [];
  const updates = [];
  let duplicates = 0;
  let invalid = 0;
  let skipped = 0;

  const preview = rows.map((rawRow, index) => {
    const normalizedRow = Object.fromEntries(Object.entries(rawRow).map(([key, value]) => [normalizeHeader(key), value]));
    const mappedRow = enrichMappedRow(rawRow);
    const row = { ...normalizedRow, ...mappedRow };
    const questionText = normalizeText(row.question || '');
    const category = normalizeText(row.category || '') || 'Uncategorised';
    const roundType = normalizeQuizQuestionType(row.type || row.roundType);
    const correctAnswer = normalizeText(row.correctanswer || row.answer || row.correctAnswer || '');
    const templateOptions = parseImportedOptionList(row.multipleChoiceOptions);
    const legacyOptions = [
      normalizeText(row.multi1 || ''),
      normalizeText(row.multi2 || ''),
      normalizeText(row.multi3 || ''),
      normalizeText(row.multi4 || ''),
    ].filter(Boolean);
    const options = templateOptions.length ? templateOptions : legacyOptions;

    const errors = [];
    if (!questionText) errors.push('Missing question text');
    if (!correctAnswer) errors.push('Missing correct answer');
    if (roundType === 'multipleChoice' && options.length < 2) errors.push('Multiple choice needs at least 2 options');

    const question = createGoogleSheetQuestionTemplate({
      ...row,
      question: questionText,
      category,
      roundType,
      answerType: roundType === 'text' ? 'text' : 'multipleChoice',
      defaultAnswerType: roundType === 'text' ? 'text' : 'multipleChoice',
      multipleChoiceOptions: roundType === 'trueFalse'
        ? DEFAULT_TRUE_FALSE_OPTIONS
        : roundType === 'multipleChoice'
          ? options
          : [],
      source: 'googleSheetQuiz',
      sourceLabel,
      importedFromGoogleSheet: true,
      importDate: importedAt,
      bankType: 'quiz',
      correctAnswer,
      normalizedCorrectAnswer: normalizeLooseAnswer(correctAnswer),
    }, { sourceLabel, index, bankType: 'quiz' });

    if (errors.length) {
      invalid += 1;
      return { index, question, errors, status: 'invalid' };
    }

    seenQuestions.push(question);

    const existingMatch = findSheetQuestionMatch(existingQuestions, question, {
      allowTypeMigration: overwriteExisting,
      allowTemplateMatch,
      allowIdMatch,
    });
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
      total: rows.length,
      imported: imports.length,
      updated: updates.length,
      duplicates,
      invalid,
      skipped,
    },
  };
};

export const parseGoogleSheetTrueFalseImport = ({
  rawText,
  existingQuestions = [],
  overwriteExisting = true,
  importedAt = new Date().toISOString(),
  sourceLabel = '',
  allowIdMatch = true,
  allowTemplateMatch = false,
}) => {
  const parsed = parseCsvRows(rawText);
  const rows = limitGoogleSheetRows(parsed.rows).map((row) => enrichMappedRow(row));
  const seenQuestions = [];
  const imports = [];
  const updates = [];
  let duplicates = 0;
  let invalid = 0;
  let skipped = 0;

  const preview = rows.map((row, index) => {
    const rawQuestion = normalizeText(row.question);
    const rawCategory = normalizeText(row.category) || 'Uncategorised';
    const isActive = parseBooleanish(row.active, true);
    const errors = [];

    if (!rawQuestion) errors.push('Missing question text');

    const question = createGoogleSheetQuestionTemplate({
      ...row,
      category: rawCategory,
      roundType: 'trueFalse',
      answerType: 'multipleChoice',
      defaultAnswerType: 'multipleChoice',
      source: 'googleSheetTrueFalse',
      sourceLabel,
      addedBy: row.addedBy,
      importedFromGoogleSheet: true,
      importDate: importedAt,
      bankType: 'trueFalseGame',
    }, { sourceLabel, index, bankType: 'trueFalseGame' });

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

    seenQuestions.push(question);

    const existingMatch = findSheetQuestionMatch(
      existingQuestions.filter((entry) => normalizeQuestionBankType(entry?.bankType) === 'trueFalseGame'),
      question,
      { allowTypeMigration: overwriteExisting, allowTemplateMatch, allowIdMatch },
    );
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
    format: 'googleSheetTrueFalseCsv',
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

export const parseGoogleSheetThisOrThatImport = ({
  rawText,
  existingQuestions = [],
  overwriteExisting = true,
  importedAt = new Date().toISOString(),
  sourceLabel = '',
  allowIdMatch = true,
  allowTemplateMatch = false,
}) => {
  const parsed = parseCsvRows(rawText);
  const rows = limitGoogleSheetRows(parsed.rows).map((row) => enrichMappedRow(row));
  const seenQuestions = [];
  const imports = [];
  const updates = [];
  let duplicates = 0;
  let invalid = 0;
  let skipped = 0;

  const preview = rows.map((row, index) => {
    const rawQuestion = normalizeText(row.question);
    const rawCategory = normalizeText(row.category) || 'Uncategorised';
    const isActive = parseBooleanish(row.active, true);
    const errors = [];

    if (!rawQuestion) errors.push('Missing question text');

    const question = createGoogleSheetQuestionTemplate({
      ...row,
      category: rawCategory,
      roundType: 'preference',
      answerType: 'multipleChoice',
      defaultAnswerType: 'multipleChoice',
      source: 'googleSheetThisOrThat',
      sourceLabel,
      addedBy: row.addedBy,
      importedFromGoogleSheet: true,
      importDate: importedAt,
      bankType: 'thisOrThatGame',
    }, { sourceLabel, index, bankType: 'thisOrThatGame' });

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

    seenQuestions.push(question);

    const existingMatch = findSheetQuestionMatch(
      existingQuestions.filter((entry) => normalizeQuestionBankType(entry?.bankType) === 'thisOrThatGame'),
      question,
      { allowTypeMigration: overwriteExisting, allowTemplateMatch, allowIdMatch },
    );
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
    format: 'googleSheetThisOrThatCsv',
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

export const parseGoogleSheetMostLikelyImport = ({
  rawText,
  existingQuestions = [],
  overwriteExisting = true,
  importedAt = new Date().toISOString(),
  sourceLabel = '',
  allowIdMatch = true,
  allowTemplateMatch = false,
}) => {
  const parsed = parseCsvRows(rawText);
  const rows = limitGoogleSheetRows(parsed.rows).map((row) => enrichMappedRow(row));
  const seenQuestions = [];
  const imports = [];
  const updates = [];
  let duplicates = 0;
  let invalid = 0;
  let skipped = 0;

  const preview = rows.map((row, index) => {
    const rawQuestion = normalizeText(row.question);
    const rawCategory = normalizeText(row.category) || 'Most Likely To';
    const isActive = parseBooleanish(row.active, true);
    const errors = [];

    if (!rawQuestion) errors.push('Missing question text');

    const question = createGoogleSheetQuestionTemplate({
      ...row,
      category: rawCategory,
      roundType: 'multipleChoice',
      answerType: 'multipleChoice',
      defaultAnswerType: 'multipleChoice',
      multipleChoiceOptions: DEFAULT_PLAYER_CHOICE_OPTIONS,
      source: 'googleSheetMostLikely',
      sourceLabel,
      addedBy: row.addedBy,
      importedFromGoogleSheet: true,
      importDate: importedAt,
      bankType: 'mostLikelyGame',
    }, { sourceLabel, index, bankType: 'mostLikelyGame' });

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

    seenQuestions.push(question);

    const existingMatch = findSheetQuestionMatch(
      existingQuestions.filter((entry) => normalizeQuestionBankType(entry?.bankType) === 'mostLikelyGame'),
      question,
      { allowTypeMigration: overwriteExisting, allowTemplateMatch, allowIdMatch },
    );
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
    format: 'googleSheetMostLikelyCsv',
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

export const parseGoogleSheetModeImport = ({
  rawText,
  existingQuestions = [],
  overwriteExisting = true,
  importedAt = new Date().toISOString(),
  sourceLabel = '',
  allowIdMatch = true,
  allowTemplateMatch = false,
  bankType = 'game',
  source = 'googleSheetMode',
  defaultCategory = 'Uncategorised',
  defaultRoundType = 'text',
  fixedOptions = null,
}) => {
  const normalizedBankType = normalizeQuestionBankType(bankType);
  const parsed = parseCsvRows(rawText);
  const rows = limitGoogleSheetRows(parsed.rows).map((row) => enrichMappedRow(row));
  const imports = [];
  const updates = [];
  let duplicates = 0;
  let invalid = 0;
  let skipped = 0;

  const preview = rows.map((row, index) => {
    const rawQuestion = normalizeText(row.question);
    const rawCategory = normalizeText(row.category) || defaultCategory;
    const rawType = normalizeQuestionType(row.roundType, defaultRoundType);
    const isActive = parseBooleanish(row.active, true);
    const errors = [];

    if (!rawQuestion) errors.push('Missing question text');

    const question = createGoogleSheetQuestionTemplate({
      ...row,
      category: rawCategory,
      roundType: rawType,
      answerType: row.answerType || row.defaultAnswerType || rawType,
      defaultAnswerType: row.defaultAnswerType || rawType,
      multipleChoiceOptions: Array.isArray(fixedOptions) && fixedOptions.length ? fixedOptions : row.multipleChoiceOptions,
      source,
      sourceLabel,
      addedBy: row.addedBy,
      importedFromGoogleSheet: true,
      importDate: importedAt,
      bankType: normalizedBankType,
    }, { sourceLabel, index, bankType: normalizedBankType });

    if (errors.length) {
      invalid += 1;
      return { index, question, errors, status: 'invalid' };
    }

    if (!isActive) {
      skipped += 1;
      return { index, question, errors, status: 'inactive' };
    }

    const existingMatch = findSheetQuestionMatch(
      existingQuestions.filter((entry) => normalizeQuestionBankType(entry?.bankType) === normalizedBankType),
      question,
      { allowTypeMigration: overwriteExisting, allowTemplateMatch, allowIdMatch },
    );
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
    format: `googleSheet${normalizedBankType}Csv`,
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
