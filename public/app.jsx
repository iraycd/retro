const { useState, useEffect, useRef, useCallback } = React;

// ── Session identity ──────────────────────────────────────────────────────────
function getOrCreateSessionId() {
  let sid = localStorage.getItem("retro.sessionId");
  if (!sid) { sid = "s_" + Math.random().toString(36).slice(2, 10); localStorage.setItem("retro.sessionId", sid); }
  return sid;
}
function getAdminToken() { return localStorage.getItem("retro.adminToken"); }
function saveAdminToken(tok) { tok ? localStorage.setItem("retro.adminToken", tok) : localStorage.removeItem("retro.adminToken"); }
function getSavedName() { return localStorage.getItem("retro.name") || ""; }
function saveName(n) { localStorage.setItem("retro.name", n); }

// Pick up ?adminToken=... from URL on first load
;(function() {
  const params = new URLSearchParams(window.location.search);
  const tok = params.get("adminToken");
  if (tok) { localStorage.setItem("retro.adminToken", tok); window.history.replaceState({}, "", window.location.pathname); }
})();

// ── Toast hook ────────────────────────────────────────────────────────────────
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, fading: false }]);
    setTimeout(() => setToasts(t => t.map(x => x.id === id ? { ...x, fading: true } : x)), 2800);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);
  return [toasts, add];
}

// ── WS hook ───────────────────────────────────────────────────────────────────
function useRetroWS(onMessage) {
  const wsRef = useRef(null);
  const retryRef = useRef(500);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retryRef.current = 500;
      const name = getSavedName();
      ws.send(JSON.stringify({ type: "hello", sessionId: getOrCreateSessionId(), adminToken: getAdminToken() || undefined, name: name || undefined }));
    };

    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch(_) {}
    };

    ws.onclose = () => {
      setConnected(false);
      const delay = retryRef.current;
      retryRef.current = Math.min(retryRef.current * 1.5, 5000);
      setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, [onMessage]);

  useEffect(() => { connect(); return () => wsRef.current?.close(); }, []);

  const send = useCallback((obj) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(obj));
  }, []);

  return [send, connected];
}

// ── Card component ────────────────────────────────────────────────────────────
function Card({ card, phase, config, myVotes, myVotesRemaining, isAdmin, isMuted, send, addToast }) {
  const textRef = useRef(null);

  const canEdit = card.mine && !isMuted && (
    phase === "write" || (phase === "reveal" && config.writingAllowedInReveal)
  );
  const canVote = phase === "vote" && !isMuted;
  const hasVoted = myVotes.includes(card.id);
  const voteCount = myVotes.filter(id => id === card.id).length;
  const voteLabel = card.votes > 0 ? `▲ ${card.votes}` : "▲ 0";

  function handleBlur() {
    if (!canEdit) return;
    const text = textRef.current?.innerText?.trim();
    if (text && text !== card.text) send({ type: "editCard", cardId: card.id, text });
  }

  function handleDelete() {
    if (window.confirm("Delete this card?")) send({ type: "deleteCard", cardId: card.id });
  }

  function handleVote() {
    if (!canVote) return;
    if (hasVoted) {
      send({ type: "retractVote", cardId: card.id });
    } else {
      if (myVotesRemaining <= 0) { addToast("Vote limit reached"); return; }
      send({ type: "castVote", cardId: card.id });
    }
  }

  return (
    <div className={`card ${card.mine ? "mine" : ""}`}>
      <div
        ref={textRef}
        className="card-text"
        contentEditable={canEdit}
        suppressContentEditableWarning
        onBlur={handleBlur}
        dangerouslySetInnerHTML={{ __html: escHtml(card.text) }}
      />
      <div className="card-footer">
        <div>
          {(phase === "vote" || phase === "discuss") && (
            <button
              className={`vote-btn ${hasVoted ? "voted" : ""}`}
              onClick={handleVote}
              disabled={!canVote}
              title={hasVoted ? "Retract vote" : "Cast vote"}
            >
              {voteLabel}
            </button>
          )}
        </div>
        <div className="card-actions">
          {canEdit && (
            <button className="icon-btn edit" onClick={() => textRef.current?.focus()} title="Edit">✎</button>
          )}
          {(card.mine || isAdmin) && (phase === "write" || (phase === "reveal" && config.writingAllowedInReveal) || isAdmin) && (
            <button className="icon-btn" onClick={handleDelete} title="Delete">✕</button>
          )}
        </div>
      </div>
    </div>
  );
}

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Column component ──────────────────────────────────────────────────────────
function Column({ col, cards, phase, config, myVotes, myVotesRemaining, isAdmin, isMuted, send, addToast }) {
  const [text, setText] = useState("");
  const colCards = cards.filter(c => c.columnId === col.id);
  const [labelEditing, setLabelEditing] = useState(false);
  const [labelVal, setLabelVal] = useState(col.label);
  const labelRef = useRef(null);

  useEffect(() => { setLabelVal(col.label); }, [col.label]);

  function handleLabelBlur() {
    setLabelEditing(false);
    const v = labelVal.trim();
    if (v && v !== col.label) send({ type: "admin:setColumnLabel", columnId: col.id, label: v });
  }

  function addCard() {
    const t = text.trim();
    if (!t) return;
    send({ type: "addCard", columnId: col.id, text: t });
    setText("");
  }

  const canWrite = !isMuted && (phase === "write" || (phase === "reveal" && config.writingAllowedInReveal));
  const othersHidden = phase === "write";
  const othersCount = othersHidden ? 0 : 0; // we don't get others' cards during write — server hides them

  return (
    <div className="column">
      <div className="col-header">
        <input
          ref={labelRef}
          className={`col-label-input ${col.color}`}
          value={labelVal}
          readOnly={!isAdmin}
          onChange={e => setLabelVal(e.target.value)}
          onFocus={() => isAdmin && setLabelEditing(true)}
          onBlur={handleLabelBlur}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); labelRef.current?.blur(); } }}
          style={{ cursor: isAdmin ? "text" : "default" }}
        />
        <span className="col-count">{colCards.length} card{colCards.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="cards">
        {colCards.map(card => (
          <Card
            key={card.id}
            card={card}
            phase={phase}
            config={config}
            myVotes={myVotes}
            myVotesRemaining={myVotesRemaining}
            isAdmin={isAdmin}
            isMuted={isMuted}
            send={send}
            addToast={addToast}
          />
        ))}
        {phase === "write" && colCards.length === 0 && (
          <div className="hidden-cards-hint">Others' cards hidden until reveal</div>
        )}
      </div>

      {canWrite && (
        <div className="new-card-area">
          <textarea
            className="new-card-textarea"
            placeholder="Add a card…"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addCard(); } }}
            rows={2}
          />
          <button className="add-btn" onClick={addCard}>+ Add card</button>
        </div>
      )}
    </div>
  );
}

