/* ねむらせ基地 — マップとルールだけ。画面にも通信にも触らない。
   座標の単位はマス（1マス＝1）。人の位置はマスの中の小数で持つ（マス (3,4) の真ん中は 3.5, 4.5）。
   ブラウザでは window.NemuraseEngine、node では module.exports。 */
(function (root) {
  'use strict';

  // ── マップ1: ひみつ基地（settings.map 0）──
  function kichiMap() {
  // 2026-10-29 子どもの要望の第3便「マップを広く・部屋と通路を増やす・部屋を広く覚えやすい形に・監視室」で 44×30（9部屋）→ 64×43（13部屋）に作りなおした。
  // 同日夕「もうちょいマップ拡張」→ オーナー決定「縦横1.3倍・部屋18ほど」で 84×56・18部屋に（屋根うら・トレーニング室・ガレージ・シャワー室を足した）。
  // 部屋は 5列×4段（列 x2-13 / 19-30 / 36-51 / 57-68 / 74-81、段 y2-10 / 15-24 / 29-38 / 43-53）。ひろばはまん中の列の2段ぶんの十字
  const W = 84;
  const H = 56;

  // 部屋（x, y, 幅, 高さ）。fill は床の色。part: true は同じ部屋の続き（L字・T字・十字の形を四角の組み合わせで作る。名前は最初の四角に書く）
  const ROOMS = [
    { key: 'kitchen', name: '台所', x: 2, y: 2, w: 12, h: 9, fill: '#F6E7D2' },
    { key: 'kitchen', part: true, x: 2, y: 11, w: 6, h: 2, fill: '#F6E7D2' },       // L字（左下へのびる）
    { key: 'radio', name: '通信室', x: 19, y: 2, w: 12, h: 9, fill: '#DDE9F3' },
    { key: 'monitor', name: '監視室', x: 39, y: 2, w: 10, h: 8, fill: '#D5DCE6' },
    { key: 'farm', name: '畑', x: 57, y: 2, w: 12, h: 9, fill: '#E2EFD6' },
    { key: 'farm', part: true, x: 60, y: 11, w: 6, h: 2, fill: '#E2EFD6' },         // T字（まん中から下へ）
    { key: 'lounge', name: '休けい室', x: 2, y: 15, w: 12, h: 10, fill: '#F1E2EA' },
    { key: 'laundry', name: '洗たく室', x: 19, y: 15, w: 12, h: 10, fill: '#DCEEF2' },
    { key: 'plaza', name: 'ひろば', x: 34, y: 22, w: 20, h: 10, fill: '#F3EFE6' },
    { key: 'plaza', part: true, x: 38, y: 15, w: 12, h: 24, fill: '#F3EFE6' },      // 十字（テーブルがまん中）
    { key: 'store', name: '倉庫', x: 57, y: 15, w: 12, h: 10, fill: '#E9E1D8' },
    { key: 'gym', name: 'トレーニング室', x: 2, y: 29, w: 12, h: 10, fill: '#E3ECDD' },
    { key: 'garage', name: 'ガレージ', x: 57, y: 29, w: 12, h: 10, fill: '#E2E2E2' },
    { key: 'shower', name: 'シャワー室', x: 74, y: 29, w: 8, h: 10, fill: '#D8EEF6' },
    { key: 'pump', name: 'ポンプ室', x: 2, y: 43, w: 12, h: 11, fill: '#D9E4EE' },
    { key: 'tower', name: '見はり台', x: 36, y: 45, w: 18, h: 8, fill: '#E4E0F0' },   // 横に長い
    { key: 'playroom', name: 'ゲーム室', x: 57, y: 43, w: 16, h: 11, fill: '#F6DDE4' },
    // 行き止まりの小部屋（入口は1つ・ドアなし。2026-10-27 子どもの意見「マップに行き止まりがほしい」）
    { key: 'tools', name: '道具室', x: 27, y: 51, w: 6, h: 4, fill: '#EADFC8' },     // ポンプ室↔見はり台の通路の下
    { key: 'green', name: '温室', x: 75, y: 16, w: 6, h: 6, fill: '#D6EEDD' },      // 倉庫の右
    { key: 'attic', name: '屋根うら', x: 75, y: 3, w: 6, h: 6, fill: '#EFE3D0' },    // 畑の右
    // 2026-10-29 子どもの要望「電気室を行き止まりに（ポンプ室と見はり台の間の通路の上）」。停電をなおすスイッチもここ
    { key: 'power', name: '電気室', x: 19, y: 36, w: 9, h: 8, fill: '#F4EBC6' },
  ];
  // 通路（部屋どうしをつなぐ床）
  const HALLS = [
    [14, 5, 5, 2], [31, 5, 8, 2], [49, 5, 8, 2], [69, 5, 6, 2],   // 台所↔通信室↔監視室↔畑↔屋根うら
    [4, 13, 2, 2], [24, 11, 2, 4], [43, 10, 2, 5], [62, 13, 2, 2], // 1段目↔2段目（休けい室・洗たく室・ひろば・倉庫）
    [14, 19, 5, 2], [31, 23, 3, 2], [54, 23, 3, 2], [69, 18, 6, 2], // 休けい室↔洗たく室↔ひろば↔倉庫↔温室
    [6, 25, 2, 4], [62, 25, 2, 4], [54, 29, 3, 2], [69, 33, 5, 2], // 休けい室↔トレーニング室・倉庫↔ガレージ↔ひろば・ガレージ↔シャワー室
    [6, 39, 2, 4], [43, 39, 2, 6], [62, 39, 2, 4],                 // トレーニング室↔ポンプ室・ひろば↔見はり台・ガレージ↔ゲーム室
    [77, 39, 2, 6], [73, 43, 4, 2],                                 // シャワー室↔ゲーム室（L字の通路）
    [14, 48, 22, 2], [54, 48, 3, 2],                                // ポンプ室↔見はり台↔ゲーム室
    [22, 44, 2, 4], [29, 50, 2, 1],                                 // 行き止まりへの通路（電気室・道具室）
  ];

  // 仕事の場所。kind: wire＝線をつなぐ / order＝番号を順に押す / meter＝メーターを合わせる。id は並び順（新しい場所は末尾に足す）
  const SPOTS = [
    { id: 0, room: 'kitchen', x: 4.5, y: 4.5, kind: 'order', label: 'お皿を順番にしまう' },
    { id: 1, room: 'kitchen', x: 12.5, y: 9.5, kind: 'meter', label: 'なべの火を合わせる' },
    { id: 2, room: 'radio', x: 25.5, y: 4.5, kind: 'wire', label: '通信の線をつなぐ' },
    { id: 3, room: 'radio', x: 29.5, y: 9.5, kind: 'order', label: 'アンテナの番号を押す' },
    { id: 4, room: 'farm', x: 59.5, y: 4.5, kind: 'meter', label: '水の量を合わせる' },
    { id: 5, room: 'farm', x: 61.5, y: 11.5, kind: 'order', label: 'たねを順番にまく' },
    { id: 6, room: 'power', x: 20.5, y: 39.5, kind: 'wire', label: '電線をつなぐ' },
    { id: 7, room: 'store', x: 58.5, y: 17.5, kind: 'order', label: '荷物を番号順にのせる' },
    { id: 8, room: 'store', x: 64.5, y: 23.5, kind: 'wire', label: 'ケーブルをつなぐ' },
    { id: 9, room: 'tower', x: 51.5, y: 47.5, kind: 'meter', label: '望遠鏡のピントを合わせる' },
    { id: 10, room: 'tower', x: 40.5, y: 51.5, kind: 'wire', label: 'ライトの線をつなぐ' },
    { id: 11, room: 'tools', x: 31.5, y: 53.5, kind: 'order', label: '道具を番号順にならべる' },
    { id: 12, room: 'green', x: 79.5, y: 20.5, kind: 'meter', label: '温室の温度を合わせる' },
    { id: 13, room: 'monitor', x: 47.5, y: 7.5, kind: 'wire', label: 'モニターの線をつなぐ' },
    { id: 14, room: 'laundry', x: 20.5, y: 18.5, kind: 'order', label: '洗たく物を番号順にたたむ' },
    { id: 15, room: 'pump', x: 3.5, y: 46.5, kind: 'meter', label: '水の強さを合わせる' },
    { id: 16, room: 'playroom', x: 64.5, y: 47.5, kind: 'order', label: 'ボールを番号順にしまう' },
    { id: 17, room: 'lounge', x: 9.5, y: 21.5, kind: 'order', label: 'クッションを番号順にならべる' },
    // 2026-10-29 夕 足した部屋
    { id: 18, room: 'attic', x: 79.5, y: 7.5, kind: 'wire', label: '屋根うらの電球の線をつなぐ' },
    { id: 19, room: 'gym', x: 9.5, y: 33.5, kind: 'meter', label: 'ランニングマシンの速さを合わせる' },
    { id: 20, room: 'garage', x: 65.5, y: 32.5, kind: 'wire', label: 'カートの電池の線をつなぐ' },
    { id: 21, room: 'shower', x: 79.5, y: 36.5, kind: 'meter', label: 'お湯の温度を合わせる' },
  ];
  const FIX_SPOT = { x: 26.5, y: 40.5 };    // 停電をなおすスイッチ（電気室。行き止まりの奥）
  const TABLE = { x: 44, y: 27, r: 1.6 };   // ひろばの会議テーブル（まるいので、ぶつかる）
  // 近道（ねむらせ屋・整備係が使える）。2026-10-26 ねむらせ屋を有利にする調整で追加。
  // 2026-10-29 子どもの要望「ベントで飛ぶ場所を選べるように」→ オーナー決定: 近道に入ると姿が消え（中にいられるのは VENT_STAY_S 秒まで）、
  // ほかのどこへでも、部屋の名前のボタンで選んで出られる（決まった組はなくした）。どれもちがう部屋にある（18部屋にしたとき10か所に）
  const VENTS = [
    { id: 0, x: 9.5, y: 6.5 },     // 台所
    { id: 1, x: 11.5, y: 23.5 },   // 休けい室
    { id: 2, x: 66.5, y: 8.5 },    // 畑
    { id: 3, x: 66.5, y: 20.5 },   // 倉庫
    { id: 4, x: 28.5, y: 22.5 },   // 洗たく室
    { id: 5, x: 11.5, y: 51.5 },   // ポンプ室
    { id: 6, x: 41.5, y: 7.5 },    // 監視室
    { id: 7, x: 70.5, y: 51.5 },   // ゲーム室
    { id: 8, x: 3.5, y: 36.5 },    // トレーニング室
    { id: 9, x: 59.5, y: 36.5 },   // ガレージ
  ];
  // はしご（だれでも使える。ねむった人も）。2026-10-28 子どもの意見「マップにギミック（はしご）」
  // 上に立って「はしごをおりる／のぼる」を押すと、CLIMB_MS のあいだその場に立ったまま（見える・ねむらせられる）で、to のはしごへ移る。
  // 通信室（画面の上）↔ 見はり台（画面の下）。隊員の移動が速くなる＝隊員が有利になる向き（近道はねむらせ屋だけ、はしごはみんな）
  const LADDERS = [
    { id: 0, x: 21.5, y: 10.0, to: 1, room: 'radio', label: 'はしごをおりる', busy: 'おりている…' },
    { id: 1, x: 37.5, y: 52.0, to: 0, room: 'tower', label: 'はしごをのぼる', busy: 'のぼっている…' },
  ];
  // 監視カメラ。2026-10-28 子どもの意見。カメラの台（CAM_STAND）に立って「カメラを見る」と、通路に置いたカメラ（CAMS）のまわり CAM_R マスの
  // 通路の部分だけが小窓に映る（部屋の中は映らない）。見ている間はその場から動けない。だれかが見ている間はカメラのランプが光る（ねむらせ屋が気づける）。停電中は映らない
  // 2026-10-29 子どもの要望「カメラルーム（監視室）がほしい」で、台を通信室から監視室へ移し、カメラを増やした（18部屋で8つ）
  const CAM_STAND = { x: 44, y: 3.0 };
  const CAMS = [
    { id: 0, x: 16.5, y: 6, name: '台所と通信室の間' },
    { id: 1, x: 35, y: 6, name: '通信室と監視室の間' },
    { id: 2, x: 53, y: 6, name: '監視室と畑の間' },
    { id: 3, x: 16.5, y: 20, name: '休けい室と洗たく室の間' },
    { id: 4, x: 44, y: 42, name: 'ひろばと見はり台の間' },
    { id: 5, x: 71.5, y: 34, name: 'ガレージとシャワー室の間' },
    { id: 6, x: 18, y: 49, name: 'ポンプ室と電気室の間' },
    { id: 7, x: 32, y: 49, name: '電気室と見はり台の間' },
  ];

  // ── 2026-10-28 子どもの要望の第2便（オーナー承認）──
  // 空気の妨害（ねむらせ屋）: 止めると AIR_LIMIT_S 秒のうちに、離れた2部屋のパネルを両方なおさないと ねむらせ屋の勝ち。
  // 「停電で負けることはない」をはじめて破る（オーナー「破ってもOK」）。集団でかたまって動くと間に合わない向きの仕組み
  const AIR_PANELS = [
    { id: 'a', room: 'kitchen', x: 12.5, y: 3.0, label: '台所の空気のパネル' },
    { id: 'b', room: 'store', x: 67.5, y: 16.5, label: '倉庫の空気のパネル' },
  ];
  // ふたりの仕事: 離れた2か所のスイッチを、ふたりが同時におしていないとおわらない。隊員はひとり1つ持つ（設定 pair で切れる）。
  // 2人組で動く理由を作る（集団を小さく割る向き）。おしている人は PAIR_HOLD_MS の間だけ「おしている」とみなす（2秒おきに書き直す）
  const PAIRS = [
    { id: 'p0', spot: 100, label: 'ふたりでスイッチを入れる', a: { room: 'lounge', x: 3.5, y: 17.5 }, b: { room: 'farm', x: 67.5, y: 3.5 } },
    { id: 'p1', spot: 101, label: 'ふたりでレバーを引く', a: { room: 'kitchen', x: 3.5, y: 11.5 }, b: { room: 'tower', x: 52.5, y: 51.5 } },
  ];
  // ドア（ねむらせ屋）: 部屋を選ぶと、その部屋の入口がぜんぶ DOOR_MS の間とじる（見えるが通れない）。集団を分ける向き。ひろばにはドアがない（テーブルにいつでも行けるように）
  // ドアは、その部屋につながる通路の、部屋に接する1列
  const DOORS = [
    { room: 'kitchen', x: 14, y: 5, w: 1, h: 2 }, { room: 'kitchen', x: 4, y: 13, w: 2, h: 1 },
    { room: 'radio', x: 18, y: 5, w: 1, h: 2 }, { room: 'radio', x: 31, y: 5, w: 1, h: 2 }, { room: 'radio', x: 24, y: 11, w: 2, h: 1 },
    { room: 'monitor', x: 38, y: 5, w: 1, h: 2 }, { room: 'monitor', x: 49, y: 5, w: 1, h: 2 }, { room: 'monitor', x: 43, y: 10, w: 2, h: 1 },
    { room: 'farm', x: 56, y: 5, w: 1, h: 2 }, { room: 'farm', x: 69, y: 5, w: 1, h: 2 }, { room: 'farm', x: 62, y: 13, w: 2, h: 1 },
    { room: 'lounge', x: 4, y: 14, w: 2, h: 1 }, { room: 'lounge', x: 14, y: 19, w: 1, h: 2 }, { room: 'lounge', x: 6, y: 25, w: 2, h: 1 },
    { room: 'laundry', x: 24, y: 14, w: 2, h: 1 }, { room: 'laundry', x: 18, y: 19, w: 1, h: 2 }, { room: 'laundry', x: 31, y: 23, w: 1, h: 2 },
    { room: 'store', x: 62, y: 14, w: 2, h: 1 }, { room: 'store', x: 69, y: 18, w: 1, h: 2 }, { room: 'store', x: 56, y: 23, w: 1, h: 2 }, { room: 'store', x: 62, y: 25, w: 2, h: 1 },
    { room: 'gym', x: 6, y: 28, w: 2, h: 1 }, { room: 'gym', x: 6, y: 39, w: 2, h: 1 },
    { room: 'garage', x: 62, y: 28, w: 2, h: 1 }, { room: 'garage', x: 56, y: 29, w: 1, h: 2 }, { room: 'garage', x: 69, y: 33, w: 1, h: 2 }, { room: 'garage', x: 62, y: 39, w: 2, h: 1 },
    { room: 'shower', x: 73, y: 33, w: 1, h: 2 }, { room: 'shower', x: 77, y: 39, w: 2, h: 1 },
    { room: 'pump', x: 6, y: 42, w: 2, h: 1 }, { room: 'pump', x: 14, y: 48, w: 1, h: 2 },
    { room: 'tower', x: 43, y: 44, w: 2, h: 1 }, { room: 'tower', x: 35, y: 48, w: 1, h: 2 }, { room: 'tower', x: 54, y: 48, w: 1, h: 2 },
    { room: 'playroom', x: 62, y: 42, w: 2, h: 1 }, { room: 'playroom', x: 73, y: 43, w: 1, h: 2 }, { room: 'playroom', x: 56, y: 48, w: 1, h: 2 },
  ];
  // 行き止まりの小部屋（道具室・温室・屋根うら・電気室）にはドアがない（とじこめないように）
  const DOOR_ROOMS = ['kitchen', 'radio', 'monitor', 'farm', 'lounge', 'laundry', 'store', 'gym', 'garage', 'shower', 'pump', 'tower', 'playroom'];
  // 会議ボタンの待ち時間: はじめと会議のあと BUTTON_WAIT_S 秒は押せない（はじまった直後の会議・会議の連続・追われたときの逃げ道をふせぐ）
  // 家具（部屋の目印。1マスのかべとして ぶつかる・かべごしに見えない）。x, y, w, h はマス。kind は描き方。
  // 2026-10-29 夕 子どもの要望「部屋の内装を部屋の名前に合わせて」で、部屋ごとに名前に合う物を3〜5個ずつ置いた
  const FURNITURE = [
    // 台所: コンロ・流し・冷蔵庫・食卓
    { room: 'kitchen', kind: 'fridge', x: 2, y: 2, w: 1, h: 2 }, { room: 'kitchen', kind: 'stove', x: 6, y: 2, w: 2, h: 1 }, { room: 'kitchen', kind: 'sink', x: 9, y: 2, w: 2, h: 1 },
    { room: 'kitchen', kind: 'table', x: 5, y: 7, w: 3, h: 1 }, { room: 'kitchen', kind: 'table', x: 9, y: 7, w: 2, h: 1 },
    // 通信室: アンテナ・無線機・机の画面
    { room: 'radio', kind: 'antenna', x: 30, y: 2, w: 1, h: 1 }, { room: 'radio', kind: 'radioset', x: 22, y: 2, w: 2, h: 1 }, { room: 'radio', kind: 'desk', x: 27, y: 2, w: 2, h: 1 }, { room: 'radio', kind: 'radioset', x: 25, y: 8, w: 2, h: 1 },
    // 監視室: モニターの机
    { room: 'monitor', kind: 'screen', x: 40, y: 2, w: 2, h: 1 }, { room: 'monitor', kind: 'screen', x: 46, y: 2, w: 2, h: 1 },
    // 畑: うね・かかし・水タンク
    { room: 'farm', kind: 'crops', x: 59, y: 7, w: 3, h: 1 }, { room: 'farm', kind: 'crops', x: 63, y: 7, w: 3, h: 1 }, { room: 'farm', kind: 'scarecrow', x: 62, y: 4, w: 1, h: 1 }, { room: 'farm', kind: 'tank', x: 68, y: 10, w: 1, h: 1 },
    // 屋根うら: 古い箱・宝箱・あかり
    { room: 'attic', kind: 'chest', x: 76, y: 3, w: 2, h: 1 }, { room: 'attic', kind: 'crate', x: 80, y: 4, w: 1, h: 1 }, { room: 'attic', kind: 'crate', x: 75, y: 8, w: 1, h: 1 },
    // 休けい室: ソファ・テレビ・低いテーブル・植木
    { room: 'lounge', kind: 'sofa', x: 6, y: 15, w: 3, h: 1 }, { room: 'lounge', kind: 'screen', x: 2, y: 20, w: 1, h: 2 }, { room: 'lounge', kind: 'table', x: 6, y: 19, w: 2, h: 1 }, { room: 'lounge', kind: 'plant', x: 13, y: 15, w: 1, h: 1 }, { room: 'lounge', kind: 'sofa', x: 10, y: 17, w: 2, h: 1 }, { room: 'lounge', kind: 'plant', x: 2, y: 15, w: 1, h: 1 },
    // 洗たく室: 洗たく機・かご
    { room: 'laundry', kind: 'washer', x: 19, y: 15, w: 2, h: 1 }, { room: 'laundry', kind: 'washer', x: 21, y: 15, w: 2, h: 1 }, { room: 'laundry', kind: 'basket', x: 29, y: 15, w: 1, h: 1 }, { room: 'laundry', kind: 'basket', x: 19, y: 24, w: 1, h: 1 }, { room: 'laundry', kind: 'washer', x: 23, y: 15, w: 2, h: 1 }, { room: 'laundry', kind: 'basket', x: 25, y: 19, w: 1, h: 1 },
    // ひろば: ソファ・植木
    { room: 'plaza', kind: 'sofa', x: 35, y: 31, w: 2, h: 1 }, { room: 'plaza', kind: 'plant', x: 38, y: 15, w: 1, h: 1 }, { room: 'plaza', kind: 'plant', x: 49, y: 38, w: 1, h: 1 }, { room: 'plaza', kind: 'plant', x: 53, y: 22, w: 1, h: 1 },
    // 倉庫: 荷物・たな・たる
    { room: 'store', kind: 'crate', x: 65, y: 15, w: 2, h: 1 }, { room: 'store', kind: 'crate', x: 57, y: 20, w: 1, h: 1 }, { room: 'store', kind: 'shelf', x: 68, y: 21, w: 1, h: 1 }, { room: 'store', kind: 'barrel', x: 60, y: 24, w: 1, h: 1 }, { room: 'store', kind: 'crate', x: 63, y: 19, w: 1, h: 1 },
    // 温室: 植木
    { room: 'green', kind: 'plant', x: 80, y: 16, w: 1, h: 1 }, { room: 'green', kind: 'plant', x: 76, y: 21, w: 1, h: 1 }, { room: 'green', kind: 'plant', x: 78, y: 16, w: 1, h: 1 },
    // トレーニング室: ランニングマシン・ダンベル・マット
    { room: 'gym', kind: 'treadmill', x: 2, y: 29, w: 2, h: 1 }, { room: 'gym', kind: 'treadmill', x: 10, y: 29, w: 2, h: 1 }, { room: 'gym', kind: 'weights', x: 12, y: 36, w: 2, h: 1 }, { room: 'gym', kind: 'mat', x: 5, y: 33, w: 2, h: 1 }, { room: 'gym', kind: 'mat', x: 9, y: 37, w: 2, h: 1 },
    // 電気室: 発電機・電池のたな
    { room: 'power', kind: 'generator', x: 19, y: 36, w: 2, h: 1 }, { room: 'power', kind: 'battery', x: 27, y: 36, w: 1, h: 2 },
    // ガレージ: カート・タイヤ・道具箱
    { room: 'garage', kind: 'cart', x: 58, y: 29, w: 3, h: 1 }, { room: 'garage', kind: 'tire', x: 68, y: 29, w: 1, h: 1 }, { room: 'garage', kind: 'toolbox', x: 68, y: 37, w: 1, h: 1 }, { room: 'garage', kind: 'cart', x: 59, y: 34, w: 3, h: 1 }, { room: 'garage', kind: 'tire', x: 68, y: 30, w: 1, h: 1 },
    // シャワー室: シャワー・タオルのたな
    { room: 'shower', kind: 'shower', x: 80, y: 29, w: 2, h: 1 }, { room: 'shower', kind: 'shower', x: 76, y: 29, w: 2, h: 1 }, { room: 'shower', kind: 'shelf', x: 74, y: 29, w: 1, h: 1 }, { room: 'shower', kind: 'basket', x: 74, y: 37, w: 1, h: 1 },
    // ポンプ室: ポンプ・タンク
    { room: 'pump', kind: 'pump', x: 8, y: 44, w: 2, h: 1 }, { room: 'pump', kind: 'tank', x: 2, y: 43, w: 1, h: 1 }, { room: 'pump', kind: 'tank', x: 4, y: 43, w: 1, h: 1 }, { room: 'pump', kind: 'pump', x: 3, y: 52, w: 2, h: 1 }, { room: 'pump', kind: 'tank', x: 10, y: 46, w: 1, h: 1 },
    // 見はり台: ライト・望遠鏡・ベンチ
    { room: 'tower', kind: 'light', x: 36, y: 45, w: 1, h: 1 }, { room: 'tower', kind: 'light', x: 53, y: 45, w: 1, h: 1 }, { room: 'tower', kind: 'telescope', x: 49, y: 45, w: 1, h: 1 }, { room: 'tower', kind: 'bench', x: 44, y: 52, w: 2, h: 1 }, { room: 'tower', kind: 'telescope', x: 40, y: 45, w: 1, h: 1 },
    // ゲーム室: ゲーム機・遊びのテーブル
    { room: 'playroom', kind: 'arcade', x: 58, y: 43, w: 2, h: 1 }, { room: 'playroom', kind: 'arcade', x: 66, y: 43, w: 2, h: 1 }, { room: 'playroom', kind: 'gametable', x: 60, y: 50, w: 3, h: 1 }, { room: 'playroom', kind: 'arcade', x: 70, y: 43, w: 2, h: 1 }, { room: 'playroom', kind: 'gametable', x: 66, y: 50, w: 3, h: 1 },
    // 道具室: たな・道具箱
    { room: 'tools', kind: 'shelf', x: 27, y: 51, w: 1, h: 1 }, { room: 'tools', kind: 'toolbox', x: 32, y: 51, w: 1, h: 1 },
  ];
    return { W, H, ROOMS, HALLS, SPOTS, FIX_SPOT, TABLE, VENTS, LADDERS, CAM_STAND, CAMS, AIR_PANELS, PAIRS, DOORS, DOOR_ROOMS, FURNITURE };
  }

  // ── マップ2: パーク（settings.map 1）──
  // 2026-10-29 子どもの要望「Metalife のカタリバパークのような空間でゲームがしたい」→ オーナー決定: 2つ目のマップとして足す・部屋の並びは正確に・
  // 部屋の名前はそのまま（マップの名前だけ独自の「パーク」）・ハロウィンの飾りとアバターは入れない・通りが悪い所はかべを取って通路にしてよい。
  // 2026-10-29 夜 オーナーの直し: 面談室→談話室・その上は小部屋・room-K作戦会議エリア→作戦会議エリア・スタッフルーム→ウェルカムセンター・MTGルーム4↔ソファ席エリアの通りぬけ・ワークスペース側とのかべをまっすぐ1本に。同じ夜の2回目: 小部屋の上のすき間をなくし小部屋と談話室を同じ大きさで並べる・作戦会議エリアの下の出っぱりをなくす・エントランスの左のかべをなくす・もくもく学習エリアとのんびりの左をかべにして縦をそろえる（x=56）・探Qルームのかべをなくす・休けい場所のかべをなくす（もくもく学習エリアとの境目は残す）・ウェルカムセンターと作品展示場の下のかべをそろえる。3回目: 小部屋の上（上の横の通りの左はし）も小部屋にし、談話室①②を同じ大きさ（5×3）に。
  // オーナーにもらったスクリーンショット（1138×792）を 1マス＝約13px で写した。名前のない場所（zoom の席が並ぶ所）は「ソファ席エリア」とした
  function parkMap() {
    const W = 87;
    const H = 60;
    const ROOMS = [
      { key: 'mokumoku', name: '黙々と作業する場所', x: 2, y: 2, w: 8, h: 16, fill: '#D9D6E4' },
      { key: 'main', name: 'メインルーム', x: 11, y: 2, w: 7, h: 8, fill: '#E9EEF5' },
      { key: 'mtg1', name: 'MTGルーム1', x: 19, y: 2, w: 6, h: 8, fill: '#E9EEF5' },
      { key: 'mtg2', name: 'MTGルーム2', x: 26, y: 2, w: 5, h: 8, fill: '#E9EEF5' },
      { key: 'mtg3', name: 'MTGルーム3', x: 32, y: 2, w: 5, h: 8, fill: '#E9EEF5' },
      { key: 'work', name: 'ワークスペース', x: 11, y: 11, w: 25, h: 10, fill: '#F0D9B5' },
      { key: 'mtg4', name: 'MTGルーム4', x: 2, y: 22, w: 6, h: 4, fill: '#E9EEF5' },
      { key: 'mtg5', name: 'MTGルーム5', x: 9, y: 22, w: 4, h: 4, fill: '#F6EBB5' },
      { key: 'mtg6', name: 'MTGルーム6', x: 14, y: 22, w: 6, h: 4, fill: '#F6E3DA' },
      { key: 'mtg7', name: 'MTGルーム7', x: 21, y: 22, w: 5, h: 4, fill: '#E3EED5' },
      { key: 'mtg8', name: 'MTGルーム8', x: 27, y: 22, w: 4, h: 4, fill: '#F6E3DA' },
      { key: 'hiroba', name: 'みんなのひろば', x: 38, y: 2, w: 10, h: 11, fill: '#BFE3A5' },
      { key: 'club', name: 'クラブルーム', x: 49, y: 2, w: 9, h: 11, fill: '#FBEFB0' },
      { key: 'lounge', name: 'ラウンジルーム', x: 59, y: 2, w: 13, h: 11, fill: '#C9E39B' },
      { key: 'mine', name: 'マイクラルーム', x: 73, y: 2, w: 12, h: 11, fill: '#F3F4F7' },
      { key: 'koheya', name: '小部屋', x: 37, y: 14, w: 5, h: 4, fill: '#D9D2C7' },
      { key: 'mendan1', name: '談話室①', x: 37, y: 19, w: 5, h: 3, fill: '#F4E3EC' },
      { key: 'mendan2', name: '談話室②', x: 37, y: 23, w: 5, h: 3, fill: '#F4E3EC' },
      { key: 'rest', name: '休けい場所', x: 53, y: 18, w: 6, h: 13, fill: '#B5D8C0' },
      { key: 'numa', name: '学びの沼', x: 60, y: 19, w: 12, h: 12, fill: '#B9E6F2' },
      { key: 'study', name: 'スタディルーム', x: 73, y: 19, w: 12, h: 12, fill: '#F0D9B5' },
      { key: 'mokugaku', name: 'もくもく学習エリア', x: 57, y: 32, w: 28, h: 6, fill: '#F3EDE0' },
      { key: 'entrance', name: 'エントランス', x: 37, y: 30, w: 11, h: 8, fill: '#F2C9B8' },
      { key: 'gallery', name: '作品展示場', x: 17, y: 28, w: 6, h: 6, fill: '#F7F1E1' },
      { key: 'staff', name: 'ウェルカムセンター', x: 24, y: 28, w: 6, h: 6, fill: '#CDE8B0' },
      { key: 'zoom', name: 'ソファ席エリア', x: 2, y: 35, w: 34, h: 23, fill: '#F0D9B5' },
      { key: 'zoom', part: true, x: 2, y: 28, w: 14, h: 7, fill: '#F0D9B5' },
      { key: 'zoom', part: true, x: 31, y: 28, w: 5, h: 7, fill: '#F0D9B5' },
      { key: 'roomk', name: '作戦会議エリア', x: 38, y: 41, w: 13, h: 17, fill: '#E8F2DF' },
      { key: 'nonbiri', name: 'のんびり', x: 57, y: 41, w: 12, h: 13, fill: '#D8EFC9' },
      { key: 'tanq', name: '探Qルーム', x: 71, y: 41, w: 12, h: 13, fill: '#E3E6EC' },
    ];
    const HALLS = [
      [2, 19, 9, 3], [5, 18, 2, 1],                                 // 黙々と作業する場所の下（MTGルーム4・5へ）・その入口
      [3, 26, 2, 2],                                                // MTGルーム4 ↔ ソファ席エリア（通りぬけ）
      [13, 10, 2, 1], [21, 10, 2, 1], [28, 10, 2, 1], [33, 10, 2, 1], // メインルーム・MTGルーム1〜3 ↔ ワークスペース
      [16, 21, 2, 1], [23, 21, 2, 1], [28, 21, 2, 1],               // ワークスペース ↔ MTGルーム6〜8
      [32, 21, 4, 7], [36, 27, 7, 3], [36, 30, 1, 8],                               // ワークスペースの右（ウェルカムセンター横の通路）→ 下をまわってエントランスの上へ（かべは x=36 でまっすぐ）
      [43, 14, 42, 4], [43, 18, 10, 12],                            // 上の横の通り・まん中の通り
      [42, 15, 1, 2], [42, 19, 1, 2], [42, 23, 1, 2],               // 小部屋・談話室①② の入口（小部屋は上の通りの所まで。談話室①②は同じ大きさ）
      [44, 13, 2, 1], [52, 13, 2, 1], [64, 13, 2, 1], [78, 13, 2, 1], // みんなのひろば・クラブルーム・ラウンジルーム・マイクラルームの入口
      [65, 18, 2, 1], [78, 18, 2, 1],                               // 学びの沼・スタディルームの入口（上）。休けい場所は左と上のかべをなくした
      [66, 31, 2, 1], [79, 31, 2, 1],                               // 学びの沼・スタディルーム ↔ もくもく学習エリア（休けい場所との境目はかべのまま）
      [48, 30, 5, 1], [48, 31, 8, 7],                               // エントランスの右（もくもく学習エリアの左はかべ x=56）
      [36, 38, 49, 3], [36, 41, 2, 17], [51, 41, 5, 17],            // 下の横の通り・room-K作戦会議エリアの左右
      [69, 41, 2, 13], [83, 41, 2, 17], [56, 54, 29, 4],            // のんびりと探Qルームのまわり（のんびりの左もかべ x=56。探Qルームはかべなし）
      [19, 34, 2, 1], [26, 34, 2, 1],                               // 作品展示場・ウェルカムセンターの入口（下のかべをそろえた）
    ];
    const SPOTS = [
      { id: 0, room: 'mokumoku', x: 3.5, y: 8.5, kind: 'order', label: '机のライトを順番につける' },
      { id: 1, room: 'main', x: 14.5, y: 4.5, kind: 'wire', label: '大きな画面の線をつなぐ' },
      { id: 2, room: 'mtg1', x: 22.5, y: 4.5, kind: 'order', label: 'いすを番号順にならべる' },
      { id: 3, room: 'mtg2', x: 28.5, y: 4.5, kind: 'meter', label: '画面の明るさを合わせる' },
      { id: 4, room: 'mtg3', x: 34.5, y: 4.5, kind: 'wire', label: 'マイクの線をつなぐ' },
      { id: 5, room: 'work', x: 20.5, y: 18.5, kind: 'order', label: 'ふせんを順番にはる' },
      { id: 6, room: 'work', x: 31.5, y: 13.5, kind: 'meter', label: '部屋の明かりを合わせる' },
      { id: 7, room: 'mtg4', x: 4.5, y: 24.5, kind: 'wire', label: 'ノートパソコンの線をつなぐ' },
      { id: 8, room: 'mtg6', x: 17.5, y: 24.5, kind: 'order', label: 'クッションを番号順にならべる' },
      { id: 9, room: 'mtg7', x: 23.5, y: 24.5, kind: 'meter', label: 'スピーカーの音の大きさを合わせる' },
      { id: 10, room: 'hiroba', x: 44.5, y: 5.5, kind: 'meter', label: 'ブランコの高さを合わせる' },
      { id: 11, room: 'club', x: 53.5, y: 9.5, kind: 'order', label: 'ぬいぐるみを順番にならべる' },
      { id: 12, room: 'lounge', x: 61.5, y: 8.5, kind: 'meter', label: 'たき火の火を合わせる' },
      { id: 13, room: 'mine', x: 81.5, y: 8.5, kind: 'wire', label: 'パソコンの線をつなぐ' },
      { id: 14, room: 'mendan1', x: 39.5, y: 20.5, kind: 'order', label: 'いすを番号順にそろえる' },
      { id: 15, room: 'rest', x: 56.5, y: 27.5, kind: 'meter', label: 'ひまわりの水の量を合わせる' },
      { id: 16, room: 'numa', x: 62.5, y: 29.5, kind: 'wire', label: '池のポンプの線をつなぐ' },
      { id: 17, room: 'study', x: 82.5, y: 22.5, kind: 'order', label: '本を番号順にならべる' },
      { id: 18, room: 'mokugaku', x: 70.5, y: 35.5, kind: 'order', label: '机のライトを順番につける' },
      { id: 19, room: 'gallery', x: 20.5, y: 31.5, kind: 'order', label: '作品を番号順にかざる' },
      { id: 20, room: 'zoom', x: 10.5, y: 45.5, kind: 'wire', label: 'カメラの線をつなぐ' },
      { id: 21, room: 'zoom', x: 28.5, y: 53.5, kind: 'meter', label: 'ソファの高さを合わせる' },
      { id: 22, room: 'roomk', x: 44.5, y: 49.5, kind: 'order', label: 'ベンチを番号順にならべる' },
      { id: 23, room: 'nonbiri', x: 62.5, y: 47.5, kind: 'meter', label: 'ピアノの音を合わせる' },
      { id: 24, room: 'tanq', x: 76.5, y: 46.5, kind: 'wire', label: 'ホワイトボードのライトの線をつなぐ' },
      { id: 25, room: 'mendan2', x: 39.5, y: 24.5, kind: 'meter', label: 'へやの温度を合わせる' },
    ];
    const FIX_SPOT = { x: 28.5, y: 29.5 };   // 停電をなおすスイッチ（ウェルカムセンター。行き止まり）
    const TABLE = { x: 42.5, y: 34, r: 1.6 }; // エントランスの会議テーブル
    const VENTS = [
      { id: 0, x: 8.5, y: 16.5 },    // 黙々と作業する場所
      { id: 1, x: 12.5, y: 19.5 },   // ワークスペース
      { id: 2, x: 39.5, y: 11.5 },   // みんなのひろば
      { id: 3, x: 50.5, y: 11.5 },   // クラブルーム
      { id: 4, x: 70.5, y: 11.5 },   // ラウンジルーム
      { id: 5, x: 74.5, y: 11.5 },   // マイクラルーム
      { id: 6, x: 83.5, y: 29.5 },   // スタディルーム
      { id: 7, x: 3.5, y: 40.5 },    // ソファ席エリア
      { id: 8, x: 67.5, y: 52.5 },   // のんびり
      { id: 9, x: 80.5, y: 51.5 },   // 探Qルーム
    ];
    // すべり台（みんなのひろば）↔ はしご（作戦会議エリア）。ひみつ基地のはしごと同じしかけ
    const LADDERS = [
      { id: 0, x: 46.5, y: 10.0, to: 1, room: 'hiroba', label: 'すべり台ですべる', busy: 'すべっている…' },
      { id: 1, x: 44.5, y: 56.0, to: 0, room: 'roomk', label: 'はしごをのぼる', busy: 'のぼっている…' },
    ];
    const CAM_STAND = { x: 78.5, y: 3.0 };   // マイクラルーム（元の空間にも画面がならぶ）
    const CAMS = [
      { id: 0, x: 34.5, y: 24, name: 'ワークスペースの右' },
      { id: 1, x: 47.5, y: 24, name: 'まん中の通り' },
      { id: 2, x: 51, y: 34, name: 'エントランスの右' },
      { id: 3, x: 53.5, y: 47, name: 'のんびりの左' },
      { id: 4, x: 63, y: 56.5, name: 'のんびりの下' },
      { id: 5, x: 77, y: 56.5, name: '探Qルームの下' },
    ];
    const AIR_PANELS = [
      { id: 'a', room: 'club', x: 56.5, y: 3.0, label: 'クラブルームの空気のパネル' },
      { id: 'b', room: 'zoom', x: 3.5, y: 56.5, label: 'ソファ席エリアの空気のパネル' },
    ];
    const PAIRS = [
      { id: 'p0', spot: 100, label: 'ふたりでスイッチを入れる', a: { room: 'mokumoku', x: 3.5, y: 3.5 }, b: { room: 'tanq', x: 80.5, y: 43.5 } },
      { id: 'p1', spot: 101, label: 'ふたりでレバーを引く', a: { room: 'hiroba', x: 39.5, y: 3.5 }, b: { room: 'zoom', x: 34.5, y: 56.5 } },
    ];
    const DOORS = [
    { room: 'mokumoku', x: 5, y: 18, w: 2, h: 1 },
    { room: 'hiroba', x: 44, y: 13, w: 2, h: 1 },
    { room: 'club', x: 52, y: 13, w: 2, h: 1 },
    { room: 'lounge', x: 64, y: 13, w: 2, h: 1 },
    { room: 'mine', x: 78, y: 13, w: 2, h: 1 },
    { room: 'numa', x: 65, y: 18, w: 2, h: 1 }, { room: 'numa', x: 66, y: 31, w: 2, h: 1 },
    { room: 'study', x: 78, y: 18, w: 2, h: 1 }, { room: 'study', x: 79, y: 31, w: 2, h: 1 },
  ];
    // ドアは、かべで囲まれた部屋だけ（行き止まりの小部屋・ひらけた場所にはない）
    const DOOR_ROOMS = ['mokumoku', 'hiroba', 'club', 'lounge', 'mine', 'numa', 'study'];
    const FURNITURE = [
      // じゅうたん（床。歩ける。floor: true）。ワークスペースの4色・エントランスの赤・のんびりの緑
      { room: 'work', kind: 'rug', floor: true, x: 11, y: 13, w: 5, h: 8, color: '#5B8DD6', label: 'キッカケ' },
      { room: 'work', kind: 'rug', floor: true, x: 16, y: 13, w: 5, h: 8, color: '#E2675B', label: 'room-K' },
      { room: 'work', kind: 'rug', floor: true, x: 21, y: 13, w: 5, h: 8, color: '#F1D25A' },
      { room: 'work', kind: 'rug', floor: true, x: 26, y: 13, w: 10, h: 8, color: '#7B4FA8' },
      { room: 'entrance', kind: 'rug', floor: true, x: 38, y: 31, w: 9, h: 6, color: '#C9473C' },
      { room: 'nonbiri', kind: 'rug', floor: true, x: 59, y: 43, w: 8, h: 8, color: '#5DB25F' },
      // 黙々と作業する場所: 机がならぶ
      { room: 'mokumoku', kind: 'desk', x: 6, y: 3, w: 2, h: 1 }, { room: 'mokumoku', kind: 'desk', x: 6, y: 7, w: 2, h: 1 }, { room: 'mokumoku', kind: 'desk', x: 6, y: 11, w: 2, h: 1 }, { room: 'mokumoku', kind: 'desk', x: 2, y: 13, w: 2, h: 1 },
      // メインルーム・MTGルーム1〜3: かべの画面と机
      { room: 'main', kind: 'screen', x: 12, y: 2, w: 2, h: 1 }, { room: 'main', kind: 'table', x: 13, y: 6, w: 3, h: 2 },
      { room: 'mtg1', kind: 'screen', x: 20, y: 2, w: 2, h: 1 }, { room: 'mtg1', kind: 'table', x: 21, y: 6, w: 2, h: 1 },
      { room: 'mtg2', kind: 'screen', x: 27, y: 2, w: 2, h: 1 }, { room: 'mtg2', kind: 'table', x: 27, y: 6, w: 2, h: 1 },
      { room: 'mtg3', kind: 'screen', x: 33, y: 2, w: 2, h: 1 }, { room: 'mtg3', kind: 'table', x: 33, y: 6, w: 2, h: 1 },
      // ワークスペース: じゅうたんの上の机・植木
      { room: 'work', kind: 'table', x: 12, y: 16, w: 3, h: 1 }, { room: 'work', kind: 'table', x: 17, y: 16, w: 3, h: 1 }, { room: 'work', kind: 'table', x: 22, y: 16, w: 3, h: 1 }, { room: 'work', kind: 'table', x: 28, y: 16, w: 4, h: 1 },
      { room: 'work', kind: 'plant', x: 16, y: 11, w: 1, h: 1 }, { room: 'work', kind: 'plant', x: 25, y: 11, w: 1, h: 1 },
      // MTGルーム4〜8: 小さな机
      { room: 'mtg4', kind: 'table', x: 5, y: 22, w: 2, h: 1 }, { room: 'mtg5', kind: 'table', x: 10, y: 23, w: 2, h: 1 }, { room: 'mtg6', kind: 'table', x: 15, y: 23, w: 2, h: 1 },
      { room: 'mtg7', kind: 'table', x: 22, y: 23, w: 2, h: 1 }, { room: 'mtg8', kind: 'table', x: 28, y: 24, w: 2, h: 1 },
      // みんなのひろば: ブランコ・石の像・木
      { room: 'hiroba', kind: 'swing', x: 40, y: 7, w: 2, h: 1 }, { room: 'hiroba', kind: 'statue', x: 46, y: 2, w: 1, h: 1 }, { room: 'hiroba', kind: 'tree', x: 44, y: 9, w: 1, h: 1 },
      // クラブルーム: くまのぬいぐるみ・机
      { room: 'club', kind: 'bear', x: 51, y: 2, w: 1, h: 1 }, { room: 'club', kind: 'bear', x: 53, y: 2, w: 1, h: 1 }, { room: 'club', kind: 'table', x: 52, y: 5, w: 2, h: 2 },
      // ラウンジルーム: たき火・まるた・木
      { room: 'lounge', kind: 'campfire', x: 65, y: 6, w: 1, h: 1 }, { room: 'lounge', kind: 'log', x: 63, y: 5, w: 1, h: 2 }, { room: 'lounge', kind: 'log', x: 67, y: 5, w: 1, h: 2 },
      { room: 'lounge', kind: 'tree', x: 59, y: 2, w: 1, h: 1 }, { room: 'lounge', kind: 'tree', x: 71, y: 2, w: 1, h: 1 },
      // マイクラルーム: パソコンの机・ソファ・画面
      { room: 'mine', kind: 'desk', x: 75, y: 2, w: 2, h: 1 }, { room: 'mine', kind: 'desk', x: 81, y: 2, w: 2, h: 1 }, { room: 'mine', kind: 'sofa', x: 77, y: 7, w: 3, h: 1 }, { room: 'mine', kind: 'screen', x: 84, y: 5, w: 1, h: 2 },
      // 上の横の通りのけいじ板
      { room: '', kind: 'board', x: 46, y: 14, w: 2, h: 1 }, { room: '', kind: 'board', x: 57, y: 14, w: 2, h: 1 }, { room: '', kind: 'board', x: 70, y: 14, w: 2, h: 1 },
      // 小部屋: まるい机・談話室①②: 植木
      { room: 'koheya', kind: 'stool', x: 39, y: 15, w: 1, h: 1 }, { room: 'koheya', kind: 'plant', x: 37, y: 14, w: 1, h: 1 }, { room: 'mendan1', kind: 'plant', x: 37, y: 21, w: 1, h: 1 }, { room: 'mendan2', kind: 'plant', x: 37, y: 25, w: 1, h: 1 },
      // 休けい場所: ひまわり・植木
      { room: 'rest', kind: 'flower', x: 54, y: 24, w: 1, h: 1 }, { room: 'rest', kind: 'flower', x: 58, y: 24, w: 1, h: 1 }, { room: 'rest', kind: 'plant', x: 58, y: 20, w: 1, h: 1 },
      // 学びの沼: 池（まん中に十字の道）
      { room: 'numa', kind: 'pond', x: 61, y: 20, w: 4, h: 3 }, { room: 'numa', kind: 'pond', x: 68, y: 20, w: 3, h: 3 }, { room: 'numa', kind: 'pond', x: 61, y: 26, w: 4, h: 2 }, { room: 'numa', kind: 'pond', x: 68, y: 26, w: 3, h: 3 },
      // スタディルーム: 大きな机・本だな
      { room: 'study', kind: 'table', x: 76, y: 23, w: 6, h: 4 }, { room: 'study', kind: 'shelf', x: 73, y: 19, w: 1, h: 1 }, { room: 'study', kind: 'shelf', x: 84, y: 19, w: 1, h: 1 },
      // もくもく学習エリア: かべぞいの机
      { room: 'mokugaku', kind: 'desk', x: 58, y: 32, w: 2, h: 1 }, { room: 'mokugaku', kind: 'desk', x: 62, y: 32, w: 2, h: 1 }, { room: 'mokugaku', kind: 'desk', x: 72, y: 32, w: 2, h: 1 },
      { room: 'mokugaku', kind: 'desk', x: 76, y: 32, w: 2, h: 1 }, { room: 'mokugaku', kind: 'desk', x: 82, y: 32, w: 2, h: 1 },
      // 作品展示場: がく・ウェルカムセンター: ベンチ・植木
      { room: 'gallery', kind: 'frame', x: 17, y: 28, w: 2, h: 1 }, { room: 'gallery', kind: 'frame', x: 21, y: 28, w: 2, h: 1 }, { room: 'gallery', kind: 'frame', x: 17, y: 31, w: 1, h: 1 },
      { room: 'staff', kind: 'bench', x: 24, y: 28, w: 2, h: 1 }, { room: 'staff', kind: 'plant', x: 24, y: 32, w: 1, h: 1 },
      // ソファ席エリア: ならんだ机・まわりのソファ
      { room: 'zoom', kind: 'table', x: 8, y: 38, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 14, y: 38, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 20, y: 38, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 26, y: 38, w: 2, h: 1 },
      { room: 'zoom', kind: 'table', x: 14, y: 42, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 20, y: 42, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 26, y: 42, w: 2, h: 1 },
      { room: 'zoom', kind: 'table', x: 14, y: 46, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 20, y: 46, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 26, y: 46, w: 2, h: 1 },
      { room: 'zoom', kind: 'table', x: 8, y: 50, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 14, y: 50, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 20, y: 50, w: 2, h: 1 },
      { room: 'zoom', kind: 'table', x: 8, y: 54, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 14, y: 54, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 20, y: 54, w: 2, h: 1 },
      { room: 'zoom', kind: 'table', x: 8, y: 30, w: 2, h: 1 }, { room: 'zoom', kind: 'table', x: 12, y: 30, w: 2, h: 1 },
      { room: 'zoom', kind: 'sofa', x: 2, y: 31, w: 2, h: 1 }, { room: 'zoom', kind: 'sofa', x: 2, y: 45, w: 2, h: 1 }, { room: 'zoom', kind: 'sofa', x: 2, y: 51, w: 2, h: 1 },
      { room: 'zoom', kind: 'sofa', x: 31, y: 45, w: 3, h: 1 }, { room: 'zoom', kind: 'sofa', x: 17, y: 57, w: 3, h: 1 }, { room: 'zoom', kind: 'sofa', x: 31, y: 51, w: 3, h: 1 },
      // 作戦会議エリア: 緑のベンチ
      { room: 'roomk', kind: 'bench', x: 40, y: 43, w: 4, h: 1 }, { room: 'roomk', kind: 'bench', x: 46, y: 43, w: 4, h: 1 }, { room: 'roomk', kind: 'bench', x: 40, y: 53, w: 4, h: 1 }, { room: 'roomk', kind: 'bench', x: 46, y: 53, w: 4, h: 1 },
      { room: 'roomk', kind: 'bench', x: 39, y: 46, w: 1, h: 4 }, { room: 'roomk', kind: 'bench', x: 49, y: 46, w: 1, h: 4 },
      // のんびり: ピアノ・ソファ
      { room: 'nonbiri', kind: 'piano', x: 57, y: 41, w: 2, h: 1 }, { room: 'nonbiri', kind: 'sofa', x: 61, y: 41, w: 3, h: 1 }, { room: 'nonbiri', kind: 'sofa', x: 63, y: 52, w: 3, h: 1 },
      // 探Qルーム: まるくならんだいす・ホワイトボード
      { room: 'tanq', kind: 'stool', x: 74, y: 44, w: 1, h: 1 }, { room: 'tanq', kind: 'stool', x: 74, y: 48, w: 1, h: 1 }, { room: 'tanq', kind: 'stool', x: 74, y: 51, w: 1, h: 1 },
      { room: 'tanq', kind: 'stool', x: 79, y: 48, w: 1, h: 1 }, { room: 'tanq', kind: 'stool', x: 79, y: 51, w: 1, h: 1 }, { room: 'tanq', kind: 'board', x: 76, y: 42, w: 2, h: 1 },
    ];
    return { W, H, ROOMS, HALLS, SPOTS, FIX_SPOT, TABLE, VENTS, LADDERS, CAM_STAND, CAMS, AIR_PANELS, PAIRS, DOORS, DOOR_ROOMS, FURNITURE };
  }

  // ── どのマップでも同じ数字 ──
  const HALL_FILL = '#E6E3DC';
  const VENT_STAY_S = 10;
  const CLIMB_MS = 2500;
  const CAM_R = 2.5;
  const AIR_LIMIT_S = 60;
  const PAIR_SPOT_BASE = 100;
  const PAIR_HOLD_MS = 6000;
  const PAIR_BEAT_MS = 2000;
  const DOOR_MS = 10000;
  const DOOR_AGAIN_S = 20;
  const BUTTON_WAIT_S = 20;

  // ── マップの切りかえ（2026-10-29 子どもの要望「カタリバパークのような空間で遊びたい」→ オーナー決定: 2つ目のマップ「パーク」を足し、待合室で選ぶ）──
  // マップの中身（W・H・ROOMS など）は useMap(key) で入れかわる。ゲームの中では settings.map（0＝ひみつ基地・1＝パーク）で決める
  const MAPS = { kichi: kichiMap(), park: parkMap() };
  const MAP_KEYS = ['kichi', 'park'];
  const MAP_NAMES = { kichi: 'ひみつ基地', park: 'パーク' };
  let W, H, ROOMS, HALLS, SPOTS, FIX_SPOT, TABLE, VENTS, LADDERS, CAM_STAND, CAMS, AIR_PANELS, PAIRS, DOORS, DOOR_ROOMS, FURNITURE;
  let mapKey = '';

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
  const DEFAULT_SETTINGS = { hostPlays: 1, sleepers: 1, tasks: 4, cooldown: 20, meeting: 90, buttons: 1, pick: 0, pair: 1, gauge: 2, engineer: 0, watcher: 0, angel: 0, shifter: 0, map: 1 };   // map: 0＝ひみつ基地・1＝パーク（2026-10-29。はじめはパーク＝オーナー決定）
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
    map: [0, 1],
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
      { k: 'power', t: '{fix}に来て' },   // {fix} は停電をなおすスイッチのある部屋（ひみつ基地は電気室・パークはウェルカムセンター）
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
    return p.t.replace('{room}', roomLabel || HALL_LABEL).replace('{name}', nameLabel || '').replace('{fix}', fixRoomName());
  }
  // 停電をなおすスイッチのある部屋の名前（マップでちがう）
  const fixRoomName = () => roomName(roomAt(FIX_SPOT.x, FIX_SPOT.y));

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
    // floor: true はじゅうたん（床の上の飾り。歩ける。2026-10-29 パーク）
    FURNITURE.forEach((f) => { if (f.floor) return; for (let yy = f.y; yy < f.y + f.h; yy++) for (let xx = f.x; xx < f.x + f.w; xx++) g[yy][xx] = 0; });
    return g;
  }
  let GRID = [];

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
    useMap(s.map);   // 仕事の場所はマップで決まる
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
    jobOf, shielded, looksAs, fixRoomName,
    GAME_LIMIT_S, MIN_PLAYERS, MAX_PLAYERS, TWO_SLEEPERS_MIN, DEFAULT_SETTINGS, SETTING_OPTS,
    isFloor, dist, roomAt, roomName, canStand, step, stepFree, path, rayDist, canSee, viewPolygon, spawnPoint, encodePos, decodePos,
    doorTiles, tileKey, spotInfo, pairOf, pairFresh, closedRooms, checkAir,
    shuffled, sleeperCount, newGame, isAwake, hasLeft, awakeOf, taskProgress, checkWin, tally,
    SAYS, SAY_GAP_MS, SAY_SHOW_MS, SAY_LOG_MAX, HALL_LABEL, sayPhrase, sayAllowed, sayText,
  };
  // マップを入れかえる（key は 'kichi'|'park'、または settings.map の数字）。api の中身も入れかえる
  function useMap(key) {
    const k = typeof key === 'number' ? MAP_KEYS[key] || 'kichi' : MAPS[key] ? key : 'kichi';
    if (k === mapKey) return k;
    const m = MAPS[k];
    ({ W, H, ROOMS, HALLS, SPOTS, FIX_SPOT, TABLE, VENTS, LADDERS, CAM_STAND, CAMS, AIR_PANELS, PAIRS, DOORS, DOOR_ROOMS, FURNITURE } = m);
    mapKey = k;
    GRID = buildGrid();
    Object.assign(api, { W, H, ROOMS, HALLS, SPOTS, FIX_SPOT, TABLE, VENTS, LADDERS, CAM_STAND, CAMS, AIR_PANELS, PAIRS, DOORS, DOOR_ROOMS, FURNITURE, GRID });
    return k;
  }
  api.useMap = useMap;
  api.mapKey = () => mapKey;
  api.MAP_KEYS = MAP_KEYS;
  api.MAP_NAMES = MAP_NAMES;
  useMap('kichi');
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NemuraseEngine = api;
})(typeof window !== 'undefined' ? window : this);
