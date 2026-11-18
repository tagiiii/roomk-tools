// 興味スゴロク アプリロジック
// 遊び方は2つ: 1台の画面（メンターが押す・ゲームの通信はしない）と、ルーム（各自の端末・Realtime Database）。
// ルームの決まりは logic.js。質問はテーマのキーと QUESTIONS の中の番号で共有するので、
// QUESTIONS は並べ替え・途中の削除をしない（足すのは末尾だけ）。
import { shuffle, popIn } from '../shared/js/utils.js';
import * as L from './logic.js?v=20261118more';
import { SCENE_W, sceneHeight, squarePoints, squareWidth, rowCenters, sceneElement } from './art.js?v=20261118more';

const NUMBERS = ['①', '②', '③', '④', '⑤'];

// ── テーマ & 質問データ ──
const THEMES = {
  suki:    { label: '好きなもの',       icon: 'favorite' },
  yatte:   { label: 'やってみたい',     icon: 'rocket_launch' },
  moshimo: { label: 'もしも…',          tag: 'もしも', icon: 'auto_awesome' },
  jibun:   { label: '自分のこと',       icon: 'person' },
  saikin:  { label: '最近のこと',       icon: 'today' },
  tokui:   { label: '得意・チャレンジ', icon: 'star' },
};

// 質問は文字列 or { q, choices } 形式。choices がある場合は「自由に話す」が自動で追加される。
const QUESTIONS = {
  suki: [
    '最近ハマっているものは？', '好きな食べ物は？', '好きな動物は？',
    '好きな色はどれ？その色を選ぶ理由は？', '好きな音楽やアーティストは？',
    '好きなキャラクターは誰？', '好きなゲームやアプリは？',
    '好きなお菓子は？',
    '好きな乗り物は？',
    '最近「これ最高！」と思ったものは？', '好きな言葉やフレーズは？',
    '好きなYouTubeやチャンネルは？',
    { q: '好きな天気はどんなとき？', choices: ['晴れ', '雨', '雪'] },
    { q: '家の中でいちばん好きな場所はどこ？', choices: ['自分の部屋', 'リビング', 'ベッドの中'] },
    { q: '好きな季節はいつ？', choices: ['春・夏', '秋・冬', '全部好き'] },
    '好きなにおいは何？', '好きな果物は？', '好きな飲み物は？',
    '好きなパンやおにぎりの具は？', '好きなアイスの味は？',
    '好きな麺類はある？', '好きな漫画やアニメはある？',
    '好きな効果音やBGMはある？', '好きな文房具や持ち物はある？',
    '好きなお出かけ先はどこ？', '好きな虫や生き物はいる？',
    { q: '好きな味はどれ？', choices: ['あまい', 'しょっぱい', 'さっぱり'] },
    { q: '好きなスタイルは？', choices: ['ふわふわ', 'かっこいい', 'シンプル'] },
  ],
  yatte: [
    '行ってみたい場所はどこ？', '食べてみたい料理は？',
    'やってみたい遊びやスポーツは？', '作ってみたいものはある？',
    'いつか行ってみたい国は？', '体験してみたい仕事は？',
    '習ってみたいことは？', 'チャレンジしてみたい乗り物は？',
    '見てみたい景色はある？', '友達と一緒にやってみたいことは？',
    '1人でゆっくりやってみたいことは？', '今年やってみたいことは？',
    '自分で作ってみたいゲームはどんなゲーム？',
    '育ててみたい植物や生き物はある？', '集めてみたいものはある？',
    '挑戦してみたい料理はある？', '乗ってみたい乗り物はある？',
    '見てみたいお祭りやイベントは？', '会ってみたい人はいる？',
    '試してみたい遊びはある？', '撮ってみたい写真はある？',
    '作ってみたい秘密基地はどんなの？',
    '挑戦してみたい工作やものづくりは？',
    { q: '旅に出るならどこ？', choices: ['山', '海', '街'] },
    { q: 'やってみたいのは？', choices: ['アウトドア系', 'インドア系', 'クリエイティブ系'] },
  ],
  moshimo: [
    'もし空を飛べたら最初にどこへ行く？',
    'もし無人島に1つだけ持っていくなら何？',
    'もし宇宙人に会えたら何を話す？', 'もし自分の秘密基地を作れるならどんな場所？',
    'もし3つ願いが叶うとしたら何をお願いする？',
    'もし世界中どこでも瞬間移動できたらどこに行く？',
    'もし自分のロボットがいたら何をさせる？',
    'もし1週間なんでも食べ放題だったら何を食べる？',
    'もし自分の街を作れるとしたらどんな街？',
    { q: 'もし1日だけ動物になれるとしたら何になる？', choices: ['空を飛ぶ鳥', '海の生き物', '陸の動物'] },
    { q: 'もしタイムマシンがあったらどこへ？', choices: ['過去', '未来', '今がいいからどこにも行かない'] },
    { q: 'もし魔法が1つ使えたら何のために使う？', choices: ['自分のため', '誰かのため', '世界のため'] },
    { q: 'もし透明になれたら何をする？', choices: ['いたずらする', '探検する', 'のんびり観察する'] },
    'もし1日だけ大人になれたら何をする？',
    'もし好きなだけ寝られたら何時間寝る？',
    'もし自分の声を選べるならどんな声？',
    'もし1つだけ特技がもらえるなら何？',
    'もし宝の地図を見つけたらどうする？',
    'もし自分のテーマソングを作るならどんな曲？',
    'もし1日だけ身長を自由に変えられたらどうする？',
    'もし自分の星を持てるとしたらどんな星にする？',
    { q: 'もし冒険に出るとしたら？', choices: ['1人で', '友達と', 'ペットや相棒と'] },
    { q: 'もし動物と話せるなら最初にどの動物？', choices: ['犬や猫', '鳥', '虫や魚'] },
    { q: 'もし空を飛べるなら何で飛ぶ？', choices: ['自分のつばさ', '乗り物', '魔法'] },
  ],
  jibun: [
    '自分のここが好き、と思えるところはある？',
    '自分をひとつの食べ物にたとえると何？',
    '元気がないときに自分を元気にする方法は？',
    '自分ってどんな人だと思う？一言で！',
    '大切にしているものはある？',
    'ちょっとこだわっていることはある？',
    { q: '朝型？夜型？', choices: ['朝型', '夜型', 'その時による'] },
    { q: '一人でいるのと誰かといるの、どっちが落ち着く？', choices: ['一人', '誰かと', 'どっちも好き'] },
    { q: 'のんびり派？動き回る派？', choices: ['のんびり', '動き回る', '気分次第'] },
    { q: '料理するのと食べるの、どっちが好き？', choices: ['作る', '食べる', 'どっちも'] },
    { q: '1日のうちでいちばん好きな時間帯は？', choices: ['朝', '昼', '夜'] },
    { q: 'ゲームは一人プレイ派？みんなでプレイ派？', choices: ['一人プレイ', 'みんなでプレイ', 'どっちも'] },
    '笑いのツボはどんなとこ？', 'どんなときに「これ楽しい！」ってなる？',
    'どんな音が好き？', '疲れた時どうやって休む？',
    'ちょっと自慢できることはある？', '片付けは得意？苦手？',
    '自分のラッキーカラーを決めるなら何色？',
    '好きなにおいや空気感はある？',
    { q: '出かけるなら？', choices: ['にぎやかな場所', 'しずかな場所', 'どちらも気分次第'] },
    { q: '遊ぶなら？', choices: ['外で体を動かす', '家でゆっくり', '何か作る'] },
    { q: '話すのは？', choices: ['得意', 'ちょっと苦手', '人による'] },
    { q: '自分はどっち？', choices: ['計画立てる派', 'その場で決める派', '半々'] },
  ],
  saikin: [
    '最近ちょっと笑ったことは？',
    '最近うれしかったことは？',
    '最近「おいしい！」と思ったものは？',
    '最近見た夢で覚えているものはある？',
    '最近はまっているおやつは？',
    '最近お気に入りの動画や曲は？',
    '最近誰かに「ありがとう」って思ったことは？',
    '最近新しく知ったことは？',
    '最近ちょっとした発見はあった？',
    '最近やってみた新しいことは？',
    '今いちばん楽しみにしていることは？',
    { q: '今日はどんな気分？', choices: ['げんき', 'ふつう', 'ちょっとしずか'] },
    '最近見つけたお気に入りの場所は？', '最近「きれい」と思ったものは？',
    '最近じっくり見たものは？', '最近ちょっとがんばったことは？',
    '最近ゆっくりできた時間はある？',
    '最近なんとなく気になっているものは？',
    '最近おもしろかった発見は？',
    '最近ちょっとした幸せを感じたのはどんなとき？',
    '最近心があったかくなったことは？',
    { q: '今週のコンディションは？', choices: ['絶好調', 'ふつう', 'ちょっとお休み中'] },
  ],
  tokui: [
    '自分の特技は何だと思う？',
    'もっとうまくなりたいことはある？',
    '人に教えてあげられそうなことは？',
    'ちょっと自信があることは何？',
    'コツをつかんだ！と思った瞬間は？',
    'やる前は苦手だったけど好きになったものはある？',
    '自分だけの工夫やこだわりはある？',
    '続けていることはある？',
    'ひとつだけなんでもマスターできるなら何にする？',
    { q: '集中できるのはどんなとき？', choices: ['静かな場所', '音楽を聴きながら', '誰かがそばにいるとき'] },
    '人に褒められたことで覚えていることは？',
    'これならずっと話していられる、というものはある？',
    'やっていて時間を忘れることは？',
    '最初は苦手でも続けていたら変わったことはある？',
    '誰かに頼られたことはある？どんなとき？',
    '自分なりの工夫やちょっとしたコツはある？',
    'これから伸ばしてみたい力はある？',
    '自分で「ここ成長したな」って思うところは？',
    { q: '新しいことをやるときは？', choices: ['すぐ試す派', 'じっくり考える派', '様子を見る派'] },
  ],
};

const COUNTS = Object.fromEntries(Object.entries(QUESTIONS).map(([key, list]) => [key, list.length]));

/* ── 「人生の道」モード（1台の画面だけ。2026-11-18 試作） ──
   盤は4段で、1段が1つの場面。マスの種類（えらぶ・はなす・きく・できごと）で起きることが決まる。
   質問は場面ごとで、どれも3択（チャットで参加する人も、押すだけで答えられるように。2026-11-18 オーナー）。 */
