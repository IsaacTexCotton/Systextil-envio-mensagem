'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT = path.join(__dirname, '..', 'userscripts', 'systextil-crm-bridge.user.js');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

class ElementFake {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.textContent = '';
    this.value = '';
    this.maxLength = -1;
    this.disabled = false;
    this.readOnly = false;
    this.isConnected = true;
    this.ownerDocument = null;
    this.firstChild = null;
    this.eventos = [];
  }

  setAttribute(nome, valor) {
    this.attributes[nome] = String(valor);
  }

  appendChild(elemento) {
    elemento.ownerDocument = this.ownerDocument;
    this.children.push(elemento);
    this.firstChild ??= elemento;
    return elemento;
  }

  insertBefore(elemento) {
    elemento.ownerDocument = this.ownerDocument;
    this.children.unshift(elemento);
    this.firstChild = elemento;
    return elemento;
  }

  dispatchEvent(evento) {
    this.eventos.push(evento.type);
    return true;
  }
}

class ObserverFake {
  observe() {}
  disconnect() {}
}

function criarAmbiente({ href = 'https://systextil.texcotton.com.br/systextil/forms.crec.crec_f090', elementos = {}, valoresIniciais = {} } = {}) {
  const armazenamento = new Map(Object.entries(valoresIniciais));
  const listeners = new Map();
  const documento = {
    body: new ElementFake('body'),
    defaultView: null,
    listeners: new Map(),
    getElementById(id) {
      return elementos[id] || null;
    },
    createElement(tag) {
      const elemento = new ElementFake(tag);
      elemento.ownerDocument = documento;
      return elemento;
    },
    addEventListener(tipo, callback) {
      const atual = documento.listeners.get(tipo) || [];
      atual.push(callback);
      documento.listeners.set(tipo, atual);
    },
    dispatchEvent(evento) {
      for (const callback of documento.listeners.get(evento.type) || []) callback(evento);
      return true;
    },
  };

  const window = {
    location: { href },
    document: documento,
    CustomEvent: class CustomEventFake {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    Event: class EventFake {
      constructor(type, options = {}) {
        this.type = type;
        this.bubbles = options.bubbles === true;
      }
    },
    setTimeout,
    clearTimeout,
  };
  documento.defaultView = window;
  documento.body.ownerDocument = documento;

  const contexto = {
    window,
    document: documento,
    URL,
    URLSearchParams,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    MutationObserver: ObserverFake,
    setTimeout,
    clearTimeout,
    console: { warn() {}, error() {}, log() {} },
    async GM_getValue(chave, padrao) {
      return armazenamento.has(chave) ? armazenamento.get(chave) : padrao;
    },
    async GM_setValue(chave, valor) {
      const anterior = armazenamento.get(chave);
      armazenamento.set(chave, valor);
      for (const callback of listeners.get(chave) || []) callback(chave, anterior, valor, false);
    },
    GM_addValueChangeListener(chave, callback) {
      const atual = listeners.get(chave) || [];
      atual.push(callback);
      listeners.set(chave, atual);
      return atual.length;
    },
  };

  vm.runInNewContext(SOURCE, contexto, { filename: SCRIPT });
  return {
    window,
    document: documento,
    api: window.__crmSystextilBridgeDebug,
    armazenamento,
  };
}

function pedidoValido(overrides = {}) {
  return {
    schema: 1,
    id: 'pedido-12345678',
    createdAt: Date.now(),
    source: 'smarttable-crm',
    cnpj: '12345678000190',
    razaoSocial: 'EMPRESA TESTE LTDA',
    titulo: '00001234',
    parcela: '03',
    vencimento: '05/11/2026',
    saldo: 'R$ 150,00',
    diasAtraso: 2,
    situacao: 'EM_ATRASO',
    fluxo: 'CARTORIO',
    ...overrides,
  };
}

function criarPainel() {
  const painel = new ElementFake('section');
  painel.id = 'st-segunda-via-boleto-panel';
  const titulo = new ElementFake('input');
  titulo.id = 'st-segunda-via-numero-titulo';
  const parcela = new ElementFake('input');
  parcela.id = 'st-segunda-via-parcela';
  const botaoPreencher = new ElementFake('button');
  let cliques = 0;
  botaoPreencher.click = () => { cliques += 1; };
  const elementos = {
    'st-segunda-via-boleto-panel': painel,
    'st-segunda-via-numero-titulo': titulo,
    'st-segunda-via-parcela': parcela,
  };
  return { elementos, painel, titulo, parcela, botaoPreencher, cliques: () => cliques };
}

test('valida o contrato da transferência e preserva zeros à esquerda', () => {
  const ambiente = criarAmbiente();
  const pedido = ambiente.api.validarPedido(pedidoValido());
  assert.equal(pedido.titulo, '00001234');
  assert.equal(pedido.parcela, '03');
  assert.equal(pedido.cnpj, '12345678000190');
});

test('recusa pedido expirado, CNPJ incompleto e código com caracteres não permitidos', () => {
  const ambiente = criarAmbiente();
  assert.throws(
    () => ambiente.api.validarPedido(pedidoValido({ createdAt: Date.now() - 6 * 60 * 1000 })),
    /expirou/
  );
  assert.throws(
    () => ambiente.api.validarPedido(pedidoValido({ cnpj: '1234' })),
    /CNPJ/
  );
  assert.throws(
    () => ambiente.api.validarPedido(pedidoValido({ titulo: '12/34' })),
    /Número do título/
  );
  assert.throws(
    () => ambiente.api.validarPedido(pedidoValido({ source: 'outro' })),
    /origem/
  );
});

test('insere título e parcela somente nos campos auxiliares e não aciona o botão do ERP', () => {
  const fake = criarPainel();
  const ambiente = criarAmbiente({ elementos: fake.elementos });
  const resultado = ambiente.api.aplicarPedidoNoPainel(pedidoValido());

  assert.equal(resultado.titulo, '00001234');
  assert.equal(resultado.parcela, '03');
  assert.equal(fake.titulo.value, '00001234');
  assert.equal(fake.parcela.value, '03');
  assert.deepEqual(fake.titulo.eventos, ['input', 'change']);
  assert.deepEqual(fake.parcela.eventos, ['input', 'change']);
  assert.equal(fake.cliques(), 0);
  assert.equal(fake.painel.children.length, 1);
  assert.match(fake.painel.children[0].textContent, /EMPRESA TESTE LTDA/);
  assert.match(fake.painel.children[0].textContent, /12345678000190/);
});

test('bloqueia código maior que o maxLength e não altera nenhum campo', () => {
  const fake = criarPainel();
  fake.titulo.maxLength = 6;
  const ambiente = criarAmbiente({ elementos: fake.elementos });

  assert.throws(
    () => ambiente.api.aplicarPedidoNoPainel(pedidoValido()),
    /aceita no máximo/
  );
  assert.equal(fake.titulo.value, '');
  assert.equal(fake.parcela.value, '');
});

test('não altera o ERP quando o painel ou um dos campos auxiliares não existe', () => {
  const ambiente = criarAmbiente();
  assert.throws(
    () => ambiente.api.aplicarPedidoNoPainel(pedidoValido()),
    /painel de segunda via não está aberto/
  );

  const fake = criarPainel();
  delete fake.elementos['st-segunda-via-parcela'];
  const parcial = criarAmbiente({ elementos: fake.elementos });
  assert.throws(
    () => parcial.api.aplicarPedidoNoPainel(pedidoValido()),
    /campos auxiliares/
  );
});

test('a aba do CRM guarda o pedido e publica somente confirmação sem dados pessoais', async () => {
  const ambiente = criarAmbiente({
    href: 'https://texhub.texcotton.com.br/crm/clientes?cnpj=12345678000190'
  });
  let resultadoEvento = null;
  ambiente.document.addEventListener('smarttable:systextil:resultado', (evento) => {
    resultadoEvento = JSON.parse(evento.detail);
  });

  ambiente.document.dispatchEvent(new ambiente.window.CustomEvent(
    'smarttable:systextil:enviar-titulo',
    { detail: JSON.stringify(pedidoValido()) }
  ));
  await new Promise((resolver) => setTimeout(resolver, 10));

  const pedidoSalvo = ambiente.armazenamento.get(ambiente.api.CHAVES.pedido);
  const resultado = ambiente.armazenamento.get(ambiente.api.CHAVES.resultado);
  assert.equal(pedidoSalvo.titulo, '00001234');
  assert.equal(pedidoSalvo.parcela, '03');
  assert.equal(resultado.status, 'aguardando');
  assert.equal(Object.hasOwn(resultado, 'cnpj'), false);
  assert.equal(Object.hasOwn(resultado, 'titulo'), false);
  assert.equal(resultadoEvento.id, 'pedido-12345678');
  assert.equal(resultadoEvento.status, 'aguardando');
});

test('a aba do Systextil publica evento somente após confirmar título e parcela nos campos auxiliares', async () => {
  const fake = criarPainel();
  const pedido = pedidoValido();
  const ambiente = criarAmbiente({
    elementos: fake.elementos,
    valoresIniciais: {
      'smarttable.systextil.title-transfer.v1.pedido': pedido,
    },
  });
  let pedidoAplicado = null;
  ambiente.document.addEventListener('smarttable:systextil:pedido-aplicado', (evento) => {
    pedidoAplicado = JSON.parse(evento.detail);
  });

  await new Promise((resolver) => setTimeout(resolver, 250));

  assert.equal(fake.titulo.value, '00001234');
  assert.equal(fake.parcela.value, '03');
  assert.equal(ambiente.armazenamento.get(ambiente.api.CHAVES.pedido), null);
  assert.equal(ambiente.armazenamento.get(ambiente.api.CHAVES.resultado).status, 'preenchido');
  assert.deepEqual(pedidoAplicado, {
    id: 'pedido-12345678',
    titulo: '00001234',
    parcela: '03',
    razaoSocial: 'EMPRESA TESTE LTDA',
  });
  assert.equal(fake.painel.children[0].dataset.pedidoId, 'pedido-12345678');
  assert.equal(fake.painel.children[0].dataset.titulo, '00001234');
  assert.equal(fake.painel.children[0].dataset.parcela, '03');
});
