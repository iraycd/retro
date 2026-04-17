import { useState, useEffect, useRef, useCallback } from "react";
import { useRetroWS } from "../hooks/useRetroWS";
import { useToasts } from "../hooks/useToasts";
import { useConfirm } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { useRouter } from "../routing";
import {
  getOrCreateSessionId, getAdminToken, saveAdminToken,
  getSavedName, saveName, fmtTime, escHtml, DURATIONS, PHASE_LABELS,
} from "../utils";
import type { BoardStateView, CardView, Column, TimerView, ClientMsg, ServerMsg } from "../types";

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardProps {
  card: CardView;
  phase: string;
  config: BoardStateView["config"];
  myVotes: string[];
  myVotesRemaining: number;
  isAdmin: boolean;
  isMuted: boolean;
  send: (m: ClientMsg) => void;
  addToast: (msg: string) => void;
}

function Card({ card, phase, config, myVotes, myVotesRemaining, isAdmin, isMuted, send, addToast }: CardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const confirm = useConfirm();

  const canEdit = card.mine && !isMuted && (phase === "write" || (phase === "reveal" && config.writingAllowedInReveal));
  const canVote = phase === "vote" && !isMuted;
  const hasVoted = myVotes.includes(card.id);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  function handleBlur() {
    if (!canEdit || !textareaRef.current) return;
    const text = textareaRef.current.value.trim();
    if (text && text !== card.text) send({ type: "editCard", cardId: card.id, text });
  }

  async function handleDelete() {
    const ok = await confirm({ title: "Delete this card?", confirmLabel: "Delete", danger: true });
    if (ok) send({ type: "deleteCard", cardId: card.id });
  }

  function handleVote() {
    if (!canVote) return;
    if (hasVoted) { send({ type: "retractVote", cardId: card.id }); }
    else { if (myVotesRemaining <= 0) { addToast("Vote limit reached"); return; } send({ type: "castVote", cardId: card.id }); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (canVote) handleVote();
      else if (canEdit) textareaRef.current?.focus();
    }
  }

  return (
    <div className={`card ${card.mine ? "mine" : ""}`} role="group" aria-label={`Card: ${card.text}`} tabIndex={0} onKeyDown={handleKeyDown}>
      {canEdit ? (
        <textarea
          ref={textareaRef}
          className="card-text card-textarea"
          defaultValue={card.text}
          onBlur={handleBlur}
          onInput={e => autoGrow(e.currentTarget)}
          rows={2}
          aria-label="Edit card text"
        />
      ) : (
        <div className="card-text" dangerouslySetInnerHTML={{ __html: escHtml(card.text) }} />
      )}
      <div className="card-footer">
        <div>
          {(phase === "vote" || phase === "discuss") && (
            <button className={`vote-btn ${hasVoted ? "voted" : ""}`} onClick={handleVote} disabled={!canVote}
              title={hasVoted ? "Retract vote" : "Cast vote"} aria-pressed={hasVoted}>
              {card.votes > 0 ? `▲ ${card.votes}` : "▲ 0"}
            </button>
          )}
        </div>
        <div className="card-actions">
          {canEdit && <button className="icon-btn edit" onClick={() => textareaRef.current?.focus()} title="Edit">✎</button>}
          {(card.mine || isAdmin) && (phase === "write" || (phase === "reveal" && config.writingAllowedInReveal) || isAdmin) && (
            <button className="icon-btn" onClick={handleDelete} title="Delete card" aria-label="Delete card">✕</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Column ────────────────────────────────────────────────────────────────────

interface ColumnProps {
  col: Column;
  cards: CardView[];
  phase: string;
  config: BoardStateView["config"];
  myVotes: string[];
  myVotesRemaining: number;
  isAdmin: boolean;
  isMuted: boolean;
  send: (m: ClientMsg) => void;
  addToast: (msg: string) => void;
}

function ColumnComp({ col, cards, phase, config, myVotes, myVotesRemaining, isAdmin, isMuted, send, addToast }: ColumnProps) {
  const [text, setText] = useState("");
  const colCards = cards.filter(c => c.columnId === col.id);
  const [labelVal, setLabelVal] = useState(col.label);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setLabelVal(col.label); }, [col.label]);

  function handleLabelBlur() {
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

  return (
    <div className="column">
      <div className="col-header">
        <input ref={labelRef} className={`col-label-input ${col.color}`} value={labelVal} readOnly={!isAdmin}
          onChange={e => setLabelVal(e.target.value)} onBlur={handleLabelBlur}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); labelRef.current?.blur(); } }}
          style={{ cursor: isAdmin ? "text" : "default" }} aria-label={`Column label: ${col.label}`} />
        <span className="col-count" aria-live="polite">{colCards.length} card{colCards.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="cards">
        {colCards.map(card => (
          <Card key={card.id} card={card} phase={phase} config={config} myVotes={myVotes}
            myVotesRemaining={myVotesRemaining} isAdmin={isAdmin} isMuted={isMuted} send={send} addToast={addToast} />
        ))}
        {phase === "write" && colCards.length === 0 && <div className="hidden-cards-hint">Others' cards hidden until reveal</div>}
      </div>
      {canWrite && (
        <div className="new-card-area">
          <textarea className="new-card-textarea" placeholder="Add a card…" value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addCard(); } }}
            rows={2} aria-label={`Add card to ${col.label}`} />
          <button className="add-btn" onClick={addCard}>+ Add card</button>
        </div>
      )}
    </div>
  );
}

