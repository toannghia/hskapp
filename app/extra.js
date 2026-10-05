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
  const again = relearnItems().length;
  if (again) out.push({ t: `Học lại ${again} từ đã quên`, s: "Nhớ đúng hai lần liên tiếp thì từ đó rời danh sách.", href: "#/study/relearn/flash" });
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
  // Cột trái là chữ Hán, cột phải là nghĩa; mỗi cột xáo trộn riêng.
  const tiles = [...shuffle(picked.map((it) => ({ it, side: "han" }))), ...shuffle(picked.map((it) => ({ it, side: "vi" })))];
  let first = null, miss = 0, left = picked.length, lock = false;
  const t0 = Date.now();
  const clock = h("span", {});
  const timer = setInterval(() => { if (!clock.isConnected) return clearInterval(timer); clock.textContent = `${Math.round((Date.now() - t0) / 1000)} giây · sai ${miss}`; }, 500);
  tiles.forEach((tile) => {
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
  });
  const column = (side, title) => h("div", {}, h("div", { class: "sub" }, title), tiles.filter((t) => t.side === side).map((t) => t.el));
  const board = h("div", { class: "pairs" }, column("han", "Chữ Hán"), column("vi", "Nghĩa"));
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
    h("div", { class: "row sub" }, "Bấm một chữ Hán ở cột trái rồi bấm nghĩa của nó ở cột phải.", clock), board);
});

// ---------- Đánh giá tiến trình học ----------
// Tổng hợp mức thành thạo theo kỹ năng, xu hướng theo tuần, dự báo, và bài kiểm tra đánh giá có lưu điểm.
const learnedLessons = () => LESSONS.filter((l) => l.items.some((i) => P.cards[i.id]));
function skillLevels() {
  const items = LESSONS.flatMap((l) => l.items);
  const vocab = items.reduce((s, i) => s + ({ new: 0, learn: 0.5, known: 1 })[status(i.id)], 0) / Math.max(1, items.length);
  let right = 0, total = 0, written = 0, toWrite = 0;
  for (const l of LESSONS) for (const x of l.exercises) x.items.forEach((_, i) => {
    const a = P.answers[ansKey(x, i)];
    if (AUTO.has(x.type)) { total++; if (a && a.done && a.ok) right++; } else { toWrite++; if (a && a.done) written++; }
  });
  const days = new Set(P.log.map((e) => dayNum(e.t))), today = dayNum();
  const steady = Array.from({ length: 14 }, (_, k) => today - k).filter((d) => days.has(d)).length / 14;
  const tests = (P.tests || []).slice(-3);
  const test = tests.length ? tests.reduce((s, t) => s + t.score / t.n, 0) / tests.length : null;
  return { vocab, grammar: total ? right / total : 0, writing: toWrite ? written / toWrite : 0, steady, test };
}
function overallLevel(s) {
  const parts = [[s.vocab, 0.45], [s.grammar, 0.3], [s.writing, 0.1]].concat(s.test == null ? [] : [[s.test, 0.15]]);
  return parts.reduce((sum, [v, w]) => sum + v * w, 0) / parts.reduce((sum, [, w]) => sum + w, 0);
}
function weekStats(weeks = 6) {
  const today = dayNum(), ev = cardEvents(), out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const hi = today - w * 7, lo = hi - 6;
    const inWeek = ev.filter((e) => { const d = dayNum(e.t); return d >= lo && d <= hi; });
    out.push({ lo, hi, reviews: inWeek.length, kept: inWeek.filter((e) => e.g > 0).length,
      fresh: Object.values(P.cards).filter((c) => c.first >= lo && c.first <= hi).length });
  }
  return out;
}
const meter = (name, value, note) => h("div", { style: "margin:10px 0" },
  h("div", { class: "row", style: "justify-content:space-between" }, h("b", {}, name), h("span", {}, value == null ? "chưa có" : pct(value))),
  h("div", { class: "bar" }, h("i", { style: `width:${Math.round(100 * (value || 0))}%` })),
  note ? h("div", { class: "sub" }, note) : null);

