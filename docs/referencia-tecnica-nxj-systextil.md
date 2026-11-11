# Referência técnica do Systextil — NXJ, telas e automações

> **Atualizado em 09/11/2026.** Documento de referência para novas implementações, revisões e investigações no Systextil. Consolida sondas somente leitura, testes manuais documentados, comportamento observado no código do repositório e correções recentes. Não é uma especificação oficial do fornecedor nem garante que todas as telas/ambientes se comportem da mesma forma.

## 1. Como interpretar esta referência

Cada informação deve ser tratada com um destes níveis:

- **Confirmado:** observado diretamente na tela/protocolo ou validado em teste manual descrito.
- **Inferido:** explicação compatível com as evidências, mas sem comprovação direta suficiente.
- **Não testado:** hipótese, código lido ou comportamento que ainda precisa ser verificado no ERP real.
- **Específico de tela/ambiente:** confirmado somente na visão e no ambiente citados. Não generalizar para outras telas, empresas ou instalações.

Ordem de autoridade para uma tarefa concreta:

1. Sequência manual atual da tela e validação operacional nessa mesma tela.
2. Código e testes da branch/commit que será alterado.
3. Documentação específica da funcionalidade e evidências reproduzíveis.
4. Este documento e o guia transversal de Tampermonkey.
5. Hipóteses e conhecimento geral sobre aplicações web.

Quando duas fontes divergirem, registre a divergência e faça uma sonda/teste que diferencie as hipóteses. Não escolha silenciosamente uma delas.

## 2. Estado atual do repositório

### 2.1 main — versão integrada

- Userscript único: **userscripts/systextil-segunda-via.user.js**, versão **1.0.4**.
- PR #36 integrou a barreira NXJ da v1.0.3 ao commit `e01cf0a6775ce5f7f86cd2b1ef45458f72137013`.
- PR #37 integrou a correção do acompanhamento de Processos agendados à main em 09/11/2026, merge commit `57cdc19e9f6b1fe98d295e1fef360a6c2a11dea3`.
- A v1.0.4 mantém a confirmação NXJ de título e parcela antes do Find e passa a classificar mensagens intermediárias/desconhecidas como acompanhamento, não como falha automática.
- O fluxo atual atualiza a grade pelo controle Find a cada quatro segundos, até o limite de três minutos. Se não puder atualizar ou não houver confirmação explícita de sucesso no prazo, o resultado fica indeterminado.
- A emissão não é repetida automaticamente e o download depende da mensagem explícita de sucesso, da identificação inequívoca do processo e da validação posterior do PDF.
- A integração na main **não significa homologação operacional** na estação de trabalho. A validação no Chrome/Tampermonkey/Systextil real continua pendente.
- O userscript da main declara `@version 1.0.4`, com `@updateURL` e `@downloadURL` apontando para o arquivo estável em `main`. Se o Tampermonkey continuar exibindo versão `1.0`, confira o cabeçalho do script efetivamente instalado, desative/remova cópias antigas e atualize a entrada correta. O nome do arquivo ou a descrição não comprovam a versão instalada.
- A PR #37 registrou parse sintático e dez verificações direcionadas aprovadas. `npm run verify` não foi executado naquela sessão.

### 2.2 Limite de evidência após o merge

Os dez cenários direcionados da PR #37 validam a classificação de mensagens e o caminho de atualização com testes controlados. Eles não confirmam quais mensagens reais o ERP produzirá em todos os processos, se a estação permitirá o clique no controle Find nem se a seleção do registro e o PDF correspondem em produção. A lista de marcadores de falha precisa ser confrontada com mensagens reais.

**Regra para agentes:** a v1.0.4 é o código atual da main, mas ainda não deve ser descrita como homologada no ERP real. Preserve a distinção entre merge, testes automatizados e validação operacional.
## 3. Arquitetura observada

### 3.1 Aplicação e contexto

Na instalação investigada:

- Aplicação legada renderizada pelo servidor, baseada no framework NXJ, com URLs .nxj e endpoint UnifyNXJ.jsp.
- Foram observados Dojo antigo, Prototype e jQuery 2.2.3.
- Codificação observada: windows-1252.
- A janela principal contém quadros do mesmo domínio. Na Consulta de títulos estudada, o formulário NXJForm está na janela principal, não em iframe.
- O objeto da tela fica exposto em unsafeWindow.curDataView no contexto do userscript investigado.

Esses dados descrevem o ambiente sondado. Descubra novamente os frames, formulários e objetos ao investigar outra instalação ou tela.

### 3.2 Endpoint NXJ

**Confirmado nas telas investigadas:** as ações observadas passam por:

/systextil/UnifyNXJ.jsp

