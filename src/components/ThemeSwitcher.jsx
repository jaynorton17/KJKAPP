import { PALETTES } from '../utils/game.js';

function ThemeSwitcher({ activeIndex, soundEnabled, onThemeChange, onShuffle, onToggleSound }) {
  return (
    <div className="theme-switcher" aria-label="Theme controls">
      <div className="swatches" role="list" aria-label="Accent palettes">
        {PALETTES.map((palette, index) => (
          <button
            key={palette.name}
            type="button"
            className={`swatch ${index === activeIndex ? 'is-active' : ''}`}
            style={{
              '--swatch-a': palette.accent,
              '--swatch-b': palette.accent2,
              '--swatch-c': palette.accent3,
            }}
            onClick={() => onThemeChange(index)}
            title={palette.name}
            aria-label={`Use ${palette.name} palette`}
          />
        ))}
      </div>

      <button type="button" className="ghost-button compact" onClick={onShuffle}>
        Shuffle Theme
      </button>
      <button
        type="button"
        className={`ghost-button compact ${soundEnabled ? 'is-on' : ''}`}
        onClick={onToggleSound}
        title="Visual-only sound placeholder"
      >
        Sound {soundEnabled ? 'On' : 'Off'}
      </button>
    </div>
  );
}

export default ThemeSwitcher;
