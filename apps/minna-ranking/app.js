// みんなでランキング アプリロジック
// 共通モジュール: copyToClipboard (M-2), escapeHtml, showToast
import { copyToClipboard, escapeHtml, showToast } from '../shared/js/utils.js';

// 自由入力の DOM 挿入は必ず esc() を通す（AGENTS.md XSS 対策）
const esc = escapeHtml;

// ── 制約 ──
const MAX_TOPIC_LEN = 30;   // 自由入力お題の最大文字数
const MAX_ITEM_LEN = 15;    // アイテムの最大文字数
const CREATE_MAX_ITEMS = 8; // 「じぶんたちでつくる」のアイテム欄数
const MAX_TOTAL_ITEMS = 12; // ランキング中＋ランクがいの合計上限

// ── プリセットお題（ものごとを楽しく並べるお題のみ）──
const TOPICS = [
  // たべもの
  { title: 'コンビニおにぎりの具', items: ['ツナマヨ', 'さけ', 'うめ', 'こんぶ', '明太子', 'たまご', 'おかか'] },
  { title: 'アイスのフレーバー', items: ['バニラ', 'チョコ', 'ストロベリー', '抹茶', 'クッキー&クリーム', 'ソーダ', 'キャラメル'] },
  { title: 'おでんの具', items: ['たまご', '大根', 'もち巾着', 'ちくわ', 'こんにゃく', 'はんぺん', '牛すじ'] },
  { title: '最強の朝ごはん', items: ['たまごかけごはん', 'トースト', 'パンケーキ', 'おにぎり', 'シリアル', 'フレンチトースト', 'ヨーグルト'] },
  { title: 'パン屋さんのパン', items: ['メロンパン', 'クリームパン', 'カレーパン', 'あんパン', 'チョココロネ', '焼きそばパン', 'クロワッサン'] },
  { title: 'ラーメンの味', items: ['しょうゆ', 'みそ', 'とんこつ', 'しお', '担々麺', '鶏白湯'] },
  { title: 'おすしのネタ', items: ['サーモン', 'まぐろ', 'えび', 'いくら', 'たまご', 'はまち', 'ツナマヨ軍艦'] },
  { title: 'からあげのおとも', items: ['レモン', 'マヨネーズ', 'そのままがいい', 'しお', 'タルタルソース', 'ケチャップ'] },
  { title: 'お鍋の種類', items: ['すき焼き', 'しゃぶしゃぶ', 'キムチ鍋', '水炊き', 'もつ鍋', 'カレー鍋', 'チーズ鍋'] },
  { title: 'ジュース・ドリンク', items: ['オレンジジュース', 'りんごジュース', 'メロンソーダ', 'コーラ', 'カルピス', 'レモネード', 'ぶどうジュース'] },
  { title: 'お祭りの屋台グルメ', items: ['たこ焼き', 'かき氷', 'りんごあめ', '焼きそば', 'チョコバナナ', 'わたあめ', 'フランクフルト'] },
  { title: 'ピザのトッピング', items: ['チーズもりもり', 'てりやきチキン', 'コーン', 'ソーセージ', 'パイナップル', 'ベーコン', 'フレッシュトマト'] },
  { title: 'カレーに入れたい具', items: ['じゃがいも', 'にんじん', '玉ねぎ', 'ビーフ', 'チキン', 'チーズ', 'ゆでたまご'] },
  { title: 'ファミレスでたのみたいメニュー', items: ['ハンバーグ', 'オムライス', 'パフェ', 'ドリア', 'スパゲッティ', 'フライドポテト', 'ピザ'] },
  { title: 'おやつの定番', items: ['ポテトチップス', 'チョコレート', 'グミ', 'クッキー', 'せんべい', 'プリン', 'ドーナツ'] },
  { title: '和スイーツ', items: ['みたらしだんご', 'いちご大福', 'どらやき', 'たいやき', 'わらびもち', 'カステラ'] },
  { title: 'フルーツ', items: ['いちご', 'もも', 'ぶどう', 'りんご', 'みかん', 'スイカ', 'バナナ', 'マンゴー'] },
  { title: 'コンビニスイーツ', items: ['シュークリーム', 'プリン', 'ロールケーキ', 'チーズケーキ', 'エクレア', 'フルーツサンド', '大福'] },
  { title: '回転寿司のサイドメニュー', items: ['ラーメン', 'フライドポテト', 'プリン', 'ケーキ', '茶わんむし', 'うどん', 'からあげ'] },
  { title: 'たき火で焼いたらおいしそうなもの', items: ['マシュマロ', 'さつまいも', 'ソーセージ', 'とうもろこし', 'おもち', 'チーズ'] },
  { title: '自動販売機で売ってたらうれしいもの', items: ['ラーメン', 'ソフトクリーム', 'たこ焼き', 'ピザ', 'からあげ', 'ホットケーキ', 'おでん'] },
  { title: 'トーストにのせたいもの', items: ['バター', 'チーズ', 'はちみつ', 'ジャム', 'あんこ', 'ピザ風', 'チョコクリーム'] },

  // もしも・空想
  { title: 'ひみつ道具ほしい順', items: ['どこでもドア', 'タケコプター', 'タイムマシン', 'ほんやくコンニャク', 'スモールライト', 'もしもボックス', 'グルメテーブルかけ'] },
  { title: 'もしもの能力ほしい順', items: ['空を飛べる', 'とうめいになれる', '動物と話せる', '時間を止められる', '瞬間移動できる', '怪力になれる', '水中で息ができる'] },
  { title: 'ロボットにやってほしいこと', items: ['そうじ', '料理', '荷物もち', 'マッサージ', 'ゲームの対戦相手', 'おしゃべり相手', 'ペットの散歩'] },
  { title: '無人島に持っていくなら', items: ['ナイフ', 'ライター', 'なべ', 'つりざお', 'テント', '毛布', 'まんが全巻', 'ソーラー充電器'] },
  { title: 'タイムマシンで見に行きたい時代', items: ['恐竜時代', '原始時代', '江戸時代', '100年後の未来', '1000年後の未来', '恐竜がうまれる前の海'] },
  { title: 'じゃんけんに追加したら強そうな手', items: ['マグマ', '水', '竜巻', 'ロボット', 'ブラックホール', '忍者'] },
  { title: '飼ってみたい空想の生き物', items: ['ドラゴン', 'ユニコーン', 'フェニックス', 'ペガサス', 'マーメイド', '小さい妖精'] },
  { title: 'ポケットに入ってたらうれしいもの', items: ['1000円札', 'ラムネ', '四つ葉のクローバー', 'きれいな石', 'ガチャ用コイン', '小さいぬいぐるみ'] },

  // ばしょ・のりもの
  { title: '行ってみたい場所', items: ['宇宙', '深海', '南極', 'ジャングル', '雲の上', '恐竜のいた島', '無人島'] },
  { title: '住んでみたい家', items: ['ツリーハウス', 'お城', '地下基地', '船の家', '山小屋', 'タワーの最上階', '洞窟ハウス'] },
  { title: '行ってみたい世界の場所', items: ['ハワイ', 'ピラミッド', 'パリ', 'オーロラの北極圏', 'アマゾン', 'サンゴ礁の海', 'フィンランド'] },
  { title: 'のってみたい乗り物', items: ['気球', '潜水艦', '寝台列車', 'ヘリコプター', '豪華客船', '犬ぞり', 'ロケット'] },
  { title: '遊園地のアトラクション', items: ['ジェットコースター', '観覧車', 'メリーゴーラウンド', 'コーヒーカップ', 'ゴーカート', '巨大迷路', '急流すべり'] },

  // いきもの
  { title: 'ペットにしてみたい生き物', items: ['柴犬', 'ねこ', 'ハムスター', 'インコ', 'カメ', 'ウーパールーパー', 'ハリネズミ', 'カピバラ'] },
  { title: '動物園の人気者（どうぶつ）', items: ['パンダ', 'ライオン', 'ゾウ', 'キリン', 'ペンギン', 'コアラ', 'レッサーパンダ'] },
  { title: '水族館の生き物', items: ['イルカ', 'ペンギン', 'ラッコ', 'クラゲ', 'チンアナゴ', 'ジンベエザメ', 'カワウソ'] },
  { title: '恐竜', items: ['ティラノサウルス', 'トリケラトプス', 'ブラキオサウルス', 'プテラノドン', 'ステゴサウルス', 'モササウルス'] },
  { title: 'もふもふしたい動物', items: ['アルパカ', '子犬', '長毛ねこ', 'うさぎ', 'ハムスター', 'レッサーパンダ'] },

  // きせつ・くらし
  { title: '冬のたのしみ', items: ['こたつ', '雪あそび', 'あったかい鍋', 'イルミネーション', '温泉', 'ホットココア', 'そり・スキー'] },
  { title: '夏のたのしみ', items: ['プール', 'かき氷', '花火', 'スイカ', '虫とり', '海', 'アイス食べ放題'] },
  { title: '雨の日のすごし方', items: ['ゲーム', '映画・アニメ', 'お菓子づくり', 'ごろごろ昼寝', 'まんが', '工作', '音楽'] },
  { title: 'ねむりの最強アイテム', items: ['ふかふかの枕', 'ぬいぐるみ', 'もふもふ毛布', '抱き枕', 'ハンモック', 'こたつ'] },
  { title: '雲の形で見つけたらうれしいもの', items: ['ドラゴン', 'ソフトクリーム', 'ねこ', 'ハート', 'くじら', '恐竜'] },
];

