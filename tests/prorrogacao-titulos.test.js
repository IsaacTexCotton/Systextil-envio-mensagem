'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const api = require(path.join(
  __dirname,
  '..',
  'userscripts',
  'systextil-prorrogacao-titulos.user.js'
));

test('monta Compl.hist no formato operacional com motivo e autorização', () => {
  assert.equal(
    api.montarComplementoHistorico({
      data: '09/11/2026',
      motivo: 'PEDIDO CLIENTE',
      autorizacao: 'GISELA',
      executor: 'IT'
    }),
    '09/11/2026 - PEDIDO CLIENTE - PRORROG - AUT GISELA - IT'
  );
});

test('monta Compl.hist sem motivo e sem autorização', () => {
  assert.equal(
    api.montarComplementoHistorico({
      data: '2026-11-09',
      motivo: '',
      autorizacao: '',
      executor: 'AB'
    }),
    '09/11/2026 - PRORROG - AB'
  );
});

test('rejeita data inexistente e formatos ambíguos', () => {
  assert.throws(() => api.validarData('31/02/2026'), /não existe/);
  assert.throws(() => api.validarData('11-09-2026'), /DD\/MM\/AAAA/);
  assert.equal(api.validarData('2026-11-09'), '09/11/2026');
});

test('exige sigla do executor e valida siglas opcionais', () => {
  assert.throws(
    () => api.montarComplementoHistorico({ data: '09/11/2026', executor: '' }),
    /executor/i
  );
  assert.throws(
    () => api.montarComplementoHistorico({
      data: '09/11/2026',
      executor: 'IT',
      autorizacao: 'SIGLA COM ESPAÇO'
    }),
    /autorização/i
  );
});

test('não trunca Compl.hist acima dos 60 caracteres', () => {
  const texto = api.montarComplementoHistorico({
    data: '09/11/2026',
    motivo: 'SOLICITACAO CLIENTE',
    autorizacao: 'GISELA',
    executor: 'IT'
  });
  assert.ok(texto.length <= 60);
  assert.throws(
    () => api.montarComplementoHistorico({
      data: '09/11/2026',
      motivo: 'MOTIVO MUITO LONGO '.repeat(5),
      executor: 'IT'
    }),
    /excede 60 caracteres/
  );
});

test('analisa lote com data comum e data específica por linha', () => {
  const itens = api.analisarLote(
    '00012345;03\n00012346;01;15/11/2026',
    '2026-11-10',
    { motivo: 'PEDIDO CLIENTE', autorizacao: 'AB', executor: 'IT' }
  );

  assert.equal(itens.length, 2);
  assert.equal(itens[0].data, '10/11/2026');
  assert.equal(itens[1].data, '15/11/2026');
  assert.equal(itens[0].historico, '10/11/2026 - PEDIDO CLIENTE - PRORROG - AUT AB - IT');
});

test('permite data por linha sem data comum', () => {
  const itens = api.analisarLote(
    '00012345;03;12/11/2026',
    '',
    { executor: 'IT' }
  );
  assert.equal(itens[0].data, '12/11/2026');
});

test('rejeita linhas malformadas e data ausente', () => {
  assert.throws(
    () => api.analisarLote('00012345', '09/11/2026', { executor: 'IT' }),
    /use TITULO;PARCELA/
  );
  assert.throws(
    () => api.analisarLote('00012345;03', '', { executor: 'IT' }),
    /informe uma data/
  );
});

test('rejeita identificadores inválidos e duplicidade no lote', () => {
  assert.throws(
    () => api.analisarLote('0001234567;03;09/11/2026', '', { executor: 'IT' }),
    /excede o limite/
  );
  assert.throws(
    () => api.analisarLote(
      '00012345;03;09/11/2026\n12345;03;10/11/2026',
      '',
      { executor: 'IT' }
    ),
    /repetido/
  );
});

test('seleciona a linha pela parcela e não pela posição atual', () => {
  const selecionada = api.selecionarLinhaPorParcela([
    { indice: 0, sequencia: '01' },
    { indice: 1, sequencia: '03' },
    { indice: 2, sequencia: '04' }
  ], '03');

  assert.equal(selecionada.indice, 1);
});

