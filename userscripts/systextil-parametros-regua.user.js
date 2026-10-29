// ==UserScript==
// @name         Systextil — Parâmetros da Régua de Cobrança
// @namespace    https://texcotton.com.br/tampermonkey
// @version      0.1.0
// @description  Calcula e tenta preencher os parâmetros de datas da régua de cobrança no Systextil.
// @match        http://systextil.texcotton.com.br/systextil/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // A interface é instalada somente no documento principal. A busca por campos
  // percorre iframes same-origin para suportar formulários legados do Systextil.
  if (window.top !== window) return;
  if (window.__systextilParametrosReguaCarregado) return;
  window.__systextilParametrosReguaCarregado = true;

  const CONFIG = {
    // Feriados nacionais fixos. Os feriados móveis são calculados abaixo.
    // As datas locais/“emenda” citadas na planilha ficam desativadas até serem confirmadas.
    FERIADOS_ADICIONAIS: [
      // '2026-06-05', // confirmar: emenda/feriado local?
      // '2026-09-02', // confirmar: feriado local?
    ],
    // Quantos dias para trás procurar vencimentos cujo prazo do 6º dia cai na data de referência.
    BUSCA_REVERSA_DIAS: 45,
    ID_PAINEL: 'st-regua-parametros-panel',
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
    { key: 'fim18', label: 'Fim 18 Dias', target: 'fim 18 dias' },
  ];

  function localNoon(date) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  function parseIso(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!match) return null;
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    return d.getFullYear() === Number(match[1]) && d.getMonth() === Number(match[2]) - 1 && d.getDate() === Number(match[3]) ? d : null;
  }

  function iso(date) {
    const d = localNoon(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function br(date) {
    if (!date) return '—';
    const d = localNoon(date);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  function addDays(date, amount) {
    const d = localNoon(date);
    d.setDate(d.getDate() + amount);
    return localNoon(d);
  }

  function easterSunday(year) {
    // Meeus/Jones/Butcher (calendário gregoriano).
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
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function holidaysForYear(year) {
    const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'];
    const dates = fixed.map(md => `${year}-${md}`);
    if (year >= 2024) dates.push(`${year}-11-20`); // Consciência Negra
    const easter = easterSunday(year);
    dates.push(iso(addDays(easter, -48))); // Carnaval (segunda)
    dates.push(iso(addDays(easter, -47))); // Carnaval (terça)
    dates.push(iso(addDays(easter, -2)));  // Sexta-feira Santa
    dates.push(iso(addDays(easter, 60)));  // Corpus Christi
