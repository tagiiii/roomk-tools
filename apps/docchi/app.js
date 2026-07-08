// どっちにする？ アプリロジック
// 共通モジュール: shuffle (M-3), escapeHtml
import { shuffle, escapeHtml as esc } from '../shared/js/utils.js';

// ── 番号付け規約（AGENTS.md: 丸数字で統一）──
const NUMBERS = ['①', '②', '③', '④'];

// ③④は「答えない自由」を守る正式な選択肢
const EXTRA_CHOICES = ['どっちもいい', 'どっちでもない'];

// ── カテゴリ ──
const CATEGORIES = [
  { id: 'all', label: 'すべて' },
  { id: 'tabemono', label: 'たべもの' },
  { id: 'asobi', label: 'あそび' },
  { id: 'moshimo', label: 'もしも' },
  { id: 'doubutsu', label: 'どうぶつ' },
  { id: 'seikatsu', label: 'せいかつ' },
];

// ── お題リスト（85問）──
// q: お題文 / a・b: 2択 / ask: メンター向けの軽い追い質問例
const TOPICS = [
  // たべもの（17）
  { cat: 'tabemono', q: 'チョコのおかし、えらぶなら？', a: 'きのこの山', b: 'たけのこの里', ask: 'いつからそっち派？' },
  { cat: 'tabemono', q: 'あさごはんにするなら？', a: 'パン', b: 'ごはん', ask: 'きょうは何を食べた？' },
  { cat: 'tabemono', q: 'カレーをたのむなら？', a: 'あまくち', b: 'からくち', ask: 'おうちのカレーはどっち？' },
  { cat: 'tabemono', q: 'フライドポテトなら？', a: 'カリカリ', b: 'ホクホク', ask: 'どこのポテトがすき？' },
  { cat: 'tabemono', q: 'アイスをえらぶなら？', a: 'カップ', b: 'コーン', ask: 'すきな味もある？' },
  { cat: 'tabemono', q: 'おにぎりのぐなら？', a: 'しゃけ', b: 'ツナマヨ', ask: 'ほかにすきなぐは？' },
  { cat: 'tabemono', q: 'めんを食べるなら？', a: 'ラーメン', b: 'うどん', ask: 'すきな味はある？' },
  { cat: 'tabemono', q: 'おやつにするなら？', a: 'チョコ', b: 'グミ', ask: 'さいきん食べた？' },
  { cat: 'tabemono', q: '目玉やきにかけるなら？', a: 'しょうゆ', b: 'ソース', ask: 'たまごりょうりで一番すきなのは？' },
  { cat: 'tabemono', q: 'たこやきのすきなところは？', a: '外カリカリ', b: '中トロトロ', ask: 'たこやき、さいきん食べた？' },
  { cat: 'tabemono', q: 'ジュースをえらぶなら？', a: 'オレンジ', b: 'りんご', ask: 'ほかにすきなのみものは？' },
  { cat: 'tabemono', q: 'ホットケーキにかけるなら？', a: 'はちみつ', b: 'チョコソース', ask: '何まいくらい食べられそう？' },
  { cat: 'tabemono', q: 'からあげにレモンは？', a: 'かける', b: 'かけない', ask: 'こだわりポイントある？' },
  { cat: 'tabemono', q: 'おすしでえらぶなら？', a: 'サーモン', b: 'たまご', ask: 'ほかにすきなネタは？' },
  { cat: 'tabemono', q: 'きょうのごはんにするなら？', a: 'ピザ', b: 'ハンバーガー', ask: 'どんなトッピングがすき？' },
  { cat: 'tabemono', q: 'かきごおりのシロップなら？', a: 'いちご', b: 'ブルーハワイ', ask: 'あたまキーンとなるタイプ？' },
  { cat: 'tabemono', q: 'あったかいの、えらぶなら？', a: '肉まん', b: 'ピザまん', ask: 'さいきん食べたのはいつ？' },

  // あそび（17）
  { cat: 'asobi', q: '水あそびに行くなら？', a: '海', b: 'プール', ask: 'どんなあそびをしたい？' },
  { cat: 'asobi', q: 'ゲームをするなら？', a: 'アクション', b: 'パズル', ask: 'さいきんやってるゲームある？' },
  { cat: 'asobi', q: 'トランプであそぶなら？', a: 'ババぬき', b: 'しんけいすいじゃく', ask: 'とくいなほう？' },
  { cat: 'asobi', q: 'じゃんけん、さいしょに出すのは？', a: 'グー', b: 'パー', ask: 'チョキ派の人はどう思う？' },
  { cat: 'asobi', q: 'ゆうえんちで乗るなら？', a: 'かんらんしゃ', b: 'ゴーカート', ask: 'のってみたい乗りものある？' },
  { cat: 'asobi', q: 'すなばで作るなら？', a: '大きい山', b: 'ながい川', ask: 'トンネルもほる派？' },
  { cat: 'asobi', q: 'ゲームのしかたは？', a: 'ひとりでじっくり', b: 'みんなでわいわい', ask: 'さいきんのおすすめは？' },
  { cat: 'asobi', q: 'つくるなら？', a: 'ねんど', b: 'おりがみ', ask: 'さいきん何か作った？' },
  { cat: 'asobi', q: '外であそぶなら？', a: 'シャボン玉', b: '水ふうせん', ask: '大きいシャボン玉つくれる？' },
  { cat: 'asobi', q: 'かくれんぼをするなら？', a: 'かくれる方', b: 'さがす方', ask: 'とっておきのかくれ場所ある？' },
  { cat: 'asobi', q: '動画を見るなら？', a: 'ゲーム実況', b: 'アニメ', ask: 'おすすめおしえて？' },
  { cat: 'asobi', q: 'ブロックで作るなら？', a: 'おうち', b: 'のりもの', ask: 'どんなのを作りたい？' },
  { cat: 'asobi', q: 'はなびをするなら？', a: '手もちはなび', b: 'うちあげはなびを見る', ask: 'ことしの夏はやりたい？' },
  { cat: 'asobi', q: 'カラオケで歌うなら？', a: 'アニソン', b: 'はやりの曲', ask: 'じゅうはちばん、ある？' },
  { cat: 'asobi', q: '公園であそぶなら？', a: 'ブランコ', b: 'すべりだい', ask: 'こうえん、さいきん行った？' },
  { cat: 'asobi', q: 'ボードゲームなら？', a: '人生ゲーム', b: 'オセロ', ask: 'さいきんやった？' },
  { cat: 'asobi', q: 'あそびに行くなら？', a: 'ゲームセンター', b: 'えいがかん', ask: 'さいきん行った？' },

  // もしも（17）
  { cat: 'moshimo', q: 'もしも力がもらえるなら？', a: '空をとぶ', b: 'とうめいになる', ask: 'さいしょに何する？' },
  { cat: 'moshimo', q: 'もしも話せるなら？', a: 'どうぶつと話せる', b: 'きかいと話せる', ask: 'さいしょに何て話しかける？' },
  { cat: 'moshimo', q: 'もしもタイムマシンがあったら？', a: 'かこに行く', b: 'みらいに行く', ask: '何年ぐらい行きたい？' },
  { cat: 'moshimo', q: 'もしもどっちかもらえるなら？', a: 'どこでもドア', b: 'タケコプター', ask: 'どこに行きたい？' },
  { cat: 'moshimo', q: 'もしも住めるなら？', a: '海の中の家', b: '雲の上の家', ask: 'へやはどんなふうにする？' },
  { cat: 'moshimo', q: 'もしも大きさをかえられるなら？', a: 'きょだいになる', b: 'ちいさくなる', ask: 'なってみて何したい？' },
  { cat: 'moshimo', q: 'もしもなれるなら？', a: 'まほうつかい', b: 'にんじゃ', ask: 'どんなわざをつかいたい？' },
  { cat: 'moshimo', q: 'もしもいっしょにくらすなら？', a: 'ロボットの友だち', b: 'きょうりゅうのペット', ask: '名前をつけるなら？' },
  { cat: 'moshimo', q: 'もしも1日だけなれるなら？', a: 'とり', b: 'さかな', ask: 'どこまで行ってみたい？' },
  { cat: 'moshimo', q: 'もしも住むなら？', a: 'おかしの家', b: 'おもちゃの家', ask: 'どんな家にしたい？' },
  { cat: 'moshimo', q: 'もしも時間をあやつれるなら？', a: '止められる', b: 'まきもどせる', ask: 'どんなときに使いたい？' },
  { cat: 'moshimo', q: 'もしもたからさがしに行くなら？', a: 'かいぞくのたから', b: 'きょうりゅうのかせき', ask: '見つけたらどうする？' },
  { cat: 'moshimo', q: 'もしも空をとぶなら？', a: 'まほうのじゅうたん', b: 'まほうのほうき', ask: 'どこの上をとんでみたい？' },
  { cat: 'moshimo', q: 'もしもペットが話せたら？', a: 'うれしい', b: 'ちょっとこまる', ask: '何て言われそう？' },
  { cat: 'moshimo', q: 'もしも無人島に1つもてるなら？', a: 'ゲーム', b: 'マンガ', ask: 'どのタイトルにする？' },
  { cat: 'moshimo', q: 'もしも天気をえらべるなら？', a: 'まいにち晴れ', b: 'ときどき雨も', ask: '雨の日のすごし方ある？' },
  { cat: 'moshimo', q: 'もしもへんしんできるなら？', a: '見た目をかえられる', b: 'こえをかえられる', ask: 'だれになってみたい？' },

  // どうぶつ（17）
  { cat: 'doubutsu', q: 'かうなら？', a: '犬', b: 'ねこ', ask: '名前をつけるなら？' },
  { cat: 'doubutsu', q: 'だっこしてみたいのは？', a: 'パンダ', b: 'コアラ', ask: 'どこがかわいいと思う？' },
  { cat: 'doubutsu', q: '小さいペットなら？', a: 'ハムスター', b: 'インコ', ask: 'どんなところがすき？' },
  { cat: 'doubutsu', q: '会いに行くなら？', a: 'イルカ', b: 'ペンギン', ask: 'ショーは見てみたい？' },
  { cat: 'doubutsu', q: 'モフモフするなら？', a: 'うさぎ', b: 'アルパカ', ask: 'さわったことある？' },
  { cat: 'doubutsu', q: '出かけるなら？', a: 'どうぶつ園', b: '水ぞく館', ask: 'さいごに行ったのいつ？' },
  { cat: 'doubutsu', q: 'かっこいいのは？', a: 'ライオン', b: 'トラ', ask: 'どこがかっこいい？' },
  { cat: 'doubutsu', q: 'せなかに乗ってみたいのは？', a: 'ゾウ', b: 'キリン', ask: '高いところはへいき？' },
  { cat: 'doubutsu', q: 'いやされるのは？', a: 'カワウソ', b: 'カピバラ', ask: '動画とかで見る？' },
  { cat: 'doubutsu', q: 'とりでかっこいいのは？', a: 'フクロウ', b: 'ワシ', ask: 'とんでるところ見たことある？' },
  { cat: 'doubutsu', q: 'おうちの水そうに入れるなら？', a: '金魚', b: 'メダカ', ask: '名前つける派？' },
  { cat: 'doubutsu', q: 'のんびりしてるのは？', a: 'カメ', b: 'ナマケモノ', ask: '自分ものんびり派？' },
  { cat: 'doubutsu', q: 'ネコになるなら？', a: 'おうちでごろごろ', b: 'そとをたんけん', ask: '一日何してすごす？' },
  { cat: 'doubutsu', q: '海の大きい生きものなら？', a: 'シャチ', b: 'ジンベエザメ', ask: '水ぞく館で見たことある？' },
  { cat: 'doubutsu', q: 'ぼくじょうでさわるなら？', a: 'ヒツジ', b: 'ヤギ', ask: 'ぼくじょう行ったことある？' },
  { cat: 'doubutsu', q: '犬とあそぶなら？', a: 'ボールなげ', b: 'おさんぽ', ask: 'どんな犬がすき？' },
  { cat: 'doubutsu', q: 'てのひらにのせるなら？', a: 'リス', b: 'ハリネズミ', ask: 'ちくちくしそう？' },

  // せいかつ（17）
  { cat: 'seikatsu', q: 'おふろタイムは？', a: 'ゆっくりおふろ', b: 'さっとシャワー', ask: 'おふろで何かんがえる？' },
  { cat: 'seikatsu', q: 'すきなきせつは？', a: '夏', b: '冬', ask: 'そのきせつの楽しみは？' },
  { cat: 'seikatsu', q: 'くつをえらぶなら？', a: 'スニーカー', b: 'サンダル', ask: 'いま何色のくつ？' },
  { cat: 'seikatsu', q: 'まくらは？', a: '高め', b: 'ひくめ', ask: 'ぬいぐるみと寝る派？' },
  { cat: 'seikatsu', q: '服をえらぶなら？', a: '明るい色', b: '落ちついた色', ask: 'お気に入りの一まいある？' },
  { cat: 'seikatsu', q: '旅行に行くなら？', a: '海の近く', b: '山の近く', ask: '何して過ごしたい？' },
  { cat: 'seikatsu', q: '乗るなら？', a: '電車', b: 'バス', ask: 'どこ行きのに乗りたい？' },
  { cat: 'seikatsu', q: 'かみを切るなら？', a: 'バッサリ', b: 'ちょっとずつ', ask: 'きんちょうする派？' },
  { cat: 'seikatsu', q: '冬のリラックスなら？', a: 'こたつ', b: 'もうふにくるまる', ask: 'こたつでみかん派？' },
  { cat: 'seikatsu', q: '買いものするなら？', a: 'じっくりえらぶ', b: 'パッと決める', ask: 'さいきん買ってよかったものは？' },
  { cat: 'seikatsu', q: '休みの日の朝は？', a: 'のんびりすごす', b: 'さっそくうごく', ask: 'きょうの朝はどうだった？' },
  { cat: 'seikatsu', q: 'アイスを食べるなら？', a: 'あつい夏に', b: 'さむい冬に', ask: '冬アイスやったことある？' },
  { cat: 'seikatsu', q: 'くつしたは？', a: 'くるぶしたけ', b: 'ながめ', ask: 'こだわりある？' },
  { cat: 'seikatsu', q: 'へやですごすなら？', a: 'パジャマ派', b: 'ジャージ派', ask: 'おきがえは早いほう？' },
  { cat: 'seikatsu', q: '乗りものの席なら？', a: 'まど側', b: 'つうろ側', ask: 'まどから何を見るのがすき？' },
  { cat: 'seikatsu', q: '住んでみたいのは？', a: 'とかい', b: 'いなか', ask: 'どんなところがよさそう？' },
  { cat: 'seikatsu', q: 'ねるときは？', a: 'まっくら派', b: 'ちょっと明るい派', ask: 'ねる前に何かする？' },
];

