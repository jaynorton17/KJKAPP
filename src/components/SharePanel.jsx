import {
  formatDateTime,
  formatScore,
  getMaskedAnswerValue,
  getRoundAnswerType,
  getRoundPenalty,
  getRoundPenaltyTotals,
  isChoiceRoundType,
  isListRoundType,
  PLAYER_LABEL,
  ROUND_TYPE_LABEL,
} from '../utils/game.js';

function RoundRevealCard({ round, captureRef }) {
  return (
    <article className="round-reveal-card" ref={captureRef} aria-label="Round reveal export card">
      {round ? (
        <>
          <div className="reveal-topline">
            <span>KJK KIMJAYKINKS</span>
            <strong>Round {round.number} / {ROUND_TYPE_LABEL[round.roundType] || round.roundType}</strong>
          </div>
          {round.category ? <span className="category-tag reveal-category">{round.category}</span> : null}
          <p className="reveal-question">{round.question}</p>
          {round.roundType === 'numeric' ? null : (
            <div className="reveal-answer-summary">
              {isListRoundType(round.roundType) ? (
                <>
                  <span>Jay answer: {round.actualList.jay.join(', ') || '-'}</span>
                  <span>Kim answer: {round.actualList.kim.join(', ') || '-'}</span>
                </>
              ) : isChoiceRoundType(round.roundType) || round.roundType === 'text' ? (
                <span>Answer: {getMaskedAnswerValue(round.actualText, getRoundAnswerType(round), round.roundType)}</span>
              ) : (
                <>
                  <span>Jay answer: {getMaskedAnswerValue(round.actualAnswers.jay, getRoundAnswerType(round), round.roundType)}</span>
                  <span>Kim answer: {getMaskedAnswerValue(round.actualAnswers.kim, getRoundAnswerType(round), round.roundType)}</span>
                </>
              )}
            </div>
          )}
          <div className="reveal-score-grid">
            <div>
              <span>Jay penalty added</span>
              <strong>{formatScore(getRoundPenalty(round, 'jay'))}</strong>
              <small>Total penalty {formatScore(getRoundPenaltyTotals(round).jay)}</small>
            </div>
            <div>
              <span>Kim penalty added</span>
              <strong>{formatScore(getRoundPenalty(round, 'kim'))}</strong>
              <small>Total penalty {formatScore(getRoundPenaltyTotals(round).kim)}</small>
            </div>
          </div>
          <div className="reveal-footer">
            <span>Lower this round: {PLAYER_LABEL[round.winner]}</span>
            <span>Lowest total: {PLAYER_LABEL[round.overallLeader]}</span>
            <time dateTime={round.createdAt}>{formatDateTime(round.createdAt)}</time>
          </div>
        </>
      ) : (
        <div className="reveal-empty">
          <span>KJK KIMJAYKINKS</span>
          <strong>No saved round yet</strong>
        </div>
      )}
    </article>
  );
}

function SharePanel({
  round,
  captureRef,
  onShareQuestion,
  onCopyRoundCard,
  onDownloadRoundCard,
  onExportAnimation,
  onCopyScoreboard,
  canShareQuestion,
  isBusy,
}) {
  return (
    <section className="panel share-panel" aria-labelledby="share-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Export / Share</p>
          <h2 id="share-title">Round Reveal</h2>
        </div>
        <span className="status-pill">PNG + WebM</span>
      </div>

      <RoundRevealCard round={round} captureRef={captureRef} />

      <div className="share-actions">
        <button type="button" className="primary-button compact" onClick={onShareQuestion} disabled={!canShareQuestion || isBusy}>
          Share Question
        </button>
        <button type="button" className="ghost-button compact" onClick={onCopyScoreboard} disabled={isBusy}>
          Copy Scoreboard Graphic
        </button>
        <button type="button" className="primary-button compact" onClick={onCopyRoundCard} disabled={!round || isBusy}>
          Copy Round Graphic
        </button>
        <button type="button" className="ghost-button compact" onClick={onDownloadRoundCard} disabled={!round || isBusy}>
          Export Round Card
        </button>
        <button type="button" className="ghost-button compact" onClick={onExportAnimation} disabled={!round || isBusy}>
          Export Round Animation
        </button>
      </div>
    </section>
  );
}

export default SharePanel;
