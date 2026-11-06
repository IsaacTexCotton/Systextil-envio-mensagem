// ==UserScript==
// @name         Systextil - Segunda Via Automática CRM
// @namespace    https://texcotton.com.br/tampermonkey
// @version      0.2.0
// @description  Recebe o título da ponte SmartTable e automatiza consulta, emissão, identificação do processo e download.
// @match        http://systextil.texcotton.com.br/systextil/*
// @match        https://systextil.texcotton.com.br/systextil/*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Como funciona
 * -------------
 * Este script NÃO substitui o "Systextil - Segunda Via de Boleto". Ele conduz o painel daquele
 * script (preencher, registrar a emissão, analisar o processo e baixar o PDF) e cuida do que
 * faltava automatizar: a busca (Find), a conferência do resultado e a emissão do boleto.
 *
 * Fluxo na Consulta de títulos (uma ação sua: digitar título e parcela e clicar em "Gerar"):
 *   1. Limpa a tela (Clear To Find), se preciso.
 *   2. Preenche título e parcela pelo painel do script base (sequência já validada).
 *   3. Clica em Find e espera o sistema ficar ocioso.
 *   4. Confere: exatamente 1 registro, com o mesmo título e parcela digitados e com cliente.
 *      Se qualquer item falhar, NADA é emitido.
 *   5. Registra o bloqueio contra emissão repetida (5 minutos) e clica em "Emite boleto".
 *
 * Fluxo em Processos agendados (automático quando a tela estiver aberta):
 *   6. Analisa o processo, aguardando a conclusão; ao concluir, baixa o PDF pelo painel base.
 *
 * Esc interrompe a qualquer momento. Nenhum dado de cliente é gravado fora do painel.
 */

