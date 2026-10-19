// しるしでヒントのアイコンとお題（2026-10-19 オーナーがこの中身で確定）。
// ルームではお題を番号で、アイコンを id で共有するので、お題の並べ替え・途中の削除と、アイコンの id の変更はしない。
// お題の追加は末尾だけ。新しいお題・アイコンを本体に入れるのはオーナーが決める（ルート AGENTS.md）

// アイコンのまとまり。id が 'nakama' のまとまりは「何の仲間？」。アイコンは Material Symbols Rounded の名前、色は丸で出す
export const ICON_GROUPS = [
  {
    id: 'nakama', name: '何の仲間？',
    icons: [
      { id: 'animal', label: '動物', icon: 'pets' },
      { id: 'bird', label: '鳥', icon: 'flutter_dash' },
      { id: 'fish', label: '魚', icon: 'set_meal' },
      { id: 'bug', label: '虫', icon: 'bug_report' },
      { id: 'plant', label: '植物', icon: 'local_florist' },
      { id: 'food', label: '食べ物', icon: 'restaurant' },
      { id: 'drink', label: '飲み物', icon: 'local_cafe' },
      { id: 'ride', label: '乗り物', icon: 'directions_car' },
      { id: 'tool', label: '道具', icon: 'build' },
      { id: 'building', label: '建物', icon: 'home' },
      { id: 'toy', label: 'おもちゃ', icon: 'extension' },
      { id: 'sport', label: 'スポーツ', icon: 'sports_soccer' },
      { id: 'music', label: '音楽', icon: 'music_note' },
      { id: 'sky', label: '空・天気', icon: 'partly_cloudy_day' },
      { id: 'clothes', label: '服', icon: 'checkroom' },
      { id: 'game', label: 'ゲーム', icon: 'sports_esports' },
      { id: 'machine', label: '機械', icon: 'settings' },
      { id: 'screen', label: '画面', icon: 'tv' },
      { id: 'snack', label: 'おかし', icon: 'cookie' },
      { id: 'leaf', label: '葉っぱ', icon: 'eco' },
    ],
  },
  {
    id: 'color', name: '色',
    icons: [
      { id: 'white', label: '白', color: '#FFFFFF' },
      { id: 'black', label: '黒', color: '#1A1A1A' },
      { id: 'red', label: '赤', color: '#E03131' },
      { id: 'blue', label: '青', color: '#1C7ED6' },
      { id: 'yellow', label: '黄色', color: '#FAB005' },
      { id: 'green', label: '緑', color: '#2F9E44' },
      { id: 'brown', label: '茶色', color: '#8D5524' },
      { id: 'pink', label: 'ピンク', color: '#F783AC' },
      { id: 'orange', label: 'オレンジ', color: '#F76707' },
      { id: 'purple', label: '紫', color: '#7048E8' },
      { id: 'gray', label: '灰色', color: '#8A8F98' },
      { id: 'skyblue', label: '水色', color: '#74C0FC' },
    ],
  },
  {
    id: 'shape', name: '形・大きさ',
    icons: [
      { id: 'round', label: '丸い', icon: 'circle' },
      { id: 'square', label: '四角い', icon: 'square' },
      { id: 'triangle', label: '三角', icon: 'change_history' },
      { id: 'long', label: '長い', icon: 'straighten' },
      { id: 'big', label: '大きい', icon: 'open_in_full' },
      { id: 'small', label: '小さい', icon: 'close_fullscreen' },
      { id: 'tall', label: '高い', icon: 'height' },
      { id: 'grainy', label: 'つぶつぶ', icon: 'grain' },
      { id: 'thin', label: '細い', icon: 'horizontal_rule' },
    ],
  },
  {
    id: 'move', name: 'ようす・動き',
    icons: [
      { id: 'fly', label: '飛ぶ', icon: 'flight' },
      { id: 'water', label: '水', icon: 'water_drop' },
      { id: 'run', label: '走る', icon: 'directions_run' },
      { id: 'fast', label: '速い', icon: 'speed' },
      { id: 'hot', label: '熱い', icon: 'local_fire_department' },
      { id: 'cold', label: '冷たい', icon: 'ac_unit' },
      { id: 'shine', label: '光る', icon: 'lightbulb' },
      { id: 'sound', label: '音が出る', icon: 'volume_up' },
      { id: 'sweet', label: '甘い', icon: 'cake' },
      { id: 'electric', label: '電気', icon: 'electric_bolt' },
      { id: 'spin', label: '回る', icon: 'autorenew' },
      { id: 'float', label: '浮かぶ', icon: 'air' },
      { id: 'see', label: '見る', icon: 'visibility' },
      { id: 'time', label: '時間', icon: 'schedule' },
      { id: 'cook', label: '料理', icon: 'cooking' },
      { id: 'swim', label: '泳ぐ', icon: 'pool' },
    ],
  },
  {
    id: 'place', name: '場所・とき',
    icons: [
      { id: 'sea', label: '海', icon: 'waves' },
      { id: 'mountain', label: '山', icon: 'landscape' },
      { id: 'cloud', label: '空', icon: 'cloud' },
      { id: 'town', label: '町', icon: 'location_city' },
      { id: 'night', label: '夜', icon: 'dark_mode' },
      { id: 'summer', label: '夏', icon: 'sunny' },
      { id: 'forest', label: '森', icon: 'forest' },
      { id: 'indoor', label: '家の中', icon: 'chair' },
      { id: 'winter', label: '冬', icon: 'weather_snowy' },
      { id: 'rain', label: '雨', icon: 'rainy' },
      { id: 'park', label: '公園', icon: 'park' },
    ],
  },
];

