#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sessionsDir = path.join(root, 'apps/kotoba-asobo/data/sessions');

const errors = [];
const warnings = [];

const TYPES = new Set(['choice', 'order', 'open', 'reveal', 'pair']);
const REQUIRED_BASE = ['id', 'unitId', 'sessionId', 'type', 'difficulty', 'question', 'facilitationPrompt', 'followUpQuestion', 'estimatedMinutes', 'curriculumTags', 'communicationTags'];
const NUMBER_PREFIX_RE = /^\s*(?:[0-9０-９]+[.)．、]|[①②③④⑤⑥⑦⑧⑨⑩])/;
const CIRCLED_RE = /[①②③④⑤⑥⑦⑧⑨⑩]/;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const HTML_RE = /</;
const BAD_WORDS = [
  '学校', '勉強', '宿題', 'テスト', '成績', '登校', '欠席', '不登校',
  '恋愛', '交際', '告白', '暴力', 'ホラー', '死', '殺', '怖い',
];
const FACT_WORDS = ['雑学', '古典', '由来', '方言', '故事'];
const ANSWER_LEAK_RE = /(答え|正解|解答)/;
const NUMBERS = ['①', '②', '③', '④'];

function report(kind, file, id, message) {
  const line = `${file}${id ? `:${id}` : ''} — ${message}`;
  if (kind === 'ERROR') errors.push(line);
  else warnings.push(line);
}

function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => allStrings(item, out));
  return out;
}

function contentStrings(question) {
  const keys = [
    'question', 'choices', 'answer', 'explanation', 'basicExplanation', 'advancedExplanation',
    'facilitationPrompt', 'followUpQuestion', 'chatCopy', 'steps', 'communicationTags',
  ];
  return keys.flatMap((key) => allStrings(question[key]));
}

function stripRuby(value) {
  return String(value ?? '').replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$1');
}

function checkRubySyntax(text) {
  const raw = String(text ?? '');
  const withoutValid = raw.replace(/\{[^{}|]+\|[^{}|]+\}/g, '');
  return !/[{}|]/.test(withoutValid);
}

