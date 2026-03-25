// トークテーマカード アプリロジック
// 共通モジュール: shuffle (M-3), copyToClipboard (M-2), popIn (M-5)
import { shuffle, copyToClipboard, popIn } from '../shared/js/utils.js';

// ── お題リスト（100枚）──
const topics = [
  // 好きなもの系（20）
  '最近ハマっていることは何？',
  '好きな食べ物ランキングTOP3は？',
  '今いちばん好きな動画・配信者は？',
  '好きなゲームを教えて！',
  '最近見たアニメや動画で面白かったものは？',
  '好きな音楽やアーティストは？',
  '好きな季節はどれ？その理由も教えて',
  '好きな動物は何？',
  '好きな色は何？どんなときに使いたくなる？',
  '好きなキャラクターは誰？',
  '最近買ったもので気に入っているものは？',
  '好きなスポーツや運動は何？',
  '好きなお菓子は何？',
  '好きな映画やドラマはある？',
  '好きなにおいは何？',
  '好きな言葉やフレーズはある？',
  '好きな天気は？その理由も教えて',
  '好きな乗り物は何？',
  '家の中でいちばん好きな場所はどこ？',
  '最近「これ最高！」と思ったものは何？',

  // 日常・生活系（20）
  '最近あったちょっといいことは？',
  '最近いちばんうれしかったことは？',
  '今日の朝ごはんは何だった？',
  '寝る前にしていることは何かある？',
  '今いちばん楽しみにしていることは？',
  '最近やってみた新しいことは？',
  '最近ちょっと笑ったことは？',
  '最近はまっているおやつは？',
  '休みの日はどうやって過ごすのが好き？',
  '最近見た夢で覚えているものはある？',
  '今日はどんな気分？一言で表すと？',
  '最近感動したことは？',
  '最近誰かに感謝したことはある？',
  '最近うれしかった言葉は？',
  '最近夢中になったことは？',
  '今いちばんほしいものは何？',
  '最近読んだ漫画や本はある？',
  '週末にやりたいことは何かある？',
  '最近お気に入りのYouTube動画や曲は？',
  '最近「あ、おいしい！」と思ったものは？',

  // もしも系（20）
  '魔法が1つ使えたら何をする？',
  '1日だけ動物になれるとしたら何になる？',
  '無人島に1つだけ持っていくなら何？',
  '空を飛べたら最初にどこへ行く？',
  'タイムマシンがあったら過去・未来どっちに行く？',
  '1億円もらったら最初に何をする？',
  '透明になれたら何をする？',
  'スーパーパワーが1つもらえるとしたら何がいい？',
  '好きな有名人と1日過ごせるとしたら誰を選ぶ？',
  '世界中どこでも瞬間移動できたらどこに行く？',
  '1週間なんでも食べ放題だったら何を食べる？',
  '宇宙人に会えたら何を話す？',
  '自分だけの秘密基地があったらどんな場所にする？',
  'どんな動物でも友達になれるとしたら何を選ぶ？',
  '3つ願い事が叶うとしたら何をお願いする？',
  '1か月間なんでも無料で使えるとしたら何をする？',
  '自分の分身（ロボット）がいたら何をさせる？',
  '自分のオリジナルゲームを作るとしたらどんなゲーム？',
  'もし世界に1人だけしかいなかったら何をする？',
  '夢の家があるとしたらどんな家にする？',

  // 自分のこと系（20）
  '一人でいるのと誰かといるの、どっちが落ち着く？',
  '朝型？夜型？',
  '料理するのと食べるの、どっちが好き？',
  '一日の中でいちばん好きな時間帯はいつ？',
  '自分のここが好き！と思えることはある？',
  '今の自分にひとこと声をかけるとしたら？',
  'ゲームは一人プレイ派？マルチプレイ派？',
  '自分の特技は何だと思う？',
  '最近自分が成長したと思う瞬間はある？',
  '誰かを笑わせたことはある？どんなとき？',
  '自分ってどんな人間だと思う？一言で！',
  '自分が一番輝いていると感じる瞬間は？',
  '誰かに「ありがとう」と言いたいことはある？',
  '今いちばん大切にしているものは何？',
  '何かにこだわっていることはある？',
  '最近「あ、これ好きだな」と思ったものは？',
  '怖いものはある？どんなもの？',
  '落ち込んだときにどうやって元気を出す？',
  'のんびりするのと動き回るの、どっちが好き？',
  '自分をひとつの食べ物に例えるとしたら何？',

  // やってみたいこと系（20）
  '将来やってみたいことは何かある？',
  '行ってみたい場所はどこ？',
  '食べてみたい料理や食べ物は？',
  '習ってみたいことや身につけたい技術は？',
  '最近「いいな」と思った人は？（有名人でもOK）',
  'チャレンジしてみたいスポーツは？',
  '作ってみたいもの（料理・工作・ゲームなど）は？',
  'いつか行ってみたい国はある？',
  '体験してみたい職業は何？',
  '将来住んでみたい場所はある？',
  'マスターしてみたい趣味は何？',
  '誰かに教えてあげたいことは何かある？',
  '友達とやってみたいことは？',
  '一人でやってみたいことは？',
  '今年中にやりたいことは？',
  '見てみたい景色はある？',
  '挑戦してみたい料理はある？',
  '体験してみたいイベントやフェスは？',
  '作ってみたいゲームはどんなゲーム？',
  'もっとうまくなりたいことは何？',
];

// ── 状態 ──
let pool   = [];
let hand   = [];
let chosen = null;

// ── M-3: プール管理 ──
function refill() {
  pool = shuffle(topics);
}

function drawHand() {
  if (pool.length < 3) refill();
  hand = pool.splice(0, 3);
}

// ── レンダリング ──
function render() {
  const grid = document.querySelector('#cardGrid');
  grid.innerHTML = '';

  hand.forEach((topic, i) => {
    // M-4: flip-card 構造を使用
    const card = document.createElement('div');
    card.className = 'flip-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${i + 1}番のカード`);

    card.innerHTML = `
      <div class="flip-card-inner">
        <div class="flip-card-face back card-face-back">
          <span class="card-number">${i + 1}</span>
          <span class="card-hint">タップして開く</span>
        </div>
        <div class="flip-card-face front card-face-front">
          <span class="card-topic">${topic}</span>
        </div>
      </div>
    `;

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

  // 他2枚をdimmed
  document.querySelectorAll('#cardGrid .flip-card').forEach((c, i) => {
    if (i !== idx) c.classList.add('dimmed');
  });

  // お題表示（M-5: popIn）
  const area = document.querySelector('#topicArea');
  document.querySelector('#topicText').textContent = topic;
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
  document.querySelector('#poolInfo').textContent =
    `残り ${pool.length} / ${topics.length} 枚`;
}

// ── イベント ──
document.querySelector('#btnCopy').addEventListener('click', function () {
  // M-2: ボタンフィードバック付きコピー
  copyToClipboard(document.querySelector('#topicText').textContent, this);
});

document.querySelector('#btnNext').addEventListener('click', startNew);
document.querySelector('#btnRedraw').addEventListener('click', drawNew);

// ── 初期化 ──
refill();
drawHand();
render();
