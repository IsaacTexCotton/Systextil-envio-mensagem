'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SCRIPT_PATH = path.join(__dirname, '..', 'userscripts', 'systextil-segunda-via.user.js');
const SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');
const api = require(SCRIPT_PATH);

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
    ...overrides
  };
}

function formatarDataHora(timestamp) {
  const d = new Date(timestamp);
  const pad = valor => String(valor).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

test('expõe a versão unificada e valida a transferência recebida do SmartTable', () => {
  assert.equal(api.VERSION, '1.0.6');
  const pedido = api.validarPedido(pedidoValido());
  assert.equal(pedido.titulo, '00001234');
  assert.equal(pedido.parcela, '03');
  assert.equal(pedido.cnpj, '12345678000190');
  assert.equal(pedido.razaoSocial, 'EMPRESA TESTE LTDA');
});

test('rejeita solicitação expirada, CNPJ inválido e códigos com caracteres não permitidos', () => {
  assert.throws(
    () => api.validarPedido(pedidoValido({ createdAt: Date.now() - 6 * 60 * 1000 })),
    /expirou/
  );
  assert.throws(
    () => api.validarPedido(pedidoValido({ cnpj: '1234' })),
    /CNPJ/
  );
  assert.throws(
    () => api.validarPedido(pedidoValido({ titulo: '12/34' })),
    /Número do título/
  );
  assert.throws(
    () => api.validarPedido(pedidoValido({ parcela: '' })),
    /Parcela/
  );
});

test('encontra o valor exato do campo NXJ mesmo quando outros segmentos vêm depois', () => {
  const segmentos = api.extrairValoresPendentesNxj('\f936520\fMETADADO\fOUTRO');
  assert.deepEqual(segmentos, ['936520', 'METADADO', 'OUTRO']);
  assert.ok(segmentos.includes('936520'));
  assert.equal(segmentos.includes('93652'), false);
});

test('usa o controle Find do ERP em vez de simular a tecla F7', () => {
  assert.match(SOURCE, /find:\s*"btnFind\."/);
  assert.match(SOURCE, /clicarBarraConsulta\("find"\)/);
  assert.doesNotMatch(SOURCE, /pressionarF7|KeyboardEvent|key:\s*["']F7["']/);
});

test('normaliza zeros à esquerda somente durante a comparação dos códigos', () => {
  assert.equal(api.normalizarCodigoComparacao('00012345'), '12345');
  assert.equal(api.normalizarCodigoComparacao('12345'), '12345');
  assert.equal(api.normalizarCodigoComparacao('03'), '3');
  assert.equal(api.normalizarCodigoComparacao('AB-12'), 'AB-12');
});

test('reconhece payload NXJ com zeros à esquerda e prefixo de campo', () => {
  assert.equal(api.valorConfere(['00012345'], '12345'), true);
  assert.equal(api.valorConfere(['seq_duplicatas.=03'], '3'), true);
  assert.equal(api.valorConfere(['campo:00012345'], '12345'), true);
  assert.equal(api.valorConfere(['00012346'], '12345'), false);
  assert.equal(api.valorConfere(['123456'], '12345'), false);
});

test('bloqueia a consulta quando o NXJ não confirma título e parcela', () => {
  assert.equal(
    api.validarConfirmacoesNxj({ titulo: 'NXJ', parcela: 'NXJ' }),
    true
  );
  assert.throws(
    () => api.validarConfirmacoesNxj({ titulo: 'PENDENTE', parcela: 'NXJ' }),
    /número do título.*Find foi bloqueado/
  );
  assert.throws(
    () => api.validarConfirmacoesNxj({ titulo: 'NXJ', parcela: 'PENDENTE' }),
    /parcela.*Find foi bloqueado/
  );
  assert.throws(
    () => api.validarConfirmacoesNxj({ titulo: 'PENDENTE', parcela: 'PENDENTE' }),
    /número do título e parcela.*Find foi bloqueado/
  );
});

test('exige a confirmação NXJ dos dois campos antes de acionar Find', () => {
  const confirmacao = SOURCE.indexOf('validarConfirmacoesNxj(preenchimento.confirmacoes)');
  const find = SOURCE.indexOf('clicarBarraConsulta("find")');
  assert.ok(confirmacao >= 0, 'barreira NXJ precisa existir');
  assert.ok(find > confirmacao, 'Find não pode ser acionado antes da barreira NXJ');
});

test('expira apenas preenchimento abandonado e preserva estados de resultado incerto', () => {
  const agora = 1_800_000_000_000;
  const antigo = agora - 31 * 60 * 1000;

  assert.equal(api.obterExecucaoAtiva({ status: 'preenchendo', criadoEm: antigo }, agora), false);
  assert.equal(api.obterExecucaoAtiva({ status: 'preenchendo', criadoEm: agora - 5 * 60 * 1000 }, agora), true);
  assert.equal(api.obterExecucaoAtiva({ status: 'emissao-solicitada', criadoEm: antigo }, agora), true);
  assert.equal(api.obterExecucaoAtiva({ status: 'processando', criadoEm: antigo }, agora), true);
  assert.equal(api.obterExecucaoAtiva({ status: 'baixando', criadoEm: antigo }, agora), true);
  assert.equal(api.obterExecucaoAtiva({ status: 'indeterminado', criadoEm: antigo }, agora), true);
  assert.equal(api.obterExecucaoAtiva({ status: 'preenchendo' }, agora), true);
});

test('oferece recuperação manual do estado persistido sem expirar resultado incerto automaticamente', () => {
  assert.match(SOURCE, /@grant\s+GM_registerMenuCommand/);
  assert.match(SOURCE, /Segunda via: liberar bloqueio após conferência manual/);

  const inicio = SOURCE.indexOf('async function recuperarBloqueioManual');
  const fim = SOURCE.indexOf('function registrarComandoRecuperacao', inicio);
  const trecho = SOURCE.slice(inicio, fim);
  const confirmacao = trecho.indexOf('window.confirm(resumo)');
  const primeiraLimpeza = trecho.indexOf('await gravarChave(CHAVES.execucao, null)');
  const revalidacao = trecho.indexOf('mesmoEstadoPersistido(execucaoInicial, execucaoAtual, pedidoInicial, pedidoAtual)');

  assert.ok(inicio >= 0 && fim > inicio);
  assert.ok(confirmacao >= 0 && primeiraLimpeza > confirmacao);
  assert.ok(revalidacao >= 0 && primeiraLimpeza > revalidacao);
  assert.match(trecho, /Processos agendados/);
  assert.match(trecho, /pasta Downloads/);
  assert.match(trecho, /CHAVES\.consumidor/);
  assert.match(trecho, /CHAVES\.lockProcesso/);
  assert.match(trecho, /CHAVES\.resultado/);
  assert.doesNotMatch(trecho, /executarConsultaCrm|botaoEmitir\.click/);

  assert.match(SOURCE, /registro persistido de execução anterior/);
  assert.doesNotMatch(SOURCE, /Já existe uma segunda via em andamento ou com resultado pendente de conferência/);
});

test('identifica somente um processo concluído dentro da janela da solicitação', () => {
  const solicitadoEm = Date.now();
  const resultado = api.analisarProcessos([{
    rowIndex: 0,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: formatarDataHora(solicitadoEm),
    mensagem: 'Processo concluído com sucesso.'
  }], {
    solicitadoEm,
    titulo: '00001234',
    parcela: '03'
  }, solicitadoEm + 1000);

  assert.equal(resultado.status, 'sucesso');
  assert.equal(resultado.registro.rowIndex, 0);
});

test('mantém mensagens intermediárias não vazias como em andamento', () => {
  const solicitadoEm = Date.now();
  const resultado = api.analisarProcessos([{
    rowIndex: 0,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: formatarDataHora(solicitadoEm),
    mensagem: 'Execução iniciada. Aguardando processamento.'
  }], {
    solicitadoEm,
    titulo: '00001234',
    parcela: '03'
  }, solicitadoEm + 1000);

  assert.equal(resultado.status, 'em-andamento');
  assert.match(resultado.mensagem, /grade será atualizada e analisada novamente/i);
});

test('interrompe o acompanhamento quando o ERP informa falha explícita', () => {
  const solicitadoEm = Date.now();
  const resultado = api.analisarProcessos([{
    rowIndex: 0,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: formatarDataHora(solicitadoEm),
    mensagem: 'Erro ao gerar o relatório.'
  }], {
    solicitadoEm,
    titulo: '00001234',
    parcela: '03'
  }, solicitadoEm + 1000);

  assert.equal(resultado.status, 'falha');
  assert.match(resultado.mensagem, /falha no processo/i);
});

test('captura a confirmação NXJ antes de escrever título e parcela', () => {
  const inicio = SOURCE.indexOf('async function preencherCamposConsulta');
  const fim = SOURCE.indexOf('function normalizarTextoProcesso', inicio);
  const trecho = SOURCE.slice(inicio, fim);

  const baselineTitulo = trecho.indexOf('const sequenciaAntesDoTitulo = monitor.obterSequencia()');
  const escritaTitulo = trecho.indexOf('atribuirValorCampo(campoTitulo, titulo)');
  const baselineParcela = trecho.indexOf('const sequenciaAntesDaParcela = monitor.obterSequencia()');
  const escritaParcela = trecho.indexOf('atribuirValorCampo(campoParcela, parcela)');

  assert.ok(baselineTitulo >= 0 && baselineTitulo < escritaTitulo);
  assert.ok(baselineParcela >= 0 && baselineParcela < escritaParcela);
});

test('atualiza Processos agendados pelo sininho e aguarda a grade', () => {
  const inicio = SOURCE.indexOf('async function atualizarGradeProcessos');
  const fim = SOURCE.indexOf('async function iniciarDownloadAutomatico', inicio);
  const trecho = SOURCE.slice(inicio, fim);

  assert.match(trecho, /acharPorId\("procAgendados"\)/);
  assert.match(trecho, /botaoProcessos\.click\(\)/);
  assert.match(trecho, /tempoMinimoAtualizacaoMs = 4000/);
  assert.match(trecho, /await aguardarOcioso\(monitor, 20000\)/);
  assert.doesNotMatch(trecho, /btnFind\./);
});

test('atualiza a grade antes da primeira leitura dos processos', () => {
  const inicio = SOURCE.indexOf('async function executarProcessosAutomaticamente');
  const fim = SOURCE.indexOf('async function receberPedidoCrm', inicio);
  const trecho = SOURCE.slice(inicio, fim);
  const primeiraAtualizacao = trecho.indexOf('await atualizarGradeProcessos(pagina, monitor)');
  const primeiraLeitura = trecho.indexOf('lerRegistrosProcessos()');

  assert.ok(primeiraAtualizacao >= 0);
  assert.ok(primeiraLeitura > primeiraAtualizacao);
});

test('bloqueia resultado ambíguo de processos', () => {
  const solicitadoEm = Date.now();
  const dataExecucao = formatarDataHora(solicitadoEm);
  const registros = [0, 1].map(rowIndex => ({
    rowIndex,
    titulo: 'Emissão de boletos com registro',
    dataExecucao,
    mensagem: 'Processo concluído com sucesso.'
  }));

  const resultado = api.analisarProcessos(registros, {
    solicitadoEm,
    titulo: '00001234',
    parcela: '03'
  }, solicitadoEm);

  assert.equal(resultado.status, 'ambiguo');
});

test('valida a URL do relatório antes de permitir o download', () => {
  const base = 'https://systextil.texcotton.com.br/systextil/forms.systextil.batch';
  const url = '/systextil/download/relatorio-123.pdf?ext=pdf&report=relatorio-123.jrprint&program=forms.crec.crec_e259';
  assert.match(api.validarUrlPdf(url, base), /relatorio-123.pdf/);

  assert.throws(
    () => api.validarUrlPdf('https://outro.exemplo/arquivo.pdf', base),
    /outra origem/
  );
  assert.throws(
    () => api.validarUrlPdf('/systextil/download/relatorio-123.pdf?ext=html&report=relatorio-123.jrprint&program=forms.crec.crec_e259', base),
    /formato PDF/
  );
});

test('valida assinatura e marcador final do PDF antes de salvar', () => {
  const bytes = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const validado = api.validarBytesPdf(bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ));
  assert.equal(validado.byteLength, bytes.byteLength);

  const html = Buffer.from('<html>sessao expirada</html>');
  assert.throws(
    () => api.validarBytesPdf(html.buffer.slice(html.byteOffset, html.byteOffset + html.byteLength)),
    /assinatura/
  );
});

test('entrega um único userscript, sem painéis auxiliares nem serviço Windows', () => {
  assert.match(SOURCE, /@match\s+https:\/\/texhub\.texcotton\.com\.br\/crm\//);
  assert.match(SOURCE, /@match\s+https:\/\/systextil\.texcotton\.com\.br\/systextil\//);
  assert.match(SOURCE, /GM_download/);
  assert.match(SOURCE, /saveAs:\s*false/);
  assert.match(SOURCE, /titulo:\s*"num_duplicata\."/);
  assert.match(SOURCE, /parcela:\s*"seq_duplicatas\."/);
  assert.doesNotMatch(SOURCE, /pressionarF7|KeyboardEvent|key:\s*["']F7["']/);
  assert.doesNotMatch(SOURCE, /127\.0\.0\.1:17834|BoletoHelper\.ps1|PowerShell/);
  assert.doesNotMatch(SOURCE, /window\.__systextilSegundaViaAutomatica\s*=\s*Object\.freeze\(\{[\s\S]*?preencherCamposConsulta/);
});
