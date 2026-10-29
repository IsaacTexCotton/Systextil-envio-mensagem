# Systextil — automação assistida por Tampermonkey

Userscripts pequenos e explícitos para reduzir trabalho repetitivo no Systextil. O código não deve executar consultas, enviar mensagens nem gravar dados sem ação explícita do operador.

## Script: Parâmetros da Régua de Cobrança

Arquivo: [userscripts/systextil-parametros-regua.user.js](userscripts/systextil-parametros-regua.user.js)

### O que faz

- Mostra um painel com os dez parâmetros: início e fim para as faixas de 2, 6, 10, 15 e 18 dias.
- Usa a regra operacional semanal para a faixa de 2 dias: segunda busca quinta; terça busca sexta; quarta busca sábado, domingo e segunda; quinta busca terça; sexta busca quarta.
- Calcula o prazo do 6º dia somando seis dias corridos ao vencimento. Se o prazo cair em sábado ou domingo, passa para segunda-feira. Se a data resultante for feriado, a regra configurada procura a próxima segunda-feira não feriada.
- Faz busca reversa por datas de vencimento que resultem no prazo final selecionado.
- Calcula as faixas de 10, 15 e 18 dias por dias corridos, sem ajuste por fim de semana ou feriado.
- Apresenta uma tabela de conferência e um resumo copiável.
- Oferece um botão explícito para preencher campos identificados sem ambiguidade. Os campos são procurados novamente quando o botão é clicado; o script também tenta percorrer frames de mesma origem.

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

O userscript está restrito ao endereço http://systextil.texcotton.com.br/systextil/*. Revise o endereço alvo antes de instalar em outro ambiente.

## Regras de datas

### Faixa de 2 dias — calendário operacional do ERP

| Dia da execução | Janela de vencimento |
|---|---|
| Segunda-feira | Quinta-feira |
| Terça-feira | Sexta-feira |
| Quarta-feira | Sábado a segunda-feira (três datas) |
| Quinta-feira | Terça-feira |
| Sexta-feira | Quarta-feira |

Esse mapeamento é a regra operacional informada para o ERP, não uma subtração genérica de dois dias. A janela de quarta-feira tem três datas deliberadamente.

### Prazo do 6º dia

1. O vencimento é o dia zero.
2. São somados seis dias corridos.
3. Se o prazo cair em sábado ou domingo, passa para segunda-feira.
4. Se a data do prazo ou a segunda-feira resultante for feriado, procura-se a próxima segunda-feira não feriada.
5. A janela é obtida por busca reversa: o cálculo testa datas anteriores e identifica quais datas de vencimento resultam na data de referência.

### Faixas corridas

Para 10, 15 e 18 dias, início e fim são a mesma data: referência menos a quantidade de dias corridos. Não se aplica ajuste de fim de semana ou feriado.

### Feriados

O código calcula feriados nacionais fixos e datas móveis: Carnaval, Sexta-feira Santa e Corpus Christi. A lista adicional está vazia por padrão. As datas de 05/06/2026 e 02/09/2026 citadas na planilha não são ativadas sem confirmação de que devem ser feriados para o processo. Feriados duplicados são eliminados pelo conjunto de datas.

## Qualidade e testes locais

O cálculo está separado da interação com o formulário e é exposto numa API de diagnóstico somente leitura, chamada window.__systextilParametrosReguaDebug. Essa API não preenche campos nem executa consultas.

Os testes usam o runner nativo do Node.js e não dependem de bibliotecas externas. Com Node.js 18 ou superior instalado, execute **npm test** na raiz do repositório.

**Não há CI/CD nem workflows automatizados neste repositório.** Os testes devem ser executados localmente antes de enviar uma alteração.

## Princípios de contribuição

- Separar cálculo, preenchimento de campos e execução de consulta.
- Nunca executar ações de negócio automaticamente.
- Se houver mais de um campo compatível, não preencher silenciosamente; informar a ambiguidade.
- Não registrar nomes, credenciais ou dados de cliente no console.
- Manter pequenas alterações, documentação das regras e testes de regressão para dias da semana, fins de semana, feriados e busca reversa.