const LIFE_SCENES = [
  { key: 'chiisai', label: '小さいころ' },
  { key: 'ima', label: 'いま' },
  { key: 'mousugu', label: 'もうすぐ' },
  { key: 'otona', label: 'おとなになったら' },
];
const LIFE_KINDS = {
  erabu: { label: 'えらぶ', icon: 'checklist' },
  kiku: { label: 'きく', icon: 'forum' },
  dekigoto: { label: 'できごと', icon: 'auto_awesome' },
  // みんなが同時に選ぶマス（ルームで2人以上のときだけ出る）
  minna: { label: 'みんなで', icon: 'groups' },
  issho: { label: 'いっしょ', icon: 'diversity_3' },
  yosou: { label: 'よそう', icon: 'lightbulb' },
};
// 「えらぶ」のマス: 番の人が3つから選ぶ
const LIFE_QUESTIONS = {
  chiisai: [
    { q: '小さいころ、よく遊んだのは？', choices: ['外で走り回る', '家の中でじっくり', 'どっちもよくやった'] },
    { q: '小さいころ好きだったおやつは？', choices: ['あまいもの', 'しょっぱいもの', 'つめたいもの'] },
    { q: '小さいころ、お気に入りだったのは？', choices: ['ぬいぐるみ', '乗り物のおもちゃ', 'ブロックや積み木'] },
    { q: '小さいころの自分は？', choices: ['よくしゃべる子', 'しずかな子', '場所によってちがう'] },
    { q: '小さいころ、好きだったお話は？', choices: ['動物が出てくる話', '冒険の話', 'おもしろくて笑える話'] },
    { q: '小さいころ、雨の日は？', choices: ['水たまりで遊びたい', '家で遊びたい', '窓から見ていたい'] },
    { q: '小さいころ、夢中になっていた遊びは？', choices: ['ごっこ遊び', 'ブロックやお絵かき', '外での遊び'] },
    { q: '小さいころ、大事にしていたものは？', choices: ['ぬいぐるみや人形', 'おもちゃ', '絵本やカード'] },
    { q: '小さいころ、よく見ていたのは？', choices: ['アニメ', '動物や乗り物の番組', '歌やダンスの動画'] },
    { q: '小さいころ、行って楽しかった場所は？', choices: ['公園', '動物園や水族館', 'お店やお祭り'] },
    { q: '小さいころは苦手だったけど、今は平気な食べものは？', choices: ['野菜', 'からいもの', 'まだ苦手なものが多い'] },
    { q: '小さいころ、できるようになってうれしかったことは？', choices: ['自転車に乗ること', '泳ぐこと', '料理のお手伝い'] },
  ],
  ima: [
    { q: '休みの日の朝の自分は？', choices: ['早起きする', 'ゆっくり寝る', 'その日の気分'] },
    { q: 'いま、いちばん時間を使っているのは？', choices: ['ゲーム', '動画や音楽', '何かを作ること'] },
    { q: '元気が出るのは？', choices: ['おいしいものを食べる', '好きなことをする', 'たっぷり寝る'] },
    { q: 'いま、ほしいのは？', choices: ['新しいゲームや道具', '自分だけの時間', 'おいしいもの'] },
    { q: '集中しやすいのは？', choices: ['朝', '昼', '夜'] },
    { q: 'やりとりするなら？', choices: ['声で話す', '文字で送る', 'どっちも好き'] },
    { q: 'いま、いちばん楽しみにしていることは？', choices: ['ゲームや動画の続き', 'おいしいごはん', '出かける予定'] },
    { q: '最近「やってよかった」と思ったことは？', choices: ['新しいことを試した', '片づけや準備', 'ゆっくり休んだ'] },
    { q: 'いま、もっとくわしくなりたいものは？', choices: ['ゲームやアニメ', '生きものや自然', '機械やパソコン'] },
    { q: '最近、気に入っている場所は？', choices: ['自分の部屋', '近所のお店や公園', 'ふとんの中'] },
    { q: 'いまの自分の「ちょっといいところ」は？', choices: ['やさしいところ', '好きなことに集中できるところ', 'おもしろいところ'] },
    { q: '最近、おすすめしたいものは？', choices: ['ゲームやアプリ', '動画や音楽', '食べもの'] },
  ],
  mousugu: [
    { q: '次の休みに行くなら？', choices: ['自然の多いところ', 'にぎやかな街', '家でのんびり'] },
    { q: 'これから始めてみたいのは？', choices: ['体を動かすこと', '何かを作ること', '何かを育てること'] },
    { q: '1年後、できるようになっていたいのは？', choices: ['料理', '楽器や絵', '新しいゲームの技'] },
    { q: 'ひとりで出かけられるなら？', choices: ['近くの町へ', '遠くの県へ', '外国へ'] },
    { q: '自分の部屋を変えるなら？', choices: ['かっこよく', 'かわいく', 'すっきりシンプルに'] },
    { q: '新しく覚えるなら？', choices: ['外国の言葉', 'プログラミング', '料理やお菓子作り'] },
    { q: '近いうちにやってみたいことは？', choices: ['新しいゲーム', '料理やお菓子作り', 'どこかへおでかけ'] },
    { q: '次の誕生日にしたいことは？', choices: ['好きなものを食べる', 'ほしいものをもらう', 'のんびりすごす'] },
    { q: '次に出かけるなら、どこへ行きたい？', choices: ['遊べるところ', '買いものができるところ', '景色のいいところ'] },
    { q: 'もう少し上手になりたいことは？', choices: ['ゲーム', '絵や工作', '体を動かすこと'] },
    { q: 'これから食べてみたいものは？', choices: ['まだ食べたことのないスイーツ', '外国の料理', 'ごうかな肉や魚'] },
    { q: '1年後の自分に、ひとこと言うなら？', choices: ['元気にしてる？', '好きなこと続けてる？', '無理しないでね'] },
  ],
  otona: [
    { q: 'おとなになったら住みたいのは？', choices: ['海の近く', '山の近く', '街の中'] },
    { q: 'おとなになったら、いっしょに暮らしたいのは？', choices: ['犬', '猫', 'ほかの生きもの'] },
    { q: 'おとなになったら、乗ってみたいのは？', choices: ['車', 'バイク', '自転車でじゅうぶん'] },
    { q: 'おとなになったら、住む家は？', choices: ['広い一軒家', '景色のいい高い部屋', '小さくて落ち着く部屋'] },
    { q: 'おとなになったら、休みの日は？', choices: ['旅行に出かける', '家で好きなことをする', 'だれかと遊ぶ'] },
    { q: 'おとなになったら、朝ごはんは？', choices: ['パン', 'ごはん', 'その日の気分'] },
    { q: 'おとなになったら、やってみたいことは？', choices: ['ひとり旅', '好きなものをたくさん買う', '夜ふかし'] },
    { q: 'おとなになっても、続けていたいことは？', choices: ['ゲーム', '絵や音楽', 'のんびりすること'] },
    { q: 'おとなになったら、行ってみたいのは？', choices: ['外国', '日本のあちこち', '宇宙'] },
    { q: 'おとなになったら、どんな部屋に住みたい？', choices: ['好きなものだらけの部屋', '広くてすっきりした部屋', '秘密基地みたいな部屋'] },
    { q: 'おとなになったら、自分で買ってみたいものは？', choices: ['大きなテレビやパソコン', '乗りもの', 'おいしいものをたくさん'] },
    { q: 'どんなおとなを「いいな」と思う？', choices: ['やさしい人', 'おもしろい人', '好きなことを楽しんでいる人'] },
  ],
};
// 「きく」のマス: 番の人が相手を選び、3枚の質問から1枚を選んで聞く。聞かれた人が3つから選んで答える
const LIFE_ASK = {
  chiisai: [
    { q: '小さいころ、どんな遊びが好きだった？', choices: ['外で遊ぶ', '家で遊ぶ', '何かを作る'] },
    { q: '小さいころ、なりたかったものは？', choices: ['ヒーローやお姫さま', '動物や乗りもの', 'とくになかった'] },
    { q: '小さいころ、好きだったキャラクターは？', choices: ['かわいいキャラ', 'かっこいいキャラ', 'おもしろいキャラ'] },
    { q: '小さいころ、よく食べていたおやつは？', choices: ['あまいお菓子', 'スナックやせんべい', 'くだものやアイス'] },
    { q: '小さいころ、よく行った場所は？', choices: ['公園', 'お店', 'だれかの家'] },
  ],
  ima: [
    { q: 'いま、いちばんハマっているものは？', choices: ['ゲーム', '動画や音楽', '作ることや描くこと'] },
    { q: '最近、おいしかったものは？', choices: ['ごはんやめん', 'お菓子やデザート', '飲みもの'] },
    { q: '休みの日は何をしていることが多い？', choices: ['家でのんびり', '好きなことに集中', '出かける'] },
    { q: 'いま、ほしいものは？', choices: ['遊ぶもの', '身につけるもの', '時間'] },
    { q: '最近、思わず笑ったことは？', choices: ['動画やテレビ', 'だれかの一言', '自分のうっかり'] },
  ],
  mousugu: [
    { q: '近いうちに、楽しみにしていることは？', choices: ['発売や配信', '食べること', '出かけること'] },
    { q: 'これから行ってみたい場所は？', choices: ['近くの気になる場所', '遠くの有名な場所', 'まだ決めていない'] },
    { q: 'これから挑戦してみたいことは？', choices: ['新しい遊び', '作ること', '体を動かすこと'] },
    { q: '次の休みは何をしたい？', choices: ['ゆっくり休む', '思いきり遊ぶ', 'どこかへ行く'] },
    { q: 'これから、作ってみたいものは？', choices: ['食べもの', '絵や工作', 'ゲームや動画'] },
  ],
  otona: [
    { q: 'おとなになったら、いちばん楽しみなことは？', choices: ['好きな時間に好きなことをする', '自分で買いものをする', '遠くへ出かける'] },
    { q: 'おとなになっても、好きでいたいものは？', choices: ['いま好きなゲームや作品', 'いま好きな食べもの', 'いま好きな場所'] },
    { q: 'おとなになったら、どこに住んでみたい？', choices: ['いまの町', 'にぎやかな都会', '自然の多いところ'] },
    { q: 'おとなになったら、どんな毎日がいい？', choices: ['のんびりした毎日', 'いそがしくて楽しい毎日', '毎日ちがうことが起きる'] },
    { q: 'おとなって、どんなところが楽しそう？', choices: ['自由なところ', '自分で決められるところ', 'まだよくわからない'] },
  ],
};
// 「みんなで」のマス: お題に合うものを、番の人から順に1つずつ選ぶ（ほかの人が選んだものは選べない）。
// ルームでは番号で共有するので、お題も、その中の並びも、並べ替え・途中の削除をしない（足すのは末尾だけ）
const LIFE_MINNA = [
  { title: '好きなくだもの', options: ['いちご', 'バナナ', 'りんご', 'みかん', 'ぶどう', 'もも', 'メロン', 'すいか', 'パイナップル', 'さくらんぼ', 'キウイ', 'なし'] },
  { title: '好きなおやつ', options: ['チョコ', 'アイス', 'ポテトチップス', 'クッキー', 'グミ', 'プリン', 'ドーナツ', 'せんべい', 'ケーキ', 'あめ', 'ポップコーン', 'たいやき'] },
  { title: '好きな動物', options: ['犬', '猫', 'うさぎ', 'パンダ', 'ペンギン', 'ライオン', 'ぞう', 'きりん', 'イルカ', 'ハムスター', 'コアラ', 'カワウソ'] },
  { title: '好きな色', options: ['赤', '青', '黄色', '緑', 'オレンジ', 'ピンク', '紫', '水色', '白', '黒', '茶色', '金色'] },
  { title: '乗ってみたい乗りもの', options: ['自転車', '電車', 'バス', '飛行機', '船', '新幹線', '車', 'ロケット', '気球', 'モノレール', 'バイク', 'ヘリコプター'] },
  { title: '好きなごはん', options: ['カレー', 'ラーメン', 'すし', 'ハンバーグ', 'からあげ', 'オムライス', 'ピザ', 'うどん', 'やきそば', 'おにぎり', 'パスタ', 'ぎょうざ'] },
  { title: '行ってみたい場所', options: ['海', '山', '遊園地', '水族館', '動物園', '温泉', 'お祭り', 'キャンプ場', '映画館', 'ゲームセンター', '公園', '牧場'] },
  { title: '好きな飲みもの', options: ['水', 'お茶', '牛乳', 'ココア', 'オレンジジュース', 'りんごジュース', 'サイダー', 'コーラ', 'スープ', 'いちごミルク', 'レモネード', 'むぎ茶'] },
];
// 「できごと」のマス。move: その人が進む / all: みんなが進む / again: もう一度サイコロ
const LIFE_EVENTS = [
  { text: '追い風がふいた！', effect: '2マス進む', move: 2 },
  { text: '近道を見つけた！', effect: '3マス進む', move: 3 },
  { text: 'いい天気で足取りが軽い。', effect: '1マス進む', move: 1 },
  { text: '流れ星を見た！', effect: '2マス進む', move: 2 },
  { text: '道でどんぐりをひろった。', effect: '1マス進む', move: 1 },
  { text: '四つ葉のクローバーを見つけた！', effect: 'もう一度サイコロを振れる', again: true },
  { text: 'みんなでおやつタイム。', effect: 'みんな1マス進む', all: 1 },
  { text: 'にじが出た！', effect: 'みんな1マス進む', all: 1 },
  { text: 'ベンチでひとやすみ。景色をながめよう。', effect: 'ここでひと息', move: 0 },
];

// ルームの決まり（logic.js）に、中身の形だけを渡す（番号で共有する）
L.setLifeContent({
  scenes: LIFE_SCENES.map((sc) => sc.key),
  erabu: Object.fromEntries(LIFE_SCENES.map((sc) => [sc.key, LIFE_QUESTIONS[sc.key].length])),
  kiku: Object.fromEntries(LIFE_SCENES.map((sc) => [sc.key, LIFE_ASK[sc.key].length])),
  events: LIFE_EVENTS.map((ev) => ({ move: ev.move || 0, all: ev.all || 0, again: !!ev.again })),
  minna: LIFE_MINNA.map((theme) => theme.options.length),
});
const lifeScene = (key) => LIFE_SCENES.find((sc) => sc.key === key) || LIFE_SCENES[0];
// 盤の形（列・マスの種類・段の名前）
function lifeView(game) {
  return { cols: L.boardSize(game) / L.LIFE_ROWS, kinds: L.lifeKindsOf(game), labels: LIFE_SCENES.map((sc) => sc.label) };
}

// 質問を { q, choices } 形式に正規化
function normalizeQ(item) {
  return typeof item === 'string' ? { q: item, choices: null } : item;
}

// ── DOM ──
const $ = (id) => document.getElementById(id);

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function msIcon(name) {
  const node = makeElement('span', 'material-symbols-rounded', name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function toast(message, isError = true) {
  RoomkRTDB.showToast(message, isError);
}

const SCREENS = ['top', 'settings', 'create', 'join', 'waiting', 'game'];
function showScreen(name) {
  SCREENS.forEach((s) => { $('screen-' + s).hidden = s !== name; });
  // 説明の1行はトップだけ（ほかの画面では盤や質問を上に寄せる）
  $('headerSub').hidden = name !== 'top';
}

// ── 盤とコマ（1台の画面・ルーム共通） ──
// items: [{ name, current, tags: [文字] }]
function renderIndicator(items) {
  const ind = $('indicator');
  ind.replaceChildren();
  items.forEach((p, i) => {
    const label = makeElement('span', `ks-player-label ks-pawn--${i}${p.current ? ' is-current' : ''}`);
    label.appendChild(makeElement('span', `ks-pawn ks-pawn--${i}`, i + 1));
    label.appendChild(makeElement('span', 'ks-player-label__name', p.name));
    (p.tags || []).forEach((tag) => label.appendChild(makeElement('span', 'ks-tag', tag)));
    if (p.cards) {
      const badge = makeElement('span', 'ks-cardbadge');
      badge.append(msIcon('redeem'), document.createTextNode(String(p.cards)));
      badge.setAttribute('aria-label', `おたすけカード ${p.cards}枚`);
      badge.title = `おたすけカード ${p.cards}枚`;
      label.appendChild(badge);
    }
    ind.appendChild(label);
  });
}

// サイコロ。数字は読み上げ用に文字で持ち、見た目は目（data-n）で出す
function setDice(value) {
  const dice = $('dice');
  const text = String(value);
  if (dice.textContent !== text) dice.textContent = text;
  if (/^[1-6]$/.test(text)) dice.dataset.n = text;
  else delete dice.dataset.n;
}
function setDiceRolling(on) {
  $('dice').classList.toggle('is-rolling', !!on);
}

// 盤: 景色の中を通る道（蛇行）。positions はプレイヤー順のマスの番号、current はいまの番の人
// マスとコマの要素は作りなおさず、動いたコマだけ移す（跳ねる動きをとちゅうで切らないため）
const boardView = { key: '', total: 0, count: 0, squares: [], pawns: [], pos: [] };
// view: { cols, kinds: [マスの種類…], labels: [段の名前…] }（「人生の道」だけ。ないときは5列・番号のマス）
function buildBoard(total, count, view) {
  const board = $('board');
  const cols = view?.cols || 5;
  const h = sceneHeight(total, cols);
  board.replaceChildren(sceneElement(total, cols));
  board.style.setProperty('--ks-ratio', `${SCENE_W} / ${h}`);
  board.style.setProperty('--ks-stone', `${squareWidth(cols)}%`);
  board.classList.toggle('is-life', !!view?.kinds);
  (view?.labels || []).forEach((text, r) => {
    const cy = rowCenters(total, cols)[r];
    if (cy == null) return;
    const label = makeElement('span', `ks-board__label ks-board__label--${r}`, text);
    label.style.top = `${((cy - 71) / h) * 100}%`;
    board.appendChild(label);
  });
  boardView.squares = squarePoints(total, cols).map((pt, i) => {
    const isGoal = i === total - 1;
    const sq = makeElement('div', `ks-square ks-square--c${i % 4}` + (isGoal ? ' is-goal' : '') + (i === 0 ? ' is-start' : ''));
    sq.style.left = `${(pt.x / SCENE_W) * 100}%`;
    sq.style.top = `${(pt.y / h) * 100}%`;
    sq.appendChild(makeElement('span', 'ks-square__num', isGoal ? 'G' : i === 0 ? 'S' : i));
    const kind = !isGoal && i > 0 ? view?.kinds?.[i] : null;
    if (kind && LIFE_KINDS[kind]) {
      sq.classList.add(`ks-square--k-${kind}`);
      const icon = msIcon(LIFE_KINDS[kind].icon);
      icon.classList.add('ks-square__icon');
      sq.appendChild(icon);
    }
    sq.appendChild(makeElement('span', 'ks-square__pawns'));
    sq.addEventListener('animationend', (e) => { if (e.animationName === 'ks-bump') sq.classList.remove('is-bump'); });
    board.appendChild(sq);
    return sq;
  });
  boardView.pawns = Array.from({ length: count }, (_, idx) => {
    const pawn = makeElement('span', `ks-pawn ks-pawn--${idx}`, idx + 1);
    pawn.dataset.idx = String(idx);
    pawn.addEventListener('animationend', (e) => { if (e.animationName === 'ks-hop') pawn.classList.remove('is-hop'); });
    return pawn;
  });
  boardView.pos = Array(count).fill(null);
  boardView.total = total;
  boardView.count = count;
}
function boardKey(total, count, view) {
  return [total, count, view?.cols || 5, view?.kinds ? view.kinds.join('') : ''].join(':');
}
function restartAnimation(el, name) {
  el.classList.remove(name);
  void el.offsetWidth;
  el.classList.add(name);
}
function renderBoard(total, positions, current = -1, view = null) {
  const key = boardKey(total, positions.length, view);
  if (boardView.key !== key || !$('board').firstChild) {
    buildBoard(total, positions.length, view);
    boardView.key = key;
  }
  positions.forEach((raw, idx) => {
    const pos = Math.max(0, Math.min(total - 1, Number(raw) || 0));
    const pawn = boardView.pawns[idx];
    const prev = boardView.pos[idx];
    if (prev !== pos) {
      // 同じマスの中は、いつも番号の順に並べる
      const box = boardView.squares[pos].querySelector('.ks-square__pawns');
      const after = [...box.children].find((el) => Number(el.dataset.idx) > idx) || null;
      box.insertBefore(pawn, after);
      boardView.pos[idx] = pos;
      // 進んだときだけ跳ねる（はじめの配置・最初にもどるときは動かさない）
      if (prev != null && pos > prev) {
        restartAnimation(pawn, 'is-hop');
        restartAnimation(boardView.squares[pos], 'is-bump');
      } else {
        pawn.classList.remove('is-hop');
      }
    }
    pawn.classList.toggle('is-current', idx === current);
  });
}

// ゴールの紙ふぶき（動きを減らす設定の人には出さない）
const CONFETTI_COLORS = ['#F2A65A', '#F7A1B5', '#8FCBE0', '#8AC76A', '#F6D25A', '#C7A5E8'];
function celebrate() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelector('.ks-confetti')?.remove();
  const layer = makeElement('div', 'ks-confetti');
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 44; i++) {
    const piece = makeElement('span', 'ks-confetti__piece' + (i % 3 === 0 ? ' is-round' : ''));
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDelay = `${Math.random() * 0.9}s`;
    piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
    piece.style.setProperty('--ks-drift', `${Math.round((Math.random() - 0.5) * 160)}px`);
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 5000);
}

