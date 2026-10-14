// Testes do revisor de prévia. Rode com: npm test  (ou: node --test "tests/*.test.ts")

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fold, razao } from "../scripts/comum.ts";
import {
  datasNoTexto, decodificar, dividirSecoes, executar, lerTexto, linearizar, main,
} from "../scripts/revisar_previa.ts";
import type { Relatorio } from "../scripts/revisar_previa.ts";
import { FIX, capturar } from "./auxiliar.ts";

const mensagens = (rep: Relatorio): string =>
  rep.itens.map((i) => `${i.nivel}|${i.area}|${i.mensagem}`).join("\n");

describe("prévia com erros", () => {
  let rep: Relatorio;
  let msgs: string;
  before(() => {
    rep = executar(join(FIX, "previa_com_erros.html"));
    msgs = mensagens(rep);
  });

  test("lê nomes em citações", () => {
    assert.ok(rep.fatos.nomes_em_citacoes?.includes("SILVA, M. E."));
  });
  test("ignora menu de navegação", () => {
    assert.ok(!rep.fatos.secoes_encontradas?.includes("Orientações"));
  });
  test("extensão misturada com PIBIC", () => assert.match(msgs, /mistura bolsa de extensão/));
  test("frases repetidas", () => assert.match(msgs, /quase a mesma coisa/));
  test("erro de digitação", () => assert.match(msgs, /aquirida/));
  test("ordinal perdido", () => assert.match(msgs, /2 lugar/));
  test("IC em formação complementar", () => assert.match(msgs, /Formação complementar/));
  test("graduação sem situação", () => assert.match(msgs, /Graduação com só um ano/));
  test("instituição é laboratório", () => assert.match(msgs, /instituição parece ser laboratório/));
  test("linha com nome de grupo", () => assert.match(msgs, /linha de pesquisa parece ser o nome do grupo/));
  test("atividades duplicadas", () => assert.match(msgs, /Duas atividades iguais/));
  test("bolsista sem projeto", () => assert.match(msgs, /nenhum projeto de pesquisa/));
  test("autor ausente", () => assert.match(msgs, /não aparece entre os autores/));
  test("itens duplicados", () => assert.match(msgs, /mesmo trabalho/));
  test("http repetido", () => assert.match(msgs, /http:\/\/» repetido/));
});

describe("prévia correta", () => {
  test("sem alertas", () => {
    const rep = executar(join(FIX, "previa_correta.html"));
    assert.deepEqual(rep.itens, [], mensagens(rep));
  });
});

describe("bolsa e artigos", () => {
  let rep: Relatorio;
  let msgs: string;
  before(() => {
    rep = executar(join(FIX, "previa_bolsa_artigos.html"));
    msgs = mensagens(rep);
  });

  test("monitoria como Outro", () => assert.match(msgs, /Monitoria cadastrada como atividade de natureza/));
  test("vigência vencida com vínculo atual", () => assert.match(msgs, /termina em 31\/07\/2026/));
  test("aceito com dados de publicação", () => assert.match(msgs, /já traz dados de publicação/));
  test("mesmo artigo em aceitos e completos", () => assert.match(msgs, /em «aceitos» e em «completos»/));
  test("aceito e completo não viram duplicata genérica", () =>
    assert.doesNotMatch(msgs, /Dois itens parecem ser o mesmo trabalho/));
  test("submetido como aceito", () => assert.match(msgs, /apenas submetido cadastrado como aceito/));
  test("preprint como artigo", () => assert.match(msgs, /preprint cadastrado como artigo/));
  test("conta itens de produção", () => assert.equal(rep.fatos.itens_de_producao, 5));
});

describe("datas", () => {
  test("datas completas e mês/ano", () => {
    const achadas = datasNoTexto("Vigências: 01/03/2026 a 31/08/2026 e, após renovação, 09/2026 a 08/2027.");
    const maxima = Math.max(...achadas.map((d) => d.getTime()));
    assert.equal(maxima, Date.UTC(2027, 7, 31));
    assert.ok(achadas.some((d) => d.getTime() === Date.UTC(2026, 7, 31)));
  });

  test("renovação cobre a data de referência", () => {
    const achadas = datasNoTexto("Vigências: 08/2025 a 07/2026 e 08/2026 a 07/2027");
    assert.ok(Math.max(...achadas.map((d) => d.getTime())) > Date.UTC(2026, 9, 10));
  });

  test("ignora datas impossíveis", () => {
    assert.deepEqual(datasNoTexto("31/02/2026 e 13/2026"), []);
  });
});

