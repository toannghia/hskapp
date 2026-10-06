// Ôn cấu trúc theo lịch ngắt quãng và sổ câu sai (làm lại những câu bài tập đã sai). Nạp sau extra.js.
"use strict";

// ---------- Thẻ cấu trúc ----------
// Mỗi điểm ngữ pháp là một thẻ, lịch ôn lưu riêng ở P.gcards để không lẫn với thẻ từ.
const GRAM_NEW_PER_DAY = 3;
const gramCards = () => LESSONS.flatMap((l) => l.grammar.filter((g) => g.id && ((g.points || []).some((p) => p.examples && p.examples.length) || g.compare))
  .map((g) => ({ id: g.id, lesson: l.id, g })));
// Bài đã bắt đầu học: đã ôn ít nhất một từ hoặc làm ít nhất một bài tập của bài đó.
const lessonStarted = (l) => l.items.some((i) => P.cards[i.id]) || l.exercises.some((x) => exSummary(l, x));
const gramDue = () => { const t = dayNum(), c = P.gcards || {}; return gramCards().filter((k) => c[k.id] && c[k.id].due <= t); };
function gramNew() {
  const t = dayNum(), c = P.gcards || {};
  const introduced = Object.values(c).filter((x) => x.first === t).length;
  const started = new Set(LESSONS.filter(lessonStarted).map((l) => l.id));
  return gramCards().filter((k) => !c[k.id] && started.has(k.lesson)).slice(0, Math.max(0, GRAM_NEW_PER_DAY - introduced));
}
function gradeGram(card, g) {
  P.gcards = P.gcards || {};
  P.gcards[card.id] = nextCard(P.gcards[card.id], g);
  logEvent({ k: "gram", r: card.id, g });
  save();
}
const gramStatus = (id) => { const c = (P.gcards || {})[id]; return !c ? "new" : c.ivl >= 7 ? "known" : "learn"; };

// Nút ôn đặt ở đầu thẻ "Cấu trúc" của mỗi bài.
function grammarStudyBox(l) {
  const mine = gramCards().filter((k) => k.lesson === l.id);
  if (!mine.length) return null;
  const known = mine.filter((k) => gramStatus(k.id) === "known").length;
  return h("div", { class: "card row" },
    h("button", { class: "btn pri", onclick: () => go(`#/gram/l${l.id}`) }, `Ôn ${mine.length} cấu trúc của bài này`),
    h("span", { class: "sub" }, `Đã thuộc ${known}/${mine.length}. Mỗi cấu trúc sẽ được hỏi lại theo lịch như từ mới.`));
}

