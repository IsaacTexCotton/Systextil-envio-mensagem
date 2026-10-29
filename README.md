# Systextil — automação assistida por Tampermonkey

Userscripts pequenos e explícitos para reduzir trabalho repetitivo no Systextil. O código não deve executar consultas, enviar mensagens nem gravar dados sem ação explícita do operador.

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

O userscript está restrito ao endereço http://systextil.texcotton.com.br/systextil/*. Revise o endereço alvo antes de instalar em outro ambiente.

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

Os testes usam o runner nativo do Node.js e não dependem de bibliotecas externas. Incluem a validação das 55 linhas da matriz de feriados, o cenário de referência 03/11/2026 após o feriado de 02/11, o bloqueio de preenchimento em dias SEM EXPED., a união de janelas sobrepostas no Carnaval e regressões das regras padrão. Com Node.js 18 ou superior instalado, execute **npm test** na raiz do repositório.

**Não há CI/CD nem workflows automatizados neste repositório.** Os testes devem ser executados localmente antes de enviar uma alteração.

## Princípios de contribuição

- Separar cálculo, preenchimento de campos e execução de consulta.
- Nunca executar ações de negócio automaticamente.
- Se houver mais de um campo compatível, não preencher silenciosamente; informar a ambiguidade.
- Não registrar nomes, credenciais ou dados de cliente no console.
- Manter pequenas alterações, documentação das regras e testes de regressão para dias da semana, fins de semana, feriados e busca reversa.
