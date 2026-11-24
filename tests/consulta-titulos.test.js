'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SCRIPT_PATH = path.join(__dirname, '..', 'userscripts', 'systextil-consulta-titulos.user.js');
const SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');
const REFERENCIA_PATH = path.join(__dirname, '..', 'docs', 'referencia-tecnica-nxj-systextil.md');
const api = require(SCRIPT_PATH);

const CONFIG_RAPIDA = Object.freeze({
  atrasoFocoInicialMs: 0,
  atrasoAntesDeSairCampoMs: 0,
  atrasoAposSairCampoMs: 0,
  pausaAposNovaConsultaMs: 0,
  silencioMs: 5,
  intervaloMs: 2,
  limiteEsperaMs: 400,
  limiteNovaConsultaMs: 300,
  graciaModoConsultaMs: 60,
  limiteResultadoMs: 600,
  limiteLeituraMs: 400,
  estabilidadeLeituraMs: 5
});

// ---------------------------------------------------------------------------
// Entrada, normalização e regras puras
// ---------------------------------------------------------------------------

test('interpreta linhas com 5 colunas (tab ou ponto e vírgula) e com 4 colunas sem cliente', () => {
  const entrada = [
    '# comentário ignorado',
    '',
    'Empresa;Cliente;Número;Parcela;Tipo',
    '1;12.345.678/0001-00;00123456;1;1',
    '1\t\t777\t2\t1',
    '  1 ; 98765432000100 ; 555 ; 01 ; 3  ',
    '2;900;1;4',
    '2\t\t901\t1\t4\t\t'
  ].join('\n');

  const { itens, erros } = api.interpretarEntradaTitulos(entrada);

  assert.deepEqual(erros, []);
  assert.equal(itens.length, 5);
  assert.deepEqual(
    itens.map(item => [item.linha, item.empresa, item.numero, item.parcela, item.tipo]),
    [
      [4, '1', '00123456', '1', '1'],
      [5, '1', '777', '2', '1'],
      [6, '1', '555', '01', '3'],
      [7, '2', '900', '1', '4'],
      [8, '2', '901', '1', '4']
    ]
  );
  assert.equal(itens[0].cliente.tipo, 'CNPJ');
  assert.equal(itens[0].clienteInformado, '12.345.678/0001-00');
  assert.equal(itens[1].cliente, null);
  assert.equal(itens[3].cliente, null);
});

test('preserva zeros à esquerda do número, da parcela e do tipo (nunca converte em número)', () => {
  const { itens } = api.interpretarEntradaTitulos('01;;000123;01;001');
  assert.equal(itens[0].empresa, '01');
  assert.equal(itens[0].numero, '000123');
  assert.equal(itens[0].parcela, '01');
  assert.equal(itens[0].tipo, '001');
});

test('rejeita operadores de busca múltipla, caracteres inválidos, campos vazios e colunas erradas', () => {
  const casos = [
    ['1;;123,456;1;1', /Número do título.*vírgula nem hífen/],
    ['1;;123-456;1;1', /Número do título.*vírgula nem hífen/],
    ['1;;123;1,2;1', /Parcela.*vírgula nem hífen/],
    ['1;;123;1;1-3', /Tipo do título.*vírgula nem hífen/],
    ['1;;12 3;1;1', /Número do título contém caracteres não permitidos/],
    ['1;;123;;1', /Parcela não informado/],
    [';;123;1;1', /Empresa não informado/],
    ['1;;123;1', /Número do título não informado/],
    ['1;123', /Esperadas 5 colunas/],
    ['1;;123;1;1;extra', /Esperadas 5 colunas/],
    ['1;1234;123;1;1', /11 dígitos \(CPF\) ou 14 dígitos \(CNPJ\)/],
    ['1;ABC;123;1;1', /apenas o CNPJ\/CPF/],
    ['1;;' + '9'.repeat(21) + ';1;1', /excede 20 caracteres/]
  ];

  for (const [linha, esperado] of casos) {
    const { itens, erros } = api.interpretarEntradaTitulos(linha);
    assert.deepEqual(itens, [], 'não pode iniciar lote parcial: ' + linha);
    assert.equal(erros.length, 1, linha);
    assert.match(erros[0].mensagem, esperado, linha);
    assert.equal(erros[0].linha, 1);
  }
});

test('uma linha inválida bloqueia o lote inteiro e identifica a linha', () => {
  const { itens, erros } = api.interpretarEntradaTitulos('1;;100;1;1\n1;;abc-1;1;1\n1;;101;1;1');
  assert.deepEqual(itens, []);
  assert.deepEqual(erros.map(erro => erro.linha), [2]);
});

test('bloqueia título repetido (comparando zeros à esquerda) e entrada vazia', () => {
  const repetido = api.interpretarEntradaTitulos('1;;0100;1;1\n1;;100;01;1');
  assert.deepEqual(repetido.itens, []);
  assert.match(repetido.erros[0].mensagem, /Título repetido.*linha 1/);
  assert.equal(repetido.erros[0].linha, 2);

  assert.match(api.interpretarEntradaTitulos('').erros[0].mensagem, /Nenhum título informado/);
  assert.match(api.interpretarEntradaTitulos('# só comentário\n\n').erros[0].mensagem, /Nenhum título informado/);
  assert.match(api.interpretarEntradaTitulos(null).erros[0].mensagem, /Nenhum título informado/);
});

test('limita o lote a 50 títulos e a entrada a 200 linhas', () => {
  const cinquenta = Array.from({ length: 50 }, (_, i) => '1;;' + (1000 + i) + ';1;1').join('\n');
  assert.equal(api.interpretarEntradaTitulos(cinquenta).itens.length, 50);

  const cinquentaEUm = cinquenta + '\n1;;2000;1;1';
  const resultado = api.interpretarEntradaTitulos(cinquentaEUm);
  assert.deepEqual(resultado.itens, []);
  assert.match(resultado.erros[0].mensagem, /Máximo de 50 títulos/);

  const demais = Array.from({ length: 201 }, () => '# x').join('\n');
  assert.match(api.interpretarEntradaTitulos(demais).erros[0].mensagem, /excede 200 linhas/);
});