// お題。番号で共有する（並べ替え・途中の削除をしない。追加は末尾だけ）
export const TOPICS = [
  'ハチ', 'ネコ', 'イヌ', 'ペンギン', 'ゾウ', 'キリン', 'ウサギ', 'カエル', 'クジラ', 'パンダ',
  'ニワトリ', 'チョウ', 'バナナ', 'リンゴ', 'スイカ', 'おにぎり', 'ラーメン', 'アイスクリーム', 'たまご', 'カレーライス',
  'ハンバーガー', '自転車', '飛行機', '船', '電車', 'ロケット', '消防車', 'ひまわり', 'サボテン', '雪だるま',
  '虹', '太陽', '月', 'かさ', 'はさみ', '風船', 'サッカーボール', 'ピアノ', 'かき氷', 'ホタル',
  'ライオン', 'サル', 'ウマ', 'ブタ', 'カメ', 'タコ', 'イルカ', 'フクロウ', 'カタツムリ', 'カブトムシ',
  'トンボ', 'ピザ', 'ドーナツ', 'パン', 'いちご', 'ブドウ', 'トマト', 'ニンジン', 'みかん', 'ケーキ',
  'すし', 'ポップコーン', 'バス', 'ヘリコプター', '新幹線', 'トラック', '気球', 'パトカー', 'ヨット', '雪',
  '雲', '星', '花火', '木', 'キノコ', '海', '山', '時計', 'めがね', 'ぼうし',
  'くつ', 'カメラ', 'テレビ', 'ギター', '電話', 'かがみ', 'なべ', '冷蔵庫', '電球',
];

// お題のなかま。当てる人に並べる候補を、お題と同じなかまで多めにそろえるために使う。どのお題もどれか1つに入れる
export const TOPIC_KINDS = {
  creature: ['ハチ', 'ネコ', 'イヌ', 'ペンギン', 'ゾウ', 'キリン', 'ウサギ', 'カエル', 'クジラ', 'パンダ', 'ニワトリ', 'チョウ', 'ホタル', 'ライオン', 'サル', 'ウマ', 'ブタ', 'カメ', 'タコ', 'イルカ', 'フクロウ', 'カタツムリ', 'カブトムシ', 'トンボ'],
  food: ['バナナ', 'リンゴ', 'スイカ', 'おにぎり', 'ラーメン', 'アイスクリーム', 'たまご', 'カレーライス', 'ハンバーガー', 'かき氷', 'ピザ', 'ドーナツ', 'パン', 'いちご', 'ブドウ', 'トマト', 'ニンジン', 'みかん', 'ケーキ', 'すし', 'ポップコーン'],
  ride: ['自転車', '飛行機', '船', '電車', 'ロケット', '消防車', 'バス', 'ヘリコプター', '新幹線', 'トラック', '気球', 'パトカー', 'ヨット'],
  nature: ['ひまわり', 'サボテン', '雪だるま', '虹', '太陽', '月', '雪', '雲', '星', '花火', '木', 'キノコ', '海', '山'],
  thing: ['かさ', 'はさみ', '風船', 'サッカーボール', 'ピアノ', '時計', 'めがね', 'ぼうし', 'くつ', 'カメラ', 'テレビ', 'ギター', '電話', 'かがみ', 'なべ', '冷蔵庫', '電球'],
};

// お題ごとの「出せないしるし」。アイコンの絵や名前がお題そのものに見えて、1つで当たってしまう組
export const BLOCKED = {
  '飛行機': ['fly'], // 「飛ぶ」の絵が飛行機
  '太陽': ['summer'], // 「夏」の絵が太陽
  '月': ['night'], // 「夜」の絵が月
  '雲': ['cloud'], // 「空」の絵が雲
  'サッカーボール': ['sport'], // 「スポーツ」の絵がサッカーボール
  'ケーキ': ['sweet'], // 「甘い」の絵がケーキ
  '木': ['park'], // 「公園」の絵が木
  'テレビ': ['screen'], // 「画面」の絵がテレビ
  '時計': ['time'], // 「時間」の絵が時計
  '電球': ['shine'], // 「光る」の絵が電球
  'なべ': ['cook'], // 「料理」の絵がなべ
  '雪': ['winter', 'cold'], // 「冬」の絵が雪、「冷たい」の絵が雪の結晶
  '海': ['sea'], // 名前が同じ
  '山': ['mountain'], // 名前が同じ
};
