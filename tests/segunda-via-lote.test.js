'use strict';

// Lote de segunda via (userscript 1.1.0): validação do pedido schema 2, o espaçamento entre emissões e as duas fases
// (emitir todos na Consulta de títulos; depois baixar os PDFs em Processos agendados). A lógica do lote recebe de fora
// o relógio e as ações da página, então é executada de verdade aqui, sem o ERP.

const assert = require('node:assert/strict');
const test = require('node:test');
const api = require('../userscripts/systextil-segunda-via.user.js');

function itemValido(n, extra = {}) {
  return {
    cnpj: '12345678000190',
    razaoSocial: 'EMPRESA TESTE LTDA',
    titulo: String(1000 + n).padStart(8, '0'),
    parcela: String(n),
    vencimento: '05/11/2026',
    saldo: 'R$ 150,00',
    diasAtraso: 2,
    situacao: 'EM_ATRASO',
    fluxo: 'CARTORIO',
    ...extra
  };
}

function loteValido(quantos = 3, extra = {}) {
  return {
    schema: 2,
    id: 'lote-12345678',
    createdAt: Date.now(),
    source: 'smarttable-crm',
    itens: Array.from({ length: quantos }, (_, i) => itemValido(i + 1)),
    ...extra
  };
}

/** Relógio falso: `esperar` só adianta o tempo, então o teste não demora minutos de verdade. */
function relogioFalso(inicio = 1_800_000_000_000) {
  const estado = { agora: inicio, esperas: [] };
  return {
    estado,
    agora: () => estado.agora,
    esperar: async ms => { estado.esperas.push(ms); estado.agora += ms; }
  };
}

