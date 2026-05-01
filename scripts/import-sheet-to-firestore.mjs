import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import {
  parseGoogleSheetImport,
  parseGoogleSheetQuizImport,
  parseGoogleSheetReference,
  parseGoogleSheetThisOrThatImport,
  parseGoogleSheetTrueFalseImport,
} from '../src/utils/importers.js';
import { DEFAULT_SETTINGS, makeId, normalizeQuestionBankType, normalizeText } from '../src/utils/game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const loadEnvFile = (filename) => {
  const filePath = path.join(projectRoot, filename);
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  });
};

loadEnvFile('.env.local');
loadEnvFile('.env');

const email = process.argv[2];
const password = process.argv[3];
const sheetValue = process.argv[4] || DEFAULT_SETTINGS.googleSheetInput;
const shouldCreateDebugGame = process.argv.includes('--create-debug-game');
const cleanupGameIndex = process.argv.indexOf('--delete-game');
const cleanupGameId = cleanupGameIndex >= 0 ? process.argv[cleanupGameIndex + 1] : '';

if (!email || !password) {
  console.error('Usage: node scripts/import-sheet-to-firestore.mjs <email> <password> [sheet-url]');
  process.exit(1);
}

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || '',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.VITE_FIREBASE_APP_ID || '',
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || '',
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error('Firebase config missing. Check .env.local.');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestore = getFirestore(app);

const chunkArray = (items, size = 400) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const upsertQuestionBankBatch = async (db, questions) => {
  for (const chunk of chunkArray(questions, 400)) {
    const batch = writeBatch(db);
    chunk.forEach((question) => {
      batch.set(doc(db, 'questionBank', question.id), question, { merge: true });
    });
    await batch.commit();
  }
};

const fixedPlayerUids = {
  jay: 'jaynorton17',
  kim: 'stonekim93',
};

const buildPairKey = () => [fixedPlayerUids.jay, fixedPlayerUids.kim].sort().join('::');

const normalizeJoinCode = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

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

const syncGoogleSheetQuestions = async ({ sheetValue: nextSheetValue, existingQuestions, targetBankType = 'game' }) => {
  const reference = parseGoogleSheetReference(nextSheetValue);
  if (!reference) throw new Error('Enter a valid Google Sheet URL or ID.');
  const normalizedTargetBankType = normalizeQuestionBankType(targetBankType);
  const sheetName = normalizedTargetBankType === 'quiz'
    ? 'Quiz'
    : normalizedTargetBankType === 'thisOrThatGame'
      ? 'This or That'
      : normalizedTargetBankType === 'trueFalseGame'
        ? 'True or False'
        : 'Questions';
  const targets = [{
    gid: '',
    csvUrl: `https://docs.google.com/spreadsheets/d/${reference.id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`,
    sheetName,
  }];

  const nextExistingQuestions = [...existingQuestions].filter(
    (question) => normalizeQuestionBankType(question?.bankType) === normalizedTargetBankType,
  );
  const imports = [];
  const updates = [];
  const summary = {
    imported: 0,
    updated: 0,
    duplicates: 0,
    invalid: 0,
    skipped: 0,
  };

  for (const target of targets) {
    const response = await fetch(target.csvUrl);
    if (!response.ok) {
      throw new Error(`Google Sheet fetch failed (${response.status}) for gid ${target.gid || 'default'}.`);
    }
    const rawText = await response.text();
    const result = normalizedTargetBankType === 'quiz'
      ? parseGoogleSheetQuizImport({
          rawText,
          existingQuestions: nextExistingQuestions.filter((question) => normalizeQuestionBankType(question?.bankType) === 'quiz'),
          overwriteExisting: false,
          importedAt: new Date().toISOString(),
          sourceLabel: `${reference.id}:${target.sheetName || 'Quiz'}`,
        })
      : normalizedTargetBankType === 'thisOrThatGame'
        ? parseGoogleSheetThisOrThatImport({
            rawText,
            existingQuestions: nextExistingQuestions.filter((question) => normalizeQuestionBankType(question?.bankType) === 'thisOrThatGame'),
            overwriteExisting: false,
            importedAt: new Date().toISOString(),
            sourceLabel: `${reference.id}:${target.sheetName || 'This or That'}`,
          })
        : normalizedTargetBankType === 'trueFalseGame'
          ? parseGoogleSheetTrueFalseImport({
              rawText,
              existingQuestions: nextExistingQuestions.filter((question) => normalizeQuestionBankType(question?.bankType) === 'trueFalseGame'),
              overwriteExisting: false,
              importedAt: new Date().toISOString(),
              sourceLabel: `${reference.id}:${target.sheetName || 'True or False'}`,
            })
          : parseGoogleSheetImport({
              rawText,
              existingQuestions: nextExistingQuestions,
              overwriteExisting: false,
              importedAt: new Date().toISOString(),
              sourceLabel: `${reference.id}:${target.sheetName || 'Questions'}`,
            });
    imports.push(...result.imports);
    updates.push(...result.updates);
    nextExistingQuestions.push(...result.imports, ...result.updates);
    summary.imported += result.summary.imported;
    summary.updated += result.summary.updated;
    summary.duplicates += result.summary.duplicates;
    summary.invalid += result.summary.invalid;
    summary.skipped += result.summary.skipped;
  }

  return { imports, updates, summary };
};

