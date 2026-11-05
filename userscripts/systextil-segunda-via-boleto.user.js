// ==UserScript==
// @name         Systextil - Segunda Via de Boleto (conferência)
// @namespace    https://texcotton.com.br/tampermonkey
// @version      0.4.6
// @updateURL     https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via-boleto.user.js
// @downloadURL   https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via-boleto.user.js
// @description  Consulta, identifica e baixa a segunda via de boleto sem recarregar a página.
// @match        http://systextil.texcotton.com.br/systextil/*
// @match        https://systextil.texcotton.com.br/systextil/*
// @run-at       context-menu
// @noframes
// @grant        unsafeWindow
// @grant        GM_download
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.4.6";
  const PANEL_ID = "st-segunda-via-boleto-panel";
  const DATA_VIEW_CONSULTA_TITULOS = "forms.crec.crec_f090";
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

  if (window.top !== window) {
    return;
  }

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

    function extrairValorPendente(fieldValues) {
      if (typeof fieldValues !== "string") return null;

      const partes = fieldValues.split("\f");

      for (let indice = partes.length - 1; indice >= 0; indice -= 1) {
        const valor = partes[indice].trim();
        if (valor) return valor;
      }

      return "";
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
        valorPendente: extrairValorPendente(dadosComando.fieldValues),
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

    async function aguardarConfirmacao(valorEsperado, sequenciaMinima, rotulo) {
      const inicio = Date.now();
      let registro = null;

      while (!registro) {
        validarVisaoConsultaTitulos(pagina);

        registro = requisicoes.find(requisicao =>
          requisicao.sequencia > sequenciaMinima &&
          requisicao.metodo === "POST" &&
          COMANDOS_NXJ_CONFIRMACAO.has(requisicao.comando) &&
          requisicao.valorPendente === valorEsperado
        ) || null;

        if (registro) break;

        if (Date.now() - inicio >= limiteEsperaMs) {
          const requisicoesDaEtapa = requisicoes.filter(requisicao =>
            requisicao.sequencia > sequenciaMinima
          );
          const postsDaEtapa = requisicoesDaEtapa.filter(requisicao =>
            requisicao.metodo === "POST"
          );
          const comandosDeSaida = postsDaEtapa.filter(requisicao =>
            COMANDOS_NXJ_CONFIRMACAO.has(requisicao.comando)
          );
          const valoresCorrespondentes = comandosDeSaida.filter(requisicao =>
            requisicao.valorPendente === valorEsperado
          );

          throw new Error(
            "O Systextil não confirmou o campo " + rotulo +
            " pelo comando NXJ dentro de " +
            Math.round(limiteEsperaMs / 1000) +
            " segundos. Diagnóstico NXJ (sem expor os valores): " +
            requisicoesDaEtapa.length + " requisição(ões) observada(s), " +
            postsDaEtapa.length + " POST(s), " +
            comandosDeSaida.length + " comando(s) de saída de campo e " +
            valoresCorrespondentes.length + " valor(es) correspondente(s)."
          );
        }

        await pausa(intervaloMs);
      }

      if (registro.monitoramentoFalhou) {
        throw new Error(
          "O comando de confirmação do campo " + rotulo +
          " foi enviado, mas não pôde ser monitorado."
        );
      }

      while (!registro.finalizado) {
        validarVisaoConsultaTitulos(pagina);

        if (Date.now() - inicio >= limiteEsperaMs) {
          throw new Error(
            "O comando NXJ do campo " + rotulo + " não terminou dentro do limite de espera."
          );
        }

        await pausa(intervaloMs);
      }

      if (registro.status < 200 || registro.status >= 300) {
        throw new Error(
          "O comando NXJ de confirmação do campo " + rotulo +
          " retornou HTTP " + registro.status + "."
        );
      }

      await aguardarOcioso();

      return {
        confirmado: true,
        comando: registro.comando
      };
    }

    return {
      obterSequencia() {
        return estado.sequencia;
      },
      aguardarOcioso,
      aguardarConfirmacao,
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

    // Reproduz a temporização que comprovadamente funciona no NXJ:
    // aguardar após inserir o valor, antes de abandonar o campo, e após focar o próximo.
    // atrasoFocoMs permanece como atalho compatível para testes legados.
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

    const atrasoFocoInicialMs = obterAtrasoConfigurado("atrasoFocoInicialMs", 500);
    const atrasoAntesDeSairCampoMs = obterAtrasoConfigurado("atrasoAntesDeSairCampoMs", 500);
    const atrasoAposSairCampoMs = obterAtrasoConfigurado("atrasoAposSairCampoMs", 800);

    function pausa(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function obterCamposAtuais() {
      const formularioAtual = localizarFormularioConsulta();
      const tituloAtual = formularioAtual.elements.namedItem(CAMPOS.titulo);
      const parcelaAtual = formularioAtual.elements.namedItem(CAMPOS.parcela);

      if (!tituloAtual || !parcelaAtual) {
        throw new Error("Um dos campos da consulta deixou de existir após a atualização da tela.");
      }

      return {
        formulario: formularioAtual,
        titulo: tituloAtual,
        parcela: parcelaAtual
      };
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
      let campos = obterCamposAtuais();

      validarCampoEditavel(campos.titulo);
      validarCampoEditavel(campos.parcela);

      // O fluxo manual validado pelo operador envia o título exatamente como digitado.
      // Não completar zeros à esquerda: o NXJ confirma o valor pendente original.
      const titulo = preservarCodigoConsulta(
        dados?.titulo,
        "Número do título",
        obterLarguraCampo(campos.titulo, LARGURAS_PADRAO_CONSULTA.titulo)
      );
      const parcela = preservarCodigoConsulta(
        dados?.parcela,
        "Parcela",
        obterLarguraCampo(campos.parcela, LARGURAS_PADRAO_CONSULTA.parcela)
      );

      const pagina = obterJanelaPaginaSystextil();
      validarVisaoConsultaTitulos(pagina);

      monitor = criarMonitorComandosNxj(pagina, configuracaoTeste);

      // O primeiro foco só prepara o campo. Aguarda qualquer comando que o NXJ
      // tenha iniciado ao abandonar o campo anteriormente ativo.
      campos.titulo.focus();
      await pausa(atrasoFocoInicialMs);
      await monitor.aguardarOcioso();

      validarVisaoConsultaTitulos(pagina);
      campos = obterCamposAtuais();
      validarCampoEditavel(campos.titulo);
      valoresAlterados = true;
      atribuirValorCampo(campos.titulo, titulo);

      if (String(campos.titulo.value ?? "").trim() !== titulo) {
        throw new Error("O navegador não manteve o número do título no campo.");
      }

      // O NXJ precisa de uma janela após input/change antes do blur.
      await pausa(atrasoAntesDeSairCampoMs);

      // Ao sair do título, o NXJ deve transportar o valor pendente no POST.
      const sequenciaAntesDoTitulo = monitor.obterSequencia();
      campos.parcela.focus();
      await pausa(atrasoAposSairCampoMs);
      await monitor.aguardarConfirmacao(
        titulo,
        sequenciaAntesDoTitulo,
        "número do título"
      );

      // O NXJ pode atualizar/recriar controles ao responder. Nunca reutilize a
      // referência anterior sem reler o formulário.
      validarVisaoConsultaTitulos(pagina);
      campos = obterCamposAtuais();

      if (String(campos.titulo.value ?? "").trim() !== titulo) {
        throw new Error("O Systextil não manteve o número do título após a confirmação.");
      }

      validarCampoEditavel(campos.parcela);

      // A resposta NXJ do título pode recriar os controles do formulário.
      // Nesse caso, a referência atual da parcela ainda não recebeu foco,
      // embora o elemento anterior tenha sido focado antes da confirmação.
      // Refocalize o controle recém-localizado e reproduza a pausa do teste manual.
      campos.parcela.focus();
      await pausa(atrasoAposSairCampoMs);

      atribuirValorCampo(campos.parcela, parcela);

      if (String(campos.parcela.value ?? "").trim() !== parcela) {
        throw new Error("O navegador não manteve a parcela no campo.");
      }

      // A mesma janela é necessária antes de abandonar o campo da parcela.
      await pausa(atrasoAntesDeSairCampoMs);

      // Retornar ao título provoca a confirmação da parcela por ClickOnField.
      const sequenciaAntesDaParcela = monitor.obterSequencia();
      campos.titulo.focus();
      await pausa(atrasoAposSairCampoMs);
      await monitor.aguardarConfirmacao(
        parcela,
        sequenciaAntesDaParcela,
        "parcela"
      );

      validarVisaoConsultaTitulos(pagina);
      campos = obterCamposAtuais();

      if (
        String(campos.titulo.value ?? "").trim() !== titulo ||
        String(campos.parcela.value ?? "").trim() !== parcela
      ) {
        throw new Error(
          "Os valores visíveis mudaram após as confirmações do Systextil."
        );
      }

      return {
        titulo,
        parcela,
        confirmacoes: {
          titulo: "NXJ",
          parcela: "NXJ"
        }
      };
    } catch (erro) {
      if (valoresAlterados) {
        throw new Error(
          "Preenchimento interrompido. NÃO pressione F7. Confira ou limpe manualmente os campos no ERP antes de tentar novamente. " +
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
    const candidatos = [
      janelaPagina?.DataView,
      janelaPagina?.dataView
    ].filter((candidato, indice, lista) =>
      candidato &&
      (typeof candidato === "object" || typeof candidato === "function") &&
      "currentRow" in Object(candidato) &&
      lista.indexOf(candidato) === indice
    );

    if (candidatos.length !== 1) {
      throw new Error(
        candidatos.length === 0
          ? "A API de seleção da grade (DataView.currentRow) não está disponível. Nenhum download foi iniciado."
          : "Mais de um controlador de grade foi encontrado. Seleção interrompida."
      );
    }

    const controlador = candidatos[0];
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

  function iniciarDownloadPdf(url, nomeArquivo, callbacks) {
    if (typeof GM_download !== "function") {
      throw new Error("GM_download não está disponível. Verifique as permissões do Tampermonkey.");
    }

    let finalizado = false;
    const finalizar = (tipo, detalhe) => {
      if (finalizado) return;
      finalizado = true;

      if (tipo === "sucesso") {
        callbacks?.onload?.(detalhe);
      } else if (tipo === "timeout") {
        callbacks?.ontimeout?.(detalhe);
      } else {
        callbacks?.onerror?.(detalhe);
      }
    };

    try {
      return GM_download({
        url,
        name: nomeArquivo,
        saveAs: false,
        conflictAction: "uniquify",
        onload: detalhe => finalizar("sucesso", detalhe),
        onerror: detalhe => finalizar("falha", detalhe),
        ontimeout: detalhe => finalizar("timeout", detalhe)
      });
    } catch (erro) {
      finalizar("falha", erro);
      throw erro;
    }
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

  function instalarCapturaCliqueEmissao() {
    coletarDocumentosMesmoDominio(window).forEach(documento => {
      const janela = documento.defaultView;
      if (!janela) return;

      const handlerAnterior = janela.__systextilSegundaViaEmissaoHandler;
      if (handlerAnterior) {
        documento.removeEventListener("click", handlerAnterior, true);
      }

      const handler = function (evento) {
        let elemento = evento.target;

        while (elemento && elemento !== documento) {
          if (
            elemento.id === "BTNEmetirBoletos." ||
            elemento.name === "CMDEmetirBoletos"
          ) {
            try {
              const solicitacao = salvarSolicitacaoEmissao(documento);
              const aviso = document.getElementById(PANEL_ID + "-emissao-status");

              if (aviso) {
                aviso.textContent =
                  "Horário da solicitação registrado: " +
                  new Date(solicitacao.solicitadoEm).toLocaleTimeString("pt-BR") +
                  ". Agora abra Processos agendados.";
                aviso.style.color = "#166534";
              }
            } catch (erro) {
              const aviso = document.getElementById(PANEL_ID + "-emissao-status");
              if (aviso) {
                aviso.textContent = erro.message;
                aviso.style.color = "#b91c1c";
              }
            }
            return;
          }

          elemento = elemento.parentElement;
        }
      };

      documento.addEventListener("click", handler, true);
      janela.__systextilSegundaViaEmissaoHandler = handler;
    });
  }

  function ehTelaProcessosAgendados() {
    try {
      localizarFormularioProcessos();
      return true;
    } catch (_) {
      return false;
    }
  }

  function formatarDataHoraLocal(timestamp) {
    return new Date(timestamp).toLocaleString("pt-BR");
  }

  function renderizarResultadoProcessos(container, resultado) {
    container.replaceChildren();

    const cores = {
      sucesso: "#166534",
      "em-andamento": "#92400e",
      falha: "#b91c1c",
      ambiguo: "#b91c1c",
      "nao-verificavel": "#b91c1c",
      "nao-encontrado": "#475569",
      "sem-solicitacao": "#b91c1c",
      "solicitacao-expirada": "#b91c1c"
    };

    const status = criarElemento("p", resultado.mensagem);
    status.style.margin = "0";
    status.style.color = cores[resultado.status] || "#334155";
    status.style.fontWeight = "600";
    container.append(status);

    if (resultado.registro) {
      const detalhes = [
        "Linha visual: " + resultado.registro.visualIndex,
        "Registro: " + resultado.registro.recordNumber,
        "Execução: " + resultado.registro.dataExecucao
      ];

      detalhes.forEach(texto => {
        const detalhe = criarElemento("p", texto);
        detalhe.style.margin = "6px 0 0";
        detalhe.style.color = "#334155";
        container.append(detalhe);
      });

      const limite = criarElemento(
        "p",
        "A emissão continua manual. O PDF só será solicitado após a confirmação e o clique explícito em Baixar PDF identificado."
      );
      limite.style.margin = "9px 0 0";
      limite.style.padding = "8px";
      limite.style.background = "#f1f5f9";
      limite.style.borderRadius = "5px";
      container.append(limite);
    }
  }

  function montarPainelProcessos() {
    if (!document.body || document.getElementById(PANEL_ID)) return;

    const painel = criarElemento("section");
    painel.id = PANEL_ID;
    painel.dataset.scriptVersion = VERSION;

    Object.assign(painel.style, {
      position: "fixed",
      right: "18px",
      bottom: "18px",
      zIndex: "2147483000",
      width: "390px",
      maxWidth: "calc(100vw - 36px)",
      maxHeight: "80vh",
      overflowY: "auto",
      boxSizing: "border-box",
      padding: "14px",
      border: "1px solid #cbd5e1",
      borderRadius: "8px",
      background: "#ffffff",
      color: "#172033",
      boxShadow: "0 8px 28px rgba(15, 23, 42, 0.20)",
      font: "13px/1.45 Arial, sans-serif"
    });

    const titulo = criarElemento("strong", "Segunda via — Processos agendados");
    titulo.style.display = "block";
    titulo.style.fontSize = "14px";
    titulo.style.marginBottom = "8px";

    const explicacao = criarElemento(
      "p",
      "Analisa a emissão registrada nesta sessão. O PDF só será baixado depois da identificação única e de um clique explícito."
    );
    explicacao.style.margin = "0 0 10px";
    explicacao.style.color = "#475569";

    const solicitacao = recuperarSolicitacaoEmissao();
    const resumo = criarElemento(
      "p",
      solicitacao
        ? "Título: " + solicitacao.titulo + " · Parcela: " + solicitacao.parcela +
          "\nSolicitado em: " + formatarDataHoraLocal(Number(solicitacao.solicitadoEm))
        : "Nenhuma solicitação registrada. Volte à Consulta de títulos, ative o painel e clique manualmente em Emite boleto."
    );
    resumo.style.margin = "0 0 10px";
    resumo.style.padding = "8px";
    resumo.style.background = "#f1f5f9";
    resumo.style.borderRadius = "5px";
    resumo.style.whiteSpace = "pre-line";

    const grupoCliente = criarElemento("label");
    Object.assign(grupoCliente.style, {
      display: "grid",
      gap: "4px",
      margin: "0 0 10px",
      color: "#334155",
      fontWeight: "600"
    });
    const rotuloCliente = criarElemento("span", "Razão social para o nome do PDF");
    rotuloCliente.style.fontSize = "12px";
    const entradaCliente = document.createElement("input");
    entradaCliente.type = "text";
    entradaCliente.value = String(solicitacao?.cliente ?? "");
    entradaCliente.autocomplete = "off";
    entradaCliente.maxLength = 160;
    Object.assign(entradaCliente.style, {
      width: "100%",
      boxSizing: "border-box",
      border: "1px solid #cbd5e1",
      borderRadius: "5px",
      padding: "8px",
      color: "#172033",
      background: "#ffffff",
      font: "13px Arial, sans-serif"
    });
    grupoCliente.append(rotuloCliente, entradaCliente);

    const botaoAnalisar = criarElemento("button", "Analisar processos");
    botaoAnalisar.type = "button";
    Object.assign(botaoAnalisar.style, {
      width: "100%",
      border: "0",
      borderRadius: "5px",
      padding: "9px 12px",
      background: "#1d4ed8",
      color: "#ffffff",
      fontWeight: "600",
      cursor: "pointer"
    });

    const resultado = criarElemento("div");
    resultado.style.marginTop = "10px";
    resultado.setAttribute("aria-live", "polite");

    const botaoBaixar = criarElemento("button", "Baixar PDF do processo identificado");
    botaoBaixar.type = "button";
    botaoBaixar.disabled = true;
    Object.assign(botaoBaixar.style, {
      width: "100%",
      border: "0",
      borderRadius: "5px",
      padding: "9px 12px",
      marginTop: "10px",
      background: "#0f766e",
      color: "#ffffff",
      fontWeight: "600",
      cursor: "not-allowed",
      opacity: "0.55"
    });

    const statusDownload = criarElemento(
      "p",
      "O download ainda não foi solicitado."
    );
    statusDownload.style.margin = "8px 0 0";
    statusDownload.style.color = "#475569";
    statusDownload.setAttribute("aria-live", "polite");

    const botaoLiberarDownload = criarElemento(
      "button",
      "Já conferi a pasta; liberar nova tentativa"
    );
    botaoLiberarDownload.type = "button";
    Object.assign(botaoLiberarDownload.style, {
      display: "none",
      width: "100%",
      marginTop: "8px",
      border: "1px solid #d97706",
      borderRadius: "5px",
      padding: "8px 10px",
      background: "#fffbeb",
      color: "#92400e",
      fontWeight: "600",
      cursor: "pointer"
    });

    const botaoLimpar = criarElemento("button", "Limpar solicitação registrada");
    botaoLimpar.type = "button";
    Object.assign(botaoLimpar.style, {
      marginTop: "10px",
      border: "1px solid #cbd5e1",
      borderRadius: "5px",
      padding: "7px 10px",
      background: "#ffffff",
      color: "#334155",
      cursor: "pointer"
    });

    const fechar = criarElemento("button", "Fechar");
    Object.assign(fechar.style, {
      marginTop: "10px",
      marginLeft: "6px",
      border: "1px solid #cbd5e1",
      borderRadius: "5px",
      padding: "7px 10px",
      background: "#ffffff",
      color: "#334155",
      cursor: "pointer"
    });

    let ultimaAnalise = null;
    let downloadEmAndamento = false;
    let downloadIndeterminado = null;

    function atualizarBotaoDownload() {
      const habilitado =
        !downloadEmAndamento &&
        !downloadIndeterminado &&
        ultimaAnalise?.status === "sucesso" &&
        Boolean(String(entradaCliente.value ?? "").trim());

      botaoBaixar.disabled = !habilitado;
      botaoBaixar.style.cursor = habilitado ? "pointer" : "not-allowed";
      botaoBaixar.style.opacity = habilitado ? "1" : "0.55";
    }

    entradaCliente.addEventListener("input", atualizarBotaoDownload);

    botaoLiberarDownload.addEventListener("click", function () {
      if (!downloadIndeterminado?.persistido) return;

      const confirmado = window.confirm(
        "Você conferiu manualmente a pasta de destino e confirmou que o PDF desta tentativa NÃO foi salvo? " +
        "Somente confirme se tiver certeza. Uma nova tentativa poderá gerar um arquivo adicional."
      );
      if (!confirmado) return;

      try {
        liberarDownloadIndeterminado(
          downloadIndeterminado.armazenamento,
          downloadIndeterminado.chave
        );
        downloadIndeterminado = null;
        botaoLiberarDownload.style.display = "none";
        ultimaAnalise = null;
        statusDownload.textContent =
          "Reserva liberada após sua confirmação. Analise novamente o processo antes de solicitar outro download.";
        statusDownload.style.color = "#475569";
        atualizarBotaoDownload();
      } catch (erro) {
        statusDownload.textContent = erro.message;
        statusDownload.style.color = "#b91c1c";
      }
    });

    botaoAnalisar.addEventListener("click", function () {
      try {
        const pedidoAtual = recuperarSolicitacaoEmissao();
        const registros = lerRegistrosProcessos();
        const analise = analisarProcessos(registros, pedidoAtual, Date.now());
        ultimaAnalise = analise;
        renderizarResultadoProcessos(resultado, analise);
        atualizarBotaoDownload();
      } catch (erro) {
        ultimaAnalise = { status: "nao-verificavel" };
        renderizarResultadoProcessos(resultado, {
          status: "nao-verificavel",
          mensagem: erro.message
        });
        atualizarBotaoDownload();
      }
    });

    botaoBaixar.addEventListener("click", function () {
      if (downloadEmAndamento) return;

      let armazenamento = null;
      let chaveDownload = null;
      let reservaCriada = false;

      try {
        botaoBaixar.disabled = true;
        downloadEmAndamento = true;
        atualizarBotaoDownload();
        statusDownload.textContent = "Conferindo a emissão, selecionando o registro e preparando o PDF...";

        const pedidoAtual = recuperarSolicitacaoEmissao();
        const nomeArquivo = montarNomeArquivo({
          cliente: entradaCliente.value,
          titulo: pedidoAtual?.titulo,
          parcela: pedidoAtual?.parcela
        });

        const registrosAtuais = lerRegistrosProcessos();
        const analiseAtual = analisarProcessos(registrosAtuais, pedidoAtual, Date.now());

        if (analiseAtual.status !== "sucesso" || !analiseAtual.registro) {
          throw new Error(
            analiseAtual.mensagem ||
            "O processo não está mais confirmado como concluído. Analise novamente."
          );
        }

        if (
          ultimaAnalise?.status !== "sucesso" ||
          !mesmoRegistroProcesso(analiseAtual.registro, ultimaAnalise.registro)
        ) {
          ultimaAnalise = analiseAtual;
          renderizarResultadoProcessos(resultado, analiseAtual);
          throw new Error("O resultado mudou desde a última análise. Confira a linha e clique novamente em Baixar PDF.");
        }

        const localizado = localizarFormularioProcessos();
        const janelaPagina = localizarJanelaPagina(localizado.documento);
        const preparado = prepararUrlDownloadProcesso(
          analiseAtual.registro,
          janelaPagina,
          janelaPagina.location.href,
          lerRegistrosProcessos
        );

        armazenamento = janelaPagina.sessionStorage;
        chaveDownload = montarChaveDownload(pedidoAtual, analiseAtual.registro);
        reservarDownload(armazenamento, chaveDownload, Date.now());
        reservaCriada = true;

        iniciarDownloadPdf(preparado.url, nomeArquivo, {
          onload() {
            let avisoConclusao =
              "Download concluído: " + nomeArquivo +
              ". O arquivo foi enviado para a pasta padrão de downloads do Chrome.";

            try {
              concluirDownload(armazenamento, chaveDownload, Date.now());
            } catch (_) {
              avisoConclusao += " Atenção: não foi possível gravar a proteção contra duplicidade; não clique novamente.";
            }

            downloadEmAndamento = false;
            statusDownload.textContent = avisoConclusao;
            statusDownload.style.color = "#166534";
            atualizarBotaoDownload();
          },
          onerror(erro) {
            liberarDownload(armazenamento, chaveDownload);
            downloadEmAndamento = false;
            const detalhe = erro?.error || erro?.details || erro?.message || "erro não detalhado";
            statusDownload.textContent =
              "Download não concluído (" + String(detalhe) +
              "). A falha foi reportada pelo navegador; confira a pasta antes de uma nova tentativa.";
            statusDownload.style.color = "#b91c1c";
            atualizarBotaoDownload();
          },
          ontimeout(erro) {
            downloadEmAndamento = false;
            try {
              marcarDownloadIndeterminado(armazenamento, chaveDownload, Date.now());
              downloadIndeterminado = {
                armazenamento,
                chave: chaveDownload,
                persistido: true
              };
              botaoLiberarDownload.style.display = "block";
              statusDownload.textContent =
                "Resultado indeterminado: o navegador excedeu o tempo de espera e não confirmou se o PDF foi salvo. " +
                "A proteção contra duplicidade foi mantida. Confira a pasta de destino antes de liberar uma nova tentativa.";
            } catch (falhaEstado) {
              downloadIndeterminado = {
                armazenamento,
                chave: chaveDownload,
                persistido: false
              };
              statusDownload.textContent =
                "O download excedeu o tempo de espera. Não foi possível atualizar o estado da reserva (" +
                falhaEstado.message +
                "). A tentativa permanece bloqueada nesta tela; não solicite outro download.";
            }
            statusDownload.style.color = "#92400e";
            atualizarBotaoDownload();
          }
        });
      } catch (erro) {
        downloadEmAndamento = false;

        if (erro?.code === "DOWNLOAD_INDETERMINADO" && armazenamento && chaveDownload) {
          downloadIndeterminado = {
            armazenamento,
            chave: chaveDownload,
            persistido: true
          };
          botaoLiberarDownload.style.display = "block";
          statusDownload.style.color = "#92400e";
        } else {
          if (reservaCriada) liberarDownload(armazenamento, chaveDownload);
          statusDownload.style.color = "#b91c1c";
        }

        statusDownload.textContent = erro.message;
        atualizarBotaoDownload();
      }
    });

    botaoLimpar.addEventListener("click", function () {
      limparSolicitacaoEmissao();
      resumo.textContent = "Solicitação local removida. Para uma nova análise, registre outra emissão na tela Consulta de títulos.";
      entradaCliente.value = "";
      ultimaAnalise = null;
      resultado.replaceChildren();
      statusDownload.textContent = "Solicitação removida.";
      atualizarBotaoDownload();
    });

    fechar.addEventListener("click", function () {
      painel.remove();
      window.__systextilSegundaViaBoletoLoaded = false;
    });

    painel.append(
      titulo,
      explicacao,
      resumo,
      grupoCliente,
      botaoAnalisar,
      resultado,
      botaoBaixar,
      statusDownload,
      botaoLiberarDownload,
      botaoLimpar,
      fechar
    );
    document.body.append(painel);
  }

  function criarElemento(tag, texto, classe) {
    const elemento = document.createElement(tag);

    if (texto !== undefined) {
      elemento.textContent = texto;
    }

    if (classe) {
      elemento.className = classe;
    }

    return elemento;
  }

  function ehTelaConsultaTitulo() {
    return Array.from(document.forms).some(form =>
      Object.values(CAMPOS).every(nome => {
        const campo = form.elements.namedItem(nome);
        return campo && typeof campo.value === "string";
      })
    );
  }

  function montarPainel() {
    if (
      !document.body ||
      document.getElementById(PANEL_ID) ||
      !ehTelaConsultaTitulo()
    ) {
      return;
    }

    const painel = criarElemento("section");
    painel.id = PANEL_ID;
    painel.dataset.scriptVersion = VERSION;

    Object.assign(painel.style, {
      position: "fixed",
      right: "18px",
      bottom: "18px",
      zIndex: "2147483000",
      width: "340px",
      maxWidth: "calc(100vw - 36px)",
      boxSizing: "border-box",
      padding: "14px",
      border: "1px solid #cbd5e1",
      borderRadius: "8px",
      background: "#ffffff",
      color: "#172033",
      boxShadow: "0 8px 28px rgba(15, 23, 42, 0.20)",
      font: "13px/1.45 Arial, sans-serif"
    });

    const titulo = criarElemento("strong", "Segunda via — conferência");
    titulo.style.display = "block";
    titulo.style.fontSize = "14px";
    titulo.style.marginBottom = "8px";

    const explicacao = criarElemento(
      "p",
      "Informe o número do título e a parcela para preparar os campos da consulta."
    );
    explicacao.style.margin = "0 0 10px";
    explicacao.style.color = "#475569";

    const alerta = criarElemento(
      "p",
      "A sequência ainda precisa ser confirmada como parcela. Confira os valores no ERP antes de pressionar F7."
    );
    alerta.style.margin = "0 0 8px";
    alerta.style.padding = "8px";
    alerta.style.background = "#f1f5f9";
    alerta.style.borderRadius = "5px";

    const dicaAtalho = criarElemento(
      "p",
      "Atalho nesta aba: Ctrl + Alt + B"
    );
    dicaAtalho.style.margin = "0 0 10px";
    dicaAtalho.style.color = "#475569";
    dicaAtalho.style.fontSize = "11px";

    const statusEmissao = criarElemento(
      "p",
      "Mantenha este userscript ativo antes de clicar em Emite boleto para registrar o horário da solicitação."
    );
    statusEmissao.id = PANEL_ID + "-emissao-status";
    statusEmissao.style.margin = "0 0 10px";
    statusEmissao.style.padding = "8px";
    statusEmissao.style.background = "#f1f5f9";
    statusEmissao.style.borderRadius = "5px";
    statusEmissao.style.color = "#475569";

    const grupoEntradas = criarElemento("div");
    Object.assign(grupoEntradas.style, {
      display: "grid",
      gap: "8px",
      margin: "0 0 10px"
    });

    function criarCampoConsulta(rotulo, id, placeholder) {
      const grupo = criarElemento("label");
      Object.assign(grupo.style, {
        display: "grid",
        gap: "4px",
        color: "#334155",
        fontWeight: "600"
      });

      const legenda = criarElemento("span", rotulo);
      legenda.style.fontSize = "12px";

      const campo = document.createElement("input");
      campo.type = "text";
      campo.id = id;
      campo.placeholder = placeholder;
      campo.autocomplete = "off";
      campo.spellcheck = false;
      campo.inputMode = "numeric";
      Object.assign(campo.style, {
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid #cbd5e1",
        borderRadius: "5px",
        padding: "8px",
        color: "#172033",
        background: "#ffffff",
        font: "13px Arial, sans-serif"
      });

      grupo.append(legenda, campo);
      grupoEntradas.append(grupo);
      return campo;
    }

    const entradaTitulo = criarCampoConsulta(
      "Número do título",
      "st-segunda-via-numero-titulo",
      "Informe o número do título"
    );
    const entradaParcela = criarCampoConsulta(
      "Parcela / sequência",
      "st-segunda-via-parcela",
      "Informe a parcela"
    );

    const botaoPreencher = criarElemento("button", "Preencher campos no Systextil");
    botaoPreencher.type = "button";
    Object.assign(botaoPreencher.style, {
      width: "100%",
      border: "0",
      borderRadius: "5px",
      padding: "9px 12px",
      background: "#0f766e",
      color: "#ffffff",
      fontWeight: "600",
      cursor: "pointer",
      marginBottom: "8px"
    });

    const botao = criarElemento("button", "Ler dados do título (após F7)");
    botao.type = "button";
    Object.assign(botao.style, {
      width: "100%",
      border: "0",
      borderRadius: "5px",
      padding: "9px 12px",
      background: "#1d4ed8",
      color: "#ffffff",
      fontWeight: "600",
      cursor: "pointer"
    });

    const resultado = criarElemento("div");
    resultado.style.marginTop = "10px";
    resultado.setAttribute("aria-live", "polite");

    const fechar = criarElemento("button", "Fechar");
    Object.assign(fechar.style, {
      marginTop: "10px",
      border: "1px solid #cbd5e1",
      borderRadius: "5px",
      padding: "6px 10px",
      background: "#ffffff",
      color: "#334155",
      cursor: "pointer"
    });

    botaoPreencher.addEventListener("click", async function () {
      if (botaoPreencher.disabled) return;

      resultado.replaceChildren();
      botaoPreencher.disabled = true;
      botaoPreencher.textContent = "Aguardando confirmação do Systextil...";
      botaoPreencher.style.cursor = "wait";
      botaoPreencher.style.opacity = "0.65";
      entradaTitulo.disabled = true;
      entradaParcela.disabled = true;

      const andamento = criarElemento(
        "p",
        "Confirmando o título e a parcela, um campo de cada vez. Não interaja com os campos do ERP durante esta etapa."
      );
      andamento.style.color = "#475569";
      andamento.style.margin = "0";
      resultado.append(andamento);

      try {
        const preenchidos = await preencherCamposConsulta({
          titulo: entradaTitulo.value,
          parcela: entradaParcela.value
        });

        resultado.replaceChildren();

        const status = criarElemento(
          "p",
          "Título e parcela confirmados pelos comandos NXJ do Systextil. Confira os valores na tela e pressione F7 manualmente. Nenhuma consulta foi enviada."
        );
        status.style.color = "#166534";
        status.style.margin = "0";
        resultado.append(status);

        const detalhe = criarElemento(
          "p",
          "Título: " + preenchidos.titulo + " · Parcela/sequência: " + preenchidos.parcela
        );
        detalhe.style.margin = "7px 0 0";
        detalhe.style.overflowWrap = "anywhere";
        resultado.append(detalhe);
      } catch (erro) {
        resultado.replaceChildren();
        const status = criarElemento("p", erro.message);
        status.style.color = "#b91c1c";
        status.style.margin = "0";
        resultado.append(status);
      } finally {
        botaoPreencher.disabled = false;
        botaoPreencher.textContent = "Preencher campos no Systextil";
        botaoPreencher.style.cursor = "pointer";
        botaoPreencher.style.opacity = "1";
        entradaTitulo.disabled = false;
        entradaParcela.disabled = false;
      }
    });

    botao.addEventListener("click", function () {
      resultado.replaceChildren();

      try {
        const leitura = lerDadosTitulo();
        const dados = leitura.dados;

        const linhas = [
          ["Número do título", dados.titulo],
          ["Sequência/parcela", dados.parcela],
          ["Início da razão social", limitarInicioRazaoSocial(dados.cliente)],
          ["Nome previsto do PDF", leitura.nomeArquivo]
        ];

        const tabela = document.createElement("dl");
        Object.assign(tabela.style, {
          margin: "0",
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: "6px"
        });

        linhas.forEach(([rotulo, valor]) => {
          const grupo = document.createElement("div");
          const dt = criarElemento("dt", rotulo);
          const dd = criarElemento("dd", valor);

          Object.assign(dt.style, {
            color: "#64748b",
            fontSize: "11px",
            fontWeight: "600"
          });

          Object.assign(dd.style, {
            margin: "1px 0 0",
            overflowWrap: "anywhere",
            fontWeight: "500"
          });

          grupo.append(dt, dd);
          tabela.append(grupo);
        });

        resultado.append(tabela);

        const status = criarElemento(
          "p",
          "Leitura concluída. Nenhuma nova ação foi executada no ERP."
        );
        status.style.color = "#166534";
        status.style.margin = "9px 0 0";
        resultado.append(status);
      } catch (erro) {
        resultado.append(
          criarElemento("p", erro.message)
        );
        resultado.lastElementChild.style.color = "#b91c1c";
      }
    });

    fechar.addEventListener("click", function () {
      painel.remove();
      window.__systextilSegundaViaBoletoLoaded = false;
    });

    painel.append(
      titulo,
      explicacao,
      alerta,
      dicaAtalho,
      statusEmissao,
      grupoEntradas,
      botaoPreencher,
      botao,
      resultado,
      fechar
    );
    document.body.append(painel);
  }

  // API local de diagnóstico: funções de leitura e validação; ações de seleção/download exigem clique explícito.
  window.__systextilSegundaViaBoletoDebug = Object.freeze({
    version: VERSION,
    fieldNames: CAMPOS,
    sanitizarParteNome,
    montarNomeArquivo,
    limitarInicioRazaoSocial,
    lerDadosTitulo,
    validarCodigoConsulta,
    normalizarCodigoConsulta,
    preservarCodigoConsulta,
    obterLarguraCampo,
    preencherCamposConsulta,
    normalizarTextoProcesso,
    interpretarDataHoraProcesso,
    nomeCampoProcesso,
    analisarProcessos,
    validarUrlPdf,
    obterControladorGrade,
    mesmoRegistroProcesso,
    selecionarRegistroProcesso,
    obterUrlPdfSelecionado,
    obterRelatorioSelecionado,
    prepararUrlDownloadProcesso,
    montarChaveDownload,
    reservarDownload,
    concluirDownload,
    marcarDownloadIndeterminado,
    liberarDownload,
    liberarDownloadIndeterminado,
    iniciarDownloadPdf
  });

  function ehTelaSuportada() {
    return ehTelaConsultaTitulo() || ehTelaProcessosAgendados();
  }

  function alternarPainel() {
    const telaConsulta = ehTelaConsultaTitulo();
    const telaProcessos = !telaConsulta && ehTelaProcessosAgendados();

    if (!telaConsulta && !telaProcessos) {
      console.warn(
        "[Systextil Segunda Via] Abra Consulta de títulos ou Processos agendados antes de executar o painel."
      );
      return;
    }

    if (telaConsulta) instalarCapturaCliqueEmissao();

    const painelExistente = document.getElementById(PANEL_ID);

    if (painelExistente) {
      painelExistente.remove();
      window.__systextilSegundaViaBoletoLoaded = false;
      return;
    }

    window.__systextilSegundaViaBoletoLoaded = true;

    if (telaConsulta) {
      montarPainel();
    } else {
      montarPainelProcessos();
    }
  }

  // O popup do Tampermonkey injeta esta rotina na aba ativa sem reload.
  // O script reconhece Consulta de títulos e Processos agendados.
  if (!ehTelaSuportada()) {
    console.warn(
      "[Systextil Segunda Via] Abra Consulta de títulos ou Processos agendados antes de executar este atalho."
    );
    return;
  }

  if (ehTelaConsultaTitulo()) {
    instalarCapturaCliqueEmissao();
  }

  // Listener no window permite substituir em memória listeners antigos
  // que versões anteriores registraram diretamente no document.
  if (window.__systextilSegundaViaBoletoShortcutVersion !== VERSION) {
    window.addEventListener("keydown", function (event) {
      const atalho =
        event.ctrlKey &&
        event.altKey &&
        !event.shiftKey &&
        String(event.key || "").toLowerCase() === "b";

      if (!atalho || event.repeat) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      alternarPainel();
    }, true);

    window.__systextilSegundaViaBoletoShortcutVersion = VERSION;
  }

  // Ao executar uma versão nova pelo popup, substitui o painel antigo
  // na própria aba sem exigir recarga da página.
  const painelAtual = document.getElementById(PANEL_ID);

  if (painelAtual && painelAtual.dataset.scriptVersion !== VERSION) {
    painelAtual.remove();
    window.__systextilSegundaViaBoletoLoaded = false;
  }

  // Reavalia a tela atual para montar o painel correto, inclusive em
  // Processos agendados após atualizar uma versão antiga já aberta.
  alternarPainel();
})();
