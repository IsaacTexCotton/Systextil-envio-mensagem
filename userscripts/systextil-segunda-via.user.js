// ==UserScript==
// @name         Systextil — Segunda Via Automática CRM
// @namespace    https://github.com/IsaacTexCotton/Systextil-envio-mensagem
// @version      1.0.3
// @description  Recebe o título do SmartTable, consulta, emite, acompanha o processo e baixa o PDF automaticamente.
// @match        https://texhub.texcotton.com.br/crm/*
// @match        http://systextil.texcotton.com.br/systextil/*
// @match        https://systextil.texcotton.com.br/systextil/*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      systextil.texcotton.com.br
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via.user.js
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "1.0.3";
  const DATA_VIEW_CONSULTA_TITULOS = "forms.crec.crec_f090";
  const DATA_VIEW_PROCESSOS = "forms.systextil.batch";
  const ENDPOINT_COMANDO_NXJ = /(?:^|\/)UnifyNXJ\.jsp(?:[?#]|$)/i;
  const COMANDOS_NXJ_CONFIRMACAO = new Set(["CLICKONFIELD", "NEXT_FIELD"]);
  let preenchimentoEmAndamento = false;

  const CAMPOS = Object.freeze({
    titulo: "num_duplicata.",
    parcela: "seq_duplicatas.",
    cliente: "nome_cliente."
  });

  const MAX_NOME_ARQUIVO = 180;
  const MAX_INICIO_RAZAO_SOCIAL = 35;
  const LARGURAS_PADRAO_CONSULTA = Object.freeze({ titulo: 8, parcela: 2 });
  const CHAVE_SOLICITACAO_EMISSAO = "st-segunda-via-boleto:solicitacao";
  const TITULO_PROCESSO_BOLETO = "Emissão de boletos com registro";
  const MENSAGEM_SUCESSO_PROCESSO = "Processo concluído com sucesso.";
  const TOLERANCIA_HORARIO_PROCESSO_MS = 90 * 1000;
  const MAX_IDADE_SOLICITACAO_MS = 30 * 60 * 1000;
  const MAX_REGISTROS_PROCESSO = 200;
  const TEMPO_RESERVA_DOWNLOAD_MS = 15 * 60 * 1000;
  const PROGRAMA_RELATORIO_BOLETO = "forms.crec.crec_e259";
  const CHAVE_DOWNLOAD_PREFIXO = "st-segunda-via-boleto:download:";
  const TAMANHO_MAXIMO_PDF = 25 * 1024 * 1024;

  const EM_NODE = typeof module === "object" && module.exports;
  const URL_ATUAL = EM_NODE ? null : new URL(window.location.href);
  const NA_PAGINA_CRM = !EM_NODE &&
    URL_ATUAL.hostname === "texhub.texcotton.com.br" &&
    URL_ATUAL.pathname.startsWith("/crm/");
  const NA_PAGINA_SYSTEXTIL = !EM_NODE &&
    URL_ATUAL.hostname === "systextil.texcotton.com.br" &&
    URL_ATUAL.pathname.startsWith("/systextil/");

  if (!EM_NODE && !NA_PAGINA_CRM && !NA_PAGINA_SYSTEXTIL) return;
  if (!EM_NODE && window.top !== window) return;

  const EVENTO_ENVIAR = "smarttable:systextil:enviar-titulo";
  const EVENTO_RESULTADO = "smarttable:systextil:resultado";
  const CHAVES = Object.freeze({
    pedido: "smarttable.systextil.title-transfer.v1.pedido",
    resultado: "smarttable.systextil.title-transfer.v1.resultado",
    consumidor: "smarttable.systextil.title-transfer.v1.consumidor",
    execucao: "smarttable.systextil.title-transfer.v1.execucao",
    lockProcesso: "smarttable.systextil.title-transfer.v1.lock-processo"
  });
  const TTL_PEDIDO_MS = 5 * 60 * 1000;
  const TTL_LOCK_TRANSFER_MS = 10 * 60 * 1000;
  const TTL_LOCK_PROCESSO_MS = 10 * 60 * 1000;
  const MAX_TITULO_TRANSFERENCIA = 40;
  const MAX_PARCELA_TRANSFERENCIA = 20;
  const ABA_ID = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  const JANELA_BLOQUEIO_EMISSAO_MS = 5 * 60 * 1000;
  const PREFIXO_CHAVE_EMISSAO = "st-auto-segunda-via:emissao:";
  const VISAO_CONSULTA = DATA_VIEW_CONSULTA_TITULOS;
  const VISAO_PROCESSOS = DATA_VIEW_PROCESSOS;

  /**
   * Remove caracteres inválidos para nomes de arquivo do Windows.
   * Não altera o valor exibido no ERP; atua apenas na cópia usada no nome.
   */
  function sanitizarParteNome(valor) {
    return String(valor ?? "")
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "");
  }

  function truncarUnicode(valor, limite) {
    return Array.from(valor).slice(0, limite).join("");
  }

  /**
   * Mantém apenas o começo do nome/razão social.
   * Prioriza palavras inteiras até o limite; usa reticências para indicar corte.
   */
  function limitarInicioRazaoSocial(valor) {
    const nome = sanitizarParteNome(valor);

    if (Array.from(nome).length <= MAX_INICIO_RAZAO_SOCIAL) {
      return nome;
    }

    const palavras = nome.split(/\s+/).filter(Boolean);
    let inicio = "";

    for (const palavra of palavras) {
      const candidato = inicio ? inicio + " " + palavra : palavra;

      if (Array.from(candidato).length > MAX_INICIO_RAZAO_SOCIAL) {
        break;
      }

      inicio = candidato;
    }

    // Se a primeira palavra sozinha ultrapassar o limite, limita por caracteres.
    if (!inicio) {
      inicio = truncarUnicode(nome, MAX_INICIO_RAZAO_SOCIAL);
    }

    return inicio.replace(/[. ]+$/g, "") + "…";
  }

  /**
   * Monta o nome final e falha quando qualquer parte obrigatória está ausente.
   * O limite considera o nome completo, sem caminho.
   */
  function montarNomeArquivo(dados) {
    const cliente = sanitizarParteNome(dados?.cliente);
    const titulo = sanitizarParteNome(dados?.titulo);
    const parcela = sanitizarParteNome(dados?.parcela);

    if (!cliente) {
      throw new Error("Nome do cliente não identificado.");
    }

    if (!titulo || !/^[A-Za-z0-9_-]+$/.test(titulo)) {
      throw new Error("Número do título vazio ou com formato inesperado.");
    }

    if (!parcela || !/^[A-Za-z0-9_-]+$/.test(parcela)) {
      throw new Error("Parcela/sequência vazia ou com formato inesperado.");
    }

    const sufixo = " - " + titulo + "." + parcela + ".pdf";
    const limiteCliente = MAX_NOME_ARQUIVO - Array.from(sufixo).length;

    if (limiteCliente < 1) {
      throw new Error("Número do título/parcela excede o limite de nome.");
    }

    const clienteFinal = truncarUnicode(
      limitarInicioRazaoSocial(cliente),
      limiteCliente
    ).replace(/[. ]+$/g, "");

    if (!clienteFinal) {
      throw new Error("Nome do cliente inválido após sanitização.");
    }

    return clienteFinal + sufixo;
  }

  function localizarFormulario() {
    const formularios = Array.from(document.forms).filter(form =>
      Object.values(CAMPOS).every(nome => {
        const campo = form.elements.namedItem(nome);
        return campo && typeof campo.value === "string";
      })
    );

    if (formularios.length !== 1) {
      throw new Error(
        formularios.length === 0
          ? "Formulário da consulta de títulos não identificado."
          : "Mais de um formulário compatível encontrado; operação interrompida."
      );
    }

    return formularios[0];
  }

  function lerValor(formulario, nome) {
    const campo = formulario.elements.namedItem(nome);

    if (!campo || typeof campo.value !== "string") {
      throw new Error("Campo obrigatório não encontrado: " + nome);
    }

    return campo.value.trim();
  }

  function lerDadosTitulo() {
    const formulario = localizarFormulario();

    const dados = {
      titulo: lerValor(formulario, CAMPOS.titulo),
      parcela: lerValor(formulario, CAMPOS.parcela),
      cliente: lerValor(formulario, CAMPOS.cliente)
    };

    const nomeArquivo = montarNomeArquivo(dados);

    return {
      dados,
      nomeArquivo
    };
  }


  /**
   * Valida identificadores antes de preencher os campos do ERP.
   * Mantém zeros à esquerda e não converte os valores em números.
   */
  function validarCodigoConsulta(valor, rotulo) {
    const codigo = String(valor ?? "").trim();

    if (!codigo) {
      throw new Error(rotulo + " não informado.");
    }

    if (!/^[A-Za-z0-9_-]+$/.test(codigo)) {
      throw new Error(rotulo + " contém caracteres não permitidos.");
    }

    return codigo;
  }

  /**
   * Valida o comprimento permitido pelo campo sem alterar o identificador.
   * maxLength representa o limite máximo, não a quantidade obrigatória de dígitos.
   */
  function validarComprimentoCodigoConsulta(codigo, rotulo, largura) {
    if (!Number.isInteger(largura) || largura < 1) {
      throw new Error("Não foi possível determinar o tamanho do campo " + rotulo.toLowerCase() + ".");
    }

    if (codigo.length > largura) {
      throw new Error(
        rotulo + " possui " + codigo.length +
        " caracteres, mas o campo aceita " + largura + ". Nenhum dígito foi removido."
      );
    }

    return codigo;
  }

  /**
   * Normaliza somente o número do título, completando zeros à esquerda.
   */
  function normalizarCodigoConsulta(valor, rotulo, largura) {
    const codigo = validarCodigoConsulta(valor, rotulo);
    validarComprimentoCodigoConsulta(codigo, rotulo, largura);

    return /^[0-9]+$/.test(codigo)
      ? codigo.padStart(largura, "0")
      : codigo;
  }

  /**
   * Valida a parcela sem acrescentar zeros à esquerda.
   * O Systextil aceita a parcela exatamente como informada pelo operador.
   */
  function preservarCodigoConsulta(valor, rotulo, largura) {
    const codigo = validarCodigoConsulta(valor, rotulo);
    return validarComprimentoCodigoConsulta(codigo, rotulo, largura);
  }

  function obterLarguraCampo(campo, larguraPadrao) {
    const larguraDeclarada = Number(campo.maxLength);

    return Number.isInteger(larguraDeclarada) &&
      larguraDeclarada > 0 &&
      larguraDeclarada <= 20
      ? larguraDeclarada
      : larguraPadrao;
  }

  function localizarFormularioConsulta() {
    const nomesObrigatorios = [CAMPOS.titulo, CAMPOS.parcela];
    const formularios = Array.from(document.forms).filter(form =>
      nomesObrigatorios.every(nome => {
        const campo = form.elements.namedItem(nome);
        return campo && typeof campo.value === "string";
      })
    );

    if (formularios.length !== 1) {
      throw new Error(
        formularios.length === 0
          ? "Campos de número do título e parcela não encontrados."
          : "Mais de um formulário de consulta compatível; preenchimento interrompido."
      );
    }

    return formularios[0];
  }

  /**
   * Atualiza o valor pelo setter nativo do input.
   *
   * Alguns formulários mantêm um estado interno/controle de alterações separado
   * do valor visual. Atribuir diretamente em campo.value pode atualizar somente
   * a propriedade observável pelo DOM e não notificar corretamente o formulário.
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
      // Fallback para ambientes de teste e controles que não sejam HTMLInputElement.
      campo.value = valor;
    }

    // Reproduz exatamente o tipo de evento dos scripts manuais que funcionaram
    // no ERP: Event padrão para input e change (não InputEvent).
    const ConstrutorEvento = janela.Event || Event;

    campo.dispatchEvent(new ConstrutorEvento("input", { bubbles: true }));
    campo.dispatchEvent(new ConstrutorEvento("change", { bubbles: true }));
  }

  function obterJanelaPaginaSystextil() {
    const pagina = typeof unsafeWindow !== "undefined" && unsafeWindow
      ? unsafeWindow
      : window;

    if (!pagina?.XMLHttpRequest) {
      throw new Error("Não foi possível acessar o XMLHttpRequest da página do Systextil.");
    }

    return pagina;
  }

  function validarVisaoConsultaTitulos(pagina) {
    const nomeVisao = pagina?.curDataView?.name;

    if (nomeVisao !== DATA_VIEW_CONSULTA_TITULOS) {
      throw new Error(
        "A visão ativa não é Consulta de Títulos. Nenhum campo foi preenchido."
      );
    }
  }

  function extrairValoresPendentesNxj(fieldValues) {
    if (typeof fieldValues !== "string") return [];

    // O NXJ pode serializar mais de um valor no mesmo POST.
    // Conferimos todos os segmentos, sem pressupor que o valor pendente
    // seja sempre o último segmento do payload.
    return fieldValues
      .split("\f")
      .map(valor => valor.trim())
      .filter(Boolean);
  }

  /**
   * Monitora temporariamente o protocolo real do NXJ.
   * Guarda somente metadados mínimos do comando e o valor pendente em memória,
   * sem registrar managerId, URL completa, cookies ou payload em console/storage.
   */
  function criarMonitorComandosNxj(pagina, configuracao = {}) {
    configuracao = configuracao && typeof configuracao === "object" ? configuracao : {};
    const XMLHttpRequestPagina = pagina?.XMLHttpRequest;
    const prototipo = XMLHttpRequestPagina?.prototype;
    const descritorOpen = prototipo
      ? Object.getOwnPropertyDescriptor(prototipo, "open")
      : null;
    const descritorSend = prototipo
      ? Object.getOwnPropertyDescriptor(prototipo, "send")
      : null;

    if (
      !descritorOpen ||
      typeof descritorOpen.value !== "function" ||
      !descritorOpen.writable ||
      !descritorSend ||
      typeof descritorSend.value !== "function" ||
      !descritorSend.writable
    ) {
      throw new Error(
        "Não foi possível instalar o monitor temporário de comandos NXJ. Nenhum campo foi alterado."
      );
    }

    const silencioMs = Number.isInteger(configuracao.silencioMs) &&
      configuracao.silencioMs >= 0
      ? configuracao.silencioMs
      : 300;
    const limiteEsperaMs = Number.isInteger(configuracao.limiteEsperaMs) &&
      configuracao.limiteEsperaMs > 0
      ? Math.min(configuracao.limiteEsperaMs, 30000)
      : 20000;
    const intervaloMs = Number.isInteger(configuracao.intervaloMs) &&
      configuracao.intervaloMs > 0
      ? Math.min(configuracao.intervaloMs, 250)
      : 60;

    const abrirOriginal = descritorOpen.value;
    const enviarOriginal = descritorSend.value;
    const metadadosXhr = new WeakMap();
    const requisicoes = [];
    const estado = {
      emAndamento: 0,
      ultimaConclusao: Date.now(),
      sequencia: 0
    };

    function extrairDadosComando(body) {
      try {
        if (body && typeof body.get === "function") {
          return {
            comando: String(body.get("commandName") ?? "").trim().toUpperCase(),
            fieldValues: body.get("fieldValues")
          };
        }

        if (typeof body !== "string") {
          return { comando: "", fieldValues: null };
        }

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

      const dadosComando = metadados.metodo === "POST"
        ? extrairDadosComando(body)
        : { comando: "", fieldValues: null };

      const registro = {
        sequencia: ++estado.sequencia,
        metodo: metadados.metodo,
        comando: dadosComando.comando,
        valoresPendentes: extrairValoresPendentesNxj(dadosComando.fieldValues),
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

        if (acompanhada) {
          estado.emAndamento = Math.max(0, estado.emAndamento - 1);
        }

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

    const abrirInterceptadoRef = abrirInterceptado;
    const enviarInterceptadoRef = enviarInterceptado;

    try {
      Object.defineProperty(prototipo, "open", {
        ...descritorOpen,
        value: abrirInterceptadoRef
      });
      Object.defineProperty(prototipo, "send", {
        ...descritorSend,
        value: enviarInterceptadoRef
      });
    } catch (_) {
      if (prototipo.open === abrirInterceptadoRef) {
        Object.defineProperty(prototipo, "open", descritorOpen);
      }

      throw new Error(
        "Não foi possível ativar o monitor de comandos NXJ. Nenhum campo foi alterado."
      );
    }

    function pausa(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function aguardarOcioso() {
      const inicio = Date.now();

      while (true) {
        validarVisaoConsultaTitulos(pagina);

        if (
          estado.emAndamento === 0 &&
          Date.now() - estado.ultimaConclusao >= silencioMs
        ) {
          return;
        }

        if (Date.now() - inicio >= limiteEsperaMs) {
          throw new Error(
            "O Systextil não ficou ocioso dentro de " +
            Math.round(limiteEsperaMs / 1000) +
            " segundos."
          );
        }

        await pausa(intervaloMs);
      }
    }

    function confirmou(valorEsperado, sequenciaMinima) {
      return requisicoes.some(requisicao =>
        requisicao.sequencia > sequenciaMinima &&
        requisicao.metodo === "POST" &&
        COMANDOS_NXJ_CONFIRMACAO.has(requisicao.comando) &&
        !requisicao.monitoramentoFalhou &&
        requisicao.finalizado &&
        requisicao.status >= 200 &&
        requisicao.status < 300 &&
        valorConfere(requisicao.valoresPendentes, valorEsperado)
      );
    }

    function resumo(sequenciaMinima) {
      const itens = requisicoes
        .filter(requisicao =>
          requisicao.sequencia > sequenciaMinima &&
          requisicao.metodo === "POST"
        )
        .slice(-8)
        .map(requisicao =>
          requisicao.comando + "[" +
          requisicao.valoresPendentes.map(valor => valor.length).join(",") +
          "]"
        );

      return itens.join(" ") || "nenhum POST NXJ observado";
    }

    return {
      obterSequencia() {
        return estado.sequencia;
      },
      confirmou,
      resumo,
      aguardarOcioso,
      remover() {
        if (prototipo.open === abrirInterceptadoRef) {
          Object.defineProperty(prototipo, "open", descritorOpen);
        }

        if (prototipo.send === enviarInterceptadoRef) {
          Object.defineProperty(prototipo, "send", descritorSend);
        }
      }
    };
  }

  async function preencherCamposConsulta(dados, configuracaoTeste = {}) {
    configuracaoTeste = configuracaoTeste && typeof configuracaoTeste === "object"
      ? configuracaoTeste
      : {};

    if (preenchimentoEmAndamento) {
      throw new Error("Já existe um preenchimento em andamento nesta tela.");
    }

    preenchimentoEmAndamento = true;
    let monitor = null;
    let valoresAlterados = false;

    const atrasoFocoLegado = Number.isInteger(configuracaoTeste.atrasoFocoMs) &&
      configuracaoTeste.atrasoFocoMs >= 0
      ? configuracaoTeste.atrasoFocoMs
      : null;

    function obterAtrasoConfigurado(nome, padrao) {
      const valor = Number.isInteger(configuracaoTeste[nome]) &&
        configuracaoTeste[nome] >= 0
        ? configuracaoTeste[nome]
        : (atrasoFocoLegado ?? padrao);

      return Math.min(valor, 3000);
    }

    // Mesma sequência confirmada pelo operador no teste executado diretamente
    // na página: foco do título (500 ms), escrita (500 ms), foco da parcela
    // (800 ms), escrita (500 ms), retorno ao título (800 ms).
    const atrasoFocoInicialMs = obterAtrasoConfigurado("atrasoFocoInicialMs", 500);
    const atrasoAntesDeSairCampoMs = obterAtrasoConfigurado("atrasoAntesDeSairCampoMs", 500);
    const atrasoAposSairCampoMs = obterAtrasoConfigurado("atrasoAposSairCampoMs", 800);

    function pausa(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    let pagina;
    let documento;

    function obterCampoAtual(nome) {
      const campo = documento?.getElementsByName?.(nome)?.[0];

      if (!campo || typeof campo.value !== "string") {
        throw new Error("Campo obrigatório não encontrado: " + nome);
      }

      return campo;
    }

    function validarCampoEditavel(campo) {
      if (campo.disabled || campo.readOnly) {
        throw new Error("Um dos campos do ERP está bloqueado para edição.");
      }

      if (typeof campo.focus !== "function") {
        throw new Error("O campo do ERP não oferece a operação de foco necessária.");
      }
    }

    try {
      pagina = obterJanelaPaginaSystextil();
      documento = pagina.document || document;
      validarVisaoConsultaTitulos(pagina);

      // Usa os mesmos seletores do script funcional apresentado pelo operador.
      let campoTitulo = obterCampoAtual(CAMPOS.titulo);
      let campoParcela = obterCampoAtual(CAMPOS.parcela);

      validarCampoEditavel(campoTitulo);
      validarCampoEditavel(campoParcela);

      const titulo = preservarCodigoConsulta(
        dados?.titulo,
        "Número do título",
        obterLarguraCampo(campoTitulo, LARGURAS_PADRAO_CONSULTA.titulo)
      );
      const parcela = preservarCodigoConsulta(
        dados?.parcela,
        "Parcela",
        obterLarguraCampo(campoParcela, LARGURAS_PADRAO_CONSULTA.parcela)
      );

      // O monitor fica ativo para observar as mesmas requisições NXJ do teste
      // funcional. Ele não bloqueia a escrita da parcela antes da sequência.
      monitor = criarMonitorComandosNxj(pagina, configuracaoTeste);

      campoTitulo.focus();
      await pausa(atrasoFocoInicialMs);

      validarVisaoConsultaTitulos(pagina);
      valoresAlterados = true;
      atribuirValorCampo(campoTitulo, titulo);

      if (String(campoTitulo.value ?? "").trim() !== titulo) {
        throw new Error("O navegador não manteve o número do título no campo.");
      }

      await pausa(atrasoAntesDeSairCampoMs);

      // A troca de foco confirma o título, mas não aguardamos uma classificação
      // específica do comando NXJ para liberar a inserção da parcela.
      const sequenciaAntesDoTitulo = monitor.obterSequencia();
      campoParcela.focus();
      await pausa(atrasoAposSairCampoMs);

      validarVisaoConsultaTitulos(pagina);

      // Se a resposta assíncrona substituiu o input durante os 800 ms, usa o
      // controle atual. Só repete o foco quando a referência realmente mudou.
      for (let tentativa = 0; tentativa < 3; tentativa += 1) {
        const parcelaAtual = obterCampoAtual(CAMPOS.parcela);
        if (parcelaAtual === campoParcela) break;

        campoParcela = parcelaAtual;
        validarCampoEditavel(campoParcela);
        campoParcela.focus();
        await pausa(atrasoAposSairCampoMs);
        validarVisaoConsultaTitulos(pagina);
      }

      if (obterCampoAtual(CAMPOS.parcela) !== campoParcela) {
        throw new Error(
          "O Systextil recriou repetidamente o campo da parcela durante a ativação. A parcela não foi inserida."
        );
      }

      // O Systextil pode limpar ou redesenhar o input do título ao processar
      // a saída do campo. Não interrompa aqui: a sequência funcional precisa
      // preencher a parcela e retornar o foco ao título antes da confirmação.
      validarCampoEditavel(campoParcela);
      atribuirValorCampo(campoParcela, parcela);

      if (String(campoParcela.value ?? "").trim() !== parcela) {
        throw new Error("O navegador não manteve a parcela no campo.");
      }

      await pausa(atrasoAntesDeSairCampoMs);

      validarVisaoConsultaTitulos(pagina);
      if (
        obterCampoAtual(CAMPOS.parcela) !== campoParcela ||
        String(campoParcela.value ?? "").trim() !== parcela
      ) {
        throw new Error(
          "O Systextil alterou ou recriou o campo da parcela antes da confirmação. Confira o campo manualmente."
        );
      }

      // O campo do título também pode ter sido recriado no blur. Recupera
      // a referência atual antes de devolver o foco, sem exigir valor no DOM.
      campoTitulo = obterCampoAtual(CAMPOS.titulo);
      if (typeof campoTitulo.focus !== "function") {
        throw new Error("O campo atual do título não permite recuperar o foco.");
      }

      const sequenciaAntesDaParcela = monitor.obterSequencia();
      campoTitulo.focus();
      await pausa(atrasoAposSairCampoMs);

      // Aguarda a conclusão das chamadas NXJ. A presença literal do valor no
      // payload é apenas diagnóstica: máscaras e prefixos podem alterar o texto.
      // A confirmação definitiva será feita pelo resultado da consulta Find.
      await monitor.aguardarOcioso();
      const confirmacoesNxj = {
        titulo: monitor.confirmou(titulo, sequenciaAntesDoTitulo),
        parcela: monitor.confirmou(parcela, sequenciaAntesDaParcela)
      };

      const confirmacoes = {
        titulo: confirmacoesNxj.titulo ? "NXJ" : "PENDENTE",
        parcela: confirmacoesNxj.parcela ? "NXJ" : "PENDENTE"
      };

      try {
        validarConfirmacoesNxj(confirmacoes);
      } catch (erroConfirmacao) {
        throw new Error(
          erroConfirmacao.message +
          " Diagnóstico NXJ: " + monitor.resumo(sequenciaAntesDoTitulo) + "."
        );
      }

      validarVisaoConsultaTitulos(pagina);
      campoTitulo = obterCampoAtual(CAMPOS.titulo);
      campoParcela = obterCampoAtual(CAMPOS.parcela);

      // O ERP pode limpar o título após o blur ou aplicar máscara/zeros à
      // esquerda. Divergências reais continuam bloqueando a operação.
      const tituloVisivel = String(campoTitulo.value ?? "").trim();
      if (
        tituloVisivel &&
        normalizarCodigoComparacao(tituloVisivel) !== normalizarCodigoComparacao(titulo)
      ) {
        throw new Error(
          "O valor exibido no campo do título diverge do valor confirmado pelo NXJ."
        );
      }

      if (
        normalizarCodigoComparacao(String(campoParcela.value ?? "")) !==
        normalizarCodigoComparacao(parcela)
      ) {
        throw new Error(
          "O valor visível da parcela mudou após a confirmação NXJ."
        );
      }

      return {
        titulo,
        parcela,
        confirmacoes
      };
    } catch (erro) {
      if (valoresAlterados) {
        throw new Error(
          "Preenchimento interrompido. NÃO execute a consulta manualmente. Confira ou limpe os campos no ERP antes de tentar novamente. " +
          erro.message
        );
      }

      throw erro;
    } finally {
      try {
        monitor?.remover();
      } finally {
        preenchimentoEmAndamento = false;
      }
    }
  }

  function normalizarTextoProcesso(valor) {
    return String(valor ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /**
   * Interpreta somente formatos explícitos com data e hora.
   * Retorna timestamp local ou null se o formato/data não for verificável.
   */
  function interpretarDataHoraProcesso(valor) {
    const texto = String(valor ?? "").trim();
    let partes;

    let match = texto.match(
      /^(\d{2})\/(\d{2})\/(\d{4})[ T]+(\d{2}):(\d{2})(?::(\d{2}))?$/
    );

    if (match) {
      partes = {
        ano: Number(match[3]),
        mes: Number(match[2]),
        dia: Number(match[1]),
        hora: Number(match[4]),
        minuto: Number(match[5]),
        segundo: Number(match[6] || 0)
      };
    } else {
      match = texto.match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
      );

      if (!match) return null;

      partes = {
        ano: Number(match[1]),
        mes: Number(match[2]),
        dia: Number(match[3]),
        hora: Number(match[4]),
        minuto: Number(match[5]),
        segundo: Number(match[6] || 0)
      };
    }

    const data = new Date(
      partes.ano,
      partes.mes - 1,
      partes.dia,
      partes.hora,
      partes.minuto,
      partes.segundo,
      0
    );

    if (
      data.getFullYear() !== partes.ano ||
      data.getMonth() !== partes.mes - 1 ||
      data.getDate() !== partes.dia ||
      data.getHours() !== partes.hora ||
      data.getMinutes() !== partes.minuto ||
      data.getSeconds() !== partes.segundo
    ) {
      return null;
    }

    return data.getTime();
  }

  /**
   * Associa uma solicitação registrada ao processo exato.
   * Não seleciona linhas nem executa ações no ERP.
   */
  function analisarProcessos(registros, solicitacao, agora) {
    const atual = Number(agora ?? Date.now());
    const instanteSolicitacao = Number(solicitacao?.solicitadoEm);
    const tituloSolicitado = normalizarTextoProcesso(solicitacao?.titulo);
    const tituloEsperado = normalizarTextoProcesso(TITULO_PROCESSO_BOLETO);

    if (
      !Number.isFinite(instanteSolicitacao) ||
      instanteSolicitacao <= 0 ||
      instanteSolicitacao > atual + TOLERANCIA_HORARIO_PROCESSO_MS ||
      !tituloSolicitado ||
      !solicitacao?.parcela
    ) {
      return {
        status: "sem-solicitacao",
        mensagem: "Não há uma solicitação válida registrada nesta sessão."
      };
    }

    if (atual - instanteSolicitacao > MAX_IDADE_SOLICITACAO_MS) {
      return {
        status: "solicitacao-expirada",
        mensagem: "A solicitação registrada tem mais de 30 minutos. Faça uma nova emissão para evitar associar um processo antigo."
      };
    }

    const candidatos = [];
    let horariosNaoInterpretados = 0;

    (Array.isArray(registros) ? registros : []).forEach((registro, indice) => {
      if (normalizarTextoProcesso(registro?.titulo) !== tituloEsperado) {
        return;
      }

      const executadoEm = interpretarDataHoraProcesso(registro?.dataExecucao);

      if (executadoEm === null) {
        horariosNaoInterpretados += 1;
        return;
      }

      const diferencaMs = executadoEm - instanteSolicitacao;
      const dentroDaJanela =
        Math.abs(diferencaMs) <= TOLERANCIA_HORARIO_PROCESSO_MS;

      if (!dentroDaJanela) return;

      candidatos.push({
        titulo: registro.titulo,
        dataExecucao: registro.dataExecucao,
        executadoEm,
        diferencaMs,
        mensagem: String(registro.mensagem ?? "").trim(),
        rowIndex: Number.isInteger(registro.rowIndex) ? registro.rowIndex : indice,
        visualIndex: (Number.isInteger(registro.rowIndex) ? registro.rowIndex : indice) + 1,
        recordNumber: (Number.isInteger(registro.rowIndex) ? registro.rowIndex : indice) + 1
      });
    });

    if (horariosNaoInterpretados > 0) {
      return {
        status: "nao-verificavel",
        mensagem: "Há registro(s) de emissão sem data/hora reconhecida. Não é possível confirmar uma correspondência única.",
        candidatos: candidatos.length,
        horariosNaoInterpretados
      };
    }

    if (candidatos.length === 0) {
      return {
        status: "nao-encontrado",
        mensagem: "Ainda não foi localizado um processo de emissão posterior ao horário da solicitação.",
        candidatos: 0
      };
    }

    // A grade exibe o horário até segundos. Quando um registro coincide com
    // o segundo exato do clique, essa evidência prevalece sobre outro processo
    // próximo dentro da tolerância. Se houver mais de uma correspondência exata,
    // a análise continua ambígua.
    const segundoSolicitacao = Math.floor(instanteSolicitacao / 1000);
    const candidatosExatos = candidatos.filter(
      candidato => Math.floor(candidato.executadoEm / 1000) === segundoSolicitacao
    );

    let registro;

    if (candidatosExatos.length === 1) {
      registro = candidatosExatos[0];
    } else if (candidatosExatos.length > 1) {
      return {
        status: "ambiguo",
        mensagem: "Mais de um processo possui o mesmo segundo da solicitação. A identificação automática foi interrompida.",
        candidatos: candidatosExatos.length
      };
    } else if (candidatos.length > 1) {
      return {
        status: "ambiguo",
        mensagem: "Mais de um processo está dentro da tolerância de horário e nenhum coincide exatamente com o segundo da solicitação. A identificação automática foi interrompida.",
        candidatos: candidatos.length
      };
    } else {
      registro = candidatos[0];
    }
    const mensagemNormalizada = normalizarTextoProcesso(registro.mensagem);
    const sucessoEsperado = normalizarTextoProcesso(MENSAGEM_SUCESSO_PROCESSO);

    if (mensagemNormalizada.includes(sucessoEsperado)) {
      return {
        status: "sucesso",
        mensagem: "Processo único identificado e concluído com sucesso.",
        candidatos: 1,
        registro
      };
    }

    if (!mensagemNormalizada) {
      return {
        status: "em-andamento",
        mensagem: "O processo correspondente foi localizado, mas ainda não apresenta confirmação de conclusão.",
        candidatos: 1,
        registro
      };
    }

    return {
      status: "falha",
      mensagem: "O processo correspondente foi localizado, mas o ERP não informou a mensagem de sucesso. O download não deve prosseguir.",
      candidatos: 1,
      registro
    };
  }


  function obterControladorGrade(janelaPagina) {
    // No Systextil, DataView é o construtor nativo do JavaScript.
    // O estado real da grade está no DataViewDescriptor exposto em curDataView.
    const controlador = janelaPagina?.curDataView;
    const controladorValido = Boolean(
      controlador &&
      typeof controlador === "object" &&
      "currentRow" in Object(controlador)
    );

    if (!controladorValido) {
      throw new Error(
        "A API de seleção da grade (curDataView.currentRow) não está disponível. Nenhum download foi iniciado."
      );
    }

    const nomeVisao = String(controlador.name ?? "").trim();

    if (nomeVisao !== DATA_VIEW_PROCESSOS) {
      throw new Error(
        "A visão ativa da grade não corresponde a Processos agendados. Nenhum download foi iniciado."
      );
    }

    const linhaAtual = controlador.currentRow;

    if (
      linhaAtual !== null &&
      linhaAtual !== undefined &&
      !Number.isInteger(Number(linhaAtual))
    ) {
      throw new Error("O índice atual da grade não é verificável. Seleção interrompida.");
    }

    return controlador;
  }

  function mesmoRegistroProcesso(atual, esperado) {
    return Boolean(
      atual &&
      esperado &&
      atual.rowIndex === esperado.rowIndex &&
      normalizarTextoProcesso(atual.titulo) === normalizarTextoProcesso(esperado.titulo) &&
      String(atual.dataExecucao ?? "").trim() === String(esperado.dataExecucao ?? "").trim() &&
      normalizarTextoProcesso(atual.mensagem) === normalizarTextoProcesso(esperado.mensagem)
    );
  }

  /**
   * Seleciona somente a linha já identificada pela Fase 3.
   * O índice da grade é zero-based; recordNumber/linha visual são one-based.
   * A seleção é confirmada pela leitura dos campos antes e depois da alteração.
   */
  function selecionarRegistroProcesso(registro, janelaPagina, lerRegistrosAtuais) {
    if (
      !registro ||
      !Number.isInteger(registro.rowIndex) ||
      registro.rowIndex < 0 ||
      typeof lerRegistrosAtuais !== "function"
    ) {
      throw new Error("Registro ou leitor da grade inválido. Seleção interrompida.");
    }

    const controlador = obterControladorGrade(janelaPagina);
    const linhaAnterior = controlador.currentRow;
    const registrosAntes = lerRegistrosAtuais();
    const registroAntes = registrosAntes.find(item => item.rowIndex === registro.rowIndex);

    if (!mesmoRegistroProcesso(registroAntes, registro)) {
      throw new Error("A linha identificada mudou desde a análise. Analise os processos novamente.");
    }

    try {
      controlador.currentRow = registro.rowIndex;

      if (Number(controlador.currentRow) !== registro.rowIndex) {
        throw new Error("O Systextil não confirmou a seleção da linha identificada.");
      }

      const registrosDepois = lerRegistrosAtuais();
      const registroDepois = registrosDepois.find(item => item.rowIndex === registro.rowIndex);

      if (!mesmoRegistroProcesso(registroDepois, registro)) {
        throw new Error("Os dados da linha mudaram durante a seleção. Download interrompido.");
      }

      return {
        controlador,
        linhaAnterior,
        linhaSelecionada: registro.rowIndex
      };
    } catch (erro) {
      if (linhaAnterior !== undefined) {
        try {
          controlador.currentRow = linhaAnterior;
        } catch (_) {
          // A restauração é best effort; o download permanece bloqueado.
        }
      }
      throw erro;
    }
  }

  function restaurarSelecaoProcesso(selecao) {
    if (!selecao?.controlador || selecao.linhaAnterior === undefined) return;

    try {
      selecao.controlador.currentRow = selecao.linhaAnterior;
    } catch (_) {
      // A operação de download já foi bloqueada; não há ação adicional segura.
    }
  }

  /**
   * Valida a URL produzida pelo getFileUrl do próprio Systextil.
   * Só permite PDF no endpoint local de download e no programa de emissão de boletos.
   */
  function validarUrlPdf(urlInformada, urlBase) {
    let base;
    let destino;

    try {
      base = new URL(String(urlBase));
      destino = new URL(String(urlInformada ?? "").trim(), base);
    } catch (_) {
      throw new Error("O Systextil não forneceu uma URL de PDF válida.");
    }

    if (destino.origin !== base.origin) {
      throw new Error("A URL do arquivo aponta para outra origem. Download bloqueado.");
    }

    if (!/^\/systextil\/download\/[^/]+\.pdf$/i.test(destino.pathname)) {
      throw new Error("A URL não corresponde ao caminho de PDF esperado do Systextil.");
    }

    if (String(destino.searchParams.get("ext") ?? "").toLowerCase() !== "pdf") {
      throw new Error("A URL do relatório não confirmou o formato PDF.");
    }

    const relatorio = String(destino.searchParams.get("report") ?? "");
    if (!/^[A-Za-z0-9_-]+\.jrprint$/i.test(relatorio)) {
      throw new Error("O identificador do relatório PDF está ausente ou inválido.");
    }

    if (destino.searchParams.get("program") !== PROGRAMA_RELATORIO_BOLETO) {
      throw new Error("A URL não pertence ao programa de emissão de boletos.");
    }

    return destino.href;
  }

  function obterRelatorioSelecionado(documento) {
    if (!documento || typeof documento.querySelectorAll !== "function") {
      throw new Error("Não foi possível conferir o relatório selecionado pelo Systextil.");
    }

    const relatorios = [];
    Array.from(documento.querySelectorAll("select")).forEach(seletor => {
      const opcoes = Array.from(seletor.options || []);
      const opcaoSelecionada =
        (seletor.selectedOptions && seletor.selectedOptions[0]) ||
        opcoes.find(opcao => opcao.selected);

      const valor = String(opcaoSelecionada?.value ?? "").trim();
      if (/^[A-Za-z0-9_-]+\.jrprint$/i.test(valor)) {
        relatorios.push(valor);
      }
    });

    if (relatorios.length !== 1) {
      throw new Error(
        relatorios.length === 0
          ? "O Systextil não apresenta um único relatório .jrprint selecionado."
          : "Mais de um relatório .jrprint está selecionado. Download interrompido."
      );
    }

    return relatorios[0];
  }

  function obterUrlPdfSelecionado(janelaPagina, urlBase) {
    if (typeof janelaPagina?.getFileUrl !== "function") {
      throw new Error("A função getFileUrl do Systextil não está disponível. Nenhum download foi iniciado.");
    }

    let url;
    try {
      url = janelaPagina.getFileUrl.call(janelaPagina);
    } catch (erro) {
      throw new Error("O Systextil não conseguiu preparar a URL do relatório: " + erro.message);
    }

    if (url && typeof url.then === "function") {
      throw new Error("A função getFileUrl retornou uma operação assíncrona não suportada. Download interrompido.");
    }

    const urlValidada = validarUrlPdf(url, urlBase);
    const relatorioDaUrl = new URL(urlValidada).searchParams.get("report");
    const relatorioSelecionado = obterRelatorioSelecionado(janelaPagina.document);

    if (relatorioDaUrl !== relatorioSelecionado) {
      throw new Error("A URL do PDF não corresponde ao relatório atualmente selecionado no Systextil.");
    }

    return urlValidada;
  }

  function prepararUrlDownloadProcesso(registro, janelaPagina, urlBase, lerRegistrosAtuais) {
    const selecao = selecionarRegistroProcesso(
      registro,
      janelaPagina,
      lerRegistrosAtuais
    );

    try {
      const url = obterUrlPdfSelecionado(janelaPagina, urlBase);
      return { url, selecao };
    } catch (erro) {
      restaurarSelecaoProcesso(selecao);
      throw erro;
    }
  }

  function montarChaveDownload(solicitacao, registro) {
    const identificador = [
      solicitacao?.solicitadoEm,
      solicitacao?.titulo,
      solicitacao?.parcela,
      registro?.executadoEm ?? registro?.dataExecucao
    ].join("|");

    let hash = 2166136261;
    for (let indice = 0; indice < identificador.length; indice += 1) {
      hash ^= identificador.charCodeAt(indice);
      hash = Math.imul(hash, 16777619);
    }

    return CHAVE_DOWNLOAD_PREFIXO + (hash >>> 0).toString(36);
  }

  function criarErroDownloadIndeterminado() {
    const erro = new Error(
      "O resultado da tentativa anterior é indeterminado. Confira manualmente a pasta de destino antes de liberar outro download."
    );
    erro.code = "DOWNLOAD_INDETERMINADO";
    return erro;
  }

  function reservarDownload(armazenamento, chave, agora) {
    if (
      !armazenamento ||
      typeof armazenamento.getItem !== "function" ||
      typeof armazenamento.setItem !== "function"
    ) {
      throw new Error("O armazenamento da sessão não está disponível para controlar downloads duplicados.");
    }

    const instante = Number(agora ?? Date.now());
    const anterior = armazenamento.getItem(chave);

    if (anterior) {
      let estadoAnterior = null;
      try {
        estadoAnterior = JSON.parse(anterior);
      } catch (_) {
        throw new Error("Existe um registro de download inválido. Limpe a solicitação somente após conferir o navegador.");
      }

      if (estadoAnterior?.status === "concluido") {
        throw new Error("Este processo já teve o download concluído nesta sessão. Download duplicado bloqueado.");
      }

      if (estadoAnterior?.status === "indeterminado") {
        throw criarErroDownloadIndeterminado();
      }

      if (estadoAnterior?.status === "pendente") {
        const iniciadoEm = Number(estadoAnterior.iniciadoEm);
        const idadeReserva = instante - iniciadoEm;

        if (!Number.isFinite(iniciadoEm) || idadeReserva < 0) {
          throw new Error("O horário da reserva de download não é verificável. A tentativa permanece bloqueada.");
        }

        if (idadeReserva < TEMPO_RESERVA_DOWNLOAD_MS) {
          throw new Error("Já existe um download deste processo em andamento nesta sessão.");
        }

        armazenamento.setItem(chave, JSON.stringify({
          status: "indeterminado",
          indeterminadoEm: instante,
          motivo: "reserva-expirada-sem-confirmacao"
        }));
        throw criarErroDownloadIndeterminado();
      }

      throw new Error("O estado salvo para este download é desconhecido. A tentativa permanece bloqueada.");
    }

    armazenamento.setItem(chave, JSON.stringify({
      status: "pendente",
      iniciadoEm: instante
    }));
  }

  function concluirDownload(armazenamento, chave, agora) {
    const estado = JSON.parse(armazenamento.getItem(chave) || "null");
    if (estado?.status !== "pendente") {
      throw new Error("A reserva não está pendente; a conclusão do download não foi registrada.");
    }

    armazenamento.setItem(chave, JSON.stringify({
      status: "concluido",
      concluidoEm: Number(agora ?? Date.now())
    }));
  }

  function marcarDownloadIndeterminado(armazenamento, chave, agora) {
    if (
      !armazenamento ||
      typeof armazenamento.getItem !== "function" ||
      typeof armazenamento.setItem !== "function"
    ) {
      throw new Error("Não foi possível acessar o armazenamento para marcar o download como indeterminado.");
    }

    const estado = JSON.parse(armazenamento.getItem(chave) || "null");

    if (estado?.status === "indeterminado") return false;
    if (estado?.status !== "pendente") {
      throw new Error("A reserva não está pendente; não foi possível registrar o resultado indeterminado.");
    }

    armazenamento.setItem(chave, JSON.stringify({
      status: "indeterminado",
      indeterminadoEm: Number(agora ?? Date.now()),
      motivo: "timeout"
    }));
    return true;
  }

  function liberarDownload(armazenamento, chave) {
    try {
      const estado = JSON.parse(armazenamento.getItem(chave) || "null");
      if (estado?.status !== "pendente") return false;
      armazenamento.removeItem(chave);
      return true;
    } catch (_) {
      // Em caso de estado ilegível ou falha de armazenamento, mantém o bloqueio.
      return false;
    }
  }

  function liberarDownloadIndeterminado(armazenamento, chave) {
    if (
      !armazenamento ||
      typeof armazenamento.getItem !== "function" ||
      typeof armazenamento.removeItem !== "function"
    ) {
      throw new Error("O armazenamento da sessão não permite conferir e liberar a reserva.");
    }

    const estado = JSON.parse(armazenamento.getItem(chave) || "null");
    if (estado?.status !== "indeterminado") {
      throw new Error("A reserva não está no estado indeterminado. Nenhuma liberação foi realizada.");
    }

    armazenamento.removeItem(chave);
    return true;
  }

  function validarBytesPdf(bytesRecebidos) {
    let buffer;
    if (Object.prototype.toString.call(bytesRecebidos) === "[object ArrayBuffer]") {
      buffer = bytesRecebidos;
    } else if (ArrayBuffer.isView(bytesRecebidos)) {
      buffer = bytesRecebidos.buffer.slice(
        bytesRecebidos.byteOffset,
        bytesRecebidos.byteOffset + bytesRecebidos.byteLength
      );
    } else {
      throw new Error("O Systextil não retornou o PDF em formato binário verificável.");
    }

    if (buffer.byteLength < 8 || buffer.byteLength > TAMANHO_MAXIMO_PDF) {
      throw new Error("O PDF está vazio ou excede o limite de 25 MB.");
    }

    const bytes = new Uint8Array(buffer);
    const assinatura = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
    if (assinatura !== "%PDF-") {
      throw new Error("A resposta do Systextil não contém a assinatura de um PDF.");
    }

    const inicioCauda = Math.max(0, bytes.length - 2048);
    const cauda = String.fromCharCode(...bytes.subarray(inicioCauda));
    if (!cauda.includes("%%EOF")) {
      throw new Error("O PDF recebido não contém o marcador final esperado.");
    }
    return buffer;
  }

  function iniciarDownloadPdf(url, nomeArquivo, callbacks) {
    if (typeof GM_xmlhttpRequest !== "function") {
      throw new Error("GM_xmlhttpRequest não está disponível. Verifique as permissões do Tampermonkey.");
    }
    if (typeof GM_download !== "function") {
      throw new Error("GM_download não está disponível. Verifique se o Tampermonkey permite downloads.");
    }
    if (
      typeof nomeArquivo !== "string" ||
      nomeArquivo.length > MAX_NOME_ARQUIVO ||
      !/^[^<>:"/\\|?*\u0000-\u001f]+\.pdf$/i.test(nomeArquivo)
    ) {
      throw new Error("O nome do PDF é inválido.");
    }

    let finalizado = false;
    let requisicaoPdf = null;
    let requisicaoDownload = null;

    const finalizar = (tipo, detalhe) => {
      if (finalizado) return;
      finalizado = true;
      if (tipo === "sucesso") callbacks?.onload?.(detalhe);
      else if (tipo === "timeout") callbacks?.ontimeout?.(detalhe);
      else if (tipo === "abort") callbacks?.onabort?.(detalhe);
      else callbacks?.onerror?.(detalhe);
    };

    try {
      requisicaoPdf = GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        timeout: 60000,
        anonymous: false,
        onload(response) {
          try {
            if (Number(response.status) !== 200) {
              throw new Error("O Systextil não entregou o PDF (HTTP " + Number(response.status) + ").");
            }

            const urlSolicitada = new URL(url);
            const urlFinal = new URL(response.finalUrl || url);
            if (
              urlFinal.origin !== urlSolicitada.origin ||
              urlFinal.pathname !== urlSolicitada.pathname ||
              urlFinal.searchParams.get("report") !== urlSolicitada.searchParams.get("report")
            ) {
              throw new Error("A resposta do Systextil foi redirecionada para outro recurso. Download interrompido.");
            }

            const pdf = validarBytesPdf(response.response);
            const blob = new Blob([pdf], { type: "application/pdf" });

            requisicaoDownload = GM_download({
              url: blob,
              name: nomeArquivo,
              saveAs: false,
              conflictAction: "uniquify",
              onload: detalhe => finalizar("sucesso", detalhe),
              onerror: erro => finalizar("erro", {
                error: erro?.error || "not_succeeded",
                stage: "download",
                message: erro?.details || erro?.error || "O navegador não concluiu o download."
              }),
              ontimeout: erro => finalizar("timeout", {
                error: "timeout",
                stage: "download",
                message: erro?.details || "O navegador excedeu o tempo para baixar o PDF."
              }),
              onabort: erro => finalizar("abort", {
                error: "abort",
                stage: "download",
                message: erro?.details || "O download foi cancelado."
              })
            });
          } catch (erro) {
            finalizar("erro", {
              error: "fetch_failed",
              stage: "fetch",
              message: erro?.message || "Não foi possível validar o PDF recebido."
            });
          }
        },
        onerror(response) {
          finalizar("erro", {
            error: "fetch_failed",
            stage: "fetch",
            message: "Não foi possível obter o PDF autenticado do Systextil (HTTP " + (Number(response?.status) || 0) + ")."
          });
        },
        ontimeout() {
          finalizar("erro", {
            error: "fetch_timeout",
            stage: "fetch",
            message: "O Systextil excedeu o tempo para entregar o PDF. O download local não foi iniciado."
          });
        },
        onabort() {
          finalizar("abort", {
            error: "fetch_aborted",
            stage: "fetch",
            message: "A obtenção do PDF foi interrompida antes de iniciar o download."
          });
        }
      });
    } catch (erro) {
      finalizar("erro", {
        error: "fetch_failed",
        stage: "fetch",
        message: erro?.message || "Não foi possível iniciar a obtenção do PDF."
      });
    }

    return {
      abort() {
        try { requisicaoPdf?.abort?.(); } catch (_) {}
        try { requisicaoDownload?.abort?.(); } catch (_) {}
      }
    };
  }

  function localizarJanelaPagina(documentoAlvo) {
    const raiz = typeof unsafeWindow !== "undefined" && unsafeWindow
      ? unsafeWindow
      : window;
    const visitadas = new Set();
    const pendentes = [raiz];

    while (pendentes.length > 0) {
      const atual = pendentes.shift();
      if (!atual || visitadas.has(atual)) continue;
      visitadas.add(atual);

      try {
        if (atual.document === documentoAlvo) return atual;

        for (let indice = 0; indice < atual.frames.length; indice += 1) {
          pendentes.push(atual.frames[indice]);
        }
      } catch (_) {
        // Frames de outra origem são ignorados.
      }
    }

    throw new Error("Não foi possível acessar o contexto da página que contém a grade de processos.");
  }

  function coletarDocumentosMesmoDominio(janelaRaiz) {
    const raiz = janelaRaiz || window;
    const documentos = [];
    const janelasVisitadas = new Set();

    function visitar(janelaAtual) {
      if (!janelaAtual || janelasVisitadas.has(janelaAtual)) return;
      janelasVisitadas.add(janelaAtual);

      try {
        if (janelaAtual.document) documentos.push(janelaAtual.document);
      } catch (_) {
        return;
      }

      let totalFrames = 0;
      try {
        totalFrames = janelaAtual.frames.length;
      } catch (_) {
        return;
      }

      for (let indice = 0; indice < totalFrames; indice += 1) {
        try {
          visitar(janelaAtual.frames[indice]);
        } catch (_) {
          // Frames de outra origem são ignorados.
        }
      }
    }

    visitar(raiz);
    return documentos;
  }

  function nomeCampoProcesso(nomeBase, indice) {
    return indice === 0 ? nomeBase : nomeBase + String(indice - 1);
  }

  function localizarFormularioProcessos() {
    const documentos = coletarDocumentosMesmoDominio(window);
    const camposObrigatorios = ["titulo.", "DATA_EXECUCAO.", "MSG_EXCEPTION."];
    const formularios = [];

    documentos.forEach(documento => {
      Array.from(documento.forms || []).forEach(formulario => {
        const possuiCampos = camposObrigatorios.every(nome => {
          const campo = formulario.elements.namedItem(nome);
          return campo && typeof campo.value === "string";
        });

        if (possuiCampos) formularios.push({ formulario, documento });
      });
    });

    if (formularios.length !== 1) {
      throw new Error(
        formularios.length === 0
          ? "Formulário de Processos agendados não identificado."
          : "Mais de uma grade de Processos agendados foi encontrada; análise interrompida."
      );
    }

    return formularios[0];
  }

  function lerRegistrosProcessos() {
    const localizado = localizarFormularioProcessos();
    const formulario = localizado.formulario;
    const registros = [];

    for (let indice = 0; indice < MAX_REGISTROS_PROCESSO; indice += 1) {
      const nomes = {
        titulo: nomeCampoProcesso("titulo.", indice),
        dataExecucao: nomeCampoProcesso("DATA_EXECUCAO.", indice),
        mensagem: nomeCampoProcesso("MSG_EXCEPTION.", indice)
      };

      const campos = {
        titulo: formulario.elements.namedItem(nomes.titulo),
        dataExecucao: formulario.elements.namedItem(nomes.dataExecucao),
        mensagem: formulario.elements.namedItem(nomes.mensagem)
      };

      const encontrados = Object.values(campos).filter(Boolean).length;

      if (encontrados === 0) break;

      if (encontrados !== 3) {
        throw new Error(
          "A estrutura da linha " + (indice + 1) +
          " está incompleta; análise interrompida para evitar associação incorreta."
        );
      }

      const registro = {
        rowIndex: indice,
        titulo: String(campos.titulo.value ?? "").trim(),
        dataExecucao: String(campos.dataExecucao.value ?? "").trim(),
        mensagem: String(campos.mensagem.value ?? "").trim()
      };

      if (!registro.titulo && !registro.dataExecucao && !registro.mensagem) {
        break;
      }

      registros.push(registro);
    }

    if (registros.length === 0) {
      throw new Error("A grade não contém registros legíveis.");
    }

    if (registros.length === MAX_REGISTROS_PROCESSO) {
      throw new Error("A grade ultrapassou o limite seguro de leitura de 200 registros.");
    }

    return registros;
  }

  function salvarSolicitacaoEmissao(documento) {
    const formularios = coletarDocumentosMesmoDominio(window).flatMap(documentoAtual =>
      Array.from(documentoAtual.forms || []).filter(formulario => {
        return [CAMPOS.titulo, CAMPOS.parcela].every(nome => {
          const campo = formulario.elements.namedItem(nome);
          return campo && typeof campo.value === "string";
        });
      })
    );

    if (formularios.length !== 1) {
      throw new Error("Não foi possível associar o clique de emissão a um único título.");
    }

    const formulario = formularios[0];
    const titulo = String(formulario.elements.namedItem(CAMPOS.titulo).value ?? "").trim();
    const parcela = String(formulario.elements.namedItem(CAMPOS.parcela).value ?? "").trim();
    const campoCliente = formulario.elements.namedItem(CAMPOS.cliente);
    const cliente = campoCliente && typeof campoCliente.value === "string"
      ? campoCliente.value.trim()
      : "";

    if (!titulo || !parcela) {
      throw new Error("O título e a parcela precisam estar preenchidos antes da emissão.");
    }

    const solicitacao = {
      solicitadoEm: Date.now(),
      titulo,
      parcela,
      cliente,
      versao: VERSION
    };

    const armazenamento = documento.defaultView?.sessionStorage || window.sessionStorage;
    armazenamento.setItem(CHAVE_SOLICITACAO_EMISSAO, JSON.stringify(solicitacao));

    return solicitacao;
  }

  function recuperarSolicitacaoEmissao() {
    const armazenamentos = [];

    try {
      armazenamentos.push(window.sessionStorage);
    } catch (_) {
      // O acesso pode ser bloqueado por política do navegador.
    }

    try {
      if (window.opener && window.opener !== window) {
        armazenamentos.push(window.opener.sessionStorage);
      }
    } catch (_) {
      // Opener de outra origem é ignorado.
    }

    for (const armazenamento of armazenamentos) {
      try {
        const bruto = armazenamento.getItem(CHAVE_SOLICITACAO_EMISSAO);
        if (!bruto) continue;

        const solicitacao = JSON.parse(bruto);
        if (
          Number.isFinite(Number(solicitacao?.solicitadoEm)) &&
          solicitacao?.titulo &&
          solicitacao?.parcela
        ) {
          return solicitacao;
        }
      } catch (_) {
        // Tenta a próxima origem de armazenamento.
      }
    }

    return null;
  }

  function limparSolicitacaoEmissao() {
    try {
      window.sessionStorage.removeItem(CHAVE_SOLICITACAO_EMISSAO);
    } catch (_) {
      // Não há outra ação necessária se o navegador bloquear o armazenamento.
    }
  }

  function criarResultado(pedido, status, ok, mensagem) {
    return {
      id: String(pedido?.id ?? ""),
      status,
      ok: ok === true,
      mensagem: String(mensagem ?? "").slice(0, 300),
      updatedAt: Date.now()
    };
  }

  function validarCodigoTransferencia(valor, limite, rotulo) {
    const codigo = String(valor ?? "").trim();
    if (!codigo || codigo.length > limite || !/^[A-Za-z0-9_-]+$/.test(codigo)) {
      throw new Error(rotulo + " ausente ou com formato inválido.");
    }
    return codigo;
  }

  function validarPedido(pedido, agora = Date.now()) {
    if (!pedido || typeof pedido !== "object" || Array.isArray(pedido)) {
      throw new Error("A solicitação recebida não é um objeto válido.");
    }
    if (pedido.schema !== 1 || pedido.source !== "smarttable-crm") {
      throw new Error("A versão ou a origem da solicitação não é reconhecida.");
    }
    if (typeof pedido.id !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(pedido.id)) {
      throw new Error("O identificador da solicitação é inválido.");
    }

    const createdAt = Number(pedido.createdAt);
    const idade = Number(agora) - createdAt;
    if (!Number.isFinite(createdAt) || idade < -30000 || idade > TTL_PEDIDO_MS) {
      throw new Error("A solicitação expirou ou possui horário inválido. Envie novamente pelo CRM.");
    }

    const cnpj = String(pedido.cnpj ?? "").replace(/\D/g, "");
    if (!/^\d{14}$/.test(cnpj)) throw new Error("O CNPJ de referência não contém 14 dígitos.");

    const razaoSocial = String(pedido.razaoSocial ?? "").trim();
    if (!razaoSocial || razaoSocial.length > 180) {
      throw new Error("A razão social de referência está vazia ou excede o limite.");
    }

    return {
      schema: 1,
      id: pedido.id,
      createdAt,
      source: "smarttable-crm",
      cnpj,
      razaoSocial,
      titulo: validarCodigoTransferencia(pedido.titulo, MAX_TITULO_TRANSFERENCIA, "Número do título"),
      parcela: validarCodigoTransferencia(pedido.parcela, MAX_PARCELA_TRANSFERENCIA, "Parcela/sequência"),
      vencimento: String(pedido.vencimento ?? "").slice(0, 20),
      saldo: String(pedido.saldo ?? "").slice(0, 40),
      diasAtraso: Number.isInteger(pedido.diasAtraso) ? pedido.diasAtraso : null,
      situacao: String(pedido.situacao ?? "").slice(0, 40),
      fluxo: String(pedido.fluxo ?? "").slice(0, 20)
    };
  }

  function emitirResultado(resultado) {
    if (!NA_PAGINA_CRM || !resultado || typeof resultado.id !== "string") return;
    const Construtor = document.defaultView?.CustomEvent || window.CustomEvent || CustomEvent;
    document.dispatchEvent(new Construtor(EVENTO_RESULTADO, {
      detail: JSON.stringify(resultado)
    }));
  }

  async function lerChave(chave) {
    if (typeof GM_getValue !== "function") {
      throw new Error("O armazenamento compartilhado do Tampermonkey não está disponível.");
    }
    return await GM_getValue(chave, null);
  }

  async function gravarChave(chave, valor) {
    if (typeof GM_setValue !== "function") {
      throw new Error("O armazenamento compartilhado do Tampermonkey não está disponível.");
    }
    await GM_setValue(chave, valor);
  }

  async function publicarResultado(pedido, status, ok, mensagem) {
    const resultado = criarResultado(pedido, status, ok, mensagem);
    await gravarChave(CHAVES.resultado, resultado);
    emitirResultado(resultado);
    return resultado;
  }

  async function adquirirLock(chave, pedidoId, ttlMs) {
    const anterior = await lerChave(chave);
    if (
      anterior &&
      Number(anterior.expiraEm) > Date.now() &&
      anterior.tabId !== ABA_ID
    ) {
      return false;
    }

    const candidato = {
      pedidoId,
      tabId: ABA_ID,
      expiraEm: Date.now() + ttlMs
    };
    await gravarChave(chave, candidato);
    await new Promise(resolve => window.setTimeout(resolve, 60));
    const confirmado = await lerChave(chave);
    return confirmado?.pedidoId === pedidoId && confirmado?.tabId === ABA_ID;
  }

  async function liberarLock(chave, pedidoId) {
    try {
      const atual = await lerChave(chave);
      if (atual?.pedidoId === pedidoId && atual?.tabId === ABA_ID) {
        await gravarChave(chave, null);
      }
    } catch (_) {
      // O lock expira pelo TTL se o armazenamento estiver indisponível.
    }
  }

  function normalizarCodigoComparacao(valor) {
    const codigo = String(valor ?? "").trim();
    return /^\d+$/.test(codigo) ? (codigo.replace(/^0+/, "") || "0") : codigo.toUpperCase();
  }

  /**
   * Compara valores do NXJ sem exigir o mesmo formato visual do campo.
   * Aceita zeros à esquerda e prefixos de chave/valor, mas nunca substrings.
   */
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

  /**
   * O Find só pode ser executado quando os dois valores foram observados
   * em comandos NXJ de confirmação concluídos com HTTP 2xx.
   *
   * O campo visual do título pode ser limpo pelo ERP após o blur; isso só é
   * aceitável quando o valor exato foi confirmado pelo protocolo NXJ.
   */
  function validarConfirmacoesNxj(confirmacoes) {
    const pendentes = [];
    if (confirmacoes?.titulo !== "NXJ") pendentes.push("número do título");
    if (confirmacoes?.parcela !== "NXJ") pendentes.push("parcela");

    if (pendentes.length) {
      throw new Error(
        "O Systextil não confirmou pelo protocolo NXJ o preenchimento de " +
        pendentes.join(" e ") +
        ". O Find foi bloqueado para evitar uma consulta sem os filtros completos."
      );
    }

    return true;
  }

  function documentosDaPagina() {
    return coletarDocumentosMesmoDominio(
      typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window
    );
  }

  function acharPorId(id) {
    for (const doc of documentosDaPagina()) {
      const el = doc.getElementById(id);
      if (el) return el;
    }
    return null;
  }

  function acharBotaoEmitir() {
    const porId = acharPorId("BTNEmetirBoletos.");
    if (porId) return porId;
    for (const doc of documentosDaPagina()) {
      const el = doc.getElementsByName("CMDEmetirBoletos")[0];
      if (el) return el;
    }
    return null;
  }

  function lerEstadoSystextil(pagina) {
    const visao = pagina.curDataView;
    if (!visao) return null;
    return {
      visao: String(visao.name ?? ""),
      busca: Boolean(visao.find),
      acao: String(visao.recordAction ?? ""),
      total: Number.parseInt(visao.recordCount, 10) || 0,
      atual: Number.parseInt(visao.recordNumber, 10) || 0
    };
  }

  function obterMonitorRequisicoes(pagina) {
    if (pagina.__stSegundaViaMonitor) return pagina.__stSegundaViaMonitor;
    const prototipo = pagina.XMLHttpRequest?.prototype;
    if (!prototipo || typeof prototipo.open !== "function" || typeof prototipo.send !== "function") {
      throw new Error("Não foi possível monitorar as requisições do Systextil.");
    }

    const originalOpen = prototipo.open;
    const originalSend = prototipo.send;
    const monitor = { emAndamento: 0, ultimaConclusao: Date.now(), total: 0 };

    prototipo.open = function (metodo, url) {
      try {
        this.__stSegundaViaRequest = /UnifyNXJ\.jsp/i.test(String(url));
      } catch (_) {
        this.__stSegundaViaRequest = false;
      }
      return originalOpen.apply(this, arguments);
    };

    prototipo.send = function () {
      if (this.__stSegundaViaRequest) {
        monitor.total += 1;
        monitor.emAndamento += 1;
        let finalizado = false;
        const finalizar = () => {
          if (finalizado) return;
          finalizado = true;
          monitor.emAndamento = Math.max(0, monitor.emAndamento - 1);
          monitor.ultimaConclusao = Date.now();
        };
        try {
          this.addEventListener("loadend", finalizar, { once: true });
        } catch (_) {
          monitor.emAndamento = Math.max(0, monitor.emAndamento - 1);
          monitor.ultimaConclusao = Date.now();
        }
      }
      return originalSend.apply(this, arguments);
    };

    pagina.__stSegundaViaMonitor = monitor;
    return monitor;
  }

  async function aguardarOcioso(monitor, limiteMs = 20000) {
    const inicio = Date.now();
    while (true) {
      verificarCancelamento();
      if (
        monitor.emAndamento === 0 &&
        Date.now() - monitor.ultimaConclusao >= 300
      ) {
        return;
      }
      if (Date.now() - inicio >= limiteMs) {
        throw new Error("O Systextil não concluiu as requisições dentro do tempo esperado.");
      }
      await pausa(60);
    }
  }

  const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));

  let cancelado = false;
  let consumoEmAndamento = false;
  let processamentoEmAndamento = false;

  function verificarCancelamento() {
    if (cancelado) throw new Error("A execução foi interrompida com Esc.");
  }

  function statusOperacional(mensagem, tipo = "info") {
    const prefixo = "[Systextil Segunda Via] ";
    if (tipo === "erro") console.error(prefixo + mensagem);
    else console.info(prefixo + mensagem);
  }

  function lerCamposConsulta() {
    const formulario = localizarFormulario();
    return {
      titulo: lerValor(formulario, CAMPOS.titulo),
      parcela: lerValor(formulario, CAMPOS.parcela),
      cliente: lerValor(formulario, CAMPOS.cliente)
    };
  }

  function clicarBarraConsulta(chave) {
    const ids = {
      limpar: "btnClearToFind.",
      find: "btnFind.",
      processos: "procAgendados"
    };
    const id = ids[chave];
    if (!id) throw new Error("Ação de navegação não permitida.");
    const elemento = acharPorId(id);
    if (!elemento) throw new Error("O controle do Systextil não foi encontrado: " + id);
    elemento.click();
    return elemento;
  }

  async function aguardarVisao(pagina, nome, limiteMs = 25000) {
    const inicio = Date.now();
    while (Date.now() - inicio < limiteMs) {
      verificarCancelamento();
      const estado = lerEstadoSystextil(pagina);
      if (estado?.visao === nome) return estado;
      await pausa(150);
    }
    return null;
  }

  async function aguardarVisaoInicial(pagina, limiteMs = 25000) {
    const inicio = Date.now();
    while (Date.now() - inicio < limiteMs) {
      const estado = lerEstadoSystextil(pagina);
      if (estado && [VISAO_CONSULTA, VISAO_PROCESSOS].includes(estado.visao)) return estado;
      await pausa(150);
    }
    return lerEstadoSystextil(pagina);
  }

  async function aguardarResultadoFind(pagina, limiteMs = 20000) {
    const inicio = Date.now();
    while (Date.now() - inicio < limiteMs) {
      verificarCancelamento();
      const estado = lerEstadoSystextil(pagina);
      if (
        estado &&
        estado.busca === false &&
        (estado.acao === "RECORDS_FOUND" || /NO_RECORDS/i.test(estado.acao))
      ) {
        return estado;
      }
      await pausa(100);
    }
    throw new Error("O Systextil não confirmou o resultado da consulta.");
  }

  function obterExecucaoAtiva(execucao, agora = Date.now()) {
    if (!execucao || typeof execucao !== "object") return false;

    const estadosAtivos = [
      "preenchendo",
      "emissao-solicitada",
      "processando",
      "baixando",
      "indeterminado"
    ];
    if (!estadosAtivos.includes(execucao.status)) return false;

    // Antes de "emissao-solicitada", nenhuma emissão foi acionada. Esse
    // preenchimento pode expirar; estados posteriores nunca expiram sozinhos.
    if (execucao.status !== "preenchendo") return true;

    const criadoEm = Number(execucao.criadoEm);
    const instanteAtual = Number(agora);
    if (
      !Number.isFinite(criadoEm) ||
      criadoEm <= 0 ||
      !Number.isFinite(instanteAtual) ||
      instanteAtual < criadoEm
    ) {
      return true;
    }

    return instanteAtual - criadoEm <= MAX_IDADE_SOLICITACAO_MS;
  }

  async function executarConsultaCrm(pedido, pagina) {
    const estado = lerEstadoSystextil(pagina);
    if (!estado || estado.visao !== VISAO_CONSULTA) {
      throw new Error("Abra a Consulta de títulos no Systextil. Nenhum campo foi alterado.");
    }

    const chaveEmissao = PREFIXO_CHAVE_EMISSAO +
      normalizarCodigoComparacao(pedido.titulo) + "." +
      normalizarCodigoComparacao(pedido.parcela);
    const emissaoAnterior = Number(pagina.sessionStorage.getItem(chaveEmissao));
    if (
      Number.isFinite(emissaoAnterior) &&
      emissaoAnterior > 0 &&
      Date.now() - emissaoAnterior < JANELA_BLOQUEIO_EMISSAO_MS
    ) {
      throw new Error("Este título/parcela já teve uma emissão solicitada nos últimos cinco minutos. A repetição foi bloqueada.");
    }

    const monitor = obterMonitorRequisicoes(pagina);
    const execucaoBase = {
      schema: 1,
      pedidoId: pedido.id,
      cnpj: pedido.cnpj,
      razaoSocial: pedido.razaoSocial,
      tituloSolicitado: pedido.titulo,
      parcelaSolicitada: pedido.parcela,
      status: "preenchendo",
      criadoEm: Date.now()
    };
    await gravarChave(CHAVES.execucao, execucaoBase);

    let emissaoClicada = false;
    try {
      let tela = lerEstadoSystextil(pagina);
      if (!tela) throw new Error("Não foi possível identificar o estado atual da Consulta de títulos.");

      const camposComSobra = () =>
        [CAMPOS.titulo, CAMPOS.parcela].some(nome =>
          String(pagina.document?.getElementsByName?.(nome)?.[0]?.value ?? "").trim() !== ""
        );

      if (!tela.busca || camposComSobra()) {
        clicarBarraConsulta("limpar");
        await pausa(200);
        await aguardarOcioso(monitor, 20000);

        const inicioBusca = Date.now();
        while (Date.now() - inicioBusca < 5000) {
          if (lerEstadoSystextil(pagina)?.busca === true) break;
          await pausa(80);
        }
        if (lerEstadoSystextil(pagina)?.busca !== true) {
          throw new Error("Não foi possível preparar a tela para uma nova consulta.");
        }
        if (camposComSobra()) {
          throw new Error("O Systextil não limpou os campos de uma tentativa anterior. Consulta interrompida.");
        }
      }

      statusOperacional("Preenchendo título e parcela diretamente nos campos do ERP.");
      const preenchimento = await preencherCamposConsulta({
        titulo: pedido.titulo,
        parcela: pedido.parcela
      });
      if (!preenchimento) {
        throw new Error("O preenchimento não retornou resultado verificável.");
      }

      // Barreira independente: nenhuma consulta é enviada sem confirmação
      // NXJ explícita dos dois campos.
      validarConfirmacoesNxj(preenchimento.confirmacoes);

      const antesFind = lerCamposConsulta();
      if (
        !antesFind.parcela ||
        normalizarCodigoComparacao(antesFind.parcela) !== normalizarCodigoComparacao(pedido.parcela)
      ) {
        throw new Error("A parcela não permaneceu correta no campo real do Systextil. A consulta foi bloqueada.");
      }
      if (
        antesFind.titulo &&
        normalizarCodigoComparacao(antesFind.titulo) !== normalizarCodigoComparacao(pedido.titulo)
      ) {
        throw new Error("O título exibido no Systextil diverge do título recebido do CRM. A consulta foi bloqueada.");
      }

      const estadoAntesFind = lerEstadoSystextil(pagina);
      if (!estadoAntesFind?.busca) {
        throw new Error("O Systextil não está em modo de consulta. Find não foi acionado.");
      }

      statusOperacional("Acionando Find para consultar o título no ERP.");
      const totalAntesFind = monitor.total;
      clicarBarraConsulta("find");

      const inicioFind = Date.now();
      while (monitor.total === totalAntesFind && Date.now() - inicioFind < 2500) {
        await pausa(60);
      }
      if (monitor.total === totalAntesFind) {
        throw new Error("O controle Find não gerou uma requisição NXJ. A emissão foi bloqueada.");
      }

      await aguardarOcioso(monitor, 20000);
      const resultadoFind = await aguardarResultadoFind(pagina, 20000);

      if (resultadoFind.acao !== "RECORDS_FOUND" || resultadoFind.total < 1) {
        throw new Error("Nenhum título foi encontrado para o número e parcela recebidos. Nada foi emitido.");
      }
      if (resultadoFind.total !== 1) {
        throw new Error("A consulta retornou " + resultadoFind.total + " registros. A emissão exige uma única correspondência.");
      }

      const campos = lerCamposConsulta();
      if (
        !campos.parcela ||
        normalizarCodigoComparacao(campos.parcela) !== normalizarCodigoComparacao(pedido.parcela)
      ) {
        throw new Error("A parcela retornada pelo Systextil não corresponde exatamente à parcela do CRM.");
      }
      if (!campos.titulo) {
        throw new Error("A consulta terminou sem disponibilizar o número do título para conferência.");
      }
      if (normalizarCodigoComparacao(campos.titulo) !== normalizarCodigoComparacao(pedido.titulo)) {
        throw new Error("O título retornado pelo Systextil diverge do solicitado.");
      }
      if (!campos.cliente) {
        throw new Error("O Systextil não identificou o cliente do título.");
      }

      const solicitadoEm = Date.now();
      const execucaoCompleta = {
        ...execucaoBase,
        status: "emissao-solicitada",
        solicitadoEm,
        titulo: campos.titulo,
        parcela: campos.parcela,
        cliente: campos.cliente
      };
      pagina.sessionStorage.setItem(CHAVE_SOLICITACAO_EMISSAO, JSON.stringify({
        solicitadoEm,
        titulo: campos.titulo,
        parcela: campos.parcela,
        cliente: campos.cliente,
        versao: VERSION
      }));
      pagina.sessionStorage.setItem(chaveEmissao, String(solicitadoEm));
      await gravarChave(CHAVES.execucao, execucaoCompleta);

      const botaoEmitir = acharBotaoEmitir();
      if (!botaoEmitir || botaoEmitir.disabled) {
        throw new Error("O botão Emite boleto não está disponível. Nenhuma emissão foi solicitada.");
      }

      statusOperacional("Título e parcela conferidos. Solicitando emissão.");
      emissaoClicada = true;
      botaoEmitir.click();

      try {
        await aguardarOcioso(monitor, 20000);
      } catch (erroEspera) {
        statusOperacional("A solicitação de emissão foi acionada, mas o ERP não confirmou a ociosidade: " + erroEspera.message, "erro");
      }

      await gravarChave(CHAVES.pedido, null);
      await publicarResultado(pedido, "emissao-solicitada", true, "Título conferido e emissão solicitada. A automação está acompanhando Processos agendados.");

      const botaoProcessos = acharPorId("procAgendados");
      if (!botaoProcessos) {
        throw new Error("A emissão foi solicitada, mas o controle Processos agendados não foi localizado. A solicitação foi preservada para recuperação.");
      }
      botaoProcessos.click();

      // O ERP pode trocar a visão na mesma aba ou abrir outra. Em ambos os casos,
      // a aba que chegar a Processos agendados lê CHAVES.execucao e continua.
      await aguardarVisao(pagina, VISAO_PROCESSOS, 12000);
    } catch (erro) {
      if (!emissaoClicada) {
        await gravarChave(CHAVES.execucao, null);
        try {
          pagina.sessionStorage.removeItem(CHAVE_SOLICITACAO_EMISSAO);
          pagina.sessionStorage.removeItem(chaveEmissao);
        } catch (_) {}
      } else {
        const atual = await lerChave(CHAVES.execucao);
        if (atual) {
          await gravarChave(CHAVES.execucao, {
            ...atual,
            status: "indeterminado",
            motivo: String(erro?.message ?? "Falha após acionar emissão.").slice(0, 240)
          });
        }
      }
      throw erro;
    }
  }

  async function consumirPedido(pedidoInformado, pagina) {
    if (!NA_PAGINA_SYSTEXTIL || consumoEmAndamento) return;
    consumoEmAndamento = true;
    let pedido;
    let lockAdquirido = false;

    try {
      pedido = validarPedido(pedidoInformado);
      const pendente = await lerChave(CHAVES.pedido);
      if (!pendente || pendente.id !== pedido.id) return;

      const view = await aguardarVisao(pagina, VISAO_CONSULTA, 25000);
      if (!view) {
        await publicarResultado(pedido, "erro", false, "Abra a Consulta de títulos no Systextil para iniciar a automação.");
        return;
      }

      const execucaoAtual = await lerChave(CHAVES.execucao);
      if (obterExecucaoAtiva(execucaoAtual)) {
        await publicarResultado(pedido, "erro", false, "Já existe uma segunda via em andamento. Aguarde a conclusão antes de enviar outro título.");
        return;
      }

      lockAdquirido = await adquirirLock(CHAVES.consumidor, pedido.id, TTL_LOCK_TRANSFER_MS);
      if (!lockAdquirido) return;

      const pedidoAtual = await lerChave(CHAVES.pedido);
      if (!pedidoAtual || pedidoAtual.id !== pedido.id) return;

      await publicarResultado(pedido, "processando", true, "Solicitação recebida. O preenchimento e a consulta começaram automaticamente.");
      await executarConsultaCrm(pedido, pagina);
    } catch (erro) {
      const seguro = pedido || (pedidoInformado && typeof pedidoInformado.id === "string" ? pedidoInformado : { id: "" });
      await publicarResultado(seguro, "erro", false, erro?.message || "Não foi possível iniciar a segunda via.");
      statusOperacional(erro?.message || "Falha não identificada.", "erro");
    } finally {
      if (pedido && lockAdquirido) {
        await liberarLock(CHAVES.consumidor, pedido.id);
        const execucaoAtual = await lerChave(CHAVES.execucao).catch(() => null);
        if (!obterExecucaoAtiva(execucaoAtual)) {
          const pendente = await lerChave(CHAVES.pedido).catch(() => null);
          if (pendente?.id === pedido.id) await gravarChave(CHAVES.pedido, null).catch(() => {});
        }
      }
      consumoEmAndamento = false;
    }
  }

  async function atualizarGradeProcessos(pagina, monitor) {
    const botaoFind = acharPorId("btnFind.");
    if (botaoFind) {
      botaoFind.click();
      await aguardarOcioso(monitor, 20000);
    }
  }

  async function iniciarDownloadAutomatico(execucao, registro, pagina) {
    const localizado = localizarFormularioProcessos();
    const janelaPagina = localizarJanelaPagina(localizado.documento);
    const preparado = prepararUrlDownloadProcesso(
      registro,
      janelaPagina,
      janelaPagina.location.href,
      lerRegistrosProcessos
    );
    const nomeArquivo = montarNomeArquivo({
      cliente: execucao.cliente || execucao.razaoSocial,
      titulo: execucao.titulo,
      parcela: execucao.parcela
    });
    const armazenamento = pagina.sessionStorage;
    const chaveDownload = montarChaveDownload(execucao, registro);
    reservarDownload(armazenamento, chaveDownload, Date.now());

    await gravarChave(CHAVES.execucao, { ...execucao, status: "baixando" });
    await publicarResultado({ id: execucao.pedidoId }, "baixando", true, "Emissão confirmada. Baixando o PDF para a pasta Downloads.");

    return new Promise((resolve, reject) => {
      let finalizado = false;
      const finalizar = async (tipo, erro) => {
        if (finalizado) return;
        finalizado = true;

        if (tipo === "sucesso") {
          try {
            concluirDownload(armazenamento, chaveDownload, Date.now());
            await gravarChave(CHAVES.execucao, null);
            await publicarResultado({ id: execucao.pedidoId }, "concluido", true, "Segunda via concluída. PDF salvo na pasta Downloads do navegador.");
            statusOperacional("Segunda via concluída. PDF enviado para Downloads.");
            resolve();
          } catch (falha) {
            await publicarResultado({ id: execucao.pedidoId }, "erro", false, "O download terminou, mas não foi possível registrar a proteção contra duplicidade: " + falha.message);
            reject(falha);
          }
          return;
        }

        const codigoErro = String(erro?.error ?? "").toLowerCase();
        const falhaAntesDeIniciar = erro?.stage === "fetch" || ["not_enabled", "not_whitelisted", "not_permitted", "not_supported"].includes(codigoErro);

        if (falhaAntesDeIniciar) {
          liberarDownload(armazenamento, chaveDownload);
          await gravarChave(CHAVES.execucao, { ...execucao, status: "falha", motivo: codigoErro });
          await publicarResultado({ id: execucao.pedidoId }, "erro", false, "O Tampermonkey não iniciou o download: " + codigoErro + ". Verifique as permissões de download.");
          reject(new Error("O Tampermonkey não iniciou o download (" + codigoErro + ")."));
          return;
        }

        try {
          marcarDownloadIndeterminado(armazenamento, chaveDownload, Date.now());
        } catch (_) {
          // Mantém a reserva existente caso não consiga marcar o estado.
        }
        await gravarChave(CHAVES.execucao, { ...execucao, status: "indeterminado", motivo: String(erro?.message || erro?.error || "resultado-indeterminado").slice(0, 240) });
        await publicarResultado({ id: execucao.pedidoId }, "indeterminado", false, "O navegador não confirmou o download. Confira a pasta Downloads antes de solicitar outra emissão.");
        reject(new Error("Resultado do download indeterminado. Confira a pasta Downloads antes de repetir."));
      };

      try {
        iniciarDownloadPdf(preparado.url, nomeArquivo, {
          onload: () => { void finalizar("sucesso"); },
          onerror: erro => { void finalizar("erro", erro); },
          ontimeout: erro => { void finalizar("indeterminado", erro || new Error("Tempo esgotado no download.")); },
          onabort: erro => { void finalizar("indeterminado", erro || new Error("Download cancelado.")); }
        });
      } catch (erro) {
        void finalizar("erro", { error: "not_succeeded", message: erro.message });
      }
    });
  }

  async function executarProcessosAutomaticamente(pagina, execucaoInformada) {
    if (processamentoEmAndamento) return;
    processamentoEmAndamento = true;
    let lockAdquirido = false;
    let execucao = execucaoInformada;

    try {
      if (!execucao || !execucao.pedidoId || !execucao.solicitadoEm || !execucao.titulo || !execucao.parcela) {
        throw new Error("Não há uma emissão registrada para identificar em Processos agendados.");
      }

      lockAdquirido = await adquirirLock(CHAVES.lockProcesso, execucao.pedidoId, TTL_LOCK_PROCESSO_MS);
      if (!lockAdquirido) return;

      const estadoAtual = lerEstadoSystextil(pagina);
      if (!estadoAtual || estadoAtual.visao !== VISAO_PROCESSOS) {
        throw new Error("A tela Processos agendados não está ativa.");
      }

      execucao = { ...execucao, status: "processando" };
      await gravarChave(CHAVES.execucao, execucao);
      await publicarResultado({ id: execucao.pedidoId }, "processando", true, "Aguardando a conclusão da emissão em Processos agendados.");

      const monitor = obterMonitorRequisicoes(pagina);
      const inicio = Date.now();
      let registroConcluido = null;

      while (!registroConcluido) {
        verificarCancelamento();
        if (Date.now() - inicio >= 180000) {
          throw new Error("Tempo esgotado aguardando o processo de emissão. A solicitação foi preservada para conferência.");
        }

        let registros;
        try {
          registros = lerRegistrosProcessos();
        } catch (erro) {
          const telaAindaCarregando =
            /grade não contém registros legíveis|Formulário de Processos agendados não identificado/i
              .test(String(erro?.message || ""));
          if (!telaAindaCarregando) throw erro;
          registros = [];
        }

        const analise = analisarProcessos(registros, execucao, Date.now());
        if (analise.status === "sucesso" && analise.registro) {
          registroConcluido = analise.registro;
          break;
        }
        if (!["nao-encontrado", "em-andamento"].includes(analise.status)) {
          throw new Error(analise.mensagem || "O processo não pôde ser identificado com segurança.");
        }

        if (Date.now() - inicio > 15000) {
          await publicarResultado({ id: execucao.pedidoId }, "processando", true, "O ERP ainda está processando a emissão. A consulta será atualizada automaticamente.");
        }
        await atualizarGradeProcessos(pagina, monitor);
        await pausa(4000);
      }

      await iniciarDownloadAutomatico(execucao, registroConcluido, pagina);
    } catch (erro) {
      const execucaoAtual = await lerChave(CHAVES.execucao).catch(() => null);
      if (execucaoAtual && execucaoAtual.pedidoId === execucaoInformada?.pedidoId) {
        const indeterminado = /indeterminado|tempo esgotado|preservada para conferência/i.test(String(erro?.message || ""));
        await gravarChave(CHAVES.execucao, {
          ...execucaoAtual,
          status: indeterminado ? "indeterminado" : "falha",
          motivo: String(erro?.message || "Falha ao acompanhar processo.").slice(0, 240)
        });
      }
      await publicarResultado(
        { id: execucaoInformada?.pedidoId || "" },
        "erro",
        false,
        erro?.message || "Falha ao acompanhar o processo de emissão."
      );
      statusOperacional(erro?.message || "Falha ao acompanhar processos.", "erro");
    } finally {
      if (lockAdquirido && execucaoInformada?.pedidoId) {
        await liberarLock(CHAVES.lockProcesso, execucaoInformada.pedidoId);
      }
      processamentoEmAndamento = false;
    }
  }

  async function receberPedidoCrm(evento) {
    let pedidoInformado;
    try {
      pedidoInformado = typeof evento?.detail === "string" ? JSON.parse(evento.detail) : evento?.detail;
      const pedido = validarPedido(pedidoInformado);
      const anterior = await lerChave(CHAVES.pedido);
      if (anterior) {
        try {
          validarPedido(anterior);
          throw new Error("Já existe um título aguardando processamento. Aguarde a conclusão antes de enviar outro.");
        } catch (erro) {
          if (/Já existe um título aguardando/.test(erro.message)) throw erro;
          await gravarChave(CHAVES.pedido, null);
        }
      }

      const execucaoAnterior = await lerChave(CHAVES.execucao);
      if (obterExecucaoAtiva(execucaoAnterior)) {
        throw new Error("Já existe uma segunda via em andamento ou com resultado pendente de conferência.");
      }

      await gravarChave(CHAVES.pedido, pedido);
      await publicarResultado(pedido, "aguardando", true, "Título recebido. A automação será iniciada no Systextil.");
    } catch (erro) {
      const pedidoSeguro = pedidoInformado && typeof pedidoInformado.id === "string"
        ? pedidoInformado
        : { id: "" };
      emitirResultado(criarResultado(pedidoSeguro, "erro", false, erro?.message || "Solicitação recusada."));
    }
  }

  async function instalarBridgeCrm() {
    document.addEventListener(EVENTO_ENVIAR, receberPedidoCrm);
    if (typeof GM_addValueChangeListener === "function") {
      GM_addValueChangeListener(CHAVES.resultado, (_chave, _anterior, novo, remoto) => {
        if (remoto && novo && typeof novo.id === "string") emitirResultado(novo);
      });
    }
    const resultadoAtual = await lerChave(CHAVES.resultado).catch(() => null);
    if (resultadoAtual?.id) emitirResultado(resultadoAtual);
  }

  async function iniciarSystextil() {
    const pagina = obterJanelaPaginaSystextil();
    obterMonitorRequisicoes(pagina);

    document.addEventListener("keydown", evento => {
      if (evento.key === "Escape") {
        cancelado = true;
        statusOperacional("Interrupção solicitada. Uma emissão já enviada ao ERP não pode ser cancelada pelo navegador.");
      }
    }, true);

    if (typeof GM_addValueChangeListener === "function") {
      GM_addValueChangeListener(CHAVES.pedido, (_chave, _anterior, novo, remoto) => {
        if (remoto && novo) {
          cancelado = false;
          void consumirPedido(novo, pagina);
        }
      });
      GM_addValueChangeListener(CHAVES.execucao, (_chave, _anterior, novo, remoto) => {
        if (remoto && novo?.status === "emissao-solicitada") {
          const estado = lerEstadoSystextil(pagina);
          if (estado?.visao === VISAO_PROCESSOS) {
            cancelado = false;
            void executarProcessosAutomaticamente(pagina, novo);
          }
        }
      });
    }

    const estadoInicial = await aguardarVisaoInicial(pagina, 25000);

    if (estadoInicial?.visao === VISAO_PROCESSOS) {
      const execucao = await lerChave(CHAVES.execucao);
      if (execucao?.status === "emissao-solicitada" || execucao?.status === "processando") {
        cancelado = false;
        void executarProcessosAutomaticamente(pagina, execucao);
      }
    } else {
      const pedido = await lerChave(CHAVES.pedido);
      if (pedido) {
        cancelado = false;
        void consumirPedido(pedido, pagina);
      }
    }

    // Se o Systextil trocar de DataView sem recarregar o documento, detecta a
    // mudança e retoma o acompanhamento na mesma aba.
    let ultimaVisao = estadoInicial?.visao || "";
    window.setInterval(async () => {
      const atual = lerEstadoSystextil(pagina);
      if (!atual || atual.visao === ultimaVisao) return;
      ultimaVisao = atual.visao;
      if (atual.visao === VISAO_PROCESSOS && !processamentoEmAndamento) {
        const execucao = await lerChave(CHAVES.execucao).catch(() => null);
        if (execucao?.status === "emissao-solicitada" || execucao?.status === "processando") {
          cancelado = false;
          void executarProcessosAutomaticamente(pagina, execucao);
        }
      } else if (atual.visao === VISAO_CONSULTA && !consumoEmAndamento) {
        const pedido = await lerChave(CHAVES.pedido).catch(() => null);
        if (pedido) {
          cancelado = false;
          void consumirPedido(pedido, pagina);
        }
      }
    }, 500);
  }

  if (EM_NODE) {
    module.exports = Object.freeze({
      VERSION,
      validarPedido,
      extrairValoresPendentesNxj,
      valorConfere,
      validarConfirmacoesNxj,
      obterExecucaoAtiva,
      analisarProcessos,
      interpretarDataHoraProcesso,
      normalizarCodigoComparacao,
      validarUrlPdf,
      validarBytesPdf,
      montarNomeArquivo,
      montarChaveDownload,
      reservarDownload,
      concluirDownload,
      marcarDownloadIndeterminado,
      liberarDownload
    });
    return;
  }

  window.__systextilSegundaViaAutomatica = Object.freeze({
    version: VERSION,
    analisarProcessos,
    validarPedido,
    validarUrlPdf,
    montarNomeArquivo
  });

  if (NA_PAGINA_CRM) {
    void instalarBridgeCrm();
    return;
  }

  void iniciarSystextil();
})();