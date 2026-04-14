/**
 * ことばシャッフル — 問題データ
 *
 * difficulty: 文字数（ひらがな1文字=1カウント）
 * word: 正解の言葉（ひらがな）
 * hint: ヒント（空文字ならヒントなし）
 */
export const WORDS = [
  // ── 3文字 ──
  { difficulty: 3, word: 'さくら', hint: '春にさく花' },
  { difficulty: 3, word: 'うさぎ', hint: '耳が長い動物' },
  { difficulty: 3, word: 'くるま', hint: '道を走るのりもの' },
  { difficulty: 3, word: 'りんご', hint: '赤いくだもの' },
  { difficulty: 3, word: 'かがみ', hint: '自分の顔がうつる' },
  { difficulty: 3, word: 'とけい', hint: '時間がわかる' },
  { difficulty: 3, word: 'たまご', hint: 'にわとりが産む' },
  { difficulty: 3, word: 'きつね', hint: 'コンコンと鳴く' },
  { difficulty: 3, word: 'めがね', hint: '目にかけるもの' },
  { difficulty: 3, word: 'すずめ', hint: '小さい鳥' },
  { difficulty: 3, word: 'ぶどう', hint: 'むらさき色のくだもの' },
  { difficulty: 3, word: 'くじら', hint: '海で一番大きい' },
  { difficulty: 3, word: 'ほたる', hint: '光る虫' },
  { difficulty: 3, word: 'あひる', hint: 'ガーガー鳴く鳥' },
  { difficulty: 3, word: 'いるか', hint: '海でジャンプする' },

  { difficulty: 3, word: 'かえる', hint: 'ケロケロ鳴く' },
  { difficulty: 3, word: 'さかな', hint: '水の中でくらす' },
  { difficulty: 3, word: 'つくえ', hint: 'ものを置くところ' },
  { difficulty: 3, word: 'まくら', hint: 'ねるときに使う' },
  { difficulty: 3, word: 'はさみ', hint: '紙を切る道具' },

  // ── 4文字 ──
  { difficulty: 4, word: 'ひまわり', hint: '太陽の方を向く花' },
  { difficulty: 4, word: 'たんぽぽ', hint: '黄色い野の花' },
  { difficulty: 4, word: 'からあげ', hint: 'お弁当の人気おかず' },
  { difficulty: 4, word: 'おにぎり', hint: 'ごはんをにぎる' },
  { difficulty: 4, word: 'たいよう', hint: '空で輝いている' },
  { difficulty: 4, word: 'あさがお', hint: '朝にさく花' },
  { difficulty: 4, word: 'かみなり', hint: 'ゴロゴロ鳴る' },
  { difficulty: 4, word: 'えんぴつ', hint: '字を書く道具' },
  { difficulty: 4, word: 'おりがみ', hint: '紙を折って作る' },
  { difficulty: 4, word: 'こうもり', hint: '夜に飛ぶ動物' },
  { difficulty: 4, word: 'しんぶん', hint: 'ニュースが書いてある' },
  { difficulty: 4, word: 'すいとう', hint: '飲み物を入れて持ち歩く' },
  { difficulty: 4, word: 'ふうせん', hint: 'ふくらませて飛ばす' },

  { difficulty: 4, word: 'くわがた', hint: 'はさみのような角を持つ虫' },
  { difficulty: 4, word: 'きんぎょ', hint: '赤い小さな魚' },
  { difficulty: 4, word: 'どんぐり', hint: '秋に木から落ちる' },

  // ── 5文字 ──
  { difficulty: 5, word: 'かたつむり', hint: '殻を背負って歩く' },
  { difficulty: 5, word: 'たからもの', hint: '大事にしているもの' },
  { difficulty: 5, word: 'ゆうえんち', hint: '乗り物がいっぱい' },
  { difficulty: 5, word: 'めだまやき', hint: '朝ごはんの定番' },
  { difficulty: 5, word: 'かきごおり', hint: '夏のつめたいおやつ' },
  { difficulty: 5, word: 'こいのぼり', hint: '5月の空をおよぐ' },
  { difficulty: 5, word: 'だるまさん', hint: '赤くて丸い人形' },
  { difficulty: 5, word: 'あいことば', hint: '秘密の合言葉' },

  { difficulty: 5, word: 'なつまつり', hint: '夏の楽しい行事' },
  { difficulty: 5, word: 'かくれんぼ', hint: 'かくれる遊び' },
  { difficulty: 5, word: 'ぬいぐるみ', hint: 'やわらかい人形' },
  { difficulty: 5, word: 'おとしだま', hint: 'お正月にもらえる' },
  { difficulty: 5, word: 'かぶとむし', hint: '夏に人気の虫' },

  // ── 6文字 ──
  { difficulty: 6, word: 'しんかんせん', hint: 'とても速い電車' },
  { difficulty: 6, word: 'おこのみやき', hint: '関西の名物料理' },
  { difficulty: 6, word: 'うんどうかい', hint: 'みんなで走ったりする' },
  { difficulty: 6, word: 'すいぞくかん', hint: '魚がいっぱいいる場所' },
  { difficulty: 6, word: 'おばけやしき', hint: 'おばけが出てくる' },
  { difficulty: 6, word: 'かいてんずし', hint: 'おすしが回ってくる' },
  { difficulty: 6, word: 'どうぶつえん', hint: '動物がたくさんいる場所' },
  { difficulty: 6, word: 'はくぶつかん', hint: 'いろいろ展示されている' },
  { difficulty: 6, word: 'てんとうむし', hint: '赤くて丸い小さな虫' },
  { difficulty: 6, word: 'おもちゃばこ', hint: 'おもちゃを入れる箱' },
  { difficulty: 6, word: 'たからさがし', hint: '宝物を見つける遊び' },
];
