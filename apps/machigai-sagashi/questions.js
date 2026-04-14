/**
 * 文章版まちがいさがし — 問題データ（本番候補10問）
 *
 * 1回の進行では5問を抜いて使う想定
 * 内訳: 助詞3 / 意味ズレ3 / 同音異字2 / 長文2
 */
export const QUESTIONS = [
  // ── ことわざ（3問） ──
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

  // ── 四字熟語（1問） ──
  {
    category: 'yojijukugo',
    original: '温故知新',
    modified: '温古知新',
    answer: '「故」が「古」になっている（同じ読み「こ」）',
    wrongPart: '古 → 故',
  },

  // ── 古典・名文（3問） ──
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

  // ── 慣用句（3問） ──
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
];

export const CATEGORIES = {
  kotowaza: { name: 'ことわざ', icon: 'menu_book' },
  yojijukugo: { name: '四字熟語', icon: 'translate' },
  koten: { name: '古典・名文', icon: 'history_edu' },
  phrase: { name: '慣用句', icon: 'record_voice_over' },
};