(function () {
  "use strict";

  const VERSAO = "0.2.0";
  const VERSAO_MINIMA_BASE = [0, 6, 0];
  const EVENTO_PEDIDO_APLICADO = "smarttable:systextil:pedido-aplicado";
  const CHAVE_AUTOMACAO_PEDIDO = "st-auto-segunda-via:pedido:";

  // <<ORQUESTRADOR
  const VISAO_CONSULTA = "forms.crec.crec_f090";
  const VISAO_PROCESSOS = "forms.systextil.batch";
  const JANELA_BLOQUEIO_EMISSAO_MS = 5 * 60 * 1000;
  const PREFIXO_CHAVE_EMISSAO = "st-auto-segunda-via:emissao:";

  /**
   * Núcleo do fluxo, sem acesso direto ao navegador: tudo que toca a página entra por "d".
   * Isso permite testar a lógica de segurança com dublês.
   */
  function criarOrquestrador(d) {
    const semAcento = (s) => String(s ?? "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim().toLowerCase();

    const norm = (s) => {
      const v = String(s ?? "").trim().toUpperCase();
      return /^\d+$/.test(v) ? (v.replace(/^0+/, "") || "0") : v;
    };

    function verificarCancelamento() {
      if (d.cancelado()) throw new Error("Interrompido por você.");
    }

    async function esperarEstado(condicao, descricao, limiteMs) {
      const limite = limiteMs || 20000;
      const inicio = d.agora();
      for (;;) {
        verificarCancelamento();
        await d.aguardarOcioso();
        const estado = d.lerEstado();
        if (estado && condicao(estado)) return estado;
        if (d.agora() - inicio > limite) {
          throw new Error("Tempo esgotado esperando " + descricao + ".");
        }
        await d.pausa(80);
      }
    }

    function classificarAnalise(texto) {
      const t = semAcento(texto);
      if (t.includes("concluido com sucesso")) return "sucesso";
      if (t.includes("ainda nao foi localizado") || t.includes("ainda nao apresenta confirmacao")) {
        return "aguardando";
      }
      return "erro";
    }

    function classificarDownload(texto) {
      const t = semAcento(texto);
      if (t.includes("pdf salvo na pasta configurada")) return "ok";
      if (t.includes("resultado indeterminado")) return "indeterminado";
      if (t.startsWith("conferindo a emissao") || t === "o download ainda nao foi solicitado.") {
        return "andamento";
      }
      return "erro";
    }

    async function executarConsulta(entrada) {
      const titulo = String(entrada?.titulo ?? "").trim();
      const parcela = String(entrada?.parcela ?? "").trim();

      // Só letras e números: "-" é operador de intervalo e "," é OU na busca do sistema.
      if (!/^[A-Za-z0-9_-]+$/.test(titulo)) {
        throw new Error("Informe o número do título (somente letras e números).");
      }
      if (!/^[A-Za-z0-9_-]+$/.test(parcela)) {
        throw new Error("Informe a parcela (somente letras e números).");
      }

      const chave = PREFIXO_CHAVE_EMISSAO + norm(titulo) + "." + norm(parcela);
      const anterior = Number(d.armazenamento.getItem(chave));
      if (Number.isFinite(anterior) && anterior > 0 && d.agora() - anterior < JANELA_BLOQUEIO_EMISSAO_MS) {
        throw new Error(
          "Já foi solicitada uma emissão deste título e parcela há menos de 5 minutos. " +
          "Aguarde o processo ou use \"Permitir nova emissão\". Nada foi emitido agora."
        );
      }

      let estado = d.lerEstado();
      if (!estado || estado.visao !== VISAO_CONSULTA) {
        throw new Error("Abra a Consulta de títulos antes de iniciar.");
      }

      if (!estado.busca) {
        d.status("Limpando a tela para uma nova busca...");
        d.clicarBarra("limpar");
        await d.pausa(200);
        await esperarEstado((e) => e.busca === true, "a tela voltar ao modo de busca");
      }

      d.status("Preenchendo título e parcela...");
      const preenchimento = await d.preencher(titulo, parcela);
      if (!preenchimento || preenchimento.ok !== true) {
        throw new Error((preenchimento && preenchimento.texto) || "O preenchimento não foi confirmado. Nada foi consultado ou emitido.");
      }

      // A mensagem visual do painel-base não basta: a parcela precisa continuar
      // presente e idêntica no formulário real antes de qualquer consulta.
      const camposAntesBusca = d.lerCamposEntrada();
      const parcelaAntesBusca = String(camposAntesBusca?.parcela ?? "").trim();
      if (!parcelaAntesBusca) {
        throw new Error("A parcela não foi preenchida no campo do Systextil. A consulta e a emissão foram bloqueadas.");
      }
      if (parcelaAntesBusca !== parcela) {
        throw new Error("A parcela exibida no Systextil diverge da parcela recebida do CRM. A consulta e a emissão foram bloqueadas.");
      }
      const tituloAntesBusca = String(camposAntesBusca?.titulo ?? "").trim();
      if (tituloAntesBusca && norm(tituloAntesBusca) !== norm(titulo)) {
        throw new Error("O número do título exibido no Systextil diverge do valor recebido do CRM. A consulta e a emissão foram bloqueadas.");
      }

      verificarCancelamento();
      d.status("Consultando o título (Find)...");
      d.clicarBarra("buscar");
      await d.pausa(200);
      estado = await esperarEstado(
        (e) => e.busca === false || /NO_RECORDS/i.test(e.acao || ""),
        "a busca terminar"
      );

      if (estado.acao !== "RECORDS_FOUND" || estado.total < 1) {
        throw new Error("Nenhum título encontrado para esse número e parcela. Nada foi emitido.");
      }
      if (estado.total !== 1) {
        throw new Error("A busca devolveu " + estado.total + " registros (esperado: 1). Nada foi emitido.");
      }

      const campos = d.lerCampos();
      const parcelaRetornada = String(campos.parcela ?? "").trim();
      if (!parcelaRetornada) {
        throw new Error("A consulta terminou, mas o campo de parcela está vazio. Nada foi emitido.");
      }
      if (parcelaRetornada !== parcela) {
        throw new Error("A parcela retornada pelo Systextil não corresponde à parcela solicitada. Nada foi emitido.");
      }
      const tituloRetornado = String(campos.titulo ?? "").trim();
      if (!tituloRetornado) {
        throw new Error("A consulta terminou, mas o número do título não está disponível para conferência. Nada foi emitido.");
      }
      if (norm(tituloRetornado) !== norm(titulo)) {
        throw new Error("O número do título retornado pelo Systextil não corresponde ao solicitado. Nada foi emitido.");
      }
      if (!String(campos.cliente ?? "").trim()) {
        throw new Error("O nome do cliente não foi identificado na tela. Nada foi emitido.");
      }

      verificarCancelamento();
      // O bloqueio é gravado ANTES do clique: se algo falhar depois, não há emissão repetida.
      d.armazenamento.setItem(chave, String(d.agora()));
      d.status("Solicitando a emissão do boleto...");
      const emissao = await d.emitir();
      if (!emissao || emissao.registrado !== true) {
        throw new Error(
          "A emissão pode ter sido solicitada, mas o registro do horário não foi confirmado. " +
          "Confira em Processos agendados antes de tentar de novo. " + ((emissao && emissao.texto) || "")
        );
      }

      const solicitacao = typeof d.recuperarSolicitacao === "function" ? d.recuperarSolicitacao() : null;
      if (!solicitacao || norm(solicitacao.titulo) !== norm(titulo) || String(solicitacao.parcela ?? "").trim() !== parcela) {
        throw new Error("O clique de emissão ocorreu, mas o registro de controle da solicitação não corresponde ao título e à parcela. Confira Processos agendados antes de qualquer nova tentativa.");
      }
      return { titulo, parcela, cliente: String(campos.cliente).trim(), solicitadoEm: Number(solicitacao.solicitadoEm) || d.agora() };
    }

    async function executarProcessos(opcoes) {
      const limiteMs = (opcoes && opcoes.limiteMs) || 180000;
      const intervaloMs = (opcoes && opcoes.intervaloMs) || 4000;

      const estado = d.lerEstado();
      if (!estado || estado.visao !== VISAO_PROCESSOS) {
        throw new Error("Abra a tela Processos agendados.");
      }

      const inicio = d.agora();
      for (;;) {
        verificarCancelamento();
        const analise = await d.analisar();
        const classe = classificarAnalise(analise && analise.texto);

        if (classe === "sucesso") break;
        if (classe === "erro") {
          throw new Error((analise && analise.texto) || "A análise do processo não foi concluída.");
        }

        d.status("Aguardando o processo de emissão... (" + (analise.texto || "") + ")");
        if (d.agora() - inicio >= limiteMs) {
          throw new Error(
            "Tempo esgotado aguardando o processo. Última situação: " + (analise.texto || "desconhecida")
          );
        }
        if (typeof d.atualizarGrade === "function") await d.atualizarGrade();
        await d.pausa(intervaloMs);
      }

      d.status("Processo concluído. Baixando o PDF...");
      const resultado = await d.baixar();
      const classeDownload = classificarDownload(resultado && resultado.texto);

      if (classeDownload === "ok") return { texto: resultado.texto };
      if (classeDownload === "indeterminado") {
        throw new Error("Resultado indeterminado do download. Confira a pasta antes de tentar de novo. " + resultado.texto);
      }
      throw new Error((resultado && resultado.texto) || "O download não foi concluído.");
    }

    return { executarConsulta, executarProcessos, classificarAnalise, classificarDownload, norm };
  }
  // ORQUESTRADOR>>

  // Exporta somente o núcleo puro para os testes Node.js.
  if (typeof module === "object" && module.exports) {
    module.exports = Object.freeze({ criarOrquestrador });
    return;
  }

  const ID_PAINEL_BASE = "st-segunda-via-boleto-panel";
  const ID_PAINEL_AUTO = "st-auto-segunda-via-panel";
  const CHAVE_SOLICITACAO_BASE = "st-segunda-via-boleto:solicitacao";
  const ID_BOTAO_EMITIR = "BTNEmetirBoletos.";
  const NOME_BOTAO_EMITIR = "CMDEmetirBoletos";
  const IDS_BARRA = Object.freeze({ buscar: "btnFind.", limpar: "btnClearToFind.", processos: "procAgendados" });

  if (window.top !== window) return;

  const pagina = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
  const execucao = { ativa: false, contagem: false, cancelado: false, observador: null, pedidoAtual: null };
  let pedidoBridgePendente = null;
  const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------- estado da tela e monitor de comandos ----------
  function lerEstado() {
    const visao = pagina.curDataView;
    if (!visao) return null;
    return {
      visao: String(visao.name ?? ""),
      busca: !!visao.find,
      acao: String(visao.recordAction ?? ""),
      total: parseInt(visao.recordCount, 10) || 0,
      atual: parseInt(visao.recordNumber, 10) || 0
    };
  }

  function obterMonitor() {
    if (pagina.__stAutoSegundaViaMonitor) return pagina.__stAutoSegundaViaMonitor;
    if (!pagina.XMLHttpRequest || !pagina.XMLHttpRequest.prototype) {
      throw new Error("Não foi possível acessar o XMLHttpRequest da página.");
    }
    const monitor = { emAndamento: 0, ultimoFim: Date.now() };
    const prototipo = pagina.XMLHttpRequest.prototype;
    const abrirOriginal = prototipo.open;
    const enviarOriginal = prototipo.send;

    prototipo.open = function (metodo, url) {
      try { this.__stAuto = /UnifyNXJ\.jsp/i.test(String(url)); } catch (_) { /* ignora */ }
      return abrirOriginal.apply(this, arguments);
    };
    prototipo.send = function () {
      try {
        if (this.__stAuto) {
          monitor.emAndamento += 1;
          this.addEventListener("loadend", () => {
            monitor.emAndamento = Math.max(0, monitor.emAndamento - 1);
            monitor.ultimoFim = Date.now();
          }, { once: true });
        }
      } catch (_) { /* ignora */ }
      return enviarOriginal.apply(this, arguments);
    };

    pagina.__stAutoSegundaViaMonitor = monitor;
    return monitor;
  }

  async function aguardarOcioso() {
    const monitor = obterMonitor();
    const inicio = Date.now();
    for (;;) {
      if (execucao.cancelado) throw new Error("Interrompido por você.");
      if (monitor.emAndamento === 0 && Date.now() - monitor.ultimoFim >= 300) return;
      if (Date.now() - inicio > 20000) throw new Error("O Systextil não ficou ocioso em 20 segundos.");
      await pausa(60);
    }
  }

  // ---------- localizar elementos ----------
  function documentosMesmoDominio() {
    const documentos = [];
    const visitadas = new Set();
    (function visitar(janela) {
      if (!janela || visitadas.has(janela)) return;
      visitadas.add(janela);
      try { if (janela.document) documentos.push(janela.document); } catch (_) { return; }
      let total = 0;
      try { total = janela.frames.length; } catch (_) { return; }
      for (let i = 0; i < total; i += 1) {
        try { visitar(janela.frames[i]); } catch (_) { /* quadro de outra origem */ }
      }
    })(pagina);
    return documentos;
  }

  function acharPorId(id) {
    for (const documento of documentosMesmoDominio()) {
      const el = documento.getElementById(id);
      if (el) return el;
    }
    return null;
  }

  function acharBotaoEmitir() {
    const porId = acharPorId(ID_BOTAO_EMITIR);
    if (porId) return porId;
    for (const documento of documentosMesmoDominio()) {
      const el = documento.getElementsByName(NOME_BOTAO_EMITIR)[0];
      if (el) return el;
    }
    return null;
  }

  function clicarBarra(chave) {
    const id = IDS_BARRA[chave];
    if (!id) throw new Error("Botão não permitido: " + chave);
    const el = acharPorId(id);
    if (!el) throw new Error("Botão não encontrado na tela: " + id);
    el.click();
  }

  function localizarFormularioConsulta() {
    const formularios = [];
    for (const documento of documentosMesmoDominio()) {
      for (const formulario of Array.from(documento.forms || [])) {
        const titulo = formulario.elements?.namedItem?.("num_duplicata.");
        const parcela = formulario.elements?.namedItem?.("seq_duplicatas.");
        if (titulo && typeof titulo.value === "string" && parcela && typeof parcela.value === "string") formularios.push(formulario);
      }
    }
    if (formularios.length !== 1) {
      throw new Error(formularios.length === 0
        ? "O formulário de consulta com número do título e parcela não foi encontrado."
        : "Mais de um formulário de consulta foi encontrado; leitura interrompida para evitar conferir o registro errado.");
    }
    return formularios[0];
  }

  function lerCamposEntrada() {
    const formulario = localizarFormularioConsulta();
    return {
      titulo: String(formulario.elements.namedItem("num_duplicata.")?.value ?? "").trim(),
      parcela: String(formulario.elements.namedItem("seq_duplicatas.")?.value ?? "").trim()
    };
  }

  function lerCampos() {
    const formulario = localizarFormularioConsulta();
    return {
      titulo: String(formulario.elements.namedItem("num_duplicata.")?.value ?? "").trim(),
      parcela: String(formulario.elements.namedItem("seq_duplicatas.")?.value ?? "").trim(),
      cliente: String(formulario.elements.namedItem("nome_cliente.")?.value ?? "").trim()
    };
  }

  // ---------- painel do script base ----------
  function versaoBaseAceita(texto) {
    const partes = String(texto ?? "").split(".").map((n) => parseInt(n, 10));
    if (partes.length < 3 || partes.some((n) => !Number.isFinite(n))) return false;
    for (let i = 0; i < 3; i += 1) {
      if (partes[i] > VERSAO_MINIMA_BASE[i]) return true;
      if (partes[i] < VERSAO_MINIMA_BASE[i]) return false;
    }
    return true;
  }

  async function garantirPainelBase(tipo) {
    const textoEsperado = tipo === "processos" ? "Analisar processos" : "Preencher campos no Systextil";
    let painel = document.getElementById(ID_PAINEL_BASE);
    let botao = painel ? acharBotaoPorTexto(painel, textoEsperado) : null;
    if (painel && !botao) {
      painel.remove();
      painel = null;
    }
    if (!painel) {
      const evento = new pagina.KeyboardEvent("keydown", {
        key: "b", ctrlKey: true, altKey: true, bubbles: true, cancelable: true
      });
      pagina.dispatchEvent(evento);
    }
    const inicio = Date.now();
    while (Date.now() - inicio < 8000) {
      if (execucao.cancelado) throw new Error("Interrompido por você.");
      painel = document.getElementById(ID_PAINEL_BASE);
      if (painel && acharBotaoPorTexto(painel, textoEsperado)) break;
      await pausa(100);
    }
    if (!painel || !acharBotaoPorTexto(painel, textoEsperado)) {
      throw new Error(tipo === "processos"
        ? "O painel-base não abriu em Processos agendados. Confira se o userscript-base está habilitado e atualizado."
        : "O painel-base não abriu na Consulta de títulos. Confira se o userscript-base está habilitado e atualizado.");
    }
    if (!versaoBaseAceita(painel.dataset.scriptVersion)) {
      throw new Error("O script-base está na versão " + (painel.dataset.scriptVersion || "desconhecida") + ". Atualize para 0.6.0 ou superior.");
    }
    return painel;
  }

  function acharBotaoPorTexto(raiz, texto) {
    return Array.from(raiz.querySelectorAll("button")).find((b) => b.textContent.trim() === texto) || null;
  }

  async function preencherPeloPainelBase(titulo, parcela) {
    const painel = await garantirPainelBase("consulta");
    const entradaTitulo = painel.querySelector("#st-segunda-via-numero-titulo");
    const entradaParcela = painel.querySelector("#st-segunda-via-parcela");
    const botaoPreencher = acharBotaoPorTexto(painel, "Preencher campos no Systextil");
    const botaoLer = acharBotaoPorTexto(painel, "Ler dados do título (após F7)");

    if (!entradaTitulo || !entradaParcela || !botaoPreencher || !botaoLer) {
      throw new Error("O painel do script base não está na tela Consulta de títulos.");
    }

    entradaTitulo.value = titulo;
    entradaParcela.value = parcela;
    botaoPreencher.click();

    const inicio = Date.now();
    // O script base desabilita o botão durante o preenchimento e o reabilita no fim.
    while (Date.now() - inicio < 90000) {
      if (execucao.cancelado) throw new Error("Interrompido por você.");
      await pausa(120);
      if (!botaoPreencher.disabled) break;
    }
    if (botaoPreencher.disabled) throw new Error("O preenchimento não terminou em 90 segundos.");

    const texto = (botaoLer.nextElementSibling && botaoLer.nextElementSibling.textContent || "").trim();
    const confirmado = /confirmados pelos comandos NXJ/i.test(texto);
    return { ok: confirmado, texto };
  }

  async function emitirPeloBotao() {
    const painel = document.getElementById(ID_PAINEL_BASE);
    const aviso = document.getElementById(ID_PAINEL_BASE + "-emissao-status");
    const botao = acharBotaoEmitir();
    if (!painel || !aviso) throw new Error("O painel do script base não está disponível para registrar a emissão.");
    if (!botao) throw new Error("O botão Emite boleto não foi encontrado na tela. Nada foi emitido.");

    const antes = aviso.textContent;
    botao.click();
    await pausa(250);
    await aguardarOcioso();

    for (let i = 0; i < 50; i += 1) {
      await pausa(100);
      const texto = aviso.textContent;
      if (/Horário da solicitação registrado/i.test(texto) && texto !== antes) {
        return { registrado: true, texto };
      }
      if (texto !== antes && !/Horário da solicitação registrado/i.test(texto)) {
        return { registrado: false, texto };
      }
    }
    return { registrado: false, texto: "O registro do horário não apareceu no painel." };
  }

  async function analisarPeloPainelBase() {
    const painel = await garantirPainelBase("processos");
    const botao = acharBotaoPorTexto(painel, "Analisar processos");
    if (!botao) throw new Error("O painel do script base não está na tela Processos agendados.");
    botao.click();
    await pausa(400);
    const texto = (botao.nextElementSibling && botao.nextElementSibling.textContent || "").trim();
    return { texto };
  }

  async function baixarPeloPainelBase() {
    const painel = await garantirPainelBase("processos");
    const botao = acharBotaoPorTexto(painel, "Baixar PDF do processo identificado");
    if (!botao) throw new Error("O botão de download não foi encontrado no painel do script base.");
    if (botao.disabled) {
      throw new Error(
        "O botão de download está bloqueado. Confira, no painel do script base, a razão social e a chave do auxiliar local."
      );
    }
    const statusEl = botao.nextElementSibling;
    botao.click();

    const inicio = Date.now();
    while (Date.now() - inicio < 120000) {
      if (execucao.cancelado) throw new Error("Interrompido por você.");
      await pausa(500);
      const texto = (statusEl && statusEl.textContent || "").trim();
      const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const emAndamento = t.startsWith("conferindo a emissao") || t === "o download ainda nao foi solicitado.";
      if (!emAndamento) return { texto };
    }
    return { texto: "Resultado indeterminado: o download não respondeu em 2 minutos." };
  }

  async function atualizarGradePeloFind() {
    clicarBarra("buscar");
    await pausa(250);
    await aguardarOcioso();
  }

  // ---------- painel do orquestrador ----------
  let painelAuto = null;
  let entradaTitulo = null;
  let entradaParcela = null;
  let botaoGerar = null;
  let botaoParar = null;
  let caixaAtualizar = null;
  let areaStatus = null;

  function criarElemento(tag, texto) {
    const el = document.createElement(tag);
    if (texto !== undefined) el.textContent = texto;
    return el;
  }

  function status(texto, tipo) {
    if (!areaStatus) return;
    const linha = criarElemento("div", new Date().toLocaleTimeString("pt-BR") + "  " + texto);
    linha.style.padding = "2px 0";
    linha.style.color = tipo === "erro" ? "#b91c1c" : tipo === "ok" ? "#166534" : "#334155";
    if (tipo === "erro" || tipo === "ok") linha.style.fontWeight = "700";
    areaStatus.append(linha);
    while (areaStatus.childElementCount > 14) areaStatus.firstElementChild.remove();
    areaStatus.scrollTop = areaStatus.scrollHeight;
  }

  function recuperarSolicitacaoBase() {
    const fontes = [];
    try { fontes.push(window.sessionStorage); } catch (_) { /* ignora */ }
    try { if (window.opener && window.opener !== window) fontes.push(window.opener.sessionStorage); } catch (_) { /* ignora */ }
    for (const fonte of fontes) {
      try {
        const bruto = fonte.getItem(CHAVE_SOLICITACAO_BASE);
        if (!bruto) continue;
        const dados = JSON.parse(bruto);
        if (Number.isFinite(Number(dados && dados.solicitadoEm))) return dados;
      } catch (_) { /* tenta a próxima */ }
    }
    return null;
  }

  const orquestrador = criarOrquestrador({
    agora: () => Date.now(),
    pausa,
    cancelado: () => execucao.cancelado,
    status: (texto) => status(texto),
    lerEstado,
    lerCampos,
    lerCamposEntrada,
    recuperarSolicitacao: recuperarSolicitacaoBase,
    clicarBarra,
    aguardarOcioso,
    preencher: preencherPeloPainelBase,
    emitir: emitirPeloBotao,
    analisar: analisarPeloPainelBase,
    baixar: baixarPeloPainelBase,
    atualizarGrade: () => (caixaAtualizar && caixaAtualizar.checked ? atualizarGradePeloFind() : Promise.resolve()),
    get armazenamento() { return pagina.sessionStorage; }
  });

  function atualizarControles() {
    if (!painelAuto) return;
    const estado = lerEstado();
    const noProcessos = !!estado && estado.visao === VISAO_PROCESSOS;
    botaoGerar.disabled = execucao.ativa;
    botaoGerar.textContent = noProcessos ? "Processar e baixar PDF" : "Executar segunda via";
    botaoGerar.style.opacity = execucao.ativa ? "0.6" : "1";
    botaoGerar.style.cursor = execucao.ativa ? "wait" : "pointer";
    botaoParar.disabled = !execucao.ativa;
    entradaTitulo.disabled = execucao.ativa;
    entradaParcela.disabled = execucao.ativa;
  }

  function pararObservador() {
    if (execucao.observador) {
      clearInterval(execucao.observador);
      execucao.observador = null;
    }
  }

  async function rodarProcessos() {
    if (execucao.ativa) return;
    execucao.ativa = true;
    execucao.cancelado = false;
    atualizarControles();
    try {
      await garantirPainelBase("processos");
      const r = await orquestrador.executarProcessos({ limiteMs: 180000, intervaloMs: 4000 });
      status(r.texto, "ok");
    } catch (erro) {
      status(erro.message, "erro");
    } finally {
      execucao.ativa = false;
      atualizarControles();
    }
  }

  function observarChegadaEmProcessos() {
    pararObservador();
    const inicio = Date.now();
    status("Emissão registrada. Aguardando a abertura automática de Processos agendados...");
    execucao.observador = setInterval(() => {
      if (Date.now() - inicio > 15 * 60 * 1000) {
        pararObservador();
        status("A tela Processos agendados não foi detectada dentro do prazo. A emissão não será repetida; confira a solicitação registrada.", "erro");
        return;
      }
      const estado = lerEstado();
      if (execucao.ativa || !estado || estado.visao !== VISAO_PROCESSOS) return;
      pararObservador();
      status("Processos agendados detectado. Iniciando a identificação do processo.");
      rodarProcessos();
    }, 1000);
  }

  function abrirProcessosAgendados() {
    const botao = acharPorId("procAgendados");
    if (!botao) {
      status("O botão procAgendados não foi encontrado. A emissão já foi solicitada; não tente emitir novamente.", "erro");
      return false;
    }
    botao.click();
    return true;
  }

  async function acaoGerar() {
    if (execucao.ativa) return;
    const estado = lerEstado();
    if (estado && estado.visao === VISAO_PROCESSOS) {
      await rodarProcessos();
      return;
    }

    execucao.ativa = true;
    execucao.cancelado = false;
    atualizarControles();
    try {
      const r = await orquestrador.executarConsulta({ titulo: entradaTitulo.value, parcela: entradaParcela.value });
      execucao.pedidoAtual = { titulo: r.titulo, parcela: r.parcela, cliente: r.cliente };
      status("Emissão solicitada para o título " + r.titulo + ", parcela " + r.parcela + ". Abrindo Processos agendados...");
      if (abrirProcessosAgendados()) observarChegadaEmProcessos();
    } catch (erro) {
      status(erro.message, "erro");
    } finally {
      execucao.ativa = false;
      atualizarControles();
    }
  }

  function permitirNovaEmissao() {
    try {
      const titulo = entradaTitulo.value.trim();
      const parcela = entradaParcela.value.trim();
      if (!titulo || !parcela) { status("Informe título e parcela para liberar uma nova emissão.", "erro"); return; }
      pagina.sessionStorage.removeItem(PREFIXO_CHAVE_EMISSAO + orquestrador.norm(titulo) + "." + orquestrador.norm(parcela));
      status("Bloqueio removido para este título e parcela. Confirme em Processos agendados antes de emitir de novo.", "ok");
    } catch (erro) {
      status(erro.message, "erro");
    }
  }

  function lerPedidoDaReferencia() {
    const referencia = document.getElementById("st-crm-systextil-reference");
    const campoTitulo = document.getElementById("st-segunda-via-numero-titulo");
    const campoParcela = document.getElementById("st-segunda-via-parcela");
    const id = String(referencia?.dataset?.pedidoId ?? "").trim();
    const titulo = String(campoTitulo?.value ?? "").trim();
    const parcela = String(campoParcela?.value ?? "").trim();
    if (!id || !titulo || !parcela) return null;
    return { id, titulo, parcela, razaoSocial: String(referencia?.dataset?.razaoSocial ?? "").trim() };
  }

  function processarPedidoBridge(pedido) {
    const id = String(pedido?.id ?? "").trim();
    const titulo = String(pedido?.titulo ?? "").trim();
    const parcela = String(pedido?.parcela ?? "").trim();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(id) || !/^[A-Za-z0-9_-]+$/.test(titulo) || !/^[A-Za-z0-9_-]+$/.test(parcela)) {
      status("A ponte enviou uma solicitação incompleta ou inválida. Nenhuma consulta ou emissão foi iniciada.", "erro");
      return;
    }
    const aplicado = lerPedidoDaReferencia();
    if (!aplicado || aplicado.id !== id || aplicado.titulo !== titulo || aplicado.parcela !== parcela) {
      status("A transferência recebida não corresponde aos campos auxiliares conferidos. A automação foi bloqueada.", "erro");
      return;
    }
    const chave = CHAVE_AUTOMACAO_PEDIDO + id;
    try {
      if (pagina.sessionStorage.getItem(chave)) {
        status("Esta transferência já foi processada nesta sessão. Não será repetida automaticamente.");
        return;
      }
      pagina.sessionStorage.setItem(chave, "iniciada");
    } catch (_) {
      status("Não foi possível registrar a proteção contra repetição da transferência. Automação bloqueada.", "erro");
      return;
    }
    execucao.pedidoAtual = { id, titulo, parcela, razaoSocial: String(pedido.razaoSocial ?? "").trim() };
    if (entradaTitulo && entradaParcela) {
      entradaTitulo.value = titulo;
      entradaParcela.value = parcela;
    } else {
      pedidoBridgePendente = execucao.pedidoAtual;
      return;
    }
    status("Título recebido do CRM. Iniciando preenchimento e conferência automática...");
    void acaoGerar();
  }

  function receberPedidoBridge(evento) {
    let pedido = evento?.detail;
    try {
      if (typeof pedido === "string") pedido = JSON.parse(pedido);
    } catch (_) {
      status("A mensagem recebida da ponte não pôde ser interpretada. Automação bloqueada.", "erro");
      return;
    }
    processarPedidoBridge(pedido);
  }

  function montarPainelAuto() {
    const existente = document.getElementById(ID_PAINEL_AUTO);
    if (existente) existente.remove();

    painelAuto = criarElemento("section");
    painelAuto.id = ID_PAINEL_AUTO;
    Object.assign(painelAuto.style, {
      position: "fixed", left: "18px", bottom: "18px", zIndex: "2147483000", width: "330px",
      maxWidth: "calc(100vw - 36px)", boxSizing: "border-box", padding: "14px",
      border: "1px solid #cbd5e1", borderRadius: "8px", background: "#ffffff", color: "#172033",
      boxShadow: "0 8px 28px rgba(15, 23, 42, 0.20)", font: "13px/1.45 Arial, sans-serif"
    });

    const titulo = criarElemento("strong", "Segunda via automática v" + VERSAO);
    titulo.style.display = "block";
    titulo.style.marginBottom = "8px";

    const explicacao = criarElemento(
      "p",
      "Ao receber um título da ponte SmartTable, o fluxo começa automaticamente: preenche, consulta, emite, identifica o processo e baixa o PDF. Esc interrompe."
    );
    explicacao.style.margin = "0 0 10px";
    explicacao.style.color = "#475569";

    const criarEntrada = (rotulo, placeholder) => {
      const grupo = criarElemento("label");
      Object.assign(grupo.style, { display: "grid", gap: "4px", margin: "0 0 8px", fontWeight: "600", color: "#334155" });
      const legenda = criarElemento("span", rotulo);
      legenda.style.fontSize = "12px";
      const campo = document.createElement("input");
      campo.type = "text";
      campo.placeholder = placeholder;
      campo.autocomplete = "off";
      campo.spellcheck = false;
      Object.assign(campo.style, {
        width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: "5px",
        padding: "8px", font: "13px Arial, sans-serif", color: "#172033", background: "#ffffff"
      });
      grupo.append(legenda, campo);
      painelAuto.append(grupo);
      return campo;
    };

    painelAuto.append(titulo, explicacao);
    entradaTitulo = criarEntrada("Número do título", "Informe o número do título");
    entradaParcela = criarEntrada("Parcela", "Informe a parcela");

    botaoGerar = criarElemento("button", "Gerar segunda via");
    botaoGerar.type = "button";
    Object.assign(botaoGerar.style, {
      width: "100%", border: "0", borderRadius: "5px", padding: "9px 12px", background: "#0f766e",
      color: "#ffffff", fontWeight: "600", cursor: "pointer"
    });
    botaoGerar.addEventListener("click", acaoGerar);

    botaoParar = criarElemento("button", "Parar (Esc)");
    botaoParar.type = "button";
    Object.assign(botaoParar.style, {
      width: "100%", marginTop: "6px", border: "1px solid #b91c1c", borderRadius: "5px", padding: "7px 10px",
      background: "#ffffff", color: "#b91c1c", fontWeight: "600", cursor: "pointer"
    });
    botaoParar.addEventListener("click", () => { execucao.cancelado = true; });

    const rotuloAtualizar = criarElemento("label");
    rotuloAtualizar.style.cssText = "display:block;margin-top:8px;color:#475569;font-size:12px";
    caixaAtualizar = document.createElement("input");
    caixaAtualizar.type = "checkbox";
    caixaAtualizar.checked = true;
    caixaAtualizar.style.marginRight = "6px";
    rotuloAtualizar.append(caixaAtualizar, document.createTextNode("Atualizar a grade automaticamente enquanto aguarda o processo"));

    const botaoLiberar = criarElemento("button", "Permitir nova emissão deste título");
    botaoLiberar.type = "button";
    Object.assign(botaoLiberar.style, {
      marginTop: "8px", border: "1px solid #cbd5e1", borderRadius: "5px", padding: "6px 10px",
      background: "#ffffff", color: "#334155", cursor: "pointer"
    });
    botaoLiberar.addEventListener("click", permitirNovaEmissao);

    const fechar = criarElemento("button", "Fechar");
    Object.assign(fechar.style, {
      marginTop: "8px", marginLeft: "6px", border: "1px solid #cbd5e1", borderRadius: "5px",
      padding: "6px 10px", background: "#ffffff", color: "#334155", cursor: "pointer"
    });
    fechar.addEventListener("click", () => {
      if (execucao.ativa) { execucao.cancelado = true; }
      pararObservador();
      painelAuto.remove();
      painelAuto = null;
    });

    areaStatus = criarElemento("div");
    Object.assign(areaStatus.style, {
      marginTop: "10px", padding: "8px", background: "#f1f5f9", borderRadius: "5px",
      maxHeight: "170px", overflowY: "auto", fontSize: "12px", whiteSpace: "pre-wrap"
    });
    areaStatus.setAttribute("aria-live", "polite");

    painelAuto.append(botaoGerar, botaoParar, rotuloAtualizar, botaoLiberar, fechar, areaStatus);
    document.body.append(painelAuto);
    atualizarControles();
    if (pedidoBridgePendente) {
      const pendente = pedidoBridgePendente;
      pedidoBridgePendente = null;
      if (entradaTitulo && entradaParcela) {
        entradaTitulo.value = pendente.titulo;
        entradaParcela.value = pendente.parcela;
        void acaoGerar();
      }
    }
  }

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && (execucao.ativa || execucao.contagem)) execucao.cancelado = true;
  }, true);

  // ---------- início ----------
  document.addEventListener(EVENTO_PEDIDO_APLICADO, receberPedidoBridge, true);

  async function aguardarVisaoInicial(limiteMs) {
    const inicio = Date.now();
    while (Date.now() - inicio < limiteMs) {
      if (execucao.cancelado) return null;
      const estado = lerEstado();
      if (estado && (estado.visao === VISAO_CONSULTA || estado.visao === VISAO_PROCESSOS)) return estado;
      await pausa(150);
    }
    return null;
  }

  async function iniciar() {
    const estadoInicial = await aguardarVisaoInicial(25000);
    if (!estadoInicial) {
      console.warn("[Segunda Via Automática] A visão da Consulta de títulos ou Processos agendados não ficou disponível.");
      return;
    }

    try { obterMonitor(); } catch (erro) { console.warn("[Segunda Via Automática] " + erro.message); }
    montarPainelAuto();
    status(
      estadoInicial.visao === VISAO_CONSULTA
        ? "Pronto. O envio de um título pelo CRM iniciará a automação."
        : "Processos agendados detectado."
    );

    if (estadoInicial.visao === VISAO_PROCESSOS && recuperarSolicitacaoBase()) {
      (async () => {
        status("Solicitação de emissão recuperada. Iniciando a análise em 3 s (Esc cancela).");
        execucao.cancelado = false;
        execucao.contagem = true;
        await pausa(3000);
        execucao.contagem = false;
        if (execucao.cancelado) {
          status("Início automático cancelado.");
          execucao.cancelado = false;
          return;
        }
        await rodarProcessos();
      })();
      return;
    }

    const pedidoExistente = lerPedidoDaReferencia();
    if (estadoInicial.visao === VISAO_CONSULTA && pedidoExistente) {
      processarPedidoBridge(pedidoExistente);
    }
  }

  void iniciar();
})();