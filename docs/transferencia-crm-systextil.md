# Segunda via automática — SmartTable → Systextil

**Userscript único:** `userscripts/systextil-segunda-via.user.js`  
**Versão:** 1.1.1 (lote de títulos e abertura automática da Consulta de títulos, v1.1.0; Enter no título e motivo por título, v1.1.1; ver as seções abaixo)  
**Status:** a `main` (commit `09864bc`) já traz a 1.0.8 (espera o POST NXJ de saída, sua resposta HTTP 2xx e a ociosidade entre etapas de foco). A 1.1.0 é uma proposta em branch, sem PR integrada. A homologação operacional no Chrome/Tampermonkey/Systextil real permanece pendente, inclusive para o lote.

## Lote e abertura automática da tela — v1.1.0 (27/11/2026)

**Pedido do usuário:** emitir vários boletos de uma vez, incluir títulos não vencidos e fazer o Systextil abrir sozinho a Consulta de títulos. O fluxo descrito pelo usuário: o Systextil consulta e emite todos os boletos na Consulta de títulos e, **depois**, vai a Processos agendados e baixa os PDFs. O SmartTable (v1.142.0, repositório SmartTable) envia o lote; esta versão o executa.

**Pedido em lote (schema 2).** `{ schema: 2, id, createdAt, source: "smarttable-crm", itens: [...] }`, de 1 a **6** títulos, cada um validado como o pedido de um título. Título e parcela repetidos no mesmo lote (comparados sem zeros à esquerda) são recusados. O pedido de um título (schema 1) continua aceito e segue o fluxo da 1.0.8 sem mudança de comportamento.

**Por que 6 e por que 3 min 05 s entre emissões (inferido do código, não observado no ERP):**
- Todo processo de emissão se chama "Emissão de boletos com registro" e só se distingue pelo horário: `analisarProcessos` aceita um processo dentro de ±90 s do clique e exige um único candidato. Dois cliques com menos de duas janelas (180 s) de diferença deixariam os dois processos na mesma janela e o script pararia por ambiguidade. Escolher "a linha de cima" seria adivinhar, o que este repositório proíbe. Por isso o lote espera `INTERVALO_ENTRE_EMISSOES_MS = 2 × 90 s + 5 s` entre um clique em **Emite boleto** e o seguinte. A consulta do título seguinte acontece durante a espera; o clique, só depois dela.
- `analisarProcessos` recusa solicitação com mais de 30 min. Como o primeiro PDF só é baixado depois da última emissão, o teto de títulos precisa caber: 6 títulos ≈ 15 min de intervalos mais consultas e navegação. Com 10 estouraria. Um teste trava essa conta (`MAX_ITENS_LOTE`, `INTERVALO_ENTRE_EMISSOES_MS`, `MAX_IDADE_SOLICITACAO_MS`).
- Se um processo rodar mais de ~95 s depois do clique, o título seguinte pode ver dois processos na sua janela: o resultado é `indeterminado` (falha segura), nunca um PDF trocado.

**Fase 1, emissão (na Consulta de títulos).** Para cada título, na ordem: `consultarEConferirTitulo` (a mesma sequência do pedido de um título: Nova consulta se houver resíduo, preenchimento com confirmação NXJ dos dois campos, Find, registro único, conferência de título, parcela e cliente), espera do intervalo e `acionarEmissaoDoTitulo`, que **reconfere** a tela, o registro e a trava de 5 min por título/parcela imediatamente antes de clicar em **Emite boleto** uma única vez (o registro pode ter ficado minutos na tela esperando o intervalo). Na primeira falha o lote **para**: os títulos que faltam ficam `nao-emitido`. Um erro depois do clique deixa o título `indeterminado` (a emissão é incerta e nunca é repetida). Esc interrompe sem emitir os que faltam.

**Fase 2, download (em Processos agendados).** Só depois da fase 1, se algum título foi emitido: aciona `procAgendados` e, para cada título emitido, identifica o processo pela **própria** solicitação (horário, número e parcela), valida e baixa o PDF com as mesmas validações da 1.0.8 (`aguardarProcessoDoItem` e `iniciarDownloadAutomatico`, este em modo silencioso). Baixar não duplica emissão: a falha de um título não impede os outros, **exceto** se a tela de Processos agendados falhar (aí os demais ficam `indeterminado`).

