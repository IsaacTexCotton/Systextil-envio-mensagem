'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(
  __dirname,
  '..',
  'userscripts',
  'systextil-segunda-via-boleto.user.js'
);
const source = fs.readFileSync(scriptPath, 'utf8');

function carregarApi(forms = [], propriedadesJanela = {}, propriedadesGlobais = {}) {
  const document = {
    body: null,
    forms,
    addEventListener() {},
    getElementById() {},
    getElementsByName(nome) {
      return typeof propriedadesGlobais.getElementsByName === 'function'
        ? propriedadesGlobais.getElementsByName(nome)
        : [];
    }
  };

  const consoleTeste = {
    warn() {},
    error() {},
    log() {}
  };
  const window = { document, console: consoleTeste, ...propriedadesJanela };
  window.top = window;
  if (propriedadesGlobais.unsafeWindow) propriedadesGlobais.unsafeWindow.document = document;

  vm.runInNewContext(
    source,
    { window, document, console: consoleTeste, Object, Array, String, Event, URL, URLSearchParams, setTimeout, clearTimeout, ...propriedadesGlobais },
    { filename: scriptPath }
  );

  assert.ok(window.__systextilSegundaViaBoletoDebug);
  return window.__systextilSegundaViaBoletoDebug;
}

function criarAmbienteConsultaNxjFake(opcoes = {}) {
  const requisicoes = [];
  let campoAtivo = null;
  let focosParcela = 0;
  const campos = {};

  class XMLHttpRequestFake {
    constructor() {
      this.ouvintes = new Map();
      this.status = 200;
    }

    open(metodo, url) {
      this.metodo = String(metodo).toUpperCase();
      this.url = String(url);
    }

    addEventListener(tipo, callback) {
      if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, []);
      this.ouvintes.get(tipo).push(callback);
    }

    send(body) {
      requisicoes.push({
        metodo: this.metodo,
        url: this.url,
        body: typeof body === 'string' ? body : ''
      });

      this.status = typeof opcoes.status === 'function'
        ? opcoes.status(this.metodo, this.url)
        : (opcoes.status ?? 200);

      setTimeout(() => {
        const parametros = this.metodo === 'POST' && typeof body === 'string'
          ? new URLSearchParams(body)
          : null;
        const valorPendente = parametros?.get('fieldValues')?.split('\f').at(-1);

        // Simula o redesenho do formulário após o NXJ confirmar o título:
        // a referência anterior da parcela deixa de ser o controle ativo.
        if (
          parametros &&
          opcoes.recriarParcelaAposConfirmacaoTitulo === valorPendente
        ) {
          const parcelaAnterior = campos['seq_duplicatas.'];
          campos['seq_duplicatas.'] = criarCampo('seq_duplicatas.');
          if (campoAtivo === parcelaAnterior) campoAtivo = null;
        }

        // Simula um redesenho tardio do input após uma resposta NXJ observada.
        if (
          this.metodo === 'GET' &&
          this.url.includes('refresh-parcela=1')
        ) {
          const parcelaAnterior = campos['seq_duplicatas.'];
          campos['seq_duplicatas.'] = criarCampo('seq_duplicatas.');
          if (campoAtivo === parcelaAnterior) campoAtivo = null;
        }

        for (const callback of this.ouvintes.get('loadend') || []) {
          callback.call(this);
        }
      }, opcoes.latenciaMs ?? 2);
    }
  }

  const pagina = {
    curDataView: {
      name: opcoes.visao ?? 'forms.crec.crec_f090'
    },
    XMLHttpRequest: XMLHttpRequestFake,
    URLSearchParams
  };

  if (opcoes.HTMLInputElement) pagina.HTMLInputElement = opcoes.HTMLInputElement;
  if (opcoes.InputEvent) pagina.InputEvent = opcoes.InputEvent;
  if (opcoes.Event) pagina.Event = opcoes.Event;

  function enviarComandoConfirmacao(valor) {
    const post = new pagina.XMLHttpRequest();
    post.open('POST', '/systextil/UnifyNXJ.jsp');
    post.send(new URLSearchParams({
      commandName: 'ClickOnField',
      fieldValues: '\f' + valor
    }).toString());

    const get = new pagina.XMLHttpRequest();
    get.open('GET', '/systextil/UnifyNXJ.jsp?promptCounter=1');
    get.send();
  }

  function criarCampo(nome) {
    const campo = opcoes.HTMLInputElement
      ? Object.create(opcoes.HTMLInputElement.prototype)
      : { value: '' };

    Object.assign(campo, {
      name: nome,
      disabled: false,
      readOnly: false,
      eventos: [],
      ownerDocument: { defaultView: pagina },
      dispatchEvent(evento) {
        this.eventos.push({
          tipo: evento.type,
          inputType: evento.inputType,
          data: evento.data
        });
        opcoes.registrarEvento?.({
          tipo: 'evento',
          campo: nome,
          evento: evento.type,
          instante: Date.now()
        });
        return true;
      },
      focus() {
        if (nome === 'seq_duplicatas.') {
          focosParcela += 1;
          const simularAtualizacao =
            opcoes.recriarParcelaEmTodasRefocalizacoes
              ? focosParcela >= 1
              : opcoes.recriarParcelaAposRefocalizacao && focosParcela === 2;

          if (simularAtualizacao) {
            const atualizacao = new pagina.XMLHttpRequest();
            atualizacao.open('GET', '/systextil/UnifyNXJ.jsp?refresh-parcela=1');
            atualizacao.send();
          }
        }

        if (campoAtivo && campoAtivo !== this) {
          const campoAnterior = campoAtivo;
          const ignorar = opcoes.omitirConfirmacaoCampo === campoAnterior.name;
          if (!ignorar) enviarComandoConfirmacao(campoAnterior.value);

          // Simula ERP que limpa o input no blur depois de enviar o valor ao NXJ.
          if (opcoes.limparCampoAoPerderFoco === campoAnterior.name) {
            campoAnterior.value = '';
          }

          if (opcoes.recriarCampoAoPerderFoco === campoAnterior.name) {
            campos[campoAnterior.name] = criarCampo(campoAnterior.name);
          }
        }

        if (
          opcoes.exigirCampoAtualAoFocar &&
          campos[nome] !== this
        ) {
          throw new Error('Tentativa de focar um controle substituído.');
        }

        campoAtivo = this;
        opcoes.registrarEvento?.({
          tipo: 'foco',
          campo: nome,
          instante: Date.now()
        });
      }
    });

    return campo;
  }

  Object.assign(campos, {
    'num_duplicata.': criarCampo('num_duplicata.'),
    'seq_duplicatas.': criarCampo('seq_duplicatas.')
  });
  const camposIniciais = { ...campos };
  const formulario = {
    elements: {
      namedItem(nome) {
        return campos[nome] || null;
      }
    }
  };

  const api = carregarApi(
    [formulario],
    {},
    {
      unsafeWindow: pagina,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      getElementsByName(nome) {
        return campos[nome] ? [campos[nome]] : [];
      }
    }
  );

  return {
    api,
    campos,
    camposIniciais,
    requisicoes,
    pagina,
    formulario,
    XMLHttpRequestFake,
    obterFocosParcela() { return focosParcela; }
  };
}

test('userscript usa execução sob demanda pelo menu do Tampermonkey', () => {
  assert.match(source, /^\/\/ @run-at\s+context-menu$/m);

  const api = carregarApi();
  assert.equal(api.version, '0.4.9');
});

