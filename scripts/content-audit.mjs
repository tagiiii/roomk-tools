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

  const hintSource = extractScript(read('apps/hint-de-pinto/index.html'));
  const hintWords = evalArrayFromSource(hintSource, 'WORDS', 'apps/hint-de-pinto/index.html') || [];
  hintWords.forEach((text, index) => rows.push(entry('hint-de-pinto', 'word', text, {
    id: `hint-de-pinto:${index}`,
    question: text,
    answer: text,
  })));

  const codenames = evalModule('apps/codenames/words.js').wordSets || [];
  for (const set of codenames) {
    (set.words || []).forEach((text, index) => rows.push(entry('codenames', set.id, text, {
      id: `codenames:${set.id}:${index}`,
      question: text,
      answer: text,
    })));
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
    group.items.filter((item) => item.tool === 'codenames').length >= 2
  );
});

console.log(JSON.stringify({
  stats: {
    entries: rows.length,
    exactMatchGroups: exactMatches.length,
    structuralMatchGroups: structuralMatches.length,
    similarQuestionPairs: similar.length,
  },
  knownCodenamesDuplicates: detectedKnownCodenames,
  exactMatches,
  structuralMatches,
  similarQuestions: similar,
}, null, 2));