route(/^gram\/(\w+)$/, (scope) => {
  let queue, back = "#/";
  if (scope === "due") queue = [...gramDue(), ...gramNew()];
  else {
    const l = lessonById(scope.slice(1));
    if (!l) return go("#/");
    back = `#/lesson/${l.id}/grammar`;
    const t = dayNum(), rank = (k) => { const c = (P.gcards || {})[k.id]; return !c ? 1 : c.due <= t ? 0 : 2; };
    queue = gramCards().filter((k) => k.lesson === l.id).sort((a, b) => rank(a) - rank(b));
  }
  const total = queue.length, tally = { right: 0, wrong: 0 };
  const stage = h("div", {});
  add(stage, h("div", { style: "margin-top:36px;text-align:center" }, h("a", { href: back, class: "btn" }, "Thoát phiên ôn")));

  const explain = (g) => grammarBody(g);

  function finish() {
    document.onkeydown = null;
    stage.replaceChildren(h("div", { class: "card", style: "text-align:center" },
      h("h1", {}, total ? "Xong phiên ôn cấu trúc" : "Chưa có cấu trúc nào cần ôn"),
      total ? h("p", {}, `Nhớ ${tally.right} · quên ${tally.wrong} · ${total} cấu trúc`)
        : h("p", { class: "sub" }, "Cấu trúc của một bài sẽ vào lịch ôn khi bạn bắt đầu học bài đó."),
      h("div", { class: "row", style: "justify-content:center" }, h("button", { class: "btn pri", onclick: () => go(back) }, "Quay lại"))));
  }
  function show(k) {
    const g = k.g, card = (P.gcards || {})[k.id];
    // Cách dùng: cho câu tiếng Việt, tự nói hoặc viết câu tiếng Trung có dùng cấu trúc. Phân biệt: tự nhớ lại điểm khác nhau.
    const exs = (g.points || []).flatMap((p) => p.examples || []);
    const ask = exs.length ? shuffle(exs)[0] : null;
    let open = false;
    const ta = h("textarea", { class: "zh wide", placeholder: ask ? "Viết câu tiếng Trung của bạn (không bắt buộc)…" : "Ghi lại điểm khác nhau bạn nhớ được (không bắt buộc)…" });
    const done = (gr) => { gradeGram(k, gr); if (gr === 0) { tally.wrong++; queue.push(k); } else tally.right++; queue.shift(); next(); };
    const draw = () => {
      stage.replaceChildren(...[
        h("div", { class: "row sub", style: "justify-content:space-between" },
          h("span", {}, `Ôn cấu trúc · bài ${k.lesson}`), h("span", {}, `Còn ${queue.length} · nhớ ${tally.right} · quên ${tally.wrong}`)),
        h("div", { class: "card" },
          h("h3", {}, h("span", { class: "zh", style: "font-size:26px" }, g.title), h("span", { class: "tag acc" }, g.kind)),
          ask ? [h("div", { class: "sub" }, "Nói hoặc viết câu này bằng tiếng Trung, có dùng cấu trúc trên:"), h("p", { style: "font-size:18px" }, ask.vi)]
            : h("div", { class: "sub" }, "Hai từ này giống và khác nhau ở đâu? Tự nhớ lại rồi mới xem."),
          ta,
          open ? [ask ? h("div", { class: "fb model" }, "Câu mẫu: ", h("span", { class: "zh", style: "cursor:pointer", onclick: () => speak(ask.zh) }, ask.zh)) : null, explain(g)] : null),
        open ? [h("div", { class: "sub", style: "margin-top:8px" }, "Tự chấm: bạn nhớ cấu trúc này đến đâu?"),
          h("div", { class: "grade" }, [["Quên", "bad"], ["Khó", ""], ["Nhớ", "ok"], ["Dễ", "ok"]].map(([label, cls], gr) =>
            h("button", { class: "btn " + cls, onclick: () => done(gr) }, label, h("small", {}, ivlLabel(card, gr)))))]
          : h("button", { class: "btn pri big", style: "width:100%", onclick: () => { open = true; draw(); } }, "Xem câu mẫu và cách dùng"),
      ].flat(Infinity).filter(Boolean));
      if (open) { const b = stage.querySelector(".grade"); if (b) b.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    };
    document.onkeydown = (e) => {
      if (e.target === ta) return;
      if (!open && e.key === "Enter") { e.preventDefault(); open = true; draw(); }
      else if (open && "1234".includes(e.key)) done(Number(e.key) - 1);
    };
    draw();
  }
  function next() { queue.length ? show(queue[0]) : finish(); }
  next();
});

// ---------- Sổ câu sai ----------
// Câu bài tập làm sai tự vào sổ, mai hỏi lại. Làm đúng thì hỏi lại sau vài ngày; đúng WRONG_GOAL lần liên tiếp thì ra khỏi sổ.
const WRONG_GOAL = 2, WRONG_GAP = [3, 7];
function trackWrong(key, ok) {
  P.wrong = P.wrong || {};
  const cur = P.wrong[key], t = dayNum();
  if (!ok) P.wrong[key] = { streak: 0, due: t + 1, since: cur && !cur.done ? cur.since : Date.now(), t: Date.now() };
  else if (cur && !cur.done) {
    const streak = cur.streak + 1;
    P.wrong[key] = streak >= WRONG_GOAL ? { done: true, t: Date.now() } : { ...cur, streak, due: t + WRONG_GAP[Math.min(streak, WRONG_GAP.length) - 1], t: Date.now() };
  }
}
// Lần đầu có sổ: đưa vào những câu đang ở trạng thái sai, hỏi lại được ngay.
function backfillWrong() {
  if (P.wrong) return;
  P.wrong = {};
  for (const [k, a] of Object.entries(P.answers)) if (a && a.done && a.ok === false && wrongRef(k)) P.wrong[k] = { streak: 0, due: dayNum(), since: a.t, t: a.t };
  if (Object.keys(P.wrong).length) save();
}
function wrongRef(key) {
  const at = key.lastIndexOf(":"), xid = key.slice(0, at), i = Number(key.slice(at + 1));
  for (const l of LESSONS) {
    const x = l.exercises.find((e) => e.id === xid);
    if (x) return AUTO.has(x.type) && x.items[i] ? { key, l, x, it: x.items[i], i } : null;
  }
  return null;
}
const wrongOpen = () => Object.entries(P.wrong || {}).filter(([, w]) => !w.done).sort((a, b) => a[1].due - b[1].due).map(([k]) => wrongRef(k)).filter(Boolean);
const wrongDue = () => { const t = dayNum(); return wrongOpen().filter((r) => P.wrong[r.key].due <= t); };

route(/^redo(?:\/(all))?$/, (all) => {
  const queue = all ? wrongOpen() : wrongDue();
  const total = queue.length, tally = { right: 0, wrong: 0 };
  const stage = h("div", {});
  add(stage, h("div", { style: "margin-top:36px;text-align:center" }, h("a", { href: "#/", class: "btn" }, "Thoát")));

  function finish() {
    document.onkeydown = null;
    const later = wrongOpen().length;
    stage.replaceChildren(h("div", { class: "card", style: "text-align:center" },
      h("h1", {}, total ? "Đã làm lại xong" : "Hôm nay không có câu sai nào đến hạn"),
      total ? h("p", {}, `Đúng ${tally.right} · sai ${tally.wrong} · ${total} câu`) : null,
      h("p", { class: "sub" }, later ? `Trong sổ còn ${later} câu, sẽ được hỏi lại vào những ngày tới.` : "Sổ câu sai đang trống."),
      h("div", { class: "row", style: "justify-content:center" },
        h("button", { class: "btn pri", onclick: () => go("#/") }, "Về trang chủ"),
        !total && later ? h("button", { class: "btn", onclick: () => go("#/redo/all") }, `Làm luôn ${later} câu trong sổ`) : null)));
  }
  function show(r) {
    const { x, it, l } = r;
    let v = x.type === "order" ? [] : null, ok = null;
    const check = () => { ok = isRight(x, it, v); trackWrong(r.key, ok); logEvent({ k: "redo", l: l.id, r: r.key, ok }); save(); ok ? tally.right++ : tally.wrong++; draw(); };
    const pick = (val) => { v = val; check(); };
    const optBtn = (val, label, cls = "") => h("button", { class: "btn " + cls + (ok != null && isRight(x, it, val) ? " ok" : ok === false && v === val ? " bad" : ""), disabled: ok != null, onclick: () => pick(val) }, label);
    const body = {
      fill: () => [h("div", { class: "zh sent" }, blankify(it.q, h("span", { class: "gap" }, ok != null ? it.a : "　　"))),
        h("div", { class: "chips" }, x.bank.map((w) => optBtn(w, w)))],
      choice: () => [h("div", { class: "zh sent" }, it.q), h("div", { class: "chips" }, it.options.map((o, j) => optBtn(j, o)))],
      position: () => [h("div", { class: "zh sent" }, it.q, "　（", h("b", {}, it.word), "）"),
        h("div", { class: "row" }, ["A", "B", "C", "D"].map((o) => optBtn(o, o)))],
      order: () => {
        const used = [...v];
        const left = shuffleOnce.filter((w) => { const at = used.indexOf(w); if (at >= 0) { used.splice(at, 1); return false; } return true; });
        return [h("div", { class: "chips built" }, v.length ? v.map((w, j) => h("button", { class: "btn on", disabled: ok != null, onclick: () => { v = v.filter((_, q) => q !== j); draw(); } }, w))
            : h("span", { class: "sub" }, "Bấm các từ bên dưới theo đúng thứ tự")),
          h("div", { class: "chips" }, left.map((w) => h("button", { class: "btn", disabled: ok != null, onclick: () => { v = [...v, w]; draw(); } }, w))),
          ok == null ? h("button", { class: "btn pri", disabled: !v.length, onclick: check }, "Kiểm tra") : null];
      },
    }[x.type];
    const shuffleOnce = x.type === "order" ? shuffle(it.words) : null;
    const answer = () => x.type === "choice" ? it.options[it.a] : it.a;
    const goNext = () => { queue.shift(); next(); };
    const draw = () => {
      const w = P.wrong[r.key] || {};
      stage.replaceChildren(...[
        h("div", { class: "row sub", style: "justify-content:space-between" },
          h("span", {}, `Làm lại câu sai · bài ${l.id}`), h("span", {}, `Còn ${queue.length} · đúng ${tally.right} · sai ${tally.wrong}`)),
        h("div", { class: "card" }, h("div", { class: "sub", style: "margin-bottom:6px" }, x.title), body(),
          ok == null ? null : h("div", { class: "fb " + (ok ? "ok" : "bad") },
            ok ? (w.done ? "Đúng. Câu này đã ra khỏi sổ." : "Đúng. Vài ngày nữa sẽ hỏi lại một lần.") : ["Chưa đúng. Đáp án: ", h("span", { class: "zh" }, answer()), ". Mai sẽ hỏi lại."],
            it.why ? ` — ${it.why}` : "", it.vi ? ` — ${it.vi}` : "")),
        ok == null ? null : h("button", { class: "btn pri big next", style: "width:100%;margin-top:10px", onclick: goNext }, "Tiếp"),
      ].filter(Boolean));
      if (ok != null) stage.querySelector(".next").scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    document.onkeydown = (e) => { if (ok != null && e.key === "Enter") goNext(); };
    draw();
  }
  function next() { queue.length ? show(queue[0]) : finish(); }
  next();
});

// ---------- Trang chủ: ôn câu và cấu trúc ----------
function reviewExtras() {
  backfillWrong();
  const gd = gramDue().length, gn = gramNew().length, wd = wrongDue().length, wo = wrongOpen().length;
  const cloze = [...dueItems(), ...newItemsToday()].filter((i) => i.ex.some(([zh]) => zh.includes(i.hanzi))).length;
  return [h("h2", {}, "Ôn câu và cấu trúc"),
    h("div", { class: "grid tiles" },
      h("a", { class: "stat" + (gd ? " hot" : ""), href: "#/gram/due" }, h("b", {}, gd + gn), h("span", {}, "cấu trúc cần ôn")),
      h("a", { class: "stat" + (wd ? " hot" : ""), href: wd || !wo ? "#/redo" : "#/redo/all" }, h("b", {}, wd), h("span", {}, wd || !wo ? "câu sai làm lại" : `câu sai · sổ còn ${wo}`)),
      h("a", { class: "stat", href: "#/study/due/cloze" }, h("b", {}, cloze), h("span", {}, "điền từ vào câu")))];
}
