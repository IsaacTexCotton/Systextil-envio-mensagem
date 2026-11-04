# Segunda via de boleto — levantamento técnico

**Status:** Fase 2 implementada em branch de desenvolvimento; preenchimento assistido aguardando validação no Systextil  
**Última atualização:** 2026-11-04  
**Escopo:** obter o PDF de um boleto já existente no Systextil e salvá-lo com nome padronizado em uma pasta de rede.

## 1. Objetivo e limites

Criar um userscript Tampermonkey independente para auxiliar a obtenção da segunda via de um boleto já existente, a partir do número do título e da parcela.

O arquivo deve ser salvo exclusivamente na pasta:

`V:\Financeiro\Contas à Receber\Administrativo - Atualização\Banco\Boletos (2ª via)`

Padrão de nome:

`[Começo da razão social] - [NÚMERO DO TÍTULO].[PARCELA].pdf`

Exemplo fictício:

`Joaozin da silva - 936312.01.pdf`

### Fora do escopo

- Não gerar linha digitável ou código de barras.
- Não anexar o PDF ao CRM.
- Não gravar observações ou outros dados comerciais no CRM.
- Não criar um novo boleto quando o objetivo for apenas obter a segunda via de um boleto já emitido.
- Não enviar dados, credenciais, cookies ou informações de sessão a serviços externos.

## 2. Fluxo operacional conhecido

O procedimento manual observado no ERP é:

1. Abrir **Consulta de títulos**.
2. Preencher o número do título e, quando necessário, a parcela.
3. Executar a consulta com **F7**.
4. Acionar **Emite boleto**.
5. Abrir **Processos agendados** pelo botão `procAgendados`.
6. Identificar o processo de emissão correspondente ao horário em que a emissão foi solicitada.
7. Confirmar que o processo terminou com sucesso.
8. Selecionar o processo e acionar **Download**.
9. Salvar o PDF na pasta de boletos com o nome padronizado.

A automação deve evitar a seleção por “primeiro” ou “mais recente” sem validação. Se houver mais de um processo elegível ou qualquer inconsistência, deve interromper e solicitar conferência manual.

## 3. Evidências técnicas da tela de consulta

Tela/formulário observado: `forms.crec.crec_f090`.

| Campo/controle | Identificador observado | Situação |
|---|---|---|
| Número do título | `input[name="num_duplicata."]` | Identificado |
| Parcela | `input[name="seq_duplicatas."]` | Identificador candidato; rótulo ainda precisa ser confirmado |
| Emitir boleto | `id="BTNEmetirBoletos."`, `name="CMDEmetirBoletos"` | Identificado |
| Processos agendados | `id="procAgendados"` | Identificado no frame de toolbar |

O campo `seq_duplicatas.` ainda não deve ser tratado como parcela confirmada antes de verificar seu rótulo/descrição na própria tela.

A razão social ainda não teve sua origem de dados confirmada. O nome do cliente exibido no ERP não deve ser presumido como razão social sem validar o campo e um caso real.

## 4. Evidências técnicas de Processos agendados

Formulário da grade:

- Área repetida: `RepeatingArea1.`.
- Formulário: `NXJForm`.
- Método: `GET`.
- Ação observada: `/systextil/forms.systextil.senha.nxj`.

Controles observados:

| Ação | Identificador | Nome |
|---|---|---|
| Visualizar | `RESULTS:VISUALIZAR.` | `cmdOpenLink` |
| Download | `RESULTS:DOWNLOAD.` | `cmdDownloadReport` |
| Imprimir | `RESULTS:IMPRIMIR.` | `cmdPrint` |
| Download ZIP | `RESULTS:DOWNLOAD1.` | `cmdDownloadZip` |

O botão **Download** é um comando do `window.parent.clientManager.doCommand(this)`. O comando foi observado habilitado em um processo selecionado. O teste definitivo de obtenção do PDF, entretanto, foi feito usando a URL produzida pelo helper do próprio Systextil com `GM_download`, não clicando programaticamente no comando nativo.