test('declara URLs estáveis para verificar e baixar atualizações', () => {
  const url = 'https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via-boleto.user.js';

  assert.match(source, /^\/\/ @version\s+0\.4\.9$/m);
  assert.ok(source.includes('// @updateURL     ' + url));
  assert.ok(source.includes('// @downloadURL   ' + url));
});


test('valida códigos de consulta sem remover zeros à esquerda', () => {
  const api = carregarApi();

  assert.equal(api.validarCodigoConsulta(' 000936312 ', 'Número do título'), '000936312');
  assert.equal(api.validarCodigoConsulta('01', 'Parcela'), '01');
});


test('normaliza o número do título e preserva a parcela sem acrescentar zeros', () => {
  const api = carregarApi();

  assert.equal(api.normalizarCodigoConsulta('936520', 'Número do título', 8), '00936520');
  assert.equal(api.preservarCodigoConsulta('3', 'Parcela', 2), '3');
  assert.equal(api.preservarCodigoConsulta('1', 'Parcela', 2), '1');
  assert.equal(api.preservarCodigoConsulta('01', 'Parcela', 2), '01');
});

test('preserva códigos que já estão completos e respeita a largura declarada pelo ERP', () => {
  const api = carregarApi();

  assert.equal(api.normalizarCodigoConsulta('00936520', 'Número do título', 8), '00936520');
  assert.equal(api.preservarCodigoConsulta('01', 'Parcela', 2), '01');
  assert.equal(api.obterLarguraCampo({ maxLength: 9 }, 8), 9);
  assert.equal(api.obterLarguraCampo({ maxLength: 3 }, 2), 3);
  assert.equal(api.obterLarguraCampo({}, 8), 8);
});

test('rejeita código maior que a largura do campo sem truncar dígitos', () => {
  const api = carregarApi();

  assert.throws(
    () => api.normalizarCodigoConsulta('123456789', 'Número do título', 8),
    /Nenhum dígito foi removido/
  );
  assert.throws(
    () => api.preservarCodigoConsulta('123', 'Parcela', 2),
    /Nenhum dígito foi removido/
  );
});

test('rejeita códigos de consulta vazios ou com caracteres inesperados', () => {
  const api = carregarApi();

  assert.throws(
    () => api.validarCodigoConsulta('', 'Número do título'),
    /não informado/
  );
  assert.throws(
    () => api.validarCodigoConsulta('93/6312', 'Número do título'),
    /caracteres não permitidos/
  );
});

test('preenche os campos em sequência e exige confirmação NXJ de título e parcela', async () => {
  const ambiente = criarAmbienteConsultaNxjFake();
  const resultado = await ambiente.api.preencherCamposConsulta(
    { titulo: '936520', parcela: '3' },
    { limiteEsperaMs: 500, silencioMs: 0, intervaloMs: 2, atrasoFocoMs: 0 }
  );

  assert.equal(resultado.titulo, '936520');
  assert.equal(resultado.parcela, '3');
  assert.equal(resultado.confirmacoes.titulo, 'NXJ');
  assert.equal(resultado.confirmacoes.parcela, 'NXJ');
  assert.equal(ambiente.campos['num_duplicata.'].value, '936520');
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '3');

  const confirmacoes = ambiente.requisicoes
    .filter(requisicao => requisicao.metodo === 'POST')
    .map(requisicao => new URLSearchParams(requisicao.body).get('fieldValues').split('\f').at(-1));

  assert.deepEqual(confirmacoes, ['936520', '3']);
  assert.deepEqual(
    ambiente.campos['num_duplicata.'].eventos.map(evento => evento.tipo),
    ['input', 'change']
  );
  assert.deepEqual(
    ambiente.campos['seq_duplicatas.'].eventos.map(evento => evento.tipo),
    ['input', 'change']
  );
});


test('continua a sequência quando o ERP limpa o input do título após o blur e confirma pelo NXJ', async () => {
  const ambiente = criarAmbienteConsultaNxjFake({
    limparCampoAoPerderFoco: 'num_duplicata.',
    latenciaMs: 2
  });

  const resultado = await ambiente.api.preencherCamposConsulta(
    { titulo: '936520', parcela: '3' },
    {
      limiteEsperaMs: 500,
      silencioMs: 0,
      intervaloMs: 1,
      atrasoFocoInicialMs: 0,
      atrasoAntesDeSairCampoMs: 0,
      atrasoAposSairCampoMs: 0
    }
  );

  assert.equal(resultado.titulo, '936520');
  assert.equal(resultado.parcela, '3');
  assert.equal(resultado.confirmacoes.titulo, 'NXJ');
  assert.equal(resultado.confirmacoes.parcela, 'NXJ');

  // O DOM limpou o input ao perder foco, mas o POST NXJ recebeu o título
  // exato e a rotina conseguiu inserir e confirmar a parcela.
  assert.equal(ambiente.campos['num_duplicata.'].value, '');
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '3');

  const confirmacoes = ambiente.requisicoes
    .filter(requisicao => requisicao.metodo === 'POST')
    .map(requisicao => new URLSearchParams(requisicao.body).get('fieldValues').split('\f').at(-1));

  assert.deepEqual(confirmacoes, ['936520', '3']);
});

test('recupera o elemento atual do título quando o ERP o recria no blur', async () => {
  const ambiente = criarAmbienteConsultaNxjFake({
    recriarCampoAoPerderFoco: 'num_duplicata.',
    exigirCampoAtualAoFocar: true,
    latenciaMs: 2
  });
  const tituloAnterior = ambiente.camposIniciais['num_duplicata.'];

  const resultado = await ambiente.api.preencherCamposConsulta(
    { titulo: '936520', parcela: '3' },
    {
      limiteEsperaMs: 500,
      silencioMs: 0,
      intervaloMs: 1,
      atrasoFocoInicialMs: 0,
      atrasoAntesDeSairCampoMs: 0,
      atrasoAposSairCampoMs: 0
    }
  );

  assert.equal(resultado.titulo, '936520');
  assert.equal(resultado.parcela, '3');
  assert.notEqual(ambiente.campos['num_duplicata.'], tituloAnterior);
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '3');
});

test('usa o novo controle da parcela quando o NXJ recria o input após o foco inicial', async () => {
  const ambiente = criarAmbienteConsultaNxjFake({
    recriarParcelaAposConfirmacaoTitulo: '936520',
    latenciaMs: 2
  });
  const parcelaAnterior = ambiente.camposIniciais['seq_duplicatas.'];

  const resultado = await ambiente.api.preencherCamposConsulta(
    { titulo: '936520', parcela: '3' },
    {
      limiteEsperaMs: 500,
      silencioMs: 0,
      intervaloMs: 1,
      atrasoFocoInicialMs: 0,
      atrasoAntesDeSairCampoMs: 0,
      atrasoAposSairCampoMs: 20
    }
  );

  assert.equal(resultado.titulo, '936520');
  assert.equal(resultado.parcela, '3');
  assert.notEqual(ambiente.campos['seq_duplicatas.'], parcelaAnterior);
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '3');
});

test('reaproveita a sequência funcional sem refocar a parcela quando o controle não foi recriado', async () => {
  const ambiente = criarAmbienteConsultaNxjFake({
    recriarParcelaAposRefocalizacao: true,
    latenciaMs: 2
  });

  const resultado = await ambiente.api.preencherCamposConsulta(
    { titulo: '936520', parcela: '3' },
    {
      limiteEsperaMs: 500,
      silencioMs: 0,
      intervaloMs: 1,
      atrasoFocoInicialMs: 0,
      atrasoAntesDeSairCampoMs: 0,
      atrasoAposSairCampoMs: 0
    }
  );

  assert.equal(resultado.parcela, '3');
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '3');
  assert.equal(ambiente.obterFocosParcela(), 1);
});

