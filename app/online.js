// Chế độ online: đăng nhập Google, lưu dữ liệu vào Supabase, nộp bài cho giáo viên,
// màn hình chấm bài của giáo viên và trang quản trị. Tệp này nạp sau app.js.
"use strict";

const CFG = window.HSK_CONFIG || {};
let ONLINE = false, sb = null, ME = null, HAS_LOCAL = false;
const SB_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
const must = ({ data, error }) => { if (error) throw error; return data; };
const say = (el, text, bad) => { el.textContent = text; el.className = "fb " + (bad ? "bad" : "ok"); };
const screen = (...kids) => view.replaceChildren(...kids.flat(Infinity).filter(Boolean));

async function bootOnline() {
  // Có máy chủ chạy trên máy (server.js) thì mặc định dùng chế độ trên máy; thêm ?online=1 để thử chế độ online.
  HAS_LOCAL = await fetch("/api/lessons").then((r) => r.ok && (r.headers.get("content-type") || "").includes("json")).catch(() => false);
  const q = new URLSearchParams(location.search);
  // Ghi nhớ theo từng thẻ trình duyệt, để thẻ đang học ở chế độ trên máy không bị đổi theo.
  if (q.has("online")) sessionStorage.setItem("hsk5-mode", q.get("online") === "1" ? "online" : "local");
  ONLINE = !!CFG.supabaseUrl && (!HAS_LOCAL || sessionStorage.getItem("hsk5-mode") === "online");
  if (!ONLINE) return start();

  screen(h("p", { class: "sub" }, "Đang kết nối…"));
  try {
    await new Promise((ok, fail) => document.head.append(h("script", { src: SB_CDN, onload: ok, onerror: fail })));
    sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
    const session = must(await sb.auth.getSession()).session;
    if (!session) return loginScreen();
    ME = must(await sb.from("profiles").select("*").eq("id", session.user.id).single());
    const member = must(await sb.from("class_members").select("class_id").eq("user_id", ME.id).limit(1));
    drawAccount();
    if (ME.role === "student" && !member.length) return joinScreen();
    useSupabase();
    await start();
  } catch (e) {
    console.error(e);
    screen(h("div", { class: "card" }, "Không kết nối được máy chủ dữ liệu. Kiểm tra mạng rồi tải lại trang.",
      h("div", { class: "sub" }, String(e.message || e))));
  }
}

function loginScreen(msg) {
  const field = (attrs) => h("input", { style: "width:100%;max-width:320px;padding:11px;border-radius:10px;border:1px solid var(--line);background:var(--bg);margin:5px 0", ...attrs });
  const email = field({ type: "email", placeholder: "Email", autocomplete: "username" });
  const pass = field({ type: "password", placeholder: "Mật khẩu", autocomplete: "current-password" });
  const out = h("div", msg ? { class: "fb bad" } : {}, msg || "");
  const signIn = async (btn) => {
    if (!email.value.trim()) return email.focus();
    if (!pass.value) return pass.focus();
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    if (!error) return location.reload();
    btn.disabled = false;
    say(out, /invalid login/i.test(error.message) ? "Email hoặc mật khẩu không đúng." : error.message, true);
  };
  const button = h("button", { class: "btn pri big", style: "margin-top:8px", onclick: (e) => signIn(e.target) }, "Đăng nhập");
  pass.addEventListener("keydown", (e) => { if (e.key === "Enter") signIn(button); });
  screen(h("div", { class: "card", style: "text-align:center;padding:36px 16px" },
    h("h1", {}, "Ôn HSK5"),
    h("p", { class: "sub" }, "Đăng nhập để lưu tiến độ học và nộp bài cho giáo viên."),
    h("div", {}, email), h("div", {}, pass), h("div", {}, button),
    out,
    h("p", { class: "sub", style: "margin:18px 0 8px" }, "hoặc"),
    h("button", { class: "btn big", onclick: async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname + location.search } });
      if (error) say(out, "Không mở được trang đăng nhập Google: " + error.message, true);
    } }, "Đăng nhập bằng Google"),
    h("p", { class: "sub", style: "margin-top:16px" }, "Chưa có tài khoản hoặc quên mật khẩu? Liên hệ quản trị của lớp để được cấp.")));
}

function joinScreen() {
  const input = h("input", { class: "type", placeholder: "Mã lớp", style: "max-width:260px;text-transform:uppercase" });
  const out = h("div", {});
  screen(h("div", { class: "card", style: "text-align:center" },
    h("h1", {}, "Vào lớp"),
    h("p", { class: "sub" }, `Xin chào ${ME.full_name || ME.email}. Nhập mã lớp giáo viên gửi cho bạn để bắt đầu.`),
    input,
    h("div", { class: "row", style: "justify-content:center;margin-top:12px" },
      h("button", { class: "btn pri", onclick: async () => {
        if (!input.value.trim()) return input.focus();
        const { error } = await sb.rpc("join_class", { p_code: input.value.trim() });
        if (error) return say(out, error.message, true);
        location.reload();
      } }, "Vào lớp")),
    out,
    h("p", { class: "sub" }, "Nếu bạn là giáo viên, hãy báo quản trị để được cấp quyền, rồi tải lại trang này.")));
}

// Giáo viên (không phải quản trị) chỉ làm việc với lớp: xem tiến độ học viên, chấm và chữa bài.
const teacherOnly = () => ONLINE && ME && ME.role === "teacher";
// Trang chủ của giáo viên là trang Giáo viên. Trả về true nếu đã chuyển hướng.
function teacherHome() {
  if (!teacherOnly()) return false;
  go("#/teacher");
  return true;
}
function drawAccount() {
  const nav = $("#top nav");
  nav.querySelectorAll(".role").forEach((x) => x.remove());
  if (teacherOnly()) {
    // Ẩn các mục học tập (Hôm nay, Bảng điểm, Đánh giá, Sổ từ, Lịch sử) và dòng ghi nguồn từ điển.
    nav.querySelectorAll("a:not(.role)").forEach((a) => { a.hidden = true; });
    $("#top .brand").setAttribute("href", "#/teacher");
    const foot = document.querySelector("footer");
    if (foot) foot.hidden = true;
  } else nav.append(h("a", { class: "role", href: "#/reviews" }, "Bài đã chữa"));
  if (ME.role !== "student") nav.append(h("a", { class: "role", href: "#/teacher" }, teacherOnly() ? "Lớp và học viên" : "Giáo viên"));
  if (ME.role === "admin") nav.append(h("a", { class: "role", href: "#/admin" }, "Quản trị"));
  nav.append(h("a", { class: "role", href: "#/password" }, "Mật khẩu"));
  nav.append(h("a", { class: "role", href: "#", title: ME.email, onclick: async (e) => { e.preventDefault(); await sb.auth.signOut(); location.reload(); } }, "Đăng xuất"));
  markNav();
}

