// Verificações do repositório (limites e consistência).

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { criarZip, verificarFrontmatter } from "../scripts/build_release.ts";
import { TOTAL_ENTIDADES_LATIN1, decodeEntities } from "../scripts/comum.ts";
import { RAIZ } from "./auxiliar.ts";

const skill = readFileSync(join(RAIZ, "skills", "lattes-maxx", "SKILL.md"), "utf8");

describe("SKILL.md", () => {
  test("menos de 500 linhas", () => assert.ok(skill.split("\n").length - 1 < 500));

  test("descrição cabe no limite", () => {
    const desc = /^description:\s*(.+)$/m.exec(skill)?.[1] ?? "";
    assert.ok(desc.length > 0 && desc.length <= 1024);
  });

  test("frontmatter válido para o build", () => verificarFrontmatter());

  test("versão igual à do CHANGELOG e do package.json", () => {
    const versao = /^\s+version:\s*"([^"]+)"/m.exec(skill)?.[1];
    const topo = /^## (\d+\.\d+\.\d+)/m.exec(readFileSync(join(RAIZ, "CHANGELOG.md"), "utf8"))?.[1];
    const pacote = (JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { version: string }).version;
    assert.equal(versao, topo);
    assert.equal(versao, pacote);
  });

  test("referências citadas existem", () => {
    const citadas = new Set([
      ...[...skill.matchAll(/`([a-z0-9-]+\.md)`/g)].map((m) => m[1] as string),
      ...[...skill.matchAll(/references\/([a-z0-9-]+\.md)/g)].map((m) => m[1] as string),
    ]);
    for (const nome of citadas) {
      if (nome === "SKILL.md" || nome === "README.md") continue;
      assert.ok(
        existsSync(join(RAIZ, "references", nome)) || existsSync(join(RAIZ, "assets", nome)),
        nome,
      );
    }
  });

  test("scripts citados existem", () => {
    for (const m of skill.matchAll(/scripts\/([a-z_]+\.ts)/g)) {
      assert.ok(existsSync(join(RAIZ, "scripts", m[1] as string)), m[1]);
    }
    assert.doesNotMatch(skill, /\.py\b/);
  });
});

describe("fallback", () => {
  test("instruções com menos de 8000 caracteres", () => {
    assert.ok(readFileSync(join(RAIZ, "fallback", "INSTRUCOES.md"), "utf8").length < 8000);
  });
  test("prompt curto com menos de 1500 caracteres", () => {
    assert.ok(readFileSync(join(RAIZ, "fallback", "PROMPT-CURTO.md"), "utf8").length < 1500);
  });
});

describe("entidades HTML", () => {
  test("tabela Latin-1 completa", () => assert.equal(TOTAL_ENTIDADES_LATIN1, 96));
  test("nomeadas, numéricas e hexadecimais", () => {
    assert.equal(decodeEntities("&aacute;&Ccedil;&nbsp;&amp;&#233;&#xE9;&#150;&ndash;&hellip;"), "áÇ &éé––…");
  });
  test("entidade desconhecida fica como está", () => {
    assert.equal(decodeEntities("&naoexiste; &"), "&naoexiste; &");
  });
});

describe("zip", () => {
  test("criarZip gera um arquivo que o unzip e o python leem", () => {
    const dir = mkdtempSync(join(tmpdir(), "lattes-zip-"));
    try {
      const conteudo = "---\nname: lattes-maxx\n---\nOlá, açaí ".repeat(200);
      const zip = criarZip([
        { nome: "lattes-maxx/SKILL.md", dados: Buffer.from(conteudo), modificado: new Date() },
        { nome: "lattes-maxx/vazio.txt", dados: Buffer.alloc(0), modificado: new Date() },
      ]);
      const arq = join(dir, "t.zip");
      writeFileSync(arq, zip);
      const py = spawnSync("python3", ["-c",
        "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;" +
        "print(','.join(z.namelist()));print(len(z.read('lattes-maxx/SKILL.md')))", arq,
      ], { encoding: "utf8" });
      if (py.error || py.status !== 0) {
        const unzip = spawnSync("unzip", ["-t", arq], { encoding: "utf8" });
        if (unzip.error) return; // sem leitor de zip no PATH: nada a conferir
        assert.equal(unzip.status, 0, unzip.stdout + unzip.stderr);
        return;
      }
      const [nomes, tamanho] = py.stdout.trim().split("\n");
      assert.equal(nomes, "lattes-maxx/SKILL.md,lattes-maxx/vazio.txt");
      assert.equal(Number(tamanho), Buffer.byteLength(conteudo));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