**Estados.** Por título (lista fechada, é o que o CRM recebe): `na-fila`, `consultando`, `aguardando-intervalo`, `emitido`, `nao-emitido`, `baixando`, `concluido`, `indeterminado`, `erro`. O CRM recebe só `{ indice, estado }`, nunca título, CNPJ, nome nem mensagem. Resultado final: `concluido` com `ok: true` só se TODOS salvaram o PDF; com algum `indeterminado`, `indeterminado`; senão `concluido` com `ok: false`. A execução gravada usa `lote-emitindo`, `lote-emitido` e `lote-baixando`; **nenhum expira sozinho** e, com título `indeterminado`, o bloqueio permanece até a conferência manual.

**Retomada e bloqueio.** O pedido é apagado do armazenamento ao assumir o lote, antes da primeira consulta: recarregar a página não emite de novo. Recarregar durante a fase 1 deixa `lote-emitindo` gravado (bloqueio): confira Processos agendados e Downloads e use **Segunda via: liberar bloqueio após conferência manual**. Recarregar na fase 2 retoma os títulos `emitido` e marca como `indeterminado` o que estava `baixando` (o PDF pode ter sido salvo).

**Abertura automática da Consulta de títulos.** Numa aba em outra tela, depois de 1,2 s (tempo para uma aba que já está na Consulta pegar o pedido), o script escreve `crec_f090` no campo "Buscar programas" do cabeçalho (`<object id="nxj_header">`, mesmo domínio) e envia **só o formulário da busca** (`requestSubmit()`, o que o Enter do operador faz; o Enter simulado não abre a tela, diagnóstico de 27/11/2026 do SmartTable, e por isso não há teclas simuladas). **Uma tentativa por pedido**, entre todas as abas, com marca no armazenamento que sobrevive à recarga. Se a tela não abrir em 6 s, publica `abrir-tela-manual` uma vez e o pedido segue válido (5 min) até o operador abrir a tela. Nunca clica, nunca F7, F9 nem F10, nunca envia outro formulário. Isto **não** vira mais `erro` terminal: abas fora da tela não publicam erro. Risco aceito: a aba que troca de tela pode perder algo não salvo nela.

**Códigos de erro.** Os resultados `erro` podem trazer `codigo`: `pedido-pendente`, `bloqueio-persistido`, `expirado` ou `tela-ausente` (lista fechada; a mensagem não muda).

**Fato confirmado pelo usuário (27/11/2026):** digitar `crec_f090` no "Buscar programas" e apertar Enter abre a Consulta de títulos.

**NÃO homologado no Systextil real (não repetir como fato):** (1) o envio do formulário (`requestSubmit`) abrir a tela, o que a ponte do celular do SmartTable também só supõe; (2) **Nova consulta** entre títulos e **Emite boleto** repetido sem sair da Consulta; (3) a Consulta continuar utilizável durante a espera de ~3 min com um registro carregado; (4) os processos com ~3 min de intervalo serem reconhecidos um a um; (5) a tela de Processos agendados listar os vários processos como esperado; (6) os downloads em sequência com o Tampermonkey. Primeiro teste real sugerido: um lote de 2 títulos que seriam emitidos de qualquer jeito, nunca emissão extra.

**Testes:** `tests/segunda-via-lote.test.js` (relógio falso e armazenamento falso: validação do lote, intervalo, ordem consulta/espera/clique, parada na falha, Esc, as duas fases, retomada, abertura da tela, estados e códigos; mais asserções de código-fonte para o que depende da página). Mutações conferidas: 27 defeitos reintroduzidos (intervalo, teto, ordem, parada, clique incerto, duplicados, vazamento de dados no resultado, pedido apagado depois do laço, relançamento do erro, nova tentativa de abertura, envio sem conferir o texto, travas de consumo e de processos, reconferências antes do clique e as listas de retomada); cada um derruba pelo menos um teste. **Não coberto por execução:** o código que lê e aciona a página real (consulta, clique, grade, download); ele reaproveita por extração mecânica o código da 1.0.8 e fica coberto por asserções de ordem no fonte.

## Correções da v1.1.1 — Enter no título e motivo de cada título (27/11/2026)

**Relato do usuário (teste real da 1.1.0):** (1) "ele digita o número do título mas não dá Enter, então não insere o número de verdade"; (2) "o segundo título não está emitindo"; (3) "às vezes a pesquisa da tela não dá o Enter" (no "Buscar programas").