Foi observada a seguinte sequência:

1. POST com parâmetros de comando, incluindo managerId, windowCounter, focus, clickedOnField, commandName, clickedOnRow, fieldValues, target e promptCounter.
2. Um GET subsequente, normalmente 1–3 ms depois, com parâmetros relacionados a managerId, target, promptCounter e result; nas amostras examinadas, o corpo veio vazio.

A interpretação do GET como canal de aviso/prompt é **inferida**. Não o reproduza manualmente nem dependa dele sem investigação específica.

Tempos observados: normalmente 11–120 ms, alguns casos próximos de 1 s e primeiro comando após carregar a tela próximo de 3,6 s. Esses tempos são amostras, não SLA.

### 3.3 Comandos observados

| commandName | Ação observada | Estado |
| --- | --- | --- |
| ClickOnField | Foco/clique em campo; confirma o campo de origem em determinados fluxos | Confirmado |
| NEXT_FIELD | Saída do campo por Tab; transporta valor pendente em testes | Confirmado |
| FIND | Consulta/Find (equivalente ao F7 ou botão Find na tela estudada) | Confirmado |
| CLEAR_TO_FIND | Limpa/retorna ao modo de pesquisa | Confirmado |
| NEXT_RECORD | Avança registro | Confirmado |
| cmdNextForm, PREVIOUS_FORM | Troca de formulário/tela | Confirmado |

Nomes encontrados em estruturas internas, mas sem efeito testado: ADD_UPDATE, DELETE_RECORD, CLEAR_TO_ADD, SET_NULL, CLEAR_FIELD, ZOOM, FIRST_RECORD, LAST_RECORD, PREVIOUS_RECORD, NEXT_SET, PREVIOUS_SET, CALL_FORM, LOGOUT, EXIT e SAVEANDCLOSE.

Trate comandos de inclusão, alteração, exclusão ou encerramento como não autorizados por padrão. Não os experimente em registros reais.

### 3.4 fieldValues e confirmação de campos

- fieldValues foi observado como valores separados por form feed (\f).
- Em testes manuais anteriores, o valor pendente apareceu como último segmento da lista. Isso é uma observação do cenário testado, **não uma garantia universal**.
- A implementação atual percorre todos os segmentos, pois um POST pode serializar mais de um valor. Não escreva automação que assuma que o último segmento sempre corresponde ao campo esperado.
- A confirmação depende do comando correto, da requisição concluída, do valor correspondente e da sequência temporal da ação. Uma leitura de .value no DOM só prova o que o navegador está exibindo.
- Um campo pode perder o texto visual após blur e ainda assim ter sido reconhecido pelo ERP; aceite isso somente quando houver confirmação NXJ autoritativa e correspondente.
- Uma requisição HTTP 2xx isolada não basta: verifique método, endpoint, comando, valor enviado e vínculo com a etapa atual.

No userscript unificado v1.0.3, a barreira exige que título e parcela sejam reconhecidos pelo monitor NXJ antes do Find. Essa regra é específica do fluxo de segunda via; outras telas precisam definir seus próprios sinais de confirmação.

## 4. Regra operacional: um comando por vez

Não altere o foco duas vezes em sequência sem esperar o processamento NXJ anterior.

Para os fluxos investigados, o sinal de ociosidade combina:

1. Nenhuma requisição observada ao UnifyNXJ.jsp em andamento.
2. Aproximadamente 300 ms sem nova conclusão/requisição.
3. A condição esperada da interface também satisfeita (visão, foco, campo editável, registro ou estado da grade).

#progress sozinho não é suficiente: pode estar oculto, continuar no DOM após o processamento ou não aparecer em toda atualização.

Parâmetros de referência observados: monitoramento a cada 50–60 ms, silêncio de 300 ms e estabilidade de 80–180 ms conforme a etapa. O primeiro comando pode demorar mais; use timeout adequado (20 s ou maior para etapas iniciais) e não transforme esses números em constantes globais sem teste.

### 4.1 Sequência para preencher campos

1. Confirme a visão atual pelo nome exato.
2. Localize o campo por name exato; o ponto final faz parte do nome.
3. Ative o campo e aguarde o comando NXJ ser enviado e concluído.
4. Releia o elemento: o ERP pode recriá-lo durante a atualização.
5. Confirme foco, editabilidade e estado da tela. A cor laranja rgb(255, 200, 118) indicou foco na tela estudada, mas não deve ser presumida em todas.
6. Selecione/substitua o valor. A referência testou setter nativo de value com eventos input e change; o caminho de edição precisa ser verificado na tela.
7. Leia novamente o valor e monitore o próximo comando que o transporta ao ERP.
8. Aguarde ocioso e valide a confirmação autoritativa.
9. Só então passe ao campo seguinte.

