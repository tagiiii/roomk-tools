const APP_ID = 'mirai-hikidashi';
const SCHEMA_VERSION = 1;
const NUMBERS = ['①', '②', '③'];

// 3つの反応は全部同格。「今はいい」に否定的な意味・演出を持たせない
const REACTIONS = [
  { id: 'peek', label: 'のぞいてみる', icon: 'visibility', hint: 'ちょっと気になる入口', mark: true },
  { id: 'later', label: 'あとで見る', icon: 'bookmark', hint: '気になるかも。また今度見たい', mark: true },
  { id: 'pass', label: '今はいい', icon: 'waving_hand', hint: '今は閉じておく。それもぜんぜんあり', mark: false },
];

// 世界の入口。職業名は使わず「こんなことしてる人」の活動で書く
const DRAWERS = [
  {
    id: 'umi',
    name: '海の世界',
    icon: 'waves',
    peek: '海の中は、まだ全部はわかっていない場所。深い海には、光る生きものや、へんてこな形の魚がいるよ。波やしおの流れにも、ちゃんと理由があるんだって。',
    people: [
      '魚の名前を図鑑みたいに覚えてる人',
      '海の音だけを録音して集めてる人',
      '深い海の生きものを探しにいく人',
      '拾った貝がらで模様をつくる人',
    ],
    tries: [
      '「深海生物」の動画を見てみる',
      '図鑑やネットで、いちばんへんな顔の魚を探してみる',
    ],
  },
  {
    id: 'oto',
    name: '音の世界',
    icon: 'music_note',
    peek: '世界は音でいっぱい。雨の音、電車の音、声、楽器。音をまぜたり重ねたりすると、新しい音が生まれるんだ。同じ音でも、人によって聞こえかたがちがったりするよ。',
    people: [
      'まちの音を集めてまぜている人',
      '自分で楽器を手づくりする人',
      'ゲームの中の音を全部つくっている人',
      '目をつぶって、音だけで場所をあてられる人',
    ],
    tries: [
      '目をつぶって、いま聞こえる音をかぞえてみる',
      '「環境音」で気になる音を探してみる',
    ],
  },
  {
    id: 'tsukuru',
    name: 'つくる世界',
    icon: 'handyman',
    peek: '木・紙・ねんど・だんボール。手を動かすと、頭の中のものが目の前にあらわれるよ。失敗した形が、かえっておもしろくなることもあるんだ。',
    people: [
      'だんボールで動くしかけをつくる人',
      '小さい家（ミニチュア）を本ものそっくりにつくる人',
      'こわれたものをなおすのが得意な人',
      '世界に1つだけのボードゲームをつくる人',
    ],
    tries: [
      '「ダンボール工作」の動画を見てみる',
      '家にあるもので、何かひとつ工作してみる',
    ],
  },
  {
    id: 'ikimono',
    name: '生きものの世界',
    icon: 'pets',
    peek: '生きものは、それぞれぜんぜんちがう暮らしかたをしているよ。ねこの1日、ありの行列、鳥のわたり。じっと見ていると、不思議なことが次々見つかるんだ。',
    people: [
      '動物の赤ちゃんの世話をする人',
      '鳥の鳴き声で種類をあてられる人',
      'いぬやねこの気持ちを調べている人',
      '少なくなった生きものを守る人',
    ],
    tries: [
      '動物園や水族館のライブカメラを見てみる',
      '窓の外の鳥を、1種類見つけてみる',
    ],
  },
  {
    id: 'uchu',
    name: '宇宙の世界',
    icon: 'rocket_launch',
    peek: '空のむこうは、どこまでも続いているよ。月の模様、星のならび、ブラックホール。まだだれも行ったことのない場所がほとんどなんだ。',
    people: [
      '新しい星を探している人',
      'ロケットの部品をつくる人',
      '宇宙の写真を毎日ながめている人',
      '星からとどく電波を聞いている人',
    ],
    tries: [
      'JAXAやNASAの宇宙の写真を見てみる',
      '晴れた日の夜に、月をじっくり見てみる',
    ],
  },
  {
    id: 'tabemono',
    name: '食べものの世界',
    icon: 'restaurant',
    peek: '食べることは、毎日の楽しみ。味・におい・色・音、全部がかかわっているよ。まぜたり焼いたり冷やしたりすると、味や形が変身するんだ。',
    people: [
      '新しいおかしを考える人',
      '世界中のめずらしいくだものを食べくらべる人',
      'パンのふくらみかたを毎日試している人',
      'もりつけのきれいさを追求する人',
    ],
    tries: [
      'おかしづくりの動画をながめてみる',
      '家の人といっしょに、何かひとつまぜてつくってみる',
    ],
  },
  {
    id: 'norimono',
    name: '乗りものの世界',
    icon: 'train',
    peek: '電車、バス、飛行機、船。乗りものは人やものを運ぶだけじゃなくて、形も音も動きも全部ちがうよ。好きな人にはたまらないちがいなんだって。',
    people: [
      '電車の音だけで車両の種類をあてる人',
      '世界中の地下鉄の地図を集める人',
      'はたらくくるまを写真にとりつづける人',
      '模型のまちに乗りものを走らせる人',
    ],
    tries: [
      '「運転席からのながめ」の動画を見てみる',
      '近くを通る乗りものの音を、聞きくらべてみる',
    ],
  },
  {
    id: 'egaku',
    name: 'えがく世界',
    icon: 'palette',
    peek: '線を1本ひくだけでも、絵ははじまるよ。うまい・へたじゃなくて、「どんなふうに見えているか」をうつすのが絵なんだ。色の組み合わせだけでも遊べるよ。',
    people: [
      '毎日らくがきを1枚かく人',
      'デジタルで光る絵をかく人',
      'かべいっぱいに大きな絵をかく人',
      '好きな色だけで絵をかく人',
    ],
    tries: [
      '紙のすみに、小さくらくがきしてみる',
      '「スピードペイント」の動画を見てみる',
    ],
  },
  {
    id: 'kotoba',
    name: 'ことばの世界',
    icon: 'menu_book',
    peek: 'ことばは、ならべかたを変えるだけでひびきが変わるよ。だじゃれ、なぞなぞ、ものがたり、名前。世界には、まだ日本語にないことばもたくさんあるんだ。',
    people: [
      'ものがたりを少しずつ書きつづけている人',
      '世界のあいさつを集めている人',
      'だじゃれを1000こ知っている人',
      'ものの名前の由来を調べる人',
    ],
    tries: [
      '好きなものの名前の由来を調べてみる',
      '短いものがたりを、1行だけ書いてみる',
    ],
  },
  {
    id: 'kikai',
    name: '機械の世界',
    icon: 'smart_toy',
    peek: 'ボタンを押すと動く。その「なかみ」では、小さな部品がそれぞれ役割をもっているよ。ばらばらの部品が組み合わさって動きだすのは、魔法みたいだけどちゃんとしくみがあるんだ。',
    people: [
      'ロボットを動かす人',
      '時計を分解してなかを見るのが好きな人',
      'ゲーム機のしくみを調べる人',
      '動くおもちゃを発明する人',
    ],
    tries: [
      'ロボットが動いている動画を見てみる',
      '家の中の「ボタンで動くもの」をかぞえてみる',
    ],
  },
  {
    id: 'tetsudau',
    name: '人を手伝う世界',
    icon: 'volunteer_activism',
    peek: '困っている人の力になると、自分もあったかくなることがあるよ。手伝いかたはいろいろ。話を聞くだけでも、立派な手伝いなんだ。',
    people: [
      'お年寄りの話し相手になる人',
      '目の見えない人といっしょに歩く人',
      '困っている人のところへ片づけにいく人',
      'だれかのためにごはんをつくる人',
    ],
    tries: [
      '家の中で、小さな手伝いをひとつしてみる',
      '「盲導犬」や「手話」の動画を見てみる',
    ],
  },
  {
    id: 'mori',
    name: '森の世界',
    icon: 'forest',
    peek: '森の中は、木だけじゃないよ。きのこ、こけ、落ち葉、その下の虫たち。みんなつながって、ひとつの大きな暮らしをつくっているんだ。',
    people: [
      'きのこの写真をとりつづける人',
      '木の名前を、葉っぱをさわってあてられる人',
      '森の音をじっと聞いている人',
      'どんぐりから木を育てる人',
    ],
    tries: [
      '森のようすをずっとうつした動画を見てみる',
      '窓から見える木を1本選んで、ようすを見てみる',
    ],
  },
  {
    id: 'sora',
    name: '空と天気の世界',
    icon: 'partly_cloudy_day',
    peek: '空は、毎日ちがう顔をしているよ。くもの形、夕やけの色、雷の音。全部に理由があって、明日の天気のヒントもかくれているんだ。',
    people: [
      'くもの写真を集めている人',
      'にじが出るタイミングを調べる人',
      '台風の動きを予測する人',
      '夕やけの色が変わるしゅんかんを待っている人',
    ],
    tries: [
      '窓から空を見て、くもの形に名前をつけてみる',
      '「くもの種類」を調べてみる',
    ],
  },
  {
    id: 'mushi',
    name: '虫の世界',
    icon: 'bug_report',
    peek: '虫は、地球でいちばん種類が多い生きもの。飛ぶ、光る、変身する、かくれる。小さな体に、すごいわざがつまっているよ。',
    people: [
      'ちょうの羽の模様をくらべる人',
      'ありの行列を1日じゅう見ていられる人',
      '昆虫の写真をとる人',
      'カブトムシを育てるのが得意な人',
    ],
    tries: [
      '虫の動きのスロー再生動画を見てみる',
      'ベランダや窓の近くで、虫を1ぴき探してみる',
    ],
  },
  {
    id: 'machi',
    name: 'まちと建物の世界',
    icon: 'location_city',
    peek: '建物には、つくった人の工夫がつまっているよ。窓の形、かいだんの場所、屋根の色。まちをながめると、「なんでこうなってるんだろう？」がいっぱい見つかるんだ。',
    people: [
      'へんな形の建物を探して歩く人',
      'だんボールでまちの模型をつくる人',
      '古い建物の木の組みかたを調べる人',
      'エレベーターやかいだんのデザインをくらべる人',
    ],
    tries: [
      '窓から見える建物の形をくらべてみる',
      '「世界のかわった建物」を調べてみる',
    ],
  },
  {
    id: 'chizu',
    name: '地図と探検の世界',
    icon: 'explore',
    peek: '地図は、上から見た世界のスケッチ。知らないまちの地図を見るだけで、探検がはじまるよ。地球には、まだ名前のない場所もあるんだって。',
    people: [
      '自分のまちの地図を手がきでつくる人',
      '世界中の国の旗を覚えている人',
      'どうくつのおくを調べる人',
      '地図のまちがいを探す人',
    ],
    tries: [
      '地図アプリで、行ったことのない国をさんぽしてみる',
      '自分の部屋の地図をかいてみる',
    ],
  },
  {
    id: 'shashin',
    name: '写真の世界',
    icon: 'photo_camera',
    peek: '同じものでも、とる角度や光のむきでぜんぜんちがう写真になるよ。「いいな」と思ったしゅんかんを、そのままとっておけるのが写真の力なんだ。',
    people: [
      'ねこの写真だけをとりつづける人',
      '夜の星を何時間もかけてとる人',
      '水のしずくがはねるしゅんかんをねらう人',
      '毎日同じ場所をとってくらべる人',
    ],
    tries: [
      '家の中で「いいな」と思うものを、1枚とってみる',
      '同じものを、上からと下からとりくらべてみる',
    ],
  },
  {
    id: 'game',
    name: 'ゲームの世界',
    icon: 'sports_esports',
    peek: 'ゲームは、遊ぶだけじゃなくて「つくる」世界でもあるよ。ルール、キャラクター、音、ステージ。全部だれかが考えたもの。自分でルールを考えるのもおもしろいんだ。',
    people: [
      '新しい遊びのルールを考える人',
      'ゲームのステージをデザインする人',
      'ふぐあい（バグ）をだれよりも早く見つける人',
      '世界のボードゲームを集める人',
    ],
    tries: [
      'トランプやすごろくのルールを、ひとつ変えて遊んでみる',
      '「ゲームができるまで」の動画を見てみる',
    ],
  },
  {
    id: 'karada',
    name: 'からだを動かす世界',
    icon: 'sprint',
    peek: 'からだの動きには、全部こつがあるよ。速く走る、高くとぶ、しなやかにおどる。自分のからだで試せるのがおもしろいところ。「できた！」の感覚が気持ちいいんだ。',
    people: [
      '新しいダンスの動きを考える人',
      'けんだまのわざを増やしつづける人',
      'ボールをつかった遊びを発明する人',
      'からだの動きをスローで研究する人',
    ],
    tries: [
      'けんだまやダンスの動画を見てみる',
      'その場で、ゆっくりストレッチしてみる',
    ],
  },
  {
    id: 'puzzle',
    name: 'パズルと形の世界',
    icon: 'extension',
    peek: 'そろえたり、ならべたり、ぴったりはめたり。形には、不思議なきまりがかくれているよ。まわしても同じに見える形、すきまなくしきつめられる形。パズルは、そのきまりで遊ぶことなんだ。',
    people: [
      'ルービックキューブを目をつぶってそろえる人',
      'おりがみの新しいおりかたを発明する人',
      'めいろをかくのが得意な人',
      '積み木でありえない形をつくる人',
    ],
    tries: [
      '紙を1枚つかって、何かひとつおってみる',
      'ドミノたおしやピタゴラそうちの動画を見てみる',
    ],
  },
  {
    id: 'nuno',
    name: '布と服の世界',
    icon: 'checkroom',
    peek: '布は、糸があみあわさってできているよ。色、模様、手ざわり。好きな布を選んで形にすると、世界にひとつだけのものができるんだ。',
    people: [
      'ぬいぐるみの服をつくる人',
      '好きな色の糸でミサンガを編む人',
      '古い服を別のものにつくりかえる人',
      '布の模様をデザインする人',
    ],
    tries: [
      '家にある布の模様をくらべてみる',
      '「ミサンガの編みかた」の動画を見てみる',
    ],
  },
  {
    id: 'ishi',
    name: '石と地面の世界',
    icon: 'landscape',
    peek: '足もとの石ころにも、長い長いものがたりがあるよ。まるい石、きらきらの石、化石。地球の中で、何万年もかけてできたものなんだ。',
    people: [
      'きれいな石をみがいて集める人',
      '化石をほり出す人',
      'すなをけんびきょうで見る人',
      '火山のようすを調べる人',
    ],
    tries: [
      'きれいな石や化石の写真をながめてみる',
      'もっている石やすなを、じっくり見てみる',
    ],
  },
];

