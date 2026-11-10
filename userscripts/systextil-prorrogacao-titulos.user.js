// ==UserScript==
// @name         Systextil — Prorrogação de Títulos
// @namespace    https://github.com/IsaacTexCotton/Systextil-envio-mensagem
// @version      0.1.6
// @description  Prorroga títulos em lote com confirmação NXJ, gravação sequencial e releitura.
// @match        https://systextil.texcotton.com.br/systextil/*
// @match        http://systextil.texcotton.com.br/systextil/*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-prorrogacao-titulos.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-prorrogacao-titulos.user.js
// ==/UserScript==

(function () {
  "use strict";

  const API = criarApi();

  if (typeof module === "object" && module.exports) {
    module.exports = API;
    return;
  }

  API.iniciar();
})();

function criarApi() {
  "use strict";

  const VERSION = "0.1.6";
  const VISAO_CONSULTA = "forms.crec.crec_f090";
  const VISAO_HISTORICO = "forms.crec.crec_f030";
  const VISAO_PARCELAS = "forms.crec.crec_f035";
  const ENDPOINT_NXJ = /(?:^|\/)UnifyNXJ\.jsp(?:[?#]|$)/i;
  const SILENCIO_NXJ_MS = 300;
  const TIMEOUT_NXJ_MS = 20000;
  const TIMEOUT_VISAO_MS = 25000;
  const CODIGO_MOTIVO_PRORROGACAO = "01";
  const MAX_HISTORICO = 60;
  const MAX_ITENS_LOTE = 100;
  const ATRASO_FOCO_MS = 500;
  const ATRASO_BORDA_MS = 800;
  let interfaceInstalada = false;
  let loteEmExecucao = false;
  let modoTesteAtivo = false;

  function normalizarEspacos(valor) {
    return String(valor ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizarCodigoComparacao(valor) {
    const codigo = String(valor ?? "").trim();
    if (!codigo) return "";
    if (/^\d+$/.test(codigo)) return codigo.replace(/^0+/, "") || "0";
    return codigo.toUpperCase();
  }

  function validarCodigo(valor, rotulo, limite) {
    const codigo = String(valor ?? "").trim();
    if (!codigo) throw new Error(rotulo + " não informado.");
    if (!/^[A-Za-z0-9_-]+$/.test(codigo)) {
      throw new Error(rotulo + " contém caracteres inválidos.");
    }
    if (codigo.length > limite) {
      throw new Error(rotulo + " excede o limite de " + limite + " caracteres.");
    }
    return codigo;
  }

  function normalizarData(valor) {
    const data = String(valor ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return data.slice(8, 10) + "/" + data.slice(5, 7) + "/" + data.slice(0, 4);
    }
    return data;
  }

  function validarData(valor) {
    const data = normalizarData(valor);
    const correspondencia = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data);
    if (!correspondencia) {
      throw new Error("Data inválida. Use DD/MM/AAAA.");
    }

    const dia = Number(correspondencia[1]);
    const mes = Number(correspondencia[2]);
    const ano = Number(correspondencia[3]);
    const objeto = new Date(ano, mes - 1, dia);

    if (
      objeto.getFullYear() !== ano ||
      objeto.getMonth() !== mes - 1 ||
      objeto.getDate() !== dia
    ) {
      throw new Error("A data " + data + " não existe no calendário.");
    }

    return data;
  }

  function formatarDataLocal(dataAtual) {
    const data = dataAtual === undefined ? new Date() : dataAtual;
    if (!(data instanceof Date) || Number.isNaN(data.getTime())) {
      throw new Error("Não foi possível determinar a data atual do Compl.hist.");
    }

    const dia = String(data.getDate()).padStart(2, "0");
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const ano = String(data.getFullYear());
    return dia + "/" + mes + "/" + ano;
  }

  function validarSigla(valor, rotulo, obrigatoria) {
    const sigla = normalizarEspacos(valor).toUpperCase();
    if (!sigla && !obrigatoria) return "";
    if (!sigla) throw new Error(rotulo + " não informado.");
    if (!/^[A-Z0-9]{1,8}$/.test(sigla)) {
      throw new Error(rotulo + " deve conter de 1 a 8 letras ou números, sem espaços.");
    }
    return sigla;
  }

  function montarComplementoHistorico(configuracao) {
    const data = formatarDataLocal(configuracao?.dataAtual);
    const motivo = normalizarEspacos(configuracao?.motivo);
    const autorizacao = validarSigla(configuracao?.autorizacao, "Sigla da autorização", false);
    const executor = validarSigla(configuracao?.executor, "Sigla do executor", true);

    const partes = [data];
    if (motivo) partes.push(motivo);
    partes.push("PRORROG");
    if (autorizacao) partes.push("AUT " + autorizacao);
    partes.push(executor);

    const texto = partes.join(" - ");
    if (texto.length > MAX_HISTORICO || Array.from(texto).length > MAX_HISTORICO) {
      throw new Error(
        "Compl.hist excede 60 caracteres (" + Array.from(texto).length +
        "). Reduza o motivo ou as siglas; o texto não será truncado."
      );
    }
    return texto;
  }

  function analisarLote(texto, dataComum, configuracao, dataAtual = new Date()) {
    const linhas = String(texto ?? "")
      .split(/\r?\n/)
      .map((linha, indice) => ({ texto: linha.trim(), numero: indice + 1 }))
      .filter(item => item.texto && !item.texto.startsWith("#"));

    if (!linhas.length) throw new Error("Informe ao menos um título.");
    if (linhas.length > MAX_ITENS_LOTE) {
      throw new Error("O lote excede o limite de " + MAX_ITENS_LOTE + " títulos.");
    }

    const dataPadrao = dataComum ? validarData(dataComum) : "";
    const resultado = [];
    const identificadores = new Set();

    for (const linha of linhas) {
      const partes = linha.texto.split(";").map(parte => parte.trim());
      if (partes.length < 2 || partes.length > 3) {
        throw new Error(
          "Linha " + linha.numero + ": use TITULO;PARCELA ou TITULO;PARCELA;DD/MM/AAAA."
        );
      }

      const titulo = validarCodigo(partes[0], "Título da linha " + linha.numero, 9);
      const parcela = validarCodigo(partes[1], "Parcela da linha " + linha.numero, 2);
      const data = partes[2] ? validarData(partes[2]) : dataPadrao;

      if (!data) {
        throw new Error(
          "Linha " + linha.numero + ": informe uma data na linha ou uma data comum para o lote."
        );
      }

      const chave = normalizarCodigoComparacao(titulo) + "|" +
        normalizarCodigoComparacao(parcela);
      if (identificadores.has(chave)) {
        throw new Error("Título/parcela repetido na linha " + linha.numero + ".");
      }
      identificadores.add(chave);

      const historico = montarComplementoHistorico({
        dataAtual,
        motivo: configuracao?.motivo,
        autorizacao: configuracao?.autorizacao,
        executor: configuracao?.executor
      });

      resultado.push(Object.freeze({ titulo, parcela, data, historico }));
    }

    return resultado;
  }

  function selecionarLinhaPorParcela(linhas, parcelaEsperada) {
    const alvo = normalizarCodigoComparacao(parcelaEsperada);
    const correspondencias = (Array.isArray(linhas) ? linhas : []).filter(linha =>
      normalizarCodigoComparacao(linha?.sequencia) === alvo
    );

    if (!alvo || correspondencias.length !== 1) {
      throw new Error(
        correspondencias.length === 0
          ? "A parcela solicitada não foi encontrada na grade de títulos."
          : "A parcela aparece mais de uma vez na grade. A seleção foi bloqueada."
      );
    }

    return correspondencias[0];
  }

  function criarErroIndeterminado(mensagem, codigo) {
    const erro = new Error(mensagem);
    erro.indeterminado = true;
    erro.code = codigo || "GRAVACAO_INDETERMINADA";
    return erro;
  }

  function obterJanelaPagina() {
    const pagina = typeof unsafeWindow !== "undefined" && unsafeWindow
      ? unsafeWindow
      : window;

    if (!pagina?.document || !pagina?.XMLHttpRequest) {
      throw new Error("Abra uma tela do Systextil no documento principal.");
    }
    return pagina;
  }

  function pausa(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function obterEstado(pagina) {
    const visao = pagina?.curDataView;
    if (!visao) return null;
    return {
      visao: String(visao.name ?? ""),
      busca: Boolean(visao.find),
      acao: String(visao.recordAction ?? ""),
      total: Number.parseInt(visao.recordCount, 10) || 0,
      linhas: Number.parseInt(visao.nrows, 10) || 0,
      atual: Number.parseInt(visao.currentRow, 10) || 0
    };
  }

  function exigirVisao(pagina, esperada) {
    const estado = obterEstado(pagina);
    if (estado?.visao !== esperada) {
      throw new Error(
        "Visão inesperada. Esperada: " + esperada +
        "; atual: " + (estado?.visao || "não identificada") + "."
      );
    }
    return estado;
  }

  async function aguardarVisao(pagina, esperada, limiteMs) {
    const inicio = Date.now();
    while (Date.now() - inicio < (limiteMs || TIMEOUT_VISAO_MS)) {
      if (obterEstado(pagina)?.visao === esperada) return obterEstado(pagina);
      await pausa(100);
    }
    throw new Error("O Systextil não abriu a tela esperada: " + esperada + ".");
  }

  function coletarJanelasMesmoDominio(janelaRaiz) {
    const janelas = [];
    const janelasVisitadas = new Set();

    function visitar(janelaAtual) {
      if (!janelaAtual || janelasVisitadas.has(janelaAtual)) return;
      janelasVisitadas.add(janelaAtual);

      try {
        if (!janelaAtual.document) return;
        janelas.push(janelaAtual);
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
          // Frames de outra origem não são acessados.
        }
      }
    }

    visitar(janelaRaiz);
    return janelas;
  }

  function coletarDocumentosMesmoDominio(janelaRaiz) {
    return coletarJanelasMesmoDominio(janelaRaiz)
      .map(janela => janela.document);
  }

  function encontrarElementoPorId(documentos, id) {
    const encontrados = [];
    const vistos = new Set();

    for (const documento of Array.isArray(documentos) ? documentos : []) {
      const elemento = documento?.getElementById?.(id);
      if (elemento && !vistos.has(elemento)) {
        vistos.add(elemento);
        encontrados.push(elemento);
      }
    }

    if (encontrados.length !== 1) {
      throw new Error(
        encontrados.length === 0
          ? "Controle não encontrado nos documentos acessíveis: " + id + "."
          : "Controle duplicado entre documentos acessíveis: " + id + "."
      );
    }

    return encontrados[0];
  }

  function localizarElementoPorId(pagina, id) {
    return encontrarElementoPorId(
      coletarDocumentosMesmoDominio(pagina),
      id
    );
  }

  function localizarControlePorNomeOuId(pagina, nome, id) {
    const encontrados = [];
    const vistos = new Set();

    for (const documento of coletarDocumentosMesmoDominio(pagina)) {
      if (nome) {
        for (const elemento of Array.from(documento.getElementsByName?.(nome) || [])) {
          if (elemento && !vistos.has(elemento)) {
            vistos.add(elemento);
            encontrados.push(elemento);
          }
        }
      }

      if (id) {
        const elemento = documento.getElementById?.(id);
        if (elemento && !vistos.has(elemento)) {
          vistos.add(elemento);
          encontrados.push(elemento);
        }
      }
    }

    if (encontrados.length !== 1 || typeof encontrados[0]?.click !== "function") {
      throw new Error(
        encontrados.length === 0
          ? "Controle de navegação não encontrado nos documentos acessíveis: " + (nome || id) + "."
          : "Controle de navegação ambíguo entre documentos acessíveis: " + (nome || id) + "."
      );
    }

    return encontrados[0];
  }

  function obterCampo(pagina, nome, configuracao) {
    const opcoes = configuracao || {};
    const encontrados = Array.from(pagina.document.getElementsByName(nome) || [])
      .filter(campo => campo && typeof campo.value === "string");

    if (encontrados.length !== 1) {
      throw new Error(
        encontrados.length === 0
          ? "Campo não encontrado: " + nome
          : "Campo duplicado no documento: " + nome
      );
    }

    const campo = encontrados[0];
    if (opcoes.editavel && (campo.disabled || campo.readOnly)) {
      throw new Error("O campo " + nome + " não está editável.");
    }
    return campo;
  }

  function obterValor(pagina, nome) {
    return String(obterCampo(pagina, nome).value ?? "").trim();
  }

  // HTMLInputElement.maxLength retorna -1 quando o atributo maxlength não existe.
  // Nessas telas usamos os limites confirmados pela sonda; limites positivos
  // declarados no próprio campo sempre prevalecem.
  function obterLimiteCampo(maxLength, limiteConfirmado) {
    const declarado = Number(maxLength);
    return Number.isInteger(declarado) && declarado >= 0
      ? declarado
      : limiteConfirmado;
  }

  function atribuirValor(campo, valor, pagina) {
    const prototipo = pagina.HTMLInputElement?.prototype;
    const setter = prototipo
      ? Object.getOwnPropertyDescriptor(prototipo, "value")?.set
      : null;

    if (typeof setter === "function") setter.call(campo, valor);
    else campo.value = valor;

    campo.dispatchEvent(new pagina.Event("input", { bubbles: true }));
    campo.dispatchEvent(new pagina.Event("change", { bubbles: true }));

    if (String(campo.value ?? "").trim() !== String(valor)) {
      throw new Error("O navegador não manteve o valor inserido em " + campo.name + ".");
    }
  }

  function valorConfere(segmentos, esperado) {
    const alvo = normalizarCodigoComparacao(esperado);
    if (!alvo) return false;

    return (Array.isArray(segmentos) ? segmentos : []).some(segmento => {
      const valor = String(segmento ?? "").trim();
      if (!valor) return false;
      const final = valor.split(/[=:]/).pop().trim();
      return normalizarCodigoComparacao(valor) === alvo ||
        normalizarCodigoComparacao(final) === alvo;
    });
  }

  function valoresNaoConfirmados(registroGravacao, valoresEsperados, confirmacoesCampo) {
    const confirmacoesValidas = Array.isArray(confirmacoesCampo)
      ? confirmacoesCampo
      : [];

    return (valoresEsperados || []).filter(valor => {
      if (valorConfere(registroGravacao?.segmentos, valor)) return false;

      // Alguns comandos NXJ transportam o valor pendente ao sair do campo.
      // O ADD_UPDATE pode não repetir esse valor no próprio fieldValues.
      return !confirmacoesValidas.some(confirmacao =>
        confirmacao?.valor === String(valor) &&
        ["CLICKONFIELD", "NEXT_FIELD"].includes(confirmacao.comando) &&
        confirmacao.finalizado === true &&
        confirmacao.falhaMonitoramento !== true &&
        confirmacao.status >= 200 &&
        confirmacao.status < 300 &&
        valorConfere(confirmacao.segmentos, valor)
      );
    });
  }

  function criarMonitorNxj(pagina) {
    const janelas = coletarJanelasMesmoDominio(pagina);
    const metadados = new WeakMap();
    const requisicoes = [];
    const estado = { sequencia: 0, pendentes: 0, ultimaConclusao: Date.now() };
    const instalacoes = [];
    const prototiposInstalados = new Set();

    function extrairComando(body, janela) {
      try {
        if (body && typeof body.get === "function") {
          return {
            comando: String(body.get("commandName") ?? "").trim().toUpperCase(),
            segmentos: (typeof body.getAll === "function"
              ? body.getAll("fieldValues")
              : [body.get("fieldValues")])
              .flatMap(valor => String(valor ?? "").split("\f"))
          };
        }
        if (typeof body !== "string") return { comando: "", segmentos: [] };

        const Parametros = janela.URLSearchParams || URLSearchParams;
        const parametros = new Parametros(body);
        return {
          comando: String(parametros.get("commandName") ?? "").trim().toUpperCase(),
          segmentos: parametros.getAll("fieldValues")
            .flatMap(valor => String(valor ?? "").split("\f"))
        };
      } catch (_) {
        return { comando: "", segmentos: [] };
      }
    }

    function criarInterceptadores(janela, prototipo, descritorOpen, descritorSend) {
      const openOriginal = descritorOpen.value;
      const sendOriginal = descritorSend.value;

      function openInterceptado(metodo, url) {
        metadados.set(this, {
          metodo: String(metodo ?? "GET").toUpperCase(),
          monitorar: ENDPOINT_NXJ.test(String(url ?? ""))
        });
        return openOriginal.apply(this, arguments);
      }

      function sendInterceptado(body) {
        const info = metadados.get(this);
        if (!info?.monitorar) return sendOriginal.apply(this, arguments);

        const dados = info.metodo === "POST"
          ? extrairComando(body, janela)
          : { comando: "", segmentos: [] };
        const registro = {
          sequencia: ++estado.sequencia,
          metodo: info.metodo,
          comando: dados.comando,
          segmentos: dados.segmentos.filter(segmento => String(segmento).trim() !== ""),
          status: 0,
          finalizado: false,
          falhaMonitoramento: false
        };
        requisicoes.push(registro);

        let finalizado = false;
        estado.pendentes += 1;

        const finalizar = () => {
          if (finalizado) return;
          finalizado = true;
          registro.finalizado = true;
          try {
            registro.status = Number(this.status) || 0;
          } catch (_) {
            registro.status = 0;
          }
          estado.pendentes = Math.max(0, estado.pendentes - 1);
          estado.ultimaConclusao = Date.now();
        };

        try {
          this.addEventListener("loadend", finalizar, { once: true });
        } catch (_) {
          registro.falhaMonitoramento = true;
          estado.pendentes = Math.max(0, estado.pendentes - 1);
          registro.finalizado = true;
        }

        try {
          return sendOriginal.apply(this, arguments);
        } catch (erro) {
          finalizar();
          throw erro;
        }
      }

      return {
        prototipo,
        descritorOpen,
        descritorSend,
        openWrapper: openInterceptado,
        sendWrapper: sendInterceptado
      };
    }

    try {
      for (const janela of janelas) {
        const prototipo = janela.XMLHttpRequest?.prototype;
        if (!prototipo || prototiposInstalados.has(prototipo)) continue;
        prototiposInstalados.add(prototipo);

        const descritorOpen = Object.getOwnPropertyDescriptor(prototipo, "open");
        const descritorSend = Object.getOwnPropertyDescriptor(prototipo, "send");

        if (
          !descritorOpen || typeof descritorOpen.value !== "function" || !descritorOpen.writable ||
          !descritorSend || typeof descritorSend.value !== "function" || !descritorSend.writable
        ) {
          throw new Error(
            "Não foi possível monitorar o protocolo NXJ em todos os frames acessíveis. Nenhum registro foi alterado."
          );
        }

        const instalacao = criarInterceptadores(
          janela,
          prototipo,
          descritorOpen,
          descritorSend
        );

        instalacoes.push(instalacao);
        Object.defineProperty(prototipo, "open", {
          ...descritorOpen,
          value: instalacao.openWrapper
        });
        Object.defineProperty(prototipo, "send", {
          ...descritorSend,
          value: instalacao.sendWrapper
        });
      }

      if (!instalacoes.length) {
        throw new Error("Nenhum contexto XMLHttpRequest foi encontrado para monitorar o NXJ.");
      }
    } catch (erro) {
      for (const instalacao of instalacoes.reverse()) {
        try {
          if (instalacao.prototipo.open === instalacao.openWrapper) {
            Object.defineProperty(instalacao.prototipo, "open", instalacao.descritorOpen);
          }
          if (instalacao.prototipo.send === instalacao.sendWrapper) {
            Object.defineProperty(instalacao.prototipo, "send", instalacao.descritorSend);
          }
        } catch (_) {
          // Mantém a falha original; restauração adicional é best effort.
        }
      }
      throw erro;
    }

    async function aguardarOcioso(limiteMs) {
      const limite = limiteMs || TIMEOUT_NXJ_MS;
      const inicio = Date.now();

      while (Date.now() - inicio < limite) {
        if (
          estado.pendentes === 0 &&
          Date.now() - estado.ultimaConclusao >= SILENCIO_NXJ_MS
        ) {
          return;
        }
        await pausa(60);
      }

      throw new Error("O protocolo NXJ não ficou ocioso dentro do tempo esperado.");
    }

    async function aguardarComando(comando, sequenciaInicial, limiteMs) {
      const alvo = String(comando).toUpperCase();
      const inicio = Date.now();
      while (Date.now() - inicio < (limiteMs || TIMEOUT_NXJ_MS)) {
        const encontrados = requisicoes.filter(item =>
          item.sequencia > sequenciaInicial &&
          item.metodo === "POST" &&
          item.comando === alvo
        );

        if (encontrados.length) {
          await aguardarOcioso(limiteMs);
          const finais = requisicoes.filter(item =>
            item.sequencia > sequenciaInicial &&
            item.metodo === "POST" &&
            item.comando === alvo
          );

          if (finais.length !== 1) {
            throw criarErroIndeterminado(
              "O comando " + alvo + " apareceu " + finais.length +
              " vezes. A automação não repetirá a operação.",
              "COMANDO_DUPLICADO"
            );
          }

          const registro = finais[0];
          if (!registro.finalizado || registro.falhaMonitoramento) {
            throw criarErroIndeterminado(
              "Não foi possível acompanhar a conclusão do comando " + alvo + ".",
              "COMANDO_SEM_CONFIRMACAO"
            );
          }
          if (registro.status < 200 || registro.status >= 300) {
            throw criarErroIndeterminado(
              "O comando " + alvo + " terminou com HTTP " + registro.status +
              ". Confira o registro no ERP antes de qualquer nova tentativa.",
              "COMANDO_HTTP_FALHOU"
            );
          }
          return registro;
        }
        await pausa(60);
      }

      throw criarErroIndeterminado(
        "O Systextil não confirmou o comando " + alvo +
        " dentro do tempo esperado. Não repita a gravação.",
        "COMANDO_TIMEOUT"
      );
    }

    async function aguardarConfirmacaoCampo(valor, sequenciaInicial, limiteMs) {
      const inicio = Date.now();
      while (Date.now() - inicio < (limiteMs || TIMEOUT_NXJ_MS)) {
        await aguardarOcioso(limiteMs);
        const confirmada = requisicoes.find(item =>
          item.sequencia > sequenciaInicial &&
          item.metodo === "POST" &&
          ["CLICKONFIELD", "NEXT_FIELD"].includes(item.comando) &&
          item.finalizado &&
          !item.falhaMonitoramento &&
          item.status >= 200 &&
          item.status < 300 &&
          valorConfere(item.segmentos, valor)
        );
        if (confirmada) {
          return Object.freeze({
            valor: String(valor),
            comando: confirmada.comando,
            sequencia: confirmada.sequencia,
            finalizado: confirmada.finalizado,
            falhaMonitoramento: confirmada.falhaMonitoramento,
            status: confirmada.status,
            segmentos: Object.freeze(confirmada.segmentos.slice())
          });
        }
        await pausa(60);
      }
      return false;
    }

    function obterResumo(sequenciaInicial, valorEsperado) {
      return requisicoes
        .filter(item =>
          item.sequencia > sequenciaInicial &&
          item.metodo === "POST"
        )
        .slice(-8)
        .map(item => {
          const tamanhos = item.segmentos.map(segmento => String(segmento).length).join(",");
          const status = item.finalizado ? "HTTP " + item.status : "pendente";
          const corresponde = valorEsperado === undefined
            ? ""
            : ";valor=" + (valorConfere(item.segmentos, valorEsperado) ? "sim" : "não");
          return (item.comando || "SEM_COMANDO") + "[" + item.segmentos.length +
            (tamanhos ? ":" + tamanhos : "") + "];" + status + corresponde;
        })
        .join(" | ") || "nenhum POST NXJ observado";
    }

    return {
      obterSequencia: () => estado.sequencia,
      aguardarOcioso,
      aguardarComando,
      aguardarConfirmacaoCampo,
      obterResumo,
      remover() {
        for (const instalacao of instalacoes) {
          if (instalacao.prototipo.open === instalacao.openWrapper) {
            Object.defineProperty(instalacao.prototipo, "open", instalacao.descritorOpen);
          }
          if (instalacao.prototipo.send === instalacao.sendWrapper) {
            Object.defineProperty(instalacao.prototipo, "send", instalacao.descritorSend);
          }
        }
      }
    };
  }
  async function focarCampo(campo, pagina, monitor) {
    if (!campo || typeof campo.focus !== "function") {
      throw new Error("O campo não permite receber foco.");
    }
    campo.focus();
    await pausa(ATRASO_FOCO_MS);
    await monitor.aguardarOcioso();
    return campo;
  }

  async function preencherConsulta(pagina, monitor, item) {
    exigirVisao(pagina, VISAO_CONSULTA);

    let campoTitulo = obterCampo(pagina, "num_duplicata.", { editavel: true });
    let campoParcela = obterCampo(pagina, "seq_duplicatas.", { editavel: true });

    const limiteTitulo = obterLimiteCampo(campoTitulo.maxLength, 9);
    const limiteParcela = obterLimiteCampo(campoParcela.maxLength, 2);

    if (item.titulo.length > limiteTitulo) {
      throw new Error(
        "O título possui " + item.titulo.length + " caracteres, mas o campo num_duplicata. " +
        "aceita até " + limiteTitulo + ". O limite foi conferido sem remover dígitos."
      );
    }
    if (item.parcela.length > limiteParcela) {
      throw new Error(
        "A parcela possui " + item.parcela.length + " caracteres, mas o campo seq_duplicatas. " +
        "aceita até " + limiteParcela + "."
      );
    }

    const sequenciaTitulo = monitor.obterSequencia();
    await focarCampo(campoTitulo, pagina, monitor);
    campoTitulo = obterCampo(pagina, "num_duplicata.", { editavel: true });
    atribuirValor(campoTitulo, item.titulo, pagina);
    await pausa(ATRASO_FOCO_MS);

    campoParcela = obterCampo(pagina, "seq_duplicatas.", { editavel: true });
    await focarCampo(campoParcela, pagina, monitor);
    if (String(obterCampo(pagina, "num_duplicata.").value ?? "").trim() &&
        normalizarCodigoComparacao(obterValor(pagina, "num_duplicata.")) !==
        normalizarCodigoComparacao(item.titulo)) {
      throw new Error("O Systextil alterou o título antes de concluir a consulta.");
    }

    if (!await monitor.aguardarConfirmacaoCampo(item.titulo, sequenciaTitulo)) {
      throw new Error("O NXJ não confirmou o número do título. A consulta foi bloqueada.");
    }

    const sequenciaParcela = monitor.obterSequencia();
    campoParcela = obterCampo(pagina, "seq_duplicatas.", { editavel: true });
    atribuirValor(campoParcela, item.parcela, pagina);
    await pausa(ATRASO_FOCO_MS);

    campoTitulo = obterCampo(pagina, "num_duplicata.", { editavel: true });
    await focarCampo(campoTitulo, pagina, monitor);

    if (!await monitor.aguardarConfirmacaoCampo(item.parcela, sequenciaParcela)) {
      throw new Error("O NXJ não confirmou a parcela. A consulta foi bloqueada.");
    }

    if (
      normalizarCodigoComparacao(obterValor(pagina, "seq_duplicatas.")) !==
      normalizarCodigoComparacao(item.parcela)
    ) {
      throw new Error("A parcela visível diverge da parcela solicitada.");
    }
  }

  async function prepararModoConsulta(pagina, monitor) {
    exigirVisao(pagina, VISAO_CONSULTA);
    const estado = obterEstado(pagina);
    const titulo = String(pagina.document.getElementsByName("num_duplicata.")?.[0]?.value ?? "").trim();
    const parcela = String(pagina.document.getElementsByName("seq_duplicatas.")?.[0]?.value ?? "").trim();

    if (!estado.busca || titulo || parcela) {
      const botaoLimpar = localizarElementoPorId(pagina, "btnClearToFind.");

      const antes = monitor.obterSequencia();
      botaoLimpar.click();
      await monitor.aguardarComando("CLEAR_TO_FIND", antes);
      await monitor.aguardarOcioso();
      await aguardarCondicao(() => {
        const atual = obterEstado(pagina);
        const t = String(pagina.document.getElementsByName("num_duplicata.")?.[0]?.value ?? "").trim();
        const p = String(pagina.document.getElementsByName("seq_duplicatas.")?.[0]?.value ?? "").trim();
        return atual?.busca === true && !t && !p;
      }, 5000, "A Consulta não foi limpa corretamente.");
    }

    if (obterEstado(pagina)?.busca !== true) {
      throw new Error("A tela não está em modo de consulta.");
    }
  }

  async function aguardarCondicao(condicao, limiteMs, mensagem) {
    const inicio = Date.now();
    while (Date.now() - inicio < limiteMs) {
      if (condicao()) return true;
      await pausa(80);
    }
    throw new Error(mensagem);
  }

  async function consultarTitulo(pagina, monitor, item) {
    await prepararModoConsulta(pagina, monitor);
    await preencherConsulta(pagina, monitor, item);

    const estadoAntes = obterEstado(pagina);
    if (!estadoAntes?.busca) {
      throw new Error("A tela deixou o modo de consulta antes do Find.");
    }

    const botaoFind = localizarElementoPorId(pagina, "btnFind.");

    const sequenciaFind = monitor.obterSequencia();
    botaoFind.click();
    await monitor.aguardarComando("FIND", sequenciaFind);
    await monitor.aguardarOcioso();

    await aguardarCondicao(() => {
      const atual = obterEstado(pagina);
      return atual &&
        atual.busca === false &&
        ["RECORDS_FOUND", "NO_RECORDS"].includes(atual.acao);
    }, TIMEOUT_NXJ_MS, "O Systextil não concluiu a consulta.");

    const resultado = obterEstado(pagina);
    if (resultado.acao !== "RECORDS_FOUND" || resultado.total !== 1) {
      throw new Error(
        resultado.total > 1
          ? "A consulta retornou mais de um registro. A automação exige correspondência única."
          : "Nenhum título foi encontrado para o número e a parcela informados."
      );
    }

    const titulo = obterValor(pagina, "num_duplicata.");
    const parcela = obterValor(pagina, "seq_duplicatas.");
    if (
      normalizarCodigoComparacao(titulo) !== normalizarCodigoComparacao(item.titulo) ||
      normalizarCodigoComparacao(parcela) !== normalizarCodigoComparacao(item.parcela)
    ) {
      throw new Error("O registro retornado não corresponde exatamente ao título e à parcela solicitados.");
    }

    return resultado;
  }

  async function clicarControle(pagina, nome, id, comandoEsperado, visaoEsperada, monitor) {
    const controle = localizarControlePorNomeOuId(pagina, nome, id);

    const sequencia = monitor.obterSequencia();
    controle.click();
    await monitor.aguardarComando(comandoEsperado, sequencia);
    await monitor.aguardarOcioso();
    await aguardarVisao(pagina, visaoEsperada);
  }

  function obterCodigoTecla(tecla) {
    const codigos = { F1: 112, F2: 113, F9: 120, Tab: 9 };
    const codigo = codigos[tecla];
    if (!codigo) throw new Error("Atalho de teclado não autorizado: " + tecla + ".");
    return codigo;
  }

  function dispararTecla(pagina, tecla, alvoPreferencial) {
    const codigo = obterCodigoTecla(tecla);
    const alvo = alvoPreferencial ||
      (pagina.document.activeElement &&
      pagina.document.activeElement !== pagina.document.body
        ? pagina.document.activeElement
        : pagina.document);
    if (!alvo || typeof alvo.dispatchEvent !== "function") {
      throw new Error("Não foi possível enviar a tecla " + tecla + " ao campo ativo.");
    }

    const evento = new pagina.KeyboardEvent("keydown", {
      key: tecla,
      code: tecla,
      keyCode: codigo,
      which: codigo,
      bubbles: true,
      cancelable: true
    });
    alvo.dispatchEvent(evento);
  }

  async function navegarTecla(pagina, monitor, tecla, comando, visaoAtual, visaoDestino) {
    exigirVisao(pagina, visaoAtual);
    const sequencia = monitor.obterSequencia();
    dispararTecla(pagina, tecla);
    await monitor.aguardarComando(comando, sequencia);
    await monitor.aguardarOcioso();
    await aguardarVisao(pagina, visaoDestino);
  }

  async function focarEGravarCampo(pagina, monitor, nomeCampo, valor, nomeProximoCampo) {
    let campo = obterCampo(pagina, nomeCampo, { editavel: true });
    campo = await focarCampo(campo, pagina, monitor);
    campo = obterCampo(pagina, nomeCampo, { editavel: true });

    if (valor.length > Number(campo.maxLength || valor.length)) {
      throw new Error("O valor excede o limite do campo " + nomeCampo + ".");
    }

    const sequenciaAntes = monitor.obterSequencia();
    atribuirValor(campo, valor, pagina);
    await pausa(ATRASO_FOCO_MS);

    // A saída por Tab é um caminho NXJ observado para transportar o valor
    // pendente. Em seguida, o próximo controle é ativado caso o evento
    // sintético não tenha movido o foco por conta própria.
    dispararTecla(pagina, "Tab", campo);
    await pausa(ATRASO_FOCO_MS);

    const proximo = obterCampo(pagina, nomeProximoCampo);
    if (pagina.document.activeElement !== proximo) {
      await focarCampo(proximo, pagina, monitor);
    } else {
      await monitor.aguardarOcioso();
    }

    const confirmacao = await monitor.aguardarConfirmacaoCampo(valor, sequenciaAntes);
    if (!confirmacao) {
      throw new Error(
        "O NXJ não confirmou o conteúdo do campo " + nomeCampo +
        ". Diagnóstico NXJ: " + monitor.obterResumo(sequenciaAntes, valor) + "."
      );
    }

    const atual = obterCampo(pagina, nomeCampo);
    if (String(atual.value ?? "").trim() !== valor) {
      throw new Error("O campo " + nomeCampo + " mudou durante a confirmação.");
    }

    return confirmacao;
  }

  function exigirF9Permitido(modoTeste) {
    if (modoTeste) {
      throw new Error("Bloqueio de segurança: o modo de teste não permite executar F9.");
    }
    return true;
  }

  function validarQuantidadeItensModoTeste(modoTeste, quantidade) {
    if (modoTeste && quantidade !== 1) {
      throw new Error(
        "O modo de teste aceita somente um título/parcela por execução."
      );
    }
    return true;
  }

  async function salvarUmaVez(
    pagina,
    monitor,
    visao,
    valoresEsperados,
    confirmacoesCampo
  ) {
    exigirF9Permitido(modoTesteAtivo);
    exigirVisao(pagina, visao);
    const estadoAnterior = obterEstado(pagina);
    const sequencia = monitor.obterSequencia();

    // Uma única tecla F9. Qualquer timeout após este ponto é indeterminado;
    // não há repetição automática de gravação.
    dispararTecla(pagina, "F9");

    let registro;
    try {
      registro = await monitor.aguardarComando("ADD_UPDATE", sequencia);
    } catch (erro) {
      throw criarErroIndeterminado(
        "A gravação em " + visao + " não pôde ser confirmada. Não pressione F9 novamente. " +
        erro.message,
        erro.code || "GRAVACAO_SEM_CONFIRMACAO"
      );
    }

    const faltantes = valoresNaoConfirmados(
      registro,
      valoresEsperados,
      confirmacoesCampo
    );
    if (faltantes.length) {
      throw criarErroIndeterminado(
        "O F9 respondeu, mas o payload NXJ não confirmou todos os valores esperados. " +
        "Não repita a gravação; confira a tela no ERP.",
        "PAYLOAD_GRAVACAO_DIVERGENTE"
      );
    }

    try {
      await aguardarCondicao(
        () => obterEstado(pagina)?.acao === "UPDATED",
        TIMEOUT_NXJ_MS,
        "A tela não confirmou o estado UPDATED após a gravação."
      );
    } catch (erro) {
      throw criarErroIndeterminado(
        "O comando ADD_UPDATE respondeu, mas a tela não confirmou UPDATED. " +
        "Não repita o F9. " + erro.message,
        "ESTADO_UPDATED_AUSENTE"
      );
    }

    const estadoFinal = obterEstado(pagina);
    if (estadoAnterior?.acao === "UPDATED" && estadoFinal?.acao === "UPDATED") {
      // O comando NXJ e o payload já foram confirmados; a releitura posterior
      // ainda será exigida antes de iniciar o próximo item.
    }

    return registro;
  }

  function localizarLinhaParcela(pagina, parcela) {
    const campos = Array.from(pagina.document.querySelectorAll('input[name]'));
    const sequencias = [];

    for (const campo of campos) {
      const correspondencia = /^seq_duplicatas\.(\d+)$/.exec(String(campo.name ?? ""));
      if (!correspondencia) continue;
      sequencias.push({
        indice: Number(correspondencia[1]),
        sequencia: String(campo.value ?? "").trim()
      });
    }

    const selecionada = selecionarLinhaPorParcela(sequencias, parcela);
    const sufixo = "." + selecionada.indice;
    const data = obterCampo(pagina, "data_prorrogacao" + sufixo, { editavel: true });
    const motivo = obterCampo(pagina, "nr_mtv_prorrogacao" + sufixo, { editavel: true });
    const sequencia = obterCampo(pagina, "seq_duplicatas" + sufixo);

    if (data.disabled || motivo.disabled || sequencia.disabled) {
      throw new Error("A linha da parcela está desabilitada para edição.");
    }

    return { indice: selecionada.indice, sequencia, data, motivo };
  }

  async function gravarHistorico(pagina, monitor, item) {
    exigirVisao(pagina, VISAO_HISTORICO);

    const titulo = obterValor(pagina, "num_duplicata.");
    const parcela = obterValor(pagina, "seq_duplicatas.");
    if (
      normalizarCodigoComparacao(titulo) !== normalizarCodigoComparacao(item.titulo) ||
      normalizarCodigoComparacao(parcela) !== normalizarCodigoComparacao(item.parcela)
    ) {
      throw new Error("A tela de histórico não corresponde ao título/parcela consultados.");
    }

    const historico = obterCampo(pagina, "compl_historico.", { editavel: true });
    if (Number(historico.maxLength) !== MAX_HISTORICO) {
      throw new Error("O limite do Compl.hist não corresponde aos 60 caracteres esperados.");
    }

    const confirmacaoHistorico = await focarEGravarCampo(
      pagina,
      monitor,
      "compl_historico.",
      item.historico,
      "seq_duplicatas."
    );

    if (modoTesteAtivo) {
      return {
        modoTeste: true,
        campoConfirmado: true,
        f9Executado: false
      };
    }

    await salvarUmaVez(
      pagina,
      monitor,
      VISAO_HISTORICO,
      [item.historico],
      [confirmacaoHistorico]
    );
    return { modoTeste: false, campoConfirmado: true, f9Executado: true };
  }

  async function gravarProrrogacao(pagina, monitor, item) {
    exigirVisao(pagina, VISAO_PARCELAS);
    const linha = localizarLinhaParcela(pagina, item.parcela);

    const confirmacaoData = await focarEGravarCampo(
      pagina,
      monitor,
      "data_prorrogacao." + linha.indice,
      item.data,
      "nr_mtv_prorrogacao." + linha.indice
    );

    const confirmacaoMotivo = await focarEGravarCampo(
      pagina,
      monitor,
      "nr_mtv_prorrogacao." + linha.indice,
      CODIGO_MOTIVO_PRORROGACAO,
      "seq_duplicatas." + linha.indice
    );

    await salvarUmaVez(
      pagina,
      monitor,
      VISAO_PARCELAS,
      [item.data, CODIGO_MOTIVO_PRORROGACAO],
      [confirmacaoData, confirmacaoMotivo]
    );
  }

  async function retornarConsulta(pagina, monitor) {
    await navegarTecla(
      pagina, monitor, "F1", "PREVIOUS_FORM", VISAO_PARCELAS, VISAO_HISTORICO
    );
    await navegarTecla(
      pagina, monitor, "F1", "PREVIOUS_FORM", VISAO_HISTORICO, VISAO_CONSULTA
    );
  }

  async function relerEConferir(pagina, monitor, item) {
    await consultarTitulo(pagina, monitor, item);

    const dataGravada = obterValor(pagina, "data_prorrogacao.");
    const historicoGravado = obterValor(pagina, "compl_historico.");

    if (dataGravada !== item.data) {
      throw criarErroIndeterminado(
        "O título foi salvo, mas a releitura na Consulta não confirmou a data de prorrogação. " +
        "Valor esperado: " + item.data + ". Confira o ERP antes de continuar o lote.",
        "RELEITURA_DATA_DIVERGENTE"
      );
    }

    if (historicoGravado !== item.historico) {
      throw criarErroIndeterminado(
        "O título foi salvo, mas a releitura na Consulta não confirmou o Compl.hist. " +
        "Confira o ERP antes de continuar o lote.",
        "RELEITURA_HISTORICO_DIVERGENTE"
      );
    }
  }

  async function executarItem(pagina, monitor, item, callbacks) {
    let historicoSalvo = false;
    let prorrogacaoSalva = false;

    try {
      callbacks?.status?.("Consultando título " + item.titulo + " / parcela " + item.parcela + ".");
      await consultarTitulo(pagina, monitor, item);

      callbacks?.status?.("Abrindo manutenção do título.");
      await clicarControle(
        pagina, "cmdBtnTitulos", "Button111.",
        "CMDBTNTITULOS", VISAO_HISTORICO, monitor
      );

      callbacks?.status?.(
        modoTesteAtivo
          ? "Modo de teste: preenchendo e validando Compl.hist. sem gravar."
          : "Gravando Compl.hist."
      );
      const resultadoHistorico = await gravarHistorico(pagina, monitor, item);

      if (resultadoHistorico.modoTeste) {
        callbacks?.status?.(
          "Teste concluído: Compl.hist foi preenchido e confirmado pelo NXJ. " +
          "F9 não foi enviado; a execução parou antes da primeira gravação."
        );
        return {
          ok: true,
          modoTeste: true,
          historicoSalvo: false,
          prorrogacaoSalva: false,
          verificado: false,
          f9Executado: false
        };
      }

      historicoSalvo = true;

      callbacks?.status?.("Abrindo grade de parcelas.");
      await navegarTecla(
        pagina, monitor, "F2", "CMDNEXTFORM", VISAO_HISTORICO, VISAO_PARCELAS
      );

      callbacks?.status?.("Gravando data e motivo da prorrogação.");
      await gravarProrrogacao(pagina, monitor, item);
      prorrogacaoSalva = true;

      callbacks?.status?.("Retornando à Consulta para releitura.");
      await retornarConsulta(pagina, monitor);
      await relerEConferir(pagina, monitor, item);

      return { ok: true, historicoSalvo, prorrogacaoSalva, verificado: true };
    } catch (erro) {
      erro.historicoSalvo = historicoSalvo;
      erro.prorrogacaoSalva = prorrogacaoSalva;
      if (historicoSalvo || prorrogacaoSalva) erro.parcial = true;
      throw erro;
    }
  }

  function criarInterface(pagina) {
    if (interfaceInstalada || pagina.document.getElementById("st-prorrogacao-lote")) return;
    interfaceInstalada = true;

    const doc = pagina.document;
    const painel = doc.createElement("section");
    painel.id = "st-prorrogacao-lote";
    painel.innerHTML =
      '<div class="stp-cabecalho"><strong>Prorrogar títulos</strong><button type="button" class="stp-fechar" aria-label="Recolher painel">−</button></div>' +
      '<div class="stp-conteudo">' +
        '<label class="stp-label" for="stp-itens">Títulos e parcelas</label>' +
        '<textarea id="stp-itens" rows="5" spellcheck="false" placeholder="00012345;03&#10;00012346;01;15/11/2026"></textarea>' +
        '<div class="stp-ajuda">Uma linha por título: TITULO;PARCELA. A data informada na linha é a data da prorrogação; o Compl.hist usa automaticamente a data atual.</div>' +
        '<label class="stp-label" for="stp-data">Data da prorrogação comum (quando não houver data na linha)</label>' +
        '<input id="stp-data" type="date" />' +
        '<label class="stp-label" for="stp-motivo">Motivo (opcional)</label>' +
        '<input id="stp-motivo" type="text" maxlength="100" placeholder="Ex.: PEDIDO CLIENTE" />' +
        '<div class="stp-dupla">' +
          '<div><label class="stp-label" for="stp-aut">Autorização (sigla, opcional)</label><input id="stp-aut" type="text" maxlength="8" placeholder="Ex.: GISELA" /></div>' +
          '<div><label class="stp-label" for="stp-executor">Executor (sigla)</label><input id="stp-executor" type="text" maxlength="8" placeholder="Sua sigla" /></div>' +
        '</div>' +
        '<label class="stp-modo-teste"><input id="stp-modo-teste" type="checkbox" /> <span><strong>Modo de teste — não executar F9</strong><small>Testa um único título até confirmar o Compl.hist e para antes de salvar. Não testa a grade de parcelas.</small></span></label>' +
        '<div class="stp-acoes"><button type="button" id="stp-validar">Validar lote</button><button type="button" id="stp-iniciar" disabled>Iniciar lote</button></div>' +
        '<label class="stp-consentimento"><input id="stp-confirmar" type="checkbox" /> Revisei os títulos, parcelas, datas e o histórico.</label>' +
        '<div id="stp-status" role="status" aria-live="polite">Aguardando validação.</div>' +
        '<ol id="stp-resultados"></ol>' +
      '</div>';

    const estilo = doc.createElement("style");
    estilo.textContent =
      "#st-prorrogacao-lote{position:fixed;right:18px;bottom:18px;width:410px;max-width:calc(100vw - 36px);max-height:82vh;overflow:hidden;background:#fff;color:#182433;border:1px solid #d7dee8;border-radius:10px;box-shadow:0 8px 32px rgba(20,35,55,.22);z-index:2147483000;font:13px/1.45 Arial,sans-serif}" +
      "#st-prorrogacao-lote *{box-sizing:border-box}" +
      "#st-prorrogacao-lote .stp-cabecalho{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:#eef4fb;border-bottom:1px solid #d7dee8}" +
      "#st-prorrogacao-lote .stp-cabecalho strong{font-size:14px}" +
      "#st-prorrogacao-lote .stp-fechar{border:0;background:transparent;font-size:20px;cursor:pointer;color:#334155}" +
      "#st-prorrogacao-lote .stp-conteudo{padding:12px 14px;overflow:auto;max-height:calc(82vh - 42px)}" +
      "#st-prorrogacao-lote .stp-label{display:block;margin:8px 0 4px;font-weight:600}" +
      "#st-prorrogacao-lote input[type=text],#st-prorrogacao-lote input[type=date],#st-prorrogacao-lote textarea{display:block;width:100%;border:1px solid #cbd5e1;border-radius:6px;padding:8px;font:13px Arial,sans-serif;color:#172033;background:#fff}" +
      "#st-prorrogacao-lote textarea{resize:vertical;min-height:86px;line-height:1.5}" +
      "#st-prorrogacao-lote input:focus,#st-prorrogacao-lote textarea:focus{outline:2px solid #93c5fd;border-color:#3b82f6}" +
      "#st-prorrogacao-lote .stp-ajuda{font-size:11px;color:#64748b;margin-top:4px}" +
      "#st-prorrogacao-lote .stp-dupla{display:grid;grid-template-columns:1fr 1fr;gap:9px}" +
      "#st-prorrogacao-lote .stp-acoes{display:flex;gap:8px;margin-top:12px}" +
      "#st-prorrogacao-lote button{border-radius:6px;padding:8px 11px;border:1px solid #cbd5e1;background:#f8fafc;color:#1e293b;font-weight:600;cursor:pointer}" +
      "#st-prorrogacao-lote #stp-iniciar{background:#1d4ed8;border-color:#1d4ed8;color:#fff;flex:1}" +
      "#st-prorrogacao-lote button:disabled{opacity:.45;cursor:not-allowed}" +
      "#st-prorrogacao-lote .stp-modo-teste{display:flex;gap:8px;align-items:flex-start;margin-top:12px;padding:9px;border:1px solid #d97706;border-radius:6px;background:#fffbeb;color:#78350f;font-size:11px}" +
      "#st-prorrogacao-lote .stp-modo-teste input{margin:2px 0 0;flex:0 0 auto}" +
      "#st-prorrogacao-lote .stp-modo-teste span{display:flex;flex-direction:column;gap:3px}" +
      "#st-prorrogacao-lote .stp-modo-teste small{font-size:10px;line-height:1.4;color:#92400e}" +
      "#st-prorrogacao-lote .stp-consentimento{display:flex;gap:7px;align-items:flex-start;margin-top:10px;font-size:11px;color:#475569}" +
      "#st-prorrogacao-lote #stp-status{margin-top:10px;padding:8px;background:#f1f5f9;border-radius:6px;color:#334155;white-space:pre-wrap}" +
      "#st-prorrogacao-lote #stp-resultados{margin:8px 0 0;padding-left:20px;max-height:150px;overflow:auto;font-size:11px}" +
      "#st-prorrogacao-lote.stp-recolhido .stp-conteudo{display:none}";

    doc.head.appendChild(estilo);
    doc.body.appendChild(painel);

    const buscar = seletor => painel.querySelector(seletor);
    const campoItens = buscar("#stp-itens");
    const campoData = buscar("#stp-data");
    const campoMotivo = buscar("#stp-motivo");
    const campoAut = buscar("#stp-aut");
    const campoExecutor = buscar("#stp-executor");
    const campoConfirmacao = buscar("#stp-confirmar");
    const campoModoTeste = buscar("#stp-modo-teste");
    const botaoValidar = buscar("#stp-validar");
    const botaoIniciar = buscar("#stp-iniciar");
    const status = buscar("#stp-status");
    const resultados = buscar("#stp-resultados");

    let loteValidado = null;

    function obterConfiguracao() {
      return {
        motivo: campoMotivo.value,
        autorizacao: campoAut.value,
        executor: campoExecutor.value
      };
    }

    function obterLote() {
      return analisarLote(campoItens.value, campoData.value, obterConfiguracao());
    }

    function limparValidacao() {
      loteValidado = null;
      botaoIniciar.disabled = true;
      campoConfirmacao.checked = false;
    }

    function mostrarStatus(texto, erro) {
      status.textContent = texto;
      status.style.background = erro ? "#fef2f2" : "#f1f5f9";
      status.style.color = erro ? "#991b1b" : "#334155";
    }

    function renderizarResultados(itens) {
      resultados.replaceChildren();
      for (const item of itens) {
        const linha = doc.createElement("li");
        linha.textContent = item.titulo + " / " + item.parcela + " — " +
          item.data + " — " + item.historico + " (" + item.historico.length + "/60)";
        resultados.appendChild(linha);
      }
    }

    botaoValidar.addEventListener("click", () => {
      try {
        loteValidado = obterLote();
        renderizarResultados(loteValidado);
        botaoIniciar.disabled = !campoConfirmacao.checked;
        mostrarStatus(
          loteValidado.length + " item(ns) válido(s). Confira o histórico e marque a confirmação."
        );
      } catch (erro) {
        limparValidacao();
        renderizarResultados([]);
        mostrarStatus(erro.message, true);
      }
    });

    campoConfirmacao.addEventListener("change", () => {
      botaoIniciar.disabled = !campoConfirmacao.checked || !loteValidado || loteEmExecucao;
    });

    campoModoTeste.addEventListener("change", limparValidacao);

    [campoItens, campoData, campoMotivo, campoAut, campoExecutor].forEach(campo => {
      campo.addEventListener("input", limparValidacao);
      campo.addEventListener("change", limparValidacao);
    });

    botaoIniciar.addEventListener("click", async () => {
      if (loteEmExecucao) return;
      if (!loteValidado || !campoConfirmacao.checked) {
        mostrarStatus("Valide os dados e confirme a revisão antes de iniciar.", true);
        return;
      }

      let itens;
      try {
        itens = obterLote();
      } catch (erro) {
        limparValidacao();
        mostrarStatus(erro.message, true);
        return;
      }

      const dataHistoricoMudou = itens.length !== loteValidado.length ||
        itens.some((item, indice) => item.historico !== loteValidado[indice]?.historico);
      if (dataHistoricoMudou) {
        loteValidado = itens;
        renderizarResultados(loteValidado);
        campoConfirmacao.checked = false;
        botaoIniciar.disabled = true;
        mostrarStatus(
          "A data atual do Compl.hist mudou desde a validação. Revise a prévia e confirme novamente.",
          true
        );
        return;
      }

      const modoTeste = campoModoTeste.checked;
      try {
        validarQuantidadeItensModoTeste(modoTeste, itens.length);
      } catch (erro) {
        mostrarStatus(
          erro.message + " Deixe apenas uma linha no lote e valide novamente.",
          true
        );
        return;
      }

      const estado = obterEstado(pagina);
      if (estado?.visao !== VISAO_CONSULTA) {
        mostrarStatus("Abra a Consulta de títulos antes de iniciar. Nenhuma gravação foi feita.", true);
        return;
      }

      modoTesteAtivo = modoTeste;
      loteEmExecucao = true;
      botaoValidar.disabled = true;
      botaoIniciar.disabled = true;
      campoItens.disabled = true;
      campoData.disabled = true;
      campoMotivo.disabled = true;
      campoAut.disabled = true;
      campoExecutor.disabled = true;
      campoConfirmacao.disabled = true;
      campoModoTeste.disabled = true;
      resultados.replaceChildren();

      let monitor = null;
      let concluidos = 0;
      let testeConcluido = false;
      try {
        monitor = criarMonitorNxj(pagina);
        for (let indice = 0; indice < itens.length; indice += 1) {
          const item = itens[indice];
          const linha = doc.createElement("li");
          linha.textContent = "Item " + (indice + 1) + "/" + itens.length +
            " — " + item.titulo + " / " + item.parcela + ": em execução";
          resultados.appendChild(linha);

          try {
            const resultado = await executarItem(pagina, monitor, item, {
              status: mostrarStatus
            });

            if (resultado.modoTeste) {
              testeConcluido = true;
              linha.textContent = "Item " + (indice + 1) + "/" + itens.length +
                " — " + item.titulo + " / " + item.parcela +
                ": TESTE concluído; F9 não enviado.";
              mostrarStatus(
                "Modo de teste concluído. O Compl.hist foi preenchido e confirmado pelo NXJ, " +
                "mas não foi gravado. O script não enviou F9 nem avançou para a grade de parcelas.\n\n" +
                "O campo pode permanecer alterado e não salvo na tela. Não pressione F9 manualmente.",
                false
              );
              break;
            }

            linha.textContent = "Item " + (indice + 1) + "/" + itens.length +
              " — " + item.titulo + " / " + item.parcela + ": gravado e relido.";
            concluidos += 1;
          } catch (erro) {
            const estadoItem = erro.indeterminado
              ? "INDETERMINADO"
              : (erro.parcial ? "PARCIAL — confira os dois salvamentos" : "INTERROMPIDO");
            linha.textContent = "Item " + (indice + 1) + "/" + itens.length +
              " — " + item.titulo + " / " + item.parcela + ": " + estadoItem + ".";
            const orientacaoFalha = (erro.indeterminado || erro.parcial)
              ? "\nNão repita F9. Confira o título/parcela no Systextil antes de nova tentativa."
              : "\nA falha ocorreu antes de qualquer F9 deste item; nenhuma gravação foi iniciada.";
            mostrarStatus(
              "Lote interrompido após " + concluidos + " item(ns) confirmado(s).\n" +
              estadoItem + ": " + erro.message + orientacaoFalha,
              true
            );
            throw erro;
          }
        }

        if (!testeConcluido) {
          mostrarStatus(
            "Lote concluído: " + concluidos + " de " + itens.length +
            " título(s)/parcela(s) gravado(s) e conferido(s) por releitura."
          );
        }
      } catch (_) {
        // A mensagem específica já foi apresentada no ponto da falha.
      } finally {
        try { monitor?.remover(); } catch (_) {}
        modoTesteAtivo = false;
        loteEmExecucao = false;
        botaoValidar.disabled = false;
        campoItens.disabled = false;
        campoData.disabled = false;
        campoMotivo.disabled = false;
        campoAut.disabled = false;
        campoExecutor.disabled = false;
        campoConfirmacao.disabled = false;
        campoModoTeste.disabled = false;
        campoConfirmacao.checked = false;
        loteValidado = null;
        botaoIniciar.disabled = true;
      }
    });

    buscar(".stp-fechar").addEventListener("click", () => {
      painel.classList.toggle("stp-recolhido");
      buscar(".stp-fechar").textContent =
        painel.classList.contains("stp-recolhido") ? "+" : "−";
    });
  }

  function iniciar() {
    try {
      if (typeof window === "undefined" || window.top !== window) return;
      const pagina = obterJanelaPagina();
      if (!pagina.document.body || !pagina.document.head) return;
      criarInterface(pagina);
    } catch (erro) {
      // Não escreve dados no ERP nem envia informações para fora.
      // A falha de inicialização fica visível apenas no console local.
      console.error("[Systextil Prorrogação] " + String(erro?.message || erro));
    }
  }

  return Object.freeze({
    VERSION,
    normalizarCodigoComparacao,
    validarData,
    formatarDataLocal,
    montarComplementoHistorico,
    analisarLote,
    selecionarLinhaPorParcela,
    obterLimiteCampo,
    obterCodigoTecla,
    exigirF9Permitido,
    validarQuantidadeItensModoTeste,
    valoresNaoConfirmados,
    encontrarElementoPorId,
    coletarDocumentosMesmoDominio,
    criarMonitorNxj,
    criarErroIndeterminado,
    iniciar
  });
}