A sequência mousedown → focus() → mouseup → click() reproduziu a interação esperada em uma tela específica. Teste antes de reutilizar. Releia os campos por name após cada espera, nunca confie em referências DOM antigas.

Na segunda via unificada v1.0.8, as pausas fixas são complementadas por `aguardarOcioso()` após a ativação inicial do título, após a saída do título para a parcela e após eventual refoco da parcela. A espera confirma que as requisições NXJ observadas terminaram e atingiram o período de silêncio configurado; ela não substitui a correspondência dos valores. Por compatibilidade com a sequência manual validada, a classificação literal da confirmação do título não bloqueia a escrita da parcela, mas título e parcela continuam obrigatoriamente confirmados antes do Find. Esse fluxo é específico da Consulta de títulos.

### 4.2 Monitor de rede em userscripts

- Quando necessário, instale o monitor sobre unsafeWindow.XMLHttpRequest, não sobre um XMLHttpRequest isolado no sandbox.
- Filtre estritamente o endpoint e restaure os métodos originais ao finalizar.
- Não registre URL completa, managerId, cookies, tokens, corpo integral do POST nem valores de clientes/títulos.
- Se o monitor não puder ser instalado ou não puder acompanhar loadend, interrompa a operação que depende dele.
- Não dispare POST/GET NXJ manualmente para “acelerar” a tela. O estado de sessão e os contadores pertencem à aplicação.

## 5. Estado da tela: curDataView

A variável observada é unsafeWindow.curDataView. O campo name identifica a visão atual e deve ser validado antes de qualquer ação.

Propriedades observadas como úteis na Consulta de títulos:

| Propriedade | Significado observado | Confiabilidade no cenário estudado |
| --- | --- | --- |
| name | Nome da visão atual | Sim |
| find | Modo de busca | Sim |
| recordAction | Estado como RECORDS_FOUND | Sim |
| recordCount | Quantidade de registros | Sim |
| recordNumber | Posição do registro, iniciando em 1 | Sim |
| currentRow | Linha zero-based do bloco atual | Sim na visão sondada; revalidar em outras telas |
| nrows | Quantidade de linhas do bloco | Sim na visão sondada |

Propriedades que não foram sinais confiáveis na investigação: currentRowModified, recordState (stored/modified), hasNextOrPrev, isBrowsing e findCount.

**Atenção ao erro DataView.currentRow indisponível:**

- window.DataView pode ser o construtor nativo JavaScript, não o estado do grid.
- O objeto observado para a grade é curDataView (instância de DataViewDescriptor).
- Mesmo curDataView.currentRow não deve ser presumido em toda visão/contexto. O userscript v1.0.3 exige a propriedade na visão forms.systextil.batch e interrompe o download se ela não estiver disponível.
- Não atribua um índice e depois use a leitura da mesma propriedade como única prova de seleção. Compare os campos reais do registro antes/depois e valide que a linha continua sendo a identificada.
- O uso de currentRow na visão de Processos agendados precisa de homologação em cada ambiente. Se a propriedade não existir ou não refletir a linha visual, não tente substituí-la por um índice arbitrário.

## 6. Visões e telas conhecidas

| curDataView.name | Tela/uso | Estado |
| --- | --- | --- |
| forms.crec.crec_f090 | Consulta de títulos | Sondada |
| forms.crec.crec_f095 | Tela seguinte à Consulta de títulos | Nome observado; conteúdo não explorado |
| forms.systextil.batch | Processos agendados | Nome e campos observados; seleção de linha precisa de homologação operacional |
| forms.crec.crec_e259 | Programa do relatório de boletos | Referenciado no fluxo de PDF; visão não explorada por sonda |

Não use um campo ou botão de uma tela em outra apenas porque o nome parece semelhante.

## 7. Consulta de títulos — forms.crec.crec_f090

### 7.1 Campos identificados

O ponto final faz parte do atributo name.

