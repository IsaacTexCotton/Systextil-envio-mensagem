# Sonda de diagnóstico — prorrogação de títulos

## Objetivo

Identificar, no Systextil real, as visões, formulários, campos e comandos NXJ usados no procedimento manual de prorrogação. Esta sonda é temporária e independente dos userscripts operacionais.

## Garantias e limites

A sonda:

- não preenche, limpa ou altera campos;
- não clica em controles do ERP;
- não envia comandos NXJ;
- não executa F2, F7, F9, Enter ou qualquer atalho;
- não navega entre telas nem salva registros;
- não lê a propriedade \`value\` dos campos;
- não captura conteúdo de respostas do servidor, query strings, cookies, tokens ou identificadores de sessão;
- registra somente metadados: nome da visão, estrutura dos formulários/campos, teclas relevantes pressionadas manualmente, comando NXJ, campo informado pelo próprio NXJ e quantidade de segmentos de \`fieldValues\`.

O registro de \`fieldValues\` contém apenas contagens. Os valores transportados nunca são exportados. Rótulos só são registrados quando correspondem a uma lista restrita de nomes de campos relevantes.

**A sonda não torna segura uma alteração manual no ERP.** Não realize uma prorrogação de teste em título de produção apenas para gerar diagnóstico. Faça a captura durante uma prorrogação que já esteja autorizada ou em ambiente/título de homologação.

## Arquivo

\`userscripts/systextil-sonda-prorrogacao.user.js\` — versão 0.1.0.

## Como executar sem recarregar a sessão

1. Abra a aba já autenticada do Systextil.
2. No Tampermonkey, crie um userscript temporário e copie o arquivo acima, ou instale o arquivo da branch de diagnóstico.
3. Salve o script. O cabeçalho usa \`@run-at context-menu\`; portanto, a sonda deve ser iniciada pelo popup do Tampermonkey na aba já aberta, sem atualizar/recarregar a tela.
4. Clique no ícone do Tampermonkey e execute **Systextil — Diagnóstico de Prorrogação (somente leitura)**.
5. Confira se o painel **SOMENTE LEITURA** apareceu. Clique em **Iniciar captura**.
6. Execute manualmente o procedimento normal, somente quando a operação já estiver autorizada. Antes de cada etapa abaixo, selecione a etapa correspondente e clique em **Registrar etapa**:
   - Consulta de títulos aberta, antes de F7;
   - Consulta de títulos após F7 e carregamento do título;
   - Manutenção de Títulos a Receber, alcançada pelo caminho correto;
   - após substituir \`Compl.hist\` e salvar com F9;
   - Manutenção de Títulos aberta;
   - após alterar \`Prorrog\` e \`Mot\` e salvar com F9;
   - retorno à Consulta de títulos.
7. Não mude a sequência manual por causa da sonda. Ela apenas observa as ações executadas pelo operador.
8. Clique em **Encerrar e restaurar** antes de sair da tela. Isso remove os listeners e restaura os métodos XHR originais quando ainda pertencem à sonda.
9. Clique em **Baixar relatório JSON** e envie o arquivo gerado para revisão.

A sonda pode registrar até 1.200 eventos; quando o limite é atingido, informa quantos foram descartados. Ela observa XHR para \`UnifyNXJ.jsp\`; não captura outras tecnologias de transporte.

## O que revisar no relatório

- \`etapas[].snapshots[].viewName\`: visão ativa em cada etapa.
- \`forms[].name\` / \`forms[].id\`: formulário ativo.
- \`forms[].controles[]\`: nome, id, tipo, estado e posição estrutural dos controles, sem seus valores.
- \`eventos[]\` com \`tipo: "tecla"\`: F2, F7, F9 e Enter pressionados pelo operador.
- \`eventos[]\` com \`tipo: "nxj-request"\`: método, comando, campo, contagem de segmentos e resultado HTTP; sem dados de sessão ou conteúdo dos campos.

## Critério para iniciar a automação

A implementação da prorrogação só deve começar após identificar, com evidência na tela correta:

1. \`curDataView.name\` e o formulário de cada tela de manutenção;
2. os nomes e tipos dos campos de complemento histórico, data de prorrogação e motivo;
3. a sequência real de navegação e os comandos emitidos por F2, Enter e F9;
4. o sinal autoritativo de que cada gravação foi aceita e persistida;
5. a forma de retornar à consulta sem perder a referência do título.

A sonda não prova que uma gravação foi persistida: status HTTP 200 ou presença do comando F9 são apenas metadados. Essa confirmação precisa ser identificada por leitura/reconsulta controlada na própria tela antes de implementar a automação.
