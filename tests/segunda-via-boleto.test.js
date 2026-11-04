'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(
  __dirname,
  '..',
  'userscripts',
  'systextil-segunda-via-boleto.user.js'
);
const source = fs.readFileSync(scriptPath, 'utf8');

function carregarApi() {
  const document = {
    body: null,
    forms: [],
    addEventListener() {},
    getElementById() {}
  };

  const window = { document, console };
  window.top = window;

  vm.runInNewContext(
    source,
    { window, document, console, Object, Array, String },
    { filename: scriptPath }
  );

  assert.ok(window.__systextilSegundaViaBoletoDebug);
  return window.__systextilSegundaViaBoletoDebug;
}

test('userscript usa execução sob demanda pelo menu do Tampermonkey', () => {
  assert.match(source, /^\/\/ @run-at\s+context-menu$/m);

  const api = carregarApi();
  assert.equal(api.version, '0.1.3');
});

test('registra o atalho Ctrl+Alt+B para alternar a conferência', () => {
  assert.match(source, /event\.ctrlKey/);
  assert.match(source, /event\.altKey/);
  assert.match(source, /Ctrl \+ Alt \+ B/);
  assert.match(source, /window\\.addEventListener\\("keydown"/);
  assert.match(source, /event\\.stopImmediatePropagation\\(\\)/);
});

test('identifica os nomes de campos mapeados', () => {
  const api = carregarApi();

  assert.equal(api.fieldNames.titulo, 'num_duplicata.');
  assert.equal(api.fieldNames.parcela, 'seq_duplicatas.');
  assert.equal(api.fieldNames.cliente, 'nome_cliente.');
});

test('monta o nome no padrão Cliente - Título.Parcela.pdf', () => {
  const api = carregarApi();

  assert.equal(
    api.montarNomeArquivo({
      cliente: 'Joaozin da silva',
      titulo: '936312',
      parcela: '01'
    }),
    'Joaozin da silva - 936312.01.pdf'
  );
});

test('limita o início da razão social a palavras inteiras e indica o corte', () => {
  const api = carregarApi();
  const razaoSocial = 'Confecções Industriais e Comércio de Tecidos Ltda.';

  assert.equal(
    api.limitarInicioRazaoSocial(razaoSocial),
    'Confecções Industriais e Comércio…'
  );

  assert.equal(
    api.montarNomeArquivo({
      cliente: razaoSocial,
      titulo: '936312',
      parcela: '01'
    }),
    'Confecções Industriais e Comércio… - 936312.01.pdf'
  );
});

test('remove caracteres inválidos do Windows do componente cliente', () => {
  const api = carregarApi();

  assert.equal(
    api.montarNomeArquivo({
      cliente: 'Empresa: Norte/Filial? *',
      titulo: '123456',
      parcela: '02'
    }),
    'Empresa Norte Filial - 123456.02.pdf'
  );
});

test('preserva acentos e caracteres Unicode válidos', () => {
  const api = carregarApi();

  assert.equal(
    api.montarNomeArquivo({
      cliente: 'Confecções São João Ltda.',
      titulo: '123',
      parcela: '01'
    }),
    'Confecções São João Ltda - 123.01.pdf'
  );
});

test('rejeita dados obrigatórios ausentes ou com formato inesperado', () => {
  const api = carregarApi();

  assert.throws(
    () => api.montarNomeArquivo({
      cliente: '',
      titulo: '123',
      parcela: '01'
    }),
    /Nome do cliente/
  );

  assert.throws(
    () => api.montarNomeArquivo({
      cliente: 'Cliente',
      titulo: '../123',
      parcela: '01'
    }),
    /Número do título/
  );

  assert.throws(
    () => api.montarNomeArquivo({
      cliente: 'Cliente',
      titulo: '123',
      parcela: ''
    }),
    /Parcela/
  );
});

test('limita o comprimento do nome de arquivo', () => {
  const api = carregarApi();

  const nome = api.montarNomeArquivo({
    cliente: 'A'.repeat(250),
    titulo: '936312',
    parcela: '01'
  });

  assert.ok(Array.from(nome).length <= 180);
  assert.ok(nome.endsWith(' - 936312.01.pdf'));
});
