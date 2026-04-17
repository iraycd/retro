const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { generateCode } = require("./codes");

const BOARDS_DIR = path.join(__dirname, "..", "boards");
const INDEX_FILE = path.join(BOARDS_DIR, "index.json");
const ADMIN_TTL_MS = 10 * 60 * 1000;
const BOARD_IDLE_MS = 15 * 60 * 1000;
const BOARD_CLEANUP_DAYS = 30;

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return crypto.randomBytes(4).toString("hex"); }
function mktoken() { return "tok_" + crypto.randomBytes(12).toString("hex"); }

function ensureBoardsDir() {
  if (!fs.existsSync(BOARDS_DIR)) fs.mkdirSync(BOARDS_DIR, { recursive: true });
}

// ── Index ─────────────────────────────────────────────────────────────────────

function loadIndex() {
  ensureBoardsDir();
  try {
    if (fs.existsSync(INDEX_FILE)) return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch (_) {}
  return {};
}

function saveIndex(index) {
  ensureBoardsDir();
  const tmp = INDEX_FILE + ".tmp";
  const data = JSON.stringify(index, null, 2);
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, INDEX_FILE);
}

// ── Default board state ───────────────────────────────────────────────────────

function defaultState(title = "Sprint Retrospective") {
  return {
    title,
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
  };
}

// ── Board class ───────────────────────────────────────────────────────────────

class Board {
  constructor(id, code, state) {
    this.id = id;
    this.code = code;
    this.state = state;
    this.clients = new Map(); // ws -> { sessionId, isAdmin, isAlive }
    this.names = new Map();   // sessionId -> name
    this.kickBlock = new Map(); // sessionId -> unblockAt
    this.saveTimer = null;
    this.timerInterval = null;
    this.lastTouched = Date.now();
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  boardFile() { return path.join(BOARDS_DIR, `${this.id}.json`); }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 250);
    this.lastTouched = Date.now();
    // Update lastActivityAt in index
    updateIndexActivity(this.code);
  }

  flushSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const tmp = this.boardFile() + ".tmp";
    try {
      const data = JSON.stringify(this.state, null, 2);
      const fd = fs.openSync(tmp, "w");
      try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, this.boardFile());
    } catch (e) {
      console.error(`[board:${this.code}] Save failed:`, e.message);
    }
  }

  // ── Timer ────────────────────────────────────────────────────────────────────

  timerRemaining() {
    const t = this.state.timer;
    if (!t.running || t.startedAt === null) return t.remainingSecs;
    const elapsed = Math.floor((Date.now() - t.startedAt) / 1000);
    return Math.max(0, t.remainingSecs - elapsed);
  }

  startTimer() {
    if (this.timerInterval) return;
    this.timerInterval = setInterval(() => {
      const rem = this.timerRemaining();
      if (rem <= 0) {
        this.state.timer.running = false;
        this.state.timer.remainingSecs = 0;
        this.state.timer.startedAt = null;
        clearInterval(this.timerInterval);
        this.timerInterval = null;
        this.scheduleSave();
      }
      this.broadcastState();
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  }

  // ── View ─────────────────────────────────────────────────────────────────────

  countVotes(cardId) {
    let n = 0;
    for (const voteList of Object.values(this.state.votes)) {
      n += voteList.filter(id => id === cardId).length;
    }
    return n;
  }

  listParticipants() {
    const connected = new Set();
    for (const { sessionId } of this.clients.values()) connected.add(sessionId);
    const result = [];
    for (const sid of connected) {
      result.push({ sessionId: sid, name: this.names.get(sid) || "Anonymous", muted: this.state.muted.includes(sid) });
    }
    return result;
  }

  viewFor(sessionId, isAdmin) {
    const s = this.state;
    const hideOthers = s.phase === "write";
    const showVotes = s.phase === "vote" || s.phase === "discuss";

    let cards = s.cards
      .filter(c => !hideOthers || c.authorId === sessionId)
      .map(c => ({
        id: c.id,
        columnId: c.columnId,
        text: c.text,
        mine: c.authorId === sessionId,
        authorId: isAdmin ? c.authorId : undefined,
        votes: showVotes ? this.countVotes(c.id) : 0,
        createdAt: c.createdAt,
      }));

    if (s.phase === "discuss") cards.sort((a, b) => b.votes - a.votes);

    const myVotes = s.votes[sessionId] || [];
    return {
      boardId: this.id,
      boardCode: this.code,
      title: s.title,
      phase: s.phase,
      columns: s.columns,
      config: s.config,
      cards,
      myVotes,
      myVotesRemaining: s.config.maxVotesPerPerson - myVotes.length,
      isAdmin,
      isMuted: s.muted.includes(sessionId),
      participants: isAdmin ? this.listParticipants() : undefined,
      timer: {
        durationSecs: s.timer.durationSecs,
        remainingSecs: this.timerRemaining(),
        running: s.timer.running,
      },
    };
  }

  // ── Broadcast ────────────────────────────────────────────────────────────────

  broadcastState() {
    for (const [ws, { sessionId, isAdmin }] of this.clients) {
      if (ws.readyState !== 1) continue;
      wsSend(ws, { type: "state", state: this.viewFor(sessionId, isAdmin) });
    }
  }

  // ── Admin promotion ───────────────────────────────────────────────────────────

  promoteIfVacant(ws, sessionId) {
    const adminOnline = this.state.admin && [...this.clients.values()].some(c => c.isAdmin);
    const adminExpired = !this.state.admin || (Date.now() - this.state.admin.lastSeen > ADMIN_TTL_MS);
    if (!adminOnline && (adminExpired || !this.state.admin)) {
      const mintedToken = mktoken();
      this.state.admin = { token: mintedToken, sessionId, lastSeen: Date.now(), ttlMs: ADMIN_TTL_MS };
      this.clients.get(ws).isAdmin = true;
      this.scheduleSave();
      return { isAdmin: true, mintedToken };
    }
    return { isAdmin: false, mintedToken: null };
  }

  // ── Teardown ─────────────────────────────────────────────────────────────────

  teardown() {
    this.flushSave();
    this.stopTimer();
  }

  get idle() {
    return this.clients.size === 0 && (Date.now() - this.lastTouched > BOARD_IDLE_MS);
  }
}

// ── Shared send helper ────────────────────────────────────────────────────────

function wsSend(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (_) {}
}

// ── Board registry ────────────────────────────────────────────────────────────

// Map<boardId, Board | Promise<Board>>
const registry = new Map();

function updateIndexActivity(code) {
  try {
    const index = loadIndex();
    if (index[code]) { index[code].lastActivityAt = Date.now(); saveIndex(index); }
  } catch (_) {}
}

function loadBoard(id, code) {
  const file = path.join(BOARDS_DIR, `${id}.json`);
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
    if (state.timer) { state.timer.running = false; state.timer.startedAt = null; }
  } catch (_) {
    state = defaultState();
  }
  const board = new Board(id, code, state);
  registry.set(id, board);
  return board;
}