### Campos por registro

Foram observados os campos repetidos:

- `CODIGO_RELATORIO.`
- `titulo.`
- `DATA_EXECUCAO.`
- `MSG_EXCEPTION.`

Os registros seguintes usam sufixos numéricos (`.0`, `.1`, etc.). O primeiro registro não tem sufixo.

Mapeamento observado após seleção manual de registros:

| Campo | Índice visual | `DataView.currentRow` | `recordNumber` |
|---|---:|---:|---:|
| Campo base, sem sufixo | 1 | 0 | 1 |
| Sufixo `.0` | 2 | 1 | 2 |
| Sufixo `.1` | 3 | 2 | 3 |

Esse mapeamento precisa ser revalidado na implementação usando o conteúdo do registro selecionado, e não classes CSS como `.row`, que foram observadas como alternância visual e não como estado de seleção.

Critérios candidatos para reconhecer o processo:

- Título do processo: `Emissão de boletos com registro`.
- Mensagem de sucesso observada: `Processo concluído com sucesso.`.
- Data/hora de execução comparada com o instante em que a operação foi solicitada.

A seleção automática só deve acontecer quando houver correspondência única e verificável. Se o status, título, horário ou registro selecionado não puderem ser validados, não baixar.

## 5. Mecanismo real de geração/entrega do PDF

O arquivo `/systextil/Static_Content/Download.js` foi inspecionado.

Funções relevantes:

- `doDownload()`: chama `getFileUrl()` e navega `frames[0].location.href` para a URL.
- `doOpen()`: chama `getFileUrl(true)` e abre uma nova janela.
- `getFileUrl(abrir)`: lê os campos da saída selecionada e configurações do relatório, monta a rota relativa `download/<arquivo>` e os parâmetros do relatório.
- `encontrarValorAtual(nome)`: procura primeiro no formulário e depois nos descritores do `clientManager`.

Para formato PDF, a URL pode incluir parâmetros como:

- `report`
- `ext`
- `layout` (quando presente)
- `program`
- `size`
- `fontSize`
- `orientation`
- `margins`

Exemplo técnico observado em um relatório já emitido (não fixar este nome no código):

`download/blt364193.pdf?report=blt364193.jrprint&ext=pdf&program=forms.crec.crec_e259&size=A4&fontSize=0&orientation=0&margins=10,10,10,10`

O helper `getFileUrl()` foi chamado em modo de leitura e retornou uma URL PDF válida. O formato retornado foi `pdf`, o caminho foi `/systextil/download/blt364193.pdf`, e os parâmetros incluíam `report`, `ext`, `program`, `size`, `fontSize`, `orientation` e `margins`.

## 6. Decisão técnica validada: usar GM_download

A estratégia de interceptar o clique do botão nativo foi descartada como desnecessária para o download personalizado.

O caminho validado é:

1. Obter a URL chamando o helper original `getFileUrl()` do Systextil.
2. Resolver a URL relativa contra a origem da página.
3. Validar que é uma rota PDF do próprio Systextil.
4. Passar a URL ao `GM_download` com nome de arquivo personalizado.
5. Usar `saveAs: false`, aproveitando a pasta padrão de downloads configurada no Chrome.

### Testes manuais já realizados

- A pasta padrão do Chrome foi configurada para a pasta de rede `V:\Financeiro\Contas à Receber\Administrativo - Atualização\Banco\Boletos (2ª via)`.
- A opção de perguntar onde salvar cada arquivo foi desativada.
- Um PDF já aberto pelo Systextil foi baixado e apareceu na pasta de rede.
- Um teste isolado de `GM_download` com nome customizado foi concluído corretamente.
- O teste com a URL real produzida por `getFileUrl()` baixou o PDF gerado pelo Systextil com o nome `TESTE - boleto Systextil.pdf` na pasta configurada.

Portanto, estão validados o acesso autenticado ao PDF pelo Tampermonkey, o nome personalizado e a pasta de destino padrão do Chrome.

