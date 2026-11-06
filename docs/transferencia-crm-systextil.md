# Ponte SmartTable → Systextil

**Userscript:** `userscripts/systextil-crm-bridge.user.js`  
**Versão da ponte:** 0.2.0  
**Orquestrador:** `userscripts/systextil-segunda-via-automatica.user.js` v0.2.0  
**Helper-base:** `userscripts/systextil-segunda-via-boleto.user.js` v0.6.1  
**Status desta branch:** implementação proposta em `feat/segunda-via-automatica-crm`. Não integrada à `main`. Os testes automatizados desta alteração e a homologação operacional no Chrome/Tampermonkey com CRM e Systextil reais ainda precisam ser executados.

## Objetivo

Transferir um título selecionado na tela do cliente do SmartTable para os campos auxiliares do painel de segunda via do Systextil. O operador escolhe um título por vez.

A ponte transporta os dados e emite um evento local somente depois de confirmar que os dois campos auxiliares foram preenchidos. O orquestrador consome esse evento e conduz as etapas seguintes.

## Dependências e instalação

1. No SmartTable, o Módulo 39 e o wrapper v1.123.0 já estão integrados à `main` privada. A instalação padrão usa o espelho público `IsaacTexCotton/SmartTable-publico`; confirme que o commit validado foi publicado nele pelo workflow **Espelho público** antes de habilitar a funcionalidade para uso operacional.
2. Instale o userscript `userscripts/systextil-crm-bridge.user.js` no Tampermonkey. O mesmo userscript precisa estar habilitado nas páginas do CRM e do Systextil, pois o armazenamento GM é compartilhado entre as abas da mesma instalação do script.
3. Mantenha instalado o userscript existente `userscripts/systextil-segunda-via-boleto.user.js`.
4. Mantenha uma única aba Systextil ativa durante a transferência. A trava entre abas é cooperativa e reduz disputas, mas não oferece exclusão mútua transacional.
5. No Systextil, abra a tela Consulta de títulos e ative o painel de segunda via pelo menu do Tampermonkey/atalho já oferecido pelo automatizador (`Ctrl+Alt+B`, depois da primeira ativação contextual).

Não é necessário configurar chave de serviço, servidor externo, endpoint HTTP, extensão adicional ou pasta de destino para a transferência dos campos.

## Fluxo automatizado

1. Abra o cadastro da empresa no CRM.
2. Clique em **Enviar título ao Systextil**.
3. O SmartTable apresenta os títulos elegíveis; escolha um título e clique em **Enviar ao Systextil**. Esse clique explícito é a autorização para iniciar uma consulta/emissão daquele título.
4. A ponte envia a solicitação pelo armazenamento compartilhado do Tampermonkey. No Systextil, o helper-base e o orquestrador iniciam automaticamente quando a tela suportada termina de carregar.
5. A ponte preenche os campos auxiliares e confirma por leitura que o título e a parcela correspondem ao pedido. Somente então publica o evento local `smarttable:systextil:pedido-aplicado`.
6. O orquestrador confere novamente o identificador do pedido, a referência visual e os valores reais dos campos auxiliares. Em seguida, aciona **Preencher campos no Systextil**, que executa a sequência validada de foco e exige confirmação NXJ exata para título e parcela.
7. Antes de clicar em **Find**, o orquestrador relê o formulário do ERP. Parcela vazia ou divergente bloqueia a consulta. Após o Find, verifica novamente título, parcela, cliente e quantidade de registros; somente uma correspondência única e exata pode avançar.
8. O orquestrador registra a proteção contra repetição e aciona **Emite boleto** uma única vez. Se o registro do horário de emissão não puder ser confirmado, não tenta emitir novamente.
9. Após a emissão, aciona o botão de navegação observado `procAgendados`. O orquestrador acompanha a abertura da visão `forms.systextil.batch`. Se o ERP abrir outra aba, o userscript da nova aba recupera a solicitação da sessão de origem; não é feita uma nova emissão.
10. Em Processos agendados, o helper-base analisa a grade e exige uma correspondência única pelo tipo de processo e horário. O orquestrador aguarda até três minutos, atualizando a grade a cada tentativa, e só continua com sucesso explicitamente confirmado.
11. O helper-base seleciona o registro correspondente, verifica a integridade dos dados, prepara a URL autenticada do PDF e encaminha o arquivo ao auxiliar local. A conclusão só é exibida quando o auxiliar confirma a gravação.

A automação não simula a tecla F7 nem submete o formulário. Ela usa o comando **Find** observado na barra do Systextil e os controles identificados do próprio ERP. A emissão, porém, é uma ação de negócio automatizada: é iniciada pelo clique explícito do usuário em **Enviar ao Systextil** no CRM e só ocorre após as validações acima.

## Dados transferidos

O pedido contém:
- identificador e versão do contrato;
- data/hora da solicitação;
- CNPJ completo da empresa de origem;
- razão social;
- número do título e parcela/sequência;
- vencimento, saldo, dias de atraso, situação e fluxo como referências.