| Grupo | Campos observados |
| --- | --- |
| Identificação | codigo_empresa., nome_empresa., num_duplicata., seq_duplicatas., tipo_titulo., nome_tipo. |
| Situação | situacao_duplic., descrsit., posicao_duplic., descr_posicao., previsao., descr_previsao., cod_local., descr_local. |
| Cliente | nome_cliente., cli_dup_cgc_cli_r., cli_dup_cgc_cli_o., cli_dup_cgc_cli2., cli_resptit_r., cli_resptit_o., cli2resptit., descr_cliresp. |
| Endosso | cgc_endosso_r., cgc_endosso_o., cgc2_endosso., nome_endosso. |
| Datas e valores | data_emissao., data_venc_duplic., data_prorrogacao., valor_duplicata., saldo_duplicata., valor_moeda., saldo_moeda., moeda_titulo., descr_moeda., perc_desc_duplic. |
| Comissão/representante | cod_rep_cliente., nome_representante., percentual_comis., base_calc_comis., valor_comis. |
| Cobrança/banco | portador_duplic., descricao., numero_bordero., numero_remessa., nr_titulo_banco., conta_corrente., cod_carteira., cod_transacao., descr_transacao., nr_solicitacao., cobr_externa., cobr_ext_desc2. |
| Boleto | cod_barras., linha_digitavel., bolepix., duplic_emitida., duplic_impressa. |
| SCPC/renegociação | scpc_nr_remessa., scpc_situacao., ren_sit_renegocia., desc_sit_renegocia., ren_num_renegocia. |
| FIDC | numeroRemessaFIDC., situacaoFIDC., dataRemessaFIDC., numeroIdentificaoFIDC. |
| Outros | pedido_venda., cod_historico., compl_historico., num_contabil., nr_cupom., cod_forma_pagto., descr_forma_pagto., possui_adiantamento., data_corrente., hora_corrente. |
| Somente leitura na amostra | ult_ocorrencia., dt_ult_ocorrencia., tem_obs., docto_subst., saldo_moviment_perdas., saldo_duplicata_ch., cobr_ext_desc., superCountLabel. |

Atributos readonly podem variar conforme modo de busca/consulta. Verifique o estado atual do campo, não apenas o nome.

### 7.2 Chave do título e operadores de busca

- Chave completa inferida: empresa + número do título + sequência/parcela + tipo de título.
- Buscar somente por num_duplicata. pode retornar todas as parcelas do mesmo número.
- Máscaras observadas: num_duplicata. com 9 posições e seq_duplicatas. com 2. O maxLength do DOM veio nulo na sonda. O userscript unificado possui largura fallback de 8 para título e 2 para parcela; essa diferença precisa ser tratada como fallback de implementação, não como prova de máscara real.
- Operadores observados em stCurrentValidator: vírgula (,) para OU e hífen (-) para intervalo.
- Em consulta unitária, valide e rejeite , e -, a menos que o operador tenha pedido explicitamente consulta múltipla/intervalo.
- A busca em lote com vírgula foi confirmada para dois números e retornou cinco registros na amostra. Limite máximo, comportamento com número inexistente e combinações com hífen não foram testados.
- O servidor não informa necessariamente quais números solicitados não existem; compare a lista solicitada com os registros retornados.

### 7.3 Campos de título no userscript unificado

O fluxo SmartTable → Systextil usa:

- num_duplicata. — número do título.
- seq_duplicatas. — sequência/parcela.
- nome_cliente. — identificação textual do cliente para a conferência posterior.

Não converta título, parcela, CNPJ ou outros identificadores em número. Preserve como texto, inclusive zeros à esquerda. Normalize zeros somente na comparação quando a regra funcional permitir; nunca altere silenciosamente o dado transferido.

## 8. Processos agendados — forms.systextil.batch

Campos observados/citados no fluxo:

- titulo.
- DATA_EXECUCAO.
- MSG_EXCEPTION.

A amostra histórica indicou até 10 registros no bloco. O padrão de nomes repetidos com sufixos de índice veio da leitura do userscript e não foi confirmado por sonda em todas as telas. Localize a linha pelo identificador real e confira o texto completo de cada campo.

### 8.1 Identificação do processo de segunda via

No userscript unificado, o processo esperado é Emissão de boletos com registro. O fluxo associa a execução ao horário da solicitação, com tolerância de 90 segundos; uma coincidência exata no segundo prevalece, e múltiplas correspondências interrompem por ambiguidade.

A mensagem de sucesso esperada no código atual é Processo concluído com sucesso. Não deduza sucesso apenas porque a linha apareceu, porque o horário coincide ou porque uma mensagem não está vazia.

### 8.2 Comportamento integrado na main v1.0.4

| Situação | Comportamento atual |
| --- | --- |
| Mensagem explícita de sucesso | Libera a etapa seguinte, após revalidar o registro |
| Mensagem vazia | Mantém em acompanhamento |
| Mensagem intermediária/desconhecida não vazia | Mantém em acompanhamento |
| Marcador explícito de erro/cancelamento/rejeição | Classifica como falha |
| Find de atualização indisponível | Interrompe como resultado indeterminado |
| Grade atualizada | Reanalisa o mesmo processo após a atualização |
| Intervalo de atualização | 4 segundos |
| Limite total | 3 minutos |
| Repetição da emissão | Não |
| Download sem sucesso explícito | Bloqueado |