### Restrições para a implementação

- Não codificar o nome `blt364193.pdf` nem qualquer URL de exemplo.
- Não codificar a pasta `V:\...` no parâmetro `name` do `GM_download`; usar somente o nome do arquivo e deixar o Chrome direcionar para sua pasta padrão.
- Restringir a URL à mesma origem do ERP e à rota de download PDF.
- Configurar permissões mínimas no cabeçalho do userscript; evitar `@connect *` quando o host do ambiente puder ser especificado.
- Tratar callbacks de sucesso, erro e timeout; impedir downloads concorrentes duplicados.

## 7. Arquitetura planejada

Criar um userscript independente, sem alterar o userscript de parâmetros da régua:

`userscripts/systextil-segunda-via-boleto.user.js`

Separar responsabilidades no próprio script ou em módulos de lógica pura:

1. **Descoberta de campos:** identificar número, parcela e nome/razão social com seletores e rótulos validados.
2. **Consulta assistida:** preencher somente depois de validação e não submeter sem ação explícita do operador.
3. **Emissão assistida:** exigir confirmação explícita antes de acionar a emissão, para evitar solicitações duplicadas.
4. **Detecção do processo:** registrar o instante da solicitação, identificar a linha por título, data/hora e resultado, e exigir correspondência única.
5. **Seleção e verificação:** selecionar o registro usando o mecanismo do ERP e conferir `currentRow`, `recordNumber` e valores do registro.
6. **Download:** chamar `getFileUrl()`, validar a URL e executar `GM_download` com o nome final.
7. **Auditoria local:** mostrar status ao operador sem registrar dados pessoais, valores de sessão ou parâmetros sensíveis.

O script deve funcionar apenas nas telas e frames necessários do Systextil, considerar a estrutura de frames de mesma origem e não depender de recarregar a página. Atualizar a página durante uma sessão ativa pode encerrar a sessão do ERP.

## 8. Regras de segurança e falha segura

- Não automatizar a emissão sem confirmação do operador.
- Não selecionar um processo por posição fixa ou apenas por ser o mais recente.
- Não baixar se houver zero ou mais de um processo compatível.
- Não baixar se `MSG_EXCEPTION.` não indicar sucesso.
- Não confiar em classes de estilo para determinar a linha selecionada.
- Não construir nomes de arquivo a partir de texto sem sanitizar caracteres inválidos do Windows (`<>:"/\\|?*`), espaços finais/pontos e nomes reservados.
- Limitar o tamanho do nome sem remover o identificador do título/parcela.
- Não incluir CNPJ, nome de cliente, credenciais, cookies, tokens ou conteúdo de formulário em logs.
- Em caso de erro ou ambiguidade, preservar a seleção atual e deixar o download manual disponível.
- Não incluir integração com CRM, armazenamento externo ou serviço de terceiros.

## 8.1. Descoberta adicional dos campos da consulta (04/11/2026)

Um diagnóstico posterior encontrou os seguintes nomes de campo na tela `forms.crec.crec_f090`:

| Campo | Interpretação provável | Confirmação |
|---|---|---|
| `nome_empresa.` | Nome/descrição da empresa emissora do ERP | Não é o campo de razão social do cliente; não usar para nome do boleto sem validação |
| `nome_cliente.` | Nome/descrição do cliente | Candidato para compor o nome do arquivo; confirmar se representa razão social ou nome fantasia |
| `seq_duplicatas.` | Sequência da duplicata | Ainda precisa de confirmação do rótulo e do valor de parcela |

**Limitação do diagnóstico:** o script usado comparou `label.htmlFor` com `campo.id`, mas os campos observados não possuem `id`; por isso, ele retornou a lista de labels do documento inteiro para cada campo. A saída não comprova a associação entre rótulo e campo. Não tratar a lista de labels como evidência de que `seq_duplicatas.` corresponde à parcela nem de que `nome_cliente.` contém a razão social.

