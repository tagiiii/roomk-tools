/* ============================================================
 * キャリアすごろく — ゲームデータ
 *
 * 職業・イベント・進路・暮らしの文章と数値。設計の出典は企画時の設計メモ（職業24枚・配点・判定表）。
 * 仕様と、オーナーが決めた値・意図的な例外は AGENTS.md。
 *
 * ブラウザでは window.CS_DATA、Node（テスト）では module.exports で読む。
 * ============================================================ */
(function (root) {
  'use strict';

  // 表示名は1か所だけで管理する（2026-09-28 オーナーが「キャリアすごろく」に決定）
  const GAME_TITLE = 'キャリアすごろく';

  // ── 適性（6種類・各4枚まで。2026-09-28 オーナー決定で3枚→4枚。職業の点は最大19点）──
  // color は白地の文字色として WCAG AA（4.5:1）を満たす濃さ。tint は面の塗り。
  const APTS = [
    { id: 0, name: 'アイデア', desc: '新しいことや、おもしろいことを思いつく', try: '新しい遊びを考えてみる', icon: 'lightbulb', color: '#8A5A00', tint: '#FFF1CC' },
    { id: 1, name: '気づく力', desc: 'よく見たり聞いたりして、違いや特徴を見つける', try: 'まちの小さな変化を探してみる', icon: 'visibility', color: '#23609E', tint: '#E1ECF8' },
    { id: 2, name: 'ものづくり', desc: '考えたことを作品や形にする', try: '小さな作品を作ってみる', icon: 'handyman', color: '#A5451C', tint: '#FBE5DA' },
    { id: 3, name: 'コミュニケーション', desc: '自分の考えを伝えたり、相手の話を聞いたりする', try: 'まちの人に話を聞いてみる', icon: 'forum', color: '#A3335F', tint: '#F8E0EA' },
    { id: 4, name: '協力する力', desc: '役割を分けたり、助け合ったりして一緒に進める', try: '仲間と作業を分担してみる', icon: 'handshake', color: '#23714A', tint: '#DDF1E5' },
    { id: 5, name: '工夫する力', desc: 'もっとやりやすくなる方法を考えて試す', try: 'いつもの手順を工夫してみる', icon: 'tune', color: '#5E44A6', tint: '#EAE3F7' },
  ];
  const APT_CAP = 4;

  // ── 職業24枚（core=1枚2点、rel=1枚1点×2種）──────────────
  // 設計メモ「職業カード24枚の仮案」の表と同じ組み合わせ。
  const JOBS = [
    { id: 0, name: 'イラストレーター', desc: '絵でイメージや魅力を届ける', core: 2, rel: [0, 1], icon: 'brush' },
    { id: 1, name: 'ゲームプランナー', desc: 'ゲームの遊び方や仕組みを考える', core: 0, rel: [3, 5], icon: 'sports_esports' },
    { id: 2, name: '写真家', desc: '写真で景色やものの魅力を届ける', core: 1, rel: [2, 5], icon: 'photo_camera' },
    { id: 3, name: 'ツアーガイド', desc: '場所の魅力や楽しみ方を案内する', core: 3, rel: [1, 4], icon: 'tour' },
    { id: 4, name: 'イベントプランナー', desc: '人が楽しめる催しを企画する', core: 4, rel: [0, 3], icon: 'celebration' },
    { id: 5, name: 'エンジニア', desc: '仕組みや道具を作り、よりよくする', core: 5, rel: [2, 4], icon: 'engineering' },
    { id: 6, name: '商品企画スタッフ', desc: '暮らしに役立つ商品を考える', core: 0, rel: [4, 3], icon: 'shopping_bag' },
    { id: 7, name: '映像ディレクター', desc: '映像で伝えたいことや見せ方を考える', core: 0, rel: [2, 4], icon: 'movie' },
    { id: 8, name: '作曲家', desc: '音を組み合わせて曲を作る', core: 0, rel: [2, 1], icon: 'music_note' },
    { id: 9, name: '動物の飼育員', desc: '動物の様子を見ながら暮らしを支える', core: 1, rel: [4, 3], icon: 'pets' },
    { id: 10, name: '園芸家', desc: '花や植物を育て、育つ環境を整える', core: 1, rel: [0, 5], icon: 'local_florist' },
    { id: 11, name: '研究者', desc: '気になることを調べ、新しい発見を探す', core: 1, rel: [0, 3], icon: 'science' },
    { id: 12, name: '料理人', desc: '食材や作り方を考え、料理を作る', core: 2, rel: [1, 4], icon: 'restaurant' },
    { id: 13, name: '大工', desc: '木などの材料を使い、建物や空間を作る', core: 2, rel: [4, 5], icon: 'carpenter' },
    { id: 14, name: 'アニメーター', desc: '絵や動きを組み合わせて映像を作る', core: 2, rel: [0, 5], icon: 'animation' },
    { id: 15, name: 'ラジオパーソナリティ', desc: '声や会話で番組の楽しさを届ける', core: 3, rel: [0, 1], icon: 'radio' },
    { id: 16, name: '販売スタッフ', desc: '品物の魅力や使い方を案内する', core: 3, rel: [4, 5], icon: 'storefront' },
    { id: 17, name: '編集者', desc: '情報や作品をまとめ、伝わる形に整える', core: 3, rel: [0, 2], icon: 'menu_book' },
    { id: 18, name: 'スポーツトレーナー', desc: '運動する人の活動を支える', core: 4, rel: [1, 3], icon: 'fitness_center' },
    { id: 19, name: '舞台スタッフ', desc: '仲間と役割を分けて舞台を作り上げる', core: 4, rel: [2, 5], icon: 'theater_comedy' },
    { id: 20, name: 'ホテルスタッフ', desc: '訪れた人が過ごしやすい時間や場所を整える', core: 4, rel: [1, 5], icon: 'concierge' },
    { id: 21, name: 'プログラマー', desc: 'コンピューターを動かす仕組みを作る', core: 5, rel: [0, 3], icon: 'code' },
    { id: 22, name: '整備士', desc: '道具や機械の状態を見て使いやすく整える', core: 5, rel: [2, 1], icon: 'car_repair' },
    { id: 23, name: 'パン職人', desc: '材料や作り方を工夫してパンを作る', core: 5, rel: [2, 3], icon: 'bakery_dining' },
  ];

  // ── マスの種類 ───────────────────────────────────────
  const SQUARES = {
    start: { name: '駅', long: '駅（新しい体験）', icon: 'train', color: '#1C3F5E', tint: '#E7EEF4' },
    grow: { name: '伸ばす', long: '適性を伸ばす', icon: 'trending_up', color: '#1F6E72', tint: '#DCEFF0' },
    new: { name: '体験', long: '新しい体験', icon: 'explore', color: '#8A5A00', tint: '#FFF1CC' },
    job: { name: '職業', long: '職業との出会い', icon: 'work', color: '#1C3F5E', tint: '#E1E8F0' },
    event: { name: 'イベント', long: 'イベント', icon: 'flag', color: '#A5451C', tint: '#FBE5DA' },
    collab: { name: 'コラボ', long: 'コラボ', icon: 'diversity_3', color: '#23714A', tint: '#DDF1E5' },
    life: { name: '暮らし', long: '暮らしのイベント', icon: 'cottage', color: '#A3335F', tint: '#F8E0EA' },
  };

  // ── 盤面（まちを1周する道＋中央公園を通る2つの分かれ道）──────
  // 盤面の長さ・分岐・マスの比率は 2026-09-28 のオーナーの委任による判断で、この形のまま（AGENTS.md）。
  // viewBox 0 0 1000 600。時計回り。r5・r15 が分かれ道、r9・r19 で合流。
  const DISTRICTS = [
    { id: 'atelier', name: 'アトリエ通り', apts: [2, 0], tint: '#FCEEE3', label: { x: 190, y: 300 } },
    { id: 'plaza', name: '駅前ひろば', apts: [3, 4], tint: '#FBE9EF', label: { x: 790, y: 185 } },
    { id: 'forest', name: '森の公園', apts: [1, 5], tint: '#E5F2E8', label: { x: 790, y: 415 } },
    { id: 'center', name: '中央公園', apts: [], tint: '#EEF2F4', label: { x: 500, y: 300 } },
  ];
  const NODES = [
    { id: 0, key: 'r0', x: 160, y: 520, type: 'start', d: 'atelier', next: [1] },
    { id: 1, key: 'r1', x: 70, y: 410, type: 'grow', d: 'atelier', next: [2] },
    { id: 2, key: 'r2', x: 70, y: 300, type: 'event', d: 'atelier', next: [3] },
    { id: 3, key: 'r3', x: 70, y: 190, type: 'job', d: 'atelier', next: [4] },
    { id: 4, key: 'r4', x: 160, y: 80, type: 'new', d: 'atelier', next: [5] },
    { id: 5, key: 'r5', x: 273, y: 80, type: 'event', d: 'plaza', next: [6, 20] },
    { id: 6, key: 'r6', x: 387, y: 80, type: 'grow', d: 'plaza', next: [7] },
    { id: 7, key: 'r7', x: 500, y: 80, type: 'collab', d: 'plaza', next: [8] },
    { id: 8, key: 'r8', x: 613, y: 80, type: 'life', d: 'plaza', next: [9] },
    { id: 9, key: 'r9', x: 727, y: 80, type: 'job', d: 'plaza', next: [10] },
    { id: 10, key: 'r10', x: 840, y: 80, type: 'event', d: 'plaza', next: [11] },
    { id: 11, key: 'r11', x: 930, y: 190, type: 'grow', d: 'plaza', next: [12] },
    { id: 12, key: 'r12', x: 930, y: 300, type: 'new', d: 'forest', next: [13] },
    { id: 13, key: 'r13', x: 930, y: 410, type: 'event', d: 'forest', next: [14] },
    { id: 14, key: 'r14', x: 840, y: 520, type: 'life', d: 'forest', next: [15] },
    { id: 15, key: 'r15', x: 727, y: 520, type: 'job', d: 'forest', next: [16, 23] },
    { id: 16, key: 'r16', x: 613, y: 520, type: 'event', d: 'forest', next: [17] },
    { id: 17, key: 'r17', x: 500, y: 520, type: 'grow', d: 'forest', next: [18] },
    { id: 18, key: 'r18', x: 387, y: 520, type: 'collab', d: 'forest', next: [19] },
    { id: 19, key: 'r19', x: 273, y: 520, type: 'life', d: 'atelier', next: [0] },
    // 中央公園・北の道（r5 → 20 → 21 → 22 → r9）
    { id: 20, key: 'n1', x: 345, y: 200, type: 'job', d: 'center', next: [21] },
    { id: 21, key: 'n2', x: 500, y: 228, type: 'collab', d: 'center', next: [22] },
    { id: 22, key: 'n3', x: 655, y: 200, type: 'new', d: 'center', next: [9] },
    // 中央公園・南の道（r15 → 23 → 24 → 25 → r19）
    { id: 23, key: 's1', x: 655, y: 400, type: 'event', d: 'center', next: [24] },
    { id: 24, key: 's2', x: 500, y: 372, type: 'job', d: 'center', next: [25] },
    { id: 25, key: 's3', x: 345, y: 400, type: 'grow', d: 'center', next: [19] },
  ];
  const START_NODE = 0;
  // 分かれ道で見せる道の名前（next の順）
  const FORK_LABELS = {
    5: ['駅前ひろばの大通り', '中央公園の北の道'],
    15: ['森の公園の小道', '中央公園の南の道'],
  };

  // ── イベント（1人で取り組む）──────────────────────────
  // 地区ごとに4場面。選択肢は「やってみる活動」と「狙う適性」。
  const EVENTS = [
    { id: 0, d: 'atelier', title: 'まちの展示会', q: 'まちで展示会がひらかれるよ。何をやってみる？', icon: 'palette',
      opts: [['作品のアイデアを考える', 0], ['飾る作品をつくる', 2], ['来た人に楽しみ方を伝える', 3]] },
    { id: 1, d: 'atelier', title: '工房のお手伝い', q: '工房で、古い道具を直す手伝いをするよ。何をやってみる？', icon: 'build',
      opts: [['こわれた所をよく見る', 1], ['部品を作りかえる', 2], ['直し方を工夫する', 5]] },
    { id: 2, d: 'atelier', title: '手作りマーケット', q: '手作りマーケットにお店を出すよ。何をやってみる？', icon: 'storefront',
      opts: [['売る品物をつくる', 2], ['お店の看板を考える', 0], ['仲間と店番を分担する', 4]] },
    { id: 3, d: 'atelier', title: '新しいおもちゃづくり', q: '新しいおもちゃを作ることになったよ。何をやってみる？', icon: 'toys',
      opts: [['遊び方を思いつく', 0], ['試作品を組み立てる', 2], ['遊びやすく改良する', 5]] },
    { id: 4, d: 'plaza', title: '駅前のお祭り', q: '駅前でお祭りがあるよ。何をやってみる？', icon: 'festival',
      opts: [['屋台の係を分担する', 4], ['お客さんを案内する', 3], ['飾り付けを考える', 0]] },
    { id: 5, d: 'plaza', title: 'まちの案内所', q: 'まちの案内所を手伝うよ。何をやってみる？', icon: 'info',
      opts: [['道をわかりやすく説明する', 3], ['困っている人に気づく', 1], ['案内図を見やすくする', 5]] },
    { id: 6, d: 'plaza', title: '地域のラジオ番組', q: '地域のラジオ番組に参加するよ。何をやってみる？', icon: 'mic',
      opts: [['話すテーマを考える', 0], ['ゲストに話を聞く', 3], ['スタッフと進行を合わせる', 4]] },
    { id: 7, d: 'plaza', title: 'スポーツ大会の運営', q: 'スポーツ大会の運営を手伝うよ。何をやってみる？', icon: 'sports_soccer',
      opts: [['チームの役割を決める', 4], ['選手の様子に気づく', 1], ['応援の声をかける', 3]] },
    { id: 8, d: 'forest', title: '公園の生きもの調べ', q: '公園の生きものを調べるよ。何をやってみる？', icon: 'emoji_nature',
      opts: [['生きものをじっくり観察する', 1], ['観察の道具を工夫する', 5], ['見つけたことを仲間に伝える', 3]] },
    { id: 9, d: 'forest', title: '花だんづくり', q: '公園に花だんを作るよ。何をやってみる？', icon: 'yard',
      opts: [['日当たりや土の違いに気づく', 1], ['花の名前の札をつくる', 2], ['仲間と植える場所を分ける', 4]] },
    { id: 10, d: 'forest', title: '科学館のワークショップ', q: '科学館のワークショップに参加するよ。何をやってみる？', icon: 'science',
      opts: [['実験の結果をよく見る', 1], ['実験の手順を改良する', 5], ['新しい実験を思いつく', 0]] },
    { id: 11, d: 'forest', title: 'ロボットの大会', q: 'ロボットの大会に出るよ。何をやってみる？', icon: 'smart_toy',
      opts: [['ロボットを組み立てる', 2], ['動きを調整する', 5], ['チームで作戦を立てる', 4]] },
  ];

  // ── コラボ（2人で取り組む。1人のときは架空の仕事仲間と）────────
  const COLLABS = [
    { id: 0, title: 'まちの紹介動画づくり', q: 'まちの紹介動画をいっしょに作るよ。どの役割をやる？', icon: 'videocam',
      opts: [['企画を考える', 0], ['撮影や編集をする', 2], ['出演して話す', 3]] },
    { id: 1, title: '地域のイベントの準備', q: '地域のイベントをいっしょに準備するよ。どの役割をやる？', icon: 'event',
      opts: [['係をまとめる', 4], ['会場の使い方を工夫する', 5], ['足りないものに気づく', 1]] },
    { id: 2, title: '新しいカフェの開店準備', q: '新しいカフェの開店準備をいっしょにするよ。どの役割をやる？', icon: 'local_cafe',
      opts: [['メニューのアイデアを出す', 0], ['棚や看板をつくる', 2], ['お客さんへの案内を考える', 3]] },
    { id: 3, title: '生きもの地図づくり', q: '公園の生きもの地図をいっしょに作るよ。どの役割をやる？', icon: 'map',
      opts: [['生きものを探して記録する', 1], ['地図を見やすくまとめる', 5], ['調べる場所を分担する', 4]] },
    { id: 4, title: 'ゲームの共同制作', q: '新しいゲームをいっしょに作るよ。どの役割をやる？', icon: 'extension',
      opts: [['ルールを考える', 0], ['バランスを調整する', 5], ['遊んだ人の感想を聞く', 3]] },
    { id: 5, title: 'ステージ発表の準備', q: 'ステージ発表をいっしょに準備するよ。どの役割をやる？', icon: 'theaters',
      opts: [['衣装や小道具をつくる', 2], ['出番の順番を分担する', 4], ['見る人の反応に気づく', 1]] },
  ];

  // ── 暮らしのイベント（1人1回まで。次の2回のイベント判定に±1）──────
  // 結婚・子どもは利用者の明示の希望。特定の家族構成や所有が必須にならないよう、
  // 共同生活・カーシェア・賃貸・地域の活動も同じ強さで入れる（設計メモどおり）。
  // 止まった人は、ちがう場面のプラン3つから選ぶ（選ばないことも選べる）。ゲームが結婚・子どもなどを
  // 割り当てることはしない（2026-09-28。README「オーナーの委任による判断」）。
  const LIVES = [
    { id: 0, title: '新しい暮らしを始める（結婚）', icon: 'favorite',
      opts: [['家での役割を話し合う', 3], ['分担して準備する', 4]] },
    { id: 1, title: '友だちと共同生活', icon: 'group',
      opts: [['家事の分担を決める', 4], ['おたがいの予定を伝え合う', 3]] },
    { id: 2, title: '自動車を買う', icon: 'directions_car',
      opts: [['新しい場所へ出かける', 1], ['移動の方法を工夫する', 5]] },
    { id: 3, title: '車を必要なときだけ借りる', icon: 'car_rental',
      opts: [['行ってみたい場所を調べる', 1], ['借りる日を工夫して決める', 5]] },
    { id: 4, title: '家を買う', icon: 'house',
      opts: [['作業できる場所を整える', 2], ['部屋の使い方を考える', 0]] },
    { id: 5, title: '借りた部屋を整える', icon: 'chair',
      opts: [['家具を手作りする', 2], ['部屋のレイアウトを考える', 0]] },
    { id: 6, title: '子どもを迎える', icon: 'child_care',
      opts: [['世話の役割を分担する', 4], ['日々の変化を見つける', 1]] },
    { id: 7, title: '地域の子どもの活動', icon: 'family_restroom',
      opts: [['遊びの時間を仲間と分担する', 4], ['子どもたちの好きなことに気づく', 1]] },
  ];
  // 暮らしのプラン＝場面×活動（s: 場面の番号、i: その場面の活動の番号、text: 活動、a: 適性）
  const LIFE_PLANS = [];
  LIVES.forEach((l) => l.opts.forEach(([text, a], i) => LIFE_PLANS.push({ s: l.id, i, text, a })));
  const LIFE_TURNS = 2; // 効果が続くイベント判定の回数

  // ── 進路のラウンド（追加案。進路→活動→適性1枚の確定獲得）──────────
  // 学校種や学科名だけで適性を決めず、そこで選ぶ活動からカードを得る。
  // 進路名による追加得点・最終職業の制限はなし。本人の志望は聞かない。
  const CAREERS = {
    early: {
      title: '最初の進路',
      q: 'ゲームの中で、どの進路を試してみる？',
      routes: [
        { id: 'e0', name: '高校・普通科', desc: 'いろいろなことを幅広く学ぶ', icon: 'menu_book',
          acts: [['身近な場所を観察する', 1], ['イベントの案を考える', 0]] },
        { id: 'e1', name: '高校・専門学科（工業系）', desc: '道具や機械を使ったものづくりを学ぶ', icon: 'precision_manufacturing',
          acts: [['道具を使って作品を組み立てる', 2], ['作り方を改良する', 5]] },
        { id: 'e2', name: '高校・専門学科（商業系）', desc: 'お店や品物の仕組みを学ぶ', icon: 'store',
          acts: [['品物の魅力を紹介する', 3], ['展示の役割を分担する', 4]] },
        { id: 'e3', name: '高校・専門学科（農業系）', desc: '植物や動物を育てることを学ぶ', icon: 'agriculture',
          acts: [['作物の育ち方を観察する', 1], ['育て方を工夫する', 5]] },
        { id: 'e4', name: '高校・総合学科', desc: '自分で選んだ分野を組み合わせて学ぶ', icon: 'dashboard_customize',
          acts: [['作品づくりに取り組む', 2], ['発表に取り組む', 3]] },
      ],
      common: { id: 'ec', name: '今回は進路を決めない', desc: '学校・就職のラベルなしで、体験を1つ選ぶ', icon: 'directions_walk',
        acts: [['地域の活動に参加する', 4], ['好きなことを調べてみる', 1], ['作品づくりに挑戦する', 2]] },
    },
    mid: {
      title: '次の進路',
      q: 'ゲームの中で、次はどの進路を試してみる？',
      routes: [
        { id: 'm0', name: '大学・短大', desc: '気になるテーマをくわしく学ぶ', icon: 'account_balance',
          acts: [['気になるテーマを調べる', 1], ['仲間と調査を進める', 4]] },
        { id: 'm1', name: '専門学校（デザイン分野の例）', desc: '仕事に使う技術を学ぶ', icon: 'design_services',
          acts: [['デザインの案を考える', 0], ['作品を形にする', 2]] },
        { id: 'm2', name: '専門学校（調理分野の例）', desc: '仕事に使う技術を学ぶ', icon: 'soup_kitchen',
          acts: [['新しいメニューを考える', 0], ['手順を工夫して作る', 5]] },
        { id: 'm3', name: '就職', desc: '仕事をしながら経験を積む', icon: 'badge',
          acts: [['お客さんに使い方を説明する', 3], ['作業の手順を改善する', 5]] },
      ],
      common: { id: 'mc', name: '今回は進路を決めない', desc: '学校・就職のラベルなしで、体験を1つ選ぶ', icon: 'directions_walk',
        acts: [['旅をして新しい場所を知る', 1], ['地域のイベントを手伝う', 4], ['趣味の作品をつくる', 2]] },
    },
  };

  // ── 人数別の時間チップ初期値（設計メモの表。ホストが変更できる）────────
  const CHIPS_BY_PLAYERS = { 1: 8, 2: 8, 3: 8, 4: 6, 5: 6, 6: 5, 7: 4, 8: 4 };
  const CHIP_OPTIONS = [4, 5, 6, 8, 10];
  const TIMER_OPTIONS = [0, 30, 45, 60]; // 0 = 制限なし
  const PLAYER_COLORS = ['#C0392B', '#2463A8', '#1E7B4B', '#B7791F', '#7048B8', '#127A7A', '#B33C7A', '#6B5540'];

  const DATA = {
    GAME_TITLE, APTS, APT_CAP, JOBS, SQUARES, DISTRICTS, NODES, START_NODE, FORK_LABELS,
    EVENTS, COLLABS, LIVES, LIFE_PLANS, LIFE_TURNS, CAREERS,
    CHIPS_BY_PLAYERS, CHIP_OPTIONS, TIMER_OPTIONS, PLAYER_COLORS,
  };

  if (typeof module === 'object' && module.exports) module.exports = DATA;
  else root.CS_DATA = DATA;
}(typeof self !== 'undefined' ? self : this));