// 質問のカード。1台の画面ではモーダルの中、ルームでは画面の中（#roomStage）に置く
// opts: { playerIndex, dice, canPress, onChoose, showNext, showSkip, waitText }
function fillQuestion(themeKey, item, playerName, opts) {
  // opts.head: { key, icon, label }（「人生の道」の場面とマスの種類）。ないときはテーマ
  const t = opts.head || { key: themeKey, icon: THEMES[themeKey].icon, label: THEMES[themeKey].label };
  $('questionCard').dataset.theme = t.key;
  $('modal-theme').replaceChildren(msIcon(t.icon), document.createTextNode(' ' + t.label));
  // 宛先は、その人のコマの色の番号を添えて出す（盤のコマと見比べられるように）
  $('modal-player').replaceChildren(
    makeElement('span', `ks-pawn ks-pawn--${opts.playerIndex}`, opts.playerIndex + 1),
    document.createTextNode(opts.toText || `${playerName} さんへ`),
  );
  // ルームでは、サイコロの出た目をカードに出す（サイコロの欄は質問の間かくす）
  $('modal-dice').hidden = !opts.dice;
  $('modal-dice').replaceChildren(msIcon('casino'), document.createTextNode(opts.dice ? ` ${opts.dice}` : ''));
  $('modal-question').textContent = item.q;

  const choicesEl = $('modal-choices');
  choicesEl.replaceChildren();
  if (item.choices && item.choices.length) {
    item.choices.forEach((c, i) => {
      const btn = makeElement('button', 'ks-choice');
      btn.type = 'button';
      btn.appendChild(makeElement('span', 'ks-choice__num', NUMBERS[i]));
      btn.appendChild(makeElement('span', 'ks-choice__text', c));
      btn.disabled = !opts.canPress;
      btn.addEventListener('click', () => opts.onChoose(i));
      choicesEl.appendChild(btn);
    });
    if (!opts.noFree) {
      const free = makeElement('button', 'ks-choice ks-choice--free');
      free.type = 'button';
      free.append(msIcon(opts.freeIcon || 'chat'), document.createTextNode(opts.freeLabel || '自由に話す'));
      free.disabled = !opts.canPress;
      // freeWrites: 「自由に話す」を押したら、ひとこと書く欄を出す（書かずに進んでもよい）
      free.addEventListener('click', () => (opts.freeWrites ? openWrite((text) => opts.onChoose(L.CHOICE_FREE, text)) : opts.onChoose(L.CHOICE_FREE)));
      choicesEl.appendChild(free);
    }
  }
  $('modal-effect').hidden = !opts.effect;
  $('modal-effect').textContent = opts.effect || '';
  $('btn-next').replaceChildren(msIcon(opts.nextIcon || 'check'), document.createTextNode(' ' + (opts.nextLabel || '話せた！次の人へ')));
  $('btn-next').style.display = opts.showNext ? '' : 'none';
  $('btn-skip').style.display = opts.showSkip ? '' : 'none';
  $('btnOpenVotes').style.display = opts.showOpen ? '' : 'none';
  $('btn-skip').replaceChildren(msIcon(opts.skipIcon || 'refresh'), document.createTextNode(' ' + (opts.skipLabel || '別の質問')));
  $('modal-actions').hidden = !opts.showNext && !opts.showSkip && !opts.showOpen;
  $('modal-voters').hidden = true;
  $('modal-wait').hidden = !opts.waitText;
  $('modal-wait').textContent = opts.waitText || '';
}

// 前の人が選んだもの。選ぶと次の人の番になり、次にサイコロが振られるまで盤の上に出す
// pick: { playerIndex, name, item, choice } または null
function renderPick(pick) {
  $('lastPick').hidden = !pick;
  if (!pick) return;
  $('pickWho').replaceChildren(
    makeElement('span', `ks-pawn ks-pawn--${pick.playerIndex}`, pick.playerIndex + 1),
    document.createTextNode(pick.title || `${pick.name} さんが選んだもの`),
  );
  $('pickQ').textContent = pick.item.q;
  // 「自由に話す」で書いた文があれば、それを出す
  const label = pick.choice === L.CHOICE_FREE ? (pick.text ? `「${pick.text}」` : '自由に話す') : (pick.item.choices?.[pick.choice] ?? '');
  $('pickA').replaceChildren(msIcon(pick.choice === L.CHOICE_FREE ? 'chat' : 'check_circle'), document.createTextNode(label));
}

const CHOICE_HINT = '選ぶと、次の人の番になるよ';

// 「自由に話す」のとき、ひとこと書いて添えられる（書かなくてもよい）。send(文) で次の人へ
const writeState = { send: null };
function openWrite(send) {
  writeState.send = send;
  $('writeText').value = '';
  $('questionCard').classList.add('is-writing');
  $('modal-write').hidden = false;
  $('writeText').focus();
}
function closeWrite() {
  writeState.send = null;
  $('questionCard').classList.remove('is-writing');
  $('modal-write').hidden = true;
}
function sendWrite() {
  const send = writeState.send;
  if (!send) return;
  const text = L.cleanText($('writeText').value);
  closeWrite();
  send(text);
}

// 質問とゴールのカードを、1台の画面ではモーダルに、ルームでは画面の中に置く
function placeCards(inRoom) {
  if (inRoom) {
    $('roomStage').append($('questionCard'), $('goalCard'));
  } else {
    $('modal').appendChild($('questionCard'));
    $('goal-modal').appendChild($('goalCard'));
    $('questionCard').hidden = false;
    $('goalCard').hidden = false;
  }
}

/* ════════════ 1台の画面（メンターが押す。通信しない） ════════════ */

const local = {
  players: [],
  currentIndex: 0,
  totalSquares: 15,
  themes: [],
  rolling: false,
  ended: false,
  history: [],
  pools: {},
  currentQ: null,
  lastPick: null,
  diceTimer: null,
  moveTimer: null,
};

function clearTimers() {
  if (local.diceTimer) { clearInterval(local.diceTimer); local.diceTimer = null; }
  if (local.moveTimer) { clearTimeout(local.moveTimer); local.moveTimer = null; }
}

const settings = { mode: 'theme', lifeLen: 0, playerCount: 2, totalSquares: 15, names: Array(L.MAX_PLAYERS).fill('') };

function buildToggle(containerId, options, selectedValue, onChange) {
  const el = $(containerId);
  el.replaceChildren();
  options.forEach(({ value, label }) => {
    const btn = makeElement('button', 'ks-toggle__btn', label);
    btn.type = 'button';
    btn.dataset.value = value;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(value === selectedValue));
    if (value === selectedValue) btn.classList.add('is-selected');
    btn.addEventListener('click', () => {
      selectToggle(el, value);
      onChange(value);
    });
    el.appendChild(btn);
  });
}

function selectToggle(el, value) {
  el.querySelectorAll('.ks-toggle__btn').forEach((b) => {
    const on = String(b.dataset.value) === String(value);
    b.classList.toggle('is-selected', on);
    b.setAttribute('aria-checked', String(on));
  });
}

// テーマのチェックボックス（1台の画面の設定と、ルームの待合室）
function buildThemeList(containerId, onChange) {
  const list = $(containerId);
  list.replaceChildren();
  Object.entries(THEMES).forEach(([key, t]) => {
    const label = makeElement('label', 'ks-theme');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = key;
    input.checked = true;
    if (onChange) input.addEventListener('change', () => onChange(input));
    const box = makeElement('span', 'ks-theme__box');
    box.append(msIcon(t.icon), document.createTextNode(t.label));
    label.append(input, box);
    list.appendChild(label);
  });
}

// 名前欄（任意）。人数を変えても入れた名前は残す
function renderNameInputs() {
  const el = $('player-names');
  el.innerHTML = '';
  for (let i = 0; i < settings.playerCount; i++) {
    const row = document.createElement('label');
    row.className = 'ks-name';
    const pawn = document.createElement('span');
    pawn.className = `ks-pawn ks-pawn--${i}`;
    pawn.textContent = i + 1;
    row.appendChild(pawn);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input ks-name__input';
    input.maxLength = L.NAME_MAX;
    input.autocomplete = 'off';
    input.placeholder = `プレイヤー${i + 1}`;
    input.setAttribute('aria-label', `${i + 1}人目の名前`);
    input.value = settings.names[i];
    input.addEventListener('input', () => { settings.names[i] = input.value; });
    row.appendChild(input);
    el.appendChild(row);
  }
}

function initSettings() {
  buildToggle('player-count',
    Array.from({ length: L.MAX_PLAYERS }, (_, i) => i + 1).map((n) => ({ value: n, label: `${n}人` })),
    settings.playerCount,
    (v) => { settings.playerCount = v; renderNameInputs(); renderModeFields(); }
  );
  renderNameInputs();
  buildToggle('mode-toggle',
    [{ value: 'theme', label: 'テーマで話す' }, { value: 'life', label: '人生の道' }],
    settings.mode,
    (v) => { settings.mode = v; renderModeFields(); }
  );
  buildToggle('life-length',
    [{ value: -1, label: 'みじかい' }, { value: 0, label: 'ふつう' }, { value: 1, label: 'ながい' }],
    settings.lifeLen,
    (v) => { settings.lifeLen = v; renderModeFields(); }
  );
  renderModeFields();
  buildToggle('square-count',
    L.SQUARE_OPTIONS.map((n) => ({ value: n, label: `${n}マス` })),
    settings.totalSquares,
    (v) => { settings.totalSquares = v; }
  );
  buildThemeList('theme-list');
  $('btn-start').addEventListener('click', startLocalGame);
}

// 「人生の道」のマス数: 人数に合わせた数から、みじかい・ながいで1段階ずらす
function lifeSize() {
  return L.lifeSizeFor(settings.playerCount, settings.lifeLen);
}
function renderModeFields() {
  const life = settings.mode === 'life';
  $('field-squares').hidden = life;
  $('field-themes').hidden = life;
  $('field-length').hidden = !life;
  $('mode-note').textContent = life
    ? '小さいころから、おとなになったらまで。4つの場面をたどって、みんながゴールしたらおわり。'
    : '止まったマスで、選んだテーマの質問に答える。だれかがゴールしたらおわり。';
  $('life-length-note').textContent = `${lifeSize()}マス`;
}

function showError(msg) {
  const el = $('settings-error');
  el.textContent = msg;
  el.classList.add('visible');
}
function clearError() { $('settings-error').classList.remove('visible'); }

function startLocalGame() {
  clearError();
  const life = settings.mode === 'life';
  const themes = Array.from(document.querySelectorAll('#theme-list input:checked'))
    .map((cb) => cb.value);
  if (!life && themes.length < L.MIN_THEMES) {
    showError('テーマを2つ以上選んでね。');
    return;
  }

  const players = [];
  for (let i = 0; i < settings.playerCount; i++) {
    const name = settings.names[i].trim().slice(0, L.NAME_MAX);
    players.push({ name: name || `プレイヤー${i + 1}`, pos: 0 });
  }

  local.players = players;
  local.currentIndex = 0;
  if (life) {
    startLocalLife(players.map((p) => p.name));
    return;
  }
  endLocalLife();
  local.totalSquares = settings.totalSquares;
  $('lifeLegend').hidden = true;
  local.themes = themes;
  local.rolling = false;
  local.ended = false;
  local.history = [];
  local.lastPick = null;
  local.pools = {};
  themes.forEach((t) => { local.pools[t] = shuffle(QUESTIONS[t]); });

  window.RoomkStats?.count('start-local');
  showScreen('game');
  $('btn-back').hidden = false;
  $('btnRoomBack').hidden = true;
  $('roomStage').hidden = true;
  $('btn-roll').hidden = false;
  renderLocalGame();
}

function renderLocalGame() {
  renderIndicator(local.players.map((p, i) => ({ name: p.name, current: i === local.currentIndex && !local.ended })));
  // だれの番かを1行で（ルームと同じ）
  const name = local.players[local.currentIndex].name;
  $('turnNote').hidden = local.ended;
  $('turnNote').textContent = local.rolling ? `${name}さんがサイコロを振ったよ` : `${name}さんの番だよ`;
  renderPick(local.lastPick);
  renderBoard(local.totalSquares, local.players.map((p) => p.pos), local.ended ? -1 : local.currentIndex);
  $('btn-roll').disabled = local.rolling || local.ended;
}

function rollLocalDice() {
  if (local.rolling || local.ended) return;
  local.rolling = true;
  local.lastPick = null; // 前の人が選んだものは、次のサイコロで消す
  renderLocalGame();
  let ticks = 0;
  setDiceRolling(true);
  local.diceTimer = setInterval(() => {
    setDice(Math.floor(Math.random() * 6) + 1);
    if (++ticks >= 10) {
      clearInterval(local.diceTimer);
      local.diceTimer = null;
      const n = Math.floor(Math.random() * 6) + 1;
      setDice(n);
      setDiceRolling(false);
      moveLocalPawn(n);
    }
  }, 60);
}

function moveLocalPawn(steps) {
  const player = local.players[local.currentIndex];
  const max = local.totalSquares - 1;
  let remaining = steps;
  const step = () => {
    if (remaining <= 0 || player.pos >= max) {
      if (player.pos >= max) {
        local.ended = true;
        renderLocalGame();
        showLocalGoal(player);
        return;
      }
      showLocalQuestion();
      return;
    }
    player.pos++;
    remaining--;
    renderLocalGame();
    local.moveTimer = setTimeout(step, 250);
  };
  step();
}