const run = async () => {
  await signInWithEmailAndPassword(auth, email, password);
  console.log(`Signed in as uid: ${auth.currentUser?.uid}`);

  if (cleanupGameId) {
    await deleteDoc(doc(firestore, 'games', cleanupGameId)).catch(() => null);
    await setDoc(
      doc(firestore, 'users', auth.currentUser.uid),
      {
        activeGameId: '',
        activeGames: arrayRemove(cleanupGameId),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`Deleted debug game: ${cleanupGameId}`);
    return;
  }

  const bankSnap = await getDocs(collection(firestore, 'questionBank'));
  const existingQuestions = bankSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  console.log(`Current questionBank count: ${existingQuestions.length}`);

  const bankTypes = ['game', 'thisOrThatGame', 'quiz', 'trueFalseGame'];
  const aggregate = {
    imports: [],
    updates: [],
    summary: { imported: 0, updated: 0, duplicates: 0, invalid: 0, skipped: 0 },
  };
  let workingQuestions = [...existingQuestions];
  for (const targetBankType of bankTypes) {
    const result = await syncGoogleSheetQuestions({
      sheetValue,
      existingQuestions: workingQuestions,
      targetBankType,
    });
    aggregate.imports.push(...result.imports);
    aggregate.updates.push(...result.updates);
    aggregate.summary.imported += result.summary.imported;
    aggregate.summary.updated += result.summary.updated;
    aggregate.summary.duplicates += result.summary.duplicates;
    aggregate.summary.invalid += result.summary.invalid;
    aggregate.summary.skipped += result.summary.skipped;
    workingQuestions = [...workingQuestions, ...result.imports, ...result.updates];
  }

  console.log(
    `Parsed sheets: ${aggregate.summary.imported} new, ${aggregate.summary.updated} updated, ${aggregate.summary.duplicates} duplicates, ${aggregate.summary.invalid} invalid, ${aggregate.summary.skipped} skipped.`,
  );

  if (aggregate.imports.length || aggregate.updates.length) {
    await upsertQuestionBankBatch(firestore, [...aggregate.imports, ...aggregate.updates]);
  }

  const afterSnap = await getDocs(collection(firestore, 'questionBank'));
  console.log(`Final questionBank count: ${afterSnap.size}`);

  const pairRef = doc(firestore, 'playerPairs', buildPairKey());
  const pairSnap = await getDoc(pairRef);
  const pairPlayedIds = pairSnap.exists() ? pairSnap.data()?.playedQuestionIds || [] : [];
  console.log(`Pair history count: ${pairPlayedIds.length}`);

  const blockedIds = new Set(pairPlayedIds.filter(Boolean));
  const eligible = existingQuestions.filter((question) => !blockedIds.has(question.id));
  console.log(`Eligible queue count right now: ${eligible.length}`);

  if (!eligible.length) {
    console.log('No eligible questions remain for the fixed pair. Create Game would fail with the current pair history.');
    return;
  }

  if (!shouldCreateDebugGame) {
    console.log('Skipping debug room creation.');
    return;
  }

  const requestedQuestionCount = 10;
  const queue = shuffleArray(eligible).slice(0, requestedQuestionCount);
  const joinCode = normalizeJoinCode('DEBUG1') || makeJoinCode();
  const gameRef = doc(firestore, 'games', makeId('debug-game'));
  await setDoc(gameRef, {
    joinCode,
    gameName: `Debug ${joinCode}`,
    status: 'active',
    hostUid: auth.currentUser.uid,
    hostDisplayName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Jay',
    hostPhotoURL: auth.currentUser.photoURL || '',
    seats: { jay: auth.currentUser.uid, kim: '' },
    playerUids: [auth.currentUser.uid],
    playerProfiles: {
      [auth.currentUser.uid]: {
        displayName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Jay',
        seat: 'jay',
        role: 'host',
        photoURL: auth.currentUser.photoURL || '',
      },
    },
    totals: { jay: 0, kim: 0 },
    currentRound: null,
    pairId: buildPairKey(),
    questionQueueIds: queue.map((question) => question.id),
    requestedQuestionCount,
    actualQuestionCount: queue.length,
    usedQuestionIds: [],
    roundsPlayed: 0,
    finalScores: { jay: 0, kim: 0 },
    winner: 'tie',
    lifetimePointsApplied: false,
    lifetimePointsAppliedAt: null,
    lifetimePointsAppliedBy: '',
    endedAt: null,
    endedBy: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(
    doc(firestore, 'games', gameRef.id, 'players', auth.currentUser.uid),
    {
      uid: auth.currentUser.uid,
      displayName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Jay',
      seat: 'jay',
      role: 'host',
      photoURL: auth.currentUser.photoURL || '',
      joinedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await setDoc(
    doc(firestore, 'users', auth.currentUser.uid),
    {
      uid: auth.currentUser.uid,
      displayName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Jay',
      email: auth.currentUser.email || '',
      photoURL: auth.currentUser.photoURL || '',
      activeGameId: gameRef.id,
      activeGames: arrayUnion(gameRef.id),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  console.log(`Debug game created successfully: ${gameRef.id}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