test('divide CNPJ e CPF (com ou sem máscara) nas partes dos campos do cliente', () => {
  assert.deepEqual(
    api.dividirDocumentoCliente('12.345.678/0001-00'),
    { tipo: 'CNPJ', base: '012345678', ordem: '0001', digito: '00' }
  );
  assert.deepEqual(
    api.dividirDocumentoCliente('12345678000100'),
    { tipo: 'CNPJ', base: '012345678', ordem: '0001', digito: '00' }
  );
  assert.deepEqual(
    api.dividirDocumentoCliente('123.456.789-09'),
    { tipo: 'CPF', base: '123456789', ordem: '0000', digito: '09' }
  );
  assert.equal(api.dividirDocumentoCliente(''), null);
  assert.equal(api.dividirDocumentoCliente('   '), null);
  assert.throws(() => api.dividirDocumentoCliente('1234567890123'), /11 dígitos \(CPF\) ou 14/);
  assert.throws(() => api.dividirDocumentoCliente('12.345.678/0001-0X'), /apenas o CNPJ\/CPF/);
});

test('compara códigos ignorando zeros à esquerda apenas quando numéricos', () => {
  assert.equal(api.normalizarCodigoComparacao('0001'), '1');
  assert.equal(api.normalizarCodigoComparacao('0000'), '0');
  assert.equal(api.normalizarCodigoComparacao('a01'), 'A01');
  assert.equal(api.normalizarCodigoComparacao(null), '');
});

test('interpreta valores monetários brasileiros em centavos e recusa formatos ambíguos', () => {
  assert.equal(api.lerValorMonetario('0,00'), 0);
  assert.equal(api.lerValorMonetario('1.234,56'), 123456);
  assert.equal(api.lerValorMonetario('-12,30'), -1230);
  assert.equal(api.lerValorMonetario('1.234.567,89'), 123456789);
  assert.equal(api.lerValorMonetario('1.234'), null);
  assert.equal(api.lerValorMonetario('1234.56'), null);
  assert.equal(api.lerValorMonetario(''), null);
  assert.equal(api.lerValorMonetario('abc'), null);
});

test('descreve a situação financeira conforme a documentação da tela', () => {
  assert.equal(api.descreverSituacao('0'), 'Em aberto');
  assert.equal(api.descreverSituacao('1'), 'Pago total');
  assert.equal(api.descreverSituacao('2'), 'Cancelado');
  assert.equal(api.descreverSituacao('3'), 'Pago a menor');
  assert.equal(api.descreverSituacao('4'), 'Pago a maior');
  assert.equal(api.descreverSituacao('9'), 'Código não documentado');
  assert.equal(api.descreverSituacao(''), '');
});

test('alerta somente quando título cancelado exibe saldo diferente de zero (não recalcula saldo)', () => {
  assert.deepEqual(api.avaliarAlertas({
    'situacao_duplic.': '2', 'saldo_duplicata.': '0,00', 'saldo_duplicata_ch.': '0,00', 'saldo_moeda.': '0,00'
  }), []);

  const alertas = api.avaliarAlertas({
    'situacao_duplic.': '2', 'saldo_duplicata.': '10,00', 'saldo_duplicata_ch.': '0,00', 'saldo_moeda.': '5,00'
  });
  assert.equal(alertas.length, 2);
  assert.match(alertas[0], /cancelado.*Saldo diferente de zero/);

  // Saldo em aberto é capturado como exibido, sem alerta.
  assert.deepEqual(api.avaliarAlertas({ 'situacao_duplic.': '0', 'saldo_duplicata.': '150,00' }), []);
  assert.deepEqual(api.avaliarAlertas({ 'situacao_duplic.': '7' }), ['Código de situação não documentado.']);
});

test('compara a chave solicitada com a lida e trata campo vazio como divergência', () => {
  const [item] = api.interpretarEntradaTitulos('1;12.345.678/0001-00;00123;1;1').itens;
  const lido = {
    'codigo_empresa.': '1', 'num_duplicata.': '123', 'seq_duplicatas.': '01', 'tipo_titulo.': '1',
    'cli_dup_cgc_cli_r.': '12345678', 'cli_dup_cgc_cli_o.': '1', 'cli_dup_cgc_cli2.': '0'
  };

  assert.deepEqual(api.compararChave(item, lido), []);
  assert.deepEqual(api.compararChave(item, { ...lido, 'seq_duplicatas.': '2' }), ['Parcela']);
  assert.deepEqual(api.compararChave(item, { ...lido, 'num_duplicata.': '' }), ['Número do título']);
  assert.deepEqual(
    api.compararChave(item, { ...lido, 'cli_dup_cgc_cli_o.': '2', 'cli_dup_cgc_cli2.': '' }),
    ['Cliente (ordem)', 'Cliente (dígito)']
  );

  const [semCliente] = api.interpretarEntradaTitulos('1;;123;1;1').itens;
  assert.deepEqual(api.compararChave(semCliente, { ...lido, 'cli_dup_cgc_cli_r.': '999' }), []);
});

test('neutraliza injeção de fórmula na exportação, preservando números simples', () => {
  assert.equal(api.neutralizarCelulaPlanilha('=1+1'), "'=1+1");
  assert.equal(api.neutralizarCelulaPlanilha('@SOMA(A1)'), "'@SOMA(A1)");
  assert.equal(api.neutralizarCelulaPlanilha('+55 11'), "'+55 11");
  assert.equal(api.neutralizarCelulaPlanilha('-cmd'), "'-cmd");
  assert.equal(api.neutralizarCelulaPlanilha('-1.234,56'), '-1.234,56');
  assert.equal(api.neutralizarCelulaPlanilha('Cliente Normal'), 'Cliente Normal');
  assert.equal(api.neutralizarCelulaPlanilha(null), '');
  assert.equal(api.neutralizarCelulaPlanilha('a\u0000b'), 'ab');
});

test('exporta TSV/CSV com todos os campos lidos, sem fórmula e com escape de aspas e quebras', () => {
  const resultados = [
    {
      linha: 1, empresa: '1', clienteSolicitado: '12345678000100', numero: '123', parcela: '1', tipo: '1',
      status: 'ok', mensagem: '', alertas: ['Atenção; teste'],
      valores: {
        'situacao_duplic.': '2', 'saldo_duplicata.': '0,00', 'nome_cliente.': 'ACME "TESTE"\nLTDA',
        'compl_historico.': '=HYPERLINK("x")'
      }
    },
    { linha: 2, empresa: '1', clienteSolicitado: '', numero: '9', parcela: '1', tipo: '1', status: 'nao-encontrado', mensagem: 'Nenhum registro.' }
  ];

  const csv = api.montarCsv(resultados);
  const linhas = csv.split('\r\n');
  assert.equal(linhas.length, 3);
  assert.match(linhas[0], /^Linha;Empresa \(solicitada\);Cliente \(solicitado\);/);
  assert.match(linhas[0], /Situação \[situacao_duplic\.\]/);
  assert.match(linhas[0], /Nome do cliente \[nome_cliente\.\]/);
  assert.ok(csv.includes('"ACME ""TESTE""\nLTDA"'), 'aspas e quebra de linha escapadas');
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'), 'fórmula neutralizada');
  assert.match(linhas[1], /Cancelado/);
  assert.match(linhas[2], /Título não encontrado/);

  const tsv = api.montarTsv(resultados);
  assert.equal(tsv.split('\r\n').length, 3);
  assert.ok(!tsv.split('\r\n')[1].includes('\n'));
  assert.ok(tsv.includes('ACME "TESTE" LTDA'));
});

