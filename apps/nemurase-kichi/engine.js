/* ねむらせ基地 — マップとルールだけ。画面にも通信にも触らない。
   座標の単位はマス（1マス＝1）。人の位置はマスの中の小数で持つ（マス (3,4) の真ん中は 3.5, 4.5）。
   ブラウザでは window.NemuraseEngine、node では module.exports。 */
(function (root) {
  'use strict';

  // 2026-10-29 子どもの要望の第3便「マップを広く・部屋と通路を増やす・部屋を広く覚えやすい形に・監視室」で 44×30（9部屋）→ 64×43（13部屋）に作りなおした
  const W = 64;
  const H = 43;

  // 部屋（x, y, 幅, 高さ）。fill は床の色。part: true は同じ部屋の続き（L字・T字・十字の形を四角の組み合わせで作る。名前は最初の四角に書く）
  const ROOMS = [
    { key: 'kitchen', name: '台所', x: 2, y: 2, w: 12, h: 7, fill: '#F6E7D2' },
    { key: 'kitchen', part: true, x: 2, y: 9, w: 5, h: 3, fill: '#F6E7D2' },        // L字（左下へのびる）
    { key: 'radio', name: '通信室', x: 19, y: 2, w: 11, h: 7, fill: '#DDE9F3' },
    { key: 'monitor', name: '監視室', x: 35, y: 2, w: 8, h: 6, fill: '#D5DCE6' },
    { key: 'farm', name: '畑', x: 48, y: 2, w: 14, h: 7, fill: '#E2EFD6' },
    { key: 'farm', part: true, x: 52, y: 9, w: 6, h: 4, fill: '#E2EFD6' },          // T字（まん中から下へ）
    { key: 'plaza', name: 'ひろば', x: 24, y: 18, w: 18, h: 6, fill: '#F3EFE6' },
    { key: 'plaza', part: true, x: 28, y: 14, w: 10, h: 14, fill: '#F3EFE6' },      // 十字（テーブルがまん中）
    { key: 'lounge', name: '休けい室', x: 2, y: 17, w: 10, h: 8, fill: '#F1E2EA' },   // 2026-10-29 電気室が移ったあと
    { key: 'laundry', name: '洗たく室', x: 14, y: 19, w: 7, h: 6, fill: '#DCEEF2' },
    { key: 'store', name: '倉庫', x: 50, y: 18, w: 12, h: 7, fill: '#E9E1D8' },
    { key: 'store', part: true, x: 56, y: 25, w: 6, h: 5, fill: '#E9E1D8' },        // L字（右下へのびる）
    { key: 'pump', name: 'ポンプ室', x: 2, y: 30, w: 10, h: 9, fill: '#D9E4EE' },
    { key: 'tower', name: '見はり台', x: 22, y: 35, w: 20, h: 6, fill: '#E4E0F0' },  // 横に長い
    { key: 'playroom', name: 'ゲーム室', x: 47, y: 34, w: 12, h: 7, fill: '#F6DDE4' },
    // 行き止まりの小部屋（入口は1つ。2026-10-27 子どもの意見「マップに行き止まりがほしい」）
    { key: 'tools', name: '道具室', x: 9, y: 12, w: 4, h: 4, fill: '#EADFC8' },     // 台所↔電気室の通路から
    { key: 'green', name: '温室', x: 59, y: 13, w: 4, h: 4, fill: '#D6EEDD' },      // 畑↔倉庫の通路から
    // 2026-10-29 子どもの要望「電気室を行き止まりに（ポンプ室と見はり台の間の通路の上）」。停電をなおすスイッチもここ
    { key: 'power', name: '電気室', x: 14, y: 30, w: 6, h: 5, fill: '#F4EBC6' },    // ポンプ室↔見はり台の通路から
  ];
  // 通路（部屋どうしをつなぐ床）
  const HALLS = [
    [14, 4, 5, 2], [30, 4, 5, 2], [43, 4, 5, 2],     // 台所↔通信室↔監視室↔畑
    [28, 9, 2, 5], [40, 8, 2, 10],                   // 通信室↔ひろば・監視室↔ひろば
    [4, 12, 2, 5], [12, 20, 2, 2], [21, 20, 3, 2],   // 台所↔電気室↔洗たく室↔ひろば
    [42, 20, 8, 2], [54, 13, 2, 5],                  // ひろば↔倉庫↔畑
    [5, 25, 2, 5], [12, 36, 10, 2], [32, 28, 2, 7],  // 電気室↔ポンプ室↔見はり台↔ひろば
    [42, 37, 5, 2], [57, 30, 2, 4],                  // 見はり台↔ゲーム室↔倉庫
    [6, 13, 3, 2], [56, 14, 3, 2], [16, 35, 2, 1],   // 行き止まりの小部屋への通路（道具室・温室・電気室）
  ];
  const HALL_FILL = '#E6E3DC';

  // 仕事の場所。kind: wire＝線をつなぐ / order＝番号を順に押す / meter＝メーターを合わせる。id は並び順（新しい場所は末尾に足す）
  const SPOTS = [
    { id: 0, room: 'kitchen', x: 4.5, y: 3.5, kind: 'order', label: 'お皿を順番にしまう' },
    { id: 1, room: 'kitchen', x: 12.5, y: 7.5, kind: 'meter', label: 'なべの火を合わせる' },
    { id: 2, room: 'radio', x: 23.5, y: 3.5, kind: 'wire', label: '通信の線をつなぐ' },
    { id: 3, room: 'radio', x: 28.5, y: 7.5, kind: 'order', label: 'アンテナの番号を押す' },
    { id: 4, room: 'farm', x: 50.5, y: 3.5, kind: 'meter', label: '水の量を合わせる' },
    { id: 5, room: 'farm', x: 54.5, y: 11.5, kind: 'order', label: 'たねを順番にまく' },
    { id: 6, room: 'power', x: 14.5, y: 31.5, kind: 'wire', label: '電線をつなぐ' },
    { id: 7, room: 'store', x: 58.5, y: 28.5, kind: 'order', label: '荷物を番号順にのせる' },
    { id: 8, room: 'store', x: 51.5, y: 19.5, kind: 'wire', label: 'ケーブルをつなぐ' },
    { id: 9, room: 'tower', x: 38.5, y: 36.5, kind: 'meter', label: '望遠鏡のピントを合わせる' },
    { id: 10, room: 'tower', x: 26.5, y: 39.5, kind: 'wire', label: 'ライトの線をつなぐ' },
    // 行き止まりの奥（わざわざ入る理由）
    { id: 11, room: 'tools', x: 11.5, y: 13.5, kind: 'order', label: '道具を番号順にならべる' },
    { id: 12, room: 'green', x: 61.5, y: 15.5, kind: 'meter', label: '温室の温度を合わせる' },
    // 2026-10-29 足した部屋
    { id: 13, room: 'monitor', x: 41.5, y: 5.5, kind: 'wire', label: 'モニターの線をつなぐ' },
    { id: 14, room: 'laundry', x: 15.5, y: 20.5, kind: 'order', label: '洗たく物を番号順にたたむ' },
    { id: 15, room: 'pump', x: 3.5, y: 33.5, kind: 'meter', label: '水の強さを合わせる' },
    { id: 16, room: 'playroom', x: 52.5, y: 36.5, kind: 'order', label: 'ボールを番号順にしまう' },
    { id: 17, room: 'lounge', x: 10.5, y: 18.5, kind: 'order', label: 'クッションを番号順にならべる' },
  ];
  const FIX_SPOT = { x: 18.5, y: 32.5 };    // 停電をなおすスイッチ（電気室。2026-10-29 行き止まりへ移した）
  const TABLE = { x: 33, y: 21, r: 1.6 };   // ひろばの会議テーブル（まるいので、ぶつかる）
  // 近道（ねむらせ屋・整備係が使える）。2026-10-26 ねむらせ屋を有利にする調整で追加。
  // 2026-10-29 子どもの要望「ベントで飛ぶ場所を選べるように」→ オーナー決定: 近道に入ると姿が消え（中にいられるのは VENT_STAY_S 秒まで）、
  // ほかの7か所のどこへでも、部屋の名前のボタンで選んで出られる（決まった組はなくした）。どれもちがう部屋にある
  const VENTS = [
    { id: 0, x: 8.5, y: 6.5 },     // 台所
    { id: 1, x: 4.5, y: 22.5 },    // 休けい室
    { id: 2, x: 59.5, y: 7.5 },    // 畑
    { id: 3, x: 54.5, y: 23.5 },   // 倉庫
    { id: 4, x: 19.5, y: 23.5 },   // 洗たく室
    { id: 5, x: 9.5, y: 36.5 },    // ポンプ室
    { id: 6, x: 36.5, y: 6.5 },    // 監視室
    { id: 7, x: 56.5, y: 39.5 },   // ゲーム室
  ];
  const VENT_STAY_S = 10;
  // はしご（だれでも使える。ねむった人も）。2026-10-28 子どもの意見「マップにギミック（はしご）」
  // 上に立って「はしごをおりる／のぼる」を押すと、CLIMB_MS のあいだその場に立ったまま（見える・ねむらせられる）で、to のはしごへ移る。
  // 通信室（画面の上）↔ 見はり台（画面の下）。隊員の移動が速くなる＝隊員が有利になる向き（近道はねむらせ屋だけ、はしごはみんな）
  const LADDERS = [
    { id: 0, x: 20.5, y: 8.0, to: 1, room: 'radio', label: 'はしごをおりる', busy: 'おりている…' },
    { id: 1, x: 23.5, y: 40.0, to: 0, room: 'tower', label: 'はしごをのぼる', busy: 'のぼっている…' },
  ];
  const CLIMB_MS = 2500;
  // 監視カメラ。2026-10-28 子どもの意見。カメラの台（CAM_STAND）に立って「カメラを見る」と、通路に置いたカメラ（CAMS）のまわり CAM_R マスの
  // 通路の部分だけが小窓に映る（部屋の中は映らない）。見ている間はその場から動けない。だれかが見ている間はカメラのランプが光る（ねむらせ屋が気づける）。停電中は映らない
  // 2026-10-29 子どもの要望「カメラルーム（監視室）がほしい」で、台を通信室から監視室へ移し、カメラを4つ→6つにした
  const CAM_STAND = { x: 38.5, y: 3.0 };
  const CAMS = [
    { id: 0, x: 16.5, y: 5, name: '台所と通信室の間' },
    { id: 1, x: 32.5, y: 5, name: '通信室と監視室の間' },
    { id: 2, x: 41, y: 13, name: '監視室とひろばの間' },
    { id: 3, x: 46, y: 21, name: 'ひろばと倉庫の間' },
    { id: 4, x: 33, y: 31.5, name: 'ひろばと見はり台の間' },
    { id: 5, x: 17, y: 37, name: 'ポンプ室と見はり台の間' },
  ];
  const CAM_R = 2.5;

  // ── 2026-10-28 子どもの要望の第2便（オーナー承認）──
  // 空気の妨害（ねむらせ屋）: 止めると AIR_LIMIT_S 秒のうちに、離れた2部屋のパネルを両方なおさないと ねむらせ屋の勝ち。
  // 「停電で負けることはない」をはじめて破る（オーナー「破ってもOK」）。集団でかたまって動くと間に合わない向きの仕組み
  const AIR_PANELS = [
    { id: 'a', room: 'kitchen', x: 11.5, y: 3.0, label: '台所の空気のパネル' },
    { id: 'b', room: 'store', x: 60.5, y: 19.5, label: '倉庫の空気のパネル' },
  ];
  const AIR_LIMIT_S = 60;
  // ふたりの仕事: 離れた2か所のスイッチを、ふたりが同時におしていないとおわらない。隊員はひとり1つ持つ（設定 pair で切れる）。
  // 2人組で動く理由を作る（集団を小さく割る向き）。おしている人は PAIR_HOLD_MS の間だけ「おしている」とみなす（2秒おきに書き直す）
  const PAIRS = [
    { id: 'p0', spot: 100, label: 'ふたりでスイッチを入れる', a: { room: 'lounge', x: 3.5, y: 18.5 }, b: { room: 'farm', x: 60.5, y: 3.5 } },
    { id: 'p1', spot: 101, label: 'ふたりでレバーを引く', a: { room: 'kitchen', x: 3.5, y: 10.5 }, b: { room: 'tower', x: 39.5, y: 39.5 } },
  ];
  const PAIR_SPOT_BASE = 100;
  const PAIR_HOLD_MS = 6000;
  const PAIR_BEAT_MS = 2000;
  // ドア（ねむらせ屋）: 部屋を選ぶと、その部屋の入口がぜんぶ DOOR_MS の間とじる（見えるが通れない）。集団を分ける向き。ひろばにはドアがない（テーブルにいつでも行けるように）
  // ドアは、その部屋につながる通路の、部屋に接する1列
  const DOORS = [
    { room: 'kitchen', x: 14, y: 4, w: 1, h: 2 }, { room: 'kitchen', x: 4, y: 12, w: 2, h: 1 },
    { room: 'radio', x: 18, y: 4, w: 1, h: 2 }, { room: 'radio', x: 30, y: 4, w: 1, h: 2 }, { room: 'radio', x: 28, y: 9, w: 2, h: 1 },
    { room: 'monitor', x: 34, y: 4, w: 1, h: 2 }, { room: 'monitor', x: 43, y: 4, w: 1, h: 2 }, { room: 'monitor', x: 40, y: 8, w: 2, h: 1 },
    { room: 'farm', x: 47, y: 4, w: 1, h: 2 }, { room: 'farm', x: 54, y: 13, w: 2, h: 1 },
    { room: 'lounge', x: 4, y: 16, w: 2, h: 1 }, { room: 'lounge', x: 12, y: 20, w: 1, h: 2 }, { room: 'lounge', x: 5, y: 25, w: 2, h: 1 },
    { room: 'laundry', x: 13, y: 20, w: 1, h: 2 }, { room: 'laundry', x: 21, y: 20, w: 1, h: 2 },
    { room: 'store', x: 54, y: 17, w: 2, h: 1 }, { room: 'store', x: 49, y: 20, w: 1, h: 2 }, { room: 'store', x: 57, y: 30, w: 2, h: 1 },
    { room: 'pump', x: 5, y: 29, w: 2, h: 1 }, { room: 'pump', x: 12, y: 36, w: 1, h: 2 },
    { room: 'tower', x: 32, y: 34, w: 2, h: 1 }, { room: 'tower', x: 21, y: 36, w: 1, h: 2 }, { room: 'tower', x: 42, y: 37, w: 1, h: 2 },
    { room: 'playroom', x: 57, y: 33, w: 2, h: 1 }, { room: 'playroom', x: 46, y: 37, w: 1, h: 2 },
  ]
  // 行き止まりの小部屋（道具室・温室・電気室）にはドアがない（とじこめないように）
  const DOOR_ROOMS = ['kitchen', 'radio', 'monitor', 'farm', 'lounge', 'laundry', 'store', 'pump', 'tower', 'playroom'];
  const DOOR_MS = 10000;
  const DOOR_AGAIN_S = 20;
  // 会議ボタンの待ち時間: はじめと会議のあと BUTTON_WAIT_S 秒は押せない（はじまった直後の会議・会議の連続・追われたときの逃げ道をふせぐ）
  const BUTTON_WAIT_S = 20;
  // 家具（部屋の目印。1マスのかべとして ぶつかる・かべごしに見えない。マップを覚えやすくする）。x, y, w, h はマス。kind は描き方
  const FURNITURE = [
    { room: 'kitchen', kind: 'stove', x: 6, y: 2, w: 2, h: 1 }, { room: 'kitchen', kind: 'table', x: 8, y: 4, w: 1, h: 1 },
    { room: 'radio', kind: 'antenna', x: 19, y: 2, w: 1, h: 1 }, { room: 'radio', kind: 'desk', x: 25, y: 2, w: 2, h: 1 },
    { room: 'monitor', kind: 'screen', x: 36, y: 2, w: 2, h: 1 }, { room: 'monitor', kind: 'screen', x: 40, y: 2, w: 2, h: 1 },
    { room: 'farm', kind: 'crops', x: 52, y: 7, w: 3, h: 1 }, { room: 'farm', kind: 'crops', x: 56, y: 7, w: 3, h: 1 }, { room: 'farm', kind: 'tank', x: 61, y: 8, w: 1, h: 1 },
    { room: 'plaza', kind: 'sofa', x: 24, y: 18, w: 2, h: 1 }, { room: 'plaza', kind: 'plant', x: 37, y: 14, w: 1, h: 1 }, { room: 'plaza', kind: 'plant', x: 28, y: 27, w: 1, h: 1 }, { room: 'plaza', kind: 'plant', x: 41, y: 23, w: 1, h: 1 },
    { room: 'lounge', kind: 'sofa', x: 7, y: 17, w: 2, h: 1 }, { room: 'lounge', kind: 'plant', x: 2, y: 24, w: 1, h: 1 },
    { room: 'power', kind: 'generator', x: 16, y: 30, w: 2, h: 1 }, { room: 'power', kind: 'barrel', x: 19, y: 30, w: 1, h: 1 },
    { room: 'laundry', kind: 'washer', x: 17, y: 19, w: 2, h: 1 }, { room: 'laundry', kind: 'basket', x: 14, y: 24, w: 1, h: 1 },
    { room: 'store', kind: 'crate', x: 58, y: 24, w: 2, h: 1 }, { room: 'store', kind: 'crate', x: 61, y: 29, w: 1, h: 1 }, { room: 'store', kind: 'shelf', x: 50, y: 24, w: 1, h: 1 },
    { room: 'pump', kind: 'pump', x: 7, y: 32, w: 2, h: 1 }, { room: 'pump', kind: 'tank', x: 2, y: 30, w: 1, h: 1 },
    { room: 'tower', kind: 'light', x: 22, y: 35, w: 1, h: 1 }, { room: 'tower', kind: 'bench', x: 30, y: 40, w: 2, h: 1 }, { room: 'tower', kind: 'light', x: 41, y: 35, w: 1, h: 1 },
    { room: 'playroom', kind: 'arcade', x: 48, y: 34, w: 2, h: 1 }, { room: 'playroom', kind: 'gametable', x: 53, y: 39, w: 2, h: 1 },
    { room: 'tools', kind: 'shelf', x: 12, y: 15, w: 1, h: 1 },
    { room: 'green', kind: 'plant', x: 62, y: 13, w: 1, h: 1 }, { room: 'green', kind: 'plant', x: 60, y: 16, w: 1, h: 1 },
  ];

  const SPEED = 4.2;          // 1秒に進むマス
  const RADIUS = 0.34;        // 人の大きさ
  const USE_RANGE = 1.3;      // 仕事・スイッチ・テーブルに手がとどく距離
  const SLEEP_RANGE = 1.5;    // ねむらせられる距離
  const FIND_RANGE = 2.2;     // ねむっている人を見つけられる距離
  // 見える広さ（隊員・停電中の隊員・ねむらせ屋）。隊員は 2026-10-26 に 6 → 4.5（ねむらせ屋を有利にする調整）
  // 2026-10-27 からは、この広さの中でも かべの向こうは見えない（canSee・viewPolygon）
  // 2026-10-29 子どもの要望「視野が広くなるとよい」→ オーナー決定で隊員を 4.5 → 5.5（マップを広げた分）
  const VIEW = { crew: 5.5, dark: 2.4, sleeper: 7.5 };
  const VIEW_RAYS = 540;      // 暗がりを かべで切るときに飛ばす光線の本数（多いほどなめらか・重い）
  const VIEW_OVER = 0.3;      // かべに当たった光線を、かべの面が少し見えるように のばすマス数

  const COLORS = [
    { key: 'red', name: 'あか', hex: '#D9433B' },
    { key: 'blue', name: 'あお', hex: '#2F6FD6' },
    { key: 'green', name: 'みどり', hex: '#2E9A4A' },
    { key: 'yellow', name: 'きいろ', hex: '#E8B820' },
    { key: 'orange', name: 'オレンジ', hex: '#EC7A1C' },
    { key: 'purple', name: 'むらさき', hex: '#8A4FC8' },
    { key: 'pink', name: 'ピンク', hex: '#E86FA8' },
    { key: 'cyan', name: 'みずいろ', hex: '#2BB3C6' },
    { key: 'brown', name: 'ちゃいろ', hex: '#8C5A33' },
    { key: 'white', name: 'しろ', hex: '#F2F2F2' },
  ];

  const GAME_LIMIT_S = 15 * 60; // 1回の長さの上限（通信を抑えるため）。過ぎたら「時間切れ」で引き分け

  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 10;
  const TWO_SLEEPERS_MIN = 7;

  // ねむらせてから次までの時間は 2026-10-26 に はじめ30秒（20・30・45）→ はじめ20秒（15・20・30）（ねむらせ屋を有利にする調整）
  // pick: ねむらせ屋の決め方（0＝ランダム、1＝ホストが待合室で選ぶ）。2026-10-27 子どもの意見で追加
  // pair: ふたりの仕事（1＝隊員はひとり1つ持つ、0＝なし）。gauge: みんなの仕事のバー（2＝出す、1＝進行役の画面だけ、0＝出さない）。2026-10-28 子どもの要望の第2便
  // engineer・watcher・angel・shifter: 役職（1＝入れる、0＝入れない）。2026-10-29 子どもの要望の第3便。はじめはどれも入れない
  const DEFAULT_SETTINGS = { hostPlays: 1, sleepers: 1, tasks: 4, cooldown: 20, meeting: 90, buttons: 1, pick: 0, pair: 1, gauge: 2, engineer: 0, watcher: 0, angel: 0, shifter: 0 };
  const SETTING_OPTS = {
    hostPlays: [1, 0],
    sleepers: [1, 2],
    pick: [0, 1],
    tasks: [3, 4, 5],
    pair: [1, 0],
    cooldown: [15, 20, 30],
    meeting: [60, 90, 120, 150, 180],
    buttons: [1, 2],
    gauge: [2, 1, 0],
    engineer: [0, 1],
    watcher: [0, 1],
    angel: [0, 1],
    shifter: [0, 1],
  };

  // ── 役職（2026-10-29 子どもの要望の第3便。設定でひとつずつ入れる。名前は着想元から借りない）──
  // engineer＝整備係（隊員。ねむらせ屋と同じ近道を使える）／watcher＝見守り係（隊員。だれがねむっているかを見る「ねむりチェッカー」）／
  // shifter＝へんしん屋（ねむらせ屋。少しの間ほかの人のすがたになる）／angel＝まもり星（隊員。近くの人にバリア。おきていても、ねむってからも使える）。
  // ロボットには付けない（わざを使わないため）。どれも、はじめに決まる（まもり星は 2026-10-29 オーナー「最初から役職として」で、最初にねむった隊員がなる形をやめた）
  const JOB_NAMES = { engineer: '整備係', watcher: '見守り係', shifter: 'へんしん屋', angel: 'まもり星' };
  const ENGINEER_GAP_S = 30;   // 整備係が近道を使ってから、次に使えるまで
  const WATCH_BATTERY_S = 10;  // 見守り係のチェッカーの電池（見ている間へる）
  const WATCH_CHARGE_S = 6;    // 見ていない間、この秒数ごとに電池が1秒ぶんたまる（仕事を1つおえると満タン）
  const SHIELD_S = 15;         // まもり星のバリアが続く時間
  const ANGEL_GAP_S = 30;      // まもり星がバリアをはってから、次にはれるまで
  const ANGEL_RANGE = 2.2;     // バリアをはれる距離
  const SHIFT_S = 20;          // へんしんが続く時間
  const SHIFT_GAP_S = 30;      // へんしんがおわってから、次にへんしんできるまで

  // ── ひとこと（ボタンで知らせる）──
  // 2026-10-27 子どもの意見「ゲーム内にチャットがほしい」→ 自由に文字を打つチャットは入れず、決まった言葉をボタンで送る（語はオーナー承認済み）。
  // {room} は送る人のいる部屋の名前（通路なら「通路」）、{name} は選んだ人の名前（会議中は投票で選んでいる人。いなければ「だれ？」で選ぶ。遊んでいる間も「だれ？」で選ぶ）。
  // play＝遊んでいる間、meeting＝会議中、common＝どちらでも
  const SAYS = {
    play: [
      { k: 'here', t: '{room}にいるよ' },
      { k: 'come', t: '{room}に来て' },
      { k: 'plaza', t: 'ひろばに集まろう' },
      { k: 'fixgo', t: '停電をなおしに行く' },
      { k: 'power', t: '電気室に来て' },
      { k: 'together', t: 'いっしょに行こう' },
      { k: 'withnow', t: '{name}さんといっしょにいる' },   // 2026-10-28 子どもの意見「〇〇が仕事やってたよ」→ 名前の入る言葉を遊んでいる間にも（「だれ？」で選ぶ）
      { k: 'sawnow', t: '{name}さんが仕事をしていた' },
      { k: 'work', t: '仕事をしてくるね' },
      { k: 'done1', t: '仕事がひとつおわったよ' },   // 2026-10-27 子どもの意見「仕事おわったよ」（ねむらせ屋のふりにも使える）
      { k: 'doneall', t: '仕事がぜんぶおわったよ' },
      { k: 'body', t: 'ねむっている人がいた！' },
      { k: 'wait', t: 'まって〜' },
      { k: 'hey', t: 'おーい！' },
    ],
    meeting: [
      { k: 'with', t: '{name}さんといっしょにいた' },
      { k: 'saw', t: '{name}さんが仕事をしていた' },
      { k: 'vent', t: '{name}さんが近道に入った' },
      { k: 'ran', t: '{name}さんが走って行った' },
      { k: 'sus', t: '{name}さんがあやしいと思う' },
      { k: 'crew', t: '自分は隊員だよ' },
      { k: 'no', t: 'ちがうよ！' },
      { k: 'from', t: '{room}のほうから来た' },
      { k: 'dunno', t: 'わからない' },
      { k: 'skip', t: 'スキップにしよう' },
    ],
    common: [
      { k: 'yes', t: 'そうだよ' },   // 2026-10-28 子どもの意見
      { k: 'ok', t: 'オッケー' },
      { k: 'thanks', t: 'ありがとう' },
      { k: 'sorry', t: 'ごめんね' },
    ],
  };
  const SAY_GAP_MS = 5000;   // ひとり5秒に1回まで
  const SAY_SHOW_MS = 6000;  // 遊んでいる間、画面の上に出しておく時間
  const SAY_LOG_MAX = 8;     // 会議の画面に出す流れの数
  const HALL_LABEL = '通路';
  const sayPhrase = (key) => SAYS.play.concat(SAYS.meeting, SAYS.common).find((p) => p.k === key) || null;
  // stage（'play'|'meeting'）で送れる言葉か
  const sayAllowed = (key, stage) => (SAYS[stage] || []).concat(SAYS.common).some((p) => p.k === key);
  function sayText(key, roomLabel, nameLabel) {
    const p = sayPhrase(key);
    if (!p) return '';
    return p.t.replace('{room}', roomLabel || HALL_LABEL).replace('{name}', nameLabel || '');
  }

  // ── マップ ──
  // grid[y][x]: 0＝かべ、1＝床
  function buildGrid() {
    const g = Array.from({ length: H }, () => new Array(W).fill(0));
    const fill = (x, y, w, h) => {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) g[yy][xx] = 1;
    };
    ROOMS.forEach((r) => fill(r.x, r.y, r.w, r.h));
    HALLS.forEach((h) => fill(h[0], h[1], h[2], h[3]));
    // 家具は1マスのかべ（ぶつかる・かべごしに見えない）
    FURNITURE.forEach((f) => { for (let yy = f.y; yy < f.y + f.h; yy++) for (let xx = f.x; xx < f.x + f.w; xx++) g[yy][xx] = 0; });
    return g;
  }
  const GRID = buildGrid();

  const isFloor = (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H && GRID[ty][tx] === 1;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const tileKey = (tx, ty) => tx + ',' + ty;

  function roomAt(x, y) {
    const r = ROOMS.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    return r ? r.key : null;
  }
  const roomName = (key) => (ROOMS.find((r) => r.key === key) || {}).name || '';

  // とじているドアのマス（Set の "x,y"）。rooms はドアがとじている部屋のキーの配列
  function doorTiles(rooms) {
    const out = new Set();
    (rooms || []).forEach((key) => {
      DOORS.filter((d) => d.room === key).forEach((d) => {
        for (let yy = d.y; yy < d.y + d.h; yy++) for (let xx = d.x; xx < d.x + d.w; xx++) out.add(tileKey(xx, yy));
      });
    });
    return out;
  }
  const corners = (x, y) => [[x - RADIUS, y - RADIUS], [x + RADIUS, y - RADIUS], [x - RADIUS, y + RADIUS], [x + RADIUS, y + RADIUS]];
  // 体のどこかが、とじているドアのマスにかかっているか
  const inClosed = (x, y, closed) => !!closed && closed.size > 0 && corners(x, y).some((p) => closed.has(tileKey(Math.floor(p[0]), Math.floor(p[1]))));

  // その位置に人が立てるか（かべ・家具・テーブルにかからないか）。closed（とじているドアのマス）を渡すと、そこにも立てない
  function canStand(x, y, closed) {
    if (!corners(x, y).every((p) => isFloor(Math.floor(p[0]), Math.floor(p[1])))) return false;
    if (inClosed(x, y, closed)) return false;
    return Math.hypot(x - TABLE.x, y - TABLE.y) >= TABLE.r + RADIUS;
  }

  // 1歩すすめる。dx, dy は向き（長さ1まで）、dt は秒。かべに当たったら、すべるように横へ動く。
  // closed（とじているドアのマス）には入れない。ただし、とじた瞬間にドアの上にいた人は出られる（閉じこめない）
  function step(pos, dx, dy, dt, closed) {
    const len = Math.hypot(dx, dy);
    if (!len) return { x: pos.x, y: pos.y };
    const k = Math.min(1, len) / len;
    const vx = dx * k * SPEED * dt;
    const vy = dy * k * SPEED * dt;
    let x = pos.x;
    let y = pos.y;
    const okAt = (nx, ny) => canStand(nx, ny) && (!inClosed(nx, ny, closed) || inClosed(x, y, closed));
    // 大きく動くときは小さく分けて、かべを抜けないようにする
    const n = Math.max(1, Math.ceil(Math.hypot(vx, vy) / 0.2));
    for (let i = 0; i < n; i++) {
      if (okAt(x + vx / n, y)) x += vx / n;
      if (okAt(x, y + vy / n)) y += vy / n;
    }
    return { x, y };
  }

  // ねむった人の歩き方: かべ・家具・ドア・テーブルを通りぬける（マップの外には出ない）。2026-10-28 子どもの要望「幽霊がかべを通れない」
  function stepFree(pos, dx, dy, dt) {
    const len = Math.hypot(dx, dy);
    if (!len) return { x: pos.x, y: pos.y };
    const k = Math.min(1, len) / len;
    const clamp = (v, max) => Math.max(RADIUS, Math.min(max - RADIUS, v));
    return { x: clamp(pos.x + dx * k * SPEED * dt, W), y: clamp(pos.y + dy * k * SPEED * dt, H) };
  }

  // マスの間の道（4方向）。from, to はマス。見つからなければ null。closed（とじているドアのマス）は通らない
  function path(from, to, closed) {
    const key = (x, y) => y * W + x;
    const open = (x, y) => isFloor(x, y) && !(closed && closed.has(tileKey(x, y)));
    if (!open(to.x, to.y)) return null;
    const prev = new Map([[key(from.x, from.y), -1]]);
    const q = [[from.x, from.y]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === to.x && y === to.y) {
        const out = [];
        let k = key(x, y);
        while (k !== -1) { out.push({ x: k % W, y: Math.floor(k / W) }); k = prev.get(k); }
        return out.reverse();
      }
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([ax, ay]) => {
        const nx = x + ax;
        const ny = y + ay;
        if (!open(nx, ny) || prev.has(key(nx, ny))) return;
        prev.set(key(nx, ny), key(x, y));
        q.push([nx, ny]);
      });
    }
    return null;
  }

  // 仕事の場所（SPOTS と、ふたりの仕事の場所 100〜）。ふたりの仕事は room が空で、roomLabel に2つの部屋の名前
  function spotInfo(id) {
    if (SPOTS[id]) return SPOTS[id];
    const p = PAIRS.find((q) => q.spot === id);
    if (!p) return null;
    return { id: p.spot, pair: p.id, kind: 'pair', room: '', roomLabel: roomName(p.a.room) + 'と' + roomName(p.b.room), label: p.label };
  }
  const pairOf = (pid) => PAIRS.find((p) => p.id === pid) || null;
  // ふたりの仕事の「おしている」が有効か（at からの時間で見る）
  const pairFresh = (hold, now) => !!hold && typeof hold.id === 'string' && Number(hold.at) > 0 && now - Number(hold.at) <= PAIR_HOLD_MS;

  // ── 見える・見えない（かべ） ──
  // a から向き (dx, dy)（長さ1）へ光線を飛ばし、かべに当たるまでの距離を返す（max まで何も当たらなければ max）。
  // マスの境目を1つずつ進む（かべのマスに入った瞬間の距離が答え）
  function rayDist(a, dx, dy, max) {
    let tx = Math.floor(a.x);
    let ty = Math.floor(a.y);
    if (!isFloor(tx, ty)) return 0;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tdx = dx ? 1 / Math.abs(dx) : Infinity;
    const tdy = dy ? 1 / Math.abs(dy) : Infinity;
    let nx = dx > 0 ? (tx + 1 - a.x) * tdx : dx < 0 ? (a.x - tx) * tdx : Infinity;
    let ny = dy > 0 ? (ty + 1 - a.y) * tdy : dy < 0 ? (a.y - ty) * tdy : Infinity;
    for (let i = 0; i < W + H; i++) {
      let t;
      if (nx < ny) { t = nx; tx += stepX; nx += tdx; } else { t = ny; ty += stepY; ny += tdy; }
      if (t >= max) return max;
      if (!isFloor(tx, ty)) return t;
    }
    return max;
  }

  // a から b が見えるか（間にかべのマスがなければ true）。距離は見ない（見える広さは別に確かめる）
  function canSee(a, b) {
    const d = dist(a, b);
    if (d < 1e-9) return isFloor(Math.floor(a.x), Math.floor(a.y));
    return rayDist(a, (b.x - a.x) / d, (b.y - a.y) / d, d) >= d;
  }

  // from から見える範囲の多角形（半径 r。全方向に n 本の光線を飛ばし、かべで止める）。暗がりを切り抜くのに使う
  function viewPolygon(from, r, n, over) {
    const rays = n || VIEW_RAYS;
    const ext = over === undefined ? VIEW_OVER : over;
    const out = [];
    for (let i = 0; i < rays; i++) {
      const a = (Math.PI * 2 * i) / rays;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const t = rayDist(from, dx, dy, r);
      const tt = t < r ? Math.min(r, t + ext) : r;
      out.push({ x: from.x + dx * tt, y: from.y + dy * tt });
    }
    return out;
  }

  // 会議のあと・はじめに立つ場所（テーブルのまわり）
  function spawnPoint(i, n) {
    const a = (Math.PI * 2 * i) / Math.max(1, n) - Math.PI / 2;
    const r = TABLE.r + 1.3;
    return { x: TABLE.x + Math.cos(a) * r, y: TABLE.y + Math.sin(a) * r };
  }

  // ── ルール ──
  function shuffled(arr, rnd) {
    const a = arr.slice();
    const r = rnd || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sleeperCount(settings, n) {
    return settings.sleepers === 2 && n >= TWO_SLEEPERS_MIN ? 2 : 1;
  }

  // ids: 遊ぶ人。roles＝{id: 'crew'|'sleeper'}、tasks＝{id: [{spot, done}]}（ねむらせ屋は「ふりをする場所」で done は使わない）
  // picks: ホストが選んだねむらせ屋（id の配列）。遊ぶ人にいる分だけ使い、人数に足りなければ残りはシャッフルで決める
  function newGame(ids, settings, rnd, picks) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const ns = sleeperCount(s, ids.length);
    const chosen = (Array.isArray(picks) ? picks : []).filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i).slice(0, ns);
    const order = chosen.concat(shuffled(ids.filter((id) => !chosen.includes(id)), rnd));
    const roles = {};
    const tasks = {};
    const buttons = {};
    let crewN = 0;
    order.forEach((id, i) => {
      roles[id] = i < ns ? 'sleeper' : 'crew';
      tasks[id] = shuffled(SPOTS.map((p) => p.id), rnd).slice(0, s.tasks).map((spot) => ({ spot, done: false }));
      // ふたりの仕事: 隊員はひとり1つ（2組を順番に）。ロボット（id が * で始まる）には持たせない（ふたりで合わせられないため。手伝いはする）
      if (s.pair === 1 && roles[id] === 'crew' && !String(id).startsWith('*')) {
        tasks[id].push({ spot: PAIRS[crewN % PAIRS.length].spot, done: false });
        crewN++;
      }
      buttons[id] = s.buttons;
    });
    // 役職（人だけ。整備係・見守り係は隊員から1人ずつ、へんしん屋はねむらせ屋から1人）
    const jobs = {};
    const human = (id) => !String(id).startsWith('*');
    const crewH = shuffled(order.filter((id) => roles[id] === 'crew' && human(id)), rnd);
    const sleeperH = order.filter((id) => roles[id] === 'sleeper' && human(id));
    if (s.engineer === 1 && crewH.length) jobs[crewH.shift()] = 'engineer';
    if (s.watcher === 1 && crewH.length) jobs[crewH.shift()] = 'watcher';
    if (s.angel === 1 && crewH.length) jobs[crewH.shift()] = 'angel';
    if (s.shifter === 1 && sleeperH.length) jobs[sleeperH[0]] = 'shifter';
    return {
      settings: s,
      players: ids.slice(),
      roles,
      tasks,
      buttons,
      asleep: {},       // {id: 'slept'|'voted'}
      sleptBy: {},      // {id: ねむらせた人の id}（ねむらされた本人の画面にだけ出す。2026-10-28）
      left: {},         // {id: true} ゲームの途中で抜けた人（勝ち負けの判定と、のこりの仕事の数から外す）
      bodies: [],       // ねむっている姿 [{id, x, y}]（会議で片づく）
      cooldown: {},     // {id: この時刻まで、ねむらせられない}
      cam: {},          // {id: true} 監視カメラを見ている人（game/cam/{id}。会議で空にする）
      dark: false,      // 停電中
      darkReadyAt: 0,   // この時刻から停電・空気の妨害を起こせる（2つで共通）
      air: 0,           // 空気が止まっている間は、この時刻までになおさないと ねむらせ屋の勝ち（0＝止まっていない）
      airFixed: {},     // {a: true, b: true} なおしたパネル
      doors: {},        // {部屋のキー: この時刻までドアがとじている}
      doorReadyAt: 0,   // この時刻から、またドアをとじられる
      buttonReadyAt: 0, // この時刻から会議ボタンを押せる（はじめと会議のあと BUTTON_WAIT_S 秒）
      pair: {},         // {ふたりの仕事の id: {a: {id, at}, b: {id, at}}} いまスイッチをおしている人
      jobs,             // {id: 'engineer'|'watcher'|'shifter'} 役職（2026-10-29）
      angelReadyAt: 0,  // この時刻から、まもり星がバリアをはれる
      shield: {},       // {id: この時刻までバリア}（ねむらせられない。会議で消える）
      shape: {},        // {id: {as: なっている人, until}} へんしん中（会議で消える）
      shiftReadyAt: {}, // {id: この時刻から、またへんしんできる}
      blocked: null,    // {by, t, at} さいごにバリアで ねむらせられなかったとき（本人とまもり星にだけ知らせる）
      spawnSeq: 1,      // 増えたら、みんなテーブルのまわりへもどる
      meeting: null,
      result: null,
      winner: null,
      winReason: '',
    };
  }

  // 空気が止まったまま時間がきたら、ねむらせ屋の勝ち（時間で決まるので、checkWin とは別に now を見る）
  function checkAir(g, now) {
    if (g.winner) return true;
    if (g.air && now >= g.air) { g.winner = 'sleeper'; g.winReason = 'air'; return true; }
    return false;
  }

  const jobOf = (g, id) => (g.jobs && g.jobs[id]) || '';
  const shielded = (g, id, now) => Number((g.shield || {})[id]) > now;
  // 見た目のだれか（へんしん中は、なっている人）
  function looksAs(g, id, now) {
    const sh = (g.shape || {})[id];
    return sh && Number(sh.until) > now && g.players.includes(sh.as) ? sh.as : id;
  }

  // いまとじているドアの部屋
  const closedRooms = (g, now) => Object.keys(g.doors || {}).filter((key) => DOOR_ROOMS.includes(key) && Number(g.doors[key]) > now);

  const isAwake = (g, id) => !g.asleep[id];
  const hasLeft = (g, id) => !!(g.left && g.left[id]);
  // おきていて、抜けていない人
  const awakeOf = (g, role) => g.players.filter((id) => isAwake(g, id) && !hasLeft(g, id) && (!role || g.roles[id] === role));

  // 抜けた人の仕事は、おわらせた分だけ数える（のこりは全体の数から外す）
  function taskProgress(g) {
    let done = 0;
    let total = 0;
    g.players.forEach((id) => {
      if (g.roles[id] !== 'crew') return;
      const gone = hasLeft(g, id);
      g.tasks[id].forEach((t) => {
        if (t.done) { done++; total++; } else if (!gone) total++;
      });
    });
    return { done, total };
  }

  // 勝ち負けが決まったら winner を入れて true
  function checkWin(g) {
    if (g.winner) return true;
    const sleepers = awakeOf(g, 'sleeper').length;
    const crew = awakeOf(g, 'crew').length;
    const tp = taskProgress(g);
    if (sleepers === 0) {
      // 全員を投票やねむらせで見つけたときだけ「見つけた」。ひとりでも抜けていれば「いなくなった」
      const found = g.players.every((id) => g.roles[id] !== 'sleeper' || (!isAwake(g, id) && !hasLeft(g, id)));
      g.winner = 'crew';
      g.winReason = found ? 'found' : 'left';
      return true;
    }
    if (tp.total > 0 && tp.done >= tp.total) { g.winner = 'crew'; g.winReason = 'tasks'; return true; }
    if (sleepers >= crew) { g.winner = 'sleeper'; g.winReason = 'outnumber'; return true; }
    return false;
  }

  // 票を数える。votes＝{投票した人: 相手の id | skip}。いちばん多い1人だけがねむる（同じ数・スキップが多いときは、だれもねむらない）
  function tally(votes, skip = 'skip') {
    const counts = {};
    Object.values(votes).forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
    let top = null;
    let max = 0;
    let tie = false;
    Object.keys(counts).forEach((k) => {
      if (counts[k] > max) { max = counts[k]; top = k; tie = false; }
      else if (counts[k] === max) tie = true;
    });
    const target = !top || tie || top === skip ? null : top;
    return { counts, target, tie: tie && max > 0 };
  }

  // 位置を送る形: "x,y,f"（座標×10の整数・向き 1＝右 0＝左・2＝近道の中で見えない）。通信を小さくするため短い文字列1つにする
  function encodePos(x, y, face, hidden) {
    return Math.round(x * 10) + ',' + Math.round(y * 10) + ',' + (hidden ? 2 : face < 0 ? 0 : 1);
  }
  function decodePos(text) {
    const m = /^(-?\d{1,4}),(-?\d{1,4}),([012])$/.exec(String(text || ''));
    if (!m) return null;
    const x = Number(m[1]) / 10;
    const y = Number(m[2]) / 10;
    if (x < 0 || y < 0 || x > W || y > H) return null;
    return { x, y, face: m[3] === '0' ? -1 : 1, hidden: m[3] === '2' };
  }

  const api = {
    W, H, ROOMS, HALLS, HALL_FILL, SPOTS, FIX_SPOT, TABLE, VENTS, VENT_STAY_S, LADDERS, CLIMB_MS, CAM_STAND, CAMS, CAM_R, GRID, COLORS,
    AIR_PANELS, AIR_LIMIT_S, PAIRS, PAIR_SPOT_BASE, PAIR_HOLD_MS, PAIR_BEAT_MS, DOORS, DOOR_ROOMS, DOOR_MS, DOOR_AGAIN_S, BUTTON_WAIT_S, FURNITURE,
    SPEED, RADIUS, USE_RANGE, SLEEP_RANGE, FIND_RANGE, VIEW, VIEW_RAYS, VIEW_OVER,
    JOB_NAMES, ENGINEER_GAP_S, WATCH_BATTERY_S, WATCH_CHARGE_S, SHIELD_S, ANGEL_GAP_S, ANGEL_RANGE, SHIFT_S, SHIFT_GAP_S,
    jobOf, shielded, looksAs,
    GAME_LIMIT_S, MIN_PLAYERS, MAX_PLAYERS, TWO_SLEEPERS_MIN, DEFAULT_SETTINGS, SETTING_OPTS,
    isFloor, dist, roomAt, roomName, canStand, step, stepFree, path, rayDist, canSee, viewPolygon, spawnPoint, encodePos, decodePos,
    doorTiles, tileKey, spotInfo, pairOf, pairFresh, closedRooms, checkAir,
    shuffled, sleeperCount, newGame, isAwake, hasLeft, awakeOf, taskProgress, checkWin, tally,
    SAYS, SAY_GAP_MS, SAY_SHOW_MS, SAY_LOG_MAX, HALL_LABEL, sayPhrase, sayAllowed, sayText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NemuraseEngine = api;
})(typeof window !== 'undefined' ? window : this);
