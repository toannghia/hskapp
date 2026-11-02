#!/usr/bin/env python3
"""Extract official textbook (练习, 注释, 扩展, 运用) and workbook (练习册) exercises
for all 36 lessons of HSK 5 Standard Course."""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
OCR_DIR = ROOT / "data" / "ocr"
BOOK_DIR = ROOT / "data" / "book"
SOURCES_DIR = ROOT / "sources"

POS_LESSONS = {1, 2, 4, 6, 7, 8, 9, 10, 12, 13, 17, 18, 20, 24, 26, 27, 29}
MATCH_LESSONS = set(range(1, 37)) - POS_LESSONS

WB_STARTS = [7, 14, 21, 29, 36, 43, 51, 58, 65, 73, 80, 87, 95, 102, 109, 117, 124, 131]

CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def cn2int(s):
    s = s.strip()
    if s.isdigit():
        return int(s)
    if s == "十":
        return 10
    if s.startswith("十"):
        return 10 + CN_NUM[s[1]]
    if s.endswith("十"):
        return CN_NUM[s[0]] * 10
    if "十" in s:
        return CN_NUM[s[0]] * 10 + CN_NUM[s[2]]
    return CN_NUM[s]


def _load_gt_blocks():
    txt = (BOOK_DIR / "_dap_an_gt.txt").read_text()
    txt = re.sub(r"--- Page \d+ ---\n?", "", txt)
    txt = re.sub(r"Gi(?:aù|á)o trình[^\n]*\n?", "", txt)
    txt = re.sub(r"《HSK[^\n]*\n?", "", txt)
    txt = re.sub(r"================[^\n]*\n?", "", txt)
    blocks = {}
    matches = list(re.finditer(r"(?:^|\n)第\s*([一二三四五六七八九十\d]+)\s*课\s+[^\n]+\n", txt))
    for i, m in enumerate(matches):
        lid = cn2int(m.group(1))
        end = matches[i + 1].start() if i + 1 < len(matches) else len(txt)
        blocks[lid] = txt[m.end():end]
    return blocks


def _load_wb_blocks():
    txt = (BOOK_DIR / "_dap_an_bt.txt").read_text()
    txt = re.sub(r"--- Page \d+ ---\n?", "", txt)
    txt = re.sub(r"Giaùo trình chuaån HSK5[^\n]*\n?", "", txt)
    txt = re.sub(r"================[^\n]*\n?", "", txt)
    blocks = {}
    matches = list(re.finditer(r"(?:^|\n)第\s*(\d{1,2})\s*课\s+[^\n]+\n", txt))
    for i, m in enumerate(matches):
        lid = int(m.group(1))
        end = matches[i + 1].start() if i + 1 < len(matches) else len(txt)
        b = txt[m.end():end]
        if lid == 36:
            m_sim = re.search(r"HSK\s*[（(]五级[)）]\s*仿真试题", b)
            if m_sim:
                b = b[:m_sim.start()]
        blocks[lid] = b
    return blocks


GT_BLOCKS = _load_gt_blocks()
WB_BLOCKS = _load_wb_blocks()
MATCH_WORDS = json.loads((BOOK_DIR / "_match_words.json").read_text())

# Exact collocation pairs extracted from PDF vector lines in dap-an-giao-trinh-{1,2}.pdf
def _extract_match_vectors():
    vec_pairs = {}
    all_m_lessons = sorted(MATCH_LESSONS)
    all_streams = []
    for vol, pdf_name in [(1, "dap-an-giao-trinh-1.pdf"), (2, "dap-an-giao-trinh-2.pdf")]:
        raw = (SOURCES_DIR / pdf_name).read_bytes()
        import zlib
        for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", raw, re.S):
            try:
                dec = zlib.decompress(m.group(1)).decode("latin1", errors="ignore")
                lines = re.findall(
                    r"([\d.]+)\s+([\d.]+)\s+m\s+([\d.]+)\s+([\d.]+)\s+l", dec
                )
                if len(lines) == 8:
                    all_streams.append([(float(a), float(b), float(c), float(d)) for a, b, c, d in lines])
            except Exception:
                pass
    for idx_m, lid in enumerate(all_m_lessons):
        wdata = [w for w in MATCH_WORDS[idx_m] if w["x"] > 110 and len(w["t"].split()) == 2]
        segs = all_streams[idx_m]
        g1 = sorted([w for w in wdata if w["x"] < 250], key=lambda w: -w["y"])
        g2 = sorted([w for w in wdata if w["x"] >= 250], key=lambda w: -w["y"])
        groups_out = []
        for g_idx, (gw, g_segs) in enumerate([(g1, segs[:4]), (g2, segs[4:])], 1):
            left_w = [{"y": w["y"], "t": w["t"].split()[0]} for w in gw]
            right_w = [{"y": w["y"], "t": w["t"].split()[1]} for w in gw]
            norm_segs = []
            for x1, y1, x2, y2 in g_segs:
                if x1 > x2:
                    x1, y1, x2, y2 = x2, y2, x1, y1
                norm_segs.append((x1, y1, x2, y2))
            pairs = []
            for lw in left_w:
                best_seg = min(norm_segs, key=lambda s: abs(s[1] - lw["y"]))
                best_rw = min(right_w, key=lambda rw: abs(rw["y"] - best_seg[3]))
                pairs.append({"l": lw["t"], "r": best_rw["t"], "group": g_idx})
            groups_out.append({"title": f"Nhóm ({g_idx})", "pairs": pairs})
        vec_pairs[lid] = groups_out
    return vec_pairs


MATCH_PAIRS = _extract_match_vectors()


def full_lesson_rows(lid):
    """Return all OCR rows from the end of lesson text through 注释, 练习, 扩展, and 运用."""
    import book_grammar
    src = json.loads((ROOT / "data" / "authored" / f"{lid:02d}.json").read_text())["source"]
    book = src["book"]
    start_p = src["text"][-1]["page"]
    if lid not in (18, 36):
        nxt_src = json.loads((ROOT / "data" / "authored" / f"{lid+1:02d}.json").read_text())["source"]
        end_p = nxt_src["text"][0]["page"]
    else:
        end_p = start_p + 8
    out = []
    for p in range(start_p, end_p + 1):
        f = OCR_DIR / book / "zh" / f"p{p:03d}.json"
        if not f.exists():
            break
        for r in book_grammar.rows(book_grammar.clean(json.loads(f.read_text())["lines"])):
            t = "".join(c["t"] for c in r)
            if p == end_p and (re.search(r"热身|第.{1,3}课", t) and p > start_p + 2):
                return out
            out.append([{**l, "p": p} for l in r])
    return out