route(/^password$/, () => {
  if (!ONLINE) return go("#/");
  const field = (ph) => h("input", { type: "password", placeholder: ph, autocomplete: "new-password",
    style: "display:block;width:100%;max-width:320px;padding:11px;border-radius:10px;border:1px solid var(--line);background:var(--bg);margin:8px 0" });
  const a = field("Mật khẩu mới (ít nhất 8 ký tự)"), b = field("Nhập lại mật khẩu mới"), out = h("div", {});
  add(h("h1", {}, "Đặt mật khẩu"),
    h("div", { class: "card" },
      h("div", { class: "sub" }, `Tài khoản: ${ME.email}. Sau khi đặt, bạn đăng nhập được bằng email và mật khẩu này; nếu trước giờ dùng Google thì vẫn dùng Google được như cũ.`),
      a, b,
      h("button", { class: "btn pri", onclick: async (e) => {
        if (a.value.length < 8) return say(out, "Mật khẩu cần ít nhất 8 ký tự.", true);
        if (a.value !== b.value) return say(out, "Hai lần nhập chưa giống nhau.", true);
        e.target.disabled = true;
        const { error } = await sb.auth.updateUser({ password: a.value });
        e.target.disabled = false;
        if (error) return say(out, error.message, true);
        a.value = b.value = "";
        say(out, "Đã đặt mật khẩu mới.");
      } }, "Lưu mật khẩu"), out));
});

