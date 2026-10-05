#!/usr/bin/env python3
"""Tự dò phạm vi từng bài trong giáo trình (từ kết quả OCR) và tạo tệp khai báo data/authored/NN.json
cho những bài chưa có. Dùng: python3 tools/auto_lessons.py giao-trinh-1 1
(tham số thứ hai là số của bài đầu tiên trong cuốn). Tệp đã có sẵn thì không bị ghi đè."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
book, first = sys.argv[1], int(sys.argv[2])
HAN = re.compile(r"[一-鿿]")
pages = sorted((ROOT / "data" / "ocr" / book / "zh").glob("p*.json"))


def lines(lang, n):
    return json.loads((ROOT / "data" / "ocr" / book / lang / f"p{n:03d}.json").read_text())["lines"]


def head(ls, word, xmax=0.3):
    hit = [l for l in ls if l["t"].replace(" ", "").startswith(word) and l["x"] < xmax]
    return min(hit, key=lambda l: l["y"])["y"] if hit else None


info = {}
for f in pages:
    n = int(f.stem[1:])
    ls = lines("zh", n)
    info[n] = {"text": head(ls, "课文"), "notes": head(ls, "注释"),
               "credit": next((l["y"] for l in ls if "改编自" in l["t"] or l["t"].startswith("选自")), None),
               "audio": any(re.search(r"\d\d-1", l["t"]) and len(l["t"]) < 16 for l in ls)}
starts = [n for n, i in info.items() if i["text"] is not None and i["audio"]]

for k, s in enumerate(starts):
    num = first + k
    out = ROOT / "data" / "authored" / f"{num:02d}.json"
    if out.exists():
        continue
    end = next(n for n in range(s + 1, s + 6) if info[n]["notes"] is not None)   # trang có mục chú thích
    zh = lines("zh", s)
    title = max((l for l in zh if l["y"] < 0.13 and HAN.search(l["t"]) and "标准教程" not in l["t"]), key=lambda l: l["h"])
    under = [l for l in lines("vi", s) if title["y"] + 0.02 < l["y"] < title["y"] + 0.07 and l["h"] > 0.012 and l["x"] > 0.2]
    regions = [{"page": s, "top": round(info[s]["text"] + 0.02, 3), "bottom": 0.94, "xmin": 0.15}]
    for n in range(s + 1, end + 1):
        stops = [y for y in (info[n]["credit"], info[n]["notes"]) if y is not None]
        if n == end and min(stops) < 0.12:
            break
        regions.append({"page": n, "top": 0.07, "bottom": round(min(stops) - 0.005, 3) if stops else 0.95, "xmin": 0.13})
    vol = 1 if "1" in book else 2
    audio_dir = ROOT / "audio" / f"giao-trinh-{vol}"
    parts = sorted(p.name for p in audio_dir.glob(f"{num:02d}-*.mp3"))
    doc = {"title": {"zh": title["t"].strip("。 "), "vi": " ".join(l["t"] for l in sorted(under, key=lambda l: (l["y"], l["x"])))},
           "audio": {"text": [f"audio/giao-trinh-{vol}/{p}" for p in parts[0::2]],
                     "vocab": [f"audio/giao-trinh-{vol}/{p}" for p in parts[1::2]],
                     "workbook": [f"audio/bai-tap-{vol}/{p.name}" for p in sorted((ROOT / "audio" / f"bai-tap-{vol}").glob(f"{num:02d}-*.mp3"))]},
           "source": {"book": book, "vocabPages": list(range(s, end + 1)), "text": regions}}
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    print(f"Bài {num}: trang {s}–{end}, {doc['title']['zh']} | {doc['title']['vi']} | âm thanh {len(parts)} tệp")
