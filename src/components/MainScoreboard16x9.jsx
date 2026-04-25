import {
  formatDateTime,
  formatScore,
  getLeader,
  getRoundPenalty,
  getRoundPenaltyTotals,
  getTotals,
  PLAYER_LABEL,
  ROUND_TYPE_LABEL,
} from '../utils/game.js';

const getScoreLabel = (score) => (score === null || score === undefined ? 'Pending' : formatScore(score));

function ScoreLane({ player, playerId, total, roundScore, isLeader, isRoundWinner, isJoined }) {
  return (
    <article
      className={`scoreboard-lane scoreboard-lane--${playerId} ${isLeader ? 'is-leader' : ''} ${isRoundWinner ? 'is-winner' : ''}`}
    >
      <div>
        <span className="scoreboard-lane-label">
          <span className={`join-dot ${isJoined ? 'is-on' : ''}`} aria-hidden="true" />
          {player} Total Penalty
        </span>
        <strong>{formatScore(total)}</strong>
      </div>
      <small>Round Penalty {getScoreLabel(roundScore)}</small>
    </article>
  );
}

function MainScoreboard16x9({ rounds, selectedQuestion, form, editingRound, captureRef, exportMode = false, liveTotals = null, joinedSeats = {} }) {
  const latestRound = rounds.at(-1) || null;
  const inProgress = Boolean(selectedQuestion || editingRound || form?.question);
  const totals = getTotals(rounds);
  const displayRound = inProgress ? editingRound : latestRound;
  const roundNumber = editingRound?.number || (inProgress ? rounds.length + 1 : latestRound?.number || 1);
  const question = inProgress
    ? form?.question || selectedQuestion?.question || 'Question loaded'
    : latestRound?.question || 'Draw a question to start the next reveal';
  const category = inProgress ? form?.category || selectedQuestion?.category : latestRound?.category;
  const roundType = inProgress ? form?.roundType || selectedQuestion?.roundType : latestRound?.roundType;
  const roundWinner = displayRound?.winner || null;
  const overallLeader = displayRound?.overallLeader || getLeader(totals);
  const jayRoundScore = displayRound ? getRoundPenalty(displayRound, 'jay') : form?.jayScore;
  const kimRoundScore = displayRound ? getRoundPenalty(displayRound, 'kim') : form?.kimScore;
  const roundTotals = liveTotals || (displayRound ? getRoundPenaltyTotals(displayRound) : totals);
  const jayTotal = roundTotals.jay ?? totals.jay;
  const kimTotal = roundTotals.kim ?? totals.kim;
  const status = editingRound ? 'Editing round' : displayRound?.status === 'reveal' ? 'Reveal ready' : inProgress ? 'Loaded question' : latestRound ? 'Latest reveal' : 'Ready';
  const normalizedQuestion = String(question || '').replace(/\s+/g, ' ').trim();
  const questionLength = normalizedQuestion.length;
  const questionWordCount = normalizedQuestion ? normalizedQuestion.split(' ').length : 0;
  const questionDensity = questionLength > 170 || questionWordCount > 28
    ? 'is-dense'
    : questionLength > 110 || questionWordCount > 18
      ? 'is-long'
      : questionLength > 70 || questionWordCount > 12
        ? 'is-medium'
        : 'is-short';

  return (
    <section
      className={`scoreboard-16x9 ${exportMode ? 'is-export-preview' : ''}`}
      ref={captureRef}
      aria-label="16:9 KJK KIMJAYKINKS scoreboard"
    >
      <div className="scoreboard-sheen" aria-hidden="true" />
      <div className="scoreboard-stage">
        <header className="scoreboard-stage-top">
          <div>
            <span className="scoreboard-kicker">KJK KIMJAYKINKS</span>
            <h2>Round {roundNumber}</h2>
          </div>
          <div className="scoreboard-badges">
            <span className="scoreboard-mini-badge">{status}</span>
            {category ? <span className="scoreboard-mini-badge is-category">{category}</span> : null}
            {roundType ? <span className="scoreboard-mini-badge">{ROUND_TYPE_LABEL[roundType] || roundType}</span> : null}
          </div>
        </header>

        <div className={`scoreboard-question-zone ${questionDensity}`}>
          <p>{question}</p>
          <span>Lower total wins</span>
        </div>

        <div className="scoreboard-score-row">
          <ScoreLane
            player="Jay"
            playerId="jay"
            total={jayTotal}
            roundScore={jayRoundScore}
            isLeader={overallLeader === 'jay'}
            isRoundWinner={roundWinner === 'jay'}
            isJoined={Boolean(joinedSeats.jay)}
          />
          <div className="scoreboard-vs">
            <span>vs</span>
            <strong>{PLAYER_LABEL[roundWinner] || 'Pending'}</strong>
            <small>Lower This Round</small>
          </div>
          <ScoreLane
            player="Kim"
            playerId="kim"
            total={kimTotal}
            roundScore={kimRoundScore}
            isLeader={overallLeader === 'kim'}
            isRoundWinner={roundWinner === 'kim'}
            isJoined={Boolean(joinedSeats.kim)}
          />
        </div>

        <footer className="scoreboard-stage-footer">
          <span>Lowest total: {PLAYER_LABEL[overallLeader]}</span>
          <span>Jay {formatScore(jayTotal)} / Kim {formatScore(kimTotal)} total penalty</span>
          <time dateTime={displayRound?.createdAt || undefined}>
            {displayRound?.createdAt ? formatDateTime(displayRound.createdAt) : 'Awaiting saved round'}
          </time>
        </footer>
      </div>
    </section>
  );
}

export default MainScoreboard16x9;