test('o atalho exige exatamente Alt+Shift+Q e ignora repetição e outras combinações', () => {
  const base = { code: 'KeyQ', altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, repeat: false };
  assert.equal(api.atalhoPressionado(base), true);
  assert.equal(api.atalhoPressionado({ ...base, repeat: true }), false);
  assert.equal(api.atalhoPressionado({ ...base, ctrlKey: true }), false);
  assert.equal(api.atalhoPressionado({ ...base, shiftKey: false }), false);
  assert.equal(api.atalhoPressionado({ ...base, altKey: false }), false);
  assert.equal(api.atalhoPressionado({ ...base, code: 'F7' }), false);
  assert.equal(api.atalhoPressionado({ ...base, metaKey: true }), false);
});

// ---------------------------------------------------------------------------
// Catálogo de campos versus a referência técnica
// ---------------------------------------------------------------------------

test('o catálogo cobre todos os campos da referência NXJ (seção 7.1) e não tem nomes repetidos', () => {
  const referencia = fs.readFileSync(REFERENCIA_PATH, 'utf8');
  const inicio = referencia.indexOf('### 7.1 Campos identificados');
  const fim = referencia.indexOf('### 7.2', inicio);
  assert.ok(inicio >= 0 && fim > inicio, 'seção 7.1 da referência precisa existir');

  const nomesReferencia = new Set();
  for (const linha of referencia.slice(inicio, fim).split('\n')) {
    if (!linha.startsWith('|') || /^\|\s*(Grupo|---)/.test(linha)) continue;
    const celulas = linha.split('|').map(celula => celula.trim());
    for (const nome of celulas[2].split(',').map(parte => parte.trim()).filter(Boolean)) {
      nomesReferencia.add(nome);
    }
  }

  const nomesCatalogo = api.CATALOGO_CAMPOS.flatMap(grupo => grupo.campos.map(campo => campo.name));
  assert.equal(new Set(nomesCatalogo).size, nomesCatalogo.length, 'nomes repetidos no catálogo');
  assert.ok(nomesCatalogo.every(nome => nome.endsWith('.') || nome === undefined), 'o ponto final faz parte do name');

  // superCountLabel. é um rótulo de contagem de registros, não dado do título.
  const intencionalmenteFora = new Set(['superCountLabel.']);
  const faltando = [...nomesReferencia].filter(nome => !nomesCatalogo.includes(nome) && !intencionalmenteFora.has(nome));
  const extras = nomesCatalogo.filter(nome => !nomesReferencia.has(nome));

  assert.deepEqual(faltando, [], 'campos da referência fora do catálogo');
  assert.deepEqual(extras, [], 'campos do catálogo que a referência não registra');
  assert.ok(nomesReferencia.size > 80);
});

// ---------------------------------------------------------------------------
// ERP simulado: XHR + DOM + comandos NXJ
// ---------------------------------------------------------------------------

const NOMES = Object.freeze({
  empresa: 'codigo_empresa.', nomeEmpresa: 'nome_empresa.',
  numero: 'num_duplicata.', parcela: 'seq_duplicatas.',
  tipo: 'tipo_titulo.', nomeTipo: 'nome_tipo.',
  base: 'cli_dup_cgc_cli_r.', ordem: 'cli_dup_cgc_cli_o.', digito: 'cli_dup_cgc_cli2.',
  nomeCliente: 'nome_cliente.'
});

const DADOS_FICTICIOS = Object.freeze({
  'situacao_duplic.': '0', 'data_emissao.': '01/10/2026', 'data_venc_duplic.': '01/11/2026',
  'valor_duplicata.': '150,00', 'saldo_duplicata.': '150,00', 'saldo_duplicata_ch.': '150,00',
  'saldo_moeda.': '150,00', 'portador_duplic.': '1', 'descricao.': 'PORTADOR TESTE',
  'pedido_venda.': '4321', 'cod_barras.': '', 'compl_historico.': 'HISTÓRICO FICTÍCIO'
});

function titulo(sobrescritas = {}) {
  return {
    empresa: '1', numero: '123456', parcela: '1', tipo: '1',
    cliente: { base: '012345678', ordem: '0001', digito: '00' },
    nomeCliente: 'CLIENTE FICTICIO LTDA',
    campos: { ...DADOS_FICTICIOS },
    ...sobrescritas
  };
}

