const http = require("http");
const os = require("os");
const { WebSocketServer } = require("ws");

const { migrateLegacyIfNeeded } = require("./server/migrate");
const { handleRequest } = require("./server/http");
const { handleConnection } = require("./server/ws");
const { stopWatchdog, cleanupAbandonedBoards } = require("./server/boards");

const PORT = parseInt(process.argv[2] || process.env.PORT || "7179", 10);
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// Migrate legacy data.json to boards/ on first boot
migrateLegacyIfNeeded();

// Cleanup abandoned empty boards on startup
cleanupAbandonedBoards();

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(e => {
    console.error("HTTP error:", e.message);
    if (!res.headersSent) { res.writeHead(500); res.end("Internal error"); }
  });
});

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: "/ws" });

// Heartbeat map: ws -> isAlive (maintained per-board too, but we need it at WS level)
const wsAlive = new Map();

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!wsAlive.get(ws)) { ws.terminate(); continue; }
    wsAlive.set(ws, false);
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on("connection", (ws) => {
  wsAlive.set(ws, true);
  ws.on("pong", () => wsAlive.set(ws, true));
  ws.on("close", () => wsAlive.delete(ws));
  handleConnection(ws);
});

wss.on("close", () => clearInterval(heartbeat));

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown() {
  clearInterval(heartbeat);
  stopWatchdog();
  wss.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Start ─────────────────────────────────────────────────────────────────────

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
  console.log("\nCreate a board at: http://localhost:" + PORT);
  console.log();
});
