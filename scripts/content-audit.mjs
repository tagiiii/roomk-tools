#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function stripExports(code) {
  return code
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/\bexport\s+const\s+/g, 'var ')
    .replace(/\bexport\s+let\s+/g, 'var ')
    .replace(/\bexport\s+function\s+/g, 'function ');
}

function evalModule(rel) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(stripExports(read(rel)), context, { filename: rel });
  return context;
}

function extractScript(html) {
  const scripts = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) scripts.push(match[1]);
  return scripts.join('\n');
}

function extractConstArray(source, name) {
  const marker = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\[`, 'm');
  const match = marker.exec(source);
  if (!match) return null;
  const start = source.indexOf('[', match.index);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`array ${name} is not closed`);
}

function evalArrayFromSource(source, name, filename) {
  const array = extractConstArray(source, name);
  if (!array) return null;
  const context = {};
  vm.createContext(context);
  vm.runInContext(`result = ${array};`, context, { filename });
  return context.result;
}

// 引用符とネストを意識して { } / [ ] の対応する閉じ括弧までを切り出す。
function sliceBalanced(source, start, open, close) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`literal starting with ${open} is not closed`);
}

// マーカー正規表現の直後に現れる配列/オブジェクトリテラルを評価する汎用ヘルパ。
function evalLiteral(source, markerRe, open, filename) {
  const match = markerRe.exec(source);
  if (!match) return null;
  const start = source.indexOf(open, match.index);
  const literal = sliceBalanced(source, start, open, open === '[' ? ']' : '}');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`result = ${literal};`, context, { filename });
  return context.result;
}

// `window.NAME = [ ... ]` 形式（ikutsu-ieru の themes.js）の配列を取り出す。
function evalWindowArrayFromSource(source, name, filename) {
  return evalLiteral(source, new RegExp(`window\\.${name}\\s*=\\s*\\[`, 'm'), '[', filename);
}

// `const NAME = { ... }` 形式（kyoumi-sugoroku の QUESTIONS）のオブジェクトを取り出す。
function evalObjectFromSource(source, name, filename) {
  return evalLiteral(source, new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`, 'm'), '{', filename);
}

function katakanaToHiragana(text) {
  return Array.from(text).map((char) => {
    const code = char.charCodeAt(0);
    if (code >= 0x30A1 && code <= 0x30F6) return String.fromCharCode(code - 0x60);
    return char;
  }).join('');
}

function normalize(value) {
  return katakanaToHiragana(String(value ?? '').normalize('NFKC').toLowerCase())
    .replace(/[\s\u3000]/g, '')
    .replace(/[\p{P}\p{S}]/gu, '');
}

