#!/usr/bin/env node
// Máy chủ nhỏ cho app ôn HSK5: phục vụ giao diện, dữ liệu bài học, âm thanh,
// và lưu tiến độ học vào data/user/progress.json để Mac và điện thoại dùng chung.
// Chạy: node server.js  (không cần cài thêm gì)
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5175;
const USER_DIR = path.join(ROOT, "data", "user");
const PROGRESS = path.join(USER_DIR, "progress.json");
const STATIC = { "/app/": "app", "/audio/": "audio", "/data/lessons/": "data/lessons", "/data/images/": "data/images" };
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".webp": "image/webp",
};

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS, "utf8")); } catch { return { rev: 0 }; }
}

function writeProgress(doc) {
  fs.mkdirSync(path.join(USER_DIR, "backup"), { recursive: true });
  // Mỗi ngày giữ một bản sao của trạng thái trước lần ghi đầu tiên trong ngày.
  const backup = path.join(USER_DIR, "backup", `progress-${new Date().toISOString().slice(0, 10)}.json`);
  if (fs.existsSync(PROGRESS) && !fs.existsSync(backup)) fs.copyFileSync(PROGRESS, backup);
  const tmp = PROGRESS + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, PROGRESS);
}

function listLessons() {
  const dir = path.join(ROOT, "data", "lessons");
  return fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort().map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return { id: d.id, title: d.title, words: d.vocab.length, exercises: d.exercises.length };
  });
}

function listImages(lesson) {
  const dir = path.join(ROOT, "data", "images", String(lesson).padStart(2, "0"));
  const out = {};
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^(\d+)\.(png|jpe?g|webp)$/i);
      if (m) out[Number(m[1])] = f;
    }
  } catch {}
  return out;
}

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: "not found" });
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range) { // cần cho việc tua âm thanh
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${st.size}` });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes",
      "Cache-Control": type.startsWith("audio") || type.startsWith("image") ? "max-age=86400" : "no-store" });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return send(res, 400, { error: "bad url" }); }

  if (pathname === "/api/lessons") return send(res, 200, listLessons());
  const img = pathname.match(/^\/api\/images\/(\d+)$/);
  if (img) return send(res, 200, listImages(img[1]));
  if (pathname === "/api/progress" && req.method === "GET") return send(res, 200, readProgress());
  if (pathname === "/api/progress" && req.method === "PUT") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on("end", () => {
      let doc;
      try { doc = JSON.parse(body); } catch { return send(res, 400, { error: "bad json" }); }
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) return send(res, 400, { error: "bad doc" });
      const current = readProgress();
      // Thiết bị khác đã ghi trước: trả về bản hiện có để bên gửi tự gộp rồi gửi lại.
      if ((doc.rev || 0) !== (current.rev || 0)) return send(res, 409, current);
      doc.rev = (current.rev || 0) + 1;
      writeProgress(doc);
      send(res, 200, { rev: doc.rev });
    });
    return;
  }

  if (pathname === "/") return serveFile(req, res, path.join(ROOT, "app", "index.html"));
  for (const [prefix, dir] of Object.entries(STATIC)) {
    if (!pathname.startsWith(prefix)) continue;
    const base = path.join(ROOT, dir);
    const file = path.normalize(path.join(base, pathname.slice(prefix.length)));
    if (!file.startsWith(base + path.sep)) break;
    return serveFile(req, res, file);
  }
  send(res, 404, { error: "not found" });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`HSK5 app: http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) console.log(`Trên điện thoại (cùng Wi-Fi): http://${a.address}:${PORT}`);
  }
});
