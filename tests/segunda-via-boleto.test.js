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

  const window = { document, console };
  window.top = window;

  vm.runInNewContext(
    source,
    { window, document, console, Object, Array, String, Event },
    { filename: scriptPath }
  );

  assert.ok(window.__systextilSegundaViaBoletoDebug);
  return window.__systextilSegundaViaBoletoDebug;
}

test('userscript usa execução sob demanda pelo menu do Tampermonkey', () => {
  assert.match(source, /^\/\/ @run-at\s+context-menu$/m);

  const api = carregarApi();
  assert.equal(api.version, '0.2.0');
});

test('declara URLs estáveis para verificar e baixar atualizações', () => {
  const url = 'https://raw.githubusercontent.com/IsaacTexCotton/Systextil-envio-mensagem/main/userscripts/systextil-segunda-via-boleto.user.js';

  assert.match(source, /^\/\/ @version\s+0\.2\.0$/m);
  assert.ok(source.includes('// @updateURL     ' + url));
  assert.ok(source.includes('// @downloadURL   ' + url));
});


test('valida códigos de consulta sem remover zeros à esquerda', () => {
  const api = carregarApi();

  assert.equal(api.validarCodigoConsulta(' 000936312 ', 'Número do título'), '000936312');
  assert.equal(api.validarCodigoConsulta('01', 'Parcela'), '01');
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
    titulo: '000936312',
    parcela: '01'
  });

  assert.deepEqual(resultado, { titulo: '000936312', parcela: '01' });
  assert.equal(campos['num_duplicata.'].value, '000936312');
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
