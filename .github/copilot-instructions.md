# Instruções do repositório para GitHub Copilot

Leia e siga integralmente o `AGENTS.md` na raiz antes de planejar ou alterar código. Ele é a fonte principal das regras de arquitetura, negócio, segurança, testes e fluxo Git deste projeto.

Este repositório contém automações Tampermonkey usadas em um ERP empresarial. Preserve ações explícitas do operador, falhe de forma segura diante de ambiguidade e não invente comportamento de APIs internas.

Antes de alterações relevantes, inspecione implementação, testes e documentação e apresente um plano curto. Faça mudanças pequenas, mantenha a suíte completa com `npm test`, examine o diff e atualize a documentação. Não enfraqueça testes nem remova proteções para obter aprovação.

Diferencie teste unitário/mocado de validação operacional real no Systextil. Informe os comandos que efetivamente executou e os resultados observados. Não adicione dependências, permissões Tampermonkey, workflows CI/CD ou integrações externas sem necessidade demonstrada e autorização explícita.

Todo código assistido por IA precisa de revisão e aprovação humana antes do merge. Não faça merge, release ou publicação por conta própria.


Para automações Tampermonkey, consulte também `docs/guia-automacao-tampermonkey-systextil.md` e `docs/referencia-tecnica-nxj-systextil.md`. A segunda referência registra o que foi observado no NXJ, nas visões e em telas concretas, além do estado integrado v1.0.4. Aplique os padrões somente quando a evidência corresponder à tela/ambiente da tarefa; não copie nomes de campos, teclas, tempos ou APIs para outra tela sem confirmação manual.
