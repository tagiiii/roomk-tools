const APP_ID = 'mirai-hikidashi';
const SCHEMA_VERSION = 1;
const NUMBERS = ['①', '②', '③'];

// 3つの反応は全部同格。「今はいい」に否定的な意味・演出を持たせない
const REACTIONS = [
  { id: 'peek', label: 'のぞいてみる', icon: 'visibility', hint: 'ちょっと気になる入口', mark: true },
  { id: 'later', label: 'あとで見る', icon: 'bookmark', hint: '気になるかも。またこんど見たい', mark: true },
  { id: 'pass', label: '今はいい', icon: 'waving_hand', hint: '今はとじておく。それも ぜんぜんあり', mark: false },
];

// 世界の入口。職業名は使わず「こんなことしてる人」の活動で書く
const DRAWERS = [
  {
    id: 'umi',
    name: 'うみの世界',
    icon: 'waves',
    peek: '海の中は、まだぜんぶは わかっていない場所。深い海には、光る生きものや、へんてこな形の魚がいるよ。波やしおの流れにも、ちゃんと理由があるんだって。',
    people: [
      '魚の名前を ずかんみたいに おぼえてる人',
      '海の音だけを 録音してあつめてる人',
      '深い海の生きものを さがしにいく人',
      'ひろった貝がらで もようをつくる人',
    ],
    tries: [
      '「深海生物」の動画をみてみる',
      'ずかんやネットで、いちばんへんな顔の魚をさがしてみる',
    ],
  },
  {
    id: 'oto',
    name: '音の世界',
    icon: 'music_note',
    peek: 'せかいは音でいっぱい。雨の音、電車の音、こえ、がっき。音をまぜたり かさねたりすると、あたらしい音がうまれるんだ。おなじ音でも、人によって きこえかたが ちがったりするよ。',
    people: [
      'まちの音を あつめて まぜている人',
      'じぶんで がっきを手づくりする人',
      'ゲームの中の音を ぜんぶつくっている人',
      '目をつぶって、音だけで場所をあてられる人',
    ],
    tries: [
      '目をつぶって、いま きこえる音をかぞえてみる',
      '「環境音」で気になる音をさがしてみる',
    ],
  },
  {
    id: 'tsukuru',
    name: 'つくる世界',
    icon: 'handyman',
    peek: '木・かみ・ねんど・だんボール。手をうごかすと、あたまの中のものが目の前にあらわれるよ。しっぱいした形が、かえって おもしろくなることもあるんだ。',
    people: [
      'だんボールで うごくしかけを つくる人',
      'ちいさい家（ミニチュア）を本ものそっくりにつくる人',
      'こわれたものを なおすのがとくいな人',
      'せかいに1つだけのボードゲームをつくる人',
    ],
    tries: [
      '「ダンボール工作」の動画をみてみる',
      'いえにあるもので、なにかひとつ こうさくしてみる',
    ],
  },
  {
    id: 'ikimono',
    name: '生きものの世界',
    icon: 'pets',
    peek: '生きものは、それぞれ ぜんぜんちがう くらしかたをしているよ。ねこの1日、ありの行列、鳥のわたり。じっと見ていると、ふしぎなことが つぎつぎ見つかるんだ。',
    people: [
      '動物の赤ちゃんの せわをする人',
      '鳥の鳴きごえで しゅるいをあてられる人',
      'いぬや ねこの気もちを しらべている人',
      'すくなくなった生きものを まもる人',
    ],
    tries: [
      '動物園や水族館のライブカメラをみてみる',
      'まどの外の鳥を、1しゅるい見つけてみる',
    ],
  },
  {
    id: 'uchu',
    name: '宇宙の世界',
    icon: 'rocket_launch',
    peek: '空のむこうは、どこまでも つづいているよ。月のもよう、星のならび、ブラックホール。まだ だれも行ったことのない場所が ほとんどなんだ。',
    people: [
      'あたらしい星を さがしている人',
      'ロケットのぶひんを つくる人',
      '宇宙の写真を まいにち ながめている人',
      '星から とどく電波を きいている人',
    ],
    tries: [
      'JAXAやNASAの宇宙の写真をみてみる',
      'はれた日の夜に、月をじっくり見てみる',
    ],
  },
  {
    id: 'tabemono',
    name: '食べものの世界',
    icon: 'restaurant',
    peek: '食べることは、まいにちのたのしみ。あじ・におい・いろ・おと、ぜんぶがかかわっているよ。まぜたり やいたり ひやしたりすると、あじや形が へんしんするんだ。',
    people: [
      'あたらしい おかしを かんがえる人',
      'せかいじゅうの めずらしいくだものを 食べくらべる人',
      'パンの ふくらみかたを 毎日ためしている人',
      'もりつけの きれいさを ついきゅうする人',
    ],
    tries: [
      'おかしづくりの動画を ながめてみる',
      'いえの人といっしょに、なにかひとつ まぜてつくってみる',
    ],
  },
  {
    id: 'norimono',
    name: 'のりものの世界',
    icon: 'train',
    peek: '電車、バス、ひこうき、ふね。のりものは 人やものを はこぶだけじゃなくて、形も音もうごきも ぜんぶちがうよ。すきな人には たまらない ちがいなんだって。',
    people: [
      '電車の音だけで しゃりょうのしゅるいをあてる人',
      'せかいじゅうの ちかてつの ちずをあつめる人',
      'はたらくくるまを 写真にとりつづける人',
      'もけいのまちに のりものをはしらせる人',
    ],
    tries: [
      '「運転席からのながめ」の動画をみてみる',
      'ちかくを通るのりものの音を、ききくらべてみる',
    ],
  },
  {
    id: 'egaku',
    name: 'えがく世界',
    icon: 'palette',
    peek: 'せんを1本ひくだけでも、絵は はじまるよ。うまい・へたじゃなくて、「どんなふうに見えているか」をうつすのが絵なんだ。色のくみあわせだけでも あそべるよ。',
    people: [
      'まいにち らくがきを1まいかく人',
      'デジタルで 光る絵をかく人',
      'かべいっぱいに 大きな絵をかく人',
      'すきな色だけで 絵をかく人',
    ],
    tries: [
      'かみのすみに、ちいさく らくがきしてみる',
      '「スピードペイント」の動画をみてみる',
    ],
  },
  {
    id: 'kotoba',
    name: 'ことばの世界',
    icon: 'menu_book',
    peek: 'ことばは、ならべかたをかえるだけで ひびきがかわるよ。だじゃれ、なぞなぞ、ものがたり、名まえ。せかいには、まだ日本語にないことばも たくさんあるんだ。',
    people: [
      'ものがたりを すこしずつ かきつづけている人',
      'せかいのあいさつを あつめている人',
      'だじゃれを 1000こ しっている人',
      'ものの名まえの ゆらいをしらべる人',
    ],
    tries: [
      'すきなものの名まえの ゆらいをしらべてみる',
      'みじかい ものがたりを、1ぎょうだけ かいてみる',
    ],
  },
  {
    id: 'kikai',
    name: 'きかいの世界',
    icon: 'smart_toy',
    peek: 'ボタンをおすと うごく。その「なかみ」では、ちいさなぶひんが それぞれ やくわりをもっているよ。ばらばらのぶひんが くみあわさって うごきだすのは、まほうみたいだけど ちゃんとしくみがあるんだ。',
    people: [
      'ロボットを うごかす人',
      'とけいを ぶんかいして なかを見るのがすきな人',
      'ゲームきの しくみをしらべる人',
      'うごくおもちゃを はつめいする人',
    ],
    tries: [
      'ロボットが うごいている動画をみてみる',
      'いえの中の「ボタンでうごくもの」をかぞえてみる',
    ],
  },
  {
    id: 'tetsudau',
    name: 'ひとを手伝う世界',
    icon: 'volunteer_activism',
    peek: 'こまっている人のちからになると、じぶんも あったかくなることがあるよ。手伝いかたは いろいろ。はなしをきくだけでも、りっぱな手伝いなんだ。',
    people: [
      'おとしよりの はなしあいてになる人',
      '目の見えない人と いっしょに歩く人',
      'こまっている人のところへ かたづけにいく人',
      'だれかのために ごはんをつくる人',
    ],
    tries: [
      'いえの中で、ちいさな手伝いをひとつしてみる',
      '「盲導犬」や「手話」の動画をみてみる',
    ],
  },
  {
    id: 'mori',
    name: '森の世界',
    icon: 'forest',
    peek: '森の中は、木だけじゃないよ。きのこ、こけ、おちば、その下の虫たち。みんなつながって、ひとつの大きなくらしを つくっているんだ。',
    people: [
      'きのこの写真を とりつづける人',
      '木の名まえを、はっぱをさわって あてられる人',
      '森の音を じっと きいている人',
      'どんぐりから 木をそだてる人',
    ],
    tries: [
      '森のようすを ずっとうつした動画をみてみる',
      'まどから見える木を1本えらんで、ようすをみてみる',
    ],
  },
  {
    id: 'sora',
    name: '空と天気の世界',
    icon: 'partly_cloudy_day',
    peek: '空は、まいにち ちがう顔をしているよ。くもの形、夕やけの色、かみなりの音。ぜんぶに理由があって、あしたの天気のヒントも かくれているんだ。',
    people: [
      'くもの写真を あつめている人',
      'にじが出る タイミングをしらべる人',
      'たいふうの うごきをよそくする人',
      '夕やけの色が かわるしゅんかんを まっている人',
    ],
    tries: [
      'まどから空を見て、くもの形に名まえをつけてみる',
      '「くもの しゅるい」をしらべてみる',
    ],
  },
  {
    id: 'mushi',
    name: '虫の世界',
    icon: 'bug_report',
    peek: '虫は、ちきゅうで いちばん しゅるいがおおい生きもの。とぶ、ひかる、へんしんする、かくれる。ちいさいからだに、すごいわざが つまっているよ。',
    people: [
      'ちょうの はねのもようを くらべる人',
      'ありの ぎょうれつを 1日じゅう 見ていられる人',
      'こんちゅうの 写真をとる人',
      'カブトムシを そだてるのが とくいな人',
    ],
    tries: [
      '虫のうごきの スローさいせい動画をみてみる',
      'ベランダや まどのちかくで、虫を1ぴき さがしてみる',
    ],
  },
  {
    id: 'machi',
    name: 'まちとたてものの世界',
    icon: 'location_city',
    peek: 'たてものには、つくった人のくふうが つまっているよ。まどの形、かいだんの場所、やねの色。まちをながめると、「なんでこうなってるんだろう？」が いっぱい見つかるんだ。',
    people: [
      'へんな形のたてものを さがしてあるく人',
      'だんボールで まちのもけいをつくる人',
      '古いたてものの 木のくみかたをしらべる人',
      'エレベーターや かいだんのデザインをくらべる人',
    ],
    tries: [
      'まどから見えるたてものの形を くらべてみる',
      '「世界のかわった建物」をしらべてみる',
    ],
  },
  {
    id: 'chizu',
    name: 'ちずとたんけんの世界',
    icon: 'explore',
    peek: 'ちずは、上から見た せかいのスケッチ。しらないまちのちずを見るだけで、たんけんが はじまるよ。ちきゅうには、まだ名まえのない場所も あるんだって。',
    people: [
      'じぶんのまちのちずを 手がきでつくる人',
      'せかいじゅうの 国のはたを おぼえている人',
      'どうくつの おくをしらべる人',
      'ちずの まちがいをさがす人',
    ],
    tries: [
      'ちずアプリで、行ったことのない国を さんぽしてみる',
      'じぶんのへやの ちずをかいてみる',
    ],
  },
  {
    id: 'shashin',
    name: '写真の世界',
    icon: 'photo_camera',
    peek: 'おなじものでも、とる角度や光のむきで ぜんぜんちがう写真になるよ。「いいな」とおもった しゅんかんを、そのまま とっておけるのが 写真のちからなんだ。',
    people: [
      'ねこの写真だけを とりつづける人',
      'よるの星を なんじかんもかけて とる人',
      '水のしずくが はねるしゅんかんを ねらう人',
      'まいにち おなじ場所をとって くらべる人',
    ],
    tries: [
      'いえの中で「いいな」とおもうものを、1まいとってみる',
      'おなじものを、上からと下から とりくらべてみる',
    ],
  },
  {
    id: 'game',
    name: 'ゲームの世界',
    icon: 'sports_esports',
    peek: 'ゲームは、あそぶだけじゃなくて「つくる」せかいでもあるよ。ルール、キャラクター、音、ステージ。ぜんぶ だれかが かんがえたもの。じぶんでルールをかんがえるのも おもしろいんだ。',
    people: [
      'あたらしいあそびの ルールをかんがえる人',
      'ゲームのステージを デザインする人',
      'ふぐあい（バグ）を だれよりもはやく見つける人',
      'せかいのボードゲームを あつめる人',
    ],
    tries: [
      'トランプやすごろくのルールを、ひとつかえてあそんでみる',
      '「ゲームができるまで」の動画をみてみる',
    ],
  },
  {
    id: 'karada',
    name: 'からだを動かす世界',
    icon: 'sprint',
    peek: 'からだのうごきには、ぜんぶ こつがあるよ。はやく走る、たかくとぶ、しなやかにおどる。じぶんのからだで ためせるのが おもしろいところ。「できた！」のかんかくが きもちいいんだ。',
    people: [
      'あたらしいダンスのうごきを かんがえる人',
      'けんだまのわざを ふやしつづける人',
      'ボールをつかった あそびをはつめいする人',
      'からだのうごきを スローでけんきゅうする人',
    ],
    tries: [
      'けんだまやダンスの動画をみてみる',
      'その場で、ゆっくりストレッチしてみる',
    ],
  },
  {
    id: 'puzzle',
    name: 'パズルとかたちの世界',
    icon: 'extension',
    peek: 'そろえたり、ならべたり、ぴったりはめたり。かたちには、ふしぎなきまりが かくれているよ。まわしても おなじに見える形、すきまなく しきつめられる形。パズルは、そのきまりであそぶことなんだ。',
    people: [
      'ルービックキューブを 目をつぶってそろえる人',
      'おりがみの あたらしいおりかたを はつめいする人',
      'めいろを かくのがとくいな人',
      'つみきで ありえない形をつくる人',
    ],
    tries: [
      'かみを1まいつかって、なにかひとつ おってみる',
      'ドミノたおしや ピタゴラそうちの動画をみてみる',
    ],
  },
  {
    id: 'nuno',
    name: 'ぬのと服の世界',
    icon: 'checkroom',
    peek: 'ぬのは、いとが あみあわさって できているよ。色、もよう、手ざわり。すきなぬのをえらんで形にすると、せかいにひとつだけのものが できるんだ。',
    people: [
      'ぬいぐるみの服を つくる人',
      'すきな色のいとで ミサンガをあむ人',
      '古い服を べつのものに つくりかえる人',
      'ぬののもようを デザインする人',
    ],
    tries: [
      'いえにあるぬのの もようを くらべてみる',
      '「ミサンガのあみかた」の動画をみてみる',
    ],
  },
  {
    id: 'ishi',
    name: '石と地面の世界',
    icon: 'landscape',
    peek: '足もとの石ころにも、ながいながい ものがたりがあるよ。まるい石、きらきらの石、かせき。ちきゅうの中で、なんまん年もかけて できたものなんだ。',
    people: [
      'きれいな石を みがいてあつめる人',
      'かせきを ほりだす人',
      'すなを けんびきょうで見る人',
      '火山のようすを しらべる人',
    ],
    tries: [
      'きれいな石や かせきの写真を ながめてみる',
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
      <h2 class="mh-panel__title" id="shelf-title">気になる入口を、ひらいてみよう</h2>
      <p class="mh-panel__lead">いろんな「せかいの入口」が、引き出しみたいに ならんでいるよ。気になるものを おすと、中が見られるよ。ぜんぶ 見なくて だいじょうぶ。</p>
      <div class="mh-actions">
        <button class="btn btn-secondary" type="button" data-action="open-random">
          <span class="material-symbols-rounded" aria-hidden="true">shuffle</span>どれか ひとつ ひらいてみる
        </button>
      </div>
      <div class="mh-grid">
        ${DRAWERS.map(drawerTileHtml).join('')}
      </div>
      ${hasMarked ? `
        <div class="mh-export">
          <p class="mh-muted">「のぞいてみる」「あとで見る」にしたものを、ファイルにのこせるよ（のこさなくてもOK）</p>
          <button class="btn btn-ghost" type="button" data-action="export-memo">
            <span class="material-symbols-rounded" aria-hidden="true">download</span>ファイルにのこす
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
        <p class="mh-muted">どれをえらんでも いいよ。あとから いつでも かえられるよ</p>
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
        <button class="btn btn-ghost" type="button" data-action="back-shelf">← いちらんにもどる（えらばなくてもOK）</button>
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
  showToast('ファイルにのこしたよ');
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
