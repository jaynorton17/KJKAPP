import { useEffect, useMemo, useRef, useState } from 'react';
import AnalyticsPanel from './components/AnalyticsPanel.jsx';
import ConfirmResetModal from './components/ConfirmResetModal.jsx';
import ExportTab from './components/ExportTab.jsx';
import GameTab from './components/GameTab.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import QuestionBankPanel from './components/QuestionBankPanel.jsx';
import SettingsTab from './components/SettingsTab.jsx';
import TabNavigation from './components/TabNavigation.jsx';
import ThemeSwitcher from './components/ThemeSwitcher.jsx';
import {
  calculateAnalytics,
  createCategory,
  createQuestionTemplate,
  CATEGORY_COLOR_MAP,
  DEFAULT_SETTINGS,
  DEFAULT_CATEGORIES,
  deriveCategories,
  deriveTags,
  exportRoundsCsv,
  findMatchingQuestion,
  filterQuestionsForDraw,
  getDefaultAnswerType,
  getDefaultScoringMode,
  getDefaultScoringOutcomeType,
  getMaskedAnswerValue,
  getRoundAnswerType,
  makeId,
  markQuestionPlayed,
  normalizeRoundType,
  PALETTES,
  PLAYER_LABEL,
  parseAnswerList,
  parseNumber,
  pickRandom,
  recalculateRounds,
  SCHEMA_VERSION,
  setQuestionUsed,
  toScore,
  validateImportedGame,
} from './utils/game.js';
import { copyOrDownloadPng, downloadElementPng, downloadText, exportRoundWebm, shareElementImage } from './utils/exporters.js';
import { parseGoogleSheetImport, parseGoogleSheetReference } from './utils/importers.js';
import {
  clearGameState,
  loadGameState,
  loadSoundEnabled,
  loadThemeIndex,
  saveGameState,
  saveSoundEnabled,
  saveThemeIndex,
} from './utils/storage.js';

const categoryColorMap = CATEGORY_COLOR_MAP;
const emptyRoundForm = (settings = DEFAULT_SETTINGS) => ({
  questionId: '',
  roundType: 'numeric',
  scoringMode: getDefaultScoringMode('numeric'),
  scoringOutcomeType: getDefaultScoringOutcomeType('numeric'),
  winnerSelection: 'tie',
  question: '',
  category: '',
  tags: '',
  unitLabel: '',
  notes: '',
  scoreExplanation: '',
  defaultAnswerType: 'number',
  actualAnswer: '',
  jayGuess: '',
  kimGuess: '',
  actualText: '',
  jayActualAnswer: '',
  kimActualAnswer: '',
  jayGuessedAnswer: '',
  kimGuessedAnswer: '',
  jayActualList: '',
  kimActualList: '',
  jayGuessedList: '',
  kimGuessedList: '',
  multipleChoiceOptions: '',
  scoringDivisor: '1',
  roundingMode: 'nearest',
  fixedPenalty: '5',
  manualScores: false,
  jayScore: '',
  kimScore: '',
  allowDecimals: settings.allowDecimals,
  integerScores: settings.integerScores,
});

const questionToRoundForm = (question, settings) => ({
  ...emptyRoundForm(settings),
  questionId: question.id,
  roundType: question.roundType || 'numeric',
  scoringMode: question.scoringMode || getDefaultScoringMode(question.roundType),
  scoringOutcomeType: question.scoringOutcomeType || getDefaultScoringOutcomeType(question.roundType),
  winnerSelection: 'tie',
  question: question.question,
  category: question.category,
  tags: (question.tags || []).join(', '),
  unitLabel: question.unitLabel,
  notes: question.notes,
  defaultAnswerType: question.defaultAnswerType || 'number',
  multipleChoiceOptions: (question.multipleChoiceOptions || []).join('\n'),
  scoringDivisor: String(question.scoringDivisor || 1),
  roundingMode: question.roundingMode || 'nearest',
  fixedPenalty: String(question.roundPenaltyValue ?? question.fixedPenalty ?? 5),
  manualScores: question.roundType === 'manual',
});

