// ==UserScript==
// @name         Systextil - Parâmetros da Régua de Cobrança
// @namespace    https://texcotton.com.br/tampermonkey
// @version      0.2.0
// @description  Calcula e preenche, mediante ação explícita, parâmetros de datas da régua no Systextil.
// @match        http://systextil.texcotton.com.br/systextil/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Um único painel no documento principal; os campos podem estar em iframes same-origin.
  if (window.top !== window || window.__systextilParametrosReguaCarregado) return;
  window.__systextilParametrosReguaCarregado = true;

  const CONFIG = {
    ID_PAINEL: 'st-regua-parametros-panel',
    BUSCA_REVERSA_DIAS: 45,
    // Feriados locais ainda não confirmados ficam desativados.
    FERIADOS_ADICIONAIS: []
  };

  const PARAMETROS = [
    { key: 'inicio2', label: 'Início 2 Dias', target: 'inicio 2 dias' },
    { key: 'fim2', label: 'Fim 2 Dias', target: 'fim 2 dias' },
    { key: 'inicio6', label: 'Início 6 Dias', target: 'inicio 6 dias' },
    { key: 'fim6', label: 'Fim 6 Dias', target: 'fim 6 dias' },
    { key: 'inicio10', label: 'Início 10 Dias', target: 'inicio 10 dias' },
    { key: 'fim10', label: 'Fim 10 Dias', target: 'fim 10 dias' },
    { key: 'inicio15', label: 'Início 15 Dias', target: 'inicio 15 dias' },
    { key: 'fim15', label: 'Fim 15 Dias', target: 'fim 15 dias' },
    { key: 'inicio18', label: 'Início 18 Dias', target: 'inicio 18 dias' },
    { key: 'fim18', label: 'Fim 18 Dias', target: 'fim 18 dias' }
  ];

  function localNoon(date) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  function iso(date) {
    const d = localNoon(date);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function parseIso(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return d.getFullYear() === Number(match[1]) &&
      d.getMonth() === Number(match[2]) - 1 &&
      d.getDate() === Number(match[3]) ? d : null;
  }

  function br(date) {
    if (!date) return '—';
    const d = localNoon(date);
    return String(d.getDate()).padStart(2, '0') + '/' +
      String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }

  function addDays(date, amount) {
    const d = localNoon(date);
    d.setDate(d.getDate() + amount);
    return localNoon(d);
  }

  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day, 12);
  }

  function holidaysForYear(year) {
    const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'];
    const dates = fixed.map(function (md) { return year + '-' + md; });
    if (year >= 2024) dates.push(year + '-11-20');
    const easter = easterSunday(year);
    dates.push(iso(addDays(easter, -48))); // Carnaval, segunda
    dates.push(iso(addDays(easter, -47))); // Carnaval, terça
    dates.push(iso(addDays(easter, -2)));  // Sexta-feira Santa
    dates.push(iso(addDays(easter, 60)));  // Corpus Christi
    CONFIG.FERIADOS_ADICIONAIS.forEach(function (day) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) dates.push(day);
    });
    return new Set(dates);
  }

  const holidayCache = new Map();
  function isHoliday(date) {
    const year = date.getFullYear();
    if (!holidayCache.has(year)) holidayCache.set(year, holidaysForYear(year));
    return holidayCache.get(year).has(iso(date));
  }

  function isBusinessDay(date) {
    return date.getDay() !== 0 && date.getDay() !== 6 && !isHoliday(date);
  }

  function nextMonday(date) {
    let d = localNoon(date);
    do {
      d = addDays(d, 1);
    } while (d.getDay() !== 1 || isHoliday(d));
    return d;
  }

  function calculateSixthDayDeadline(dueDate) {
    // Vencimento é dia zero; o prazo-base é vencimento + 6 dias corridos.
    let deadline = addDays(dueDate, 6);
    if (deadline.getDay() === 6) deadline = addDays(deadline, 2);
    else if (deadline.getDay() === 0) deadline = addDays(deadline, 1);
    // Regra da planilha: se o prazo for feriado, o prazo passa para segunda.
    if (isHoliday(deadline)) deadline = nextMonday(deadline);
    // Se essa segunda também for feriado, procurar a próxima segunda não feriada.
    if (isHoliday(deadline)) deadline = nextMonday(deadline);
    return localNoon(deadline);
  }

  function reverseSearchSixthDay(referenceDate) {
    const wanted = iso(referenceDate);
    const matches = [];
    for (let offset = 1; offset <= CONFIG.BUSCA_REVERSA_DIAS; offset += 1) {
      const dueDate = addDays(referenceDate, -offset);
      if (iso(calculateSixthDayDeadline(dueDate)) === wanted) matches.push(dueDate);
    }
    if (!matches.length) return { start: null, end: null, count: 0, dates: [], contiguous: false };
    matches.sort(function (a, b) { return a.getTime() - b.getTime(); });
    const contiguous = matches.every(function (match, index) {
      return index === 0 || iso(match) === iso(addDays(matches[index - 1], 1));
    });
    return {
      start: matches[0],
      end: matches[matches.length - 1],
      count: matches.length,
      dates: matches,
      contiguous: contiguous
    };
  }

  function twoDayWindow(referenceDate) {
    // Mapeamento operacional semanal do ERP; quarta-feira reúne três datas.
    const weekday = referenceDate.getDay();
    if (weekday === 1 || weekday === 2) {
      const due = addDays(referenceDate, -4);
      return { start: due, end: due, note: weekday === 1
        ? 'Segunda: vencimentos de quinta-feira.'
        : 'Terça: vencimentos de sexta-feira.' };
    }
    if (weekday === 3) {
      return {
        start: addDays(referenceDate, -4),
        end: addDays(referenceDate, -2),
        note: 'Quarta: inclui sábado, domingo e segunda-feira.'
      };
    }
    if (weekday === 4) {
      const due = addDays(referenceDate, -2);
      return { start: due, end: due, note: 'Quinta: vencimentos de terça-feira.' };
    }
    if (weekday === 5) {
      const due = addDays(referenceDate, -2);
      return { start: due, end: due, note: 'Sexta: vencimentos de quarta-feira.' };
    }
    return {
      start: null,
      end: null,
      note: 'A regra operacional está definida para segunda a sexta-feira; hoje é fim de semana.'
    };
  }

  function calculate(referenceDate) {
    const two = twoDayWindow(referenceDate);
    const six = reverseSearchSixthDay(referenceDate);
    const ten = addDays(referenceDate, -10);
    const fifteen = addDays(referenceDate, -15);
    const eighteen = addDays(referenceDate, -18);
    return {
      values: {
        inicio2: two.start, fim2: two.end,
        inicio6: six.contiguous ? six.start : null, fim6: six.contiguous ? six.end : null,
        inicio10: ten, fim10: ten,
        inicio15: fifteen, fim15: fifteen,
        inicio18: eighteen, fim18: eighteen
      },
      twoNote: two.note,
      sixCount: six.count,
      sixDates: six.dates,
      sixContiguous: six.contiguous
    };
  }

  function normalize(text) {
    return String(text == null ? '' : text)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function compact(text) {
    return normalize(text).replace(/\s+/g, '');
  }

  function documentsInFrames() {
    const documents = [];
    const seen = new Set();
    const queue = [window];
    while (queue.length) {
      const current = queue.shift();
      let doc;
      try { doc = current.document; } catch (_) { continue; }
      if (!doc || seen.has(doc)) continue;
      seen.add(doc);
      documents.push(doc);
      Array.from(doc.querySelectorAll('iframe, frame')).forEach(function (frame) {
        try {
          if (frame.contentWindow) queue.push(frame.contentWindow);
        } catch (_) {
          // Frames de outra origem não podem ser inspecionados pelo browser.
        }
      });
    }
    return documents;
  }

  function isVisible(el) {
    if (!el || !el.isConnected || el.disabled) return false;
    if (el.closest('#' + CONFIG.ID_PAINEL)) return false;
    if (el.type === 'hidden' ||
        ['submit', 'button', 'reset', 'checkbox', 'radio', 'file'].includes(String(el.type).toLowerCase())) return false;
    const view = el.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  function ancestorText(el) {
    const parts = [];
    let node = el;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      const text = node.innerText || node.textContent || '';
      if (text && text.length <= 260) parts.push(text);
      if (node.tagName === 'TR' || node.tagName === 'LI') break;
    }
    return parts.join(' ');
  }

  function searchText(el) {
    const doc = el.ownerDocument || document;
    const attrs = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean);
    if (el.labels) attrs.push.apply(attrs, Array.from(el.labels).map(function (label) {
      return label.innerText || label.textContent || '';
    }));
    if (el.id) {
      attrs.push.apply(attrs, Array.from(doc.querySelectorAll('label[for]'))
        .filter(function (label) { return label.htmlFor === el.id; })
        .map(function (label) { return label.innerText || label.textContent || ''; }));
    }
    attrs.push(ancestorText(el));
    return compact(attrs.join(' '));
  }

  function findControl(parameter) {
    const controls = documentsInFrames().reduce(function (all, doc) {
      return all.concat(Array.from(doc.querySelectorAll('input, textarea, [contenteditable="true"]')));
    }, []).filter(isVisible);
    const target = compact(parameter.target);
    const scored = controls.map(function (el) {
      const text = searchText(el);
      const direct = compact([el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
        el.getAttribute('title'), el.labels ? Array.from(el.labels).map(function (x) {
          return x.innerText || x.textContent || '';
        }).join(' ') : ''].join(' '));
      let score = 0;
      if (direct.includes(target)) score += 100;
      if (text.includes(target)) score += 20;
      if (score && text.includes('inicio') && parameter.key.indexOf('fim') === 0) score -= 35;
      if (score && text.includes('fim') && parameter.key.indexOf('inicio') === 0) score -= 35;
      return { element: el, score: score };
    }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; });
    if (!scored.length) return { element: null, reason: 'não encontrado' };
    const topScore = scored[0].score;
    const ties = scored.filter(function (x) { return x.score === topScore; });
    if (ties.length !== 1) return { element: null, reason: 'mais de um campo compatível' };
    return { element: ties[0].element, reason: 'ok' };
  }

  function setControlValue(el, date) {
    if (!date) return false;
    const view = el.ownerDocument.defaultView || window;
    const value = String(el.type).toLowerCase() === 'date' ? iso(date) : br(date);
    if (el.isContentEditable) el.textContent = value;
    else {
      const proto = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) descriptor.set.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new view.Event('input', { bubbles: true }));
    el.dispatchEvent(new view.Event('change', { bubbles: true }));
    return true;
  }

  let dateInput, tableBody, detailsEl, summaryEl, statusEl, lastCalculation, lastReferenceDate;
  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#b42318' : '#475467';
  }

  function buildSummary(result) {
    return PARAMETROS.map(function (p) {
      return p.label + ': ' + br(result.values[p.key]);
    }).join('\n') + '\nReferência: ' + br(lastReferenceDate) +
      '\nRegra 2 dias: ' + result.twoNote +
      '\nDatas encontradas na busca reversa do 6º dia: ' + result.sixCount +
      '\nJanela do 6º dia contígua: ' + (result.sixCount === 0 ? 'sem correspondências' : (result.sixContiguous ? 'sim' : 'não; conferir a tabela auxiliar J:L'));
  }

  function renderCalculation() {
    const reference = parseIso(dateInput.value);
    if (!reference) { setStatus('Informe uma data de referência válida.', true); return; }
    lastReferenceDate = reference;
    lastCalculation = calculate(reference);
    tableBody.replaceChildren();
    PARAMETROS.forEach(function (param) {
      const row = document.createElement('tr');
      const label = document.createElement('td');
      const value = document.createElement('td');
      label.textContent = param.label;
      value.textContent = br(lastCalculation.values[param.key]);
      value.style.fontVariantNumeric = 'tabular-nums';
      if (!lastCalculation.values[param.key]) value.style.color = '#b42318';
      row.append(label, value);
      tableBody.appendChild(row);
    });
    detailsEl.textContent = lastCalculation.twoNote + ' ' +
      (!lastCalculation.sixCount
        ? 'A busca reversa não encontrou vencimentos associados ao prazo final ' + br(reference) +
          '. Confira se a data é compatível com o calendário e os feriados.'
        : !lastCalculation.sixContiguous
          ? 'A busca reversa encontrou ' + lastCalculation.sixCount +
            ' datas de vencimento em intervalos separados. Início/Fim do 6º dia ficaram em branco para evitar incluir datas sem o mesmo prazo; confira a tabela auxiliar J:L.'
          : 'Busca reversa do 6º dia: ' + lastCalculation.sixCount +
            ' data(s) de vencimento associada(s) ao prazo final ' + br(reference) + '.');
    summaryEl.value = buildSummary(lastCalculation);
    setStatus('Cálculo atualizado. Confira as datas antes de preencher ou executar a consulta.', false);
  }

  function fillRecognizedFields() {
    if (!lastCalculation) renderCalculation();
    if (!lastCalculation) return;
    let filled = 0;
    const skipped = [];
    PARAMETROS.forEach(function (param) {
      const value = lastCalculation.values[param.key];
      if (!value) { skipped.push(param.label + ': sem data calculada'); return; }
      const found = findControl(param);
      if (!found.element) { skipped.push(param.label + ': ' + found.reason); return; }
      if (setControlValue(found.element, value)) filled += 1;
    });
    const message = 'Preenchidos ' + filled + ' de ' + PARAMETROS.length + ' campos.' +
      (skipped.length ? ' Não preenchidos: ' + skipped.join('; ') + '.' : '');
    setStatus(message, skipped.length > 0);
    console.info('[Systextil Régua] Resultado do preenchimento:', {
      preenchidos: filled, total: PARAMETROS.length, naoPreenchidos: skipped
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus('Resumo copiado.', false);
      }).catch(function () { legacyCopy(text); });
    } else legacyCopy(text);
  }

  function legacyCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    Object.assign(area.style, { position: 'fixed', opacity: '0', left: '-9999px', top: '0' });
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
    area.remove();
    setStatus(copied ? 'Resumo copiado.' : 'Não foi possível copiar automaticamente; selecione o resumo.', !copied);
  }

  function createPanel() {
    if (document.getElementById(CONFIG.ID_PAINEL) || !document.body) return;
    const panel = document.createElement('section');
    panel.id = CONFIG.ID_PAINEL;
    Object.assign(panel.style, {
      position: 'fixed', right: '14px', top: '110px', width: '390px',
      maxWidth: 'calc(100vw - 28px)', maxHeight: 'calc(100vh - 130px)', overflow: 'auto',
      zIndex: '2147483647', background: '#fff', color: '#101828',
      border: '1px solid #cbd5e1', borderRadius: '10px',
      boxShadow: '0 8px 30px rgba(16,24,40,.22)', font: '13px/1.4 Arial, sans-serif'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      background: '#16232f', color: '#fff', padding: '10px 12px', display: 'flex',
      alignItems: 'center', justifyContent: 'space-between', gap: '8px', borderRadius: '9px 9px 0 0'
    });
    const title = document.createElement('strong');
    title.textContent = 'Parâmetros da Régua de Cobrança';
    const minimize = document.createElement('button');
    minimize.type = 'button'; minimize.textContent = '—'; minimize.title = 'Minimizar painel';
    Object.assign(minimize.style, {
      border: '0', borderRadius: '5px', cursor: 'pointer',
      background: '#344054', color: '#fff', width: '27px', height: '25px'
    });
    header.append(title, minimize);

    const body = document.createElement('div');
    body.style.padding = '12px';
    const dateLabel = document.createElement('label');
    dateLabel.textContent = 'Data de referência: ';
    dateLabel.style.display = 'block';
    dateLabel.style.fontWeight = '600';
    dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = iso(new Date());
    Object.assign(dateInput.style, {
      display: 'block', width: '100%', boxSizing: 'border-box', margin: '5px 0 10px',
      padding: '7px', border: '1px solid #98a2b3', borderRadius: '5px', background: '#fff', color: '#101828'
    });
    dateLabel.appendChild(dateInput);

    const table = document.createElement('table');
    Object.assign(table.style, { borderCollapse: 'collapse', width: '100%', marginBottom: '8px' });
    const head = document.createElement('thead');
    const row = document.createElement('tr');
    ['Parâmetro', 'Valor calculado'].forEach(function (text) {
      const th = document.createElement('th');
      th.textContent = text;
      Object.assign(th.style, {
        textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid #cbd5e1', background: '#f2f4f7'
      });
      row.appendChild(th);
    });
    head.appendChild(row);
    tableBody = document.createElement('tbody');
    table.append(head, tableBody);

    detailsEl = document.createElement('p');
    Object.assign(detailsEl.style, { margin: '8px 0', color: '#475467', fontSize: '12px' });
    summaryEl = document.createElement('textarea');
    summaryEl.readOnly = true;
    summaryEl.rows = 3;
    Object.assign(summaryEl.style, {
      width: '100%', boxSizing: 'border-box', padding: '6px',
      border: '1px solid #d0d5dd', borderRadius: '5px',
      font: '11px/1.35 monospace', marginBottom: '8px'
    });

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' });
    const fill = document.createElement('button');
    fill.type = 'button'; fill.textContent = 'Preencher campos encontrados';
    const copy = document.createElement('button');
    copy.type = 'button'; copy.textContent = 'Copiar resumo';
    [fill, copy].forEach(function (button, index) {
      Object.assign(button.style, {
        padding: '8px 6px', border: '0', borderRadius: '5px', cursor: 'pointer',
        background: index === 0 ? '#175cd3' : '#eaecf0',
        color: index === 0 ? '#fff' : '#344054', fontWeight: '600'
      });
    });
    actions.append(fill, copy);

    statusEl = document.createElement('div');
    Object.assign(statusEl.style, { fontSize: '12px', marginTop: '8px', color: '#475467', overflowWrap: 'anywhere' });
    const warning = document.createElement('p');
    warning.textContent = 'O painel não executa a consulta. Confira os campos antes de confirmar no Systextil. Feriados locais precisam ser configurados no script.';
    Object.assign(warning.style, {
      margin: '10px 0 0', paddingTop: '8px', borderTop: '1px solid #eaecf0',
      color: '#667085', fontSize: '11px'
    });

    body.append(dateLabel, table, detailsEl, summaryEl, actions, statusEl, warning);
    panel.append(header, body);
    document.body.appendChild(panel);

    let minimized = false;
    minimize.addEventListener('click', function () {
      minimized = !minimized;
      body.style.display = minimized ? 'none' : 'block';
      minimize.textContent = minimized ? '+' : '—';
      minimize.title = minimized ? 'Expandir painel' : 'Minimizar painel';
    });
    dateInput.addEventListener('change', renderCalculation);
    fill.addEventListener('click', fillRecognizedFields);
    copy.addEventListener('click', function () { copyText(summaryEl.value); });
    renderCalculation();
  }

  // API somente de leitura para diagnóstico e testes; não toca no formulário.
  window.__systextilParametrosReguaDebug = Object.freeze({
    calculate: calculate,
    twoDayWindow: twoDayWindow,
    calculateSixthDayDeadline: calculateSixthDayDeadline,
    reverseSearchSixthDay: reverseSearchSixthDay,
    isBusinessDay: isBusinessDay,
    holidaysForYear: function (year) { return Array.from(holidaysForYear(year)).sort(); },
    iso: iso,
    br: br
  });

  function initialize() {
    if (!document.body) { setTimeout(initialize, 200); return; }
    createPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else initialize();
})();
