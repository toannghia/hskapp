// App ôn HSK5: thẻ từ, trắc nghiệm từ vựng, bài khóa bấm tra từ, bài tập có chấm và lưu bài làm.
// Không dùng thư viện ngoài; tiến độ lưu trên máy chủ (data/user/progress.json) để Mac và điện thoại dùng chung.
"use strict";

const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pad = (n) => String(n).padStart(2, "0");
const dayNum = (t = Date.now()) => Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 86400000);
const fmtDay = (d) => { const x = new Date(d * 86400000); return `${pad(x.getUTCDate())}/${pad(x.getUTCMonth() + 1)}`; };
const fmtTime = (t) => { const x = new Date(t); return `${pad(x.getDate())}/${pad(x.getMonth() + 1)} ${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- Tiến độ học và đồng bộ ----------
const LOCAL = "hsk5-progress";
let P = null;
const blank = () => ({ rev: 0, cards: {}, log: [], answers: {}, saved: {}, settings: { newPerDay: 10 } });
const normalize = (d) => ({ ...blank(), ...d, settings: { ...blank().settings, ...(d && d.settings) } });

function merge(mine, theirs) {
  // Hai thiết bị cùng ghi: mỗi mục giữ bản có thời điểm mới hơn, nhật ký thì gộp lại.
  const out = normalize(theirs);
  const newer = (a, b, key) => (!b || (a && (a[key] || 0) >= (b[key] || 0)) ? a : b);
  for (const [id, c] of Object.entries(mine.cards)) out.cards[id] = newer(c, out.cards[id], "last");
  for (const [id, a] of Object.entries(mine.answers)) out.answers[id] = newer(a, out.answers[id], "t");
  for (const [id, s] of Object.entries(mine.saved)) out.saved[id] = newer(s, out.saved[id], "t");
  const seen = new Set(out.log.map((e) => e.id));
  out.log = out.log.concat(mine.log.filter((e) => !seen.has(e.id))).sort((a, b) => a.t - b.t);
  // Điểm kiểm tra và kỷ lục trò chơi: gộp theo thời điểm, không để bản nào đè mất bản nào.
  const tests = new Map([...(out.tests || []), ...(mine.tests || [])].map((t) => [t.t, t]));
  if (tests.size) out.tests = [...tests.values()].sort((a, b) => a.t - b.t);
  if (mine.games) out.games = { ...(out.games || {}), ...mine.games };
  out.settings = mine.settings;
  return out;
}

function setSync(text, err) { const el = $("#sync"); el.textContent = text; el.className = err ? "err" : ""; }

// Nơi lưu dữ liệu. Mặc định là máy chủ chạy trên máy (server.js); bản online thay các hàm này bằng Supabase.
const store = {
  key: () => LOCAL,
  async get() { return (await fetch("/api/progress")).json(); },
  async put(doc) {
    const res = await fetch("/api/progress", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
    if (res.ok) return { rev: (await res.json()).rev };
    if (res.status === 409) return { conflict: await res.json() };
    throw new Error(res.status);
  },
  async lessons() {
    const list = await (await fetch("/api/lessons")).json();
    return Promise.all(list.map(async (m) => ({
      d: await fetch(`/data/lessons/${pad(m.id)}.json`).then((r) => r.json()),
      imgs: await fetch(`/api/images/${m.id}`).then((r) => r.json()).catch(() => ({})),
    })));
  },
  async url(path) { return "/" + path; },
};
// Đường dẫn phát âm thanh; bản online phải xin đường dẫn tạm nên kết quả được nhớ lại.
const urlCache = {};
const mediaUrl = (path) => (urlCache[path] = urlCache[path] || store.url(path));
const audio = (path) => {
  const el = h("audio", { controls: true, preload: "none" });
  mediaUrl(path).then((u) => (u ? (el.src = u) : el.replaceWith(h("div", { class: "sub" }, "Chưa có âm thanh cho phần này."))));
  return el;
};

async function loadProgress() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(store.key())); } catch {}
  try {
    const remote = normalize(await store.get());
    // Bản lưu tạm trên máy này còn thay đổi chưa gửi được thì gộp vào.
    P = local && local.dirty ? merge(normalize(local), remote) : remote;
    P.rev = remote.rev;
    if (local && local.dirty) save();
    setSync("Đã lưu");
  } catch {
    P = normalize(local || {});
    setSync("Mất kết nối máy chủ", true);
  }
}

let saveTimer = null, pushing = false, pending = false;
function save() {
  try { localStorage.setItem(store.key(), JSON.stringify({ ...P, dirty: true })); } catch {}
  setSync("Đang lưu…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(push, 300);
}
async function push() {
  if (pushing) { pending = true; return; }
  pushing = true;
  try {
    for (let tries = 0; tries < 4; tries++) {
      const res = await store.put(P);
      if (!res.conflict) {
        P.rev = res.rev;
        try { localStorage.setItem(store.key(), JSON.stringify(P)); } catch {}
        setSync("Đã lưu");
        break;
      }
      P = merge(P, res.conflict);
      P.rev = res.conflict.rev || 0;
    }
  } catch {
    setSync("Chưa lưu được, sẽ thử lại", true);
    saveTimer = setTimeout(push, 5000);
  }
  pushing = false;
  if (pending) { pending = false; push(); }
}
const logEvent = (e) => P.log.push({ id: uid(), t: Date.now(), ...e });

// ---------- Dữ liệu bài học ----------
let LESSONS = [];           // dữ liệu đầy đủ từng bài
const lessonById = (id) => LESSONS.find((l) => l.id === Number(id));

async function loadLessons() {
  LESSONS = (await store.lessons()).map(({ d, imgs }) => {
    d.items = d.vocab.map((v) => ({
      id: `${d.id}:${v.n}`, lesson: d.id, n: v.n, hanzi: v.hanzi, pinyin: v.pinyin, pos: v.pos, vi: v.vi,
      emoji: v.emoji || "", img: imgs[v.n] ? `/data/images/${pad(d.id)}/${imgs[v.n]}` : "",
      clip: v.clip,
    }));
    return d;
  });
}
function savedItems() {
  return Object.entries(P.saved).filter(([, s]) => !s.del)
    .map(([w, s]) => ({ id: `s:${w}`, lesson: s.lesson, hanzi: w, pinyin: s.p, pos: "", vi: s.vi, emoji: "", img: "" }));
}
const allItems = () => LESSONS.flatMap((l) => l.items).concat(savedItems());

// ---------- Ôn ngắt quãng ----------
// Điểm: 0 quên, 1 khó, 2 nhớ, 3 dễ. Khoảng cách tính theo ngày; quên thì hỏi lại ngay trong phiên.
function nextCard(card, g, today = dayNum()) {
  const c = card ? { ...card } : { ivl: 0, ease: 2.5, reps: 0, lapses: 0, first: today };
  if (g === 0) { c.lapses += c.reps ? 1 : 0; c.reps = 0; c.ivl = 0; c.ease = Math.max(1.3, c.ease - 0.2); }
  else if (c.reps === 0) { c.ivl = [0, 1, 2, 4][g]; c.reps = 1; }
  else {
    if (g === 1) { c.ivl = Math.max(1, c.ivl * 1.2); c.ease = Math.max(1.3, c.ease - 0.15); }
    if (g === 2) c.ivl = Math.max(1, c.ivl * c.ease);
    if (g === 3) { c.ivl = Math.max(1, c.ivl * c.ease * 1.3); c.ease += 0.15; }
    c.reps += 1;
  }
  c.ivl = Math.round(c.ivl * 10) / 10;
  c.due = today + Math.round(c.ivl);
  c.last = Date.now();
  return c;
}
function grade(item, g, mode) {
  P.cards[item.id] = nextCard(P.cards[item.id], g);
  logEvent({ k: "card", r: item.id, g, m: mode });
  save();
}
const ivlLabel = (card, g) => { const d = Math.round(nextCard(card, g).ivl); return g === 0 ? "hỏi lại ngay" : d <= 1 ? "mai" : `${d} ngày`; };
const status = (id) => { const c = P.cards[id]; return !c ? "new" : c.ivl >= 7 ? "known" : "learn"; };
const dueItems = () => { const t = dayNum(); return allItems().filter((i) => P.cards[i.id] && P.cards[i.id].due <= t); };
function newItemsToday() {
  const t = dayNum();
  const introduced = Object.values(P.cards).filter((c) => c.first === t).length;
  return allItems().filter((i) => !P.cards[i.id]).slice(0, Math.max(0, P.settings.newPerDay - introduced));
}
function streak() {
  const days = new Set(P.log.map((e) => dayNum(e.t)));
  let d = dayNum(), n = 0;
  if (!days.has(d)) d -= 1;
  while (days.has(d)) { n++; d--; }
  return n;
}

// ---------- Phát âm ----------
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN"; u.rate = P && P.settings.slow === false ? 0.9 : 0.6;
  const v = speechSynthesis.getVoices().find((x) => x.lang.replace("_", "-").startsWith("zh-CN"));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
// Từ mới được phát bằng tệp đọc thật của giáo trình (mỗi từ một tệp, cắt sẵn);
// từ chưa có tệp riêng thì dùng giọng đọc của thiết bị.
const player = new Audio();
const slow = () => P.settings.slow !== false;     // mặc định đọc chậm
async function pronounce(x) {
  if (typeof x === "string") return speak(x);
  if (!x.clip) return speak(x.hanzi);
  try {
    const url = await mediaUrl(x.clip);
    if (!url) return speak(x.hanzi);
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    player.pause();
    player.src = url;
    player.preservesPitch = true;
    player.playbackRate = slow() ? 0.75 : 1;
    await player.play();
  } catch { speak(x.hanzi); }
}
const speakBtn = (x) => h("button", { class: "btn", title: "Nghe phát âm", onclick: (e) => { e.stopPropagation(); pronounce(x); } }, "🔊");

// ---------- Điều hướng ----------
const view = $("#view");
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
let READY = false;
// Menu trên điện thoại: bấm nút để mở, chọn mục xong tự đóng.
const topBar = $("#top"), menuBtn = $("#menu");
const setMenu = (open) => { topBar.classList.toggle("open", open); menuBtn.setAttribute("aria-expanded", String(open)); menuBtn.textContent = open ? "✕ Đóng" : "☰ Menu"; };
menuBtn.addEventListener("click", () => setMenu(!topBar.classList.contains("open")));
$("#top nav").addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
function markNav() {
  const here = location.hash.replace(/^#\/?/, "").split("/")[0];
  document.querySelectorAll("#top nav a").forEach((a) => {
    const to = (a.getAttribute("href") || "").replace(/^#\/?/, "").split("/")[0];
    a.classList.toggle("on", a.getAttribute("href").startsWith("#/") && to === here);
  });
}
function render() {
  setMenu(false);
  markNav();
  if (!READY) return;
  closeSheet();
  document.onkeydown = null;
  const path = location.hash.replace(/^#\/?/, "");
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) { view.replaceChildren(); fn(...m.slice(1)); window.scrollTo(0, 0); return; }
  }
  location.hash = "#/";
}
const go = (p) => { location.hash = p; };
// Thêm nội dung vào trang; nhận cả mảng lồng nhau và bỏ qua giá trị rỗng.
const add = (...kids) => view.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));

// ---------- Trang chủ ----------
route(/^$/, () => {
  const due = dueItems(), fresh = newItemsToday(), items = allItems();
  const today = dayNum();
  const doneToday = P.log.filter((e) => dayNum(e.t) === today && e.k === "card").length;
  add(
    h("h1", {}, "Hôm nay"),
    h("div", { class: "grid" },
      h("div", { class: "stat" }, h("b", {}, due.length), h("span", {}, "thẻ đến hạn ôn")),
      h("div", { class: "stat" }, h("b", {}, fresh.length), h("span", {}, "từ mới hôm nay")),
      h("div", { class: "stat" }, h("b", {}, doneToday), h("span", {}, "lượt ôn đã làm hôm nay")),
      h("div", { class: "stat" }, h("b", {}, streak()), h("span", {}, "ngày học liên tiếp"))),
    h("div", { class: "card row" },
      h("button", { class: "btn pri big", disabled: !(due.length + fresh.length), onclick: () => go("#/study/due/flash") },
        due.length + fresh.length ? `Bắt đầu ôn (${due.length + fresh.length} thẻ)` : "Hôm nay đã ôn xong"),
      h("span", { class: "sub" }, `Đã học ${items.filter((i) => P.cards[i.id]).length}/${items.length} từ · `,
        h("label", {}, "từ mới mỗi ngày ",
          h("select", { onchange: (e) => { P.settings.newPerDay = Number(e.target.value); save(); render(); } },
            [5, 10, 15, 20, 30].map((n) => h("option", { value: n, selected: n === P.settings.newPerDay }, n)))))),
    typeof importCard === "function" ? importCard() : null,
    typeof homeExtras === "function" ? homeExtras() : null,
    h("h2", {}, "Bài học"),
    LESSONS.length ? null : h("div", { class: "card sub" }, "Chưa có bài học nào. Quản trị cần nạp nội dung trước."),
    LESSONS.map((l) => {
      const learned = l.items.filter((i) => P.cards[i.id]).length;
      const exDone = l.exercises.filter((x) => exSummary(l, x)).length;
      return h("a", { class: "card", href: `#/lesson/${l.id}/words`, style: "display:block;color:inherit" },
        h("h3", {}, `Bài ${l.id}: `, h("span", { class: "zh" }, l.title.zh)),
        h("div", { class: "sub" }, `${l.title.vi} · ${learned}/${l.items.length} từ đã học · ${exDone}/${l.exercises.length} bài tập đã làm`),
        h("div", { class: "bar" }, h("i", { style: `width:${Math.round(100 * learned / l.items.length)}%` })));
    }));
});