describe("HTML e texto", () => {
  test("linearizar ignora script, estilo e menu, e guarda o resumo", () => {
    const html = '<div class="menuPrincipal"><div>Atuação</div></div><script>var x="<p>não</p>"</script>' +
      '<style>p{}</style><p class="resumo">Resumo &amp; mais &aacute;</p><p>Corpo<br/>quebra</p>';
    const { parts, resumoParts } = linearizar(html);
    const texto = parts.join("");
    assert.ok(!texto.includes("Atuação") && !texto.includes("não"));
    assert.equal(resumoParts.join(""), "Resumo & mais á");
    assert.deepEqual(texto.split("\n").map((l) => l.trim()).filter(Boolean), ["Resumo & mais á", "Corpo", "quebra"]);
  });

  test("linearizar aguenta HTML malformado", () => {
    const { parts } = linearizar("a < b <p>texto <b>forte</p> 3<4 <!-- c --> fim <div");
    assert.match(parts.join(""), /a < b/);
    assert.match(parts.join(""), /fim/);
  });

  test("lê arquivo em windows-1252", () => {
    const dir = mkdtempSync(join(tmpdir(), "lattes-"));
    try {
      const arq = join(dir, "previa.html");
      const html = '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">' +
        "<p>Formação acadêmica/titulação</p><p>Atuação profissional</p>";
      writeFileSync(arq, Buffer.from(html, "latin1"));
      const { linhas } = lerTexto(arq);
      assert.ok(linhas.includes("Formação acadêmica/titulação"));
      assert.ok(dividirSecoes(linhas).has("Atuação profissional"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("windows-1252: aspas, travessões e reticências (inclusive no Node 22)", () => {
    const bytes = Uint8Array.of(0x93, 0x41, 0x94, 0x20, 0x96, 0x20, 0x97, 0x20, 0x85, 0x20, 0x92, 0x20, 0xe9);
    const html = Buffer.concat([Buffer.from('<meta charset="windows-1252">'), Buffer.from(bytes)]);
    assert.equal(decodificar(html).replace('<meta charset="windows-1252">', ""), "“A” – — … ’ é");
  });

  test("UTF-8 válido não é reinterpretado", () => {
    assert.equal(decodificar(Buffer.from("ação — “ok”")), "ação — “ok”");
  });

  test("fold tira acentos e caixa", () => assert.equal(fold("  Iniciação  CIENTÍFICA "), "iniciacao cientifica"));

  test("razao se comporta como a razão de semelhança", () => {
    assert.equal(razao("", ""), 1);
    assert.equal(razao("abc", "abc"), 1);
    assert.equal(razao("abc", "xyz"), 0);
    assert.equal(Math.round(razao("abcd", "bcde") * 100) / 100, 0.75);
    assert.ok(razao("o onibus que nao chega", "o onibus que nao chega 2024") > 0.85);
  });
});

describe("entradas inválidas", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "lattes-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const roda = (caminho: string) => {
    const s = capturar();
    const codigo = main([caminho], s);
    return { codigo, err: s.err_.join("\n") };
  };

  test("arquivo inexistente", () => {
    const { codigo, err } = roda(join(dir, "nao_existe.html"));
    assert.equal(codigo, 2);
    assert.match(err, /não encontrado/);
  });

  test("pasta", () => {
    const pasta = join(dir, "pasta");
    mkdirSync(pasta);
    const { codigo, err } = roda(pasta);
    assert.equal(codigo, 2);
    assert.match(err, /é uma pasta/);
  });

  test("arquivo que não é Lattes", () => {
    const f = join(dir, "qualquer.html");
    writeFileSync(f, "<html><body>Lista de compras: pão, leite</body></html>");
    const { codigo, err } = roda(f);
    assert.equal(codigo, 3);
    assert.match(err, /não parece ser a prévia/);
  });

  test("arquivo vazio", () => {
    const f = join(dir, "vazio.html");
    writeFileSync(f, "");
    assert.equal(roda(f).codigo, 3);
  });

  test("PDF sem texto ou sem pdftotext", () => {
    const f = join(dir, "previa.pdf");
    writeFileSync(f, "%PDF-1.4\n%fake\n");
    const { codigo, err } = roda(f);
    assert.equal(codigo, 3);
    assert.match(err, /PDF/);
  });

  test(".txt mínimo com duas seções é válido", () => {
    const f = join(dir, "previa.txt");
    writeFileSync(f, "Formação acadêmica/titulação\n2023 Graduação em andamento em Direito.\n" +
      "Atuação profissional\nUniversidade X\n");
    assert.equal(roda(f).codigo, 0);
  });

  test("sem argumentos e opção desconhecida", () => {
    const a = capturar();
    assert.equal(main([], a), 2);
    const b = capturar();
    assert.equal(main(["--nao-existe", "x"], b), 2);
  });

  test("--json devolve fatos e pontos", () => {
    const s = capturar();
    assert.equal(main([join(FIX, "previa_bolsa_artigos.html"), "--json"], s), 0);
    const dados = JSON.parse(s.out_.join("\n")) as { fatos: { itens_de_producao: number }; pontos: unknown[] };
    assert.equal(dados.fatos.itens_de_producao, 5);
    assert.ok(dados.pontos.length > 0);
  });
});
