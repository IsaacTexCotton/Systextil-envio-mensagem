// ==UserScript==
// @name         Systextil — Diagnóstico de Prorrogação (somente leitura)
// @namespace    https://github.com/IsaacTexCotton/Systextil-envio-mensagem
// @version      0.1.0
// @description  Registra metadados de telas e comandos NXJ durante uma operação manual; não altera o ERP.
// @match        http://systextil.texcotton.com.br/systextil/*
// @match        https://systextil.texcotton.com.br/systextil/*
// @run-at       context-menu
// @noframes
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  "use strict";

  const ID_PAINEL = "__st_sonda_prorrogacao__";
  const LIMITE_EVENTOS = 1200;
  const LIMITE_CONTROLES_POR_FORM = 250;
  const COMANDO_NXJ = /(?:^|\/)UnifyNXJ\.jsp$/i;
  const ROTULOS_CONHECIDOS = /^(?:nr\.?\s*t[ií]tulo|n[uú]mero\s+do\s+t[ií]tulo|parcela|seq(?:u[eê]ncia)?|compl\.?\s*hist\.?|compl(?:emento)?\s+hist[oó]rico|prorrog(?:a[cç][aã]o)?|mot(?:ivo)?|data(?:\s+da)?\s+prorrog(?:a[cç][aã]o])?)\s*:?$/i;
  const TECLAS_RELEVANTES = new Set(["F2", "F7", "F9", "Enter"]);
  const ETAPAS = [
    "Consulta de títulos — tela aberta, antes do F7",
    "Consulta de títulos — após F7 e carregamento do título",
    "Manutenção de Títulos a Receber — caminho correto, tela aberta",
    "Compl.hist — após substituição e F9",
    "Manutenção de Títulos — tela aberta",
    "Prorrog e Mot — após alteração e F9",
    "Retorno à Consulta de títulos"
  ];

  const pagina = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const eventos = [];
  const etapas = [];
  const contextosInstalados = new WeakMap();
  const janelasMonitoradas = new WeakSet();
  let observadorFrames = null;
  let capturando = false;
  let iniciadoEm = null;
  let encerradoEm = null;
  let relatorioGerado = false;
  let descartados = 0;
  let contadorEventos = 0;
  let painel = null;
  let selecaoEtapa = null;
  let botaoIniciar = null;
  let botaoMarcar = null;
  let botaoEncerrar = null;
  let botaoExportar = null;
  let statusPainel = null;

  function agora() {
    return new Date().toISOString();
  }

  function identificadorSeguro(valor) {
    const texto = String(valor == null ? "" : valor).trim();
    return /^[A-Za-z0-9_.:$-]{1,120}$/.test(texto) ? texto : null;
  }

  function textoRotuloSeguro(valor) {
    const texto = String(valor == null ? "" : valor).replace(/\s+/g, " ").trim();
    return texto && ROTULOS_CONHECIDOS.test(texto) ? texto : null;
  }

  function adicionarEvento(evento) {
    if (!capturando) return;
    contadorEventos += 1;
    if (eventos.length >= LIMITE_EVENTOS) {
      descartados += 1;
      return;
    }
    eventos.push(Object.assign({ numero: contadorEventos, instante: agora() }, evento));
    atualizarStatus();
  }

  function nomeVisao(win) {
    try {
      return identificadorSeguro(win.curDataView && win.curDataView.name);
    } catch (_) {
      return null;
    }
  }

  function lerEstadoVisao(win) {
    const resultado = {};
    let visao;

    try {
      visao = win.curDataView;
    } catch (_) {
      return resultado;
    }

    if (!visao) return resultado;

    const propriedades = ["find", "recordAction", "recordCount", "recordNumber", "nrows", "currentRow"];
    for (const propriedade of propriedades) {
      try {
        const valor = visao[propriedade];
        if (typeof valor === "boolean" || (typeof valor === "number" && Number.isFinite(valor))) {
          resultado[propriedade] = valor;
        } else if (propriedade === "recordAction" && typeof valor === "string") {
          resultado[propriedade] = identificadorSeguro(valor);
        }
      } catch (_) {
        // Algumas propriedades variam conforme a visão. Não são necessárias para a sonda.
      }
    }
    return resultado;
  }

  function rotuloDeControle(controle) {
    const candidatos = [];

    try {
      if (controle.labels) {
        for (const label of Array.from(controle.labels)) candidatos.push(label.textContent);
      }
    } catch (_) {
      // HTMLLabelsCollection pode variar entre telas.
    }

    if (controle.getAttribute) {
      candidatos.push(controle.getAttribute("aria-label"));
      candidatos.push(controle.getAttribute("title"));
    }

    const pai = controle.parentElement;
    if (pai) {
      candidatos.push(pai.previousElementSibling && pai.previousElementSibling.textContent);
      candidatos.push(pai.nextElementSibling && pai.nextElementSibling.textContent);
    }
    candidatos.push(controle.previousElementSibling && controle.previousElementSibling.textContent);
    candidatos.push(controle.nextElementSibling && controle.nextElementSibling.textContent);

    for (const candidato of candidatos) {
      const rotulo = textoRotuloSeguro(candidato);
      if (rotulo) return rotulo;
    }
    return null;
  }

  function metadadosControle(controle, indiceFormulario) {
    const tipo = String(controle.type || controle.tagName || "").toLowerCase();
    if (["hidden", "password", "file"].includes(tipo)) return null;

    const formulario = controle.form || null;
    let indicePai = null;
    if (formulario && controle.parentElement) {
      indicePai = Array.prototype.indexOf.call(formulario.children, controle.parentElement);
      if (indicePai < 0) indicePai = null;
    }

    return {
      indice: indiceFormulario,
      tag: String(controle.tagName || "").toLowerCase(),
      tipo: identificadorSeguro(tipo),
      name: identificadorSeguro(controle.name),
      id: identificadorSeguro(controle.id),
      rotulo: rotuloDeControle(controle),
      parentIndex: indicePai,
      maxLength: Number.isInteger(controle.maxLength) && controle.maxLength >= 0 ? controle.maxLength : null,
      readOnly: Boolean(controle.readOnly),
      disabled: Boolean(controle.disabled),
      required: Boolean(controle.required)
    };
  }

  function metadadosAtivo(doc) {
    const ativo = doc && doc.activeElement;
    if (!ativo || !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(String(ativo.tagName || ""))) return null;
    return {
      tag: String(ativo.tagName || "").toLowerCase(),
      tipo: identificadorSeguro(ativo.type),
      name: identificadorSeguro(ativo.name),
      id: identificadorSeguro(ativo.id)
    };
  }

  function coletarFormulario(formulario, indice) {
    const controles = [];
    let indiceControle = 0;
    for (const controle of Array.from(formulario.elements || [])) {
      if (!/^(INPUT|SELECT|TEXTAREA)$/.test(String(controle.tagName || ""))) continue;
      const metadados = metadadosControle(controle, indiceControle);
      indiceControle += 1;
      if (metadados) controles.push(metadados);
      if (controles.length >= LIMITE_CONTROLES_POR_FORM) break;
    }

    const botoes = [];
    for (const botao of Array.from(formulario.querySelectorAll("button, input[type='button'], input[type='submit']"))) {
      botoes.push({
        tag: String(botao.tagName || "").toLowerCase(),
        tipo: identificadorSeguro(botao.type),
        name: identificadorSeguro(botao.name),
        id: identificadorSeguro(botao.id),
        disabled: Boolean(botao.disabled)
      });
      if (botoes.length >= 80) break;
    }

    return {
      indice,
      name: identificadorSeguro(formulario.name),
      id: identificadorSeguro(formulario.id),
      method: identificadorSeguro(String(formulario.method || "get").toLowerCase()),
      totalControles: Number(formulario.elements ? formulario.elements.length : 0),
      controles,
      botoes
    };
  }

  function listarContextos() {
    const resultado = [];
    const visitadas = new WeakSet();

    function visitar(win, caminho, profundidade) {
      if (!win || visitadas.has(win) || profundidade > 4) return;
      visitadas.add(win);

      let doc;
      try {
        doc = win.document;
        if (!doc) return;
      } catch (_) {
        return;
      }

      resultado.push({ win, doc, caminho });
      let quantidade = 0;
      try {
        quantidade = win.frames.length;
      } catch (_) {
        return;
      }

      for (let indice = 0; indice < quantidade; indice += 1) {
        try {
          visitar(win.frames[indice], caminho + "." + indice, profundidade + 1);
        } catch (_) {
          // Frames de outra origem são ignorados.
        }
      }
    }

    visitar(pagina, "top", 0);
    return resultado;
  }

  function coletarSnapshot(contexto) {
    const win = contexto.win;
    const doc = contexto.doc;
    const formularios = [];

    try {
      Array.from(doc.forms).forEach((formulario, indice) => {
        formularios.push(coletarFormulario(formulario, indice));
      });
    } catch (_) {
      // A tela pode estar substituindo o formulário neste instante.
    }

    return {
      frame: contexto.caminho,
      viewName: nomeVisao(win),
      viewState: lerEstadoVisao(win),
      forms: formularios,
      activeElement: metadadosAtivo(doc)
    };
  }

  function campoTecnicoPresenteNaTela(valor, win) {
    const nome = identificadorSeguro(valor);
    if (!nome || !/[A-Za-z_]/.test(nome)) return null;

    try {
      const controles = win.document.querySelectorAll("input[name], select[name], textarea[name], input[id], select[id], textarea[id]");
      for (const controle of controles) {
        if (controle.name === nome || controle.id === nome) return nome;
      }
    } catch (_) {
      // Se a tela estiver em atualização, o dado é omitido.
    }
    return null;
  }

  function resumirFieldValues(parametros) {
    const valores = parametros.getAll("fieldValues");
    let segmentos = 0;
    let segmentosNaoVazios = 0;

    for (const valor of valores) {
      const partes = String(valor).split("\f");
      segmentos += partes.length;
      segmentosNaoVazios += partes.filter(parte => parte.length > 0).length;
    }

    return {
      fieldValuesEntries: valores.length,
      fieldValuesSegments: segmentos,
      fieldValuesNonEmptySegments: segmentosNaoVazios
    };
  }

  function lerMetadadosRequisicao(body, win) {
    let parametros = null;
    try {
      if (typeof body === "string") {
        parametros = new win.URLSearchParams(body);
      } else if (body && typeof win.URLSearchParams !== "undefined" && body instanceof win.URLSearchParams) {
        parametros = body;
      } else if (body && typeof win.FormData !== "undefined" && body instanceof win.FormData) {
        parametros = new win.URLSearchParams();
        for (const chave of ["commandName", "clickedOnField"]) {
          const valor = body.get(chave);
          if (typeof valor === "string") parametros.set(chave, valor);
        }
        const valores = body.getAll("fieldValues");
        for (const valor of valores) {
          if (typeof valor === "string") parametros.append("fieldValues", valor);
        }
      }
    } catch (_) {
      parametros = null;
    }

    if (!parametros) return {};

    return {
      commandName: identificadorSeguro(parametros.get("commandName")),
      clickedOnField: campoTecnicoPresenteNaTela(parametros.get("clickedOnField"), win),
      fieldValues: resumirFieldValues(parametros)
    };
  }

  function caminhoDaUrl(rawUrl, win) {
    try {
      const url = new win.URL(String(rawUrl), win.location.href);
      return COMANDO_NXJ.test(url.pathname) ? url.pathname : null;
    } catch (_) {
      return null;
    }
  }

  function instalarMonitorXhr(contexto) {
    const win = contexto.win;
    let prototipo;
    try {
      prototipo = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
    } catch (_) {
      return false;
    }
    if (!prototipo) return false;
    if (contextosInstalados.has(win)) return true;

    const originalOpen = prototipo.open;
    const originalSend = prototipo.send;
    if (typeof originalOpen !== "function" || typeof originalSend !== "function") return false;

    const requisicoes = new WeakMap();

    function openMonitorado(method, url) {
      const path = caminhoDaUrl(url, win);
      requisicoes.set(this, {
        method: String(method || "GET").toUpperCase(),
        path
      });
      return originalOpen.apply(this, arguments);
    }

    function sendMonitorado(body) {
      const meta = requisicoes.get(this);
      if (!capturando || !meta || !meta.path) {
        return originalSend.apply(this, arguments);
      }

      const instanteInicio = Date.now();
      const dados = meta.method === "POST" ? lerMetadadosRequisicao(body, win) : {};
      const evento = {
        tipo: "nxj-request",
        frame: contexto.caminho,
        method: meta.method,
        path: meta.path,
        commandName: dados.commandName || null,
        clickedOnField: dados.clickedOnField || null,
        fieldValues: dados.fieldValues || null,
        status: null,
        duracaoMs: null
      };
      adicionarEvento(evento);

      try {
        this.addEventListener("loadend", function () {
          evento.status = Number.isFinite(this.status) ? this.status : null;
          evento.duracaoMs = Math.max(0, Date.now() - instanteInicio);
          atualizarStatus();
        }, { once: true });
      } catch (_) {
        // O registro básico da solicitação permanece útil sem o status.
      }

      return originalSend.apply(this, arguments);
    }

    try {
      prototipo.open = openMonitorado;
      prototipo.send = sendMonitorado;
      if (prototipo.open !== openMonitorado || prototipo.send !== sendMonitorado) {
        prototipo.open = originalOpen;
        prototipo.send = originalSend;
        return false;
      }
    } catch (_) {
      return false;
    }

    contextosInstalados.set(win, {
      prototipo,
      originalOpen,
      originalSend,
      openMonitorado,
      sendMonitorado
    });
    return true;
  }

  function registrarFoco(contexto, evento) {
    const alvo = evento.target;
    if (!alvo || !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(String(alvo.tagName || ""))) return;

    adicionarEvento({
      tipo: "focus",
      frame: contexto.caminho,
      viewName: nomeVisao(contexto.win),
      controle: {
        tag: String(alvo.tagName || "").toLowerCase(),
        tipo: identificadorSeguro(alvo.type),
        name: identificadorSeguro(alvo.name),
        id: identificadorSeguro(alvo.id)
      }
    });
  }

  function registrarTecla(contexto, evento) {
    if (!TECLAS_RELEVANTES.has(evento.key)) return;
    const alvo = evento.target;
    adicionarEvento({
      tipo: "tecla",
      frame: contexto.caminho,
      viewName: nomeVisao(contexto.win),
      tecla: evento.key,
      controle: alvo && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(String(alvo.tagName || ""))
        ? {
          tag: String(alvo.tagName || "").toLowerCase(),
          tipo: identificadorSeguro(alvo.type),
          name: identificadorSeguro(alvo.name),
          id: identificadorSeguro(alvo.id)
        }
        : null
    });
  }

  function instalarListeners(contexto) {
    const win = contexto.win;
    if (janelasMonitoradas.has(win)) return;
    janelasMonitoradas.add(win);

    const aoFocar = evento => registrarFoco(contexto, evento);
    const aoTeclar = evento => registrarTecla(contexto, evento);
    const aoCarregarFrame = evento => {
      if (evento.target && String(evento.target.tagName || "").toUpperCase() === "IFRAME") {
        atualizarContextos();
      }
    };

    contexto.doc.addEventListener("focusin", aoFocar, true);
    contexto.doc.addEventListener("keydown", aoTeclar, true);
    contexto.doc.addEventListener("load", aoCarregarFrame, true);
    contextoListeners.push({ doc: contexto.doc, aoFocar, aoTeclar, aoCarregarFrame });
  }

  const contextoListeners = [];

  function atualizarContextos() {
    if (!capturando) return { frames: 0, xhrMonitorados: 0 };
    const contextos = listarContextos();
    let xhrMonitorados = 0;
    for (const contexto of contextos) {
      if (instalarMonitorXhr(contexto)) xhrMonitorados += 1;
      instalarListeners(contexto);
    }
    return { frames: contextos.length, xhrMonitorados };
  }

  function iniciarCaptura() {
    if (capturando) return;
    capturando = true;
    iniciadoEm = agora();
    encerradoEm = null;
    const diagnosticoInicial = atualizarContextos();

    try {
      const Observador = pagina.MutationObserver;
      if (Observador && pagina.document.documentElement) {
        observadorFrames = new Observador(registros => {
          const adicionouFrame = registros.some(registro =>
            Array.from(registro.addedNodes || []).some(node =>
              node && (
                String(node.tagName || "").toUpperCase() === "IFRAME" ||
                (typeof node.querySelector === "function" && node.querySelector("iframe"))
              )
            )
          );
          if (adicionouFrame) atualizarContextos();
        });
        observadorFrames.observe(pagina.document.documentElement, { childList: true, subtree: true });
      }
    } catch (_) {
      observadorFrames = null;
    }

    adicionarEvento({
      tipo: "captura-iniciada",
      framesDetectados: diagnosticoInicial.frames,
      xhrMonitorados: diagnosticoInicial.xhrMonitorados
    });
    atualizarBotoes();
    atualizarStatus(
      diagnosticoInicial.xhrMonitorados > 0
        ? "Captura iniciada. XHR monitorado em " + diagnosticoInicial.xhrMonitorados + " frame(s)."
        : "Atenção: a captura iniciou, mas não conseguiu monitorar XHR. O relatório pode ficar incompleto."
    );
  }

  function encerrarCaptura() {
    if (!capturando) return;
    adicionarEvento({ tipo: "captura-encerrada" });
    capturando = false;
    encerradoEm = agora();

    if (observadorFrames) {
      observadorFrames.disconnect();
      observadorFrames = null;
    }

    for (const item of contextoListeners.splice(0)) {
      item.doc.removeEventListener("focusin", item.aoFocar, true);
      item.doc.removeEventListener("keydown", item.aoTeclar, true);
      item.doc.removeEventListener("load", item.aoCarregarFrame, true);
    }

    for (const contexto of listarContextos()) {
      const instalado = contextosInstalados.get(contexto.win);
      if (!instalado) continue;
      try {
        if (instalado.prototipo.open === instalado.openMonitorado) {
          instalado.prototipo.open = instalado.originalOpen;
        }
        if (instalado.prototipo.send === instalado.sendMonitorado) {
          instalado.prototipo.send = instalado.originalSend;
        }
      } catch (_) {
        // Não sobrescrever mudanças feitas por outro código.
      }
    }

    atualizarBotoes();
    atualizarStatus();
  }

  function registrarEtapa() {
    if (!capturando || !selecaoEtapa) return;
    atualizarContextos();

    const contextos = listarContextos();
    etapas.push({
      numero: etapas.length + 1,
      instante: agora(),
      etapa: ETAPAS[Number(selecaoEtapa.value)],
      snapshots: contextos.map(coletarSnapshot)
    });

    adicionarEvento({
      tipo: "marcador-etapa",
      etapaNumero: etapas.length,
      etapa: ETAPAS[Number(selecaoEtapa.value)],
      visoes: contextos.map(contexto => ({
        frame: contexto.caminho,
        viewName: nomeVisao(contexto.win)
      }))
    });
    atualizarStatus();
  }

  function montarRelatorio() {
    return {
      produto: "Systextil — sonda de diagnóstico de prorrogação",
      versaoSonda: "0.1.0",
      modo: "somente leitura; não envia comandos nem altera campos",
      iniciadoEm,
      encerradoEm,
      totalEventosRegistrados: eventos.length,
      eventosDescartadosPorLimite: descartados,
      observacoes: [
        "A sonda não lê propriedades value de campos nem textos de registros.",
        "fieldValues é resumido apenas pela quantidade de segmentos não vazios; os conteúdos nunca são exportados.",
        "Parâmetros de sessão, query strings, cookies, tokens e corpos de resposta não são registrados.",
        "Os comandos e teclas são capturados somente enquanto o operador executa o procedimento manualmente."
      ],
      etapas,
      eventos
    };
  }

  function exportarRelatorio() {
    const relatorio = montarRelatorio();
    const blob = new Blob([JSON.stringify(relatorio, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const url = pagina.URL.createObjectURL(blob);
    const link = pagina.document.createElement("a");
    const data = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = "systextil-sonda-prorrogacao-" + data + ".json";
    link.style.display = "none";
    pagina.document.body.appendChild(link);
    link.click();
    link.remove();
    relatorioGerado = true;
    atualizarStatus("Download do relatório solicitado ao navegador.");
  }

  function atualizarStatus(mensagem) {
    if (!statusPainel) return;
    if (mensagem) {
      statusPainel.textContent = mensagem;
      return;
    }
    statusPainel.textContent =
      (capturando ? "Capturando" : "Parada") +
      " · " + etapas.length + " etapa(s) marcada(s)" +
      " · " + eventos.length + " evento(s) NXJ/DOM" +
      (descartados ? " · limite atingido (" + descartados + " descartado(s))" : "");
  }

  function atualizarBotoes() {
    if (!botaoIniciar) return;
    botaoIniciar.disabled = capturando || Boolean(iniciadoEm);
    botaoMarcar.disabled = !capturando;
    botaoEncerrar.disabled = !capturando;
    botaoExportar.disabled = !iniciadoEm;
    selecaoEtapa.disabled = !capturando;
  }

  function criarBotao(texto, classe) {
    const botao = pagina.document.createElement("button");
    botao.type = "button";
    botao.textContent = texto;
    botao.className = classe || "";
    return botao;
  }

  function criarPainel() {
    if (painel || pagina.document.getElementById(ID_PAINEL)) return;

    const host = pagina.document.createElement("div");
    host.id = ID_PAINEL;
    host.style.position = "fixed";
    host.style.top = "12px";
    host.style.right = "12px";
    host.style.zIndex = "2147483647";
    host.style.width = "min(390px, calc(100vw - 24px))";
    host.style.fontFamily = "Arial, sans-serif";

    const shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    const style = pagina.document.createElement("style");
    style.textContent = [
      ":host{all:initial}",
      ".box{box-sizing:border-box;background:#fff;color:#17212b;border:1px solid #b8c3ce;border-radius:9px;box-shadow:0 6px 24px rgba(0,0,0,.22);padding:13px;font:13px/1.4 Arial,sans-serif;max-height:82vh;overflow:auto}",
      ".head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px}",
      ".title{font-size:14px;font-weight:700}",
      ".tag{font-size:10px;font-weight:700;letter-spacing:.04em;color:#075985;background:#e0f2fe;padding:3px 6px;border-radius:4px}",
      ".notice{margin:8px 0;padding:8px;background:#f3f6f8;border-radius:5px}",
      "label{display:block;font-weight:600;margin:9px 0 4px}",
      "select{box-sizing:border-box;width:100%;padding:7px;border:1px solid #9aa8b5;border-radius:5px;background:#fff;color:#17212b;font:inherit}",
      ".actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}",
      "button{padding:8px 9px;border:1px solid #9aa8b5;border-radius:5px;background:#f8fafc;color:#17212b;font:600 12px Arial,sans-serif;cursor:pointer}",
      "button.primary{background:#075985;color:#fff;border-color:#075985}",
      "button:disabled{opacity:.45;cursor:not-allowed}",
      ".status{margin-top:9px;padding-top:8px;border-top:1px solid #d7dee5;color:#334155;min-height:18px}",
      ".foot{display:flex;justify-content:flex-end;margin-top:7px}",
      ".close{padding:3px 7px;font-weight:400}"
    ].join("");
    const box = pagina.document.createElement("section");
    box.className = "box";
    const head = pagina.document.createElement("div");
    head.className = "head";
    const title = pagina.document.createElement("div");
    title.className = "title";
    title.textContent = "Systextil — Sonda de prorrogação";
    const tag = pagina.document.createElement("span");
    tag.className = "tag";
    tag.textContent = "SOMENTE LEITURA";
    head.append(title, tag);

    const notice = pagina.document.createElement("div");
    notice.className = "notice";
    notice.textContent = "Não preenche campos, não navega, não pressiona F2/F9/F7 e não grava no ERP. Registra apenas metadados das ações manuais. Valores de títulos, parcelas, clientes e campos não são coletados.";

    const label = pagina.document.createElement("label");
    label.textContent = "Etapa atual para marcar";
    selecaoEtapa = pagina.document.createElement("select");
    ETAPAS.forEach((etapa, indice) => {
      const opcao = pagina.document.createElement("option");
      opcao.value = String(indice);
      opcao.textContent = (indice + 1) + ". " + etapa;
      selecaoEtapa.appendChild(opcao);
    });

    botaoIniciar = criarBotao("Iniciar captura", "primary");
    botaoMarcar = criarBotao("Registrar etapa");
    botaoEncerrar = criarBotao("Encerrar e restaurar");
    botaoExportar = criarBotao("Baixar relatório JSON", "primary");
    statusPainel = pagina.document.createElement("div");
    statusPainel.className = "status";
    statusPainel.textContent = "Parada · inicie antes de executar o procedimento manual.";

    const actions = pagina.document.createElement("div");
    actions.className = "actions";
    actions.append(botaoIniciar, botaoMarcar, botaoEncerrar, botaoExportar);

    const foot = pagina.document.createElement("div");
    foot.className = "foot";
    const fechar = criarBotao("Fechar painel", "close");
    foot.appendChild(fechar);

    box.append(head, notice, label, selecaoEtapa, actions, statusPainel, foot);
    shadow.append(style, box);
    pagina.document.body.appendChild(host);
    painel = host;

    botaoIniciar.addEventListener("click", iniciarCaptura);
    botaoMarcar.addEventListener("click", registrarEtapa);
    botaoEncerrar.addEventListener("click", encerrarCaptura);
    botaoExportar.addEventListener("click", exportarRelatorio);
    fechar.addEventListener("click", () => {
      if (capturando) {
        atualizarStatus("Encerre a captura e baixe o relatório antes de fechar o painel.");
        return;
      }
      if (iniciadoEm && !relatorioGerado) {
        atualizarStatus("Baixe o relatório JSON antes de fechar o painel para não perder a coleta.");
        return;
      }
      host.remove();
      painel = null;
    });

    atualizarBotoes();
  }

  if (pagina.document.readyState === "loading") {
    pagina.document.addEventListener("DOMContentLoaded", criarPainel, { once: true });
  } else {
    criarPainel();
  }
})();
