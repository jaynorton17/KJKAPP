import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  arrayUnion,
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage';
import AnalyticsPanel from './components/AnalyticsPanel.jsx';
import MainScoreboard16x9 from './components/MainScoreboard16x9.jsx';
import {
  calculateAnalytics,
  CATEGORY_COLOR_MAP,
  createQuestionTemplate,
  createRoundResult,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  ROUND_TYPES,
  addScores,
  deriveCategories,
  filterQuestionsForDraw,
  formatScore,
  getDefaultAnswerType,
  getRoundAnswerType,
  getRoundPenaltyTotals,
  makeId,
  normalizeText,
  PALETTES,
  PLAYER_LABEL,
  STARTER_QUESTIONS,
  parseAnswerList,
  parseNumber,
  pickRandom,
  recalculateRounds,
  ROUND_TYPE_LABEL,
  markQuestionPlayed,
  setQuestionUsed,
  toScore,
} from './utils/game.js';
import { loadThemeIndex, saveThemeIndex } from './utils/storage.js';
import { firebaseAuth, firebaseIsConfigured, firestore, storage } from './lib/firebase.js';
import { parseGoogleSheetImport, parseGoogleSheetReference } from './utils/importers.js';

const seats = ['jay', 'kim'];
const categoryColorMap = CATEGORY_COLOR_MAP;
const defaultAuthForm = { displayName: '', email: '', password: '', resetEmail: '' };
const defaultDraft = { ownAnswer: '', guessedOther: '' };
const defaultPenaltyDraft = { jay: '0', kim: '0' };
const defaultBankDraft = { question: '', category: '', roundType: 'numeric', tags: '', notes: '' };
const defaultChatDraft = '';
const AMA_COST = 1000;
const defaultRedemptionDraft = () => ({ itemId: '', title: '', description: '', cost: '', active: true, keepOnRedeemed: false, itemType: 'forfeit' });
const defaultForfeitRequestDraft = () => ({ title: '', description: '', open: false });
const defaultForfeitResponseDraft = () => ({ price: '', message: '' });
const defaultAmaQuestionDraft = () => ({ question: '', open: false });
const defaultAmaAnswerDraft = () => ({ answer: '', story: '', media: [], relatedCategories: [], open: false, question: '', itemId: '', requestId: '' });
const activeGameKey = 'kjk-active-game-id';
const editingModeKey = 'kjk-editing-mode';
const questionBankMetaId = 'question-bank-source';
const EDITING_MODE_PIN = '0000';
const TEST_GAME_PREFIX = 'test-game-';
const TEST_MODE_PLAYER_UID = 'editing-mode-kim';
const TEST_MODE_PLAYER_NAME = 'Kim (Test)';
const fixedPlayerUids = {
  jay: 'jaynorton17',
  kim: 'stonekim93',
};
const normalizeIdentity = (value) => normalizeText(value).toLowerCase();
const seatFromPlayerRef = (value) => {
  const normalized = normalizeIdentity(value);
  if (!normalized) return null;
  if (normalized === 'jay' || normalized === normalizeIdentity(fixedPlayerUids.jay) || normalized === normalizeIdentity(PLAYER_LABEL.jay)) return 'jay';
  if (normalized === 'kim' || normalized === normalizeIdentity(fixedPlayerUids.kim) || normalized === normalizeIdentity(PLAYER_LABEL.kim)) return 'kim';
  return null;
};
const inferSeatFromUser = (user, profile) =>
  seatFromPlayerRef(profile?.displayName)
  || seatFromPlayerRef(user?.displayName)
  || seatFromPlayerRef(user?.email?.split('@')[0])
  || seatFromPlayerRef(user?.uid)
  || null;
const playerIdForSeat = (seat = 'jay') => fixedPlayerUids[seat === 'kim' ? 'kim' : 'jay'];
const canonicalPlayerIdForRef = (value, fallbackSeat = 'jay') => playerIdForSeat(seatFromPlayerRef(value) || (fallbackSeat === 'kim' ? 'kim' : 'jay'));
const oppositeSeatOf = (seat = 'jay') => (seat === 'kim' ? 'jay' : 'kim');
const preferredSeatForUser = (user, profile) => inferSeatFromUser(user, profile) || seatFromPlayerRef(user?.uid) || 'jay';
const buildGameInviteId = (targetGameId = '', invitedForUserId = '') =>
  targetGameId && invitedForUserId ? `game-invite-${targetGameId}-${invitedForUserId}` : '';
const getRecordTime = (value) => {
  if (!value) return 0;
  if (typeof value?.seconds === 'number') {
    return (value.seconds * 1000) + Math.round((value.nanoseconds || 0) / 1_000_000);
  }
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const sortByNewest = (a, b) =>
  getRecordTime(b?.updatedAt || b?.createdAt || b?.requestedAt || b?.redeemedAt || b?.completedAt)
  - getRecordTime(a?.updatedAt || a?.createdAt || a?.requestedAt || a?.redeemedAt || a?.completedAt);
const sortByOldest = (a, b) =>
  getRecordTime(a?.createdAt || a?.redeemedAt || a?.updatedAt || a?.questionAskedAt || a?.answeredAt)
  - getRecordTime(b?.createdAt || b?.redeemedAt || b?.updatedAt || b?.questionAskedAt || b?.answeredAt);
const collectGameQuestionIds = (games = [], { includeQueued = true } = {}) =>
  mergeUniqueIds(
    ...(games || []).map((entry) =>
      mergeUniqueIds(
        entry?.usedQuestionIds || [],
        (entry?.rounds || []).map((round) => round?.questionId),
        entry?.currentRound?.questionId ? [entry.currentRound.questionId] : [],
        includeQueued ? (entry?.questionQueueIds || []) : [],
      ),
    ),
  );
const isAmaStoreItem = (item = {}) => {
  const normalizedType = normalizeIdentity(item.itemType || item.linkedType || item.type);
  const normalizedTitle = normalizeIdentity(item.title || item.name);
  return normalizedType === 'ama' || normalizedTitle === 'ama' || normalizedTitle.includes('ask me anything');
};
const isAmaDiaryEntry = (entry = {}) =>
  normalizeIdentity(entry.sourceType || entry.entryType || entry.linkedType) === 'ama'
  || Boolean(entry.amaHistoryId || entry.amaItemId);
const playerLabelForRef = (value) => {
  const seat = seatFromPlayerRef(value);
  if (seat) return PLAYER_LABEL[seat] || seat;
  return normalizeText(value) || 'Unknown';
};
const buildAmaChapterTitle = (question = '', chapterNumber = 0) => {
  const cleanQuestion = normalizeText(question);
  if (!cleanQuestion) return `Chapter ${chapterNumber || 1}`;
  return cleanQuestion.length > 68 ? `${cleanQuestion.slice(0, 65).trim()}...` : cleanQuestion;
};
const buildDiarySnapshotInsight = (row = {}) => {
  const category = row.category || 'Category';
  const rounds = Number(row.rounds || 0);
  const jayTotal = Number(row.totals?.jay || 0);
  const kimTotal = Number(row.totals?.kim || 0);
  const totalPenalty = jayTotal + kimTotal;
  const jayStrength = totalPenalty > 0 ? Math.round((kimTotal / totalPenalty) * 100) : 50;
  const kimStrength = totalPenalty > 0 ? Math.round((jayTotal / totalPenalty) * 100) : 50;
  const winner = row.winner || 'tie';
  const gap = Math.abs(jayTotal - kimTotal);
  const summary = winner === 'tie'
    ? `At this point, Jay and Kim were level in ${category} based on ${rounds} ${rounds === 1 ? 'question' : 'questions'}.`
    : gap > 0
      ? `At this point, ${PLAYER_LABEL[winner] || winner} was ahead in ${category} by ${formatScore(gap)} across ${rounds} ${rounds === 1 ? 'question' : 'questions'}.`
      : `At this point, ${PLAYER_LABEL[winner] || winner} was ahead in ${category} based on ${rounds} ${rounds === 1 ? 'question' : 'questions'}.`;
  return {
    category,
    rounds,
    winner,
    totals: { jay: jayTotal, kim: kimTotal },
    strengths: { jay: jayStrength, kim: kimStrength },
    summary,
  };
};
const authBackgroundImages = [
  '/jandk/473324395_10170369591710655_8117881123860886295_n.jpg',
  '/jandk/473776333_10170369640735655_1324384306232993814_n.jpg',
  '/jandk/473899501_10170369596675655_4152826598740079670_n.jpg',
  '/jandk/473972609_10170369665910655_8487588676657875313_n.jpg',
];
const fixedSeatForUid = (uid) => seatFromPlayerRef(uid);
const roomColors = {
  jay: 'var(--accent-3)',
  kim: 'var(--accent-2)',
};

const normalizeJoinCode = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const sanitizeNoteKey = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const makeJoinCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const shuffleArray = (items) => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const pickDiverseQuestions = (questions = [], requestedCount = 10) => {
  const safeRequestedCount = Math.max(1, Number.parseInt(requestedCount, 10) || 10);
  const grouped = new Map();
  shuffleArray(questions).forEach((question) => {
    const roundType = String(question?.roundType || 'numeric').trim() || 'numeric';
    if (!grouped.has(roundType)) grouped.set(roundType, []);
    grouped.get(roundType).push(question);
  });
  const roundTypes = shuffleArray([...grouped.keys()]);
  const queue = [];
  while (queue.length < safeRequestedCount) {
    let progressed = false;
    for (const roundType of roundTypes) {
      const bucket = grouped.get(roundType);
      if (!bucket?.length) continue;
      queue.push(bucket.shift());
      progressed = true;
      if (queue.length >= safeRequestedCount) break;
    }
    if (!progressed) break;
  }
  return queue;
};

const seatForUid = (game, uid) => {
  if (!game || !uid) return null;
  if (game.seats?.jay === uid) return 'jay';
  if (game.seats?.kim === uid) return 'kim';
  if (uid === fixedPlayerUids.jay) return 'jay';
  if (uid === fixedPlayerUids.kim) return 'kim';
  return null;
};

const gameSeatProfile = (game, seat = 'jay') => {
  const playerUid = game?.seats?.[seat] || '';
  const profile = playerUid ? game?.playerProfiles?.[playerUid] || null : null;
  return {
    seat,
    uid: playerUid,
    profile,
    displayName: profile?.displayName || PLAYER_LABEL[seat] || seat,
  };
};

const gameSeatDisplayName = (game, seat = 'jay', currentRound = null) =>
  currentRound?.answers?.[seat]?.displayName
  || gameSeatProfile(game, seat).displayName
  || PLAYER_LABEL[seat]
  || seat;

const pairIdForPlayers = (a, b) => [a, b].filter(Boolean).sort().join('::');

const buildPairKey = () => pairIdForPlayers(fixedPlayerUids.jay, fixedPlayerUids.kim);

const mergeUniqueIds = (...lists) => [...new Set(lists.flat().filter(Boolean))];
const debugRoom = (...args) => console.debug('[KJK ROOM]', ...args);
const isLocalTestGameId = (value = '') => String(value || '').startsWith(TEST_GAME_PREFIX);
const isLocalTestGame = (value = null) => Boolean(value?.isLocalOnly) || isLocalTestGameId(value?.id);
const starterQuestionIds = new Set(STARTER_QUESTIONS.map((question) => createQuestionTemplate(question).id));
const isStarterOnlyQuestionBank = (questions = []) =>
  Boolean(questions.length) &&
  questions.length <= STARTER_QUESTIONS.length &&
  questions.every((question) => starterQuestionIds.has(question.id) || question.source === 'starter');
const DEFAULT_PLAYER_CHOICE_OPTIONS = ['Me', 'Them', 'Both', 'Neither'];

const buildEitherOrOptions = (question = '') => {
  const cleaned = normalizeText(question).replace(/[?!.]+$/, '');
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
    const left = normalizeText(match[1]).replace(/^(to |be |have )/i, '');
    const right = normalizeText(match[2]).replace(/^(to |be |have )/i, '');
    if (left && right) return [left, right];
  }
  return [];
};

const inferChoiceOptions = (round = {}) => {
  const roundType = round?.roundType || 'text';
  if (roundType === 'trueFalse') return ['True', 'False'];
  if (Array.isArray(round?.multipleChoiceOptions) && round.multipleChoiceOptions.length) {
    return round.multipleChoiceOptions;
  }
  const question = normalizeText(round?.question);
  if (/who is more likely|who is most likely/i.test(question)) {
    return DEFAULT_PLAYER_CHOICE_OPTIONS;
  }
  const eitherOrOptions = buildEitherOrOptions(question);
  if (eitherOrOptions.length) return eitherOrOptions;
  if (roundType === 'multipleChoice') return DEFAULT_PLAYER_CHOICE_OPTIONS;
  if (roundType === 'preference') return ['Option A', 'Option B'];
  return [];
};

const decodeRankedAnswer = (value, count = 3) => {
  const items = parseAnswerList(value);
  return Array.from({ length: count }, (_, index) => items[index] || '');
};

const encodeRankedAnswer = (items = []) =>
  items
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .join('\n');

const buildDiaryAnalyticsSnapshot = (roundAnalytics = null, relatedCategories = []) => {
  const selectedCategories = [...new Set((relatedCategories || []).map((category) => normalizeText(category)).filter(Boolean))];
  const selectedSet = new Set(selectedCategories);
  const categoryRows = Array.isArray(roundAnalytics?.categoryRows)
    ? roundAnalytics.categoryRows.filter((row) => !selectedSet.size || selectedSet.has(normalizeText(row.category)))
    : [];
  const roundTypeRows = Array.isArray(roundAnalytics?.categoryRoundTypeRows)
    ? roundAnalytics.categoryRoundTypeRows.filter((row) => !selectedSet.size || selectedSet.has(normalizeText(row.category)))
    : [];
  const selectedCategoryNames = categoryRows.map((row) => row.category);
  const selectedRoundTypes = [...new Set(roundTypeRows.map((row) => row.label).filter(Boolean))];
  const currentStreakLabel = roundAnalytics?.currentStreak?.count
    ? `${PLAYER_LABEL[roundAnalytics.currentStreak.winner] || roundAnalytics.currentStreak.winner} x${roundAnalytics.currentStreak.count}`
    : 'No streak';

  return {
    capturedAt: new Date().toISOString(),
    selectedCategories,
    categoryRows: categoryRows.map((row) => ({
      category: row.category,
      rounds: row.rounds,
      totals: row.totals,
      averages: row.averages,
      winner: row.winner,
      volatility: row.volatility,
      averageGap: row.averageGap,
      winRate: row.winRate,
    })),
    categoryInsights: categoryRows.map((row) => buildDiarySnapshotInsight({
      category: row.category,
      rounds: row.rounds,
      totals: row.totals,
      winner: row.winner,
    })),
    roundTypeRows: roundTypeRows.map((row) => ({
      category: row.category,
      roundType: row.roundType,
      label: row.label,
      rounds: row.rounds,
      totals: row.totals,
      averages: row.averages,
      winner: row.winner,
    })),
    summary: {
      totalRounds: Number(roundAnalytics?.totalRounds || 0),
      leaderboardSummary: roundAnalytics?.leaderboardSummary || '',
      leader: roundAnalytics?.leader || '',
      averageLeader: roundAnalytics?.averageLeader || '',
      currentStreakLabel,
      mostCommonCategory: roundAnalytics?.mostCommonCategory || '',
      strongestCategoryJay: roundAnalytics?.bestCategory?.jay || '',
      strongestCategoryKim: roundAnalytics?.bestCategory?.kim || '',
      weakestCategoryJay: roundAnalytics?.worstCategory?.jay || '',
      weakestCategoryKim: roundAnalytics?.worstCategory?.kim || '',
    },
    notes: [
      selectedCategoryNames.length ? `Selected categories: ${selectedCategoryNames.join(', ')}` : 'No categories selected.',
      selectedRoundTypes.length ? `Round types in scope: ${selectedRoundTypes.join(', ')}` : 'No round-type breakdown selected.',
      currentStreakLabel ? `Current streak at capture: ${currentStreakLabel}` : '',
    ].filter(Boolean),
  };
};

const buildDiaryThemeOptions = (roundAnalytics = null) => {
  const fromAnalytics = Array.isArray(roundAnalytics?.categoryRows)
    ? roundAnalytics.categoryRows.map((row) => normalizeText(row.category)).filter(Boolean)
    : [];
  const fromDefaults = DEFAULT_CATEGORIES.map((category) => normalizeText(category.name)).filter(Boolean);
  return [...new Set([...fromAnalytics, ...fromDefaults])];
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatShortDateTime = (value) => {
  if (!value) return '-';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const roleForUid = (game, uid) => {
  const seat = seatForUid(game, uid);
  if (!seat) return null;
  return game?.hostUid === uid ? 'host' : 'player';
};

const roleLabel = (role) => (role === 'host' ? 'Host' : role === 'player' ? 'Player' : 'Guest');

const normalizePenaltyDraftValue = (value) => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? String(parseNumber(trimmed, 0)) : '0';
};

const toPenaltyScores = (draft = {}) => ({
  jay: toScore(String(draft?.jay ?? '').trim() || '0'),
  kim: toScore(String(draft?.kim ?? '').trim() || '0'),
});

const getQuestionDensityClass = (question = '') => {
  const normalizedQuestion = String(question || '').replace(/\s+/g, ' ').trim();
  const questionLength = normalizedQuestion.length;
  const questionWordCount = normalizedQuestion ? normalizedQuestion.split(' ').length : 0;
  if (questionLength > 150 || questionWordCount > 24) return 'is-dense';
  if (questionLength > 96 || questionWordCount > 16) return 'is-long';
  if (questionLength > 60 || questionWordCount > 10) return 'is-medium';
  return 'is-short';
};

const normalizeRevealAnswer = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const formatRoundAnswerValue = (value, roundType = 'numeric') => {
  const normalizedType = String(roundType || 'numeric');
  if (normalizedType === 'ranked' || normalizedType === 'sortIntoOrder') {
    const list = parseAnswerList(value);
    return list.length ? list.join(' • ') : '-';
  }
  return normalizeText(value) || '-';
};

const getRevealComparison = ({ roundType = 'numeric', actualAnswer = '', guessedAnswer = '' }) => {
  const normalizedType = String(roundType || 'numeric');
  if (normalizedType === 'numeric') {
    const actual = parseNumber(actualAnswer, Number.NaN);
    const guessed = parseNumber(guessedAnswer, Number.NaN);
    if (Number.isFinite(actual) && Number.isFinite(guessed) && actual === guessed) {
      return { label: 'Exact same number', tone: 'success' };
    }
    return { label: 'Compared via penalty entry', tone: 'neutral' };
  }

  if (normalizedType === 'ranked' || normalizedType === 'sortIntoOrder') {
    const actualList = parseAnswerList(actualAnswer).map(normalizeRevealAnswer).filter(Boolean);
    const guessedList = parseAnswerList(guessedAnswer).map(normalizeRevealAnswer).filter(Boolean);
    const exactOrderMatch =
      actualList.length > 0 &&
      actualList.length === guessedList.length &&
      actualList.every((entry, index) => entry === guessedList[index]);
    return exactOrderMatch
      ? { label: 'Exact order match', tone: 'success' }
      : { label: 'Order differs', tone: 'warning' };
  }

  const actual = normalizeRevealAnswer(actualAnswer);
  const guessed = normalizeRevealAnswer(guessedAnswer);
  if (!actual && !guessed) return { label: 'No answer shown', tone: 'neutral' };
  return actual && guessed && actual === guessed
    ? { label: 'Matched', tone: 'success' }
    : { label: 'Different answer', tone: 'warning' };
};

const buildGameQuestion = (question) => ({
  id: question.id,
  question: question.question,
  category: question.category,
  roundType: question.roundType || 'numeric',
  defaultAnswerType: question.defaultAnswerType || getDefaultAnswerType(question.roundType),
  multipleChoiceOptions: question.multipleChoiceOptions || [],
  tags: question.tags || [],
  notes: question.notes || '',
  unitLabel: question.unitLabel || '',
  source: question.source || 'starter',
});

const emptyRoundDraft = () => ({ question: '', category: '', roundType: 'numeric', penalties: defaultPenaltyDraft });

const isValidDateString = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

const normalizeStoredQuestion = (raw = {}, fallbackId = '') => {
  const hydrated = createQuestionTemplate({
    ...raw,
    id: raw?.id || fallbackId,
  });

  return {
    ...hydrated,
    id: raw?.id || fallbackId || hydrated.id,
    used: Boolean(raw?.used ?? hydrated.used),
    timesPlayed: Math.max(0, Number.parseInt(raw?.timesPlayed ?? hydrated.timesPlayed ?? 0, 10) || 0),
    lastPlayedAt: isValidDateString(raw?.lastPlayedAt) ? raw.lastPlayedAt : hydrated.lastPlayedAt,
    createdAt: isValidDateString(raw?.createdAt) ? raw.createdAt : hydrated.createdAt,
    updatedAt: raw?.updatedAt || hydrated.updatedAt,
  };
};

const dedupeQuestionsById = (questions = []) => {
  const seen = new Set();
  return questions.filter((question) => {
    const questionId = normalizeText(question?.id);
    if (!questionId || seen.has(questionId)) return false;
    seen.add(questionId);
    return true;
  });
};

const normalizeStoredRounds = (rounds = []) =>
  recalculateRounds(
    [...rounds].sort(
      (left, right) =>
        Number(left?.number || 0) - Number(right?.number || 0) ||
        new Date(left?.createdAt || 0).getTime() - new Date(right?.createdAt || 0).getTime(),
    ),
  );

const ACTIVE_GAME_STATUSES = ['opening', 'active', 'paused'];
const COMPLETED_GAME_STATUSES = ['completed', 'ended'];
const getGameSessionTimestamp = (entry = {}) => getRecordTime(entry?.createdAt || entry?.updatedAt || 0);
const sortByNewestGameSession = (left, right) => {
  const createdGap = getGameSessionTimestamp(right) - getGameSessionTimestamp(left);
  if (createdGap !== 0) return createdGap;
  return getRecordTime(right?.updatedAt || 0) - getRecordTime(left?.updatedAt || 0);
};
const gameRoomCodeForLookup = (entry = {}) => normalizeJoinCode(entry?.roomCode || entry?.joinCode || entry?.code || '');
const isGameSessionJoinable = (entry = {}) =>
  ACTIVE_GAME_STATUSES.includes(entry?.status || 'active')
  && !COMPLETED_GAME_STATUSES.includes(entry?.status || '')
  && !entry?.endedAt;

const getPlayedQuestionIdsForGame = (game = {}) => {
  const archivedRoundIds = mergeUniqueIds((game?.rounds || []).map((round) => round?.questionId));
  if (archivedRoundIds.length) return archivedRoundIds;
  return mergeUniqueIds(game?.usedQuestionIds || []);
};

const getCompletedGameDisplayCount = (game = {}) => {
  const answeredRoundsLength = Array.isArray(game?.rounds) ? game.rounds.length : 0;
  const roundsPlayed = Math.max(0, Number(game?.roundsPlayed || 0));
  const playedQuestionIdsLength = getPlayedQuestionIdsForGame(game).length;
  if (answeredRoundsLength) return answeredRoundsLength;
  if (roundsPlayed) return Math.min(Math.max(playedQuestionIdsLength, roundsPlayed), roundsPlayed);
  return playedQuestionIdsLength;
};

const getGameQuestionGoal = (game, rounds = []) => {
  const playedRounds = Math.max(Number(game?.roundsPlayed || 0), Array.isArray(rounds) ? rounds.length : 0);
  const queuedRounds = Array.isArray(game?.questionQueueIds) ? game.questionQueueIds.filter(Boolean).length : 0;
  const currentRoundCount = game?.currentRound ? 1 : 0;
  const actualQuestionCount = Math.max(0, Number(game?.actualQuestionCount || 0));
  if (actualQuestionCount > 0) return actualQuestionCount;
  const inFlightQuestionCount = playedRounds + queuedRounds + currentRoundCount;
  if (inFlightQuestionCount > 0) return inFlightQuestionCount;
  return Math.max(Number(game?.requestedQuestionCount || 0), playedRounds, 0);
};

const buildGameLibraryEntry = (id, data = {}, roundsData = []) => {
  const status = data.status || 'active';
  const selectedQuestionsLength = Array.isArray(data.questionQueueIds) ? data.questionQueueIds.filter(Boolean).length : 0;
  const usedQuestionIds = Array.isArray(data.usedQuestionIds) ? data.usedQuestionIds.filter(Boolean) : [];
  const answeredRoundsLength = roundsData.length;
  const displayedQuestionCount = COMPLETED_GAME_STATUSES.includes(status)
    ? getCompletedGameDisplayCount({
        rounds: roundsData,
        roundsPlayed: data.roundsPlayed || roundsData.length,
        usedQuestionIds,
      })
    : Math.max(
        Number(data.actualQuestionCount || 0),
        Number(data.requestedQuestionCount || 0),
        answeredRoundsLength + selectedQuestionsLength + (data.currentRound ? 1 : 0),
        0,
      );
  const finalScores = data.finalScores || data.totals || (roundsData.length ? roundsData.at(-1)?.totalsAfterRound || { jay: 0, kim: 0 } : { jay: 0, kim: 0 });
  const currentPlayerList = [
    data.playerProfiles?.[data.seats?.jay]?.displayName || 'Jay',
    data.playerProfiles?.[data.seats?.kim]?.displayName || 'Kim',
  ].filter(Boolean);

  return {
    id,
    joinCode: data.roomCode || data.joinCode || data.code,
    name: data.gameName || `Game ${data.roomCode || data.joinCode || data.code}`,
    status,
    players: currentPlayerList,
    currentRound: data.currentRound?.number || null,
    currentRoundStatus: data.currentRound?.status || '',
    currentRoundQuestion: data.currentRound?.question || '',
    currentRoundCategory: data.currentRound?.category || '',
    currentRoundType: data.currentRound?.roundType || '',
    currentRoundAnswerSeats: Object.keys(data.currentRound?.answers || {}),
    createdAt: data.createdAt || null,
    endedAt: data.endedAt || null,
    endedBy: data.endedBy || '',
    finalScores,
    winner: data.winner || (finalScores ? (Number(finalScores.jay || 0) === Number(finalScores.kim || 0) ? 'tie' : Number(finalScores.jay || 0) < Number(finalScores.kim || 0) ? 'jay' : 'kim') : 'tie'),
    roundsPlayed: data.roundsPlayed || roundsData.length,
    rounds: roundsData,
    questionQueueIds: data.questionQueueIds || [],
    usedQuestionIds,
    seats: data.seats || {},
    playerProfiles: data.playerProfiles || {},
    requestedQuestionCount: Number(data.requestedQuestionCount || 0),
    actualQuestionCount: displayedQuestionCount,
    displayedQuestionCount,
    selectedQuestionsLength,
    answeredRoundsLength,
    roundHistoryLength: roundsData.length,
    currentQuestionIndex: data.currentRound?.number || null,
    lifetimePointsApplied: Boolean(data.lifetimePointsApplied),
  };
};

const upsertGameLibraryEntry = (entries = [], nextEntry = null) => {
  if (!nextEntry?.id) return entries;
  const seen = new Set();
  const merged = [nextEntry, ...entries].filter((entry) => {
    if (!entry?.id || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  merged.sort((left, right) =>
    getRecordTime(right?.createdAt || right?.endedAt || 0) - getRecordTime(left?.createdAt || left?.endedAt || 0),
  );
  return merged;
};

const chunkArray = (items, size = 400) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const upsertQuestionBankBatch = async (db, questions) => {
  if (!db || !questions.length) return;
  for (const chunk of chunkArray(questions, 400)) {
    const batch = writeBatch(db);
    chunk.forEach((question) => {
      batch.set(doc(db, 'questionBank', question.id), question, { merge: true });
    });
    await batch.commit();
  }
};

function Button({ children, className = 'ghost-button compact', ...props }) {
  return (
    <button type="button" className={className} {...props}>
      {children}
    </button>
  );
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }
    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, [query]);

  return matches;
}

function AuthScreen({
  mode,
  form,
  onFormChange,
  onModeChange,
  onSubmit,
  onReset,
  isBusy,
  notice,
}) {
  const isSignup = mode === 'signup';
  const isReset = mode === 'reset';
  const [showPassword, setShowPassword] = useState(false);
  const [authTiles, setAuthTiles] = useState(() =>
    Array.from({ length: 6 }, (_, index) => ({
      id: index,
      src: authBackgroundImages[index % authBackgroundImages.length],
      top: `${12 + index * 13}%`,
      left: `${4 + (index % 3) * 30}%`,
      size: `${18 + (index % 3) * 6}vw`,
      rotate: `${-8 + index * 3}deg`,
      opacity: 0.16 + (index % 3) * 0.05,
    })),
  );

  useEffect(() => {
    const updateTiles = () => {
      const order = [...authBackgroundImages].sort(() => Math.random() - 0.5);
      setAuthTiles(
        Array.from({ length: 6 }, (_, index) => {
          const edgePositions = [
            { top: '4%', left: '2%' },
            { top: '8%', left: '76%' },
            { top: '42%', left: '6%' },
            { top: '52%', left: '80%' },
            { top: '74%', left: '10%' },
            { top: '68%', left: '70%' },
          ];
          const position = edgePositions[index % edgePositions.length];
          return {
            id: `${Date.now()}-${index}`,
            src: order[index % order.length],
            top: position.top,
            left: position.left,
            size: `${16 + ((index + Math.floor(Math.random() * 3)) % 3) * 7}vw`,
            rotate: `${-14 + ((index * 7) % 18)}deg`,
            opacity: 0.12 + ((index + 1) % 4) * 0.04,
          };
        }),
      );
    };

    updateTiles();
    const interval = window.setInterval(updateTiles, 4200);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className="app production-app auth-screen">
      <div className="auth-background auth-background--collage" aria-hidden="true">
        {authTiles.map((tile) => (
          <img
            key={tile.id}
            className="auth-background-tile"
            src={tile.src}
            alt=""
            style={{
              top: tile.top,
              left: tile.left,
              width: tile.size,
              transform: `rotate(${tile.rotate})`,
              opacity: tile.opacity,
            }}
          />
        ))}
      </div>
      <div className="auth-screen-overlay" aria-hidden="true" />
      <section className="auth-shell auth-shell--cover">
        <section className="panel auth-panel auth-panel--glass">
          <div className="auth-topline">
            <span className="status-pill auth-pill">Penalty Points</span>
          </div>

          <div className="auth-brand-lockup">
            <h1>KJK</h1>
            <h2>KIMJAYKINKS</h2>
          </div>

          {notice ? <p className="panel-copy auth-notice">{notice}</p> : null}

          {!isReset ? (
            <div className="auth-form-grid auth-form-grid--sexy">
              {isSignup ? (
                <label className="field">
                  <span>Display name</span>
                  <input value={form.displayName} onChange={(event) => onFormChange({ displayName: event.target.value })} placeholder="Jay or Kim" />
                </label>
              ) : null}
              <label className="field">
                <span>Email / Username</span>
                <input type="email" value={form.email} onChange={(event) => onFormChange({ email: event.target.value })} placeholder="name@example.com" />
              </label>
              <label className="field password-field">
                <span>Password</span>
                <div className="password-row">
                  <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => onFormChange({ password: event.target.value })} placeholder="••••••••" />
                  <Button className="ghost-button compact password-toggle" onClick={() => setShowPassword((current) => !current)}>
                    {showPassword ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </label>
            </div>
          ) : (
            <label className="field">
              <span>Email for reset</span>
              <input type="email" value={form.resetEmail} onChange={(event) => onFormChange({ resetEmail: event.target.value })} placeholder="name@example.com" />
            </label>
          )}

          <div className="button-row auth-actions">
            <Button className="primary-button compact auth-primary-button" onClick={onSubmit} disabled={isBusy}>
              {isReset ? 'Send Reset Link' : isSignup ? 'Create Account' : 'Sign In'}
            </Button>
            {isReset ? (
              <Button className="ghost-button compact" onClick={onReset} disabled={isBusy}>
                Back
              </Button>
            ) : (
              <Button className="ghost-button compact" onClick={() => onModeChange(mode === 'login' ? 'signup' : 'login')} disabled={isBusy}>
                {mode === 'login' ? 'Create account' : 'Sign in'}
              </Button>
            )}
            <Button className="ghost-button compact" onClick={() => onModeChange('reset')} disabled={isBusy}>
              Reset password
            </Button>
          </div>
        </section>
      </section>
    </main>
  );
}

function LobbyScreen({
  user,
  profile,
  questionNotes,
  onSaveDisplayName,
  playerAccounts,
  editingModeEnabled,
  onToggleEditingMode,
  currentPlayerSeat,
  currentPlayerLifetimeLabel,
  pendingActivityCount,
  questionCategories,
  createCode,
  joinCode,
  gameName,
  gameQuestionCount,
  onCreateCodeChange,
  onJoinCodeChange,
  onGameNameChange,
  onGameQuestionCountChange,
  onCreateGame,
  onJoinGame,
  onJoinGameInvite,
  onDismissGameInvite,
  onSyncQuestionBank,
  onImportQuestions,
  onResumeGame,
  onViewSummary,
  onEndGame,
  onDeleteGame,
  onResetBalances,
  onSignOut,
  activeGames,
  previousGames,
  lobbyAnalytics,
  lobbyRoundAnalytics,
  categoryColorMap,
  bankCount,
  questionCount,
  usedQuestionCount,
  remainingQuestionCount,
  unusedQuestionCount,
  syncNotice,
  gameInvites,
  pendingRedemptions,
  requestAlerts,
  responseAlerts,
  onMarkRedemptionSeen,
  onMarkRedemptionCompleted,
  redemptionItems,
  redemptionHistory,
  amaRequests,
  diaryEntries,
  pendingAmaInbox,
  pendingAmaOutbox,
  forfeitPriceRequests,
  onSaveRedemptionItem,
  onDeleteRedemptionItem,
  onToggleRedemptionItemActive,
  onRedeemRedemptionItem,
  onSubmitAmaQuestion,
  onAnswerAmaRequest,
  onCreateForfeitRequest,
  onDeleteForfeitRequest,
  onUpdateForfeitRequest,
  onMarkRequestSeen,
  onMarkResponseSeen,
  onMarkAmaQuestionSeen,
  onMarkAmaAnswerSeen,
  onRespondToForfeitRequest,
  isBusy,
  selectedGameSummary,
  onCloseSummary,
  confirmAction,
  onConfirmAction,
  onCancelAction,
  onResetQuestionBank,
}) {
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('kjk-dashboard-tab') || 'gameLobby');
  const [activityTab, setActivityTab] = useState(() => localStorage.getItem('kjk-activity-tab') || 'activeGames');
  const [createMode, setCreateMode] = useState('random');
  const [selectedRoundTypes, setSelectedRoundTypes] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState(() => normalizeText(profile?.displayName || user?.displayName || user?.email?.split('@')[0] || ''));
  const dashboardMenuRef = useRef(null);
  const isMobileDashboardNav = useMediaQuery('(max-width: 900px)');
  const dashboardPills = [
    { id: 'gameLobby', label: 'Game Lobby', tone: 'lobby', icon: 'home' },
    { id: 'questionBank', label: 'Question Bank', tone: 'questionbank', icon: 'book' },
    { id: 'activity', label: 'Activity', tone: 'activity', icon: 'activity' },
    { id: 'analytics', label: 'Analytics', tone: 'analytics', icon: 'graph' },
    { id: 'diary', label: 'Diary', tone: 'diary', icon: 'book' },
    { id: 'forfeitStore', label: 'Forfeit Store', tone: 'store', icon: 'gift' },
  ];
  const typeOptions = ROUND_TYPES.map((type) => ({ value: type.id, label: type.shortLabel }));
  const categoryOptions = questionCategories?.length ? questionCategories : DEFAULT_CATEGORIES.map((category) => category.name);

  const toggleFilterValue = (value, values, setter) => {
    setter(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
  };

  const handleCreateGame = () =>
    onCreateGame({
      mode: createMode,
      roundTypes: createMode === 'custom' ? selectedRoundTypes : [],
      categories: createMode === 'custom' ? selectedCategories : [],
    });

  const handleCreateAndInviteGame = () =>
    onCreateGame({
      mode: createMode,
      roundTypes: createMode === 'custom' ? selectedRoundTypes : [],
      categories: createMode === 'custom' ? selectedCategories : [],
      sendInvite: true,
    });

  const closeDashboardMenu = () => {
    dashboardMenuRef.current?.removeAttribute('open');
  };

  const handleToggleEditingModeFromMenu = () => {
    closeDashboardMenu();
    onToggleEditingMode();
  };

  const handleResetBalancesFromMenu = () => {
    closeDashboardMenu();
    const pin = window.prompt('Enter PIN to clear both balances.');
    if (pin === null) return;
    if (String(pin).trim() !== '0000') {
      window.alert('Incorrect PIN.');
      return;
    }
    onResetBalances?.();
  };

  const handleSignOutFromMenu = () => {
    closeDashboardMenu();
    onSignOut();
  };

  const handleDashboardTabSelect = (tabId) => {
    closeDashboardMenu();
    setActiveTab(tabId);
    if (tabId === 'activity') setActivityTab((current) => current || 'activeGames');
  };

  const renderDashboardIcon = (icon) => {
    const sharedProps = {
      className: 'dashboard-pill-icon',
      viewBox: '0 0 24 24',
      role: 'img',
      'aria-hidden': 'true',
    };

    switch (icon) {
      case 'home':
        return (
          <svg {...sharedProps}>
            <path
              d="M4 11.5 12 5l8 6.5v7.5a1 1 0 0 1-1 1h-4.5v-5.3H9.5V20H5a1 1 0 0 1-1-1v-7.5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'controller':
        return (
          <svg {...sharedProps}>
            <path
              d="M7 15.5h10c1.9 0 3-1 3-2.5s-1.1-2.5-3-2.5H7c-1.9 0-3 1-3 2.5s1.1 2.5 3 2.5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path d="M8.5 14v-2.6M7.2 12.7h2.6M15.5 12.5h.01M17 13.8h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        );
      case 'trophy':
        return (
          <svg {...sharedProps}>
            <path
              d="M8 5h8v2.5c0 2.2 1.7 3.5 3.5 3.5-.5 2.7-2.8 4-5 4.2V16h2v2H7v-2h2v-.8c-2.2-.2-4.5-1.5-5-4.2C5.3 11 7 9.7 7 7.5V5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'graph':
        return (
          <svg {...sharedProps}>
            <path d="M4 18.5h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M6.5 15.5 10 11l3 2.8 4.8-6.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M17.8 7.5h.01" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        );
      case 'clock':
        return (
          <svg {...sharedProps}>
            <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 8.5v4l2.7 1.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
      case 'gift':
        return (
          <svg {...sharedProps}>
            <path
              d="M5 9h14v3H5V9Zm1 3v7h12v-7M12 9v10M12 9c-1.7 0-3-1-3-2.4C9 5.5 10.3 5 11.5 5c.8 0 1.6.3 2.2.9.5-.6 1.3-.9 2.1-.9 1.2 0 2.2.5 2.2 1.6C18 8 16.7 9 15 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        );
      case 'activity':
        return (
          <svg {...sharedProps}>
            <path d="M4 13h4l2.2-5 3.6 11 2.1-6H20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
      case 'book':
        return (
          <svg {...sharedProps}>
            <path
              d="M6 5.5h9.5A2.5 2.5 0 0 1 18 8v10.5a.5.5 0 0 1-.8.4A5.7 5.7 0 0 0 14 18H6.5A2.5 2.5 0 0 1 4 15.5V8A2.5 2.5 0 0 1 6 5.5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M7 8h7M7 11h6M7 14h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        );
      default:
        return null;
    }
  };

  useEffect(() => {
    try {
      window.localStorage.setItem('kjk-dashboard-tab', activeTab);
    } catch {
      // Ignore storage failures.
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      window.localStorage.setItem('kjk-activity-tab', activityTab);
    } catch {
      // Ignore storage failures.
    }
  }, [activityTab]);

  useEffect(() => {
    setProfileNameDraft(normalizeText(profile?.displayName || user?.displayName || user?.email?.split('@')[0] || ''));
  }, [profile?.displayName, user?.displayName, user?.email]);

  return (
    <main className="app production-app">
      <header className="top-bar top-bar--shell">
        {!isMobileDashboardNav ? (
          <div className="top-bar-left">
            <Button className="ghost-button compact" onClick={() => setIsProfileOpen(true)}>
              My Profile
            </Button>
          </div>
        ) : null}
        <div className="brand-lockup">
          <h1>KJK KIMJAYKINKS</h1>
        </div>
        <div className="top-actions">
          {editingModeEnabled ? <span className="status-pill status-pill--test-mode">TEST MODE</span> : null}
          <span className="status-pill dashboard-balance-pill">Jay {formatScore(Number(playerAccounts?.jay?.lifetimePenaltyPoints || 0))}</span>
          <span className="status-pill dashboard-balance-pill">Kim {formatScore(Number(playerAccounts?.kim?.lifetimePenaltyPoints || 0))}</span>
          <details className="top-menu settings-menu dashboard-settings-menu" ref={dashboardMenuRef}>
            <summary aria-label="Open account menu">
              <span className="settings-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
                  <path d="M5 7.5h14M5 12h14M5 16.5h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <span className="sr-only">Account menu</span>
            </summary>
            <div className="top-menu-panel settings-menu-panel dashboard-settings-menu-panel">
              {isMobileDashboardNav ? (
                <section className="settings-menu-section dashboard-menu-section">
                  <span className="settings-section-label">Navigate</span>
                  <div className="dashboard-menu-pill-list">
                    {dashboardPills.map((pill) => (
                      <button
                        key={pill.id}
                        type="button"
                        className={`dashboard-pill tab-button dashboard-menu-pill dashboard-pill--${pill.tone} ${activeTab === pill.id ? 'is-active' : ''}`}
                        onClick={() => handleDashboardTabSelect(pill.id)}
                      >
                        {renderDashboardIcon(pill.icon)}
                        {pill.label}
                        {pill.id === 'activity' && pendingActivityCount > 0 ? <span className="dashboard-pill-dot" aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              <section className="settings-menu-section">
                <span className="settings-section-label">Account</span>
                <Button className="ghost-button compact" onClick={() => { closeDashboardMenu(); setIsProfileOpen(true); }} disabled={isBusy}>
                  My Profile
                </Button>
                <Button className={`ghost-button compact editing-mode-toggle ${editingModeEnabled ? 'is-on' : ''}`} onClick={handleToggleEditingModeFromMenu} disabled={isBusy}>
                  {editingModeEnabled ? 'Editing Mode On' : 'Editing Mode Off'}
                </Button>
                <Button className="ghost-button compact" onClick={handleResetBalancesFromMenu} disabled={isBusy}>
                  Clear Balances
                </Button>
                <Button className="ghost-button compact" onClick={handleSignOutFromMenu}>
                  Sign out
                </Button>
              </section>
            </div>
          </details>
        </div>
        {/*
          Keep the pills inside the same top frame so the header stays fixed in
          one position on every tab. The row below is just the nav rail inside
          that shared shell.
        */}
        {!isMobileDashboardNav ? (
          <nav className="dashboard-pill-nav dashboard-pill-nav--embedded" aria-label="Dashboard sections">
          {dashboardPills.map((pill) => (
            <button
              key={pill.id}
              type="button"
              className={`dashboard-pill tab-button dashboard-pill--${pill.tone} ${activeTab === pill.id ? 'is-active' : ''}`}
              onClick={() => handleDashboardTabSelect(pill.id)}
            >
              {renderDashboardIcon(pill.icon)}
              {pill.label}
              {pill.id === 'activity' && pendingActivityCount > 0 ? <span className="dashboard-pill-dot" aria-hidden="true" /> : null}
            </button>
          ))}
          </nav>
        ) : null}
      </header>

      {editingModeEnabled ? (
        <section className="editing-mode-banner" role="status" aria-live="polite">
          <strong>TEST MODE / EDITING MODE</strong>
          <span>Create Game stays local, auto-submits the other player, and never saves results, analytics, history, forfeits, or player totals.</span>
        </section>
      ) : null}

      <section className="lobby-dashboard">
        {activeTab === 'gameLobby' ? (
          <section className="lobby-tab-panel lobby-tab-panel--game-lobby">
            <div className="game-lobby-grid">
              <section className="panel lobby-panel lobby-panel--lobby create-game-card">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Game Lobby</p>
                    <h2>Create New Game</h2>
                  </div>
                  <span className="status-pill">{questionCount} ready</span>
                </div>

                <div className="create-mode-row">
                  <Button className={`ghost-button compact ${createMode === 'random' ? 'is-on' : ''}`} onClick={() => setCreateMode('random')}>
                    Pick X Random Questions
                  </Button>
                  <Button className={`ghost-button compact ${createMode === 'custom' ? 'is-on' : ''}`} onClick={() => setCreateMode('custom')}>
                    Select My Own
                  </Button>
                </div>

                <div className="lobby-actions lobby-actions--stack">
                  <label className="field">
                    <span>Game Name</span>
                    <input value={gameName} onChange={(event) => onGameNameChange(event.target.value)} placeholder="Jay vs Kim showdown" />
                  </label>
                  <label className="field">
                    <span>Number of Questions</span>
                    <input type="number" inputMode="numeric" min="1" value={gameQuestionCount} onChange={(event) => onGameQuestionCountChange(event.target.value)} placeholder="10" />
                  </label>
                  <label className="field">
                    <span>Host Code Seed</span>
                    <input value={createCode} onChange={(event) => onCreateCodeChange(normalizeJoinCode(event.target.value))} placeholder="Optional" />
                  </label>
                </div>

                {createMode === 'custom' ? (
                  <div className="create-filters-grid">
                    <section className="filter-card">
                      <div className="mini-heading">
                        <div>
                          <span>Question Types</span>
                          <h3>Choose formats</h3>
                        </div>
                      </div>
                      <div className="filter-chip-grid">
                        {typeOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`filter-chip ${selectedRoundTypes.includes(option.value) ? 'is-on' : ''}`}
                            onClick={() => toggleFilterValue(option.value, selectedRoundTypes, setSelectedRoundTypes)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="filter-card">
                      <div className="mini-heading">
                        <div>
                          <span>Categories</span>
                          <h3>Choose themes</h3>
                        </div>
                      </div>
                      <div className="filter-chip-grid filter-chip-grid--categories">
                        {categoryOptions.map((category) => (
                          <button
                            key={category}
                            type="button"
                            className={`filter-chip ${selectedCategories.includes(category) ? 'is-on' : ''}`}
                            onClick={() => toggleFilterValue(category, selectedCategories, setSelectedCategories)}
                          >
                            {category}
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : (
                  <p className="panel-copy">Create instantly with a random pack of unused questions for Jay vs Kim.</p>
                )}

                <div className="button-row lobby-create-actions">
                  <Button className="primary-button lobby-primary-button" onClick={handleCreateGame} disabled={isBusy}>
                    Create New Game
                  </Button>
                  <Button className="ghost-button lobby-secondary-button" onClick={handleCreateAndInviteGame} disabled={isBusy}>
                    Create + Send Game Request
                  </Button>
                </div>
              </section>

              <section className="panel lobby-panel lobby-panel--lobby join-game-card">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Join</p>
                    <h2>Join Game</h2>
                  </div>
                </div>

                <div className="lobby-actions lobby-actions--stack">
                  <label className="field">
                    <span>Join Code</span>
                    <input value={joinCode} onChange={(event) => onJoinCodeChange(normalizeJoinCode(event.target.value))} placeholder="ABCD12" />
                  </label>
                  <Button className="ghost-button lobby-secondary-button" onClick={onJoinGame} disabled={isBusy || !joinCode.length}>
                    Join Game
                  </Button>
                </div>

                {gameInvites.length ? (
                  <GameInvitesPanel
                    invites={gameInvites}
                    onJoinInvite={onJoinGameInvite}
                    onDismissInvite={onDismissGameInvite}
                    isBusy={isBusy}
                    compact
                  />
                ) : null}
              </section>
            </div>

          </section>
        ) : null}

        {activeTab === 'questionBank' ? (
          <section className="lobby-tab-panel" aria-label="Question Bank" id="dashboard-question-bank">
            <section className="panel lobby-panel lobby-panel--lobby question-bank-card dashboard-page-card">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Question Bank</p>
                  <h2>Manage Questions</h2>
                </div>
                <span className="status-pill">{questionCount} loaded</span>
              </div>

              <div className="question-bank-status-grid">
                <article className="stat-tile">
                  <small>Total Loaded</small>
                  <strong>{questionCount}</strong>
                  <span>questions currently available</span>
                </article>
                <article className="stat-tile">
                  <small>Tracked Used</small>
                  <strong>{usedQuestionCount}</strong>
                  <span>already used in games</span>
                </article>
                <article className="stat-tile">
                  <small>Remaining</small>
                  <strong>{remainingQuestionCount}</strong>
                  <span>unused questions left</span>
                </article>
                <article className="stat-tile">
                  <small>Connection</small>
                  <strong>{syncNotice ? 'Needs review' : 'Connected'}</strong>
                  <span>{syncNotice || 'Google Sheet connected'}</span>
                </article>
              </div>

              <div className="button-row question-bank-actions">
                <Button className="ghost-button compact" onClick={onSyncQuestionBank} disabled={isBusy}>
                  Sync Question Bank
                </Button>
                <Button className="primary-button compact" onClick={onImportQuestions} disabled={isBusy}>
                  Import New Questions
                </Button>
                <Button className="ghost-button compact" onClick={onResetQuestionBank} disabled={isBusy}>
                  Re-enter All Questions
                </Button>
              </div>
            </section>
          </section>
        ) : null}

        {activeTab === 'activity' ? (
          <section className="lobby-tab-panel" aria-label="Activity" id="dashboard-activity">
            <section className="activity-page activity-page--bare">
              <div className="dashboard-subnav-shell dashboard-subnav-shell--activity">
                <div className="dashboard-subnav activity-subnav" role="tablist" aria-label="Activity sections">
                  {[
                    { id: 'activeGames', label: 'Active', icon: 'controller' },
                    { id: 'previousGames', label: 'Previous', icon: 'trophy' },
                    { id: 'pending', label: 'Pending', icon: 'clock' },
                  ].map((pill) => (
                    <button
                      key={pill.id}
                      type="button"
                      className={`dashboard-pill tab-button dashboard-pill--activity-sub ${activityTab === pill.id ? 'is-active' : ''}`}
                      onClick={() => setActivityTab(pill.id)}
                    >
                      {renderDashboardIcon(pill.icon)}
                      {pill.label}
                    </button>
                  ))}
                </div>
              </div>

              {activityTab === 'activeGames' ? (
                <div className="activity-content activity-content--active">
                  <div className="active-games-list">
                    {activeGames.length ? (
                      activeGames.map((game) => (
                        <article className="game-record-row" key={game.id}>
                          <div className="game-record-badge" aria-hidden="true">
                            {String((game.gameName || game.joinCode || 'G').slice(0, 2)).toUpperCase()}
                          </div>
                          <div className="game-record-main">
                            <strong>{game.gameName || game.name || game.joinCode}</strong>
                            <span>{game.joinCode}</span>
                            <small>
                              {game.players?.join(' + ') || 'Waiting'} · {game.status || 'active'} · Round {game.currentRound || '—'} · Questions {game.actualQuestionCount || game.questionQueueIds?.length || 0}/{game.requestedQuestionCount || game.actualQuestionCount || game.questionQueueIds?.length || 0} · Created {formatDate(game.createdAt)}
                            </small>
                            <div className="game-progress">
                              <span className="game-progress-label">
                                Progress
                                <strong>
                                  {Math.min(100, Math.round(((game.currentRound || 0) / Math.max(1, game.actualQuestionCount || game.questionQueueIds?.length || 1)) * 100))}%
                                </strong>
                              </span>
                              <div className="game-progress-track">
                                <div
                                  className="game-progress-fill"
                                  style={{
                                    width: `${Math.min(100, Math.round(((game.currentRound || 0) / Math.max(1, game.actualQuestionCount || game.questionQueueIds?.length || 1)) * 100))}%`,
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="game-record-actions dashboard-toolbar-actions">
                            <Button className="ghost-button compact" onClick={() => onResumeGame(game.id)}>
                              Resume Game
                            </Button>
                            <Button className="ghost-button compact" onClick={() => onViewSummary(game.id)}>
                              View Details
                            </Button>
                            <Button className="ghost-button compact" onClick={() => onEndGame(game.id)}>
                              End Game
                            </Button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="activity-empty-state">
                        <h3>No active games yet</h3>
                        <p className="empty-copy">Create one to start a room.</p>
                        <Button className="ghost-button compact" onClick={() => setActiveTab('gameLobby')}>
                          Create New Game
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {activityTab === 'previousGames' ? (
                <div className="activity-content activity-content--previous">
                  <div className="active-games-list active-games-list--previous">
                    {previousGames.length ? (
                      previousGames.map((game) => {
                        const winnerSeat = game.winner === 'jay' || game.winner === 'kim' ? game.winner : 'tie';
                        const completedQuestionCount = getCompletedGameDisplayCount(game);
                        return (
                          <article
                            className={`game-record-row game-record-row--previous game-record-row--winner-${winnerSeat}`}
                            key={game.id}
                          >
                            <div className={`game-record-badge game-record-badge--winner game-record-badge--winner-${winnerSeat}`} aria-hidden="true">
                              {winnerSeat === 'jay' ? 'J' : winnerSeat === 'kim' ? 'K' : 'T'}
                            </div>
                            <div className="game-record-main game-record-main--previous">
                              <strong>{game.gameName || game.name || game.joinCode}</strong>
                              <span>
                                {game.joinCode} · Winner {PLAYER_LABEL[winnerSeat] || 'Tie'}
                              </span>
                              <p className="game-record-summary">
                                Final {formatScore(game.finalScores?.jay || 0)} / {formatScore(game.finalScores?.kim || 0)} · Rounds {completedQuestionCount}
                              </p>
                              <small>
                                {game.players?.join(' + ') || 'Waiting'} · Ended {formatDate(game.endedAt)}
                              </small>
                            </div>
                            <div className="game-record-actions game-record-actions--stacked">
                              <Button className="ghost-button compact" onClick={() => onViewSummary(game.id)}>
                                View Results
                              </Button>
                              <Button className="ghost-button compact" onClick={() => onDeleteGame(game.id)}>
                                Delete Permanently
                              </Button>
                            </div>
                          </article>
                        );
                      })
                    ) : (
                      <div className="activity-empty-state">
                        <h3>No previous games yet</h3>
                        <p className="empty-copy">Finished games will appear here.</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {activityTab === 'pending' ? (
                <div className="activity-content activity-content--pending">
                  <div className="pending-dashboard-grid pending-dashboard-grid--activity">
                    <div className="pending-dashboard-column">
                      <GameInvitesPanel
                        invites={gameInvites}
                        onJoinInvite={onJoinGameInvite}
                        onDismissInvite={onDismissGameInvite}
                        isBusy={isBusy}
                      />

                      <PendingRedemptionsPanel
                        sectionId="dashboard-pending-redemptions"
                        items={pendingRedemptions}
                        onMarkSeen={onMarkRedemptionSeen}
                        onMarkCompleted={onMarkRedemptionCompleted}
                        isBusy={isBusy}
                      />

                      <ForfeitAlertsPanel
                        requestAlerts={requestAlerts}
                        responseAlerts={responseAlerts}
                        onMarkRequestSeen={onMarkRequestSeen}
                        onMarkResponseSeen={onMarkResponseSeen}
                        onRespondToForfeitRequest={onRespondToForfeitRequest}
                        onDeleteForfeitRequest={onDeleteForfeitRequest}
                        onUpdateForfeitRequest={onUpdateForfeitRequest}
                        isBusy={isBusy}
                      />

                      <AmaTasksPanel
                        incomingRequests={pendingAmaInbox}
                        outgoingRequests={pendingAmaOutbox}
                        onMarkRequestSeen={onMarkAmaQuestionSeen}
                        onMarkResponseSeen={onMarkAmaAnswerSeen}
                        onAnswerAmaRequest={onAnswerAmaRequest}
                        roundAnalytics={lobbyRoundAnalytics}
                        isBusy={isBusy}
                      />

                      {!gameInvites.length && !pendingRedemptions.length && !requestAlerts.length && !responseAlerts.length && !pendingAmaInbox.length && !pendingAmaOutbox.length ? (
                        <div className="activity-empty-state activity-empty-state--pending">
                          <h3>Nothing pending</h3>
                          <p className="empty-copy">No pending requests yet.</p>
                        </div>
                      ) : null}
                    </div>

                    <PendingGameTasksPanel activeGames={activeGames} currentUserId={user?.uid} onResumeGame={onResumeGame} />
                  </div>
                </div>
              ) : null}
            </section>
          </section>
        ) : null}

        {activeTab === 'analytics' ? (
          <section className="lobby-tab-panel analytics-page-tab" aria-label="Analytics" id="dashboard-analytics-hub">
            <section className="panel lobby-panel lobby-analytics-card lobby-panel--analytics dashboard-page-card analytics-page-shell">
              <div className="analytics-control-strip" aria-label="Analytics matchup summary">
                <div className="analytics-control-strip-main">
                  <div className="analytics-control-strip-team analytics-control-strip-team--jay">
                    <span className="analytics-flag analytics-flag--hero analytics-flag--england" role="img" aria-label="England flag">
                      <svg viewBox="0 0 36 24" aria-hidden="true">
                        <rect width="36" height="24" rx="4" fill="#ffffff" />
                        <rect x="15" width="6" height="24" fill="#d61f26" />
                        <rect y="9" width="36" height="6" fill="#d61f26" />
                      </svg>
                    </span>
                    <strong className="analytics-control-strip-name">Jay</strong>
                  </div>
                  <span className="analytics-control-strip-divider" aria-hidden="true">|</span>
                  <div className="analytics-control-strip-score">
                    <strong className="analytics-control-strip-scoreline">
                      {lobbyAnalytics.jayGameWins} - {lobbyAnalytics.kimGameWins}
                    </strong>
                  </div>
                  <span className="analytics-control-strip-divider" aria-hidden="true">|</span>
                  <div className="analytics-control-strip-team analytics-control-strip-team--kim">
                    <strong className="analytics-control-strip-name">Kim</strong>
                    <span className="analytics-flag analytics-flag--hero analytics-flag--usa" role="img" aria-label="USA flag">
                      <svg viewBox="0 0 36 24" aria-hidden="true">
                        <rect width="36" height="24" rx="4" fill="#ffffff" />
                        <rect y="0" width="36" height="3" fill="#b22234" />
                        <rect y="3" width="36" height="3" fill="#ffffff" />
                        <rect y="6" width="36" height="3" fill="#b22234" />
                        <rect y="9" width="36" height="3" fill="#ffffff" />
                        <rect y="12" width="36" height="3" fill="#b22234" />
                        <rect y="15" width="36" height="3" fill="#ffffff" />
                        <rect y="18" width="36" height="3" fill="#b22234" />
                        <rect x="0" y="0" width="14" height="12" fill="#3c3b6e" />
                      </svg>
                    </span>
                  </div>
                </div>
                <span className="analytics-control-badge">
                  {lobbyAnalytics.totalGamesPlayed} {lobbyAnalytics.totalGamesPlayed === 1 ? 'game' : 'games'}
                </span>
              </div>

              <AnalyticsPanel
                analytics={lobbyRoundAnalytics}
                categoryColorMap={categoryColorMap}
                variant="dashboard"
                summary={lobbyAnalytics}
              />
            </section>
          </section>
        ) : null}

        {activeTab === 'diary' ? (
          <section className="lobby-tab-panel" aria-label="Diary" id="dashboard-diary">
            <DiaryDashboardSection
              user={user}
              profile={profile}
              currentPlayerSeat={currentPlayerSeat}
              diaryEntries={diaryEntries}
              roundAnalytics={lobbyRoundAnalytics}
              onSubmitAmaQuestion={onSubmitAmaQuestion}
              onAnswerAmaRequest={onAnswerAmaRequest}
              isBusy={isBusy}
            />
          </section>
        ) : null}

        {activeTab === 'forfeitStore' ? (
        <section className="lobby-tab-panel" aria-label="Forfeit store">
          <RedemptionStoreSection
            sectionId="dashboard-forfeit-store"
            user={user}
            profile={profile}
            currentSeat={currentPlayerSeat}
            playerAccounts={playerAccounts}
            redemptionItems={redemptionItems}
            redemptionHistory={redemptionHistory}
            amaRequests={amaRequests}
            diaryEntries={diaryEntries}
            forfeitPriceRequests={forfeitPriceRequests}
            onSaveRedemptionItem={onSaveRedemptionItem}
            onDeleteRedemptionItem={onDeleteRedemptionItem}
            onToggleRedemptionItemActive={onToggleRedemptionItemActive}
            onRedeemRedemptionItem={onRedeemRedemptionItem}
            onSubmitAmaQuestion={onSubmitAmaQuestion}
            onAnswerAmaRequest={onAnswerAmaRequest}
            onCreateForfeitRequest={onCreateForfeitRequest}
            onDeleteForfeitRequest={onDeleteForfeitRequest}
            onUpdateForfeitRequest={onUpdateForfeitRequest}
            onMarkRequestSeen={onMarkRequestSeen}
            onMarkResponseSeen={onMarkResponseSeen}
            onRespondToForfeitRequest={onRespondToForfeitRequest}
            roundAnalytics={lobbyRoundAnalytics}
            isBusy={isBusy}
          />
        </section>
        ) : null}
      </section>

      {selectedGameSummary ? (
        <section className="modal-backdrop game-summary-backdrop" role="presentation" onClick={onCloseSummary}>
          <div className="panel modal-panel game-summary-modal" role="dialog" aria-modal="true" aria-label="Previous game summary" onClick={(event) => event.stopPropagation()}>
            <GameSummaryContent
              gameSummary={selectedGameSummary}
              categoryColorMap={categoryColorMap}
              modalLayout
              onClose={onCloseSummary}
            />
          </div>
        </section>
      ) : null}

      {isProfileOpen ? (
        <section className="modal-backdrop" role="presentation" onClick={() => setIsProfileOpen(false)}>
          <div className="panel modal-panel forfeit-modal" role="dialog" aria-modal="true" aria-label="My Profile" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">Account</p>
                <h2>My Profile</h2>
              </div>
              <span className="status-pill">{profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player'}</span>
            </div>
            <div className="auth-form-grid">
              <label className="field">
                <span>Display Name</span>
                <input value={profileNameDraft} onChange={(event) => setProfileNameDraft(event.target.value)} placeholder="Your display name" />
              </label>
            </div>
            <div className="button-row">
              <Button
                className="primary-button compact"
                onClick={async () => {
                  await onSaveDisplayName?.(profileNameDraft);
                  setIsProfileOpen(false);
                }}
                disabled={isBusy || !normalizeText(profileNameDraft)}
              >
                Save Display Name
              </Button>
              <Button className="ghost-button compact" onClick={() => setIsProfileOpen(false)} disabled={isBusy}>
                Close
              </Button>
            </div>

            <section className="forfeit-requests-panel" style={{ marginTop: 14 }}>
              <div className="panel-heading compact-heading">
                <div>
                  <h3>Flagged Question Notes</h3>
                </div>
                <span className="status-pill">{questionNotes?.length || 0}</span>
              </div>
              <div className="mini-list">
                {questionNotes?.length ? (
                  questionNotes.map((note) => (
                    <article className="mini-list-row forfeit-request-row" key={note.id}>
                      <strong>{note.questionText || note.questionId || 'Question note'}</strong>
                      <span>{note.noteText || '-'}</span>
                      <small>
                        {formatShortDateTime(note.createdAt)}
                        {note.gameId ? ` · Game ${String(note.gameId).slice(-6).toUpperCase()}` : ''}
                        {note.category ? ` · ${note.category}` : ''}
                        {note.roundType ? ` · ${ROUND_TYPE_LABEL[note.roundType] || note.roundType}` : ''}
                      </small>
                    </article>
                  ))
                ) : (
                  <p className="empty-copy">No private flagged notes yet.</p>
                )}
              </div>
            </section>
          </div>
        </section>
      ) : null}

      <ConfirmModal action={confirmAction} onConfirm={onConfirmAction} onCancel={onCancelAction} />
    </main>
  );
}

function QuickDesk({ currentRound, penaltyDraft, setPenaltyDraft, onNextQuestion, onPauseToggle, status, isPaused, isCompleted, isBusy }) {
  return (
    <section className="panel quick-desk-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Penalty Entry</p>
          <h2>Quick Desk</h2>
        </div>
      </div>

      <div className="quick-desk-fields">
        <label className="field">
          <span>Jay penalty</span>
          <input type="number" inputMode="decimal" step="any" value={penaltyDraft.jay} onChange={(event) => setPenaltyDraft({ jay: event.target.value, kim: penaltyDraft.kim })} placeholder="0" />
        </label>
        <label className="field">
          <span>Kim penalty</span>
          <input type="number" inputMode="decimal" step="any" value={penaltyDraft.kim} onChange={(event) => setPenaltyDraft({ jay: penaltyDraft.jay, kim: event.target.value })} placeholder="0" />
        </label>
      </div>

      <Button className="primary-button compact next-question-button" onClick={onNextQuestion} disabled={isBusy || isCompleted}>
        Next Question
      </Button>

      <div className="button-row tiny-actions quick-desk-footer">
        <Button className="ghost-button compact" onClick={onPauseToggle} disabled={isBusy || isCompleted}>
          {isPaused ? 'Resume' : 'Pause'}
        </Button>
        <span className="quick-desk-status">{currentRound ? `Round ${currentRound.number}` : 'Waiting'}</span>
      </div>
    </section>
  );
}

function QuestionAnswerEntry({
  game,
  seat,
  viewerSeat,
  currentRound,
  answerDraft,
  setAnswerDraft,
  onSubmitAnswer,
  submissionState,
  isBusy,
  embedded = false,
}) {
  const currentPlayer = viewerSeat === 'kim' ? 'kim' : viewerSeat === 'jay' ? 'jay' : seat === 'kim' ? 'kim' : 'jay';
  const roundType = currentRound?.roundType || 'numeric';
  const choiceOptions = inferChoiceOptions(currentRound);
  const otherPlayer = currentPlayer === 'jay' ? 'kim' : 'jay';
  const currentPlayerAnswer = currentRound?.answers?.[currentPlayer] || {};
  const currentPlayerGuessForOther = currentPlayerAnswer?.guessedOther || '';
  const otherPlayerAnswer = currentRound?.answers?.[otherPlayer]?.ownAnswer || '';
  const otherPlayerGuessForCurrent = currentRound?.answers?.[otherPlayer]?.guessedOther || '';
  const answerLabel = gameSeatDisplayName(game, currentPlayer, currentRound);
  const oppositeLabel = gameSeatDisplayName(game, otherPlayer, currentRound);
  const promptLabel = roundType === 'numeric' ? 'Number' : roundType === 'multipleChoice' || roundType === 'trueFalse' || roundType === 'preference' ? 'Choice' : 'Answer';
  const options = choiceOptions.length ? choiceOptions : ['Option A', 'Option B'];
  const isChoiceRound = roundType === 'multipleChoice' || roundType === 'trueFalse' || roundType === 'preference';
  const isListRound = roundType === 'ranked' || roundType === 'sortIntoOrder';
  const listCount = roundType === 'ranked' ? 3 : Math.max(3, Math.min(5, options.length || 4));
  const hasSubmittedAnswer = submissionState === 'submitted' || Boolean(normalizeText(currentPlayerAnswer?.ownAnswer || ''));
  const [isEditingSubmittedAnswer, setIsEditingSubmittedAnswer] = useState(false);
  const isLocked = isBusy || (hasSubmittedAnswer && !isEditingSubmittedAnswer);

  useEffect(() => {
    setIsEditingSubmittedAnswer(false);
  }, [currentRound?.id, submissionState]);

  const handleAnswerAction = async () => {
    if (hasSubmittedAnswer && !isEditingSubmittedAnswer) {
      setIsEditingSubmittedAnswer(true);
      return;
    }
    const result = await onSubmitAnswer();
    if (result !== null) setIsEditingSubmittedAnswer(false);
  };

  const primaryButtonLabel = hasSubmittedAnswer
    ? (isEditingSubmittedAnswer ? 'Save Changes' : 'Edit Answer')
    : 'Submit Round';

  const renderField = (value, setter, placeholder) => {
    if (roundType === 'numeric') {
      return <input type="number" inputMode="decimal" step="any" value={value} onChange={(event) => setter(event.target.value)} placeholder={placeholder} disabled={isLocked} />;
    }

    if (isChoiceRound) {
      return (
        <div className={`choice-grid ${embedded ? 'choice-grid--embedded' : ''}`} role="list">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={`choice-button ${value === option ? 'is-on' : ''}`}
              onClick={() => setter(option)}
              disabled={isLocked}
            >
              {option}
            </button>
          ))}
        </div>
      );
    }

    if (isListRound) {
      const labels =
        roundType === 'ranked'
          ? ['#1', '#2', '#3']
          : Array.from({ length: listCount }, (_, index) => `Step ${index + 1}`);
      const values = decodeRankedAnswer(value, listCount);
      return (
        <div className={`ranked-input-grid ${embedded ? 'ranked-input-grid--embedded' : ''}`}>
          {values.map((entry, index) => (
            <label className="field ranked-field" key={`${placeholder}-${labels[index]}`}>
              <span>{labels[index]}</span>
              <input
                value={entry}
                onChange={(event) => {
                  const next = [...values];
                  next[index] = event.target.value;
                  setter(encodeRankedAnswer(next));
                }}
                placeholder={roundType === 'ranked' ? `Rank ${index + 1}` : `Position ${index + 1}`}
                disabled={isLocked}
              />
            </label>
          ))}
        </div>
      );
    }

    return <input value={value} onChange={(event) => setter(event.target.value)} placeholder={placeholder} disabled={isLocked} />;
  };

  const content = (
    <>
      <div className={`live-round-grid ${embedded ? 'live-round-grid--embedded' : ''}`}>
        <section className={`answer-section ${embedded ? 'answer-section--embedded' : ''}`}>
          <div className="mini-heading">
            <div>
              <span>Your Answer</span>
              <h3>{answerLabel}</h3>
            </div>
          </div>
          <label className="field">
            <span>My Answer</span>
            {renderField(answerDraft.ownAnswer, (value) => setAnswerDraft({ ...answerDraft, ownAnswer: value }), `Your ${promptLabel.toLowerCase()}`)}
          </label>
          {normalizeText(otherPlayerGuessForCurrent) ? (
            <small className="field-note">Latest guess from {oppositeLabel}: {formatRoundAnswerValue(otherPlayerGuessForCurrent, roundType)}</small>
          ) : null}
        </section>
        <section className={`answer-section ${embedded ? 'answer-section--embedded' : ''}`}>
          <div className="mini-heading">
            <div>
              <span>Their Answer</span>
              <h3>What I think {oppositeLabel} will say</h3>
            </div>
          </div>
          <label className="field">
            <span>Their Answer</span>
            {renderField(answerDraft.guessedOther, (value) => setAnswerDraft({ ...answerDraft, guessedOther: value }), `Guess ${oppositeLabel}'s ${promptLabel.toLowerCase()}`)}
          </label>
          {normalizeText(otherPlayerAnswer) || normalizeText(currentPlayerGuessForOther) ? (
            <small className="field-note">
              Saved: Your guess {formatRoundAnswerValue(currentPlayerGuessForOther, roundType)} · Their answer {formatRoundAnswerValue(otherPlayerAnswer, roundType)}
            </small>
          ) : null}
        </section>
      </div>

      <div className={`button-row live-round-actions ${embedded ? 'live-round-actions--embedded' : ''}`}>
        <Button className={`primary-button compact next-question-button ${hasSubmittedAnswer && !isEditingSubmittedAnswer ? 'next-question-button--edit' : ''}`} onClick={handleAnswerAction} disabled={isBusy}>
          {hasSubmittedAnswer && !isEditingSubmittedAnswer ? (
            <span className="button-label-with-icon">
              <span className="button-label-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
                  <path d="M4 17.3V20h2.7l9.9-9.9-2.7-2.7L4 17.3Zm11.7-11.6 2.7 2.7 1.3-1.3a1 1 0 0 0 0-1.4l-1.3-1.3a1 1 0 0 0-1.4 0l-1.3 1.3Z" fill="currentColor" />
                </svg>
              </span>
              Edit Answer
            </span>
          ) : primaryButtonLabel}
        </Button>
        <span className="quick-desk-status">
          {hasSubmittedAnswer
            ? (isEditingSubmittedAnswer ? 'Editing your saved answer' : 'Waiting for reveal')
            : `Play as ${answerLabel}`}
        </span>
      </div>
    </>
  );

  if (embedded) {
    return <div className="room-answer-entry">{content}</div>;
  }

  return <section className="panel live-round-panel">{content}</section>;
}

function AnswerDesk(props) {
  return <QuestionAnswerEntry {...props} />;
}

function SeatFlag({ seat }) {
  if (seat === 'jay') {
    return (
      <span className="room-seat-flag room-seat-flag--jay" role="img" aria-label="England flag">
        <svg viewBox="0 0 36 24" aria-hidden="true">
          <rect width="36" height="24" rx="4" fill="#ffffff" />
          <rect x="15" width="6" height="24" fill="#d61f26" />
          <rect y="9" width="36" height="6" fill="#d61f26" />
        </svg>
      </span>
    );
  }

  return (
    <span className="room-seat-flag room-seat-flag--kim" role="img" aria-label="USA flag">
      <svg viewBox="0 0 36 24" aria-hidden="true">
        <rect width="36" height="24" rx="4" fill="#ffffff" />
        <rect y="0" width="36" height="3" fill="#b22234" />
        <rect y="3" width="36" height="3" fill="#ffffff" />
        <rect y="6" width="36" height="3" fill="#b22234" />
        <rect y="9" width="36" height="3" fill="#ffffff" />
        <rect y="12" width="36" height="3" fill="#b22234" />
        <rect y="15" width="36" height="3" fill="#ffffff" />
        <rect y="18" width="36" height="3" fill="#b22234" />
        <rect x="0" y="0" width="14" height="12" fill="#3c3b6e" />
      </svg>
    </span>
  );
}

function RoomRevealPlayerCard({ game, viewerSeat, seat, currentRound, totalPenalty, roundPenalty }) {
  const playerSeat = seat === 'kim' ? 'kim' : 'jay';
  const oppositeSeat = playerSeat === 'jay' ? 'kim' : 'jay';
  const playerLabel = gameSeatDisplayName(game, playerSeat, currentRound);
  const oppositeLabel = gameSeatDisplayName(game, oppositeSeat, currentRound);
  const actualAnswerRaw = currentRound?.answers?.[playerSeat]?.ownAnswer || '';
  const guessedAnswerRaw = currentRound?.answers?.[oppositeSeat]?.guessedOther || '';
  const actualAnswer = formatRoundAnswerValue(actualAnswerRaw, currentRound?.roundType);
  const guessedAnswer = formatRoundAnswerValue(guessedAnswerRaw, currentRound?.roundType);
  const comparison = getRevealComparison({
    roundType: currentRound?.roundType,
    actualAnswer: actualAnswerRaw,
    guessedAnswer: guessedAnswerRaw,
  });

  return (
    <article className={`room-reveal-player-card room-reveal-player-card--${playerSeat}`}>
      <div className="room-reveal-player-head">
        <SeatFlag seat={playerSeat} />
        <div>
          <span>{playerSeat === viewerSeat ? 'You' : 'Other player'}</span>
          <h3>{playerLabel}</h3>
        </div>
      </div>

      <div className="room-reveal-player-body">
        <div className="room-reveal-answer-block">
          <span>Actual answer</span>
          <div className="room-reveal-answer-copy">
            <strong>{actualAnswer}</strong>
          </div>
        </div>

        <div className="room-reveal-answer-block room-reveal-answer-block--guess">
          <span>{oppositeLabel} guessed</span>
          <div className="room-reveal-answer-copy">
            <strong>{guessedAnswer}</strong>
          </div>
          <small className={`room-reveal-match room-reveal-match--${comparison.tone}`}>{comparison.label}</small>
        </div>
      </div>

      <div className="room-reveal-score-strip">
        <div>
          <span>Total penalty</span>
          <strong>{formatScore(totalPenalty || 0)}</strong>
        </div>
        <div>
          <span>Round penalty</span>
          <strong>{formatScore(roundPenalty || 0)}</strong>
        </div>
      </div>
    </article>
  );
}

function RoomActiveFrame({
  game,
  seat,
  viewerSeat,
  role,
  status,
  currentRound,
  baseTotals,
  liveTotals,
  answerDraft,
  setAnswerDraft,
  onSubmitAnswer,
  submissionState,
  revealIsReady,
  penaltyDraft,
  setPenaltyDraft,
  onNextQuestion,
  onPauseToggle,
  onOpenQuestionNote,
  isBusy,
}) {
  const question = currentRound?.question || 'Question loaded';
  const questionDensity = getQuestionDensityClass(question);
  const stage = revealIsReady ? 'reveal' : 'answering';
  const currentPlayer = viewerSeat === 'kim' ? 'kim' : viewerSeat === 'jay' ? 'jay' : seat === 'kim' ? 'kim' : 'jay';
  const otherPlayer = oppositeSeatOf(currentPlayer);
  const roundTypeLabel = ROUND_TYPE_LABEL[currentRound?.roundType] || currentRound?.roundType || 'Question';
  const penaltyPreview = useMemo(
    () => ({
      jay: parseNumber(penaltyDraft?.jay, 0),
      kim: parseNumber(penaltyDraft?.kim, 0),
    }),
    [penaltyDraft?.jay, penaltyDraft?.kim],
  );
  const previewRoundResult = useMemo(() => {
    if (!revealIsReady || !currentRound) return null;
    return createRoundResult(
      {
        ...currentRound,
        penaltyAdded: penaltyPreview,
        scores: penaltyPreview,
        actualAnswers: {
          jay: currentRound.answers?.jay?.ownAnswer || '',
          kim: currentRound.answers?.kim?.ownAnswer || '',
        },
        guessedAnswers: {
          jay: currentRound.answers?.jay?.guessedOther || '',
          kim: currentRound.answers?.kim?.guessedOther || '',
        },
        actualList: {
          jay: parseAnswerList(currentRound.answers?.jay?.ownAnswer || ''),
          kim: parseAnswerList(currentRound.answers?.kim?.ownAnswer || ''),
        },
        guessedList: {
          jay: parseAnswerList(currentRound.answers?.jay?.guessedOther || ''),
          kim: parseAnswerList(currentRound.answers?.kim?.guessedOther || ''),
        },
      },
      currentRound.number || 1,
      baseTotals,
    );
  }, [baseTotals, currentRound, penaltyPreview, revealIsReady]);
  const roundWinner = previewRoundResult?.winner || 'tie';
  const overallLeader = previewRoundResult?.overallLeader || 'tie';
  const viewerLabel = gameSeatDisplayName(game, currentPlayer, currentRound);
  const oppositeLabel = gameSeatDisplayName(game, otherPlayer, currentRound);
  const hostLabel = gameSeatDisplayName(game, seatForUid(game, game?.hostUid) || currentPlayer, currentRound);
  const stageStatusLabel = revealIsReady
    ? 'Results'
    : submissionState === 'submitted'
      ? 'Waiting'
      : 'Answering';

  return (
    <section className={`room-active-frame room-active-frame--${stage}`} aria-label="Active round scoreboard">
      <div className="scoreboard-sheen" aria-hidden="true" />
      <div className={`room-active-stage room-active-stage--${stage}`}>
        <header className="room-active-header">
          <div>
            <span className="scoreboard-kicker">{revealIsReady ? 'Round Reveal' : 'Live Question'}</span>
            <h2>Round {currentRound?.number || 1}</h2>
          </div>
          <div className="room-active-pills">
            <span className="scoreboard-mini-badge">{stageStatusLabel}</span>
            {currentRound?.category ? <span className="scoreboard-mini-badge is-category">{currentRound.category}</span> : null}
            <span className="scoreboard-mini-badge">{roundTypeLabel}</span>
          </div>
        </header>

        {!revealIsReady ? (
          <div className="room-active-answer-stack">
            <div className={`room-active-question room-active-question--answering ${questionDensity}`}>
              <p>{question}</p>
              <div className="question-note-actions">
                <button type="button" className="ghost-button compact" onClick={() => onOpenQuestionNote?.(currentRound)} disabled={isBusy} aria-label="Flag question for private note">🚩</button>
                <button type="button" className="ghost-button compact" onClick={() => onOpenQuestionNote?.(currentRound)} disabled={isBusy} aria-label="Open private question notebook">📓</button>
              </div>
            </div>

            <QuestionAnswerEntry
              game={game}
              embedded
              seat={currentPlayer}
              viewerSeat={currentPlayer}
              currentRound={currentRound}
              answerDraft={answerDraft}
              setAnswerDraft={setAnswerDraft}
              onSubmitAnswer={onSubmitAnswer}
              submissionState={submissionState}
              isBusy={isBusy}
            />
          </div>
        ) : (
          <div className="room-active-reveal-stack">
            <div className={`room-active-question room-active-question--reveal ${questionDensity}`}>
              <p>{question}</p>
              <div className="question-note-actions">
                <button type="button" className="ghost-button compact" onClick={() => onOpenQuestionNote?.(currentRound)} disabled={isBusy} aria-label="Flag question for private note">🚩</button>
                <button type="button" className="ghost-button compact" onClick={() => onOpenQuestionNote?.(currentRound)} disabled={isBusy} aria-label="Open private question notebook">📓</button>
              </div>
            </div>

            <div className="room-reveal-layout">
              <RoomRevealPlayerCard game={game} viewerSeat={currentPlayer} seat={currentPlayer} currentRound={currentRound} totalPenalty={liveTotals?.[currentPlayer] ?? baseTotals?.[currentPlayer] ?? 0} roundPenalty={penaltyPreview[currentPlayer]} />

              <section className="room-reveal-center-card" aria-label="Round result">
                <span>Round Result</span>
                <strong>{roundWinner === 'tie' ? 'Tie round' : `${gameSeatDisplayName(game, roundWinner, currentRound)} ahead`}</strong>
                <p>
                  {viewerLabel} +{formatScore(penaltyPreview[currentPlayer])} · {oppositeLabel} +{formatScore(penaltyPreview[otherPlayer])}
                </p>
                <small>
                  {overallLeader === 'tie'
                    ? 'Totals level after this round'
                    : `Lowest total after this round: ${gameSeatDisplayName(game, overallLeader, currentRound)}`}
                </small>
                <small>
                  Totals {viewerLabel} {formatScore(previewRoundResult?.totalsAfterRound?.[currentPlayer] ?? liveTotals?.[currentPlayer] ?? baseTotals?.[currentPlayer] ?? 0)}
                  {' · '}
                  {oppositeLabel} {formatScore(previewRoundResult?.totalsAfterRound?.[otherPlayer] ?? liveTotals?.[otherPlayer] ?? baseTotals?.[otherPlayer] ?? 0)}
                </small>
              </section>

              <RoomRevealPlayerCard game={game} viewerSeat={currentPlayer} seat={otherPlayer} currentRound={currentRound} totalPenalty={liveTotals?.[otherPlayer] ?? baseTotals?.[otherPlayer] ?? 0} roundPenalty={penaltyPreview[otherPlayer]} />
            </div>

            {role !== 'host' ? (
              <div className="room-reveal-footer">
                <div className="room-reveal-waiting">
                  <span className="quick-desk-status">Waiting for {hostLabel} to load the next question</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function RevealCards({ currentRound }) {
  if (!currentRound?.answers) return null;
  const cards = seats.map((seat) => {
    const answer = currentRound.answers?.[seat];
    if (!answer) return null;
    return (
      <article className="reveal-card" key={seat}>
        <div className="reveal-card-head">
          <strong>{seat === 'jay' ? 'Jay' : 'Kim'}</strong>
          <span>{answer.displayName || '-'}</span>
        </div>
        <p>
          <span>My answer:</span> {answer.ownAnswer || '-'}
        </p>
        <p>
          <span>I guessed:</span> {answer.guessedOther || '-'}
        </p>
      </article>
    );
  });

  return <div className="reveal-grid">{cards}</div>;
}

function RevealPopup({ currentRound }) {
  if (!currentRound?.answers?.jay || !currentRound?.answers?.kim) return null;

  return (
    <section className="panel reveal-popup" aria-live="polite" aria-label="Round reveal">
      <div className="reveal-popup-head">
        <div>
          <p className="eyebrow">Reveal</p>
          <h2>Both answers are in</h2>
        </div>
        <span className="status-pill">Live</span>
      </div>
      <RevealCards currentRound={currentRound} />
    </section>
  );
}

function ChatPanel({ messages, draft, onDraftChange, onSend, isBusy, seat, displayName, compact = false }) {
  const chatLogRef = useRef(null);
  const chatScrollStateRef = useRef({
    scrollTop: 0,
    nearBottom: true,
    lastMessageId: '',
  });

  const syncChatScrollState = (node, lastMessageId = chatScrollStateRef.current.lastMessageId) => {
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    chatScrollStateRef.current = {
      scrollTop: node.scrollTop,
      nearBottom: maxScrollTop - node.scrollTop <= 28,
      lastMessageId,
    };
  };

  useLayoutEffect(() => {
    const chatLog = chatLogRef.current;
    if (!chatLog) return;
    const lastMessageId = messages.at(-1)?.id || '';
    const previousState = chatScrollStateRef.current;
    const messageAdded = Boolean(lastMessageId) && lastMessageId !== previousState.lastMessageId;

    if (messageAdded && previousState.nearBottom) {
      chatLog.scrollTop = chatLog.scrollHeight;
    } else {
      const maxScrollTop = Math.max(0, chatLog.scrollHeight - chatLog.clientHeight);
      chatLog.scrollTop = Math.min(previousState.scrollTop, maxScrollTop);
    }

    syncChatScrollState(chatLog, lastMessageId);
  }, [messages]);

  useEffect(() => {
    const chatLog = chatLogRef.current;
    if (!chatLog || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      const previousState = chatScrollStateRef.current;
      const maxScrollTop = Math.max(0, chatLog.scrollHeight - chatLog.clientHeight);
      chatLog.scrollTop = previousState.nearBottom
        ? chatLog.scrollHeight
        : Math.min(previousState.scrollTop, maxScrollTop);
      syncChatScrollState(chatLog);
    });

    observer.observe(chatLog);
    return () => observer.disconnect();
  }, []);

  const content = (
    <>
      {!compact ? (
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Room Chat</p>
            <h2>Both Players</h2>
          </div>
          <span className="status-pill">{seat === 'jay' ? 'Host chat' : 'Player chat'}</span>
        </div>
      ) : null}

      <div
        className="chat-log"
        ref={chatLogRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(event) => syncChatScrollState(event.currentTarget)}
      >
        {messages.length ? (
          messages.map((message) => (
            <article className={`chat-message ${message.seat || 'neutral'}`} key={message.id}>
              <div className="chat-message-head">
                <strong>{message.displayName || 'Player'}</strong>
                <time dateTime={message.createdAt || undefined}>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</time>
              </div>
              <p>{message.text}</p>
            </article>
          ))
          ) : (
            <p className="empty-copy">No chat yet. Send a message to the other player here.</p>
          )}
      </div>

      <div className="chat-compose">
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={`Message as ${displayName || 'player'}`}
          maxLength={240}
          rows={2}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            if (!isBusy && draft.trim()) onSend();
          }}
        />
        <Button className="primary-button compact" onClick={onSend} disabled={isBusy || !draft.trim()}>
          Send
        </Button>
      </div>
    </>
  );

  if (compact) {
    return <div className="chat-panel compact-chat">{content}</div>;
  }

  return <section className="panel chat-panel">{content}</section>;
}

function GameSummaryContent({
  gameSummary,
  categoryColorMap,
  onBackToLobby,
  onViewOverallAnalytics,
  showActions = false,
  modalLayout = false,
  onClose = null,
}) {
  const summaryRounds = useMemo(() => normalizeStoredRounds(gameSummary?.rounds || []), [gameSummary?.rounds]);
  const summaryAnalytics = useMemo(() => calculateAnalytics(summaryRounds), [summaryRounds]);
  const finalScores = gameSummary?.finalScores || gameSummary?.totals || summaryAnalytics.totals || { jay: 0, kim: 0 };
  const summaryScrollRef = useRef(null);
  const summaryScrollKey = [
    gameSummary?.id,
    gameSummary?.code,
    gameSummary?.joinCode,
    gameSummary?.endedAt,
    gameSummary?.updatedAt,
  ].filter(Boolean).join(':');
  const winner =
    gameSummary?.winner ||
    (Number(finalScores.jay || 0) === Number(finalScores.kim || 0)
      ? 'tie'
      : Number(finalScores.jay || 0) < Number(finalScores.kim || 0)
        ? 'jay'
        : 'kim');
  const gameLabel = gameSummary?.gameName || gameSummary?.name || gameSummary?.joinCode || 'Game summary';
  const completedLabel = formatShortDateTime(gameSummary?.endedAt || gameSummary?.updatedAt || gameSummary?.createdAt);

  useEffect(() => {
    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      summaryScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };

    resetScroll();
    const frame = window.requestAnimationFrame(resetScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [summaryScrollKey]);

  return (
    <section className={`game-summary-shell ${modalLayout ? 'game-summary-shell--modal' : ''}`}>
      <header className="game-summary-header">
        <div className="game-summary-header-copy">
          <p className="eyebrow">{modalLayout ? 'Previous Game' : 'Game Summary'}</p>
          <h2>{gameLabel}</h2>
          <div className="game-summary-meta">
            <span className="game-summary-meta-pill">Completed {completedLabel}</span>
            <span className="game-summary-meta-pill">{summaryRounds.length} {summaryRounds.length === 1 ? 'round' : 'rounds'} played</span>
            <span className="game-summary-meta-pill">{winner === 'tie' ? 'Tied game' : `${PLAYER_LABEL[winner] || winner} won`}</span>
          </div>
        </div>
        <div className="game-summary-header-actions">
          <span className="status-pill">{winner === 'tie' ? 'Tied' : `${PLAYER_LABEL[winner] || winner} won`}</span>
          {onClose ? (
            <Button className="ghost-button compact" onClick={onClose}>
              Close
            </Button>
          ) : null}
        </div>
      </header>

      <div ref={summaryScrollRef} className={`game-summary-scroll ${modalLayout ? 'game-summary-scroll--modal' : ''}`}>
        <div className={`game-summary-layout ${modalLayout ? 'game-summary-layout--modal' : ''}`}>
          <div className="game-summary-main-column">
            <section className="game-summary-section">
              <div className="mini-heading">
                <div>
                  <span>Final Result</span>
                  <h3>Match Summary</h3>
                </div>
              </div>

              <div className="summary-scoreboard">
                <div className="stat-tile"><small>Winner</small><strong>{winner === 'tie' ? 'Tie' : PLAYER_LABEL[winner] || winner}</strong></div>
                <div className="stat-tile"><small>Questions</small><strong>{summaryRounds.length}</strong></div>
                <div className="stat-tile"><small>Jay Final</small><strong>{formatScore(finalScores.jay || 0)}</strong></div>
                <div className="stat-tile"><small>Kim Final</small><strong>{formatScore(finalScores.kim || 0)}</strong></div>
              </div>

              {showActions ? (
                <div className="button-row game-summary-actions">
                  <Button className="ghost-button compact" onClick={onBackToLobby}>
                    Back to Game Lobby
                  </Button>
                  <Button className="primary-button compact" onClick={onViewOverallAnalytics}>
                    View Overall Analytics
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="game-summary-section">
              <div className="mini-heading">
                <div>
                  <span>Round History</span>
                  <h3>Every Question</h3>
                </div>
              </div>
              <div className="summary-list">
                {summaryRounds.length ? (
                  summaryRounds.map((round, index) => (
                    <article className="mini-list-row" key={round.id || `${round.questionId || 'round'}-${index + 1}`}>
                      <strong>Round {index + 1}</strong>
                      <span>{round.question}</span>
                      <small>
                        Jay {formatScore(round.penaltyAdded?.jay || 0)} · Kim {formatScore(round.penaltyAdded?.kim || 0)} · Winner {round.winner || 'tie'}
                      </small>
                      <small>
                        Jay answered {round.actualAnswers?.jay || '-'} / guessed {round.guessedAnswers?.jay || '-'}
                      </small>
                      <small>
                        Kim answered {round.actualAnswers?.kim || '-'} / guessed {round.guessedAnswers?.kim || '-'}
                      </small>
                    </article>
                  ))
                ) : (
                  <p className="empty-copy">No rounds were archived for this game.</p>
                )}
              </div>
            </section>

            <section className="game-summary-section">
              <div className="mini-heading">
                <div>
                  <span>Category Breakdown</span>
                  <h3>How The Game Broke Down</h3>
                </div>
              </div>
              <div className="summary-list">
                {summaryAnalytics.categoryRows?.length ? (
                  summaryAnalytics.categoryRows.map((row) => (
                    <article className="mini-list-row" key={row.category}>
                      <strong>{row.category}</strong>
                      <span>Rounds {row.rounds}</span>
                      <small>Jay {formatScore(row.totals.jay)} · Kim {formatScore(row.totals.kim)} · Winner {row.winner}</small>
                    </article>
                  ))
                ) : (
                  <p className="empty-copy">No category breakdown is available for this game yet.</p>
                )}
              </div>
            </section>
          </div>

          <aside className="game-summary-analytics-column">
            <section className="game-summary-section game-summary-section--analytics">
              <div className="mini-heading">
                <div>
                  <span>Analytics Dashboard</span>
                  <h3>Post-Game Analytics</h3>
                </div>
              </div>
              <AnalyticsPanel analytics={summaryAnalytics} categoryColorMap={categoryColorMap} variant="summary" summary={gameSummary} />
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function ConfirmModal({ action, onConfirm, onCancel }) {
  if (!action) return null;
  const handleConfirmClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    console.log('END GAME CONFIRM CLICKED');
    console.info('[KJK ROOM] Confirm modal button clicked', {
      type: action?.type || '',
      gameId: action?.gameId || '',
      label: action?.confirmLabel || action?.label || 'Confirm',
    });
    onConfirm?.(action);
  };

  return (
    <section className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="panel modal-panel confirm-modal" role="dialog" aria-modal="true" aria-label={action.title || action.label || 'Confirm action'} onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Confirm</p>
            <h2>{action.title || action.label || 'Confirm action'}</h2>
          </div>
        </div>
        <p className="panel-copy">
          {action.body || (action.type === 'delete'
            ? 'This will permanently delete the game, rounds, and chat history. This cannot be undone.'
            : 'This will archive the game into Previous Games and stop the room for both players.')}
        </p>
        <div className="button-row">
          <Button className="ghost-button compact" onClick={onCancel}>
            {action.cancelLabel || 'Cancel'}
          </Button>
          <Button className="primary-button compact" onClick={handleConfirmClick}>
            {action.confirmLabel || 'Confirm'}
          </Button>
        </div>
      </div>
    </section>
  );
}

function QuestionBankMini({ questions, draft, setDraft, onAddQuestion, onSyncSheet, onImportSheet, syncNotice }) {
  return (
    <section className="panel bank-mini-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Question Bank</p>
          <h2>Host Tools</h2>
        </div>
        <span className="status-pill">{questions.length}</span>
      </div>

      <div className="auth-form-grid">
        <label className="field">
          <span>Question</span>
          <input value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} placeholder="Type a question" />
        </label>
        <label className="field">
          <span>Category</span>
          <input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="Food & Drink" />
        </label>
        <label className="field">
          <span>Round type</span>
          <select value={draft.roundType} onChange={(event) => setDraft({ ...draft, roundType: event.target.value })}>
            {['numeric', 'multipleChoice', 'trueFalse', 'text', 'sortIntoOrder', 'preference', 'favourite', 'petPeeve', 'ranked', 'manual'].map((type) => (
              <option key={type} value={type}>
                {ROUND_TYPE_LABEL[type] || type}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tags</span>
          <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="tag1, tag2" />
        </label>
      </div>

      <div className="button-row">
        <Button className="primary-button compact" onClick={onAddQuestion}>
          Add Question
        </Button>
      </div>

      <div className="sheet-sync-card question-bank-sync-card">
        <div>
          <p className="eyebrow">Question Bank</p>
          <h3>{questions.length} questions loaded</h3>
        </div>
        <p className="sheet-sync-copy">Google Sheet connected. Use sync to refresh existing rows or import to add new questions only.</p>
        <div className="sheet-sync-actions">
          <Button className="ghost-button compact" onClick={onSyncSheet}>
            Sync Question Bank
          </Button>
          <Button className="primary-button compact" onClick={onImportSheet}>
            Import New Questions
          </Button>
        </div>
      </div>

      {syncNotice ? <p className="panel-copy">{syncNotice}</p> : null}

      <div className="mini-list">
        {questions.slice(0, 5).map((question) => (
          <article className="mini-list-row" key={question.id}>
            <strong>{question.question}</strong>
            <span>{question.category || 'Uncategorised'}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function PendingRedemptionsPanel({ items, onMarkSeen, onMarkCompleted, isBusy, sectionId }) {
  if (!items.length) return null;

  return (
    <section className="panel lobby-panel lobby-pending-card lobby-panel--pending" id={sectionId}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Pending Redemptions</p>
          <h2>You need to complete these</h2>
        </div>
        <span className="status-pill">{items.length}</span>
      </div>

      <div className="mini-list">
        {items.map((entry) => {
          const redeemerSeat = entry.redeemedByPlayerId === fixedPlayerUids.kim ? 'kim' : 'jay';
          const statusLabel = entry.status === 'completed' ? 'Completed' : entry.notificationSeen ? 'Seen' : 'Redeemed';
          return (
            <article className="mini-list-row pending-redemption-row" key={entry.id}>
              <strong>{entry.itemTitle || 'Forfeit'}</strong>
              <span>
                {PLAYER_LABEL[redeemerSeat] || redeemerSeat} redeemed this for {formatScore(Number(entry.itemCost || 0))}
              </span>
              <small>
                {statusLabel} · {formatShortDateTime(entry.redeemedAt)} · You need to complete this.
              </small>
              <div className="button-row">
                {!entry.notificationSeen ? (
                  <Button className="ghost-button compact" onClick={() => onMarkSeen(entry.id)} disabled={isBusy}>
                    Mark Seen
                  </Button>
                ) : null}
                {entry.status !== 'completed' ? (
                  <Button className="primary-button compact" onClick={() => onMarkCompleted(entry.id)} disabled={isBusy}>
                    Mark Completed
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function GameInvitesPanel({ invites = [], onJoinInvite, onDismissInvite, isBusy, compact = false }) {
  if (!invites.length) return null;
  const visibleInvites = invites.slice(0, compact ? 3 : 8);
  const content = (
    <div className="mini-list">
      {visibleInvites.map((invite) => {
        const questionCount = Number(invite.actualQuestionCount || invite.requestedQuestionCount || 0);
        const roomCode = invite.roomCode || invite.joinCode || '';
        const inviteStatus = invite.displayStatus || invite.status || 'pending';
        return (
          <article className={`mini-list-row game-invite-row game-invite-row--${inviteStatus}`} key={invite.id}>
            <strong>{invite.gameName || roomCode || 'Game invite'}</strong>
            <span>{invite.invitedByDisplayName || 'Player'} invited you to join this game.</span>
            <small>
              {roomCode ? `Code ${roomCode}` : 'Private session'}
              {invite.gameId ? ` · Session ${String(invite.gameId).slice(-6).toUpperCase()}` : ''}
              {questionCount ? ` · ${questionCount} questions` : ''}
              {' · '}
              {formatShortDateTime(invite.createdAt)}
            </small>
            {inviteStatus === 'expired' ? (
              <small>This invite is no longer active because the game ended or became unavailable.</small>
            ) : null}
            <div className="button-row">
              {inviteStatus === 'pending' ? (
                <Button className="primary-button compact" onClick={() => onJoinInvite(invite)} disabled={isBusy}>
                  Join
                </Button>
              ) : (
                <>
                  <Button className="ghost-button compact" disabled>
                    Unavailable
                  </Button>
                  <Button className="ghost-button compact" onClick={() => onDismissInvite(invite)} disabled={isBusy || !onDismissInvite}>
                    Dismiss
                  </Button>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );

  if (compact) {
    return (
      <section className="join-invite-panel">
        <div className="mini-heading">
          <div>
            <span>Game Requests</span>
            <h3>Pending invites</h3>
          </div>
        </div>
        {content}
      </section>
    );
  }

  return (
    <section className="panel lobby-panel lobby-panel--pending game-invites-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Game Requests</p>
          <h2>Invites waiting for you</h2>
        </div>
        <span className="status-pill">{invites.filter((invite) => (invite.displayStatus || invite.status || 'pending') === 'pending').length}</span>
      </div>
      {content}
    </section>
  );
}

function PendingGameTasksPanel({ activeGames, currentUserId, onResumeGame }) {
  const pendingGames = activeGames.filter((game) => {
    const seat = game?.seats?.jay === currentUserId ? 'jay' : game?.seats?.kim === currentUserId ? 'kim' : null;
    const openAnswers = new Set(game?.currentRoundAnswerSeats || []);
    return Boolean(seat) && game?.currentRoundStatus === 'open' && !openAnswers.has(seat);
  });

  return (
    <section className="panel lobby-panel lobby-panel--active pending-game-tasks-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Game Tasks</p>
          <h2>Answer now</h2>
        </div>
        <span className="status-pill">{pendingGames.length}</span>
      </div>

      {pendingGames.length ? (
        <div className="mini-list">
          {pendingGames.map((game) => {
            const seat = game?.seats?.jay === currentUserId ? 'jay' : 'kim';
            return (
              <article className="mini-list-row pending-game-row" key={game.id}>
                <strong>{game.name || game.joinCode}</strong>
                <span>
                  {game.currentRoundQuestion || 'A live round is waiting'}
                </span>
                <small>
                  Round {game.currentRound || '—'} · {game.currentRoundCategory || 'Uncategorised'} · {game.currentRoundType || 'live'}
                </small>
                <small>{seat === 'jay' ? 'Jay' : 'Kim'} still needs to submit an answer.</small>
                <div className="button-row">
                  <Button className="primary-button compact" onClick={() => onResumeGame(game.id)}>
                    Open Game
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-copy">No active games need your answer right now.</p>
      )}
    </section>
  );
}

function ForfeitAlertsPanel({
  requestAlerts,
  responseAlerts,
  onMarkRequestSeen,
  onMarkResponseSeen,
  onRespondToForfeitRequest,
  onDeleteForfeitRequest,
  onUpdateForfeitRequest,
  isBusy,
}) {
  const [responseDrafts, setResponseDrafts] = useState({});
  const [requestEditDrafts, setRequestEditDrafts] = useState({});
  const [editingRequestIds, setEditingRequestIds] = useState({});
  if (!requestAlerts.length && !responseAlerts.length) return null;

  const updateResponseDraft = (requestId, patch) => {
    setResponseDrafts((current) => ({
      ...current,
      [requestId]: {
        ...defaultForfeitResponseDraft(),
        ...(current[requestId] || {}),
        ...patch,
      },
    }));
  };

  const submitResponse = async (request, action) => {
    const draft = responseDrafts[request.id] || defaultForfeitResponseDraft();
    await onRespondToForfeitRequest(request, {
      action,
      price: draft.price,
      message: draft.message,
    });
    setResponseDrafts((current) => ({
      ...current,
      [request.id]: defaultForfeitResponseDraft(),
    }));
  };

  const startEditRequest = (request) => {
    setEditingRequestIds((current) => ({ ...current, [request.id]: true }));
    setRequestEditDrafts((current) => ({
      ...current,
      [request.id]: {
        title: request.forfeitTitle || '',
        description: request.forfeitDescription || '',
      },
    }));
  };

  const saveEditedRequest = async (request) => {
    const draft = requestEditDrafts[request.id] || {};
    await onUpdateForfeitRequest?.(request.id, {
      title: draft.title,
      description: draft.description,
    });
    setEditingRequestIds((current) => {
      const next = { ...current };
      delete next[request.id];
      return next;
    });
  };

  return (
    <section className="panel lobby-panel lobby-alerts-card lobby-panel--pending">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Forfeit Alerts</p>
          <h2>Requests and responses</h2>
        </div>
        <span className="status-pill">{requestAlerts.length + responseAlerts.length}</span>
      </div>

      <div className="alerts-grid">
        <section className="alerts-column">
          <p className="eyebrow">Waiting for you</p>
          <div className="mini-list">
            {requestAlerts.length ? (
              requestAlerts.map((request) => {
                const requesterSeat = request.requestedByUserId === fixedPlayerUids.kim ? 'kim' : 'jay';
                const responseDraft = responseDrafts[request.id] || defaultForfeitResponseDraft();
                return (
                  <article className="mini-list-row forfeit-alert-row" key={request.id}>
                    <strong>{request.forfeitTitle || 'Forfeit request'}</strong>
                    <span>{PLAYER_LABEL[requesterSeat] || requesterSeat} asked you to price this forfeit.</span>
                    <small>{formatShortDateTime(request.requestedAt)}</small>
                    {!request.requestNotificationSeen ? <Button className="ghost-button compact" onClick={() => onMarkRequestSeen(request.id)} disabled={isBusy}>Mark Seen</Button> : null}
                    <div className="request-response-grid">
                      <label className="field">
                        <span>Set price</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={responseDraft.price}
                          onChange={(event) => updateResponseDraft(request.id, { price: event.target.value })}
                          placeholder="50"
                        />
                      </label>
                      <label className="field">
                        <span>Response note</span>
                        <input
                          value={responseDraft.message}
                          onChange={(event) => updateResponseDraft(request.id, { message: event.target.value })}
                          placeholder="Optional note"
                        />
                      </label>
                    </div>
                    <div className="button-row">
                      <Button className="primary-button compact" onClick={() => submitResponse(request, 'price')} disabled={isBusy}>
                        Set Price
                      </Button>
                      <Button className="ghost-button compact" onClick={() => submitResponse(request, 'reject')} disabled={isBusy}>
                        Reject
                      </Button>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="empty-copy">No incoming price requests.</p>
            )}
          </div>
        </section>

        <section className="alerts-column">
          <p className="eyebrow">Responses for you</p>
          <div className="mini-list">
            {responseAlerts.length ? (
              responseAlerts.map((request) => {
                const responderSeat = request.requestedFromUserId === fixedPlayerUids.kim ? 'kim' : 'jay';
                const responseLabel = request.status === 'rejected' ? 'rejected your request' : `priced it at ${formatScore(Number(request.proposedPrice || 0))}`;
                const isEditing = Boolean(editingRequestIds[request.id]);
                const draft = requestEditDrafts[request.id] || { title: request.forfeitTitle || '', description: request.forfeitDescription || '' };
                return (
                  <article className="mini-list-row forfeit-alert-row" key={request.id}>
                    {isEditing ? (
                      <>
                        <label className="field">
                          <span>Forfeit title</span>
                          <input value={draft.title} onChange={(event) => setRequestEditDrafts((current) => ({ ...current, [request.id]: { ...draft, title: event.target.value } }))} />
                        </label>
                        <label className="field">
                          <span>Notes</span>
                          <textarea rows="3" value={draft.description} onChange={(event) => setRequestEditDrafts((current) => ({ ...current, [request.id]: { ...draft, description: event.target.value } }))} />
                        </label>
                        <div className="button-row">
                          <Button className="primary-button compact" onClick={() => saveEditedRequest(request)} disabled={isBusy || !String(draft.title).trim()}>
                            Save
                          </Button>
                          <Button
                            className="ghost-button compact"
                            onClick={() =>
                              setEditingRequestIds((current) => {
                                const next = { ...current };
                                delete next[request.id];
                                return next;
                              })
                            }
                            disabled={isBusy}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <strong>{request.forfeitTitle || 'Forfeit request'}</strong>
                        <span>{PLAYER_LABEL[responderSeat] || responderSeat} {responseLabel}.</span>
                        <small>{formatShortDateTime(request.respondedAt)}</small>
                        <div className="button-row">
                          {!request.responseNotificationSeen ? (
                            <Button className="ghost-button compact" onClick={() => onMarkResponseSeen(request.id)} disabled={isBusy}>
                              Mark Seen
                            </Button>
                          ) : null}
                          <Button className="ghost-button compact" onClick={() => startEditRequest(request)} disabled={isBusy}>
                            Edit
                          </Button>
                          <Button className="ghost-button compact" onClick={() => onDeleteForfeitRequest?.(request.id)} disabled={isBusy}>
                            Delete
                          </Button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })
            ) : (
              <p className="empty-copy">No unseen request responses.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function AmaTasksPanel({ incomingRequests = [], outgoingRequests = [], onMarkRequestSeen, onMarkResponseSeen, onAnswerAmaRequest, roundAnalytics, isBusy }) {
  const [activeRequest, setActiveRequest] = useState(null);
  const [draft, setDraft] = useState({ answer: '', story: '', relatedCategories: [] });
  const [mediaFiles, setMediaFiles] = useState([]);
  const incoming = incomingRequests.filter((request) => request.status !== 'completed');
  const outgoing = outgoingRequests.filter((request) => request.status !== 'completed');
  const themeOptions = useMemo(() => buildDiaryThemeOptions(roundAnalytics), [roundAnalytics]);
  if (!incoming.length && !outgoing.length) return null;

  const openAnswer = (request) => {
    setActiveRequest(request);
    setDraft({
      answer: request.answer || '',
      story: request.story || '',
      relatedCategories: Array.isArray(request.relatedCategories) ? request.relatedCategories.filter(Boolean) : [],
    });
    setMediaFiles([]);
  };

  const closeAnswer = () => {
    setActiveRequest(null);
    setDraft({ answer: '', story: '', relatedCategories: [] });
    setMediaFiles([]);
  };

  const saveAnswer = async () => {
    const analyticsSnapshot = buildDiaryAnalyticsSnapshot(roundAnalytics, draft.relatedCategories || []);
    await onAnswerAmaRequest?.({
      requestId: activeRequest.id,
      answer: draft.answer,
      story: draft.story,
      relatedCategories: draft.relatedCategories || [],
      analyticsSnapshot,
      mediaFiles,
    });
    closeAnswer();
  };

  return (
    <section className="panel lobby-panel lobby-alerts-card lobby-panel--pending">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">AMA</p>
          <h2>Questions and answers</h2>
        </div>
        <span className="status-pill">{incoming.length + outgoing.length}</span>
      </div>
      <div className="alerts-grid">
        <section className="alerts-column">
          <p className="eyebrow">Waiting for you</p>
          <div className="mini-list">
            {incoming.length ? (
              incoming.map((request) => (
                  <article className="mini-list-row forfeit-alert-row" key={request.id}>
                    <strong>{request.itemTitle || 'AMA'}</strong>
                    <span>{request.question || 'A question is waiting.'}</span>
                    <small>{formatShortDateTime(request.updatedAt || request.createdAt)}</small>
                    {!request.requestNotificationSeen ? (
                      <Button className="ghost-button compact" onClick={() => onMarkRequestSeen?.(request.id)} disabled={isBusy}>
                        Mark Seen
                      </Button>
                    ) : null}
                    {request.status === 'questioned' ? (
                    <Button className="primary-button compact" onClick={() => openAnswer(request)} disabled={isBusy}>
                      Answer AMA
                    </Button>
                  ) : null}
                  </article>
                ))
            ) : (
              <p className="empty-copy">No AMA questions waiting for you.</p>
            )}
          </div>
        </section>

        <section className="alerts-column">
          <p className="eyebrow">Sent by me</p>
          <div className="mini-list">
            {outgoing.length ? (
              outgoing.map((request) => (
                <article className="mini-list-row forfeit-alert-row" key={request.id}>
                  <strong>{request.itemTitle || 'AMA'}</strong>
                  <span>Status: {request.status || 'pending'}</span>
                  <small>{request.question || 'Question pending'}</small>
                  {request.answer ? <small>{request.answer}</small> : null}
                  {!request.answerNotificationSeen && request.status === 'answered' ? (
                    <Button className="ghost-button compact" onClick={() => onMarkResponseSeen?.(request.id)} disabled={isBusy}>
                      Mark Seen
                    </Button>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="empty-copy">No AMA requests sent yet.</p>
            )}
          </div>
        </section>
      </div>

      {activeRequest ? (
        <section className="modal-backdrop" role="presentation" onClick={closeAnswer}>
          <div className="panel modal-panel forfeit-modal" role="dialog" aria-modal="true" aria-label="Answer AMA" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">AMA</p>
                <h3>ANSWER AMA</h3>
              </div>
              <span className="status-pill">1000 points</span>
            </div>
            <label className="field">
              <span>Question</span>
              <input value={activeRequest.question || ''} readOnly />
            </label>
            <label className="field">
              <span>Answer</span>
              <textarea rows="3" value={draft.answer} onChange={(event) => setDraft((current) => ({ ...current, answer: event.target.value }))} />
            </label>
            <label className="field">
              <span>Story</span>
              <textarea rows="3" value={draft.story} onChange={(event) => setDraft((current) => ({ ...current, story: event.target.value }))} />
            </label>
            <div className="field">
              <span>Story themes for frozen quiz analytics</span>
              <div className="filter-chip-grid filter-chip-grid--categories diary-theme-grid">
                {themeOptions.map((categoryName) => {
                  const isOn = draft.relatedCategories?.includes(categoryName);
                  return (
                    <button
                      key={categoryName}
                      type="button"
                      className={`filter-chip ${isOn ? 'is-on' : ''}`}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          relatedCategories: current.relatedCategories?.includes(categoryName)
                            ? current.relatedCategories.filter((entry) => entry !== categoryName)
                            : [...(current.relatedCategories || []), categoryName],
                        }))
                      }
                    >
                      {categoryName}
                    </button>
                  );
                })}
              </div>
              <small className="field-note">These category stats will be frozen at the moment you save the chapter.</small>
            </div>
            <label className="field">
              <span>Media</span>
              <input type="file" accept="image/*,video/*" multiple onChange={(event) => setMediaFiles(Array.from(event.target.files || []))} />
            </label>
            <div className="button-row">
              <Button className="primary-button compact" onClick={saveAnswer} disabled={isBusy || !draft.answer.trim()}>
                Save Answer
              </Button>
              <Button className="ghost-button compact" onClick={closeAnswer} disabled={isBusy}>
                Cancel
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function DiaryDashboardSection({
  user,
  profile,
  currentPlayerSeat = '',
  diaryEntries = [],
  roundAnalytics = null,
  onSubmitAmaQuestion,
  onAnswerAmaRequest,
  isBusy = false,
}) {
  const viewerSeat = currentPlayerSeat || inferSeatFromUser(user, profile) || '';
  const [isDiaryOpen, setIsDiaryOpen] = useState(false);
  const [isDiaryOpening, setIsDiaryOpening] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [questionDraft, setQuestionDraft] = useState('');
  const [draft, setDraft] = useState(defaultAmaAnswerDraft());
  const [mediaFiles, setMediaFiles] = useState([]);
  const themeOptions = useMemo(() => buildDiaryThemeOptions(roundAnalytics), [roundAnalytics]);
  const chapters = useMemo(
    () =>
      diaryEntries
        .filter((entry) => isAmaDiaryEntry(entry))
        .sort(sortByOldest)
        .map((entry, index) => {
          const chapterNumber = Number(entry.chapterNumber || index + 1);
          const askedByPlayerId = entry.requestedByPlayerId || entry.requestedByUserId || '';
          const answeredByPlayerId = entry.ownerPlayerId || entry.receiverPlayerId || entry.storeOwnerUserId || '';
          const chapterTitle = normalizeText(entry.question)
            ? buildAmaChapterTitle(entry.question, chapterNumber)
            : normalizeText(entry.chapterTitle) || buildAmaChapterTitle(entry.title || '', chapterNumber);
          const snapshotInsights = Array.isArray(entry.analyticsSnapshot?.categoryInsights) && entry.analyticsSnapshot.categoryInsights.length
            ? entry.analyticsSnapshot.categoryInsights
            : Array.isArray(entry.analyticsSnapshot?.categoryRows)
              ? entry.analyticsSnapshot.categoryRows.map((row) => buildDiarySnapshotInsight(row))
              : [];
          const status = normalizeIdentity(entry.chapterState || entry.status);
          return {
            ...entry,
            chapterNumber,
            chapterTitle,
            askedByPlayerId,
            answeredByPlayerId,
            askedByLabel: playerLabelForRef(askedByPlayerId),
            answeredByLabel: playerLabelForRef(answeredByPlayerId),
            createdLabel: formatShortDateTime(entry.createdAt || entry.redeemedAt || entry.updatedAt),
            answeredLabel: formatShortDateTime(entry.answeredAt || entry.respondedAt || (status === 'answered' ? entry.updatedAt : null)),
            statusLabel: status === 'answered'
              ? 'Answered'
              : entry.question
                ? 'Awaiting answer'
                : 'Awaiting question',
            snapshotInsights,
          };
        }),
    [diaryEntries],
  );
  const selectedChapter = chapters.find((entry) => entry.id === selectedChapterId) || chapters.at(-1) || null;
  const selectedCategories = Array.isArray(selectedChapter?.relatedCategories) ? selectedChapter.relatedCategories.filter(Boolean) : [];
  const analyticsSnapshot = selectedChapter?.analyticsSnapshot || null;
  const canAskQuestion = Boolean(
    selectedChapter
    && viewerSeat
    && seatFromPlayerRef(selectedChapter.askedByPlayerId) === viewerSeat
    && !normalizeText(selectedChapter.question),
  );
  const canAnswerChapter = Boolean(
    selectedChapter
    && viewerSeat
    && seatFromPlayerRef(selectedChapter.answeredByPlayerId) === viewerSeat
    && normalizeText(selectedChapter.question)
    && normalizeIdentity(selectedChapter.chapterState || selectedChapter.status) !== 'answered',
  );

  useEffect(() => {
    if (!chapters.length) {
      setSelectedChapterId('');
      return;
    }
    setSelectedChapterId((current) => (chapters.some((entry) => entry.id === current) ? current : chapters.at(-1)?.id || ''));
  }, [chapters]);

  useEffect(() => {
    if (!selectedChapter) {
      setQuestionDraft('');
      setDraft(defaultAmaAnswerDraft());
      setMediaFiles([]);
      return;
    }
    setQuestionDraft(selectedChapter.question || '');
    setDraft({
      ...defaultAmaAnswerDraft(),
      answer: selectedChapter.answer || '',
      story: selectedChapter.story || '',
      media: Array.isArray(selectedChapter.media) ? selectedChapter.media : [],
      relatedCategories: Array.isArray(selectedChapter.relatedCategories) ? selectedChapter.relatedCategories.filter(Boolean) : [],
      question: selectedChapter.question || '',
      itemId: selectedChapter.amaItemId || selectedChapter.linkedForfeitId || '',
      requestId: selectedChapter.sourceId || selectedChapter.id,
    });
    setMediaFiles([]);
  }, [selectedChapter]);

  useEffect(() => {
    if (!isDiaryOpen) return undefined;
    setIsDiaryOpening(true);
    const timeout = window.setTimeout(() => setIsDiaryOpening(false), 620);
    return () => window.clearTimeout(timeout);
  }, [isDiaryOpen]);

  const saveQuestion = async () => {
    if (!selectedChapter?.sourceId) return;
    await onSubmitAmaQuestion?.({
      requestId: selectedChapter.sourceId,
      question: questionDraft,
    });
  };

  const saveChapter = async () => {
    if (!selectedChapter?.sourceId) return;
    const analyticsSnapshotPayload = buildDiaryAnalyticsSnapshot(roundAnalytics, draft.relatedCategories || []);
    await onAnswerAmaRequest?.({
      requestId: selectedChapter.sourceId,
      answer: draft.answer,
      story: draft.story,
      relatedCategories: draft.relatedCategories || [],
      analyticsSnapshot: analyticsSnapshotPayload,
      mediaFiles,
    });
    setMediaFiles([]);
  };

  return (
    <section className="panel lobby-panel lobby-panel--archive lobby-diary-card dashboard-page-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Shared AMA Diary</p>
          <h2>KJK Kinks AMA Stories & Secrets</h2>
        </div>
        <span className="status-pill">{chapters.length} chapters</span>
      </div>

      <div className={`diary-book shared-diary-book ${isDiaryOpen ? 'is-open' : 'is-closed'} ${isDiaryOpening ? 'is-opening' : ''}`}>
        {!isDiaryOpen ? (
          <article className="diary-cover shared-diary-cover">
            <div className="diary-cover-copy">
              <p className="eyebrow">KJK School Diary</p>
              <h3>KJK Kinks AMA Stories & Secrets</h3>
              <p>Open your keepsake journal to read chapters, stories, and snapshots from redeemed AMA moments.</p>
            </div>
            <div className="diary-cover-stats shared-diary-stats">
              <span>{chapters.length} chapters</span>
              <span>Frozen snapshots</span>
              <span>Shared memories</span>
            </div>
            <div className="button-row">
              <Button className="primary-button compact diary-open-button" onClick={() => setIsDiaryOpen(true)}>
                Open Diary →
              </Button>
            </div>
          </article>
        ) : (
          <>
        <section className="shared-diary-intro">
          <div className="shared-diary-intro-copy">
            <p className="eyebrow">Private Chapters</p>
            <h3>KJK Kinks AMA Stories & Secrets</h3>
            <p>Each redeemed AMA becomes its own chapter, with the question, answer, story, categories, and a frozen analytics snapshot saved exactly as it was at that moment.</p>
          </div>
          <div className="diary-cover-stats shared-diary-stats">
            <span>Shared AMA book</span>
            <span>{chapters.length} chapters</span>
            <span>Frozen snapshots</span>
          </div>
          <div className="button-row">
            <Button className="ghost-button compact diary-open-button" onClick={() => setIsDiaryOpen(false)}>
              Close Diary
            </Button>
          </div>
        </section>

        {!chapters.length ? (
          <article className="diary-cover shared-diary-empty">
            <div className="diary-cover-copy">
              <p className="eyebrow">No Chapters Yet</p>
              <h3>No AMA stories yet</h3>
              <p>Redeemed AMA forfeits will appear here as chapters.</p>
            </div>
          </article>
        ) : (
          <div className="shared-diary-layout">
            <aside className="shared-diary-sidebar">
              <div className="shared-diary-sidebar-head">
                <p className="eyebrow">Chapter List</p>
                <strong>Chronological chapters</strong>
              </div>
              <div className="shared-diary-chapter-list">
                {chapters.map((chapter) => (
                  <button
                    key={chapter.id}
                    type="button"
                    className={`shared-diary-chapter-card ${selectedChapter?.id === chapter.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedChapterId(chapter.id)}
                  >
                    <small>Chapter {chapter.chapterNumber}</small>
                    <strong>{chapter.chapterTitle}</strong>
                    <span>{chapter.question ? `${chapter.askedByLabel} asked ${chapter.answeredByLabel}` : `Waiting for ${chapter.askedByLabel} to add the question`}</span>
                    <div className="shared-diary-chapter-meta">
                      <span>{chapter.statusLabel}</span>
                      <span>{chapter.answeredAt || chapter.respondedAt ? chapter.answeredLabel : chapter.createdLabel}</span>
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            <section className="shared-diary-content">
              {selectedChapter ? (
                <div className={`diary-spread shared-diary-spread ${isDiaryOpening ? 'diary-spread--next' : ''}`}>
                  <article className={`diary-page diary-page--left shared-diary-page ${isDiaryOpening ? 'diary-page--enter-next' : ''}`}>
                    <div className="shared-diary-page-header">
                      <span className="status-pill diary-page-pill">Chapter {selectedChapter.chapterNumber}</span>
                      <span className="status-pill diary-page-pill">{selectedChapter.statusLabel}</span>
                    </div>
                    <small>AMA chapter</small>
                    <h3>{selectedChapter.chapterTitle}</h3>
                    <div className="shared-diary-meta-grid">
                      <span><strong>Asked by</strong>{selectedChapter.askedByLabel}</span>
                      <span><strong>Answered by</strong>{selectedChapter.answeredByLabel}</span>
                      <span><strong>Created</strong>{selectedChapter.createdLabel}</span>
                      <span><strong>Answered</strong>{selectedChapter.answeredLabel}</span>
                    </div>

                    {canAskQuestion ? (
                      <div className="shared-diary-editor">
                        <label className="field">
                          <span>AMA question</span>
                          <textarea
                            rows="4"
                            value={questionDraft}
                            onChange={(event) => setQuestionDraft(event.target.value)}
                            placeholder="Type the question for this chapter"
                          />
                        </label>
                        <div className="button-row">
                          <Button className="primary-button compact" onClick={saveQuestion} disabled={isBusy || !questionDraft.trim()}>
                            Save Question
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="shared-diary-question-block">
                        <strong>Question / request</strong>
                        <p>{selectedChapter.question || 'Question still pending for this AMA chapter.'}</p>
                      </div>
                    )}
                  </article>

                  <article className={`diary-page diary-page--right shared-diary-page ${isDiaryOpening ? 'diary-page--enter-next' : ''}`}>
                    {canAnswerChapter ? (
                      <div className="shared-diary-editor">
                        <label className="field">
                          <span>Answer</span>
                          <textarea
                            rows="3"
                            value={draft.answer}
                            onChange={(event) => setDraft((current) => ({ ...current, answer: event.target.value }))}
                            placeholder="Write the direct answer"
                          />
                        </label>
                        <label className="field">
                          <span>Story / context</span>
                          <textarea
                            rows="5"
                            value={draft.story}
                            onChange={(event) => setDraft((current) => ({ ...current, story: event.target.value }))}
                            placeholder="Add the diary-style story behind it"
                          />
                        </label>
                        <div className="field">
                          <span>Categories for this chapter</span>
                          <div className="filter-chip-grid filter-chip-grid--categories diary-theme-grid">
                            {themeOptions.map((categoryName) => {
                              const isOn = draft.relatedCategories?.includes(categoryName);
                              return (
                                <button
                                  key={categoryName}
                                  type="button"
                                  className={`filter-chip ${isOn ? 'is-on' : ''}`}
                                  onClick={() =>
                                    setDraft((current) => ({
                                      ...current,
                                      relatedCategories: current.relatedCategories?.includes(categoryName)
                                        ? current.relatedCategories.filter((entry) => entry !== categoryName)
                                        : [...(current.relatedCategories || []), categoryName],
                                    }))
                                  }
                                >
                                  {categoryName}
                                </button>
                              );
                            })}
                          </div>
                          <small className="field-note">These category analytics are frozen the moment you save this chapter.</small>
                        </div>
                        <label className="field">
                          <span>Evidence / media</span>
                          <input type="file" accept="image/*,video/*" multiple onChange={(event) => setMediaFiles(Array.from(event.target.files || []))} />
                        </label>
                        <div className="button-row">
                          <Button className="primary-button compact" onClick={saveChapter} disabled={isBusy || !draft.answer.trim()}>
                            Save Chapter
                          </Button>
                        </div>
                      </div>
                    ) : selectedChapter.answer || selectedChapter.story ? (
                      <>
                        {selectedChapter.answer ? (
                          <div className="shared-diary-answer-block">
                            <strong>Answer</strong>
                            <p>{selectedChapter.answer}</p>
                          </div>
                        ) : null}
                        {selectedChapter.story ? (
                          <div className="shared-diary-answer-block">
                            <strong>Story</strong>
                            <p>{selectedChapter.story}</p>
                          </div>
                        ) : null}
                      </>
                    ) : normalizeText(selectedChapter.question) ? (
                      <p className="empty-copy">Waiting for {selectedChapter.answeredByLabel} to answer this AMA chapter.</p>
                    ) : (
                      <p className="empty-copy">Waiting for the AMA question to be added before this chapter can be answered.</p>
                    )}

                    {selectedCategories.length ? (
                      <div className="diary-appendix">
                        <strong>Selected categories</strong>
                        <div className="filter-chip-grid diary-theme-grid">
                          {selectedCategories.map((category) => (
                            <span key={category} className="filter-chip is-on diary-theme-chip">
                              {category}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {selectedChapter.snapshotInsights.length ? (
                      <div className="diary-appendix">
                        <strong>Frozen category analytics</strong>
                        <div className="shared-diary-snapshot-grid">
                          {selectedChapter.snapshotInsights.map((insight) => (
                            <article className="shared-diary-snapshot-card" key={`${selectedChapter.id}-${insight.category}`}>
                              <div className="shared-diary-snapshot-head">
                                <strong>{insight.category}</strong>
                                <small>{insight.rounds} {insight.rounds === 1 ? 'question' : 'questions'}</small>
                              </div>
                              <div className="shared-diary-snapshot-meter">
                                <div className="shared-diary-snapshot-bar shared-diary-snapshot-bar--jay" style={{ width: `${insight.strengths?.jay || 50}%` }}>
                                  Jay
                                </div>
                                <div className="shared-diary-snapshot-bar shared-diary-snapshot-bar--kim" style={{ width: `${insight.strengths?.kim || 50}%` }}>
                                  Kim
                                </div>
                              </div>
                              <div className="shared-diary-snapshot-totals">
                                <span>Jay {formatScore(insight.totals?.jay || 0)}</span>
                                <span>Kim {formatScore(insight.totals?.kim || 0)}</span>
                              </div>
                              <p>{insight.summary}</p>
                            </article>
                          ))}
                        </div>
                        {analyticsSnapshot?.capturedAt ? <p className="diary-analytics-note-caption">Frozen at {formatShortDateTime(analyticsSnapshot.capturedAt)}</p> : null}
                      </div>
                    ) : null}

                    {Array.isArray(selectedChapter.media) && selectedChapter.media.length ? (
                      <div className="diary-appendix">
                        <strong>Evidence / media</strong>
                        <div className="diary-media-grid">
                          {selectedChapter.media.map((media) => (
                            <a key={media.url || media.path} href={media.url} target="_blank" rel="noreferrer" className="diary-media-item">
                              {String(media.type || '').startsWith('video') ? <video src={media.url} controls playsInline /> : <img src={media.url} alt={media.name || 'Diary media'} />}
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </article>
                </div>
              ) : null}
            </section>
          </div>
        )}
          </>
        )}
      </div>
    </section>
  );
}

function RedemptionStoreSection({
  user,
  profile,
  currentSeat,
  playerAccounts,
  redemptionItems,
  redemptionHistory,
  amaRequests,
  diaryEntries,
  forfeitPriceRequests,
  onSaveRedemptionItem,
  onDeleteRedemptionItem,
  onToggleRedemptionItemActive,
  onRedeemRedemptionItem,
  onSubmitAmaQuestion,
  onAnswerAmaRequest,
  onCreateForfeitRequest,
  onDeleteForfeitRequest,
  onUpdateForfeitRequest,
  onMarkRequestSeen,
  onMarkResponseSeen,
  onRespondToForfeitRequest,
  roundAnalytics,
  isBusy,
  sectionId,
}) {
  const initialViewerSeat = currentSeat || inferSeatFromUser(user, profile) || 'jay';
  const [activeOwnerSeat, setActiveOwnerSeat] = useState(initialViewerSeat);
  const [drafts, setDrafts] = useState({
    jay: defaultRedemptionDraft(),
    kim: defaultRedemptionDraft(),
  });
  const [editingIds, setEditingIds] = useState({
    jay: '',
    kim: '',
  });
  const [isAddForfeitModalOpen, setIsAddForfeitModalOpen] = useState(false);
  const [isRequestForfeitModalOpen, setIsRequestForfeitModalOpen] = useState(false);
  const [requestDrafts, setRequestDrafts] = useState({
    jay: defaultForfeitRequestDraft(),
    kim: defaultForfeitRequestDraft(),
  });
  const [requestEditDrafts, setRequestEditDrafts] = useState({});
  const [editingRequestIds, setEditingRequestIds] = useState({});
  const [responseDrafts, setResponseDrafts] = useState({});
  const [composeMode, setComposeMode] = useState('forfeit');
  const [amaQuestionDraft, setAmaQuestionDraft] = useState(defaultAmaQuestionDraft());
  const [amaAnswerDraft, setAmaAnswerDraft] = useState(defaultAmaAnswerDraft());
  const [activeAmaRequestId, setActiveAmaRequestId] = useState('');
  const [activeAmaAnswerRequestId, setActiveAmaAnswerRequestId] = useState('');
  const [isAmaRedeemPickerOpen, setIsAmaRedeemPickerOpen] = useState(false);
  const [amaQuestionFiles, setAmaQuestionFiles] = useState([]);
  const [amaAnswerFiles, setAmaAnswerFiles] = useState([]);

  const ownerSeat = activeOwnerSeat;
  const ownerPlayerId = fixedPlayerUids[ownerSeat];
  const ownerLabel = PLAYER_LABEL[ownerSeat] || ownerSeat;
  const otherSeat = ownerSeat === 'jay' ? 'kim' : 'jay';
  const otherPlayerId = fixedPlayerUids[otherSeat];
  const viewerLabel = profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player';
  /*
    Determine whether the current viewer is looking at their own store. In the
    original implementation the check compared the store owner’s player ID
    (a short alias like "jaynorton17") with the authenticated user’s UID. This
    caused a mismatch because Firebase UIDs are typically long strings while
    the fixed player IDs are short aliases. To handle both cases we also
    compare the owner seat (jay/kim) with the current seat derived from the
    logged‑in user. If either comparison matches we treat this as the user’s
    own store.
  */
  const viewerSeat = currentSeat || inferSeatFromUser(user, profile);
  const isOwnStore = ownerSeat === viewerSeat;
  const didSyncViewerSeatRef = useRef(false);
  const viewerIdentityTokens = useMemo(
    () =>
      new Set(
        [
          user?.uid,
          profile?.displayName,
          user?.displayName,
          user?.email?.split('@')[0],
          viewerSeat,
          viewerSeat ? playerIdForSeat(viewerSeat) : '',
          viewerSeat ? PLAYER_LABEL[viewerSeat] : '',
        ]
          .map(normalizeIdentity)
          .filter(Boolean),
      ),
    [profile?.displayName, user?.displayName, user?.email, user?.uid, viewerSeat],
  );
  const matchesViewerIdentity = (value) => {
    const normalized = normalizeIdentity(value);
    if (!normalized) return false;
    return viewerIdentityTokens.has(normalized) || (viewerSeat ? seatFromPlayerRef(value) === viewerSeat : false);
  };
  const requestTargetPlayerId = isOwnStore ? otherPlayerId : ownerPlayerId;
  const requestTargetLabel = PLAYER_LABEL[requestTargetPlayerId === fixedPlayerUids.jay ? 'jay' : 'kim'] || 'other player';
  const ownerCountryLabel = ownerSeat === 'jay' ? 'UNITED KINGDOM' : 'UNITED STATES';
  const ownerAccentLabel = ownerSeat === 'jay' ? 'UK' : 'USA';
  const ownerBalance = Number(playerAccounts?.[ownerSeat]?.lifetimePenaltyPoints || 0);
  const normalizedRedemptionItems = useMemo(
    () =>
      redemptionItems
        .map((item) => {
          const itemType = isAmaStoreItem(item) ? 'ama' : 'forfeit';
          const itemSeat = seatFromPlayerRef(item.ownerPlayerId || item.ownerSeat || item.storeOwnerUserId || item.createdByDisplayName || item.createdBy) || 'jay';
          return {
            ...item,
            ownerSeat: itemSeat,
            ownerPlayerId: playerIdForSeat(itemSeat),
            itemType,
            title: item.title || item.name || (itemType === 'ama' ? 'AMA / Ask Me Anything' : 'Forfeit'),
            description: item.description || (itemType === 'ama' ? 'Ask Me Anything' : ''),
            visibleInStore: item.visibleInStore !== false && item.hidden !== true && item.archived !== true,
            redeemable: item.redeemable !== false && item.archived !== true,
            keepOnRedeemed: itemType === 'ama' ? true : Boolean(item.keepOnRedeemed),
          };
        })
        .sort(sortByNewest),
    [redemptionItems],
  );
  const ownerItems = useMemo(() => {
    const seenAmaForOwner = new Set();
    return normalizedRedemptionItems.filter((item) => {
      if (item.ownerSeat !== ownerSeat || !item.visibleInStore) return false;
      if (item.itemType !== 'ama') return true;
      const key = `${item.ownerPlayerId}::ama`;
      if (seenAmaForOwner.has(key)) return false;
      seenAmaForOwner.add(key);
      return true;
    });
  }, [normalizedRedemptionItems, ownerSeat]);
  const ownerForfeitItems = ownerItems.filter((item) => (item.itemType || 'forfeit') === 'forfeit');
  const ownerAmaItems = ownerItems.filter((item) => (item.itemType || 'forfeit') === 'ama');
  const visibleStoreItems = [...ownerAmaItems, ...ownerForfeitItems];
  const recentHistory = redemptionHistory.slice(0, 8);
  const currentDraft = drafts[ownerSeat];
  const currentEditingId = editingIds[ownerSeat];
  const currentRequestDraft = requestDrafts[ownerSeat];
  const ownerRequestsWaitingForMe = forfeitPriceRequests
    .filter((request) => seatFromPlayerRef(request.storeOwnerUserId || request.requestedFromUserId) === ownerSeat && matchesViewerIdentity(request.requestedFromUserId))
    .sort(sortByNewest);
  const ownerRequestsSentByMe = forfeitPriceRequests
    .filter((request) => seatFromPlayerRef(request.storeOwnerUserId || request.requestedFromUserId) === ownerSeat && matchesViewerIdentity(request.requestedByUserId))
    .sort(sortByNewest);
  const ownerAmaWaitingForMe = amaRequests
    .filter((request) => seatFromPlayerRef(request.storeOwnerUserId || request.requestedFromUserId || request.ownerPlayerId) === ownerSeat && matchesViewerIdentity(request.requestedFromUserId || request.storeOwnerUserId))
    .sort(sortByNewest);
  const ownerAmaSentByMe = amaRequests
    .filter((request) => seatFromPlayerRef(request.storeOwnerUserId || request.requestedFromUserId || request.ownerPlayerId) === ownerSeat && matchesViewerIdentity(request.requestedByUserId))
    .sort(sortByNewest);
  const storeTitle = ownerSeat === 'jay' ? "JAY'S FORFEITS" : "KIM'S FORFEITS";
  const storeHelper = isOwnStore
    ? `These are the forfeits ${ownerLabel} offers.`
    : `Available forfeits you can request from ${ownerLabel}.`;
  const requestPanelTitle =
    ownerSeat === 'jay'
      ? "KIM'S REQUESTS (TO JAY)"
      : "JAY'S REQUESTS (TO KIM)";
  const storeHeadingLabel = storeTitle;
  const primaryStoreActionLabel = isOwnStore ? 'ADD A FORFEIT' : 'REQUEST FORFEIT';
  const completedHistory = recentHistory.filter((entry) => entry.status === 'completed').slice(0, 4);
  const diaryThemeOptions = useMemo(() => buildDiaryThemeOptions(roundAnalytics), [roundAnalytics]);

  useEffect(() => {
    const initialSeat = currentSeat || viewerSeat;
    if (!didSyncViewerSeatRef.current && initialSeat) {
      setActiveOwnerSeat(initialSeat);
      didSyncViewerSeatRef.current = true;
    }
  }, [currentSeat, viewerSeat]);

  useEffect(() => {
    setComposeMode('forfeit');
  }, [ownerPlayerId]);

  const startEdit = (item) => {
    const itemSeat = seatFromPlayerRef(item.ownerPlayerId || item.ownerSeat || item.createdByDisplayName || item.createdBy) || 'jay';
    const itemType = item.itemType || 'forfeit';
    setActiveOwnerSeat(itemSeat);
    setComposeMode(itemType);
    setEditingIds((current) => ({ ...current, [itemSeat]: item.id }));
    setDrafts((current) => ({
      ...current,
      [itemSeat]: {
        title: item.title || '',
        description: item.description || '',
        cost: String(item.cost ?? ''),
        active: item.active !== false,
        keepOnRedeemed: Boolean(item.keepOnRedeemed),
        itemType,
      },
    }));
  };

  const startAdd = (itemType = 'forfeit') => {
    setComposeMode(itemType);
    setEditingIds((current) => ({ ...current, [ownerSeat]: '' }));
    setDrafts((current) => ({
      ...current,
      [ownerSeat]: {
        ...defaultRedemptionDraft(),
        itemType,
        cost: itemType === 'ama' ? String(AMA_COST) : '',
        keepOnRedeemed: itemType === 'ama',
      },
    }));
  };

  const openAddForfeitModal = () => {
    startAdd('forfeit');
    setIsAddForfeitModalOpen(true);
  };

  const openAddAmaModal = () => {
    startAdd('ama');
    setIsAddForfeitModalOpen(true);
  };

  const openRequestForfeitModal = (item = null) => {
    setRequestDrafts((current) => ({
      ...current,
      [ownerSeat]: {
        ...defaultForfeitRequestDraft(),
        title: item?.title || current[ownerSeat]?.title || '',
        description: item?.description || current[ownerSeat]?.description || '',
        open: true,
      },
    }));
    setIsRequestForfeitModalOpen(true);
  };

  const closeAddForfeitModal = () => {
    setIsAddForfeitModalOpen(false);
  };

  const closeRequestForfeitModal = () => {
    setIsRequestForfeitModalOpen(false);
    setRequestDrafts((current) => ({
      ...current,
      [ownerSeat]: defaultForfeitRequestDraft(),
    }));
  };

  const updateResponseDraft = (requestId, patch) => {
    setResponseDrafts((current) => ({
      ...current,
      [requestId]: {
        ...defaultForfeitResponseDraft(),
        ...(current[requestId] || {}),
        ...patch,
      },
    }));
  };

  const saveDraft = async () => {
    await onSaveRedemptionItem({
      itemId: currentEditingId,
      ownerPlayerId,
      title: currentDraft.title,
      description: currentDraft.description,
      cost: currentDraft.cost,
      active: currentDraft.active,
      keepOnRedeemed: currentDraft.keepOnRedeemed,
      itemType: composeMode,
    });
    setEditingIds((current) => ({ ...current, [ownerSeat]: '' }));
    setDrafts((current) => ({ ...current, [ownerSeat]: defaultRedemptionDraft() }));
    closeAddForfeitModal();
  };

  const submitForfeitRequest = async () => {
    await onCreateForfeitRequest({
      storeOwnerUserId: ownerPlayerId,
      title: currentRequestDraft.title,
      description: currentRequestDraft.description,
    });
    setRequestDrafts((current) => ({
      ...current,
      [ownerSeat]: defaultForfeitRequestDraft(),
    }));
    setIsRequestForfeitModalOpen(false);
  };

  const submitForfeitResponse = async (request, action) => {
    const draft = responseDrafts[request.id] || defaultForfeitResponseDraft();
    await onRespondToForfeitRequest(request, {
      action,
      price: draft.price,
      message: draft.message,
    });
    setResponseDrafts((current) => ({
      ...current,
      [request.id]: defaultForfeitResponseDraft(),
    }));
  };

  const handlePrimaryStoreAction = () => {
    if (isOwnStore) {
      openAddForfeitModal();
      return;
    }
    openRequestForfeitModal();
  };

  const openAmaQuestionModal = (requestResult) => {
    if (!requestResult?.requestId) return;
    setActiveAmaRequestId(requestResult.requestId);
    setAmaQuestionDraft(defaultAmaQuestionDraft());
    setAmaQuestionFiles([]);
  };

  const closeAmaQuestionModal = () => {
    setActiveAmaRequestId('');
    setAmaQuestionDraft(defaultAmaQuestionDraft());
    setAmaQuestionFiles([]);
  };

  const submitAmaQuestionFlow = async () => {
    await onSubmitAmaQuestion?.({
      requestId: activeAmaRequestId,
      question: amaQuestionDraft.question,
    });
    closeAmaQuestionModal();
  };

  const openAmaRedeemPicker = () => {
    setIsAmaRedeemPickerOpen(true);
  };

  const closeAmaRedeemPicker = () => {
    setIsAmaRedeemPickerOpen(false);
  };

  const redeemAmaItem = async (item) => {
    const result = await onRedeemRedemptionItem?.(item);
    if (result?.type === 'ama') {
      openAmaQuestionModal(result);
    }
    closeAmaRedeemPicker();
  };

  const openAmaAnswerModal = (request) => {
    if (!request?.id) return;
    setActiveAmaAnswerRequestId(request.id);
    setAmaAnswerDraft({
      answer: request.answer || '',
      story: request.story || '',
      media: request.media || [],
      relatedCategories: Array.isArray(request.relatedCategories) ? request.relatedCategories.filter(Boolean) : [],
      open: true,
      question: request.question || '',
      itemId: request.amaItemId || '',
      requestId: request.id,
    });
    setAmaAnswerFiles([]);
  };

  const closeAmaAnswerModal = () => {
    setActiveAmaAnswerRequestId('');
    setAmaAnswerDraft(defaultAmaAnswerDraft());
    setAmaAnswerFiles([]);
  };

  const submitAmaAnswerFlow = async () => {
    const analyticsSnapshot = buildDiaryAnalyticsSnapshot(roundAnalytics, amaAnswerDraft.relatedCategories || []);
    await onAnswerAmaRequest?.({
      requestId: activeAmaAnswerRequestId,
      answer: amaAnswerDraft.answer,
      story: amaAnswerDraft.story,
      relatedCategories: amaAnswerDraft.relatedCategories || [],
      analyticsSnapshot,
      mediaFiles: amaAnswerFiles,
    });
    closeAmaAnswerModal();
  };

  const startEditRequest = (request) => {
    setEditingRequestIds((current) => ({ ...current, [request.id]: true }));
    setRequestEditDrafts((current) => ({
      ...current,
      [request.id]: {
        title: request.forfeitTitle || '',
        description: request.forfeitDescription || '',
      },
    }));
  };

  const saveEditedRequest = async (request) => {
    const draft = requestEditDrafts[request.id] || {};
    await onUpdateForfeitRequest?.(request.id, {
      title: draft.title,
      description: draft.description,
    });
    setEditingRequestIds((current) => {
      const next = { ...current };
      delete next[request.id];
      return next;
    });
  };

  const renderHistoryRow = (entry) => {
    const storeOwnerSeat = seatFromPlayerRef(entry.storeOwnerPlayerId) || 'jay';
    const redeemerSeat = seatFromPlayerRef(entry.redeemedByPlayerId) || 'jay';
    const spentSeat = seatFromPlayerRef(entry.pointsDeductedFromPlayerId) || 'jay';
    const statusLabel = entry.status === 'completed' ? 'Completed' : entry.status === 'seen' ? 'Seen' : 'Redeemed';
    return (
      <article className="mini-list-row redemption-history-row" key={entry.id}>
        <strong>{entry.itemTitle || 'Forfeit'}</strong>
        <span>
          {PLAYER_LABEL[redeemerSeat] || redeemerSeat} redeemed from {PLAYER_LABEL[storeOwnerSeat] || storeOwnerSeat}
        </span>
        <small>
          {statusLabel} · Spent {formatScore(entry.itemCost || 0)} from {PLAYER_LABEL[spentSeat] || spentSeat} · {formatShortDateTime(entry.redeemedAt)}
        </small>
      </article>
    );
  };

  const renderRequestStatus = (request) => {
    if (request.status === 'rejected') return 'Rejected';
    if (request.status === 'priced') return 'Priced';
    if (request.status === 'added_to_store') return 'Added to store';
    return 'Pending';
  };

  return (
    <section className="panel lobby-panel lobby-store-card lobby-panel--store" id={sectionId}>
      <div className="forfeit-store-selector" role="tablist" aria-label="Forfeit redemption stores">
        {seats.map((seatOption) => (
          <Button
            key={seatOption}
            className={`store-banner-card ${seatOption === 'jay' ? 'store-banner-card--jay' : 'store-banner-card--kim'} ${activeOwnerSeat === seatOption ? 'is-on' : ''}`}
            onClick={() => setActiveOwnerSeat(seatOption)}
          >
            <span className="store-banner-icon" aria-hidden="true">
              {seatOption === 'jay' ? '🇬🇧' : '🇺🇸'}
            </span>
            <span className="store-banner-copy">
              <strong>{PLAYER_LABEL[seatOption] || seatOption}'S STORE</strong>
              <small>{seatOption === 'jay' ? 'UNITED KINGDOM' : 'UNITED STATES'}</small>
            </span>
            <span className="store-banner-chip">{activeOwnerSeat === seatOption ? 'ACTIVE' : 'SELECT'}</span>
          </Button>
        ))}
      </div>

      <div className="forfeit-main-grid">
        <section className="redemption-store-main store-pane-card">
          <div className="panel-heading compact-heading">
            <div>
              <h3>{storeHeadingLabel}</h3>
              <p className="store-helper-copy">{storeHelper}</p>
            </div>
            <span className="status-pill">{formatScore(ownerBalance)} available</span>
          </div>
          <div className="store-request-box">
            <div className="button-row store-main-action-row">
              <Button className="primary-button compact store-main-action-button" onClick={handlePrimaryStoreAction} disabled={isBusy}>
                {primaryStoreActionLabel}
              </Button>
            </div>
          </div>

          <div className="store-item-list">
            {visibleStoreItems.length ? (
              visibleStoreItems.map((item) => {
                return (
                  <article className="mini-list-row redemption-item-row" key={item.id}>
                    <div className="redemption-item-badge" aria-hidden="true">
                      {item.itemType === 'ama' ? 'AM' : item.source === 'price_request' ? 'RQ' : '✦'}
                    </div>
                    <div className="redemption-item-copy">
                      <strong>{item.title}</strong>
                      <span>{item.description || 'No description'}</span>
                      <small>
                        Cost {formatScore(Number(item.cost || 0))} · {item.active === false ? 'Inactive' : 'Active'}
                        {item.keepOnRedeemed ? ' · Diary' : ''}
                        {item.source === 'price_request' ? ' · From request' : ''}
                        {item.itemType === 'ama' ? ' · AMA' : ''}
                      </small>
                    </div>
                    <div className="redemption-item-actions">
                      {isOwnStore ? (
                        <>
                          {item.itemType === 'ama' ? (
                            <span className="status-pill">Fixed AMA</span>
                          ) : (
                            <>
                              <Button className="ghost-button compact" onClick={() => startEdit(item)} disabled={isBusy}>
                                Edit
                              </Button>
                              <Button className="ghost-button compact" onClick={() => onToggleRedemptionItemActive(item.id, item.active === false)} disabled={isBusy}>
                                {item.active === false ? 'Activate' : 'Deactivate'}
                              </Button>
                              <Button className="ghost-button compact" onClick={() => onDeleteRedemptionItem(item.id)} disabled={isBusy}>
                                Delete
                              </Button>
                            </>
                          )}
                        </>
                      ) : item.itemType === 'ama' ? (
                        <Button className="primary-button compact" onClick={() => redeemAmaItem(item)} disabled={isBusy || item.active === false || ownerBalance < Number(item.cost || 0)}>
                          REDEEM AMA
                        </Button>
                      ) : (
                        <Button
                          className="primary-button compact"
                          onClick={() => openRequestForfeitModal(item)}
                          disabled={isBusy}
                        >
                          REQUEST
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="empty-copy">{isOwnStore ? 'Add a new forfeit to your list.' : 'Add a new forfeit to request.'}</p>
            )}
          </div>
        </section>

        <aside className="redemption-store-side">
          <section className="forfeit-requests-panel">
            <div className="panel-heading compact-heading">
              <div>
                <h3>{requestPanelTitle}</h3>
              </div>
            </div>
            <div className="request-columns">
              <section className="request-column">
                <p className="eyebrow">Requests to complete</p>
                <div className="mini-list">
                  {ownerRequestsWaitingForMe.length ? (
                      ownerRequestsWaitingForMe.map((request) => {
                        const requesterSeat = seatFromPlayerRef(request.requestedByUserId) || 'jay';
                        const responseDraft = responseDrafts[request.id] || defaultForfeitResponseDraft();
                        return (
                          <article className="mini-list-row forfeit-request-row" key={request.id}>
                            <strong>{request.forfeitTitle || 'Forfeit request'}</strong>
                            <span>{PLAYER_LABEL[requesterSeat] || requesterSeat} requested a price.</span>
                            <small>
                              {renderRequestStatus(request)} · {formatShortDateTime(request.requestedAt)}
                              {request.proposedPrice ? ` · ${formatScore(Number(request.proposedPrice || 0))}` : ''}
                            </small>
                            {request.forfeitDescription ? <small>{request.forfeitDescription}</small> : null}
                            {request.status === 'pending' ? (
                              <>
                                {!request.requestNotificationSeen ? (
                                  <Button className="ghost-button compact" onClick={() => onMarkRequestSeen(request.id)} disabled={isBusy}>
                                    Mark Seen
                                  </Button>
                                ) : null}
                                <div className="request-response-grid">
                                  <label className="field">
                                    <span>Set price</span>
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      value={responseDraft.price}
                                      onChange={(event) => updateResponseDraft(request.id, { price: event.target.value })}
                                      placeholder="50"
                                    />
                                  </label>
                                  <label className="field">
                                    <span>Response note</span>
                                    <input
                                      value={responseDraft.message}
                                      onChange={(event) => updateResponseDraft(request.id, { message: event.target.value })}
                                      placeholder="Optional note"
                                    />
                                  </label>
                                </div>
                                <div className="button-row">
                                  <Button className="primary-button compact" onClick={() => submitForfeitResponse(request, 'price')} disabled={isBusy}>
                                    Accept
                                  </Button>
                              <Button className="ghost-button compact" onClick={() => submitForfeitResponse(request, 'reject')} disabled={isBusy}>
                                  Reject
                                </Button>
                                <Button className="ghost-button compact" onClick={() => submitForfeitResponse(request, 'price')} disabled={isBusy}>
                                  Counter Price
                                </Button>
                                </div>
                              </>
                            ) : (
                              <small>{request.responseMessage || 'Response recorded.'}</small>
                            )}
                          </article>
                        );
                      })
                  ) : (
                    <p className="empty-copy">Nothing waiting for you in this store.</p>
                  )}
                </div>
              </section>

              <section className="request-column">
                <p className="eyebrow">Requests sent by me</p>
                <div className="mini-list">
                  {ownerRequestsSentByMe.length ? (
                    ownerRequestsSentByMe.map((request) => (
                      <article className="mini-list-row forfeit-request-row" key={request.id}>
                        <strong>{request.forfeitTitle || 'Forfeit request'}</strong>
                        <span>Status: {renderRequestStatus(request)}</span>
                        <small>
                          Requested {formatShortDateTime(request.requestedAt || request.createdAt)}
                          {request.proposedPrice ? ` · ${formatScore(Number(request.proposedPrice || 0))}` : ''}
                        </small>
                        {request.responseMessage ? <small>{request.responseMessage}</small> : null}
                        <div className="button-row">
                          {!request.responseNotificationSeen && request.status !== 'pending' ? (
                            <Button className="ghost-button compact" onClick={() => onMarkResponseSeen(request.id)} disabled={isBusy}>
                              Mark Seen
                            </Button>
                          ) : null}
                          <Button className="ghost-button compact" onClick={() => startEditRequest(request)} disabled={isBusy}>
                            Edit Request
                          </Button>
                          <Button className="ghost-button compact" onClick={() => onDeleteForfeitRequest?.(request.id)} disabled={isBusy}>
                            Cancel Request
                          </Button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="empty-copy">No requests sent in this store yet.</p>
                  )}
                </div>
              </section>
            </div>
          </section>

          <section className="completed-forfeits-panel">
            <div className="panel-heading compact-heading">
              <div>
                <h3>Recent completions</h3>
              </div>
            </div>
            <div className="mini-list">
              {completedHistory.length ? (
                completedHistory.map((entry) => (
                  <article className="mini-list-row redemption-history-row completed-history-row" key={entry.id}>
                        <strong>{entry.itemTitle || 'Forfeit'}</strong>
                        <span>
                          ✓ {formatScore(entry.itemCost || 0)} · {formatShortDateTime(entry.completedAt || entry.redeemedAt)}
                        </span>
                  </article>
                ))
              ) : (
                <p className="empty-copy">No completed forfeits yet.</p>
              )}
            </div>
            <div className="button-row">
                <Button className="ghost-button compact" onClick={() => {}}>
                  VIEW ALL COMPLETED
                </Button>
              </div>
          </section>
        </aside>
      </div>

      {isAddForfeitModalOpen ? (
        <section className="modal-backdrop" role="presentation" onClick={closeAddForfeitModal}>
          <div className="panel modal-panel forfeit-modal" role="dialog" aria-modal="true" aria-label={composeMode === 'ama' ? 'Add AMA' : 'Add forfeit'} onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">{ownerLabel}'s Store</p>
                <h3>{composeMode === 'ama' ? 'ADD AMA' : 'ADD A FORFEIT'}</h3>
              </div>
              <span className="status-pill">{composeMode === 'ama' ? 'AMA · 1000 points' : storeTitle}</span>
            </div>
            <div className="store-editor">
              <div className="auth-form-grid">
                <label className="field">
                  <span>{composeMode === 'ama' ? 'AMA Title' : 'Forfeit Name'}</span>
                  <input
                    value={currentDraft.title}
                    onChange={(event) => setDrafts((current) => ({ ...current, [ownerSeat]: { ...current[ownerSeat], title: event.target.value } }))}
                    placeholder={composeMode === 'ama' ? 'Ask me anything' : 'Make dinner'}
                  />
                </label>
                {composeMode === 'ama' ? (
                  <label className="field">
                    <span>Points Cost</span>
                    <input type="number" inputMode="numeric" value={AMA_COST} readOnly />
                  </label>
                ) : (
                  <label className="field">
                    <span>Points Cost</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={currentDraft.cost}
                      onChange={(event) => setDrafts((current) => ({ ...current, [ownerSeat]: { ...current[ownerSeat], cost: event.target.value } }))}
                      placeholder="50"
                    />
                  </label>
                )}
                <label className="field store-description-field">
                  <span>{composeMode === 'ama' ? 'Context / Notes' : 'Description'}</span>
                  <textarea
                    rows="3"
                    value={currentDraft.description}
                    onChange={(event) => setDrafts((current) => ({ ...current, [ownerSeat]: { ...current[ownerSeat], description: event.target.value } }))}
                    placeholder={composeMode === 'ama' ? 'What should the other player know before they ask?' : 'Short explanation of the forfeit'}
                  />
                </label>
                {composeMode === 'forfeit' ? (
                  <label className="toggle store-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(currentDraft.keepOnRedeemed)}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [ownerSeat]: { ...current[ownerSeat], keepOnRedeemed: event.target.checked },
                        }))
                      }
                    />
                    Keep On Even When Redeemed
                  </label>
                ) : null}
              </div>
              <div className="button-row">
                <Button className="primary-button compact" onClick={saveDraft} disabled={isBusy || !String(currentDraft.title).trim()}>
                  {composeMode === 'ama' ? 'Save AMA' : 'Save Forfeit'}
                </Button>
                <Button className="ghost-button compact" onClick={closeAddForfeitModal} disabled={isBusy}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {isRequestForfeitModalOpen ? (
        <section className="modal-backdrop" role="presentation" onClick={closeRequestForfeitModal}>
          <div className="panel modal-panel forfeit-modal" role="dialog" aria-modal="true" aria-label="Request forfeit" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">{ownerLabel}'s Store</p>
                <h3>REQUEST FORFEIT</h3>
              </div>
              <span className="status-pill">{requestTargetLabel}</span>
            </div>
            <div className="store-editor">
              <div className="auth-form-grid">
                <label className="field">
                  <span>Forfeit Name</span>
                  <input
                    value={currentRequestDraft.title}
                    onChange={(event) =>
                      setRequestDrafts((current) => ({
                        ...current,
                        [ownerSeat]: { ...current[ownerSeat], title: event.target.value, open: true },
                      }))
                    }
                    placeholder="Wear the outfit I choose for date night"
                  />
                </label>
                <label className="field store-description-field">
                  <span>Description</span>
                  <textarea
                    rows="3"
                    value={currentRequestDraft.description}
                    onChange={(event) =>
                      setRequestDrafts((current) => ({
                        ...current,
                        [ownerSeat]: { ...current[ownerSeat], description: event.target.value, open: true },
                      }))
                    }
                    placeholder="Optional notes for the store owner"
                  />
                </label>
              </div>
              <div className="button-row">
                <Button className="primary-button compact" onClick={submitForfeitRequest} disabled={isBusy || !String(currentRequestDraft.title).trim()}>
                  Send Request
                </Button>
                <Button className="ghost-button compact" onClick={closeRequestForfeitModal} disabled={isBusy}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {isAmaRedeemPickerOpen ? (
        <section className="modal-backdrop" role="presentation" onClick={closeAmaRedeemPicker}>
          <div className="panel modal-panel forfeit-modal" role="dialog" aria-modal="true" aria-label="Redeem AMA" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">{ownerLabel}'s AMA</p>
                <h3>REDEEM AMA</h3>
              </div>
              <span className="status-pill">1000 points</span>
            </div>
            <div className="mini-list">
              {visibleStoreItems.length ? (
                ownerAmaItems.map((item) => (
                <article className="mini-list-row redemption-item-row" key={item.id}>
                  <div className="redemption-item-copy">
                    <strong>{item.title}</strong>
                    <span>{item.description || 'No description'}</span>
                    <small>Cost {formatScore(Number(item.cost || AMA_COST))}</small>
                  </div>
                    <div className="redemption-item-actions">
                      <Button className="primary-button compact" onClick={() => redeemAmaItem(item)} disabled={isBusy || item.active === false || ownerBalance < Number(item.cost || AMA_COST)}>
                        Redeem
                      </Button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="empty-copy">No AMA items in this store yet.</p>
              )}
            </div>
            <div className="button-row">
              <Button className="ghost-button compact" onClick={closeAmaRedeemPicker} disabled={isBusy}>
                Close
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {activeAmaRequestId ? (
        <section className="modal-backdrop" role="presentation" onClick={closeAmaQuestionModal}>
          <div className="panel modal-panel forfeit-modal" role="dialog" aria-modal="true" aria-label="Ask AMA question" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">{ownerLabel}'s AMA</p>
                <h3>ASK YOUR QUESTION</h3>
              </div>
              <span className="status-pill">{formatScore(AMA_COST)} spent</span>
            </div>
            <label className="field">
              <span>Your question</span>
              <textarea
                rows="4"
                value={amaQuestionDraft.question}
                onChange={(event) => setAmaQuestionDraft((current) => ({ ...current, question: event.target.value }))}
                placeholder="Type the question you want answered"
              />
            </label>
            <div className="button-row">
              <Button className="primary-button compact" onClick={submitAmaQuestionFlow} disabled={isBusy || !amaQuestionDraft.question.trim()}>
                Send Question
              </Button>
              <Button className="ghost-button compact" onClick={closeAmaQuestionModal} disabled={isBusy}>
                Cancel
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {activeAmaAnswerRequestId ? (
        <section className="modal-backdrop" role="presentation" onClick={closeAmaAnswerModal}>
          <div className="panel modal-panel forfeit-modal" role="dialog" aria-modal="true" aria-label="Answer AMA" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">AMA Chapter</p>
                <h3>ANSWER & STORY</h3>
              </div>
            </div>
            <label className="field">
              <span>Question</span>
              <input value={amaAnswerDraft.question || ''} readOnly />
            </label>
            <label className="field">
              <span>Answer</span>
              <textarea
                rows="3"
                value={amaAnswerDraft.answer}
                onChange={(event) => setAmaAnswerDraft((current) => ({ ...current, answer: event.target.value }))}
                placeholder="Your answer"
              />
            </label>
            <label className="field">
              <span>Story / context</span>
              <textarea
                rows="3"
                value={amaAnswerDraft.story}
                onChange={(event) => setAmaAnswerDraft((current) => ({ ...current, story: event.target.value }))}
                placeholder="Tell the story behind it"
              />
            </label>
            <div className="field">
              <span>Related quiz themes</span>
              <div className="filter-chip-grid filter-chip-grid--categories diary-theme-grid">
                {diaryThemeOptions.map((categoryName) => {
                  const isOn = amaAnswerDraft.relatedCategories?.includes(categoryName);
                  return (
                    <button
                      key={categoryName}
                      type="button"
                      className={`filter-chip ${isOn ? 'is-on' : ''}`}
                      onClick={() =>
                        setAmaAnswerDraft((current) => ({
                          ...current,
                          relatedCategories: current.relatedCategories?.includes(categoryName)
                            ? current.relatedCategories.filter((entry) => entry !== categoryName)
                            : [...(current.relatedCategories || []), categoryName],
                        }))
                      }
                    >
                      {categoryName}
                    </button>
                  );
                })}
              </div>
              <small className="field-note">These analytics will be captured exactly as they are when you save this answer.</small>
            </div>
            <label className="field">
              <span>Media</span>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(event) => setAmaAnswerFiles(Array.from(event.target.files || []))}
              />
            </label>
            <div className="button-row">
              <Button className="primary-button compact" onClick={submitAmaAnswerFlow} disabled={isBusy || !amaAnswerDraft.answer.trim()}>
                Save Answer
              </Button>
              <Button className="ghost-button compact" onClick={closeAmaAnswerModal} disabled={isBusy}>
                Cancel
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function MobileAnalyticsSummary({ analytics, queueRemaining, categoryColorMap = CATEGORY_COLOR_MAP, embedded = false }) {
  const content = (
    <div className={`mobile-summary-panel ${embedded ? 'mobile-summary-panel--embedded' : ''}`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Live Stats</p>
          <h2>Quick Summary</h2>
        </div>
      </div>
      <div className="mobile-summary-grid">
        <article className="mini-list-row">
          <strong>Rounds</strong>
          <span>{analytics.totalRounds || 0}</span>
        </article>
        <article className="mini-list-row">
          <strong>Jay Total</strong>
          <span>{formatScore(analytics.totals?.jay || 0)}</span>
        </article>
        <article className="mini-list-row">
          <strong>Kim Total</strong>
          <span>{formatScore(analytics.totals?.kim || 0)}</span>
        </article>
        <article className="mini-list-row">
          <strong>Leader</strong>
          <span>{analytics.leaderboardSummary || 'Awaiting rounds'}</span>
        </article>
        <article className="mini-list-row">
          <strong>Queue</strong>
          <span>{queueRemaining}</span>
        </article>
      </div>
      <details className="mobile-collapsible">
        <summary>View full analytics</summary>
        <AnalyticsPanel analytics={analytics} categoryColorMap={categoryColorMap} />
      </details>
    </div>
  );

  if (embedded) return content;
  return <section className="panel mobile-summary-panel">{content}</section>;
}

function GameRoomView({
  user,
  profile,
  game,
  rounds,
  bankQuestions,
  editingModeEnabled,
  onToggleEditingMode,
  role,
  seat,
  onLeaveGame,
  onEndGame,
  onPauseToggle,
  onNextQuestion,
  onSubmitAnswer,
  onAddQuestion,
  onSyncSheet,
  onImportSheet,
  onSignOut,
  confirmAction,
  onConfirmAction,
  onCancelAction,
  isBusy,
  currentRound,
  penaltyDraft,
  setPenaltyDraft,
  answerDraft,
  setAnswerDraft,
  bankDraft,
  setBankDraft,
  sheetInput,
  setSheetInput,
  syncNotice,
  bankCount,
  notice,
  chatMessages,
  chatDraft,
  setChatDraft,
  onSendChat,
  onSaveQuestionNote,
}) {
  const activePalette = PALETTES[loadThemeIndex() % PALETTES.length];
  const analytics = calculateAnalytics(rounds);
  const categoryOptions = useMemo(() => deriveCategories(bankQuestions, rounds, DEFAULT_CATEGORIES), [bankQuestions, rounds]);
  const categoryColorMap = useMemo(
    () => ({
      ...CATEGORY_COLOR_MAP,
      ...Object.fromEntries(categoryOptions.map((category) => [category.name, category.color])),
    }),
    [categoryOptions],
  );
  const currentQuestion = currentRound
    ? {
        question: currentRound.question,
        category: currentRound.category,
        roundType: currentRound.roundType,
      }
    : null;
  const boardForm = currentRound
    ? {
        question: currentRound.question,
        category: currentRound.category,
        roundType: currentRound.roundType,
        jayScore: penaltyDraft.jay,
        kimScore: penaltyDraft.kim,
      }
    : { question: '', category: '', roundType: 'numeric', jayScore: '', kimScore: '' };
  const baseTotals = game?.totals || { jay: 0, kim: 0 };
  const resolvedViewerSeat = seatForUid(game, user?.uid)
    || (seat === 'kim' ? 'kim' : seat === 'jay' ? 'jay' : null)
    || inferSeatFromUser(user, profile)
    || 'jay';
  const liveTotals = currentRound
    ? {
        jay: addScores(baseTotals.jay, parseNumber(penaltyDraft.jay || currentRound.penalties?.jay || 0, 0)),
        kim: addScores(baseTotals.kim, parseNumber(penaltyDraft.kim || currentRound.penalties?.kim || 0, 0)),
      }
    : baseTotals;
  const revealIsReady = currentRound?.status === 'reveal' && Boolean(currentRound?.answers?.jay?.ownAnswer && currentRound?.answers?.kim?.ownAnswer);
  const submissionState = currentRound?.answers?.[resolvedViewerSeat]?.ownAnswer ? 'submitted' : 'draft';
  const showActiveRoundFrame = Boolean(currentRound && (currentRound.status === 'open' || revealIsReady));
  const status = game?.status || 'active';
  const isMobile = useMediaQuery('(max-width: 900px)');
  const joinedPlayers = [
    game?.playerProfiles?.[game?.seats?.jay] || null,
    game?.playerProfiles?.[game?.seats?.kim] || null,
  ].filter(Boolean);
  const gameEnded = game?.status === 'ended' || game?.status === 'completed';
  const isEditingTestRoom = isLocalTestGame(game);
  const showTestModeBanner = editingModeEnabled || isEditingTestRoom;
  const testModeBannerCopy = isEditingTestRoom
    ? 'This room is local only. The other player auto-submits, and nothing here is saved to live history, analytics, forfeits, or player totals.'
    : 'Editing Mode is enabled. New Create Game sessions stay local, auto-submit the other player, and do not save live history, analytics, or totals.';
  const roomMenuRef = useRef(null);
  const scoreboardColumnRef = useRef(null);
  const [chatColumnHeight, setChatColumnHeight] = useState(0);
  const [noteModalRound, setNoteModalRound] = useState(null);
  const [questionNoteDraft, setQuestionNoteDraft] = useState('');

  useEffect(() => {
    if (isMobile) {
      setChatColumnHeight(0);
      return undefined;
    }

    const scoreboardNode = scoreboardColumnRef.current;
    if (!scoreboardNode) return undefined;

    const syncChatHeight = () => {
      const nextHeight = Math.round(scoreboardNode.getBoundingClientRect().height);
      setChatColumnHeight((currentHeight) => (Math.abs(currentHeight - nextHeight) <= 4 ? currentHeight : nextHeight));
    };

    syncChatHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(syncChatHeight);
      observer.observe(scoreboardNode);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', syncChatHeight);
    return () => window.removeEventListener('resize', syncChatHeight);
  }, [isMobile]);

  const closeRoomMenu = () => {
    roomMenuRef.current?.removeAttribute('open');
  };

  const handleToggleEditingModeFromRoomMenu = () => {
    closeRoomMenu();
    onToggleEditingMode();
  };

  const handleSignOutFromRoomMenu = () => {
    closeRoomMenu();
    onSignOut();
  };

  const renderRoomOverflowMenu = () => (
    <details className="top-menu settings-menu room-settings-menu" ref={roomMenuRef}>
      <summary aria-label="Open room actions">
        <span className="settings-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
            <path d="M5 7.5h14M5 12h14M5 16.5h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <span className="settings-label">More</span>
      </summary>
      <div className="top-menu-panel settings-menu-panel room-settings-menu-panel">
        <section className="settings-menu-section">
          <span className="settings-section-label">Room Actions</span>
          <Button className={`ghost-button compact editing-mode-toggle ${editingModeEnabled ? 'is-on' : ''}`} onClick={handleToggleEditingModeFromRoomMenu} disabled={isBusy}>
            {editingModeEnabled ? 'Editing Mode On' : 'Editing Mode Off'}
          </Button>
          <Button className="ghost-button compact" onClick={handleSignOutFromRoomMenu}>
            Sign out
          </Button>
        </section>
      </div>
    </details>
  );

  const openQuestionNoteModal = (round) => {
    if (!round) return;
    setNoteModalRound(round);
    setQuestionNoteDraft('');
  };

  const closeQuestionNoteModal = () => {
    setNoteModalRound(null);
    setQuestionNoteDraft('');
  };

  const goToDashboardTab = (tab = 'gameLobby') => {
    try {
      window.localStorage.setItem('kjk-dashboard-tab', tab);
    } catch {
      // Ignore storage failures.
    }
    onLeaveGame();
  };

  const renderMobileHostControls = () => {
    if (role !== 'host') return null;

    if (currentRound && revealIsReady) {
      return (
        <section className="mobile-entry-panel mobile-round-panel">
          <QuickDesk
            currentRound={currentRound}
            penaltyDraft={penaltyDraft}
            setPenaltyDraft={setPenaltyDraft}
            onNextQuestion={onNextQuestion}
            onPauseToggle={onPauseToggle}
            status={status}
            isPaused={status === 'paused'}
            isCompleted={status === 'completed'}
            isBusy={isBusy}
          />
        </section>
      );
    }

    if (showActiveRoundFrame) {
      return (
        <section className="mobile-entry-panel mobile-round-panel">
          <section className="panel room-status-panel room-status-panel--host-mobile">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Host</p>
                <h2>Controls</h2>
              </div>
            </div>
            <p className="panel-copy">
              {submissionState === 'submitted'
                ? 'Your answer is in. Waiting for the reveal.'
                : 'Players are answering inside the main board.'}
            </p>
            <div className="button-row room-host-sidebar-actions">
              <Button className="ghost-button compact" onClick={onPauseToggle} disabled={isBusy || status === 'completed'}>
                {status === 'paused' ? 'Resume' : 'Pause'}
              </Button>
              <span className="quick-desk-status">{currentRound ? `Round ${currentRound.number}` : 'Waiting'}</span>
            </div>
          </section>
        </section>
      );
    }

    return (
      <section className="mobile-entry-panel mobile-round-panel">
        <section className="panel room-status-panel room-status-panel--host-mobile">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Host</p>
              <h2>Controls</h2>
            </div>
          </div>
          <p className="panel-copy">Load the next question when you are ready.</p>
          <div className="button-row room-host-sidebar-actions">
            <Button className="primary-button compact next-question-button" onClick={onNextQuestion} disabled={isBusy || status === 'completed'}>
              Next Question
            </Button>
            <Button className="ghost-button compact" onClick={onPauseToggle} disabled={isBusy || status === 'completed'}>
              {status === 'paused' ? 'Resume' : 'Pause'}
            </Button>
          </div>
        </section>
      </section>
    );
  };

  if (isMobile) {
    return (
      <main className="app production-app mobile-app" style={{ '--accent': activePalette.accent, '--accent-2': activePalette.accent2, '--accent-3': activePalette.accent3, '--accent-glow': activePalette.glow, '--accent-wash': activePalette.wash }}>
      <header className="top-bar top-bar--room">
        <div className="top-bar-left">
          <div className="brand-lockup brand-lockup--left">
            <p className="eyebrow sponsor-tag">Game {game?.joinCode || '------'}</p>
            <h1>KJK KIMJAYKINKS</h1>
          </div>
          <div className="room-players-pill">
            <span>{joinedPlayers.map((player) => player.displayName || 'Player').join(' + ') || 'Waiting for players'}</span>
          </div>
        </div>
        <div className="top-actions top-actions--room">
          {showTestModeBanner ? <span className="status-pill status-pill--test-mode">TEST MODE</span> : null}
          {!gameEnded ? (
            <Button className="ghost-button compact room-end-game-button" onClick={onEndGame}>
              End Game
            </Button>
          ) : null}
          <Button className="ghost-button compact" onClick={onLeaveGame}>
            Leave
          </Button>
          {renderRoomOverflowMenu()}
        </div>
        </header>

        {showTestModeBanner ? (
          <section className="editing-mode-banner editing-mode-banner--room" role="status" aria-live="polite">
            <strong>TEST MODE / EDITING MODE</strong>
            <span>{testModeBannerCopy}</span>
          </section>
        ) : null}

        {gameEnded ? (
          <section className="mobile-game-shell">
            <section className="panel game-complete-panel">
              <GameSummaryContent
                gameSummary={{ ...game, rounds }}
                categoryColorMap={categoryColorMap}
                showActions
                onBackToLobby={() => goToDashboardTab('gameLobby')}
                onViewOverallAnalytics={() => goToDashboardTab('analytics')}
              />
            </section>
          </section>
        ) : (
          <section className="mobile-game-shell">
            <section className="mobile-board-panel">
              {showActiveRoundFrame ? (
                <RoomActiveFrame
                  game={game}
                  seat={resolvedViewerSeat}
                  viewerSeat={resolvedViewerSeat}
                  role={role}
                  status={status}
                  currentRound={currentRound}
                  baseTotals={baseTotals}
                  liveTotals={liveTotals}
                  answerDraft={answerDraft}
                  setAnswerDraft={setAnswerDraft}
                  onSubmitAnswer={onSubmitAnswer}
                  submissionState={submissionState}
                  revealIsReady={revealIsReady}
                  penaltyDraft={penaltyDraft}
                  setPenaltyDraft={setPenaltyDraft}
                  onNextQuestion={onNextQuestion}
                  onPauseToggle={onPauseToggle}
                  onOpenQuestionNote={openQuestionNoteModal}
                  isBusy={isBusy}
                />
              ) : (
                <MainScoreboard16x9 rounds={rounds} selectedQuestion={currentQuestion} form={boardForm} editingRound={null} liveTotals={liveTotals} joinedSeats={game?.seats || {}} />
              )}
            </section>

            {renderMobileHostControls()}

            <details className="panel mobile-collapsible mobile-collapsible--chat">
              <summary>Chat</summary>
              <ChatPanel
                compact
                messages={chatMessages}
                draft={chatDraft}
                onDraftChange={setChatDraft}
                onSend={onSendChat}
                isBusy={isBusy}
                seat={seat}
                displayName={profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player'}
              />
            </details>

            <details className="panel mobile-collapsible mobile-collapsible--analytics">
              <summary>Live Stats</summary>
              <MobileAnalyticsSummary
                analytics={analytics}
                queueRemaining={Math.max(0, bankCount - rounds.length)}
                categoryColorMap={categoryColorMap}
                embedded
              />
            </details>

            {role === 'host' ? (
              <details className="panel mobile-collapsible">
                <summary>Host tools</summary>
                <QuestionBankMini
                  questions={bankQuestions}
                  draft={bankDraft}
                  setDraft={setBankDraft}
                  onAddQuestion={onAddQuestion}
                  onSyncSheet={onSyncSheet}
                  onImportSheet={onImportSheet}
                  syncNotice={syncNotice}
                />
              </details>
            ) : null}
          </section>
        )}
        {notice ? <div className="toast">{notice}</div> : null}
      </main>
    );
  }

  return (
    <main className="app production-app" style={{ '--accent': activePalette.accent, '--accent-2': activePalette.accent2, '--accent-3': activePalette.accent3, '--accent-glow': activePalette.glow, '--accent-wash': activePalette.wash }}>
      <header className="top-bar top-bar--room">
        <div className="top-bar-left">
          <div className="brand-lockup brand-lockup--left">
            <p className="eyebrow sponsor-tag">Game {game?.joinCode || '------'}</p>
            <h1>KJK KIMJAYKINKS</h1>
          </div>
        </div>
        <div className="top-actions top-actions--room">
          <span className="status-pill">{roleLabel(role)}</span>
          <span className="status-pill">{status}</span>
          {showTestModeBanner ? <span className="status-pill status-pill--test-mode">TEST MODE</span> : null}
          {!gameEnded ? (
            <Button className="ghost-button compact room-end-game-button" onClick={onEndGame}>
              End Game
            </Button>
          ) : null}
          <Button className="ghost-button compact" onClick={onLeaveGame}>
            Leave
          </Button>
          {renderRoomOverflowMenu()}
        </div>
      </header>

      {showTestModeBanner ? (
        <section className="editing-mode-banner editing-mode-banner--room" role="status" aria-live="polite">
          <strong>TEST MODE / EDITING MODE</strong>
          <span>{testModeBannerCopy}</span>
        </section>
      ) : null}

      {gameEnded ? (
        <section className="game-complete-shell">
          <section className="panel game-complete-panel">
            <GameSummaryContent
              gameSummary={{ ...game, rounds }}
              categoryColorMap={categoryColorMap}
              showActions
              onBackToLobby={() => goToDashboardTab('gameLobby')}
              onViewOverallAnalytics={() => goToDashboardTab('analytics')}
            />
          </section>
        </section>
      ) : (
      <section className="game-grid">
        <section className="panel room-sidebar">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Players</p>
              <h2>Joined</h2>
            </div>
          </div>
          <div className="joined-player-list">
            <article className="mini-list-row">
              <strong>Jay</strong>
              <span>{game?.playerProfiles?.[game?.seats?.jay]?.displayName || 'Waiting'}</span>
            </article>
            <article className="mini-list-row">
              <strong>Kim</strong>
              <span>{game?.playerProfiles?.[game?.seats?.kim]?.displayName || 'Waiting'}</span>
            </article>
          </div>
          {role === 'host' ? (
            currentRound && revealIsReady ? (
              <QuickDesk
                currentRound={currentRound}
                penaltyDraft={penaltyDraft}
                setPenaltyDraft={setPenaltyDraft}
                onNextQuestion={onNextQuestion}
                onPauseToggle={onPauseToggle}
                status={status}
                isPaused={status === 'paused'}
                isCompleted={status === 'completed'}
                isBusy={isBusy}
              />
            ) : (
              <section className="panel host-queue-panel room-status-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Host</p>
                    <h2>Controls</h2>
                  </div>
                </div>
                <p className="panel-copy">
                  {!currentRound
                    ? 'Load the next question when you are ready.'
                    : 'Players are answering inside the main board.'}
                </p>
                <div className="button-row room-host-sidebar-actions">
                  {!currentRound ? (
                    <Button className="primary-button compact next-question-button" onClick={onNextQuestion} disabled={isBusy || status === 'completed'}>
                      Next Question
                    </Button>
                  ) : null}
                  <Button className="ghost-button compact" onClick={onPauseToggle} disabled={isBusy || status === 'completed'}>
                    {status === 'paused' ? 'Resume' : 'Pause'}
                  </Button>
                  <span className="quick-desk-status">{currentRound ? `Round ${currentRound.number}` : 'Waiting'}</span>
                </div>
              </section>
            )
          ) : (
            <section className="panel host-queue-panel room-status-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Room</p>
                  <h2>Status</h2>
                </div>
              </div>
              <p className="panel-copy">Waiting for the host to launch the next question.</p>
            </section>
          )}
        </section>

        <section className="scoreboard-column" ref={scoreboardColumnRef}>
          {showActiveRoundFrame ? (
            <RoomActiveFrame
              game={game}
              seat={resolvedViewerSeat}
              viewerSeat={resolvedViewerSeat}
              role={role}
              status={status}
              currentRound={currentRound}
              baseTotals={baseTotals}
              liveTotals={liveTotals}
              answerDraft={answerDraft}
              setAnswerDraft={setAnswerDraft}
              onSubmitAnswer={onSubmitAnswer}
              submissionState={submissionState}
              revealIsReady={revealIsReady}
              penaltyDraft={penaltyDraft}
              setPenaltyDraft={setPenaltyDraft}
              onNextQuestion={onNextQuestion}
              onPauseToggle={onPauseToggle}
              onOpenQuestionNote={openQuestionNoteModal}
              isBusy={isBusy}
            />
          ) : (
            <MainScoreboard16x9 rounds={rounds} selectedQuestion={currentQuestion} form={boardForm} editingRound={null} liveTotals={liveTotals} joinedSeats={game?.seats || {}} />
          )}
        </section>

        <section
          className="panel room-panel chat-column chat-column--locked"
          style={chatColumnHeight ? { '--chat-column-height': `${chatColumnHeight}px` } : undefined}
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Room</p>
              <h2>Chat</h2>
            </div>
          </div>

          <ChatPanel
            compact
            messages={chatMessages}
            draft={chatDraft}
            onDraftChange={setChatDraft}
            onSend={onSendChat}
            isBusy={isBusy}
            seat={seat}
            displayName={profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player'}
          />
        </section>
      </section>
      )}
      {noteModalRound ? (
        <section className="modal-backdrop" role="presentation" onClick={closeQuestionNoteModal}>
          <div className="panel modal-panel forfeit-modal" role="dialog" aria-modal="true" aria-label="Private question note" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">Private Note</p>
                <h3>Flagged Question Notebook</h3>
              </div>
            </div>
            <p className="panel-copy">{noteModalRound?.question || 'Question'}</p>
            <label className="field">
              <span>My private note</span>
              <textarea rows="4" value={questionNoteDraft} onChange={(event) => setQuestionNoteDraft(event.target.value)} placeholder="Write a private note for this question" />
            </label>
            <div className="button-row">
              <Button
                className="primary-button compact"
                onClick={async () => {
                  const saved = await onSaveQuestionNote?.({ round: noteModalRound, noteText: questionNoteDraft });
                  if (saved) closeQuestionNoteModal();
                }}
                disabled={isBusy || !normalizeText(questionNoteDraft)}
              >
                Save Note
              </Button>
              <Button className="ghost-button compact" onClick={closeQuestionNoteModal} disabled={isBusy}>
                Cancel
              </Button>
            </div>
          </div>
        </section>
      ) : null}
      {notice ? <div className="toast">{notice}</div> : null}
      <ConfirmModal action={confirmAction} onConfirm={onConfirmAction} onCancel={onCancelAction} />
    </main>
  );
}

function ProductionApp() {
  const [themeIndex, setThemeIndex] = useState(() => loadThemeIndex());
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState(defaultAuthForm);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [lobbyCode, setLobbyCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [lobbyQuestionCount, setLobbyQuestionCount] = useState('10');
  const [editingModeEnabled, setEditingModeEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(editingModeKey) === 'true';
    } catch {
      return false;
    }
  });
  const [gameId, setGameId] = useState(() => {
    try {
      if (window.matchMedia?.('(max-width: 900px)').matches) return '';
      const storedGameId = window.localStorage.getItem(activeGameKey) || '';
      return isLocalTestGameId(storedGameId) ? '' : storedGameId;
    } catch {
      return '';
    }
  });
  const [game, setGame] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [bankQuestions, setBankQuestions] = useState([]);
  const [gameLibrary, setGameLibrary] = useState([]);
  const [localArchivedGames, setLocalArchivedGames] = useState([]);
  const [pairHistory, setPairHistory] = useState({ playedQuestionIds: [], completedGameIds: [] });
  const [selectedGameId, setSelectedGameId] = useState('');
  const [localEndedGameSummary, setLocalEndedGameSummary] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [bankDraft, setBankDraft] = useState(defaultBankDraft);
  const [sheetInput, setSheetInput] = useState(DEFAULT_SETTINGS.googleSheetInput);
  const [syncNotice, setSyncNotice] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [roomLoadState, setRoomLoadState] = useState({ status: 'idle', gameId: '', reason: '', message: '' });
  const [playerAccounts, setPlayerAccounts] = useState({
    jay: { uid: fixedPlayerUids.jay, displayName: 'Jay', lifetimePenaltyPoints: 0 },
    kim: { uid: fixedPlayerUids.kim, displayName: 'Kim', lifetimePenaltyPoints: 0 },
  });
  const [redemptionItems, setRedemptionItems] = useState([]);
  const [redemptionHistory, setRedemptionHistory] = useState([]);
  const [forfeitPriceRequests, setForfeitPriceRequests] = useState([]);
  const [gameInvites, setGameInvites] = useState([]);
  const [amaRequests, setAmaRequests] = useState([]);
  const [diaryEntries, setDiaryEntries] = useState([]);
  const [questionNotes, setQuestionNotes] = useState([]);
  const [penaltyDraft, setPenaltyDraft] = useState(defaultPenaltyDraft);
  const [answerDraft, setAnswerDraft] = useState(defaultDraft);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState(defaultChatDraft);
  const [lobbyGameName, setLobbyGameName] = useState('');
  const isMobileDashboard = useMediaQuery('(max-width: 900px)');
  const leavePendingGameRef = useRef('');
  const autoSheetImportAttemptedRef = useRef(false);
  const roomLoadTimeoutRef = useRef(null);
  const amaStoreSeededRef = useRef({ jay: false, kim: false });
  const autoResumedGameIdRef = useRef(gameId || '');
  const staleCompletedRestoreRef = useRef(new Set());
  const isCurrentLocalTestGame = isLocalTestGame(game) || isLocalTestGameId(gameId);

  const clearRoomLoadTimer = () => {
    if (roomLoadTimeoutRef.current) {
      window.clearTimeout(roomLoadTimeoutRef.current);
      roomLoadTimeoutRef.current = null;
    }
  };

  const resetRoomLoadState = () => {
    clearRoomLoadTimer();
    setRoomLoadState({ status: 'idle', gameId: '', reason: '', message: '' });
  };

  const armRoomLoadTimeout = (nextGameId, reason = 'loading room') => {
    if (!nextGameId) return;
    clearRoomLoadTimer();
    debugRoom('armRoomLoadTimeout', { nextGameId, reason });
    setRoomLoadState({
      status: 'loading',
      gameId: nextGameId,
      reason,
      message: reason === 'opening game' ? 'Opening game…' : 'Loading room…',
    });
    roomLoadTimeoutRef.current = window.setTimeout(() => {
      setRoomLoadState((current) => {
        if (current.gameId !== nextGameId || current.status !== 'loading') return current;
        return {
          status: 'error',
          gameId: nextGameId,
          reason,
          message: 'The room did not finish loading. The live listener likely failed or the active game link is stale.',
        };
      });
    }, 7000);
  };

  const resolveRoomLoad = (nextGameId, source = 'snapshot') => {
    if (!nextGameId) return;
    debugRoom('resolveRoomLoad', { nextGameId, source });
    clearRoomLoadTimer();
    setRoomLoadState((current) => {
      if (current.gameId && current.gameId !== nextGameId) return current;
      return { status: 'idle', gameId: '', reason: '', message: '' };
    });
  };

  const failRoomLoad = (nextGameId, message, source = 'listener') => {
    debugRoom('failRoomLoad', { nextGameId, source, message });
    clearRoomLoadTimer();
    setRoomLoadState({
      status: 'error',
      gameId: nextGameId || '',
      reason: source,
      message: message || 'The room could not be loaded.',
    });
  };

  const clearPersistedActiveGame = (targetGameId = '') => {
    try {
      const storedGameId = window.localStorage.getItem(activeGameKey) || '';
      if (!targetGameId || storedGameId === targetGameId) {
        window.localStorage.removeItem(activeGameKey);
      }
    } catch {
      // Ignore storage failures.
    }
  };

  const clearCompletedGameProfiles = async (targetGameId, participantUids = []) => {
    if (!firestore || !targetGameId) return;
    const uniqueParticipantUids = mergeUniqueIds(participantUids).filter((uid) => uid && !isLocalTestGameId(uid));
    await Promise.all(
      uniqueParticipantUids.map(async (uid) => {
        const profileRef = doc(firestore, 'users', uid);
        const snapshot = await getDoc(profileRef).catch(() => null);
        if (!snapshot?.exists()) return;
        const activeGameId = snapshot.data()?.activeGameId || '';
        if (activeGameId !== targetGameId) return;
        await setDoc(
          profileRef,
          {
            uid,
            activeGameId: '',
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }),
    );
  };

  const dismissCompletedAutoResume = async (targetGame) => {
    if (!targetGame?.id) return;
    autoResumedGameIdRef.current = '';
    clearPersistedActiveGame(targetGame.id);
    resetRoomLoadState();
    setGameId((current) => (current === targetGame.id ? '' : current));
    setGame((current) => (current?.id === targetGame.id ? null : current));
    setRounds((current) => (targetGame.id === game?.id ? [] : current));
    setChatMessages((current) => (targetGame.id === game?.id ? [] : current));
    setProfile((current) => (current?.activeGameId === targetGame.id ? { ...current, activeGameId: '' } : current));
    await clearCompletedGameProfiles(targetGame.id, targetGame.playerUids || []);
  };

  useEffect(() => () => clearRoomLoadTimer(), []);

  const appStyle = useMemo(
    () => ({
      '--accent': PALETTES[themeIndex % PALETTES.length].accent,
      '--accent-2': PALETTES[themeIndex % PALETTES.length].accent2,
      '--accent-3': PALETTES[themeIndex % PALETTES.length].accent3,
      '--accent-glow': PALETTES[themeIndex % PALETTES.length].glow,
      '--accent-wash': PALETTES[themeIndex % PALETTES.length].wash,
    }),
    [themeIndex],
  );

  useEffect(() => {
    saveThemeIndex(themeIndex);
  }, [themeIndex]);

  useEffect(() => {
    try {
      if (editingModeEnabled) window.localStorage.setItem(editingModeKey, 'true');
      else window.localStorage.removeItem(editingModeKey);
    } catch {
      // Ignore storage failures.
    }
  }, [editingModeEnabled]);

  useEffect(() => {
    if (!firebaseAuth) {
      setAuthLoading(false);
      return undefined;
    }
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      debugRoom('authStateChanged', { uid: nextUser?.uid || '', email: nextUser?.email || '' });
      setUser(nextUser);
      setAuthLoading(false);
      if (nextUser && firestore) {
        const profileRef = doc(firestore, 'users', nextUser.uid);
        await setDoc(
          profileRef,
          {
            uid: nextUser.uid,
            displayName: nextUser.displayName || nextUser.email?.split('@')[0] || 'Player',
            email: nextUser.email || '',
            photoURL: nextUser.photoURL || '',
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        setProfile(null);
        autoResumedGameIdRef.current = '';
        setGameId('');
        localStorage.removeItem(activeGameKey);
        resetRoomLoadState();
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user || !firestore) return undefined;
    const profileRef = doc(firestore, 'users', user.uid);
    const unsubscribe = onSnapshot(profileRef, (snapshot) => {
      const data = snapshot.data() || null;
      debugRoom('profileSnapshot', { activeGameId: data?.activeGameId || '', uid: user.uid });
      setProfile(data);
      const activeGameFromProfile = data?.activeGameId || '';
      if (leavePendingGameRef.current && activeGameFromProfile === leavePendingGameRef.current) return;
      if (leavePendingGameRef.current && activeGameFromProfile !== leavePendingGameRef.current) {
        leavePendingGameRef.current = '';
      }
      if (isLocalTestGameId(gameId)) return;
      if (activeGameFromProfile && activeGameFromProfile !== gameId) {
        if (isMobileDashboard) {
          autoResumedGameIdRef.current = activeGameFromProfile;
          clearPersistedActiveGame(activeGameFromProfile);
          resetRoomLoadState();
          return;
        }
        autoResumedGameIdRef.current = activeGameFromProfile;
        setGameId(data.activeGameId);
        localStorage.setItem(activeGameKey, activeGameFromProfile);
      }
    }, (error) => {
      failRoomLoad(gameId, `Could not read your profile: ${error?.message || error}`, 'profile-listener');
    });
    return unsubscribe;
  }, [user, gameId, isMobileDashboard]);

  useEffect(() => {
    if (!user || !firestore) {
      setGameLibrary([]);
      return undefined;
    }
    const gamesRef = query(collection(firestore, 'games'), where('playerUids', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(gamesRef, async (snapshot) => {
      const summaries = await Promise.all(
        snapshot.docs.map(async (entry) => {
          const data = entry.data();
          const roundsSnap = await getDocs(query(collection(doc(firestore, 'games', entry.id), 'rounds'), orderBy('number', 'asc')));
          const roundsData = normalizeStoredRounds(roundsSnap.docs.map((roundEntry) => ({ id: roundEntry.id, ...roundEntry.data() })));
          return buildGameLibraryEntry(entry.id, data, roundsData);
        }),
      );
      if (!snapshot.empty) {
        summaries.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      }
      setGameLibrary(summaries.filter(Boolean));
    }, (error) => {
      debugRoom('gameLibrarySnapshotError', { message: error?.message || String(error) });
    });
    return unsubscribe;
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user) {
      setPairHistory({ playedQuestionIds: [], completedGameIds: [] });
      return undefined;
    }
    const pairRef = doc(firestore, 'playerPairs', buildPairKey());
    const unsubscribe = onSnapshot(
      pairRef,
      (snapshot) => {
        const data = snapshot.data() || {};
        setPairHistory({
          ...data,
          playedQuestionIds: Array.isArray(data.playedQuestionIds) ? data.playedQuestionIds.filter(Boolean) : [],
          completedGameIds: Array.isArray(data.completedGameIds) ? data.completedGameIds.filter(Boolean) : [],
        });
      },
      (error) => debugRoom('pairHistorySnapshotError', { message: error?.message || String(error) }),
    );
    return unsubscribe;
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user) return undefined;
    const playerRefs = {
      jay: doc(firestore, 'users', fixedPlayerUids.jay),
      kim: doc(firestore, 'users', fixedPlayerUids.kim),
    };
    const unsubscribers = Object.entries(playerRefs).map(([seat, playerRef]) =>
      onSnapshot(playerRef, (snapshot) => {
        const data = snapshot.data() || {};
        setPlayerAccounts((current) => ({
          ...current,
          [seat]: {
            uid: playerRef.id,
            displayName: data.displayName || PLAYER_LABEL[seat] || seat,
            lifetimePenaltyPoints: Number(data.lifetimePenaltyPoints || 0),
            updatedAt: data.updatedAt || null,
          },
        }));
      }, (error) => debugRoom('playerAccountSnapshotError', { seat, message: error?.message || String(error) })),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe && unsubscribe());
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user) {
      setRedemptionItems([]);
      return undefined;
    }
    const itemsRef = query(collection(firestore, 'redemptionItems'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(itemsRef, (snapshot) => {
      setRedemptionItems(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('redemptionItemsSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user) {
      setRedemptionHistory([]);
      return undefined;
    }
    const historyRef = query(collection(firestore, 'redemptionHistory'), orderBy('redeemedAt', 'desc'), limit(40));
    const unsubscribe = onSnapshot(historyRef, (snapshot) => {
      setRedemptionHistory(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('redemptionHistorySnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user) {
      setForfeitPriceRequests([]);
      return undefined;
    }
    const requestRef = query(collection(firestore, 'forfeitPriceRequests'), orderBy('requestedAt', 'desc'), limit(80));
    const unsubscribe = onSnapshot(requestRef, (snapshot) => {
      setForfeitPriceRequests(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('forfeitRequestsSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user) {
      setGameInvites([]);
      return undefined;
    }
    const inviteRef = query(collection(firestore, 'gameInvites'), orderBy('updatedAt', 'desc'), limit(80));
    const unsubscribe = onSnapshot(inviteRef, (snapshot) => {
      setGameInvites(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('gameInvitesSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user) {
      setAmaRequests([]);
      return undefined;
    }
    const amaRef = query(collection(firestore, 'amaRequests'), orderBy('updatedAt', 'desc'), limit(120));
    const unsubscribe = onSnapshot(amaRef, (snapshot) => {
      setAmaRequests(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('amaRequestsSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user) {
      setDiaryEntries([]);
      return undefined;
    }
    const diaryRef = query(collection(firestore, 'diaryEntries'), orderBy('updatedAt', 'desc'), limit(120));
    const unsubscribe = onSnapshot(diaryRef, (snapshot) => {
      setDiaryEntries(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('diaryEntriesSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user?.uid) {
      setQuestionNotes([]);
      return undefined;
    }
    const notesRef = query(collection(firestore, 'users', user.uid, 'questionNotes'), orderBy('updatedAt', 'desc'), limit(200));
    const unsubscribe = onSnapshot(
      notesRef,
      (snapshot) => setQuestionNotes(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))),
      (error) => debugRoom('questionNotesSnapshotError', { message: error?.message || String(error) }),
    );
    return unsubscribe;
  }, [user?.uid, firestore]);

  useEffect(() => {
    if (!user || !firestore) return undefined;
    const bankRef = collection(firestore, 'questionBank');
    const unsubscribe = onSnapshot(query(bankRef, orderBy('question', 'asc')), async (snapshot) => {
      if (snapshot.empty) {
        await seedBankIfNeeded();
        return;
      }
      setBankQuestions(snapshot.docs.map((entry) => normalizeStoredQuestion(entry.data(), entry.id)));
    }, (error) => debugRoom('bankSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (isLocalTestGameId(gameId)) {
      resolveRoomLoad(gameId, 'local test room');
      return undefined;
    }
    if (!gameId || !firestore) {
      setGame(null);
      setRounds([]);
      setChatMessages([]);
      return undefined;
    }
    const gameRef = doc(firestore, 'games', gameId);
    const roundsRef = query(collection(gameRef, 'rounds'), orderBy('number', 'asc'));
    const chatRef = query(collection(gameRef, 'chatMessages'), orderBy('createdAt', 'asc'), limit(60));
    const unsubscribeGame = onSnapshot(gameRef, (snapshot) => {
      debugRoom('gameSnapshot', { gameId, exists: snapshot.exists(), status: snapshot.exists() ? snapshot.data()?.status : 'missing' });
      setGame((current) => {
        if (snapshot.exists()) {
          resolveRoomLoad(snapshot.id, 'game snapshot');
          return { id: snapshot.id, ...snapshot.data() };
        }
        if (current?.id === snapshot.id || current?.id === gameId) return current;
        return null;
      });
    }, (error) => {
      failRoomLoad(gameId, `Could not load the game board: ${error?.message || error}`, 'game-listener');
    });
    const unsubscribeRounds = onSnapshot(roundsRef, (snapshot) => {
      setRounds(normalizeStoredRounds(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))));
    }, (error) => debugRoom('roundsSnapshotError', { gameId, message: error?.message || String(error) }));
    const unsubscribeChat = onSnapshot(chatRef, (snapshot) => {
      setChatMessages(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('chatSnapshotError', { gameId, message: error?.message || String(error) }));
    return () => {
      unsubscribeGame();
      unsubscribeRounds();
      unsubscribeChat();
    };
  }, [gameId]);

  useEffect(() => {
    if (!game?.id || !COMPLETED_GAME_STATUSES.includes(game.status) || autoResumedGameIdRef.current !== game.id) return undefined;
    if (staleCompletedRestoreRef.current.has(game.id)) return undefined;
    staleCompletedRestoreRef.current.add(game.id);
    dismissCompletedAutoResume(game)
      .then(() => {
        setNotice('The saved game had already finished, so the app returned to the lobby.');
      })
      .catch((error) => {
        console.warn('Could not dismiss completed auto-resumed game.', error);
      });
    return undefined;
  }, [game, gameId]);

  useEffect(() => {
    if (!isMobileDashboard || !autoResumedGameIdRef.current) return undefined;
    const resumedGameId = autoResumedGameIdRef.current;
    autoResumedGameIdRef.current = '';
    clearPersistedActiveGame(resumedGameId);
    setGameId((current) => (current === resumedGameId ? '' : current));
    setGame((current) => (current?.id === resumedGameId ? null : current));
    setRounds((current) => ((gameId === resumedGameId || game?.id === resumedGameId) ? [] : current));
    setChatMessages((current) => ((gameId === resumedGameId || game?.id === resumedGameId) ? [] : current));
    resetRoomLoadState();
    return undefined;
  }, [isMobileDashboard, gameId, game?.id]);

  useEffect(() => {
    if (!gameId || isLocalTestGameId(gameId)) {
      resetRoomLoadState();
      return;
    }
    if (roomLoadState.status !== 'loading' || roomLoadState.gameId !== gameId) {
      armRoomLoadTimeout(gameId, game ? 'syncing room' : 'loading room');
    }
  }, [gameId, game?.id, roomLoadState.gameId, roomLoadState.status]);

  useEffect(() => {
    if (!game?.currentRound) {
      setPenaltyDraft(defaultPenaltyDraft);
      setAnswerDraft(defaultDraft);
      return;
    }
    setPenaltyDraft({
      jay: normalizePenaltyDraftValue(game.currentRound.penalties?.jay),
      kim: normalizePenaltyDraftValue(game.currentRound.penalties?.kim),
    });
    const seat = seatForUid(game, user?.uid)
      || (game?.playerProfiles?.[user?.uid]?.seat === 'kim' ? 'kim' : game?.playerProfiles?.[user?.uid]?.seat === 'jay' ? 'jay' : null)
      || inferSeatFromUser(user, profile)
      || null;
    if (seat && game.currentRound.answers?.[seat]) {
      setAnswerDraft({
        ownAnswer: String(game.currentRound.answers[seat].ownAnswer ?? ''),
        guessedOther: String(game.currentRound.answers[seat].guessedOther ?? ''),
      });
    } else {
      setAnswerDraft(defaultDraft);
    }
  }, [game?.currentRound?.id, game?.id, game?.playerProfiles, user?.uid, user?.displayName, user?.email, profile?.displayName]);

  useEffect(() => {
    if (!gameId || !game) return;
    if (game.status === 'ended' || game.status === 'completed') {
      setNotice('Game summary ready.');
    }
  }, [gameId, game?.status, game?.id]);

  useEffect(() => {
    if (!firebaseIsConfigured) {
      setNotice('Firebase config is missing. Add your VITE_Firebase env vars before deploying.');
    }
  }, []);

  const currentUserRole = roleForUid(game, user?.uid);
  const currentSeat = seatForUid(game, user?.uid)
    || (game?.playerProfiles?.[user?.uid]?.seat === 'kim' ? 'kim' : game?.playerProfiles?.[user?.uid]?.seat === 'jay' ? 'jay' : null)
    || inferSeatFromUser(user, profile)
    || null;
  const inferredRole = currentUserRole || game?.playerProfiles?.[user?.uid]?.role || null;
  const inferredSeat = currentSeat;
  const shouldBypassMobileAutoResumeRoom = Boolean(isMobileDashboard && autoResumedGameIdRef.current);
  const dashboardSeat = inferSeatFromUser(user, profile);
  const currentPlayerStoreId = dashboardSeat ? playerIdForSeat(dashboardSeat) : user?.uid || '';
  const currentPlayerIdentityTokens = useMemo(
    () =>
      new Set(
        [
          user?.uid,
          profile?.displayName,
          user?.displayName,
          user?.email?.split('@')[0],
          dashboardSeat,
          currentPlayerStoreId,
          dashboardSeat ? PLAYER_LABEL[dashboardSeat] : '',
        ]
          .map(normalizeIdentity)
          .filter(Boolean),
      ),
    [currentPlayerStoreId, dashboardSeat, profile?.displayName, user?.displayName, user?.email, user?.uid],
  );
  const matchesCurrentPlayerIdentity = (value) => {
    const normalized = normalizeIdentity(value);
    if (!normalized) return false;
    return currentPlayerIdentityTokens.has(normalized) || (dashboardSeat ? seatFromPlayerRef(value) === dashboardSeat : false);
  };
  const canManageStoreForPlayer = (playerRef) => {
    const ownerSeat = seatFromPlayerRef(playerRef);
    if (ownerSeat && dashboardSeat) return ownerSeat === dashboardSeat;
    return matchesCurrentPlayerIdentity(playerRef);
  };
  const currentPlayerLifetimeLabel = dashboardSeat
    ? `${PLAYER_LABEL[dashboardSeat] || dashboardSeat}: ${formatScore(Number(playerAccounts?.[dashboardSeat]?.lifetimePenaltyPoints || 0))} penalty points`
    : '';
  const incomingGameInvites = useMemo(
    () =>
      gameInvites
        .filter((invite) => matchesCurrentPlayerIdentity(invite.invitedForUserId) && invite.invitedByUserId !== user?.uid)
        .filter((invite) => (invite.status || 'pending') !== 'dismissed')
        .map((invite) => {
          const linkedGame =
            (game?.id === invite.gameId ? game : null)
            || gameLibrary.find((entry) => entry.id === invite.gameId)
            || null;
          let displayStatus = invite.status || 'pending';
          if (displayStatus === 'pending' && linkedGame && !isGameSessionJoinable(linkedGame)) {
            displayStatus = 'expired';
          }
          return {
            ...invite,
            roomCode: invite.roomCode || invite.joinCode || '',
            displayStatus,
          };
        })
        .filter((invite) => ['pending', 'expired'].includes(invite.displayStatus))
        .sort(sortByNewest),
    [gameInvites, matchesCurrentPlayerIdentity, user?.uid, game?.id, game, gameLibrary],
  );
  const pendingIncomingGameInvites = useMemo(
    () => incomingGameInvites.filter((invite) => invite.displayStatus === 'pending'),
    [incomingGameInvites],
  );
  const pendingRedemptions = useMemo(
    () => redemptionHistory.filter((entry) => matchesCurrentPlayerIdentity(entry.notifyUserId) && entry.status !== 'completed'),
    [matchesCurrentPlayerIdentity, redemptionHistory],
  );
  const pendingForfeitRequestAlerts = useMemo(
    () =>
      forfeitPriceRequests.filter(
        (request) => matchesCurrentPlayerIdentity(request.requestedFromUserId) && request.status === 'pending' && request.requestNotificationSeen === false,
      ),
    [forfeitPriceRequests, matchesCurrentPlayerIdentity],
  );
  const pendingForfeitResponseAlerts = useMemo(
    () =>
      forfeitPriceRequests.filter(
        (request) =>
          matchesCurrentPlayerIdentity(request.requestedByUserId) &&
          request.status !== 'pending' &&
          request.responseNotificationSeen === false,
      ),
    [forfeitPriceRequests, matchesCurrentPlayerIdentity],
  );
  const pendingAmaInbox = useMemo(
    () =>
      amaRequests.filter(
        (request) =>
          matchesCurrentPlayerIdentity(request.storeOwnerUserId || request.requestedFromUserId || request.ownerPlayerId) && ['question_pending', 'questioned'].includes(request.status),
      ),
    [amaRequests, matchesCurrentPlayerIdentity],
  );
  const pendingAmaOutbox = useMemo(
    () =>
      amaRequests.filter(
        (request) =>
          matchesCurrentPlayerIdentity(request.requestedByUserId) && ['question_pending', 'questioned', 'answered', 'completed'].includes(request.status),
      ),
    [amaRequests, matchesCurrentPlayerIdentity],
  );
  const pendingAmaQuestions = useMemo(
    () =>
      amaRequests.filter(
        (request) =>
          matchesCurrentPlayerIdentity(request.storeOwnerUserId || request.requestedFromUserId || request.ownerPlayerId) &&
          ['questioned', 'question_pending'].includes(request.status) &&
          request.answerNotificationSeen === false,
      ),
    [amaRequests, matchesCurrentPlayerIdentity],
  );
  const sentAmaQuestions = useMemo(
    () =>
      amaRequests.filter(
        (request) =>
          matchesCurrentPlayerIdentity(request.requestedByUserId) &&
          ['question_pending', 'questioned', 'answered', 'completed'].includes(request.status),
      ),
    [amaRequests, matchesCurrentPlayerIdentity],
  );
  const currentRound = game?.currentRound || null;
  const activeGames = gameLibrary.filter((entry) => ['opening', 'active', 'paused'].includes(entry.status));
  const persistedPreviousGames = gameLibrary.filter((entry) => entry.status === 'completed' || entry.status === 'ended');
  const previousGames = useMemo(() => {
    const mergedById = new Map();
    [...localArchivedGames, ...persistedPreviousGames].forEach((entry) => {
      if (entry?.id && !mergedById.has(entry.id)) mergedById.set(entry.id, entry);
    });
    return [...mergedById.values()].sort(
      (left, right) => getRecordTime(right?.endedAt || right?.createdAt || 0) - getRecordTime(left?.endedAt || left?.createdAt || 0),
    );
  }, [localArchivedGames, persistedPreviousGames]);
  const completedGameAuditRef = useRef(new Set());
  const selectedGameSummary = gameLibrary.find((entry) => entry.id === selectedGameId) || null;
  const selectedLocalGameSummary = localArchivedGames.find((entry) => entry.id === selectedGameId) || null;
  const activeSummaryModal = selectedGameSummary || selectedLocalGameSummary || localEndedGameSummary;
  const lobbyRounds = useMemo(() => gameLibrary.flatMap((entry) => entry.rounds || []), [gameLibrary]);
  const lobbyCategoryOptions = useMemo(
    () => deriveCategories(bankQuestions, lobbyRounds, DEFAULT_CATEGORIES).map((category) => category.name).filter(Boolean),
    [bankQuestions, lobbyRounds],
  );
  const analytics = useMemo(() => calculateAnalytics(rounds), [rounds]);
  const lobbyRoundAnalytics = useMemo(() => calculateAnalytics(lobbyRounds), [lobbyRounds]);
  const bankCount = bankQuestions.length;
  const trackedGameEntries = useMemo(() => {
    if (!game?.id || isLocalTestGame(game)) return gameLibrary;
    const currentGameSummary = {
      ...game,
      rounds: rounds.length ? rounds : game.rounds || [],
      usedQuestionIds: mergeUniqueIds(
        game.usedQuestionIds || [],
        (rounds || []).map((round) => round.questionId),
      ),
    };
    const nextEntries = [...gameLibrary];
    const existingIndex = nextEntries.findIndex((entry) => entry.id === game.id);
    if (existingIndex >= 0) nextEntries[existingIndex] = { ...nextEntries[existingIndex], ...currentGameSummary };
    else nextEntries.push(currentGameSummary);
    return nextEntries;
  }, [gameLibrary, game, rounds]);
  const bankQuestionIds = useMemo(
    () => new Set(bankQuestions.map((question) => question.id).filter(Boolean)),
    [bankQuestions],
  );
  const reservedQuestionIds = useMemo(
    () =>
      new Set(
        mergeUniqueIds(
          ...trackedGameEntries
            .filter((entry) => ACTIVE_GAME_STATUSES.includes(entry?.status))
            .map((entry) =>
              mergeUniqueIds(
                entry?.currentRound?.questionId ? [entry.currentRound.questionId] : [],
                entry?.questionQueueIds || [],
              ),
            ),
        ).filter((questionId) => bankQuestionIds.has(questionId)),
      ),
    [trackedGameEntries, bankQuestionIds],
  );
  const trackedUsedQuestionIds = useMemo(
    () => {
      const trackedIds = mergeUniqueIds(...trackedGameEntries.map((entry) => getPlayedQuestionIdsForGame(entry)));
      if (!bankQuestionIds.size) return new Set(trackedIds);
      return new Set(trackedIds.filter((questionId) => bankQuestionIds.has(questionId)));
    },
    [trackedGameEntries, bankQuestionIds],
  );
  const usedQuestionCount = trackedUsedQuestionIds.size;
  const remainingQuestionCount = Math.max(0, bankCount - usedQuestionCount);
  const usedQuestionIds = useMemo(() => new Set(rounds.map((round) => round.questionId).filter(Boolean)), [rounds]);
  const availableQuestions = useMemo(() => {
    const bank = bankQuestions.filter(
      (question) =>
        !trackedUsedQuestionIds.has(question.id)
        && !usedQuestionIds.has(question.id)
        && !reservedQuestionIds.has(question.id),
    );
    return bank.length ? bank : bankQuestions.length ? [] : STARTER_QUESTIONS.map((question) => createQuestionTemplate(question));
  }, [bankQuestions, trackedUsedQuestionIds, usedQuestionIds, reservedQuestionIds]);
  const lastQuestionId = currentRound?.questionId || rounds.at(-1)?.questionId || null;
  const globalUsedQuestionIds = useMemo(
    () => new Set(trackedUsedQuestionIds),
    [trackedUsedQuestionIds],
  );
  const unusedQuestionCount = Math.max(0, bankCount - globalUsedQuestionIds.size);
  const previousCompletedGames = persistedPreviousGames.filter((entry) => entry.status === 'completed' || entry.status === 'ended');
  useEffect(() => {
    previousGames.forEach((entry) => {
      if (!entry?.id || completedGameAuditRef.current.has(entry.id)) return;
      console.log('completed game question audit', {
        gameId: entry.id,
        selectedQuestionsLength: Number(entry.selectedQuestionsLength || 0),
        answeredRoundsLength: Number(entry.answeredRoundsLength || 0),
        roundHistoryLength: Number(entry.roundHistoryLength || 0),
        usedQuestionIdsLength: Array.isArray(entry.usedQuestionIds) ? mergeUniqueIds(entry.usedQuestionIds).length : 0,
        currentQuestionIndex: entry.currentQuestionIndex ?? null,
        displayedQuestionCount: getCompletedGameDisplayCount(entry),
      });
      completedGameAuditRef.current.add(entry.id);
    });
  }, [previousGames]);
  const pendingActivityCount = useMemo(() => {
    const pendingGameTasks = activeGames.filter((game) => {
      const seat = game?.seats?.jay === user?.uid ? 'jay' : game?.seats?.kim === user?.uid ? 'kim' : null;
      const openAnswers = new Set(game?.currentRoundAnswerSeats || []);
      return Boolean(seat) && game?.currentRoundStatus === 'open' && !openAnswers.has(seat);
    }).length;
    return (
      pendingIncomingGameInvites.length +
      pendingRedemptions.length +
      pendingForfeitRequestAlerts.length +
      pendingForfeitResponseAlerts.length +
      pendingAmaInbox.length +
      pendingAmaOutbox.length +
      pendingGameTasks
    );
  }, [
    activeGames,
    pendingIncomingGameInvites.length,
    pendingRedemptions,
    pendingForfeitRequestAlerts,
    pendingForfeitResponseAlerts,
    pendingAmaInbox,
    pendingAmaOutbox,
    user?.uid,
  ]);
  const amaDiaryEntries = useMemo(
    () => diaryEntries.filter((entry) => isAmaDiaryEntry(entry)).sort(sortByOldest),
    [diaryEntries],
  );
  const nextAmaChapterNumber = useMemo(
    () =>
      amaDiaryEntries.reduce(
        (highest, entry, index) => Math.max(highest, Number(entry.chapterNumber || index + 1) || 0),
        0,
      ) + 1,
    [amaDiaryEntries],
  );

  const buildQuestionQueue = async (requestedCount = 10, filters = {}) => {
    const bankSnapshot = await getDocs(collection(firestore, 'questionBank'));
    const questionBankPool = bankSnapshot.empty
      ? STARTER_QUESTIONS.map((question) => createQuestionTemplate(question))
      : bankSnapshot.docs.map((entry) => normalizeStoredQuestion(entry.data(), entry.id));
    const unavailableQuestionIds = new Set(mergeUniqueIds([...trackedUsedQuestionIds], [...reservedQuestionIds], [lastQuestionId]));
    const typeSet = new Set((filters.roundTypes || []).filter(Boolean));
    const categorySet = new Set((filters.categories || []).map((category) => normalizeText(category)).filter(Boolean));
    const eligible = dedupeQuestionsById(questionBankPool).filter((question) => {
      if (unavailableQuestionIds.has(question.id)) return false;
      if (typeSet.size && !typeSet.has(question.roundType)) return false;
      if (categorySet.size && !categorySet.has(normalizeText(question.category))) return false;
      return true;
    });
    const safeRequestedCount = Math.max(1, Number.parseInt(requestedCount, 10) || 10);
    const unusedEligible = eligible.filter((question) => !trackedUsedQuestionIds.has(question.id));
    const selectedUnused = pickDiverseQuestions(unusedEligible, Math.min(safeRequestedCount, unusedEligible.length));
    const selectedUnusedIds = new Set(selectedUnused.map((question) => question.id));
    const fallbackEligible = eligible.filter((question) => !selectedUnusedIds.has(question.id));
    const selectedFallback = selectedUnused.length < safeRequestedCount
      ? pickDiverseQuestions(fallbackEligible, safeRequestedCount - selectedUnused.length)
      : [];
    const queue = [...selectedUnused, ...selectedFallback].slice(0, safeRequestedCount);
    debugRoom('buildQuestionQueue', {
      requestedCount: safeRequestedCount,
      totalQuestions: questionBankPool.length,
      usedQuestionCount: trackedUsedQuestionIds.size,
      availableUnusedCount: unusedEligible.length,
      selectedQuestionIds: queue.map((question) => question.id),
    });
    return {
      queue,
      requestedCount: safeRequestedCount,
      actualCount: queue.length,
      warning:
        queue.length < safeRequestedCount
          ? queue.length
            ? `Only ${queue.length} unique questions are available for this player pair.`
            : 'No unused questions remain for this player pair.'
          : '',
    };
  };

  const findGamesByJoinCode = async (candidate) => {
    const code = normalizeJoinCode(candidate);
    if (!code || !firestore) return [];

    const [joinCodeSnap, codeSnap, roomCodeSnap] = await Promise.all([
      getDocs(query(collection(firestore, 'games'), where('joinCode', '==', code))),
      getDocs(query(collection(firestore, 'games'), where('code', '==', code))),
      getDocs(query(collection(firestore, 'games'), where('roomCode', '==', code))),
    ]);

    const merged = new Map();
    [joinCodeSnap, codeSnap, roomCodeSnap].forEach((snapshot) => {
      snapshot.docs.forEach((entry) => {
        if (!merged.has(entry.id)) merged.set(entry.id, { id: entry.id, ...entry.data() });
      });
    });

    return [...merged.values()]
      .filter((entry) => gameRoomCodeForLookup(entry) === code)
      .sort(sortByNewestGameSession);
  };

  const findJoinableGameByCode = async (candidate) => {
    const sessions = await findGamesByJoinCode(candidate);
    return sessions.find((entry) => isGameSessionJoinable(entry)) || null;
  };

  const isJoinCodeTaken = async (candidate) => {
    const activeGame = await findJoinableGameByCode(candidate);
    return Boolean(activeGame);
  };

  const makeUniqueJoinCode = async (seed) => {
    const normalizedSeed = normalizeJoinCode(seed);
    if (normalizedSeed) {
      if (await isJoinCodeTaken(normalizedSeed)) {
        throw new Error('That room code is already in use by an active game.');
      }
      return normalizedSeed;
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = makeJoinCode();
      if (!(await isJoinCodeTaken(candidate))) return candidate;
    }

    throw new Error('Could not generate an available room code.');
  };

  const setGameInviteStatus = async (inviteId, patch = {}) => {
    if (!firestore || !inviteId) return;
    await setDoc(
      doc(firestore, 'gameInvites', inviteId),
      {
        ...patch,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const expirePendingGameInvitesForGame = async (targetGameId, gameStatus = 'completed') => {
    if (!firestore || !targetGameId) return;
    const invitesSnap = await getDocs(query(collection(firestore, 'gameInvites'), where('gameId', '==', targetGameId)));
    if (invitesSnap.empty) return;
    const batch = writeBatch(firestore);
    let hasWrites = false;
    invitesSnap.docs.forEach((entry) => {
      const data = entry.data() || {};
      if ((data.status || 'pending') !== 'pending') return;
      batch.set(entry.ref, {
        status: 'expired',
        gameStatus,
        expiredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      hasWrites = true;
    });
    if (hasWrites) await batch.commit();
  };

  const sendGameInviteForSession = async ({ targetGameId, targetUserId, targetSeat = '', sourceGame = null }) => {
    if (!firestore || !user || !targetGameId || !targetUserId) throw new Error('Could not send the game invite.');
    if (targetUserId === user.uid) throw new Error('Choose the other player for the invite.');
    const baseGame = sourceGame || (game?.id === targetGameId ? game : null) || gameLibrary.find((entry) => entry.id === targetGameId) || null;
    const hostSeat = seatForUid(baseGame, user.uid) || preferredSeatForUser(user, profile);
    const inviteSeat = targetSeat || oppositeSeatOf(hostSeat);
    const inviteRef = doc(firestore, 'gameInvites', buildGameInviteId(targetGameId, targetUserId));
    await setDoc(
      inviteRef,
      {
        inviteId: inviteRef.id,
        gameId: targetGameId,
        roomCode: gameRoomCodeForLookup(baseGame) || normalizeJoinCode(baseGame?.joinCode || baseGame?.code || ''),
        joinCode: gameRoomCodeForLookup(baseGame) || normalizeJoinCode(baseGame?.joinCode || baseGame?.code || ''),
        gameName: baseGame?.gameName || baseGame?.name || `Game ${gameRoomCodeForLookup(baseGame) || targetGameId}`,
        invitedByUserId: user.uid,
        invitedByDisplayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || gameSeatDisplayName(baseGame, hostSeat),
        invitedBySeat: hostSeat,
        invitedForUserId: targetUserId,
        invitedForSeat: inviteSeat,
        requestedQuestionCount: Number(baseGame?.requestedQuestionCount || 0),
        actualQuestionCount: Number(baseGame?.actualQuestionCount || getGameQuestionGoal(baseGame) || 0),
        gameStatus: baseGame?.status || 'active',
        status: 'pending',
        acceptedAt: null,
        expiredAt: null,
        joinedByUserId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return inviteRef.id;
  };

  const lobbyAnalytics = useMemo(() => {
    const completed = previousCompletedGames;
    const wins = completed.reduce(
      (acc, gameEntry) => {
        if (gameEntry.winner === 'jay') acc.jay += 1;
        else if (gameEntry.winner === 'kim') acc.kim += 1;
        else acc.draws += 1;
        return acc;
      },
      { jay: 0, kim: 0, draws: 0 },
    );
    const completedFinals = completed.map((gameEntry) => gameEntry.finalScores || gameEntry.totals || { jay: 0, kim: 0 });
    const averageFinalJay = completedFinals.length ? completedFinals.reduce((sum, scores) => sum + Number(scores.jay || 0), 0) / completedFinals.length : 0;
    const averageFinalKim = completedFinals.length ? completedFinals.reduce((sum, scores) => sum + Number(scores.kim || 0), 0) / completedFinals.length : 0;
    const completedRedemptions = redemptionHistory.filter((entry) => ['redeemed', 'seen', 'completed'].includes(entry.status));
    const redemptionSpent = completedRedemptions.reduce(
      (acc, entry) => {
        const spentSeat = entry.pointsDeductedFromPlayerId === fixedPlayerUids.jay ? 'jay' : entry.pointsDeductedFromPlayerId === fixedPlayerUids.kim ? 'kim' : null;
        const itemCost = Number(entry.itemCost || entry.cost || 0);
        if (spentSeat) acc[spentSeat] += itemCost;
        acc.total += 1;
        if (!acc.expensive || itemCost > acc.expensive.cost) {
          acc.expensive = {
            title: entry.itemTitle || entry.title || 'Forfeit',
            cost: itemCost,
            storeOwner: entry.storeOwnerPlayerId === fixedPlayerUids.jay ? 'jay' : 'kim',
          };
        }
        const itemKey = `${entry.storeOwnerPlayerId || 'unknown'}::${entry.itemId || entry.itemTitle || 'item'}`;
        const currentItem = acc.items.get(itemKey) || {
          title: entry.itemTitle || entry.title || 'Forfeit',
          count: 0,
          cost: itemCost,
          storeOwner: entry.storeOwnerPlayerId === fixedPlayerUids.jay ? 'jay' : 'kim',
        };
        currentItem.count += 1;
        currentItem.cost = Math.max(currentItem.cost, itemCost);
        acc.items.set(itemKey, currentItem);
        return acc;
      },
      { jay: 0, kim: 0, total: 0, expensive: null, items: new Map() },
    );
    const mostRedeemedItem = [...redemptionSpent.items.values()].sort((a, b) => b.count - a.count || b.cost - a.cost)[0] || null;
    const currentBalanceJay = Number(playerAccounts?.jay?.lifetimePenaltyPoints || 0);
    const currentBalanceKim = Number(playerAccounts?.kim?.lifetimePenaltyPoints || 0);
    const sortedCompleted = [...completed].sort((a, b) => (new Date(a.endedAt || a.createdAt || 0).getTime() - new Date(b.endedAt || b.createdAt || 0).getTime()));
    let streakWinner = 'tie';
    let streakCount = 0;
    sortedCompleted
      .slice()
      .reverse()
      .forEach((entry) => {
        if (streakCount === 0) {
          streakWinner = entry.winner || 'tie';
          streakCount = 1;
          return;
        }
        if (entry.winner === streakWinner) {
          streakCount += 1;
        }
      });
    let longestStreak = { winner: 'tie', count: 0 };
    let activeStreak = { winner: 'tie', count: 0 };
    sortedCompleted.forEach((entry) => {
      if (entry.winner === activeStreak.winner) activeStreak.count += 1;
      else activeStreak = { winner: entry.winner, count: 1 };
      if (activeStreak.winner !== 'tie' && activeStreak.count > longestStreak.count) longestStreak = { ...activeStreak };
    });
    return {
      totalGamesPlayed: completed.length,
      activeGames: activeGames.length,
      previousGames: previousGames.length,
      totalRoundsPlayed: lobbyRounds.length,
      totalQuestionsUsed: globalUsedQuestionIds.size,
      jayGameWins: wins.jay,
      kimGameWins: wins.kim,
      draws: wins.draws,
      jayWinPercent: completed.length ? ((wins.jay / completed.length) * 100).toFixed(1) : '0.0',
      kimWinPercent: completed.length ? ((wins.kim / completed.length) * 100).toFixed(1) : '0.0',
      averageFinalJay,
      averageFinalKim,
      jayRoundWins: lobbyRoundAnalytics.roundWins?.jay || 0,
      kimRoundWins: lobbyRoundAnalytics.roundWins?.kim || 0,
      roundWinPercent: {
        jay: lobbyRounds.length ? ((lobbyRoundAnalytics.roundWins?.jay || 0) / lobbyRounds.length) * 100 : 0,
        kim: lobbyRounds.length ? ((lobbyRoundAnalytics.roundWins?.kim || 0) / lobbyRounds.length) * 100 : 0,
      },
      closestGame: completed.slice().sort((a, b) => Math.abs((a.finalScores?.jay || 0) - (a.finalScores?.kim || 0)) - Math.abs((b.finalScores?.jay || 0) - (b.finalScores?.kim || 0)))[0] || null,
      biggestWinMargin: completed.slice().sort((a, b) => Math.abs((b.finalScores?.jay || 0) - (b.finalScores?.kim || 0)) - Math.abs((a.finalScores?.jay || 0) - (a.finalScores?.kim || 0)))[0] || null,
      currentStreakLabel: streakCount ? `${PLAYER_LABEL[streakWinner] || streakWinner} x${streakCount}` : 'No streak',
      strongestCategoryJay: lobbyRoundAnalytics.bestCategory?.jay || '-',
      strongestCategoryKim: lobbyRoundAnalytics.bestCategory?.kim || '-',
      weakestCategoryJay: lobbyRoundAnalytics.worstCategory?.jay || '-',
      weakestCategoryKim: lobbyRoundAnalytics.worstCategory?.kim || '-',
      mostPlayedCategory: lobbyRoundAnalytics.mostCommonCategory || '-',
      lifetimeJayBalance: currentBalanceJay,
      lifetimeKimBalance: currentBalanceKim,
      totalRedemptions: redemptionSpent.total,
      pointsSpentAgainstJay: redemptionSpent.jay,
      pointsSpentAgainstKim: redemptionSpent.kim,
      mostExpensiveRedemptionLabel: redemptionSpent.expensive ? `${redemptionSpent.expensive.title} · ${formatScore(redemptionSpent.expensive.cost)}` : 'N/A',
      mostRedeemedItemLabel: mostRedeemedItem ? `${mostRedeemedItem.title} x${mostRedeemedItem.count}` : 'N/A',
      closestGameLabel: completed.length
        ? `${completed.slice().sort((a, b) => Math.abs((a.finalScores?.jay || 0) - (a.finalScores?.kim || 0)) - Math.abs((b.finalScores?.jay || 0) - (b.finalScores?.kim || 0)))[0]?.gameName || completed[0]?.joinCode || 'N/A'}`
        : 'N/A',
      biggestWinMarginLabel: completed.length
        ? `${completed.slice().sort((a, b) => Math.abs((b.finalScores?.jay || 0) - (b.finalScores?.kim || 0)) - Math.abs((a.finalScores?.jay || 0) - (a.finalScores?.kim || 0)))[0]?.gameName || completed[0]?.joinCode || 'N/A'}`
        : 'N/A',
      longestStreakLabel: longestStreak.count ? `${PLAYER_LABEL[longestStreak.winner] || longestStreak.winner} x${longestStreak.count}` : 'No streak',
    };
  }, [
    gameLibrary,
    activeGames,
    previousGames,
    lobbyRounds,
    lobbyRoundAnalytics,
    globalUsedQuestionIds,
    previousCompletedGames,
    redemptionHistory,
    playerAccounts,
  ]);

  const archivePairHistory = async (gameDoc, endedGameId = gameDoc?.id) => {
    if (!firestore || !gameDoc) return;
    const pairRef = doc(firestore, 'playerPairs', gameDoc.pairId || buildPairKey());
    const playedQuestionIds = getPlayedQuestionIdsForGame(gameDoc);
    const roundsPlayed = Number(gameDoc.roundsPlayed || gameDoc.rounds?.length || 0);
    const finalScores = gameDoc.finalScores || gameDoc.totals || { jay: 0, kim: 0 };
    const winner = gameDoc.winner || (Number(finalScores.jay || 0) === Number(finalScores.kim || 0) ? 'tie' : Number(finalScores.jay || 0) < Number(finalScores.kim || 0) ? 'jay' : 'kim');
    await setDoc(
      pairRef,
      {
        pairId: gameDoc.pairId || buildPairKey(),
        playerUids: [fixedPlayerUids.jay, fixedPlayerUids.kim],
        playedQuestionIds: arrayUnion(...playedQuestionIds),
        completedGameIds: arrayUnion(endedGameId),
        updatedAt: serverTimestamp(),
        stats: {
          completedGames: Number(gameDoc.status === 'ended' || gameDoc.status === 'completed' ? 1 : 0),
          lastWinner: winner,
          lastFinalScores: finalScores,
          roundsPlayed,
        },
      },
      { merge: true },
    );
  };

  const loadGameSummaryById = async (targetGameId, fallbackData = null) => {
    if (!firestore || !targetGameId) return null;
    const gameRef = doc(firestore, 'games', targetGameId);
    const sourceData = fallbackData || (await getDoc(gameRef)).data();
    if (!sourceData) return null;
    const roundsSnap = await getDocs(query(collection(gameRef, 'rounds'), orderBy('number', 'asc')));
    const roundsData = normalizeStoredRounds(roundsSnap.docs.map((roundEntry) => ({ id: roundEntry.id, ...roundEntry.data() })));
    return buildGameLibraryEntry(targetGameId, sourceData, roundsData);
  };

  const promoteEndedGameToCompleted = (gameSummary) => {
    if (!gameSummary?.id) return;
    setGameLibrary((current) => upsertGameLibraryEntry(current, gameSummary));
    setSelectedGameId(gameSummary.id);
    setLocalEndedGameSummary(gameSummary);
  };

  const finalizeGameLifecycle = async (targetGameId, endedByUid = user?.uid || '', finalStatus = 'ended', options = {}) => {
    if (!firestore || !targetGameId) return null;
    const pendingRoundPenaltyOverride = options.pendingRoundPenaltyOverride || null;
    const gameRef = doc(firestore, 'games', targetGameId);
    const jayRef = doc(firestore, 'users', fixedPlayerUids.jay);
    const kimRef = doc(firestore, 'users', fixedPlayerUids.kim);
    const snapshot = await getDoc(gameRef);
    if (!snapshot.exists()) throw new Error('Game not found.');
    const gameDoc = { id: snapshot.id, ...snapshot.data() };
    const loadedSummary = gameLibrary.find((entry) => entry.id === targetGameId) || null;
    let nextFinalScores = gameDoc.totals || gameDoc.finalScores || { jay: 0, kim: 0 };
    let nextWinner = Number(nextFinalScores.jay || 0) === Number(nextFinalScores.kim || 0) ? 'tie' : Number(nextFinalScores.jay || 0) < Number(nextFinalScores.kim || 0) ? 'jay' : 'kim';
    let appliedLifetimePoints = false;
    const pendingRound = gameDoc.currentRound || null;
    const effectivePendingRound = pendingRound
      ? {
          ...pendingRound,
          penalties: {
            jay: pendingRoundPenaltyOverride?.jay ?? pendingRound.penalties?.jay ?? '',
            kim: pendingRoundPenaltyOverride?.kim ?? pendingRound.penalties?.kim ?? '',
          },
        }
      : null;
    const persistedRoundsPlayed = Math.max(Number(loadedSummary?.roundsPlayed || 0), Number(gameDoc.roundsPlayed || 0));
    const alreadyArchivedCurrentRound = effectivePendingRound
      ? Boolean((loadedSummary?.rounds || []).some((round) => round.id === effectivePendingRound.id || (round.number === effectivePendingRound.number && round.questionId === effectivePendingRound.questionId)))
      : true;
    const archivedRoundRef = effectivePendingRound && !alreadyArchivedCurrentRound ? doc(collection(gameRef, 'rounds')) : null;
    const archivedRoundResult = effectivePendingRound && !alreadyArchivedCurrentRound
      ? createRoundResult(
          {
            ...effectivePendingRound,
            penaltyAdded: {
              jay: toScore(effectivePendingRound.penalties?.jay || 0),
              kim: toScore(effectivePendingRound.penalties?.kim || 0),
            },
            scores: {
              jay: toScore(effectivePendingRound.penalties?.jay || 0),
              kim: toScore(effectivePendingRound.penalties?.kim || 0),
            },
            actualAnswers: {
              jay: effectivePendingRound.answers?.jay?.ownAnswer || '',
              kim: effectivePendingRound.answers?.kim?.ownAnswer || '',
            },
            guessedAnswers: {
              jay: effectivePendingRound.answers?.jay?.guessedOther || '',
              kim: effectivePendingRound.answers?.kim?.guessedOther || '',
            },
            actualList: {
              jay: parseAnswerList(effectivePendingRound.answers?.jay?.ownAnswer || ''),
              kim: parseAnswerList(effectivePendingRound.answers?.kim?.ownAnswer || ''),
            },
            guessedList: {
              jay: parseAnswerList(effectivePendingRound.answers?.jay?.guessedOther || ''),
              kim: parseAnswerList(effectivePendingRound.answers?.kim?.guessedOther || ''),
            },
          },
          effectivePendingRound.number || (loadedSummary?.roundsPlayed || gameDoc.roundsPlayed || 0) + 1,
          gameDoc.totals || gameDoc.finalScores || nextFinalScores,
        )
      : null;
    nextFinalScores = archivedRoundResult
      ? getRoundPenaltyTotals(archivedRoundResult)
      : gameDoc.totals || gameDoc.finalScores || nextFinalScores;
    nextWinner = Number(nextFinalScores.jay || 0) === Number(nextFinalScores.kim || 0) ? 'tie' : Number(nextFinalScores.jay || 0) < Number(nextFinalScores.kim || 0) ? 'jay' : 'kim';
    const finalizedRoundsPlayed = persistedRoundsPlayed + (effectivePendingRound && !alreadyArchivedCurrentRound ? 1 : 0);
    const finalizedUsedQuestionIds = mergeUniqueIds(
      loadedSummary?.rounds?.map((round) => round.questionId) || [],
      effectivePendingRound && !alreadyArchivedCurrentRound && effectivePendingRound.questionId ? [effectivePendingRound.questionId] : [],
      !(loadedSummary?.rounds?.length) ? (gameDoc.usedQuestionIds || []) : [],
    );

    let jayCurrent = 0;
    let kimCurrent = 0;
    if (!gameDoc.lifetimePointsApplied) {
      const [jaySnap, kimSnap] = await Promise.all([getDoc(jayRef), getDoc(kimRef)]);
      jayCurrent = Number(jaySnap.exists() ? jaySnap.data()?.lifetimePenaltyPoints || 0 : 0);
      kimCurrent = Number(kimSnap.exists() ? kimSnap.data()?.lifetimePenaltyPoints || 0 : 0);
    }

    const batch = writeBatch(firestore);
    if (archivedRoundRef && archivedRoundResult) {
      batch.set(archivedRoundRef, archivedRoundResult);
    }
    if (!gameDoc.lifetimePointsApplied) {
      batch.set(
        jayRef,
        {
          uid: fixedPlayerUids.jay,
          displayName: 'Jay',
          lifetimePenaltyPoints: addScores(jayCurrent, Number(nextFinalScores.jay || 0)),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      batch.set(
        kimRef,
        {
          uid: fixedPlayerUids.kim,
          displayName: 'Kim',
          lifetimePenaltyPoints: addScores(kimCurrent, Number(nextFinalScores.kim || 0)),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      appliedLifetimePoints = true;
    }
    batch.set(gameRef, {
      status: finalStatus,
      currentRound: null,
      endedAt: serverTimestamp(),
      endedBy: endedByUid,
      finalScores: nextFinalScores,
      winner: nextWinner,
      roundsPlayed: finalizedRoundsPlayed,
      actualQuestionCount: finalizedRoundsPlayed,
      questionQueueIds: [],
      usedQuestionIds: finalizedUsedQuestionIds,
      lifetimePointsApplied: true,
      lifetimePointsAppliedAt: gameDoc.lifetimePointsAppliedAt || serverTimestamp(),
      lifetimePointsAppliedBy: gameDoc.lifetimePointsAppliedBy || endedByUid || '',
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await batch.commit();

    const finalSnapshot = await getDoc(gameRef);
    const finalizedGameDoc = finalSnapshot.exists() ? { id: finalSnapshot.id, ...finalSnapshot.data() } : gameDoc;
    try {
      await archivePairHistory(finalizedGameDoc, targetGameId);
    } catch (error) {
      console.warn('Pair history archive failed after game finalization.', error);
    }
    try {
      await clearCompletedGameProfiles(targetGameId, finalizedGameDoc.playerUids || gameDoc.playerUids || []);
    } catch (error) {
      console.warn('Completed game profile cleanup failed after game finalization.', error);
    }
    try {
      await expirePendingGameInvitesForGame(targetGameId, finalStatus);
    } catch (error) {
      console.warn('Pending game invite cleanup failed after game finalization.', error);
    }
    clearPersistedActiveGame(targetGameId);
    autoResumedGameIdRef.current = autoResumedGameIdRef.current === targetGameId ? '' : autoResumedGameIdRef.current;
    setProfile((current) => (current?.activeGameId === targetGameId ? { ...current, activeGameId: '' } : current));
    const gameSummary = await loadGameSummaryById(targetGameId, finalizedGameDoc);
    return { appliedLifetimePoints, finalScores: nextFinalScores, winner: nextWinner, gameSummary };
  };

  const recordPairQuestionUsage = async (questionIds = []) => {
    if (!firestore || !questionIds.length) return;
    const pairRef = doc(firestore, 'playerPairs', buildPairKey());
    await setDoc(
      pairRef,
      {
        pairId: buildPairKey(),
        playerUids: [fixedPlayerUids.jay, fixedPlayerUids.kim],
        playedQuestionIds: arrayUnion(...mergeUniqueIds(questionIds)),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const endGameById = async (targetGameId, endedByUid = user?.uid || '', finalStatus = 'ended', options = {}) =>
    finalizeGameLifecycle(targetGameId, endedByUid, finalStatus, options);

  const buildEndGameConfirmAction = (type, targetGameId, { finalQuestion = false } = {}) => {
    if (!targetGameId) return null;
    const isLocalTestRoom = isLocalTestGameId(targetGameId);
    const body = isLocalTestRoom
      ? (finalQuestion
        ? 'This was the final question. End this local test game and show the summary? Nothing will be saved to Previous Games.'
        : 'End this local test game now and show the summary? Nothing from Editing Mode is saved to Previous Games.')
      : (finalQuestion
        ? 'This was the final question. End the game, return to the lobby, and view the summary from Previous Games?'
        : 'End this game now, move it into Previous Games, and return to the lobby? You will still be able to view the game summary afterwards.');

    return {
      type,
      gameId: targetGameId,
      label: 'End Game',
      title: 'End game?',
      body,
      confirmLabel: 'End Game',
      cancelLabel: 'Cancel',
    };
  };

  const finalizeLocalTestGame = (targetGameId, endedByUid = user?.uid || '', finalStatus = 'completed', options = {}) => {
    if (!targetGameId || !isLocalTestGameId(targetGameId) || game?.id !== targetGameId) return null;

    const sourceRounds = normalizeStoredRounds(rounds);
    const sourceGame = game;
    const pendingRoundPenaltyOverride = options.pendingRoundPenaltyOverride || null;
    const pendingRound = sourceGame.currentRound || null;
    const alreadyArchivedCurrentRound = pendingRound
      ? sourceRounds.some((round) => round.id === pendingRound.id || (round.number === pendingRound.number && round.questionId === pendingRound.questionId))
      : true;

    let nextRounds = sourceRounds;
    let nextTotals = sourceGame.totals || sourceGame.finalScores || { jay: 0, kim: 0 };

    if (pendingRound && !alreadyArchivedCurrentRound) {
      const archivedRoundResult = createRoundResult(
        {
          ...pendingRound,
          penaltyAdded: {
            jay: toScore(pendingRoundPenaltyOverride?.jay ?? pendingRound.penalties?.jay ?? 0),
            kim: toScore(pendingRoundPenaltyOverride?.kim ?? pendingRound.penalties?.kim ?? 0),
          },
          scores: {
            jay: toScore(pendingRoundPenaltyOverride?.jay ?? pendingRound.penalties?.jay ?? 0),
            kim: toScore(pendingRoundPenaltyOverride?.kim ?? pendingRound.penalties?.kim ?? 0),
          },
          actualAnswers: {
            jay: pendingRound.answers?.jay?.ownAnswer || '',
            kim: pendingRound.answers?.kim?.ownAnswer || '',
          },
          guessedAnswers: {
            jay: pendingRound.answers?.jay?.guessedOther || '',
            kim: pendingRound.answers?.kim?.guessedOther || '',
          },
          actualList: {
            jay: parseAnswerList(pendingRound.answers?.jay?.ownAnswer || ''),
            kim: parseAnswerList(pendingRound.answers?.kim?.ownAnswer || ''),
          },
          guessedList: {
            jay: parseAnswerList(pendingRound.answers?.jay?.guessedOther || ''),
            kim: parseAnswerList(pendingRound.answers?.kim?.guessedOther || ''),
          },
        },
        pendingRound.number || sourceRounds.length + 1,
        nextTotals,
      );

      nextRounds = normalizeStoredRounds([...sourceRounds, archivedRoundResult]);
      nextTotals = getRoundPenaltyTotals(archivedRoundResult);
    }

    const nextWinner = Number(nextTotals.jay || 0) === Number(nextTotals.kim || 0)
      ? 'tie'
      : Number(nextTotals.jay || 0) < Number(nextTotals.kim || 0)
        ? 'jay'
        : 'kim';
    const finalizedGameState = {
      ...sourceGame,
      status: finalStatus,
      totals: nextTotals,
      finalScores: nextTotals,
      winner: nextWinner,
      currentRound: null,
      roundsPlayed: nextRounds.length,
      actualQuestionCount: nextRounds.length,
      questionQueueIds: [],
      usedQuestionIds: mergeUniqueIds(
        sourceGame.usedQuestionIds || [],
        nextRounds.map((round) => round.questionId),
        pendingRound?.questionId ? [pendingRound.questionId] : [],
      ),
      endedAt: new Date().toISOString(),
      endedBy: endedByUid,
      updatedAt: new Date().toISOString(),
    };

    return {
      gameSummary: { ...finalizedGameState, rounds: nextRounds },
      rounds: nextRounds,
      finalScores: nextTotals,
      winner: nextWinner,
    };
  };

  const deleteGameById = async (targetGameId) => {
    if (!firestore || !targetGameId) return;
    const gameRef = doc(firestore, 'games', targetGameId);
    const roundDocs = await getDocs(collection(gameRef, 'rounds'));
    const chatDocs = await getDocs(collection(gameRef, 'chatMessages'));
    const batch = writeBatch(firestore);
    roundDocs.forEach((entry) => batch.delete(entry.ref));
    chatDocs.forEach((entry) => batch.delete(entry.ref));
    batch.delete(gameRef);
    await batch.commit();
  };

  const saveRedemptionItem = async ({ itemId = '', ownerPlayerId, title, description, cost, active = true, keepOnRedeemed = false, itemType = 'forfeit' }) => {
    if (!firestore || !user) throw new Error('Firebase is not configured.');
    const normalizedOwner = canonicalPlayerIdForRef(ownerPlayerId, dashboardSeat || 'jay');
    const trimmedTitle = normalizeText(title);
    const numericCost = itemType === 'ama' ? AMA_COST : Math.max(0, toScore(cost || 0));
    if (!trimmedTitle) throw new Error(itemType === 'ama' ? 'Enter an AMA title.' : 'Enter a forfeit title.');
    if (!numericCost) throw new Error('Enter a valid forfeit cost.');
    if (!canManageStoreForPlayer(normalizedOwner)) {
      throw new Error('Only the store owner can edit items.');
    }
    const itemRef = itemId ? doc(firestore, 'redemptionItems', itemId) : doc(collection(firestore, 'redemptionItems'));
    const payload = {
      id: itemRef.id,
      ownerPlayerId: normalizedOwner,
      createdBy: currentPlayerStoreId || user.uid,
      createdByAuthUid: user.uid,
      createdByDisplayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Player',
      title: trimmedTitle,
      description: normalizeText(description),
      cost: numericCost,
      active: Boolean(active),
      itemType: itemType === 'ama' ? 'ama' : 'forfeit',
      linkedType: itemType === 'ama' ? 'ama' : 'forfeit',
      keepOnRedeemed: itemType === 'ama' ? true : Boolean(keepOnRedeemed),
      visibleInStore: true,
      redeemable: true,
      updatedAt: serverTimestamp(),
    };
    if (!itemId) {
      payload.createdAt = serverTimestamp();
    }
    await setDoc(
      itemRef,
      payload,
      { merge: true },
    );
  };

  const deleteRedemptionItem = async (itemId) => {
    if (!firestore || !itemId) return;
    await deleteDoc(doc(firestore, 'redemptionItems', itemId));
  };

  const toggleRedemptionItemActive = async (itemId, nextActive) => {
    if (!firestore || !itemId) return;
    await updateDoc(doc(firestore, 'redemptionItems', itemId), {
      active: Boolean(nextActive),
      updatedAt: serverTimestamp(),
    });
  };

  const createDiaryEntry = async (payload) => {
    if (!firestore || !payload?.ownerPlayerId) return null;
    const entryRef = payload.id ? doc(firestore, 'diaryEntries', payload.id) : doc(collection(firestore, 'diaryEntries'));
    await setDoc(entryRef, { ...payload, id: entryRef.id, updatedAt: serverTimestamp(), createdAt: payload.createdAt || serverTimestamp() }, { merge: true });
    return entryRef.id;
  };

  const uploadAmaMediaFiles = async (requestId, files = []) => {
    if (!storage || !requestId || !files.length) return [];
    const uploads = [];
    for (const [index, file] of files.entries()) {
      const safeName = String(file.name || `media-${index + 1}`).replace(/[^a-z0-9_.-]/gi, '_');
      const path = `amas/${requestId}/${Date.now()}-${index}-${safeName}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, file, { contentType: file.type || 'application/octet-stream' });
      const url = await getDownloadURL(fileRef);
      uploads.push({
        name: file.name || safeName,
        type: file.type || '',
        url,
        path,
      });
    }
    return uploads;
  };

  const redeemRedemptionItem = async (item) => {
    if (!firestore || !user || !item?.id) return;
    const itemRef = doc(firestore, 'redemptionItems', item.id);
    const ownerSeat = seatFromPlayerRef(item.ownerPlayerId || item.ownerSeat || item.storeOwnerUserId || item.createdByDisplayName) || 'jay';
    const ownerId = playerIdForSeat(ownerSeat);
    if (canManageStoreForPlayer(ownerId)) throw new Error('You cannot spend points in your own store.');
    const ownerRef = doc(firestore, 'users', ownerId);
    const redeemerHistoryRef = doc(collection(firestore, 'redemptionHistory'));
    const itemCost = Number(item.cost || 0);
    const isAma = isAmaStoreItem(item);
    const amaRequestRef = isAma ? doc(collection(firestore, 'amaRequests')) : null;
    const diaryRef = doc(collection(firestore, 'diaryEntries'));
    const chapterNumber = nextAmaChapterNumber;
    let amaRequestPayload = null;
    let diaryEntryPayload = null;

    await runTransaction(firestore, async (transaction) => {
      const freshItem = await transaction.get(itemRef);
      if (!freshItem.exists()) throw new Error('Forfeit item not found.');
      const itemData = freshItem.data();
      if (itemData.active === false) throw new Error('This forfeit is inactive.');
      const currentOwner = await transaction.get(ownerRef);
      const currentBalance = Number(currentOwner.exists() ? currentOwner.data()?.lifetimePenaltyPoints || 0 : 0);
      if (currentBalance < itemCost) throw new Error('Not enough lifetime points available.');
      transaction.set(
        ownerRef,
        {
          uid: ownerId,
          displayName: ownerId === fixedPlayerUids.jay ? 'Jay' : 'Kim',
          lifetimePenaltyPoints: currentBalance - itemCost,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      transaction.set(
        redeemerHistoryRef,
        {
          redemptionId: redeemerHistoryRef.id,
          itemId: freshItem.id,
          itemTitle: itemData.title || item.title || 'Forfeit',
          itemCost,
          cost: itemCost,
          itemType: isAmaStoreItem(itemData) ? 'ama' : itemData.itemType || item.itemType || 'forfeit',
          storeOwnerPlayerId: ownerId,
          redeemedByPlayerId: currentPlayerStoreId || user.uid,
          redeemedByAuthUid: user.uid,
          pointsDeductedFromPlayerId: ownerId,
          notifyUserId: ownerId,
          notificationSeen: false,
          notificationSeenAt: null,
          completedByStoreOwner: false,
          completedAt: null,
          completedBy: '',
          redeemedAt: serverTimestamp(),
          status: 'redeemed',
        },
        { merge: true },
      );

      if (isAmaStoreItem(itemData)) {
        amaRequestPayload = {
          id: amaRequestRef.id,
          amaItemId: freshItem.id,
          linkedForfeitId: freshItem.id,
          diaryEntryId: diaryRef.id,
          amaHistoryId: redeemerHistoryRef.id,
          chapterNumber,
          itemTitle: itemData.title || 'AMA',
          itemCost,
          storeOwnerUserId: ownerId,
          requestedByUserId: currentPlayerStoreId || user.uid,
          requestedByAuthUid: user.uid,
          requestedFromUserId: ownerId,
          question: '',
          answer: '',
          story: '',
          media: [],
          status: 'question_pending',
          receiverPlayerId: ownerId,
          redeemerPlayerId: currentPlayerStoreId || user.uid,
          redeemedAt: serverTimestamp(),
          requestNotificationSeen: false,
          requestNotificationSeenAt: null,
          answerNotificationSeen: false,
          answerNotificationSeenAt: null,
          respondedAt: null,
          completedAt: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        diaryEntryPayload = {
          id: diaryRef.id,
          ownerPlayerId: ownerId,
          requestedByPlayerId: currentPlayerStoreId || user.uid,
          requestedByAuthUid: user.uid,
          receiverPlayerId: ownerId,
          sourceType: 'ama',
          sourceId: amaRequestRef.id,
          amaItemId: freshItem.id,
          linkedForfeitId: freshItem.id,
          amaHistoryId: redeemerHistoryRef.id,
          chapterNumber,
          chapterTitle: buildAmaChapterTitle('', chapterNumber),
          question: '',
          answer: '',
          story: '',
          media: [],
          chapterState: 'pending_answer',
          status: 'pending_answer',
          questionAskedAt: null,
          answeredAt: null,
          redeemedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        transaction.set(amaRequestRef, amaRequestPayload, { merge: true });
        transaction.set(diaryRef, diaryEntryPayload, { merge: true });
      } else if (itemData.keepOnRedeemed) {
        diaryEntryPayload = {
          id: diaryRef.id,
          ownerPlayerId: ownerId,
          requestedByPlayerId: currentPlayerStoreId || user.uid,
          requestedByAuthUid: user.uid,
          sourceType: 'forfeit',
          sourceId: freshItem.id,
          linkedForfeitId: freshItem.id,
          chapterTitle: itemData.title || 'Forfeit',
          question: '',
          answer: '',
          story: itemData.description || '',
          media: [],
          chapterState: 'completed',
          keepOnRedeemed: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        transaction.set(diaryRef, diaryEntryPayload, { merge: true });
      }
    });

    if (isAmaStoreItem(item)) {
      return {
        type: 'ama',
        requestId: amaRequestRef.id,
        diaryEntryId: diaryRef.id,
        ownerId,
        itemTitle: item.title || 'AMA',
      };
    }
    return null;
  };

  const markRedemptionSeen = async (historyId) => {
    if (!firestore || !historyId) return;
    const historyRef = doc(firestore, 'redemptionHistory', historyId);
    await updateDoc(historyRef, {
      notificationSeen: true,
      notificationSeenAt: serverTimestamp(),
      status: 'seen',
    });
  };

  const markRedemptionCompleted = async (historyId) => {
    if (!firestore || !historyId || !user) return;
    const historyRef = doc(firestore, 'redemptionHistory', historyId);
    await updateDoc(historyRef, {
      notificationSeen: true,
      notificationSeenAt: serverTimestamp(),
      completedByStoreOwner: true,
      completedAt: serverTimestamp(),
      completedBy: user.uid,
      status: 'completed',
    });
  };

  const createForfeitPriceRequest = async ({ storeOwnerUserId, title, description }) => {
    if (!firestore || !user) throw new Error('Firebase is not configured.');
    const normalizedStoreOwner = canonicalPlayerIdForRef(storeOwnerUserId, dashboardSeat === 'kim' ? 'jay' : 'kim');
    if (!normalizedStoreOwner || canManageStoreForPlayer(normalizedStoreOwner)) throw new Error('Choose the other player store to request a price.');
    const trimmedTitle = normalizeText(title);
    if (!trimmedTitle) throw new Error('Enter the forfeit you want priced.');
    const requestRef = doc(collection(firestore, 'forfeitPriceRequests'));
    await setDoc(requestRef, {
      requestId: requestRef.id,
      requestedByUserId: currentPlayerStoreId || user.uid,
      requestedByAuthUid: user.uid,
      requestedFromUserId: normalizedStoreOwner,
      storeOwnerUserId: normalizedStoreOwner,
      forfeitTitle: trimmedTitle,
      forfeitDescription: normalizeText(description),
      status: 'pending',
      requestedAt: serverTimestamp(),
      respondedAt: null,
      responseMessage: '',
      proposedPrice: 0,
      createdStoreItemId: '',
      requestNotificationSeen: false,
      requestNotificationSeenAt: null,
      responseNotificationSeen: true,
      responseNotificationSeenAt: null,
      });
  };

  const updateForfeitPriceRequest = async (requestId, patch = {}) => {
    if (!firestore || !user || !requestId) throw new Error('Firebase is not configured.');
    const requestRef = doc(firestore, 'forfeitPriceRequests', requestId);
    const cleanTitle = normalizeText(patch.title);
    const cleanDescription = normalizeText(patch.description);
    if (!cleanTitle) throw new Error('Enter a forfeit title.');
    await setDoc(
      requestRef,
      {
        forfeitTitle: cleanTitle,
        forfeitDescription: cleanDescription,
        status: 'pending',
        respondedAt: null,
        responseMessage: '',
        proposedPrice: 0,
        createdStoreItemId: '',
        requestNotificationSeen: false,
        requestNotificationSeenAt: null,
        responseNotificationSeen: true,
        responseNotificationSeenAt: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const deleteForfeitPriceRequest = async (requestId) => {
    if (!firestore || !requestId) return;
    await deleteDoc(doc(firestore, 'forfeitPriceRequests', requestId));
  };

  const markForfeitRequestSeen = async (requestId, kind = 'request') => {
    if (!firestore || !requestId) return;
    const requestRef = doc(firestore, 'forfeitPriceRequests', requestId);
    if (kind === 'response') {
      await updateDoc(requestRef, {
        responseNotificationSeen: true,
        responseNotificationSeenAt: serverTimestamp(),
      });
      return;
    }
    await updateDoc(requestRef, {
      requestNotificationSeen: true,
      requestNotificationSeenAt: serverTimestamp(),
    });
  };

  const respondToForfeitRequest = async (request, { action, price, message }) => {
    if (!firestore || !user || !request?.id) return;
    if (!canManageStoreForPlayer(request.requestedFromUserId || request.storeOwnerUserId)) throw new Error('Only the store owner can respond to this request.');
    const requestRef = doc(firestore, 'forfeitPriceRequests', request.id);

    await runTransaction(firestore, async (transaction) => {
      const freshRequest = await transaction.get(requestRef);
      if (!freshRequest.exists()) throw new Error('Forfeit request not found.');
      const requestData = freshRequest.data();
      if (requestData.status !== 'pending') throw new Error('This request has already been handled.');

      if (action === 'reject') {
        transaction.update(requestRef, {
          status: 'rejected',
          respondedAt: serverTimestamp(),
          responseMessage: normalizeText(message),
          requestNotificationSeen: true,
          requestNotificationSeenAt: serverTimestamp(),
          responseNotificationSeen: false,
          responseNotificationSeenAt: null,
        });
        return;
      }

      const numericPrice = Math.max(0, toScore(price || 0));
      if (!numericPrice) throw new Error('Enter a valid price before adding the forfeit to the store.');
      const storeItemRef = doc(collection(firestore, 'redemptionItems'));
      const normalizedStoreOwner = canonicalPlayerIdForRef(requestData.storeOwnerUserId || requestData.requestedFromUserId, dashboardSeat || 'jay');
      transaction.set(storeItemRef, {
        id: storeItemRef.id,
        ownerPlayerId: normalizedStoreOwner,
        createdBy: currentPlayerStoreId || user.uid,
        createdByAuthUid: user.uid,
        createdByDisplayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Player',
        title: requestData.forfeitTitle || 'Forfeit',
        description: requestData.forfeitDescription || normalizeText(message),
        cost: numericPrice,
        active: true,
        visibleInStore: true,
        redeemable: true,
        keepOnRedeemed: false,
        itemType: 'forfeit',
        source: 'price_request',
        createdFromRequestId: freshRequest.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transaction.update(requestRef, {
        status: 'added_to_store',
        respondedAt: serverTimestamp(),
        responseMessage: normalizeText(message),
        proposedPrice: numericPrice,
        createdStoreItemId: storeItemRef.id,
        requestNotificationSeen: true,
        requestNotificationSeenAt: serverTimestamp(),
        responseNotificationSeen: false,
        responseNotificationSeenAt: null,
      });
    });
  };

  const submitAmaQuestion = async ({ requestId, question }) => {
    if (!firestore || !user || !requestId) throw new Error('Firebase is not configured.');
    const cleanQuestion = normalizeText(question);
    if (!cleanQuestion) throw new Error('Enter your AMA question.');
    const requestRef = doc(firestore, 'amaRequests', requestId);
    await runTransaction(firestore, async (transaction) => {
      const freshRequest = await transaction.get(requestRef);
      if (!freshRequest.exists()) throw new Error('AMA request not found.');
      const requestData = freshRequest.data();
      if (!matchesCurrentPlayerIdentity(requestData.requestedByUserId)) throw new Error('Only the AMA redeemer can write the question.');
      if (requestData.status !== 'question_pending') throw new Error('This AMA question has already been sent.');
      const nextDiaryRef = doc(firestore, 'diaryEntries', requestData.diaryEntryId || requestId);
      transaction.update(requestRef, {
        question: cleanQuestion,
        status: 'questioned',
        questionAskedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        requestNotificationSeen: true,
        requestNotificationSeenAt: serverTimestamp(),
        answerNotificationSeen: false,
        answerNotificationSeenAt: null,
      });
      transaction.set(
        nextDiaryRef,
        {
          id: nextDiaryRef.id,
          ownerPlayerId: requestData.storeOwnerUserId,
          requestedByPlayerId: requestData.requestedByUserId || currentPlayerStoreId || user.uid,
          requestedByAuthUid: requestData.requestedByAuthUid || user.uid,
          sourceType: 'ama',
          sourceId: requestRef.id,
          amaItemId: requestData.amaItemId || requestData.linkedForfeitId || '',
          linkedForfeitId: requestData.linkedForfeitId || requestData.amaItemId || '',
          chapterNumber: requestData.chapterNumber || undefined,
          chapterTitle: buildAmaChapterTitle(cleanQuestion, requestData.chapterNumber || 0),
          question: cleanQuestion,
          answer: '',
          story: '',
          media: [],
          chapterState: 'questioned',
          status: 'questioned',
          questionAskedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });
  };

  const answerAmaRequest = async ({ requestId, answer, story, relatedCategories = [], analyticsSnapshot = null, mediaFiles = [] }) => {
    if (!firestore || !user || !requestId) throw new Error('Firebase is not configured.');
    const cleanAnswer = normalizeText(answer);
    const cleanStory = normalizeText(story);
    if (!cleanAnswer) throw new Error('Enter an answer before saving.');
    const requestRef = doc(firestore, 'amaRequests', requestId);
    const attachments = await uploadAmaMediaFiles(requestId, mediaFiles);

    await runTransaction(firestore, async (transaction) => {
      const freshRequest = await transaction.get(requestRef);
      if (!freshRequest.exists()) throw new Error('AMA request not found.');
      const requestData = freshRequest.data();
      if (!canManageStoreForPlayer(requestData.storeOwnerUserId || requestData.requestedFromUserId)) throw new Error('Only the store owner can answer this AMA.');
      if (!['questioned', 'question_pending'].includes(requestData.status)) throw new Error('This AMA is not ready for an answer yet.');
      const nextDiaryRef = doc(firestore, 'diaryEntries', requestData.diaryEntryId || requestId);
      const amaHistoryRef = requestData.amaHistoryId ? doc(firestore, 'redemptionHistory', requestData.amaHistoryId) : null;
      transaction.update(requestRef, {
        answer: cleanAnswer,
        story: cleanStory,
        relatedCategories: Array.isArray(relatedCategories) ? relatedCategories.filter(Boolean) : [],
        analyticsSnapshot: analyticsSnapshot || null,
        media: attachments,
        status: 'answered',
        respondedAt: serverTimestamp(),
        answeredAt: serverTimestamp(),
        answerNotificationSeen: true,
        answerNotificationSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transaction.set(
        nextDiaryRef,
        {
          id: nextDiaryRef.id,
          ownerPlayerId: requestData.storeOwnerUserId,
          requestedByPlayerId: requestData.requestedByUserId,
          requestedByAuthUid: requestData.requestedByAuthUid || '',
          sourceType: 'ama',
          sourceId: requestRef.id,
          amaItemId: requestData.amaItemId || requestData.linkedForfeitId || '',
          linkedForfeitId: requestData.linkedForfeitId || requestData.amaItemId || '',
          chapterNumber: requestData.chapterNumber || undefined,
          chapterTitle: buildAmaChapterTitle(requestData.question || '', requestData.chapterNumber || 0),
          question: requestData.question || '',
          answer: cleanAnswer,
          story: cleanStory,
          relatedCategories: Array.isArray(relatedCategories) ? relatedCategories.filter(Boolean) : [],
          analyticsSnapshot: analyticsSnapshot || null,
          media: attachments,
          chapterState: 'answered',
          status: 'answered',
          answeredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      if (amaHistoryRef) {
        transaction.update(amaHistoryRef, {
          status: 'completed',
          notificationSeen: true,
          notificationSeenAt: serverTimestamp(),
          completedByStoreOwner: true,
          completedAt: serverTimestamp(),
          completedBy: user.uid,
          updatedAt: serverTimestamp(),
        });
      }
    });
  };

  const markAmaQuestionSeen = async (requestId) => {
    if (!firestore || !requestId) return;
    await updateDoc(doc(firestore, 'amaRequests', requestId), {
      requestNotificationSeen: true,
      requestNotificationSeenAt: serverTimestamp(),
    });
  };

  const markAmaAnswerSeen = async (requestId) => {
    if (!firestore || !requestId) return;
    await updateDoc(doc(firestore, 'amaRequests', requestId), {
      answerNotificationSeen: true,
      answerNotificationSeenAt: serverTimestamp(),
    });
  };

  const resolveCurrentGameSessionId = (preferredGameId = '') =>
    preferredGameId
    || game?.id
    || gameId
    || profile?.activeGameId
    || selectedGameId
    || '';

  const isCurrentGameSession = (targetGameId) =>
    Boolean(
      targetGameId
      && [
        game?.id || '',
        gameId || '',
        profile?.activeGameId || '',
      ].includes(targetGameId),
    );

  const requestEndGame = (targetGameId) => {
    const resolvedGameId = resolveCurrentGameSessionId(targetGameId);
    if (!resolvedGameId) {
      console.error('[KJK ROOM] End game request aborted: missing current game id.', {
        requestedGameId: targetGameId || '',
        activeGameId: gameId || '',
        liveGameId: game?.id || '',
        profileActiveGameId: profile?.activeGameId || '',
      });
      return;
    }
    console.info('[KJK ROOM] Request end game', {
      requestedGameId: targetGameId || '',
      resolvedGameId,
      activeGameId: gameId || '',
      liveGameId: game?.id || '',
      profileActiveGameId: profile?.activeGameId || '',
    });
    setConfirmAction(buildEndGameConfirmAction('end', resolvedGameId));
  };

  const requestDeleteGame = (targetGameId) => {
    if (!targetGameId) return;
    setConfirmAction({ type: 'delete', gameId: targetGameId, label: 'Delete Permanently' });
  };

  const closeLocalTestGameToLobby = (gameSummary, noticeMessage = '') => {
    if (!gameSummary) return;
    autoResumedGameIdRef.current = '';
    leavePendingGameRef.current = '';
    try {
      window.localStorage.setItem('kjk-dashboard-tab', 'gameLobby');
    } catch {
      // Ignore storage failures while returning to the lobby.
    }
    setLocalArchivedGames((current) => upsertGameLibraryEntry(current, gameSummary));
    setLocalEndedGameSummary(gameSummary);
    setSelectedGameId('');
    setGameId('');
    localStorage.removeItem(activeGameKey);
    setGame(null);
    setRounds([]);
    setChatMessages([]);
    resetRoomLoadState();
    setProfile((current) => (current ? { ...current, activeGameId: '' } : current));
    setNotice(noticeMessage || 'Test game ended. Summary opened from the lobby.');
  };

  const completeCurrentGameFromNextQuestion = async (noticeMessage = '') => {
    const targetGameId = game?.id || '';
    if (!targetGameId) return;

    if (isCurrentLocalTestGame) {
      const result = finalizeLocalTestGame(targetGameId, user?.uid || '', 'completed', { pendingRoundPenaltyOverride: penaltyDraft });
      closeLocalTestGameToLobby(result?.gameSummary || null, noticeMessage || 'Test game ended. Summary opened from the lobby.');
      return;
    }

    const result = await endGameById(targetGameId, user?.uid || '', 'completed', { pendingRoundPenaltyOverride: penaltyDraft });
    autoResumedGameIdRef.current = '';
    leavePendingGameRef.current = '';
    try {
      window.localStorage.setItem('kjk-dashboard-tab', 'activity');
      window.localStorage.setItem('kjk-activity-tab', 'previousGames');
    } catch {
      // Ignore storage failures while returning to the lobby.
    }
    if (result?.gameSummary) {
      promoteEndedGameToCompleted(result.gameSummary);
    } else {
      setSelectedGameId(targetGameId);
      setLocalEndedGameSummary(null);
    }
    setGameId('');
    localStorage.removeItem(activeGameKey);
    setGame(null);
    setRounds([]);
    setChatMessages([]);
    resetRoomLoadState();
    setProfile((current) => (current ? { ...current, activeGameId: '' } : current));
    setNotice(noticeMessage || 'Game ended and closed. Summary moved to Previous Games.');
  };

  const confirmGameAction = async (actionOverride = null) => {
    const baseAction = actionOverride || confirmAction;
    const resolvedGameId = resolveCurrentGameSessionId(baseAction?.gameId || '');
    const actionToConfirm = resolvedGameId ? { ...(baseAction || {}), gameId: resolvedGameId } : baseAction;
    console.info('[KJK ROOM] Confirm game action fired', actionToConfirm || null);

    if (!actionToConfirm?.gameId) {
      console.error('[KJK ROOM] Confirm game action aborted: missing game id.', {
        action: actionToConfirm || null,
        activeGameId: gameId || '',
        liveGameId: game?.id || '',
        profileActiveGameId: profile?.activeGameId || '',
      });
      return;
    }

    const currentGameBase =
      (actionToConfirm.gameId === game?.id ? game : null)
      || gameLibrary.find((entry) => entry.id === actionToConfirm.gameId)
      || localArchivedGames.find((entry) => entry.id === actionToConfirm.gameId)
      || null;
    const currentGame = currentGameBase
      ? { ...currentGameBase, code: currentGameBase.code || currentGameBase.joinCode || actionToConfirm.gameId }
      : { id: actionToConfirm.gameId, code: actionToConfirm.gameId };
    console.log('ENDING GAME', currentGame?.id || currentGame?.code);
    console.info('[KJK ROOM] Resolved end game target', {
      targetGameId: actionToConfirm.gameId,
      activeGameId: gameId || '',
      liveGameId: game?.id || '',
      profileActiveGameId: profile?.activeGameId || '',
      endingCurrentRoom: isCurrentGameSession(actionToConfirm.gameId),
    });

    if (isBusy) {
      console.warn('[KJK ROOM] Confirm game action fired while app busy. Proceeding anyway.', {
        action: actionToConfirm,
      });
    }

    const preserveBusyState = isBusy;
    if (!preserveBusyState) setIsBusy(true);
    try {
      if (isLocalTestGameId(actionToConfirm.gameId)) {
        const endingCurrentRoom = isCurrentGameSession(actionToConfirm.gameId);
        if (actionToConfirm.type === 'end' || actionToConfirm.type === 'complete-game') {
          const result = finalizeLocalTestGame(
            actionToConfirm.gameId,
            user?.uid || '',
            'completed',
            endingCurrentRoom ? { pendingRoundPenaltyOverride: penaltyDraft } : {},
          );
          closeLocalTestGameToLobby(result?.gameSummary || null, 'Test game ended. Summary opened from the lobby.');
        } else if (actionToConfirm.type === 'delete') {
          if (actionToConfirm.gameId === selectedGameId) setSelectedGameId('');
          setLocalEndedGameSummary(null);
          setLocalArchivedGames((current) => current.filter((entry) => entry?.id !== actionToConfirm.gameId));
          setGameId('');
          setGame(null);
          setRounds([]);
          setChatMessages([]);
          localStorage.removeItem(activeGameKey);
          setNotice('Test game cleared locally.');
        }
        setConfirmAction(null);
        console.info('[KJK ROOM] Confirm game action completed for local test game', actionToConfirm);
        return;
      }

      if (actionToConfirm.type === 'end' || actionToConfirm.type === 'complete-game') {
        const endingCurrentRoom = isCurrentGameSession(actionToConfirm.gameId);
        const result = await endGameById(
          actionToConfirm.gameId,
          user?.uid || '',
          'completed',
          endingCurrentRoom ? { pendingRoundPenaltyOverride: penaltyDraft } : {},
        );

        if (result?.gameSummary) {
          promoteEndedGameToCompleted(result.gameSummary);
        } else {
          setSelectedGameId(actionToConfirm.gameId);
          setLocalEndedGameSummary(null);
        }

        if (endingCurrentRoom) {
          autoResumedGameIdRef.current = '';
          leavePendingGameRef.current = '';
          try {
            window.localStorage.setItem('kjk-dashboard-tab', 'activity');
            window.localStorage.setItem('kjk-activity-tab', 'previousGames');
          } catch {
            // Ignore storage failures while returning to the lobby.
          }
          setGameId('');
          localStorage.removeItem(activeGameKey);
          setGame(null);
          setRounds([]);
          setChatMessages([]);
          resetRoomLoadState();
          setProfile((current) => (current ? { ...current, activeGameId: '' } : current));
          setNotice('Game ended and closed. Summary moved to Previous Games.');
        } else {
          setNotice('Game ended. It has moved to Previous Games.');
        }
      } else if (actionToConfirm.type === 'delete') {
        const target = gameLibrary.find((entry) => entry.id === actionToConfirm.gameId);
        if (target?.status === 'active' || target?.status === 'paused') {
          await endGameById(actionToConfirm.gameId, user?.uid || '');
        }
        await deleteGameById(actionToConfirm.gameId);
        if (isCurrentGameSession(actionToConfirm.gameId)) {
          setGameId('');
          localStorage.removeItem(activeGameKey);
          setGame(null);
          setRounds([]);
          setChatMessages([]);
          resetRoomLoadState();
          setProfile((current) => (current ? { ...current, activeGameId: '' } : current));
        }
        if (actionToConfirm.gameId === selectedGameId) setSelectedGameId('');
        setNotice('Game deleted permanently.');
      }

      setConfirmAction(null);
      console.info('[KJK ROOM] Confirm game action completed successfully', actionToConfirm);
    } catch (error) {
      console.error('END GAME FAILED', error);
      console.error('[KJK ROOM] Confirm game action failed', error, actionToConfirm);
      setNotice(error?.message || 'Could not update game.');
    } finally {
      if (!preserveBusyState) setIsBusy(false);
    }
  };

  const cancelGameAction = () => setConfirmAction(null);

  const saveRedemptionItemAction = async (payload) =>
    withBusy(async () => {
      await saveRedemptionItem(payload);
      setNotice('Forfeit item saved.');
    }, 'Could not save redemption item.');

  useEffect(() => {
    if (!user || !firestore) return;
    seats.forEach((seat) => {
      const ownerPlayerId = playerIdForSeat(seat);
      const existingAmaItem = redemptionItems.find((item) => {
        const itemSeat = seatFromPlayerRef(item.ownerPlayerId || item.ownerSeat || item.storeOwnerUserId || item.createdByDisplayName || item.createdBy);
        return itemSeat === seat && isAmaStoreItem(item);
      });
      const needsAmaSync =
        !existingAmaItem
        || normalizeIdentity(existingAmaItem.title) !== normalizeIdentity('AMA / Ask Me Anything')
        || Number(existingAmaItem.cost || 0) !== AMA_COST
        || existingAmaItem.active === false
        || existingAmaItem.visibleInStore === false
        || existingAmaItem.redeemable === false
        || existingAmaItem.keepOnRedeemed !== true;
      if (!needsAmaSync || amaStoreSeededRef.current[seat]) return;
      amaStoreSeededRef.current[seat] = true;
      const itemRef = doc(firestore, 'redemptionItems', existingAmaItem?.id || `system-ama-${ownerPlayerId}`);
      setDoc(itemRef, {
        id: itemRef.id,
        ownerPlayerId,
        createdBy: 'system',
        createdByAuthUid: user.uid,
        createdByDisplayName: 'System Seed',
        title: 'AMA / Ask Me Anything',
        description: 'Ask a question now or later. This AMA stays in the store after each redemption.',
        cost: AMA_COST,
        active: true,
        visibleInStore: true,
        redeemable: true,
        itemType: 'ama',
        linkedType: 'ama',
        systemItem: true,
        keepOnRedeemed: true,
        createdAt: existingAmaItem?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true }).catch((error) => {
        debugRoom('seedAmaStoreItemFailed', { seat, message: error?.message || String(error) });
      }).finally(() => {
        amaStoreSeededRef.current[seat] = false;
      });
    });
  }, [firestore, redemptionItems, user]);

  const deleteRedemptionItemAction = async (itemId) =>
    withBusy(async () => {
      await deleteRedemptionItem(itemId);
      setNotice('Forfeit item deleted.');
    }, 'Could not delete redemption item.');

  const toggleRedemptionItemActiveAction = async (itemId, nextActive) =>
    withBusy(async () => {
      await toggleRedemptionItemActive(itemId, nextActive);
      setNotice(nextActive ? 'Forfeit item activated.' : 'Forfeit item deactivated.');
    }, 'Could not update redemption item.');

  const redeemRedemptionItemAction = async (item) =>
    withBusy(async () => {
      const result = await redeemRedemptionItem(item);
      setNotice(`${item.title || 'Forfeit'} redeemed.`);
      return result;
    }, 'Could not redeem item.');

  const markRedemptionSeenAction = async (historyId) =>
    withBusy(async () => {
      await markRedemptionSeen(historyId);
      setNotice('Forfeit redemption marked as seen.');
    }, 'Could not update redemption.');

  const markRedemptionCompletedAction = async (historyId) =>
    withBusy(async () => {
      await markRedemptionCompleted(historyId);
      setNotice('Forfeit redemption marked as completed.');
    }, 'Could not complete redemption.');

  const createForfeitPriceRequestAction = async (payload) =>
    withBusy(async () => {
      await createForfeitPriceRequest(payload);
      setNotice('Forfeit price request sent.');
    }, 'Could not create forfeit price request.');

  const updateForfeitPriceRequestAction = async (requestId, payload) =>
    withBusy(async () => {
      await updateForfeitPriceRequest(requestId, payload);
      setNotice('Forfeit request updated.');
    }, 'Could not update forfeit request.');

  const deleteForfeitPriceRequestAction = async (requestId) =>
    withBusy(async () => {
      await deleteForfeitPriceRequest(requestId);
      setNotice('Forfeit request deleted.');
    }, 'Could not delete forfeit request.');

  const markForfeitRequestSeenAction = async (requestId, kind = 'request') =>
    withBusy(async () => {
      await markForfeitRequestSeen(requestId, kind);
      setNotice(kind === 'response' ? 'Forfeit response marked as seen.' : 'Forfeit request marked as seen.');
    }, 'Could not update request notification.');

  const respondToForfeitRequestAction = async (request, response) =>
    withBusy(async () => {
      await respondToForfeitRequest(request, response);
      setNotice(response.action === 'reject' ? 'Forfeit request rejected.' : 'Forfeit priced and added to the store.');
    }, 'Could not respond to forfeit request.');

  const submitAmaQuestionAction = async (payload) =>
    withBusy(async () => {
      await submitAmaQuestion(payload);
      setNotice('AMA question sent.');
    }, 'Could not submit AMA question.');

  const answerAmaRequestAction = async (payload) =>
    withBusy(async () => {
      await answerAmaRequest(payload);
      setNotice('AMA answer saved.');
    }, 'Could not save AMA answer.');

  const markAmaQuestionSeenAction = async (requestId) =>
    withBusy(async () => {
      await markAmaQuestionSeen(requestId);
      setNotice('AMA question marked as seen.');
    }, 'Could not update AMA request.');

  const markAmaAnswerSeenAction = async (requestId) =>
    withBusy(async () => {
      await markAmaAnswerSeen(requestId);
      setNotice('AMA answer marked as seen.');
    }, 'Could not update AMA response.');

  const resetLifetimeBalancesAction = async () =>
    withBusy(async () => {
      await Promise.all([
        setDoc(doc(firestore, 'users', fixedPlayerUids.jay), { lifetimePenaltyPoints: 0, updatedAt: serverTimestamp() }, { merge: true }),
        setDoc(doc(firestore, 'users', fixedPlayerUids.kim), { lifetimePenaltyPoints: 0, updatedAt: serverTimestamp() }, { merge: true }),
      ]);
      setNotice('Jay and Kim lifetime balances reset to zero.');
    }, 'Could not reset lifetime balances.');

  const updateQuestionBankUsage = async (questions = [], used = true) => {
    if (!firestore || !questions.length) return;
    const transformed = questions.map((question) => (used ? markQuestionPlayed(question) : setQuestionUsed(question, false)));
    await upsertQuestionBankBatch(firestore, transformed);
  };

  const resetQuestionBankAction = async () =>
    withBusy(async () => {
      if (!firestore) throw new Error('Firebase is not configured.');
      const shouldReset = window.confirm('Put all questions back into the unused pool? This will not delete the question bank.');
      if (!shouldReset) return;
      await updateQuestionBankUsage(bankQuestions, false);
      await setDoc(
        doc(firestore, 'playerPairs', buildPairKey()),
        {
          pairId: buildPairKey(),
          playerUids: [fixedPlayerUids.jay, fixedPlayerUids.kim],
          playedQuestionIds: [],
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setNotice('All questions were re-entered into the unused pool.');
    }, 'Could not reset question bank.');

  const makeGameRef = () => {
    const roomId = gameId || game?.id || '';
    if (!roomId || !firestore || isLocalTestGameId(roomId)) return null;
    return doc(firestore, 'games', roomId);
  };

  const withBusy = async (work, fallback = 'Something went wrong.') => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      return await work();
    } catch (error) {
      setNotice(error.message || fallback);
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const toggleEditingMode = () => {
    if (!editingModeEnabled) {
      const pin = window.prompt('Enter PIN for Editing Mode.');
      if (pin === null) return;
      if (String(pin).trim() !== EDITING_MODE_PIN) {
        window.alert('Incorrect PIN.');
        return;
      }
      setEditingModeEnabled(true);
      setNotice('Editing Mode enabled. Test games stay local and do not save.');
      return;
    }
    setEditingModeEnabled(false);
    setNotice(isCurrentLocalTestGame
      ? 'Editing Mode disabled for new games. The current test room stays local until you leave it.'
      : 'Editing Mode disabled. New games will save normally.');
  };

  const syncGoogleSheetQuestions = async ({ sheetValue, existingQuestions, overwriteExisting = true }) => {
    const reference = parseGoogleSheetReference(sheetValue);
    if (!reference) throw new Error('Enter a valid Google Sheet URL or ID.');
    const gids = [...new Set((reference.gids?.length ? reference.gids : [reference.gid]).filter(Boolean))];
    const targets = gids.length
      ? gids.map((gid) => ({
          gid,
          csvUrl: `https://docs.google.com/spreadsheets/d/${reference.id}/export?format=csv&gid=${gid}`,
        }))
      : [{ gid: '', csvUrl: reference.csvUrl }];
    const nextExistingQuestions = [...existingQuestions];
    const importedQuestions = [];
    const updatedQuestions = [];
    let importedTotal = 0;
    let updatedTotal = 0;
    let duplicatedTotal = 0;
    let invalidTotal = 0;
    let skippedTotal = 0;

    for (const target of targets) {
      const response = await fetch(target.csvUrl);
      if (!response.ok) throw new Error(`Google Sheet tab fetch failed (${response.status}) for gid ${target.gid || 'default'}.`);
      const rawText = await response.text();
      const result = parseGoogleSheetImport({
        rawText,
        existingQuestions: nextExistingQuestions,
        overwriteExisting,
        importedAt: new Date().toISOString(),
        sourceLabel: `${reference.id}${target.gid ? `:${target.gid}` : ''}`,
      });

      importedQuestions.push(...result.imports);
      updatedQuestions.push(...result.updates);
      importedTotal += result.summary.imported;
      updatedTotal += result.summary.updated;
      duplicatedTotal += result.summary.duplicates;
      invalidTotal += result.summary.invalid;
      skippedTotal += result.summary.skipped;
      nextExistingQuestions.push(...result.imports, ...result.updates);
    }

    return {
      reference,
      imports: importedQuestions,
      updates: updatedQuestions,
      summary: {
        imported: importedTotal,
        updated: updatedTotal,
        duplicates: duplicatedTotal,
        invalid: invalidTotal,
        skipped: skippedTotal,
      },
    };
  };

  const persistActiveGame = async (nextGameId) => {
    autoResumedGameIdRef.current = '';
    if (isLocalTestGameId(nextGameId)) {
      resetRoomLoadState();
      setGameId(nextGameId);
      return;
    }
    if (!user || !firestore) return;
    debugRoom('persistActiveGame', { nextGameId, uid: user.uid });
    leavePendingGameRef.current = '';
    const profileRef = doc(firestore, 'users', user.uid);
    await setDoc(
      profileRef,
      {
        uid: user.uid,
        displayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Player',
        email: user.email || '',
        photoURL: user.photoURL || '',
        activeGameId: nextGameId,
        activeGames: nextGameId ? arrayUnion(nextGameId) : [],
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    if (nextGameId) localStorage.setItem(activeGameKey, nextGameId);
    else localStorage.removeItem(activeGameKey);
    setGameId(nextGameId);
  };

  const seedBankIfNeeded = async () => {
    if (!firestore || !user) return;
    const snap = await getDocs(collection(firestore, 'questionBank'));
    const existingQuestions = snap.docs.map((entry) => normalizeStoredQuestion(entry.data(), entry.id));
    const needsTopUp = snap.empty || isStarterOnlyQuestionBank(existingQuestions);
    if (!needsTopUp) return existingQuestions;
    try {
      const result = await syncGoogleSheetQuestions({
        sheetValue: sheetInput || DEFAULT_SETTINGS.googleSheetInput,
        existingQuestions,
        overwriteExisting: false,
      });
      if (result.imports.length || result.updates.length) {
        await upsertQuestionBankBatch(firestore, [...result.imports, ...result.updates]);
        return;
      }
    } catch (error) {
      console.warn('Question bank sync failed, falling back where possible.', error);
    }
    if (!snap.empty) return existingQuestions;
    await upsertQuestionBankBatch(
      firestore,
      STARTER_QUESTIONS.map((question) => createQuestionTemplate(question)),
    );
  };

  useEffect(() => {
    if (!user || !firestore || autoSheetImportAttemptedRef.current) return;
    if (!bankQuestions.length || bankQuestions.length > STARTER_QUESTIONS.length) return;
    const looksStarterOnly = isStarterOnlyQuestionBank(bankQuestions);
    if (!looksStarterOnly) return;
    autoSheetImportAttemptedRef.current = true;
    syncGoogleSheetQuestions({
      sheetValue: sheetInput || DEFAULT_SETTINGS.googleSheetInput,
      existingQuestions: bankQuestions,
      overwriteExisting: false,
    })
      .then(async (result) => {
        if (!result.imports.length && !result.updates.length) return;
        await upsertQuestionBankBatch(firestore, [...result.imports, ...result.updates]);
        setSyncNotice(
          `Imported ${result.summary.imported} new Google Sheet questions automatically. Duplicates ${result.summary.duplicates}, invalid ${result.summary.invalid}.`,
        );
        setNotice(`Question bank topped up with ${result.summary.imported} new Google Sheet questions.`);
      })
      .catch((error) => {
        console.warn('Automatic Google Sheet top-up failed.', error);
      });
  }, [user, firestore, bankQuestions, sheetInput]);

  const saveDisplayNameProfile = async (nextDisplayName) =>
    withBusy(async () => {
      if (!firestore || !user?.uid) throw new Error('You must be signed in.');
      const cleanDisplayName = normalizeText(nextDisplayName);
      if (!cleanDisplayName) throw new Error('Enter a display name.');
      await setDoc(
        doc(firestore, 'users', user.uid),
        {
          uid: user.uid,
          displayName: cleanDisplayName,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      if (firebaseAuth?.currentUser) {
        await updateProfile(firebaseAuth.currentUser, { displayName: cleanDisplayName }).catch(() => null);
      }

      const gamesSnap = await getDocs(query(collection(firestore, 'games'), where('playerUids', 'array-contains', user.uid))).catch(() => null);
      if (gamesSnap && !gamesSnap.empty) {
        for (const gameEntry of gamesSnap.docs) {
          const data = gameEntry.data() || {};
          await setDoc(
            gameEntry.ref,
            {
              playerProfiles: {
                ...(data.playerProfiles || {}),
                [user.uid]: {
                  ...(data.playerProfiles?.[user.uid] || {}),
                  displayName: cleanDisplayName,
                },
              },
              hostDisplayName: data.hostUid === user.uid ? cleanDisplayName : data.hostDisplayName || '',
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      }

      const pendingInviteSnap = await getDocs(query(collection(firestore, 'gameInvites'), where('invitedByUserId', '==', user.uid))).catch(() => null);
      if (pendingInviteSnap && !pendingInviteSnap.empty) {
        for (const inviteEntry of pendingInviteSnap.docs) {
          await setDoc(inviteEntry.ref, { invitedByDisplayName: cleanDisplayName, updatedAt: serverTimestamp() }, { merge: true });
        }
      }

      setProfile((current) => (current ? { ...current, displayName: cleanDisplayName } : current));
      setNotice(`Profile updated to ${cleanDisplayName}.`);
    }, 'Could not update profile.');

  const savePrivateQuestionNote = async ({ round = null, noteText = '' } = {}) =>
    withBusy(async () => {
      if (!firestore || !user?.uid) throw new Error('You must be signed in.');
      const trimmedNote = normalizeText(noteText);
      if (!trimmedNote) throw new Error('Write a note before saving.');
      const questionId = normalizeText(round?.questionId || '') || sanitizeNoteKey(round?.question || '');
      if (!questionId) throw new Error('No active question found.');
      const noteId = `${questionId}`;
      const noteRef = doc(firestore, 'users', user.uid, 'questionNotes', noteId);
      const existingSnap = await getDoc(noteRef).catch(() => null);
      const existingData = existingSnap?.exists() ? existingSnap.data() : {};
      const createdAt = existingData?.createdAt || serverTimestamp();
      await setDoc(
        noteRef,
        {
          userId: user.uid,
          questionId: normalizeText(round?.questionId || ''),
          questionText: normalizeText(round?.question || ''),
          noteText: trimmedNote,
          gameId: game?.id || '',
          gameName: game?.gameName || game?.name || '',
          joinCode: game?.joinCode || game?.roomCode || game?.code || '',
          category: normalizeText(round?.category || ''),
          roundType: normalizeText(round?.roundType || ''),
          createdAt,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setNotice('Private note saved to My Profile.');
      return true;
    }, 'Could not save private note.');

  const createGame = async (options = {}) =>
    withBusy(async () => {
      setLocalEndedGameSummary(null);
      if (!firestore || !user) throw new Error('Firebase is not configured.');
      console.debug('Create New Game clicked', {
        gameName: lobbyGameName,
        requestedQuestionCount: lobbyQuestionCount,
        createCode: lobbyCode,
        mode: options.mode || 'random',
        roundTypes: options.roundTypes || [],
        categories: options.categories || [],
      });
      const trimmedGameName = normalizeText(lobbyGameName);
      if (!trimmedGameName) throw new Error('Enter a game name.');
      const requestedQuestionCount = Number.parseInt(lobbyQuestionCount, 10);
      if (!Number.isFinite(requestedQuestionCount) || requestedQuestionCount <= 0) {
        throw new Error('Enter a valid number of questions.');
      }
      const previousGame = game;
      const previousGameId = gameId;
      const previousRounds = rounds;
      const previousChatMessages = chatMessages;
      const selectionMode = options.mode === 'custom' ? 'custom' : 'random';
      const selectedRoundTypes = selectionMode === 'custom' ? options.roundTypes || [] : [];
      const selectedCategories = selectionMode === 'custom' ? options.categories || [] : [];
      const creatorSeat = preferredSeatForUser(user, profile);
      const guestSeat = oppositeSeatOf(creatorSeat);
      const inviteTargetSeat = guestSeat;
      const inviteTargetUserId = playerIdForSeat(inviteTargetSeat);

      const shouldCreateLocalTestGame = editingModeEnabled && window.confirm(
        'Editing Mode is enabled.\n\nPress OK to create a local test game on this device only.\nPress Cancel to create a live game that other players can join with a code.',
      );

      if (shouldCreateLocalTestGame) {
        await seedBankIfNeeded();
        const queueResult = await buildQuestionQueue(requestedQuestionCount, {
          roundTypes: selectedRoundTypes,
          categories: selectedCategories,
        });
        const queue = queueResult.queue;
        const warning = queueResult.warning;
        const actualCount = queueResult.actualCount;
        if (!queue.length) {
          throw new Error(selectionMode === 'custom' ? 'No unused questions match those filters.' : 'No unused questions are available for this pair.');
        }
        if (actualCount < requestedQuestionCount) {
          const shouldContinue = window.confirm(`${warning} Create test game with ${actualCount}?`);
          if (!shouldContinue) {
            setNotice('Editing Mode game creation cancelled before the local queue was finalized.');
            return;
          }
        }
        const localGameId = makeId(TEST_GAME_PREFIX);
        const localJoinCode = `TEST${makeJoinCode().slice(0, 2)}`;
        const hostName = profile?.displayName || user.displayName || user.email?.split('@')[0] || PLAYER_LABEL[creatorSeat] || 'Player';
        const localOtherPlayerName = inviteTargetSeat === 'kim' ? TEST_MODE_PLAYER_NAME : 'Jay (Test)';
        const createdAt = new Date().toISOString();
        const localGameState = {
          id: localGameId,
          joinCode: localJoinCode,
          code: localJoinCode,
          roomCode: localJoinCode,
          gameName: trimmedGameName || `Editing Mode ${localJoinCode}`,
          status: 'active',
          hostUid: user.uid,
          hostDisplayName: hostName,
          hostPhotoURL: user.photoURL || '',
          seats: {
            [creatorSeat]: user.uid,
            [inviteTargetSeat]: TEST_MODE_PLAYER_UID,
          },
          playerUids: [user.uid, TEST_MODE_PLAYER_UID],
          playerProfiles: {
            [user.uid]: {
              displayName: hostName,
              seat: creatorSeat,
              role: 'host',
              photoURL: user.photoURL || '',
            },
            [TEST_MODE_PLAYER_UID]: {
              displayName: localOtherPlayerName,
              seat: inviteTargetSeat,
              role: 'player',
              photoURL: '',
            },
          },
          totals: { jay: 0, kim: 0 },
          currentRound: null,
          pairId: buildPairKey(),
          questionSelectionMode: selectionMode,
          questionSelectionFilters: {
            roundTypes: selectedRoundTypes,
            categories: selectedCategories,
          },
          questionQueueIds: queue.map((question) => question.id),
          requestedQuestionCount,
          actualQuestionCount: actualCount,
          usedQuestionIds: [],
          roundsPlayed: 0,
          finalScores: { jay: 0, kim: 0 },
          winner: 'tie',
          lifetimePointsApplied: false,
          lifetimePointsAppliedAt: null,
          lifetimePointsAppliedBy: '',
          endedAt: null,
          endedBy: '',
          createdAt,
          updatedAt: createdAt,
          isEditingMode: true,
          isLocalOnly: true,
        };
        autoResumedGameIdRef.current = '';
        resetRoomLoadState();
        setGame(localGameState);
        setRounds([]);
        setChatMessages([]);
        setGameId(localGameId);
        localStorage.removeItem(activeGameKey);
        setLobbyGameName('');
        setLobbyQuestionCount('10');
        setNotice(`Editing Mode room opened locally with ${actualCount} questions.${warning ? ` ${warning}` : ''}${options.sendInvite ? ' Invite not sent because local test rooms are device-only.' : ' Nothing from this game will be saved.'}`);
        return;
      }

      const gameRef = doc(firestore, 'games', makeId('game'));
      const joinCode = await makeUniqueJoinCode(lobbyCode);
      const openingGameState = {
        id: gameRef.id,
        joinCode,
        code: joinCode,
        roomCode: joinCode,
        gameName: trimmedGameName || `Jay vs Kim ${joinCode}`,
        status: 'opening',
        hostUid: user.uid,
        hostDisplayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || PLAYER_LABEL[creatorSeat] || 'Player',
        hostPhotoURL: user.photoURL || '',
        seats: {
          [creatorSeat]: user.uid,
          [guestSeat]: '',
        },
        playerUids: [user.uid],
        playerProfiles: {
          [user.uid]: {
            displayName: profile?.displayName || user.displayName || PLAYER_LABEL[creatorSeat] || 'Player',
            seat: creatorSeat,
            role: 'host',
            photoURL: user.photoURL || '',
          },
        },
        totals: { jay: 0, kim: 0 },
        currentRound: null,
        pairId: buildPairKey(),
        questionSelectionMode: selectionMode,
        questionSelectionFilters: {
          roundTypes: selectedRoundTypes,
          categories: selectedCategories,
        },
        questionQueueIds: [],
        requestedQuestionCount,
        actualQuestionCount: 0,
        usedQuestionIds: [],
        roundsPlayed: 0,
        finalScores: { jay: 0, kim: 0 },
        winner: 'tie',
        lifetimePointsApplied: false,
        lifetimePointsAppliedAt: null,
        lifetimePointsAppliedBy: '',
        endedAt: null,
        endedBy: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const openingGameDoc = {
        ...openingGameState,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      let roomCreated = false;

      try {
        autoResumedGameIdRef.current = '';
        armRoomLoadTimeout(gameRef.id, 'opening game');
        await setDoc(gameRef, openingGameDoc);
        roomCreated = true;
        setGame(openingGameState);
        setRounds([]);
        setGameId(gameRef.id);
        localStorage.setItem(activeGameKey, gameRef.id);
        setNotice(`Opening ${trimmedGameName || 'new game'}…`);

        let queue = [];
        let warning = '';
        let actualCount = 0;
        try {
          await seedBankIfNeeded();
          const bankSnapshot = await getDocs(collection(firestore, 'questionBank'));
          if (!bankSnapshot.size) throw new Error('Question bank is not loaded.');
          const queueResult = await buildQuestionQueue(requestedQuestionCount, {
            roundTypes: selectedRoundTypes,
            categories: selectedCategories,
          });
          queue = queueResult.queue;
          warning = queueResult.warning;
          actualCount = queueResult.actualCount;
          if (!queue.length) {
            throw new Error(selectionMode === 'custom' ? 'No unused questions match those filters.' : 'No unused questions are available for this pair.');
          }
          if (actualCount < requestedQuestionCount) {
            const shouldContinue = window.confirm(`${warning} Create game with ${actualCount}?`);
            if (!shouldContinue) {
              setNotice('Game creation cancelled before question queue was finalized.');
              return;
            }
          }
          await updateQuestionBankUsage(queue, true);
          const createdGameState = {
            ...openingGameState,
            joinCode,
            status: 'active',
            questionSelectionMode: selectionMode,
            questionSelectionFilters: {
              roundTypes: selectedRoundTypes,
              categories: selectedCategories,
            },
            questionQueueIds: queue.map((question) => question.id),
            actualQuestionCount: actualCount,
          };
          console.debug('Create New Game queue selected', {
            joinCode,
            requestedQuestionCount,
            actualCount,
            queueCount: queue.length,
            queueIds: queue.map((question) => question.id),
          });
          const createdGameDoc = {
            ...createdGameState,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          setGame(createdGameState);
          setGameId(gameRef.id);
          localStorage.setItem(activeGameKey, gameRef.id);
          await setDoc(gameRef, createdGameDoc, { merge: true });
          setNotice(`Game ${joinCode} created with ${actualCount} questions.${warning ? ` ${warning}` : ''}`);
          console.debug('Create New Game queue committed', { gameId: gameRef.id, joinCode, actualCount });
        } catch (queueError) {
          console.warn('Create New Game queue setup failed, keeping the room open.', queueError);
          setNotice(`Game ${joinCode} created, but the question queue could not be finalized yet. ${queueError?.message || ''}`.trim());
        }

        try {
          await setDoc(
            doc(firestore, 'games', gameRef.id, 'players', user.uid),
            {
              uid: user.uid,
              displayName: profile?.displayName || user.displayName || PLAYER_LABEL[creatorSeat] || 'Player',
              seat: creatorSeat,
              role: 'host',
              photoURL: user.photoURL || '',
              joinedAt: serverTimestamp(),
            },
            { merge: true },
          );
        } catch (playerError) {
          console.warn('Create New Game player profile write failed.', playerError);
        }

        try {
          await persistActiveGame(gameRef.id);
        } catch (persistError) {
          console.warn('Create New Game active game persist failed, room kept open.', persistError);
        }

        if (options.sendInvite) {
          try {
            await sendGameInviteForSession({
              targetGameId: gameRef.id,
              targetUserId: inviteTargetUserId,
              targetSeat: inviteTargetSeat,
              sourceGame: {
                ...openingGameState,
                status: 'active',
                joinCode,
                roomCode: joinCode,
                code: joinCode,
                actualQuestionCount: actualCount || openingGameState.actualQuestionCount,
                requestedQuestionCount,
              },
            });
            setNotice(`Game ${joinCode} created and invite sent to ${PLAYER_LABEL[inviteTargetSeat] || inviteTargetSeat}.`);
          } catch (inviteError) {
            console.warn('Create New Game invite send failed.', inviteError);
            setNotice(`Game ${joinCode} created, but the invite could not be sent. ${inviteError?.message || ''}`.trim());
          }
        }

        setLobbyGameName('');
        setLobbyQuestionCount('10');
        console.debug('Create New Game opened', { gameId: gameRef.id, joinCode, roomCreated });
      } catch (error) {
        debugRoom('createGameFailed', { gameId: gameRef.id, message: error?.message || String(error) });
        if (!roomCreated) {
          setGame(previousGame || null);
          setGameId(previousGameId || '');
          setRounds(previousRounds || []);
          setChatMessages(previousChatMessages || []);
          if (previousGameId) localStorage.setItem(activeGameKey, previousGameId);
          else localStorage.removeItem(activeGameKey);
        }
        resetRoomLoadState();
        throw error;
      }
    }, 'Could not create game.');

  const joinGameSessionById = async (targetGameId, { fallbackCode = '', inviteId = '' } = {}) => {
    setLocalEndedGameSummary(null);
    if (!firestore || !user) throw new Error('Firebase is not configured.');
    if (!targetGameId) throw new Error('No active game found for that request.');
    const previousGame = game;
    const previousGameId = gameId;
    const previousRounds = rounds;
    const previousChatMessages = chatMessages;
    const roomRef = doc(firestore, 'games', targetGameId);
    try {
      autoResumedGameIdRef.current = '';
      armRoomLoadTimeout(targetGameId, inviteId ? 'joining invited game' : 'joining game');
      const fresh = await getDoc(roomRef);
      if (!fresh.exists()) {
        if (inviteId) await setGameInviteStatus(inviteId, { status: 'expired', gameStatus: 'missing', expiredAt: serverTimestamp() });
        throw new Error('Room no longer exists.');
      }
      const data = fresh.data();
      const resolvedCode = normalizeJoinCode(fallbackCode || data?.roomCode || data?.joinCode || data?.code || '');
      if (data?.isLocalOnly) {
        throw new Error('That code belongs to a local test game. Create a live game to let another player join.');
      }
      if (!isGameSessionJoinable({ id: fresh.id, ...data })) {
        if (inviteId) await setGameInviteStatus(inviteId, { status: 'expired', gameStatus: data?.status || 'completed', expiredAt: serverTimestamp() });
        throw new Error(inviteId ? 'That invite is no longer available.' : 'No active game found for that join code.');
      }

      const playerUids = Array.isArray(data?.playerUids) ? data.playerUids.filter(Boolean) : [];
      const seats = data?.seats || {};
      const alreadyJoined = playerUids.includes(user.uid);
      const preferredSeat = preferredSeatForUser(user, profile);
      let targetSeat = seats.jay === user.uid ? 'jay' : seats.kim === user.uid ? 'kim' : '';
      if (!targetSeat && preferredSeat && !seats[preferredSeat]) {
        targetSeat = preferredSeat;
      }
      if (!targetSeat) {
        if (!seats.jay) targetSeat = 'jay';
        else if (!seats.kim) targetSeat = 'kim';
      }
      if (!alreadyJoined && playerUids.length >= 2 && !targetSeat) {
        throw new Error('This room already has two players.');
      }
      if (!targetSeat) {
        targetSeat = preferredSeat;
      }

      const nextPlayerUids = alreadyJoined ? playerUids : mergeUniqueIds(playerUids, [user.uid]);
      const nextSeats = {
        ...seats,
        [targetSeat]: user.uid,
      };
      const nextPlayerProfiles = {
        ...(data?.playerProfiles || {}),
        [user.uid]: {
          displayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || PLAYER_LABEL[targetSeat] || 'Player',
          seat: targetSeat,
          role: data?.hostUid === user.uid ? 'host' : 'player',
          photoURL: user.photoURL || '',
        },
      };

      const batch = writeBatch(firestore);
      batch.set(roomRef, {
        roomCode: data?.roomCode || data?.joinCode || data?.code || resolvedCode,
        code: data?.code || data?.joinCode || resolvedCode,
        joinCode: data?.joinCode || data?.code || resolvedCode,
        hostUid: data?.hostUid || user.uid,
        seats: nextSeats,
        playerUids: nextPlayerUids,
        playerProfiles: nextPlayerProfiles,
        status: 'active',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      batch.set(
        doc(firestore, 'games', targetGameId, 'players', user.uid),
        {
          uid: user.uid,
          displayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || PLAYER_LABEL[targetSeat] || 'Player',
          seat: targetSeat,
          role: data?.hostUid === user.uid ? 'host' : 'player',
          photoURL: user.photoURL || '',
          joinedAt: serverTimestamp(),
        },
        { merge: true },
      );
      if (inviteId) {
        batch.set(
          doc(firestore, 'gameInvites', inviteId),
          {
            status: 'accepted',
            gameStatus: 'active',
            joinedByUserId: user.uid,
            acceptedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }
      await batch.commit();

      if (!inviteId) {
        const linkedInviteId = buildGameInviteId(targetGameId, user.uid);
        if (linkedInviteId) {
          const linkedInviteSnap = await getDoc(doc(firestore, 'gameInvites', linkedInviteId)).catch(() => null);
          if (linkedInviteSnap?.exists()) {
            await setGameInviteStatus(linkedInviteId, {
              status: 'accepted',
              gameStatus: 'active',
              joinedByUserId: user.uid,
              acceptedAt: serverTimestamp(),
            });
          }
        }
      }

      const joinedSnap = await getDoc(roomRef);
      if (joinedSnap.exists()) {
        setGame({ id: joinedSnap.id, ...joinedSnap.data() });
        setRounds([]);
        setChatMessages([]);
        resolveRoomLoad(joinedSnap.id, inviteId ? 'join invite' : 'join game');
      }
      await persistActiveGame(targetGameId);
      setJoinCode('');
      setNotice(inviteId ? `Joined invited game ${resolvedCode || targetGameId}.` : `Joined game ${resolvedCode || targetGameId}.`);
    } catch (error) {
      debugRoom('joinGameFailed', { roomId: targetGameId, message: error?.message || String(error), inviteId });
      setGame(previousGame || null);
      setGameId(previousGameId || '');
      setRounds(previousRounds || []);
      setChatMessages(previousChatMessages || []);
      if (previousGameId) localStorage.setItem(activeGameKey, previousGameId);
      else localStorage.removeItem(activeGameKey);
      resetRoomLoadState();
      throw error;
    }
  };

  const joinGame = async () =>
    withBusy(async () => {
      const code = normalizeJoinCode(joinCode);
      if (!code.length) throw new Error('Enter a valid join code.');
      const activeRoom = await findJoinableGameByCode(code);
      if (!activeRoom?.id) throw new Error('No active game found for that join code.');
      await joinGameSessionById(activeRoom.id, { fallbackCode: code });
    }, 'Could not join game.');

  const acceptGameInviteAction = async (invite) =>
    withBusy(async () => {
      if (!invite?.gameId) throw new Error('This invite is missing a live game session.');
      await joinGameSessionById(invite.gameId, {
        fallbackCode: invite.roomCode || invite.joinCode || '',
        inviteId: invite.id || '',
      });
    }, 'Could not join invited game.');

  const dismissGameInviteAction = async (invite) =>
    withBusy(async () => {
      if (!invite?.id) throw new Error('This invite could not be dismissed.');
      const inviteStatus = invite.displayStatus || invite.status || 'pending';
      if (inviteStatus === 'pending') throw new Error('Active invites can only be joined, not dismissed.');
      await setGameInviteStatus(invite.id, {
        status: 'dismissed',
        gameStatus: invite.gameStatus || 'unavailable',
        dismissedAt: serverTimestamp(),
        dismissedByUserId: user?.uid || '',
      });
      setGameInvites((current) => current.filter((entry) => entry.id !== invite.id));
      setNotice('Invite dismissed.');
    }, 'Could not dismiss invite.');

  const resumeGame = async (nextGameId) => {
    if (!nextGameId) return;
    setLocalEndedGameSummary(null);
    autoResumedGameIdRef.current = '';
    armRoomLoadTimeout(nextGameId, 'resuming room');
    await persistActiveGame(nextGameId);
  };

  const leaveGame = async () => {
    autoResumedGameIdRef.current = '';
    if (isCurrentLocalTestGame) {
      leavePendingGameRef.current = '';
      setGameId('');
      localStorage.removeItem(activeGameKey);
      setGame(null);
      setRounds([]);
      setChatMessages([]);
      setConfirmAction(null);
      resetRoomLoadState();
      setNotice('Editing Mode room closed. Nothing was saved.');
      return;
    }
    leavePendingGameRef.current = gameId;
    if (user && firestore) {
      await setDoc(
        doc(firestore, 'users', user.uid),
        {
          uid: user.uid,
          displayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Player',
          email: user.email || '',
          photoURL: user.photoURL || '',
          activeGameId: '',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ).catch(() => null);
    }
    setGameId('');
    localStorage.removeItem(activeGameKey);
    setGame(null);
    setRounds([]);
    setChatMessages([]);
    resetRoomLoadState();
    setProfile((current) => (current ? { ...current, activeGameId: '' } : current));
    setNotice('Room closed locally. Game state stays on Firebase.');
  };

  const authSubmit = async () =>
    withBusy(async () => {
      if (!firebaseAuth) throw new Error('Firebase auth is not configured.');
      if (authMode === 'reset') {
        if (!authForm.resetEmail.trim()) throw new Error('Enter the email address to reset.');
        await sendPasswordResetEmail(firebaseAuth, authForm.resetEmail.trim());
        setNotice('Password reset email sent.');
        return;
      }

      if (authMode === 'signup') {
        if (!authForm.displayName.trim()) throw new Error('Enter a display name.');
        const credential = await createUserWithEmailAndPassword(firebaseAuth, authForm.email.trim(), authForm.password);
        await updateProfile(credential.user, { displayName: authForm.displayName.trim() });
        await setDoc(
          doc(firestore, 'users', credential.user.uid),
          {
            uid: credential.user.uid,
            displayName: authForm.displayName.trim(),
            email: credential.user.email || '',
            photoURL: credential.user.photoURL || '',
            lifetimePenaltyPoints: 0,
            activeGames: [],
            activeGameId: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        setNotice('Account created.');
        return;
      }

      await signInWithEmailAndPassword(firebaseAuth, authForm.email.trim(), authForm.password);
      setNotice('Signed in.');
    }, 'Could not complete authentication.');

  const signInGoogle = async () =>
    withBusy(async () => {
      if (!firebaseAuth) throw new Error('Firebase auth is not configured.');
      await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
    }, 'Could not sign in with Google.');

  const signOutUser = async () =>
    withBusy(async () => {
      if (!firebaseAuth) return;
      autoResumedGameIdRef.current = '';
      await signOut(firebaseAuth);
      setGameId('');
      localStorage.removeItem(activeGameKey);
    });

  const pauseToggle = async () => {
    if (isCurrentLocalTestGame) {
      setGame((current) =>
        current
          ? {
              ...current,
              status: current.status === 'paused' ? 'active' : 'paused',
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      return;
    }
    const gameRef = makeGameRef();
    if (!gameRef || !game) return;
    await setDoc(gameRef, {
      status: game.status === 'paused' ? 'active' : 'paused',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  const updateCurrentRound = async (nextRoundPatch) => {
    if (isCurrentLocalTestGame) {
      setGame((current) =>
        current?.currentRound
          ? {
              ...current,
              currentRound: {
                ...current.currentRound,
                ...nextRoundPatch,
                updatedAt: new Date().toISOString(),
              },
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      return;
    }
    const gameRef = makeGameRef();
    if (!gameRef || !game?.currentRound) return;
    await setDoc(gameRef, {
      currentRound: {
        ...game.currentRound,
        ...nextRoundPatch,
        updatedAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    }, { merge: true });
  };

  useEffect(() => {
    if (!game?.currentRound || inferredRole !== 'host') return undefined;
    const timeout = window.setTimeout(() => {
      updateCurrentRound({
        penalties: {
          jay: String(penaltyDraft.jay ?? ''),
          kim: String(penaltyDraft.kim ?? ''),
        },
      }).catch(() => null);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [penaltyDraft.jay, penaltyDraft.kim, game?.currentRound?.id, inferredRole]);

  const submitAnswer = async () =>
    withBusy(async () => {
      if (!game?.currentRound || !currentSeat) throw new Error('No active round to answer.');
      const currentAnswers = game.currentRound.answers || {};
      if (isCurrentLocalTestGame) {
        const otherSeat = currentSeat === 'jay' ? 'kim' : 'jay';
        const choiceOptions = inferChoiceOptions(game.currentRound);
        const nextAnswers = {
          ...currentAnswers,
          [currentSeat]: {
            ownAnswer: answerDraft.ownAnswer.trim(),
            guessedOther: answerDraft.guessedOther.trim(),
            submittedBy: user?.uid || '',
            displayName: profile?.displayName || user?.displayName || '',
            submittedAt: new Date().toISOString(),
          },
        };
        if (!nextAnswers[otherSeat]?.ownAnswer) {
          nextAnswers[otherSeat] = {
            ownAnswer: game.currentRound.roundType === 'numeric' ? '0' : choiceOptions[0] || 'Test mode response',
            guessedOther: answerDraft.ownAnswer.trim() || answerDraft.guessedOther.trim() || choiceOptions[1] || choiceOptions[0] || 'Test guess',
            submittedBy: 'editing-mode',
            displayName: otherSeat === 'kim' ? TEST_MODE_PLAYER_NAME : 'Jay (Test)',
            submittedAt: new Date().toISOString(),
            autoSubmitted: true,
          };
        }
        const bothAnswered = Boolean(nextAnswers.jay?.ownAnswer && nextAnswers.kim?.ownAnswer);
        setGame((current) =>
          current?.currentRound
            ? {
                ...current,
                currentRound: {
                  ...current.currentRound,
                  answers: nextAnswers,
                  status: bothAnswered ? 'reveal' : 'open',
                  updatedAt: new Date().toISOString(),
                },
                updatedAt: new Date().toISOString(),
              }
            : current,
        );
        setNotice('Answers submitted');
        return;
      }
      const nextAnswers = {
        ...currentAnswers,
        [currentSeat]: {
          ownAnswer: answerDraft.ownAnswer.trim(),
          guessedOther: answerDraft.guessedOther.trim(),
          submittedBy: user?.uid || '',
          displayName: profile?.displayName || user?.displayName || '',
          submittedAt: new Date().toISOString(),
        },
      };
      const bothAnswered = Boolean(nextAnswers.jay?.ownAnswer && nextAnswers.kim?.ownAnswer);
      await updateCurrentRound({
        answers: nextAnswers,
        status: bothAnswered ? 'reveal' : 'open',
      });
      setNotice('Answers submitted');
    }, 'Could not submit answer.');

  const drawQuestion = (sourceGame = game, sourceRounds = rounds) => {
    const localUsedQuestionIds = mergeUniqueIds(
      sourceGame?.usedQuestionIds || [],
      (sourceRounds || []).map((round) => round.questionId),
    );
    const usedIds = new Set(localUsedQuestionIds);
    if (sourceGame?.currentRound?.questionId) usedIds.add(sourceGame.currentRound.questionId);
    const previousQuestionId = sourceGame?.currentRound?.questionId || sourceRounds.at(-1)?.questionId || null;
    const questionQueueIds = Array.isArray(sourceGame?.questionQueueIds) ? sourceGame.questionQueueIds.filter(Boolean) : [];
    const availablePool = bankQuestions.filter(
      (question) =>
        !trackedUsedQuestionIds.has(question.id)
        && !reservedQuestionIds.has(question.id)
        && !usedIds.has(question.id),
    );
    const candidateQuestions = availablePool.length
      ? availablePool
      : bankQuestions.length
        ? []
        : STARTER_QUESTIONS.map((question) => createQuestionTemplate(question));
    const queuePool = questionQueueIds
      .map((id) => bankQuestions.find((question) => question.id === id))
      .filter((question) => question && !usedIds.has(question.id) && question.id !== previousQuestionId);
    if (queuePool.length) {
      return { question: queuePool[0], remainingQueueIds: questionQueueIds.filter((id) => id !== queuePool[0].id) };
    }

    const freshPool = candidateQuestions.filter((question) => !usedIds.has(question.id) && question.id !== previousQuestionId);
    const fallbackPool =
      freshPool.length > 0
        ? freshPool
        : candidateQuestions.filter((question) => question.id !== previousQuestionId);
    const shuffledPool = pickDiverseQuestions(fallbackPool.length ? fallbackPool : candidateQuestions, 1);
    const nextQuestion = shuffledPool[0] || null;
    return {
      question: nextQuestion,
      remainingQueueIds: (fallbackPool.length ? fallbackPool : candidateQuestions)
        .filter((question) => question.id !== nextQuestion?.id)
        .map((question) => question.id),
    };
  };

  const nextQuestion = async () =>
    withBusy(async () => {
      if (!game) throw new Error('No room open.');
      if (isCurrentLocalTestGame) {
        const completedRoundsBefore = Math.max(Number(game.roundsPlayed || 0), rounds.length);
        const totalQuestionGoal = getGameQuestionGoal(game, rounds);

        if (!game.currentRound && totalQuestionGoal > 0 && completedRoundsBefore >= totalQuestionGoal) {
          await completeCurrentGameFromNextQuestion('Game complete. Summary is now shown in the room.');
          return;
        }

        let nextRounds = rounds;
        let nextTotals = game.totals || { jay: 0, kim: 0 };
        let nextRoundsPlayed = completedRoundsBefore;
        let nextUsedQuestionIds = mergeUniqueIds(game.usedQuestionIds || [], rounds.map((round) => round.questionId));
        let nextGameState = { ...game };
        let savedCurrentRound = false;

        if (game.currentRound) {
          const penalties = toPenaltyScores(penaltyDraft);

          const roundResult = createRoundResult(
            {
              ...game.currentRound,
              penaltyAdded: penalties,
              scores: penalties,
              actualAnswers: {
                jay: game.currentRound.answers?.jay?.ownAnswer || '',
                kim: game.currentRound.answers?.kim?.ownAnswer || '',
              },
              guessedAnswers: {
                jay: game.currentRound.answers?.jay?.guessedOther || '',
                kim: game.currentRound.answers?.kim?.guessedOther || '',
              },
              actualList: {
                jay: parseAnswerList(game.currentRound.answers?.jay?.ownAnswer || ''),
                kim: parseAnswerList(game.currentRound.answers?.kim?.ownAnswer || ''),
              },
              guessedList: {
                jay: parseAnswerList(game.currentRound.answers?.jay?.guessedOther || ''),
                kim: parseAnswerList(game.currentRound.answers?.kim?.guessedOther || ''),
              },
            },
            game.currentRound.number || rounds.length + 1,
            nextTotals,
          );

          nextRounds = normalizeStoredRounds([...rounds, roundResult]);
          nextTotals = getRoundPenaltyTotals(roundResult);
          nextRoundsPlayed = nextRounds.length;
          nextUsedQuestionIds = mergeUniqueIds(nextUsedQuestionIds, game.currentRound.questionId, nextRounds.map((round) => round.questionId));
          nextGameState = {
            ...nextGameState,
            totals: nextTotals,
            roundsPlayed: nextRoundsPlayed,
            usedQuestionIds: nextUsedQuestionIds,
            currentRound: null,
            status: game.status === 'paused' ? 'paused' : 'active',
            updatedAt: new Date().toISOString(),
          };
          savedCurrentRound = true;

          if (totalQuestionGoal > 0 && nextRoundsPlayed >= totalQuestionGoal) {
            await completeCurrentGameFromNextQuestion('Final round saved. Summary is now shown in the room.');
            return;
          }
        }

        if (game.status !== 'completed') {
          const drawn = drawQuestion(nextGameState, nextRounds);
          const nextQuestionItem = drawn.question;
          if (!nextQuestionItem) {
            await completeCurrentGameFromNextQuestion(
              savedCurrentRound
                ? 'Final round saved. Summary is now shown in the room.'
                : 'Game complete. Summary is now shown in the room.',
            );
            return;
          }
          const nextRoundNumber = Math.max(
            nextRoundsPlayed + 1,
            Number(nextGameState.currentRound?.number || 0) + 1,
            1,
          );
          const nextRound = {
            id: makeId('round'),
            number: nextRoundNumber,
            questionId: nextQuestionItem.id,
            question: nextQuestionItem.question,
            category: nextQuestionItem.category || '',
            roundType: nextQuestionItem.roundType || 'numeric',
            defaultAnswerType: nextQuestionItem.defaultAnswerType || getDefaultAnswerType(nextQuestionItem.roundType),
            multipleChoiceOptions: nextQuestionItem.multipleChoiceOptions || [],
            notes: nextQuestionItem.notes || '',
            tags: nextQuestionItem.tags || [],
            unitLabel: nextQuestionItem.unitLabel || '',
            status: 'open',
            answers: {},
            penalties: { jay: '', kim: '' },
            createdAt: new Date().toISOString(),
          };
          nextGameState = {
            ...nextGameState,
            totals: nextTotals,
            roundsPlayed: nextRoundsPlayed,
            usedQuestionIds: nextUsedQuestionIds,
            currentRound: nextRound,
            questionQueueIds: drawn.remainingQueueIds,
            status: 'active',
            updatedAt: new Date().toISOString(),
          };
          setRounds(nextRounds);
          setGame(nextGameState);
          setNotice(savedCurrentRound ? 'Saved and loaded the next question.' : 'Question loaded.');
        }
        return;
      }
      const gameRef = makeGameRef();
      if (!gameRef) throw new Error('Room is missing.');
      const completedRoundsBefore = Math.max(Number(game.roundsPlayed || 0), rounds.length);
      const totalQuestionGoal = getGameQuestionGoal(game, rounds);

      if (!game.currentRound && totalQuestionGoal > 0 && completedRoundsBefore >= totalQuestionGoal) {
        await completeCurrentGameFromNextQuestion();
        return;
      }

      const totalsBefore = game.totals || { jay: 0, kim: 0 };
      let completedRoundsAfterSave = completedRoundsBefore;
      let savedCurrentRound = false;

      if (game.currentRound) {
        const penalties = toPenaltyScores(penaltyDraft);

        const roundResult = createRoundResult(
          {
            ...game.currentRound,
            penaltyAdded: penalties,
            scores: penalties,
            actualAnswers: {
              jay: game.currentRound.answers?.jay?.ownAnswer || '',
              kim: game.currentRound.answers?.kim?.ownAnswer || '',
            },
            guessedAnswers: {
              jay: game.currentRound.answers?.jay?.guessedOther || '',
              kim: game.currentRound.answers?.kim?.guessedOther || '',
            },
            actualList: {
              jay: parseAnswerList(game.currentRound.answers?.jay?.ownAnswer || ''),
              kim: parseAnswerList(game.currentRound.answers?.kim?.ownAnswer || ''),
            },
            guessedList: {
              jay: parseAnswerList(game.currentRound.answers?.jay?.guessedOther || ''),
              kim: parseAnswerList(game.currentRound.answers?.kim?.guessedOther || ''),
            },
          },
          game.currentRound.number || rounds.length + 1,
          totalsBefore,
        );

        await setDoc(doc(firestore, 'games', gameId, 'rounds', roundResult.id), roundResult);
        const totalsAfter = getRoundPenaltyTotals(roundResult);
        completedRoundsAfterSave = completedRoundsBefore + 1;
        savedCurrentRound = true;
        await setDoc(gameRef, {
          totals: totalsAfter,
          roundsPlayed: completedRoundsAfterSave,
          usedQuestionIds: arrayUnion(game.currentRound.questionId),
          currentRound: null,
          status: game.status === 'paused' ? 'paused' : 'active',
          updatedAt: serverTimestamp(),
        }, { merge: true });

        if (totalQuestionGoal > 0 && completedRoundsAfterSave >= totalQuestionGoal) {
          await completeCurrentGameFromNextQuestion('Final round saved. Game ended and moved to Previous Games.');
          return;
        }
      }

      if (game.status !== 'completed') {
        const drawn = drawQuestion();
        const nextQuestionItem = drawn.question;
        if (!nextQuestionItem) {
          await completeCurrentGameFromNextQuestion(
            savedCurrentRound
              ? 'Final round saved. Game ended and moved to Previous Games.'
              : 'Game ended and moved to Previous Games.',
          );
          return;
        }
        if (!Array.isArray(game.questionQueueIds) || !game.questionQueueIds.includes(nextQuestionItem.id)) {
          await updateQuestionBankUsage([nextQuestionItem], true);
        }
        const nextRoundNumber = Math.max(
          completedRoundsAfterSave + 1,
          Number(game.currentRound?.number || 0) + 1,
          1,
        );
        const nextRound = {
          id: makeId('round'),
          number: nextRoundNumber,
          questionId: nextQuestionItem.id,
          question: nextQuestionItem.question,
          category: nextQuestionItem.category || '',
          roundType: nextQuestionItem.roundType || 'numeric',
          defaultAnswerType: nextQuestionItem.defaultAnswerType || getDefaultAnswerType(nextQuestionItem.roundType),
          multipleChoiceOptions: nextQuestionItem.multipleChoiceOptions || [],
          notes: nextQuestionItem.notes || '',
          tags: nextQuestionItem.tags || [],
          unitLabel: nextQuestionItem.unitLabel || '',
          status: 'open',
          answers: {},
          penalties: { jay: '', kim: '' },
          createdAt: new Date().toISOString(),
        };
        await setDoc(gameRef, {
          currentRound: nextRound,
          questionQueueIds: drawn.remainingQueueIds,
          status: 'active',
          updatedAt: serverTimestamp(),
        }, { merge: true });
        if (savedCurrentRound) setNotice('Saved and loaded the next question.');
        else setNotice('Question loaded.');
      }
    }, 'Could not move to the next question.');

  const sendChat = async () =>
    withBusy(async () => {
      const text = chatDraft.trim();
      if (!text) return;
      if (isCurrentLocalTestGame) {
        const seat = seatForUid(game, user?.uid) || 'neutral';
        setChatMessages((current) => [
          ...current,
          {
            id: makeId('chat'),
            text,
            uid: user?.uid || '',
            displayName: profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player',
            seat,
            role: roleForUid(game, user?.uid) || 'guest',
            createdAt: new Date().toISOString(),
          },
        ]);
        setChatDraft('');
        return;
      }
      if (!gameId || !user || !firestore) throw new Error('Open a room before chatting.');
      const seat = seatForUid(game, user.uid) || 'neutral';
      const messageRef = doc(collection(doc(firestore, 'games', gameId), 'chatMessages'));
      await setDoc(messageRef, {
        text,
        uid: user.uid,
        displayName: profile?.displayName || user.displayName || user.email?.split('@')[0] || 'Player',
        seat,
        role: roleForUid(game, user.uid) || 'guest',
        createdAt: new Date().toISOString(),
      });
      setChatDraft('');
    }, 'Could not send chat message.');

  const addQuestion = async () =>
    withBusy(async () => {
      if (!bankDraft.question.trim()) throw new Error('Enter a question first.');
      const template = createQuestionTemplate({
        question: bankDraft.question,
        category: bankDraft.category,
        roundType: bankDraft.roundType,
        tags: bankDraft.tags,
        notes: bankDraft.notes,
        source: 'manual',
      });
      await setDoc(doc(firestore, 'questionBank', template.id), template);
      setBankDraft(defaultBankDraft);
      setNotice('Question added to the bank.');
    }, 'Could not add question.');

  const importSheet = async () =>
    withBusy(async () => {
      const result = await syncGoogleSheetQuestions({
        sheetValue: sheetInput || DEFAULT_SETTINGS.googleSheetInput,
        existingQuestions: bankQuestions,
        overwriteExisting: false,
      });
      await upsertQuestionBankBatch(firestore, [...result.imports, ...result.updates]);
      const nextBankCount = bankQuestions.length + result.summary.imported;
      setSyncNotice(
        `Imported ${result.summary.imported} new, skipped ${result.summary.skipped}, duplicates ${result.summary.duplicates}, invalid ${result.summary.invalid}. Bank now tracks about ${nextBankCount} questions.`,
      );
      setNotice(`Question import complete: ${result.summary.imported} new questions added.`);
    }, 'Could not import questions from the Google Sheet.');

  const syncSheet = async () =>
    withBusy(async () => {
      const result = await syncGoogleSheetQuestions({
        sheetValue: sheetInput || DEFAULT_SETTINGS.googleSheetInput,
        existingQuestions: bankQuestions,
        overwriteExisting: true,
      });
      await upsertQuestionBankBatch(firestore, [...result.imports, ...result.updates]);
      const nextBankCount = bankQuestions.length + result.summary.imported;
      setSyncNotice(
        `Synced question bank: ${result.summary.imported} new, ${result.summary.updated} updated, ${result.summary.duplicates} duplicates, ${result.summary.invalid} invalid. Bank now tracks about ${nextBankCount} questions.`,
      );
      setNotice('Question bank synced from Google Sheet.');
    }, 'Could not sync the question bank.');

  if (authLoading) {
    return (
      <main className="app production-app">
        <div className="toast">Loading Firebase session…</div>
      </main>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        mode={authMode}
        form={authForm}
        onFormChange={(patch) => setAuthForm((current) => ({ ...current, ...patch }))}
        onModeChange={setAuthMode}
        onSubmit={authSubmit}
        onReset={() => setAuthMode('login')}
        isBusy={isBusy}
        notice={notice}
      />
    );
  }

  if (roomLoadState.status === 'error' && !shouldBypassMobileAutoResumeRoom) {
    return (
      <main className="app production-app lobby-loading-screen">
        <div className="panel lobby-panel lobby-panel--active">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Opening Game</p>
              <h2>Room failed to load</h2>
            </div>
            <span className="status-pill">Error</span>
          </div>
          <p className="panel-copy">{roomLoadState.message || 'The live room failed to connect.'}</p>
          <div className="button-row">
            <Button
              className="ghost-button compact"
              onClick={() => {
                debugRoom('roomLoadRetry', { gameId: roomLoadState.gameId });
                resetRoomLoadState();
                setGame(null);
                setRounds([]);
                setChatMessages([]);
                if (roomLoadState.gameId) setGameId(roomLoadState.gameId);
              }}
            >
              Retry
            </Button>
            <Button
              className="primary-button compact"
              onClick={() => {
                setGameId('');
                localStorage.removeItem(activeGameKey);
                setGame(null);
                setRounds([]);
                setChatMessages([]);
                resetRoomLoadState();
              }}
            >
              Return to Lobby
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if ((gameId || game) && !inferredRole && !shouldBypassMobileAutoResumeRoom) {
    return (
      <main className="app production-app lobby-loading-screen">
        <div className="panel lobby-panel lobby-panel--active">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Opening Game</p>
              <h2>{roomLoadState.status === 'error' ? 'Room failed to load' : 'Loading room…'}</h2>
            </div>
            <span className="status-pill">{roomLoadState.status === 'error' ? 'Error' : 'Connecting'}</span>
          </div>
          <p className="panel-copy">
            {roomLoadState.status === 'error'
              ? roomLoadState.message || 'The live room failed to connect.'
              : `The room has been created. Loading the live game board now.${roomLoadState.reason ? ` (${roomLoadState.reason})` : ''}`}
          </p>
          <div className="button-row">
            <Button
              className="ghost-button compact"
              onClick={() => {
                setGameId('');
                localStorage.removeItem(activeGameKey);
                setGame(null);
                setRounds([]);
                setChatMessages([]);
                resetRoomLoadState();
              }}
            >
              Return to Lobby
            </Button>
            <Button
              className="primary-button compact"
              onClick={() => {
                const retryGameId = roomLoadState.gameId || gameId || game?.id;
                if (retryGameId) {
                  debugRoom('roomLoadManualRetry', { gameId: retryGameId });
                  armRoomLoadTimeout(retryGameId, 'manual retry');
                  setGameId(retryGameId);
                }
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const shouldSuppressCompletedAutoResume = Boolean(
    game?.id
    && COMPLETED_GAME_STATUSES.includes(game.status)
    && autoResumedGameIdRef.current === game.id,
  );

  if (!(gameId || game) || !inferredRole || shouldSuppressCompletedAutoResume || shouldBypassMobileAutoResumeRoom) {
    return (
      <LobbyScreen
        user={user}
        profile={profile}
        questionNotes={questionNotes}
        onSaveDisplayName={saveDisplayNameProfile}
        playerAccounts={playerAccounts}
        editingModeEnabled={editingModeEnabled}
        onToggleEditingMode={toggleEditingMode}
        currentPlayerSeat={dashboardSeat}
        currentPlayerLifetimeLabel={currentPlayerLifetimeLabel}
        pendingActivityCount={pendingActivityCount}
        questionCategories={lobbyCategoryOptions}
        gameName={lobbyGameName}
        gameQuestionCount={lobbyQuestionCount}
        createCode={lobbyCode}
        joinCode={joinCode}
        onCreateCodeChange={setLobbyCode}
        onJoinCodeChange={setJoinCode}
        onGameNameChange={setLobbyGameName}
        onGameQuestionCountChange={setLobbyQuestionCount}
        onCreateGame={createGame}
        onJoinGame={joinGame}
        onJoinGameInvite={acceptGameInviteAction}
        onDismissGameInvite={dismissGameInviteAction}
        onSyncQuestionBank={syncSheet}
        onImportQuestions={importSheet}
        onResumeGame={resumeGame}
        onViewSummary={setSelectedGameId}
        onEndGame={requestEndGame}
        onDeleteGame={requestDeleteGame}
        onResetBalances={resetLifetimeBalancesAction}
        onSignOut={signOutUser}
        activeGames={activeGames}
        previousGames={previousGames}
        lobbyAnalytics={lobbyAnalytics}
        lobbyRoundAnalytics={lobbyRoundAnalytics}
        categoryColorMap={categoryColorMap}
        bankCount={bankCount}
        questionCount={bankQuestions.length || STARTER_QUESTIONS.length}
        usedQuestionCount={usedQuestionCount}
        remainingQuestionCount={remainingQuestionCount}
        unusedQuestionCount={unusedQuestionCount}
        syncNotice={syncNotice}
        gameInvites={incomingGameInvites}
        pendingRedemptions={pendingRedemptions}
        requestAlerts={pendingForfeitRequestAlerts}
        responseAlerts={pendingForfeitResponseAlerts}
        amaRequests={amaRequests}
        diaryEntries={diaryEntries}
        pendingAmaInbox={pendingAmaInbox}
        pendingAmaOutbox={pendingAmaOutbox}
        onMarkRedemptionSeen={markRedemptionSeenAction}
        onMarkRedemptionCompleted={markRedemptionCompletedAction}
        redemptionItems={redemptionItems}
        redemptionHistory={redemptionHistory}
        forfeitPriceRequests={forfeitPriceRequests}
        onSaveRedemptionItem={saveRedemptionItemAction}
        onDeleteRedemptionItem={deleteRedemptionItemAction}
        onToggleRedemptionItemActive={toggleRedemptionItemActiveAction}
        onRedeemRedemptionItem={redeemRedemptionItemAction}
        onSubmitAmaQuestion={submitAmaQuestionAction}
        onAnswerAmaRequest={answerAmaRequestAction}
        onCreateForfeitRequest={createForfeitPriceRequestAction}
        onDeleteForfeitRequest={deleteForfeitPriceRequestAction}
        onUpdateForfeitRequest={updateForfeitPriceRequestAction}
        onMarkRequestSeen={(requestId) => markForfeitRequestSeenAction(requestId, 'request')}
        onMarkResponseSeen={(requestId) => markForfeitRequestSeenAction(requestId, 'response')}
        onMarkAmaQuestionSeen={markAmaQuestionSeenAction}
        onMarkAmaAnswerSeen={markAmaAnswerSeenAction}
        onRespondToForfeitRequest={respondToForfeitRequestAction}
        isBusy={isBusy}
        selectedGameSummary={activeSummaryModal}
        onCloseSummary={() => {
          setSelectedGameId('');
          setLocalEndedGameSummary(null);
        }}
        confirmAction={confirmAction}
        onConfirmAction={confirmGameAction}
        onCancelAction={cancelGameAction}
        onResetQuestionBank={resetQuestionBankAction}
      />
    );
  }

  return (
    <GameRoomView
      user={user}
      profile={profile}
      game={game}
      rounds={rounds}
      bankQuestions={bankQuestions}
      editingModeEnabled={editingModeEnabled}
      onToggleEditingMode={toggleEditingMode}
      role={inferredRole}
      seat={inferredSeat}
      onLeaveGame={leaveGame}
      onEndGame={() => requestEndGame(game?.id)}
      onPauseToggle={pauseToggle}
      onNextQuestion={nextQuestion}
      onSubmitAnswer={submitAnswer}
      onAddQuestion={addQuestion}
      onSyncSheet={syncSheet}
      onImportSheet={importSheet}
      onSignOut={signOutUser}
      confirmAction={confirmAction}
      onConfirmAction={confirmGameAction}
      onCancelAction={cancelGameAction}
      isBusy={isBusy}
      currentRound={currentRound}
      penaltyDraft={penaltyDraft}
      setPenaltyDraft={setPenaltyDraft}
      answerDraft={answerDraft}
      setAnswerDraft={setAnswerDraft}
      bankDraft={bankDraft}
      setBankDraft={setBankDraft}
      syncNotice={syncNotice}
      bankCount={bankCount}
      notice={notice}
      chatMessages={chatMessages}
      chatDraft={chatDraft}
      setChatDraft={setChatDraft}
      onSendChat={sendChat}
      onSaveQuestionNote={savePrivateQuestionNote}
    />
  );
}

export default ProductionApp;
