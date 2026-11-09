#!/usr/bin/env python3
"""サークルタイム（試作）の表紙・目次・案内の絵を fal（Recraft V3・手描き風）で作る。
ツール一覧の絵（scripts/illustrations/generate.py）と同じ絵柄・同じ決まり（人・顔・手・文字・数字を描かない）。
使い方（リポジトリのルートで）: FAL_KEY=... python3 scripts/circle-time/illustrations.py [key ...]
できた絵は apps/circle-time/assets/{key}.webp（400px）。1枚 約0.04ドル。できた絵は必ず目で確かめる。"""
import io, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'apps', 'circle-time', 'assets')
ENDPOINT = 'https://fal.run/fal-ai/recraft/v3/text-to-image'
STYLE = ('Warm hand-drawn picture book illustration with soft crayon and colored pencil texture, gentle colors, cheerful and friendly for children. '
         'Isolated objects only: no people, no human faces, no hands, no text, no letters, no numbers. '
         'The whole object group is small, fully visible and centered, with a wide empty margin on all four sides; nothing touches or crosses the edges. Plain light background.')
AM = ('#F2B35C', '#8A5A12'); PM = ('#E8907B', '#9E4631')
ITEMS = {
  'opening-am': ('a rising morning sun over soft round hills, with a circle of floor cushions on a cozy rug', AM),
  'opening-pm': ('a soft orange afternoon sun above a round cozy rug with a few round floor cushions and a small potted plant, objects only, no chairs', PM),
  'free': ('one small stack of three picture books and a mug of cocoa on a tiny round rug, small and centered with lots of empty space around, objects only, no furniture, no characters', AM),
  'kokoro': ('a big soft heart shape with tiny sparkles around it', AM),
  'karada': ('a pair of sneakers, a water bottle and a rolled stretching mat', AM),
  'weather': ('a cheerful fluffy cloud with the sun peeking from behind, a small umbrella and a few raindrops', AM),
  'day': ('a tear-off desk calendar with a completely blank page, a ribbon bow and a little confetti', AM),
  'program': ('a cork board with blank colorful sticky notes and round pins, and a small alarm clock', AM),
  'talk': ('two small colorful speech bubbles side by side, plain blank shapes without faces, a tiny heart between them, small and centered with lots of empty space around', PM),
  'review': ('an open notebook with blank pages, a pencil and a little star sticker', PM),
  'game': ('board game pieces: a die, colorful round tokens and a small spinner', PM),
  'adhoc': ('a single round glowing light bulb with a simple coil filament and small sparkles around it, objects only', AM),
  'closing-am': ('a winding garden path with small wooden signposts holding blank arrow signs, leading to colorful doors', AM),
  'omakase': ('a small wrapped gift box with a ribbon and a die beside it, with tiny sparkles, small and centered with lots of empty space around', AM),
  'closing-pm': ('a welcoming entrance with an open front door, a doormat and a coat rack', PM),
}
def rgb(h): h = h.lstrip('#'); return {'r': int(h[0:2], 16), 'g': int(h[2:4], 16), 'b': int(h[4:6], 16)}
def make(key, key_env):
    prompt, (c, ink) = ITEMS[key]
    body = {'prompt': prompt + '. ' + STYLE, 'image_size': 'square_hd', 'style': 'digital_illustration/hand_drawn', 'colors': [rgb(c), rgb(ink)]}
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), headers={'Authorization': 'Key ' + key_env, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r: url = json.load(r)['images'][0]['url']
    with urllib.request.urlopen(url, timeout=120) as r: data = r.read()
    Image.open(io.BytesIO(data)).convert('RGB').resize((400, 400), Image.LANCZOS).save(os.path.join(OUT, key + '.webp'), 'WEBP', quality=80)
    return key
if __name__ == '__main__':
    k = os.environ.get('FAL_KEY') or sys.exit('FAL_KEY がありません')
    keys = sys.argv[1:] or list(ITEMS)
    os.makedirs(OUT, exist_ok=True)
    bad = 0
    with ThreadPoolExecutor(4) as ex:
        for f in [ex.submit(make, x, k) for x in keys]:
            try: print('ok', f.result())
            except Exception as e: bad += 1; print('NG', e)
    sys.exit(1 if bad else 0)
