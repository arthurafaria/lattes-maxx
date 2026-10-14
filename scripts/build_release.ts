#!/usr/bin/env node
// Gera os pacotes de distribuição da skill.
//
// Cria em dist/:
//   - lattes-maxx.zip           só a skill (pasta lattes-maxx/ com o SKILL.md na raiz do zip),
//                               para Claude.ai, ChatGPT, Gemini e para mandar a amigos
//   - lattes-maxx-completo.md   SKILL.md + todas as referências num arquivo só (para IAs
//                               sem skills ou sem acesso à internet)
//
// Uso: node scripts/build_release.ts   (Node.js 22.18 ou mais novo)

import {
  mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(RAIZ, "skills", "lattes-maxx");
const DIST = join(RAIZ, "dist");
const IGNORAR = new Set([".DS_Store", "__pycache__"]);

export function verificarFrontmatter(raiz = RAIZ): void {
  const caminho = join(raiz, "skills", "lattes-maxx", "SKILL.md");
  const texto = readFileSync(caminho, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n/.exec(texto);
  if (!m) throw new Error("SKILL.md sem frontmatter YAML");
  const fm = m[1] as string;
  const nome = /^name:\s*(\S+)/m.exec(fm);
  const desc = /^description:\s*(.+)$/m.exec(fm);
  if (!nome || nome[1] !== "lattes-maxx") {
    throw new Error("O campo name precisa ser igual ao nome da pasta");
  }
  if (!desc || (desc[1] as string).length > 1024) {
    throw new Error("description ausente ou com mais de 1024 caracteres");
  }
  const permitidos = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  const chaves = new Set([...fm.matchAll(/^([a-z][a-z-]*):/gm)].map((x) => x[1] as string));
  const extras = [...chaves].filter((c) => !permitidos.has(c)).sort();
  if (extras.length > 0) throw new Error(`Campos fora do padrão no frontmatter: ${extras.join(", ")}`);
  const linhas = texto.split("\n").length - 1;
  if (linhas > 500) throw new Error(`SKILL.md tem ${linhas} linhas (recomendado: até 500)`);
}

// --------------------------------------------------------------------------
// ZIP (o Node não traz escritor de zip; este grava o formato básico, com deflate)
// --------------------------------------------------------------------------

export interface EntradaZip {
  nome: string;
  dados: Buffer;
  modificado: Date;
}

function dataDos(d: Date): { hora: number; dia: number } {
  const ano = Math.max(d.getFullYear(), 1980);
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function criarZip(entradas: EntradaZip[]): Buffer {
  const blocos: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;
  for (const e of entradas) {
    const nome = Buffer.from(e.nome, "utf8");
    const comprimido = deflateRawSync(e.dados, { level: 9 });
    const crc = crc32(e.dados);
    const { hora, dia } = dataDos(e.modificado);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(e.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    blocos.push(local, nome, comprimido);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4); // feito no Unix, versão 2.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(hora, 12);
    cd.writeUInt16LE(dia, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comprimido.length, 20);
    cd.writeUInt32LE(e.dados.length, 24);
    cd.writeUInt16LE(nome.length, 28);
    cd.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // arquivo comum, rw-r--r--
    cd.writeUInt32LE(deslocamento, 42);
    central.push(cd, nome);

    deslocamento += local.length + nome.length + comprimido.length;
  }
  const tamanhoCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...blocos, ...central, fim]);
}

function listarArquivos(pasta: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta).sort()) {
    if (IGNORAR.has(nome) || nome.endsWith(".pyc")) continue;
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achados.push(...listarArquivos(caminho));
    else achados.push(caminho);
  }
  return achados;
}

function montarZip(): string {
  mkdirSync(DIST, { recursive: true });
  const saida = join(DIST, "lattes-maxx.zip");
  const entradas: EntradaZip[] = listarArquivos(SKILL).map((caminho) => ({
    nome: ["lattes-maxx", ...relative(SKILL, caminho).split(sep)].join("/"),
    dados: readFileSync(caminho),
    modificado: statSync(caminho).mtime,
  }));
  writeFileSync(saida, criarZip(entradas));
  return saida;
}

function montarMarkdownUnico(): string {
  const partes = [readFileSync(join(SKILL, "SKILL.md"), "utf8")];
  for (const pasta of ["references", "assets"]) {
    const arquivos = readdirSync(join(RAIZ, pasta)).filter((f) => f.endsWith(".md")).sort();
    for (const nome of arquivos) {
      partes.push(`\n\n---\n\n<!-- arquivo: ${pasta}/${nome} -->\n\n`);
      partes.push(readFileSync(join(RAIZ, pasta, nome), "utf8"));
    }
  }
  const saida = join(DIST, "lattes-maxx-completo.md");
  writeFileSync(saida, partes.join(""));
  return saida;
}

export function main(): number {
  try {
    verificarFrontmatter();
  } catch (erro) {
    console.error((erro as Error).message);
    return 1;
  }
  const zip = montarZip();
  const md = montarMarkdownUnico();
  const kb = (c: string) => Math.floor(statSync(c).size / 1024);
  console.log(`OK: ${relative(RAIZ, zip)} (${kb(zip)} KB)`);
  console.log(`OK: ${relative(RAIZ, md)} (${kb(md)} KB)`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = main();
}