def parse_gt_drill_and_cmp_answers(lid):
    """Return (drill_ans_by_point_idx, cmp_ans_list) from _dap_an_gt.txt for lesson lid."""
    b = GT_BLOCKS[lid]
    # Split before 练习
    m_lx = re.search(r"\n练习\s*\n", b)
    sec = b[:m_lx.start()] if m_lx else b
    # Split before 词语辨析
    m_cmp = re.search(r"词语辨析[^\n]*\n", sec)
    zhushi_sec = sec[:m_cmp.start()] if m_cmp else sec
    cmp_sec = sec[m_cmp.end():] if m_cmp else ""

    # Parse 词语例释 answers: blocks starting with 1., 2., 3., 4., 5.
    drill_ans = {}
    pt_matches = list(re.finditer(r"(?:^|\n)\s*(\d)\.\s*([^\n]+)", zhushi_sec))
    for i, pm in enumerate(pt_matches):
        pidx = int(pm.group(1))
        end = pt_matches[i + 1].start() if i + 1 < len(pt_matches) else len(zhushi_sec)
        chunk = zhushi_sec[pm.start():end].strip()
        items = re.findall(r"（\d）\s*([^\n（]+)", chunk)
        items = [re.sub(r"\s+", " ", x).strip() for x in items]
        drill_ans[pidx] = items

    # Parse 词语辨析 answers: （1）..（4）
    cmp_items = []
    if cmp_sec:
        for k in range(1, 5):
            nxt = f"（{k+1}）" if k < 4 else r"$"
            m_k = re.search(rf"（{k}）\s*(.*?)(?={nxt})", cmp_sec, re.S)
            if m_k:
                val = re.sub(r"\s+", " ", m_k.group(1)).strip()
                cmp_items.append(val)
    return drill_ans, cmp_items


# Exact OCR overrides for 练习2 option pairs where OCR had minor character noise
LX2_OPT_OVERRIDES = {
    (2, 3): ("恭敬", "尊敬"),
    (3, 1): ("陆续", "连续"),
    (6, 4): ("偶尔", "偶然"),
    (11, 2): ("反应", "反映"),
    (11, 3): ("体验", "体会"),
    (13, 3): ("安静", "平静"),
    (13, 4): ("温和", "温柔"),
    (14, 1): ("围绕", "环绕"),
    (14, 3): ("妈妈把我的袜子洗得干干净净。", "被妈妈我的袜子洗得干干净净。"),
    (14, 4): ("树上的花被风吹落到地上。", "树上的花把风吹落到地上。"),
    (17, 1): ("曾经", "已经"),
    (17, 2): ("渴望", "盼望"),
    (17, 3): ("周到", "周密"),
    (17, 4): ("轻视", "忽视"),
    (18, 2): ("依然", "居然"),
    (18, 3): ("偶然", "偶尔"),
    (18, 4): ("奇妙", "巧妙"),
    (22, 1): ("允许", "答应"),
    (27, 4): ("轻视", "忽视"),
    (31, 4): ("恳求", "要求"),
    (33, 2): ("必需", "必须"),
}


def extract_gt_lx1_lx2_lx3(lid, ocr_rows):
    """Extract 练习 1 (fill), 练习 2 (choice), and 练习 3 (position or match) for lesson lid."""
    b = GT_BLOCKS[lid]
    m1 = re.search(r"练习\s*1\s*\n(.*?)(?=\n\s*练习\s*2)", b, re.S)
    m2 = re.search(r"练习\s*2\s*\n(.*?)(?=\n\s*练习\s*3|$)", b, re.S)
    m3 = re.search(r"练习\s*3\s*\n(.*?)(?=\n\s*扩展|$)", b, re.S)

    # --- 1. 练习 1: 选择合适的词语填空 ---
    s1_raw = m1.group(1) if m1 else ""
    s1_parts = re.split(r"(?=（\d）)", re.sub(r"\s*\n\s*", "", s1_raw))
    lx1_items = []
    lx1_bank = []
    MULTI_FILL = {
        (1, 3): ["等待", "催"],
        (2, 5): ["锁", "断"],
        (2, 6): ["打", "工", "挣"],
        (24, 4): ["操", "心"],
    }
    for p in s1_parts:
        m_item = re.match(r"^（(\d)）\s*(.+)$", p.strip())
        if not m_item:
            continue
        inum = int(m_item.group(1))
        sent = m_item.group(2).strip()
        if (lid, inum) in MULTI_FILL:
            words = MULTI_FILL[(lid, inum)]
            q = sent
            for w in words:
                q = q.replace(f" {w} ", " ___ ", 1).replace(f" {w}", " ___", 1).replace(f"{w} ", "___ ", 1)
            q = re.sub(r"\s+", "", q).replace("___", " ___ ").strip()
            ans_val = words
            for w in words:
                if w not in lx1_bank:
                    lx1_bank.append(w)
        else:
            m_w = re.search(r"(?:^|\s)([\u4e00-\u9fff]{1,4})(?:\s|$)", sent)
            if not m_w:
                m_w = re.search(r"\s([\u4e00-\u9fff]{1,4})", sent)
            w = m_w.group(1)
            q = sent[:m_w.start(1)] + "___" + sent[m_w.end(1):]
            q = re.sub(r"\s+", "", q).replace("___", " ___ ").strip()
            ans_val = w
            if w not in lx1_bank:
                lx1_bank.append(w)
        lx1_items.append({"q": q, "a": ans_val})

    # --- 2. 练习 2: 选择正确答案 ---
    s2_raw = m2.group(1) if m2 else ""
    s2_parts = re.split(r"(?=（\d）)", re.sub(r"\s*\n\s*", "", s2_raw))

    ocr_lx2_list = []
    in_lx2 = False
    for r in ocr_rows:
        txt = " ".join(c["t"] for c in r).strip()
        if "选择正确答案" in txt:
            in_lx2 = True
            continue
        if in_lx2 and ("选择适当的位置" in txt or "搭配的词语" in txt or "复述课文" in txt):
            break
        if in_lx2:
            ma = re.search(r"[（(]?\s*A[\.．、\s]?\s*([^\sB）)]+)\s*B[\.．、\s]?\s*([^）)\s]+)", txt)
            if ma:
                opt_a = ma.group(1).strip("（）()")
                opt_b = ma.group(2).strip("（）()")
                ocr_lx2_list.append((opt_a, opt_b))

    lx2_items = []
    for p in s2_parts:
        m_item = re.match(r"^（(\d)）\s*([AB](?:、[AB])?)[\.．、]?\s*(.+)$", p.strip())
        if not m_item:
            continue
        inum = int(m_item.group(1))
        ans_let = m_item.group(2).strip()
        body = m_item.group(3).strip()
        opts_pair = LX2_OPT_OVERRIDES.get((lid, inum)) or (
            ocr_lx2_list[inum - 1] if inum - 1 < len(ocr_lx2_list) else None
        )
        opt_a, opt_b = opts_pair
        if "、" in ans_let:
            first_w = opt_a if ans_let.startswith("A") else opt_b
            second_w = opt_b if ans_let.startswith("A") else opt_a
            q = body.replace(first_w, " ___ ", 1).replace(second_w, " ___ ", 1)
            q = re.sub(r"\s+", "", q).replace("___", " ___ ").strip()
            opts = [f"① {opt_a} ／ ② {opt_b}", f"① {opt_b} ／ ② {opt_a}"]
            ans_idx = 0 if ans_let == "A、B" else 1
        elif len(opt_a) > 6:
            q = "请选择语法正确的句子："
            opts = [opt_a, opt_b]
            ans_idx = 0 if ans_let == "A" else 1
        else:
            chosen_w = opt_a if ans_let == "A" else opt_b
            if f" {chosen_w} " in f" {body} ":
                q = re.sub(rf"(?:^|\s){re.escape(chosen_w)}(?:\s|$)", " ___ ", body, count=1)
            else:
                q = body.replace(chosen_w, " ___ ", 1)
            q = re.sub(r"\s+", "", q).replace("___", " ___ ").strip()
            opts = [opt_a, opt_b]
            ans_idx = 0 if ans_let == "A" else 1
        lx2_items.append({"q": q, "options": opts, "a": ans_idx})

    # --- 3. 练习 3: Position or Match ---
    if lid in POS_LESSONS:
        s3_raw = m3.group(1) if m3 else ""
        s3_parts = re.split(r"(?=（\d）)", re.sub(r"\s*\n\s*", "", s3_raw))
        pos_items = []
        for p in s3_parts:
            m_item = re.match(r"^（(\d)）\s*([A-D])[\.．、]?\s*(.+)$", p.strip())
            if not m_item:
                continue
            pos_items.append((int(m_item.group(1)), m_item.group(2), m_item.group(3).strip()))
        lx3_ex = _build_lx3_pos(lid, pos_items, ocr_rows)
    else:
        groups = MATCH_PAIRS[lid]
        flat_items = []
        for g in groups:
            flat_items.extend(g["pairs"])
        lx3_ex = {
            "id": f"{lid:02d}-gt-match",
            "type": "match",
            "group": "gt",
            "title": "练习 3 · 画线连接可以搭配的词语 (Nối các từ ghép hợp nghĩa trong sách)",
            "groups": groups,
            "items": flat_items,
        }

    lx1_ex = {
        "id": f"{lid:02d}-gt-fill",
        "type": "fill",
        "group": "gt",
        "title": "练习 1 · 选择合适的词语填空 (Điền từ thích hợp vào chỗ trống)",
        "bank": lx1_bank,
        "items": lx1_items,
    }
    lx2_ex = {
        "id": f"{lid:02d}-gt-choice",
        "type": "choice",
        "group": "gt",
        "title": "练习 2 · 选择正确答案 (Chọn đáp án đúng)",
        "items": lx2_items,
    }
    return lx1_ex, lx2_ex, lx3_ex