**Fato confirmado pelo usuário (27/11/2026):** à mão, o que faz o ERP assumir o número do título na Consulta de títulos é o **Enter** (não basta sair do campo). Isto contradiz o comentário antigo do código, que dizia que a sequência só com troca de foco tinha sido confirmada.

**O que mudou:**
- **Enter no campo do título.** Depois de escrever o número e esperar a pausa de sempre, o script dá Enter no campo do título (`pressionarEnterNoCampo`: `keydown`, `keypress` e `keyup`, `keyCode` 13), espera o ERP assentar e só então segue para a parcela (relendo o campo, porque o ERP pode recriá-lo). A marca do comando de saída é tomada antes do Enter. Se o Enter acionar a consulta antes da hora (a tela deixa de estar em modo de consulta), o script para sem emitir. **A parcela não recebe Enter** (o relato foi só sobre o título). Vale para o pedido de um título e para cada título do lote.
- **"Buscar programas".** Primeiro o Enter simulado; se a tela não abrir em 1,5 s, o envio do formulário da busca (`requestSubmit`), uma vez; sem tela em 6 s, o aviso manual. É a ponte do celular 0.3.1. Só dá Enter se o texto `crec_f090` ficou no campo. (A 1.1.0 só enviava o formulário, sem Enter.)
- **Motivo de cada título.** Cada título que não foi emitido ou ficou incerto passa a levar o motivo ao CRM (campo `motivo` dentro de `itens`; texto fixo do script, com sequências de 6 ou mais dígitos mascaradas e no máximo 200 caracteres) e ao console da aba do Systêxtil (`[Systextil Segunda Via] Título N do lote: <estado>. <motivo>`), uma vez cada, sem número de título nem dado do cliente. Antes o motivo ficava só no armazenamento do Tampermonkey e ninguém via por que um título não saiu.

**Salvaguardas que não mudaram:** o Enter é a ÚNICA tecla simulada do script (nunca F7, F9 nem F10), e a barreira de confirmação NXJ continua exigida antes do Find e da emissão. Se o ERP não aceitar o Enter simulado, a confirmação não chega e o script para sem consultar nem emitir.

**Sobre "o segundo título não emite":** a causa NÃO foi achada, e não foi corrigida às cegas. O segundo título só é emitido cerca de 3 minutos depois do primeiro (intervalo do lote, por desenho). Pode ter a mesma causa do Enter (o título não assentado impede a confirmação NXJ). O motivo por título (acima) mostra o que de fato aconteceu no próximo teste.

**Não homologado no Systêxtil real:** o ERP aceitar o Enter simulado (keydown, keypress e keyup com `keyCode` 13) no campo do título; o efeito do Enter na parcela (que não é enviado); e o Enter simulado no "Buscar programas" (o diagnóstico de 27/11/2026 do SmartTable dizia que ele não abria a tela; por isso o envio do formulário continua como segunda tentativa).

**Testes:** `tests/segunda-via-lote.test.js` e `tests/segunda-via-integrada.test.js` (o teste que proibia `KeyboardEvent` no código inteiro virou "só o Enter, em um lugar, nunca F7, F9 nem F10"; asserções de ordem do Enter no fonte; o Enter e o `keyCode` em execução; abertura da tela com Enter, com Enter + envio e sem abrir; motivo no resultado e no console). Mutações conferidas: 12; cada uma derruba pelo menos um teste (E10 sobreviveu na 1ª rodada, por um teste que estava quebrado, e ganhou asserção própria).

## Objetivo e autorização

O operador seleciona um título no cadastro do cliente do SmartTable e clica em **Enviar ao Systextil**. Esse clique é a única autorização humana para iniciar a consulta e a emissão daquele título.

Depois da autorização, o mesmo userscript conduz todo o processo no Systextil. Não abre painéis flutuantes, não cria campos auxiliares de título/parcela e não solicita F7 manual.

## Instalação

1. No Tampermonkey, instale somente `userscripts/systextil-segunda-via.user.js`.
2. Mantenha o userscript habilitado nos dois domínios: CRM (`texhub.texcotton.com.br/crm/*`) e Systextil (`systextil.texcotton.com.br/systextil/*`).
3. Aceite as permissões `GM_getValue`, `GM_setValue`, `GM_addValueChangeListener`, `GM_registerMenuCommand`, `GM_xmlhttpRequest` e `GM_download` solicitadas pelo Tampermonkey.
4. Confirme que o Chrome permite downloads automáticos para a pasta padrão. Para não abrir o diálogo de destino a cada PDF, desative **Perguntar onde salvar cada arquivo** nas configurações de Downloads do Chrome.
5. Desative ou remova as antigas entradas `systextil-crm-bridge.user.js`, `systextil-segunda-via-automatica.user.js` e `systextil-segunda-via-boleto.user.js`. Elas foram aposentadas e não devem ser usadas em conjunto com o novo arquivo.

