// Testes da ficha de artigo (sem internet: a consulta à Crossref é simulada).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  ErroHttp, cslParaCrossref, doisNoTexto, limparDoi, limparMarcacao, main, marcarVoce, montarFicha,
  nomeCitado, passos, procurarNaPrevia, rede,
} from "../scripts/extrair_artigo.ts";
import type { Crossref } from "../scripts/extrair_artigo.ts";
import { FIX, capturar } from "./auxiliar.ts";

const resposta = (nome: string): { message: Crossref } =>
  JSON.parse(readFileSync(join(FIX, nome), "utf8")) as { message: Crossref };
const carrega = (nome: string): Crossref => resposta(nome).message;

const redeOriginal = rede.baixarJson;
afterEach(() => {
  rede.baixarJson = redeOriginal;
});

describe("DOI", () => {
  test("limpa formas comuns", () => {
    for (const entrada of [
      "10.5555/abc.123", "https://doi.org/10.5555/abc.123", "doi:10.5555/abc.123",
      "DOI: 10.5555/abc.123.", "http://dx.doi.org/10.5555/abc.123",
    ]) {
      assert.equal(limparDoi(entrada), "10.5555/abc.123", entrada);
    }
  });

  test("sem DOI", () => assert.equal(limparDoi("não é um doi"), null));

  test("dois no texto, sem repetir", () => {
    const achados = doisNoTexto("doi:10.1234/aa.1, https://doi.org/10.2222/bb-2). De novo 10.1234/AA.1");
    assert.deepEqual(achados, ["10.1234/aa.1", "10.2222/bb-2"]);
  });
});

describe("ficha de artigo", () => {
  const f = montarFicha(carrega("crossref_artigo.json"), "10.5555/rep.2026.001");

  test("tipo e seção", () => {
    assert.equal(f.tipo, "artigo");
    assert.match(f.onde_cadastrar, /Artigos completos publicados em periódicos/);
  });

  test("título sem marcação e com subtítulo", () => {
    assert.equal(f.titulo, "Ansiedade e rotina de estudo em universitários: um estudo longitudinal");
  });

  test("campos", () => {
    assert.equal(f.periodico, "Revista Exemplo de Psicologia");
    assert.deepEqual([f.volume, f.fasciculo], ["12", "3"]);
    assert.deepEqual([f.pagina_inicial, f.pagina_final], ["101", "115"]);
    assert.equal(f.idioma, "Português");
    assert.deepEqual(f.issn, { print: "1234-5678", electronic: "8765-4321" });
    assert.equal(f.home_page, "revista.exemplo.org/artigo/001");
  });

  test("ano vem do fascículo e avisa a diferença", () => {
    assert.equal(f.ano, 2026);
    const textos = f.avisos.map((a) => a.texto).join(" ");
    assert.match(textos, /Publicado online em 2025/);
    assert.match(textos, /ISSN impresso e eletrônico/);
  });

  test("nome como citado", () => {
    assert.deepEqual(f.autores.map((a) => a.citado), ["MODELO, P.", "DE ALMEIDA, C. T.", "SILVA NETO, J. P."]);
  });

  test("o DOI mantém a forma pedida", () => {
    assert.equal(montarFicha(carrega("crossref_artigo.json"), "10.5555/REP.2026.001").doi, "10.5555/REP.2026.001");
  });
});

describe("preprint e casos especiais", () => {
  test("preprint não é artigo", () => {
    const f = montarFicha(carrega("crossref_preprint.json"), "10.1590/SciELOPreprints.0001");
    assert.equal(f.tipo, "preprint");
    const textos = f.avisos.map((a) => a.texto).join(" ");
    assert.match(textos, /preprint/i);
    assert.match(textos, /todo em maiúsculas/);
    assert.match(passos(f).join(" "), /Confirme com o orientador/);
  });

  test("autor institucional", () => {
    const f = montarFicha(carrega("crossref_preprint.json"), "10.1590/SciELOPreprints.0001");
    assert.equal(f.autores[1]?.institucional, true);
  });

  test("número de artigo eletrônico e retratação", () => {
    const f = montarFicha(carrega("crossref_eletronico.json"), "10.5555/outra.2026.e044");
    assert.equal(f.numero_artigo_eletronico, "e044");
    assert.equal(f.pagina_inicial, "");
    assert.equal(f.meio, "Meio digital");
    assert.equal(f.idioma, "Inglês");
    assert.ok(f.avisos.some((a) => a.nivel === "ERRO" && a.texto.includes("RETRATADO")));
  });

  test("lista longa de autores", () => {
    const msg = carrega("crossref_artigo.json");
    msg.author = Array.from({ length: 60 }, (_, i) => ({ given: `A${i}`, family: `Sobrenome${i}` }));
    const f = montarFicha(msg, "10.5555/rep.2026.001");
    assert.ok(f.avisos.some((a) => a.texto.includes("60 autores")));
  });

  test("CSL do doi.org vira o formato da Crossref", () => {
    const msg = cslParaCrossref({
      DOI: "10.48550/arXiv.1706.03762", type: "article", title: "Attention Is All You Need",
      author: [{ given: "Ashish", family: "Vaswani" }], issued: { "date-parts": [[2017]] },
      URL: "https://arxiv.org/abs/1706.03762",
    });
    assert.equal(msg.type, "posted-content");
    const f = montarFicha(msg, "10.48550/arXiv.1706.03762");
    assert.equal(f.tipo, "preprint");
    assert.equal(f.ano, 2017);
    assert.equal(f.home_page, "arxiv.org/abs/1706.03762");
  });

  test("limpa marcação e entidades do título", () => {
    assert.equal(limparMarcacao("A <i>b</i> &amp; c&nbsp;d"), "A b & c d");
  });

  test("nomeCitado ignora partículas e hifens", () => {
    assert.equal(nomeCitado("Jean-Pierre da", "Silva"), "SILVA, J. P.");
    assert.equal(nomeCitado("", "Hinton"), "HINTON");
  });
});

