import { useMemo, useState } from 'react';
import {
  CATEGORY_COLOR_MAP,
  formatDateTime,
  formatScore,
  getMaskedAnswerValue,
  getRoundAnswerType,
  getRoundPenalty,
  getRoundPenaltyTotals,
  getRoundPenaltyValue,
  isChoiceRoundType,
  isListRoundType,
  PLAYER_LABEL,
  ROUND_TYPES,
  ROUND_TYPE_LABEL,
} from '../utils/game.js';

const categoryColorMap = CATEGORY_COLOR_MAP;
const getGuessDisplay = (round, playerId) => {
  if (round.roundType === 'numeric') return formatScore(round.guesses[playerId]);
  if (isListRoundType(round.roundType)) return round.guessedList[playerId].join(', ') || '-';
  return round.guessedAnswers[playerId] || '-';
};

const getAnswerSummary = (round) => {
  if (round.roundType === 'numeric') {
    return `Actual ${formatScore(round.actualAnswer)}${round.unitLabel ? ` ${round.unitLabel}` : ''} / Lower ${PLAYER_LABEL[round.winner]}`;
  }

  if (isListRoundType(round.roundType)) {
    return `Jay actual: ${round.actualList.jay.join(', ') || '-'} / Kim actual: ${round.actualList.kim.join(', ') || '-'} / Lower ${PLAYER_LABEL[round.winner]}`;
  }

  if (isChoiceRoundType(round.roundType) || round.roundType === 'text') {
    return `Answer: ${getMaskedAnswerValue(round.actualText, getRoundAnswerType(round), round.roundType)} / Lower ${PLAYER_LABEL[round.winner]}`;
  }

  return `Jay actual: ${getMaskedAnswerValue(round.actualAnswers.jay, getRoundAnswerType(round), round.roundType)} / Kim actual: ${getMaskedAnswerValue(round.actualAnswers.kim, getRoundAnswerType(round), round.roundType)} / Lower ${PLAYER_LABEL[round.winner]}`;
};

function HistoryPanel({
  rounds,
  categories,
  categoryColorMap = CATEGORY_COLOR_MAP,
  onEdit,
  onDelete,
  onPlayAgain,
  onExportJson,
  onExportCsv,
  onExportRoundCard,
}) {
  const [query, setQuery] = useState('');
  const [winnerFilter, setWinnerFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [roundTypeFilter, setRoundTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filteredRounds = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rounds.filter((round) => {
      if (winnerFilter !== 'all' && round.winner !== winnerFilter) return false;
      if (categoryFilter && round.category !== categoryFilter) return false;
      if (roundTypeFilter !== 'all' && round.roundType !== roundTypeFilter) return false;
      const roundTime = new Date(round.createdAt).getTime();
      if (dateFrom) {
        const fromTime = new Date(`${dateFrom}T00:00:00`).getTime();
        if (Number.isFinite(fromTime) && roundTime < fromTime) return false;
      }
      if (dateTo) {
        const toTime = new Date(`${dateTo}T23:59:59`).getTime();
        if (Number.isFinite(toTime) && roundTime > toTime) return false;
      }
      if (!normalized) return true;
      return `${round.question} ${round.category} ${(round.tags || []).join(' ')}`.toLowerCase().includes(normalized);
    });
  }, [categoryFilter, dateFrom, dateTo, query, roundTypeFilter, rounds, winnerFilter]);

  return (
    <section className="panel history-panel" aria-labelledby="history-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Archive</p>
          <h2 id="history-title">Round History</h2>
        </div>
        <div className="button-row">
          <button type="button" className="ghost-button compact" onClick={onExportJson}>
            Export JSON
          </button>
          <button type="button" className="ghost-button compact" onClick={onExportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="history-search-row">
        <label className="field">
          <span>Search history</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Question, category, tag" />
        </label>
      </div>

      <details className="clean-details history-filter-details">
        <summary>Filters</summary>
        <div className="history-filters">
          <label className="field">
            <span>Winner</span>
            <select value={winnerFilter} onChange={(event) => setWinnerFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="jay">Jay</option>
              <option value="kim">Kim</option>
              <option value="tie">Tie</option>
            </select>
          </label>
          <label className="field">
            <span>Category</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">All</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Question Type</span>
            <select value={roundTypeFilter} onChange={(event) => setRoundTypeFilter(event.target.value)}>
              <option value="all">All</option>
              {ROUND_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.shortLabel}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>From date</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="field">
            <span>To date</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
        </div>
      </details>

      <div className="history-list" role="list">
        {filteredRounds.length ? (
          filteredRounds
            .slice()
            .reverse()
            .map((round) => (
              <article className="history-row" role="listitem" key={round.id}>
                <div className="history-row-main">
                  <div className="history-row-meta">
                    <strong>Round {round.number}</strong>
                    <time dateTime={round.createdAt}>{formatDateTime(round.createdAt)}</time>
                    {round.category ? <span style={{ borderColor: categoryColorMap?.[round.category] || undefined }}>{round.category}</span> : null}
                    <span>{ROUND_TYPE_LABEL[round.roundType] || round.roundType}</span>
                    <span>Worth {formatScore(getRoundPenaltyValue(round))}</span>
                    {round.roundType === 'numeric' ? <span>Div {formatScore(round.scoringDivisor)}</span> : null}
                  </div>
                  <p>{round.question}</p>
                  <small>{getAnswerSummary(round)}</small>
                  {round.scoreExplanation ? <small>Scoring note: {round.scoreExplanation}</small> : null}
                </div>

                <div className="history-scores">
                  <div>
                    <span>{round.roundType === 'numeric' ? 'Jay guess' : isListRoundType(round.roundType) ? 'Jay order' : 'Jay response'}</span>
                    <strong>{getGuessDisplay(round, 'jay')}</strong>
                    <small>Penalty +{formatScore(getRoundPenalty(round, 'jay'))}</small>
                    <small>Total penalty {formatScore(getRoundPenaltyTotals(round).jay)}</small>
                  </div>
                  <div>
                    <span>{round.roundType === 'numeric' ? 'Kim guess' : isListRoundType(round.roundType) ? 'Kim order' : 'Kim response'}</span>
                    <strong>{getGuessDisplay(round, 'kim')}</strong>
                    <small>Penalty +{formatScore(getRoundPenalty(round, 'kim'))}</small>
                    <small>Total penalty {formatScore(getRoundPenaltyTotals(round).kim)}</small>
                  </div>
                </div>

                <div className="row-actions">
                  <button type="button" className="ghost-button compact" onClick={() => onPlayAgain(round)}>
                    Play Again
                  </button>
                  <button type="button" className="ghost-button compact" onClick={() => onExportRoundCard(round)}>
                    Export Card
                  </button>
                  <button type="button" className="ghost-button compact" onClick={() => onEdit(round)}>
                    Edit
                  </button>
                  <button type="button" className="danger-button compact" onClick={() => onDelete(round.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))
        ) : (
          <p className="empty-copy">No matching rounds yet.</p>
        )}
      </div>
    </section>
  );
}

export default HistoryPanel;
