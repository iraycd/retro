const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { generateCode } = require("./codes");

const ROOT = path.join(__dirname, "..");
const LEGACY_FILE = path.join(ROOT, "data.json");
const BOARDS_DIR = path.join(ROOT, "boards");
const INDEX_FILE = path.join(BOARDS_DIR, "index.json");

function migrateLegacyIfNeeded() {
  if (!fs.existsSync(LEGACY_FILE)) return;
  if (fs.existsSync(BOARDS_DIR)) return;

  try {
    const raw = fs.readFileSync(LEGACY_FILE, "utf8");
    const legacy = JSON.parse(raw);

    fs.mkdirSync(BOARDS_DIR, { recursive: true });

    const id = crypto.randomUUID();
    const code = "r-LEGCY";

    // Stop timer fields from persisting as running
    if (legacy.timer) { legacy.timer.running = false; legacy.timer.startedAt = null; }

    const boardData = JSON.stringify(legacy, null, 2);
    const boardFile = path.join(BOARDS_DIR, `${id}.json`);
    const fd = fs.openSync(boardFile, "w");
    try { fs.writeSync(fd, boardData); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }

    const index = { [code]: { id, title: legacy.title || "Sprint Retrospective", createdAt: Date.now(), lastActivityAt: Date.now() } };
    const indexData = JSON.stringify(index, null, 2);
    const ifd = fs.openSync(INDEX_FILE, "w");
    try { fs.writeSync(ifd, indexData); fs.fsyncSync(ifd); } finally { fs.closeSync(ifd); }

    fs.renameSync(LEGACY_FILE, LEGACY_FILE + ".bak");

    console.log(`\nMigrated legacy board → code: ${code}`);
    console.log(`Access at: http://localhost:7179/b/${code}`);
    if (legacy.admin?.token) {
      console.log(`Admin token preserved. Admin link: http://localhost:7179/b/${code}?adminToken=${legacy.admin.token}`);
    }
    console.log();
  } catch (e) {
    console.warn("Legacy migration failed:", e.message);
  }
}

module.exports = { migrateLegacyIfNeeded };
