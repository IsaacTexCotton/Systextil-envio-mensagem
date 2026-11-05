# Auxiliar local de boletos — Windows

O auxiliar recebe o PDF validado pelo userscript e grava o arquivo diretamente na pasta configurada. Ele não altera a pasta padrão do Chrome e não usa a janela Salvar como.

## Requisitos

- Windows 10 ou 11.
- Windows PowerShell 5.1, incluído no Windows.
- Tampermonkey atualizado e com suporte a GM_xmlhttpRequest, GM_getValue e GM_setValue.
- Acesso à pasta de destino durante a sessão do Windows.

Não exige Python, Node.js, pacotes externos, serviço Windows, tarefa agendada ou execução como administrador.

## Instalação

1. Baixe a pasta tools/boleto-helper completa do repositório.
2. Abra o PowerShell nessa pasta.
3. Execute:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Instalar.ps1

4. Informe a pasta de destino quando solicitado. O padrão sugerido é:

    V:\Financeiro\Contas à Receber\Administrativo - Atualização\Banco\Boletos (2ª via)

5. O instalador valida se a pasta já existe e está acessível. Não cria silenciosamente uma pasta em outro local se a unidade de rede estiver indisponível.
6. O instalador cria a configuração em %LOCALAPPDATA%\TexCotton\BoletoHelper\config.json, copia o serviço para essa pasta, cria um atalho na inicialização do Windows e inicia o auxiliar minimizado.
7. Copie a chave de pareamento exibida no PowerShell. Ela é gerada aleatoriamente e não deve ser compartilhada.

O instalador não modifica a política global de execução do PowerShell, não abre portas no firewall e não registra o auxiliar como serviço. O listener atende somente em 127.0.0.1:17834.

## Pareamento com o Tampermonkey

1. Atualize o userscript para a v0.6.0.
2. Aceite as permissões de conexão do Tampermonkey para systextil.texcotton.com.br e 127.0.0.1, caso sejam solicitadas.
3. Abra Processos agendados e ative o painel.
4. No bloco Chave do auxiliar local, cole a chave exibida pelo instalador.
5. Clique em Salvar chave e testar auxiliar.
6. Aguarde a confirmação de que o auxiliar respondeu e a pasta de destino está acessível.

A chave é armazenada com GM_setValue no armazenamento do userscript, não no localStorage do Systextil. Se a chave for alterada no campo, o pareamento salvo é invalidado até novo teste bem-sucedido.

## Fluxo de gravação

1. O userscript identifica o processo e o operador solicita o download.
2. O userscript obtém o PDF autenticado do próprio Systextil por GM_xmlhttpRequest, mantendo o envio de cookies habilitado.
3. Confere status HTTP, URL final, origem, caminho, relatório e assinatura binária do PDF.
4. Envia somente os bytes do PDF, o nome do arquivo e a chave para http://127.0.0.1:17834/api/pdf.
5. O auxiliar valida a chave, o nome, o tipo/conteúdo do arquivo e o limite de 25 MB.
6. O auxiliar grava primeiro em arquivo temporário na própria pasta e depois move atomicamente para o nome final. Nunca sobrescreve um PDF existente: acrescenta (2), (3) etc.
7. O userscript só exibe sucesso depois de receber a confirmação HTTP do auxiliar.

Não há fallback para GM_download. Se o auxiliar estiver parado, a pasta estiver indisponível, a chave for inválida ou a conexão local for bloqueada pelo navegador, o download é interrompido e o painel informa o erro.

## Iniciar, parar e remover

O atalho criado pelo instalador inicia o auxiliar quando o usuário entra no Windows. Para encerrá-lo sem esperar o próximo logoff, execute:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Parar.ps1

Para impedir a inicialização automática, remova ou desative o atalho TexCotton - Auxiliar de boletos na pasta Inicializar do Windows.

Para remover completamente, pare o auxiliar, remova o atalho e exclua %LOCALAPPDATA%\TexCotton\BoletoHelper. Excluir essa pasta também remove a chave local e o caminho configurado.

## Segurança e privacidade

- O socket escuta exclusivamente em 127.0.0.1, nunca em 0.0.0.0 ou no endereço da rede.
- O serviço valida o endereço remoto, o cabeçalho Host e uma chave aleatória de 256 bits.
- /api/ready, /api/pdf e /api/stop exigem a chave. O endpoint /health não retorna dados da pasta ou da configuração.
- O diretório de destino vem exclusivamente do arquivo local de configuração. A requisição não pode escolher nem sobrescrever outro caminho.
- O nome não pode conter separadores de diretório, caracteres inválidos do Windows ou caminho relativo.
- O PDF é limitado a 25 MB, precisa começar com %PDF- e conter %%EOF no trecho final.
- Arquivos existentes não são substituídos.
- O serviço não lê cookies, credenciais, títulos, dados de cliente nem faz requisições ao Systextil.
- O log do console registra somente horário, método e status HTTP. Não registra token, nome do arquivo, cliente, título ou conteúdo do PDF.
- A configuração contém a chave em texto local no perfil do usuário. Não publique, sincronize ou envie config.json a terceiros.

## Diagnóstico

| Sintoma | Verificação |
|---|---|
| Conexão recusada | Confirme se o auxiliar está ativo e se a porta 17834 não está ocupada. |
| HTTP 401 | Refaça o pareamento com a chave exibida pela configuração atual. |
| HTTP 503 | A unidade V: ou a pasta selecionada não está acessível na sessão atual. |
| HTTP 413 | O PDF excedeu 25 MB. |
| Tampermonkey não conecta a 127.0.0.1 | Confira a permissão @connect 127.0.0.1 e a política de acesso à rede local do Chrome. O teste do painel é a validação real do ambiente. |
| Download sem confirmação | Não tente novamente imediatamente. Confira a pasta: a gravação pode ter ocorrido antes da queda da conexão. O userscript mantém a reserva como indeterminada. |

## Limitação conhecida da homologação

O auxiliar é executado pelo Windows PowerShell e o listener local usa TcpListener IPv4. A execução, o pareamento, o upload binário, a gravação na unidade de rede e a compatibilidade com as políticas de rede do Chrome precisam ser validados na estação real. Os testes Node.js verificam o contrato do userscript e a presença das proteções no auxiliar; não executam PowerShell nem substituem esse teste operacional.