A v1.0.4 classifica como falha apenas marcadores explícitos no conjunto implementado (erro/exception, falha, cancelamento, rejeição, interrupção, invalidação, negação, não autorização ou falta de permissão). Mensagens desconhecidas não provam nem sucesso nem falha: continuam em observação até sucesso explícito, falha reconhecida ou timeout. A lista ainda precisa ser comparada com mensagens reais da instalação.

**Não tente resolver uma falha de acompanhamento repetindo a emissão.** Atualizar a consulta de Processos agendados é diferente de repetir o comando financeiro que criou o processo.
## 9. Baixa de Títulos por Seleção

As observações desta seção pertencem à tela estudada; confirme todos os campos e atalhos no ambiente de destino.

### 9.1 Parâmetros identificados

| Campo exibido | name | Uso no fluxo de referência |
| --- | --- | --- |
| Período de emissão, início/fim | per_emis_ini. / per_emis_fim. | Primeira e última data de venda da lista filtrada |
| Período de vencimento, início/fim | periodo_ini. / periodo_fim. | Início pela primeira venda; fim informado |
| Forma pagto | cod_forma_pagto. | Código da modalidade conforme ambiente |
| Histórico | historico. | Código de histórico da operação |
| Data de pagamento | data_pagamento. | Data informada |
| Data crédito | data_credito. | Mesma data de pagamento nesse fluxo |
| Contabilizar | contab_sn. | Código conforme a operação |
| Bco. receptor | receptor. | Código do banco |
| C/corrente | conta_corrente. | Identificador textual, até nove dígitos na amostra |
| Hist.com. | hist_comis. | Recebe foco após Enter em conta corrente |

Datas devem ser validadas como DD/MM/AAAA, incluindo existência do dia no calendário. Contas e códigos são texto para preservar zeros à esquerda. Códigos variam conforme ambiente: na modalidade Link, foi observado código 28 no Systextil normal e 26 no Systextil10 para o processo estudado. Não generalize esses códigos.

### 9.2 Grade e atalhos observados

| Campo | name | Uso |
| --- | --- | --- |
| Título | num_duplicata. | Identificação e foco para atalhos |
| Emissão | data_emissao. | Data por linha; após F6 recebe a data de pesquisa quando ativado |
| Valor de baixa | valor_saldo_aux. | Comparação individual |
| Caixa da linha | tit_baixar. | Estado de seleção (checked) |
| Caixa geral | box1:sel_todos. | Seleção geral dos títulos da pesquisa |
| Saldo total | total_saldo. | Saldo dos títulos retornados |
| Total selecionado | total_selecionado. | Total efetivamente selecionado |

Sequência observada:

1. Focar Título e pressionar F6.
2. Focar Emissão, selecionar todo o conteúdo e informar data.
3. Enter; aguardar o campo seguinte ficar ativo.
4. F7 no campo indicado pela sequência manual.
5. Aguardar grade/totais e conferir data e saldos.
6. F9 marca o título ativo e pode avançar para a linha seguinte; confirmar pelo total selecionado.
7. Nova pesquisa usa F6; na amostra, as seleções anteriores foram mantidas e o total passou a se referir à data pesquisada.

Atribuir .checked diretamente pode não atualizar a grade. Para seleção geral, a referência usa eventos de mouse/foco/clique e confere o total selecionado.

### 9.3 Pesquisa vazia

Após F6, a grade pode estar vazia antes de uma consulta concluída. Diferencie “a pesquisa ainda não terminou” de “pesquisa concluída sem títulos” por fim do Aguarde, mudança dos campos/totais ou mensagem explícita.

No Systextil10 foi observado um caso sem sinal claro de conclusão em que a referência esperava até 45 segundos e então inferia ausência de títulos se data e totais permanecessem vazios/zerados. Isso é **inferido**, específico do caso e inferior a uma mensagem explícita do ERP.

## 10. Estratégias de desempenho

- Agrupe registros por critério antes de consultar; evite repetir Find para dados que já pertencem ao mesmo grupo.
- Compare valores monetários em centavos inteiros, não em ponto flutuante. Valide faixa e formato antes da soma.
- Se a regra permitir seleção geral, compare total local com Saldo total e confirme pelo Total selecionado.
- Se a correspondência precisar ser exata por título, percorra a grade com identificador compartilhado; não use apenas mesma altura visual quando títulos/data/valores puderem repetir.
- Leia todas as linhas efetivamente carregadas no DOM, inclusive fora da área visível, somente se confirmar que o ERP carregou todo o bloco.
- Aguarde condições verificáveis em vez de pausas longas fixas, mas preserve timeout e silêncio de rede.
- Não otimize removendo uma confirmação necessária entre comandos NXJ.