// ── 状態（永続化なし。リロードで消えるのが正しい仕様）──
const state = {
  topic: '',
  items: [], // [{ id, text, tied }] tied: true なら「うえのカードと同率」
  out: [],   // [{ id, text }] ランクがい
};
let nextId = 1;
let lastTopicIndex = -1;
let dragIndex = null;

// ── 画面遷移 ──
function showScreen(id) {
  document.querySelectorAll('.mr-screen').forEach((s) => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

// ── 丸数字（①〜㊿）──
function circledNum(n) {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
  if (n <= 35) return String.fromCharCode(0x3251 + n - 21);
  if (n <= 50) return String.fromCharCode(0x32b1 + n - 36);
  return `(${n})`;
}

// ── 順位計算（タイは同順位、次はとばす: 1,1,3 方式）──
function computeRanks(items) {
  const ranks = [];
  items.forEach((item, i) => {
    ranks.push(i > 0 && item.tied ? ranks[i - 1] : i + 1);
  });
  return ranks;
}

// ── ランキング開始 ──
function startRanking(title, itemTexts) {
  state.topic = title;
  state.items = itemTexts.map((text) => ({ id: nextId++, text, tied: false }));
  state.out = [];
  document.getElementById('addItemInput').value = '';
  showScreen('rank');
  renderRank();
}

function startGacha() {
  let idx = Math.floor(Math.random() * TOPICS.length);
  if (TOPICS.length > 1 && idx === lastTopicIndex) {
    idx = (idx + 1) % TOPICS.length;
  }
  lastTopicIndex = idx;
  startRanking(TOPICS[idx].title, TOPICS[idx].items);
}

// ── お題一覧 ──
function renderTopicList() {
  const list = document.getElementById('topicList');
  list.innerHTML = '';
  TOPICS.forEach((topic, i) => {
    const btn = document.createElement('button');
    btn.className = 'mr-topic';
    btn.setAttribute('aria-label', `${i + 1}番のお題: ${topic.title}`);
    btn.innerHTML = `
      <span class="mr-topic__num">${circledNum(i + 1)}</span>
      <span class="mr-topic__text">${esc(topic.title)}</span>
    `;
    btn.addEventListener('click', () => {
      lastTopicIndex = i;
      startRanking(topic.title, topic.items);
    });
    list.appendChild(btn);
  });
}

// ── じぶんたちでつくる ──
function renderCreateForm() {
  const box = document.getElementById('createItems');
  box.innerHTML = '';
  for (let i = 0; i < CREATE_MAX_ITEMS; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mr-form__input mr-form__input--item';
    input.maxLength = MAX_ITEM_LEN;
    input.placeholder = `アイテム${i + 1}`;
    box.appendChild(input);
  }
  document.getElementById('createTopic').value = '';
}

function createStart() {
  const title = document.getElementById('createTopic').value.trim().slice(0, MAX_TOPIC_LEN);
  const items = [...document.querySelectorAll('.mr-form__input--item')]
    .map((el) => el.value.trim().slice(0, MAX_ITEM_LEN))
    .filter((t) => t.length > 0);
  if (!title) {
    showToast('お題を入れてね', 'error');
    return;
  }
  if (items.length < 2) {
    showToast('アイテムを2個以上入れてね', 'error');
    return;
  }
  startRanking(title, items);
}

// ── ランキング画面の描画 ──
function renderRank() {
  document.getElementById('rankTopic').textContent = state.topic;

  // 先頭のタイは意味を持たないので解除
  if (state.items.length && state.items[0].tied) state.items[0].tied = false;

  const ranks = computeRanks(state.items);
  const list = document.getElementById('rankList');
  list.innerHTML = '';

  state.items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'mr-item' + (item.tied ? ' mr-item--tied' : '');
    li.draggable = true;
    li.innerHTML = `
      <span class="mr-item__handle material-symbols-rounded" aria-hidden="true">drag_indicator</span>
      <span class="mr-item__rank">${ranks[i]}位</span>
      <span class="mr-item__text">${esc(item.text)}</span>
      <span class="mr-item__ctrl">
        <button type="button" class="mr-item__move" data-act="up" aria-label="${esc(item.text)}を上へ" ${i === 0 ? 'disabled' : ''}>
          <span class="material-symbols-rounded">keyboard_arrow_up</span>
        </button>
        <button type="button" class="mr-item__move" data-act="down" aria-label="${esc(item.text)}を下へ" ${i === state.items.length - 1 ? 'disabled' : ''}>
          <span class="material-symbols-rounded">keyboard_arrow_down</span>
        </button>
        <button type="button" class="mr-item__mini" data-act="tie" ${i === 0 ? 'disabled' : ''}>
          <span class="material-symbols-rounded">${item.tied ? 'link_off' : 'link'}</span>${item.tied ? 'タイをやめる' : 'うえとタイ'}
        </button>
        <button type="button" class="mr-item__mini" data-act="out">
          <span class="material-symbols-rounded">arrow_downward</span>ランクがいへ
        </button>
      </span>
    `;

    li.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => handleItemAction(btn.dataset.act, i));
    });

    // ドラッグ＆ドロップ（PC向け。スマホは▲▼ボタンで並べ替える）
    li.addEventListener('dragstart', (e) => {
      dragIndex = i;
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('mr-item--dragging');
    });
    li.addEventListener('dragend', () => {
      dragIndex = null;
      renderRank();
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragIndex !== null && dragIndex !== i) li.classList.add('mr-item--over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('mr-item--over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== i) moveItem(dragIndex, i);
    });

    list.appendChild(li);
  });

  // ランクがい
  const outList = document.getElementById('outList');
  outList.innerHTML = '';
  state.out.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'mr-out__item';
    li.innerHTML = `
      <span class="mr-out__text">${esc(item.text)}</span>
      <button type="button" class="mr-item__mini" data-act="back" aria-label="${esc(item.text)}をランキングにもどす">
        <span class="material-symbols-rounded">arrow_upward</span>もどす
      </button>
    `;
    li.querySelector('button').addEventListener('click', () => {
      const [moved] = state.out.splice(i, 1);
      state.items.push({ id: moved.id, text: moved.text, tied: false });
      renderRank();
    });
    outList.appendChild(li);
  });
  document.getElementById('outEmpty').style.display = state.out.length ? 'none' : '';
}