O SmartTable continua responsável por apresentar os títulos elegíveis e emitir o evento de transferência. A ponte, a lógica de orquestração, o preenchimento NXJ e as rotinas de processo/download agora estão no mesmo userscript.

## Fluxo automático

1. Abra o cadastro do cliente no SmartTable.
2. Clique em **Enviar título ao Systextil**, selecione o título e confirme em **Enviar ao Systextil**.
3. O userscript valida o contrato da transferência, preservando o título e a parcela como texto e os zeros à esquerda.
4. No Systextil, aguarda a tela **Consulta de títulos** e preenche diretamente os campos reais `num_duplicata.` e `seq_duplicatas.`.
5. A rotina mantém a sequência de foco, edição e eventos `input/change`. Depois de mover o foco do título para a parcela, espera um POST `CLICKONFIELD`/`NEXT_FIELD` iniciado após essa transição, sua resposta HTTP 2xx e 300 ms de ociosidade antes de editar a parcela. Se o ERP recriar a parcela, exige o comando de ativação correspondente antes de escrever no novo controle. Ao sair da parcela, aplica a mesma espera. Uma mera ausência de requisições não é considerada confirmação de saída. Essa sincronização não exige correspondência literal do título antes de inserir a parcela. Antes do Find, o monitor ainda precisa confirmar título e parcela em comandos NXJ concluídos com HTTP 2xx. Diferenças de zeros à esquerda e prefixos explícitos são aceitas somente pela comparação estrita já implementada, sem aceitar substrings.
6. Somente depois das duas confirmações NXJ o userscript aciona o controle **Find**. Se qualquer confirmação faltar, a automação para e não consulta nem emite. Exige exatamente um registro e confere título, parcela e cliente. A comparação tolera zeros à esquerda apenas durante a conferência; os identificadores originais continuam armazenados como texto.
7. Registra a proteção contra repetição e aciona **Emite boleto** uma única vez.
8. Aciona `procAgendados`. Se o ERP mudar a visão na mesma aba, o userscript acompanha a transição; se abrir outra aba, a aba que receber a visão de processos recupera o estado compartilhado pelo Tampermonkey.
9. Aciona novamente o sininho `procAgendados` para atualizar a grade, aguarda a renderização do ERP e procura o processo pela descrição e pelo horário. Mensagens intermediárias ou desconhecidas mantêm o acompanhamento; só prossegue com uma correspondência única e confirmação explícita de sucesso.
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

Título e parcela permanecem como strings. O script não converte identificadores em números nem completa/trunca códigos silenciosamente. No cenário investigado, o título de seis dígitos é enviado com os mesmos seis caracteres, sem zeros à esquerda adicionados. O campo real do ERP é conferido antes e depois do Find.

Os dados de referência do CRM são usados para conduzir a operação e nomear o arquivo. O script não grava observação, contato, negociação ou outros dados comerciais no CRM.

## Salvaguardas e comportamento em falhas

