'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'userscripts', 'systextil-parametros-regua.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function calculator() {
  const document = {
    readyState: 'loading',
    addEventListener: function () {},
    getElementById: function () {}
  };
  const window = { document: document, console: console };
  window.top = window;
  vm.runInNewContext(source, { window: window, document: document, console: console, Date: Date }, { filename: scriptPath });
  assert.ok(window.__systextilParametrosReguaDebug);
  return window.__systextilParametrosReguaDebug;
}

function date(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function dayIso(value) {
  return value.getFullYear() + '-' +
    String(value.getMonth() + 1).padStart(2, '0') + '-' +
    String(value.getDate()).padStart(2, '0');
}

test('faixa de 2 dias segue o calendário operacional semanal', function () {
  const api = calculator();
  const actual = [
    api.twoDayWindow(date(2026, 10, 26)),
    api.twoDayWindow(date(2026, 10, 27)),
    api.twoDayWindow(date(2026, 10, 28)),
    api.twoDayWindow(date(2026, 10, 29)),
    api.twoDayWindow(date(2026, 10, 30))
  ].map(function (window) { return [dayIso(window.start), dayIso(window.end)]; });

  assert.deepEqual(actual, [
    ['2026-10-22', '2026-10-22'],
    ['2026-10-23', '2026-10-23'],
    ['2026-10-24', '2026-10-26'],
    ['2026-10-27', '2026-10-27'],
    ['2026-10-28', '2026-10-28']
  ]);
});

test('faixa de 2 dias não cria janela no fim de semana', function () {
  const api = calculator();
  [date(2026, 10, 24), date(2026, 10, 25)].forEach(function (reference) {
    const result = api.twoDayWindow(reference);
    assert.equal(result.start, null);
    assert.equal(result.end, null);
  });
});

test('prazo do 6º dia soma seis dias corridos a partir do vencimento', function () {
  const api = calculator();
  assert.equal(dayIso(api.calculateSixthDayDeadline(date(2026, 10, 22))), '2026-10-28');
});

test('prazo que cai no sábado ou domingo é prorrogado para segunda-feira', function () {
  const api = calculator();
  assert.equal(dayIso(api.calculateSixthDayDeadline(date(2026, 9, 20))), '2026-09-28');
  assert.equal(dayIso(api.calculateSixthDayDeadline(date(2026, 9, 21))), '2026-09-28');
});

test('feriado na segunda-feira desloca o prazo para a próxima segunda não feriada', function () {
  const api = calculator();
  assert.equal(api.isBusinessDay(date(2026, 11, 2)), false);
  assert.equal(dayIso(api.calculateSixthDayDeadline(date(2026, 10, 27))), '2026-11-09');
});

test('busca reversa encontra vencimentos com o mesmo prazo final', function () {
  const api = calculator();
  const result = api.reverseSearchSixthDay(date(2026, 11, 9));
  assert.equal(result.count, 6);
  assert.equal(result.contiguous, false);
  assert.equal(dayIso(result.start), '2026-10-25');
  assert.equal(dayIso(result.end), '2026-11-03');
  assert.ok(result.dates.every(function (due) {
    return dayIso(api.calculateSixthDayDeadline(due)) === '2026-11-09';
  }));
});

test('não preenche uma janela do 6º dia quando as datas encontradas são separadas', function () {
  const api = calculator();
  const result = api.calculate(date(2026, 11, 9));
  assert.equal(result.sixContiguous, false);
  assert.equal(result.values.inicio6, null);
  assert.equal(result.values.fim6, null);
});

test('faixas de 10, 15 e 18 dias usam dias corridos sem ajuste de calendário', function () {
  const api = calculator();
  const values = api.calculate(date(2026, 10, 28)).values;
  assert.equal(dayIso(values.inicio10), '2026-10-18');
  assert.equal(dayIso(values.fim10), '2026-10-18');
  assert.equal(dayIso(values.inicio15), '2026-10-13');
  assert.equal(dayIso(values.fim15), '2026-10-13');
  assert.equal(dayIso(values.inicio18), '2026-10-10');
  assert.equal(dayIso(values.fim18), '2026-10-10');
});

test('calendário inclui feriados fixos e móveis nacionais', function () {
  const holidays = new Set(calculator().holidaysForYear(2026));
  [
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03',
    '2026-06-04', '2026-09-07', '2026-11-02', '2026-11-20', '2026-12-25'
  ].forEach(function (holiday) { assert.ok(holidays.has(holiday), 'feriado esperado: ' + holiday); });
});

test('rótulos da grade SmartClient são reconhecidos mesmo com chaves e dois-pontos', function () {
  const api = calculator();
  const labels = [
    '{Início 2 Dias:}', '{Fim 2 Dias:}',
    '{Início 6 Dias:}', '{Fim 6 Dias:}',
    '{Início 10 Dias:}', '{Fim 10 Dias:}',
    '{Início 15 Dias:}', '{Fim 15 Dias:}',
    '{Início 18 Dias:}', '{Fim 18 Dias:}'
  ];
  const keys = labels.map(function (label) { return api.parameterKeyFromLabel(label); });
  assert.deepEqual(keys, [
    'inicio2', 'fim2', 'inicio6', 'fim6', 'inicio10',
    'fim10', 'inicio15', 'fim15', 'inicio18', 'fim18'
  ]);
  assert.equal(api.parameterKeyFromLabel('campo desconhecido'), null);
});


function parseDay(value) {
  const parts = value.split('-').map(Number);
  return date(parts[0], parts[1], parts[2]);
}

test('matriz completa contém e aplica as 55 regras transcritas das tabelas', function () {
  const api = calculator();
  const expected = {
    1: {
      two: [[0, null, null], [1, -4, -4], [2, -3, -3], [3, -2, 1], [4, 2, 2]],
      six: [[0, null, null], [1, -8, -5], [2, -4, -4], [3, -3, -3], [4, -2, -2]]
    },
    2: {
      two: [[-1, -5, -5], [0, null, null], [1, -4, -4], [2, -3, -1], [3, 0, 1]],
      six: [[-1, -9, -7], [0, null, null], [1, -6, -5], [2, -4, -4], [3, -3, -3]]
    },
    3: {
      two: [[-2, -6, -6], [-1, -5, -5], [0, null, null], [1, -4, -2], [2, -1, 0]],
      six: [[-2, -10, -8], [-1, -7, -7], [0, null, null], [1, -6, -5], [2, -4, -4]]
    },
    4: {
      two: [[-3, -7, -7], [-2, -6, -6], [-1, -5, -3], [0, null, null], [1, -2, -2], [4, -1, 0], [5, 0, 1]],
      six: [[-3, -11, -9], [-2, -8, -8], [-1, -7, -7], [0, null, null], [1, -6, -5]]
    },
    5: {
      two: [[-4, -8, -8], [-3, -7, -7], [-2, -6, -4], [-1, -3, -3], [0, null, null], [3, -2, -2], [4, -1, 0]],
      six: [[-4, -12, -10], [-3, -9, -9], [-2, -8, -8], [-1, -7, -7], [0, null, null], [3, -6, -3]]
    }
  };

  assert.equal(api.holidayRules.length, 55, 'total de regras da matriz');

  Object.keys(expected).forEach(function (weekdayText) {
    const weekday = Number(weekdayText);
    ['two', 'six'].forEach(function (type) {
      expected[weekday][type].forEach(function (entry) {
        const offset = entry[0];
        const expectedStartOffset = entry[1];
        const expectedEndOffset = entry[2];
        const rule = api.holidayRules.find(function (candidate) {
          return candidate.type === type &&
            candidate.holidayWeekday === weekday &&
            candidate.referenceOffset === offset;
        });
        assert.ok(rule, 'regra ausente: ' + type + ', feriado weekday=' + weekday + ', Δ=' + offset);
        if (expectedStartOffset === null) {
          assert.equal(rule.noExpediente, true, 'linha deve ser SEM EXPED.');
        } else {
          assert.equal(rule.noExpediente, undefined, 'linha não deve ser SEM EXPED.');
        }
        const easterIndependentHolidays = {
          1: '2026-11-02',
          2: '2026-11-03',
          3: '2026-11-04',
          4: '2026-11-05',
          5: '2026-11-06'
        };
        const holiday = parseDay(easterIndependentHolidays[weekday]);
        const reference = new Date(holiday);
        reference.setDate(reference.getDate() + offset);
        const result = api.resolveHolidayWindow(type, reference, [holiday]);
        if (expectedStartOffset === null) {
          assert.equal(result.status, 'no-expediente');
        } else {
          assert.equal(result.status, 'matched');
          const expectedStart = new Date(holiday);
          expectedStart.setDate(expectedStart.getDate() + expectedStartOffset);
          const expectedEnd = new Date(holiday);
          expectedEnd.setDate(expectedEnd.getDate() + expectedEndOffset);
          assert.equal(dayIso(result.start), dayIso(expectedStart),
            'início incorreto: ' + type + ', feriado weekday=' + weekday + ', Δ=' + offset);
          assert.equal(dayIso(result.end), dayIso(expectedEnd),
            'fim incorreto: ' + type + ', feriado weekday=' + weekday + ', Δ=' + offset);
        }
      });
    });
  });
});

test('03/11/2026 aplica a matriz após o feriado de segunda-feira 02/11', function () {
  const api = calculator();
  const result = api.calculate(date(2026, 11, 3));
  assert.equal(dayIso(result.values.inicio2), '2026-10-29');
  assert.equal(dayIso(result.values.fim2), '2026-10-29');
  assert.equal(dayIso(result.values.inicio6), '2026-10-25');
  assert.equal(dayIso(result.values.fim6), '2026-10-28');
  assert.equal(dayIso(result.values.inicio10), '2026-10-24');
  assert.equal(dayIso(result.values.inicio15), '2026-10-19');
  assert.equal(dayIso(result.values.inicio18), '2026-10-16');
  assert.equal(result.twoSource, 'holiday-rule');
  assert.equal(result.sixSource, 'holiday-rule');
  assert.equal(result.twoHolidayStatus, 'matched');
  assert.equal(result.sixHolidayStatus, 'matched');
  assert.equal(result.sixCount, 4);
  assert.equal(result.sixContiguous, true);
  assert.equal(result.blocked, false);
});

test('Sexta-feira Santa de 03/04/2026 segue a matriz e bloqueia o próprio feriado', function () {
  const api = calculator();
  const before = api.calculate(date(2026, 4, 1));
  assert.equal(dayIso(before.values.inicio2), '2026-03-28');
  assert.equal(dayIso(before.values.fim2), '2026-03-30');

  const holiday = api.calculate(date(2026, 4, 3));
  assert.equal(holiday.twoHolidayStatus, 'no-expediente');
  assert.equal(holiday.sixHolidayStatus, 'no-expediente');
  assert.equal(holiday.blocked, true);
});

test('matriz simulada: feriado na quarta, quinta cobra sábado a segunda e sexta cobra terça e quarta', function () {
  const api = calculator();
  // Usa calendário isolado: 14/10/2026 não é adicionado como feriado real,
  // pois este teste valida a regra hipotética da matriz.
  const thursday = api.resolveHolidayWindow('two', date(2026, 10, 15), ['2026-10-14']);
  assert.equal(dayIso(thursday.start), '2026-10-10');
  assert.equal(dayIso(thursday.end), '2026-10-12');

  const friday = api.resolveHolidayWindow('two', date(2026, 10, 16), ['2026-10-14']);
  assert.equal(dayIso(friday.start), '2026-10-13');
  assert.equal(dayIso(friday.end), '2026-10-14');
});

test('a data vermelha da matriz é SEM EXPED. e bloqueia o preenchimento', function () {
  const api = calculator();
  const result = api.calculate(date(2026, 11, 2));
  assert.equal(result.twoHolidayStatus, 'no-expediente');
  assert.equal(result.sixHolidayStatus, 'no-expediente');
  assert.equal(result.noExpediente, true);
  assert.equal(result.blocked, true);
  assert.equal(result.values.inicio2, null);
  assert.equal(result.values.inicio6, null);
});

test('o cálculo integra a exceção real do feriado nacional de 12/10/2026', function () {
  const api = calculator();
  const two = api.calculate(date(2026, 10, 15));
  assert.equal(dayIso(two.values.inicio2), '2026-10-10');
  assert.equal(dayIso(two.values.fim2), '2026-10-13');
  assert.equal(two.twoHolidayStatus, 'matched');

  const six = api.calculate(date(2026, 10, 13));
  assert.equal(dayIso(six.values.inicio6), '2026-10-04');
  assert.equal(dayIso(six.values.fim6), '2026-10-07');
  assert.equal(six.sixHolidayStatus, 'matched');
  assert.equal(six.sixSource, 'holiday-rule');
});

test('feriados consecutivos de Carnaval mesclam janelas sobrepostas sem gerar conflito', function () {
  const api = calculator();
  const result = api.resolveHolidayWindow('two', date(2026, 2, 19), [
    '2026-02-16',
    '2026-02-17'
  ]);
  assert.equal(result.status, 'matched');
  assert.equal(result.matches.length, 2);
  assert.equal(dayIso(result.start), '2026-02-14');
  assert.equal(dayIso(result.end), '2026-02-17');
});

test('regras especiais não alteram a régua padrão quando não há feriado aplicável', function () {
  const api = calculator();
  const result = api.resolveHolidayWindow('two', date(2026, 10, 28), []);
  assert.equal(result.status, 'none');
  const normal = api.calculate(date(2026, 10, 28));
  assert.equal(dayIso(normal.values.inicio2), '2026-10-24');
  assert.equal(dayIso(normal.values.fim2), '2026-10-26');
  assert.equal(dayIso(normal.values.inicio10), '2026-10-18');
  assert.equal(dayIso(normal.values.inicio15), '2026-10-13');
  assert.equal(dayIso(normal.values.inicio18), '2026-10-10');
});

test('API de cálculo não executa a consulta nem preenche campos', function () {
  const api = calculator();
  const result = api.calculate(date(2026, 10, 28));
  assert.equal(Object.keys(result.values).length, 10);
});