## 11. Fluxo integrado de segunda via no repositório

### 11.1 Arquitetura da main

O userscript único atual é userscripts/systextil-segunda-via.user.js v1.0.4. O mesmo arquivo atua no SmartTable/CRM e no Systextil. As versões antigas separadas de bridge, orquestrador e helper foram aposentadas e não devem ser reativadas em conjunto.

Resumo do fluxo:

1. Clique explícito do operador em Enviar ao Systextil no SmartTable.
2. Validação da solicitação e preservação de título/parcela como texto.
3. Confirmação NXJ dos dois campos reais.
4. Find somente após confirmação dos filtros.
5. Exatamente um registro retornado; conferir título, parcela e cliente.
6. Trava contra emissão repetida e uma única ação Emite boleto.
7. Acompanhamento em Processos agendados.
8. Identificação inequívoca do processo e confirmação explícita de sucesso.
9. Validação da linha/visão e da URL/relatório PDF.
10. Obtenção do PDF autenticado, validação da origem e do conteúdo (%PDF-, %%EOF, limite de 25 MB) e download pelo Tampermonkey para a pasta padrão do navegador.

A permissão do clique no CRM autoriza somente o fluxo descrito para o título escolhido. Não reutilize essa autorização para baixa, alteração de cadastro, negociação ou outras rotinas.

### 11.2 Proteções e limites

- A trava entre abas usa armazenamento GM cooperativo; reduz disputa, mas não é transação distribuída.
- Timeout após o clique de emissão significa resultado potencialmente indeterminado. Não repetir a emissão.
- O estado posterior à emissão deve permanecer reservado até conferência.
- Resultado indeterminado de download exige conferir manualmente Downloads antes de liberar nova tentativa.
- Esc interrompe a automação local, mas não cancela comando já enviado ao ERP.
- GM_download usa a pasta padrão configurada no navegador; o userscript não escolhe um caminho absoluto do Windows.
- O fluxo requer Tampermonkey 5.4.6226 ou superior para o download Blob/File na configuração documentada.
- O PDF só pode ser baixado após sucesso explícito e validação da URL, relatório e conteúdo.

### 11.3 Barreira NXJ integrada na v1.0.3

A PR #36 integrou a correção de uma regressão em que o Find podia ser acionado sem confirmação do título. A main v1.0.4 continua exigindo confirmações NXJ dos valores esperados de título e parcela em comandos concluídos com HTTP 2xx, com normalização controlada de zeros à esquerda/prefixos explícitos. O orquestrador valida novamente a barreira antes do Find.

Se faltar a confirmação, a ação correta é parar e conferir/limpar os campos na tela. Não pressionar F7 manualmente para contornar o bloqueio: isso pode produzir consulta sem filtro.

## 12. Níveis de risco e ações autorizadas

| Nível | Classe | Exemplos | Regra |
| --- | --- | --- | --- |
| L0 | Leitura | Find, Clear To Find, Next/Previous Record | Permitidos somente no escopo de leitura autorizado |
| L1 | Navegação | Troca de formulário/visão | Validar destino e efeitos de navegação |
| L2 | Efeito no sistema | Emissão de boleto, processos com efeito externo | Ação explícita do operador e conferência antes/depois |
| L3 | Gravação/exclusão | Add Update, Delete, baixa financeira | Confirmação humana específica para cada ação |

Emissão não é uma simples consulta. Os campos duplic_emitida., duplic_impressa., numero_remessa. e bolepix. sugerem efeitos de registro/remessa, mas o efeito exato precisa ser confirmado com o responsável/ambiente antes de qualquer automação. Não crie emissão real exclusivamente para teste.

## 13. Investigação de uma tela nova

Antes de codificar, obtenha evidência da mesma tela:

1. Nome exato da visão (curDataView.name), janela/frame e formulário.
2. Sequência manual completa, com uma ação por vez.
3. HTML dos campos e atributos name, incluindo o ponto final e sufixos de grade.
4. Estado antes/depois: foco, cor, readonly, disabled, .value, .checked, linha ativa e elemento substituído.
5. Requisições disparadas por cada ação, com endpoint, método, commandName e apenas metadados/payload mascarado.
6. Sinal de término: rede ociosa + estado da interface, mudança de registro, mensagem ou valor/totais.
7. Resultado de busca sem registros, valores duplicados, timeout e navegação.
8. Diferença entre execução manual e script na mesma tela.

Sondas referenciadas na investigação: probe_page.js (estrutura), network_tap.js (requisições por ação) e cmd_probe.js (comandos NXJ e esqueleto mascarado). Instale uma sonda por vez, use marcações entre ações, recarregue a página entre sondas e revise o resultado para remover dados sensíveis antes de compartilhar.

