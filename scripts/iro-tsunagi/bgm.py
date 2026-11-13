#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# いろつなぎの音楽を ElevenLabs（Music）で作り、apps/iro-tsunagi/bgm/play.mp3 に置く（すとんブロックの bgm.py と同じ作り。曲の文だけちがう）。
# キーは ~/.config/elevenlabs/key から読み、表示しない。有料なので、作る前にオーナーの承認を取る。
# 使い方: python3 scripts/iro-tsunagi/bgm.py <作業フォルダ>   （作業フォルダに元の音 raw/play.mp3 を残す。作りなおすときはそれを消す）
# 作った音は、頭の無音を切り、長さを KEEP 秒にそろえ、はじめと終わりをフェードにして（くり返しのつなぎ目が目立たないように）、
# 大きさを小さめにそろえた mp3 にする（ffmpeg）。アプリでは <audio> で流しながら鳴らす（全部をメモリに広げない）。
import json, os, subprocess, sys, urllib.request, urllib.error

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, 'apps', 'iro-tsunagi', 'bgm')

# 着想元のゲームの曲・よく知られた曲には寄せない（名前も出さない）。歌なし
PROMPT = ('Original instrumental background music for a gentle color-matching puzzle game for children. '
          'Cheerful, playful and bubbly, medium-fast tempo about 124 BPM, major key. Bright celesta and glockenspiel melody, '
          'soft ukulele strums, round warm bass and light shaker and handclap-free soft percussion. Steady groove with an even volume '
          'from start to end, no intro build-up, no drops, no sudden loud hits, no vocals, no sound effects. '
          'Friendly and calm enough to play quietly in the background for a long time, designed to loop.')
LENGTH = 80   # 作る長さ（秒）
KEEP = 78.0   # 残す長さ（秒）
FADE_IN = 0.3
FADE_OUT = 2.5
LOUD = -30    # 大きさ（LUFS）。効果音より小さく聞こえるように、ファイルの中で小さくしておく（iOS は <audio> の音量を変えられない）
NORM = -18    # いちど この大きさにそろえてから、LOUD まで下げる（loudnorm は上限 -9dBTP より小さくできないため）


def generate(key, raw):
    body = json.dumps({'prompt': PROMPT, 'music_length_ms': LENGTH * 1000, 'model_id': 'music_v1',
                       'force_instrumental': True}).encode()
    req = urllib.request.Request(
        'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',
        data=body, headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=600) as res:
            data = res.read()
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.read()[:400].decode('utf-8', 'replace'))
        return False
    with open(raw, 'wb') as f:
        f.write(data)
    return True


def finish(raw):
    out = os.path.join(OUT, 'play.mp3')
    af = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0,'
          'atrim=0:%.3f,loudnorm=I=%d:TP=-2:LRA=7,volume=%ddB,'
          'afade=t=in:st=0:d=%.3f,afade=t=out:st=%.3f:d=%.3f') % (KEEP, NORM, LOUD - NORM, FADE_IN, KEEP - FADE_OUT, FADE_OUT)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', af, '-ac', '2', '-ar', '44100',
                    '-b:a', '96k', out], check=True)
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit('使い方: bgm.py <作業フォルダ>')
    raw_dir = os.path.join(sys.argv[1], 'raw')
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    raw = os.path.join(raw_dir, 'play.mp3')
    if not os.path.exists(raw):
        with open(os.path.expanduser('~/.config/elevenlabs/key')) as f:
            key = f.read().strip()
        if not generate(key, raw):
            sys.exit(1)
    out = finish(raw)
    print('play', os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
