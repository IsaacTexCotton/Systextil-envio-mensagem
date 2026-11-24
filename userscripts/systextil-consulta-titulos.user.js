// ==UserScript==
// @name         Systextil — Consulta de Títulos em Lote (crec_f090)
// @namespace    https://github.com/IsaacTexCotton/Systextil-envio-mensagem
// @version      0.1.0
// @description  Atalho abre um popup para consultar vários títulos na Consulta de títulos (crec_f090) e ler os campos exibidos. Somente leitura.
// @match        http://systextil.texcotton.com.br/systextil/*
// @match        https://systextil.texcotton.com.br/systextil/*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-consulta-titulos.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-consulta-titulos.user.js
// ==/UserScript==

/*
 * Consulta de títulos a receber (forms.crec.crec_f090) — SOMENTE LEITURA.
 *
 * O que faz: para cada título informado no popup, aciona "nova consulta",
 * preenche Empresa, Cliente e Nr título (número, parcela, tipo), aciona o
 * controle Find e lê os campos exibidos. O clique em "Consultar" no popup é a
 * autorização humana explícita para essas consultas.
 *
 * O que NÃO faz: não emite boleto, não emite nota, não grava, não altera nem
 * exclui título, não usa F10/lookups, não pressiona F7, não envia dados para
 * fora do navegador e não registra dados do ERP no console nem em storage.
 *
 * Documentação: docs/consulta-titulos-crec-f090.md
 */

