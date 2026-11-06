# Ponte SmartTable → Systextil

**Userscript:** `userscripts/systextil-crm-bridge.user.js`  
**Versão da ponte:** 0.1.0  
**Status:** implementação em desenvolvimento na branch `feat/crm-to-systextil-title-transfer`.

## Objetivo

Transferir um título selecionado na tela do cliente do SmartTable para os campos auxiliares do painel de segunda via do Systextil. O operador escolhe um título por vez.

A ponte não substitui a validação do automatizador de segunda via. Ela apenas prepara os campos de entrada que já existem no painel.

## Dependências e instalação

1. No SmartTable, a funcionalidade depende do Módulo 39 e do wrapper atualizado para a versão 1.123.0. A versão precisa estar publicada no canal `main` antes de ser usada na instalação normal.
2. Instale o userscript `userscripts/systextil-crm-bridge.user.js` no Tampermonkey. O mesmo userscript precisa estar habilitado nas páginas do CRM e do Systextil, pois o armazenamento GM é compartilhado entre as abas da mesma instalação do script.
3. Mantenha instalado o userscript existente `userscripts/systextil-segunda-via-boleto.user.js`.
4. Mantenha uma única aba Systextil ativa durante a transferência. A trava entre abas é cooperativa e reduz disputas, mas não oferece exclusão mútua transacional.
5. No Systextil, abra a tela Consulta de títulos e ative o painel de segunda via pelo menu do Tampermonkey/atalho já oferecido pelo automatizador (`Ctrl+Alt+B`, depois da primeira ativação contextual).

Não é necessário configurar chave de serviço, servidor externo, endpoint HTTP, extensão adicional ou pasta de destino para a transferência dos campos.

## Fluxo operacional

1. Abra o cadastro da empresa no CRM.
2. Clique em **Enviar título ao Systextil**.
3. O SmartTable executa o classificador existente e apresenta os títulos que passaram pelas regras de elegibilidade.
4. Escolha um único título e clique em **Enviar ao Systextil**.
5. A ponte guarda o pedido no armazenamento local do Tampermonkey, compartilhado entre as abas desse userscript.
6. No Systextil, quando o painel de segunda via estiver aberto, a ponte preenche os campos auxiliares:
   - `st-segunda-via-numero-titulo`
   - `st-segunda-via-parcela`
7. A ponte apresenta a razão social, CNPJ, vencimento, saldo e atraso recebidos do CRM como referência visual.
8. Confira a referência com os dados retornados pelo ERP. Clique manualmente em **Preencher campos no Systextil**.
9. O automatizador existente executa sua sequência de foco e aguarda as confirmações NXJ. Só depois dessa confirmação o operador confere os campos do ERP e pressiona **F7 manualmente**.

Depois disso, o fluxo normal do automatizador permanece inalterado: leitura do título após F7, clique manual em Emite boleto, identificação do processo e download conforme a versão instalada.

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
