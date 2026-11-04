// ==UserScript==
// @name         Systextil - Segunda Via de Boleto (conferência)
// @namespace    https://texcotton.com.br/tampermonkey
// @version      0.1.3
// @description  Abre a conferência da segunda via sob demanda, sem recarregar a página.
// @match        http://systextil.texcotton.com.br/systextil/*
// @match        https://systextil.texcotton.com.br/systextil/*
// @run-at       context-menu
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.1.3";
  const PANEL_ID = "st-segunda-via-boleto-panel";

  const CAMPOS = Object.freeze({
    titulo: "num_duplicata.",
    parcela: "seq_duplicatas.",
    cliente: "nome_cliente."
  });

  const MAX_NOME_ARQUIVO = 180;
  const MAX_INICIO_RAZAO_SOCIAL = 35;

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
      "Leia os dados do título exibido. Esta etapa não consulta, emite nem baixa boletos."
    );
    explicacao.style.margin = "0 0 10px";
    explicacao.style.color = "#475569";

    const alerta = criarElemento(
      "p",
      "Confirme visualmente se Cliente corresponde à razão social e se a sequência corresponde à parcela."
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

    const botao = criarElemento("button", "Ler dados do título");
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
          "Leitura concluída. Nenhuma ação foi executada no ERP."
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
      botao,
      resultado,
      fechar
    );
    document.body.append(painel);
  }

  // API local de diagnóstico: não consulta nem altera o ERP.
  window.__systextilSegundaViaBoletoDebug = Object.freeze({
    version: VERSION,
    fieldNames: CAMPOS,
    sanitizarParteNome,
    montarNomeArquivo,
    limitarInicioRazaoSocial,
    lerDadosTitulo
  });

  function alternarPainel() {
    if (!ehTelaConsultaTitulo()) {
      console.warn(
        "[Systextil Segunda Via] Abra a tela Consulta de títulos antes de usar o atalho."
      );
      return;
    }

    const painelExistente = document.getElementById(PANEL_ID);

    if (painelExistente) {
      painelExistente.remove();
      window.__systextilSegundaViaBoletoLoaded = false;
      return;
    }

    window.__systextilSegundaViaBoletoLoaded = true;
    montarPainel();
  }

  // O popup do Tampermonkey injeta esta rotina na aba ativa sem reload.
  // Depois da primeira ativação, Ctrl+Alt+B alterna o painel nesta aba.
  if (!ehTelaConsultaTitulo()) {
    console.warn(
      "[Systextil Segunda Via] Abra a tela Consulta de títulos antes de executar este atalho."
    );
    return;
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
    window.__systextilSegundaViaBoletoLoaded = true;
    montarPainel();
  } else {
    alternarPainel();
  }
})();