test('interrompe se o ERP recriar repetidamente a parcela mesmo após refocar o controle atual', async () => {
  const ambiente = criarAmbienteConsultaNxjFake({
    recriarParcelaEmTodasRefocalizacoes: true,
    latenciaMs: 2
  });

  await assert.rejects(
    ambiente.api.preencherCamposConsulta(
      { titulo: '936520', parcela: '3' },
      {
        limiteEsperaMs: 500,
        silencioMs: 0,
        intervaloMs: 1,
        atrasoFocoInicialMs: 0,
        atrasoAntesDeSairCampoMs: 0,
        atrasoAposSairCampoMs: 15
      }
    ),
    erro => {
      assert.match(erro.message, /NÃO pressione F7/);
      assert.match(erro.message, /recriou repetidamente o campo da parcela/);
      return true;
    }
  );

  assert.equal(ambiente.campos['seq_duplicatas.'].value, '');
});

test('aguarda após input/change antes de abandonar cada campo', async () => {
  const eventos = [];
  const ambiente = criarAmbienteConsultaNxjFake({
    registrarEvento: evento => eventos.push(evento)
  });

  await ambiente.api.preencherCamposConsulta(
    { titulo: '936520', parcela: '3' },
    {
      limiteEsperaMs: 1000,
      silencioMs: 0,
      intervaloMs: 1,
      atrasoFocoInicialMs: 0,
      atrasoAntesDeSairCampoMs: 25,
      atrasoAposSairCampoMs: 0
    }
  );

  const changeTitulo = eventos.find(evento =>
    evento.tipo === 'evento' &&
    evento.campo === 'num_duplicata.' &&
    evento.evento === 'change'
  );
  const focoParcela = eventos.find(evento =>
    evento.tipo === 'foco' &&
    evento.campo === 'seq_duplicatas.'
  );
  const changeParcela = eventos.find(evento =>
    evento.tipo === 'evento' &&
    evento.campo === 'seq_duplicatas.' &&
    evento.evento === 'change'
  );
  const focoTitulo = eventos.find((evento, indice) =>
    evento.tipo === 'foco' &&
    evento.campo === 'num_duplicata.' &&
    indice > eventos.indexOf(changeParcela)
  );

  assert.ok(changeTitulo);
  assert.ok(focoParcela);
  assert.ok(changeParcela);
  assert.ok(focoTitulo);
  assert.ok(focoParcela.instante - changeTitulo.instante >= 18);
  assert.ok(focoTitulo.instante - changeParcela.instante >= 18);
});

test('usa setter nativo e Event padrão para input/change conforme a sequência manual', async () => {
  let chamadasSetterNativo = 0;
  let chamadasSetterDireto = 0;
  let chamadasInputEvent = 0;

  function HTMLInputElementFake() {}
  Object.defineProperty(HTMLInputElementFake.prototype, 'value', {
    configurable: true,
    get() {
      return this.__valorReal || '';
    },
    set(valor) {
      chamadasSetterNativo += 1;
      this.__valorReal = String(valor);
    }
  });

  class InputEventFake extends Event {
    constructor(tipo, opcoes = {}) {
      super(tipo, opcoes);
      chamadasInputEvent += 1;
    }
  }

  const ambiente = criarAmbienteConsultaNxjFake({
    HTMLInputElement: HTMLInputElementFake,
    InputEvent: InputEventFake,
    Event
  });

  const resultado = await ambiente.api.preencherCamposConsulta(
    { titulo: '936520', parcela: '3' },
    { limiteEsperaMs: 500, silencioMs: 0, intervaloMs: 2, atrasoFocoMs: 0 }
  );

  assert.equal(resultado.titulo, '936520');
  assert.equal(resultado.parcela, '3');
  assert.equal(chamadasSetterNativo, 2);
  assert.equal(chamadasSetterDireto, 0);
  assert.equal(chamadasInputEvent, 0);
  assert.equal(ambiente.campos['num_duplicata.'].value, '936520');
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '3');
  assert.deepEqual(
    ambiente.campos['num_duplicata.'].eventos.map(evento => evento.tipo),
    ['input', 'change']
  );
  assert.deepEqual(
    ambiente.campos['seq_duplicatas.'].eventos.map(evento => evento.tipo),
    ['input', 'change']
  );
  assert.ok(
    ambiente.campos['num_duplicata.'].eventos.every(evento => evento.inputType === undefined)
  );
  assert.ok(
    ambiente.campos['seq_duplicatas.'].eventos.every(evento => evento.inputType === undefined)
  );
});

test('usa o primeiro campo por name, como no script funcional apresentado pelo operador', async () => {
  const ambiente = criarAmbienteConsultaNxjFake();
  const tituloDuplicado = { value: '', name: 'num_duplicata.' };
  const parcelaDuplicada = { value: '', name: 'seq_duplicatas.' };
  const obterOriginais = ambiente.pagina.document.getElementsByName.bind(ambiente.pagina.document);

  ambiente.pagina.document.getElementsByName = nome => {
    const originais = obterOriginais(nome);
    const duplicado = nome === 'num_duplicata.'
      ? tituloDuplicado
      : (nome === 'seq_duplicatas.' ? parcelaDuplicada : null);
    return duplicado ? [...originais, duplicado] : originais;
  };

  const resultado = await ambiente.api.preencherCamposConsulta(
    { titulo: '936520', parcela: '3' },
    { limiteEsperaMs: 500, silencioMs: 0, intervaloMs: 1, atrasoFocoMs: 0 }
  );

  assert.equal(resultado.parcela, '3');
  assert.equal(ambiente.campos['num_duplicata.'].value, '936520');
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '3');
  assert.equal(tituloDuplicado.value, '');
  assert.equal(parcelaDuplicada.value, '');
});

test('interrompe sem sucesso quando o NXJ não confirma o número do título', async () => {
  const ambiente = criarAmbienteConsultaNxjFake({
    omitirConfirmacaoCampo: 'num_duplicata.'
  });

  await assert.rejects(
    ambiente.api.preencherCamposConsulta(
      { titulo: '936520', parcela: '3' },
      { limiteEsperaMs: 40, silencioMs: 0, intervaloMs: 2, atrasoFocoMs: 0 }
    ),
    erro => {
      assert.match(
        erro.message,
        /NÃO pressione F7.*não confirmou o campo número do título/
      );
      assert.match(erro.message, /Diagnóstico NXJ/);
      assert.match(erro.message, /0 requisição\(ões\) observada\(s\)/);
      return true;
    }
  );

  assert.equal(ambiente.campos['num_duplicata.'].value, '936520');
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '3');
});

test('não informa confirmação quando o POST NXJ retorna HTTP diferente de 2xx', async () => {
  const ambiente = criarAmbienteConsultaNxjFake({ status: 503 });
  const abrirOriginal = ambiente.XMLHttpRequestFake.prototype.open;
  const enviarOriginal = ambiente.XMLHttpRequestFake.prototype.send;

  await assert.rejects(
    ambiente.api.preencherCamposConsulta(
      { titulo: '936520', parcela: '3' },
      { limiteEsperaMs: 100, silencioMs: 0, intervaloMs: 2, atrasoFocoMs: 0 }
    ),
    /retornou HTTP 503/
  );

  assert.equal(ambiente.campos['num_duplicata.'].value, '936520');
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '3');
  assert.equal(ambiente.XMLHttpRequestFake.prototype.open, abrirOriginal);
  assert.equal(ambiente.XMLHttpRequestFake.prototype.send, enviarOriginal);
});