const state = {
  reactions: {},
  currentScreen: null,
  currentDrawerId: null,
  dirty: false,
};

let toastTimer = null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function randomIndex(max) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}

function nowIso() {
  return new Date().toISOString();
}

function findDrawer(id) {
  return DRAWERS.find(drawer => drawer.id === id) || null;
}

function reactionMeta(id) {
  return REACTIONS.find(item => item.id === id) || null;
}

function markedDrawers() {
  return DRAWERS.filter(drawer => reactionMeta(state.reactions[drawer.id])?.mark);
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('active');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('active'), 2600);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(`screen-${id}`).classList.add('active');
  state.currentScreen = id;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function drawerTileHtml(drawer) {
  const reaction = reactionMeta(state.reactions[drawer.id]);
  const marked = Boolean(reaction?.mark);
  const stateText = reaction ? `（いまは「${reaction.label}」）` : '';
  return `
    <button class="mh-drawer" type="button" data-action="open-drawer" data-value="${esc(drawer.id)}"
      aria-label="「${esc(drawer.name)}」の中を見る${esc(stateText)}">
      ${marked ? `
        <span class="mh-drawer__badge" aria-hidden="true">
          <span class="material-symbols-rounded">${esc(reaction.icon)}</span>
        </span>
      ` : ''}
      <span class="material-symbols-rounded mh-drawer__icon" aria-hidden="true">${esc(drawer.icon)}</span>
      <span class="mh-drawer__name">${esc(drawer.name)}</span>
    </button>
  `;
}

