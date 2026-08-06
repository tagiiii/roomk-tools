// どっちにする？ アプリロジック
// 共通モジュール: shuffle (M-3), escapeHtml
import { shuffle, escapeHtml as esc } from '../shared/js/utils.js';

// ── 番号付け規約（AGENTS.md: 丸数字で統一）──
const NUMBERS = ['①', '②', '③'];

// ③は「2択にしばられない自由」を守る正式な選択肢
const EXTRA_CHOICES = ['その他'];

// ── カテゴリ ──
const CATEGORIES = [
  { id: 'all', label: 'すべて' },
  { id: 'tabemono', label: '食べもの' },
  { id: 'asobi', label: '遊び' },
  { id: 'moshimo', label: 'もしも' },
  { id: 'doubutsu', label: '動物' },
  { id: 'seikatsu', label: '生活' },
];

// ── お題リスト（85問）──
// q: お題文 / a・b: 2択 / ask: メンター向けの軽い追い質問例
const TOPICS = [
  // 食べもの（17）
  { cat: 'tabemono', q: 'チョコのお菓子、選ぶなら？', a: 'きのこの山', b: 'たけのこの里', ask: 'いつからそっち派？' },
  { cat: 'tabemono', q: '朝ごはんにするなら？', a: 'パン', b: 'ごはん', ask: '今日は何を食べた？' },
  { cat: 'tabemono', q: 'カレーを頼むなら？', a: '甘口', b: '辛口', ask: 'おうちのカレーはどっち？' },
  { cat: 'tabemono', q: 'フライドポテトなら？', a: 'カリカリ', b: 'ホクホク', ask: 'どこのポテトが好き？' },
  { cat: 'tabemono', q: 'アイスを選ぶなら？', a: 'カップ', b: 'コーン', ask: '好きな味もある？' },
  { cat: 'tabemono', q: 'おにぎりの具なら？', a: 'しゃけ', b: 'ツナマヨ', ask: 'ほかに好きな具は？' },
  { cat: 'tabemono', q: '麺を食べるなら？', a: 'ラーメン', b: 'うどん', ask: '好きな味はある？' },
  { cat: 'tabemono', q: 'おやつにするなら？', a: 'チョコ', b: 'グミ', ask: '最近食べた？' },
  { cat: 'tabemono', q: '目玉焼きにかけるなら？', a: 'しょうゆ', b: 'ソース', ask: '卵料理で一番好きなのは？' },
  { cat: 'tabemono', q: 'たこ焼きの好きなところは？', a: '外カリカリ', b: '中トロトロ', ask: 'たこ焼き、最近食べた？' },
  { cat: 'tabemono', q: 'ジュースを選ぶなら？', a: 'オレンジ', b: 'りんご', ask: 'ほかに好きな飲みものは？' },
  { cat: 'tabemono', q: 'ホットケーキにかけるなら？', a: 'はちみつ', b: 'チョコソース', ask: '何枚くらい食べられそう？' },
  { cat: 'tabemono', q: 'からあげにレモンは？', a: 'かける', b: 'かけない', ask: 'こだわりポイントある？' },
  { cat: 'tabemono', q: 'お寿司で選ぶなら？', a: 'サーモン', b: 'たまご', ask: 'ほかに好きなネタは？' },
  { cat: 'tabemono', q: '今日のごはんにするなら？', a: 'ピザ', b: 'ハンバーガー', ask: 'どんなトッピングが好き？' },
  { cat: 'tabemono', q: 'かき氷のシロップなら？', a: 'いちご', b: 'ブルーハワイ', ask: '頭キーンとなるタイプ？' },
  { cat: 'tabemono', q: 'あったかいの、選ぶなら？', a: '肉まん', b: 'ピザまん', ask: '最近食べたのはいつ？' },

  // 遊び（17）
  { cat: 'asobi', q: '水遊びに行くなら？', a: '海', b: 'プール', ask: 'どんな遊びをしたい？' },
  { cat: 'asobi', q: 'ゲームをするなら？', a: 'アクション', b: 'パズル', ask: '最近やってるゲームある？' },
  { cat: 'asobi', q: 'トランプで遊ぶなら？', a: 'ババぬき', b: '神経衰弱', ask: '得意なほう？' },
  { cat: 'asobi', q: 'じゃんけん、最初に出すのは？', a: 'グー', b: 'パー', ask: 'チョキ派の人はどう思う？' },
  { cat: 'asobi', q: '遊園地で乗るなら？', a: '観覧車', b: 'ゴーカート', ask: '乗ってみたい乗りものある？' },
  { cat: 'asobi', q: '砂場で作るなら？', a: '大きい山', b: '長い川', ask: 'トンネルもほる派？' },
  { cat: 'asobi', q: 'ゲームのしかたは？', a: 'ひとりでじっくり', b: 'みんなでわいわい', ask: '最近のおすすめは？' },
  { cat: 'asobi', q: '作るなら？', a: 'ねんど', b: 'おりがみ', ask: '最近何か作った？' },
  { cat: 'asobi', q: '外で遊ぶなら？', a: 'シャボン玉', b: '水風船', ask: '大きいシャボン玉つくれる？' },
  { cat: 'asobi', q: 'かくれんぼをするなら？', a: 'かくれる方', b: '探す方', ask: 'とっておきのかくれ場所ある？' },
  { cat: 'asobi', q: '動画を見るなら？', a: 'ゲーム実況', b: 'アニメ', ask: 'おすすめ教えて？' },
  { cat: 'asobi', q: 'ブロックで作るなら？', a: 'おうち', b: '乗りもの', ask: 'どんなのを作りたい？' },
  { cat: 'asobi', q: '花火をするなら？', a: '手持ち花火', b: '打ち上げ花火を見る', ask: '今年の夏はやりたい？' },
  { cat: 'asobi', q: 'カラオケで歌うなら？', a: 'アニソン', b: 'はやりの曲', ask: 'じゅうはちばん、ある？' },
  { cat: 'asobi', q: '公園で遊ぶなら？', a: 'ブランコ', b: 'すべり台', ask: '公園、最近行った？' },
  { cat: 'asobi', q: 'ボードゲームなら？', a: '人生ゲーム', b: 'オセロ', ask: '最近やった？' },
  { cat: 'asobi', q: '遊びに行くなら？', a: 'ゲームセンター', b: '映画館', ask: '最近行った？' },

  // もしも（17）
  { cat: 'moshimo', q: 'もしも力がもらえるなら？', a: '空を飛ぶ', b: '透明になる', ask: '最初に何する？' },
  { cat: 'moshimo', q: 'もしも話せるなら？', a: '動物と話せる', b: '機械と話せる', ask: '最初に何て話しかける？' },
  { cat: 'moshimo', q: 'もしもタイムマシンがあったら？', a: '過去に行く', b: '未来に行く', ask: '何年ぐらい行きたい？' },
  { cat: 'moshimo', q: 'もしもどっちかもらえるなら？', a: 'どこでもドア', b: 'タケコプター', ask: 'どこに行きたい？' },
  { cat: 'moshimo', q: 'もしも住めるなら？', a: '海の中の家', b: '雲の上の家', ask: '部屋はどんなふうにする？' },
  { cat: 'moshimo', q: 'もしも大きさを変えられるなら？', a: '巨大になる', b: '小さくなる', ask: 'なってみて何したい？' },
  { cat: 'moshimo', q: 'もしもなれるなら？', a: '魔法使い', b: '忍者', ask: 'どんな技を使いたい？' },
  { cat: 'moshimo', q: 'もしも一緒にくらすなら？', a: 'ロボットの友だち', b: '恐竜のペット', ask: '名前をつけるなら？' },
  { cat: 'moshimo', q: 'もしも1日だけなれるなら？', a: '鳥', b: '魚', ask: 'どこまで行ってみたい？' },
  { cat: 'moshimo', q: 'もしも住むなら？', a: 'お菓子の家', b: 'おもちゃの家', ask: 'どんな家にしたい？' },
  { cat: 'moshimo', q: 'もしも時間をあやつれるなら？', a: '止められる', b: '巻きもどせる', ask: 'どんなときに使いたい？' },
  { cat: 'moshimo', q: 'もしも宝さがしに行くなら？', a: '海賊の宝', b: '恐竜の化石', ask: '見つけたらどうする？' },
  { cat: 'moshimo', q: 'もしも空を飛ぶなら？', a: '魔法のじゅうたん', b: '魔法のほうき', ask: 'どこの上を飛んでみたい？' },
  { cat: 'moshimo', q: 'もしもペットが話せたら？', a: 'うれしい', b: 'ちょっと困る', ask: '何て言われそう？' },
  { cat: 'moshimo', q: 'もしも無人島に1つ持てるなら？', a: 'ゲーム', b: 'マンガ', ask: 'どのタイトルにする？' },
  { cat: 'moshimo', q: 'もしも天気を選べるなら？', a: '毎日晴れ', b: 'ときどき雨も', ask: '雨の日の過ごし方ある？' },
  { cat: 'moshimo', q: 'もしも変身できるなら？', a: '見た目を変えられる', b: '声を変えられる', ask: 'だれになってみたい？' },

  // 動物（17）
  { cat: 'doubutsu', q: '飼うなら？', a: '犬', b: 'ねこ', ask: '名前をつけるなら？' },
  { cat: 'doubutsu', q: 'だっこしてみたいのは？', a: 'パンダ', b: 'コアラ', ask: 'どこがかわいいと思う？' },
  { cat: 'doubutsu', q: '小さいペットなら？', a: 'ハムスター', b: 'インコ', ask: 'どんなところが好き？' },
  { cat: 'doubutsu', q: '会いに行くなら？', a: 'イルカ', b: 'ペンギン', ask: 'ショーは見てみたい？' },
  { cat: 'doubutsu', q: 'モフモフするなら？', a: 'うさぎ', b: 'アルパカ', ask: 'さわったことある？' },
  { cat: 'doubutsu', q: '出かけるなら？', a: '動物園', b: '水族館', ask: '最後に行ったのいつ？' },
  { cat: 'doubutsu', q: 'かっこいいのは？', a: 'ライオン', b: 'トラ', ask: 'どこがかっこいい？' },
  { cat: 'doubutsu', q: '背中に乗ってみたいのは？', a: 'ゾウ', b: 'キリン', ask: '高いところは平気？' },
  { cat: 'doubutsu', q: 'いやされるのは？', a: 'カワウソ', b: 'カピバラ', ask: '動画とかで見る？' },
  { cat: 'doubutsu', q: '鳥でかっこいいのは？', a: 'フクロウ', b: 'ワシ', ask: '飛んでるところ見たことある？' },
  { cat: 'doubutsu', q: 'おうちの水そうに入れるなら？', a: '金魚', b: 'メダカ', ask: '名前つける派？' },
  { cat: 'doubutsu', q: 'のんびりしてるのは？', a: 'カメ', b: 'ナマケモノ', ask: '自分ものんびり派？' },
  { cat: 'doubutsu', q: 'ネコになるなら？', a: 'おうちでごろごろ', b: '外を探検', ask: '一日何して過ごす？' },
  { cat: 'doubutsu', q: '海の大きい生きものなら？', a: 'シャチ', b: 'ジンベエザメ', ask: '水族館で見たことある？' },
  { cat: 'doubutsu', q: '牧場でさわるなら？', a: 'ヒツジ', b: 'ヤギ', ask: '牧場、行ったことある？' },
  { cat: 'doubutsu', q: '犬と遊ぶなら？', a: 'ボール投げ', b: 'お散歩', ask: 'どんな犬が好き？' },
  { cat: 'doubutsu', q: '手のひらにのせるなら？', a: 'リス', b: 'ハリネズミ', ask: 'ちくちくしそう？' },

  // 生活（17）
  { cat: 'seikatsu', q: 'おふろタイムは？', a: 'ゆっくりおふろ', b: 'さっとシャワー', ask: 'おふろで何考える？' },
  { cat: 'seikatsu', q: '好きな季節は？', a: '夏', b: '冬', ask: 'その季節の楽しみは？' },
  { cat: 'seikatsu', q: 'くつを選ぶなら？', a: 'スニーカー', b: 'サンダル', ask: 'いま何色のくつ？' },
  { cat: 'seikatsu', q: 'まくらは？', a: '高め', b: '低め', ask: 'ぬいぐるみと寝る派？' },
  { cat: 'seikatsu', q: '服を選ぶなら？', a: '明るい色', b: '落ちついた色', ask: 'お気に入りの一枚ある？' },
  { cat: 'seikatsu', q: '旅行に行くなら？', a: '海の近く', b: '山の近く', ask: '何して過ごしたい？' },
  { cat: 'seikatsu', q: '乗るなら？', a: '電車', b: 'バス', ask: 'どこ行きのに乗りたい？' },
  { cat: 'seikatsu', q: '髪を切るなら？', a: 'バッサリ', b: 'ちょっとずつ', ask: '緊張する派？' },
  { cat: 'seikatsu', q: '冬のリラックスなら？', a: 'こたつ', b: '毛布にくるまる', ask: 'こたつでみかん派？' },
  { cat: 'seikatsu', q: '買いものするなら？', a: 'じっくり選ぶ', b: 'パッと決める', ask: '最近買ってよかったものは？' },
  { cat: 'seikatsu', q: '休みの日の朝は？', a: 'のんびり過ごす', b: 'さっそく動く', ask: '今日の朝はどうだった？' },
  { cat: 'seikatsu', q: 'アイスを食べるなら？', a: '暑い夏に', b: '寒い冬に', ask: '冬アイスやったことある？' },
  { cat: 'seikatsu', q: 'くつしたは？', a: 'くるぶし丈', b: '長め', ask: 'こだわりある？' },
  { cat: 'seikatsu', q: '部屋で過ごすなら？', a: 'パジャマ派', b: 'ジャージ派', ask: 'お着がえは早いほう？' },
  { cat: 'seikatsu', q: '乗りものの席なら？', a: '窓側', b: '通路側', ask: '窓から何を見るのが好き？' },
  { cat: 'seikatsu', q: '住んでみたいのは？', a: '都会', b: 'いなか', ask: 'どんなところがよさそう？' },
  { cat: 'seikatsu', q: '寝るときは？', a: 'まっ暗派', b: 'ちょっと明るい派', ask: '寝る前に何かする？' },
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
    <button class="dc-choice" type="button" data-idx="0" aria-pressed="false" aria-label="1番: ${esc(t.a)}">
      <span class="dc-choice__num">${NUMBERS[0]}</span>
      <span class="dc-choice__text">${esc(t.a)}</span>
    </button>
    <span class="dc-vs__mark" aria-hidden="true">vs</span>
    <button class="dc-choice" type="button" data-idx="1" aria-pressed="false" aria-label="2番: ${esc(t.b)}">
      <span class="dc-choice__num">${NUMBERS[1]}</span>
      <span class="dc-choice__text">${esc(t.b)}</span>
    </button>
  `;

  document.getElementById('altArea').innerHTML = EXTRA_CHOICES.map((label, i) => `
    <button class="dc-choice dc-choice--alt" type="button" data-idx="${i + 2}"
            aria-pressed="false" aria-label="${i + 3}番: ${esc(label)}">
      <span class="dc-choice__num">${NUMBERS[i + 2]}</span>
      <span class="dc-choice__text">${esc(label)}</span>
    </button>
  `).join('');

  document.getElementById('askHint').innerHTML =
    `<span class="material-symbols-rounded">chat_bubble</span>聞いてみるなら「${esc(t.ask)}」`;
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
