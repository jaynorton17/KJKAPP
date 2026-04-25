import { formatScore, PLAYER_LABEL } from '../utils/game.js';

const bestLabel = (round) => (round ? `R${round.number} / ${formatScore(round.score)}` : '-');

function StatsPanel({ analytics, questionCount, unusedCount }) {
  return (
    <section className="panel stats-panel" aria-labelledby="quick-stats-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Live Analytics</p>
          <h2 id="quick-stats-title">Game Pulse</h2>
        </div>
        <span className="status-pill">{PLAYER_LABEL[analytics.leader]} leading</span>
      </div>

      <div className="stats-grid compact-stats">
        <article className="stat-tile">
          <span>Rounds</span>
          <strong>{analytics.totalRounds}</strong>
        </article>
        <article className="stat-tile">
          <span>Bank</span>
          <strong>
            {unusedCount}/{questionCount}
          </strong>
        </article>
        <article className="stat-tile">
          <span>Jay Avg Penalty</span>
          <strong>{formatScore(analytics.averages.jay)}</strong>
        </article>
        <article className="stat-tile">
          <span>Kim Avg Penalty</span>
          <strong>{formatScore(analytics.averages.kim)}</strong>
        </article>
        <article className="stat-tile">
          <span>Jay Best Round</span>
          <strong>{bestLabel(analytics.bestRounds.jay)}</strong>
        </article>
        <article className="stat-tile">
          <span>Kim Best Round</span>
          <strong>{bestLabel(analytics.bestRounds.kim)}</strong>
        </article>
      </div>
    </section>
  );
}

export default StatsPanel;
