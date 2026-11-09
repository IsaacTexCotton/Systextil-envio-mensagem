# Prorrogação de títulos — evidências e operação

**Userscript:** \`userscripts/systextil-prorrogacao-titulos.user.js\`  
**Versão:** 0.1.5  
**Branch de implementação:** \`feat/prorrogacao-titulos\`  
**Base técnica:** sonda somente leitura 0.1.2, captura de 09/11/2026 entre 19:03:52 e 19:04:39 UTC.

## 1. Objetivo

Processar uma lista de títulos/parcelas em sequência, preenchendo:

- \`Compl.hist\` na visão \`forms.crec.crec_f030\`;
- \`data_prorrogacao.N\` na linha da parcela;
- \`nr_mtv_prorrogacao.N\` com o código fixo \`01\`, na visão \`forms.crec.crec_f035\`.

Cada item só é considerado concluído depois de retornar à Consulta, refazer o Find e conferir a data e o complemento do histórico lidos no formulário.

A funcionalidade é um userscript independente. Não altera o userscript de segunda via, a ponte SmartTable ou a sonda diagnóstica.

## 2. Evidências observadas

A sonda 0.1.2 registrou 22 eventos, sem comandos de gravação e sem alterações de campos. A captura confirmou:

| Tela | \`curDataView.name\` | Campos/controles relevantes |
|---|---|---|
| Consulta de títulos | \`forms.crec.crec_f090\` | \`num_duplicata.\`, \`seq_duplicatas.\`, \`data_prorrogacao.\`, \`compl_historico.\` |
| Manutenção de títulos a receber | \`forms.crec.crec_f030\` | \`num_duplicata.\`, \`seq_duplicatas.\`, \`compl_historico.\` |
| Manutenção de títulos | \`forms.crec.crec_f035\` | \`seq_duplicatas.N\`, \`data_prorrogacao.N\`, \`nr_mtv_prorrogacao.N\` |

### Navegação confirmada

| Origem | Ação manual observada | Comando NXJ | Destino |
|---|---|---|---|
| \`crec_f090\` | Clique em \`cmdBtnTitulos\` | \`cmdBtnTitulos\` | \`crec_f030\` |
| \`crec_f030\` | F2 | \`cmdNextForm\` | \`crec_f035\` |
| \`crec_f035\` | F1 | \`PREVIOUS_FORM\` | \`crec_f030\` |
| \`crec_f030\` | F1 | \`PREVIOUS_FORM\` | \`crec_f090\` |

Os quatro comandos tiveram resposta HTTP 200 na captura. Os atalhos F1/F2 foram observados sem Alt, Ctrl, Shift ou Meta.

### Campos e limites observados

- \`forms.crec.crec_f030\`: \`compl_historico.\` editável, \`maxLength = 60\`.
- \`forms.crec.crec_f035\`: grade com até dez posições observadas. O índice da parcela fica no nome do campo, por exemplo \`seq_duplicatas.0\`; os campos editáveis correspondentes são \`data_prorrogacao.0\` e \`nr_mtv_prorrogacao.0\`.
- As posições superiores a 2 estavam desabilitadas no snapshot observado. A implementação verifica \`disabled\` e \`readOnly\` no momento da execução.
- O campo sem sufixo \`seq_duplicatas.\` também aparece em \`crec_f035\`; a seleção usa somente os campos com sufixo numérico e compara o valor da parcela. Não usa \`currentRow\` nem presume que a parcela esteja na primeira linha.

### Gravação manual observada

- F9 em \`crec_f030\` enviou \`ADD_UPDATE\`, HTTP 200, e a visão passou a \`recordAction = UPDATED\`.
- F9 em \`crec_f035\` enviou \`ADD_UPDATE\`, HTTP 200, e a visão passou a \`recordAction = UPDATED\`.
- A evidência de F9 repetido em \`crec_f030\` mostra por que a automação envia exatamente um F9 por tela e não tenta repetir quando o resultado é ambíguo.
- A captura não exportou valores de campos ou conteúdos de registros. Portanto, não prova por si só quais valores foram persistidos nem substitui releitura.

## 3. Formato de Compl.hist

O texto é montado nesta ordem:

\`DD/MM/AAAA - [MOTIVO] - PRORROG - [AUT SIGLA] - [EXECUTOR]\`

Motivo e autorização são opcionais. A sigla do executor é obrigatória e configurável; não existe sigla fixa no código. O código do motivo da prorrogação na grade é sempre \`01\`.

Exemplos:

- \`09/11/2026 - PRORROG - IT\`
- \`09/11/2026 - PEDIDO CLIENTE - PRORROG - AUT GISELA - IT\`

O limite é de 60 caracteres. O script rejeita o texto que exceder esse tamanho; não trunca e não substitui silenciosamente o histórico.

## 4. Entrada do lote

Uma linha por título/parcela:

\`\`\`text
00012345;03
00012346;01;15/11/2026
\`\`\`

A primeira linha usa a data comum informada no painel. A segunda usa a data individual, que prevalece sobre a data comum. A data individual deve estar no formato \`DD/MM/AAAA\`.

No painel, informe também o motivo (opcional), a sigla de autorização (opcional) e a sigla do executor (obrigatória). Clique em **Validar lote**, revise os itens e marque a confirmação antes de **Iniciar lote**.

O script permite títulos vencidos: não aplica bloqueio por atraso.

## 5. Fluxo implementado

Para cada título/parcela:

1. Exige a visão Consulta e prepara o modo Find com o controle \`btnClearToFind.\`.
2. Preenche título e parcela nos campos reais, usando o setter nativo e eventos \`input\`/\`change\`.
3. Aguarda confirmação NXJ de cada identificador, executa Find uma vez e exige um único registro correspondente.
4. Abre \`crec_f030\` por \`cmdBtnTitulos\`, confere título e parcela, substitui \`compl_historico.\` e executa um único F9.
5. Exige POST \`ADD_UPDATE\` HTTP 2xx, payload contendo o texto esperado e \`recordAction = UPDATED\`.
6. Entra em \`crec_f035\` por F2, procura a parcela por seu valor nos campos \`seq_duplicatas.N\`, exige uma única correspondência e preenche data e código \`01\`.
7. Executa um único F9 e exige a mesma confirmação do comando, payload e estado \`UPDATED\`.
8. Retorna à Consulta por F1 duas vezes, refaz a consulta e confere \`data_prorrogacao.\` e \`compl_historico.\`.
9. Só então inicia o próximo item.

A sequência é serial. Não há paralelismo entre títulos.

## 6. Segurança operacional e falhas

- A gravação do histórico e a gravação da prorrogação são dois salvamentos independentes. Não existe transação única nem rollback automático.
- Se a primeira gravação for confirmada e a segunda falhar, o item fica parcial e o lote é interrompido.
- Se o comando F9 for disparado e a confirmação ficar ausente, o estado é tratado como indeterminado. Não pressione F9 novamente nem inicie nova tentativa antes de conferir o título no ERP.
- Se a parcela não existir, aparecer duplicada, estiver desabilitada ou não tiver os campos correspondentes, o item é bloqueado.
- Se o Find não retornar exatamente um registro, o item é bloqueado.
- Se a releitura não confirmar a data e o histórico, o lote é interrompido.
- Não há tentativa automática de desfazer uma alteração já gravada.
- O monitor registra somente metadados necessários ao fluxo e os segmentos NXJ em memória para conferir os valores; não grava payload, dados de cliente, cookies ou tokens em armazenamento ou console.

## 7. Pendências de homologação

A sonda comprovou as teclas e os comandos quando acionados manualmente. A implementação dispara F1, F2 e F9 por eventos \`KeyboardEvent\` sintéticos e exige a resposta NXJ correspondente. **A aceitação desses eventos sintéticos pelo handler legado do Systextil ainda precisa ser homologada no navegador real.** Se a aplicação rejeitar eventos sintéticos, o monitor deve interromper o fluxo; não há fallback que envie comandos NXJ manualmente.

Também dependem de homologação:

1. confirmar que a edição direta dos campos da grade, seguida de mudança de foco, envia os valores pelo NXJ no ambiente de produção;
2. confirmar que \`data_prorrogacao.\` e \`compl_historico.\` na releitura de \`crec_f090\` refletem os valores persistidos para a parcela pesquisada;
3. executar primeiro um único título/parcela de teste autorizado e conferir manualmente os dois campos no ERP;
4. testar depois um lote com duas parcelas, somente após a primeira execução estar confirmada.

Não use títulos reais sem autorização do responsável pelo processo. O resultado dos testes automatizados não comprova a gravação operacional no Systextil.

## 8. Verificação local

Na raiz do repositório, com Node.js 18 ou superior:

\`\`\`powershell
npm run verify
\`\`\`

O comando verifica a sintaxe de todos os userscripts e executa a suíte completa com o runner nativo do Node.js. O repositório não deve receber CI/CD ou GitHub Actions para esta alteração.


## 9. Correção de compatibilidade do atributo maxlength — v0.1.1

O navegador pode retornar \`HTMLInputElement.maxLength = -1\` quando o atributo HTML \`maxlength\` não está declarado no elemento. A versão 0.1.0 interpretava esse valor como uma largura negativa e rejeitava qualquer título.

A v0.1.1 usa os limites já observados pela sonda nas telas investigadas quando o navegador retorna valor negativo ou não numérico:

- \`num_duplicata.\`: 9 caracteres;
- \`seq_duplicatas.\`: 2 caracteres.

Quando a tela declara um limite não negativo, esse limite declarado continua prevalecendo. Nenhum dígito é truncado ou removido.

A mensagem de interrupção também foi ajustada: se o erro ocorrer antes de qualquer F9 do item, o painel informa que nenhuma gravação foi iniciada. A orientação para não repetir F9 fica reservada aos casos parciais ou indeterminados.


## 10. Localização de controles e monitoramento por frames — v0.1.2

O botão Find não estava sendo encontrado quando seu elemento estava em um documento de frame, pois a primeira implementação consultava exclusivamente o documento raiz.

A v0.1.2 percorre a janela principal e os frames same-origin acessíveis para localizar \`btnClearToFind.\`, \`btnFind.\` e os controles de navegação. A localização exige exatamente um elemento correspondente; ausência ou duplicidade interrompe a execução.

O monitor NXJ também é instalado nos protótipos \`XMLHttpRequest\` de cada contexto same-origin acessível. Assim, comandos iniciados por um frame continuam observáveis. Os protótipos originais são restaurados ao encerrar a execução; em falha parcial na instalação, o script tenta restaurar os hooks já instalados antes de interromper.

Os testes simulam o botão em um segundo documento e comandos NXJ originados tanto na janela principal quanto em um frame. Isso valida a lógica de busca e instrumentação em ambientes simulados, mas não substitui o teste no navegador/ERP real.

## 11. Data atual do Compl.hist e entradas NXJ repetidas — v0.1.3

A data de `Compl.hist` é a data local atual do navegador no momento da validação do lote. A data informada na linha ou no campo comum continua sendo exclusivamente a data de prorrogação da parcela. Se a data local mudar entre a validação e o início, a prévia é recalculada e a confirmação anterior é invalidada.

O monitor NXJ passou a ler todas as ocorrências de `fieldValues` por `getAll()`, tanto em `URLSearchParams` quanto em `FormData`. A versão anterior lia somente a primeira ocorrência. Quando o NXJ distribuía os campos em entradas repetidas, essa leitura parcial podia produzir uma divergência artificial no verificador do payload.

A proteção contra repetição permanece: cada tela recebe no máximo um F9 por tentativa. O monitor lê todas as ocorrências repetidas de `fieldValues` no payload `ADD_UPDATE`. A confirmação de cada valor também pode vir do comando `CLICKONFIELD` ou `NEXT_FIELD` emitido ao sair do campo, desde que a requisição tenha sido concluída com HTTP 2xx e contenha exatamente o valor esperado. Isso evita exigir que o `ADD_UPDATE` repita um valor que o NXJ já transportou no comando de saída do campo. O estado `UPDATED` continua obrigatório e a confirmação definitiva do item continua sendo a releitura dos campos na Consulta. Um retorno indeterminado continua exigindo conferência manual e nunca dispara novo F9 automaticamente.


## 12. Confirmação do campo antes do F9 — v0.1.4

A versão 0.1.3 ainda exigia que cada valor alterado aparecesse novamente no payload do comando `ADD_UPDATE`. Isso gerava falso negativo quando o NXJ já havia transportado e confirmado o conteúdo no comando de saída do campo, mas não repetia esse valor no payload de gravação.

A v0.1.4 preserva duas evidências independentes:

1. Antes do F9, o comando `CLICKONFIELD` ou `NEXT_FIELD` precisa concluir com HTTP 2xx e conter o valor exato do campo alterado. A confirmação é guardada em memória e vinculada ao valor que estava sendo editado.
2. Depois, o F9 é enviado uma única vez. O monitor exige um único `ADD_UPDATE` concluído com HTTP 2xx e a tela precisa entrar em `recordAction = UPDATED`.

Para cada valor esperado, basta que ele esteja no payload do `ADD_UPDATE` ou na confirmação NXJ válida de saída daquele próprio campo. A leitura visual do input, isoladamente, não é aceita. A releitura final na Consulta continua obrigatória para confirmar a persistência da data e do `Compl.hist`.

Se nenhuma dessas fontes confirmar o valor, a automação interrompe o lote como indeterminado e não repete F9. Nenhuma validação foi removida: a alteração corrige somente a exigência duplicada de que o mesmo valor precise aparecer nos dois comandos.


## 13. Saída do campo por Tab e diagnóstico sem valores — v0.1.5

A v0.1.4 ainda utilizava somente `focus()` no próximo controle para provocar a saída do campo. Essa ação visual não garante que o handler NXJ tenha recebido a tecla Tab nem que o valor pendente tenha sido transportado.

A v0.1.5 envia `keydown` de Tab ao campo editado e, depois, ativa o próximo controle caso o próprio evento não tenha movido o foco. A automação continua aguardando a confirmação por `CLICKONFIELD` ou `NEXT_FIELD`, com HTTP 2xx e correspondência do valor esperado. A etapa seguinte e o F9 não são executados quando a confirmação não chega.

Se a confirmação continuar ausente, a mensagem apresenta um resumo técnico dos POSTs NXJ observados desde o início da edição: nome do comando, quantidade/tamanho dos segmentos, status HTTP e indicação de correspondência com o valor esperado. O resumo não imprime o conteúdo do histórico, identificadores de sessão, URL completa ou outros valores de negócio.

A tecla Tab sintética ainda depende de homologação no handler legado do Systextil real. O teste automatizado comprova o mapeamento e o formato do diagnóstico; não comprova que o ERP aceite o evento sintético.