def _build_lx3_pos(lid, pos_items, ocr_rows):
    # Extract OCR position lines (with A B C D markers) from textbook
    in_lx3 = False
    ocr_pos_list = []
    for r in ocr_rows:
        txt = "".join(c["t"] for c in r).strip()
        if "选择适当的位置" in txt:
            in_lx3 = True
            continue
        if in_lx3 and ("复述课文" in txt or "课文复述" in txt or "扩展" in txt):
            break
        if in_lx3:
            if ocr_pos_list and "D" not in ocr_pos_list[-1]:
                ocr_pos_list[-1] += txt
            elif re.search(r"[ABCD]", txt):
                ocr_pos_list.append(re.sub(r"^(?:[（(]\s*[1-4Il|]\s*[)）]|[①②③④]|\d[\.．]?)\s*", "", txt))
            elif ocr_pos_list and txt and not re.match(r"^练习|^\d+$", txt):
                ocr_pos_list[-1] += txt

    items = []
    for inum, ans_let, ans_sent in pos_items:
        ocr_line_full = ocr_pos_list[inum - 1] if inum - 1 < len(ocr_pos_list) else ""
        m_paren = re.search(r"[（(]\s*([\u4e00-\u9fff]+)\s*[)）]\s*$", ocr_line_full)
        m_w = re.search(r"(?:^|\s)([\u4e00-\u9fff]{1,4})(?:\s|$)", ans_sent) or re.search(
            r"\s([\u4e00-\u9fff]{1,4})", ans_sent
        )
        ocr_raw = re.sub(r"[（(][^）)]*[)）]\s*$", "", ocr_line_full).strip()
        if m_w:
            word = m_w.group(1)
            base_before = re.sub(r"\s+", "", ans_sent[:m_w.start(1)])
            base_after = re.sub(r"\s+", "", ans_sent[m_w.end(1):])
        elif m_paren:
            word = m_paren.group(1)
            clean_ans = re.sub(r"\s+", "", ans_sent)
            idx_w = clean_ans.find(word)
            base_before = clean_ans[:idx_w]
            base_after = clean_ans[idx_w + len(word):]
        else:
            idx_let = ocr_raw.find(ans_let)
            pre = re.sub(r"[ABCD\s]", "", ocr_raw[:idx_let])[-3:]
            post = re.sub(r"[ABCD\s]", "", ocr_raw[idx_let + 1:])[:3]
            clean_ans = re.sub(r"\s+", "", ans_sent)
            i1 = clean_ans.find(pre) + len(pre) if pre else 0
            i2 = clean_ans.find(post, i1) if post else len(clean_ans)
            word = clean_ans[i1:i2]
            base_before = clean_ans[:i1]
            base_after = clean_ans[i2:]
        base_sent = base_before + base_after
        # Locate the other 3 markers A, B, C, D from ocr_raw, and place ans_let at len(base_before)
        markers = {ans_let: len(base_before)}
        # Walk ocr_raw to find where A, B, C, D sit relative to Chinese characters
        zh_pos = 0
        i = 0
        while i < len(ocr_raw):
            ch = ocr_raw[i]
            if ch in "ABCD" and ch not in markers:
                markers[ch] = min(zh_pos, len(base_sent))
                i += 1
            elif "\u4e00" <= ch <= "\u9fff" or ch in "，。？！、；：“”‘’":
                zh_pos += 1
                i += 1
            else:
                i += 1
        # Ensure all 4 markers A, B, C, D exist and are in order
        for idx_let, let in enumerate("ABCD"):
            if let not in markers:
                # Interpolate missing marker
                markers[let] = min(len(base_sent), int((idx_let + 1) * len(base_sent) / 5))
        # Build sentence with A B C D inserted at their character positions
        by_pos = {}
        for let in "ABCD":
            p = markers[let]
            by_pos.setdefault(p, []).append(let)
        out_chars = []
        for idx_c in range(len(base_sent) + 1):
            if idx_c in by_pos:
                for let in by_pos[idx_c]:
                    out_chars.append(f" {let} ")
            if idx_c < len(base_sent):
                out_chars.append(base_sent[idx_c])
        q_str = re.sub(r"\s+", " ", "".join(out_chars)).strip()
        items.append({"q": q_str, "word": word, "a": ans_let})

    return {
        "id": f"{lid:02d}-gt-pos",
        "type": "position",
        "group": "gt",
        "title": "练习 3 · 给括号里的词选择适当的位置 (Chọn vị trí đúng cho từ trong ngoặc)",
        "items": items,
    }


