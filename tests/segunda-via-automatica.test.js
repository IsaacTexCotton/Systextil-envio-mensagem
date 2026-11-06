'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const scriptPath = path.join(__dirname, '..', 'userscripts', 'systextil-segunda-via-automatica.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const { criarOrquestrador } = require(scriptPath);

function criarAmbiente(overrides = {}) {
  let agora = 1_800_000_000_000;
  let estado = { visao: 'forms.crec.crec_f090', busca: true, acao: '', total: 0, atual: 0 };
  const camposEntrada = { titulo: '00012345', parcela: '03' };
  const camposResultado = { titulo: '00012345', parcela: '03', cliente: 'CLIENTE TESTE LTDA' };
  const storage = new Map();
  let emissaoCount = 0;
  let findCount = 0;
  let preenchimentoCount = 0;
  const deps = {
    agora: () => agora,
    pausa: async () => { agora += 1; },
    cancelado: () => false,
    status: () => {},
    lerEstado: () => ({ ...estado }),
    lerCampos: () => ({ ...camposResultado }),
    lerCamposEntrada: () => ({ ...camposEntrada }),
    clicarBarra: (acao) => {
      if (acao === 'buscar') {
        findCount += 1;
        estado = { visao: 'forms.crec.crec_f090', busca: false, acao: 'RECORDS_FOUND', total: 1, atual: 1 };
      }
      if (acao === 'limpar') estado.busca = true;
    },
    aguardarOcioso: async () => {},
    preencher: async (titulo, parcela) => {
      preenchimentoCount += 1;
      if (overrides.onPreencher) overrides.onPreencher(titulo, parcela, camposEntrada);
      return { ok: true, texto: 'confirmados pelos comandos NXJ' };
    },
    emitir: async () => {
      emissaoCount += 1;
      return { registrado: true, texto: 'Horário da solicitação registrado' };
    },
    recuperarSolicitacao: () => ({ titulo: '00012345', parcela: '03', solicitadoEm: agora }),
    analisar: async () => ({ texto: 'Processo concluído com sucesso.' }),
    baixar: async () => ({ texto: 'PDF salvo na pasta configurada do auxiliar' }),
    atualizarGrade: async () => {},
    armazenamento: {
      getItem: (chave) => storage.get(chave) ?? null,
      setItem: (chave, valor) => storage.set(chave, valor),
      removeItem: (chave) => storage.delete(chave),
    },
  };
  Object.assign(deps, overrides.deps || {});
  return {
    orquestrador: criarOrquestrador(deps),
    camposEntrada,
    storage,
    contagens: () => ({ emissaoCount, findCount, preenchimentoCount }),
    definirEstado: (valor) => { estado = { ...valor }; },
  };
}

test('inicializa em document-idle e consome evento confirmado da ponte', () => {
  assert.match(source, /^\/\/ @run-at\s+document-idle$/m);
  assert.match(source, /smarttable:systextil:pedido-aplicado/);
  assert.match(source, /aplicado\.id !== id/);
  assert.match(source, /acharPorId\("procAgendados"\)/);
});

test('bloqueia Find e emissão quando a parcela fica vazia após o preenchimento NXJ', async () => {
  const env = criarAmbiente({ onPreencher: (_titulo, _parcela, campos) => { campos.parcela = ''; } });
  await assert.rejects(env.orquestrador.executarConsulta({ titulo: '00012345', parcela: '03' }), /parcela não foi preenchida no campo do Systextil/);
  assert.deepEqual(env.contagens(), { emissaoCount: 0, findCount: 0, preenchimentoCount: 1 });
});

test('bloqueia Find quando a parcela visível diverge da recebida do CRM', async () => {
  const env = criarAmbiente({ onPreencher: (_titulo, _parcela, campos) => { campos.parcela = '04'; } });
  await assert.rejects(env.orquestrador.executarConsulta({ titulo: '00012345', parcela: '03' }), /parcela exibida no Systextil diverge/);
  assert.deepEqual(env.contagens(), { emissaoCount: 0, findCount: 0, preenchimentoCount: 1 });
});

test('distingue parcela vazia depois do Find e nunca solicita emissão', async () => {
  const env = criarAmbiente({ deps: { lerCampos: () => ({ titulo: '00012345', parcela: '', cliente: 'CLIENTE TESTE' }) } });
  await assert.rejects(env.orquestrador.executarConsulta({ titulo: '00012345', parcela: '03' }), /consulta terminou, mas o campo de parcela está vazio/);
  assert.deepEqual(env.contagens(), { emissaoCount: 0, findCount: 1, preenchimentoCount: 1 });
});

test('distingue parcela divergente depois do Find e nunca solicita emissão', async () => {
  const env = criarAmbiente({ deps: { lerCampos: () => ({ titulo: '00012345', parcela: '04', cliente: 'CLIENTE TESTE' }) } });
  await assert.rejects(env.orquestrador.executarConsulta({ titulo: '00012345', parcela: '03' }), /parcela retornada pelo Systextil não corresponde/);
  assert.deepEqual(env.contagens(), { emissaoCount: 0, findCount: 1, preenchimentoCount: 1 });
});

test('só consulta e emite com título, parcela e cliente conferidos', async () => {
  const env = criarAmbiente();
  const result = await env.orquestrador.executarConsulta({ titulo: '00012345', parcela: '03' });
  assert.equal(result.titulo, '00012345');
  assert.equal(result.parcela, '03');
  assert.equal(result.cliente, 'CLIENTE TESTE LTDA');
  assert.deepEqual(env.contagens(), { emissaoCount: 1, findCount: 1, preenchimentoCount: 1 });
});

test('bloqueia nova emissão na janela de cinco minutos', async () => {
  const env = criarAmbiente();
  env.storage.set('st-auto-segunda-via:emissao:12345.3', '1800000000000');
  await assert.rejects(env.orquestrador.executarConsulta({ titulo: '00012345', parcela: '03' }), /menos de 5 minutos/);
  assert.deepEqual(env.contagens(), { emissaoCount: 0, findCount: 0, preenchimentoCount: 0 });
});

test('processos aguardam sucesso confirmado antes de baixar o PDF', async () => {
  const env = criarAmbiente();
  env.definirEstado({ visao: 'forms.systextil.batch', busca: false, acao: '', total: 1, atual: 1 });
  const result = await env.orquestrador.executarProcessos({ limiteMs: 20, intervaloMs: 1 });
  assert.match(result.texto, /PDF salvo/);
});
