// え!? 実は○○なんですかゲーム アプリロジック
// 共通モジュール: shuffle (M-3), copyToClipboard (M-2), popIn (M-5)
import { shuffle, copyToClipboard, popIn } from '../shared/js/utils.js';

// ── プロンプトリスト（126枚）──
const prompts = [
  // 食べものの好み（21）
  'え!? 実は辛いものが全然食べられないんですか？',
  'え!? 実はパクチーが大好きなんですか？',
  'え!? 実はピーマンが意外と得意なんですか？',
  'え!? 実は甘いものよりしょっぱいものが好きなんですか？',
  'え!? 実は納豆が苦手なんですか？',
  'え!? 実は炭酸飲料がほとんど飲めないんですか？',
  'え!? 実は一番好きな食べ物がバナナなんですか？',
  'え!? 実はお寿司の中で卵が一番好きなんですか？',
  'え!? 実はラーメンよりうどんが好きなんですか？',
  'え!? 実はごはんより麺類が好きなんですか？',
  'え!? 実はチョコレートよりグミが好きなんですか？',
  'え!? 実はポテチよりせんべいが好きなんですか？',
  'え!? 実はすっぱいものがすごく好きなんですか？',
  'え!? 実はジュースよりお茶が好きなんですか？',
  'え!? 実は一番好きなフルーツがみかんなんですか？',
  'え!? 実は野菜の中でブロッコリーが一番好きなんですか？',
  'え!? 実はアイスよりシャーベットが好きなんですか？',
  'え!? 実はお好み焼きよりたこ焼きが断然好きなんですか？',
  'え!? 実は苦いものが意外と好きなんですか？',
  'え!? 実はつめたいより温かい飲みもののほうが好きなんですか？',
  'え!? 実はお肉よりさかなのほうが好きなんですか？',

  // 日常の習慣・生活（21）
  'え!? 実は夜より朝のほうが得意なんですか？',
  'え!? 実は部屋がめちゃくちゃきれいなんですか？',
  'え!? 実は毎日日記をつけているんですか？',
  'え!? 実は寝る前にストレッチをするんですか？',
  'え!? 実は料理が得意なんですか？',
  'え!? 実は歩くのがすごく速いんですか？',
  'え!? 実は字がとてもきれいなんですか？',
  'え!? 実は毎朝ちゃんと布団をたたむんですか？',
  'え!? 実は家では大声で歌うことがあるんですか？',
  'え!? 実は1日にかなりたくさん水を飲むんですか？',
  'え!? 実はよく独り言を言うほうなんですか？',
  'え!? 実はよくメモを取る習慣があるんですか？',
  'え!? 実は靴がかなり多いほうなんですか？',
  'え!? 実は考えごとをするときに歩き回るんですか？',
  'え!? 実は一人カラオケに行ったことがあるんですか？',
  'え!? 実は毎日きまった時間に寝るんですか？',
  'え!? 実は部屋のインテリアにこだわっているんですか？',
  'え!? 実は着替えるのにけっこう時間がかかるんですか？',
  'え!? 実はスマホのアプリをきれいに整理しているんですか？',
  'え!? 実はよく鼻歌を歌うんですか？',
  'え!? 実は誰よりも早くお風呂に入る派なんですか？',

  // 得意なこと・意外な能力（21）
  'え!? 実は方向感覚がすごくいいんですか？',
  'え!? 実は楽器が演奏できるんですか？',
  'え!? 実は絵を描くのが好きなんですか？',
  'え!? 実は声マネが得意なんですか？',
  'え!? 実は手先がすごく器用なんですか？',
  'え!? 実はじゃんけんが強いと言われたことがあるんですか？',
  'え!? 実は記憶力がかなりいいほうなんですか？',
  'え!? 実は折り紙がわりと得意なんですか？',
  'え!? 実は人の顔より名前のほうが覚えやすいんですか？',
  'え!? 実は犬や猫が懐きやすいんですか？',
  'え!? 実はリズム感がいいほうなんですか？',
  'え!? 実は話しかけられたらわりとすぐ打ち解けられるんですか？',
  'え!? 実は音楽を聴いたらすぐ歌詞を覚えるほうなんですか？',
  'え!? 実は速読ができるほうなんですか？',
  'え!? 実はものごとの細かい違いによく気がつくんですか？',
  'え!? 実は昔ならいごとをしていたことがあるんですか？',
  'え!? 実は地図を見るのが好きなんですか？',
  'え!? 実は意外と計算が得意なんですか？',
  'え!? 実はものまねが上手なんですか？',
  'え!? 実は暗記が意外と得意なんですか？',
  'え!? 実は高いところが全然こわくないんですか？',

  // 趣味・コレクション（21）
  'え!? 実はフィギュアをコレクションしているんですか？',
  'え!? 実はキーホルダーがめちゃくちゃ多いんですか？',
  'え!? 実はドキュメンタリー動画をよく見るんですか？',
  'え!? 実は本をかなりのペースで読むんですか？',
  'え!? 実は星座や星が好きなんですか？',
  'え!? 実はある生きものについて詳しく調べたことがあるんですか？',
  'え!? 実はよく写真を撮るんですか？',
  'え!? 実はパズルをやるのが好きなんですか？',
  'え!? 実はプラモデルを作ったことがあるんですか？',
  'え!? 実はある国の文化がすごく好きなんですか？',
  'え!? 実はスポーツの試合観戦が好きなんですか？',
  'え!? 実はお気に入りの文房具がたくさんあるんですか？',
  'え!? 実はあるゲームシリーズを全部やっているんですか？',
  'え!? 実は植物を育てているんですか？',
  'え!? 実は手書きでイラストを描くのが好きなんですか？',
  'え!? 実は天気や気象に興味があるんですか？',
  'え!? 実はお気に入りのキャラクターや推しがいるんですか？',
  'え!? 実はカードゲームが好きなんですか？',
  'え!? 実は料理動画をよく見るんですか？',
  'え!? 実は昆虫や生きものが大好きなんですか？',
  'え!? 実は工作やハンドメイドが好きなんですか？',

  // 性格・行動パターン（21）
  'え!? 実はけっこうマイペースなほうなんですか？',
  'え!? 実はひとりの時間がすごく好きなんですか？',
  'え!? 実はよく考えてから話すほうなんですか？',
  'え!? 実は失敗してもわりとすぐ立ち直れるほうなんですか？',
  'え!? 実はけっこうこだわりが強いほうなんですか？',
  'え!? 実は初対面でもそんなに緊張しないほうなんですか？',
  'え!? 実は人に何かをプレゼントするのがすごく好きなんですか？',
  'え!? 実は観察力がわりと鋭いほうなんですか？',
  'え!? 実はよく空想にふけることがあるんですか？',
  'え!? 実はちょっとした変化にすぐ気がつくほうなんですか？',
  'え!? 実は計画を立てるのが好きなんですか？',
  'え!? 実はけっこう几帳面なほうなんですか？',
  'え!? 実は流行よりも自分の好みを優先するほうなんですか？',
  'え!? 実は雨の日のほうが落ち着くんですか？',
  'え!? 実はわりとよく笑うほうなんですか？',
  'え!? 実は感情が顔に出やすいほうなんですか？',
  'え!? 実は心配性なほうなんですか？',
  'え!? 実は困っている人を見たら声をかけるほうなんですか？',
  'え!? 実はのんびりしているように見えて、頭の中では色々考えているんですか？',
  'え!? 実は一度決めたことをけっこうやり遂げるほうなんですか？',
  'え!? 実はお笑いにけっこう詳しいんですか？',

  // 意外な一面・あれこれ（21）
  'え!? 実は空を眺めるのが好きなんですか？',
  'え!? 実は動物より植物のほうが好きなんですか？',
  'え!? 実は音楽を聴きながら寝るんですか？',
  'え!? 実は意外とよく泣くほうなんですか？',
  'え!? 実はかなりびっくりしやすいほうなんですか？',
  'え!? 実は静かな場所よりにぎやかな場所のほうが集中できるんですか？',
  'え!? 実は意外と大食いなほうなんですか？',
  'え!? 実は朝ごはんをしっかり食べるほうなんですか？',
  'え!? 実は何かのキャラクターになりきったことがあるんですか？',
  'え!? 実は乗りものに乗るとけっこうすぐ眠くなるんですか？',
  'え!? 実は動物の名前をよく知っているんですか？',
  'え!? 実は部屋で音楽をかけながら過ごすほうなんですか？',
  'え!? 実は鉄道や乗りものが好きなんですか？',
  'え!? 実は花の名前をわりとよく知っているんですか？',
  'え!? 実は入浴時間がかなり長いほうなんですか？',
  'え!? 実は夜空を見て星座を探すことがあるんですか？',
  'え!? 実は遠くに行くより近場の好きな場所のほうが落ち着くんですか？',
  'え!? 実はあるテレビ番組やシリーズを全話見たことがあるんですか？',
  'え!? 実は食べものを食べる順番にこだわりがあるんですか？',
  'え!? 実は特定の色のものばかり選んでしまうんですか？',
  'え!? 実は何かについてかなりのマニアなんですか？',
];