def extract_gt_retell(lid, ocr_rows):
    """Extract 练习 4 · 根据下面的提示词复述课文内容 (exact rows of 课文复述 table)."""
    in_retell = False
    left_cells = []
    right_cells = []
    for r in ocr_rows:
        txt = "".join(c["t"] for c in r).strip()
        if "复述课文内容" in txt or "课文复述" in txt:
            in_retell = True
            continue
        if not in_retell:
            continue
        if any(k in txt for k in ("扩展", "同音词", "做一做", "从上表中", "熟悉下列")):
            break
        for c in r:
            t = c["t"].strip()
            if not t or t in ("内容提示", "重点词语", "课文复述"):
                continue
            if re.match(r"^(?:第.*课|标准教程|HSK|\d+$|练习)", t):
                continue
            if c["x"] < 0.345:
                left_cells.append(c)
            elif 0.345 <= c["x"] < 0.68:
                right_cells.append(c)

    # Cluster left_cells into logical lines, then group into prompts
    left_cells.sort(key=lambda c: (c["p"], round(c["y"], 3), c["x"]))
    right_cells.sort(key=lambda c: (c["p"], round(c["y"], 3), c["x"]))

    def merge_same_line(cells):
        lines = []
        for c in cells:
            if lines and lines[-1]["p"] == c["p"] and abs(lines[-1]["y"] - c["y"]) < 0.014:
                lines[-1]["t"] += c["t"].strip()
            else:
                lines.append({"p": c["p"], "y": c["y"], "t": c["t"].strip()})
        return lines

    l_lines = merge_same_line(left_cells)
    r_lines = merge_same_line(right_cells)

    # Group l_lines into row clusters: merge wrapped continuation lines (dy < 0.025)
    l_groups = []
    for ln in l_lines:
        if (
            l_groups
            and l_groups[-1]["p"] == ln["p"]
            and (ln["y"] - l_groups[-1]["y_end"]) < 0.025
            and not re.match(r"^[1-5][\s\.．、]", ln["t"])
        ):
            l_groups[-1]["t"] += ln["t"]
            l_groups[-1]["y_end"] = ln["y"]
        else:
            l_groups.append({"p": ln["p"], "y_start": ln["y"], "y_end": ln["y"], "t": ln["t"]})

    # Assign each r_line to the closest l_group on the same page (or by vertical band)
    prompts = []
    for idx, lg in enumerate(l_groups):
        y_min = lg["y_start"] - 0.018
        y_max = (
            l_groups[idx + 1]["y_start"] - 0.015
            if (idx + 1 < len(l_groups) and l_groups[idx + 1]["p"] == lg["p"])
            else 1.0
        )
        r_matched = [
            rl["t"]
            for rl in r_lines
            if rl["p"] == lg["p"] and y_min <= rl["y"] < y_max
        ]
        kw_str = "".join(r_matched)
        kws = [
            w.strip()
            for w in re.split(r"[、，,；;\s]+", kw_str)
            if w.strip()
        ]
        sec_title = re.sub(r"^(\d)\s*(?=[\u4e00-\u9fff])", r"\1. ", lg["t"].strip())
        prompts.append({"prompt": sec_title, "keywords": kws})

    return {
        "id": f"{lid:02d}-retell",
        "type": "retell",
        "group": "gt",
        "title": "练习 4 · 根据提示词复述课文内容 (Kể lại bài khóa theo từ gợi ý trong sách)",
        "items": prompts,
    }


def extract_gt_ext_and_yunyong(lid, ocr_rows, lesson_vocab):
    """Extract 扩展 · 做一做 (NN-ext) and 运用 · 命题写作 (NN-writing)."""
    b = GT_BLOCKS[lid]
    m_ext = re.search(r"扩展\s*(?:做一做)?\s*\n(.*?)$", b, re.S)
    ext_ans_raw = m_ext.group(1) if m_ext else ""
    ext_parts = re.split(r"(?=（\d）)", re.sub(r"\s*\n\s*", "", ext_ans_raw))

    # Extract topic title and vocabulary table from OCR rows between 扩展 and 做一做
    in_ext = False
    in_yunyong = False
    ext_topic = "词汇扩展"
    ext_words = []
    yunyong_lines = []
    for r in ocr_rows:
        txt = "".join(c["t"] for c in r).strip()
        if "熟悉下列" in txt:
            in_ext = True
            m_t = re.search(r"熟悉下列(.*?)词语", txt)
            if m_t and m_t.group(1).strip():
                ext_topic = m_t.group(1).strip()
            continue
        if in_ext and ("做一做" in txt or "从上表中" in txt):
            in_ext = False
            continue
        if in_ext:
            for c in r:
                t = c["t"].strip()
                if not t or re.search(r"[0-9a-zA-Z]", t) or "扩展" in t or "练习" in t:
                    continue
                for w in re.split(r"[\s/／]+", t):
                    w = w.strip("（）()、，,。")
                    if w and 1 <= len(w) <= 6 and w not in ext_words:
                        ext_words.append(w)
        if any(k in txt for k in ("背景分析", "话题讨论", "命题写作", "一、背景", "二、话题", "三、命题")):
            in_yunyong = True
        if in_yunyong:
            # Filter out right margin headers / page numbers
            row_clean = "".join(c["t"] for c in r if c["x"] < 0.72).strip()
            if row_clean and not re.match(r"^(?:运用|\d+|HSK.*|标准教程.*)$", row_clean):
                yunyong_lines.append(row_clean)

    # Parse 扩展 · 做一做 4 items
    ext_items = []
    for p in ext_parts:
        m_item = re.match(r"^（(\d)）\s*(.+)$", p.strip())
        if not m_item:
            continue
        sent = m_item.group(2).strip()
        m_w = re.search(r"(?:^|\s)([\u4e00-\u9fff]{1,5})(?:\s|$)", sent)
        if not m_w:
            m_w = re.search(r"\s([\u4e00-\u9fff]{1,5})", sent)
        w = m_w.group(1)
        q = sent[:m_w.start(1)] + "___" + sent[m_w.end(1):]
        q = re.sub(r"\s+", "", q).replace("___", " ___ ").strip()
        if w not in ext_words:
            ext_words.append(w)
        ext_items.append({"q": q, "a": w})

    ext_ex = {
        "id": f"{lid:02d}-ext",
        "type": "fill",
        "group": "ext",
        "title": f"扩展 · 做一做：{ext_topic} (Từ vựng mở rộng & Điền từ)",
        "context": "Bảng từ vựng mở rộng trong sách: " + "、".join(ext_words),
        "bank": ext_words,
        "items": ext_items,
    }

    # Parse 运用 sections (一、背景分析, 二、话题讨论, 三、命题写作)
    yy_full = "\n".join(yunyong_lines)
    m_write = re.search(r"(?:三、\s*命题写作|命题写作)(.*)", yy_full, re.S)
    if m_write:
        ctx_part = yy_full[:m_write.start()].strip()
        write_prompt = re.sub(r"\s*\n\s*", "", m_write.group(1)).strip()
    else:
        ctx_part = yy_full.strip()
        write_prompt = "请结合本课所学内容和生词，写一篇100字以上的短文。"

    if not write_prompt:
        write_prompt = "请结合本课所学内容和生词，写一篇100字以上的短文。"

    writing_ex = {
        "id": f"{lid:02d}-writing",
        "type": "retell",
        "group": "ext",
        "title": "运用 · 命题写作 (Thảo luận & Viết bài theo chủ đề trong sách)",
        "context": ctx_part,
        "items": [
            {
                "prompt": f"命题写作：{write_prompt}",
                "keywords": lesson_vocab[:12],
            }
        ],
    }
    return ext_ex, writing_ex


