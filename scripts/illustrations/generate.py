#!/usr/bin/env python3
"""ツール一覧のカードのイラストを fal（Recraft V3・手描き風）で作る。

使い方（リポジトリのルートで）:
    FAL_KEY=... python3 scripts/illustrations/generate.py {app} [{app} ...]

- 絵の中身は scripts/illustrations/prompts.json の {app} の文（英語）。新しいツールは先にここへ足す。
- 色は apps/index.html のカードの data-genre から、その種類の色を2つ渡す（GENRE_COLORS）。
- できた絵は 400px の webp にして apps/assets/illustrations/{app}.webp に書く（上書きする）。
  1枚でも失敗したら終了コード 1 で終わる。
- 1枚ごとに fal の料金がかかる（2026-11 時点で約 0.04 ドル）。
- 決まり（人・顔・手・文字・数字を描かない、着想元のゲームに似せない）は指示に入れてあるが、
  守られないことがある。できた絵は必ず1枚ずつ目で確かめ、合わないものは文を直して作りなおす。
  詳しくは docs/development/illustrations.md。

必要なもの: 環境変数 FAL_KEY、Python 3 と Pillow（webp の書き出しに使う）。
"""
import io
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PROMPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prompts.json')
OUT_DIR = os.path.join(ROOT, 'apps', 'assets', 'illustrations')
ENDPOINT = 'https://fal.run/fal-ai/recraft/v3/text-to-image'
SIZE = 400

# apps/index.html の [data-genre] の --g と --g-ink（色を変えたらここも変える）
GENRE_COLORS = {
    'kotoba': ('#F0A04B', '#9A4D00'),
    'puzzle': ('#5B9BE6', '#1D5799'),
    'suiri': ('#9C7BDB', '#5B3797'),
    'atekko': ('#4CB884', '#1D6B45'),
    'board': ('#E8707B', '#A3303C'),
    'talk': ('#E07BAA', '#9E2F63'),
}

STYLE_SUFFIX = (
    'Warm hand-drawn picture book illustration with soft crayon and colored pencil texture, '
    'gentle colors, cheerful and friendly for children. '
    'Isolated objects only: no people, no human faces, no hands, no text, no letters, no numbers. '
    'The whole object group is small, fully visible and centered, with a wide empty margin on all four sides; '
    'nothing touches or crosses the edges. Plain light background.'
)


def rgb(hex_color):
    h = hex_color.lstrip('#')
    return {'r': int(h[0:2], 16), 'g': int(h[2:4], 16), 'b': int(h[4:6], 16)}


def card_genres():
    html = open(os.path.join(ROOT, 'apps', 'index.html'), encoding='utf-8').read()
    genres = {}
    for tag in re.findall(r'<a class="app-card"[^>]*>', html):
        app = re.search(r'href="([^"/]+)/"', tag)
        genre = re.search(r'data-genre="([^"]+)"', tag)
        if app and genre:
            genres[app.group(1)] = genre.group(1)
    return genres


def generate(app, prompt, genre, key):
    color, ink = GENRE_COLORS[genre]
    body = {
        'prompt': prompt + '. ' + STYLE_SUFFIX,
        'image_size': 'square_hd',
        'style': 'digital_illustration/hand_drawn',
        'colors': [rgb(color), rgb(ink)],
    }
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={'Authorization': 'Key ' + key, 'Content-Type': 'application/json'},
    )
    result = json.load(urllib.request.urlopen(req, timeout=240))
    data = urllib.request.urlopen(result['images'][0]['url'], timeout=120).read()
    image = Image.open(io.BytesIO(data)).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    path = os.path.join(OUT_DIR, app + '.webp')
    # 書き出しの途中で止まっても、確かめ済みの前の絵をこわさない
    tmp = path + '.tmp'
    image.save(tmp, 'WEBP', quality=80, method=6)
    Image.open(tmp).verify()
    os.replace(tmp, path)
    return '%s: %s (%dKB)' % (app, os.path.relpath(path, ROOT), os.path.getsize(path) // 1024)


def main():
    apps = list(dict.fromkeys(sys.argv[1:]))  # 同じ名前を2回書いても1回だけ作る
    if not apps:
        sys.exit(__doc__)
    key = os.environ.get('FAL_KEY')
    if not key:
        sys.exit('FAL_KEY が設定されていません')
    prompts = json.load(open(PROMPTS, encoding='utf-8'))
    genres = card_genres()
    for app in apps:
        if app not in prompts:
            sys.exit('%s の文が prompts.json にありません' % app)
        if genres.get(app) not in GENRE_COLORS:
            sys.exit('%s のカード（data-genre）が apps/index.html にありません' % app)
    os.makedirs(OUT_DIR, exist_ok=True)

    def run(app):
        try:
            return True, generate(app, prompts[app], genres[app], key)
        except Exception as error:  # 1枚の失敗でほかを止めない
            return False, '%s: 失敗 %s' % (app, error)

    failed = 0
    with ThreadPoolExecutor(6) as pool:
        for ok, line in pool.map(run, apps):
            print(line, flush=True)
            failed += 0 if ok else 1
    if failed:
        sys.exit('%d 枚が失敗しました（前の絵はそのまま残っています）' % failed)


if __name__ == '__main__':
    main()