route(/^assess$/, () => {
  const s = skillLevels(), level = overallLevel(s), items = LESSONS.flatMap((l) => l.items);
  const learned = items.filter((i) => P.cards[i.id]).length;
  const started = learnedLessons().length, solid = LESSONS.filter((l) => lessonScore(l).total >= 0.85).length;
  add(h("h1", {}, "Đánh giá tiến trình"),
    h("div", { class: "grid" },
      h("div", { class: "stat" }, h("b", {}, pct(level)), h("span", {}, `mức thành thạo chung · ${rank(level)}`)),
      h("div", { class: "stat" }, h("b", {}, `${started}/${LESSONS.length}`), h("span", {}, "bài đã bắt đầu học")),
      h("div", { class: "stat" }, h("b", {}, `${solid}/${LESSONS.length}`), h("span", {}, "bài đã vững (từ 85%)")),
      h("div", { class: "stat" }, h("b", {}, `${learned}/${items.length}`), h("span", {}, "từ đã học"))),
    h("h2", {}, "Theo kỹ năng"),
    h("div", { class: "card" },
      meter("Từ vựng", s.vocab, "Từ đang học tính một nửa, từ đã thuộc tính đủ."),
      meter("Ngữ pháp và bài tập", s.grammar, "Tỉ lệ câu bài tập tự chấm đã làm đúng trên tổng số câu."),
      meter("Viết", s.writing, "Tỉ lệ câu dịch và bài kể lại đã viết."),
      meter("Bài kiểm tra", s.test, "Trung bình ba bài kiểm tra gần nhất."),
      meter("Độ đều đặn", s.steady, "Số ngày có học trong 14 ngày gần đây.")));

  const weeks = weekStats(), top = Math.max(1, ...weeks.map((w) => w.reviews));
  add(h("h2", {}, "Xu hướng 6 tuần"),
    h("div", { class: "card" },
      h("div", { class: "bars" }, weeks.map((w) => h("div", { title: `${fmtDay(w.lo)}–${fmtDay(w.hi)}` },
        h("span", {}, w.reviews || ""), h("i", { style: `height:${Math.round(90 * w.reviews / top)}px` }), h("small", {}, fmtDay(w.lo))))),
      h("div", { class: "wrap", style: "margin-top:10px" }, h("table", { class: "cmp" },
        h("tr", {}, ["Tuần bắt đầu", "Lượt ôn", "Tỉ lệ nhớ", "Từ mới"].map((t) => h("th", {}, t))),
        weeks.map((w) => h("tr", {}, h("td", {}, fmtDay(w.lo)), h("td", {}, w.reviews),
          h("td", {}, w.reviews ? pct(w.kept / w.reviews) : "—"), h("td", {}, w.fresh)))))));

  // Dự báo theo nhịp học 14 ngày gần đây.
  const today = dayNum();
  const pace = Object.values(P.cards).filter((c) => c.first > today - 14).length / 14, left = items.length - learned;
  const last = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
  const notes = [];
  if (pace > 0 && left > 0) notes.push(`Với nhịp hiện tại (khoảng ${pace.toFixed(1)} từ mới mỗi ngày), bạn sẽ học hết ${left} từ còn lại sau khoảng ${Math.ceil(left / pace)} ngày.`);
  else if (left > 0) notes.push("Hai tuần qua bạn chưa học từ mới nào, nên chưa dự báo được ngày học hết.");
  else notes.push("Bạn đã học hết toàn bộ từ mới hiện có.");
  if (last.reviews && prev.reviews) {
    const a = last.kept / last.reviews, b = prev.kept / prev.reviews;
    notes.push(Math.abs(a - b) < 0.03 ? `Tỉ lệ nhớ tuần này giữ ở mức ${pct(a)}.` : a > b ? `Tỉ lệ nhớ tuần này tăng từ ${pct(b)} lên ${pct(a)}.` : `Tỉ lệ nhớ tuần này giảm từ ${pct(b)} xuống ${pct(a)}; nên giảm số từ mới mỗi ngày và ôn kỹ hơn.`);
  }
  const weakest = [["từ vựng", s.vocab], ["ngữ pháp và bài tập", s.grammar], ["viết", s.writing]].sort((x, y) => x[1] - y[1])[0];
  notes.push(`Kỹ năng đang thấp nhất là ${weakest[0]} (${pct(weakest[1])}).`);
  const due = dueItems().length;
  if (due > 30) notes.push(`Đang tồn ${due} thẻ đến hạn; nên ôn hết trước khi học từ mới.`);
  add(h("h2", {}, "Nhận xét và dự báo"), h("div", { class: "card" }, h("ul", { class: "exs" }, notes.map((n) => h("li", {}, n)))));

  const tests = P.tests || [];
  const scope = h("select", {}, h("option", { value: "learned" }, "Các bài đã học"), h("option", { value: "all" }, "Tất cả các bài"),
    LESSONS.map((l) => h("option", { value: `l${l.id}` }, `Chỉ bài ${l.id}`)));
  add(h("h2", {}, "Bài kiểm tra đánh giá"),
    h("div", { class: "card" },
      h("div", {}, "20 câu trộn ba dạng: chữ → nghĩa, nghĩa → chữ và chọn từ đúng theo ngữ pháp. Làm xong mới biết kết quả; điểm được lưu để theo dõi tiến bộ."),
      h("div", { class: "row", style: "margin-top:10px" }, h("label", {}, "Phạm vi ", scope),
        h("button", { class: "btn pri", onclick: () => go(`#/assess/test/${scope.value}`) }, "Bắt đầu kiểm tra")),
      tests.length ? h("div", { class: "wrap", style: "margin-top:12px" }, h("table", { class: "cmp" },
        h("tr", {}, ["Ngày", "Phạm vi", "Điểm", "Từ vựng", "Ngữ pháp"].map((t) => h("th", {}, t))),
        tests.slice().reverse().slice(0, 12).map((t) => h("tr", {}, h("td", {}, fmtTime(t.t)), h("td", {}, scopeName(t.scope)),
          h("td", {}, h("b", {}, `${t.score}/${t.n}`)), h("td", {}, `${t.vocab[0]}/${t.vocab[1]}`), h("td", {}, `${t.grammar[0]}/${t.grammar[1]}`)))))
        : h("div", { class: "sub", style: "margin-top:8px" }, "Chưa làm bài kiểm tra nào.")));

  add(h("h2", {}, "Từng bài"),
    h("div", { class: "wrap" }, h("table", { class: "cmp" },
      h("tr", {}, ["Bài", "Mức", "Xếp loại", "Nên làm"].map((t) => h("th", {}, t))),
      LESSONS.map((l) => { const sc = lessonScore(l); const todo = sc.vocab < 0.5 ? ["Học từ mới", `#/study/l${l.id}/flash`]
        : sc.ex < 0.7 ? ["Làm bài tập", `#/lesson/${l.id}/ex`] : sc.wr < 0.5 ? ["Viết bài", `#/lesson/${l.id}/ex`] : ["Kiểm tra", `#/assess/test/l${l.id}`];
        return h("tr", {}, h("td", {}, `Bài ${l.id} `, h("span", { class: "zh" }, l.title.zh)), h("td", {}, pct(sc.total)), h("td", {}, rank(sc.total)),
          h("td", {}, h("a", { href: todo[1] }, todo[0]))); }))));
});
const scopeName = (s) => (s === "learned" ? "Bài đã học" : s === "all" ? "Tất cả" : "Bài " + s.slice(1));

