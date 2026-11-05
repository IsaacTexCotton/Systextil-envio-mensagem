# Instruções do repositório para GitHub Copilot

Leia e siga integralmente o `AGENTS.md` na raiz antes de planejar ou alterar código. Ele é a fonte principal das regras de arquitetura, negócio, segurança, testes e fluxo Git deste projeto.

Este repositório contém automações Tampermonkey usadas em um ERP empresarial. Preserve ações explícitas do operador, falhe de forma segura diante de ambiguidade e não invente comportamento de APIs internas.

Antes de alterações relevantes, inspecione implementação, testes e documentação e apresente um plano curto. Faça mudanças pequenas, mantenha a suíte completa com `npm test`, examine o diff e atualize a documentação. Não enfraqueça testes nem remova proteções para obter aprovação.

Diferencie teste unitário/mocado de validação operacional real no Systextil. Informe os comandos que efetivamente executou e os resultados observados. Não adicione dependências, permissões Tampermonkey, workflows CI/CD ou integrações externas sem necessidade demonstrada e autorização explícita.

Todo código assistido por IA precisa de revisão e aprovação humana antes do merge. Não faça merge, release ou publicação por conta própria.


Para automações Tampermonkey, consulte também `docs/guia-automacao-tampermonkey-systextil.md`. Aplique os padrões conforme a evidência da tarefa; não copie exemplos genéricos sem validar o contexto, os campos, a integração e os limites operacionais do Systextil.
