# Changelog

## 1.1.2 — 2026-10

Melhorias vindas de testes de usabilidade com perfis variados de estudante (graduação e pós,
várias áreas) usando só o `SKILL.md`, como num chat sem terminal.

- **Versão em inglês**: a skill passou a explicar que o Lattes gera a versão sozinho, com a
  permissão dada no envio (botão "English"), o que é traduzido e o que depende da aba
  "Traduções" (item por DOI não aceita). Antes, a IA afirmava que o Lattes não traduz.
- **Acesso e criação do Lattes** no próprio `SKILL.md`: entrar pelo portal ("Falha na
  autenticação"), senha, bloqueio, cadastro de quem não tem Lattes e de estrangeiro sem CPF
  (passaporte). Menu do editor, com a nota de que Projetos é módulo próprio.
- **Ritmo da resposta**: primeira resposta com o mapa "item › onde vai", o primeiro formulário
  e as perguntas que faltam; o resto, um formulário por vez (a menos que a pessoa peça "tudo").
- **Bolsas, casos frequentes** (`SKILL.md` e `references/atuacao-vinculos-e-atividades.md`):
  duas bolsas ao mesmo tempo, mudança de orientador/projeto, bolsa que terminou, bolsa de FAP
  (número do processo), PET, PIBID/Residência Pedagógica, PIBIC-EM, auxílio permanência e
  ProUni (não registrar), orientador que não cadastrou o projeto.
- **Artigos** (`references/producoes.md`): cadastro à mão quando o DOI falha; preprint,
  resenha e artigo com centenas de autores marcados como "sem regra no manual do CNPq" (a IA
  deve dizer isso e mandar confirmar com o orientador ou programa); recitais e discos em Música.
- Doutorado sanduíche (Tipo "Sanduíche"), regra de não citar de memória ISSN ou nome oficial de
  bolsa e de manter a ordem de autoria do PDF publicado.
- `revisar_previa.py`: lê PDF (com `pdftotext`) e .txt, e recusa com mensagem clara PDF sem
  texto, pasta e arquivos que não são a prévia (antes gerava relatório enganoso ou dava
  traceback). Novas checagens: vínculo "Atual" com vigência já vencida, monitoria e estágio com
  natureza "Outro", artigo "aceito" que já tem DOI/volume ou que também está em "completos",
  submetido cadastrado como aceito, preprint cadastrado como artigo. Resumo no relatório.
- `python` no lugar de `python3` no Windows; `fallback/` atualizado.

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
