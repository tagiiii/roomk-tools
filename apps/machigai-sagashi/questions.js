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

  // ── ことわざ・四字熟語（追加10問） ──
  {
    category: 'kotowaza',
    original: '石の上にも三年',
    modified: '石の上にも三日',
    answer: '「三年」の「年」が「日」になっている',
    wrongPart: '三日 → 三年',
  },
  {
    category: 'kotowaza',
    original: '猿も木から落ちる',
    modified: '猿も木を落ちる',
    answer: '助詞「から」が「を」になっている',
    wrongPart: '木を落ちる → 木から落ちる',
  },
  {
    category: 'kotowaza',
    original: '棚から牡丹餅',
    modified: '箱から牡丹餅',
    answer: '「棚」が「箱」になっている',
    wrongPart: '箱から → 棚から',
  },
  {
    category: 'kotowaza',
    original: '一石二鳥',
    modified: '一石三鳥',
    answer: '「二鳥」の「二」が「三」になっている',
    wrongPart: '一石三鳥 → 一石二鳥',
  },
  {
    category: 'kotowaza',
    original: '馬の耳に念仏',
    modified: '馬の耳に読経',
    answer: '「念仏」が「読経」になっている',
    wrongPart: '読経 → 念仏',
  },
  {
    category: 'kotowaza',
    original: '五里霧中',
    modified: '五里夢中',
    answer: '「霧中」の「霧」が「夢」になっている',
    wrongPart: '五里夢中 → 五里霧中',
  },
  {
    category: 'kotowaza',
    original: '日進月歩',
    modified: '日新月歩',
    answer: '「日進」の「進」が「新」になっている',
    wrongPart: '日新月歩 → 日進月歩',
  },
  {
    category: 'kotowaza',
    original: '油断大敵',
    modified: '油断大適',
    answer: '「大敵」の「敵」が「適」になっている',
    wrongPart: '大適 → 大敵',
  },
  {
    category: 'kotowaza',
    original: '臨機応変',
    modified: '臨機往変',
    answer: '「応変」の「応」が「往」になっている',
    wrongPart: '臨機往変 → 臨機応変',
  },
  {
    category: 'kotowaza',
    original: '二兎を追う者は一兎をも得ず',
    modified: '二頭を追う者は一頭をも得ず',
    answer: '「兎」が2か所とも「頭」になっている',
    wrongPart: '二頭を追う者は一頭 → 二兎を追う者は一兎',
  },

  // ── 古典・名文（追加10問） ──
  {
    category: 'koten',
    original: '今は昔、竹取の翁といふ者ありけり',
    modified: '今は昔、竹取の爺といふ者ありけり',
    answer: '「翁」が「爺」になっている',
    wrongPart: '竹取の爺 → 竹取の翁',
  },
  {
    category: 'koten',
    original: 'つれづれなるままに、日暮らし、硯にむかひて',
    modified: 'つれづれなるままに、日暮らし、机にむかひて',
    answer: '「硯」が「机」になっている',
    wrongPart: '机にむかひて → 硯にむかひて',
  },
  {
    category: 'koten',
    original: '祇園精舎の鐘の声、諸行無常の響きあり',
    modified: '祇園精舎の鈴の声、諸行無常の響きあり',
    answer: '「鐘」が「鈴」になっている',
    wrongPart: '鈴の声 → 鐘の声',
  },
  {
    category: 'koten',
    original: 'ゆく河の流れは絶えずして、しかももとの水にあらず',
    modified: 'ゆく河の流れは絶えずとも、しかももとの水にあらず',
    answer: '「絶えずして」が「絶えずとも」になっている',
    wrongPart: '絶えずとも → 絶えずして',
  },
  {
    category: 'koten',
    original: '秋は夕暮れ。夕日のさして、山の端いと近くなりたるに',
    modified: '秋は夕暮れ。夕日のさして、山の際いと近くなりたるに',
    answer: '「山の端」が「山の際」になっている',
    wrongPart: '山の際 → 山の端',
  },
  {
    category: 'koten',
    original: '天の原ふりさけ見れば春日なる三笠の山に出でし月かも',
    modified: '天の原ふりさけ見れば春日なる三傘の山に出でし月かも',
    answer: '地名「三笠」が「三傘」になっている',
    wrongPart: '三傘の山 → 三笠の山',
  },
  {
    category: 'koten',
    original: 'ひさかたの光のどけき春の日にしづ心なく花の散るらむ',
    modified: 'ひさかたの光あたたけき春の日にしづ心なく花の散るらむ',
    answer: '「のどけき」が「あたたけき」になっている',
    wrongPart: 'あたたけき → のどけき',
  },
  {
    category: 'koten',
    original: '春過ぎて夏来にけらし白妙の衣ほすてふ天の香具山',
    modified: '春過ぎて夏来にけらし白妙の衣ほすてふ天の畝傍山',
    answer: '地名「香具山」が「畝傍山」になっている',
    wrongPart: '天の畝傍山 → 天の香具山',
  },
  {
    category: 'koten',
    original: '花の色は移りにけりないたづらにわが身世にふるながめせしまに',
    modified: '花の色は移りにけりないたづらにわが身世にくもるながめせしまに',
    answer: '「ふる」が「くもる」になっている',
    wrongPart: 'くもるながめ → ふるながめ',
  },
  {
    category: 'koten',
    original: '学びて時にこれを習ふ、また説ばしからずや',
    modified: '学びて時にこれを忘るる、また説ばしからずや',
    answer: '「習ふ」が「忘るる」になっている',
    wrongPart: '忘るる → 習ふ',
  },

  // ── 文法のねじれ（10問） ──
  {
    category: 'bunpo',
    original: 'ぼくの好きな食べ物はカレーです',
    modified: 'ぼくの好きな食べ物はカレーが好きです',
    answer: '「カレーです」が「カレーが好きです」になっていて主語と述語がねじれている',
    wrongPart: 'カレーが好きです → カレーです',
  },
  {
    category: 'bunpo',
    original: 'わたしの夢は宇宙飛行士になることです',
    modified: 'わたしの夢は宇宙飛行士になりたいです',
    answer: '「なることです」が「なりたいです」になっていて主語と述語がねじれている',
    wrongPart: 'なりたいです → なることです',
  },
  {
    category: 'bunpo',
    original: 'このスープのいいところは野菜がたくさん入っていることです',
    modified: 'このスープのいいところは野菜がたくさん入っています',
    answer: '文末が「入っていることです」ではなく「入っています」になっていて主語と述語がねじれている',
    wrongPart: '入っています → 入っていることです',
  },
  {
    category: 'bunpo',
    original: '妹の特技は絵をかくことです',
    modified: '妹の特技は絵をかくのがとくいです',
    answer: '「かくことです」が「かくのがとくいです」になっていて主語と述語がねじれている',
    wrongPart: 'かくのがとくいです → かくことです',
  },
  {
    category: 'bunpo',
    original: 'ぼくが虫とりであつめたのは、カブトムシとクワガタだ',
    modified: 'ぼくが虫とりであつめたのは、カブトムシとクワガタをつかまえた',
    answer: '文末が「クワガタだ」ではなく「クワガタをつかまえた」になっていて主語と述語がねじれている',
    wrongPart: 'クワガタをつかまえた → クワガタだ',
  },
  {
    category: 'bunpo',
    original: 'ねこの好きな遊びはひもで遊ぶことです',
    modified: 'ねこの好きな遊びはひもで遊ぶのが好きです',
    answer: '「遊ぶことです」が「遊ぶのが好きです」になっていて主語と述語がねじれている',
    wrongPart: '遊ぶのが好きです → 遊ぶことです',
  },
  {
    category: 'bunpo',
    original: '公園でお姉ちゃんと弟が遊んでいたが、弟はころんで泣き出した',
    modified: '公園でお姉ちゃんと弟が遊んでいたが、彼はころんで泣き出した',
    answer: '「弟」が指示語「彼」になっていて、どちらを指すか分からなくなっている',
    wrongPart: '彼はころんで → 弟はころんで',
  },
  {
    category: 'bunpo',
    original: '妹はりんごをむいて、それをおいしそうに食べた',
    modified: '妹はりんごをむいて、あれをおいしそうに食べた',
    answer: '指示語「それ」が「あれ」になっている。いま手もとでむいたばかりのりんごを指すときは「それ」が自然',
    wrongPart: 'あれ',
  },
  {
    category: 'bunpo',
    original: 'たとえ雨が降っても、ピクニックには行く',
    modified: 'たとえ雨が降ったら、ピクニックには行く',
    answer: '「降っても」が「降ったら」になっていて「たとえ〜ても」の呼応がねじれている',
    wrongPart: '降ったら → 降っても',
  },
  {
    category: 'bunpo',
    original: '決して弟にひみつを話すことはできない',
    modified: '決して弟にひみつを話すことはできる',
    answer: '文末が「できない」ではなく「できる」になっていて「決して」の呼応がねじれている',
    wrongPart: '話すことはできる → 話すことはできない',
  },
];

export const CATEGORIES = {
  kotowaza: { name: 'ことわざ・四字熟語', icon: 'menu_book' },
  koten: { name: '古典・名文', icon: 'history_edu' },
  phrase: { name: '慣用句', icon: 'record_voice_over' },
  bunpo: { name: '文法のねじれ', icon: 'sync_problem' },
};
