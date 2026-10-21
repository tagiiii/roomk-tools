#!/usr/bin/env python3
# ElevenLabs で曲を作る。キーは ~/.config/elevenlabs/key から読み、表示しない。
# 使い方（リポジトリのルートで）: python3 -I scripts/pittari-beat/compose.py <出力>.mp3 <長さ(ms)> scripts/pittari-beat/prompts/prompt-<曲>.txt
# 候補の出力先はリポジトリの外（作業用の一時フォルダ）にし、選んだ曲だけを apps/pittari-beat/music/ に置く
# 有料（音楽は1分あたり約900字）。作る前にオーナーの承認をもらう
import json, os, sys, urllib.request, urllib.error

out, length_ms, prompt_file = sys.argv[1], int(sys.argv[2]), sys.argv[3]
with open(os.path.expanduser('~/.config/elevenlabs/key')) as f:
    key = f.read().strip()
with open(prompt_file) as f:
    prompt = f.read().strip()

body = json.dumps({
    'prompt': prompt,
    'music_length_ms': length_ms,
    'force_instrumental': True,
}).encode('utf-8')
req = urllib.request.Request(
    'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',
    data=body, method='POST',
    headers={'xi-api-key': key, 'Content-Type': 'application/json'},
)
try:
    with urllib.request.urlopen(req, timeout=300) as res:
        data = res.read()
        ctype = res.headers.get('Content-Type', '')
except urllib.error.HTTPError as e:
    print('HTTP', e.code, e.read().decode('utf-8', 'replace')[:800])
    sys.exit(1)
if not ctype.startswith('audio') and not data[:3] in (b'ID3', b'\xff\xfb', b'\xff\xf3'):
    print('音声ではない応答:', ctype, data[:300])
    sys.exit(1)
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'wb') as f:
    f.write(data)
print('保存:', out, len(data), 'bytes')
