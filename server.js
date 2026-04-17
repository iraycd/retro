const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = parseInt(process.argv[2] || process.env.PORT || "7179", 10);
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_MSG_BYTES = 8192;
const MAX_TEXT_LEN = 500;
const ADMIN_TTL_MS = 10 * 60 * 1000;
const KICK_BLOCK_MS = 60 * 1000;

// ── State ────────────────────────────────────────────────────────────────────

const DEFAULT_STATE = () => ({
  title: "Sprint Retrospective",
  phase: "write",
  columns: [
    { id: "went_well", label: "What went well", color: "green" },
    { id: "improve",   label: "What to improve", color: "red"  },
    { id: "actions",   label: "Action items",    color: "blue" },
  ],
  cards: [],
  votes: {},
  config: { maxVotesPerPerson: 3, allowMultiVotePerCard: false, writingAllowedInReveal: false },
  admin: null,
  muted: [],
  timer: { durationSecs: 300, remainingSecs: 300, running: false, startedAt: null },
});

let state = DEFAULT_STATE();

try {
  if (fs.existsSync(DATA_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    state = { ...DEFAULT_STATE(), ...loaded };
    // never resume a running timer after restart
    if (state.timer) { state.timer.running = false; state.timer.startedAt = null; }
  }
} catch (e) {
  console.warn("Could not load data.json, starting fresh:", e.message);
}

// in-memory only
const clients = new Map(); // ws -> { sessionId, isAdmin }
const names = new Map();   // sessionId -> displayName
const kickBlock = new Map(); // sessionId -> unblockAt

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + ".tmp";
    try {
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
      console.error("Save failed:", e.message);
    }
  }, 250);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return crypto.randomBytes(4).toString("hex"); }
function token() { return "tok_" + crypto.randomBytes(12).toString("hex"); }

function countVotes(cardId) {
  let n = 0;
  for (const voteList of Object.values(state.votes)) {
    n += voteList.filter(id => id === cardId).length;
  }
  return n;
}

function listParticipants() {
  const connected = new Set();
  for (const { sessionId } of clients.values()) connected.add(sessionId);
  const result = [];
  for (const sid of connected) {
    result.push({ sessionId: sid, name: names.get(sid) || "Anonymous", muted: state.muted.includes(sid) });
  }
  return result;
}

function viewFor(sessionId, isAdmin) {
  const hideOthers = state.phase === "write";
  const showVotes = state.phase === "vote" || state.phase === "discuss";

  let cards = state.cards
    .filter(c => !hideOthers || c.authorId === sessionId)
    .map(c => ({
      id: c.id,
      columnId: c.columnId,
      text: c.text,
      mine: c.authorId === sessionId,
      authorId: isAdmin ? c.authorId : undefined,
      votes: showVotes ? countVotes(c.id) : 0,
      createdAt: c.createdAt,
    }));

  if (state.phase === "discuss") cards.sort((a, b) => b.votes - a.votes);

  const myVotes = state.votes[sessionId] || [];
  return {
    title: state.title,
    phase: state.phase,
    columns: state.columns,
    config: state.config,
    cards,
    myVotes,
    myVotesRemaining: state.config.maxVotesPerPerson - myVotes.length,
    isAdmin,
    isMuted: state.muted.includes(sessionId),
    participants: isAdmin ? listParticipants() : undefined,
    timer: {
      durationSecs: state.timer.durationSecs,
      remainingSecs: timerRemaining(),
      running: state.timer.running,
    },
  };
}

// ── Timer engine ─────────────────────────────────────────────────────────────

let timerInterval = null;

function timerRemaining() {
  const t = state.timer;
  if (!t.running || t.startedAt === null) return t.remainingSecs;
  const elapsed = Math.floor((Date.now() - t.startedAt) / 1000);
  return Math.max(0, t.remainingSecs - elapsed);
}

