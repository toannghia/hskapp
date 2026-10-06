#!/usr/bin/env python3
"""Tìm và tải ảnh minh hoạ có giấy phép mở từ Wikimedia Commons cho từ mới của một bài.
Dùng: python3 tools/fetch_images.py 19            (mỗi từ lấy ứng viên đầu tiên đạt yêu cầu)
      python3 tools/fetch_images.py 19 13=2 30=3  (đổi sang ứng viên thứ 2 cho từ số 13, thứ 3 cho từ số 30)
      python3 tools/fetch_images.py 19 26=0       (bỏ ảnh của từ số 26)
Từ khóa tìm ảnh khai báo trong data/image-queries.json: {"số bài": {"số từ": "từ khóa tiếng Anh"}}.
Chỉ nhận ảnh thuộc phạm vi công cộng hoặc giấy phép CC0 / CC BY / CC BY-SA. Ảnh thu nhỏ còn 480px, lưu vào
data/images/NN/, kèm tác giả, giấy phép và đường dẫn gốc trong data/images/NN/credits.json để ghi nguồn trong app."""
import html
import json
import re
import sys
import subprocess
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://commons.wikimedia.org/w/api.php"
AGENT = "hsk5-study-app/1.0 (personal study tool; contact nghia.code@gmail.com)"
OK = re.compile(r"^(cc0|public domain|pd|cc[ -]by(-sa)?[ -]\d)", re.I)


def get(url):
    # Dùng curl của hệ thống vì bản Python này không có sẵn kho chứng chỉ để kiểm tra HTTPS.
    return subprocess.run(["curl", "-sSL", "--fail", "-m", "60", "-A", AGENT, url], check=True, capture_output=True).stdout


def candidates(query):
    params = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 12,
              "gsrsearch": f"{query} filetype:bitmap", "prop": "imageinfo",
              "iiprop": "url|extmetadata|size|mime", "iiurlwidth": 480}
    data = json.loads(get(API + "?" + urllib.parse.urlencode(params)))
    pages = sorted((data.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
    out = []
    for p in pages:
        info = (p.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        lic = (meta.get("LicenseShortName") or {}).get("value", "")
        # Bỏ ảnh quá nhỏ, ảnh dọc quá dài, và ảnh không phải JPEG (bản đồ, sơ đồ thường là PNG).
        if not OK.match(lic) or info.get("mime") != "image/jpeg" or info.get("width", 0) < 500:
            continue
        if info.get("height", 0) > info.get("width", 1) * 1.6:
            continue
        author = re.sub(r"<[^>]+>", "", html.unescape((meta.get("Artist") or {}).get("value", ""))).strip()
        out.append({"title": p["title"].removeprefix("File:"), "thumb": info["thumburl"], "url": info["descriptionurl"],
                    "license": lic, "author": re.sub(r"\s+", " ", author)[:80] or "không rõ"})
    return out


lesson = int(sys.argv[1])
picks = dict(a.split("=") for a in sys.argv[2:])
queries = json.loads((ROOT / "data" / "image-queries.json").read_text()).get(str(lesson), {})
out_dir = ROOT / "data" / "images" / f"{lesson:02d}"
out_dir.mkdir(parents=True, exist_ok=True)
credits_file = out_dir / "credits.json"
credits = json.loads(credits_file.read_text()) if credits_file.exists() else {}
for num, query in queries.items():
    if picks and num not in picks:
        continue
    which = int(picks.get(num, 1))
    dest = out_dir / f"{int(num):02d}.jpg"
    if which == 0:
        dest.unlink(missing_ok=True)
        credits.pop(num, None)
        print(f"{num}: đã bỏ ảnh")
        continue
    found = candidates(query)
    if len(found) < which:
        print(f"{num}: '{query}' chỉ có {len(found)} ứng viên đạt giấy phép → bỏ qua")
        continue
    c = found[which - 1]
    dest.write_bytes(get(c["thumb"]))
    credits[num] = {"file": dest.name, "title": c["title"], "author": c["author"], "license": c["license"], "url": c["url"]}
    print(f"{num}: {c['title'][:50]} | {c['license']} | {c['author'][:30]} | {dest.stat().st_size // 1024} KB ({len(found)} ứng viên)")
credits_file.write_text(json.dumps(dict(sorted(credits.items(), key=lambda kv: int(kv[0]))), ensure_ascii=False, indent=1))