function handleItemAction(act, i) {
  const items = state.items;
  if (act === 'up' && i > 0) {
    moveItem(i, i - 1);
  } else if (act === 'down' && i < items.length - 1) {
    moveItem(i, i + 1);
  } else if (act === 'tie' && i > 0) {
    items[i].tied = !items[i].tied;
    renderRank();
  } else if (act === 'out') {
    const [moved] = items.splice(i, 1);
    state.out.push({ id: moved.id, text: moved.text });
    renderRank();
  }
}

function moveItem(from, to) {
  if (from === to) return;
  const [moved] = state.items.splice(from, 1);
  moved.tied = false;
  state.items.splice(to, 0, moved);
  renderRank();
}

// ── アイテム追加 ──
function addItem() {
  const input = document.getElementById('addItemInput');
  const text = input.value.trim().slice(0, MAX_ITEM_LEN);
  if (!text) return;
  if (state.items.length + state.out.length >= MAX_TOTAL_ITEMS) {
    showToast(`アイテムは全部で${MAX_TOTAL_ITEMS}個までだよ`, 'error');
    return;
  }
  if (state.items.some((it) => it.text === text) || state.out.some((it) => it.text === text)) {
    showToast('おなじアイテムがもうあるよ', 'error');
    return;
  }
  state.items.push({ id: nextId++, text, tied: false });
  input.value = '';
  renderRank();
}

