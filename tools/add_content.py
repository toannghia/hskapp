#!/usr/bin/env python3
"""Đưa phần cấu trúc và bài tập soạn tay (data/authored/src/*.txt) vào data/authored/NN.json.
Dùng: python3 tools/add_content.py
Mỗi dòng trong tệp nguồn là một mục, các trường cách nhau bằng dấu |:
  #L số bài
  G|tên|tóm tắt            một điểm ngữ pháp        P|mẫu câu|giải thích      E|câu Trung|nghĩa Việt
  C|A và B|tóm tắt|điểm chung   cặp từ cần phân biệt     R|khía cạnh|A|B
  F|các từ cho sẵn         I|câu có ___|đáp án           (điền từ)
  Q|câu có ___|lựa chọn 1/lựa chọn 2|chỉ số đúng|lý do    (chọn đáp án)
  S|câu có A B C D|từ cần đặt|vị trí đúng                (chọn vị trí)
  O|mảnh/mảnh/…|câu đúng|nghĩa Việt                      (sắp xếp câu)
  T|đề bài|các từ gợi ý                                  (kể lại)
Tệp có kiểm tra tính nhất quán; sai thì dừng, không ghi gì."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUNCT = re.compile(r"[。，！？、；：“”\s.,!?]")
lessons, cur = {}, None
for src in sorted((ROOT / "data" / "authored" / "src").glob("*.txt")):
    for ln, line in enumerate(src.read_text().splitlines(), 1):
        if not line.strip():
            continue
        where = f"{src.name}:{ln}"
        if line.startswith("#L"):
            cur = lessons.setdefault(int(line.split()[1]), {"grammar": [], "fill": None, "choice": [], "position": [], "order": [], "retell": []})
            continue
        k, *f = line.split("|")
        g = cur["grammar"]
        if k == "G":
            g.append({"title": f[0], "kind": "cách dùng", "summary": f[1], "points": []})
        elif k == "P":
            g[-1]["points"].append({"pattern": f[0], "explain": f[1], "examples": []})
        elif k == "E":
            g[-1]["points"][-1]["examples"].append({"zh": f[0], "vi": f[1]})
        elif k == "C":
            g.append({"title": f[0], "kind": "phân biệt", "summary": f[1], "compare": {"same": f[2], "rows": []}})
        elif k == "R":
            g[-1]["compare"]["rows"].append({"aspect": f[0], "a": f[1], "b": f[2]})
        elif k == "F":
            cur["fill"] = {"bank": f[0].split(), "items": []}
        elif k == "I":
            assert f[1] in cur["fill"]["bank"] and f[0].count("___") == 1, where
            cur["fill"]["items"].append({"q": f[0], "a": f[1]})
        elif k == "Q":
            opts = f[1].split("/")
            assert len(opts) == 2 and int(f[2]) in (0, 1) and "___" in f[0], where
            cur["choice"].append({"q": f[0], "options": opts, "a": int(f[2]), "why": f[3]})
        elif k == "S":
            assert all(c in f[0] for c in "ABCD") and f[2] in "ABCD", where
            cur["position"].append({"q": f[0], "word": f[1], "a": f[2]})
        elif k == "O":
            words = f[0].split("/")
            assert PUNCT.sub("", "".join(words)) == PUNCT.sub("", f[1]), where
            cur["order"].append({"words": words, "a": f[1], "vi": f[2]})
        elif k == "T":
            cur["retell"].append({"prompt": f[0], "keywords": f[1].split()})
        else:
            raise SystemExit(f"{where}: không hiểu dòng này")

TITLES = {"fill": "Chọn từ điền vào chỗ trống", "choice": "Chọn đáp án đúng", "position": "Chọn vị trí đúng cho từ trong ngoặc",
          "order": "Sắp xếp từ thành câu", "retell": "Kể lại bài khóa theo từ gợi ý"}
for n, c in sorted(lessons.items()):
    assert sorted(c["fill"]["bank"]) == sorted(i["a"] for i in c["fill"]["items"]), f"bài {n}: từ cho sẵn không khớp đáp án"
    vocab = {v["hanzi"] for v in json.loads((ROOT / "data" / "lessons" / f"{n:02d}.json").read_text())["vocab"]}
    stray = [w for w in c["fill"]["bank"] + c["retell"][0]["keywords"] if w not in vocab]
    path = ROOT / "data" / "authored" / f"{n:02d}.json"
    doc = json.loads(path.read_text())
    for i, g in enumerate(c["grammar"]):
        g["id"] = f"{n:02d}-g{i + 1}"
    doc["grammar"] = c["grammar"]
    kept = [x for x in doc.get("exercises", []) if x["type"] == "translate"]     # phiếu dịch soạn riêng, giữ lại
    doc["exercises"] = [{"id": f"{n:02d}-{t}", "type": t, "title": TITLES[t],
                         **({"bank": c["fill"]["bank"], "items": c["fill"]["items"]} if t == "fill" else {"items": c[t]})}
                        for t in ("fill", "choice", "position", "order")] + kept + \
                       [{"id": f"{n:02d}-retell", "type": "retell", "title": TITLES["retell"], "items": c["retell"]}]
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    print(f"Bài {n}: {len(c['grammar'])} cấu trúc, {sum(len(x['items']) for x in doc['exercises'])} câu bài tập"
          + (f" | từ không có trong bảng từ mới của bài: {' '.join(stray)}" if stray else ""))