### 13.1 Regras de ensaio

- Prefira títulos antigos/quitados e dados fictícios.
- Nunca clique em Add Update, Clear To Add ou Delete em uma sonda.
- Não execute baixa, emissão, alteração de cadastro ou envio externo apenas para teste.
- Compare manual e script, isolando uma ação por vez.
- Não copie managerId, cookies, tokens, CNPJ, nome de cliente, título, saldo ou payload completo para issue/log/documentação pública.
- Se uma hipótese não puder ser separada por evidência, marque-a como inferida e não construa ação destrutiva sobre ela.

## 14. Armadilhas recorrentes

| Sintoma | Causa/risco conhecido | Conduta |
| --- | --- | --- |
| Campo mostra valor, mas Find ignora filtro | O valor não foi enviado/confirmado em comando NXJ de saída/foco | Bloquear Find e inspecionar sequência de comandos |
| Consulta retorna todas as parcelas | Busca somente pelo número ou parcela não confirmada | Exigir chave adequada e confirmação de título/parcela |
| Campo fica vazio após blur | ERP pode limpar a representação visual após confirmação | Só aceitar vazio com confirmação NXJ correspondente |
| Campo muda/recria ao focar | Referência DOM antiga | Relocalizar pelo name após cada espera |
| Observador não identifica comando | Contexto XHR errado, evento tardio ou falha do monitor | Usar unsafeWindow; se não confirmar, falhar fechado |
| DataView.currentRow não existe | Uso do construtor nativo ou propriedade ausente na visão atual | Inspecionar curDataView e nome da visão; não adivinhar API |
| Processo aparece sem mensagem de sucesso | Mensagem pode ser intermediária ou falha | Na main v1.0.4 mensagens vazias/desconhecidas continuam em acompanhamento; marcadores explícitos são falha. Não baixar sem sucesso explícito |
| Find de atualização não existe em Processos | Não há evidência de que a grade foi atualizada | A main v1.0.4 interrompe como indeterminado; não emitir novamente |
| Timeout após emissão/download | Resultado pode ter ocorrido sem confirmação do navegador | Preservar bloqueio e conferir ERP/pasta antes de retentar |

## 15. Checklist para qualquer implementação

- [ ] Identifiquei a visão, frame, formulário e ambiente exatos.
- [ ] Reproduzi a sequência manual antes de automatizar.
- [ ] Confirmei os name reais e os campos de grade/sufixos.
- [ ] Distingui valor visual de valor confirmado pelo NXJ.
- [ ] Aguardo uma requisição por vez, silêncio de rede e condição de UI.
- [ ] Relocalizo campos após atualizações e recriação do DOM.
- [ ] Não uso #progress, currentRowModified, hasNextOrPrev, isBrowsing ou findCount sem evidência específica.
- [ ] Não uso window.DataView como substituto de curDataView.
- [ ] Não reenvio comando NXJ manualmente.
- [ ] Rejeito operadores de busca não permitidos e preservo identificadores como texto.
- [ ] Trato ambiguidade e timeout de forma segura.
- [ ] Diferencio leitura/navegação de emissão/gravação/exclusão.
- [ ] Incluí testes de regressão e informei os limites dos mocks.
- [ ] Registrei separadamente o que foi testado localmente e o que foi homologado no ERP real.
- [ ] Revisei logs, mensagens e documentação para não expor dados sensíveis.

## 16. Referências internas