// ── けっかをコピー（M-2）──
function buildResultText() {
  const lines = [`お題：${state.topic}`];
  const ranks = computeRanks(state.items);
  state.items.forEach((item, i) => lines.push(`${ranks[i]}位 ${item.text}`));
  if (state.out.length) {
    lines.push(`ランクがい：${state.out.map((o) => o.text).join('、')}`);
  }
  return lines.join('\n');
}

// ── イベント ──
document.getElementById('btnGacha').addEventListener('click', startGacha);
document.getElementById('btnList').addEventListener('click', () => showScreen('list'));
document.getElementById('btnCreate').addEventListener('click', () => {
  renderCreateForm();
  showScreen('create');
});
document.getElementById('btnListBack').addEventListener('click', () => showScreen('top'));
document.getElementById('btnCreateBack').addEventListener('click', () => showScreen('top'));
document.getElementById('btnCreateStart').addEventListener('click', createStart);
document.getElementById('btnAddItem').addEventListener('click', addItem);
document.getElementById('addItemInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addItem();
  }
});
document.getElementById('btnCopy').addEventListener('click', function () {
  copyToClipboard(buildResultText(), this);
});
document.getElementById('btnNextTopic').addEventListener('click', () => showScreen('top'));

// ── 初期化 ──
renderTopicList();
showScreen('top');
