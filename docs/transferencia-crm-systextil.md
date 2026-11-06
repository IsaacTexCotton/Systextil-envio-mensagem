# Segunda via automática — SmartTable → Systextil

**Userscript único:** `userscripts/systextil-segunda-via.user.js`  
**Versão:** 1.0.0  
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
5. A rotina mantém a sequência de foco, edição, eventos `input/change` e confirmação dos comandos NXJ observada no procedimento funcional. Se o ERP não confirmar exatamente título e parcela, interrompe sem executar Find.
6. Executa **Find** e espera o Systextil concluir a consulta. Exige exatamente um registro e confere novamente título, parcela e cliente. A parcela é comparada literalmente; apenas zeros à esquerda no título são tolerados na comparação.
7. Registra a proteção contra repetição e aciona **Emite boleto** uma única vez.
8. Aciona `procAgendados`. Se o ERP mudar a visão na mesma aba, o userscript acompanha a transição; se abrir outra aba, a aba que receber a visão de processos recupera o estado compartilhado pelo Tampermonkey.
9. Atualiza a grade automaticamente, procura o processo de emissão pela descrição e pelo horário da solicitação e só continua quando existe uma correspondência única com mensagem de sucesso.
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
- Título e parcela precisam ser confirmados pelos comandos NXJ antes do Find.
- O Find precisa retornar uma única correspondência; título, parcela e cliente são conferidos antes da emissão.
- A emissão recebe uma trava de cinco minutos por título/parcela. Se houver timeout depois do clique, o script não clica novamente: o resultado é tratado como incerto.
- O processo precisa ser identificado sem ambiguidade e informar conclusão com sucesso. Linhas ambíguas, horários ilegíveis ou mensagens de falha bloqueiam o download.
- O PDF só é baixado após revalidar o processo, a seleção da grade e a URL/relatório.
- Existe reserva contra download duplicado. Se o navegador não confirmar se o download terminou, a reserva fica indeterminada; confira manualmente a pasta Downloads antes de tentar novamente.
- `Esc` interrompe a automação local. Não cancela uma emissão já enviada ao ERP.
- O script não simula F7 e não submete o formulário por teclado; utiliza os controles identificados do ERP.

Se a tela não for **Consulta de títulos** quando a solicitação chegar, o userscript informa a falha ao CRM e não emite. Abra a tela correta e envie o título novamente. Não repita uma solicitação quando o resultado da emissão ou do download estiver indeterminado sem antes conferir Processos agendados e a pasta Downloads.

## Testes e homologação

O arquivo `tests/segunda-via-integrada.test.js` cobre contrato de transferência, validação de pedido, preservação de zeros, identificação única de processo, validação de URL/PDF e ausência de painéis/serviço Windows. As suítes existentes continuam cobrindo a sequência NXJ e os contratos legados.

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