function criarErpFake(opcoes = {}) {
  const comandos = [];
  const cliques = [];
  const confirmados = {};
  let campoAtivo = null; // campo ativo segundo o ERP (muda só em eventos de foco)
  let foco = null; // document.activeElement

  const titulos = opcoes.titulos ?? [titulo()];
  const empresas = opcoes.empresas ?? { 1: 'EMPRESA FICTICIA' };
  const tipos = opcoes.tipos ?? { 1: 'DUPLICATA' };
  const latencia = opcoes.latenciaMs ?? 2;

  class XMLHttpRequestFake {
    constructor() { this.ouvintes = []; this.status = 200; }
    open(metodo, url) { this.metodo = String(metodo).toUpperCase(); this.url = String(url); }
    addEventListener(tipo, callback) { if (tipo === 'loadend') this.ouvintes.push(callback); }
    send() {
      const efeito = this.efeito;
      this.status = typeof opcoes.status === 'function' ? opcoes.status(this.comando) : 200;
      setTimeout(() => {
        if (efeito && this.status < 300) efeito();
        for (const callback of this.ouvintes) callback.call(this);
      }, latencia);
    }
  }

  // Cada requisição precisa passar pelo send patchado do monitor, como no ERP real.
  function postar(comando, valor, efeito) {
    const xhr = new pagina.XMLHttpRequest();
    xhr.comando = comando;
    xhr.efeito = efeito;
    comandos.push(comando);
    xhr.open('POST', '/systextil/UnifyNXJ.jsp');
    xhr.send(new URLSearchParams({ commandName: comando, fieldValues: valor === undefined ? '' : '\f' + valor }).toString());
  }

  const pagina = {
    curDataView: { name: opcoes.visao ?? 'forms.crec.crec_f090', find: true, recordAction: '', recordCount: 0, recordNumber: 0 },
    XMLHttpRequest: XMLHttpRequestFake,
    URLSearchParams,
    frames: { length: 0 },
    Event
  };

  const campos = {};
  function criarCampo(name, extras = {}) {
    const campo = {
      name, value: '', disabled: false, readOnly: false, type: 'text',
      ownerDocument: { defaultView: pagina },
      dispatchEvent() { return true; },
      blur() {
        if (foco === this) foco = null;
      },
      focus() {
        // Como no DOM real: focar o elemento já focado não dispara evento.
        if (foco === this) return;
        foco = this;
        if (campoAtivo && campoAtivo !== this) {
          const anterior = campoAtivo;
          const valor = anterior.value;
          if (opcoes.semSaida !== anterior.name) {
            const enviar = opcoes.semValorNoPost === anterior.name ? undefined : valor;
            postar('ClickOnField', enviar, () => {
              if (enviar !== undefined) confirmados[anterior.name] = valor;
              aplicarCarregamentos(anterior.name);
            });
          }
          if (opcoes.limparVisualAoSair === anterior.name) anterior.value = '';
          if (opcoes.recriarAoSair === anterior.name) campos[anterior.name] = criarCampo(anterior.name, { value: anterior.value });
        }
        campoAtivo = this;
      },
      ...extras
    };
    return campo;
  }

  function nomeCamposDados() { return Object.keys(DADOS_FICTICIOS); }

  const todosNomes = [
    ...Object.values(NOMES), ...nomeCamposDados(), 'situacao_duplic.'
  ];
  for (const nome of new Set(todosNomes)) campos[nome] = criarCampo(nome);
  for (const [nome, extras] of Object.entries(opcoes.camposExtras ?? {})) Object.assign(campos[nome], extras);
  if (opcoes.empresaInicial) campos[NOMES.empresa].value = opcoes.empresaInicial;

  function aplicarCarregamentos(nomeCampo) {
    if (nomeCampo === NOMES.empresa) campos[NOMES.nomeEmpresa].value = empresas[confirmados[NOMES.empresa]] ?? '';
    if (nomeCampo === NOMES.tipo) campos[NOMES.nomeTipo].value = tipos[confirmados[NOMES.tipo]] ?? '';
    if ([NOMES.base, NOMES.ordem, NOMES.digito].includes(nomeCampo) && opcoes.carregarCliente !== false) {
      const achado = titulos.find(item =>
        api.normalizarCodigoComparacao(item.cliente.base) === api.normalizarCodigoComparacao(confirmados[NOMES.base]) &&
        api.normalizarCodigoComparacao(item.cliente.ordem) === api.normalizarCodigoComparacao(confirmados[NOMES.ordem]) &&
        api.normalizarCodigoComparacao(item.cliente.digito) === api.normalizarCodigoComparacao(confirmados[NOMES.digito]));
      campos[NOMES.nomeCliente].value = achado ? achado.nomeCliente : '';
    }
  }

  function limparTela() {
    for (const campo of Object.values(campos)) {
      if (campo.readOnly) continue;
      campo.value = '';
    }
    for (const chave of Object.keys(confirmados)) delete confirmados[chave];
    campoAtivo = null;
    pagina.curDataView.find = true;
    pagina.curDataView.recordAction = '';
    pagina.curDataView.recordCount = 0;
    pagina.curDataView.recordNumber = 0;
  }

  function executarBusca() {
    const filtros = [
      ['empresa', NOMES.empresa], ['numero', NOMES.numero], ['parcela', NOMES.parcela], ['tipo', NOMES.tipo]
    ].filter(([, nome]) => confirmados[nome] !== undefined);
    const filtrosCliente = [['base', NOMES.base], ['ordem', NOMES.ordem], ['digito', NOMES.digito]]
      .filter(([, nome]) => confirmados[nome] !== undefined);

    const encontrados = titulos.filter(item =>
      filtros.every(([chave, nome]) => api.normalizarCodigoComparacao(item[chave]) === api.normalizarCodigoComparacao(confirmados[nome])) &&
      filtrosCliente.every(([parte, nome]) => api.normalizarCodigoComparacao(item.cliente[parte]) === api.normalizarCodigoComparacao(confirmados[nome])));

    if (encontrados.length === 0) {
      if (opcoes.semRegistro === 'permanece') return;
      pagina.curDataView.find = false;
      pagina.curDataView.recordAction = 'NO_RECORDS_FOUND';
      return;
    }

    const registro = encontrados[0];
    const exibir = { ...registro, ...(opcoes.exibirNoLugar?.(registro) ?? {}) };
    campos[NOMES.empresa].value = exibir.empresa;
    campos[NOMES.numero].value = exibir.numero;
    campos[NOMES.parcela].value = exibir.parcela;
    campos[NOMES.tipo].value = exibir.tipo;
    campos[NOMES.base].value = exibir.cliente.base;
    campos[NOMES.ordem].value = exibir.cliente.ordem;
    campos[NOMES.digito].value = exibir.cliente.digito;
    campos[NOMES.nomeCliente].value = exibir.nomeCliente;
    for (const [nome, valor] of Object.entries(registro.campos)) campos[nome].value = valor;

    pagina.curDataView.find = false;
    pagina.curDataView.recordAction = 'RECORDS_FOUND';
    pagina.curDataView.recordCount = encontrados.length;
    pagina.curDataView.recordNumber = 1;
  }

  function botao(id, comando, efeito) {
    return {
      id, disabled: false,
      click() {
        cliques.push(id);
        postar(comando, undefined, efeito);
      }
    };
  }

  const botoes = {
    'btnClearToFind.': botao('btnClearToFind.', 'CLEAR_TO_FIND', limparTela),
    'btnFind.': botao('btnFind.', 'FIND', executarBusca)
  };
  if (opcoes.semBotaoFind) delete botoes['btnFind.'];

  const documento = {
    get activeElement() { return foco; },
    getElementsByName(nome) { return campos[nome] ? [campos[nome]] : []; },
    getElementById(id) { return botoes[id] ?? null; }
  };
  pagina.document = documento;

  const send = XMLHttpRequestFake.prototype.send;
  const open = XMLHttpRequestFake.prototype.open;

  return {
    pagina, documento, campos, comandos, cliques, confirmados, titulos,
    prototipoIntacto() {
      return XMLHttpRequestFake.prototype.send === send && XMLHttpRequestFake.prototype.open === open;
    },
    opcoesLote(extras = {}) { return { pagina, documento, config: CONFIG_RAPIDA, ...extras }; }
  };
}

