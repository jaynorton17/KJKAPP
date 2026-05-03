import { CATEGORY_COLOR_MAP, formatScore, PLAYER_LABEL } from '../utils/game.js';

const maxValue = (items, keys) => Math.max(1, ...items.flatMap((item) => keys.map((key) => Number(item[key] || 0))));
const formatRoundLabel = (round) => (round?.number ? `Round ${round.number}` : '-');
const formatLeaderLabel = (leader) => (!leader || leader === 'tie' ? 'All square' : `${PLAYER_LABEL[leader]} leads`);
const formatPercentLabel = (value, digits = 0) => `${Number(value || 0).toFixed(digits)}%`;
const formatGameBadge = (count) => `${count} game${count === 1 ? '' : 's'}`;
const formatStreakLabel = (streak) => {
  if (!streak?.count) return 'No streak';
  if (!streak?.winner || streak.winner === 'tie') return `Tie x${streak.count}`;
  return `${PLAYER_LABEL[streak.winner]} x${streak.count}`;
};
const getHighestScoringRound = (roundBars = []) =>
  [...roundBars].sort((a, b) => ((Number(b.jay || 0) + Number(b.kim || 0)) - (Number(a.jay || 0) + Number(a.kim || 0))) || (a.round - b.round))[0] || null;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const shortenLabel = (label, limit = 12) => (String(label || '').length > limit ? `${String(label).slice(0, limit - 3)}...` : String(label || ''));
const getAdvantageMeta = (jayValue, kimValue) => {
  const jay = Number(jayValue || 0);
  const kim = Number(kimValue || 0);
  const winner = jay === kim ? 'tie' : jay < kim ? 'jay' : 'kim';
  const loser = winner === 'jay' ? 'kim' : 'jay';
  const better = Math.round((Math.abs(jay - kim) / Math.max(jay, kim, 1)) * 100);
  return { winner, loser, better, gap: Math.abs(jay - kim) };
};

const buildWinProbability = (analytics, summary) => {
  const totalGames = Number(summary?.totalGamesPlayed || 0);
  const totalRounds = Number(summary?.totalRoundsPlayed ?? analytics?.totalRounds ?? 0);
  const jayGameShare = totalGames
    ? ((Number(summary?.jayGameWins || 0) + (Number(summary?.draws || 0) * 0.5)) / totalGames)
    : 0.5;
  const kimGameShare = totalGames
    ? ((Number(summary?.kimGameWins || 0) + (Number(summary?.draws || 0) * 0.5)) / totalGames)
    : 0.5;
  const jayRoundShare = totalRounds
    ? ((Number(summary?.jayRoundWins ?? analytics?.roundWins?.jay ?? 0) + (Number(analytics?.roundWins?.tie || 0) * 0.5)) / totalRounds)
    : 0.5;
  const kimRoundShare = totalRounds
    ? ((Number(summary?.kimRoundWins ?? analytics?.roundWins?.kim ?? 0) + (Number(analytics?.roundWins?.tie || 0) * 0.5)) / totalRounds)
    : 0.5;
  const jayRaw = totalGames ? (jayGameShare * 0.72) + (jayRoundShare * 0.28) : jayRoundShare;
  const kimRaw = totalGames ? (kimGameShare * 0.72) + (kimRoundShare * 0.28) : kimRoundShare;
  const total = jayRaw + kimRaw;
  const jay = total ? Math.round((jayRaw / total) * 100) : 50;
  return { jay, kim: 100 - jay };
};

const buildSmartInsights = (analytics, summary) => {
  const categoryEdges = (analytics?.categoryRows || [])
    .filter((row) => row.rounds)
    .map((row) => ({ ...row, ...getAdvantageMeta(row.averages?.jay, row.averages?.kim) }))
    .sort((a, b) => b.better - a.better || b.rounds - a.rounds || a.category.localeCompare(b.category));
  const roundTypeEdges = (analytics?.roundTypeRows || [])
    .filter((row) => row.rounds)
    .map((row) => ({ ...row, ...getAdvantageMeta(row.averages?.jay, row.averages?.kim) }))
    .sort((a, b) => b.better - a.better || b.rounds - a.rounds || a.label.localeCompare(b.label));
  const worstTypeEntry = (analytics?.roundTypeRows || [])
    .flatMap((row) => ([
      { player: 'jay', label: row.label, average: Number(row.averages?.jay || 0), rounds: row.rounds },
      { player: 'kim', label: row.label, average: Number(row.averages?.kim || 0), rounds: row.rounds },
    ]))
    .filter((row) => row.rounds)
    .sort((a, b) => b.average - a.average || b.rounds - a.rounds || a.label.localeCompare(b.label))[0] || null;
  const probability = buildWinProbability(analytics, summary);
  const probabilityLeader = probability.jay === probability.kim ? 'tie' : probability.jay > probability.kim ? 'jay' : 'kim';
  const dominantCategory = categoryEdges.find((row) => row.winner !== 'tie' && row.better > 0) || null;
  const dominantRoundType = roundTypeEdges.find((row) => row.winner !== 'tie' && row.better > 0) || null;
  const highestScoringRound = getHighestScoringRound(analytics?.roundBars || []);
  const items = [
    probabilityLeader !== 'tie'
      ? `Model gives ${PLAYER_LABEL[probabilityLeader]} ${formatPercentLabel(Math.max(probability.jay, probability.kim))} win probability on current form.`
      : 'Model reads the rivalry as effectively level on current form.',
    dominantCategory
      ? `${PLAYER_LABEL[dominantCategory.winner]} performs ${dominantCategory.better}% better in ${dominantCategory.category}.`
      : '',
    worstTypeEntry && worstTypeEntry.average
      ? `${PLAYER_LABEL[worstTypeEntry.player]} loses most points on ${worstTypeEntry.label}.`
      : '',
    dominantRoundType && dominantRoundType.label !== worstTypeEntry?.label
      ? `${dominantRoundType.label} strongly favours ${PLAYER_LABEL[dominantRoundType.winner]}.`
      : '',
    analytics?.closestCategory && analytics.closestCategory !== '-'
      ? `Closest category is ${analytics.closestCategory}.`
      : '',
    highestScoringRound
      ? `Round ${highestScoringRound.round} produced the biggest combined penalty spike.`
      : '',
  ].filter(Boolean);

  const deduped = [];
  const seen = new Set();
  items.forEach((item) => {
    if (seen.has(item)) return;
    seen.add(item);
    deduped.push(item);
  });

  return deduped.length ? deduped.slice(0, 5) : (analytics?.insights || []).slice(0, 5);
};