test('interrompe e orienta não pressionar F7 quando a parcela não é confirmada', async () => {
  const ambiente = criarAmbienteConsultaNxjFake({
    omitirConfirmacaoCampo: 'seq_duplicatas.'
  });
  const abrirOriginal = ambiente.XMLHttpRequestFake.prototype.open;
  const enviarOriginal = ambiente.XMLHttpRequestFake.prototype.send;

  await assert.rejects(
    ambiente.api.preencherCamposConsulta(
      { titulo: '936520', parcela: '3' },
      { limiteEsperaMs: 40, silencioMs: 0, intervaloMs: 2, atrasoFocoMs: 0 }
    ),
    /NÃO pressione F7.*não confirmou o campo parcela/
  );

  assert.equal(ambiente.campos['num_duplicata.'].value, '936520');
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '3');
  assert.equal(ambiente.XMLHttpRequestFake.prototype.open, abrirOriginal);
  assert.equal(ambiente.XMLHttpRequestFake.prototype.send, enviarOriginal);
});

test('bloqueia uma segunda execução enquanto o preenchimento assíncrono está ativo', async () => {
  const ambiente = criarAmbienteConsultaNxjFake({ latenciaMs: 10 });
  const primeira = ambiente.api.preencherCamposConsulta(
    { titulo: '936520', parcela: '3' },
    { limiteEsperaMs: 500, silencioMs: 0, intervaloMs: 2, atrasoFocoMs: 0 }
  );

  await assert.rejects(
    ambiente.api.preencherCamposConsulta(
      { titulo: '123456', parcela: '1' },
      { limiteEsperaMs: 50, silencioMs: 0, intervaloMs: 2, atrasoFocoMs: 0 }
    ),
    /Já existe um preenchimento em andamento/
  );

  await primeira;
});

test('interrompe antes de alterar campos quando a visão ativa não é Consulta de Títulos', async () => {
  const ambiente = criarAmbienteConsultaNxjFake({
    visao: 'forms.crec.crec_f095'
  });

  await assert.rejects(
    ambiente.api.preencherCamposConsulta(
      { titulo: '936520', parcela: '3' },
      { limiteEsperaMs: 40, silencioMs: 0, intervaloMs: 2, atrasoFocoMs: 0 }
    ),
    /visão ativa não é Consulta de Títulos/
  );

  assert.equal(ambiente.campos['num_duplicata.'].value, '');
  assert.equal(ambiente.campos['seq_duplicatas.'].value, '');
  assert.equal(ambiente.requisicoes.length, 0);
});

test('não envia F7 nem submete o formulário automaticamente', () => {
  const api = carregarApi();

  assert.match(source, /pressione F7 manualmente/);
  assert.equal(source.includes('.submit('), false);
  assert.equal(source.includes('new KeyboardEvent('), false);
  assert.equal(typeof api.preencherCamposConsulta, 'function');
  assert.equal(api.preencherCamposConsulta.constructor.name, 'AsyncFunction');
  assert.equal(typeof api.preservarCodigoConsulta, 'function');
});


test('normaliza nome do processo ignorando acentos e espaços extras', () => {
  const api = carregarApi();

  assert.equal(
    api.normalizarTextoProcesso('  Emissão   de boletos com registro  '),
    'emissao de boletos com registro'
  );
});

test('interpreta data e hora brasileira e ISO sem adivinhar formatos', () => {
  const api = carregarApi();
  const esperado = new Date(2026, 10, 4, 11, 30, 15).getTime();

  assert.equal(api.interpretarDataHoraProcesso('04/11/2026 11:30:15'), esperado);
  assert.equal(api.interpretarDataHoraProcesso('2026-11-04T11:30:15'), esperado);
});

test('rejeita data e hora inválida ou sem horário', () => {
  const api = carregarApi();

  assert.equal(api.interpretarDataHoraProcesso('31/02/2026 11:30:00'), null);
  assert.equal(api.interpretarDataHoraProcesso('04/11/2026'), null);
  assert.equal(api.interpretarDataHoraProcesso('data desconhecida'), null);
});

test('identifica uma única emissão concluída após o clique em Emite boleto', () => {
  const api = carregarApi();
  const solicitadoEm = new Date(2026, 10, 4, 11, 30, 45).getTime();
  const agora = new Date(2026, 10, 4, 11, 35, 0).getTime();

  const resultado = api.analisarProcessos([
    {
      rowIndex: 0,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 11:30:00',
      mensagem: 'Processo concluído com sucesso.'
    }
  ], {
    solicitadoEm,
    titulo: '00936520',
    parcela: '01'
  }, agora);

  assert.equal(resultado.status, 'sucesso');
  assert.equal(resultado.candidatos, 1);
  assert.equal(resultado.registro.visualIndex, 1);
  assert.equal(resultado.registro.recordNumber, 1);
});

test('ignora processos anteriores ao horário registrado da solicitação', () => {
  const api = carregarApi();
  const solicitadoEm = new Date(2026, 10, 4, 11, 30, 0).getTime();
  const agora = new Date(2026, 10, 4, 11, 35, 0).getTime();

  const resultado = api.analisarProcessos([
    {
      rowIndex: 0,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 11:20:00',
      mensagem: 'Processo concluído com sucesso.'
    }
  ], {
    solicitadoEm,
    titulo: '00936520',
    parcela: '01'
  }, agora);

  assert.equal(resultado.status, 'nao-encontrado');
});

test('interrompe quando mais de um processo corresponde ao horário da solicitação', () => {
  const api = carregarApi();
  const solicitadoEm = new Date(2026, 10, 4, 11, 30, 30).getTime();
  const agora = new Date(2026, 10, 4, 11, 35, 0).getTime();

  const resultado = api.analisarProcessos([
    {
      rowIndex: 0,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 11:30:00',
      mensagem: 'Processo concluído com sucesso.'
    },
    {
      rowIndex: 1,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 11:31:00',
      mensagem: 'Processo concluído com sucesso.'
    }
  ], {
    solicitadoEm,
    titulo: '00936520',
    parcela: '01'
  }, agora);

  assert.equal(resultado.status, 'ambiguo');
  assert.equal(resultado.candidatos, 2);
});

test('prioriza o processo com segundo exato da solicitação sobre outro processo próximo', () => {
  const api = carregarApi();
  const solicitadoEm = new Date(2026, 10, 4, 12, 12, 38, 725).getTime();
  const agora = new Date(2026, 10, 4, 12, 15, 0).getTime();

  const resultado = api.analisarProcessos([
    {
      rowIndex: 0,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 12:12:38',
      mensagem: 'Processo concluído com sucesso.'
    },
    {
      rowIndex: 1,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 12:11:59',
      mensagem: 'Processo concluído com sucesso.'
    },
    {
      rowIndex: 2,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 11:57:45',
      mensagem: 'Processo concluído com sucesso.'
    }
  ], {
    solicitadoEm,
    titulo: '000944246',
    parcela: '01'
  }, agora);

  assert.equal(resultado.status, 'sucesso');
  assert.equal(resultado.candidatos, 1);
  assert.equal(resultado.registro.visualIndex, 1);
  assert.equal(resultado.registro.dataExecucao, '04/11/2026 12:12:38');
});