function formatarDataHora(timestamp) {
  const d = new Date(timestamp);
  const pad = valor => String(valor).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/* ---------------------------------------------------------------------
 * Constantes: o que torna o lote seguro
 * --------------------------------------------------------------------- */
test('o intervalo entre emissões é maior que duas janelas de identificação do processo', () => {
  assert.ok(api.INTERVALO_ENTRE_EMISSOES_MS > 2 * api.TOLERANCIA_HORARIO_PROCESSO_MS);
});

test('o lote cabe no prazo em que uma solicitação ainda pode ser associada a um processo', () => {
  // O 1º PDF só é baixado depois da última emissão: (n-1) intervalos mais uma folga de 10 min para consultas e navegação.
  const pior = (api.MAX_ITENS_LOTE - 1) * api.INTERVALO_ENTRE_EMISSOES_MS + 10 * 60 * 1000;
  assert.ok(pior < api.MAX_IDADE_SOLICITACAO_MS, 'o teto de títulos estouraria o prazo de 30 minutos');
});

test('com o intervalo do lote cada processo é identificado só pela própria solicitação; sem ele fica ambíguo', () => {
  const primeiro = 1_800_000_000_000;
  const processo = (instante, rowIndex) => ({
    rowIndex,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: formatarDataHora(instante + 3000),
    mensagem: 'Processo concluído com sucesso.'
  });
  const solicitacao = instante => ({ solicitadoEm: instante, titulo: '00001001', parcela: '1' });

  const espacados = [primeiro, primeiro + api.INTERVALO_ENTRE_EMISSOES_MS, primeiro + 2 * api.INTERVALO_ENTRE_EMISSOES_MS];
  const registros = espacados.map(processo);
  espacados.forEach((instante, posicao) => {
    const resultado = api.analisarProcessos(registros, solicitacao(instante), instante + 10 * 60 * 1000);
    assert.equal(resultado.status, 'sucesso', 'título ' + posicao);
    assert.equal(resultado.registro.rowIndex, posicao);
  });

  // Dois cliques com 60 s de diferença caem na mesma janela: a trava de ambiguidade continua valendo.
  const juntos = [primeiro, primeiro + 60_000].map(processo);
  assert.equal(api.analisarProcessos(juntos, solicitacao(primeiro), primeiro + 5 * 60 * 1000).status, 'ambiguo');
});

/* ---------------------------------------------------------------------
 * Pedido em lote (schema 2)
 * --------------------------------------------------------------------- */
test('valida um lote de títulos e devolve cada item no formato do pedido de um título', () => {
  const lote = api.validarPedidoLote(loteValido(3));
  assert.equal(lote.schema, 2);
  assert.equal(lote.itens.length, 3);
  assert.equal(lote.itens[1].titulo, '00001002');
  assert.equal(lote.itens[1].cnpj, '12345678000190');
  assert.equal(lote.id, 'lote-12345678');
});

test('aceita de 1 até o teto de títulos e recusa vazio, acima do teto e itens que não são objetos', () => {
  assert.equal(api.validarPedidoLote(loteValido(1)).itens.length, 1);
  assert.equal(api.validarPedidoLote(loteValido(api.MAX_ITENS_LOTE)).itens.length, api.MAX_ITENS_LOTE);
  assert.throws(() => api.validarPedidoLote(loteValido(0)), /nenhum título/);
  assert.throws(() => api.validarPedidoLote(loteValido(api.MAX_ITENS_LOTE + 1)), /mais de/);
  assert.throws(() => api.validarPedidoLote({ ...loteValido(1), itens: 'x' }), /nenhum título/);
  assert.throws(() => api.validarPedidoLote({ ...loteValido(1), itens: [null] }), /não é um objeto/);
});

test('recusa título repetido no lote, com ou sem zeros à esquerda', () => {
  const repetido = loteValido(2);
  repetido.itens[1] = itemValido(1);
  assert.throws(() => api.validarPedidoLote(repetido), /repete o mesmo título/);

  const comZeros = loteValido(2);
  comZeros.itens[0] = itemValido(1, { titulo: '00001001', parcela: '1' });
  comZeros.itens[1] = itemValido(1, { titulo: '1001', parcela: '01' });
  assert.throws(() => api.validarPedidoLote(comZeros), /repete o mesmo título/);
});

test('aponta qual título do lote é inválido e mantém as regras do pedido de um título', () => {
  const lote = loteValido(3);
  lote.itens[2] = itemValido(3, { titulo: '12/34' });
  assert.throws(() => api.validarPedidoLote(lote), /Título 3 do lote: Número do título/);

  const semCnpj = loteValido(2);
  semCnpj.itens[0] = itemValido(1, { cnpj: '1234' });
  assert.throws(() => api.validarPedidoLote(semCnpj), /Título 1 do lote: O CNPJ/);

  assert.throws(() => api.validarPedidoLote(loteValido(1, { createdAt: Date.now() - 6 * 60 * 1000 })), /expirou/);
  assert.throws(() => api.validarPedidoLote(loteValido(1, { source: 'outro' })), /não é reconhecida/);
  assert.throws(() => api.validarPedidoLote(loteValido(1, { id: 'curto' })), /identificador/);
  assert.throws(() => api.validarPedidoLote({ ...loteValido(1), schema: 1 }), /não é reconhecida/);
});

test('o despachante aceita o pedido antigo (schema 1) e o lote (schema 2)', () => {
  const antigo = api.validarQualquerPedido({ schema: 1, id: 'pedido-12345678', createdAt: Date.now(), source: 'smarttable-crm', ...itemValido(1) });
  assert.equal(antigo.schema, 1);
  assert.equal(antigo.titulo, '00001001');
  assert.equal(api.validarQualquerPedido(loteValido(2)).schema, 2);
  assert.throws(() => api.validarQualquerPedido({ ...loteValido(1), schema: 3 }), /não é reconhecida/);
});

/* ---------------------------------------------------------------------
 * O que vai ao CRM
 * --------------------------------------------------------------------- */
test('o resultado leva ao CRM só a posição e o estado de cada título, nunca dados do cliente', () => {
  const resultado = api.criarResultado({ id: 'lote-12345678' }, 'processando', true, 'Andamento.', {
    itens: [
      { indice: 0, estado: 'emitido', titulo: '00001001', parcela: '1', cliente: 'EMPRESA TESTE LTDA', cnpj: '12345678000190', motivo: 'texto' },
      { indice: 1, estado: 'estado-inventado' }
    ],
    codigo: 'expirado'
  });
  assert.deepEqual(resultado.itens, [{ indice: 0, estado: 'emitido' }, { indice: 1, estado: 'erro' }]);
  assert.equal(resultado.codigo, 'expirado');
  assert.doesNotMatch(JSON.stringify(resultado), /00001001|EMPRESA|12345678000190|texto/);
});

test('o código do erro é de uma lista fechada e os extras são opcionais', () => {
  assert.equal(api.criarResultado({ id: 'x' }, 'erro', false, 'm', { codigo: 'qualquer coisa' }).codigo, undefined);
  const simples = api.criarResultado({ id: 'x' }, 'erro', false, 'm');
  assert.equal('itens' in simples, false);
  assert.equal('codigo' in simples, false);
  ['pedido-pendente', 'bloqueio-persistido', 'expirado', 'tela-ausente'].forEach(codigo => {
    assert.equal(api.criarResultado({ id: 'x' }, 'erro', false, 'm', { codigo }).codigo, codigo);
  });
});

test('consolida o resultado final do lote: ok só se todos salvaram o PDF', () => {
  const todos = api.consolidarResultadoLote([{ estado: 'concluido' }, { estado: 'concluido' }]);
  assert.deepEqual([todos.status, todos.ok], ['concluido', true]);
  assert.match(todos.mensagem, /2 PDFs salvos/);
  assert.match(api.consolidarResultadoLote([{ estado: 'concluido' }]).mensagem, /1 PDF salvo/);

  const incompleto = api.consolidarResultadoLote([{ estado: 'concluido' }, { estado: 'nao-emitido' }]);
  assert.deepEqual([incompleto.status, incompleto.ok], ['concluido', false]);
  assert.match(incompleto.mensagem, /1 de 2 PDF\(s\) salvo\(s\)/);

  const incerto = api.consolidarResultadoLote([{ estado: 'concluido' }, { estado: 'indeterminado' }]);
  assert.deepEqual([incerto.status, incerto.ok], ['indeterminado', false]);
  assert.match(incerto.mensagem, /confira Processos agendados e a pasta Downloads/);

  assert.equal(api.consolidarResultadoLote([]).ok, false);
});

/* ---------------------------------------------------------------------
 * Fase 1: emitir
 * --------------------------------------------------------------------- */
function dependenciasDeEmissao(relogio, { falhaConsulta = null, falhaEmissao = null, chamadas = [] } = {}) {
  return {
    chamadas,
    consultar: async (item, indice) => {
      chamadas.push(['consultar', indice, relogio.agora()]);
      if (falhaConsulta === indice) throw new Error('Nenhum título foi encontrado.');
      return { titulo: item.titulo, parcela: item.parcela, cliente: 'CLIENTE' };
    },
    emitir: async (item, campos, indice) => {
      chamadas.push(['emitir', indice, relogio.agora()]);
      if (falhaEmissao && falhaEmissao.indice === indice) {
        const erro = new Error(falhaEmissao.mensagem);
        erro.emissaoClicada = falhaEmissao.clicou;
        throw erro;
      }
      return { solicitadoEm: relogio.agora(), titulo: campos.titulo, parcela: campos.parcela, cliente: campos.cliente };
    }
  };
}

test('emite o lote inteiro, na ordem, com o intervalo mínimo entre os cliques', async () => {
  const relogio = relogioFalso();
  const dep = dependenciasDeEmissao(relogio);
  const itens = api.validarPedidoLote(loteValido(3)).itens;
  const resultado = await api.executarLoteEmissao({ itens, ...dep, agora: relogio.agora, esperar: relogio.esperar });

  assert.equal(resultado.interrompido, false);
  assert.deepEqual(resultado.itens.map(i => i.estado), ['emitido', 'emitido', 'emitido']);
  const cliques = dep.chamadas.filter(c => c[0] === 'emitir');
  assert.deepEqual(cliques.map(c => c[1]), [0, 1, 2]);
  for (let i = 1; i < cliques.length; i += 1) {
    assert.ok(cliques[i][2] - cliques[i - 1][2] >= api.INTERVALO_ENTRE_EMISSOES_MS, 'cliques ' + (i - 1) + ' e ' + i + ' muito próximos');
  }
  assert.equal(resultado.itens[0].solicitadoEm, cliques[0][2]);
  assert.equal(resultado.itens[2].titulo, '00001003');
});

test('consulta o título seguinte ANTES de esperar o intervalo e só clica depois dele', async () => {
  const relogio = relogioFalso();
  const dep = dependenciasDeEmissao(relogio);
  const itens = api.validarPedidoLote(loteValido(2)).itens;
  await api.executarLoteEmissao({ itens, ...dep, agora: relogio.agora, esperar: relogio.esperar });

  assert.deepEqual(dep.chamadas.map(c => c[0] + c[1]), ['consultar0', 'emitir0', 'consultar1', 'emitir1']);
  const [, , consulta2, clique2] = dep.chamadas;
  const clique1 = dep.chamadas[1];
  assert.ok(consulta2[2] - clique1[2] < 1000, 'a consulta do 2º acontece logo depois do 1º clique, não depois da espera');
  assert.ok(clique2[2] - clique1[2] >= api.INTERVALO_ENTRE_EMISSOES_MS);
});

test('não espera antes do primeiro clique nem quando o intervalo já passou durante a consulta', async () => {
  const relogio = relogioFalso();
  const dep = dependenciasDeEmissao(relogio);
  // Uma consulta lenta (3 min 10 s) já consome o intervalo: o clique segue sem esperar mais.
  const consultarLenta = dep.consultar;
  dep.consultar = async (item, indice) => {
    if (indice === 1) relogio.estado.agora += api.INTERVALO_ENTRE_EMISSOES_MS + 5000;
    return consultarLenta(item, indice);
  };
  const itens = api.validarPedidoLote(loteValido(2)).itens;
  await api.executarLoteEmissao({ itens, ...dep, agora: relogio.agora, esperar: relogio.esperar });
  assert.deepEqual(relogio.estado.esperas, []);
});

test('falha na consulta do 2º título: ele e os seguintes não são emitidos, o 1º continua emitido', async () => {
  const relogio = relogioFalso();
  const dep = dependenciasDeEmissao(relogio, { falhaConsulta: 1 });
  const itens = api.validarPedidoLote(loteValido(4)).itens;
  const resultado = await api.executarLoteEmissao({ itens, ...dep, agora: relogio.agora, esperar: relogio.esperar });

  assert.equal(resultado.interrompido, true);
  assert.deepEqual(resultado.itens.map(i => i.estado), ['emitido', 'nao-emitido', 'nao-emitido', 'nao-emitido']);
  assert.match(resultado.itens[1].motivo, /Nenhum título foi encontrado/);
  assert.match(resultado.itens[2].motivo, /um título anterior não foi emitido/);
  assert.deepEqual(dep.chamadas.filter(c => c[0] === 'emitir').map(c => c[1]), [0]);
});

test('erro ao emitir ANTES do clique: não emitido; erro DEPOIS do clique: indeterminado; nos dois casos o lote para', async () => {
  const antes = relogioFalso();
  const depAntes = dependenciasDeEmissao(antes, { falhaEmissao: { indice: 1, mensagem: 'O botão Emite boleto não está disponível.', clicou: false } });
  const itens = api.validarPedidoLote(loteValido(3)).itens;
  const r1 = await api.executarLoteEmissao({ itens, ...depAntes, agora: antes.agora, esperar: antes.esperar });
  assert.deepEqual(r1.itens.map(i => i.estado), ['emitido', 'nao-emitido', 'nao-emitido']);

  const depois = relogioFalso();
  const depDepois = dependenciasDeEmissao(depois, { falhaEmissao: { indice: 1, mensagem: 'Falha depois do clique.', clicou: true } });
  const r2 = await api.executarLoteEmissao({ itens, ...depDepois, agora: depois.agora, esperar: depois.esperar });
  assert.deepEqual(r2.itens.map(i => i.estado), ['emitido', 'indeterminado', 'nao-emitido']);
  assert.equal(r2.interrompido, true);
  assert.deepEqual(depDepois.chamadas.filter(c => c[0] === 'emitir').map(c => c[1]), [0, 1], 'o 3º nunca é emitido');
});

test('Esc antes de começar, entre consulta e clique ou durante a espera interrompe o lote sem emitir mais nada', async () => {
  const itens = api.validarPedidoLote(loteValido(3)).itens;

  // Antes do 1º título.
  let relogio = relogioFalso();
  let dep = dependenciasDeEmissao(relogio);
  let r = await api.executarLoteEmissao({ itens, ...dep, agora: relogio.agora, esperar: relogio.esperar, estaCancelado: () => true });
  assert.deepEqual(r.itens.map(i => i.estado), ['nao-emitido', 'nao-emitido', 'nao-emitido']);
  assert.equal(dep.chamadas.length, 0);

  // Durante a espera do intervalo do 2º título.
  relogio = relogioFalso();
  dep = dependenciasDeEmissao(relogio);
  r = await api.executarLoteEmissao({
    itens, ...dep, agora: relogio.agora, esperar: relogio.esperar,
    estaCancelado: () => dep.chamadas.filter(c => c[0] === 'consultar').length >= 2
  });
  assert.deepEqual(r.itens.map(i => i.estado), ['emitido', 'nao-emitido', 'nao-emitido']);
  assert.match(r.itens[1].motivo, /Esc/);
  assert.deepEqual(dep.chamadas.filter(c => c[0] === 'emitir').map(c => c[1]), [0]);
});

test('reporta cada mudança de estado para o acompanhamento', async () => {
  const relogio = relogioFalso();
  const dep = dependenciasDeEmissao(relogio);
  const itens = api.validarPedidoLote(loteValido(2)).itens;
  const historico = [];
  await api.executarLoteEmissao({
    itens, ...dep, agora: relogio.agora, esperar: relogio.esperar,
    aoMudar: async estados => { historico.push(estados.map(e => e.estado).join(',')); }
  });
  assert.deepEqual(historico, [
    'consultando,na-fila',
    'emitido,na-fila',
    'emitido,consultando',
    'emitido,aguardando-intervalo',
    'emitido,emitido'
  ]);
});

/* ---------------------------------------------------------------------
 * Fase 2: baixar
 * --------------------------------------------------------------------- */
function itensEmitidos(estados) {
  return estados.map((estado, indice) => ({
    indice,
    estado,
    titulo: String(1001 + indice).padStart(8, '0'),
    parcela: '1',
    cliente: 'CLIENTE',
    solicitadoEm: 1_800_000_000_000 + indice * api.INTERVALO_ENTRE_EMISSOES_MS
  }));
}

test('baixa o PDF de cada título emitido, na ordem, e pula os não emitidos', async () => {
  const itens = itensEmitidos(['emitido', 'nao-emitido', 'emitido']);
  const baixados = [];
  const resultado = await api.executarLoteDownloads({
    itens,
    baixarUm: async (item, indice, aoIniciar) => { await aoIniciar(); baixados.push(indice); }
  });
  assert.deepEqual(baixados, [0, 2]);
  assert.deepEqual(resultado.itens.map(i => i.estado), ['concluido', 'nao-emitido', 'concluido']);
});

test('um título que não pôde ser identificado não impede o download dos outros', async () => {
  const itens = itensEmitidos(['emitido', 'emitido', 'emitido']);
  const tentados = [];
  const resultado = await api.executarLoteDownloads({
    itens,
    baixarUm: async (item, indice, aoIniciar) => {
      tentados.push(indice);
      if (indice === 1) throw new Error('Mais de um processo está dentro da tolerância de horário e nenhum coincide exatamente com o segundo da solicitação.');
      await aoIniciar();
    }
  });
  assert.deepEqual(tentados, [0, 1, 2]);
  assert.deepEqual(resultado.itens.map(i => i.estado), ['concluido', 'indeterminado', 'concluido']);
  assert.equal(resultado.interrompido, false);
});

test('falha de download que não começou vira erro; resultado incerto do navegador vira indeterminado', async () => {
  const itens = itensEmitidos(['emitido', 'emitido']);
  const resultado = await api.executarLoteDownloads({
    itens,
    baixarUm: async (item, indice, aoIniciar) => {
      if (indice === 0) throw new Error('O Tampermonkey não iniciou o download (not_enabled).');
      await aoIniciar();
      throw new Error('Resultado do download indeterminado. Confira a pasta Downloads antes de repetir.');
    }
  });
  assert.deepEqual(resultado.itens.map(i => i.estado), ['erro', 'indeterminado']);
});

test('se a tela Processos agendados falha, os títulos seguintes ficam indeterminados e nada mais é tentado', async () => {
  const itens = itensEmitidos(['emitido', 'emitido', 'emitido', 'nao-emitido']);
  const tentados = [];
  const resultado = await api.executarLoteDownloads({
    itens,
    baixarUm: async (item, indice, aoIniciar) => {
      tentados.push(indice);
      if (indice === 0) { await aoIniciar(); return; }
      throw new Error('A tela Processos agendados não está ativa.');
    }
  });
  assert.deepEqual(tentados, [0, 1]);
  assert.deepEqual(resultado.itens.map(i => i.estado), ['concluido', 'indeterminado', 'indeterminado', 'nao-emitido']);
  assert.equal(resultado.interrompido, true);
  assert.match(resultado.itens[2].motivo, /Processos agendados falhou/);
});

test('ao retomar depois de recarregar a página, um título que estava baixando vira indeterminado e não é baixado de novo', async () => {
  const itens = itensEmitidos(['concluido', 'baixando', 'emitido']);
  const tentados = [];
  const resultado = await api.executarLoteDownloads({
    itens,
    baixarUm: async (item, indice, aoIniciar) => { tentados.push(indice); await aoIniciar(); }
  });
  assert.deepEqual(tentados, [2]);
  assert.deepEqual(resultado.itens.map(i => i.estado), ['concluido', 'indeterminado', 'concluido']);
  assert.match(resultado.itens[1].motivo, /recarregou/);
});

test('Esc na fase de download deixa os títulos que faltam como indeterminados', async () => {
  const itens = itensEmitidos(['emitido', 'emitido']);
  let cancelar = false;
  const resultado = await api.executarLoteDownloads({
    itens,
    estaCancelado: () => cancelar,
    baixarUm: async (item, indice, aoIniciar) => { await aoIniciar(); cancelar = true; }
  });
  assert.deepEqual(resultado.itens.map(i => i.estado), ['concluido', 'indeterminado']);
  assert.match(resultado.itens[1].motivo, /Esc/);
});

test('classifica as falhas de download', () => {
  assert.deepEqual(api.classificarFalhaDownload(new Error('O Tampermonkey não iniciou o download (not_whitelisted).')), { estado: 'erro', fatal: false });
  assert.deepEqual(api.classificarFalhaDownload(new Error('A tela Processos agendados não está ativa.')), { estado: 'indeterminado', fatal: true });
  assert.deepEqual(api.classificarFalhaDownload(new Error('Não foi possível atualizar Processos agendados: o sininho (procAgendados) não está disponível.')), { estado: 'indeterminado', fatal: true });
  assert.deepEqual(api.classificarFalhaDownload(new Error('Tempo esgotado aguardando o processo de emissão.')), { estado: 'indeterminado', fatal: false });
  assert.deepEqual(api.classificarFalhaDownload(undefined), { estado: 'indeterminado', fatal: false });
});

/* =====================================================================
 * A cola com a página: o estado gravado, o que é publicado ao CRM e a retomada.
 * As ações da página (consultar, emitir, tela, download) são portas falsas; o armazenamento
 * compartilhado do Tampermonkey é um Map em memória.
 * ===================================================================== */
const VISAO_CONSULTA = 'forms.crec.crec_f090';
const VISAO_PROCESSOS = 'forms.systextil.batch';

function armazenamentoFalso() {
  const valores = new Map();
  const log = [];
  globalThis.window = { setTimeout };
  globalThis.GM_getValue = async (chave, padrao) => (valores.has(chave) ? structuredClone(valores.get(chave)) : padrao);
  globalThis.GM_setValue = async (chave, valor) => {
    log.push({ chave, valor: structuredClone(valor) });
    if (valor === null) valores.delete(chave);
    else valores.set(chave, structuredClone(valor));
  };
  const publicados = () => log.filter(e => e.chave === api.CHAVES.resultado).map(e => e.valor);
  const gravacoes = chave => log.filter(e => e.chave === chave).map(e => e.valor);
  return { valores, log, publicados, gravacoes };
}

test.afterEach(() => {
  delete globalThis.GM_getValue;
  delete globalThis.GM_setValue;
  delete globalThis.window;
});

function portasDoLote(relogio, { falhaConsulta = null, falhaEmissao = null, tela = { visao: VISAO_CONSULTA }, falhaProcessos = null, eventos = [] } = {}) {
  const dep = dependenciasDeEmissao(relogio, { falhaConsulta, falhaEmissao, chamadas: eventos });
  return {
    eventos,
    estadoDaTela: () => tela,
    consultar: dep.consultar,
    emitir: dep.emitir,
    irParaProcessos: async () => {
      eventos.push(['processos', null, relogio.agora()]);
      if (falhaProcessos) throw new Error(falhaProcessos);
    },
    esperar: relogio.esperar,
    agora: relogio.agora,
    estaCancelado: () => false
  };
}

const IDS = { lote: 'lote-12345678' };

test('lote: assume o pedido ANTES de emitir (uma recarga não emite de novo) e grava o andamento de cada título', async () => {
  const gm = armazenamentoFalso();
  await GM_setValue(api.CHAVES.pedido, { id: IDS.lote });
  const relogio = relogioFalso();
  const portas = portasDoLote(relogio);
  // Foto do armazenamento no instante da PRIMEIRA consulta: o pedido já tem que ter saído e o lote já tem que estar registrado.
  let fotoNaPrimeiraConsulta = null;
  const consultar = portas.consultar;
  portas.consultar = async (item, indice) => {
    if (!fotoNaPrimeiraConsulta) {
      fotoNaPrimeiraConsulta = { pedido: gm.valores.has(api.CHAVES.pedido), execucao: gm.valores.get(api.CHAVES.execucao)?.status };
    }
    return consultar(item, indice);
  };
  const lote = api.validarPedidoLote(loteValido(2));
  await api.executarLote(lote, {}, portas);

  assert.deepEqual(fotoNaPrimeiraConsulta, { pedido: false, execucao: 'lote-emitindo' });
  assert.equal(gm.valores.has(api.CHAVES.pedido), false);
  const gravacoesExecucao = gm.gravacoes(api.CHAVES.execucao);
  assert.equal(gravacoesExecucao[0].status, 'lote-emitindo');
  assert.ok(gravacoesExecucao[0].lote === true && gravacoesExecucao[0].schema === 2);
  assert.deepEqual(gravacoesExecucao[0].itens.map(i => i.estado), ['na-fila', 'na-fila']);
  const execucaoFinal = gm.valores.get(api.CHAVES.execucao);
  assert.equal(execucaoFinal.status, 'lote-emitido');
  assert.deepEqual(execucaoFinal.itens.map(i => i.estado), ['emitido', 'emitido']);
  assert.equal(execucaoFinal.itens[0].titulo, '00001001');
  assert.ok(Number.isFinite(execucaoFinal.itens[1].solicitadoEm));
  assert.ok(api.obterExecucaoAtiva(execucaoFinal), 'o lote em andamento bloqueia novos pedidos');
  assert.equal(portas.eventos.filter(e => e[0] === 'processos').length, 1, 'vai a Processos agendados uma vez, depois do último clique');
  assert.equal(portas.eventos[portas.eventos.length - 1][0], 'processos');
});

test('lote: o CRM recebe só posição e estado de cada título, e "emissao-solicitada" quando todos foram emitidos', async () => {
  const gm = armazenamentoFalso();
  const relogio = relogioFalso();
  const lote = api.validarPedidoLote(loteValido(2));
  await api.executarLote(lote, {}, portasDoLote(relogio));

  const resultados = gm.publicados();
  assert.ok(resultados.length >= 3);
  resultados.forEach(r => assert.equal(r.id, IDS.lote));
  const ultimo = resultados[resultados.length - 1];
  assert.equal(ultimo.status, 'emissao-solicitada');
  assert.deepEqual(ultimo.itens, [{ indice: 0, estado: 'emitido' }, { indice: 1, estado: 'emitido' }]);
  assert.equal(resultados[0].status, 'processando');
  const todo = JSON.stringify(resultados);
  assert.doesNotMatch(todo, /00001001|00001002|EMPRESA|12345678000190|CLIENTE/);
  resultados.forEach(r => (r.itens || []).forEach(i => assert.deepEqual(Object.keys(i).sort(), ['estado', 'indice'])));
});

test('lote: falha no 2º título para a emissão, mas vai a Processos agendados para baixar o 1º', async () => {
  const gm = armazenamentoFalso();
  const relogio = relogioFalso();
  const portas = portasDoLote(relogio, { falhaConsulta: 1 });
  await api.executarLote(api.validarPedidoLote(loteValido(3)), {}, portas);

  const execucao = gm.valores.get(api.CHAVES.execucao);
  assert.equal(execucao.status, 'lote-emitido');
  assert.deepEqual(execucao.itens.map(i => i.estado), ['emitido', 'nao-emitido', 'nao-emitido']);
  assert.equal(portas.eventos.filter(e => e[0] === 'processos').length, 1);
  const ultimo = gm.publicados().pop();
  assert.equal(ultimo.status, 'emissao-solicitada');
  assert.match(ultimo.mensagem, /parou em um dos títulos/);
});

test('lote: se nenhum título foi emitido, não vai a Processos agendados e libera o bloqueio', async () => {
  const gm = armazenamentoFalso();
  const relogio = relogioFalso();
  const portas = portasDoLote(relogio, { falhaConsulta: 0 });
  await api.executarLote(api.validarPedidoLote(loteValido(2)), {}, portas);

  assert.equal(portas.eventos.filter(e => e[0] === 'processos').length, 0);
  assert.equal(gm.valores.has(api.CHAVES.execucao), false, 'nada foi emitido: não há o que conferir');
  const ultimo = gm.publicados().pop();
  assert.deepEqual([ultimo.status, ultimo.ok], ['concluido', false]);
  assert.deepEqual(ultimo.itens.map(i => i.estado), ['nao-emitido', 'nao-emitido']);
});

test('lote: clique de emissão incerto mantém o bloqueio até a conferência manual', async () => {
  const gm = armazenamentoFalso();
  const relogio = relogioFalso();
  const portas = portasDoLote(relogio, { falhaEmissao: { indice: 0, mensagem: 'Falha depois do clique.', clicou: true } });
  await api.executarLote(api.validarPedidoLote(loteValido(2)), {}, portas);

  const execucao = gm.valores.get(api.CHAVES.execucao);
  assert.equal(execucao.status, 'indeterminado');
  assert.ok(api.obterExecucaoAtiva(execucao), 'um resultado incerto nunca expira sozinho');
  assert.equal(portas.eventos.filter(e => e[0] === 'processos').length, 0);
  const ultimo = gm.publicados().pop();
  assert.equal(ultimo.status, 'indeterminado');
  assert.deepEqual(ultimo.itens.map(i => i.estado), ['indeterminado', 'nao-emitido']);
});

test('lote: erro ao ir a Processos agendados vira "indeterminado" e NÃO é relançado (não convida a repetir a emissão)', async () => {
  const gm = armazenamentoFalso();
  const relogio = relogioFalso();
  const portas = portasDoLote(relogio, { falhaProcessos: 'Os boletos foram emitidos, mas o controle Processos agendados não foi localizado.' });
  await api.executarLote(api.validarPedidoLote(loteValido(2)), {}, portas); // não lança

  const execucao = gm.valores.get(api.CHAVES.execucao);
  assert.equal(execucao.status, 'indeterminado');
  assert.deepEqual(execucao.itens.map(i => i.estado), ['emitido', 'emitido']);
  const ultimo = gm.publicados().pop();
  assert.equal(ultimo.status, 'indeterminado');
  assert.match(ultimo.mensagem, /Confira Processos agendados e Downloads antes de qualquer nova emissão/);
  assert.equal(gm.publicados().filter(r => r.status === 'erro').length, 0);
});

test('lote: fora da Consulta de títulos não grava nada nem emite', async () => {
  const gm = armazenamentoFalso();
  const relogio = relogioFalso();
  const portas = portasDoLote(relogio, { tela: { visao: VISAO_PROCESSOS } });
  await assert.rejects(api.executarLote(api.validarPedidoLote(loteValido(1)), {}, portas), /Abra a Consulta de títulos/);
  assert.equal(gm.log.length, 0);
  assert.equal(portas.eventos.length, 0);
});

function execucaoDeLote(estados, status = 'lote-emitido') {
  return {
    schema: 2,
    lote: true,
    pedidoId: IDS.lote,
    status,
    criadoEm: 1_800_000_000_000,
    itens: itensEmitidos(estados).map(item => ({ ...item, cnpj: '12345678000190', razaoSocial: 'EMPRESA TESTE LTDA' }))
  };
}

function portasDeDownload({ falhasPorIndice = {}, tela = { visao: VISAO_PROCESSOS }, chamadas = [] } = {}) {
  return {
    chamadas,
    estadoDaTela: () => tela,
    baixarUm: async (execucaoDoItem, { aoIniciar }) => {
      chamadas.push(execucaoDoItem);
      const indice = Number(execucaoDoItem.titulo) - 1001;
      if (falhasPorIndice[indice]) throw new Error(falhasPorIndice[indice]);
      await aoIniciar();
    },
    estaCancelado: () => false
  };
}

test('lote, download: baixa cada título com os dados dele, grava o andamento e libera tudo ao concluir', async () => {
  const gm = armazenamentoFalso();
  const execucao = execucaoDeLote(['emitido', 'emitido']);
  await api.executarDownloadsDoLote({}, execucao, portasDeDownload({ chamadas: [] }));

  const gravadas = gm.gravacoes(api.CHAVES.execucao).filter(Boolean);
  assert.ok(gravadas.every(g => g.status === 'lote-baixando' || g.status === 'indeterminado'));
  assert.ok(gravadas.some(g => g.itens.some(i => i.estado === 'baixando')), 'registra "baixando" enquanto salva o PDF');
  assert.equal(gm.valores.has(api.CHAVES.execucao), false, 'concluído: o bloqueio é liberado');
  assert.equal(gm.valores.has(api.CHAVES.lockProcesso), false, 'a trava de processos é solta');
  const ultimo = gm.publicados().pop();
  assert.deepEqual([ultimo.status, ultimo.ok], ['concluido', true]);
  assert.deepEqual(ultimo.itens, [{ indice: 0, estado: 'concluido' }, { indice: 1, estado: 'concluido' }]);
  assert.match(ultimo.mensagem, /2 PDFs salvos/);
});

test('lote, download: cada título é identificado pela PRÓPRIA solicitação (horário, número e parcela)', async () => {
  armazenamentoFalso();
  const chamadas = [];
  const execucao = execucaoDeLote(['emitido', 'emitido', 'emitido']);
  await api.executarDownloadsDoLote({}, execucao, portasDeDownload({ chamadas }));
  assert.equal(chamadas.length, 3);
  chamadas.forEach((item, i) => {
    assert.equal(item.pedidoId, IDS.lote);
    assert.equal(item.titulo, execucao.itens[i].titulo);
    assert.equal(item.solicitadoEm, execucao.itens[i].solicitadoEm);
    assert.equal(item.cnpj, '12345678000190');
    assert.equal(item.cliente, 'CLIENTE');
  });
  assert.ok(chamadas[1].solicitadoEm - chamadas[0].solicitadoEm >= api.INTERVALO_ENTRE_EMISSOES_MS);
});

test('lote, download: título incerto mantém o bloqueio e o resultado final é "indeterminado"', async () => {
  const gm = armazenamentoFalso();
  const execucao = execucaoDeLote(['emitido', 'emitido']);
  await api.executarDownloadsDoLote({}, execucao, portasDeDownload({ falhasPorIndice: { 1: 'Tempo esgotado aguardando o processo de emissão.' } }));

  const persistida = gm.valores.get(api.CHAVES.execucao);
  assert.equal(persistida.status, 'indeterminado');
  assert.ok(api.obterExecucaoAtiva(persistida));
  const ultimo = gm.publicados().pop();
  assert.deepEqual([ultimo.status, ultimo.ok], ['indeterminado', false]);
  assert.deepEqual(ultimo.itens.map(i => i.estado), ['concluido', 'indeterminado']);
});

test('lote, download: PDF que não começou a baixar (erro) não deixa bloqueio, pois a emissão é certa', async () => {
  const gm = armazenamentoFalso();
  const execucao = execucaoDeLote(['emitido']);
  await api.executarDownloadsDoLote({}, execucao, portasDeDownload({ falhasPorIndice: { 0: 'O Tampermonkey não iniciou o download (not_enabled).' } }));
  assert.equal(gm.valores.has(api.CHAVES.execucao), false);
  const ultimo = gm.publicados().pop();
  assert.deepEqual([ultimo.status, ultimo.ok], ['concluido', false]);
  assert.deepEqual(ultimo.itens.map(i => i.estado), ['erro']);
});

test('lote, download: retomar depois de recarregar não baixa de novo o título que estava baixando', async () => {
  const gm = armazenamentoFalso();
  const chamadas = [];
  const execucao = execucaoDeLote(['concluido', 'baixando', 'emitido'], 'lote-baixando');
  await api.executarDownloadsDoLote({}, execucao, portasDeDownload({ chamadas }));
  assert.deepEqual(chamadas.map(c => c.titulo), ['00001003']);
  const ultimo = gm.publicados().pop();
  assert.deepEqual(ultimo.itens.map(i => i.estado), ['concluido', 'indeterminado', 'concluido']);
  assert.equal(ultimo.status, 'indeterminado');
});

test('lote, download: outra aba com a trava de processos faz esta não gravar nem publicar nada', async () => {
  const gm = armazenamentoFalso();
  await GM_setValue(api.CHAVES.lockProcesso, { pedidoId: IDS.lote, tabId: 'outra-aba', expiraEm: Date.now() + 60_000 });
  gm.log.length = 0;
  const chamadas = [];
  await api.executarDownloadsDoLote({}, execucaoDeLote(['emitido']), portasDeDownload({ chamadas }));
  assert.equal(chamadas.length, 0);
  assert.equal(gm.log.length, 0);
});

test('lote, download: fora de Processos agendados marca o estado como incerto, sem baixar nada', async () => {
  const gm = armazenamentoFalso();
  const execucao = execucaoDeLote(['emitido']);
  await GM_setValue(api.CHAVES.execucao, execucao); // o que a fase 1 deixou gravado
  const chamadas = [];
  await api.executarDownloadsDoLote({}, execucao, portasDeDownload({ tela: { visao: VISAO_CONSULTA }, chamadas }));

  assert.equal(chamadas.length, 0);
  const persistida = gm.valores.get(api.CHAVES.execucao);
  assert.equal(persistida.status, 'indeterminado');
  assert.ok(api.obterExecucaoAtiva(persistida));
  assert.match(persistida.motivo, /Processos agendados não está ativa/);
  const ultimo = gm.publicados().pop();
  assert.deepEqual([ultimo.status, ultimo.ok], ['indeterminado', false]);
});

test('lote, download: pedido que não é um lote não grava estado de execução', async () => {
  const gm = armazenamentoFalso();
  await api.executarDownloadsDoLote({}, { pedidoId: IDS.lote, status: 'emissao-solicitada' }, portasDeDownload());
  assert.equal(gm.valores.has(api.CHAVES.execucao), false);
});

/* ---------------------------------------------------------------------
 * Abrir a Consulta de títulos sozinho
 * --------------------------------------------------------------------- */
function portasDaTela({ aguardar = [], campo = 'ok', envios = [] } = {}) {
  const sequencia = [...aguardar];
  const campoBusca = campo === 'ausente' ? null : {
    type: 'search', value: '', readOnly: campo === 'somente-leitura', disabled: false, isConnected: true,
    form: { requestSubmit() { envios.push('envio'); } }
  };
  return {
    envios,
    campoBusca,
    estadoDaTela: () => ({ visao: VISAO_PROCESSOS }),
    aguardarConsulta: async () => (sequencia.length ? sequencia.shift() : null),
    buscaDeProgramas: () => campoBusca,
    definirValor: (alvo, valor) => {
      if (!alvo || alvo.readOnly) return false;
      alvo.value = valor;
      return true;
    },
    pausa: async () => {}
  };
}

async function prepararPedidoPendente(gm, id = IDS.lote) {
  await GM_setValue(api.CHAVES.pedido, { id });
  gm.log.length = 0;
  return { id };
}

test('tela: já na Consulta de títulos devolve a tela sem escrever nada', async () => {
  const gm = armazenamentoFalso();
  const pedido = await prepararPedidoPendente(gm);
  const portas = { ...portasDaTela(), estadoDaTela: () => ({ visao: VISAO_CONSULTA }) };
  const tela = await api.garantirConsultaDeTitulos(pedido, {}, portas);
  assert.equal(tela.visao, VISAO_CONSULTA);
  assert.equal(gm.log.length, 0);
});

test('tela: se outra aba assumiu a tela dentro da espera, não faz nada', async () => {
  const gm = armazenamentoFalso();
  const pedido = await prepararPedidoPendente(gm);
  const portas = portasDaTela({ aguardar: [{ visao: VISAO_CONSULTA }] });
  const tela = await api.garantirConsultaDeTitulos(pedido, {}, portas);
  assert.equal(tela.visao, VISAO_CONSULTA);
  assert.equal(portas.envios.length, 0);
  assert.equal(gm.log.length, 0);
});

test('tela: pedido já consumido por outra aba, ou trava de consumo alheia, não navega nem publica', async () => {
  let gm = armazenamentoFalso();
  let portas = portasDaTela();
  assert.equal(await api.garantirConsultaDeTitulos({ id: IDS.lote }, {}, portas), null); // sem pedido pendente
  assert.equal(portas.envios.length, 0);
  assert.equal(gm.publicados().length, 0);

  gm = armazenamentoFalso();
  const pedido = await prepararPedidoPendente(gm);
  await GM_setValue(api.CHAVES.consumidor, { pedidoId: IDS.lote, tabId: 'outra-aba', expiraEm: Date.now() + 60_000 });
  gm.log.length = 0;
  portas = portasDaTela();
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.equal(portas.envios.length, 0);
  assert.equal(gm.log.length, 0);
});

test('tela: escreve crec_f090 no Buscar programas, envia só o formulário da busca e segue quando a tela abre', async () => {
  const gm = armazenamentoFalso();
  const pedido = await prepararPedidoPendente(gm);
  const portas = portasDaTela({ aguardar: [null, { visao: VISAO_CONSULTA }] });
  const tela = await api.garantirConsultaDeTitulos(pedido, {}, portas);

  assert.equal(tela.visao, VISAO_CONSULTA);
  assert.equal(portas.campoBusca.value, 'crec_f090');
  assert.deepEqual(portas.envios, ['envio'], 'um único envio, só do formulário da busca');
  assert.deepEqual(gm.publicados().map(r => r.status), ['abrindo-tela']);
  assert.match(gm.publicados()[0].mensagem, /Abrindo a Consulta de títulos \(crec_f090\) no Systextil/);
  const marca = gm.valores.get(api.CHAVES.navegacao);
  assert.equal(marca.id, IDS.lote);
  assert.equal(marca.avisou, false);
});

test('tela: se a tela não abre, avisa UMA vez e nunca tenta de novo para o mesmo pedido', async () => {
  const gm = armazenamentoFalso();
  const pedido = await prepararPedidoPendente(gm);
  const portas = portasDaTela();
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.deepEqual(gm.publicados().map(r => r.status), ['abrindo-tela', 'abrir-tela-manual']);
  assert.match(gm.publicados()[1].mensagem, /Abra essa tela; a automação continua quando ela aparecer/);
  assert.equal(portas.envios.length, 1);

  // Segunda tentativa do mesmo pedido (por exemplo, a sonda da próxima mudança de tela): nada de novo.
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.equal(portas.envios.length, 1, 'uma tentativa por pedido');
  assert.deepEqual(gm.publicados().map(r => r.status), ['abrindo-tela', 'abrir-tela-manual'], 'o aviso não se repete');
});

test('tela: sem o campo Buscar programas avisa uma vez e não envia nada', async () => {
  const gm = armazenamentoFalso();
  const pedido = await prepararPedidoPendente(gm);
  const portas = portasDaTela({ campo: 'ausente' });
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.deepEqual(gm.publicados().map(r => r.status), ['abrir-tela-manual']);
  assert.equal(portas.envios.length, 0);
});

test('tela: campo de busca que não aceita escrita não recebe envio', async () => {
  const gm = armazenamentoFalso();
  const pedido = await prepararPedidoPendente(gm);
  const portas = portasDaTela({ campo: 'somente-leitura' });
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.equal(portas.envios.length, 0);
  assert.deepEqual(gm.publicados().map(r => r.status), ['abrindo-tela', 'abrir-tela-manual']);
});

test('tela: se o texto escrito não ficou no campo, o formulário não é enviado', async () => {
  const gm = armazenamentoFalso();
  const pedido = await prepararPedidoPendente(gm);
  const portas = portasDaTela();
  portas.definirValor = () => true; // diz que escreveu, mas o campo continua vazio
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.equal(portas.envios.length, 0);
});

test('tela: tentativa de outra aba para o mesmo pedido: esta aba só avisa depois do prazo, uma vez', async () => {
  const gm = armazenamentoFalso();
  const pedido = await prepararPedidoPendente(gm);
  const portas = portasDaTela();
  await GM_setValue(api.CHAVES.navegacao, { id: IDS.lote, aba: 'outra-aba', em: Date.now(), avisou: false });
  gm.log.length = 0;
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.equal(gm.publicados().length, 0, 'dentro do prazo a outra aba ainda está tentando');

  await GM_setValue(api.CHAVES.navegacao, { id: IDS.lote, aba: 'outra-aba', em: Date.now() - 7000, avisou: false });
  gm.log.length = 0;
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.deepEqual(gm.publicados().map(r => r.status), ['abrir-tela-manual']);
  assert.equal(await api.garantirConsultaDeTitulos(pedido, {}, portas), null);
  assert.equal(gm.publicados().length, 1);
  assert.equal(portas.envios.length, 0, 'esta aba nunca navega quando outra já tentou');
});

test('códigos de erro enviados ao CRM vêm de uma lista fechada', () => {
  assert.equal(api.codigoDoErro('A solicitação expirou ou possui horário inválido. Envie novamente pelo CRM.'), 'expirado');
  assert.equal(api.codigoDoErro('Existe um registro persistido de execução anterior (estado: indeterminado). Confira'), 'bloqueio-persistido');
  assert.equal(api.codigoDoErro('Já existe um título aguardando processamento. Aguarde a conclusão antes de enviar outro.'), 'pedido-pendente');
  assert.equal(api.codigoDoErro('Abra a Consulta de títulos no Systextil. Nenhum campo foi alterado.'), 'tela-ausente');
  assert.equal(api.codigoDoErro('Qualquer outra coisa'), undefined);
  assert.equal(api.codigoDoErro(undefined), undefined);
});

/* ---------------------------------------------------------------------
 * Invariantes de segurança do código que depende da página (não roda sem o ERP)
 * --------------------------------------------------------------------- */
const fs = require('node:fs');
const path = require('node:path');
const FONTE = fs.readFileSync(path.join(__dirname, '..', 'userscripts', 'systextil-segunda-via.user.js'), 'utf8');

function corpoDaFuncao(nome) {
  const inicio = FONTE.search(new RegExp('(async )?function ' + nome + '\\('));
  assert.ok(inicio >= 0, 'função ' + nome + ' não encontrada');
  const proxima = FONTE.slice(inicio + 10).search(/\n  (async )?function \w+\(/);
  return FONTE.slice(inicio, proxima < 0 ? undefined : inicio + 10 + proxima);
}

test('só o formulário do Buscar programas é enviado: um único requestSubmit, sem .submit(), sem teclas', () => {
  assert.equal((FONTE.match(/\.requestSubmit\(\)/g) || []).length, 1, 'uma única chamada de requestSubmit em todo o script');
  assert.doesNotMatch(FONTE, /\.submit\(/);
  const corpo = corpoDaFuncao('garantirConsultaDeTitulos');
  assert.match(corpo, /campoBusca\.isConnected \? campoBusca\.form : null/);
  assert.match(corpo, /campoBusca\.value === PROGRAMA_CONSULTA_TITULOS/);
  assert.match(FONTE, /const PROGRAMA_CONSULTA_TITULOS = "crec_f090";/);
  assert.equal((FONTE.match(/"crec_f090"/g) || []).length, 1, 'o código digitado no Buscar programas vem só da constante');
});

test('a emissão de cada título do lote: um clique, conferido de novo imediatamente antes, nunca repetido', () => {
  const corpo = corpoDaFuncao('acionarEmissaoDoTitulo');
  assert.equal((corpo.match(/botaoEmitir\.click\(\)/g) || []).length, 1);
  const clique = corpo.indexOf('botaoEmitir.click()');
  ['lerEstadoSystextil(pagina)', 'lerCamposConsulta()', 'JANELA_BLOQUEIO_EMISSAO_MS', 'verificarCancelamento()', 'emissaoClicada = true'].forEach(trecho => {
    const posicao = corpo.indexOf(trecho);
    assert.ok(posicao >= 0 && posicao < clique, trecho + ' deve vir antes do clique');
  });
  assert.match(corpo, /erro\.emissaoClicada = emissaoClicada/);
  // Cada conferência, se falhar, impede o clique.
  assert.match(corpo, /estado\.busca !== false\) \{\s+throw new Error\("A Consulta de títulos mudou depois da conferência\. Nenhuma emissão foi solicitada\."\)/);
  assert.match(corpo, /!atuais\.cliente\s+\) \{\s+throw new Error\("O registro na tela mudou depois da conferência\. Nenhuma emissão foi solicitada\."\)/);
  assert.match(corpo, /JANELA_BLOQUEIO_EMISSAO_MS\s+\) \{\s+throw new Error\("Este título\/parcela já teve uma emissão solicitada nos últimos cinco minutos/);
  assert.match(corpo, /botaoEmitir\.disabled\) \{\s+throw new Error\("O botão Emite boleto não está disponível\. Nenhuma emissão foi solicitada\."\)/);
  // Só dois pontos emitem boleto em todo o script: o pedido de um título e o lote.
  assert.equal((FONTE.match(/botaoEmitir\.click\(\)/g) || []).length, 2);
});

test('o lote assume o pedido antes de consultar e nunca relança o erro depois de gravar o estado incerto', () => {
  const corpo = corpoDaFuncao('executarLote');
  const apagaPedido = corpo.indexOf('gravarChave(CHAVES.pedido, null)');
  const laco = corpo.indexOf('executarLoteEmissao(');
  assert.ok(apagaPedido >= 0 && laco > apagaPedido, 'o pedido precisa ser apagado antes de emitir');
  assert.equal((corpo.match(/throw erro/g) || []).length, 1, 'o único relançamento é o de antes de existir estado gravado');
  assert.match(corpo, /if \(!atual \|\| atual\.pedidoId !== lote\.id\) throw erro;/);
  assert.doesNotMatch(corpo, /btnFind|clicarBarraConsulta/);
});

test('fora da Consulta de títulos o pedido não vira mais erro terminal', () => {
  const corpo = corpoDaFuncao('consumirPedido');
  assert.match(corpo, /garantirConsultaDeTitulos\(pedido, pagina\)/);
  assert.doesNotMatch(corpo, /Abra a Consulta de títulos no Systextil para iniciar a automação/);
  assert.doesNotMatch(FONTE, /aguardarVisao\(pagina, VISAO_CONSULTA, 25000\)/);
});

test('o lote é retomado nos três pontos em que o pedido de um título já era retomado', () => {
  assert.equal((FONTE.match(/void retomarProcessos\(pagina, /g) || []).length, 3);
  assert.match(FONTE, /novo\?\.status === "lote-emitido"/);
  assert.equal((FONTE.match(/\["emissao-solicitada", "processando", "lote-emitido", "lote-baixando"\]\.includes\(execucao\?\.status\)/g) || []).length, 2);
  ['lote-emitindo', 'lote-emitido', 'lote-baixando'].forEach(estado => {
    assert.match(corpoDaFuncao('obterExecucaoAtiva'), new RegExp('"' + estado + '"'));
  });
});

test('o intervalo entre emissões é o padrão da fase de emissão e a recuperação manual limpa a marca de navegação', () => {
  assert.match(FONTE, /intervaloMs = INTERVALO_ENTRE_EMISSOES_MS/);
  assert.match(corpoDaFuncao('recuperarBloqueioManual'), /gravarChave\(CHAVES\.navegacao, null\)/);
});