function itensDe(texto) {
  const { itens, erros } = api.interpretarEntradaTitulos(texto);
  assert.deepEqual(erros, []);
  return itens;
}

test('consulta um título: preenche na ordem da tela, confirma pelo NXJ, lê todos os campos e restaura o XHR', async () => {
  const erp = criarErpFake();
  const resultados = await api.consultarLote(itensDe('1;12.345.678/0001-00;123456;1;1'), erp.opcoesLote());

  assert.equal(resultados.length, 1);
  const [resultado] = resultados;
  assert.equal(resultado.status, 'ok', resultado.mensagem);
  assert.equal(resultado.valores['num_duplicata.'], '123456');
  assert.equal(resultado.valores['saldo_duplicata.'], '150,00');
  assert.equal(resultado.valores['nome_cliente.'], 'CLIENTE FICTICIO LTDA');
  assert.equal(resultado.valores['compl_historico.'], 'HISTÓRICO FICTÍCIO');
  assert.deepEqual(resultado.alertas, []);
  assert.ok(resultado.ausentes.includes('dt_ult_ocorrencia.'), 'campos inexistentes na tela vão para "ausentes", não viram vazio');
  assert.equal('dt_ult_ocorrencia.' in resultado.valores, false);

  // Find acionado uma única vez; só os dois controles permitidos foram clicados.
  assert.deepEqual(erp.cliques.filter(id => id === 'btnFind.'), ['btnFind.']);
  assert.ok(erp.cliques.every(id => ['btnClearToFind.', 'btnFind.'].includes(id)));
  assert.equal(erp.comandos.filter(comando => comando === 'FIND').length, 1);

  // Cada campo foi confirmado pelo servidor antes do Find (ordem da tela).
  assert.equal(erp.comandos.at(-1), 'FIND');
  assert.deepEqual(
    Object.keys(erp.confirmados),
    ['codigo_empresa.', 'cli_dup_cgc_cli_r.', 'cli_dup_cgc_cli_o.', 'cli_dup_cgc_cli2.', 'num_duplicata.', 'seq_duplicatas.', 'tipo_titulo.']
  );
  assert.equal(erp.confirmados['cli_dup_cgc_cli_r.'], '012345678');
  assert.equal(erp.confirmados['cli_dup_cgc_cli_o.'], '0001');
  assert.equal(erp.confirmados['tipo_titulo.'], '1');
  assert.ok(erp.prototipoIntacto(), 'monitor NXJ precisa ser removido ao final');
});

test('sem cliente informado: consulta, mas alerta que o cliente não foi conferido', async () => {
  const erp = criarErpFake();
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());

  assert.equal(resultado.status, 'ok', resultado.mensagem);
  assert.ok(resultado.alertas.some(alerta => /Cliente não informado/.test(alerta)));
  assert.equal('cli_dup_cgc_cli_r.' in erp.confirmados, false, 'nenhum campo de cliente foi preenchido');
});

test('lote: título inexistente é registrado e a consulta segue para o próximo', async () => {
  const erp = criarErpFake({ titulos: [titulo(), titulo({ numero: '222222', nomeCliente: 'OUTRO CLIENTE' })] });
  const progresso = [];
  const resultados = await api.consultarLote(
    itensDe('1;12345678000100;123456;1;1\n1;12345678000100;999999;1;1\n1;12345678000100;222222;1;1'),
    erp.opcoesLote({ aoProgresso: evento => progresso.push(evento.tipo + ':' + evento.indice + (evento.texto ? ':' + evento.texto : '')) })
  );

  assert.deepEqual(resultados.map(resultado => resultado.status), ['ok', 'nao-encontrado', 'ok']);
  assert.equal(resultados[1].valores, undefined, 'não extrai campos de título inexistente');
  assert.equal(resultados[2].valores['num_duplicata.'], '222222');
  assert.equal(erp.comandos.filter(comando => comando === 'FIND').length, 3);
  assert.deepEqual(
    progresso.filter(evento => !evento.startsWith('etapa:')),
    ['iniciando:0', 'resultado:0', 'iniciando:1', 'resultado:1', 'iniciando:2', 'resultado:2']
  );
  const etapas = progresso.filter(evento => evento.startsWith('etapa:'));
  assert.ok(etapas.some(evento => /Preenchendo Cliente \(ordem\)/.test(evento)));
  assert.ok(etapas.some(evento => /Consultando \(Find\)/.test(evento)));
  assert.equal(etapas.some(evento => /123456|222222|999999|CLIENTE/.test(evento)), false, 'etapas não podem conter dados do título');
});

test('regressão: o 2º título funciona mesmo com o foco ainda no primeiro campo (focus() sobre campo focado não gera evento)', async () => {
  const erp = criarErpFake({ titulos: [titulo(), titulo({ numero: '222222' }), titulo({ numero: '333333' })] });
  const resultados = await api.consultarLote(
    itensDe('1;12345678000100;123456;1;1\n1;12345678000100;222222;1;1\n1;;333333;1;1'),
    erp.opcoesLote()
  );

  assert.deepEqual(resultados.map(resultado => resultado.status), ['ok', 'ok', 'ok'], JSON.stringify(resultados.map(r => r.mensagem)));
  assert.equal(erp.comandos.filter(comando => comando === 'FIND').length, 3);
});

test('regressão: funciona quando a página sobrescreve Array.from (devolve vazio para Set)', async () => {
  const erp = criarErpFake();
  const original = Array.from;
  let resultados;

  Array.from = () => [];
  try {
    resultados = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());
  } finally {
    Array.from = original;
  }

  assert.equal(resultados[0].status, 'ok', resultados[0].mensagem);
});