- [Instruções para agentes](../AGENTS.md)
- [Guia transversal de automação Tampermonkey](guia-automacao-tampermonkey-systextil.md)
- [Segunda via automática — transferência CRM/Systextil](transferencia-crm-systextil.md)
- [Histórico técnico da segunda via](segunda-via-boleto.md)
- [Userscript unificado atual](../userscripts/systextil-segunda-via.user.js)
- [PR #36 — bloqueio do Find sem confirmação NXJ](https://github.com/IsaacTexCotton/Systextil-envio-mensagem/pull/36)
- [PR #37 — acompanhamento de mensagens intermediárias, integrada na v1.0.4](https://github.com/IsaacTexCotton/Systextil-envio-mensagem/pull/37)


## 17. Correções do userscript de segunda via na v1.0.5 — PR #39

A PR #39 integrou as alterações da v1.0.5 à `main` em 09/11/2026. O comportamento segue sujeito à homologação operacional no Systextil real.

### 17.1 Atualização de Processos agendados

- O operador informou que, na tela Processos agendados, o controle que atualiza a lista é `procAgendados` (sininho). A implementação anterior tentou usar `btnFind.`, que pertence à Consulta de títulos e não está presente na grade de processos.
- A v1.0.5 aciona `procAgendados` antes da primeira leitura da grade e novamente antes das releituras seguintes.
- Após o clique, aguarda a requisição NXJ quando ela é observável e respeita pelo menos quatro segundos para a renderização da lista. O tempo é uma tolerância implementada para o fluxo relatado, não um SLA universal do ERP.
- A ausência de confirmação de sucesso continua impedindo o download. Ambiguidade, falha explícita e timeout não disparam uma nova emissão.

### 17.2 Primeira confirmação NXJ de título e parcela

- Na implementação anterior, o marco de sequência do título era capturado depois de escrever o valor e aguardar parte da sequência de foco. Uma confirmação rápida do ERP poderia ficar fora da janela monitorada.
- Na v1.0.5, os marcos de sequência de título e parcela são capturados antes da escrita dos campos correspondentes.
- A barreira NXJ permanece obrigatória: ambos os campos precisam ser confirmados antes do Find; normalização de zeros à esquerda e prefixos continua controlada, sem aceitar correspondências parciais.

### 17.3 Evidência e validação pendente

- O identificador `procAgendados` e o comportamento de clicar novamente no sininho foram informados pelo operador da instalação.
- Os testes direcionados verificam a ordem do baseline NXJ, o seletor do sininho, o tempo mínimo de espera e o refresh antes da primeira leitura.
- Esses testes não comprovam que a tela real atualiza em todas as execuções nem que a primeira busca sempre será confirmada. Homologar com um título já previsto em operação real; não gerar uma emissão exclusivamente para teste.

## 18. Recuperação manual de estado persistido — v1.0.6 integrada pela PR #40

### 18.1 Causa do bloqueio aparente

- A integração CRM/Systextil compartilha o registro `smarttable.systextil.title-transfer.v1.execucao` pelo armazenamento GM do Tampermonkey.
- `emissao-solicitada`, `processando`, `baixando` e `indeterminado` são tratados como estados que exigem conferência e não expiram automaticamente. Isso evita permitir uma segunda emissão quando a primeira pode ter sido acionada, mas não teve resultado confirmado.
- Um registro persistido informa o último estado conhecido do userscript; não comprova, por si só, que o Systextil ainda esteja processando algo. Se a aba for fechada, perder a navegação ou falhar antes de limpar o estado, a chave pode continuar bloqueando novas transferências.

### 18.2 Recuperação proposta

- A v1.0.6 acrescenta o comando Tampermonkey **Segunda via: liberar bloqueio após conferência manual**, usando a permissão específica `GM_registerMenuCommand`.
- O comando apresenta status e horário registrados, exige confirmação explícita e relê a execução e o pedido antes da limpeza. Se os dados mudarem durante a confirmação, aborta sem apagar as chaves.
- Após a confirmação, limpa as chaves compartilhadas de execução, pedido, consumidor, trava de Processos agendados e resultado. Não clica em controles do ERP, não consulta a grade, não cancela processo e não reexecuta emissão.
- O operador deve conferir manualmente **Processos agendados** e a pasta **Downloads** antes de confirmar. A limpeza não deve ser usada como forma de contornar um resultado realmente indeterminado.

### 18.3 Limites de validação

- Testes automatizados verificam a presença do comando, a ordem da confirmação e a revalidação das chaves antes da limpeza.
- Isso não comprova a renderização do item no menu do Tampermonkey nem a leitura/escrita do armazenamento na instalação real. Validar em Chrome/Tampermonkey com estado de teste, sem criar emissão adicional.

## 19. Diagnóstico NXJ completo no retorno ao SmartTable — v1.0.7 proposta

A v1.0.6 limitava `criarResultado().mensagem` a 300 caracteres. O resumo produzido pelo monitor NXJ pode conter vários comandos e seus metadados; quando excedia esse limite, a mensagem apresentada ao operador era cortada no meio do texto (por exemplo, em `CLIC`).

A v1.0.7 centraliza esse limite em `limitarMensagemResultado()` e amplia a capacidade para 1.200 caracteres. O resumo permanece mascarado: apresenta nomes de comandos e comprimentos dos segmentos, nunca os valores dos campos ou o payload integral.

O teste de regressão verifica que uma mensagem maior que 300 caracteres conserva o comando final, que mensagens acima de 1.200 caracteres são limitadas e que valores nulos viram string vazia.

**A barreira NXJ não foi enfraquecida:** ambos os campos continuam exigindo confirmação por comando de confirmação reconhecido, requisição concluída e HTTP 2xx. A mudança resolve a observabilidade do erro, não a confirmação em si. Se o título continuar sem confirmação após a atualização, o próximo diagnóstico deverá ser lido por inteiro antes de qualquer ajuste no protocolo.