function pickLocalTheme() {
  const themes = local.themes;
  const last = local.history[local.history.length - 1]?.theme;
  const pool = themes.length > 1 ? themes.filter((t) => t !== last) : themes;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickLocalQuestion(theme) {
  if (!local.pools[theme] || local.pools[theme].length === 0) {
    local.pools[theme] = shuffle(QUESTIONS[theme]);
  }
  return normalizeQ(local.pools[theme].shift());
}

function renderLocalModal() {
  const { theme, question } = local.currentQ;
  const player = local.players[local.currentIndex];
  const hasChoices = !!(question.choices && question.choices.length);
  // 選択肢がある場合は、選ぶと次の人の番になる（選んだものは盤の上に残る。「話せた！次の人へ」は出さない）
  fillQuestion(theme, question, player.name, {
    playerIndex: local.currentIndex,
    dice: null,
    canPress: true,
    onChoose: chooseLocal,
    freeWrites: true,
    showNext: !hasChoices,
    showSkip: true,
    waitText: hasChoices ? CHOICE_HINT : '',
  });
}

function showLocalQuestion() {
  const theme = pickLocalTheme();
  const question = pickLocalQuestion(theme);
  local.currentQ = { theme, question };
  renderLocalModal();

  const modal = $('modal');
  modal.style.display = 'flex';
  popIn($('questionCard'));
}

function chooseLocal(choice, text = '') {
  const player = local.players[local.currentIndex];
  local.lastPick = { playerIndex: local.currentIndex, name: player.name, item: local.currentQ.question, choice, text: L.cleanText(text) };
  closeLocalQuestion();
}

function closeLocalQuestion() {
  closeWrite();
  local.history.push(local.currentQ);
  $('modal').style.display = 'none';
  local.currentIndex = (local.currentIndex + 1) % local.players.length;
  local.rolling = false;
  setDiceRolling(false);
  setDice('?');
  renderLocalGame();
}

function skipLocalQuestion() {
  closeWrite();
  // 別の質問を出す（テーマは維持）
  const theme = local.currentQ.theme;
  local.currentQ = { theme, question: pickLocalQuestion(theme) };
  renderLocalModal();
  popIn($('questionCard'));
}

function showLocalGoal(winner) {
  $('goal-title').textContent = 'ゴール！';
  $('goal-name').textContent = `${winner.name} さん、おめでとう！`;
  $('goal-wait').hidden = true;
  $('btn-restart').hidden = false;
  $('btnGoalSettings').hidden = false;
  const m = $('goal-modal');
  m.style.display = 'flex';
  popIn($('goalCard'));
  celebrate();
}

// 「人生の道」のカード（1台の画面・ルーム共通）
// c: { kind, scene, phase, question, cards: [質問の文…], event, target（聞く相手の文。まだなら null）, answerer（答える人の名前。人のとき）,
//      others: [名前…], playerName（番の人）, playerIndex, dice, act（この画面で押せるか）, onChoose }
function fillLifeCard(c) {
  const kind = LIFE_KINDS[c.kind];
  const base = {
    head: {
      key: c.scene ? 'life-' + c.scene.key : 'life-event',
      icon: kind.icon,
      label: c.scene ? `${c.scene.label}・${kind.label}` : kind.label,
    },
    playerIndex: c.playerIndex,
    dice: c.dice || null,
    canPress: c.act,
    onChoose: c.onChoose,
  };
  const who = c.playerName;
  if (c.kind === 'dekigoto') {
    const ev = c.event;
    fillQuestion(null, { q: ev.text, choices: null }, who, {
      ...base, toText: `${who} さんのできごと`, effect: ev.effect,
      showNext: c.act, showSkip: false,
      nextLabel: ev.again ? 'もう一度サイコロを振る' : ev.move === 0 ? '次の人へ' : '進む',
      nextIcon: ev.again ? 'casino' : 'arrow_forward',
      waitText: c.act ? '' : `${who}さんが進めるのを待ってね`,
    });
  } else if (c.kind === 'kiku' && c.phase === L.PHASE.WHO) {
    // だれに聞くかを選ぶ
    fillQuestion(null, { q: 'だれに聞く？', choices: c.others.map((name) => `${name} さんに聞く`) }, who, {
      ...base, toText: `${who} さんが、だれかに聞く番`, freeLabel: 'みんなに聞く', freeIcon: 'groups',
      showNext: false, showSkip: false,
      waitText: c.act ? '聞く相手を選んでね' : `${who}さんが、聞く相手を選んでいるよ`,
    });
  } else if (c.kind === 'kiku' && c.phase === L.PHASE.CARD) {
    // 3枚の質問から1枚を選ぶ
    fillQuestion(null, { q: 'どの質問にする？', choices: c.cards }, who, {
      ...base, toText: `${who} さんから、${c.target}へ`, noFree: true,
      showNext: false, showSkip: c.act,
      waitText: c.act ? '聞きたい質問を選んでね' : `${who}さんが、質問を選んでいるよ`,
    });
  } else if (c.kind === 'kiku' && c.answerer) {
    // 聞かれた人が、3つから選んで答える
    fillQuestion(null, c.question, who, {
      ...base, toText: `${who} さんから、${c.target}へ`, freeWrites: true,
      showNext: false, showSkip: c.act,
      waitText: c.act ? '選ぶと、次の人の番になるよ。答えにくいときは「別の質問」に変えてね' : `${c.answerer}さんが選ぶと、次の人の番になるよ`,
    });
  } else if (c.kind === 'kiku') {
    // みんな・そばにいる人に聞いたとき: 声やチャットで答える（選択肢は見るだけ）
    fillQuestion(null, c.question, who, {
      ...base, toText: `${who} さんから、${c.target}へ`, canPress: false, noFree: true,
      showNext: c.act, showSkip: c.act,
      waitText: '声やチャットで答えてね',
    });
  } else {
    fillQuestion(null, c.question, who, {
      ...base, freeWrites: true, showNext: false, showSkip: c.act,
      waitText: c.act ? CHOICE_HINT : `${who}さんが選ぶと、次の人の番になるよ`,
    });
  }
}
// 「みんなで」のカード: お題に合うものを、番の人から順に1つずつ選ぶ
// c: { scene, theme: { title, options }, picks, order, picker（いま選ぶ人の番号。みんな選んだら null）, playerName, playerIndex, dice, act, busy }
function fillMinnaCard(c) {
  const kind = LIFE_KINDS.minna;
  const who = c.playerName;
  const complete = c.picker == null && Object.keys(c.picks).length > 0;
  const started = Object.keys(c.picks).length > 0;
  fillQuestion(null, { q: `${c.theme.title}を、1つずつ選ぼう`, choices: null }, who, {
    head: { key: 'life-' + c.scene.key, icon: kind.icon, label: `${c.scene.label}・${kind.label}` },
    playerIndex: c.picker != null ? c.picker : c.playerIndex,
    dice: c.dice || null,
    canPress: false,
    onChoose: () => {},
    toText: complete ? 'みんな選べたね' : `${c.order[c.picker] ?? who} さんの番（ほかの人が選んだものは選べないよ）`,
    effect: complete ? 'みんな選べた！ みんな1マス進む' : '',
    // みんな選んだら「進む」。お題を変えられるのは、だれかが選ぶ前だけ
    showNext: complete && c.act, showSkip: !started && c.act,
    nextLabel: '進む', nextIcon: 'arrow_forward',
    skipLabel: '別のお題',
    waitText: complete ? (c.act ? '' : `${who}さんが進めるのを待ってね`) : (c.act ? '好きなものを1つ選んでね' : `${c.order[c.picker]}さんが選んでいるよ`),
  });
  const choicesEl = $('modal-choices');
  choicesEl.replaceChildren();
  const grid = makeElement('div', 'ks-minna');
  const taken = {};
  Object.keys(c.picks).forEach((i) => { taken[c.picks[i]] = Number(i); });
  c.theme.options.forEach((text, i) => {
    const by = taken[i];
    const btn = makeElement('button', 'ks-minna__item' + (by != null ? ' is-taken' : ''));
    btn.type = 'button';
    btn.appendChild(makeElement('span', 'ks-minna__text', text));
    if (by != null) {
      btn.appendChild(makeElement('span', `ks-pawn ks-pawn--${by}`, by + 1));
      btn.setAttribute('aria-label', `${text}（${c.order[by]} さんが選んだ）`);
    }
    btn.disabled = by != null || complete || !c.act || c.busy;
    btn.addEventListener('click', () => roomChoose(i));
    grid.appendChild(btn);
  });
  choicesEl.appendChild(grid);
}

// みんなが同時に選ぶマス（いっしょ・よそう）のカード。
// c: { kind, scene, question, votes, open, order, turn, allowed: [この画面で選べる人の番号…], waiting: [まだ選んでいない人の番号…],
//      result（開いたあと）, playerName, playerIndex, dice, act（番の人かホスト）, busy }
function fillVoteCard(c) {
  const kind = LIFE_KINDS[c.kind];
  const who = c.playerName;
  const issho = c.kind === L.KIND.ISSHO;
  const base = {
    head: { key: 'life-' + c.scene.key, icon: kind.icon, label: `${c.scene.label}・${kind.label}` },
    playerIndex: c.playerIndex,
    dice: c.dice || null,
    canPress: false,
    onChoose: () => {},
  };
  const choicesEl = $('modal-choices');
  const votersEl = $('modal-voters');
  if (!c.open) {
    // ── 選ぶ ──
    const total = c.waiting.length + Object.keys(c.votes).length;
    const waitText = c.waiting.length
      ? `選んだ人 ${total - c.waiting.length}／${total}人（まだ: ${c.waiting.map((i) => c.order[i]).join('・')}）`
      : '';
    fillQuestion(null, { q: c.question.q, choices: null }, who, {
      ...base,
      toText: issho ? 'みんなで選ぼう。番の人と同じだったら進めるよ' : `${who} さんはどれを選ぶ？ みんなで予想しよう`,
      showNext: false, showSkip: c.act, showOpen: c.act,
      waitText,
    });
    // だれのぶんを選ぶか（ホストが、端末のない人・つながっていない人のぶんも入れるとき）
    if (!c.allowed.includes(net.voteFor)) net.voteFor = c.allowed.find((i) => c.votes[i] == null) ?? c.allowed[0] ?? null;
    const voter = net.voteFor;
    votersEl.replaceChildren();
    votersEl.hidden = c.allowed.length < 2;
    if (c.allowed.length >= 2) {
      votersEl.appendChild(makeElement('span', 'ks-voters__label', 'だれのぶんを選ぶ？'));
      c.allowed.forEach((i) => {
        const chip = makeElement('button', 'ks-voters__chip' + (i === voter ? ' is-selected' : ''));
        chip.type = 'button';
        chip.setAttribute('aria-pressed', String(i === voter));
        chip.append(makeElement('span', `ks-pawn ks-pawn--${i}`, i + 1), document.createTextNode(c.order[i]));
        if (c.votes[i] != null) chip.appendChild(msIcon('check_circle'));
        chip.addEventListener('click', () => { net.voteFor = i; if (net.room) renderRoom(net.room); });
        votersEl.appendChild(chip);
      });
    }
    choicesEl.replaceChildren();
    if (voter != null) {
      const self = voter === c.turn;
      const lead = issho || self
        ? `${c.order[voter]} さんの答えを選んでね（開くまで、ほかの人には見えないよ）`
        : `${c.order[voter]} さんの予想を選んでね（開くまで、ほかの人には見えないよ）`;
      choicesEl.appendChild(makeElement('p', 'ks-vote__lead', lead));
      c.question.choices.forEach((text, i) => {
        const btn = makeElement('button', 'ks-choice' + (c.votes[voter] === i ? ' is-chosen' : ''));
        btn.type = 'button';
        btn.appendChild(makeElement('span', 'ks-choice__num', NUMBERS[i]));
        btn.appendChild(makeElement('span', 'ks-choice__text', text));
        if (c.votes[voter] === i) btn.appendChild(msIcon('check_circle'));
        btn.setAttribute('aria-pressed', String(c.votes[voter] === i));
        btn.disabled = c.busy;
        btn.addEventListener('click', () => roomVote(voter, i));
        choicesEl.appendChild(btn);
      });
    } else {
      // この画面では選べない（番の進行だけのホストなど）: 選択肢を見るだけ
      c.question.choices.forEach((text, i) => {
        const row = makeElement('div', 'ks-result');
        row.append(makeElement('span', 'ks-choice__num', NUMBERS[i]), makeElement('span', 'ks-choice__text', text));
        choicesEl.appendChild(row);
      });
    }
    return;
  }
  // ── 開いたあと: だれが何を選んだか・進む人 ──
  const r = c.result;
  const names = (list) => list.map((i) => c.order[i]).join('・');
  let effect;
  if (r.answer == null) effect = `${who}さんが選ばなかったので、だれも進まないよ`;
  else if (issho && r.all) effect = 'みんないっしょ！ みんな進むよ';
  else if (!r.same.length) effect = '今回は、だれも進まないよ';
  else if (issho) effect = `${names(r.same)}さんがいっしょ！ 1マス進む`;
  else effect = `${names(r.same)}さんが当たり！ ${who}さんもいっしょに1マス進む`;
  const moving = Object.keys(r.moves).length > 0;
  fillQuestion(null, { q: c.question.q, choices: null }, who, {
    ...base,
    toText: issho ? `${who} さんの答えと、同じだった人` : `${who} さんの答えと、当てた人`,
    effect,
    showNext: c.act, showSkip: false,
    nextLabel: moving ? '進む' : '次の人へ', nextIcon: 'arrow_forward',
    waitText: c.act ? '' : `${who}さんが進めるのを待ってね`,
  });
  votersEl.replaceChildren();
  votersEl.hidden = true;
  choicesEl.replaceChildren();
  c.question.choices.forEach((text, i) => {
    // 番の人の答えと、同じだった人（当てた人）だけを出す。ちがう答え・外れた予想は、だれのものかを出さない
    // （ルート AGENTS.md「判定・投票は、だれが何を出したかを画面に出さない」）
    const picked = Object.keys(c.votes).map(Number).filter((v) => c.votes[v] === i && r.answer === i);
    const row = makeElement('div', 'ks-result' + (r.answer === i ? ' is-answer' : ''));
    const head = makeElement('div', 'ks-result__head');
    head.append(makeElement('span', 'ks-choice__num', NUMBERS[i]), makeElement('span', 'ks-choice__text', text));
    if (r.answer === i) head.appendChild(makeElement('span', 'ks-result__tag', `${who} さんの答え`));
    row.appendChild(head);
    if (picked.length) {
      const people = makeElement('div', 'ks-result__people');
      picked.forEach((v) => {
        const person = makeElement('span', 'ks-result__person');
        person.append(makeElement('span', `ks-pawn ks-pawn--${v}`, v + 1), document.createTextNode(c.order[v]));
        people.appendChild(person);
      });
      row.appendChild(people);
    }
    choicesEl.appendChild(row);
  });
}

// サイコロを2つ振ったあと、進む目を選ぶ欄（1台の画面・ルーム共通）
function renderDicePick(game, act, lead) {
  const box = $('dicePick');
  const dice = game ? L.pickDice(game) : null;
  const show = !!dice;
  box.hidden = !show;
  if (!show) { net.pickKey = null; return; }
  $('dicePickLead').textContent = lead;
  const key = `${game.id}:${game.rollNo}:${dice.join()}:${act}`;
  if (net.pickKey === key) return;
  net.pickKey = key;
  const total = L.boardSize(game);
  const kinds = L.lifeKindsOf(game);
  const from = L.posOf(game, L.turnOf(game));
  const row = $('dicePickRow');
  row.replaceChildren();
  dice.forEach((n, i) => {
    const to = Math.min(total - 1, from + n);
    const kind = LIFE_KINDS[kinds[to]];
    const btn = makeElement('button', 'ks-dicepick__btn');
    btn.type = 'button';
    btn.disabled = !act;
    const face = makeElement('span', 'ks-dice ks-dice--sm', n);
    face.dataset.n = String(n);
    const dest = makeElement('span', 'ks-dicepick__dest');
    dest.append(msIcon(kind ? kind.icon : 'flag'), document.createTextNode(kind ? kind.label : 'ゴール'));
    btn.append(face, makeElement('span', 'ks-dicepick__steps', `${n}マス進む`), dest);
    btn.setAttribute('aria-label', `${n}マス進む。止まるマスは ${kind ? kind.label : 'ゴール'}`);
    btn.addEventListener('click', () => roomPickDie(i));
    row.appendChild(btn);
  });
}

/* ── 「人生の道」の1台の画面 ──
   通信しないルーム（net.offline）として、ルームと同じ決まり（logic.js）・同じ画面（renderRoomGame）で動かす。
   遊ぶ人はみんな「端末のない人」で、押すのはいつもこの画面（ホストの代わり）。 */
function startLocalLife(names) {
  // 名前は順番の見出しにもなるので、同じ名前は番号を付けて分ける
  const used = new Set();
  const unique = names.map((name) => {
    let label = name;
    for (let n = 2; used.has(label); n++) {
      const tail = String(n);
      label = name.slice(0, Math.max(1, L.NAME_MAX - tail.length)) + tail;
    }
    used.add(label);
    return label;
  });
  const waiting = {
    status: L.STATUS.WAITING,
    offline: true, // 1台の画面: みんなが同時に選ぶマスは出さない（選んだものが見えてしまうため）
    host: '',
    hostUid: 'local',
    hostPlays: false,
    mode: L.MODE.LIFE,
    lifeLen: settings.lifeLen,
    lastGameId: 0,
    players: {},
    proxies: Object.fromEntries(unique.map((name, i) => [name, { joinedAt: i + 1 }])),
  };
  const room = L.startGame(waiting, COUNTS);
  if (!room) return;
  stopAnim();
  Object.assign(net, { offline: true, role: 'host', nickname: null, room, seen: null, shownKey: null, arrivedKey: null, busy: false });
  placeCards(true);
  $('roomBar').hidden = true;
  $('btnHelp').hidden = true;
  window.RoomkStats?.count('start-local');
  window.RoomkStats?.count('mode-life');
  trackRoll(room);
  renderRoom(room);
}
function endLocalLife() {
  if (!net.offline) return;
  stopAnim();
  Object.assign(net, { offline: false, role: null, room: null, seen: null, shownKey: null });
  $('roomStage').hidden = true;
  $('diceArea').hidden = false;
  $('lifeLegend').hidden = true;
  $('btnHelp').hidden = true;
  $('dicePick').hidden = true;
  closeWrite();
  placeCards(false);
}

function resetLocal() {
  clearTimers();
  endLocalLife();
  local.rolling = false;
  local.ended = false;
  local.lastPick = null;
  $('modal').style.display = 'none';
  $('goal-modal').style.display = 'none';
  setDiceRolling(false);
  setDice('?');
}

// 設定に戻る（人数・名前・マス数・テーマは残る）
function backToLocalSettings() {
  resetLocal();
  renderPick(null);
  $('turnNote').hidden = true;
  showScreen('settings');
}

// ゴールのあと「もう一度あそぶ」: 同じ設定ですぐはじめる
function playAgainLocal() {
  resetLocal();
  startLocalGame();
}

/* ════════════ ルーム（各自の端末。Realtime Database） ════════════ */

const DB_PREFIX = 'kyoumisugoroku_rooms';
const SESSION_KEY = 'kyoumisugoroku_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ABSENT_GRACE_MS = 4000; // サイコロを振る番の人がいないとき、とばすまでの待ち（再読み込みの一瞬は待つ）
const DICE_MS = 600;          // サイコロが回っている時間（1台の画面と同じくらい）
const STEP_MS = 250;          // コマが1マス進む時間
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

const net = {
  role: null,          // 'host' | 'guest'
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,          // 最新のルーム
  joinedAt: null,
  roomCallback: null,
  connectedRef: null,
  connectedCallback: null,
  isConnected: false,
  presenceDirty: false,
  presenceAt: 0,
  leaving: false,
  busy: false,
  timerInterval: null,
  orphanTimer: null,
  skipTimer: null,
  skipKey: null,
  seen: null,          // 描いたゲームの id と rollNo（新しく振られたらアニメーションする）
  anim: null,          // { key, turn, from, to, dice, start }
  animTimer: null,
  shownKey: null,      // カードを出したときの印（同じカードを出し直すたびに popIn しない）
};

// 通信はルームを作る・参加する・ルームにもどるときだけ準備する（1台の画面ではつながない）
let fb = null;
function firebaseReady() {
  if (!fb) fb = RoomkRTDB.initFirebase(firebase);
  return fb;
}

function currentUid() {
  if (net.offline) return 'local';
  return fb ? firebase.auth().currentUser?.uid || null : null;
}

function serverTimestamp() {
  return firebase.database.ServerValue.TIMESTAMP;
}

async function waitAuth() {
  try {
    await firebaseReady().authReady;
    return true;
  } catch {
    toast('うまくつながらなかったよ。ページを読み直してね');
    return false;
  }
}

function isExpired(room) {
  // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
  return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
}

async function removeExpired(ref, fallback) {
  try {
    // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
    await ref.transaction((room) => {
      const current = room || fallback;
      return current && isExpired(current) ? null : undefined;
    }, undefined, false);
  } catch (error) {
    console.warn('[kyoumi-sugoroku] expired room cleanup failed', error);
  }
}

// transaction の最初の計算が空のキャッシュで走らないよう、先に値を購読しておく
function warmRoomCache(ref) {
  return new Promise((resolve, reject) => {
    const callback = (snap) => {
      resolve({ snap, release: () => ref.off('value', callback) });
    };
    ref.on('value', callback, reject);
  });
}

// 送信後に通信が切れて中止された transaction は、やり直す（届いていたかは中で確かめる）
async function transactRetry(ref, update) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ref.transaction(update);
    } catch (error) {
      if (error?.message !== 'disconnect' || attempt >= TX_RETRY_MAX) throw error;
    }
  }
}