test('o script não depende de Array.from nem de iterar Set/Map (o Systextil sobrescreve Array.from)', () => {
  const codigo = SOURCE.slice(SOURCE.indexOf('(function () {')).replace(/\/\/.*$/gm, '');
  assert.equal(/Array\.from\s*\(/.test(codigo), false);
  assert.equal(/\[\s*\.\.\.\s*(?:new\s+)?(?:Set|Map)/.test(codigo), false);
});

test('tela que permanece em modo de consulta sem registro vira "sem-resultado" (não afirma inexistência)', async () => {
  const erp = criarErpFake({ semRegistro: 'permanece' });
  const [resultado] = await api.consultarLote(itensDe('1;;999999;1;1'), erp.opcoesLote());

  assert.equal(resultado.status, 'sem-resultado');
  assert.match(resultado.mensagem, /confira manualmente/);
  assert.equal(resultado.valores, undefined);
});

test('mais de um registro: não lê nenhum e informa a ambiguidade', async () => {
  const erp = criarErpFake({ titulos: [titulo(), titulo({ nomeCliente: 'DUPLICADO' })] });
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());

  assert.equal(resultado.status, 'ambiguo');
  assert.match(resultado.mensagem, /2 registros/);
  assert.equal(resultado.valores, undefined);
});

test('registro exibido diverge do solicitado (filtro ignorado pelo ERP): descarta os dados', async () => {
  const erp = criarErpFake({ exibirNoLugar: () => ({ parcela: '2' }) });
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());

  assert.equal(resultado.status, 'divergente');
  assert.match(resultado.mensagem, /Parcela/);
  assert.match(resultado.mensagem, /Dados descartados/);
  assert.equal(resultado.valores, undefined, 'dados de outro título jamais são devolvidos como do solicitado');
});

test('cliente inexistente: bloqueia o Find daquele título e segue para o próximo', async () => {
  const erp = criarErpFake({ titulos: [titulo({ numero: '222222' })] });
  const resultados = await api.consultarLote(
    itensDe('1;99.999.999/0001-99;123456;1;1\n1;12345678000100;222222;1;1'),
    erp.opcoesLote()
  );

  assert.equal(resultados[0].status, 'cliente-invalido');
  assert.match(resultados[0].mensagem, /nome do cliente/);
  assert.equal(resultados[1].status, 'ok', resultados[1].mensagem);
  assert.equal(erp.comandos.filter(comando => comando === 'FIND').length, 1, 'Find só do título válido');
});

test('empresa ou tipo sem descrição carregada bloqueiam o Find', async () => {
  const empresaInvalida = criarErpFake();
  const [r1] = await api.consultarLote(itensDe('9;;123456;1;1'), empresaInvalida.opcoesLote());
  assert.equal(r1.status, 'empresa-invalida');
  assert.match(r1.mensagem, /nome da empresa/);
  assert.equal(empresaInvalida.comandos.includes('FIND'), false);

  const tipoInvalido = criarErpFake();
  const [r2] = await api.consultarLote(itensDe('1;;123456;1;77'), tipoInvalido.opcoesLote());
  assert.equal(r2.status, 'tipo-invalido');
  assert.match(r2.mensagem, /descrição do tipo/);
  assert.equal(tipoInvalido.comandos.includes('FIND'), false);
});

test('NXJ que recebe o comando sem o valor não confirma o campo: Find bloqueado e lote encerrado', async () => {
  const erp = criarErpFake({ semValorNoPost: 'seq_duplicatas.' });
  const resultados = await api.consultarLote(
    itensDe('1;;123456;1;1\n1;;222222;1;1'),
    erp.opcoesLote()
  );

  assert.equal(resultados[0].status, 'erro');
  assert.match(resultados[0].mensagem, /não confirmou pelo protocolo NXJ: Parcela/);
  assert.match(resultados[0].mensagem, /Find foi bloqueado/);
  assert.equal(resultados[1].status, 'nao-processado');
  assert.equal(erp.comandos.includes('FIND'), false);
  assert.ok(erp.prototipoIntacto());
});

test('ERP que não envia o comando de saída do campo: erro com diagnóstico sem valores e sem Find', async () => {
  const erp = criarErpFake({ semSaida: 'num_duplicata.' });
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());

  assert.equal(resultado.status, 'erro');
  assert.match(resultado.mensagem, /não enviou o comando NXJ esperado/);
  assert.match(resultado.mensagem, /Diagnóstico NXJ:/);
  assert.equal(resultado.mensagem.includes('123456'), false, 'a mensagem não pode vazar o número do título');
  assert.equal(erp.comandos.includes('FIND'), false);
  assert.ok(erp.prototipoIntacto());
});

test('resposta HTTP de erro no comando de saída interrompe antes do Find', async () => {
  const erp = criarErpFake({ status: comando => (comando === 'ClickOnField' ? 500 : 200) });
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());

  assert.equal(resultado.status, 'erro');
  assert.match(resultado.mensagem, /HTTP 500/);
  assert.equal(erp.comandos.includes('FIND'), false);
});

test('aceita campo que o ERP limpa visualmente ao sair quando o NXJ confirmou o valor', async () => {
  const erp = criarErpFake({ limparVisualAoSair: 'num_duplicata.' });
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());
  assert.equal(resultado.status, 'ok', resultado.mensagem);
});

test('relocaliza o input recriado pelo ERP e continua a sequência', async () => {
  const erp = criarErpFake({ recriarAoSair: 'seq_duplicatas.' });
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());
  assert.equal(resultado.status, 'ok', resultado.mensagem);
});

test('não prossegue quando o campo é recriado antes da confirmação e aparece vazio sem NXJ', async () => {
  const erp = criarErpFake({ semValorNoPost: 'tipo_titulo.', limparVisualAoSair: 'tipo_titulo.' });
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());
  assert.equal(resultado.status, 'erro');
  assert.equal(erp.comandos.includes('FIND'), false);
});

test('aborta antes de tocar na tela quando a visão ativa não é a Consulta de títulos', async () => {
  const erp = criarErpFake({ visao: 'forms.systextil.batch' });

  await assert.rejects(
    api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote()),
    /não é a Consulta de títulos \(crec_f090\)/
  );
  assert.deepEqual(erp.comandos, []);
  assert.deepEqual(erp.cliques, []);
  assert.ok(erp.prototipoIntacto());
});

test('aborta quando falta o controle Find ou o controle Nova consulta', async () => {
  const semFind = criarErpFake({ semBotaoFind: true });
  await assert.rejects(api.consultarLote(itensDe('1;;123456;1;1'), semFind.opcoesLote()), /controle do Systextil não foi encontrado: btnFind\./);
  assert.deepEqual(semFind.comandos, []);
});

