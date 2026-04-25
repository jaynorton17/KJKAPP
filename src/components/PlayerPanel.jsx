import { formatScore } from '../utils/game.js';

function PlayerPanel({ player, total, currentScore, overallLeader, roundWinner }) {
  const isLeading = overallLeader === player.id;
  const isRoundWinner = roundWinner === player.id;

  return (
    <section className={`player-panel ${isLeading ? 'is-leading' : ''}`}>
      <div className="player-panel-top">
        <div>
          <p className="eyebrow">{player.name}</p>
          <h2>{formatScore(total)}</h2>
        </div>
        <span className={`status-pill ${isLeading ? 'is-hot' : overallLeader === 'tie' ? 'is-tie' : ''}`}>
          {overallLeader === 'tie' ? 'Tie' : isLeading ? 'Leader' : 'Chasing'}
        </span>
      </div>
      <div className="player-mini-stats">
        <div>
          <span>Round Penalty</span>
          <strong className={isRoundWinner ? 'round-best' : ''}>{currentScore == null ? '-' : formatScore(currentScore)}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>Penalty</strong>
        </div>
      </div>
    </section>
  );
}

export default PlayerPanel;