test('não associa processo que ocorreu muito depois da solicitação', () => {
  const api = carregarApi();
  const solicitadoEm = new Date(2026, 10, 4, 11, 30, 0).getTime();
  const agora = new Date(2026, 10, 4, 11, 50, 0).getTime();

  const resultado = api.analisarProcessos([
    {
      rowIndex: 0,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 11:30:00',
      mensagem: 'Processo concluído com sucesso.'
    },
    {
      rowIndex: 1,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 11:42:00',
      mensagem: 'Processo concluído com sucesso.'
    }
  ], {
    solicitadoEm,
    titulo: '00936520',
    parcela: '01'
  }, agora);

  assert.equal(resultado.status, 'sucesso');
  assert.equal(resultado.candidatos, 1);
  assert.equal(resultado.registro.visualIndex, 1);
});

test('classifica processo ainda sem mensagem final como em andamento', () => {
  const api = carregarApi();
  const solicitadoEm = new Date(2026, 10, 4, 11, 30, 0).getTime();
  const agora = new Date(2026, 10, 4, 11, 35, 0).getTime();

  const resultado = api.analisarProcessos([
    {
      rowIndex: 2,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 11:31:00',
      mensagem: ''
    }
  ], {
    solicitadoEm,
    titulo: '00936520',
    parcela: '01'
  }, agora);

  assert.equal(resultado.status, 'em-andamento');
  assert.equal(resultado.registro.visualIndex, 3);
  assert.equal(resultado.registro.recordNumber, 3);
});

test('não classifica processo com mensagem diferente como sucesso', () => {
  const api = carregarApi();
  const solicitadoEm = new Date(2026, 10, 4, 11, 30, 0).getTime();
  const agora = new Date(2026, 10, 4, 11, 35, 0).getTime();

  const resultado = api.analisarProcessos([
    {
      rowIndex: 0,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 11:31:00',
      mensagem: 'Falha ao processar relatório.'
    }
  ], {
    solicitadoEm,
    titulo: '00936520',
    parcela: '01'
  }, agora);

  assert.equal(resultado.status, 'falha');
});

test('interrompe quando há processo correspondente sem data/hora interpretável', () => {
  const api = carregarApi();
  const solicitadoEm = new Date(2026, 10, 4, 11, 30, 0).getTime();
  const agora = new Date(2026, 10, 4, 11, 35, 0).getTime();

  const resultado = api.analisarProcessos([
    {
      rowIndex: 0,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04-11-2026 11h30',
      mensagem: 'Processo concluído com sucesso.'
    }
  ], {
    solicitadoEm,
    titulo: '00936520',
    parcela: '01'
  }, agora);

  assert.equal(resultado.status, 'nao-verificavel');
  assert.equal(resultado.horariosNaoInterpretados, 1);
});

test('exige solicitação registrada para analisar processos', () => {
  const api = carregarApi();

  const resultado = api.analisarProcessos([
    {
      rowIndex: 0,
      titulo: 'Emissão de boletos com registro',
      dataExecucao: '04/11/2026 11:31:00',
      mensagem: 'Processo concluído com sucesso.'
    }
  ], null, Date.now());

  assert.equal(resultado.status, 'sem-solicitacao');
});


test('mapeia os nomes de campos repetidos para a linha visual correta', () => {
  const api = carregarApi();

  assert.equal(api.nomeCampoProcesso('titulo.', 0), 'titulo.');
  assert.equal(api.nomeCampoProcesso('titulo.', 1), 'titulo.0');
  assert.equal(api.nomeCampoProcesso('titulo.', 2), 'titulo.1');
  assert.equal(api.nomeCampoProcesso('MSG_EXCEPTION.', 3), 'MSG_EXCEPTION.2');
});

test('expira solicitação antiga para não associar uma emissão posterior por engano', () => {
  const api = carregarApi();
  const solicitadoEm = new Date(2026, 10, 4, 10, 0, 0).getTime();
  const agora = new Date(2026, 10, 4, 11, 0, 1).getTime();

  const resultado = api.analisarProcessos([], {
    solicitadoEm,
    titulo: '00936520',
    parcela: '01'
  }, agora);

  assert.equal(resultado.status, 'solicitacao-expirada');
});

test('o userscript declara somente as permissões necessárias para o auxiliar local', () => {
  assert.match(source, /^\/\/ @grant\s+unsafeWindow$/m);
  assert.match(source, /^\/\/ @grant\s+GM_getValue$/m);
  assert.match(source, /^\/\/ @grant\s+GM_setValue$/m);
  assert.match(source, /^\/\/ @grant\s+GM_xmlhttpRequest$/m);
  assert.match(source, /^\/\/ @connect\s+systextil\.texcotton\.com\.br$/m);
  assert.match(source, /^\/\/ @connect\s+127\.0\.0\.1$/m);
  assert.equal(source.includes('// @grant        GM_download'), false);
  assert.equal(source.includes('// @grant        none'), false);
});

test('a versão do metadado Tampermonkey corresponde à versão interna do userscript', () => {
  const versaoMetadado = source.match(/^\/\/ @version\s+([^\s]+)$/m)?.[1];
  const versaoInterna = source.match(/const VERSION = "([^"]+)";/)?.[1];

  assert.ok(versaoMetadado, 'metadado @version deve existir');
  assert.ok(versaoInterna, 'constante VERSION deve existir');
  assert.equal(versaoMetadado, versaoInterna);
});

test('valida a URL PDF gerada pelo Systextil e aceita somente o endpoint de boletos', () => {
  const api = carregarApi();
  const base = 'http://systextil.texcotton.com.br/systextil/forms.systextil.senha.nxj';
  const relativa = 'download/blt365332.pdf?report=blt365332.jrprint&ext=pdf&program=forms.crec.crec_e259&size=A4';

  assert.equal(
    api.validarUrlPdf(relativa, base),
    'http://systextil.texcotton.com.br/systextil/download/blt365332.pdf?report=blt365332.jrprint&ext=pdf&program=forms.crec.crec_e259&size=A4'
  );
});

test('bloqueia URL PDF de outra origem ou com caminho, extensão, relatório ou programa inesperados', () => {
  const api = carregarApi();
  const base = 'http://systextil.texcotton.com.br/systextil/forms.systextil.senha.nxj';

  assert.throws(
    () => api.validarUrlPdf('https://outro.exemplo/download/blt.pdf?report=blt.jrprint&ext=pdf&program=forms.crec.crec_e259', base),
    /outra origem/
  );
  assert.throws(
    () => api.validarUrlPdf('/systextil/arquivo/blt.pdf?report=blt.jrprint&ext=pdf&program=forms.crec.crec_e259', base),
    /caminho de PDF/
  );
  assert.throws(
    () => api.validarUrlPdf('download/blt.pdf?report=blt.jrprint&ext=html&program=forms.crec.crec_e259', base),
    /formato PDF/
  );
  assert.throws(
    () => api.validarUrlPdf('download/blt.pdf?report=blt.pdf&ext=pdf&program=forms.crec.crec_e259', base),
    /identificador do relatório/
  );
  assert.throws(
    () => api.validarUrlPdf('download/blt.pdf?report=blt.jrprint&ext=pdf&program=forms.crec.crec_e258', base),
    /programa de emissão/
  );
});

test('seleciona a linha zero-based somente quando os dados da grade continuam iguais', () => {
  const api = carregarApi();
  const registro = {
    rowIndex: 0,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: '04/11/2026 12:12:38',
    mensagem: 'Processo concluído com sucesso.',
    visualIndex: 1,
    recordNumber: 1
  };
  const page = {
    DataView: function DataView() {},
    curDataView: { name: 'forms.systextil.batch', currentRow: 4 }
  };

  const selecao = api.selecionarRegistroProcesso(registro, page, () => [registro]);

  assert.equal(page.curDataView.currentRow, 0);
  assert.equal(selecao.linhaAnterior, 4);
  assert.equal(selecao.linhaSelecionada, 0);
});

