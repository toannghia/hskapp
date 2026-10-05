// Bảng điểm, gợi ý nên học gì trước, mục tiêu và nhắc lịch học, trò chơi ghép cặp. Nạp sau app.js.
"use strict";

// ---------- Số liệu dùng chung ----------
const cardEvents = () => P.log.filter((e) => e.k === "card");
const todayCount = () => { const t = dayNum(); return cardEvents().filter((e) => dayNum(e.t) === t).length; };
// Từ hay quên: đã quên từ 2 lần trở lên, hoặc độ dễ tụt thấp.
const weakItems = () => allItems().filter((i) => { const c = P.cards[i.id]; return c && (c.lapses >= 2 || c.ease < 2.0); })
  .sort((a, b) => P.cards[b.id].lapses - P.cards[a.id].lapses);

function lessonScore(l) {
  const vocab = l.items.reduce((s, i) => s + ({ new: 0, learn: 0.5, known: 1 })[status(i.id)], 0) / l.items.length;
  let right = 0, total = 0, written = 0, toWrite = 0;
  for (const x of l.exercises) x.items.forEach((_, i) => {
    const a = P.answers[ansKey(x, i)];
    if (AUTO.has(x.type)) { total++; if (a && a.done && a.ok) right++; }
    else { toWrite++; if (a && a.done) written++; }
  });
  const ex = total ? right / total : 0, wr = toWrite ? written / toWrite : 0;
  return { vocab, ex, wr, total: 0.5 * vocab + 0.35 * ex + 0.15 * wr };
}
const pct = (x) => Math.round(x * 100) + "%";
const rank = (x) => (x >= 0.85 ? "Vững" : x >= 0.6 ? "Khá" : x >= 0.3 ? "Đang học" : "Mới bắt đầu");

// ---------- Nên học gì trước ----------
function priorities() {
  const out = [];
  const due = dueItems().length;
  if (due) out.push({ t: `Ôn ${due} thẻ đến hạn`, s: "Để lâu sẽ quên, nên làm đầu tiên.", href: "#/study/due/flash" });
  for (const l of LESSONS) for (const x of l.exercises) {
    if (!AUTO.has(x.type)) continue;
    const wrong = x.items.filter((_, i) => { const a = P.answers[ansKey(x, i)]; return a && a.done && !a.ok; }).length;
    if (wrong) out.push({ t: `Xem lại ${wrong} câu sai: ${x.title}`, s: `Bài ${l.id}`, href: `#/ex/${l.id}/${x.id}` });
  }
  const weak = weakItems().length;
  if (weak) out.push({ t: `Luyện ${weak} từ hay quên`, s: "Những từ bạn đã quên từ hai lần trở lên.", href: "#/study/weak/flash" });
  const fresh = newItemsToday().length;
  if (fresh) out.push({ t: `Học ${fresh} từ mới`, s: "Theo số từ mới mỗi ngày bạn đã đặt.", href: "#/study/due/flash" });
  for (const l of LESSONS) {
    const x = l.exercises.find((e) => !exSummary(l, e));
    if (x) { out.push({ t: `Làm bài tập: ${x.title}`, s: `Bài ${l.id} · chưa làm`, href: `#/ex/${l.id}/${x.id}` }); break; }
  }
  return out.slice(0, 5);
}

