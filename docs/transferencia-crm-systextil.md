# Segunda via automática — SmartTable → Systextil

**Userscript único:** `userscripts/systextil-segunda-via.user.js`  
**Versão:** 1.0.5  
**Status:** implementação em branch de revisão; a homologação operacional ainda está pendente.

## Objetivo e autorização

O operador seleciona um título no cadastro do cliente do SmartTable e clica em **Enviar ao Systextil**. Esse clique é a única autorização humana para iniciar a consulta e a emissão daquele título.

Depois da autorização, o mesmo userscript conduz todo o processo no Systextil. Não abre painéis flutuantes, não cria campos auxiliares de título/parcela e não solicita F7 manual.

## Instalação

1. No Tampermonkey, instale somente `userscripts/systextil-segunda-via.user.js`.
2. Mantenha o userscript habilitado nos dois domínios: CRM (`texhub.texcotton.com.br/crm/*`) e Systextil (`systextil.texcotton.com.br/systextil/*`).
3. Aceite as permissões `GM_getValue`, `GM_setValue`, `GM_addValueChangeListener`, `GM_xmlhttpRequest` e `GM_download` solicitadas pelo Tampermonkey.
4. Confirme que o Chrome permite downloads automáticos para a pasta padrão. Para não abrir o diálogo de destino a cada PDF, desative **Perguntar onde salvar cada arquivo** nas configurações de Downloads do Chrome.
5. Desative ou remova as antigas entradas `systextil-crm-bridge.user.js`, `systextil-segunda-via-automatica.user.js` e `systextil-segunda-via-boleto.user.js`. Elas foram aposentadas e não devem ser usadas em conjunto com o novo arquivo.

O SmartTable continua responsável por apresentar os títulos elegíveis e emitir o evento de transferência. A ponte, a lógica de orquestração, o preenchimento NXJ e as rotinas de processo/download agora estão no mesmo userscript.

## Fluxo automático

1. Abra o cadastro do cliente no SmartTable.
2. Clique em **Enviar título ao Systextil**, selecione o título e confirme em **Enviar ao Systextil**.
3. O userscript valida o contrato da transferência, preservando o título e a parcela como texto e os zeros à esquerda.
4. No Systextil, aguarda a tela **Consulta de títulos** e preenche diretamente os campos reais `num_duplicata.` e `seq_duplicatas.`.
5. A rotina mantém a sequência de foco, edição e eventos `input/change`. O monitor NXJ precisa confirmar, em comandos concluídos com HTTP 2xx, o valor do título e da parcela. Diferenças de zeros à esquerda e prefixos explícitos são normalizadas sem aceitar substrings.
6. Somente depois das duas confirmações NXJ o userscript aciona o controle **Find**. Se qualquer confirmação faltar, a automação para e não consulta nem emite. Exige exatamente um registro e confere título, parcela e cliente. A comparação tolera zeros à esquerda apenas durante a conferência; os identificadores originais continuam armazenados como texto.
7. Registra a proteção contra repetição e aciona **Emite boleto** uma única vez.
8. Aciona `procAgendados`. Se o ERP mudar a visão na mesma aba, o userscript acompanha a transição; se abrir outra aba, a aba que receber a visão de processos recupera o estado compartilhado pelo Tampermonkey.
9. Aciona novamente o sininho procAgendados para atualizar a grade, aguarda a renderização do ERP e então procura o processo pela descrição e pelo horário. Mensagens intermediárias ou desconhecidas mantêm o acompanhamento; só prossegue com uma correspondência única e confirmação explícita de sucesso.
10. Seleciona a linha identificada, revalida os dados da grade e confere a URL e o relatório PDF fornecidos pelo próprio Systextil.
11. Obtém o PDF autenticado, confere origem, caminho, relatório, assinatura `%PDF-`, marcador `%%EOF` e limite de tamanho. Só então envia o Blob validado ao download do Tampermonkey.
12. O navegador salva o arquivo na pasta padrão de Downloads, usando nome baseado na razão social, título e parcela. Em caso de nome já existente, o Tampermonkey usa um nome alternativo em vez de sobrescrever.