function reservedByOther(room, name, uid) {
  const game = L.gameOf(room);
  if (!game || room.status === L.STATUS.WAITING) return false;
  if (L.isProxy(game, name)) return true;
  const owner = game.uids?.[name];
  return !!owner && owner !== uid;
}

function setError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

/* ── 再接続用の記録（名前とルームコードだけ） ── */
function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      role: net.role,
      nickname: net.nickname,
      roomCode: net.roomCode,
      uid: currentUid(),
      joinedAt: net.joinedAt,
    }));
  } catch {
    // 保存できないときは、再読み込みで戻れないだけ
  }
}

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 何もしない
  }
}

/* ── ルームへの出入り ── */
function stopAnim() {
  clearInterval(net.animTimer);
  net.animTimer = null;
  net.anim = null;
}

function cleanupRoom() {
  clearInterval(net.timerInterval);
  clearTimeout(net.orphanTimer);
  clearTimeout(net.skipTimer);
  stopAnim();
  if (net.roomRef && net.roomCallback) net.roomRef.off('value', net.roomCallback);
  if (net.connectedRef && net.connectedCallback) net.connectedRef.off('value', net.connectedCallback);
  if (net.roomRef) RoomkRTDB.cancelRoomOnDisconnect(net.roomRef);
  Object.assign(net, {
    role: null,
    nickname: null,
    roomCode: null,
    roomRef: null,
    room: null,
    joinedAt: null,
    roomCallback: null,
    connectedRef: null,
    connectedCallback: null,
    isConnected: false,
    presenceDirty: false,
    presenceAt: 0,
    leaving: false,
    timerInterval: null,
    orphanTimer: null,
    skipTimer: null,
    skipKey: null,
    seen: null,
    shownKey: null,
  });
  clearSession();
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
  $('roomStage').hidden = true;
  $('lastPick').hidden = true;
  $('turnNote').hidden = true;
  $('diceArea').hidden = false;
  setDiceRolling(false);
  setDice('?');
  placeCards(false);
}

function leaveLocally(message, isError = true) {
  cleanupRoom();
  showScreen('top');
  if (message) toast(message, isError);
}

function connectToRoom(role, nickname, code, ref, joinedAt) {
  // 念のため、前のルームの購読・タイマーが残っていたら片付けてからつなぐ
  if (net.roomRef) cleanupRoom();
  net.role = role;
  net.nickname = nickname;
  net.roomCode = code;
  net.roomRef = ref;
  net.joinedAt = Number(joinedAt) || RoomkRTDB.now();
  $('roomCodeLabel').textContent = code;
  $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
  $('roomBar').hidden = false;
  $('btn-back').hidden = true;
  placeCards(true);
  saveSession();
  // 参加用のリンク（?room=コード）でひらいたときは、つないだあとにコードをアドレスから外す
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);

  net.roomCallback = (snap) => {
    // 自分で退出・ルームを閉じている途中の変化は、退出処理の側で片付ける
    if (net.roomRef !== ref || net.leaving) return;
    if (!snap.exists()) {
      leaveLocally('ルームが閉じられたよ', false);
      return;
    }
    const room = snap.val();
    if (isExpired(room)) {
      removeExpired(ref, room);
      leaveLocally('このルームは終わったみたい');
      return;
    }
    net.room = room;
    handleRoom(room);
  };
  ref.on('value', net.roomCallback, (error) => {
    console.warn('[kyoumi-sugoroku] room listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });

  net.connectedRef = firebaseReady().db.ref('.info/connected');
  net.connectedCallback = (snap) => {
    net.isConnected = snap.val() === true;
    if (net.isConnected && net.roomRef === ref) {
      net.presenceDirty = true;
      ensurePresence(true);
    }
  };
  net.connectedRef.on('value', net.connectedCallback);
  net.timerInterval = setInterval(tickRoom, 1000);
}

function tickRoom() {
  if (net.room && needsPresence(net.room)) ensurePresence();
}

// 接続中なのに、ルームの上では切断・不在になっている
function needsPresence(room) {
  if (net.role === 'host') return room.hostConnected === false;
  if (net.role === 'guest') return !room.players?.[net.nickname];
  return false;
}

// 接続のたびに切断時の予約を張り直し、自分の在室を確かめる。
// 古い接続の切断予約が遅れて発火した場合も、ここで在室に戻す
async function ensurePresence(force = false) {
  const ref = net.roomRef;
  if (!ref || net.leaving || !net.isConnected || !net.room) return;
  if (!force && Date.now() - net.presenceAt < PRESENCE_RETRY_MS) return;
  net.presenceDirty = false;
  net.presenceAt = Date.now();
  const role = net.role;
  const nickname = net.nickname;
  const joinedAt = net.joinedAt;
  const uid = currentUid();
  // 退出・ルームを閉じる途中になったら、在室を書き戻さない（transaction の中でも見る。
  // 退出の transaction のあとに書き戻すと、抜けた人が在室のまま残るため）
  const stale = () => net.leaving || net.roomRef !== ref;
  try {
    if (role === 'host') {
      await ref.onDisconnect().update({
        hostConnected: false,
        hostDisconnectedAt: serverTimestamp(),
      });
      if (stale()) return;
      await ref.transaction((room) => {
        if (stale() || !room || room.hostUid !== uid || isExpired(room)) return;
        if (room.hostConnected === true && room.hostDisconnectedAt == null) return;
        return { ...room, hostConnected: true, hostDisconnectedAt: null };
      });
    } else if (role === 'guest') {
      await ref.child('players/' + nickname).onDisconnect().remove();
      if (stale()) return;
      let full = false;
      await ref.transaction((room) => {
        full = false;
        if (stale() || !room || isExpired(room) || room.players?.[nickname]) return;
        if (nickname === room.host || room.proxies?.[nickname] || reservedByOther(room, nickname, uid)) return;
        // 戻るときは参加したときの順番のまま。遊んでいるゲームの人は人数の上限を見ない
        const inGame = room.status !== L.STATUS.WAITING && L.ownsName(L.gameOf(room), nickname, uid);
        if (!inGame && L.playingNames(room).length >= L.MAX_PLAYERS) {
          full = true;
          return;
        }
        return {
          ...room,
          players: {
            ...(room.players || {}),
            [nickname]: { isHost: false, uid, joinedAt },
          },
        };
      });
      if (full && net.roomRef === ref && !net.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally('このルームはいっぱいだよ');
      }
    }
  } catch (error) {
    console.warn('[kyoumi-sugoroku] presence recovery failed', error);
    // 定期的な確認の失敗は通知しない（接続し直したときだけ知らせる）
    if (force) toast('再接続に失敗しました。ページを読み直してね');
  }
}

async function createRoom() {
  if (net.busy || net.roomRef) return;
  const nickname = $('hostName').value.trim();
  const error = L.validNickname(nickname);
  if (error) {
    setError('createError', error);
    return;
  }
  setError('createError', '');
  // 認証待ちの間の二度押しでルームが2つできないよう、待つ前にロックする
  net.busy = true;
  $('btnCreateRoom').disabled = true;
  try {
    if (!await waitAuth()) return;
    const uid = currentUid();
    const joinedAt = RoomkRTDB.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = RoomkRTDB.generateRoomCode();
      const ref = firebaseReady().db.ref(DB_PREFIX + '/' + code);
      const result = await transactRetry(ref, (room) => {
        // やり直しのとき、前の送信で自分が作ったルームが届いていたら、そのまま使う
        if (room) return room.hostUid === uid && room.players?.[nickname]?.joinedAt === joinedAt ? room : undefined;
        return {
          status: L.STATUS.WAITING,
          host: nickname,
          hostUid: uid,
          hostPlays: true,
          squares: L.DEFAULT_SQUARES,
          themes: Object.keys(THEMES),
          hostConnected: true,
          hostDisconnectedAt: null,
          createdAt: serverTimestamp(),
          lastGameId: 0,
          players: {
            [nickname]: { isHost: true, uid, joinedAt },
          },
        };
      });
      if (result.committed) {
        window.RoomkStats?.count('room-create');
        connectToRoom('host', nickname, code, ref, joinedAt);
        return;
      }
    }
    setError('createError', 'ルームを作れませんでした。もう一度ためしてね');
  } catch (err) {
    console.warn('[kyoumi-sugoroku] create failed', err);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    net.busy = false;
    $('btnCreateRoom').disabled = false;
  }
}

// ルームコード: 日本語入力のまま打った全角の英数字は半角に、小文字は大文字にそろえて読む。
// 入力欄は打っている間に書き換えない（変換中に書き換えると文字が重なり、ローマ字が入らなくなる）
function normalizeRoomCode(raw) {
  return String(raw || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}
// ひらがななど半角にできない文字が残ったら、日本語入力の切り替え方を案内する
function roomCodeImeError(code) {
  return /[^\x00-\x7F]/.test(code)
    ? 'ルームコードはアルファベットと数字で入れてね。ひらがなになるときは、キーボードを英字に切り替えてね（「半角/全角」キー、Macは「英数」キー）'
    : '';
}

async function joinRoom() {
  if (net.busy || net.roomRef) return;
  const nickname = $('guestName').value.trim();
  const code = normalizeRoomCode($('joinCode').value);
  const error = L.validNickname(nickname);
  if (error) {
    setError('joinError', error);
    return;
  }
  const imeError = roomCodeImeError(code);
  if (imeError) {
    setError('joinError', imeError);
    return;
  }
  if (!ROOM_CODE_PATTERN.test(code)) {
    setError('joinError', 'ルームコードは6文字で入れてね');
    return;
  }
  setError('joinError', '');
  net.busy = true;
  $('btnJoinRoom').disabled = true;
  let release = null;
  try {
    if (!await waitAuth()) return;
    const ref = firebaseReady().db.ref(DB_PREFIX + '/' + code);
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const initial = warm.snap.val();
    if (!initial) {
      setError('joinError', 'ルームが見つからないよ。コードを確かめてね');
      return;
    }
    if (isExpired(initial)) {
      await removeExpired(ref, initial);
      setError('joinError', 'このルームは終わったみたい');
      return;
    }
    const uid = currentUid();
    const joinedAt = RoomkRTDB.now();
    let reason = '';
    let rejoinAt = null;
    const result = await transactRetry(ref, (room) => {
      reason = '';
      rejoinAt = null;
      if (!room) { reason = '見つからない'; return; }
      if (isExpired(room)) { reason = '終了'; return; }
      // タブが落ちた直後・送信後の切断のやり直しなど、自分の在室が残っていたら入りなおしとして上書きする
      const stale = room.players?.[nickname];
      const mine = !!stale && !stale.isHost && stale.uid === uid;
      if (nickname === room.host || room.proxies?.[nickname] || (stale && !mine) || reservedByOther(room, nickname, uid)) {
        reason = '名前';
        return;
      }
      const game = L.gameOf(room);
      if (mine) {
        rejoinAt = Number(stale.joinedAt) || joinedAt;
      } else if (room.status !== L.STATUS.WAITING) {
        // 遊んでいる途中は、このゲームで遊んでいた人がタブを閉じたあとに入りなおすときだけ入れる
        if (!L.ownsName(game, nickname, uid)) { reason = '途中'; return; }
        rejoinAt = Number(game.joined?.[nickname]) || joinedAt;
      } else if (L.playingNames(room).length >= L.MAX_PLAYERS) {
        reason = '満員';
        return;
      }
      return {
        ...room,
        players: {
          ...(room.players || {}),
          [nickname]: { isHost: false, uid, joinedAt: rejoinAt || joinedAt },
        },
      };
    });
    if (!result.committed) {
      const messages = {
        '見つからない': 'ルームが見つからないよ。コードを確かめてね',
        '終了': 'このルームは終わったみたい',
        '名前': 'その名前は使われているよ。少し変えてみてね',
        '満員': 'このルームはいっぱいだよ（遊べるのは' + L.MAX_PLAYERS + '人まで）',
        '途中': 'もうゲームが始まっているよ。ゴールして、ホストが「もう一度あそぶ」を押したら参加できるよ',
      };
      setError('joinError', messages[reason] || '参加できませんでした。もう一度ためしてね');
      return;
    }
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[kyoumi-sugoroku] join failed', err);
    setError('joinError', '接続できませんでした。もう一度ためしてね');
  } finally {
    release?.();
    net.busy = false;
    $('btnJoinRoom').disabled = false;
  }
}

async function tryReconnect() {
  const saved = loadSession();
  if (!saved || !saved.roomCode || !saved.nickname || !saved.role) return false;
  if (!ROOM_CODE_PATTERN.test(saved.roomCode) || L.validNickname(saved.nickname)) return false;
  if (net.busy || net.roomRef) return false;
  // 復帰の途中で「ルームを作る／参加する」が重ならないようにする
  net.busy = true;
  ['btnGoCreate', 'btnGoJoin', 'btnGoLocal'].forEach((id) => { $(id).disabled = true; });
  let release = null;
  try {
    if (!await waitAuth()) return false;
    const uid = currentUid();
    if (!uid || uid !== saved.uid) return false;
    const ref = firebaseReady().db.ref(DB_PREFIX + '/' + saved.roomCode);
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const room = warm.snap.val();
    if (!room) return false;
    if (isExpired(room)) {
      await removeExpired(ref, room);
      return false;
    }
    let joinedAt = Number(saved.joinedAt) || null;
    if (saved.role === 'host') {
      if (room.host !== saved.nickname || room.hostUid !== uid) return false;
      joinedAt = Number(room.players?.[saved.nickname]?.joinedAt) || joinedAt;
    } else if (saved.role === 'guest') {
      if (saved.nickname === room.host || room.proxies?.[saved.nickname]) return false;
      const player = room.players?.[saved.nickname];
      if (player && (player.isHost || player.uid !== uid)) return false;
      if (reservedByOther(room, saved.nickname, uid)) return false;
      if (player) joinedAt = Number(player.joinedAt) || joinedAt;
    } else {
      return false;
    }
    if (net.roomRef) return false;
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref, joinedAt);
    return true;
  } catch (error) {
    console.warn('[kyoumi-sugoroku] reconnect failed', error);
    return false;
  } finally {
    release?.();
    net.busy = false;
    ['btnGoCreate', 'btnGoJoin', 'btnGoLocal'].forEach((id) => { $(id).disabled = false; });
  }
}

async function leaveRoom() {
  if (net.busy || !net.roomRef) return;
  const ref = net.roomRef;
  const role = net.role;
  const nickname = net.nickname;
  const uid = currentUid();
  if (role === 'host' && !window.confirm('ルームを閉じると、参加している人の画面もトップに戻ります。閉じますか？')) return;
  net.busy = true;
  net.leaving = true;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      // 自分の在室だけを消す（コマと名前はゲームが終わるまで残す。入りなおせるように）
      await ref.transaction((room) => {
        if (!room) return;
        if (room.players?.[nickname]?.uid !== uid) return;
        const players = { ...room.players };
        delete players[nickname];
        const left = { ...room, players };
        // 自分の番だったら、待たせないように次の人へ
        const game = L.gameOf(left);
        if (game && left.status === L.STATUS.PLAYING && L.actorOf(game) === nickname) {
          // カードが出ていたら、中身（できごとの効き目など）は確定させずに次の人へ
          return (L.isTalkStep(game) ? L.leaveTalk(left) : L.skipAbsent(left)) || left;
        }
        return left;
      });
    }
  } catch (error) {
    console.warn('[kyoumi-sugoroku] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    net.leaving = false;
    net.busy = false;
    // 退出の前に取り消した切断予約を張り直す
    ensurePresence(true);
    if (net.room) handleRoom(net.room);
    return;
  }
  net.busy = false;
  leaveLocally('');
}

