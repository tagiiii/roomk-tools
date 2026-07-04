// data/sessions/u1s01.js
// U1 ことばのひきだし 回1「ことばであそぼ、開幕」
// オリエンテーション回。メインは既存quizアプリで実施するため、このファイルは
// プログラム紹介・参加ルール・quiz案内・対話・振り返りのみを持つ。
// 型B（導入5/ウォームアップ5/メイン25/対話7/振り返り3 = 45分）
KotobaAsobo.registerSession({
  id: 'u1s01',
  unitId: 'u1',
  number: 1,
  title: 'ことばであそぼ、開幕',
  goal: '進行に{慣|な}れ「予想が外れても楽しい」を体験する',
  communicationGoal: '①②③をチャットで送る練習。パスOKの共有',
  curriculum: [
    { code: '小5-6(1)ア?', label: '言葉には人とつながる働きがある', confidence: 'candidate' },
  ],
  blocks: [
    { part: 'intro',    label: '導入・プログラム紹介とルール', estimatedMinutes: 5,  items: ['u1s01-intro1', 'u1s01-intro2', 'u1s01-checkin'] },
    { part: 'warmup',   label: 'ウォームアップ（quiz案内）',   estimatedMinutes: 5,  items: ['u1s01-w1'] },
    { part: 'main',     label: 'メイン（quizアプリで実施）',   estimatedMinutes: 25, items: ['u1s01-main-guide'] },
    { part: 'dialogue', label: '対話・応用',                   estimatedMinutes: 7,  items: ['u1s01-d1'] },
    { part: 'closing',  label: '振り返り',                     estimatedMinutes: 3,  items: ['u1s01-c1'] },
  ],
  questions: [
    // ---------------- intro: reveal型（プログラム紹介） ----------------
    {
      id: 'u1s01-intro1',
      unitId: 'u1',
      sessionId: 'u1s01',
      type: 'reveal',
      difficulty: 1,
      question: 'これから{始|はじ}まる「コトバであそぼ」って、どんな{時間|じかん}?',
      answer: 'ことばを{使|つか}って{予想|よそう}したり、話したり、{一緒|いっしょ}に{楽|たの}しむ{時間|じかん}',
      steps: [
        'ここは、ことばについてのクイズや{話|はな}し{合|あ}いを{楽|たの}しむ時間です。',
        '正解を当てることよりも、「どう{予想|よそう}したか」「どう{感|かん}じたか」を大切にします。',
        '知っている・知らないは関係ありません。予想が外れても、それがおもしろさになります。',
      ],
      explanation: 'この時間の目的は「正解を{当|あ}てること」ではなく「予想して、話して、楽しむこと」だと最初に共有しておくと、参加のハードルが下がる。',
      basicExplanation: 'クイズは答えを当てるゲームじゃなくて、みんなで予想して楽しむ時間だよ、ということだよ。',
      advancedExplanation: '{学習|がくしゅう}の場では{正誤|せいご}よりも{思考|しこう}の{過程|かてい}を{共有|きょうゆう}すること自体に{価値|かち}がある、という{考|かんが}え方を最初に{提示|ていじ}している。',
      facilitationPrompt: '「間違えても大丈夫な時間だよ」という空気を最初にしっかり伝える。反応が薄くてもそのまま進めてよい。',
      followUpQuestion: '今まで「クイズ」と聞いて思い浮かべていたイメージと、少し違いそう?',
      estimatedMinutes: 2,
      curriculumTags: ['小5-6(1)ア?'],
      communicationTags: ['パスを選べる'],
    },
    {
      id: 'u1s01-intro2',
      unitId: 'u1',
      sessionId: 'u1s01',
      type: 'reveal',
      difficulty: 1,
      question: 'クイズに答えるとき、どうやって{気持|きも}ちを{伝|つた}えたらいい?',
      answer: 'チャットに①②③の{数字|すうじ}だけ{送|おく}ればOK。パスもOK',
      steps: [
        '{画面|がめん}に①②③の{選択肢|せんたくし}が出たら、チャットに数字だけ{送|おく}ってください。',
        '理由を{書|か}きたい人は書いてもいいし、数字だけでも{十分|じゅうぶん}です。',
        '答えたくないときは「パス」と送ってもいいし、{何|なに}も送らなくても大丈夫です。',
      ],
      explanation: 'チャットでの{回答方法|かいとうほうほう}とパスの{権利|けんり}を最初に明示しておくことで、参加の{仕方|しかた}に安心感が生まれる。',
      basicExplanation: '答え方は「数字を送るだけ」でOK、そしてパスしても{怒|おこ}られないよ、ということだよ。',
      advancedExplanation: '{参加|さんか}のルールを{最初|さいしょ}に{明文化|めいぶんか}することは、{発言|はつげん}への{心理的|しんりてき}な{負担|ふたん}を下げる{働|はたら}きを持つ。',
      facilitationPrompt: '実際に①②③を送ってもらう{練習|れんしゅう}を1回してみると、この後の進行がスムーズになる。パスした人がいても特に{触|ふ}れずに進める。',
      followUpQuestion: '数字だけ送るのと、理由も一緒に送るの、どっちが自分に合ってそう?',
      estimatedMinutes: 2,
      curriculumTags: ['小5-6(1)ア?'],
      communicationTags: ['①②③をチャットで送る練習', 'パスを選べる'],
    },

    // ---------------- intro: チェックイン ----------------
    {
      id: 'u1s01-checkin',
      unitId: 'u1',
      sessionId: 'u1s01',
      type: 'open',
      difficulty: 1,
      question: '{初|はじ}めまして、または{久|ひさ}しぶりのみんなへ。今の気分を一言で言うと?（答えなくてもOK）',
      facilitationPrompt: '短い一言でよいと伝える。パスでもよいし、{絵文字|えもじ}の{代|か}わりに好きな言葉でもよいと伝える。',
      followUpQuestion: '同じ「一言」でも、人によって全然ちがう言葉が出てくるかも?',
      estimatedMinutes: 1,
      curriculumTags: ['小5-6(1)ア?'],
      communicationTags: ['パスを選べる'],
    },

    // ---------------- warmup: quizアプリ案内スライド ----------------
    {
      id: 'u1s01-w1',
      unitId: 'u1',
      sessionId: 'u1s01',
      type: 'open',
      difficulty: 1,
      question: 'ここから{少|すこ}しの{間|あいだ}、「quiz」{画面|がめん}に{切|き}り{替|か}えて予想クイズをやります。{画面|がめん}が切り替わるので、そのまま見ていてください。',
      facilitationPrompt: 'quizアプリ側の{操作|そうさ}に切り替える{案内|あんない}。①②③の{答|こた}え方は今と同じであることを一言添える。パスもOKと伝える。',
      followUpQuestion: '直感で選ぶ人と、少し考えてから選ぶ人、どっちが多いか見てみよう。',
      estimatedMinutes: 5,
      curriculumTags: ['小5-6(1)ア?'],
      communicationTags: ['①②③をチャットで送る練習'],
    },

    // ---------------- main: quizアプリで実施（案内のみ） ----------------
    {
      id: 'u1s01-main-guide',
      unitId: 'u1',
      sessionId: 'u1s01',
      type: 'open',
      difficulty: 1,
      question: 'ここからは「quiz」アプリの予想クイズをメインで{楽|たの}しみます。直感で選んでも、理由を考えてから選んでもOKです。',
      facilitationPrompt: 'quizアプリの予想クイズパックを{進行|しんこう}する{案内|あんない}スライド（このセッションのデータには問題を持たない）。パスOK・予想を楽しむ空気を{都度|つど}確認する。',
      followUpQuestion: '外れた予想の中にも「おしい」ものがあったかどうか、後で聞いてみよう。',
      estimatedMinutes: 25,
      curriculumTags: ['小5-6(1)ア?'],
      communicationTags: ['①②③をチャットで送る練習', 'パスを選べる'],
    },

    // ---------------- dialogue ----------------
    {
      id: 'u1s01-d1',
      unitId: 'u1',
      sessionId: 'u1s01',
      type: 'open',
      difficulty: 1,
      question: '{今日|きょう}のクイズの中で、予想が外れたけど「へえ」と思ったものはあった?（当たった予想の話でもOK）',
      facilitationPrompt: '外れた予想を{笑|わら}いのネタにせず、「そう考えるのもわかる」と受け止める。パスでもよいし、他の人の話を聞くだけでもよいと伝える。',
      followUpQuestion: '同じ問題でも、人によって予想の{理由|りゆう}がちがったところはあった?',
      estimatedMinutes: 7,
      curriculumTags: ['小5-6(1)ア?'],
      communicationTags: ['理由を言う', 'パスを選べる'],
    },

    // ---------------- closing ----------------
    {
      id: 'u1s01-c1',
      unitId: 'u1',
      sessionId: 'u1s01',
      type: 'open',
      difficulty: 1,
      question: '{今日|きょう}1{回目|かいめ}をやってみて、次も来てみたいと思うところはあった?（なくてもOK）',
      facilitationPrompt: 'どんな{感想|かんそう}でも受け止める。パスでもよい。次回からも「パスOK・予想を楽しむ」は変わらないと伝えて終わる。',
      followUpQuestion: '次はどんな言葉のクイズが出てきそうか、想像してみる?',
      estimatedMinutes: 3,
      curriculumTags: ['小5-6(1)ア?'],
      communicationTags: ['パスを選べる'],
    },
  ],
});
