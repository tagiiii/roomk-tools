/**
 * 文章版まちがいさがし — 問題データ
 *
 * original: 正しい文
 * modified: まちがいが入った文
 * category: 'kotowaza' | 'yojijukugo' | 'koten' | 'phrase'
 * answer: まちがいの説明
 * wrongPart: まちがいの箇所（表示用）
 */
export const QUESTIONS = [
  // ── ことわざ ──
  {
    category: 'kotowaza',
    original: '犬も歩けば棒に当たる',
    modified: '犬も歩けば棒に当てる',
    answer: '「当たる」が「当てる」になっている',
    wrongPart: '当てる → 当たる',
  },
  {
    category: 'kotowaza',
    original: '猿も木から落ちる',
    modified: '猿も木から降りる',
    answer: '「落ちる」が「降りる」になっている',
    wrongPart: '降りる → 落ちる',
  },
  {
    category: 'kotowaza',
    original: '花より団子',
    modified: '花より饅頭',
    answer: '「団子」が「饅頭」になっている',
    wrongPart: '饅頭 → 団子',
  },
  {
    category: 'kotowaza',
    original: '石の上にも三年',
    modified: '石の上にも三月',
    answer: '「三年」が「三月」になっている',
    wrongPart: '三月 → 三年',
  },
  {
    category: 'kotowaza',
    original: '七転び八起き',
    modified: '七転び八転び',
    answer: '「八起き」が「八転び」になっている',
    wrongPart: '八転び → 八起き',
  },
  {
    category: 'kotowaza',
    original: '三日坊主',
    modified: '三日帽子',
    answer: '「坊主」が「帽子」になっている',
    wrongPart: '帽子 → 坊主',
  },
  {
    category: 'kotowaza',
    original: '二兎を追う者は一兎をも得ず',
    modified: '二兎を追う者は一兎をも捨てず',
    answer: '「得ず」が「捨てず」になっている',
    wrongPart: '捨てず → 得ず',
  },
  {
    category: 'kotowaza',
    original: '早起きは三文の徳',
    modified: '早起きは三文の得',
    answer: '「徳」が「得」になっている',
    wrongPart: '得 → 徳',
  },
  {
    category: 'kotowaza',
    original: '百聞は一見にしかず',
    modified: '百聞は一見にあらず',
    answer: '「しかず」が「あらず」になっている',
    wrongPart: 'あらず → しかず',
  },
  {
    category: 'kotowaza',
    original: '塵も積もれば山となる',
    modified: '塵も積もれば丘となる',
    answer: '「山」が「丘」になっている',
    wrongPart: '丘 → 山',
  },

  // ── ことわざ（助詞・語順・意味ズレ） ──
  {
    category: 'kotowaza',
    original: '急がば回れ',
    modified: '急げば回れ',
    answer: '「急がば」が「急げば」になっている（助詞＋活用の違い）',
    wrongPart: '急げば → 急がば',
  },
  {
    category: 'kotowaza',
    original: '転ばぬ先の杖',
    modified: '転ばぬ先の石',
    answer: '「杖」が「石」になっている',
    wrongPart: '石 → 杖',
  },
  {
    category: 'kotowaza',
    original: '能ある鷹は爪を隠す',
    modified: '能ある鷹は爪が隠す',
    answer: '助詞「を」が「が」になっている',
    wrongPart: '爪が → 爪を',
  },
  {
    category: 'kotowaza',
    original: '笑う門には福来る',
    modified: '笑う門には服来る',
    answer: '「福」が「服」になっている（同じ読み「ふく」）',
    wrongPart: '服 → 福',
  },
  {
    category: 'kotowaza',
    original: '残り物には福がある',
    modified: '残り物には福はある',
    answer: '助詞「が」が「は」になっている',
    wrongPart: '福はある → 福がある',
  },

  // ── 四字熟語 ──
  {
    category: 'yojijukugo',
    original: '一期一会',
    modified: '一期一合',
    answer: '「会」が「合」になっている',
    wrongPart: '合 → 会',
  },
  {
    category: 'yojijukugo',
    original: '十人十色',
    modified: '十人百色',
    answer: '「十色」が「百色」になっている',
    wrongPart: '百色 → 十色',
  },
  {
    category: 'yojijukugo',
    original: '一石二鳥',
    modified: '一石二鶴',
    answer: '「鳥」が「鶴」になっている',
    wrongPart: '鶴 → 鳥',
  },
  {
    category: 'yojijukugo',
    original: '以心伝心',
    modified: '以心伝身',
    answer: '「心」が「身」になっている',
    wrongPart: '身 → 心',
  },
  {
    category: 'yojijukugo',
    original: '五里霧中',
    modified: '五里霧仲',
    answer: '「中」が「仲」になっている',
    wrongPart: '仲 → 中',
  },
  {
    category: 'yojijukugo',
    original: '四面楚歌',
    modified: '四面楚花',
    answer: '「歌」が「花」になっている',
    wrongPart: '花 → 歌',
  },

  // ── 四字熟語（追加） ──
  {
    category: 'yojijukugo',
    original: '温故知新',
    modified: '温古知新',
    answer: '「故」が「古」になっている（同じ読み「こ」）',
    wrongPart: '古 → 故',
  },
  {
    category: 'yojijukugo',
    original: '起死回生',
    modified: '起死回正',
    answer: '「生」が「正」になっている',
    wrongPart: '回正 → 回生',
  },
  {
    category: 'yojijukugo',
    original: '自業自得',
    modified: '自業自徳',
    answer: '「得」が「徳」になっている（逆に間違えやすい）',
    wrongPart: '自徳 → 自得',
  },
  {
    category: 'yojijukugo',
    original: '弱肉強食',
    modified: '弱肉強職',
    answer: '「食」が「職」になっている',
    wrongPart: '強職 → 強食',
  },

  // ── 古典・名文 ──
  {
    category: 'koten',
    original: '春はあけぼの',
    modified: '春はあけもの',
    answer: '「あけぼの」が「あけもの」になっている',
    wrongPart: 'あけもの → あけぼの',
  },
  {
    category: 'koten',
    original: '祇園精舎の鐘の声',
    modified: '祇園精舎の鐘の音',
    answer: '「声」が「音」になっている',
    wrongPart: '音 → 声',
  },
  {
    category: 'koten',
    original: '月日は百代の過客にして',
    modified: '月日は百代の旅客にして',
    answer: '「過客」が「旅客」になっている',
    wrongPart: '旅客 → 過客',
  },
  {
    category: 'koten',
    original: '古池や蛙飛びこむ水の音',
    modified: '古池や蛙飛びこむ水の色',
    answer: '「音」が「色」になっている',
    wrongPart: '色 → 音',
  },
  {
    category: 'koten',
    original: '柿くへば鐘が鳴るなり法隆寺',
    modified: '柿くへば鐘が鳴るなり東大寺',
    answer: '「法隆寺」が「東大寺」になっている',
    wrongPart: '東大寺 → 法隆寺',
  },

  // ── 古典・名文（追加：長文・助詞ズレ） ──
  {
    category: 'koten',
    original: '夏草や兵どもが夢の跡',
    modified: '夏草や兵どもの夢の跡',
    answer: '助詞「が」が「の」になっている',
    wrongPart: '兵どもの → 兵どもが',
  },
  {
    category: 'koten',
    original: '行く川の流れは絶えずして',
    modified: '行く川の流れは絶えずとして',
    answer: '「絶えずして」に余分な「と」が入っている',
    wrongPart: '絶えずとして → 絶えずして',
  },
  {
    category: 'koten',
    original: '我輩は猫である。名前はまだ無い。',
    modified: '我輩は猫である。名前はまだ無し。',
    answer: '「無い」が「無し」になっている',
    wrongPart: '無し → 無い',
  },
  {
    category: 'koten',
    original: '国境の長いトンネルを抜けると雪国であった',
    modified: '国境の長いトンネルを越えると雪国であった',
    answer: '「抜けると」が「越えると」になっている',
    wrongPart: '越えると → 抜けると',
  },

  // ── 慣用句・日常フレーズ ──
  {
    category: 'phrase',
    original: '目から鱗が落ちる',
    modified: '目から涙が落ちる',
    answer: '「鱗」が「涙」になっている',
    wrongPart: '涙 → 鱗',
  },
  {
    category: 'phrase',
    original: '猫の手も借りたい',
    modified: '猫の手も貸したい',
    answer: '「借りたい」が「貸したい」になっている',
    wrongPart: '貸したい → 借りたい',
  },
  {
    category: 'phrase',
    original: '耳にたこができる',
    modified: '耳にいぼができる',
    answer: '「たこ」が「いぼ」になっている',
    wrongPart: 'いぼ → たこ',
  },
  {
    category: 'phrase',
    original: '足が棒になる',
    modified: '足が石になる',
    answer: '「棒」が「石」になっている',
    wrongPart: '石 → 棒',
  },
  {
    category: 'phrase',
    original: '腹が立つ',
    modified: '腹が鳴つ',
    answer: '「立つ」が「鳴つ」になっている',
    wrongPart: '鳴つ → 立つ',
  },
  // ── 慣用句（追加：助詞・意味ズレ） ──
  {
    category: 'phrase',
    original: '頭が上がらない',
    modified: '頭は上がらない',
    answer: '助詞「が」が「は」になっている',
    wrongPart: '頭は → 頭が',
  },
  {
    category: 'phrase',
    original: '口が滑る',
    modified: '口を滑る',
    answer: '助詞「が」が「を」になっている',
    wrongPart: '口を → 口が',
  },
  {
    category: 'phrase',
    original: '手に汗握る',
    modified: '手に汗にぎる',
    answer: '「握る」がひらがなの「にぎる」になっている',
    wrongPart: 'にぎる → 握る',
  },
  {
    category: 'phrase',
    original: '息を呑む',
    modified: '息を飲む',
    answer: '「呑む」が「飲む」になっている（同じ読みだが字が違う）',
    wrongPart: '飲む → 呑む',
  },
  {
    category: 'phrase',
    original: '目を丸くする',
    modified: '目が丸くする',
    answer: '助詞「を」が「が」になっている',
    wrongPart: '目が → 目を',
  },
];

export const CATEGORIES = {
  kotowaza: { name: 'ことわざ', icon: 'menu_book' },
  yojijukugo: { name: '四字熟語', icon: 'translate' },
  koten: { name: '古典・名文', icon: 'history_edu' },
  phrase: { name: '慣用句', icon: 'record_voice_over' },
};