/* ── 画面の更新 ── */
function handleRoom(room) {
  if (net.role === 'guest') {
    const me = room.players?.[net.nickname];
    if (me && me.uid !== currentUid()) {
      leaveLocally('同じ名前の人が参加したので、ルームから外れました');
      return;
    }
  }
  if (net.presenceDirty) ensurePresence(true);
  else if (needsPresence(room)) ensurePresence();
  updateHostOverlay(room);
  trackRoll(room);
  renderRoom(room);
  if (net.role === 'host') hostWatchAbsent(room);
}

function updateHostOverlay(room) {
  if (net.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    // 切れたままのあいだに切れた時刻だけが新しくなったら（ホストの通信が短く揺れたとき）、期限のタイマーを仕掛けなおす。
    // 古い時刻のまま動くと「まだ期限前」で消せず、待つ画面のまま残る（2026-11-13）
    if (net.orphanTimer && net.orphanAt !== RoomkRTDB.getHostDisconnectedAt(room)) { clearTimeout(net.orphanTimer); net.orphanTimer = null; }
    if (!net.orphanTimer) {
      net.orphanAt = RoomkRTDB.getHostDisconnectedAt(room);
      const ref = net.roomRef;
      const at = RoomkRTDB.getHostDisconnectedAt(room);
      const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now());
      net.orphanTimer = setTimeout(() => {
        net.orphanTimer = null;
        if (net.roomRef === ref && net.room) removeExpired(ref, net.room);
      }, delay);
    }
  } else {
    $('hostOffOverlay').hidden = true;
    clearTimeout(net.orphanTimer);
    net.orphanTimer = null;
  }
}

// 新しくサイコロが振られたのを見たら、サイコロとコマのアニメーションをする。
// 開いた直後・再読み込みのあとは、アニメーションせずにいまの形を出す
function trackRoll(room) {
  const game = L.gameOf(room);
  if (!game || room.status === L.STATUS.WAITING) {
    net.seen = null;
    stopAnim();
    return;
  }
  const rollNo = Number(game.rollNo) || 0;
  const seen = net.seen;
  const last = game.last;
  if (seen && seen.id === game.id && rollNo === seen.rollNo + 1 && validLast(game, last)) {
    stopAnim();
    net.anim = {
      key: game.id + ':' + rollNo,
      turn: last.turn,
      from: last.from,
      to: last.to,
      dice: Number(last.dice) || 1,
      cheerBy: Number.isInteger(last.cheerBy) ? last.cheerBy : null,
      start: performance.now() - (last.quick ? DICE_MS : 0),
    };
    net.animTimer = setInterval(() => {
      if (!animRunning()) stopAnim();
      if (net.room) renderRoom(net.room);
    }, 60);
  } else if (!seen || seen.id !== game.id || rollNo !== seen.rollNo) {
    stopAnim();
  }
  net.seen = { id: game.id, rollNo };
}

// いちばん新しいサイコロの記録が、盤の中の正しい動きか（壊れた値ではアニメーションせず、いまの形をすぐ出す）
function validLast(game, last) {
  if (!last || typeof last !== 'object') return false;
  const max = L.boardSize(game) - 1;
  const inBoard = (n) => Number.isInteger(n) && n >= 0 && n <= max;
  return Number.isInteger(last.turn) && last.turn >= 0 && last.turn < L.orderOf(game).length
    && inBoard(last.from) && inBoard(last.to) && last.to >= last.from && last.to - last.from <= 6;
}

function animRunning() {
  const a = net.anim;
  if (!a) return false;
  return performance.now() - a.start < DICE_MS + Math.max(0, a.to - a.from) * STEP_MS + 150;
}

// アニメーション中のコマの位置
function animPos(a) {
  const t = performance.now() - a.start;
  if (t < DICE_MS) return a.from;
  return Math.min(a.to, a.from + Math.floor((t - DICE_MS) / STEP_MS) + 1);
}

function renderRoom(room) {
  const game = L.gameOf(room);
  if (game && (room.status === L.STATUS.PLAYING || room.status === L.STATUS.GOAL)) {
    renderRoomGame(room, game);
  } else {
    renderWaiting(room);
  }
}

function themeLabels(themes) {
  return themes.map((key) => THEMES[key].label).join('・');
}

function renderWaiting(room) {
  showScreen('waiting');
  const host = net.role === 'host';
  const playing = L.playingNames(room);
  const squares = L.squaresOf(room.squares);
  const themes = L.themesOf(room.themes, COUNTS);
  $('waitingCount').textContent = `遊ぶ人 ${playing.length}人（${L.MAX_PLAYERS}人まで）`;

  const list = $('waitingPlayers');
  list.replaceChildren();
  const addRow = (name, tags, onRemove) => {
    const li = makeElement('li', 'ks-people__item');
    li.appendChild(makeElement('span', 'ks-people__name', name));
    tags.forEach((tag) => li.appendChild(makeElement('span', 'ks-tag', tag)));
    if (onRemove) {
      const btn = makeElement('button', 'ks-quiet-btn', '外す');
      btn.type = 'button';
      btn.addEventListener('click', onRemove);
      li.appendChild(btn);
    }
    list.appendChild(li);
  };
  L.memberNames(room).forEach((name) => {
    const p = room.players[name];
    const tags = [];
    if (p.isHost) tags.push(room.hostPlays ? 'ホスト' : 'ホスト（進行だけ）');
    if (name === net.nickname) tags.push('あなた');
    addRow(name, tags);
  });
  // 「端末なし」の印は、ホストの画面にだけ出す（子どもどうしの画面で区別しない）
  L.proxyNames(room).forEach((name) => {
    addRow(name, host ? ['端末なし'] : [], host ? () => removeProxy(name) : null);
  });
  const life = L.modeOf(room.mode) === L.MODE.LIFE;
  const lifeTotal = L.lifeSizeFor(Math.max(1, playing.length), room.lifeLen);
  $('waitingSettings').textContent = life
    ? `あそびかた 人生の道（${lifeTotal}マス。4つの場面をたどって、みんながゴールしたらおわり）`
    : `マス数 ${squares}マス・テーマ ${themeLabels(themes)}`;

  $('hostWaitingTools').hidden = !host;
  $('guestWaitingNote').hidden = host;
  if (host) {
    const box = $('hostPlays');
    box.checked = !!room.hostPlays;
    box.disabled = !room.hostPlays && playing.length >= L.MAX_PLAYERS;
    selectToggle($('roomMode'), L.modeOf(room.mode));
    selectToggle($('roomLifeLen'), L.lifeLenOf(room.lifeLen));
    $('fieldRoomSquares').hidden = life;
    $('fieldRoomThemes').hidden = life;
    $('fieldRoomLength').hidden = !life;
    $('roomLifeLenNote').textContent = `${lifeTotal}マス`;
    selectToggle($('roomSquares'), squares);
    $('roomThemes').querySelectorAll('input').forEach((input) => { input.checked = themes.includes(input.value); });
    const full = playing.length >= L.MAX_PLAYERS;
    $('btnAddProxy').disabled = full;
    $('btnStartGame').disabled = playing.length < L.MIN_PLAYERS;
    $('startNote').textContent = playing.length < L.MIN_PLAYERS
      ? '遊ぶ人がいません。「自分もプレイヤーとして参加する」にするか、参加する人を待ってね'
      : full ? `遊べるのは${L.MAX_PLAYERS}人までです` : '';
  }
}

function playerTags(room, game, name) {
  const tags = [];
  if (name === net.nickname) tags.push('あなた');
  if (L.doneOf(game, L.orderOf(game).indexOf(name))) tags.push('ゴール');
  if (net.offline) return tags;
  if (net.role === 'host' && L.isProxy(game, name)) tags.push('端末なし');
  else if (!L.present(room, game, name)) tags.push('つながっていない');
  return tags;
}