test('aborta se a visão mudar durante o lote e restaura o XHR', async () => {
  const erp = criarErpFake();
  const resultados = await api.consultarLote(itensDe('1;;123456;1;1\n1;;222222;1;1'), erp.opcoesLote({
    aoProgresso(evento) {
      if (evento.tipo === 'resultado' && evento.indice === 0) erp.pagina.curDataView.name = 'forms.systextil.batch';
    }
  }));

  assert.equal(resultados[0].status, 'ok');
  assert.equal(resultados[1].status, 'erro');
  assert.match(resultados[1].mensagem, /não é a Consulta de títulos/);
  assert.ok(erp.prototipoIntacto());
});

test('interrupção do operador: título em curso e os seguintes ficam "não processados" sem Find', async () => {
  const erp = criarErpFake();
  const controle = { cancelado: false };
  const resultados = await api.consultarLote(itensDe('1;;123456;1;1\n1;;222222;1;1'), erp.opcoesLote({
    controle,
    aoProgresso(evento) {
      if (evento.tipo === 'iniciando' && evento.indice === 0) controle.cancelado = true;
    }
  }));

  assert.deepEqual(resultados.map(resultado => resultado.status), ['nao-processado', 'nao-processado']);
  assert.match(resultados[0].mensagem, /Interrompido pelo operador/);
  assert.equal(erp.comandos.includes('FIND'), false);
  assert.ok(erp.prototipoIntacto());
});

test('interrupção entre títulos preserva o resultado já obtido', async () => {
  const erp = criarErpFake({ titulos: [titulo(), titulo({ numero: '222222' })] });
  const controle = { cancelado: false };
  const resultados = await api.consultarLote(itensDe('1;;123456;1;1\n1;;222222;1;1'), erp.opcoesLote({
    controle,
    aoProgresso(evento) {
      if (evento.tipo === 'resultado' && evento.indice === 0) controle.cancelado = true;
    }
  }));

  assert.equal(resultados[0].status, 'ok');
  assert.equal(resultados[1].status, 'nao-processado');
});

test('callback da interface que lança exceção não derruba o lote', async () => {
  const erp = criarErpFake();
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote({
    aoProgresso() { throw new Error('falha de interface'); }
  }));
  assert.equal(resultado.status, 'ok', resultado.mensagem);
});

test('empresa pré-preenchida e bloqueada é aceita somente quando idêntica à solicitada', async () => {
  const igual = criarErpFake({ empresaInicial: '1', camposExtras: { 'codigo_empresa.': { readOnly: true, value: '1' } } });
  igual.campos['nome_empresa.'].value = 'EMPRESA FICTICIA';
  const [ok] = await api.consultarLote(itensDe('1;;123456;1;1'), igual.opcoesLote());
  assert.equal(ok.status, 'ok', ok.mensagem);
  assert.equal(igual.confirmados['codigo_empresa.'], undefined, 'campo bloqueado não é escrito');

  const diferente = criarErpFake({ camposExtras: { 'codigo_empresa.': { readOnly: true, value: '2' } } });
  const [bloqueado] = await api.consultarLote(itensDe('1;;123456;1;1'), diferente.opcoesLote());
  assert.equal(bloqueado.status, 'empresa-invalida');
  assert.match(bloqueado.mensagem, /empresa em uso/);
  assert.equal(diferente.comandos.includes('FIND'), false);
});

test('empresa já preenchida com o valor pedido e nome carregado não é reescrita (ERP não envia comando sem alteração)', async () => {
  const erp = criarErpFake({ empresaInicial: '1' });
  erp.campos['nome_empresa.'].value = 'EMPRESA FICTICIA';
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());

  assert.equal(resultado.status, 'ok', resultado.mensagem);
  assert.equal('codigo_empresa.' in erp.confirmados, false, 'Empresa não foi escrita nem confirmada por NXJ');
});

test('empresa preenchida mas sem nome carregado, ou diferente da pedida, continua sendo escrita e confirmada', async () => {
  const semNome = criarErpFake({ empresaInicial: '1' });
  const [r1] = await api.consultarLote(itensDe('1;;123456;1;1'), semNome.opcoesLote());
  assert.equal(r1.status, 'ok', r1.mensagem);
  assert.equal(semNome.confirmados['codigo_empresa.'], '1');

  const outra = criarErpFake({ empresaInicial: '2', empresas: { 1: 'EMPRESA FICTICIA', 2: 'OUTRA' } });
  outra.campos['nome_empresa.'].value = 'OUTRA';
  const [r2] = await api.consultarLote(itensDe('1;;123456;1;1'), outra.opcoesLote());
  assert.equal(r2.status, 'ok', r2.mensagem);
  assert.equal(outra.confirmados['codigo_empresa.'], '1');
});

test('falta de comando de saída traz diagnóstico de foco e contagem NXJ, sem dados do título', async () => {
  const erp = criarErpFake({ semSaida: 'codigo_empresa.' });
  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());

  assert.equal(resultado.status, 'erro');
  assert.match(resultado.mensagem, /saída do campo Empresa/);
  assert.match(resultado.mensagem, /Foco aplicado ao campo seguinte: sim/);
  assert.match(resultado.mensagem, /NXJ observados no lote: \d+ requisições \(\d+ POST\)/);
  assert.equal(resultado.mensagem.includes('123456'), false);
});

test('respeita maxLength do campo: remove só o zero inicial da base do CNPJ e nunca trunca dígitos', async () => {
  const erp = criarErpFake({ camposExtras: { 'cli_dup_cgc_cli_r.': { maxLength: 8 } } });
  const [resultado] = await api.consultarLote(itensDe('1;12345678000100;123456;1;1'), erp.opcoesLote());
  assert.equal(resultado.status, 'ok', resultado.mensagem);
  assert.equal(erp.confirmados['cli_dup_cgc_cli_r.'], '12345678');

  const cpf = criarErpFake({ camposExtras: { 'cli_dup_cgc_cli_r.': { maxLength: 8 } } });
  const [excede] = await api.consultarLote(itensDe('1;123.456.789-09;123456;1;1'), cpf.opcoesLote());
  assert.equal(excede.status, 'erro');
  assert.match(excede.mensagem, /Nenhum dígito foi removido/);
  assert.equal(cpf.comandos.includes('FIND'), false);
});

test('campos de consulta com resíduo após Nova consulta interrompem o lote (filtro antigo não é herdado)', async () => {
  const erp = criarErpFake();
  // Simula Nova consulta que não limpa o cliente residual.
  const limparOriginal = erp.pagina.document.getElementById('btnClearToFind.').click;
  erp.pagina.document.getElementById('btnClearToFind.').click = function () {
    limparOriginal.call(this);
    setTimeout(() => { erp.campos['cli_dup_cgc_cli_r.'].value = '012345678'; }, 4);
  };
  erp.pagina.curDataView.find = false; // força a necessidade de Nova consulta

  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());
  assert.equal(resultado.status, 'erro');
  assert.match(resultado.mensagem, /não limpou os campos/);
  assert.equal(erp.comandos.includes('FIND'), false);
});