// ── Name prompt ───────────────────────────────────────────────────────────────

function NamePrompt({ onDone }: { onDone: (name: string) => void }) {
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = val.trim();
    if (!name) return;
    saveName(name);
    onDone(name);
  }

  return (
    <Modal title="Welcome to the Retro" onClose={() => {}} maxWidth={360}>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
        Enter your name to join. Only the admin can see who wrote what.
      </p>
      <form onSubmit={submit}>
        <input ref={inputRef} type="text" placeholder="Your name" value={val} onChange={e => setVal(e.target.value)}
          maxLength={40} aria-label="Your name" style={{
            width: "100%", fontSize: 14, padding: "8px 10px", boxSizing: "border-box",
            border: "1px solid var(--border-light)", borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)", outline: "none", marginBottom: 12,
          }}
          onFocus={e => (e.target.style.borderColor = "var(--border-medium)")}
          onBlur={e => (e.target.style.borderColor = "var(--border-light)")} />
        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={!val.trim()}>Join</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function TimerChip({ timer }: { timer: TimerView }) {
  const { remainingSecs, running } = timer;
  const expired = remainingSecs <= 0 && !running;
  const low = running && remainingSecs > 0 && remainingSecs <= 30;
  const cls = expired ? "expired" : low ? "low" : running ? "running" : "";
  return (
    <span className={`timer-chip ${cls}`} aria-label={`Timer: ${expired ? "time's up" : fmtTime(remainingSecs)}`}>
      {expired ? "⏰ Time's up!" : `${running ? "▶" : "⏸"} ${fmtTime(remainingSecs)}`}
    </span>
  );
}

function TimerAdminRow({ timer, send }: { timer: TimerView; send: (m: ClientMsg) => void }) {
  const { remainingSecs, running, durationSecs } = timer;
  const expired = remainingSecs <= 0;
  return (
    <div className="admin-row">
      <span className="admin-label">Timer</span>
      <div className="timer-controls">
        <select className="timer-dur-select" value={durationSecs} disabled={running} aria-label="Timer duration"
          onChange={e => send({ type: "admin:timer", action: "setDuration", durationSecs: parseInt(e.target.value, 10) })}>
          {DURATIONS.map(d => <option key={d.secs} value={d.secs}>{d.label}</option>)}
        </select>
        {running
          ? <button className="btn sm" onClick={() => send({ type: "admin:timer", action: "pause" })}>Pause</button>
          : <button className="btn sm primary" disabled={expired && remainingSecs === 0}
              onClick={() => send({ type: "admin:timer", action: "start" })}>Start</button>}
        <button className="btn sm" onClick={() => send({ type: "admin:timer", action: "reset" })}>Reset</button>
        <TimerChip timer={timer} />
      </div>
    </div>
  );
}