- O clique em **Enviar ao Systextil** é a autorização explícita; nenhuma emissão é iniciada sem ele.
- Uma solicitação pendente é consumida por uma única aba com trava cooperativa no armazenamento GM. A trava reduz concorrência, mas não é uma transação distribuída.
- O monitor NXJ precisa reconhecer os valores exatos do título e da parcela nos comandos de confirmação concluídos com HTTP 2xx. O título visualmente vazio só é tolerado quando o NXJ confirmou seu valor; sem confirmação, o Find é bloqueado.
- O Find só é acionado após confirmação NXJ de título e parcela, precisa retornar uma única correspondência e tem título, parcela e cliente conferidos antes da emissão.
- A emissão recebe uma trava de cinco minutos por título/parcela. Se houver timeout depois do clique, o script não clica novamente: o resultado é tratado como incerto.
- Somente o estado `preenchendo`, anterior ao acionamento da emissão, expira após 30 minutos. Estados `emissao-solicitada`, `processando`, `baixando` e `indeterminado` permanecem bloqueados até recuperação/conferência.
- Um estado persistido não comprova que há um processo ativo no ERP. Em bloqueio sem execução pendente, o operador pode usar o menu Tampermonkey **Segunda via: liberar bloqueio após conferência manual**. O comando mostra o estado registrado, exige confirmação, relê as chaves para evitar apagar um estado que mudou durante a conferência e remove somente as chaves locais de pedido/execução/trava/resultado. Não cancela nem consulta processos no ERP.
- O processo precisa ser identificado sem ambiguidade e informar conclusão com sucesso. A atualização da grade é feita pelo sininho `procAgendados`, não pelo Find da tela de consulta. A primeira leitura ocorre após o refresh inicial e a espera de renderização. Mensagens intermediárias ou desconhecidas mantêm o acompanhamento ativo e provocam nova atualização; marcadores explícitos de falha interrompem o fluxo. O limite de espera gera estado indeterminado, sem repetir a emissão. O download continua bloqueado até a confirmação explícita de sucesso.
- Os marcos de sequência NXJ do título e da parcela são capturados antes da escrita dos respectivos campos. Isso evita descartar uma confirmação enviada imediatamente por `input/change` antes do blur, sem enfraquecer a barreira de confirmação antes do Find.
- A v1.0.8 aguarda o POST NXJ de saída (`CLICKONFIELD`/`NEXT_FIELD`), resposta HTTP 2xx e ociosidade de 300 ms antes de avançar entre campos. Não substitui a confirmação dos dois valores e não cria retentativas de comandos.
- O PDF só é baixado após revalidar o processo, a seleção da grade e a URL/relatório.
- Existe reserva contra download duplicado. Se o navegador não confirmar se o download terminou, a reserva fica indeterminada; confira manualmente a pasta Downloads antes de tentar novamente.
- `Esc` interrompe a automação local. Não cancela uma emissão já enviada ao ERP.
- O script clica no controle **Find** (`btnFind.`) da barra de consulta e aguarda a confirmação da requisição e do resultado do ERP. Não simula eventos de teclado F7 nem usa `.submit()`.

Se a tela não for **Consulta de títulos** quando a solicitação chegar, a partir da 1.1.0 o userscript tenta abri-la pelo "Buscar programas" (uma tentativa por pedido) ou pede ao operador que a abra, e não emite enquanto ela não estiver aberta. Nesse intervalo o pedido continua válido até expirar. Não repita uma solicitação quando o resultado da emissão ou do download estiver indeterminado sem antes conferir Processos agendados e a pasta Downloads.

## Recuperação manual de bloqueio persistido

A chave compartilhada `smarttable.systextil.title-transfer.v1.execucao` pode permanecer preenchida se uma aba for fechada ou o acompanhamento terminar sem confirmação. Por segurança, estados posteriores ao acionamento da emissão não expiram automaticamente; por isso, uma tentativa antiga pode bloquear uma nova transferência mesmo sem processo atualmente em andamento.

Para liberar esse bloqueio, primeiro abra **Processos agendados** no Systextil, confira que não existe emissão correspondente em execução e verifique a pasta **Downloads**. Depois, no menu do Tampermonkey, selecione **Segunda via: liberar bloqueio após conferência manual** e leia o estado apresentado antes de confirmar. A ação limpa apenas o estado compartilhado local do userscript; não cancela, consulta nem altera o ERP. Não confirme enquanto houver qualquer dúvida sobre uma emissão anterior.

## Testes e homologação

O arquivo `tests/segunda-via-integrada.test.js` cobre contrato de transferência, comparação tolerante do payload NXJ, bloqueio quando título/parcela não são confirmados pelo NXJ, ordem da barreira em relação ao Find, baseline NXJ antes da escrita, refresh de Processos agendados pelo sininho antes da primeira leitura, expiração exclusiva de preenchimentos abandonados, identificação única de processo, estados intermediários, falhas explícitas, ambiguidade e validação de URL/PDF. As suítes existentes continuam cobrindo a sequência NXJ e os contratos legados.

Com Node.js 18 ou superior, execute na raiz:

```powershell
npm run verify
```

A execução dos testes não comprova a integração operacional. A v1.0.6 está na `main` pela PR #40; a v1.0.7 permanece em revisão nesta branch. A homologação no Chrome/Tampermonkey e Systextil reais continua pendente. Aproveite um título que já esteja previsto em uma operação real; não gere emissão extra apenas para testar.

