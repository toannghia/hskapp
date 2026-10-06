#!/usr/bin/env python3
"""Ghép dữ liệu bài học từ kết quả OCR (data/ocr) và phần biên soạn tay (data/authored).

Dùng: python3 tools/build_lesson.py all      (hoặc một số bài, ví dụ: 1 2 3)
- Bảng từ mới: chữ Hán lấy từ lượt OCR tiếng Trung, từ loại và nghĩa lấy từ lượt OCR tiếng Việt,
  ghép với nhau theo toạ độ dòng. Pinyin lấy từ data/pinyin.json; các chỗ OCR sai được sửa
  trong mục vocabFix của data/authored/NN.json.
- Bài khóa: lấy cột chữ bên trái của các trang bài khóa, tách đoạn theo thụt đầu dòng, rồi tách từ
  để app tra nghĩa khi bấm (từ mới của mọi bài + bảng từ chung data/glossary.json).
Kết quả ghi vào data/lessons/NN.json, kèm danh sách cảnh báo để soát lại.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OCR = ROOT / "data" / "ocr"

POS = r"(đgt\./tt\.|dt\./đgt\.|đgt\./dt\.|tt\./đgt\.|dt\./tt\.|tt\./phó\.|đgt\.|dgt\.|agt\.|dt\.|đt\.|tt\.|phó\.|lượng\.|liên\.|giới\.|trợ\.|thán\.|số\.)"
ONE = {"đgt.": "động từ", "dgt.": "động từ", "agt.": "động từ", "dt.": "danh từ", "đt.": "đại từ",
       "tt.": "tính từ", "phó.": "phó từ", "lượng.": "lượng từ", "liên.": "liên từ", "giới.": "giới từ",
       "trợ.": "trợ từ", "thán.": "thán từ", "số.": "số từ"}
ENTRY = re.compile(r"^\*?\s*\.?\s*(\d{1,2})\s*[\.．,，]\s*([（(]?[一-鿿]+[)）]?[一-鿿]*)")
NUM_ONLY = re.compile(r"^\*?\s*(\d{1,2})\s*[\.．]$")
PURE_HAN = re.compile(r"^[（(]?[一-鿿]+[)）]?[一-鿿]*$")
HAN = re.compile(r"[一-鿿]")
SKIP = re.compile(r"^课文|字）|^\d\d-\d|^生词")


TONES = {"a": "āáǎàa", "e": "ēéěèe", "i": "īíǐìi", "o": "ōóǒòo", "u": "ūúǔùu", "ü": "ǖǘǚǜü"}
_dict = None


def tone_mark(syl):
    """ju1 → jū, lu:4 → lǜ (đặt dấu theo quy tắc: a, e trước; ou thì đặt ở o; còn lại nguyên âm cuối)."""
    m = re.match(r"^([a-zü:]+)([1-5])$", syl.lower())
    if not m:
        return syl.lower()
    s, t = m.group(1).replace("u:", "ü"), int(m.group(2))
    at = next((s.index(v) for v in "ae" if v in s), None)
    if at is None:
        at = s.index("o") if "ou" in s else max((i for i, c in enumerate(s) if c in "iouü"), default=None)
    return s if at is None else s[:at] + TONES[s[at]][t - 1] + s[at + 1:]


def join_pinyin(numbered):
    out = ""
    for syl in numbered.split():
        syl = tone_mark(syl)
        out += ("'" if out and syl[0] in "aāáǎàeēéěèoōóǒò" else "") + syl
    return out


def letters(p):
    """Bỏ dấu thanh và ký tự phụ để so hai cách ghi pinyin với nhau."""
    import unicodedata
    s = unicodedata.normalize("NFD", p.lower().replace("ü", "u").replace("v", "u"))
    return re.sub(r"[^a-z]", "", s)


def cvdict():
    """Từ điển Trung–Việt CVDICT (CC BY-SA 4.0, github.com/ph0ngp/CVDICT), tệp data/dict/CVDICT.u8.
    Trả về {chữ giản thể: {"p": pinyin, "vi": nghĩa}}; không có tệp thì trả về rỗng."""
    global _dict
    if _dict is None:
        _dict = {}
        path = ROOT / "data" / "dict" / "CVDICT.u8"
        for line in path.read_text().splitlines() if path.exists() else []:
            m = re.match(r"^\S+ (\S+) \[([^\]]+)\] /(.+)/$", line)
            if not m or not HAN.search(m.group(1)):
                continue
            word, pin, defs = m.group(1), m.group(2), m.group(3).split("/")
            # Bỏ các ghi chú không phải nghĩa: lượng từ đi kèm, biến thể, chú thích cách đọc vùng miền.
            defs = [d for d in defs if not re.match(r"^(LT:|CL:|biến thể|xem |cũng viết)", d)
                    and not re.search(r"\[[a-z:]+\d\]|Đài Loan|[Pp]hát âm", d)]
            minor = pin[0].isupper() or not defs or re.match(r"^(họ |\(họ\)|tên )", defs[0])
            if word in _dict and (minor or not _dict[word].get("minor")):
                continue           # giữ mục đầu tiên, trừ khi mục đó chỉ là họ / tên riêng
            _dict[word] = {"p": join_pinyin(pin), "vi": "; ".join(defs[:3]), "minor": bool(minor)}
    return _dict


_examples = None


def examples():
    """{(số bài, từ): [[câu Trung, nghĩa Việt], …]}. Câu nào không chứa từ của nó thì báo và bỏ qua."""
    global _examples
    if _examples is None:
        _examples = {}
        for f in sorted((ROOT / "data" / "authored" / "src").glob("examples-*.tsv")):
            for ln, line in enumerate(f.read_text().splitlines(), 1):
                if not line.strip():
                    continue
                lesson, word, zh, vi = line.split("\t")
                # Từ ly hợp có thể bị tách ra trong câu (吵了一架), nên chỉ cần các chữ xuất hiện đúng thứ tự.
                if not re.search(".*".join(map(re.escape, word)), zh):
                    print(f"  ! {f.name}:{ln}: câu ví dụ không chứa từ {word}")
                    continue
                _examples.setdefault((int(lesson), word), []).append([zh, vi])
    return _examples


_hanzi = None


def hanzi_data():
    """Cấu tạo từng chữ Hán từ Make Me a Hanzi (dictionary.txt, nguồn Unihan và CJKlib),
    tệp data/dict/makemeahanzi-dictionary.txt; không có tệp thì trả về rỗng."""
    global _hanzi
    if _hanzi is None:
        _hanzi = {}
        path = ROOT / "data" / "dict" / "makemeahanzi-dictionary.txt"
        for line in path.read_text().splitlines() if path.exists() else []:
            e = json.loads(line)
            _hanzi[e["character"]] = e
    return _hanzi


SHAPE = {"⿰": "trái – phải", "⿱": "trên – dưới", "⿲": "trái – giữa – phải", "⿳": "trên – giữa – dưới", "⿴": "bao quanh",
         "⿵": "bao từ trên", "⿶": "bao từ dưới", "⿷": "bao từ trái", "⿸": "bao trên trái", "⿹": "bao trên phải",
         "⿺": "bao dưới trái", "⿻": "lồng nhau"}
KIND = {"pictophonetic": "hình thanh", "ideographic": "hội ý", "pictographic": "tượng hình"}


def char_table(chars):
    """Thông tin từng chữ đơn cho trang cách viết: cách đọc, nghĩa, bộ thủ, hình thái, kiểu cấu tạo."""
    big, han = cvdict(), hanzi_data()
    names_file = ROOT / "data" / "radicals.json"
    names = json.loads(names_file.read_text()) if names_file.exists() else {}
    out = {}
    for c in sorted(chars):
        if c not in big and c not in han:
            continue
        e, info = han.get(c, {}), {"p": big[c]["p"] if c in big else "", "vi": big[c]["vi"] if c in big else ""}
        rad = e.get("radical")
        if rad:
            info["rad"] = [rad] + names.get(rad, [])
        ids = e.get("decomposition", "")
        if ids and ids[0] in SHAPE and "？" not in ids:
            # Chỉ lấy các thành phần ở tầng ngoài cùng; thành phần ghép thì tìm chữ tương ứng, không có thì ghi các mảnh.
            whole = {v.get("decomposition"): k for k, v in han.items()} if not hasattr(char_table, "whole") else char_table.whole
            char_table.whole = whole
            kids, i = [], 1
            for _ in range(3 if ids[0] in "⿲⿳" else 2):
                j = i
                need = 1
                while need and j < len(ids):
                    need += (3 if ids[j] in "⿲⿳" else 2) - 1 if ids[j] in SHAPE else -1
                    j += 1
                sub = ids[i:j]
                kids.append(sub if len(sub) == 1 else whole.get(sub) or "(" + "".join(x for x in sub if x not in SHAPE) + ")")
                i = j
            if len(kids) >= 2 and all(kids):
                info["shape"] = [SHAPE[ids[0]], kids]
        ety = e.get("etymology") or {}
        if ety.get("type") in KIND:
            info["kind"] = [KIND[ety["type"]], ety.get("semantic", ""), ety.get("phonetic", "")]
        out[c] = info
    return out


def pos_name(p):
    return " / ".join(ONE.get(x + ".", x) for x in p.rstrip(".").split("./")) if p else ""


def page(book, lang, n):
    return json.loads((OCR / book / lang / f"p{n:03d}.json").read_text())["lines"]


def rows(lines, tol=0.009):
    """Gom các mảnh chữ thành hàng theo toạ độ y, trong hàng xếp từ trái sang phải."""
    out = []
    for l in sorted(lines, key=lambda l: l["y"]):
        if out and abs(out[-1][0]["y"] - l["y"]) < tol:
            out[-1].append(l)
        else:
            out.append([l])
    return [sorted(r, key=lambda l: l["x"]) for r in out]


def build_vocab(book, pages):
    """Trả về (từ mới, tên riêng). Các mục nằm dưới tiêu đề 专有名词 là tên riêng, đánh số riêng."""
    vocab, names = [], []
    for p in pages:
        zh, vi = page(book, "zh", p), page(book, "vi", p)
        names_y = min((l["y"] for l in zh if "专有名词" in l["t"]), default=9)
        heads = []
        for l in zh:
            m = ENTRY.match(l["t"])
            if m and l["x"] > 0.5:
                heads.append((l, int(m.group(1)), re.sub(r"[（()）]", "", m.group(2)), l["t"].lstrip().startswith("*")))
                continue
            # OCR đôi khi tách số thứ tự và chữ Hán thành hai mảnh nằm cạnh nhau.
            m = NUM_ONLY.match(l["t"].strip())
            if m and l["x"] > 0.5:
                side = [o for o in zh if abs(o["y"] - l["y"]) < 0.012 and l["x"] < o["x"] < l["x"] + 0.1
                        and PURE_HAN.match(o["t"].replace(" ", ""))]
                if side:
                    heads.append((l, int(m.group(1)), re.sub(r"[（()）\s]", "", side[0]["t"]), l["t"].lstrip().startswith("*")))
        heads.sort(key=lambda h: h[0]["y"])
        for i, (l, num, hanzi, star) in enumerate(heads):
            top = l["y"] - 0.012
            bottom = heads[i + 1][0]["y"] - 0.012 if i + 1 < len(heads) else l["y"] + 0.05
            if l["y"] < names_y:
                bottom = min(bottom, names_y - 0.005)
            band = [v for v in vi if top <= v["y"] < bottom and l["x"] + 0.07 < v["x"] < 0.93]
            text = " ".join(" ".join(x["t"] for x in r) for r in rows(band))
            m = re.search(POS, text)
            if m:
                pinyin, pos, gloss = text[:m.start()], m.group(1), text[m.end():]
            else:
                first = rows(band)[0] if band else []
                pinyin = " ".join(x["t"] for x in first)
                pos, gloss = "", text[len(pinyin):]
            entry = {"n": num, "hanzi": hanzi, "pinyin": pinyin.strip(), "pos": pos_name(pos),
                     "vi": gloss.strip(" ;,"), "outOfSyllabus": star, "page": p}
            (names if l["y"] > names_y else vocab).append(entry)
    vocab.sort(key=lambda v: v["n"])
    return vocab, names


def build_text(book, spec, warnings):
    """spec: danh sách {page, top, bottom, xmin, xmax}; trả về các đoạn văn của bài khóa."""
    paras = []
    for s in spec:
        lines = [l for l in page(book, "zh", s["page"])
                 if s.get("top", 0) <= l["y"] < s.get("bottom", 1)
                 and s.get("xmin", 0.1) < l["x"] < s.get("xmax", 0.55)
                 and HAN.search(l["t"]) and l["h"] < 0.04 and not SKIP.search(l["t"].replace(" ", ""))]
        if not lines:
            warnings.append(f"Bài khóa: trang {s['page']} không có dòng nào")
            continue
        left = min(l["x"] for l in lines)
        for r in rows(lines, tol=0.012):
            t = "".join(x["t"] for x in r).replace(" ", "")
            if r[0]["x"] > left + 0.03 or not paras:
                paras.append(t)
            else:
                paras[-1] += t
    return paras


def tokenize(paras, own, known, warnings):
    """Tách từ theo kiểu khớp dài nhất. Mỗi mảnh là [chữ, số thứ tự từ mới của bài này hoặc None]."""
    big = cvdict()
    longest = max(len(w) for w in known)
    out, unknown = [], []
    for para in paras:
        toks, i = [], 0
        while i < len(para):
            # Ưu tiên từ của giáo trình và bảng từ soạn tay; không có mới tra từ điển lớn (tối đa 4 chữ).
            w = next((para[i:i + k] for k in range(longest, 0, -1) if para[i:i + k] in known), None)
            wide = next((para[i:i + k] for k in range(4, 0, -1) if para[i:i + k] in big), None)
            if wide and (w is None or len(wide) > len(w)) and HAN.match(para[i]):
                known[wide] = {"p": big[wide]["p"], "vi": big[wide]["vi"]}
                w = wide
            if w is None:
                w = para[i]
                if HAN.match(w):
                    unknown.append(w)
                toks.append([w, None])
            else:
                toks.append([w, own.get(w, known[w].get("ref"))])
            i += len(w)
        out.append(toks)
    if unknown:
        warnings.append(f"Bài khóa còn {len(unknown)} chữ chưa có nghĩa khi bấm tra")
    return out


def load(n):
    authored = json.loads((ROOT / "data" / "authored" / f"{n:02d}.json").read_text())
    src, warnings = authored["source"], []
    vocab, names = build_vocab(src["book"], src["vocabPages"])
    pinyin = json.loads((ROOT / "data" / "pinyin.json").read_text()) if (ROOT / "data" / "pinyin.json").exists() else {}
    big = cvdict()
    # Sửa tay theo "số bài.số từ" (chữ OCR nhận sai, nghĩa thiếu…), dùng chung cho mọi bài.
    fixes_file = ROOT / "data" / "vocab-fix.json"
    fixes = json.loads(fixes_file.read_text()) if fixes_file.exists() else {}
    # Số thứ tự bị lặp nghĩa là trang đó còn một danh sách phụ (thuật ngữ, tên riêng): chuyển sang nhóm tên riêng.
    seen = set()
    for v in list(vocab):
        if v["n"] in seen:
            vocab.remove(v)
            names.append(v)
        seen.add(v["n"])
    for v in vocab:
        v.update(fixes.get(f"{n}.{v['n']}", {}))
    # Mục OCR đọc hỏng hoàn toàn được bổ sung tay trong vocab-fix.json.
    for key, fix in fixes.items():
        lesson_no, num = key.split(".")
        if int(lesson_no) == n and int(num) not in seen:
            vocab.append({"n": int(num), "pos": "", "outOfSyllabus": False, **fix})
    vocab.sort(key=lambda v: v["n"])
    for v in vocab + names:
        entry = big.get(v["hanzi"])
        if v in vocab and "pinyin" in fixes.get(f"{n}.{v['n']}", {}):
            continue
        if v["hanzi"] in pinyin:
            v["pinyin"] = pinyin[v["hanzi"]]
        elif entry:
            # Pinyin trong sách (qua OCR) hay mất dấu thanh; lấy của từ điển, và báo nếu phần chữ cái không khớp.
            if letters(entry["p"]) != letters(v["pinyin"]) and n > 1:
                warnings.append(f"Từ {v['n']} {v['hanzi']}: pinyin từ điển '{entry['p']}' khác bản OCR '{v['pinyin']}'")
            v["pinyin"] = entry["p"]
        elif n > 1:
            warnings.append(f"Từ {v['n']} {v['hanzi']}: không có trong từ điển, pinyin lấy từ OCR '{v['pinyin']}'")
        if not v["vi"] and entry:
            v["vi"] = entry["vi"]
            warnings.append(f"Từ {v['n']} {v['hanzi']}: nghĩa lấy từ từ điển")
    # Ảnh minh hoạ có giấy phép mở (tools/fetch_images.py): đường dẫn ảnh và thông tin ghi nguồn.
    credits_file = ROOT / "data" / "images" / f"{n:02d}" / "credits.json"
    credits = json.loads(credits_file.read_text()) if credits_file.exists() else {}
    for v in vocab:
        c = credits.get(str(v["n"]))
        if c and (credits_file.parent / c["file"]).exists():
            v["img"] = f"data/images/{n:02d}/{c['file']}"
            v["imgCredit"] = {"author": c["author"], "license": c["license"], "url": c["url"]}
    # Câu ví dụ cách dùng (tự soạn) trong data/authored/src/examples-*.tsv: số bài, từ, câu Trung, nghĩa Việt.
    for v in vocab:
        ex = examples().get((n, v["hanzi"]))
        if ex:
            v["ex"] = ex
    # Hình gợi ý (biểu tượng) cho các từ có thể hình dung được, dùng ở kiểu ôn "Nhìn hình đoán từ".
    emoji_file = ROOT / "data" / "emoji.json"
    emoji = json.loads(emoji_file.read_text()) if emoji_file.exists() else {}
    for v in vocab:
        if v["hanzi"] in emoji:
            v["emoji"] = emoji[v["hanzi"]]
    for num, fix in authored.get("vocabFix", {}).items():
        hit = [v for v in vocab if v["n"] == int(num)]
        if hit:
            hit[0].update(fix)
        else:
            vocab.append({"n": int(num), "outOfSyllabus": False, **fix})
    vocab.sort(key=lambda v: v["n"])
    nums = [v["n"] for v in vocab]
    if nums != list(range(1, len(nums) + 1)):
        warnings.append(f"Bảng từ mới không liên tục: có {len(nums)} mục, số lớn nhất {max(nums, default=0)}")
    audio = {k: [v] if isinstance(v, str) else v for k, v in authored["audio"].items()}
    times_file = ROOT / "data" / "audio-times" / f"{n:02d}.json"
    times = json.loads(times_file.read_text()) if times_file.exists() else {}
    for v in vocab:
        if str(v["n"]) in times:
            v["clip"] = times[str(v["n"])]      # tệp đọc riêng của từ này, do tools/word_clips.py cắt ra
        missing = [k for k in ("pinyin", "pos", "vi") if not v.get(k)]
        if missing and not (missing == ["pos"] and len(v["hanzi"]) >= 4):
            warnings.append(f"Từ {v['n']} {v['hanzi']}: thiếu {', '.join(missing)}")
    if not times:
        warnings.append("Chưa có tệp đọc riêng cho từng từ (tools/word_clips.py không dò được)")
    return {"n": n, "authored": authored, "audio": audio, "vocab": vocab, "names": names, "warnings": warnings}


def main():
    all_ids = sorted(int(f.stem) for f in (ROOT / "data" / "authored").glob("[0-9][0-9].json"))
    want = all_ids if sys.argv[1:] == ["all"] else [int(a) for a in sys.argv[1:]]
    loaded = {n: load(n) for n in all_ids}
    # Bảng tra chung: bảng từ soạn tay + từ mới và tên riêng của mọi bài.
    known = {w: {"p": e["p"], "vi": e["vi"], "ref": e.get("ref")}
             for w, e in json.loads((ROOT / "data" / "glossary.json").read_text()).items()}
    for d in loaded.values():
        for v in d["vocab"] + d["names"]:
            known.setdefault(v["hanzi"], {"p": v["pinyin"], "vi": v["vi"]})
    out_dir = ROOT / "data" / "lessons"
    out_dir.mkdir(parents=True, exist_ok=True)
    for n in want:
        d = loaded[n]
        authored, warnings = d["authored"], d["warnings"]
        text = build_text(authored["source"]["book"], authored["source"]["text"], warnings)
        for old, new in authored.get("textFix", []):
            hits = sum(p.count(old) for p in text)
            if hits != 1:
                warnings.append(f"Sửa bài khóa '{old}': khớp {hits} lần")
            text = [p.replace(old, new) for p in text]
        own = {v["hanzi"]: v["n"] for v in d["vocab"]}
        scope = {**known, **{v["hanzi"]: {"p": v["pinyin"], "vi": v["vi"]} for v in d["vocab"]}}
        tokens = tokenize(text, own, scope, warnings)
        used = {t[0] for para in tokens for t in para}
        lesson = {"id": n, "title": authored["title"], "audio": d["audio"],
                  "vocab": d["vocab"], "names": d["names"], "text": text, "textTokens": tokens,
                  "gloss": {w: [e["p"], e["vi"]] for w, e in scope.items() if w in used and w not in own},
                  # Từng chữ đơn trong bảng từ: cách đọc và nghĩa của riêng chữ đó, dùng ở trang cách viết.
                  "chars": char_table({c for v in d["vocab"] for c in v["hanzi"]}),
                  "grammar": authored.get("grammar", []), "exercises": authored.get("exercises", []),
                  "warnings": warnings}
        (out_dir / f"{n:02d}.json").write_text(json.dumps(lesson, ensure_ascii=False, indent=1))
        chars = sum(len(p) for p in text)
        cover = sum(len(t[0]) for para in tokens for t in para if t[0] in scope) / max(1, sum(1 for p in text for c in p if HAN.match(c)))
        print(f"Bài {n:2d}: {len(d['vocab']):2d} từ, {len(d['names'])} tên riêng, {len(text):2d} đoạn, {chars:4d} chữ, "
              f"tra được {cover:.0%}, {len(lesson['grammar'])} cấu trúc, {len(lesson['exercises'])} bài tập, {len(warnings)} cảnh báo")


if __name__ == "__main__":
    main()