O próximo diagnóstico deve inspecionar apenas os ancestrais e irmãos DOM dos campos alvo, removendo valores de inputs antes de exibir o HTML/texto, e avaliar o rótulo imediatamente associado. A confirmação final da razão social pode ser feita localmente no ERP sem expor o nome do cliente no relatório de diagnóstico.

## 8.2. Estrutura DOM dos campos (04/11/2026)

O diagnóstico estrutural confirmou que os quatro campos-alvo estão no formulário principal e são inputs de texto. Cada input está dentro de um `DIV` filho direto do formulário. Não há associação via `HTMLInputElement.labels` (`labelsAssociados: []`).

O formulário apresenta os rótulos em `DIVs` independentes. O diagnóstico anterior removeu os inputs antes de ler o texto e, por isso, não capturou a associação entre rótulo e campo. A listagem integral de filhos do formulário foi muito extensa e não é suficiente para mapear a posição individual de cada campo.

**Próxima inspeção:** obter o índice de `campo.parentElement` dentro de `campo.form.children` e exibir somente os poucos irmãos anteriores/posteriores, sem valores de inputs. Isso deve permitir relacionar `Nr título:` com `num_duplicata.`, conferir a sequência e localizar o campo de cliente.

## 8.3. Primeira implementação: leitura e prévia do nome (04/11/2026)

Foi adicionada a versão inicial:

`userscripts/systextil-segunda-via-boleto.user.js`

Versão: `0.1.0`.

### Mapeamento DOM observado

| Campo | Evidência estrutural | Interpretação e limite |
|---|---|---|
| `num_duplicata.` | Filho do formulário, logo após o `DIV` com rótulo `Nr título:` | Número do título confirmado |
| `seq_duplicatas.` | `DIV` imediatamente após o campo do número, mesma linha, largura aproximada de 20 px | Sequência/parcela provável; validar o valor em um título conhecido |
| `nome_cliente.` | Campo de texto logo após três campos identificados como componentes do CNPJ, na seção `Cliente:` | Nome/descrição do cliente; confirmar se o conteúdo é razão social |
| `nome_empresa.` | Campo após `codigo_empresa.`, na seção `Empresa:` | Empresa emissora do ERP; não é usado para nomear o boleto |

O diagnóstico é estrutural e não expôs valores preenchidos. Não foi identificado rótulo explícito chamado “Parcela” nem “Razão social”.

### Comportamento da versão 0.1.0

- Injeta um painel discreto na tela principal do Systextil.
- Lê `num_duplicata.`, `seq_duplicatas.` e `nome_cliente.` somente quando o operador clica em **Ler dados do título**.
- Exibe os dados lidos e uma prévia do nome: `Cliente - TITULO.PARCELA.pdf`.
- Sanitiza caracteres inválidos para nome de arquivo no Windows e limita o nome completo a 180 caracteres.
- Falha de forma explícita se formulário, campos ou valores obrigatórios estiverem ausentes ou ambíguos.
- Não executa F7, não clica em **Emite boleto**, não navega para Processos agendados e não baixa arquivo.
- Não salva dados em armazenamento persistente nem envia dados para fora do ERP.
- Usa uma API local de diagnóstico em `window.__systextilSegundaViaBoletoDebug` para testes das funções puras.

### Testes adicionados

Arquivo: `tests/segunda-via-boleto.test.js`.

Coberturas:
- nomes dos campos mapeados;
- padrão do nome do arquivo;
- remoção de caracteres inválidos do Windows;
- preservação de acentos;
- rejeição de campos obrigatórios ausentes ou com formato inesperado;
- limite de comprimento.

Os testes foram adicionados, mas ainda **não foram executados** nesta sessão: a tentativa de clonar o repositório no ambiente de execução falhou por indisponibilidade de resolução de `github.com`. Não declarar os testes como aprovados até executar `npm test` localmente (Node.js 18 ou superior).

## 8.4. Ativação sem recarregar a sessão (04/11/2026)