// ---------- Mục tiêu và nhắc lịch ----------
const goal = () => P.settings.goal || 20;
function downloadIcs() {
  const [hh, mm] = (P.settings.remindAt || "20:00").split(":");
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${hh}${mm}00`;
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//On HSK5//VI", "BEGIN:VEVENT", `UID:hsk5-${Date.now()}@on-hsk5`,
    `DTSTAMP:${stamp}`, `DTSTART:${stamp}`, "DURATION:PT20M", "RRULE:FREQ=DAILY", "SUMMARY:Ôn HSK5",
    `DESCRIPTION:Ôn thẻ đến hạn và học từ mới. ${location.origin}`, "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Đến giờ ôn HSK5", "TRIGGER:PT0M",
    "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = h("a", { href: URL.createObjectURL(new Blob([ics], { type: "text/calendar" })), download: "on-hsk5.ics" });
  document.body.append(a); a.click(); a.remove();
}
function checkReminder() {
  if (!READY || !P.settings.remindOn) return;
  const now = new Date(), [hh, mm] = (P.settings.remindAt || "20:00").split(":").map(Number);
  const key = "hsk5-reminded", today = String(dayNum());
  if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm || todayCount() >= goal() || localStorage.getItem(key) === today) return;
  localStorage.setItem(key, today);
  const text = `Hôm nay bạn mới ôn ${todayCount()}/${goal()} lượt.`;
  if ("Notification" in window && Notification.permission === "granted") new Notification("Đến giờ ôn HSK5", { body: text });
  else if (location.hash.replace(/^#\/?/, "") === "") render();
}
setInterval(checkReminder, 60000);

function homeExtras() {
  const done = todayCount(), g = goal(), list = priorities();
  const late = P.settings.remindOn && done < g && (() => { const n = new Date(), [a, b] = (P.settings.remindAt || "20:00").split(":").map(Number); return n.getHours() * 60 + n.getMinutes() >= a * 60 + b; })();
  return [
    h("div", { class: "card" + (late ? " warn" : "") },
      h("b", {}, `Mục tiêu hôm nay: ${done}/${g} lượt ôn`, done >= g ? " · đã đạt" : late ? " · đã quá giờ hẹn" : ""),
      h("div", { class: "bar" }, h("i", { style: `width:${Math.min(100, Math.round(100 * done / g))}%` })),
      h("div", { class: "row sub", style: "margin-top:10px" },
        h("label", {}, "Mục tiêu ", h("select", { onchange: (e) => { P.settings.goal = Number(e.target.value); save(); render(); } },
          [10, 20, 30, 50, 80].map((n) => h("option", { value: n, selected: n === g }, n)))),
        h("label", {}, "Giờ nhắc ", h("input", { type: "time", value: P.settings.remindAt || "20:00",
          onchange: (e) => { P.settings.remindAt = e.target.value; save(); } })),
        h("button", { class: "btn" + (P.settings.remindOn ? " on" : ""), onclick: async () => {
          P.settings.remindOn = !P.settings.remindOn;
          if (P.settings.remindOn && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
          save(); render();
        } }, P.settings.remindOn ? "Đang bật nhắc" : "Bật nhắc"),
        h("button", { class: "btn", onclick: downloadIcs }, "Thêm vào Lịch")),
      h("div", { class: "sub", style: "margin-top:6px" }, "Nhắc trong app chỉ hiện khi app đang mở. Muốn điện thoại tự báo mỗi ngày, bấm “Thêm vào Lịch” rồi mở tệp tải về.")),
    list.length ? [h("h2", {}, "Nên làm trước"),
      list.map((p, i) => h("a", { class: "card", href: p.href, style: "display:block;color:inherit;padding:10px 16px" },
        h("b", {}, `${i + 1}. ${p.t}`), h("div", { class: "sub" }, p.s)))] : null,
  ];
}

// ---------- Bảng điểm ----------
route(/^score$/, () => {
  const ev = cardEvents(), items = allItems();
  const kept = ev.filter((e) => e.g > 0).length;
  add(h("h1", {}, "Bảng điểm"),
    h("div", { class: "grid" },
      h("div", { class: "stat" }, h("b", {}, items.filter((i) => status(i.id) === "known").length), h("span", {}, `từ đã thuộc / ${items.length}`)),
      h("div", { class: "stat" }, h("b", {}, items.filter((i) => status(i.id) === "learn").length), h("span", {}, "từ đang học")),
      h("div", { class: "stat" }, h("b", {}, ev.length ? pct(kept / ev.length) : "—"), h("span", {}, `tỉ lệ nhớ (${ev.length} lượt ôn)`)),
      h("div", { class: "stat" }, h("b", {}, streak()), h("span", {}, "ngày học liên tiếp"))),
    h("h2", {}, "Theo bài"),
    h("div", { class: "wrap" }, h("table", { class: "cmp" },
      h("tr", {}, ["Bài", "Từ vựng", "Bài tập", "Bài viết", "Tổng", "Xếp loại"].map((t) => h("th", {}, t))),
      LESSONS.map((l) => { const s = lessonScore(l); return h("tr", {},
        h("td", {}, h("a", { href: `#/lesson/${l.id}/words` }, `Bài ${l.id} `, h("span", { class: "zh" }, l.title.zh))),
        h("td", {}, pct(s.vocab)), h("td", {}, pct(s.ex)), h("td", {}, pct(s.wr)), h("td", {}, h("b", {}, pct(s.total))), h("td", {}, rank(s.total))); }))),
    h("div", { class: "sub" }, "Tổng = 50% từ vựng (đang học tính một nửa, đã thuộc tính đủ) + 35% bài tập làm đúng + 15% bài viết đã làm."));

  const days = Array.from({ length: 14 }, (_, i) => dayNum() - 13 + i);
  const per = days.map((d) => ev.filter((e) => dayNum(e.t) === d).length), top = Math.max(1, ...per);
  add(h("h2", {}, "14 ngày gần đây"),
    h("div", { class: "card" }, h("div", { class: "bars" }, days.map((d, i) =>
      h("div", { title: `${fmtDay(d)}: ${per[i]} lượt` }, h("span", {}, per[i] || ""), h("i", { style: `height:${Math.round(90 * per[i] / top)}px` }), h("small", {}, fmtDay(d).slice(0, 2)))))));

  const modes = {};
  for (const e of ev) { const m = (modes[e.m] = modes[e.m] || [0, 0]); m[1]++; if (e.g > 0) m[0]++; }
  if (ev.length) add(h("h2", {}, "Theo cách ôn"),
    h("div", { class: "wrap" }, h("table", { class: "cmp" }, Object.entries(modes).map(([m, [ok, n]]) =>
      h("tr", {}, h("td", {}, (MODES.find((x) => x[0] === m) || [0, m])[1]), h("td", {}, `${ok}/${n}`), h("td", {}, pct(ok / n)))))));

  const weak = weakItems().slice(0, 12);
  add(h("h2", {}, "Từ hay quên"),
    weak.length ? [h("div", { class: "wrap" }, h("table", { class: "words" }, weak.map((i) => h("tr", {},
      h("td", { class: "h", onclick: () => pronounce(i) }, i.hanzi), h("td", { class: "p" }, i.pinyin), h("td", {}, i.vi),
      h("td", { class: "sub" }, `quên ${P.cards[i.id].lapses} lần`))))),
      h("button", { class: "btn pri", style: "margin-top:10px", onclick: () => go("#/study/weak/flash") }, "Luyện các từ này")]
      : h("div", { class: "card sub" }, "Chưa có từ nào bị quên nhiều lần."));

  const games = Object.entries(P.games || {});
  if (games.length) add(h("h2", {}, "Trò chơi ghép cặp"),
    games.map(([k, g]) => h("div", {}, `${k === "saved" ? "Sổ từ" : "Bài " + k.slice(1)}: nhanh nhất ${g.best} giây · đã chơi ${g.plays} ván`)));
});

