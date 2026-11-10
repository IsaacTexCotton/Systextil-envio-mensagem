// ==UserScript==
// @name         Systextil — Construtor de Automações
// @namespace    https://github.com/IsaacTexCotton/Systextil-envio-mensagem
// @version      0.1.0
// @description  Cria e executa receitas locais de leitura de campos do Systextil, sem alterar registros.
// @match        http://systextil.texcotton.com.br/systextil/*
// @match        https://systextil.texcotton.com.br/systextil/*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-construtor-automacoes.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-construtor-automacoes.user.js
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.1.0";
  const STORAGE_KEY = "st.construtor-automacoes.receitas.v1";
  const MAX_RECEITAS = 100;
  const MAX_CAMPOS_RECEITA = 30;
  const NOME_CAMPO_VALIDO = /^[A-Za-z_][A-Za-z0-9_.:-]{0,79}$/;
  const NOME_VISAO_VALIDO = /^[A-Za-z0-9_.:-]{1,128}$/;
  const NOME_RECEITA_VALIDO = /^[^\u0000-\u001f<>]{3,80}$/;

  function validarReceita(entrada) {
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
      throw new Error("A receita precisa ser um objeto JSON.");
    }

    const id = String(entrada.id ?? "").trim();
    const nome = String(entrada.nome ?? "").trim();
    const visao = String(entrada.visao ?? "").trim();

    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) {
      throw new Error("Identificador da receita inválido.");
    }
    if (!NOME_RECEITA_VALIDO.test(nome)) {
      throw new Error("O nome da receita deve ter de 3 a 80 caracteres.");
    }
    if (!NOME_VISAO_VALIDO.test(visao)) {
      throw new Error("Nome da visão inválido.");
    }
    if (!Array.isArray(entrada.campos) ||
      entrada.campos.length < 1 ||
      entrada.campos.length > MAX_CAMPOS_RECEITA) {
      throw new Error("A receita deve conter de 1 a " + MAX_CAMPOS_RECEITA + " campos.");
    }

    const campos = entrada.campos.map(campo => {
      if (typeof campo !== "string" || !NOME_CAMPO_VALIDO.test(campo)) {
        throw new Error("A receita contém um nome de campo inválido.");
      }
      return campo;
    });

    if (new Set(campos).size !== campos.length) {
      throw new Error("A receita não pode repetir campos.");
    }

    const descricao = String(entrada.descricao ?? "").trim().slice(0, 240);
    const criadaEm = Number.isFinite(Number(entrada.criadaEm))
      ? Number(entrada.criadaEm)
      : Date.now();
    const atualizadaEm = Number.isFinite(Number(entrada.atualizadaEm))
      ? Number(entrada.atualizadaEm)
      : criadaEm;

    // Apenas metadados declarativos são preservados. Propriedades extras,
    // como código, callbacks ou passos executáveis, nunca são importadas.
    return {
      schema: 1,
      id,
      nome,
      descricao,
      visao,
      campos,
      criadaEm,
      atualizadaEm
    };
  }

  function validarColecaoReceitas(entrada) {
    if (!Array.isArray(entrada)) {
      throw new Error("O arquivo precisa conter uma lista de receitas.");
    }
    if (entrada.length > MAX_RECEITAS) {
      throw new Error("O limite é de " + MAX_RECEITAS + " receitas por arquivo.");
    }

    const receitas = entrada.map(validarReceita);
    const ids = receitas.map(receita => receita.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("O arquivo contém identificadores de receita repetidos.");
    }
    return receitas;
  }

  function escaparValorCsv(valor) {
    let texto = String(valor ?? "");
    if (/^[\t\r ]*[=+\-@]/.test(texto)) {
      texto = "'" + texto;
    }
    return '"' + texto.replace(/"/g, '""') + '"';
  }

  function gerarCsv(campos, registro) {
    if (!Array.isArray(campos) || campos.length === 0 ||
      !registro || typeof registro !== "object") {
      throw new Error("Não há dados válidos para exportar.");
    }

    const cabecalho = campos.map(escaparValorCsv).join(";");
    const valores = campos.map(campo => escaparValorCsv(registro[campo])).join(";");
    return "\uFEFF" + cabecalho + "\r\n" + valores + "\r\n";
  }

  function criarNomeArquivo(nome, extensao) {
    const base = String(nome ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "automacao";
    return base + "." + extensao;
  }

  const API_TESTE = Object.freeze({
    VERSION,
    validarReceita,
    validarColecaoReceitas,
    escaparValorCsv,
    gerarCsv,
    criarNomeArquivo
  });

  if (typeof module === "object" && module && module.exports) {
    module.exports = API_TESTE;
  }

  if (typeof document === "undefined") return;

  const pagina = typeof unsafeWindow !== "undefined" && unsafeWindow
    ? unsafeWindow
    : window;
  const documento = document;

  function lerVisaoAtual() {
    const nome = String(pagina?.curDataView?.name ?? "").trim();
    return NOME_VISAO_VALIDO.test(nome) ? nome : "";
  }

  function listarFormularios() {
    return Array.from(documento.forms || []);
  }

  function campoTemValorSimples(elemento) {
    const tag = String(elemento?.tagName || "").toLowerCase();
    const tipo = String(elemento?.type || "").toLowerCase();

    if (tag === "input") {
      return ["", "text", "search", "number", "date", "datetime-local", "email", "tel", "url", "hidden"].includes(tipo) &&
        typeof elemento.value === "string";
    }
    return (tag === "select" && !elemento.multiple || tag === "textarea") &&
      typeof elemento.value === "string";
  }

  function catalogarFormulario(formulario, indice) {
    const elementos = Array.from(formulario.elements || []);
    const contagem = new Map();

    elementos.forEach(elemento => {
      const nome = String(elemento?.name ?? "");
      if (!nome) return;
      contagem.set(nome, (contagem.get(nome) || 0) + 1);
    });

    const campos = [];
    const vistos = new Set();

    elementos.forEach(elemento => {
      const nome = String(elemento?.name ?? "");
      if (!nome || vistos.has(nome) || !NOME_CAMPO_VALIDO.test(nome)) return;
      vistos.add(nome);
      campos.push({
        nome,
        tipo: String(elemento.tagName || "elemento").toLowerCase() +
          (elemento.type ? "[" + String(elemento.type).toLowerCase() + "]" : ""),
        ocorrencias: contagem.get(nome) || 0,
        somenteLeitura: Boolean(elemento.readOnly),
        desabilitado: Boolean(elemento.disabled),
        legivel: campoTemValorSimples(elemento)
      });
    });

    return {
      indice,
      id: String(formulario.id || ""),
      nome: String(formulario.getAttribute?.("name") || ""),
      campos
    };
  }

  function catalogarTela() {
    return listarFormularios().map(catalogarFormulario);
  }

  function localizarFormularioDaReceita(receita) {
    const candidatos = listarFormularios().filter(formulario => {
      return receita.campos.every(nome => {
        const encontrados = Array.from(formulario.elements || [])
          .filter(elemento => String(elemento?.name ?? "") === nome);
        return encontrados.length === 1;
      });
    });

    if (candidatos.length !== 1) {
      throw new Error(
        candidatos.length === 0
          ? "Não foi encontrado um formulário com todos os campos selecionados."
          : "Mais de um formulário contém os campos da receita. A leitura foi bloqueada por ambiguidade."
      );
    }

    return candidatos[0];
  }

  function lerCampo(formulario, nome) {
    const encontrados = Array.from(formulario.elements || [])
      .filter(elemento => String(elemento?.name ?? "") === nome);

    if (encontrados.length !== 1) {
      throw new Error("O campo " + nome + " não está presente de forma única.");
    }

    const elemento = encontrados[0];
    if (elemento.disabled) {
      throw new Error("O campo " + nome + " está desabilitado.");
    }
    if (!campoTemValorSimples(elemento)) {
      throw new Error("O campo " + nome + " não é um controle simples de leitura.");
    }

    return elemento.value.trim();
  }

  function criarId(nome) {
    const slug = String(nome)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 38) || "receita";
    return (slug + "-" + Date.now().toString(36)).slice(0, 64);
  }

  function carregarReceitas() {
    try {
      const bruto = pagina.localStorage.getItem(STORAGE_KEY);
      if (!bruto) return [];
      return validarColecaoReceitas(JSON.parse(bruto));
    } catch (_) {
      return [];
    }
  }

  function salvarReceitas(receitas) {
    const validadas = validarColecaoReceitas(receitas);
    pagina.localStorage.setItem(STORAGE_KEY, JSON.stringify(validadas));
    return validadas;
  }

  function baixarArquivo(nome, conteudo, tipo) {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const ancora = documento.createElement("a");
    ancora.href = url;
    ancora.download = nome;
    ancora.style.display = "none";
    documento.body.appendChild(ancora);
    ancora.click();
    ancora.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function criarElemento(tag, texto, classe) {
    const elemento = documento.createElement(tag);
    if (texto !== undefined && texto !== null) elemento.textContent = String(texto);
    if (classe) elemento.className = classe;
    return elemento;
  }

  function iniciarInterface() {
    if (documento.getElementById("st-construtor-automacoes-host")) return;

    const host = documento.createElement("div");
    host.id = "st-construtor-automacoes-host";
    host.style.position = "fixed";
    host.style.right = "18px";
    host.style.bottom = "18px";
    host.style.zIndex = "2147483646";
    documento.body.appendChild(host);

    const sombra = host.attachShadow({ mode: "open" });
    sombra.innerHTML = [
      "<style>",
      ":host{all:initial;font-family:Arial,sans-serif;color:#172033}",
      "*{box-sizing:border-box}",
      ".launcher{border:0;border-radius:999px;background:#1769d2;color:#fff;padding:11px 16px;font-size:13px;font-weight:700;box-shadow:0 4px 18px #10213a33;cursor:pointer}",
      ".panel{display:none;width:min(620px,calc(100vw - 32px));max-height:min(80vh,760px);overflow:auto;background:#f5f7fb;border:1px solid #d9e1ed;border-radius:12px;box-shadow:0 12px 44px #10213a40;margin-bottom:10px}",
      ".panel.open{display:block}",
      ".head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:#fff;border-bottom:1px solid #d9e1ed;position:sticky;top:0;z-index:2}",
      ".head strong{font-size:15px}.muted{color:#657187;font-size:12px}",
      ".body{padding:14px;display:grid;gap:12px}",
      ".card{background:#fff;border:1px solid #dce3ed;border-radius:9px;padding:12px}",
      ".row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".row.between{justify-content:space-between}",
      "label{display:block;font-size:12px;font-weight:700;margin-bottom:5px;color:#3d4b61}",
      "input[type=text],select,textarea{width:100%;border:1px solid #cbd5e1;border-radius:6px;padding:8px;font-size:13px;color:#172033;background:#fff}",
      "textarea{min-height:58px;resize:vertical}",
      "button{border:1px solid #cbd5e1;background:#fff;color:#26354c;border-radius:6px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer}",
      "button.primary{background:#1769d2;border-color:#1769d2;color:#fff}",
      "button.danger{color:#b42318;border-color:#f0c4c0}",
      "button:disabled{opacity:.45;cursor:not-allowed}",
      ".notice{font-size:12px;line-height:1.45;color:#46566e;background:#edf4ff;border:1px solid #cfe0fb;border-radius:7px;padding:9px}",
      ".status{font-size:12px;line-height:1.45;white-space:pre-wrap}",
      ".field-list{max-height:210px;overflow:auto;border:1px solid #e0e6ef;border-radius:6px;padding:6px;display:grid;gap:4px}",
      ".field{display:flex;align-items:flex-start;gap:8px;padding:5px;font-size:12px;border-bottom:1px solid #f0f2f6}",
      ".field:last-child{border-bottom:0}.field input{margin-top:2px}",
      ".field code{font-size:12px;overflow-wrap:anywhere}.field small{display:block;color:#738096;margin-top:2px}",
      ".actions{display:flex;gap:7px;flex-wrap:wrap}",
      ".results{overflow:auto;max-height:240px}",
      "table{border-collapse:collapse;width:100%;font-size:12px;background:#fff}",
      "th,td{border-bottom:1px solid #e7ebf1;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}",
      "th{color:#53627a;background:#f8fafc}",
      ".empty{font-size:12px;color:#778398;padding:9px;text-align:center}",
      "@media(max-width:520px){.panel{width:calc(100vw - 24px);max-height:82vh}.body{padding:10px}}",
      "</style>",
      "<button class='launcher' type='button'>Automações Systextil</button>",
      "<section class='panel' aria-label='Construtor de Automações'>",
      " <header class='head'><div><strong>Construtor de Automações</strong><div class='muted'>Receitas locais · modo somente leitura · v" + VERSION + "</div></div><button type='button' data-action='fechar' aria-label='Fechar painel'>Fechar</button></header>",
      " <div class='body'>",
      "  <div class='card'><div class='row between'><strong style='font-size:13px'>Tela detectada</strong><button type='button' data-action='atualizar'>Atualizar tela</button></div><div class='status' data-role='visao'>Lendo visão atual…</div><div class='muted' data-role='formularios'></div></div>",
      "  <div class='card'><label for='st-receita-salva'>Receitas salvas neste navegador</label><div class='row'><select id='st-receita-salva' aria-label='Receitas salvas' style='flex:1;min-width:180px'></select><button type='button' data-action='carregar'>Abrir</button><button type='button' class='danger' data-action='excluir'>Excluir</button></div></div>",
      "  <div class='card'><label for='st-nome-receita'>Nome da automação</label><input id='st-nome-receita' type='text' maxlength='80' placeholder='Ex.: Leitura de títulos em aberto'><label for='st-descricao-receita' style='margin-top:9px'>Descrição (opcional)</label><textarea id='st-descricao-receita' maxlength='240' placeholder='O que esta receita deve ler?'></textarea><div class='muted' data-role='visao-receita' style='margin-top:7px'></div></div>",
      "  <div class='card'><div class='row between'><strong style='font-size:13px'>Campos que serão lidos</strong><span class='muted' data-role='contagem-campos'>0 selecionados</span></div><div class='field-list' data-role='campos'><div class='empty'>Atualize a tela para listar os campos.</div></div></div>",
      "  <div class='notice'>Este MVP apenas lê os campos selecionados do formulário atual. Ele não preenche filtros, não aciona Find/F7, não navega registros e não grava dados no ERP. Faça a consulta manualmente no Systextil antes de capturar os dados.</div>",
      "  <div class='actions'><button type='button' data-action='nova'>Nova receita</button><button type='button' class='primary' data-action='salvar'>Salvar receita</button><button type='button' data-action='simular'>Validar receita</button><button type='button' class='primary' data-action='executar'>Capturar dados</button><button type='button' data-action='exportar-csv' disabled>Exportar CSV</button></div>",
      "  <div class='actions'><button type='button' data-action='exportar-json'>Exportar receitas JSON</button><button type='button' data-action='importar-json'>Importar receitas JSON</button><input type='file' accept='application/json,.json' data-role='arquivo-json' hidden></div>",
      "  <div class='card'><strong style='font-size:13px'>Resultado</strong><div class='status' data-role='status' aria-live='polite'>Nenhuma execução nesta sessão.</div><div class='results' data-role='resultado'><div class='empty'>Nenhum dado capturado.</div></div></div>",
      " </div>",
      "</section>"
    ].join("");

    const painel = sombra.querySelector(".panel");
    const botaoAbrir = sombra.querySelector(".launcher");
    const botaoFechar = sombra.querySelector("[data-action='fechar']");
    const seletorReceitas = sombra.querySelector("#st-receita-salva");
    const nomeReceita = sombra.querySelector("#st-nome-receita");
    const descricaoReceita = sombra.querySelector("#st-descricao-receita");
    const listaCampos = sombra.querySelector("[data-role='campos']");
    const visaoLabel = sombra.querySelector("[data-role='visao']");
    const formulariosLabel = sombra.querySelector("[data-role='formularios']");
    const visaoReceitaLabel = sombra.querySelector("[data-role='visao-receita']");
    const contagemCamposLabel = sombra.querySelector("[data-role='contagem-campos']");
    const statusLabel = sombra.querySelector("[data-role='status']");
    const resultadoBox = sombra.querySelector("[data-role='resultado']");
    const arquivoJson = sombra.querySelector("[data-role='arquivo-json']");
    const botaoCsv = sombra.querySelector("[data-action='exportar-csv']");

    let receitas = carregarReceitas();
    let receitaAtivaId = receitas[0]?.id || "";
    let catalogo = [];
    let ultimoResultado = null;

    function definirStatus(mensagem, erro) {
      statusLabel.textContent = mensagem;
      statusLabel.style.color = erro ? "#b42318" : "#31445f";
    }

    function obterReceitaAtiva() {
      return receitas.find(receita => receita.id === receitaAtivaId) || null;
    }

    function camposMarcados() {
      return Array.from(listaCampos.querySelectorAll("input[type='checkbox']:checked"))
        .map(input => input.value);
    }

    function renderizarSeletorReceitas() {
      seletorReceitas.replaceChildren();
      const opcaoInicial = criarElemento(
        "option",
        receitas.length ? "Selecione uma receita" : "Nenhuma receita salva"
      );
      opcaoInicial.value = "";
      seletorReceitas.appendChild(opcaoInicial);

      receitas.forEach(receita => {
        const opcao = criarElemento("option", receita.nome);
        opcao.value = receita.id;
        seletorReceitas.appendChild(opcao);
      });
      seletorReceitas.value = receitaAtivaId;
    }

    function renderizarCatalogo(camposSelecionados = []) {
      listaCampos.replaceChildren();
      const visao = lerVisaoAtual();
      visaoReceitaLabel.textContent = visao
        ? "Visão vinculada: " + visao
        : "Visão indisponível. Abra uma tela do Systextil e atualize.";

      if (!visao || catalogo.length === 0) {
        listaCampos.appendChild(criarElemento("div", "Nenhum campo identificável nesta tela.", "empty"));
        contagemCamposLabel.textContent = "0 selecionados";
        return;
      }

      catalogo.forEach(formulario => {
        const titulo = criarElemento("div",
          "Formulário " + (formulario.id || formulario.nome || ("#" + (formulario.indice + 1))),
          "muted");
        titulo.style.padding = "7px 3px 3px";
        listaCampos.appendChild(titulo);

        formulario.campos.forEach(campo => {
          const linha = criarElemento("label", null, "field");
          const checkbox = documento.createElement("input");
          checkbox.type = "checkbox";
          checkbox.value = campo.nome;
          checkbox.checked = camposSelecionados.includes(campo.nome);
          checkbox.disabled = campo.ocorrencias !== 1 || !campo.legivel || campo.desabilitado;
          checkbox.addEventListener("change", atualizarContagem);
          const texto = documento.createElement("span");
          const codigo = criarElemento("code", campo.nome);
          const detalhes = criarElemento("small",
            campo.tipo + " · " +
            (campo.somenteLeitura ? "somente leitura" : "editável") + " · " +
            (campo.desabilitado ? "desabilitado" : "habilitado") + " · " +
            campo.ocorrencias + " ocorrência(s)");
          texto.append(codigo, detalhes);
          linha.append(checkbox, texto);
          listaCampos.appendChild(linha);
        });
      });

      total = camposMarcados().length;
      contagemCamposLabel.textContent = total + " selecionados";
    }

    function atualizarContagem() {
      contagemCamposLabel.textContent = camposMarcados().length + " selecionados";
    }

    function atualizarTela(camposSelecionados = camposMarcados()) {
      const visao = lerVisaoAtual();
      catalogo = catalogarTela();
      visaoLabel.textContent = visao || "Não foi possível identificar curDataView.name.";
      formulariosLabel.textContent = catalogo.length + " formulário(s) encontrado(s).";
      renderizarCatalogo(camposSelecionados);
      definirStatus("Tela atualizada. Nenhum comando foi enviado ao ERP.", false);
    }

    function carregarReceitaSelecionada() {
      const receita = receitas.find(item => item.id === seletorReceitas.value);
      if (!receita) {
        definirStatus("Selecione uma receita válida.", true);
        return;
      }
      receitaAtivaId = receita.id;
      nomeReceita.value = receita.nome;
      descricaoReceita.value = receita.descricao;
      atualizarTela(receita.campos);
      definirStatus("Receita carregada: " + receita.nome, false);
    }

    function salvarReceitaAtual() {
      const nome = nomeReceita.value.trim();
      const visao = lerVisaoAtual();
      const campos = camposMarcados();

      if (!visao) throw new Error("Não foi possível identificar a visão atual do Systextil.");
      if (campos.length === 0) throw new Error("Selecione pelo menos um campo.");
      if (campos.length > MAX_CAMPOS_RECEITA) {
        throw new Error("O limite é de " + MAX_CAMPOS_RECEITA + " campos por receita.");
      }

      const atual = obterReceitaAtiva();
      if (atual && atual.visao !== visao) {
        throw new Error(
          "Esta receita pertence à visão " + atual.visao +
          ". Use Nova receita para criar uma automação para outra tela."
        );
      }

      const receita = validarReceita({
        schema: 1,
        id: atual?.id || criarId(nome),
        nome,
        descricao: descricaoReceita.value,
        visao,
        campos,
        criadaEm: atual?.criadaEm || Date.now(),
        atualizadaEm: Date.now()
      });

      const indice = receitas.findIndex(item => item.id === receita.id);
      const proxima = receitas.slice();
      if (indice >= 0) proxima[indice] = receita;
      else proxima.push(receita);

      if (proxima.length > MAX_RECEITAS) {
        throw new Error("O limite é de " + MAX_RECEITAS + " receitas salvas.");
      }

      receitas = salvarReceitas(proxima);
      receitaAtivaId = receita.id;
      renderizarSeletorReceitas();
      definirStatus("Receita salva neste navegador. Nenhum dado do ERP foi persistido.", false);
    }

    function validarReceitaAtiva() {
      const entrada = {
        schema: 1,
        id: receitaAtivaId,
        nome: nomeReceita.value.trim(),
        descricao: descricaoReceita.value,
        visao: lerVisaoAtual(),
        campos: camposMarcados(),
        criadaEm: Date.now(),
        atualizadaEm: Date.now()
      };
      const receita = validarReceita(entrada);
      if (receita.visao !== lerVisaoAtual()) {
        throw new Error("A visão atual não corresponde à visão da receita.");
      }

      const salva = obterReceitaAtiva();
      if (salva && salva.visao !== receita.visao) {
        throw new Error("A receita pertence à visão " + salva.visao + ". Abra essa visão antes de executar.");
      }
      if (salva && salva.campos.join("\n") !== receita.campos.join("\n")) {
        throw new Error("Os campos selecionados diferem da receita salva. Salve a receita antes de executar.");
      }
      if (!salva) {
        throw new Error("Salve a receita antes de validar ou capturar os dados.");
      }
      return receita;
    }

    function simularReceita() {
      const receita = validarReceitaAtiva();
      const formulario = localizarFormularioDaReceita(receita);
      statusLabel.textContent =
        "Validação aprovada.\n" +
        "Visão: " + receita.visao + "\n" +
        "Campos: " + receita.campos.length + "\n" +
        "Formulário: " + (formulario.id || formulario.name || "identificado por campos") + "\n" +
        "A simulação não leu valores nem enviou comandos.";
      statusLabel.style.color = "#17633a";
    }

    function renderizarResultado(receita, registro) {
      resultadoBox.replaceChildren();
      const tabela = documento.createElement("table");
      const cabecalho = documento.createElement("thead");
      const linhaCabecalho = documento.createElement("tr");
      linhaCabecalho.append(
        criarElemento("th", "Campo"),
        criarElemento("th", "Valor capturado")
      );
      cabecalho.appendChild(linhaCabecalho);
      tabela.appendChild(cabecalho);

      const corpo = documento.createElement("tbody");
      receita.campos.forEach(nome => {
        const linha = documento.createElement("tr");
        linha.append(
          criarElemento("td", nome),
          criarElemento("td", registro[nome] ?? "")
        );
        corpo.appendChild(linha);
      });
      tabela.appendChild(corpo);
      resultadoBox.appendChild(tabela);
    }

    function capturarDados() {
      const receita = validarReceitaAtiva();
      const formulario = localizarFormularioDaReceita(receita);
      const registro = {};

      receita.campos.forEach(nome => {
        registro[nome] = lerCampo(formulario, nome);
      });

      ultimoResultado = {
        receitaId: receita.id,
        campos: receita.campos.slice(),
        registro,
        capturadoEm: new Date().toISOString()
      };
      renderizarResultado(receita, registro);
      botaoCsv.disabled = false;
      definirStatus(
        "Leitura concluída: " + receita.campos.length +
        " campo(s). Os dados permanecem apenas nesta aba até ela ser fechada ou uma nova captura ocorrer.",
        false
      );
    }

    function novaReceita() {
      receitaAtivaId = "";
      seletorReceitas.value = "";
      nomeReceita.value = "";
      descricaoReceita.value = "";
      atualizarTela([]);
      definirStatus("Rascunho novo. Selecione os campos e salve como uma receita independente.", false);
    }

    function excluirReceita() {
      const receita = obterReceitaAtiva();
      if (!receita) throw new Error("Nenhuma receita selecionada.");
      if (!window.confirm("Excluir a receita \"" + receita.nome + "\" deste navegador?")) return;
      receitas = salvarReceitas(receitas.filter(item => item.id !== receita.id));
      receitaAtivaId = receitas[0]?.id || "";
      renderizarSeletorReceitas();
      const proxima = obterReceitaAtiva();
      nomeReceita.value = proxima?.nome || "";
      descricaoReceita.value = proxima?.descricao || "";
      atualizarTela(proxima?.campos || []);
      ultimoResultado = null;
      botaoCsv.disabled = true;
      resultadoBox.replaceChildren(criarElemento("div", "Nenhum dado capturado.", "empty"));
      definirStatus("Receita excluída.", false);
    }

    function exportarReceitasJson() {
      if (receitas.length === 0) throw new Error("Não há receitas para exportar.");
      const conteudo = JSON.stringify({ schema: 1, receitas }, null, 2);
      baixarArquivo("systextil-receitas.json", conteudo, "application/json;charset=utf-8");
      definirStatus("Arquivo JSON das receitas gerado localmente.", false);
    }

    function importarReceitasJson(arquivo) {
      if (arquivo.size > 1024 * 1024) {
        return Promise.reject(new Error("O arquivo JSON ultrapassa o limite de 1 MB."));
      }

      return arquivo.text().then(texto => {
        const dados = JSON.parse(texto);
        const lista = Array.isArray(dados) ? dados : dados?.receitas;
        const importadas = validarColecaoReceitas(lista);
        const idsExistentes = new Set(receitas.map(receita => receita.id));
        const conflitos = importadas.filter(receita => idsExistentes.has(receita.id));
        if (conflitos.length && !window.confirm(
          "O arquivo contém " + conflitos.length +
          " receita(s) já salvas. Deseja substituir essas receitas?"
        )) {
          definirStatus("Importação cancelada; nenhuma receita foi alterada.", false);
          return;
        }

        const porId = new Map(receitas.map(receita => [receita.id, receita]));
        importadas.forEach(receita => porId.set(receita.id, receita));
        receitas = salvarReceitas(Array.from(porId.values()));
        if (receitas.length > MAX_RECEITAS) {
          throw new Error("O arquivo excede o limite de " + MAX_RECEITAS + " receitas.");
        }
        receitaAtivaId = importadas[0]?.id || receitaAtivaId;
        renderizarSeletorReceitas();
        const ativa = obterReceitaAtiva();
        if (ativa) {
          nomeReceita.value = ativa.nome;
          descricaoReceita.value = ativa.descricao;
          atualizarTela(ativa.campos);
        }
        definirStatus(importadas.length + " receita(s) importada(s). Nenhuma ação do ERP foi executada.", false);
      });
    }

    function exportarCsvAtual() {
      if (!ultimoResultado) throw new Error("Capture os dados antes de exportar.");
      const receita = receitas.find(item => item.id === ultimoResultado.receitaId);
      if (!receita) throw new Error("A receita da captura não está mais disponível.");
      const csv = gerarCsv(ultimoResultado.campos, ultimoResultado.registro);
      baixarArquivo(criarNomeArquivo(receita.nome, "csv"), csv, "text/csv;charset=utf-8");
      definirStatus("CSV gerado com UTF-8 BOM, separador ponto e vírgula e proteção contra fórmulas.", false);
    }

    function tratarErro(erro) {
      definirStatus(erro?.message || "A operação não pôde ser concluída.", true);
    }

    botaoAbrir.addEventListener("click", () => {
      painel.classList.toggle("open");
      if (painel.classList.contains("open")) atualizarTela(camposMarcados());
    });
    botaoFechar.addEventListener("click", () => painel.classList.remove("open"));

    sombra.addEventListener("click", evento => {
      const botao = evento.target.closest?.("button[data-action]");
      if (!botao) return;
      const acao = botao.getAttribute("data-action");
      try {
        if (acao === "atualizar") atualizarTela(camposMarcados());
        if (acao === "nova") novaReceita();
        if (acao === "carregar") carregarReceitaSelecionada();
        if (acao === "salvar") salvarReceitaAtual();
        if (acao === "simular") simularReceita();
        if (acao === "executar") capturarDados();
        if (acao === "excluir") excluirReceita();
        if (acao === "exportar-json") exportarReceitasJson();
        if (acao === "exportar-csv") exportarCsvAtual();
        if (acao === "importar-json") arquivoJson.click();
      } catch (erro) {
        tratarErro(erro);
      }
    });

    seletorReceitas.addEventListener("change", () => {
      receitaAtivaId = seletorReceitas.value;
    });

    arquivoJson.addEventListener("change", () => {
      const arquivo = arquivoJson.files?.[0];
      arquivoJson.value = "";
      if (!arquivo) return;
      importarReceitasJson(arquivo).catch(tratarErro);
    });

    renderizarSeletorReceitas();
    const primeiraReceita = obterReceitaAtiva();
    if (primeiraReceita) {
      nomeReceita.value = primeiraReceita.nome;
      descricaoReceita.value = primeiraReceita.descricao;
    }
    atualizarTela(primeiraReceita?.campos || []);
  }

  if (documento.body) iniciarInterface();
  else documento.addEventListener("DOMContentLoaded", iniciarInterface, { once: true });
})();