function renderRoomGame(room, game) {
  showScreen('game');
  const life = L.isLife(game);
  $('lifeLegend').hidden = !life;
  $('lifeLegend').classList.toggle('has-votes', life && game.votes === true);
  const order = L.orderOf(game);
  const turn = L.turnOf(game);
  const goal = room.status === L.STATUS.GOAL;
  // 「人生の道」はみんなでゴールするので、ゴールした人を1人にしぼらない
  const winner = goal && Number.isInteger(game.winner) ? game.winner : life && goal ? -1 : turn;
  const anim = animRunning() ? net.anim : null;
  const positions = order.map((_, i) => L.posOf(game, i));
  if (anim && positions[anim.turn] != null) positions[anim.turn] = animPos(anim);
  // アニメーション中は、振った人を「いまの番」として出す
  const current = anim ? anim.turn : goal ? winner : turn;

  renderIndicator(order.map((name, i) => ({ name, current: i === current, tags: playerTags(room, game, name), cards: L.cardsOf(game, i) })));
  // 前の人が選んだもの（次にサイコロが振られると消える）
  const pick = !goal && !anim ? L.pickedOf(game, COUNTS) : null;
  renderPick(pick && {
    playerIndex: pick.turn,
    name: order[pick.turn],
    title: pick.kiku ? `${order[pick.turn]} さんの答え${pick.by != null ? `（${order[pick.by]} さんの質問）` : ''}` : '',
    item: normalizeQ(pick.kiku ? LIFE_ASK[pick.scene][pick.idx] : pick.life ? LIFE_QUESTIONS[pick.scene][pick.idx] : QUESTIONS[pick.theme][pick.idx]),
    choice: pick.choice,
    text: pick.text,
  });
  const total = L.boardSize(game);
  renderBoard(total, positions, goal && !anim ? -1 : current, life ? lifeView(game) : null);

  const uid = currentUid();
  const act = L.canAct(room, uid, net.nickname, net.role);
  const actor = L.actorOf(game);
  // いま押す人（「きく」で答える段階は、聞かれた人）
  const acting = order[L.actingIndex(room, game)] ?? actor;
  const mine = acting === net.nickname && net.role === 'guest' || (net.role === 'host' && acting === room.host);
  const rolling = L.isRollStep(game) && !goal;
  const picking = L.isPickStep(game) && !goal;
  // 「人生の道」でゴールした人の番は、サイコロのかわりに「おうえん」
  const cheering = life && rolling && L.doneOf(game, turn);

  // サイコロ
  const diceRolling = !!anim && performance.now() - anim.start < DICE_MS;
  setDiceRolling(diceRolling);
  if (diceRolling) setDice(Math.floor(Math.random() * 6) + 1);
  else if (anim || !rolling) setDice(game.last?.dice || '?');
  else setDice('?');
  $('btn-roll').hidden = !rolling || !act || cheering;
  $('btn-roll').disabled = !!anim || net.busy;
  // おたすけカード: 自分の番のサイコロの前に、ほかの人を2マス進められる
  const helpKey = `${game.id}:${game.rollNo}:${turn}`;
  const helpCards = life && rolling && !cheering ? L.cardsOf(game, turn) : 0;
  const helpList = helpCards ? L.helpTargets(room, game) : [];
  const canHelp = helpCards > 0 && helpList.length > 0 && act;
  if (!canHelp || net.helpOpen !== helpKey) net.helpOpen = null;
  $('btnHelp').hidden = !canHelp || !!anim;
  $('btnHelp').disabled = net.busy;
  $('btnHelpCount').textContent = String(helpCards);

  // いまの番の案内
  const note = $('turnNote');
  note.hidden = goal && !anim;
  if (anim && anim.cheerBy != null) {
    note.textContent = `${order[anim.cheerBy]}さんが、${order[anim.turn]}さんをおうえん！`;
  } else if (anim) {
    note.textContent = life ? `${order[anim.turn]}さんが進むよ` : `${order[anim.turn]}さんがサイコロを振ったよ`;
  } else if (picking) {
    note.textContent = mine ? 'あなたの番だよ。進む目を選んでね' : net.offline ? `${actor}さん、進む目を選んでね` : `${actor}さんが、進む目を選んでいるよ`;
  } else if (cheering) {
    note.textContent = mine ? 'あなたのおうえんの番だよ' : `${actor}さんのおうえんの番だよ`;
  } else if (rolling) {
    if (mine) note.textContent = 'あなたの番だよ。「サイコロを振る」を押してね';
    else if (net.offline) note.textContent = `${actor}さんの番だよ`;
    else if (act) note.textContent = `${actor}さんの番だよ（ホストは代わりに押せます${L.present(room, game, actor) ? '' : '。つながっていません'}）`;
    else note.textContent = `${actor}さんがサイコロを振る番だよ`;
  } else if (!goal) {
    const lq = life ? L.lifeQuestionOf(game) : null;
    if (lq?.kind === L.KIND.DEKIGOTO) note.textContent = `${actor}さんのできごと`;
    else if (lq?.kind === L.KIND.KIKU && lq.phase === L.PHASE.CARD && !L.targetGone(room, game, lq)) {
      note.textContent = mine ? 'あなたが質問を選ぶ番だよ' : net.offline ? `${actor}さんが質問を選ぶ番だよ` : `${actor}さんが、質問を選んでいるよ`;
    } else if (lq?.kind === L.KIND.KIKU && lq.target != null && !L.targetGone(room, game, lq)) {
      // 聞く相手が決まったら、答える人を知らせる
      note.textContent = lq.target === L.TARGET_ALL ? 'みんなが答える番だよ'
        : lq.target === L.TARGET_NEAR ? 'そばにいる人が答える番だよ'
        : order[lq.target] === net.nickname ? 'あなたが答える番だよ' : `${order[lq.target]}さんが答える番だよ`;
    } else if (lq?.kind === L.KIND.KIKU) note.textContent = mine ? 'あなたが、だれかに聞く番だよ' : `${actor}さんが、だれかに聞く番だよ`;
    else if (lq && lq.kind === L.KIND.MINNA) {
      const picker = L.minnaPicker(room, game, lq);
      note.textContent = picker == null ? (mine ? 'みんな選べたね。次へ進めてね' : `${actor}さんが進めるのを待ってね`)
        : mine ? 'あなたが選ぶ番だよ' : `${order[picker]}さんが選ぶ番だよ`;
    } else if (lq && L.isVoteKind(lq.kind) && !lq.open) note.textContent = lq.kind === L.KIND.ISSHO ? 'みんなで選ぼう' : `${actor}さんの答えを、みんなで予想しよう`;
    else if (lq && L.isVoteKind(lq.kind)) note.textContent = mine ? '結果を見たら、次へ進めてね' : `${actor}さんが進めるのを待ってね`;
    else if (life) note.textContent = mine ? 'あなたが選ぶ番だよ' : `${actor}さんが選ぶ番だよ`;
    else note.textContent = mine ? 'あなたが話す番だよ' : `${actor}さんが話す番だよ`;
  }
  // 「人生の道」: ゴールに着いた人を、次のサイコロまで知らせる（紙ふぶきは1回だけ）
  const arrived = life && !goal && !anim && game.arrived && Number(game.arrived.rollNo) === (Number(game.rollNo) || 0)
    ? L.asList(game.arrived.who).filter((i) => Number.isInteger(i) && order[i] != null) : [];
  if (arrived.length && rolling && !cheering) {
    note.textContent = `${arrived.map((i) => order[i]).join('さん・')}さんがゴール！ ${note.textContent}`;
    const arrivedKey = `${game.id}:${game.rollNo}:${arrived.join()}`;
    if (net.arrivedKey !== arrivedKey) { net.arrivedKey = arrivedKey; celebrate(); }
  }

  if (L.isOldLife(game) && !goal) note.textContent = 'このゲームは続けられなくなったよ。ホストの画面が待合室にもどすのを待ってね';
  $('btnRoomBack').hidden = net.offline || !(net.role === 'host' && !goal);
  $('btn-back').hidden = !net.offline;

  // 質問・ゴールのカード（アニメーションが終わってから出す）
  const stage = $('roomStage');
  const q = L.questionOf(game, COUNTS);
  let key = null;
  if (!anim && goal) {
    key = 'goal:' + game.id;
    $('questionCard').hidden = true;
    $('goalCard').hidden = false;
    $('goal-title').textContent = winner < 0 ? 'みんなゴール！' : 'ゴール！';
    $('goal-name').textContent = winner < 0 ? '4つの場面をたどったね。おつかれさま！' : `${order[winner]} さん、おめでとう！`;
    $('btn-restart').hidden = net.role !== 'host';
    $('btnGoalSettings').hidden = !net.offline;
    $('goal-wait').hidden = net.role === 'host';
  } else if (!anim && net.helpOpen === helpKey) {
    // おたすけカード: だれを進めるか
    key = 'h:' + helpKey;
    $('goalCard').hidden = true;
    $('questionCard').hidden = false;
    fillQuestion(null, { q: 'だれを2マス進める？', choices: helpList.map((i) => `${order[i]} さん`) }, actor, {
      head: { key: 'life-help', icon: 'redeem', label: 'おたすけカード' },
      toText: `${actor} さんのおたすけカード（あと${helpCards}枚）`,
      playerIndex: turn,
      dice: null,
      canPress: act && !net.busy,
      onChoose: roomHelp,
      noFree: true,
      showNext: false,
      showSkip: true,
      skipLabel: 'やめる',
      skipIcon: 'close',
      waitText: '使ったあとで、サイコロを振れるよ',
    });
  } else if (!anim && cheering) {
    // おうえん: まだゴールしていない人を1人選んで、1マス進める
    key = 'c:' + game.id + ':' + game.rollNo + ':' + turn;
    $('goalCard').hidden = true;
    $('questionCard').hidden = false;
    const rest = L.cheerTargets(room, game).map((i) => order[i]);
    fillQuestion(null, { q: rest.length ? 'だれを1マス進める？' : 'おうえんできる人が、いまいないよ', choices: rest.map((name) => `${name} さん`) }, actor, {
      head: { key: 'life-cheer', icon: 'favorite', label: 'おうえん' },
      toText: `${actor} さんのおうえん`,
      playerIndex: turn,
      dice: null,
      canPress: act && !net.busy,
      onChoose: roomCheer,
      noFree: true,
      showNext: false,
      showSkip: false,
      waitText: !rest.length ? 'ほかの人がもどるのを待ってね' : act ? 'ゴールした人は、自分の番にだれかを1マス進められるよ' : `${actor}さんが、おうえんする人を選んでいるよ`,
    });
  } else if (!anim && L.isTalkStep(game) && life && L.lifeQuestionOf(game)) {
    const lq = L.lifeQuestionOf(game);
    key = lq.kind === L.KIND.MINNA
      ? 'q:' + game.id + ':' + game.rollNo + ':minna:' + lq.idx // 1人選ぶたびに n が進むが、カードは同じ
      : 'q:' + game.id + ':' + game.rollNo + ':' + lq.n + (lq.open ? ':open' : '');
    $('goalCard').hidden = true;
    $('questionCard').hidden = false;
    if (lq.kind === L.KIND.MINNA) {
      fillMinnaCard({
        scene: lifeScene(lq.scene),
        theme: LIFE_MINNA[lq.idx],
        picks: lq.picks,
        order,
        picker: L.minnaPicker(room, game, lq),
        playerName: actor,
        playerIndex: turn,
        dice: game.last?.dice || null,
        act: act && !net.busy,
        busy: net.busy,
      });
    } else if (L.isVoteKind(lq.kind)) {
      // みんなが同時に選ぶマス
      const present = L.voters(room, game);
      fillVoteCard({
        kind: lq.kind,
        scene: lifeScene(lq.scene),
        question: LIFE_QUESTIONS[lq.scene][lq.idx],
        votes: lq.votes,
        open: lq.open,
        order,
        turn,
        allowed: order.map((_, i) => i).filter((i) => L.canVote(room, uid, net.nickname, net.role, i)),
        waiting: present.filter((i) => lq.votes[i] == null),
        result: lq.open ? L.voteResult(game, lq) : null,
        playerName: actor,
        playerIndex: turn,
        dice: game.last?.dice || null,
        act: act && !net.busy,
        busy: net.busy,
      });
    } else {
    const gone = L.targetGone(room, game, lq);
    const kiku = lq.kind === L.KIND.KIKU;
    // 選んだ相手がいなくなったら、聞く相手を選びなおす
    const phase = kiku ? (gone ? L.PHASE.WHO : lq.phase) : null;
    const targetText = !kiku || phase === L.PHASE.WHO ? null
      : lq.target === L.TARGET_ALL ? 'みんな'
      : lq.target === L.TARGET_NEAR ? 'そばにいる人'
      : `${order[lq.target]} さん`;
    fillLifeCard({
      kind: lq.kind,
      phase,
      scene: lq.kind === L.KIND.DEKIGOTO ? null : lifeScene(lq.scene),
      question: lq.kind === L.KIND.DEKIGOTO ? null
        : kiku ? (phase === L.PHASE.ANSWER ? LIFE_ASK[lq.scene][lq.idx] : null)
        : LIFE_QUESTIONS[lq.scene][lq.idx],
      cards: kiku && phase === L.PHASE.CARD ? lq.opts.map((i) => LIFE_ASK[lq.scene][i].q) : [],
      event: lq.kind === L.KIND.DEKIGOTO ? LIFE_EVENTS[lq.idx] : null,
      target: targetText,
      answerer: kiku && phase === L.PHASE.ANSWER && lq.target >= 0 ? order[lq.target] : null,
      others: order.filter((name, i) => i !== turn && L.present(room, game, name)),
      playerName: actor,
      playerIndex: turn,
      dice: game.last?.dice || null,
      act: act && !net.busy,
      onChoose: roomChoose,
    });
    }
  } else if (!anim && !rolling && !picking && q) {
    key = 'q:' + game.id + ':' + game.rollNo + ':' + q.n;
    const item = normalizeQ(QUESTIONS[q.theme][q.idx]);
    const hasChoices = !!(item.choices && item.choices.length);
    $('goalCard').hidden = true;
    $('questionCard').hidden = false;
    fillQuestion(q.theme, item, actor, {
      playerIndex: turn,
      dice: game.last?.dice || null,
      canPress: act && !net.busy,
      onChoose: roomChoose,
      freeWrites: true,
      // 選択肢がある質問は、選ぶと次の人の番になる（選んだものは盤の上に出る）
      showNext: act && !hasChoices,
      showSkip: act,
      waitText: act
        ? (hasChoices ? CHOICE_HINT : '')
        : (hasChoices ? `${actor}さんが選ぶと、次の人の番になるよ` : `${actor}さんが話しおわると、次の人へ進むよ`),
    });
  }
  stage.hidden = key == null;
  $('diceArea').hidden = key != null || picking;
  renderDicePick(anim ? null : game, act && !net.busy, 'どっちの目で進む？');
  // カードが変わった・消えたら、書く欄を閉じる（前のカードの文を、次のカードに持ちこさない）
  if (key !== net.shownKey) closeWrite();
  if (key && key !== net.shownKey) {
    net.voteFor = null; // カードが変わったら、選ぶ人をえらびなおす
    popIn(key.startsWith('goal') ? $('goalCard') : $('questionCard'));
    if (key.startsWith('goal')) celebrate();
  }
  net.shownKey = key;
}

/* ── 番の操作（番の人とホスト） ── */
// allow: 押してよいかの検査（ない時は、番の人とホスト）。みんなが同時に選ぶマスでは、自分のぶんを選べるかを見る
async function roomAct(mutate, failMessage, allow) {
  const allowed = allow || ((room, uid, nickname, role) => L.canAct(room, uid, nickname, role));
  if (net.offline) {
    // 1台の画面: 通信せずに、その場で決まりを当てる
    const next = allowed(net.room, 'local', null, 'host') ? mutate(net.room) : null;
    if (next) {
      net.room = next;
      trackRoll(next);
    }
    renderRoom(net.room);
    return !!next;
  }
  if (net.busy || !net.roomRef) return null;
  net.busy = true;
  const uid = currentUid();
  const nickname = net.nickname;
  const role = net.role;
  try {
    const result = await net.roomRef.transaction((room) => {
      if (!room || isExpired(room) || !allowed(room, uid, nickname, role)) return;
      return mutate(room) || undefined;
    });
    return result.committed;
  } catch (error) {
    console.warn('[kyoumi-sugoroku] action failed', error);
    toast(failMessage);
    return null;
  } finally {
    net.busy = false;
    if (net.room && net.roomRef) renderRoom(net.room);
  }
}

function currentTurn() {
  const game = L.gameOf(net.room);
  return game ? { id: game.id, rollNo: Number(game.rollNo) || 0, qn: (L.isLife(game) ? L.lifeQuestionOf(game) : L.questionOf(game, COUNTS))?.n ?? 0 } : null;
}

async function roomRoll() {
  const now = currentTurn();
  if (!now || animRunning()) return;
  const seed = L.randomSeed();
  let goal = false;
  const ok = await roomAct((room) => {
    const next = L.roll(room, now.id, now.rollNo, seed, COUNTS);
    goal = next?.status === L.STATUS.GOAL;
    return next;
  }, 'サイコロを振れませんでした。もう一度ためしてね');
  // 利用回数: ゴールまで進んだ（ゴールを確定させた端末だけ）
  if (ok && goal) window.RoomkStats?.count('finish');
}

async function roomReask() {
  const now = currentTurn();
  if (!now) return;
  const seed = L.randomSeed();
  await roomAct((room) => L.reask(room, now.id, now.rollNo, now.qn, seed, COUNTS), '質問を変えられませんでした。もう一度ためしてね');
}

async function roomChoose(choice, text = '') {
  const now = currentTurn();
  const game = L.gameOf(net.room);
  if (now && L.isLife(game)) {
    const lq = L.lifeQuestionOf(game);
    if (!lq) return;
    let picked = choice;
    let n = 0;
    if (lq.kind === L.KIND.KIKU && (lq.phase === L.PHASE.WHO || L.targetGone(net.room, game, lq))) {
      // 画面の並び（自分以外の、いまいる人）を、順番の番号になおす
      const others = L.orderOf(game).map((_, i) => i).filter((i) => i !== L.turnOf(game) && L.present(net.room, game, L.orderOf(game)[i]));
      picked = choice === L.CHOICE_FREE ? L.TARGET_ALL : others[choice];
      if (picked == null) return;
    } else if (lq.kind === L.KIND.KIKU && lq.phase === L.PHASE.ANSWER) {
      n = LIFE_ASK[lq.scene][lq.idx].choices.length;
    } else if (lq.kind === L.KIND.ERABU) {
      n = LIFE_QUESTIONS[lq.scene][lq.idx].choices.length;
    }
    const seed = L.randomSeed();
    await roomAct((room) => L.choose(room, now.id, now.rollNo, now.qn, picked, n, COUNTS, seed, text), '選べませんでした。もう一度ためしてね');
    return;
  }
  const q = L.questionOf(game, COUNTS);
  if (!now || !q) return;
  const item = normalizeQ(QUESTIONS[q.theme][q.idx]);
  const count = item.choices ? item.choices.length : 0;
  await roomAct((room) => L.choose(room, now.id, now.rollNo, now.qn, choice, count, COUNTS, 0, text), '選べませんでした。もう一度ためしてね');
}

// みんなが同時に選ぶマス: その人のぶんを選ぶ（自分のぶん。ホストは、端末のない人・つながっていない人のぶんも）
async function roomVote(voter, choice) {
  const now = currentTurn();
  if (!now) return;
  const ok = await roomAct(
    (room) => L.vote(room, now.id, now.rollNo, now.qn, voter, choice),
    '選べませんでした。もう一度ためしてね',
    (room, uid, nickname, role) => L.canVote(room, uid, nickname, role, voter),
  );
  // ホストがほかの人のぶんも入れるときは、次のまだの人へ移る
  if (ok && net.room) {
    const game = L.gameOf(net.room);
    const lq = L.lifeQuestionOf(game);
    if (lq && L.isVoteKind(lq.kind) && !lq.open) {
      const uid = currentUid();
      const next = L.orderOf(game).map((_, i) => i)
        .find((i) => lq.votes[i] == null && L.canVote(net.room, uid, net.nickname, net.role, i));
      if (next != null) { net.voteFor = next; renderRoom(net.room); }
    }
  }
}