// ---------- Trang bài học ----------
const TABS = [["words", "Từ mới"], ["text", "Bài khóa"], ["grammar", "Cấu trúc"], ["ex", "Bài tập"]];
const MODES = [["flash", "Thẻ lật"], ["vi", "Chữ → nghĩa"], ["han", "Nghĩa → chữ"], ["listen", "Nghe chọn từ"], ["pic", "Nhìn hình đoán từ"], ["type", "Gõ chữ Hán"]];

route(/^lesson\/(\d+)\/(\w+)$/, (id, tab) => {
  const l = lessonById(id);
  if (!l) return go("#/");
  add(
    h("h1", {}, `Bài ${l.id}: `, h("span", { class: "zh" }, l.title.zh)),
    h("div", { class: "sub" }, l.title.vi),
    h("div", { class: "tabs" }, TABS.map(([k, name]) => h("a", { href: `#/lesson/${l.id}/${k}`, class: k === tab ? "on" : "" }, name))));
  ({ words: tabWords, text: tabText, grammar: tabGrammar, ex: tabEx }[tab] || tabWords)(l);
});

function tabWords(l) {
  const pics = l.items.filter((i) => i.img || i.emoji).length;
  add(
    h("div", { class: "card" },
      h("div", { class: "sub" }, "Chọn cách ôn. Kết quả mỗi lượt đều được ghi lại để xếp lịch ôn."),
      h("div", { class: "row", style: "margin-top:8px" },
        MODES.map(([m, name]) => h("button", { class: "btn" + (m === "flash" ? " pri" : ""), disabled: m === "pic" && pics < 4,
          onclick: () => go(`#/study/l${l.id}/${m}`) }, m === "pic" ? `${name} (${pics})` : name)),
        h("button", { class: "btn", onclick: () => go(`#/game/l${l.id}`) }, "🎮 Trò chơi ghép cặp")),
      h("div", { class: "row sub", style: "margin-top:10px" },
        h("button", { class: "btn" + (slow() ? " on" : ""), onclick: () => { P.settings.slow = !slow(); save(); render(); } }, slow() ? "Đọc chậm: đang bật" : "Đọc chậm: đang tắt"),
        l.items.some((i) => i.clip) ? "Bài này phát âm bằng giọng đọc thật của giáo trình." : "Bài này chưa có giọng đọc thật cho từng từ, đang dùng giọng của thiết bị.")),
    [].concat(l.audio.vocab).map(audio),
    h("div", { class: "wrap" }, h("table", { class: "words" }, l.items.map((i) => h("tr", {},
      h("td", {}, h("span", { class: "dot " + status(i.id), title: { new: "Chưa học", learn: "Đang học", known: "Đã thuộc" }[status(i.id)] })),
      h("td", { class: "h", onclick: () => pronounce(i) }, i.hanzi),
      h("td", { class: "p" }, i.pinyin),
      h("td", {}, i.emoji ? i.emoji + " " : "", i.vi, h("span", { class: "tag" }, i.pos)))))),
    h("div", { class: "sub", style: "margin-top:8px" }, "Chấm xám: chưa học · vàng: đang học · xanh: đã thuộc (khoảng ôn từ 7 ngày). Bấm vào chữ Hán để nghe."));
}

