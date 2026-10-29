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

test('API de cálculo não executa a consulta nem preenche campos', function () {
  const api = calculator();
  const result = api.calculate(date(2026, 10, 28));
  assert.equal(Object.keys(result.values).length, 10);
});