function renderShelf() {
  const hasMarked = markedDrawers().length > 0;
  document.querySelector('#screen-shelf').innerHTML = `
    <div class="mh-panel">
      <h2 class="mh-panel__title" id="shelf-title">気になる入口を、開いてみよう</h2>
      <p class="mh-panel__lead">いろんな「世界の入口」が、引き出しみたいにならんでいるよ。気になるものを押すと、中が見られるよ。全部見なくて大丈夫。</p>
      <div class="mh-actions">
        <button class="btn btn-secondary" type="button" data-action="open-random">
          <span class="material-symbols-rounded" aria-hidden="true">shuffle</span>どれかひとつ開いてみる
        </button>
      </div>
      <div class="mh-grid">
        ${DRAWERS.map(drawerTileHtml).join('')}
      </div>
      ${hasMarked ? `
        <div class="mh-export">
          <p class="mh-muted">「のぞいてみる」「あとで見る」にしたものを、ファイルに残せるよ（残さなくてもOK）</p>
          <button class="btn btn-ghost" type="button" data-action="export-memo">
            <span class="material-symbols-rounded" aria-hidden="true">download</span>ファイルに残す
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderDrawer() {
  const drawer = findDrawer(state.currentDrawerId);
  if (!drawer) return;
  const current = state.reactions[drawer.id] || null;
  document.querySelector('#screen-drawer').innerHTML = `
    <div class="mh-panel mh-panel--open">
      <div class="mh-drawer-head">
        <span class="material-symbols-rounded mh-drawer-head__icon" aria-hidden="true">${esc(drawer.icon)}</span>
        <h2 class="mh-panel__title" id="drawer-title">${esc(drawer.name)}</h2>
      </div>
      <p class="mh-drawer-peek">${esc(drawer.peek)}</p>
      <section class="mh-section" aria-label="こんなことしてる人がいるよ">
        <h3 class="mh-section__title">
          <span class="material-symbols-rounded" aria-hidden="true">groups</span>こんなことしてる人がいるよ
        </h3>
        <ul class="mh-list">
          ${drawer.people.map(item => `<li class="mh-list__item">${esc(item)}</li>`).join('')}
        </ul>
      </section>
      <section class="mh-section" aria-label="ちょっとのぞくなら">
        <h3 class="mh-section__title">
          <span class="material-symbols-rounded" aria-hidden="true">door_open</span>ちょっとのぞくなら
        </h3>
        <ul class="mh-list">
          ${drawer.tries.map(item => `<li class="mh-list__item">${esc(item)}</li>`).join('')}
        </ul>
      </section>
      <div class="mh-react">
        <div class="mh-react__label" id="react-label">この入口、どうしておく？</div>
        <p class="mh-muted">どれを選んでもいいよ。あとからいつでも変えられるよ</p>
        <div class="mh-choice-grid" role="radiogroup" aria-labelledby="react-label">
          ${REACTIONS.map((meta, index) => `
            <button class="mh-choice" type="button" role="radio" aria-checked="${current === meta.id ? 'true' : 'false'}"
              data-action="react" data-value="${esc(meta.id)}"
              aria-label="${index + 1}番: ${esc(meta.label)}。${esc(meta.hint)}">
              <span class="mh-choice__num" aria-hidden="true">${esc(NUMBERS[index])}</span>
              <span class="material-symbols-rounded mh-choice__icon" aria-hidden="true">${esc(meta.icon)}</span>
              <span class="mh-choice__body">
                <span class="mh-choice__text">${esc(meta.label)}</span>
                <span class="mh-choice__hint">${esc(meta.hint)}</span>
              </span>
              <span class="material-symbols-rounded mh-choice__check" aria-hidden="true">check_circle</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="mh-actions">
        <button class="btn btn-ghost" type="button" data-action="back-shelf">← 一覧にもどる（選ばなくてもOK）</button>
      </div>
    </div>
  `;
}

function openDrawer(id) {
  const drawer = findDrawer(id);
  if (!drawer) return;
  state.currentDrawerId = id;
  renderDrawer();
  showScreen('drawer');
}

function openRandomDrawer() {
  const fresh = DRAWERS.filter(drawer => !state.reactions[drawer.id]);
  const pool = fresh.length ? fresh : DRAWERS;
  openDrawer(pool[randomIndex(pool.length)].id);
}

function applyReaction(reactionId) {
  const drawer = findDrawer(state.currentDrawerId);
  const meta = reactionMeta(reactionId);
  if (!drawer || !meta) return;
  state.reactions[drawer.id] = reactionId;
  state.dirty = true;
  renderShelf();
  showScreen('shelf');
  showToast(`「${drawer.name}」は「${meta.label}」にしたよ`);
}

function exportFilename() {
  const date = new Date();
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `hikidashi-memo_${ymd}.json`;
}

function exportMemo() {
  const entries = markedDrawers().map(drawer => ({
    name: drawer.name,
    reaction: reactionMeta(state.reactions[drawer.id]).label,
  }));
  if (!entries.length) return;
  const record = {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    entries,
  };
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  state.dirty = false;
  showToast('ファイルに残したよ');
}

function handleAction(action, button) {
  const value = button.dataset.value || '';
  if (action === 'open-drawer') {
    openDrawer(value);
  } else if (action === 'open-random') {
    openRandomDrawer();
  } else if (action === 'react') {
    applyReaction(value);
  } else if (action === 'back-shelf') {
    renderShelf();
    showScreen('shelf');
  } else if (action === 'export-memo') {
    exportMemo();
  }
}

function wireEvents() {
  document.body.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(target.dataset.action, target);
  });

  window.addEventListener('beforeunload', event => {
    if (!state.dirty || !markedDrawers().length) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

renderShelf();
showScreen('shelf');
wireEvents();
