# Construtor de Automações Systextil

**Userscript:** `userscripts/systextil-construtor-automacoes.user.js`  
**Versão inicial:** 0.1.0  
**Execução:** Tampermonkey, somente nas páginas do Systextil  
**Estado:** MVP de criação e leitura de receitas; homologação operacional pendente

## Objetivo

Oferecer um painel dentro do Systextil para criar receitas reutilizáveis sem editar JavaScript. Uma receita declara a visão de destino e os campos que devem ser lidos. O construtor valida a estrutura antes de capturar qualquer valor.

Este userscript é independente. Ele não importa, altera nem depende de `systextil-segunda-via.user.js`, `systextil-crm-bridge.user.js` ou de qualquer outra automação.

## Escopo da versão 0.1.0

- Detectar `unsafeWindow.curDataView.name` e listar os formulários/campos nomeados da tela atual.
- Exibir somente metadados dos campos durante a inspeção: nome, tipo, quantidade de ocorrências e estado readonly/disabled. A inspeção não lê nem imprime valores.
- Criar e salvar uma receita com nome, descrição, visão e de 1 a 30 campos.
- Reabrir, excluir, importar e exportar receitas em JSON.
- Validar que a visão atual corresponde à receita.
- Localizar exatamente um formulário que contenha cada campo escolhido uma única vez.
- Capturar valores somente após clique explícito em **Capturar dados**.
- Exibir a captura na aba atual e permitir exportação CSV local com BOM UTF-8, separador ponto e vírgula e proteção contra fórmulas de planilha.

A persistência local contém apenas a definição da receita. Os valores capturados ficam em memória e não são escritos em localStorage, GM storage, console ou serviço externo.

## Limites deliberados

A versão 0.1.0 **não**:

- preenche campos ou filtros;
- aciona Find, F7 ou qualquer comando NXJ;
- navega por registros ou percorre grades em lote;
- clica em controles do ERP;
- cria, altera, baixa, emite, envia ou exclui dados;
- executa JavaScript, expressões, callbacks ou passos arbitrários importados por JSON.

Somente inputs escalares de texto/número/data e campos `select` simples/`textarea` são elegíveis. Controles checkbox, radio, senha, arquivo, botão e select múltiplo não são aceitos. Campos duplicados ou desabilitados não podem ser selecionados. Se mais de um formulário corresponder à mesma receita, a captura é bloqueada por ambiguidade.

O operador deve abrir a tela, executar manualmente a consulta desejada e então clicar em **Capturar dados**. A leitura não comprova que a consulta retornou o registro esperado; isso continua sob responsabilidade da conferência visual do operador.

## Modelo de receita

Exemplo ilustrativo, sem dados reais:

```json
{
  "schema": 1,
  "id": "leitura-titulo-demo",
  "nome": "Leitura de título",
  "descricao": "Campos para conferência após consulta manual.",
  "visao": "forms.crec.crec_f090",
  "campos": [
    "num_duplicata.",
    "seq_duplicatas.",
    "nome_cliente.",
    "data_venc_duplic.",
    "saldo_duplicata."
  ],
  "criadaEm": 1800000000000,
  "atualizadaEm": 1800000000100
}
```

O importador revalida todos os campos e reconstrói o objeto com uma lista fechada de propriedades. Propriedades extras, incluindo `codigo`, `passos` ou callbacks, são descartadas. O limite é de 100 receitas por coleção e 1 MB por arquivo importado.

As receitas são gravadas em localStorage na origem do Systextil, sob uma chave versionada. Receitas inválidas não são executadas.

## Fluxo do operador

1. Abrir uma tela do Systextil e abrir **Automações Systextil**.
2. Clicar em **Atualizar tela** para descobrir a visão e os campos presentes.
3. Informar o nome da receita, selecionar os campos e clicar em **Salvar receita**.
4. Clicar em **Validar receita**. A validação não lê valores nem envia comandos ao ERP.
5. Executar a consulta manualmente no Systextil.
6. Clicar em **Capturar dados** para ler os campos declarados.
7. Conferir o resultado na tela e, quando necessário, clicar em **Exportar CSV**.

Para uma tela diferente, usar **Nova receita**. Uma receita existente permanece vinculada à visão em que foi criada.

## Arquitetura e segurança

- Um único userscript autossuficiente, sem `@require`, `@connect` ou dependências externas.
- `unsafeWindow` é utilizado somente para ler `curDataView.name` e acessar localStorage da origem.
- O acesso ao DOM é restrito à leitura de formulários na página atual.
- Textos provenientes do ERP são renderizados via `textContent`; não são interpolados em HTML.
- A receita não armazena dados do cliente. Os resultados não são persistidos automaticamente.
- O CSV é criado no navegador e baixado somente após ação explícita.
- Não há retentativa, interceptação de XHR, monitor de tráfego ou modificação de protótipos nesta versão.

## Testes

Na raiz do repositório, com Node.js 18 ou superior:

```powershell
npm run verify
```

A suíte `tests/construtor-automacoes.test.js` cobre validação de receitas, rejeição de duplicidades, descarte de propriedades executáveis, geração CSV e limites estáticos do userscript.

Esses testes não provam a compatibilidade visual com os formulários do Systextil. Validar manualmente no Chrome/Tampermonkey real: abertura do painel, catalogação de uma tela conhecida, criação/importação de receita, bloqueio em visão divergente, leitura de campos e exportação CSV. Usar dados autorizados e evitar qualquer operação de gravação durante a homologação.

## Próxima evolução

A primeira capacidade de execução além da leitura manual deve ser uma receita de consulta em lote L0 na visão `forms.crec.crec_f090`, após implementar e testar isoladamente a confirmação NXJ de cada filtro, a espera pelo término do Find, a detecção de zero/um/múltiplos registros e a interrupção segura por timeout. Nenhuma receita L2/L3 deve ser liberada pelo editor genérico sem sonda da tela, critérios verificáveis e autorização humana específica.
