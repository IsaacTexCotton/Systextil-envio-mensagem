# Systextil — automações Tampermonkey

Userscripts para reduzir trabalho repetitivo no Systextil, mantendo uma autorização explícita para ações comerciais.


## Prorrogação de títulos — lote

**Userscript independente:** [userscripts/systextil-prorrogacao-titulos.user.js](userscripts/systextil-prorrogacao-titulos.user.js) · v0.1.1.

- Recebe uma linha por título/parcela no formato \`TITULO;PARCELA\`; a data pode ser comum ao lote ou individual por linha.
- Substitui \`Compl.hist\` em \`forms.crec.crec_f030\` e grava a data de prorrogação e Mot \`01\` na linha encontrada em \`forms.crec.crec_f035\`.
- Exige correspondência única da parcela na grade, confirmação NXJ e releitura na Consulta antes de avançar ao próximo item.
- O executor é uma sigla configurável, não fixa. Motivo e autorização são opcionais. O texto de histórico não pode ultrapassar 60 caracteres.
- Não bloqueia títulos vencidos. A gravação ocorre em duas telas e não tem rollback automático; qualquer estado parcial ou indeterminado interrompe o lote.

Documentação, evidências de telas/atalhos, formato do histórico e pendências de homologação: [docs/prorrogacao-titulos.md](docs/prorrogacao-titulos.md).

**Atenção:** a captura confirmou F1, F2, os comandos NXJ e o resultado manual de F9. A aceitação de eventos de teclado sintéticos ainda depende de homologação no Systextil real. Não considere a automação pronta para produção antes de validar um único título autorizado.

## Segunda via automática — SmartTable → Systextil

**Instalação única:** [userscripts/systextil-segunda-via.user.js](userscripts/systextil-segunda-via.user.js) · v1.0.6.

O mesmo userscript funciona no CRM e no Systextil. O clique em **Enviar ao Systextil** no SmartTable é a única autorização humana necessária. Depois disso, o script:

1. Recebe e valida o título e a parcela transferidos pelo SmartTable.
2. Preenche os campos reais `num_duplicata.` e `seq_duplicatas.` diretamente no Systextil, usando a sequência de comandos NXJ.
3. Exige a confirmação NXJ do título e da parcela antes de acionar Find; sem os dois filtros confirmados, interrompe sem consultar.
4. Confere título, parcela e cliente antes de acionar **Emite boleto** uma única vez.
5. Abre **Processos agendados**, aciona novamente o sininho `procAgendados`, aguarda a grade atualizar e acompanha mensagens intermediárias até a confirmação explícita de sucesso ou um estado terminal/indeterminado.
6. Obtém o PDF autenticado somente após a confirmação, valida a origem e o conteúdo binário e inicia o download para a pasta padrão do navegador.

Não são criados painéis flutuantes, campos auxiliares, janelas de conferência ou etapas de F7 manual. O código antigo da ponte, do orquestrador e do helper foi consolidado no userscript único.

**Download:** usa `GM_xmlhttpRequest` para obter o PDF com a sessão do Systextil e `GM_download` para salvar com `saveAs: false`. Não exige PowerShell, serviço local, chave de pareamento ou pasta especial. O destino é a pasta padrão de Downloads configurada no navegador. Requer Tampermonkey 5.4.6226 ou superior para baixar Blob/File. No modo Browser API do Tampermonkey, conceda a permissão de Downloads e autorize a extensão `.pdf`; esse modo aplica `saveAs: false` e `conflictAction: "uniquify"`. O nome é preservado e conflitos recebem sufixos para não sobrescrever arquivos.

**Instalação e atualização:** instale somente `systextil-segunda-via.user.js` no Tampermonkey e habilite-o no CRM e no Systextil. Os três userscripts antigos foram desativados por metadados e não devem ser reativados. Depois de instalar o novo, remova ou desative as entradas antigas no Tampermonkey para evitar confusão.

**Conferência da versão instalada:** a `main` integra a v1.0.5 pela PR #39. Esta branch propõe a v1.0.6. Após a integração e atualização, confira o cabeçalho `@version` da entrada instalada, desative/remova cópias antigas e confirme a versão efetivamente instalada; não infira a versão pelo nome do arquivo.

**Proteções operacionais:** confirmação NXJ obrigatória dos dois campos antes do Find, correspondência única, conferência de título/parcela/cliente, trava contra emissão repetida, identificação inequívoca do processo, validação do PDF e bloqueio de repetição quando o resultado do download é indeterminado. Um timeout após clicar em **Emite boleto** não prova que a emissão falhou; nesses casos o fluxo não emite novamente. Um resultado de download indeterminado exige conferir a pasta Downloads antes de uma nova tentativa.

Documentação da integração: [docs/transferencia-crm-systextil.md](docs/transferencia-crm-systextil.md). Histórico técnico e riscos: [docs/segunda-via-boleto.md](docs/segunda-via-boleto.md).

**Estado da versão 1.0.4 na main:** integrada pela PR [#37](https://github.com/IsaacTexCotton/Systextil-envio-mensagem/pull/37) em 09/11/2026. Mensagens vazias, intermediárias ou desconhecidas em Processos agendados permanecem em acompanhamento; marcadores explícitos de falha encerram a execução. A grade é atualizada a cada quatro segundos, por até três minutos. A emissão não é repetida e o PDF só é liberado após sucesso explícito. A PR registrou parse sintático e dez verificações direcionadas aprovadas; `npm run verify` não foi executado e a homologação no Chrome/Tampermonkey/Systextil reais continua pendente. Não use emissão extra para testar.

**Versão 1.0.5 — PR #39:** integrada à `main` em 09/11/2026. Atualiza Processos agendados pelo sininho `procAgendados`, aguarda a renderização da grade e captura as confirmações NXJ de título/parcela antes da escrita. A PR registrou 20 verificações direcionadas; `npm run verify` e a homologação no ERP real ainda estavam pendentes naquela revisão.

**Correção proposta na v1.0.6:** diferencia a existência de um registro persistido de uma execução comprovadamente ativa. O bloqueio de resultado incerto continua sem expiração automática; o operador recebe a opção do menu Tampermonkey **Segunda via: liberar bloqueio após conferência manual**, que exige confirmação e só remove estado local depois da conferência de Processos agendados e Downloads. Isso não cancela nem altera processos no ERP.

## Desenvolvimento e testes

Para qualquer nova automação no ERP, leia primeiro o [AGENTS.md](AGENTS.md), o [guia transversal de Tampermonkey](docs/guia-automacao-tampermonkey-systextil.md) e a [referência técnica NXJ e de telas](docs/referencia-tecnica-nxj-systextil.md). A referência NXJ reúne campos e comandos observados na Consulta de títulos e na Baixa de Títulos por Seleção, além dos limites conhecidos de Processos agendados. Os achados não são universais: confirme a visão, os campos e a sequência na tela de destino.

Com Node.js 18 ou superior, na raiz do repositório:

```powershell
npm run verify
```

O comando verifica a sintaxe de todos os userscripts e executa a suíte nativa do Node.js. Não instala dependências. Para executar somente os testes:

```powershell
npm test
```

**Não há CI/CD neste repositório.** A verificação deve ser executada localmente antes de integrar alterações.

## Script: Parâmetros da Régua de Cobrança

Arquivo: [userscripts/systextil-parametros-regua.user.js](userscripts/systextil-parametros-regua.user.js)

### O que faz

- Mostra um painel com os dez parâmetros: início e fim para as faixas de 2, 6, 10, 15 e 18 dias.
- Usa a regra operacional semanal para a faixa de 2 dias quando não houver exceção de feriado aplicável: segunda busca quinta; terça busca sexta; quarta busca sábado, domingo e segunda; quinta busca terça; sexta busca quarta.
- Aplica uma tabela explícita de exceções de feriado para as réguas de 2º e 6º dia, baseada nos 18 cenários documentados abaixo. As janelas são relativas à data do feriado, não a datas literais de 2026.
- Quando não há exceção para o 6º dia, mantém a regra padrão de vencimento + 6 dias corridos, com prorrogação de sábado/domingo para segunda e tratamento de feriado segundo a regra atual. Em seguida, faz busca reversa por vencimentos associados à referência.
- Se a busca reversa retornar datas em blocos separados, deixa Início/Fim do 6º dia em branco e informa o motivo. Isso evita que um intervalo único inclua vencimentos não associados ao mesmo prazo.
- Calcula as faixas de 10, 15 e 18 dias por dias corridos, sem ajuste por fim de semana ou feriado.
- Apresenta uma tabela de conferência e um resumo copiável.
- Oferece um botão explícito para preencher os parâmetros da grade SmartClient (`parameterTab`). As linhas são identificadas pelo rótulo e editadas pela API pública da grade; o script verifica o valor renderizado antes de contar o preenchimento.
- Se uma regra não produzir data, a célula correspondente é limpa e verificada para evitar manter um valor antigo. Quando a grade é encontrada mas a API não está acessível, não tenta preencher o único `<input>` visível.
- Mantém a busca genérica por campos para telas compatíveis alternativas e percorre frames de mesma origem.

### O que não faz

- Não submete a consulta nem clica nos botões de execução do ERP.
- Não envia mensagens nem grava dados comerciais no Systextil.
- Não assume que um campo foi preenchido: informa quantos campos foram localizados e quais ficaram sem preenchimento.
- Não ativa automaticamente feriados locais/emendas ainda não confirmados. Essas datas permanecem desativadas na configuração.
- Não envia dados da página para serviços externos.

### Instalação manual

1. Abra o Tampermonkey no Chrome.
2. Crie um script novo e copie o conteúdo de userscripts/systextil-parametros-regua.user.js.
3. Salve o script e recarregue a tela da consulta no Systextil.
4. Confira a data de referência e os valores exibidos no painel.
5. Clique em **Preencher campos encontrados** somente depois de validar os valores.
6. Confira os campos no ERP e execute a consulta manualmente.

O cabeçalho do userscript inclui `@updateURL` e `@downloadURL` apontando para a versão `main`; as atualizações automáticas ficam disponíveis depois que a versão corrigida for integrada à `main`. Para testar antes disso, instale manualmente o arquivo da branch do PR de correção.

O userscript é executado em http://systextil.texcotton.com.br/systextil/* e https://systextil.texcotton.com.br/systextil/*. O cabeçalho e a API de diagnóstico expõem a versão instalada para facilitar a confirmação da atualização. Revise os endereços alvo antes de instalar em outro ambiente.

## Regras de datas

### Matriz operacional de feriados

A tabela de referência é a matriz fornecida pelo usuário. Cada linha relaciona o dia da execução ao conteúdo de **COBRAR**; as linhas destacadas em vermelho como **SEM EXPED.** significam que não há expediente. O código foi transcrito para 55 regras (2º e 6º dia, feriado de segunda a sexta-feira), usando offsets de calendário relativos à data real do feriado.

Em todas as linhas, **F** é a data do feriado. A data de referência é relativa a F; os dias de cobrança são interpretados como as datas anteriores/posteriores indicadas na matriz.

#### Feriado na segunda-feira

| Execução | 2º dia — cobrar | 6º dia — cobrar |
|---|---|---|
| Segunda (F) | SEM EXPED. | SEM EXPED. |
| Terça (F+1) | Quinta | Domingo a quarta |
| Quarta (F+2) | Sexta | Quinta |
| Quinta (F+3) | Sábado a terça | Sexta |
| Sexta (F+4) | Quarta | Sábado |

#### Feriado na terça-feira

| Execução | 2º dia — cobrar | 6º dia — cobrar |
|---|---|---|
| Segunda (F−1) | Quinta | Domingo a terça |
| Terça (F) | SEM EXPED. | SEM EXPED. |
| Quarta (F+1) | Sexta | Quarta e quinta |
| Quinta (F+2) | Sábado a segunda | Sexta |
| Sexta (F+3) | Terça e quarta | Sábado |

#### Feriado na quarta-feira

| Execução | 2º dia — cobrar | 6º dia — cobrar |
|---|---|---|
| Segunda (F−2) | Quinta | Domingo a terça |
| Terça (F−1) | Sexta | Quarta |
| Quarta (F) | SEM EXPED. | SEM EXPED. |
| Quinta (F+1) | Sábado a segunda | Quinta e sexta |
| Sexta (F+2) | Terça e quarta | Sábado |

#### Feriado na quinta-feira

| Execução | 2º dia — cobrar | 6º dia — cobrar |
|---|---|---|
| Segunda (F−3) | Quinta | Domingo a terça |
| Terça (F−2) | Sexta | Quarta |
| Quarta (F−1) | Sábado a segunda | Quinta |
| Quinta (F) | SEM EXPED. | SEM EXPED. |
| Sexta (F+1) | Terça | Sexta e sábado |
| Segunda seguinte (F+4) | Quarta e quinta | — |
| Terça seguinte (F+5) | Quinta e sexta | — |

#### Feriado na sexta-feira

| Execução | 2º dia — cobrar | 6º dia — cobrar |
|---|---|---|
| Segunda (F−4) | Quinta | Domingo a terça |
| Terça (F−3) | Sexta | Quarta |
| Quarta (F−2) | Sábado a segunda | Quinta |
| Quinta (F−1) | Terça | Sexta |
| Sexta (F) | SEM EXPED. | SEM EXPED. |
| Segunda seguinte (F+3) | Quarta | Sábado a terça |
| Terça seguinte (F+4) | Quinta e sexta | — |

Quando mais de um feriado próximo gerar regras aplicáveis, janelas sobrepostas ou adjacentes são combinadas; janelas separadas bloqueiam o preenchimento para evitar uma faixa que cobre datas indevidas. Se a própria data de referência for feriado, **SEM EXPED.** prevalece e o script não altera nenhum campo.

Quando não há regra de feriado aplicável, o script mantém o mapeamento semanal padrão para o 2º dia e a busca reversa de vencimento + 6 dias para o 6º dia. Esse fallback não substitui nenhuma linha aplicável da matriz.

### Faixa semanal padrão do 2º dia — sem exceção de feriado

| Dia da execução | Janela de vencimento |
|---|---|
| Segunda-feira | Quinta-feira |
| Terça-feira | Sexta-feira |
| Quarta-feira | Sábado a segunda-feira |
| Quinta-feira | Terça-feira |
| Sexta-feira | Quarta-feira |

### Prazo padrão do 6º dia — sem exceção de feriado

1. O vencimento é o dia zero.
2. São somados seis dias corridos.
3. Se o prazo cair em sábado ou domingo, passa para segunda-feira.
4. Se a data do prazo ou a segunda-feira resultante for feriado, procura-se a próxima segunda-feira não feriada.
5. A janela é obtida por busca reversa. Esse cálculo só é utilizado quando nenhuma regra da matriz de feriados se aplica.

### Faixas corridas de 10, 15 e 18 dias

Para 10, 15 e 18 dias, início e fim são a mesma data: referência menos a quantidade de dias corridos. Não se aplica ajuste de fim de semana ou feriado.

### Calendário de feriados

O código calcula feriados nacionais fixos e datas móveis: Carnaval, Sexta-feira Santa e Corpus Christi. A lista adicional de feriados locais está vazia por padrão. As datas de 05/06/2026 e 02/09/2026 não são ativadas sem confirmação. Feriados duplicados são eliminados pelo conjunto de datas.

## Qualidade e testes locais

O cálculo está separado da interação com o formulário e é exposto numa API de diagnóstico somente leitura, chamada window.__systextilParametrosReguaDebug. Essa API não preenche campos nem executa consultas.

Os testes usam o runner nativo do Node.js e não dependem de bibliotecas externas. Incluem a validação das 55 linhas da matriz de feriados, o cenário de referência 03/11/2026 após o feriado de 02/11, o bloqueio de preenchimento em dias SEM EXPED., a união de janelas sobrepostas no Carnaval e regressões das regras padrão. Com Node.js 18 ou superior instalado, execute o comando padrão abaixo na raiz do repositório:

```bash
npm run verify
```

Ele verifica a sintaxe de todos os arquivos `*.user.js` em `userscripts/` e, se todos compilarem, executa a suíte completa com `node --test`. Usa apenas Node.js nativo, não instala dependências e retorna erro quando alguma etapa falha. Para executar somente os testes, continue usando `npm test`.

**Não há CI/CD nem workflows automatizados neste repositório.** A verificação deve ser executada localmente antes de enviar uma alteração.

## Governança de desenvolvimento com IA

As instruções permanentes para agentes estão em [AGENTS.md](AGENTS.md). O GitHub Copilot também recebe [instruções específicas do repositório](.github/copilot-instructions.md). O checklist de revisão, segurança, privacidade e exposição de informações internas está em [docs/revisao-e-seguranca.md](docs/revisao-e-seguranca.md), e as PRs usam [.github/pull_request_template.md](.github/pull_request_template.md).

## Princípios de contribuição

- Separar cálculo, preenchimento de campos e execução de consulta.
- Nunca executar ações de negócio automaticamente.
- Se houver mais de um campo compatível, não preencher silenciosamente; informar a ambiguidade.
- Não registrar nomes, credenciais ou dados de cliente no console.
- Manter pequenas alterações, documentação das regras e testes de regressão para dias da semana, fins de semana, feriados e busca reversa.
