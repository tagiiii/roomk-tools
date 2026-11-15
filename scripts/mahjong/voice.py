#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 麻雀の声（ロン・ツモ・ポン・チー・カン・リーチ）を ElevenLabs（Text to Speech）で作り、apps/mahjong/sfx/{名前}.mp3 に置く。
# キーは ~/.config/elevenlabs/key から読み、表示しない（キーに text_to_speech の権限が要る）。有料なので、作る前にオーナーの承認を取る。
# 使い方: python3 scripts/mahjong/voice.py <作業フォルダ> [名前 ...]   （名前を省くと全部。作業フォルダに元の音 raw/ を残す）
# 声は VOICE の1人で、全部そろえる。作った声は、前後の無音を切り、大きさをそろえて、モノラルの mp3 にする（ffmpeg）。
import json, os, subprocess, sys, urllib.request, urllib.error

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, 'apps', 'mahjong', 'sfx')
VOICE = os.environ.get('MJ_VOICE', 'cgSgspJ2msm6clMCkdW9')   # ElevenLabs の用意している声（明るい声）
MODEL = 'eleven_multilingual_v2'

# 名前: 読む文
VOICES = {
    'v-ron': 'ロン！',
    'v-tsumo': 'ツモ！',
    'v-pon': 'ポン！',
    'v-chi': 'チー！',
    'v-kan': 'カン！',
    'v-riichi': 'リーチ！',
}


def generate(key, name, raw_dir):
    body = json.dumps({'text': VOICES[name], 'model_id': MODEL,
                       'voice_settings': {'stability': 0.4, 'similarity_boost': 0.75, 'style': 0.5}}).encode()
    req = urllib.request.Request(
        'https://api.elevenlabs.io/v1/text-to-speech/' + VOICE + '?output_format=mp3_44100_128',
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
    out = os.path.join(OUT, name + '.mp3')
    # 前後の無音を切る（うしろは、反転して頭を切ってもどす）
    trim = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0,areverse,'
            'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse')
    probe = subprocess.run(['ffmpeg', '-v', 'info', '-i', raw, '-af', trim + ',volumedetect', '-f', 'null', '-'],
                           capture_output=True, text=True).stderr
    peak = float(probe.split('max_volume:')[1].split('dB')[0])
    af = trim + ',volume=%.1fdB' % (-3.0 - peak)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', af, '-ac', '1', '-ar', '44100',
                    '-b:a', '96k', out], check=True)
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit('使い方: voice.py <作業フォルダ> [名前 ...]')
    work = sys.argv[1]
    names = sys.argv[2:] or list(VOICES)
    raw_dir = os.path.join(work, 'raw')
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.expanduser('~/.config/elevenlabs/key')) as f:
        key = f.read().strip()
    for name in names:
        raw = os.path.join(raw_dir, name + '.mp3')
        if not os.path.exists(raw):
            raw = generate(key, name, raw_dir)
        if not raw:
            continue
        out = finish(name, raw)
        print(name, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
