import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  writeBatch,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  WORLD_CUP_2026_MATCHES,
  STAGE_LABELS,
  STAGE_ORDER,
  GROUP_NAMES,
  calculateMatchPoints,
  isMatchDeadlinePassed,
  isMatchPast,
  getFlagUrl,
  POINTS_EXACT_SCORE,
  POINTS_CORRECT_OUTCOME,
  POINTS_WRONG,
} from '../utils/worldCupData.js';

const SCORE_EMPTY = { homeScore: null, awayScore: null };

const deriveOutcome = (h, a) => {
  if (h == null || a == null) return null;
  return h > a ? 'home' : h < a ? 'away' : 'draw';
};

const formatDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function FlagImg({ team, size = 24 }) {
  const url = getFlagUrl(team);
  if (!url) return <span className="wc-flag-placeholder" />;
  return (
    <img
      className="wc-flag"
      src={url}
      alt={team}
      width={size}
      height={size * 0.75}
      loading="lazy"
    />
  );
}

function seedWorldCupMatches(firestore, pairKey) {
  if (!firestore || !pairKey) return;
  const batch = writeBatch(firestore);
  WORLD_CUP_2026_MATCHES.forEach((match) => {
    const ref = doc(firestore, 'worldCupPredictions', `${match.matchKey}_${pairKey}`);
    batch.set(ref, {
      ...match,
      pairKey,
      predictions: { jay: SCORE_EMPTY, kim: SCORE_EMPTY },
      actual: SCORE_EMPTY,
      actualSetAt: null,
      points: { jay: 0, kim: 0 },
      status: 'open',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
  batch.commit().catch((err) => console.warn('World Cup seed failed', err));
}

export default function WorldCupPanel({ user, firestore, isAdmin, currentSeat, pairKey }) {
  const [matchDocs, setMatchDocs] = useState([]);
  const [dbReady, setDbReady] = useState(false);
  const [modalMatchKey, setModalMatchKey] = useState(null);
  const [filter, setFilter] = useState('all');
  const [editTeamHome, setEditTeamHome] = useState('');
  const [editTeamAway, setEditTeamAway] = useState('');

  const seededRef = useRef(false);

  useEffect(() => {
    if (!firestore || !pairKey) { setDbReady(true); return; }
    const q = query(collection(firestore, 'worldCupPredictions'), where('pairKey', '==', pairKey));
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMatchDocs(docs);
      setDbReady(true);
      if (docs.length === 0 && !seededRef.current) {
        seededRef.current = true;
        seedWorldCupMatches(firestore, pairKey);
      }
    }, (err) => { console.warn('WC snapshot error', err); setDbReady(true); });
    return unsub;
  }, [firestore, pairKey]);

  const matches = useMemo(() => {
    const map = {};
    matchDocs.forEach((d) => { map[d.matchKey] = d; });
    return WORLD_CUP_2026_MATCHES.map((m) => {
      const doc = map[m.matchKey] || {};
      return {
        ...m,
        ...doc,
        id: doc.id || `${m.matchKey}_${pairKey}`,
        predictions: doc.predictions || { jay: SCORE_EMPTY, kim: SCORE_EMPTY },
        actual: doc.actual || SCORE_EMPTY,
        points: doc.points || { jay: 0, kim: 0 },
      };
    });
  }, [matchDocs, pairKey]);

  const totPoints = useMemo(() => {
    let j = 0, k = 0;
    matches.forEach((m) => { j += Number(m.points?.jay || 0); k += Number(m.points?.kim || 0); });
    return { jay: j, kim: k };
  }, [matches]);

  const selectedMatch = useMemo(
    () => matches.find((m) => m.matchKey === modalMatchKey) || null,
    [matches, modalMatchKey],
  );

  const nextMatch = useMemo(() => {
    const upcoming = matches
      .filter((m) => {
        if (isMatchDeadlinePassed(m.matchDate)) return false;
        if (m.actual?.homeScore != null) return false;
        const pred = m.predictions?.[currentSeat];
        return pred?.homeScore == null;
      })
      .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    return upcoming[0] || null;
  }, [matches, currentSeat]);

  const nextKickoff = useMemo(() => {
    const upcoming = matches
      .filter((m) => !isMatchPast(m.matchDate))
      .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    return upcoming[0] || null;
  }, [matches]);

  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    const tick = () => {
      if (!nextKickoff) { setCountdown(''); return; }
      const diff = new Date(nextKickoff.matchDate).getTime() - Date.now();
      if (diff <= 0) { setCountdown('LIVE'); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      let parts = [];
      if (d > 0) parts.push(`${d}d`);
      parts.push(`${h}h`.padStart(3, ' '));
      parts.push(`${m}m`.padStart(3, ' '));
      parts.push(`${s}s`.padStart(3, ' '));
      setCountdown(parts.join(' '));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextKickoff]);

  const submitPrediction = useCallback(async (matchKey, homeScore, awayScore) => {
    if (!firestore || !currentSeat || !pairKey) return;
    const ref = doc(firestore, 'worldCupPredictions', `${matchKey}_${pairKey}`);
    await updateDoc(ref, {
      [`predictions.${currentSeat}`]: { homeScore: Number(homeScore), awayScore: Number(awayScore) },
      updatedAt: serverTimestamp(),
    }).catch((err) => console.warn('Prediction save failed', err));
  }, [firestore, currentSeat, pairKey]);

  const submitActual = useCallback(async (matchKey, homeScore, awayScore) => {
    if (!firestore || !isAdmin || !pairKey) return;
    const ref = doc(firestore, 'worldCupPredictions', `${matchKey}_${pairKey}`);
    const points = { jay: 0, kim: 0 };
    const match = matches.find((m) => m.matchKey === matchKey);
    if (match) {
      points.jay = calculateMatchPoints(match.predictions?.jay, { homeScore: Number(homeScore), awayScore: Number(awayScore) });
      points.kim = calculateMatchPoints(match.predictions?.kim, { homeScore: Number(homeScore), awayScore: Number(awayScore) });
    }
    await updateDoc(ref, {
      actual: { homeScore: Number(homeScore), awayScore: Number(awayScore) },
      actualSetAt: serverTimestamp(),
      points,
      status: 'scored',
      updatedAt: serverTimestamp(),
    }).catch((err) => console.warn('Actual score save failed', err));
  }, [firestore, isAdmin, pairKey, matches]);

  const updateTeams = useCallback(async (matchKey, homeTeam, awayTeam) => {
    if (!firestore || !isAdmin || !pairKey) return;
    const ref = doc(firestore, 'worldCupPredictions', `${matchKey}_${pairKey}`);
    await updateDoc(ref, {
      homeTeam,
      awayTeam,
      knockoutPlaceholder: false,
      updatedAt: serverTimestamp(),
    }).catch((err) => console.warn('Team update failed', err));
  }, [firestore, isAdmin, pairKey]);

  const openModal = useCallback((matchKey) => {
    const m = matches.find((x) => x.matchKey === matchKey);
    setModalMatchKey(matchKey);
    setEditTeamHome(m?.homeTeam || '');
    setEditTeamAway(m?.awayTeam || '');
  }, [matches]);

  const closeModal = useCallback(() => {
    setModalMatchKey(null);
  }, []);

  const grouped = useMemo(() => {
    const groups = {};
    STAGE_ORDER.forEach((stage) => { groups[stage] = []; });
    matches.forEach((m) => { if (groups[m.stage]) groups[m.stage].push(m); });
    Object.keys(groups).forEach((stage) => {
      if (stage === 'group') {
        groups[stage].sort((a, b) => {
          const ga = a.groupName || '';
          const gb = b.groupName || '';
          if (ga !== gb) return ga.localeCompare(gb);
          return (a.matchday || 0) - (b.matchday || 0);
        });
      } else {
        groups[stage].sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0));
      }
    });
    return groups;
  }, [matches]);

  if (!dbReady) {
    return <section className="panel lobby-panel wc-panel"><p className="wc-loading">Loading World Cup...</p></section>;
  }

  const outcomeLabel = (h, a) => {
    const o = deriveOutcome(h, a);
    if (o === 'home') return 'Home Win';
    if (o === 'away') return 'Away Win';
    if (o === 'draw') return 'Draw';
    return '';
  };

  const pointsBadge = (pts) => {
    if (pts === POINTS_EXACT_SCORE) return <span className="wc-badge wc-badge--exact" title="Exact score">+5</span>;
    if (pts === POINTS_CORRECT_OUTCOME) return <span className="wc-badge wc-badge--outcome" title="Correct outcome">+2</span>;
    if (pts === 0) return <span className="wc-badge wc-badge--wrong" title="Wrong">0</span>;
    return null;
  };

  const matchStatusIcon = (m) => {
    if (m.actual?.homeScore != null) return '📊';
    if (isMatchDeadlinePassed(m.matchDate)) return '🔒';
    return '⏳';
  };

  return (
    <section className="panel lobby-panel wc-panel" aria-label="World Cup 2026">
      <header className="wc-header">
        <div className="wc-title-row">
          <h2 className="wc-title">🌍 World Cup 2026</h2>
          <div className="wc-points-summary">
            <span className="wc-points wc-points--jay">🟦 Jay: {totPoints.jay}</span>
            <span className="wc-points wc-points--kim">🟪 Kim: {totPoints.kim}</span>
          </div>
          {nextMatch ? (
            <button type="button" className="wc-predict-btn" onClick={() => openModal(nextMatch.matchKey)}>
              <span className="wc-predict-flags">
                <FlagImg team={nextMatch.homeTeam} size={14} />
                <FlagImg team={nextMatch.awayTeam} size={14} />
              </span>
              <span>⚡ Predict Next Match</span>
            </button>
          ) : null}
        </div>
        {nextKickoff ? (
          <button type="button" className="wc-next-card" onClick={() => openModal(nextKickoff.matchKey)}>
            <div className="wc-next-teams">
              <FlagImg team={nextKickoff.homeTeam} size={28} />
              <span className="wc-next-team-name">{shortTeam(nextKickoff.homeTeam)}</span>
              <span className="wc-next-vs">vs</span>
              <span className="wc-next-team-name">{shortTeam(nextKickoff.awayTeam)}</span>
              <FlagImg team={nextKickoff.awayTeam} size={28} />
            </div>
            <div className="wc-next-countdown">{countdown || '—'}</div>
            <div className="wc-next-predictions">
              <span className="wc-next-pred wc-next-pred--jay">🟦 {nextKickoff.predictions?.jay?.homeScore ?? '?'}:{nextKickoff.predictions?.jay?.awayScore ?? '?'}</span>
              <span className="wc-next-pred wc-next-pred--kim">🟪 {nextKickoff.predictions?.kim?.homeScore ?? '?'}:{nextKickoff.predictions?.kim?.awayScore ?? '?'}</span>
            </div>
          </button>
        ) : null}
        <div className="wc-filter-row">
          {['all', 'group', 'knockout'].map((f) => (
            <button key={f} type="button" className={`wc-filter-btn ${filter === f ? 'is-active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All Matches' : f === 'group' ? 'Groups' : 'Knockout'}
            </button>
          ))}
        </div>
      </header>

      {/* Groups Section */}
      {(filter === 'all' || filter === 'group') && (
        <div className="wc-groups-grid">
          {GROUP_NAMES.map((g) => {
            const groupMatches = grouped.group.filter((m) => m.groupName === g);
            if (groupMatches.length === 0) return null;
            return (
              <div key={g} className="wc-group-card">
                <h3 className="wc-group-title">Group {g}</h3>
                <div className="wc-group-matches">
                  {groupMatches.map((m) => (
                    <button key={m.matchKey} type="button" className="wc-match-row" onClick={() => openModal(m.matchKey)}>
                      <span className="wc-match-status">{matchStatusIcon(m)}</span>
                      <span className="wc-match-teams">
                        <FlagImg team={m.homeTeam} />
                        <span className="wc-team-name">{shortTeam(m.homeTeam)}</span>
                        <span className="wc-vs">vs</span>
                        <FlagImg team={m.awayTeam} />
                        <span className="wc-team-name">{shortTeam(m.awayTeam)}</span>
                      </span>
                      <span className="wc-match-predictions">
                        <span className="wc-pred wc-pred--jay">{m.predictions?.jay?.homeScore ?? '-'}:{m.predictions?.jay?.awayScore ?? '-'}</span>
                        <span className="wc-pred-divider">|</span>
                        <span className="wc-pred wc-pred--kim">{m.predictions?.kim?.homeScore ?? '-'}:{m.predictions?.kim?.awayScore ?? '-'}</span>
                      </span>
                      {m.actual?.homeScore != null && (
                        <span className="wc-match-actual">{m.actual.homeScore}-{m.actual.awayScore}</span>
                      )}
                      <span className="wc-match-points">
                        {m.points?.jay != null && m.points?.kim != null && m.actual?.homeScore != null && (
                          <>{pointsBadge(m.points.jay)}{pointsBadge(m.points.kim)}</>
                        )}
                      </span>
                      <span className="wc-match-date">{formatDate(m.matchDate)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Knockout Section */}
      {(filter === 'all' || filter === 'knockout') && (
        <div className="wc-knockout-section">
          <h3 className="wc-section-title">🏆 Knockout Stage</h3>
          {['roundOf32', 'roundOf16', 'quarterFinal', 'semiFinal', 'thirdPlace', 'final'].map((stage) => {
            const stageMatches = grouped[stage];
            if (!stageMatches || stageMatches.length === 0) return null;
            const isBracket = stage === 'quarterFinal' || stage === 'semiFinal' || stage === 'final' || stage === 'thirdPlace';
            return (
              <div key={stage} className={`wc-stage-group ${isBracket ? 'wc-stage-bracket' : ''}`}>
                <h4 className="wc-stage-title">{STAGE_LABELS[stage]}</h4>
                <div className={`wc-stage-matches ${isBracket ? 'wc-bracket-grid' : ''}`}>
                  {stageMatches.map((m) => (
                    <button key={m.matchKey} type="button" className={`wc-match-row ${isBracket ? 'wc-match-row--bracket' : ''}`} onClick={() => openModal(m.matchKey)}>
                      <span className="wc-match-status">{matchStatusIcon(m)}</span>
                      <span className="wc-match-teams">
                        <FlagImg team={m.homeTeam} />
                        <span className="wc-team-name">{shortTeam(m.homeTeam)}</span>
                        <span className="wc-vs">vs</span>
                        <FlagImg team={m.awayTeam} />
                        <span className="wc-team-name">{shortTeam(m.awayTeam)}</span>
                      </span>
                      <span className="wc-match-predictions">
                        <span className="wc-pred wc-pred--jay">{m.predictions?.jay?.homeScore ?? '-'}:{m.predictions?.jay?.awayScore ?? '-'}</span>
                        <span className="wc-pred-divider">|</span>
                        <span className="wc-pred wc-pred--kim">{m.predictions?.kim?.homeScore ?? '-'}:{m.predictions?.kim?.awayScore ?? '-'}</span>
                      </span>
                      {m.actual?.homeScore != null && (
                        <span className="wc-match-actual">{m.actual.homeScore}-{m.actual.awayScore}</span>
                      )}
                      <span className="wc-match-points">
                        {m.points?.jay != null && m.points?.kim != null && m.actual?.homeScore != null && (
                          <>{pointsBadge(m.points.jay)}{pointsBadge(m.points.kim)}</>
                        )}
                      </span>
                      <span className="wc-match-date">{formatDate(m.matchDate)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="wc-footer">
        <span className="wc-legend"><span className="wc-legend-dot wc-legend-dot--exact" /> Exact {POINTS_EXACT_SCORE}pts</span>
        <span className="wc-legend"><span className="wc-legend-dot wc-legend-dot--outcome" /> Outcome {POINTS_CORRECT_OUTCOME}pts</span>
        <span className="wc-legend"><span className="wc-legend-dot wc-legend-dot--wrong" /> Wrong {POINTS_WRONG}pts</span>
      </footer>

      {/* Match Modal */}
      {selectedMatch && createPortal(
        <div className="modal-backdrop" role="presentation" onClick={closeModal}>
          <div className="panel modal-panel wc-modal" role="dialog" aria-modal="true" aria-label="Match details" onClick={(e) => e.stopPropagation()}>
            <MatchDetailModal
              match={selectedMatch}
              currentSeat={currentSeat}
              isAdmin={isAdmin}
              onSubmitPrediction={submitPrediction}
              onSubmitActual={submitActual}
              onUpdateTeams={updateTeams}
              onClose={closeModal}
            />
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}

function shortTeam(name) {
  if (name === 'Bosnia and Herzegovina') return 'Bosnia';
  if (name === "Côte d'Ivoire") return "Côte d'Ivoire";
  if (name === 'Korea Republic') return 'S. Korea';
  if (name === 'IR Iran') return 'Iran';
  if (name === 'Cabo Verde') return 'C. Verde';
  if (name === 'Congo DR') return 'Congo';
  if (name === 'Saudi Arabia') return 'Saudi Ar.';
  if (name === 'Netherlands') return 'Netherlands';
  if (name === 'Switzerland') return 'Switzerland';
  if (name === 'Czechia') return 'Czechia';
  if (name === 'Türkiye') return 'Türkiye';
  if (name === 'New Zealand') return 'N. Zealand';
  if (name.length > 9) return name.slice(0, 8) + '…';
  return name;
}

function MatchDetailModal({ match, currentSeat, isAdmin, onSubmitPrediction, onSubmitActual, onUpdateTeams, onClose }) {
  const [homePred, setHomePred] = useState('');
  const [awayPred, setAwayPred] = useState('');
  const [actualHome, setActualHome] = useState('');
  const [actualAway, setActualAway] = useState('');
  const [saving, setSaving] = useState(false);
  const [editHomeTeam, setEditHomeTeam] = useState(match.homeTeam);
  const [editAwayTeam, setEditAwayTeam] = useState(match.awayTeam);
  const [showTeamEditor, setShowTeamEditor] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState(null);

  const saveTimerRef = useRef(null);
  const statusTimerRef = useRef(null);

  const isPast = isMatchPast(match.matchDate);
  const deadlinePassed = isMatchDeadlinePassed(match.matchDate);
  const canPredict = !deadlinePassed && match.actual?.homeScore == null;
  const existingPred = match.predictions?.[currentSeat];

  useEffect(() => {
    if (existingPred?.homeScore != null) setHomePred(String(existingPred.homeScore));
    if (existingPred?.awayScore != null) setAwayPred(String(existingPred.awayScore));
    if (match.actual?.homeScore != null) setActualHome(String(match.actual.homeScore));
    if (match.actual?.awayScore != null) setActualAway(String(match.actual.awayScore));
    setEditHomeTeam(match.homeTeam);
    setEditAwayTeam(match.awayTeam);
    setAutoSaveStatus(null);
  }, [match.matchKey, match.actual?.homeScore, match.actual?.awayScore, existingPred?.homeScore, existingPred?.awayScore, currentSeat]);

  useEffect(() => {
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    if (autoSaveStatus === 'saved') {
      statusTimerRef.current = window.setTimeout(() => setAutoSaveStatus(null), 2000);
    }
    return () => { if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current); };
  }, [autoSaveStatus]);

  useEffect(() => {
    if (!canPredict) return;
    const h = homePred.trim();
    const a = awayPred.trim();
    if (!h || !a) return;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      setAutoSaveStatus('saving');
      await onSubmitPrediction(match.matchKey, h, a);
      setAutoSaveStatus('saved');
    }, 400);

    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [homePred, awayPred, canPredict, match.matchKey, onSubmitPrediction]);

  const handleSaveActual = async () => {
    if (!isAdmin) return;
    setSaving(true);
    await onSubmitActual(match.matchKey, actualHome, actualAway);
    setSaving(false);
  };

  const handleSaveTeams = async () => {
    if (!isAdmin) return;
    setSaving(true);
    await onUpdateTeams(match.matchKey, editHomeTeam, editAwayTeam);
    setShowTeamEditor(false);
    setSaving(false);
  };

  const homeActual = match.actual?.homeScore;
  const awayActual = match.actual?.awayScore;
  const showJayPoints = homeActual != null && match.predictions?.jay;
  const showKimPoints = homeActual != null && match.predictions?.kim;

  return (
    <div className="wc-modal-inner">
      <div className="wc-modal-header">
        <h3 className="wc-modal-title">
          <FlagImg team={match.homeTeam} size={32} />
          <span>{match.homeTeam}</span>
          <span className="wc-modal-vs">vs</span>
          <FlagImg team={match.awayTeam} size={32} />
          <span>{match.awayTeam}</span>
        </h3>
        <button type="button" className="wc-modal-close" onClick={onClose}>✕</button>
      </div>

      <div className="wc-modal-meta">
        <span>{formatDate(match.matchDate)}</span>
        <span>{match.venue}</span>
        {match.knockoutPlaceholder && isAdmin && (
          <button type="button" className="wc-edit-teams-btn" onClick={() => { setShowTeamEditor(!showTeamEditor); setEditHomeTeam(match.homeTeam); setEditAwayTeam(match.awayTeam); }}>
            ✏️ Edit Teams
          </button>
        )}
      </div>

      {showTeamEditor && isAdmin && (
        <div className="wc-team-editor">
          <label>Home Team: <input value={editHomeTeam} onChange={(e) => setEditHomeTeam(e.target.value)} /></label>
          <label>Away Team: <input value={editAwayTeam} onChange={(e) => setEditAwayTeam(e.target.value)} /></label>
          <button type="button" className="wc-save-btn" onClick={handleSaveTeams} disabled={saving}>Save Teams</button>
        </div>
      )}

      {!match.knockoutPlaceholder && (
        <>
          {/* Prediction Section */}
          <div className="wc-modal-section">
            <h4>Your Prediction {canPredict ? '(Open)' : deadlinePassed ? '(Deadline Passed)' : ''}</h4>
            {currentSeat && (
              <div className="wc-score-inputs">
                <label className={`wc-score-label wc-score-label--${currentSeat}`}>
                  {currentSeat === 'jay' ? '🟦' : '🟪'} {currentSeat === 'jay' ? 'Jay' : 'Kim'}
                </label>
                <input
                  type="number" min="0" max="20" className="wc-score-input"
                  value={homePred} onChange={(e) => setHomePred(e.target.value)}
                  disabled={!canPredict} placeholder="H"
                />
                <span className="wc-score-colon">:</span>
                <input
                  type="number" min="0" max="20" className="wc-score-input"
                  value={awayPred} onChange={(e) => setAwayPred(e.target.value)}
                  disabled={!canPredict} placeholder="A"
                />
                {canPredict && autoSaveStatus === 'saving' && <span className="wc-auto-save-status wc-auto-save-status--saving">Saving…</span>}
                {autoSaveStatus === 'saved' && <span className="wc-auto-save-status wc-auto-save-status--saved">✓ Saved</span>}
              </div>
            )}
            {!currentSeat && <p className="wc-muted">Sign in to predict</p>}
          </div>

          {/* Other Player's Prediction */}
          {match.predictions?.jay && currentSeat !== 'jay' && (
            <div className="wc-modal-section">
              <h4>🟦 Jay's Prediction</h4>
              <p className="wc-other-pred">{match.predictions.jay.homeScore ?? '-'} - {match.predictions.jay.awayScore ?? '-'}</p>
            </div>
          )}
          {match.predictions?.kim && currentSeat !== 'kim' && (
            <div className="wc-modal-section">
              <h4>🟪 Kim's Prediction</h4>
              <p className="wc-other-pred">{match.predictions.kim.homeScore ?? '-'} - {match.predictions.kim.awayScore ?? '-'}</p>
            </div>
          )}

          {/* Actual Score (admin only) */}
          {isAdmin && isPast && homeActual == null && (
            <div className="wc-modal-section">
              <h4>👑 Enter Actual Score</h4>
              <div className="wc-score-inputs">
                <input type="number" min="0" max="30" className="wc-score-input" value={actualHome} onChange={(e) => setActualHome(e.target.value)} placeholder="H" />
                <span className="wc-score-colon">:</span>
                <input type="number" min="0" max="30" className="wc-score-input" value={actualAway} onChange={(e) => setActualAway(e.target.value)} placeholder="A" />
                <button type="button" className="wc-save-btn" onClick={handleSaveActual} disabled={saving || !actualHome || !actualAway}>
                  {saving ? 'Saving...' : 'Set Result'}
                </button>
              </div>
            </div>
          )}

          {/* Actual Score Display */}
          {homeActual != null && (
            <div className="wc-modal-section">
              <h4>📊 Final Score</h4>
              <p className={`wc-actual-display ${showJayPoints || showKimPoints ? 'wc-actual--done' : ''}`}>
                <strong>{homeActual} - {awayActual}</strong>
                <span className="wc-actual-outcome">{outcomeLabel(homeActual, awayActual)}</span>
              </p>
              <div className="wc-points-breakdown">
                <div className="wc-player-points">
                  <span>🟦 Jay:</span>
                  <span>{showJayPoints ? calculateMatchPoints(match.predictions?.jay, { homeScore: homeActual, awayScore: awayActual }) : '?'} pts</span>
                  <span className="wc-pred-detail">
                    (Predicted: {match.predictions?.jay?.homeScore ?? '-'}-{match.predictions?.jay?.awayScore ?? '-'})
                  </span>
                </div>
                <div className="wc-player-points">
                  <span>🟪 Kim:</span>
                  <span>{showKimPoints ? calculateMatchPoints(match.predictions?.kim, { homeScore: homeActual, awayScore: awayActual }) : '?'} pts</span>
                  <span className="wc-pred-detail">
                    (Predicted: {match.predictions?.kim?.homeScore ?? '-'}-{match.predictions?.kim?.awayScore ?? '-'})
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {match.knockoutPlaceholder && !showTeamEditor && (
        <p className="wc-muted">Teams will be determined after group stage. Admin can edit team names.</p>
      )}
    </div>
  );
}
