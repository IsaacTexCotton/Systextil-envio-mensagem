# Segunda via de boleto — levantamento técnico

> **Atualização da arquitetura (main v1.0.5 integrada pela PR #39 em 09/11/2026; v1.0.6 proposta nesta branch):** as seções anteriores deste documento registram decisões e implementações históricas das versões 0.x. A implementação integrada é o userscript único `userscripts/systextil-segunda-via.user.js`: não há painéis flutuantes, ponte separada, helper userscript ou auxiliar Windows. O PDF validado é enviado à pasta Downloads padrão do navegador. A v1.0.6 acrescenta recuperação manual de bloqueios locais persistidos, sem expiração automática de estados indeterminados. Consulte [transferencia-crm-systextil.md](transferencia-crm-systextil.md) e [referencia-tecnica-nxj-systextil.md](referencia-tecnica-nxj-systextil.md) para as instruções atuais.


**Base histórica:** a rotina NXJ v0.4.9 foi validada no Systextil real e evoluiu até o helper-base v0.6.0 na `main`. Esta branch propõe o helper-base v0.6.1, a ponte v0.2.0 e o orquestrador v0.2.0 para automatizar a cadeia completa. Ainda não integrada nem homologada operacionalmente.  
**Última atualização:** 2026-11-09

> Esta documentação preserva o histórico das fases anteriores. O estado de produção e as correções posteriores prevalecem sobre descrições históricas que indiquem versões anteriores como atuais. Para padrões transversais de automação e instruções para agentes de IA, consulte [guia-automacao-tampermonkey-systextil.md](guia-automacao-tampermonkey-systextil.md).  
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

## 8.10. Fase 3 — identificação de Processos agendados (04/11/2026)

A versão \`0.3.0\` adiciona a captura local da solicitação de emissão e um painel de análise da grade de Processos agendados.

### Captura da solicitação

- Ao ativar o userscript na tela Consulta de títulos, instala um listener de captura de clique para \`id="BTNEmetirBoletos."\` e \`name="CMDEmetirBoletos"\`.
- O listener registra o instante do clique e os valores atuais de título/parcela antes de o evento seguir para o Systextil.
- O listener não cancela, não simula e não repete o clique; a emissão continua sendo uma ação manual do operador.
- O registro é salvo em \`sessionStorage\` da origem do ERP, para ser lido na tela de Processos agendados na mesma sessão ou em janela aberta a partir dela.
- A solicitação expira após **30 minutos**, evitando reaproveitar um horário antigo para uma emissão posterior.
- O registro local contém somente horário, número do título, parcela e versão do userscript. Nenhum dado é transmitido para fora do navegador.

### Leitura da grade

A versão procura um único formulário com os campos repetidos documentados:

- \`titulo.\`: nome do processo;
- \`DATA_EXECUCAO.\`: data/hora de execução;
- \`MSG_EXCEPTION.\`: mensagem/resultado.

As linhas seguintes são mapeadas como \`titulo.0\`, \`titulo.1\` e assim por diante, acompanhando os campos de data/hora e mensagem. O mapeamento visual conhecido permanece: primeiro registro = linha 1 / \`currentRow=0\` / \`recordNumber=1\`; segundo registro = linha 2 / \`currentRow=1\` / \`recordNumber=2\`.

### Critérios de identificação

Um registro só é considerado candidato se:

1. O título do processo for exatamente \`Emissão de boletos com registro\` após normalização de acentos e espaços.
2. A data/hora puder ser interpretada em formato brasileiro \`DD/MM/AAAA HH:mm[:ss]\` ou ISO local \`AAAA-MM-DD HH:mm[:ss]\`.
3. A data/hora estiver dentro da janela a partir do instante capturado, admitindo tolerância de 90 segundos para diferença de precisão entre o clique e o valor exibido na grade.
4. Houver exatamente um candidato verificável.

O resultado é classificado como:

- **Sucesso:** \`MSG_EXCEPTION.\` contém \`Processo concluído com sucesso.\`.
- **Em andamento:** mensagem ainda vazia.
- **Falha:** existe mensagem diferente da confirmação de sucesso.
- **Não encontrado:** nenhum registro corresponde ao nome/horário.
- **Ambíguo / não verificável:** mais de um candidato, data/hora em formato desconhecido ou estrutura incompleta.

### Limite intencional desta fase

A grade documentada identifica o processo de emissão, mas não contém um campo confirmado com o número do título ou a parcela. Por isso, a associação ao título depende do clique capturado e da correspondência única de horário. Se houver outra emissão do mesmo tipo na janela, a rotina interrompe por ambiguidade.

Mesmo quando o processo é identificado com sucesso, a versão 0.3.0 **não seleciona a linha**, não altera \`DataView.currentRow\`, não chama \`doCommand\` e não baixa PDF. O painel mostra linha visual, número do registro e data/hora para conferência. A seleção automatizada depende de validação adicional da API do ERP e ficará para a etapa de download.

### Como validar em operação

1. Atualizar para a 0.3.0 somente depois que a versão for integrada à \`main\`.
2. Na tela Consulta de títulos, executar o userscript pelo popup do Tampermonkey antes de clicar em **Emite boleto**.
3. Fazer a emissão somente como parte de uma operação real autorizada; o listener apenas registra o clique e não executa a emissão.
4. Confirmar que o painel registrou o horário.
5. Abrir Processos agendados pelo fluxo normal do ERP.
6. Executar o userscript pelo popup também na tela de Processos agendados.
7. Clicar em **Analisar processos** e comparar a linha, horário e estado exibidos com a grade do Systextil.

Não é necessário emitir um boleto apenas para testar a captura. A primeira validação deve aproveitar uma emissão real que já precisaria ser feita. Não recarregar a página autenticada para instalar ou ativar o userscript.

### Testes automatizados adicionados

- normalização de nome do processo;
- interpretação de data/hora brasileira e ISO;
- rejeição de data/hora inválida ou sem hora;
- correspondência única concluída com sucesso;
- exclusão de processos anteriores ao clique;
- bloqueio de correspondências múltiplas;
- classificação de processo em andamento e de falha;
- bloqueio quando o horário não pode ser interpretado;
- exigência de solicitação registrada;
- mapeamento de sufixos das linhas;
- expiração de solicitação antiga;
- confirmação de que a Fase 3 não seleciona nem baixa registros.

## 9. Fase 4 — seleção e download do PDF

A Fase 3 foi validada no ERP em 04/11/2026. A versão 0.4.0 implementa o fluxo inicial de seleção do processo e download protegido, em uma branch separada.

Pendências de validação operacional:

1. Confirmar que o Systextil expõe `DataView.currentRow` como índice zero-based e que a atribuição seleciona a linha visual correspondente.
2. Confirmar que `getFileUrl()`, após a seleção, retorna o PDF do processo identificado.
3. Confirmar que o Tampermonkey conclui o download com o nome personalizado na pasta padrão do Chrome.
4. Confirmar que uma segunda tentativa para a mesma solicitação é bloqueada.
5. Confirmar a razão social capturada de `nome_cliente.`; solicitações antigas sem esse campo exigem preenchimento/confirmação manual no painel.

## 10. Validação e desenvolvimento no repositório

O repositório usa Node.js nativo e `node --test`; o `package.json` exige Node.js 18 ou superior. O README registra que o projeto não possui CI/CD e que os testes são executados localmente.

Para a nova funcionalidade:

- Manter a implementação e os testes isolados da régua de cobrança.
- Criar testes unitários sem dependências externas para as funções puras.
- Não afirmar que testes passaram sem executá-los.
- Atualizar esta documentação conforme os campos forem confirmados.
- Não integrar na `main` antes de validar o userscript no Systextil.

## 11. Estado atual resumido

**Estado de produção (05/11/2026):** a versão 0.4.9 está integrada à branch `main`. A PR #25 foi mesclada em 05/11/2026 no commit `ed39d7da0bb535367bc5533559402494eacb9676`. O usuário confirmou o funcionamento da correção no Systextil real. A versão publicada do arquivo é `0.4.9`; as URLs de atualização e download apontam para `main`.

| Item | Estado atual |
|---|---|
| Branch/versão de produção | `main` / v0.4.9 |
| PR de integração da correção | [#25 — aceita confirmação NXJ quando o título é limpo no blur](https://github.com/IsaacTexCotton/Systextil-envio-mensagem/pull/25) |
| Commit de integração | `ed39d7da0bb535367bc5533559402494eacb9676` |
| Fluxo operacional manual | Mapeado |
| Campo do número do título | Identificado |
| Campo da parcela | `seq_duplicatas.`; preenchimento assistido confirmado pelo NXJ na versão atual |
| Campo do cliente | `nome_cliente.`; usado para compor o nome do arquivo com possibilidade de conferência/correção manual |
| Identificação dos controles da grade | Mapeada |
| Mensagem de sucesso do processo | Identificada |
| Geração da URL PDF pelo ERP | Implementada com validação da URL e do relatório selecionado |
| Download autenticado com `GM_download` | Implementado com proteção contra duplicidade e tratamento de timeout indeterminado |
| Nome personalizado e pasta de destino | Regra de nome implementada; destino depende da pasta padrão configurada no Chrome |
| Preenchimento de título/parcela | v0.4.9 confirmada operacionalmente pelo usuário |
| Consulta F7 | Continua sendo ação manual do operador |
| Emissão do boleto | Continua sendo ação manual do operador |

**Limite da evidência:** a validação operacional relatada pelo usuário confirma a correção v0.4.9 no Systextil real. Ela não substitui a execução local de `npm run verify`, nem implica que toda alteração futura no fluxo de seleção/download esteja automaticamente revalidada. Consulte os testes e os registros de cada fase para identificar o alcance de cada evidência.

## 12. Correção proposta do preenchimento assistido (v0.3.1 — 04/11/2026)

### Problema reproduzido em operação

O operador confirmou que:

- O painel apresenta os códigos preenchidos corretamente nos campos do formulário.
- Ao executar F7 após o preenchimento pelo userscript, o Systextil retorna um cliente associado ao título `000000000`, em vez do título informado.
- Ao preencher os mesmos campos manualmente pelo teclado e executar F7, a consulta retorna o cliente correto.

Essa diferença indica que a atribuição direta em `campo.value`, usada pela v0.3.0, não está atualizando de forma compatível o estado interno de edição/consulta do formulário. O valor visual, isoladamente, não comprova que o ERP registrou a alteração.

### Alteração proposta

A v0.3.1 substitui a atribuição direta por:

1. Setter nativo de `HTMLInputElement.prototype.value`, obtido do contexto do próprio campo (`ownerDocument.defaultView`).
2. Evento `InputEvent` com `inputType: "insertReplacementText"` e propagação de `input`.
3. Evento `change` após a atualização.
4. Restauração dos valores anteriores usando a mesma rotina caso o preenchimento falhe.

O uso do setter nativo busca evitar que mecanismos de rastreamento de alterações do campo interpretem o valor programático como uma alteração não registrada. Isso é uma hipótese técnica a validar no ERP, não uma confirmação de que todos os estados internos do Systextil serão atualizados.

### Limites preservados

- O userscript não pressiona F7.
- O userscript não submete o formulário.
- O operador continua responsável por conferir os campos e executar a consulta manualmente.
- O userscript não clica em **Emite boleto** e não inicia uma emissão.
- A correção não altera a captura da solicitação nem a análise de Processos agendados.

### Critérios de aceite

1. Executar `npm test` e confirmar que a cobertura do setter nativo e dos eventos de entrada passa.
2. Na tela Consulta de títulos já autenticada, preencher um título real por meio do painel.
3. Conferir visualmente número e parcela no Systextil.
4. Pressionar F7 manualmente e confirmar que o ERP retorna o cliente correspondente ao título informado.
5. Repetir com outro título antes de considerar a correção estável.

Se a consulta ainda retornar o cliente incorreto, interromper o uso do preenchimento assistido e manter a digitação manual. A próxima investigação deverá identificar o mecanismo específico do formulário Systextil (por exemplo, o estado mantido pelo gerenciador de campos), em vez de acrescentar eventos sintéticos sem evidência.

**Estado:** v0.3.1 integrada à `main`. O usuário informou 55 testes aprovados no Codespace antes da integração. A confirmação operacional específica do preenchimento F7 não foi registrada neste histórico; a Fase 3 foi posteriormente validada com a v0.3.2.


## 13. Correção da correspondência de horário dos Processos agendados (v0.3.2 — 04/11/2026)

### Problema identificado pela validação operacional

Na tela de Processos agendados, a solicitação registrada pelo userscript ocorreu em **04/11/2026 às 12:12:38**. A grade mostrava, entre outros, estes processos de emissão:

- 12:12:38 — processo concluído com sucesso;
- 12:11:59 — processo concluído com sucesso;
- 11:57:45 — processo sem informações para gerar relatório;
- 11:30:44, 08:15:59 e 08:15:23 — emissões anteriores.

A versão 0.3.1 usava uma condição inferior a partir de `solicitadoEm - 90 segundos`, mas o limite superior era o horário atual da análise. Assim, processos posteriores dentro da validade de 30 minutos eram indevidamente agrupados como candidatos, mesmo sem proximidade real com o clique. Isso provocava ambiguidade.

### Regra corrigida na v0.3.2

1. Considerar somente processos cujo horário esteja dentro de **±90 segundos** do instante capturado.
2. Dentro desse conjunto, procurar correspondência no **mesmo segundo** da solicitação.
3. Se houver exatamente uma correspondência exata, priorizá-la, mesmo que exista outro processo próximo dentro da tolerância.
4. Se houver mais de uma correspondência exata, interromper por ambiguidade.
5. Se não houver correspondência exata, aceitar somente um candidato dentro da tolerância.
6. Se houver vários candidatos aproximados e nenhum exato, interromper por ambiguidade.
7. Processos fora da janela de ±90 segundos não participam da associação.

A comparação do segundo utiliza o timestamp local em precisão de segundos, porque a grade do ERP apresenta o campo de execução nesse formato. A tolerância continua existindo para casos em que o processamento do ERP não coincida exatamente com o segundo do clique.

### Testes acrescentados

- Prioridade de um processo que coincide no segundo exato, mesmo com outro processo 39 segundos antes.
- Exclusão de processos muito posteriores à solicitação.
- Manutenção do bloqueio quando dois processos aproximados estão dentro da tolerância e nenhum coincide exatamente.

**Estado:** versão v0.3.2 integrada à `main`. Validação operacional confirmada em 04/11/2026: o painel exibiu “Processo único identificado e concluído com sucesso.”


## 14. Fase 4 — seleção segura e download do PDF (v0.4.0 — 04/11/2026)

### Fluxo implementado

1. O operador analisa os Processos agendados.
2. O botão de download só é habilitado quando a análise retorna exatamente um processo concluído com sucesso.
3. Antes de baixar, o userscript repete a análise com os dados atuais da grade. Se o resultado mudou desde a análise visual, interrompe e solicita nova análise.
4. O userscript usa o `DataViewDescriptor` da visão ativa em `window.curDataView`, exige que `curDataView.name` seja exatamente `forms.systextil.batch` e seleciona o índice zero-based correspondente ao registro da Fase 3.
5. Os campos do registro são relidos antes e depois da seleção. Se título do processo, data/hora ou mensagem tiverem mudado, a seleção é restaurada quando possível e o download é bloqueado.
6. Com a linha selecionada, chama `getFileUrl()` do contexto da página do Systextil.
7. Confere se o único `.jrprint` selecionado na lista de resultados corresponde ao parâmetro `report` da URL gerada.
8. A URL é validada antes do download: mesma origem da tela atual, caminho `/systextil/download/<arquivo>.pdf`, parâmetro `ext=pdf`, relatório `.jrprint` e programa `forms.crec.crec_e259`.
9. O nome do arquivo usa a razão social, título e parcela. A razão social capturada a partir de `nome_cliente.` fica armazenada na solicitação; solicitações registradas antes da v0.4.0 não têm esse campo e exigem confirmação manual no painel.
10. O download é iniciado somente pelo clique explícito em **Baixar PDF do processo identificado**, usando `GM_download` com `saveAs: false`. O Chrome utiliza a pasta padrão de downloads já configurada:
   `V:\Financeiro\Contas à Receber\Administrativo - Atualização\Banco\Boletos (2ª via)`.

### Proteção contra ações incorretas

- A emissão do boleto continua manual. O userscript não clica em **Emite boleto**, não envia F7 e não submete o formulário.
- O userscript não clica em **Download** do ERP; obtém a URL com `getFileUrl()` e usa a API de download do Tampermonkey.
- Não aceita URLs externas, caminhos que não sejam o endpoint de PDF do Systextil, formatos diferentes de PDF ou relatórios de outro programa.
- Não baixa quando a seleção da grade não pode ser comprovada.
- Mantém um registro na `sessionStorage` para bloquear nova tentativa do mesmo processo quando o download está pendente, concluído ou com resultado indeterminado.
- Uma falha reportada pelo navegador libera somente uma reserva ainda pendente; reservas concluídas não podem ser removidas pelo fluxo genérico de falha.
- Um timeout é tratado como resultado indeterminado: a reserva fica persistida e não expira automaticamente para permitir nova tentativa.
- Reservas pendentes antigas, por exemplo após fechar a aba antes do callback, também passam a indeterminadas após 15 minutos, em vez de liberar um possível download duplicado.
- A interface oferece **Já conferi a pasta; liberar nova tentativa** somente após o operador confirmar em diálogo que verificou a pasta e que o PDF não foi salvo. Depois da liberação, é obrigatória uma nova análise do processo.
- O nome do arquivo não contém o caminho de rede; `GM_download` envia apenas o nome. A pasta é controlada pela configuração padrão do Chrome já validada manualmente.

### Permissões Tampermonkey

A versão 0.4.0 troca `@grant none` por permissões específicas:

- `@grant unsafeWindow`: acessar os objetos e funções que pertencem à página Systextil, em particular `curDataView.currentRow` e `getFileUrl()`.
- `@grant GM_download`: solicitar o download autenticado para a pasta padrão do navegador.

O userscript deve ser atualizado pelo verificador do Tampermonkey. Não recarregar a aba autenticada do Systextil.

### Testes automatizados adicionados

- validação de URL relativa correta e bloqueio de origem externa;
- bloqueio de caminho, extensão, identificador de relatório ou programa inesperados;
- seleção zero-based com comprovação dos dados antes/depois;
- interrupção quando a API da grade não está disponível;
- restauração da seleção anterior quando a URL retornada é inválida;
- verificação de que `getFileUrl()` só é chamado depois da seleção;
- chave de deduplicação por solicitação/processo;
- bloqueio de download pendente/concluído;
- timeout encaminhado para callback próprio, sem tratá-lo como falha comprovada;
- conversão de timeout e reserva pendente expirada para estado indeterminado;
- manutenção do bloqueio indeterminado até liberação manual explícita;
- liberação de reserva somente quando a falha foi confirmada ou após conferência manual;
- confirmação de que análise de processo não dispara download automaticamente.

### Validação operacional pendente

A execução de `npm run verify` registrada em 04/11/2026 (Node.js 24.22.2, 76/76 testes) corresponde à versão anterior. A verificação da v0.5.0 e sua validação operacional no ERP permanecem pendentes.

A implementação está protegida para interromper o fluxo caso a visão ativa não seja `forms.systextil.batch` ou o `DataViewDescriptor` não exponha `currentRow`. Ainda é necessário validar no Systextil usando um processo real já concluído (sem emitir boleto adicional somente para testar):

1. Instalar a versão 0.5.0 da branch de correção (ou aguardar a integração na `main` e atualização pelo Tampermonkey).
2. Na página Processos agendados já aberta, ativar o script pelo popup, sem recarregar.
3. Conferir a razão social no campo do painel.
4. Clicar em **Analisar processos** e confirmar o processo único.
5. Clicar em **Baixar PDF do processo identificado**.
6. Confirmar se o registro visual selecionado corresponde à análise, se o PDF chega à pasta padrão e se o nome está correto.
7. Clicar novamente no mesmo botão e confirmar que o bloqueio de duplicidade aparece.
8. Em caso de timeout, conferir manualmente a pasta de destino antes de usar **Já conferi a pasta; liberar nova tentativa**. Não liberar a reserva se o PDF estiver presente ou se houver dúvida sobre o resultado.

Se `curDataView.name` não for exatamente `forms.systextil.batch`, se `curDataView.currentRow` não estiver disponível ou se o índice atribuído não refletir a linha identificada, a função interromperá antes de chamar `getFileUrl()` ou `GM_download`. Nesse caso, não forçar a seleção: coletar o erro exibido e investigar a API real do ERP.

**Estado:** verificação local da v0.4.0 aprovada pelo operador no Codespace (76/76 testes). A validação operacional da seleção de linha, correspondência do PDF, nome/pasta de destino e bloqueio de duplicidade permanece pendente.


## 15. Preservação da parcela (v0.4.1 — 04/11/2026)

### Alteração entregue

- O número do título continua sendo normalizado com zeros à esquerda, conforme o comportamento anterior.
- A parcela passou a ser preservada exatamente como informada: `3` continua `3`; `01` continua `01`.
- O limite máximo do campo continua sendo respeitado; valores maiores são rejeitados sem truncamento.
- Foram mantidos o setter nativo e os eventos sintéticos `input` e `change`.

### Limitação identificada posteriormente

A correção de formatação não resolveu a confirmação interna da parcela pelo NXJ. A sequência de foco continuou síncrona e a validação de sucesso ainda verificava somente o valor visível no DOM. A investigação posterior observou que o valor pendente de cada campo é transportado no próximo comando NXJ e que comandos consecutivos podem se sobrepor.

A versão 0.4.1, portanto, preservou a parcela no DOM, mas não comprovava que o Systextil a havia recebido. A correção desse fluxo está descrita na seção 16.


## 16. Confirmação assíncrona dos campos da consulta (v0.4.2 — 05/11/2026)

### Comportamento implementado

A rotina `preencherCamposConsulta` passou a ser assíncrona e segue a sequência de confirmação do NXJ:

1. Confirma que a visão ativa é `forms.crec.crec_f090`.
2. Instala temporariamente um monitor sobre `unsafeWindow.XMLHttpRequest`, limitado às requisições para `UnifyNXJ.jsp`.
3. Foca o campo do título, aguarda o sistema ficar ocioso e então insere o número normalizado.
4. Move o foco para a parcela e aguarda um POST NXJ cujo comando seja `ClickOnField` ou `NEXT_FIELD` e cujo último valor de `fieldValues` corresponda exatamente ao título inserido.
5. Aguarda o término da requisição, resposta HTTP de sucesso e 300 ms sem requisições NXJ em andamento.
6. Relê os campos pelo atributo `name`, pois o NXJ pode atualizar os controles após responder.
7. Insere a parcela sem acrescentar zeros, retorna o foco ao título e exige a mesma confirmação para a parcela.
8. Relê os dois campos uma última vez. Somente depois dessas verificações o painel apresenta sucesso.

O limite operacional padrão é de 20 segundos por espera. O intervalo de silêncio padrão é de 300 ms. A espera é baseada na atividade real observada, não em uma pausa fixa isolada.

### Segurança e falhas

- O monitor armazena somente metadados mínimos e o último valor pendente em memória durante a execução. Não registra `managerId`, URLs completas, cookies, tokens ou valores em console ou armazenamento persistente.
- Os métodos originais de `XMLHttpRequest.prototype.open` e `send` são restaurados ao terminar, tanto em sucesso quanto em falha.
- Se a visão mudar, o comando não for observado, a requisição não terminar, o status HTTP não for 2xx ou o sistema não ficar ocioso, a execução falha fechada.
- Se algum valor já tiver sido alterado antes da falha, o painel orienta a não pressionar F7. Os valores não são restaurados automaticamente, pois não há garantia de que uma sequência de restauração seria confirmada.
- O botão e as entradas do painel ficam desabilitados durante o preenchimento. A API de diagnóstico `preencherCamposConsulta` agora retorna uma Promise.
- O userscript não envia F7, não submete o formulário, não emite boletos e não inicia downloads como parte deste fluxo.

### Testes adicionados

- confirmação do título e da parcela em POSTs NXJ separados;
- preservação do setter nativo e de `InputEvent`;
- falha segura quando a confirmação de título não chega;
- falha segura quando a confirmação da parcela não chega;
- bloqueio de uma segunda execução simultânea;
- interrupção se a visão ativa não for Consulta de Títulos.

### Limitações e validação pendente

O monitor observa o `XMLHttpRequest` da página, conforme o protocolo identificado na investigação. Se o Tampermonkey não alcançar esse objeto ou o ERP mudar o transporte/comando, a confirmação não será reconhecida e o preenchimento será interrompido. Essa falha é intencional: não deve haver sucesso baseado apenas no DOM.

**Estado da v0.4.2:** integrada à `main`. O operador informou 80 testes aprovados no Codespace. A validação operacional no Tampermonkey ainda é necessária.

## 17. Ajuste da temporização de confirmação (v0.4.3 — 05/11/2026)

### Evidência

O operador apresentou dois testes manuais que preencheram corretamente os campos. Ambos aguardam 500 ms após inserir o título antes de focar a parcela; depois aguardam 800 ms após a mudança de foco. Após inserir a parcela, aguardam 500 ms antes de sair do campo; o teste que retorna o foco ao título aguarda mais 800 ms.

A comparação com a v0.4.2 identificou que a rotina mudava o foco para a parcela imediatamente após disparar `input` e `change`. A pausa de 200 ms ocorria depois da mudança de foco. Portanto, a rotina não reproduzia a janela de estabilização observada nos testes manuais.

### Alteração

A v0.4.3 passa a adotar, por padrão:
- 500 ms após focar inicialmente o título;
- 500 ms após inserir cada valor, antes de abandonar o campo;
- 800 ms após cada mudança de foco, antes de avaliar a confirmação NXJ.

A confirmação do comando NXJ, a espera por HTTP 2xx e a verificação de ociosidade permanecem ativas. Os tempos são configuráveis internamente para os testes automatizados; o limite de cada atraso configurável é de 3 segundos. O parâmetro legado `atrasoFocoMs` continua aceito nos testes existentes.

Foi acrescentado um teste de regressão que mede a distância entre o evento `change` e o foco do campo seguinte, garantindo a pausa antes de o campo ser abandonado.

**Estado:** v0.4.3 integrada à `main`. O operador informou 81 testes aprovados no Codespace. A validação operacional do preenchimento no Systextil real permanece pendente.

## 18. Reaplicação do foco na parcela após confirmação do título (v0.4.4 — 05/11/2026)

### Problema identificado no fluxo

Depois de confirmar o número do título pelo NXJ, a rotina relê os controles do formulário porque a resposta do ERP pode atualizar ou recriar os elementos. Porém, a rotina escrevia a parcela no controle relocalizado sem focá-lo novamente.

O foco anterior havia sido aplicado à referência do campo de parcela existente antes da resposta NXJ. Quando o ERP recria o controle, essa referência deixa de representar o elemento atualmente exibido e o novo campo pode permanecer sem foco. Isso diverge do script manual validado pelo operador, que executa `p.focus()`, aguarda 800 ms e somente então insere a parcela.

### Correção

A v0.4.4 refocaliza o campo `seq_duplicatas.` relocalizado após a confirmação do título e aguarda o intervalo configurado (800 ms por padrão) antes de atribuir a parcela. Depois, mantém a pausa de 500 ms antes de retornar o foco ao título e exigir a confirmação NXJ da parcela.

### Regressão automatizada

Foi acrescentado um cenário que simula a recriação do controle de parcela após a confirmação NXJ do título. O teste exige que o novo controle receba a parcela e que o segundo POST NXJ transporte exatamente esse valor.

### Validação pendente

- Executar `npm run verify` no Codespace e confirmar a nova suíte completa.
- Instalar a v0.4.4 no Tampermonkey, desativando temporariamente a 0.4.3 para evitar execução duplicada.
- Testar com título antigo ou quitado autorizado e confirmar que o campo de parcela recebe o valor.
- Somente depois da mensagem de confirmação, pressionar F7 manualmente e conferir o resultado. Não clicar em **Emite boleto**.

**Estado:** correção implementada na branch `fix/parcela-sem-foco-apos-nxj`. Ainda não integrada à `main`; a validação no ERP real permanece pendente.


## 19. Compatibilidade dos eventos de edição com a sequência manual (v0.4.5 — 05/11/2026)

### Evidência e hipótese

Mesmo após o ajuste de foco da v0.4.4, o operador continuou recebendo timeout na confirmação NXJ do título. O fluxo manual conhecido como funcional usa o setter nativo do input e dispara `new Event("input", { bubbles: true })` e `new Event("change", { bubbles: true })`.

A v0.4.4 usava `InputEvent` com `inputType: "insertReplacementText"` para o evento `input`. Essa é uma diferença observável em relação ao procedimento manual bem-sucedido e passa a ser a hipótese principal a ser isolada. Ainda não há evidência suficiente para afirmar que essa diferença é a causa definitiva.

### Alteração

A v0.4.5 passa a emitir os eventos padrão `Event("input")` e `Event("change")`, com `bubbles: true`, mantendo o setter nativo, as pausas e a confirmação assíncrona NXJ.

Quando ocorre timeout, a mensagem também informa contagens de requisições NXJ, POSTs, comandos de saída de campo reconhecidos e valores correspondentes. Nenhum número de título/parcela ou conteúdo de payload é exibido.

### Validação pendente

- Executar `npm run verify` no Codespace.
- Validar no Systextil real usando título antigo/quitado autorizado.
- Em caso de timeout, enviar a mensagem completa de diagnóstico sem adicionar número de título, cliente, cookies ou payload.
- Não pressionar F7 depois de erro; não clicar em **Emite boleto**.

**Estado:** v0.4.5 integrada à `main` pela PR #21. A validação operacional no Tampermonkey/Systextil real permanece separada da aprovação automatizada.


## 20. Preservação do número do título informado pelo operador (v0.4.6 — 05/11/2026)

### Evidência

O fluxo manual apresentado pelo operador:
- solicita o número do título via `prompt`;
- usa `titulo.trim()` sem completar zeros;
- atribui o valor diretamente pelo setter nativo;
- dispara `Event("input")` e `Event("change")`;
- aguarda as pausas observadas e executa F7 manualmente.

O operador confirmou que esse procedimento preenche os campos e que o F7 retorna o título correto.

Na v0.4.5, a rotina automática ainda chamava `normalizarCodigoConsulta`, completando o número com zeros à esquerda (por exemplo, `936520` virava `00936520`). O último diagnóstico observou um comando de saída NXJ, mas nenhum valor exatamente igual ao valor normalizado esperado.

Essa diferença entre o procedimento manual e o automático é uma hipótese concreta para a divergência. A confirmação definitiva depende do teste operacional da nova versão.

### Alteração v0.4.6

- A rotina de preenchimento passa a usar `preservarCodigoConsulta` também no número do título.
- O valor é enviado exatamente como digitado, sem completar zeros à esquerda.
- A validação de caracteres e o limite de comprimento do campo continuam ativos.
- O monitor NXJ continua exigindo a confirmação do valor exato que foi digitado.
- Os testes de sequência, recriação do campo e falhas passam a esperar o valor original sem preenchimento automático.
- A função utilitária `normalizarCodigoConsulta` permanece disponível e coberta pelos testes, mas deixa de ser usada no preenchimento assistido.

### Validação pendente

- Executar `npm run verify` no Codespace.
- Instalar a v0.4.6 no Tampermonkey, desativando a v0.4.5 para evitar execução duplicada.
- Usar título antigo ou quitado autorizado; digitar o número no painel exatamente como é informado manualmente.
- Conferir o valor do título e da parcela e aguardar as confirmações NXJ.
- Pressionar F7 somente depois da mensagem de sucesso e verificar o título/parcela retornados.
- Não clicar em **Emite boleto**.

**Estado:** v0.4.6 integrada à `main` pela PR #22. A validação operacional específica do preenchimento automático no Systextil permanece pendente.


## 21. Estabilização do campo da parcela após o foco (v0.4.7 — 05/11/2026)

### Problema tratado

Após confirmar o título pelo NXJ, o script relocalizava o campo da parcela, aplicava foco e aguardava um intervalo fixo. Esse intervalo, isoladamente, não comprovava que a comunicação assíncrona do NXJ havia terminado nem que o elemento continuava sendo o controle atual do formulário.

Se o ERP substituísse o input durante esse intervalo, a rotina poderia escrever em uma referência antiga.

### Correção

- Depois de focar a parcela, aguarda o estado ocioso real do monitor NXJ.
- Relê o formulário após a resposta e compara a identidade do controle com o elemento que recebeu foco.
- Se o ERP recriar o campo, repete a estabilização no controle atual, com limite de três tentativas.
- Somente escreve quando o campo permanece estável após o ciclo NXJ.
- Após inserir o valor e aguardar a janela de estabilização, relê o formulário e confirma que o mesmo controle ainda contém a parcela antes de mudar o foco.
- Se o campo continuar sendo recriado ou perder o valor, interrompe o preenchimento e orienta a não pressionar F7.

### Testes de regressão

- Atualização NXJ assíncrona após refocalizar a parcela, com recriação do input antes da escrita.
- Confirmação de que a parcela é inserida no controle novo e enviada no POST NXJ.
- Bloqueio seguro quando o NXJ continua recriando o controle além do limite de tentativas.

### Validação pendente

- Executar `npm run verify` na branch `fix/parcela-aguarda-ocioso-nxj`.
- Instalar a versão 0.4.7 no Tampermonkey, desativando a versão anterior para evitar execução duplicada.
- Validar com título autorizado e confirmar visualmente a parcela antes de pressionar F7.
- Se a rotina interromper, não pressionar F7; conferir ou limpar manualmente os campos no ERP.

**Estado:** integrada à `main` pela PR #23 na v0.4.7. A validação operacional no ERP real permaneceu pendente; a v0.4.8 desta branch substitui a espera prévia pela sequência manual confirmada pelo operador.


## 22. Reutilização da sequência manual comprovada para preencher a parcela (v0.4.8 — 05/11/2026)

### Evidência recebida

O operador forneceu um script executado diretamente na página do Systextil que preenche corretamente os dois campos. A sequência observada é:

1. foco do título e espera de 500 ms;
2. atribuição do título pelo setter nativo, seguida de Event input e Event change;
3. espera de 500 ms;
4. foco da parcela e espera de 800 ms;
5. atribuição da parcela pelos mesmos eventos;
6. espera de 500 ms;
7. retorno do foco ao título e espera de 800 ms.

O script de referência observa os POSTs do UnifyNXJ.jsp, mas não aguarda uma classificação específica do comando NXJ antes de inserir a parcela.

### Causa da interrupção anterior

A v0.4.7 aguardava a confirmação NXJ do título antes de executar a atribuição da parcela. Se o monitor não reconhecesse o POST esperado, a função lançava timeout e encerrava antes da escrita, ainda que a sequência de foco e digitação pudesse funcionar no ERP.

### Alteração v0.4.8

- Reutiliza a sequência de foco, pausas, setter nativo e eventos do script funcional apresentado pelo operador.
- Localiza os controles por document.getElementsByName(...)[0], como no teste comprovado.
- Não usa a confirmação NXJ do título como bloqueio anterior à escrita da parcela.
- Mantém o monitor NXJ durante toda a operação e verifica as confirmações somente depois que os dois valores foram inseridos.
- Se o ERP recriar o campo da parcela durante a ativação, relocaliza e refoca somente quando a identidade do elemento mudou, com limite de três tentativas.
- Mantém a interrupção segura e a orientação de não pressionar F7 em caso de divergência.

### Testes de regressão adicionados/ajustados

- A parcela deve ser inserida mesmo quando o monitor não reconhecer a confirmação do título; nesse caso, a execução termina com erro de confirmação e orienta a não pressionar F7.
- A rotina deve usar o primeiro controle retornado por getElementsByName, conforme o script de referência.
- O fluxo normal deve focar a parcela uma única vez.
- O tratamento de recriação repetida do input continua limitado e falha de forma segura.
- Os cenários de HTTP não 2xx e confirmação ausente continuam exigindo conferência manual antes de F7.

### Validação pendente

- Executar npm run verify no Codespace.
- Instalar a v0.4.8 no Tampermonkey, desativando a versão anterior para evitar execução duplicada.
- Usar título antigo ou quitado autorizado; confirmar visualmente que título e parcela são inseridos.
- Conferir a mensagem de confirmação NXJ. Pressionar F7 manualmente somente se os dois campos estiverem corretos e a mensagem do painel confirmar ambos.
- Não clicar em Emite boleto durante este teste.

**Estado:** v0.4.8 integrada à `main` pela PR #24. A validação operacional no ERP real permaneceu pendente; a v0.4.9 corrige a validação prematura do valor do título após o blur.


## 23. Confirmação NXJ do título mesmo quando o ERP limpa o input no blur (v0.4.9 — 05/11/2026)

### Problema observado

Na v0.4.8, após focar o campo da parcela e aguardar a resposta do ERP, o script relia o input do título e exigia que seu valor continuasse presente no DOM. O painel interrompia a sequência com a mensagem “O Systextil não manteve o número do título após a mudança de foco”. Essa validação ocorria antes da escrita da parcela.

A mensagem comprova que o valor não estava mais presente no input consultado após o blur; isoladamente, ela não comprova se o NXJ já havia recebido e processado o valor.

### Correção

- Remove a validação visual intermediária do título depois da mudança de foco para a parcela.
- Mantém a sequência original: inserir título, focar parcela, inserir parcela e retornar o foco ao título.
- A confirmação do título passa a depender do monitor NXJ encontrar o POST de saída com o valor exato informado.
- Após a confirmação NXJ, um input de título vazio é aceito como comportamento do ERP; um valor não vazio e divergente continua sendo erro.
- A parcela continua exigindo valor visível correto após sua confirmação. As confirmações NXJ exatas dos dois campos continuam obrigatórias para informar sucesso.
- Se o monitor não observar ou não confirmar os valores, a operação permanece interrompida e o painel orienta não pressionar F7.

### Teste de regressão

O ambiente simulado cobre dois comportamentos: limpeza do input do título no blur depois de enviar o valor ao NXJ e recriação do elemento do título durante essa transição. Os testes verificam que a rotina ainda escreve a parcela, recupera a referência atual para devolver o foco e só retorna sucesso quando os POSTs NXJ observados contêm, na ordem, o título e a parcela esperados.

### Validação pendente

- Executar `npm run verify` na branch `fix/confirmacao-nxj-titulo-sem-valor-dom`.
- Instalar a v0.4.9 no Tampermonkey, desativando a v0.4.8 para evitar execução duplicada.
- Usar título autorizado, confirmar os campos e a mensagem de confirmação do painel.
- Se o campo do título permanecer visualmente vazio, não pressionar F7 sem verificar que o ERP preservou a consulta corretamente; validar o comportamento com F7 apenas em cenário autorizado e sem clicar em **Emite boleto**.

**Estado:** v0.4.9 preparada na branch `fix/confirmacao-nxj-titulo-sem-valor-dom`; revisão do diff, testes locais e validação operacional no ERP real ainda pendentes.


## 15. Correção da confirmação NXJ quando o título é limpo no blur (v0.4.9 — 05/11/2026)

### Problema operacional

O userscript preenchia o número do título, mas o Systextil podia limpar ou recriar o input quando o foco mudava para o campo da parcela. A validação intermediária da v0.4.8 exigia que o valor permanecesse no DOM após a mudança de foco e interrompia a rotina antes de concluir o preenchimento da parcela.

### Evidências do diagnóstico

- Documento principal, sem iframe para o formulário de consulta.
- Visão ativa identificada como a consulta de títulos.
- Campos encontrados sem ambiguidade no formulário esperado.
- Inputs conectados ao documento e editáveis.
- Métodos originais de `XMLHttpRequest.prototype.open` e `send` acessíveis e substituíveis no contexto da página.

Essas evidências delimitam o cenário diagnosticado; não devem ser presumidas em outras telas ou versões do ERP.

### Correção implementada

A v0.4.9 preserva a sequência de preenchimento que o usuário já havia testado no ERP e usa a confirmação do protocolo NXJ como evidência de que o valor exato do título foi enviado e aceito na etapa correspondente.

A rotina não exige que o input continue exibindo o título depois do blur. Ela só prossegue quando o monitor identifica o comando de confirmação esperado, o valor correspondente é exatamente igual ao informado e a requisição acompanhada termina de forma verificável. Em seguida, a rotina prossegue com a parcela e também exige sua confirmação.

### Critérios de interrupção preservados

- Não foi identificada confirmação NXJ do valor exato: interromper.
- O valor confirmado é diferente do esperado: interromper.
- A requisição não pode ser acompanhada ou termina em estado não verificável: interromper.
- A visão do ERP muda durante a operação: interromper.
- O tempo limite é atingido: interromper e informar a etapa que não foi confirmada.

A limpeza visual do campo, isoladamente, não é usada como prova de falha nem como prova de sucesso. A prova é a confirmação observada do valor exato enviado ao ERP.

### Limites operacionais preservados

- O userscript envia os eventos `keydown`/`keyup` de F7 ao campo real do título após confirmar título e parcela pelo NXJ.
- O userscript não submete o formulário.
- A consulta só avança após o Systextil sair do modo de busca e devolver um resultado verificável.
- O monitoramento de XHR é temporário e restrito à etapa de preenchimento; não deve ser transformado em captura geral de tráfego.
- Diagnósticos não devem registrar valores de cliente, cookies, tokens, parâmetros de sessão ou payloads completos.

### Integração e validação

- PR: [#25 — aceita confirmação NXJ quando o título é limpo no blur](https://github.com/IsaacTexCotton/Systextil-envio-mensagem/pull/25).
- Commit de integração: `ed39d7da0bb535367bc5533559402494eacb9676`.
- Branch de destino: `main`.
- Versão integrada: `0.4.9`.
- Validação operacional: usuário confirmou que o preenchimento voltou a funcionar no Systextil real.

A nova documentação transversal de arquitetura, permissões, integração, testes e segurança está em [guia-automacao-tampermonkey-systextil.md](guia-automacao-tampermonkey-systextil.md).


## 24. Resolução do DataViewDescriptor da grade de Processos agendados (v0.5.0 — 05/11/2026)

### Causa identificada

O resolvedor da v0.4.9 procurava `currentRow` em `window.DataView` e `window.dataView`. O diagnóstico no Systextil mostrou que `window.DataView` é o construtor nativo JavaScript, não o estado da grade. O objeto efetivo é `window.curDataView`, uma instância de `DataViewDescriptor`.

A inspeção confirmou, na janela principal:

- `clientManager` existe e seu formulário é `NXJForm`;
- `NXJForm` contém os campos repetidos `titulo.`, `DATA_EXECUCAO.` e `MSG_EXCEPTION.`;
- `clientManager.dataViewDescriptors` contém a visão `forms.systextil.batch`, com 10 registros na amostra observada;
- `getFileUrl()` está disponível na mesma janela;
- o frame adicional que contém outro formulário não possui os campos de Processos agendados nem `getFileUrl()`.

Assim, a janela que contém a grade e a função de preparação do PDF é a janela principal. O frame com formulário separado não deve ser usado como contexto de seleção.

### Correção v0.5.0

- O resolvedor usa exclusivamente `janelaPagina.curDataView`; não tenta usar o construtor global `DataView`.
- Exige que o objeto exponha `currentRow`.
- Exige que `curDataView.name` seja exatamente `forms.systextil.batch`. Uma visão diferente interrompe a operação antes de chamar `getFileUrl()` ou iniciar o download.
- Mantém a verificação de integridade do registro antes e depois da seleção e a restauração best-effort da linha anterior em caso de falha.
- Os testes de seleção, preparação da URL e restauração usam o formato observado do `DataViewDescriptor`; foi acrescentado um cenário que bloqueia uma visão ativa diferente.

### Segurança e validação

A correção não chama `clientManager.moveRepFieldRecord()`, `setListboxSelection()`, `onGridClick()` nem comandos NXJ. Ela preserva a atribuição de `currentRow` já coberta pelo fluxo existente, agora aplicada ao objeto correto e condicionada ao nome da visão.

A verificação automatizada completa e o teste operacional da v0.5.0 no Systextil ainda precisam ser executados. Para a validação operacional, use um processo já concluído e identificado, sem emitir um boleto adicional apenas para testar. Confira se o registro correto foi selecionado e se o relatório retornado por `getFileUrl()` corresponde ao `.jrprint` selecionado. O download continua condicionado ao clique explícito do operador.


## 25. Gravação direta na pasta por auxiliar local Windows (v0.6.0 — 05/11/2026)

### Motivação

A v0.5.0 usava GM_download com saveAs false, que grava na pasta padrão do Chrome. Alterar esse destino global afetaria todos os downloads do navegador. A API do userscript também não permite escolher um caminho absoluto arbitrário do Windows.

A v0.6.0 substitui esse transporte por um pequeno auxiliar local PowerShell. O usuário configura uma pasta exclusiva e os demais downloads do Chrome continuam inalterados.

### Arquitetura

- O Tampermonkey obtém o PDF autenticado do Systextil por GM_xmlhttpRequest, com envio de cookies habilitado e responseType arraybuffer.
- O userscript confere status, URL final, origem/caminho/relatório e assinatura/terminador do PDF.
- O conteúdo binário é enviado a http://127.0.0.1:17834/api/pdf, acompanhado de nome de arquivo e chave de pareamento.
- O auxiliar Windows recebe o arquivo, valida a chave, o nome, o tipo/conteúdo e o limite de tamanho, grava um temporário na pasta configurada e move o arquivo para o destino final.
- Arquivos existentes nunca são sobrescritos; nomes repetidos recebem sufixo numérico.
- O sucesso só é exibido após confirmação do auxiliar.
- Não há fallback para a pasta Downloads do Chrome.

### Proteções

- Listener limitado a IPv4 loopback 127.0.0.1; não escuta na rede local.
- Porta fixa 17834, endereço Host validado, chave aleatória de 256 bits e comparação em tempo constante para tokens de mesmo comprimento.
- Configuração em %LOCALAPPDATA%\TexCotton\BoletoHelper\config.json; a requisição não pode escolher o diretório.
- Nome restrito a um único nome de arquivo PDF, sem separadores ou caracteres proibidos no Windows.
- Limite de 25 MB e validação de assinatura %PDF- e marcador %%EOF.
- Gravação temporária seguida de move sem sobrescrever.
- Acesso de rede só é testado após clique explícito em Salvar chave e testar auxiliar; downloads ficam bloqueados até o pareamento passar.
- Se a conexão cair durante o upload, a reserva de duplicidade fica indeterminada. O operador precisa conferir manualmente a pasta antes de liberar outra tentativa.

### Instalação e operação

Instruções completas em tools/boleto-helper/README.md. O pacote inclui:

- tools/boleto-helper/Instalar.ps1: solicita a pasta, cria token, grava configuração local, cria atalho de inicialização e inicia o auxiliar;
- tools/boleto-helper/BoletoHelper.ps1: listener HTTP loopback e gravação segura do PDF;
- tools/boleto-helper/Parar.ps1: encerra o listener autenticado.

O instalador usa Windows PowerShell 5.1 e não exige Python, Node.js, pacotes externos ou privilégios de administrador. A configuração local contém um segredo: não a publique nem a envie para o repositório.

### Permissões do userscript

A v0.6.0 remove GM_download e declara somente as permissões adicionais necessárias:

- GM_getValue e GM_setValue: armazenamento da chave de pareamento no escopo do userscript;
- GM_xmlhttpRequest: obtenção do PDF autenticado e comunicação com o auxiliar;
- @connect systextil.texcotton.com.br e @connect 127.0.0.1: lista restrita dos dois destinos usados.

### Validação pendente

A implementação de código e os testes de contrato não comprovam a execução do PowerShell nem a política de acesso local do Chrome. Antes de integrar, é necessário:

1. Executar npm run verify com Node.js 18 ou superior.
2. Instalar o auxiliar em Windows PowerShell 5.1 e confirmar que o atalho de inicialização funciona.
3. Parear a chave pelo painel e confirmar /api/ready.
4. Usar uma emissão/processo real já concluído; não criar emissão extra apenas para teste.
5. Conferir que o PDF aparece somente na pasta configurada e que outro download comum do Chrome continua indo para Downloads.
6. Testar nome duplicado, pasta/unidade indisponível, chave inválida, PDF inválido, queda durante upload e bloqueio de segunda tentativa.
7. Confirmar no Chrome 156 que GM_xmlhttpRequest consegue acessar loopback a partir do Tampermonkey instalado. Se a política Local Network Access bloquear a requisição, não desabilitar as proteções: investigar a política corporativa/HTTPS ou adotar outro transporte autorizado.

**Estado da v0.6.0:** proposta em branch própria. Testes automatizados e validação operacional ainda pendentes. A v0.5.0 permanece como versão da main até revisão e integração.


## 26. Orquestração completa a partir do CRM (proposta v0.2.0 — 06/11/2026)

### Objetivo e gatilho

O clique explícito em **Enviar ao Systextil** no SmartTable é o gatilho humano para iniciar uma operação completa sobre um título selecionado. A ponte continua responsável por transportar os dados e só publica o evento `smarttable:systextil:pedido-aplicado` depois de reler os dois campos auxiliares e confirmar correspondência exata.

O novo userscript `userscripts/systextil-segunda-via-automatica.user.js` recebe o evento e orquestra o helper-base. Não usa o texto do painel como única evidência do preenchimento.

### Correção da parcela

A correção tem duas barreiras independentes:

1. Depois da confirmação NXJ pelo helper-base, o orquestrador relê o formulário identificado e exige que `seq_duplicatas.` esteja preenchido e seja exatamente igual à parcela recebida do CRM. Um título visual vazio é tolerado somente quando o helper-base já confirmou o valor exato pelo NXJ, conforme comportamento validado do ERP.
2. Depois do Find, o orquestrador volta a ler título, parcela e cliente. Parcela vazia tem mensagem específica; parcela divergente bloqueia a emissão. A busca precisa retornar exatamente um registro.

Isso evita que a ausência do campo de parcela seja mascarada como divergência do título e impede que o comando de emissão aconteça com parcela não conferida.

### Cadeia automatizada

- O helper-base v0.6.1 inicializa em `document-idle` e monta o painel adequado na Consulta de títulos ou Processos agendados.
- A ponte v0.2.0 emite o evento com id, título, parcela e razão social depois da transferência validada.
- O orquestrador v0.2.0 confirma o evento contra o marcador da ponte e os campos auxiliares atuais.
- O helper-base executa o preenchimento pelos comandos NXJ, com a sequência e as confirmações exatas já cobertas nos testes anteriores.
- O orquestrador aciona Find, exige um resultado único, título/parcela/clientes conferidos, registra trava de cinco minutos e aciona Emite boleto uma única vez.
- Depois da emissão registrada, aciona `procAgendados`. Na mesma aba, aguarda a troca de visão; em nova aba, recupera a solicitação da sessão de origem.
- A análise dos processos é repetida por até três minutos, com atualização da grade configurada. Só uma linha única e concluída com sucesso segue para o download.
- O helper-base mantém seleção validada, reserva contra duplicidade, validação do PDF e envio ao auxiliar local. O sucesso depende da confirmação do auxiliar.

### Limites e riscos

- A emissão passa a ser automática após a ação explícita do usuário no CRM. Portanto, o primeiro teste precisa ser feito com um título de uma operação real já prevista; não executar uma emissão extra exclusivamente para homologação.
- O clique em `procAgendados` depende do controle do ERP já documentado. A abertura em mesma aba ou nova aba precisa ser confirmada na homologação real.
- A recuperação entre abas usa `window.opener.sessionStorage`; se o ERP abrir a visão sem preservar o vínculo de origem, a automação para e não tenta emitir novamente.
- O auxiliar local continua obrigatório e precisa estar configurado/testado antes do fluxo.
- Timeout após o clique de emissão não comprova que a emissão falhou. O script preserva a trava e orienta conferir Processos agendados.
- Timeout de download mantém a reserva em estado indeterminado. É obrigatória a conferência manual da pasta antes de liberar outra tentativa.
- Esc interrompe o orquestrador, mas não cancela uma emissão já enviada ao ERP.
- A mudança de `@run-at` do helper-base para `document-idle` faz o painel abrir automaticamente nas telas suportadas. Isso é requisito da integração e deve ser considerado no uso diário.

### Validação

- Núcleo isolado do orquestrador: 8 testes executados localmente com sucesso (06/11/2026): parcela vazia/divergente antes e depois do Find; bloqueio da emissão; sucesso único; trava de repetição; caminho de processo/download; e normalização de zeros à esquerda no título.
- Ainda pendente nesta branch: execução da suíte completa `npm run verify` (inclui todos os testes do repositório), execução dos novos testes de integração dentro do repositório e homologação no Chrome/Tampermonkey/Systextil real. Os oito testes acima foram executados contra uma cópia local do núcleo do orquestrador, não contra o runner completo da branch remota.
- A homologação deve verificar especificamente se `procAgendados` abre no mesmo contexto ou nova aba, se o evento chega depois da confirmação dos campos auxiliares e se o processo correspondente pode ser identificado sem ambiguidade.
- Não fazer merge nem publicar os userscripts até a validação operacional e revisão humana.


## 27. Userscript único e download para Downloads (v1.0.2 — 09/11/2026)

### Objetivo

Consolidar a transferência CRM, o preenchimento NXJ, a consulta, a emissão, o acompanhamento de Processos agendados e o download em um único arquivo instalável no Tampermonkey:

`userscripts/systextil-segunda-via.user.js`

O clique explícito em **Enviar ao Systextil** no SmartTable continua sendo a única autorização humana. Nenhuma emissão acontece sem esse evento.

### Mudanças em relação às versões 0.x

- Integra no mesmo userscript as funções anteriormente distribuídas entre bridge, orquestrador e helper-base.
- O monitor NXJ percorre os segmentos separados por `\\f` em `fieldValues`, mas trata a confirmação literal como diagnóstico tolerante a máscaras, zeros à esquerda e prefixos. A conclusão da operação é decidida pelo resultado do controle Find, não pela igualdade literal do payload.
- Preenche diretamente `num_duplicata.` e `seq_duplicatas.` no formulário real do Systextil; remove os campos duplicados e os painéis flutuantes.
- Mantém a sequência NXJ de foco e edição, aguarda a ociosidade das requisições e valida título/parcela antes e depois do Find com normalização de zeros à esquerda apenas para comparação.
- Exige um único registro de Find e confere título, parcela e cliente antes de clicar uma única vez em **Emite boleto**.
- Acompanha Processos agendados, identifica uma correspondência única por tipo de processo e horário, seleciona a linha conferida e valida a URL/relatório.
- Substitui o serviço Windows por download no navegador. O userscript obtém o PDF autenticado com `GM_xmlhttpRequest`, valida origem, caminho, relatório, assinatura `%PDF-`, marcador `%%EOF` e limite de 25 MB, e só então chama `GM_download` com `saveAs: false` e `conflictAction: "uniquify"`.
- Remove a dependência de PowerShell, listener loopback, chave de pareamento e pasta local exclusiva.
- Mantém trava de emissão e reserva de download para evitar repetição em estados confirmados ou indeterminados.

### Instalação

Instalar somente `userscripts/systextil-segunda-via.user.js` no Tampermonkey, habilitado nas páginas CRM e Systextil. Desativar/remover as três entradas antigas `systextil-crm-bridge.user.js`, `systextil-segunda-via-automatica.user.js` e `systextil-segunda-via-boleto.user.js`; elas foram aposentadas por metadados e não devem coexistir com a versão unificada.

Use Tampermonkey 5.4.6226 ou superior, que oferece suporte a Blob/File em `GM_download`. No modo Browser API do Tampermonkey, conceda a permissão de Downloads e permita a extensão `.pdf` na lista de extensões autorizadas; nesse modo, `saveAs: false` seleciona o destino padrão e `conflictAction: "uniquify"` evita sobrescrita. Confira as preferências de download do Chrome para que não exista uma confirmação por arquivo. Os arquivos são gravados na pasta Downloads configurada no navegador.

### Limites operacionais

- `GM_download` não permite ao userscript escolher um caminho absoluto do Windows. O destino é a pasta padrão definida pelo navegador.
- Uma política corporativa do Chrome/Tampermonkey pode bloquear downloads ou solicitar confirmação. Homologar esse comportamento na estação operacional.
- Timeout depois do clique em **Emite boleto** não comprova falha da emissão; o código não repete automaticamente.
- Apenas execuções no estado `preenchendo` podem expirar após 30 minutos. Estados posteriores, inclusive `indeterminado`, nunca são liberados automaticamente.
- Quando o resultado de `GM_download` é indeterminado, conferir a pasta Downloads antes de qualquer nova tentativa.
- `Esc` interrompe a automação local, mas não cancela uma emissão já submetida ao ERP.
- O mecanismo de lock entre abas é cooperativo no armazenamento GM; reduz disputas, mas não oferece exclusão mútua transacional.

### Testes e validação

Foi adicionada a suíte `tests/segunda-via-integrada.test.js` para contrato CRM, comparação tolerante do payload NXJ, expiração exclusiva de preenchimentos abandonados, consulta via Find, validação dos dados, identificação única de processo, ambiguidade e validação de URL/PDF. Permanecem as suítes anteriores de NXJ e regressão de regras.

Executar `npm run verify` com Node.js 18 ou superior. A suíte automatizada não substitui a homologação operacional; a nova cobertura inclui payload NXJ com máscara/prefixo, uso do controle Find e preservação de estados indeterminados.

**Estado na main em 09/11/2026:** a versão 1.0.4 está integrada pelas PRs #36 e #37. A suíte completa `npm run verify` não foi executada no registro da PR #37 e a homologação no Chrome/Tampermonkey/Systextil reais permanece pendente. Não gerar uma emissão exclusivamente para testar; aproveitar um título que já esteja previsto em uma operação real.

## 28. Bloqueio do Find sem confirmação NXJ de título e parcela (v1.0.3 — 09/11/2026)

### Causa da consulta ampla

Na v1.0.2, a confirmação literal dos valores nos comandos NXJ passou a ser apenas diagnóstica. O fluxo permitia acionar Find mesmo quando o monitor não havia confirmado o número do título. Como o ERP pode limpar visualmente o campo após o blur, essa combinação permitia que a consulta fosse enviada sem o filtro de título e retornasse vários títulos.

### Correção

- A rotina volta a exigir confirmação NXJ dos valores exatos de título e parcela em comandos de confirmação concluídos com HTTP 2xx.
- A comparação continua aceitando zeros à esquerda e prefixos explícitos de campo, sem aceitar correspondências parciais.
- O campo de título visualmente vazio só é tolerado quando seu valor foi confirmado pelo NXJ.
- A automação valida novamente as duas confirmações no orquestrador antes da etapa Find.
- Se qualquer confirmação estiver ausente, a operação termina antes do Find. Não ocorre consulta ampla, emissão ou navegação para Processos agendados.
- Os diagnósticos exibem somente nomes de comandos e comprimentos de segmentos, sem registrar valores de título/parcela, dados do cliente, cookies ou tokens.

### Testes

A suíte de integração verifica confirmação completa, título pendente, parcela pendente e ambos pendentes; também verifica que a barreira NXJ está antes do acionamento do Find.

### Validação pendente

- Executar npm run verify localmente, sem workflow de CI/CD.
- Instalar a versão 1.0.3 em uma única entrada do Tampermonkey.
- Homologar com um título já previsto para uma operação legítima, sem gerar emissão apenas para teste. Confirmar no diagnóstico que ambos os campos geraram comandos NXJ reconhecidos antes de permitir o Find.
- Se a confirmação NXJ não ocorrer, o fluxo deve parar e não se deve executar a consulta manualmente até conferir/limpar os campos.

**Estado:** a correção foi integrada à main pela PR #36 como v1.0.3; a v1.0.4 também está integrada pela PR #37. A suíte completa e a homologação operacional no ERP real continuam pendentes.


## 29. Acompanhamento de mensagens intermediárias em Processos agendados (v1.0.4 — 09/11/2026)

### Causa

A análise classificava como falha qualquer mensagem diferente de `Processo concluído com sucesso.`. A rotina encerrava o ciclo antes de chamar `atualizarGradeProcessos` quando o ERP retornava um texto intermediário ou desconhecido.

### Correção

- Somente mensagens com marcadores explícitos de erro, falha, cancelamento, rejeição, interrupção, invalidação ou negação são classificadas como falha terminal.
- Mensagens vazias, intermediárias ou desconhecidas permanecem como `em-andamento`.
- O ciclo atualiza a grade com o controle Find e reanalisa o processo a cada quatro segundos, respeitando o limite existente de três minutos.
- Se o controle de atualização não estiver disponível, ou o tempo terminar sem confirmação, o resultado é preservado como indeterminado.
- A emissão não é repetida automaticamente. O download só ocorre após confirmação literal de sucesso e revalidação do registro.

### Testes e validação

Foram adicionados testes para mensagem intermediária não vazia, erro explícito e existência do mecanismo de atualização. Os testes automatizados simulam a regra de classificação; a confirmação da lista de mensagens e do comportamento de atualização depende de homologação no Systextil real.


## 30. Estado integrado da v1.0.4 na main (09/11/2026)

A PR #37 foi integrada em 09/11/2026 pelo merge commit `57cdc19e9f6b1fe98d295e1fef360a6c2a11dea3`. A versão do userscript único na main é 1.0.4.

A rotina classifica como sucesso somente a mensagem explícita esperada `Processo concluído com sucesso.`. Mensagens vazias, intermediárias ou desconhecidas permanecem em acompanhamento. Marcadores explícitos de erro, falha, cancelamento, rejeição, interrupção, invalidação, negação, não autorização ou falta de permissão são tratados como falha terminal.

Enquanto o processo não chega a um estado terminal, a grade é atualizada pelo controle Find a cada quatro segundos, respeitando o limite de três minutos. Se o controle Find não estiver disponível para atualizar a grade, ou o prazo terminar sem confirmação de sucesso, o resultado permanece indeterminado. A emissão não é repetida e o PDF não é baixado sem sucesso explícito.

A PR #37 registrou parse sintático e dez verificações direcionadas aprovadas. A suíte completa `npm run verify` não foi executada naquela sessão e a homologação no Chrome/Tampermonkey/Systextil real continua pendente. A lista de marcadores de falha precisa ser confrontada com mensagens reais da instalação.

## 31. Correções da v1.0.5 — PR #39 (09/11/2026)

A v1.0.5 foi integrada à `main` pela PR #39 em 09/11/2026. A integração não equivale à homologação operacional no Systextil real.

### Atualização de Processos agendados

- O operador informou que o botão `procAgendados` (sininho) é o controle que deve ser acionado novamente para atualizar a grade de Processos agendados.
- O código anterior usava `btnFind.`, que pertence à Consulta de títulos e não está disponível nessa tela.
- A v1.0.5 proposta aciona `procAgendados` antes da primeira leitura e antes de cada releitura, aguarda a requisição NXJ quando observável e respeita pelo menos quatro segundos para a renderização da grade.
- Mensagens vazias, intermediárias ou desconhecidas continuam em acompanhamento. O processo só é baixado após a mensagem explícita de sucesso; falha explícita, ambiguidade ou timeout não provocam uma segunda emissão.

### Primeira busca do título

Os limites de sequência do monitor NXJ eram capturados depois de atribuir o valor e aguardar parte da sequência de foco. Uma confirmação enviada pelo ERP imediatamente após `input/change` poderia ocorrer antes do limite e não ser contabilizada. A v1.0.5 captura o limite de título e o de parcela antes de escrever cada campo.

A barreira NXJ permanece obrigatória: o Find não é acionado sem confirmação dos dois campos, e a consulta continua exigindo um único registro com título, parcela e cliente conferidos.

### Validação

Foram aprovadas 20 verificações direcionadas e o parse sintático dos arquivos alterados nesta revisão. `npm run verify` não foi executado. A validação operacional no Chrome/Tampermonkey/Systextil real continua pendente; não criar emissão extra apenas para homologar.
## 32. Recuperação de bloqueio persistido — v1.0.6 proposta

A execução anterior pode deixar um registro na chave compartilhada `smarttable.systextil.title-transfer.v1.execucao`. Os estados `emissao-solicitada`, `processando`, `baixando` e `indeterminado` são preservados sem expiração automática porque podem representar uma emissão já acionada cujo resultado não foi confirmado. Essa persistência não prova que o ERP continua processando; significa apenas que a última execução não foi encerrada com uma confirmação conclusiva.

A v1.0.6 propõe o comando de menu Tampermonkey **Segunda via: liberar bloqueio após conferência manual**. O operador deve conferir Processos agendados e Downloads, ler o estado informado pelo comando e confirmar explicitamente. O comando relê as chaves antes de limpar pedido, execução, locks locais e resultado; se o estado mudar durante a confirmação, interrompe a limpeza.

A ação não acessa nem altera o ERP, não cancela processos e não aciona outra emissão. Ela apenas remove o bloqueio compartilhado local para permitir uma nova transferência após a conferência humana. A existência e o comportamento do item de menu e a gravação no armazenamento GM ainda exigem validação em Chrome/Tampermonkey reais, sem criar emissão adicional.