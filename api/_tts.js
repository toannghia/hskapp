// Đọc tiếng Trung bằng giọng Microsoft Edge (thư viện msedge-tts), dùng chung cho server.js và hàm Vercel api/tts.js.
// Mỗi câu chỉ sinh một lần: tên tệp là mã băm của giọng + câu, lần sau dùng lại tệp đã lưu.
// Lưu ý: msedge-tts gọi dịch vụ đọc của trình duyệt Edge, không phải dịch vụ công khai; nếu Microsoft chặn
// thì app tự quay về giọng của thiết bị.
const crypto = require("crypto");

const VOICE = "zh-CN-XiaoxiaoNeural";
const MAX = 300;

// Bỏ ký tự trang trí và khoảng trắng thừa để cùng một câu luôn ra cùng một tệp.
const clean = (t) => String(t || "").replace(/[•·]/g, "").replace(/\s+/g, " ").trim();
const valid = (t) => t.length > 0 && t.length <= MAX && /[一-鿿]/.test(t);
const key = (t) => crypto.createHash("sha1").update(`${VOICE}|${t}`).digest("hex").slice(0, 24);
const xml = (t) => t.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

// Mở một kết nối tới dịch vụ đọc. Có thể dùng lại kết nối cho nhiều câu liên tiếp (công cụ sinh sẵn làm vậy).
async function open() {
  const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 10000, synthesisTimeoutMs: 20000 });
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  return tts;
}

// Sinh tệp mp3 cho một câu, trả về Buffer.
async function synth(text, conn) {
  const tts = conn || (await open());
  try {
    const { audioStream } = tts.toStream(xml(text));
    const audio = await new Promise((resolve, reject) => {
      const parts = [];
      audioStream.on("data", (d) => parts.push(d));
      audioStream.on("error", reject);
      audioStream.on("close", () => resolve(Buffer.concat(parts)));
    });
    if (audio.length < 500) throw new Error("Dịch vụ đọc không trả về âm thanh");
    return audio;
  } finally {
    if (!conn) tts.close();
  }
}

module.exports = { VOICE, clean, valid, key, open, synth };
