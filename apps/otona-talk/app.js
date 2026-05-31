// おとなトークカード アプリロジック
// 大人が答える雑談カード。子どもが質問を選び、その場の大人が答える。
// 共通モジュール: shuffle (M-3), copyToClipboard (M-2), popIn (M-5)
import { shuffle, copyToClipboard, popIn } from '../shared/js/utils.js';

// ── カテゴリ定義（軽い雑談 → 仕事・歩んできた道 → これから の順）──
const CATEGORIES = [
  { key: 'icebreak', label: 'アイスブレイク' },
  { key: 'kids',     label: '子ども時代' },
  { key: 'work',     label: '仕事のこと' },
  { key: 'path',     label: '歩んできた道' },
  { key: 'values',   label: '考え方' },
  { key: 'future',   label: 'これから' },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

// ── お題リスト ──
// t: 質問文 / c: カテゴリキー
const topics = [
  // アイスブレイク（人となりを身近に感じる軽い雑談）
  { t: '休みの日は何をして過ごすことが多い？', c: 'icebreak' },
  { t: '最近ハマっていることは？', c: 'icebreak' },
  { t: '朝起きていちばん最初にすることは？', c: 'icebreak' },
  { t: '好きな食べ物は何？', c: 'icebreak' },
  { t: 'ついつい時間を忘れちゃうことは？', c: 'icebreak' },
  { t: '最近「これ買ってよかった」と思ったものは？', c: 'icebreak' },
  { t: 'リフレッシュしたいときはどうする？', c: 'icebreak' },
  { t: '行きつけのお店や好きな場所はある？', c: 'icebreak' },
  { t: '最近笑ったことは？', c: 'icebreak' },
  { t: 'もし明日まる1日自由になったら何をする？', c: 'icebreak' },
  { t: '朝型？　夜型？', c: 'icebreak' },
  { t: '好きな季節は？　その理由も教えて', c: 'icebreak' },
  { t: '最近見て面白かった動画・番組・映画は？', c: 'icebreak' },
  { t: '元気が出る音楽や曲はある？', c: 'icebreak' },
  { t: 'ちょっとした自慢できることはある？', c: 'icebreak' },
  { t: '一人の時間と、みんなでいる時間、どっちが好き？', c: 'icebreak' },

  // 子ども時代・学生時代（大人にも子ども時代があったと知る）
  { t: '子どものころ、何になりたかった？', c: 'kids' },
  { t: '子どものころハマっていた遊びやゲームは？', c: 'kids' },
  { t: '子どものころ得意だったことは？', c: 'kids' },
  { t: '小さいころの宝物は何だった？', c: 'kids' },
  { t: '子どものとき好きだった場所は？', c: 'kids' },
  { t: '夢中になって集めていたものはある？', c: 'kids' },
  { t: '昔よく見ていたアニメや番組は？', c: 'kids' },
  { t: '子どものころのあだ名はあった？', c: 'kids' },
  { t: '学生のころハマっていたことは？', c: 'kids' },
  { t: '子どものとき「これは苦手だな」と思っていたことは？', c: 'kids' },
  { t: '子どものころのいちばんの思い出は？', c: 'kids' },
  { t: '昔思っていた「将来の自分」と、今を比べてどう？', c: 'kids' },
  { t: '子どものころよく食べていた好きなものは？', c: 'kids' },
  { t: '昔、友だちとはどんなことをして遊んでた？', c: 'kids' },

  // 仕事のこと（働く大人の姿が見える）
  { t: '今どんな仕事をしているの？', c: 'work' },
  { t: 'その仕事を選んだきっかけは？', c: 'work' },
  { t: '仕事でうれしかった瞬間は？', c: 'work' },
  { t: '仕事の1日って、どんな流れ？', c: 'work' },
  { t: '仕事で「これは大変！」と思うことは？', c: 'work' },
  { t: 'これまでにやったことのある仕事は？（アルバイトも含めて）', c: 'work' },
  { t: '仕事で大事にしていることは？', c: 'work' },
  { t: '仕事中のちょっとした楽しみは？', c: 'work' },
  { t: '仕事で身についた特技やスキルはある？', c: 'work' },
  { t: 'どんなときに「この仕事っていいな」と思う？', c: 'work' },
  { t: '一緒に働く人たちとは、どんなふうに過ごしてる？', c: 'work' },
  { t: 'お気に入りの仕事道具やアイテムはある？', c: 'work' },
  { t: '「こんな仕事もあるんだ」と発見したことはある？', c: 'work' },
  { t: '仕事をしていて意外だったことは？', c: 'work' },

  // 歩んできた道・選択（キャリアの道のり。寄り道も歓迎）
  { t: '今の仕事にたどり着くまで、どんな道を通ってきた？', c: 'path' },
  { t: '「やってみてよかった」と思う選択は？', c: 'path' },
  { t: '回り道や寄り道をした経験はある？', c: 'path' },
  { t: 'これまでに影響を受けた人はいる？', c: 'path' },
  { t: '進む道を決めるとき、何を考えていた？', c: 'path' },
  { t: '途中で方向転換したことはある？', c: 'path' },
  { t: 'やってみて初めて「自分に合ってる」と気づいたことは？', c: 'path' },
  { t: '不安だったけど、思いきって決めたことはある？', c: 'path' },
  { t: '「あのときの経験が今に生きてるな」と思うことは？', c: 'path' },
  { t: 'もし昔の自分に一言かけるとしたら？', c: 'path' },
  { t: '「これは続けてきてよかった」と思うことは？', c: 'path' },
  { t: '学生のころの夢と今、どれくらい変わった？', c: 'path' },

  // 考え方・価値観（大事にしていること）
  { t: '大事にしている考え方は？', c: 'values' },
  { t: '元気が出ないとき、どうやって立て直す？', c: 'values' },
  { t: '失敗とは、どんなふうに付き合ってる？', c: 'values' },
  { t: '「これが好き」と胸を張って言えることは？', c: 'values' },
  { t: '自分にごほうびをあげるなら、何をする？', c: 'values' },
  { t: '苦手なこととは、どう付き合ってる？', c: 'values' },
  { t: '最近「学んだな」と思ったことは？', c: 'values' },
  { t: '迷ったときの決め方ってある？', c: 'values' },
  { t: '人と接するときに気をつけていることは？', c: 'values' },
  { t: '自分のここが好き、と思えるところは？', c: 'values' },
  { t: '大切にしている言葉はある？', c: 'values' },
  { t: '「これだけは譲れない」ことはある？', c: 'values' },

  // これから・やってみたいこと（大人にも夢がある）
  { t: 'これからやってみたいことは？', c: 'future' },
  { t: '行ってみたい場所はある？', c: 'future' },
  { t: '今チャレンジしていることは？', c: 'future' },
  { t: '学び直したい・身につけたいことは？', c: 'future' },
  { t: 'いつかやってみたい仕事や活動はある？', c: 'future' },
  { t: '最近気になっていることは？', c: 'future' },
  { t: '5年後、どんなふうに過ごしていたい？（ゆるくでOK）', c: 'future' },
  { t: 'これから挑戦してみたい趣味はある？', c: 'future' },
  { t: 'もし時間とお金が自由なら、何をしてみたい？', c: 'future' },
  { t: 'ひそかに温めている目標や夢はある？', c: 'future' },
];

// ── 状態 ──
const selectedCats = new Set(CATEGORIES.map((c) => c.key)); // 初期値：全カテゴリ
let pool   = [];
let hand   = [];
let chosen = null;

// ── プール管理（M-3）──
function filteredTopics() {
  return topics.filter((t) => selectedCats.has(t.c));
}

function refill() {
  pool = shuffle(filteredTopics());
}

function drawHand() {
  if (pool.length < 3) refill();
  hand = pool.splice(0, 3);
}

// ── カテゴリフィルター ──
function renderFilter() {
  const wrap = document.querySelector('#catFilter');
  wrap.innerHTML = '';

  const allOn = selectedCats.size === CATEGORIES.length;

  // 「ぜんぶ」チップ
  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'ot-chip' + (allOn ? ' is-active' : '');
  allChip.textContent = 'ぜんぶ';
  allChip.setAttribute('aria-pressed', String(allOn));
  allChip.addEventListener('click', () => {
    CATEGORIES.forEach((c) => selectedCats.add(c.key));
    onFilterChange();
  });
  wrap.appendChild(allChip);

  // 各カテゴリチップ
  CATEGORIES.forEach((c) => {
    const on = selectedCats.has(c.key);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ot-chip' + (on ? ' is-active' : '');
    chip.textContent = c.label;
    chip.setAttribute('aria-pressed', String(on));
    chip.addEventListener('click', () => {
      if (on && selectedCats.size === 1) return; // 最低1つは残す
      if (on) selectedCats.delete(c.key);
      else selectedCats.add(c.key);
      onFilterChange();
    });
    wrap.appendChild(chip);
  });
}

function onFilterChange() {
  chosen = null;
  document.querySelector('#topicArea').classList.remove('visible');
  document.querySelector('#redrawArea').style.visibility = 'visible';
  refill();
  drawHand();
  renderFilter();
  render();
}

// ── レンダリング ──
function render() {
  const grid = document.querySelector('#cardGrid');
  grid.innerHTML = '';

  hand.forEach((topic, i) => {
    // M-4: flip-card 構造
    const card = document.createElement('div');
    card.className = 'flip-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${i + 1}番のカード`);

    card.innerHTML = `
      <div class="flip-card-inner">
        <div class="flip-card-face back ot-card-back">
          <span class="ot-card__num">${i + 1}</span>
          <span class="ot-card__hint">タップして開く</span>
        </div>
        <div class="flip-card-face front ot-card-front">
          <span class="ot-card__cat">${CAT_LABEL[topic.c]}</span>
          <span class="ot-card__topic"></span>
        </div>
      </div>
    `;
    // 質問文はユーザー入力ではないが、textContent で安全に挿入
    card.querySelector('.ot-card__topic').textContent = topic.t;

    const activate = () => {
      if (chosen !== null) return;
      pick(i, card, topic);
    };

    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });

    grid.appendChild(card);
  });

  updatePoolInfo();
}