// ── 状態 ──
// 集計・履歴は持たない（その場で流れて消えるのが正しい）
const state = {
  category: 'all',
  pool: [],
  current: null,
};

// ── 画面切り替え ──
function showScreen(id) {
  document.querySelectorAll('.dc-screen').forEach((s) => s.classList.remove('dc-screen--active'));
  document.getElementById(id).classList.add('dc-screen--active');
}

// ── カテゴリ選択 ──
function renderCategories() {
  const list = document.getElementById('catList');
  list.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'dc-cat__chip';
    btn.type = 'button';
    btn.textContent = c.label;
    btn.setAttribute('aria-pressed', String(c.id === state.category));
    if (c.id === state.category) btn.classList.add('dc-cat__chip--on');
    btn.addEventListener('click', () => {
      state.category = c.id;
      renderCategories();
    });
    list.appendChild(btn);
  });
}

// ── お題プール ──
function topicsForCategory() {
  if (state.category === 'all') return TOPICS;
  return TOPICS.filter((t) => t.cat === state.category);
}

function refillPool() {
  state.pool = shuffle(topicsForCategory());
  // 補充直後に直前と同じお題が続かないようにする（2問以上あるとき）
  if (state.pool.length > 1 && state.pool[state.pool.length - 1] === state.current) {
    state.pool.unshift(state.pool.pop());
  }
}