// ---------- Bài khóa: đánh dấu từ mới, bấm vào từ để tra ----------
const HAN = /[一-鿿]/;
function tabText(l) {
  const box = h("div", { class: "card text" });
  const byN = Object.fromEntries(l.items.map((i) => [i.n, i]));
  const paint = () => {
    box.replaceChildren(...l.textTokens.map((para) => h("p", {}, para.map(([w, n]) => {
      if (!HAN.test(w)) return w;
      const g = l.gloss[w], item = n ? byN[n] : null;
      const info = item && item.hanzi === w ? { hanzi: w, pinyin: item.pinyin, vi: item.vi, pos: item.pos, n, item }
        : { hanzi: w, pinyin: g ? g[0] : "", vi: g ? g[1] : "", pos: "", n, base: item };
      const saved = P.saved[w] && !P.saved[w].del;
      return h("span", { class: "w" + (n ? " new" : "") + (saved ? " saved" : ""), onclick: (e) => openWord(info, l, e.currentTarget, paint) },
        h("ruby", {}, w, h("rt", {}, info.pinyin)));
    }))));
  };
  paint();
  add(
    [].concat(l.audio.text).map(audio),
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: (e) => { box.classList.toggle("py"); e.target.classList.toggle("on"); } }, "Hiện pinyin"),
      h("span", { class: "sub" }, "Nền vàng: từ mới của bài · gạch chấm xanh: từ bạn đã lưu · bấm vào từ bất kỳ để xem pinyin và nghĩa.")),
    box);
}

