import MainScoreboard16x9 from './MainScoreboard16x9.jsx';
import SharePanel from './SharePanel.jsx';

function ExportTab({
  rounds,
  selectedQuestion,
  form,
  editingRound,
  scoreboardRef,
  round,
  roundCardRef,
  onShareQuestion,
  onCopyRoundCard,
  onDownloadRoundCard,
  onExportAnimation,
  onCopyScoreboard,
  canShareQuestion,
  onExportBackup,
  onImportBackup,
  isBusy,
}) {
  return (
    <div className="export-tab-layout">
      <section className="panel export-scoreboard-panel" aria-labelledby="scoreboard-export-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Export Base</p>
            <h2 id="scoreboard-export-title">16:9 Scoreboard</h2>
          </div>
          <span className="status-pill">PNG ready</span>
        </div>
        <MainScoreboard16x9
          rounds={rounds}
          selectedQuestion={selectedQuestion}
          form={form}
          editingRound={editingRound}
          captureRef={scoreboardRef}
          exportMode
        />
      </section>

      <SharePanel
        round={round}
        captureRef={roundCardRef}
        onShareQuestion={onShareQuestion}
        onCopyRoundCard={onCopyRoundCard}
        onDownloadRoundCard={onDownloadRoundCard}
        onExportAnimation={onExportAnimation}
        onCopyScoreboard={onCopyScoreboard}
        canShareQuestion={canShareQuestion}
        isBusy={isBusy}
      />

      <section className="panel backup-panel" aria-labelledby="backup-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Local Data</p>
            <h2 id="backup-title">Backup / Restore</h2>
          </div>
        </div>
        <p className="panel-copy">
          Export the full local game state, or restore a previous KJK KIMJAYKINKS backup JSON.
        </p>
        <div className="button-row">
          <button type="button" className="primary-button compact" onClick={onExportBackup}>
            Export Full Backup
          </button>
          <button type="button" className="ghost-button compact" onClick={onImportBackup}>
            Import Backup
          </button>
        </div>
      </section>
    </div>
  );
}

export default ExportTab;