test('rejeita lote vazio, grande demais ou sem documento acessível', async () => {
  const erp = criarErpFake();
  await assert.rejects(api.consultarLote([], erp.opcoesLote()), /Lote inválido/);
  await assert.rejects(
    api.consultarLote(Array.from({ length: 51 }, (_, i) => ({ linha: i, empresa: '1', numero: String(i), parcela: '1', tipo: '1', cliente: null })), erp.opcoesLote()),
    /Lote inválido/
  );
  await assert.rejects(
    api.consultarLote(itensDe('1;;123456;1;1'), { pagina: { ...erp.pagina, document: undefined }, config: CONFIG_RAPIDA }),
    /documento da Consulta de títulos/
  );
});

test('campo de dados com nome duplicado na tela não é lido e gera alerta', async () => {
  const erp = criarErpFake();
  const original = erp.documento.getElementsByName;
  erp.documento.getElementsByName = nome => (nome === 'pedido_venda.' ? [erp.campos[nome], erp.campos[nome]] : original(nome));

  const [resultado] = await api.consultarLote(itensDe('1;;123456;1;1'), erp.opcoesLote());
  assert.equal(resultado.status, 'ok', resultado.mensagem);
  assert.equal('pedido_venda.' in resultado.valores, false);
  assert.ok(resultado.alertas.some(alerta => /nome duplicado.*pedido_venda\./.test(alerta)));
});

test('campo oculto não é lido e vai para a lista de ocultos', () => {
  const documento = {
    getElementsByName(nome) {
      if (nome === 'pedido_venda.') return [{ value: '99', type: 'text', getClientRects: () => [] }];
      if (nome === 'saldo_duplicata.') return [{ value: '1,00', type: 'text', getClientRects: () => [{}] }];
      if (nome === 'nr_cupom.') return [{ value: 'x', type: 'hidden' }];
      if (nome === 'tem_obs.') return [{ value: 'on', type: 'checkbox', checked: true }];
      return [];
    }
  };

  const leitura = api.lerCamposTitulo(documento);
  assert.equal(leitura.valores['saldo_duplicata.'], '1,00');
  assert.equal(leitura.valores['tem_obs.'], 'marcado');
  assert.ok(leitura.ocultos.includes('pedido_venda.'));
  assert.ok(leitura.ocultos.includes('nr_cupom.'));
  assert.equal('pedido_venda.' in leitura.valores, false);
});

// ---------------------------------------------------------------------------
// Proteções estáticas (política do repositório)
// ---------------------------------------------------------------------------

test('metadados: escopo restrito ao Systextil, @noframes e somente as permissões necessárias', () => {
  const cabecalho = SOURCE.slice(SOURCE.indexOf('// ==UserScript=='), SOURCE.indexOf('// ==/UserScript=='));

  assert.deepEqual(
    cabecalho.match(/^\/\/ @match\s+.+$/gm).map(linha => linha.split(/\s+/)[2]),
    ['http://systextil.texcotton.com.br/systextil/*', 'https://systextil.texcotton.com.br/systextil/*']
  );
  assert.deepEqual(
    cabecalho.match(/^\/\/ @grant\s+.+$/gm).map(linha => linha.split(/\s+/)[2]).sort(),
    ['GM_registerMenuCommand', 'unsafeWindow']
  );
  assert.match(cabecalho, /^\/\/ @noframes$/m);
  assert.equal(/@connect|@require|@resource|@include|@exclude/.test(cabecalho), false);
  assert.match(cabecalho, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\/IsaacTexCotton\/Systextil-envio-mensagem\/main\/userscripts\/systextil-consulta-titulos\.user\.js$/m);
  assert.match(cabecalho, /^\/\/ @version\s+0\.1\.0$/m);
  assert.equal(api.VERSION, '0.1.0');
});

test('somente leitura: sem F7, teclado sintético, rede própria, armazenamento ou comandos de gravação', () => {
  const codigo = SOURCE.slice(SOURCE.indexOf('(function () {'));

  assert.equal(/KeyboardEvent|key:\s*["']F\d+["']|keyCode|F7/.test(codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), false);
  assert.equal(/GM_xmlhttpRequest|\bfetch\s*\(|new XMLHttpRequest|sendBeacon|WebSocket|GM_download/.test(codigo), false);
  assert.equal(/localStorage|sessionStorage|GM_setValue|GM_getValue|indexedDB|document\.cookie/.test(codigo), false);
  assert.equal(/ADD_UPDATE|DELETE_RECORD|CLEAR_TO_ADD|SAVEANDCLOSE|btnAdd|btnDelete|BTNEmetirBoletos|CMDEmetirBoletos/i.test(codigo), false);
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(codigo), false);
  assert.equal(/console\.(log|info|debug|error)/.test(codigo), false);

  // Só os dois controles da barra são acionados, ambos por id exato.
  assert.deepEqual(
    [...codigo.matchAll(/ID_BOTAO_[A-Z_]+\s*=\s*"([^"]+)"/g)].map(match => match[1]).sort(),
    ['btnClearToFind.', 'btnFind.']
  );
  assert.equal([...codigo.matchAll(/\.click\(\)/g)].length >= 2, true);
});

test('o Find só é acionado depois da barreira de confirmação NXJ e das descrições', () => {
  const corpo = SOURCE.slice(SOURCE.indexOf('async function consultarTitulo'));
  const preencher = corpo.indexOf('await preencherCampos(item, ctx)');
  const barreira = corpo.indexOf('validarEstadoAntesDoFind(item, passos, confirmacoes, ctx)');
  const find = corpo.indexOf('await executarFind(ctx)');

  assert.ok(preencher >= 0 && barreira > preencher && find > barreira);
  assert.equal([...SOURCE.matchAll(/localizarControleUnico\(pagina, ID_BOTAO_FIND\)\s*\.click|botao\.click\(\)/g)].length >= 1, true);
  assert.equal([...SOURCE.matchAll(/ID_BOTAO_FIND\)/g)].length >= 2, true);
  // Sem retentativa automática de Find.
  assert.equal([...SOURCE.matchAll(/await executarFind\(/g)].length, 1);
});
