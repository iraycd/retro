const crypto = require("crypto");
const { getOrLoadBoard, getBoardMetaById, wsSend } = require("./boards");

const MAX_MSG_BYTES = 8192;
const MAX_TEXT_LEN = 500;
const KICK_BLOCK_MS = 60 * 1000;

function uid() { return crypto.randomBytes(4).toString("hex"); }
function token() { return "tok_" + crypto.randomBytes(12).toString("hex"); }

function wsErr(ws, code, message) {
  wsSend(ws, { type: "error", code, message });
}

async function handleConnection(ws) {
  // Temporary slot — will be populated after hello
  let board = null;

  ws.on("message", async (raw) => {
    if (raw.length > MAX_MSG_BYTES) { wsErr(ws, "too_large", "Message too large"); return; }

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type } = msg;

    // ── hello ──────────────────────────────────────────────────────────────────

    if (type === "hello") {
      const { sessionId, boardId, adminToken, name } = msg;
      if (!sessionId || typeof sessionId !== "string") return;
      if (!boardId || typeof boardId !== "string") { wsErr(ws, "bad_board", "boardId required"); return; }

      const meta = getBoardMetaById(boardId);
      if (!meta) { wsErr(ws, "not_found", "Board not found"); ws.close(); return; }

      board = await getOrLoadBoard(boardId, meta.code);

      // Check kick block
      const blockUntil = board.kickBlock.get(sessionId);
      if (blockUntil && Date.now() < blockUntil) {
        wsSend(ws, { type: "kicked" }); ws.close(); return;
      }

      if (name && typeof name === "string") {
        board.names.set(sessionId, name.trim().slice(0, 40) || "Anonymous");
      }

      let isAdmin = false;
      let mintedToken = null;

      if (board.state.admin && board.state.admin.token && adminToken === board.state.admin.token) {
        // Returning admin — echo token to confirm
        isAdmin = true;
        board.state.admin.sessionId = sessionId;
        board.state.admin.lastSeen = Date.now();
        board.clients.set(ws, { sessionId, isAdmin: true, isAlive: true });
        board.scheduleSave();
        wsSend(ws, { type: "welcome", sessionId, adminToken: board.state.admin.token, boardId, boardCode: board.code });
        board.broadcastState();
        return;
      }

      board.clients.set(ws, { sessionId, isAdmin: false, isAlive: true });
      const promoted = board.promoteIfVacant(ws, sessionId);
      isAdmin = promoted.isAdmin;
      mintedToken = promoted.mintedToken;

      const welcome = { type: "welcome", sessionId, boardId, boardCode: board.code };
      if (mintedToken) welcome.adminToken = mintedToken;
      wsSend(ws, welcome);
      board.broadcastState();
      return;
    }

    // All subsequent messages require board context
    if (!board) { wsErr(ws, "not_ready", "Send hello first"); return; }

    const info = board.clients.get(ws);
    if (!info || !info.sessionId) { wsErr(ws, "not_ready", "Send hello first"); return; }
    const { sessionId, isAdmin } = info;
    const s = board.state;

    if (s.muted.includes(sessionId) && !type.startsWith("admin:")) {
      wsErr(ws, "muted", "You are muted"); return;
    }

    // ── Participant actions ───────────────────────────────────────────────────

    if (type === "setName") {
      const n = String(msg.name || "").trim().slice(0, 40);
      if (n) { board.names.set(sessionId, n); board.broadcastState(); }
      return;
    }

    if (type === "addCard") {
      const canWrite = s.phase === "write" || (s.phase === "reveal" && s.config.writingAllowedInReveal);
      if (!canWrite) { wsErr(ws, "phase", "Writing not allowed in this phase"); return; }
      const text = String(msg.text || "").trim().slice(0, MAX_TEXT_LEN);
      if (!text) { wsErr(ws, "empty", "Card text required"); return; }
      const colId = msg.columnId;
      if (!s.columns.find(c => c.id === colId)) { wsErr(ws, "bad_col", "Unknown column"); return; }
      s.cards.push({ id: "c_" + uid(), columnId: colId, authorId: sessionId, text, createdAt: Date.now() });
      board.scheduleSave(); board.broadcastState(); return;
    }

    if (type === "editCard") {
      const canWrite = s.phase === "write" || (s.phase === "reveal" && s.config.writingAllowedInReveal);
      if (!canWrite) { wsErr(ws, "phase", "Editing not allowed in this phase"); return; }
      const card = s.cards.find(c => c.id === msg.cardId);
      if (!card) { wsErr(ws, "not_found", "Card not found"); return; }
      if (card.authorId !== sessionId && !isAdmin) { wsErr(ws, "forbidden", "Not your card"); return; }
      const text = String(msg.text || "").trim().slice(0, MAX_TEXT_LEN);
      if (!text) { wsErr(ws, "empty", "Card text required"); return; }
      card.text = text;
      board.scheduleSave(); board.broadcastState(); return;
    }

    if (type === "deleteCard") {
      const card = s.cards.find(c => c.id === msg.cardId);
      if (!card) { wsErr(ws, "not_found", "Card not found"); return; }
      if (card.authorId !== sessionId && !isAdmin) { wsErr(ws, "forbidden", "Not your card"); return; }
      s.cards = s.cards.filter(c => c.id !== msg.cardId);
      for (const sid of Object.keys(s.votes)) {
        s.votes[sid] = s.votes[sid].filter(id => id !== msg.cardId);
      }
      board.scheduleSave(); board.broadcastState(); return;
    }

    if (type === "castVote") {
      if (s.phase !== "vote") { wsErr(ws, "phase", "Voting not open"); return; }
      const card = s.cards.find(c => c.id === msg.cardId);
      if (!card) { wsErr(ws, "not_found", "Card not found"); return; }
      if (!s.votes[sessionId]) s.votes[sessionId] = [];
      const myVotes = s.votes[sessionId];
      if (!s.config.allowMultiVotePerCard && myVotes.includes(msg.cardId)) {
        wsErr(ws, "already_voted", "Already voted on this card"); return;
      }
      if (myVotes.length >= s.config.maxVotesPerPerson) {
        wsErr(ws, "vote_limit", "Vote limit reached"); return;
      }
      s.votes[sessionId].push(msg.cardId);
      board.scheduleSave(); board.broadcastState(); return;
    }

    if (type === "retractVote") {
      if (s.phase !== "vote") { wsErr(ws, "phase", "Voting not open"); return; }
      if (!s.votes[sessionId]) { wsErr(ws, "no_vote", "No vote to retract"); return; }
      const idx = s.votes[sessionId].indexOf(msg.cardId);
      if (idx === -1) { wsErr(ws, "no_vote", "No vote on this card"); return; }
      s.votes[sessionId].splice(idx, 1);
      board.scheduleSave(); board.broadcastState(); return;
    }

    // ── Admin-only actions ────────────────────────────────────────────────────

    if (type.startsWith("admin:")) {
      if (!isAdmin) { wsErr(ws, "forbidden", "Admin only"); return; }
      if (s.admin) s.admin.lastSeen = Date.now();

      if (type === "admin:setPhase") {
        const phases = ["write", "reveal", "vote", "discuss"];
        if (!phases.includes(msg.phase)) { wsErr(ws, "bad_phase", "Unknown phase"); return; }
        s.phase = msg.phase;
        board.scheduleSave(); board.broadcastState(); return;
      }

      if (type === "admin:setConfig") {
        const { maxVotesPerPerson, allowMultiVotePerCard, writingAllowedInReveal } = msg;
        if (maxVotesPerPerson !== undefined) {
          const n = parseInt(maxVotesPerPerson, 10);
          if (n >= 1 && n <= 20) s.config.maxVotesPerPerson = n;
        }
        if (allowMultiVotePerCard !== undefined) s.config.allowMultiVotePerCard = !!allowMultiVotePerCard;
        if (writingAllowedInReveal !== undefined) s.config.writingAllowedInReveal = !!writingAllowedInReveal;
        board.scheduleSave(); board.broadcastState(); return;
      }

      if (type === "admin:setTitle") {
        s.title = String(msg.title || "").trim().slice(0, 100) || "Retrospective";
        board.scheduleSave(); board.broadcastState(); return;
      }

      if (type === "admin:setColumnLabel") {
        const col = s.columns.find(c => c.id === msg.columnId);
        if (!col) { wsErr(ws, "bad_col", "Unknown column"); return; }
        col.label = String(msg.label || "").trim().slice(0, 60) || col.label;
        board.scheduleSave(); board.broadcastState(); return;
      }

      if (type === "admin:mute") {
        const { sessionId: target, muted } = msg;
        if (!target) return;
        s.muted = s.muted.filter(x => x !== target);
        if (muted) s.muted.push(target);
        board.scheduleSave(); board.broadcastState(); return;
      }

      if (type === "admin:kick") {
        const target = msg.sessionId;
        if (!target) return;
        board.kickBlock.set(target, Date.now() + KICK_BLOCK_MS);
        for (const [ws2, info2] of board.clients) {
          if (info2.sessionId === target) { wsSend(ws2, { type: "kicked" }); ws2.close(); }
        }
        s.muted = s.muted.filter(x => x !== target);
        delete s.votes[target];
        board.scheduleSave(); board.broadcastState(); return;
      }

      if (type === "admin:clearAll") {
        s.cards = [];
        s.votes = {};
        board.scheduleSave(); board.broadcastState(); return;
      }

      if (type === "admin:export") {
        let md = `# ${s.title}\n\n`;
        for (const col of s.columns) {
          md += `## ${col.label}\n\n`;
          const colCards = s.cards
            .filter(c => c.columnId === col.id)
            .sort((a, b) => board.countVotes(b.id) - board.countVotes(a.id));
          if (!colCards.length) { md += "_No cards_\n\n"; continue; }
          for (const c of colCards) {
            const v = board.countVotes(c.id);
            const safeText = c.text
              .replace(/\\/g, "\\\\")
              .replace(/([#*_\[\]`|>~])/g, "\\$1");
            md += `- ${safeText}${v > 0 ? " (" + v + " votes)" : ""}\n`;
          }
          md += "\n";
        }
        wsSend(ws, { type: "exportResult", markdown: md.trim() }); return;
      }

      if (type === "admin:timer") {
        const { action, durationSecs } = msg;
        const t = s.timer;
        if (action === "start") {
          if (!t.running) { t.startedAt = Date.now(); t.running = true; board.startTimer(); }
        } else if (action === "pause") {
          if (t.running) { t.remainingSecs = board.timerRemaining(); t.startedAt = null; t.running = false; board.stopTimer(); }
        } else if (action === "reset") {
          t.running = false; t.startedAt = null; t.remainingSecs = t.durationSecs; board.stopTimer();
        } else if (action === "setDuration") {
          const secs = parseInt(durationSecs, 10);
          if (secs >= 30 && secs <= 3600) { t.durationSecs = secs; t.remainingSecs = secs; t.running = false; t.startedAt = null; board.stopTimer(); }
        }
        board.scheduleSave(); board.broadcastState(); return;
      }

      if (type === "admin:transfer") {
        const newSid = msg.newSessionId;
        const newWs = [...board.clients.entries()].find(([, i]) => i.sessionId === newSid)?.[0];
        if (!newWs) { wsErr(ws, "not_found", "Participant not connected"); return; }
        const newToken = token();
        s.admin = { token: newToken, sessionId: newSid, lastSeen: Date.now(), ttlMs: 10 * 60 * 1000 };
        board.clients.get(ws).isAdmin = false;
        board.clients.get(newWs).isAdmin = true;
        wsSend(newWs, { type: "welcome", sessionId: newSid, adminToken: newToken, boardId: board.id, boardCode: board.code });
        board.scheduleSave(); board.broadcastState(); return;
      }
    }
  });

  ws.on("close", () => {
    if (!board) return;
    const info = board.clients.get(ws);
    board.clients.delete(ws);
    if (info?.isAdmin && board.state.admin) board.state.admin.lastSeen = Date.now();
    board.broadcastState();
  });
}

module.exports = { handleConnection };
