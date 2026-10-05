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
  screen(h("div", { class: "card", style: "text-align:center;padding:36px 16px" },
    h("h1", {}, "Ôn HSK5"),
    h("p", { class: "sub" }, "Đăng nhập để lưu tiến độ học và nộp bài cho giáo viên."),
    h("button", { class: "btn pri big", onclick: async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname + location.search } });
      if (error) loginScreen("Không mở được trang đăng nhập Google: " + error.message);
    } }, "Đăng nhập bằng Google"),
    msg ? h("div", { class: "fb bad" }, msg) : null));
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

function drawAccount() {
  const nav = $("#top nav");
  nav.querySelectorAll(".role").forEach((x) => x.remove());
  if (ME.role !== "student") nav.append(h("a", { class: "role", href: "#/teacher" }, "Giáo viên"));
  if (ME.role === "admin") nav.append(h("a", { class: "role", href: "#/admin" }, "Quản trị"));
  nav.append(h("a", { class: "role", href: "#", title: ME.email, onclick: async (e) => { e.preventDefault(); await sb.auth.signOut(); location.reload(); } }, "Đăng xuất"));
}

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
const subCache = {};   // exercise_id → danh sách bài đã nộp kèm phần chấm
async function loadSubs(xid) {
  subCache[xid] = must(await sb.from("submissions").select("id,item_index,content,created_at,reviews(corrected,comment,score,created_at)")
    .eq("user_id", ME.id).eq("exercise_id", xid).order("created_at", { ascending: false }));
}
function reviewView(r) {
  return h("div", { class: "fb model" },
    h("b", {}, "Giáo viên đã chấm", r.score != null ? ` · ${r.score}/10` : "", ` · ${fmtTime(new Date(r.created_at).getTime())}`),
    r.corrected ? h("div", {}, "Bản sửa: ", h("span", { class: "zh" }, r.corrected)) : null,
    r.comment ? h("div", {}, "Nhận xét: ", r.comment) : null);
}
function submitBox(l, x, it, i, a, draw) {
  if (!ONLINE || !a.done || !a.v) return null;
  const box = h("div", { style: "margin-top:6px" });
  const paint = () => {
    const mine = (subCache[x.id] || []).filter((s) => s.item_index === i);
    const sent = mine.find((s) => s.content === a.v);
    box.replaceChildren(
      sent ? h("div", { class: "sub" }, `Đã nộp cho giáo viên lúc ${fmtTime(new Date(sent.created_at).getTime())}`, sent.reviews.length ? "" : " · đang chờ chấm")
        : h("button", { class: "btn", onclick: async (e) => {
          e.target.disabled = true;
          const { error } = await sb.from("submissions").insert({ lesson_id: l.id, exercise_id: x.id, item_index: i, prompt: it.prompt || it.q, content: a.v });
          if (error) { e.target.disabled = false; return alert("Chưa nộp được: " + error.message); }
          await loadSubs(x.id); paint();
        } }, mine.length ? "Nộp bản mới cho giáo viên" : "Nộp cho giáo viên"),
      ...mine.filter((s) => s.reviews.length).flatMap((s) => [
        s.content !== a.v ? h("div", { class: "sub", style: "margin-top:6px" }, "Bản đã nộp trước: ", h("span", { class: "zh" }, s.content)) : null,
        ...s.reviews.map(reviewView)]).filter(Boolean));
  };
  if (subCache[x.id]) paint(); else loadSubs(x.id).then(paint).catch(() => box.replaceChildren(h("div", { class: "sub" }, "Chưa tải được phần giáo viên chấm.")));
  return box;
}

// ---------- Giáo viên ----------
const newCode = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
const who = (p) => (p ? p.full_name || p.email : "(không rõ)");

