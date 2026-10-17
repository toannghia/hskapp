#!/usr/bin/env node
// Sinh sẵn tệp đọc giọng Edge (audio/tts/<mã>.mp3) cho mọi câu và từ mà app có thể đọc:
// từ mới chưa có tệp đọc của giáo trình, câu ví dụ của từ mới, ví dụ phần cấu trúc (tự soạn và của sách).
// Tệp đã có thì bỏ qua, nên chạy lại bao nhiêu lần cũng được. Sau đó vào Quản trị của bản online,
// bấm "Đưa cả âm thanh và ảnh lên (chỉ tệp mới)" để đưa các tệp này lên kho.
//   node tools/tts_warm.js            # tất cả các bài
//   node tools/tts_warm.js 19 20      # một vài bài
const fs = require("fs");
const path = require("path");
const tts = require("../api/_tts");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "audio", "tts");
const WORKERS = 3;

function texts(lesson) {
  const out = [];
  for (const v of lesson.vocab) {
    if (!v.clip) out.push(v.hanzi);
    for (const [zh] of v.ex || []) out.push(zh);
  }
  for (const g of lesson.grammar) {
    for (const pt of g.points || []) for (const x of pt.examples || []) out.push(x.zh);
    for (const part of (g.book && g.book.parts) || []) for (const x of part.examples) out.push(typeof x === "string" ? x : x.zh);
  }
  return out;
}

async function main() {
  const want = process.argv.slice(2).map(Number);
  const dir = path.join(ROOT, "data", "lessons");
  const all = new Set();
  for (const f of fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort()) {
    const lesson = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (want.length && !want.includes(lesson.id)) continue;
    for (const t of texts(lesson)) { const c = tts.clean(t); if (tts.valid(c)) all.add(c); }
  }
  fs.mkdirSync(OUT, { recursive: true });
  const todo = [...all].filter((t) => !fs.existsSync(path.join(OUT, `${tts.key(t)}.mp3`)));
  console.log(`${all.size} câu và từ, ${all.size - todo.length} đã có tệp, cần sinh ${todo.length}.`);
  let done = 0, failed = 0;
  const worker = async () => {
    let conn = null;
    while (todo.length) {
      const text = todo.shift();
      for (let attempt = 1; ; attempt++) {
        try {
          conn = conn || (await tts.open());
          const audio = await tts.synth(text, conn);
          const file = path.join(OUT, `${tts.key(text)}.mp3`);
          fs.writeFileSync(file + ".tmp", audio);
          fs.renameSync(file + ".tmp", file);
          done++;
          break;
        } catch (e) {
          try { conn && conn.close(); } catch {}
          conn = null;                                    // kết nối hỏng thì mở kết nối mới
          if (attempt >= 3) { failed++; console.log(`  ! không sinh được: ${text.slice(0, 20)}… (${e.message || e})`); break; }
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      if ((done + failed) % 100 === 0) console.log(`  đã sinh ${done}, lỗi ${failed}, còn ${todo.length}`);
    }
    if (conn) conn.close();
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  console.log(`Xong: sinh ${done} tệp, lỗi ${failed}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
