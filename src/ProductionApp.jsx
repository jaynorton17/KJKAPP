import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  limitToLast,
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
import { parseGoogleSheetImport, parseGoogleSheetQuizImport, parseGoogleSheetReference } from './utils/importers.js';

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
const QUIZ_TIMER_SECONDS = 10;
const QUIZ_WHEEL_SLOT_COUNT = 20;
const QUIZ_WHEEL_MAX_AMOUNT = 2500;
const QUIZ_WHEEL_COUNTDOWN_MS = 5000;
const QUIZ_WHEEL_SPIN_MS = 5000;
const QUIZ_SETUP_COUNTDOWN_MS = 3000;
const QUIZ_REVEAL_FLASH_MS = 3000;
const normalizeQuizAnswerText = (value = '') =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const evaluateQuizAnswer = (round = {}, answerValue = '') => {
  const roundType = normalizeText(round?.roundType || '').toLowerCase();
  const answer = normalizeQuizAnswerText(answerValue);
  const correct = normalizeQuizAnswerText(round?.correctAnswer || round?.normalizedCorrectAnswer || '');
  if (!answer || !correct) return false;
  if (roundType === 'truefalse') {
    const normalizedAnswer = answer === 'true' ? 'true' : answer === 'false' ? 'false' : answer;
    const normalizedCorrect = correct === 'true' ? 'true' : correct === 'false' ? 'false' : correct;
    return normalizedAnswer === normalizedCorrect;
  }
  return answer === correct;
};
const pointsFromTimerSeconds = (secondsLeft = 0) => {
  const safeSeconds = Math.max(0, Math.min(QUIZ_TIMER_SECONDS, Number(secondsLeft || 0)));
  return Math.round(safeSeconds * 100);
};

const pointsFromTimerMilliseconds = (millisecondsLeft = 0) => {
  const safeMs = Math.max(0, Math.min(QUIZ_TIMER_SECONDS * 1000, Number(millisecondsLeft || 0)));
  return Math.floor(safeMs / 10);
};
const defaultQuizReadyState = (stage = 'opening') => ({
  stage,
  ready: { jay: false, kim: false },
  countdownStartedAt: '',
  countdownEndsAt: '',
});
const defaultQuizWagerAgreement = () => ({
  status: 'negotiating',
  requestKind: '',
  amount: null,
  proposedAmount: null,
  proposedBySeat: '',
  wheelRequestedBySeat: '',
  wheelRequestedByUserId: '',
  wheelRequestedByName: '',
  proposalStatus: '',
  rejectedBySeat: '',
  acceptedBySeat: '',
  wheelOptIn: { jay: false, kim: false },
  wheelBaseAmount: 0,
  wheelSlots: [],
  wheelResultIndex: null,
  wheelResultAmount: null,
  wheelCountdownStartedAt: '',
  wheelSpinStartedAt: '',
  wheelSpinEndsAt: '',
  lockedByWheel: false,
});
const parseQuizWagerAmountInput = (value) => {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return { valid: false, code: 'missing', amount: null };
  if (!/^-?\d+$/.test(rawValue)) return { valid: false, code: 'invalid', amount: null };
  const parsedAmount = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedAmount)) return { valid: false, code: 'invalid', amount: null };
  if (parsedAmount < 0) return { valid: false, code: 'negative', amount: parsedAmount };
  return { valid: true, code: '', amount: parsedAmount };
};
const sanitizeQuizWagerAmount = (value) => Math.max(0, Number.parseInt(String(value ?? ''), 10) || 0);
const capQuizWheelStake = (baseAmount = QUIZ_WHEEL_MAX_AMOUNT, stakeAmount = 0) => {
  const safeBase = Math.max(1, Math.floor(Number(baseAmount || QUIZ_WHEEL_MAX_AMOUNT)) || QUIZ_WHEEL_MAX_AMOUNT);
  const safeStake = Math.max(0, Math.floor(Number(stakeAmount || 0)));
  return Math.min(safeStake, safeBase);
};
const capQuizWagerAmount = (value = 0, capAmount = 0) => {
  const safeCap = Math.max(0, Math.floor(Number(capAmount || 0)));
  const safeValue = sanitizeQuizWagerAmount(value);
  return Math.min(safeValue, safeCap);
};
const buildQuizWheelSlots = (baseAmount = QUIZ_WHEEL_MAX_AMOUNT) => {
  const safeBase = Math.max(QUIZ_WHEEL_SLOT_COUNT, Math.floor(Number(baseAmount || QUIZ_WHEEL_MAX_AMOUNT)) || QUIZ_WHEEL_MAX_AMOUNT);
  const slots = new Set();
  while (slots.size < QUIZ_WHEEL_SLOT_COUNT) {
    slots.add(1 + Math.floor(Math.random() * safeBase));
  }
  return [...slots];
};
const shuffleQuizWheelSlots = (slots = []) => {
  const shuffled = [...slots];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[targetIndex]] = [shuffled[targetIndex], shuffled[index]];
  }
  return shuffled;
};
const getQuizWheelBaseAmount = (playerAccounts = {}) => {
  const jayAmount = Math.max(0, Math.floor(Number(playerAccounts?.jay?.lifetimePenaltyPoints || 0)));
  const kimAmount = Math.max(0, Math.floor(Number(playerAccounts?.kim?.lifetimePenaltyPoints || 0)));
  return Math.min(jayAmount, kimAmount);
};
const getQuizWagerValidationMessage = (value, capAmount = 0, { requireDifferentFrom = null } = {}) => {
  const parsed = parseQuizWagerAmountInput(value);
  if (!parsed.valid) {
    if (parsed.code === 'missing') return 'Enter a wager amount.';
    if (parsed.code === 'negative') return 'Wager must be at least 0.';
    return 'Enter a valid whole number.';
  }
  const safeCapAmount = Math.max(0, Math.floor(Number(capAmount || 0)));
  if (parsed.amount > safeCapAmount) return `Wager cannot exceed ${formatScore(safeCapAmount)}.`;
  if (Number.isFinite(Number(requireDifferentFrom)) && parsed.amount === Math.max(0, Math.floor(Number(requireDifferentFrom)))) {
    return 'Counter must be different from the current proposal.';
  }
  return '';
};
const normalizeQuizWagerAgreement = (game = {}) => {
  const agreement = game?.quizWagerAgreement || null;
  const fallbackWagers = game?.quizWagers || {};
  const fallbackJay = Number(fallbackWagers.jay);
  const fallbackKim = Number(fallbackWagers.kim);
  if (!agreement) {
    const hasSharedFallback = Number.isFinite(fallbackJay)
      && Number.isFinite(fallbackKim)
      && fallbackJay === fallbackKim
      && (fallbackJay > 0 || Boolean(game?.currentRound) || Number(game?.roundsPlayed || 0) > 0);
    return {
      ...defaultQuizWagerAgreement(),
      status: hasSharedFallback ? 'agreed' : 'negotiating',
      amount: hasSharedFallback ? Math.max(0, fallbackJay) : null,
    };
  }
  const status = normalizeText(agreement.status || 'negotiating') || 'negotiating';
  const amount = Number(agreement.amount);
  const proposedAmount = Number(agreement.proposedAmount);
  const wheelBaseAmount = Math.max(0, Math.floor(Number(agreement.wheelBaseAmount || 0)));
  return {
    ...defaultQuizWagerAgreement(),
    ...agreement,
    status,
    requestKind: agreement.requestKind === 'wheel' ? 'wheel' : agreement.requestKind === 'manual' ? 'manual' : '',
    amount: Number.isFinite(amount) ? Math.max(0, amount) : null,
    proposedAmount: Number.isFinite(proposedAmount) ? Math.max(0, proposedAmount) : null,
    proposedBySeat: agreement.proposedBySeat === 'kim' ? 'kim' : agreement.proposedBySeat === 'jay' ? 'jay' : '',
    wheelRequestedBySeat: agreement.wheelRequestedBySeat === 'kim' ? 'kim' : agreement.wheelRequestedBySeat === 'jay' ? 'jay' : '',
    wheelRequestedByUserId: String(agreement.wheelRequestedByUserId || '').trim(),
    wheelRequestedByName: String(agreement.wheelRequestedByName || '').trim(),
    rejectedBySeat: agreement.rejectedBySeat === 'kim' ? 'kim' : agreement.rejectedBySeat === 'jay' ? 'jay' : '',
    acceptedBySeat: agreement.acceptedBySeat === 'kim' ? 'kim' : agreement.acceptedBySeat === 'jay' ? 'jay' : '',
    wheelOptIn: {
      jay: Boolean(agreement.wheelOptIn?.jay),
      kim: Boolean(agreement.wheelOptIn?.kim),
    },
    wheelBaseAmount,
    wheelSlots: Array.isArray(agreement.wheelSlots)
      ? agreement.wheelSlots.map((slot) => capQuizWheelStake(QUIZ_WHEEL_MAX_AMOUNT, slot))
      : [],
    wheelResultIndex: Number.isFinite(Number(agreement.wheelResultIndex)) ? Number(agreement.wheelResultIndex) : null,
    wheelResultAmount: Number.isFinite(Number(agreement.wheelResultAmount)) ? Math.max(0, Number(agreement.wheelResultAmount)) : null,
    lockedByWheel: Boolean(agreement.lockedByWheel),
  };
};
const getQuizSharedWagerAmount = (game = {}) => {
  const agreement = normalizeQuizWagerAgreement(game);
  const amount = Number(agreement.amount);
  if (Number.isFinite(amount)) return Math.max(0, amount);
  const wheelResultAmount = Number(agreement.wheelResultAmount);
  if (Number.isFinite(wheelResultAmount) && (agreement.lockedByWheel || agreement.status === 'wheel_countdown')) {
    return Math.max(0, wheelResultAmount);
  }
  const resultIndex = Number(agreement.wheelResultIndex);
  if (agreement.status === 'wheel_countdown' && Number.isFinite(resultIndex) && Array.isArray(agreement.wheelSlots) && agreement.wheelSlots.length) {
    return Math.max(0, Number(agreement.wheelSlots[Math.max(0, Math.min(agreement.wheelSlots.length - 1, resultIndex))] || 0));
  }
  return null;
};
const isQuizWagerAgreementLocked = (game = {}) => {
  const agreement = normalizeQuizWagerAgreement(game);
  return (agreement.status === 'agreed' || agreement.status === 'wheel_locked') && Number.isFinite(Number(agreement.amount));
};
const getQuizWheelPhase = (agreement = {}, nowMs = Date.now()) => {
  const normalized = normalizeQuizWagerAgreement({ quizWagerAgreement: agreement });
  if (normalized.status === 'wheel_locked') return 'locked';
  if (normalized.status !== 'wheel_countdown') return '';
  const spinStartMs = Date.parse(normalized.wheelSpinStartedAt || '');
  const spinEndMs = Date.parse(normalized.wheelSpinEndsAt || '');
  if (!Number.isFinite(spinStartMs) || !Number.isFinite(spinEndMs)) return '';
  if (nowMs < spinStartMs) return 'countdown';
  if (nowMs < spinEndMs) return 'spinning';
  return 'landing';
};
const isQuizWagerEffectivelyLocked = (game = {}, nowMs = Date.now()) => {
  if (isQuizWagerAgreementLocked(game)) return true;
  const agreement = normalizeQuizWagerAgreement(game);
  if (agreement.status !== 'wheel_countdown') return false;
  const spinEndsAtMs = Date.parse(agreement.wheelSpinEndsAt || '');
  if (!Number.isFinite(spinEndsAtMs) || nowMs < spinEndsAtMs) return false;
  return Number.isFinite(Number(getQuizSharedWagerAmount(game)));
};
const getQuizWagerAgreementRank = (agreement = {}) => {
  const normalized = normalizeQuizWagerAgreement({ quizWagerAgreement: agreement });
  if (normalized.status === 'agreed' || normalized.status === 'wheel_locked') return 3;
  if (normalized.status === 'wheel_countdown') return 2;
  if (normalized.status === 'proposal_pending' || normalized.status === 'wheel_pending') return 1;
  return 0;
};
const getQuizReadyStageRank = (stage = 'opening') => {
  const normalizedStage = normalizeText(stage || 'opening') || 'opening';
  if (normalizedStage === 'countdown') return 2;
  if (normalizedStage === 'ready') return 1;
  return 0;
};
const mergeQuizReadyStateSnapshot = (currentReadyState = null, incomingReadyState = null) => {
  if (!currentReadyState && !incomingReadyState) return null;
  const currentState = currentReadyState || defaultQuizReadyState('opening');
  const incomingState = incomingReadyState || defaultQuizReadyState('opening');
  const currentRank = getQuizReadyStageRank(currentState.stage);
  const incomingRank = getQuizReadyStageRank(incomingState.stage);
  const preferCurrent = currentRank > incomingRank;
  const ready = {
    jay: Boolean(currentState.ready?.jay || incomingState.ready?.jay),
    kim: Boolean(currentState.ready?.kim || incomingState.ready?.kim),
  };
  return {
    ...(preferCurrent ? incomingState : currentState),
    ...(preferCurrent ? currentState : incomingState),
    stage: preferCurrent ? currentState.stage : incomingState.stage,
    ready,
    countdownStartedAt: preferCurrent
      ? (currentState.countdownStartedAt || incomingState.countdownStartedAt || '')
      : (incomingState.countdownStartedAt || currentState.countdownStartedAt || ''),
    countdownEndsAt: preferCurrent
      ? (currentState.countdownEndsAt || incomingState.countdownEndsAt || '')
      : (incomingState.countdownEndsAt || currentState.countdownEndsAt || ''),
  };
};
const hasNextReadySeat = (round = null, seat = 'jay') => Boolean(round?.nextReady?.[seat === 'kim' ? 'kim' : 'jay']);
const hasQuizSetupReadySeat = (game = null, seat = 'jay') => Boolean(game?.quizReadyState?.ready?.[seat === 'kim' ? 'kim' : 'jay']);
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
const authCharactersOverhangImage = '/auth-characters-overhang.png';
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
const debugRoom = (...args) => {
  if (!import.meta.env.DEV) return;
  try {
    if (window.localStorage.getItem('kjk-debug-room') !== 'true') return;
  } catch {
    return;
  }
  console.debug('[KJK ROOM]', ...args);
};
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
  const rawValue = Array.isArray(value) ? value : String(value || '').split(/\n|,|;/);
  const items = rawValue.map((item) => String(item ?? '').replace(/^\d+[.)]\s*/, ''));
  return Array.from({ length: count }, (_, index) => items[index] || '');
};

const encodeRankedAnswer = (items = []) =>
  items
    .map((item) => String(item ?? '').replace(/\r?\n/g, ' '))
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
const hasSubmittedRoundAnswer = (round = {}, seat = '') => Boolean(normalizeText(round?.answers?.[seat]?.ownAnswer || ''));
const hasReadySeat = (round = {}, seat = '') => Boolean(round?.ready?.[seat]);
const answerDraftStorageKey = (gameId = '', roundId = '', seat = '') =>
  gameId && roundId && seat ? `kjk-answer-draft:${gameId}:${roundId}:${seat}` : '';
const answerDraftMemoryStore = new Map();
const answerDraftTouchedStore = new Set();
const activeAnswerInputMemory = { key: '', field: '', selectionStart: 0, selectionEnd: 0 };
const markAnswerDraftTouched = (key = '') => {
  if (key) answerDraftTouchedStore.add(key);
};
const clearAnswerDraftTouched = (key = '') => {
  if (key) answerDraftTouchedStore.delete(key);
};
const wasAnswerDraftTouched = (key = '') => Boolean(key && answerDraftTouchedStore.has(key));
const safeLocalStorageSet = (key = '', value = '') => {
  if (!key || typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};
const isMobileDashboardViewport = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(max-width: 900px)').matches;
  } catch {
    return false;
  }
};
const setMobilePostAuthDashboardDefault = () => {
  if (!isMobileDashboardViewport()) return false;
  return safeLocalStorageSet('kjk-dashboard-tab', 'gameLobby');
};
const readStoredAnswerDraft = (key = '') => {
  if (!key || typeof window === 'undefined') return null;
  const memoryDraft = answerDraftMemoryStore.get(key);
  if (memoryDraft) return memoryDraft;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      ownAnswer: String(parsed?.ownAnswer ?? ''),
      guessedOther: String(parsed?.guessedOther ?? ''),
    };
  } catch {
    return null;
  }
};
const writeStoredAnswerDraft = (key = '', draft = {}) => {
  if (!key || typeof window === 'undefined') return;
  const normalizedDraft = {
    ownAnswer: String(draft?.ownAnswer ?? ''),
    guessedOther: String(draft?.guessedOther ?? ''),
  };
  answerDraftMemoryStore.set(key, normalizedDraft);
  safeLocalStorageSet(key, JSON.stringify(normalizedDraft));
};

const stableRoundIdentityKey = (round = {}) =>
  normalizeText(round?.questionId)
  || String(round?.number || '')
  || sanitizeNoteKey(round?.question || '')
  || '';

const stableRoomSnapshotValue = (game = {}) => {
  if (!game) return null;
  const round = game.currentRound || null;
  return {
    id: game.id || '',
    status: game.status || '',
    endedAt: game.endedAt || null,
    joinCode: game.joinCode || game.roomCode || game.code || '',
    hostUid: game.hostUid || '',
    gameMode: game.gameMode || 'standard',
    questionBankType: game.questionBankType || 'game',
    seats: game.seats || {},
    playerProfiles: game.playerProfiles || {},
    totals: game.totals || {},
    quizTotals: game.quizTotals || {},
    quizWagers: game.quizWagers || {},
    quizWagerAgreement: game.quizWagerAgreement || null,
    quizReadyState: game.quizReadyState || null,
    roundsPlayed: Number(game.roundsPlayed || 0),
    requestedQuestionCount: Number(game.requestedQuestionCount || 0),
    actualQuestionCount: Number(game.actualQuestionCount || 0),
    questionQueueIds: game.questionQueueIds || [],
    usedQuestionIds: game.usedQuestionIds || [],
    currentRound: round
      ? {
          ...round,
          updatedAt: undefined,
        }
      : null,
  };
};

const areStableRoomSnapshotsEqual = (left, right) =>
  JSON.stringify(stableRoomSnapshotValue(left)) === JSON.stringify(stableRoomSnapshotValue(right));
const areRoundAnswerSnapshotsEqual = (left = {}, right = {}) =>
  String(left?.ownAnswer ?? '') === String(right?.ownAnswer ?? '')
  && String(left?.guessedOther ?? '') === String(right?.guessedOther ?? '')
  && String(left?.submittedBy ?? '') === String(right?.submittedBy ?? '')
  && String(left?.submittedAt ?? '') === String(right?.submittedAt ?? '')
  && String(left?.finalResult ?? '') === String(right?.finalResult ?? '')
  && String(left?.originalSystemResult ?? '') === String(right?.originalSystemResult ?? '')
  && Boolean(left?.wasCorrect) === Boolean(right?.wasCorrect)
  && Number(left?.pointsAwarded || 0) === Number(right?.pointsAwarded || 0)
  && Number(left?.timerValue || 0) === Number(right?.timerValue || 0);

const isJoinableGameSnapshot = (data = {}) => {
  if (!data) return false;
  const status = data.status || 'active';
  return ACTIVE_GAME_STATUSES.includes(status)
    && !COMPLETED_GAME_STATUSES.includes(status)
    && !data.endedAt;
};

const mergeActiveRoundSnapshot = (currentGame, incomingGame) => {
  if (currentGame?.id === incomingGame?.id && currentGame?.currentRound && !incomingGame?.currentRound) {
    const incomingStatus = incomingGame?.status || 'active';
    if (!COMPLETED_GAME_STATUSES.includes(incomingStatus) && !incomingGame?.endedAt) {
      return {
        ...incomingGame,
        currentRound: currentGame.currentRound,
      };
    }
  }
  if (!currentGame?.currentRound || !incomingGame?.currentRound) {
    if (currentGame?.id === incomingGame?.id) {
      const currentAgreementRank = getQuizWagerAgreementRank(currentGame?.quizWagerAgreement || null);
      const incomingAgreementRank = getQuizWagerAgreementRank(incomingGame?.quizWagerAgreement || null);
      const preserveCurrentAgreement = currentAgreementRank > incomingAgreementRank;
      const mergedGame = {
        ...incomingGame,
        quizWagerAgreement: preserveCurrentAgreement
          ? (currentGame?.quizWagerAgreement || incomingGame?.quizWagerAgreement || null)
          : (incomingGame?.quizWagerAgreement || currentGame?.quizWagerAgreement || null),
        quizWagers: preserveCurrentAgreement
          ? (currentGame?.quizWagers || incomingGame?.quizWagers || {})
          : (incomingGame?.quizWagers || currentGame?.quizWagers || {}),
        quizReadyState: mergeQuizReadyStateSnapshot(currentGame?.quizReadyState || null, incomingGame?.quizReadyState || null),
      };
      return areStableRoomSnapshotsEqual(currentGame, mergedGame)
        ? currentGame
        : mergedGame;
    }
    return incomingGame;
  }
  if (currentGame.id !== incomingGame.id) return incomingGame;
  const currentRound = currentGame.currentRound || {};
  const incomingRound = incomingGame.currentRound || {};
  const currentIdentity = stableRoundIdentityKey(currentRound);
  const incomingIdentity = stableRoundIdentityKey(incomingRound);
  if (!incomingIdentity) {
    return {
      ...incomingGame,
      currentRound: currentRound,
    };
  }
  const sameByIdentity = Boolean(currentIdentity && incomingIdentity && currentIdentity === incomingIdentity);
  const sameByNumber = Boolean(currentRound.number && incomingRound.number && Number(currentRound.number) === Number(incomingRound.number));
  const sameByPrompt =
    normalizeText(currentRound.question || '')
    && normalizeText(currentRound.question || '') === normalizeText(incomingRound.question || '')
    && normalizeText(currentRound.roundType || '') === normalizeText(incomingRound.roundType || '');
  const isSameLiveRound = sameByIdentity || sameByNumber || sameByPrompt;
  if (!isSameLiveRound) return incomingGame;
  const currentAnswers = currentGame.currentRound.answers || {};
  const incomingAnswers = incomingGame.currentRound.answers || {};
  const nextAnswers = {
    jay: hasSubmittedRoundAnswer(incomingGame.currentRound, 'jay') ? incomingAnswers.jay : currentAnswers.jay,
    kim: hasSubmittedRoundAnswer(incomingGame.currentRound, 'kim') ? incomingAnswers.kim : currentAnswers.kim,
  };
  const stableRoundFields =
    currentGame.currentRound.status === incomingGame.currentRound.status
    && currentGame.currentRound.questionId === incomingGame.currentRound.questionId
    && currentGame.currentRound.question === incomingGame.currentRound.question
    && currentGame.currentRound.category === incomingGame.currentRound.category
    && currentGame.currentRound.roundType === incomingGame.currentRound.roundType
    && currentGame.currentRound.defaultAnswerType === incomingGame.currentRound.defaultAnswerType
    && currentGame.currentRound.correctAnswer === incomingGame.currentRound.correctAnswer
    && currentGame.currentRound.normalizedCorrectAnswer === incomingGame.currentRound.normalizedCorrectAnswer
    && currentGame.currentRound.quizTimerSeconds === incomingGame.currentRound.quizTimerSeconds
    && currentGame.currentRound.quizTimerStartedAt === incomingGame.currentRound.quizTimerStartedAt
    && currentGame.currentRound.quizTimerEndsAt === incomingGame.currentRound.quizTimerEndsAt
    && JSON.stringify(currentGame.currentRound.multipleChoiceOptions || []) === JSON.stringify(incomingGame.currentRound.multipleChoiceOptions || [])
    && currentGame.currentRound.penalties?.jay === incomingGame.currentRound.penalties?.jay
    && currentGame.currentRound.penalties?.kim === incomingGame.currentRound.penalties?.kim
    && JSON.stringify(currentGame.currentRound.ready || {}) === JSON.stringify(incomingGame.currentRound.ready || {})
    && JSON.stringify(currentGame.currentRound.nextReady || {}) === JSON.stringify(incomingGame.currentRound.nextReady || {})
    && JSON.stringify(currentGame.currentRound.overrideRequests || {}) === JSON.stringify(incomingGame.currentRound.overrideRequests || {})
    && areRoundAnswerSnapshotsEqual(currentAnswers.jay, nextAnswers.jay)
    && areRoundAnswerSnapshotsEqual(currentAnswers.kim, nextAnswers.kim);
  const mergedRound = {
    ...currentRound,
    ...incomingRound,
    questionId: incomingRound.questionId || currentRound.questionId || '',
    question: incomingRound.question || currentRound.question || '',
    category: incomingRound.category || currentRound.category || '',
    roundType: incomingRound.roundType || currentRound.roundType || '',
    defaultAnswerType: incomingRound.defaultAnswerType || currentRound.defaultAnswerType || '',
    multipleChoiceOptions: Array.isArray(incomingRound.multipleChoiceOptions) && incomingRound.multipleChoiceOptions.length
      ? incomingRound.multipleChoiceOptions
      : currentRound.multipleChoiceOptions || [],
    penalties: {
      ...(currentRound.penalties || {}),
      ...(incomingRound.penalties || {}),
    },
    ready: {
      ...(currentRound.ready || {}),
      ...(incomingRound.ready || {}),
    },
    nextReady: {
      ...(currentRound.nextReady || {}),
      ...(incomingRound.nextReady || {}),
    },
    overrideRequests: {
      ...(currentRound.overrideRequests || {}),
      ...(incomingRound.overrideRequests || {}),
    },
    answers: nextAnswers,
  };
  const mergedGame = {
    ...incomingGame,
    currentRound: stableRoundFields
      ? currentGame.currentRound
      : mergedRound,
  };
  return areStableRoomSnapshotsEqual(currentGame, mergedGame) ? currentGame : mergedGame;
};

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
    quizTotals: data.quizTotals || { jay: 0, kim: 0 },
    quizWinner: data.quizWinner || '',
    wagerSettlement: data.wagerSettlement || null,
    roundsPlayed: data.roundsPlayed || roundsData.length,
    rounds: roundsData,
    questionQueueIds: data.questionQueueIds || [],
    usedQuestionIds,
    seats: data.seats || {},
    playerProfiles: data.playerProfiles || {},
    gameMode: data.gameMode || 'standard',
    questionBankType: data.questionBankType || 'game',
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
        <div className="auth-login-stack">
          <img className="auth-characters-overhang" src={authCharactersOverhangImage} alt="" aria-hidden="true" />
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
        </div>
      </section>
    </main>
  );
}

