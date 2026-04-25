const labels = {
  history: {
    title: 'Reset round history?',
    copy: 'This clears played rounds and cumulative totals but keeps the question bank and settings.',
    action: 'Reset History',
  },
  bank: {
    title: 'Reset question bank?',
    copy: 'This deletes every saved template question but keeps played round history.',
    action: 'Reset Bank',
  },
  game: {
    title: 'Start a new game?',
    copy: 'This clears round history and current scoring while keeping the question bank.',
    action: 'New Game',
  },
  wipe: {
    title: 'Full wipe?',
    copy: 'This removes rounds, question bank, settings, and the current browser backup for KJK KIMJAYKINKS.',
    action: 'Full Wipe',
  },
};

function ConfirmResetModal({ target, onConfirm, onCancel }) {
  if (!target) return null;
  const content = labels[target] || labels.wipe;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <p className="eyebrow">Confirmation</p>
        <h2 id="reset-title">{content.title}</h2>
        <p>{content.copy}</p>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            {content.action}
          </button>
        </div>
      </section>
    </div>
  );
}

export default ConfirmResetModal;
