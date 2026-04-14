/**
 * 文章版まちがいさがし — 問題データ（本番候補15問）
 *
 * 1回の進行では各カテゴリから5問を抜いて使う想定
 * カテゴリごとに5問以上を保つこと（足りないとラウンドが短くなる）
 */
export const QUESTIONS = [
  // ── ことわざ・四字熟語（5問） ──
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
    original: '七転び八起き',
    modified: '七転び八転び',
    answer: '「八起き」が「八転び」になっている',
    wrongPart: '八転び → 八起き',
  },

  {
    category: 'kotowaza',
    original: '温故知新',
    modified: '温古知新',
    answer: '「故」が「古」になっている（同じ読み「こ」）',
    wrongPart: '古 → 故',
  },
  {
    category: 'kotowaza',
    original: '弱肉強食',
    modified: '弱肉強職',
    answer: '「食」が「職」になっている',
    wrongPart: '強職 → 強食',
  },

  // ── 古典・名文（5問） ──
  {
    category: 'koten',
    original: '夏草や兵どもが夢の跡',
    modified: '夏草や兵どもの夢の跡',
    answer: '助詞「が」が「の」になっている',
    wrongPart: '兵どもの → 兵どもが',
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
  {
    category: 'koten',
    original: '春はあけぼの',
    modified: '春はあけもの',
    answer: '「あけぼの」が「あけもの」になっている',
    wrongPart: 'あけもの → あけぼの',
  },
  {
    category: 'koten',
    original: '古池や蛙飛びこむ水の音',
    modified: '古池や蛙飛びこむ水の色',
    answer: '「音」が「色」になっている',
    wrongPart: '色 → 音',
  },

  // ── 慣用句（5問） ──
  {
    category: 'phrase',
    original: '猫の手も借りたい',
    modified: '猫の手も貸したい',
    answer: '「借りたい」が「貸したい」になっている',
    wrongPart: '貸したい → 借りたい',
  },
  {
    category: 'phrase',
    original: '目を丸くする',
    modified: '目が丸くする',
    answer: '助詞「を」が「が」になっている',
    wrongPart: '目が → 目を',
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
    original: '目から鱗が落ちる',
    modified: '目から涙が落ちる',
    answer: '「鱗」が「涙」になっている',
    wrongPart: '涙 → 鱗',
  },
  {
    category: 'phrase',
    original: '頭が上がらない',
    modified: '頭は上がらない',
    answer: '助詞「が」が「は」になっている',
    wrongPart: '頭は → 頭が',
  },
];

export const CATEGORIES = {
  kotowaza: { name: 'ことわざ・四字熟語', icon: 'menu_book' },
  koten: { name: '古典・名文', icon: 'history_edu' },
  phrase: { name: '慣用句', icon: 'record_voice_over' },
};
