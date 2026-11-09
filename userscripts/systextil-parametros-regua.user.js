// ==UserScript==
// @name         Systextil - Parâmetros da Régua de Cobrança
// @namespace    https://texcotton.com.br/tampermonkey
// @version      0.9.0
// @description  Calcula e preenche, mediante ação explícita, parâmetros de datas da régua no Systextil.
// @match        http://systextil.texcotton.com.br/systextil/*
// @match        https://systextil.texcotton.com.br/systextil/*
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-parametros-regua.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-parametros-regua.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '0.9.0';
  const SCRIPT_BUILD_ID = '2026-11-09-ui-review';

  // Um único painel no documento principal; os campos podem estar em iframes same-origin.
  if (window.top !== window || window.__systextilParametrosReguaCarregado) return;
  window.__systextilParametrosReguaCarregado = true;

  const CONFIG = {
    ID_PAINEL: 'st-regua-parametros-panel',
    BUSCA_REVERSA_DIAS: 45,
    // Feriados locais ainda não confirmados ficam desativados.
    FERIADOS_ADICIONAIS: [],
    STORAGE_MINIMIZADO: 'st-regua-minimizado',
    STORAGE_DEBUG: 'st-regua-debug',
    ESPERA_GRADE_MS: 150
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

  // Parâmetros cujo valor depende da matriz de feriados (2º e 6º dia).
  const DEPENDEM_DE_FERIADO = ['inicio2', 'fim2', 'inicio6', 'fim6'];

  // Matriz operacional validada a partir das tabelas fornecidas pelo usuário.
  // referenceOffset = data de execução - data do feriado; start/end são offsets
  // de dias corridos em relação ao próprio feriado. "SEM EXPED." bloqueia a execução.
  const HOLIDAY_RULES = [
    // Feriado na SEGUNDA
    { type: 'two', holidayWeekday: 1, referenceOffset: 0, noExpediente: true, cobrar: 'SEM EXPED.', label: '2º dia: feriado na segunda; sem expediente' },
    { type: 'two', holidayWeekday: 1, referenceOffset: 1, startOffset: -4, endOffset: -4, cobrar: 'QUINTA', label: '2º dia: segunda feriado; terça cobra quinta' },
    { type: 'two', holidayWeekday: 1, referenceOffset: 2, startOffset: -3, endOffset: -3, cobrar: 'SEXTA', label: '2º dia: segunda feriado; quarta cobra sexta' },
    { type: 'two', holidayWeekday: 1, referenceOffset: 3, startOffset: -2, endOffset: 1, cobrar: 'SÁB A TER', label: '2º dia: segunda feriado; quinta cobra sábado a terça' },
    { type: 'two', holidayWeekday: 1, referenceOffset: 4, startOffset: 2, endOffset: 2, cobrar: 'QUARTA', label: '2º dia: segunda feriado; sexta cobra quarta' },
    { type: 'six', holidayWeekday: 1, referenceOffset: 0, noExpediente: true, cobrar: 'SEM EXPED.', label: '6º dia: feriado na segunda; sem expediente' },
    { type: 'six', holidayWeekday: 1, referenceOffset: 1, startOffset: -8, endOffset: -5, cobrar: 'DOM A QUA', label: '6º dia: segunda feriado; terça cobra domingo a quarta' },
    { type: 'six', holidayWeekday: 1, referenceOffset: 2, startOffset: -4, endOffset: -4, cobrar: 'QUINTA', label: '6º dia: segunda feriado; quarta cobra quinta' },
    { type: 'six', holidayWeekday: 1, referenceOffset: 3, startOffset: -3, endOffset: -3, cobrar: 'SEXTA', label: '6º dia: segunda feriado; quinta cobra sexta' },
    { type: 'six', holidayWeekday: 1, referenceOffset: 4, startOffset: -2, endOffset: -2, cobrar: 'SÁBADO', label: '6º dia: segunda feriado; sexta cobra sábado' },

    // Feriado na TERÇA
    { type: 'two', holidayWeekday: 2, referenceOffset: -1, startOffset: -5, endOffset: -5, cobrar: 'QUINTA', label: '2º dia: terça feriado; segunda cobra quinta' },
    { type: 'two', holidayWeekday: 2, referenceOffset: 0, noExpediente: true, cobrar: 'SEM EXPED.', label: '2º dia: feriado na terça; sem expediente' },
    { type: 'two', holidayWeekday: 2, referenceOffset: 1, startOffset: -4, endOffset: -4, cobrar: 'SEXTA', label: '2º dia: terça feriado; quarta cobra sexta' },
    { type: 'two', holidayWeekday: 2, referenceOffset: 2, startOffset: -3, endOffset: -1, cobrar: 'SÁB A SEG', label: '2º dia: terça feriado; quinta cobra sábado a segunda' },
    { type: 'two', holidayWeekday: 2, referenceOffset: 3, startOffset: 0, endOffset: 1, cobrar: 'TER E QUA', label: '2º dia: terça feriado; sexta cobra terça e quarta' },
    { type: 'six', holidayWeekday: 2, referenceOffset: -1, startOffset: -9, endOffset: -7, cobrar: 'DOM A TER', label: '6º dia: terça feriado; segunda cobra domingo a terça' },
    { type: 'six', holidayWeekday: 2, referenceOffset: 0, noExpediente: true, cobrar: 'SEM EXPED.', label: '6º dia: feriado na terça; sem expediente' },
    { type: 'six', holidayWeekday: 2, referenceOffset: 1, startOffset: -6, endOffset: -5, cobrar: 'QUA E QUI', label: '6º dia: terça feriado; quarta cobra quarta e quinta' },
    { type: 'six', holidayWeekday: 2, referenceOffset: 2, startOffset: -4, endOffset: -4, cobrar: 'SEXTA', label: '6º dia: terça feriado; quinta cobra sexta' },
    { type: 'six', holidayWeekday: 2, referenceOffset: 3, startOffset: -3, endOffset: -3, cobrar: 'SÁBADO', label: '6º dia: terça feriado; sexta cobra sábado' },

    // Feriado na QUARTA
    { type: 'two', holidayWeekday: 3, referenceOffset: -2, startOffset: -6, endOffset: -6, cobrar: 'QUINTA', label: '2º dia: quarta feriado; segunda cobra quinta' },
    { type: 'two', holidayWeekday: 3, referenceOffset: -1, startOffset: -5, endOffset: -5, cobrar: 'SEXTA', label: '2º dia: quarta feriado; terça cobra sexta' },
    { type: 'two', holidayWeekday: 3, referenceOffset: 0, noExpediente: true, cobrar: 'SEM EXPED.', label: '2º dia: feriado na quarta; sem expediente' },
    { type: 'two', holidayWeekday: 3, referenceOffset: 1, startOffset: -4, endOffset: -2, cobrar: 'SÁB A SEG', label: '2º dia: quarta feriado; quinta cobra sábado a segunda' },
    { type: 'two', holidayWeekday: 3, referenceOffset: 2, startOffset: -1, endOffset: 0, cobrar: 'TER E QUA', label: '2º dia: quarta feriado; sexta cobra terça e quarta' },
    { type: 'six', holidayWeekday: 3, referenceOffset: -2, startOffset: -10, endOffset: -8, cobrar: 'DOM A TER', label: '6º dia: quarta feriado; segunda cobra domingo a terça' },
    { type: 'six', holidayWeekday: 3, referenceOffset: -1, startOffset: -7, endOffset: -7, cobrar: 'QUARTA', label: '6º dia: quarta feriado; terça cobra quarta' },
    { type: 'six', holidayWeekday: 3, referenceOffset: 0, noExpediente: true, cobrar: 'SEM EXPED.', label: '6º dia: feriado na quarta; sem expediente' },
    { type: 'six', holidayWeekday: 3, referenceOffset: 1, startOffset: -6, endOffset: -5, cobrar: 'QUI E SEX', label: '6º dia: quarta feriado; quinta cobra quinta e sexta' },
    { type: 'six', holidayWeekday: 3, referenceOffset: 2, startOffset: -4, endOffset: -4, cobrar: 'SÁBADO', label: '6º dia: quarta feriado; sexta cobra sábado' },

    // Feriado na QUINTA
    { type: 'two', holidayWeekday: 4, referenceOffset: -3, startOffset: -7, endOffset: -7, cobrar: 'QUINTA', label: '2º dia: quinta feriado; segunda cobra quinta' },
    { type: 'two', holidayWeekday: 4, referenceOffset: -2, startOffset: -6, endOffset: -6, cobrar: 'SEXTA', label: '2º dia: quinta feriado; terça cobra sexta' },
    { type: 'two', holidayWeekday: 4, referenceOffset: -1, startOffset: -5, endOffset: -3, cobrar: 'SÁB A SEG', label: '2º dia: quinta feriado; quarta cobra sábado a segunda' },
    { type: 'two', holidayWeekday: 4, referenceOffset: 0, noExpediente: true, cobrar: 'SEM EXPED.', label: '2º dia: feriado na quinta; sem expediente' },
    { type: 'two', holidayWeekday: 4, referenceOffset: 1, startOffset: -2, endOffset: -2, cobrar: 'TERÇA', label: '2º dia: quinta feriado; sexta cobra terça' },
    { type: 'two', holidayWeekday: 4, referenceOffset: 4, startOffset: -1, endOffset: 0, cobrar: 'QUA E QUI', label: '2º dia: quinta feriado; segunda seguinte cobra quarta e quinta' },
    { type: 'two', holidayWeekday: 4, referenceOffset: 5, startOffset: 0, endOffset: 1, cobrar: 'QUI E SEX', label: '2º dia: quinta feriado; terça seguinte cobra quinta e sexta' },
    { type: 'six', holidayWeekday: 4, referenceOffset: -3, startOffset: -11, endOffset: -9, cobrar: 'DOM A TER', label: '6º dia: quinta feriado; segunda cobra domingo a terça' },
    { type: 'six', holidayWeekday: 4, referenceOffset: -2, startOffset: -8, endOffset: -8, cobrar: 'QUARTA', label: '6º dia: quinta feriado; terça cobra quarta' },
    { type: 'six', holidayWeekday: 4, referenceOffset: -1, startOffset: -7, endOffset: -7, cobrar: 'QUINTA', label: '6º dia: quinta feriado; quarta cobra quinta' },
    { type: 'six', holidayWeekday: 4, referenceOffset: 0, noExpediente: true, cobrar: 'SEM EXPED.', label: '6º dia: feriado na quinta; sem expediente' },
    { type: 'six', holidayWeekday: 4, referenceOffset: 1, startOffset: -6, endOffset: -5, cobrar: 'SEX E SÁB', label: '6º dia: quinta feriado; sexta cobra sexta e sábado' },

    // Feriado na SEXTA
    { type: 'two', holidayWeekday: 5, referenceOffset: -4, startOffset: -8, endOffset: -8, cobrar: 'QUINTA', label: '2º dia: sexta feriado; segunda cobra quinta' },
    { type: 'two', holidayWeekday: 5, referenceOffset: -3, startOffset: -7, endOffset: -7, cobrar: 'SEXTA', label: '2º dia: sexta feriado; terça cobra sexta' },
    { type: 'two', holidayWeekday: 5, referenceOffset: -2, startOffset: -6, endOffset: -4, cobrar: 'SÁB A SEG', label: '2º dia: sexta feriado; quarta cobra sábado a segunda' },
    { type: 'two', holidayWeekday: 5, referenceOffset: -1, startOffset: -3, endOffset: -3, cobrar: 'TERÇA', label: '2º dia: sexta feriado; quinta cobra terça' },
    { type: 'two', holidayWeekday: 5, referenceOffset: 0, noExpediente: true, cobrar: 'SEM EXPED.', label: '2º dia: feriado na sexta; sem expediente' },
    { type: 'two', holidayWeekday: 5, referenceOffset: 3, startOffset: -2, endOffset: -2, cobrar: 'QUARTA', label: '2º dia: sexta feriado; segunda seguinte cobra quarta' },
    { type: 'two', holidayWeekday: 5, referenceOffset: 4, startOffset: -1, endOffset: 0, cobrar: 'QUI E SEX', label: '2º dia: sexta feriado; terça seguinte cobra quinta e sexta' },
    { type: 'six', holidayWeekday: 5, referenceOffset: -4, startOffset: -12, endOffset: -10, cobrar: 'DOM A TER', label: '6º dia: sexta feriado; segunda cobra domingo a terça' },
    { type: 'six', holidayWeekday: 5, referenceOffset: -3, startOffset: -9, endOffset: -9, cobrar: 'QUARTA', label: '6º dia: sexta feriado; terça cobra quarta' },
    { type: 'six', holidayWeekday: 5, referenceOffset: -2, startOffset: -8, endOffset: -8, cobrar: 'QUINTA', label: '6º dia: sexta feriado; quarta cobra quinta' },
    { type: 'six', holidayWeekday: 5, referenceOffset: -1, startOffset: -7, endOffset: -7, cobrar: 'SEXTA', label: '6º dia: sexta feriado; quinta cobra sexta' },
    { type: 'six', holidayWeekday: 5, referenceOffset: 0, noExpediente: true, cobrar: 'SEM EXPED.', label: '6º dia: feriado na sexta; sem expediente' },
    { type: 'six', holidayWeekday: 5, referenceOffset: 3, startOffset: -6, endOffset: -3, cobrar: 'SÁB A TER', label: '6º dia: sexta feriado; segunda seguinte cobra sábado a terça' }
  ];

  /* ==========================================================================
   * 1. CÁLCULO (lógica de negócio — preservada da versão 0.8.1)
   * ========================================================================== */

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
        if (parsed && Math.abs(calendarDayDifference(referenceDate, parsed)) <= 5) found.add(iso(parsed));
      });
    }
    return Array.from(found).sort();
  }

  function resolveHolidayWindow(type, referenceDate) {
    const holidayValues = holidayDatesNear(referenceDate);
    const matches = [];

    holidayValues.forEach(function (value) {
      const holidayDate = parseIso(value);
      if (!holidayDate) return;

      const referenceOffset = calendarDayDifference(referenceDate, holidayDate);
      if (Math.abs(referenceOffset) > 5) return;
      HOLIDAY_RULES.forEach(function (rule) {
        if (rule.type !== type ||
            rule.holidayWeekday !== holidayDate.getDay() ||
            rule.referenceOffset !== referenceOffset) return;
        matches.push({
          holidayDate: localNoon(holidayDate),
          referenceOffset: referenceOffset,
          ruleLabel: rule.label,
          cobrar: rule.cobrar,
          noExpediente: Boolean(rule.noExpediente),
          start: rule.noExpediente ? null : addDays(holidayDate, rule.startOffset),
          end: rule.noExpediente ? null : addDays(holidayDate, rule.endOffset)
        });
      });
    });

    if (!matches.length) return { status: 'none', start: null, end: null, matches: [], ranges: [] };

    // Se a própria data de referência é feriado, a linha vermelha "SEM EXPED."
    // prevalece sobre regras de compensação associadas a feriados próximos.
    const noExpediente = matches.filter(function (match) {
      return match.noExpediente && match.referenceOffset === 0;
    });
    if (noExpediente.length) {
      return { status: 'no-expediente', start: null, end: null, matches: noExpediente, ranges: [] };
    }

    const validMatches = matches.filter(function (match) {
      return !match.noExpediente && match.start && match.end;
    });
    if (!validMatches.length) return { status: 'none', start: null, end: null, matches: [], ranges: [] };

    validMatches.sort(function (a, b) {
      return a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime();
    });

    // Feriados próximos podem gerar mais de uma regra aplicável. Unimos somente
    // janelas sobrepostas/adjacentes; blocos separados são ambíguos.
    const ranges = [];
    validMatches.forEach(function (match) {
      const last = ranges[ranges.length - 1];
      if (!last || iso(match.start) > iso(addDays(last.end, 1))) {
        ranges.push({ start: match.start, end: match.end, matches: [match] });
      } else {
        if (match.end.getTime() > last.end.getTime()) last.end = match.end;
        last.matches.push(match);
      }
    });

    if (ranges.length > 1) {
      return { status: 'conflict', start: null, end: null, matches: validMatches, ranges: ranges };
    }
    return {
      status: 'matched',
      start: ranges[0].start,
      end: ranges[0].end,
      matches: validMatches,
      ranges: ranges
    };
  }

  function datesBetweenInclusive(start, end) {
    if (!start || !end || iso(start) > iso(end)) return [];
    const dates = [];
    for (let date = localNoon(start); iso(date) <= iso(end); date = addDays(date, 1)) dates.push(localNoon(date));
    return dates;
  }

  function describeHolidayMatches(matches) {
    return matches.map(function (match) {
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
        note: 'Matriz de feriado aplicada ao 2º dia: ' + describeHolidayMatches(twoResolution.matches) + '.'
      };
    } else if (twoResolution.status === 'conflict') {
      two = { start: null, end: null,
        note: 'Conflito entre regras da matriz de feriados para o 2º dia; preenchimento bloqueado.' };
    } else if (twoResolution.status === 'no-expediente') {
      two = { start: null, end: null,
        note: 'SEM EXPEDIENTE para o 2º dia: a data de referência é feriado (' +
          describeHolidayMatches(twoResolution.matches) + ').' };
    } else {
      two = twoDayWindow(referenceDate);
    }

    let six;
    if (sixResolution.status === 'matched') {
      const dates = datesBetweenInclusive(sixResolution.start, sixResolution.end);
      six = { start: sixResolution.start, end: sixResolution.end, count: dates.length, dates: dates, contiguous: true };
    } else if (sixResolution.status === 'conflict' || sixResolution.status === 'no-expediente') {
      six = { start: null, end: null, count: 0, dates: [], contiguous: false };
    } else {
      six = reverseSearchSixthDay(referenceDate);
    }

    const holidayConflicts = [];
    if (twoResolution.status === 'conflict') {
      holidayConflicts.push('2º dia: mais de uma janela da matriz de feriados descontínua (' +
        twoResolution.ranges.map(function (range) { return br(range.start) + ' a ' + br(range.end); }).join(' e ') + ')');
    }
    if (sixResolution.status === 'conflict') {
      holidayConflicts.push('6º dia: mais de uma janela da matriz de feriados descontínua (' +
        sixResolution.ranges.map(function (range) { return br(range.start) + ' a ' + br(range.end); }).join(' e ') + ')');
    }

    const noExpediente = twoResolution.status === 'no-expediente' || sixResolution.status === 'no-expediente';
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
      sixSource: sixResolution.status === 'matched' ? 'holiday-rule'
        : sixResolution.status === 'no-expediente' ? 'holiday-no-expediente'
        : sixResolution.status === 'conflict' ? 'holiday-conflict' : 'reverse-search',
      twoSource: twoResolution.status === 'matched' ? 'holiday-rule'
        : twoResolution.status === 'no-expediente' ? 'holiday-no-expediente'
        : twoResolution.status === 'conflict' ? 'holiday-conflict' : 'weekly-default',
      sixMatches: sixResolution.matches,
      holidayConflicts: holidayConflicts,
      noExpediente: noExpediente,
      blocked: holidayConflicts.length > 0 || noExpediente
    };
  }

  /* ==========================================================================
   * 2. LEITURA E ESCRITA NO SYSTEXTIL
   * ========================================================================== */

  function normalize(text) {
    return String(text == null ? '' : text)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function compact(text) {
    return normalize(text).replace(/\s+/g, '');
  }

  function textOf(node) {
    return node ? String(node.textContent || '').trim() : '';
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

  // Texto do contexto imediato (até 5 níveis, sem ultrapassar linha/item).
  // textContent em vez de innerText: evita forçar layout para cada campo.
  function ancestorText(el) {
    const parts = [];
    let node = el;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      const text = textOf(node);
      if (text && text.length <= 260) parts.push(text);
      if (node.tagName === 'TR' || node.tagName === 'LI') break;
    }
    return parts.join(' ');
  }

  // Índice de campos construído uma única vez por operação (evita O(n²)).
  function buildControlIndex() {
    const entries = [];
    documentsInFrames().forEach(function (doc) {
      const labelById = new Map();
      doc.querySelectorAll('label[for]').forEach(function (label) {
        labelById.set(label.htmlFor, textOf(label));
      });
      doc.querySelectorAll('input, textarea, [contenteditable="true"]').forEach(function (el) {
        if (!isVisible(el)) return;
        const labels = [];
        if (el.labels) Array.from(el.labels).forEach(function (label) { labels.push(textOf(label)); });
        if (el.id && labelById.has(el.id)) labels.push(labelById.get(el.id));
        const direct = compact([el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
          el.getAttribute('title')].concat(labels).filter(Boolean).join(' '));
        const full = compact(direct + ' ' + ancestorText(el));
        entries.push({ element: el, direct: direct, full: full });
      });
    });
    return entries;
  }

  function findControl(parameter, entries) {
    const target = compact(parameter.target);
    const scored = entries.map(function (entry) {
      let score = 0;
      if (entry.direct.includes(target)) score += 100;
      if (entry.full.includes(target)) score += 20;
      if (score && entry.full.includes('inicio') && parameter.key.indexOf('fim') === 0) score -= 35;
      if (score && entry.full.includes('fim') && parameter.key.indexOf('inicio') === 0) score -= 35;
      return { element: entry.element, score: score };
    }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; });
    if (!scored.length) return { element: null, reason: 'campo não encontrado' };
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
    return labelCell ? parameterFromLabel(textOf(labelCell)) : null;
  }

  function findSmartClientGrid(doc) {
    const view = doc.defaultView;
    if (!view) return null;
    const candidates = [];
    try { candidates.push(view.parameterTab); } catch (_) { /* ausente */ }
    try {
      if (view.isc && view.isc.Canvas && typeof view.isc.Canvas.getById === 'function') {
        candidates.push(view.isc.Canvas.getById('parameterTab'));
      }
    } catch (_) { /* ausente */ }
    return candidates.find(function (grid) {
      return grid &&
        typeof grid.getTotalRows === 'function' &&
        typeof grid.getRecord === 'function' &&
        typeof grid.getFields === 'function' &&
        typeof grid.startEditing === 'function' &&
        typeof grid.setEditValue === 'function' &&
        (typeof grid.saveAllEdits === 'function' || typeof grid.endEditing === 'function');
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
    // Fallback baseado na estrutura conhecida: coluna 0 = Parâmetro, coluna 1 = Valor.
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
    } catch (_) { /* cai no fallback abaixo */ }
    const field = (grid.getFields() || [])[fieldIndex];
    if (field && field.name && record && record[field.name] !== undefined) return record[field.name];
    return undefined;
  }

  function gridRowValue(grid, param, indexes) {
    const total = Number(grid.getTotalRows()) || 0;
    for (let rowIndex = 0; rowIndex < total; rowIndex += 1) {
      const record = grid.getRecord(rowIndex);
      if (!record) continue;
      const mapped = parameterFromLabel(smartClientCell(grid, record, rowIndex, indexes.label));
      if (mapped && mapped.key === param.key) {
        return String(smartClientCell(grid, record, rowIndex, indexes.value) ?? '').trim();
      }
    }
    return null;
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Preenche a grade SmartClient de parâmetros. Retorna null se não houver grade.
  async function applyToSmartClientGrid(calc) {
    for (const doc of documentsInFrames()) {
      const rows = parameterRows(doc);
      if (!rows.length) continue;

      const grid = findSmartClientGrid(doc);
      if (!grid) {
        return failAll('grade encontrada, mas a API SmartClient está indisponível');
      }
      const indexes = smartClientFieldIndexes(grid);
      if (indexes.label < 0 || indexes.value < 0) {
        return failAll('colunas Parâmetro/Valor não identificadas');
      }

      // Mapeia cada parâmetro à sua linha da grade.
      const rowIndexes = new Map();
      const totalRows = Number(grid.getTotalRows()) || 0;
      for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
        const record = grid.getRecord(rowIndex);
        if (!record) continue;
        const param = parameterFromLabel(smartClientCell(grid, record, rowIndex, indexes.label));
        if (param) rowIndexes.set(param.key, rowIndex);
      }
      if (!rowIndexes.size) {
        rows.forEach(function (row, rowNumber) {
          const param = parameterFromRow(row);
          if (!param) return;
          const posinset = Number(row.getAttribute('aria-posinset'));
          rowIndexes.set(param.key, Number.isInteger(posinset) && posinset > 0 ? posinset - 1 : rowNumber);
        });
      }

      const outcome = emptyOutcome();
      const edited = [];
      for (const param of PARAMETROS) {
        const date = calc.values[param.key];
        if (!date) { outcome.untouched.push(param.label); continue; }
        const rowIndex = rowIndexes.get(param.key);
        if (!Number.isInteger(rowIndex)) {
          outcome.failed.push(param.label + ': linha não encontrada na grade');
          continue;
        }
        try {
          grid.startEditing(rowIndex, indexes.value);
          grid.setEditValue(rowIndex, indexes.value, br(date));
          edited.push({ param: param, date: date });
        } catch (error) {
          outcome.failed.push(param.label + ': falha de edição da grade');
          console.warn('[Systextil Régua] Falha ao editar parâmetro da grade:', param.key, error);
        }
      }

      try {
        if (typeof grid.saveAllEdits === 'function') grid.saveAllEdits();
        else grid.endEditing();
      } catch (error) {
        outcome.failed.push('a grade não conseguiu concluir as edições');
        console.warn('[Systextil Régua] Falha ao concluir as edições:', error);
      }

      await wait(CONFIG.ESPERA_GRADE_MS);

      // Confirmação: relê o valor da própria grade, não apenas o que foi digitado.
      edited.forEach(function (item) {
        const current = gridRowValue(grid, item.param, indexes);
        if (current === br(item.date)) outcome.verified += 1;
        else outcome.failed.push(item.param.label + ': o ERP não confirmou o valor');
      });
      return outcome;
    }
    return null;
  }

  // Fallback para formulários comuns (inputs isolados).
  async function applyToFormControls(calc) {
    const entries = buildControlIndex();
    const outcome = emptyOutcome();
    const written = [];
    for (const param of PARAMETROS) {
      const date = calc.values[param.key];
      if (!date) { outcome.untouched.push(param.label); continue; }
      const found = findControl(param, entries);
      if (!found.element) { outcome.failed.push(param.label + ': ' + found.reason); continue; }
      if (setControlValue(found.element, date)) written.push({ param: param, element: found.element, date: date });
      else outcome.failed.push(param.label + ': campo não aceitou o valor');
    }
    written.forEach(function (item) {
      if (readControlValue(item.element) === br(item.date) || readControlValue(item.element) === iso(item.date)) {
        outcome.verified += 1;
      } else {
        outcome.failed.push(item.param.label + ': o valor não foi confirmado no campo');
      }
    });
    return outcome;
  }

  function setControlValue(el, date) {
    const view = el.ownerDocument.defaultView || window;
    const isDate = String(el.type).toLowerCase() === 'date';
    const value = isDate ? iso(date) : br(date);
    if (el.isContentEditable) {
      el.textContent = value;
    } else {
      const proto = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) descriptor.set.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new view.Event('input', { bubbles: true }));
    el.dispatchEvent(new view.Event('change', { bubbles: true }));
    return true;
  }

  function readControlValue(el) {
    return el.isContentEditable ? textOf(el) : String(el.value || '').trim();
  }

  function emptyOutcome() {
    return { verified: 0, untouched: [], failed: [] };
  }

  function failAll(reason) {
    const outcome = emptyOutcome();
    PARAMETROS.forEach(function (param) { outcome.failed.push(param.label + ': ' + reason); });
    return outcome;
  }

  async function applyToErp(calc) {
    const viaGrid = await applyToSmartClientGrid(calc);
    if (viaGrid) return viaGrid;
    return applyToFormControls(calc);
  }

  /* ==========================================================================
   * 3. RESUMO E TEXTOS
   * ========================================================================== */

  function blockReason(calc) {
    return calc.noExpediente
      ? 'a data de referência é feriado sem expediente'
      : calc.holidayConflicts.join(' | ');
  }

  function buildSummary(calc, reference) {
    const origem2 = calc.twoSource === 'holiday-rule' ? 'matriz de feriado'
      : calc.twoSource === 'holiday-no-expediente' ? 'SEM EXPEDIENTE'
      : calc.twoSource === 'holiday-conflict' ? 'conflito entre regras de feriado'
      : 'calendário semanal padrão';
    const origem6 = calc.sixSource === 'holiday-rule' ? 'matriz de feriado'
      : calc.sixSource === 'holiday-no-expediente' ? 'SEM EXPEDIENTE'
      : calc.sixSource === 'holiday-conflict' ? 'conflito entre regras de feriado'
      : 'busca reversa padrão';
    const janela6 = calc.sixCount === 0 ? 'sem correspondências'
      : (calc.sixContiguous ? 'sim' : 'não; conferir a tabela auxiliar J:L');

    return PARAMETROS.map(function (p) {
      return p.label + ': ' + br(calc.values[p.key]);
    }).join('\n') +
      '\nReferência: ' + br(reference) +
      '\nRegra 2 dias: ' + calc.twoNote +
      '\nOrigem da regra 2º dia: ' + origem2 +
      '\nOrigem da regra 6º dia: ' + origem6 +
      '\nDatas de vencimento do 6º dia: ' + (calc.sixDates.length ? calc.sixDates.map(br).join(', ') : 'nenhuma') +
      '\nJanela do 6º dia contígua: ' + janela6 +
      '\nConflitos de feriado: ' + (calc.holidayConflicts.length ? calc.holidayConflicts.join(' | ') : 'nenhum') +
      '\nPreenchimento permitido: ' + (calc.blocked ? 'não' : 'sim');
  }

  function buildNote(calc, reference) {
    if (calc.blocked) {
      return calc.noExpediente
        ? { tone: 'alert', text: 'Sem expediente: a data de referência coincide com feriado assinalado em vermelho na matriz. Nenhum parâmetro será preenchido. ' + calc.twoNote }
        : { tone: 'alert', text: 'Preenchimento bloqueado: ' + calc.holidayConflicts.join(' | ') + '. Resolva o conflito de feriados antes de preencher. ' + calc.twoNote };
    }
    let sixText;
    if (calc.sixSource === 'holiday-rule') {
      sixText = 'Exceção de feriado aplicada ao 6º dia: ' + describeHolidayMatches(calc.sixMatches) +
        '. Janela: ' + br(calc.values.inicio6) + ' a ' + br(calc.values.fim6) + '.';
    } else if (!calc.sixCount) {
      sixText = 'A busca reversa não encontrou vencimentos associados ao prazo final ' + br(reference) +
        '. O 6º dia ficará sem alteração. Confira a data e o calendário.';
    } else if (!calc.sixContiguous) {
      sixText = 'A busca reversa encontrou ' + calc.sixCount + ' datas de vencimento em intervalos separados. ' +
        'Início/Fim do 6º dia ficarão sem alteração para evitar incluir datas sem o mesmo prazo; confira a tabela auxiliar J:L.';
    } else {
      sixText = 'Busca reversa do 6º dia: ' + calc.sixCount +
        ' data(s) de vencimento associada(s) ao prazo final ' + br(reference) + '.';
    }
    return { tone: 'info', text: calc.twoNote + ' ' + sixText };
  }

  function rowCellText(param, calc) {
    const date = calc.values[param.key];
    if (date) return br(date);
    if (DEPENDEM_DE_FERIADO.indexOf(param.key) >= 0) {
      if (calc.noExpediente) return 'Sem expediente';
      if (calc.blocked) return 'Bloqueado';
    }
    return 'Sem data';
  }

  /* ==========================================================================
   * 4. INTERFACE
   * ========================================================================== */

  const ui = {
    panel: null, body: null, toggle: null, dateInput: null, tbody: null,
    note: null, status: null, fillBtn: null, copyBtn: null,
    calc: null, reference: null, summary: '', busy: false, minimized: false
  };

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      const value = attrs[key];
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function readStoredFlag(key, fallback) {
    try {
      const value = sessionStorage.getItem(key);
      return value === null ? fallback : value === '1';
    } catch (_) { return fallback; }
  }

  function storeFlag(key, flag) {
    try { sessionStorage.setItem(key, flag ? '1' : '0'); } catch (_) { /* armazenamento indisponível */ }
  }

  function injectStyles() {
    if (document.getElementById('st-regua-parametros-styles')) return;
    const style = document.createElement('style');
    style.id = 'st-regua-parametros-styles';
    style.textContent = [
      '#' + CONFIG.ID_PAINEL + '{position:fixed;right:12px;bottom:12px;z-index:2147483647;',
      'width:360px;max-width:calc(100vw - 24px);max-height:78vh;display:flex;flex-direction:column;',
      'background:#fff;color:#101828;border:1px solid #d0d5dd;border-radius:12px;',
      'box-shadow:0 8px 24px rgba(16,24,40,.16);color-scheme:light;',
      'font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}',
      '#' + CONFIG.ID_PAINEL + ' *{box-sizing:border-box;}',
      '#' + CONFIG.ID_PAINEL + '.is-min{width:auto;max-height:none;min-width:220px;}',
      '#' + CONFIG.ID_PAINEL + '[hidden]{display:none!important;}',
      '#' + CONFIG.ID_PAINEL + ' .st-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;',
      'padding:6px 6px 6px 12px;min-height:44px;background:#102a43;color:#fff;border-radius:11px 11px 0 0;}',
      '#' + CONFIG.ID_PAINEL + '.is-min .st-hdr{border-radius:11px;}',
      '#' + CONFIG.ID_PAINEL + ' .st-title{font-size:14px;font-weight:600;}',
      '#' + CONFIG.ID_PAINEL + ' .st-toggle{min-width:44px;min-height:44px;border:0;border-radius:8px;',
      'background:#243b53;color:#fff;font-size:20px;line-height:1;cursor:pointer;}',
      '#' + CONFIG.ID_PAINEL + ' .st-toggle:hover{background:#334e68;}',
      '#' + CONFIG.ID_PAINEL + ' .st-body{padding:12px;overflow:auto;overscroll-behavior:contain;min-height:0;}',
      '#' + CONFIG.ID_PAINEL + ' .st-body[hidden]{display:none;}',
      '#' + CONFIG.ID_PAINEL + ' label.st-label{display:block;font-weight:600;color:#344054;margin-bottom:4px;}',
      '#' + CONFIG.ID_PAINEL + ' .st-date{display:block;width:100%;min-height:44px;padding:9px 10px;',
      'border:1px solid #667085;border-radius:8px;background:#fff;color:#101828;font:inherit;}',
      '#' + CONFIG.ID_PAINEL + ' .st-help{display:block;margin:6px 0 12px;color:#475467;font-size:12px;}',
      '#' + CONFIG.ID_PAINEL + ' .st-table{width:100%;border-collapse:collapse;margin-bottom:12px;',
      'border:1px solid #eaecf0;border-radius:8px;overflow:hidden;}',
      '#' + CONFIG.ID_PAINEL + ' .st-table th{text-align:left;padding:8px 10px;background:#f2f4f7;',
      'color:#344054;font-weight:600;border-bottom:1px solid #d0d5dd;}',
      '#' + CONFIG.ID_PAINEL + ' .st-table td{padding:7px 10px;color:#344054;border-bottom:1px solid #eaecf0;}',
      '#' + CONFIG.ID_PAINEL + ' .st-table tr:nth-child(even) td{background:#f8fafc;}',
      '#' + CONFIG.ID_PAINEL + ' .st-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}',
      '#' + CONFIG.ID_PAINEL + ' .st-table .is-alert{color:#b42318;font-weight:600;}',
      '#' + CONFIG.ID_PAINEL + ' .st-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;',
      'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}',
      '#' + CONFIG.ID_PAINEL + ' .st-note{margin:0 0 12px;padding:10px 12px;color:#344054;background:#f8fafc;',
      'border:1px solid #e4e7ec;border-radius:8px;}',
      '#' + CONFIG.ID_PAINEL + ' .st-note.is-alert{background:#fef3f2;border-color:#fecdca;color:#912018;}',
      '#' + CONFIG.ID_PAINEL + ' .st-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
      '#' + CONFIG.ID_PAINEL + ' .st-btn{min-height:44px;padding:10px 12px;border:0;border-radius:8px;',
      'font:inherit;font-weight:600;line-height:1.3;cursor:pointer;overflow-wrap:anywhere;}',
      '#' + CONFIG.ID_PAINEL + ' .st-btn-primary{background:#175cd3;color:#fff;}',
      '#' + CONFIG.ID_PAINEL + ' .st-btn-primary:hover{background:#1849a9;}',
      '#' + CONFIG.ID_PAINEL + ' .st-btn-secondary{background:#eaecf0;color:#101828;}',
      '#' + CONFIG.ID_PAINEL + ' .st-btn-secondary:hover{background:#d0d5dd;}',
      '#' + CONFIG.ID_PAINEL + ' [aria-disabled="true"]{opacity:.5;cursor:not-allowed;}',
      '#' + CONFIG.ID_PAINEL + ' :focus-visible{outline:3px solid #1570ef;outline-offset:2px;}',
      '#' + CONFIG.ID_PAINEL + ' .st-status{margin-top:10px;padding:9px 10px;border-left:4px solid #1570ef;',
      'border-radius:4px;background:#eff8ff;color:#194185;overflow-wrap:anywhere;min-height:2.5em;}',
      '#' + CONFIG.ID_PAINEL + ' .st-status.is-warn{border-left-color:#b54708;background:#fffaeb;color:#7a2e0e;}',
      '#' + CONFIG.ID_PAINEL + ' .st-status.is-error{border-left-color:#b42318;background:#fef3f2;color:#912018;}',
      '#' + CONFIG.ID_PAINEL + ' .st-status.is-ok{border-left-color:#067647;background:#ecfdf3;color:#054f31;}',
      '#' + CONFIG.ID_PAINEL + ' .st-foot{margin:12px 0 0;padding-top:10px;border-top:1px solid #eaecf0;',
      'color:#475467;font-size:12px;}',
      '@media (max-width:520px){',
      '#' + CONFIG.ID_PAINEL + '{left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom,0px));',
      'width:auto;max-width:none;max-height:calc(100vh - 16px);}',
      '#' + CONFIG.ID_PAINEL + '.is-min{left:auto;width:auto;}',
      '#' + CONFIG.ID_PAINEL + ' .st-actions{grid-template-columns:1fr;}',
      '}',
      '@media (prefers-reduced-motion:reduce){#' + CONFIG.ID_PAINEL + ' *{transition:none!important;animation:none!important;}}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function setStatus(kind, message) {
    if (!ui.status) return;
    ui.status.className = 'st-status' + (kind === 'warn' ? ' is-warn' : kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : '');
    // Prefixo textual: a cor não é o único indicador de estado.
    const prefix = kind === 'error' ? 'Erro: ' : kind === 'warn' ? 'Atenção: ' : kind === 'ok' ? 'Concluído: ' : '';
    ui.status.textContent = prefix + message;
  }

  function updateActions() {
    const fillBlocked = !ui.calc || ui.calc.blocked || ui.busy;
    ui.fillBtn.setAttribute('aria-disabled', String(fillBlocked));
    ui.fillBtn.textContent = ui.busy ? 'Preenchendo…' : 'Preencher no Systextil';
    ui.copyBtn.setAttribute('aria-disabled', String(!ui.calc));
  }

  function renderRows() {
    ui.tbody.replaceChildren();
    PARAMETROS.forEach(function (param) {
      const text = rowCellText(param, ui.calc);
      const missing = !ui.calc.values[param.key];
      ui.tbody.appendChild(h('tr', null, [
        h('td', { text: param.label }),
        h('td', { class: 'num' + (missing ? ' is-alert' : ''), text: text })
      ]));
    });
  }

  function renderCalculation() {
    const reference = parseIso(ui.dateInput.value);
    if (!reference) {
      ui.calc = null;
      ui.tbody.replaceChildren();
      ui.note.textContent = '';
      ui.note.className = 'st-note';
      ui.summary = '';
      setStatus('error', 'Informe uma data de referência válida.');
      updateActions();
      return;
    }

    ui.reference = reference;
    ui.calc = calculate(reference);
    ui.summary = buildSummary(ui.calc, reference);
    renderRows();

    const note = buildNote(ui.calc, reference);
    ui.note.textContent = note.text;
    ui.note.className = 'st-note' + (note.tone === 'alert' ? ' is-alert' : '');

    if (ui.calc.blocked) {
      setStatus('error', 'Preenchimento bloqueado (' + blockReason(ui.calc) + '). Nenhum campo será alterado.');
    } else {
      setStatus('', 'Cálculo atualizado. Confira os valores no quadro antes de preencher.');
    }
    updateActions();
  }

  function reportOutcome(outcome) {
    const total = PARAMETROS.length;
    const parts = [outcome.verified + ' de ' + total + ' parâmetros preenchidos e confirmados no Systextil.'];
    if (outcome.untouched.length) {
      parts.push('Sem data calculada, mantidos sem alteração: ' + outcome.untouched.join(', ') + '.');
    }
    if (outcome.failed.length) {
      parts.push('Não confirmados: ' + outcome.failed.join('; ') + '.');
    }
    if (outcome.failed.length) {
      setStatus('warn', parts.join(' ') + ' Confira no Systextil antes de salvar.');
    } else if (outcome.untouched.length) {
      setStatus('warn', parts.join(' ') + ' Confira no Systextil antes de salvar.');
    } else {
      setStatus('ok', parts.join(' ') + ' Revise no Systextil antes de salvar.');
    }
  }

  async function fillFromCalculation() {
    if (ui.busy) return;
    if (!ui.calc) { setStatus('error', 'Informe uma data de referência válida antes de preencher.'); return; }
    if (ui.calc.blocked) {
      setStatus('error', 'Preenchimento bloqueado (' + blockReason(ui.calc) + '). Nenhum campo foi alterado.');
      return;
    }

    ui.busy = true;
    updateActions();
    setStatus('', 'Preenchendo parâmetros no Systextil…');
    try {
      const outcome = await applyToErp(ui.calc);
      reportOutcome(outcome);
      if (outcome.failed.length) console.warn('[Systextil Régua] Não confirmados:', outcome.failed);
    } catch (error) {
      console.error('[Systextil Régua] Falha inesperada ao preencher:', error);
      setStatus('error', 'Falha inesperada ao preencher. Nada foi confirmado; confira os campos manualmente.');
    } finally {
      ui.busy = false;
      updateActions();
    }
  }

  function copySummary() {
    if (!ui.calc) { setStatus('error', 'Não há resumo para copiar. Informe uma data válida.'); return; }
    const text = ui.summary;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus('ok', 'Resumo copiado.');
      }).catch(function () { legacyCopy(text); });
    } else {
      legacyCopy(text);
    }
  }

  function legacyCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    Object.assign(area.style, { position: 'fixed', opacity: '0', left: '-9999px', top: '0' });
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
    area.remove();
    setStatus(copied ? 'ok' : 'error', copied
      ? 'Resumo copiado.'
      : 'Não foi possível copiar automaticamente. Selecione o resumo manualmente.');
  }

  function setMinimized(next) {
    ui.minimized = next;
    ui.panel.classList.toggle('is-min', next);
    ui.body.hidden = next;
    ui.toggle.textContent = next ? '+' : '−';
    const label = next ? 'Expandir painel da régua de cobrança' : 'Minimizar painel da régua de cobrança';
    ui.toggle.setAttribute('aria-label', label);
    ui.toggle.setAttribute('title', label);
    ui.toggle.setAttribute('aria-expanded', String(!next));
    storeFlag(CONFIG.STORAGE_MINIMIZADO, next);
  }

  function createPanel() {
    if (document.getElementById(CONFIG.ID_PAINEL) || !document.body) return;
    injectStyles();

    ui.dateInput = h('input', {
      type: 'date', id: 'st-regua-data', class: 'st-date',
      value: iso(new Date()), 'aria-describedby': 'st-regua-data-ajuda',
      onchange: renderCalculation
    });
    ui.tbody = h('tbody');
    const table = h('table', { class: 'st-table' }, [
      h('caption', { class: 'st-sr', text: 'Valores calculados para os parâmetros da régua de cobrança' }),
      h('thead', null, [h('tr', null, [
        h('th', { scope: 'col', text: 'Parâmetro' }),
        h('th', { scope: 'col', class: 'num', text: 'Valor calculado' })
      ])]),
      ui.tbody
    ]);

    ui.note = h('p', { class: 'st-note' });
    ui.fillBtn = h('button', {
      type: 'button', class: 'st-btn st-btn-primary', 'aria-describedby': 'st-regua-status',
      onclick: fillFromCalculation
    });
    ui.copyBtn = h('button', {
      type: 'button', class: 'st-btn st-btn-secondary', text: 'Copiar resumo',
      onclick: copySummary
    });
    ui.status = h('div', { id: 'st-regua-status', class: 'st-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });

    ui.body = h('div', { class: 'st-body' }, [
      h('label', { class: 'st-label', for: 'st-regua-data', text: 'Data de referência' }),
      ui.dateInput,
      h('span', { id: 'st-regua-data-ajuda', class: 'st-help', text: 'Os valores são recalculados ao mudar a data. Nada é enviado ao Systextil até você pressionar o botão.' }),
      table,
      ui.note,
      h('div', { class: 'st-actions' }, [ui.fillBtn, ui.copyBtn]),
      ui.status,
      h('p', { class: 'st-foot', text: 'Confira os campos no Systextil antes de confirmar. Feriados locais são configurados em FERIADOS_ADICIONAIS.' })
    ]);

    ui.toggle = h('button', { type: 'button', class: 'st-toggle', onclick: function () { setMinimized(!ui.minimized); } });
    const titleId = 'st-regua-titulo';
    const header = h('div', { class: 'st-hdr' }, [
      h('strong', { id: titleId, class: 'st-title', text: 'Régua de cobrança' }),
      ui.toggle
    ]);

    ui.panel = h('section', {
      id: CONFIG.ID_PAINEL, role: 'region', 'aria-labelledby': titleId
    }, [header, ui.body]);

    // Escape recolhe o painel e devolve o foco ao botão de expandir.
    ui.panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !ui.minimized) {
        setMinimized(true);
        ui.toggle.focus();
      }
    });

    document.body.appendChild(ui.panel);
    setMinimized(readStoredFlag(CONFIG.STORAGE_MINIMIZADO, false));
    renderCalculation();
  }

  /* ==========================================================================
   * 5. DIAGNÓSTICO (somente com opt-in explícito no localStorage)
   * ========================================================================== */

  function debugEnabled() {
    try { return localStorage.getItem(CONFIG.STORAGE_DEBUG) === '1'; } catch (_) { return false; }
  }

  if (debugEnabled()) {
    window.__systextilParametrosReguaDebug = Object.freeze({
      version: SCRIPT_VERSION,
      buildId: SCRIPT_BUILD_ID,
      calculate: calculate,
      twoDayWindow: twoDayWindow,
      calculateSixthDayDeadline: calculateSixthDayDeadline,
      reverseSearchSixthDay: reverseSearchSixthDay,
      resolveHolidayWindow: resolveHolidayWindow,
      holidayRules: HOLIDAY_RULES.slice(),
      holidaysForYear: function (year) { return Array.from(holidaysForYear(year)).sort(); },
      iso: iso,
      br: br
    });
  }

  // O painel só se mostra na tela de parâmetros da régua (grade presente no
  // documento principal ou em iframes same-origin). Fora dela fica oculto.
  function telaDaReguaPresente() {
    return documentsInFrames().some(function (doc) {
      return parameterRows(doc).length > 0;
    });
  }

  function sincronizarVisibilidade() {
    const presente = telaDaReguaPresente();
    if (presente && !ui.panel && document.body) createPanel();
    if (ui.panel) ui.panel.hidden = !presente;
  }

  let sincronizacaoAgendada = false;
  function agendarSincronizacao() {
    if (sincronizacaoAgendada) return;
    sincronizacaoAgendada = true;
    setTimeout(function () {
      sincronizacaoAgendada = false;
      sincronizarVisibilidade();
    }, 250);
  }

  function iniciar() {
    if (!document.body) { setTimeout(iniciar, 200); return; }
    sincronizarVisibilidade();
    // SPA/ERP: a grade pode aparecer ou sair sem recarregar a página.
    new MutationObserver(agendarSincronizacao).observe(document.body, { childList: true, subtree: true });
    // Rede de segurança para conteúdo em iframes, que não geram mutação no documento pai.
    setInterval(sincronizarVisibilidade, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  } else {
    iniciar();
  }
})();
