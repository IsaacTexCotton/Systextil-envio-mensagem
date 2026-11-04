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

function carregarApi(forms = []) {
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
  const window = { document, console: consoleTeste };
  window.top = window;

  vm.runInNewContext(
    source,
    { window, document, console: consoleTeste, Object, Array, String, Event },
    { filename: scriptPath }
  );

  assert.ok(window.__systextilSegundaViaBoletoDebug);
  return window.__systextilSegundaViaBoletoDebug;
}

test('userscript usa execução sob demanda pelo menu do Tampermonkey', () => {
  assert.match(source, /^\/\/ @run-at\s+context-menu$/m);

  const api = carregarApi();
  assert.equal(api.version, '0.3.0');
});

test('declara URLs estáveis para verificar e baixar atualizações', () => {
  const url = 'https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via-boleto.user.js';

  assert.match(source, /^\/\/ @version\s+0\.3\.0$/m);
  assert.ok(source.includes('// @updateURL     ' + url));
  assert.ok(source.includes('// @downloadURL   ' + url));
});


test('valida códigos de consulta sem remover zeros à esquerda', () => {
  const api = carregarApi();

  assert.equal(api.validarCodigoConsulta(' 000936312 ', 'Número do título'), '000936312');
  assert.equal(api.validarCodigoConsulta('01', 'Parcela'), '01');
});


test('completa dois zeros no título e um zero na parcela', () => {
  const api = carregarApi();

  assert.equal(api.normalizarCodigoConsulta('936520', 'Número do título', 8), '00936520');
  assert.equal(api.normalizarCodigoConsulta('1', 'Parcela', 2), '01');
});

test('preserva códigos que já estão completos e respeita a largura declarada pelo ERP', () => {
  const api = carregarApi();

  assert.equal(api.normalizarCodigoConsulta('00936520', 'Número do título', 8), '00936520');
  assert.equal(api.normalizarCodigoConsulta('01', 'Parcela', 2), '01');
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
    parcela: '1'
  });

  assert.equal(resultado.titulo, '00936520');
  assert.equal(resultado.parcela, '01');
  assert.equal(campos['num_duplicata.'].value, '00936520');
  assert.equal(campos['seq_duplicatas.'].value, '01');
  assert.deepEqual(campos['num_duplicata.'].eventos, ['input', 'change']);
  assert.deepEqual(campos['seq_duplicatas.'].eventos, ['input', 'change']);
  assert.equal(campos['num_duplicata.'].focado, true);
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
  const solicitadoEm = new Date(2026, 10, 4, 11, 30, 0).getTime();
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

test('a Fase 3 identifica a linha sem selecionar ou baixar o processo', () => {
  const api = carregarApi();

  assert.equal(typeof api.analisarProcessos, 'function');
  assert.ok(source.includes('Nenhuma linha foi selecionada e nenhum PDF foi baixado.'));
  assert.equal(source.includes('doCommand('), false);
  assert.equal(source.includes('GM_download('), false);
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
  assert.ok(handler.includes('armazenamento.setItem(CHAVE_SOLICITACAO_EMISSAO'));
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