test('interrompe seleção quando a linha foi alterada desde a análise', () => {
  const api = carregarApi();
  const registro = {
    rowIndex: 1,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: '04/11/2026 12:12:38',
    mensagem: 'Processo concluído com sucesso.'
  };
  const page = { curDataView: { name: 'forms.systextil.batch', currentRow: 3 } };

  assert.throws(
    () => api.selecionarRegistroProcesso(registro, page, () => [{
      ...registro,
      dataExecucao: '04/11/2026 12:13:00'
    }]),
    /mudou desde a análise/
  );
  assert.equal(page.curDataView.currentRow, 3);
});

test('não tenta selecionar quando curDataView.currentRow não está disponível', () => {
  const api = carregarApi();
  const registro = {
    rowIndex: 0,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: '04/11/2026 12:12:38',
    mensagem: 'Processo concluído com sucesso.'
  };

  const page = {
    DataView: { currentRow: 4 },
    dataView: { currentRow: 2 }
  };

  assert.throws(
    () => api.selecionarRegistroProcesso(registro, page, () => [registro]),
    /API de seleção da grade/
  );
  assert.equal(page.DataView.currentRow, 4);
  assert.equal(page.dataView.currentRow, 2);
});

test('interrompe seleção quando curDataView aponta para outra visão do Systextil', () => {
  const api = carregarApi();
  const registro = {
    rowIndex: 0,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: '04/11/2026 12:12:38',
    mensagem: 'Processo concluído com sucesso.'
  };
  const page = {
    curDataView: {
      name: 'forms.crec.crec_f090',
      currentRow: 3
    }
  };

  assert.throws(
    () => api.selecionarRegistroProcesso(registro, page, () => [registro]),
    /não corresponde a Processos agendados/
  );
  assert.equal(page.curDataView.currentRow, 3);
});

test('obtém getFileUrl somente depois de selecionar e confirmar a linha correspondente', () => {
  const api = carregarApi();
  const registro = {
    rowIndex: 2,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: '04/11/2026 12:12:38',
    mensagem: 'Processo concluído com sucesso.'
  };
  const page = {
    document: {
      querySelectorAll() {
        return [{
          options: [],
          selectedOptions: [{ value: 'blt365332.jrprint' }]
        }];
      }
    },
    curDataView: { name: 'forms.systextil.batch', currentRow: 0 },
    getFileUrl() {
      assert.equal(this.curDataView.currentRow, 2);
      return 'download/blt365332.pdf?report=blt365332.jrprint&ext=pdf&program=forms.crec.crec_e259';
    }
  };

  const preparado = api.prepararUrlDownloadProcesso(
    registro,
    page,
    'http://systextil.texcotton.com.br/systextil/forms.systextil.senha.nxj',
    () => [registro]
  );

  assert.match(preparado.url, /blt365332\.pdf/);
  assert.equal(page.curDataView.currentRow, 2);
});

test('restaura a seleção anterior se getFileUrl retornar URL inválida', () => {
  const api = carregarApi();
  const registro = {
    rowIndex: 1,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: '04/11/2026 12:12:38',
    mensagem: 'Processo concluído com sucesso.'
  };
  const page = {
    curDataView: { name: 'forms.systextil.batch', currentRow: 5 },
    getFileUrl() {
      return 'https://externo.exemplo/arquivo.pdf';
    }
  };

  assert.throws(
    () => api.prepararUrlDownloadProcesso(
      registro,
      page,
      'http://systextil.texcotton.com.br/systextil/forms.systextil.senha.nxj',
      () => [registro]
    ),
    /outra origem/
  );
  assert.equal(page.curDataView.currentRow, 5);
});

test('gera a mesma chave de deduplicação para a mesma solicitação e processo', () => {
  const api = carregarApi();
  const solicitacao = { solicitadoEm: 1793809958725, titulo: '000944246', parcela: '01' };
  const registro = { executadoEm: 1793809958000 };

  assert.equal(
    api.montarChaveDownload(solicitacao, registro),
    api.montarChaveDownload(solicitacao, registro)
  );
  assert.notEqual(
    api.montarChaveDownload(solicitacao, registro),
    api.montarChaveDownload({ ...solicitacao, solicitadoEm: 1793809959000 }, registro)
  );
});

test('bloqueia downloads pendentes ou concluídos e libera somente uma falha confirmada', () => {
  const api = carregarApi();
  const valores = new Map();
  const storage = {
    getItem(chave) { return valores.get(chave) ?? null; },
    setItem(chave, valor) { valores.set(chave, valor); },
    removeItem(chave) { valores.delete(chave); }
  };
  const chave = 'st-segunda-via-boleto:download:teste';

  api.reservarDownload(storage, chave, 1000);
  assert.throws(
    () => api.reservarDownload(storage, chave, 2000),
    /em andamento/
  );

  assert.equal(api.liberarDownload(storage, chave), true);
  api.reservarDownload(storage, chave, 3000);
  api.concluirDownload(storage, chave, 4000);
  assert.throws(
    () => api.reservarDownload(storage, chave, 5000),
    /já teve o download concluído/
  );

  assert.equal(api.liberarDownload(storage, chave), false);
  assert.equal(JSON.parse(storage.getItem(chave)).status, 'concluido');
});

test('timeout transforma a reserva pendente em estado indeterminado e exige liberação explícita', () => {
  const api = carregarApi();
  const valores = new Map();
  const storage = {
    getItem(chave) { return valores.get(chave) ?? null; },
    setItem(chave, valor) { valores.set(chave, valor); },
    removeItem(chave) { valores.delete(chave); }
  };
  const chave = 'st-segunda-via-boleto:download:timeout';

  api.reservarDownload(storage, chave, 1000);
  assert.equal(api.marcarDownloadIndeterminado(storage, chave, 2000), true);
  assert.equal(JSON.parse(storage.getItem(chave)).status, 'indeterminado');

  assert.throws(
    () => api.reservarDownload(storage, chave, 3000),
    erro => erro.code === 'DOWNLOAD_INDETERMINADO'
  );
  assert.equal(api.liberarDownload(storage, chave), false);
  assert.equal(JSON.parse(storage.getItem(chave)).status, 'indeterminado');

  assert.equal(api.liberarDownloadIndeterminado(storage, chave), true);
  assert.equal(storage.getItem(chave), null);
  assert.doesNotThrow(() => api.reservarDownload(storage, chave, 4000));
});

test('reserva pendente expirada vira indeterminada, em vez de permitir novo download', () => {
  const api = carregarApi();
  const valores = new Map();
  const storage = {
    getItem(chave) { return valores.get(chave) ?? null; },
    setItem(chave, valor) { valores.set(chave, valor); },
    removeItem(chave) { valores.delete(chave); }
  };
  const chave = 'st-segunda-via-boleto:download:expirado';

  api.reservarDownload(storage, chave, 1000);
  assert.throws(
    () => api.reservarDownload(storage, chave, 1000 + 16 * 60 * 1000),
    erro => erro.code === 'DOWNLOAD_INDETERMINADO'
  );
  assert.equal(JSON.parse(storage.getItem(chave)).status, 'indeterminado');
});

