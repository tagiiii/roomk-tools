/* しるしでヒント（試作）のアイコンとお題。
   どちらも仮のもの。本番の候補はオーナーが選ぶ。
   アイコンの id はルームに置く値。並べ替えてよいが、id は変えない。 */
window.SHIRUSHI_DATA = {
  // kind: 'nakama' は「何の仲間？」の行に、それ以外は「どんな特徴？」の行に並ぶ
  groups: [
    {
      id: 'nakama', name: '何の仲間？', kind: 'nakama',
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
      ],
    },
    {
      id: 'color', name: '色', kind: 'trait',
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
      ],
    },
    {
      id: 'shape', name: '形・大きさ', kind: 'trait',
      icons: [
        { id: 'round', label: '丸い', icon: 'circle' },
        { id: 'square', label: '四角い', icon: 'square' },
        { id: 'triangle', label: '三角', icon: 'change_history' },
        { id: 'long', label: '長い', icon: 'straighten' },
        { id: 'big', label: '大きい', icon: 'open_in_full' },
        { id: 'small', label: '小さい', icon: 'close_fullscreen' },
      ],
    },
    {
      id: 'move', name: 'ようす・動き', kind: 'trait',
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
      ],
    },
    {
      id: 'place', name: '場所・とき', kind: 'trait',
      icons: [
        { id: 'sea', label: '海', icon: 'waves' },
        { id: 'mountain', label: '山', icon: 'landscape' },
        { id: 'cloud', label: '空', icon: 'cloud' },
        { id: 'town', label: '町', icon: 'location_city' },
        { id: 'night', label: '夜', icon: 'dark_mode' },
        { id: 'summer', label: '夏', icon: 'sunny' },
      ],
    },
  ],

  // お題（仮）。ルームには番号を置くので、本体では途中の削除・並べ替えをしない
  topics: [
    'ハチ', 'ネコ', 'イヌ', 'ペンギン', 'ゾウ', 'キリン', 'ウサギ', 'カエル', 'クジラ', 'パンダ',
    'ニワトリ', 'チョウ', 'バナナ', 'リンゴ', 'スイカ', 'おにぎり', 'ラーメン', 'アイスクリーム', 'たまご', 'カレーライス',
    'ハンバーガー', '自転車', '飛行機', '船', '電車', 'ロケット', '消防車', 'ひまわり', 'サボテン', '雪だるま',
    '虹', '太陽', '月', 'かさ', 'はさみ', '風船', 'サッカーボール', 'ピアノ', 'かき氷', 'ホタル',
  ],

  // お題のなかま（仮）。当てる人に並べる候補を、お題と同じなかまで多めにそろえるために使う。
  // どのお題も、どれか1つのなかまに入れる
  kinds: {
    creature: ['ハチ', 'ネコ', 'イヌ', 'ペンギン', 'ゾウ', 'キリン', 'ウサギ', 'カエル', 'クジラ', 'パンダ', 'ニワトリ', 'チョウ', 'ホタル'],
    food: ['バナナ', 'リンゴ', 'スイカ', 'おにぎり', 'ラーメン', 'アイスクリーム', 'たまご', 'カレーライス', 'ハンバーガー', 'かき氷'],
    ride: ['自転車', '飛行機', '船', '電車', 'ロケット', '消防車'],
    nature: ['ひまわり', 'サボテン', '雪だるま', '虹', '太陽', '月'],
    thing: ['かさ', 'はさみ', '風船', 'サッカーボール', 'ピアノ'],
  },
};
