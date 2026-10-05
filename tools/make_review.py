#!/usr/bin/env python3
"""Tạo trang xem lại dữ liệu một bài (review/bai-NN.html) từ data/lessons/NN.json.
Dùng: python3 tools/make_review.py 1"""
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
n = int(sys.argv[1])
d = json.loads((ROOT / "data" / "lessons" / f"{n:02d}.json").read_text())
e = html.escape
out = []
w = out.append

w(f"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Duyệt dữ liệu bài {n}</title><style>
:root{{--bg:#faf8f4;--card:#fff;--ink:#22201c;--mute:#6f6a60;--line:#e4dfd5;--acc:#b3402a;--ok:#2f6f4f}}
@media(prefers-color-scheme:dark){{:root{{--bg:#191816;--card:#232220;--ink:#ece8df;--mute:#a09a8e;--line:#38352f;--acc:#e8826b;--ok:#7fc49e}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Arial,"Helvetica Neue","PingFang SC",sans-serif}}
main{{max-width:900px;margin:0 auto;padding:24px 16px 80px}}h1{{font-size:28px;margin:0}}h2{{margin:40px 0 12px;font-size:20px;border-bottom:2px solid var(--acc);padding-bottom:4px}}
h3{{margin:0 0 4px;font-size:18px}}.sub{{color:var(--mute)}}.zh{{font-family:"Times New Roman","Songti SC","PingFang SC",serif;font-size:19px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0}}
.wrap{{overflow-x:auto}}table{{border-collapse:collapse;width:100%}}th,td{{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}}
th{{color:var(--mute);font-weight:600;font-size:13px}}td.h{{font-family:"Times New Roman","Songti SC",serif;font-size:22px;white-space:nowrap}}
.tag{{display:inline-block;font-size:12px;color:var(--acc);border:1px solid var(--acc);border-radius:99px;padding:0 8px;margin-left:6px}}
.pat{{font-weight:600;color:var(--acc)}}.vi{{color:var(--mute)}}.ans{{color:var(--ok);font-weight:600}}
audio{{width:100%;margin-top:6px}}li{{margin:4px 0}}.warn{{border-color:var(--acc)}}p.t{{text-indent:2em;margin:8px 0}}
</style></head><body><main>
<h1>Bài {n}: <span class="zh">{e(d['title']['zh'])}</span></h1><div class="sub">{e(d['title']['vi'])} · bản để duyệt dữ liệu</div>""")

if d["warnings"]:
    w('<div class="card warn"><b>Cảnh báo cần soát</b><ul>' + "".join(f"<li>{e(x)}</li>" for x in d["warnings"]) + "</ul></div>")

w(f'<h2>Từ mới ({len(d["vocab"])})</h2><audio controls preload="none" src="../{e(d["audio"]["vocab"])}"></audio>')
w('<div class="wrap"><table><tr><th>#</th><th>Chữ Hán</th><th>Pinyin</th><th>Từ loại</th><th>Nghĩa</th></tr>')
for v in d["vocab"]:
    star = '<span class="tag">ngoài đề cương</span>' if v.get("outOfSyllabus") else ""
    w(f'<tr><td>{v["n"]}</td><td class="h">{e(v["hanzi"])}</td><td>{e(v["pinyin"])}</td><td>{e(v["pos"])}</td><td>{e(v["vi"])}{star}</td></tr>')
w("</table></div>")

w(f'<h2>Bài khóa ({sum(len(p) for p in d["text"])} chữ)</h2><audio controls preload="none" src="../{e(d["audio"]["text"])}"></audio><div class="card zh">')
for p in d["text"]:
    w(f'<p class="t">{e(p)}</p>')
w("</div>")

w("<h2>Cấu trúc và cách dùng từ</h2>")
for g in d["grammar"]:
    w(f'<div class="card"><h3><span class="zh">{e(g["title"])}</span><span class="tag">{e(g["kind"])}</span></h3><div class="sub">{e(g["summary"])}</div>')
    for pt in g.get("points", []):
        w(f'<p><span class="pat zh">{e(pt["pattern"])}</span><br>{e(pt["explain"])}</p><ul>')
        for x in pt["examples"]:
            w(f'<li><span class="zh">{e(x["zh"])}</span><br><span class="vi">{e(x["vi"])}</span></li>')
        w("</ul>")
    if "compare" in g:
        a, b = [s.strip() for s in g["title"].split("và")]
        w(f'<p>{e(g["compare"]["same"])}</p><div class="wrap"><table><tr><th></th><th class="zh">{e(a)}</th><th class="zh">{e(b)}</th></tr>')
        for r in g["compare"]["rows"]:
            w(f'<tr><td>{e(r["aspect"])}</td><td>{e(r["a"])}</td><td>{e(r["b"])}</td></tr>')
        w("</table></div>")
    if "collocations" in g:
        w('<div class="wrap"><table>')
        for c in g["collocations"]:
            w(f'<tr><td class="h">{e(c["word"])}</td><td class="zh">{e("　".join(c["with"]))}</td></tr>')
        w("</table></div>")
    w("</div>")

w("<h2>Bài tập (kèm đáp án)</h2>")
for x in d["exercises"]:
    w(f'<div class="card"><h3>{e(x["title"])}</h3>')
    if x["type"] == "fill":
        w(f'<p class="zh">{e("　".join(x["bank"]))}</p>')
    w("<ol>")
    for i in x["items"]:
        if x["type"] == "fill":
            w(f'<li class="zh">{e(i["q"])} <span class="ans">{e(i["a"])}</span></li>')
        elif x["type"] == "choice":
            opts = " / ".join(i["options"])
            w(f'<li><span class="zh">{e(i["q"])}（{e(opts)}）<span class="ans">{e(i["options"][i["a"]])}</span></span><br><span class="vi">{e(i["why"])}</span></li>')
        elif x["type"] == "position":
            w(f'<li class="zh">{e(i["q"])}（{e(i["word"])}）<span class="ans">{e(i["a"])}</span></li>')
        elif x["type"] == "order":
            w(f'<li><span class="zh">{e(" / ".join(i["words"]))}<br><span class="ans">{e(i["a"])}</span></span><br><span class="vi">{e(i["vi"])}</span></li>')
        elif x["type"] == "translate":
            w(f'<li>{e(i["q"])}<br><span class="ans">{e(i["a"])}</span></li>')
        elif x["type"] == "retell":
            w(f'<li>{e(i["prompt"])}: <span class="zh">{e("、".join(i["keywords"]))}</span></li>')
    w("</ol></div>")

w("<h2>Âm thanh sách bài tập</h2>")
for a in d["audio"]["workbook"]:
    w(f'<div class="sub">{e(a)}</div><audio controls preload="none" src="../{e(a)}"></audio>')
w("</main></body></html>")

dest = ROOT / "review" / f"bai-{n:02d}.html"
dest.parent.mkdir(exist_ok=True)
dest.write_text("\n".join(out))
print(dest.relative_to(ROOT))