A homologação precisa confirmar:

1. A transferência do SmartTable para a aba Systextil.
2. O preenchimento NXJ nos campos reais e a confirmação de título/parcela.
3. O Find, a identificação do único registro e a emissão.
4. A navegação para Processos agendados, tanto na mesma aba quanto em nova aba.
5. A identificação do processo correto e a confirmação de sucesso.
6. O download validado do PDF para a pasta Downloads sem janela de destino, incluindo o comportamento de nome duplicado.
7. O retorno do resultado ao SmartTable e o bloqueio seguro em timeout/falha.

**Estado atual:** a PR #44 integrou a v1.0.7 à `main`. A v1.0.8 está proposta na branch `fix/nxj-aguarda-ocioso-por-campo`; ainda não foi integrada nem homologada no ERP real. Antes de distribuir a automação como homologada, execute `npm run verify` e conclua a homologação operacional, sem gerar emissão extra para teste.


## Correção do acompanhamento de Processos agendados (v1.0.4)

A rotina anterior classificava qualquer mensagem diferente da confirmação literal de sucesso como falha. Isso encerrava o acompanhamento antes da próxima atualização da grade, mesmo quando o texto retornado pelo ERP era apenas um estado intermediário ou não reconhecido.

Na versão 1.0.4, somente marcadores explícitos de erro são classificados como falha. Mensagens vazias, intermediárias ou desconhecidas permanecem em acompanhamento: o userscript atualiza a grade e reanalisa o mesmo processo em intervalos de quatro segundos, por até três minutos. Se o controle Find não estiver disponível, ou o limite de espera terminar sem confirmação, o estado fica indeterminado e exige conferência manual. Nenhuma nova emissão é disparada. O PDF continua condicionado à confirmação literal de sucesso e à validação posterior do registro/relatório.

A suíte automatizada inclui regressões para mensagem intermediária não vazia, falha explícita e disponibilidade do controle de atualização. A homologação no Systextil real continua necessária para confirmar os textos efetivamente retornados e a atualização da grade na estação operacional.

## Correções da versão 1.0.5 — PR #39

A tela Processos agendados é atualizada pelo controle `procAgendados` (sininho). O userscript aciona esse controle antes da primeira leitura e novamente antes de cada releitura, aguarda a requisição NXJ quando observável e respeita ao menos quatro segundos para a grade renderizar. O controle `btnFind.` continua reservado à Consulta de títulos e não é usado para atualizar Processos agendados.

Na Consulta de títulos, os marcos de sequência do monitor NXJ passam a ser capturados antes da escrita de título e parcela. A versão anterior os capturava depois da escrita e parte da espera; uma confirmação imediata do ERP podia ficar fora da janela monitorada. A barreira que exige confirmação de ambos os campos antes do Find permanece inalterada.

A PR #39 inclui regressões para a ordem dos marcos NXJ, refresh pelo sininho e atualização antes da primeira leitura da grade. Parse sintático e 18 verificações direcionadas foram aprovados nesta revisão; `npm run verify` e a homologação no Systextil real ainda não foram executados.

## Correção proposta na v1.0.7 — diagnóstico NXJ sem truncamento prematuro

A versão 1.0.6 limitava a mensagem devolvida ao SmartTable a 300 caracteres em `criarResultado()`. Como o resumo NXJ pode conter vários comandos, o limite podia cortar a mensagem no meio de um identificador (por exemplo, em `CLIC`), impedindo a leitura do restante do diagnóstico.

Na v1.0.7, o limite passa a ser 1.200 caracteres e fica centralizado em `limitarMensagemResultado()`. O resumo continua restrito a metadados técnicos e comprimentos dos segmentos: não inclui os valores de título, parcela, cliente, cookies, tokens ou payload integral. Mensagens maiores que 1.200 caracteres continuam limitadas para proteger o armazenamento e a interface.

A suíte adiciona regressão para uma mensagem superior a 300 caracteres com o comando final preservado, além do limite máximo de 1.200 caracteres e do tratamento de valor nulo. A regra NXJ não foi alterada: título e parcela continuam exigindo confirmação em comandos reconhecidos e respostas HTTP 2xx antes de liberar o Find. A validação automatizada não substitui a homologação no Chrome/Tampermonkey/Systextil real.