route(/^assess\/test\/(\w+)$/, (scope) => {
  let lessons = scope === "all" ? LESSONS : scope === "learned" ? learnedLessons() : LESSONS.filter((l) => `l${l.id}` === scope);
  if (!lessons.length) lessons = LESSONS.slice(0, 1);
  const pool = lessons.flatMap((l) => l.items);
  const pickOthers = (it) => shuffle(pool.filter((o) => o.hanzi !== it.hanzi && o.vi !== it.vi)).slice(0, 3);
  const grammarPool = shuffle(lessons.flatMap((l) => l.exercises.filter((x) => x.type === "choice").flatMap((x) => x.items)));
  const grammar = grammarPool.slice(0, 6).map((g) => ({ kind: "grammar", q: g.q, options: g.options, a: g.a, why: g.why }));
  const words = shuffle(pool).slice(0, 20 - grammar.length);
  const vocab = words.map((it, k) => { const opts = shuffle([it, ...pickOthers(it)]);
    return k % 2 ? { kind: "han", it, q: it.vi, options: opts.map((o) => o.hanzi), a: opts.indexOf(it) }
      : { kind: "vi", it, q: it.hanzi, options: opts.map((o) => o.vi), a: opts.indexOf(it) }; });
  const qs = shuffle([...vocab, ...grammar]);
  const picked = [];
  const stage = h("div", {});
  add(h("a", { href: "#/assess", class: "sub" }, "← Thoát bài kiểm tra"), h("h1", {}, `Kiểm tra: ${scopeName(scope)}`), stage);

  const ask = (k) => {
    if (k >= qs.length) return finish();
    const q = qs[k], zhQ = q.kind !== "han", zhOpt = q.kind !== "vi";
    stage.replaceChildren(
      h("div", { class: "sub" }, `Câu ${k + 1}/${qs.length} · ${{ vi: "Chọn nghĩa đúng", han: "Chọn chữ Hán đúng", grammar: "Chọn từ đúng điền vào chỗ trống" }[q.kind]}`),
      h("div", { class: "bar" }, h("i", { style: `width:${Math.round(100 * k / qs.length)}%` })),
      h("div", { class: "card flash", style: "min-height:150px;cursor:default" }, h("div", { class: zhQ ? (q.kind === "vi" ? "big" : "zh") : "vi", style: q.kind === "grammar" ? "font-size:24px" : "" }, q.q)),
      h("div", { class: "opts" + (zhOpt ? " han" : "") }, q.options.map((o, j) => h("button", { class: "btn", onclick: () => { picked[k] = j; ask(k + 1); } }, o))));
  };
  const finish = () => {
    const right = (kinds) => qs.filter((q, k) => kinds.includes(q.kind) && picked[k] === q.a).length;
    const count = (kinds) => qs.filter((q) => kinds.includes(q.kind)).length;
    const score = right(["vi", "han", "grammar"]);
    P.tests = (P.tests || []).concat([{ t: Date.now(), scope, score, n: qs.length, vocab: [right(["vi", "han"]), count(["vi", "han"])], grammar: [right(["grammar"]), count(["grammar"])] }]);
    // Từ làm sai được đưa về trạng thái cần ôn lại ngay.
    qs.forEach((q, k) => { if (q.it && picked[k] !== q.a) { P.cards[q.it.id] = nextCard(P.cards[q.it.id], 0); trackRelearn(q.it.id, false); } });
    logEvent({ k: "test", r: scope, ok: score, n: qs.length });
    save();
    const wrong = qs.map((q, k) => ({ q, mine: picked[k] })).filter((x) => x.mine !== x.q.a);
    stage.replaceChildren(...[
      h("div", { class: "card", style: "text-align:center" }, h("h1", {}, `${score}/${qs.length} điểm`),
        h("div", {}, `Từ vựng ${right(["vi", "han"])}/${count(["vi", "han"])} · Ngữ pháp ${right(["grammar"])}/${count(["grammar"])}`),
        h("div", { class: "sub" }, rank(score / qs.length), wrong.length ? " · các từ làm sai đã được đưa vào lịch ôn" : ""),
        h("div", { class: "row", style: "justify-content:center;margin-top:10px" },
          h("button", { class: "btn pri", onclick: () => go("#/assess") }, "Xem đánh giá"), h("button", { class: "btn", onclick: render }, "Làm bài khác"))),
      wrong.length ? h("h2", {}, `Câu làm sai (${wrong.length})`) : null,
      wrong.map(({ q, mine }) => h("div", { class: "card" }, h("div", { class: q.kind === "han" ? "" : "zh" }, q.q),
        h("div", { class: "fb bad" }, "Bạn chọn: ", h("span", { class: q.kind === "vi" ? "" : "zh" }, q.options[mine])),
        h("div", { class: "fb ok" }, "Đáp án: ", h("span", { class: q.kind === "vi" ? "" : "zh" }, q.options[q.a]), q.it ? ` · ${q.it.pinyin}` : "", q.why ? ` — ${q.why}` : "")))].flat().filter(Boolean));
  };
  ask(0);
});

