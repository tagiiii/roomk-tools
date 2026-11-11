#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# すとんブロックの効果音を ElevenLabs（Sound Effects）で作り、apps/suton-block/sfx/{名前}.mp3 に置く。
# キーは ~/.config/elevenlabs/key から読み、表示しない。有料なので、作る前にオーナーの承認を取る。
# 使い方: python3 scripts/suton-block/sfx.py <作業フォルダ> [名前 ...]   （名前を省くと全部。作業フォルダに元の音 raw/ を残す）
# 作った音は、頭の無音を切り、長さを KEEP 秒にそろえ（終わりはフェード）、大きさをそろえて、モノラルの mp3 にする（ffmpeg）。
import json, os, subprocess, sys, urllib.request, urllib.error

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, 'apps', 'suton-block', 'sfx')

# 名前: (頼む文, 作る長さ[秒・0.5以上], 残す長さ[秒])
SOUNDS = {
    'move':     ('Single tiny soft wooden tick, puzzle game cursor move, very short, dry, no reverb', 0.5, 0.10),
    'rotate':   ('Short crisp light swish with a soft click, puzzle game piece rotating, dry, no reverb', 0.5, 0.18),
    'hold':     ('Soft gentle two-note pop, puzzle game swapping a piece into storage, short, friendly', 0.5, 0.32),
    'place':    ('Soft low wooden tap, a small puzzle block gently landing, short, dry, no reverb', 0.5, 0.20),
    'drop':     ('Solid low soft thud, a wooden puzzle block dropped firmly into place, short, dry, no reverb', 0.5, 0.30),
    # 段を消した音は、この1音を段の数だけ高さを変えて重ねる（生成では音の数が指定どおりにならなかった）
    'ding':     ('One single clean bright glockenspiel note, exactly one note, game reward ding, dry', 0.5, 0.50),
    'allclear': ('Gentle magical sparkling upward glissando with soft bell shimmer, puzzle game perfect clear, friendly, not loud', 1.8, 1.80),
    'spin':     ('Quick light magical twinkle rising upward, puzzle game special move, short and soft', 0.6, 0.55),
    'send':     ('Short soft airy whoosh, something small flying away quickly, no impact', 0.5, 0.40),
    'jamain':   ('Two soft muted low drum thumps, gentle notice in a puzzle game, not scary, short', 0.6, 0.50),
    'jamaup':   ('Short low soft rumble, heavy stone blocks sliding up from below, muted, not scary', 0.7, 0.60),
    # カウントダウンとはじまりの音は合成音のまま（生成だと1つの澄んだ音にならなかった）
    'finish':   ('Gentle calm three-note marimba jingle, time is up in a friendly puzzle game, soft ending', 1.3, 1.30),
}


def generate(key, name, raw_dir):
    text, dur, _keep = SOUNDS[name]
    body = json.dumps({'text': text, 'duration_seconds': dur, 'prompt_influence': 0.8 if name == 'ding' else 0.6}).encode()
    req = urllib.request.Request(
        'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128',
        data=body, headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            data = res.read()
    except urllib.error.HTTPError as e:
        print(name, 'HTTP', e.code, e.read()[:300].decode('utf-8', 'replace'))
        return None
    path = os.path.join(raw_dir, name + '.mp3')
    with open(path, 'wb') as f:
        f.write(data)
    return path


def finish(name, raw):
    keep = SOUNDS[name][2]
    fade = min(0.08, keep / 2)
    out = os.path.join(OUT, name + '.mp3')
    cut = ('silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0,'
           'atrim=0:%.3f,afade=t=out:st=%.3f:d=%.3f') % (keep, keep - fade, fade)
    # いちばん大きい所を -3dB にそろえる（音ごとの大きさは app.js の SFX_FILES で決める）
    probe = subprocess.run(['ffmpeg', '-v', 'info', '-i', raw, '-af', cut + ',volumedetect', '-f', 'null', '-'],
                           capture_output=True, text=True).stderr
    peak = float(probe.split('max_volume:')[1].split('dB')[0])
    af = cut + ',volume=%.1fdB' % (-3.0 - peak)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', af, '-ac', '1', '-ar', '44100',
                    '-b:a', '96k', out], check=True)
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit('使い方: sfx.py <作業フォルダ> [名前 ...]')
    work = sys.argv[1]
    names = sys.argv[2:] or list(SOUNDS)
    raw_dir = os.path.join(work, 'raw')
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.expanduser('~/.config/elevenlabs/key')) as f:
        key = f.read().strip()
    for name in names:
        # 元の音が作業フォルダに残っていれば作りなおさない（作りなおすときは raw/{名前}.mp3 を消す）
        raw = os.path.join(raw_dir, name + '.mp3')
        if not os.path.exists(raw):
            raw = generate(key, name, raw_dir)
        if not raw:
            continue
        out = finish(name, raw)
        print(name, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