// ── Name prompt ───────────────────────────────────────────────────────────────
function NamePrompt({ onDone }) {
  const [val, setVal] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  function submit(e) {
    e.preventDefault();
    const name = val.trim();
    if (!name) return;
    saveName(name);
    onDone(name);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 360 }}>
        <h3>Welcome to the Retro</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
          Enter your name to join. Only the admin can see who wrote what.
        </p>
        <form onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Your name"
            value={val}
            onChange={e => setVal(e.target.value)}
            maxLength={40}
            style={{
              width: "100%", fontSize: 14, padding: "8px 10px",
              border: "1px solid var(--border-light)", borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-sans)", outline: "none", marginBottom: 12,
            }}
            onFocus={e => e.target.style.borderColor = "var(--border-medium)"}
            onBlur={e => e.target.style.borderColor = "var(--border-light)"}
          />
          <div className="modal-actions">
            <button type="submit" className="btn primary" disabled={!val.trim()}>Join</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Timer components ──────────────────────────────────────────────────────────
function fmtTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const DURATIONS = [
  { label: "1 min",  secs: 60   },
  { label: "2 min",  secs: 120  },
  { label: "3 min",  secs: 180  },
  { label: "5 min",  secs: 300  },
  { label: "8 min",  secs: 480  },
  { label: "10 min", secs: 600  },
  { label: "15 min", secs: 900  },
];

function TimerChip({ timer }) {
  if (!timer) return null;
  const { remainingSecs, running, durationSecs } = timer;
  const expired = remainingSecs <= 0 && !running;
  const low = running && remainingSecs > 0 && remainingSecs <= 30;
  const cls = expired ? "expired" : low ? "low" : running ? "running" : "";
  const icon = running ? "▶" : "⏸";
  return (
    <span className={`timer-chip ${cls}`}>
      {expired ? "⏰ Time's up!" : `${running ? "▶" : "⏸"} ${fmtTime(remainingSecs)}`}
    </span>
  );
}

