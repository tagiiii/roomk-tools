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
    pairIndex: extra.pairIndex ?? null,
  };
}

function collectKotobaAsobo() {
  const dir = path.join(root, 'apps/kotoba-asobo/data/sessions');
  if (!fs.existsSync(dir)) return [];
  const sessions = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(dir, file), 'utf8');
    const context = {
      KotobaAsobo: {
        registerSession(session) {
          sessions.push(session);
        },
      },
    };
    vm.runInNewContext(code, context, { filename: file });
  }
  const rows = [];
  for (const session of sessions) {
    for (const q of session.questions || []) {
      const answer = q.type === 'choice' && Array.isArray(q.choices) ? q.choices[q.answerIndex] : q.answer;
      rows.push(entry('kotoba-asobo', q.type, q.question, {
        id: q.id,
        question: q.question,
        answer: answer || q.question,
      }));
      for (const choice of q.choices || []) {
        rows.push(entry('kotoba-asobo', `${q.type}:choice`, choice, {
          id: `${q.id}:choice:${choice}`,
          question: q.question,
          answer: choice,
        }));
      }
    }
  }
  return rows;
}

// ────────────────────────────────────────────────────────────
// カバレッジ・マニフェスト
// 「数えられるコンテンツ（お題・問題・カード）を持つのに collectEntries で
//   抽出していないアプリ」を将来の追加時に取りこぼさないための台帳。
//   tool 名は apps/ 配下のディレクトリ名と一致させる。
// ────────────────────────────────────────────────────────────

// 重複検査でカバー済みのアプリ（collectEntries が entries を生成する）。
const COVERED_APPS = [
  // 既存（A2 以前から抽出済み）
  'quiz', 'kotoba-shuffle', 'kanji-sagashi', 'kotoba-gacha', 'kotoba-relay', 'tatoe-gp',
  'machigai-sagashi', 'kaburazu-hint', 'kotoba-tantei', 'docchi', 'minna-ranking',
  'talk-card', 'otona-talk', 'checkout-card', 'tsuyomi-card', 'kimochi-map', 'bamen-card',
  'mirai-hikidashi', 'kotoba-asobo',
  // A2 で追加した12アプリ
  'jitsuwa-game', 'do-mannaka', 'ishin-denshin', 'word-wolf', 'tatoe-narabe', 'magire-eshi',
  'ikutsu-ieru', 'pittari-meter', 'uso-jisho', 'value-card', 'koedake-theater', 'kyoumi-sugoroku',
];

// 数えられるコンテンツを持たないため重複検査の対象外にするアプリ（意図的除外）。
// 例: 内省ツール・進行支援・スタブ本体など、比較対象になる「お題集」が存在しない。
const NO_CONTENT_APPS = [
  'suki-type-check', 'challenge-tane', 'kakure-number', 'jinro', 'checkin', 'vote',
  'name-change', 'kyapa-graph', 'nurie-week', 'mienai-ganbari', 'sakusen-kaigi',
];

// apps/ 配下に存在するがアプリではないディレクトリ。
// ito / iisen-show / hint-de-pinto / codenames / sukina-map は旧URLからの自動移動スタブ（コンテンツなし）。
// guide はスタッフ向け「ゲームえらび早見表」ページ（お題集を持たない静的な案内ページ）。
const NON_APP_DIRS = ['shared', 'ito', 'iisen-show', 'hint-de-pinto', 'codenames', 'sukina-map', 'guide'];

// 意図的重複 allowlist（C-4 で決着済み）:
//   異なるゲーム間で日常語彙（「カレー」「うさぎ」など）が重複するのは正当。
//   このため exactMatch の分類では「複数の tool にまたがるだけ」のグループは
//   意図的（cross-game）とみなし、同一 tool 内で2件以上重複するグループのみを
//   intraAppExactMatches として「要確認」に分類する（knownCodenamesDuplicates と同型の考え方）。
//   下記は、同一アプリ内で重複していても意図的と確認済みの正規化テキストを明示する枠
//   （現状は空。必要になったら normalize() 済み文字列を追加する）。
const INTENTIONAL_INTRA_APP_DUPLICATES = [];