test('timeout ao obter PDF do Systextil não inicia upload e é falha comprovada', () => {
  let onerrorRequest = null;
  let uploads = 0;
  let erros = 0;
  let indeterminados = 0;

  const api = carregarApi([], {}, {
    GM_xmlhttpRequest(opcoes) {
      if (opcoes.method === 'GET') {
        onerrorRequest = opcoes.ontimeout;
      } else {
        uploads += 1;
      }
      return { abort() {} };
    }
  });

  api.iniciarDownloadPdf(
    'http://systextil.texcotton.com.br/systextil/download/x.pdf?report=x.jrprint&ext=pdf&program=forms.crec.crec_e259',
    'arquivo.pdf',
    'D'.repeat(43),
    {
      onerror() { erros += 1; },
      ontimeout() { indeterminados += 1; }
    }
  );

  onerrorRequest();
  assert.equal(erros, 1);
  assert.equal(indeterminados, 0);
  assert.equal(uploads, 0);
});



test('download exige chave salva e teste do auxiliar antes de habilitar a ação', () => {
  assert.match(source, /let auxiliarValidado = false/);
  assert.match(source, /&&\s*auxiliarValidado;/);
  assert.match(source, /auxiliarValidado = true/);
  assert.match(source, /auxiliarValidado = false/);
  assert.equal(source.includes('GM_download('), false);
});
test('a análise da Fase 3 não seleciona nem inicia download automaticamente', () => {
  const api = carregarApi();

  assert.equal(typeof api.analisarProcessos, 'function');
  assert.ok(source.includes('Baixar PDF do processo identificado'));
  assert.ok(source.includes('botaoBaixar.addEventListener("click"'));
  assert.ok(source.includes('saveAs: false'));
  assert.equal(source.includes('doCommand('), false);
  assert.equal(source.includes('.submit('), false);
});


test('captura clique em Emite boleto sem cancelar nem repetir a ação do ERP', () => {
  const inicio = source.indexOf('const handler = function (evento)');
  const fim = source.indexOf('documento.addEventListener("click", handler, true)', inicio);
  const handler = source.slice(inicio, fim);

  assert.ok(inicio >= 0);
  assert.ok(fim > inicio);
  assert.ok(handler.includes('elemento.id === "BTNEmetirBoletos."'));
  assert.ok(handler.includes('elemento.name === "CMDEmetirBoletos"'));
  assert.equal(handler.includes('preventDefault'), false);
  assert.equal(handler.includes('stopPropagation'), false);
  assert.ok(handler.includes('salvarSolicitacaoEmissao(documento)'));

  const inicioSalvar = source.indexOf('function salvarSolicitacaoEmissao(documento)');
  const fimSalvar = source.indexOf('function recuperarSolicitacaoEmissao()', inicioSalvar);
  const funcaoSalvar = source.slice(inicioSalvar, fimSalvar);

  assert.ok(inicioSalvar >= 0);
  assert.ok(fimSalvar > inicioSalvar);
  assert.ok(funcaoSalvar.includes('armazenamento.setItem(CHAVE_SOLICITACAO_EMISSAO'));
});

test('registra o atalho Ctrl+Alt+B para alternar a conferência', () => {
  assert.match(source, /event\.ctrlKey/);
  assert.match(source, /event\.altKey/);
  assert.match(source, /Ctrl \+ Alt \+ B/);
  assert.ok(source.includes('window.addEventListener("keydown"'));
  assert.ok(source.includes("event.stopImmediatePropagation()"));
});

test('identifica os nomes de campos mapeados', () => {
  const api = carregarApi();

  assert.equal(api.fieldNames.titulo, 'num_duplicata.');
  assert.equal(api.fieldNames.parcela, 'seq_duplicatas.');
  assert.equal(api.fieldNames.cliente, 'nome_cliente.');
});

test('monta o nome no padrão Cliente - Título.Parcela.pdf', () => {
  const api = carregarApi();

  assert.equal(
    api.montarNomeArquivo({
      cliente: 'Joaozin da silva',
      titulo: '936312',
      parcela: '01'
    }),
    'Joaozin da silva - 936312.01.pdf'
  );
});

test('limita o início da razão social a palavras inteiras e indica o corte', () => {
  const api = carregarApi();
  const razaoSocial = 'Confecções Industriais e Comércio de Tecidos Ltda.';

  assert.equal(
    api.limitarInicioRazaoSocial(razaoSocial),
    'Confecções Industriais e Comércio…'
  );

  assert.equal(
    api.montarNomeArquivo({
      cliente: razaoSocial,
      titulo: '936312',
      parcela: '01'
    }),
    'Confecções Industriais e Comércio… - 936312.01.pdf'
  );
});

test('remove caracteres inválidos do Windows do componente cliente', () => {
  const api = carregarApi();

  assert.equal(
    api.montarNomeArquivo({
      cliente: 'Empresa: Norte/Filial? *',
      titulo: '123456',
      parcela: '02'
    }),
    'Empresa Norte Filial - 123456.02.pdf'
  );
});

test('preserva acentos e caracteres Unicode válidos', () => {
  const api = carregarApi();

  assert.equal(
    api.montarNomeArquivo({
      cliente: 'Confecções São João Ltda.',
      titulo: '123',
      parcela: '01'
    }),
    'Confecções São João Ltda - 123.01.pdf'
  );
});

test('rejeita dados obrigatórios ausentes ou com formato inesperado', () => {
  const api = carregarApi();

  assert.throws(
    () => api.montarNomeArquivo({
      cliente: '',
      titulo: '123',
      parcela: '01'
    }),
    /Nome do cliente/
  );

  assert.throws(
    () => api.montarNomeArquivo({
      cliente: 'Cliente',
      titulo: '../123',
      parcela: '01'
    }),
    /Número do título/
  );

  assert.throws(
    () => api.montarNomeArquivo({
      cliente: 'Cliente',
      titulo: '123',
      parcela: ''
    }),
    /Parcela/
  );
});

test('limita o comprimento do nome de arquivo', () => {
  const api = carregarApi();

  const nome = api.montarNomeArquivo({
    cliente: 'A'.repeat(250),
    titulo: '936312',
    parcela: '01'
  });

  assert.ok(Array.from(nome).length <= 180);
  assert.ok(nome.endsWith(' - 936312.01.pdf'));
});


test('confirma que o relatório .jrprint selecionado corresponde à URL preparada', () => {
  const api = carregarApi();
  const page = {
    document: {
      querySelectorAll() {
        return [{
          options: [],
          selectedOptions: [{ value: 'blt999999.jrprint' }]
        }];
      }
    },
    curDataView: { name: 'forms.systextil.batch', currentRow: 0 },
    getFileUrl() {
      return 'download/blt365332.pdf?report=blt365332.jrprint&ext=pdf&program=forms.crec.crec_e259';
    }
  };
  const registro = {
    rowIndex: 2,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: '04/11/2026 12:12:38',
    mensagem: 'Processo concluído com sucesso.'
  };

  assert.throws(
    () => api.prepararUrlDownloadProcesso(
      registro,
      page,
      'http://systextil.texcotton.com.br/systextil/forms.systextil.senha.nxj',
      () => [registro]
    ),
    /não corresponde ao relatório atualmente selecionado/
  );
  assert.equal(page.curDataView.currentRow, 0);
});

test('não aceita mais de um relatório .jrprint selecionado na página', () => {
  const api = carregarApi();
  const documento = {
    querySelectorAll() {
      return [
        { options: [], selectedOptions: [{ value: 'blt1.jrprint' }] },
        { options: [], selectedOptions: [{ value: 'blt2.jrprint' }] }
      ];
    }
  };

  assert.throws(
    () => api.obterRelatorioSelecionado(documento),
    /Mais de um relatório/
  );
});

