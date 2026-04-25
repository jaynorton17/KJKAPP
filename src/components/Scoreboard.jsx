import { getLeader, getRoundPenalty, getTotals, PLAYERS } from '../utils/game.js';
import CurrentQuestionCard from './CurrentQuestionCard.jsx';
import PlayerPanel from './PlayerPanel.jsx';

function Scoreboard({ rounds, selectedQuestion, captureRef }) {
  const totals = getTotals(rounds);
  const latestRound = rounds.at(-1) || null;
  const overallLeader = getLeader(totals);
  const roundWinner = latestRound?.winner || 'tie';

  return (
    <section className="scoreboard" ref={captureRef} aria-label="KJK KIMJAYKINKS scoreboard">
      <div className="scoreboard-title">
        <p className="eyebrow">Lower total wins</p>
        <h2>KJK KIMJAYKINKS</h2>
      </div>

      <div className="scoreboard-grid">
        <PlayerPanel
          player={PLAYERS[0]}
          total={totals.jay}
          currentScore={latestRound ? getRoundPenalty(latestRound, 'jay') : null}
          overallLeader={overallLeader}
          roundWinner={roundWinner}
        />
        <CurrentQuestionCard round={latestRound} selectedQuestion={selectedQuestion} nextNumber={rounds.length + 1} />
        <PlayerPanel
          player={PLAYERS[1]}
          total={totals.kim}
          currentScore={latestRound ? getRoundPenalty(latestRound, 'kim') : null}
          overallLeader={overallLeader}
          roundWinner={roundWinner}
        />
      </div>
    </section>
  );
}

export default Scoreboard;