function closeSheet() { const s = $("#sheet"); s.hidden = true; s.replaceChildren(); document.querySelectorAll(".w.sel").forEach((x) => x.classList.remove("sel")); }
function openWord(info, l, el, repaint) {
  closeSheet();
  el.classList.add("sel");
  const saved = P.saved[info.hanzi] && !P.saved[info.hanzi].del;
  const sheet = $("#sheet");
  sheet.append(h("div", { class: "in" },
    h("div", { class: "big" }, info.hanzi),
    h("div", { class: "body" },
      h("div", { class: "py" }, info.pinyin || "—", info.pos ? h("span", { class: "tag" }, info.pos) : null,
        info.n ? h("span", { class: "tag acc" }, `từ mới số ${info.n}`) : null),
      h("div", {}, info.vi || "Chưa có nghĩa cho từ này."),
      info.base ? h("div", { class: "sub" }, `Từ gốc trong bảng từ mới: ${info.base.hanzi} (${info.base.pinyin}) ${info.base.vi}`) : null,
      h("div", { class: "row", style: "margin-top:8px" },
        speakBtn(info.item || info.hanzi),
        info.n ? null : h("button", { class: "btn" + (saved ? " on" : ""), onclick: () => {
          P.saved[info.hanzi] = saved ? { del: true, t: Date.now() } : { p: info.pinyin, vi: info.vi, lesson: l.id, t: Date.now() };
          save(); repaint(); closeSheet();
        } }, saved ? "Bỏ khỏi sổ từ" : "Lưu vào sổ từ để ôn"),
        h("button", { class: "btn", onclick: closeSheet }, "Đóng")))));
  sheet.hidden = false;
}

// ---------- Cấu trúc ----------
function tabGrammar(l) {
  if (!l.grammar.length) add(h("div", { class: "card sub" }, "Bài này chưa có phần cấu trúc."));
  for (const g of l.grammar) {
    const card = h("div", { class: "card" },
      h("h3", {}, h("span", { class: "zh" }, g.title), h("span", { class: "tag acc" }, g.kind)),
      h("div", { class: "sub" }, g.summary));
    for (const pt of g.points || []) {
      card.append(h("p", {}, h("b", { class: "zh", style: "color:var(--acc)" }, pt.pattern), h("br"), pt.explain),
        h("ul", { class: "exs" }, pt.examples.map((x) => h("li", {},
          h("span", { class: "zh", style: "cursor:pointer", onclick: () => speak(x.zh) }, x.zh), h("br"), h("span", { class: "sub" }, x.vi)))));
    }
    if (g.compare) {
      const [a, b] = g.title.split("và").map((s) => s.trim());
      card.append(h("p", {}, g.compare.same), h("div", { class: "wrap" }, h("table", { class: "cmp" },
        h("tr", {}, h("th", {}), h("th", { class: "zh" }, a), h("th", { class: "zh" }, b)),
        g.compare.rows.map((r) => h("tr", {}, h("td", {}, r.aspect), h("td", {}, r.a), h("td", {}, r.b))))));
    }
    if (g.collocations) {
      card.append(h("div", { class: "wrap" }, h("table", { class: "cmp" }, g.collocations.map((c) =>
        h("tr", {}, h("td", { class: "zh", style: "font-size:22px;white-space:nowrap" }, c.word), h("td", { class: "zh" }, c.with.join("　")))))));
    }
    add(card);
  }
}

// ---------- Bài tập ----------
const ansKey = (x, i) => `${x.id}:${i}`;
let curLesson = null;
// Bản online gắn thêm nút nộp bài và phần giáo viên đã chấm vào dưới mỗi bài viết.
const teacherBox = (x, it, i, a, draw) => (typeof submitBox === "function" ? submitBox(curLesson, x, it, i, a, draw) : null);
const AUTO = new Set(["fill", "choice", "position", "order"]);
function exSummary(l, x) {
  const got = x.items.map((_, i) => P.answers[ansKey(x, i)]).filter((a) => a && a.done);
  if (!got.length) return "";
  const last = Math.max(...got.map((a) => a.t));
  if (AUTO.has(x.type)) return `Đã làm ${got.length}/${x.items.length} câu, đúng ${got.filter((a) => a.ok).length} · ${fmtTime(last)}`;
  return `Đã viết ${got.length}/${x.items.length} · ${fmtTime(last)}`;
}
function tabEx(l) {
  add(l.exercises.length ? null : h("div", { class: "card sub" }, "Bài này chưa có bài tập."),
    l.exercises.map((x) => h("div", { class: "card" },
    h("h3", {}, x.title),
    h("div", { class: "sub" }, `${x.items.length} câu · `, exSummary(l, x) || "Chưa làm"),
    h("div", { class: "row", style: "margin-top:8px" },
      h("button", { class: "btn pri", onclick: () => go(`#/ex/${l.id}/${x.id}`) }, exSummary(l, x) ? "Xem lại / làm tiếp" : "Làm bài")))),
    h("h2", {}, "Âm thanh sách bài tập"),
    l.audio.workbook.map((a, i) => [h("div", { class: "sub" }, `Phần ${i + 1}`), audio(a)]));
}