O título e a parcela são mantidos como texto, preservando zeros à esquerda. Não são convertidos para números nem truncados. O destino valida novamente o formato e o comprimento efetivo dos campos auxiliares.

Para grupo econômico, o SmartTable consulta os dados pelo leitor já existente e mantém o CNPJ individual de cada razão social. Se a leitura do grupo estiver incompleta, a transferência inteira é bloqueada.

## Limites de segurança

- A transferência não executa F7.
- Não aciona Emite boleto.
- Não seleciona processo de emissão.
- Não baixa nem salva PDF.
- Não grava observação, contato, negociação ou qualquer dado no CRM.
- Não escreve diretamente nos campos do formulário NXJ do ERP. Preenche somente os dois campos auxiliares do painel de segunda via.
- Não envia dados a serviços externos; o transporte usa o armazenamento GM do próprio Tampermonkey.
- A solicitação expira após cinco minutos.
- Só uma solicitação pode ficar pendente por vez.
- Uma trava cooperativa reduz a chance de duas abas do Systextil consumirem o mesmo pedido. A trava é best effort, não uma transação atômica garantida.
- A razão social e o CNPJ são referências para conferência humana. A ponte não prova automaticamente que o cadastro retornado pelo ERP pertence à empresa do CRM.
- Se o título ou a parcela excederem o tamanho do campo auxiliar no Systextil, a ponte interrompe a inserção sem truncar o valor.

## Falhas e recuperação

Se a ponte não responder no CRM:
- confirme que o userscript de transferência está habilitado nos dois domínios;
- confira se a página do Systextil está aberta;
- ative o painel de segunda via e reenvie o título pelo CRM.

Se os campos não forem encontrados, se o painel estiver em outra tela ou se os dados expirarem, a solicitação é recusada. Não tente completar o fluxo usando valores parciais: confira a origem e envie novamente pelo CRM.

Se houver erro durante a confirmação NXJ no automatizador atual, siga a orientação já exibida por ele: **não pressione F7** e confira/limpe manualmente os campos antes de uma nova tentativa.




## Salvaguardas da automação completa

- O helper-base passa a iniciar em `document-idle` e abre automaticamente o painel correspondente à Consulta de títulos ou a Processos agendados. Isso evita depender da execução manual do menu Tampermonkey em cada aba.
- O orquestrador também inicia em `document-idle`. Ele só aceita a solicitação se o marcador da ponte e os valores auxiliares do formulário coincidirem exatamente com o evento recebido.
- O monitoramento da parcela é independente do texto de sucesso do painel. A ausência ou divergência no campo `seq_duplicatas.` é identificada antes de Find e, novamente, após a consulta. Em qualquer dessas condições, a emissão não acontece.
- A janela de proteção contra emissão repetida é de cinco minutos por título/parcela. Um timeout depois do clique de emissão é tratado como estado incerto; o script não clica novamente.
- A identificação do processo não usa apenas a primeira/última linha. Exige correspondência única do tipo de processo e horário, prioriza o segundo exato e interrompe se houver ambiguidade, data inválida ou mensagem de falha.
- O download conserva a proteção do helper-base: reserva de duplicidade, validação do PDF, pareamento com o auxiliar local, estado indeterminado em timeout e bloqueio de repetição até conferência manual.
- A chave do auxiliar local precisa estar previamente salva/testada no painel de Processos agendados. Sem o auxiliar pareado e acessível, a emissão ainda pode ser solicitada, mas o PDF não será salvo automaticamente. Configure isso antes do uso operacional.
- Pressionar **Esc** interrompe a execução do orquestrador. Se a emissão já tiver sido solicitada, interromper a automação não cancela o processo no ERP.

## Instalação para testar a branch

1. Atualize o userscript da ponte para v0.2.0 no Tampermonkey e mantenha-o habilitado no CRM e no Systextil.
2. Atualize o helper-base para v0.6.1. Ele agora inicializa automaticamente o painel nas telas suportadas.
3. Instale o novo userscript `userscripts/systextil-segunda-via-automatica.user.js` v0.2.0 no Tampermonkey, habilitado no Systextil.
4. Configure e teste o auxiliar local pelo helper-base antes de iniciar uma emissão real.
5. Mantenha uma única sessão/aba de consulta durante a homologação. Se `procAgendados` abrir outra aba, não feche a aba de origem até o processo ser identificado.
6. Faça a primeira homologação somente com título que já esteja previsto para uma operação real. Não gere um boleto extra apenas para testar.


## Testes

A suíte `tests/systextil-crm-bridge.test.js` cobre:
- validação do contrato e preservação de zeros;
- rejeição de pedido expirado e identificadores inválidos;
- preenchimento dos campos auxiliares;
- limite de comprimento;
- ausência do painel ou dos campos;
- ausência de clique automático em controles do ERP.

Execute no repositório com Node.js 18 ou superior:

```powershell
npm run verify
```

A suíte automatizada não substitui a validação operacional no Chrome/Tampermonkey e no Systextil real. A homologação final precisa confirmar a transferência entre duas abas reais e a continuidade do fluxo manual.