const roundToRoundForm = (round) => ({
  questionId: round.questionId || '',
  roundType: round.roundType || 'numeric',
  scoringMode: round.scoringMode || getDefaultScoringMode(round.roundType),
  scoringOutcomeType: round.scoringOutcomeType || getDefaultScoringOutcomeType(round.roundType),
  winnerSelection: round.winner || 'tie',
  question: round.question || '',
  category: round.category || '',
  tags: (round.tags || []).join(', '),
  unitLabel: round.unitLabel || '',
  notes: round.notes || '',
  scoreExplanation: round.scoreExplanation || '',
  defaultAnswerType: round.defaultAnswerType || 'number',
  actualAnswer: String(round.actualAnswer ?? ''),
  jayGuess: String(round.guesses?.jay ?? ''),
  kimGuess: String(round.guesses?.kim ?? ''),
  actualText: round.actualText || '',
  jayActualAnswer: round.actualAnswers?.jay || '',
  kimActualAnswer: round.actualAnswers?.kim || '',
  jayGuessedAnswer: round.guessedAnswers?.jay || '',
  kimGuessedAnswer: round.guessedAnswers?.kim || '',
  jayActualList: (round.actualList?.jay || []).join('\n'),
  kimActualList: (round.actualList?.kim || []).join('\n'),
  jayGuessedList: (round.guessedList?.jay || []).join('\n'),
  kimGuessedList: (round.guessedList?.kim || []).join('\n'),
  multipleChoiceOptions: (round.multipleChoiceOptions || []).join('\n'),
  scoringDivisor: String(round.scoringDivisor || 1),
  roundingMode: round.roundingMode || 'nearest',
  fixedPenalty: String(round.roundPenaltyValue ?? round.fixedPenalty ?? 5),
  manualScores: Boolean(round.manualScores),
  jayScore: String(round.penaltyAdded?.jay ?? round.scores?.jay ?? ''),
  kimScore: String(round.penaltyAdded?.kim ?? round.scores?.kim ?? ''),
  allowDecimals: Boolean(round.allowDecimals),
  integerScores: round.integerScores !== false,
});