async function getOrLoadBoard(id, code) {
  const existing = registry.get(id);
  if (existing instanceof Board) return existing;
  if (existing instanceof Promise) return existing;
  // Cache the promise to avoid race on concurrent hellos
  const promise = Promise.resolve(loadBoard(id, code));
  registry.set(id, promise);
  const board = await promise;
  registry.set(id, board);
  return board;
}

function unloadBoard(id) {
  const board = registry.get(id);
  if (board instanceof Board) board.teardown();
  registry.delete(id);
}

// ── Idle watchdog ─────────────────────────────────────────────────────────────

const watchdog = setInterval(() => {
  for (const [id, entry] of registry) {
    if (entry instanceof Board && entry.idle) {
      console.log(`[board:${entry.code}] Idle, unloading`);
      unloadBoard(id);
    }
  }
}, 60_000);

function stopWatchdog() { clearInterval(watchdog); }

// ── Cleanup abandoned boards ──────────────────────────────────────────────────

function cleanupAbandonedBoards() {
  const index = loadIndex();
  const cutoff = Date.now() - BOARD_CLEANUP_DAYS * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [code, meta] of Object.entries(index)) {
    if ((meta.lastActivityAt ?? meta.createdAt) < cutoff) {
      const file = path.join(BOARDS_DIR, `${meta.id}.json`);
      let hasCards = false;
      try {
        const state = JSON.parse(fs.readFileSync(file, "utf8"));
        hasCards = (state.cards?.length ?? 0) > 0;
      } catch (_) {}
      if (!hasCards) {
        console.log(`[cleanup] Removing abandoned empty board: ${code}`);
        try { fs.unlinkSync(file); } catch (_) {}
        delete index[code];
        changed = true;
      } else {
        console.warn(`[cleanup] Board ${code} is old but has cards — skipping`);
      }
    }
  }
  if (changed) saveIndex(index);
}

// ── Public API ────────────────────────────────────────────────────────────────

function createBoard(title = "Sprint Retrospective") {
  ensureBoardsDir();
  const index = loadIndex();

  let code;
  let attempts = 0;
  do {
    code = generateCode(attempts >= 5 ? 6 : 5);
    attempts++;
  } while (index[code] && attempts < 10);

  const id = crypto.randomUUID();
  const adminToken = mktoken();
  const state = defaultState(title);
  state.admin = { token: adminToken, sessionId: null, lastSeen: Date.now(), ttlMs: ADMIN_TTL_MS };

  ensureBoardsDir();
  const file = path.join(BOARDS_DIR, `${id}.json`);
  const data = JSON.stringify(state, null, 2);
  const fd = fs.openSync(file, "w");
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }

  index[code] = { id, title, createdAt: Date.now(), lastActivityAt: Date.now() };
  saveIndex(index);

  return { id, code, adminToken };
}

function getBoardMeta(code) {
  const index = loadIndex();
  return index[code] ?? null;
}

function getBoardMetaById(id) {
  const index = loadIndex();
  for (const [code, meta] of Object.entries(index)) {
    if (meta.id === id) return { ...meta, code };
  }
  return null;
}

module.exports = {
  Board,
  getOrLoadBoard,
  unloadBoard,
  stopWatchdog,
  createBoard,
  getBoardMeta,
  getBoardMetaById,
  cleanupAbandonedBoards,
  wsSend,
};
