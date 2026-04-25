import { buildInitialGameState, SCHEMA_VERSION } from './game.js';

const GAME_STORAGE_KEY = 'penalty-points-game-v1';
const THEME_STORAGE_KEY = 'penalty-points-theme-v1';
const SOUND_STORAGE_KEY = 'penalty-points-sound-v1';

export const loadGameState = () => {
  try {
    const raw = localStorage.getItem(GAME_STORAGE_KEY);
    if (!raw) return buildInitialGameState();
    const parsed = JSON.parse(raw);

    if (parsed?.schemaVersion === SCHEMA_VERSION) {
      return buildInitialGameState(parsed);
    }

    return buildInitialGameState(parsed);
  } catch (error) {
    console.warn('Could not load saved game.', error);
    return buildInitialGameState();
  }
};

export const saveGameState = (state) => {
  localStorage.setItem(
    GAME_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      rounds: state.rounds || [],
      questions: state.questions || [],
      categories: state.categories || [],
      settings: state.settings || {},
    }),
  );
};

export const clearGameState = () => {
  localStorage.removeItem(GAME_STORAGE_KEY);
};

export const loadThemeIndex = () => {
  const value = Number.parseInt(localStorage.getItem(THEME_STORAGE_KEY) || '0', 10);
  return Number.isFinite(value) ? value : 0;
};

export const saveThemeIndex = (index) => {
  localStorage.setItem(THEME_STORAGE_KEY, String(index));
};

export const loadSoundEnabled = () => localStorage.getItem(SOUND_STORAGE_KEY) === 'true';

export const saveSoundEnabled = (enabled) => {
  localStorage.setItem(SOUND_STORAGE_KEY, String(Boolean(enabled)));
};