// ---------- Trò chơi ghép cặp chữ Hán với nghĩa ----------
route(/^game\/(\w+)$/, (scope) => {
  const l = scope === "saved" ? null : lessonById(scope.slice(1));
  const pool = l ? l.items : savedItems();
  const back = l ? `#/lesson/${l.id}/words` : "#/saved";
  if (pool.length < 6) return go(back);
  const picked = shuffle(pool).slice(0, 6);
  const tiles = shuffle(picked.flatMap((it) => [{ it, side: "han" }, { it, side: "vi" }]));
  let first = null, miss = 0, left = picked.length, lock = false;
  const t0 = Date.now();
  const clock = h("span", {});
  const timer = setInterval(() => { if (!clock.isConnected) return clearInterval(timer); clock.textContent = `${Math.round((Date.now() - t0) / 1000)} giây · sai ${miss}`; }, 500);
  const board = h("div", { class: "pairs" }, tiles.map((tile) => {
    tile.el = h("button", { class: "btn " + (tile.side === "han" ? "zh" : ""), onclick: () => {
      if (lock || tile.done || tile === first) return;
      if (!first) { first = tile; tile.el.classList.add("on"); return; }
      const a = first; first = null;
      if (a.it === tile.it && a.side !== tile.side) {
        for (const x of [a, tile]) { x.done = true; x.el.classList.remove("on"); x.el.classList.add("ok"); x.el.disabled = true; }
        pronounce(tile.it);
        if (--left === 0) finish();
      } else {
        miss++; lock = true;
        for (const x of [a, tile]) x.el.classList.add("bad");
        setTimeout(() => { for (const x of [a, tile]) x.el.classList.remove("bad", "on"); lock = false; }, 500);
      }
    } }, tile.side === "han" ? tile.it.hanzi : tile.it.vi);
    return tile.el;
  }));
  function finish() {
    clearInterval(timer);
    const secs = Math.round((Date.now() - t0) / 1000);
    P.games = P.games || {};
    const g = P.games[scope] || { best: secs, plays: 0 };
    const record = !g.plays || secs < g.best;
    P.games[scope] = { best: Math.min(g.best, secs), plays: g.plays + 1 };
    logEvent({ k: "game", r: scope, s: secs, miss });
    save();
    add(h("div", { class: "card", style: "text-align:center" },
      h("h3", {}, `Xong trong ${secs} giây, sai ${miss} lần`, record ? " · kỷ lục mới" : ` · kỷ lục ${P.games[scope].best} giây`),
      h("div", { class: "row", style: "justify-content:center;margin-top:8px" },
        h("button", { class: "btn pri", onclick: render }, "Chơi ván nữa"), h("button", { class: "btn", onclick: () => go(back) }, "Quay lại"))));
  }
  add(h("a", { href: back, class: "sub" }, "← Thoát"), h("h1", {}, "Ghép cặp"),
    h("div", { class: "row sub" }, "Bấm một chữ Hán rồi bấm nghĩa của nó.", clock), board);
});