// ── 状態 ──
// chosen: null = カード未選択（hidden）/ number = 選択済み（picked）
let pool   = [];
let hand   = [];
let chosen = null;

// ── M-3: プール管理 ──
function refill() {
  pool = shuffle([...prompts]);
}

function drawHand() {
  if (pool.length < 3) refill();
  hand = pool.splice(0, 3);
}

// ── レンダリング ──
function render() {
  const grid = document.querySelector('#cardGrid');
  grid.innerHTML = '';

  hand.forEach((prompt, i) => {
    // M-4: flip-card 構造
    const card = document.createElement('div');
    card.className = 'flip-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${i + 1}番のカード`);

    card.innerHTML = `
      <div class="flip-card-inner">
        <div class="flip-card-face back card-face-back">
          <span class="card-number">${i + 1}</span>
          <span class="card-hint">クリックでお題をひらく</span>
        </div>
        <div class="flip-card-face front card-face-front">
          <span class="card-prompt">${prompt}</span>
        </div>
      </div>
    `;

    const activate = () => {
      if (chosen !== null) return;
      pick(i, card, prompt);
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

  // UI を「未選択」状態に戻す
  document.querySelector('#promptPanel').classList.remove('visible');
  document.querySelector('#btnCopy').disabled = true;
  document.querySelector('#redrawArea').style.visibility = 'visible';
  updatePoolInfo();
}

// ── カードを選択してお題を表示 ──
function pick(idx, card, prompt) {
  chosen = idx;

  // M-4: フリップ
  card.classList.add('flipped');

  // 他2枚を dimmed
  document.querySelectorAll('#cardGrid .flip-card').forEach((c, i) => {
    if (i !== idx) c.classList.add('dimmed');
  });

  // お題パネルを表示（M-5: popIn）
  document.querySelector('#promptText').textContent = prompt;
  const panel = document.querySelector('#promptPanel');
  panel.classList.add('visible');
  popIn(panel);

  document.querySelector('#btnCopy').disabled = false;
  document.querySelector('#redrawArea').style.visibility = 'hidden';
}

// ── 次のラウンドへ ──
function startNew() {
  chosen = null;
  drawHand();
  render();
}

// ── 3枚引き直す（未選択時のみ）──
function drawNew() {
  if (chosen !== null) return;
  drawHand();
  render();
}

function updatePoolInfo() {
  document.querySelector('#poolInfo').textContent =
    `残り ${pool.length} / ${prompts.length} 枚`;
}

// ── イベント ──
document.querySelector('#btnCopy').addEventListener('click', function () {
  // M-2: ボタンフィードバック付きコピー
  copyToClipboard(document.querySelector('#promptText').textContent, this);
});
document.querySelector('#btnNext').addEventListener('click', startNew);
document.querySelector('#btnRedraw').addEventListener('click', drawNew);
document.querySelector('#btnReset').addEventListener('click', () => {
  refill();
  startNew();
});

// ── 初期化 ──
refill();
drawHand();
render();