// ── Admin Panel ───────────────────────────────────────────────────────────────

function AdminPanel({ state, send, mySessionId, addToast, boardCode }: {
  state: BoardStateView; send: (m: ClientMsg) => void;
  mySessionId: string; addToast: (msg: string) => void; boardCode: string;
}) {
  const { phase, config, participants } = state;
  const confirm = useConfirm();
  const PHASES = ["write", "reveal", "vote", "discuss"] as const;

  function copyAdminLink() {
    const tok = getAdminToken(boardCode);
    if (!tok) return;
    const url = `${location.origin}/b/${boardCode}?adminToken=${tok}`;
    navigator.clipboard.writeText(url)
      .then(() => addToast("Admin link copied!"))
      .catch(() => addToast("Copy failed — link: " + url));
  }

  async function handleClearAll() {
    const ok = await confirm({ title: "Clear all cards and votes?", body: "This cannot be undone.", confirmLabel: "Clear all", danger: true });
    if (ok) send({ type: "admin:clearAll" });
  }

  async function handleKick(sid: string) {
    const ok = await confirm({ title: "Kick this participant?", confirmLabel: "Kick", danger: true });
    if (ok) send({ type: "admin:kick", sessionId: sid });
  }

  return (
    <div className="admin-panel" role="region" aria-label="Admin controls">
      <div className="admin-panel-title">Admin Controls</div>
      <div className="admin-row">
        <span className="admin-label" id="phase-label">Phase</span>
        <div className="phase-btns" role="group" aria-labelledby="phase-label">
          {PHASES.map(p => (
            <button key={p} className={`phase-btn ${phase === p ? "active" : ""}`} aria-pressed={phase === p}
              onClick={() => send({ type: "admin:setPhase", phase: p })}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="admin-row">
        <label htmlFor="max-votes-input" className="admin-label">Max votes</label>
        <input id="max-votes-input" className="num-input" type="number" min="1" max="20" value={config.maxVotesPerPerson}
          onChange={e => { const n = parseInt(e.target.value, 10); if (n >= 1 && n <= 20) send({ type: "admin:setConfig", maxVotesPerPerson: n }); }} />
        <label className="toggle-label">
          <input type="checkbox" className="toggle-input" checked={config.allowMultiVotePerCard}
            onChange={e => send({ type: "admin:setConfig", allowMultiVotePerCard: e.target.checked })} />
          <span className="toggle-track"></span>Multi-vote per card
        </label>
      </div>
      <div className="admin-row">
        <label className="toggle-label">
          <input type="checkbox" className="toggle-input" checked={config.writingAllowedInReveal}
            onChange={e => send({ type: "admin:setConfig", writingAllowedInReveal: e.target.checked })} />
          <span className="toggle-track"></span>Allow writing during Reveal phase
        </label>
      </div>
      <TimerAdminRow timer={state.timer} send={send} />
      <hr className="divider" />
      {participants && participants.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <table className="participants-table">
            <thead><tr><th>Participant</th><th>Status</th><th>Actions</th></tr></thead>
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
                        <button className="btn sm" style={{ marginRight: 4 }}
                          onClick={() => send({ type: "admin:mute", sessionId: p.sessionId, muted: !p.muted })}
                          aria-label={`${p.muted ? "Unmute" : "Mute"} ${p.name || "participant"}`}>
                          {p.muted ? "Unmute" : "Mute"}
                        </button>
                        <button className="btn sm danger" onClick={() => handleKick(p.sessionId)}
                          aria-label={`Kick ${p.name || "participant"}`}>Kick</button>
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
        <button className="btn sm" onClick={() => send({ type: "admin:export" })}>Export</button>
        <button className="btn sm danger" onClick={handleClearAll}>Clear all</button>
      </div>
    </div>
  );
}

// ── Export Modal ──────────────────────────────────────────────────────────────

function ExportModal({ markdown, onClose }: { markdown: string; onClose: () => void }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  function copy() {
    navigator.clipboard.writeText(markdown).catch(() => { taRef.current?.select(); document.execCommand("copy"); });
  }
  return (
    <Modal title="Export as Markdown" onClose={onClose}>
      <textarea ref={taRef} readOnly value={markdown} aria-label="Exported markdown" />
      <div className="modal-actions">
        <button className="btn" onClick={copy}>Copy</button>
        <button className="btn primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

// ── Board page ────────────────────────────────────────────────────────────────

export function BoardPage({ code }: { code: string }) {
  const { navigate } = useRouter();
  const [boardId, setBoardId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  // Resolve code → id via HTTP before connecting WS
  useEffect(() => {
    const upper = code.startsWith("r-") || code.startsWith("R-")
      ? "r-" + code.slice(2).toUpperCase()
      : code.toUpperCase();
    // Pick up ?adminToken from URL — namespaced by code
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("adminToken");
    if (urlToken) {
      saveAdminToken(upper, urlToken);
      window.history.replaceState({}, "", `/b/${upper}`);
    }

    fetch(`/api/boards/${upper}`)
      .then(r => { if (!r.ok) throw new Error("not_found"); return r.json(); })
      .then(data => setBoardId(data.id))
      .catch(() => setLoadError("Board not found"));
  }, [code]);

  if (loadError) {
    return (
      <div className="kicked-screen" role="alert">
        <h2>Board not found</h2>
        <p>The code <strong>{code.toUpperCase()}</strong> doesn't match any board.</p>
        <button className="btn primary" style={{ marginTop: 16 }} onClick={() => navigate("/")}>Create a new board</button>
      </div>
    );
  }

  if (!boardId) {
    return <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-muted)" }}>Loading…</div>;
  }

  const normalCode = code.startsWith("r-") || code.startsWith("R-")
    ? "r-" + code.slice(2).toUpperCase()
    : code.toUpperCase();
  return <BoardView boardId={boardId} boardCode={normalCode} />;
}

function BoardView({ boardId, boardCode }: { boardId: string; boardCode: string }) {
  const [boardState, setBoardState] = useState<BoardStateView | null>(null);
  const [kicked, setKicked] = useState(false);
  const [exportMd, setExportMd] = useState<string | null>(null);
  const [toasts, addToast] = useToasts();
  const sessionId = getOrCreateSessionId();
  const [userCount, setUserCount] = useState(1);
  const [titleVal, setTitleVal] = useState("");
  const [myName, setMyName] = useState(getSavedName());
  const isKickedRef = useRef(false);
  const kickedHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingToken = useRef(getAdminToken(boardCode));

  const handleMessage = useCallback((msg: ServerMsg) => {
    if (msg.type === "welcome") {
      if (msg.adminToken) {
        saveAdminToken(boardCode, msg.adminToken);
        pendingToken.current = null;
      } else if (pendingToken.current) {
        addToast("Admin link expired or invalid");
        pendingToken.current = null;
      }
    } else if (msg.type === "state") {
      setBoardState(msg.state);
      setUserCount(msg.state.participants?.length ?? 1);
      setTitleVal(prev =>
        msg.state.title !== prev && document.activeElement?.getAttribute("data-title-input") ? prev : msg.state.title
      );
    } else if (msg.type === "kicked") {
      setKicked(true);
      isKickedRef.current = true;
    } else if (msg.type === "exportResult") {
      setExportMd(msg.markdown);
    } else if (msg.type === "error") {
      addToast(msg.message || msg.code);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [send, connected] = useRetroWS(handleMessage, isKickedRef);

  const helloSent = useRef(false);
  useEffect(() => {
    if (connected && !helloSent.current) {
      helloSent.current = true;
      send({
        type: "hello",
        sessionId,
        boardId,
        adminToken: pendingToken.current ?? undefined,
        name: getSavedName() || undefined,
      });
    }
    if (!connected) helloSent.current = false;
  }, [connected, send, sessionId, boardId]);

  useEffect(() => {
    if (boardState?.participants) setUserCount(boardState.participants.length);
  }, [boardState?.participants]);

  useEffect(() => {
    if (kicked) kickedHeadingRef.current?.focus();
  }, [kicked]);

  function handleNameDone(name: string) {
    setMyName(name);
    send({ type: "setName", name });
  }

  if (!myName) return <NamePrompt onDone={handleNameDone} />;

  if (kicked) {
    return (
      <div className="kicked-screen" role="alert">
        <h2 ref={kickedHeadingRef} tabIndex={-1}>You were removed</h2>
        <p>You have been removed from this retro session by the admin.</p>
      </div>
    );
  }

  const phase = boardState?.phase || "write";

  return (
    <div className="app">
      {!connected && <div className="reconnect-bar" role="status" aria-live="polite">Reconnecting…</div>}
      {boardState?.isMuted && <div className="banner warn" role="status">⚠ You have been muted by the admin. You can view but not add or edit cards.</div>}

      <header className="header">
        <div className="header-left">
          {boardState?.isAdmin ? (
            <input className="board-title-input" value={titleVal} data-title-input="true"
              onChange={e => setTitleVal(e.target.value)} aria-label="Board title"
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== boardState?.title) send({ type: "admin:setTitle", title: v }); }}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          ) : (
            <span className="board-title-input" style={{ display: "block" }}>{boardState?.title || "Retro Board"}</span>
          )}
          <span className={`phase-badge ${phase}`} aria-label={`Current phase: ${PHASE_LABELS[phase]}`}>{PHASE_LABELS[phase]}</span>
          <span className="board-code-chip" title="Board code">{boardCode}</span>
        </div>
        <div className="header-right">
          {phase === "vote" && boardState && !boardState.isAdmin && (
            <span className="votes-left" aria-live="polite">
              {boardState.myVotesRemaining} vote{boardState.myVotesRemaining !== 1 ? "s" : ""} left
            </span>
          )}
          {boardState?.timer && (boardState.timer.running || boardState.timer.remainingSecs < boardState.timer.durationSecs) && (
            <TimerChip timer={boardState.timer} />
          )}
          <span className="presence-chip" style={{ cursor: "default" }}
            aria-label={`${connected ? `${userCount || 1} connected` : "offline"}, signed in as ${myName}`}>
            <span aria-hidden="true">{connected ? `● ${userCount || 1} connected` : "○ offline"}</span>
            {" · "}{myName}
          </span>
        </div>
      </header>

      <main className="main-content">
        {boardState?.isAdmin && (
          <AdminPanel state={boardState} send={send} mySessionId={sessionId} addToast={addToast} boardCode={boardCode} />
        )}
        {boardState ? (
          <div className="board">
            {boardState.columns.map(col => (
              <ColumnComp key={col.id} col={col} cards={boardState.cards} phase={boardState.phase}
                config={boardState.config} myVotes={boardState.myVotes} myVotesRemaining={boardState.myVotesRemaining}
                isAdmin={boardState.isAdmin} isMuted={boardState.isMuted} send={send} addToast={addToast} />
            ))}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}>
            {connected ? "Loading…" : "Connecting to server…"}
          </div>
        )}
      </main>

      {exportMd && <ExportModal markdown={exportMd} onClose={() => setExportMd(null)} />}

      <div className="toast-container" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.fading ? "fading" : ""}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