# --- Workbook (练习册) Extraction ---

WB_NOISE_RE = re.compile(
    r"(?:Scanned by|Scamed by|Scamned by|www\.nhantriviet|www\.nhantrivlet|www\.hhantriviet|"
    r"GiaoTrinhChuanHSK|GlaoTrinhChuanHSK|QT Education|Edueation|uCation|ation|cccrciOn|wrcCrc1On|"
    r"tIOn|tlOn|atlOn|CIOn|LIOn|LIO1|EdU|EOU|LOU|学而[优忧]?|而优|^HSK$|标准教程.*练习册|^\d+\s*[-—–]\s*$)"
)

WB_OPT_OVERRIDES = {
    (9, 28): ["高兴", "不解", "生气", "平静"],
    (23, 28): ["纪律性", "自信心", "行动力", "环保观念"],
    (24, 23): ["她忘了给女儿收拾书包", "她把图书馆的书弄丢了", "图书馆的书被女儿弄坏了", "她没有时间去接女儿放学"],
}

WB_Q32_KW_OVERRIDES = {
    31: ["态度", "领会", "赞成", "无所谓", "犹豫"],
}


def _clean_wb_page_lines(page_path):
    d = json.loads(page_path.read_text())
    out = []
    for l in d["lines"]:
        y, x, t = l["y"], l["x"], l["t"].strip()
        if y < 0.09 or y > 0.94:
            continue
        if y > 0.91 and re.match(r"^\d+$", t):
            continue
        if x > 0.88 or x < 0.05:
            continue
        if WB_NOISE_RE.search(t):
            t_stripped = WB_NOISE_RE.sub("", t).strip()
            if not t_stripped or len(t_stripped) <= 2:
                continue
            t = t_stripped
        if re.match(
            r"^(?:二、阅读|三、书写|第[一二三]部分|第\s*\d+\s*[-—~～]\s*\d+\s*题|第\s*32\s*题)",
            t,
        ):
            continue
        out.append({"y": y, "x": x, "t": t})
    out.sort(key=lambda l: (round(l["y"], 2), l["x"]))
    return out


def _parse_wb_opts(lines):
    opts = {}
    for l in lines:
        t = l["t"].strip()
        t = re.sub(r"^[•·\.．]?(?:\d{1,2}\s*[\.．、]?\s*)", "", t)
        parts = re.split(
            r"(?=(?:^|\s)[A-D4][\.．、\s]|(?:^|\s)[A-D][\u4e00-\u9fff“\"（(《\d])", t
        )
        for p in parts:
            p = p.strip()
            m = re.match(r"^([A-D4])[\.．、\s]?\s*(.+)$", p)
            if m:
                let = "A" if m.group(1) == "4" else m.group(1)
                opts[let] = m.group(2).strip()
    return [opts.get(k, "") for k in ("A", "B", "C", "D")]


def _get_wb_listen_col_opts(page_path, x_min, x_max):
    d = json.loads(page_path.read_text())
    lines = [l for l in d["lines"] if x_min <= l["x"] < x_max and l["y"] < 0.88]
    lines.sort(key=lambda l: (round(l["y"], 3), l["x"]))
    opts = []
    for l in lines:
        t = l["t"].strip()
        if re.match(
            r"^(?:第[一二]部分|第\s*\d+|一、听力|、听力|练习册|标准教程|HSK|Ed|tIOn|atlOn|LOU|EOU|0n|学而|优$)",
            t,
        ):
            continue
        m_abcd = re.match(r"^[\.．]?(?:\d{1,2}\s*[\.．、]?\s*)?([A-D4])\s*[\.．、]?\s*(.+)$", t)
        if m_abcd:
            let = "A" if m_abcd.group(1) == "4" else m_abcd.group(1)
            val = re.sub(r"^[\.．]?(?:\d{1,2}\s*[\.．、]?\s*)?[A-D4]\s*[\.．、]?\s*", "", t).strip()
            val = re.sub(
                r"(?:EdU|EOU|LOU|tIOn|tlOn|atlOn|CIOn|LIOn\.?|0n|学而[优忧？。]?|101|一、听力|、听力).*$",
                "",
                val,
            ).strip()
            if val and re.search(r"[\u4e00-\u9fff]", val):
                opts.append(val)
    return [opts[i : i + 4] for i in range(0, len(opts), 4)]