// ---------- Cách viết: xem thứ tự nét và tập viết từng chữ ----------
// Dùng thư viện mã nguồn mở Hanzi Writer (giấy phép MIT), dữ liệu nét từ dự án Make Me a Hanzi; cần có mạng.
let writerLoading = null;
const loadWriter = () => (writerLoading = writerLoading || new Promise((ok, fail) => {
  if (window.HanziWriter) return ok();
  document.head.append(h("script", { src: "https://cdn.jsdelivr.net/npm/hanzi-writer@3.5/dist/hanzi-writer.min.js", onload: ok, onerror: () => { writerLoading = null; fail(); } }));
}));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function writePage(word, info, links) {
  const chars = [...word].filter((c) => /[一-鿿]/.test(c));
  const results = {};
  const status = h("div", { class: "sub" });
  const grid = h("div", { class: "writers" });
  add(h("a", { href: links.back, class: "sub" }, "← Quay lại"),
    h("div", { class: "row", style: "align-items:baseline;margin-top:6px" },
      h("h1", { class: "zh", style: "font-size:40px;margin:0" }, word),
      h("span", { style: "color:var(--acc);font-size:20px" }, info.pinyin || ""), speakBtn(info.item || word)),
    h("div", {}, info.vi || ""),
    h("div", { class: "sub", style: "margin:8px 0" }, "Bấm “Xem nét” để xem thứ tự nét. Bấm “Tập viết” rồi dùng chuột hoặc ngón tay viết từng nét theo đúng thứ tự; viết sai nét nào, nét đó sẽ được gợi ý."),
    grid, status,
    h("div", { class: "row", style: "margin-top:16px" },
      links.prev ? h("a", { class: "btn", href: links.prev }, "← Từ trước") : null,
      links.next ? h("a", { class: "btn pri", href: links.next }, "Từ tiếp theo →") : null));
  loadWriter().then(() => {
    if (!grid.isConnected) return;
    chars.forEach((c, k) => {
      const box = h("div", { class: "writer-box" }), note = h("div", { class: "sub" }, " ");
      const cell = h("div", { class: "writer" }, box, note);
      grid.append(cell);
      const writer = HanziWriter.create(box, c, { width: 170, height: 170, padding: 8, showOutline: true,
        strokeColor: cssVar("--ink"), outlineColor: cssVar("--line"), drawingColor: cssVar("--acc"), highlightColor: cssVar("--ok"),
        strokeAnimationSpeed: 0.8, delayBetweenStrokes: 250, drawingWidth: 22,
        onLoadCharDataError: () => { note.textContent = "Chưa có dữ liệu nét cho chữ này."; } });
      cell.append(h("div", { class: "row", style: "justify-content:center;margin-top:6px" },
        h("button", { class: "btn", onclick: () => { writer.cancelQuiz(); writer.showCharacter(); writer.animateCharacter(); } }, "▶ Xem nét"),
        h("button", { class: "btn", onclick: () => {
          note.textContent = "Viết nét đầu tiên…";
          writer.quiz({ showHintAfterMisses: 2,
            onMistake: (d) => { note.textContent = `Nét ${d.strokeNum + 1}: chưa đúng (sai ${d.totalMistakes} lần)`; },
            onCorrectStroke: (d) => { note.textContent = `Đúng nét ${d.strokeNum + 1}, còn ${d.strokesRemaining} nét`; },
            onComplete: (d) => {
              note.textContent = d.totalMistakes ? `Xong, sai ${d.totalMistakes} lần` : "Xong, không sai nét nào";
              results[k] = d.totalMistakes;
              if (Object.keys(results).length === chars.length && info.item && !results.graded) {
                // Viết xong cả từ: tính như một lượt ôn (sai quá 2 lần mỗi chữ thì coi là chưa nhớ).
                results.graded = true;
                const miss = chars.reduce((s, _, i) => s + results[i], 0);
                grade(info.item, miss <= chars.length * 2 ? 2 : 0, "write");
                status.textContent = `Đã ghi nhận lượt tập viết từ này (tổng ${miss} lần sai nét).`;
              }
            } });
        } }, "✍ Tập viết")));
    });
  }).catch(() => { grid.replaceChildren(h("div", { class: "card sub" }, "Không tải được công cụ viết chữ. Phần này cần có mạng; kiểm tra kết nối rồi tải lại trang.")); });
}

// Viết từ mới của một bài, có nút chuyển sang từ trước / từ sau.
route(/^write\/(\d+)\/(\d+)$/, (lid, num) => {
  const l = lessonById(lid), at = l ? l.items.findIndex((i) => i.n === Number(num)) : -1;
  if (at < 0) return go("#/");
  const it = l.items[at];
  writePage(it.hanzi, { pinyin: it.pinyin, vi: it.vi, item: it }, { back: `#/lesson/${l.id}/words`,
    prev: at > 0 ? `#/write/${l.id}/${l.items[at - 1].n}` : null, next: at + 1 < l.items.length ? `#/write/${l.id}/${l.items[at + 1].n}` : null });
});
// Viết một từ bất kỳ (mở từ bảng tra trong bài khóa).
route(/^write\/w\/(.+)$/, (raw) => {
  const word = decodeURIComponent(raw);
  let found = null;
  for (const l of LESSONS) if (l.gloss && l.gloss[word]) { found = { pinyin: l.gloss[word][0], vi: l.gloss[word][1] }; break; }
  writePage(word, found || {}, { back: "javascript:history.back()" });
});