const stripPunct = (s) => s.replace(/[。，！？、；：“”\s.,!?]/g, "");
const blankify = (q, filled) => q.split("___").flatMap((part, i, arr) => (i < arr.length - 1 ? [part, filled] : [part]));

route(/^ex\/(\d+)\/([\w-]+)$/, (lid, xid) => {
  const l = lessonById(lid), x = l && l.exercises.find((e) => e.id === xid);
  if (!x) return go("#/");
  curLesson = l;
  const list = h("ol", { class: "ex" });
  const draw = () => {
    list.replaceChildren(...x.items.map((it, i) => h("li", {}, EX[x.type](x, it, i, draw))));
    const done = x.items.filter((_, i) => (P.answers[ansKey(x, i)] || {}).done).length;
    foot.replaceChildren(...[
      AUTO.has(x.type) ? h("button", { class: "btn pri big", disabled: !x.items.some((_, i) => { const a = P.answers[ansKey(x, i)]; return a && a.v != null && a.v !== "" && !a.done; }),
        onclick: () => { checkAll(l, x); draw(); } }, "Kiểm tra") : null,
      done ? h("button", { class: "btn", onclick: () => {
        if (!confirm("Xóa bài làm hiện tại của bài tập này để làm lại? Lịch sử các lần làm trước vẫn được giữ.")) return;
        x.items.forEach((_, i) => { const a = P.answers[ansKey(x, i)]; if (a) P.answers[ansKey(x, i)] = { hist: a.hist, t: Date.now() }; });
        save(); draw();
      } }, "Làm lại từ đầu") : null,
      h("span", { class: "sub" }, `${done}/${x.items.length} câu đã xong`)].filter(Boolean));
    drawNav();
  };
  // Chuyển sang bài tập khác ngay tại đây, không phải quay ra danh sách.
  const nav = h("div", {});
  const drawNav = () => {
    const at = l.exercises.indexOf(x), next = l.exercises[at + 1], after = lessonById(l.id + 1);
    nav.replaceChildren(
      h("div", { class: "row", style: "margin-top:14px" },
        next ? h("button", { class: "btn pri big", onclick: () => go(`#/ex/${l.id}/${next.id}`) }, `Bài tiếp theo: ${next.title} →`)
          : after && after.exercises.length ? h("button", { class: "btn pri big", onclick: () => go(`#/ex/${after.id}/${after.exercises[0].id}`) }, `Sang bài ${after.id}: ${after.exercises[0].title} →`)
          : h("button", { class: "btn pri big", onclick: () => go(`#/lesson/${l.id}/ex`) }, "Đã hết bài tập của bài này")),
      h("h2", {}, `Bài tập của bài ${l.id}`),
      h("div", { class: "exlist" }, l.exercises.map((e, i) => h("a", { class: "btn" + (e === x ? " on" : ""), href: `#/ex/${l.id}/${e.id}` },
        h("b", {}, `${i + 1}. ${e.title}`), h("div", { class: "sub" }, exSummary(l, e) || "Chưa làm")))));
  };
  const foot = h("div", { class: "row", style: "margin-top:14px" });
  add(
    h("a", { href: `#/lesson/${l.id}/ex`, class: "sub" }, `← Bài ${l.id}: bài tập`),
    h("h1", {}, x.title),
    x.type === "fill" ? h("div", { class: "card zh" }, "Từ cho sẵn: ", x.bank.join("　")) : null,
    h("div", { class: "card" }, list, foot), nav);
  draw();
});

function setDraft(x, i, v) {
  const k = ansKey(x, i), old = P.answers[k] || {};
  P.answers[k] = { ...old, v, done: false, ok: undefined, t: Date.now() };
  save();
}
function isRight(x, it, v) {
  if (x.type === "choice") return v === it.a;
  if (x.type === "order") return stripPunct((v || []).join("")) === stripPunct(it.a);
  return v === it.a;
}
function checkAll(l, x) {
  let right = 0, n = 0;
  x.items.forEach((it, i) => {
    const k = ansKey(x, i), a = P.answers[k];
    if (!a || a.v == null || a.v === "" || (Array.isArray(a.v) && !a.v.length)) return;
    n++;
    a.ok = isRight(x, it, a.v); a.done = true; a.t = Date.now();
    if (a.ok) right++;
  });
  logEvent({ k: "ex", l: l.id, r: x.id, ok: right, n });
  save();
}
const feedback = (a, correctText, why) => !a || !a.done ? null
  : h("div", { class: "fb " + (a.ok ? "ok" : "bad") }, a.ok ? "Đúng" : ["Chưa đúng. Đáp án: ", h("span", { class: "zh" }, correctText)], why ? ` — ${why}` : "");

