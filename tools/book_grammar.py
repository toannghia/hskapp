#!/usr/bin/env python3
"""Trích phần 注释 của giáo trình từ bản quét: 词语例释 (giải thích, ví dụ, 练一练), 词语搭配, 词语辨析.

Kết quả ghi vào data/book/NN.json. Thư mục này là nội dung của sách nên không đưa lên kho mã nguồn;
tools/build_lesson.py đọc nó để ghép vào dữ liệu bài học.

    python3 tools/book_grammar.py            # tất cả các bài
    python3 tools/book_grammar.py 19 20      # một vài bài
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OCR = ROOT / "data" / "ocr"
OUT = ROOT / "data" / "book"

NUM = re.compile(r"^[（(]\s*(\d{1,2})\s*[）)]\s*")
PUNCT = "。，：；？！、“”"
END = "。？！）)”…"
NOISE = re.compile(r"nhantriviet|^Hoc T|^Học T|rung toi|trung toi|^Chu thich|^Chú thích|标准教程|^HSK")
HEADS = {"动词", "宾语", "定语", "中心语", "补语", "主语", "谓语", "状语", "数量词", "名词", "形容词", "副词", "量词", "介词"}
GAP = "____"


def rows(lines, tol=0.009):
    out = []
    for l in sorted(lines, key=lambda l: l["y"]):
        if out and abs(out[-1][0]["y"] - l["y"]) < tol:
            out[-1].append(l)
        else:
            out.append([l])
    return [sorted(r, key=lambda l: l["x"]) for r in out]


def clean(page_lines):
    keep = []
    for l in page_lines:
        t = l["t"].strip()
        if not t or NOISE.search(t) or l["h"] > 0.1:
            continue
        if (l["y"] > 0.93 or l["y"] < 0.06) and len(t) <= 14:      # số trang, đầu trang, chân trang
            continue
        han = re.search(r"[一-鿿]", t)
        if not han and (l["x"] < 0.13 or l["x"] > 0.92 or len(t) <= 2 and not re.search(r"[A-Za-z0-9]", t)):   # chữ in dọc mép trang, vệt gạch chỗ trống
            continue
        keep.append({**l, "t": t})
    return keep


def section(book, start):
    """Các hàng chữ từ dấu 词语例释 tới trước 练习, gắn thêm số trang."""
    out, on = [], False
    for p in range(start, start + 7):
        f = OCR / book / "zh" / f"p{p:03d}.json"
        if not f.exists():
            break
        for r in rows(clean(json.loads(f.read_text())["lines"])):
            t = r[0]["t"]
            if not on:
                on = any("词语例释" in l["t"] or l["t"].startswith("注释") for l in r)
                continue
            if re.match(r"^练\s*习\s*\d?$", t) or (t.startswith("练习") and len(t) <= 5):
                return out
            out.append([{**l, "p": p} for l in r])
    return out


def is_head(r):
    """Hàng tên mục: một mảnh chữ ngắn, không có dấu câu, có thể kèm số thứ tự đứng trước."""
    cells = [l for l in r if not (re.fullmatch(r"\d{1,2}", l["t"]) or l["x"] < 0.17 and len(l["t"]) <= 2)]      # bỏ số thứ tự đứng trước
    if len(cells) == 2 and len(cells[0]["t"]) == 1 and cells[0]["x"] < 0.2 <= cells[1]["x"]:     # số thứ tự bị đọc thành chữ
        cells = cells[1:]
    if len(cells) != 1:
        return None
    l = cells[0]
    t = re.sub(r"^[\d•·\s]+", "", l["t"])
    if not (0.17 <= l["x"] <= 0.265) or not (1 <= len(t) <= 12) or NUM.match(t):
        return None
    if any(c in PUNCT for c in t) or not re.search(r"[一-鿿]", t):
        return None
    return t


def join(r):
    """Ghép các mảnh trong một hàng; chỗ cách xa nhau là chỗ trống để điền."""
    out = r[0]["t"]
    for a, b in zip(r, r[1:]):
        out += (GAP if b["x"] - (a["x"] + a["w"]) > 0.05 else "") + b["t"]
    return out


def parse_points(rs):
    points, cur, drill, ex_x = [], None, None, None
    for r in rs:
        h = is_head(r)
        if h and (cur is None or cur["parts"] or drill is not None):
            cur = {"word": h, "parts": [], "drill": None}
            points.append(cur)
            drill, ex_x = None, None
            continue
        if cur is None:
            continue
        text = join(r)
        if "练一练" in text or "做一做" in text:
            drill = {"title": re.split(r"[：:]", text, maxsplit=1)[-1].strip() if re.search(r"[：:]", text) else "", "items": []}
            cur["drill"] = drill
            ex_x = None
            continue
        m = NUM.match(text)
        if drill is not None:
            body = NUM.sub("", text)
            if m:
                drill["items"].append([body])
                ex_x = r[0]["x"]
            elif drill["items"]:
                drill["items"][-1].append(body)
            continue
        if m:
            if not cur["parts"]:
                cur["parts"].append({"explain": "", "examples": []})
            cur["parts"][-1]["examples"].append(NUM.sub("", text))
            ex_x = r[0]["x"]
        elif ex_x is not None and r[0]["x"] > ex_x + 0.02 and cur["parts"] and cur["parts"][-1]["examples"]:
            cur["parts"][-1]["examples"][-1] += text
        else:
            if not cur["parts"] or cur["parts"][-1]["examples"]:
                cur["parts"].append({"explain": "", "examples": []})
                ex_x = None
            cur["parts"][-1]["explain"] += text
    for p in points:
        if p["drill"]:
            p["drill"]["items"] = [drill_item(i) for i in p["drill"]["items"]]
    return [p for p in points if p["parts"]]


def drill_item(lines):
    """Một câu luyện: dòng nào chưa kết thúc bằng dấu câu thì phần còn lại là chỗ trống để viết."""
    out = []
    for t in lines:
        t = t.strip()
        if t and t[-1] not in END and not t.endswith(GAP):
            t += GAP
        out.append(t)
    return "\n".join(out)


def groups(lines, gap=0.0235):
    out = []
    for l in sorted(lines, key=lambda l: (l["p"], l["y"])):
        if out and out[-1][-1]["p"] == l["p"] and l["y"] - out[-1][-1]["y"] < gap:
            out[-1].append(l)
        else:
            out.append([l])
    return [{"t": "".join(x["t"] for x in g), "y": sum(x["y"] for x in g) / len(g), "p": g[0]["p"]} for g in out]


def parse_collocations(rs, warn):
    tables, cur = [], None
    for r in rs:
        cells = [l for l in r if l["t"] != "+"]
        if cells and all(l["t"] in HEADS for l in cells) and len(cells) == 2:
            cur = {"head": [c["t"] for c in cells], "lines": []}
            tables.append(cur)
        elif cur:
            cur["lines"] += cells
    out = []
    for t in tables:
        left, right = groups([l for l in t["lines"] if l["x"] < 0.55]), groups([l for l in t["lines"] if l["x"] >= 0.55])
        if len(left) != len(right):
            warn.append(f"bảng kết hợp từ {'+'.join(t['head'])}: {len(left)} ô trái, {len(right)} ô phải")
        pairs = []
        for a in left:           # ô phải gần nhất theo chiều dọc
            b = min((x for x in right if x["p"] == a["p"]), key=lambda x: abs(x["y"] - a["y"]), default=None)
            if b:
                pairs.append([a["t"], b["t"]])
        out.append({"head": t["head"], "rows": pairs})
    return out


def parse_compare(rs):
    """Chỉ lấy tên cặp từ và phần 做一做; bảng so sánh hai cột bản quét hay dính dòng nên không trích."""
    out, cur, drill = [], None, None
    for r in rs:
        text = join(r)
        m = re.match(r"([一-鿿]{1,4}?)\s*[一—–\-－~]+\s*([一-鿿]{1,4})\s*(?:[（(].*)?$", text) if len(r) == 1 and r[0]["x"] < 0.3 else None
        if m:
            cur = {"words": [m.group(1), m.group(2)], "drill": None}
            out.append(cur)
            drill = None
        elif cur and ("做一做" in text or "练一练" in text):
            drill = {"title": re.split(r"[：:]", text, maxsplit=1)[-1].strip() if re.search(r"[：:]", text) else "", "items": []}
            cur["drill"] = drill
        elif drill is not None:
            cells = [l for l in r if l["t"] not in ("✓", "×", "✗", "√", "X", "x") and l["t"] not in cur["words"]]
            if not cells:
                continue
            body = join(cells)
            if NUM.match(body):
                drill["items"].append([NUM.sub("", body)])
            elif drill["items"] and cells[0]["x"] < 0.6:
                drill["items"][-1].append(body)
    for c in out:
        if c["drill"]:
            c["drill"]["items"] = ["".join(i) for i in c["drill"]["items"]]
    return out


def lesson(n):
    src = json.loads((ROOT / "data" / "authored" / f"{n:02d}.json").read_text())["source"]
    rs = section(src["book"], src["text"][-1]["page"])
    warn = []
    if not rs:
        return None, ["không tìm thấy phần 注释"]
    cut = lambda key: next((i for i, r in enumerate(rs) if any(key in l["t"] for l in r)), None)
    cut = lambda key: next((i for i, r in enumerate(rs) if any(re.search(key, l["t"]) for l in r)), None)
    a, b = cut("词语搭配"), cut("词语[辨辦辩]析")
    end_pts = a if a is not None else b if b is not None else len(rs)
    data = {
        "points": parse_points(rs[:end_pts]),
        "collocations": parse_collocations(rs[a + 1:b if b is not None and b > a else len(rs)], warn) if a is not None else [],
        "compare": parse_compare(rs[b + 1:]) if b is not None else [],
    }
    if a is None:
        warn.append("không thấy mục 词语搭配")
    if b is None:
        warn.append("không thấy mục 词语辨析")
    for p in data["points"]:
        if not any(x["examples"] for x in p["parts"]):
            warn.append(f"{p['word']}: không có ví dụ")
        if not p["drill"]:
            warn.append(f"{p['word']}: không có 练一练")
    return data, warn


def main():
    ids = [int(x) for x in sys.argv[1:]] or range(1, 37)
    OUT.mkdir(parents=True, exist_ok=True)
    for n in ids:
        data, warn = lesson(n)
        if data:
            (OUT / f"{n:02d}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
            ex = sum(len(x["examples"]) for p in data["points"] for x in p["parts"])
            dr = sum(len(p["drill"]["items"]) for p in data["points"] if p["drill"])
            print(f"Bài {n:2d}: {len(data['points'])} mục ({' '.join(p['word'] for p in data['points'])}), {ex} ví dụ, {dr} câu 练一练, "
                  f"{sum(len(t['rows']) for t in data['collocations'])} dòng kết hợp từ, {len(data['compare'])} cặp phân biệt")
        for w in warn:
            print(f"   ! {w}")


if __name__ == "__main__":
    main()