Após o teste da versão 0.1.0, foi identificado que a ativação automática em `document-idle` exigia que a página fosse recarregada depois da instalação/atualização do userscript. Isso não é aceitável no Systextil porque recarregar a tela pode encerrar a sessão autenticada.

A versão `0.1.1` alterou o cabeçalho para:

`// @run-at context-menu`

O script passa a ser iniciado sob demanda pelo popup/menu do Tampermonkey na aba ativa. Conforme o changelog oficial do Tampermonkey, scripts com `@run-at context-menu` podem ser iniciados pelo popup a partir da versão 5.6.6239 (25/06/2026). A versão 5.6.6242 (03/09/2026) contém correções posteriores do menu de contexto.

### Atalho de teclado

A versão `0.1.2` mantém essa execução sob demanda e registra um atalho de teclado após a primeira ativação:

`Ctrl + Alt + B`

### Instruções de uso

1. Salvar/atualizar a versão 0.1.2 no Tampermonkey.
2. Manter a aba e a sessão do Systextil abertas, sem recarregar.
3. Abrir a tela **Consulta de títulos**.
4. Clicar no ícone do Tampermonkey na barra do Chrome.
5. Selecionar **Systextil - Segunda Via de Boleto (conferência)** no popup.
6. O painel de conferência será inserido na página atual. Selecionar o item novamente alterna/fecha o painel se ele já estiver aberto.

Após a primeira ativação pelo popup, o atalho `Ctrl + Alt + B` abre ou fecha o painel enquanto a mesma aba/documento permanecer aberto. Para voltar a ativar depois de navegar para outro documento, execute novamente o script pelo popup do Tampermonkey.

Se o item não aparecer no popup, confirmar que o Tampermonkey está atualizado para 5.6.6239 ou superior e que o userscript está habilitado.

A alteração não muda a política de segurança da automação: a versão 0.1.2 continua sem enviar consulta, emitir boleto, abrir Processos agendados ou baixar arquivos.

## 8.5. Prefixo curto da razão social (04/11/2026)

A versão `0.1.3` ajusta a construção do nome de arquivo para usar somente o começo do nome/razão social, evitando nomes excessivamente longos.

Regra implementada:

- Limite do prefixo: **35 caracteres Unicode**.
- Prioriza palavras inteiras: não corta uma palavra quando já existe um prefixo anterior que cabe no limite.
- Acrescenta reticências (`…`) quando o nome original é maior que o prefixo exibido.
- Se a primeira palavra, sozinha, ultrapassar 35 caracteres, aplica truncamento por caracteres como fallback.
- Mantém número do título e parcela completos no sufixo.
- Mantém o limite geral de 180 caracteres para o nome completo do arquivo.

Exemplo:

Entrada:
`Confecções Industriais e Comércio de Tecidos Ltda.`

Nome final:
`Confecções Industriais e Comércio… - 936312.01.pdf`

A prévia do painel também mostra somente o início da razão social, e não o texto completo do campo.

O limite de 35 caracteres é uma configuração interna (`MAX_INICIO_RAZAO_SOCIAL`) e poderá ser ajustado depois de validar alguns nomes reais no uso operacional. Os testes verificam o limite, o corte em limite de palavra, as reticências e a preservação do identificador do título/parcela.

## 8.6. Atualização da versão ativa sem recarga (04/11/2026)

A versão `0.1.3` também trata atualização do userscript na aba atual. Ao executar a versão nova pelo popup do Tampermonkey:

- Se existir painel criado por versão anterior, ele é substituído imediatamente pelo painel da versão atual.
- O painel registra sua versão em `data-script-version`.
- O atalho `Ctrl + Alt + B` é registrado no objeto `window`, na fase de captura.
- O handler chama `stopImmediatePropagation()` ao reconhecer o atalho, evitando que listeners antigos registrados no `document` por versões anteriores também executem e alternem o painel duas vezes.
- A versão do handler é registrada em `window.__systextilSegundaViaBoletoShortcutVersion`, impedindo duplicação ao executar o script novamente.

