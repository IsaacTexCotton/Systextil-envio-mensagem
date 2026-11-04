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
    getElementById() {}
  };

  const consoleTeste = {
    warn() {},
    error() {},
    log() {}
  };
  const window = { document, console: consoleTeste, ...propriedadesJanela };
  window.top = window;

  vm.runInNewContext(
    source,
    { window, document, console: consoleTeste, Object, Array, String, Event, URL, ...propriedadesGlobais },
    { filename: scriptPath }
  );

  assert.ok(window.__systextilSegundaViaBoletoDebug);
  return window.__systextilSegundaViaBoletoDebug;
}

test('userscript usa execução sob demanda pelo menu do Tampermonkey', () => {
  assert.match(source, /^\/\/ @run-at\s+context-menu$/m);

  const api = carregarApi();
  assert.equal(api.version, '0.4.1');
});

test('declara URLs estáveis para verificar e baixar atualizações', () => {
  const url = 'https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via-boleto.user.js';

  assert.match(source, /^\/\/ @version\s+0\.4\.1$/m);
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

test('preenche número e parcela, dispara eventos de atualização e mantém foco no título', () => {
  const campos = {
    'num_duplicata.': {
      value: '',
      disabled: false,
      readOnly: false,
      eventos: [],
      dispatchEvent(evento) {
        this.eventos.push(evento.type);
        return true;
      },
      focus() {
        this.focado = true;
      }
    },
    'seq_duplicatas.': {
      value: '',
      disabled: false,
      readOnly: false,
      eventos: [],
      dispatchEvent(evento) {
        this.eventos.push(evento.type);
        return true;
      }
    }
  };
  const formulario = {
    elements: {
      namedItem(nome) {
        return campos[nome] || null;
      }
    }
  };
  const api = carregarApi([formulario]);

  const resultado = api.preencherCamposConsulta({
    titulo: '936520',
    parcela: '3'
  });

  assert.equal(resultado.titulo, '00936520');
  assert.equal(resultado.parcela, '3');
  assert.equal(campos['num_duplicata.'].value, '00936520');
  assert.equal(campos['seq_duplicatas.'].value, '3');
  assert.deepEqual(campos['num_duplicata.'].eventos, ['input', 'change']);
  assert.deepEqual(campos['seq_duplicatas.'].eventos, ['input', 'change']);
  assert.equal(campos['num_duplicata.'].focado, true);
});

test('usa o setter nativo do input e InputEvent ao preencher os campos do Systextil', () => {
  let chamadasSetterNativo = 0;
  let chamadasSetterDireto = 0;

  function HTMLInputElement() {}
  Object.defineProperty(HTMLInputElement.prototype, 'value', {
    configurable: true,
    get() {
      return this.__valorReal || '';
    },
    set(valor) {
      chamadasSetterNativo += 1;
      this.__valorReal = String(valor);
    }
  });

  class InputEventTeste extends Event {
    constructor(tipo, opcoes = {}) {
      super(tipo, opcoes);
      this.inputType = opcoes.inputType;
      this.data = opcoes.data;
    }
  }

  const eventos = [];
  function criarCampo() {
    const campo = Object.create(HTMLInputElement.prototype);
    Object.defineProperties(campo, {
      value: {
        configurable: true,
        get() {
          return this.__valorReal || '';
        },
        set(valor) {
          chamadasSetterDireto += 1;
          this.__valorReal = String(valor);
        }
      },
      disabled: { value: false },
      readOnly: { value: false }
    });
    campo.dispatchEvent = evento => {
      eventos.push({
        tipo: evento.type,
        inputType: evento.inputType,
        data: evento.data
      });
      return true;
    };
    campo.focus = () => {};
    return campo;
  }

  const campos = {
    'num_duplicata.': criarCampo(),
    'seq_duplicatas.': criarCampo()
  };
  const formulario = {
    elements: {
      namedItem(nome) {
        return campos[nome] || null;
      }
    }
  };
  const api = carregarApi([formulario], {
    HTMLInputElement,
    InputEvent: InputEventTeste,
    Event
  });

  const resultado = api.preencherCamposConsulta({
    titulo: '936520',
    parcela: '3'
  });

  assert.equal(resultado.titulo, '00936520');
  assert.equal(resultado.parcela, '3');
  assert.equal(chamadasSetterNativo, 2);
  assert.equal(chamadasSetterDireto, 0);
  assert.equal(campos['num_duplicata.'].value, '00936520');
  assert.equal(campos['seq_duplicatas.'].value, '3');
  assert.equal(eventos.filter(evento => evento.tipo === 'input').length, 2);
  assert.equal(eventos.filter(evento => evento.tipo === 'change').length, 2);
  assert.ok(eventos.filter(evento => evento.tipo === 'input').every(evento =>
    evento.inputType === 'insertReplacementText'
  ));
});

test('não preenche quando há mais de um formulário compatível', () => {
  function criarFormulario() {
    const campos = {
      'num_duplicata.': { value: '', disabled: false, readOnly: false, dispatchEvent() {} },
      'seq_duplicatas.': { value: '', disabled: false, readOnly: false, dispatchEvent() {} }
    };
    return {
      elements: {
        namedItem(nome) {
          return campos[nome] || null;
        }
      }
    };
  }

  const api = carregarApi([criarFormulario(), criarFormulario()]);
  assert.throws(
    () => api.preencherCamposConsulta({ titulo: '123', parcela: '01' }),
    /Mais de um formulário/
  );
});

test('restaura os dois valores anteriores se o preenchimento parcial falhar', () => {
  const campoTitulo = {
    value: 'TITULO-ANTERIOR',
    disabled: false,
    readOnly: false,
    dispatchEvent() {
      return true;
    }
  };
  const campoParcela = {
    value: 'PARCELA-ANTERIOR',
    disabled: false,
    readOnly: false,
    dispatchEvent() {
      throw new Error('falha simulada');
    }
  };
  const formulario = {
    elements: {
      namedItem(nome) {
        if (nome === 'num_duplicata.') return campoTitulo;
        if (nome === 'seq_duplicatas.') return campoParcela;
        return null;
      }
    }
  };
  const api = carregarApi([formulario]);

  assert.throws(
    () => api.preencherCamposConsulta({ titulo: '123', parcela: '02' }),
    /valores anteriores foram restaurados/
  );
  assert.equal(campoTitulo.value, 'TITULO-ANTERIOR');
  assert.equal(campoParcela.value, 'PARCELA-ANTERIOR');
});

test('não envia F7 nem submete o formulário automaticamente', () => {
  const api = carregarApi();

  assert.match(source, /pressione F7 manualmente/);
  assert.equal(source.includes('.submit('), false);
  assert.equal(source.includes('new KeyboardEvent('), false);
  assert.equal(typeof api.preencherCamposConsulta, 'function');
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

test('a Fase 4 declara somente as permissões Tampermonkey necessárias', () => {
  assert.match(source, /^\/\/ @grant\s+unsafeWindow$/m);
  assert.match(source, /^\/\/ @grant\s+GM_download$/m);
  assert.equal(source.includes('// @grant        none'), false);
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
  const page = { DataView: { currentRow: 4 } };

  const selecao = api.selecionarRegistroProcesso(registro, page, () => [registro]);

  assert.equal(page.DataView.currentRow, 0);
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
  const page = { DataView: { currentRow: 3 } };

  assert.throws(
    () => api.selecionarRegistroProcesso(registro, page, () => [{
      ...registro,
      dataExecucao: '04/11/2026 12:13:00'
    }]),
    /mudou desde a análise/
  );
  assert.equal(page.DataView.currentRow, 3);
});

test('não tenta selecionar quando a API DataView.currentRow não está disponível', () => {
  const api = carregarApi();
  const registro = {
    rowIndex: 0,
    titulo: 'Emissão de boletos com registro',
    dataExecucao: '04/11/2026 12:12:38',
    mensagem: 'Processo concluído com sucesso.'
  };

  assert.throws(
    () => api.selecionarRegistroProcesso(registro, {}, () => [registro]),
    /API de seleção da grade/
  );
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
    DataView: { currentRow: 0 },
    getFileUrl() {
      assert.equal(this.DataView.currentRow, 2);
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
  assert.equal(page.DataView.currentRow, 2);
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
    DataView: { currentRow: 5 },
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
  assert.equal(page.DataView.currentRow, 5);
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

test('encaminha timeout para callback próprio, sem tratá-lo como falha comprovada', () => {
  let opcoesDownload;
  const api = carregarApi([], {}, {
    GM_download(opcoes) {
      opcoesDownload = opcoes;
      return 'download-id';
    }
  });

  let erros = 0;
  let timeouts = 0;
  let sucessos = 0;
  api.iniciarDownloadPdf('https://exemplo.test/arquivo.pdf', 'arquivo.pdf', {
    onload() { sucessos += 1; },
    onerror() { erros += 1; },
    ontimeout() { timeouts += 1; }
  });

  opcoesDownload.ontimeout({ error: 'timeout' });
  opcoesDownload.onload({});
  opcoesDownload.onerror({ error: 'late-error' });

  assert.equal(timeouts, 1);
  assert.equal(erros, 0);
  assert.equal(sucessos, 0);
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
    DataView: { currentRow: 0 },
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
  assert.equal(page.DataView.currentRow, 0);
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

test('GM_download usa o nome PDF e a pasta padrão sem abrir diálogo de destino', () => {
  let opcoes = null;
  let sucesso = 0;
  const api = carregarApi([], {}, {
    GM_download(detalhes) {
      opcoes = detalhes;
      return { abort() {} };
    }
  });

  api.iniciarDownloadPdf(
    'http://systextil.texcotton.com.br/systextil/download/blt365332.pdf?report=blt365332.jrprint&ext=pdf&program=forms.crec.crec_e259',
    'Confecções Industriais… - 000944246.01.pdf',
    { onload() { sucesso += 1; } }
  );

  assert.equal(opcoes.name, 'Confecções Industriais… - 000944246.01.pdf');
  assert.equal(opcoes.saveAs, false);
  assert.equal(typeof opcoes.onload, 'function');
  assert.equal(typeof opcoes.onerror, 'function');
  assert.equal(typeof opcoes.ontimeout, 'function');

  opcoes.onload({ state: 'complete' });
  opcoes.onerror({ error: 'late-error' });
  assert.equal(sucesso, 1);
});

test('GM_download falha de forma explícita quando a permissão não está disponível', () => {
  const api = carregarApi();

  assert.throws(
    () => api.iniciarDownloadPdf('https://systextil.exemplo/arquivo.pdf', 'arquivo.pdf', {}),
    /GM_download não está disponível/
  );
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