// おたすけカードを使う: 画面の並び（進められる相手）を順番の番号になおして、2マス進める
async function roomHelp(choice) {
  const now = currentTurn();
  const game = L.gameOf(net.room);
  if (!now || !game || animRunning()) return;
  const target = L.helpTargets(net.room, game)[choice];
  const have = L.cardsOf(game, L.turnOf(game));
  if (target == null || !have) return;
  net.helpOpen = null;
  let goal = false;
  const ok = await roomAct((room) => {
    const next = L.useHelp(room, now.id, now.rollNo, target, have);
    goal = next?.status === L.STATUS.GOAL;
    return next;
  }, 'おたすけカードを使えませんでした。もう一度ためしてね');
  if (ok && goal) window.RoomkStats?.count('finish');
}

// みんなが選ぶ前に開く（番の人かホスト）
async function roomOpenVotes() {
  const now = currentTurn();
  if (!now) return;
  await roomAct((room) => L.openVotes(room, now.id, now.rollNo, now.qn), '開けませんでした。もう一度ためしてね');
}

// サイコロを2つ振ったあと、進む目を選ぶ
async function roomPickDie(which) {
  const now = currentTurn();
  if (!now || animRunning()) return;
  const seed = L.randomSeed();
  let goal = false;
  const ok = await roomAct((room) => {
    const next = L.pickDie(room, now.id, now.rollNo, which, seed);
    goal = next?.status === L.STATUS.GOAL;
    return next;
  }, '進めませんでした。もう一度ためしてね');
  if (ok && goal) window.RoomkStats?.count('finish');
}

// ゴールした人の番: 画面の並び（まだゴールしていない人）を順番の番号になおして、1マス進める
async function roomCheer(choice) {
  const now = currentTurn();
  const game = L.gameOf(net.room);
  if (!now || !game || animRunning()) return;
  const target = L.cheerTargets(net.room, game)[choice];
  if (target == null) return;
  let goal = false;
  const ok = await roomAct((room) => {
    const next = L.cheer(room, now.id, now.rollNo, target);
    goal = next?.status === L.STATUS.GOAL;
    return next;
  }, 'おうえんできませんでした。もう一度ためしてね');
  if (ok && goal) window.RoomkStats?.count('finish');
}

async function roomNext() {
  const now = currentTurn();
  if (!now) return;
  await roomAct((room) => L.nextPlayer(room, now.id, now.rollNo), '次の人へ進めませんでした。もう一度ためしてね');
}

/* ── ホストの操作 ── */
async function hostTransaction(update, failMessage) {
  // 処理中の二度押しは何もしない（失敗の通知も出さない）
  if (net.role !== 'host' || net.busy || !net.roomRef) return null;
  net.busy = true;
  const uid = currentUid();
  try {
    const result = await net.roomRef.transaction((room) => {
      if (!room || room.hostUid !== uid || isExpired(room)) return;
      return update(room) || undefined;
    });
    return result.committed;
  } catch (error) {
    console.warn('[kyoumi-sugoroku] host action failed', error);
    if (failMessage) toast(failMessage);
    return null;
  } finally {
    net.busy = false;
    if (net.room && net.roomRef) renderRoom(net.room);
  }
}

// サイコロを振る番の人がいない（退出・切断）まま少し待っても戻らなければ、次の人へとばす
function hostWatchAbsent(room) {
  const game = L.gameOf(room);
  const playing = game && room.status === L.STATUS.PLAYING;
  // 前の版が作った人生の道のゲーム・知らない段階のゲームは、この版では進められない → 待合室にもどす
  const old = playing && L.isOldLife(game);
  const actor = playing && (L.isRollStep(game) || L.isPickStep(game)) ? L.actorOf(game) : null;
  // サイコロを振る・進む目を選ぶ番の人がいないとき → 次の人へとばす
  const skip = actor != null && !L.present(room, game, actor);
  // カードが出ている段階なのに読めるカードがない・目を選ぶ段階なのに目が読めないとき（壊れた値）→ 立て直す
  const broken = playing && L.talkBroken(game, COUNTS);
  const badPick = playing && L.pickBroken(game);
  // みんなが同時に選ぶマスで、まだ選んでいない人がいなくなって、いる人がみんな選んだ形になったとき → 開く
  const ready = playing && L.votesComplete(room, game);
  const kind = old ? 'o' : broken ? 'b' : badPick ? 'p' : ready ? 'v' : skip ? 's' : '';
  // 質問の番号も入れる（別の質問に変わったら、待つ時間を数えなおす）
  const watchBase = (g) => `${g.id}:${g.rollNo}:${L.turnOf(g)}:${L.qnOf(g)}`;
  const key = kind ? `${watchBase(game)}:${kind}` : null;
  if (key === net.skipKey) return;
  clearTimeout(net.skipTimer);
  net.skipTimer = null;
  net.skipKey = key;
  if (!key) return;
  net.skipTimer = setTimeout(async () => {
    net.skipTimer = null;
    if (net.skipKey !== key) return;
    const ok = await hostTransaction((r) => {
      const g = L.gameOf(r);
      if (!g || watchBase(g) !== key.slice(0, -2)) return;
      if (kind === 'o') return L.isOldLife(g) ? L.backToWaiting(r, g.id) : undefined;
      if (kind === 'b') return L.talkBroken(g, COUNTS) ? L.dropTalk(r) : undefined;
      if (kind === 'p') return L.dropPick(r);
      if (kind === 'v') return L.openIfComplete(r);
      return L.skipAbsent(r);
    }, '');
    if (ok && kind === 'o') toast('ゲームを続けられなくなったので、待合室にもどりました。「はじめる」でもう一度あそべます', false);
    // 進めなかったら（ほかの操作の処理中など）、少し待ってもう一度見る（次のルームの変化を待たない）
    if (!ok && net.skipKey === key) {
      net.skipKey = null;
      net.skipTimer = setTimeout(() => {
        net.skipTimer = null;
        if (net.role === 'host' && net.room && !net.offline) hostWatchAbsent(net.room);
      }, 1000);
    }
  }, kind === 'o' ? 500 : ABSENT_GRACE_MS);
}

async function setHostPlays(value) {
  const ok = await hostTransaction((room) => {
    if (room.status !== L.STATUS.WAITING) return;
    if (value && !room.hostPlays && L.playingNames(room).length >= L.MAX_PLAYERS) return;
    return { ...room, hostPlays: value };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && net.room) renderRoom(net.room);
}

async function setRoomMode(value) {
  const ok = await hostTransaction((room) => {
    if (room.status !== L.STATUS.WAITING) return;
    return { ...room, mode: L.modeOf(value) };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && net.room) renderRoom(net.room);
}

async function setRoomLifeLen(value) {
  const ok = await hostTransaction((room) => {
    if (room.status !== L.STATUS.WAITING) return;
    return { ...room, lifeLen: L.lifeLenOf(value) };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && net.room) renderRoom(net.room);
}

async function setSquares(value) {
  const ok = await hostTransaction((room) => {
    if (room.status !== L.STATUS.WAITING) return;
    return { ...room, squares: L.squaresOf(value) };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && net.room) renderRoom(net.room);
}

async function toggleTheme(input) {
  const current = L.themesOf(net.room?.themes, COUNTS);
  const next = input.checked
    ? Object.keys(THEMES).filter((key) => key === input.value || current.includes(key))
    : current.filter((key) => key !== input.value);
  if (next.length < L.MIN_THEMES) {
    input.checked = true;
    toast('テーマは2つ以上選んでね');
    return;
  }
  const ok = await hostTransaction((room) => {
    if (room.status !== L.STATUS.WAITING) return;
    return { ...room, themes: next };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && net.room) renderRoom(net.room);
}

async function addProxy() {
  const name = $('proxyName').value.trim();
  const error = L.validNickname(name);
  if (error) {
    setError('proxyError', error);
    return;
  }
  setError('proxyError', '');
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    if (room.status !== L.STATUS.WAITING) { reason = 'はじめる前だけ足せるよ'; return; }
    if (room.players?.[name] || room.proxies?.[name] || name === room.host) { reason = '「' + name + '」はもういるよ'; return; }
    if (L.playingNames(room).length >= L.MAX_PLAYERS) { reason = '遊べるのは' + L.MAX_PLAYERS + '人までだよ'; return; }
    return { ...room, proxies: { ...(room.proxies || {}), [name]: { joinedAt: RoomkRTDB.now() } } };
  }, '足せませんでした。もう一度ためしてね');
  // 待っている間に次の名前を打ちはじめていたら、消さない
  if (ok && $('proxyName').value.trim() === name) $('proxyName').value = '';
  else if (ok === false) setError('proxyError', reason || '足せませんでした。もう一度ためしてね');
}

async function removeProxy(name) {
  await hostTransaction((room) => {
    if (room.status !== L.STATUS.WAITING || !room.proxies?.[name]) return;
    const proxies = { ...room.proxies };
    delete proxies[name];
    return { ...room, proxies: Object.keys(proxies).length ? proxies : null };
  }, '外せませんでした。もう一度ためしてね');
}

async function startRoomGame() {
  let players = 0;
  let lifeMode = false;
  const ok = await hostTransaction((room) => {
    const next = L.startGame(room, COUNTS);
    players = next ? L.orderOf(next.game).length : 0;
    lifeMode = !!next && L.isLife(next.game);
    return next;
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + players);
    if (lifeMode) window.RoomkStats?.count('mode-life');
  } else if (ok === false) {
    toast('はじめられませんでした。参加している人を確かめてね');
  }
}

async function backToWaiting(fromGoal) {
  const gameId = L.gameOf(net.room)?.id;
  if (gameId == null) return;
  if (!fromGoal && !window.confirm('ゲームを終わって待合室に戻りますか？')) return;
  const ok = await hostTransaction((room) => {
    if (fromGoal && room.status !== L.STATUS.GOAL) return;
    return L.backToWaiting(room, gameId);
  }, 'もどれませんでした。もう一度ためしてね');
  // 利用回数: ゴールのあと、続けてもう1回を選んだ
  if (ok && fromGoal) window.RoomkStats?.count('again');
}

/* ════════════ ボタンと入口 ════════════ */
function inRoom() {
  return !!net.roomRef || !!net.offline;
}

function submitOnEnter(input, handler) {
  input.addEventListener('keydown', (event) => {
    // 日本語入力の確定の Enter では送らない（Safari は確定の Enter を isComposing=false・keyCode 229 で届ける）
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) handler();
  });
}

initSettings();
buildToggle('roomSquares', L.SQUARE_OPTIONS.map((n) => ({ value: n, label: `${n}マス` })), L.DEFAULT_SQUARES, setSquares);
buildToggle('roomMode', [{ value: L.MODE.THEME, label: 'テーマで話す' }, { value: L.MODE.LIFE, label: '人生の道' }], L.MODE.THEME, setRoomMode);
buildToggle('roomLifeLen', [{ value: -1, label: 'みじかい' }, { value: 0, label: 'ふつう' }, { value: 1, label: 'ながい' }], 0, setRoomLifeLen);
buildThemeList('roomThemes', toggleTheme);

$('btnGoLocal').addEventListener('click', () => showScreen('settings'));
$('btnSettingsBack').addEventListener('click', () => showScreen('top'));
$('btnGoCreate').addEventListener('click', () => {
  setError('createError', '');
  showScreen('create');
  $('hostName').focus({ preventScroll: true });
});
$('btnGoJoin').addEventListener('click', () => {
  setError('joinError', '');
  $('joinLinkHint').hidden = true;
  showScreen('join');
});
$('btnCreateBack').addEventListener('click', () => showScreen('top'));
$('btnJoinBack').addEventListener('click', () => showScreen('top'));
$('btnCreateRoom').addEventListener('click', createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
submitOnEnter($('hostName'), createRoom);
submitOnEnter($('guestName'), joinRoom);
submitOnEnter($('joinCode'), joinRoom);
$('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(net.roomCode, event.currentTarget));
$('btnCopyLink').addEventListener('click', (event) => {
  if (!net.roomCode || !ROOM_CODE_PATTERN.test(net.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkRTDB.copyRoomLink(net.roomCode, event.currentTarget);
});
// 別の端末（スマホ・タブレット）で入る人向けに、参加用のリンクを QR コードで大きく出す（共通の RoomkQR、room-qr.js）
$('btnShowQr').addEventListener('click', () => {
  if (!net.roomCode || !ROOM_CODE_PATTERN.test(net.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkQR.show(net.roomCode);
});
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);
$('hostPlays').addEventListener('change', (event) => setHostPlays(event.currentTarget.checked));
$('btnAddProxy').addEventListener('click', addProxy);
submitOnEnter($('proxyName'), addProxy);
$('btnStartGame').addEventListener('click', startRoomGame);
$('btnRoomBack').addEventListener('click', () => backToWaiting(false));

$('btn-roll').addEventListener('click', () => (inRoom() ? roomRoll() : rollLocalDice()));
$('btn-next').addEventListener('click', () => (inRoom() ? roomNext() : closeLocalQuestion()));
$('btn-skip').addEventListener('click', () => {
  // おたすけカードの相手を選んでいるときは「やめる」
  if (net.helpOpen) { net.helpOpen = null; if (net.room) renderRoom(net.room); return; }
  if (inRoom()) roomReask(); else skipLocalQuestion();
});
$('btnHelp').addEventListener('click', () => {
  const game = L.gameOf(net.room);
  if (!game) return;
  net.helpOpen = `${game.id}:${game.rollNo}:${L.turnOf(game)}`;
  renderRoom(net.room);
});
$('btnWriteSend').addEventListener('click', sendWrite);
$('btnWriteBack').addEventListener('click', () => {
  closeWrite();
  // 押していた「自由に話す」に、キーボードの位置をもどす
  document.querySelector('#modal-choices .ks-choice--free')?.focus();
});
$('writeText').addEventListener('keydown', (e) => {
  // 変換の確定の Enter では送らない（Safari は確定の Enter を keyCode 229 で届ける）
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  $('btnWriteSend').click();
});
$('btn-restart').addEventListener('click', () => (net.offline ? playAgainLocal() : inRoom() ? backToWaiting(true) : playAgainLocal()));
$('btnOpenVotes').addEventListener('click', roomOpenVotes);
$('btnGoalSettings').addEventListener('click', backToLocalSettings);
$('btn-back').addEventListener('click', () => {
  if (confirm('ゲームを終わって設定に戻りますか？')) backToLocalSettings();
});

// 参加用のリンクでひらいたとき: コードを入れた状態で参加画面を開き、名前だけ入れてもらう（コード欄は直せるように残す）
function openJoinFromLink(code) {
  setError('joinError', '');
  $('joinCode').value = code;
  $('joinLinkHint').hidden = false;
  showScreen('join');
  $('guestName').focus({ preventScroll: true });
}

// 再読み込みなどで、保存した記録から同じルームへ戻る
function resumeFromSession() {
  if (!loadSession()) return;
  tryReconnect().then((reconnected) => {
    if (!reconnected && !net.roomRef) clearSession();
  });
}

showScreen('top');
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam !== null) {
  // 参加用のリンク（?room=コード）の入口。コードはつないだときにアドレスから外す（connectToRoom）
  const linkCode = normalizeRoomCode(roomParam);
  const saved = loadSession();
  if (!ROOM_CODE_PATTERN.test(linkCode)) {
    toast('ルームコードが正しくないよ');
    history.replaceState(null, '', location.pathname);
    resumeFromSession();
  } else if (saved && saved.roomCode === linkCode) {
    // 同じルームの記録が残っていれば、名前を入れなおさずに戻る。戻れなければ参加画面へ
    tryReconnect().then((reconnected) => {
      if (reconnected || net.roomRef) return;
      clearSession();
      openJoinFromLink(linkCode);
    });
  } else {
    // 別のルームの記録が残っていても、ひらいたリンクのルームを優先する
    if (saved) clearSession();
    openJoinFromLink(linkCode);
  }
} else {
  resumeFromSession();
}
