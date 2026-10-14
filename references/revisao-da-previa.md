# Revisão da prévia antes do envio

Leia quando a pessoa disser que terminou, pedir revisão, mandar a prévia (HTML/PDF/prints) ou
o currículo público.

## Como obter o arquivo

Menu lateral › "Gerar arquivo para visualização e conferência" › na aba que abrir, salvar a
página (Cmd/Ctrl + S, "Página da Web, somente HTML") ou imprimir em PDF (Cmd/Ctrl + P ›
"Salvar como PDF"). Prints também servem.

## Revisão automática (se você puder executar código)

```
node scripts/revisar_previa.ts CAMINHO/DA/PREVIA.html
```

Precisa do Node.js 22.18 ou mais novo (`node -v`; o erro «Unknown file extension ".ts"» é
Node antigo). O script também lê `.txt` e PDF (o PDF
precisa do `pdftotext`; a leitura é aproximada, prefira o HTML). Arquivo que não seja a prévia
(PDF sem texto, pasta, página qualquer) gera uma mensagem de erro, não um relatório.

O script (só biblioteca padrão, sem internet) lista pontos ERRO / ATENÇÃO / INFO: resumo
confuso ou repetido, IC em Formação complementar, laboratório como instituição, grupo como
linha de pesquisa, atividades duplicadas, bolsista sem projeto, item sem o nome da pessoa,
produções duplicadas, "http://" repetido, «º» perdido, graduação sem situação, vínculo
"Atual" com vigência já vencida, monitoria ou estágio com natureza "Outro", artigo "aceito" que
já traz DOI/volume ou que também está em "completos", submetido cadastrado como aceito e
preprint cadastrado como artigo. São
heurísticas: confirme cada ponto lendo o trecho antes de recomendar mudança, e explique em
linguagem simples. Se não puder executar código, faça a checklist abaixo à mão.

## Checklist manual (na ordem do currículo)

**Cabeçalho e resumo**
- [ ] O resumo é texto próprio (não o "Texto gerado automaticamente") e tem até 4.000
      caracteres.
- [ ] Cita a situação atual: curso, bolsa (programa e agência), orientador, grupo/linha.
- [ ] Não confunde modalidades (PIBIC/PIBITI é iniciação científica, não extensão; monitoria
      não é IC).
- [ ] Não repete a mesma informação em duas frases; sem erros de digitação.
- [ ] Tempo verbal coerente com as datas (não diz "é estagiário" se o vínculo terminou).
- [ ] Ordinais: o Lattes pode apagar «º/ª» ("36 Congresso", "4 lugar"); reescreva.

**Identificação**
- [ ] "Nome em citações bibliográficas" tem todas as formas usadas nas publicações
      (separadas por ponto e vírgula).

**Formação**
- [ ] Curso atual aparece **em andamento** (só ano de início). Mestrado/doutorado com
      orientador e bolsa.
- [ ] Nada de IC, monitoria, estágio ou bolsa em Formação complementar (que é para cursos).

**Atuação profissional**
- [ ] Instituição é a universidade/empresa, não laboratório, grupo ou departamento.
- [ ] Bolsas e estágios como vínculos com datas (MM/AAAA) e "Outras informações".
- [ ] Uma atividade de "Pesquisa e desenvolvimento" por unidade e período, com a linha certa.
- [ ] Linhas de pesquisa são temas, não nomes de grupos; sem linhas repetidas.
- [ ] Vínculos encerrados têm data de fim; nada antigo marcado como "Atual".

**Projetos**
- [ ] Quem tem bolsa de pesquisa tem o projeto real cadastrado, com o coordenador e o
      financiador (natureza "Bolsa").
- [ ] Nome de projeto não é "Iniciação Científica"/"PIBIC".

**Produções e eventos**
- [ ] A pessoa aparece entre os autores de cada item, na ordem correta.
- [ ] Autoria e papel batem com o documento publicado (`integridade-e-autoria.md`).
- [ ] Sem duplicatas (atenção a artigos importados duas vezes e a "aceitos" que já saíram).
- [ ] Apresentação e anais registrados separadamente quando houve os dois.
- [ ] Seção certa para cada item (`producoes.md`, `eventos.md`).
- [ ] Links sem "http://http://".
- [ ] Se Eventos não aparece na prévia, conferir no editor (peculiaridade conhecida).

**Visibilidade**
- [ ] Itens importantes como "Público" (o que está "Privado" não aparece).

## Como apresentar a revisão

1. Comece pelo que está certo (curto).
2. Liste os problemas por prioridade, cada um com: o que está errado, por que importa (uma
   linha), onde corrigir (caminho no editor) e o texto pronto, se houver.
3. Ofereça um resumo reescrito quando o atual tiver problemas, mantendo todos os fatos da
   pessoa e sem inventar nenhum.
4. Termine com: "Depois de corrigir, gere a prévia de novo; se estiver tudo certo, envie ao
   CNPq."