// Gọi hàm phía máy chủ (chỉ có trên bản Vercel) để tạo tài khoản có mật khẩu hoặc đặt lại mật khẩu.
async function adminUsers(body) {
  const session = must(await sb.auth.getSession()).session;
  let res;
  try {
    res = await fetch("/api/admin-users", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
  } catch { throw new Error("Không gọi được máy chủ."); }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error(res.status === 404 ? "Việc này chỉ làm được trên bản online (địa chỉ Vercel), không làm được ở bản chạy trên máy." : "Máy chủ trả lời không hợp lệ.");
  if (!res.ok) throw new Error(data.error || "Lỗi máy chủ");
  return data;
}
const randomPassword = () => { const set = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; const r = crypto.getRandomValues(new Uint32Array(12)); return Array.from(r, (x) => set[x % set.length]).join(""); };

// ---------- Thay nơi lưu dữ liệu bằng Supabase ----------
function useSupabase() {
  store.key = () => `hsk5-progress:${ME.id}`;
  store.get = async () => {
    const row = must(await sb.from("progress").select("doc,rev").eq("user_id", ME.id).maybeSingle());
    return { ...(row ? row.doc : {}), rev: row ? row.rev : 0 };
  };
  store.put = async (doc) => {
    const { rev, dirty, ...rest } = doc;
    const res = must(await sb.rpc("save_progress", { p_doc: rest, p_rev: rev || 0 }));
    return res.conflict ? { conflict: { ...res.doc, rev: res.rev } } : { rev: res.rev };
  };
  store.lessons = async () => must(await sb.from("lessons").select("id,data").order("id")).map((r) => ({ d: r.data, imgs: {} }));
  // Âm thanh nằm trong kho riêng tư: mỗi lần mở trang xin một đường dẫn tạm có hạn 6 giờ.
  store.url = async (path) => {
    const { data } = await sb.storage.from("media").createSignedUrl(path, 21600);
    return data ? data.signedUrl : null;
  };
}

// ---------- Nộp bài cho giáo viên (hiện dưới mỗi bài viết / câu dịch) ----------
const subCache = {};   // exercise_id → danh sách bài đã nộp kèm phần chữa
async function loadSubs(xid) {
  subCache[xid] = must(await sb.from("submissions").select("id,item_index,content,created_at,reviews(corrected,comment,score,created_at)")
    .eq("user_id", ME.id).eq("exercise_id", xid).order("created_at", { ascending: false }));
}
const when = (iso) => fmtTime(new Date(iso).getTime());

// So hai đoạn văn theo từng chữ để thấy giáo viên đã sửa chỗ nào: chữ bị bỏ gạch đỏ, chữ thêm vào tô xanh.
function diffView(before, after) {
  const a = [...before], b = [...after], n = a.length, m = b.length;
  if (n * m > 400000) return h("span", { class: "zh" }, after);
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (cls, ch) => { const last = out[out.length - 1]; if (last && last.cls === cls) last.text += ch; else out.push({ cls, text: ch }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("", a[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push("del", a[i++]);
    else push("ins", b[j++]);
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("ins", b[j++]);
  return h("span", { class: "zh" }, out.map((x) => (x.cls ? h("span", { class: x.cls }, x.text) : x.text)));
}
function reviewView(r, original) {
  const changed = r.corrected && original && r.corrected !== original;
  return h("div", { class: "fb model" },
    h("b", {}, "Giáo viên đã chữa", r.score != null ? ` · ${r.score}/10` : "", ` · ${when(r.created_at)}`),
    r.corrected ? h("div", {}, changed ? "Chỗ đã sửa: " : "Bài viết đúng, không phải sửa: ", changed ? diffView(original, r.corrected) : h("span", { class: "zh" }, r.corrected)) : null,
    changed ? h("div", {}, "Bản đã sửa: ", h("span", { class: "zh" }, r.corrected)) : null,
    r.comment ? h("div", {}, "Nhận xét: ", r.comment) : null);
}

// Lưu bài viết ở bản online là tự gửi luôn cho giáo viên, không cần bấm nộp.
async function autoSubmit(l, x, it, i, content, draw) {
  if (!ONLINE || !content) return;
  try {
    if (!subCache[x.id]) await loadSubs(x.id);
    if (subCache[x.id].some((s) => s.item_index === i && s.content === content)) return;
    must(await sb.from("submissions").insert({ lesson_id: l.id, exercise_id: x.id, item_index: i, prompt: it.prompt || it.q, content }));
    await loadSubs(x.id);
    draw();
  } catch (e) { console.error(e); }
}
function submitBox(l, x, it, i, a, draw) {
  if (!ONLINE || !a.done || !a.v) return null;
  const box = h("div", { style: "margin-top:6px" });
  const paint = () => {
    const mine = (subCache[x.id] || []).filter((s) => s.item_index === i);
    const sent = mine.find((s) => s.content === a.v);
    box.replaceChildren(
      sent ? h("div", { class: "sub" }, `Đã gửi giáo viên lúc ${when(sent.created_at)}`, sent.reviews.length ? "" : " · đang chờ chữa")
        : h("button", { class: "btn", onclick: (e) => { e.target.disabled = true; autoSubmit(l, x, it, i, a.v, draw).then(paint); } }, "Gửi giáo viên"),
      ...mine.filter((s) => s.reviews.length).flatMap((s) => [
        s.content !== a.v ? h("div", { class: "sub", style: "margin-top:6px" }, "Bản đã gửi trước: ", h("span", { class: "zh" }, s.content)) : null,
        ...s.reviews.map((r) => reviewView(r, s.content))]).filter(Boolean));
  };
  if (subCache[x.id]) paint(); else loadSubs(x.id).then(paint).catch(() => box.replaceChildren(h("div", { class: "sub" }, "Chưa tải được phần giáo viên chữa.")));
  return box;
}

// Học viên: thông báo có bài mới được chữa, và trang xem lại toàn bộ bài đã chữa.
let MY_GRADED = null;
async function loadGraded() {
  const rows = must(await sb.from("submissions").select("id,lesson_id,exercise_id,item_index,prompt,content,created_at,reviews(corrected,comment,score,created_at)")
    .eq("user_id", ME.id).order("created_at", { ascending: false }).limit(200));
  MY_GRADED = rows.filter((s) => s.reviews.length);
  return MY_GRADED;
}
const newestReview = (s) => Math.max(...s.reviews.map((r) => new Date(r.created_at).getTime()));
let MY_NOTES = null;
function noteNotice() {
  const box = h("div", {});
  const paint = () => box.replaceChildren(...(MY_NOTES || []).map((nt) => h("div", { class: "card warn" },
    h("b", {}, `Lời nhắc từ giáo viên ${who(nt.profiles)}`), h("span", { class: "sub" }, ` · ${when(nt.created_at)}`),
    h("div", { style: "margin:6px 0;white-space:pre-wrap" }, nt.body),
    h("button", { class: "btn", onclick: async () => { await sb.rpc("mark_notes_read"); MY_NOTES = []; paint(); } }, "Đã đọc"))));
  if (MY_NOTES) paint();
  else sb.from("notes").select("id,body,created_at,profiles!notes_teacher_id_fkey(full_name,email)").eq("student_id", ME.id).is("read_at", null).order("created_at")
    .then(({ data }) => { MY_NOTES = data || []; paint(); });
  return box;
}
function reviewNotice() {
  if (!ONLINE) return null;
  const box = h("div", {});
  box.append(noteNotice());
  const inner = h("div", {});
  box.append(inner);
  const paint = () => {
    const fresh = (MY_GRADED || []).filter((s) => newestReview(s) > (P.settings.seenReviewAt || 0)).length;
    inner.replaceChildren(...(fresh ? [h("a", { class: "card warn", href: "#/reviews", style: "display:block;color:inherit" },
      h("b", {}, `Giáo viên vừa chữa ${fresh} bài của bạn`), h("div", { class: "sub" }, "Bấm để xem chỗ đã sửa và nhận xét."))] : []));
  };
  if (MY_GRADED) paint(); else loadGraded().then(paint).catch(() => {});
  return box;
}
route(/^reviews$/, async () => {
  if (!ONLINE) return go("#/");
  add(h("h1", {}, "Bài đã được chữa"), h("p", { class: "sub" }, "Đang tải…"));
  try {
    const rows = await loadGraded();
    P.settings.seenReviewAt = Date.now();
    save();
    view.replaceChildren(h("h1", {}, "Bài đã được chữa"));
    add(rows.length ? rows.map((s) => h("div", { class: "card" },
      h("div", { class: "sub" }, `${exerciseLabel(s)} · viết lúc ${when(s.created_at)}`),
      s.prompt ? h("div", { class: "sub" }, "Đề: ", s.prompt) : null,
      h("div", { style: "margin:6px 0" }, "Bài của bạn: ", h("span", { class: "zh" }, s.content)),
      s.reviews.map((r) => reviewView(r, s.content)),
      h("a", { class: "btn", style: "display:inline-block;margin-top:8px", href: `#/ex/${s.lesson_id}/${s.exercise_id}` }, "Mở bài tập này để viết lại")))
      : h("div", { class: "card sub" }, "Chưa có bài nào được chữa. Khi bạn lưu bài viết hoặc câu dịch, bài được gửi cho giáo viên và kết quả sẽ hiện ở đây."));
  } catch (e) { console.error(e); view.replaceChildren(h("h1", {}, "Bài đã được chữa"), h("div", { class: "card" }, "Không tải được: " + (e.message || e))); }
});

// ---------- Giáo viên ----------
const newCode = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
const who = (p) => (p ? p.full_name || p.email : "(không rõ)");
function exerciseOf(s) {
  const l = lessonById(s.lesson_id), x = l && l.exercises.find((e) => e.id === s.exercise_id);
  return { l, x, it: x && x.items[s.item_index] };
}
function exerciseLabel(s) {
  const { l, x } = exerciseOf(s);
  return `Bài ${s.lesson_id}${l ? " " + l.title.zh : ""} · ${x ? x.title : s.exercise_id}${x && x.items.length > 1 ? ` · câu ${s.item_index + 1}` : ""}`;
}
const teacherFilter = { cls: "", student: "", show: "waiting" };

route(/^teacher$/, async () => {
  if (!ONLINE || ME.role === "student") return go("#/");
  add(h("h1", {}, "Giáo viên"), h("p", { class: "sub" }, "Đang tải…"));
  try {
    const classes = must(await sb.from("classes").select("id,name,code,teacher_id,class_members(user_id,profiles(id,full_name,email))").order("created_at"));
    const ids = [...new Set(classes.flatMap((c) => c.class_members.map((m) => m.user_id)))];
    const [prog, subs] = ids.length ? await Promise.all([
      sb.from("progress").select("user_id,doc,updated_at").in("user_id", ids).then(must),
      sb.from("submissions").select("id,user_id,lesson_id,exercise_id,item_index,prompt,content,created_at,profiles(full_name,email),reviews(id,corrected,comment,score,created_at)")
        .in("user_id", ids).order("created_at", { ascending: false }).limit(500).then(must),
    ]) : [[], []];
    const progOf = Object.fromEntries(prog.map((p) => [p.user_id, p]));
    const people = Object.fromEntries(classes.flatMap((c) => c.class_members.map((m) => [m.user_id, m.profiles])));
    view.replaceChildren(h("h1", {}, "Giáo viên"));

    // --- Chữa bài viết ---
    const f = teacherFilter;
    const inClass = (uid) => !f.cls || (classes.find((c) => c.id === f.cls) || { class_members: [] }).class_members.some((m) => m.user_id === uid);
    const list = h("div", {});
    const paint = () => {
      const rows = subs.filter((s) => inClass(s.user_id) && (!f.student || s.user_id === f.student));
      // Mỗi câu chỉ giữ bản mới nhất của học viên; các bản cũ hơn xem được trong thẻ.
      const latest = [], seen = new Set();
      for (const s of rows) { const k = `${s.user_id}|${s.exercise_id}|${s.item_index}`; if (!seen.has(k)) { seen.add(k); latest.push({ ...s, older: rows.filter((o) => o !== s && `${o.user_id}|${o.exercise_id}|${o.item_index}` === k) }); } }
      const waiting = latest.filter((s) => !s.reviews.length), graded = latest.filter((s) => s.reviews.length);
      const shown = f.show === "waiting" ? waiting : f.show === "graded" ? graded : latest;
      list.replaceChildren(
        h("div", { class: "sub", style: "margin:8px 0" }, `Chờ chữa ${waiting.length} · đã chữa ${graded.length}`),
        ...(shown.length ? shown.map(gradeCard) : [h("div", { class: "card sub" }, f.show === "waiting" ? "Không có bài nào đang chờ chữa." : "Không có bài nào.")]));
    };
    const pick = (key, options) => h("select", { onchange: (e) => { f[key] = e.target.value; if (key === "cls") { f.student = ""; render(); } else paint(); } },
      options.map(([v, n]) => h("option", { value: v, selected: f[key] === v }, n)));
    const students = ids.filter(inClass).map((id) => [id, who(people[id])]).sort((a, b) => a[1].localeCompare(b[1]));
    const before = view.children.length;
    add(h("h2", {}, "Chữa bài viết của học viên"),
      h("div", { class: "row" },
        h("label", {}, "Lớp ", pick("cls", [["", "Tất cả lớp"], ...classes.map((c) => [c.id, c.name])])),
        h("label", {}, "Học viên ", pick("student", [["", "Tất cả"], ...students])),
        h("label", {}, "Hiện ", pick("show", [["waiting", "Bài chờ chữa"], ["graded", "Bài đã chữa"], ["all", "Tất cả"]]))),
      list);
    paint();
    const gradingNodes = [...view.children].slice(before);

    // --- Lớp và tiến độ ---
    const name = h("input", { placeholder: "Tên lớp mới", style: "padding:9px" });
    const waitingAll = subs.filter((s) => !s.reviews.length).length;
    add(waitingAll ? h("div", { class: "card warn" }, h("b", {}, `Có ${waitingAll} bài viết đang chờ chữa`), h("span", { class: "sub" }, " · xem ở cuối trang, hoặc bấm vào cột “Bài viết” của từng học viên.")) : null,
      h("h2", {}, "Lớp của tôi"),
      classes.map((c) => h("div", { class: "card" },
        h("h3", {}, c.name, h("span", { class: "tag acc" }, `mã lớp: ${c.code}`)),
        c.class_members.length ? h("div", { class: "wrap" }, h("table", { class: "cmp" },
          h("tr", {}, h("th", {}, "Học viên"), h("th", {}, "Từ đã học"), h("th", {}, "Lượt ôn"), h("th", {}, "Kiểm tra gần nhất"), h("th", {}, "Bài viết"), h("th", {}, "Hoạt động gần nhất")),
          c.class_members.map((m) => {
            const p = progOf[m.user_id], doc = p ? p.doc : {};
            const mine = subs.filter((s) => s.user_id === m.user_id);
            const st = docStats(doc);
            return h("tr", {}, h("td", {}, h("a", { href: `#/teacher/student/${m.user_id}` }, who(m.profiles)),
                st.flags.length ? h("div", { style: "color:var(--bad);font-size:13px" }, st.flags.join(" · ")) : null),
              h("td", {}, Object.keys(doc.cards || {}).length), h("td", {}, (doc.log || []).filter((e) => e.k === "card").length),
              h("td", {}, (doc.tests || []).length ? `${doc.tests[doc.tests.length - 1].score}/${doc.tests[doc.tests.length - 1].n} (${doc.tests.length} bài)` : "chưa làm"),
              h("td", {}, mine.length ? h("a", { href: "#", onclick: (e) => { e.preventDefault(); f.cls = c.id; f.student = m.user_id; f.show = "all"; render(); } },
                `${mine.length} bài, ${mine.filter((s) => !s.reviews.length).length} chờ chữa`) : "chưa có"),
              h("td", {}, p ? when(p.updated_at) : "chưa học"));
          }))) : h("div", { class: "sub" }, "Chưa có học viên. Gửi mã lớp cho học viên, hoặc nhờ quản trị thêm tài khoản vào lớp."))),
      h("div", { class: "row" }, name, h("button", { class: "btn", onclick: async () => {
        if (!name.value.trim()) return name.focus();
        const { error } = await sb.from("classes").insert({ name: name.value.trim(), code: newCode(), teacher_id: ME.id });
        if (error) return alert("Chưa tạo được lớp: " + error.message);
        render();
      } }, "Tạo lớp")));
    // Đưa phần chữa bài xuống dưới danh sách lớp, để mở trang là thấy ngay học viên.
    view.append(...gradingNodes);
  } catch (e) {
    console.error(e);
    view.replaceChildren(h("h1", {}, "Giáo viên"), h("div", { class: "card" }, "Không tải được dữ liệu lớp: " + (e.message || e)));
  }
});

// Tính tiến độ của một học viên từ dữ liệu học của họ (dùng cho giáo viên).
function docStats(doc) {
  const cards = doc.cards || {}, log = doc.log || [], answers = doc.answers || {}, today = dayNum();
  const days = new Set(log.map((e) => dayNum(e.t)));
  const lastDay = days.size ? Math.max(...days) : null;
  const idle = lastDay == null ? null : today - lastDay;
  const due = Object.values(cards).filter((c) => c.due <= today).length;
  const relearn = Object.values(doc.relearn || {}).filter((r) => !r.done).length;
  const ev = log.filter((e) => e.k === "card");
  const lessons = LESSONS.map((l) => {
    const learned = l.items.filter((i) => cards[i.id]).length, known = l.items.filter((i) => cards[i.id] && cards[i.id].ivl >= 7).length;
    const ex = l.exercises.map((x) => {
      const rows = x.items.map((it, i) => ({ it, a: answers[`${x.id}:${i}`] }));
      const done = rows.filter((r) => r.a && r.a.done);
      return { x, rows, done: done.length, right: done.filter((r) => r.a.ok).length, auto: AUTO.has(x.type) };
    });
    return { l, learned, known, ex };
  });
  const flags = [];
  if (idle == null) flags.push("chưa bắt đầu học");
  else if (idle >= 3) flags.push(`${idle} ngày chưa học`);
  if (due >= 30) flags.push(`tồn ${due} thẻ đến hạn`);
  if (relearn >= 10) flags.push(`${relearn} từ đang quên`);
  return { learned: Object.keys(cards).length, known: Object.values(cards).filter((c) => c.ivl >= 7).length, reviews: ev.length,
    kept: ev.filter((e) => e.g > 0).length, active7: Array.from({ length: 7 }, (_, k) => today - k).filter((d) => days.has(d)).length,
    idle, due, relearn, lessons, flags, tests: doc.tests || [] };
}
// Câu trả lời của học viên và đáp án đúng, viết ra dạng đọc được.
function answerText(x, it, a) {
  if (!a || a.v == null || a.v === "") return ["(chưa làm)", ""];
  if (x.type === "choice") return [it.options[a.v], it.options[it.a]];
  if (x.type === "order") return [(a.v || []).join(""), it.a];
  return [String(a.v), String(it.a)];
}

route(/^teacher\/student\/([\w-]+)$/, async (uid) => {
  if (!ONLINE || ME.role === "student") return go("#/");
  add(h("a", { href: "#/teacher", class: "sub" }, "← Giáo viên"), h("p", { class: "sub" }, "Đang tải…"));
  try {
    const [profile, prog, subs] = await Promise.all([
      sb.from("profiles").select("id,full_name,email").eq("id", uid).maybeSingle().then(must),
      sb.from("progress").select("doc,updated_at").eq("user_id", uid).maybeSingle().then(must),
      sb.from("submissions").select("id,user_id,lesson_id,exercise_id,item_index,prompt,content,created_at,profiles(full_name,email),reviews(id,corrected,comment,score,created_at)")
        .eq("user_id", uid).order("created_at", { ascending: false }).limit(300).then(must),
    ]);
    if (!profile) throw new Error("Không tìm thấy học viên, hoặc học viên không thuộc lớp của bạn.");
    const notesRes = await sb.from("notes").select("id,body,created_at,read_at").eq("student_id", uid).order("created_at", { ascending: false }).limit(20);
    const doc = prog ? prog.doc : {}, st = docStats(doc);
    const total = LESSONS.reduce((n, l) => n + l.items.length, 0);
    view.replaceChildren(h("a", { href: "#/teacher", class: "sub" }, "← Giáo viên"),
      h("h1", {}, who(profile)), h("div", { class: "sub" }, profile.email, prog ? ` · cập nhật gần nhất ${when(prog.updated_at)}` : " · chưa có dữ liệu học"));

    add(st.flags.length ? h("div", { class: "card warn" }, h("b", {}, "Cần nhắc: "), st.flags.join(" · ")) : null,
      h("div", { class: "grid" },
        h("div", { class: "stat" }, h("b", {}, `${st.learned}/${total}`), h("span", {}, `từ đã học · ${st.known} đã thuộc`)),
        h("div", { class: "stat" }, h("b", {}, st.reviews ? Math.round(100 * st.kept / st.reviews) + "%" : "—"), h("span", {}, `tỉ lệ nhớ · ${st.reviews} lượt ôn`)),
        h("div", { class: "stat" }, h("b", {}, `${st.active7}/7`), h("span", {}, "ngày có học trong tuần qua")),
        h("div", { class: "stat" }, h("b", {}, st.due), h("span", {}, `thẻ đến hạn · ${st.relearn} từ đang quên`))));

    // --- Lời nhắc gửi học viên ---
    const body = h("textarea", { placeholder: "Viết lời nhắc hoặc góp ý cho học viên này…", style: "width:100%;min-height:70px;padding:10px" });
    const out = h("div", {});
    add(h("h2", {}, "Nhắc nhở, góp ý"),
      notesRes.error ? h("div", { class: "card" }, "Chức năng gửi lời nhắc cần cập nhật cơ sở dữ liệu: chạy tệp supabase/migration-003-notes.sql trong Supabase → SQL Editor rồi tải lại trang.")
        : h("div", { class: "card" }, body,
          h("div", { class: "row", style: "margin-top:8px" },
            h("button", { class: "btn pri", onclick: async (e) => {
              if (!body.value.trim()) return body.focus();
              e.target.disabled = true;
              const { error } = await sb.from("notes").insert({ student_id: uid, body: body.value.trim() });
              e.target.disabled = false;
              if (error) return say(out, error.message, true);
              render();
            } }, "Gửi cho học viên"),
            st.flags.length ? h("button", { class: "btn", onclick: () => { body.value = `Thầy/cô thấy em ${st.flags.join(", ")}. Em sắp xếp thời gian ôn lại nhé.`; } }, "Soạn sẵn theo tình hình") : null),
          out,
          notesRes.data.length ? notesRes.data.map((nt) => h("div", { class: "fb" },
            h("span", { class: "sub" }, `${when(nt.created_at)} · ${nt.read_at ? "đã đọc" : "chưa đọc"} · `), nt.body)) : h("div", { class: "sub", style: "margin-top:8px" }, "Chưa gửi lời nhắc nào.")));

    // --- Bài kiểm tra ---
    if (st.tests.length) add(h("h2", {}, "Bài kiểm tra đánh giá"),
      h("div", { class: "wrap" }, h("table", { class: "cmp" }, h("tr", {}, ["Ngày", "Phạm vi", "Điểm", "Từ vựng", "Ngữ pháp"].map((t) => h("th", {}, t))),
        st.tests.slice().reverse().slice(0, 10).map((t) => h("tr", {}, h("td", {}, fmtTime(t.t)), h("td", {}, scopeName(t.scope)),
          h("td", {}, h("b", {}, `${t.score}/${t.n}`)), h("td", {}, `${t.vocab[0]}/${t.vocab[1]}`), h("td", {}, `${t.grammar[0]}/${t.grammar[1]}`))))));

    // --- Từng bài: từ vựng và bài tập, bấm mở để xem từng câu đúng sai ---
    add(h("h2", {}, "Bài tập đã làm"));
    for (const ls of st.lessons) {
      const touched = ls.learned || ls.ex.some((e) => e.done);
      if (!touched) continue;
      add(h("div", { class: "card" },
        h("h3", {}, `Bài ${ls.l.id} `, h("span", { class: "zh" }, ls.l.title.zh)),
        h("div", { class: "sub" }, `Từ vựng: đã học ${ls.learned}/${ls.l.items.length}, đã thuộc ${ls.known}`),
        ls.ex.map((e) => h("details", { style: "margin-top:8px" },
          h("summary", {}, h("b", {}, e.x.title), h("span", { class: "sub" }, e.auto ? ` · làm ${e.done}/${e.rows.length} câu, đúng ${e.right}` : ` · đã viết ${e.done}/${e.rows.length}`)),
          e.done ? h("ol", { class: "ex" }, e.rows.map((r) => {
            if (!e.auto) return h("li", {}, h("div", { class: "sub" }, r.it.prompt || r.it.q), r.a && r.a.done ? h("div", { class: "zh" }, r.a.v) : h("span", { class: "sub" }, "(chưa viết)"));
            const [mine, right] = answerText(e.x, r.it, r.a);
            return h("li", {}, h("span", { class: "zh" }, r.it.q || r.it.words.join(" / ")), e.x.type === "position" ? ` （${r.it.word}）` : "",
              r.a && r.a.done ? h("div", { class: "fb " + (r.a.ok ? "ok" : "bad") }, r.a.ok ? "Đúng: " : "Sai: ", h("span", { class: "zh" }, mine),
                r.a.ok ? "" : [" · đáp án: ", h("span", { class: "zh" }, right)]) : h("div", { class: "sub" }, "(chưa làm)"));
          })) : h("div", { class: "sub" }, "Chưa làm bài này.")))));
    }
    if (!st.lessons.some((ls) => ls.learned || ls.ex.some((e) => e.done))) add(h("div", { class: "card sub" }, "Học viên chưa làm bài tập nào."));

    // --- Bài viết: chấm, sửa, góp ý ---
    const latest = [], seen = new Set();
    for (const sub of subs) { const k = `${sub.exercise_id}|${sub.item_index}`; if (!seen.has(k)) { seen.add(k); latest.push({ ...sub, older: subs.filter((o) => o !== sub && `${o.exercise_id}|${o.item_index}` === k) }); } }
    const waiting = latest.filter((x) => !x.reviews.length), graded = latest.filter((x) => x.reviews.length);
    add(h("h2", {}, `Bài viết (${latest.length})`),
      h("div", { class: "sub" }, `Chờ chữa ${waiting.length} · đã chữa ${graded.length}. Sửa trực tiếp vào bài, ghi nhận xét và cho điểm ngay tại đây.`),
      waiting.map(gradeCard),
      graded.length ? h("details", { style: "margin-top:8px" }, h("summary", { class: "sub" }, `Bài đã chữa (${graded.length})`), graded.map(gradeCard)) : null,
      latest.length ? null : h("div", { class: "card sub" }, "Học viên chưa gửi bài viết nào."));
  } catch (e) {
    console.error(e);
    view.replaceChildren(h("a", { href: "#/teacher", class: "sub" }, "← Giáo viên"), h("div", { class: "card" }, "Không tải được: " + (e.message || e)));
  }
});

function gradeCard(s) {
  const last = s.reviews[s.reviews.length - 1];
  const { it } = exerciseOf(s);
  const fixed = h("textarea", { class: "zh", placeholder: "Sửa trực tiếp vào bài của học viên ở đây" }, last ? last.corrected || "" : s.content);
  const note = h("textarea", { placeholder: "Nhận xét, giải thích lỗi", style: "min-height:60px" }, last ? last.comment || "" : "");
  const score = h("select", {}, h("option", { value: "" }, "Không cho điểm"), Array.from({ length: 11 }, (_, n) => h("option", { value: n, selected: last && last.score === n }, n)));
  const out = h("span", { class: "sub" }, last ? `Đã chữa lúc ${when(last.created_at)}` : "");
  const preview = h("div", { class: "sub" });
  const showDiff = () => preview.replaceChildren(...(fixed.value.trim() && fixed.value.trim() !== s.content ? ["Học viên sẽ thấy: ", diffView(s.content, fixed.value.trim())] : []));
  fixed.addEventListener("input", showDiff);
  showDiff();
  return h("div", { class: "card ex" },
    h("div", {}, h("b", {}, who(s.profiles)), h("span", { class: "sub" }, ` · ${exerciseLabel(s)} · ${when(s.created_at)}`)),
    s.prompt ? h("div", { class: "sub" }, "Đề: ", s.prompt) : null,
    it && it.a ? h("div", { class: "sub" }, "Đáp án mẫu: ", h("span", { class: "zh" }, it.a)) : null,
    it && it.keywords ? h("div", { class: "sub" }, "Từ gợi ý: ", it.keywords.map((w) => h("span", { class: "kw" + (s.content.includes(w) ? " used" : "") }, w))) : null,
    h("div", { style: "margin:8px 0" }, h("span", { class: "sub" }, "Bài của học viên: "), h("span", { class: "zh" }, s.content)),
    s.older && s.older.length ? h("details", {}, h("summary", { class: "sub" }, `Các bản học viên viết trước (${s.older.length})`),
      s.older.map((o) => h("div", { class: "fb" }, h("span", { class: "sub" }, when(o.created_at) + " · "), h("span", { class: "zh" }, o.content)))) : null,
    fixed, preview, note,
    h("div", { class: "row", style: "margin-top:6px" }, h("label", {}, "Điểm ", score),
      h("button", { class: "btn pri", onclick: async (e) => {
        e.target.disabled = true;
        const row = { corrected: fixed.value.trim() || null, comment: note.value.trim() || null, score: score.value === "" ? null : Number(score.value) };
        const res = last ? await sb.from("reviews").update(row).eq("id", last.id) : await sb.from("reviews").insert({ submission_id: s.id, ...row }).select("id,created_at").single();
        e.target.disabled = false;
        if (res.error) return alert("Chưa lưu được: " + res.error.message);
        if (!last && res.data) s.reviews.push({ ...row, ...res.data });
        out.textContent = "Đã lưu phần chữa bài";
      } }, last ? "Cập nhật phần chữa" : "Lưu phần chữa"), out));
}

// ---------- Quản trị ----------
route(/^admin$/, async () => {
  if (!ONLINE || ME.role !== "admin") return go("#/");
  add(h("h1", {}, "Quản trị"), h("p", { class: "sub" }, "Đang tải…"));
  try {
    const [users, lessons, classes, members] = await Promise.all([
      sb.from("profiles").select("id,email,full_name,role,created_at").order("created_at").then(must),
      sb.from("lessons").select("id,updated_at").order("id").then(must),
      sb.from("classes").select("id,name,code").order("created_at").then(must),
      sb.from("class_members").select("class_id,user_id").then(must),
    ]);
    // Bảng lời mời chỉ có sau khi chạy supabase/migration-002-invites.sql.
    const inv = await sb.from("invites").select("email,full_name,role,class_id,created_at").is("accepted_at", null).order("created_at");
    const className = (id) => (classes.find((c) => c.id === id) || {}).name || "(lớp đã xóa)";
    const input = (attrs) => h("input", { style: "padding:9px;border-radius:10px;border:1px solid var(--line);background:var(--bg);min-width:0;flex:1 1 180px", ...attrs });
    view.replaceChildren(h("h1", {}, "Quản trị"));

    // --- Thêm tài khoản: ghi sẵn email, vai trò và lớp; có hiệu lực khi người đó đăng nhập Google.
    const email = input({ type: "email", placeholder: "Email Google của người cần thêm" }), name = input({ placeholder: "Họ tên (không bắt buộc)" });
    const role = h("select", {}, h("option", { value: "student" }, "Học viên"), h("option", { value: "teacher" }, "Giáo viên"));
    const cls = h("select", {}, h("option", { value: "" }, "Chưa xếp lớp"), classes.map((c) => h("option", { value: c.id }, c.name)));
    const pass = input({ placeholder: "Mật khẩu, ít nhất 8 ký tự (để trống nếu người này dùng Google)", autocomplete: "off" });
    const out = h("div", {});
    add(h("h2", {}, "Thêm tài khoản"),
      inv.error ? h("div", { class: "card" }, "Chức năng này cần cập nhật cơ sở dữ liệu: chạy tệp supabase/migration-002-invites.sql trong Supabase → SQL Editor rồi tải lại trang.")
        : h("div", { class: "card" },
          h("div", { class: "sub" }, "Có hai cách. Nhập mật khẩu: tài khoản được tạo ngay, người đó đăng nhập bằng email và mật khẩu bạn đặt. Để trống mật khẩu: người đó đăng nhập bằng Google với đúng email này. Cả hai cách đều có ngay vai trò và lớp đã chọn, không cần mã lớp."),
          h("div", { class: "row", style: "margin-top:10px" }, email, name),
          h("div", { class: "row", style: "margin-top:10px" }, pass,
            h("button", { class: "btn", onclick: () => { pass.value = randomPassword(); } }, "Tạo ngẫu nhiên")),
          h("div", { class: "row", style: "margin-top:10px" }, h("label", {}, "Vai trò ", role), h("label", {}, "Lớp ", cls),
            h("button", { class: "btn pri", onclick: async (e) => {
              if (!email.value.trim()) return email.focus();
              if (pass.value) {
                // Có mật khẩu: tạo tài khoản ngay qua hàm phía máy chủ.
                if (pass.value.length < 8) return say(out, "Mật khẩu cần ít nhất 8 ký tự.", true);
                e.target.disabled = true;
                try {
                  await adminUsers({ action: "create", email: email.value, password: pass.value, name: name.value, role: role.value, classId: cls.value || null });
                  say(out, `Đã tạo tài khoản ${email.value.trim()} với mật khẩu: ${pass.value} — hãy gửi cho người dùng rồi nhắc họ đổi mật khẩu sau khi đăng nhập.`);
                  email.value = name.value = pass.value = "";
                } catch (err) { say(out, err.message, true); }
                e.target.disabled = false;
                return;
              }
              e.target.disabled = true;
              const { data, error } = await sb.rpc("admin_add_account", { p_email: email.value, p_name: name.value, p_role: role.value, p_class: cls.value || null });
              e.target.disabled = false;
              if (error) return say(out, error.message, true);
              if (data === "applied") return render();
              say(out, `Đã ghi nhận ${email.value.trim()}. Vai trò và lớp sẽ được áp dụng khi người này đăng nhập lần đầu.`);
              setTimeout(render, 1500);
            } }, "Thêm")),
          out,
          classes.length ? null : h("div", { class: "sub", style: "margin-top:8px" }, "Chưa có lớp nào. Tạo lớp ở trang Giáo viên trước nếu muốn xếp lớp ngay khi thêm."),
          inv.data.length ? [h("h3", { style: "margin-top:14px" }, `Đang chờ đăng nhập lần đầu (${inv.data.length})`),
            h("div", { class: "wrap" }, h("table", { class: "cmp" }, inv.data.map((v) => h("tr", {},
              h("td", {}, v.full_name || v.email, v.full_name ? h("div", { class: "sub" }, v.email) : null),
              h("td", {}, v.role === "teacher" ? "Giáo viên" : "Học viên"),
              h("td", {}, v.class_id ? className(v.class_id) : "Chưa xếp lớp"),
              h("td", {}, h("button", { class: "btn", onclick: async () => {
                const { error } = await sb.from("invites").delete().eq("email", v.email);
                if (error) return alert("Chưa xóa được: " + error.message);
                render();
              } }, "Hủy"))))))] : null));

    // --- Tài khoản đã đăng nhập: đổi vai trò, xếp vào lớp, rút khỏi lớp.
    add(h("h2", {}, `Tài khoản đã đăng nhập (${users.length})`),
      h("div", { class: "wrap" }, h("table", { class: "cmp" },
        h("tr", {}, h("th", {}, "Người dùng"), h("th", {}, "Vai trò"), h("th", {}, "Lớp"), h("th", {}, "Mật khẩu")),
        users.map((u) => {
          const mine = members.filter((m) => m.user_id === u.id).map((m) => m.class_id);
          const rest = classes.filter((c) => !mine.includes(c.id));
          return h("tr", {},
            h("td", {}, who(u), h("div", { class: "sub" }, u.email)),
            h("td", {}, h("select", { disabled: u.id === ME.id, onchange: async (e) => {
              const { error } = await sb.from("profiles").update({ role: e.target.value }).eq("id", u.id);
              if (error) { alert("Chưa đổi được vai trò: " + error.message); render(); }
            } }, [["student", "Học viên"], ["teacher", "Giáo viên"], ["admin", "Quản trị"]].map(([v, n]) => h("option", { value: v, selected: u.role === v }, n)))),
            h("td", {},
              mine.map((id) => h("span", { class: "tag", style: "margin:0 6px 4px 0" }, className(id), " ",
                h("a", { href: "#", title: "Rút khỏi lớp này", onclick: async (e) => {
                  e.preventDefault();
                  if (!confirm(`Rút ${who(u)} khỏi lớp ${className(id)}?`)) return;
                  const { error } = await sb.from("class_members").delete().eq("class_id", id).eq("user_id", u.id);
                  if (error) return alert("Chưa rút được: " + error.message);
                  render();
                } }, "×"))),
              rest.length ? h("select", { onchange: async (e) => {
                if (!e.target.value) return;
                const { error } = await sb.from("class_members").insert({ class_id: e.target.value, user_id: u.id });
                if (error) alert("Chưa xếp lớp được: " + error.message + (inv.error ? " (cần chạy migration-002-invites.sql)" : ""));
                render();
              } }, h("option", { value: "" }, "Thêm vào lớp…"), rest.map((c) => h("option", { value: c.id }, c.name))) : null),
            h("td", {}, h("button", { class: "btn", onclick: async (e) => {
              const fresh = randomPassword();
              if (!confirm(`Đặt mật khẩu mới cho ${u.email}? Mật khẩu cũ (nếu có) sẽ không dùng được nữa.`)) return;
              e.target.disabled = true;
              try {
                await adminUsers({ action: "password", email: u.email, password: fresh });
                e.target.replaceWith(h("div", { class: "fb ok" }, "Mật khẩu mới: ", h("b", {}, fresh), h("div", { class: "sub" }, "Chỉ hiện một lần. Gửi cho người dùng và nhắc họ đổi lại.")));
              } catch (err) { e.target.disabled = false; alert(err.message); }
            } }, "Đặt lại")));
        }))));

    const log = h("div", { class: "sub" });
    add(h("h2", {}, "Nội dung bài học"),
      h("div", { class: "card" },
        h("div", {}, lessons.length ? `Đang có ${lessons.length} bài trên máy chủ: ${lessons.map((l) => l.id).join(", ")}` : "Chưa có bài nào trên máy chủ."),
        HAS_LOCAL ? h("div", { class: "row", style: "margin-top:8px" },
          h("button", { class: "btn pri", onclick: (e) => syncContent(e.target, log, false) }, "Đưa bài học từ máy này lên"),
          h("button", { class: "btn", onclick: (e) => syncContent(e.target, log, true) }, "Đưa cả âm thanh lên"))
          : h("div", { class: "sub" }, "Để nạp nội dung, mở app từ máy có dữ liệu bài học (node server.js) với địa chỉ có ?online=1."),
        log));
  } catch (e) {
    console.error(e);
    view.replaceChildren(h("h1", {}, "Quản trị"), h("div", { class: "card" }, "Không tải được: " + (e.message || e)));
  }
});

// Đọc bài học và âm thanh từ máy chủ chạy trên máy này rồi ghi lên Supabase.
async function syncContent(btn, log, withAudio) {
  btn.disabled = true;
  try {
    const list = await (await fetch("/api/lessons")).json();
    for (const m of list) {
      log.textContent = `Đang đưa bài ${m.id} lên…`;
      const data = await (await fetch(`/data/lessons/${pad(m.id)}.json`)).json();
      must(await sb.from("lessons").upsert({ id: data.id, data, updated_at: new Date().toISOString() }));
      if (!withAudio) continue;
      for (const path of [data.audio.text, data.audio.vocab, data.audio.workbook, data.vocab.map((v) => v.clip)].flat().filter(Boolean)) {
        log.textContent = `Bài ${m.id}: đang tải lên ${path}…`;
        const blob = await (await fetch("/" + path)).blob();
        const { error } = await sb.storage.from("media").upload(path, blob, { upsert: true, contentType: path.endsWith(".m4a") ? "audio/mp4" : "audio/mpeg" });
        if (error) throw error;
      }
    }
    log.textContent = `Xong: đã đưa ${list.length} bài lên${withAudio ? " kèm âm thanh" : ""}.`;
  } catch (e) {
    console.error(e);
    log.textContent = "Dừng vì lỗi: " + (e.message || e);
  }
  btn.disabled = false;
}

// ---------- Chuyển tiến độ đã học trên máy vào tài khoản ----------
async function importLocalProgress(btn) {
  btn.disabled = true;
  const local = normalize(await (await fetch("/api/progress")).json());
  const rev = P.rev;
  P = merge(local, P);          // giữ mọi thứ đã có trong tài khoản, thêm phần học trên máy
  P.rev = rev;
  P.importedLocal = Date.now();
  save();
  render();
}

// Thẻ trên trang chủ: chỉ hiện khi mở bản online ngay trên máy đang có tiến độ học cũ.
function importCard() {
  if (!ONLINE || !HAS_LOCAL || P.importedLocal) return null;
  return h("div", { class: "card" }, h("b", {}, "Chuyển tiến độ đã học trên máy này vào tài khoản"),
    h("div", { class: "sub" }, "Thẻ ôn, bài làm và sổ từ bạn đã có ở bản chạy trên máy sẽ được gộp vào tài khoản đang đăng nhập. Dữ liệu trên máy vẫn giữ nguyên."),
    h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn pri", onclick: (e) => importLocalProgress(e.target) }, "Chuyển vào tài khoản")));
}