route(/^teacher$/, async () => {
  if (!ONLINE || ME.role === "student") return go("#/");
  add(h("h1", {}, "Giáo viên"), h("p", { class: "sub" }, "Đang tải…"));
  try {
    const classes = must(await sb.from("classes").select("id,name,code,teacher_id,class_members(user_id,profiles(id,full_name,email))").order("created_at"));
    const ids = [...new Set(classes.flatMap((c) => c.class_members.map((m) => m.user_id)))];
    const [prog, subs] = ids.length ? await Promise.all([
      sb.from("progress").select("user_id,doc,updated_at").in("user_id", ids).then(must),
      sb.from("submissions").select("id,user_id,lesson_id,exercise_id,prompt,content,created_at,profiles(full_name,email),reviews(id,corrected,comment,score,created_at)")
        .in("user_id", ids).order("created_at", { ascending: false }).limit(200).then(must),
    ]) : [[], []];
    const progOf = Object.fromEntries(prog.map((p) => [p.user_id, p]));
    view.replaceChildren(h("h1", {}, "Giáo viên"));

    const name = h("input", { placeholder: "Tên lớp mới", style: "padding:9px;border-radius:10px;border:1px solid var(--line);background:var(--bg)" });
    add(h("h2", {}, "Lớp của tôi"),
      classes.map((c) => h("div", { class: "card" },
        h("h3", {}, c.name, h("span", { class: "tag acc" }, `mã lớp: ${c.code}`)),
        c.class_members.length ? h("div", { class: "wrap" }, h("table", { class: "cmp" },
          h("tr", {}, h("th", {}, "Học viên"), h("th", {}, "Từ đã học"), h("th", {}, "Lượt ôn"), h("th", {}, "Kiểm tra gần nhất"), h("th", {}, "Hoạt động gần nhất")),
          c.class_members.map((m) => {
            const p = progOf[m.user_id], doc = p ? p.doc : {};
            return h("tr", {}, h("td", {}, who(m.profiles)),
              h("td", {}, Object.keys(doc.cards || {}).length), h("td", {}, (doc.log || []).filter((e) => e.k === "card").length),
              h("td", {}, (doc.tests || []).length ? `${doc.tests[doc.tests.length - 1].score}/${doc.tests[doc.tests.length - 1].n} (${doc.tests.length} bài)` : "chưa làm"),
              h("td", {}, p ? fmtTime(new Date(p.updated_at).getTime()) : "chưa học"));
          }))) : h("div", { class: "sub" }, "Chưa có học viên. Gửi mã lớp cho học viên để họ tự vào."))),
      h("div", { class: "row" }, name, h("button", { class: "btn", onclick: async () => {
        if (!name.value.trim()) return name.focus();
        const { error } = await sb.from("classes").insert({ name: name.value.trim(), code: newCode(), teacher_id: ME.id });
        if (error) return alert("Chưa tạo được lớp: " + error.message);
        render();
      } }, "Tạo lớp")));

    const waiting = subs.filter((s) => !s.reviews.length), graded = subs.filter((s) => s.reviews.length);
    add(h("h2", {}, `Bài chờ chấm (${waiting.length})`),
      waiting.length ? waiting.map(gradeCard) : h("div", { class: "card sub" }, "Không có bài nào đang chờ."),
      graded.length ? h("details", {}, h("summary", { class: "sub" }, `Bài đã chấm (${graded.length})`), graded.map(gradeCard)) : null);
  } catch (e) {
    console.error(e);
    view.replaceChildren(h("h1", {}, "Giáo viên"), h("div", { class: "card" }, "Không tải được dữ liệu lớp: " + (e.message || e)));
  }
});

function gradeCard(s) {
  const last = s.reviews[s.reviews.length - 1];
  const fixed = h("textarea", { class: "zh", placeholder: "Bản đã sửa" }, last ? last.corrected || "" : s.content);
  const note = h("textarea", { placeholder: "Nhận xét, giải thích lỗi", style: "min-height:60px" }, last ? last.comment || "" : "");
  const score = h("select", {}, h("option", { value: "" }, "Không cho điểm"), Array.from({ length: 11 }, (_, n) => h("option", { value: n, selected: last && last.score === n }, n)));
  const out = h("span", { class: "sub" }, last ? `Đã chấm lúc ${fmtTime(new Date(last.created_at).getTime())}` : "");
  return h("div", { class: "card ex" },
    h("div", { class: "sub" }, `${who(s.profiles)} · bài ${s.lesson_id} · ${fmtTime(new Date(s.created_at).getTime())}`),
    s.prompt ? h("div", { class: "sub" }, "Đề: ", s.prompt) : null,
    h("div", { class: "zh", style: "margin:6px 0" }, s.content),
    fixed, note,
    h("div", { class: "row", style: "margin-top:6px" }, h("label", {}, "Điểm ", score),
      h("button", { class: "btn pri", onclick: async (e) => {
        e.target.disabled = true;
        const row = { corrected: fixed.value.trim() || null, comment: note.value.trim() || null, score: score.value === "" ? null : Number(score.value) };
        const res = last ? await sb.from("reviews").update(row).eq("id", last.id) : await sb.from("reviews").insert({ submission_id: s.id, ...row });
        e.target.disabled = false;
        if (res.error) return alert("Chưa lưu được: " + res.error.message);
        out.textContent = "Đã lưu phần chấm";
      } }, last ? "Cập nhật phần chấm" : "Lưu phần chấm"), out));
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
    const out = h("div", {});
    add(h("h2", {}, "Thêm tài khoản"),
      inv.error ? h("div", { class: "card" }, "Chức năng này cần cập nhật cơ sở dữ liệu: chạy tệp supabase/migration-002-invites.sql trong Supabase → SQL Editor rồi tải lại trang.")
        : h("div", { class: "card" },
          h("div", { class: "sub" }, "Người được thêm đăng nhập bằng đúng email Google này là có ngay vai trò và lớp đã chọn, không cần nhập mã lớp. Nếu họ đã có tài khoản thì thay đổi áp dụng ngay."),
          h("div", { class: "row", style: "margin-top:10px" }, email, name),
          h("div", { class: "row", style: "margin-top:10px" }, h("label", {}, "Vai trò ", role), h("label", {}, "Lớp ", cls),
            h("button", { class: "btn pri", onclick: async (e) => {
              if (!email.value.trim()) return email.focus();
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
        h("tr", {}, h("th", {}, "Người dùng"), h("th", {}, "Vai trò"), h("th", {}, "Lớp")),
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
              } }, h("option", { value: "" }, "Thêm vào lớp…"), rest.map((c) => h("option", { value: c.id }, c.name))) : null));
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
