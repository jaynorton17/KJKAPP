import ThemeSwitcher from './ThemeSwitcher.jsx';
import { PALETTES, SCHEMA_VERSION } from '../utils/game.js';

const preferenceToggles = [
  { key: 'allowRepeats', label: 'Allow repeats' },
  { key: 'unusedOnly', label: 'Unused only' },
  { key: 'allowDecimals', label: 'Allow decimal penalties' },
  { key: 'integerScores', label: 'Round to integers' },
  { key: 'requireNotes', label: 'Require notes' },
  { key: 'lockDivisorFromTemplate', label: 'Lock divisor' },
  { key: 'editableDivisorBeforeSave', label: 'Editable divisor' },
  { key: 'skipDuplicates', label: 'Skip duplicates' },
];

function SettingsTab({
  settings,
  themeIndex,
  soundEnabled,
  questionCount,
  roundCount,
  categoryCount,
  onThemeChange,
  onShuffleTheme,
  onToggleSound,
  onSettingsChange,
  onReset,
  onExportBackup,
  onImportBackup,
}) {
  return (
    <div className="settings-tab-layout">
      <section className="panel settings-panel" aria-labelledby="settings-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Preferences</p>
            <h2 id="settings-title">App Settings</h2>
          </div>
        </div>

        <div className="settings-block">
          <span className="settings-label">Theme / sound</span>
          <ThemeSwitcher
            activeIndex={themeIndex % PALETTES.length}
            soundEnabled={soundEnabled}
            onThemeChange={onThemeChange}
            onShuffle={onShuffleTheme}
            onToggleSound={onToggleSound}
          />
        </div>

        <div className="settings-grid">
          {preferenceToggles.map((toggle) => (
            <label key={toggle.key} className="toggle">
              <input
                type="checkbox"
                checked={Boolean(settings[toggle.key])}
                onChange={(event) => onSettingsChange({ [toggle.key]: event.target.checked })}
              />
              {toggle.label}
            </label>
          ))}
        </div>

        <div className="settings-grid settings-grid-tight">
          <label className="field">
            <span>Game mode</span>
            <select value={settings.gameMode} onChange={(event) => onSettingsChange({ gameMode: event.target.value })}>
              <option value="standard">Standard random</option>
              <option value="category">Category mode</option>
              <option value="unused">Unused only</option>
              <option value="repeat">Repeat allowed</option>
              <option value="manual">Manual pick</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel settings-panel" aria-labelledby="data-controls-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Data</p>
            <h2 id="data-controls-title">Controls</h2>
          </div>
        </div>
        <div className="button-row">
          <button type="button" className="ghost-button compact" onClick={onExportBackup}>
            Export Backup
          </button>
          <button type="button" className="ghost-button compact" onClick={onImportBackup}>
            Import Backup
          </button>
        </div>
        <div className="button-row reset-row">
          <button type="button" className="danger-button compact" onClick={() => onReset('game')}>
            New Game
          </button>
          <button type="button" className="danger-button compact" onClick={() => onReset('history')}>
            Reset History
          </button>
          <button type="button" className="danger-button compact" onClick={() => onReset('bank')}>
            Reset Bank
          </button>
          <button type="button" className="danger-button compact" onClick={() => onReset('wipe')}>
            Full Wipe
          </button>
        </div>
      </section>

      <section className="panel settings-panel" aria-labelledby="debug-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Storage</p>
            <h2 id="debug-title">Local State</h2>
          </div>
          <span className="status-pill">Schema v{SCHEMA_VERSION}</span>
        </div>
        <div className="stats-grid compact-stats">
          <article className="stat-tile">
            <span>Questions</span>
            <strong>{questionCount}</strong>
          </article>
          <article className="stat-tile">
            <span>Rounds</span>
            <strong>{roundCount}</strong>
          </article>
          <article className="stat-tile">
            <span>Categories</span>
            <strong>{categoryCount}</strong>
          </article>
        </div>
      </section>
    </div>
  );
}

export default SettingsTab;