function LobbyScreen({
  user,
  profile,
  connectionState,
  questionNotes,
  questionFeedback,
  quizAnswers,
  onSaveDisplayName,
  onUpdateQuestionNote,
  onDeleteQuestionNote,
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
  onSyncQuizBank,
  onImportQuestions,
  onImportQuizQuestions,
  onResumeGame,
  onViewSummary,
  // Lobby chat props (injected from ProductionApp)
  lobbyChatMessages,
  lobbyChatDraft,
  isLobbyChatSending,
  setLobbyChatDraft,
  sendLobbyChat,

  onEndGame,
  onDeleteGame,
  onResetBalances,
  onSaveBalances,
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
  quizQuestionCount,
  usedQuizQuestionCount,
  remainingQuizQuestionCount,
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
  const [quizQuestionCountDraft, setQuizQuestionCountDraft] = useState('10');
  const [analyticsSegment, setAnalyticsSegment] = useState('facts');
  const [questionBankSegment, setQuestionBankSegment] = useState('game');
  const [quizAnalyticsTab, setQuizAnalyticsTab] = useState('overview');
  const [selectedRoundTypes, setSelectedRoundTypes] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isBalanceEditorOpen, setIsBalanceEditorOpen] = useState(false);
  const [balanceDrafts, setBalanceDrafts] = useState({ jay: '0', kim: '0' });
  const [profileNameDraft, setProfileNameDraft] = useState(() => normalizeText(profile?.displayName || user?.displayName || user?.email?.split('@')[0] || ''));
  const [editingNoteId, setEditingNoteId] = useState('');
  const [editingNoteDraft, setEditingNoteDraft] = useState('');
  const dashboardMenuRef = useRef(null);
  const isMobileDashboardNav = useMediaQuery('(max-width: 900px)');
  const pendingInviteCount = useMemo(() => {
    if (!Array.isArray(gameInvites)) return 0;
    return gameInvites.filter((invite) => (invite?.displayStatus || invite?.status) === 'pending').length;
  }, [gameInvites]);
  const dashboardPills = [
    { id: 'gameLobby', label: 'Game Lobby', tone: 'lobby', icon: 'home' },
    { id: 'activity', label: 'Activity', tone: 'activity', icon: 'activity' },
    { id: 'analytics', label: 'Analytics', tone: 'analytics', icon: 'graph' },
    { id: 'diary', label: 'Diary', tone: 'diary', icon: 'book' },
    { id: 'forfeitStore', label: 'Forfeit Store', tone: 'store', icon: 'gift' },
  ];
  const typeOptions = ROUND_TYPES.map((type) => ({ value: type.id, label: type.shortLabel }));
  const categoryOptions = questionCategories?.length ? questionCategories : DEFAULT_CATEGORIES.map((category) => category.name);
  const currentBalanceDrafts = useMemo(() => ({
    jay: String(Number(playerAccounts?.jay?.lifetimePenaltyPoints || 0)),
    kim: String(Number(playerAccounts?.kim?.lifetimePenaltyPoints || 0)),
  }), [playerAccounts?.jay?.lifetimePenaltyPoints, playerAccounts?.kim?.lifetimePenaltyPoints]);

  const toggleFilterValue = (value, values, setter) => {
    setter(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
  };

  const handleCreateGame = () =>
    onCreateGame({
      mode: createMode,
      gameMode: 'standard',
      roundTypes: createMode === 'custom' ? selectedRoundTypes : [],
      categories: createMode === 'custom' ? selectedCategories : [],
    });

  const handleCreateAndInviteGame = () =>
    onCreateGame({
      mode: createMode,
      gameMode: 'standard',
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

  const handleEditBalancesFromMenu = () => {
    closeDashboardMenu();
    const pin = window.prompt('Enter PIN to edit balances.');
    if (pin === null) return;
    if (String(pin).trim() !== '0000') {
      window.alert('Incorrect PIN.');
      return;
    }
    setBalanceDrafts(currentBalanceDrafts);
    setIsBalanceEditorOpen(true);
  };

  const handleClearBalancesFromEditor = async () => {
    const result = await onResetBalances?.();
    if (result === null) return;
    setBalanceDrafts({ jay: '0', kim: '0' });
    setIsBalanceEditorOpen(false);
  };

  const handleSubmitBalancesFromEditor = async () => {
    const jayBalance = Number(balanceDrafts.jay);
    const kimBalance = Number(balanceDrafts.kim);
    if (!Number.isFinite(jayBalance) || !Number.isFinite(kimBalance)) {
      window.alert('Enter numeric balances for Jay and Kim.');
      return;
    }
    const result = await onSaveBalances?.({ jay: jayBalance, kim: kimBalance });
    if (result === null) return;
    setIsBalanceEditorOpen(false);
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
      safeLocalStorageSet('kjk-dashboard-tab', activeTab);
    } catch {
      // Ignore storage failures.
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      safeLocalStorageSet('kjk-activity-tab', activityTab);
    } catch {
      // Ignore storage failures.
    }
  }, [activityTab]);

  const questionFeedbackAnalytics = useMemo(() => {
    const byQuestion = new Map();
    const byUser = { jay: { liked: 0, disliked: 0 }, kim: { liked: 0, disliked: 0 } };
    const categoryStats = new Map();
    const typeStats = new Map();

    (questionFeedback || []).forEach((entry) => {
      const seat = seatFromPlayerRef(entry.userId || entry.userSeat) || '';
      const value = entry.feedbackValue === 'liked' ? 'liked' : entry.feedbackValue === 'disliked' ? 'disliked' : '';
      if (!seat || !value) return;
      byUser[seat][value] += 1;
      const qKey = normalizeText(entry.questionId || entry.questionText || entry.id);
      if (!qKey) return;
      if (!byQuestion.has(qKey)) {
        byQuestion.set(qKey, {
          questionId: entry.questionId || '',
          questionText: entry.questionText || entry.questionId || 'Question',
          category: entry.category || '',
          roundType: entry.roundType || '',
          feedbackBySeat: {},
        });
      }
      byQuestion.get(qKey).feedbackBySeat[seat] = value;
    });

    const bothLiked = [];
    const bothDisliked = [];
    const splitOpinions = [];

    [...byQuestion.values()].forEach((row) => {
      const jayFeedback = row.feedbackBySeat.jay || '';
      const kimFeedback = row.feedbackBySeat.kim || '';
      const categoryKey = normalizeText(row.category) || 'Uncategorised';
      const typeKey = normalizeText(row.roundType) || 'unknown';
      if (!categoryStats.has(categoryKey)) categoryStats.set(categoryKey, { category: categoryKey, liked: 0, disliked: 0, bothLiked: 0, split: 0 });
      if (!typeStats.has(typeKey)) typeStats.set(typeKey, { roundType: typeKey, liked: 0, disliked: 0, bothLiked: 0, split: 0 });
      const categoryRow = categoryStats.get(categoryKey);
      const typeRow = typeStats.get(typeKey);
      if (jayFeedback === 'liked') { categoryRow.liked += 1; typeRow.liked += 1; }
      if (kimFeedback === 'liked') { categoryRow.liked += 1; typeRow.liked += 1; }
      if (jayFeedback === 'disliked') { categoryRow.disliked += 1; typeRow.disliked += 1; }
      if (kimFeedback === 'disliked') { categoryRow.disliked += 1; typeRow.disliked += 1; }

      if (jayFeedback && kimFeedback) {
        if (jayFeedback === 'liked' && kimFeedback === 'liked') {
          bothLiked.push(row);
          categoryRow.bothLiked += 1;
          typeRow.bothLiked += 1;
        } else if (jayFeedback === 'disliked' && kimFeedback === 'disliked') {
          bothDisliked.push(row);
        } else {
          splitOpinions.push(row);
          categoryRow.split += 1;
          typeRow.split += 1;
        }
      }
    });

    const sortRows = (rows) => rows.sort((a, b) => (b.liked + b.disliked + b.bothLiked + b.split) - (a.liked + a.disliked + a.bothLiked + a.split));
    return {
      byUser,
      bothLiked,
      bothDisliked,
      splitOpinions,
      categoryRows: sortRows([...categoryStats.values()]),
      typeRows: sortRows([...typeStats.values()]),
    };
  }, [questionFeedback]);

  const quizAnalytics = useMemo(() => {
    const rows = (quizAnswers || []);
    const bySeat = {
      jay: { answered: 0, correct: 0, incorrect: 0, points: 0, totalTimeMs: 0, fastestMs: null, slowestMs: null },
      kim: { answered: 0, correct: 0, incorrect: 0, points: 0, totalTimeMs: 0, fastestMs: null, slowestMs: null },
    };
    const overrides = { requested: 0, approved: 0, rejected: 0 };
    const overridesBySeat = {
      jay: { requested: 0, approved: 0, rejected: 0 },
      kim: { requested: 0, approved: 0, rejected: 0 },
    };
    const perQuestion = new Map();
    const categoryStats = new Map();
    const typeStats = new Map();
    const pointsStats = {
      highestSingle: { jay: 0, kim: 0 },
      lowestSingle: { jay: null, kim: null },
    };
    rows.forEach((row) => {
      const seat = seatFromPlayerRef(row.playerSeat || row.playerId) || '';
      if (!seat) return;
      const answerTimeMs = Math.max(0, Number(row.answerTimeMs ?? row.answerTime ?? 0) || 0);
      const points = Math.max(0, Number(row.pointsAwarded || 0));
      const categoryKey = normalizeText(row.category || '') || 'Uncategorised';
      const typeKey = normalizeText(row.questionType || row.roundType || '') || 'unknown';
      const wasCorrect = Boolean(row.finalResult === 'correct' || row.wasCorrect);
      bySeat[seat].answered += 1;
      if (wasCorrect) bySeat[seat].correct += 1;
      else bySeat[seat].incorrect += 1;
      bySeat[seat].points += points;
      bySeat[seat].totalTimeMs += answerTimeMs;
      bySeat[seat].fastestMs = bySeat[seat].fastestMs === null ? answerTimeMs : Math.min(bySeat[seat].fastestMs, answerTimeMs);
      bySeat[seat].slowestMs = bySeat[seat].slowestMs === null ? answerTimeMs : Math.max(bySeat[seat].slowestMs, answerTimeMs);
      pointsStats.highestSingle[seat] = Math.max(pointsStats.highestSingle[seat] || 0, points);
      pointsStats.lowestSingle[seat] = pointsStats.lowestSingle[seat] === null ? points : Math.min(pointsStats.lowestSingle[seat], points);
      if (normalizeText(row.overrideStatus || '') && row.overrideStatus !== 'none') {
        overrides.requested += 1;
        if (row.overrideStatus === 'approved') overrides.approved += 1;
        if (row.overrideStatus === 'rejected') overrides.rejected += 1;
        overridesBySeat[seat].requested += 1;
        if (row.overrideStatus === 'approved') overridesBySeat[seat].approved += 1;
        if (row.overrideStatus === 'rejected') overridesBySeat[seat].rejected += 1;
      }
      const key = normalizeText(row.questionId || row.questionText || '');
      if (key) {
        if (!perQuestion.has(key)) perQuestion.set(key, { question: row.questionText || row.questionId || 'Question', category: categoryKey, roundType: typeKey, bySeat: {}, wrongCount: 0, correctCount: 0, fastestCorrectMs: null, slowestCorrectMs: null });
        const entry = perQuestion.get(key);
        entry.bySeat[seat] = wasCorrect;
        if (wasCorrect) {
          entry.correctCount += 1;
          entry.fastestCorrectMs = entry.fastestCorrectMs === null ? answerTimeMs : Math.min(entry.fastestCorrectMs, answerTimeMs);
          entry.slowestCorrectMs = entry.slowestCorrectMs === null ? answerTimeMs : Math.max(entry.slowestCorrectMs, answerTimeMs);
        } else {
          entry.wrongCount += 1;
        }
      }
      if (!categoryStats.has(categoryKey)) categoryStats.set(categoryKey, { category: categoryKey, correct: 0, wrong: 0, points: 0, totalTimeMs: 0 });
      if (!typeStats.has(typeKey)) typeStats.set(typeKey, { roundType: typeKey, correct: 0, wrong: 0, points: 0, totalTimeMs: 0 });
      const catRow = categoryStats.get(categoryKey);
      const typeRow = typeStats.get(typeKey);
      if (wasCorrect) { catRow.correct += 1; typeRow.correct += 1; } else { catRow.wrong += 1; typeRow.wrong += 1; }
      catRow.points += points;
      typeRow.points += points;
      catRow.totalTimeMs += answerTimeMs;
      typeRow.totalTimeMs += answerTimeMs;
    });
    const bothCorrect = [];
    const bothWrong = [];
    const splitCorrect = [];
    [...perQuestion.values()].forEach((row) => {
      const jay = row.bySeat.jay;
      const kim = row.bySeat.kim;
      if (typeof jay !== 'boolean' || typeof kim !== 'boolean') return;
      if (jay && kim) bothCorrect.push(row.question);
      else if (!jay && !kim) bothWrong.push(row.question);
      else splitCorrect.push(row.question);
    });
    const mostMissed = [...perQuestion.values()]
      .filter((row) => row.wrongCount > 0)
      .sort((a, b) => b.wrongCount - a.wrongCount)
      .slice(0, 10);
    const fastestCorrect = [...perQuestion.values()]
      .filter((row) => typeof row.fastestCorrectMs === 'number')
      .sort((a, b) => a.fastestCorrectMs - b.fastestCorrectMs)
      .slice(0, 10);
    const slowestCorrect = [...perQuestion.values()]
      .filter((row) => typeof row.slowestCorrectMs === 'number')
      .sort((a, b) => b.slowestCorrectMs - a.slowestCorrectMs)
      .slice(0, 10);
    const sortCategoryRows = (items) =>
      items.sort((a, b) => (b.correct + b.wrong) - (a.correct + a.wrong) || b.points - a.points);
    const withGroupDerived = (row) => {
      const total = Math.max(0, Number(row.correct || 0) + Number(row.wrong || 0));
      const accuracy = total ? Math.round((Number(row.correct || 0) / total) * 100) : 0;
      const avgTimeMs = total ? Math.round(Number(row.totalTimeMs || 0) / total) : 0;
      return { ...row, total, accuracy, avgTimeMs };
    };
    const withDerived = (seatRow) => {
      const answered = Math.max(0, Number(seatRow.answered || 0));
      const correct = Math.max(0, Number(seatRow.correct || 0));
      const accuracy = answered ? Math.round((correct / answered) * 100) : 0;
      const avgTimeMs = answered ? Math.round(Number(seatRow.totalTimeMs || 0) / answered) : 0;
      const avgPoints = answered ? Math.round(Number(seatRow.points || 0) / answered) : 0;
      return { ...seatRow, accuracy, avgTimeMs, avgPoints };
    };
    return {
      totalAnswers: rows.length,
      bySeat: {
        jay: withDerived(bySeat.jay),
        kim: withDerived(bySeat.kim),
      },
      pointsStats,
      overrides,
      overridesBySeat,
      bothCorrect,
      bothWrong,
      splitCorrect,
      mostMissed,
      fastestCorrect,
      slowestCorrect,
      categoryRows: sortCategoryRows([...categoryStats.values()].map(withGroupDerived)),
      typeRows: sortCategoryRows([...typeStats.values()].map(withGroupDerived)),
    };
  }, [quizAnswers]);

  const quizSessionAnalytics = useMemo(() => {
    const sessions = (previousGames || []).filter((entry) => (entry?.gameMode || 'standard') === 'quiz');
    const completedSessions = sessions.filter((entry) => COMPLETED_GAME_STATUSES.includes(entry?.status || ''));
    const wins = { jay: 0, kim: 0, tie: 0 };
    const wagers = {
      games: 0,
      jayNetShift: 0,
      kimNetShift: 0,
      movedTotal: 0,
      totalPlayedFor: 0,
      biggestSharedWager: 0,
      averageSharedWager: 0,
      jayWon: 0,
      kimWon: 0,
      tie: 0,
    };
    completedSessions.forEach((entry) => {
      const winner = entry?.quizWinner || entry?.winner || 'tie';
      if (winner === 'jay') wins.jay += 1;
      else if (winner === 'kim') wins.kim += 1;
      else wins.tie += 1;
      const settlement = entry?.wagerSettlement || null;
      if (settlement && typeof settlement === 'object') {
        wagers.games += 1;
        const jayShift = Number(settlement.jayShift || 0);
        const kimShift = Number(settlement.kimShift || 0);
        const sharedWager = Math.max(
          0,
          Number(settlement.sharedWager || 0),
          Number(settlement.jayWager || 0),
          Number(settlement.kimWager || 0),
        );
        wagers.jayNetShift += jayShift;
        wagers.kimNetShift += kimShift;
        wagers.movedTotal += Math.abs(jayShift) + Math.abs(kimShift);
        wagers.totalPlayedFor += sharedWager;
        wagers.biggestSharedWager = Math.max(wagers.biggestSharedWager, sharedWager);
        if (winner === 'jay') wagers.jayWon += 1;
        if (winner === 'kim') wagers.kimWon += 1;
        if (winner !== 'jay' && winner !== 'kim') wagers.tie += 1;
      }
    });
    wagers.averageSharedWager = wagers.games ? Math.round(wagers.totalPlayedFor / wagers.games) : 0;
    return {
      totalQuizSessions: sessions.length,
      completedQuizSessions: completedSessions.length,
      wins,
      wagers,
    };
  }, [previousGames]);

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
          <h1><span className="brand-mobile-mark">92.1 JKC Radio</span><span className="brand-full-text">KJK KIMJAYKINKS</span></h1>
        </div>
	        <div className="top-actions">
	          {editingModeEnabled ? <span className="status-pill status-pill--test-mode">TEST MODE</span> : null}
	          <div className="dashboard-score-pills" aria-label="Player penalty point balances">
	            <span className="status-pill dashboard-balance-pill">
	              <SeatFlag seat="jay" className="dashboard-balance-flag" />
	              Jay {formatScore(Number(playerAccounts?.jay?.lifetimePenaltyPoints || 0))}
	            </span>
	            <span className="status-pill dashboard-balance-pill">
	              <SeatFlag seat="kim" className="dashboard-balance-flag" />
	              Kim {formatScore(Number(playerAccounts?.kim?.lifetimePenaltyPoints || 0))}
	            </span>
	          </div>
	          <details className="top-menu settings-menu dashboard-settings-menu" ref={dashboardMenuRef}>
	            <summary aria-label="Open account menu">
	              <span className="settings-icon" aria-hidden="true">
	                <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
	                  <path d="M5 7.5h14M5 12h14M5 16.5h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
	                </svg>
	              </span>
	              {pendingInviteCount > 0 ? <span className="menu-notice-badge" aria-label={`${pendingInviteCount} pending game requests`}>{pendingInviteCount}</span> : null}
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
	                        {pill.id === 'gameLobby' && pendingInviteCount > 0 ? <span className="dashboard-pill-count" aria-hidden="true">{pendingInviteCount}</span> : null}
	                        {pill.id === 'activity' && pendingActivityCount > 0 ? <span className="dashboard-pill-dot" aria-hidden="true" /> : null}
	                      </button>
	                    ))}
	                  </div>
	                </section>
              ) : null}
              <section className="settings-menu-section">
                <span className="settings-section-label">Account</span>
                <Button className="ghost-button compact" onClick={() => { closeDashboardMenu(); setActiveTab('questionBank'); }} disabled={isBusy}>
                  Question Bank
                </Button>
                <Button className="ghost-button compact" onClick={() => { closeDashboardMenu(); setIsProfileOpen(true); }} disabled={isBusy}>
                  My Profile
                </Button>
                <Button className={`ghost-button compact editing-mode-toggle ${editingModeEnabled ? 'is-on' : ''}`} onClick={handleToggleEditingModeFromMenu} disabled={isBusy}>
                  {editingModeEnabled ? 'Editing Mode On' : 'Editing Mode Off'}
                </Button>
                <Button className="ghost-button compact" onClick={handleEditBalancesFromMenu} disabled={isBusy}>
                  Edit balances
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
	                  {pill.id === 'gameLobby' && pendingInviteCount > 0 ? <span className="dashboard-pill-count" aria-hidden="true">{pendingInviteCount}</span> : null}
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
            {gameInvites.length ? (
              <section className="lobby-invite-top">
                <GameInvitesPanel
                  invites={gameInvites}
                  onJoinInvite={onJoinGameInvite}
                  onDismissInvite={onDismissGameInvite}
                  isBusy={isBusy}
                  compact
                />
              </section>
            ) : null}
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
                  <Button type="button" className="primary-button lobby-primary-button" onClick={handleCreateGame} disabled={isBusy}>
                    Create New Game
                  </Button>
                  <Button type="button" className="ghost-button lobby-secondary-button" onClick={handleCreateAndInviteGame} disabled={isBusy}>
                    Create + Send Game Request
                  </Button>
                </div>

                <div className="lobby-join-inline">
                  <p className="eyebrow">OR Join a game with code</p>
                  <div className="lobby-actions lobby-actions--stack">
                    <label className="field">
                      <span>Join Code</span>
                      <input value={joinCode} onChange={(event) => onJoinCodeChange(normalizeJoinCode(event.target.value))} placeholder="ABCD12" />
                    </label>
                    <Button className="ghost-button lobby-secondary-button" onClick={onJoinGame} disabled={isBusy || !joinCode.length}>
                      Join Game
                    </Button>
                  </div>
                </div>
              </section>

	              <section className="panel lobby-panel lobby-panel--lobby join-game-card">
	                <div className="panel-heading">
	                  <div>
	                    <p className="eyebrow">Quick Fire</p>
	                    <h2>Quiz Mode</h2>
	                  </div>
	                </div>
	                <p className="panel-copy">Start a speed quiz game from the Quiz sheet question set.</p>
                <div className="quiz-card-hero" aria-hidden="true">
                  <div className="quiz-card-hero-main">
                    <svg viewBox="0 0 120 120" role="img" aria-hidden="true">
                      <defs>
                        <linearGradient id="quiz-card-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#7ad8ff" />
                          <stop offset="100%" stopColor="#4f7bff" />
                        </linearGradient>
                      </defs>
                      <circle cx="60" cy="60" r="52" fill="rgba(6,16,34,0.72)" stroke="url(#quiz-card-gradient)" strokeWidth="4" />
                      <path d="M34 56h52M34 70h36" stroke="#bfe1ff" strokeWidth="4" strokeLinecap="round" />
                      <circle cx="86" cy="70" r="7" fill="#9be5a6" />
                      <path d="M83.5 70.2 85.5 72.4 89 67.8" stroke="#0f3117" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="quiz-card-hero-meta">
                    <strong>10s Timer</strong>
                    <small>Fast answers score higher</small>
                  </div>
                  <div className="quiz-card-hero-meta">
                    <strong>Live Quiz</strong>
                    <small>Separate from normal game points</small>
	                  </div>
	                </div>
	                <label className="field">
	                  <span>Number of Quiz Questions</span>
	                  <input
	                    type="number"
	                    inputMode="numeric"
	                    min="1"
	                    value={quizQuestionCountDraft}
	                    onChange={(event) => setQuizQuestionCountDraft(event.target.value)}
	                    placeholder="10"
	                  />
	                </label>
	                <div className="button-row">
	                  <Button
	                    className="primary-button compact"
	                    onClick={() =>
	                      onCreateGame({
	                        mode: 'random',
	                        gameMode: 'quiz',
	                        roundTypes: [],
	                        categories: [],
	                        requestedQuestionCount: quizQuestionCountDraft,
	                      })}
	                    disabled={isBusy}
	                  >
	                    Create Quiz Game
	                  </Button>
	                  <Button
	                    className="ghost-button compact"
	                    onClick={() =>
	                      onCreateGame({
	                        mode: 'random',
	                        gameMode: 'quiz',
	                        roundTypes: [],
	                        categories: [],
	                        sendInvite: true,
	                        requestedQuestionCount: quizQuestionCountDraft,
	                      })}
	                    disabled={isBusy}
	                  >
	                    Create + Invite
	                  </Button>
	                </div>
	              </section>
            

                <section className="panel lobby-panel lobby-panel--lobby lobby-chat-card">
                  <ChatPanel
                    compact
                    messages={lobbyChatMessages}
                    draft={lobbyChatDraft}
                    onDraftChange={setLobbyChatDraft}
                    onSend={sendLobbyChat}
                    isBusy={isLobbyChatSending}
                    displayName={profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player'}
                  />
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
                <span className="status-pill">{questionBankSegment === 'quiz' ? quizQuestionCount : questionCount} loaded</span>
              </div>
              <div className="dashboard-subnav" role="tablist" aria-label="Question bank tabs">
                <button type="button" className={`dashboard-pill tab-button ${questionBankSegment === 'game' ? 'is-active' : ''}`} onClick={() => setQuestionBankSegment('game')}>
                  Game Questions
                </button>
                <button type="button" className={`dashboard-pill tab-button ${questionBankSegment === 'quiz' ? 'is-active' : ''}`} onClick={() => setQuestionBankSegment('quiz')}>
                  Quiz Questions
                </button>
              </div>

              <div className="question-bank-status-grid">
                <article className="stat-tile">
                  <small>Total Loaded</small>
                  <strong>{questionBankSegment === 'quiz' ? quizQuestionCount : questionCount}</strong>
                  <span>questions currently available</span>
                </article>
                <article className="stat-tile">
                  <small>Tracked Used</small>
                  <strong>{questionBankSegment === 'quiz' ? usedQuizQuestionCount : usedQuestionCount}</strong>
                  <span>already used in games</span>
                </article>
                <article className="stat-tile">
                  <small>Remaining</small>
                  <strong>{questionBankSegment === 'quiz' ? remainingQuizQuestionCount : remainingQuestionCount}</strong>
                  <span>unused questions left</span>
                </article>
                <article className="stat-tile">
                  <small>Connection</small>
                  <strong>{syncNotice ? 'Needs review' : 'Connected'}</strong>
                  <span>{syncNotice || 'Google Sheet connected'}</span>
                </article>
              </div>

              <div className="button-row question-bank-actions">
                <Button className="ghost-button compact" onClick={questionBankSegment === 'quiz' ? onSyncQuizBank : onSyncQuestionBank} disabled={isBusy}>
                  Sync Question Bank
                </Button>
                <Button className="primary-button compact" onClick={questionBankSegment === 'quiz' ? onImportQuizQuestions : onImportQuestions} disabled={isBusy}>
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
              <div className="dashboard-subnav analytics-subnav" role="tablist" aria-label="Analytics segments">
                <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${analyticsSegment === 'facts' ? 'is-active' : ''}`} onClick={() => setAnalyticsSegment('facts')}>
                  Game Facts
                </button>
                <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${analyticsSegment === 'questions' ? 'is-active' : ''}`} onClick={() => setAnalyticsSegment('questions')}>
                  Questions
                </button>
                <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${analyticsSegment === 'quiz' ? 'is-active' : ''}`} onClick={() => setAnalyticsSegment('quiz')}>
                  Quiz
                </button>
              </div>

              {analyticsSegment === 'facts' ? (
                <AnalyticsPanel
                  analytics={lobbyRoundAnalytics}
                  categoryColorMap={categoryColorMap}
                  variant="dashboard"
                  summary={lobbyAnalytics}
                />
              ) : analyticsSegment === 'quiz' ? (
                <section className="analytics-questions-panel">
                  <div className="dashboard-subnav analytics-subnav analytics-subnav--quiz" role="tablist" aria-label="Quiz analytics tabs">
                    <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${quizAnalyticsTab === 'overview' ? 'is-active' : ''}`} onClick={() => setQuizAnalyticsTab('overview')}>
                      Overview
                    </button>
                    <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${quizAnalyticsTab === 'timing' ? 'is-active' : ''}`} onClick={() => setQuizAnalyticsTab('timing')}>
                      Timing
                    </button>
                    <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${quizAnalyticsTab === 'points' ? 'is-active' : ''}`} onClick={() => setQuizAnalyticsTab('points')}>
                      Points
                    </button>
                    <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${quizAnalyticsTab === 'wagers' ? 'is-active' : ''}`} onClick={() => setQuizAnalyticsTab('wagers')}>
                      Wagers
                    </button>
                    <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${quizAnalyticsTab === 'questions' ? 'is-active' : ''}`} onClick={() => setQuizAnalyticsTab('questions')}>
                      Questions
                    </button>
                    <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${quizAnalyticsTab === 'categories' ? 'is-active' : ''}`} onClick={() => setQuizAnalyticsTab('categories')}>
                      Categories
                    </button>
                    <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${quizAnalyticsTab === 'types' ? 'is-active' : ''}`} onClick={() => setQuizAnalyticsTab('types')}>
                      Types
                    </button>
                    <button type="button" className={`dashboard-pill tab-button dashboard-pill--activity-sub ${quizAnalyticsTab === 'overrides' ? 'is-active' : ''}`} onClick={() => setQuizAnalyticsTab('overrides')}>
                      Overrides
                    </button>
                  </div>
                  <div className="question-bank-status-grid">
                    <article className="stat-tile">
                      <small>Quiz Questions</small>
                      <strong>{quizQuestionCount}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Quiz Sessions</small>
                      <strong>{quizSessionAnalytics.completedQuizSessions}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Total Answers</small>
                      <strong>{quizAnalytics.totalAnswers}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Jay Correct</small>
                      <strong>{quizAnalytics.bySeat.jay.correct}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Kim Correct</small>
                      <strong>{quizAnalytics.bySeat.kim.correct}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Jay Accuracy</small>
                      <strong>{quizAnalytics.bySeat.jay.accuracy}%</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Kim Accuracy</small>
                      <strong>{quizAnalytics.bySeat.kim.accuracy}%</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Jay Points</small>
                      <strong>{formatScore(quizAnalytics.bySeat.jay.points)}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Kim Points</small>
                      <strong>{formatScore(quizAnalytics.bySeat.kim.points)}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Jay Avg Points</small>
                      <strong>{formatScore(quizAnalytics.bySeat.jay.avgPoints)}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Kim Avg Points</small>
                      <strong>{formatScore(quizAnalytics.bySeat.kim.avgPoints)}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Both Correct</small>
                      <strong>{quizAnalytics.bothCorrect.length}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Split Result</small>
                      <strong>{quizAnalytics.splitCorrect.length}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Overrides</small>
                      <strong>{quizAnalytics.overrides.requested}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Approved</small>
                      <strong>{quizAnalytics.overrides.approved}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Rejected</small>
                      <strong>{quizAnalytics.overrides.rejected}</strong>
                    </article>
                  </div>
                  {quizAnalyticsTab === 'overview' ? (
                  <div className="summary-columns">
                    <section className="summary-column">
                      <div className="mini-heading"><div><span>Both Correct</span><h3>Shared wins</h3></div></div>
                      <div className="summary-list">
                        {quizAnalytics.bothCorrect.length
                          ? quizAnalytics.bothCorrect.slice(0, 12).map((item) => <article className="mini-list-row" key={`quiz-both-${item}`}><strong>{item}</strong></article>)
                          : <p className="empty-copy">No shared correct answers yet.</p>}
                      </div>
                    </section>
                    <section className="summary-column">
                      <div className="mini-heading"><div><span>Split Correct</span><h3>One right, one wrong</h3></div></div>
                      <div className="summary-list">
                        {quizAnalytics.splitCorrect.length
                          ? quizAnalytics.splitCorrect.slice(0, 12).map((item) => <article className="mini-list-row" key={`quiz-split-${item}`}><strong>{item}</strong></article>)
                          : <p className="empty-copy">No split results yet.</p>}
                      </div>
                    </section>
                    <section className="summary-column">
                      <div className="mini-heading"><div><span>Most Missed</span><h3>Hardest questions</h3></div></div>
                      <div className="summary-list">
                        {quizAnalytics.mostMissed.length
                          ? quizAnalytics.mostMissed.slice(0, 10).map((row) => (
                              <article className="mini-list-row" key={`quiz-miss-${row.question}`}>
                                <strong>{row.question}</strong>
                                <span>{`Missed ${row.wrongCount}`}</span>
                              </article>
                            ))
                          : <p className="empty-copy">No misses yet.</p>}
                      </div>
                    </section>
                  </div>
                  ) : null}
                  {quizAnalyticsTab === 'timing' ? (
                    <div className="summary-columns">
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Timing</span><h3>Average time</h3></div></div>
                        <div className="summary-list">
                          <article className="mini-list-row"><strong>Jay avg</strong><span>{`${quizAnalytics.bySeat.jay.avgTimeMs} ms`}</span></article>
                          <article className="mini-list-row"><strong>Kim avg</strong><span>{`${quizAnalytics.bySeat.kim.avgTimeMs} ms`}</span></article>
                          <article className="mini-list-row"><strong>Jay fastest</strong><span>{`${quizAnalytics.bySeat.jay.fastestMs ?? 0} ms`}</span></article>
                          <article className="mini-list-row"><strong>Kim fastest</strong><span>{`${quizAnalytics.bySeat.kim.fastestMs ?? 0} ms`}</span></article>
                          <article className="mini-list-row"><strong>Jay slowest</strong><span>{`${quizAnalytics.bySeat.jay.slowestMs ?? 0} ms`}</span></article>
                          <article className="mini-list-row"><strong>Kim slowest</strong><span>{`${quizAnalytics.bySeat.kim.slowestMs ?? 0} ms`}</span></article>
                        </div>
                      </section>
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Fastest Correct</span><h3>Quick wins</h3></div></div>
                        <div className="summary-list">
                          {quizAnalytics.fastestCorrect.length
                            ? quizAnalytics.fastestCorrect.map((row) => (
                                <article className="mini-list-row" key={`quiz-fast-${row.question}`}>
                                  <strong>{row.question}</strong>
                                  <span>{`${row.fastestCorrectMs} ms`}</span>
                                </article>
                              ))
                            : <p className="empty-copy">No correct answers yet.</p>}
                        </div>
                      </section>
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Slowest Correct</span><h3>Slow wins</h3></div></div>
                        <div className="summary-list">
                          {quizAnalytics.slowestCorrect.length
                            ? quizAnalytics.slowestCorrect.map((row) => (
                                <article className="mini-list-row" key={`quiz-slow-${row.question}`}>
                                  <strong>{row.question}</strong>
                                  <span>{`${row.slowestCorrectMs} ms`}</span>
                                </article>
                              ))
                            : <p className="empty-copy">No correct answers yet.</p>}
                        </div>
                      </section>
                    </div>
                  ) : null}
                  {quizAnalyticsTab === 'points' ? (
                    <div className="summary-columns">
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Points</span><h3>Singles</h3></div></div>
                        <div className="summary-list">
                          <article className="mini-list-row"><strong>Jay highest</strong><span>{formatScore(quizAnalytics.pointsStats.highestSingle.jay)}</span></article>
                          <article className="mini-list-row"><strong>Kim highest</strong><span>{formatScore(quizAnalytics.pointsStats.highestSingle.kim)}</span></article>
                          <article className="mini-list-row"><strong>Jay lowest</strong><span>{formatScore(quizAnalytics.pointsStats.lowestSingle.jay ?? 0)}</span></article>
                          <article className="mini-list-row"><strong>Kim lowest</strong><span>{formatScore(quizAnalytics.pointsStats.lowestSingle.kim ?? 0)}</span></article>
                        </div>
                      </section>
                    </div>
                  ) : null}
                  {quizAnalyticsTab === 'wagers' ? (
                    <div className="summary-columns">
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Wagers</span><h3>Penalty moved</h3></div></div>
                        <div className="summary-list">
                          <article className="mini-list-row"><strong>Wager games</strong><span>{quizSessionAnalytics.wagers.games}</span></article>
                          <article className="mini-list-row"><strong>Points played for</strong><span>{formatScore(quizSessionAnalytics.wagers.totalPlayedFor)}</span></article>
                          <article className="mini-list-row"><strong>Biggest wager</strong><span>{formatScore(quizSessionAnalytics.wagers.biggestSharedWager)}</span></article>
                          <article className="mini-list-row"><strong>Average wager</strong><span>{formatScore(quizSessionAnalytics.wagers.averageSharedWager)}</span></article>
                          <article className="mini-list-row"><strong>Jay net shift</strong><span>{formatScore(quizSessionAnalytics.wagers.jayNetShift)}</span></article>
                          <article className="mini-list-row"><strong>Kim net shift</strong><span>{formatScore(quizSessionAnalytics.wagers.kimNetShift)}</span></article>
                          <article className="mini-list-row"><strong>Total moved</strong><span>{formatScore(quizSessionAnalytics.wagers.movedTotal)}</span></article>
                        </div>
                      </section>
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Wins</span><h3>Quiz outcomes</h3></div></div>
                        <div className="summary-list">
                          <article className="mini-list-row"><strong>Jay wins</strong><span>{quizSessionAnalytics.wins.jay}</span></article>
                          <article className="mini-list-row"><strong>Kim wins</strong><span>{quizSessionAnalytics.wins.kim}</span></article>
                          <article className="mini-list-row"><strong>Ties</strong><span>{quizSessionAnalytics.wins.tie}</span></article>
                        </div>
                      </section>
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Wager Outcomes</span><h3>Won and lost</h3></div></div>
                        <div className="summary-list">
                          <article className="mini-list-row"><strong>Jay won</strong><span>{quizSessionAnalytics.wagers.jayWon}</span></article>
                          <article className="mini-list-row"><strong>Kim won</strong><span>{quizSessionAnalytics.wagers.kimWon}</span></article>
                          <article className="mini-list-row"><strong>Tie</strong><span>{quizSessionAnalytics.wagers.tie}</span></article>
                        </div>
                      </section>
                    </div>
                  ) : null}
                  {quizAnalyticsTab === 'questions' ? (
                    <div className="summary-columns">
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Both Wrong</span><h3>Shared misses</h3></div></div>
                        <div className="summary-list">
                          {quizAnalytics.bothWrong.length
                            ? quizAnalytics.bothWrong.slice(0, 12).map((item) => <article className="mini-list-row" key={`quiz-wrong-${item}`}><strong>{item}</strong></article>)
                            : <p className="empty-copy">No shared wrong answers yet.</p>}
                        </div>
                      </section>
                    </div>
                  ) : null}
                  {quizAnalyticsTab === 'categories' ? (
                    <div className="summary-columns">
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Categories</span><h3>Ranked</h3></div></div>
                        <div className="summary-list">
                          {(quizAnalytics.categoryRows || []).slice(0, 14).map((row) => (
                            <article className="mini-list-row" key={`quiz-cat-${row.category}`}>
                              <strong>{row.category}</strong>
                              <span>{`${row.accuracy}% · avg ${row.avgTimeMs} ms · ${formatScore(row.points)}`}</span>
                            </article>
                          ))}
                        </div>
                      </section>
                    </div>
                  ) : null}
                  {quizAnalyticsTab === 'types' ? (
                    <div className="summary-columns">
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Types</span><h3>Ranked</h3></div></div>
                        <div className="summary-list">
                          {(quizAnalytics.typeRows || []).slice(0, 14).map((row) => (
                            <article className="mini-list-row" key={`quiz-type-${row.roundType}`}>
                              <strong>{row.roundType}</strong>
                              <span>{`${row.accuracy}% · avg ${row.avgTimeMs} ms · ${formatScore(row.points)}`}</span>
                            </article>
                          ))}
                        </div>
                      </section>
                    </div>
                  ) : null}
                  {quizAnalyticsTab === 'overrides' ? (
                    <div className="summary-columns">
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>Overrides</span><h3>Summary</h3></div></div>
                        <div className="summary-list">
                          <article className="mini-list-row"><strong>Requested</strong><span>{quizAnalytics.overrides.requested}</span></article>
                          <article className="mini-list-row"><strong>Approved</strong><span>{quizAnalytics.overrides.approved}</span></article>
                          <article className="mini-list-row"><strong>Rejected</strong><span>{quizAnalytics.overrides.rejected}</span></article>
                        </div>
                      </section>
                      <section className="summary-column">
                        <div className="mini-heading"><div><span>By Player</span><h3>Breakdown</h3></div></div>
                        <div className="summary-list">
                          <article className="mini-list-row"><strong>Jay requested</strong><span>{quizAnalytics.overridesBySeat.jay.requested}</span></article>
                          <article className="mini-list-row"><strong>Jay approved</strong><span>{quizAnalytics.overridesBySeat.jay.approved}</span></article>
                          <article className="mini-list-row"><strong>Jay rejected</strong><span>{quizAnalytics.overridesBySeat.jay.rejected}</span></article>
                          <article className="mini-list-row"><strong>Kim requested</strong><span>{quizAnalytics.overridesBySeat.kim.requested}</span></article>
                          <article className="mini-list-row"><strong>Kim approved</strong><span>{quizAnalytics.overridesBySeat.kim.approved}</span></article>
                          <article className="mini-list-row"><strong>Kim rejected</strong><span>{quizAnalytics.overridesBySeat.kim.rejected}</span></article>
                        </div>
                      </section>
                    </div>
                  ) : null}
                </section>
              ) : (
                <section className="analytics-questions-panel">
                  <div className="question-bank-status-grid">
                    <article className="stat-tile">
                      <small>Jay liked</small>
                      <strong>{questionFeedbackAnalytics.byUser.jay.liked}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Jay disliked</small>
                      <strong>{questionFeedbackAnalytics.byUser.jay.disliked}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Kim liked</small>
                      <strong>{questionFeedbackAnalytics.byUser.kim.liked}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Kim disliked</small>
                      <strong>{questionFeedbackAnalytics.byUser.kim.disliked}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Both liked</small>
                      <strong>{questionFeedbackAnalytics.bothLiked.length}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Both disliked</small>
                      <strong>{questionFeedbackAnalytics.bothDisliked.length}</strong>
                    </article>
                    <article className="stat-tile">
                      <small>Split opinion</small>
                      <strong>{questionFeedbackAnalytics.splitOpinions.length}</strong>
                    </article>
                  </div>

                  <div className="summary-columns">
                    <section className="summary-column">
                      <div className="mini-heading">
                        <div>
                          <span>Categories</span>
                          <h3>Like / dislike by category</h3>
                        </div>
                      </div>
                      <div className="summary-list">
                        {questionFeedbackAnalytics.categoryRows.length ? (
                          questionFeedbackAnalytics.categoryRows.map((row) => (
                            <article className="mini-list-row" key={`cat-${row.category}`}>
                              <strong>{row.category}</strong>
                              <small>Likes {row.liked} · Dislikes {row.disliked} · Both liked {row.bothLiked} · Split {row.split}</small>
                            </article>
                          ))
                        ) : (
                          <p className="empty-copy">No category feedback yet.</p>
                        )}
                      </div>
                    </section>

                    <section className="summary-column">
                      <div className="mini-heading">
                        <div>
                          <span>Question Types</span>
                          <h3>Like / dislike by type</h3>
                        </div>
                      </div>
                      <div className="summary-list">
                        {questionFeedbackAnalytics.typeRows.length ? (
                          questionFeedbackAnalytics.typeRows.map((row) => (
                            <article className="mini-list-row" key={`type-${row.roundType}`}>
                              <strong>{ROUND_TYPE_LABEL[row.roundType] || row.roundType}</strong>
                              <small>Likes {row.liked} · Dislikes {row.disliked} · Both liked {row.bothLiked} · Split {row.split}</small>
                            </article>
                          ))
                        ) : (
                          <p className="empty-copy">No question-type feedback yet.</p>
                        )}
                      </div>
                    </section>
                  </div>

                  <div className="summary-columns">
                    <section className="summary-column">
                      <div className="mini-heading">
                        <div>
                          <span>Both Liked</span>
                          <h3>Shared favorites</h3>
                        </div>
                      </div>
                      <div className="summary-list">
                        {questionFeedbackAnalytics.bothLiked.length ? (
                          questionFeedbackAnalytics.bothLiked.map((row) => (
                            <article className="mini-list-row" key={`liked-${row.questionId || row.questionText}`}>
                              <strong>{row.questionText}</strong>
                              <small>{row.category || 'Uncategorised'} · {ROUND_TYPE_LABEL[row.roundType] || row.roundType || 'Question'}</small>
                            </article>
                          ))
                        ) : (
                          <p className="empty-copy">No shared likes yet.</p>
                        )}
                      </div>
                    </section>

                    <section className="summary-column">
                      <div className="mini-heading">
                        <div>
                          <span>Split Opinion</span>
                          <h3>One liked, one disliked</h3>
                        </div>
                      </div>
                      <div className="summary-list">
                        {questionFeedbackAnalytics.splitOpinions.length ? (
                          questionFeedbackAnalytics.splitOpinions.map((row) => (
                            <article className="mini-list-row" key={`split-${row.questionId || row.questionText}`}>
                              <strong>{row.questionText}</strong>
                              <small>{row.category || 'Uncategorised'} · {ROUND_TYPE_LABEL[row.roundType] || row.roundType || 'Question'}</small>
                            </article>
                          ))
                        ) : (
                          <p className="empty-copy">No split opinions yet.</p>
                        )}
                      </div>
                    </section>
                  </div>
                </section>
              )}
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
              <div className="modal-heading-actions">
                <span className="status-pill">{profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player'}</span>
                <Button className="ghost-button compact modal-close-button" onClick={() => setIsProfileOpen(false)} disabled={isBusy} aria-label="Close My Profile">
                  Close
                </Button>
              </div>
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
                      {editingNoteId === note.id ? (
                        <label className="field">
                          <span>Edit note</span>
                          <textarea rows="3" value={editingNoteDraft} onChange={(event) => setEditingNoteDraft(event.target.value)} />
                        </label>
                      ) : (
                        <span>{note.noteText || '-'}</span>
                      )}
                      <small>
                        {formatShortDateTime(note.createdAt)}
                        {note.gameId ? ` · Game ${String(note.gameId).slice(-6).toUpperCase()}` : ''}
                        {note.category ? ` · ${note.category}` : ''}
                        {note.roundType ? ` · ${ROUND_TYPE_LABEL[note.roundType] || note.roundType}` : ''}
                      </small>
                      <div className="button-row">
                        {editingNoteId === note.id ? (
                          <>
                            <Button
                              className="primary-button compact"
                              onClick={async () => {
                                await onUpdateQuestionNote?.(note.id, editingNoteDraft);
                                setEditingNoteId('');
                                setEditingNoteDraft('');
                              }}
                              disabled={isBusy || !normalizeText(editingNoteDraft)}
                            >
                              Save
                            </Button>
                            <Button className="ghost-button compact" onClick={() => { setEditingNoteId(''); setEditingNoteDraft(''); }} disabled={isBusy}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button className="ghost-button compact" onClick={() => { setEditingNoteId(note.id); setEditingNoteDraft(note.noteText || ''); }} disabled={isBusy}>
                              Edit
                            </Button>
                            <Button className="ghost-button compact" onClick={() => onDeleteQuestionNote?.(note.id)} disabled={isBusy}>
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
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

      {isBalanceEditorOpen ? (
        <section className="modal-backdrop" role="presentation" onClick={() => setIsBalanceEditorOpen(false)}>
          <div className="panel modal-panel balance-editor-modal" role="dialog" aria-modal="true" aria-label="Edit balances" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">Penalty Points</p>
                <h2>Edit balances</h2>
              </div>
              <Button className="ghost-button compact modal-close-button" onClick={() => setIsBalanceEditorOpen(false)} disabled={isBusy} aria-label="Close Edit balances">
                Close
              </Button>
            </div>
            <div className="balance-editor-grid">
              <label className="field">
                <span>Jay balance</span>
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  value={balanceDrafts.jay}
                  onChange={(event) => setBalanceDrafts((current) => ({ ...current, jay: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Kim balance</span>
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  value={balanceDrafts.kim}
                  onChange={(event) => setBalanceDrafts((current) => ({ ...current, kim: event.target.value }))}
                />
              </label>
            </div>
            <div className="button-row balance-editor-actions">
              <Button className="ghost-button compact" onClick={handleClearBalancesFromEditor} disabled={isBusy}>
                Clear balances
              </Button>
              <Button className="primary-button compact" onClick={handleSubmitBalancesFromEditor} disabled={isBusy}>
                Submit
              </Button>
            </div>
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

function QuestionAnswerEntryBase({
  gameId,
  seat,
  viewerSeat,
  currentRound,
  answerLabel,
  oppositeLabel,
  onSubmitAnswer,
  submissionState,
  isQuizRound = false,
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
  const promptLabel = roundType === 'numeric' ? 'Number' : roundType === 'multipleChoice' || roundType === 'trueFalse' || roundType === 'preference' ? 'Choice' : 'Answer';
  const options = choiceOptions.length ? choiceOptions : ['Option A', 'Option B'];
  const isChoiceRound = roundType === 'multipleChoice' || roundType === 'trueFalse' || roundType === 'preference';
  const isListRound = roundType === 'ranked' || roundType === 'sortIntoOrder';
  const listCount = roundType === 'ranked' ? 3 : Math.max(3, Math.min(5, options.length || 4));
  const isRoundOpen = (currentRound?.status || 'open') === 'open';
  const hasServerSubmittedAnswer = submissionState === 'submitted' || Boolean(normalizeText(currentPlayerAnswer?.ownAnswer || ''));
  // IMPORTANT: This must not flip during Firestore snapshots (e.g. when a field
  // like `currentRound.id` is missing on some snapshots). If it changes, the
  // answer form resets and the user loses focus/typed drafts.
  const stableRoundKey = stableRoundIdentityKey(currentRound);
  const nextDraftStorageKey = answerDraftStorageKey(gameId || '', stableRoundKey, currentPlayer);
  const draftStorageKeyRef = useRef('');
  if (nextDraftStorageKey) {
    draftStorageKeyRef.current = nextDraftStorageKey;
  }
  const draftStorageKey = draftStorageKeyRef.current;
  const buildSavedDraft = () => ({
    ownAnswer: String(currentPlayerAnswer?.ownAnswer ?? ''),
    guessedOther: isQuizRound ? '' : String(currentPlayerAnswer?.guessedOther ?? ''),
  });
  const buildInitialDraft = () => {
    const savedDraft = buildSavedDraft();
    if (hasServerSubmittedAnswer) return savedDraft;
    return (draftStorageKey ? readStoredAnswerDraft(draftStorageKey) : null) || savedDraft;
  };
  const [isEditingSubmittedAnswer, setIsEditingSubmittedAnswer] = useState(false);
  const [localSubmittedAnswer, setLocalSubmittedAnswer] = useState(hasServerSubmittedAnswer);
  const [localDraft, setLocalDraft] = useState(() => buildInitialDraft());
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const answerEntryRef = useRef(null);
  const ownAnswerRef = useRef(null);
  const guessedOtherRef = useRef(null);
  const rankedInputRefs = useRef({});
  const draftTouchedRef = useRef(wasAnswerDraftTouched(draftStorageKey));
  const lastServerDraftRef = useRef({ key: draftStorageKey, ownAnswer: '', guessedOther: '', submitted: false });
  const hasSubmittedAnswer = localSubmittedAnswer || hasServerSubmittedAnswer;
  const canEditSubmittedAnswer = !isQuizRound;
  const isLocked = hasSubmittedAnswer && (!canEditSubmittedAnswer || !isEditingSubmittedAnswer);
  const lockedQuizPoints = Number(currentPlayerAnswer?.pointsAwarded || 0);

  useEffect(() => {
    if (!draftStorageKey) return;
    draftTouchedRef.current = wasAnswerDraftTouched(draftStorageKey);
    rankedInputRefs.current = {};
    setIsEditingSubmittedAnswer(false);
    setLocalSubmittedAnswer(hasServerSubmittedAnswer);
    const nextDraft = buildInitialDraft();
    lastServerDraftRef.current = {
      key: draftStorageKey,
      ...buildSavedDraft(),
      submitted: hasServerSubmittedAnswer,
    };
    setLocalDraft(nextDraft);
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey) return;
    const savedDraft = buildSavedDraft();
    const lastServerDraft = lastServerDraftRef.current;
    const serverDraftChanged =
      lastServerDraft.key !== draftStorageKey
      || lastServerDraft.ownAnswer !== savedDraft.ownAnswer
      || lastServerDraft.guessedOther !== savedDraft.guessedOther
      || lastServerDraft.submitted !== hasServerSubmittedAnswer;
    if (!serverDraftChanged) return;

    lastServerDraftRef.current = {
      key: draftStorageKey,
      ...savedDraft,
      submitted: hasServerSubmittedAnswer,
    };

    if (hasServerSubmittedAnswer) {
      setLocalSubmittedAnswer(true);
      if (!isEditingSubmittedAnswer) {
        draftTouchedRef.current = false;
        clearAnswerDraftTouched(draftStorageKey);
        setLocalDraft(savedDraft);
      }
      return;
    }

    if (!draftTouchedRef.current) {
      setLocalDraft(savedDraft);
    }
  }, [draftStorageKey, hasServerSubmittedAnswer, currentPlayerAnswer?.ownAnswer, currentPlayerAnswer?.guessedOther, isEditingSubmittedAnswer]);

  useLayoutEffect(() => {
    if (!draftStorageKey || activeAnswerInputMemory.key !== draftStorageKey || !activeAnswerInputMemory.field || isLocked) return;
    const target =
      rankedInputRefs.current[activeAnswerInputMemory.field]
      || (activeAnswerInputMemory.field === 'guessedOther' ? guessedOtherRef.current : ownAnswerRef.current);
    if (!target || document.activeElement === target) return;
    target.focus({ preventScroll: true });
    try {
      const start = Math.min(activeAnswerInputMemory.selectionStart || 0, target.value.length);
      const end = Math.min(activeAnswerInputMemory.selectionEnd || start, target.value.length);
      target.setSelectionRange(start, end);
    } catch {
      // Some input types do not support selection ranges.
    }
  });

  const rememberFocusedField = (field, event) => {
    const target = event?.target;
    if (!draftStorageKey) return;
    activeAnswerInputMemory.key = draftStorageKey;
    activeAnswerInputMemory.field = field;
    activeAnswerInputMemory.selectionStart = Number(target?.selectionStart ?? target?.value?.length ?? 0);
    activeAnswerInputMemory.selectionEnd = Number(target?.selectionEnd ?? activeAnswerInputMemory.selectionStart);
  };

  const forgetFocusedField = (field) => {
    if (!draftStorageKey || activeAnswerInputMemory.key !== draftStorageKey || activeAnswerInputMemory.field !== field) return;
    window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (!activeElement || activeElement === document.body || answerEntryRef.current?.contains(activeElement)) return;
      if (activeAnswerInputMemory.key === draftStorageKey && activeAnswerInputMemory.field === field) {
        activeAnswerInputMemory.key = '';
        activeAnswerInputMemory.field = '';
        activeAnswerInputMemory.selectionStart = 0;
        activeAnswerInputMemory.selectionEnd = 0;
      }
    }, 0);
  };

  const updateLocalDraft = (patch) => {
    draftTouchedRef.current = true;
    markAnswerDraftTouched(draftStorageKey);
    setLocalDraft((current) => {
      const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      if (draftStorageKey) writeStoredAnswerDraft(draftStorageKey, next);
      return next;
    });
  };

  const handleAnswerAction = async () => {
    if (!isRoundOpen) return;
    if (canEditSubmittedAnswer && hasSubmittedAnswer && !isEditingSubmittedAnswer) {
      setIsEditingSubmittedAnswer(true);
      const restoredDraft = (draftStorageKey ? readStoredAnswerDraft(draftStorageKey) : null) || buildSavedDraft();
      setLocalDraft(restoredDraft);
      return;
    }
    if (draftStorageKey) writeStoredAnswerDraft(draftStorageKey, localDraft);
    setIsSubmittingAnswer(true);
    try {
      const result = await onSubmitAnswer(localDraft);
      if (result !== null) {
        draftTouchedRef.current = false;
        clearAnswerDraftTouched(draftStorageKey);
        setLocalSubmittedAnswer(true);
        setIsEditingSubmittedAnswer(false);
      }
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  const primaryButtonLabel = hasSubmittedAnswer
    ? (isQuizRound ? `Locked · +${formatScore(lockedQuizPoints)}` : isEditingSubmittedAnswer ? 'Save Changes' : 'Edit Answer')
    : isQuizRound ? 'Submit Answer' : 'Submit Round';

  const renderField = (fieldName, value, setter, placeholder) => {
    if (roundType === 'numeric') {
      return (
        <input
          ref={fieldName === 'guessedOther' ? guessedOtherRef : ownAnswerRef}
          type="number"
          inputMode="decimal"
          step="any"
          value={value}
          onFocus={(event) => rememberFocusedField(fieldName, event)}
          onSelect={(event) => rememberFocusedField(fieldName, event)}
          onChange={(event) => {
            rememberFocusedField(fieldName, event);
            setter(event.target.value);
          }}
          onBlur={() => forgetFocusedField(fieldName)}
          placeholder={placeholder}
          disabled={isLocked || !isRoundOpen}
        />
      );
    }

    if (isChoiceRound) {
      return (
        <div className={`choice-grid ${embedded ? 'choice-grid--embedded' : ''}`} role="list">
          {options.map((option, optionIndex) => (
            <button
              key={`${option}-${optionIndex}`}
              type="button"
              className={`choice-button ${value === option ? 'is-on' : ''}`}
              onClick={() => setter(option)}
              disabled={isLocked || !isRoundOpen}
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
                ref={(node) => {
                  const key = `${fieldName}:${index}`;
                  if (node) rankedInputRefs.current[key] = node;
                  else delete rankedInputRefs.current[key];
                }}
                value={entry}
                onFocus={(event) => rememberFocusedField(`${fieldName}:${index}`, event)}
                onSelect={(event) => rememberFocusedField(`${fieldName}:${index}`, event)}
                onChange={(event) => {
                  rememberFocusedField(`${fieldName}:${index}`, event);
                  const next = [...values];
                  next[index] = event.target.value;
                  setter(encodeRankedAnswer(next));
                }}
                onBlur={() => forgetFocusedField(`${fieldName}:${index}`)}
                placeholder={roundType === 'ranked' ? `Rank ${index + 1}` : `Position ${index + 1}`}
                disabled={isLocked || !isRoundOpen}
              />
            </label>
          ))}
        </div>
      );
    }

    return (
      <input
        ref={fieldName === 'guessedOther' ? guessedOtherRef : ownAnswerRef}
        value={value}
        onFocus={(event) => rememberFocusedField(fieldName, event)}
        onSelect={(event) => rememberFocusedField(fieldName, event)}
        onChange={(event) => {
          rememberFocusedField(fieldName, event);
          setter(event.target.value);
        }}
        onBlur={() => forgetFocusedField(fieldName)}
        placeholder={placeholder}
        disabled={isLocked || !isRoundOpen}
      />
    );
  };

  const content = (
    <>
      <div className={`button-row live-round-actions ${embedded ? 'live-round-actions--embedded' : ''}`}>
        <Button
          className={`primary-button compact next-question-button ${hasSubmittedAnswer && !isEditingSubmittedAnswer ? 'next-question-button--edit' : ''}`}
          onClick={handleAnswerAction}
          disabled={isSubmittingAnswer || (!isRoundOpen && !hasSubmittedAnswer) || (isQuizRound && hasSubmittedAnswer)}
        >
          {hasSubmittedAnswer && !isEditingSubmittedAnswer && !isQuizRound ? (
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
      </div>
      <div className={`live-round-grid ${embedded ? 'live-round-grid--embedded' : ''} ${isQuizRound ? 'live-round-grid--quiz-answer' : ''}`}>
        <section className={`answer-section ${embedded ? 'answer-section--embedded' : ''}`}>
          <div className="mini-heading">
            <div>
              <span>Your Answer</span>
              <h3>{answerLabel}</h3>
            </div>
          </div>
          <label className="field">
            <span>My Answer</span>
            {renderField('ownAnswer', localDraft.ownAnswer, (value) => updateLocalDraft({ ownAnswer: value }), `Your ${promptLabel.toLowerCase()}`)}
          </label>
        </section>
        {!isQuizRound ? (
          <section className={`answer-section ${embedded ? 'answer-section--embedded' : ''}`}>
            <div className="mini-heading">
              <div>
                <span>Their Answer</span>
                <h3>What I think {oppositeLabel} will say</h3>
              </div>
            </div>
            <label className="field">
              <span>Their Answer</span>
              {renderField('guessedOther', localDraft.guessedOther, (value) => updateLocalDraft({ guessedOther: value }), `Guess ${oppositeLabel}'s ${promptLabel.toLowerCase()}`)}
            </label>
          </section>
        ) : null}
      </div>
    </>
  );

  if (embedded) {
    return <div className={`room-answer-entry ${isQuizRound ? 'room-answer-entry--quiz' : ''}`} ref={answerEntryRef}>{content}</div>;
  }

  return <section className="panel live-round-panel" ref={answerEntryRef}>{content}</section>;
}

const QuestionAnswerEntry = memo(QuestionAnswerEntryBase, (previous, next) => {
  const previousPlayer = previous.viewerSeat === 'kim' ? 'kim' : previous.viewerSeat === 'jay' ? 'jay' : previous.seat === 'kim' ? 'kim' : 'jay';
  const nextPlayer = next.viewerSeat === 'kim' ? 'kim' : next.viewerSeat === 'jay' ? 'jay' : next.seat === 'kim' ? 'kim' : 'jay';
  const previousAnswer = previous.currentRound?.answers?.[previousPlayer] || {};
  const nextAnswer = next.currentRound?.answers?.[nextPlayer] || {};
  const previousRoundKey = stableRoundIdentityKey(previous.currentRound || {});
  const nextRoundKey = stableRoundIdentityKey(next.currentRound || {});
  return previous.gameId === next.gameId
    && previousPlayer === nextPlayer
    && previousRoundKey === nextRoundKey
    && previous.currentRound?.roundType === next.currentRound?.roundType
    && previous.currentRound?.questionId === next.currentRound?.questionId
    && previous.currentRound?.question === next.currentRound?.question
    && previous.currentRound?.category === next.currentRound?.category
    && JSON.stringify(inferChoiceOptions(previous.currentRound)) === JSON.stringify(inferChoiceOptions(next.currentRound))
    && previous.answerLabel === next.answerLabel
    && previous.oppositeLabel === next.oppositeLabel
    && previous.submissionState === next.submissionState
    && previous.isQuizRound === next.isQuizRound
    && previousAnswer.ownAnswer === nextAnswer.ownAnswer
    && previousAnswer.guessedOther === nextAnswer.guessedOther
    && previous.embedded === next.embedded;
});

function AnswerDesk(props) {
  return <QuestionAnswerEntry {...props} />;
}

function SeatFlag({ seat, className = '' }) {
  if (seat === 'jay') {
    return (
      <span className={`room-seat-flag room-seat-flag--jay ${className}`.trim()} role="img" aria-label="England flag">
        <svg viewBox="0 0 36 24" aria-hidden="true">
          <rect width="36" height="24" rx="4" fill="#ffffff" />
          <rect x="15" width="6" height="24" fill="#d61f26" />
          <rect y="9" width="36" height="6" fill="#d61f26" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`room-seat-flag room-seat-flag--kim ${className}`.trim()} role="img" aria-label="USA flag">
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

function QuizWagerWheelOverlay({ agreement, baseAmount = 0, forceVisible = false, disabled = false }) {
  const [nowMs, setNowMs] = useState(Date.now());
  const normalized = normalizeQuizWagerAgreement({ quizWagerAgreement: agreement });
  const effectiveBaseAmount = normalized.wheelBaseAmount || QUIZ_WHEEL_MAX_AMOUNT;
  const slots = normalized.wheelSlots.length ? normalized.wheelSlots : buildQuizWheelSlots(effectiveBaseAmount);
  const resultIndex = Math.max(0, Math.min(Math.max(0, slots.length - 1), Number(normalized.wheelResultIndex || 0)));
  const storedWheelResultAmount = Number(normalized.wheelResultAmount);
  const storedAgreementAmount = Number(normalized.amount);
  const rawResultAmount = Number.isFinite(storedWheelResultAmount) && storedWheelResultAmount > 0
    ? storedWheelResultAmount
    : Number.isFinite(storedAgreementAmount) && (storedAgreementAmount > 0 || !normalized.lockedByWheel)
      ? storedAgreementAmount
      : slots[resultIndex] || 0;
  const resultAmount = capQuizWheelStake(effectiveBaseAmount, rawResultAmount);
  const slotPreviewMin = slots.length ? Math.min(...slots) : 0;
  const slotPreviewMax = slots.length ? Math.max(...slots) : 0;
  const phase = getQuizWheelPhase(normalized, nowMs);
  const displayPhase = normalized.status === 'wheel_locked' ? 'locked' : phase;
  const spinStartMs = Date.parse(normalized.wheelSpinStartedAt || '');
  const spinEndMs = Date.parse(normalized.wheelSpinEndsAt || '');
  const segmentDegrees = slots.length ? 360 / slots.length : 360;
  const segmentHalfDegrees = segmentDegrees / 2;
  const wheelGraphicStartDegrees = -90;
  const selectedSegmentCenterDegrees = wheelGraphicStartDegrees + (resultIndex * segmentDegrees);
  const finalRotation = (360 * 7) + wheelGraphicStartDegrees - selectedSegmentCenterDegrees;
  const spinDurationMs = Number.isFinite(spinStartMs) && Number.isFinite(spinEndMs)
    ? Math.max(1, spinEndMs - spinStartMs)
    : QUIZ_WHEEL_SPIN_MS;
  const countdownSeconds = Number.isFinite(spinStartMs) ? Math.max(1, Math.ceil((spinStartMs - nowMs) / 1000)) : 3;
  const shouldShowWheel = displayPhase === 'countdown'
    || displayPhase === 'spinning'
    || displayPhase === 'landing'
    || displayPhase === 'locked'
    || forceVisible
    || normalized.wheelOptIn?.jay
    || normalized.wheelOptIn?.kim;

  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'spinning') return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  if (!shouldShowWheel || !slots.length) return null;

  return (
    <div className={`quiz-wheel-inline quiz-wheel-inline--${displayPhase || 'ready'} ${disabled ? 'quiz-wheel-inline--disabled' : ''}`} role="status" aria-live="polite">
      <div className="quiz-wheel-stage">
        <div className="quiz-wheel-pointer" aria-hidden="true" />
        <div className="quiz-wheel-dial-wrap">
        <div
          className={`quiz-wheel-dial ${displayPhase === 'spinning' ? 'quiz-wheel-dial--spinning' : ''} ${displayPhase === 'landing' || displayPhase === 'locked' ? 'quiz-wheel-dial--settled' : ''}`}
          style={{
            transform: displayPhase === 'landing' || displayPhase === 'locked' ? `rotate(${finalRotation}deg)` : 'rotate(0deg)',
            '--quiz-wheel-segment-half': `${segmentHalfDegrees}deg`,
            '--wheel-final-rotation': `${finalRotation}deg`,
            '--wheel-spin-duration': `${spinDurationMs}ms`,
          }}
          aria-hidden="true"
        >
          {slots.map((_, index) => {
            const slotBoundaryAngle = wheelGraphicStartDegrees - segmentHalfDegrees + (index * segmentDegrees);
            return (
              <Fragment key={`quiz-wheel-boundary-${index}`}>
                <span
                  className="quiz-wheel-slot-divider"
                  style={{ '--slot-divider-angle': `${slotBoundaryAngle}deg` }}
                />
                <span
                  className="quiz-wheel-slot-peg"
                  style={{ '--slot-divider-angle': `${slotBoundaryAngle}deg` }}
                />
              </Fragment>
            );
          })}
          {slots.map((slotAmount, index) => {
            const slotAngle = wheelGraphicStartDegrees + (index * segmentDegrees);
            return (
              <span
                className="quiz-wheel-slot-label"
                key={`quiz-wheel-slot-${index}`}
                style={{ '--slot-angle': `${slotAngle}deg`, '--slot-label-angle': `${slotAngle + 90}deg` }}
              >
                {formatScore(slotAmount)}
              </span>
            );
          })}
        </div>
          <div className="quiz-wheel-hub">
            {displayPhase === 'countdown' ? (
              <strong>{countdownSeconds}</strong>
            ) : (
              <strong>{displayPhase === 'landing' || displayPhase === 'locked' ? formatScore(resultAmount) : 'Spin'}</strong>
            )}
            <span>{displayPhase === 'countdown' ? 'Get ready' : displayPhase === 'landing' || displayPhase === 'locked' ? 'Wager locked' : 'Wager wheel'}</span>
          </div>
        </div>
        <div className="quiz-wheel-result">
          <span>{displayPhase === 'countdown' ? 'Wheel starts in' : displayPhase === 'spinning' ? 'Spinning for 5 seconds' : displayPhase === 'locked' || displayPhase === 'landing' ? 'Final shared wager' : 'Wheel slots'}</span>
          <strong>{displayPhase === 'countdown' ? countdownSeconds : displayPhase === 'spinning' ? '...' : displayPhase === 'locked' || displayPhase === 'landing' ? formatScore(resultAmount) : `${formatScore(slotPreviewMin)} to ${formatScore(slotPreviewMax)}`}</strong>
        </div>
      </div>
    </div>
  );
}

function QuizSetupStagePanel({
  game,
  viewerSeat,
  currentUserId,
  playerAccounts,
  chatMessages,
  chatDraft,
  onChatDraftChange,
  onSendChat,
  chatDisplayName,
  quizWagerDraft,
  setQuizWagerDraft,
  onSaveQuizWager,
  onAcceptQuizWager,
  onRejectQuizWager,
  onSetQuizWheelOptIn,
  onMarkReady,
  isBusy,
}) {
  const [nowMs, setNowMs] = useState(Date.now());
  const [optimisticWheelRequesterId, setOptimisticWheelRequesterId] = useState('');
  const currentPlayer = viewerSeat === 'kim' ? 'kim' : 'jay';
  const otherPlayer = oppositeSeatOf(currentPlayer);
  const viewerLabel = gameSeatDisplayName(game, currentPlayer, null);
  const oppositeLabel = gameSeatDisplayName(game, otherPlayer, null);
  const [manualValidationMessage, setManualValidationMessage] = useState('');
  const agreement = normalizeQuizWagerAgreement(game);
  const sharedWagerLocked = isQuizWagerAgreementLocked(game);
  const sharedWagerAmount = getQuizSharedWagerAmount(game);
  const pendingProposal = agreement.status === 'proposal_pending' && Number.isFinite(Number(agreement.proposedAmount));
  const proposalFromViewer = pendingProposal && agreement.proposedBySeat === currentPlayer;
  const incomingProposal = pendingProposal && agreement.proposedBySeat === otherPlayer;
  const counterProposalAvailable = pendingProposal && !proposalFromViewer;
  const wheelPending = agreement.status === 'wheel_pending';
  const requestOwnedByViewer = Boolean(
    wheelPending
    && currentUserId
    && agreement.wheelRequestedByUserId
    && agreement.wheelRequestedByUserId === currentUserId,
  );
  const wheelPendingFromViewer = wheelPending && (
    requestOwnedByViewer
    || (!agreement.wheelRequestedByUserId && agreement.wheelRequestedBySeat === currentPlayer)
  );
  const optimisticPendingFromViewer = Boolean(
    !wheelPending
    && optimisticWheelRequesterId
    && currentUserId
    && optimisticWheelRequesterId === currentUserId,
  );
  const effectiveWheelPendingFromViewer = wheelPendingFromViewer || optimisticPendingFromViewer;
  const wheelPendingFromOther = wheelPending && !wheelPendingFromViewer;
  const wheelRequesterName = agreement.wheelRequestedByName || gameSeatDisplayName(game, agreement.wheelRequestedBySeat || otherPlayer, null) || 'The other player';
  const canActAsOtherPlayer = Boolean(game?.isLocalOnly);
  const allowManualAccept = pendingProposal && (incomingProposal || canActAsOtherPlayer);
  const allowManualReject = pendingProposal && (!proposalFromViewer || canActAsOtherPlayer);
  const proposalLabel = agreement.proposedBySeat ? gameSeatDisplayName(game, agreement.proposedBySeat, null) : 'Player';
  const bothPlayersJoined = Boolean(game?.seats?.jay && game?.seats?.kim);
  const accountWheelBaseAmount = getQuizWheelBaseAmount(playerAccounts);
  const wheelBaseAmount = game?.isLocalOnly && accountWheelBaseAmount <= 0 ? 200 : accountWheelBaseAmount;
  const wheelPhase = getQuizWheelPhase(agreement);
  const wheelActive = wheelPhase === 'countdown' || wheelPhase === 'spinning' || wheelPhase === 'landing';
  const wheelSpinEndsAtMs = Date.parse(agreement.wheelSpinEndsAt || '');
  const wheelResolved = agreement.status === 'wheel_countdown'
    && Number.isFinite(wheelSpinEndsAtMs)
    && nowMs >= wheelSpinEndsAtMs;
  const viewerWheelOptedIn = Boolean(agreement.wheelOptIn?.[currentPlayer]);
  const otherWheelOptedIn = Boolean(agreement.wheelOptIn?.[otherPlayer]);
  const viewerReady = hasQuizSetupReadySeat(game, currentPlayer);
  const otherPlayerReady = hasQuizSetupReadySeat(game, otherPlayer);
  const effectiveSharedWagerLocked = isQuizWagerEffectivelyLocked(game, nowMs) || wheelResolved;
  const pendingWheelAmount = agreement.lockedByWheel
    ? getQuizSharedWagerAmount({ quizWagerAgreement: agreement })
    : (() => {
        const storedWheelAmount = Number(agreement.wheelResultAmount);
        if (Number.isFinite(storedWheelAmount)) return Math.max(0, storedWheelAmount);
        const resultIndex = Number(agreement.wheelResultIndex);
        if (Number.isFinite(resultIndex) && Array.isArray(agreement.wheelSlots) && agreement.wheelSlots.length) {
          return Math.max(0, Number(agreement.wheelSlots[Math.max(0, Math.min(agreement.wheelSlots.length - 1, resultIndex))] || 0));
        }
        return Number(sharedWagerAmount || 0);
      })();
  const readyState = game?.quizReadyState || defaultQuizReadyState('opening');
  const readyStage = normalizeText(readyState.stage || 'opening') || 'opening';
  const countdownEndsAtMs = Date.parse(readyState.countdownEndsAt || '');
  const countdownSecondsLeft = Number.isFinite(countdownEndsAtMs)
    ? Math.max(0, Math.ceil((countdownEndsAtMs - nowMs) / 1000))
    : 0;
  const countdownActive = readyStage === 'countdown';
  const bothPlayersReady = Boolean(viewerReady && otherPlayerReady);
  const launchPending = effectiveSharedWagerLocked
    && Boolean(game?.quizReadyState?.ready?.jay && game?.quizReadyState?.ready?.kim)
    && readyStage !== 'countdown'
    && !game?.currentRound;
  const showSetupReadyCard = Boolean(effectiveSharedWagerLocked || countdownActive || launchPending);
  const shouldPreferWheelMode = Boolean(agreement.lockedByWheel || wheelActive || viewerWheelOptedIn || otherWheelOptedIn);
  const shouldPreferManualMode = Boolean(pendingProposal || (effectiveSharedWagerLocked && !agreement.lockedByWheel));
  const [selectionMode, setSelectionMode] = useState(() => (shouldPreferWheelMode ? 'wheel' : shouldPreferManualMode ? 'manual' : null));
  const hasSelectedWagerMode = selectionMode === 'manual' || selectionMode === 'wheel';
  const isManualMode = selectionMode === 'manual';
  const isWheelMode = selectionMode === 'wheel';
  const cappedProposalAmount = capQuizWagerAmount(agreement.proposedAmount, wheelBaseAmount);
  const activeWagerDisplayAmount = sharedWagerLocked
    ? sharedWagerAmount || 0
    : pendingProposal
      ? cappedProposalAmount
      : capQuizWagerAmount(quizWagerDraft, wheelBaseAmount);
  const displayedQuizWagerDraft = sharedWagerLocked
    ? String(sharedWagerAmount || 0)
    : quizWagerDraft;
  const manualIsInactive = !isManualMode;
  const wheelIsInactive = !isWheelMode;
  const manualIsLocked = manualIsInactive || wheelActive || wheelPending || sharedWagerLocked;
  const wheelIsLocked = wheelIsInactive || sharedWagerLocked;
  const manualActionStackClassName = [
    'button-row',
    'live-round-actions',
    'live-round-actions--embedded',
    'quiz-wager-action-stack',
    'quiz-choice-manual-actions',
    allowManualReject ? '' : 'quiz-choice-manual-single',
  ].filter(Boolean).join(' ');
  const wheelHelperText = launchPending
    ? `Shared wager locked at ${formatScore(sharedWagerAmount || 0)}. Starting Quick Fire...`
    : effectiveSharedWagerLocked && agreement.lockedByWheel
      ? `Wheel locked the shared wager at ${formatScore(sharedWagerAmount || 0)}.`
      : effectiveWheelPendingFromViewer
        ? `Wheel request sent. Waiting for ${oppositeLabel} to agree or reject.`
        : wheelPendingFromOther
          ? `${oppositeLabel} requested wheel mode. Agree and spin or reject.`
          : wheelActive
            ? 'Shared countdown is running for both players.'
            : 'Request a shared wheel spin. The other player must agree before the countdown starts.';
  const negotiationStatusText = launchPending
      ? `Accepted shared wager: ${formatScore(sharedWagerAmount || 0)}. Transitioning into the question round.`
    : sharedWagerLocked
      ? `Agreed shared wager: ${formatScore(sharedWagerAmount || 0)}.`
      : effectiveWheelPendingFromViewer
        ? `Waiting for ${oppositeLabel} to confirm the wheel request.`
        : wheelPendingFromOther
          ? `${oppositeLabel} requested wheel mode.`
          : pendingProposal && proposalFromViewer
            ? `Waiting for ${oppositeLabel} to accept or counter ${formatScore(cappedProposalAmount)}.`
            : pendingProposal
              ? `${proposalLabel} proposed ${formatScore(cappedProposalAmount)}. Accept it or counter with a different amount.`
              : bothPlayersJoined
                ? 'Enter an amount, propose it, then the other player can accept, reject, or counter.'
                : 'Waiting for both players to join before the wager can be agreed.';
  const readySetupAmount = effectiveSharedWagerLocked
    ? (sharedWagerLocked ? Number(sharedWagerAmount || 0) : pendingWheelAmount)
    : Number(sharedWagerAmount || 0);
  const readySetupAmountLabel = agreement.lockedByWheel || wheelResolved ? 'Wheel landed on' : 'Shared wager';
  const readySetupEyebrow = agreement.lockedByWheel || wheelResolved ? 'Wheel spin complete' : 'Shared wager locked';
  const readySetupHeading = countdownActive
    ? `Quick Fire starts in ${Math.max(1, countdownSecondsLeft || 0)}`
    : 'Both players need to click Ready';
  const readySetupIntro = agreement.lockedByWheel || wheelResolved
    ? `The wheel locked in ${formatScore(readySetupAmount || 0)}.`
    : `The shared wager is locked at ${formatScore(readySetupAmount || 0)}.`;
  const readySetupStatus = countdownActive
    ? 'Both players are ready. Launching question one now.'
    : wheelResolved && !sharedWagerLocked
      ? 'Wheel spin finished. Finalizing the shared wager now...'
    : launchPending || bothPlayersReady
      ? 'Both players are ready. Starting the 3 second countdown...'
      : viewerReady
        ? `Waiting for ${oppositeLabel} to click Ready.`
        : otherPlayerReady
          ? `${oppositeLabel} is ready. Click Ready to start the 3 second countdown.`
          : 'Both players must click Ready before question one begins.';

  useEffect(() => {
    if (shouldPreferWheelMode) {
      setSelectionMode('wheel');
      return;
    }
    if (shouldPreferManualMode) {
      setSelectionMode('manual');
    }
  }, [shouldPreferWheelMode, shouldPreferManualMode]);

  useEffect(() => {
    setManualValidationMessage('');
  }, [agreement.status, agreement.proposedAmount, agreement.amount, agreement.wheelRequestedBySeat]);

  useEffect(() => {
    if (wheelPending) {
      setOptimisticWheelRequesterId('');
    }
  }, [wheelPending]);

  useEffect(() => {
    const shouldTick = countdownActive || (agreement.status === 'wheel_countdown' && Number.isFinite(wheelSpinEndsAtMs) && !sharedWagerLocked);
    if (!shouldTick) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [agreement.status, countdownActive, sharedWagerLocked, wheelSpinEndsAtMs]);

  const onManualPrimaryAction = async () => {
    const validationMessage = getQuizWagerValidationMessage(quizWagerDraft, wheelBaseAmount, {
      requireDifferentFrom: incomingProposal ? agreement.proposedAmount : null,
    });
    if (validationMessage) {
      setManualValidationMessage(validationMessage);
      return;
    }
    setManualValidationMessage('');
    await onSaveQuizWager();
  };

  return (
    <>
    <section className="room-active-frame room-active-frame--setup room-active-frame--quiz room-active-frame--quiz-setup" aria-label="Quick Fire quiz setup">
      <div className="scoreboard-sheen" aria-hidden="true" />
      <div className="room-active-stage room-active-stage--answering">
        {showSetupReadyCard ? (
          <section className="quiz-ready-stage-panel">
            <section className="quiz-ready-setup-card" role="status" aria-live="polite">
              <div className="quiz-ready-setup-card__intro">
                <span className="quiz-ready-setup-card__eyebrow">{readySetupEyebrow}</span>
                <strong>{readySetupHeading}</strong>
                <p>{readySetupIntro} Both players must click Ready before the 3 second countdown begins.</p>
              </div>
              <div className="quiz-ready-setup-card__amount" aria-label={`${readySetupAmountLabel} ${formatScore(readySetupAmount || 0)}`}>
                <span>{readySetupAmountLabel}</span>
                <strong>{formatScore(readySetupAmount || 0)}</strong>
              </div>
              <div className="quiz-ready-setup-card__seat-grid">
                <article className={`quiz-ready-seat-card ${viewerReady ? 'is-ready' : ''}`}>
                  <div className="quiz-ready-seat-card__label">
                    <SeatFlag seat={currentPlayer} />
                    <span>{viewerLabel}</span>
                  </div>
                  <strong>{viewerReady ? 'Ready' : 'Waiting'}</strong>
                </article>
                <article className={`quiz-ready-seat-card ${otherPlayerReady ? 'is-ready' : ''}`}>
                  <div className="quiz-ready-seat-card__label">
                    <SeatFlag seat={otherPlayer} />
                    <span>{oppositeLabel}</span>
                  </div>
                  <strong>{otherPlayerReady ? 'Ready' : 'Waiting'}</strong>
                </article>
              </div>
              <div className="quiz-ready-setup-card__footer">
                {countdownActive ? (
                  <div className="quiz-ready-countdown" aria-live="polite">
                    <strong>{Math.max(1, countdownSecondsLeft || 0)}</strong>
                    <span>Starting Quick Fire...</span>
                  </div>
                ) : (
                  <Button className="primary-button compact" onClick={() => onMarkReady?.(currentPlayer)} disabled={isBusy || !effectiveSharedWagerLocked || viewerReady || wheelActive}>
                    {viewerReady ? 'Ready' : 'Click Ready'}
                  </Button>
                )}
                <span className="quiz-ready-setup-card__status">{readySetupStatus}</span>
              </div>
            </section>
          </section>
        ) : (
          <section className="quiz-wager-mode-panel">
            <div className={`quiz-choice-grid ${hasSelectedWagerMode ? `quiz-choice-grid--selected quiz-choice-grid--selected-${selectionMode}` : 'quiz-choice-grid--needs-selection'}`}>
            <section className={`quiz-choice-zone quiz-choice-zone--manual ${isManualMode ? 'is-active' : 'is-shaded'}`} aria-disabled={manualIsInactive}>
              <div className="quiz-choice-zone__panel-head quiz-choice-zone__panel-head--manual">
                <h2>Agree a shared wager</h2>
              </div>
              <div className={`quiz-choice-zone__content quiz-choice-zone__content--manual ${manualIsLocked ? 'is-locked' : ''}`}>
                <div className="quiz-wager-amount-card quiz-choice-manual-card">
                  <label className="field quiz-wager-amount-field">
                    <span>Insert wager amount here</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max={wheelBaseAmount}
                      value={displayedQuizWagerDraft}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setManualValidationMessage('');
                        setQuizWagerDraft(nextValue);
                      }}
                      onFocus={(event) => event.target.select()}
                      placeholder="0"
                      disabled={sharedWagerLocked || manualIsLocked}
                    />
                  </label>
                  <span className="quiz-wager-cap-copy">{`Enter a value between 0 and ${formatScore(wheelBaseAmount)}.`}</span>
                  {manualValidationMessage ? (
                    <p className="quiz-wager-validation" role="alert">{manualValidationMessage}</p>
                  ) : null}
                  <div className="quiz-negotiation-status">
                    <span>{negotiationStatusText}</span>
                  </div>
                </div>
                <div className="quiz-negotiation-focus-card">
                  <span className="quiz-negotiation-focus-label">Shared wager</span>
                  <div className="quiz-negotiation-focus-body">
                    <strong>{formatScore(activeWagerDisplayAmount)}</strong>
                    <p>{negotiationStatusText}</p>
                  </div>
                  <div className={manualActionStackClassName}>
                    {allowManualReject ? (
                      <Button
                        className="ghost-button compact quiz-wager-reject-button"
                        onClick={onRejectQuizWager}
                        disabled={isBusy || manualIsLocked || !allowManualReject || sharedWagerLocked || wheelActive || wheelPending}
                      >
                        Reject
                      </Button>
                    ) : null}
                    <Button
                      className="ghost-button compact quiz-wager-propose-button"
                      onClick={onManualPrimaryAction}
                      disabled={isBusy || manualIsLocked || !bothPlayersJoined || sharedWagerLocked || wheelActive || proposalFromViewer}
                    >
                      {counterProposalAvailable ? 'Propose New Wager' : proposalFromViewer ? `Waiting for ${oppositeLabel}` : 'Propose Wager'}
                    </Button>
                    <Button
                      className="primary-button compact quiz-wager-accept-button"
                      onClick={onAcceptQuizWager}
                      disabled={isBusy || manualIsLocked || !allowManualAccept || sharedWagerLocked || wheelActive || wheelPending}
                    >
                      Accept
                    </Button>
                  </div>
                </div>
              </div>
              {manualIsInactive ? (
                <div className="quiz-choice-inactive-overlay" aria-hidden="true" />
              ) : null}
            </section>

            <section className="quiz-choice-zone quiz-choice-zone--chat is-active">
              <div className="quiz-choice-zone__intro">
                <span className="quiz-choice-zone__kicker">YOU CHOOSE</span>
                <p>{hasSelectedWagerMode ? 'Pick how you’d like to agree on the wager.' : 'Select an option to continue.'}</p>
              </div>
              <div className="quiz-choice-zone__choice-stack" aria-label="Quick Fire wager mode">
                <button
                  type="button"
                  className={`dashboard-pill tab-button quiz-choice-pill quiz-choice-pill--manual ${isManualMode ? 'is-active' : hasSelectedWagerMode ? 'is-muted' : 'is-unselected'}`}
                  onClick={() => setSelectionMode('manual')}
                  aria-pressed={isManualMode}
                >
                  <span className="quiz-choice-arrow quiz-choice-arrow--left" aria-hidden="true">←</span>
                  <span className="quiz-choice-option-text">Manual negotiation</span>
                </button>
                <button
                  type="button"
                  className={`dashboard-pill tab-button quiz-choice-pill quiz-choice-pill--wheel ${isWheelMode ? 'is-active' : hasSelectedWagerMode ? 'is-muted' : 'is-unselected'}`}
                  onClick={() => setSelectionMode('wheel')}
                  aria-pressed={isWheelMode}
                >
                  <span className="quiz-choice-option-text">Wheel spin</span>
                  <span className="quiz-choice-arrow quiz-choice-arrow--right" aria-hidden="true">→</span>
                </button>
              </div>
              <div className="quiz-choice-zone__content quiz-choice-zone__content--chat">
                <div className="quiz-negotiation-chat quiz-choice-chat">
                  <ChatPanel
                    compact
                    messages={chatMessages}
                    draft={chatDraft}
                    onDraftChange={onChatDraftChange}
                    onSend={onSendChat}
                    isBusy={isBusy}
                    seat={currentPlayer}
                    displayName={chatDisplayName}
                  />
                </div>
              </div>
            </section>

            <section className={`quiz-choice-zone quiz-choice-zone--wheel ${isWheelMode ? 'is-active' : 'is-shaded'}`} aria-disabled={wheelIsInactive}>
              <div className="quiz-choice-zone__panel-head quiz-choice-zone__panel-head--wheel">
                <h2>Wager Wheel</h2>
                <p className="quiz-wager-intro">Let the wheel set one shared wager.</p>
              </div>
              <div className={`quiz-choice-zone__content quiz-choice-zone__content--wheel ${wheelIsLocked ? 'is-locked' : ''}`}>
                <div className="quiz-wager-wheel-card quiz-choice-wheel-card">
                  <QuizWagerWheelOverlay agreement={agreement} baseAmount={wheelBaseAmount} forceVisible disabled={wheelIsLocked} />
                </div>
                <div className="button-row live-round-actions live-round-actions--embedded quiz-wager-action-stack quiz-wheel-action-stack">
                  {wheelPendingFromOther ? (
                    <>
                      <Button
                        className="primary-button compact"
                        onClick={onAcceptQuizWager}
                        disabled={isBusy || wheelIsInactive || !bothPlayersJoined || sharedWagerLocked || wheelActive}
                      >
                        Accept &amp; Spin
                      </Button>
                      <Button
                        className="ghost-button compact"
                        onClick={onRejectQuizWager}
                        disabled={isBusy || wheelIsInactive || sharedWagerLocked || wheelActive}
                      >
                        Reject
                      </Button>
                    </>
                  ) : (
                    <Button
                      className="primary-button compact"
                      onClick={() => {
                        setOptimisticWheelRequesterId(currentUserId || 'pending-wheel-request');
                        onSetQuizWheelOptIn?.(true);
                      }}
                      disabled={isBusy || wheelIsInactive || !bothPlayersJoined || sharedWagerLocked || wheelActive || wheelPending || viewerWheelOptedIn}
                    >
                      {effectiveWheelPendingFromViewer ? `Waiting for ${oppositeLabel}` : 'Spin the Wheel'}
                    </Button>
                  )}
                  <p className="quiz-mode-helper">{wheelHelperText}</p>
                </div>
              </div>
              {wheelIsInactive ? (
                <div className="quiz-choice-inactive-overlay" aria-hidden="true" />
              ) : null}
            </section>
            </div>
          </section>
        )}
      </div>
    </section>
    {effectiveWheelPendingFromViewer ? (
      <div className="quiz-wheel-request-banner" role="status" aria-live="polite">
        <strong>Loading, waiting for {oppositeLabel} to confirm the wheel request.</strong>
        <span>{oppositeLabel} can spin the wheel or reject and return both players to negotiation.</span>
      </div>
    ) : null}
    </>
  );
}

function QuizLiveStatus({ currentRound, revealIsReady }) {
  const [nowMs, setNowMs] = useState(Date.now());
  const isRoundOpen = (currentRound?.status || 'open') === 'open';

  useEffect(() => {
    if (revealIsReady || !isRoundOpen) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [revealIsReady, isRoundOpen, stableRoundIdentityKey(currentRound || {})]);

  const quizEndsAtMs = Date.parse(currentRound?.quizTimerEndsAt || '');
  const quizMsLeft = Number.isFinite(quizEndsAtMs) ? Math.max(0, quizEndsAtMs - nowMs) : QUIZ_TIMER_SECONDS * 1000;
  const quizSecondsLeft = Math.max(0, quizMsLeft / 1000);
  const quizDisplaySeconds = Math.ceil(quizSecondsLeft);
  const quizPossiblePoints = pointsFromTimerMilliseconds(quizMsLeft);
  const quizTimerProgress = Math.max(0, Math.min(1, quizMsLeft / (QUIZ_TIMER_SECONDS * 1000)));

  if (revealIsReady) return null;

  return (
    <>
      <div className="quiz-live-status">
        <div className="quiz-status-grid">
          <article className="quiz-status-card">
            <span>Timer</span>
            <strong>{quizDisplaySeconds}s</strong>
          </article>
          <article className="quiz-status-card">
            <span>Points</span>
            <strong>{formatScore(quizPossiblePoints)}</strong>
          </article>
        </div>
        <div className="quiz-timer-bar" aria-hidden="true">
          <div className="quiz-timer-bar-fill" style={{ transform: `scaleX(${quizTimerProgress})` }} />
        </div>
      </div>
    </>
  );
}

function RoomRevealPlayerCard({ game, viewerSeat, seat, currentRound, totalPenalty, roundPenalty, isQuizGame = false, totalQuizPoints = 0 }) {
  const playerSeat = seat === 'kim' ? 'kim' : 'jay';
  const oppositeSeat = playerSeat === 'jay' ? 'kim' : 'jay';
  const playerLabel = gameSeatDisplayName(game, playerSeat, currentRound);
  const oppositeLabel = gameSeatDisplayName(game, oppositeSeat, currentRound);
  const [quizRevealResolved, setQuizRevealResolved] = useState(false);
  const quizRevealAnimationKey = `${stableRoundIdentityKey(currentRound || {})}:${playerSeat}`;

  useEffect(() => {
    if (!isQuizGame) return undefined;
    setQuizRevealResolved(false);
    const timer = window.setTimeout(() => setQuizRevealResolved(true), QUIZ_REVEAL_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [isQuizGame, quizRevealAnimationKey]);

  if (isQuizGame) {
    const answer = currentRound?.answers?.[playerSeat] || {};
    const playerAnswerRaw = answer?.ownAnswer || '';
    const playerAnswer = formatRoundAnswerValue(playerAnswerRaw, currentRound?.roundType);
    const finalResult = normalizeText(answer?.finalResult || answer?.originalSystemResult || (answer?.wasCorrect ? 'correct' : 'incorrect')) || 'incorrect';
    const wasCorrect = finalResult === 'correct';
    const lockedPoints = Number(answer?.pointsAwarded || 0);
    const lockedTimerValue = Number(answer?.timerValue || 0);
    const resultClass = quizRevealResolved
      ? wasCorrect
        ? 'room-reveal-player-card--correct'
        : 'room-reveal-player-card--incorrect'
      : wasCorrect
        ? 'room-reveal-player-card--quiz-flash-correct'
        : 'room-reveal-player-card--quiz-flash-incorrect';
    return (
      <article className={`room-reveal-player-card room-reveal-player-card--quiz-result room-reveal-player-card--${playerSeat} ${resultClass}`}>
        <div className="room-reveal-player-head">
          <SeatFlag seat={playerSeat} />
          <div>
            <span>{playerSeat === viewerSeat ? 'You' : 'Other player'}</span>
            <h3>{playerLabel}</h3>
          </div>
        </div>
        <div className="room-reveal-player-body">
          <div className="room-reveal-answer-block">
            <span>Submitted answer</span>
            <div className="room-reveal-answer-copy">
              <strong>{playerAnswerRaw ? playerAnswer : 'No answer'}</strong>
            </div>
          </div>
          <div className="room-reveal-answer-block room-reveal-answer-block--guess">
            <span>Result</span>
            <div className="room-reveal-answer-copy">
              <strong>{quizRevealResolved ? (wasCorrect ? 'Correct' : 'Incorrect') : 'Revealing...'}</strong>
            </div>
            <small className={`room-reveal-match room-reveal-match--${wasCorrect ? 'success' : 'warning'}`}>
              {quizRevealResolved ? (wasCorrect ? `+${formatScore(lockedPoints)} locked` : '0 points') : 'Result pending'}
            </small>
          </div>
        </div>
        <div className="room-reveal-score-strip">
          <div>
            <span>Locked at</span>
            <strong>{`${Math.max(0, lockedTimerValue)}s`}</strong>
          </div>
          <div>
            <span>Total quiz score</span>
            <strong>{formatScore(totalQuizPoints || 0)}</strong>
          </div>
        </div>
      </article>
    );
  }
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

function RoomActiveFrameBase({
  game,
  seat,
  viewerSeat,
  role,
  status,
  currentRound,
  baseTotals,
  liveTotals,
  onSubmitAnswer,
  onMarkReady,
  onRequestQuizOverride,
  onRespondQuizOverride,
  submissionState,
  revealIsReady,
  penaltyDraft,
  setPenaltyDraft,
  onNextQuestion,
  onPauseToggle,
  onOpenQuestionNote,
  currentFeedbackValue = '',
  onSetQuestionFeedback,
  currentReplayRequested = false,
  onSetQuestionReplay,
  chatMessages = [],
  chatDraft = '',
  onChatDraftChange,
  onSendChat,
  chatSeat = '',
  chatDisplayName = '',
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
  const isQuizGame = (game?.gameMode || 'standard') === 'quiz' && (game?.questionBankType || 'game') === 'quiz';
  const stageStatusLabel = revealIsReady
    ? 'Results'
    : submissionState === 'submitted'
      ? 'Waiting'
      : 'Answering';
  const showReplayAction = (game?.gameMode || 'standard') === 'standard' && (game?.questionBankType || 'game') === 'game';
  const viewerAnswer = currentRound?.answers?.[currentPlayer] || {};
  const otherOverrideRequest = currentRound?.overrideRequests?.[otherPlayer] || null;
  const viewerOverrideRequest = currentRound?.overrideRequests?.[currentPlayer] || null;
  const viewerQuizResult = normalizeText(viewerAnswer?.finalResult || viewerAnswer?.originalSystemResult || (viewerAnswer?.wasCorrect ? 'correct' : 'incorrect'));
  const quizRevealTotals = useMemo(
    () => ({
      jay: Number(game?.quizTotals?.jay || 0) + Number(currentRound?.answers?.jay?.pointsAwarded || 0),
      kim: Number(game?.quizTotals?.kim || 0) + Number(currentRound?.answers?.kim?.pointsAwarded || 0),
    }),
    [game?.quizTotals?.jay, game?.quizTotals?.kim, currentRound?.answers?.jay?.pointsAwarded, currentRound?.answers?.kim?.pointsAwarded],
  );
  const nextReadyBySeat = {
    jay: hasNextReadySeat(currentRound, 'jay'),
    kim: hasNextReadySeat(currentRound, 'kim'),
  };

  return (
    <section className={`room-active-frame room-active-frame--${stage} ${isQuizGame ? 'room-active-frame--quiz' : ''}`} aria-label="Active round scoreboard">
      <div className="scoreboard-sheen" aria-hidden="true" />
      <div className={`room-active-stage room-active-stage--${stage} ${isQuizGame ? 'room-active-stage--quiz' : ''}`}>
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
        {isQuizGame ? <QuizLiveStatus currentRound={currentRound} revealIsReady={revealIsReady} /> : null}
        {isQuizGame && !revealIsReady && viewerAnswer?.ownAnswer ? (
          <div className="quiz-override-strip">
            <span className={`quiz-override-status ${viewerQuizResult === 'correct' ? 'is-correct' : 'is-incorrect'}`}>
              {viewerQuizResult === 'correct' ? 'System: Correct' : 'System: Incorrect'}
            </span>
            <div className="quiz-override-actions">
              {viewerOverrideRequest?.status === 'pending' ? (
                <span className="quiz-override-pending">Override pending</span>
              ) : (
                <>
                  {viewerQuizResult === 'correct' ? (
                    <Button className="ghost-button compact" onClick={() => onRequestQuizOverride?.('incorrect')} disabled={isBusy}>
                      Mark as Incorrect
                    </Button>
                  ) : (
                    <Button className="ghost-button compact" onClick={() => onRequestQuizOverride?.('correct')} disabled={isBusy}>
                      Override / Mark as Correct
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        ) : null}
        {isQuizGame && !revealIsReady && otherOverrideRequest?.status === 'pending' ? (
          <div className="quiz-override-strip quiz-override-strip--incoming">
            <span className="quiz-override-pending">{`Override request: mark ${oppositeLabel} as ${otherOverrideRequest?.requestedFinalResult || 'correct/incorrect'}?`}</span>
            <div className="quiz-override-actions">
              <Button className="primary-button compact" onClick={() => onRespondQuizOverride?.(otherPlayer, 'approved')} disabled={isBusy}>
                Approve
              </Button>
              <Button className="ghost-button compact" onClick={() => onRespondQuizOverride?.(otherPlayer, 'rejected')} disabled={isBusy}>
                Reject
              </Button>
            </div>
          </div>
        ) : null}

        {!revealIsReady ? (
          <div className={`room-active-answer-stack ${isQuizGame ? 'room-active-answer-stack--quiz' : ''}`}>
            <div className={`room-active-question room-active-question--answering ${questionDensity}`}>
              <p>{question}</p>
              {!isQuizGame ? (
                <div className="question-note-actions">
                  <button type="button" className="ghost-button compact question-flag-button" onClick={() => onOpenQuestionNote?.(currentRound)} disabled={isBusy} aria-label="Flag question for private note">🚩</button>
                  <button
                    type="button"
                    className={`ghost-button compact question-like-button ${currentFeedbackValue === 'liked' ? 'is-on' : ''}`}
                    onClick={() => onSetQuestionFeedback?.(currentRound, 'liked')}
                    disabled={isBusy}
                    aria-label="Thumbs up this question"
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    className={`ghost-button compact question-dislike-button ${currentFeedbackValue === 'disliked' ? 'is-on' : ''}`}
                    onClick={() => onSetQuestionFeedback?.(currentRound, 'disliked')}
                    disabled={isBusy}
                    aria-label="Thumbs down this question"
                  >
                    👎
                  </button>
                  {showReplayAction ? (
                    <button
                      type="button"
                      className={`ghost-button compact question-replay-button ${currentReplayRequested ? 'is-on' : ''}`}
                      onClick={() => onSetQuestionReplay?.(currentRound)}
                      disabled={isBusy}
                      aria-label="Allow this question to replay in future games"
                    >
                      ↻
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <QuestionAnswerEntry
              gameId={game?.id || ''}
              embedded
              seat={currentPlayer}
              viewerSeat={currentPlayer}
              currentRound={currentRound}
              answerLabel={viewerLabel}
              oppositeLabel={oppositeLabel}
              onSubmitAnswer={onSubmitAnswer}
              submissionState={submissionState}
              isQuizRound={isQuizGame}
            />
          </div>
        ) : (
          <div className={`room-active-reveal-stack ${isQuizGame ? 'room-active-reveal-stack--quiz' : ''}`}>
            <div className={`room-active-question room-active-question--reveal ${questionDensity}`}>
              <p>{question}</p>
              <div className="question-note-actions">
                <button type="button" className="ghost-button compact question-flag-button" onClick={() => onOpenQuestionNote?.(currentRound)} disabled={isBusy} aria-label="Flag question for private note">🚩</button>
                <button
                  type="button"
                  className={`ghost-button compact question-like-button ${currentFeedbackValue === 'liked' ? 'is-on' : ''}`}
                  onClick={() => onSetQuestionFeedback?.(currentRound, 'liked')}
                  disabled={isBusy}
                  aria-label="Thumbs up this question"
                >
                  👍
                </button>
                <button
                  type="button"
                  className={`ghost-button compact question-dislike-button ${currentFeedbackValue === 'disliked' ? 'is-on' : ''}`}
                  onClick={() => onSetQuestionFeedback?.(currentRound, 'disliked')}
                  disabled={isBusy}
                  aria-label="Thumbs down this question"
                >
                  👎
                </button>
                {showReplayAction ? (
                  <button
                    type="button"
                    className={`ghost-button compact question-replay-button ${currentReplayRequested ? 'is-on' : ''}`}
                    onClick={() => onSetQuestionReplay?.(currentRound)}
                    disabled={isBusy}
                    aria-label="Allow this question to replay in future games"
                  >
                    ↻
                  </button>
                ) : null}
              </div>
            </div>

            <div className={`room-reveal-layout ${isQuizGame ? 'room-reveal-layout--quiz' : ''}`}>
              <RoomRevealPlayerCard
                game={game}
                viewerSeat={currentPlayer}
                seat={currentPlayer}
                currentRound={currentRound}
                totalPenalty={liveTotals?.[currentPlayer] ?? baseTotals?.[currentPlayer] ?? 0}
                roundPenalty={penaltyPreview[currentPlayer]}
                isQuizGame={isQuizGame}
                totalQuizPoints={quizRevealTotals[currentPlayer]}
              />

              <section className="room-reveal-center-card" aria-label="Round result">
                {isQuizGame ? (
                  <>
                    <span>Correct Answer</span>
                    <strong>{formatRoundAnswerValue(currentRound?.correctAnswer || currentRound?.normalizedCorrectAnswer || 'No answer provided', currentRound?.roundType)}</strong>
                    <p>
                      {viewerLabel} {normalizeText(currentRound?.answers?.[currentPlayer]?.finalResult || currentRound?.answers?.[currentPlayer]?.originalSystemResult || (currentRound?.answers?.[currentPlayer]?.wasCorrect ? 'correct' : 'incorrect')) === 'correct'
                        ? `+${formatScore(Number(currentRound?.answers?.[currentPlayer]?.pointsAwarded || 0))}`
                        : '+0'}
                      {' · '}
                      {oppositeLabel} {normalizeText(currentRound?.answers?.[otherPlayer]?.finalResult || currentRound?.answers?.[otherPlayer]?.originalSystemResult || (currentRound?.answers?.[otherPlayer]?.wasCorrect ? 'correct' : 'incorrect')) === 'correct'
                        ? `+${formatScore(Number(currentRound?.answers?.[otherPlayer]?.pointsAwarded || 0))}`
                        : '+0'}
                    </p>
                    <small>
                      Quiz totals {viewerLabel} {formatScore(quizRevealTotals[currentPlayer])}
                      {' · '}
                      {oppositeLabel} {formatScore(quizRevealTotals[otherPlayer])}
                    </small>
                    <div className="ready-gate-row ready-gate-row--reveal" role="status" aria-live="polite">
                      <Button className="primary-button compact" onClick={() => onMarkReady?.(currentPlayer)} disabled={isBusy || nextReadyBySeat[currentPlayer]}>
                        Ready for Next Question
                      </Button>
                      <span className="ready-gate-copy">
                        {nextReadyBySeat[currentPlayer]
                          ? 'Waiting for the other player to get ready for the next question…'
                          : 'Both players must click Ready for Next Question before the next quiz question appears.'}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </section>

              <RoomRevealPlayerCard
                game={game}
                viewerSeat={currentPlayer}
                seat={otherPlayer}
                currentRound={currentRound}
                totalPenalty={liveTotals?.[otherPlayer] ?? baseTotals?.[otherPlayer] ?? 0}
                roundPenalty={penaltyPreview[otherPlayer]}
                isQuizGame={isQuizGame}
                totalQuizPoints={quizRevealTotals[otherPlayer]}
              />
            </div>

            {isQuizGame ? (
              <section className="quiz-reveal-chat-card" aria-label="Quick Fire reveal chat">
                <div className="quiz-reveal-chat-heading">
                  <div>
                    <span className="scoreboard-kicker">Reveal Chat</span>
                    <h3>Discuss this answer</h3>
                  </div>
                </div>
                <ChatPanel
                  compact
                  messages={chatMessages}
                  draft={chatDraft}
                  onDraftChange={onChatDraftChange}
                  onSend={onSendChat}
                  isBusy={isBusy}
                  seat={chatSeat || currentPlayer}
                  displayName={chatDisplayName || viewerLabel}
                />
              </section>
            ) : null}

            {role !== 'host' && !isQuizGame ? (
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

const RoomActiveFrame = memo(RoomActiveFrameBase, (previous, next) => {
  const previousCurrentPlayer = previous.viewerSeat === 'kim' ? 'kim' : previous.viewerSeat === 'jay' ? 'jay' : previous.seat === 'kim' ? 'kim' : 'jay';
  const nextCurrentPlayer = next.viewerSeat === 'kim' ? 'kim' : next.viewerSeat === 'jay' ? 'jay' : next.seat === 'kim' ? 'kim' : 'jay';
  const previousOtherPlayer = oppositeSeatOf(previousCurrentPlayer);
  const nextOtherPlayer = oppositeSeatOf(nextCurrentPlayer);
  const previousRoundKey = stableRoundIdentityKey(previous.currentRound || {});
  const nextRoundKey = stableRoundIdentityKey(next.currentRound || {});
  const previousIsQuizReveal = previous.revealIsReady && (previous.game?.gameMode || 'standard') === 'quiz' && (previous.game?.questionBankType || 'game') === 'quiz';
  const nextIsQuizReveal = next.revealIsReady && (next.game?.gameMode || 'standard') === 'quiz' && (next.game?.questionBankType || 'game') === 'quiz';
  const quizRevealChatMatches = !previousIsQuizReveal && !nextIsQuizReveal
    ? true
    : previous.chatDraft === next.chatDraft
      && previous.chatSeat === next.chatSeat
      && previous.chatDisplayName === next.chatDisplayName
      && JSON.stringify(previous.chatMessages || []) === JSON.stringify(next.chatMessages || []);
  return previous.game?.id === next.game?.id
    && previousRoundKey === nextRoundKey
    && previous.role === next.role
    && previous.status === next.status
    && previous.revealIsReady === next.revealIsReady
    && previous.submissionState === next.submissionState
    && previous.currentFeedbackValue === next.currentFeedbackValue
    && previous.currentReplayRequested === next.currentReplayRequested
    && previous.isBusy === next.isBusy
    && previous.currentRound?.status === next.currentRound?.status
    && previous.currentRound?.question === next.currentRound?.question
    && previous.currentRound?.category === next.currentRound?.category
    && previous.currentRound?.roundType === next.currentRound?.roundType
    && previous.currentRound?.correctAnswer === next.currentRound?.correctAnswer
    && previous.currentRound?.quizTimerEndsAt === next.currentRound?.quizTimerEndsAt
    && JSON.stringify(previous.currentRound?.multipleChoiceOptions || []) === JSON.stringify(next.currentRound?.multipleChoiceOptions || [])
    && JSON.stringify(previous.currentRound?.ready || {}) === JSON.stringify(next.currentRound?.ready || {})
    && JSON.stringify(previous.currentRound?.nextReady || {}) === JSON.stringify(next.currentRound?.nextReady || {})
    && JSON.stringify(previous.currentRound?.overrideRequests || {}) === JSON.stringify(next.currentRound?.overrideRequests || {})
    && JSON.stringify(previous.currentRound?.answers || {}) === JSON.stringify(next.currentRound?.answers || {})
    && Number(previous.baseTotals?.jay || 0) === Number(next.baseTotals?.jay || 0)
    && Number(previous.baseTotals?.kim || 0) === Number(next.baseTotals?.kim || 0)
    && Number(previous.liveTotals?.jay || 0) === Number(next.liveTotals?.jay || 0)
    && Number(previous.liveTotals?.kim || 0) === Number(next.liveTotals?.kim || 0)
    && Number(previous.penaltyDraft?.jay || 0) === Number(next.penaltyDraft?.jay || 0)
    && Number(previous.penaltyDraft?.kim || 0) === Number(next.penaltyDraft?.kim || 0)
    && previousCurrentPlayer === nextCurrentPlayer
    && previousOtherPlayer === nextOtherPlayer
    && quizRevealChatMatches;
});

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
  const composerInputRef = useRef(null);
  const chatScrollStateRef = useRef({
    scrollTop: 0,
    nearBottom: true,
    lastMessageId: '',
  });
  // Guard to prevent double-send when Enter is pressed rapidly or key events fire multiple times
  const sendLockRef = useRef(false);

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

  const submitChatMessage = useCallback((textOverride = '') => {
    const nextText = String(textOverride || draft || '').trim();
    if (isBusy || !nextText || sendLockRef.current) return;
    try {
      sendLockRef.current = true;
      const res = onSend(nextText);
      Promise.resolve(res).finally(() => {
        sendLockRef.current = false;
      });
    } catch (err) {
      sendLockRef.current = false;
      throw err;
    }
  }, [draft, isBusy, onSend]);

  const handleChatSubmitKeyDown = useCallback((event) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    submitChatMessage();
  }, [submitChatMessage]);

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

      <form
        className="chat-compose"
        onSubmit={(event) => {
          event.preventDefault();
          submitChatMessage(composerInputRef.current?.value || '');
        }}
      >
        <textarea
          ref={composerInputRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={`Message as ${displayName || 'player'}`}
          maxLength={240}
          rows={2}
          enterKeyHint="send"
          onKeyDown={handleChatSubmitKeyDown}
        />
        <Button type="submit" className="primary-button compact" disabled={isBusy || !draft.trim()}>
          Send
        </Button>
      </form>
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
  const isQuizGame = (gameSummary?.gameMode || 'standard') === 'quiz';
  const quizTotals = gameSummary?.quizTotals || { jay: 0, kim: 0 };
  const wagerSettlement = gameSummary?.wagerSettlement || null;
  const sharedWagerAmount = wagerSettlement
    ? Math.max(
        0,
        Number(wagerSettlement.sharedWager || 0),
        Number(wagerSettlement.jayWager || 0),
        Number(wagerSettlement.kimWager || 0),
      )
    : 0;
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
            {isQuizGame && sharedWagerAmount > 0 ? (
              <span className="game-summary-meta-pill">{`Played for ${formatScore(sharedWagerAmount)}`}</span>
            ) : null}
          </div>
        </div>
        <div className="game-summary-header-actions">
          {onClose ? (
            <Button className="ghost-button compact modal-close-button game-summary-close-button" onClick={onClose} aria-label="Close game summary">
              Close
            </Button>
          ) : null}
          <span className="status-pill">{winner === 'tie' ? 'Tied' : `${PLAYER_LABEL[winner] || winner} won`}</span>
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
                {isQuizGame ? (
                  <>
                    <div className="stat-tile"><small>Played For</small><strong>{formatScore(sharedWagerAmount || 0)}</strong></div>
                    <div className="stat-tile"><small>Jay Quiz</small><strong>{formatScore(quizTotals.jay || 0)}</strong></div>
                    <div className="stat-tile"><small>Kim Quiz</small><strong>{formatScore(quizTotals.kim || 0)}</strong></div>
                  </>
                ) : (
                  <>
                    <div className="stat-tile"><small>Jay Final</small><strong>{formatScore(finalScores.jay || 0)}</strong></div>
                    <div className="stat-tile"><small>Kim Final</small><strong>{formatScore(finalScores.kim || 0)}</strong></div>
                  </>
                )}
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
  connectionState,
  game,
  rounds,
  questionFeedback,
  questionReplays,
  playerAccounts,
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
  onMarkReady,
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
  onReconnectLiveRoom,
  onSaveQuestionNote,
  onSaveQuestionFeedback,
  onSaveQuestionReplay,
  onSaveQuizWager,
  onAcceptQuizWager,
  onRejectQuizWager,
  onSetQuizWheelOptIn,
  onRequestQuizOverride,
  onRespondQuizOverride,
  quizWagerDraft,
  setQuizWagerDraft,
}) {
  const activePalette = PALETTES[loadThemeIndex() % PALETTES.length];
  const analytics = useMemo(() => calculateAnalytics(rounds), [rounds]);
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
  const viewerLabel = gameSeatDisplayName(game, resolvedViewerSeat, currentRound);
  const liveTotals = currentRound
    ? {
        jay: addScores(baseTotals.jay, parseNumber(penaltyDraft.jay || currentRound.penalties?.jay || 0, 0)),
        kim: addScores(baseTotals.kim, parseNumber(penaltyDraft.kim || currentRound.penalties?.kim || 0, 0)),
      }
    : baseTotals;
  const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
  const bothPlayersSubmitted = Boolean(currentRound?.answers?.jay?.ownAnswer && currentRound?.answers?.kim?.ownAnswer);
  const revealIsReady = bothPlayersSubmitted || currentRound?.status === 'reveal';
  const submissionState = currentRound?.answers?.[resolvedViewerSeat]?.ownAnswer ? 'submitted' : 'draft';
  const submittedBySeat = {
    jay: hasSubmittedRoundAnswer(currentRound, 'jay'),
    kim: hasSubmittedRoundAnswer(currentRound, 'kim'),
  };
  const quizSetupReadyBySeat = {
    jay: hasQuizSetupReadySeat(game, 'jay'),
    kim: hasQuizSetupReadySeat(game, 'kim'),
  };
  const nextReadyBySeat = {
    jay: hasNextReadySeat(currentRound, 'jay'),
    kim: hasNextReadySeat(currentRound, 'kim'),
  };
  const showActiveRoundFrame = Boolean(currentRound && (isQuizGame || currentRound.status === 'open' || revealIsReady));
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
  const quizWagerAgreement = normalizeQuizWagerAgreement(game);
  const sharedQuizWagerLocked = isQuizWagerAgreementLocked(game);
  const sharedQuizWagerAmount = getQuizSharedWagerAmount(game);
  const showQuizSetupPanel = isQuizGame && !currentRound && !gameEnded;
  const roomWheelPending = quizWagerAgreement.status === 'wheel_pending';
  const roomWheelRequestedByViewer = Boolean(
    roomWheelPending
    && (
      (user?.uid && quizWagerAgreement.wheelRequestedByUserId && quizWagerAgreement.wheelRequestedByUserId === user.uid)
      || (!quizWagerAgreement.wheelRequestedByUserId && quizWagerAgreement.wheelRequestedBySeat === resolvedViewerSeat)
    ),
  );
  const roomWheelRequestedByOther = showQuizSetupPanel && roomWheelPending && !roomWheelRequestedByViewer;
  const roomWheelRequesterName = quizWagerAgreement.wheelRequestedByName
    || gameSeatDisplayName(game, quizWagerAgreement.wheelRequestedBySeat || oppositeSeatOf(resolvedViewerSeat), null)
    || 'The other player';
  const roomWheelPhase = getQuizWheelPhase(quizWagerAgreement);
  const roomWheelActive = roomWheelPhase === 'countdown' || roomWheelPhase === 'spinning' || roomWheelPhase === 'landing';
  const quizWagerStatusLabel = sharedQuizWagerLocked
    ? `Shared ${formatScore(sharedQuizWagerAmount || 0)}`
    : quizWagerAgreement.status === 'proposal_pending'
      ? `Proposal ${formatScore(quizWagerAgreement.proposedAmount || 0)}`
      : quizWagerAgreement.status === 'wheel_pending' || quizWagerAgreement.status === 'wheel_countdown'
        ? 'Wheel pending'
        : 'Negotiating';
  const roomWheelRequestModal = roomWheelRequestedByOther ? (
    <div className="quiz-wheel-request-modal-backdrop" role="presentation">
      <section className="quiz-wheel-request-modal" role="dialog" aria-modal="true" aria-labelledby="quiz-wheel-request-title">
        <h3 id="quiz-wheel-request-title">{roomWheelRequesterName} has clicked Spin the Wheel</h3>
        <p>Do you want to spin the wheel, or reject and go back to the negotiation screen?</p>
        <div className="button-row live-round-actions quiz-wheel-request-modal__actions">
          <Button className="primary-button compact" onClick={onAcceptQuizWager} disabled={isBusy || sharedQuizWagerLocked || roomWheelActive}>
            Spin the Wheel
          </Button>
          <Button className="ghost-button compact quiz-wager-reject-button" onClick={onRejectQuizWager} disabled={isBusy || sharedQuizWagerLocked || roomWheelActive}>
            Reject and go back to negotiation screen
          </Button>
        </div>
      </section>
    </div>
  ) : null;
  const roomPlayerScorePills = (
    <div className="room-player-score-pills" aria-label="Player penalty point balances">
      {seats.map((playerSeat) => (
        <span className={`status-pill room-player-score-pill room-player-score-pill--${playerSeat}`} key={`room-score-${playerSeat}`}>
          <SeatFlag seat={playerSeat} className="dashboard-balance-flag" />
          <span className="room-player-score-pill__name">{gameSeatDisplayName(game, playerSeat, currentRound)}</span>
          <strong>{formatScore(Number(playerAccounts?.[playerSeat]?.lifetimePenaltyPoints || 0))}</strong>
        </span>
      ))}
    </div>
  );
  const roomMenuRef = useRef(null);
  const scoreboardColumnRef = useRef(null);
  const [chatColumnHeight, setChatColumnHeight] = useState(0);
  const [quizSidebarOpen, setQuizSidebarOpen] = useState(false);
  const [noteModalRound, setNoteModalRound] = useState(null);
  const [questionNoteDraft, setQuestionNoteDraft] = useState('');
  const currentFeedbackValue = useMemo(() => {
    const qKey = normalizeText(currentRound?.questionId || '') || sanitizeNoteKey(currentRound?.question || '');
    if (!qKey || !user?.uid || !game?.id) return '';
    const feedbackId = `${game.id}-${qKey}-${user.uid}`;
    const entry = (questionFeedback || []).find((row) => row.id === feedbackId || row.feedbackId === feedbackId);
    return entry?.feedbackValue === 'liked' ? 'liked' : entry?.feedbackValue === 'disliked' ? 'disliked' : '';
  }, [currentRound?.questionId, currentRound?.question, user?.uid, game?.id, questionFeedback]);
  const currentReplayRequested = useMemo(() => {
    const qKey = normalizeText(currentRound?.questionId || '') || sanitizeNoteKey(currentRound?.question || '');
    if (!qKey || !user?.uid) return false;
    const replayId = `${qKey}-${user.uid}`;
    const entry = (questionReplays || []).find((row) => row.id === replayId || row.replayId === replayId);
    return Boolean(entry?.replayRequested);
  }, [currentRound?.questionId, currentRound?.question, user?.uid, questionReplays]);
  useEffect(() => {
    if (isMobile) {
      setChatColumnHeight(0);
      return undefined;
    }

    const scoreboardNode = scoreboardColumnRef.current;
    if (!scoreboardNode) return undefined;

    const rafRef = { current: null };

    const syncChatHeightNow = () => {
      const nextHeight = Math.round(scoreboardNode.getBoundingClientRect().height);
      setChatColumnHeight((currentHeight) => (Math.abs(currentHeight - nextHeight) <= 4 ? currentHeight : nextHeight));
    };

    const syncChatHeight = () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = window.requestAnimationFrame(syncChatHeightNow);
    };

    syncChatHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(syncChatHeight);
      observer.observe(scoreboardNode);
      return () => {
        observer.disconnect();
        if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      };
    }

    window.addEventListener('resize', syncChatHeight);
    return () => {
      window.removeEventListener('resize', syncChatHeight);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
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
          <Button className="ghost-button compact" onClick={onReconnectLiveRoom} disabled={isBusy}>
            Reconnect
          </Button>
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
    setNoteModalRound({
      questionId: round.questionId || '',
      question: round.question || '',
      category: round.category || '',
      roundType: round.roundType || '',
      number: round.number || 0,
    });
    setQuestionNoteDraft('');
  };

  const closeQuestionNoteModal = () => {
    setNoteModalRound(null);
    setQuestionNoteDraft('');
  };

  const questionNoteModalNode = noteModalRound ? (
    <section className="modal-backdrop" role="presentation" onClick={closeQuestionNoteModal}>
      <div className="panel modal-panel forfeit-modal" role="dialog" aria-modal="true" aria-label="Private question note" onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading compact-heading">
          <div>
            <p className="eyebrow">Private Note</p>
            <h3>Flagged Question Notebook</h3>
          </div>
          <Button className="ghost-button compact modal-close-button" onClick={closeQuestionNoteModal} disabled={isBusy} aria-label="Close private question note">
            Close
          </Button>
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
  ) : null;

  const goToDashboardTab = (tab = 'gameLobby') => {
    try {
      safeLocalStorageSet('kjk-dashboard-tab', tab);
    } catch {
      // Ignore storage failures.
    }
    onLeaveGame();
  };

  const renderMobileHostControls = () => {
    if (role !== 'host') return null;

    if (currentRound && revealIsReady && !isQuizGame) {
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
              <span className="quick-desk-status quick-desk-status--inline">{`Play as ${viewerLabel}`}</span>
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
              <span className="quick-desk-status quick-desk-status--inline">{`Play as ${viewerLabel}`}</span>
              <p className="panel-copy">
                {isQuizGame
                  ? 'Quiz questions appear automatically once both players are ready.'
                  : 'Load the next question when you are ready.'}
              </p>
              <div className="button-row room-host-sidebar-actions">
            {!isQuizGame ? (
              <Button className="primary-button compact next-question-button" onClick={onNextQuestion} disabled={isBusy || status === 'completed'}>
                Next Question
              </Button>
            ) : null}
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
      <header className={`top-bar top-bar--room ${isQuizGame && showQuizSetupPanel ? 'top-bar--room-quiz-setup' : ''}`}>
        <div className="top-bar-left">
          {isQuizGame && showQuizSetupPanel ? (
            <div className="room-id-stack">
              <p className="eyebrow sponsor-tag">Game {game?.joinCode || '------'}</p>
              <div className="room-id-actions" aria-label="Room actions">
                {role === 'host' ? (
                  <Button className="ghost-button compact" onClick={onPauseToggle} disabled={isBusy || status === 'completed'}>
                    {status === 'paused' ? 'Resume' : 'Pause'}
                  </Button>
                ) : null}
                {!gameEnded ? (
                  <Button className="ghost-button compact room-end-game-button" onClick={onEndGame}>
                    End Game
                  </Button>
                ) : null}
                <Button className="ghost-button compact" onClick={onLeaveGame}>
                  Leave
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="brand-lockup brand-lockup--left">
                <p className="eyebrow sponsor-tag">Game {game?.joinCode || '------'}</p>
                <h1><span className="brand-mobile-mark">92.1 JKC Radio</span><span className="brand-full-text">KJK KIMJAYKINKS</span></h1>
              </div>
              <div className="room-players-pill">
                <span>{joinedPlayers.map((player) => player.displayName || 'Player').join(' + ') || 'Waiting for players'}</span>
              </div>
            </>
          )}
        </div>
        <div className="top-actions top-actions--room">
          {isQuizGame && showQuizSetupPanel ? (
            <>
              {showTestModeBanner ? <span className="status-pill status-pill--test-mode">TEST MODE</span> : null}
              {roomPlayerScorePills}
              {renderRoomOverflowMenu()}
            </>
          ) : (
            <>
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
            </>
          )}
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
                onClose={() => goToDashboardTab('gameLobby')}
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
	                  onSubmitAnswer={onSubmitAnswer}
	                  onMarkReady={onMarkReady}
	                  onRequestQuizOverride={onRequestQuizOverride}
	                  onRespondQuizOverride={onRespondQuizOverride}
                  submissionState={submissionState}
                  revealIsReady={revealIsReady}
                  penaltyDraft={penaltyDraft}
                  setPenaltyDraft={setPenaltyDraft}
                  onNextQuestion={onNextQuestion}
                  onPauseToggle={onPauseToggle}
                  onOpenQuestionNote={openQuestionNoteModal}
                  currentFeedbackValue={currentFeedbackValue}
                  onSetQuestionFeedback={(round, value) => onSaveQuestionFeedback?.({ round, feedbackValue: value })}
                  currentReplayRequested={currentReplayRequested}
                  onSetQuestionReplay={(round) => onSaveQuestionReplay?.({ round })}
                  chatMessages={chatMessages}
                  chatDraft={chatDraft}
                  onChatDraftChange={setChatDraft}
                  onSendChat={onSendChat}
                  chatSeat={seat}
                  chatDisplayName={profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player'}
	                  isBusy={isBusy}
	                />
	              ) : showQuizSetupPanel ? (
	                <QuizSetupStagePanel
                    game={game}
                    viewerSeat={resolvedViewerSeat}
                    currentUserId={user?.uid || ''}
                    playerAccounts={playerAccounts}
                    chatMessages={chatMessages}
                    chatDraft={chatDraft}
                    onChatDraftChange={setChatDraft}
                    onSendChat={onSendChat}
                    chatDisplayName={profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player'}
                    quizWagerDraft={quizWagerDraft}
                    setQuizWagerDraft={setQuizWagerDraft}
                    onSaveQuizWager={onSaveQuizWager}
                    onAcceptQuizWager={onAcceptQuizWager}
                    onRejectQuizWager={onRejectQuizWager}
                    onSetQuizWheelOptIn={onSetQuizWheelOptIn}
                    onMarkReady={onMarkReady}
                    isBusy={isBusy}
                  />
	              ) : (
                <MainScoreboard16x9 rounds={rounds} selectedQuestion={currentQuestion} form={boardForm} editingRound={null} liveTotals={liveTotals} joinedSeats={game?.seats || {}} />
              )}
            </section>

            {isQuizGame && !showQuizSetupPanel && !showActiveRoundFrame ? (
              <section className="panel room-status-panel room-status-panel--host-mobile">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Quick Fire</p>
                    <h2>Wager Points</h2>
                  </div>
                </div>
                <label className="field">
                  <span>Your wager</span>
                  <input type="number" inputMode="numeric" min="0" value={quizWagerDraft} onChange={(event) => setQuizWagerDraft(event.target.value)} placeholder="0" />
                </label>
                <div className="button-row room-host-sidebar-actions">
                  <Button className="ghost-button compact" onClick={onSaveQuizWager} disabled={isBusy}>
                    Propose Wager
                  </Button>
                  <span className="quick-desk-status">{quizWagerStatusLabel}</span>
                </div>
              </section>
            ) : null}

            {renderMobileHostControls()}

            {!isQuizGame ? (
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
            ) : null}

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
        {questionNoteModalNode}
        {roomWheelRequestModal}
        {notice ? <div className="toast">{notice}</div> : null}
      </main>
    );
  }

  return (
      <main className="app production-app" style={{ '--accent': activePalette.accent, '--accent-2': activePalette.accent2, '--accent-3': activePalette.accent3, '--accent-glow': activePalette.glow, '--accent-wash': activePalette.wash }}>
      <header className={`top-bar top-bar--room ${isQuizGame && showQuizSetupPanel ? 'top-bar--room-quiz-setup' : ''}`}>
        <div className="top-bar-left">
          {isQuizGame && showQuizSetupPanel ? (
            <div className="room-id-stack">
              <p className="eyebrow sponsor-tag">Game {game?.joinCode || '------'}</p>
              <div className="room-id-actions" aria-label="Room actions">
                {role === 'host' ? (
                  <Button className="ghost-button compact" onClick={onPauseToggle} disabled={isBusy || status === 'completed'}>
                    {status === 'paused' ? 'Resume' : 'Pause'}
                  </Button>
                ) : null}
                {!gameEnded ? (
                  <Button className="ghost-button compact room-end-game-button" onClick={onEndGame}>
                    End Game
                  </Button>
                ) : null}
                <Button className="ghost-button compact" onClick={onLeaveGame}>
                  Leave
                </Button>
              </div>
            </div>
          ) : (
            <p className="eyebrow sponsor-tag">Game {game?.joinCode || '------'}</p>
          )}
        </div>
        <div className="top-bar-center">
          <div className="brand-lockup brand-lockup--center">
            <h1><span className="brand-mobile-mark">92.1 JKC Radio</span><span className="brand-full-text">KJK KIMJAYKINKS</span></h1>
          </div>
        </div>
        <div className={`top-actions top-actions--room ${isQuizGame && showQuizSetupPanel ? 'top-actions--room-quiz' : ''}`}>
          {isQuizGame && showQuizSetupPanel ? (
            <>
              {showTestModeBanner ? <span className="status-pill status-pill--test-mode">TEST MODE</span> : null}
              {roomPlayerScorePills}
              {renderRoomOverflowMenu()}
            </>
          ) : (
            <>
              {isQuizGame && role === 'host' ? (
                <Button className="ghost-button compact" onClick={onPauseToggle} disabled={isBusy || status === 'completed'}>
                  {status === 'paused' ? 'Resume' : 'Pause'}
                </Button>
              ) : null}
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
            </>
          )}
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
              onClose={() => goToDashboardTab('gameLobby')}
              onBackToLobby={() => goToDashboardTab('gameLobby')}
              onViewOverallAnalytics={() => goToDashboardTab('analytics')}
            />
          </section>
        </section>
      ) : (
      <section className={`game-grid ${isQuizGame ? 'game-grid--quiz-focus' : ''}`}>
        {!(isQuizGame && showQuizSetupPanel) ? (
          <section className={`panel room-sidebar ${isQuizGame ? `room-sidebar--quiz-drawer ${quizSidebarOpen ? 'is-open' : 'is-collapsed'}` : ''}`}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Players</p>
                <h2>Joined</h2>
              </div>
            </div>
            <div className="joined-player-list">
              <article className={`mini-list-row joined-player-row ${submittedBySeat.jay ? 'is-submitted' : ''}`}>
                <div className="joined-player-row-main">
                  <strong>Jay</strong>
                  {currentRound || showQuizSetupPanel ? (
                    <span className={`submitted-status-pill ${(currentRound?.status === 'reveal' && isQuizGame ? nextReadyBySeat.jay : showQuizSetupPanel && isQuizGame ? quizSetupReadyBySeat.jay : submittedBySeat.jay) ? 'is-submitted' : ''}`}>
                      {showQuizSetupPanel && isQuizGame
                        ? (quizSetupReadyBySeat.jay ? 'Ready' : 'Wagering')
                        : currentRound?.status === 'reveal' && isQuizGame
                          ? (nextReadyBySeat.jay ? 'Next ready' : 'Reviewing')
                          : (submittedBySeat.jay ? 'Submitted' : 'Answering')}
                    </span>
                  ) : null}
                </div>
                <span>{game?.playerProfiles?.[game?.seats?.jay]?.displayName || 'Waiting'}</span>
              </article>
              <article className={`mini-list-row joined-player-row ${submittedBySeat.kim ? 'is-submitted' : ''}`}>
                <div className="joined-player-row-main">
                  <strong>Kim</strong>
                  {currentRound || showQuizSetupPanel ? (
                    <span className={`submitted-status-pill ${(currentRound?.status === 'reveal' && isQuizGame ? nextReadyBySeat.kim : showQuizSetupPanel && isQuizGame ? quizSetupReadyBySeat.kim : submittedBySeat.kim) ? 'is-submitted' : ''}`}>
                      {showQuizSetupPanel && isQuizGame
                        ? (quizSetupReadyBySeat.kim ? 'Ready' : 'Wagering')
                        : currentRound?.status === 'reveal' && isQuizGame
                          ? (nextReadyBySeat.kim ? 'Next ready' : 'Reviewing')
                          : (submittedBySeat.kim ? 'Submitted' : 'Answering')}
                    </span>
                  ) : null}
                </div>
                <span>{game?.playerProfiles?.[game?.seats?.kim]?.displayName || 'Waiting'}</span>
              </article>
            </div>
            {role === 'host' ? (
              isQuizGame ? null : currentRound && revealIsReady ? (
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
                  <span className="quick-desk-status quick-desk-status--inline">{`Play as ${viewerLabel}`}</span>
                  <p className="panel-copy">
                    Load the next question when you are ready.
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
        ) : null}

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
	              onSubmitAnswer={onSubmitAnswer}
	              onMarkReady={onMarkReady}
	              onRequestQuizOverride={onRequestQuizOverride}
	              onRespondQuizOverride={onRespondQuizOverride}
              submissionState={submissionState}
              revealIsReady={revealIsReady}
              penaltyDraft={penaltyDraft}
              setPenaltyDraft={setPenaltyDraft}
              onNextQuestion={onNextQuestion}
              onPauseToggle={onPauseToggle}
              onOpenQuestionNote={openQuestionNoteModal}
              currentFeedbackValue={currentFeedbackValue}
              onSetQuestionFeedback={(round, value) => onSaveQuestionFeedback?.({ round, feedbackValue: value })}
              currentReplayRequested={currentReplayRequested}
              onSetQuestionReplay={(round) => onSaveQuestionReplay?.({ round })}
              chatMessages={chatMessages}
              chatDraft={chatDraft}
              onChatDraftChange={setChatDraft}
              onSendChat={onSendChat}
              chatSeat={seat}
              chatDisplayName={profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player'}
	              isBusy={isBusy}
	            />
	          ) : showQuizSetupPanel ? (
            <QuizSetupStagePanel
              game={game}
              viewerSeat={resolvedViewerSeat}
              currentUserId={user?.uid || ''}
              playerAccounts={playerAccounts}
              chatMessages={chatMessages}
              chatDraft={chatDraft}
              onChatDraftChange={setChatDraft}
              onSendChat={onSendChat}
              chatDisplayName={profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player'}
              quizWagerDraft={quizWagerDraft}
              setQuizWagerDraft={setQuizWagerDraft}
              onSaveQuizWager={onSaveQuizWager}
              onAcceptQuizWager={onAcceptQuizWager}
              onRejectQuizWager={onRejectQuizWager}
              onSetQuizWheelOptIn={onSetQuizWheelOptIn}
              onMarkReady={onMarkReady}
              isBusy={isBusy}
            />
	          ) : (
            <MainScoreboard16x9 rounds={rounds} selectedQuestion={currentQuestion} form={boardForm} editingRound={null} liveTotals={liveTotals} joinedSeats={game?.seats || {}} />
          )}
        </section>

        {!isQuizGame ? (
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
        ) : null}
      </section>
      )}
      {questionNoteModalNode}
      {roomWheelRequestModal}
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
  const [connectionState, setConnectionState] = useState(() => ({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    lastGameSnapshotAt: 0,
    lastError: '',
  }));
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
  const [isLobbyChatSending, setIsLobbyChatSending] = useState(false);
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
  const [questionFeedback, setQuestionFeedback] = useState([]);
  const [questionReplays, setQuestionReplays] = useState([]);
  const [quizAnswers, setQuizAnswers] = useState([]);
  const [quizWagerDraft, setQuizWagerDraft] = useState('');
  const [listenerRefreshKey, setListenerRefreshKey] = useState(0);
  const [penaltyDraft, setPenaltyDraft] = useState(defaultPenaltyDraft);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState(defaultChatDraft);
  const [lobbyChatMessages, setLobbyChatMessages] = useState([]);
  const [lobbyChatDraft, setLobbyChatDraft] = useState(defaultChatDraft);
  const [lobbyGameName, setLobbyGameName] = useState('');
  const isMobileDashboard = useMediaQuery('(max-width: 900px)');
  const leavePendingGameRef = useRef('');
  const autoSheetImportAttemptedRef = useRef(false);
  const roomLoadTimeoutRef = useRef(null);
  const amaStoreSeededRef = useRef({ jay: false, kim: false });
  const autoResumedGameIdRef = useRef(gameId || '');
  const lastAuthUserIdRef = useRef(firebaseAuth?.currentUser?.uid || '');
  const staleCompletedRestoreRef = useRef(new Set());
  const gameLibraryRoundsCacheRef = useRef(new Map());
  const isCurrentLocalTestGame = isLocalTestGame(game) || isLocalTestGameId(gameId);
  const hasOpenRoomSession = Boolean(gameId || game?.id);
  const localTestGameForId = (targetGameId = '') => {
    if (!targetGameId) return null;
    if (game?.id === targetGameId && isLocalTestGame(game)) return game;
    return localArchivedGames.find((entry) => entry?.id === targetGameId && isLocalTestGame(entry)) || null;
  };
  const isLocalTestGameTarget = (targetGameId = '') =>
    Boolean(isLocalTestGameId(targetGameId) || localTestGameForId(targetGameId));

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
      if (editingModeEnabled) safeLocalStorageSet(editingModeKey, 'true');
      else window.localStorage.removeItem(editingModeKey);
    } catch {
      // Ignore storage failures.
    }
  }, [editingModeEnabled]);

  useEffect(() => {
    const update = () =>
      setConnectionState((current) => ({
        ...current,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      }));
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!firebaseAuth) {
      setAuthLoading(false);
      return undefined;
    }
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      debugRoom('authStateChanged', { uid: nextUser?.uid || '', email: nextUser?.email || '' });
      const previousAuthUserId = lastAuthUserIdRef.current;
      const nextAuthUserId = nextUser?.uid || '';
      lastAuthUserIdRef.current = nextAuthUserId;
      if (nextAuthUserId && nextAuthUserId !== previousAuthUserId) {
        setMobilePostAuthDashboardDefault();
      }
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
        void (async () => {
          const snap = await getDoc(doc(firestore, 'games', activeGameFromProfile)).catch(() => null);
          const joinable = snap?.exists?.() ? isJoinableGameSnapshot(snap.data()) : false;
          if (!joinable) {
            debugRoom('activeGameNotJoinable', { activeGameFromProfile });
            await setDoc(
              doc(firestore, 'users', user.uid),
              { uid: user.uid, activeGameId: '', updatedAt: serverTimestamp() },
              { merge: true },
            ).catch(() => null);
            clearPersistedActiveGame(activeGameFromProfile);
            if (activeGameFromProfile === gameId) {
              setGameId('');
              setGame(null);
              setRounds([]);
              setChatMessages([]);
              resetRoomLoadState();
            }
            setNotice('The saved active game was no longer available, so the app returned to the lobby.');
            return;
          }
          if (isMobileDashboard) {
            autoResumedGameIdRef.current = activeGameFromProfile;
            clearPersistedActiveGame(activeGameFromProfile);
            resetRoomLoadState();
            return;
          }
          autoResumedGameIdRef.current = activeGameFromProfile;
          setGameId(activeGameFromProfile);
          safeLocalStorageSet(activeGameKey, activeGameFromProfile);
        })();
        return;
      }
    }, (error) => {
      failRoomLoad(gameId, `Could not read your profile: ${error?.message || error}`, 'profile-listener');
    });
    return unsubscribe;
  }, [user, gameId, isMobileDashboard, firestore, listenerRefreshKey]);

  useEffect(() => {
    if (!user || !firestore) {
      setGameLibrary([]);
      return undefined;
    }
    if (hasOpenRoomSession) return undefined;
    const gamesRef = query(collection(firestore, 'games'), where('playerUids', 'array-contains', user.uid));
    let isListenerActive = true;
    const unsubscribe = onSnapshot(gamesRef, async (snapshot) => {
      const visibleGameIds = new Set(snapshot.docs.map((entry) => entry.id));
      [...gameLibraryRoundsCacheRef.current.keys()].forEach((cacheKey) => {
        const cachedGameId = cacheKey.split(':')[0] || '';
        if (!visibleGameIds.has(cachedGameId)) gameLibraryRoundsCacheRef.current.delete(cacheKey);
      });
      const summaries = await Promise.all(
        snapshot.docs.map(async (entry) => {
          const data = entry.data();
          const status = data.status || 'active';
          const shouldLoadRounds = COMPLETED_GAME_STATUSES.includes(status);
          let roundsData = [];
          if (shouldLoadRounds) {
            const cacheKey = [
              entry.id,
              Number(data.roundsPlayed || 0),
              getRecordTime(data.endedAt || data.updatedAt || data.createdAt || 0),
            ].join(':');
            const cachedRounds = gameLibraryRoundsCacheRef.current.get(cacheKey);
            if (cachedRounds) {
              roundsData = cachedRounds;
            } else {
              const roundsSnap = await getDocs(query(collection(doc(firestore, 'games', entry.id), 'rounds'), orderBy('number', 'asc')));
              roundsData = normalizeStoredRounds(roundsSnap.docs.map((roundEntry) => ({ id: roundEntry.id, ...roundEntry.data() })));
              gameLibraryRoundsCacheRef.current.set(cacheKey, roundsData);
            }
          }
          return buildGameLibraryEntry(entry.id, data, roundsData);
        }),
      );
      if (!snapshot.empty) {
        summaries.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      }
      if (!isListenerActive) return;
      setGameLibrary(summaries.filter(Boolean));
    }, (error) => {
      debugRoom('gameLibrarySnapshotError', { message: error?.message || String(error) });
    });
    return () => {
      isListenerActive = false;
      unsubscribe();
    };
  }, [user, firestore, hasOpenRoomSession]);

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
    if (!firestore || !user || hasOpenRoomSession) {
      setRedemptionItems([]);
      return undefined;
    }
    const itemsRef = query(collection(firestore, 'redemptionItems'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(itemsRef, (snapshot) => {
      setRedemptionItems(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('redemptionItemsSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore, hasOpenRoomSession]);

  useEffect(() => {
    if (!firestore || !user || hasOpenRoomSession) {
      setRedemptionHistory([]);
      return undefined;
    }
    const historyRef = query(collection(firestore, 'redemptionHistory'), orderBy('redeemedAt', 'desc'), limit(40));
    const unsubscribe = onSnapshot(historyRef, (snapshot) => {
      setRedemptionHistory(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('redemptionHistorySnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore, hasOpenRoomSession]);

  useEffect(() => {
    if (!firestore || !user || hasOpenRoomSession) {
      setForfeitPriceRequests([]);
      return undefined;
    }
    const requestRef = query(collection(firestore, 'forfeitPriceRequests'), orderBy('requestedAt', 'desc'), limit(80));
    const unsubscribe = onSnapshot(requestRef, (snapshot) => {
      setForfeitPriceRequests(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('forfeitRequestsSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore, hasOpenRoomSession]);

  useEffect(() => {
    if (!firestore || !user || hasOpenRoomSession) {
      setGameInvites([]);
      return undefined;
    }
    const inviteRef = query(collection(firestore, 'gameInvites'), orderBy('updatedAt', 'desc'), limit(80));
    const unsubscribe = onSnapshot(inviteRef, (snapshot) => {
      setGameInvites(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('gameInvitesSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore, hasOpenRoomSession]);

  useEffect(() => {
    if (!firestore || !user || hasOpenRoomSession) {
      setAmaRequests([]);
      return undefined;
    }
    const amaRef = query(collection(firestore, 'amaRequests'), orderBy('updatedAt', 'desc'), limit(120));
    const unsubscribe = onSnapshot(amaRef, (snapshot) => {
      setAmaRequests(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('amaRequestsSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore, hasOpenRoomSession]);

  useEffect(() => {
    if (!firestore || !user || hasOpenRoomSession) {
      setDiaryEntries([]);
      return undefined;
    }
    const diaryRef = query(collection(firestore, 'diaryEntries'), orderBy('updatedAt', 'desc'), limit(120));
    const unsubscribe = onSnapshot(diaryRef, (snapshot) => {
      setDiaryEntries(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    }, (error) => debugRoom('diaryEntriesSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore, hasOpenRoomSession]);

  useEffect(() => {
    if (!firestore || !user?.uid || hasOpenRoomSession) {
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
  }, [user?.uid, firestore, hasOpenRoomSession]);

  useEffect(() => {
    if (!firestore || !user) {
      setQuestionFeedback([]);
      return undefined;
    }
    const feedbackRef = query(collection(firestore, 'questionFeedback'), where('pairId', '==', buildPairKey()), limit(2000));
    const unsubscribe = onSnapshot(
      feedbackRef,
      (snapshot) => setQuestionFeedback(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))),
      (error) => debugRoom('questionFeedbackSnapshotError', { message: error?.message || String(error) }),
    );
    return unsubscribe;
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user) {
      setQuestionReplays([]);
      return undefined;
    }
    const replayRef = query(collection(firestore, 'questionReplays'), where('pairId', '==', buildPairKey()), limit(3000));
    const unsubscribe = onSnapshot(
      replayRef,
      (snapshot) => setQuestionReplays(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))),
      (error) => debugRoom('questionReplaysSnapshotError', { message: error?.message || String(error) }),
    );
    return unsubscribe;
  }, [user, firestore]);

  useEffect(() => {
    if (!firestore || !user || hasOpenRoomSession) {
      setQuizAnswers([]);
      return undefined;
    }
    const answersRef = query(collection(firestore, 'quizAnswers'), where('pairId', '==', buildPairKey()), limit(4000));
    const unsubscribe = onSnapshot(
      answersRef,
      (snapshot) => setQuizAnswers(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))),
      (error) => debugRoom('quizAnswersSnapshotError', { message: error?.message || String(error) }),
    );
    return unsubscribe;
  }, [user, firestore, hasOpenRoomSession]);

  useEffect(() => {
    if (!user || !firestore) return undefined;
    const bankRef = collection(firestore, 'questionBank');
    const unsubscribe = onSnapshot(query(bankRef, orderBy('question', 'asc')), async (snapshot) => {
      if (snapshot.empty) {
        if (!gameId && !game?.id) await seedBankIfNeeded();
        return;
      }
      setBankQuestions(snapshot.docs.map((entry) => normalizeStoredQuestion(entry.data(), entry.id)));
    }, (error) => debugRoom('bankSnapshotError', { message: error?.message || String(error) }));
    return unsubscribe;
  }, [user, firestore, gameId, game?.id]);

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
      const snapshotData = snapshot.exists() ? snapshot.data() || {} : null;
      debugRoom('gameSnapshot', {
        gameId,
        exists: snapshot.exists(),
        status: snapshotData?.status || 'missing',
        quizWagerAgreement: snapshotData?.quizWagerAgreement || null,
      });
      setConnectionState((current) => ({ ...current, lastGameSnapshotAt: Date.now(), lastError: '' }));
      setGame((current) => {
        if (snapshot.exists()) {
          resolveRoomLoad(snapshot.id, 'game snapshot');
          return mergeActiveRoundSnapshot(current, { id: snapshot.id, ...snapshot.data() });
        }
        if (current?.id === snapshot.id || current?.id === gameId) return current;
        return null;
      });
    }, (error) => {
      setConnectionState((current) => ({ ...current, lastError: error?.message || String(error) }));
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
  }, [gameId, listenerRefreshKey]);

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
    if (game?.id === gameId) {
      clearRoomLoadTimer();
      if (roomLoadState.status !== 'idle' || roomLoadState.gameId) resetRoomLoadState();
      return;
    }
    if (roomLoadState.status !== 'loading' || roomLoadState.gameId !== gameId) {
      armRoomLoadTimeout(gameId, game ? 'syncing room' : 'loading room');
    }
  }, [gameId, game?.id, roomLoadState.gameId, roomLoadState.status]);

  useEffect(() => {
    if (!game?.currentRound) {
      setPenaltyDraft(defaultPenaltyDraft);
      return;
    }
    setPenaltyDraft({
      jay: normalizePenaltyDraftValue(game.currentRound.penalties?.jay),
      kim: normalizePenaltyDraftValue(game.currentRound.penalties?.kim),
    });
  }, [
    game?.currentRound?.id,
    game?.currentRound?.penalties?.jay,
    game?.currentRound?.penalties?.kim,
  ]);

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
  const matchesCurrentPlayerIdentity = useCallback((value) => {
    const normalized = normalizeIdentity(value);
    if (!normalized) return false;
    return currentPlayerIdentityTokens.has(normalized) || (dashboardSeat ? seatFromPlayerRef(value) === dashboardSeat : false);
  }, [currentPlayerIdentityTokens, dashboardSeat]);
  const canManageStoreForPlayer = useCallback((playerRef) => {
    const ownerSeat = seatFromPlayerRef(playerRef);
    if (ownerSeat && dashboardSeat) return ownerSeat === dashboardSeat;
    return matchesCurrentPlayerIdentity(playerRef);
  }, [dashboardSeat, matchesCurrentPlayerIdentity]);
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
  const activeGames = useMemo(
    () => gameLibrary.filter((entry) => ['opening', 'active', 'paused'].includes(entry.status)),
    [gameLibrary],
  );
  const persistedPreviousGames = useMemo(
    () => gameLibrary.filter((entry) => entry.status === 'completed' || entry.status === 'ended'),
    [gameLibrary],
  );
  const previousGames = useMemo(() => {
    const mergedById = new Map();
    [...localArchivedGames, ...persistedPreviousGames].forEach((entry) => {
      if (entry?.id && !mergedById.has(entry.id)) mergedById.set(entry.id, entry);
    });
    return [...mergedById.values()].sort(
      (left, right) => getRecordTime(right?.endedAt || right?.createdAt || 0) - getRecordTime(left?.endedAt || left?.createdAt || 0),
    );
  }, [localArchivedGames, persistedPreviousGames]);
  const knownQuizSessionIds = useMemo(
    () =>
      new Set(
        gameLibrary
          .filter((entry) => (entry?.gameMode || 'standard') === 'quiz')
          .map((entry) => entry?.id)
          .filter(Boolean),
      ),
    [gameLibrary],
  );
  const visibleQuizAnswers = useMemo(
    () =>
      (quizAnswers || []).filter((entry) => {
        const quizSessionId = normalizeText(entry?.quizSessionId || entry?.gameId || '');
        return !quizSessionId || knownQuizSessionIds.has(quizSessionId);
      }),
    [quizAnswers, knownQuizSessionIds],
  );
  const completedGameAuditRef = useRef(new Set());
  const selectedGameSummary = gameLibrary.find((entry) => entry.id === selectedGameId) || null;
  const selectedLocalGameSummary = localArchivedGames.find((entry) => entry.id === selectedGameId) || null;
  const activeSummaryModal = selectedGameSummary || selectedLocalGameSummary || localEndedGameSummary;
  const lobbyRounds = useMemo(() => gameLibrary.flatMap((entry) => entry.rounds || []), [gameLibrary]);
  const gameBankQuestions = useMemo(
    () => bankQuestions.filter((question) => (question?.bankType || 'game') !== 'quiz'),
    [bankQuestions],
  );
  const quizBankQuestions = useMemo(
    () => bankQuestions.filter((question) => question?.bankType === 'quiz'),
    [bankQuestions],
  );
  const standardSelectableQuestions = useMemo(
    () => (gameBankQuestions.length ? gameBankQuestions : STARTER_QUESTIONS.map((question) => createQuestionTemplate(question))),
    [gameBankQuestions],
  );
  const lobbyCategoryOptions = useMemo(
    () => deriveCategories(gameBankQuestions, lobbyRounds, DEFAULT_CATEGORIES).map((category) => category.name).filter(Boolean),
    [gameBankQuestions, lobbyRounds],
  );
  const analytics = useMemo(() => calculateAnalytics(rounds), [rounds]);
  const redemptionPenaltyAdjustments = useMemo(
    () =>
      redemptionHistory
        .filter((entry) => ['redeemed', 'seen', 'completed'].includes(entry?.status || ''))
        .map((entry) => {
          const player = seatFromPlayerRef(entry.pointsDeductedFromPlayerId);
          const cost = Number(entry.itemCost ?? entry.cost ?? 0);
          if (!player || !Number.isFinite(cost) || cost <= 0) return null;
          return {
            id: entry.id || entry.redemptionId || '',
            type: 'redemption',
            player,
            amount: -cost,
            redeemedAt: entry.redeemedAt,
            completedAt: entry.completedAt,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          };
        })
        .filter(Boolean),
    [redemptionHistory],
  );
  const lobbyRoundAnalytics = useMemo(
    () => calculateAnalytics(lobbyRounds, { penaltyAdjustments: redemptionPenaltyAdjustments }),
    [lobbyRounds, redemptionPenaltyAdjustments],
  );
  const bankCount = gameBankQuestions.length;
  const quizBankCount = quizBankQuestions.length;
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
    () => new Set(standardSelectableQuestions.map((question) => question.id).filter(Boolean)),
    [standardSelectableQuestions],
  );
  const quizQuestionIds = useMemo(
    () => new Set(quizBankQuestions.map((question) => question.id).filter(Boolean)),
    [quizBankQuestions],
  );
  const pairPlayedQuestionIds = useMemo(
    () => mergeUniqueIds(pairHistory?.playedQuestionIds || []),
    [pairHistory?.playedQuestionIds],
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
        ).filter(Boolean),
      ),
    [trackedGameEntries],
  );
  const trackedUsedQuestionIds = useMemo(
    () => {
      const trackedIds = mergeUniqueIds(
        pairPlayedQuestionIds,
        ...trackedGameEntries.map((entry) => getPlayedQuestionIdsForGame(entry)),
        standardSelectableQuestions.filter((question) => question?.used).map((question) => question.id),
      );
      if (!bankQuestionIds.size) return new Set(trackedIds);
      return new Set(trackedIds.filter((questionId) => bankQuestionIds.has(questionId)));
    },
    [pairPlayedQuestionIds, trackedGameEntries, standardSelectableQuestions, bankQuestionIds],
  );
  const replayEligibleQuestionIds = useMemo(
    () =>
      new Set(
        (questionReplays || [])
          .filter((entry) => Boolean(entry?.replayRequested))
          .map((entry) => normalizeText(entry.questionId || sanitizeNoteKey(entry.questionText || '')))
          .filter(Boolean),
      ),
    [questionReplays],
  );
  const effectiveRetiredQuestionIds = useMemo(() => {
    const next = new Set(trackedUsedQuestionIds);
    replayEligibleQuestionIds.forEach((questionId) => next.delete(questionId));
    return next;
  }, [trackedUsedQuestionIds, replayEligibleQuestionIds]);
  const usedQuestionCount = effectiveRetiredQuestionIds.size;
  const remainingQuestionCount = Math.max(0, bankCount - usedQuestionCount);
  const trackedUsedQuizQuestionIds = useMemo(() => {
    const trackedIds = mergeUniqueIds(
      pairPlayedQuestionIds,
      ...trackedGameEntries.map((entry) => getPlayedQuestionIdsForGame(entry)),
      quizBankQuestions.filter((question) => question?.used).map((question) => question.id),
    );
    if (!quizQuestionIds.size) return new Set(trackedIds);
    return new Set(trackedIds.filter((questionId) => quizQuestionIds.has(questionId)));
  }, [pairPlayedQuestionIds, trackedGameEntries, quizBankQuestions, quizQuestionIds]);
  const usedQuizQuestionCount = trackedUsedQuizQuestionIds.size;
  const remainingQuizQuestionCount = Math.max(0, quizBankCount - usedQuizQuestionCount);
  const usedQuestionIds = useMemo(() => new Set(rounds.map((round) => round.questionId).filter(Boolean)), [rounds]);
  const availableQuestions = useMemo(() => {
    const bank = standardSelectableQuestions.filter(
      (question) =>
        !effectiveRetiredQuestionIds.has(question.id)
        && !usedQuestionIds.has(question.id)
        && !reservedQuestionIds.has(question.id),
    );
    return bank;
  }, [standardSelectableQuestions, effectiveRetiredQuestionIds, usedQuestionIds, reservedQuestionIds]);
  const lastQuestionId = currentRound?.questionId || rounds.at(-1)?.questionId || null;
  const globalUsedQuestionIds = useMemo(
    () => new Set(effectiveRetiredQuestionIds),
    [effectiveRetiredQuestionIds],
  );
  const unusedQuestionCount = Math.max(0, bankCount - globalUsedQuestionIds.size);
  const previousCompletedGames = useMemo(
    () => persistedPreviousGames.filter((entry) => entry.status === 'completed' || entry.status === 'ended'),
    [persistedPreviousGames],
  );
  useEffect(() => {
    if (hasOpenRoomSession) return;
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
  }, [hasOpenRoomSession, previousGames]);
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
    const requestedBankType = filters.bankType === 'quiz' ? 'quiz' : 'game';
    const allQuestions = bankSnapshot.empty
      ? STARTER_QUESTIONS.map((question) => createQuestionTemplate(question))
      : bankSnapshot.docs.map((entry) => normalizeStoredQuestion(entry.data(), entry.id));
    const questionBankPool = allQuestions.filter((question) => ((question?.bankType || 'game') === requestedBankType));
    const retiredQuestionIds = requestedBankType === 'quiz' ? trackedUsedQuizQuestionIds : effectiveRetiredQuestionIds;
    const unavailableQuestionIds = new Set(mergeUniqueIds([...retiredQuestionIds], [...reservedQuestionIds], [lastQuestionId]));
    const typeSet = new Set((filters.roundTypes || []).filter(Boolean));
    const categorySet = new Set((filters.categories || []).map((category) => normalizeText(category)).filter(Boolean));
    const eligible = dedupeQuestionsById(questionBankPool).filter((question) => {
      if (unavailableQuestionIds.has(question.id)) return false;
      if (typeSet.size && !typeSet.has(question.roundType)) return false;
      if (categorySet.size && !categorySet.has(normalizeText(question.category))) return false;
      return true;
    });
    const safeRequestedCount = Math.max(1, Number.parseInt(requestedCount, 10) || 10);
    const unusedEligible = eligible.filter((question) => !retiredQuestionIds.has(question.id));
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
      usedQuestionCount: retiredQuestionIds.size,
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
    const isQuizGame = (gameDoc?.gameMode || 'standard') === 'quiz';
    let nextFinalScores = gameDoc.totals || gameDoc.finalScores || { jay: 0, kim: 0 };
    let nextWinner = Number(nextFinalScores.jay || 0) === Number(nextFinalScores.kim || 0) ? 'tie' : Number(nextFinalScores.jay || 0) < Number(nextFinalScores.kim || 0) ? 'jay' : 'kim';
    let nextQuizTotals = gameDoc.quizTotals || { jay: 0, kim: 0 };
    let nextQuizWinner = Number(nextQuizTotals.jay || 0) === Number(nextQuizTotals.kim || 0) ? 'tie' : Number(nextQuizTotals.jay || 0) > Number(nextQuizTotals.kim || 0) ? 'jay' : 'kim';
    let appliedLifetimePoints = false;
    let nextJayLifetime = Number(playerAccounts?.jay?.lifetimePenaltyPoints || 0);
    let nextKimLifetime = Number(playerAccounts?.kim?.lifetimePenaltyPoints || 0);
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
    nextQuizTotals = gameDoc.quizTotals || nextQuizTotals;
    nextQuizWinner = Number(nextQuizTotals.jay || 0) === Number(nextQuizTotals.kim || 0) ? 'tie' : Number(nextQuizTotals.jay || 0) > Number(nextQuizTotals.kim || 0) ? 'jay' : 'kim';
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

    const quizWagers = gameDoc.quizWagers || { jay: 0, kim: 0 };
    const rawJayWager = Math.max(0, Number(quizWagers.jay || 0));
    const rawKimWager = Math.max(0, Number(quizWagers.kim || 0));
    const jayWager = isQuizGame ? Math.max(0, Math.floor(rawJayWager)) : rawJayWager;
    const kimWager = isQuizGame ? Math.max(0, Math.floor(rawKimWager)) : rawKimWager;
    const sharedQuizWager = isQuizGame ? Math.max(jayWager, kimWager) : 0;
    let wagerPenaltyShiftJay = 0;
    let wagerPenaltyShiftKim = 0;
    if (isQuizGame && nextQuizWinner !== 'tie') {
      if (nextQuizWinner === 'jay') {
        wagerPenaltyShiftJay = 0;
        wagerPenaltyShiftKim = sharedQuizWager;
      } else {
        wagerPenaltyShiftJay = sharedQuizWager;
        wagerPenaltyShiftKim = 0;
      }
    }

    const batch = writeBatch(firestore);
    if (archivedRoundRef && archivedRoundResult) {
      batch.set(archivedRoundRef, archivedRoundResult);
    }
    if (!gameDoc.lifetimePointsApplied) {
      nextJayLifetime = isQuizGame
        ? Math.max(0, Number(jayCurrent || 0) + wagerPenaltyShiftJay)
        : addScores(jayCurrent, Number(nextFinalScores.jay || 0));
      nextKimLifetime = isQuizGame
        ? Math.max(0, Number(kimCurrent || 0) + wagerPenaltyShiftKim)
        : addScores(kimCurrent, Number(nextFinalScores.kim || 0));
      batch.set(
        jayRef,
        {
          uid: fixedPlayerUids.jay,
          displayName: 'Jay',
          lifetimePenaltyPoints: nextJayLifetime,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      batch.set(
        kimRef,
        {
          uid: fixedPlayerUids.kim,
          displayName: 'Kim',
          lifetimePenaltyPoints: nextKimLifetime,
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
      totals: nextFinalScores,
      finalScores: nextFinalScores,
      winner: isQuizGame ? nextQuizWinner : nextWinner,
      quizTotals: nextQuizTotals,
      quizWinner: nextQuizWinner,
      wagerSettlement: isQuizGame
        ? {
            sharedWager: Math.max(jayWager, kimWager),
            jayWager,
            kimWager,
            jayShift: wagerPenaltyShiftJay,
            kimShift: wagerPenaltyShiftKim,
            settledAt: serverTimestamp(),
          }
        : {},
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

    if (appliedLifetimePoints) {
      setPlayerAccounts((current) => ({
        ...current,
        jay: {
          ...(current?.jay || {}),
          uid: fixedPlayerUids.jay,
          displayName: current?.jay?.displayName || 'Jay',
          lifetimePenaltyPoints: nextJayLifetime,
          updatedAt: new Date().toISOString(),
        },
        kim: {
          ...(current?.kim || {}),
          uid: fixedPlayerUids.kim,
          displayName: current?.kim?.displayName || 'Kim',
          lifetimePenaltyPoints: nextKimLifetime,
          updatedAt: new Date().toISOString(),
        },
      }));
    }

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
    const isLocalTestRoom = isLocalTestGameTarget(targetGameId);
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
    if (!targetGameId || game?.id !== targetGameId || !isLocalTestGame(game)) return null;

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
      safeLocalStorageSet('kjk-dashboard-tab', 'gameLobby');
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
      safeLocalStorageSet('kjk-dashboard-tab', 'activity');
      safeLocalStorageSet('kjk-activity-tab', 'previousGames');
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
      if (isLocalTestGameTarget(actionToConfirm.gameId)) {
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
            safeLocalStorageSet('kjk-dashboard-tab', 'activity');
            safeLocalStorageSet('kjk-activity-tab', 'previousGames');
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
        setGameLibrary((current) => current.filter((entry) => entry?.id !== actionToConfirm.gameId));
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
      return true;
    }, 'Could not reset lifetime balances.');

  const saveLifetimeBalancesAction = async ({ jay = 0, kim = 0 } = {}) =>
    withBusy(async () => {
      const jayBalance = Number(jay);
      const kimBalance = Number(kim);
      if (!Number.isFinite(jayBalance) || !Number.isFinite(kimBalance)) {
        throw new Error('Enter numeric balances for Jay and Kim.');
      }
      await Promise.all([
        setDoc(doc(firestore, 'users', fixedPlayerUids.jay), { lifetimePenaltyPoints: jayBalance, updatedAt: serverTimestamp() }, { merge: true }),
        setDoc(doc(firestore, 'users', fixedPlayerUids.kim), { lifetimePenaltyPoints: kimBalance, updatedAt: serverTimestamp() }, { merge: true }),
      ]);
      setNotice('Jay and Kim lifetime balances updated.');
      return true;
    }, 'Could not update lifetime balances.');

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
      const message = String(error?.message || fallback || '');
      const normalizedMessage = normalizeText(message);
      if (
        normalizedMessage.includes('quota exceeded')
        || normalizedMessage.includes('quotaexceeded')
        || (normalizedMessage.includes('storage') && normalizedMessage.includes('quota'))
      ) {
        console.warn('Suppressed storage quota warning from gameplay UI.', error);
        return null;
      }
      setNotice(message || fallback);
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

  const syncGoogleSheetQuestions = async ({
    sheetValue,
    existingQuestions,
    overwriteExisting = true,
    targetBankType = 'game',
  }) => {
    const reference = parseGoogleSheetReference(sheetValue);
    if (!reference) throw new Error('Enter a valid Google Sheet URL or ID.');
    const sheetName = targetBankType === 'quiz' ? 'Quiz' : 'Questions';
    const targets = [{
      gid: '',
      csvUrl: `https://docs.google.com/spreadsheets/d/${reference.id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`,
      sheetName,
    }];
    const nextExistingQuestions = [...existingQuestions].filter(
      (question) => ((question?.bankType || 'game') === (targetBankType === 'quiz' ? 'quiz' : 'game')),
    );
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
        sourceLabel: `${reference.id}:${target.sheetName || target.gid || 'Questions'}`,
      });
      const parsedResult = targetBankType === 'quiz'
        ? parseGoogleSheetQuizImport({
            rawText,
            existingQuestions: nextExistingQuestions.filter((question) => (question?.bankType || 'game') === 'quiz'),
            overwriteExisting,
            importedAt: new Date().toISOString(),
            sourceLabel: `${reference.id}:${target.sheetName || 'Quiz'}`,
          })
        : result;

      importedQuestions.push(...parsedResult.imports);
      updatedQuestions.push(...parsedResult.updates);
      importedTotal += parsedResult.summary.imported;
      updatedTotal += parsedResult.summary.updated;
      duplicatedTotal += parsedResult.summary.duplicates;
      invalidTotal += parsedResult.summary.invalid;
      skippedTotal += parsedResult.summary.skipped;
      nextExistingQuestions.push(...parsedResult.imports, ...parsedResult.updates);
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
    if (nextGameId) safeLocalStorageSet(activeGameKey, nextGameId);
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
    if (gameId || game?.id) return;
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
  }, [user, firestore, bankQuestions, sheetInput, gameId, game?.id]);

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
      if (isLocalTestGame(game) || isLocalTestGameId(game?.id)) {
        setNotice('Editing Mode: private question notes are local only and were not saved to Firebase.');
        return true;
      }
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

  const updatePrivateQuestionNote = async (noteId, noteText) =>
    withBusy(async () => {
      if (!firestore || !user?.uid) throw new Error('You must be signed in.');
      const cleanNoteId = normalizeText(noteId);
      const trimmedNote = normalizeText(noteText);
      if (!cleanNoteId) throw new Error('Missing note id.');
      if (!trimmedNote) throw new Error('Write a note before saving.');
      await setDoc(
        doc(firestore, 'users', user.uid, 'questionNotes', cleanNoteId),
        {
          noteText: trimmedNote,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setNotice('Private note updated.');
      return true;
    }, 'Could not update private note.');

  const deletePrivateQuestionNote = async (noteId) =>
    withBusy(async () => {
      if (!firestore || !user?.uid) throw new Error('You must be signed in.');
      const cleanNoteId = normalizeText(noteId);
      if (!cleanNoteId) throw new Error('Missing note id.');
      await deleteDoc(doc(firestore, 'users', user.uid, 'questionNotes', cleanNoteId));
      setNotice('Private note deleted.');
      return true;
    }, 'Could not delete private note.');

  const saveQuestionFeedback = async ({ round = null, feedbackValue = '' } = {}) => {
    if (!firestore || !user?.uid || !game?.id || !round) return;
    if (isLocalTestGame(game) || isLocalTestGameId(game?.id)) {
      setNotice('Editing Mode: question feedback is local only and was not saved to Firebase.');
      return;
    }
    const cleanFeedback = feedbackValue === 'liked' ? 'liked' : feedbackValue === 'disliked' ? 'disliked' : '';
    if (!cleanFeedback) return;
    const questionId = normalizeText(round?.questionId || '') || sanitizeNoteKey(round?.question || '');
    if (!questionId) return;
    const feedbackId = `${game.id}-${questionId}-${user.uid}`;
    const feedbackRef = doc(firestore, 'questionFeedback', feedbackId);
    await setDoc(
      feedbackRef,
      {
        feedbackId,
        pairId: buildPairKey(),
        userId: user.uid,
        userSeat: seatForUid(game, user.uid) || inferSeatFromUser(user, profile) || '',
        gameId: game.id,
        joinCode: game?.joinCode || game?.roomCode || game?.code || '',
        questionId: normalizeText(round?.questionId || ''),
        questionText: normalizeText(round?.question || ''),
        category: normalizeText(round?.category || ''),
        roundType: normalizeText(round?.roundType || ''),
        feedbackValue: cleanFeedback,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const saveQuestionReplayRequest = async ({ round = null } = {}) => {
    if (!firestore || !user?.uid || !game?.id || !round) return;
    if ((game?.gameMode || 'standard') !== 'standard' || (game?.questionBankType || 'game') !== 'game') return;
    if (isLocalTestGame(game) || isLocalTestGameId(game?.id)) {
      setNotice('Editing Mode: replay requests are local only and were not saved to Firebase.');
      return;
    }
    const questionId = normalizeText(round?.questionId || '') || sanitizeNoteKey(round?.question || '');
    if (!questionId) return;
    const replayId = `${questionId}-${user.uid}`;
    const replayRef = doc(firestore, 'questionReplays', replayId);
    await setDoc(
      replayRef,
      {
        replayId,
        pairId: buildPairKey(),
        userId: user.uid,
        userSeat: seatForUid(game, user.uid) || inferSeatFromUser(user, profile) || '',
        gameId: game.id,
        joinCode: game?.joinCode || game?.roomCode || game?.code || '',
        questionId: normalizeText(round?.questionId || ''),
        questionText: normalizeText(round?.question || ''),
        category: normalizeText(round?.category || ''),
        roundType: normalizeText(round?.roundType || ''),
        replayRequested: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setNotice('Question can appear again.');
  };

  const saveQuizWager = async () =>
    withBusy(async () => {
      if (!user?.uid || !game?.id) throw new Error('Open a quiz game first.');
      if ((game?.gameMode || 'standard') !== 'quiz') throw new Error('Wagers are for Quick Fire Quiz only.');
      const seat = seatForUid(game, user.uid) || inferSeatFromUser(user, profile) || '';
      if (!seat) throw new Error('Could not determine your player seat.');
      if (!game?.seats?.jay || !game?.seats?.kim) throw new Error('Both players must join before negotiating the quiz wager.');
      const accountWheelBaseAmount = getQuizWheelBaseAmount(playerAccounts);
      const wagerCapAmount = isCurrentLocalTestGame && accountWheelBaseAmount <= 0 ? 200 : accountWheelBaseAmount;
      const currentAgreement = normalizeQuizWagerAgreement(game);
      const shouldCounter = currentAgreement.status === 'proposal_pending' && currentAgreement.proposedBySeat && currentAgreement.proposedBySeat !== seat;
      const validationMessage = getQuizWagerValidationMessage(quizWagerDraft, wagerCapAmount, {
        requireDifferentFrom: shouldCounter ? currentAgreement.proposedAmount : null,
      });
      if (validationMessage) throw new Error(validationMessage);
      const wagerValue = Number(parseQuizWagerAmountInput(quizWagerDraft).amount || 0);
      const buildNextAgreement = (source = {}) => {
        const liveAgreement = normalizeQuizWagerAgreement({ quizWagerAgreement: source.quizWagerAgreement || game.quizWagerAgreement });
        if (isQuizWagerAgreementLocked(source)) throw new Error('The shared quiz wager is already agreed.');
        if (source.currentRound) throw new Error('The quiz has already started.');
        if (liveAgreement.status === 'wheel_pending' || liveAgreement.status === 'wheel_countdown') {
          throw new Error('Resolve the wheel request before proposing a manual wager.');
        }
        if (liveAgreement.status === 'proposal_pending') {
          if (liveAgreement.proposedBySeat === seat && !isCurrentLocalTestGame) {
            throw new Error('Waiting for the other player to respond to your proposal.');
          }
          if (liveAgreement.proposedBySeat !== seat) {
            const counterError = getQuizWagerValidationMessage(wagerValue, wagerCapAmount, {
              requireDifferentFrom: liveAgreement.proposedAmount,
            });
            if (counterError) throw new Error(counterError);
          }
        }
        return {
          ...defaultQuizWagerAgreement(),
          status: 'proposal_pending',
          requestKind: 'manual',
          amount: null,
          proposedAmount: wagerValue,
          proposedBySeat: seat,
          proposalStatus: liveAgreement.status === 'proposal_pending' && liveAgreement.proposedBySeat !== seat ? 'counter_pending' : 'pending',
          rejectedBySeat: '',
          acceptedBySeat: '',
          wheelRequestedBySeat: '',
          wheelOptIn: { jay: false, kim: false },
          wheelBaseAmount: 0,
          wheelSlots: [],
          wheelResultIndex: null,
          wheelCountdownStartedAt: '',
          wheelSpinStartedAt: '',
          wheelSpinEndsAt: '',
          lockedByWheel: false,
          proposedAt: new Date().toISOString(),
        };
      };
      if (isCurrentLocalTestGame) {
        const nextAgreement = buildNextAgreement(game);
        setGame((current) =>
          current
            ? {
                ...current,
                quizWagerAgreement: nextAgreement,
                quizReadyState: defaultQuizReadyState('opening'),
                updatedAt: new Date().toISOString(),
              }
            : current,
        );
        setNotice(shouldCounter ? `Counter proposal sent: ${formatScore(wagerValue)}.` : `Shared wager proposed: ${formatScore(wagerValue)}.`);
        return true;
      }
      if (!firestore) throw new Error('Firebase is not configured.');
      await runTransaction(firestore, async (transaction) => {
        const gameRef = doc(firestore, 'games', game.id);
        const snap = await transaction.get(gameRef);
        if (!snap.exists()) throw new Error('Room not found.');
        const nextAgreement = buildNextAgreement(snap.data() || {});
        transaction.update(gameRef, {
          quizWagerAgreement: nextAgreement,
          quizReadyState: defaultQuizReadyState('opening'),
          updatedAt: serverTimestamp(),
        });
      });
      setNotice(shouldCounter ? `Counter proposal sent: ${formatScore(wagerValue)}.` : `Shared wager proposed: ${formatScore(wagerValue)}.`);
    }, 'Could not save quiz wager.');

  const acceptQuizWager = async () =>
    withBusy(async () => {
      if (!user?.uid || !game?.id) throw new Error('Open a quiz game first.');
      if ((game?.gameMode || 'standard') !== 'quiz') throw new Error('Wagers are for Quick Fire Quiz only.');
      const seat = seatForUid(game, user.uid) || inferSeatFromUser(user, profile) || '';
      debugRoom('wheelAcceptClick', {
        gameId: game.id,
        userId: user.uid,
        seat,
        currentAgreement: game?.quizWagerAgreement || null,
      });
      if (!seat) throw new Error('Could not determine your player seat.');
      const buildAcceptedState = (source = {}) => {
        const agreement = normalizeQuizWagerAgreement({ quizWagerAgreement: source.quizWagerAgreement || game.quizWagerAgreement });
        if (source.currentRound) throw new Error('The quiz has already started.');
        if (agreement.status === 'proposal_pending') {
          if (!Number.isFinite(Number(agreement.proposedAmount))) throw new Error('No wager proposal is waiting for acceptance.');
          if (agreement.proposedBySeat === seat && !isCurrentLocalTestGame) throw new Error('The other player must accept your wager proposal.');
          const accountWheelBaseAmount = getQuizWheelBaseAmount(playerAccounts);
          const wagerCapAmount = isCurrentLocalTestGame && accountWheelBaseAmount <= 0 ? 200 : accountWheelBaseAmount;
          const wagerValue = capQuizWagerAmount(agreement.proposedAmount, wagerCapAmount);
          return {
            notice: `Shared quiz wager agreed: ${formatScore(wagerValue)}. Both players can ready up.`,
            patch: {
              quizWagers: { jay: wagerValue, kim: wagerValue },
              quizWagerAgreement: {
                ...agreement,
                status: 'agreed',
                requestKind: 'manual',
                amount: wagerValue,
                proposalStatus: 'accepted',
                acceptedBySeat: agreement.proposedBySeat === seat && isCurrentLocalTestGame ? oppositeSeatOf(seat) : seat,
                rejectedBySeat: '',
                wheelRequestedBySeat: '',
                wheelOptIn: { jay: false, kim: false },
                lockedByWheel: false,
                acceptedAt: new Date().toISOString(),
              },
              quizReadyState: defaultQuizReadyState('ready'),
            },
          };
        }
        if (agreement.status === 'wheel_pending') {
          if (!agreement.wheelRequestedBySeat) throw new Error('No wheel request is waiting for agreement.');
          if (agreement.wheelRequestedBySeat === seat && !isCurrentLocalTestGame) throw new Error('The other player must agree to spin the wheel.');
          const baseAmount = Math.max(1, Math.floor(Number(agreement.wheelBaseAmount || QUIZ_WHEEL_MAX_AMOUNT)) || QUIZ_WHEEL_MAX_AMOUNT);
          const slots = agreement.wheelSlots.length ? agreement.wheelSlots : shuffleQuizWheelSlots(buildQuizWheelSlots(baseAmount));
          const now = Date.now();
          const wheelResultIndex = Math.floor(Math.random() * Math.max(1, slots.length));
          const wheelResultAmount = capQuizWheelStake(baseAmount, slots[wheelResultIndex] || 0);
          return {
            notice: 'Wheel request accepted. Shared countdown started.',
            patch: {
              quizWagerAgreement: {
                ...defaultQuizWagerAgreement(),
                status: 'wheel_countdown',
                requestKind: 'wheel',
                amount: null,
                proposalStatus: 'accepted',
                acceptedBySeat: agreement.wheelRequestedBySeat === seat && isCurrentLocalTestGame ? oppositeSeatOf(seat) : seat,
                wheelRequestedBySeat: agreement.wheelRequestedBySeat,
                wheelRequestedByUserId: agreement.wheelRequestedByUserId || '',
                wheelRequestedByName: agreement.wheelRequestedByName || '',
                wheelOptIn: { jay: true, kim: true },
                wheelBaseAmount: baseAmount,
                wheelSlots: slots,
                wheelResultIndex,
                wheelResultAmount,
                wheelCountdownStartedAt: new Date(now).toISOString(),
                wheelSpinStartedAt: new Date(now + QUIZ_WHEEL_COUNTDOWN_MS).toISOString(),
                wheelSpinEndsAt: new Date(now + QUIZ_WHEEL_COUNTDOWN_MS + QUIZ_WHEEL_SPIN_MS).toISOString(),
                lockedByWheel: false,
              },
              quizReadyState: defaultQuizReadyState('opening'),
            },
          };
        }
        throw new Error('Nothing is waiting for agreement.');
      };
      if (isCurrentLocalTestGame) {
        const { patch, notice } = buildAcceptedState(game);
        setGame((current) =>
          current
            ? {
                ...current,
                ...patch,
                updatedAt: new Date().toISOString(),
              }
            : current,
        );
        setNotice(notice);
        return true;
      }
      if (!firestore) throw new Error('Firebase is not configured.');
      const previousAgreement = game?.quizWagerAgreement || defaultQuizWagerAgreement();
      const previousReadyState = game?.quizReadyState || defaultQuizReadyState('opening');
      const previousQuizWagers = game?.quizWagers || { jay: 0, kim: 0 };
      const { patch, notice } = buildAcceptedState(game);
      setGame((current) =>
        current
          ? {
              ...current,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      const gameRef = doc(firestore, 'games', game.id);
      try {
        debugRoom('wheelAcceptWrite', {
          gameId: game.id,
          userId: user.uid,
          seat,
          patch,
        });
        await updateDoc(gameRef, {
          ...patch,
          updatedAt: serverTimestamp(),
        });
        debugRoom('wheelAcceptWriteComplete', {
          gameId: game.id,
          userId: user.uid,
          seat,
        });
      } catch (error) {
        setGame((current) =>
          current
            ? {
                ...current,
                quizWagerAgreement: previousAgreement,
                quizReadyState: previousReadyState,
                quizWagers: previousQuizWagers,
                updatedAt: new Date().toISOString(),
              }
            : current,
        );
        throw error;
      }
      setNotice(notice);
    }, 'Could not accept quiz wager.');

  const rejectQuizWager = async () =>
    withBusy(async () => {
      if (!user?.uid || !game?.id) throw new Error('Open a quiz game first.');
      if ((game?.gameMode || 'standard') !== 'quiz') throw new Error('Wagers are for Quick Fire Quiz only.');
      const seat = seatForUid(game, user.uid) || inferSeatFromUser(user, profile) || '';
      debugRoom('wheelRejectClick', {
        gameId: game.id,
        userId: user.uid,
        seat,
        currentAgreement: game?.quizWagerAgreement || null,
      });
      if (!seat) throw new Error('Could not determine your player seat.');
      const buildRejectedState = (source = {}) => {
        const agreement = normalizeQuizWagerAgreement({ quizWagerAgreement: source.quizWagerAgreement || game.quizWagerAgreement });
        if (source.currentRound) throw new Error('The quiz has already started.');
        if (agreement.status === 'proposal_pending') {
          if (agreement.proposedBySeat === seat && !isCurrentLocalTestGame) throw new Error('The other player must reject your wager proposal.');
          return {
            notice: 'Quiz wager rejected. Make a counter proposal.',
            patch: {
              quizWagerAgreement: {
                ...defaultQuizWagerAgreement(),
                status: 'negotiating',
                rejectedBySeat: agreement.proposedBySeat === seat && isCurrentLocalTestGame ? oppositeSeatOf(seat) : seat,
                rejectedAt: new Date().toISOString(),
              },
              quizReadyState: defaultQuizReadyState('opening'),
            },
          };
        }
        if (agreement.status === 'wheel_pending') {
          if (agreement.wheelRequestedBySeat === seat && !isCurrentLocalTestGame) throw new Error('The other player must reject your wheel request.');
          return {
            notice: 'Wheel request rejected.',
            patch: {
              quizWagerAgreement: {
                ...defaultQuizWagerAgreement(),
                status: 'negotiating',
                rejectedBySeat: agreement.wheelRequestedBySeat === seat && isCurrentLocalTestGame ? oppositeSeatOf(seat) : seat,
                rejectedAt: new Date().toISOString(),
              },
              quizReadyState: defaultQuizReadyState('opening'),
            },
          };
        }
        throw new Error('Nothing is waiting for a response.');
      };
      if (isCurrentLocalTestGame) {
        const { patch, notice } = buildRejectedState(game);
        setGame((current) =>
          current
            ? {
                ...current,
                ...patch,
                updatedAt: new Date().toISOString(),
              }
            : current,
        );
        setNotice(notice);
        return true;
      }
      if (!firestore) throw new Error('Firebase is not configured.');
      const previousAgreement = game?.quizWagerAgreement || defaultQuizWagerAgreement();
      const previousReadyState = game?.quizReadyState || defaultQuizReadyState('opening');
      const { patch, notice } = buildRejectedState(game);
      setGame((current) =>
        current
          ? {
              ...current,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      const gameRef = doc(firestore, 'games', game.id);
      try {
        debugRoom('wheelRejectWrite', {
          gameId: game.id,
          userId: user.uid,
          seat,
          patch,
        });
        await updateDoc(gameRef, {
          ...patch,
          updatedAt: serverTimestamp(),
        });
        debugRoom('wheelRejectWriteComplete', {
          gameId: game.id,
          userId: user.uid,
          seat,
        });
      } catch (error) {
        setGame((current) =>
          current
            ? {
                ...current,
                quizWagerAgreement: previousAgreement,
                quizReadyState: previousReadyState,
                updatedAt: new Date().toISOString(),
              }
            : current,
        );
        throw error;
      }
      setNotice(notice);
    }, 'Could not reject quiz wager.');

  const setQuizWheelOptIn = async (optIn = true) =>
    withBusy(async () => {
      if (!user?.uid || !game?.id) throw new Error('Open a quiz game first.');
      if ((game?.gameMode || 'standard') !== 'quiz') throw new Error('The wager wheel is for Quick Fire Quiz only.');
      const seat = seatForUid(game, user.uid) || inferSeatFromUser(user, profile) || '';
      debugRoom('wheelRequestClick', {
        gameId: game.id,
        optIn,
        userId: user.uid,
        seat,
        viewerGameMode: game?.gameMode || 'standard',
        currentAgreement: game?.quizWagerAgreement || null,
      });
      if (!seat) throw new Error('Could not determine your player seat.');
      if (!game?.seats?.jay || !game?.seats?.kim) throw new Error('Both players must join before using the wager wheel.');
      const baseAmount = QUIZ_WHEEL_MAX_AMOUNT;
      const previousAgreement = game?.quizWagerAgreement || defaultQuizWagerAgreement();
      const previousReadyState = game?.quizReadyState || defaultQuizReadyState('opening');
      const buildAgreement = (source = {}) => {
        const currentAgreement = normalizeQuizWagerAgreement({ quizWagerAgreement: source.quizWagerAgreement || game.quizWagerAgreement });
        if (isQuizWagerAgreementLocked(source)) throw new Error('The shared quiz wager is already agreed.');
        if (source.currentRound) throw new Error('The quiz has already started.');
        if (!optIn) return defaultQuizWagerAgreement();
        if (currentAgreement.status === 'proposal_pending') throw new Error('Resolve the manual proposal before requesting the wheel.');
        if (currentAgreement.status === 'wheel_pending') {
          if (currentAgreement.wheelRequestedBySeat === seat && !isCurrentLocalTestGame) {
            throw new Error('Waiting for the other player to respond to your wheel request.');
          }
          throw new Error('A wheel request is already pending.');
        }
        if (currentAgreement.status === 'wheel_countdown') throw new Error('The wheel countdown has already started.');
        const slots = currentAgreement.wheelSlots.length && Number(currentAgreement.wheelBaseAmount || 0) === baseAmount
          ? currentAgreement.wheelSlots
          : shuffleQuizWheelSlots(buildQuizWheelSlots(baseAmount));
        return {
          ...defaultQuizWagerAgreement(),
          status: 'wheel_pending',
          requestKind: 'wheel',
          proposalStatus: 'pending',
          wheelRequestedBySeat: seat,
          wheelRequestedByUserId: user.uid,
          wheelRequestedByName: gameSeatDisplayName(game, seat, null) || profile?.displayName || user?.displayName || 'Player',
          wheelOptIn: { jay: seat === 'jay', kim: seat === 'kim' },
          wheelBaseAmount: baseAmount,
          wheelSlots: slots,
          lockedByWheel: false,
          proposedAt: new Date().toISOString(),
        };
      };
      const nextAgreement = buildAgreement(game);
      if (isCurrentLocalTestGame) {
        setGame((current) =>
          current
            ? {
                ...current,
                quizWagerAgreement: nextAgreement,
                quizReadyState: defaultQuizReadyState('opening'),
                updatedAt: new Date().toISOString(),
              }
            : current,
        );
        setNotice('Wheel request sent.');
        return true;
      }
      if (!firestore) throw new Error('Firebase is not configured.');
      setGame((current) =>
        current
          ? {
              ...current,
              quizWagerAgreement: nextAgreement,
              quizReadyState: defaultQuizReadyState('opening'),
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      const gameRef = doc(firestore, 'games', game.id);
      try {
        debugRoom('wheelRequestWrite', {
          gameId: game.id,
          userId: user.uid,
          seat,
          nextAgreement,
        });
        await updateDoc(gameRef, {
          quizWagerAgreement: nextAgreement,
          quizReadyState: defaultQuizReadyState('opening'),
          updatedAt: serverTimestamp(),
        });
        debugRoom('wheelRequestWriteComplete', {
          gameId: game.id,
          userId: user.uid,
          seat,
        });
      } catch (error) {
        setGame((current) =>
          current
            ? {
                ...current,
                quizWagerAgreement: previousAgreement,
                quizReadyState: previousReadyState,
                updatedAt: new Date().toISOString(),
              }
            : current,
        );
        throw error;
      }
      setNotice(optIn ? 'Wheel request sent.' : 'Wheel choice cleared.');
    }, 'Could not update wager wheel choice.');

  const finalizeQuizWheelWager = async () => {
    if (!game?.id || (game?.gameMode || 'standard') !== 'quiz') return;
    const agreement = normalizeQuizWagerAgreement(game);
    if (agreement.status !== 'wheel_countdown' || !Number.isFinite(Date.parse(agreement.wheelSpinEndsAt || ''))) return;
    if (Date.now() < Date.parse(agreement.wheelSpinEndsAt || '')) return;

    const fallbackBaseAmount = QUIZ_WHEEL_MAX_AMOUNT;
    const effectiveBaseAmount = Math.max(1, Math.floor(Number(agreement.wheelBaseAmount || fallbackBaseAmount || QUIZ_WHEEL_MAX_AMOUNT)) || QUIZ_WHEEL_MAX_AMOUNT);
    const slots = agreement.wheelSlots.length ? agreement.wheelSlots : buildQuizWheelSlots(effectiveBaseAmount);
    const resultIndex = Math.max(0, Math.min(Math.max(0, slots.length - 1), Number(agreement.wheelResultIndex ?? 0)));
    const storedResultAmount = Number(agreement.wheelResultAmount);
    const rawResultAmount = Number.isFinite(storedResultAmount) && storedResultAmount > 0
      ? storedResultAmount
      : Number(slots[resultIndex] || 0);
    const wagerValue = capQuizWheelStake(effectiveBaseAmount, rawResultAmount);
    if (!Number.isFinite(wagerValue) || wagerValue < 0) return;

    const nextAgreement = {
      ...agreement,
      status: 'wheel_locked',
      requestKind: 'wheel',
      amount: wagerValue,
      wheelBaseAmount: effectiveBaseAmount,
      wheelSlots: slots,
      wheelResultIndex: resultIndex,
      wheelResultAmount: wagerValue,
      proposalStatus: 'accepted',
      lockedByWheel: true,
      lockedAt: new Date().toISOString(),
    };
    if (isCurrentLocalTestGame) {
      setGame((current) =>
        current
          ? {
              ...current,
              quizWagers: { jay: wagerValue, kim: wagerValue },
              quizWagerAgreement: nextAgreement,
              quizReadyState: mergeQuizReadyStateSnapshot(current.quizReadyState || null, defaultQuizReadyState('ready')),
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      setNotice(`Wager wheel landed on ${formatScore(wagerValue)}. Both players can ready up.`);
      return;
    }
    if (!firestore) return;
    const gameRef = doc(firestore, 'games', game.id);
    const previousAgreement = game?.quizWagerAgreement || defaultQuizWagerAgreement();
    const previousReadyState = game?.quizReadyState || defaultQuizReadyState('opening');
    const previousQuizWagers = game?.quizWagers || { jay: 0, kim: 0 };
    setGame((current) =>
      current
        ? {
            ...current,
            quizWagers: { jay: wagerValue, kim: wagerValue },
            quizWagerAgreement: nextAgreement,
            quizReadyState: mergeQuizReadyStateSnapshot(current.quizReadyState || null, defaultQuizReadyState('ready')),
            updatedAt: new Date().toISOString(),
          }
        : current,
    );
    try {
      await runTransaction(firestore, async (transaction) => {
        const snap = await transaction.get(gameRef);
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const liveAgreement = normalizeQuizWagerAgreement(data);
        if (liveAgreement.status !== 'wheel_countdown') return;
        const liveBaseAmount = Math.max(1, Math.floor(Number(liveAgreement.wheelBaseAmount || fallbackBaseAmount || QUIZ_WHEEL_MAX_AMOUNT)) || QUIZ_WHEEL_MAX_AMOUNT);
        const liveSlots = liveAgreement.wheelSlots.length ? liveAgreement.wheelSlots : buildQuizWheelSlots(liveBaseAmount);
        const liveIndex = Math.max(0, Math.min(Math.max(0, liveSlots.length - 1), Number(liveAgreement.wheelResultIndex ?? resultIndex)));
        const liveStoredResultAmount = Number(liveAgreement.wheelResultAmount);
        const liveRawResultAmount = Number.isFinite(liveStoredResultAmount) && liveStoredResultAmount > 0
          ? liveStoredResultAmount
          : Number(liveSlots[liveIndex] || 0);
        const liveWagerValue = capQuizWheelStake(liveBaseAmount, liveRawResultAmount);
        const liveReadyState = mergeQuizReadyStateSnapshot(data.quizReadyState || null, defaultQuizReadyState('ready'));
        transaction.update(gameRef, {
          quizWagers: { jay: liveWagerValue, kim: liveWagerValue },
          quizWagerAgreement: {
            ...liveAgreement,
            status: 'wheel_locked',
            requestKind: 'wheel',
            amount: liveWagerValue,
            wheelBaseAmount: liveBaseAmount,
            wheelSlots: liveSlots,
            wheelResultIndex: liveIndex,
            wheelResultAmount: liveWagerValue,
            proposalStatus: 'accepted',
            lockedByWheel: true,
            lockedAt: new Date().toISOString(),
          },
          quizReadyState: liveReadyState,
          updatedAt: serverTimestamp(),
        });
      });
    } catch (error) {
      setGame((current) =>
        current
          ? {
              ...current,
              quizWagers: previousQuizWagers,
              quizWagerAgreement: previousAgreement,
              quizReadyState: previousReadyState,
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      throw error;
    }
    setNotice(`Wager wheel landed on ${formatScore(wagerValue)}. Both players can ready up.`);
  };

  const requestQuizOverride = async (requestedFinalResult = '') =>
    withBusy(async () => {
      if (!firestore || !user?.uid || !game?.id) throw new Error('Open a quiz game first.');
      if ((game?.gameMode || 'standard') !== 'quiz') throw new Error('Overrides are for Quick Fire Quiz only.');
      if (!game?.currentRound?.id) throw new Error('No active quiz round.');
      const seat = seatForUid(game, user.uid) || inferSeatFromUser(user, profile) || '';
      if (!seat) throw new Error('Could not determine your player seat.');
      const normalizedRequest = requestedFinalResult === 'incorrect' ? 'incorrect' : 'correct';
      const viewerAnswer = game.currentRound.answers?.[seat] || {};
      if (!normalizeText(viewerAnswer?.ownAnswer || '')) throw new Error('Submit an answer before requesting an override.');
      const originalFinal = normalizeText(viewerAnswer?.finalResult || viewerAnswer?.originalSystemResult || (viewerAnswer?.wasCorrect ? 'correct' : 'incorrect')) || 'incorrect';
      const gameRef = doc(firestore, 'games', game.id);
      await updateDoc(gameRef, {
        [`currentRound.overrideRequests.${seat}`]: {
          requesterSeat: seat,
          requesterUserId: user.uid,
          roundId: game.currentRound.id,
          requestedFinalResult: normalizedRequest,
          originalFinalResult: originalFinal,
          status: 'pending',
          requestedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        'currentRound.updatedAt': serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNotice('Override requested.');
    }, 'Could not request override.');

  const respondQuizOverride = async (requestSeat = '', decision = '') =>
    withBusy(async () => {
      if (!firestore || !user?.uid || !game?.id) throw new Error('Open a quiz game first.');
      if ((game?.gameMode || 'standard') !== 'quiz') throw new Error('Overrides are for Quick Fire Quiz only.');
      if (!game?.currentRound?.id) throw new Error('No active quiz round.');
      const responderSeat = seatForUid(game, user.uid) || inferSeatFromUser(user, profile) || '';
      if (!responderSeat) throw new Error('Could not determine your player seat.');
      const normalizedSeat = requestSeat === 'kim' ? 'kim' : requestSeat === 'jay' ? 'jay' : '';
      if (!normalizedSeat) throw new Error('Missing override request seat.');
      if (normalizedSeat === responderSeat) throw new Error('You cannot approve your own override.');
      const request = game.currentRound.overrideRequests?.[normalizedSeat] || null;
      if (!request || request.status !== 'pending') throw new Error('No pending override request.');
      if (request.roundId && request.roundId !== game.currentRound.id) throw new Error('That override request belongs to a previous round.');
      const requestedFinal = request.requestedFinalResult === 'incorrect' ? 'incorrect' : 'correct';
      const shouldApprove = decision === 'approved';
      const gameRef = doc(firestore, 'games', game.id);
      const answer = game.currentRound.answers?.[normalizedSeat] || {};
      const timerValue = Number(answer.timerValue || 0);
      const approvedCorrect = shouldApprove && requestedFinal === 'correct';
      const nextPointsAwarded = approvedCorrect ? pointsFromTimerSeconds(timerValue) : 0;
      const nextFinal = shouldApprove ? requestedFinal : (request.originalFinalResult === 'correct' ? 'correct' : 'incorrect');
      await updateDoc(gameRef, {
        [`currentRound.overrideRequests.${normalizedSeat}`]: {
          ...request,
          status: shouldApprove ? 'approved' : 'rejected',
          responderSeat,
          responderUserId: user.uid,
          decidedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        ...(shouldApprove
          ? {
              [`currentRound.answers.${normalizedSeat}.finalResult`]: nextFinal,
              [`currentRound.answers.${normalizedSeat}.wasCorrect`]: nextFinal === 'correct',
              [`currentRound.answers.${normalizedSeat}.pointsAwarded`]: nextPointsAwarded,
              [`currentRound.answers.${normalizedSeat}.overrideStatus`]: 'approved',
            }
          : {
              [`currentRound.answers.${normalizedSeat}.overrideStatus`]: 'rejected',
            }),
        'currentRound.updatedAt': serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const roundQuestionId = normalizeText(game.currentRound?.questionId || '') || sanitizeNoteKey(game.currentRound?.question || '');
      const requesterUserId = request.requesterUserId || answer.submittedBy || '';
      if (roundQuestionId && requesterUserId) {
        const quizAnswerId = `${game.id}-${roundQuestionId}-${requesterUserId}`;
        await updateDoc(doc(firestore, 'quizAnswers', quizAnswerId), {
          finalResult: nextFinal,
          wasCorrect: nextFinal === 'correct',
          pointsAwarded: nextPointsAwarded,
          overrideStatus: shouldApprove ? 'approved' : 'rejected',
          updatedAt: serverTimestamp(),
        }).catch(() => null);
      }
      setNotice(shouldApprove ? 'Override approved.' : 'Override rejected.');
    }, 'Could not respond to override.');

  const createGame = async (options = {}) =>
    withBusy(async () => {
      setLocalEndedGameSummary(null);
      if (!firestore || !user) throw new Error('Firebase is not configured.');
      const gameMode = options.gameMode === 'quiz' ? 'quiz' : 'standard';
      const trimmedGameName = normalizeText(lobbyGameName);
      const effectiveGameName = trimmedGameName || (gameMode === 'quiz' ? 'Quick Fire Quiz' : 'Jay vs Kim');
      console.debug('Create New Game clicked', {
        gameName: effectiveGameName || lobbyGameName,
        requestedQuestionCount: options.requestedQuestionCount ?? lobbyQuestionCount,
        createCode: lobbyCode,
        mode: options.mode || 'random',
        gameMode,
        roundTypes: options.roundTypes || [],
        categories: options.categories || [],
      });
      const requestedQuestionCount = Number.parseInt(String(options.requestedQuestionCount ?? lobbyQuestionCount), 10);
      if (!Number.isFinite(requestedQuestionCount) || requestedQuestionCount <= 0) {
        throw new Error('Enter a valid number of questions.');
      }
      const previousGame = game;
      const previousGameId = gameId;
      const previousRounds = rounds;
      const previousChatMessages = chatMessages;
      const selectionMode = options.mode === 'custom' ? 'custom' : 'random';
      const targetBankType = gameMode === 'quiz' ? 'quiz' : 'game';
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
          bankType: targetBankType,
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
        const localGameId = `${TEST_GAME_PREFIX}${makeId('local')}`;
        const localJoinCode = `TEST${makeJoinCode().slice(0, 2)}`;
        const hostName = profile?.displayName || user.displayName || user.email?.split('@')[0] || PLAYER_LABEL[creatorSeat] || 'Player';
        const localOtherPlayerName = inviteTargetSeat === 'kim' ? TEST_MODE_PLAYER_NAME : 'Jay (Test)';
        const createdAt = new Date().toISOString();
	        const localGameState = {
          id: localGameId,
          joinCode: localJoinCode,
          code: localJoinCode,
          roomCode: localJoinCode,
          gameName: effectiveGameName || `Editing Mode ${localJoinCode}`,
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
	          quizTotals: { jay: 0, kim: 0 },
	          quizWagers: { jay: 0, kim: 0 },
          quizWagerAgreement: gameMode === 'quiz' ? defaultQuizWagerAgreement() : null,
          quizReadyState: gameMode === 'quiz' ? defaultQuizReadyState('opening') : null,
	          currentRound: null,
          pairId: buildPairKey(),
          gameMode,
          questionBankType: targetBankType,
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
        gameName: effectiveGameName || `Jay vs Kim ${joinCode}`,
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
        quizTotals: { jay: 0, kim: 0 },
        quizWagers: { jay: 0, kim: 0 },
        quizWagerAgreement: gameMode === 'quiz' ? defaultQuizWagerAgreement() : null,
        quizReadyState: gameMode === 'quiz' ? defaultQuizReadyState('opening') : null,
        currentRound: null,
        pairId: buildPairKey(),
        gameMode,
        questionBankType: targetBankType,
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
        safeLocalStorageSet(activeGameKey, gameRef.id);
        setNotice(`Opening ${effectiveGameName || 'new game'}…`);

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
            bankType: targetBankType,
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
          safeLocalStorageSet(activeGameKey, gameRef.id);
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
          if (previousGameId) safeLocalStorageSet(activeGameKey, previousGameId);
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
      setGameId(targetGameId);
      safeLocalStorageSet(activeGameKey, targetGameId);
      setGame(null);
      setRounds([]);
      setChatMessages([]);
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
      if (previousGameId) safeLocalStorageSet(activeGameKey, previousGameId);
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

  const resumeGame = async (nextGameId) =>
    withBusy(async () => {
      if (!nextGameId) return;
      const requestedEntry = gameLibrary.find((entry) => entry.id === nextGameId) || null;
      const requestedCode = gameRoomCodeForLookup(requestedEntry || {});
      const latestJoinableForCode = requestedCode
        ? [...gameLibrary]
            .filter((entry) => gameRoomCodeForLookup(entry) === requestedCode && isGameSessionJoinable(entry))
            .sort(sortByNewestGameSession)[0] || null
        : null;
      const targetGameId = latestJoinableForCode?.id || nextGameId;
      if (firestore) {
        const snap = await getDoc(doc(firestore, 'games', targetGameId)).catch(() => null);
        const joinable = snap?.exists?.() ? isJoinableGameSnapshot(snap.data()) : false;
        if (!joinable) {
          clearPersistedActiveGame(targetGameId);
          if (user) {
            await setDoc(doc(firestore, 'users', user.uid), { uid: user.uid, activeGameId: '', updatedAt: serverTimestamp() }, { merge: true }).catch(() => null);
          }
          throw new Error('That game is no longer available to resume.');
        }
      }
      setLocalEndedGameSummary(null);
      autoResumedGameIdRef.current = '';
      await joinGameSessionById(targetGameId);
    }, 'Could not resume game.');

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
    const patch = Object.fromEntries(
      Object.entries(nextRoundPatch || {}).map(([key, value]) => [`currentRound.${key}`, value]),
    );
    await updateDoc(gameRef, {
      ...patch,
      'currentRound.updatedAt': serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  useEffect(() => {
    if (!game?.currentRound || inferredRole !== 'host') return undefined;
    if ((game?.gameMode || 'standard') === 'quiz') return undefined;
    if (game.currentRound.status !== 'reveal') return undefined;
    const nextPenalties = {
      jay: normalizePenaltyDraftValue(penaltyDraft.jay),
      kim: normalizePenaltyDraftValue(penaltyDraft.kim),
    };
    const serverPenalties = {
      jay: normalizePenaltyDraftValue(game.currentRound.penalties?.jay),
      kim: normalizePenaltyDraftValue(game.currentRound.penalties?.kim),
    };
    if (nextPenalties.jay === serverPenalties.jay && nextPenalties.kim === serverPenalties.kim) return undefined;
    const timeout = window.setTimeout(() => {
      updateCurrentRound({
        penalties: nextPenalties,
      }).catch(() => null);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [
    penaltyDraft.jay,
    penaltyDraft.kim,
    game?.gameMode,
    game?.currentRound?.id,
    game?.currentRound?.status,
    game?.currentRound?.penalties?.jay,
    game?.currentRound?.penalties?.kim,
    inferredRole,
  ]);

  useEffect(() => {
    if (!game || !user?.uid) return;
    const seat = seatForUid(game, user.uid) || inferSeatFromUser(user, profile) || '';
    if (!seat) return;
    const agreement = normalizeQuizWagerAgreement(game);
    if (Number.isFinite(Number(agreement.proposedAmount))) {
      setQuizWagerDraft(String(agreement.proposedAmount || ''));
      return;
    }
    if (Number.isFinite(Number(agreement.amount))) {
      setQuizWagerDraft(String(agreement.amount || ''));
      return;
    }
    setQuizWagerDraft('');
  }, [
    game?.id,
    game?.quizWagerAgreement?.status,
    game?.quizWagerAgreement?.amount,
    game?.quizWagerAgreement?.proposedAmount,
    user?.uid,
    profile,
  ]);
  useEffect(() => {
    const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
    if (!game?.currentRound || isQuizGame || game.currentRound.status !== 'ready') return;
    if (isCurrentLocalTestGame) {
      setGame((current) =>
        current?.currentRound?.status === 'ready'
          ? {
              ...current,
              currentRound: {
                ...current.currentRound,
                status: 'open',
                ready: { jay: true, kim: true },
                updatedAt: new Date().toISOString(),
              },
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      return;
    }
    const gameRef = makeGameRef();
    if (!gameRef) return;
    updateDoc(gameRef, {
      'currentRound.status': 'open',
      'currentRound.ready': { jay: true, kim: true },
      'currentRound.updatedAt': serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => null);
  }, [game?.id, game?.gameMode, game?.currentRound?.status, isCurrentLocalTestGame]);
  const quizSetupLaunchRef = useRef('');
  const quizSetupCountdownRef = useRef('');
  const quizAdvanceRef = useRef('');
  const quizTimeoutRevealRef = useRef('');
  const quizWheelFinalizeRef = useRef('');
  const standardRevealSettleRef = useRef('');
  useEffect(() => {
    const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
    const agreement = normalizeQuizWagerAgreement(game || {});
    const spinEndsAtMs = Date.parse(agreement.wheelSpinEndsAt || '');
    const finalizeKey = `${game?.id || ''}:${agreement.wheelSpinEndsAt || ''}:${agreement.wheelResultIndex ?? ''}`;
    if (!isQuizGame || game?.currentRound || agreement.status === 'agreed' || agreement.status === 'wheel_locked' || !Number.isFinite(spinEndsAtMs)) {
      if (quizWheelFinalizeRef.current === finalizeKey) quizWheelFinalizeRef.current = '';
      return undefined;
    }
    const attemptFinalize = () => {
      if (Date.now() < spinEndsAtMs) return;
      if (quizWheelFinalizeRef.current === finalizeKey) return;
      quizWheelFinalizeRef.current = finalizeKey;
      finalizeQuizWheelWager()
        .catch(() => null)
        .finally(() => {
          quizWheelFinalizeRef.current = '';
        });
    };
    attemptFinalize();
    if (Date.now() >= spinEndsAtMs) return undefined;
    const interval = window.setInterval(attemptFinalize, 250);
    return () => window.clearInterval(interval);
  }, [
    game?.id,
    game?.gameMode,
    game?.currentRound?.id,
    game?.quizWagerAgreement?.status,
    game?.quizWagerAgreement?.wheelSpinEndsAt,
    game?.quizWagerAgreement?.wheelResultIndex,
    isCurrentLocalTestGame,
  ]);
  const buildRoundFromQuestion = (nextQuestionItem, nextRoundNumber, { isQuizGame = false, startOpen = false } = {}) => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    return {
      id: makeId('round'),
      number: nextRoundNumber,
      questionId: nextQuestionItem.id,
      question: nextQuestionItem.question,
      category: nextQuestionItem.category || '',
      roundType: nextQuestionItem.roundType || 'numeric',
      defaultAnswerType: nextQuestionItem.defaultAnswerType || getDefaultAnswerType(nextQuestionItem.roundType),
      multipleChoiceOptions: nextQuestionItem.multipleChoiceOptions || [],
      correctAnswer: nextQuestionItem.correctAnswer || '',
      normalizedCorrectAnswer: nextQuestionItem.normalizedCorrectAnswer || '',
      notes: nextQuestionItem.notes || '',
      tags: nextQuestionItem.tags || [],
      unitLabel: nextQuestionItem.unitLabel || '',
      status: startOpen ? 'open' : 'ready',
      ready: startOpen ? { jay: true, kim: true } : { jay: false, kim: false },
      nextReady: { jay: false, kim: false },
      answers: {},
      penalties: { jay: '', kim: '' },
      quizTimerSeconds: isQuizGame && startOpen ? QUIZ_TIMER_SECONDS : 0,
      quizTimerStartedAt: isQuizGame && startOpen ? nowIso : '',
      quizTimerEndsAt: isQuizGame && startOpen ? new Date(now + (QUIZ_TIMER_SECONDS * 1000)).toISOString() : '',
      createdAt: nowIso,
    };
  };

  const markReady = async (seatToReady = '') =>
    withBusy(async () => {
      const seat = seatToReady === 'kim' ? 'kim' : seatToReady === 'jay' ? 'jay' : currentSeat;
      if (!seat) return;
      const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
      const sharedQuizWagerLocked = isQuizWagerEffectivelyLocked(game);

      if (isQuizGame && !game?.currentRound) {
        if (!sharedQuizWagerLocked) throw new Error('Both players must agree one shared wager before starting Quick Fire.');
        if (isCurrentLocalTestGame) {
          setGame((current) => {
            if (!current || current.currentRound) return current;
            const currentReady = (current.quizReadyState && current.quizReadyState.ready) || { jay: false, kim: false };
            const nextReady = { ...currentReady, [seat]: true };
            const bothReady = Boolean(nextReady.jay && nextReady.kim);
            const nowIso = new Date().toISOString();
            return {
              ...current,
              quizReadyState: {
                ...(current.quizReadyState || defaultQuizReadyState('ready')),
                stage: bothReady ? 'countdown' : 'ready',
                ready: nextReady,
                countdownStartedAt: bothReady ? nowIso : (current.quizReadyState?.countdownStartedAt || ''),
                countdownEndsAt: bothReady ? new Date(Date.now() + QUIZ_SETUP_COUNTDOWN_MS).toISOString() : (current.quizReadyState?.countdownEndsAt || ''),
              },
              updatedAt: new Date().toISOString(),
            };
          });
          return true;
        }

        const gameRef = makeGameRef();
        if (!gameRef) return null;
        const previousReadyState = game?.quizReadyState || defaultQuizReadyState('ready');
        const previousUpdatedAt = game?.updatedAt || '';
        const optimisticNowIso = new Date().toISOString();
        const optimisticCurrentReady = previousReadyState.ready || { jay: false, kim: false };
        const optimisticNextReady = { ...optimisticCurrentReady, [seat]: true };
        setGame((current) =>
          current && !current.currentRound
            ? {
                ...current,
                quizReadyState: {
                  ...(current.quizReadyState || defaultQuizReadyState('ready')),
                  stage: getQuizReadyStageRank(current.quizReadyState?.stage || 'opening') > 0
                    ? (current.quizReadyState?.stage || 'ready')
                    : 'ready',
                  ready: {
                    ...((current.quizReadyState && current.quizReadyState.ready) || { jay: false, kim: false }),
                    [seat]: true,
                  },
                  countdownStartedAt: current.quizReadyState?.countdownStartedAt || '',
                  countdownEndsAt: current.quizReadyState?.countdownEndsAt || '',
                },
                updatedAt: optimisticNowIso,
              }
            : current,
        );
        try {
          await updateDoc(gameRef, {
            [`quizReadyState.ready.${seat}`]: true,
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          const normalizedMessage = normalizeText(error?.code || error?.message || '');
          if (
            normalizedMessage.includes('permission')
            || normalizedMessage.includes('notfound')
            || normalizedMessage.includes('not found')
          ) {
            setGame((current) =>
              current && !current.currentRound
                ? {
                    ...current,
                    quizReadyState: previousReadyState,
                    updatedAt: previousUpdatedAt,
                  }
                : current,
            );
          }
          throw error;
        }
        return true;
      }

      if (!game?.currentRound) throw new Error('No active round.');

      if (isQuizGame && game.currentRound.status === 'reveal') {
        if (isCurrentLocalTestGame) {
          const otherSeat = oppositeSeatOf(seat);
          setGame((current) => {
            if (!current?.currentRound || current.currentRound.status !== 'reveal') return current;
            return {
              ...current,
              currentRound: {
                ...current.currentRound,
                nextReady: {
                  ...(current.currentRound.nextReady || { jay: false, kim: false }),
                  [seat]: true,
                  [otherSeat]: true,
                },
                updatedAt: new Date().toISOString(),
              },
              updatedAt: new Date().toISOString(),
            };
          });
          return true;
        }
        const gameRef = makeGameRef();
        if (!gameRef) return null;
        await runTransaction(firestore, async (transaction) => {
          const snap = await transaction.get(gameRef);
          if (!snap.exists()) throw new Error('Room not found.');
          const data = snap.data() || {};
          const round = data.currentRound || null;
          if (!round || round.status !== 'reveal') return;
          transaction.update(gameRef, {
            [`currentRound.nextReady.${seat}`]: true,
            'currentRound.updatedAt': serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        return true;
      }

      if (game.currentRound.status !== 'ready') return;

      if (isCurrentLocalTestGame) {
        setGame((current) => {
          if (!current?.currentRound || current.currentRound.status !== 'ready') return current;
          const nextReady = { ...(current.currentRound.ready || {}), [seat]: true };
          const bothReady = Boolean(nextReady.jay && nextReady.kim);
          const nowIso = new Date().toISOString();
          return {
            ...current,
            currentRound: {
              ...current.currentRound,
              ready: nextReady,
              status: bothReady ? 'open' : 'ready',
              ...(bothReady && isQuizGame
                ? {
                    quizTimerSeconds: QUIZ_TIMER_SECONDS,
                    quizTimerStartedAt: nowIso,
                    quizTimerEndsAt: new Date(Date.now() + (QUIZ_TIMER_SECONDS * 1000)).toISOString(),
                  }
                : {}),
              updatedAt: nowIso,
            },
            updatedAt: nowIso,
          };
        });
        return true;
      }

      const gameRef = makeGameRef();
      if (!gameRef || !firestore) return null;
      await runTransaction(firestore, async (transaction) => {
        const snap = await transaction.get(gameRef);
        if (!snap.exists()) throw new Error('Room not found.');
        const data = snap.data() || {};
        const round = data.currentRound || null;
        if (!round || round.status !== 'ready') return;
        const ready = { ...(round.ready || {}), [seat]: true };
        const bothReady = Boolean(ready.jay && ready.kim);
        const patch = {
          [`currentRound.ready.${seat}`]: true,
          'currentRound.updatedAt': serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (bothReady) {
          patch['currentRound.status'] = 'open';
          if (isQuizGame) {
            patch['currentRound.quizTimerSeconds'] = QUIZ_TIMER_SECONDS;
            patch['currentRound.quizTimerStartedAt'] = new Date().toISOString();
            patch['currentRound.quizTimerEndsAt'] = new Date(Date.now() + (QUIZ_TIMER_SECONDS * 1000)).toISOString();
          }
        }
        transaction.update(gameRef, patch);
      });
      return true;
    }, 'Could not mark ready.');

  const submitAnswer = async (draftOverride = null) => {
    try {
      if (!game?.currentRound || !currentSeat) throw new Error('No active round to answer.');
      if (game.currentRound.status !== 'open') throw new Error('Both players must be ready before answering.');
      const currentAnswers = game.currentRound.answers || {};
      const draft = draftOverride || {
        ownAnswer: String(game.currentRound.answers?.[currentSeat]?.ownAnswer ?? ''),
        guessedOther: String(game.currentRound.answers?.[currentSeat]?.guessedOther ?? ''),
      };
      const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
      const submittedAtIso = new Date().toISOString();
      const quizEndsAtMs = Date.parse(game.currentRound?.quizTimerEndsAt || '');
      const nowMs = Date.now();
      const timerMsLeft = Number.isFinite(quizEndsAtMs)
        ? Math.max(0, quizEndsAtMs - nowMs)
        : QUIZ_TIMER_SECONDS * 1000;
      const timerSecondsLeft = Math.max(0, Math.ceil(timerMsLeft / 1000));
      const quizWasCorrect = isQuizGame ? evaluateQuizAnswer(game.currentRound, draft.ownAnswer.trim()) : false;
      const quizPointsAwarded = isQuizGame && quizWasCorrect ? pointsFromTimerMilliseconds(timerMsLeft) : 0;
      const baseAnswerPayload = {
        ownAnswer: draft.ownAnswer.trim(),
        guessedOther: isQuizGame ? '' : draft.guessedOther.trim(),
        submittedBy: user?.uid || '',
        displayName: profile?.displayName || user?.displayName || '',
        submittedAt: submittedAtIso,
        ...(isQuizGame
          ? {
              wasCorrect: quizWasCorrect,
              originalSystemResult: quizWasCorrect ? 'correct' : 'incorrect',
              finalResult: quizWasCorrect ? 'correct' : 'incorrect',
              answerTimeMs: Math.max(0, (QUIZ_TIMER_SECONDS * 1000) - timerMsLeft),
              timerValue: timerSecondsLeft,
              pointsAwarded: quizPointsAwarded,
              overrideStatus: 'none',
            }
          : {}),
      };
      if (isCurrentLocalTestGame) {
        const otherSeat = currentSeat === 'jay' ? 'kim' : 'jay';
        const choiceOptions = inferChoiceOptions(game.currentRound);
        const nextAnswers = {
          ...currentAnswers,
          [currentSeat]: baseAnswerPayload,
        };
        if (!nextAnswers[otherSeat]?.ownAnswer) {
          const autoOwnAnswer = game.currentRound.roundType === 'numeric' ? '0' : choiceOptions[0] || 'Test mode response';
          const autoQuizWasCorrect = isQuizGame ? evaluateQuizAnswer(game.currentRound, autoOwnAnswer) : false;
          const autoQuizPoints = isQuizGame && autoQuizWasCorrect ? pointsFromTimerMilliseconds(timerMsLeft) : 0;
          nextAnswers[otherSeat] = {
            ownAnswer: autoOwnAnswer,
            guessedOther: isQuizGame ? '' : draft.ownAnswer.trim() || draft.guessedOther.trim() || choiceOptions[1] || choiceOptions[0] || 'Test guess',
            submittedBy: 'editing-mode',
            displayName: otherSeat === 'kim' ? TEST_MODE_PLAYER_NAME : 'Jay (Test)',
            submittedAt: new Date().toISOString(),
            autoSubmitted: true,
            ...(isQuizGame
              ? {
                  wasCorrect: autoQuizWasCorrect,
                  originalSystemResult: autoQuizWasCorrect ? 'correct' : 'incorrect',
                  finalResult: autoQuizWasCorrect ? 'correct' : 'incorrect',
                  answerTimeMs: Math.max(0, (QUIZ_TIMER_SECONDS * 1000) - timerMsLeft),
                  timerValue: timerSecondsLeft,
                  pointsAwarded: autoQuizPoints,
                  overrideStatus: 'none',
                }
              : {}),
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
        return true;
      }
      const gameRef = makeGameRef();
      if (!gameRef || !firestore) throw new Error('Room is missing.');
      const existingLocalAnswer = currentAnswers?.[currentSeat] || {};
      const payload = {
        ...baseAnswerPayload,
        submittedBy: existingLocalAnswer.submittedBy || baseAnswerPayload.submittedBy,
        submittedAt: existingLocalAnswer.submittedAt || baseAnswerPayload.submittedAt,
        updatedAt: submittedAtIso,
      };
      const nextLocalAnswers = {
        ...currentAnswers,
        [currentSeat]: payload,
      };
      const bothAnsweredLocally = Boolean(normalizeText(nextLocalAnswers.jay?.ownAnswer) && normalizeText(nextLocalAnswers.kim?.ownAnswer));
      setGame((current) => {
        if (!current?.currentRound || current.currentRound.id !== game.currentRound.id) return current;
        const nextAnswers = {
          ...(current.currentRound.answers || {}),
          [currentSeat]: payload,
        };
        return {
          ...current,
          currentRound: {
            ...current.currentRound,
            answers: nextAnswers,
            status: nextAnswers.jay?.ownAnswer && nextAnswers.kim?.ownAnswer ? 'reveal' : 'open',
          },
        };
      });
      if (!isQuizGame) {
        await updateDoc(gameRef, {
          [`currentRound.answers.${currentSeat}`]: payload,
          ...(bothAnsweredLocally ? { 'currentRound.status': 'reveal' } : {}),
          'currentRound.updatedAt': serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return true;
      }
      await runTransaction(firestore, async (transaction) => {
        const snap = await transaction.get(gameRef);
        if (!snap.exists()) throw new Error('Room not found.');
        const data = snap.data() || {};
        const round = data.currentRound || null;
        if (!round) throw new Error('No active round to answer.');
        if (round.status !== 'open') throw new Error('This round is not open for answers.');
        const serverSeatAnswer = (round.answers || {})[currentSeat] || {};
        const existingSubmittedBy = serverSeatAnswer.submittedBy || '';
        const existingSubmittedAt = serverSeatAnswer.submittedAt || '';
        if (existingSubmittedBy && existingSubmittedBy !== user.uid) {
          throw new Error('This answer was submitted by another player.');
        }
        const payload = {
          ...baseAnswerPayload,
          submittedBy: existingSubmittedBy || baseAnswerPayload.submittedBy,
          submittedAt: existingSubmittedAt || baseAnswerPayload.submittedAt,
          updatedAt: submittedAtIso,
        };
        const serverAnswers = round.answers || {};
        const nextAnswers = { ...serverAnswers, [currentSeat]: payload };
        const bothAnswered = Boolean(normalizeText(nextAnswers.jay?.ownAnswer) && normalizeText(nextAnswers.kim?.ownAnswer));
        const patch = {
          [`currentRound.answers.${currentSeat}`]: payload,
          ...(bothAnswered ? { 'currentRound.status': 'reveal' } : {}),
          'currentRound.updatedAt': serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        transaction.update(gameRef, patch);
      });
      if (isQuizGame) {
        const roundQuestionId = normalizeText(game.currentRound?.questionId || '') || sanitizeNoteKey(game.currentRound?.question || '');
        const quizAnswerId = `${game.id}-${roundQuestionId}-${user.uid}`;
        await setDoc(
          doc(firestore, 'quizAnswers', quizAnswerId),
          {
            quizAnswerId,
            pairId: buildPairKey(),
            quizSessionId: game.id,
            gameId: game.id,
            questionId: normalizeText(game.currentRound?.questionId || ''),
            questionText: normalizeText(game.currentRound?.question || ''),
            category: normalizeText(game.currentRound?.category || ''),
            questionType: normalizeText(game.currentRound?.roundType || ''),
            correctAnswer: normalizeText(game.currentRound?.correctAnswer || ''),
            playerAnswer: draft.ownAnswer.trim(),
            playerId: user.uid,
            playerSeat: currentSeat,
            wasCorrect: quizWasCorrect,
            originalSystemResult: quizWasCorrect ? 'correct' : 'incorrect',
            finalResult: quizWasCorrect ? 'correct' : 'incorrect',
            answerTime: Math.max(0, (QUIZ_TIMER_SECONDS * 1000) - timerMsLeft),
            answerTimeMs: Math.max(0, (QUIZ_TIMER_SECONDS * 1000) - timerMsLeft),
            pointsAwarded: quizPointsAwarded,
            timerValue: timerSecondsLeft,
            overrideStatus: 'none',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        ).catch((error) => {
          console.warn('Quiz answer analytics write failed.', error);
        });
      }
      return true;
    } catch (error) {
      const message = String(error?.message || 'Could not submit answer.');
      const normalizedMessage = normalizeText(message);
      if (
        normalizedMessage.includes('quota exceeded')
        || normalizedMessage.includes('quotaexceeded')
        || (normalizedMessage.includes('storage') && normalizedMessage.includes('quota'))
      ) {
        console.warn('Suppressed storage quota warning from answer submit.', error);
        return null;
      }
      setNotice(message);
      return null;
    }
  };

  useEffect(() => {
    const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
    const round = game?.currentRound || null;
    const roundKey = stableRoundIdentityKey(round || {});
    const settleKey = `${game?.id || ''}:${roundKey}:standard-reveal`;
    if (
      isQuizGame
      || !round
      || round.status !== 'open'
      || !hasSubmittedRoundAnswer(round, 'jay')
      || !hasSubmittedRoundAnswer(round, 'kim')
    ) {
      if (standardRevealSettleRef.current === settleKey) standardRevealSettleRef.current = '';
      return undefined;
    }
    if (standardRevealSettleRef.current === settleKey) return undefined;
    const gameRef = makeGameRef();
    if (!gameRef || !firestore) return undefined;
    standardRevealSettleRef.current = settleKey;
    updateDoc(gameRef, {
      'currentRound.status': 'reveal',
      'currentRound.updatedAt': serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => {
      standardRevealSettleRef.current = '';
    });
    return undefined;
  }, [
    firestore,
    game?.id,
    game?.gameMode,
    game?.currentRound?.status,
    game?.currentRound?.questionId,
    game?.currentRound?.number,
    game?.currentRound?.answers?.jay?.ownAnswer,
    game?.currentRound?.answers?.kim?.ownAnswer,
  ]);

  const drawQuestion = (sourceGame = game, sourceRounds = rounds) => {
    const sourceBankType = sourceGame?.questionBankType === 'quiz' ? 'quiz' : 'game';
    const sourcePool = sourceBankType === 'quiz' ? quizBankQuestions : gameBankQuestions;
    const retiredQuestionIds = sourceBankType === 'quiz' ? trackedUsedQuizQuestionIds : effectiveRetiredQuestionIds;
    const localUsedQuestionIds = mergeUniqueIds(
      sourceGame?.usedQuestionIds || [],
      (sourceRounds || []).map((round) => round.questionId),
    );
    const usedIds = new Set(localUsedQuestionIds);
    if (sourceGame?.currentRound?.questionId) usedIds.add(sourceGame.currentRound.questionId);
    const previousQuestionId = sourceGame?.currentRound?.questionId || sourceRounds.at(-1)?.questionId || null;
    const questionQueueIds = Array.isArray(sourceGame?.questionQueueIds) ? sourceGame.questionQueueIds.filter(Boolean) : [];
    const availablePool = sourcePool.filter(
      (question) =>
        !retiredQuestionIds.has(question.id)
        && !reservedQuestionIds.has(question.id)
        && !usedIds.has(question.id),
    );
    const starterFallbackPool = sourceBankType === 'quiz'
      ? []
      : standardSelectableQuestions.filter(
          (question) =>
            !retiredQuestionIds.has(question.id)
            && !reservedQuestionIds.has(question.id)
            && !usedIds.has(question.id),
        );
    const candidateQuestions = availablePool.length
      ? availablePool
      : sourcePool.length
        ? []
        : starterFallbackPool;
    const queuePool = questionQueueIds
      .map((id) => sourcePool.find((question) => question.id === id))
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
      const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
      if (
        game.currentRound
        && game.currentRound.status !== 'reveal'
        && !(
          hasSubmittedRoundAnswer(game.currentRound, 'jay')
          && hasSubmittedRoundAnswer(game.currentRound, 'kim')
        )
      ) {
        throw new Error('Both players must submit their answers before loading the next question.');
      }
      if (isCurrentLocalTestGame) {
        const completedRoundsBefore = Math.max(Number(game.roundsPlayed || 0), rounds.length);
        const totalQuestionGoal = getGameQuestionGoal(game, rounds);

        if (!game.currentRound && totalQuestionGoal > 0 && completedRoundsBefore >= totalQuestionGoal) {
          await completeCurrentGameFromNextQuestion('Game complete. Summary is now shown in the room.');
          return;
        }

        let nextRounds = rounds;
        let nextTotals = game.totals || { jay: 0, kim: 0 };
        let nextQuizTotals = game.quizTotals || { jay: 0, kim: 0 };
        let nextRoundsPlayed = completedRoundsBefore;
        let nextUsedQuestionIds = mergeUniqueIds(game.usedQuestionIds || [], rounds.map((round) => round.questionId));
        let nextGameState = { ...game };
        let savedCurrentRound = false;

        if (game.currentRound) {
          const penalties = isQuizGame ? { jay: 0, kim: 0 } : toPenaltyScores(penaltyDraft);
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
              quizPoints: {
                jay: Number(game.currentRound.answers?.jay?.pointsAwarded || 0),
                kim: Number(game.currentRound.answers?.kim?.pointsAwarded || 0),
              },
            },
            game.currentRound.number || rounds.length + 1,
            nextTotals,
          );

          nextRounds = normalizeStoredRounds([...rounds, roundResult]);
          nextTotals = getRoundPenaltyTotals(roundResult);
          if (isQuizGame) {
            nextQuizTotals = {
              jay: Number(nextQuizTotals.jay || 0) + Number(game.currentRound.answers?.jay?.pointsAwarded || 0),
              kim: Number(nextQuizTotals.kim || 0) + Number(game.currentRound.answers?.kim?.pointsAwarded || 0),
            };
          }
          nextRoundsPlayed = nextRounds.length;
          nextUsedQuestionIds = mergeUniqueIds(nextUsedQuestionIds, game.currentRound.questionId, nextRounds.map((round) => round.questionId));
          nextGameState = {
            ...nextGameState,
            totals: nextTotals,
            quizTotals: nextQuizTotals,
            roundsPlayed: nextRoundsPlayed,
            usedQuestionIds: nextUsedQuestionIds,
            currentRound: null,
            quizReadyState: null,
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
          if (isQuizGame && !game.currentRound) {
            if (!isQuizWagerAgreementLocked(game)) {
              throw new Error('Both players must agree one shared quiz wager before starting Quick Fire.');
            }
          }
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
          const nextRound = buildRoundFromQuestion(nextQuestionItem, nextRoundNumber, { isQuizGame, startOpen: true });
          nextGameState = {
            ...nextGameState,
            totals: nextTotals,
            roundsPlayed: nextRoundsPlayed,
            usedQuestionIds: nextUsedQuestionIds,
            currentRound: nextRound,
            quizReadyState: null,
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
      let totalsAfterSave = totalsBefore;
      let completedRoundsAfterSave = completedRoundsBefore;
      let nextQuizTotals = game.quizTotals || { jay: 0, kim: 0 };
      let archivedQuestionId = '';
      let savedCurrentRound = false;

      if (game.currentRound) {
        const penalties = isQuizGame ? { jay: 0, kim: 0 } : toPenaltyScores(penaltyDraft);

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
            quizPoints: {
              jay: Number(game.currentRound.answers?.jay?.pointsAwarded || 0),
              kim: Number(game.currentRound.answers?.kim?.pointsAwarded || 0),
            },
          },
          game.currentRound.number || rounds.length + 1,
          totalsBefore,
        );

        await setDoc(doc(firestore, 'games', gameId, 'rounds', roundResult.id), roundResult);
        totalsAfterSave = getRoundPenaltyTotals(roundResult);
        if (isQuizGame) {
          nextQuizTotals = {
            jay: Number(nextQuizTotals.jay || 0) + Number(game.currentRound.answers?.jay?.pointsAwarded || 0),
            kim: Number(nextQuizTotals.kim || 0) + Number(game.currentRound.answers?.kim?.pointsAwarded || 0),
          };
        }
        completedRoundsAfterSave = completedRoundsBefore + 1;
        archivedQuestionId = game.currentRound.questionId || '';
        savedCurrentRound = true;

        if (totalQuestionGoal > 0 && completedRoundsAfterSave >= totalQuestionGoal) {
          await setDoc(gameRef, {
            totals: totalsAfterSave,
            quizTotals: nextQuizTotals,
            roundsPlayed: completedRoundsAfterSave,
            ...(archivedQuestionId ? { usedQuestionIds: arrayUnion(archivedQuestionId) } : {}),
            currentRound: null,
            quizReadyState: null,
            status: game.status === 'paused' ? 'paused' : 'active',
            updatedAt: serverTimestamp(),
          }, { merge: true });
          await completeCurrentGameFromNextQuestion('Final round saved. Game ended and moved to Previous Games.');
          return;
        }
      }

      if (game.status !== 'completed') {
        if (isQuizGame && !game.currentRound) {
          if (!isQuizWagerAgreementLocked(game)) {
            throw new Error('Both players must agree one shared quiz wager before starting Quick Fire.');
          }
        }
        const drawn = drawQuestion();
        let nextQuestionItem = drawn.question || null;
        let nextRemainingQueueIds = drawn.remainingQueueIds;
        if (!nextQuestionItem && Array.isArray(game.questionQueueIds) && game.questionQueueIds.length) {
          const queuedQuestionId = game.questionQueueIds.find(Boolean) || '';
          if (queuedQuestionId) {
            const queuedQuestionSnap = await getDoc(doc(firestore, 'questionBank', queuedQuestionId)).catch(() => null);
            if (queuedQuestionSnap?.exists()) {
              nextQuestionItem = normalizeStoredQuestion(queuedQuestionSnap.data(), queuedQuestionSnap.id);
              nextRemainingQueueIds = game.questionQueueIds.filter((id) => id !== queuedQuestionId);
            }
          }
        }
        if (!nextQuestionItem) {
          if (savedCurrentRound) {
            await setDoc(gameRef, {
              totals: totalsAfterSave,
              quizTotals: nextQuizTotals,
              roundsPlayed: completedRoundsAfterSave,
              ...(archivedQuestionId ? { usedQuestionIds: arrayUnion(archivedQuestionId) } : {}),
              currentRound: null,
              quizReadyState: null,
              status: game.status === 'paused' ? 'paused' : 'active',
              updatedAt: serverTimestamp(),
            }, { merge: true });
          }
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
        const nextRound = buildRoundFromQuestion(nextQuestionItem, nextRoundNumber, { isQuizGame, startOpen: true });
        const gamePatch = {
          ...(savedCurrentRound
            ? {
                totals: totalsAfterSave,
                quizTotals: nextQuizTotals,
                roundsPlayed: completedRoundsAfterSave,
                ...(archivedQuestionId ? { usedQuestionIds: arrayUnion(archivedQuestionId) } : {}),
              }
            : {}),
          currentRound: nextRound,
          quizReadyState: null,
          questionQueueIds: nextRemainingQueueIds,
          status: 'active',
          updatedAt: serverTimestamp(),
        };
        await setDoc(gameRef, gamePatch, { merge: true });
        if (savedCurrentRound) setNotice('Saved and loaded the next question.');
        else setNotice('Question loaded.');
      }
    }, 'Could not move to the next question.');

  const startQuizSetupCountdown = async () => {
    if (!game || !((game?.gameMode || 'standard') === 'quiz') || game.currentRound) return;
    if (!isQuizWagerEffectivelyLocked(game)) return;
    const readyState = game.quizReadyState || defaultQuizReadyState('opening');
    const ready = readyState.ready || { jay: false, kim: false };
    const stage = normalizeText(readyState.stage || 'opening') || 'opening';
    if (stage === 'countdown' || !ready.jay || !ready.kim) return;
    const nowIso = new Date().toISOString();
    const countdownEndsAt = new Date(Date.now() + QUIZ_SETUP_COUNTDOWN_MS).toISOString();
    const localLockedAgreement = normalizeQuizWagerAgreement(game);
    const localSharedWagerAmount = Math.max(0, Number(getQuizSharedWagerAmount(game) || 0));

    setGame((current) =>
      current && !current.currentRound
        ? {
            ...current,
            quizReadyState: {
              ...(current.quizReadyState || defaultQuizReadyState('ready')),
              stage: 'countdown',
              ready: {
                ...((current.quizReadyState && current.quizReadyState.ready) || { jay: false, kim: false }),
                jay: true,
                kim: true,
              },
              countdownStartedAt: current.quizReadyState?.countdownStartedAt || nowIso,
              countdownEndsAt: current.quizReadyState?.countdownEndsAt || countdownEndsAt,
            },
            updatedAt: nowIso,
          }
        : current,
    );

    if (isCurrentLocalTestGame) {
      return;
    }

    const gameRef = makeGameRef();
    if (!gameRef || !firestore) return;
    await runTransaction(firestore, async (transaction) => {
      const snap = await transaction.get(gameRef);
      if (!snap.exists()) throw new Error('Room not found.');
      const data = snap.data() || {};
      if (data.currentRound) return;
      const liveAgreement = normalizeQuizWagerAgreement(data);
      const liveAgreementLocked = isQuizWagerAgreementLocked(data);
      const canPromoteLocalLock = !liveAgreementLocked && isQuizWagerEffectivelyLocked(game);
      if (!liveAgreementLocked && !canPromoteLocalLock) return;
      const liveReadyState = data.quizReadyState || defaultQuizReadyState('opening');
      const liveReady = liveReadyState.ready || { jay: false, kim: false };
      const mergedReady = {
        jay: Boolean(liveReady.jay || ready.jay),
        kim: Boolean(liveReady.kim || ready.kim),
      };
      const liveStage = normalizeText(liveReadyState.stage || 'opening') || 'opening';
      if (liveStage === 'countdown' || !mergedReady.jay || !mergedReady.kim) return;
      const nextCountdownStartedAt = liveReadyState.countdownStartedAt || readyState.countdownStartedAt || nowIso;
      const nextCountdownEndsAt = liveReadyState.countdownEndsAt || readyState.countdownEndsAt || countdownEndsAt;
      const nextAgreement = canPromoteLocalLock
        ? {
            ...liveAgreement,
            ...localLockedAgreement,
            status: localLockedAgreement.status || 'wheel_locked',
            requestKind: localLockedAgreement.requestKind || liveAgreement.requestKind || 'wheel',
            amount: localSharedWagerAmount,
            wheelResultAmount: Number(localLockedAgreement.wheelResultAmount || localSharedWagerAmount || 0),
            proposalStatus: 'accepted',
            lockedByWheel: Boolean(localLockedAgreement.lockedByWheel || liveAgreement.lockedByWheel || localLockedAgreement.status === 'wheel_locked'),
            lockedAt: localLockedAgreement.lockedAt || new Date().toISOString(),
          }
        : null;
      transaction.update(gameRef, {
        ...(nextAgreement
          ? {
              quizWagerAgreement: nextAgreement,
              quizWagers: { jay: localSharedWagerAmount, kim: localSharedWagerAmount },
            }
          : {}),
        quizReadyState: {
          ...liveReadyState,
          stage: 'countdown',
          ready: mergedReady,
          countdownStartedAt: nextCountdownStartedAt,
          countdownEndsAt: nextCountdownEndsAt,
        },
        updatedAt: serverTimestamp(),
      });
    });
  };

  const launchQuizRoundFromSetup = async () => {
    if (!game || !((game?.gameMode || 'standard') === 'quiz') || game.currentRound) return;
    if (!isQuizWagerEffectivelyLocked(game)) return;
    const readyState = game.quizReadyState || defaultQuizReadyState('opening');
    const ready = readyState.ready || { jay: false, kim: false };
    const stage = normalizeText(readyState.stage || 'opening') || 'opening';
    const countdownEndsAtMs = Date.parse(readyState.countdownEndsAt || '');
    const localCountdownReady = stage === 'countdown' && Number.isFinite(countdownEndsAtMs) && Date.now() >= countdownEndsAtMs;
    if (!localCountdownReady) return;
    if (!ready.jay || !ready.kim) return;

    if (isCurrentLocalTestGame) {
      const drawn = drawQuestion(game, rounds);
      const nextQuestionItem = drawn.question;
      if (!nextQuestionItem) {
        await completeCurrentGameFromNextQuestion('Quiz complete. Summary is now shown in the room.');
        return;
      }
      const nextRoundNumber = Math.max(Number(game.roundsPlayed || 0) + 1, 1);
      const nextRound = buildRoundFromQuestion(nextQuestionItem, nextRoundNumber, { isQuizGame: true, startOpen: true });
      setGame((current) =>
        current && !current.currentRound
          ? {
              ...current,
              currentRound: nextRound,
              questionQueueIds: drawn.remainingQueueIds,
              quizReadyState: null,
              status: 'active',
              updatedAt: new Date().toISOString(),
            }
          : current,
      );
      setNotice('Quick Fire question started.');
      return;
    }

    const gameRef = makeGameRef();
    if (!gameRef || !firestore) return;
    const snap = await getDoc(gameRef);
    if (!snap.exists()) throw new Error('Room not found.');
    const data = snap.data() || {};
    if (data.currentRound) return;
    const liveAgreement = normalizeQuizWagerAgreement(data);
    const liveAgreementLocked = isQuizWagerAgreementLocked(data);
    const canPromoteLocalLock = !liveAgreementLocked && isQuizWagerEffectivelyLocked(game);
    const liveReadyState = data.quizReadyState || defaultQuizReadyState('opening');
    const setupReady = liveReadyState.ready || { jay: false, kim: false };
    const mergedReady = {
      jay: Boolean(setupReady.jay || ready.jay),
      kim: Boolean(setupReady.kim || ready.kim),
    };
    const liveStage = normalizeText(liveReadyState.stage || 'opening') || 'opening';
    const liveCountdownEndsAtMs = Date.parse(liveReadyState.countdownEndsAt || '');
    const liveCountdownReady = liveStage === 'countdown' && Number.isFinite(liveCountdownEndsAtMs) && Date.now() >= liveCountdownEndsAtMs;
    if (!liveCountdownReady && !localCountdownReady) return;
    if (!mergedReady.jay || !mergedReady.kim) return;
    if (!liveAgreementLocked && !canPromoteLocalLock) return;
    const promotedAgreement = canPromoteLocalLock
      ? {
          ...liveAgreement,
          ...normalizeQuizWagerAgreement(game),
          status: normalizeQuizWagerAgreement(game).status || 'wheel_locked',
          requestKind: normalizeQuizWagerAgreement(game).requestKind || liveAgreement.requestKind || 'wheel',
          amount: Math.max(0, Number(getQuizSharedWagerAmount(game) || 0)),
          wheelResultAmount: Number(normalizeQuizWagerAgreement(game).wheelResultAmount || getQuizSharedWagerAmount(game) || 0),
          proposalStatus: 'accepted',
          lockedByWheel: Boolean(normalizeQuizWagerAgreement(game).lockedByWheel || liveAgreement.lockedByWheel || normalizeQuizWagerAgreement(game).status === 'wheel_locked'),
          lockedAt: normalizeQuizWagerAgreement(game).lockedAt || new Date().toISOString(),
        }
      : null;
    const sharedQueueIds = Array.isArray(data.questionQueueIds) && data.questionQueueIds.length
      ? data.questionQueueIds
      : Array.isArray(game.questionQueueIds)
        ? game.questionQueueIds
        : [];
    const sourceGame = {
      ...game,
      ...data,
      id: game.id,
      questionQueueIds: sharedQueueIds,
      quizWagerAgreement: promotedAgreement || data.quizWagerAgreement || game.quizWagerAgreement || null,
      quizWagers: promotedAgreement
        ? {
            jay: Math.max(0, Number(getQuizSharedWagerAmount(game) || 0)),
            kim: Math.max(0, Number(getQuizSharedWagerAmount(game) || 0)),
          }
        : (data.quizWagers || game.quizWagers || { jay: 0, kim: 0 }),
    };
    const drawn = drawQuestion(sourceGame, rounds);
    let nextQuestionItem = drawn.question || null;
    let nextRemainingQueueIds = drawn.remainingQueueIds;
    if (!nextQuestionItem && sharedQueueIds.length) {
      const queuedQuestionId = sharedQueueIds.find(Boolean) || '';
      if (queuedQuestionId) {
        const queuedQuestionSnap = await getDoc(doc(firestore, 'questionBank', queuedQuestionId)).catch(() => null);
        if (queuedQuestionSnap?.exists()) {
          nextQuestionItem = normalizeStoredQuestion(queuedQuestionSnap.data(), queuedQuestionSnap.id);
          nextRemainingQueueIds = sharedQueueIds.filter((id) => id !== queuedQuestionId);
        }
      }
    }
    if (!nextQuestionItem) {
      await setDoc(gameRef, {
        quizReadyState: defaultQuizReadyState('ready'),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      throw new Error('No quiz questions are available.');
    }
    const nextRoundNumber = Math.max(Number(sourceGame.roundsPlayed || 0) + 1, 1);
    const nextRound = {
      ...buildRoundFromQuestion(nextQuestionItem, nextRoundNumber, { isQuizGame: true, startOpen: true }),
      id: `round-quiz-${nextRoundNumber}-${sanitizeNoteKey(nextQuestionItem.id || nextQuestionItem.question || 'question') || 'question'}`,
    };
    await setDoc(gameRef, {
      ...(promotedAgreement
        ? {
            quizWagerAgreement: promotedAgreement,
            quizWagers: {
              jay: Math.max(0, Number(getQuizSharedWagerAmount(game) || 0)),
              kim: Math.max(0, Number(getQuizSharedWagerAmount(game) || 0)),
            },
          }
        : {}),
      currentRound: nextRound,
      quizReadyState: null,
      questionQueueIds: nextRemainingQueueIds,
      status: 'active',
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setGame((current) =>
      current && !current.currentRound
        ? {
            ...current,
            currentRound: nextRound,
            quizReadyState: null,
            questionQueueIds: nextRemainingQueueIds,
            status: 'active',
            updatedAt: new Date().toISOString(),
          }
        : current,
    );
  };

  useEffect(() => {
    const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
    const readyState = game?.quizReadyState || null;
    const ready = readyState?.ready || {};
    const stage = normalizeText(readyState?.stage || 'opening') || 'opening';
    const countdownKey = `${game?.id || ''}:${game?.currentRound ? 'round-live' : 'no-round'}:${stage}:${Boolean(ready.jay)}:${Boolean(ready.kim)}:${game?.quizWagerAgreement?.status || ''}:${game?.quizWagerAgreement?.amount ?? ''}:${game?.quizWagerAgreement?.wheelResultAmount ?? ''}`;
    if (!isQuizGame || game?.currentRound || stage === 'countdown' || !ready.jay || !ready.kim || !isQuizWagerEffectivelyLocked(game)) {
      if (quizSetupCountdownRef.current === countdownKey) quizSetupCountdownRef.current = '';
      return undefined;
    }
    const attemptCountdownStart = () => {
      if (quizSetupCountdownRef.current === countdownKey) return;
      quizSetupCountdownRef.current = countdownKey;
      startQuizSetupCountdown()
        .catch((error) => {
          debugRoom('quizSetupCountdownFailed', { gameId: game?.id || '', message: error?.message || String(error) });
          setNotice(error?.message || 'Could not start the Quick Fire countdown.');
        })
        .finally(() => {
          quizSetupCountdownRef.current = '';
        });
    };
    attemptCountdownStart();
    const interval = window.setInterval(attemptCountdownStart, 250);
    return () => window.clearInterval(interval);
  }, [
    game?.id,
    game?.gameMode,
    game?.currentRound?.id,
    game?.quizReadyState?.ready?.jay,
    game?.quizReadyState?.ready?.kim,
    game?.quizReadyState?.stage,
    game?.quizWagerAgreement?.status,
    game?.quizWagerAgreement?.amount,
    game?.quizWagerAgreement?.wheelResultAmount,
  ]);

  useEffect(() => {
    const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
    const readyState = game?.quizReadyState || null;
    const ready = readyState?.ready || {};
    const stage = normalizeText(readyState?.stage || 'opening') || 'opening';
    const endsAt = readyState?.countdownEndsAt || '';
    const setupKey = `${game?.id || ''}:${game?.currentRound ? 'round-live' : 'no-round'}:${stage}:${endsAt}:${Boolean(ready.jay)}:${Boolean(ready.kim)}:${game?.quizWagerAgreement?.status || ''}:${game?.quizWagerAgreement?.amount ?? ''}:${game?.quizWagerAgreement?.wheelResultAmount ?? ''}`;
    if (!isQuizGame || game?.currentRound || stage !== 'countdown') {
      if (quizSetupLaunchRef.current === setupKey) quizSetupLaunchRef.current = '';
      return;
    }
    const endsAtMs = Date.parse(endsAt || '');
    const attemptLaunch = () => {
      if (quizSetupLaunchRef.current === setupKey || isBusy) return;
      quizSetupLaunchRef.current = setupKey;
      launchQuizRoundFromSetup()
        .catch((error) => {
          debugRoom('quizSetupLaunchFailed', { gameId: game?.id || '', message: error?.message || String(error) });
          setNotice(error?.message || 'Could not start Quick Fire.');
        })
        .finally(() => {
          quizSetupLaunchRef.current = '';
        });
    };
    let retryInterval = 0;
    const launchDelayMs = Number.isFinite(endsAtMs) ? Math.max(0, endsAtMs - Date.now() + 60) : 0;
    const launchTimer = window.setTimeout(() => {
      attemptLaunch();
      retryInterval = window.setInterval(attemptLaunch, 1000);
    }, launchDelayMs);
    return () => {
      window.clearTimeout(launchTimer);
      if (retryInterval) window.clearInterval(retryInterval);
    };
  }, [
    game?.id,
    game?.gameMode,
    game?.currentRound?.id,
    game?.currentRound?.questionId,
    game?.quizReadyState?.ready?.jay,
    game?.quizReadyState?.ready?.kim,
    game?.quizReadyState?.stage,
    game?.quizReadyState?.countdownEndsAt,
    game?.quizWagerAgreement?.status,
    game?.quizWagerAgreement?.amount,
    game?.quizWagerAgreement?.wheelResultAmount,
    isBusy,
    rounds.length,
  ]);

  useEffect(() => {
    const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
    const roundKey = stableRoundIdentityKey(game?.currentRound || {});
    const ready = game?.currentRound?.nextReady || {};
    const advanceKey = `${game?.id || ''}:${roundKey}:${Boolean(ready.jay)}:${Boolean(ready.kim)}`;
    if (!isQuizGame || !game?.currentRound || game.currentRound.status !== 'reveal' || !ready.jay || !ready.kim) {
      if (quizAdvanceRef.current === advanceKey) quizAdvanceRef.current = '';
      return;
    }
    if (quizAdvanceRef.current === advanceKey || isBusy) return;
    quizAdvanceRef.current = advanceKey;
    nextQuestion()
      .catch(() => null)
      .finally(() => {
        quizAdvanceRef.current = '';
      });
  }, [
    game?.id,
    game?.gameMode,
    game?.currentRound?.status,
    game?.currentRound?.questionId,
    game?.currentRound?.number,
    game?.currentRound?.nextReady?.jay,
    game?.currentRound?.nextReady?.kim,
    isBusy,
  ]);

  useEffect(() => {
    const isQuizGame = (game?.gameMode || 'standard') === 'quiz';
    const currentRoundKey = stableRoundIdentityKey(game?.currentRound || {});
    if (!isQuizGame || !game?.currentRound || game.currentRound.status !== 'open') {
      quizTimeoutRevealRef.current = '';
      return;
    }
    const quizEndsAtMs = Date.parse(game.currentRound?.quizTimerEndsAt || '');
    if (!Number.isFinite(quizEndsAtMs)) return;
    const timeoutKey = `${game.id}:${currentRoundKey}`;
    const remainingMs = Math.max(0, quizEndsAtMs - Date.now());
    const timeout = window.setTimeout(() => {
      if (quizTimeoutRevealRef.current === timeoutKey) return;
      quizTimeoutRevealRef.current = timeoutKey;
      if (isCurrentLocalTestGame) {
        setGame((current) =>
          current?.currentRound && stableRoundIdentityKey(current.currentRound) === currentRoundKey && current.currentRound.status === 'open'
            ? {
                ...current,
                currentRound: {
                  ...current.currentRound,
                  status: 'reveal',
                  updatedAt: new Date().toISOString(),
                },
                updatedAt: new Date().toISOString(),
              }
            : current,
        );
        return;
      }
      const gameRef = makeGameRef();
      if (!gameRef || !firestore) return;
      runTransaction(firestore, async (transaction) => {
        const snap = await transaction.get(gameRef);
        if (!snap.exists()) return;
        const data = snap.data() || {};
        const round = data.currentRound || null;
        if (!round || round.status !== 'open') return;
        if (stableRoundIdentityKey(round) !== currentRoundKey) return;
        transaction.update(gameRef, {
          'currentRound.status': 'reveal',
          'currentRound.updatedAt': serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }).catch(() => null);
    }, remainingMs + 10);
    return () => window.clearTimeout(timeout);
  }, [
    firestore,
    game?.id,
    game?.gameMode,
    game?.currentRound?.status,
    game?.currentRound?.questionId,
    game?.currentRound?.number,
    game?.currentRound?.quizTimerEndsAt,
    isCurrentLocalTestGame,
  ]);

  const sendChat = async (textOverride = '') =>
    withBusy(async () => {
      const text = String(textOverride || chatDraft || '').trim();
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

  const sendLobbyChat = async (textOverride = '') => {
    const text = String(textOverride || lobbyChatDraft || '').trim();
    if (!text || isLobbyChatSending) return null;
    if (!firestore || !user) {
      setNotice('Firebase is not configured.');
      return null;
    }

    const messageRef = doc(collection(firestore, 'lobbyChat'));
    const optimisticMessage = {
      id: messageRef.id,
      text,
      uid: user.uid || '',
      displayName: profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Player',
      createdAt: new Date().toISOString(),
    };

    setIsLobbyChatSending(true);
    setLobbyChatDraft('');

    try {
      await setDoc(messageRef, {
        text,
        uid: user.uid || '',
        displayName: optimisticMessage.displayName,
        createdAt: optimisticMessage.createdAt,
      });
      return messageRef.id;
    } catch (error) {
      setLobbyChatDraft((current) => current || text);
      setNotice(String(error?.message || 'Could not send lobby chat message.'));
      return null;
    } finally {
      setIsLobbyChatSending(false);
    }
  };

  useEffect(() => {
    if (!firestore) return undefined;
    const currentDashboardTab = (typeof window !== 'undefined' && window.localStorage)
      ? (window.localStorage.getItem('kjk-dashboard-tab') || 'gameLobby')
      : 'gameLobby';

    if (currentDashboardTab !== 'gameLobby') {
      setLobbyChatMessages([]);
      return undefined;
    }

    const q = query(collection(firestore, 'lobbyChat'), orderBy('createdAt', 'asc'), limitToLast(200));
    const unsub = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      setLobbyChatMessages(msgs);
    }, (err) => {
      console.warn('Lobby chat listener error', err);
      setLobbyChatMessages([]);
      if (String(err?.code || '').includes('permission-denied') || String(err?.message || '').toLowerCase().includes('insufficient permissions')) {
        setNotice((current) => current || 'Lobby chat is unavailable until Firestore permissions are updated.');
      }
    });

    return () => unsub();
  }, [firestore]);

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
        targetBankType: 'game',
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
        targetBankType: 'game',
      });
      await upsertQuestionBankBatch(firestore, [...result.imports, ...result.updates]);
      const nextBankCount = bankQuestions.length + result.summary.imported;
      setSyncNotice(
        `Synced question bank: ${result.summary.imported} new, ${result.summary.updated} updated, ${result.summary.duplicates} duplicates, ${result.summary.invalid} invalid. Bank now tracks about ${nextBankCount} questions.`,
      );
      setNotice('Question bank synced from Google Sheet.');
    }, 'Could not sync the question bank.');

  const importQuizSheet = async () =>
    withBusy(async () => {
      const result = await syncGoogleSheetQuestions({
        sheetValue: sheetInput || DEFAULT_SETTINGS.googleSheetInput,
        existingQuestions: bankQuestions,
        overwriteExisting: false,
        targetBankType: 'quiz',
      });
      await upsertQuestionBankBatch(firestore, [...result.imports, ...result.updates]);
      const nextBankCount = quizBankQuestions.length + result.summary.imported;
      setSyncNotice(
        `Imported ${result.summary.imported} new quiz questions, skipped ${result.summary.skipped}, duplicates ${result.summary.duplicates}, invalid ${result.summary.invalid}. Quiz bank now tracks about ${nextBankCount} questions.`,
      );
      setNotice(`Quiz import complete: ${result.summary.imported} new questions added.`);
    }, 'Could not import quiz questions from the Google Sheet.');

  const syncQuizSheet = async () =>
    withBusy(async () => {
      const result = await syncGoogleSheetQuestions({
        sheetValue: sheetInput || DEFAULT_SETTINGS.googleSheetInput,
        existingQuestions: bankQuestions,
        overwriteExisting: true,
        targetBankType: 'quiz',
      });
      await upsertQuestionBankBatch(firestore, [...result.imports, ...result.updates]);
      const nextBankCount = quizBankQuestions.length + result.summary.imported;
      setSyncNotice(
        `Synced quiz bank: ${result.summary.imported} new, ${result.summary.updated} updated, ${result.summary.duplicates} duplicates, ${result.summary.invalid} invalid. Quiz bank now tracks about ${nextBankCount} questions.`,
      );
      setNotice('Quiz bank synced from Google Sheet.');
    }, 'Could not sync the quiz bank.');

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

  if (roomLoadState.status === 'error' && !shouldBypassMobileAutoResumeRoom && !game?.id) {
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
	        connectionState={connectionState}
	        questionNotes={questionNotes}
	        questionFeedback={questionFeedback}
	        quizAnswers={visibleQuizAnswers}
        onSaveDisplayName={saveDisplayNameProfile}
        onUpdateQuestionNote={updatePrivateQuestionNote}
        onDeleteQuestionNote={deletePrivateQuestionNote}
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
        onSyncQuizBank={syncQuizSheet}
        onImportQuestions={importSheet}
        onImportQuizQuestions={importQuizSheet}
        onResumeGame={resumeGame}
        onViewSummary={setSelectedGameId}
        onEndGame={requestEndGame}
        onDeleteGame={requestDeleteGame}
        onResetBalances={resetLifetimeBalancesAction}
        onSaveBalances={saveLifetimeBalancesAction}
        onSignOut={signOutUser}
        activeGames={activeGames}
        previousGames={previousGames}
        lobbyAnalytics={lobbyAnalytics}
        lobbyRoundAnalytics={lobbyRoundAnalytics}
        categoryColorMap={categoryColorMap}
        bankCount={bankCount}
        questionCount={gameBankQuestions.length || STARTER_QUESTIONS.length}
        usedQuestionCount={usedQuestionCount}
        remainingQuestionCount={remainingQuestionCount}
        quizQuestionCount={quizBankCount}
        usedQuizQuestionCount={usedQuizQuestionCount}
        remainingQuizQuestionCount={remainingQuizQuestionCount}
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
        lobbyChatMessages={lobbyChatMessages}
        lobbyChatDraft={lobbyChatDraft}
        isLobbyChatSending={isLobbyChatSending}
        setLobbyChatDraft={setLobbyChatDraft}
        sendLobbyChat={sendLobbyChat}
      />
    );
  }

	  return (
    <GameRoomView
      user={user}
      profile={profile}
      connectionState={connectionState}
      game={game}
      rounds={rounds}
      questionFeedback={questionFeedback}
      questionReplays={questionReplays}
      playerAccounts={playerAccounts}
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
	      onMarkReady={markReady}
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
      bankDraft={bankDraft}
      setBankDraft={setBankDraft}
      syncNotice={syncNotice}
      bankCount={bankCount}
      notice={notice}
      chatMessages={chatMessages}
      chatDraft={chatDraft}
      setChatDraft={setChatDraft}
      onSendChat={sendChat}
      onReconnectLiveRoom={() => {
        setConnectionState((current) => ({ ...current, lastError: '' }));
        resetRoomLoadState();
        setListenerRefreshKey((current) => current + 1);
      }}
      onSaveQuestionNote={savePrivateQuestionNote}
      onSaveQuestionFeedback={saveQuestionFeedback}
      onSaveQuestionReplay={saveQuestionReplayRequest}
      onSaveQuizWager={saveQuizWager}
      onAcceptQuizWager={acceptQuizWager}
      onRejectQuizWager={rejectQuizWager}
      onSetQuizWheelOptIn={setQuizWheelOptIn}
      onRequestQuizOverride={requestQuizOverride}
      onRespondQuizOverride={respondQuizOverride}
      quizWagerDraft={quizWagerDraft}
      setQuizWagerDraft={setQuizWagerDraft}
    />
  );
}

export default ProductionApp;
