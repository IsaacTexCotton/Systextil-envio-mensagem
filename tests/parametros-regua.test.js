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

test('as 18 janelas especiais de feriado reproduzem os exemplos documentados', function () {
  const api = calculator();
  const scenarios = [
    // 2º dia
    { type: 'two', reference: '2026-10-15', holiday: '2026-10-12', start: '2026-10-10', end: '2026-10-13' },
    { type: 'two', reference: '2026-10-15', holiday: '2026-10-13', start: '2026-10-10', end: '2026-10-12' },
    { type: 'two', reference: '2026-10-16', holiday: '2026-10-13', start: '2026-10-13', end: '2026-10-14' },
    { type: 'two', reference: '2026-10-15', holiday: '2026-10-14', start: '2026-10-10', end: '2026-10-12' },
    { type: 'two', reference: '2026-10-16', holiday: '2026-10-14', start: '2026-10-13', end: '2026-10-14' },
    { type: 'two', reference: '2026-10-14', holiday: '2026-10-15', start: '2026-10-10', end: '2026-10-12' },
    { type: 'two', reference: '2026-10-19', holiday: '2026-10-15', start: '2026-10-14', end: '2026-10-15' },
    { type: 'two', reference: '2026-10-14', holiday: '2026-10-16', start: '2026-10-10', end: '2026-10-12' },
    { type: 'two', reference: '2026-10-19', holiday: '2026-10-16', start: '2026-10-14', end: '2026-10-14' },
    { type: 'two', reference: '2026-10-20', holiday: '2026-10-16', start: '2026-10-15', end: '2026-10-16' },

    // 6º dia
    { type: 'six', reference: '2026-10-13', holiday: '2026-10-12', start: '2026-10-04', end: '2026-10-07' },
    { type: 'six', reference: '2026-10-12', holiday: '2026-10-13', start: '2026-10-04', end: '2026-10-06' },
    { type: 'six', reference: '2026-10-12', holiday: '2026-10-14', start: '2026-10-04', end: '2026-10-06' },
    { type: 'six', reference: '2026-10-15', holiday: '2026-10-14', start: '2026-10-08', end: '2026-10-09' },
    { type: 'six', reference: '2026-10-12', holiday: '2026-10-15', start: '2026-10-04', end: '2026-10-06' },
    // O exemplo de sexta-feira deve usar 16/10/2026; 15/10/2026 é quinta-feira.
    { type: 'six', reference: '2026-10-16', holiday: '2026-10-15', start: '2026-10-09', end: '2026-10-10' },
    { type: 'six', reference: '2026-10-12', holiday: '2026-10-16', start: '2026-10-04', end: '2026-10-06' },
    { type: 'six', reference: '2026-10-19', holiday: '2026-10-16', start: '2026-10-10', end: '2026-10-13' }
  ];

  scenarios.forEach(function (scenario) {
    const result = api.resolveHolidayWindow(
      scenario.type,
      parseDay(scenario.reference),
      [scenario.holiday]
    );
    assert.equal(result.status, 'matched',
      scenario.type + ', referência ' + scenario.reference + ', feriado ' + scenario.holiday);
    assert.equal(dayIso(result.start), scenario.start,
      'início para ' + scenario.type + ', referência ' + scenario.reference);
    assert.equal(dayIso(result.end), scenario.end,
      'fim para ' + scenario.type + ', referência ' + scenario.reference);
  });
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