## Download sem auxiliar Windows

A versão 1.0.0 não usa mais:

- Windows PowerShell ou serviço local;
- listener em `127.0.0.1:17834`;
- chave/tokens de pareamento;
- pasta especial configurada pelo auxiliar;
- upload do PDF para um endpoint local.

O userscript declara `GM_xmlhttpRequest` apenas para obter o PDF do domínio do Systextil, com a sessão autenticada. Após validar a resposta binária, usa `GM_download` com `saveAs: false` e `conflictAction: "uniquify"`. O destino efetivo é a pasta Downloads configurada no navegador.

O download de Blob/File exige Tampermonkey 5.4.6226 ou superior. No modo Browser API do Tampermonkey, conceda a permissão de Downloads e autorize a extensão `.pdf` na lista de extensões permitidas; nesse modo, `saveAs: false` usa o destino padrão e `conflictAction: "uniquify"` evita sobrescrita. Uma política corporativa pode bloquear downloads automáticos ou solicitar confirmação; o script informa a falha e não deve ser considerado homologado até esse comportamento ser verificado na estação de trabalho.

## Dados transferidos

A solicitação inclui identificador, data/hora, CNPJ de referência, razão social, título, parcela/sequência, vencimento, saldo, dias de atraso, situação e fluxo.

Título e parcela permanecem como strings. O script não converte identificadores em números nem completa/trunca códigos silenciosamente. O campo real do ERP é conferido antes e depois do Find.

Os dados de referência do CRM são usados para conduzir a operação e nomear o arquivo. O script não grava observação, contato, negociação ou outros dados comerciais no CRM.

## Salvaguardas e comportamento em falhas

- O clique em **Enviar ao Systextil** é a autorização explícita; nenhuma emissão é iniciada sem ele.
- Uma solicitação pendente é consumida por uma única aba com trava cooperativa no armazenamento GM. A trava reduz concorrência, mas não é uma transação distribuída.
- O monitor NXJ precisa reconhecer os valores exatos do título e da parcela nos comandos de confirmação concluídos com HTTP 2xx. O título visualmente vazio só é tolerado quando o NXJ confirmou seu valor; sem confirmação, o Find é bloqueado.
- O Find só é acionado após confirmação NXJ de título e parcela, precisa retornar uma única correspondência e tem título, parcela e cliente conferidos antes da emissão.
- A emissão recebe uma trava de cinco minutos por título/parcela. Se houver timeout depois do clique, o script não clica novamente: o resultado é tratado como incerto.
- Somente o estado `preenchendo`, anterior ao acionamento da emissão, expira após 30 minutos. Estados `emissao-solicitada`, `processando`, `baixando` e `indeterminado` permanecem bloqueados até recuperação/conferência.
- O processo precisa ser identificado sem ambiguidade e informar conclusão com sucesso. A atualização é feita pelo sininho procAgendados, não pelo Find da grade, e a primeira leitura só ocorre depois do refresh e da espera de renderização. Mensagens intermediárias ou desconhecidas mantêm o acompanhamento ativo e provocam nova atualização. Marcadores explícitos de falha interrompem o fluxo. O limite de espera gera estado indeterminado, sem repetir a emissão. O download continua bloqueado até a confirmação explícita de sucesso.
- As referências de sequência NXJ do título e da parcela são capturadas antes da escrita dos respectivos campos. Isso evita descartar uma confirmação enviada pelo ERP imediatamente após input/change, antes do blur.
- O PDF só é baixado após revalidar o processo, a seleção da grade e a URL/relatório.
- Existe reserva contra download duplicado. Se o navegador não confirmar se o download terminou, a reserva fica indeterminada; confira manualmente a pasta Downloads antes de tentar novamente.
- `Esc` interrompe a automação local. Não cancela uma emissão já enviada ao ERP.
- O script clica no controle **Find** (`btnFind.`) da barra de consulta e aguarda a confirmação da requisição e do resultado do ERP. Não simula eventos de teclado F7 nem usa `.submit()`.

