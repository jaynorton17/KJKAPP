import { formatScore, getRoundPenalty, PLAYER_LABEL, ROUND_TYPE_LABEL } from '../utils/game.js';

function CurrentQuestionCard({ round, selectedQuestion, nextNumber }) {
  const questionText = selectedQuestion?.question || round?.question || '';
  const category = selectedQuestion?.category || round?.category || '';
  const roundType = selectedQuestion?.roundType || round?.roundType || 'numeric';

  return (
    <section className="current-question-card">
      <div className="question-card-head">
        <div>
          <p className="eyebrow">{selectedQuestion ? 'Drawn Now' : round ? 'Latest Saved' : 'Ready'}</p>
          <h2>{round ? `Round ${round.number}` : `Round ${nextNumber}`}</h2>
        </div>
        <div className="tag-stack">
          <span className="category-tag">{ROUND_TYPE_LABEL[roundType] || roundType}</span>
          {category ? <span className="category-tag">{category}</span> : null}
        </div>
      </div>

      <div className="question-card-text-wrap" role="region" aria-label="Current question">
        <p className="question-card-text">
          {questionText || 'Draw a random question from the bank or type one into Current Round.'}
        </p>
      </div>

      {round ? (
        <div className="round-verdict">
          <span>Lower This Round</span>
          <strong>{PLAYER_LABEL[round.winner]}</strong>
          <small>
            Jay +{formatScore(getRoundPenalty(round, 'jay'))} / Kim +{formatScore(getRoundPenalty(round, 'kim'))}
          </small>
        </div>
      ) : (
        <div className="round-verdict is-empty">
          <span>Flow</span>
          <strong>Draw / Enter / Save</strong>
          <small>Confirm the penalty added for each player, then save.</small>
        </div>
      )}
    </section>
  );
}

export default CurrentQuestionCard;
