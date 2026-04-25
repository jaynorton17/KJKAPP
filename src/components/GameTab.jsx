import MainScoreboard16x9 from './MainScoreboard16x9.jsx';
import { formatScore, getRoundPenalty, PLAYER_LABEL, ROUND_TYPE_LABEL } from '../utils/game.js';

const roundPenalty = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;

const toPenaltyNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPenaltyText = (value) => String(roundPenalty(value));

const getPenaltyWinner = (jay, kim) => {
  if (!String(jay ?? '').trim() || !String(kim ?? '').trim()) return 'pending';
  const jayPenalty = toPenaltyNumber(jay, 0);
  const kimPenalty = toPenaltyNumber(kim, 0);
  if (jayPenalty === kimPenalty) return 'tie';
  return jayPenalty < kimPenalty ? 'jay' : 'kim';
};

const getBestRound = (rounds) =>
  rounds.reduce((best, round) => {
    const total = roundPenalty(getRoundPenalty(round, 'jay')) + roundPenalty(getRoundPenalty(round, 'kim'));
    if (!best || total < best.total || (total === best.total && round.number < best.number)) {
      return {
        round,
        total,
        number: round.number,
      };
    }
    return best;
  }, null);

function QuickRoundEntryPanel({
  rounds,
  form,
  selectedQuestion,
  editingRound,
  drawPoolCount,
  onFormChange,
  onSaveRound,
  onShareQuestion,
  onNextQuestion,
  onCancelEdit,
  canShareQuestion,
  isBusy,
}) {
  const roundNumber = editingRound?.number || rounds.length + 1;
  const currentWinner = getPenaltyWinner(form.jayScore, form.kimScore);
  const fixedPenalty = Math.max(0, toPenaltyNumber(form.fixedPenalty, 5)) || 5;
  const hasQuestion = Boolean(form.question.trim());
  const hasBothPenalties = Boolean(String(form.jayScore).trim() && String(form.kimScore).trim());
  const canSave = hasQuestion && hasBothPenalties;
  const typeLabel = ROUND_TYPE_LABEL[form.roundType] || 'Question Type';
  const modeLabel = editingRound
    ? `Editing Round ${editingRound.number}`
    : selectedQuestion
      ? 'Question live'
      : hasQuestion
        ? 'Manual question'
        : 'Waiting for next question';

  const applyPenaltyShortcut = (jay, kim) => {
    const winnerSelection = jay === kim ? 'tie' : jay < kim ? 'jay' : 'kim';
    onFormChange({
      jayScore: toPenaltyText(jay),
      kimScore: toPenaltyText(kim),
      winnerSelection,
    });
  };

  const applyWinnerShortcut = (winner) => {
    if (winner === 'jay') {
      applyPenaltyShortcut(0, fixedPenalty);
      return;
    }
    if (winner === 'kim') {
      applyPenaltyShortcut(fixedPenalty, 0);
      return;
    }
    applyPenaltyShortcut(fixedPenalty, fixedPenalty);
  };

  const resetPenalties = () =>
    onFormChange({
      jayScore: '',
      kimScore: '',
      winnerSelection: 'tie',
    });

  return (
    <section className="panel quick-round-panel" aria-labelledby="quick-round-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Quick Round Entry</p>
          <h2 id="quick-round-title">Control Desk</h2>
        </div>
        <span className="status-pill">{modeLabel}</span>
      </div>

      <div className="quick-round-meta">
        <span>Round {roundNumber}</span>
        <span>{form.category || 'No category yet'}</span>
        <span>{typeLabel}</span>
        <span>{drawPoolCount} in queue</span>
      </div>

      <div className="quick-score-fields">
        <label className="field">
          <span>Jay Penalty Added</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={form.jayScore}
            onChange={(event) => onFormChange({ jayScore: event.target.value })}
            placeholder="0"
          />
        </label>

        <label className="field">
          <span>Kim Penalty Added</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={form.kimScore}
            onChange={(event) => onFormChange({ kimScore: event.target.value })}
            placeholder="0"
          />
        </label>
      </div>

      <div className="quick-preset-stack">
        <span className="quick-section-label">Quick buttons</span>
        <div className="quick-preset-grid">
          <button type="button" className="ghost-button compact" onClick={() => applyPenaltyShortcut(0, 5)}>
            Jay +0 / Kim +5
          </button>
          <button type="button" className="ghost-button compact" onClick={() => applyPenaltyShortcut(5, 0)}>
            Jay +5 / Kim +0
          </button>
          <button type="button" className="ghost-button compact" onClick={() => applyPenaltyShortcut(0, 10)}>
            Jay +0 / Kim +10
          </button>
          <button type="button" className="ghost-button compact" onClick={() => applyPenaltyShortcut(10, 0)}>
            Jay +10 / Kim +0
          </button>
          <button type="button" className="ghost-button compact" onClick={() => applyPenaltyShortcut(5, 5)}>
            Both +5
          </button>
          <button type="button" className="ghost-button compact" onClick={() => applyPenaltyShortcut(10, 10)}>
            Both +10
          </button>
          <button type="button" className="ghost-button compact" onClick={resetPenalties}>
            Reset
          </button>
        </div>
      </div>

      <div className="quick-winner-row">
        <span className="quick-section-label">Winner selector</span>
        <div className="button-row quick-winner-buttons">
          <button
            type="button"
            className={`ghost-button compact ${currentWinner === 'jay' ? 'is-on' : ''}`}
            onClick={() => applyWinnerShortcut('jay')}
          >
            Jay Won
          </button>
          <button
            type="button"
            className={`ghost-button compact ${currentWinner === 'kim' ? 'is-on' : ''}`}
            onClick={() => applyWinnerShortcut('kim')}
          >
            Kim Won
          </button>
          <button
            type="button"
            className={`ghost-button compact ${currentWinner === 'tie' ? 'is-on' : ''}`}
            onClick={() => applyWinnerShortcut('tie')}
          >
            Draw
          </button>
        </div>
      </div>

      <div className="quick-round-actions">
        <button type="button" className="ghost-button compact" onClick={onSaveRound} disabled={!canSave}>
          Save Round
        </button>
        <button type="button" className="ghost-button compact" onClick={onShareQuestion} disabled={!canShareQuestion || isBusy}>
          Share Question
        </button>
        {editingRound ? (
          <button type="button" className="ghost-button compact" onClick={onCancelEdit}>
            Cancel Edit
          </button>
        ) : null}
      </div>

      <button type="button" className="primary-button next-question-button" onClick={onNextQuestion}>
        Next Question
      </button>

      <p className="quick-helper-copy">
        {canSave
          ? 'Next Question will save this round and immediately load another one.'
          : 'Enter penalties in seconds, then save or jump straight to the next question.'}
      </p>
    </section>
  );
}