const EX = {
  fill(x, it, i, draw) {
    const a = P.answers[ansKey(x, i)] || {};
    const sel = h("select", { disabled: a.done, onchange: (e) => { setDraft(x, i, e.target.value); draw(); } },
      h("option", { value: "" }, "…"), x.bank.map((w) => h("option", { value: w, selected: a.v === w }, w)));
    return [h("span", { class: "zh" }, blankify(it.q, sel)), feedback(a, it.a)];
  },
  choice(x, it, i, draw) {
    const a = P.answers[ansKey(x, i)] || {};
    return [h("div", { class: "zh" }, it.q),
      h("div", { class: "row", style: "margin-top:6px" }, it.options.map((o, j) =>
        h("button", { class: "btn zh" + (a.v === j ? " on" : ""), disabled: a.done, onclick: () => { setDraft(x, i, j); draw(); } }, o))),
      feedback(a, it.options[it.a], it.why)];
  },
  position(x, it, i, draw) {
    const a = P.answers[ansKey(x, i)] || {};
    return [h("div", { class: "zh" }, it.q, "　（", h("b", {}, it.word), "）"),
      h("div", { class: "row", style: "margin-top:6px" }, ["A", "B", "C", "D"].map((o) =>
        h("button", { class: "btn" + (a.v === o ? " on" : ""), disabled: a.done, onclick: () => { setDraft(x, i, o); draw(); } }, o))),
      feedback(a, it.a)];
  },
  order(x, it, i, draw) {
    const k = ansKey(x, i), a = P.answers[k] || {};
    const built = Array.isArray(a.v) ? a.v : [];
    // Thứ tự xáo trộn cố định theo từng câu để không nhảy lung tung mỗi lần vẽ lại.
    const pool = it.words.map((w, j) => ({ w, j })).sort((p, q) => ((p.j * 7 + i * 3) % it.words.length) - ((q.j * 7 + i * 3) % it.words.length) || p.j - q.j);
    const used = [...built];
    const left = pool.filter((p) => { const at = used.indexOf(p.w); if (at >= 0) { used.splice(at, 1); return false; } return true; });
    return [
      h("div", { class: "chips built" }, built.length ? built.map((w, j) => h("button", { class: "btn on", disabled: a.done,
        onclick: () => { setDraft(x, i, built.filter((_, q) => q !== j)); draw(); } }, w)) : h("span", { class: "sub" }, "Bấm các từ bên dưới theo đúng thứ tự")),
      h("div", { class: "chips" }, left.map((p) => h("button", { class: "btn", disabled: a.done, onclick: () => { setDraft(x, i, [...built, p.w]); draw(); } }, p.w))),
      feedback(a, it.a, a.done ? it.vi : "")];
  },
  translate(x, it, i, draw) {
    const k = ansKey(x, i), a = P.answers[k] || {};
    const toZh = it.dir === "vi-zh";
    const ta = h("textarea", { class: toZh ? "zh" : "", placeholder: toZh ? "Viết câu tiếng Trung của bạn…" : "Viết câu tiếng Việt của bạn…", disabled: a.done }, a.v || "");
    const out = [h("div", { class: toZh ? "" : "zh" }, it.q), ta];
    if (!a.done) {
      out.push(h("div", { class: "row", style: "margin-top:6px" },
        h("button", { class: "btn pri", onclick: () => {
          if (!ta.value.trim()) return ta.focus();
          P.answers[k] = { ...a, v: ta.value.trim(), done: true, t: Date.now() }; save(); draw();
        } }, "Lưu và xem đáp án mẫu")));
    } else {
      out.push(h("div", { class: "fb model" }, "Đáp án mẫu: ", h("span", { class: toZh ? "zh" : "" }, it.a)),
        h("div", { class: "row", style: "margin-top:6px" }, h("span", { class: "sub" }, "Tự chấm:"),
          [["ok", "Đúng ý"], ["near", "Gần đúng"], ["bad", "Chưa đúng"]].map(([v, name]) =>
            h("button", { class: "btn" + (a.self === v ? (v === "bad" ? " bad" : " ok") : ""), onclick: () => {
              if (!a.self) logEvent({ k: "write", l: null, r: k, self: v });
              P.answers[k] = { ...a, self: v, ok: v !== "bad", t: Date.now() }; save(); draw();
            } }, name)),
          h("button", { class: "btn", onclick: () => { P.answers[k] = { ...a, done: false, self: undefined, hist: keepHist(a) }; save(); draw(); } }, "Sửa bài")),
        teacherBox(x, it, i, a, draw), history(a));
    }
    return out;
  },
  retell(x, it, i, draw) {
    const k = ansKey(x, i), a = P.answers[k] || {};
    const kws = h("div", {});
    const count = h("span", { class: "sub" });
    const ta = h("textarea", { class: "zh", style: "min-height:150px", placeholder: "Viết bài kể lại của bạn bằng tiếng Trung…",
      oninput: () => refresh() }, a.v || "");
    const refresh = () => {
      const v = ta.value;
      kws.replaceChildren(...it.keywords.map((w) => h("span", { class: "kw" + (v.includes(w) ? " used" : "") }, w)));
      const used = it.keywords.filter((w) => v.includes(w)).length;
      count.textContent = `${(v.match(/[一-鿿]/g) || []).length} chữ · dùng ${used}/${it.keywords.length} từ gợi ý`
        + (a.done ? ` · đã lưu lúc ${fmtTime(a.t)}` : "") + (a.done && v !== a.v ? " · có thay đổi chưa lưu" : "");
    };
    refresh();
    return [h("b", {}, it.prompt), kws, ta,
      h("div", { class: "row", style: "margin-top:6px" },
        h("button", { class: "btn pri", onclick: () => {
          const v = ta.value.trim();
          if (!v) return ta.focus();
          if (v === a.v && a.done) return;
          P.answers[k] = { ...a, v, done: true, t: Date.now(), hist: a.done ? keepHist(a) : a.hist };
          logEvent({ k: "write", l: null, r: k });
          save(); draw();
        } }, a.done ? "Lưu bản mới" : "Lưu bài viết"), count),
      teacherBox(x, it, i, a, draw), history(a)];
  },
};
// Giữ lại tối đa 8 bản viết trước để xem lại.
const keepHist = (a) => (a.v ? [{ v: a.v, t: a.t }, ...(a.hist || [])].slice(0, 8) : a.hist);
const history = (a) => !a.hist || !a.hist.length ? null : h("details", { style: "margin-top:6px" },
  h("summary", { class: "sub" }, `Các bản viết trước (${a.hist.length})`),
  a.hist.map((v) => h("div", { class: "fb" }, h("span", { class: "sub" }, fmtTime(v.t) + " · "), h("span", { class: "zh" }, v.v))));

