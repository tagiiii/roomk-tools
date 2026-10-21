#!/usr/bin/env python3
# 曲の速さ（BPM）と拍の位置を調べる（numpy なし）。
# ffmpeg で低い音（キック）と全体の音を取り出し、音の立ち上がりから拍の並びを当てはめる。
# 使い方: python3 -I scripts/pittari-beat/analyze.py <mp3> [予定のBPM]（ffmpeg が要る）
# 出た bpm_fit と first_beat_s を engine.js の TRACKS に書く
import array, json, math, subprocess, sys

path = sys.argv[1]
expect = float(sys.argv[2]) if len(sys.argv) > 2 else None
SR = 8000
HOP = 40  # 5ms


def decode(filt):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-af', filt, '-f', 's16le', '-'],
        check=True, capture_output=True).stdout
    a = array.array('h')
    a.frombytes(raw)
    return a


def envelope(a):
    env = []
    for i in range(0, len(a) - HOP, HOP):
        s = 0
        for v in a[i:i + HOP]:
            s += v * v
        env.append(math.log(1e-3 + s / HOP))
    return env


def onset(env):
    o = [0.0]
    for i in range(1, len(env)):
        d = env[i] - env[i - 1]
        o.append(d if d > 0 else 0.0)
    return o


low = onset(envelope(decode('lowpass=f=150,lowpass=f=150')))
full = onset(envelope(decode('highpass=f=20')))
n = min(len(low), len(full))
ons = [low[i] * 1.0 + full[i] * 0.5 for i in range(n)]
dur = n * HOP / SR

# 1) だいたいの速さ（自己相関）
best = None
for bpm10 in range(700, 1600, 5):
    lag = 60.0 / (bpm10 / 10) * SR / HOP
    l0 = int(lag)
    fr = lag - l0
    s = 0.0
    for i in range(n - l0 - 1):
        s += ons[i] * (ons[i + l0] * (1 - fr) + ons[i + l0 + 1] * fr)
    if best is None or s > best[0]:
        best = (s, bpm10 / 10)
rough = best[1]
if expect and abs(rough - expect) > 3:
    for mul in (2, 0.5, 1.5, 2 / 3, 0.75, 4 / 3):
        if abs(rough * mul - expect) < 3:
            rough = rough * mul


def peak_near(t, w=0.012):
    i0 = max(0, int((t - w) * SR / HOP))
    i1 = min(n - 1, int((t + w) * SR / HOP) + 1)
    return max(ons[i0:i1 + 1]) if i1 >= i0 else 0.0


# 2) 細かい速さと1拍目の位置（拍の並びに一番よく合うもの）
best = None
step = 0.01
b = rough - 1.5
while b <= rough + 1.5:
    period = 60.0 / b
    ph = 0.0
    while ph < period:
        s = 0.0
        t = ph
        while t < dur:
            s += peak_near(t)
            t += period
        if best is None or s > best[0]:
            best = (s, b, ph)
        ph += 0.005
    b += step
_, bpm, phase = best
period = 60.0 / bpm

# 3) 拍ごとに、近くの立ち上がりの位置を探してずれを見る
devs = []
strong = []
t = phase
k = 0
mean_on = sum(ons) / n
while t < dur - 0.05:
    i0 = max(0, int((t - 0.06) * SR / HOP))
    i1 = min(n - 1, int((t + 0.06) * SR / HOP))
    seg = ons[i0:i1 + 1]
    m = max(seg)
    j = seg.index(m)
    pt = (i0 + j) * HOP / SR
    if m > mean_on * 4:
        devs.append(pt - t)
        strong.append((k, pt))
    k += 1
    t += period

# 拍の位置を直線で当てはめて、実際の速さ（時間がたつと、ずれていくか）を見る
if len(strong) > 4:
    xs = [p[0] for p in strong]
    ys = [p[1] for p in strong]
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    icpt = my - slope * mx
    resid = [y - (icpt + slope * x) for x, y in zip(xs, ys)]
    fit_bpm = 60.0 / slope
    first = icpt
else:
    fit_bpm, first, resid = bpm, phase, []

# 音が鳴りはじめる時刻（全体の音量）
env_full = envelope(decode('highpass=f=20'))
mx_env = max(env_full)
start = next((i * HOP / SR for i, v in enumerate(env_full) if v > mx_env - 6), 0.0)
end = max((i * HOP / SR for i, v in enumerate(env_full) if v > mx_env - 6), default=dur)

abs_res = sorted(abs(r) for r in resid)
print(json.dumps({
    'file': path,
    'duration_s': round(dur, 2),
    'bpm_grid': round(bpm, 2),
    'bpm_fit': round(fit_bpm, 3),
    'first_beat_s': round(first, 3),
    'sound_start_s': round(start, 3),
    'loud_end_s': round(end, 2),
    'beats_checked': len(strong),
    'beats_total': k,
    'resid_median_ms': round(1000 * abs_res[len(abs_res) // 2], 1) if abs_res else None,
    'resid_p90_ms': round(1000 * abs_res[int(len(abs_res) * 0.9)], 1) if abs_res else None,
    'resid_max_ms': round(1000 * abs_res[-1], 1) if abs_res else None,
}, ensure_ascii=False))
