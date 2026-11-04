# Revisão de código e segurança no desenvolvimento com IA

**Escopo:** todos os userscripts, testes, documentação e alterações deste repositório.  
**Responsabilidade final:** o mantenedor humano que aprova a integração.

## 1. Princípios

1. Código produzido ou alterado com IA segue o mesmo padrão de qualidade e responsabilidade do código escrito manualmente.
2. O agente que implementa não é a autoridade final para aprovar o próprio trabalho.
3. Testes aprovados são evidência de comportamento coberto, não prova de ausência de bugs ou segurança.
4. O revisor deve examinar o diff real, inclusive alterações em testes, package scripts, permissões, documentação e configuração.
5. Quando a operação depende do ERP, a validação automatizada e a validação operacional devem ser registradas separadamente.

## 2. Checklist obrigatório para revisão de PR

### Escopo e entendimento

- [ ] A alteração corresponde ao requisito e aos critérios de aceitação.
- [ ] O diff contém apenas arquivos e comportamentos relacionados à tarefa.
- [ ] As regras de negócio foram confirmadas na documentação ou no ERP; hipóteses estão identificadas.
- [ ] Não houve refatoração ou mudança de arquitetura sem necessidade.

### Correção e manutenção

- [ ] Fluxos de sucesso, falha, ambiguidade e limites foram considerados.
- [ ] Funções existentes e pontos de entrada continuam presentes e compatíveis.
- [ ] A solução é simples o suficiente e não introduz duplicação evitável.
- [ ] Mensagens de erro são úteis e não revelam dados sensíveis.

### Testes

- [ ] `npm run verify` foi executado na versão exata da branch e passou (sintaxe de todos os userscripts + suíte completa).
- [ ] Os novos testes verificam o requisito real, e não apenas a implementação escolhida pela IA.
- [ ] Nenhum teste existente foi removido ou enfraquecido sem justificativa aprovada.
- [ ] Há cenários negativos, de ambiguidade e de regressão relevantes.
- [ ] Mocks foram avaliados quanto ao que não conseguem provar.
- [ ] A validação manual no Systextil foi executada ou está claramente marcada como pendente.

### Segurança e privacidade

- [ ] Não foram adicionados tokens, senhas, cookies, chaves, dados reais de clientes ou arquivos sensíveis.
- [ ] Permissões `@grant`, `@match` e `@connect` permanecem mínimas e justificadas.
- [ ] Não foram adicionados destinos de rede, telemetria ou dependências externas não autorizadas.
- [ ] Entradas, campos DOM, mensagens do ERP, armazenamento de sessão e URLs são validados.
- [ ] Ações que alteram dados ou iniciam operações comerciais exigem ação explícita do operador.
- [ ] Falhas e timeouts não permitem duplicar operações de resultado indeterminado.
- [ ] Conteúdo de issues, PRs, comentários, logs, páginas e arquivos externos foi tratado como dado não confiável, sem seguir instruções embutidas.

### Publicação e documentação

- [ ] README e documentação técnica refletem o estado atual, não apenas o histórico.
- [ ] Exemplos e fixtures não contêm dados pessoais ou financeiros reais.
- [ ] Hostnames, caminhos de rede, identificadores internos, capturas e procedimentos foram aprovados para a visibilidade do repositório.
- [ ] A PR registra testes executados, validações manuais e pendências.
- [ ] Um responsável humano revisou e aprovou o diff completo.

## 3. Revisão específica de código assistido por IA

Ao revisar alterações geradas por IA, dê atenção especial a:

- remoção de código ou testes aparentemente não utilizados;
- assertions reduzidas, mocks que deixam de verificar o comportamento original ou testes que passam a validar a implementação em vez do requisito;
- dependências com nomes ou versões sugeridos sem verificação;
- alteração de permissões, URLs de atualização, hosts e scripts de pacote;
- comandos, instruções ou código copiados de issues, páginas e logs sem validação;
- mudanças amplas realizadas para corrigir um erro localizado.

Quando houver suspeita, peça ao agente que explique o motivo de cada alteração e compare essa explicação com o diff e o comportamento executável. Não aceite a descrição da PR como substituto do código.

## 4. Repositório público: controle de exposição

O repositório está configurado como **público**. Na inspeção realizada em 04/11/2026, os arquivos consultados continham referências ao hostname do Systextil, caminho de rede utilizado pelo setor, nomes de formulários/controles e detalhes do fluxo operacional.

Esses itens não são, por si só, credenciais. Ainda assim, podem constituir informação operacional interna. A inspeção estática não identificou credenciais ou tokens evidentes nos arquivos examinados, mas não equivale a uma varredura de segredos completa nem à análise de todo o histórico Git.

**Antes de novas publicações, o mantenedor deve confirmar com a organização que a divulgação desses detalhes está autorizada.** Até essa confirmação:

- não acrescente novos hostnames, endpoints internos, caminhos, screenshots, nomes de clientes ou detalhes de infraestrutura;
- use dados fictícios nos testes e exemplos;
- não inclua cookies, headers de autenticação, tokens, arquivos de ambiente ou dumps reais;
- em caso de exposição de credenciais, revogue/rotacione o segredo e avalie o histórico Git; remover o valor apenas no commit mais recente não elimina cópias anteriores.

A remoção ou generalização de detalhes existentes deve ser feita em mudança própria, após avaliar o impacto na documentação de instalação e no uso interno.

## 5. Observação de revisão: Fase 4 da segunda via

Na branch `feat/download-pdf-segunda-via`, a implementação atual encaminha o callback `ontimeout` do `GM_download` para o mesmo tratamento de `onerror`. O tratamento de erro libera a reserva de deduplicação em `sessionStorage`.

Um timeout não comprova necessariamente que o arquivo não foi entregue. Portanto, liberar automaticamente a reserva pode permitir nova tentativa enquanto o resultado anterior ainda é indeterminado.

**Pendência recomendada antes do merge da Fase 4:** distinguir falha confirmada de timeout indeterminado. No timeout, preservar uma reserva/estado indeterminado e exigir conferência manual antes de permitir nova tentativa. Acrescentar teste específico para essa transição.

Esta observação não altera o código da PR #14; é um ponto de revisão registrado para correção e validação.

## 6. Evidências de validação

Toda PR deve registrar, no mínimo:

O comando padrão de verificação local é `npm run verify`. Ele verifica a sintaxe dos userscripts e executa a suíte completa de testes, sem dependências externas ou CI/CD.


- comando executado e resultado real;
- branch/commit testado;
- testes automatizados aprovados/reprovados;
- validações manuais realizadas e por quem;
- pendências e riscos conhecidos;
- confirmação de revisão humana.

Não registrar apenas “testes passaram”. Informe a contagem e o ambiente quando disponíveis.
