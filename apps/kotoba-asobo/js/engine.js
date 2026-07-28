(function () {
  'use strict';

  const CH_NAME = 'kotoba_asobo_deck';
  const STORAGE_KEY = 'ka_msg';
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session');
  const isPresenter = params.get('view') === 'presenter';
  const registry = window.KotobaAsobo;
  const R = window.KotobaAsoboRender;
  const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CH_NAME) : null;
  const UNIT_LABELS = {
    u1: 'ユニット1',
    u2: 'ユニット2',
    u3: 'ユニット3',
    u4: 'ユニット4',
    u5: 'ユニット5',
    u6: 'ユニット6',
    demo: '動作確認用',
  };

  let session = null;
  let slides = [];
  let idx = 0;
  let step = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function showError(message) {
    $('ka-session-list').hidden = true;
    $('ka-deck').hidden = true;
    $('ka-presenter').hidden = true;
    const error = $('ka-error');
    error.hidden = false;
    error.textContent = message;
  }

  function send(message) {
    const payload = Object.assign({ s: sessionId }, message);
    if (channel) channel.postMessage(payload);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({}, payload, { _t: Date.now() })));
    } catch (error) {
      // localStorage is only a fallback transport.
    }
  }

  function onMsg(handler) {
    if (channel) {
      channel.onmessage = (event) => handler(event.data);
    }
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        handler(JSON.parse(event.newValue));
      } catch (error) {
        // Ignore malformed cross-window messages.
      }
    });
  }

  function clampIndex(value) {
    return Math.max(0, Math.min(slides.length - 1, Number(value) || 0));
  }

  function clampStep(value, slide) {
    return Math.max(0, Math.min(R.maxStep(slide), Number(value) || 0));
  }

  function normalizePosition(nextIndex, nextStep) {
    const safeIndex = clampIndex(nextIndex);
    return {
      index: safeIndex,
      step: clampStep(nextStep, slides[safeIndex]),
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find((script) => script.dataset.kaSessionSrc === src);
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.dataset.kaSessionSrc = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('セッションデータを読み込めません: ' + src));
      document.head.appendChild(script);
    });
  }

  async function loadSession(id) {
    const meta = registry.getManifest().find((item) => item.id === id);
    if (!meta) throw new Error('セッションが見つかりません: ' + id);
    if (!registry.getSession(id)) await loadScript(meta.src);
    const loaded = registry.getSession(id);
    if (!loaded) throw new Error('セッション登録が見つかりません: ' + id);
    return loaded;
  }

  function renderSessionList() {
    document.title = 'コトバであそぼ';
    $('ka-session-list').hidden = false;
    const grid = $('ka-session-grid');
    grid.innerHTML = '';

    function renderCard(item) {
      const href = '?session=' + encodeURIComponent(item.id);
      const card = document.createElement('a');
      card.className = 'ka-session-card';
      card.href = href;
      card.innerHTML =
        '<div class="ka-session-card__unit">' + R.esc(item.unitId) + ' / ' + R.esc(item.number) + '</div>' +
        '<div class="ka-session-card__title">' + R.rubyText(item.title) + '</div>' +
        '<div class="ka-session-card__meta">' +
          '<span><span class="material-symbols-rounded">schedule</span>45分</span>' +
          '<span><span class="material-symbols-rounded">co_present</span>スライド</span>' +
        '</div>';
      return card;
    }

    function renderGroup(unitId, items) {
      const group = document.createElement('section');
      group.className = 'ka-session-group';
      group.innerHTML =
        '<h2 class="ka-session-group__title">' + R.esc(UNIT_LABELS[unitId] || unitId) + '</h2>' +
        '<div class="ka-session-group__grid"></div>';
      const groupGrid = group.querySelector('.ka-session-group__grid');
      items.forEach((item) => groupGrid.appendChild(renderCard(item)));
      grid.appendChild(group);
    }

    const production = registry.getManifest().filter((item) => !item.isDemo);
    const demos = registry.getManifest().filter((item) => item.isDemo);
    const byUnit = new Map();

    production.forEach((item) => {
      if (!byUnit.has(item.unitId)) byUnit.set(item.unitId, []);
      byUnit.get(item.unitId).push(item);
    });
    Array.from(byUnit.keys()).sort().forEach((unitId) => renderGroup(unitId, byUnit.get(unitId)));

    if (demos.length > 0) {
      renderGroup('demo', demos);
    }
  }

  // 1280x720 に収まらないスライドだけ、段階的にコンパクト表示へ切り替える。
  const FIT_CLASSES = ['ka-slide--fit-1', 'ka-slide--fit-2', 'ka-slide--fit-3', 'ka-slide--fit-4'];

  function fitSlide(container) {
    const slide = container.querySelector('.ka-slide');
    const body = slide ? slide.querySelector('.ka-slide__body') : null;
    if (!body) return;
    FIT_CLASSES.forEach((cls) => slide.classList.remove(cls));
    for (let level = 0; level < FIT_CLASSES.length; level += 1) {
      if (body.scrollHeight <= body.clientHeight + 1) break;
      if (level > 0) slide.classList.remove(FIT_CLASSES[level - 1]);
      slide.classList.add(FIT_CLASSES[level]);
    }
  }

  function renderDeck() {
    const slide = slides[idx];
    $('ka-slide-root').innerHTML = R.renderProjectionSlide(slide, step);
    fitSlide($('ka-slide-root'));
    $('ka-footer-count').textContent = (idx + 1) + ' / ' + slides.length;
    $('ka-footer-part').textContent = slide.partLabel || '全体';
    $('ka-nav-prev').style.visibility = idx === 0 && step === 0 ? 'hidden' : 'visible';
    $('ka-nav-next').style.visibility = idx === slides.length - 1 && step === R.maxStep(slide) ? 'hidden' : 'visible';
  }

  function setPosition(nextIndex, nextStep, broadcast) {
    const pos = normalizePosition(nextIndex, nextStep);
    idx = pos.index;
    step = pos.step;
    if (isPresenter) renderPresenter();
    else renderDeck();
    if (broadcast) send({ t: isPresenter ? 'goto' : 'idx', i: idx, step });
  }

  function next() {
    const max = R.maxStep(slides[idx]);
    if (step < max) setPosition(idx, step + 1, true);
    else setPosition(idx + 1, 0, true);
  }

  function prev() {
    if (step > 0) setPosition(idx, step - 1, true);
    else {
      const previous = clampIndex(idx - 1);
      setPosition(previous, R.maxStep(slides[previous]), true);
    }
  }

  function reveal() {
    const max = R.maxStep(slides[idx]);
    if (step < max) setPosition(idx, step + 1, true);
  }

  function fit() {
    const stage = $('ka-stage');
    if (!stage) return;
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    stage.style.transform = 'translate(-50%,-50%) scale(' + scale + ')';
  }

  function toggleFull() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  function openPresenter() {
    const url = new URL(location.href);
    url.searchParams.set('view', 'presenter');
    url.hash = '';
    const opened = window.open(url.toString(), 'ka_presenter_' + sessionId, 'width=760,height=860');
    if (!opened) window.alert('発表者ビューのウィンドウがブロックされました。ポップアップを許可してから、もう一度お試しください。');
  }

  function bindDeck() {
    $('ka-nav-next').addEventListener('click', next);
    $('ka-nav-prev').addEventListener('click', prev);
    $('ka-btn-answer').addEventListener('click', reveal);
    $('ka-btn-presenter').addEventListener('click', openPresenter);
    $('ka-btn-full').addEventListener('click', toggleFull);
    window.addEventListener('resize', fit);
    document.addEventListener('fullscreenchange', fit);
    document.addEventListener('keydown', onKey);
    onMsg((message) => {
      if (!message || message.s !== sessionId) return;
      if (message.t === 'goto') setPosition(message.i, message.step || 0, false);
      if (message.t === 'hello') send({ t: 'idx', i: idx, step });
    });
  }

  function onKey(event) {
    if (isPresenter && event.target === $('ka-pv-note')) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      prev();
    } else if (event.key === 'Home') {
      event.preventDefault();
      setPosition(0, 0, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      setPosition(slides.length - 1, R.maxStep(slides[slides.length - 1]), true);
    } else if (event.key === 'f' || event.key === 'F') {
      toggleFull();
    } else if (event.key === 'p' || event.key === 'P') {
      openPresenter();
    } else if (event.key === 'a' || event.key === 'A') {
      reveal();
    }
  }

  function noteKey(index) {
    return 'ka_note_' + sessionId + '_' + slides[index].id + '_' + index;
  }

  function currentDefaultNote() {
    const slide = slides[idx];
    if (slide.kind !== 'question') return R.slideSummary(slide);
    return R.buildChatCopy(slide.question);
  }

  function renderPresenter() {
    const slide = slides[idx];
    $('ka-pv-count').textContent = (idx + 1) + ' / ' + slides.length + ' / step ' + step;
    $('ka-pv-title').textContent = R.slideSummary(slide);
    $('ka-pv-lead').textContent = (slide.partLabel || '全体') + ' / ' + session.title;
    $('ka-pv-preview').innerHTML = R.renderProjectionSlide(slide, step);
    fitSlide($('ka-pv-preview'));
    const facts = R.presenterFacts(slide, session);
    $('ka-pv-facts').innerHTML = facts.map(([term, value]) => (
      '<dt>' + R.esc(term) + '</dt><dd>' + R.rubyText(value || '') + '</dd>'
    )).join('');
    const saved = localStorage.getItem(noteKey(idx));
    $('ka-pv-note').value = saved !== null ? saved : currentDefaultNote();
    $('ka-pv-prev').disabled = idx === 0 && step === 0;
    $('ka-pv-next').disabled = idx === slides.length - 1 && step === R.maxStep(slide);
    $('ka-pv-reveal').disabled = step >= R.maxStep(slide);
    $('ka-pv-next-title').innerHTML = idx < slides.length - 1
      ? '次のスライド: <b>' + R.esc(R.slideSummary(slides[idx + 1])) + '</b>'
      : '<b>最後のスライドです</b>';
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        return ok;
      } catch (fallbackError) {
        return false;
      }
    }
  }

  function bindPresenter() {
    document.body.classList.add('presenter');
    $('ka-deck').hidden = true;
    $('ka-presenter').hidden = false;
    $('ka-pv-prev').addEventListener('click', prev);
    $('ka-pv-next').addEventListener('click', next);
    $('ka-pv-reveal').addEventListener('click', reveal);
    $('ka-pv-note').addEventListener('input', () => {
      try {
        localStorage.setItem(noteKey(idx), $('ka-pv-note').value);
      } catch (error) {
        // Notes are a convenience only.
      }
    });
    $('ka-pv-reset').addEventListener('click', () => {
      localStorage.removeItem(noteKey(idx));
      $('ka-pv-note').value = currentDefaultNote();
    });
    $('ka-pv-copy').addEventListener('click', async () => {
      const button = $('ka-pv-copy');
      const ok = await copyText($('ka-pv-note').value);
      if (!ok) {
        $('ka-pv-note').focus();
        $('ka-pv-note').select();
      }
      button.classList.toggle('done', ok);
      button.innerHTML = ok
        ? '<span class="material-symbols-rounded">check</span>コピーしました'
        : '<span class="material-symbols-rounded">keyboard_command_key</span>選択しました';
      setTimeout(() => {
        button.classList.remove('done');
        button.innerHTML = '<span class="material-symbols-rounded">content_copy</span>コピー';
      }, 2200);
    });
    document.addEventListener('keydown', onKey);
    onMsg((message) => {
      if (!message || message.s !== sessionId) return;
      if (message.t === 'idx') {
        $('ka-pv-conn').textContent = '投影画面と接続中';
        setPosition(message.i, message.step || 0, false);
      }
    });
    send({ t: 'hello' });
    setTimeout(() => send({ t: 'hello' }), 400);
  }

  async function start() {
    if (!registry || !R) {
      showError('必要なスクリプトを読み込めませんでした。');
      return;
    }
    if (!sessionId) {
      renderSessionList();
      return;
    }
    try {
      session = await loadSession(sessionId);
      // 発表者ビューと投影ビューの二重計上を避けるため、投影側のみ数える
      if (!isPresenter) window.RoomkStats?.count('session-' + sessionId);
      slides = R.buildSlides(session);
      document.title = (isPresenter ? '発表者ビュー - ' : '') + session.title + ' - コトバであそぼ';
      if (isPresenter) {
        bindPresenter();
        renderPresenter();
      } else {
        $('ka-deck').hidden = false;
        bindDeck();
        fit();
        renderDeck();
        send({ t: 'idx', i: idx, step });
      }
      // Web フォント読み込みで行数が変わるため、確定後にフィット判定をやり直す。
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          if (isPresenter) renderPresenter();
          else renderDeck();
        });
      }
    } catch (error) {
      showError(error.message);
    }
  }

  start();
}());
