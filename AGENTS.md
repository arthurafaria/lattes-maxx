# AGENTS.md

Este repositório contém a skill **lattes-maxx** (`skills/lattes-maxx/SKILL.md`) e o material que
ela usa: `references/`, `assets/` e `scripts/`.

- Pedidos sobre o Currículo Lattes (CNPq): siga `skills/lattes-maxx/SKILL.md` e leia as
  referências que ele indicar.
- Para mudar a skill: mantenha o SKILL.md autossuficiente e com menos de 500 linhas; detalhes
  vão em `references/`. Rode `npm test` e `npm run build` (Node.js 22.18+; os scripts são TypeScript
  rodado direto pelo Node, sem dependências), e atualize o `CHANGELOG.md`.