test('valida assinatura, limite e marcador final de um PDF antes de enviá-lo ao auxiliar', () => {
  const api = carregarApi();
  const pdf = Uint8Array.from(Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'ascii')).buffer;
  assert.equal(api.validarBytesPdf(pdf).byteLength, pdf.byteLength);

  const html = Uint8Array.from(Buffer.from('<html>erro</html>', 'ascii')).buffer;
  assert.throws(() => api.validarBytesPdf(html), /assinatura de um PDF/);

  const semFim = Uint8Array.from(Buffer.from('%PDF-1.7\nconteudo sem marcador', 'ascii')).buffer;
  assert.throws(() => api.validarBytesPdf(semFim), /marcador final/);

  const vazio = new ArrayBuffer(0);
  assert.throws(() => api.validarBytesPdf(vazio), /vazio ou excede/);
});

test('baixa o PDF autenticado do Systextil e o envia ao auxiliar local sem usar Downloads', () => {
  const url = 'http://systextil.texcotton.com.br/systextil/download/blt365332.pdf?report=blt365332.jrprint&ext=pdf&program=forms.crec.crec_e259';
  const nome = 'Confecções Industriais… - 000944246.01.pdf';
  const token = 'A'.repeat(43);
  const pdf = Uint8Array.from(Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'ascii')).buffer;
  const requisicoes = [];
  let sucesso = null;
  let falhas = 0;

  const api = carregarApi([], {}, {
    GM_xmlhttpRequest(detalhes) {
      requisicoes.push(detalhes);
      if (detalhes.method === 'GET') {
        detalhes.onload({ status: 200, finalUrl: url, response: pdf });
      } else {
        detalhes.onload({
          status: 201,
          responseText: JSON.stringify({
            ok: true,
            fileName: nome,
            bytes: pdf.byteLength
          })
        });
      }
      return { abort() {} };
    }
  });

  api.iniciarDownloadPdf(url, nome, token, {
    onload(detalhe) { sucesso = detalhe; },
    onerror() { falhas += 1; }
  });

  assert.equal(requisicoes.length, 2);
  assert.equal(requisicoes[0].method, 'GET');
  assert.equal(requisicoes[0].responseType, 'arraybuffer');
  assert.equal(requisicoes[0].anonymous, false);
  assert.equal(requisicoes[1].method, 'POST');
  assert.match(requisicoes[1].url, /^http:\/\/127\.0\.0\.1:17834\/api\/pdf\?name=/);
  assert.equal(new URL(requisicoes[1].url).searchParams.get('name'), nome);
  assert.equal(requisicoes[1].headers['Content-Type'], 'application/pdf');
  assert.equal(requisicoes[1].headers['X-ST-Boleto-Token'], token);
  assert.equal(requisicoes[1].data.byteLength, pdf.byteLength);
  assert.equal(sucesso.fileName, nome);
  assert.equal(sucesso.bytes, pdf.byteLength);
  assert.equal(falhas, 0);
});

test('não inicia transferência se a chave do auxiliar estiver ausente ou inválida', () => {
  let requisicoes = 0;
  const api = carregarApi([], {}, {
    GM_xmlhttpRequest() {
      requisicoes += 1;
      return { abort() {} };
    }
  });

  assert.throws(
    () => api.iniciarDownloadPdf('http://systextil.texcotton.com.br/systextil/download/x.pdf?report=x.jrprint&ext=pdf&program=forms.crec.crec_e259', 'arquivo.pdf', 'invalida', {}),
    /chave do auxiliar/
  );
  assert.equal(requisicoes, 0);
});

test('trata falha de conexão durante envio ao auxiliar como resultado indeterminado', () => {
  const url = 'http://systextil.texcotton.com.br/systextil/download/blt365332.pdf?report=blt365332.jrprint&ext=pdf&program=forms.crec.crec_e259';
  const pdf = Uint8Array.from(Buffer.from('%PDF-1.7\n%%EOF', 'ascii')).buffer;
  let indeterminados = 0;
  let falhasComprovadas = 0;
  const api = carregarApi([], {}, {
    GM_xmlhttpRequest(detalhes) {
      if (detalhes.method === 'GET') {
        detalhes.onload({ status: 200, finalUrl: url, response: pdf });
      } else {
        detalhes.ontimeout();
      }
      return { abort() {} };
    }
  });

  api.iniciarDownloadPdf(url, 'arquivo.pdf', 'B'.repeat(43), {
    ontimeout() { indeterminados += 1; },
    onerror() { falhasComprovadas += 1; }
  });

  assert.equal(indeterminados, 1);
  assert.equal(falhasComprovadas, 0);
});

test('testa a conexão e só aprova auxiliar com pasta de destino acessível', () => {
  let requisicao = null;
  let sucesso = null;
  const token = 'C'.repeat(43);
  const api = carregarApi([], {}, {
    GM_xmlhttpRequest(detalhes) {
      requisicao = detalhes;
      detalhes.onload({
        status: 200,
        responseText: JSON.stringify({ ok: true, destinationReady: true, version: '1.0.0' })
      });
      return { abort() {} };
    }
  });

  api.testarConexaoAuxiliar(token, { onload(detalhe) { sucesso = detalhe; } });

  assert.equal(requisicao.method, 'GET');
  assert.equal(requisicao.url, 'http://127.0.0.1:17834/api/ready');
  assert.equal(requisicao.headers['X-ST-Boleto-Token'], token);
  assert.equal(sucesso.destinationReady, true);
});

test('o auxiliar PowerShell fica limitado a loopback, autentica e grava sem sobrescrever', () => {
  const helperPath = path.join(
    __dirname,
    '..',
    'tools',
    'boleto-helper',
    'BoletoHelper.ps1'
  );
  const helper = fs.readFileSync(helperPath, 'utf8');

  assert.match(helper, /TcpListener.*127\.0\.0\.1/s);
  assert.match(helper, /IPAddress\]::IsLoopback/);
  assert.match(helper, /Test-RequestToken/);
  assert.match(helper, /MaxPdfBytes = 25MB/);
  assert.match(helper, /Test-PdfBytes/);
  assert.match(helper, /Test-SafePdfName/);
  assert.match(helper, /\[System\.IO\.File\]::Move/);
  assert.match(helper, /127\.0\.0\.1:17834/);
  assert.equal(helper.includes('IPAddress]::Any'), false);
});

test('o instalador cria configuração local protegida e inicialização no logon', () => {
  const installerPath = path.join(
    __dirname,
    '..',
    'tools',
    'boleto-helper',
    'Instalar.ps1'
  );
  const installer = fs.readFileSync(installerPath, 'utf8');

  assert.match(installer, /RandomNumberGenerator/);
  assert.match(installer, /DestinationDirectory/);
  assert.match(installer, /CreateShortcut/);
  assert.match(installer, /Programs\\Startup/);
  assert.match(installer, /127\.0\.0\.1:17834/);
  assert.equal(installer.includes('Set-ExecutionPolicy'), false);
});



test('recria o painel correto ao atualizar uma versão antiga na tela de Processos agendados', () => {
  const inicio = source.lastIndexOf('const painelAtual = document.getElementById(PANEL_ID);');
  const bloco = source.slice(inicio);

  assert.ok(inicio >= 0);
  assert.match(bloco, /if \(painelAtual && painelAtual\.dataset\.scriptVersion !== VERSION\)/);
  assert.match(bloco, /painelAtual\.remove\(\);/);
  assert.match(bloco, /alternarPainel\(\);/);
  assert.equal(bloco.includes('montarPainel();'), false);
});


test('mantém os helpers necessários para inicialização dos dois painéis', () => {
  assert.match(source, /function criarElemento\(tag, texto, classe\)/);
  assert.match(source, /function ehTelaConsultaTitulo\(\)/);
  assert.match(source, /function ehTelaSuportada\(\)/);
});
