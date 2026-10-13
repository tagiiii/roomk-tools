"""KanjiVG の SVG から、よく見て漢字の kvg-data.js を作る。
使い方: python3 -I build.py <kvg-raw dir> <出力先 kvg-data.js>"""
import sys, os, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kvg

TARGETS = '密溶媒濃飽晶留沸融態粋換弥邪墳渡徳遣律租墾摂藤族鑑被裸珠房粉葉脈胞椎類乳節軟射屈折焦像虚振幅弾摩抗磁噴鉱深斑震微隆沈層積侵準凝頼幕護御執敗寇醍尊管勘琉戦'
SIMS = '蜜容浴謀農飯飼品貿隔熊能枠喚称雅憤度聴遺津祖粗組懇撮勝謄旅艦彼披課株殊扇紛蝶派抱砲泡推維浮筋転軸謝掘堀析集象虎虐娠唇福副禅磨魔航坑滋拡探班降枕僧増贈績浸寝准疑擬徴墓暮募獲穫卸街報熱販財冠提題遵館棺堪流硫'
ORIG = re.compile(r'kvg:(?:element|original)="([^"]+)"')

def groups(node):
    return [c for c in node['children'] if not isinstance(c, int)]

def label(node):
    # 名前のない入れ物が部品を1つだけ包んでいるときは、中の名前を使う
    while not node['el'] and len(groups(node)) == 1 and len(kvg.leaves(groups(node)[0])) == len(kvg.leaves(node)):
        node = groups(node)[0]
    if node['el']:
        return node['el']
    # 名前のない入れ物は、中の部品の名前をつないだものを名前にする（「徴」のまん中＝「山一王」など）。
    # にせものを選ぶとき、似た字の「ちがう所」が名前なしで落ちないようにするため
    return ''.join(label(c) for c in groups(node))

def split(node):
    out, run = [], []
    for c in node['children']:
        if isinstance(c, int):
            run.append(c)
            continue
        if run:
            out.append({'el': '', 'strokes': run, 'node': None}); run = []
        out.append({'el': label(c), 'strokes': kvg.leaves(c), 'node': c})
    if run:
        out.append({'el': '', 'strokes': run, 'node': None})
    return out

def splittable(p):
    return p['node'] is not None and len(split(p['node'])) > 1

def pieces_of(root):
    ps = split(root)
    while len(ps) == 1 and ps[0]['node'] is not None and groups(ps[0]['node']):
        ps = split(ps[0]['node'])
    def step(cond):
        cands = [p for p in ps if splittable(p) and cond(p)]
        if not cands: return False
        big = max(cands, key=lambda p: len(p['strokes']))
        i = ps.index(big); ps[i:i + 1] = split(big['node']); return True
    while len(ps) < 3 and step(lambda p: True): pass      # 部品は3つ以上にする
    while step(lambda p: len(p['strokes']) > 7): pass      # 大きすぎる部品は分ける
    return ps

raw, out = sys.argv[1], sys.argv[2]
data = {}
for ch in TARGETS + SIMS:
    text = open(os.path.join(raw, '%05x.svg' % ord(ch)), encoding='utf-8').read()
    root, strokes = kvg.parse(text)
    ps = pieces_of(root)
    assert sorted(i for p in ps for i in p['strokes']) == list(range(len(strokes))), ch
    body = text[text.index('kvg:StrokePaths_'):text.index('kvg:StrokeNumbers_')]
    data[ch] = {
        's': strokes,
        'p': [p['strokes'] for p in ps],
        'e': [p['el'] for p in ps],
        't': sorted(set(ORIG.findall(body))),
    }
    if ch in TARGETS:
        print(ch, len(strokes), ' '.join(f"{p['el'] or '・'}{len(p['strokes'])}" for p in ps))

header = """// =============================================
// よく見て漢字 — 字の画と部品のデータ
//
// KanjiVG (https://kanjivg.tagaini.net/) の筆順データから作った二次的なデータ。
// KanjiVG (c) Ulrich Apel。このファイルは Creative Commons 表示 - 継承 3.0
// (CC BY-SA 3.0, https://creativecommons.org/licenses/by-sa/3.0/) で提供する。
// もとのデータからの変更: 画のパスだけを取り出し、部品ごとの画の番号と部品の名前を足した。
//
// 手で直さない。字を足すときは AGENTS.md の「字のデータを作り直す」に従う。
//
// s : 画（書き順どおり。109×109 の枠の中の SVG パス）
// p : 部品ごとの画の番号
// e : 部品の名前（名前のない部品は空）
// t : この字にふくまれる部品の名前すべて（にせものの部品を選ぶときに使う）
// =============================================

export const KVG = """
with open(out, 'w', encoding='utf-8') as f:
    f.write(header + json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('},"', '},\n"') + ';\n')
print('wrote', out, os.path.getsize(out), 'bytes')