function TimerAdminRow({ timer, send }) {
  if (!timer) return null;
  const { remainingSecs, running, durationSecs } = timer;
  const expired = remainingSecs <= 0;

  function setDuration(e) {
    send({ type: "admin:timer", action: "setDuration", durationSecs: parseInt(e.target.value, 10) });
  }
  function start()  { send({ type: "admin:timer", action: "start"  }); }
  function pause()  { send({ type: "admin:timer", action: "pause"  }); }
  function reset()  { send({ type: "admin:timer", action: "reset"  }); }

  return (
    <div className="admin-row">
      <span className="admin-label">Timer</span>
      <div className="timer-controls">
        <select className="timer-dur-select" value={durationSecs} onChange={setDuration} disabled={running}>
          {DURATIONS.map(d => <option key={d.secs} value={d.secs}>{d.label}</option>)}
        </select>
        {running
          ? <button className="btn sm" onClick={pause}>Pause</button>
          : <button className="btn sm primary" onClick={start} disabled={expired && remainingSecs === 0 && durationSecs === remainingSecs === false}>Start</button>
        }
        <button className="btn sm" onClick={reset}>Reset</button>
        <TimerChip timer={timer} />
      </div>
    </div>
  );
}

// ── Admin Panel ───────────────────────────────────────────────────────────────
function AdminPanel({ state, send, mySessionId, addToast }) {
  const { phase, config, participants } = state;

  function setPhase(p) { send({ type: "admin:setPhase", phase: p }); }
  function toggleConfig(key, val) { send({ type: "admin:setConfig", [key]: val }); }

  function handleMaxVotes(e) {
    const n = parseInt(e.target.value, 10);
    if (n >= 1 && n <= 20) send({ type: "admin:setConfig", maxVotesPerPerson: n });
  }

  function exportBoard() { send({ type: "admin:export" }); }

  function clearAll() {
    if (window.confirm("Clear ALL cards and votes? This cannot be undone.")) send({ type: "admin:clearAll" });
  }

  function copyAdminLink() {
    const tok = getAdminToken();
    if (!tok) return;
    const url = `${location.origin}/?adminToken=${tok}`;
    navigator.clipboard.writeText(url).then(() => addToast("Admin link copied!")).catch(() => addToast("Copy failed — link: " + url));
  }

  function kickParticipant(sid) {
    if (window.confirm(`Kick this participant?`)) send({ type: "admin:kick", sessionId: sid });
  }

  function toggleMute(sid, currently) {
    send({ type: "admin:mute", sessionId: sid, muted: !currently });
  }

  const PHASES = ["write", "reveal", "vote", "discuss"];

  return (
    <div className="admin-panel">
      <div className="admin-panel-title">Admin Controls</div>

      <div className="admin-row">
        <span className="admin-label">Phase</span>
        <div className="phase-btns">
          {PHASES.map(p => (
            <button key={p} className={`phase-btn ${phase === p ? "active" : ""}`} onClick={() => setPhase(p)}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-row">
        <span className="admin-label">Max votes</span>
        <input className="num-input" type="number" min="1" max="20" value={config.maxVotesPerPerson} onChange={handleMaxVotes} />
        <label className="toggle-label">
          <input type="checkbox" className="toggle-input" checked={config.allowMultiVotePerCard} onChange={e => toggleConfig("allowMultiVotePerCard", e.target.checked)} />
          <span className="toggle-track"></span>
          Multi-vote per card
        </label>
      </div>

      <div className="admin-row">
        <label className="toggle-label">
          <input type="checkbox" className="toggle-input" checked={config.writingAllowedInReveal} onChange={e => toggleConfig("writingAllowedInReveal", e.target.checked)} />
          <span className="toggle-track"></span>
          Allow writing during Reveal phase
        </label>
      </div>

      <TimerAdminRow timer={state.timer} send={send} />

      <hr className="divider" />

      {participants && participants.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <table className="participants-table">
            <thead>
              <tr><th>Participant</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {participants.map(p => (
                <tr key={p.sessionId}>
                  <td>
                    <span style={{ fontSize: 13 }}>{p.name || "Anonymous"}</span>
                    {p.sessionId === mySessionId && <span className="tag you" style={{ marginLeft: 4 }}>you</span>}
                  </td>
                  <td>
                    {p.muted && <span className="tag muted">muted</span>}
                    {p.sessionId === mySessionId && <span className="tag admin">admin</span>}
                  </td>
                  <td>
                    {p.sessionId !== mySessionId && (
                      <>
                        <button className="btn sm" style={{ marginRight: 4 }} onClick={() => toggleMute(p.sessionId, p.muted)}>
                          {p.muted ? "Unmute" : "Mute"}
                        </button>
                        <button className="btn sm danger" onClick={() => kickParticipant(p.sessionId)}>Kick</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="admin-row">
        <button className="btn sm" onClick={copyAdminLink}>Copy admin link</button>
        <button className="btn sm" onClick={exportBoard}>Export</button>
        <button className="btn sm danger" onClick={clearAll}>Clear all</button>
      </div>
    </div>
  );
}

// ── Export Modal ──────────────────────────────────────────────────────────────
function ExportModal({ markdown, onClose }) {
  const taRef = useRef(null);
  function copy() {
    taRef.current?.select();
    document.execCommand("copy");
  }
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>Export as Markdown</h3>
        <textarea ref={taRef} readOnly value={markdown} />
        <div className="modal-actions">
          <button className="btn" onClick={copy}>Copy</button>
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  const [boardState, setBoardState] = useState(null);
  const [kicked, setKicked] = useState(false);
  const [exportMd, setExportMd] = useState(null);
  const [toasts, addToast] = useToasts();
  const sessionId = getOrCreateSessionId();
  const [userCount, setUserCount] = useState(1);
  const [titleVal, setTitleVal] = useState("");
  const [myName, setMyName] = useState(getSavedName());

  const handleMessage = useCallback((msg) => {
    if (msg.type === "welcome") {
      if (msg.adminToken) saveAdminToken(msg.adminToken);
    } else if (msg.type === "state") {
      setBoardState(msg.state);
      setUserCount(msg.state.participants?.length ?? userCount);
      setTitleVal(prev => msg.state.title !== prev && document.activeElement?.dataset?.titleInput ? prev : msg.state.title);
    } else if (msg.type === "kicked") {
      setKicked(true);
    } else if (msg.type === "exportResult") {
      setExportMd(msg.markdown);
    } else if (msg.type === "error") {
      addToast(msg.message || msg.code);
    }
  }, []);

  const [send, connected] = useRetroWS(handleMessage);

  // Sync userCount from participants list
  useEffect(() => {
    if (boardState?.participants) setUserCount(boardState.participants.length);
  }, [boardState?.participants]);

  function handleTitleBlur(e) {
    const v = e.target.value.trim();
    if (v && v !== boardState?.title) send({ type: "admin:setTitle", title: v });
  }

  function handleNameDone(name) {
    setMyName(name);
    send({ type: "setName", name });
  }

  if (!myName) {
    return <NamePrompt onDone={handleNameDone} />;
  }

  if (kicked) {
    return (
      <div className="kicked-screen">
        <h2>You were removed</h2>
        <p>You have been removed from this retro session by the admin.</p>
      </div>
    );
  }

  const phase = boardState?.phase || "write";
  const PHASE_LABELS = { write: "Write", reveal: "Reveal", vote: "Vote", discuss: "Discuss" };

  return (
    <div className="app">
      {!connected && <div className="reconnect-bar">Reconnecting…</div>}
      {boardState?.isMuted && (
        <div className="banner warn">⚠ You have been muted by the admin. You can view but not add or edit cards.</div>
      )}

      <header className="header">
        <div className="header-left">
          {boardState?.isAdmin ? (
            <input
              className="board-title-input"
              value={titleVal}
              data-title-input="true"
              onChange={e => setTitleVal(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
            />
          ) : (
            <span className="board-title-input" style={{ display: "block" }}>{boardState?.title || "Retro Board"}</span>
          )}
          <span className={`phase-badge ${phase}`}>{PHASE_LABELS[phase]}</span>
        </div>
        <div className="header-right">
          {phase === "vote" && boardState && !boardState.isAdmin && (
            <span className="votes-left">{boardState.myVotesRemaining} vote{boardState.myVotesRemaining !== 1 ? "s" : ""} left</span>
          )}
          {boardState?.timer && (boardState.timer.running || boardState.timer.remainingSecs < boardState.timer.durationSecs) && (
            <TimerChip timer={boardState.timer} />
          )}
          <span className="presence-chip" title={myName} style={{ cursor: "default" }}>
            {connected ? `● ${userCount || 1} connected` : "○ offline"} · {myName}
          </span>
        </div>
      </header>

      <main className="main-content">
        {boardState?.isAdmin && (
          <AdminPanel state={boardState} send={send} mySessionId={sessionId} addToast={addToast} />
        )}

        {boardState ? (
          <div className="board">
            {boardState.columns.map(col => (
              <Column
                key={col.id}
                col={col}
                cards={boardState.cards}
                phase={boardState.phase}
                config={boardState.config}
                myVotes={boardState.myVotes}
                myVotesRemaining={boardState.myVotesRemaining}
                isAdmin={boardState.isAdmin}
                isMuted={boardState.isMuted}
                send={send}
                addToast={addToast}
              />
            ))}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}>
            {connected ? "Loading…" : "Connecting to server…"}
          </div>
        )}
      </main>

      {exportMd && <ExportModal markdown={exportMd} onClose={() => setExportMd(null)} />}

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.fading ? "fading" : ""}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