function drawNext() {
  if (state.pool.length === 0) refillPool();
  state.current = state.pool.pop();
  renderCard();
}

// ── カード描画 ──
function renderCard() {
  const t = state.current;
  document.getElementById('cardArea').classList.remove('dc-card--answered');
  document.getElementById('topicQ').textContent = t.q;

  // お題文字列は静的データだが、DOM挿入時は必ず esc() を通す（AGENTS.md XSS対策）
  document.getElementById('vsArea').innerHTML = `
    <button class="dc-choice" type="button" data-idx="0" aria-pressed="false" aria-label="1ばん: ${esc(t.a)}">
      <span class="dc-choice__num">${NUMBERS[0]}</span>
      <span class="dc-choice__text">${esc(t.a)}</span>
    </button>
    <span class="dc-vs__mark" aria-hidden="true">vs</span>
    <button class="dc-choice" type="button" data-idx="1" aria-pressed="false" aria-label="2ばん: ${esc(t.b)}">
      <span class="dc-choice__num">${NUMBERS[1]}</span>
      <span class="dc-choice__text">${esc(t.b)}</span>
    </button>
  `;

  document.getElementById('altArea').innerHTML = EXTRA_CHOICES.map((label, i) => `
    <button class="dc-choice dc-choice--alt" type="button" data-idx="${i + 2}"
            aria-pressed="false" aria-label="${i + 3}ばん: ${esc(label)}">
      <span class="dc-choice__num">${NUMBERS[i + 2]}</span>
      <span class="dc-choice__text">${esc(label)}</span>
    </button>
  `).join('');

  document.getElementById('askHint').innerHTML =
    `<span class="material-symbols-rounded">chat_bubble</span>きいてみるなら「${esc(t.ask)}」`;
}

// ── 選択（ふわっとハイライトのみ。記録はしない）──
function pick(btn) {
  document.querySelectorAll('.dc-choice').forEach((b) => {
    b.classList.remove('dc-choice--picked');
    b.setAttribute('aria-pressed', 'false');
  });
  // 選び直しでもアニメーションが再生されるようリフローを挟む
  void btn.offsetWidth;
  btn.classList.add('dc-choice--picked');
  btn.setAttribute('aria-pressed', 'true');
  document.getElementById('cardArea').classList.add('dc-card--answered');
}

// ── イベント ──
document.getElementById('btnStart').addEventListener('click', () => {
  refillPool();
  drawNext();
  const label = CATEGORIES.find((c) => c.id === state.category).label;
  document.getElementById('catLabel').textContent = label;
  showScreen('screenCard');
});

document.getElementById('btnNext').addEventListener('click', drawNext);

document.getElementById('btnTop').addEventListener('click', () => {
  state.current = null;
  showScreen('screenTop');
});

document.getElementById('cardArea').addEventListener('click', (e) => {
  const btn = e.target.closest('.dc-choice');
  if (btn) pick(btn);
});

// ── 初期化 ──
renderCategories();
