'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SCRIPT_PATH = path.join(
  __dirname,
  '..',
  'userscripts',
  'systextil-construtor-automacoes.user.js'
);
const SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');
const api = require(SCRIPT_PATH);

function receitaValida(overrides = {}) {
  return {
    schema: 1,
    id: 'consulta-titulos-abc123',
    nome: 'Consulta de títulos',
    descricao: 'Leitura de campos já carregados na tela.',
    visao: 'forms.crec.crec_f090',
    campos: ['num_duplicata.', 'seq_duplicatas.', 'nome_cliente.'],
    criadaEm: 1_800_000_000_000,
    atualizadaEm: 1_800_000_000_100,
    ...overrides
  };
}

test('expõe uma versão independente e uma API de validação para testes', () => {
  assert.equal(api.VERSION, '0.1.0');
  assert.equal(typeof api.validarReceita, 'function');
  assert.equal(typeof api.validarColecaoReceitas, 'function');
  assert.equal(typeof api.gerarCsv, 'function');
});

test('valida e normaliza os campos declarativos de uma receita', () => {
  const receita = api.validarReceita(receitaValida({
    propriedadeDesconhecida: 'não deve ser preservada',
    codigo: 'alert(1)',
    passos: [{ tipo: 'executar-codigo', codigo: 'alert(1)' }]
  }));

  assert.equal(receita.id, 'consulta-titulos-abc123');
  assert.equal(receita.visao, 'forms.crec.crec_f090');
  assert.deepEqual(receita.campos, [
    'num_duplicata.',
    'seq_duplicatas.',
    'nome_cliente.'
  ]);
  assert.equal(Object.hasOwn(receita, 'codigo'), false);
  assert.equal(Object.hasOwn(receita, 'passos'), false);
  assert.equal(Object.hasOwn(receita, 'propriedadeDesconhecida'), false);
});

test('rejeita receita sem campos, com nomes de campo inválidos ou campos duplicados', () => {
  assert.throws(
    () => api.validarReceita(receitaValida({ campos: [] })),
    /de 1 a 30 campos/
  );
  assert.throws(
    () => api.validarReceita(receitaValida({ campos: ['nome do cliente'] })),
    /nome de campo inválido/
  );
  assert.throws(
    () => api.validarReceita(receitaValida({ campos: ['nome_cliente.', 'nome_cliente.'] })),
    /não pode repetir campos/
  );
  assert.throws(
    () => api.validarReceita(receitaValida({ id: '../receita' })),
    /Identificador.*inválido/
  );
  assert.throws(
    () => api.validarReceita(receitaValida({ visao: 'forms.crec;other' })),
    /visão inválido/
  );
});

test('valida a coleção e bloqueia identificadores repetidos', () => {
  assert.equal(api.validarColecaoReceitas([receitaValida()]).length, 1);
  assert.throws(
    () => api.validarColecaoReceitas([receitaValida(), receitaValida()]),
    /identificadores.*repetidos/
  );
  assert.throws(
    () => api.validarColecaoReceitas({ receitas: [] }),
    /lista de receitas/
  );
});

test('gera CSV UTF-8 com separador ponto e vírgula e escapa valores', () => {
  const csv = api.gerarCsv(
    ['nome_cliente.', 'observacao.'],
    {
      'nome_cliente.': 'EMPRESA "TESTE"',
      'observacao.': 'A; B'
    }
  );

  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"nome_cliente\.";\"observacao\.\"/);
  assert.match(csv, /"EMPRESA ""TESTE""";"A; B"/);
});

test('neutraliza fórmulas em células do CSV', () => {
  assert.equal(api.escaparValorCsv('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(api.escaparValorCsv('  @SUM(A1)'), '"\'  @SUM(A1)"');
  assert.equal(api.escaparValorCsv('texto normal'), '"texto normal"');
});

test('cria nomes de arquivo sem caracteres problemáticos', () => {
  assert.equal(api.criarNomeArquivo('Consulta de títulos / SC', 'csv'), 'Consulta-de-titulos-SC.csv');
  assert.equal(api.criarNomeArquivo('', 'json'), 'automacao.json');
});

test('o userscript é independente e não injeta permissões de rede', () => {
  assert.match(SOURCE, /@name\s+Systextil — Construtor de Automações/);
  assert.match(SOURCE, /@match\s+https:\/\/systextil\.texcotton\.com\.br\/systextil\//);
  assert.match(SOURCE, /@noframes/);
  assert.doesNotMatch(SOURCE, /@connect\b/);
  assert.doesNotMatch(SOURCE, /@require\b/);
});

test('não executa código arbitrário nem simula atalhos de gravação do ERP', () => {
  assert.doesNotMatch(SOURCE, /\beval\s*\(/);
  assert.doesNotMatch(SOURCE, /\bnew\s+Function\s*\(/);
  assert.doesNotMatch(SOURCE, /KeyboardEvent|key:\s*["']F[79]["']/);
  assert.doesNotMatch(SOURCE, /ADD_UPDATE|DELETE_RECORD|SAVEANDCLOSE|CLEAR_TO_ADD/);
});

test('a captura é somente leitura e não envia comandos Find ou F7', () => {
  const inicio = SOURCE.indexOf('function capturarDados()');
  const fim = SOURCE.indexOf('function excluirReceita()', inicio);
  const trecho = SOURCE.slice(inicio, fim);

  assert.ok(inicio >= 0 && fim > inicio);
  assert.match(trecho, /lerCampo\(formulario, nome\)/);
  assert.doesNotMatch(trecho, /\.click\s*\(/);
  assert.doesNotMatch(trecho, /btnFind|F7|UnifyNXJ/);
});

test('inspeção só habilita controles escalares e bloqueia campos desabilitados', () => {
  const inicio = SOURCE.indexOf('function campoTemValorSimples');
  const fim = SOURCE.indexOf('function catalogarFormulario', inicio);
  const trecho = SOURCE.slice(inicio, fim);

  assert.ok(inicio >= 0 && fim > inicio);
  assert.match(trecho, /\["", "text", "search", "number", "date"/);
  assert.doesNotMatch(trecho, /password|checkbox|radio|hidden|file/);
  assert.match(SOURCE, /checkbox\.disabled = campo\.ocorrencias !== 1 \|\| !campo\.legivel \|\| campo\.desabilitado/);
});

test('não armazena valores capturados nas receitas persistidas', () => {
  const inicio = SOURCE.indexOf('function salvarReceitas(');
  const fim = SOURCE.indexOf('function baixarArquivo(', inicio);
  const trecho = SOURCE.slice(inicio, fim);

  assert.ok(inicio >= 0 && fim > inicio);
  assert.match(trecho, /JSON\.stringify\(validadas\)/);
  assert.doesNotMatch(trecho, /ultimoResultado|registro\[|lerCampo/);
});