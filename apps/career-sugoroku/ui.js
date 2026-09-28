/* キャリアすごろく — 画面
 * 状態は Realtime Database の game（エンジンの状態）だけが正。画面はそれを描くだけで、
 * 確定前の選択（①②③のどれを選んでいるか）だけを端末ごとに持つ。
 * 演出は確定した結果を見せるだけで、進行・獲得・同期の条件にしない。
 */
(function () {
  'use strict';
  const D = window.CS_DATA;
  const E = window.CS_ENGINE;
  const CAP = D.APT_CAP; // 適性の上限（1種類あたりの枚数）
  const B = window.CS_BOARD;
  const N = window.CS_NET;
  const NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
  const SESSION_KEY = 'careersugoroku_session';
  const PREF_KEY = 'careersugoroku_prefs';
  const $ = (id) => document.getElementById(id);
  // 共通の RoomkRTDB.esc（' も置換）。null / undefined は空文字にする
  const esc = (v) => window.RoomkRTDB.esc(v == null ? '' : v);
  const ms = (n) => { const s = Math.max(0, Math.round(n / 1000)); return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`; };

  const S = {
    screen: 'top',
    session: null,
    room: null,
    game: null,
    prevSeq: null,
    lastPos: {},
    stageKey: '',
    sig: {},
    busy: 0,
    sent: {},
    connected: true,
    prefs: { reduce: false, large: false, guide: true },
    ui: {
      createRole: 'play', joinRole: 'player', sel: {}, selV: {}, reselect: {}, proxyOn: false, drawer: false, modal: null,
      handPid: null, handCollapsed: null, actFor: null, idealPage: {}, routePage: {}, confirm: null, revealed: false,
    },
  };

  // ── 表示設定（端末ごと。内省の回答ではない）──────────────
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return !!S.prefs.reduce || motionQuery.matches; }
  function loadPrefs() {
    try { Object.assign(S.prefs, JSON.parse(localStorage.getItem(PREF_KEY)) || {}); } catch (_) { /* 使えなくても既定値で動く */ }
    applyPrefs();
  }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(S.prefs)); } catch (_) { /* noop */ } }
  function applyPrefs() {
    document.body.classList.toggle('cs-reduce', reduced());
    document.body.classList.toggle('cs-large', !!S.prefs.large);
    if (reduced()) { B.stopMotion(); document.getAnimations && document.getAnimations().forEach((a) => a.cancel()); }
  }
  motionQuery.addEventListener && motionQuery.addEventListener('change', () => { applyPrefs(); S.sig = {}; render(); });

  // ── セッション（再接続用。ゲームの回答は入れない）──────────
  function saveSession() { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(S.session)); } catch (_) { /* noop */ } }
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
  function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* noop */ } }

  // ── 共通 ───────────────────────────────────────
  function showScreen(id) {
    if (S.screen !== id) window.scrollTo(0, 0);
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + id));
    S.screen = id;
  }
  function toast(msg, isError) {
    const root = $('toast-root');
    root.replaceChildren();
    const d = document.createElement('div');
    d.className = 'cs-toast' + (isError ? ' cs-toast--error' : '');
    d.setAttribute('role', 'status');
    d.textContent = msg;
    root.appendChild(d);
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => d.remove(), 3200);
  }
  function announce(text) {
    const el = $('live');
    el.textContent = '';
    setTimeout(() => { el.textContent = text; }, 30);
  }
  function formError(id, msg) { const el = $(id); el.textContent = msg || ''; el.hidden = !msg; }
  let composing = false; // 日本語入力（IME）の変換中
  function patch(id, html) {
    if (S.sig[id] === html) return false;
    const el = $(id);
    if (!el) return false;
    const active = document.activeElement;
    const inside = !!active && el.contains(active);
    if (composing && inside) { S.pendingRender = true; return false; } // 変換が終わってから描き直す
    // 入力中の値・カーソル位置・開いている折りたたみを保つ（ほかの人の参加などで消えないように）
    const kept = {};
    el.querySelectorAll('input[id]:not([type="checkbox"]), textarea[id]').forEach((n) => { kept[n.id] = { v: n.value, a: n.selectionStart, b: n.selectionEnd }; });
    const opened = new Set(Array.from(el.querySelectorAll('details[data-keep]')).filter((d) => d.open).map((d) => d.dataset.keep));
    const fk = inside && active.dataset ? active.dataset.fk : null;
    const focusedId = inside && active.id ? active.id : null;
    S.sig[id] = html;
    el.innerHTML = html;
    Object.entries(kept).forEach(([nid, st]) => {
      const n = document.getElementById(nid);
      if (n && el.contains(n) && st.v && !n.value) n.value = st.v;
    });
    el.querySelectorAll('details[data-keep]').forEach((d) => { if (opened.has(d.dataset.keep)) d.open = true; });
    if (focusedId && document.getElementById(focusedId)) {
      const n = document.getElementById(focusedId);
      n.focus({ preventScroll: true });
      const st = kept[focusedId];
      if (st && st.a != null && n.setSelectionRange) { try { n.setSelectionRange(st.a, st.b); } catch (_) { /* noop */ } }
    } else if (fk) {
      const again = el.querySelector('[data-fk="' + CSS.escape(fk) + '"]');
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
    return true;
  }
  function play(node, frames, duration, delay) {
    if (!node || reduced() || typeof node.animate !== 'function' || node.getClientRects().length === 0) return;
    node.animate(frames, { duration, delay: delay || 0, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' });
  }

  // ── 立場 ───────────────────────────────────────
  const G = () => S.game;
  const myId = () => (S.session ? S.session.id : null);
  const isHost = () => !!S.session && S.session.role === 'host';
  const isSpectator = () => !!S.session && S.session.role === 'spectator';
  function myPid() {
    const g = G();
    if (!g || !S.session || S.session.role === 'spectator') return null;
    return g.players[S.session.id] ? S.session.id : null;
  }
  function canControl(pid) {
    const g = G();
    if (!g || !pid || !S.session || isSpectator()) return false;
    if (pid === myPid()) return true;
    if (!isHost()) return false;
    const p = g.players[pid];
    return !!p && (p.ctrl === 'host' || S.ui.proxyOn);
  }
  const player = (pid) => (G() ? G().players[pid] : null);
  function nameOf(pid) {
    const g = G();
    if (!g) return '';
    if (g.players[pid]) return g.players[pid].name;
    if (g.host.id === pid) return g.host.name;
    return '？';
  }
  const colorOf = (pid) => { const p = player(pid); return p ? D.PLAYER_COLORS[p.color % D.PLAYER_COLORS.length] : '#8A96A0'; };
  function sanName(pid) { return pid === myPid() ? 'あなた' : `${nameOf(pid)}さん`; }
  function isOnline(pid) {
    const p = player(pid);
    if (!p) return false;
    if (p.ctrl === 'host') return true;
    return !!(S.room && S.room.presence && S.room.presence[pid]);
  }

  // ── 送信 ───────────────────────────────────────
  const REASONS = {
    started: 'ゲームはもう始まっています', full: '参加できるのは8人までです', nameTaken: 'そのニックネームはもう使われています',
    name: 'ニックネームは1〜8文字で入れてね', notReady: 'まだ選んでいる人がいます', auth: 'この操作はできません',
    value: 'その選択はできません', gone: 'ルームが見つかりません', none: 'ルームが見つかりません', expired: 'このルームは終わっています',
    watchFull: `見学できるのは${N.SPECTATOR_CAP}人までです（画面共有で見ることはできます）`, noPlayers: 'プレイヤーが1人以上必要です', used: '延長はこの手番ではもう使いました',
    resting: '休憩中は選べません。「戻る」を押してね',
  };
  async function send(action, opts) {
    if (!S.session) return { ok: false };
    const a = Object.assign({}, action, { by: myId() }); // 送信者は呼び出し側で上書きできない
    S.busy += 1;
    document.body.classList.add('cs-busy');
    try {
      const r = await N.dispatch(S.session.code, a);
      if (!r.ok && !['stale', 'same', 'early', 'paused'].includes(r.reason) && !(opts && opts.quiet)) toast(REASONS[r.reason] || 'うまく送れませんでした。もう一度押してね', true);
      return r;
    } catch (err) {
      console.error(err);
      if (!(opts && opts.quiet)) toast('通信がうまくいきませんでした。もう一度押してね', true);
      return { ok: false };
    } finally {
      S.busy -= 1;
      if (S.busy <= 0) { S.busy = 0; document.body.classList.remove('cs-busy'); }
    }
  }
  // 画面で見た手番と段階が変わっていたら受け付けない（連打・二重送信対策）。スキップ・延長は手番だけ
  const turnGuard = () => (G() && G().turn ? { turn: G().turn.id, stage: G().turn.stage } : undefined);
  const turnOnly = () => (G() && G().turn ? { turn: G().turn.id } : undefined);

  // ── 部品 ───────────────────────────────────────
  function aptIcon(a, small) {
    const apt = D.APTS[a];
    return `<span class="cs-apt__icon${small ? ' cs-apt__icon--sm' : ''}" style="background:${apt.tint};color:${apt.color}" aria-hidden="true"><span class="material-symbols-rounded">${apt.icon}</span></span>`;
  }
  function aptChip(a, small) {
    return `<span class="cs-apt" style="color:${D.APTS[a].color}">${aptIcon(a, small)}<span>${esc(D.APTS[a].name)}</span></span>`;
  }
  function pipsHTML(count, color, previewAdd) {
    let h = `<span class="cs-pips" style="color:${color}" aria-hidden="true">`;
    for (let i = 0; i < CAP; i++) {
      const on = i < count;
      const nw = !on && previewAdd && i < count + previewAdd;
      h += `<span class="cs-pip${on ? ' is-on' : ''}${nw ? ' is-new is-on' : ''}"></span>`;
    }
    return h + '</span>';
  }
  function avatarHTML(pid, small) {
    const n = nameOf(pid);
    return `<span class="cs-avatar${small ? ' cs-avatar--sm' : ''}" style="background:${colorOf(pid)}" aria-hidden="true">${esc(Array.from(n)[0] || '?')}</span>`;
  }
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieHTML(n, small, anim) {
    if (!n) return `<div class="cs-die cs-die--q${small ? ' cs-die--sm' : ''}" role="img" aria-label="まだ振っていないサイコロ">?</div>`;
    let h = `<div class="cs-die${small ? ' cs-die--sm' : ''}" role="img" aria-label="出目 ${n}"${anim ? ` data-anim="${esc(anim)}"` : ''}>`;
    for (let i = 0; i < 9; i++) h += `<span class="cs-die__pip${PIPS[n].includes(i) ? ' is-on' : ''}"></span>`;
    return h + '</div>';
  }
  function chipsHTML(pid) {
    const p = player(pid);
    if (!p) return '';
    const total = Math.max(G().settings.chips, p.chips);
    let dots = '';
    for (let i = 0; i < total; i++) dots += `<span class="cs-chips__dot${i < p.chips ? ' is-on' : ''}"></span>`;
    return `<span class="cs-chips" title="時間チップ"><span class="material-symbols-rounded" aria-hidden="true" style="font-size:16px">schedule</span><span class="cs-chips__dots" aria-hidden="true">${dots}</span><span>時間チップ あと${p.chips}</span></span>`;
  }
  function eventHTML({ label, icon, q, sub, art, artTint, artColor, id }) {
    return `<div class="cs-event"${id ? ` id="${id}"` : ''}>
      ${art ? `<div class="cs-event__art" style="background:${artTint};color:${artColor}"><span class="material-symbols-rounded" aria-hidden="true">${art}</span></div>` : ''}
      <div class="cs-event__label">${icon ? `<span class="material-symbols-rounded" aria-hidden="true">${icon}</span>` : ''}${esc(label)}</div>
      <h2 class="cs-event__q" tabindex="-1">${q}</h2>
      ${sub ? `<p class="cs-event__sub">${sub}</p>` : ''}
    </div>`;
  }
  // 選択肢ボタン。text / meta は呼び出し側でエスケープ済みの HTML
  function choiceHTML(o) {
    const act = o.readonly ? ' tabindex="-1" aria-disabled="true"' : ` data-act="sel" data-key="${esc(o.key)}" data-i="${o.i}"${o.pid ? ` data-pid="${esc(o.pid)}"` : ''}${o.v != null ? ` data-v="${esc(o.v)}"` : ''}`;
    return `<button type="button" class="cs-choice${o.readonly ? ' is-readonly' : ''}" aria-pressed="${o.pressed ? 'true' : 'false'}"${o.disabled ? ' disabled' : ''}${act} data-fk="${esc(o.key)}:${o.i}">
      <span class="cs-choice__num"><span aria-hidden="true">${NUMS[o.i] || ''}</span><span class="cs-sr">${o.i + 1}番 </span></span>
      <span class="cs-choice__body"><span class="cs-choice__text">${o.text}</span>${o.meta ? `<span class="cs-choice__meta">${o.meta}</span>` : ''}</span>
      <span class="cs-choice__check">${o.pressed ? '選択中' : ''}</span>
    </button>`;
  }
  function selOf(key, pid) {
    if (canControl(pid)) return S.ui.sel[key];
    const c = S.room && S.room.cursor && S.room.cursor[pid];
    return c && c.k === key ? Number(c.i) : undefined;
  }
  // 値で選ぶ選択（さそう相手など、並びが変わりうるもの）
  function selValOf(key, pid) {
    if (canControl(pid)) return S.ui.selV[key];
    const c = S.room && S.room.cursor && S.room.cursor[pid];
    return c && c.k === key && c.v != null ? String(c.v) : undefined;
  }
  function jobCardHTML(jobId, o) {
    o = o || {};
    const job = D.JOBS[jobId];
    const core = D.APTS[job.core];
    const apt = o.apt;
    const sc = apt ? E.score(apt, jobId) : null;
    const slots = [[job.core, 2], [job.rel[0], 1], [job.rel[1], 1]].map(([a, w]) => `
      <div class="cs-slot">${aptIcon(a, true)}<span class="cs-slot__name">${esc(D.APTS[a].name)}</span>${apt ? pipsHTML(apt[a], D.APTS[a].color) : ''}<span class="cs-slot__w">×${w}</span></div>`).join('');
    const ribbons = (o.ribbons || []).map((r) => `<span class="cs-ribbon${r === '目標' ? ' cs-ribbon--goal' : ''}">${esc(r)}</span>`).join('');
    const scoreRow = sc && o.score !== false ? `<div class="cs-job__score"><span>いまの手札で${sc.bonus ? '（3種類そろい＋3）' : ''}</span><span><strong>${sc.total}</strong>点</span></div>` : '';
    const inner = `
      <span class="cs-job__band" style="background:${core.tint};color:${core.color}">
        ${o.num != null ? `<span class="cs-job__num" aria-hidden="true">${NUMS[o.num]}</span>` : ''}
        <span class="material-symbols-rounded" aria-hidden="true">${job.icon}</span>
        ${ribbons ? `<span class="cs-job__ribbons">${ribbons}</span>` : ''}
      </span>
      <span class="cs-job__name">${esc(job.name)}</span>
      ${o.mini ? '' : `<span class="cs-job__desc">${esc(job.desc)}</span>`}
      <span class="cs-job__slots">${slots}</span>
      ${scoreRow}`;
    const label = `${o.num != null ? (o.num + 1) + '番 ' : ''}${job.name}${sc ? ` いまの手札で${sc.total}点` : ''}`;
    if (o.key != null && !o.readonly) {
      return `<button type="button" class="cs-job cs-job--pick${o.mini ? ' cs-job--mini' : ''}" data-act="sel" data-key="${esc(o.key)}" data-i="${o.i}"${o.pid ? ` data-pid="${esc(o.pid)}"` : ''} aria-pressed="${o.pressed ? 'true' : 'false'}" aria-label="${esc(label)}"${o.disabled ? ' disabled' : ''} data-fk="${esc(o.key)}:${o.i}"${o.anim ? ` data-anim="${esc(o.anim)}"` : ''}>${inner}</button>`;
    }
    return `<div class="cs-job${o.mini ? ' cs-job--mini' : ''}" role="group" aria-label="${esc(label)}"${o.pressed ? ' aria-current="true" style="border:2.5px solid var(--color-accent)"' : ''}${o.anim ? ` data-anim="${esc(o.anim)}"` : ''}>${inner}</div>`;
  }
  function stepsHTML(active) {
    const names = ['理想の職業', '最初の適性', '当面の目標'];
    return `<div class="cs-steps" aria-label="準備の段階">${names.map((n, i) => `<span class="cs-step${i === active ? ' is-on' : i < active ? ' is-done' : ''}">${i + 1}. ${n}</span>`).join('')}</div>`;
  }
  function noticeHTML(title, text, icon, extra) {
    return `<div class="cs-notice"><p class="cs-notice__title">${icon ? `<span class="material-symbols-rounded" aria-hidden="true">${icon}</span>` : ''}${title}</p>${text ? `<p class="cs-notice__text">${text}</p>` : ''}${extra || ''}</div>`;
  }
  function quietBtn(act, label, icon, data) {
    const attrs = Object.entries(data || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    return `<button type="button" class="cs-quiet" data-act="${act}"${attrs} data-lock="1" data-fk="q-${esc(act)}-${esc((data && data.pid) || '')}">${icon ? `<span class="material-symbols-rounded" aria-hidden="true">${icon}</span>` : ''}${esc(label)}</button>`;
  }
  function primaryBtn(act, label, disabled, data, cls) {
    const attrs = Object.entries(data || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    return `<button type="button" class="cs-btn ${cls || 'cs-btn--primary'} cs-btn--full" data-act="${act}"${attrs}${disabled ? ' disabled' : ''} data-lock="1" data-fk="btn-${act}">${esc(label)}</button>`;
  }
  // ガイド: その適性が目標の職業でどう効くか（中心×2／関連×1）と、ふえる点
  function goalTagsHTML(p, a, n, prefix) {
    if (!S.prefs.guide || !p || p.goal < 0 || !D.JOBS[p.goal]) return '';
    const role = E.aptRole(p.goal, a);
    const d = E.gainDelta(p.apt, p.goal, a, n || 1);
    const roleTag = role === 'core' ? '<span class="cs-tag cs-tag--goal">目標の中心×2</span>'
      : role === 'rel' ? '<span class="cs-tag cs-tag--goal2">目標の関連×1</span>' : '<span class="cs-tag">目標には入っていない</span>';
    return roleTag + (d > 0 ? `<span class="cs-tag cs-tag--goal">${prefix || ''}目標の点＋${d}</span>` : '');
  }
  function goalLine(p) {
    if (!p || p.goal < 0 || !D.JOBS[p.goal]) return '';
    return `目標は「${esc(D.JOBS[p.goal].name)}」（いま${E.score(p.apt, p.goal).total}点）。`;
  }
  function guideHTML(text, extra) {
    if (!S.prefs.guide) return '';
    return `<div class="cs-guide" role="note"><span class="material-symbols-rounded" aria-hidden="true">tips_and_updates</span><div><p>${text}</p>${extra || ''}</div></div>`;
  }
  function tagsFor(p, a, opts) {
    const tags = [];
    if (p.apt[a] >= CAP) tags.push(`<span class="cs-tag cs-tag--full">もう${CAP}枚</span>`);
    else if (p.apt[a] === 0) tags.push('<span class="cs-tag cs-tag--new">初めて！</span>');
    if (opts && opts.roll) {
      if (p.apt[a] > 0 && p.apt[a] < CAP) tags.push('<span class="cs-tag cs-tag--plus">持っている＋1</span>');
      if (p.life.left > 0 && p.life.apt >= 0) {
        tags.push(p.life.apt === a ? '<span class="cs-tag cs-tag--plus">暮らし＋1</span>' : '<span class="cs-tag cs-tag--minus">暮らし−1</span>');
      }
    } else if (p.apt[a] > 0 && p.apt[a] < CAP) tags.push('<span class="cs-tag cs-tag--plus">＋1枚</span>');
    return tags.join('') + goalTagsHTML(p, a, opts && opts.roll ? 2 : 1, opts && opts.roll ? '成功で' : '');
  }
  function proxyBanner(pid) {
    if (!isHost() || pid === myPid() || !canControl(pid)) return '';
    return `<div class="cs-proxy-banner"><span class="material-symbols-rounded" aria-hidden="true">record_voice_over</span>${esc(nameOf(pid))}さんの代わりに操作中（本人が選んだ番号を押してね）</div>`;
  }

  // ── 画面の振り分け ───────────────────────────────
  function render() {
    const g = G();
    if (!g || !S.session) return;
    if (g.phase === 'lobby') {
      showScreen('lobby');
      renderLobby();
    } else {
      showScreen('game');
      renderBar();
      const results = g.phase === 'results';
      $('game-main').classList.toggle('cs-main--focus', g.phase === 'setup' || g.phase === 'final');
      $('game-main').hidden = results;
      $('results').hidden = !results;
      if (results) renderResults();
      else {
        renderBoard();
        renderStage();
        renderHand();
        renderNear();
        renderPeople();
      }
    }
    renderDrawer();
    renderOverlay();
    renderModal();
  }

  // ── 待合室 ─────────────────────────────────────
  function renderLobby() {
    const g = G();
    const code = S.session.code;
    const players = E.playersInSeat(g);
    const specs = Object.entries((S.room && S.room.spectators) || {});
    const n = players.length;
    const s = g.settings;
    const peopleHTML = players.map((p) => `
      <li class="cs-person">
        <span class="cs-avatar" style="background:${D.PLAYER_COLORS[p.seat % 8]}" aria-hidden="true">${esc(Array.from(p.name)[0] || '?')}</span>
        <span class="cs-person__name">${esc(p.name)}${p.id === myPid() ? '（あなた）' : ''}</span>
        <span class="cs-person__tag">${p.isHost ? 'ホスト' : p.ctrl === 'host' ? '端末なし（ホストが操作）' : isOnline(p.id) ? '' : '通信が切れています'}</span>
        ${isHost() && !p.isHost ? `<button class="cs-quiet" data-act="removePlayer" data-pid="${esc(p.id)}" aria-label="${esc(p.name)}さんを外す" data-fk="rm-${esc(p.id)}">外す</button>` : ''}
      </li>`).join('') || '<li class="cs-help">まだだれもいません</li>';
    const specHTML = specs.length ? specs.map(([, sp]) => `<li class="cs-person"><span class="cs-avatar cs-avatar--ghost" aria-hidden="true"><span class="material-symbols-rounded" style="font-size:18px">visibility</span></span><span class="cs-person__name">${esc((sp && sp.name) || '見学の人')}</span></li>`).join('') : '<li class="cs-help">見学の人はいません</li>';
    const codeBox = `<div class="cs-code"><div><div class="cs-code__label">ルームコード</div><div class="cs-code__value">${esc(code)}</div></div><button class="cs-btn" data-act="copyCode">コードをコピー</button></div>`;

    if (!isHost()) {
      const rows = [
        ['時間チップ', `1人${s.chips}枚`], ['選ぶ時間', s.timerSec ? `${s.timerSec}秒` : '制限なし'],
        ['暮らしのイベント', s.life ? 'あり' : 'なし'], ['進路のラウンド', s.career ? `${s.career}回` : 'なし'],
      ];
      patch('lobby-root', `<div class="cs-center"><div class="cs-panel cs-stack">
        <h2 class="cs-title" style="font-size:24px">${isSpectator() ? '見学の待合室' : '待合室'}</h2>
        ${codeBox}
        ${noticeHTML('ホストが始めるのを待っています', isSpectator() ? '見学中です。ゲームが始まると画面が切り替わります。' : 'ゲームが始まると画面が切り替わります。待っている間に「はじめてガイド」を見てね。', 'hourglass_top', `<div style="margin-top:10px"><button type="button" class="cs-btn cs-btn--secondary cs-btn--full" data-act="openGuide" data-fk="lobby-guide">はじめてガイドを見る</button></div>`)}
        <div><p class="cs-sec-title">参加する人 ${n}人</p><ul class="cs-people">${peopleHTML}</ul></div>
        <div><p class="cs-sec-title">見学の人 ${specs.length}人</p><ul class="cs-people">${specHTML}</ul></div>
        <div class="cs-metrics">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>
        <button class="cs-quiet" data-act="exitRoom">退出する</button>
      </div></div>`);
      return;
    }

    const seg = (key, options, cur) => `<div class="cs-seg cs-seg--wrap" role="group">${options.map(([v, label]) => `<button type="button" data-act="setting" data-k="${key}" data-v="${esc(String(v))}" aria-pressed="${String(v) === String(cur)}" data-fk="set-${key}-${esc(String(v))}">${label}</button>`).join('')}</div>`;
    const rec = E.recommendedChips(Math.max(1, n));
    const est = E.estimateMinutes(s, Math.max(1, n));
    const plan = E.careerRounds(s.chips, s.career);
    const planText = Object.keys(plan).length ? Object.entries(plan).map(([r, st]) => `${r}周目に${st === 'early' ? '最初の進路' : '次の進路'}`).join('、') : '進路のラウンドはありません';
    patch('lobby-root', `<div class="cs-lobby">
      <div class="cs-stack">
        ${codeBox}
        <div class="cs-card cs-stack">
          <div>
            <p class="cs-sec-title"><span class="material-symbols-rounded" aria-hidden="true">group</span>参加する人 ${n}人 <span class="cs-help">（8人まで）</span></p>
            <ul class="cs-people">${peopleHTML}</ul>
          </div>
          <form class="cs-stack" id="form-proxy" novalidate>
            <label class="cs-field__label" for="proxy-name">端末なしで参加する人を追加</label>
            <div class="cs-inline-form"><input class="cs-input" id="proxy-name" maxlength="8" placeholder="ニックネーム" autocomplete="off" /><button class="cs-btn cs-btn--secondary" type="submit">追加</button></div>
            <p class="cs-help">画面共有を見ながら番号を言ってもらい、ホストが代わりに押す人です。</p>
            <p class="cs-form-error" id="proxy-error" hidden></p>
          </form>
          <div>
            <p class="cs-sec-title"><span class="material-symbols-rounded" aria-hidden="true">visibility</span>見学の人 ${specs.length}人 <span class="cs-help">（${N.SPECTATOR_CAP}人まで）</span></p>
            <ul class="cs-people">${specHTML}</ul>
            <p class="cs-help">見学の人は、手番・時間チップ・得点の対象になりません。</p>
          </div>
        </div>
      </div>
      <div class="cs-card">
        <p class="cs-sec-title"><span class="material-symbols-rounded" aria-hidden="true">tune</span>ゲームの設定</p>
        <div class="cs-setting">
          <div class="cs-setting__head"><span class="cs-setting__name">あなた（ホスト）は</span></div>
          ${seg('hostPlays', [['1', '自分も参加する'], ['0', '進行だけする']], g.host.plays ? '1' : '0')}
        </div>
        <div class="cs-setting">
          <div class="cs-setting__head"><span class="cs-setting__name">時間チップ（1人の手番の回数）</span><span class="cs-help">${n}人のおすすめ: ${rec}枚${s.chipsAuto ? '（自動）' : ''}</span></div>
          ${seg('chips', D.CHIP_OPTIONS.map((c) => [c, `${c}枚`]), s.chips)}
          ${!s.chipsAuto ? `<button class="cs-quiet" data-act="setting" data-k="chipsAuto" data-v="1">人数に合わせる</button>` : ''}
        </div>
        <div class="cs-setting">
          <div class="cs-setting__head"><span class="cs-setting__name">選ぶ時間（1手番の合計）</span></div>
          ${seg('timerSec', D.TIMER_OPTIONS.map((t) => [t, t ? `${t}秒` : '制限なし']), s.timerSec)}
          <p class="cs-help">時間を決めると、1手番に1回だけ「もう少し考える」で15秒のばせます。時間切れでも減点はありません。</p>
        </div>
        <div class="cs-setting">
          <div class="cs-setting__head"><span class="cs-setting__name">暮らしのイベント</span></div>
          ${seg('life', [['1', 'あり'], ['0', 'なし']], s.life ? '1' : '0')}
        </div>
        <div class="cs-setting">
          <div class="cs-setting__head"><span class="cs-setting__name">進路のラウンド（全員で同時に選ぶ）</span></div>
          ${seg('career', [[0, 'なし'], [1, '1回'], [2, '2回']], s.career)}
          <p class="cs-help">${esc(planText)}。その周は全員が時間チップ1枚で進路と体験を選びます。</p>
        </div>
        <div class="cs-setting">
          <div class="cs-setting__head"><span class="cs-setting__name">最後の仕上げ</span></div>
          <p class="cs-help">${esc(finalRuleText(s.endRule))}</p>
        </div>
        <div class="cs-estimate"><span class="material-symbols-rounded" aria-hidden="true">timer</span><span>目安 <strong>約${est}分</strong>（計算値。実際の時間は試遊で確かめる）</span></div>
        ${primaryBtn('start', 'はじめる', n < 1)}
        <p class="cs-help" style="text-align:center;margin-top:8px">プレイヤー${n}人${g.host.plays ? '（ホストを含む）' : ''}・見学${specs.length}人</p>
        <div class="cs-quietrow">${quietBtn('openGuide', 'はじめてガイド', 'menu_book')}${quietBtn('closeRoom', 'ルームを閉じてトップへ戻る', 'close')}</div>
      </div>
    </div>`);
  }
  function finalRuleText(rule) {
    if (rule === 'present') return '職業を決めたら、全員が「仕上げのサイコロ」。出目＋準備チップ（1枚で＋1・2枚まで）で0〜3点をプラス。加わるのは3点までなので、3点以上の差は逆転しない（3点差は同点まで）。';
    return '仕上げのサイコロなし。最後の職業の点数だけで結果を出す。';
  }

  // ── ゲーム上部のバー ─────────────────────────────
  function phaseLabel(g) {
    if (g.phase === 'setup') return '準備';
    if (g.phase === 'main') {
      if (g.career) return `進路のラウンド（${D.CAREERS[g.career.stage].title}）`;
      return `ラウンド ${g.round}${g.lastLap !== null ? '・最後の1周' : ''}`;
    }
    if (g.phase === 'final') return '最後の職業選び';
    return '結果発表';
  }
  function renderBar() {
    const g = G();
    const specs = Object.keys((S.room && S.room.spectators) || {}).length;
    const people = g.order.map((pid) => `<span title="${esc(nameOf(pid))}" style="opacity:${player(pid).status === 'left' ? 0.4 : 1}">${avatarHTML(pid, true)}</span>`).join('');
    patch('game-bar', `
      <div class="cs-bar__brand"><span class="cs-bar__title">${esc(D.GAME_TITLE)}</span></div>
      <span class="cs-bar__phase"><strong>${esc(phaseLabel(g))}</strong>${g.paused ? ' <span class="cs-badge">一時停止中</span>' : ''}${isSpectator() ? ' <span class="cs-badge cs-badge--accent">見学中</span>' : ''}</span>
      <span class="cs-bar__spacer"></span>
      <span class="cs-bar__people" aria-label="プレイヤー">${people}</span>
      <span class="cs-bar__watch" title="見学の人"><span class="material-symbols-rounded" aria-hidden="true" style="font-size:18px">visibility</span>${specs}</span>
      <button class="cs-iconbtn" data-act="openGuide" aria-label="はじめてガイド" data-fk="bar-guide"><span class="material-symbols-rounded" aria-hidden="true">help</span><span class="cs-iconbtn__label">ガイド</span></button>
      <button class="cs-iconbtn" data-act="openPrefs" aria-label="表示と参加の設定"><span class="material-symbols-rounded" aria-hidden="true">settings</span></button>
      ${isHost() ? `<button class="cs-iconbtn cs-iconbtn--host" data-act="drawer" aria-expanded="${S.ui.drawer}"><span class="material-symbols-rounded" aria-hidden="true">tune</span><span class="cs-iconbtn__label">進行</span></button>` : ''}
    `);
  }

  // ── 盤面 ───────────────────────────────────────
  function renderBoard() {
    const g = G();
    const cur = g.turn ? g.turn.pid : null;
    B.update(g.order.map((pid) => {
      const p = player(pid);
      return { id: pid, name: p.name, color: colorOf(pid), pos: p.pos, current: pid === cur, dim: p.status !== 'active' };
    }));
  }
  function renderNear() {
    const g = G();
    const pid = (g.turn && g.turn.pid) || handPid();
    const p = player(pid);
    if (!p) { patch('near', ''); return; }
    const here = D.NODES[p.pos];
    const sqChip = (nodeId, label, isHere) => {
      const n = D.NODES[nodeId];
      const sq = D.SQUARES[n.type];
      return `<button type="button" class="cs-nearsq${isHere ? ' is-here' : ''}" data-act="tile" data-node="${nodeId}" aria-label="${esc(B.tileLabel(n))}"><span class="cs-nearsq__n">${esc(label)}</span><span class="material-symbols-rounded" style="color:${sq.color}" aria-hidden="true">${sq.icon}</span>${esc(sq.name)}</button>`;
    };
    const items = B.ahead(p.pos, 5);
    let rows = `<div class="cs-nearlist">${sqChip(here.id, 'いま', true)}`;
    let forkRows = '';
    items.forEach((it) => {
      if (it.fork != null) {
        const base = items.length - 1;
        forkRows = B.branchPreview(it.fork, 3).map((br, b) => `<div class="cs-nearlist"><span class="cs-tag" style="align-self:center;white-space:nowrap">${esc((D.FORK_LABELS[it.fork] || [])[b] || '道' + (b + 1))}</span>${br.map((nd, k) => sqChip(nd, `${base + k + 1}マス先`, false)).join('')}</div>`).join('');
      } else rows += sqChip(it.node, `${it.step}マス先`, false);
    });
    rows += '</div>';
    patch('near', `<div class="cs-hand__head"><span class="cs-hand__title">${esc(sanName(pid))}の近くのマス</span><button class="cs-quiet" data-act="openMap" style="margin-left:auto"><span class="material-symbols-rounded" aria-hidden="true">map</span>マップ全体</button></div>${rows}${forkRows ? `<p class="cs-help">この先に分かれ道</p>${forkRows}` : ''}`);
  }

  // ── 手番・準備・進路・終盤のパネル ───────────────────────
  function renderStage() {
    const g = G();
    let html = '';
    if (g.phase === 'setup') html = stageSetup();
    else if (g.phase === 'main') html = g.hold ? stageHold() : g.career ? stageCareer() : g.turn ? stageTurn() : '';
    else if (g.phase === 'final') html = stageFinal();
    const key = [g.phase, g.turn && g.turn.id, g.turn && g.turn.stage, g.career && g.career.round, g.hold].join(':');
    const changed = patch('stage', html);
    if (S.prevSeq === null) { S.stageKey = key; return; } // 最初の表示・再接続では演出しない
    if (changed && key !== S.stageKey) {
      S.stageKey = key;
      const first = $('stage').firstElementChild;
      play(first, [{ transform: 'translateY(8px)', opacity: 0.6 }, { transform: 'translateY(0)', opacity: 1 }], 200);
      // 自分が決める場面が出たら、キーボード・読み上げの位置を問いへ（ほかを操作中なら動かさない）
      const me = myPid();
      const a = document.activeElement;
      if (me && E.pendingFor(g, me) && (!a || a === document.body || $('stage').contains(a))) {
        const h = $('stage').querySelector('.cs-event__q');
        if (h) h.focus({ preventScroll: true });
      }
    }
  }

  function whoTabs(pids, who, pendingFn) {
    if (pids.length <= 1) return '';
    return `<div class="cs-whotabs" role="group" aria-label="だれの選択を進めるか">${pids.map((pid) => `<button type="button" class="cs-chip-btn" data-act="actFor" data-pid="${esc(pid)}" aria-pressed="${pid === who}" data-fk="tab-${esc(pid)}">${avatarHTML(pid, true)}${esc(pid === myPid() ? 'あなた' : nameOf(pid))}${pendingFn(pid) ? '' : ' <span class="material-symbols-rounded" aria-hidden="true" style="font-size:16px;color:var(--color-success)">check_circle</span>'}</button>`).join('')}</div>`;
  }
  function pickWho(pids, pendingFn) {
    if (S.ui.actFor && pids.includes(S.ui.actFor) && pendingFn(S.ui.actFor)) return S.ui.actFor;
    const me = myPid();
    if (me && pids.includes(me) && pendingFn(me)) return me;
    const first = pids.find(pendingFn);
    if (first) return first;
    if (S.ui.actFor && pids.includes(S.ui.actFor)) return S.ui.actFor;
    return me && pids.includes(me) ? me : pids[0] || null;
  }
  function progressHTML(title, rows) {
    return `<div class="cs-card"><p class="cs-sec-title" style="font-size:15px">${esc(title)}</p><ul class="cs-progress">${rows.map(([pid, label, cls]) => `<li>${avatarHTML(pid, true)}<span>${esc(nameOf(pid))}${pid === myPid() ? '（あなた）' : ''}</span><span class="cs-state ${cls || ''}">${esc(label)}</span></li>`).join('')}</ul></div>`;
  }
  function myStatusNotice() {
    const me = myPid();
    const p = me && player(me);
    if (!p || G().phase !== 'main') return '';
    if (p.status === 'resting') {
      return noticeHTML('しばらく見学中', 'カードはそのまま。休んでいる間も、自分の番がくると時間チップを1枚使います。', 'weekend', `<div style="margin-top:12px">${primaryBtn('back', '次の自分の番から戻る', false, { pid: me })}</div>`);
    }
    if (p.status === 'left') {
      return noticeHTML('今回の参加を終えました', '最後の職業選びには参加できます。カードはそのままです。', 'logout', `<div style="margin-top:8px">${quietBtn('back', 'もう一度参加する', 'undo', { pid: me })}</div>`);
    }
    return '';
  }

  // 準備（理想 → 配布 → 当面の目標）
  function idealOrder(pid) {
    const seed = Array.from(pid).reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return E.makeRng(seed).shuffle(D.JOBS.map((j) => j.id));
  }
  function setupState(pid) {
    const p = player(pid);
    if (p.status === 'left') return ['参加を終えた', 'cs-state--off'];
    return {
      ideal: ['理想を選んでいます', ''], deal: ['カードを確認しています', ''], goal: ['目標を選んでいます', ''], done: ['準備OK', 'cs-state--done'],
    }[p.setup.step];
  }
  function stageSetup() {
    const g = G();
    const pending = (pid) => player(pid).setup.step !== 'done';
    const ctl = g.order.filter((pid) => canControl(pid));
    const who = pickWho(ctl, pending);
    let html = '';
    if (isHost()) html += whoTabs(ctl, who, pending);
    if (who) html += setupPanel(who);
    else html += noticeHTML('プレイヤーが準備をしています', '理想の職業、最初の適性カード、当面の目標の順に選んでいます。', 'hourglass_top');
    html += progressHTML('準備の進み具合', g.order.map((pid) => [pid, ...setupState(pid)]));
    if (isHost()) {
      const waiting = g.order.filter((pid) => player(pid).status === 'active' && pending(pid));
      html += `<div class="cs-card cs-actions">${waiting.length
        ? `${primaryBtn('begin', '締め切ってはじめる', false, { force: 1 }, 'cs-btn--secondary')}<p class="cs-help">まだ選んでいる人は、あとで手札の画面から当面の目標を選べます。</p>`
        : primaryBtn('begin', 'すごろくをはじめる', false)}</div>`;
    }
    return html;
  }
  function setupPanel(pid) {
    const p = player(pid);
    const step = p.setup.step;
    const you = pid === myPid();
    let html = `<div class="cs-card cs-stack" data-who="${esc(pid)}">${proxyBanner(pid)}`;
    if (step === 'ideal') {
      const order = idealOrder(pid);
      const per = 6;
      const pages = Math.ceil(order.length / per);
      const page = (S.ui.idealPage[pid] || 0) % pages;
      const jobs = order.slice(page * per, page * per + per);
      const key = `ideal:${pid}:${page}`;
      const sel = S.ui.sel[key];
      html += stepsHTML(0) + eventHTML({ label: '理想の職業', icon: 'star', q: `${you ? '' : esc(nameOf(pid)) + 'さん、'}どんな職業にあこがれる？`, sub: '今の気持ちで選んでOK。あとで変わっても大丈夫。決めずに始めることもできるよ。' })
        + guideHTML('はじめての人は、先に「はじめてガイド」を見ると遊び方がわかるよ。理想の職業は点数と関係なく、なってみたいもので選んでOK。', `<button type="button" class="cs-quiet" data-act="openGuide" data-fk="setup-guide" style="padding-left:0"><span class="material-symbols-rounded" aria-hidden="true">menu_book</span>はじめてガイドを見る</button>`);
      html += `<div class="cs-jobs">${jobs.map((j, i) => jobCardHTML(j, { key, i, num: i, pressed: sel === i, pid })).join('')}</div>`;
      html += `<div class="cs-actions">${primaryBtn('idealOk', 'これにする', sel === undefined, { pid })}
        <button type="button" class="cs-btn cs-btn--secondary cs-btn--full" data-act="idealMore" data-pid="${esc(pid)}">別の候補を見る（${page + 1}/${pages}）</button>
        <div class="cs-quietrow">${quietBtn('idealSkip', 'まだ決めない', 'more_horiz', { pid })}</div></div>`;
    } else if (step === 'deal') {
      html += stepsHTML(1) + eventHTML({ label: '最初の適性カード', icon: 'style', q: '適性カードが3枚配られたよ', sub: 'ゲームの中の持ち札。本当の得意・不得意を決めるものではないよ。' })
        + guideHTML('この3枚がスタート。職業カードの「中心×2」「関連×1」に合う適性を集めるほど、最後の点が高くなるよ。');
      html += `<div class="cs-dealt">${p.setup.dealt.map((a, i) => `<div class="cs-dealcard" data-anim="deal-${esc(pid)}-${i}" style="border-color:${D.APTS[a].color}">${aptIcon(a)}<strong style="color:${D.APTS[a].color}">${esc(D.APTS[a].name)}</strong><span>${esc(D.APTS[a].desc)}</span></div>`).join('')}</div>`;
      html += `<div class="cs-actions">${primaryBtn('dealOk', '確認した', false, { pid })}</div>`;
    } else if (step === 'goal') {
      const key = `goal:${pid}`;
      const sel = S.ui.sel[key];
      html += stepsHTML(2) + eventHTML({ label: '当面の目標', icon: 'flag', q: 'まずは、どの職業を目指す？', sub: '目標はあとで変えられるよ。職業カードは、最後に選べる候補になる。' })
        + guideHTML('カードの下に、いまの手札での点数が出ているよ。点が高いものを選ぶと進めやすい。なってみたいもので選んでもOK。目標を決めると、このあと「目標の点＋いくつ」が表示されるよ。');
      html += `<div class="cs-jobs">${p.setup.cands.map((j, i) => jobCardHTML(j, { key, i, num: i, pressed: sel === i, pid, apt: p.apt })).join('')}</div>`;
      html += `<div class="cs-actions">${primaryBtn('goalOk', 'これにする', sel === undefined, { pid })}<div class="cs-quietrow">${quietBtn('omakase', 'おまかせ', 'casino', { pid })}</div></div>`;
    } else {
      const ideal = p.ideal >= 0 ? D.JOBS[p.ideal].name : 'まだ決めない';
      const goal = p.goal >= 0 ? D.JOBS[p.goal].name : 'あとで選ぶ';
      html += noticeHTML('準備OK！', `理想: ${esc(ideal)} ／ 当面の目標: ${esc(goal)}。ほかの人の準備を待っています。`, 'check_circle');
    }
    return html + '</div>';
  }

  function stageHold() {
    const g = G();
    let html = myStatusNotice();
    html += noticeHTML('みんな休憩中です', '時間チップを減らさずに止めています。だれかが戻ると続きから始まります。', 'pause_circle');
    if (isHost()) {
      html += `<div class="cs-card cs-actions">${g.order.filter((pid) => player(pid).status === 'resting').map((pid) => `<button class="cs-btn cs-btn--secondary cs-btn--full" data-act="pStatus" data-pid="${esc(pid)}" data-to="active">${esc(nameOf(pid))}さんを戻す</button>`).join('')}
        ${primaryBtn('endNow', '本編を終えて、最後の職業選びへ', false)}</div>`;
    }
    return html;
  }

  // 手番
  function stageTurn() {
    const g = G();
    const t = g.turn;
    const ctl = canControl(t.pid);
    let html = myStatusNotice();
    if (t.stage === 'invite' && t.inv && t.inv.status === 'pending' && t.inv.pid !== t.pid && canControl(t.inv.pid)) html += inviteHTML(t);
    html += `<div class="cs-card cs-stack cs-turn">${turnHeadHTML(t, ctl)}${proxyBanner(t.pid)}${turnBodyHTML(t, ctl)}</div>`;
    const next = nextPlayerText(g);
    if (next) html += `<p class="cs-help" style="text-align:center">${next}</p>`;
    return html;
  }
  function nextPlayerText(g) {
    if (!g.turn) return '';
    // この周の残りに手番がなく、次の周が進路のラウンドなら先に知らせる
    const restOfRound = g.order.slice(g.ptr + 1).some((pid) => { const p = player(pid); return p && p.status !== 'left' && p.chips > 0 && (g.lastLap === null || g.lastLap.includes(pid)); });
    if (!restOfRound && g.lastLap === null && g.plan[g.round + 1]) return `次は全員で「${esc(D.CAREERS[g.plan[g.round + 1]].title)}」を選ぶ進路のラウンド`;
    if (g.order.length < 2) return '';
    for (let i = 1; i <= g.order.length; i++) {
      const pid = g.order[(g.ptr + i) % g.order.length];
      const p = player(pid);
      if (!p || p.status === 'left' || p.chips <= 0) continue;
      if (g.lastLap !== null && !g.lastLap.includes(pid)) continue;
      if (pid === g.turn.pid) return '';
      return `次は ${esc(nameOf(pid))}さん${p.status === 'resting' ? '（休憩中）' : ''}`;
    }
    return '';
  }
  function turnHeadHTML(t, ctl) {
    const g = G();
    const rem = E.timerRemaining(g, N.now());
    const timer = g.settings.timerSec > 0 ? `<span class="cs-timer"><span class="material-symbols-rounded" aria-hidden="true" style="font-size:16px">hourglass_bottom</span><span data-timer="turn">${rem == null ? '' : '選ぶ時間 あと' + Math.max(0, Math.ceil(rem / 1000)) + '秒'}</span>${ctl && !t.timer.ext && t.stage !== 'result' ? quietBtn('extend', 'もう少し考える（＋15秒）') : ''}</span>` : '';
    const moveDie = t.die ? `<span class="cs-chips" style="gap:6px">${dieHTML(t.die, true, 'move-' + t.id)}<span>${t.die}マス</span></span>` : '';
    return `<div class="cs-turnhead">
      <span class="cs-turnhead__who">${avatarHTML(t.pid)}<span class="cs-turnhead__name">${esc(sanName(t.pid))}の番</span></span>
      <span class="cs-turnhead__spacer"></span>${moveDie}
    </div>
    <div class="cs-turnhead" style="justify-content:space-between">${chipsHTML(t.pid)}${timer}</div>`;
  }
  function turnQuietHTML(t, ctl, opts) {
    if (!ctl) return '';
    const items = [];
    if (opts && opts.omakase) items.push(quietBtn('omakase', 'おまかせ', 'casino', { pid: t.pid }));
    items.push(quietBtn('skip', '今回はスキップ', 'skip_next'));
    items.push(quietBtn('rest', 'しばらく見学', 'weekend', { pid: t.pid }));
    return `<div class="cs-quietrow">${items.join('')}</div><p class="cs-costnote">この手番の時間チップ1枚は使用済み（スキップしても同じ）</p>`;
  }
  function turnBodyHTML(t, ctl) {
    const g = G();
    const p = player(t.pid);
    const who = esc(sanName(t.pid));
    if (t.stage === 'roll') {
      const onFork = D.NODES[p.pos].next.length > 1;
      return eventHTML({ label: 'サイコロ', icon: 'casino', q: 'サイコロを振って進もう', sub: `出た目の数だけ進むよ。${onFork ? 'いまは分かれ道。振ったあとで道を選べるよ。' : '止まったマスで、何をするか選べる。'}` })
        + (ctl ? guideHTML(goalLine(p) + '止まったマスで、目標の職業に合う適性を集めよう。') : '')
        + `<div class="cs-diebox">${dieHTML(0)}</div>`
        + (ctl ? `<div class="cs-actions">${primaryBtn('roll', 'サイコロを振る')}</div>` : `<p class="cs-hint" style="text-align:center">${who}がサイコロを振ります</p>`)
        + turnQuietHTML(t, ctl);
    }
    if (t.stage === 'fork') {
      const key = `t${t.id}:fork`;
      const sel = selOf(key, t.pid);
      const prev = B.branchPreview(t.fork.node, 3);
      const labels = D.FORK_LABELS[t.fork.node] || ['道①', '道②'];
      const choices = prev.map((list, b) => choiceHTML({
        key, i: b, pid: t.pid, pressed: sel === b, readonly: !ctl,
        text: esc(labels[b]),
        meta: list.map((nd) => { const sq = D.SQUARES[D.NODES[nd].type]; return `<span class="cs-tag"><span class="material-symbols-rounded" aria-hidden="true" style="font-size:15px;color:${sq.color}">${sq.icon}</span>${esc(sq.name)}</span>`; }).join('<span aria-hidden="true">›</span>'),
      })).join('');
      return eventHTML({ label: '分かれ道', icon: 'call_split', q: 'どっちの道へ進む？', sub: `あと${t.fork.left}マス進むよ。この先のマスを見て選ぼう。` })
        + (ctl ? guideHTML('「伸ばす」「体験」はカードが確実にふえる。「職業」は最後の候補がふえる。地区ごとに、イベントで狙いやすい適性がちがうよ（盤面の地区名の下のアイコン）。') : '')
        + `<div class="cs-choices">${choices}</div>`
        + (ctl ? `<div class="cs-actions">${primaryBtn('forkOk', 'この道にする', sel === undefined)}</div>` : `<p class="cs-hint" style="text-align:center">${who}が道を選んでいます</p>`)
        + turnQuietHTML(t, ctl, { omakase: true });
    }
    if (t.stage === 'act') return actHTML(t, ctl);
    if (t.stage === 'partner') return partnerHTML(t, ctl);
    if (t.stage === 'invite') {
      const left = t.inv ? Math.max(0, Math.ceil((t.inv.until - N.now()) / 1000)) : 0;
      const scene = D.COLLABS[t.sq.scene];
      return eventHTML({ label: `コラボ「${scene.title}」`, icon: 'diversity_3', q: `${esc(nameOf(t.inv.pid))}さんの返事を待っています`, sub: `<span data-timer="invite">あと${left}秒</span>。返事がないときは、ひとりで挑戦になるよ。`, art: scene.icon, artTint: D.SQUARES.collab.tint, artColor: D.SQUARES.collab.color })
        + turnQuietHTML(t, ctl);
    }
    if (t.stage === 'challenge') return challengeHTML(t) + turnQuietHTML(t, ctl && !t.ch.st[t.pid].done);
    if (t.stage === 'result') return resultHTML(t, ctl);
    return '';
  }

  function landSub(t) {
    const note = t.sq.note;
    const notes = {
      lifeUsed: '暮らしのイベントは1人1回。今回は「新しい体験」に変わったよ。',
      lifeOff: '暮らしのイベントはなしの設定。今回は「新しい体験」だよ。',
      growNone: '伸ばせる適性がないので、「新しい体験」に変わったよ。',
      full: '適性カードがいっぱいなので、「職業との出会い」に変わったよ。',
      jobsAll: '職業はもう全部持っているので、「新しい体験」に変わったよ。',
    };
    return notes[note] || '';
  }
  function actHTML(t, ctl) {
    const p = player(t.pid);
    const eff = t.sq.eff;
    const key = `t${t.id}:act`;
    const sel = selOf(key, t.pid);
    const who = esc(sanName(t.pid));
    const note = landSub(t);
    let head = '';
    let body = '';
    let confirm = 'これにする';
    let quiet = { omakase: true };
    let extra = '';
    let extraGuide = '';
    if (eff === 'grow') {
      head = eventHTML({ label: '適性を伸ばす', icon: D.SQUARES.grow.icon, q: 'どの適性を伸ばす？', sub: note || '持っている適性から1つ選んで、1枚ふやそう。', art: D.SQUARES.grow.icon, artTint: D.SQUARES.grow.tint, artColor: D.SQUARES.grow.color });
      body = t.sq.opts.map((a, i) => choiceHTML({ key, i, pid: t.pid, pressed: sel === i, readonly: !ctl, text: esc(D.APTS[a].name), meta: `${pipsHTML(p.apt[a], D.APTS[a].color, 1)}<span>${p.apt[a]}枚 → ${p.apt[a] + 1}枚</span>${goalTagsHTML(p, a, 1)}` })).join('');
      extraGuide = '目標の「中心×2」の適性をふやすと、1枚で2点ふえるよ。';
    } else if (eff === 'new') {
      head = eventHTML({ label: '新しい体験', icon: D.SQUARES.new.icon, q: 'どれをやってみる？', sub: note || 'やってみたいことを1つ選ぶと、その適性のカードが1枚ふえるよ。', art: D.SQUARES.new.icon, artTint: D.SQUARES.new.tint, artColor: D.SQUARES.new.color });
      body = t.sq.opts.map((a, i) => choiceHTML({ key, i, pid: t.pid, pressed: sel === i, readonly: !ctl, text: esc(D.APTS[a].try), meta: `${aptChip(a, true)}${tagsFor(p, a)}` })).join('');
      extraGuide = '目標に必要で、まだ持っていない適性を見つけると「3種類そろい（＋3）」に近づくよ。';
    } else if (eff === 'job') {
      head = eventHTML({ label: '職業との出会い', icon: D.SQUARES.job.icon, q: 'どの職業を手札に加える？', sub: note || '加えた職業は、最後に選べる候補になるよ。', art: D.SQUARES.job.icon, artTint: D.SQUARES.job.tint, artColor: D.SQUARES.job.color });
      body = `<div class="cs-jobs">${t.sq.opts.map((j, i) => jobCardHTML(j, { key: ctl ? key : null, i, num: i, pressed: sel === i, pid: t.pid, apt: p.apt, readonly: !ctl })).join('')}</div>`;
      confirm = '手札に加える';
      extra = ctl ? quietBtn('actPass', '今回は加えない', 'block') : '';
      extraGuide = 'いまの手札で点が高い職業を持っておくと、最後に選べる候補がふえるよ。目標もあとで手札から変えられる。';
    } else if (eff === 'life') {
      // ちがう場面のプラン3つから選ぶ（ゲームが結婚・子どもなどを割り当てない）
      const plans = t.sq.opts.map((k) => D.LIFE_PLANS[k]);
      head = eventHTML({ label: '暮らしのイベント', icon: D.SQUARES.life.icon, q: '<span class="cs-phrase">これからの暮らし、</span><span class="cs-phrase">どのプランにする？</span>', sub: '暮らしのプランは1人1回。選んだ活動に時間を使うので、この先2回のイベントで、その適性は＋1、ほかの適性は−1。今のゲームの中だけの効果だよ。', art: D.SQUARES.life.icon, artTint: D.SQUARES.life.tint, artColor: D.SQUARES.life.color });
      extraGuide = '目標に必要な適性に合うプランなら、この先2回のイベントが有利（＋1）。合うものがなければ「選ばない」もありだよ。';
      body = plans.map((pl, i) => (pl ? choiceHTML({ key, i, pid: t.pid, pressed: sel === i, readonly: !ctl, text: esc(D.LIVES[pl.s].title), meta: `<span>${esc(pl.text)}</span>${aptChip(pl.a, true)}<span class="cs-tag cs-tag--plus">この先2回 ＋1</span><span class="cs-tag cs-tag--minus">ほかは −1</span>${goalTagsHTML(p, pl.a, 0).replace(/<span class="cs-tag cs-tag--goal">目標の点＋\d+<\/span>/, '')}` }) : '')).join('')
        + choiceHTML({ key, i: plans.length, pid: t.pid, pressed: sel === plans.length, readonly: !ctl, text: '今回はどのプランも選ばない', meta: '<span class="cs-tag">効果なし</span>' });
      quiet = {};
    }
    const hint = ctl ? '' : `<p class="cs-hint" style="text-align:center">${who}が選んでいます</p>`;
    return head + (ctl && extraGuide ? guideHTML(extraGuide) : '') + (eff === 'job' ? body : `<div class="cs-choices">${body}</div>`)
      + (ctl ? `<div class="cs-actions">${primaryBtn('actOk', confirm, sel === undefined)}${extra ? `<div class="cs-quietrow">${extra}</div>` : ''}</div>` : hint)
      + turnQuietHTML(t, ctl, quiet);
  }

  function partnerHTML(t, ctl) {
    const g = G();
    const scene = D.COLLABS[t.sq.scene];
    const key = `t${t.id}:partner`;
    const cands = E.eligiblePartners(g, t.sq.scene);
    let sel = selValOf(key, t.pid); // 選んだ人のID（ひとりなら ''）
    if (sel && !cands.includes(sel)) sel = undefined; // 選んだ人が休むなどしたら選び直し
    const opts = cands.map((pid, i) => choiceHTML({ key, i, v: pid, pid: t.pid, pressed: sel === pid, readonly: !ctl, text: `${avatarHTML(pid, true)} ${esc(nameOf(pid))}さんをさそう`, meta: `<span>時間チップ あと${player(pid).chips}</span>${isOnline(pid) ? '' : '<span class="cs-tag cs-tag--minus">通信が切れています</span>'}` }))
      .concat([choiceHTML({ key, i: cands.length, v: '', pid: t.pid, pressed: sel === '', readonly: !ctl, text: 'ひとりで挑戦する', meta: '<span>だれもさそわずにイベントへ</span>' })]).join('');
    const roles = scene.opts.map(([text, a]) => `<span class="cs-tag">${esc(text)}（${esc(D.APTS[a].name)}）</span>`).join('');
    const label = sel === undefined ? 'これにする' : sel === '' ? 'ひとりで挑戦する' : 'さそう';
    return eventHTML({ label: `コラボ「${scene.title}」`, icon: 'diversity_3', q: 'だれをさそう？', sub: 'さそわれた人は、参加すると時間チップを1枚使うよ。見送ってもだいじょうぶ。', art: scene.icon, artTint: D.SQUARES.collab.tint, artColor: D.SQUARES.collab.color })
      + `<div class="cs-choice__meta" style="justify-content:center">役割: ${roles}</div>`
      + (ctl ? guideHTML('2人でコラボすると、2人とも「準備チップ」が1枚もらえる（最後の仕上げで出目＋1）。さそわれた人は時間チップを1枚使うよ。') : '')
      + `<div class="cs-choices">${opts}</div>`
      + (ctl ? `<div class="cs-actions">${primaryBtn('partnerOk', label, sel === undefined)}</div>` : `<p class="cs-hint" style="text-align:center">${esc(sanName(t.pid))}がさそう人を選んでいます</p>`)
      + turnQuietHTML(t, ctl, { omakase: true });
  }

  function inviteHTML(t) {
    const g = G();
    const scene = D.COLLABS[t.sq.scene];
    const me = t.inv.pid;
    const p = player(me);
    const left = Math.max(0, Math.ceil((t.inv.until - N.now()) / 1000));
    return `<div class="cs-invite" role="alertdialog" aria-labelledby="invite-title">
      ${proxyBanner(me)}
      <p class="cs-invite__title" id="invite-title"><span class="material-symbols-rounded" aria-hidden="true">diversity_3</span> ${esc(nameOf(t.pid))}さんからコラボのおさそい</p>
      <p style="margin-top:6px"><strong>「${esc(scene.title)}」</strong>を、いっしょにやってみる？</p>
      <div class="cs-invite__cost"><span class="material-symbols-rounded" aria-hidden="true">schedule</span>参加すると時間チップを1枚使います（あと${p.chips} → ${Math.max(0, p.chips - 1)}）。そのかわり、イベントに挑戦できて、準備チップも1枚もらえます。見送っても減点はありません。</div>
      <div class="cs-invite__row">
        <button class="cs-btn cs-btn--primary" data-act="respond" data-v="1" data-lock="1" data-fk="inv-yes">参加する</button>
        <button class="cs-btn cs-btn--secondary" data-act="respond" data-v="0" data-lock="1" data-fk="inv-no">今回は見送る</button>
      </div>
      <p class="cs-help" style="margin-top:8px"><span data-timer="invite">あと${left}秒</span>で、自動的に「見送る」になります。</p>
    </div>`;
  }

  function challengeNote(t) {
    const ch = t.ch;
    if (ch.fictional) return '仕事仲間といっしょに取り組むよ（仲間のカードや判定はなし）。';
    if (ch.note === 'noPartner') return 'さそえる人がいないので、ひとりで挑戦しよう。';
    if (ch.note === 'declined') return `${esc(nameOf(t.inv ? t.inv.pid : ''))}さんは今回は見送り。ひとりで挑戦しよう。`;
    if (ch.note === 'timeout') return '返事がなかったので、ひとりで挑戦しよう。';
    if (ch.note === 'alone') return 'ひとりで挑戦しよう。';
    return '';
  }
  function challengeHTML(t) {
    const ch = t.ch;
    const scene = E.sceneOf(ch);
    const isCollab = ch.kind === 'collab';
    const sq = isCollab ? D.SQUARES.collab : D.SQUARES.event;
    const head = eventHTML({ label: `${isCollab ? 'コラボ' : 'イベント'}「${scene.title}」`, icon: sq.icon, q: esc(scene.q), sub: challengeNote(t) || 'やることを選んだら、サイコロでチャレンジ。', art: scene.icon, artTint: sq.tint, artColor: sq.color });
    const odds = `<div class="cs-odds" aria-label="サイコロの判定"><div><strong>5〜6</strong>狙った適性を2枚</div><div><strong>3〜4</strong><span class="cs-phrase">別の適性を</span><span class="cs-phrase">1枚選ぶ</span></div><div><strong>1〜2</strong>今回はなし</div></div>`;
    const members = ch.members.map((mid) => memberHTML(t, mid)).join('');
    return head + odds + `<div class="cs-members">${members}</div>`;
  }
  function memberHTML(t, mid) {
    const g = G();
    const ch = t.ch;
    const s = ch.st[mid];
    const p = player(mid);
    const ctl = canControl(mid);
    const scene = E.sceneOf(ch);
    const key = `t${t.id}:ch:${mid}`;
    const multi = ch.members.length > 1;
    const head = multi || mid !== t.pid ? `<div class="cs-member__head">${avatarHTML(mid, true)}${esc(sanName(mid))}${mid !== t.pid ? '（さそわれた人）' : ''}${proxyBanner(mid) && mid !== t.pid ? '' : ''}</div>` : '';
    let body = '';
    // 端末で参加している相手が反応しないとき用に、ホストには常に出す
    const hostDrop = isHost() && mid !== t.pid && !s.done ? `<div class="cs-quietrow">${quietBtn('chDrop', 'この人の分を見送る', 'block', { pid: mid })}</div>` : '';
    if (s.note === 'cancel' || s.note === 'dropped') {
      body = `<p class="cs-hint">今回は見送りになりました${s.refunded ? '（時間チップは戻りました）' : ''}。</p>`;
    } else if (!s.die) {
      const picking = s.pick < 0 || S.ui.reselect[key];
      if (picking) {
        const sel = selOf(key, mid);
        body = (ctl ? guideHTML('持っている適性を狙うと出目＋1で成功しやすい。成功（5〜6）なら一気に2枚。うまくいかなくても準備チップが1枚もらえるよ。') : '')
          + `<div class="cs-choices">${scene.opts.map(([text, a], i) => choiceHTML({ key, i, pid: mid, pressed: sel === i, readonly: !ctl, disabled: p.apt[a] >= CAP, text: esc(text), meta: `${aptChip(a, true)}${tagsFor(p, a, { roll: true })}` })).join('')}</div>`
          + (ctl ? `<div class="cs-actions">${primaryBtn('chPick', 'これにする', sel === undefined, { pid: mid })}<div class="cs-quietrow">${quietBtn('omakase', 'おまかせ', 'casino', { pid: mid })}</div></div>` : `<p class="cs-hint">${esc(sanName(mid))}が選んでいます</p>`)
          + hostDrop;
      } else {
        const [text, a] = scene.opts[s.pick];
        const bonus = p.apt[a] > 0 ? 1 : 0;
        const life = g.phase === 'main' && p.life.left > 0 && p.life.apt >= 0 ? (p.life.apt === a ? 1 : -1) : 0;
        const parts = [`サイコロ`, bonus ? '持っている＋1' : '', life ? `暮らし${life > 0 ? '＋1' : '−1'}` : ''].filter(Boolean).join(' ');
        body = `<div class="cs-gain"><span class="cs-choice__num" aria-hidden="true">${NUMS[s.pick]}</span><div class="cs-gain__text"><p class="cs-gain__title">${esc(text)}</p><p class="cs-gain__sub">${aptChip(a, true)} を狙う ・ 判定は「${esc(parts)}」</p></div></div>`
          + `<div class="cs-diebox">${dieHTML(0)}</div>`
          + (ctl ? `<div class="cs-actions">${primaryBtn('chRoll', 'サイコロでチャレンジ', false, { pid: mid })}<div class="cs-quietrow">${quietBtn('chReselect', '選び直す', 'undo', { pid: mid })}</div></div>` : `<p class="cs-hint">${esc(sanName(mid))}がサイコロを振ります</p>`)
          + hostDrop;
      }
    } else {
      const [text, a] = scene.opts[s.pick];
      const calc = `出目${s.die}${s.bonus ? ' ＋持っている1' : ''}${s.life ? ` ${s.life > 0 ? '＋' : '−'}暮らし1` : ''} → 判定 <strong>${s.total}</strong>`;
      let outcome = '';
      if (s.tier === 'big') {
        const got = s.got[0];
        outcome = got ? gainBox(mid, got[0], got[1], p.apt[got[0]] === got[1]) : noGainBox(`もう${CAP}枚持っていたので、ふえなかった`);
      } else if (s.tier === 'mid') {
        if (!s.done) {
          const rkey = `t${t.id}:rw:${mid}`;
          const rsel = selOf(rkey, mid);
          outcome = `<p class="cs-gain__title" style="text-align:center">別の適性につながりそう！ 1枚選んでね</p><div class="cs-choices">${s.rw.map((ra, i) => choiceHTML({ key: rkey, i, pid: mid, pressed: rsel === i, readonly: !ctl, text: esc(D.APTS[ra].name), meta: `${pipsHTML(p.apt[ra], D.APTS[ra].color, 1)}${tagsFor(p, ra)}` })).join('')}</div>`
            + (ctl ? `<div class="cs-actions">${primaryBtn('rewardOk', 'このカードにする', rsel === undefined, { pid: mid })}</div>` : `<p class="cs-hint">${esc(sanName(mid))}がカードを選んでいます</p>`)
            + hostDrop;
        } else if (s.got.length) {
          outcome = gainBox(mid, s.got[0][0], s.got[0][1], p.apt[s.got[0][0]] === s.got[0][1]);
        } else outcome = noGainBox(s.note === 'noReward' ? '受け取れる適性がもういっぱいだった' : '今回は、カードの獲得なし');
      } else {
        outcome = noGainBox('今回は、カードの獲得なし');
      }
      body = `<div class="cs-diebox">${dieHTML(s.die, false, `roll-${t.id}-${mid}`)}<p class="cs-calc">「${esc(text)}」 ${calc}</p></div>${outcome}${prepGotHTML(t, mid)}`;
    }
    return `<div class="${multi ? 'cs-member' : ''}">${head}${body}</div>`;
  }
  function gainBox(pid, a, n, discovered) {
    const apt = D.APTS[a];
    const p = player(pid);
    const title = discovered ? `${esc(apt.name)}を発見！` : `${esc(apt.name)}が${n}枚ふえた！`;
    return `<div class="cs-gain" data-gain="${esc(pid)}-${a}">${aptIcon(a)}<div class="cs-gain__text"><p class="cs-gain__title" style="color:${apt.color}">${title}</p><p class="cs-gain__sub">${pipsHTML(p.apt[a], apt.color)} いま${p.apt[a]}枚${p.apt[a] >= CAP ? '（上限）' : ''}</p></div></div>`;
  }
  // この判定でもらった準備チップ（カードが取れなかったとき・2人のコラボ）
  function prepGotHTML(t, pid) {
    const got = t.res.filter((r) => r.k === 'prep' && r.p === pid);
    const p = player(pid);
    if (!got.length || !p) return '';
    const why = got.map((r) => (r.why === 'collab' ? 'コラボ' : 'チャレンジした経験')).join('・');
    return `<div class="cs-prepline" data-prep="${esc(pid)}">${prepDotsHTML(p.prep)}<span>準備チップ＋${got.length}（${why}）</span><span class="cs-help">最後の仕上げで出目＋${p.prep}</span></div>`;
  }
  function noGainBox(text) {
    return `<div class="cs-gain cs-gain--none"><span class="material-symbols-rounded" aria-hidden="true" style="color:var(--color-muted)">remove_circle_outline</span><div class="cs-gain__text"><p class="cs-gain__title">${esc(text)}</p><p class="cs-gain__sub">持っているカードはそのまま。次は別の体験も選べるよ。</p></div></div>`;
  }
  function resultHTML(t, ctl) {
    const g = G();
    let html = '';
    let jobAdded = -1;
    if (t.ch) {
      html += challengeHTML(t);
    } else {
      const sq = t.sq ? D.SQUARES[t.sq.eff === 'none' ? 'start' : t.sq.eff] || D.SQUARES.new : D.SQUARES.new;
      const lines = t.res.map((r) => {
        if (r.k === 'gain') return gainBox(r.p, r.a, r.n, !!r.disc);
        if (r.k === 'job') { jobAdded = r.j; return `<div class="cs-gain" data-job="${r.j}">${jobCardHTML(r.j, { mini: true, apt: player(r.p).apt })}<div class="cs-gain__text"><p class="cs-gain__title">${esc(D.JOBS[r.j].name)}を手札に加えた</p><p class="cs-gain__sub">最後に選べる候補がふえたよ。</p></div></div>`; }
        if (r.k === 'life') { const sc = D.LIVES[r.scene]; return `<div class="cs-gain">${aptIcon(r.a)}<div class="cs-gain__text"><p class="cs-gain__title">暮らしのプラン「${esc(sc.title)}」</p><p class="cs-gain__sub">${esc(sc.opts[r.i][0])}。この先2回のイベントで、${esc(D.APTS[r.a].name)}を狙うと＋1、ほかは−1。</p></div></div>`; }
        if (r.k === 'lifePass') return noGainBox('暮らしのプランは選ばなかった');
        if (r.k === 'jobPass') return noGainBox('今回は職業を加えなかった');
        if (r.k === 'none') return noGainBox('このマスでは何も起きなかった');
        return '';
      }).join('');
      html += eventHTML({ label: sq.long, icon: sq.icon, q: '結果', sub: '' }) + `<div class="cs-result">${lines}</div>`;
    }
    if (ctl) {
      const p = player(t.pid);
      const goalBtn = jobAdded >= 0 && p.goal !== jobAdded ? `<button type="button" class="cs-btn cs-btn--secondary cs-btn--full" data-act="setGoal" data-pid="${esc(t.pid)}" data-job="${jobAdded}">この職業を目標にする</button>` : '';
      html += `<div class="cs-actions">${primaryBtn('endTurn', '手番を終える')}${goalBtn}</div>`;
    } else {
      html += `<p class="cs-hint" style="text-align:center">${esc(sanName(t.pid))}が結果を確認しています</p>`;
    }
    return html;
  }

  // 進路のラウンド（全員が同時に）
  function careerState(pid) {
    const c = G().career;
    const s = c.st[pid];
    if (!s) return ['なし（時間チップ0）', ''];
    if (s.skipped) return ['見送り', 'cs-state--rest'];
    if (s.passed) return ['パス', 'cs-state--rest'];
    if (s.done) return ['選んだ', 'cs-state--done'];
    if (player(pid).status !== 'active') return ['休憩中（戻れば選べる）', 'cs-state--rest'];
    return [s.route ? '体験を選んでいます' : '進路を選んでいます', ''];
  }
  function stageCareer() {
    const g = G();
    const c = g.career;
    const st = D.CAREERS[c.stage];
    const pids = Object.keys(c.st);
    const pending = (pid) => !c.st[pid].done;
    const ctl = g.order.filter((pid) => c.st[pid] && canControl(pid));
    const who = pickWho(ctl, pending);
    let html = myStatusNotice();
    const until = c.until ? `<p class="cs-help"><span data-timer="career">${c.until ? '締め切りまで あと' + Math.max(0, Math.ceil((c.until - N.now()) / 1000)) + '秒' : ''}</span></p>` : '';
    html += `<div class="cs-card cs-stack">${eventHTML({ label: `進路のラウンド（${st.title}）`, icon: 'signpost', q: esc(st.q), sub: 'この周は全員が同時に選ぶよ（サイコロなし・時間チップ1枚）。本当の志望を答えるものではないよ。選んだ体験の適性カードを1枚もらえる。' })}${until}</div>`;
    if (isHost()) html += whoTabs(ctl, who, pending);
    if (who) html += careerPanel(who);
    else if (!myPid()) html += noticeHTML('みんなが進路を選んでいます', '進路を選んだら、そこでやってみる体験を選びます。', 'hourglass_top');
    html += progressHTML('進路の進み具合', pids.map((pid) => [pid, ...careerState(pid)]));
    if (isHost()) {
      const waiting = pids.filter(pending);
      html += `<div class="cs-card cs-actions">${waiting.length ? `${primaryBtn('crClose', '締め切って次へ', false, {}, 'cs-btn--secondary')}<p class="cs-help">まだ選んでいない人は、この回の進路を見送りになります（カードはそのまま）。</p>` : '<p class="cs-help">全員が選ぶと自動で次に進みます。</p>'}</div>`;
    }
    return html;
  }
  function careerPanel(pid) {
    const g = G();
    const c = g.career;
    const s = c.st[pid];
    const p = player(pid);
    const st = D.CAREERS[c.stage];
    let html = `<div class="cs-card cs-stack" data-who="${esc(pid)}">${proxyBanner(pid)}`;
    if (s.done) {
      if (s.passed) html += noticeHTML('今回はパスしました', 'ほかの人を待っています。', 'check_circle');
      else if (s.skipped) html += noticeHTML('今回の進路は見送りになりました', 'カードはそのまま。ほかの人を待っています。', 'weekend');
      else {
        const route = E.careerRoute(c.stage, s.route);
        html += `<p class="cs-sec-title" style="font-size:15px">${esc(route.name)}で「${esc(route.acts[s.act][0])}」</p>` + gainBox(pid, s.apt, 1, p.apt[s.apt] === 1);
      }
      return html + '</div>';
    }
    if (p.status !== 'active') {
      html += noticeHTML('休憩中です', 'この周の進路は、ほかの人を待たずに進みます。終わる前に戻れば、進路を選べるよ（時間チップはこの周の分を使用済み）。', 'weekend',
        canControl(pid) ? `<div style="margin-top:10px">${primaryBtn('back', '戻って進路を選ぶ', false, { pid })}</div>` : '');
      return html + '</div>';
    }
    if (!s.route) {
      const per = 3;
      const pages = Math.ceil(st.routes.length / per);
      const page = (S.ui.routePage[pid] || 0) % pages;
      const routes = st.routes.slice(page * per, page * per + per).concat([st.common]);
      const key = `cr:${c.round}:${pid}:route:${page}`;
      const sel = selOf(key, pid);
      html += `<p class="cs-sec-title" style="font-size:15px">${esc(sanName(pid))}は、どの進路を試す？</p>`;
      if (canControl(pid)) html += guideHTML('どの進路でもOK。進路の下のアイコンが、そこで体験できる適性。目標に必要な適性がある進路を選ぶと点につながるよ。');
      html += `<div class="cs-choices">${routes.map((r, i) => choiceHTML({
        key, i, pid, pressed: sel === i, readonly: !canControl(pid),
        text: `<span class="material-symbols-rounded" aria-hidden="true" style="font-size:20px;color:var(--color-accent)">${r.icon}</span> ${esc(r.name)}`,
        meta: `<span>${esc(r.desc)}</span>${r.acts.map(([, a]) => aptIcon(a, true)).join('')}`,
      })).join('')}</div>`;
      html += `<div class="cs-actions">${primaryBtn('crRoute', 'この進路にする', sel === undefined, { pid })}${pages > 1 ? `<button type="button" class="cs-btn cs-btn--secondary cs-btn--full" data-act="crMore" data-pid="${esc(pid)}">別の進路を見る（${page + 1}/${pages}）</button>` : ''}<div class="cs-quietrow">${quietBtn('omakase', 'おまかせ', 'casino', { pid })}${quietBtn('crPass', 'この回はパス', 'skip_next', { pid })}</div></div>`;
    } else {
      const route = E.careerRoute(c.stage, s.route);
      const key = `cr:${c.round}:${pid}:act:${s.route}`;
      const sel = selOf(key, pid);
      html += `<p class="cs-sec-title" style="font-size:15px"><span class="material-symbols-rounded" aria-hidden="true">${route.icon}</span>${esc(route.name)}で、何をしてみる？</p>`;
      const anyOk = route.acts.some(([, a]) => p.apt[a] < CAP);
      html += `<div class="cs-choices">${route.acts.map(([text, a], i) => choiceHTML({ key, i, pid, pressed: sel === i, readonly: !canControl(pid), disabled: p.apt[a] >= CAP, text: esc(text), meta: `${aptChip(a, true)}${tagsFor(p, a)}` })).join('')}</div>`;
      if (!anyOk) html += `<p class="cs-hint">この進路の体験の適性は、どれももう${CAP}枚。ほかの進路を選び直せるよ。</p>`;
      html += `<div class="cs-actions">${primaryBtn('crAct', 'これにする', sel === undefined, { pid })}<div class="cs-quietrow">${quietBtn('crBack', '進路を選び直す', 'undo', { pid })}${quietBtn('omakase', 'おまかせ', 'casino', { pid })}${quietBtn('crPass', 'この回はパス', 'skip_next', { pid })}</div></div>`;
    }
    return html + '</div>';
  }

  // 終盤
  function finalState(pid) {
    const p = player(pid);
    if (!p.fin) return ['', ''];
    if (p.fin.step === 'done') return ['決まった', 'cs-state--done'];
    if (p.fin.step === 'present') return ['職業は決定・仕上げのサイコロ待ち', ''];
    if (p.status !== 'active') return [p.status === 'left' ? '参加を終えた（選ぶこともできる）' : '休憩中（選ぶこともできる）', 'cs-state--rest'];
    return ['選んでいます', ''];
  }
  function stageFinal() {
    const g = G();
    const pids = E.playersInSeat(g).map((p) => p.id);
    const pending = (pid) => !E.finalDone(player(pid));
    const ctl = pids.filter((pid) => canControl(pid));
    const who = pickWho(ctl, pending);
    let html = `<div class="cs-card">${eventHTML({ label: '最後の職業選び', icon: 'workspace_premium', q: '持っている職業から、最後の1つを選ぼう', sub: esc(finalRuleText(g.final ? g.final.rule : 'none')) })}</div>`;
    if (isHost()) html += whoTabs(ctl, who, pending);
    if (who) html += finalPanel(who);
    else html += noticeHTML('みんなが最後の職業を選んでいます', '全員が決まったら、ホストが結果を発表します。', 'hourglass_top');
    html += progressHTML('最後の職業選びの進み具合', pids.map((pid) => [pid, ...finalState(pid)]));
    if (isHost()) {
      const waiting = pids.filter((pid) => player(pid).status === 'active' && pending(pid));
      const note = revealNoteHTML();
      html += `<div class="cs-card cs-actions">${primaryBtn('reveal', waiting.length ? '締め切って結果を発表する' : '結果を発表する', false, waiting.length ? { force: 1 } : {}, waiting.length ? 'cs-btn--secondary' : 'cs-btn--primary')}${note ? `<p class="cs-help">${note}</p>` : ''}</div>`;
    }
    return html;
  }
  // 発表の前に: 職業を選んでいない人（結果なし）と、仕上げのサイコロの前の人（職業の点のまま）を分けて伝える
  function revealNoteHTML() {
    const names = (step) => E.playersInSeat(G()).filter((p) => p.fin && p.fin.step === step).map((p) => esc(sanName(p.id)));
    const notes = [];
    const unchosen = names('choose');
    const unrolled = names('present');
    if (unchosen.length) notes.push(`職業を選んでいない${unchosen.join('、')}は「結果なし（今回は途中まで）」`);
    if (unrolled.length) notes.push(`仕上げのサイコロの前の${unrolled.join('、')}は職業の点のまま（仕上げの点なし）`);
    return notes.length ? `いま発表すると、${notes.join('、')}になります。` : '';
  }
  function finalPanel(pid) {
    const p = player(pid);
    const f = p.fin;
    let html = `<div class="cs-card cs-stack" data-who="${esc(pid)}">${proxyBanner(pid)}`;
    if (p.status !== 'active' && f.step !== 'done') html += `<p class="cs-hint">${p.status === 'left' ? '参加を終えた人も' : '休憩中の人も'}、選べば結果に入ります（選ばなくても「最下位」にはなりません）。</p>`;
    if (f.step === 'choose') {
      const key = `fin:${pid}:choose`;
      const sel = S.ui.sel[key];
      html += `<p class="cs-sec-title" style="font-size:16px">${esc(sanName(pid))}の職業カード（${p.jobs.length}枚）</p>`;
      const present = !!G().final && G().final.rule === 'present';
      if (canControl(pid)) html += guideHTML(`カードの下に、いまの手札での点数が出ているよ。${present ? 'この点に、このあと仕上げのサイコロで0〜3点が加わる。' : 'この点がそのまま結果になるよ。'}`);
      html += `<div class="cs-jobs">${p.jobs.map((j, i) => jobCardHTML(j, { key, i, num: i, pressed: sel === i, pid, apt: p.apt, ribbons: ribbonsFor(p, j) })).join('')}</div>`;
      html += '<p class="cs-help">点数はゲームの得点。本当の向き・不向きを表すものではないよ。</p>';
      const goalBtn = p.goal >= 0 && p.jobs.includes(p.goal) ? `<button type="button" class="cs-btn cs-btn--secondary cs-btn--full" data-act="fnGoal" data-pid="${esc(pid)}" data-lock="1" data-fk="fin-goal">今の目標（${esc(D.JOBS[p.goal].name)}）で決める</button>` : '';
      html += `<div class="cs-actions">${primaryBtn('fnChoose', 'この職業に決める', sel === undefined, { pid })}${goalBtn}</div>`;
    } else if (f.step === 'present') {
      html += `<p class="cs-sec-title" style="font-size:15px">${esc(D.JOBS[f.job].name)}に決めた！ 職業の点 ${f.base}点</p>`;
      html += eventHTML({ label: '仕上げのサイコロ', icon: 'auto_awesome', q: '<span class="cs-phrase">最後の仕上げ！</span> <span class="cs-phrase">サイコロを振ろう</span>', sub: '出目＋準備チップの合計で、点が0〜3ふえるよ（へることはない）。' });
      html += presentTableHTML(p.prep);
      html += `<div class="cs-diebox">${dieHTML(0)}</div>`;
      html += canControl(pid) ? `<div class="cs-actions">${primaryBtn('fnPresent', '仕上げのサイコロを振る', false, { pid })}</div>` : `<p class="cs-hint" style="text-align:center">${esc(sanName(pid))}がサイコロを振ります</p>`;
    } else {
      html += noticeHTML(`${esc(D.JOBS[f.job].name)}に決めました`, '結果発表を待っています。', 'check_circle');
      if (f.roll) {
        html += `<div class="cs-diebox">${dieHTML(f.roll.die, false, `present-${pid}`)}<p class="cs-calc">出目${f.roll.die}${f.roll.used ? ` ＋準備チップ${f.roll.used}` : ''} ＝ ${f.roll.total} → <strong>＋${f.roll.bonus}点</strong>（職業の点${f.base}点 → ${f.final}点）</p></div>`;
      }
    }
    return html + '</div>';
  }
  // 仕上げのサイコロの表（準備チップの枚数で、届く段が変わる）
  function presentTableHTML(prep) {
    const used = Math.min(E.PREP_MAX, prep || 0);
    const rows = [['1〜2', 0], ['3〜4', 1], ['5〜6', 2], ['7〜8', 3]];
    const reach = (bonus) => [1, 2, 3, 4, 5, 6].some((d) => E.presentBonus(d + used) === bonus);
    return `<div class="cs-prepline">${prepDotsHTML(used)}<span>準備チップ ${used}枚 → 出目に＋${used}</span></div>
      <div class="cs-bonus" role="table" aria-label="仕上げのサイコロの表">${rows.map(([r, b]) => `<div role="row" class="${reach(b) ? 'is-reach' : 'is-out'}"><span role="cell">合計 ${r}</span><strong role="cell">＋${b}点${reach(b) ? '' : '<span class="cs-sr">（今回は届かない）</span>'}</strong></div>`).join('')}</div>
      <p class="cs-help">加わるのは3点までなので、3点以上の差は逆転しない（3点差は同点まで）。準備チップがあると、上の段に届きやすくなるよ。</p>`;
  }
  function prepDotsHTML(n) {
    let h = '<span class="cs-prepdots" aria-hidden="true">';
    for (let i = 0; i < E.PREP_MAX; i++) h += `<span class="cs-prepdot${i < n ? ' is-on' : ''}"><span class="material-symbols-rounded">bolt</span></span>`;
    return h + '</span>';
  }
  function ribbonsFor(p, j) {
    const r = [];
    if (p.ideal === j) r.push('理想');
    if (p.goal === j) r.push('目標');
    return r;
  }

  // ── 手札 ───────────────────────────────────────
  function handPid() {
    const g = G();
    if (S.ui.handPid && g.players[S.ui.handPid]) return S.ui.handPid;
    const me = myPid();
    if (isHost() && g.turn && g.phase === 'main') return g.turn.pid;
    if (me) return me;
    if (g.turn) return g.turn.pid;
    return g.order[0] || null;
  }
  function renderHand() {
    const g = G();
    const pid = handPid();
    const p = player(pid);
    if (!p || (g.phase === 'setup' && p.setup.step === 'ideal')) {
      patch('hand', p ? `<p class="cs-hand__title">${esc(sanName(pid))}のカード</p><p class="cs-help">理想の職業を選ぶと、カードが配られます。</p>` : '');
      return;
    }
    const mobile = window.matchMedia('(max-width: 600px)').matches;
    if (S.ui.handCollapsed === null) S.ui.handCollapsed = mobile;
    $('hand').classList.toggle('is-collapsed', !!S.ui.handCollapsed);
    const own = pid === myPid();
    const ctl = canControl(pid) && (g.phase === 'main' || g.phase === 'setup');
    const apts = D.APTS.map((apt, a) => `<div class="cs-aptrow" data-apt-row="${esc(pid)}-${a}" style="color:${apt.color}">${aptIcon(a, true)}<span class="cs-aptrow__name" style="color:var(--color-text)">${esc(apt.name)}</span>${pipsHTML(p.apt[a], apt.color)}<span class="cs-aptrow__count">${p.apt[a]}</span></div>`).join('');
    const jobs = p.jobs.map((j) => {
      const card = jobCardHTML(j, { mini: true, apt: p.apt, ribbons: ribbonsFor(p, j), anim: `job-${pid}-${j}` });
      const btn = ctl && p.goal !== j && g.phase !== 'final' ? `<button type="button" class="cs-quiet" data-act="setGoal" data-pid="${esc(pid)}" data-job="${j}" style="min-height:36px;font-size:13px">目標にする</button>` : '';
      return `<div>${card}${btn}</div>`;
    }).join('');
    const life = g.phase === 'main' && p.life.left > 0 && p.life.apt >= 0
      ? `<div class="cs-lifefx"><span class="material-symbols-rounded" aria-hidden="true">cottage</span>暮らしの効果: ${esc(D.APTS[p.life.apt].name)}を狙うと＋1、ほかは−1（あと${p.life.left}回）</div>` : '';
    const pendingGoal = p.setup.goalPending && ctl
      ? `<div class="cs-lifefx" style="background:#FFF1CC;color:#6E4A00"><span class="material-symbols-rounded" aria-hidden="true">flag</span>当面の目標がまだです <button type="button" class="cs-quiet" data-act="lateGoal" data-pid="${esc(pid)}">目標を選ぶ</button></div>` : '';
    const prep = g.settings.endRule === 'present' ? `<div class="cs-prepline" data-prep="${esc(pid)}">${prepDotsHTML(p.prep)}<span>準備チップ ${p.prep}枚</span><span class="cs-help">最後の仕上げで出目＋${p.prep}（2枚まで）</span></div>` : '';
    const goalMap = goalMapHTML(p);
    const title = own ? 'あなたのカード' : `${esc(p.name)}さんのカード`;
    const back = S.ui.handPid && (myPid() || (g.turn && S.ui.handPid !== g.turn.pid)) ? quietBtn('handPid', myPid() ? '自分のカードにもどす' : '手番の人のカードにもどす', 'undo', { pid: '' }) : '';
    patch('hand', `
      <div class="cs-hand__head">${avatarHTML(pid, true)}<span class="cs-hand__title" data-hand-title="${esc(pid)}">${title}</span>
        <span class="cs-help">${D.APTS.reduce((s, x, a) => s + p.apt[a], 0)}枚・職業${p.jobs.length}枚</span>${back}
        <button type="button" class="cs-quiet cs-hand__toggle" data-act="toggleHand" aria-expanded="${!S.ui.handCollapsed}">${S.ui.handCollapsed ? '開く' : '閉じる'}</button></div>
      <div class="cs-hand__body">
        ${pendingGoal}${life}${goalMap}
        <div class="cs-aptlist">${apts}</div>
        <div class="cs-hand__jobs">${jobs}</div>
        ${prep}
        <p class="cs-hand__note">カードはゲームの中の持ち札。職業の点数＝中心の適性×2＋関連の適性×1ずつ＋3種類そろうと＋3（最大${E.MAX_SCORE}点）。</p>
      </div>`);
  }

  // ガイド: 目標の職業までの「みちのり」（3つの適性それぞれ、次の1枚でふえる点）
  function goalMapHTML(p) {
    if (!S.prefs.guide || !p || p.goal < 0 || !D.JOBS[p.goal]) return '';
    const job = D.JOBS[p.goal];
    const sc = E.score(p.apt, p.goal);
    const rows = [[job.core, '中心×2'], [job.rel[0], '関連×1'], [job.rel[1], '関連×1']].map(([a, role]) => {
      const d = E.gainDelta(p.apt, p.goal, a, 1);
      const apt = D.APTS[a];
      return `<li>${aptIcon(a, true)}<span class="cs-goalmap__name">${esc(apt.name)}<small>${role}</small></span>${pipsHTML(p.apt[a], apt.color)}<span class="cs-goalmap__d">${p.apt[a] >= CAP ? 'いっぱい' : `次の1枚で＋${d}`}</span></li>`;
    }).join('');
    const bonus = sc.bonus ? '3種類そろい＋3 達成' : '3種類そろうと＋3';
    return `<div class="cs-goalmap"><p class="cs-goalmap__title"><span class="material-symbols-rounded" aria-hidden="true">flag</span>目標「${esc(job.name)}」まで　<span class="cs-phrase">いま <strong>${sc.total}</strong>点／${E.MAX_SCORE}点</span><span class="cs-help">（${bonus}）</span></p><ul>${rows}</ul></div>`;
  }

  // ── みんな ─────────────────────────────────────
  function statusChip(pid) {
    const g = G();
    const p = player(pid);
    if (g.turn && g.turn.pid === pid) return '<span class="cs-state cs-state--turn">手番中</span>';
    if (p.status === 'resting') return '<span class="cs-state cs-state--rest">休憩中</span>';
    if (p.status === 'left') return '<span class="cs-state cs-state--off">参加を終えた</span>';
    if (!isOnline(pid)) return '<span class="cs-state cs-state--off">通信が切れています</span>';
    if (g.phase === 'main' && p.chips <= 0) return '<span class="cs-state">時間チップ終了</span>';
    return '';
  }
  function renderPeople() {
    const g = G();
    const rows = g.order.map((pid) => {
      const p = player(pid);
      const cur = g.turn && g.turn.pid === pid;
      const cnt = p.apt.reduce((s, x) => s + x, 0);
      return `<li><button type="button" class="cs-prow${cur ? ' is-current' : ''}" data-act="handPid" data-pid="${esc(pid)}" data-fk="pr-${esc(pid)}" style="width:100%;border:none;background:${cur ? 'var(--color-accent-soft)' : 'transparent'};text-align:left" aria-label="${esc(p.name)}さんのカードを見る">
        ${avatarHTML(pid)}
        <span class="cs-prow__main"><span class="cs-prow__name">${esc(p.name)}${pid === myPid() ? '（あなた）' : ''}${p.ctrl === 'host' ? ' <span class="cs-tag">代理</span>' : ''}</span>
        <span class="cs-prow__sub">${g.phase === 'main' ? `<span>時間チップ あと${p.chips}</span>` : ''}<span>適性${cnt}枚</span><span>職業${p.jobs.length}枚</span></span></span>
        ${statusChip(pid)}
      </button></li>`;
    }).join('');
    const specs = Object.keys((S.room && S.room.spectators) || {}).length;
    const log = g.log.slice(-8).reverse().map((e) => logText(e)).filter(Boolean).map((tx) => `<li><span class="material-symbols-rounded" aria-hidden="true" style="font-size:14px">chevron_right</span><span>${tx}</span></li>`).join('');
    patch('people', `<p class="cs-sec-title" style="font-size:16px"><span class="material-symbols-rounded" aria-hidden="true">group</span>みんな <span class="cs-help">（見学${specs}人）</span></p><ul class="cs-plist">${rows}</ul>${log ? `<ul class="cs-ticker" aria-label="最近のできごと">${log}</ul>` : ''}`);
  }
  function logText(e) {
    const n = (pid) => esc(nameOf(pid));
    const WHY = { self: 'スキップ', host: 'ホストがスキップ', timeout: '時間切れで手番終了', rest: '休憩中のためスキップ', leave: '参加を終えた', close: '締め切りで見送り' };
    switch (e.k) {
      case 'turn': return `${n(e.p)}さんの番`;
      case 'move': return `${n(e.p)}さん：サイコロ${e.die}で進んだ`;
      case 'gain': return `${n(e.p)}さん：${esc(D.APTS[e.a].name)}${e.disc ? 'を発見！' : `＋${e.n}`}`;
      case 'job': return `${n(e.p)}さん：${esc(D.JOBS[e.j].name)}を手札に`;
      case 'goal': return `${n(e.p)}さん：目標を${esc(D.JOBS[e.j].name)}に`;
      case 'life': return `${n(e.p)}さん：暮らしのプランを選んだ`;
      case 'lifePass': return `${n(e.p)}さん：暮らしのプランは選ばなかった`;
      case 'skip': return `${n(e.p)}さん：${WHY[e.why] || 'スキップ'}`;
      case 'rest': return `${n(e.p)}さん：しばらく見学`;
      case 'back': return `${n(e.p)}さん：もどってきた`;
      case 'leave': return `${n(e.p)}さん：今回の参加を終えた`;
      case 'invite': return `${n(e.p)}さんが${n(e.to)}さんをコラボにさそった`;
      case 'accept': return `${n(e.p)}さん：コラボに参加`;
      case 'decline': return `${n(e.p)}さん：今回は見送り`;
      case 'refund': return `${n(e.p)}さん：時間チップが1枚もどった`;
      case 'career': return `進路のラウンド（${esc(D.CAREERS[e.stage].title)}）`;
      case 'careerPick': return `${n(e.p)}さん：${esc((E.careerRoute(e.route.startsWith('e') ? 'early' : 'mid', e.route) || {}).name || '進路')}を選んだ`;
      case 'careerPass': return `${n(e.p)}さん：進路はパス`;
      case 'round': return `ラウンド${e.n}`;
      case 'hold': return 'みんな休憩中';
      case 'pause': return '一時停止';
      case 'resume': return '再開';
      case 'lastLap': return '次の1周で本編終了';
      case 'final': return '最後の職業選びへ';
      case 'finalPick': return `${n(e.p)}さん：最後の職業を決めた`;
      case 'present': return `${n(e.p)}さん：仕上げのサイコロ`;
      case 'prep': return `${n(e.p)}さん：準備チップ＋1（${e.why === 'collab' ? 'コラボ' : 'チャレンジした経験'}）`;
      default: return '';
    }
  }

  // ── 結果 ───────────────────────────────────────
  function renderResults() {
    const g = G();
    const r = g.results;
    if (!r) return;
    const row = (x) => {
      const p = player(x.pid);
      const job = D.JOBS[x.job];
      const sc = E.score(p.apt, x.job);
      const bd = [
        `${esc(D.APTS[job.core].name)} ${sc.core}枚×2＝${sc.core * 2}`,
        `${esc(D.APTS[job.rel[0]].name)} ${sc.r0}`,
        `${esc(D.APTS[job.rel[1]].name)} ${sc.r1}`,
        sc.bonus ? '3種類そろい＋3' : '',
      ].filter(Boolean).map((t) => `<span>${t}</span>`).join('') + `<span><strong>職業の点 ${x.base}</strong></span>`;
      const chal = x.roll ? `<span class="is-chal">仕上げ 出目${esc(x.roll.die)}${x.roll.used ? `＋準備${esc(x.roll.used)}` : ''} → ＋${esc(x.roll.bonus)}</span>` : (g.final && g.final.rule === 'present' ? '<span>仕上げ前に発表</span>' : '');
      return `<div class="cs-rank" data-reveal>
        <div class="cs-rank__place">${r.ranked ? `${x.rank}位` : ''}<small>${r.ranked ? '' : 'ゲーム得点'}</small></div>
        <div>
          <div class="cs-rank__who">${avatarHTML(x.pid)}<span class="cs-rank__name">${esc(p.name)}</span><span class="cs-rank__job"><span class="material-symbols-rounded" aria-hidden="true">${job.icon}</span>${esc(job.name)}</span></div>
          <div class="cs-breakdown">${bd}${chal}</div>
        </div>
        <span class="cs-rank__score">${x.final}<small>点</small></span>
      </div>`;
    };
    const rows = r.rows.map(row).join('');
    const none = r.none.length ? `<div class="cs-card"><p class="cs-sec-title" style="font-size:15px">今回は途中まで</p><p class="cs-help">${r.none.map((pid) => esc(nameOf(pid)) + 'さん').join('、')}（最後の職業を選ばなかったので、結果はなし）</p></div>` : '';
    const footer = isHost()
      ? `<div class="cs-card cs-actions">${metricsSummaryHTML(true)}<button type="button" class="cs-btn cs-btn--danger cs-btn--full" data-act="closeRoom">ルームを閉じる</button></div>`
      : `<div class="cs-card cs-actions"><button type="button" class="cs-btn cs-btn--secondary cs-btn--full" data-act="exitRoom">退出する</button></div>`;
    const changed = patch('results', `
      <div class="cs-card" style="text-align:center"><p class="cs-event__label" style="justify-content:center"><span class="material-symbols-rounded" aria-hidden="true">emoji_events</span>結果発表</p>
        <h2 class="cs-title" style="font-size:28px">${r.ranked ? 'みんなの最後の職業' : r.rows.length ? 'ゲームの得点' : '結果'}</h2>
        <p class="cs-help">ゲームの得点です。本当の力や、向き・不向きを表すものではありません。</p></div>
      ${rows}${none}${footer}`);
    if (changed && !S.ui.revealed && S.prevSeq === null) S.ui.revealed = true; // 最初の表示（再接続など）では再生しない
    if (changed && !S.ui.revealed) {
      S.ui.revealed = true;
      window.scrollTo(0, 0); // 発表ボタンや最後の職業選びの下のほうから切り替わっても、見出しと1位から見せる
      announce('結果発表');
      document.querySelectorAll('[data-reveal]').forEach((el, i) => play(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], 320, i * 180));
    }
  }

  // ── 計測（ゲームの進み具合の時間だけ。回答や成長の記録ではない）──────────────
  function metricsData() {
    const g = G();
    const m = g.metrics;
    const now = N.now();
    const turns = m.turns.filter((r) => r[1] === 0);
    const careers = m.turns.filter((r) => r[1] === 2);
    const durs = turns.map((r) => r[3] - r[2]).filter((x) => x >= 0);
    const avg = durs.length ? durs.reduce((s, x) => s + x, 0) / durs.length : 0;
    const max = durs.length ? Math.max(...durs) : 0;
    const cdur = careers.map((r) => r[3] - r[2]);
    const cavg = cdur.length ? cdur.reduce((s, x) => s + x, 0) / cdur.length : 0;
    const end = m.results || now;
    return {
      lobby: m.setup ? m.setup - m.created : now - m.created,
      setup: m.setup ? (m.main || now) - m.setup : 0,
      main: m.main ? (m.final || now) - m.main : 0,
      final: m.final ? (m.results || now) - m.final : 0,
      total: end - m.created,
      nTurns: turns.length, avg, max, nCareer: careers.length, cavg,
      autoSkips: m.turns.filter((r) => r[1] === 1).length,
      players: g.order.length, chips: g.settings.chips, timer: g.settings.timerSec, career: g.settings.career, life: g.settings.life, present: g.settings.endRule === 'present',
    };
  }
  function metricsSummaryHTML(compact) {
    const d = metricsData();
    const rows = [
      ['待合室（説明）', ms(d.lobby)], ['準備（理想・配布・目標）', ms(d.setup)],
      ['本編', `${ms(d.main)}（手番${d.nTurns}回・平均${Math.round(d.avg / 1000)}秒・最長${Math.round(d.max / 1000)}秒${d.nCareer ? `・進路${d.nCareer}回 平均${Math.round(d.cavg / 1000)}秒` : ''}）`],
      ['最後の職業選び', ms(d.final)], ['合計', ms(d.total)],
    ];
    return `<details class="cs-trial"${compact ? '' : ' open'}><summary><span class="material-symbols-rounded" aria-hidden="true">timer</span>時間の計測（ホストだけに表示）</summary>
      <div class="cs-metrics">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>
      <p class="cs-help">プレイヤー${d.players}人・時間チップ${d.chips}枚・選ぶ時間${d.timer ? d.timer + '秒' : '制限なし'}・進路${d.career}回・暮らし${d.life ? 'あり' : 'なし'}・仕上げのサイコロ${d.present ? 'あり' : 'なし'}</p>
      <button type="button" class="cs-btn cs-btn--secondary cs-btn--full" data-act="copyMetrics">計測をコピー</button></details>`;
  }
  function metricsText() {
    const d = metricsData();
    return [
      `【${D.GAME_TITLE} 計測】`,
      `プレイヤー${d.players}人 / 時間チップ${d.chips}枚 / 選ぶ時間${d.timer ? d.timer + '秒' : '制限なし'} / 進路${d.career}回 / 暮らし${d.life ? 'あり' : 'なし'} / 仕上げのサイコロ${d.present ? 'あり' : 'なし'}`,
      `待合室: ${ms(d.lobby)}`, `準備: ${ms(d.setup)}`,
      `本編: ${ms(d.main)}（手番${d.nTurns}回・平均${Math.round(d.avg / 1000)}秒・最長${Math.round(d.max / 1000)}秒・進路${d.nCareer}回 平均${Math.round(d.cavg / 1000)}秒・休憩スキップ${d.autoSkips}回）`,
      `最後の職業選び: ${ms(d.final)}`, `合計: ${ms(d.total)}`,
    ].join('\n');
  }

  // ── ホストの進行パネル ───────────────────────────
  function renderDrawer() {
    const root = $('drawer-root');
    if (!S.ui.drawer || !isHost() || !G() || G().phase === 'lobby') { patch('drawer-root', ''); return; }
    const g = G();
    const t = g.turn;
    const specs = Object.values((S.room && S.room.spectators) || {});
    const players = g.order.map((pid) => {
      const p = player(pid);
      const btns = g.phase === 'main' || g.phase === 'setup' || g.phase === 'final'
        ? [p.status !== 'resting' && p.status !== 'left' ? `<button class="cs-chip-btn" data-act="pStatus" data-pid="${esc(pid)}" data-to="resting" data-fk="ps-${esc(pid)}-r">見学にする</button>` : '',
          p.status !== 'active' ? `<button class="cs-chip-btn" data-act="pStatus" data-pid="${esc(pid)}" data-to="active" data-fk="ps-${esc(pid)}-a">戻す</button>` : '',
          p.status !== 'left' ? `<button class="cs-chip-btn" data-act="pStatus" data-pid="${esc(pid)}" data-to="left" data-fk="ps-${esc(pid)}-l">参加を終える</button>` : ''].join('') : '';
      return `<div class="cs-dplayer">${avatarHTML(pid)}<div><strong>${esc(p.name)}</strong> ${statusChip(pid)}<div class="cs-help">時間チップ あと${p.chips}${p.ctrl === 'host' ? '・端末なし' : ''}</div></div><div class="cs-dplayer__btns">${btns}</div></div>`;
    }).join('');
    const inMain = g.phase === 'main';
    patch('drawer-root', `<div class="cs-drawer-backdrop" data-act="drawer"></div>
      <aside class="cs-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div class="cs-drawer__head"><span class="material-symbols-rounded" aria-hidden="true">tune</span><span class="cs-drawer__title" id="drawer-title">進行（ホスト用）</span><button class="cs-drawer__close" data-act="drawer" aria-label="閉じる"><span class="material-symbols-rounded">close</span></button></div>
        <div class="cs-drawer__body">
          <div class="cs-dsec"><p class="cs-dsec__title">操作</p>
            <button class="cs-dbtn" data-act="proxy" data-fk="d-proxy" aria-pressed="${S.ui.proxyOn}"><span class="material-symbols-rounded" aria-hidden="true">record_voice_over</span><span>代わりに操作する：${S.ui.proxyOn ? 'オン' : 'オフ'}<small>端末で参加している人の選択も、ホストが押せるようにする（本人が言った番号を押す）</small></span></button>
            ${inMain ? `<button class="cs-dbtn" data-act="pause" data-fk="d-pause" aria-pressed="${g.paused}"><span class="material-symbols-rounded" aria-hidden="true">${g.paused ? 'play_arrow' : 'pause'}</span><span>${g.paused ? '再開する' : '一時停止する'}<small>選ぶ時間のタイマーを止める（読み上げ・機器のトラブル用）</small></span></button>` : ''}
            ${inMain && t ? `<button class="cs-dbtn" data-act="hostSkip" data-fk="d-hostSkip"><span class="material-symbols-rounded" aria-hidden="true">skip_next</span><span>${esc(nameOf(t.pid))}さんの手番をスキップ<small>時間チップは二重に減らない。確定したカードはそのまま</small></span></button>` : ''}
            ${inMain && g.lastLap === null ? `<button class="cs-dbtn" data-act="endLap" data-fk="d-endLap"><span class="material-symbols-rounded" aria-hidden="true">flag_circle</span><span>次の1周で本編を終える<small>いまの手番のあと、ほかの人が1回ずつ進んだら終盤へ</small></span></button>` : ''}
            ${inMain ? `<button class="cs-dbtn cs-dbtn--danger" data-act="endNow" data-fk="d-endNow"><span class="material-symbols-rounded" aria-hidden="true">sports_score</span><span>すぐに本編を終える<small>最後の職業選びへ進む</small></span></button>` : ''}
          </div>
          <div class="cs-dsec"><p class="cs-dsec__title">プレイヤー（${g.order.length}人）</p>${players}</div>
          <div class="cs-dsec"><p class="cs-dsec__title">見学の人（${specs.length}人）</p><p class="cs-help">${specs.map((s) => esc((s && s.name) || '見学の人')).join('、') || 'いません'}</p></div>
          <div class="cs-dsec">${metricsSummaryHTML(false)}</div>
          <div class="cs-dsec"><button class="cs-dbtn cs-dbtn--danger" data-act="closeRoom" data-fk="d-closeRoom"><span class="material-symbols-rounded" aria-hidden="true">close</span><span>ルームを閉じる<small>全員のゲームが終わります</small></span></button></div>
        </div>
      </aside>`);
    void root;
  }

  // ── オーバーレイ・モーダル ─────────────────────────
  function renderOverlay() {
    const ov = $('overlay');
    if (!S.session || !S.room) { if (!S.reconnecting) ov.hidden = true; return; }
    const meta = S.room.meta || {};
    if (!S.connected) {
      ov.hidden = false;
      $('overlay-spinner').hidden = false;
      $('overlay-title').textContent = '接続を確認しています';
      $('overlay-text').textContent = '通信が戻ると、自動で続きから表示します。';
      $('overlay-btn').hidden = true;
      return;
    }
    if (isHost() || meta.hostConnected !== false) S.goneMsg = null; // ホストが戻った（期限切れの削除は中止された）
    if (!isHost() && meta.hostConnected === false) {
      const deadline = N.hostDeadline(S.room);
      const left = deadline ? deadline - N.now() : 0;
      // 期限を過ぎたら、見つけた側でルームを消す（共通規約）。消えたら「ルームが閉じられました」の代わりに理由を出す
      if (left <= 0 && S.session) { const code = S.session.code; once('expire', () => { S.goneMsg = 'ホストが戻らなかったため、ルームは終了しました'; N.removeIfExpired(code); }); }
      ov.hidden = false;
      $('overlay-spinner').hidden = left <= 0;
      $('overlay-title').textContent = left > 0 ? 'ホストの接続を待っています' : 'ルームは終了しました';
      $('overlay-text').textContent = left > 0 ? `ホストが戻ると続きから再開します（あと${ms(left)}で終了）。` : 'ホストが戻らなかったため、このルームは終了しました。';
      $('overlay-btn').hidden = left > 0;
      return;
    }
    ov.hidden = true;
  }

  function openModal(m) {
    if (!S.ui.modal) {
      S.ui.modalOpener = document.activeElement;
      S.ui.modalOpenerFk = (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.fk) || null;
    }
    S.ui.modal = m;
    S.ui.modalFocused = false;
    renderModal();
  }
  function closeModal() {
    S.ui.modal = null;
    S.ui.confirm = null;
    renderModal();
    let back = S.ui.modalOpener;
    // 開いている間にボタンが描き直されたら、同じ目印のボタンへ戻す
    if ((!back || !document.body.contains(back)) && S.ui.modalOpenerFk) back = document.querySelector(`[data-fk="${CSS.escape(S.ui.modalOpenerFk)}"]`);
    S.ui.modalOpener = null;
    S.ui.modalOpenerFk = null;
    if (back && document.body.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }
  // モーダルを開いている間は、後ろの画面をフォーカス・読み上げの対象から外す
  function setBackgroundInert(on) {
    document.querySelectorAll('.screen, #drawer-root').forEach((el) => { el.inert = on; });
  }
  function renderModal() {
    const m = S.ui.modal;
    if (!m) { patch('modal-root', ''); setBackgroundInert(false); return; }
    let title = '';
    let body = '';
    let wide = false;
    if (m.type === 'rules') { title = 'くわしいルール'; body = rulesHTML(); }
    else if (m.type === 'guide') { title = 'はじめてガイド'; body = guideStepsHTML(); }
    else if (m.type === 'prefs') { title = '表示と参加の設定'; body = prefsHTML(); }
    else if (m.type === 'tile') { title = D.SQUARES[D.NODES[m.node].type].long + 'のマス'; body = tileHTML(m.node); }
    else if (m.type === 'map') { title = 'マップ全体'; wide = true; body = '<div id="map-slot"></div><div class="cs-legend">' + ($('board-legend') ? $('board-legend').innerHTML : '') + '</div>'; }
    else if (m.type === 'lateGoal') { title = '当面の目標を選ぶ'; body = lateGoalHTML(m.pid); }
    else if (m.type === 'confirm') {
      title = m.title;
      body = `<p>${m.text}</p><div class="cs-actions"><button type="button" class="cs-btn ${m.danger ? 'cs-btn--danger' : 'cs-btn--primary'} cs-btn--full" data-act="confirmOk" data-fk="confirm-ok">${esc(m.ok)}</button><button type="button" class="cs-btn cs-btn--secondary cs-btn--full" data-act="closeModal">やめておく</button></div>`;
    }
    const changed = patch('modal-root', `<div class="cs-modal-backdrop" data-act="closeModalBg"><div class="cs-modal${wide ? ' cs-modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="cs-modal__head"><h2 class="cs-modal__title" id="modal-title">${esc(title)}</h2><button type="button" class="cs-iconbtn" data-act="closeModal" aria-label="閉じる"><span class="material-symbols-rounded" aria-hidden="true">close</span></button></div>
      <div class="cs-modal__body">${body}</div></div></div>`);
    setBackgroundInert(true);
    if (changed) {
      const gh = document.getElementById('guide-hero');
      if (gh) B.hero(gh);
      if (m.type === 'map') {
        const slot = $('map-slot');
        const svg = $('board').cloneNode(true);
        svg.removeAttribute('id');
        svg.querySelectorAll('[tabindex]').forEach((n) => n.removeAttribute('tabindex'));
        slot.appendChild(svg);
      }
      if (!S.ui.modalFocused) {
        S.ui.modalFocused = true;
        const focusEl = document.querySelector('.cs-modal [data-fk="confirm-ok"]') || document.querySelector('.cs-modal .cs-iconbtn');
        if (focusEl) focusEl.focus({ preventScroll: true });
      }
    }
  }
  // はじめてガイド（5ステップ）。絵は画面の部品で描く
  const GUIDE_STEPS = 5;
  function focusGuide() { const h = document.querySelector('.cs-modal .cs-guidestep__title'); if (h) h.focus({ preventScroll: true }); }
  function guideStepsHTML() {
    const step = Math.max(0, Math.min(GUIDE_STEPS - 1, S.ui.guideStep || 0));
    const sampleApt = [1, 1, 2, 0, 0, 0];
    const legend = ['grow', 'new', 'job', 'event', 'collab', 'life'].map((t) => {
      const sq = D.SQUARES[t];
      return `<div><span class="material-symbols-rounded" aria-hidden="true" style="color:${sq.color}">${sq.icon}</span><span><strong>${esc(sq.long)}</strong><br>${esc(TILE_TEXT[t])}</span></div>`;
    }).join('');
    const steps = [
      { t: 'このゲームでやること', b: `<p>まちをすごろくでめぐって、<strong>適性カード</strong>と<strong>職業カード</strong>を集めよう。最後に、持っている職業から1つを選ぶよ。</p>
          <p>選んだ職業に合う適性をたくさん持っているほど、点が高くなる。</p>
          <div class="cs-guidefig"><svg viewBox="0 0 420 150" class="cs-hero__art" id="guide-hero" aria-hidden="true"></svg></div>
          <p class="cs-help">カードや点はゲームの中のもの。本当の向き・不向きとは関係ないよ。</p>` },
      { t: '職業カードの見かた', b: `<div class="cs-guidefig cs-guidefig--job">${jobCardHTML(0, { apt: sampleApt })}</div>
          <p>いちばん大事なのは<strong>「中心」（×2）</strong>の適性。1枚で2点になる。「関連」（×1）は1枚で1点。</p>
          <div class="cs-formula">例: ものづくり2枚×2＝4 ＋ アイデア1 ＋ 気づく力1 ＋ 3種類そろい3 ＝ <strong>9点</strong>（最大${E.MAX_SCORE}点）</div>` },
      { t: '1回の手番', b: `<ol><li>「サイコロを振る」で進む（分かれ道では道を選ぶ）</li><li>止まったマスで、やることを選ぶ</li><li>「手番を終える」で次の人へ</li></ol>
          <div class="cs-rulegrid">${legend}</div>
          <p class="cs-help">決まった周には、全員で「進路のラウンド」。進路と体験を選んで、適性カードを1枚もらえるよ。</p>` },
      { t: '作戦のコツ', b: `<ul class="cs-points">
          <li><span class="material-symbols-rounded" aria-hidden="true">flag</span><span>まず<strong>目標の職業</strong>を決めよう。選択肢に「目標の中心×2」「目標の点＋2」のように表示されるよ。</span></li>
          <li><span class="material-symbols-rounded" aria-hidden="true">workspaces</span><span>目標の3つの適性を<strong>全部1枚以上</strong>にすると「3種類そろい」で＋3。まだない適性を見つけるのも大事。</span></li>
          <li><span class="material-symbols-rounded" aria-hidden="true">casino</span><span>イベントは、持っている適性を狙うと出目＋1。まだない適性は、成功すれば一気に2枚。</span></li>
          <li><span class="material-symbols-rounded" aria-hidden="true">bolt</span><span>うまくいかなかったときや、2人でコラボしたときは<strong>準備チップ</strong>がもらえる（最後の仕上げで役に立つ）。</span></li>
          <li><span class="material-symbols-rounded" aria-hidden="true">work</span><span>職業カードをいくつか持っておくと、最後に点の高いものを選べる。</span></li></ul>` },
      { t: '最後の仕上げ', b: `<p>時間チップを使い切ったら、持っている職業から1つを選ぶ。そのあと<strong>仕上げのサイコロ</strong>を振るよ。</p>
          ${presentTableHTML(1).replace('準備チップ 1枚 → 出目に＋1', '例: 準備チップ1枚なら出目に＋1')}
          <p>目標に合わせて集めれば高い点がとれる。でも<strong>1位になれるかは、最後のサイコロ次第</strong>のこともあるよ。</p>` },
    ];
    const cur = steps[step];
    const dots = steps.map((x, i) => `<span class="cs-guidedot${i === step ? ' is-on' : ''}" aria-hidden="true"></span>`).join('');
    return `<div class="cs-guidestep">
        <p class="cs-help">${step + 1} / ${GUIDE_STEPS}</p>
        <h3 class="cs-guidestep__title" tabindex="-1">${esc(cur.t)}<span class="cs-sr">（${step + 1} / ${GUIDE_STEPS}）</span></h3>
        ${cur.b}
      </div>
      <div class="cs-guidedots">${dots}</div>
      <div class="cs-guidenav">
        ${step > 0 ? '<button type="button" class="cs-btn cs-btn--secondary" data-act="guidePrev" data-fk="guide-prev">もどる</button>' : '<span></span>'}
        ${step < GUIDE_STEPS - 1 ? '<button type="button" class="cs-btn cs-btn--primary" data-act="guideNext" data-fk="guide-next">次へ</button>' : '<button type="button" class="cs-btn cs-btn--primary" data-act="closeModal" data-fk="guide-close">わかった</button>'}
      </div>
      ${step === GUIDE_STEPS - 1 ? '<div class="cs-quietrow"><button type="button" class="cs-quiet" data-act="openRules">くわしいルールを見る</button></div>' : ''}`;
  }
  function rulesHTML() {
    const sqRows = ['grow', 'new', 'job', 'event', 'collab', 'life'].map((t) => {
      const sq = D.SQUARES[t];
      const desc = TILE_TEXT[t];
      return `<div><span class="material-symbols-rounded" aria-hidden="true" style="color:${sq.color}">${sq.icon}</span><span><strong>${esc(sq.long)}</strong><br>${esc(desc)}</span></div>`;
    }).join('');
    const present = !G() || G().settings.endRule === 'present';
    const lastHTML = present
      ? `<div><h3>準備チップ</h3><p>イベント・コラボの判定でカードが取れなかったとき（別の適性を選ぶ前に手番が終わったときも）と、2人でコラボしてサイコロを振ったときに1枚もらえます（2枚まで）。</p></div>
      <div><h3>最後</h3><p>時間チップを使い切ったら、持っている職業から最後の1つを選びます。そのあと「仕上げのサイコロ」を振り、出目＋準備チップの合計で点が加わります（合計1〜2は＋0、3〜4は＋1、5〜6は＋2、7〜8は＋3）。加わるのは0〜3点なので、3点以上の差は逆転しません。カードや得点はゲームの中のもので、本当の力や向き・不向きとは関係ありません。</p></div>`
      : '<div><h3>最後</h3><p>時間チップを使い切ったら、持っている職業から最後の1つを選び、得点を見ます。カードや得点はゲームの中のもので、本当の力や向き・不向きとは関係ありません。</p></div>';
    return `
      <div><h3>ゲームの目的</h3><p>まちをめぐって「適性カード」と「職業カード」を集め、最後に1つの職業を選びます。選んだ職業に合う適性が多いほど、ゲームの得点が高くなります。</p></div>
      <div class="cs-formula">職業の点 ＝ 中心の適性の枚数×2 ＋ 関連の適性2種類の枚数 ＋ 3種類がそろうと＋3（最大${E.MAX_SCORE}点）</div>
      <div><h3>はじめに</h3><ol><li>理想の職業を1つ選ぶ（「まだ決めない」でもOK）</li><li>適性カードが3枚配られる</li><li>職業の候補3枚から、当面の目標を選ぶ</li></ol></div>
      <div><h3>1回の手番</h3><ol><li>時間チップを1枚使う（スキップしても同じ）</li><li>「サイコロを振る」で進む。分かれ道では道を選ぶ</li><li>止まったマスで、やることを選ぶ</li><li>「手番を終える」で次の人へ</li></ol></div>
      <div><h3>マスの種類</h3><div class="cs-rulegrid">${sqRows}</div></div>
      <div><h3>イベントの判定</h3><p>やることを選んでサイコロ。持っている適性を狙うと出目に＋1。5〜6なら狙った適性を2枚、3〜4なら別の適性を1枚選ぶ、1〜2なら今回はなし。</p></div>
      <div><h3>進路のラウンド</h3><p>決まった周では、全員が同時に「どの進路を試すか」と「そこで何をするか」を選び、適性カードを1枚もらいます（サイコロなし）。ゲームの中の進路で、本当の志望を答えるものではありません。</p></div>
      <div><h3>休む・見学する</h3><p>自分の番の「今回はスキップ」「しばらく見学」でひと休みできます。カードはなくなりません。見学中も、自分の番では時間チップを1枚使います。</p></div>
      ${lastHTML}`;
  }
  const TILE_TEXT = {
    start: '駅。止まったら「新しい体験」をするよ。',
    grow: '持っている適性から1つ選んで、1枚ふやす。',
    new: 'やってみたい体験を1つ選んで、その適性を1枚ふやす（初めての適性も出る）。',
    job: '職業の候補3枚から1枚を、手札に加える。',
    event: 'やることを選んで、サイコロでチャレンジ。地区によって出やすいイベントが変わる。',
    collab: 'だれかをさそって、いっしょにチャレンジ（さそわれた人は時間チップ1枚）。',
    life: '暮らしのプランを選ぶ（1人1回）。この先2回の判定に＋1／−1の効果。',
  };
  function tileHTML(nodeId) {
    const n = D.NODES[nodeId];
    const sq = D.SQUARES[n.type];
    const d = D.DISTRICTS.find((x) => x.id === n.d);
    const here = G() ? G().order.filter((pid) => player(pid).pos === nodeId).map((pid) => esc(nameOf(pid)) + 'さん') : [];
    return `<div class="cs-gain"><span class="cs-apt__icon" style="background:${sq.tint};color:${sq.color}"><span class="material-symbols-rounded" aria-hidden="true">${sq.icon}</span></span><div class="cs-gain__text"><p class="cs-gain__title">${esc(sq.long)}（${esc(d.name)}）</p><p class="cs-gain__sub">${esc(TILE_TEXT[n.type])}</p></div></div>
      ${d.apts.length ? `<p class="cs-help">${esc(d.name)}のイベントでは ${d.apts.map((a) => esc(D.APTS[a].name)).join('・')} を狙いやすい。</p>` : ''}
      ${n.next.length > 1 ? '<p class="cs-help">ここは分かれ道。通るときに道を選べます。</p>' : ''}
      ${here.length ? `<p class="cs-help">ここにいる人: ${here.join('、')}</p>` : ''}`;
  }
  function prefsHTML() {
    const me = myPid();
    const p = me && player(me);
    const g = G();
    const os = motionQuery.matches;
    let html = `<label class="cs-dbtn" style="cursor:pointer"><input type="checkbox" data-pref="reduce" ${reduced() ? 'checked' : ''} ${os ? 'disabled' : ''} style="width:22px;height:22px;accent-color:var(--color-accent)"><span>動きを減らす<small>${os ? '端末の設定に合わせています' : 'サイコロや駒の動きを止めて、結果だけを表示'}</small></span></label>
      <label class="cs-dbtn" style="cursor:pointer"><input type="checkbox" data-pref="large" ${S.prefs.large ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--color-accent)"><span>文字を大きくする<small>問いと本文を少し大きく</small></span></label>
      <label class="cs-dbtn" style="cursor:pointer"><input type="checkbox" data-pref="guide" ${S.prefs.guide ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--color-accent)"><span>ヒントを表示する（はじめてガイド）<small>選ぶ場面のヒント・「目標の点＋いくつ」・目標までのみちのり</small></span></label>
      <button class="cs-dbtn" data-act="openGuide" data-fk="d-openGuide"><span class="material-symbols-rounded" aria-hidden="true">menu_book</span><span>はじめてガイドを見る</span></button>`;
    if (p && g && (g.phase === 'main' || g.phase === 'setup')) {
      html += '<p class="cs-dsec__title" style="margin-top:6px">参加のしかた</p>';
      if (p.status === 'active') html += `<button class="cs-dbtn" data-act="rest" data-fk="d-rest" data-pid="${esc(me)}"><span class="material-symbols-rounded" aria-hidden="true">weekend</span><span>しばらく見学する<small>カードはそのまま。自分の番では時間チップを1枚使う</small></span></button>`;
      else html += `<button class="cs-dbtn" data-act="back" data-fk="d-back" data-pid="${esc(me)}"><span class="material-symbols-rounded" aria-hidden="true">play_arrow</span><span>次の自分の番から戻る</span></button>`;
      if (p.status !== 'left') html += `<button class="cs-dbtn cs-dbtn--danger" data-act="leaveGame" data-fk="d-leaveGame" data-pid="${esc(me)}"><span class="material-symbols-rounded" aria-hidden="true">logout</span><span>今回の参加を終える<small>以降の手番とおさそいから外れる。最後の職業選びには参加できる</small></span></button>`;
    }
    if (!isHost() && S.session) html += `<button class="cs-dbtn" data-act="exitRoom" data-fk="d-exitRoom"><span class="material-symbols-rounded" aria-hidden="true">door_open</span><span>ルームから退出する</span></button>`;
    return html;
  }
  function lateGoalHTML(pid) {
    const p = player(pid);
    if (!p) return '';
    const key = `late:${pid}`;
    const sel = S.ui.sel[key];
    return `<div class="cs-jobs">${p.setup.cands.map((j, i) => jobCardHTML(j, { key, i, num: i, pressed: sel === i, pid, apt: p.apt })).join('')}</div><div class="cs-actions">${primaryBtn('lateGoalOk', 'これを目標にする', sel === undefined, { pid })}</div>`;
  }
  function askConfirm(title, text, ok, fn, danger) {
    S.ui.confirm = fn;
    openModal({ type: 'confirm', title, text, ok, danger });
  }

  // ── 演出（新しいログだけ。初回表示・再接続では再生しない）───────
  function processLog(prevGame, g) {
    if (S.prevSeq === null) {
      S.prevSeq = g.seq;
      g.order.forEach((pid) => { S.lastPos[pid] = player(pid).pos; });
      return;
    }
    const fresh = g.log.filter((e) => e.s >= S.prevSeq);
    S.prevSeq = g.seq;
    fresh.forEach((e) => {
      if (e.k === 'move' && e.path && e.path.length) {
        const from = S.lastPos[e.p] != null ? S.lastPos[e.p] : e.path[0];
        B.animateMove(e.p, from, e.path);
      }
      if (e.k === 'prep') {
        // ふえた1枚（いまの枚数の位置）を動かす。判定の結果の表示があればそちらを先に探す
        const pp = player(e.p);
        const pl = document.querySelector(`[data-prep="${CSS.escape(e.p)}"] .cs-prepdot:nth-child(${Math.max(1, pp ? pp.prep : 1)})`);
        play(pl, [{ transform: 'scale(.6)', opacity: 0.4 }, { transform: 'scale(1.2)', opacity: 1, offset: 0.6 }, { transform: 'none' }], 350);
        if (!fresh.some((x) => x.k === 'gain')) announce(`${nameOf(e.p)}さん：準備チップ＋1`);
      }
      if (e.k === 'roll' || e.k === 'present') {
        const el = document.querySelector(`[data-anim="${e.k === 'roll' ? `roll-${g.turn ? g.turn.id : ''}-${e.p}` : `present-${e.p}`}"]`);
        play(el, [{ transform: 'translateY(-8px) rotate(-20deg)' }, { transform: 'translateY(0) rotate(12deg)', offset: 0.45 }, { transform: 'translateY(-2px) rotate(-5deg)', offset: 0.75 }, { transform: 'none' }], 500);
      }
      if (e.k === 'gain') {
        const row = document.querySelector(`[data-apt-row="${CSS.escape(e.p + '-' + e.a)}"]`);
        if (row && !$('hand').classList.contains('is-collapsed')) {
          const pips = row.querySelectorAll('.cs-pip.is-on');
          Array.from(pips).slice(-e.n).forEach((pip) => play(pip, [{ transform: 'translateY(6px) scale(.7)', opacity: 0.5 }, { transform: 'translateY(-2px) scale(1.12)', opacity: 1, offset: 0.65 }, { transform: 'none', opacity: 1 }], 350));
        } else {
          const t = document.querySelector(`[data-hand-title="${CSS.escape(e.p)}"]`);
          play(t, [{ transform: 'none' }, { transform: 'translateY(-3px)', offset: 0.4 }, { transform: 'none' }], 350);
        }
        const box = document.querySelector(`[data-gain="${CSS.escape(e.p + '-' + e.a)}"]`);
        play(box, [{ transform: 'scale(.96)', opacity: 0.6 }, { transform: 'scale(1.02)', opacity: 1, offset: 0.6 }, { transform: 'none' }], 350);
      }
      if (e.k === 'job') {
        const card = document.querySelector(`[data-anim="job-${CSS.escape(e.p)}-${e.j}"]`);
        play(card, [{ transform: 'translateY(-14px) scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], 360);
      }
      if (e.k === 'deal') {
        document.querySelectorAll(`[data-anim^="deal-${CSS.escape(e.p)}-"]`).forEach((el, i) => play(el, [{ transform: 'rotateY(80deg) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], 350, i * 160));
      }
      if (e.k === 'turn' && g.turn && g.turn.pid === e.p) announce(`${nameOf(e.p)}さんの番です`);
      if (e.k === 'invite' && canControl(e.to)) announce(`${nameOf(e.p)}さんからコラボのおさそい。参加するか、見送るか選んでね`);
      if (e.k === 'gain') announce(`${nameOf(e.p)}さん：${D.APTS[e.a].name}${e.disc ? 'を発見' : 'がふえた'}`);
    });
    g.order.forEach((pid) => { S.lastPos[pid] = player(pid).pos; });
  }

  // ── ルームの購読 ────────────────────────────────
  function onRoom(room) {
    // meta か game がない＝削除のあとに書き込みだけが残った不完全なルーム。待合室として描かずに退出し、
    // 残骸を消す（サーバーの値で不完全なこと＝期限切れを確かめてから消す）
    if (!room || !room.meta || !room.game) {
      const code = S.session && S.session.code;
      // 退出の書き込み（在室・選択中の削除）が終わってから掃除する（同じ端末の書き込みは掃除の transaction を止めるため）
      bail('ルームが閉じられました').then(() => { if (code) N.removeIfExpired(code); });
      return;
    }
    const prev = S.game;
    S.room = room;
    let g;
    try { g = E.normalize(room.game); } catch (err) { console.error(err); return; }
    S.game = g;
    if (S.session.role === 'player' && !g.players[S.session.id]) { bail('待合室から外れました'); return; }
    if (S.session.role === 'host' && g.host.id !== S.session.id) { bail('ルームが閉じられました'); return; }
    if (g.turn && S.ui.lastTurn !== g.turn.id) {
      S.ui.lastTurn = g.turn.id;
      S.ui.reselect = {};
      if (isHost()) S.ui.handPid = null;
    }
    render();
    processLog(prev, g);
    if (isHost() && S.connected && room.meta && room.meta.hostConnected === false) {
      once('reassert', () => { N.armPresence().then(hostBack).catch(() => {}); });
    }
  }
  async function onGone() {
    const s = S.session;
    if (!s) return;
    const msg = S.goneMsg || 'ルームが閉じられました';
    S.goneMsg = null;
    await bail(msg);
  }
  async function bail(msg) {
    const s = S.session;
    S.session = null;
    clearSession();
    N.unwatch();
    if (s) await N.leaveRoom(s).catch(() => {});
    resetLocal();
    showScreen('top');
    if (msg) toast(msg);
  }
  function resetLocal() {
    S.room = null; S.game = null; S.prevSeq = null; S.lastPos = {}; S.sig = {}; S.stageKey = ''; S.goneMsg = null;
    Object.assign(S.ui, { sel: {}, selV: {}, reselect: {}, proxyOn: false, drawer: false, modal: null, modalOpener: null, modalOpenerFk: null, modalFocused: false, handPid: null, actFor: null, idealPage: {}, routePage: {}, confirm: null, revealed: false });
    $('overlay').hidden = true;
    patch('drawer-root', ''); patch('modal-root', '');
    // ガイドなどを開いたままルームが閉じられた・外されたときも、後ろの画面を操作できる状態に戻す
    setBackgroundInert(false);
    stopTick();
  }
  // 時計（選ぶ時間・招待・進路の締め切りと、ホスト不在の表示）は、ルームに入っているあいだだけ動かす
  let tickTimer = null;
  function startTick() { if (!tickTimer) tickTimer = setInterval(tick, 500); }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }
  async function enterRoom(session) {
    S.session = session;
    saveSession();
    resetLocal();
    N.setArmed(session);
    S.graceUntil = Date.now() + 4000;
    N.watch(session.code, onRoom, onGone);
    startTick();
    afterArm(await N.armPresence());
  }
  // 在室の登録のあと。見学の再登録（再読み込み・切断のあと）が人数の上限・名前の重複で断られたら退出する。
  // 期限切れのルーム（ホストが長くいなかった）は復活させず、退出してから消す（共通規約）
  function afterArm(r) {
    if (r && S.session && r.reason === 'expired') {
      const code = S.session.code;
      bail('時間がたったため、ルームは終了しました').then(() => N.removeIfExpired(code));
      return;
    }
    if (r && S.session && S.session.role === 'spectator' && (r.reason === 'watchFull' || r.reason === 'nameTaken')) { bail(REASONS[r.reason]); return; }
    hostBack(r);
  }
  // ホストがいない間に進まなかった時間を、選ぶ時間・招待・進路の締め切りに数えない
  function hostBack(r) {
    if (!isHost() || !r || !(r.away > 1500)) return;
    const send2 = () => { if (G() && G().phase === 'main') send({ t: 'HOST_BACK', away: r.away }, { quiet: true }); };
    if (G()) send2(); else setTimeout(send2, 800);
  }

  // ── 入口の操作 ─────────────────────────────────
  function validName(v) { return v.length >= 1 && v.length <= 8; }
  // 通信を待つあいだ、ボタンに「接続しています…」を出し、長引いたら案内する（中断はしない）
  async function withWaiting(btn, errId, fn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '接続しています…';
    const slow = setTimeout(() => formError(errId, '通信に時間がかかっています。このまま少し待ってね（長く続くときはページを読み込み直してね）'), 8000);
    try { return await fn(); } finally {
      clearTimeout(slow);
      btn.disabled = false;
      btn.textContent = label;
    }
  }
  async function onCreate(e) {
    e.preventDefault();
    const name = $('create-name').value.trim();
    if (!validName(name)) { formError('create-error', 'ニックネームを1〜8文字で入れてね'); $('create-name').focus(); return; }
    formError('create-error', '');
    const btn = e.target.querySelector('[type=submit]');
    if (btn.disabled) return;
    await withWaiting(btn, 'create-error', async () => {
      try {
        const { code, id } = await N.createRoom(name, S.ui.createRole === 'play');
        formError('create-error', '');
        await enterRoom({ code, id, role: 'host', name });
      } catch (err) {
        console.error(err);
        formError('create-error', 'ルームを作れませんでした。通信を確かめて、もう一度試してね');
      }
    });
  }
  async function onJoin(e) {
    e.preventDefault();
    const name = $('join-name').value.trim();
    const code = $('join-code').value.trim().toUpperCase();
    const watch = S.ui.joinRole === 'watch';
    if (!watch && !validName(name)) { formError('join-error', 'ニックネームを1〜8文字で入れてね'); $('join-name').focus(); return; }
    if (watch && name.length > 8) { formError('join-error', 'ニックネームは8文字までだよ'); return; }
    if (!N.validCode(code)) { formError('join-error', 'ルームコードは6文字（英数字）だよ'); $('join-code').focus(); return; }
    formError('join-error', '');
    const btn = $('join-submit');
    if (btn.disabled) return;
    await withWaiting(btn, 'join-error', async () => { try {
      if (watch) {
        const r = await N.joinSpectator(code, name);
        if (r.error) { formError('join-error', REASONS[r.error] || 'ルームに入れませんでした'); return; }
        formError('join-error', '');
        await enterRoom({ code, id: r.id, role: 'spectator', name });
      } else {
        const r = await N.joinPlayer(code, name);
        if (r.error === 'started') {
          formError('join-error', 'ゲームはもう始まっています。「見学する」を選ぶと入れます（遊ぶのは次の回から）。');
          setJoinRole('watch');
          return;
        }
        if (r.error) { formError('join-error', REASONS[r.error] || 'ルームに入れませんでした'); return; }
        formError('join-error', '');
        await enterRoom({ code, id: r.id, role: 'player', name });
      }
    } catch (err) {
      console.error(err);
      formError('join-error', '通信がうまくいきませんでした。もう一度試してね');
    } });
    // 「参加する／見学する」の表示は役割に合わせて戻す
    setJoinRole(S.ui.joinRole);
  }
  function setJoinRole(v) {
    S.ui.joinRole = v;
    document.querySelectorAll('[data-act="joinRole"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    $('join-submit').textContent = v === 'watch' ? '見学する' : '参加する';
    $('join-role-help').textContent = v === 'watch' ? '見るだけで、手番や得点はありません。名前はなくても入れます。' : 'カードを集めて遊びます。';
  }
  async function onProxy(e) {
    e.preventDefault();
    const input = $('proxy-name');
    const name = input.value.trim();
    if (!validName(name)) { formError('proxy-error', 'ニックネームを1〜8文字で入れてね'); return; }
    const pid = 'x' + Math.random().toString(36).slice(2, 12);
    const r = await send({ t: 'ADD_PROXY', pid, name }, { quiet: true });
    if (!r.ok) { formError('proxy-error', REASONS[r.reason] || '追加できませんでした'); return; }
    const box = $('proxy-name');
    if (box) box.value = '';
    S.sig['lobby-root'] = null;
    render();
    formError('proxy-error', '');
  }

  async function reconnect(session) {
    S.reconnecting = true;
    const ov = $('overlay');
    ov.hidden = false;
    $('overlay-spinner').hidden = false;
    $('overlay-title').textContent = '前のルームに戻っています';
    $('overlay-text').textContent = '';
    $('overlay-btn').hidden = true;
    try {
      const room = await N.readRoom(session.code); // 匿名認証が失敗していれば、ここで試し直す（net.js ensureAuth）
      const g = room && room.game;
      const ok = room && !N.isExpired(room) && (
        (session.role === 'host' && g.host && g.host.id === session.id)
        || (session.role === 'player' && g.players && g.players[session.id])
        || session.role === 'spectator');
      if (!ok) {
        if (room && N.isExpired(room)) N.removeIfExpired(session.code);
        clearSession();
        showScreen('top');
        toast('前のルームは終了しています');
        return;
      }
      await enterRoom(session);
    } catch (err) {
      console.error(err);
      clearSession();
      showScreen('top');
      toast('前のルームに戻れませんでした');
    } finally {
      S.reconnecting = false;
      renderOverlay();
    }
  }

  // ── 操作の一覧 ─────────────────────────────────
  function selIndex(key) { return S.ui.sel[key]; }
  function setCursor(pid, key, i, v) { if (S.session) N.setCursor(S.session.code, pid, key, i, v); }
  const ACTIONS = {
    // 画面を出したらすぐ名前欄へ（遅れてフォーカスを動かすと、入力中の欄から奪ってしまう）
    goCreate() { showScreen('create'); $('create-name').focus(); },
    goJoin() { showScreen('join'); $('join-name').focus(); },
    goTop() { showScreen('top'); },
    createRole(d) { S.ui.createRole = d.v; document.querySelectorAll('[data-act="createRole"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === d.v))); },
    joinRole(d) { setJoinRole(d.v); },
    openRules() { openModal({ type: 'rules' }); },
    openGuide() { S.ui.guideStep = 0; openModal({ type: 'guide' }); },
    guideNext() { S.ui.guideStep = Math.min(GUIDE_STEPS - 1, (S.ui.guideStep || 0) + 1); S.sig['modal-root'] = null; renderModal(); focusGuide(); },
    guidePrev() { S.ui.guideStep = Math.max(0, (S.ui.guideStep || 0) - 1); S.sig['modal-root'] = null; renderModal(); focusGuide(); },
    openPrefs() { openModal({ type: 'prefs' }); },
    openMap() { openModal({ type: 'map' }); },
    tile(d) { openModal({ type: 'tile', node: Number(d.node) }); },
    closeModal() { closeModal(); },
    closeModalBg(d, el, e) { if (e.target === el) closeModal(); },
    confirmOk() { const fn = S.ui.confirm; closeModal(); if (fn) fn(); },
    overlayBtn() { bail(''); },
    copyCode(d, el) { window.RoomkRTDB.copyRoomCode(S.session.code, el); },
    copyMetrics(d, el) { copyText(metricsText(), el, '計測をコピーしました'); },
    removePlayer(d) { send({ t: 'REMOVE_PLAYER', pid: d.pid }); },
    setting(d) {
      const k = d.k;
      if (k === 'hostPlays') { send({ t: 'SET_HOST_PLAYS', plays: d.v === '1' }); return; }
      const patchObj = {};
      if (k === 'chips' || k === 'timerSec' || k === 'career') patchObj[k] = Number(d.v);
      else if (k === 'life') patchObj.life = d.v === '1';
      else if (k === 'endRule') patchObj.endRule = d.v;
      else if (k === 'chipsAuto') patchObj.chipsAuto = true;
      send({ t: 'SETTINGS', patch: patchObj });
    },
    start() { send({ t: 'START' }); },
    sel(d, el) {
      const key = d.key;
      const i = Number(d.i);
      S.ui.sel[key] = i;
      if (d.v !== undefined) S.ui.selV[key] = d.v;
      if (d.pid) setCursor(d.pid, key, i, d.v);
      render();
      const again = document.querySelector(`[data-fk="${CSS.escape(key + ':' + i)}"]`);
      const num = again && (again.querySelector('.cs-choice__num') || again.querySelector('.cs-job__num'));
      play(num, [{ transform: 'scale(.9)' }, { transform: 'scale(1.12)', offset: 0.5 }, { transform: 'scale(1)' }], 180);
      void el;
    },
    actFor(d) { S.ui.actFor = d.pid; render(); },
    handPid(d) { S.ui.handPid = d.pid || null; render(); },
    toggleHand() { S.ui.handCollapsed = !S.ui.handCollapsed; S.sig.hand = null; render(); },
    // 準備
    idealOk(d) {
      const pid = d.pid;
      const order = idealOrder(pid);
      const page = (S.ui.idealPage[pid] || 0) % Math.ceil(order.length / 6);
      const i = selIndex(`ideal:${pid}:${page}`);
      if (i === undefined) return;
      send({ t: 'IDEAL', pid, job: order[page * 6 + i], g: { phase: 'setup' } });
    },
    idealMore(d) { S.ui.idealPage[d.pid] = (S.ui.idealPage[d.pid] || 0) + 1; render(); },
    idealSkip(d) { send({ t: 'IDEAL', pid: d.pid, job: -1, g: { phase: 'setup' } }); },
    dealOk(d) { send({ t: 'DEAL_OK', pid: d.pid }); },
    goalOk(d) {
      const p = player(d.pid);
      const i = selIndex(`goal:${d.pid}`);
      if (i === undefined) return;
      send({ t: 'GOAL', pid: d.pid, job: p.setup.cands[i] });
    },
    begin(d) {
      if (d.force) askConfirm('締め切ってはじめる？', 'まだ選んでいる人がいます。理想を選んでいない人は「まだ決めない」、目標を選んでいない人は、あとで手札の画面から選べます。', '締め切ってはじめる', () => send({ t: 'BEGIN', force: true }));
      else send({ t: 'BEGIN' });
    },
    lateGoal(d) { openModal({ type: 'lateGoal', pid: d.pid }); },
    lateGoalOk(d) {
      const p = player(d.pid);
      const i = selIndex(`late:${d.pid}`);
      if (i === undefined) return;
      closeModal();
      send({ t: 'GOAL', pid: d.pid, job: p.setup.cands[i] });
    },
    // 手番
    roll() { send({ t: 'ROLL', g: turnGuard() }); },
    forkOk() { const t = G().turn; const b = selIndex(`t${t.id}:fork`); if (b === undefined) return; send({ t: 'FORK', b, g: turnGuard() }); },
    actOk() {
      const t = G().turn;
      const i = selIndex(`t${t.id}:act`);
      if (i === undefined) return;
      if (t.sq.eff === 'life' && i === t.sq.opts.length) send({ t: 'PASS', g: turnGuard() });
      else send({ t: 'PICK', i, g: turnGuard() });
    },
    actPass() { send({ t: 'PASS', g: turnGuard() }); },
    partnerOk() {
      const g = G(); const t = g.turn;
      const key = `t${t.id}:partner`;
      const to = S.ui.selV[key]; // 並び順ではなく、選んだ人そのもの
      if (to === undefined) return;
      if (to && !E.eligiblePartners(g, t.sq.scene).includes(to)) { toast('その人はいまさそえません。選び直してね', true); delete S.ui.selV[key]; render(); return; }
      send({ t: 'PARTNER', to, g: turnGuard() });
    },
    respond(d) { send({ t: 'RESPOND', accept: d.v === '1', g: turnGuard() }); },
    chPick(d) {
      const t = G().turn;
      const key = `t${t.id}:ch:${d.pid}`;
      const i = selIndex(key);
      if (i === undefined) return;
      delete S.ui.reselect[key];
      send({ t: 'CH_PICK', pid: d.pid, i, g: turnGuard() });
    },
    chReselect(d) { const t = G().turn; S.ui.reselect[`t${t.id}:ch:${d.pid}`] = true; render(); },
    chRoll(d) { send({ t: 'CH_ROLL', pid: d.pid, g: turnGuard() }); },
    rewardOk(d) {
      const t = G().turn;
      const i = selIndex(`t${t.id}:rw:${d.pid}`);
      if (i === undefined) return;
      send({ t: 'CH_REWARD', pid: d.pid, a: t.ch.st[d.pid].rw[i], g: turnGuard() });
    },
    chDrop(d) { askConfirm('この人の分を見送る？', `${esc(nameOf(d.pid))}さんのコラボの分を見送ります。まだサイコロを振っていなければ、時間チップは戻ります。`, '見送る', () => send({ t: 'CH_DROP', pid: d.pid, g: turnGuard() })); },
    endTurn() { send({ t: 'END_TURN', g: turnGuard() }); },
    setGoal(d) { send({ t: 'SET_GOAL', pid: d.pid, job: Number(d.job) }); },
    skip() { send({ t: 'SKIP', g: turnOnly() }); },
    extend() { send({ t: 'EXTEND', g: turnOnly() }); },
    omakase(d) { send({ t: 'OMAKASE', pid: d.pid, x: E.decisionKey(G(), d.pid) }); },
    rest(d) { closeModal(); send({ t: 'STATUS', pid: d.pid, to: 'resting' }); },
    back(d) { closeModal(); send({ t: 'STATUS', pid: d.pid, to: 'active' }); },
    leaveGame(d) { askConfirm('今回の参加を終える？', 'このあとの手番とコラボのおさそいから外れます。カードはそのままで、最後の職業選びには参加できます。', '参加を終える', () => send({ t: 'STATUS', pid: d.pid, to: 'left' }), true); },
    // 進路
    crRoute(d) {
      const c = G().career; const st = D.CAREERS[c.stage];
      const pages = Math.ceil(st.routes.length / 3);
      const page = (S.ui.routePage[d.pid] || 0) % pages;
      const i = selIndex(`cr:${c.round}:${d.pid}:route:${page}`);
      if (i === undefined) return;
      const routes = st.routes.slice(page * 3, page * 3 + 3).concat([st.common]);
      send({ t: 'CR_ROUTE', pid: d.pid, route: routes[i].id });
    },
    crMore(d) { S.ui.routePage[d.pid] = (S.ui.routePage[d.pid] || 0) + 1; render(); },
    crAct(d) {
      const c = G().career; const s = c.st[d.pid];
      const i = selIndex(`cr:${c.round}:${d.pid}:act:${s.route}`);
      if (i === undefined) return;
      send({ t: 'CR_ACT', pid: d.pid, i });
    },
    crBack(d) { send({ t: 'CR_ROUTE', pid: d.pid, route: '' }); },
    crPass(d) { send({ t: 'CR_PASS', pid: d.pid }); },
    crClose() { askConfirm('締め切って次へ進む？', 'まだ選んでいない人は、この回の進路を見送りになります（時間チップは使用済み・カードはそのまま）。', '締め切る', () => send({ t: 'CR_CLOSE' })); },
    // 終盤

    fnChoose(d) { const p = player(d.pid); const i = selIndex(`fin:${d.pid}:choose`); if (i === undefined) return; send({ t: 'FN_CHOOSE', pid: d.pid, job: p.jobs[i] }); },
    fnGoal(d) { const p = player(d.pid); send({ t: 'FN_CHOOSE', pid: d.pid, job: p.goal }); },
    fnPresent(d) { send({ t: 'FN_PRESENT', pid: d.pid }); },
    reveal(d) {
      if (d.force) askConfirm('結果を発表する？', `まだ終わっていない人がいます。${revealNoteHTML()}「結果なし」の人も、最下位にはなりません。`, '発表する', () => send({ t: 'REVEAL', force: true }));
      else send({ t: 'REVEAL' });
    },
    // ホスト
    drawer() { S.ui.drawer = !S.ui.drawer; render(); if (S.ui.drawer) { const c = document.querySelector('.cs-drawer__close'); if (c) c.focus(); } },
    proxy() { S.ui.proxyOn = !S.ui.proxyOn; S.sig = {}; render(); },
    pause() { send({ t: 'PAUSE', on: !G().paused }); },
    hostSkip() { const t = G().turn; if (!t) return; askConfirm('手番をスキップ？', `${esc(nameOf(t.pid))}さんの手番を終えて、次の人へ進みます。時間チップは二重に減りません。`, 'スキップする', () => send({ t: 'SKIP', g: { turn: t.id } })); },
    endLap() { askConfirm('次の1周で本編を終える？', 'いまの手番のあと、ほかの人が1回ずつ手番をしたら、最後の職業選びに進みます。', '次の1周で終える', () => send({ t: 'END_LAP' })); },
    endNow() { askConfirm('すぐに本編を終える？', '手番の途中でも本編を終えて、最後の職業選びに進みます。', '本編を終える', () => send({ t: 'END_NOW' }), true); },
    pStatus(d) {
      const to = d.to;
      if (to === 'left') askConfirm('参加を終える？', `${esc(nameOf(d.pid))}さんを、このあとの手番とおさそいから外します（本人の希望があるときに使ってね）。カードはそのままです。`, '参加を終える', () => send({ t: 'STATUS', pid: d.pid, to }), true);
      else send({ t: 'STATUS', pid: d.pid, to });
    },
    async closeRoom() {
      askConfirm('ルームを閉じる？', '全員のゲームが終わり、この回の記録（手札・得点・計測）は消えます。', 'ルームを閉じる', async () => {
        const s = S.session;
        S.session = null;
        clearSession();
        N.unwatch();
        try { await N.closeRoom(s.code); } catch (err) { console.error(err); }
        resetLocal();
        showScreen('top');
        toast('ルームを閉じました');
      }, true);
    },
    async exitRoom() {
      const g = G();
      const s = S.session;
      if (!s) return;
      const doExit = async () => {
        if (g && s.role === 'player' && g.players[s.id]) {
          if (g.phase === 'lobby') await send({ t: 'REMOVE_PLAYER', pid: s.id }, { quiet: true });
          else if (g.phase !== 'results' && player(s.id).status !== 'left') await send({ t: 'STATUS', pid: s.id, to: 'left' }, { quiet: true });
        }
        closeModal();
        await bail('退出しました');
      };
      if (g && g.phase !== 'lobby' && g.phase !== 'results' && s.role === 'player') {
        askConfirm('ルームから退出する？', '今回の参加を終えて、ルームから出ます。カードはそのまま残ります。', '退出する', doExit, true);
      } else doExit();
    },
  };

  async function copyText(text, btn, okMsg) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.readOnly = true; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
      ta.remove();
    }
    toast(ok ? okMsg : 'コピーできませんでした。そのまま伝えてね', !ok);
    void btn;
  }

  // ── 時間の表示と、時間切れの送信（ホスト。ホスト不在なら手番の人）─────
  function tick() {
    const g = G();
    if (!g || !S.session) return;
    const now = N.now();
    const t = g.turn;
    // ホストがつながっていないとき・つなぎ直した直後（締め切りの延長が先に届くまで）は時間切れを送らない
    const canDrive = isHost() && S.connected && Date.now() > (S.graceUntil || 0);
    if (t && g.phase === 'main') {
      const rem = E.timerRemaining(g, now);
      document.querySelectorAll('[data-timer="turn"]').forEach((el) => { el.textContent = rem == null ? '' : `選ぶ時間 あと${Math.max(0, Math.ceil(rem / 1000))}秒${g.paused ? '（一時停止中）' : ''}`; });
      if (canDrive && rem != null && rem <= 0 && !g.paused) once(`to-${t.id}-${t.stage}`, () => send({ t: 'TIMEOUT' }, { quiet: true }));
      if (t.stage === 'invite' && t.inv && t.inv.status === 'pending') {
        const left = Math.max(0, Math.ceil((t.inv.until - (g.paused && t.inv.pausedAt ? t.inv.pausedAt : now)) / 1000));
        document.querySelectorAll('[data-timer="invite"]').forEach((el) => { el.textContent = g.paused ? `一時停止中（あと${left}秒）` : `あと${left}秒`; });
        if (canDrive && !g.paused && now >= t.inv.until) once(`inv-${t.id}`, () => send({ t: 'INVITE_TIMEOUT' }, { quiet: true }));
      }
    }
    const c = g.career;
    if (c && c.until && g.phase === 'main') {
      const left = Math.max(0, Math.ceil((c.until - now) / 1000));
      document.querySelectorAll('[data-timer="career"]').forEach((el) => { el.textContent = g.paused ? '一時停止中' : `締め切りまで あと${left}秒`; });
      if (canDrive && now >= c.until && !g.paused) once(`cr-${c.round}`, () => send({ t: 'CR_CLOSE' }, { quiet: true }));
    }
    if (S.room && S.room.meta && S.room.meta.hostConnected === false && !isHost()) renderOverlay();
  }
  function once(key, fn) {
    const last = S.sent[key];
    if (last && Date.now() - last < 4000) return;
    S.sent[key] = Date.now();
    fn();
  }

  // 数字キーで①②③…を選ぶ（ホストが口頭の番号を押すときなど）
  function onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape' && S.ui.modal) { closeModal(); return; }
    if (e.key === 'Escape' && S.ui.drawer) { S.ui.drawer = false; render(); return; }
    if (!/^[1-9]$/.test(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
    const scope = S.ui.modal ? document.querySelector('.cs-modal') : $('stage');
    if (!scope) return;
    const btns = Array.from(scope.querySelectorAll('[data-act="sel"]')).filter((b) => !b.disabled);
    const idx = Number(e.key) - 1;
    const keys = [...new Set(btns.map((b) => b.dataset.key))];
    if (keys.length !== 1) return; // 選択肢のまとまりが1つのときだけ
    const target = btns.find((b) => Number(b.dataset.i) === idx);
    if (target) { e.preventDefault(); target.click(); target.focus({ preventScroll: true }); }
  }

  // ── 起動 ───────────────────────────────────────
  function boot() {
    loadPrefs();
    document.querySelectorAll('[data-game-title]').forEach((el) => { el.textContent = D.GAME_TITLE; });
    document.title = `${D.GAME_TITLE} | room-K`;
    B.hero($('hero-art'));
    B.mount($('board'), $('board-legend'), { onTile: (node) => openModal({ type: 'tile', node }), reduce: reduced });
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      if (el.dataset.lock && S.busy > 0) return; // 送信中の連打を防ぐ（エンジン側でも二重処理しない）
      const fn = ACTIONS[el.dataset.act];
      if (!fn) return;
      if (el.tagName === 'A' || el.type === 'submit') e.preventDefault();
      fn(el.dataset, el, e);
    });
    document.addEventListener('change', (e) => {
      const k = e.target && e.target.dataset && e.target.dataset.pref;
      if (!k) return;
      S.prefs[k] = !!e.target.checked;
      savePrefs();
      applyPrefs();
      S.sig = {};
      render();
    });
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'form-proxy') onProxy(e);
    });
    document.addEventListener('keydown', onKey);
    document.addEventListener('compositionstart', () => { composing = true; });
    document.addEventListener('compositionend', () => { composing = false; if (S.pendingRender) { S.pendingRender = false; render(); } });
    $('form-create').addEventListener('submit', onCreate);
    $('form-join').addEventListener('submit', onJoin);
    $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    window.addEventListener('resize', () => { if (G()) { S.sig.hand = null; renderHand(); } });
    try {
      N.init();
    } catch (err) {
      console.error(err);
      showScreen('top');
      toast('通信の準備ができませんでした（ネットワークを確かめてね）', true);
      return;
    }
    N.onConnection = (on) => {
      if (on && !S.connected) S.graceUntil = Date.now() + 4000;
      S.connected = on;
      renderOverlay();
    };
    N.onRearm = (r) => afterArm(r);
    const session = loadSession();
    if (session && session.code && session.id) reconnect(session);
    else showScreen('top');
  }

  window.CS_UI = { state: S, render, send };
  boot();
}());
