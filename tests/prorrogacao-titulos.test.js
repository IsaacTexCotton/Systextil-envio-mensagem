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
      dataAtual: new Date(2026, 10, 9),
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
      dataAtual: new Date(2026, 10, 9),
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
    () => api.montarComplementoHistorico({ dataAtual: new Date(2026, 10, 9), executor: '' }),
    /executor/i
  );
  assert.throws(
    () => api.montarComplementoHistorico({
      dataAtual: new Date(2026, 10, 9),
      executor: 'IT',
      autorizacao: 'SIGLA COM ESPAÇO'
    }),
    /autorização/i
  );
});

test('não trunca Compl.hist acima dos 60 caracteres', () => {
  const texto = api.montarComplementoHistorico({
    dataAtual: new Date(2026, 10, 9),
    motivo: 'SOLICITACAO CLIENTE',
    autorizacao: 'GISELA',
    executor: 'IT'
  });
  assert.ok(texto.length <= 60);
  assert.throws(
    () => api.montarComplementoHistorico({
      dataAtual: new Date(2026, 10, 9),
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
    { motivo: 'PEDIDO CLIENTE', autorizacao: 'AB', executor: 'IT' },
    new Date(2026, 10, 9)
  );

  assert.equal(itens.length, 2);
  assert.equal(itens[0].data, '10/11/2026');
  assert.equal(itens[1].data, '15/11/2026');
  assert.equal(itens[0].historico, '09/11/2026 - PEDIDO CLIENTE - PRORROG - AUT AB - IT');
  assert.equal(itens[1].historico, '09/11/2026 - PEDIDO CLIENTE - PRORROG - AUT AB - IT');
});

test('permite data por linha sem data comum', () => {
  const itens = api.analisarLote(
    '00012345;03;12/11/2026',
    '',
    { executor: 'IT' },
    new Date(2026, 10, 9)
  );
  assert.equal(itens[0].data, '12/11/2026');
  assert.equal(itens[0].historico, '09/11/2026 - PRORROG - IT');
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


test('aceita confirmação NXJ no blur quando ADD_UPDATE não repete fieldValues', () => {
  const historico = '09/11/2026 - PEDIDO CLIENTE - PRORROG - IT';
  const confirmacao = {
    valor: historico,
    comando: 'NEXT_FIELD',
    sequencia: 7,
    finalizado: true,
    falhaMonitoramento: false,
    status: 200,
    segmentos: [historico]
  };

  assert.deepEqual(
    api.valoresNaoConfirmados({ segmentos: [] }, [historico], [confirmacao]),
    []
  );
});

test('continua exigindo confirmação quando payload e comando de saída não contêm o valor', () => {
  const historico = '09/11/2026 - PRORROG - IT';
  assert.deepEqual(
    api.valoresNaoConfirmados(
      { segmentos: ['outro valor'] },
      [historico],
      []
    ),
    [historico]
  );
});

test('não aceita confirmação de campo com comando ou resposta NXJ inválidos', () => {
  const historico = '09/11/2026 - PRORROG - IT';
  const base = {
    valor: historico,
    sequencia: 7,
    finalizado: true,
    falhaMonitoramento: false,
    segmentos: [historico]
  };

  for (const confirmacao of [
    { ...base, comando: 'DELETE_RECORD', status: 200 },
    { ...base, comando: 'NEXT_FIELD', status: 500 },
    { ...base, comando: 'NEXT_FIELD', status: 200, falhaMonitoramento: true }
  ]) {
    assert.deepEqual(
      api.valoresNaoConfirmados({ segmentos: [] }, [historico], [confirmacao]),
      [historico]
    );
  }
});

test('continua aceitando o valor quando o próprio ADD_UPDATE o contém', () => {
  const historico = '09/11/2026 - PRORROG - IT';
  assert.deepEqual(
    api.valoresNaoConfirmados({ segmentos: [historico] }, [historico], []),
    []
  );
});

test('mapeia Tab para o código de tecla 9 sem alterar atalhos existentes', () => {
  assert.equal(api.obterCodigoTecla('Tab'), 9);
  assert.equal(api.obterCodigoTecla('F1'), 112);
  assert.equal(api.obterCodigoTecla('F2'), 113);
  assert.equal(api.obterCodigoTecla('F9'), 120);
  assert.throws(() => api.obterCodigoTecla('F7'), /não autorizado/);
});

test('gera resumo NXJ com comando, status e correspondência sem expor valores', async () => {
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
      send(body) {
        this.body = body;
        this.status = 200;
        this.listeners.loadend?.();
      }
    };
  }

  const janela = {
    document: {},
    frames: [],
    URLSearchParams,
    XMLHttpRequest: criarClasseFakeXHR()
  };
  const monitor = api.criarMonitorNxj(janela);
  const valorPrivado = 'HISTORICO-FAKE-QUE-NAO-DEVE-APARECER';

  try {
    const sequenciaInicial = monitor.obterSequencia();
    const parametros = new URLSearchParams();
    parametros.append('commandName', 'NEXT_FIELD');
    parametros.append('fieldValues', valorPrivado);

    const xhr = new janela.XMLHttpRequest();
    xhr.open('POST', '/systextil/UnifyNXJ.jsp');
    xhr.send(parametros);
    await monitor.aguardarOcioso(3000);

    const resumo = monitor.obterResumo(sequenciaInicial, valorPrivado);
    assert.ok(resumo.includes('NEXT_FIELD[1:'));
    assert.ok(resumo.includes(';HTTP 200;valor=sim'));
    assert.ok(!resumo.includes(valorPrivado));
  } finally {
    monitor.remover();
  }
});

test('modo de teste bloqueia F9 diretamente no despacho de teclas', () => {
  assert.throws(
    () => api.exigirF9Permitido(true),
    /modo de teste não permite executar F9/
  );
  assert.throws(
    () => api.obterCodigoTeclaComModo('F9', true),
    /modo de teste não permite executar F9/
  );
  assert.equal(api.obterCodigoTeclaComModo('F9', false), 120);
  assert.equal(api.obterCodigoTeclaComModo('F2', true), 113);
  assert.equal(api.exigirF9Permitido(false), true);
});

test('modo de teste aceita somente um título/parcela por execução', () => {
  assert.equal(api.validarQuantidadeItensModoTeste(false, 3), true);
  assert.equal(api.validarQuantidadeItensModoTeste(true, 1), true);
  assert.throws(
    () => api.validarQuantidadeItensModoTeste(true, 2),
    /somente um título\/parcela/
  );
  assert.throws(
    () => api.validarQuantidadeItensModoTeste(true, 0),
    /somente um título\/parcela/
  );
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

test('formata a data atual pelo calendário local do navegador', () => {
  assert.equal(api.formatarDataLocal(new Date(2026, 10, 9)), '09/11/2026');
  assert.throws(() => api.formatarDataLocal(new Date('invalid')), /data atual/i);
});

test('retorna confirmação NXJ do campo com comando, valor e status', async () => {
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
      send(body) {
        this.body = body;
        this.status = 200;
        this.listeners.loadend?.();
      }
    };
  }

  const janela = {
    document: {},
    frames: [],
    URLSearchParams,
    XMLHttpRequest: criarClasseFakeXHR()
  };
  const monitor = api.criarMonitorNxj(janela);
  const historico = '09/11/2026 - PRORROG - IT';

  try {
    const sequenciaInicial = monitor.obterSequencia();
    const parametros = new URLSearchParams();
    parametros.append('commandName', 'NEXT_FIELD');
    parametros.append('fieldValues', historico);

    const xhr = new janela.XMLHttpRequest();
    xhr.open('POST', '/systextil/UnifyNXJ.jsp');
    xhr.send(parametros);

    const confirmacao = await monitor.aguardarConfirmacaoCampo(
      historico,
      sequenciaInicial,
      3000
    );

    assert.equal(confirmacao.valor, historico);
    assert.equal(confirmacao.comando, 'NEXT_FIELD');
    assert.equal(confirmacao.status, 200);
    assert.deepEqual(confirmacao.segmentos, [historico]);
  } finally {
    monitor.remover();
  }
});

test('captura todas as entradas repetidas de fieldValues no NXJ', async () => {
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
      send(body) {
        this.status = 200;
        this.body = body;
        this.listeners.loadend?.();
      }
    };
  }

  const janela = {
    document: {},
    frames: [],
    URLSearchParams,
    XMLHttpRequest: criarClasseFakeXHR()
  };
  const monitor = api.criarMonitorNxj(janela);

  try {
    const parametros = new URLSearchParams();
    parametros.append('commandName', 'ADD_UPDATE');
    parametros.append('fieldValues', '09/11/2026 - PRORROG - IT');
    parametros.append('fieldValues', '26/11/2026');
    parametros.append('fieldValues', '01');

    const xhr = new janela.XMLHttpRequest();
    xhr.open('POST', '/systextil/UnifyNXJ.jsp');
    xhr.send(parametros);

    const registro = await monitor.aguardarComando('ADD_UPDATE', 0, 3000);
    assert.deepEqual(registro.segmentos, [
      '09/11/2026 - PRORROG - IT',
      '26/11/2026',
      '01'
    ]);
  } finally {
    monitor.remover();
  }
});

test('captura todas as entradas repetidas de fieldValues em FormData', async () => {
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
      send(body) {
        this.status = 200;
        this.listeners.loadend?.();
      }
    };
  }

  const janela = {
    document: {},
    frames: [],
    URLSearchParams,
    XMLHttpRequest: criarClasseFakeXHR()
  };
  const monitor = api.criarMonitorNxj(janela);

  try {
    const formulario = new FormData();
    formulario.append('commandName', 'ADD_UPDATE');
    formulario.append('fieldValues', 'COMPL HIST');
    formulario.append('fieldValues', 'DATA PRORROG');
    formulario.append('fieldValues', 'MOTIVO');

    const xhr = new janela.XMLHttpRequest();
    xhr.open('POST', '/systextil/UnifyNXJ.jsp');
    xhr.send(formulario);

    const registro = await monitor.aguardarComando('ADD_UPDATE', 0, 3000);
    assert.deepEqual(registro.segmentos, ['COMPL HIST', 'DATA PRORROG', 'MOTIVO']);
  } finally {
    monitor.remover();
  }
});