def extract_wb_exercises(lid):
    """Extract all 4 workbook exercise sections for lesson lid:
    1. NN-wb-listen (Q1-14)
    2. NN-wb-read (Q15-28)
    3. NN-wb-order (Q29-31)
    4. NN-wb-write (Q32)
    """
    vol = 1 if lid <= 18 else 2
    p0 = WB_STARTS[(lid - 1) % 18]
    wb_ocr_dir = OCR_DIR / f"bai-tap-{vol}" / "zh"

    # Parse WB answer key and listening transcripts
    b = WB_BLOCKS[lid]
    m_ans = re.search(r"参考答案[：:]?\s*(.*)", b, re.S)
    ans_part = m_ans.group(1)
    trans_part = b[: m_ans.start()]

    ans_map = {}
    for rm in re.finditer(r"(\d{1,2})\s*[-—~～]\s*(\d{1,2})\s*[：:]\s*([A-D\s]+)", ans_part):
        q1, q2 = int(rm.group(1)), int(rm.group(2))
        if q1 > 28:
            continue
        letters = re.findall(r"[A-D]", rm.group(3))
        for qnum, let in zip(range(q1, q2 + 1), letters):
            if qnum not in ans_map:
                ans_map[qnum] = "ABCD".index(let)

    # Parse transcripts 1-14
    q_trans = {}
    for q in range(1, 11):
        nxt = f"{q+1}[．.]" if q < 10 else r"第\s*11"
        m_q = re.search(rf"(?:^|\n)\s*{q}[．.]\s*(.*?)(?=\n\s*{nxt})", trans_part, re.S)
        if m_q:
            q_trans[q] = re.sub(r"\s*\n\s*", "\n", m_q.group(1).strip())
    for q1, q2 in [(11, 12), (13, 14)]:
        m_pair = re.search(
            rf"第\s*{q1}\s*到\s*{q2}\s*题[^\n]*\n(.*?)\n\s*{q1}[．.]\s*([^\n]+)\n\s*{q2}[．.]\s*([^\n]+)",
            trans_part,
            re.S,
        )
        if m_pair:
            dialog = re.sub(r"\s*\n\s*", "", m_pair.group(1).strip())
            q_trans[q1] = f"{dialog}\n问：{m_pair.group(2).strip()}"
            q_trans[q2] = f"{dialog}\n问：{m_pair.group(3).strip()}"

    # 1. 一、听力 (Q1-14)
    p_l1 = wb_ocr_dir / f"p{p0:03d}.json"
    p_l2 = wb_ocr_dir / f"p{p0+1:03d}.json"
    listen_opts = (
        _get_wb_listen_col_opts(p_l1, 0.0, 0.45)
        + _get_wb_listen_col_opts(p_l1, 0.45, 1.0)
        + _get_wb_listen_col_opts(p_l2, 0.0, 0.45)
        + _get_wb_listen_col_opts(p_l2, 0.45, 1.0)
    )
    listen_items = []
    for q in range(1, 15):
        item = {
            "q": f"第 {q} 题",
            "options": listen_opts[q - 1],
            "a": ans_map[q],
            "why": q_trans.get(q, ""),
        }
        if q == 1:
            item["section"] = "第一部分（第 1–6 题：听对话，选出正确答案）"
            item["audio"] = f"audio/bai-tap-{vol}/{lid:02d}-1.mp3"
        elif q == 7:
            item["section"] = "第二部分（第 7–14 题：听对话或短文，选出正确答案）"
            item["audio"] = f"audio/bai-tap-{vol}/{lid:02d}-2.mp3"
        listen_items.append(item)

    wb_listen_ex = {
        "id": f"{lid:02d}-wb-listen",
        "type": "choice",
        "group": "wb",
        "title": "练习册 · 一、听力 (Nghe hiểu Sách bài tập — Câu 1–14)",
        "items": listen_items,
    }

    # 2. 二、阅读 (Q15-28)
    read_items = []
    # Part 1: Q15-18 (p0 + 2)
    lines_p2 = _clean_wb_page_lines(wb_ocr_dir / f"p{p0+2:03d}.json")
    q_idx_15 = {}
    for l in lines_p2:
        m = re.match(r"^[\.．]?(1[5-8])\s*[\.．、]?\s*[A-D4]", l["t"])
        if m and int(m.group(1)) not in q_idx_15 and l["x"] < 0.25:
            q_idx_15[int(m.group(1))] = l["y"]
    passage_15_18 = "".join(
        l["t"] for l in lines_p2 if l["y"] < q_idx_15[15] - 0.012
    )
    passage_15_18 = re.sub(r"1([5-8])_+", r"（ 1\1 ）", passage_15_18)
    for q in range(15, 19):
        y_cur = q_idx_15[q]
        y_nxt = q_idx_15[q + 1] if q < 18 else 1.0
        qlines = [l for l in lines_p2 if y_cur - 0.012 <= l["y"] < y_nxt - 0.012]
        opts = _parse_wb_opts(qlines)
        item = {"q": f"第 {q} 题（选词填空）", "options": opts, "a": ans_map[q]}
        if q == 15:
            item["section"] = "第一部分（第 15–18 题：请选出正确答案）"
            item["passage"] = passage_15_18
        read_items.append(item)

    # Part 2: Q19-22 (p0 + 3)
    lines_p3 = _clean_wb_page_lines(wb_ocr_dir / f"p{p0+3:03d}.json")
    q_idx_19 = {}
    for l in lines_p3:
        m = re.match(r"^[•·\.．]?(19|2[0-2])\s*[\.．、]?\s*\S", l["t"])
        if m and int(m.group(1)) not in q_idx_19 and l["x"] < 0.20:
            q_idx_19[int(m.group(1))] = l["y"]
    if 20 not in q_idx_19 and 19 in q_idx_19:
        for i, l in enumerate(lines_p3):
            if l["y"] > q_idx_19[19] and re.match(r"^D[\.．、\s]", l["t"]):
                q_idx_19[20] = lines_p3[i + 1]["y"]
                break
    for q in range(19, 23):
        y_cur = q_idx_19[q]
        y_nxt = q_idx_19[q + 1] if q < 22 else 1.0
        qlines = [l for l in lines_p3 if y_cur - 0.008 <= l["y"] < y_nxt - 0.008]
        opt_lines, pass_lines, in_opts = [], [], False
        for l in qlines:
            if (
                not in_opts
                and re.match(r"^[•·\.．]?[A4][\.．、\s\u4e00-\u9fff“\"（(《\d]", l["t"])
                and l["x"] < 0.25
            ):
                in_opts = True
            (opt_lines if in_opts else pass_lines).append(l)
        q_text = "".join(x["t"] for x in pass_lines).strip()
        q_text = re.sub(rf"^[•·\.．]?{q}\s*[\.．、]?\s*", "", q_text)
        opts = _parse_wb_opts(opt_lines)
        item = {"q": f"{q}. {q_text}", "options": opts, "a": ans_map[q]}
        if q == 19:
            item["section"] = "第二部分（第 19–22 题：请选出与试题内容一致的一项）"
        read_items.append(item)

    # Part 3: Q23-25 (p0 + 4) and Q26-28 (p0 + 5)
    for p_off, q_range in [(4, (23, 24, 25)), (5, (26, 27, 28))]:
        lines_p = _clean_wb_page_lines(wb_ocr_dir / f"p{p0+p_off:03d}.json")
        q_idx_p = {}
        for l in lines_p:
            if l["y"] < 0.30:
                continue
            m = re.match(r"^[•·\.．]?(2[3-8])\s*[\.．、]\s*\S", l["t"])
            if m and int(m.group(1)) in q_range and int(m.group(1)) not in q_idx_p and l["x"] < 0.25:
                q_idx_p[int(m.group(1))] = l["y"]
        first_q = q_range[0]
        passage_lines = [
            l["t"]
            for l in lines_p
            if l["y"] < q_idx_p[first_q] - 0.012
            and not re.match(r"^2[36]\s*[-—~～–]\s*2[58]", l["t"])
        ]
        passage_txt = "".join(passage_lines).strip()
        for idx_q, q in enumerate(q_range):
            y_cur = q_idx_p[q]
            y_nxt = q_idx_p[q_range[idx_q + 1]] if idx_q < 2 else 1.0
            qlines = [l for l in lines_p if y_cur - 0.008 <= l["y"] < y_nxt - 0.008]
            stem_lines = [l["t"] for l in qlines if abs(l["y"] - y_cur) <= 0.008]
            stem = "".join(stem_lines).strip()
            stem = re.sub(rf"^[•·\.．]?{q}\s*[\.．、]?\s*", f"{q}. ", stem)
            opt_lines = [l for l in qlines if l["y"] > y_cur + 0.008]
            opts = WB_OPT_OVERRIDES.get((lid, q)) or _parse_wb_opts(opt_lines)
            item = {"q": stem, "options": opts, "a": ans_map[q]}
            if idx_q == 0:
                item["section"] = f"第三部分（第 {q_range[0]}–{q_range[2]} 题：阅读理解）"
                item["passage"] = passage_txt
            read_items.append(item)

    wb_read_ex = {
        "id": f"{lid:02d}-wb-read",
        "type": "choice",
        "group": "wb",
        "title": "练习册 · 二、阅读 (Đọc hiểu Sách bài tập — Câu 15–28)",
        "items": read_items,
    }

    # 3. 三、书写 · 第一部分：完成句子 (Q29-31)
    lines_p6 = _clean_wb_page_lines(wb_ocr_dir / f"p{p0+6:03d}.json")
    order_items = []
    for q in (29, 30, 31):
        m_a = re.search(rf"(?:^|\n)\s*{q}\s*[\.．]\s*([^\n]+)", ans_part)
        full_ans = m_a.group(1).strip()
        primary_ans = full_ans.split("/")[0].strip()
        target_chars = re.sub(r"[。？！，、；：“”‘’（）()\s\.．]", "", primary_ans)
        # Find OCR line for q on p0 + 6 to get token boundaries
        y_q = None
        for l in lines_p6:
            if re.match(rf"^{q}\s*[\.．、]?", l["t"]) and l["y"] < 0.55:
                y_q = l["y"]
                break
        q_row = [l for l in lines_p6 if y_q is not None and abs(l["y"] - y_q) < 0.015]
        q_row.sort(key=lambda l: l["x"])
        raw_tokens = []
        for l in q_row:
            t_clean = re.sub(rf"^{q}\s*[\.．、]?\s*", "", l["t"]).strip()
            for tok in re.split(r"\s+", t_clean):
                tok = re.sub(r"[^\u4e00-\u9fff0-9A-Za-z]", "", tok)
                if tok:
                    raw_tokens.append(tok)
        # Align raw_tokens onto target_chars so every word is an exact substring of target_chars
        words = _segment_order_words(raw_tokens, target_chars)
        order_items.append({"words": words, "a": full_ans})

    wb_order_ex = {
        "id": f"{lid:02d}-wb-order",
        "type": "order",
        "group": "wb",
        "title": "练习册 · 三、书写：第一部分 · 完成句子 (Sắp xếp câu Sách bài tập — Câu 29–31)",
        "items": order_items,
    }

    # 4. 三、书写 · 第二部分：写短文 (Q32)
    y32 = None
    for l in lines_p6:
        if re.match(r"^32\s*[\.．、]", l["t"]) or (
            l["y"] > 0.55 and re.match(r"^[（(]1[)）]", l["t"])
        ):
            y32 = l["y"]
            break
    q32_lines = [l["t"] for l in lines_p6 if y32 is not None and l["y"] >= y32 - 0.005]
    kws_32 = WB_Q32_KW_OVERRIDES.get(lid)
    if not kws_32:
        for t in q32_lines:
            if "、" in t and "请结合" not in t:
                kws_32 = [
                    w.strip()
                    for w in t.split("、")
                    if w.strip() and re.search(r"[\u4e00-\u9fff]", w)
                ]
                break
    wb_write_ex = {
        "id": f"{lid:02d}-wb-write",
        "type": "retell",
        "group": "wb",
        "title": "练习册 · 三、书写：第二部分 · 写短文 (Viết đoạn văn ngắn — Câu 32)",
        "items": [
            {
                "prompt": "32. 请结合下列词语（要全部使用，顺序不分先后），写一篇 80 字左右的短文。",
                "keywords": kws_32 or [],
            }
        ],
    }

    return [wb_listen_ex, wb_read_ex, wb_order_ex, wb_write_ex]


