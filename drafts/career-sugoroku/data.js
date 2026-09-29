/* キャリアすごろく v2（試作）— データ
   盤面・適性・職業・イベントカード・文言をまとめる。数値はすべて試作用の仮の値で、
   試遊とシミュレーション（tests/sim.cjs）の結果で見直す。
   ブラウザでは window.CS_DATA、Node では module.exports で読む。 */
(function (root) {
  'use strict';

  // ── 適性（6種類）────────────────────────────────
  // 色と形（アイコン）の両方で区別する。色だけに頼らない。
  const APTS = [
    { id: 0, name: 'アイデア', desc: '新しいことや、おもしろいことを思いつく', icon: 'lightbulb', color: '#8A5A00', tint: '#FFF1CC' },
    { id: 1, name: '気づく力', desc: 'よく見たり聞いたりして、違いや特徴を見つける', icon: 'visibility', color: '#23609E', tint: '#E1ECF8' },
    { id: 2, name: 'ものづくり', desc: '考えたことを作品や形にする', icon: 'handyman', color: '#A5451C', tint: '#FBE5DA' },
    { id: 3, name: 'コミュニケーション', desc: '自分の考えを伝えたり、相手の話を聞いたりする', icon: 'forum', color: '#A3335F', tint: '#F8E0EA' },
    { id: 4, name: '協力する力', desc: '役割を分けたり、助け合ったりして一緒に進める', icon: 'handshake', color: '#23714A', tint: '#DDF1E5' },
    { id: 5, name: '工夫する力', desc: 'もっとやりやすくなる方法を考えて試す', icon: 'tune', color: '#5E44A6', tint: '#EAE3F7' },
  ];
  const APT_CAP = 5; // 1種類の上限

  // ── 職業（24種類）──────────────────────────────
  // apts: その職業に合う適性3つ。★はこの3つのうち、いちばん低い適性で決まる（STAR_LEVELS）。
  const JOBS = [
    { id: 0, name: 'イラストレーター', desc: '絵でイメージや魅力を届ける', apts: [2, 0, 1], icon: 'brush' },
    { id: 1, name: 'ゲームプランナー', desc: 'ゲームの遊び方や仕組みを考える', apts: [0, 3, 5], icon: 'sports_esports' },
    { id: 2, name: '写真家', desc: '写真で景色やものの魅力を届ける', apts: [1, 2, 5], icon: 'photo_camera' },
    { id: 3, name: 'ツアーガイド', desc: '場所の魅力や楽しみ方を案内する', apts: [3, 1, 4], icon: 'tour' },
    { id: 4, name: 'イベントプランナー', desc: '人が楽しめる催しを企画する', apts: [4, 0, 3], icon: 'celebration' },
    { id: 5, name: 'エンジニア', desc: '仕組みや道具を作り、よりよくする', apts: [5, 2, 4], icon: 'engineering' },
    { id: 6, name: '商品企画スタッフ', desc: '暮らしに役立つ商品を考える', apts: [0, 4, 3], icon: 'shopping_bag' },
    { id: 7, name: '映像ディレクター', desc: '映像で伝えたいことや見せ方を考える', apts: [0, 2, 4], icon: 'movie' },
    { id: 8, name: '作曲家', desc: '音を組み合わせて曲を作る', apts: [0, 2, 1], icon: 'music_note' },
    { id: 9, name: '動物の飼育員', desc: '動物の様子を見ながら暮らしを支える', apts: [1, 4, 3], icon: 'pets' },
    { id: 10, name: '園芸家', desc: '花や植物を育て、育つ環境を整える', apts: [1, 0, 5], icon: 'local_florist' },
    { id: 11, name: '研究者', desc: '気になることを調べ、新しい発見を探す', apts: [1, 0, 3], icon: 'science' },
    { id: 12, name: '料理人', desc: '食材や作り方を考え、料理を作る', apts: [2, 1, 4], icon: 'restaurant' },
    { id: 13, name: '大工', desc: '木などの材料を使い、建物や空間を作る', apts: [2, 4, 5], icon: 'carpenter' },
    { id: 14, name: 'アニメーター', desc: '絵や動きを組み合わせて映像を作る', apts: [2, 0, 5], icon: 'animation' },
    { id: 15, name: 'ラジオパーソナリティ', desc: '声や会話で番組の楽しさを届ける', apts: [3, 0, 1], icon: 'radio' },
    { id: 16, name: '販売スタッフ', desc: '品物の魅力や使い方を案内する', apts: [3, 4, 5], icon: 'storefront' },
    { id: 17, name: '編集者', desc: '情報や作品をまとめ、伝わる形に整える', apts: [3, 0, 2], icon: 'menu_book' },
    { id: 18, name: 'スポーツトレーナー', desc: '運動する人の活動を支える', apts: [4, 1, 3], icon: 'fitness_center' },
    { id: 19, name: '舞台スタッフ', desc: '仲間と役割を分けて舞台を作り上げる', apts: [4, 2, 5], icon: 'theater_comedy' },
    { id: 20, name: 'ホテルスタッフ', desc: '訪れた人が過ごしやすい時間や場所を整える', apts: [4, 1, 5], icon: 'concierge' },
    { id: 21, name: 'プログラマー', desc: 'コンピューターを動かす仕組みを作る', apts: [5, 0, 3], icon: 'code' },
    { id: 22, name: '整備士', desc: '道具や機械の状態を見て使いやすく整える', apts: [5, 2, 1], icon: 'car_repair' },
    { id: 23, name: 'パン職人', desc: '材料や作り方を工夫してパンを作る', apts: [5, 2, 3], icon: 'bakery_dining' },
  ];
  // ★の段階: 合う適性3つが「そろって」この値以上なら ★2・★3・★4（どれにも届かなければ ★1）。
  // ほかの適性がいくら高くても、足りない適性があれば★は上がらない。
  // 2026-09-29 オーナーの試遊「1つの特性が1でも、ほかが5なら★が増えるのに違和感」で、合計（3・6・9）から変えた
  const STAR_LEVELS = [1, 2, 3];
  const STAR_PAY = [1, 2, 3, 4]; // しごとマスで入るポイント（★1〜★4）
  // しごとマスにぴったり止まると、そのマスのポイントをもう1回（2倍）。サイコロ2つから選ぶ遊び方で「ねらう」理由になる
  const EXACT_PAY_BONUS = true;
  const JOB_LIST_FIRST = 6; // しごと選びで最初に見せる数（残りは「ほかの職業も見る」）

  // ── 点数 ───────────────────────────────────────
  // ゴールした順（1番目から）。しごとマスにぴったり止まるボーナスを入れたとき、ねらってゆっくり進むほうが得になり
  // 1番にゴールする意味が薄れた（4人で1位の割合30%）ので、5・3・2・1 から上げた（同45%にもどる）
  const GOAL_BONUS = [8, 5, 3, 2, 1, 1];
  // 学びの道から節目に着いたときのボーナス（picks: 好きな適性を選んで増やせる数 / pts: ポイント）
  const STUDY_BONUS = { stop18: { picks: 1, pts: 1 }, stop22: { picks: 2, pts: 0 } };

  // ── ステージと道の名前 ───────────────────────────
  // labels: 'school'（学校名）/ 'age'（年齢だけ）。待合の設定と、あそんでいる途中のメニューで切り替える。
  const STAGES = {
    child: { school: '小学生（6〜12さい）', age: '6〜12さい', deck: 'kid' },
    teen: { school: '中学生（13〜15さい）', age: '13〜15さい', deck: 'kid' },
    c: { school: '16〜18さい', age: '16〜18さい', deck: 'youth' },
    d: { school: '19〜22さい', age: '19〜22さい', deck: 'youth' },
    adult: { school: 'おとな（23〜35さい）', age: '23〜35さい', deck: 'adult' },
  };
  const LANES = {
    cs: { school: '高校', age: '学びの道', kind: 'study' },
    cw: { school: 'しごと', age: 'しごとの道', kind: 'work' },
    ds: { school: '大学・専門学校', age: '学びの道', kind: 'study' },
    dw: { school: 'しごと', age: 'しごとの道', kind: 'work' },
  };
  // 節目で選ぶ道
  const ROUTES = {
    stop15: [
      { lane: 'cs', next: 'cs1', desc: '体験マスが多い道。18さいの節目で、好きな適性を1つ増やせて、1ポイント' },
      { lane: 'cw', next: 'cw1', desc: 'ここで職業を選ぶ。しごとマスを通るたびにポイント' },
    ],
    stop18: [
      { lane: 'ds', next: 'ds1', desc: '体験マスが多い道。22さいの節目で、好きな適性を2つ増やせる' },
      { lane: 'dw', next: 'dw1', desc: 'ここで職業を選ぶ（今の仕事を続けてもいい）。しごとマスを通るたびにポイント' },
    ],
  };

  // ── 盤面 ───────────────────────────────────────
  // 座標は viewBox 1000×620。next が2つある普通のマスは分かれ道（近道／寄り道）。
  // 節目（stop15・stop18・stop22）は、サイコロの目が残っていても必ず止まる。
  // type: start / exp（体験）/ choose（えらぶ体験。出てきた3つの適性から1つ選ぶ）/ event（イベント）/ friend（なかま）/ pay（しごと）/ grow（成長）/ change（転職チャンス）/ mini（ミニゲーム）/ stop / goal
  const N = [];
  const add = (id, type, x, y, stage, extra) => N.push(Object.assign({ id, type, x, y, stage, next: [] }, extra || {}));

  // 小学生
  add('start', 'start', 58, 84, 'child');
  add('a1', 'exp', 118, 84, 'child', { apt: 0 });
  add('a2', 'event', 174, 84, 'child');
  // a3・b4 は「えらぶ体験マス」（2026-09-29 オーナーの「目標の職業に合う適性を選べるように。運の要素は残して」）。
  // どの道でも通る区間に置く。もとは3つあった「ものづくり」の体験マスを2つ変えて、色の数をそろえた
  add('a3', 'choose', 230, 84, 'child');
  add('a4', 'friend', 286, 84, 'child', { apt: 4 });
  add('a5', 'mini', 342, 84, 'child');
  add('a6', 'exp', 398, 84, 'child', { apt: 1 });
  // 中学生（b2 で近道／寄り道）
  add('b1', 'exp', 480, 84, 'teen', { apt: 3 });
  add('b2', 'mini', 536, 84, 'teen', { fork: ['近道', '寄り道'], forkNote: ['', '体験マスが多い'] });
  add('bs1', 'exp', 600, 84, 'teen', { apt: 5 });
  add('bs2', 'event', 664, 84, 'teen');
  add('bs3', 'exp', 728, 84, 'teen', { apt: 0 });
  add('bl1', 'exp', 574, 150, 'teen', { apt: 1 });
  add('bl2', 'friend', 626, 166, 'teen', { apt: 3 });
  add('bl3', 'exp', 680, 170, 'teen', { apt: 4 });
  add('bl4', 'event', 734, 166, 'teen');
  add('bl5', 'exp', 786, 150, 'teen', { apt: 2 });
  add('b3', 'friend', 794, 84, 'teen', { apt: 5 });
  add('b4', 'choose', 852, 84, 'teen');
  add('stop15', 'stop', 928, 170, 'teen', { age: 15 });
  // 16〜18さい（右から左へ。上が学びの道、下がしごとの道）
  const CX = [860, 800, 740, 680, 620];
  const CS_T = [['exp', 2], ['exp', 0], ['event'], ['exp', 5], ['friend', 3]];
  const CW_T = [['grow'], ['event'], ['pay'], ['friend', 4], ['grow']];
  CX.forEach((x, i) => add('cs' + (i + 1), CS_T[i][0], x, 268, 'c', { lane: 'cs', apt: CS_T[i][1] }));
  CX.forEach((x, i) => add('cw' + (i + 1), CW_T[i][0], x, 338, 'c', { lane: 'cw', apt: CW_T[i][1] }));
  add('stop18', 'stop', 540, 303, 'c', { age: 18 });
  // 19〜22さい
  const DX = [460, 400, 340, 280, 220];
  const DS_T = [['exp', 4], ['exp', 1], ['event'], ['exp', 3], ['friend', 0]];
  const DW_T = [['grow'], ['event'], ['pay'], ['friend', 5], ['exp', 0]];
  DX.forEach((x, i) => add('ds' + (i + 1), DS_T[i][0], x, 268, 'd', { lane: 'ds', apt: DS_T[i][1] }));
  DX.forEach((x, i) => add('dw' + (i + 1), DW_T[i][0], x, 338, 'd', { lane: 'dw', apt: DW_T[i][1] }));
  add('stop22', 'stop', 110, 303, 'd', { age: 22 });
  // おとな（e3 で近道／寄り道）
  add('e1', 'pay', 120, 476, 'adult');
  add('e2', 'event', 180, 476, 'adult');
  add('e3', 'friend', 240, 476, 'adult', { apt: 3, fork: ['近道', '寄り道'], forkNote: ['', '成長マスとなかまマスがある'] });
  add('es1', 'pay', 306, 476, 'adult');
  add('es2', 'event', 372, 476, 'adult');
  add('es3', 'change', 438, 476, 'adult');
  add('el1', 'grow', 282, 542, 'adult');
  add('el2', 'pay', 336, 560, 'adult');
  add('el3', 'change', 392, 566, 'adult');
  add('el4', 'friend', 448, 560, 'adult', { apt: 4 });
  add('el5', 'event', 500, 542, 'adult');
  add('e4', 'pay', 518, 476, 'adult');
  add('e5', 'mini', 584, 476, 'adult');
  add('e6', 'pay', 650, 476, 'adult');
  add('goal', 'goal', 770, 488, 'adult', { age: 35 });

  const link = (a, ...bs) => { const n = N.find((x) => x.id === a); bs.forEach((b) => n.next.push(b)); };
  const chain = (ids) => ids.forEach((id, i) => { if (i < ids.length - 1) link(id, ids[i + 1]); });
  chain(['start', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'b1', 'b2']);
  link('b2', 'bs1', 'bl1');
  chain(['bs1', 'bs2', 'bs3', 'b3']);
  chain(['bl1', 'bl2', 'bl3', 'bl4', 'bl5', 'b3']);
  chain(['b3', 'b4', 'stop15']);
  link('stop15', 'cs1', 'cw1');
  chain(['cs1', 'cs2', 'cs3', 'cs4', 'cs5', 'stop18']);
  chain(['cw1', 'cw2', 'cw3', 'cw4', 'cw5', 'stop18']);
  link('stop18', 'ds1', 'dw1');
  chain(['ds1', 'ds2', 'ds3', 'ds4', 'ds5', 'stop22']);
  chain(['dw1', 'dw2', 'dw3', 'dw4', 'dw5', 'stop22']);
  chain(['stop22', 'e1', 'e2', 'e3']);
  link('e3', 'es1', 'el1');
  chain(['es1', 'es2', 'es3', 'e4']);
  chain(['el1', 'el2', 'el3', 'el4', 'el5', 'e4']);
  chain(['e4', 'e5', 'e6', 'goal']);

  // 盤面の背景の区切り（ステージ）
  // 見出しは道・マス・「近道」の札と重ならない位置に置く（anchor: 'end' は右寄せ）
  const ZONES = [
    { stage: 'child', x: 22, y: 22, w: 412, h: 180, lx: 40, ly: 48 },
    { stage: 'teen', x: 442, y: 22, w: 536, h: 180, lx: 962, ly: 48, anchor: 'end' },
    { stage: 'c', x: 588, y: 212, w: 304, h: 180, lx: 604, ly: 236 },
    { stage: 'd', x: 188, y: 212, w: 304, h: 180, lx: 204, ly: 236 },
    { stage: 'adult', x: 22, y: 400, w: 956, h: 198, lx: 140, ly: 422 },
  ];
  // 道の名前札の位置（レーンの左右の端）
  const LANE_TAGS = [
    { lane: 'cs', x: 800, y: 236 }, { lane: 'cw', x: 800, y: 370 },
    { lane: 'ds', x: 400, y: 236 }, { lane: 'dw', x: 400, y: 370 },
  ];

  // ── 体験マスの文（ステージの区分×適性）─────────────
  // 学校に通っていることを前提にしない出来事にする（運動会・修学旅行・部活・テストなどは入れない）。
  const EXP_TEXT = {
    kid: [
      ['新しい遊びのルールを考えた', 'オリジナルの地図をかいた'],
      ['公園で虫のすみかを見つけた', '雲の形が変わるのをじっと見た'],
      ['段ボールで秘密基地をつくった', '粘土で動物をつくった'],
      ['近所のお店の人と仲よくなった', '道をたずねてきた人に教えてあげた'],
      ['みんなで大なわとびを続けた', '友だちと力を合わせて大きな砂山をつくった'],
      ['こわれたおもちゃを直した', 'ブロックの塔がくずれないように組んだ'],
    ],
    youth: [
      ['動画の企画を考えた', '新しいお菓子の組み合わせを思いついた'],
      ['町の小さな変化を写真に残した', '植物の育ち方を記録した'],
      ['古着をリメイクした', '木で小さな棚をつくった'],
      ['イベントで初めての人と話した', '好きなことを人に紹介した'],
      ['仲間とイベントの準備をした', '仲間と一曲を仕上げた'],
      ['自転車を自分で整備した', '部屋を使いやすく模様替えした'],
    ],
  };
  const FRIEND_TEXT = {
    kid: 'をさそって、一緒に遊んだ',
    youth: 'をさそって、一緒に挑戦した',
    adult: 'と一緒に仕事をした',
  };
  const GROW_TEXT = ['仕事のコツをつかんだ', '先輩に教わったことを試した', '新しい道具を使いこなした'];

  // ── イベントカード ──────────────────────────────
  // e（効果）: apt（その適性+1）/ pick（3つから選んで+1）/ move（n マス進む・もどる）/ skip（1回休み）/
  //            again（もう1回）/ pts（ポイント）/ grow（仕事の適性+1。職業がなければ pick）/
  //            coop（みんなでサイコロ。合計が目標以上なら全員にごほうび）/ vote（みんなで決める。全員その適性+1）
  const DECKS = {
    kid: [
      { text: '雨が続いて、外で遊べなかった', e: { t: 'skip' } },
      { text: '近道のつもりが、遠回りになった', e: { t: 'move', n: -2 } },
      { text: '追い風にのって、どんどん走れた', e: { t: 'move', n: 2 } },
      { text: 'いいことがあって、元気いっぱい', e: { t: 'again' } },
      { text: '図鑑を読みこんで、生きものにくわしくなった', e: { t: 'apt', a: 1 } },
      { text: 'ごはんづくりを手伝って、手順を工夫した', e: { t: 'apt', a: 5 } },
      { text: '新しい習いごとを体験してみた', e: { t: 'pick' } },
      { text: '公園の大そうじ大作戦', e: { t: 'coop', reward: { t: 'apt', a: 4 } } },
      { text: '町のお祭りで出すお店を、みんなで決めよう', e: { t: 'vote', opts: [{ label: '手作りアクセサリー屋', a: 2 }, { label: 'スーパーボールすくい', a: 5 }, { label: '呼びこみ係', a: 3 }] } },
      { text: 'お気に入りのお話の続きを、自分で考えた', e: { t: 'apt', a: 0 } },
      { text: '困っている人に声をかけて、手伝った', e: { t: 'apt', a: 3 } },
      { text: '忘れものに気づいて、取りにもどった', e: { t: 'move', n: -1 } },
    ],
    youth: [
      { text: '電車に乗りまちがえた', e: { t: 'move', n: -2 } },
      { text: 'スマホの充電が切れて、待ち合わせに間に合わなかった', e: { t: 'skip' } },
      { text: '応援されて、やる気がわいてきた', e: { t: 'move', n: 3 } },
      { text: 'チャンスが来た', e: { t: 'again' } },
      { text: '好きなことを動画で発信してみた', e: { t: 'apt', a: 0 } },
      { text: 'ボランティアで、町のイベントを手伝った', e: { t: 'apt', a: 3 } },
      { text: 'コツをつかんだ', e: { t: 'grow' } },
      { text: 'フリーマーケットにみんなで出店', e: { t: 'coop', reward: { t: 'pts', n: 1 } } },
      { text: '旅行の行き先を、みんなで決めよう', e: { t: 'vote', opts: [{ label: '海', a: 1 }, { label: '山', a: 4 }, { label: '大きな町', a: 3 }] } },
      { text: '初めての町を、ひとりで歩いてみた', e: { t: 'pick' } },
      { text: '古い自転車を自分で直した', e: { t: 'apt', a: 5 } },
      { text: '雨で予定が中止になった', e: { t: 'skip' } },
    ],
    adult: [
      { text: 'チームのプロジェクトが大成功', e: { t: 'pts', n: 2 } },
      { text: '引っ越して、新しい町の暮らしが始まった', e: { t: 'pick' } },
      { text: '渋滞に巻きこまれた', e: { t: 'skip' } },
      { text: '休みの日に、新しい趣味を始めた', e: { t: 'apt', a: 0 } },
      { text: '後輩に仕事を教えた', e: { t: 'apt', a: 3 } },
      { text: '忘れものを取りにもどった', e: { t: 'move', n: -2 } },
      { text: 'いい流れが来た', e: { t: 'move', n: 3 } },
      { text: '地域のお祭りの準備を、みんなで', e: { t: 'coop', reward: { t: 'pts', n: 2 } } },
      { text: '町の新しいイベントを、みんなで決めよう', e: { t: 'vote', opts: [{ label: '音楽フェス', a: 0 }, { label: '手づくり市', a: 2 }, { label: '星を見る会', a: 1 }] } },
      { text: '新しい道具の使い方をマスターした', e: { t: 'grow' } },
      { text: 'チャンスが来た', e: { t: 'again' } },
      { text: 'ゆっくり休んで、元気を取りもどした', e: { t: 'skip' } },
    ],
  };

  // ── ミニゲーム ──────────────────────────────────
  // ミニゲームマスに止まると、全員で遊ぶ（2026-09-29 オーナー決定: この3つ・マスに止まったとき）。
  // 1台の画面なので、みんなが口・チャット・手で出したものをメンターが1人ずつ押して入れ、結果はアプリが決める。
  // 勝ち負けは運か協力で決まるものだけ（うまい子がいつも勝つ形にしない）。
  const MINI_GAMES = {
    hilo: { name: '大きい？小さい？', rule: 'つぎのサイコロが、この数より大きいか小さいか、全員で予想しよう', note: '当たった人 +1ポイント。同じ数が出たら全員 +1ポイント' },
    janken: { name: 'じゃんけん', rule: 'みんなでコンピューターとじゃんけん。チャットに書くか、手で出してね', note: '勝った人 +1ポイント' },
    sum: { name: '合計ピッタリ', rule: '相談しないで、せーので1〜3を出そう（チャットか指で）。合計が目標と同じならピッタリ', note: 'ピッタリなら全員 +1ポイント' },
  };
  const MINI_REWARD = 1;

  // ── プレイヤーの駒 ───────────────────────────────
  // ink は駒と丸の番号の色。どの色も番号とのコントラストが 4.5 以上になるようにした（きいろは濃い字）
  const PLAYER_COLORS = [
    { name: 'あか', color: '#C73A4E', ink: '#FFFFFF' },
    { name: 'あお', color: '#2E6FD8', ink: '#FFFFFF' },
    { name: 'みどり', color: '#1F7F48', ink: '#FFFFFF' },
    { name: 'きいろ', color: '#F2B632', ink: '#1A1A1A' },
    { name: 'むらさき', color: '#8E5BD1', ink: '#FFFFFF' },
    { name: 'ピンク', color: '#BF3F84', ink: '#FFFFFF' },
  ];
  const MAX_PLAYERS = 6;

  const api = {
    APTS, APT_CAP, JOBS, STAR_LEVELS, STAR_PAY, EXACT_PAY_BONUS, JOB_LIST_FIRST, GOAL_BONUS, STUDY_BONUS,
    STAGES, LANES, ROUTES, NODES: N, ZONES, LANE_TAGS,
    EXP_TEXT, FRIEND_TEXT, GROW_TEXT, DECKS, MINI_GAMES, MINI_REWARD, PLAYER_COLORS, MAX_PLAYERS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CS_DATA = api;
})(typeof window !== 'undefined' ? window : globalThis);