// ---------- Phiên ôn từ ----------
route(/^study\/(\w+)\/(\w+)$/, (scope, mode) => {
  let pool, queue, back;
  if (scope === "due") { pool = allItems(); queue = [...dueItems(), ...newItemsToday()]; back = "#/"; }
  else if (scope === "saved") { pool = savedItems(); queue = shuffle(pool); back = "#/saved"; }
  else if (scope === "weak") { pool = allItems(); queue = weakItems(); back = "#/score"; }
  else {
    const l = lessonById(scope.slice(1));
    if (!l) return go("#/");
    pool = l.items; back = `#/lesson/${l.id}/words`;
    const t = dayNum(), rank = (i) => { const c = P.cards[i.id]; return !c ? 1 : c.due <= t ? 0 : 2; };
    queue = mode === "flash" ? [...pool].sort((a, b) => rank(a) - rank(b)) : shuffle(pool);
  }
  if (mode === "pic") queue = queue.filter((i) => i.img || i.emoji);
  const total = queue.length;
  const tally = { right: 0, wrong: 0 };
  const stage = h("div", {});
  const name = (MODES.find((m) => m[0] === mode) || [])[1] || "";
  add(h("a", { href: back, class: "sub" }, "← Thoát phiên ôn"), stage);

  const picture = (it) => it.img ? h("img", { src: it.img, alt: "" }) : h("div", { class: "emoji" }, it.emoji);
  const answerCard = (it) => h("div", { class: "card", style: "text-align:center" },
    h("div", { class: "zh", style: "font-size:40px" }, it.hanzi), h("div", { style: "color:var(--acc)" }, it.pinyin),
    h("div", {}, it.emoji ? it.emoji + " " : "", it.vi, it.pos ? h("span", { class: "tag" }, it.pos) : null));
  const head = () => h("div", { class: "row sub", style: "justify-content:space-between;margin-top:8px" },
    h("span", {}, name), h("span", {}, `Còn ${queue.length} thẻ · đúng ${tally.right} · sai ${tally.wrong}`));

  function finish() {
    document.onkeydown = null;
    stage.replaceChildren(h("div", { class: "card", style: "text-align:center" },
      h("h1", {}, total ? "Xong phiên ôn" : "Không có thẻ nào cần ôn"),
      total ? h("p", {}, `Đúng ${tally.right} · sai ${tally.wrong} · ${total} từ`) : null,
      h("div", { class: "row", style: "justify-content:center" },
        h("button", { class: "btn pri", onclick: () => go(back) }, "Quay lại"),
        total ? h("button", { class: "btn", onclick: render }, "Ôn thêm lượt nữa") : null)));
  }
  function done(it, g) {
    grade(it, g, mode);
    if (g === 0) { tally.wrong++; queue.push(it); } else tally.right++;
    queue.shift();
    next();
  }
  function next() {
    if (!queue.length) return finish();
    const it = queue[0];
    (mode === "flash" ? flash : quiz)(it);
  }
  function flash(it) {
    let open = false;
    const card = P.cards[it.id];
    const draw = () => {
      stage.replaceChildren(head(),
        h("div", { class: "card flash", onclick: () => { if (!open) { open = true; draw(); } } },
          h("div", { class: "big" }, it.hanzi),
          open ? [h("div", { class: "py" }, it.pinyin), h("div", { class: "vi" }, it.emoji ? it.emoji + " " : "", it.vi),
            it.pos ? h("span", { class: "tag" }, it.pos) : null, it.img ? picture(it) : null]
            : h("div", { class: "sub" }, card ? "Bấm để xem nghĩa" : "Từ mới · bấm để xem nghĩa"),
          speakBtn(it)),
        open ? h("div", { class: "grade" }, [["Quên", "bad"], ["Khó", ""], ["Nhớ", "ok"], ["Dễ", "ok"]].map(([label, cls], g) =>
          h("button", { class: "btn " + cls, onclick: () => done(it, g) }, label, h("small", {}, ivlLabel(card, g)))))
          : h("button", { class: "btn pri big", style: "width:100%", onclick: () => { open = true; draw(); } }, "Lật thẻ"));
    };
    document.onkeydown = (e) => {
      if (!open && (e.key === " " || e.key === "Enter")) { e.preventDefault(); open = true; draw(); }
      else if (open && "1234".includes(e.key)) done(it, Number(e.key) - 1);
    };
    draw();
  }
  function quiz(it) {
    const others = shuffle((pool.length >= 4 ? pool : allItems()).filter((o) => o.hanzi !== it.hanzi && o.vi !== it.vi)).slice(0, 3);
    const opts = shuffle([it, ...others]);
    const hanOpts = mode !== "vi";
    let picked = null;
    const prompt = {
      vi: () => [h("div", { class: "big" }, it.hanzi), speakBtn(it)],
      han: () => [h("div", { class: "vi" }, it.vi), it.pos ? h("span", { class: "tag" }, it.pos) : null],
      listen: () => [h("div", { class: "sub" }, "Nghe và chọn từ đúng"), h("button", { class: "btn big", onclick: () => pronounce(it) }, "🔊 Nghe lại")],
      pic: () => [picture(it), h("div", { class: "sub" }, "Hình này gợi đến từ nào?")],
      type: () => [h("div", { class: "vi" }, it.vi), it.pos ? h("span", { class: "tag" }, it.pos) : null],
    }[mode];
    const after = (ok) => [answerCard(it), h("div", { class: "fb " + (ok ? "ok" : "bad") }, ok ? "Đúng" : "Chưa đúng"),
      h("button", { class: "btn pri big", style: "width:100%;margin-top:10px", onclick: () => done(it, ok ? 2 : 0) }, "Tiếp")];
    const draw = () => {
      const body = [head(), h("div", { class: "card flash", style: "min-height:200px;cursor:default" }, prompt())];
      if (mode === "type") {
        const input = h("input", { class: "type", placeholder: "Gõ chữ Hán", autocomplete: "off", disabled: picked != null, value: picked || "" });
        const submit = () => { if (input.value.trim()) { picked = input.value.trim(); draw(); } };
        body.push(input, picked == null
          ? h("div", { class: "row", style: "margin-top:10px" }, h("button", { class: "btn pri", onclick: submit }, "Kiểm tra"),
            h("button", { class: "btn", onclick: (e) => { e.target.replaceWith(h("span", { style: "color:var(--acc)" }, it.pinyin)); } }, "Gợi ý pinyin"),
            h("button", { class: "btn", onclick: () => { picked = "?"; draw(); } }, "Không nhớ"))
          : after(picked === it.hanzi));
        document.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); picked == null ? submit() : done(it, picked === it.hanzi ? 2 : 0); } };
        stage.replaceChildren(...body.flat());
        if (picked == null) input.focus();
        return;
      }
      body.push(h("div", { class: "opts" + (hanOpts ? " han" : "") }, opts.map((o) =>
        h("button", { class: "btn" + (picked ? (o === it ? " ok" : o === picked ? " bad" : "") : ""), disabled: !!picked,
          onclick: () => { picked = o; draw(); } }, hanOpts ? o.hanzi : o.vi))));
      if (picked) body.push(after(picked === it));
      document.onkeydown = (e) => {
        if (!picked && "1234".includes(e.key) && opts[e.key - 1]) { picked = opts[e.key - 1]; draw(); }
        else if (picked && e.key === "Enter") done(it, picked === it ? 2 : 0);
      };
      stage.replaceChildren(...body.flat());
    };
    draw();
    if (mode === "listen") pronounce(it);
  }
  next();
});

