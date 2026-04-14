/**
 * クイズパック — 問題データ
 *
 * difficulty: 1（やさしい）| 2（ふつう）| 3（ひねり）
 */
export const QUIZ_PACKS = [
  {
    id: 'zatsugaku-3choice',
    name: '雑学3択クイズ',
    description: '知ってるようで知らない！？ おもしろ雑学',
    icon: 'quiz',
    questions: [
      {
        id: 'z001', difficulty: 1,
        question: 'パンダがいつも食べているものとして、いちばん有名なのは？',
        choices: ['ささ', 'りんご', 'こんぶ'],
        answerIndex: 0,
        explanation: 'パンダは竹やささをよく食べます。見た目はかわいいけれど、食事はかなりもりもりです。'
      },
      {
        id: 'z002', difficulty: 1,
        question: 'タコの足は何本？',
        choices: ['6本', '8本', '10本'],
        answerIndex: 1,
        explanation: 'タコの足は8本です。ちなみにイカは10本あります。'
      },
      {
        id: 'z003', difficulty: 1,
        question: 'ペンギンが飛べないかわりに得意なのは？',
        choices: ['木のぼり', 'およぐこと', '砂にもぐること'],
        answerIndex: 1,
        explanation: 'ペンギンは羽をひれのように使って、海の中をすいすい泳ぎます。'
      },
      {
        id: 'z004', difficulty: 1,
        question: '空にかかる にじ によく見られる色の数は？',
        choices: ['7色', '3色', '10色'],
        answerIndex: 0,
        explanation: 'ふつうは7色として紹介されることが多いです。見え方は空のようすでも少し変わります。'
      },
      {
        id: 'z005', difficulty: 1,
        question: '月がまんまるに見える日の呼び名は？',
        choices: ['三日月', '満月', '半月'],
        answerIndex: 1,
        explanation: '丸く見える月は満月です。月は毎日少しずつ形が変わって見えます。'
      },
      {
        id: 'z006', difficulty: 1,
        question: '地球のまわりを回っているのは？',
        choices: ['月', '火星', 'たいよう'],
        answerIndex: 0,
        explanation: '月は地球のまわりを回る身近な天体です。'
      },
      {
        id: 'z007', difficulty: 2,
        question: 'いちごの表面に見えるつぶつぶは、どうなっている部分？',
        choices: ['ひとつひとつが実に近い部分', '全部たねだけの部分', 'ただのもよう'],
        answerIndex: 0,
        explanation: 'いちごの表面のつぶつぶに見える部分は、それぞれが小さな実にあたるとされています。'
      },
      {
        id: 'z008', difficulty: 2,
        question: 'バナナが「木」ではなく、大きな草のなかまに近いと言われる理由は？',
        choices: ['かたい幹がないから', '実が黄色いから', '南の国で育つから'],
        answerIndex: 0,
        explanation: '見た目は木のようでも、バナナには木のような幹がありません。'
      },
      {
        id: 'z009', difficulty: 2,
        question: 'コアラがよく食べる葉っぱはどれ？',
        choices: ['ユーカリ', 'もみじ', 'たけ'],
        answerIndex: 0,
        explanation: 'コアラはユーカリの葉をよく食べます。'
      },
      {
        id: 'z010', difficulty: 2,
        question: '世界でいちばん大きいどうぶつとして知られているのは？',
        choices: ['シロナガスクジラ', 'キリン', 'ぞう'],
        answerIndex: 0,
        explanation: 'シロナガスクジラは海にくらす、とても大きな生きものです。'
      },
      {
        id: 'z011', difficulty: 2,
        question: 'らくだのこぶにたまっているものとして近いのは？',
        choices: ['主に脂肪', '水だけ', '空気'],
        answerIndex: 0,
        explanation: 'こぶには主に脂肪がたまっています。水をそのままためているわけではありません。'
      },
      {
        id: 'z012', difficulty: 2,
        question: 'はちみつが長く保存しやすい理由に近いのはどれ？',
        choices: ['水分が少ないから', 'いつも冷えているから', '色がこいから'],
        answerIndex: 0,
        explanation: 'はちみつは水分が少なく、いたみにくい性質を持っています。'
      },
      {
        id: 'z013', difficulty: 3,
        question: '「北半球では、夏に昼が長く感じやすい」と言える理由に近いのはどれ？',
        choices: ['太陽が出ている時間が長くなるから', '暑い日が多いから時間がゆっくり感じるから', '空が青く見えるから'],
        answerIndex: 0,
        explanation: '季節によって太陽の通り道が変わるため、夏は昼が長くなります。「暑さ」は感覚で、実際の時間とは別です。'
      },
      {
        id: 'z014', difficulty: 3,
        question: 'もし南極の近くにくらす動物を考えるなら、毛が白いだけより大事そうなのはどれ？',
        choices: ['寒さをしのげる体のつくり', 'えさを遠くから見つけられる視力', '体が大きいこと'],
        answerIndex: 0,
        explanation: '視力や体の大きさも役立ちますが、まず寒さから体を守れないと生きていけません。'
      },
      {
        id: 'z015', difficulty: 3,
        question: '「鳥は空を飛ぶために体が軽いほうがよさそう」と考えると、骨の特徴として近いのはどれ？',
        choices: ['かたくて重い骨で体を支える', '軽くて空洞のある骨が多い', '骨がやわらかくて曲がりやすい'],
        answerIndex: 1,
        explanation: '飛ぶには体を軽くする工夫が役立ちます。「重い骨で支える」「やわらかい骨」はそれぞれ別の問題が起きそうです。'
      },
      {
        id: 'z016', difficulty: 3,
        question: '「海の水をそのまま毎日飲むと大変そう」と考えると、いちばん近い説明はどれ？',
        choices: ['しょっぱすぎて体の水分バランスがくずれやすい', '重たくて飲みにくいから', '温度が体に合わないから'],
        answerIndex: 0,
        explanation: '海水は塩分が多いのが最大の問題です。重さや温度は、塩分にくらべると大きな問題にはなりにくいです。'
      },
      {
        id: 'z017', difficulty: 3,
        question: '「植物が暗い場所ばかりだと育ちにくい」と言えそうな理由はどれ？',
        choices: ['光を使って育つはたらきがあるから', '暗いと水が足りなくなるから', '暗いと土がかたくなるから'],
        answerIndex: 0,
        explanation: '光と水は別の問題です。暗くても水はあげられますが、光がないと植物は育つためのエネルギーを作れません。'
      }
    ]
  },
  {
    id: 'series-2choice',
    name: '連続2択クイズ',
    description: 'どっちがホント？ サクサク答えよう',
    icon: 'bolt',
    questions: [
      {
        id: 's001', difficulty: 1,
        question: 'イルカは さかな のなかま？ それとも ほにゅうるい のなかま？',
        choices: ['さかなのなかま', 'ほにゅうるいのなかま'],
        answerIndex: 1,
        explanation: 'イルカは肺で息をして子どもにお乳をあげるので、ほにゅうるいです。'
      },
      {
        id: 's002', difficulty: 1,
        question: 'ペンギンがくらしている場所は、南の方だけ？ それとも 北にもいる？',
        choices: ['南の方だけ', '北にもいる'],
        answerIndex: 0,
        explanation: '野生のペンギンは主に南半球にくらしています。'
      },
      {
        id: 's003', difficulty: 1,
        question: 'きんぎょにまぶたはある？ それとも ない？',
        choices: ['ある', 'ない'],
        answerIndex: 1,
        explanation: 'きんぎょには人のようなまぶたがありません。目を閉じずに休みます。'
      },
      {
        id: 's004', difficulty: 1,
        question: 'タツノオトシゴで赤ちゃんを育てるのは、オス？ それとも メス？',
        choices: ['オス', 'メス'],
        answerIndex: 0,
        explanation: 'タツノオトシゴはオスのおなかの袋で赤ちゃんを育てます。'
      },
      {
        id: 's005', difficulty: 1,
        question: 'はちみつは、すごく長く保存できる？ それとも すぐいたみやすい？',
        choices: ['長く保存できる', 'すぐいたみやすい'],
        answerIndex: 0,
        explanation: 'はちみつは水分が少なく、長くもつ食べものとして知られています。'
      },
      {
        id: 's006', difficulty: 1,
        question: 'バナナは木になる？ それとも 大きな草のような植物になる？',
        choices: ['木になる', '大きな草のような植物になる'],
        answerIndex: 1,
        explanation: '見た目は木のようですが、バナナは大きな草のなかまです。'
      },
      {
        id: 's007', difficulty: 2,
        question: 'くもの巣は、ねばねばだけ？ それとも ねばねばしない糸もある？',
        choices: ['ねばねばだけ', 'ねばねばしない糸もある'],
        answerIndex: 1,
        explanation: 'くもは場所によって糸を使い分けます。歩くところは、ねばねばしないこともあります。'
      },
      {
        id: 's008', difficulty: 2,
        question: 'サメはねむるとき、目をとじる？ それとも 目をあけたままのことが多い？',
        choices: ['目をとじる', '目をあけたまま'],
        answerIndex: 1,
        explanation: 'サメはまぶたがない種類も多く、目を開けたまま休むことがあります。'
      },
      {
        id: 's009', difficulty: 2,
        question: 'カメレオンは、いつも背景そっくりの色に変わる？ それとも 気分や温度でも変わる？',
        choices: ['背景そっくりになる', '気分や温度でも変わる'],
        answerIndex: 1,
        explanation: 'カメレオンの色変化には、気持ちや体温調節も関係しています。'
      },
      {
        id: 's010', difficulty: 2,
        question: '雲の上は、いつも雨？ それとも 晴れていることも多い？',
        choices: ['いつも雨', '晴れていることも多い'],
        answerIndex: 1,
        explanation: '雲の上は太陽の光が見えて、晴れていることもよくあります。'
      },
      {
        id: 's011', difficulty: 2,
        question: 'ひまわりは、たいようがしずんだあとも動きつづける？ それとも あまり動かない？',
        choices: ['動きつづける', 'あまり動かない'],
        answerIndex: 1,
        explanation: '若いひまわりは昼に太陽の方を向きますが、夜じゅうずっと追いかけるわけではありません。'
      },
      {
        id: 's012', difficulty: 2,
        question: 'らくだのこぶに入っているのは、水？ それとも 主に脂肪？',
        choices: ['水', '主に脂肪'],
        answerIndex: 1,
        explanation: 'こぶにたまっているのは主に脂肪です。水をそのままためているわけではありません。'
      },
      {
        id: 's013', difficulty: 3,
        question: 'キリンの首の骨の数は、人間よりずっと多い？ それとも 実は同じくらい？',
        choices: ['ずっと多い', '実は同じくらい'],
        answerIndex: 1,
        explanation: 'キリンの首の骨は人間と同じ7個です。1本1本がとても長いだけで、数は変わりません。'
      },
      {
        id: 's014', difficulty: 3,
        question: '「水の中で速く進む魚」は、四角い体より すべりやすい形の体のほうが向いていそう？ それとも 形はあまり関係ない？',
        choices: ['すべりやすい形のほうが向いていそう', '形はあまり関係ない'],
        answerIndex: 0,
        explanation: '水の抵抗をへらすには、なめらかな形のほうが有利です。速い魚はどれも似た形をしています。'
      },
      {
        id: 's015', difficulty: 3,
        question: 'ホッキョクグマの毛を1本だけ見ると、白い？ それとも 実は透明に近い？',
        choices: ['白い', '実は透明に近い'],
        answerIndex: 1,
        explanation: '毛は透明な管のようになっていて、光の反射でまとまると白く見えています。'
      },
      {
        id: 's016', difficulty: 3,
        question: '富士山の頂上でお湯をわかすと、ふつうに100℃でふっとうする？ それとも もっと低い温度でふっとうする？',
        choices: ['ふつうに100℃でふっとうする', 'もっと低い温度でふっとうする'],
        answerIndex: 1,
        explanation: '高い場所は気圧が低いので、水は100℃にならなくてもふっとうします。約87℃でわきはじめます。'
      },
      {
        id: 's017', difficulty: 3,
        question: '人間の体でいちばんかたい部分は、骨？ それとも 歯のエナメル質？',
        choices: ['骨', '歯のエナメル質'],
        answerIndex: 1,
        explanation: '歯の表面のエナメル質は骨よりかたく、人体でいちばんかたい組織です。'
      }
    ]
  },
  {
    id: 'kotoba-quiz',
    name: 'ことばクイズ',
    description: 'ことばの不思議をたのしもう',
    icon: 'translate',
    questions: [
      {
        id: 'k001', difficulty: 1,
        question: '「わくわく」に近い気持ちはどれ？',
        choices: ['たのしみで気持ちがはずむ', 'ねむくてぼんやりする', 'しずかにおこる'],
        answerIndex: 0,
        explanation: '「わくわく」は、楽しみで心が動くような感じを表す言葉です。'
      },
      {
        id: 'k002', difficulty: 1,
        question: '「しーん」は、どんな様子を表すことが多い？',
        choices: ['とても静か', 'すごくまぶしい', 'せかせか急ぐ'],
        answerIndex: 0,
        explanation: '音がしない静かな様子を「しーん」と表します。'
      },
      {
        id: 'k003', difficulty: 1,
        question: '「きらきら」に近いのはどっち？',
        choices: ['光っている感じ', '重くしずむ感じ'],
        answerIndex: 0,
        explanation: '「きらきら」は、星や光るものが輝いて見える様子です。'
      },
      {
        id: 'k004', difficulty: 1,
        question: '「どきどき」は、どんなときの気持ちに使いやすい？',
        choices: ['びっくりや緊張', 'ぐっすりねむる', 'おなかいっぱい'],
        answerIndex: 0,
        explanation: '心ぞうが速くなるような緊張や期待の気持ちを「どきどき」で表します。'
      },
      {
        id: 'k005', difficulty: 1,
        question: '「にこにこ」は、どんな表情？',
        choices: ['うれしそうな顔', 'びっくりした顔', 'ねむそうな顔'],
        answerIndex: 0,
        explanation: '「にこにこ」は、笑っていてうれしそうな表情を表します。'
      },
      {
        id: 'k006', difficulty: 1,
        question: '「ぽかぽか」に近いのはどれ？',
        choices: ['あたたかくて気持ちいい', 'つめたくてひんやり', 'ごろごろと重い'],
        answerIndex: 0,
        explanation: '日なたやおふろのような、やさしいあたたかさを表します。'
      },
      {
        id: 'k007', difficulty: 2,
        question: '「のんびり」の反対に近いのはどれ？',
        choices: ['ゆったり', 'せかせか', 'ふわふわ'],
        answerIndex: 1,
        explanation: '「のんびり」は急がない様子なので、反対に近いのは「せかせか」です。'
      },
      {
        id: 'k008', difficulty: 2,
        question: '「ふわふわ」に近い手ざわりはどっち？',
        choices: ['やわらかくて軽い', 'かたくてつるつる'],
        answerIndex: 0,
        explanation: '綿やぬいぐるみのように軽くてやわらかい感じが「ふわふわ」です。'
      },
      {
        id: 'k009', difficulty: 2,
        question: '「ぴったり」は、どんな意味に近い？',
        choices: ['ちょうど合う', '少し足りない', 'とても遠い'],
        answerIndex: 0,
        explanation: '大きさやタイミングがちょうど合うときに「ぴったり」を使います。'
      },
      {
        id: 'k010', difficulty: 2,
        question: '「ころころ」は、どんな動きに使いやすい？',
        choices: ['転がるような動き', '空をまっすぐ飛ぶ', '水にしずむ'],
        answerIndex: 0,
        explanation: '丸いものが転がる様子や、かわいく変わる様子にも使われる言葉です。'
      },
      {
        id: 'k011', difficulty: 2,
        question: '「ぐんぐん」は、どんな場面に合いやすい？',
        choices: ['勢いよく進む', 'こっそりかくれる'],
        answerIndex: 0,
        explanation: 'ぐんぐんは、速く伸びたり進んだりする力強さを感じる言葉です。'
      },
      {
        id: 'k012', difficulty: 2,
        question: '「すっきりした気分」に近いのはどっち？',
        choices: ['もやもやが残る感じ', 'さっぱり軽くなった感じ'],
        answerIndex: 1,
        explanation: '「すっきり」は、気持ちが晴れて軽くなったようなときにぴったりです。'
      },
      {
        id: 'k013', difficulty: 3,
        question: '「しとしと」と聞いて思いうかびやすい雨はどれ？',
        choices: ['細かく静かにふる雨', '急にどっとふる強い雨', '横からたたきつける風の雨'],
        answerIndex: 0,
        explanation: '「しとしと」には、音も動きもおだやかな感じがあります。音のひびきから様子を推理できるタイプです。'
      },
      {
        id: 'k014', difficulty: 3,
        question: '「もやもやしている」を言いかえるなら、いちばん近いのはどれ？',
        choices: ['気持ちがはっきりしない', 'すごく元気いっぱい', '考えが全部決まっている'],
        answerIndex: 0,
        explanation: '「もやもや」は、気持ちや考えが晴れず、はっきりしない感じを表します。'
      },
      {
        id: 'k015', difficulty: 3,
        question: '文の空気として自然なのはどれ？ 「雨が上がって、空が_____してきた。」',
        choices: ['からっと', 'どろどろ', 'がたがた'],
        answerIndex: 0,
        explanation: '雨上がりの空の感じには「からっと」が合いやすいです。言葉の意味だけでなく、場面との相性で選べます。'
      },
      {
        id: 'k016', difficulty: 3,
        question: '「ずっしり」と聞いて思いうかびやすいのはどっち？',
        choices: ['軽くはねる感じ', '重みがしっかりある感じ'],
        answerIndex: 1,
        explanation: '「ずっしり」は、持ったときに重さを強く感じるような様子に向いています。'
      },
      {
        id: 'k017', difficulty: 3,
        question: '「その人の話し方はやわらかい」と言うとき、いちばん近い意味はどれ？',
        choices: ['声がこわれそうに小さい', '聞く人が安心しやすい話し方', 'いつも早口で止まらない話し方'],
        answerIndex: 1,
        explanation: '「やわらかい話し方」は、音量よりも相手への伝わり方や印象に関係する表現です。'
      }
    ]
  }
];