Isso permite instalar/atualizar o userscript e ativar sua versão nova na aba já aberta, sem recarregar ou encerrar a sessão do Systextil.

## 8.7. Atualização automática pelo Tampermonkey (04/11/2026)

A versão `0.1.4` adiciona ao cabeçalho do userscript:

- `@version 0.1.4`;
- `@updateURL`, apontando para o arquivo oficial na branch `main`;
- `@downloadURL`, apontando para o mesmo arquivo oficial para obter a versão nova.

O Tampermonkey usa `@version` para identificar se há atualização. A documentação oficial descreve `@updateURL` como endereço consultado na verificação e `@downloadURL` como endereço de onde o script atualizado é baixado:
https://www.tampermonkey.net/documentation.php?locale=pt_BR

### Migração da versão 0.1.3

A versão 0.1.3 não possui `@updateURL` nem `@downloadURL`. Por isso, uma instalação já existente não conhece o endereço estável para buscar as próximas versões. É necessária uma atualização manual única para a versão 0.1.4, depois que esta alteração estiver integrada à branch `main`.

Após instalar a 0.1.4, as próximas versões poderão ser encontradas pelo comando de verificação de atualizações do Tampermonkey. Não será necessário copiar e reinstalar o código a cada versão. A atualização continua sujeita à disponibilidade do GitHub e à confirmação de atualização exibida pelo Tampermonkey.

**Importante:** enquanto esta alteração estiver apenas na branch do PR, o endereço configurado para `main` ainda não conterá a versão 0.1.4. Não orientar a atualização manual antes do merge. A instalação atual pode continuar usando a versão 0.1.3.

## 8.8. Fase 2 — preenchimento assistido da consulta (04/11/2026)

