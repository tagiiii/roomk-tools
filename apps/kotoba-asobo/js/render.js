(function () {
  'use strict';

  const NUMBERS = ['①', '②', '③', '④'];
  const PART_ICONS = {
    intro: 'door_open',
    warmup: 'local_fire_department',
    main: 'psychology',
    dialogue: 'forum',
    closing: 'flag',
  };
  const PART_ACCENTS = {
    intro: 'teal',
    warmup: 'coral',
    main: 'blue',
    dialogue: 'teal',
    closing: 'coral',
  };

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function rubyText(value) {
    const raw = String(value ?? '');
    let html = '';
    let cursor = 0;
    const pattern = /\{([^{}|]+)\|([^{}|]+)\}/g;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      html += esc(raw.slice(cursor, match.index));
      html += '<ruby>' + esc(match[1]) + '<rt>' + esc(match[2]) + '</rt></ruby>';
      cursor = match.index + match[0].length;
    }
    html += esc(raw.slice(cursor));
    return html;
  }

  function stripRuby(value) {
    return String(value ?? '').replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$1');
  }

  function plain(value) {
    return stripRuby(value).replace(/\s+/g, ' ').trim();
  }

  function choicesHtml(slide, step) {
    const question = slide.question || {};
    const choices = Array.isArray(question.choices) ? question.choices : [];
    if (!choices.length) return '';
    return '<div class="ka-choices">' + choices.map((choice, index) => {
      const isCorrect = step >= 1 && question.type === 'choice' && index === question.answerIndex;
      const cls = 'ka-choice' + (isCorrect ? ' ka-choice--correct' : '');
      return '<div class="' + cls + '">' +
        '<span class="ka-choice__num">' + NUMBERS[index] + '</span>' +
        '<span class="ka-choice__text">' + rubyText(choice) + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function listHtml(items) {
    if (!Array.isArray(items) || !items.length) return '';
    return '<div class="ka-list">' + items.map((item) => (
      '<div class="ka-list__item">' + rubyText(item) + '</div>'
    )).join('') + '</div>';
  }

  function answerText(question) {
    if (!question) return '';
    if (question.type === 'choice' && Array.isArray(question.choices)) {
      return question.choices[question.answerIndex] || '';
    }
    return question.answer || '';
  }

  function revealHtml(question, step) {
    if (!question || step < 1 || question.type === 'open') return '';
    const answer = answerText(question);
    const steps = Array.isArray(question.steps) ? question.steps : [];
    const stepBody = question.type === 'reveal' && steps.length
      ? listHtml(steps)
      : '';
    return '<div class="ka-reveal">' +
      '<div class="ka-reveal__label">答え</div>' +
      '<div class="ka-reveal__text">' + rubyText(answer) + '</div>' +
      stepBody +
    '</div>';
  }

  function explanationHtml(question, step) {
    if (!question || step < 2 || !question.explanation) return '';
    return '<div class="ka-explanation">' + rubyText(question.explanation) + '</div>';
  }

  function renderQuestionSlide(slide, step) {
    const q = slide.question;
    const title = q.type === 'open' ? 'みんなで考える問い' : slide.title;
    // タイトルにそのまま問題文が入るスライドでは、本文側に問題文を繰り返さない。
    let body = title === q.question ? '' : '<div class="ka-question">' + rubyText(q.question) + '</div>';
    if (q.type === 'choice' || q.type === 'pair') {
      body += choicesHtml(slide, step);
    } else if (q.type === 'order') {
      body += listHtml(q.choices);
    } else if (q.type === 'open') {
      body += '<div class="ka-open-prompt">正解をひとつに決めず、思いついたことを出し合います。</div>';
    } else if (q.type === 'reveal' && step === 0) {
      body += '<div class="ka-open-prompt">まずは予想してから、答えを表示します。</div>';
    }
    body += revealHtml(q, step);
    body += explanationHtml(q, step);

    // 答え表示後は問題文・選択肢をコンパクトにして、答え・解説の場所を確保する。
    const revealCls = step >= 1 && q.type !== 'open' ? ' ka-slide--reveal' : '';
    return '<section class="ka-slide ka-slide--' + esc(slide.accent) + revealCls + '">' +
      '<div class="ka-slide__part"><span class="material-symbols-rounded">' + esc(slide.icon) + '</span>' + rubyText(slide.partLabel) + '</div>' +
      '<h1 class="ka-slide__title">' + rubyText(title) + '</h1>' +
      '<div class="ka-slide__body">' + body + '</div>' +
    '</section>';
  }

  function renderProjectionSlide(slide, step) {
    if (slide.kind === 'title') {
      return '<section class="ka-slide ka-slide--title ka-slide--teal">' +
        '<div class="ka-slide__icon"><span class="material-symbols-rounded">text_fields</span></div>' +
        '<h1 class="ka-slide__title">' + rubyText(slide.title) + '</h1>' +
        '<div class="ka-slide__subtitle">' + rubyText(slide.subtitle) + '</div>' +
      '</section>';
    }
    if (slide.kind === 'divider') {
      return '<section class="ka-slide ka-slide--divider ka-slide--' + esc(slide.accent) + '">' +
        '<div class="ka-slide__icon"><span class="material-symbols-rounded">' + esc(slide.icon) + '</span></div>' +
        '<h1 class="ka-slide__title">' + rubyText(slide.title) + '</h1>' +
        '<div class="ka-slide__subtitle">目安 ' + esc(slide.estimatedMinutes) + '分</div>' +
      '</section>';
    }
    return renderQuestionSlide(slide, step);
  }

  function buildChatCopy(question) {
    if (!question) return '';
    if (question.chatCopy) return String(question.chatCopy);
    const lines = [plain(question.question)];
    const choices = Array.isArray(question.choices) ? question.choices : [];
    choices.forEach((choice, index) => {
      lines.push(NUMBERS[index] + plain(choice));
    });
    return lines.join('\n');
  }

  function maxStep(slide) {
    if (!slide || slide.kind !== 'question') return 0;
    const q = slide.question;
    if (q.type === 'open') return 0;
    return q.explanation ? 2 : 1;
  }

  function answerForPresenter(question) {
    const answer = answerText(question);
    return answer ? plain(answer) : '';
  }

  function slideSummary(slide) {
    if (!slide) return '';
    if (slide.kind === 'title') return plain(slide.title);
    if (slide.kind === 'divider') return plain(slide.title);
    const type = slide.question?.type ? ' / ' + slide.question.type : '';
    return plain(slide.title || slide.question?.question || '') + type;
  }

  function presenterFacts(slide, session) {
    const rows = [];
    if (!slide) return rows;
    rows.push(['スライド種別', slide.kind]);
    rows.push(['パート', slide.partLabel || '全体']);
    if (slide.kind === 'divider') {
      rows.push(['目安時間', String(slide.estimatedMinutes || '') + '分']);
      return rows;
    }
    if (slide.kind !== 'question') {
      rows.push(['ゴール', session.goal || '']);
      rows.push(['対話目標', session.communicationGoal || '']);
      return rows;
    }
    const q = slide.question;
    rows.push(['type', q.type]);
    rows.push(['正解', answerForPresenter(q)]);
    rows.push(['解説', q.explanation || '']);
    rows.push(['基本向け説明', q.basicExplanation || '']);
    rows.push(['発展向け説明', q.advancedExplanation || '']);
    rows.push(['追加質問', q.followUpQuestion || '']);
    rows.push(['フォロー例', q.facilitationPrompt || '']);
    rows.push(['目安時間', String(q.estimatedMinutes || '') + '分']);
    rows.push(['出典', q.source || '']);
    rows.push(['確認日', q.sourceCheckedAt || '']);
    return rows;
  }

  function buildSlides(session) {
    const byId = new Map((session.questions || []).map((question) => [question.id, question]));
    const slides = [{
      kind: 'title',
      title: session.title,
      subtitle: session.goal || '',
      partLabel: '全体',
      accent: 'teal',
    }];
    (session.blocks || []).forEach((block) => {
      const accent = PART_ACCENTS[block.part] || 'teal';
      const icon = PART_ICONS[block.part] || 'notes';
      slides.push({
        kind: 'divider',
        id: block.part,
        title: block.label,
        part: block.part,
        partLabel: block.label,
        estimatedMinutes: block.estimatedMinutes,
        accent,
        icon,
      });
      (block.items || []).forEach((id) => {
        const question = byId.get(id);
        if (!question) return;
        slides.push({
          kind: 'question',
          id,
          title: question.question,
          part: block.part,
          partLabel: block.label,
          accent,
          icon,
          question,
        });
      });
    });
    return slides;
  }

  window.KotobaAsoboRender = {
    NUMBERS,
    esc,
    rubyText,
    stripRuby,
    plain,
    renderProjectionSlide,
    buildChatCopy,
    maxStep,
    slideSummary,
    presenterFacts,
    buildSlides,
  };
}());
