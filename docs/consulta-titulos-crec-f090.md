# Consulta de títulos em lote — tela `crec_f090`

**Userscript:** [userscripts/systextil-consulta-titulos.user.js](../userscripts/systextil-consulta-titulos.user.js) · versão **0.1.0** (proposta em branch; não integrada à `main`).
**Classificação:** leitura (nível L0 da [referência NXJ](referencia-tecnica-nxj-systextil.md#12-níveis-de-risco-e-ações-autorizadas)). Preenche os filtros da consulta e aciona **Nova consulta** e **Find**; nunca grava, emite, altera ou exclui.
**Estado da validação:** testes automatizados com ERP simulado aprovados; **homologação no Systextil real pendente** (seção 9).

> Este documento separa três níveis de informação:
> **Informado** = descrição funcional da tela fornecida pelo operador (não verificada pelo script);
> **Observado** = nome de campo/comando registrado na [referência NXJ](referencia-tecnica-nxj-systextil.md) (seção 7) após sondagem;
> **Inferido** = associação feita pelo nome do campo ou por analogia, **sem comprovação direta**. Nada marcado como inferido deve ser tratado como fato do ERP.

## 1. Como usar

1. Instale `systextil-consulta-titulos.user.js` no Tampermonkey (ele só roda em `…/systextil/*` e no documento principal). O `@updateURL` aponta para a `main`; enquanto a branch não for integrada, instale o arquivo manualmente.
2. Abra a **Consulta de títulos** (`forms.crec.crec_f090`).
3. Pressione **Alt+Shift+Q** (ou use o comando **Consulta de títulos em lote** no menu do Tampermonkey). O atalho é a constante `ATALHO` no script; a ausência de conflito com os atalhos do Systextil/Chrome **não foi homologada**.
4. Cole os títulos na caixa de texto, um por linha, e clique em **Consultar**. Esse clique é a autorização humana explícita para as consultas.
5. Acompanhe o status. **Não digite nem clique no Systextil durante a execução** (o popup bloqueia teclas do operador, mas isso não substitui a disciplina do operador). **Esc** interrompe em ponto seguro; fora da execução, Esc fecha o popup.
6. Ao final, use **Copiar para planilha** (TSV) ou **Baixar CSV** (separador `;`, UTF-8 com BOM para o Excel pt-BR). Cada título também mostra, em **Campos lidos**, todos os campos capturados.

### 1.1 Formato da entrada

```text
# empresa;cliente;número;parcela;tipo      ← exemplo fictício
1;12.345.678/0001-00;123456;1;1
1;;123457;2;1
```

| Regra | Comportamento |
|---|---|
| Separador | Tab (colar da planilha) ou `;`. |
| Colunas | 5 (`empresa;cliente;número;parcela;tipo`) ou 4 (`empresa;número;parcela;tipo`, sem cliente). A coluna cliente pode ficar vazia. |
| Cliente | CNPJ (14 dígitos) ou CPF (11), com ou sem máscara. O dígito verificador **não** é validado pelo script. |
| Número, parcela, tipo, empresa | Letras e números. **Vírgula e hífen são recusados** (são operadores de busca múltipla do NXJ: `,` = OU, `-` = intervalo). Zeros à esquerda são preservados; nada é convertido em número. |
| Ignorado | Linhas vazias, linhas iniciadas por `#` e um cabeçalho cuja primeira coluna seja `Empresa`. |
| Bloqueio | Qualquer linha inválida ou repetida (mesma empresa/número/parcela/tipo, ignorando zeros à esquerda) **impede o início do lote inteiro**. Máximo de 50 títulos e 200 linhas. |

### 1.2 Duração

Com os atrasos validados em campo para Número/Parcela (500 ms antes da escrita, 500 ms antes de sair, 800 ms após sair, mais 300 ms de silêncio NXJ por campo), um título com cliente leva da ordem de **12 segundos** (sete campos). Um lote de 50 títulos pode passar de 10 minutos. Os atrasos estão em `CONFIG_PADRAO`; reduzi-los exige validação no ERP real.

## 2. Sequência executada por título

| # | Passo do operador (Informado) | O que o script faz | Observação |
|---|---|---|---|
| 1 | F6 — Nova consulta | Aciona o controle `btnClearToFind.` somente se houver registro/resíduo na tela. Exige modo de consulta, **campos de número, parcela, tipo e cliente vazios** e interrompe o lote se não limpar. | A equivalência F6 ↔ `btnClearToFind.` vem do userscript de segunda via; F7 nunca é simulado. |
| 2 | Informar Empresa | Foca, escreve (setter nativo + `input`/`change`), foca o campo seguinte e aguarda o POST NXJ de saída (HTTP 2xx) e 300 ms sem requisições. A partir do 2º título o foco ainda está em Empresa (o último passo o devolve ali): o script **desfoca antes de ativar**, porque `focus()` sobre elemento já focado não gera evento. | Empresa bloqueada e idêntica à solicitada é aceita sem escrita; bloqueada e diferente → `empresa-invalida`. O efeito desse `blur` no ERP real não foi homologado (seção 8). |
| 3 | Informar Cliente (3 campos) | Mesma sequência para base, ordem e dígito. | Mapeamento das partes: **inferido** (seção 5.1). Omitido quando a linha não tem cliente. |
| 4 | Informar Nr título (número, parcela, tipo) | Mesma sequência; o último campo devolve o foco ao primeiro editável. | A sequência foi validada em campo apenas para número e parcela. |
| — | (verificações) | **Barreira antes do Find:** cada campo precisa ter trafegado num comando de confirmação (`CLICKONFIELD`/`NEXT_FIELD`, HTTP 2xx) **dentro da própria janela**; valores visíveis não podem divergir; `nome_empresa.`, `nome_cliente.` (se houver cliente) e `nome_tipo.` precisam estar carregados. | Falhou → sem Find. |
| 5 | F7 — Procurar | Aciona **uma única vez** o controle `btnFind.` e aguarda o POST, a ociosidade e o desfecho em `curDataView`. | Nunca há nova tentativa automática. |
| 6 | Ler os campos | Se houver exatamente um registro, lê duas vezes (150 ms de intervalo) até estabilizar e confere a chave. | Seção 3. |
| 7 | F4/F3 — navegar | **Não usado.** Mais de um registro → `ambiguo`, nada é lido. | A chave completa (empresa + número + parcela + tipo) deve ser única. |

## 3. Resultado por título

| Status | Quando | Segue para o próximo? |
|---|---|---|
| `ok` | Um registro; chave lida (empresa, número, parcela, tipo e, se informado, as três partes do cliente) confere com a solicitada. | Sim |
| `nao-encontrado` | `recordAction` compatível com `NO_RECORDS` após o Find. | Sim |
| `sem-resultado` | A tela permaneceu em modo de consulta sem registro. Pode ser título inexistente, mas o valor real de `recordAction` nesse caso **não foi homologado**; não se afirma inexistência. | Sim |
| `ambiguo` | Mais de um registro. Nenhum campo é lido. | Sim |
| `divergente` | O registro exibido não confere com a chave solicitada. Os dados são **descartados** (nunca devolvidos como se fossem do título pedido). | Sim |
| `cliente-invalido` / `empresa-invalida` / `tipo-invalido` | A descrição correspondente não foi carregada pela tela (ou empresa bloqueada diferente da pedida). Find bloqueado. | Sim |
| `erro` | Estado inesperado: visão mudou, campo ausente/duplicado, NXJ não confirmou, HTTP não 2xx, timeout, resíduo após Nova consulta, etc. | **Não** — o lote é encerrado e o restante fica `nao-processado` |
| `nao-processado` | Interrompido pelo operador ou lote encerrado por erro. | — |

Alertas (informativos, não alteram o status): título cancelado (`situacao_duplic.` = `2`) com Saldo, Saldo com cheques ou Sal. moeda diferentes de zero; código de situação fora de 0–4; cliente não informado (cliente do registro não foi conferido); campos com nome duplicado na tela (não lidos).

Um timeout nunca é tratado como "o comando não ocorreu": o lote encerra e o operador confere a tela antes de nova tentativa. **Use Nova consulta antes de recomeçar.**

## 4. Regras da tela e como o script as trata

| Regra da tela (Informado) | Tratamento no script |
|---|---|
| Empresa inválida ou ausente bloqueia a consulta. | Empresa é obrigatória na entrada; `nome_empresa.` precisa carregar, senão `empresa-invalida` e sem Find. |
| Nenhum critério bloqueia a consulta. | Empresa, número, parcela e tipo são obrigatórios; o lote não inicia sem eles. |
| Cliente inexistente: a tela o identifica como não cadastrado. | `nome_cliente.` não carregado → `cliente-invalido`, sem Find, sem extrair campos. |
| Título inexistente: não há registro para ler; seguir para o próximo. | `nao-encontrado` ou `sem-resultado`; campos em branco nunca são extraídos como dados. |
| Endosso com documento inválido bloqueia o avanço se houver interação. | O script **não preenche nem edita** os campos de endosso; apenas lê. |
| Permissão do usuário pode ocultar campos, anexos e ações. | Campo inexistente → lista `ausentes`; não visível → `ocultos`; **nunca confundido com vazio**. Use um usuário com acesso à tela e à empresa. |
| Título cancelado: Saldo, Saldo com cheques e Sal. moeda zerados. | Capturados como exibidos; alerta se algum não for zero. |
| Saldo considera pagamentos, acréscimos, descontos e estornos; não calcule. | O script **não calcula saldo**; captura o valor de `saldo_duplicata.`. |
| Saldo com cheques pode diferir de Saldo. | Capturado separadamente (`saldo_duplicata_ch.`). |
| Emissão de boleto e de nota fiscal têm validações financeiras e ficam fora da automação. | Não há código para essas ações; um teste automatizado falha se `BTNEmetirBoletos`, `CMDEmetirBoletos` ou comandos de gravação aparecerem no script. |
| F10 abre consultas auxiliares (`cobr_f061`, `fina_f030`, `cpag_f040`, `pedi_f029`, …). | **Nunca usado.** F10 só vale para operação manual. |

## 5. Mapa de campos da tela

Legenda da coluna **Associação**: ✔ = rótulo e `name` coincidem de forma evidente; † = **inferida** pelo nome/posição (confirmar antes de depender dela); ? = significado não confirmado. O ponto final faz parte do atributo `name`. Todos os `name` abaixo constam na [referência NXJ, seção 7.1](referencia-tecnica-nxj-systextil.md#71-campos-identificados) (**Observado**); as colunas de função são **Informado**.

### 5.1 Campos de entrada (o script preenche)

| Campo na tela | `name` | Função na consulta | F10 | Associação |
|---|---|---|---|---|
| Empresa: | `codigo_empresa.` | Código da empresa do título. Inicia com a empresa do usuário. Sem empresa válida a consulta é bloqueada. Ao preencher, carrega `nome_empresa.`. | — | ✔ |
| Cliente: (base) | `cli_dup_cgc_cli_r.` | 1ª parte do CNPJ/CPF. Script: CNPJ → 8 dígitos com zero à esquerda (9); CPF → 9 primeiros dígitos. Se o campo declarar `maxLength` 8, o zero inicial da base do CNPJ é removido; nunca se trunca dígito. | `pedi_f029` | † |
| Cliente: (ordem) | `cli_dup_cgc_cli_o.` | 2ª parte. CNPJ → 4 dígitos da filial; CPF → `0000`. | `pedi_f029` | † |
| Cliente: (dígito) | `cli_dup_cgc_cli2.` | 3ª parte, 2 dígitos verificadores. | `pedi_f029` | † |
| Nr título: (número) | `num_duplicata.` | Número do título. Só por número a tela pode retornar todas as parcelas. Máscara real não confirmada (DOM sem `maxLength`). | `cobr_f061` | ✔ |
| Nr título: (parcela) | `seq_duplicatas.` | Parcela/sequência. | `fina_f030` | ✔ |
| Nr título: (tipo) | `tipo_titulo.` | Tipo do título; ao informar, carrega `nome_tipo.`. | `cpag_f040` | ✔ |

Com cliente existente informado, a tela carrega `nome_cliente.` e a situação de crédito. O script exige `nome_cliente.` carregado como prova de que o cliente foi aceito. **A equivalência base/ordem/dígito ↔ `_r`/`_o`/`2` é inferida** (padrão 9/4/2 do cadastro de clientes); se estiver trocada, o resultado esperado é `cliente-invalido` (falha segura), não dado errado.

### 5.2 Identificação e cliente (o script lê)

| Campo na tela | `name` | O que representa | Assoc. |
|---|---|---|---|
| Data: | `data_corrente.` | Data corrente exibida pela tela. | ✔ |
| Hora: | `hora_corrente.` | Hora corrente exibida pela tela. | ✔ |
| Empresa: (descrição) | `nome_empresa.` | Nome da empresa, carregado automaticamente. | ✔ |
| Nr título: (descrição) | `nome_tipo.` | Descrição do tipo de título. | ✔ |
| Situação: | `situacao_duplic.` | 0 em aberto · 1 pago total · 2 cancelado · 3 pago a menor · 4 pago a maior. O script acrescenta a coluna **Situação (descrição)** com esse texto. | ✔ |
| (descrição da situação) | `descrsit.` | Existe na tela; o conteúdo exato não foi documentado. | † |
| Emissão: | `data_emissao.` | Data de emissão. | ✔ |
| Nome do cliente | `nome_cliente.` | Nome do cliente, carregado pelo documento. | ✔ |
| Responsável: | `cli_resptit_r.`, `cli_resptit_o.`, `cli2resptit.` | CNPJ/CPF do cliente responsável pelo crédito ou título (3 partes). | † |
| Desc. resp. | `descr_cliresp.` | Nome do responsável pelo crédito. | † |
| Endosso: | `cgc_endosso_r.`, `cgc_endosso_o.`, `cgc2_endosso.` | CNPJ/CPF do endosso (3 partes). Ao editar, a tela valida o dígito verificador e bloqueia se não conferir — por isso o script **só lê**. | † |
| Nome endosso | `nome_endosso.` | Nome do endosso. | ✔ |

### 5.3 Pedido, representante e comissão

| Campo na tela | `name` | O que representa | F10 | Assoc. |
|---|---|---|---|---|
| Pedido: | `pedido_venda.` | Pedido de venda vinculado. | `pedi_f130` | ✔ |
| Representante: | `cod_rep_cliente.` | Código do representante. | — | ✔ |
| Nome representante | `nome_representante.` | Carregado a partir do código. | — | ✔ |
| % Comissão: | `percentual_comis.` | Percentual de comissão. | — | ✔ |
| Base cálculo: | `base_calc_comis.` | Base para o cálculo da comissão. | — | ✔ |
| Valor comissão: | `valor_comis.` | Valor da comissão. | — | ✔ |

### 5.4 Cobrança, banco e controles financeiros

| Campo na tela | `name` | O que representa | F10 | Assoc. |
|---|---|---|---|---|
| Portador: | `portador_duplic.` | Portador bancário ou responsável pela cobrança; carrega a descrição. | — | ✔ |
| Descrição do portador | `descricao.` | Nome/descrição do portador. | — | † |
| Bord.: | `numero_bordero.` | Número do borderô. | — | ✔ |
| Rem.: | `numero_remessa.` | Número da remessa bancária. | — | ✔ |
| Nr.banco: | `nr_titulo_banco.` | Número do título no banco. | — | ✔ |
| Conta corrente: | `conta_corrente.` | Conta corrente vinculada. | — | ✔ |
| Carteira: | `cod_carteira.` | Carteira de cobrança. | — | ✔ |
| Transação: | `cod_transacao.` | Transação vinculada; carrega a descrição. | `estq_f005` | ✔ |
| Descrição transação | `descr_transacao.` | Descrição da transação. | — | ✔ |
| Perc.desc.título: | `perc_desc_duplic.` | Percentual de desconto do título. | — | ✔ |
| Solicitação: | `nr_solicitacao.` | Número da solicitação de borderô. | `crec_f470` | ✔ |
| Saldo movto de perda | `saldo_moviment_perdas.` | Saldo movimentado em baixas/estornos de perda. Somente leitura. | — | ✔ |
| Saldo com cheques | `saldo_duplicata_ch.` | Saldo descontando cheques associados. Somente leitura. | — | † |
| (cobrança externa) | `cobr_externa.`, `cobr_ext_desc.`, `cobr_ext_desc2.` | Existem na tela; significado **não confirmado**. Lidos com o nome técnico. | — | ? |

### 5.5 Datas, valores, moeda e posição

| Campo na tela | `name` | O que representa | F10 | Assoc. |
|---|---|---|---|---|
| Vencimento: | `data_venc_duplic.` | Data de vencimento. | — | ✔ |
| Valor: | `valor_duplicata.` | Valor original. | — | ✔ |
| Saldo: | `saldo_duplicata.` | Saldo financeiro atual, calculado pela tela (pagamentos, acréscimos, descontos). **Capturar o exibido; não recalcular.** | `crec_f390` | ✔ |
| Moeda tit.: / Descr. moeda | `moeda_titulo.` / `descr_moeda.` | Código e descrição da moeda. | — | ✔ |
| Vl. moeda: | `valor_moeda.` | Valor original na moeda do título. | — | ✔ |
| Sal. moeda: | `saldo_moeda.` | Saldo atual na moeda do título. | — | ✔ |
| Prorrogação: | `data_prorrogacao.` | Data de prorrogação, quando houver. | — | ✔ |
| Posição: / Descr. posição | `posicao_duplic.` / `descr_posicao.` | Código e descrição da posição. | — | ✔ |
| Previsão: / Descr. previsão | `previsao.` / `descr_previsao.` | Indicador e descrição de previsão. | — | ✔ |
| Local: / Descr. local | `cod_local.` / `descr_local.` | Local vinculado e descrição. | — | ✔ |
| Dupl.emitida: | `duplic_emitida.` | Indicador de emissão da duplicata para cobrança. | — | ✔ |

### 5.6 Histórico, contabilidade e renegociação

| Campo na tela | `name` | O que representa | F10 | Assoc. |
|---|---|---|---|---|
| Histórico: | `cod_historico.` | Código do histórico contábil. | `cont_f010` | ✔ |
| Compl. hist.: | `compl_historico.` | Complemento textual do histórico. | — | ✔ |
| Num. contábil: | `num_contabil.` | Número do lançamento contábil. | `cont_f650` | ✔ |
| Docto reneg.: | `docto_subst.` | Documento substituído/relacionado à renegociação. Somente leitura. | — | ✔ |
| Situação renegociação | `ren_sit_renegocia.` / `desc_sit_renegocia.` | Sem substituição, substituído, em substituição ou substituto. Os códigos numéricos **não estão documentados**; use a descrição da tela. | — | ✔ |
| Número da renegociação | `ren_num_renegocia.` | Identificador da renegociação. | — | ✔ |
| Ult.ocorr: | `ult_ocorrencia.` / `dt_ult_ocorrencia.` | Última ocorrência bancária/de cobrança e sua data. Somente leitura. | — | ✔ |

### 5.7 Informações complementares e integrações

| Campo na tela | `name` | O que representa | F10 | Assoc. |
|---|---|---|---|---|
| Duplic.impressa: | `duplic_impressa.` | 0 não impressa · 1 impressa. | — | ✔ |
| Tem informação | `tem_obs.` | Existência de observações (normalmente S/N). Somente leitura. | `crec_f450` | ✔ |
| Adiantam.: | `possui_adiantamento.` | Vínculo com adiantamento. | `cpag_f600` | ✔ |
| Nr. cupom: | `nr_cupom.` | Cupom relacionado ao título. | — | ✔ |
| Forma pagto: / Descr. forma pagto | `cod_forma_pagto.` / `descr_forma_pagto.` | Código da forma de pagamento e descrição. | `loja_f650` | ✔ |
| Nr. remessa scpc: | `scpc_nr_remessa.` | Remessa SCPC, quando aplicável. | — | ✔ |
| Sit. remessa scpc: | `scpc_situacao.` | Situação da remessa SCPC. | — | ✔ |
| Códigos de barras | `cod_barras.` | Código de barras do título. | — | ✔ |
| Linha digitável | `linha_digitavel.` | Linha digitável da cobrança. | — | ✔ |
| Pix copia e cola | `bolepix.` | Código Pix, quando disponível. | — | ✔ |

### 5.8 Campos condicionais (FIDC) e não capturados

- **FIDC:** `numeroRemessaFIDC.`, `situacaoFIDC.`, `dataRemessaFIDC.`, `numeroIdentificaoFIDC.` (nome sem o "ã" é o `name` real). Aparecem conforme a configuração de cobrança/FIDC; o significado de cada um é **inferido** pelo nome. São lidos somente quando visíveis.
- **`superCountLabel.`** consta na referência (somente leitura), mas é um rótulo de contagem de registros, não dado do título; **não é capturado** (exclusão intencional, coberta por teste).
- A tela tem mais campos auxiliares e condicionais (configurações de cobrança, banco, SCPC, renegociação e permissões). Campo que não esteja no catálogo do script não é capturado.

### 5.9 O que significa "leitura" no script

- Só são lidos campos presentes (`getElementsByName` com exatamente um elemento) e **visíveis**. Campo inexistente → `ausentes`; presente porém oculto → `ocultos`; nome duplicado → alerta e não lido. Vazio visível é exportado como vazio.
- Checkbox/radio são exportados como `marcado`/`desmarcado` (**não testado** nesta tela).
- Valores são texto exatamente como exibidos (limite de 4.000 caracteres por campo). O script não converte valores monetários para exportação; só os interpreta (centavos inteiros) para o alerta de título cancelado.

## 6. Segurança e privacidade

- **Somente leitura:** os únicos controles acionados são `btnClearToFind.` e `btnFind.`, por id exato e uma vez por etapa. Não há F7/teclado sintético, rede própria, `GM_xmlhttpRequest`, `GM_download`, `fetch`, `innerHTML`, `eval`, armazenamento (`localStorage`, `sessionStorage`, `GM_setValue`, cookies) nem `console.log`. Os testes verificam essas ausências.
- **Permissões Tampermonkey:** `unsafeWindow` (necessário para o `XMLHttpRequest` e o `curDataView` da página) e `GM_registerMenuCommand` (acesso alternativo ao popup). Sem `@connect`, `@require` ou `@resource`.
- **Monitor NXJ temporário:** instalado no `XMLHttpRequest` da página apenas durante o lote, guarda em memória comando, segmentos e status, e é restaurado no `finally` (inclusive em erro, timeout e interrupção). Diagnósticos mostram só nomes de comando e comprimentos.
- **Dados:** os resultados ficam apenas em memória enquanto o popup está aberto; fechar descarta tudo. O texto do ERP entra no popup por `textContent`. As mensagens de erro e as etapas de progresso **não contêm** número do título, cliente ou valores.
- **Exportações contêm dados reais** (nomes, CNPJ/CPF, saldos). O CSV/TSV é gerado localmente; trate o arquivo como dado sensível e apague-o depois de usar. Textos que comecem com `=`, `+`, `-` ou `@` recebem um apóstrofo para impedir fórmula na planilha.
- **Não use junto com a segunda via:** ambos os userscripts movem o foco e preenchem a mesma tela. Não inicie um lote enquanto uma transferência da segunda via estiver em andamento (e vice-versa). Não há trava entre os dois.

## 7. Testes automatizados

`tests/consulta-titulos.test.js` (Node nativo, sem dependências). Cobrem: interpretação da entrada (formatos, zeros à esquerda, operadores recusados, duplicados, limites), partes do CPF/CNPJ, regras puras (situação, valores monetários, alertas, comparação da chave), exportação (escape, fórmulas), atalho, **cobertura do catálogo contra a seção 7.1 da referência**, o fluxo completo contra um ERP simulado (XHR + comandos NXJ + `curDataView`) e proteções estáticas (escopo, permissões, ausência de ações de escrita), independência de `Array.from` (o Systextil o sobrescreve; ver seção 10).

Cenários do ERP simulado (o simulador reproduz o DOM: `focus()` sobre elemento focado não dispara evento): sucesso, sem cliente, três títulos em sequência (regressão do foco residual), título inexistente seguido de outro válido, modo de consulta sem registro, mais de um registro, registro divergente, cliente/empresa/tipo inexistentes, comando NXJ sem valor, comando de saída ausente, HTTP 500, campo limpo visualmente, input recriado, visão trocada durante o lote, interrupção, empresa bloqueada, `maxLength`, resíduo de cliente após Nova consulta e campo duplicado/oculto. Foi feita uma verificação de mutação (desativar cada proteção crítica faz ao menos um teste falhar). Além disso, o userscript foi executado no Chromium contra uma página simulada com `XMLHttpRequest` real (popup, atalho, tabela, CSV, interrupção por Esc, recusa fora da `crec_f090`); esse teste achou o defeito do foco residual e não faz parte do repositório, pois não há dependências de teste de navegador.

**O que os testes não provam:** que o Systextil reconhece os eventos, que as descrições são carregadas como no simulador, que `recordAction` assume os valores supostos, nem que o atalho está livre. Isso depende da homologação.

## 8. Homologação pendente no ERP real

Executar com usuário autorizado, títulos reais já existentes e **sem emitir nada**. Registrar apenas o resultado técnico (versão do userscript, navegador, data, critério verificado), nunca nome de cliente, CNPJ, título ou saldo.

- [ ] **Atalho:** `Alt+Shift+Q` abre o popup sem acionar função do Chrome/Systextil. Se houver conflito, alterar `ATALHO` ou usar o menu do Tampermonkey.
- [ ] **Foco residual:** a partir do 2º título, o `blur` de Empresa antes da ativação não envia comando que altere dados nem desloca a tela (esperado: no máximo um `ClickOnField`/`NEXT_FIELD` sem valor novo). Se o ERP recriar os inputs após Nova consulta, esse desvio nem é usado.
- [ ] **Sequência nos campos novos:** o preenchimento de Empresa, Cliente (3 campos) e Tipo gera comandos `CLICKONFIELD`/`NEXT_FIELD` com o valor e carrega `nome_empresa.`, `nome_cliente.` e `nome_tipo.`. Só Número e Parcela foram validados em campo. Se o diagnóstico NXJ mostrar `?` como comando ou `[]` sem comprimento, ler a mensagem inteira antes de qualquer ajuste.
- [ ] **Mapeamento do cliente:** consultar manualmente um título conhecido e conferir, no DevTools, os comprimentos (não os valores) dos três campos: `['cli_dup_cgc_cli_r.','cli_dup_cgc_cli_o.','cli_dup_cgc_cli2.'].map(n => { const e = document.getElementsByName(n)[0]; return [n, e && e.value.length, e && e.maxLength]; })`. Esperado: base 9 (ou 8 se a máscara não usa zero à esquerda), ordem 4, dígito 2.
- [ ] **Título inexistente:** após um Find manual de título que não existe, anotar `curDataView.recordAction` e `curDataView.find`. Se o valor não casar com `NO_RECORDS`, o resultado será `sem-resultado`; ajustar a regra somente com essa evidência.
- [ ] **Pós-Find:** a tela disponibiliza `num_duplicata.` e os demais campos dentro de 5 s e a leitura estabiliza (duas leituras iguais).
- [ ] **Campos:** conferir a lista de `ausentes`/`ocultos` e o conteúdo de `descrsit.`, `cobr_externa.` e `cobr_ext_desc*.`; confirmar o significado dos campos FIDC e checkbox/radio.
- [ ] **Mensagens modais:** verificar se "cliente não cadastrado"/"título inexistente" exibem diálogo que bloqueie a Nova consulta seguinte. Se bloquear, o lote termina com `erro` (falha segura) e o fluxo precisa ser ajustado com evidência.
- [ ] **Lote:** um lote curto (3 títulos, um deles inexistente) e a interrupção por Esc; conferir que a tela fica utilizável e que o XHR da página volta ao normal (sem lentidão após o lote).
- [ ] **Duração e tempos:** medir o tempo por título; só depois avaliar reduzir `CONFIG_PADRAO`.

## 9. Referências

- [AGENTS.md](../AGENTS.md) · [Guia transversal](guia-automacao-tampermonkey-systextil.md) · [Referência técnica NXJ](referencia-tecnica-nxj-systextil.md) (seção 7, Consulta de títulos, e seção 12, níveis de risco).
- [Segunda via automática](transferencia-crm-systextil.md): origem da sequência de foco/escrita/confirmação NXJ reaproveitada (código duplicado de propósito: os userscripts são independentes).

## 10. Correções registradas

- **0.1.0 (mesma branch):** `Cannot read properties of undefined (reading 'disabled')` ao clicar em Consultar. Causa: `Array.from(Set)` devolve vazio porque o Systextil sobrescreve `Array.from`; a localização de `btnClearToFind.`/`btnFind.` pegava `undefined`. Trocado por array simples; testes de regressão (sobrescrita de `Array.from` e ausência de `Array.from`/spread de `Set` no código). Não validado no ERP real.
- **0.1.0 (mesma branch), compacto:** durante o lote o popup virava um fundo escuro de tela cheia e escondia o Systextil. Agora vira um cartão no canto com fundo transparente (um escudo invisível ainda bloqueia cliques) mostrando o título e a etapa atuais; ao terminar volta a abrir com os resultados. Há botão Minimizar/Expandir.
- **0.1.0 (mesma branch), Empresa:** no ERP real o lote parou com "não enviou o comando NXJ esperado (saída do campo Empresa)… nenhum POST NXJ observado". Causa **não confirmada**; hipótese: a tela já traz a empresa em uso e reescrever o mesmo valor não gera comando. Agora, se `codigo_empresa.` já tem o valor pedido **e** `nome_empresa.` está carregado, o campo não é reescrito (a evidência é o valor visível + o nome). Se a empresa for diferente ou sem nome carregado, continua escrevendo e exigindo confirmação NXJ. O erro de saída ausente passou a informar, sem dados do título: se o foco foi aplicado ao campo seguinte, se o documento tem foco e quantas requisições NXJ o monitor viu no lote (zero no lote inteiro indicaria que o monitor não enxerga o tráfego do ERP).
