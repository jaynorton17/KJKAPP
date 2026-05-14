import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORY_COLOR_MAP,
  formatDateTime,
  parseTags,
  ROUND_TYPES,
  ROUND_TYPE_LABEL,
} from '../utils/game.js';
import { parseQuestionImport } from '../utils/importers.js';
import { QUESTION_TYPE_CONFIGS, getGoogleSheetQuestionTypeOptions } from '../utils/questionTypes.js';

const categoryColorMap = CATEGORY_COLOR_MAP;
const CUSTOM_CATEGORY_VALUE = '__custom__';

const QUESTION_TYPE_DETAILS = Object.fromEntries(
  QUESTION_TYPE_CONFIGS.map((config) => [
    config.id,
    {
      title: config.title,
      summary: config.summary,
      playFlow: config.playFlow,
    },
  ]),
);

const QUESTION_TYPE_BEHAVIOURS = {
  numeric: [
    {
      id: 'type-default',
      label: 'Numeric helper',
      hint: 'Use actual answer and guesses later.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
    {
      id: 'closest-wins',
      label: 'Closest wins',
      hint: 'Closest player gets zero, loser takes the default penalty.',
      scoringMode: 'fixed_penalty_outcome',
      scoringOutcomeType: 'closest_gets_zero_other_gets_fixed_penalty',
    },
    {
      id: 'exact-match',
      label: 'Exact match',
      hint: 'Only an exact hit gets zero.',
      scoringMode: 'fixed_penalty_outcome',
      scoringOutcomeType: 'exact_match_else_fixed_penalty',
    },
    {
      id: 'manual',
      label: 'Manual penalties',
      hint: 'Enter penalties directly during play.',
      scoringMode: 'direct_penalty_entry',
      scoringOutcomeType: 'direct_manual',
    },
  ],
  multipleChoice: [
    {
      id: 'type-default',
      label: 'Exact match',
      hint: 'Use the built-in answer match flow later.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
    {
      id: 'manual',
      label: 'Manual penalties',
      hint: 'Judge it manually during play.',
      scoringMode: 'direct_penalty_entry',
      scoringOutcomeType: 'direct_manual',
    },
  ],
  trueFalse: [
    {
      id: 'type-default',
      label: 'Binary exact match',
      hint: 'Use the built-in True / False answer flow later.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
    {
      id: 'manual',
      label: 'Manual penalties',
      hint: 'Judge it manually during play.',
      scoringMode: 'direct_penalty_entry',
      scoringOutcomeType: 'direct_manual',
    },
  ],
  text: [
    {
      id: 'type-default',
      label: 'Exact match',
      hint: 'Later play compares the stored answer to each guess.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
    {
      id: 'manual',
      label: 'Manual penalties',
      hint: 'Judge it manually during play.',
      scoringMode: 'direct_penalty_entry',
      scoringOutcomeType: 'direct_manual',
    },
  ],
  sortIntoOrder: [
    {
      id: 'type-default',
      label: 'Ordering helper',
      hint: 'Later play uses the built-in list/order helper.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
    {
      id: 'manual',
      label: 'Manual penalties',
      hint: 'Judge the order manually during play.',
      scoringMode: 'direct_penalty_entry',
      scoringOutcomeType: 'direct_manual',
    },
  ],
  ranked: [
    {
      id: 'type-default',
      label: 'Ranked list helper',
      hint: 'Later play uses ranked list matching.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
    {
      id: 'manual',
      label: 'Manual penalties',
      hint: 'Judge the ranked list manually during play.',
      scoringMode: 'direct_penalty_entry',
      scoringOutcomeType: 'direct_manual',
    },
  ],
  rating: [
    {
      id: 'type-default',
      label: 'Manual judgement',
      hint: 'Later play keeps ratings manual unless you override scoring.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
    {
      id: 'exact-match',
      label: 'Exact match',
      hint: 'Only the exact same rating gets zero later.',
      scoringMode: 'direct_penalty_entry',
      scoringOutcomeType: 'exact_match_else_fixed_penalty',
    },
  ],
  preference: [
    {
      id: 'type-default',
      label: 'Manual judgement',
      hint: 'Later play keeps this as a flexible preference round.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
    {
      id: 'exact-match',
      label: 'Exact text match',
      hint: 'Only exact matches get zero later.',
      scoringMode: 'direct_penalty_entry',
      scoringOutcomeType: 'exact_match_else_fixed_penalty',
    },
  ],
  favourite: [
    {
      id: 'type-default',
      label: 'Manual judgement',
      hint: 'Later play keeps this as a flexible favourite round.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
    {
      id: 'exact-match',
      label: 'Exact text match',
      hint: 'Only exact matches get zero later.',
      scoringMode: 'direct_penalty_entry',
      scoringOutcomeType: 'exact_match_else_fixed_penalty',
    },
  ],
  petPeeve: [
    {
      id: 'type-default',
      label: 'Manual judgement',
      hint: 'Later play keeps this as a flexible pet peeve round.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
    {
      id: 'exact-match',
      label: 'Exact text match',
      hint: 'Only exact matches get zero later.',
      scoringMode: 'direct_penalty_entry',
      scoringOutcomeType: 'exact_match_else_fixed_penalty',
    },
  ],
  manual: [
    {
      id: 'type-default',
      label: 'Direct penalty entry',
      hint: 'Later play stays fully manual.',
      scoringMode: '',
      scoringOutcomeType: '',
    },
  ],
};

const createBlankQuestion = (overrides = {}) => ({
  question: '',
  category: '',
  tags: '',
  roundType: 'numeric',
  unitLabel: '',
  scoringDivisor: '',
  roundingMode: '',
  fixedPenalty: '',
  notes: '',
  defaultAnswerType: '',
  multipleChoiceOptions: '',
  scoringMode: '',
  scoringOutcomeType: '',
  source: 'manual',
  sourceLabel: '',
  ...overrides,
});

const toDraft = (question) =>
  createBlankQuestion({
    question: question.question || '',
    category: question.category || '',
    tags: (question.tags || []).join(', '),
    roundType: question.roundType || 'numeric',
    unitLabel: question.unitLabel || '',
    scoringDivisor: String(question.scoringDivisor ?? ''),
    roundingMode: question.roundingMode || '',
    fixedPenalty: String(question.fixedPenalty ?? ''),
    notes: question.notes || '',
    defaultAnswerType: question.defaultAnswerType || '',
    multipleChoiceOptions: (question.multipleChoiceOptions || []).join('\n'),
    scoringMode: question.scoringMode || '',
    scoringOutcomeType: question.scoringOutcomeType || '',
    source: question.source || 'manual',
    sourceLabel: question.sourceLabel || '',
  });

const fromDraft = (draft) => ({
  ...draft,
  tags: parseTags(draft.tags),
});

const getQuestionTypeOptions = () =>
  ROUND_TYPES.map((type) => ({
    ...type,
    ...QUESTION_TYPE_DETAILS[type.id],
  }));

const getBehaviourOptions = (roundType) => QUESTION_TYPE_BEHAVIOURS[roundType] || QUESTION_TYPE_BEHAVIOURS.numeric;

const getBehaviourValue = (draft) => {
  const options = getBehaviourOptions(draft.roundType);
  const match = options.find(
    (option) => option.scoringMode === (draft.scoringMode || '') && option.scoringOutcomeType === (draft.scoringOutcomeType || ''),
  );
  return match?.id || 'custom';
};

const applyBehaviourPreset = (draft, presetId) => {
  const preset = getBehaviourOptions(draft.roundType).find((option) => option.id === presetId);
  if (!preset) return draft;
  return {
    ...draft,
    scoringMode: preset.scoringMode,
    scoringOutcomeType: preset.scoringOutcomeType,
  };
};

const createNextAddDraft = (draft) =>
  createBlankQuestion({
    category: draft.category,
    roundType: draft.roundType,
    fixedPenalty: draft.fixedPenalty,
    scoringMode: draft.scoringMode,
    scoringOutcomeType: draft.scoringOutcomeType,
    sourceLabel: draft.sourceLabel,
  });

const hasAdvancedValues = (draft) =>
  Boolean(
    draft.tags.trim() ||
      draft.notes.trim() ||
      String(draft.fixedPenalty).trim() ||
      draft.sourceLabel.trim() ||
      draft.scoringMode ||
      draft.scoringOutcomeType,
  );

const GOOGLE_SHEET_TYPE_OPTIONS = getGoogleSheetQuestionTypeOptions();

const formatRelativeSyncTime = (value) => {
  if (!value) return 'Last synced never';

  const diffMs = Math.max(0, Date.now() - new Date(value).getTime());
  if (!Number.isFinite(diffMs)) return 'Last synced recently';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Last synced just now';
  if (minutes < 60) return `Last synced ${minutes} min${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last synced ${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `Last synced ${days} day${days === 1 ? '' : 's'} ago`;
};

function QuestionTypeGrid({ value, onChange }) {
  const options = getQuestionTypeOptions();

  return (
    <div className="question-type-grid" role="list">
      {options.map((type) => (
        <button
          key={type.id}
          type="button"
          className={`question-type-card ${value === type.id ? 'is-active' : ''}`}
          onClick={() => onChange(type.id)}
          aria-pressed={value === type.id}
        >
          <strong>{type.title}</strong>
          <span>{type.summary}</span>
          <small>{type.playFlow}</small>
        </button>
      ))}
    </div>
  );
}

function QuestionBuilderModal({
  isOpen,
  mode,
  draft,
  categories,
  showAdvanced,
  onDraftChange,
  onCategorySelect,
  onTypeChange,
  onToggleAdvanced,
  onClose,
  onSave,
  inputRef,
}) {
  if (!isOpen) return null;

  const typeDetail = QUESTION_TYPE_DETAILS[draft.roundType] || QUESTION_TYPE_DETAILS.numeric;
  const behaviourOptions = getBehaviourOptions(draft.roundType);
  const behaviourValue = getBehaviourValue(draft);
  const categoryExists = draft.category && categories.includes(draft.category);
  const categorySelectValue = draft.category ? (categoryExists ? draft.category : CUSTOM_CATEGORY_VALUE) : '';
  const isEditing = mode === 'edit';

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="question-builder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-builder-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-heading question-builder-head">
          <div>
            <p className="eyebrow">Mini Question Builder</p>
            <h2 id="question-builder-title">{isEditing ? 'Edit Question' : 'Add Question'}</h2>
            <p className="builder-copy">Only the setup belongs here. Answers and detailed scoring happen later during play.</p>
          </div>
          <button type="button" className="ghost-button compact" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="builder-flow">
          <section className="builder-section">
            <div className="mini-heading">
              <div>
                <span>Step 1</span>
                <h3>Question Text</h3>
              </div>
            </div>
            <label className="field field-wide">
              <span>Question</span>
              <textarea
                ref={inputRef}
                value={draft.question}
                onChange={(event) => onDraftChange({ question: event.target.value })}
                rows={3}
                placeholder="What is the question you want in the bank?"
              />
            </label>
          </section>

          <section className="builder-section">
            <div className="mini-heading">
              <div>
                <span>Step 2</span>
                <h3>Question Type</h3>
              </div>
            </div>
            <QuestionTypeGrid value={draft.roundType} onChange={onTypeChange} />
            <p className="builder-type-note">{typeDetail.playFlow}</p>
          </section>

          <section className="builder-section">
            <div className="mini-heading">
              <div>
                <span>Step 3</span>
                <h3>Category</h3>
              </div>
            </div>
            <div className="builder-category-row">
              {categories.length ? (
                <label className="field">
                  <span>Category</span>
                  <select value={categorySelectValue} onChange={(event) => onCategorySelect(event.target.value)}>
                    <option value="">Choose category</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                    <option value={CUSTOM_CATEGORY_VALUE}>Add new category</option>
                  </select>
                </label>
              ) : null}

              {(!categories.length || categorySelectValue === CUSTOM_CATEGORY_VALUE) ? (
                <label className="field">
                  <span>{categories.length ? 'New category' : 'Category'}</span>
                  <input
                    value={draft.category}
                    onChange={(event) => onDraftChange({ category: event.target.value })}
                    placeholder="Enter category name"
                  />
                </label>
              ) : null}
            </div>
          </section>

          <details className="builder-advanced" open={showAdvanced}>
            <summary onClick={(event) => {
              event.preventDefault();
              onToggleAdvanced();
            }}
            >
              Optional extras
            </summary>
            <div className="builder-advanced-grid">
              <label className="field">
                <span>Tags</span>
                <input
                  value={draft.tags}
                  onChange={(event) => onDraftChange({ tags: event.target.value })}
                  placeholder="travel, favourites, spicy"
                />
              </label>

              <label className="field">
                <span>Default penalty</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={draft.fixedPenalty}
                  onChange={(event) => onDraftChange({ fixedPenalty: event.target.value })}
                  placeholder="Leave blank for the type default"
                />
              </label>

              <label className="field">
                <span>Later play behaviour</span>
                <select
                  value={behaviourValue}
                  onChange={(event) => {
                    if (event.target.value === 'custom') return;
                    onDraftChange(applyBehaviourPreset(draft, event.target.value));
                  }}
                >
                  {behaviourOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                  {behaviourValue === 'custom' ? <option value="custom">Custom preserved</option> : null}
                </select>
              </label>

              <label className="field">
                <span>Import source label</span>
                <input
                  value={draft.sourceLabel}
                  onChange={(event) => onDraftChange({ sourceLabel: event.target.value })}
                  placeholder="April spreadsheet, date night pack, etc."
                />
              </label>

              <label className="field field-wide">
                <span>Notes</span>
                <textarea
                  value={draft.notes}
                  onChange={(event) => onDraftChange({ notes: event.target.value })}
                  rows={3}
                  placeholder="Optional notes for the bank. Answers are still added later during play."
                />
              </label>
            </div>
          </details>
        </div>

        <div className="question-builder-footer">
          <div className="builder-footer-copy">
            <strong>{ROUND_TYPE_LABEL[draft.roundType] || draft.roundType}</strong>
            <span>{typeDetail.summary}</span>
          </div>
          <div className="modal-actions">
            <button type="button" className="ghost-button compact" onClick={onClose}>
              Cancel
            </button>
            {isEditing ? (
              <button
                type="button"
                className="primary-button compact"
                onClick={() => onSave(true)}
                disabled={!draft.question.trim() || !draft.category.trim()}
              >
                Save Changes
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="ghost-button compact"
                  onClick={() => onSave(true)}
                  disabled={!draft.question.trim() || !draft.category.trim()}
                >
                  Save & Close
                </button>
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={() => onSave(false)}
                  disabled={!draft.question.trim() || !draft.category.trim()}
                >
                  Save & Add Another
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function QuestionBankPanel({
  questions,
  settings,
  categories,
  categoryOptions = [],
  categoryColorMap = CATEGORY_COLOR_MAP,
  tags,
  isSyncingGoogleSheet = false,
  googleSheetSyncSummary = null,
  onSettingsChange,
  onConnectGoogleSheet,
  onSyncGoogleSheet,
  onAddQuestion,
  onImportQuestions,
  onUpdateQuestion,
  onDeleteQuestion,
  onDuplicateQuestion,
  onToggleUsed,
  onPickQuestion,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onBulkAssignCategory,
}) {
  const questionInputRef = useRef(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState('add');
  const [builderTargetId, setBuilderTargetId] = useState('');
  const [builderDraft, setBuilderDraft] = useState(() => createBlankQuestion());
  const [builderShowAdvanced, setBuilderShowAdvanced] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [roundTypeFilter, setRoundTypeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [bulkCategory, setBulkCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState('');
  const [categoryDraft, setCategoryDraft] = useState({ name: '', color: '#ff3158' });
  const [importFormat, setImportFormat] = useState('auto');
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [importFileName, setImportFileName] = useState('');
  const [googleSheetInputDraft, setGoogleSheetInputDraft] = useState(() => settings.googleSheetInput || settings.googleSheetId || '');

  useEffect(() => {
    if (!builderOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeBuilder();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => questionInputRef.current?.focus());
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [builderOpen]);

  useEffect(() => {
    setGoogleSheetInputDraft(settings.googleSheetInput || settings.googleSheetId || '');
  }, [settings.googleSheetId, settings.googleSheetInput]);

  const filteredQuestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return questions.filter((question) => {
      if (statusFilter === 'used' && !question.used) return false;
      if (statusFilter === 'unused' && question.used) return false;
      if (categoryFilter && question.category !== categoryFilter) return false;
      if (tagFilter && !(question.tags || []).includes(tagFilter)) return false;
      if (roundTypeFilter !== 'all' && question.roundType !== roundTypeFilter) return false;
      if (sourceFilter !== 'all' && (question.source || 'manual') !== sourceFilter) return false;
      if (!normalizedQuery) return true;
      return `${question.question} ${question.category} ${(question.tags || []).join(' ')} ${question.notes || ''}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [categoryFilter, questions, query, roundTypeFilter, sourceFilter, statusFilter, tagFilter]);

  const groupedQuestions = useMemo(() => {
    const groups = new Map();
    filteredQuestions.forEach((question) => {
      const category = question.category || 'Uncategorised';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(question);
    });
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredQuestions]);

  const categoryStats = useMemo(
    () =>
      categoryOptions.map((category) => ({
        ...category,
        count: questions.filter((question) => question.category === category.name).length,
        played: questions.filter((question) => question.category === category.name).reduce((total, question) => total + (question.timesPlayed || 0), 0),
      })),
    [categoryOptions, questions],
  );

  const openAddBuilder = () => {
    setBuilderMode('add');
    setBuilderTargetId('');
    setBuilderOpen(true);
    setBuilderShowAdvanced(hasAdvancedValues(builderDraft));
  };

  const openEditBuilder = (question) => {
    const nextDraft = toDraft(question);
    setBuilderMode('edit');
    setBuilderTargetId(question.id);
    setBuilderDraft(nextDraft);
    setBuilderShowAdvanced(hasAdvancedValues(nextDraft));
    setBuilderOpen(true);
  };

  const closeBuilder = () => {
    setBuilderOpen(false);
    if (builderMode === 'edit') {
      setBuilderMode('add');
      setBuilderTargetId('');
      setBuilderDraft(createBlankQuestion());
      setBuilderShowAdvanced(false);
    }
  };

  const updateBuilderDraft = (patch) => {
    setBuilderDraft((current) => ({ ...current, ...patch }));
  };

  const handleCategorySelect = (value) => {
    if (value === CUSTOM_CATEGORY_VALUE) {
      setBuilderDraft((current) => ({ ...current, category: current.category && !categories.includes(current.category) ? current.category : '' }));
      return;
    }
    setBuilderDraft((current) => ({ ...current, category: value }));
  };

  const handleTypeChange = (nextType) => {
    setBuilderDraft((current) => ({
      ...current,
      roundType: nextType,
      defaultAnswerType: '',
      scoringMode: '',
      scoringOutcomeType: '',
    }));
  };

  const handleBuilderSave = (closeAfterSave) => {
    const payload = fromDraft(builderDraft);
    const didSave =
      builderMode === 'edit'
        ? onUpdateQuestion(builderTargetId, payload)
        : onAddQuestion(payload);

    if (!didSave) return;

    if (builderMode === 'edit' || closeAfterSave) {
      setBuilderOpen(false);
      if (builderMode === 'edit') {
        setBuilderMode('add');
        setBuilderTargetId('');
        setBuilderDraft(createBlankQuestion());
        setBuilderShowAdvanced(false);
      }
      return;
    }

    setBuilderDraft((current) => createNextAddDraft(current));
    window.requestAnimationFrame(() => questionInputRef.current?.focus());
  };

  const handlePreviewImport = () => {
    const result = parseQuestionImport({
      rawText: importText,
      existingQuestions: questions,
      format: importFormat,
      skipDuplicates: settings.skipDuplicates,
    });
    setImportResult(result);
  };

  const handleImport = () => {
    if (!importResult?.questions.length) return;
    onImportQuestions(importResult.questions);
    setImportText('');
    setImportResult(null);
    setImportFileName('');
  };

  const handleImportFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const fileText = String(reader.result || '');
      const extension = file.name.split('.').pop()?.toLowerCase();
      setImportText(fileText);
      setImportResult(null);
      setImportFileName(file.name);
      if (importFormat === 'auto' && ['csv', 'json', 'txt'].includes(extension)) {
        setImportFormat(extension === 'txt' ? 'text' : extension);
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleBulkAssign = () => {
    onBulkAssignCategory?.(filteredQuestions.map((question) => question.id), bulkCategory);
    setBulkCategory('');
  };

  const startCategoryEdit = (category) => {
    setEditingCategory(category.name);
    setCategoryDraft({ name: category.name, color: category.color });
  };

  const handleConnectGoogleSheet = () => onConnectGoogleSheet?.(googleSheetInputDraft.trim());
  const handleSyncGoogleSheet = () => onSyncGoogleSheet?.(googleSheetInputDraft.trim());
  const googleSheetConnected = Boolean(settings.googleSheetId);
  const googleSheetStatus = googleSheetConnected ? 'Connected' : 'Not connected';
  const googleSheetLastSyncedCopy = formatRelativeSyncTime(settings.googleSheetLastSyncedAt);
  const openGoogleSheetHref = (() => {
    const raw = googleSheetInputDraft.trim() || settings.googleSheetInput || '';
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const sheetId = raw || settings.googleSheetId;
    if (sheetId) return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    return '';
  })();

  return (
    <>
      <section className="panel question-bank" aria-labelledby="question-bank-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Question Bank</p>
            <h2 id="question-bank-title">Import, Search, Draw</h2>
          </div>
          <div className="button-row">
            <div className="bank-counts">
              <span>{questions.filter((question) => !question.used).length} unused</span>
              <strong>{questions.length} total</strong>
            </div>
            <button type="button" className="primary-button compact" onClick={openAddBuilder}>
              Add Question
            </button>
          </div>
        </div>

        <section className="builder-launch-card">
          <div>
            <p className="eyebrow">Fast Builder</p>
            <h3>Question setup only</h3>
            <p>Question text, Question Type, and Category are all you need. Answers, guesses, and round scoring stay in live play.</p>
          </div>
          <div className="builder-launch-actions">
            <button type="button" className="primary-button compact" onClick={openAddBuilder}>
              Open Builder
            </button>
          </div>
        </section>

        <section className="sheet-sync-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Collaborative Import</p>
              <h3>Google Sheet</h3>
            </div>
            <span className={`status-pill ${googleSheetConnected ? 'is-hot' : ''}`}>{googleSheetStatus}</span>
          </div>

          <p className="sheet-sync-copy">
            Keep using the in-app builder and use Google Sheets for shared question drafting. Sync only happens when you press update.
          </p>

          <div className="sheet-sync-grid">
            <label className="field field-wide">
              <span>Google Sheet URL or ID</span>
              <input
                value={googleSheetInputDraft}
                onChange={(event) => setGoogleSheetInputDraft(event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/... or SHEET_ID"
              />
            </label>

            <label className="toggle">
              <input
                type="checkbox"
                checked={Boolean(settings.googleSheetOverwriteExisting)}
                onChange={(event) => onSettingsChange({ googleSheetOverwriteExisting: event.target.checked })}
              />
              <span>Overwrite matching sheet questions</span>
            </label>
          </div>

          <div className="sheet-sync-actions">
            <button type="button" className="ghost-button compact" onClick={handleConnectGoogleSheet} disabled={!googleSheetInputDraft.trim()}>
              Connect Google Sheet
            </button>
            {openGoogleSheetHref ? (
              <a className="ghost-button compact" href={openGoogleSheetHref} target="_blank" rel="noreferrer">
                Open Google Sheet
              </a>
            ) : null}
            <button
              type="button"
              className="primary-button compact"
              onClick={handleSyncGoogleSheet}
              disabled={!googleSheetInputDraft.trim() || isSyncingGoogleSheet}
            >
              {isSyncingGoogleSheet ? 'Updating…' : 'Update from Google Sheet'}
            </button>
            <span className="sheet-sync-meta-copy">{googleSheetLastSyncedCopy}</span>
          </div>

          <div className="sheet-sync-meta">
            <span>Status: {googleSheetStatus}</span>
            {settings.googleSheetId ? <span>Sheet ID: {settings.googleSheetId}</span> : null}
            {settings.googleSheetConnectedAt ? <span>Connected {formatDateTime(settings.googleSheetConnectedAt)}</span> : null}
          </div>

          <div className="template-toolbar sheet-template-toolbar">
            <a className="ghost-button compact" href="/templates/kjk-google-sheet-template.csv" download>
              Google Sheet CSV Template
            </a>
            <span className="panel-copy">Question | Question Type | Category</span>
          </div>

          <p className="panel-copy">
            Question Type dropdown values: {GOOGLE_SHEET_TYPE_OPTIONS.join(' / ')}
          </p>

          <details className="clean-details">
            <summary>Category dropdown values</summary>
            <textarea
              className="bulk-textarea"
              readOnly
              rows={Math.min(Math.max(categories.length || 1, 3), 8)}
              value={categories.join('\n')}
            />
          </details>

          {googleSheetSyncSummary ? (
            <div className="import-preview sheet-sync-summary">
              <div className="preview-summary">
                <span>Google Sheet</span>
                <strong>
                  {googleSheetSyncSummary.imported} imported / {googleSheetSyncSummary.updated} updated
                </strong>
                <span>{googleSheetSyncSummary.duplicates} duplicates</span>
                <span>{googleSheetSyncSummary.invalid} invalid</span>
                <span>{googleSheetSyncSummary.skipped} skipped</span>
              </div>
            </div>
          ) : null}
        </section>

        <details className="tool-details">
          <summary>Category manager</summary>
          <div className="category-manager">
            <div className="category-add-row">
              <label className="field">
                <span>New category</span>
                <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} />
              </label>
              <button
                type="button"
                className="primary-button compact"
                onClick={() => {
                  onAddCategory?.(newCategoryName);
                  setNewCategoryName('');
                }}
                disabled={!newCategoryName.trim()}
              >
                Add Category
              </button>
            </div>

            <div className="category-count-grid">
              {categoryStats.map((category) => (
                <div className="category-count-row" key={category.name}>
                  {editingCategory === category.name ? (
                    <>
                      <input value={categoryDraft.name} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} />
                      <input type="color" value={categoryDraft.color} onChange={(event) => setCategoryDraft((current) => ({ ...current, color: event.target.value }))} />
                      <button
                        type="button"
                        className="primary-button compact"
                        onClick={() => {
                          onUpdateCategory?.(category.name, categoryDraft);
                          setEditingCategory('');
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className="ghost-button compact" onClick={() => setEditingCategory('')}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="category-swatch" style={{ background: category.color }} />
                      <strong>{category.name}</strong>
                      <span>{category.count} bank</span>
                      <span>{category.played} plays</span>
                      <button type="button" className="ghost-button compact" onClick={() => startCategoryEdit(category)}>
                        Edit
                      </button>
                      <button type="button" className="danger-button compact" onClick={() => onDeleteCategory?.(category.name)}>
                        Remove
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </details>

        <details className="tool-details">
          <summary>Bulk import JSON / CSV / pasted text</summary>
          <div className="template-toolbar">
            <a className="ghost-button compact" href="/templates/kjk-question-import-template.csv" download>
              Blank Excel CSV
            </a>
            <a className="ghost-button compact" href="/templates/kjk-google-doc-bulk-import-template.html" download>
              Google Doc Template
            </a>
            <label className="ghost-button compact file-upload-button">
              Upload Bulk File
              <input type="file" accept=".csv,.json,.txt,.md" onChange={handleImportFile} />
            </label>
            {importFileName ? <span className="upload-status">Loaded {importFileName}</span> : null}
          </div>
          <div className="import-toolbar">
            <label className="field">
              <span>Format</span>
              <select value={importFormat} onChange={(event) => setImportFormat(event.target.value)}>
                <option value="auto">Auto detect</option>
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="text">Plain text</option>
              </select>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.skipDuplicates}
                onChange={(event) => onSettingsChange({ skipDuplicates: event.target.checked })}
              />
              <span>Skip duplicates</span>
            </label>
          </div>
          <textarea
            className="bulk-textarea"
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              setImportResult(null);
            }}
            rows={7}
            placeholder={'Question: What is your favourite holiday destination?\nCategory: Travel\nQuestionType: Favourite\nTags: holidays, favourites'}
          />
          <div className="form-actions">
            <button type="button" className="ghost-button compact" onClick={handlePreviewImport} disabled={!importText.trim()}>
              Preview Import
            </button>
            <button type="button" className="primary-button compact" onClick={handleImport} disabled={!importResult?.questions.length}>
              Import {importResult?.summary.imported || 0}
            </button>
          </div>

          {importResult ? (
            <div className="import-preview">
              <div className="preview-summary">
                <span>{importResult.format.toUpperCase()}</span>
                <strong>
                  {importResult.summary.imported} importable / {importResult.summary.total} parsed
                </strong>
                <span>{importResult.summary.duplicates} duplicates</span>
              </div>
              <div className="preview-list">
                {importResult.preview.slice(0, 8).map((row) => (
                  <div className={`preview-row ${row.willImport ? '' : 'is-muted'}`} key={row.index}>
                    <span>{row.index + 1}</span>
                    <p>{row.question.question || 'Missing question'}</p>
                    <small>
                      {row.errors.length ? row.errors.join(', ') : row.duplicate ? 'Duplicate' : 'Ready'}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </details>

        <div className="bank-filters">
          <label className="field">
            <span>Search</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Question, tag, category" />
          </label>
          <label className="field">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="unused">Unused</option>
              <option value="used">Used</option>
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
            <span>Tag</span>
            <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="">All</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
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
            <span>Source</span>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="starter">Starter</option>
              <option value="manual">Manual</option>
              <option value="imported">Imported</option>
              <option value="googleSheet">Google Sheet</option>
            </select>
          </label>
          <label className="field">
            <span>Bulk category</span>
            <select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}>
              <option value="">Choose category</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="ghost-button compact bank-bulk-button" onClick={handleBulkAssign} disabled={!bulkCategory || !filteredQuestions.length}>
            Apply To Filtered
          </button>
        </div>

        <div className="question-list" role="list">
          {groupedQuestions.length ? (
            groupedQuestions.map(([groupName, groupQuestions]) => (
              <div className="question-category-group" key={groupName}>
                <div className="question-category-heading">
                  <span className="category-swatch" style={{ background: categoryColorMap?.[groupName] || '#ffffff' }} />
                  <strong>{groupName}</strong>
                  <span>{groupQuestions.length} questions</span>
                </div>
                {groupQuestions.map((question) => (
                  <article className="question-row" role="listitem" key={question.id}>
                    <div className="question-row-main">
                      <div className="question-row-meta">
                        <strong>{question.used ? 'Used' : 'Unused'}</strong>
                        {question.category ? <span style={{ borderColor: categoryColorMap?.[question.category] || undefined }}>{question.category}</span> : null}
                        <span>{ROUND_TYPE_LABEL[question.roundType] || question.roundType}</span>
                        <span>{question.source === 'googleSheet' ? 'Google Sheet' : question.source || 'manual'}</span>
                        {question.sourceLabel ? <span>{question.sourceLabel}</span> : null}
                        {question.addedBy ? <span>By {question.addedBy}</span> : null}
                      </div>
                      <p>{question.question}</p>
                      <small>
                        Played {question.timesPlayed || 0} times
                        {question.lastPlayedAt ? ` / last ${formatDateTime(question.lastPlayedAt)}` : ''}
                        {question.tags?.length ? ` / ${question.tags.join(', ')}` : ''}
                        {question.importDate ? ` / synced ${formatDateTime(question.importDate)}` : ''}
                      </small>
                      {question.notes ? <small className="question-row-note">{question.notes}</small> : null}
                    </div>
                    <div className="row-actions">
                      <button type="button" className="primary-button compact" onClick={() => onPickQuestion(question)}>
                        Pick
                      </button>
                      <button type="button" className="ghost-button compact" onClick={() => onToggleUsed(question.id, !question.used)}>
                        Mark {question.used ? 'Unused' : 'Used'}
                      </button>
                      <button type="button" className="ghost-button compact" onClick={() => openEditBuilder(question)}>
                        Edit
                      </button>
                      <button type="button" className="ghost-button compact" onClick={() => onDuplicateQuestion(question.id)}>
                        Duplicate
                      </button>
                      <button type="button" className="danger-button compact" onClick={() => onDeleteQuestion(question.id)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ))
          ) : (
            <p className="empty-copy">No questions match the current filters.</p>
          )}
        </div>
      </section>

      <QuestionBuilderModal
        isOpen={builderOpen}
        mode={builderMode}
        draft={builderDraft}
        categories={categories}
        showAdvanced={builderShowAdvanced}
        onDraftChange={updateBuilderDraft}
        onCategorySelect={handleCategorySelect}
        onTypeChange={handleTypeChange}
        onToggleAdvanced={() => setBuilderShowAdvanced((current) => !current)}
        onClose={closeBuilder}
        onSave={handleBuilderSave}
        inputRef={questionInputRef}
      />
    </>
  );
}

export default QuestionBankPanel;