A versão \`0.2.0\` adiciona ao painel campos próprios para informar o número do título e a parcela/sequência.

### Comportamento

1. O operador informa o número do título e a parcela no painel.
2. O script valida os dois valores como identificadores não vazios com caracteres alfanuméricos, hífen ou sublinhado. Os valores permanecem como texto para preservar zeros à esquerda.
3. O script localiza um único formulário que contenha os campos \`num_duplicata.\` e \`seq_duplicatas.\`.
4. Antes de preencher, confirma que os campos não estão desabilitados ou somente para leitura.
5. Preenche os dois campos, dispara eventos DOM \`input\` e \`change\` e confere se o ERP manteve os valores.
6. Se ocorrer falha, tenta restaurar os dois valores anteriores e informa o erro.
7. Após o preenchimento, o foco retorna ao campo de número do título para facilitar a operação manual.

### Limites de segurança

- O script **não envia F7**, não submete o formulário e não executa a consulta.
- O operador deve conferir os valores na tela do Systextil e pressionar F7 manualmente.
- O painel mantém o aviso de que \`seq_duplicatas.\` ainda precisa de confirmação operacional como parcela.
- O script não altera o campo do cliente, não emite boleto, não abre Processos agendados e não baixa arquivos.
- A leitura dos dados retornados pelo ERP continua disponível pelo botão **Ler dados do título (após F7)**.

### Critérios de validação no ERP

1. Abrir Consulta de títulos sem recarregar a sessão.
2. Ativar o painel pelo popup do Tampermonkey.
3. Informar um título conhecido e uma parcela conhecida.
4. Clicar em **Preencher campos no Systextil**.
5. Conferir se o número e a sequência foram colocados nos campos corretos, inclusive preservando zeros à esquerda.
6. Confirmar visualmente que o foco está no número do título e pressionar F7 manualmente.
7. Após o retorno do ERP, clicar em **Ler dados do título (após F7)** e conferir se título, sequência e cliente correspondem ao registro consultado.

A aprovação desta fase depende desse teste manual. A identificação do campo de parcela permanece provisória até a confirmação do operador no ERP.

### Testes automatizados adicionados

- preservação de zeros à esquerda;
- rejeição de identificadores vazios ou com caracteres não permitidos;
- preenchimento dos dois campos e disparo de eventos \`input\`/\`change\`;
- foco no campo do título;
- interrupção quando mais de um formulário é compatível;
- restauração dos valores anteriores em caso de falha parcial;
- ausência de submissão ou envio sintético de F7.

Os testes foram adicionados ao arquivo \`tests/segunda-via-boleto.test.js\`. Ainda precisam ser executados com \`npm test\` em Node.js 18+.

## 8.9. Preenchimento automático de zeros à esquerda (04/11/2026)

A versão \`0.2.1\` normaliza os identificadores numéricos antes de preencher a consulta:

- Título: largura padrão de **8 dígitos**.
- Parcela/sequência: largura padrão de **2 dígitos**.
- Se o campo do Systextil declara \`maxlength\` válido (entre 1 e 20), o script respeita essa largura declarada em vez do padrão.
- Códigos apenas numéricos recebem zeros à esquerda com \`padStart\`.
- Valores que já estão completos permanecem inalterados.
- Identificadores alfanuméricos são mantidos, sem completar zeros.
- Se o valor tiver mais caracteres do que a largura do campo, o preenchimento é interrompido. Nenhum dígito é truncado.

Exemplos com os tamanhos padrão:

| Entrada | Valor preenchido |
|---|---|
| Título \`936520\` | \`00936520\` |
| Parcela \`1\` | \`01\` |
| Título \`00936520\` | \`00936520\` |
| Parcela \`01\` | \`01\` |

O painel exibe os valores normalizados após o preenchimento para facilitar a conferência. A consulta continua manual: o script não envia F7.

### Testes adicionados

- preenchimento de título de seis dígitos com zeros à esquerda;
- preenchimento de parcela de um dígito;
- preservação dos valores que já estão completos;
- prioridade ao \`maxlength\` configurado no campo do ERP;
- rejeição de valores maiores que o campo, sem truncamento.

## 9. Próximas pendências após a Fase 2

1. Confirmar no ERP, com um título conhecido, que `seq_duplicatas.` corresponde à parcela.
2. Confirmar a origem da razão social usada no nome do arquivo, distinguindo razão social de nome fantasia.
3. Confirmar a relação entre o momento em que se aciona **Emite boleto** e a data/hora que aparece na grade de processos.
4. Implementar uma rotina de seleção única e validar a correspondência entre os campos da grade e `DataView.currentRow`.
5. Criar testes locais para normalização de nome, caracteres inválidos, correspondência de processo, ambiguidade, estados de sucesso/falha e construção/validação da URL.
6. Fazer primeiro um teste com processo já concluído, sem emitir outro boleto; depois, com autorização do operador, validar o ciclo completo com um único título controlado.

## 10. Validação e desenvolvimento no repositório

O repositório usa Node.js nativo e `node --test`; o `package.json` exige Node.js 18 ou superior. O README registra que o projeto não possui CI/CD e que os testes são executados localmente.

Para a nova funcionalidade:

- Manter a implementação e os testes isolados da régua de cobrança.
- Criar testes unitários sem dependências externas para as funções puras.
- Não afirmar que testes passaram sem executá-los.
- Atualizar esta documentação conforme os campos forem confirmados.
- Não integrar na `main` antes de validar o userscript no Systextil.

## 11. Estado atual resumido

| Item | Estado |
|---|---|
| Fluxo operacional manual | Mapeado |
| Campo do número do título | Identificado |
| Campo da parcela | `seq_duplicatas.` preenchido em modo assistido; confirmação operacional pendente |
| Campo da razão social | Pendente |
| Identificação dos controles da grade | Mapeada |
| Mensagem de sucesso | Identificada |
| Geração da URL PDF pelo ERP | Validada |
| Download autenticado com `GM_download` | Validado |
| Nome personalizado e pasta de rede | Validados |
| Seleção automática do processo | Pendente |
| Userscript da segunda via | v0.2.1: painel sob demanda, prefixo abreviado, atualização automática e preenchimento assistido de título/parcela; F7 permanece manual |