def _segment_order_words(raw_tokens, target_chars):
    """Segment target_chars into scrambled words matching raw_tokens from the workbook."""
    # First check if raw_tokens is already an exact permutation of target_chars
    if sorted("".join(raw_tokens)) == sorted(target_chars):
        # Verify each token exists in target_chars (split glued tokens like 我吧靠在)
        words = []
        rem = target_chars
        for tok in raw_tokens:
            if tok in rem:
                words.append(tok)
                rem = rem.replace(tok, "", 1)
            else:
                # Split glued token into pieces present in target_chars
                i = 0
                while i < len(tok):
                    matched = False
                    for l in range(len(tok) - i, 0, -1):
                        sub = tok[i : i + l]
                        if sub in rem:
                            words.append(sub)
                            rem = rem.replace(sub, "", 1)
                            i += l
                            matched = True
                            break
                    if not matched:
                        i += 1
        if sorted("".join(words)) == sorted(target_chars):
            return words

    # Fallback: use raw_tokens' lengths/anchors to partition target_chars, then scramble in raw_tokens order
    used = [False] * len(target_chars)
    pieces = []
    for tok in raw_tokens:
        # Find best matching unused span in target_chars
        best_pos = -1
        best_len = len(tok)
        for pos in range(len(target_chars) - best_len + 1):
            if any(used[pos : pos + best_len]):
                continue
            if target_chars[pos : pos + best_len] == tok:
                best_pos = pos
                break
        if best_pos != -1:
            for k in range(best_pos, best_pos + best_len):
                used[k] = True
            pieces.append((best_pos, tok))
    # Collect any remaining unused contiguous spans
    i = 0
    rem_spans = []
    while i < len(target_chars):
        if used[i]:
            i += 1
            continue
        j = i
        while j < len(target_chars) and not used[j]:
            j += 1
        rem_spans.append((i, target_chars[i:j]))
        i = j
    all_words = [w for _, w in pieces] + [w for _, w in rem_spans]
    return all_words


