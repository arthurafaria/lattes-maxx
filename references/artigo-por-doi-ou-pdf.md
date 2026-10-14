# Artigo por DOI ou PDF: ficha e passo a passo

Leia quando a pessoa mandar um **DOI**, o **PDF de um artigo** (ou os dois) e quiser colocá-lo
no Lattes. O objetivo é devolver uma **ficha** (os campos prontos para conferir) e o **passo a
passo** do cadastro, sem inventar nenhum dado.

## Sumário
- Fluxo em 6 passos
- Passo 1: pegar os dados (script, PDF ou DOI)
- Passo 2: conferir dados × PDF
- Passo 3: classificar o item
- Passo 4: já está no Lattes?
- Passo 5: a ficha
- Passo 6: o passo a passo (artigo publicado)
- Se o DOI não funcionar, ou não houver DOI
- Artigo aceito (carta de aceite)
- Anais, capítulo e livro
- Vários artigos de uma vez
- Erros que o Lattes dá, e o que fazer

## Fluxo em 6 passos

1. Pegar os dados do artigo (script, PDF ou DOI).
2. Conferir os dados com o PDF publicado.
3. Classificar: publicado, aceito, preprint, anais, capítulo…
4. Ver se já está no Lattes ou se um coautor já cadastrou.
5. Entregar a ficha (campos + autores na ordem, com a pessoa marcada).
6. Guiar o cadastro, um formulário só, passo a passo.

## Passo 1: pegar os dados

**Com terminal e internet** (use o repositório clonado, ver SKILL.md):

```
node scripts/extrair_artigo.ts DOI_ou_CAMINHO_DO_PDF --eu "Nome Completo" [--previa PREVIA.html]
```

- Aceita DOI (`10.1590/…`, ou o link `https://doi.org/…`), PDF, ou os dois juntos.
- `--eu` (repetível) marca a pessoa entre os autores e diz a posição; `--previa` avisa se o
  artigo **já está** no Lattes; `--json` dá a saída completa; `--offline` não consulta nada.
- Lê o PDF com `pdftotext` (macOS: `brew install poppler`). O **PDF não sai do computador**: só
  o DOI vai à Crossref, que é uma base pública. Se o PDF não tem DOI, o script busca pelo
  **título** e só aceita o resultado se o título aparecer no texto do PDF.
- DOIs de preprints e repositórios (arXiv, Zenodo…) vêm da DataCite pelo `doi.org`.
- Precisa do Node.js 22.18 ou mais novo (`node -v`).

**Sem terminal, com o PDF anexado**: leia a primeira página e anote título (como publicado),
autores **na ordem**, periódico, ISSN (se houver), ano, volume, fascículo, páginas (ou número do
artigo eletrônico), DOI, idioma e se saiu em meio impresso, digital ou ambos.

**Só o DOI e sem como consultá-lo** (chat sem internet): **não invente** título, autores nem
revista. Diga que não consegue abrir o DOI daqui e peça o PDF (ou a referência completa, ou o
print da página do artigo). Se a IA tiver busca na web, consulte a página do DOI e trate o
resultado como dado a conferir com o PDF.

**Só o PDF** (sem terminal): procure o DOI na primeira página (ou no rodapé). Com o DOI você
pode pedir à pessoa que confirme o link `https://doi.org/` dele; o Lattes preenche tudo ao
receber o DOI.

## Passo 2: conferir dados × PDF

A fonte do cadastro é o **artigo publicado**, não a base de dados. Confira:

- **Título**: igual ao do PDF (a base às vezes traz tudo em maiúsculas, sem subtítulo ou com
  marcação).
- **Autores**: mesma lista e **mesma ordem** do PDF, com a pessoa incluída. Se a pessoa não
  aparece, não cadastre: veja `integridade-e-autoria.md`.
- **Ano**: o do fascículo/capa (o artigo pode ter saído online em outro ano).
- **ISSN**: revistas têm ISSN impresso e eletrônico; o Lattes dá erro se o ISSN não for da
  versão certa. Use o que está no PDF ou no rodapé.
- **DOI × PDF**: um PDF pode citar DOIs de outros trabalhos. O script confere o título da base
  com o texto do PDF e avisa quando não bate.

Se algo divergir, **vale o PDF publicado**. Se o próprio PDF tiver erro, a correção é com a
revista (errata), não no Lattes (`integridade-e-autoria.md`).

## Passo 3: classificar o item