describe("conferência com o PDF", () => {
  const TEXTO = "Ansiedade e rotina de estudo em univer-\nsitários: um estudo longitudinal\n" +
    "Paulo Modelo, Carla Teste de Almeida e João Pedro Silva Neto\ndoi:10.5555/rep.2026.001";

  test("título com hifenização", () => {
    const f = montarFicha(carrega("crossref_artigo.json"), "10.5555/rep.2026.001", TEXTO);
    assert.equal(f.confere_com_pdf?.titulo, true);
    assert.equal(f.confere_com_pdf?.autores, 1);
    assert.equal(f.avisos.filter((a) => a.texto.includes("não aparece no texto")).length, 0);
  });

  test("PDF de outro artigo", () => {
    const f = montarFicha(carrega("crossref_artigo.json"), "10.5555/rep.2026.001",
      "Um artigo qualquer sobre geologia de Maria Souza");
    assert.equal(f.confere_com_pdf?.titulo, false);
    assert.ok(f.avisos.some((a) => a.texto.includes("não aparece no texto")));
  });
});

describe("marcar a pessoa", () => {
  const autores = montarFicha(carrega("crossref_artigo.json"), "x").autores;

  test("acha pela inicial e sobrenome", () => {
    assert.deepEqual(marcarVoce(autores, ["Carla Teste de Almeida"]).posicoes, [2]);
    assert.deepEqual(marcarVoce(autores, ["Carla Almeida"]).posicoes, [2]);
  });
  test("não acha", () => assert.deepEqual(marcarVoce(autores, ["Pedro Souza"]).posicoes, []));
  test("nome não informado", () => assert.equal(marcarVoce(autores, []).informado, false));
});

describe("já está no Lattes?", () => {
  test("acha o artigo e o aceito", () => {
    const achados = procurarNaPrevia(join(FIX, "previa_bolsa_artigos.html"), "10.1234/rep.2026.001",
      "Ansiedade e rotina de estudo em universitários");
    const subs = new Set(achados.map((a) => a.subsecao));
    assert.ok(subs.has("Artigos completos publicados em periódicos"));
    assert.ok(subs.has("Artigos aceitos para publicação"));
  });

  test("não acha o que não está", () => {
    assert.deepEqual(procurarNaPrevia(join(FIX, "previa_bolsa_artigos.html"), "10.9/zzz",
      "Geologia dos Andes: sedimentos e falhas"), []);
  });
});

describe("fluxo", () => {
  test("DOI gera ficha com passo a passo", async () => {
    rede.baixarJson = async () => resposta("crossref_artigo.json");
    const s = capturar();
    const codigo = await main(["https://doi.org/10.5555/rep.2026.001", "--eu", "Carla Teste Almeida"], s);
    const saida = s.out_.join("\n");
    assert.equal(codigo, 0);
    assert.match(saida, /# Ficha do artigo para o Lattes/);
    assert.match(saida, /← você/);
    assert.match(saida, /Passo a passo no Lattes/);
    assert.match(saida, /Incluir novo item/);
  });

  test("--json", async () => {
    rede.baixarJson = async () => resposta("crossref_artigo.json");
    const s = capturar();
    assert.equal(await main(["10.5555/rep.2026.001", "--json"], s), 0);
    assert.equal((JSON.parse(s.out_.join("\n")) as { ficha: { volume: string } }).ficha.volume, "12");
  });

  test("DOI que não existe gera aviso, não erro", async () => {
    rede.baixarJson = async () => {
      throw new ErroHttp(404);
    };
    const s = capturar();
    assert.equal(await main(["10.9999/nao.existe"], s), 0);
    assert.match(s.out_.join("\n"), /Nenhum dos DOIs encontrados existe/);
  });

  test("sem internet: mensagem clara e código 2", async () => {
    rede.baixarJson = async () => {
      throw new TypeError("fetch failed");
    };
    const s = capturar();
    assert.equal(await main(["10.5555/rep.2026.001"], s), 2);
    assert.match(s.err_.join("\n"), /Sem acesso à Crossref/);
  });

  test("erro 500 da Crossref", async () => {
    rede.baixarJson = async () => {
      throw new ErroHttp(500);
    };
    const s = capturar();
    assert.equal(await main(["10.5555/rep.2026.001"], s), 2);
    assert.match(s.err_.join("\n"), /erro 500/);
  });

  test("entrada inválida", async () => {
    const s = capturar();
    assert.equal(await main(["isto não é doi"], s), 2);
    assert.match(s.err_.join("\n"), /Não entendi/);
  });

  test("sem argumentos", async () => {
    const s = capturar();
    assert.equal(await main([], s), 2);
  });

  test("offline não consulta a internet", async () => {
    rede.baixarJson = async () => {
      throw new Error("não devia consultar");
    };
    const s = capturar();
    assert.equal(await main(["10.5555/rep.2026.001", "--offline"], s), 0);
    assert.match(s.out_.join("\n"), /Modo offline/);
  });
});