function PlayerLegend({ className = '' }) {
  return (
    <div className={`chart-legend ${className}`.trim()} role="note" aria-label="Jay and Kim chart legend">
      <span className="legend-item legend-item--jay">
        <span className="legend-swatch" />
        Jay
      </span>
      <span className="legend-item legend-item--kim">
        <span className="legend-swatch" />
        Kim
      </span>
    </div>
  );
}

function PlayerPair({ jay, kim, className = '' }) {
  return (
    <span className={`analytics-player-pair ${className}`.trim()}>
      <span className="analytics-player-tag analytics-player-tag--jay">{jay}</span>
      <span className="analytics-player-tag analytics-player-tag--kim">{kim}</span>
    </span>
  );
}

function DualValue({ jayLabel = 'Jay', jayValue, kimLabel = 'Kim', kimValue, compact = false }) {
  return (
    <div className={`analytics-dual-value ${compact ? 'is-compact' : ''}`.trim()}>
      <span className="analytics-dual-value-item analytics-dual-value-item--jay">
        <small>{jayLabel}</small>
        <strong>{jayValue}</strong>
      </span>
      <span className="analytics-dual-value-item analytics-dual-value-item--kim">
        <small>{kimLabel}</small>
        <strong>{kimValue}</strong>
      </span>
    </div>
  );
}

function LineChart({ data }) {
  if (!data.length) return <p className="empty-copy">Play rounds to draw the cumulative penalty chart.</p>;

  const width = 720;
  const height = 220;
  const padding = 28;
  const max = maxValue(data, ['jay', 'kim']);
  const getPoint = (item, index, key) => {
    const x = padding + (data.length === 1 ? 0 : (index / (data.length - 1)) * (width - padding * 2));
    const y = height - padding - (Number(item[key]) / max) * (height - padding * 2);
    return { x, y };
  };

  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cumulative penalty over time">
      <polyline
        points={data.map((item, index) => {
          const point = getPoint(item, index, 'jay');
          return `${point.x},${point.y}`;
        }).join(' ')}
        className="line-jay"
      />
      <polyline
        points={data.map((item, index) => {
          const point = getPoint(item, index, 'kim');
          return `${point.x},${point.y}`;
        }).join(' ')}
        className="line-kim"
      />
      {data.map((item, index) => {
        const jayPoint = getPoint(item, index, 'jay');
        const kimPoint = getPoint(item, index, 'kim');
        return (
          <g key={item.eventId || `${item.round}-${index}`}>
            <circle cx={jayPoint.x} cy={jayPoint.y} r="4.5" className="dot-jay" />
            <rect x={kimPoint.x - 4.5} y={kimPoint.y - 4.5} width="9" height="9" rx="2.5" className="dot-kim" />
          </g>
        );
      })}
    </svg>
  );
}

function RoundBars({ data }) {
  if (!data.length) return <p className="empty-copy">Per-round penalties appear after the first saved round.</p>;
  const visible = data.slice(-14);
  const max = maxValue(visible, ['jay', 'kim']);
  return (
    <div className="bar-chart" role="img" aria-label="Per-round penalty bar chart">
      {visible.map((round) => (
        <div className="bar-group" key={round.round}>
          <div className="bars">
            <span className="bar jay" style={{ height: `${Math.max(6, (round.jay / max) * 100)}%` }} title={`Jay ${round.jay}`} />
            <span className="bar kim" style={{ height: `${Math.max(6, (round.kim / max) * 100)}%` }} title={`Kim ${round.kim}`} />
          </div>
          <small>R{round.round}</small>
        </div>
      ))}
    </div>
  );
}

