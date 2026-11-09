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

\`userscripts/systextil-sonda-prorrogacao.user.js\` — versão 0.1.2.

## Como executar sem recarregar a sessão

1. Abra a aba já autenticada do Systextil.
2. No Tampermonkey, crie um userscript temporário e copie o arquivo acima, ou instale o arquivo da branch de diagnóstico.
3. Salve o script. O cabeçalho usa \`@run-at context-menu\`; portanto, a sonda deve ser iniciada pelo popup do Tampermonkey na aba já aberta, sem atualizar/recarregar a tela.
4. Clique no ícone do Tampermonkey e execute **Systextil — Diagnóstico de Prorrogação (somente leitura)**. Esse modo de execução exige Tampermonkey 5.6.6239 ou superior.
5. Confira se o painel **SOMENTE LEITURA** apareceu. Clique em **Iniciar captura**. Se o item não aparecer no popup, confira a versão do Tampermonkey; não recarregue a página apenas para tentar ativá-lo.
6. Execute manualmente o procedimento normal, somente quando a operação já estiver autorizada. Antes de cada etapa abaixo, selecione a etapa correspondente e clique em **Registrar etapa**:
   - Consulta de títulos aberta, antes de F7;
   - Consulta de títulos após F7 e carregamento do título;
   - Manutenção de Títulos a Receber, alcançada pelo caminho correto;
   - após substituir \`Compl.hist\` e salvar com F9;
   - Manutenção de Títulos aberta;
   - após alterar \`Prorrog\` e \`Mot\` e salvar com F9;
   - retorno à Consulta de títulos.
7. Não mude a sequência manual por causa da sonda. Ela apenas observa as ações executadas pelo operador.
8. Clique em **Baixar relatório JSON**. A exportação encerra automaticamente a captura, restaura os listeners e os métodos XHR originais (quando ainda pertencem à sonda) e define o horário de encerramento. Também é possível encerrar manualmente em **Encerrar e restaurar** antes de exportar.
9. Envie o arquivo gerado para revisão.

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


## Resultado da segunda coleta (09/11/2026)

A coleta v0.1.1 confirmou:

| Tela | Visão \`curDataView.name\` | Campo de gravação | Evidência após F9 |
|---|---|---|---|
| Manutenção de Títulos a Receber | \`forms.crec.crec_f030\` | \`compl_historico.\` | POST \`ADD_UPDATE\` HTTP 200; \`recordAction: UPDATED\` |
| Manutenção de Títulos | \`forms.crec.crec_f035\` | \`data_prorrogacao.N\` e \`nr_mtv_prorrogacao.N\` | POST \`ADD_UPDATE\` HTTP 200; \`recordAction: UPDATED\` |

\`N\` é o sufixo numérico da linha. A grade expõe vários registros repetidos; a implementação deve localizar a parcela pelo valor do campo \`seq_duplicatas.N\`, exigir correspondência única e validar os campos da mesma linha. Não fixar \`.0\`.

A primeira tela de manutenção foi aberta pelo botão \`cmdBtnTitulos\`. F2 na visão \`forms.crec.crec_f030\` gerou \`cmdNextForm\` e abriu \`forms.crec.crec_f035\`.

O F9 gerou \`ADD_UPDATE\` nas duas visões. A resposta HTTP foi 200 e, nos snapshots posteriores aos marcadores das etapas 4 e 6, \`curDataView.recordAction\` estava como \`UPDATED\`. Isto comprova a resposta positiva observada pelo cliente NXJ nessa coleta, mas ainda não substitui uma releitura independente do registro após retornar à consulta.

Na etapa de complemento histórico houve dois F9 separados, com dois POST \`ADD_UPDATE\`. O primeiro já foi seguido por \`recordAction: UPDATED\`; por isso, a automação deverá enviar F9 uma única vez e nunca repetir o salvamento por timeout ou ausência de retorno visual. Após qualquer resultado indeterminado, interromper a fila para conferência manual.

O retorno à Consulta de títulos ocorreu por dois POST \`PREVIOUS_FORM\` consecutivos: de \`forms.crec.crec_f035\` para \`forms.crec.crec_f030\`, e depois para \`forms.crec.crec_f090\`. A v0.1.1 não registrou qual tecla/atalho originou esses comandos porque capturava somente F2, F7, F9 e Enter. A v0.1.2 amplia a captura para F1–F12, Escape, Enter e Tab, incluindo modificadores, para identificar essa última transição sem repetir qualquer gravação.

**Próxima captura:** somente navegue manualmente entre as telas necessárias para provocar o retorno \`forms.crec.crec_f035\` → \`forms.crec.crec_f030\` → \`forms.crec.crec_f090\`. Não altere campos, não pressione F9 e não execute nova prorrogação apenas para gerar esse diagnóstico. Marque as etapas e exporte o JSON.