CMP_ITEM1 = {
    1: ("他向经理叙述了自己是 ___ 解决这个问题的。", "如何/怎么"),
    2: ("晚饭前姑姑就一个人 ___ 地走了。", "悄悄/偷偷"),
    3: ("早晨收拾完房间后，妈妈喜欢 ___ 地坐在那把躺椅上休息一下。", "舒适/舒服"),
    4: ("我对新公司的工作条件感到很 ___ 。", "满足/满意"),
    5: ("这篇文章的语言生动 ___ 。", "优美"),
    6: ("A：打扰一下，向您 ___ 件事。你知道王老板有什么兴趣爱好吗？ B：他最大的爱好就是去各地旅游了，平时也喜欢看看书、看看电影什么的。", "打听"),
    7: ("他抱着小狗走到门口， ___ 想起妈妈不允许他在家里养小动物。", "忽然/突然"),
    8: ("对同一个问题， ___ 的认识不同，是很正常的事情。", "彼此"),
    9: ("这是你 ___ 的事，应该亲自做。", "自己"),
    10: ("他最近怎么了？总是 ___ 不太高兴。", "显得"),
    11: ("真希望刘老师能 ___ 给我们上课。", "继续"),
    12: ("四川是茶馆文化最 ___ 的地区之一。", "发达"),
    13: ("这种蔬菜有 ___ 的香味，它既可以生吃，又可熟食。", "强烈"),
    14: ("她 ___ 在家帮妈妈干活儿。", "通常/常常"),
    15: ("这项实验如果研究 ___ ，将给成千上万的病人带来希望。", "成功"),
    16: ("我们租下了一所房子作为 ___ 的家。", "临时/暂时"),
    17: ("以前我们 ___ 了教育问题，现在要赶上去。", "忽视/轻视"),
    18: ("我们 ___ 很着急，你能过来一趟吗？", "现在"),
    19: ("在南方的时候，我总是 ___ 北方雪花飘飘的美景。", "怀念/想念"),
    20: ("他又创造了新的奥运会 ___ 。", "纪录"),
    21: ("和刘峰在上海的那次碰面非常 ___ 。", "偶然"),
    22: ("机会对每个人来说都是 ___ 的。", "平等/公平"),
    23: ("这所大学为女生提供了 ___ 的考试，引起了激烈争论。", "单独"),
    24: ("我准备公开 ___ 我的意见。", "发表"),
    25: ("刘老师虽然看上去很 ___ ，但其实对人很友善。", "严肃"),
    26: ("他多次想告诉她，但 ___ 没说出口。", "终于"),
    27: ("生意失败，他 ___ 了很多钱。", "损失"),
    28: ("他这么做， ___ 出他的思想还不太成熟。", "反映"),
    29: ("所有的事都 ___ 在这一个星期了。", "挤"),
    30: ("做这个动作时，大腿要尽量 ___ 胸部。", "接近/靠近"),
    31: ("据说这位刘先生从不 ___ 花钱请人吃饭。", "轻易"),
    32: ("父母平时应 ___ 孩子多参加体育活动。", "鼓励"),
    33: ("用表格来说明问题是一种有条理的思考方法的 ___ 。", "表现/体现"),
    34: ("这个实验我已经 ___ 过两次了。", "重复"),
    35: ("治疗这种病需要一种 ___ 的药。", "特殊/特别"),
    36: ("一个星期的迎来送往，她已经有点儿 ___ 不了了。", "应付"),
}


def extract_gt_cmp(lid, comp_list):
    """Clean compare[0]['drill'] with all 4 items + answers, and return interactive NN-cmp exercise."""
    b = GT_BLOCKS[lid]
    m = re.search(r"词语辨析\s*(?:做一做)?\s*\n(.*?)(?=\n\s*练习\s*1)", b, re.S)
    raw = re.sub(r"\s*\n\s*", "", m.group(1)) if m else ""
    parts = [p.strip() for p in re.split(r"(?=（\d）)", raw) if p.strip()]

    q1, a1 = CMP_ITEM1[lid]
    cmp_items = [{"q": q1, "a": a1}]
    for p in parts:
        m_it = re.match(r"^（(\d)）\s*(.+)$", p)
        if not m_it:
            continue
        sent = m_it.group(2).strip()
        m_w = re.search(
            r"(?:^|\s)([\u4e00-\u9fff]+(?:/[\u4e00-\u9fff]+)?)(?:\s|$)", sent
        ) or re.search(r"\s([\u4e00-\u9fff]+(?:/[\u4e00-\u9fff]+)?)", sent)
        w = m_w.group(1)
        q = sent[: m_w.start(1)] + "___" + sent[m_w.end(1) :]
        q = re.sub(r"\s+", "", q).replace("___", " ___ ").strip()
        cmp_items.append({"q": q, "a": w})

    w1, w2 = comp_list[0]["words"] if comp_list else ("词1", "词2")
    if comp_list:
        comp_list[0]["drill"] = {
            "title": "做一做：选词填空",
            "items": [it["q"].replace(" ___ ", "____") for it in cmp_items],
            "answers": [it["a"] for it in cmp_items],
        }

    return {
        "id": f"{lid:02d}-cmp",
        "type": "fill",
        "group": "gt",
        "title": f"词语辨析 · 做一做：{w1} ／ {w2} (Phân biệt từ gần nghĩa trong sách)",
        "bank": [w1, w2, f"{w1}/{w2}"],
        "items": cmp_items,
    }


def build_all_book_exercises(lid, comp_list, lesson_vocab):
    """Build all official textbook & workbook exercises for lesson lid."""
    rs = full_lesson_rows(lid)
    cmp_ex = extract_gt_cmp(lid, comp_list)
    lx1_ex, lx2_ex, lx3_ex = extract_gt_lx1_lx2_lx3(lid, rs)
    ret_ex = extract_gt_retell(lid, rs)
    ext_ex, wrt_ex = extract_gt_ext_and_yunyong(lid, rs, lesson_vocab)
    wb_exs = extract_wb_exercises(lid)
    return [lx1_ex, lx2_ex, lx3_ex, ret_ex, cmp_ex, ext_ex, wrt_ex] + wb_exs
