// Hàm chạy trên Vercel: trả về đường dẫn tệp đọc tiếng Trung (giọng Microsoft Edge) cho một câu.
//   GET /api/tts?text=...   →   { url }
// Tệp lưu trong kho tệp Supabase (thư mục media/tts). Câu đã có tệp thì chỉ cấp đường dẫn; câu mới thì sinh,
// lưu lại rồi mới cấp. Chỉ người đã đăng nhập mới gọi được, để người ngoài không dùng máy chủ này đọc hộ.
// Cần các biến môi trường giống api/admin-users.js: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
const { clean, valid, key, synth } = require("./_tts");

const PUBLIC_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_W2MkwXPLDp9dc8j5seOThA__2Rq_009";
const WEEK = 7 * 24 * 3600;

module.exports = async (req, res) => {
  const fail = (code, error) => res.status(code).json({ error });
  const url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return fail(500, "Máy chủ chưa được cấu hình SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY");
  const text = clean(req.query.text);
  if (!valid(text)) return fail(400, "Câu cần đọc phải có chữ Hán và không quá 300 ký tự");

  // Khóa kiểu cũ (JWT) cần gửi ở cả hai tiêu đề; khóa kiểu mới (sb_secret_) có dự án chỉ nhận ở apikey.
  const call = async (path, init = {}) => {
    let r = await fetch(url + path, { ...init, headers: { apikey: secret, Authorization: `Bearer ${secret}`, ...(init.headers || {}) } });
    if (r.status === 401 || r.status === 403) r = await fetch(url + path, { ...init, headers: { apikey: secret, ...(init.headers || {}) } });
    return r;
  };

  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return fail(401, "Chưa đăng nhập");
    const who = await fetch(url + "/auth/v1/user", { headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}` } });
    if (!who.ok) return fail(401, "Phiên đăng nhập không hợp lệ");

    const path = `tts/${key(text)}.mp3`;
    const sign = () => call(`/storage/v1/object/sign/media/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: WEEK }) });
    let r = await sign();
    if (!r.ok) {
      // Chưa có tệp: sinh rồi lưu vào kho.
      const audio = await synth(text);
      const up = await call(`/storage/v1/object/media/${path}`, {
        method: "POST", headers: { "Content-Type": "audio/mpeg", "x-upsert": "true" }, body: audio });
      if (!up.ok) return fail(502, `Không lưu được tệp đọc (mã ${up.status})`);
      r = await sign();
      if (!r.ok) return fail(502, `Không cấp được đường dẫn tệp đọc (mã ${r.status})`);
    }
    const { signedURL } = await r.json();
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.status(200).json({ url: url + "/storage/v1" + signedURL });
  } catch (e) {
    console.error(e);
    fail(502, "Không đọc được câu này: " + (e.message || e));
  }
};
