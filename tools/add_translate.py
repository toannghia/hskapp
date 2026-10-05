#!/usr/bin/env python3
"""Đưa câu dịch của phiếu bài tập lớp (翻译句子：HSK5第一课到第九课.docx, nằm ở thư mục cha) vào bài 2–9.
Đề lấy từ phiếu theo số câu; đáp án mẫu soạn tay trong data/authored/src/translate-answers.tsv.
Câu 91–100 (tổng hợp) được đặt thành một bài tập riêng ở bài 9. Dùng: python3 tools/add_translate.py"""
import html
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT.parent / "翻译句子：HSK5第一课到第九课.docx"
xml = zipfile.ZipFile(SHEET).read("word/document.xml").decode("utf8")
questions = {}
for para in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
    text = html.unescape("".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", para, flags=re.S))).strip()
    m = re.match(r"^(\d{1,3})\.\s*(.+)$", text)
    if m:
        questions[int(m.group(1))] = m.group(2)
answers = dict(line.split("\t", 1) for line in (ROOT / "data/authored/src/translate-answers.tsv").read_text().splitlines() if line.strip())
han = re.compile(r"[一-鿿]")


def items(lo, hi):
    out = []
    for k in range(lo, hi + 1):
        q, a = questions[k], answers[str(k)]
        # Đề nhiều chữ Hán thì dịch sang tiếng Việt, còn lại dịch sang tiếng Trung.
        to_vi = len(han.findall(q)) > len(q) / 3
        assert bool(han.search(a)) != to_vi or "朝三暮四" in a, f"câu {k}: chiều dịch và đáp án không khớp"
        out.append({"dir": "zh-vi" if to_vi else "vi-zh", "q": q, "a": a})
    return out


for n in range(2, 10):
    path = ROOT / "data" / "authored" / f"{n:02d}.json"
    doc = json.loads(path.read_text())
    ex = [x for x in doc.get("exercises", []) if x["type"] != "translate"]
    new = [{"id": f"{n:02d}-translate", "type": "translate", "title": "Dịch câu (phiếu bài tập của lớp)", "items": items(n * 10 - 9, n * 10)}]
    if n == 9:
        new.append({"id": "09-review", "type": "translate", "title": "Dịch câu tổng hợp bài 1–9 (phiếu bài tập của lớp)", "items": items(91, 100)})
    at = next((i for i, x in enumerate(ex) if x["type"] == "retell"), len(ex))
    doc["exercises"] = ex[:at] + new + ex[at:]
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    print(f"Bài {n}: {sum(len(x['items']) for x in new)} câu dịch")
