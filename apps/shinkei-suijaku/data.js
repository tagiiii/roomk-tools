/* 神経衰弱（試作）のデータ
   絵は Material Symbols（ふつうの絵）と、SVG で描く形（激ムズ）。絵文字は使わない */
window.SS_DATA = {
  /* むずかしさ。cols は PC の列の数、colsSp は 600px 以下の列の数 */
  levels: [
    { id: 'easy',   label: 'かんたん',   cards: 12, cols: 4, colsSp: 3, maxw: 520, kind: 'icon',  note: '12枚（6ペア）' },
    { id: 'normal', label: 'ふつう',     cards: 20, cols: 5, colsSp: 4, maxw: 640, kind: 'icon',  note: '20枚（10ペア）' },
    { id: 'hard',   label: 'むずかしい', cards: 30, cols: 6, colsSp: 5, maxw: 720, kind: 'icon',  note: '30枚（15ペア）' },
    { id: 'geki',   label: '激ムズ',     cards: 40, cols: 8, colsSp: 5, maxw: 960, kind: 'shape', note: '40枚（20ペア）。よく似た絵ばかり。形も数も同じカードがペア' }
  ],

  /* CPU の強さ。remember: めくられたカードを覚える割合 / usePair: 覚えているペアを取りにいく割合 */
  cpuLevels: [
    { id: 'weak',   label: 'よわい', remember: 0.3,  usePair: 0.5 },
    { id: 'normal', label: 'ふつう', remember: 0.65, usePair: 1 },
    { id: 'strong', label: 'つよい', remember: 1,    usePair: 1 }
  ],

  /* ふつうの絵（かんたん〜むずかしい）。この中からくじで選ぶ */
  icons: [
    { icon: 'pets',           label: '足あと',         color: '#8A5A2B' },
    { icon: 'cruelty_free',   label: 'うさぎ',         color: '#C2577A' },
    { icon: 'flutter_dash',   label: '鳥',             color: '#2F7FB7' },
    { icon: 'emoji_nature',   label: 'ハチと花',       color: '#C98A00' },
    { icon: 'icecream',       label: 'アイス',         color: '#D0679B' },
    { icon: 'cake',           label: 'ケーキ',         color: '#B5533C' },
    { icon: 'local_pizza',    label: 'ピザ',           color: '#D9822B' },
    { icon: 'bakery_dining',  label: 'クロワッサン',   color: '#A8742A' },
    { icon: 'sunny',          label: '太陽',           color: '#E08A00' },
    { icon: 'bedtime',        label: '月',             color: '#5B5FB5' },
    { icon: 'rocket_launch',  label: 'ロケット',       color: '#C0453F' },
    { icon: 'directions_car', label: '車',             color: '#2E8B6E' },
    { icon: 'train',          label: '電車',           color: '#3D6FB0' },
    { icon: 'sailing',        label: 'ヨット',         color: '#2A8CA8' },
    { icon: 'pedal_bike',     label: '自転車',         color: '#6B7A2A' },
    { icon: 'music_note',     label: '音符',           color: '#8B4FB0' },
    { icon: 'sports_soccer',  label: 'サッカーボール', color: '#3F3F46' },
    { icon: 'palette',        label: 'パレット',       color: '#B0562A' },
    { icon: 'umbrella',       label: 'かさ',           color: '#2F6FB7' },
    { icon: 'key',            label: 'かぎ',           color: '#9A7B00' },
    { icon: 'cottage',        label: '家',             color: '#A3523C' },
    { icon: 'park',           label: '木',             color: '#2E7D46' },
    { icon: 'local_florist',  label: '花',             color: '#C2476B' },
    { icon: 'anchor',         label: 'いかり',         color: '#35548C' },
    { icon: 'lightbulb',      label: '電球',           color: '#C99700' }
  ],

  /* 激ムズの絵。形 5つ × 数 1〜4 ＝ 20ペア。色は形ごとに決めてあり、色だけで見分ける所はない */
  shapes: [
    { id: 'circle',   label: '丸',     color: '#C8473F' },
    { id: 'triangle', label: '三角',   color: '#2E8B57' },
    { id: 'square',   label: '四角',   color: '#2F6FB7' },
    { id: 'star',     label: '星',     color: '#C98A00' },
    { id: 'heart',    label: 'ハート', color: '#A8459A' }
  ],
  shapeCounts: [1, 2, 3, 4]
};