(function () {
  "use strict";

  const VERSION = "0.1.0";
  const VISAO_CONSULTA_TITULOS = "forms.crec.crec_f090";
  const ENDPOINT_COMANDO_NXJ = /(?:^|\/)UnifyNXJ\.jsp(?:[?#]|$)/i;
  const COMANDOS_NXJ_CONFIRMACAO = new Set(["CLICKONFIELD", "NEXT_FIELD"]);

  const ID_BOTAO_NOVA_CONSULTA = "btnClearToFind.";
  const ID_BOTAO_FIND = "btnFind.";

  const ATALHO = Object.freeze({ alt: true, shift: true, ctrl: false, meta: false, codigo: "KeyQ" });
  const ATALHO_TEXTO = "Alt+Shift+Q";

  const MAX_TITULOS_POR_LOTE = 50;
  const MAX_LINHAS_ENTRADA = 200;
  const MAX_TAMANHO_CODIGO = 20;
  const MAX_TAMANHO_VALOR_LIDO = 4000;

  // Partes do documento do cliente. Mapeamento r/o/2 → base/ordem/dígito é
  // INFERIDO pelo nome e pelo padrão do Systextil (9/4/2); não foi confirmado
  // no ERP real. Falhas aparecem como "cliente não carregado" antes do Find.
  const CAMPOS_CLIENTE = Object.freeze({
    base: { name: "cli_dup_cgc_cli_r.", largura: 9, rotulo: "Cliente (base)" },
    ordem: { name: "cli_dup_cgc_cli_o.", largura: 4, rotulo: "Cliente (ordem)" },
    digito: { name: "cli_dup_cgc_cli2.", largura: 2, rotulo: "Cliente (dígito)" }
  });

  const CAMPOS_CHAVE = Object.freeze({
    empresa: { name: "codigo_empresa.", rotulo: "Empresa", descricao: "nome_empresa.", rotuloDescricao: "nome da empresa" },
    numero: { name: "num_duplicata.", rotulo: "Número do título" },
    parcela: { name: "seq_duplicatas.", rotulo: "Parcela" },
    tipo: { name: "tipo_titulo.", rotulo: "Tipo do título", descricao: "nome_tipo.", rotuloDescricao: "descrição do tipo" }
  });
  const CAMPO_NOME_CLIENTE = "nome_cliente.";

  const DESCRICAO_SITUACAO = Object.freeze({
    "0": "Em aberto",
    "1": "Pago total",
    "2": "Cancelado",
    "3": "Pago a menor",
    "4": "Pago a maior"
  });

  /*
   * Catálogo de leitura. `name` é o atributo name real (o ponto final faz parte
   * do nome) conforme docs/referencia-tecnica-nxj-systextil.md, seção 7.1. Os
   * rótulos foram associados pelo nome e pela descrição da tela; os que não
   * têm correspondência evidente ficam com o nome técnico (ver a documentação).
   */
  const CATALOGO_CAMPOS = Object.freeze([
    ["Identificação e cliente", [
      ["data_corrente.", "Data"],
      ["hora_corrente.", "Hora"],
      ["codigo_empresa.", "Empresa"],
      ["nome_empresa.", "Nome da empresa"],
      ["num_duplicata.", "Nr título (número)"],
      ["seq_duplicatas.", "Nr título (parcela)"],
      ["tipo_titulo.", "Nr título (tipo)"],
      ["nome_tipo.", "Descrição do tipo"],
      ["situacao_duplic.", "Situação"],
      ["descrsit.", "Descrição da situação (tela)"],
      ["data_emissao.", "Emissão"],
      ["cli_dup_cgc_cli_r.", "Cliente (base)"],
      ["cli_dup_cgc_cli_o.", "Cliente (ordem)"],
      ["cli_dup_cgc_cli2.", "Cliente (dígito)"],
      ["nome_cliente.", "Nome do cliente"],
      ["cli_resptit_r.", "Responsável (base)"],
      ["cli_resptit_o.", "Responsável (ordem)"],
      ["cli2resptit.", "Responsável (dígito)"],
      ["descr_cliresp.", "Desc. responsável"],
      ["cgc_endosso_r.", "Endosso (base)"],
      ["cgc_endosso_o.", "Endosso (ordem)"],
      ["cgc2_endosso.", "Endosso (dígito)"],
      ["nome_endosso.", "Nome do endosso"]
    ]],
    ["Pedido, representante e comissão", [
      ["pedido_venda.", "Pedido"],
      ["cod_rep_cliente.", "Representante"],
      ["nome_representante.", "Nome do representante"],
      ["percentual_comis.", "% Comissão"],
      ["base_calc_comis.", "Base de cálculo da comissão"],
      ["valor_comis.", "Valor da comissão"]
    ]],
    ["Cobrança, banco e controles financeiros", [
      ["portador_duplic.", "Portador"],
      ["descricao.", "Descrição do portador"],
      ["numero_bordero.", "Borderô"],
      ["numero_remessa.", "Remessa"],
      ["nr_titulo_banco.", "Nr. banco"],
      ["conta_corrente.", "Conta corrente"],
      ["cod_carteira.", "Carteira"],
      ["cod_transacao.", "Transação"],
      ["descr_transacao.", "Descrição da transação"],
      ["perc_desc_duplic.", "Perc. desc. título"],
      ["nr_solicitacao.", "Solicitação"],
      ["saldo_moviment_perdas.", "Saldo movto de perda"],
      ["saldo_duplicata_ch.", "Saldo com cheques"],
      ["cobr_externa.", "cobr_externa."],
      ["cobr_ext_desc.", "cobr_ext_desc."],
      ["cobr_ext_desc2.", "cobr_ext_desc2."]
    ]],
    ["Datas, valores, moeda e posição", [
      ["data_venc_duplic.", "Vencimento"],
      ["valor_duplicata.", "Valor"],
      ["saldo_duplicata.", "Saldo"],
      ["moeda_titulo.", "Moeda do título"],
      ["descr_moeda.", "Descrição da moeda"],
      ["valor_moeda.", "Valor na moeda"],
      ["saldo_moeda.", "Saldo na moeda"],
      ["data_prorrogacao.", "Prorrogação"],
      ["posicao_duplic.", "Posição"],
      ["descr_posicao.", "Descrição da posição"],
      ["previsao.", "Previsão"],
      ["descr_previsao.", "Descrição da previsão"],
      ["cod_local.", "Local"],
      ["descr_local.", "Descrição do local"],
      ["duplic_emitida.", "Duplicata emitida"]
    ]],
    ["Histórico, contabilidade e renegociação", [
      ["cod_historico.", "Histórico"],
      ["compl_historico.", "Complemento do histórico"],
      ["num_contabil.", "Número contábil"],
      ["docto_subst.", "Docto reneg."],
      ["ren_sit_renegocia.", "Situação da renegociação"],
      ["desc_sit_renegocia.", "Descrição da situação da renegociação"],
      ["ren_num_renegocia.", "Número da renegociação"],
      ["ult_ocorrencia.", "Última ocorrência"],
      ["dt_ult_ocorrencia.", "Data da última ocorrência"]
    ]],
    ["Informações complementares e integrações", [
      ["duplic_impressa.", "Duplicata impressa"],
      ["tem_obs.", "Tem informação"],
      ["possui_adiantamento.", "Adiantamento"],
      ["nr_cupom.", "Nr. cupom"],
      ["cod_forma_pagto.", "Forma de pagamento"],
      ["descr_forma_pagto.", "Descrição da forma de pagamento"],
      ["scpc_nr_remessa.", "Nr. remessa SCPC"],
      ["scpc_situacao.", "Situação da remessa SCPC"],
      ["cod_barras.", "Código de barras"],
      ["linha_digitavel.", "Linha digitável"],
      ["bolepix.", "Pix copia e cola"]
    ]],
    ["FIDC", [
      ["numeroRemessaFIDC.", "FIDC — nº da remessa"],
      ["situacaoFIDC.", "FIDC — situação"],
      ["dataRemessaFIDC.", "FIDC — data da remessa"],
      ["numeroIdentificaoFIDC.", "FIDC — nº de identificação"]
    ]]
  ].map(([grupo, campos]) => Object.freeze({
    grupo,
    campos: Object.freeze(campos.map(([name, rotulo]) => Object.freeze({ name, rotulo })))
  })));

  const STATUS = Object.freeze({
    ok: "ok",
    naoEncontrado: "nao-encontrado",
    semResultado: "sem-resultado",
    ambiguo: "ambiguo",
    divergente: "divergente",
    clienteInvalido: "cliente-invalido",
    empresaInvalida: "empresa-invalida",
    tipoInvalido: "tipo-invalido",
    erro: "erro",
    naoProcessado: "nao-processado"
  });

  const ROTULO_STATUS = Object.freeze({
    "ok": "Encontrado e conferido",
    "nao-encontrado": "Título não encontrado",
    "sem-resultado": "Sem registro carregado (conferir)",
    "ambiguo": "Mais de um registro (não lido)",
    "divergente": "Registro diverge da solicitação (não lido)",
    "cliente-invalido": "Cliente não carregado",
    "empresa-invalida": "Empresa não carregada",
    "tipo-invalido": "Tipo não carregado",
    "erro": "Erro",
    "nao-processado": "Não processado"
  });

  const EM_NODE = typeof module === "object" && module.exports;
  if (!EM_NODE) {
    let urlAtual;
    try {
      urlAtual = new URL(window.location.href);
    } catch (_) {
      return;
    }
    if (
      urlAtual.hostname !== "systextil.texcotton.com.br" ||
      !urlAtual.pathname.startsWith("/systextil/") ||
      window.top !== window
    ) {
      return;
    }
  }

  class ErroConsulta extends Error {
    constructor(mensagem, status) {
      super(mensagem);
      this.name = "ErroConsulta";
      this.status = status || STATUS.erro;
    }
  }

  class ErroCancelado extends Error {
    constructor() {
      super("Consulta interrompida pelo operador.");
      this.name = "ErroCancelado";
    }
  }

  // ---------------------------------------------------------------------------
  // Regras puras (sem DOM)
  // ---------------------------------------------------------------------------

  /**
   * Comparação de códigos: zeros à esquerda só são ignorados quando o código é
   * numérico. Nunca altera o dado original.
   */
  function normalizarCodigoComparacao(valor) {
    const codigo = String(valor ?? "").trim();
    return /^\d+$/.test(codigo) ? (codigo.replace(/^0+/, "") || "0") : codigo.toUpperCase();
  }

  function mesmoCodigo(a, b) {
    return normalizarCodigoComparacao(a) === normalizarCodigoComparacao(b);
  }

  /**
   * Valida um código de consulta unitária. Rejeita explicitamente os
   * operadores de busca do NXJ (vírgula = OU, hífen = intervalo): neste script
   * cada linha é exatamente um título.
   */
  function validarCodigo(valor, rotulo) {
    const codigo = String(valor ?? "").trim();

    if (!codigo) throw new ErroConsulta(rotulo + " não informado.");
    if (/[,-]/.test(codigo)) {
      throw new ErroConsulta(rotulo + " não pode conter vírgula nem hífen (operadores de busca múltipla).");
    }
    if (!/^[A-Za-z0-9]+$/.test(codigo)) {
      throw new ErroConsulta(rotulo + " contém caracteres não permitidos.");
    }
    if (codigo.length > MAX_TAMANHO_CODIGO) {
      throw new ErroConsulta(rotulo + " excede " + MAX_TAMANHO_CODIGO + " caracteres.");
    }

    return codigo;
  }

  /**
   * Converte CPF/CNPJ (com ou sem máscara) nas três partes dos campos do
   * Systextil. CNPJ: base de 8 dígitos preenchida com zero à esquerda até 9,
   * ordem de 4 e dígito de 2. CPF: 9 primeiros dígitos, ordem 0000 e dígito.
   * Não valida o dígito verificador: cliente inexistente é detectado na tela.
   */
  function dividirDocumentoCliente(valor) {
    const texto = String(valor ?? "").trim();
    if (!texto) return null;
    if (!/^[\d.\-/\s]+$/.test(texto)) {
      throw new ErroConsulta("Cliente deve conter apenas o CNPJ/CPF (números, pontos, barra e hífen).");
    }

    const digitos = texto.replace(/\D/g, "");

    if (digitos.length === 14) {
      return {
        tipo: "CNPJ",
        base: "0" + digitos.slice(0, 8),
        ordem: digitos.slice(8, 12),
        digito: digitos.slice(12, 14)
      };
    }

    if (digitos.length === 11) {
      return {
        tipo: "CPF",
        base: digitos.slice(0, 9),
        ordem: "0000",
        digito: digitos.slice(9, 11)
      };
    }

    throw new ErroConsulta("Cliente deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ).");
  }

  function chaveTitulo(item) {
    return [item.empresa, item.numero, item.parcela, item.tipo]
      .map(normalizarCodigoComparacao)
      .join("|");
  }

  /**
   * Interpreta o texto do popup. Uma linha por título, separador tab ou ponto e
   * vírgula: empresa;cliente;número;parcela;tipo (cliente pode ficar vazio) ou,
   * sem a coluna cliente, empresa;número;parcela;tipo. Linhas vazias, linhas
   * iniciadas por # e um cabeçalho "Empresa" são ignorados.
   * Qualquer erro bloqueia o lote inteiro: nada é adivinhado.
   */
  function interpretarEntradaTitulos(texto) {
    const itens = [];
    const erros = [];
    const chavesVistas = new Map();
    const linhas = String(texto ?? "").split(/\r\n|\r|\n/);

    if (linhas.length > MAX_LINHAS_ENTRADA) {
      return {
        itens,
        erros: [{ linha: 0, mensagem: "Entrada excede " + MAX_LINHAS_ENTRADA + " linhas." }]
      };
    }

    linhas.forEach((bruta, indice) => {
      const numeroLinha = indice + 1;
      const linha = bruta.trim();
      if (!linha || linha.startsWith("#")) return;

      const colunas = linha.split(/\t|;/).map(coluna => coluna.trim());
      // Planilhas costumam colar colunas vazias ao final da linha.
      while (colunas.length > 5 && colunas[colunas.length - 1] === "") colunas.pop();
      if (itens.length === 0 && /^empresa$/i.test(colunas[0])) return;

      if (colunas.length !== 4 && colunas.length !== 5) {
        erros.push({
          linha: numeroLinha,
          mensagem: "Esperadas 5 colunas (empresa;cliente;número;parcela;tipo) ou 4 (sem cliente); encontradas " + colunas.length + "."
        });
        return;
      }

      const [empresa, cliente, numero, parcela, tipo] = colunas.length === 5
        ? colunas
        : [colunas[0], "", colunas[1], colunas[2], colunas[3]];

      try {
        const item = {
          linha: numeroLinha,
          empresa: validarCodigo(empresa, "Empresa"),
          cliente: dividirDocumentoCliente(cliente),
          clienteInformado: cliente.trim(),
          numero: validarCodigo(numero, "Número do título"),
          parcela: validarCodigo(parcela, "Parcela"),
          tipo: validarCodigo(tipo, "Tipo do título")
        };

        const chave = chaveTitulo(item);
        if (chavesVistas.has(chave)) {
          throw new ErroConsulta("Título repetido (mesma empresa, número, parcela e tipo da linha " + chavesVistas.get(chave) + ").");
        }
        chavesVistas.set(chave, numeroLinha);
        itens.push(item);
      } catch (erro) {
        if (!(erro instanceof ErroConsulta)) throw erro;
        erros.push({ linha: numeroLinha, mensagem: erro.message });
      }
    });

    if (itens.length === 0 && erros.length === 0) {
      erros.push({ linha: 0, mensagem: "Nenhum título informado." });
    }

    if (itens.length > MAX_TITULOS_POR_LOTE) {
      erros.push({
        linha: 0,
        mensagem: "Máximo de " + MAX_TITULOS_POR_LOTE + " títulos por lote; informados " + itens.length + "."
      });
    }

    return { itens: erros.length ? [] : itens, erros };
  }

  function descreverSituacao(codigo) {
    const chave = String(codigo ?? "").trim();
    if (!chave) return "";
    return DESCRICAO_SITUACAO[chave] || "Código não documentado";
  }

  /**
   * Converte valor no formato brasileiro exibido pela tela em centavos
   * inteiros. Formatos ambíguos retornam null (não adivinha).
   */
  function lerValorMonetario(texto) {
    const valor = String(texto ?? "").trim();
    if (!/^-?(\d{1,3}(\.\d{3})+|\d+),\d{2}$/.test(valor)) return null;

    const negativo = valor.startsWith("-");
    const centavos = Number(valor.replace(/[-.]/g, "").replace(",", ""));
    if (!Number.isSafeInteger(centavos)) return null;
    return negativo ? -centavos : centavos;
  }

  /**
   * Alertas informativos sobre a leitura (não alteram o resultado). Título
   * cancelado deve exibir saldos zerados; qualquer divergência merece conferência.
   */
  function avaliarAlertas(valores) {
    const alertas = [];
    const situacao = String(valores["situacao_duplic."] ?? "").trim();

    if (situacao && !(situacao in DESCRICAO_SITUACAO)) {
      alertas.push("Código de situação não documentado.");
    }

    if (situacao === "2") {
      for (const [name, rotulo] of [
        ["saldo_duplicata.", "Saldo"],
        ["saldo_duplicata_ch.", "Saldo com cheques"],
        ["saldo_moeda.", "Saldo na moeda"]
      ]) {
        const centavos = lerValorMonetario(valores[name]);
        if (centavos !== null && centavos !== 0) {
          alertas.push("Título cancelado com " + rotulo + " diferente de zero.");
        }
      }
    }

    return alertas;
  }

  function lerPartesClienteDosValores(valores) {
    return {
      base: String(valores[CAMPOS_CLIENTE.base.name] ?? "").trim(),
      ordem: String(valores[CAMPOS_CLIENTE.ordem.name] ?? "").trim(),
      digito: String(valores[CAMPOS_CLIENTE.digito.name] ?? "").trim()
    };
  }

  /**
   * Compara a chave solicitada com a chave lida após o Find. Retorna a lista
   * de rótulos divergentes (vazia quando tudo confere). Campo vazio na leitura
   * conta como divergência: o registro precisa mostrar a própria identificação.
   */
  function compararChave(item, valores) {
    const divergencias = [];

    for (const chave of ["empresa", "numero", "parcela", "tipo"]) {
      const campo = CAMPOS_CHAVE[chave];
      const lido = String(valores[campo.name] ?? "").trim();
      if (!lido || !mesmoCodigo(lido, item[chave])) divergencias.push(campo.rotulo);
    }

    if (item.cliente) {
      const lidas = lerPartesClienteDosValores(valores);
      for (const parte of ["base", "ordem", "digito"]) {
        if (!lidas[parte] || !mesmoCodigo(lidas[parte], item.cliente[parte])) {
          divergencias.push(CAMPOS_CLIENTE[parte].rotulo);
        }
      }
    }

    return divergencias;
  }

  /**
   * Neutraliza injeção de fórmula em planilhas: textos vindos do ERP que
   * comecem com = + - @ (ou controle) recebem apóstrofo, exceto números simples.
   */
  function neutralizarCelulaPlanilha(valor) {
    const texto = String(valor ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
    if (/^[=+\-@\t\r]/.test(texto) && !/^-?[\d.,]+$/.test(texto)) return "'" + texto;
    return texto;
  }

  function colunasExportacao(resultados) {
    const colunas = [];
    const vistos = new Set();

    for (const grupo of CATALOGO_CAMPOS) {
      for (const campo of grupo.campos) {
        if (resultados.some(resultado => resultado.valores && campo.name in resultado.valores)) {
          if (!vistos.has(campo.name)) {
            vistos.add(campo.name);
            colunas.push({ name: campo.name, rotulo: campo.rotulo });
          }
        }
      }
    }

    return colunas;
  }

  function montarTabelaExportacao(resultados) {
    const colunas = colunasExportacao(resultados);
    const cabecalho = [
      "Linha", "Empresa (solicitada)", "Cliente (solicitado)", "Número (solicitado)",
      "Parcela (solicitada)", "Tipo (solicitado)", "Status", "Mensagem", "Alertas", "Situação (descrição)",
      ...colunas.map(coluna => coluna.rotulo + " [" + coluna.name + "]")
    ];

    const linhas = resultados.map(resultado => [
      resultado.linha,
      resultado.empresa,
      resultado.clienteSolicitado || "",
      resultado.numero,
      resultado.parcela,
      resultado.tipo,
      ROTULO_STATUS[resultado.status] || resultado.status,
      resultado.mensagem || "",
      (resultado.alertas || []).join(" | "),
      resultado.valores ? descreverSituacao(resultado.valores["situacao_duplic."]) : "",
      ...colunas.map(coluna => resultado.valores ? String(resultado.valores[coluna.name] ?? "") : "")
    ].map(neutralizarCelulaPlanilha));

    return [cabecalho.map(neutralizarCelulaPlanilha), ...linhas];
  }

  function montarTsv(resultados) {
    return montarTabelaExportacao(resultados)
      .map(linha => linha.map(celula => celula.replace(/[\t\r\n]+/g, " ")).join("\t"))
      .join("\r\n");
  }

  function montarCsv(resultados) {
    const escapar = celula => /[";\r\n]/.test(celula)
      ? '"' + celula.replace(/"/g, '""') + '"'
      : celula;

    return montarTabelaExportacao(resultados)
      .map(linha => linha.map(escapar).join(";"))
      .join("\r\n");
  }

  function pausa(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function limitarTexto(valor, limite) {
    return String(valor ?? "").slice(0, limite);
  }

  // ---------------------------------------------------------------------------
  // Integração com o Systextil (DOM + protocolo NXJ)
  //
  // A sequência de foco/escrita/saída/confirmação abaixo é a mesma já validada
  // em campo para Número e Parcela (userscript de segunda via). Ela foi
  // generalizada para Empresa, Cliente e Tipo, o que NÃO foi homologado: se o
  // ERP não confirmar um campo, o Find é bloqueado (falha segura).
  // ---------------------------------------------------------------------------

  const CONFIG_PADRAO = Object.freeze({
    atrasoFocoInicialMs: 500,
    atrasoAntesDeSairCampoMs: 500,
    atrasoAposSairCampoMs: 800,
    pausaAposNovaConsultaMs: 200,
    silencioMs: 300,
    intervaloMs: 60,
    limiteEsperaMs: 20000,
    limiteNovaConsultaMs: 5000,
    graciaModoConsultaMs: 3000,
    limiteResultadoMs: 20000,
    limiteLeituraMs: 5000,
    estabilidadeLeituraMs: 150
  });

  function resolverConfig(parcial) {
    const config = { ...CONFIG_PADRAO };
    if (parcial && typeof parcial === "object") {
      for (const chave of Object.keys(CONFIG_PADRAO)) {
        const valor = parcial[chave];
        if (Number.isInteger(valor) && valor >= 0) config[chave] = Math.min(valor, 60000);
      }
    }
    if (config.intervaloMs < 1) config.intervaloMs = 1;
    return Object.freeze(config);
  }

  function obterPagina() {
    const pagina = typeof unsafeWindow !== "undefined" && unsafeWindow
      ? unsafeWindow
      : window;

    if (!pagina?.XMLHttpRequest) {
      throw new ErroConsulta("Não foi possível acessar o XMLHttpRequest da página do Systextil.");
    }

    return pagina;
  }

  function lerEstadoTela(pagina) {
    const visao = pagina?.curDataView;
    if (!visao) return null;

    return {
      visao: String(visao.name ?? ""),
      busca: Boolean(visao.find),
      acao: String(visao.recordAction ?? ""),
      total: Number.parseInt(visao.recordCount, 10) || 0,
      atual: Number.parseInt(visao.recordNumber, 10) || 0
    };
  }

  function validarVisaoConsulta(pagina) {
    if (lerEstadoTela(pagina)?.visao !== VISAO_CONSULTA_TITULOS) {
      throw new ErroConsulta("A tela ativa não é a Consulta de títulos (crec_f090).");
    }
  }

  function coletarDocumentosMesmoDominio(janelaRaiz) {
    const documentos = [];
    const visitadas = new Set();

    function visitar(janela) {
      if (!janela || visitadas.has(janela)) return;
      visitadas.add(janela);

      try {
        if (janela.document) documentos.push(janela.document);
      } catch (_) {
        return;
      }

      let total = 0;
      try {
        total = janela.frames ? janela.frames.length : 0;
      } catch (_) {
        return;
      }

      for (let indice = 0; indice < total; indice += 1) {
        try {
          visitar(janela.frames[indice]);
        } catch (_) {
          // Frames de outra origem são ignorados.
        }
      }
    }

    visitar(janelaRaiz);
    return documentos;
  }

  /** Localiza um controle da barra por id exato; zero ou mais de um interrompe. */
  function localizarControleUnico(pagina, id) {
    // Array simples: o Systextil sobrescreve Array.from, que passa a devolver
    // vazio para Set (mesmo defeito já visto no userscript de parâmetros).
    const encontrados = [];

    for (const documento of coletarDocumentosMesmoDominio(pagina)) {
      const elemento = documento.getElementById?.(id);
      if (elemento && !encontrados.includes(elemento)) encontrados.push(elemento);
    }

    if (encontrados.length !== 1) {
      throw new ErroConsulta(
        encontrados.length === 0
          ? "O controle do Systextil não foi encontrado: " + id
          : "Mais de um controle do Systextil com o mesmo identificador: " + id
      );
    }

    const elemento = encontrados[0];
    if (elemento.disabled) {
      throw new ErroConsulta("O controle do Systextil está desabilitado: " + id);
    }

    return elemento;
  }

  function obterCampoUnico(documento, name) {
    const lista = documento?.getElementsByName?.(name);
    const total = lista ? lista.length : 0;

    if (total !== 1 || typeof lista[0].value !== "string") {
      throw new ErroConsulta(
        total === 0
          ? "Campo não encontrado na tela: " + name
          : "Campo ausente, duplicado ou inválido na tela: " + name
      );
    }

    return lista[0];
  }

  function campoSomenteLeitura(campo) {
    return Boolean(campo.disabled || campo.readOnly);
  }

  function validarCampoEditavel(campo, name) {
    if (campoSomenteLeitura(campo)) {
      throw new ErroConsulta("O campo está bloqueado para edição: " + name);
    }
    if (typeof campo.focus !== "function") {
      throw new ErroConsulta("O campo não oferece a operação de foco necessária: " + name);
    }
  }

  /**
   * Atualiza o valor pelo setter nativo do input e dispara input/change do tipo
   * Event (sequência validada na segunda via). Específico desta tela.
   */
  function atribuirValorCampo(campo, valor) {
    const janela = campo.ownerDocument?.defaultView || window;
    const prototipoInput = janela.HTMLInputElement?.prototype;
    const setterNativo = prototipoInput
      ? Object.getOwnPropertyDescriptor(prototipoInput, "value")?.set
      : null;

    if (typeof setterNativo === "function") {
      setterNativo.call(campo, valor);
    } else {
      campo.value = valor;
    }

    const ConstrutorEvento = janela.Event || Event;
    campo.dispatchEvent(new ConstrutorEvento("input", { bubbles: true }));
    campo.dispatchEvent(new ConstrutorEvento("change", { bubbles: true }));
  }

  function textoCampo(campo) {
    if (campo.type === "checkbox" || campo.type === "radio") {
      return campo.checked ? "marcado" : "desmarcado";
    }
    return limitarTexto(typeof campo.value === "string" ? campo.value.trim() : "", MAX_TAMANHO_VALOR_LIDO);
  }

  function campoVisivel(campo) {
    if (campo.type === "hidden") return false;
    if (typeof campo.getClientRects === "function") return campo.getClientRects().length > 0;
    return true;
  }

  /**
   * Lê os campos do catálogo. Campos ausentes, ocultos ou com nome duplicado
   * não geram valor: nunca se confunde "não existe/não visível" com "vazio".
   */
  function lerCamposTitulo(documento) {
    const valores = {};
    const ausentes = [];
    const ocultos = [];
    const ambiguos = [];

    for (const grupo of CATALOGO_CAMPOS) {
      for (const definicao of grupo.campos) {
        const lista = documento.getElementsByName(definicao.name);
        const total = lista ? lista.length : 0;

        if (total === 0) {
          ausentes.push(definicao.name);
        } else if (total > 1) {
          ambiguos.push(definicao.name);
        } else if (!campoVisivel(lista[0])) {
          ocultos.push(definicao.name);
        } else {
          valores[definicao.name] = textoCampo(lista[0]);
        }
      }
    }

    return { valores, ausentes, ocultos, ambiguos };
  }

  function valorConfere(valoresPendentes, esperado) {
    const alvo = normalizarCodigoComparacao(esperado);
    if (!alvo || !Array.isArray(valoresPendentes)) return false;

    return valoresPendentes.some(valor => {
      const limpo = String(valor ?? "").trim();
      if (!limpo) return false;

      const finalDoSegmento = limpo.split(/[=:]/).pop().trim();
      return normalizarCodigoComparacao(limpo) === alvo ||
        normalizarCodigoComparacao(finalDoSegmento) === alvo;
    });
  }

  function extrairValoresPendentesNxj(fieldValues) {
    if (typeof fieldValues !== "string") return [];

    // O NXJ pode serializar mais de um valor no mesmo POST: confere todos os segmentos.
    return fieldValues
      .split("\f")
      .map(valor => valor.trim())
      .filter(Boolean);
  }

  /**
   * Monitor temporário do protocolo NXJ. Guarda em memória apenas comando,
   * segmentos e status; nada é registrado em console/storage. Deve ser
   * removido ao final do lote (remover()).
   */
  function criarMonitorNxj(pagina, config, verificar) {
    const prototipo = pagina?.XMLHttpRequest?.prototype;
    const descritorOpen = prototipo ? Object.getOwnPropertyDescriptor(prototipo, "open") : null;
    const descritorSend = prototipo ? Object.getOwnPropertyDescriptor(prototipo, "send") : null;

    if (
      !descritorOpen || typeof descritorOpen.value !== "function" || !descritorOpen.writable ||
      !descritorSend || typeof descritorSend.value !== "function" || !descritorSend.writable
    ) {
      throw new ErroConsulta(
        "Não foi possível instalar o monitor temporário de comandos NXJ. Nenhum campo foi alterado."
      );
    }

    const { silencioMs, intervaloMs, limiteEsperaMs } = config;
    const abrirOriginal = descritorOpen.value;
    const enviarOriginal = descritorSend.value;
    const metadadosXhr = new WeakMap();
    const requisicoes = [];
    const estado = { emAndamento: 0, ultimaConclusao: Date.now(), sequencia: 0 };

    function extrairDadosComando(body) {
      try {
        if (body && typeof body.get === "function") {
          return {
            comando: String(body.get("commandName") ?? "").trim().toUpperCase(),
            fieldValues: body.get("fieldValues")
          };
        }

        if (typeof body !== "string") return { comando: "", fieldValues: null };

        const ConstrutorParametros = pagina.URLSearchParams || URLSearchParams;
        const parametros = new ConstrutorParametros(body);
        return {
          comando: String(parametros.get("commandName") ?? "").trim().toUpperCase(),
          fieldValues: parametros.get("fieldValues")
        };
      } catch (_) {
        return { comando: "", fieldValues: null };
      }
    }

    function abrirInterceptado(metodo, url) {
      metadadosXhr.set(this, {
        metodo: String(metodo ?? "GET").toUpperCase(),
        url: String(url ?? "")
      });
      return abrirOriginal.apply(this, arguments);
    }

    function enviarInterceptado(body) {
      const metadados = metadadosXhr.get(this);

      if (!metadados || !ENDPOINT_COMANDO_NXJ.test(metadados.url)) {
        return enviarOriginal.apply(this, arguments);
      }

      const dados = metadados.metodo === "POST"
        ? extrairDadosComando(body)
        : { comando: "", fieldValues: null };

      const registro = {
        sequencia: ++estado.sequencia,
        metodo: metadados.metodo,
        comando: dados.comando,
        valoresPendentes: extrairValoresPendentesNxj(dados.fieldValues),
        finalizado: false,
        monitoramentoFalhou: false,
        status: 0
      };
      requisicoes.push(registro);

      let acompanhada = false;
      let finalizada = false;

      function finalizarRequisicao() {
        if (finalizada) return;
        finalizada = true;
        registro.finalizado = true;

        try {
          registro.status = Number(this.status) || 0;
        } catch (_) {
          registro.status = 0;
        }

        if (acompanhada) estado.emAndamento = Math.max(0, estado.emAndamento - 1);
        estado.ultimaConclusao = Date.now();
      }

      if (typeof this.addEventListener === "function") {
        try {
          estado.emAndamento += 1;
          acompanhada = true;
          this.addEventListener("loadend", finalizarRequisicao.bind(this), { once: true });
        } catch (_) {
          estado.emAndamento = Math.max(0, estado.emAndamento - 1);
          acompanhada = false;
          registro.monitoramentoFalhou = true;
          registro.finalizado = true;
        }
      } else {
        registro.monitoramentoFalhou = true;
        registro.finalizado = true;
      }

      try {
        return enviarOriginal.apply(this, arguments);
      } catch (erro) {
        finalizarRequisicao.call(this);
        throw erro;
      }
    }

    try {
      Object.defineProperty(prototipo, "open", { ...descritorOpen, value: abrirInterceptado });
      Object.defineProperty(prototipo, "send", { ...descritorSend, value: enviarInterceptado });
    } catch (_) {
      if (prototipo.open === abrirInterceptado) Object.defineProperty(prototipo, "open", descritorOpen);
      throw new ErroConsulta(
        "Não foi possível ativar o monitor de comandos NXJ. Nenhum campo foi alterado."
      );
    }

    function resumo(sequenciaMinima) {
      const itens = requisicoes
        .filter(requisicao => requisicao.sequencia > sequenciaMinima && requisicao.metodo === "POST")
        .slice(-8)
        .map(requisicao =>
          (requisicao.comando || "?") + "[" +
          requisicao.valoresPendentes.map(valor => valor.length).join(",") + "]"
        );

      return itens.join(" ") || "nenhum POST NXJ observado";
    }

    async function aguardarOcioso() {
      const inicio = Date.now();

      while (true) {
        verificar();

        if (estado.emAndamento === 0 && Date.now() - estado.ultimaConclusao >= silencioMs) return;

        if (Date.now() - inicio >= limiteEsperaMs) {
          throw new ErroConsulta(
            "O Systextil não ficou ocioso dentro de " + Math.round(limiteEsperaMs / 1000) + " segundos."
          );
        }

        await pausa(intervaloMs);
      }
    }

    /**
     * Espera um POST NXJ iniciado depois do marco, sua resposta HTTP 2xx e a
     * ociosidade seguinte. Um timeout não prova que o comando não ocorreu.
     */
    async function aguardarComando(sequenciaMinima, rotulo, aceitar) {
      const inicio = Date.now();
      let registro = null;

      while (!registro) {
        verificar();

        registro = requisicoes.find(requisicao =>
          requisicao.sequencia > sequenciaMinima &&
          requisicao.metodo === "POST" &&
          aceitar(requisicao)
        ) || null;
        if (registro) break;

        if (Date.now() - inicio >= limiteEsperaMs) {
          throw new ErroConsulta(
            "O Systextil não enviou o comando NXJ esperado (" + rotulo + ") dentro de " +
            Math.round(limiteEsperaMs / 1000) + " segundos. Diagnóstico NXJ: " +
            resumo(sequenciaMinima) + "."
          );
        }

        await pausa(intervaloMs);
      }

      if (registro.monitoramentoFalhou) {
        throw new ErroConsulta(
          "O comando NXJ (" + rotulo + ") foi observado, mas não pôde ser monitorado até a resposta."
        );
      }

      while (!registro.finalizado) {
        verificar();

        if (Date.now() - inicio >= limiteEsperaMs) {
          throw new ErroConsulta("O comando NXJ (" + rotulo + ") não terminou dentro do limite de espera.");
        }

        await pausa(intervaloMs);
      }

      if (registro.status < 200 || registro.status >= 300) {
        throw new ErroConsulta("O comando NXJ (" + rotulo + ") retornou HTTP " + registro.status + ".");
      }

      await aguardarOcioso();
      return registro;
    }

    /**
     * O valor precisa ter trafegado num comando de confirmação concluído com
     * HTTP 2xx dentro da janela do próprio campo (depois do marco e até o fim da
     * sua saída). Janela aberta confundiria campos com o mesmo valor (ex.: parcela
     * 1 e tipo 1).
     */
    function estatistica() {
      const posts = requisicoes.filter(requisicao => requisicao.metodo === "POST").length;
      return "NXJ observados no lote: " + requisicoes.length + " requisições (" + posts + " POST).";
    }

    function confirmou(valorEsperado, sequenciaMinima, sequenciaMaxima = Infinity) {
      return requisicoes.some(requisicao =>
        requisicao.sequencia > sequenciaMinima &&
        requisicao.sequencia <= sequenciaMaxima &&
        requisicao.metodo === "POST" &&
        COMANDOS_NXJ_CONFIRMACAO.has(requisicao.comando) &&
        !requisicao.monitoramentoFalhou &&
        requisicao.finalizado &&
        requisicao.status >= 200 &&
        requisicao.status < 300 &&
        valorConfere(requisicao.valoresPendentes, valorEsperado)
      );
    }

    return {
      obterSequencia: () => estado.sequencia,
      confirmou,
      resumo,
      estatistica,
      aguardarOcioso,
      aguardarComandoSaida: (sequenciaMinima, rotulo) => aguardarComando(
        sequenciaMinima,
        "saída do campo " + rotulo,
        requisicao => COMANDOS_NXJ_CONFIRMACAO.has(requisicao.comando)
      ),
      aguardarPostConsulta: sequenciaMinima => aguardarComando(sequenciaMinima, "Find", () => true),
      remover() {
        if (prototipo.open === abrirInterceptado) Object.defineProperty(prototipo, "open", descritorOpen);
        if (prototipo.send === enviarInterceptado) Object.defineProperty(prototipo, "send", descritorSend);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Fluxo por título
  // ---------------------------------------------------------------------------

  function montarPassosPreenchimento(item) {
    const passos = [{ chave: "empresa", name: CAMPOS_CHAVE.empresa.name, rotulo: CAMPOS_CHAVE.empresa.rotulo, valor: item.empresa }];

    if (item.cliente) {
      for (const parte of ["base", "ordem", "digito"]) {
        passos.push({
          chave: "cliente-" + parte,
          name: CAMPOS_CLIENTE[parte].name,
          rotulo: CAMPOS_CLIENTE[parte].rotulo,
          valor: item.cliente[parte]
        });
      }
    }

    for (const chave of ["numero", "parcela", "tipo"]) {
      passos.push({ chave, name: CAMPOS_CHAVE[chave].name, rotulo: CAMPOS_CHAVE[chave].rotulo, valor: item[chave] });
    }

    return passos;
  }

  /**
   * Respeita o maxLength declarado sem truncar dígitos. Única adaptação: a base
   * do CNPJ (8 dígitos + zero à esquerda) perde esse zero se o campo aceitar 8.
   */
  function ajustarValorAoCampo(passo, campo) {
    const maximo = Number(campo.maxLength);
    const valor = passo.valor;

    if (!Number.isInteger(maximo) || maximo <= 0 || valor.length <= maximo) return valor;

    if (passo.chave === "cliente-base" && valor.length === maximo + 1 && valor.startsWith("0")) {
      return valor.slice(1);
    }

    throw new ErroConsulta(passo.rotulo + " excede o tamanho aceito pelo campo. Nenhum dígito foi removido.");
  }

  // Inclui sempre o cliente: um filtro de cliente residual restringiria a consulta
  // sem que o operador percebesse.
  function camposDeConsultaVazios(documento) {
    const nomes = [
      CAMPOS_CHAVE.numero.name,
      CAMPOS_CHAVE.parcela.name,
      CAMPOS_CHAVE.tipo.name,
      ...Object.values(CAMPOS_CLIENTE).map(parte => parte.name)
    ];

    return nomes.every(name => {
      const campo = documento.getElementsByName(name)?.[0];
      return !campo || String(campo.value ?? "").trim() === "";
    });
  }

  async function prepararNovaConsulta(ctx) {
    const { pagina, documento, monitor, config } = ctx;
    const estado = lerEstadoTela(pagina);
    if (!estado) throw new ErroConsulta("Não foi possível identificar o estado atual da Consulta de títulos.");

    // Equivalente ao F6 (Nova consulta): só aciona quando há registro/resíduo na tela.
    if (estado.busca && camposDeConsultaVazios(documento)) return;

    ctx.verificar();
    ctx.etapa("Nova consulta");
    localizarControleUnico(pagina, ID_BOTAO_NOVA_CONSULTA).click();
    await pausa(config.pausaAposNovaConsultaMs);
    await monitor.aguardarOcioso();

    const inicio = Date.now();
    while (Date.now() - inicio < config.limiteNovaConsultaMs) {
      if (lerEstadoTela(pagina)?.busca === true) break;
      await pausa(80);
    }

    if (lerEstadoTela(pagina)?.busca !== true) {
      throw new ErroConsulta("Não foi possível preparar a tela para uma nova consulta.");
    }
    if (!camposDeConsultaVazios(documento)) {
      throw new ErroConsulta("O Systextil não limpou os campos da consulta anterior. Consulta interrompida.");
    }
  }

  /**
   * Preenche os campos na ordem da tela (Empresa, Cliente, Número, Parcela,
   * Tipo), um por vez, confirmando cada saída pelo NXJ. Retorna as confirmações.
   */
  async function preencherCampos(item, ctx) {
    const { pagina, documento, monitor, config } = ctx;
    const passos = montarPassosPreenchimento(item);
    const marcos = {};
    const fins = {};
    const origem = {};
    let campoAtivo = null;

    async function focarEAguardarSaida(name, rotulo) {
      const campo = obterCampoUnico(documento, name);
      const marco = monitor.obterSequencia();
      campo.focus();
      const focado = documento.activeElement === campo;
      await pausa(config.atrasoAposSairCampoMs);

      try {
        await monitor.aguardarComandoSaida(marco, rotulo);
      } catch (erro) {
        if (erro instanceof ErroConsulta && erro.status === STATUS.erro) {
          // Só metadados técnicos: ajudam a separar "foco não aplicado" de
          // "monitor não enxerga o tráfego" de "ERP não enviou comando".
          throw new ErroConsulta(
            erro.message + " Foco aplicado ao campo seguinte: " +
            (typeof documento.activeElement === "undefined" ? "n/d" : (focado ? "sim" : "não")) +
            "; documento com foco: " +
            (typeof documento.hasFocus === "function" ? (documento.hasFocus() ? "sim" : "não") : "n/d") +
            ". " + monitor.estatistica()
          );
        }
        throw erro;
      }
      return campo;
    }

    for (let indice = 0; indice < passos.length; indice += 1) {
      ctx.verificar();
      const passo = passos[indice];
      ctx.etapa("Preenchendo " + passo.rotulo);
      let campo = obterCampoUnico(documento, passo.name);

      // Empresa que a tela já traz com o valor pedido e com o nome carregado é a
      // empresa em uso: reescrever o mesmo valor não altera nada e o ERP pode não
      // enviar comando algum. A evidência é o valor visível + o nome da empresa.
      if (passo.chave === "empresa" && mesmoCodigo(campo.value, passo.valor)) {
        const nomeEmpresa = documento.getElementsByName(CAMPOS_CHAVE.empresa.descricao)?.[0];
        if (nomeEmpresa && String(nomeEmpresa.value ?? "").trim() !== "") {
          origem[passo.chave] = "TELA";
          campoAtivo = null;
          continue;
        }
      }

      if (campoSomenteLeitura(campo)) {
        // Somente Empresa pré-preenchida e idêntica à solicitada é aceita assim.
        if (passo.chave === "empresa" && mesmoCodigo(campo.value, passo.valor)) {
          origem[passo.chave] = "TELA";
          campoAtivo = null;
          continue;
        }
        throw new ErroConsulta(
          passo.chave === "empresa"
            ? "A empresa em uso na tela é diferente da empresa solicitada (campo bloqueado)."
            : "O campo está bloqueado para edição: " + passo.name,
          passo.chave === "empresa" ? STATUS.empresaInvalida : STATUS.erro
        );
      }

      validarCampoEditavel(campo, passo.name);

      if (campoAtivo === null) {
        // focus() sobre o elemento que já está focado não gera evento. Isso
        // acontece a partir do 2º título: o último passo devolveu o foco a este
        // campo. Desfocar antes garante uma ativação real.
        if (documento.activeElement === campo && typeof campo.blur === "function") {
          campo.blur();
          await pausa(config.atrasoFocoInicialMs);
          await monitor.aguardarOcioso();
        }
        campo.focus();
        await pausa(config.atrasoFocoInicialMs);
        await monitor.aguardarOcioso();
      } else if (campoAtivo !== campo) {
        // O ERP recriou o input durante a resposta: reativa o controle atual.
        for (let tentativa = 0; tentativa < 3 && campoAtivo !== campo; tentativa += 1) {
          campo = await focarEAguardarSaida(passo.name, "reativação de " + passo.rotulo);
          campoAtivo = campo;
          ctx.verificar();
          campo = obterCampoUnico(documento, passo.name);
        }
        if (campoAtivo !== campo) {
          throw new ErroConsulta("O Systextil recriou repetidamente o campo " + passo.name + " durante a ativação.");
        }
      }
      campoAtivo = campo;

      const valor = ajustarValorAoCampo(passo, campo);
      // Marco antes da escrita: o NXJ pode confirmar já no input/change.
      marcos[passo.chave] = monitor.obterSequencia();
      origem[passo.chave] = "NXJ";
      atribuirValorCampo(campo, valor);

      if (String(campo.value ?? "").trim() !== valor) {
        throw new ErroConsulta("O navegador não manteve o valor no campo: " + passo.name);
      }

      await pausa(config.atrasoAntesDeSairCampoMs);
      ctx.verificar();

      if (obterCampoUnico(documento, passo.name) !== campo || String(campo.value ?? "").trim() !== valor) {
        throw new ErroConsulta(
          "O Systextil alterou ou recriou o campo " + passo.name + " antes da confirmação. Confira a tela manualmente."
        );
      }

      // A saída do campo = foco no seguinte; o último devolve o foco ao primeiro
      // passo editável (nunca a um campo apenas exibido).
      const destino = indice + 1 < passos.length
        ? passos[indice + 1]
        : passos.find(candidato => origem[candidato.chave] !== "TELA");
      const campoDestino = await focarEAguardarSaida(destino.name, passo.rotulo);
      campoAtivo = campoDestino;
      passo.valorEnviado = valor;
      fins[passo.chave] = monitor.obterSequencia();
    }

    await monitor.aguardarOcioso();

    const pendentes = [];
    const confirmacoes = {};
    for (const passo of passos) {
      if (origem[passo.chave] === "TELA") {
        confirmacoes[passo.chave] = "TELA";
      } else if (monitor.confirmou(passo.valorEnviado, marcos[passo.chave], fins[passo.chave])) {
        confirmacoes[passo.chave] = "NXJ";
      } else {
        confirmacoes[passo.chave] = "PENDENTE";
        pendentes.push(passo.rotulo);
      }
    }

    if (pendentes.length) {
      throw new ErroConsulta(
        "O Systextil não confirmou pelo protocolo NXJ: " + pendentes.join(", ") +
        ". O Find foi bloqueado. Diagnóstico NXJ: " +
        monitor.resumo(Math.min(...Object.values(marcos))) + "."
      );
    }

    validarVisaoConsulta(pagina);
    return { passos, confirmacoes };
  }

  /**
   * Barreira final antes do Find: os campos visíveis não podem divergir do
   * solicitado e as descrições (empresa, cliente, tipo) precisam ter sido
   * carregadas pela tela — sem isso a empresa/cliente/tipo não são válidos.
   */
  function validarEstadoAntesDoFind(item, passos, confirmacoes, ctx) {
    const { documento } = ctx;

    for (const passo of passos) {
      const campo = obterCampoUnico(documento, passo.name);
      const visivel = String(campo.value ?? "").trim();
      if (!visivel) {
        // Vazio após o blur só é aceito quando o NXJ confirmou o valor.
        if (confirmacoes[passo.chave] !== "NXJ") {
          throw new ErroConsulta("O campo " + passo.name + " ficou vazio sem confirmação do Systextil.");
        }
      } else if (!mesmoCodigo(visivel, passo.valorEnviado ?? passo.valor)) {
        throw new ErroConsulta("O valor exibido em " + passo.name + " diverge do valor informado. Find bloqueado.");
      }
    }

    const exigirDescricao = (name, mensagem, status) => {
      const campo = documento.getElementsByName(name)?.[0];
      if (!campo || String(campo.value ?? "").trim() === "") throw new ErroConsulta(mensagem, status);
    };

    exigirDescricao(
      CAMPOS_CHAVE.empresa.descricao,
      "O Systextil não carregou o nome da empresa informada. Consulta bloqueada.",
      STATUS.empresaInvalida
    );
    if (item.cliente) {
      exigirDescricao(
        CAMPO_NOME_CLIENTE,
        "O Systextil não carregou o nome do cliente (cliente não cadastrado ou preenchimento não aceito). Consulta bloqueada.",
        STATUS.clienteInvalido
      );
    }
    exigirDescricao(
      CAMPOS_CHAVE.tipo.descricao,
      "O Systextil não carregou a descrição do tipo de título. Consulta bloqueada.",
      STATUS.tipoInvalido
    );
  }

  /**
   * Aciona Find uma única vez e classifica o desfecho. Nenhuma nova tentativa.
   * "sem-resultado" = a tela permaneceu em modo de consulta sem registro: pode
   * ser título inexistente, mas o valor de recordAction nesse caso ainda não foi
   * homologado, então não é afirmado como "não encontrado".
   */
  async function executarFind(ctx) {
    const { pagina, monitor, config } = ctx;
    const estadoAntes = lerEstadoTela(pagina);
    if (!estadoAntes?.busca) {
      throw new ErroConsulta("O Systextil não está em modo de consulta. Find não foi acionado.");
    }

    const botao = localizarControleUnico(pagina, ID_BOTAO_FIND);
    ctx.verificar();
    ctx.etapa("Consultando (Find)");
    const marco = monitor.obterSequencia();
    botao.click();
    await monitor.aguardarPostConsulta(marco);

    const inicio = Date.now();
    while (true) {
      ctx.verificar();
      const estado = lerEstadoTela(pagina);

      if (estado && !estado.busca) {
        if (estado.acao === "RECORDS_FOUND" && estado.total >= 1) {
          return { desfecho: estado.total === 1 ? "unico" : "ambiguo", total: estado.total };
        }
        if (/NO_RECORDS/i.test(estado.acao)) return { desfecho: "nao-encontrado", total: 0 };
      }

      const decorrido = Date.now() - inicio;
      if (estado?.busca && decorrido >= config.graciaModoConsultaMs) {
        return { desfecho: "sem-resultado", total: 0 };
      }
      if (decorrido >= config.limiteResultadoMs) {
        throw new ErroConsulta("O Systextil não confirmou o resultado da consulta.");
      }

      await pausa(100);
    }
  }

  async function lerCamposEstaveis(ctx) {
    const { documento, config } = ctx;
    ctx.etapa("Lendo os campos do título");
    const inicio = Date.now();
    let anterior = null;

    while (true) {
      ctx.verificar();
      const atual = lerCamposTitulo(documento);
      const assinatura = JSON.stringify(atual.valores);
      const numero = String(atual.valores[CAMPOS_CHAVE.numero.name] ?? "").trim();

      if (anterior !== null && assinatura === anterior && numero) return atual;
      anterior = assinatura;

      if (Date.now() - inicio >= config.limiteLeituraMs) {
        throw new ErroConsulta("Os campos do título não estabilizaram após a consulta. Leitura descartada.");
      }

      await pausa(config.estabilidadeLeituraMs);
    }
  }

  async function consultarTitulo(item, ctx) {
    const base = {
      linha: item.linha,
      empresa: item.empresa,
      numero: item.numero,
      parcela: item.parcela,
      tipo: item.tipo,
      clienteSolicitado: item.clienteInformado || ""
    };

    try {
      ctx.verificar();
      await prepararNovaConsulta(ctx);
      const { passos, confirmacoes } = await preencherCampos(item, ctx);
      validarEstadoAntesDoFind(item, passos, confirmacoes, ctx);

      const resultadoFind = await executarFind(ctx);

      if (resultadoFind.desfecho === "nao-encontrado") {
        return { ...base, status: STATUS.naoEncontrado, mensagem: "Nenhum registro para os dados informados." };
      }
      if (resultadoFind.desfecho === "sem-resultado") {
        return {
          ...base,
          status: STATUS.semResultado,
          mensagem: "A consulta terminou sem registro carregado. Pode ser título inexistente; confira manualmente."
        };
      }
      if (resultadoFind.desfecho === "ambiguo") {
        return {
          ...base,
          status: STATUS.ambiguo,
          mensagem: "A consulta retornou " + resultadoFind.total + " registros. Nenhum foi lido; confira os dados informados."
        };
      }

      const leitura = await lerCamposEstaveis(ctx);
      const divergencias = compararChave(item, leitura.valores);

      if (divergencias.length) {
        return {
          ...base,
          status: STATUS.divergente,
          mensagem: "O registro exibido não confere com o solicitado em: " + divergencias.join(", ") + ". Dados descartados."
        };
      }

      const alertas = avaliarAlertas(leitura.valores);
      if (!item.cliente) alertas.push("Cliente não informado: o cliente do registro não foi conferido.");
      if (leitura.ambiguos.length) alertas.push("Campos com nome duplicado na tela não foram lidos: " + leitura.ambiguos.join(", "));

      return {
        ...base,
        status: STATUS.ok,
        mensagem: "",
        valores: leitura.valores,
        alertas,
        ausentes: leitura.ausentes,
        ocultos: leitura.ocultos
      };
    } catch (erro) {
      if (erro instanceof ErroConsulta && erro.status !== STATUS.erro) {
        return { ...base, status: erro.status, mensagem: erro.message };
      }
      throw erro;
    }
  }

  /**
   * Consulta os títulos em sequência. Desfechos de negócio (não encontrado,
   * cliente inválido…) seguem para o próximo; erro de estado da tela, timeout
   * ou interrupção encerram o lote e marcam o restante como não processado.
   */
  async function consultarLote(itens, opcoes = {}) {
    const pagina = opcoes.pagina || obterPagina();
    const documento = opcoes.documento || pagina.document;
    const config = resolverConfig(opcoes.config);
    const controle = opcoes.controle || { cancelado: false };
    const aoProgresso = dados => {
      // A interface nunca pode derrubar o lote.
      try {
        if (typeof opcoes.aoProgresso === "function") opcoes.aoProgresso(dados);
      } catch (_) {}
    };

    if (!documento || typeof documento.getElementsByName !== "function") {
      throw new ErroConsulta("Não foi possível acessar o documento da Consulta de títulos.");
    }

    if (!Array.isArray(itens) || itens.length === 0 || itens.length > MAX_TITULOS_POR_LOTE) {
      throw new ErroConsulta("Lote inválido: informe de 1 a " + MAX_TITULOS_POR_LOTE + " títulos.");
    }

    const verificar = () => {
      if (controle.cancelado) throw new ErroCancelado();
      validarVisaoConsulta(pagina);
    };

    verificar();
    localizarControleUnico(pagina, ID_BOTAO_NOVA_CONSULTA);
    localizarControleUnico(pagina, ID_BOTAO_FIND);

    const monitor = criarMonitorNxj(pagina, config, verificar);
    let indiceAtual = 0;
    // Só rótulos de etapa: nunca valores de título, cliente ou saldo.
    const etapa = texto => aoProgresso({ tipo: "etapa", indice: indiceAtual, total: itens.length, texto });
    const ctx = { pagina, documento, monitor, config, verificar, etapa };
    const resultados = [];

    try {
      for (let indice = 0; indice < itens.length; indice += 1) {
        const item = itens[indice];
        indiceAtual = indice;
        aoProgresso({ tipo: "iniciando", indice, total: itens.length, item });

        try {
          const resultado = await consultarTitulo(item, ctx);
          resultados.push(resultado);
          aoProgresso({ tipo: "resultado", indice, total: itens.length, resultado });
        } catch (erro) {
          const interrompido = erro instanceof ErroCancelado;
          const atual = {
            linha: item.linha,
            empresa: item.empresa,
            numero: item.numero,
            parcela: item.parcela,
            tipo: item.tipo,
            clienteSolicitado: item.clienteInformado || "",
            status: interrompido ? STATUS.naoProcessado : STATUS.erro,
            mensagem: interrompido
              ? "Interrompido pelo operador durante este título. Use Nova consulta na tela antes de continuar."
              : "Lote interrompido: " + limitarTexto(erro?.message || "erro inesperado", 600) +
                " Confira a tela antes de nova tentativa."
          };
          resultados.push(atual);
          aoProgresso({ tipo: "resultado", indice, total: itens.length, resultado: atual });

          for (let resto = indice + 1; resto < itens.length; resto += 1) {
            const pendente = itens[resto];
            const naoProcessado = {
              linha: pendente.linha,
              empresa: pendente.empresa,
              numero: pendente.numero,
              parcela: pendente.parcela,
              tipo: pendente.tipo,
              clienteSolicitado: pendente.clienteInformado || "",
              status: STATUS.naoProcessado,
              mensagem: "Não processado: o lote foi interrompido."
            };
            resultados.push(naoProcessado);
            aoProgresso({ tipo: "resultado", indice: resto, total: itens.length, resultado: naoProcessado });
          }
          break;
        }
      }
    } finally {
      monitor.remover();
    }

    return resultados;
  }

  // ---------------------------------------------------------------------------
  // Interface (popup). Todo texto vindo do ERP entra por textContent.
  // Os resultados ficam apenas em memória enquanto o popup está aberto.
  // ---------------------------------------------------------------------------

  const ESTILO_POPUP = `
    :host { all: initial; }
    .fundo { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.45);
      display: flex; align-items: flex-start; justify-content: center; overflow: auto;
      font: 13px/1.4 Arial, Helvetica, sans-serif; color: #1b1b1b; }
    .painel { background: #fff; margin: 24px; width: min(1100px, 100%); border-radius: 6px;
      box-shadow: 0 8px 32px rgba(0,0,0,.35); padding: 16px 18px; box-sizing: border-box; }
    /* Compacto: cartão no canto, fundo transparente, para ver a tela do ERP. */
    .fundo.compacto { background: transparent; align-items: flex-end; justify-content: flex-end; overflow: hidden; }
    .fundo.compacto:not(.bloqueia) { pointer-events: none; }
    .fundo.compacto .painel { pointer-events: auto; width: 380px; margin: 12px; max-height: 45vh; overflow: auto;
      border: 2px solid #1d4f91; }
    .fundo.compacto .oculta-compacto { display: none; }
    .fundo.compacto h2 { font-size: 14px; }
    h2 { margin: 0; font-size: 17px; }
    .topo { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .selo { font-size: 11px; background: #e6f2e6; color: #1d5c1d; border-radius: 10px; padding: 2px 8px; }
    textarea { width: 100%; box-sizing: border-box; min-height: 130px; margin-top: 8px;
      font: 12px/1.4 Consolas, "Courier New", monospace; padding: 8px; }
    button { font: inherit; padding: 6px 14px; margin-right: 8px; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .55; }
    .principal { background: #1d4f91; color: #fff; border: 1px solid #163d71; border-radius: 4px; }
    .acoes { margin-top: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    .status { margin-left: 8px; }
    .aviso { background: #fff6dc; border: 1px solid #e3c766; padding: 6px 10px; margin-top: 8px; border-radius: 4px; }
    .erros { background: #fde8e8; border: 1px solid #d99; padding: 6px 10px 6px 28px; margin: 8px 0 0; border-radius: 4px; }
    details { margin-top: 8px; }
    summary { cursor: pointer; }
    table { border-collapse: collapse; width: 100%; margin-top: 10px; font-size: 12px; }
    th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: left; vertical-align: top; }
    th { background: #f0f0f0; position: sticky; top: 0; }
    .st-ok { color: #1d5c1d; font-weight: bold; }
    .st-atencao { color: #8a5a00; font-weight: bold; }
    .st-erro { color: #a11; font-weight: bold; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 6px 0; }
    dt { color: #555; } dd { margin: 0; word-break: break-word; }
    h3 { margin: 8px 0 0; font-size: 12px; text-transform: uppercase; color: #345; }
  `;

  const AJUDA_FORMATO = [
    "Um título por linha, colunas separadas por tab (colar da planilha) ou ponto e vírgula:",
    "empresa;cliente (CNPJ/CPF);número;parcela;tipo",
    "O cliente é opcional: deixe a coluna vazia ou use somente 4 colunas (empresa;número;parcela;tipo).",
    "Linhas vazias e linhas iniciadas por # são ignoradas. Vírgula e hífen não são aceitos em número, parcela e tipo.",
    "Qualquer linha inválida impede o início do lote. No máximo " + MAX_TITULOS_POR_LOTE + " títulos por vez."
  ];

  const EXEMPLO_ENTRADA = "# empresa;cliente;número;parcela;tipo (exemplo fictício)\n1;12.345.678/0001-00;123456;1;1";

  function criarElemento(documento, nome, propriedades = {}, texto) {
    const elemento = documento.createElement(nome);
    for (const [chave, valor] of Object.entries(propriedades)) {
      if (chave === "className") elemento.className = valor;
      else elemento.setAttribute(chave, valor);
    }
    if (texto !== undefined) elemento.textContent = texto;
    return elemento;
  }

  function classeStatus(status) {
    if (status === STATUS.ok) return "st-ok";
    if (status === STATUS.erro || status === STATUS.divergente || status === STATUS.naoProcessado) return "st-erro";
    return "st-atencao";
  }

  function criarDetalhesCampos(documento, resultado) {
    const detalhes = criarElemento(documento, "details");
    detalhes.appendChild(criarElemento(documento, "summary", {}, "Campos lidos"));

    for (const grupo of CATALOGO_CAMPOS) {
      const preenchidos = grupo.campos.filter(campo => String(resultado.valores[campo.name] ?? "") !== "");
      if (!preenchidos.length) continue;

      detalhes.appendChild(criarElemento(documento, "h3", {}, grupo.grupo));
      const lista = criarElemento(documento, "dl");
      for (const campo of preenchidos) {
        lista.appendChild(criarElemento(documento, "dt", {}, campo.rotulo));
        lista.appendChild(criarElemento(documento, "dd", {}, resultado.valores[campo.name]));
      }
      detalhes.appendChild(lista);
    }

    return detalhes;
  }

  function renderizarResultados(documento, tabela, resultados) {
    tabela.textContent = "";
    if (!resultados.length) return;

    const cabecalho = criarElemento(documento, "tr");
    ["Linha", "Empresa", "Título", "Parcela", "Tipo", "Resultado", "Situação", "Vencimento", "Valor", "Saldo", "Cliente"]
      .forEach(titulo => cabecalho.appendChild(criarElemento(documento, "th", {}, titulo)));
    tabela.appendChild(cabecalho);

    for (const resultado of resultados) {
      const valores = resultado.valores || {};
      const linha = criarElemento(documento, "tr");
      const situacao = valores["situacao_duplic."]
        ? valores["situacao_duplic."] + " — " + descreverSituacao(valores["situacao_duplic."])
        : "";

      [
        resultado.linha, resultado.empresa, resultado.numero, resultado.parcela, resultado.tipo
      ].forEach(valor => linha.appendChild(criarElemento(documento, "td", {}, String(valor))));

      const celulaStatus = criarElemento(documento, "td", { className: classeStatus(resultado.status) },
        ROTULO_STATUS[resultado.status] || resultado.status);
      if (resultado.mensagem) celulaStatus.appendChild(criarElemento(documento, "div", {}, resultado.mensagem));
      for (const alerta of resultado.alertas || []) {
        celulaStatus.appendChild(criarElemento(documento, "div", { className: "st-atencao" }, "⚠ " + alerta));
      }
      linha.appendChild(celulaStatus);

      [
        situacao, valores["data_venc_duplic."], valores["valor_duplicata."],
        valores["saldo_duplicata."], valores["nome_cliente."]
      ].forEach(valor => linha.appendChild(criarElemento(documento, "td", {}, String(valor ?? ""))));

      tabela.appendChild(linha);

      if (resultado.valores) {
        const linhaDetalhes = criarElemento(documento, "tr");
        const celula = criarElemento(documento, "td", { colspan: "11" });
        celula.appendChild(criarDetalhesCampos(documento, resultado));
        linhaDetalhes.appendChild(celula);
        tabela.appendChild(linhaDetalhes);
      }
    }
  }

  function copiarTexto(documento, texto) {
    // O Systextil pode estar em http (sem navigator.clipboard): usa execCommand.
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texto).then(() => true, () => false);
    }

    const area = documento.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;left:-9999px;top:0;";
    documento.body.appendChild(area);
    area.select();

    let copiado = false;
    try {
      copiado = documento.execCommand("copy");
    } catch (_) {
      copiado = false;
    }
    area.remove();
    return Promise.resolve(copiado);
  }

  function baixarArquivo(documento, nome, conteudo, tipo) {
    const blob = new Blob(["﻿", conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const ancora = documento.createElement("a");
    ancora.href = url;
    ancora.download = nome;
    ancora.style.display = "none";
    documento.body.appendChild(ancora);
    ancora.click();
    ancora.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function carimboArquivo(data) {
    const pad = valor => String(valor).padStart(2, "0");
    return data.getFullYear() + pad(data.getMonth() + 1) + pad(data.getDate()) +
      "-" + pad(data.getHours()) + pad(data.getMinutes()) + pad(data.getSeconds());
  }

  let popupAberto = null;
  let loteEmAndamento = false;

  function abrirPopup() {
    if (popupAberto) {
      popupAberto.focar();
      return;
    }

    const pagina = obterPagina();
    const documento = pagina.document || document;
    const hospedeiro = criarElemento(documento, "div", { id: "st-consulta-titulos-popup" });
    const raiz = hospedeiro.attachShadow({ mode: "open" });
    const controle = { cancelado: false };
    let resultados = [];
    let tituloAtual = "";

    raiz.appendChild(criarElemento(documento, "style", {}, ESTILO_POPUP));
    const fundo = criarElemento(documento, "div", { className: "fundo" });
    const painel = criarElemento(documento, "div", {
      className: "painel", role: "dialog", "aria-modal": "true", "aria-labelledby": "st-ct-titulo"
    });
    fundo.appendChild(painel);
    raiz.appendChild(fundo);

    const topo = criarElemento(documento, "div", { className: "topo" });
    topo.appendChild(criarElemento(documento, "h2", { id: "st-ct-titulo" }, "Consulta de títulos em lote (crec_f090)"));
    topo.appendChild(criarElemento(documento, "span", { className: "selo oculta-compacto" }, "somente leitura · v" + VERSION));
    painel.appendChild(topo);

    const aviso = criarElemento(documento, "div", { className: "aviso oculta-compacto" });
    painel.appendChild(aviso);

    const rotuloEntrada = criarElemento(documento, "label", { for: "st-ct-entrada" },
      "Títulos (um por linha): empresa;cliente;número;parcela;tipo");
    rotuloEntrada.style.cssText = "display:block;margin-top:10px;font-weight:bold;";
    rotuloEntrada.classList.add("oculta-compacto");
    painel.appendChild(rotuloEntrada);

    const entrada = criarElemento(documento, "textarea", {
      id: "st-ct-entrada", spellcheck: "false", placeholder: EXEMPLO_ENTRADA
    });
    entrada.classList.add("oculta-compacto");
    painel.appendChild(entrada);

    const ajuda = criarElemento(documento, "details", { className: "oculta-compacto" });
    ajuda.appendChild(criarElemento(documento, "summary", {}, "Formato e regras"));
    AJUDA_FORMATO.forEach(linha => ajuda.appendChild(criarElemento(documento, "div", {}, linha)));
    painel.appendChild(ajuda);

    const listaErros = criarElemento(documento, "ul", { className: "erros oculta-compacto", hidden: "" });
    painel.appendChild(listaErros);

    const acoes = criarElemento(documento, "div", { className: "acoes" });
    const botaoConsultar = criarElemento(documento, "button", { type: "button", className: "principal" }, "Consultar");
    const botaoInterromper = criarElemento(documento, "button", { type: "button" }, "Interromper (Esc)");
    const botaoCopiar = criarElemento(documento, "button", { type: "button" }, "Copiar para planilha");
    const botaoCsv = criarElemento(documento, "button", { type: "button" }, "Baixar CSV");
    const botaoFechar = criarElemento(documento, "button", { type: "button", className: "oculta-compacto" }, "Fechar");
    const botaoMinimizar = criarElemento(documento, "button", { type: "button" }, "Minimizar");
    const status = criarElemento(documento, "span", { className: "status", role: "status", "aria-live": "polite" });
    botaoInterromper.disabled = true;
    botaoCopiar.disabled = true;
    botaoCsv.disabled = true;
    botaoConsultar.classList.add("oculta-compacto");
    botaoCopiar.classList.add("oculta-compacto");
    botaoCsv.classList.add("oculta-compacto");
    [botaoConsultar, botaoInterromper, botaoMinimizar, botaoCopiar, botaoCsv, botaoFechar, status]
      .forEach(elemento => acoes.appendChild(elemento));
    painel.appendChild(acoes);

    const tabela = criarElemento(documento, "table", { className: "oculta-compacto" });
    painel.appendChild(tabela);

    function atualizarAviso() {
      const naTela = lerEstadoTela(pagina)?.visao === VISAO_CONSULTA_TITULOS;
      aviso.textContent = naTela
        ? "Consulta de títulos detectada. Ao clicar em Consultar, o script usa Nova consulta e Find do Systextil para cada linha. " +
          "Não digite nem clique no Systextil durante a execução. Nada é emitido, gravado ou enviado para fora do navegador."
        : "Abra a Consulta de títulos (crec_f090) no Systextil antes de consultar. A tela ativa não é essa consulta.";
    }

    function definirStatus(texto) {
      status.textContent = texto;
    }

    function bloquearTeclado(evento) {
      // Durante o lote, o foco é movido entre campos do ERP: teclas do operador
      // seriam digitadas nesses campos. Somente Esc (interromper) passa.
      if (evento.key === "Escape") return;
      evento.preventDefault();
      evento.stopImmediatePropagation();
    }

    function definirExecutando(executando) {
      loteEmAndamento = executando;
      // Durante o lote: cartão compacto no canto, fundo transparente (a tela do
      // ERP fica visível) e um escudo invisível que ainda bloqueia cliques.
      fundo.classList.toggle("compacto", executando);
      fundo.classList.toggle("bloqueia", executando);
      botaoMinimizar.textContent = "Minimizar";
      botaoMinimizar.disabled = executando;
      botaoConsultar.disabled = executando;
      entrada.disabled = executando;
      botaoFechar.disabled = executando;
      botaoInterromper.disabled = !executando;
      const temResultados = resultados.length > 0;
      botaoCopiar.disabled = executando || !temResultados;
      botaoCsv.disabled = executando || !temResultados;

      if (executando) {
        pagina.addEventListener("keydown", bloquearTeclado, true);
        pagina.addEventListener("keypress", bloquearTeclado, true);
      } else {
        pagina.removeEventListener("keydown", bloquearTeclado, true);
        pagina.removeEventListener("keypress", bloquearTeclado, true);
      }
    }

    function mostrarErros(erros) {
      listaErros.textContent = "";
      listaErros.hidden = erros.length === 0;
      for (const erro of erros) {
        listaErros.appendChild(criarElemento(documento, "li", {},
          (erro.linha ? "Linha " + erro.linha + ": " : "") + erro.mensagem));
      }
    }

    async function consultar() {
      if (loteEmAndamento) return;
      mostrarErros([]);
      const interpretacao = interpretarEntradaTitulos(entrada.value);

      if (interpretacao.erros.length) {
        mostrarErros(interpretacao.erros);
        definirStatus("Corrija as linhas indicadas. Nenhuma consulta foi iniciada.");
        return;
      }

      resultados = [];
      renderizarResultados(documento, tabela, resultados);
      controle.cancelado = false;
      definirExecutando(true);
      definirStatus("Iniciando…");

      try {
        resultados = await consultarLote(interpretacao.itens, {
          pagina,
          documento,
          controle,
          aoProgresso(evento) {
            if (evento.tipo === "iniciando") {
              tituloAtual = "título " + evento.item.numero + " parcela " + evento.item.parcela;
              definirStatus("Consultando " + (evento.indice + 1) + " de " + evento.total + " (" + tituloAtual + ")…");
            } else if (evento.tipo === "etapa") {
              definirStatus("Consultando " + (evento.indice + 1) + " de " + evento.total + " (" + tituloAtual + ") — " + evento.texto + "…");
            } else {
              resultados = resultados.filter(anterior => anterior.linha !== evento.resultado.linha);
              resultados.push(evento.resultado);
              renderizarResultados(documento, tabela, resultados);
            }
          }
        });

        const ok = resultados.filter(resultado => resultado.status === STATUS.ok).length;
        definirStatus("Concluído: " + ok + " de " + resultados.length + " lidos e conferidos.");
      } catch (erro) {
        definirStatus(limitarTexto(erro?.message || "Falha inesperada.", 300));
      } finally {
        definirExecutando(false);
        renderizarResultados(documento, tabela, resultados);
        atualizarAviso();
      }
    }

    function fechar() {
      if (loteEmAndamento) return;
      hospedeiro.remove();
      documento.removeEventListener("keydown", aoTeclar, true);
      popupAberto = null;
    }

    function aoTeclar(evento) {
      if (evento.key !== "Escape") return;
      evento.preventDefault();
      if (loteEmAndamento) {
        controle.cancelado = true;
        definirStatus("Interrupção solicitada. O título em andamento será encerrado em um ponto seguro.");
      } else {
        fechar();
      }
    }

    // Isola o teclado do popup: o Systextil tem atalhos de tecla global.
    ["keydown", "keyup", "keypress"].forEach(tipo =>
      hospedeiro.addEventListener(tipo, evento => evento.stopPropagation())
    );
    documento.addEventListener("keydown", aoTeclar, true);

    botaoConsultar.addEventListener("click", () => { void consultar(); });
    botaoInterromper.addEventListener("click", () => {
      controle.cancelado = true;
      definirStatus("Interrupção solicitada. O título em andamento será encerrado em um ponto seguro.");
    });
    botaoFechar.addEventListener("click", fechar);
    botaoMinimizar.addEventListener("click", () => {
      if (loteEmAndamento) return; // durante o lote o cartão já é compacto
      const compacto = fundo.classList.toggle("compacto");
      botaoMinimizar.textContent = compacto ? "Expandir" : "Minimizar";
    });
    botaoCopiar.addEventListener("click", async () => {
      const copiado = await copiarTexto(documento, montarTsv(resultados));
      definirStatus(copiado ? "Resultado copiado. Cole na planilha." : "Não foi possível copiar. Use Baixar CSV.");
    });
    botaoCsv.addEventListener("click", () => {
      baixarArquivo(documento, "consulta-titulos-" + carimboArquivo(new Date()) + ".csv", montarCsv(resultados), "text/csv;charset=utf-8");
      definirStatus("CSV gerado localmente no navegador.");
    });

    atualizarAviso();
    (documento.documentElement || documento.body).appendChild(hospedeiro);
    popupAberto = { focar: () => entrada.focus() };
    entrada.focus();
  }

  function atalhoPressionado(evento) {
    return !evento.repeat &&
      evento.code === ATALHO.codigo &&
      evento.altKey === ATALHO.alt &&
      evento.shiftKey === ATALHO.shift &&
      evento.ctrlKey === ATALHO.ctrl &&
      evento.metaKey === ATALHO.meta;
  }

  function iniciar() {
    window.addEventListener("keydown", evento => {
      if (!atalhoPressionado(evento)) return;
      evento.preventDefault();
      evento.stopPropagation();
      try {
        abrirPopup();
      } catch (erro) {
        // Sem dados do ERP: apenas o motivo técnico.
        console.warn("[Consulta de títulos] " + limitarTexto(erro?.message, 200));
      }
    }, true);

    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("Consulta de títulos em lote (" + ATALHO_TEXTO + ")", () => {
        try {
          abrirPopup();
        } catch (erro) {
          console.warn("[Consulta de títulos] " + limitarTexto(erro?.message, 200));
        }
      });
    }
  }

  if (EM_NODE) {
    module.exports = Object.freeze({
      VERSION,
      STATUS,
      CATALOGO_CAMPOS,
      CAMPOS_CLIENTE,
      ATALHO,
      ErroConsulta,
      normalizarCodigoComparacao,
      validarCodigo,
      dividirDocumentoCliente,
      interpretarEntradaTitulos,
      descreverSituacao,
      lerValorMonetario,
      avaliarAlertas,
      compararChave,
      neutralizarCelulaPlanilha,
      montarTsv,
      montarCsv,
      atalhoPressionado,
      lerCamposTitulo,
      consultarLote
    });
    return;
  }

  iniciar();
})();