function CategoryPerformance({ rows, categoryColorMap = CATEGORY_COLOR_MAP }) {
  if (!rows.length) return <p className="empty-copy">Category performance needs categorised rounds.</p>;
  return (
    <div className="category-chart">
      {rows.slice(0, 8).map((row) => {
        const max = Math.max(1, row.averages.jay, row.averages.kim);
        return (
          <div className="category-row" key={row.category}>
            <div>
              <strong><span className="category-swatch" style={{ background: categoryColorMap?.[row.category] || '#ffffff' }} />{row.category}</strong>
              <span>{row.rounds} rounds / {PLAYER_LABEL[row.winner]} lower</span>
            </div>
            <div className="category-bars">
              <span style={{ width: `${(row.averages.jay / max) * 100}%` }}>Jay {formatScore(row.averages.jay)}</span>
              <span style={{ width: `${(row.averages.kim / max) * 100}%` }}>Kim {formatScore(row.averages.kim)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategoryDistribution({ rows, categoryColorMap = CATEGORY_COLOR_MAP }) {
  if (!rows.length) return <p className="empty-copy">Rounds by category appears after play.</p>;
  const max = Math.max(1, ...rows.map((row) => row.rounds));
  return (
    <div className="category-distribution">
      {rows.slice(0, 10).map((row) => (
        <div className="category-dist-row" key={row.category}>
          <span>{row.category}</span>
          <strong style={{ width: `${Math.max(8, (row.rounds / max) * 100)}%`, background: categoryColorMap?.[row.category] || '#ffffff' }}>
            {row.rounds}
          </strong>
        </div>
      ))}
    </div>
  );
}

function RoundTypeUsage({ rows }) {
  if (!rows.length) return <p className="empty-copy">Round type usage appears after play.</p>;
  const max = Math.max(1, ...rows.map((row) => row.rounds));
  return (
    <div className="round-type-usage">
      {rows.map((row) => (
        <div className="round-type-row" key={row.roundType}>
          <span>{row.label}</span>
          <strong style={{ width: `${Math.max(8, (row.rounds / max) * 100)}%` }}>{row.rounds}</strong>
          <small>
            <PlayerPair jay={`Jay ${formatScore(row.averages.jay)}`} kim={`Kim ${formatScore(row.averages.kim)}`} />
          </small>
        </div>
      ))}
    </div>
  );
}

function CategoryLeaderboard({ rows }) {
  if (!rows.length) return <p className="empty-copy">Category leaderboard needs played rounds.</p>;
  return (
    <div className="category-leaderboard">
      {rows.slice(0, 8).map((row) => (
        <div className="leaderboard-row" key={row.category}>
          <strong>{row.category}</strong>
          <span>{PLAYER_LABEL[row.winner]}</span>
          <small>
            <PlayerPair jay={`Jay ${formatScore(row.winRate.jay)}%`} kim={`Kim ${formatScore(row.winRate.kim)}%`} />
          </small>
        </div>
      ))}
    </div>
  );
}

function CategoryRoundTypeHeatmap({ rows, categoryColorMap = CATEGORY_COLOR_MAP }) {
  if (!rows.length) return <p className="empty-copy">Category vs round type heatmap appears after play.</p>;
  const max = Math.max(1, ...rows.map((row) => row.rounds));
  return (
    <div className="heatmap-grid">
      {rows.slice(0, 18).map((row) => (
        <div
          className="heatmap-cell"
          key={`${row.category}-${row.roundType}`}
          style={{
            '--heat': Math.max(0.18, row.rounds / max),
            '--heat-color': categoryColorMap?.[row.category] || '#ffffff',
          }}
        >
          <span>{row.category}</span>
          <strong>{row.label}</strong>
          <small>
            {row.rounds} / J {formatScore(row.averages.jay)} / K {formatScore(row.averages.kim)}
          </small>
        </div>
      ))}
    </div>
  );
}

function CategoryTrend({ rows, categoryColorMap = CATEGORY_COLOR_MAP }) {
  if (!rows.length) return <p className="empty-copy">Category trend appears after played rounds.</p>;
  return (
    <div className="category-trend">
      {rows.slice(-28).map((row) => (
        <span
          className={`trend-dot ${row.winner}`}
          key={row.round}
          style={{ background: categoryColorMap?.[row.category] || '#ffffff' }}
          title={`R${row.round}: ${row.category}, ${PLAYER_LABEL[row.winner]}`}
        >
          {row.round}
        </span>
      ))}
    </div>
  );
}

function Distribution({ distribution }) {
  const labels = [
    ['zero', '0'],
    ['low', '1-3'],
    ['mid', '4-10'],
    ['high', '11+'],
  ];

  return (
    <div className="distribution-grid">
      {labels.map(([key, label]) => (
        <div className="distribution-row" key={key}>
          <span>{label}</span>
          <PlayerPair className="distribution-pair" jay={`Jay ${distribution.jay[key]}`} kim={`Kim ${distribution.kim[key]}`} />
        </div>
      ))}
    </div>
  );
}

function DashboardSectionHeader({ eyebrow, title, copy = '' }) {
  return (
    <div className="analytics-section-heading">
      <span>{eyebrow}</span>
      <h3>{title}</h3>
      {copy ? <p>{copy}</p> : null}
    </div>
  );
}

function CategoryWinsComparison({ rows, categoryColorMap = CATEGORY_COLOR_MAP }) {
  const visibleRows = [...rows]
    .filter((row) => row.rounds)
    .sort((a, b) => b.rounds - a.rounds || ((b.wins.jay + b.wins.kim) - (a.wins.jay + a.wins.kim)) || a.category.localeCompare(b.category))
    .slice(0, 5);

  if (!visibleRows.length) return <p className="empty-copy">Category win splits appear once completed rounds build up.</p>;

  const maxWins = Math.max(1, ...visibleRows.flatMap((row) => [row.wins.jay, row.wins.kim]));

  return (
    <div className="analytics-category-battle">
      {visibleRows.map((row) => (
        <article className="analytics-category-battle-row" key={row.category}>
          <div className="analytics-category-battle-head">
            <strong><span className="category-swatch" style={{ background: categoryColorMap?.[row.category] || '#ffffff' }} />{row.category}</strong>
            <span>{row.rounds} rounds</span>
          </div>
          <div className="analytics-category-battle-bars">
            <div className="analytics-category-battle-lane">
              <span className="analytics-category-battle-label">Jay</span>
              <div className="analytics-category-battle-track">
                <div className="analytics-category-battle-fill analytics-category-battle-fill--jay" style={{ width: `${row.wins.jay ? Math.max(12, (row.wins.jay / maxWins) * 100) : 0}%` }}>
                  {row.wins.jay}
                </div>
              </div>
            </div>
            <div className="analytics-category-battle-lane">
              <span className="analytics-category-battle-label">Kim</span>
              <div className="analytics-category-battle-track">
                <div className="analytics-category-battle-fill analytics-category-battle-fill--kim" style={{ width: `${row.wins.kim ? Math.max(12, (row.wins.kim / maxWins) * 100) : 0}%` }}>
                  {row.wins.kim}
                </div>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function CompactPairStat({ jayValue, kimValue }) {
  return (
    <div className="analytics-inline-pair">
      <span className="analytics-inline-pair-item analytics-inline-pair-item--jay">
        <small>Jay</small>
        <strong>{jayValue}</strong>
      </span>
      <span className="analytics-inline-pair-item analytics-inline-pair-item--kim">
        <small>Kim</small>
        <strong>{kimValue}</strong>
      </span>
    </div>
  );
}

function ProbabilityMeter({ analytics, summary }) {
  const probability = buildWinProbability(analytics, summary);
  return (
    <article className="analytics-cockpit-card analytics-cockpit-card--prob">
      <div className="analytics-cockpit-head">
        <span className="analytics-cockpit-label">Win Probability</span>
        <span className="analytics-cockpit-meta">Blended from games and rounds</span>
      </div>
      <div className="analytics-probability-values">
        <div>
          <small>Jay</small>
          <strong>{formatPercentLabel(probability.jay)}</strong>
        </div>
        <div>
          <small>Kim</small>
          <strong>{formatPercentLabel(probability.kim)}</strong>
        </div>
      </div>
      <div className="analytics-probability-track" aria-hidden="true">
        <span className="analytics-probability-fill analytics-probability-fill--jay" style={{ width: `${probability.jay}%` }} />
        <span className="analytics-probability-fill analytics-probability-fill--kim" style={{ width: `${probability.kim}%` }} />
      </div>
    </article>
  );
}

function RadarChartCompact({ rows, categoryColorMap = CATEGORY_COLOR_MAP }) {
  const visibleRows = [...rows].filter((row) => row.rounds).slice(0, 6);
  if (!visibleRows.length) return <p className="empty-copy">Play more rounds to map category radar.</p>;

  const width = 320;
  const height = 220;
  const centerX = 148;
  const centerY = 108;
  const radius = 78;
  const maxAverage = Math.max(1, ...visibleRows.flatMap((row) => [Number(row.averages?.jay || 0), Number(row.averages?.kim || 0)]));
  const axes = visibleRows.map((row, index) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / visibleRows.length);
    const scale = (value) => clamp(0.16 + ((1 - (Number(value || 0) / maxAverage)) * 0.84), 0.16, 1);
    return {
      ...row,
      angle,
      jayValue: scale(row.averages?.jay),
      kimValue: scale(row.averages?.kim),
      label: shortenLabel(row.category, 11),
      anchor: Math.cos(angle) > 0.28 ? 'start' : Math.cos(angle) < -0.28 ? 'end' : 'middle',
    };
  });
  const buildRingPoints = (level) =>
    axes.map((axis) => `${centerX + (Math.cos(axis.angle) * radius * level)},${centerY + (Math.sin(axis.angle) * radius * level)}`).join(' ');
  const buildShapePoints = (key) =>
    axes.map((axis) => `${centerX + (Math.cos(axis.angle) * radius * axis[key])},${centerY + (Math.sin(axis.angle) * radius * axis[key])}`).join(' ');

  return (
    <div className="analytics-radar-shell">
      <svg className="analytics-radar-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Category radar chart">
        {[0.25, 0.5, 0.75, 1].map((level) => (
          <polygon className="analytics-radar-ring" key={level} points={buildRingPoints(level)} />
        ))}
        {axes.map((axis) => (
          <line
            className="analytics-radar-axis"
            key={`${axis.category}-axis`}
            x1={centerX}
            y1={centerY}
            x2={centerX + (Math.cos(axis.angle) * radius)}
            y2={centerY + (Math.sin(axis.angle) * radius)}
          />
        ))}
        <polygon className="analytics-radar-shape analytics-radar-shape--jay" points={buildShapePoints('jayValue')} />
        <polygon className="analytics-radar-shape analytics-radar-shape--kim" points={buildShapePoints('kimValue')} />
        {axes.map((axis) => (
          <g key={axis.category}>
            <circle
              className="analytics-radar-point analytics-radar-point--jay"
              cx={centerX + (Math.cos(axis.angle) * radius * axis.jayValue)}
              cy={centerY + (Math.sin(axis.angle) * radius * axis.jayValue)}
              r="3.6"
            />
            <circle
              className="analytics-radar-point analytics-radar-point--kim"
              cx={centerX + (Math.cos(axis.angle) * radius * axis.kimValue)}
              cy={centerY + (Math.sin(axis.angle) * radius * axis.kimValue)}
              r="3.6"
            />
            <text
              className="analytics-radar-label"
              x={centerX + (Math.cos(axis.angle) * (radius + 16))}
              y={centerY + (Math.sin(axis.angle) * (radius + 16))}
              textAnchor={axis.anchor}
            >
              {axis.label}
            </text>
          </g>
        ))}
      </svg>
      <PlayerLegend className="analytics-cockpit-legend" />
    </div>
  );
}

function RoundTypeDonut({ rows }) {
  const palette = ['#69b6ff', '#ff6f7d', '#7cf3d1', '#ffd56e', '#a788ff', '#ff9f68'];
  const visibleRows = [...rows].filter((row) => row.rounds).slice(0, 6);
  if (!visibleRows.length) return <p className="empty-copy">Question type usage appears once rounds are logged.</p>;

  const total = visibleRows.reduce((sum, row) => sum + Number(row.rounds || 0), 0) || 1;
  let cursor = 0;
  const segments = visibleRows.map((row, index) => {
    const start = (cursor / total) * 360;
    cursor += Number(row.rounds || 0);
    const end = (cursor / total) * 360;
    return { ...row, color: palette[index % palette.length], start, end };
  });

  return (
    <div className="analytics-donut-shell">
      <div className="analytics-donut-chart" style={{ background: `conic-gradient(${segments.map((segment) => `${segment.color} ${segment.start}deg ${segment.end}deg`).join(', ')})` }}>
        <div className="analytics-donut-hole">
          <small>Types</small>
          <strong>{total}</strong>
        </div>
      </div>
      <div className="analytics-donut-legend">
        {segments.map((segment) => (
          <div className="analytics-donut-legend-item" key={segment.label}>
            <span className="analytics-donut-swatch" style={{ background: segment.color }} />
            <span>{segment.label}</span>
            <strong>{segment.rounds}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactHeatmap({ rows, categoryColorMap = CATEGORY_COLOR_MAP }) {
  const visibleRows = [...rows].filter((row) => row.rounds).slice(0, 9);
  if (!visibleRows.length) return <p className="empty-copy">Category heatmap appears after played rounds.</p>;
  const max = Math.max(1, ...visibleRows.map((row) => Number(row.rounds || 0)));
  return (
    <div className="analytics-heatmap-compact">
      {visibleRows.map((row) => (
        <article
          className="analytics-heatmap-compact-cell"
          key={`${row.category}-${row.roundType}`}
          style={{
            '--heat': Math.max(0.18, Number(row.rounds || 0) / max),
            '--heat-color': categoryColorMap?.[row.category] || '#69b6ff',
          }}
        >
          <span>{shortenLabel(row.category, 13)}</span>
          <strong>{shortenLabel(row.label, 14)}</strong>
          <small>{row.rounds} rounds</small>
        </article>
      ))}
    </div>
  );
}

function RecentRoundsLog({ rows }) {
  const visibleRows = [...rows].slice(-8).reverse();
  if (!visibleRows.length) return <p className="empty-copy">Recent round activity appears once rounds are logged.</p>;
  return (
    <div className="analytics-round-log">
      {visibleRows.map((row) => (
        <article className="analytics-round-log-row" key={row.round}>
          <span className={`analytics-round-winner-chip analytics-round-winner-chip--${row.winner}`}>
            {row.winner === 'jay' ? 'J' : row.winner === 'kim' ? 'K' : 'T'}
          </span>
          <div className="analytics-round-log-main">
            <strong>Round {row.round}</strong>
            <span>{row.category || 'Uncategorised'}</span>
          </div>
          <div className="analytics-round-log-metric">
            <small>J {formatScore(row.jay || 0)}</small>
            <small>K {formatScore(row.kim || 0)}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

function GameModeScoreboard({ rows = [] }) {
  if (!rows.length) return <p className="empty-copy">Completed game scores appear once matches finish.</p>;

  return (
    <div className="analytics-mode-scoreboard">
      {rows.map((row) => (
        <article className="analytics-mode-score-row" key={row.id || row.label}>
          <div className="analytics-mode-score-head">
            <strong>{row.label}</strong>
            {row.ties ? <span>{row.ties} {row.ties === 1 ? 'tie' : 'ties'}</span> : null}
          </div>
          <div className="analytics-mode-score-values" aria-label={`${row.label} wins`}>
            <span className="analytics-mode-score-chip analytics-mode-score-chip--jay">
              <small>Jay</small>
              <strong>{row.jayWins}</strong>
            </span>
            <span className="analytics-mode-score-divider" aria-hidden="true">-</span>
            <span className="analytics-mode-score-chip analytics-mode-score-chip--kim">
              <small>Kim</small>
              <strong>{row.kimWins}</strong>
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function AnalyticsPanel({ analytics, categoryColorMap = CATEGORY_COLOR_MAP, variant = 'default', summary = null }) {
  const highestScoringRound = getHighestScoringRound(analytics.roundBars || []);

  if (variant === 'summary') {
    const smartInsights = buildSmartInsights(analytics, summary);
    const probability = buildWinProbability(analytics, summary);
    const probabilityLeader = probability.jay === probability.kim ? 'tie' : probability.jay > probability.kim ? 'jay' : 'kim';
    const currentStreakLabel = formatStreakLabel(analytics.currentStreak);
    const longestStreakLabel = formatStreakLabel(analytics.longestWinningStreak);

    return (
      <div className="analytics-summary-panel">
        <div className="analytics-summary-grid">
          <article className="analytics-summary-card analytics-summary-card--metric">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Projected edge</span>
              <span className="analytics-summary-meta">
                {probabilityLeader === 'tie' ? 'Current form is level' : `${PLAYER_LABEL[probabilityLeader]} trends ahead`}
              </span>
            </div>
            <div className="analytics-summary-probability-values">
              <div>
                <small>Jay</small>
                <strong>{formatPercentLabel(probability.jay)}</strong>
              </div>
              <div>
                <small>Kim</small>
                <strong>{formatPercentLabel(probability.kim)}</strong>
              </div>
            </div>
            <div className="analytics-summary-track" aria-hidden="true">
              <span className="analytics-summary-track-fill analytics-summary-track-fill--jay" style={{ width: `${probability.jay}%` }} />
              <span className="analytics-summary-track-fill analytics-summary-track-fill--kim" style={{ width: `${probability.kim}%` }} />
            </div>
          </article>

          <article className="analytics-summary-card analytics-summary-card--metric">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Final penalties</span>
              <span className="analytics-summary-meta">{analytics.totalRounds || 0} rounds logged</span>
            </div>
            <CompactPairStat
              jayValue={formatScore(analytics.totals?.jay || 0)}
              kimValue={formatScore(analytics.totals?.kim || 0)}
            />
          </article>

          <article className="analytics-summary-card analytics-summary-card--metric">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Questions used</span>
              <span className="analytics-summary-meta">{analytics.favouriteRoundType || 'No dominant type'}</span>
            </div>
            <strong className="analytics-summary-value">{analytics.totalRounds || 0}</strong>
            <small className="analytics-summary-note">Most common category: {analytics.mostCommonCategory || 'No data yet'}</small>
          </article>

          <article className="analytics-summary-card analytics-summary-card--metric">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Streaks</span>
              <span className="analytics-summary-meta">Momentum snapshot</span>
            </div>
            <strong className="analytics-summary-value">{currentStreakLabel}</strong>
            <small className="analytics-summary-note">Longest run: {longestStreakLabel}</small>
          </article>

          <article className="analytics-summary-card analytics-summary-card--metric">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Key swings</span>
              <span className="analytics-summary-meta">{highestScoringRound ? `${formatRoundLabel(highestScoringRound)} biggest spike` : 'No spike yet'}</span>
            </div>
            <div className="analytics-summary-stack">
              <small>Closest round: {analytics.closestRound ? formatRoundLabel(analytics.closestRound) : 'No data yet'}</small>
              <small>Biggest blowout: {analytics.biggestBlowoutRound ? formatRoundLabel(analytics.biggestBlowoutRound) : 'No data yet'}</small>
            </div>
          </article>

          <article className="analytics-summary-card analytics-summary-card--wide">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Penalty progression</span>
              <span className="analytics-summary-meta">Cumulative by round</span>
            </div>
            <LineChart data={analytics.cumulativeSeries || []} />
            <PlayerLegend className="analytics-summary-legend" />
          </article>

          <article className="analytics-summary-card analytics-summary-card--wide">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Category battle</span>
              <span className="analytics-summary-meta">Who controlled each lane</span>
            </div>
            <CategoryWinsComparison rows={analytics.categoryRows || []} categoryColorMap={categoryColorMap} />
          </article>

          <article className="analytics-summary-card">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Question types</span>
              <span className="analytics-summary-meta">{analytics.favouriteRoundType || 'No dominant type'}</span>
            </div>
            <RoundTypeDonut rows={analytics.roundTypeRows || []} />
          </article>

          <article className="analytics-summary-card">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Category heatmap</span>
              <span className="analytics-summary-meta">Category x type usage</span>
            </div>
            <CompactHeatmap rows={analytics.categoryRoundTypeRows || []} categoryColorMap={categoryColorMap} />
          </article>

          <article className="analytics-summary-card">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Recent rounds</span>
              <span className="analytics-summary-meta">{highestScoringRound ? `${formatRoundLabel(highestScoringRound)} peaked` : 'No rounds yet'}</span>
            </div>
            <RecentRoundsLog rows={analytics.categoryTrend || []} />
          </article>

          <article className="analytics-summary-card analytics-summary-card--wide">
            <div className="analytics-summary-head">
              <span className="analytics-summary-label">Smart insights</span>
              <span className="analytics-summary-meta">Auto-generated from the saved match</span>
            </div>
            <div className="analytics-summary-insights">
              {smartInsights.length ? (
                smartInsights.map((insight) => (
                  <article className="analytics-summary-insight" key={insight}>
                    {insight}
                  </article>
                ))
              ) : (
                <p className="empty-copy">No data yet.</p>
              )}
            </div>
          </article>
        </div>
      </div>
    );
  }

  if (variant === 'dashboard') {
    const smartInsights = buildSmartInsights(analytics, summary);
    const totalPenalty = {
      jay: Number.isFinite(Number(summary?.lifetimeJayBalance)) ? Number(summary.lifetimeJayBalance) : Number(analytics.totals?.jay || 0),
      kim: Number.isFinite(Number(summary?.lifetimeKimBalance)) ? Number(summary.lifetimeKimBalance) : Number(analytics.totals?.kim || 0),
    };
    const gameLeaderLabel = (() => {
      const jayWins = Number(summary?.jayGameWins || 0);
      const kimWins = Number(summary?.kimGameWins || 0);
      if (jayWins === kimWins) return formatLeaderLabel(analytics.leader);
      const leader = jayWins > kimWins ? 'jay' : 'kim';
      const margin = Math.abs(jayWins - kimWins);
      return `${PLAYER_LABEL[leader]} by ${margin} game${margin === 1 ? '' : 's'}`;
    })();

    return (
      <div className="analytics-cockpit">
        <div className="analytics-cockpit-grid">
          <ProbabilityMeter analytics={analytics} summary={summary} />

          <article className="analytics-cockpit-card analytics-cockpit-card--leader">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">Current Leader</span>
              <span className="analytics-cockpit-meta">{analytics.leaderboardSummary}</span>
            </div>
            <strong className="analytics-cockpit-value">{gameLeaderLabel}</strong>
            <small className="analytics-cockpit-subvalue">{formatLeaderLabel(analytics.leader)} on penalties</small>
          </article>

          <article className="analytics-cockpit-card analytics-cockpit-card--penalty">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">Global Penalty</span>
              <span className="analytics-cockpit-meta">Current balance</span>
            </div>
            <CompactPairStat
              jayValue={formatScore(totalPenalty.jay)}
              kimValue={formatScore(totalPenalty.kim)}
            />
          </article>

          <article className="analytics-cockpit-card analytics-cockpit-card--streak">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">Streak</span>
              <span className="analytics-cockpit-meta">Current run</span>
            </div>
            <strong className="analytics-cockpit-value">{summary?.currentStreakLabel || formatStreakLabel(analytics.currentStreak)}</strong>
            <small className="analytics-cockpit-subvalue">Longest {summary?.longestStreakLabel || formatStreakLabel(analytics.longestWinningStreak)}</small>
          </article>

          <article className="analytics-cockpit-card analytics-cockpit-card--questions">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">Questions Used</span>
              <span className="analytics-cockpit-meta">{formatGameBadge(Number(summary?.totalGamesPlayed || 0))}</span>
            </div>
            <strong className="analytics-cockpit-value">{summary?.totalQuestionsUsed ?? analytics.totalRounds ?? 0}</strong>
            <small className="analytics-cockpit-subvalue">Most common {analytics.mostCommonCategory || '-'}</small>
          </article>

          <article className="analytics-cockpit-card analytics-cockpit-card--mode-scores">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">Game Scores</span>
              <span className="analytics-cockpit-meta">Wins by game mode</span>
            </div>
            <GameModeScoreboard rows={summary?.gameModeScoreRows || []} />
          </article>

          <article className="analytics-cockpit-card analytics-cockpit-card--trend">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">Penalty Progression</span>
              <span className="analytics-cockpit-meta">Cumulative trend by round</span>
            </div>
            <LineChart data={analytics.cumulativeSeries || []} />
            <PlayerLegend className="analytics-cockpit-legend analytics-cockpit-legend--footer" />
          </article>

          <article className="analytics-cockpit-card analytics-cockpit-card--radar">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">Category Radar</span>
              <span className="analytics-cockpit-meta">Top categories by volume</span>
            </div>
            <RadarChartCompact rows={analytics.categoryRows || []} categoryColorMap={categoryColorMap} />
          </article>

          <article className="analytics-cockpit-card analytics-cockpit-card--donut">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">Question Types</span>
              <span className="analytics-cockpit-meta">{analytics.favouriteRoundType || 'No dominant type'}</span>
            </div>
            <RoundTypeDonut rows={analytics.roundTypeRows || []} />
          </article>

          <article className="analytics-cockpit-card analytics-cockpit-card--heatmap">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">Category Heatmap</span>
              <span className="analytics-cockpit-meta">Category x type usage</span>
            </div>
            <CompactHeatmap rows={analytics.categoryRoundTypeRows || []} categoryColorMap={categoryColorMap} />
          </article>

          <article className="analytics-cockpit-card analytics-cockpit-card--timeline">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">Recent Rounds</span>
              <span className="analytics-cockpit-meta">{highestScoringRound ? `Spike Round ${highestScoringRound.round}` : 'No spikes yet'}</span>
            </div>
            <RecentRoundsLog rows={analytics.categoryTrend || []} />
          </article>

          <article className="analytics-cockpit-card analytics-cockpit-card--insights">
            <div className="analytics-cockpit-head">
              <span className="analytics-cockpit-label">AI Insights</span>
              <span className="analytics-cockpit-meta">Auto-generated readout</span>
            </div>
            <div className="analytics-smart-insights">
              {smartInsights.map((insight) => (
                <article className="analytics-smart-insight" key={insight}>
                  {insight}
                </article>
              ))}
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <section className="panel analytics-panel" aria-labelledby="analytics-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Deep Stats</p>
          <h2 id="analytics-title">Analytics Dashboard</h2>
        </div>
        <span className="status-pill">{analytics.leader === 'tie' ? 'All square' : `${PLAYER_LABEL[analytics.leader]} leads`}</span>
      </div>

      <div className="analytics-kpis">
        <article className="stat-tile">
          <span>Total rounds</span>
          <strong>{analytics.totalRounds}</strong>
        </article>
        <article className="stat-tile">
          <span>Jay total penalty</span>
          <strong>{formatScore(analytics.totals.jay)}</strong>
        </article>
        <article className="stat-tile">
          <span>Kim total penalty</span>
          <strong>{formatScore(analytics.totals.kim)}</strong>
        </article>
        <article className="stat-tile">
          <span>Most common category</span>
          <strong>{analytics.mostCommonCategory}</strong>
        </article>
        <article className="stat-tile">
          <span>Closest round</span>
          <strong>{analytics.closestRound ? `R${analytics.closestRound.number}` : '-'}</strong>
        </article>
        <article className="stat-tile">
          <span>Biggest blowout</span>
          <strong>{analytics.biggestBlowoutRound ? `R${analytics.biggestBlowoutRound.number}` : '-'}</strong>
        </article>
        <article className="stat-tile">
          <span>Current streak</span>
          <strong>
            {PLAYER_LABEL[analytics.currentStreak.winner]} {analytics.currentStreak.count}
          </strong>
        </article>
        <article className="stat-tile">
          <span>Longest streak</span>
          <strong>
            {PLAYER_LABEL[analytics.longestWinningStreak.winner]} {analytics.longestWinningStreak.count}
          </strong>
        </article>
        <article className="stat-tile">
          <span>Jay best category</span>
          <strong>{analytics.bestCategory.jay}</strong>
        </article>
        <article className="stat-tile">
          <span>Kim best category</span>
          <strong>{analytics.bestCategory.kim}</strong>
        </article>
        <article className="stat-tile">
          <span>Jay worst category</span>
          <strong>{analytics.worstCategory.jay}</strong>
        </article>
        <article className="stat-tile">
          <span>Kim worst category</span>
          <strong>{analytics.worstCategory.kim}</strong>
        </article>
        <article className="stat-tile">
          <span>Favourite round type</span>
          <strong>{analytics.favouriteRoundType}</strong>
        </article>
        <article className="stat-tile">
          <span>Most competitive</span>
          <strong>{analytics.mostCompetitiveCategory}</strong>
        </article>
        <article className="stat-tile">
          <span>Most one-sided</span>
          <strong>{analytics.mostOneSidedCategory}</strong>
        </article>
        <article className="stat-tile">
          <span>Lower rounds won</span>
          <strong>J {analytics.roundWins.jay} / K {analytics.roundWins.kim}</strong>
        </article>
      </div>

      <div className="analytics-grid">
        <article className="chart-panel chart-wide">
          <div className="chart-head">
            <div className="mini-heading">
              <h3>Cumulative Penalty Over Time</h3>
              <span>Lower line is better</span>
            </div>
            <PlayerLegend className="chart-legend--inline" />
          </div>
          <LineChart data={analytics.cumulativeSeries} />
        </article>

        <article className="chart-panel">
          <div className="chart-head">
            <div className="mini-heading">
              <h3>Per-Round Penalties</h3>
              <span>Last 14 rounds</span>
            </div>
            <PlayerLegend className="chart-legend--inline" />
          </div>
          <RoundBars data={analytics.roundBars} />
        </article>

        <article className="chart-panel">
          <div className="mini-heading">
            <h3>Penalty Distribution</h3>
            <span>Round penalty bands</span>
          </div>
          <Distribution distribution={analytics.distribution} />
        </article>

        <article className="chart-panel chart-wide">
          <div className="chart-head">
            <div className="mini-heading">
              <h3>Average Penalty By Category</h3>
              <span>Lower average is better</span>
            </div>
            <PlayerLegend className="chart-legend--inline" />
          </div>
          <CategoryPerformance rows={analytics.categoryRows} categoryColorMap={categoryColorMap} />
        </article>

        <article className="chart-panel">
          <div className="mini-heading">
            <h3>Rounds By Category</h3>
            <span>Distribution</span>
          </div>
          <CategoryDistribution rows={analytics.categoryRows} categoryColorMap={categoryColorMap} />
        </article>

        <article className="chart-panel">
          <div className="mini-heading">
            <h3>Round Type Usage</h3>
            <span>With average penalties</span>
          </div>
          <RoundTypeUsage rows={analytics.roundTypeRows} />
        </article>

        <article className="chart-panel">
          <div className="mini-heading">
            <h3>Category Leaderboard</h3>
            <span>Win rate by category</span>
          </div>
          <CategoryLeaderboard rows={analytics.categoryLeaderboard} />
        </article>

        <article className="chart-panel chart-wide">
          <div className="mini-heading">
            <h3>Category Trend</h3>
            <span>Recent rounds by category</span>
          </div>
          <CategoryTrend rows={analytics.categoryTrend} categoryColorMap={categoryColorMap} />
        </article>

        <article className="chart-panel">
          <div className="mini-heading">
            <h3>Category / Type Heatmap</h3>
            <span>Usage and averages</span>
          </div>
          <CategoryRoundTypeHeatmap rows={analytics.categoryRoundTypeRows} categoryColorMap={categoryColorMap} />
        </article>

        <article className="chart-panel insights-panel">
          <div className="mini-heading">
            <h3>Insights</h3>
            <span>{analytics.leaderboardSummary}</span>
          </div>
          <ul>
            {analytics.insights.map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
        </article>

        <article className="chart-panel">
          <div className="mini-heading">
            <h3>Outcome Timeline</h3>
            <span>Round winners</span>
          </div>
          <div className="outcome-timeline">
            {analytics.outcomeTimeline.length ? (
              analytics.outcomeTimeline.slice(-24).map((item) => (
                <span className={`outcome-dot ${item.winner}`} key={item.round} title={`R${item.round}: ${PLAYER_LABEL[item.winner]}`}>
                  {item.round}
                </span>
              ))
            ) : (
              <p className="empty-copy">No outcomes yet.</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

export default AnalyticsPanel;