function bigrams(text) {
  const source = normalize(text);
  const grams = new Set();
  for (let index = 0; index < source.length - 1; index += 1) grams.add(source.slice(index, index + 2));
  return grams;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function entry(tool, category, text, extra = {}) {
  const answer = extra.answer ?? text;
  const question = extra.question ?? text;
  return {
    id: extra.id ?? `${tool}:${category}:${text}`,
    tool,
    category: String(category ?? ''),
    text: String(text ?? ''),
    question: String(question ?? ''),
    answer: String(answer ?? ''),
    normText: normalize(text),
    normQuestion: normalize(question),
    normAnswer: normalize(answer),
    // ペア/多要素コンテンツで、どの種類・どのペアの要素かを保持する。
    // 異種要素（citizen と wolf、left と right、serifu と situation）どうしの
    // 一致を「同一意味の重複」と断定しないための識別子。
    variant: extra.variant ?? '',
    extraText: String(extra.extraText ?? ''),
    pairIndex: extra.pairIndex ?? null,
  };
}

// ────────────────────────────────────────────────────────────
// カバレッジ・マニフェスト
// 「数えられるコンテンツ（お題・問題・カード）を持つのに collectEntries で
//   抽出していないアプリ」を将来の追加時に取りこぼさないための台帳。
//   tool 名は apps/ 配下のディレクトリ名と一致させる。
// ────────────────────────────────────────────────────────────

// 重複検査でカバー済みのアプリ（collectEntries が entries を生成する）。
const COVERED_APPS = [
  'kotoba-meter',
  // 2026-11-09 追加（流す言葉の一覧）
  'kotoba-dash',
  'tsunagete-story',
  // 2026-11-11 追加（ジャンルと、その中の選択肢・見せあいの質問）
  'suki-mono-map',
  // 2026-11-12 追加（よさと、そのよさが出る場面・ながめるときの質問）
  'yosa-map',
  // 既存（A2 以前から抽出済み）
  'quiz', 'kotoba-shuffle', 'kanji-sagashi', 'kotoba-relay', 'tatoe-gp',
  'kaburazu-hint', 'kotoba-tantei', 'docchi', 'minna-ranking',
  'talk-card', 'otona-talk', 'tsuyomi-card', 'kimochi-ate',
  // 2026-11-05 追加（作戦会議の自己理解ワーク。9つの問いと両はしの言葉）
  'donna-hito',
  // A2 で追加した12アプリ
  'jitsuwa-game', 'do-mannaka', 'ishin-denshin', 'word-wolf', 'tatoe-narabe', 'magire-eshi',
  'ikutsu-ieru', 'pittari-meter', 'uso-jisho', 'value-card', 'koedake-theater', 'kyoumi-sugoroku',
  // コトバであそぼ！第2期（2026-08-09〜10）で追加した3アプリ
  'kotoba-pair', 'toomawashi', 'kotoba-theme',
  // 2026-09-28 追加
  'oekaki-dengon',
  // 2026-09-29 追加（v2。ルーム対応）
  'career-sugoroku',
  // 2026-09-30 台帳の登録漏れを追加
  'kotoba-mikke',
  // 2026-10-03 追加
  'stamp-ate',
  'shirushi-hint',
  // 2026-10-07 追加
  'kossori-word',
  // 2026-10-12 追加
  'suki-bingo',
  // 2026-10-13 追加（ポータルには載せていない）
  'yokumite-kanji',
  // 2026-10-30 追加
  'hirameki-oogiri',
  // 2026-11-02 追加
  'kanpe-housou',
];

// 数えられるコンテンツを持たないため重複検査の対象外にするアプリ（意図的除外）。
// 例: 内省ツール・進行支援・スタブ本体など、比較対象になる「お題集」が存在しない。
const NO_CONTENT_APPS = [
  // 進行役のツール。自由タイムのお題は talk-card・quiz・kotoba-mikke から読む。今日は何の日は毎朝の日付ファイル（その日だけ）
  'circle-time',
  // 進行役のツール（作戦会議の流れ）。チェックインのお題は talk-card から読む。予定のふせん・選択肢は語のリストで、お題集ではない
  'sakusen-kaigi',
  'suki-type-check', 'kakure-number', 'jinro', 'kakure-kaito',
  'name-change', 'kyapa-graph', 'nurie-week',
  // カードゲーム・パズルの部品だけ（トランプ・数字札・かなタイル・生き物8種・ピースと盤面）
  'blackjack', 'esadori', 'moji-soroe', 'oshitsuke-zukan', 'pita-hame',
  // 数字のカギ（1〜12）だけ
  'kagi-awase',
  // 会話は使う人が書く（アプリはお題を持たない。ポータルには載せていない）
  'sakusen-chat',
  // 曲と、しるしの並び（まる・ひしがた）だけ
  'pittari-beat',
  // 盤と黒白の石だけ
  'reversi',
  // 絵のカード（アイコン25種類と、形×数の20種類）だけ
  'shinkei-suijaku',
  // 盤のしかけ（とびら・箱・カギ・橋）だけ（ステージは番号からその場で作る）
  'sorotte-goal',
  // 6種類の小銭の絵だけ（問題はその場でくじで作る）
  'charin-baton',
  // 落ちてくるブロック（1〜4マスの8種類の形）だけ
  'suton-block',
  // 色の玉（5色と、色ごとの形）だけ
  'iro-tsunagi',
  // トランプ（52枚＋ジョーカー）だけ
  'daifugo',
  // 麻雀の牌（34種類）だけ
  'mahjong',
  // マップと仕事のミニゲーム（線・番号・メーター）だけ
  'nemurase-kichi',
];

// apps/ 配下に存在するがアプリではないディレクトリ。
// ito / iisen-show / hint-de-pinto / codenames / sukina-map / kotoba-waza / kimochi-map は
// 旧URLからの自動移動スタブ（コンテンツなし）。
// guide はスタッフ向け「ゲームえらび早見表」ページ（お題集を持たない静的な案内ページ）。
// stats-view は開発者専用の利用状況ダッシュボード、assets はポータルのサムネイル画像置き場。
const NON_APP_DIRS = ['shared', 'ito', 'iisen-show', 'hint-de-pinto', 'codenames', 'sukina-map', 'kotoba-waza', 'kimochi-map', 'guide', 'stats-view', 'assets'];

// 意図的重複 allowlist（C-4 で決着済み）:
//   異なるゲーム間で日常語彙（「カレー」「うさぎ」など）が重複するのは正当。
//   このため exactMatch の分類では「複数の tool にまたがるだけ」のグループは
//   意図的（cross-game）とみなし、同一 tool 内で2件以上重複するグループのみを
//   intraAppExactMatches として「要確認」に分類する（knownCodenamesDuplicates と同型の考え方）。
//   下記は、同一アプリ内で重複していても意図的と確認済みの正規化テキストを明示する枠
//   （現状は空。必要になったら normalize() 済み文字列を追加する）。
const INTENTIONAL_INTRA_APP_DUPLICATES = [
  // career-sugoroku: 10代（youth）とおとな（adult）のイベントの山札に同じ「チャンスが来た」（もう1回サイコロ）を置いている
  'ちゃんすが来た',
];

// 統制語彙: 同一アプリ内で「同じ種類(variant)」の反復が設計どおりで、重複として
// 要確認にしないもの。キーは `tool::variant`。
//   - koedake-theater の situation は感情ラベルの統制語彙で、複数の serifu カードに
//     同じ感情（例「びっくりしている」）を割り当てるのが仕様。serifu 本体（variant=serifu）の
//     重複は引き続き要確認に残す。
const REPEAT_EXPECTED_VARIANTS = new Set([
  'koedake-theater::situation',
]);

// 異種要素どうしの一致が設計どおりのアプリ（intraAppCrossVariantMatches に出さない）。
//   - suki-bingo はテーマ（variant＝テーマの id）ごとに24語で、同じ語が別のテーマに出るのは設計どおり
//     （同じテーマ内の重複は collectEntries で fail-fast にしている）。2026-11-08 P3 監査で、
//     要確認の17組がすべてこれだったため外した
//   - suki-mono-map はジャンル（variant＝ジャンルの id）ごとの選択肢で、同じ語が別のジャンルに出るのは設計どおり
//     （「ダンス」が音楽・スポーツ・動画に、「料理」が動画・つくるに入る。同じジャンル内の重複は collectEntries で fail-fast）
//   - yosa-map はよさ（variant＝よさの id）ごとの場面で、同じ場面が別のよさに出るのは設計どおり
//     （「絵をかくとき」が想像力・手先が器用に入る。同じよさの中の重複は collectEntries で fail-fast）
const CROSS_VARIANT_EXPECTED_TOOLS = new Set([
  'suki-bingo',
  'suki-mono-map',
  'yosa-map',
]);

// 禁止題材の候補語（ルート AGENTS.md「使用しない表現・トピック」）。見つけたら stderr に警告を出すだけで、
// 終了コードは 0 のまま（語があっても別の意味のことが多い。最後は人が読んで決める）。2026-11-08 P3 監査で追加。
// クイズは不正解の選択肢と解説（extraText）も見る。ことばシャッフルのヒントは question に入っている
const FORBIDDEN_TOPIC_CANDIDATES = [
  '学校', '宿題', 'テスト', '成績', '授業', '勉強', '教科書', '教室', '先生',
  '転校', '登校', '欠席', '不登校', '出席',
  '恋', '告白', 'デート', '付き合', '彼氏', '彼女',
  '死', '殺', '幽霊', 'ホラー', '怖', '血', 'いじめ', '暴力', '戦争',
];
// 読んで問題ないと決めたもの（項目の id → 語）。理由を添えて足す
const FORBIDDEN_TOPIC_ALLOWED = {
  nd11: ['恋'], // 地名「嬬恋村」の読み
  ns10: ['戦争'], // 地名「田原坂」の解説に出る史実の名前
  'otona-talk:58': ['付き合'], // 「失敗と付き合う」。大人どうしの雑談カード
  'otona-talk:61': ['付き合'], // 「苦手なことと付き合う」
  'do-mannaka:57': ['血'], // 蚊が吸う血の量（数の予想）
  'do-mannaka:82': ['血'], // 人の体の血液の量（数の予想）
  'ishin-denshin:94': ['殺'], // 「必殺技」
};
function forbiddenTopicCandidates(rows) {
  const out = [];
  for (const row of rows) {
    const haystack = [row.text, row.question, row.answer, row.extraText].join(' / ');
    const allowed = FORBIDDEN_TOPIC_ALLOWED[row.id] || [];
    const words = FORBIDDEN_TOPIC_CANDIDATES.filter((word) => haystack.includes(word) && !allowed.includes(word));
    if (words.length > 0) out.push({ id: row.id, tool: row.tool, words, text: haystack.slice(0, 120) });
  }
  return out;
}

function checkCoverage(toolsWithEntries = new Set()) {
  const appsDir = path.join(root, 'apps');
  const dirs = fs.readdirSync(appsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory() && !NON_APP_DIRS.includes(dirent.name))
    .map((dirent) => dirent.name)
    .sort();
  const covered = new Set(COVERED_APPS);
  const noContent = new Set(NO_CONTENT_APPS);
  const uncovered = dirs.filter((name) => !covered.has(name) && !noContent.has(name));
  // マニフェストにあるのに実在しない（削除済み）アプリも検出しておく。
  const missing = [...COVERED_APPS, ...NO_CONTENT_APPS].filter((name) => !dirs.includes(name));
  // 台帳では covered だが実際には1件も抽出されていないアプリ（セレクタの drift・
  // データ構造変更で抽出が壊れた場合など）。台帳だけ緑で実質ゼロになる穴を塞ぐ。
  const coveredButEmpty = COVERED_APPS.filter((name) => dirs.includes(name) && !toolsWithEntries.has(name));
  return {
    apps: dirs,
    covered: COVERED_APPS.filter((name) => dirs.includes(name)),
    excludedNoContent: NO_CONTENT_APPS.filter((name) => dirs.includes(name)),
    uncovered,
    missingFromManifest: missing,
    coveredButEmpty,
  };
}

function collectEntries() {
  const rows = [];

  const quiz = evalModule('apps/quiz/questions.js').QUIZ_PACKS || [];
  for (const pack of quiz) {
    for (const q of pack.questions || []) {
      rows.push(entry('quiz', pack.id, q.question, {
        id: q.id,
        question: q.question,
        answer: q.choices?.[q.answerIndex] ?? q.answer ?? '',
        // 重複の判定には使わず、禁止題材の候補語の検査だけで見る（不正解の選択肢と解説）
        extraText: [...(q.choices || []), q.explanation || ''].join(' / '),
      }));
    }
  }

  const shuffleWords = evalModule('apps/kotoba-shuffle/words.js').WORDS || [];
  shuffleWords.forEach((item, index) => rows.push(entry('kotoba-shuffle', item.difficulty, item.word, {
    id: `kotoba-shuffle:${index}`,
    question: item.hint || item.word,
    answer: item.word,
  })));

  const kanji = evalModule('apps/kanji-sagashi/questions.js').QUESTIONS || [];
  kanji.forEach((item, index) => rows.push(entry('kanji-sagashi', item.visualDifficulty, item.target, {
    id: `kanji-sagashi:${index}`,
    question: item.target,
    answer: item.target,
  })));

  const relaySource = read('apps/kotoba-relay/app.js');
  const starters = evalArrayFromSource(relaySource, 'starters', 'apps/kotoba-relay/app.js') || [];
  starters.forEach((text, index) => rows.push(entry('kotoba-relay', 'starter', text, {
    id: `kotoba-relay:starter:${index}`,
    question: text,
    answer: text,
  })));
  const connectors = evalArrayFromSource(relaySource, 'connectors', 'apps/kotoba-relay/app.js') || [];
  connectors.forEach((item, index) => rows.push(entry('kotoba-relay', item.type, item.word, {
    id: `kotoba-relay:connector:${index}`,
    question: item.word,
    answer: item.word,
  })));

  const tatoeSource = extractScript(read('apps/tatoe-gp/index.html'));
  const themes = evalArrayFromSource(tatoeSource, 'THEMES', 'apps/tatoe-gp/index.html') || [];
  themes.forEach((text, index) => rows.push(entry('tatoe-gp', 'theme', text, {
    id: `tatoe-gp:${index}`,
    question: text,
    answer: text,
  })));

  const hintSource = extractScript(read('apps/kaburazu-hint/index.html'));
  const hintWords = evalArrayFromSource(hintSource, 'WORDS', 'apps/kaburazu-hint/index.html') || [];
  hintWords.forEach((text, index) => rows.push(entry('kaburazu-hint', 'word', text, {
    id: `kaburazu-hint:${index}`,
    question: text,
    answer: text,
  })));

  const kotobaTanteiSets = evalModule('apps/kotoba-tantei/words.js').wordSets || [];
  for (const set of kotobaTanteiSets) {
    (set.words || []).forEach((text, index) => rows.push(entry('kotoba-tantei', set.id, text, {
      id: `kotoba-tantei:${set.id}:${index}`,
      question: text,
      answer: text,
    })));
  }

  const docchiTopics = evalArrayFromSource(read('apps/docchi/app.js'), 'TOPICS', 'apps/docchi/app.js') || [];
  docchiTopics.forEach((item, index) => rows.push(entry('docchi', item.cat, item.q, {
    id: `docchi:${index}`,
    question: item.q,
    answer: `${item.a}/${item.b}`,
  })));

  const rankingTopics = evalArrayFromSource(read('apps/minna-ranking/app.js'), 'TOPICS', 'apps/minna-ranking/app.js') || [];
  rankingTopics.forEach((item, index) => rows.push(entry('minna-ranking', 'topic', item.title, {
    id: `minna-ranking:${index}`,
    question: item.title,
    answer: (item.items || []).join('/'),
  })));

  const talkTopics = evalArrayFromSource(read('apps/talk-card/app.js'), 'topics', 'apps/talk-card/app.js') || [];
  talkTopics.forEach((text, index) => rows.push(entry('talk-card', 'topic', text, {
    id: `talk-card:${index}`,
  })));

  const otonaTopics = evalArrayFromSource(read('apps/otona-talk/app.js'), 'topics', 'apps/otona-talk/app.js') || [];
  otonaTopics.forEach((item, index) => rows.push(entry('otona-talk', item.c, item.t, {
    id: `otona-talk:${index}`,
  })));

  // 2026-08-06 刷新で CARD_TEXTS（文字列配列）→ CARD_DEFS（{text, icon} 配列）に改名
  const tsuyomiCards = evalArrayFromSource(read('apps/tsuyomi-card/app.js'), 'CARD_DEFS', 'apps/tsuyomi-card/app.js') || [];
  tsuyomiCards.forEach((def, index) => rows.push(entry('tsuyomi-card', 'card', def.text, {
    id: `tsuyomi-card:${index}`,
  })));

  // donna-hito: 9つの問い（title）と両はしの言葉（left / right）。両はしは category を分ける
  const donnaQuestions = evalArrayFromSource(read('apps/donna-hito/app.js'), 'QUESTIONS', 'apps/donna-hito/app.js') || [];
  donnaQuestions.forEach((q, index) => {
    rows.push(entry('donna-hito', 'question', q.title, { id: `donna-hito:${index}:title` }));
    rows.push(entry('donna-hito', 'end', q.left, { id: `donna-hito:${index}:left` }));
    rows.push(entry('donna-hito', 'end', q.right, { id: `donna-hito:${index}:right` }));
  });

  // kimochi-ate（2026-09-25 に kimochi-map から作り変え）: 6系×12語の GROUPS と場面カード SCENES。
  //   ことばは系ごとの category、場面は category 'scene'。構造検査（6系×12語・語の重複なし・
  //   代表語 sample はその系の words の中の4語・場面は空でない）はここで fail-fast にする。
  const kimochiGroups = evalArrayFromSource(read('apps/kimochi-ate/app.js'), 'GROUPS', 'apps/kimochi-ate/app.js') || [];
  const kimochiScenes = evalArrayFromSource(read('apps/kimochi-ate/app.js'), 'SCENES', 'apps/kimochi-ate/app.js') || [];
  const kimochiProblems = [];
  if (kimochiGroups.length !== 6) kimochiProblems.push(`GROUPS が6系でない（${kimochiGroups.length}系）`);
  const kimochiWords = new Set();
  for (const group of kimochiGroups) {
    const words = group.words || [];
    if (words.length !== 12) kimochiProblems.push(`${group.key}: ことばが12語でない（${words.length}語）`);
    const sample = group.sample || [];
    if (sample.length !== 4) kimochiProblems.push(`${group.key}: 代表語 sample が4語でない（${sample.length}語）`);
    sample.filter((word) => !words.includes(word)).forEach((word) => {
      kimochiProblems.push(`${group.key}: 代表語「${word}」が words にない`);
    });
    words.forEach((word, index) => {
      if (kimochiWords.has(word)) kimochiProblems.push(`${group.key}: ことば「${word}」がほかの系と重複`);
      kimochiWords.add(word);
      rows.push(entry('kimochi-ate', group.key, word, {
        id: `kimochi-ate:${group.key}:${index}`, variant: 'word',
      }));
    });
  }
  if (kimochiScenes.length === 0) kimochiProblems.push('SCENES が空');
  kimochiScenes.forEach((text, index) => {
    if (typeof text !== 'string' || !text.trim()) kimochiProblems.push(`SCENES[${index}] が空`);
    rows.push(entry('kimochi-ate', 'scene', text, {
      id: `kimochi-ate:scene:${index}`, variant: 'scene',
    }));
  });
  if (kimochiProblems.length > 0) {
    throw new Error(`kimochi-ate app.js の構造エラー:\n  ${kimochiProblems.join('\n  ')}`);
  }

  // bamen-card / mirai-hikidashi の抽出は 2026-08-06 のアプリ削除（一旦公開終了）に伴い撤去

  // ── A2 追加: これまで抽出対象外だった12アプリ ──

  // jitsuwa-game: const prompts = [ '文字列', ... ]
  const jitsuwaPrompts = evalArrayFromSource(read('apps/jitsuwa-game/app.js'), 'prompts', 'apps/jitsuwa-game/app.js') || [];
  jitsuwaPrompts.forEach((text, index) => rows.push(entry('jitsuwa-game', 'prompt', text, {
    id: `jitsuwa-game:${index}`,
  })));

  // do-mannaka: HTML 内 const QUESTIONS = [ '文字列', ... ]
  const domannakaSource = extractScript(read('apps/do-mannaka/index.html'));
  const domannakaQuestions = evalArrayFromSource(domannakaSource, 'QUESTIONS', 'apps/do-mannaka/index.html') || [];
  domannakaQuestions.forEach((text, index) => rows.push(entry('do-mannaka', 'question', text, {
    id: `do-mannaka:${index}`,
  })));

  // ishin-denshin: const topics = [ '文字列', ... ]
  const ishinTopics = evalArrayFromSource(read('apps/ishin-denshin/app.js'), 'topics', 'apps/ishin-denshin/app.js') || [];
  ishinTopics.forEach((text, index) => rows.push(entry('ishin-denshin', 'topic', text, {
    id: `ishin-denshin:${index}`,
  })));

  // suki-bingo: app.js の const THEMES = [ { id, name, items: [ { t }, ... ] }, ... ]（テーマと候補）。
  //   ルームではテーマの id と語の番号で共有するので、空の語・同じテーマ内の重複・24語でないテーマは fail-fast にする
  //   （1テーマ24語から、ゲームごとに16個を候補に出す）。
  const bingoThemes = evalArrayFromSource(read('apps/suki-bingo/app.js'), 'THEMES', 'apps/suki-bingo/app.js') || [];
  const bingoProblems = [];
  if (bingoThemes.length === 0) bingoProblems.push('THEMES が空');
  bingoThemes.forEach((theme) => {
    const items = theme.items || [];
    if (items.length !== 24) bingoProblems.push(`${theme.id} の語が ${items.length} 個（24個にする）`);
    const seen = new Set();
    items.forEach((item, index) => {
      const text = item?.t;
      if (typeof text !== 'string' || !text.trim()) bingoProblems.push(`${theme.id}[${index}] が空`);
      if (seen.has(text)) bingoProblems.push(`${theme.id}[${index}]「${text}」が重複`);
      seen.add(text);
      rows.push(entry('suki-bingo', theme.id, text, { id: `suki-bingo:${theme.id}:${index}`, variant: theme.id }));
    });
  });
  if (bingoProblems.length > 0) {
    throw new Error(`suki-bingo app.js の構造エラー:\n  ${bingoProblems.join('\n  ')}`);
  }

  // kossori-word: HTML 内 const TOPIC_GROUPS = [ { name, words: [...] }, ... ]（お題の言葉）
  const kswSource = extractScript(read('apps/kossori-word/index.html'));
  const kswGroups = evalArrayFromSource(kswSource, 'TOPIC_GROUPS', 'apps/kossori-word/index.html') || [];
  kswGroups.forEach((group) => (group.words || []).forEach((word, index) => {
    rows.push(entry('kossori-word', group.name, word, { id: `kossori-word:${group.name}:${index}` }));
  }));

  // word-wolf: HTML 内 const WORD_PAIRS = [ { citizen, wolf }, ... ]（ペア: 両要素を抽出）
  const wolfSource = extractScript(read('apps/word-wolf/index.html'));
  const wolfPairs = evalArrayFromSource(wolfSource, 'WORD_PAIRS', 'apps/word-wolf/index.html') || [];
  wolfPairs.forEach((pair, index) => {
    rows.push(entry('word-wolf', 'word', pair.citizen, { id: `word-wolf:${index}:citizen`, variant: 'citizen', pairIndex: index }));
    rows.push(entry('word-wolf', 'word', pair.wolf, { id: `word-wolf:${index}:wolf`, variant: 'wolf', pairIndex: index }));
  });

  // tatoe-narabe: HTML 内 const THEMES = [ '文字列', ... ]
  const tatoeNarabeSource = extractScript(read('apps/tatoe-narabe/index.html'));
  const tatoeNarabeThemes = evalArrayFromSource(tatoeNarabeSource, 'THEMES', 'apps/tatoe-narabe/index.html') || [];
  tatoeNarabeThemes.forEach((text, index) => rows.push(entry('tatoe-narabe', 'theme', text, {
    id: `tatoe-narabe:${index}`,
  })));

  // magire-eshi: HTML 内 const TOPICS = [ { w: お題, c: カテゴリ }, ... ]
  //   c はカテゴリ名（どうぶつ/たべもの等）なのでカテゴリ扱い、コンテンツは w のみ。
  const magireSource = extractScript(read('apps/magire-eshi/index.html'));
  const magireTopics = evalArrayFromSource(magireSource, 'TOPICS', 'apps/magire-eshi/index.html') || [];
  magireTopics.forEach((item, index) => rows.push(entry('magire-eshi', item.c, item.w, {
    id: `magire-eshi:${index}`,
  })));

  // oekaki-dengon: HTML 内 const PROMPTS = [ '文字列', ... ]（「おまかせ」のお題）
  const oekakiSource = extractScript(read('apps/oekaki-dengon/index.html'));
  const oekakiPrompts = evalArrayFromSource(oekakiSource, 'PROMPTS', 'apps/oekaki-dengon/index.html') || [];
  oekakiPrompts.forEach((text, index) => rows.push(entry('oekaki-dengon', 'prompt', text, {
    id: `oekaki-dengon:${index}`,
  })));

  // kotoba-mikke: app.js の const THEMES = [ '文字列', ... ]（「〜言葉」「〜もの」のお題）。
  //   頭文字の INITIALS は抽選用の1文字なので検査対象外。
  const mikkeThemes = evalArrayFromSource(read('apps/kotoba-mikke/app.js'), 'THEMES', 'apps/kotoba-mikke/app.js') || [];
  mikkeThemes.forEach((text, index) => rows.push(entry('kotoba-mikke', 'theme', text, {
    id: `kotoba-mikke:${index}`,
  })));

  // stamp-ate: app.js の const TOPICS = [ '文字列', ... ]（スタンプで表すお題）。
  //   ルームでは番号で共有するので、空のお題と同じアプリ内の重複はここで fail-fast にする。
  const stampTopics = evalArrayFromSource(read('apps/stamp-ate/app.js'), 'TOPICS', 'apps/stamp-ate/app.js') || [];
  const stampSeen = new Set();
  const stampProblems = [];
  if (stampTopics.length === 0) stampProblems.push('TOPICS が空');
  stampTopics.forEach((text, index) => {
    if (typeof text !== 'string' || !text.trim()) stampProblems.push(`TOPICS[${index}] が空`);
    if (stampSeen.has(text)) stampProblems.push(`TOPICS[${index}]「${text}」が重複`);
    stampSeen.add(text);
    rows.push(entry('stamp-ate', 'topic', text, { id: `stamp-ate:${index}` }));
  });
  if (stampProblems.length > 0) {
    throw new Error(`stamp-ate app.js の構造エラー:\n  ${stampProblems.join('\n  ')}`);
  }

  // ことばメーター: お題と両端の程度を1件として監査。
  const meterThemes = evalArrayFromSource(read('apps/kotoba-meter/index.html'), 'THEMES', 'apps/kotoba-meter/index.html') || [];
  if (!meterThemes.length) throw new Error('kotoba-meter THEMES が空');
  const meterSeen = new Set();
  meterThemes.forEach((theme, index) => {
    if (![theme.name, theme.low, theme.high].every(v => typeof v === 'string' && v.trim())) throw new Error('kotoba-meter のお題または端点が空');
    if (meterSeen.has(theme.name)) throw new Error('kotoba-meter のお題が重複');
    meterSeen.add(theme.name);
    rows.push(entry('kotoba-meter', 'theme', `${theme.name}：1＝${theme.low}／5＝${theme.high}`, { id: `kotoba-meter:${index}` }));
  });

  // shirushi-hint: data.js の export const TOPICS = [ '文字列', ... ]（アイコンで伝えるお題）。
  //   ルームでは番号で共有するので、空のお題と同じアプリ内の重複はここで fail-fast にする。
  //   アイコンの名前（ICON_GROUPS の label）は、しるしの部品なので検査対象外
  const shirushiTopics = evalArrayFromSource(read('apps/shirushi-hint/data.js'), 'TOPICS', 'apps/shirushi-hint/data.js') || [];
  const shirushiSeen = new Set();
  const shirushiProblems = [];
  if (shirushiTopics.length === 0) shirushiProblems.push('TOPICS が空');
  shirushiTopics.forEach((text, index) => {
    if (typeof text !== 'string' || !text.trim()) shirushiProblems.push(`TOPICS[${index}] が空`);
    if (shirushiSeen.has(text)) shirushiProblems.push(`TOPICS[${index}]「${text}」が重複`);
    shirushiSeen.add(text);
    rows.push(entry('shirushi-hint', 'topic', text, { id: `shirushi-hint:${index}` }));
  });
  if (shirushiProblems.length > 0) {
    throw new Error(`shirushi-hint data.js の構造エラー:\n  ${shirushiProblems.join('\n  ')}`);
  }

  // kotoba-dash: data.js の window.KOTOBA_DASH_WORDS = { middle, long, cats, similar }（流す言葉）。
  //   middle・long は流す言葉、cats はなかま分けの言葉。similar は形の似た文字の組（部品なので検査対象外）。
  //   空の言葉と、middle・long の中の重複はここで fail-fast にする
  const dashContext = { window: {} };
  vm.createContext(dashContext);
  vm.runInContext(read('apps/kotoba-dash/data.js'), dashContext, { filename: 'apps/kotoba-dash/data.js' });
  const dashWords = dashContext.window.KOTOBA_DASH_WORDS || {};
  const dashProblems = [];
  const dashSeen = new Set();
  ['middle', 'long'].forEach((pool) => {
    const list = Array.isArray(dashWords[pool]) ? dashWords[pool] : [];
    if (list.length === 0) dashProblems.push(`${pool} が空`);
    list.forEach((text, index) => {
      if (typeof text !== 'string' || !text.trim()) dashProblems.push(`${pool}[${index}] が空`);
      if (dashSeen.has(text)) dashProblems.push(`${pool}[${index}]「${text}」が重複`);
      dashSeen.add(text);
      rows.push(entry('kotoba-dash', 'word', text, { id: `kotoba-dash:${pool}:${index}` }));
    });
  });
  Object.entries(dashWords.cats || {}).forEach(([cat, list]) => {
    (Array.isArray(list) ? list : []).forEach((text, index) => {
      if (typeof text !== 'string' || !text.trim()) dashProblems.push(`cats.${cat}[${index}] が空`);
      rows.push(entry('kotoba-dash', 'cat-word', `${cat}：${text}`, { id: `kotoba-dash:cats:${cat}:${index}` }));
    });
  });
  if (dashProblems.length > 0) {
    throw new Error(`kotoba-dash data.js の構造エラー:\n  ${dashProblems.join('\n  ')}`);
  }

  // tsunagete-story: data.js の window.TSUNAGETE_STORY_WORDS = { when, where, who, what, why, how, next, themes }。
  //   ふつうの候補（項目ごと）・「そのあと…」の候補・お題ごとの候補。空の言葉と、同じ欄の中の重複はここで fail-fast にする
  const storyContext = { window: {} };
  vm.createContext(storyContext);
  vm.runInContext(read('apps/tsunagete-story/data.js'), storyContext, { filename: 'apps/tsunagete-story/data.js' });
  const storyWords = storyContext.window.TSUNAGETE_STORY_WORDS || {};
  const storyProblems = [];
  const storyList = (label, list, category, idBase) => {
    if (!Array.isArray(list) || list.length === 0) { storyProblems.push(`${label} が空`); return; }
    const seen = new Set();
    list.forEach((text, index) => {
      if (typeof text !== 'string' || !text.trim()) storyProblems.push(`${label}[${index}] が空`);
      if (seen.has(text)) storyProblems.push(`${label}[${index}]「${text}」が重複`);
      seen.add(text);
      rows.push(entry('tsunagete-story', category, text, { id: `${idBase}:${index}` }));
    });
  };
  ['when', 'where', 'who', 'what', 'why', 'how'].forEach((key) => storyList(key, storyWords[key], `word-${key}`, `tsunagete-story:${key}`));
  storyList('next', storyWords.next, 'next-line', 'tsunagete-story:next');
  const storyThemeIds = new Set();
  (Array.isArray(storyWords.themes) ? storyWords.themes : []).forEach((theme, t) => {
    if (!theme || !theme.id || !theme.title) { storyProblems.push(`themes[${t}] に id か title がない`); return; }
    if (storyThemeIds.has(theme.id)) storyProblems.push(`themes[${t}] の id「${theme.id}」が重複`);
    storyThemeIds.add(theme.id);
    rows.push(entry('tsunagete-story', 'theme', theme.title, { id: `tsunagete-story:theme:${theme.id}` }));
    ['when', 'where', 'who', 'what'].forEach((key) => storyList(`themes.${theme.id}.${key}`, theme[key], `theme-${key}`, `tsunagete-story:theme:${theme.id}:${key}`));
  });
  if (storyThemeIds.size === 0) storyProblems.push('themes が空');
  if (storyProblems.length > 0) {
    throw new Error(`tsunagete-story data.js の構造エラー:\n  ${storyProblems.join('\n  ')}`);
  }

  // suki-mono-map: data.js の window.SUKI_MONO_MAP_DATA = { genres: [ { id, label, ask, items: [...] } ], asks: [...] }。
  //   ジャンルの名前・ジャンルごとの選択肢・見せあいの質問。空と、同じジャンルの中の重複はここで fail-fast にする
  const mapContext = { window: {} };
  vm.createContext(mapContext);
  vm.runInContext(read('apps/suki-mono-map/data.js'), mapContext, { filename: 'apps/suki-mono-map/data.js' });
  const mapData = mapContext.window.SUKI_MONO_MAP_DATA || {};
  const mapProblems = [];
  const mapGenreIds = new Set();
  (Array.isArray(mapData.genres) ? mapData.genres : []).forEach((genre, g) => {
    if (!genre || !genre.id || !genre.label || !genre.ask) { mapProblems.push(`genres[${g}] に id・label・ask のどれかがない`); return; }
    if (mapGenreIds.has(genre.id)) mapProblems.push(`genres[${g}] の id「${genre.id}」が重複`);
    mapGenreIds.add(genre.id);
    rows.push(entry('suki-mono-map', 'genre', genre.label, { id: `suki-mono-map:genre:${genre.id}`, variant: 'genre' }));
    if (!Array.isArray(genre.items) || genre.items.length === 0) { mapProblems.push(`genres.${genre.id}.items が空`); return; }
    const seen = new Set();
    genre.items.forEach((text, index) => {
      if (typeof text !== 'string' || !text.trim()) mapProblems.push(`genres.${genre.id}.items[${index}] が空`);
      if (seen.has(text)) mapProblems.push(`genres.${genre.id}.items[${index}]「${text}」が重複`);
      seen.add(text);
      rows.push(entry('suki-mono-map', genre.id, text, { id: `suki-mono-map:${genre.id}:${index}`, variant: genre.id }));
    });
  });
  if (mapGenreIds.size === 0) mapProblems.push('genres が空');
  if (!Array.isArray(mapData.asks) || mapData.asks.length === 0) mapProblems.push('asks が空');
  (Array.isArray(mapData.asks) ? mapData.asks : []).forEach((text, index) => {
    if (typeof text !== 'string' || !text.includes('{x}')) mapProblems.push(`asks[${index}] に {x} がない`);
    rows.push(entry('suki-mono-map', 'ask', text, { id: `suki-mono-map:ask:${index}`, variant: 'ask' }));
  });
  if (mapProblems.length > 0) {
    throw new Error(`suki-mono-map data.js の構造エラー:\n  ${mapProblems.join('\n  ')}`);
  }

  // yosa-map: data.js の window.YOSA_MAP_DATA = { yosa: [ { id, label, items: [...] } ], asks: [...] }。
  //   よさの名前・よさごとの場面・ながめるときの質問。空と、同じよさの中の重複はここで fail-fast にする
  const yosaContext = { window: {} };
  vm.createContext(yosaContext);
  vm.runInContext(read('apps/yosa-map/data.js'), yosaContext, { filename: 'apps/yosa-map/data.js' });
  const yosaData = yosaContext.window.YOSA_MAP_DATA || {};
  const yosaProblems = [];
  const yosaIds = new Set();
  (Array.isArray(yosaData.yosa) ? yosaData.yosa : []).forEach((yosa, g) => {
    if (!yosa || !yosa.id || !yosa.label) { yosaProblems.push(`yosa[${g}] に id・label のどちらかがない`); return; }
    if (yosaIds.has(yosa.id)) yosaProblems.push(`yosa[${g}] の id「${yosa.id}」が重複`);
    yosaIds.add(yosa.id);
    rows.push(entry('yosa-map', 'yosa', yosa.label, { id: `yosa-map:yosa:${yosa.id}`, variant: 'yosa' }));
    if (!Array.isArray(yosa.items) || yosa.items.length === 0) { yosaProblems.push(`yosa.${yosa.id}.items が空`); return; }
    const seen = new Set();
    yosa.items.forEach((text, index) => {
      if (typeof text !== 'string' || !text.trim()) yosaProblems.push(`yosa.${yosa.id}.items[${index}] が空`);
      if (seen.has(text)) yosaProblems.push(`yosa.${yosa.id}.items[${index}]「${text}」が重複`);
      seen.add(text);
      rows.push(entry('yosa-map', yosa.id, text, { id: `yosa-map:${yosa.id}:${index}`, variant: yosa.id }));
    });
  });
  if (yosaIds.size === 0) yosaProblems.push('yosa が空');
  if (!Array.isArray(yosaData.asks) || yosaData.asks.length === 0) yosaProblems.push('asks が空');
  (Array.isArray(yosaData.asks) ? yosaData.asks : []).forEach((text, index) => {
    if (typeof text !== 'string' || !(text.includes('{x}') || text.includes('{s}'))) yosaProblems.push(`asks[${index}] に {x} も {s} もない`);
    rows.push(entry('yosa-map', 'ask', text, { id: `yosa-map:ask:${index}`, variant: 'ask' }));
  });
  if (yosaProblems.length > 0) {
    throw new Error(`yosa-map data.js の構造エラー:\n  ${yosaProblems.join('\n  ')}`);
  }

  // hirameki-oogiri: data.js の export const TOPICS = [ '文字列', ... ]（大喜利のお題）。
  //   ルームでは番号で共有するので、空のお題と同じアプリ内の重複はここで fail-fast にする
  const oogiriTopics = evalArrayFromSource(read('apps/hirameki-oogiri/data.js'), 'TOPICS', 'apps/hirameki-oogiri/data.js') || [];
  const oogiriSeen = new Set();
  const oogiriProblems = [];
  if (oogiriTopics.length === 0) oogiriProblems.push('TOPICS が空');
  oogiriTopics.forEach((text, index) => {
    if (typeof text !== 'string' || !text.trim()) oogiriProblems.push(`TOPICS[${index}] が空`);
    if (oogiriSeen.has(text)) oogiriProblems.push(`TOPICS[${index}]「${text}」が重複`);
    oogiriSeen.add(text);
    rows.push(entry('hirameki-oogiri', 'topic', text, { id: `hirameki-oogiri:${index}` }));
  });
  if (oogiriProblems.length > 0) {
    throw new Error(`hirameki-oogiri data.js の構造エラー:\n  ${oogiriProblems.join('\n  ')}`);
  }

  // kanpe-housou: data.js（ブラウザでは window.KanpeData、Node では module.exports）。
  //   番組の原稿の行（空らんは {ヒント} のまま）と、おまかせの言葉を抽出する。
  //   ルームでは番組の id と行の番号で共有するので、id の重複・1行に空らん1つでない行はここで fail-fast にする
  const kanpeContext = { module: { exports: {} } };
  vm.runInNewContext(read('apps/kanpe-housou/data.js'), kanpeContext, { filename: 'apps/kanpe-housou/data.js' });
  const kanpeData = kanpeContext.module.exports || {};
  const kanpeProblems = [];
  const kanpeIds = new Set();
  if (!(kanpeData.PROGRAMS || []).length) kanpeProblems.push('PROGRAMS が空');
  (kanpeData.PROGRAMS || []).forEach((prog) => {
    if (kanpeIds.has(prog.id)) kanpeProblems.push(`番組 ${prog.id} が重複`);
    kanpeIds.add(prog.id);
    (prog.lines || []).forEach((line, i) => {
      if ((String(line).match(/\{[a-z]+\}/g) || []).length !== 1) kanpeProblems.push(`${prog.id} の ${i} 行目の空らんが1つでない`);
      rows.push(entry('kanpe-housou', 'line', line, { id: `kanpe-housou:${prog.id}:${i}`, variant: prog.id }));
    });
  });
  Object.entries(kanpeData.HINTS || {}).forEach(([hint, h]) => (h.words || []).forEach((word, i) => {
    rows.push(entry('kanpe-housou', 'omakase', word, { id: `kanpe-housou:omakase:${hint}:${i}`, variant: hint }));
  }));
  if (kanpeProblems.length > 0) {
    throw new Error(`kanpe-housou data.js の構造エラー:\n  ${kanpeProblems.join('\n  ')}`);
  }

  // career-sugoroku: data.js（ブラウザでは window.CS_DATA、Node では module.exports）。
  //   職業の名前と説明・イベントカードの文・「みんなで決める」の選択肢・体験マスの文・成長マスの文を抽出する
  const careerContext = { module: { exports: {} } };
  vm.runInNewContext(read('apps/career-sugoroku/data.js'), careerContext, { filename: 'apps/career-sugoroku/data.js' });
  const careerData = careerContext.module.exports || {};
  (careerData.JOBS || []).forEach((job) => {
    rows.push(entry('career-sugoroku', 'job', job.name, { id: `career-sugoroku:job:${job.id}`, variant: 'job' }));
    rows.push(entry('career-sugoroku', 'job-desc', job.desc, { id: `career-sugoroku:job-desc:${job.id}`, variant: 'job-desc' }));
  });
  Object.entries(careerData.DECKS || {}).forEach(([deck, cards]) => (cards || []).forEach((card, i) => {
    rows.push(entry('career-sugoroku', 'event', card.text, { id: `career-sugoroku:event:${deck}:${i}`, variant: 'event' }));
    ((card.e && card.e.opts) || []).forEach((o, j) => rows.push(entry('career-sugoroku', 'vote-opt', o.label, {
      id: `career-sugoroku:vote-opt:${deck}:${i}:${j}`, variant: 'vote-opt',
    })));
  }));
  Object.entries(careerData.EXP_TEXT || {}).forEach(([group, byApt]) => (byApt || []).forEach((texts, a) => (texts || []).forEach((text, j) => {
    rows.push(entry('career-sugoroku', 'exp', text, { id: `career-sugoroku:exp:${group}:${a}:${j}`, variant: 'exp' }));
  })));
  (careerData.GROW_TEXT || []).forEach((text, i) => rows.push(entry('career-sugoroku', 'grow', text, { id: `career-sugoroku:grow:${i}`, variant: 'grow' })));

  // ikutsu-ieru: themes.js の window.IKUTSU_THEMES = [ '文字列', ... ]
  const ikutsuThemes = evalWindowArrayFromSource(read('apps/ikutsu-ieru/themes.js'), 'IKUTSU_THEMES', 'apps/ikutsu-ieru/themes.js') || [];
  ikutsuThemes.forEach((text, index) => rows.push(entry('ikutsu-ieru', 'theme', text, {
    id: `ikutsu-ieru:${index}`,
  })));

  // pittari-meter: HTML 内 const AXES = [ { left, right }, ... ]（ペア: 両極を抽出）
  const pittariSource = extractScript(read('apps/pittari-meter/index.html'));
  const pittariAxes = evalArrayFromSource(pittariSource, 'AXES', 'apps/pittari-meter/index.html') || [];
  pittariAxes.forEach((axis, index) => {
    rows.push(entry('pittari-meter', 'pole', axis.left, { id: `pittari-meter:${index}:left`, variant: 'left', pairIndex: index }));
    rows.push(entry('pittari-meter', 'pole', axis.right, { id: `pittari-meter:${index}:right`, variant: 'right', pairIndex: index }));
  });

  // uso-jisho: HTML 内 const WORDS = [ { word, kana, meaning }, ... ]
  //   text=ことば、answer=意味（同一の意味文の重複も structural で拾えるように）。
  const usoSource = extractScript(read('apps/uso-jisho/index.html'));
  const usoWords = evalArrayFromSource(usoSource, 'WORDS', 'apps/uso-jisho/index.html') || [];
  usoWords.forEach((item, index) => rows.push(entry('uso-jisho', 'word', item.word, {
    id: `uso-jisho:${index}`,
    question: item.word,
    answer: item.meaning,
  })));

  // value-card: const cardData = [ { id, keyword, description }, ... ]
  //   text=キーワード、answer=説明文（同一説明の重複も structural で拾えるように）。
  const valueCards = evalArrayFromSource(read('apps/value-card/app.js'), 'cardData', 'apps/value-card/app.js') || [];
  valueCards.forEach((item, index) => rows.push(entry('value-card', 'card', item.keyword, {
    id: `value-card:${index}`,
    question: item.keyword,
    answer: item.description,
  })));

  // koedake-theater: HTML 内 const CARDS = [ { serifu, situations: [...] }, ... ]
  //   serifu を主キーに、situations は mirai-hikidashi の people/tries と同様サブ項目として抽出。
  const koedakeSource = extractScript(read('apps/koedake-theater/index.html'));
  const koedakeCards = evalArrayFromSource(koedakeSource, 'CARDS', 'apps/koedake-theater/index.html') || [];
  koedakeCards.forEach((card, index) => {
    rows.push(entry('koedake-theater', 'serifu', card.serifu, {
      id: `koedake-theater:${index}:serifu`, variant: 'serifu', pairIndex: index,
    }));
    (card.situations || []).forEach((situation, sIndex) => rows.push(entry('koedake-theater', 'situation', situation, {
      id: `koedake-theater:${index}:situation:${sIndex}`, variant: 'situation', pairIndex: index,
    })));
  });

  // kyoumi-sugoroku: const QUESTIONS = { theme: [ '文字列' | { q, choices } ], ... }
  //   カテゴリ=テーマキー、選択肢がある場合は answer に choices を連結。
  const kyoumiQuestions = evalObjectFromSource(read('apps/kyoumi-sugoroku/app.js'), 'QUESTIONS', 'apps/kyoumi-sugoroku/app.js') || {};
  for (const [themeKey, list] of Object.entries(kyoumiQuestions)) {
    (list || []).forEach((item, index) => {
      const isObj = item && typeof item === 'object';
      const questionText = isObj ? item.q : item;
      rows.push(entry('kyoumi-sugoroku', themeKey, questionText, {
        id: `kyoumi-sugoroku:${themeKey}:${index}`,
        question: questionText,
        answer: isObj && Array.isArray(item.choices) ? item.choices.join('/') : questionText,
      }));
    });
  }

  // kotoba-pair: packs.js（window.KotobaPairPacks）。ペアの a/b は variant で区別し、
  //   同一ペア内の a×b 一致を「同一意味の重複」と誤判定しないよう pairIndex を添える。
  //   構造検査（a/b/note の欠落・ペア数不足）はここで fail-fast にする。
  const pairPacks = evalWindowArrayFromSource(read('apps/kotoba-pair/packs.js'), 'KotobaPairPacks', 'apps/kotoba-pair/packs.js') || [];
  const pairProblems = [];
  for (const pack of pairPacks) {
    const pairs = pack.pairs || [];
    if (pairs.length < 12) pairProblems.push(`${pack.id}: ペアが12組未満（${pairs.length}組。16まい盤面×2ボード分に足りない）`);
    pairs.forEach((pair, index) => {
      if (!pair.a || !pair.b) pairProblems.push(`${pack.id}[${index}]: a または b が空`);
      if (!pair.note) pairProblems.push(`${pack.id}[${index}]（${pair.a ?? '?'}）: note（ひとことメモ）がない`);
      rows.push(entry('kotoba-pair', pack.id, pair.a, {
        id: `kotoba-pair:${pack.id}:${index}:a`, variant: 'a', pairIndex: index,
      }));
      rows.push(entry('kotoba-pair', pack.id, pair.b, {
        id: `kotoba-pair:${pack.id}:${index}:b`, variant: 'b', pairIndex: index,
      }));
    });
  }
  if (pairProblems.length > 0) {
    throw new Error(`kotoba-pair packs.js の構造エラー:\n  ${pairProblems.join('\n  ')}`);
  }

  // toomawashi: packs.js（window.ToomawashiPacks）。重複検査には answer だけを載せる
  //   （ng / choices のダミー語は他のお題・他アプリと重なるのが設計上正当なため）。
  //   構造検査（ng 先頭が answer・choices に answer・観点チップの統制語彙）は fail-fast。
  const twPacks = evalWindowArrayFromSource(read('apps/toomawashi/packs.js'), 'ToomawashiPacks', 'apps/toomawashi/packs.js') || [];
  const twProblems = [];
  const TW_ASPECTS = new Set(['ばしょ', 'かたち', 'つかいかた', 'いつ・どこで', 'なかま']);
  for (const pack of twPacks) {
    (pack.items || []).forEach((item, index) => {
      const ng = item.ng || [];
      const choices = item.choices || [];
      const label = `${pack.id}[${index}]（${item.answer ?? '?'}）`;
      if (ng[0] !== item.answer) twProblems.push(`${label}: ng の先頭が answer 自身ではない`);
      if (ng.length < 3 || ng.length > 5) twProblems.push(`${label}: ng が3〜5語ではない（${ng.length}語）`);
      if (!choices.includes(item.answer)) twProblems.push(`${label}: choices に answer が含まれていない`);
      if (choices.length !== 3 || new Set(choices.map(normalize)).size !== 3) {
        twProblems.push(`${label}: choices が相異なる3件ではない`);
      }
      for (const aspect of item.aspects || []) {
        if (!TW_ASPECTS.has(aspect)) twProblems.push(`${label}: 未知の観点チップ「${aspect}」`);
      }
      rows.push(entry('toomawashi', pack.id, item.answer, {
        id: `toomawashi:${pack.id}:${index}`, variant: 'answer',
      }));
    });
  }
  if (twProblems.length > 0) {
    throw new Error(`toomawashi packs.js の構造エラー:\n  ${twProblems.join('\n  ')}`);
  }

  // kotoba-theme: waza.js（window.KotobaWaza = { groups, wazas }）。テーマクイズの問題文を
  //   重複検査に載せる（quiz と同型: question=問題文・answer=正解の選択肢テキスト）。
  //   catch・games の橋渡し文は検査対象外。構造検査（choices 3件・answerIndex 範囲）は fail-fast。
  const wazaData = evalLiteral(read('apps/kotoba-theme/waza.js'), /window\.KotobaWaza\s*=\s*\{/m, '{', 'apps/kotoba-theme/waza.js') || {};
  const wazaProblems = [];
  for (const waza of wazaData.wazas || []) {
    (waza.questions || []).forEach((q, index) => {
      const label = `${waza.id}[${index}]`;
      if (!Array.isArray(q.choices) || q.choices.length !== 3) wazaProblems.push(`${label}: choices が3件ではない`);
      if (!(Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < (q.choices || []).length)) {
        wazaProblems.push(`${label}: answerIndex が範囲外`);
      }
      rows.push(entry('kotoba-theme', waza.id, q.q, {
        id: `kotoba-theme:${waza.id}:${index}`,
        question: q.q,
        answer: (q.choices || [])[q.answerIndex] ?? '',
      }));
    });
  }
  if (wazaProblems.length > 0) {
    throw new Error(`kotoba-theme waza.js の構造エラー:\n  ${wazaProblems.join('\n  ')}`);
  }

  // yokumite-kanji: data.js（export const UNITS）。単元ごとの語（社会・理科の用語）を重複検査に載せる。
  //   構造検査（よく見る1字 k が語にふくまれる・似た字 sim に k 自身がない）は fail-fast。
  const ykUnits = evalModule('apps/yokumite-kanji/data.js').UNITS || [];
  const ykProblems = [];
  for (const unit of ykUnits) {
    (unit.words || []).forEach((word, index) => {
      const label = `${unit.id}[${index}]`;
      if (!word.w || !word.k || !String(word.w).includes(word.k)) ykProblems.push(`${label}: k が語にふくまれていない`);
      if ((word.sim || []).includes(word.k)) ykProblems.push(`${label}: sim に k 自身がある`);
      rows.push(entry('yokumite-kanji', unit.id, word.w, { id: `yokumite-kanji:${unit.id}:${index}` }));
    });
  }
  if (ykProblems.length > 0) {
    throw new Error(`yokumite-kanji data.js の構造エラー:\n  ${ykProblems.join('\n  ')}`);
  }

  return rows.filter((row) => row.normText);
}

function grouped(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({ key, items: items.map(publicEntry) }));
}

function publicEntry(row) {
  return {
    id: row.id,
    tool: row.tool,
    category: row.category,
    text: row.text,
    question: row.question,
    answer: row.answer,
    variant: row.variant ?? '',
    pairIndex: row.pairIndex ?? null,
  };
}

function similarQuestions(rows) {
  const questionRows = rows.filter((row) => row.normQuestion.length >= 6);
  const out = [];
  for (let a = 0; a < questionRows.length; a += 1) {
    const left = questionRows[a];
    const leftGrams = bigrams(left.normQuestion.slice(0, 12));
    for (let b = a + 1; b < questionRows.length; b += 1) {
      const right = questionRows[b];
      const score = jaccard(leftGrams, bigrams(right.normQuestion.slice(0, 12)));
      if (score >= 0.6) {
        out.push({
          score: Number(score.toFixed(3)),
          left: publicEntry(left),
          right: publicEntry(right),
        });
      }
    }
  }
  return out;
}

const rows = collectEntries();
const exactMatches = grouped(rows, (row) => row.normText);
// 構造一致にも、下の intraApp と同じ許可（INTENTIONAL_INTRA_APP_DUPLICATES・REPEAT_EXPECTED_VARIANTS）を当てる。
// 当てないと、設計どおりの反復だけで毎回10組前後が出て、新しい本当の重複が埋もれる（2026-11-08 P3 監査）
const structuralMatches = grouped(
  rows.filter((row) => !REPEAT_EXPECTED_VARIANTS.has(`${row.tool}::${row.variant || ''}`)
    && !INTENTIONAL_INTRA_APP_DUPLICATES.includes(row.normAnswer)),
  (row) => `${row.tool}:${row.category}:${row.normAnswer}`,
);
const similar = similarQuestions(rows);

const known = ['さかな', 'やま', 'たいよう', 'つき', 'ほし', 'みず', 'はし', 'ボール', 'ラケット', 'ロボット', 'もり', 'かわ'];
const detectedKnownCodenames = known.filter((word) => {
  const normalized = normalize(word);
  return exactMatches.some((group) =>
    group.key === normalized &&
    group.items.filter((item) => item.tool === 'kotoba-tantei').length >= 2
  );
});

// 意図的重複（cross-game の日常語彙, C-4 で正当と決着）を除外し、同一アプリ内の
// 完全一致を2種に分ける:
//   intraAppExactMatches       … 「同じ種類(variant)」の項目が2件以上重複＝真の重複候補（要確認）
//   intraAppCrossVariantMatches … 同一アプリだが異種要素どうしの一致（word-wolf の
//                                  citizen×wolf、pittari の left×right 等）。同一意味の
//                                  重複とは断定せず、pairIndex を添えて人間確認に回す。
// koedake の situation のような統制語彙（REPEAT_EXPECTED_VARIANTS）は反復が設計どおりなので除外。
const intentionalIntraApp = new Set(INTENTIONAL_INTRA_APP_DUPLICATES);
const intraAppExactMatches = [];
const intraAppCrossVariantMatches = [];
for (const group of exactMatches) {
  if (intentionalIntraApp.has(group.key)) continue;
  const perTool = new Map(); // tool -> Map(variant -> count)
  for (const item of group.items) {
    const bucket = `${item.tool}::${item.variant || ''}`;
    if (REPEAT_EXPECTED_VARIANTS.has(bucket)) continue;
    if (!perTool.has(item.tool)) perTool.set(item.tool, new Map());
    const variants = perTool.get(item.tool);
    const key = item.variant || '';
    variants.set(key, (variants.get(key) || 0) + 1);
  }
  let sameVariant = false;
  let crossVariant = false;
  for (const [tool, variants] of perTool.entries()) {
    const counts = [...variants.values()];
    if (counts.some((count) => count >= 2)) sameVariant = true;
    else if (counts.reduce((a, b) => a + b, 0) >= 2 && !CROSS_VARIANT_EXPECTED_TOOLS.has(tool)) crossVariant = true;
  }
  if (sameVariant) intraAppExactMatches.push(group);
  else if (crossVariant) intraAppCrossVariantMatches.push(group);
}

// カバレッジ・マニフェスト検査（数えられるコンテンツを持つのに未カバーのアプリを警告）。
// 実際に抽出された tool の集合を渡し、「台帳では covered だが抽出0件」の drift も検出する。
const coverage = checkCoverage(new Set(rows.map((row) => row.tool)));
if (coverage.uncovered.length > 0) {
  console.error('⚠️  [coverage] 重複検査でカバーされていないアプリがあります:');
  for (const name of coverage.uncovered) {
    console.error(`    - apps/${name}/  → collectEntries に抽出を追加するか、`
      + 'コンテンツを持たない場合は NO_CONTENT_APPS に追加してください。');
  }
}
if (coverage.missingFromManifest.length > 0) {
  console.error('⚠️  [coverage] マニフェストに載っているが apps/ に存在しないアプリ: '
    + coverage.missingFromManifest.join(', '));
}
if (coverage.coveredButEmpty.length > 0) {
  console.error('⚠️  [coverage] 台帳では covered だが抽出結果が0件のアプリ（セレクタの drift 疑い・要確認）: '
    + coverage.coveredButEmpty.join(', '));
}

const forbiddenCandidates = forbiddenTopicCandidates(rows);
if (forbiddenCandidates.length > 0) {
  console.error('⚠️  [forbidden-topic] 禁止題材の候補語を含む項目があります（別の意味なら FORBIDDEN_TOPIC_ALLOWED に理由を添えて足す）:');
  for (const hit of forbiddenCandidates) console.error(`    - ${hit.id}「${hit.words.join('・')}」 ${hit.text}`);
}

console.log(JSON.stringify({
  stats: {
    entries: rows.length,
    exactMatchGroups: exactMatches.length,
    intraAppExactMatchGroups: intraAppExactMatches.length,
    intraAppCrossVariantMatchGroups: intraAppCrossVariantMatches.length,
    structuralMatchGroups: structuralMatches.length,
    similarQuestionPairs: similar.length,
    forbiddenTopicCandidates: forbiddenCandidates.length,
  },
  coverage,
  knownCodenamesDuplicates: detectedKnownCodenames,
  intraAppExactMatches,
  intraAppCrossVariantMatches,
  exactMatches,
  structuralMatches,
  forbiddenTopicCandidates: forbiddenCandidates,
  similarQuestions: similar,
}, null, 2));
