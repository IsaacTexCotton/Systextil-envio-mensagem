// ==UserScript==
// @name         Systextil - Parâmetros da Régua de Cobrança
// @namespace    https://texcotton.com.br/tampermonkey
// @version      0.5.0
// @description  Calcula e preenche, mediante ação explícita, parâmetros de datas da régua no Systextil.
// @match        http://systextil.texcotton.com.br/systextil/*
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-parametros-regua.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-parametros-regua.user.js
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

  // Regras operacionais extraídas dos exemplos de feriados.
  // Δ = data de referência - data do feriado; offsets de início/fim são dias corridos relativos ao feriado.
  const HOLIDAY_RULES = [
    { type: 'two', holidayWeekday: 1, referenceOffset: 3, startOffset: -2, endOffset: 1, label: '2º dia: feriado na segunda; execução na quinta' },
    { type: 'two', holidayWeekday: 2, referenceOffset: 2, startOffset: -3, endOffset: -1, label: '2º dia: feriado na terça; execução na quinta' },
    { type: 'two', holidayWeekday: 2, referenceOffset: 3, startOffset: 0, endOffset: 1, label: '2º dia: feriado na terça; execução na sexta' },
    { type: 'two', holidayWeekday: 3, referenceOffset: 1, startOffset: -4, endOffset: -2, label: '2º dia: feriado na quarta; execução na quinta' },
    { type: 'two', holidayWeekday: 3, referenceOffset: 2, startOffset: -1, endOffset: 0, label: '2º dia: feriado na quarta; execução na sexta' },
    { type: 'two', holidayWeekday: 4, referenceOffset: -1, startOffset: -5, endOffset: -3, label: '2º dia: feriado na quinta; execução na quarta anterior' },
    { type: 'two', holidayWeekday: 4, referenceOffset: 4, startOffset: -1, endOffset: 0, label: '2º dia: feriado na quinta; execução na segunda seguinte' },
    { type: 'two', holidayWeekday: 5, referenceOffset: -2, startOffset: -6, endOffset: -4, label: '2º dia: feriado na sexta; execução na quarta anterior' },
    { type: 'two', holidayWeekday: 5, referenceOffset: 3, startOffset: -2, endOffset: -2, label: '2º dia: feriado na sexta; execução na segunda seguinte' },
    { type: 'two', holidayWeekday: 5, referenceOffset: 4, startOffset: -1, endOffset: 0, label: '2º dia: feriado na sexta; execução na terça seguinte' },

    { type: 'six', holidayWeekday: 1, referenceOffset: 1, startOffset: -8, endOffset: -5, label: '6º dia: feriado na segunda; execução na terça' },
    { type: 'six', holidayWeekday: 2, referenceOffset: -1, startOffset: -9, endOffset: -7, label: '6º dia: feriado na terça; execução na segunda anterior' },
    { type: 'six', holidayWeekday: 3, referenceOffset: -2, startOffset: -10, endOffset: -8, label: '6º dia: feriado na quarta; execução na segunda anterior' },
    { type: 'six', holidayWeekday: 3, referenceOffset: 1, startOffset: -6, endOffset: -5, label: '6º dia: feriado na quarta; execução na quinta' },
    { type: 'six', holidayWeekday: 4, referenceOffset: -3, startOffset: -11, endOffset: -9, label: '6º dia: feriado na quinta; execução na segunda anterior' },
    { type: 'six', holidayWeekday: 4, referenceOffset: 1, startOffset: -6, endOffset: -5, label: '6º dia: feriado na quinta; execução na sexta' },
    { type: 'six', holidayWeekday: 5, referenceOffset: -4, startOffset: -12, endOffset: -10, label: '6º dia: feriado na sexta; execução na segunda anterior' },
    { type: 'six', holidayWeekday: 5, referenceOffset: 3, startOffset: -6, endOffset: -3, label: '6º dia: feriado na sexta; execução na segunda seguinte' }
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

  function calendarDayDifference(referenceDate, holidayDate) {
    const referenceUtc = Date.UTC(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    const holidayUtc = Date.UTC(holidayDate.getFullYear(), holidayDate.getMonth(), holidayDate.getDate());
    return Math.round((referenceUtc - holidayUtc) / 86400000);
  }

  function holidayDatesNear(referenceDate) {
    const found = new Set();
    // Busca em anos adjacentes para não falhar em referências próximas à virada do ano.
    for (let year = referenceDate.getFullYear() - 1; year <= referenceDate.getFullYear() + 1; year += 1) {
      holidaysForYear(year).forEach(function (holiday) {
        const parsed = parseIso(holiday);
        if (parsed && Math.abs(calendarDayDifference(referenceDate, parsed)) <= 4) found.add(iso(parsed));
      });
    }
    return Array.from(found).sort();
  }

  function resolveHolidayWindow(type, referenceDate, explicitHolidayDates) {
    const holidayValues = explicitHolidayDates === undefined
      ? holidayDatesNear(referenceDate)
      : (Array.isArray(explicitHolidayDates) ? explicitHolidayDates : []);
    const matches = [];

    holidayValues.forEach(function (value) {
      let holidayDate = null;
      if (typeof value === 'string') holidayDate = parseIso(value);
      else if (value && typeof value.getFullYear === 'function') holidayDate = localNoon(value);
      if (!holidayDate) return;

      const referenceOffset = calendarDayDifference(referenceDate, holidayDate);
      if (Math.abs(referenceOffset) > 4) return;
      HOLIDAY_RULES.forEach(function (rule) {
        if (rule.type !== type ||
            rule.holidayWeekday !== holidayDate.getDay() ||
            rule.referenceOffset !== referenceOffset) return;
        matches.push({
          holidayDate: localNoon(holidayDate),
          referenceOffset: referenceOffset,
          ruleLabel: rule.label,
          start: addDays(holidayDate, rule.startOffset),
          end: addDays(holidayDate, rule.endOffset)
        });
      });
    });

    if (!matches.length) return { status: 'none', start: null, end: null, matches: [], ranges: [] };

    matches.sort(function (a, b) {
      return a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime();
    });

    // Regras referentes a feriados consecutivos podem se sobrepor. Unimos apenas
    // janelas que se sobrepõem ou são adjacentes; blocos separados são ambíguos.
    const ranges = [];
    matches.forEach(function (match) {
      const last = ranges[ranges.length - 1];
      if (!last || iso(match.start) > iso(addDays(last.end, 1))) {
        ranges.push({ start: match.start, end: match.end, matches: [match] });
      } else {
        if (match.end.getTime() > last.end.getTime()) last.end = match.end;
        last.matches.push(match);
      }
    });

    if (ranges.length > 1) {
      return { status: 'conflict', start: null, end: null, matches: matches, ranges: ranges };
    }
    return {
      status: 'matched',
      start: ranges[0].start,
      end: ranges[0].end,
      matches: matches,
      ranges: ranges
    };
  }

  function datesBetweenInclusive(start, end) {
    if (!start || !end || iso(start) > iso(end)) return [];
    const dates = [];
    for (let date = localNoon(start); iso(date) <= iso(end); date = addDays(date, 1)) dates.push(localNoon(date));
    return dates;
  }

  function describeHolidayResolution(resolution) {
    return resolution.matches.map(function (match) {
      return match.ruleLabel + ' (feriado em ' + br(match.holidayDate) + ')';
    }).join('; ');
  }

  function calculate(referenceDate) {
    const twoResolution = resolveHolidayWindow('two', referenceDate);
    const sixResolution = resolveHolidayWindow('six', referenceDate);

    let two;
    if (twoResolution.status === 'matched') {
      two = {
        start: twoResolution.start,
        end: twoResolution.end,
        note: 'Exceção de feriado aplicada ao 2º dia: ' + describeHolidayResolution(twoResolution) + '.'
      };
    } else if (twoResolution.status === 'conflict') {
      two = {
        start: null,
        end: null,
        note: 'Conflito entre regras de feriado para o 2º dia; preenchimento bloqueado.'
      };
    } else {
      two = twoDayWindow(referenceDate);
    }

    let six;
    if (sixResolution.status === 'matched') {
      const dates = datesBetweenInclusive(sixResolution.start, sixResolution.end);
      six = {
        start: sixResolution.start,
        end: sixResolution.end,
        count: dates.length,
        dates: dates,
        contiguous: true
      };
    } else if (sixResolution.status === 'conflict') {
      six = { start: null, end: null, count: 0, dates: [], contiguous: false };
    } else {
      six = reverseSearchSixthDay(referenceDate);
    }

    const conflicts = [];
    if (twoResolution.status === 'conflict') {
      conflicts.push('2º dia: mais de uma janela de feriado descontínua (' +
        twoResolution.ranges.map(function (range) { return br(range.start) + ' a ' + br(range.end); }).join(' e ') + ')');
    }
    if (sixResolution.status === 'conflict') {
      conflicts.push('6º dia: mais de uma janela de feriado descontínua (' +
        sixResolution.ranges.map(function (range) { return br(range.start) + ' a ' + br(range.end); }).join(' e ') + ')');
    }

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
      sixContiguous: six.contiguous,
      sixSource: sixResolution.status === 'matched' ? 'holiday-rule' : 'reverse-search',
      twoHolidayStatus: twoResolution.status,
      sixHolidayStatus: sixResolution.status,
      holidayConflicts: conflicts,
      blocked: conflicts.length > 0,
      twoHolidayMatches: twoResolution.matches,
      sixHolidayMatches: sixResolution.matches
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

  function parameterRows(doc) {
    return Array.from(doc.querySelectorAll('[eventproxy="parameterTab_body"] tr[role="listitem"], #parameterTab_body tr[role="listitem"]'));
  }

  function parameterFromLabel(text) {
    const label = compact(text);
    return PARAMETROS.find(function (param) {
      return label === compact(param.label) || label === compact(param.label + ':');
    }) || null;
  }

  function parameterFromRow(row) {
    const labelCell = row && row.cells && row.cells[0];
    if (!labelCell) return null;
    return parameterFromLabel(labelCell.innerText || labelCell.textContent || '');
  }

  function findSmartClientGrid(doc) {
    const view = doc.defaultView;
    if (!view) return null;
    const candidates = [];
    try { candidates.push(view.parameterTab); } catch (_) {}
    try {
      if (view.isc && view.isc.Canvas && typeof view.isc.Canvas.getById === 'function') {
        candidates.push(view.isc.Canvas.getById('parameterTab'));
      }
    } catch (_) {}
    return candidates.find(function (grid) {
      return grid &&
        typeof grid.getTotalRows === 'function' &&
        typeof grid.getRecord === 'function' &&
        typeof grid.getFields === 'function' &&
        typeof grid.startEditing === 'function' &&
        typeof grid.setEditValue === 'function' &&
        typeof grid.endEditing === 'function';
    }) || null;
  }

  function smartClientFieldIndexes(grid) {
    const fields = grid.getFields() || [];
    const indexes = { label: -1, value: -1 };
    fields.forEach(function (field, index) {
      const name = normalize([field.name, field.title, field.prompt].filter(Boolean).join(' '));
      if (indexes.label < 0 && /^(parametro|parameter)$/.test(name)) indexes.label = index;
      if (indexes.value < 0 && /^(valor|value)$/.test(name)) indexes.value = index;
    });
    // Fallback baseado na estrutura fornecida: coluna 0 = Parâmetro, coluna 1 = Valor.
    if (indexes.label < 0 && fields.length >= 2) indexes.label = 0;
    if (indexes.value < 0 && fields.length >= 2) indexes.value = 1;
    return indexes;
  }

  function smartClientCell(grid, record, rowIndex, fieldIndex) {
    if (fieldIndex < 0) return undefined;
    try {
      if (typeof grid.getCellValue === 'function') {
        const value = grid.getCellValue(record, rowIndex, fieldIndex);
        if (value !== undefined && value !== null) return value;
      }
    } catch (_) {}
    const fields = grid.getFields() || [];
    const field = fields[fieldIndex];
    if (field && field.name && record && record[field.name] !== undefined) return record[field.name];
    return undefined;
  }

  function gridValueMatches(doc, grid, param, expected, indexes) {
    const total = Number(grid.getTotalRows()) || 0;
    for (let rowIndex = 0; rowIndex < total; rowIndex += 1) {
      const record = grid.getRecord(rowIndex);
      if (!record) continue;
      const label = smartClientCell(grid, record, rowIndex, indexes.label);
      const mapped = parameterFromLabel(label);
      if (mapped && mapped.key === param.key) {
        const value = smartClientCell(grid, record, rowIndex, indexes.value);
        if (value !== undefined && String(value).trim() === expected) return true;
        break;
      }
    }

    // O DOM é uma verificação secundária; a fonte principal é o registro da grade.
    const row = parameterRows(doc).find(function (candidate) {
      return parameterFromRow(candidate) && parameterFromRow(candidate).key === param.key;
    });
    return !!(row && row.cells[1] &&
      String(row.cells[1].innerText || row.cells[1].textContent || '').trim() === expected);
  }

  async function fillSmartClientGrid(result) {
    for (const doc of documentsInFrames()) {
      const rows = parameterRows(doc);
      if (!rows.length) continue;
      const grid = findSmartClientGrid(doc);
      if (!grid) {
        // Se a grade já foi reconhecida, não cair na busca genérica de inputs:
        // ela poderia atingir apenas a célula atualmente selecionada.
        return {
          handled: true,
          filled: 0,
          cleared: 0,
          skipped: PARAMETROS.map(function (param) {
            return param.label + ': grade encontrada, API SmartClient indisponível';
          })
        };
      }

      const indexes = smartClientFieldIndexes(grid);
      if (indexes.label < 0 || indexes.value < 0) {
        return {
          handled: true,
          filled: 0,
          cleared: 0,
          skipped: PARAMETROS.map(function (param) {
            return param.label + ': colunas Parâmetro/Valor não identificadas em getFields()';
          })
        };
      }

      const rowIndexes = new Map();
      const totalRows = Number(grid.getTotalRows()) || 0;
      for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
        const record = grid.getRecord(rowIndex);
        if (!record) continue;
        const label = smartClientCell(grid, record, rowIndex, indexes.label);
        const param = parameterFromLabel(label);
        if (param) rowIndexes.set(param.key, rowIndex);
      }
      // Fallback para a posição publicada no DOM se a API não devolver rótulos.
      if (!rowIndexes.size) {
        rows.forEach(function (row, rowNumber) {
          const param = parameterFromRow(row);
          if (!param) return;
          const announcedPosition = Number(row.getAttribute('aria-posinset'));
          rowIndexes.set(param.key, Number.isInteger(announcedPosition) && announcedPosition > 0
            ? announcedPosition - 1
            : rowNumber);
        });
      }

      let filled = 0;
      let cleared = 0;
      const skipped = [];
      for (const param of PARAMETROS) {
        const date = result.values[param.key];
        const expected = date ? br(date) : '';
        const rowIndex = rowIndexes.get(param.key);
        if (!Number.isInteger(rowIndex)) {
          skipped.push(param.label + ': linha não encontrada na grade');
          continue;
        }
        try {
          // Edita via API do SmartClient; o índice da coluna Valor vem de getFields().
          // Se a regra não produzir data, limpa-se um eventual valor antigo.
          grid.startEditing(rowIndex, indexes.value);
          grid.setEditValue(rowIndex, indexes.value, expected);
          // Não finalizar cada célula: deixar a grade consolidar a edição evita
          // descartar mudanças anteriores enquanto percorremos os parâmetros.
          if (date) filled += 1;
          else cleared += 1;
        } catch (error) {
          skipped.push(param.label + ': falha de edição da grade');
          console.warn('[Systextil Régua] Falha ao editar parâmetro da grade:', param.key, error);
        }
      }
      try {
        if (typeof grid.saveAllEdits === 'function') grid.saveAllEdits();
        else grid.endEditing();
      } catch (error) {
        skipped.push('A grade não conseguiu concluir as edições');
        console.warn('[Systextil Régua] Falha ao concluir as edições:', error);
      }
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
      let verified = 0;
      let clearedVerified = 0;
      for (const param of PARAMETROS) {
        const date = result.values[param.key];
        const expected = date ? br(date) : '';
        if (gridValueMatches(doc, grid, param, expected, indexes)) {
          if (date) verified += 1;
          else clearedVerified += 1;
        } else {
          skipped.push(param.label + ': o ERP não confirmou o valor na grade');
        }
      }
      filled = verified;
      cleared = clearedVerified;
      return {
        handled: true,
        filled: filled,
        cleared: cleared,
        skipped: skipped
      };
    }
    return { handled: false, filled: 0, skipped: [] };
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
      '\nOrigem da regra 6º dia: ' + (result.sixSource === 'holiday-rule' ? 'exceção de feriado' : 'busca reversa padrão') +
      '\nDatas de vencimento do 6º dia: ' + (result.sixDates.length ? result.sixDates.map(br).join(', ') : 'nenhuma') +
      '\nJanela do 6º dia contígua: ' + (result.sixCount === 0 ? 'sem correspondências' : (result.sixContiguous ? 'sim' : 'não; conferir a tabela auxiliar J:L')) +
      '\nConflitos de feriado: ' + (result.holidayConflicts.length ? result.holidayConflicts.join(' | ') : 'nenhum') +
      '\nPreenchimento permitido: ' + (result.blocked ? 'não' : 'sim');
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
    if (lastCalculation.blocked) {
      detailsEl.textContent = 'PREENCHIMENTO BLOQUEADO: ' + lastCalculation.holidayConflicts.join(' | ') +
        '. Nenhum campo será alterado enquanto houver janelas de feriado descontínuas. ' + lastCalculation.twoNote;
    } else {
      detailsEl.textContent = lastCalculation.twoNote + ' ' +
        (lastCalculation.sixSource === 'holiday-rule'
          ? 'Exceção de feriado aplicada ao 6º dia: ' + describeHolidayResolution({
              matches: lastCalculation.sixHolidayMatches
            }) + '. Janela: ' + br(lastCalculation.values.inicio6) + ' a ' + br(lastCalculation.values.fim6) + '.'
          : !lastCalculation.sixCount
            ? 'A busca reversa não encontrou vencimentos associados ao prazo final ' + br(reference) +
              '. Confira se a data é compatível com o calendário e os feriados.'
            : !lastCalculation.sixContiguous
              ? 'A busca reversa encontrou ' + lastCalculation.sixCount +
                ' datas de vencimento em intervalos separados. Início/Fim do 6º dia ficaram em branco para evitar incluir datas sem o mesmo prazo; confira a tabela auxiliar J:L.'
              : 'Busca reversa do 6º dia: ' + lastCalculation.sixCount +
                ' data(s) de vencimento associada(s) ao prazo final ' + br(reference) + '.');
    }
    summaryEl.value = buildSummary(lastCalculation);
    setStatus(lastCalculation.blocked
      ? 'Preenchimento bloqueado por conflito entre regras de feriado. Confira o resumo.'
      : 'Cálculo atualizado. Confira as datas antes de preencher ou executar a consulta.',
      lastCalculation.blocked);
  }

  async function fillRecognizedFields() {
    if (!lastCalculation) renderCalculation();
    if (!lastCalculation) return;
    if (lastCalculation.blocked) {
      setStatus('Preenchimento cancelado: ' + lastCalculation.holidayConflicts.join(' | '), true);
      console.warn('[Systextil Régua] Preenchimento bloqueado por conflito de regras de feriado:', lastCalculation.holidayConflicts);
      return;
    }

    // O relatório usa uma ListGrid SmartClient: nove valores podem ser texto
    // estático no DOM, embora sejam editáveis via a API da grade.
    const smartClientResult = await fillSmartClientGrid(lastCalculation);
    let filled = 0;
    let cleared = 0;
    let skipped = [];
    if (smartClientResult.handled) {
      filled = smartClientResult.filled;
      cleared = smartClientResult.cleared || 0;
      skipped = smartClientResult.skipped;
    } else {
      PARAMETROS.forEach(function (param) {
        const value = lastCalculation.values[param.key];
        if (!value) { skipped.push(param.label + ': sem data calculada'); return; }
        const found = findControl(param);
        if (!found.element) { skipped.push(param.label + ': ' + found.reason); return; }
        if (setControlValue(found.element, value)) filled += 1;
      });
    }
    const message = 'Preenchidos e verificados: ' + filled + '; campos limpos por ausência de data: ' + cleared +
      '; total: ' + PARAMETROS.length + '.' +
      (skipped.length ? ' Não confirmados: ' + skipped.join('; ') + '.' : '');
    setStatus(message, skipped.length > 0 || filled + cleared !== PARAMETROS.length);
    console.info('[Systextil Régua] Resultado do preenchimento:', {
      preenchidosEVerificados: filled, camposLimpos: cleared,
      total: PARAMETROS.length, naoConfirmados: skipped
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
    resolveHolidayWindow: resolveHolidayWindow,
    holidayRules: HOLIDAY_RULES,
    isBusinessDay: isBusinessDay,
    holidaysForYear: function (year) { return Array.from(holidaysForYear(year)).sort(); },
    iso: iso,
    br: br,
    parameterKeyFromLabel: function (label) {
      const param = parameterFromLabel(label);
      return param ? param.key : null;
    }
  });

  function initialize() {
    if (!document.body) { setTimeout(initialize, 200); return; }
    createPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else initialize();
})();