function isMissing(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function loadSessions() {
  const sessions = [];
  if (!fs.existsSync(sessionsDir)) return sessions;
  for (const name of fs.readdirSync(sessionsDir).filter((file) => file.endsWith('.js')).sort()) {
    const file = path.join(sessionsDir, name);
    const code = fs.readFileSync(file, 'utf8');
    const context = {
      KotobaAsobo: {
        registerSession(session) {
          sessions.push({ session, file: path.relative(root, file) });
        },
      },
    };
    try {
      vm.runInNewContext(code, context, { filename: file });
    } catch (error) {
      report('ERROR', path.relative(root, file), '', `読み込みに失敗: ${error.message}`);
    }
  }
  return sessions;
}

function validateRequired(question, file) {
  for (const field of REQUIRED_BASE) {
    if (isMissing(question[field])) report('ERROR', file, question.id, `必須フィールド ${field} がありません`);
  }
  if (!TYPES.has(question.type)) report('ERROR', file, question.id, `type が不正です: ${question.type}`);
  if (![1, 2, 3].includes(question.difficulty)) report('ERROR', file, question.id, 'difficulty は 1〜3 です');

  if (question.type === 'choice') {
    if (!Array.isArray(question.choices)) report('ERROR', file, question.id, 'choice は choices が必要です');
    if (typeof question.answerIndex !== 'number') report('ERROR', file, question.id, 'choice は answerIndex が必要です');
  }
  if (question.type === 'pair') {
    if (!Array.isArray(question.choices)) report('ERROR', file, question.id, 'pair は choices が必要です');
    if (isMissing(question.answer)) report('ERROR', file, question.id, 'pair は answer が必要です');
  }
  if (question.type === 'order') {
    if (!Array.isArray(question.choices)) report('ERROR', file, question.id, 'order は choices が必要です');
    if (isMissing(question.answer)) report('ERROR', file, question.id, 'order は answer が必要です');
  }
  if (question.type === 'reveal') {
    if (isMissing(question.answer)) report('ERROR', file, question.id, 'reveal は answer が必要です');
    if (!Array.isArray(question.steps) || question.steps.length === 0) report('ERROR', file, question.id, 'reveal は steps が必要です');
  }
  if (question.type !== 'open') {
    for (const field of ['explanation', 'basicExplanation', 'advancedExplanation']) {
      if (isMissing(question[field])) report('ERROR', file, question.id, `${question.type} は ${field} が必要です`);
    }
  }
}

function validateChoices(question, file) {
  if (Array.isArray(question.choices)) {
    if ((question.type === 'choice' || question.type === 'pair') && (question.choices.length < 2 || question.choices.length > 4)) {
      report('ERROR', file, question.id, 'choices は2〜4件です');
    }
    if (question.type === 'order' && question.choices.length < 2) {
      report('ERROR', file, question.id, 'order の choices は2件以上です');
    }
    question.choices.forEach((choice, index) => {
      if (CIRCLED_RE.test(choice) || NUMBER_PREFIX_RE.test(choice)) {
        report('ERROR', file, question.id, `choices[${index}] に番号が埋め込まれています`);
      }
    });
  }
  if (question.type === 'choice') {
    if (!Number.isInteger(question.answerIndex) || !Array.isArray(question.choices) || question.answerIndex < 0 || question.answerIndex >= question.choices.length) {
      report('ERROR', file, question.id, 'answerIndex が choices の範囲外です');
    }
  }
}

function validateChatCopy(question, file) {
  if (!question.chatCopy) return;
  const lines = String(question.chatCopy).split(/\r?\n/);
  const expectedQuestion = stripRuby(question.question);
  if (lines[0] !== expectedQuestion) {
    report('ERROR', file, question.id, 'chatCopy の1行目が question と一致しません');
  }
  const choices = Array.isArray(question.choices) ? question.choices : [];
  if (choices.length > 0) {
    if (lines.length !== choices.length + 1) {
      report('ERROR', file, question.id, 'chatCopy の行数が choices と一致しません');
    }
    choices.forEach((choice, index) => {
      const expected = `${NUMBERS[index]}${stripRuby(choice)}`;
      if (lines[index + 1] !== expected) {
        report('ERROR', file, question.id, `chatCopy ${index + 2}行目は「${expected}」形式にしてください`);
      }
    });
  }
  if (ANSWER_LEAK_RE.test(question.chatCopy)) {
    report('ERROR', file, question.id, 'chatCopy に答え・正解系の文言が含まれています');
  }
}

function validateText(question, file) {
  for (const text of contentStrings(question)) {
    if (EMOJI_RE.test(text)) report('ERROR', file, question.id, `絵文字または機種依存文字の可能性: ${text}`);
    if (HTML_RE.test(text)) report('ERROR', file, question.id, `HTMLタグ混入の可能性: ${text}`);
    if (!checkRubySyntax(text)) report('ERROR', file, question.id, `ふりがな記法の構文エラー: ${text}`);
    for (const word of BAD_WORDS) {
      if (text.includes(word)) report('WARN', file, question.id, `禁止題材ワード候補「${word}」を含みます`);
    }
  }
}

function validateSources(question, file) {
  const haystack = contentStrings(question).join(' ');
  const factLike = FACT_WORDS.some((word) => haystack.includes(word));
  if (factLike && (isMissing(question.source) || isMissing(question.sourceCheckedAt))) {
    report('ERROR', file, question.id, '事実系タグ・内容には source / sourceCheckedAt が必要です');
  }
  if (question.source && !/^\d{4}-\d{2}-\d{2}$/.test(question.sourceCheckedAt || '')) {
    report('ERROR', file, question.id, 'sourceCheckedAt は YYYY-MM-DD 形式です');
  }
}

function validateSession(entry, globalIds) {
  const { session, file } = entry;
  if (!session || typeof session !== 'object') {
    report('ERROR', file, '', 'セッションオブジェクトではありません');
    return;
  }
  for (const field of ['id', 'unitId', 'number', 'title', 'goal', 'communicationGoal', 'blocks', 'questions']) {
    if (isMissing(session[field])) report('ERROR', file, session.id, `セッション必須フィールド ${field} がありません`);
  }
  const questions = Array.isArray(session.questions) ? session.questions : [];
  const byId = new Map();
  for (const question of questions) {
    if (question.id) {
      if (globalIds.has(question.id)) report('ERROR', file, question.id, 'id が全セッション横断で重複しています');
      globalIds.add(question.id);
      if (byId.has(question.id)) report('ERROR', file, question.id, 'id がセッション内で重複しています');
      byId.set(question.id, question);
    }
    if (question.sessionId !== session.id) report('ERROR', file, question.id, 'sessionId がセッションIDと一致しません');
    if (question.unitId !== session.unitId) report('ERROR', file, question.id, 'unitId がセッションunitIdと一致しません');
    validateRequired(question, file);
    validateChoices(question, file);
    validateChatCopy(question, file);
    validateText(question, file);
    validateSources(question, file);
  }
  const seenItems = new Set();
  const blocks = Array.isArray(session.blocks) ? session.blocks : [];
  const totalMinutes = blocks.reduce((sum, block) => sum + Number(block.estimatedMinutes || 0), 0);
  if (totalMinutes < 43 || totalMinutes > 47) {
    report('ERROR', file, session.id, `blocks の estimatedMinutes 合計は43〜47分です（現在 ${totalMinutes}分）`);
  }
  blocks.forEach((block, blockIndex) => {
    if (!block.part || !block.label || !Array.isArray(block.items)) {
      report('ERROR', file, session.id, `blocks[${blockIndex}] の part/label/items が不足しています`);
    }
    (block.items || []).forEach((id) => {
      seenItems.add(id);
      if (!byId.has(id)) report('ERROR', file, session.id, `blocks.items に存在しない question id があります: ${id}`);
    });
  });
  for (const question of questions) {
    if (!seenItems.has(question.id)) report('ERROR', file, question.id, 'questions にある id が blocks.items に含まれていません');
  }
}

const loaded = loadSessions();
const globalIds = new Set();
loaded.forEach((entry) => validateSession(entry, globalIds));

for (const warning of warnings) console.log(`WARN ${warning}`);
for (const error of errors) console.log(`ERROR ${error}`);

console.log(`checked ${loaded.length} session file(s): ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