// 統制語彙: 同一アプリ内で「同じ種類(variant)」の反復が設計どおりで、重複として
// 要確認にしないもの。キーは `tool::variant`。
//   - koedake-theater の situation は感情ラベルの統制語彙で、複数の serifu カードに
//     同じ感情（例「びっくりしている」）を割り当てるのが仕様。serifu 本体（variant=serifu）の
//     重複は引き続き要確認に残す。
const REPEAT_EXPECTED_VARIANTS = new Set([
  'koedake-theater::situation',
]);

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

  const gacha = evalArrayFromSource(read('apps/kotoba-gacha/app.js'), 'QUESTIONS', 'apps/kotoba-gacha/app.js') || [];
  gacha.forEach((item, index) => {
    rows.push(entry('kotoba-gacha', 'template', item.template, {
      id: `kotoba-gacha:${index}`,
      question: item.template,
      answer: (item.choices || []).map((choice) => choice.particle).join('/'),
    }));
  });

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

  const machigai = evalModule('apps/machigai-sagashi/questions.js').QUESTIONS || [];
  machigai.forEach((q, index) => rows.push(entry('machigai-sagashi', q.category, q.modified, {
    id: `machigai-sagashi:${index}`,
    question: q.modified,
    answer: q.answer,
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

  const checkoutQuestions = evalArrayFromSource(read('apps/checkout-card/app.js'), 'QUESTIONS', 'apps/checkout-card/app.js') || [];
  checkoutQuestions.forEach((text, index) => rows.push(entry('checkout-card', 'question', text, {
    id: `checkout-card:${index}`,
  })));

  // 2026-08-06 刷新で CARD_TEXTS（文字列配列）→ CARD_DEFS（{text, icon} 配列）に改名
  const tsuyomiCards = evalArrayFromSource(read('apps/tsuyomi-card/app.js'), 'CARD_DEFS', 'apps/tsuyomi-card/app.js') || [];
  tsuyomiCards.forEach((def, index) => rows.push(entry('tsuyomi-card', 'card', def.text, {
    id: `tsuyomi-card:${index}`,
  })));

  const kimochiGroups = evalArrayFromSource(read('apps/kimochi-map/app.js'), 'GROUPS', 'apps/kimochi-map/app.js') || [];
  for (const group of kimochiGroups) {
    (group.words || []).forEach((word, index) => rows.push(entry('kimochi-map', group.key, word, {
      id: `kimochi-map:${group.key}:${index}`,
    })));
  }

  const bamenSource = read('apps/bamen-card/app.js');
  const bamenHeroes = evalArrayFromSource(bamenSource, 'HEROES', 'apps/bamen-card/app.js') || [];
  bamenHeroes.forEach((item, index) => rows.push(entry('bamen-card', 'hero', item.name, {
    id: `bamen-card:hero:${index}`,
  })));
  const bamenEntries = evalArrayFromSource(bamenSource, 'ENTRY_CARDS', 'apps/bamen-card/app.js') || [];
  bamenEntries.forEach((text, index) => rows.push(entry('bamen-card', 'entry', text, {
    id: `bamen-card:entry:${index}`,
  })));

  const drawers = evalArrayFromSource(read('apps/mirai-hikidashi/app.js'), 'DRAWERS', 'apps/mirai-hikidashi/app.js') || [];
  for (const drawer of drawers) {
    rows.push(entry('mirai-hikidashi', 'drawer', drawer.name, {
      id: `mirai-hikidashi:${drawer.id}`,
      question: drawer.peek || drawer.name,
      answer: drawer.name,
    }));
    (drawer.people || []).forEach((text, index) => rows.push(entry('mirai-hikidashi', `${drawer.id}:people`, text, {
      id: `mirai-hikidashi:${drawer.id}:people:${index}`,
    })));
    (drawer.tries || []).forEach((text, index) => rows.push(entry('mirai-hikidashi', `${drawer.id}:tries`, text, {
      id: `mirai-hikidashi:${drawer.id}:tries:${index}`,
    })));
  }

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

  rows.push(...collectKotobaAsobo());
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
const structuralMatches = grouped(rows, (row) => `${row.tool}:${row.category}:${row.normAnswer}`);
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
  for (const variants of perTool.values()) {
    const counts = [...variants.values()];
    if (counts.some((count) => count >= 2)) sameVariant = true;
    else if (counts.reduce((a, b) => a + b, 0) >= 2) crossVariant = true;
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

console.log(JSON.stringify({
  stats: {
    entries: rows.length,
    exactMatchGroups: exactMatches.length,
    intraAppExactMatchGroups: intraAppExactMatches.length,
    intraAppCrossVariantMatchGroups: intraAppCrossVariantMatches.length,
    structuralMatchGroups: structuralMatches.length,
    similarQuestionPairs: similar.length,
  },
  coverage,
  knownCodenamesDuplicates: detectedKnownCodenames,
  intraAppExactMatches,
  intraAppCrossVariantMatches,
  exactMatches,
  structuralMatches,
  similarQuestions: similar,
}, null, 2));
