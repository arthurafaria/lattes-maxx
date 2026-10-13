# lattes-maxx

**Uma skill aberta para preencher, atualizar e revisar o Currículo Lattes (CNPq)**, feita para
estudantes de graduação e pós-graduação. Ela diz onde cadastrar cada coisa (bolsa de IC,
monitoria, extensão, estágio, mestrado, grupo de pesquisa, artigo, resumo em anais, relatório,
software, entrevista, documentário, evento…), dá o texto de cada campo e revisa a prévia antes
de você enviar ao CNPq.

Funciona em qualquer IA compatível com o padrão aberto de **Agent Skills**
([agentskills.io](https://agentskills.io)): Claude, ChatGPT/Codex, Gemini, GitHub Copilot,
Cursor, VS Code e outras. Para IAs sem suporte a skills, há uma versão para colar
(veja [Outras IAs](#outras-ias-sem-suporte-a-skills)).

> Projeto independente, sem vínculo com o CNPq. As orientações seguem o Manual de
> Preenchimento do Currículo Lattes (CNPq, 2026), guias de universidades e telas conferidas no
> editor em outubro de 2026. O sistema muda: quando a tela for diferente, vale a tela.

## O que ela faz

- **Mapa "o que vai onde"** para graduação e pós, inclusive casos que o manual oficial não
  cobre (monitoria, IC do ponto de vista do bolsista, estágio, empresa júnior, PET, PIBID).
- **Campo a campo**, com textos prontos para colar (português e inglês).
- **Lê o que você manda**: termo de outorga, certificado, PDF da publicação, prints e vídeos
  da tela do Lattes.
- **Revisa a prévia** antes do envio — à mão ou com um script que encontra erros comuns
  (bolsa descrita errado, laboratório como instituição, grupo como linha de pesquisa, item
  duplicado, autor faltando…).
- **Cuida da integridade**: autoria igual à do documento publicado, sem inflar papel, de
  acordo com a política de integridade do CNPq (Portaria 2.664/2026).
- Seção específica para **Comunicação, Artes e Humanidades** (reportagens, entrevistas,
  podcasts, audiovisual, curadoria, design).

## Instalação

A skill é **um arquivo só**: [`skills/lattes-maxx/SKILL.md`](skills/lattes-maxx/SKILL.md). Ele
já resolve a maioria dos casos. Quando precisa de mais detalhe ou dos scripts, a própria skill
manda a IA clonar este repositório (`~/.lattes-maxx`) e usar o que estiver lá — por isso as
referências e os scripts ficam aqui no repositório, e não dentro da skill.

| Onde você usa | Como instalar |
|---|---|
| **Claude** (claude.ai, app) | Baixe `lattes-maxx.zip` nas [Releases](../../releases). Configurações › Capacidades › ative "Execução de código e criação de arquivos". Personalizar › Skills › **+** › Enviar skill › o zip |
| **Claude Code** | `mkdir -p ~/.claude/skills/lattes-maxx && curl -L https://raw.githubusercontent.com/arthurafaria/lattes-maxx/main/skills/lattes-maxx/SKILL.md -o ~/.claude/skills/lattes-maxx/SKILL.md` |
| **Codex, Cursor, Copilot, VS Code, Gemini CLI, OpenCode** | O mesmo comando, trocando `~/.claude/skills` por `~/.agents/skills` |
| **ChatGPT / Gemini** (contas com Skills) | Skills › Enviar › `lattes-maxx.zip` |
| **Qualquer agente via GitHub CLI** | `gh skill install arthurafaria/lattes-maxx lattes-maxx --agent <agente> --scope user` |

Para a IA conseguir clonar o repositório, ela precisa poder executar comandos e acessar a
internet (Claude Code, Codex e afins conseguem; em chats na web isso depende do plano e da
configuração). Sem isso, a skill funciona só com o SKILL.md e pede prints.

## Como usar

Fale normalmente, por exemplo:

- "Ganhei bolsa PIBIC, como coloco no Lattes?"
- "Sou mestranda com bolsa CAPES e tenho um artigo aceito. O que cadastro para a Sucupira?"
- "Organizei um congresso, aqui está o certificado. Vai em participação?"
- "Gerei a prévia do meu Lattes, pode revisar?" (mande o HTML ou PDF)

O ideal é ter o editor do Lattes aberto e ir mandando prints conforme a IA guia.

## Outras IAs (sem suporte a skills)

Na pasta [`fallback/`](fallback/):

- `INSTRUCOES.md`: versão condensada (menos de 8.000 caracteres) para colar nas instruções de
  um assistente personalizado (Projeto, GPT, Gem, Copilot).
- `PROMPT-CURTO.md`: versão mínima (menos de 1.500 caracteres) para colar no início de uma
  conversa.
- Anexe também `lattes-maxx-completo.md` (gerado na Release), que junta tudo num arquivo só.

## Estrutura

```
skills/lattes-maxx/SKILL.md   a skill (é isto que se instala)
references/                   detalhes campo a campo, um arquivo por assunto
assets/modelos-de-texto.md    modelos de resumo, "Outras informações", traduções
scripts/
  revisar_previa.py           revisão automática da prévia (Python 3, sem dependências)
  extrair_quadros.py          quadros de vídeos de tela (precisa de ffmpeg)
  build_release.py            gera dist/lattes-maxx.zip e dist/lattes-maxx-completo.md
fallback/                     versões para colar em IAs sem skills
evals/  tests/                casos de avaliação e testes
```

## Contribuir

Achou uma tela diferente, um caso não coberto ou um erro? Abra uma issue com print (sem dados
pessoais) ou mande um pull request.

- Mantenha o `SKILL.md` com menos de 500 linhas e cada assunto no seu arquivo de `references/`.
- Rode `python3 -m unittest discover tests` e `python3 scripts/build_release.py`.
- Registre a mudança no `CHANGELOG.md`.
- Não copie trechos longos do manual do CNPq: resuma e cite o link.

## Licença

MIT. Veja [LICENSE](LICENSE).