function LiveAnalyticsPanel({ rounds, analytics, drawPoolCount }) {
  const bestRound = getBestRound(rounds);
  const bestRoundLabel = bestRound ? `R${bestRound.number}` : '-';
  const bestRoundMeta = bestRound ? `${formatScore(bestRound.total)} total combined` : 'Save rounds to track it';
  const leaderStatus = analytics.leader === 'tie' ? 'Tied' : `${PLAYER_LABEL[analytics.leader]} leading`;

  return (
    <section className="panel live-analytics-panel" aria-labelledby="live-analytics-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Live Analytics</p>
          <h2 id="live-analytics-title">Game Pulse</h2>
        </div>
        <span className="status-pill">{leaderStatus}</span>
      </div>

      <div className="live-analytics-grid">
        <article className="stat-tile">
          <span>Total Rounds</span>
          <strong>{analytics.totalRounds}</strong>
        </article>
        <article className="stat-tile">
          <span>Jay Total Penalty</span>
          <strong>{formatScore(analytics.totals.jay)}</strong>
        </article>
        <article className="stat-tile">
          <span>Kim Total Penalty</span>
          <strong>{formatScore(analytics.totals.kim)}</strong>
        </article>
        <article className="stat-tile">
          <span>Current Leader</span>
          <strong>{PLAYER_LABEL[analytics.leader]}</strong>
        </article>
        <article className="stat-tile">
          <span>Jay Average Penalty</span>
          <strong>{formatScore(analytics.averages.jay)}</strong>
        </article>
        <article className="stat-tile">
          <span>Kim Average Penalty</span>
          <strong>{formatScore(analytics.averages.kim)}</strong>
        </article>
        <article className="stat-tile stat-tile-wide">
          <span>Best Round</span>
          <strong>{bestRoundLabel}</strong>
          <small>{bestRoundMeta}</small>
        </article>
        <article className="stat-tile stat-tile-wide">
          <span>Queue Remaining</span>
          <strong>{drawPoolCount}</strong>
          <small>Ready to draw right now</small>
        </article>
      </div>
    </section>
  );
}

function GameTab({
  rounds,
  selectedQuestion,
  editingRound,
  form,
  analytics,
  drawPoolCount,
  scoreboardRef,
  onFormChange,
  onSaveRound,
  onShareQuestion,
  onNextQuestion,
  onCancelEdit,
  canShareQuestion,
  isBusy,
}) {
  return (
    <div className="game-tab-layout">
      <QuickRoundEntryPanel
        rounds={rounds}
        form={form}
        selectedQuestion={selectedQuestion}
        editingRound={editingRound}
        drawPoolCount={drawPoolCount}
        onFormChange={onFormChange}
        onSaveRound={onSaveRound}
        onShareQuestion={onShareQuestion}
        onNextQuestion={onNextQuestion}
        onCancelEdit={onCancelEdit}
        canShareQuestion={canShareQuestion}
        isBusy={isBusy}
      />

      <MainScoreboard16x9
        rounds={rounds}
        selectedQuestion={selectedQuestion}
        form={form}
        editingRound={editingRound}
        captureRef={scoreboardRef}
      />

      <LiveAnalyticsPanel rounds={rounds} analytics={analytics} drawPoolCount={drawPoolCount} />
    </div>
  );
}

export default GameTab;