Se a tela não for **Consulta de títulos** quando a solicitação chegar, o userscript informa a falha ao CRM e não emite. Abra a tela correta e envie o título novamente. Não repita uma solicitação quando o resultado da emissão ou do download estiver indeterminado sem antes conferir Processos agendados e a pasta Downloads.

## Testes e homologação

O arquivo `tests/segunda-via-integrada.test.js` cobre contrato de transferência, comparação tolerante do payload NXJ, bloqueio quando título/parcela não são confirmados pelo NXJ, ordem da barreira em relação ao Find, expiração exclusiva de preenchimentos abandonados, identificação única de processo, estados intermediários, falhas explícitas, ambiguidade e validação de URL/PDF. As suítes existentes continuam cobrindo a sequência NXJ e os contratos legados.

Com Node.js 18 ou superior, execute na raiz:

```powershell
npm run verify
```

A execução dos testes não comprova a integração operacional. Antes de integrar a `main`, homologar no Chrome/Tampermonkey e Systextil reais, aproveitando um título que já esteja previsto em uma operação real; não gerar uma emissão extra apenas para testar.

A homologação precisa confirmar:

1. A transferência do SmartTable para a aba Systextil.
2. O preenchimento NXJ nos campos reais e a confirmação de título/parcela.
3. O Find, a identificação do único registro e a emissão.
4. A navegação para Processos agendados, tanto na mesma aba quanto em nova aba.
5. A identificação do processo correto e a confirmação de sucesso.
6. O download validado do PDF para a pasta Downloads sem janela de destino, incluindo o comportamento de nome duplicado.
7. O retorno do resultado ao SmartTable e o bloqueio seguro em timeout/falha.

**Não integrar nem distribuir a versão 1.0.0 antes de concluir a revisão e a homologação operacional.**


## Correção do acompanhamento de Processos agendados (v1.0.4)

A rotina anterior classificava qualquer mensagem diferente da confirmação literal de sucesso como falha. Isso encerrava o acompanhamento antes da próxima atualização da grade, mesmo quando o texto retornado pelo ERP era apenas um estado intermediário ou não reconhecido.

Na versão 1.0.4, somente marcadores explícitos de erro são classificados como falha. Mensagens vazias, intermediárias ou desconhecidas permanecem em acompanhamento: o userscript atualiza a grade e reanalisa o mesmo processo em intervalos de quatro segundos, por até três minutos. Se o controle Find não estiver disponível, ou o limite de espera terminar sem confirmação, o estado fica indeterminado e exige conferência manual. Nenhuma nova emissão é disparada. O PDF continua condicionado à confirmação literal de sucesso e à validação posterior do registro/relatório.

A suíte automatizada inclui regressões para mensagem intermediária não vazia, falha explícita e disponibilidade do controle de atualização. A homologação no Systextil real continua necessária para confirmar os textos efetivamente retornados e a atualização da grade na estação operacional.

## Correção do refresh e da primeira confirmação NXJ (v1.0.5)

A atualização da tela Processos agendados usa o controle procAgendados (sininho). O userscript o aciona, aguarda a requisição NXJ quando observável e respeita ao menos quatro segundos para a renderização da grade. A primeira leitura da lista também ocorre somente depois dessa atualização inicial. O Find (btnFind.) não é usado para atualizar essa tela.

Na Consulta de títulos, o limite de sequência do monitor NXJ passa a ser capturado antes da escrita de cada campo. A implementação anterior capturava o limite do título depois de escrever e aguardar 500 ms, podendo excluir uma confirmação já enviada nesse intervalo. A nova ordem permite reconhecer confirmações disparadas por input/change ou pelo blur, sem relaxar a comparação do valor nem permitir Find sem título e parcela confirmados.

A validação operacional ainda precisa confirmar no ERP real a atualização pelo sininho e o primeiro preenchimento em uma operação real já prevista.