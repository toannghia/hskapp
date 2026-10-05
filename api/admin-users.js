// Hàm chạy trên Vercel: quản trị tạo tài khoản có mật khẩu, hoặc đặt lại mật khẩu cho một tài khoản.
// Việc này cần khóa bí mật của Supabase nên phải chạy phía máy chủ, không được làm trong trình duyệt.
// Cấu hình trong Vercel → Settings → Environment Variables:
//   SUPABASE_URL                địa chỉ dự án, ví dụ https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   khóa bí mật (service_role hoặc sb_secret_…), KHÔNG đặt vào mã nguồn
// Người gọi phải đang đăng nhập bằng tài khoản có vai trò quản trị.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

module.exports = async (req, res) => {
  const fail = (code, error) => res.status(code).json({ error });
  if (req.method !== "POST") return fail(405, "Chỉ nhận yêu cầu POST");
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return fail(500, "Máy chủ chưa được cấu hình SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY");
  const service = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const call = async (path, init = {}) => {
    const r = await fetch(url + path, { ...init, headers: { ...service, ...(init.headers || {}) } });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    return { ok: r.ok, status: r.status, data };
  };

  try {
    // 1. Xác định người gọi từ phiên đăng nhập của họ, rồi kiểm tra vai trò quản trị trong cơ sở dữ liệu.
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return fail(401, "Chưa đăng nhập");
    const who = await fetch(url + "/auth/v1/user", { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!who.ok) return fail(401, "Phiên đăng nhập không hợp lệ");
    const caller = await who.json();
    const prof = await call(`/rest/v1/profiles?id=eq.${caller.id}&select=role`);
    if (!prof.ok || !prof.data[0] || prof.data[0].role !== "admin") return fail(403, "Chỉ quản trị mới được làm việc này");

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!EMAIL.test(email)) return fail(400, "Email không hợp lệ");
    if (password.length < 8) return fail(400, "Mật khẩu cần ít nhất 8 ký tự");

    // 2a. Đặt lại mật khẩu cho tài khoản đã có.
    if (body.action === "password") {
      const found = await call(`/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`);
      if (!found.ok || !found.data[0]) return fail(404, "Không tìm thấy tài khoản có email này");
      const upd = await call(`/auth/v1/admin/users/${found.data[0].id}`, { method: "PUT", body: JSON.stringify({ password }) });
      if (!upd.ok) return fail(400, (upd.data && (upd.data.msg || upd.data.message)) || "Chưa đặt lại được mật khẩu");
      return res.status(200).json({ ok: true });
    }

    // 2b. Tạo tài khoản mới có mật khẩu, kèm vai trò và lớp.
    const role = body.role === "teacher" ? "teacher" : "student";
    const name = String(body.name || "").trim();
    const made = await call("/auth/v1/admin/users", { method: "POST",
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }) });
    if (!made.ok) {
      const msg = (made.data && (made.data.msg || made.data.message || made.data.error_code)) || "";
      return fail(made.status === 422 ? 409 : 400, /exist|registered/i.test(msg) ? "Email này đã có tài khoản. Dùng nút đặt lại mật khẩu ở danh sách bên dưới." : msg || "Chưa tạo được tài khoản");
    }
    const id = made.data.id;
    // Hồ sơ đã được tạo tự động khi thêm người dùng; giờ gán vai trò và lớp.
    const set = await call(`/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify(name ? { role, full_name: name } : { role }) });
    if (!set.ok) return fail(500, "Đã tạo tài khoản nhưng chưa gán được vai trò: " + ((set.data && set.data.message) || set.status));
    if (body.classId) {
      const join = await call("/rest/v1/class_members", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ class_id: body.classId, user_id: id }) });
      if (!join.ok) return fail(500, "Đã tạo tài khoản nhưng chưa xếp được vào lớp: " + ((join.data && join.data.message) || join.status));
    }
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    return fail(500, "Lỗi máy chủ: " + (e && e.message ? e.message : e));
  }
};