function App() {
  const scoreboardRef = useRef(null);
  const exportScoreboardRef = useRef(null);
  const roundCardRef = useRef(null);
  const backupInputRef = useRef(null);

  const [initialGameState] = useState(() => loadGameState());
  const [gameState, setGameState] = useState(initialGameState);
  const [themeIndex, setThemeIndex] = useState(() => loadThemeIndex());
  const [soundEnabled, setSoundEnabled] = useState(() => loadSoundEnabled());
  const [activeTab, setActiveTab] = useState('game');
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [editingRound, setEditingRound] = useState(null);
  const [roundForm, setRoundForm] = useState(() => emptyRoundForm(initialGameState.settings));
  const [resetTarget, setResetTarget] = useState('');
  const [notice, setNotice] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [shareRound, setShareRound] = useState(null);
  const [isSyncingGoogleSheet, setIsSyncingGoogleSheet] = useState(false);
  const [googleSheetSyncSummary, setGoogleSheetSyncSummary] = useState(null);

  const { rounds, questions, settings } = gameState;
  const activePalette = PALETTES[themeIndex % PALETTES.length];
  const analytics = useMemo(() => calculateAnalytics(rounds), [rounds]);
  const categoryOptions = useMemo(
    () => deriveCategories(questions, rounds, gameState.categories),
    [gameState.categories, questions, rounds],
  );
  const categories = useMemo(() => categoryOptions.map((category) => category.name), [categoryOptions]);
  const categoryColorMap = useMemo(
    () => ({
      ...CATEGORY_COLOR_MAP,
      ...Object.fromEntries(categoryOptions.map((category) => [category.name, category.color])),
    }),
    [categoryOptions],
  );
  const tags = useMemo(() => deriveTags(questions), [questions]);
  const drawPool = useMemo(() => filterQuestionsForDraw(questions, settings), [questions, settings]);
  const latestRound = shareRound || rounds.at(-1) || null;
  const hasQuestionLoaded = Boolean(selectedQuestion || editingRound || roundForm.question.trim());
  const scoreboardQuestionText = hasQuestionLoaded
    ? roundForm.question || selectedQuestion?.question || latestRound?.question || ''
    : latestRound?.question || '';
  const scoreboardCategory = hasQuestionLoaded
    ? roundForm.category || selectedQuestion?.category || latestRound?.category || ''
    : latestRound?.category || '';
  const scoreboardRoundNumber = editingRound?.number || (hasQuestionLoaded ? rounds.length + 1 : latestRound?.number || 1);
  const canShareQuestion = Boolean(scoreboardQuestionText.trim());
  const unusedQuestionCount = useMemo(() => questions.filter((question) => !question.used).length, [questions]);
  const tabs = useMemo(
    () => [
      { id: 'game', label: 'Game', meta: `${rounds.length} rounds` },
      { id: 'questions', label: 'Questions', meta: `${unusedQuestionCount}/${questions.length}` },
      { id: 'history', label: 'History', meta: `${rounds.length}` },
      { id: 'analytics', label: 'Analytics', meta: analytics.leader === 'tie' ? 'Tied' : `${PLAYER_LABEL[analytics.leader]} leads` },
      { id: 'export', label: 'Export', meta: latestRound ? `R${latestRound.number}` : 'Ready' },
      { id: 'settings', label: 'Settings', meta: `v${SCHEMA_VERSION}` },
    ],
    [analytics.leader, latestRound, questions.length, rounds.length, unusedQuestionCount],
  );

  useEffect(() => {
    saveGameState(gameState);
  }, [gameState]);

  useEffect(() => {
    saveThemeIndex(themeIndex);
  }, [themeIndex]);

  useEffect(() => {
    saveSoundEnabled(soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const appStyle = useMemo(
    () => ({
      '--accent': activePalette.accent,
      '--accent-2': activePalette.accent2,
      '--accent-3': activePalette.accent3,
      '--accent-glow': activePalette.glow,
      '--accent-wash': activePalette.wash,
    }),
    [activePalette],
  );

  const updateRoundForm = (patch) => {
    setRoundForm((current) => ({ ...current, ...patch }));
  };

  const updateSettings = (patch) => {
    setGameState((current) => {
      const nextSettings = { ...current.settings, ...patch };
      if (patch.gameMode === 'repeat') {
        nextSettings.allowRepeats = true;
        nextSettings.unusedOnly = false;
      }
      if (patch.gameMode === 'unused') {
        nextSettings.allowRepeats = false;
        nextSettings.unusedOnly = true;
      }
      if (patch.gameMode === 'standard' || patch.gameMode === 'category') {
        nextSettings.allowRepeats = false;
        nextSettings.unusedOnly = true;
      }
      return { ...current, settings: nextSettings };
    });
  };

  const loadQuestion = (question) => {
    setSelectedQuestion(question);
    setEditingRound(null);
    setRoundForm(questionToRoundForm(question, settings));
    setActiveTab('game');
    setNotice(`Loaded question${question.category ? ` from ${question.category}` : ''}.`);
  };

  const drawRandomQuestion = () => {
    const pool = filterQuestionsForDraw(questions, settings);
    if (!pool.length) {
      setNotice('No matching unused questions. Enable repeats, clear filters, or mark questions unused.');
      return;
    }
    loadQuestion(pickRandom(pool));
  };

  const saveRound = ({ drawNext = false } = {}) => {
    try {
      if (settings.requireNotes && !roundForm.notes.trim()) {
        setNotice('Notes are required for this round.');
        return false;
      }
      if (!roundForm.question.trim()) {
        setNotice('Add a question before saving the round.');
        return false;
      }
      if (!String(roundForm.jayScore).trim() || !String(roundForm.kimScore).trim()) {
        setNotice('Enter or confirm the penalty added for both players before saving.');
        return false;
      }

      const roundType = normalizeRoundType(roundForm.roundType);
      const penalties = {
        jay: toScore(roundForm.jayScore || 0),
        kim: toScore(roundForm.kimScore || 0),
      };

      const now = new Date().toISOString();
      const roundPayload = {
        id: editingRound?.id || makeId('round'),
        questionId: selectedQuestion?.id || roundForm.questionId || null,
        roundType,
        answerType: roundForm.defaultAnswerType || getDefaultAnswerType(roundType),
        defaultAnswerType: roundForm.defaultAnswerType || getDefaultAnswerType(roundType),
        question: roundForm.question,
        category: roundForm.category,
        tags: roundForm.tags,
        unitLabel: roundForm.unitLabel,
        notes: roundForm.notes,
        scoreExplanation: roundForm.scoreExplanation,
        actualAnswer: parseNumber(roundForm.actualAnswer, 0),
        guesses: {
          jay: parseNumber(roundForm.jayGuess, 0),
          kim: parseNumber(roundForm.kimGuess, 0),
        },
        actualText: roundForm.actualText,
        actualAnswers: {
          jay: roundForm.jayActualAnswer,
          kim: roundForm.kimActualAnswer,
        },
        guessedAnswers: {
          jay: roundForm.jayGuessedAnswer,
          kim: roundForm.kimGuessedAnswer,
        },
        actualList: {
          jay: parseAnswerList(roundForm.jayActualList),
          kim: parseAnswerList(roundForm.kimActualList),
        },
        guessedList: {
          jay: parseAnswerList(roundForm.jayGuessedList),
          kim: parseAnswerList(roundForm.kimGuessedList),
        },
        multipleChoiceOptions: parseAnswerList(roundForm.multipleChoiceOptions),
        penaltyAdded: penalties,
        scores: penalties,
        manualScores: roundForm.scoringMode !== 'assisted_numeric',
        scoringMode: roundForm.scoringMode,
        scoringOutcomeType: roundForm.scoringOutcomeType,
        scoringDivisor: parseNumber(roundForm.scoringDivisor, 1),
        roundingMode: roundForm.roundingMode,
        roundPenaltyValue: parseNumber(roundForm.fixedPenalty, 5),
        fixedPenalty: parseNumber(roundForm.fixedPenalty, 5),
        allowDecimals: roundForm.allowDecimals,
        integerScores: roundForm.integerScores,
        createdAt: editingRound?.createdAt || now,
      };

      let savedRound = null;
      let nextQuestionToLoad = null;
      let nextQuestionSettings = settings;
      setGameState((current) => {
        const nextRounds = editingRound
          ? current.rounds.map((round) => (round.id === editingRound.id ? roundPayload : round))
          : [...current.rounds, roundPayload];
        const recalculated = recalculateRounds(nextRounds);
        savedRound = recalculated.find((round) => round.id === roundPayload.id) || recalculated.at(-1);

        const nextQuestions =
          selectedQuestion && !editingRound
            ? current.questions.map((question) =>
                question.id === selectedQuestion.id ? markQuestionPlayed(question, now) : question,
              )
            : current.questions;

        if (drawNext) {
          const pool = filterQuestionsForDraw(nextQuestions, current.settings);
          nextQuestionToLoad = pickRandom(pool);
          nextQuestionSettings = current.settings;
        }

        return {
          ...current,
          rounds: recalculated,
          questions: nextQuestions,
        };
      });

      setShareRound(savedRound);
      setEditingRound(null);
      if (nextQuestionToLoad) {
        setSelectedQuestion(nextQuestionToLoad);
        setRoundForm(questionToRoundForm(nextQuestionToLoad, nextQuestionSettings));
      } else {
        setSelectedQuestion(null);
        setRoundForm(emptyRoundForm(nextQuestionSettings));
      }
      setThemeIndex((current) => current + 1);
      if (nextQuestionToLoad) {
        setNotice(`Round saved. Loaded next question${nextQuestionToLoad.category ? ` from ${nextQuestionToLoad.category}` : ''}.`);
      } else if (drawNext) {
        setNotice(editingRound ? 'Round updated. No matching next question available.' : 'Round saved. No matching next question available.');
      } else {
        setNotice(editingRound ? 'Round updated. Totals recalculated.' : 'Round saved and analytics updated.');
      }
      return true;
    } catch (error) {
      setNotice(error.message || 'Could not save round.');
      return false;
    }
  };

  const nextQuestion = () => {
    const hasQuestion = Boolean(roundForm.question.trim());
    const hasJayPenalty = Boolean(String(roundForm.jayScore).trim());
    const hasKimPenalty = Boolean(String(roundForm.kimScore).trim());
    const hasBothPenalties = hasJayPenalty && hasKimPenalty;

    if (hasQuestion && hasBothPenalties) {
      saveRound({ drawNext: true });
      return;
    }

    if (editingRound) {
      setNotice('Save or cancel this edit before moving to the next question.');
      return;
    }

    if (settings.requireNotes && hasQuestion && hasBothPenalties && !roundForm.notes.trim()) {
      setNotice('Add notes before saving this round.');
      return;
    }

    if (hasQuestion && (hasJayPenalty || hasKimPenalty) && !hasBothPenalties) {
      setNotice('Enter both penalties or reset the round before moving on.');
      return;
    }

    drawRandomQuestion();
  };

  const editRound = (round) => {
    setEditingRound(round);
    setSelectedQuestion(null);
    setShareRound(round);
    setRoundForm(roundToRoundForm(round));
    setActiveTab('game');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteRound = (id) => {
    setGameState((current) => ({
      ...current,
      rounds: recalculateRounds(current.rounds.filter((round) => round.id !== id)),
    }));
    if (editingRound?.id === id) {
      setEditingRound(null);
      setRoundForm(emptyRoundForm(settings));
    }
    setNotice('Round deleted. Totals recalculated.');
  };

  const playAgain = (round) => {
    setEditingRound(null);
    setSelectedQuestion(null);
    setShareRound(round);
    setRoundForm({
      ...roundToRoundForm(round),
      scoringMode: round.scoringMode || getDefaultScoringMode(round.roundType),
      scoringOutcomeType: round.scoringOutcomeType || getDefaultScoringOutcomeType(round.roundType),
      winnerSelection: 'tie',
      actualAnswer: '',
      jayGuess: '',
      kimGuess: '',
      actualText: '',
      jayActualAnswer: '',
      kimActualAnswer: '',
      jayGuessedAnswer: '',
      kimGuessedAnswer: '',
      jayActualList: '',
      kimActualList: '',
      jayGuessedList: '',
      kimGuessedList: '',
      jayScore: '',
      kimScore: '',
      manualScores: false,
    });
    setActiveTab('game');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addQuestion = (questionInput) => {
    const question = createQuestionTemplate({ ...questionInput, source: 'manual' });
    if (!question.question) return false;
    const duplicate = Boolean(findMatchingQuestion(questions, question));
    if (duplicate && settings.skipDuplicates) {
      setNotice('Duplicate skipped. Turn off skip duplicates to import anyway.');
      return false;
    }
    setGameState((current) => ({ ...current, questions: [...current.questions, question] }));
    setNotice('Question added to the bank.');
    return true;
  };

  const importQuestions = (incomingQuestions) => {
    setGameState((current) => ({ ...current, questions: [...current.questions, ...incomingQuestions] }));
    setNotice(`Imported ${incomingQuestions.length} questions.`);
  };

  const connectGoogleSheet = (sheetInput) => {
    const reference = parseGoogleSheetReference(sheetInput);
    if (!reference) {
      setNotice('Enter a valid Google Sheet URL or Sheet ID.');
      return false;
    }

    const connectedAt = new Date().toISOString();
    setGameState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        googleSheetInput: reference.raw,
        googleSheetId: reference.id,
        googleSheetGid: reference.gid,
        googleSheetConnectedAt: connectedAt,
      },
    }));
    setNotice('Google Sheet connected.');
    return true;
  };

  const syncGoogleSheet = async (sheetInputOverride = '') => {
    const reference = parseGoogleSheetReference(sheetInputOverride || settings.googleSheetInput || settings.googleSheetId);
    if (!reference) {
      setNotice('Connect a Google Sheet first.');
      return false;
    }

    if (isSyncingGoogleSheet) return false;

    setIsSyncingGoogleSheet(true);
    try {
      const response = await fetch(reference.csvUrl);
      if (!response.ok) {
        throw new Error(`Could not fetch the Google Sheet CSV (HTTP ${response.status}).`);
      }

      const rawText = await response.text();
      if (!rawText.trim() || /^<!doctype html/i.test(rawText.trim()) || /^<html/i.test(rawText.trim())) {
        throw new Error(
          'Google returned an HTML page instead of CSV. Share that sheet tab as “Anyone with the link can view” or publish it before syncing.',
        );
      }

      const syncedAt = new Date().toISOString();
      const result = parseGoogleSheetImport({
        rawText,
        existingQuestions: questions,
        overwriteExisting: Boolean(settings.googleSheetOverwriteExisting),
        importedAt: syncedAt,
      });

      const updateMap = new Map(result.updates.map((question) => [question.id, question]));

      setGameState((current) => ({
        ...current,
        questions: [
          ...current.questions.map((question) => updateMap.get(question.id) || question),
          ...result.imports,
        ],
        settings: {
          ...current.settings,
          googleSheetInput: reference.raw,
          googleSheetId: reference.id,
          googleSheetGid: reference.gid,
          googleSheetConnectedAt: current.settings.googleSheetConnectedAt || syncedAt,
          googleSheetLastSyncedAt: syncedAt,
        },
      }));

      if (selectedQuestion && updateMap.has(selectedQuestion.id)) {
        const updatedQuestion = updateMap.get(selectedQuestion.id);
        setSelectedQuestion(updatedQuestion);
        setRoundForm(questionToRoundForm(updatedQuestion, settings));
      }

      const summary = {
        ...result.summary,
        syncedAt,
        sheetId: reference.id,
      };
      setGoogleSheetSyncSummary(summary);
      setNotice(
        `Google Sheet updated: ${summary.imported} imported, ${summary.updated} updated, ${summary.duplicates} duplicates, ${summary.invalid} invalid, ${summary.skipped} skipped.`,
      );
      return true;
    } catch (error) {
      setNotice(error.message || 'Could not update from Google Sheet.');
      return false;
    } finally {
      setIsSyncingGoogleSheet(false);
    }
  };

  const updateQuestion = (id, patch) => {
    setGameState((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        question.id === id ? createQuestionTemplate({ ...question, ...patch, id: question.id }) : question,
      ),
    }));
    if (selectedQuestion?.id === id) {
      const updated = createQuestionTemplate({ ...selectedQuestion, ...patch, id });
      setSelectedQuestion(updated);
      setRoundForm(questionToRoundForm(updated, settings));
    }
    setNotice('Question updated.');
    return true;
  };

  const deleteQuestion = (id) => {
    setGameState((current) => ({ ...current, questions: current.questions.filter((question) => question.id !== id) }));
    if (selectedQuestion?.id === id) {
      setSelectedQuestion(null);
      setRoundForm(emptyRoundForm(settings));
    }
    setNotice('Question deleted from bank.');
  };

  const duplicateQuestion = (id) => {
    const source = questions.find((question) => question.id === id);
    if (!source) return;
    const duplicate = createQuestionTemplate({
      ...source,
      id: makeId('question'),
      question: `${source.question} (copy)`,
      source: 'manual',
      sourceLabel: '',
      addedBy: '',
      importedFromGoogleSheet: false,
      importDate: null,
      used: false,
      timesPlayed: 0,
      lastPlayedAt: null,
    });
    setGameState((current) => ({ ...current, questions: [...current.questions, duplicate] }));
    setNotice('Question duplicated.');
  };

  const toggleQuestionUsed = (id, used) => {
    setGameState((current) => ({
      ...current,
      questions: current.questions.map((question) => (question.id === id ? setQuestionUsed(question, used) : question)),
    }));
    setNotice(used ? 'Question marked used.' : 'Question marked unused.');
  };

  const addCategory = (name) => {
    const category = createCategory(name, categoryOptions.length);
    if (!category.name) return;
    setGameState((current) => ({
      ...current,
      categories: [...(current.categories || []), category],
    }));
    setNotice('Category added.');
  };

  const updateCategory = (oldName, patch) => {
    const nextName = patch.name?.trim() || oldName;
    setGameState((current) => ({
      ...current,
      categories: categoryOptions.map((category) =>
        category.name === oldName ? { ...category, ...patch, name: nextName } : category,
      ),
      questions: current.questions.map((question) =>
        question.category === oldName ? { ...question, category: nextName, updatedAt: new Date().toISOString() } : question,
      ),
      rounds: current.rounds.map((round) => (round.category === oldName ? { ...round, category: nextName } : round)),
    }));
    setNotice('Category updated.');
  };

  const deleteCategory = (name) => {
    setGameState((current) => ({
      ...current,
      categories: categoryOptions.filter((category) => category.name !== name),
      questions: current.questions.map((question) =>
        question.category === name ? { ...question, category: '', updatedAt: new Date().toISOString() } : question,
      ),
    }));
    setNotice('Category removed from the manager. Played rounds keep their label.');
  };

  const bulkAssignCategory = (ids, category) => {
    if (!ids.length || !category) return;
    setGameState((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        ids.includes(question.id) ? { ...question, category, updatedAt: new Date().toISOString() } : question,
      ),
    }));
    setNotice(`Updated ${ids.length} questions.`);
  };

  const skipQuestion = () => {
    setSelectedQuestion(null);
    setEditingRound(null);
    setRoundForm(emptyRoundForm(settings));
    setNotice('Question skipped and left available in the bank.');
  };

  const returnQuestion = () => {
    setSelectedQuestion(null);
    setRoundForm(emptyRoundForm(settings));
    setNotice('Question returned to the bank.');
  };

  const exportBackup = () => {
    downloadText(
      JSON.stringify(
        {
          schemaVersion: SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          rounds,
          questions,
          categories: categoryOptions,
          settings,
        },
        null,
        2,
      ),
      `kjk-kimjaykinks-backup-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );
    setNotice('Full game backup exported.');
  };

  const importBackup = (rawText) => {
    try {
      const parsed = JSON.parse(rawText);
      const imported = validateImportedGame(parsed);
      setGameState(imported);
      setSelectedQuestion(null);
      setEditingRound(null);
      setRoundForm(emptyRoundForm(imported.settings));
      setNotice(`Imported backup with ${imported.rounds.length} rounds and ${imported.questions.length} questions.`);
    } catch (error) {
      setNotice(error.message || 'Backup import failed.');
    }
  };

  const importBackupFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importBackup(String(reader.result || ''));
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  const exportHistoryJson = () => {
    const sharedRounds = rounds.map((round) => ({
      ...round,
      actualText: getMaskedAnswerValue(round.actualText, getRoundAnswerType(round), round.roundType),
      actualAnswers: {
        jay: getMaskedAnswerValue(round.actualAnswers?.jay, getRoundAnswerType(round), round.roundType),
        kim: getMaskedAnswerValue(round.actualAnswers?.kim, getRoundAnswerType(round), round.roundType),
      },
    }));
    downloadText(
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), rounds: sharedRounds }, null, 2),
      'kjk-kimjaykinks-history.json',
      'application/json',
    );
    setNotice('Round history JSON exported.');
  };

  const exportHistoryCsv = () => {
    downloadText(exportRoundsCsv(rounds), 'kjk-kimjaykinks-history.csv', 'text/csv');
    setNotice('Round history CSV exported.');
  };

  const withBusy = async (work, fallbackMessage) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await work();
    } catch (error) {
      setNotice(error.message || fallbackMessage);
    } finally {
      setIsBusy(false);
    }
  };

  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const getScoreboardCaptureElement = () =>
    (activeTab === 'export' ? exportScoreboardRef.current : scoreboardRef.current) || scoreboardRef.current || exportScoreboardRef.current;

  const copyScoreboard = () =>
    withBusy(
      () =>
        copyOrDownloadPng({
          element: getScoreboardCaptureElement(),
          filename: `kjk-kimjaykinks-scoreboard-${new Date().toISOString().slice(0, 10)}.png`,
          notice: setNotice,
        }),
      'Could not copy scoreboard graphic.',
    );

  const shareQuestion = () =>
    withBusy(
      async () => {
        const element = getScoreboardCaptureElement();
        if (!element) throw new Error('Scoreboard is not ready yet.');
        if (!scoreboardQuestionText.trim()) throw new Error('Load or type a question before sharing.');

        await nextPaint();

        try {
          await shareElementImage({
            element,
            filename: `kjk-kimjaykinks-question-round-${scoreboardRoundNumber}.png`,
            title: `KJK KIMJAYKINKS Round ${scoreboardRoundNumber}`,
            text: scoreboardCategory
              ? `Round ${scoreboardRoundNumber} - ${scoreboardCategory}\n${scoreboardQuestionText}`
              : `Round ${scoreboardRoundNumber}\n${scoreboardQuestionText}`,
          });
          setNotice('Question shared. Pick WhatsApp in the share sheet to send it.');
        } catch (error) {
          if (error?.name === 'AbortError') return;
          throw error;
        }
      },
      'Could not share question.',
    );

  const copyRoundCard = (round = latestRound) => {
    setShareRound(round);
    return withBusy(
      async () => {
        await nextPaint();
        return copyOrDownloadPng({
          element: roundCardRef.current,
          filename: `kjk-kimjaykinks-round-${round?.number || 'card'}.png`,
          notice: setNotice,
        });
      },
      'Could not copy round graphic.',
    );
  };

  const downloadRoundCard = (round = latestRound) => {
    setShareRound(round);
    return withBusy(
      async () => {
        await nextPaint();
        return downloadElementPng({
          element: roundCardRef.current,
          filename: `kjk-kimjaykinks-round-${round?.number || 'card'}.png`,
        }).then(() => setNotice('Round PNG downloaded.'));
      },
      'Could not export round card.',
    );
  };

  const exportAnimation = () =>
    withBusy(
      () => exportRoundWebm(latestRound).then(() => setNotice('Round reveal WebM exported.')),
      'WebM export is not available in this browser. Use the PNG round card.',
    );

  const confirmReset = () => {
    setGameState((current) => {
      if (resetTarget === 'history' || resetTarget === 'game') {
        return { ...current, rounds: [] };
      }
      if (resetTarget === 'bank') {
        return { ...current, questions: [] };
      }
      return {
        schemaVersion: SCHEMA_VERSION,
        rounds: [],
        questions: [],
        categories: DEFAULT_CATEGORIES,
        settings: { ...DEFAULT_SETTINGS },
      };
    });
    if (resetTarget === 'wipe') clearGameState();
    setSelectedQuestion(null);
    setEditingRound(null);
    setShareRound(null);
    setRoundForm(emptyRoundForm(resetTarget === 'wipe' ? DEFAULT_SETTINGS : settings));
    setResetTarget('');
    setNotice(resetTarget === 'wipe' ? 'Full wipe complete.' : 'Reset complete.');
  };

  return (
    <main className="app" style={appStyle}>
      <div className="reference-bg" aria-hidden="true" />
      <div className="ambient-grid" aria-hidden="true" />

      <header className="top-bar">
        <div className="top-bar-left">
          <p className="eyebrow sponsor-tag">Sponsored by 92.1 JKC Radio</p>
        </div>

        <div className="brand-lockup">
          <h1>KJK KIMJAYKINKS</h1>
        </div>

        <nav className="top-actions" aria-label="Game controls">
          <details className="top-menu settings-menu">
            <summary aria-label="Open settings">
              <span className="settings-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
                  <path
                    d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.18 7.18 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.84a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span className="settings-label">Settings</span>
            </summary>
            <div className="top-menu-panel settings-menu-panel">
              <section className="settings-menu-section">
                <span className="settings-section-label">Theme</span>
                <ThemeSwitcher
                  activeIndex={themeIndex % PALETTES.length}
                  soundEnabled={soundEnabled}
                  onThemeChange={setThemeIndex}
                  onShuffle={() => setThemeIndex((current) => current + 1)}
                  onToggleSound={() => setSoundEnabled((current) => !current)}
                />
              </section>

              <section className="settings-menu-section">
                <span className="settings-section-label">Data</span>
                <button type="button" className="ghost-button compact" onClick={exportBackup}>
                  Export Backup
                </button>
                <button type="button" className="ghost-button compact" onClick={() => backupInputRef.current?.click()}>
                  Import Backup
                </button>
                <input ref={backupInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={importBackupFile} />
              </section>

              <section className="settings-menu-section">
                <span className="settings-section-label">Reset</span>
                <button type="button" className="danger-button compact" onClick={() => setResetTarget('game')}>
                  New Game
                </button>
                <button type="button" className="danger-button compact" onClick={() => setResetTarget('history')}>
                  Reset History
                </button>
                <button type="button" className="danger-button compact" onClick={() => setResetTarget('bank')}>
                  Reset Bank
                </button>
                <button type="button" className="danger-button compact" onClick={() => setResetTarget('wipe')}>
                  Full Wipe
                </button>
              </section>
            </div>
          </details>
        </nav>
      </header>

      <TabNavigation activeTab={activeTab} tabs={tabs} onChange={setActiveTab} />

      <section className="tab-shell" aria-label="KJK KIMJAYKINKS workspace">
        <section className={`tab-panel ${activeTab === 'game' ? 'is-active' : ''}`} hidden={activeTab !== 'game'}>
          <GameTab
            rounds={rounds}
            selectedQuestion={selectedQuestion}
            editingRound={editingRound}
            form={roundForm}
            drawPoolCount={drawPool.length}
            analytics={analytics}
            scoreboardRef={scoreboardRef}
            onFormChange={updateRoundForm}
            onSaveRound={saveRound}
            onShareQuestion={shareQuestion}
            onNextQuestion={nextQuestion}
            onCancelEdit={() => {
              setEditingRound(null);
              setRoundForm(emptyRoundForm(settings));
            }}
            canShareQuestion={canShareQuestion}
            isBusy={isBusy}
          />
        </section>

        <section className={`tab-panel ${activeTab === 'questions' ? 'is-active' : ''}`} hidden={activeTab !== 'questions'}>
          <QuestionBankPanel
            questions={questions}
            settings={settings}
            categories={categories}
            categoryOptions={categoryOptions}
            categoryColorMap={categoryColorMap}
            tags={tags}
            isSyncingGoogleSheet={isSyncingGoogleSheet}
            googleSheetSyncSummary={googleSheetSyncSummary}
            onSettingsChange={updateSettings}
            onConnectGoogleSheet={connectGoogleSheet}
            onSyncGoogleSheet={syncGoogleSheet}
            onAddQuestion={addQuestion}
            onImportQuestions={importQuestions}
            onUpdateQuestion={updateQuestion}
            onDeleteQuestion={deleteQuestion}
            onDuplicateQuestion={duplicateQuestion}
            onToggleUsed={toggleQuestionUsed}
            onPickQuestion={loadQuestion}
            onAddCategory={addCategory}
            onUpdateCategory={updateCategory}
            onDeleteCategory={deleteCategory}
            onBulkAssignCategory={bulkAssignCategory}
          />
        </section>

        <section className={`tab-panel ${activeTab === 'history' ? 'is-active' : ''}`} hidden={activeTab !== 'history'}>
          <HistoryPanel
            rounds={rounds}
            categories={categories}
            categoryColorMap={categoryColorMap}
            onEdit={editRound}
            onDelete={deleteRound}
            onPlayAgain={playAgain}
            onExportJson={exportHistoryJson}
            onExportCsv={exportHistoryCsv}
            onExportRoundCard={(round) => downloadRoundCard(round)}
          />
        </section>

        <section className={`tab-panel ${activeTab === 'analytics' ? 'is-active' : ''}`} hidden={activeTab !== 'analytics'}>
          <AnalyticsPanel analytics={analytics} categoryColorMap={categoryColorMap} />
        </section>

        <section className={`tab-panel ${activeTab === 'export' ? 'is-active' : ''}`} hidden={activeTab !== 'export'}>
          <ExportTab
            rounds={rounds}
            selectedQuestion={selectedQuestion}
            form={roundForm}
            editingRound={editingRound}
            scoreboardRef={exportScoreboardRef}
            round={latestRound}
            roundCardRef={roundCardRef}
            onShareQuestion={shareQuestion}
            onCopyRoundCard={() => copyRoundCard(latestRound)}
            onDownloadRoundCard={() => downloadRoundCard(latestRound)}
            onExportAnimation={exportAnimation}
            onCopyScoreboard={copyScoreboard}
            canShareQuestion={canShareQuestion}
            onExportBackup={exportBackup}
            onImportBackup={() => backupInputRef.current?.click()}
            isBusy={isBusy}
          />
        </section>

        <section className={`tab-panel ${activeTab === 'settings' ? 'is-active' : ''}`} hidden={activeTab !== 'settings'}>
          <SettingsTab
            settings={settings}
            themeIndex={themeIndex}
            soundEnabled={soundEnabled}
            questionCount={questions.length}
            roundCount={rounds.length}
            categoryCount={categoryOptions.length}
            onThemeChange={setThemeIndex}
            onShuffleTheme={() => setThemeIndex((current) => current + 1)}
            onToggleSound={() => setSoundEnabled((current) => !current)}
            onSettingsChange={updateSettings}
            onReset={setResetTarget}
            onExportBackup={exportBackup}
            onImportBackup={() => backupInputRef.current?.click()}
          />
        </section>
      </section>

      {notice ? <div className="toast" role="status">{notice}</div> : null}

      <ConfirmResetModal target={resetTarget} onConfirm={confirmReset} onCancel={() => setResetTarget('')} />
    </main>
  );
}

export default App;
