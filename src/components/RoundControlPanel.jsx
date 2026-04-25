import {
  calculateRankedScore,
  calculateScore,
  calculateTextMatchScore,
  DEFAULT_TRUE_FALSE_OPTIONS,
  getDefaultAnswerType,
  formatScore,
  getDefaultScoringMode,
  getDefaultScoringOutcomeType,
  isListRoundType,
  isPairedTextRoundType,
  isSingleAnswerRoundType,
  normalizeRoundType,
  parseNumber,
  PLAYER_LABEL,
  ROUND_TYPES,
  SCORING_MODES,
  SCORING_OUTCOME_TYPES,
} from '../utils/game.js';

const roundPenalty = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;

const parseOptions = (value) =>
  String(value || '')
    .split(/\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);

const getRoundWinner = (scores) => {
  if (Number(scores.jay) === Number(scores.kim)) return 'tie';
  return Number(scores.jay) < Number(scores.kim) ? 'jay' : 'kim';
};

function RoundControlPanel({
  form,
  selectedQuestion,
  editingRound,
  settings,
  categories,
  tags,
  drawPoolCount,
  onFormChange,
  onSettingsChange,
  onDrawRandom,
  onSaveRound,
  onSkipQuestion,
  onReturnQuestion,
  onCancelEdit,
}) {
  const isEditing = Boolean(editingRound);
  const roundType = normalizeRoundType(form.roundType);
  const isNumeric = roundType === 'numeric';
  const isTrueFalse = roundType === 'trueFalse';
  const isListRound = isListRoundType(roundType);
  const isMultipleChoice = roundType === 'multipleChoice' || isTrueFalse;
  const isSingleAnswerRound = isSingleAnswerRoundType(roundType);
  const isPairedTextRound = isPairedTextRoundType(roundType);
  const divisorLocked = settings.lockDivisorFromTemplate || !settings.editableDivisorBeforeSave;
  const roundPenaltyValue = Math.max(0, parseNumber(form.fixedPenalty, 5));
  const choiceOptions = isTrueFalse ? DEFAULT_TRUE_FALSE_OPTIONS : parseOptions(form.multipleChoiceOptions);
  const halfPenalty = roundPenalty(roundPenaltyValue / 2);
  const listLabels =
    roundType === 'sortIntoOrder'
      ? {
          jayActual: 'Jay correct order',
          kimGuess: 'Kim orders Jay list',
          kimActual: 'Kim correct order',
          jayGuess: 'Jay orders Kim list',
        }
      : {
          jayActual: 'Jay actual list',
          kimGuess: 'Kim guesses Jay list',
          kimActual: 'Kim actual list',
          jayGuess: 'Jay guesses Kim list',
        };

  const finalPenalties = {
    jay: roundPenalty(parseNumber(form.jayScore, 0)),
    kim: roundPenalty(parseNumber(form.kimScore, 0)),
  };

  const winnerFromSelection = () => {
    if (form.winnerSelection === 'jay') return { jay: 0, kim: roundPenaltyValue };
    if (form.winnerSelection === 'kim') return { jay: roundPenaltyValue, kim: 0 };
    return { jay: halfPenalty, kim: halfPenalty };
  };

  const closestFixedSuggestion = () => {
    const actual = parseNumber(form.actualAnswer, Number.NaN);
    const jayGuess = parseNumber(form.jayGuess, Number.NaN);
    const kimGuess = parseNumber(form.kimGuess, Number.NaN);

    if (!Number.isFinite(actual) || !Number.isFinite(jayGuess) || !Number.isFinite(kimGuess)) {
      return winnerFromSelection();
    }

    const jayGap = Math.abs(jayGuess - actual);
    const kimGap = Math.abs(kimGuess - actual);
    if (jayGap === kimGap) return { jay: halfPenalty, kim: halfPenalty };
    return jayGap < kimGap ? { jay: 0, kim: roundPenaltyValue } : { jay: roundPenaltyValue, kim: 0 };
  };

  const exactMatchSuggestion = () => {
    if (isNumeric) {
      return {
        jay:
          Number.isFinite(parseNumber(form.actualAnswer, Number.NaN)) &&
          parseNumber(form.jayGuess, Number.NaN) === parseNumber(form.actualAnswer, Number.NaN)
            ? 0
            : roundPenaltyValue,
        kim:
          Number.isFinite(parseNumber(form.actualAnswer, Number.NaN)) &&
          parseNumber(form.kimGuess, Number.NaN) === parseNumber(form.actualAnswer, Number.NaN)
            ? 0
            : roundPenaltyValue,
      };
    }

    if (isListRound) {
      return {
        jay: calculateRankedScore({
          actualList: form.kimActualList,
          guessedList: form.jayGuessedList,
          fixedPenalty: roundPenaltyValue,
        }),
        kim: calculateRankedScore({
          actualList: form.jayActualList,
          guessedList: form.kimGuessedList,
          fixedPenalty: roundPenaltyValue,
        }),
      };
    }

    if (isSingleAnswerRound) {
      return {
        jay: calculateTextMatchScore({
          actualAnswer: form.actualText,
          guess: form.jayGuessedAnswer,
          fixedPenalty: roundPenaltyValue,
        }),
        kim: calculateTextMatchScore({
          actualAnswer: form.actualText,
          guess: form.kimGuessedAnswer,
          fixedPenalty: roundPenaltyValue,
        }),
      };
    }

    return {
      jay: calculateTextMatchScore({
        actualAnswer: form.kimActualAnswer || form.actualText,
        guess: form.jayGuessedAnswer,
        fixedPenalty: roundPenaltyValue,
      }),
      kim: calculateTextMatchScore({
        actualAnswer: form.jayActualAnswer || form.actualText,
        guess: form.kimGuessedAnswer,
        fixedPenalty: roundPenaltyValue,
      }),
    };
  };

  const distanceSuggestion = () => {
    try {
      return {
        jay: calculateScore({
          actualAnswer: form.actualAnswer,
          guess: form.jayGuess,
          divisor: form.scoringDivisor,
          roundingMode: form.roundingMode,
          allowDecimals: form.allowDecimals,
          integerScores: form.integerScores,
        }),
        kim: calculateScore({
          actualAnswer: form.actualAnswer,
          guess: form.kimGuess,
          divisor: form.scoringDivisor,
          roundingMode: form.roundingMode,
          allowDecimals: form.allowDecimals,
          integerScores: form.integerScores,
        }),
      };
    } catch {
      return { jay: 0, kim: 0 };
    }
  };

  const suggestedPenalties = (() => {
    switch (form.scoringOutcomeType) {
      case 'winner_gets_zero_loser_gets_fixed_penalty':
        return winnerFromSelection();
      case 'closest_gets_zero_other_gets_fixed_penalty':
        return isNumeric ? closestFixedSuggestion() : winnerFromSelection();
      case 'exact_match_else_fixed_penalty':
        return exactMatchSuggestion();
      case 'split_penalty':
        return { jay: halfPenalty, kim: halfPenalty };
      case 'direct_manual':
        return finalPenalties;
      case 'custom':
      default:
        if (form.scoringMode === 'assisted_numeric' && isNumeric) {
          return distanceSuggestion();
        }
        return exactMatchSuggestion();
    }
  })();

  const finalWinner = getRoundWinner(finalPenalties);
  const suggestedWinner = getRoundWinner(suggestedPenalties);
  const hasFinalPenalties = String(form.jayScore).trim() && String(form.kimScore).trim();
  const canSave = form.question.trim() && hasFinalPenalties;

  const setPenalties = (jay, kim) => {
    onFormChange({
      jayScore: String(roundPenalty(jay)),
      kimScore: String(roundPenalty(kim)),
    });
  };

  const applySuggestedPenalties = () => setPenalties(suggestedPenalties.jay, suggestedPenalties.kim);

  const updateRoundType = (nextType) => {
    onFormChange({
      roundType: nextType,
      scoringMode: getDefaultScoringMode(nextType),
      scoringOutcomeType: getDefaultScoringOutcomeType(nextType),
      defaultAnswerType: getDefaultAnswerType(nextType),
      multipleChoiceOptions:
        nextType === 'trueFalse' ? DEFAULT_TRUE_FALSE_OPTIONS.join('\n') : form.roundType === 'trueFalse' ? '' : form.multipleChoiceOptions,
      winnerSelection: 'tie',
    });
  };

  const updateScoringMode = (nextMode) => {
    let nextOutcome = form.scoringOutcomeType;
    if (nextMode === 'direct_penalty_entry' || nextMode === 'manual_outcome') nextOutcome = 'direct_manual';
    if (nextMode === 'assisted_numeric') nextOutcome = isNumeric ? 'custom' : 'exact_match_else_fixed_penalty';
    if (nextMode === 'fixed_penalty_outcome') {
      nextOutcome = isNumeric
        ? 'closest_gets_zero_other_gets_fixed_penalty'
        : 'winner_gets_zero_loser_gets_fixed_penalty';
    }
    onFormChange({ scoringMode: nextMode, scoringOutcomeType: nextOutcome });
  };

  const renderChoiceField = (label, value, key) => (
    <label className="field">
      <span>{label}</span>
      {choiceOptions.length ? (
        <select value={value} onChange={(event) => onFormChange({ [key]: event.target.value })}>
          <option value="">Select option</option>
          {choiceOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          onChange={(event) => onFormChange({ [key]: event.target.value })}
          placeholder="Type the option text"
        />
      )}
    </label>
  );

  return (
    <section className="panel round-control" aria-labelledby="round-control-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Hosted Play</p>
          <h2 id="round-control-title">{isEditing ? `Edit Round ${editingRound.number}` : 'Current Round'}</h2>
        </div>
        <div className="button-row">
          <span className="queue-chip">{drawPoolCount} in queue</span>
          <button type="button" className="primary-button compact" onClick={onDrawRandom}>
            {selectedQuestion ? 'Next Random' : 'Draw Random Question'}
          </button>
          <button type="button" className="ghost-button compact" onClick={onSkipQuestion} disabled={!form.question}>
            Skip
          </button>
        </div>
      </div>

      <details className="clean-details draw-settings">
        <summary>Draw filters</summary>
        <div className="mode-strip">
          <label className="field small-field">
            <span>Mode</span>
            <select value={settings.gameMode} onChange={(event) => onSettingsChange({ gameMode: event.target.value })}>
              <option value="standard">Standard random</option>
              <option value="category">Category mode</option>
              <option value="unused">Unused-only</option>
              <option value="repeat">Repeat allowed</option>
              <option value="manual">Manual pick</option>
            </select>
          </label>

          <label className="field small-field">
            <span>Category draw</span>
            <select value={settings.selectedCategory} onChange={(event) => onSettingsChange({ selectedCategory: event.target.value })}>
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="field small-field">
            <span>Tag draw</span>
            <select value={settings.selectedTag} onChange={(event) => onSettingsChange({ selectedTag: event.target.value })}>
              <option value="">All tags</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>

          <label className="field small-field">
            <span>Question type</span>
            <select value={settings.selectedRoundType || ''} onChange={(event) => onSettingsChange({ selectedRoundType: event.target.value })}>
              <option value="">All types</option>
              {ROUND_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.shortLabel}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <div className="current-question-panel">
        <div>
          <p className="eyebrow">{selectedQuestion ? 'Drawn Question' : isEditing ? 'Editing Saved Round' : 'Manual / Waiting'}</p>
          <textarea
            className="question-input"
            value={form.question}
            onChange={(event) => onFormChange({ question: event.target.value })}
            placeholder="Draw from the bank or type a one-off question"
            rows={3}
          />
        </div>
        <div className="question-meta-grid expanded-meta-grid">
          <label className="field">
            <span>Question Type</span>
            <select value={form.roundType} onChange={(event) => updateRoundType(event.target.value)}>
              {ROUND_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.shortLabel}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Scoring mode</span>
            <select value={form.scoringMode} onChange={(event) => updateScoringMode(event.target.value)}>
              {SCORING_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Outcome rule</span>
            <select value={form.scoringOutcomeType} onChange={(event) => onFormChange({ scoringOutcomeType: event.target.value })}>
              {SCORING_OUTCOME_TYPES.map((outcome) => (
                <option key={outcome.id} value={outcome.id}>
                  {outcome.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Question worth</span>
            <input
              type="number"
              min="0"
              step="any"
              value={form.fixedPenalty}
              onChange={(event) => onFormChange({ fixedPenalty: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Category</span>
            <input value={form.category} onChange={(event) => onFormChange({ category: event.target.value })} />
          </label>
          <label className="field">
            <span>Tags</span>
            <input value={form.tags} onChange={(event) => onFormChange({ tags: event.target.value })} placeholder="money, travel" />
          </label>
          <label className="field">
            <span>Unit</span>
            <input value={form.unitLabel} onChange={(event) => onFormChange({ unitLabel: event.target.value })} />
          </label>
        </div>
      </div>

      <div className="penalty-entry-shell">
        <div className="penalty-entry-head">
          <div>
            <p className="eyebrow">Final Save Values</p>
            <h3>Penalty Added This Round</h3>
          </div>
          <span className="status-pill">{PLAYER_LABEL[finalWinner]} lower right now</span>
        </div>

        <div className="manual-score-grid penalty-entry-grid">
          <label className="field">
            <span>Jay penalty added</span>
            <input
              type="number"
              step="any"
              value={form.jayScore}
              onChange={(event) => onFormChange({ jayScore: event.target.value })}
              placeholder="0"
            />
          </label>
          <label className="field">
            <span>Kim penalty added</span>
            <input
              type="number"
              step="any"
              value={form.kimScore}
              onChange={(event) => onFormChange({ kimScore: event.target.value })}
              placeholder="0"
            />
          </label>
        </div>

        <div className="penalty-quick-grid">
          <button type="button" className="ghost-button compact" onClick={() => setPenalties(0, roundPenaltyValue)}>
            Jay +0 / Kim +{formatScore(roundPenaltyValue)}
          </button>
          <button type="button" className="ghost-button compact" onClick={() => setPenalties(roundPenaltyValue, 0)}>
            Jay +{formatScore(roundPenaltyValue)} / Kim +0
          </button>
          <button type="button" className="ghost-button compact" onClick={() => setPenalties(halfPenalty, halfPenalty)}>
            Split {formatScore(halfPenalty)} each
          </button>
          <button type="button" className="ghost-button compact" onClick={() => setPenalties(roundPenaltyValue, roundPenaltyValue)}>
            Both +{formatScore(roundPenaltyValue)}
          </button>
          <button type="button" className="ghost-button compact" onClick={() => setPenalties(winnerFromSelection().jay, winnerFromSelection().kim)}>
            Apply Fixed Penalty To Loser
          </button>
          <button type="button" className="ghost-button compact" onClick={() => setPenalties(roundPenaltyValue, roundPenaltyValue)}>
            Apply Fixed Penalty To Both
          </button>
          <button type="button" className="ghost-button compact" onClick={() => setPenalties(0, 0)}>
            Reset Round Penalties
          </button>
          <button type="button" className="primary-button compact" onClick={applySuggestedPenalties}>
            Copy Suggested Penalties
          </button>
        </div>

        <div className="assistant-summary-row">
          <span>
            Suggested penalties: Jay {formatScore(suggestedPenalties.jay)} / Kim {formatScore(suggestedPenalties.kim)}
          </span>
          <span>Suggested lower: {PLAYER_LABEL[suggestedWinner]}</span>
          <span>Lower total wins</span>
        </div>
      </div>

      {form.scoringMode === 'fixed_penalty_outcome' || form.scoringOutcomeType === 'winner_gets_zero_loser_gets_fixed_penalty' ? (
        <div className="winner-selector-row">
          <span>Winner selector</span>
          <div className="button-row">
            {['jay', 'kim', 'tie'].map((playerId) => (
              <button
                key={playerId}
                type="button"
                className={`ghost-button compact ${form.winnerSelection === playerId ? 'is-on' : ''}`}
                onClick={() => onFormChange({ winnerSelection: playerId })}
              >
                {PLAYER_LABEL[playerId]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {isNumeric ? (
        <div className="round-entry-grid">
          <label className="field">
            <span>Actual answer assistant</span>
            <input
              type="number"
              inputMode="decimal"
              value={form.actualAnswer}
              onChange={(event) => onFormChange({ actualAnswer: event.target.value })}
              placeholder="0"
            />
          </label>
          <label className="field">
            <span>Jay guess assistant</span>
            <input
              type="number"
              inputMode="decimal"
              value={form.jayGuess}
              onChange={(event) => onFormChange({ jayGuess: event.target.value })}
              placeholder="0"
            />
          </label>
          <label className="field">
            <span>Kim guess assistant</span>
            <input
              type="number"
              inputMode="decimal"
              value={form.kimGuess}
              onChange={(event) => onFormChange({ kimGuess: event.target.value })}
              placeholder="0"
            />
          </label>
          <label className="field">
            <span>Numeric helper divisor</span>
            <input
              type="number"
              min="0.000001"
              step="any"
              value={form.scoringDivisor}
              disabled={divisorLocked}
              onChange={(event) => onFormChange({ scoringDivisor: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Rounding</span>
            <select value={form.roundingMode} onChange={(event) => onFormChange({ roundingMode: event.target.value })}>
              <option value="nearest">Nearest</option>
              <option value="floor">Floor</option>
              <option value="ceil">Ceil</option>
            </select>
          </label>
          <label className="field">
            <span>Answer format</span>
            <select value={form.defaultAnswerType} onChange={(event) => onFormChange({ defaultAnswerType: event.target.value })}>
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="percentage">Percentage</option>
              <option value="count">Count</option>
              <option value="time">Time</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>
      ) : null}

      {isListRound ? (
        <div className="text-round-grid is-ranked">
          <label className="field">
            <span>{listLabels.jayActual}</span>
            <textarea value={form.jayActualList} onChange={(event) => onFormChange({ jayActualList: event.target.value })} rows={3} />
          </label>
          <label className="field">
            <span>{listLabels.kimGuess}</span>
            <textarea value={form.kimGuessedList} onChange={(event) => onFormChange({ kimGuessedList: event.target.value })} rows={3} />
          </label>
          <label className="field">
            <span>{listLabels.kimActual}</span>
            <textarea value={form.kimActualList} onChange={(event) => onFormChange({ kimActualList: event.target.value })} rows={3} />
          </label>
          <label className="field">
            <span>{listLabels.jayGuess}</span>
            <textarea value={form.jayGuessedList} onChange={(event) => onFormChange({ jayGuessedList: event.target.value })} rows={3} />
          </label>
        </div>
      ) : null}

      {isPairedTextRound ? (
        <div className="text-round-grid">
          <label className="field">
            <span>Jay actual answer</span>
            <textarea value={form.jayActualAnswer} onChange={(event) => onFormChange({ jayActualAnswer: event.target.value })} rows={2} />
          </label>
          <label className="field">
            <span>Kim guesses Jay</span>
            <textarea value={form.kimGuessedAnswer} onChange={(event) => onFormChange({ kimGuessedAnswer: event.target.value })} rows={2} />
          </label>
          <label className="field">
            <span>Kim actual answer</span>
            <textarea value={form.kimActualAnswer} onChange={(event) => onFormChange({ kimActualAnswer: event.target.value })} rows={2} />
          </label>
          <label className="field">
            <span>Jay guesses Kim</span>
            <textarea value={form.jayGuessedAnswer} onChange={(event) => onFormChange({ jayGuessedAnswer: event.target.value })} rows={2} />
          </label>
        </div>
      ) : null}

      {isSingleAnswerRound ? (
        <div className="text-round-grid">
          {isMultipleChoice && !isTrueFalse ? (
            <label className="field field-wide">
              <span>Multiple choice options</span>
              <textarea
                value={form.multipleChoiceOptions}
                onChange={(event) => onFormChange({ multipleChoiceOptions: event.target.value })}
                rows={3}
                placeholder={'Option A\nOption B\nOption C'}
              />
            </label>
          ) : null}
          {isTrueFalse ? <p className="panel-copy field-wide">True / False uses the built-in binary choice flow.</p> : null}
          {isMultipleChoice ? renderChoiceField('Correct / internal answer', form.actualText, 'actualText') : null}
          {!isMultipleChoice ? (
            <label className="field field-wide">
              <span>Internal text answer</span>
              <textarea value={form.actualText} onChange={(event) => onFormChange({ actualText: event.target.value })} rows={2} />
            </label>
          ) : null}
          {isMultipleChoice
            ? renderChoiceField('Jay choice', form.jayGuessedAnswer, 'jayGuessedAnswer')
            : (
                <label className="field">
                  <span>Jay answer</span>
                  <textarea value={form.jayGuessedAnswer} onChange={(event) => onFormChange({ jayGuessedAnswer: event.target.value })} rows={2} />
                </label>
              )}
          {isMultipleChoice
            ? renderChoiceField('Kim choice', form.kimGuessedAnswer, 'kimGuessedAnswer')
            : (
                <label className="field">
                  <span>Kim answer</span>
                  <textarea value={form.kimGuessedAnswer} onChange={(event) => onFormChange({ kimGuessedAnswer: event.target.value })} rows={2} />
                </label>
              )}
          <p className="panel-copy field-wide">
            Live history, scoreboard previews, and exports will show {`"${'Answered'}"`} for this answer instead of the stored text.
          </p>
        </div>
      ) : null}

      <details className="clean-details round-options" open>
        <summary>Round rules & notes</summary>
        <div className="toggle-grid">
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.allowDecimals}
              onChange={(event) => onFormChange({ allowDecimals: event.target.checked, integerScores: !event.target.checked })}
            />
            <span>Allow decimal penalties</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.requireNotes}
              onChange={(event) => onSettingsChange({ requireNotes: event.target.checked })}
            />
            <span>Require notes</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.allowRepeats}
              onChange={(event) => onSettingsChange({ allowRepeats: event.target.checked, unusedOnly: !event.target.checked })}
            />
            <span>Allow repeats</span>
          </label>
        </div>

        <label className="field">
          <span>Scoring note</span>
          <input
            value={form.scoreExplanation}
            onChange={(event) => onFormChange({ scoreExplanation: event.target.value })}
            placeholder="Why these penalties were added"
          />
        </label>

        <label className="field">
          <span>Round notes</span>
          <textarea
            value={form.notes}
            onChange={(event) => onFormChange({ notes: event.target.value })}
            placeholder="Optional context for this round"
            rows={2}
          />
        </label>
      </details>

      <div className="score-preview">
        <div>
          <span>Jay round penalty</span>
          <strong>{formatScore(finalPenalties.jay)}</strong>
        </div>
        <div>
          <span>Kim round penalty</span>
          <strong>{formatScore(finalPenalties.kim)}</strong>
        </div>
        <div>
          <span>Lower this round</span>
          <strong>{PLAYER_LABEL[finalWinner]}</strong>
        </div>
      </div>

      <div className="form-actions">
        {selectedQuestion ? (
          <button type="button" className="ghost-button compact" onClick={onReturnQuestion}>
            Return To Bank
          </button>
        ) : null}
        {isEditing ? (
          <button type="button" className="ghost-button compact" onClick={onCancelEdit}>
            Cancel Edit
          </button>
        ) : null}
        <button type="button" className="primary-button" onClick={onSaveRound} disabled={!canSave}>
          {isEditing ? 'Update Round' : 'Save Round'}
        </button>
      </div>
    </section>
  );
}

export default RoundControlPanel;
