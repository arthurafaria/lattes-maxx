# Changelog

## 1.1.1 — 2026-10

- Descrição da skill enxuta: agora diz só quando ela deve ser invocada.

## 1.1.0 — 2026-10

- A skill virou um arquivo só (`SKILL.md`), autossuficiente para os casos comuns. Referências,
  modelos e scripts saíram da skill para a raiz do repositório; a skill manda a IA clonar o
  repositório quando precisa deles.
- Removido o marketplace de plugin do Claude Code (isto é uma skill, não um plugin).

## 1.0.0 — 2026-10

Primeira versão.

- Skill `lattes-maxx` no padrão Agent Skills: fluxo de condução, regras contra os erros mais
  comuns, privacidade e formato de resposta.
- 14 referências: mapa "o que vai onde", acesso e envio, dados gerais e resumo, formação,
  atuação (vínculos e atividades), grupos de pesquisa (DGP), projetos, produções, eventos,
  pós-graduação, Comunicação e Artes, integridade e autoria, revisão da prévia, fontes e
  normas.
- Modelos de texto (resumo, "Outras informações", descrições, traduções).
- Scripts: `revisar_previa.py` (revisão automática da prévia) e `extrair_quadros.py`
  (quadros de vídeos de tela).
- Versões para IAs sem skills (`fallback/`), marketplace do Claude Code, testes e casos de
  avaliação.