function pick(idx, card, topic) {
  chosen = idx;

  // M-4: フリップ
  card.classList.add('flipped');

  // 他2枚を dimmed
  document.querySelectorAll('#cardGrid .flip-card').forEach((c, i) => {
    if (i !== idx) c.classList.add('dimmed');
  });

  // お題表示（M-5: popIn）
  const area = document.querySelector('#topicArea');
  document.querySelector('#topicLabel').textContent = CAT_LABEL[topic.c];
  document.querySelector('#topicText').textContent = topic.t;
  area.classList.add('visible');
  popIn(area);

  // 引き直しボタン非表示
  document.querySelector('#redrawArea').style.visibility = 'hidden';
}

function startNew() {
  chosen = null;
  document.querySelector('#topicArea').classList.remove('visible');
  document.querySelector('#redrawArea').style.visibility = 'visible';
  drawHand();
  render();
}

function drawNew() {
  if (chosen !== null) return;
  drawHand();
  render();
}

function updatePoolInfo() {
  const total = filteredTopics().length;
  document.querySelector('#poolInfo').textContent =
    `残り ${pool.length} / ${total} 問`;
}

// ── イベント ──
document.querySelector('#btnCopy').addEventListener('click', function () {
  // M-2: ボタンフィードバック付きコピー
  copyToClipboard(document.querySelector('#topicText').textContent, this);
});

document.querySelector('#btnNext').addEventListener('click', startNew);
document.querySelector('#btnRedraw').addEventListener('click', drawNew);

// ── 初期化 ──
renderFilter();
refill();
drawHand();
render();
