const fs = require("fs");
const path = require("path");
const { createBoard, getBoardMeta } = require("./boards");

const PUBLIC_DIR = path.join(__dirname, "..", "dist", "client");

const MIME = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "text/javascript",
  ".mjs":  "text/javascript",
  ".json": "application/json",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 8192) reject(new Error("Too large")); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function serveStatic(req, res) {
  if (!fs.existsSync(PUBLIC_DIR)) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("Client not built. Run: npm run build");
    return;
  }

  let urlPath = req.url.split("?")[0];
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403); res.end("Forbidden"); return;
  }

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      // SPA fallback — serve index.html for /b/:code and other client routes
      const index = path.join(PUBLIC_DIR, "index.html");
      fs.stat(index, (e2, s2) => {
        if (e2 || !s2.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": "text/html" });
        fs.createReadStream(index).pipe(res);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleRequest(req, res) {
  const urlPath = req.url.split("?")[0];

  // ── API routes (/api/* must come before static) ───────────────────────────

  if (urlPath === "/api/boards" && req.method === "POST") {
    try {
      const body = await jsonBody(req);
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : undefined;
      const board = createBoard(title);
      sendJson(res, 201, board);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  const codeMatch = urlPath.match(/^\/api\/boards\/([^/]+)$/);
  if (codeMatch && req.method === "GET") {
    // Normalise: keep "r-" prefix lowercase, uppercase the suffix
    const raw = codeMatch[1];
    const code = raw.startsWith("r-") || raw.startsWith("R-")
      ? "r-" + raw.slice(2).toUpperCase()
      : raw.toUpperCase();
    const meta = getBoardMeta(code);
    if (!meta) { sendJson(res, 404, { error: "Board not found" }); return; }
    sendJson(res, 200, { id: meta.id, title: meta.title, code });
    return;
  }

  // Reject any other /api/* to prevent SPA fallback swallowing typos
  if (urlPath.startsWith("/api/")) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  // ── Static / SPA fallback ─────────────────────────────────────────────────
  serveStatic(req, res);
}

module.exports = { handleRequest };