function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    const rem = timerRemaining();
    if (rem <= 0) {
      state.timer.running = false;
      state.timer.remainingSecs = 0;
      state.timer.startedAt = null;
      clearInterval(timerInterval);
      timerInterval = null;
      scheduleSave();
    }
    broadcastState();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function broadcastState() {
  for (const [ws, { sessionId, isAdmin }] of clients) {
    if (ws.readyState !== 1) continue;
    send(ws, { type: "state", state: viewFor(sessionId, isAdmin) });
  }
}

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (_) {}
}

function err(ws, code, message) {
  send(ws, { type: "error", code, message });
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html",
  ".css":  "text/css",
  ".jsx":  "text/babel",
  ".js":   "text/javascript",
  ".json": "application/json",
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  const filePath = path.join(PUBLIC_DIR, urlPath);
  // security: prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403); res.end("Forbidden"); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    fs.createReadStream(filePath).pipe(res);
  });
});

// ── WebSocket ─────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;

  ws.on("message", raw => {
    if (raw.length > MAX_MSG_BYTES) { err(ws, "too_large", "Message too large"); return; }

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type } = msg;

    if (type === "hello") {
      const { sessionId, adminToken, name } = msg;
      if (name && typeof name === "string") {
        names.set(sessionId, name.trim().slice(0, 40) || "Anonymous");
      }
      if (!sessionId || typeof sessionId !== "string") return;

      // Check kick block
      const blockUntil = kickBlock.get(sessionId);
      if (blockUntil && Date.now() < blockUntil) {
        send(ws, { type: "kicked" }); ws.close(); return;
      }

      let isAdmin = false;
      let mintedToken = null;

      if (state.admin && state.admin.token && adminToken === state.admin.token) {
        // Returning admin
        isAdmin = true;
        state.admin.sessionId = sessionId;
        state.admin.lastSeen = Date.now();
        scheduleSave();
      } else {
        // Check if we can promote
        const adminOnline = state.admin && [...clients.values()].some(c => c.isAdmin);
        const adminExpired = !state.admin || (Date.now() - state.admin.lastSeen > ADMIN_TTL_MS);
        if (!adminOnline && (adminExpired || !state.admin)) {
          isAdmin = true;
          mintedToken = token();
          state.admin = { token: mintedToken, sessionId, lastSeen: Date.now(), ttlMs: ADMIN_TTL_MS };
          scheduleSave();
        }
      }

      clients.set(ws, { sessionId, isAdmin });

      const welcome = { type: "welcome", sessionId };
      if (mintedToken) welcome.adminToken = mintedToken;
      send(ws, welcome);
      broadcastState();
      return;
    }

    const info = clients.get(ws);
    if (!info) { err(ws, "not_ready", "Send hello first"); return; }
    const { sessionId, isAdmin } = info;

    if (state.muted.includes(sessionId) && !type.startsWith("admin:")) {
      err(ws, "muted", "You are muted"); return;
    }

    // ── Participant actions ──────────────────────────────────────────────────

    if (type === "setName") {
      const n = String(msg.name || "").trim().slice(0, 40);
      if (n) { names.set(sessionId, n); broadcastState(); }
      return;
    }

    if (type === "addCard") {
      const canWrite = state.phase === "write" ||
        (state.phase === "reveal" && state.config.writingAllowedInReveal);
      if (!canWrite) { err(ws, "phase", "Writing not allowed in this phase"); return; }
      const text = String(msg.text || "").trim().slice(0, MAX_TEXT_LEN);
      if (!text) { err(ws, "empty", "Card text required"); return; }
      const colId = msg.columnId;
      if (!state.columns.find(c => c.id === colId)) { err(ws, "bad_col", "Unknown column"); return; }
      state.cards.push({ id: "c_" + uid(), columnId: colId, authorId: sessionId, text, createdAt: Date.now() });
      scheduleSave(); broadcastState(); return;
    }

    if (type === "editCard") {
      const canWrite = state.phase === "write" ||
        (state.phase === "reveal" && state.config.writingAllowedInReveal);
      if (!canWrite) { err(ws, "phase", "Editing not allowed in this phase"); return; }
      const card = state.cards.find(c => c.id === msg.cardId);
      if (!card) { err(ws, "not_found", "Card not found"); return; }
      if (card.authorId !== sessionId && !isAdmin) { err(ws, "forbidden", "Not your card"); return; }
      const text = String(msg.text || "").trim().slice(0, MAX_TEXT_LEN);
      if (!text) { err(ws, "empty", "Card text required"); return; }
      card.text = text;
      scheduleSave(); broadcastState(); return;
    }

    if (type === "deleteCard") {
      const card = state.cards.find(c => c.id === msg.cardId);
      if (!card) { err(ws, "not_found", "Card not found"); return; }
      if (card.authorId !== sessionId && !isAdmin) { err(ws, "forbidden", "Not your card"); return; }
      state.cards = state.cards.filter(c => c.id !== msg.cardId);
      // clean up votes for this card
      for (const sid of Object.keys(state.votes)) {
        state.votes[sid] = state.votes[sid].filter(id => id !== msg.cardId);
      }
      scheduleSave(); broadcastState(); return;
    }

    if (type === "castVote") {
      if (state.phase !== "vote") { err(ws, "phase", "Voting not open"); return; }
      const card = state.cards.find(c => c.id === msg.cardId);
      if (!card) { err(ws, "not_found", "Card not found"); return; }
      if (!state.votes[sessionId]) state.votes[sessionId] = [];
      const myVotes = state.votes[sessionId];
      const alreadyVotedThisCard = myVotes.includes(msg.cardId);
      if (!state.config.allowMultiVotePerCard && alreadyVotedThisCard) {
        err(ws, "already_voted", "Already voted on this card"); return;
      }
      if (myVotes.length >= state.config.maxVotesPerPerson) {
        err(ws, "vote_limit", "Vote limit reached"); return;
      }
      state.votes[sessionId].push(msg.cardId);
      scheduleSave(); broadcastState(); return;
    }

    if (type === "retractVote") {
      if (state.phase !== "vote") { err(ws, "phase", "Voting not open"); return; }
      if (!state.votes[sessionId]) { err(ws, "no_vote", "No vote to retract"); return; }
      const idx = state.votes[sessionId].indexOf(msg.cardId);
      if (idx === -1) { err(ws, "no_vote", "No vote on this card"); return; }
      state.votes[sessionId].splice(idx, 1);
      scheduleSave(); broadcastState(); return;
    }

    // ── Admin-only actions ───────────────────────────────────────────────────

    if (type.startsWith("admin:")) {
      if (!isAdmin) { err(ws, "forbidden", "Admin only"); return; }
      if (state.admin) state.admin.lastSeen = Date.now();

      if (type === "admin:setPhase") {
        const phases = ["write", "reveal", "vote", "discuss"];
        if (!phases.includes(msg.phase)) { err(ws, "bad_phase", "Unknown phase"); return; }
        state.phase = msg.phase;
        scheduleSave(); broadcastState(); return;
      }

      if (type === "admin:setConfig") {
        const { maxVotesPerPerson, allowMultiVotePerCard, writingAllowedInReveal } = msg;
        if (maxVotesPerPerson !== undefined) {
          const n = parseInt(maxVotesPerPerson, 10);
          if (n >= 1 && n <= 20) state.config.maxVotesPerPerson = n;
        }
        if (allowMultiVotePerCard !== undefined) state.config.allowMultiVotePerCard = !!allowMultiVotePerCard;
        if (writingAllowedInReveal !== undefined) state.config.writingAllowedInReveal = !!writingAllowedInReveal;
        scheduleSave(); broadcastState(); return;
      }

      if (type === "admin:setTitle") {
        state.title = String(msg.title || "").trim().slice(0, 100) || "Retrospective";
        scheduleSave(); broadcastState(); return;
      }

      if (type === "admin:setColumnLabel") {
        const col = state.columns.find(c => c.id === msg.columnId);
        if (!col) { err(ws, "bad_col", "Unknown column"); return; }
        col.label = String(msg.label || "").trim().slice(0, 60) || col.label;
        scheduleSave(); broadcastState(); return;
      }

      if (type === "admin:mute") {
        const { sessionId: target, muted } = msg;
        if (!target) return;
        state.muted = state.muted.filter(s => s !== target);
        if (muted) state.muted.push(target);
        scheduleSave(); broadcastState(); return;
      }

      if (type === "admin:kick") {
        const target = msg.sessionId;
        if (!target) return;
        kickBlock.set(target, Date.now() + KICK_BLOCK_MS);
        for (const [ws2, info2] of clients) {
          if (info2.sessionId === target) {
            send(ws2, { type: "kicked" });
            ws2.close();
          }
        }
        state.muted = state.muted.filter(s => s !== target);
        scheduleSave(); broadcastState(); return;
      }

      if (type === "admin:clearAll") {
        state.cards = [];
        state.votes = {};
        scheduleSave(); broadcastState(); return;
      }

      if (type === "admin:export") {
        let md = `# ${state.title}\n\n`;
        for (const col of state.columns) {
          md += `## ${col.label}\n\n`;
          const colCards = state.cards
            .filter(c => c.columnId === col.id)
            .sort((a, b) => countVotes(b.id) - countVotes(a.id));
          if (!colCards.length) { md += "_No cards_\n\n"; continue; }
          for (const c of colCards) {
            const v = countVotes(c.id);
            md += `- ${c.text}${v > 0 ? " (" + v + " votes)" : ""}\n`;
          }
          md += "\n";
        }
        send(ws, { type: "exportResult", markdown: md.trim() }); return;
      }

      if (type === "admin:timer") {
        const { action, durationSecs } = msg;
        const t = state.timer;

        if (action === "start") {
          if (!t.running) {
            t.startedAt = Date.now();
            t.running = true;
            startTimer();
          }
        } else if (action === "pause") {
          if (t.running) {
            t.remainingSecs = timerRemaining();
            t.startedAt = null;
            t.running = false;
            stopTimer();
          }
        } else if (action === "reset") {
          t.running = false;
          t.startedAt = null;
          t.remainingSecs = t.durationSecs;
          stopTimer();
        } else if (action === "setDuration") {
          const secs = parseInt(durationSecs, 10);
          if (secs >= 30 && secs <= 3600) {
            t.durationSecs = secs;
            t.remainingSecs = secs;
            t.running = false;
            t.startedAt = null;
            stopTimer();
          }
        }
        scheduleSave(); broadcastState(); return;
      }

      if (type === "admin:transfer") {
        const newSid = msg.newSessionId;
        const newWs = [...clients.entries()].find(([, i]) => i.sessionId === newSid)?.[0];
        if (!newWs) { err(ws, "not_found", "Participant not connected"); return; }
        const newToken = token();
        state.admin = { token: newToken, sessionId: newSid, lastSeen: Date.now(), ttlMs: ADMIN_TTL_MS };
        clients.get(ws).isAdmin = false;
        clients.get(newWs).isAdmin = true;
        send(newWs, { type: "welcome", sessionId: newSid, adminToken: newToken });
        scheduleSave(); broadcastState(); return;
      }
    }
  });

  ws.on("close", () => {
    const info = clients.get(ws);
    clients.delete(ws);
    if (info?.isAdmin && state.admin) state.admin.lastSeen = Date.now();
    broadcastState();
  });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Run: lsof -ti :${PORT} | xargs kill -9`);
    process.exit(1);
  } else throw e;
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("\nRetro board running:");
  console.log(`  http://localhost:${PORT}`);
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list) {
      if (iface.family === "IPv4" && !iface.internal) {
        console.log(`  http://${iface.address}:${PORT}   (share this on LAN)`);
      }
    }
  }
  console.log("\nFirst person to open the URL becomes admin.\n");
});