// ---------- Sổ từ ----------
route(/^saved$/, () => {
  const items = savedItems();
  add(h("h1", {}, "Sổ từ"),
    h("div", { class: "sub" }, "Những từ bạn lưu khi đọc bài khóa. Chúng cũng được đưa vào lịch ôn hằng ngày."),
    items.length ? h("div", { class: "row", style: "margin:12px 0" },
      h("button", { class: "btn pri", onclick: () => go("#/study/saved/flash") }, "Thẻ lật"),
      h("button", { class: "btn", disabled: items.length < 4, onclick: () => go("#/study/saved/vi") }, "Chữ → nghĩa"),
      h("button", { class: "btn", disabled: items.length < 4, onclick: () => go("#/study/saved/han") }, "Nghĩa → chữ"),
      h("button", { class: "btn", disabled: items.length < 6, onclick: () => go("#/game/saved") }, "🎮 Ghép cặp")) : null,
    items.length ? h("div", { class: "wrap" }, h("table", { class: "words" }, items.map((i) => h("tr", {},
      h("td", {}, h("span", { class: "dot " + status(i.id) })),
      h("td", { class: "h", onclick: () => pronounce(i) }, i.hanzi), h("td", { class: "p" }, i.pinyin),
      h("td", {}, i.vi, h("span", { class: "tag" }, `bài ${i.lesson}`)),
      h("td", {}, h("button", { class: "btn", onclick: () => { P.saved[i.hanzi] = { del: true, t: Date.now() }; save(); render(); } }, "Bỏ"))))))
      : h("div", { class: "card sub" }, "Chưa có từ nào. Mở bài khóa, bấm vào một từ rồi chọn “Lưu vào sổ từ để ôn”."));
});

// ---------- Lịch sử ----------
route(/^history$/, () => {
  add(h("h1", {}, "Lịch sử học"));
  const exName = (id) => { for (const l of LESSONS) { const x = l.exercises.find((e) => e.id === id); if (x) return `Bài ${l.id} · ${x.title}`; } return id; };
  const days = {};
  for (const e of P.log) (days[dayNum(e.t)] = days[dayNum(e.t)] || []).push(e);
  const keys = Object.keys(days).map(Number).sort((a, b) => b - a);
  if (!keys.length) add(h("div", { class: "card sub" }, "Chưa có hoạt động nào được ghi lại."));
  for (const d of keys.slice(0, 60)) {
    const ev = days[d], cards = ev.filter((e) => e.k === "card");
    add(h("div", { class: "card" },
      h("h3", {}, fmtDay(d), d === dayNum() ? " · hôm nay" : ""),
      cards.length ? h("div", {}, `Ôn từ: ${cards.length} lượt, nhớ ${cards.filter((e) => e.g > 0).length}, quên ${cards.filter((e) => e.g === 0).length}`) : null,
      ev.filter((e) => e.k === "ex").map((e) => h("div", {}, `${exName(e.r)}: đúng ${e.ok}/${e.n} câu · ${fmtTime(e.t).slice(6)}`)),
      ev.filter((e) => e.k === "write").length ? h("div", {}, `Bài viết / câu dịch đã lưu: ${ev.filter((e) => e.k === "write").length}`) : null));
  }
  const written = [];
  for (const l of LESSONS) for (const x of l.exercises) if (!AUTO.has(x.type)) x.items.forEach((it, i) => {
    const a = P.answers[ansKey(x, i)];
    if (a && a.done && a.v) written.push({ l, x, it, a });
  });
  if (written.length) {
    add(h("h2", {}, "Bài viết và câu dịch đã lưu"));
    for (const w of written.sort((p, q) => q.a.t - p.a.t)) {
      add(h("a", { class: "card", style: "display:block;color:inherit", href: `#/ex/${w.l.id}/${w.x.id}` },
        h("div", { class: "sub" }, `Bài ${w.l.id} · ${w.x.title} · ${fmtTime(w.a.t)}`),
        h("div", { class: "sub" }, w.it.prompt || w.it.q), h("div", { class: "zh" }, w.a.v)));
    }
  }
});

// ---------- Khởi động ----------
window.addEventListener("hashchange", render);
window.addEventListener("focus", async () => {
  // Quay lại app sau khi học trên thiết bị khác: lấy bản mới nhất nếu máy này không có gì chưa gửi.
  if (!READY || pushing || $("#sync").textContent !== "Đã lưu") return;
  try {
    const remote = normalize(await store.get());
    if ((remote.rev || 0) !== P.rev) { P = remote; render(); }
  } catch {}
});
async function start() {
  view.replaceChildren(h("p", { class: "sub" }, "Đang tải…"));
  try { await Promise.all([loadProgress(), loadLessons()]); READY = true; render(); }
  catch (e) { console.error(e); view.replaceChildren(h("div", { class: "card" }, "Không tải được dữ liệu. Hãy kiểm tra kết nối rồi tải lại trang.")); }
}
// online.js quyết định chạy ở chế độ trên máy hay online rồi gọi start().
window.addEventListener("load", () => (typeof bootOnline === "function" ? bootOnline() : start()));