test('bloqueia parcela ausente ou repetida na grade', () => {
  assert.throws(
    () => api.selecionarLinhaPorParcela([{ indice: 0, sequencia: '01' }], '03'),
    /não foi encontrada/
  );
  assert.throws(
    () => api.selecionarLinhaPorParcela([
      { indice: 0, sequencia: '03' },
      { indice: 1, sequencia: '03' }
    ], '03'),
    /mais de uma vez/
  );
});

test('erro de gravação indeterminada mantém marcador explícito', () => {
  const erro = api.criarErroIndeterminado('Não repetir F9.', 'COMANDO_TIMEOUT');
  assert.equal(erro.indeterminado, true);
  assert.equal(erro.code, 'COMANDO_TIMEOUT');
});


test('usa largura comprovada da sonda quando maxLength é -1', () => {
  assert.equal(api.obterLimiteCampo(-1, 9), 9);
  assert.equal(api.obterLimiteCampo(-1, 2), 2);
});

test('respeita maxLength positivo ou zero declarado na tela', () => {
  assert.equal(api.obterLimiteCampo(5, 9), 5);
  assert.equal(api.obterLimiteCampo(9, 9), 9);
  assert.equal(api.obterLimiteCampo(0, 9), 0);
});


test('localiza controle por ID em documento de frame same-origin', () => {
  const controle = { id: 'btnFind.', click() {} };
  const documentoRaiz = { getElementById: () => null };
  const documentoFrame = { getElementById: id => id === 'btnFind.' ? controle : null };

  assert.equal(
    api.encontrarElementoPorId([documentoRaiz, documentoFrame], 'btnFind.'),
    controle
  );
});

test('bloqueia controle ausente ou duplicado entre documentos', () => {
  assert.throws(
    () => api.encontrarElementoPorId([{ getElementById: () => null }], 'btnFind.'),
    /não encontrado/
  );

  const primeiro = { id: 'btnFind.' };
  const segundo = { id: 'btnFind.' };
  assert.throws(
    () => api.encontrarElementoPorId([
      { getElementById: () => primeiro },
      { getElementById: () => segundo }
    ], 'btnFind.'),
    /duplicado/
  );
});

test('coleta documentos da janela principal e dos frames same-origin', () => {
  const docRaiz = {};
  const docFilho = {};
  const filho = { document: docFilho, frames: [] };
  const raiz = { document: docRaiz, frames: [filho] };

  assert.deepEqual(api.coletarDocumentosMesmoDominio(raiz), [docRaiz, docFilho]);
});

test('monitora comandos NXJ iniciados na janela principal e em frame', async () => {
  function criarClasseFakeXHR() {
    return class FakeXHR {
      constructor() {
        this.listeners = {};
        this.status = 0;
      }
      open(metodo, url) {
        this.metodo = metodo;
        this.url = url;
      }
      addEventListener(nome, callback) {
        this.listeners[nome] = callback;
      }
      send() {
        this.status = 200;
        this.listeners.loadend?.();
      }
    };
  }

  const frame = {
    document: {},
    frames: [],
    URLSearchParams,
    XMLHttpRequest: criarClasseFakeXHR()
  };
  const raiz = {
    document: {},
    frames: [frame],
    URLSearchParams,
    XMLHttpRequest: criarClasseFakeXHR()
  };

  const monitor = api.criarMonitorNxj(raiz);
  try {
    const xhrRaiz = new raiz.XMLHttpRequest();
    xhrRaiz.open('POST', '/systextil/UnifyNXJ.jsp');
    xhrRaiz.send('commandName=CLEAR_TO_FIND&fieldValues=');
    await monitor.aguardarComando('CLEAR_TO_FIND', 0, 3000);

    const xhrFrame = new frame.XMLHttpRequest();
    xhrFrame.open('POST', '/systextil/UnifyNXJ.jsp');
    xhrFrame.send('commandName=FIND&fieldValues=');
    await monitor.aguardarComando('FIND', 1, 3000);

    assert.equal(monitor.obterSequencia(), 2);
  } finally {
    monitor.remover();
  }
});
