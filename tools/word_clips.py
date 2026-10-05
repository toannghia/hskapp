#!/usr/bin/env python3
"""Cắt file đọc bảng từ mới của giáo trình thành từng tệp nhỏ, mỗi từ một tệp (audio/words/NN/KK.m4a).
Dùng: python3 tools/word_clips.py all     (hoặc số bài)

Cách làm: tìm các đoạn có tiếng (cách nhau bởi khoảng lặng), rồi dóng hàng các đoạn với bảng từ.
File đọc có câu giới thiệu ở đầu, đôi khi đọc thêm mục không có trong bảng từ, và cuối file có thể đọc
tên riêng, nên không thể ghép đoạn thứ k với từ thứ k. Việc dóng hàng dựa vào âm thanh: mỗi từ được
tổng hợp bằng giọng máy rồi so với từng đoạn tiếng thật (tools/acoustic.py); đoạn nào giống nhất và giữ
đúng thứ tự thì là từ đó. Từ nào mà phương án tốt nhất không hơn hẳn phương án kế tiếp thì KHÔNG cắt
(app dùng giọng của thiết bị cho từ đó), để không phát nhầm tiếng của từ khác.
Kết quả ghi data/audio-times/NN.json."""
import array
import json
import math
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import acoustic

ROOT = Path(__file__).resolve().parent.parent
STEP, RATE = 0.02, 22050
# Khoảng cách âm học: đúng từ thường 1,4–2,3; sai từ 1,9–2,9. Nhân KSCALE để so với giá bỏ qua một đoạn thừa.
KSCALE, SKIP, MARGIN, WINDOW = 10.0, 6.0, 3.0, 9
INF = float("inf")


def decode(path):
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "v.wav"
        subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1", str(path), str(wav)], check=True)
        w = wave.open(str(wav))
        return array.array("h", w.readframes(w.getnframes()))


def segments(pcm):
    win = int(RATE * STEP)
    rms = [math.sqrt(sum(x * x for x in pcm[i:i + win]) / win) for i in range(0, len(pcm) - win, win)]
    threshold = sorted(rms)[int(len(rms) * 0.95)] * 0.06
    out, start, quiet = [], None, 0
    for i, r in enumerate(rms):
        if r > threshold:
            start = i if start is None else start
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet >= 20:          # 0,4 giây im lặng là hết một từ
                out.append((start * STEP, (i - quiet + 1) * STEP))
                start = None
    if start is not None:
        out.append((start * STEP, len(rms) * STEP))
    return out


def align(dist, durs, free, n):
    """Dóng hàng từ với đoạn tiếng. dist[(i, j)] = khoảng cách âm học giữa từ i và đoạn j (nhỏ là giống).
    free[j] = đoạn j bỏ qua không mất giá (câu giới thiệu đầu file). Trả về {chỉ số từ: chỉ số đoạn},
    chỉ gồm những từ mà phương án tốt nhất hơn hẳn phương án kế tiếp."""
    m = len(durs)
    fit = lambda i, j: KSCALE * dist[(i, j)] if (i, j) in dist else INF
    skip = lambda j: 0 if free[j] else SKIP
    F = [[INF] * (m + 1) for _ in range(n + 1)]
    F[0][0] = 0
    for i in range(n + 1):
        for j in range(m + 1):
            if F[i][j] == INF:
                continue
            if j < m:
                F[i][j + 1] = min(F[i][j + 1], F[i][j] + skip(j))
                if i < n:
                    F[i + 1][j + 1] = min(F[i + 1][j + 1], F[i][j] + fit(i, j))
    # Các đoạn thừa sau từ cuối cùng (tên riêng) không mất giá.
    B = [[INF] * (m + 1) for _ in range(n + 1)]
    for j in range(m + 1):
        B[n][j] = 0
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            B[i][j] = min(B[i][j + 1] + skip(j), fit(i, j) + B[i + 1][j + 1])
    sure = {}
    for i in range(n):
        costs = sorted((F[i][j] + fit(i, j) + B[i + 1][j + 1], j) for j in range(m) if F[i][j] < INF and (i, j) in dist)
        if costs and costs[0][0] < INF and (len(costs) == 1 or costs[1][0] - costs[0][0] >= MARGIN):
            sure[i] = costs[0][1]
    return sure


def resample(pcm, lo, hi):
    """Lấy một khúc của file (22,05 kHz) và hạ xuống 16 kHz cho phần so khớp âm học."""
    part = pcm[max(0, int(lo * RATE)):int(hi * RATE)]
    step = RATE / acoustic.RATE
    return array.array("h", (part[int(i * step)] for i in range(int(len(part) / step))))


def run(n):
    lesson = json.loads((ROOT / "data" / "lessons" / f"{n:02d}.json").read_text())
    words = lesson["vocab"]
    segs, free, pcms = [], [], []
    for k, f in enumerate(lesson["audio"]["vocab"]):
        pcm = decode(ROOT / f)
        pcms.append(pcm)
        part = segments(pcm)
        segs += [(k, s, e) for s, e in part]
        free += [True] + [False] * (len(part) - 1)       # đoạn đầu mỗi file là câu giới thiệu
    # Đặc trưng âm học của từng đoạn tiếng thật và của tiếng tổng hợp từng từ.
    seg_feat = [acoustic.mfcc(resample(pcms[k], s - 0.05, e + 0.05)) for k, s, e in segs]
    word_feat = [acoustic.mfcc(acoustic.tts(v["hanzi"])) for v in words]
    dist = {(i, j): acoustic.dtw(word_feat[i], seg_feat[j])
            for i in range(len(words)) for j in range(i, min(len(segs), i + WINDOW + 1))}
    sure = align(dist, [e - s for _, s, e in segs], free, len(words))
    out_dir = ROOT / "audio" / "words" / f"{n:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.m4a"):
        old.unlink()
    index = {}
    with tempfile.TemporaryDirectory() as tmp:
        for i, j in sure.items():
            k, s, e = segs[j]
            pcm = pcms[k]
            # Lấy rộng ra hai bên cho khỏi cụt tiếng, nhưng không lấn sang đoạn bên cạnh.
            lo = max(s - 0.25, (segs[j - 1][2] + s) / 2 if j and segs[j - 1][0] == k else 0)
            hi = min(e + 0.35, (e + segs[j + 1][1]) / 2 if j + 1 < len(segs) and segs[j + 1][0] == k else len(pcm) / RATE)
            wav = Path(tmp) / "w.wav"
            with wave.open(str(wav), "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
                w.writeframes(pcm[int(lo * RATE):int(hi * RATE)].tobytes())
            dest = out_dir / f"{words[i]['n']:02d}.m4a"
            subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "64000", str(wav), str(dest)], check=True)
            index[str(words[i]["n"])] = str(dest.relative_to(ROOT))
    (ROOT / "data" / "audio-times").mkdir(exist_ok=True)
    (ROOT / "data" / "audio-times" / f"{n:02d}.json").write_text(json.dumps(index))
    unsure = [v["hanzi"] for i, v in enumerate(words) if i not in sure]
    shifts = sorted({sure[i] - i for i in sure})
    print(f"Bài {n:2d}: {len(segs)} đoạn tiếng, {len(words)} từ → cắt chắc chắn {len(index)}; độ lệch gặp {shifts}"
          + (f"; để giọng máy: {' '.join(unsure)}" if unsure else ""))


ids = sorted(int(f.stem) for f in (ROOT / "data" / "lessons").glob("[0-9][0-9].json"))
for n in (ids if sys.argv[1:] == ["all"] else [int(a) for a in sys.argv[1:]]):
    run(n)
