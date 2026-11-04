// ==UserScript==
// @name         Systextil - Segunda Via de Boleto (conferência)
// @namespace    https://texcotton.com.br/tampermonkey
// @version      0.2.1
// @updateURL     https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via-boleto.user.js
// @downloadURL   https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via-boleto.user.js
// @description  Prepara a consulta assistida da segunda via sem recarregar a página.
// @match        http://systextil.texcotton.com.br/systextil/*
// @match        https://systextil.texcotton.com.br/systextil/*
// @run-at       context-menu
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.2.1";
  const PANEL_ID = "st-segunda-via-boleto-panel";

  const CAMPOS = Object.freeze({
    titulo: "num_duplicata.",
    parcela: "seq_duplicatas.",
    cliente: "nome_cliente."
  });

  const MAX_NOME_ARQUIVO = 180;
  const MAX_INICIO_RAZAO_SOCIAL = 35;
  const LARGURAS_PADRAO_CONSULTA = Object.freeze({ titulo: 8, parcela: 2 });

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
   * Normaliza códigos numéricos com zeros à esquerda.
   * A largura é derivada do maxlength do campo do ERP quando disponível;
   * caso contrário, usa os tamanhos padrão conhecidos: título 8 e parcela 2.
   */
  function normalizarCodigoConsulta(valor, rotulo, largura) {
    const codigo = validarCodigoConsulta(valor, rotulo);

    if (!Number.isInteger(largura) || largura < 1) {
      throw new Error("Não foi possível determinar o tamanho do campo " + rotulo.toLowerCase() + ".");
    }

    if (codigo.length > largura) {
      throw new Error(
        rotulo + " possui " + codigo.length +
        " caracteres, mas o campo aceita " + largura + ". Nenhum dígito foi removido."
      );
    }

    return /^[0-9]+$/.test(codigo)
      ? codigo.padStart(largura, "0")
      : codigo;
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

  function emitirEventosCampo(campo) {
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function preencherCamposConsulta(dados) {
    const formulario = localizarFormularioConsulta();
    const campoTitulo = formulario.elements.namedItem(CAMPOS.titulo);
    const campoParcela = formulario.elements.namedItem(CAMPOS.parcela);

    if (
      campoTitulo.disabled ||
      campoTitulo.readOnly ||
      campoParcela.disabled ||
      campoParcela.readOnly
    ) {
      throw new Error("Um dos campos do ERP está bloqueado para edição.");
    }

    const titulo = normalizarCodigoConsulta(
      dados?.titulo,
      "Número do título",
      obterLarguraCampo(campoTitulo, LARGURAS_PADRAO_CONSULTA.titulo)
    );
    const parcela = normalizarCodigoConsulta(
      dados?.parcela,
      "Parcela",
      obterLarguraCampo(campoParcela, LARGURAS_PADRAO_CONSULTA.parcela)
    );

    const valoresAnteriores = {
      titulo: campoTitulo.value,
      parcela: campoParcela.value
    };

    try {
      campoTitulo.value = titulo;
      emitirEventosCampo(campoTitulo);

      campoParcela.value = parcela;
      emitirEventosCampo(campoParcela);

      if (
        campoTitulo.value.trim() !== titulo ||
        campoParcela.value.trim() !== parcela
      ) {
        throw new Error("O Systextil não manteve os valores preenchidos.");
      }
    } catch (erro) {
      // Evita deixar a tela parcialmente preenchida se um dos campos falhar.
      try {
        campoTitulo.value = valoresAnteriores.titulo;
        emitirEventosCampo(campoTitulo);
      } catch (_) {
        campoTitulo.value = valoresAnteriores.titulo;
      }

      try {
        campoParcela.value = valoresAnteriores.parcela;
        emitirEventosCampo(campoParcela);
      } catch (_) {
        campoParcela.value = valoresAnteriores.parcela;
      }

      throw new Error(
        "Não foi possível preencher os dois campos; os valores anteriores foram restaurados. " +
        erro.message
      );
    }

    if (typeof campoTitulo.focus === "function") {
      campoTitulo.focus();
    }

    return { titulo, parcela };
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

    botaoPreencher.addEventListener("click", function () {
      resultado.replaceChildren();

      try {
        const preenchidos = preencherCamposConsulta({
          titulo: entradaTitulo.value,
          parcela: entradaParcela.value
        });

        const status = criarElemento(
          "p",
          "Campos preenchidos e conferidos no formulário. Confira o número e a parcela no ERP; depois, pressione F7 manualmente. Nenhuma consulta foi enviada."
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
        const status = criarElemento("p", erro.message);
        status.style.color = "#b91c1c";
        status.style.margin = "0";
        resultado.append(status);
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
      grupoEntradas,
      botaoPreencher,
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
    lerDadosTitulo,
    validarCodigoConsulta,
    normalizarCodigoConsulta,
    obterLarguraCampo,
    preencherCamposConsulta
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
