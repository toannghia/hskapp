"""So khớp âm học giữa hai đoạn tiếng nói (MFCC + DTW), viết bằng Python thuần để không phải cài thêm gì.
Dùng cho tools/word_clips.py: so từng đoạn tiếng trong file đọc bảng từ với tiếng tổng hợp của từng từ
(lệnh say của macOS, giọng Tingting) để biết đoạn nào là từ nào. Thử trên bài 1 (đã biết đáp án): đúng 38/38."""
import array
import cmath
import math
import subprocess
import tempfile
import wave
from pathlib import Path

RATE, NFFT, WIN, HOP, NMEL, NCEP = 16000, 512, 400, 240, 24, 12

def decode(path, rate=RATE):
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "v.wav"
        subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{rate}", "-c", "1", str(path), str(wav)], check=True)
        w = wave.open(str(wav)); return array.array("h", w.readframes(w.getnframes()))

def fft(a):
    n = len(a)
    if n == 1: return a
    e, o = fft(a[0::2]), fft(a[1::2])
    out = [0] * n
    for k in range(n // 2):
        t = TW[n][k] * o[k]
        out[k], out[k + n // 2] = e[k] + t, e[k] - t
    return out
TW = {n: [cmath.exp(-2j * math.pi * k / n) for k in range(n // 2)] for n in (2, 4, 8, 16, 32, 64, 128, 256, 512)}
HAM = [0.54 - 0.46 * math.cos(2 * math.pi * i / (WIN - 1)) for i in range(WIN)]
def mel(f): return 2595 * math.log10(1 + f / 700)
def build_fb():
    lo, hi = mel(100), mel(6000)
    pts = [700 * (10 ** ((lo + (hi - lo) * i / (NMEL + 1)) / 2595) - 1) for i in range(NMEL + 2)]
    bins = [int(p * NFFT / RATE) for p in pts]
    fb = []
    for m in range(1, NMEL + 1):
        row = []
        for k in range(bins[m - 1], bins[m + 1] + 1):
            if k < bins[m]: wgt = (k - bins[m - 1]) / max(1, bins[m] - bins[m - 1])
            else: wgt = (bins[m + 1] - k) / max(1, bins[m + 1] - bins[m])
            if wgt > 0: row.append((k, wgt))
        fb.append(row)
    return fb
FB = build_fb()
DCT = [[math.cos(math.pi * c * (m + 0.5) / NMEL) for m in range(NMEL)] for c in range(1, NCEP + 1)]

def trim(pcm):
    """Bỏ khoảng lặng hai đầu."""
    win = 160; rms = [math.sqrt(sum(x * x for x in pcm[i:i + win]) / win) for i in range(0, len(pcm) - win, win)]
    if not rms: return pcm
    thr = max(rms) * 0.08
    idx = [i for i, r in enumerate(rms) if r > thr]
    return pcm[max(0, idx[0] - 2) * win:(idx[-1] + 3) * win] if idx else pcm

def mfcc(pcm):
    pcm = trim(pcm); frames = []
    for s in range(0, len(pcm) - WIN, HOP):
        buf = [(pcm[s + i] - 0.97 * pcm[s + i - 1] if s + i else pcm[0]) * HAM[i] for i in range(WIN)] + [0.0] * (NFFT - WIN)
        spec = fft(buf)
        power = [abs(spec[k]) ** 2 for k in range(NFFT // 2 + 1)]
        logm = [math.log(sum(power[k] * w for k, w in row) + 1e-3) for row in FB]
        frames.append([sum(d[m] * logm[m] for m in range(NMEL)) for d in DCT])
    if not frames: return frames
    mean = [sum(f[c] for f in frames) / len(frames) for c in range(NCEP)]
    sd = [math.sqrt(sum((f[c] - mean[c]) ** 2 for f in frames) / len(frames)) or 1 for c in range(NCEP)]
    return [[(f[c] - mean[c]) / sd[c] for c in range(NCEP)] for f in frames]

def dtw(a, b):
    n, m = len(a), len(b)
    if not n or not m: return 9.0
    band = max(abs(n - m) + 3, int(0.35 * max(n, m)))
    INF = float("inf"); prev = [INF] * (m + 1); prev[0] = 0
    for i in range(1, n + 1):
        cur = [INF] * (m + 1); ai = a[i - 1]
        for j in range(max(1, i * m // n - band), min(m, i * m // n + band) + 1):
            bj = b[j - 1]
            d = math.sqrt(sum((ai[c] - bj[c]) ** 2 for c in range(NCEP)))
            cur[j] = d + min(prev[j], prev[j - 1], cur[j - 1])
        prev = cur
    return prev[m] / (n + m)

def tts(word, voice="Tingting"):
    """Tiếng tổng hợp của một từ. Lệnh say thỉnh thoảng bị treo, nên có giới hạn thời gian và thử lại;
    vẫn hỏng thì trả về rỗng (từ đó sẽ không được cắt)."""
    for _ in range(3):
        with tempfile.TemporaryDirectory() as tmp:
            aiff = Path(tmp) / "t.aiff"
            try:
                subprocess.run(["say", "-v", voice, "-o", str(aiff), word], check=True, timeout=20)
                return decode(aiff)
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
                continue
    return array.array("h")

