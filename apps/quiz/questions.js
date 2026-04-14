/**
 * クイズパック — 問題データ（本番候補10問 × 3パック = 30問）
 *
 * difficulty: 1（やさしい）| 2（ふつう）| 3（ひねり）
 * 1回の進行では5問を抜いて使う想定
 */
export const QUIZ_PACKS = [
  {
    id: 'zatsugaku-3choice',
    name: '雑学3択クイズ',
    description: '知ってるようで知らない！？ おもしろ雑学',
    icon: 'quiz',
    questions: [
      // ── d1: やさしい（3問） ──
      {
        id: 'z01', difficulty: 1,
        question: 'タコの足は何本？',
        choices: ['6本', '8本', '10本'],
        answerIndex: 1,
        explanation: 'タコの足は8本。ちなみにイカは10本あります。'
      },
      {
        id: 'z02', difficulty: 1,
        question: 'ペンギンが飛べないかわりに得意なのは？',
        choices: ['木のぼり', 'およぐこと', '砂にもぐること'],
        answerIndex: 1,
        explanation: 'ペンギンは羽をひれのように使って、海の中をすいすい泳ぎます。'
      },
      {
        id: 'z03', difficulty: 1,
        question: '地球のまわりを回っているのは？',
        choices: ['月', '火星', 'たいよう'],
        answerIndex: 0,
        explanation: '月は地球のまわりを回っています。地球は太陽のまわりを回っています。'
      },
      // ── d2: ふつう（4問） ──
      {
        id: 'z04', difficulty: 2,
        question: 'いちごの表面に見えるつぶつぶは、どうなっている部分？',
        choices: ['ひとつひとつが実に近い部分', '全部たねだけの部分', 'ただのもよう'],
        answerIndex: 0,
        explanation: 'つぶつぶに見える部分は、それぞれが小さな実にあたるとされています。'
      },
      {
        id: 'z05', difficulty: 2,
        question: 'バナナが「木」ではなく、大きな草のなかまに近いと言われる理由は？',
        choices: ['かたい幹がないから', '実が黄色いから', '南の国で育つから'],
        answerIndex: 0,
        explanation: '見た目は木のようでも、バナナには木のような幹がありません。'
      },
      {
        id: 'z06', difficulty: 2,
        question: 'らくだのこぶにたまっているものとして近いのは？',
        choices: ['主に脂肪', '水だけ', '空気'],
        answerIndex: 0,
        explanation: 'こぶには主に脂肪がたまっています。水をそのままためているわけではありません。'
      },
      {
        id: 'z07', difficulty: 2,
        question: 'はちみつが長く保存しやすい理由に近いのはどれ？',
        choices: ['水分が少ないから', 'いつも冷えているから', '色がこいから'],
        answerIndex: 0,
        explanation: 'はちみつは水分が少なく、いたみにくい性質を持っています。'
      },
      // ── d3: ひねり（3問） ──
      {
        id: 'z08', difficulty: 3,
        question: '「北半球では、夏に昼が長く感じやすい」と言える理由に近いのはどれ？',
        choices: ['太陽が出ている時間が長くなるから', '暑い日が多いから時間がゆっくり感じるから', '空が青く見えるから'],
        answerIndex: 0,
        explanation: '季節によって太陽の通り道が変わるため、夏は昼が長くなります。「暑さ」は感覚で、実際の時間とは別です。'
      },
      {
        id: 'z09', difficulty: 3,
        question: 'もし南極の近くにくらす動物を考えるなら、毛が白いだけより大事そうなのはどれ？',
        choices: ['寒さをしのげる体のつくり', 'えさを遠くから見つけられる視力', '体が大きいこと'],
        answerIndex: 0,
        explanation: '視力や体の大きさも役立ちますが、まず寒さから体を守れないと生きていけません。'
      },
      {
        id: 'z10', difficulty: 3,
        question: '「鳥は空を飛ぶために体が軽いほうがよさそう」と考えると、骨の特徴として近いのはどれ？',
        choices: ['かたくて重い骨で体を支える', '軽くて空洞のある骨が多い', '骨がやわらかくて曲がりやすい'],
        answerIndex: 1,
        explanation: '「重い骨」「やわらかい骨」はそれぞれ別の問題が起きそうです。飛ぶには軽さが大事です。'
      }
    ]
  },
  {
    id: 'series-2choice',
    name: '連続2択クイズ',
    description: 'どっちがホント？ サクサク答えよう',
    icon: 'bolt',
    questions: [
      // ── d1: やさしい（3問） ──
      {
        id: 's01', difficulty: 1,
        question: 'イルカは さかな のなかま？ それとも ほにゅうるい のなかま？',
        choices: ['さかなのなかま', 'ほにゅうるいのなかま'],
        answerIndex: 1,
        explanation: 'イルカは肺で息をして子どもにお乳をあげるので、ほにゅうるいです。'
      },
      {
        id: 's02', difficulty: 1,
        question: 'きんぎょにまぶたはある？ それとも ない？',
        choices: ['ある', 'ない'],
        answerIndex: 1,
        explanation: 'きんぎょにはまぶたがありません。目を閉じずに休みます。'
      },
      {
        id: 's03', difficulty: 1,
        question: 'タツノオトシゴで赤ちゃんを育てるのは、オス？ それとも メス？',
        choices: ['オス', 'メス'],
        answerIndex: 0,
        explanation: 'タツノオトシゴはオスのおなかの袋で赤ちゃんを育てます。'
      },
      // ── d2: ふつう（4問） ──
      {
        id: 's04', difficulty: 2,
        question: 'くもの巣は、ねばねばだけ？ それとも ねばねばしない糸もある？',
        choices: ['ねばねばだけ', 'ねばねばしない糸もある'],
        answerIndex: 1,
        explanation: 'くもは場所によって糸を使い分けます。自分が歩くところはねばねばしません。'
      },
      {
        id: 's05', difficulty: 2,
        question: 'サメはねむるとき、目をとじる？ それとも 目をあけたままのことが多い？',
        choices: ['目をとじる', '目をあけたまま'],
        answerIndex: 1,
        explanation: 'サメはまぶたがない種類も多く、目を開けたまま休むことがあります。'
      },
      {
        id: 's06', difficulty: 2,
        question: 'カメレオンは、いつも背景そっくりの色に変わる？ それとも 気分や温度でも変わる？',
        choices: ['背景そっくりになる', '気分や温度でも変わる'],
        answerIndex: 1,
        explanation: 'カメレオンの色変化には、気持ちや体温調節も関係しています。'
      },
      {
        id: 's07', difficulty: 2,
        question: 'ひまわりは、たいようがしずんだあとも動きつづける？ それとも あまり動かない？',
        choices: ['動きつづける', 'あまり動かない'],
        answerIndex: 1,
        explanation: '若いひまわりは昼に太陽の方を向きますが、夜じゅう追いかけるわけではありません。'
      },
      // ── d3: ひねり（3問） ──
      {
        id: 's08', difficulty: 3,
        question: 'キリンの首の骨の数は、人間よりずっと多い？ それとも 実は同じくらい？',
        choices: ['ずっと多い', '実は同じくらい'],
        answerIndex: 1,
        explanation: 'キリンの首の骨は人間と同じ7個。1本1本がとても長いだけです。'
      },
      {
        id: 's09', difficulty: 3,
        question: 'ホッキョクグマの毛を1本だけ見ると、白い？ それとも 実は透明に近い？',
        choices: ['白い', '実は透明に近い'],
        answerIndex: 1,
        explanation: '毛は透明な管のようになっていて、光の反射でまとまると白く見えます。'
      },
      {
        id: 's10', difficulty: 3,
        question: '富士山の頂上でお湯をわかすと、ふつうに100℃でふっとうする？ それとも もっと低い温度でふっとうする？',
        choices: ['ふつうに100℃でふっとうする', 'もっと低い温度でふっとうする'],
        answerIndex: 1,
        explanation: '高い場所は気圧が低いので、約87℃でわきはじめます。'
      }
    ]
  },
  {
    id: 'kotoba-quiz',
    name: 'ことばクイズ',
    description: 'ことばの不思議をたのしもう',
    icon: 'translate',
    questions: [
      // ── d1: やさしい（3問） ──
      {
        id: 'k01', difficulty: 1,
        question: '「しーん」は、どんな様子を表すことが多い？',
        choices: ['とても静か', 'すごくまぶしい', 'せかせか急ぐ'],
        answerIndex: 0,
        explanation: '音がしない静かな様子を「しーん」と表します。音がないのに音の言葉で表すのがおもしろいですね。'
      },
      {
        id: 'k02', difficulty: 1,
        question: '「どきどき」は、どんなときの気持ちに使いやすい？',
        choices: ['びっくりや緊張', 'ぐっすりねむる', 'おなかいっぱい'],
        answerIndex: 0,
        explanation: '心ぞうが速くなるような緊張や期待の気持ちを「どきどき」で表します。'
      },
      {
        id: 'k03', difficulty: 1,
        question: '「ぽかぽか」に近いのはどれ？',
        choices: ['あたたかくて気持ちいい', 'つめたくてひんやり', 'ごろごろと重い'],
        answerIndex: 0,
        explanation: '日なたやおふろのような、やさしいあたたかさを表します。'
      },
      // ── d2: ふつう（4問） ──
      {
        id: 'k04', difficulty: 2,
        question: '「のんびり」の反対に近いのはどれ？',
        choices: ['ゆったり', 'せかせか', 'ふわふわ'],
        answerIndex: 1,
        explanation: '「のんびり」は急がない様子。反対に近いのは「せかせか」です。'
      },
      {
        id: 'k05', difficulty: 2,
        question: '「ぴったり」は、どんな意味に近い？',
        choices: ['ちょうど合う', '少し足りない', 'とても遠い'],
        answerIndex: 0,
        explanation: '大きさやタイミングがちょうど合うときに「ぴったり」を使います。'
      },
      {
        id: 'k06', difficulty: 2,
        question: '「ころころ」は、どんな動きに使いやすい？',
        choices: ['転がるような動き', '空をまっすぐ飛ぶ', '水にしずむ'],
        answerIndex: 0,
        explanation: '丸いものが転がる様子や、かわいく変わる様子にも使われる言葉です。'
      },
      {
        id: 'k07', difficulty: 2,
        question: '「すっきりした気分」に近いのはどっち？',
        choices: ['もやもやが残る感じ', 'さっぱり軽くなった感じ'],
        answerIndex: 1,
        explanation: '「すっきり」は、気持ちが晴れて軽くなったようなときにぴったりです。'
      },
      // ── d3: ひねり（3問） ──
      {
        id: 'k08', difficulty: 3,
        question: '「しとしと」と聞いて思いうかびやすい雨はどれ？',
        choices: ['細かく静かにふる雨', '急にどっとふる強い雨', '横からたたきつける風の雨'],
        answerIndex: 0,
        explanation: '「しとしと」には、音も動きもおだやかな感じがあります。音のひびきから様子を考えてみよう。'
      },
      {
        id: 'k09', difficulty: 3,
        question: '「もやもやしている」を言いかえるなら、いちばん近いのはどれ？',
        choices: ['気持ちがはっきりしない', 'すごく元気いっぱい', '考えが全部決まっている'],
        answerIndex: 0,
        explanation: '「もやもや」は、気持ちや考えが晴れず、はっきりしない感じを表します。'
      },
      {
        id: 'k10', difficulty: 3,
        question: '文の空気として自然なのはどれ？ 「雨が上がって、空が_____してきた。」',
        choices: ['からっと', 'どろどろ', 'がたがた'],
        answerIndex: 0,
        explanation: '雨上がりの空には「からっと」が合います。場面との相性で選べる問題です。'
      }
    ]
  }
];
