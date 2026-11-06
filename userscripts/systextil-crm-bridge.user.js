// ==UserScript==
// @name         SmartTable → Systextil — Transferência de títulos
// @namespace    https://github.com/IsaacTexCotton/Systextil-envio-mensagem
// @version      1.0.0
// @description  Descontinuado. A transferência agora integra o userscript unificado systextil-segunda-via.user.js.
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-crm-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-crm-bridge.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSAO = '0.2.0';
  const EVENTO_ENVIAR = 'smarttable:systextil:enviar-titulo';
  const EVENTO_RESULTADO = 'smarttable:systextil:resultado';
  const EVENTO_PEDIDO_APLICADO = 'smarttable:systextil:pedido-aplicado';
  const CHAVES = Object.freeze({
    pedido: 'smarttable.systextil.title-transfer.v1.pedido',
    resultado: 'smarttable.systextil.title-transfer.v1.resultado',
    consumidor: 'smarttable.systextil.title-transfer.v1.consumidor',
  });
  const ID_PAINEL = 'st-segunda-via-boleto-panel';
  const ID_CAMPO_TITULO = 'st-segunda-via-numero-titulo';
  const ID_CAMPO_PARCELA = 'st-segunda-via-parcela';
  const ID_REFERENCIA = 'st-crm-systextil-reference';
  const TTL_PEDIDO_MS = 5 * 60 * 1000;
  const TTL_CONSUMIDOR_MS = 15 * 1000;
  const MAX_TITULO = 40;
  const MAX_PARCELA = 20;
  const ABA_ID = criarIdLocal();
  const urlAtual = new URL(window.location.href);
  const NA_PAGINA_CRM = urlAtual.hostname === 'texhub.texcotton.com.br' && urlAtual.pathname.startsWith('/crm/');
  const NA_PAGINA_SYSTEXTIL =
    urlAtual.hostname === 'systextil.texcotton.com.br' &&
    urlAtual.pathname.startsWith('/systextil/');

  if (!NA_PAGINA_CRM && !NA_PAGINA_SYSTEXTIL) return;

  let observadorPainel = null;
  let timerExpiracao = null;
  let pedidoEmEspera = null;
  let consumoEmAndamento = false;

  function criarIdLocal() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function emitirResultado(resultado) {
    if (!NA_PAGINA_CRM || !resultado || typeof resultado.id !== 'string') return;
    const Construtor = document.defaultView?.CustomEvent || window.CustomEvent || CustomEvent;
    document.dispatchEvent(new Construtor(EVENTO_RESULTADO, {
      detail: JSON.stringify(resultado),
    }));
  }

  function criarResultado(pedido, status, ok, mensagem) {
    return {
      id: String(pedido?.id ?? ''),
      status,
      ok: ok === true,
      mensagem: String(mensagem ?? '').slice(0, 300),
      updatedAt: Date.now(),
    };
  }

  function validarCodigo(valor, limite, nome) {
    const texto = String(valor ?? '').trim();
    if (!texto || texto.length > limite || !/^[A-Za-z0-9_-]+$/.test(texto)) {
      throw new Error(nome + ' ausente ou com formato inválido.');
    }
    return texto;
  }

  function validarPedido(pedido, agora = Date.now()) {
    if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)) {
      throw new Error('A solicitação recebida não é um objeto válido.');
    }
    if (pedido.schema !== 1 || pedido.source !== 'smarttable-crm') {
      throw new Error('A versão ou a origem da solicitação não é reconhecida.');
    }
    if (typeof pedido.id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(pedido.id)) {
      throw new Error('O identificador da solicitação é inválido.');
    }
    const createdAt = Number(pedido.createdAt);
    const idade = Number(agora) - createdAt;
    if (!Number.isFinite(createdAt) || idade < -30000 || idade > TTL_PEDIDO_MS) {
      throw new Error('A solicitação expirou ou possui horário inválido. Envie novamente pelo CRM.');
    }
    const cnpj = String(pedido.cnpj ?? '').replace(/\D/g, '');
    if (!/^\d{14}$/.test(cnpj)) {
      throw new Error('O CNPJ de referência não contém 14 dígitos.');
    }
    const razaoSocial = String(pedido.razaoSocial ?? '').trim();
    if (!razaoSocial || razaoSocial.length > 180) {
      throw new Error('A razão social de referência está vazia ou excede o limite.');
    }
    const titulo = validarCodigo(pedido.titulo, MAX_TITULO, 'Número do título');
    const parcela = validarCodigo(pedido.parcela, MAX_PARCELA, 'Parcela/sequência');

    return {
      schema: 1,
      id: pedido.id,
      createdAt,
      source: 'smarttable-crm',
      cnpj,
      razaoSocial,
      titulo,
      parcela,
      vencimento: String(pedido.vencimento ?? '').slice(0, 20),
      saldo: String(pedido.saldo ?? '').slice(0, 40),
      diasAtraso: Number.isInteger(pedido.diasAtraso) ? pedido.diasAtraso : null,
      situacao: String(pedido.situacao ?? '').slice(0, 40),
      fluxo: String(pedido.fluxo ?? '').slice(0, 20),
    };
  }

  function lerCampoDoPainel(id) {
    const campo = document.getElementById(id);
    if (!campo || String(campo.tagName || '').toLowerCase() !== 'input') return null;
    if (campo.disabled || campo.readOnly) {
      throw new Error('Um dos campos do painel Systextil está bloqueado para edição.');
    }
    return campo;
  }

  function validarComprimentoDestino(campo, valor, rotulo) {
    const limite = Number(campo.maxLength);
    if (Number.isInteger(limite) && limite > 0 && valor.length > limite) {
      throw new Error(
        rotulo + ' possui ' + valor.length +
        ' caracteres, mas o campo do automatizador aceita no máximo ' + limite + '.'
      );
    }
  }

  function definirValorCampo(campo, valor) {
    const pagina = campo.ownerDocument?.defaultView || document.defaultView || window;
    const setter = pagina.HTMLInputElement
      ? Object.getOwnPropertyDescriptor(pagina.HTMLInputElement.prototype, 'value')?.set
      : null;

    if (typeof setter === 'function') setter.call(campo, valor);
    else campo.value = valor;

    const Evento = pagina.Event || Event;
    campo.dispatchEvent(new Evento('input', { bubbles: true }));
    campo.dispatchEvent(new Evento('change', { bubbles: true }));
  }

  function montarReferencia(pedido, painel) {
    let referencia = document.getElementById(ID_REFERENCIA);
    if (!referencia) {
      referencia = document.createElement('div');
      referencia.id = ID_REFERENCIA;
      referencia.setAttribute('role', 'note');
      Object.assign(referencia.style, {
        margin: '8px 0',
        padding: '9px 10px',
        border: '1px solid #B8D8D2',
        borderRadius: '6px',
        background: '#F0F8F6',
        color: '#174B45',
        font: '12px/1.45 Arial, sans-serif',
        overflowWrap: 'anywhere',
      });
      painel.insertBefore(referencia, painel.firstChild);
    }
    const partes = [
      'Origem CRM: ' + pedido.razaoSocial,
      'CNPJ ' + pedido.cnpj,
      pedido.vencimento ? 'Vencimento ' + pedido.vencimento : '',
      pedido.saldo ? 'Saldo ' + pedido.saldo : '',
      Number.isInteger(pedido.diasAtraso) ? pedido.diasAtraso + ' dias de atraso' : '',
      pedido.situacao ? 'Situação ' + pedido.situacao : '',
    ].filter(Boolean);
    referencia.dataset.pedidoId = pedido.id;
    referencia.dataset.razaoSocial = pedido.razaoSocial;
    referencia.dataset.titulo = pedido.titulo;
    referencia.dataset.parcela = pedido.parcela;
    referencia.textContent = partes.join(' · ');
  }

  function aplicarPedidoNoPainel(pedidoInformado) {
    const pedido = validarPedido(pedidoInformado);
    const painel = document.getElementById(ID_PAINEL);
    if (!painel) {
      throw new Error('O painel de segunda via não está aberto. Ative-o no Systextil com Ctrl+Alt+B.');
    }
    const campoTitulo = lerCampoDoPainel(ID_CAMPO_TITULO);
    const campoParcela = lerCampoDoPainel(ID_CAMPO_PARCELA);
    if (!campoTitulo || !campoParcela) {
      throw new Error('Os campos auxiliares de título e parcela não foram encontrados no painel.');
    }
    validarComprimentoDestino(campoTitulo, pedido.titulo, 'Número do título');
    validarComprimentoDestino(campoParcela, pedido.parcela, 'Parcela');

    const anteriorTitulo = String(campoTitulo.value ?? '');
    const anteriorParcela = String(campoParcela.value ?? '');
    try {
      definirValorCampo(campoTitulo, pedido.titulo);
      definirValorCampo(campoParcela, pedido.parcela);
      if (
        String(campoTitulo.value ?? '') !== pedido.titulo ||
        String(campoParcela.value ?? '') !== pedido.parcela
      ) {
        throw new Error('O navegador não manteve os valores nos campos auxiliares do painel.');
      }
      montarReferencia(pedido, painel);
    } catch (erro) {
      try {
        definirValorCampo(campoTitulo, anteriorTitulo);
        definirValorCampo(campoParcela, anteriorParcela);
      } catch (_) {
        // Restauração best effort; a transferência permanece marcada como falha.
      }
      throw erro;
    }

    return {
      id: pedido.id,
      titulo: pedido.titulo,
      parcela: pedido.parcela,
    };
  }

  async function lerChave(chave) {
    if (typeof GM_getValue !== 'function') {
      throw new Error('O armazenamento compartilhado do Tampermonkey não está disponível.');
    }
    return await GM_getValue(chave, null);
  }

  async function gravarChave(chave, valor) {
    if (typeof GM_setValue !== 'function') {
      throw new Error('O armazenamento compartilhado do Tampermonkey não está disponível.');
    }
    await GM_setValue(chave, valor);
  }

  async function publicarResultado(pedido, status, ok, mensagem) {
    const resultado = criarResultado(pedido, status, ok, mensagem);
    await gravarChave(CHAVES.resultado, resultado);
    emitirResultado(resultado);
    return resultado;
  }

  async function adquirirConsumidor(pedido) {
    const anterior = await lerChave(CHAVES.consumidor);
    if (
      anterior &&
      anterior.pedidoId === pedido.id &&
      anterior.tabId !== ABA_ID &&
      Number(anterior.expiraEm) > Date.now()
    ) {
      return false;
    }
    if (
      anterior &&
      Number(anterior.expiraEm) > Date.now() &&
      anterior.pedidoId !== pedido.id
    ) {
      return false;
    }

    const candidato = {
      pedidoId: pedido.id,
      tabId: ABA_ID,
      expiraEm: Date.now() + TTL_CONSUMIDOR_MS,
    };
    await gravarChave(CHAVES.consumidor, candidato);
    await new Promise((resolver) => window.setTimeout(resolver, 40 + Math.floor(Math.random() * 80)));
    const confirmado = await lerChave(CHAVES.consumidor);
    return confirmado?.pedidoId === pedido.id && confirmado?.tabId === ABA_ID;
  }

  async function liberarConsumidor(pedido) {
    try {
      const atual = await lerChave(CHAVES.consumidor);
      if (atual?.pedidoId === pedido.id && atual?.tabId === ABA_ID) {
        await gravarChave(CHAVES.consumidor, null);
      }
    } catch (_) {
      // Expira por TTL se o armazenamento falhar ao liberar.
    }
  }

  function encerrarEspera() {
    if (observadorPainel) {
      observadorPainel.disconnect();
      observadorPainel = null;
    }
    if (timerExpiracao !== null) {
      window.clearTimeout(timerExpiracao);
      timerExpiracao = null;
    }
    pedidoEmEspera = null;
    consumoEmAndamento = false;
  }

  async function consumirQuandoPainelAbrir(pedidoInformado) {
    if (!NA_PAGINA_SYSTEXTIL || consumoEmAndamento) return;
    let pedido;
    try {
      pedido = validarPedido(pedidoInformado);
    } catch (erro) {
      const pedidoSeguro = pedidoInformado && typeof pedidoInformado.id === 'string'
        ? pedidoInformado
        : { id: '' };
      const atual = await lerChave(CHAVES.pedido);
      if (atual?.id === pedidoSeguro.id) await gravarChave(CHAVES.pedido, null);
      await publicarResultado(pedidoSeguro, 'erro', false, erro.message);
      encerrarEspera();
      return;
    }

    pedidoEmEspera = pedido;
    const tentar = async () => {
      if (consumoEmAndamento || !pedidoEmEspera || pedidoEmEspera.id !== pedido.id) return;
      const painel = document.getElementById(ID_PAINEL);
      const campoTitulo = document.getElementById(ID_CAMPO_TITULO);
      const campoParcela = document.getElementById(ID_CAMPO_PARCELA);
      if (!painel || !campoTitulo || !campoParcela) return;

      consumoEmAndamento = true;
      let consumidorAdquirido = false;
      try {
        const atual = await lerChave(CHAVES.pedido);
        if (!atual || atual.id !== pedido.id) {
          encerrarEspera();
          return;
        }
        consumidorAdquirido = await adquirirConsumidor(pedido);
        if (!consumidorAdquirido) {
          encerrarEspera();
          return;
        }

        const aplicado = aplicarPedidoNoPainel(pedido);
        await gravarChave(CHAVES.pedido, null);
        await publicarResultado(
          pedido,
          'preenchido',
          true,
          'Dados inseridos e conferidos nos campos auxiliares. A automação iniciará a confirmação NXJ e o fluxo da segunda via.'
        );

        const ConstrutorEvento = document.defaultView?.CustomEvent || window.CustomEvent || CustomEvent;
        document.dispatchEvent(new ConstrutorEvento(EVENTO_PEDIDO_APLICADO, {
          detail: JSON.stringify({
            id: aplicado.id,
            titulo: aplicado.titulo,
            parcela: aplicado.parcela,
            razaoSocial: pedido.razaoSocial
          })
        }));
      } catch (erro) {
        // Uma falha no armazenamento também precisa encerrar a espera. A
        // limpeza/publicação são best effort para não deixar a aba travada.
        try {
          const atual = await lerChave(CHAVES.pedido);
          if (atual?.id === pedido.id) await gravarChave(CHAVES.pedido, null);
        } catch (_) {
          // O pedido expirará pelo TTL se o armazenamento estiver indisponível.
        }
        try {
          await publicarResultado(
            pedido,
            'erro',
            false,
            erro?.message || 'Não foi possível inserir os dados no painel.'
          );
        } catch (_) {
          // A falha de comunicação não deve manter o observador ativo.
        }
      } finally {
        if (consumidorAdquirido) await liberarConsumidor(pedido);
        if (pedidoEmEspera?.id === pedido.id) encerrarEspera();
      }
    };

    if (!document.body) {
      await publicarResultado(pedido, 'erro', false, 'O documento do Systextil ainda não está pronto.');
      encerrarEspera();
      return;
    }

    await tentar();
    if (!pedidoEmEspera || pedidoEmEspera.id !== pedido.id) return;

    if (!observadorPainel) {
      observadorPainel = new MutationObserver(() => {
        void tentar();
      });
      observadorPainel.observe(document.body, { childList: true, subtree: true });
    }

    if (timerExpiracao === null) {
      const restante = Math.max(0, TTL_PEDIDO_MS - (Date.now() - pedido.createdAt));
      timerExpiracao = window.setTimeout(async () => {
        const atual = await lerChave(CHAVES.pedido);
        if (atual?.id === pedido.id) {
          await publicarResultado(
            pedido,
            'erro',
            false,
            'O painel de segunda via não foi aberto dentro do prazo. Envie novamente pelo CRM.'
          );
          await gravarChave(CHAVES.pedido, null);
        }
        encerrarEspera();
      }, restante);
    }
  }

  async function receberSolicitacaoCrm(evento) {
    if (!NA_PAGINA_CRM) return;
    let pedidoInformado;
    try {
      pedidoInformado = typeof evento?.detail === 'string'
        ? JSON.parse(evento.detail)
        : evento?.detail;
      const pedido = validarPedido(pedidoInformado);
      const anterior = await lerChave(CHAVES.pedido);
      if (anterior) {
        try {
          validarPedido(anterior);
          throw new Error('Já existe uma transferência aguardando o Systextil. Conclua ou aguarde a expiração antes de enviar outro título.');
        } catch (erro) {
          if (/Já existe uma transferência/.test(erro.message)) throw erro;
          await gravarChave(CHAVES.pedido, null);
        }
      }
      await gravarChave(CHAVES.pedido, pedido);
      await publicarResultado(
        pedido,
        'aguardando',
        true,
        'Solicitação guardada. Abra o painel de segunda via no Systextil (Ctrl+Alt+B); os campos serão preparados quando o painel aparecer.'
      );
    } catch (erro) {
      const pedidoSeguro = pedidoInformado && typeof pedidoInformado.id === 'string'
        ? pedidoInformado
        : { id: '' };
      emitirResultado(criarResultado(pedidoSeguro, 'erro', false, erro?.message || 'Solicitação recusada.'));
    }
  }

  function instalarListeners() {
    if (NA_PAGINA_CRM) {
      document.addEventListener(EVENTO_ENVIAR, receberSolicitacaoCrm);
      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(CHAVES.resultado, (_chave, _anterior, novo, remoto) => {
          if (remoto && novo && typeof novo.id === 'string') emitirResultado(novo);
        });
      }
      return;
    }

    if (NA_PAGINA_SYSTEXTIL) {
      if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(CHAVES.pedido, (_chave, _anterior, novo, remoto) => {
          if (remoto && novo) void consumirQuandoPainelAbrir(novo);
        });
      }
      void lerChave(CHAVES.pedido)
        .then((pedido) => {
          if (pedido) return consumirQuandoPainelAbrir(pedido);
          return null;
        })
        .catch(() => {
          // A página continua utilizável; a ação manual do painel não é afetada.
        });
    }
  }

  window.__crmSystextilBridgeDebug = Object.freeze({
    validarPedido,
    validarCodigo,
    aplicarPedidoNoPainel,
    criarResultado,
    TTL_PEDIDO_MS,
    CHAVES,
    ID_PAINEL,
    ID_CAMPO_TITULO,
    ID_CAMPO_PARCELA,
  });

  instalarListeners();
})();
