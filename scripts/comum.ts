// Utilitários compartilhados pelos scripts (só biblioteca padrão do Node).

import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Saída dos scripts: nos testes, troca-se por uma que guarda o texto. */
export interface Saida {
  out(texto: string): void;
  err(texto: string): void;
}

export const saidaPadrao: Saida = {
  out: (texto) => {
    process.stdout.write(texto + "\n");
  },
  err: (texto) => {
    process.stderr.write(texto + "\n");
  },
};

// --------------------------------------------------------------------------
// Texto
// --------------------------------------------------------------------------

export function normalizeSpace(s: string): string {
  return s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Minúsculas sem acentos, para comparações tolerantes. */
export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Limites de palavra que entendem acentos (o `\b` do JavaScript só entende ASCII). */
export const INICIO_PALAVRA = "(?<![\\p{L}\\p{N}_])";
export const FIM_PALAVRA = "(?![\\p{L}\\p{N}_])";

// --------------------------------------------------------------------------
// Entidades HTML (o Node não tem `unescape` de HTML)
// --------------------------------------------------------------------------

const LATIN1 = (
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg " +
  "plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 " +
  "iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml " +
  "Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave " +
  "Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil " +
  "egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde " +
  "ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml"
).split(" ");

const ENTIDADES: Map<string, number> = new Map(LATIN1.map((nome, i) => [nome, 160 + i]));
for (const [nome, cod] of Object.entries({
  quot: 34, amp: 38, apos: 39, lt: 60, gt: 62, OElig: 338, oelig: 339, Scaron: 352,
  scaron: 353, Yuml: 376, circ: 710, tilde: 732, ensp: 8194, emsp: 8195, thinsp: 8201,
  zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, ndash: 8211, mdash: 8212, lsquo: 8216,
  rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224,
  Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243,
  lsaquo: 8249, rsaquo: 8250, oline: 8254, euro: 8364, trade: 8482, larr: 8592,
  rarr: 8594,
})) {
  ENTIDADES.set(nome, cod);
}

export const TOTAL_ENTIDADES_LATIN1 = LATIN1.length;

// Caracteres dos bytes 0x80–0x9F do Windows-1252 (o `TextDecoder("windows-1252")` do Node 22
// devolve aí caracteres de controle em vez de aspas, travessões e reticências).
const CP1252_C1 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039,
  0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** Decodifica bytes Windows-1252 (também usado para ISO-8859-1, como fazem os navegadores). */
export function decodeWindows1252(bytes: Uint8Array): string {
  let saida = "";
  for (const b of bytes) {
    saida += String.fromCharCode(b >= 0x80 && b <= 0x9f ? (CP1252_C1[b - 0x80] as number) : b);
  }
  return saida;
}

function codigoParaTexto(cod: number): string {
  if (cod >= 0x80 && cod <= 0x9f) {
    return String.fromCharCode(CP1252_C1[cod - 0x80] as number); // «&#150;» vale como o travessão do Windows
  }
  if (cod === 0 || cod > 0x10ffff || (cod >= 0xd800 && cod <= 0xdfff)) return "�";
  return String.fromCodePoint(cod);
}

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s
    .replace(/&#[xX]([0-9a-fA-F]+);?/g, (_t, hex: string) => codigoParaTexto(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_t, dec: string) => codigoParaTexto(parseInt(dec, 10)))
    .replace(/&([A-Za-z][A-Za-z0-9]*);/g, (t, nome: string) => {
      const cod = ENTIDADES.get(nome);
      return cod === undefined ? t : String.fromCodePoint(cod);
    })
    .replace(/&(amp|lt|gt|quot|nbsp)(?![A-Za-z0-9])/g, (_t, nome: string) =>
      String.fromCodePoint(ENTIDADES.get(nome) as number),
    );
}

// --------------------------------------------------------------------------
// Semelhança entre textos (equivale ao `SequenceMatcher.ratio()` do Python,
// sem a heurística de «lixo» para textos longos)
// --------------------------------------------------------------------------

function maiorTrecho(
  a: string, alo: number, ahi: number, b: string, blo: number, bhi: number,
): { i: number; j: number; k: number } {
  let melhor = { i: alo, j: blo, k: 0 };
  let anterior = new Array<number>(bhi - blo + 1).fill(0);
  for (let i = alo; i < ahi; i++) {
    const atual = new Array<number>(bhi - blo + 1).fill(0);
    for (let j = blo; j < bhi; j++) {
      if (a[i] === b[j]) {
        const k = (anterior[j - blo] ?? 0) + 1;
        atual[j - blo + 1] = k;
        if (k > melhor.k) melhor = { i: i - k + 1, j: j - k + 1, k };
      }
    }
    anterior = atual;
  }
  return melhor;
}

function casados(a: string, alo: number, ahi: number, b: string, blo: number, bhi: number): number {
  if (alo >= ahi || blo >= bhi) return 0;
  const { i, j, k } = maiorTrecho(a, alo, ahi, b, blo, bhi);
  if (k === 0) return 0;
  return k + casados(a, alo, i, b, blo, j) + casados(a, i + k, ahi, b, j + k, bhi);
}

/** Razão de semelhança entre 0 e 1 (2 × caracteres casados ÷ soma dos tamanhos). */
export function razao(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  return (2 * casados(a, 0, a.length, b, 0, b.length)) / total;
}

// --------------------------------------------------------------------------
// Programas externos
// --------------------------------------------------------------------------

/** Caminho de um programa no PATH (ou `null`). */
export function acharPrograma(nome: string): string | null {
  const extensoes = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const pasta of (process.env.PATH ?? "").split(delimiter)) {
    if (!pasta) continue;
    for (const ext of extensoes) {
      const candidato = join(pasta, nome + ext);
      try {
        if (existsSync(candidato) && statSync(candidato).isFile()) return candidato;
      } catch {
        /* pasta ilegível: segue */
      }
    }
  }
  return null;
}
