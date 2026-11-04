// ==UserScript==
// @name         Systextil - Segunda Via de Boleto (conferência)
// @namespace    https://texcotton.com.br/tampermonkey
// @version      0.3.0
// @updateURL     https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via-boleto.user.js
// @downloadURL   https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via-boleto.user.js
// @description  Consulta e identifica o processo da segunda via sem recarregar a página.
// @match        http://systextil.texcotton.com.br/systextil/*
// @match        https://systextil.texcotton.com.br/systextil/*
// @run-at       context-menu
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.3.0";
  const PANEL_ID = "st-segunda-via-boleto-panel";

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

      const dentroDaJanela =
        executadoEm >= instanteSolicitacao - TOLERANCIA_HORARIO_PROCESSO_MS &&
        executadoEm <= atual + TOLERANCIA_HORARIO_PROCESSO_MS;

      if (!dentroDaJanela) return;

      candidatos.push({
        titulo: registro.titulo,
        dataExecucao: registro.dataExecucao,
        executadoEm,
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

    if (candidatos.length > 1) {
      return {
        status: "ambiguo",
        mensagem: "Mais de um processo corresponde ao horário da solicitação. A identificação automática foi interrompida.",
        candidatos: candidatos.length
      };
    }

    const registro = candidatos[0];
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

    if (!titulo || !parcela) {
      throw new Error("O título e a parcela precisam estar preenchidos antes da emissão.");
    }

    const solicitacao = {
      solicitadoEm: Date.now(),
      titulo,
      parcela,
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
        "A identificação é somente leitura. Nenhuma linha foi selecionada e nenhum PDF foi baixado."
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
      width: "360px",
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
      "Analisa a grade em modo somente leitura e procura uma única emissão solicitada nesta sessão."
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

    botaoAnalisar.addEventListener("click", function () {
      try {
        const pedidoAtual = recuperarSolicitacaoEmissao();
        const registros = lerRegistrosProcessos();
        const analise = analisarProcessos(registros, pedidoAtual, Date.now());
        renderizarResultadoProcessos(resultado, analise);
      } catch (erro) {
        renderizarResultadoProcessos(resultado, {
          status: "nao-verificavel",
          mensagem: erro.message
        });
      }
    });

    botaoLimpar.addEventListener("click", function () {
      limparSolicitacaoEmissao();
      resumo.textContent = "Solicitação local removida. Para uma nova análise, registre outra emissão na tela Consulta de títulos.";
      resultado.replaceChildren();
    });

    fechar.addEventListener("click", function () {
      painel.remove();
      window.__systextilSegundaViaBoletoLoaded = false;
    });

    painel.append(
      titulo,
      explicacao,
      resumo,
      botaoAnalisar,
      resultado,
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
      statusEmissao,
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
    preencherCamposConsulta,
    normalizarTextoProcesso,
    interpretarDataHoraProcesso,
    analisarProcessos
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
    window.__systextilSegundaViaBoletoLoaded = true;
    montarPainel();
  } else {
    alternarPainel();
  }
})();