| O que é | Onde vai |
|---|---|
| Artigo publicado em periódico com ISSN | Produções › Produção bibliográfica › **Artigos completos publicados em periódicos** |
| Carta de aceite, sem publicação (no prelo) | **Artigos aceitos para publicação** (excluir e recadastrar como completo quando sair) |
| Só submetido / em avaliação | **Não entra** como produção |
| Preprint (SciELO Preprints, arXiv, SSRN, bioRxiv…) | **Sem regra no manual do CNPq.** Não é artigo publicado nem aceito: não use «completos» nem «aceitos». Confirme com o orientador ou o programa; a opção mais usada é «Outra produção bibliográfica» dizendo que é preprint. Se for versão prévia de um artigo já cadastrado, não duplique |
| Trabalho em congresso (anais) | **Trabalhos publicados em anais de eventos** (Completo, Resumo ou Resumo expandido) |
| Capítulo ou livro | **Livros e capítulos** |
| Tese, dissertação, TCC | Não é produção: fica no **curso**, em Formação |
| Artigo **retratado** | Não cadastre sem falar com o orientador |

## Passo 4: já está no Lattes?

- Pela prévia (`--previa`) ou olhando Produções › Produção bibliográfica.
- Se estiver em «Artigos aceitos» e já saiu: exclua de lá e cadastre em «completos» (senão
  duplica).
- Se **um coautor já cadastrou** (o orientador, por exemplo): use **«Importação de produção»**
  (menu lateral) em vez de digitar. O coautor precisa permitir em **«Autores citados no
  currículo»**; só vale para artigos completos. Verde = ainda não cadastrado; vermelho = já
  está; amarelo = título parecido (confirme). Importar também garante que título, DOI e autores
  batam com o Lattes do orientador, que é o que o Sucupira compara.

## Passo 5: a ficha

Entregue em tabela, para a pessoa **conferir com o PDF**:

| Campo do Lattes | Valor |
|---|---|
| DOI (a partir de «10.») | |
| Título (como publicado) | |
| Ano | |
| Idioma | |
| Meio de divulgação | Impresso, Meio digital ou Vários |
| Home page (sem «http://») | |
| Periódico / ISSN | |
| Volume · Fascículo · Páginas (ou nº do artigo) | |

e a lista de **autores numerados, na ordem**, com a pessoa marcada («← você») e uma sugestão
de «Nome como citado» (formato `SOBRENOME, N. N.`; use as formas que a pessoa já tem em «Nome
em citações bibliográficas»). Termine com os **avisos** (preprint, título em maiúsculas,
ISSN duplo, ano online × fascículo, lista longa de autores).

## Passo 6: o passo a passo (artigo publicado, com DOI)

Siga o manual do CNPq (2026), seção «Artigos completos publicados em periódicos». Um passo por
vez; peça print se algum rótulo estiver diferente.

1. Entre pelo portal **lattes.cnpq.br** › «Atualizar currículo».
2. Menu **Produções** › **Produção bibliográfica** › **Artigos completos publicados em
   periódicos** › **Incluir novo item**.
3. No campo **DOI**, digite só a parte a partir de «10.» (sem `https://doi.org/`) e clique em
   outro campo. O Lattes recupera os dados e cria um ícone que leva ao artigo.
4. **Confira** cada campo com a ficha e o PDF:
   - *Dados gerais*: título completo como publicado, ano, idioma, meio de divulgação, home page
     (sem «http://»: o Lattes acrescenta e o prefixo duplicado quebra o link);
   - *Detalhamento*: título do periódico, ISSN, volume, série, página inicial (ou número do
     artigo eletrônico) e página final.
5. Aba **Autores**: todos, na ordem de publicação, com o nome da pessoa entre eles.
   «Listar todos» para quem já está no currículo; «Incluir novo» para os demais (Nome completo
   + Nome como citado, com pelo menos duas partes). Para coautores com Lattes, use «Identificar
   co-autor» (menu lateral) para ligar os currículos.
6. Opcional: palavras-chave e áreas do conhecimento (ajudam na busca). A estrela de «um dos 10
   trabalhos mais relevantes» vale com parcimônia.
7. **Salvar**. Cuidado: o botão **Excluir** fica ao lado. Itens cadastrados pelo DOI **não têm
   a aba «Traduções»**: para título em inglês, cadastre à mão.
8. Repita para os outros artigos. No fim: **Enviar** (alto, à direita) › «Li e estou de
   acordo…» › **Enviar ao CNPq**. Salvar não publica; a atualização leva até 24 h.

## Se o DOI não funcionar, ou não houver DOI

O manual do CNPq prevê o caminho manual: na primeira tela do item, em vez do DOI, use o
**ISSN** ou o **nome do periódico** (lupa). Aparece um quadro com os dados do periódico:

1. **ISSN** (confira se é o da versão certa: com o ISSN errado o Lattes dá erro);
2. **Nome do periódico** (escolha pela lupa; **não crie periódico novo** se já existir);
3. **Volume**, **Edição** (fascículo) e **Página inicial**;
4. **DOI**, se houver (campo próprio).

Depois, *Dados gerais* (título, ano, idioma, meio de divulgação, home page), *Detalhamento*
(periódico, ISSN, volume, série, página inicial ou número do artigo eletrônico, página final)
e *Autores*, como no passo 6. Copie tudo do **PDF publicado**. Item cadastrado à mão aceita
«Traduções».

Se o DOI funcionou mas veio errado (ISSN trocado, título truncado), corrija os campos antes
de salvar; o que vale é o PDF.

## Artigo aceito (carta de aceite)

Produções › Produção bibliográfica › **Artigos aceitos para publicação** (no prelo). Campos:
**DOI** (só se já existir, comum em publicação online adiantada, e então os dados vêm
sozinhos); *Dados gerais*: título como na carta de aceite, ano previsto, idioma do manuscrito;
*Detalhamento*: periódico e ISSN pela lupa; *Autores*: todos, na ordem do manuscrito aceito.
Guarde a carta de aceite. **Quando o artigo sair, exclua este item e cadastre em «completos»**
com volume e páginas. Artigo só submetido não entra.

## Anais, capítulo e livro

- **Anais**: Produção bibliográfica › Trabalhos publicados em anais de eventos. Natureza:
  Completo, Resumo ou Resumo expandido; título do **trabalho** (não do evento); nome do evento
  sem «º/ª» («36 Congresso»), cidade, ano, título dos anais, ISSN/ISBN. Apresentou e publicou:
  são dois registros (`eventos.md`).
- **Capítulo / livro**: Livros e capítulos (ISBN do livro; o Lattes pode preencher o resto).
  Título do capítulo, título do livro, organizadores, edição, cidade, editora, ano, páginas.

## Vários artigos de uma vez

- Uma **ficha por artigo**, e uma tabela-resumo no início (artigo, tipo, onde vai, situação).
- Separe: publicados (pelo DOI), sem DOI (à mão), aceitos, preprints/submetidos (fora ou à parte).
- Cadastre **um de cada vez**, conferindo; envie ao CNPq **uma vez**, no fim.
- Para quem tem coautor com Lattes: «Importação de produção» poupa digitação e erro.
- O manual do CNPq não lista importação em lote por BibTeX, ORCID ou Google Acadêmico; o
  «Assistente de importação» busca no Oasisbr e «Importar» lê XML do Lattes.

## Erros que o Lattes dá, e o que fazer

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Erro ao salvar com ISSN | ISSN impresso × eletrônico, ou ISSN de outro periódico | Use o ISSN do PDF; escolha o periódico pela lupa |
| DOI «não encontrado» | Artigo muito recente, DOI digitado com `https://doi.org/`, ou DOI fora da Crossref | Digite a partir de «10.»; espere alguns dias; cadastre à mão |
| Link que não abre | «http://» digitado (o Lattes acrescenta e duplica) | Apague o prefixo |
| Autores fora de ordem ou faltando | Lista copiada de outra fonte | Reordene com as setas ▲▼ e confira com o PDF |
| Pessoa fora da lista de autores | Grafia diferente do nome | Inclua o nome como no artigo e acrescente a forma em «Nome em citações» |
| Mesmo artigo duas vezes | Cadastro em «aceitos» e em «completos», ou DOI e à mão | Exclua um; confira a prévia |
| Sem aba «Traduções» | Cadastro pelo DOI | Cadastre à mão se precisar do título em inglês |

Fontes: Manual de Preenchimento do Currículo Lattes (CNPq, 2026), seções «Produções» (códigos
DOI/ISSN/ISBN), «Artigos completos publicados em periódicos» e «Artigos aceitos para
publicação»; `producoes.md` e `integridade-e-autoria.md` deste repositório.
