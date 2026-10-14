#!/usr/bin/env node
// Monta a «ficha do artigo» para cadastrar no Lattes, a partir do DOI e/ou do PDF.
//
// Uso:
//     node extrair_artigo.ts ENTRADA [ENTRADA ...] [--eu "Nome Sobrenome"]
//                            [--previa PREVIA.html] [--json] [--offline]
//
// ENTRADA pode ser:
//   - um DOI (10.1590/...), com ou sem «https://doi.org/»;
//   - o caminho de um PDF do artigo (precisa do `pdftotext`; sem ele, leia o PDF à mão).
//   Pode passar o PDF e o DOI juntos: o script confere um contra o outro.
//
// O que ele faz:
//   1. acha o DOI no PDF (ou usa o que você deu) e busca os dados na Crossref
//      (api.crossref.org; para DOIs da DataCite, como arXiv e Zenodo, usa doi.org);
//   2. confere se título e autores batem com o texto do PDF (evita DOI de outro artigo);
//   3. diz em que seção do Lattes o item entra (artigo, anais, capítulo, preprint…);
//   4. lista os campos do formulário e os autores na ordem, marcando você (--eu);
//   5. com --previa, avisa se o artigo já está no seu Lattes;
//   6. imprime o passo a passo para cadastrar.
//
// Privacidade: o PDF nunca sai do seu computador. Só o DOI (ou, se o PDF não tiver DOI,
// o título do artigo) é enviado à Crossref, que é uma base pública. Use --offline para
// não consultar a internet. Precisa de Node.js 22.18 ou mais novo; só biblioteca padrão.

import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { acharPrograma, decodeEntities, fold, razao, saidaPadrao } from "./comum.ts";
import type { Saida } from "./comum.ts";
import { dividirSecoes, lerTexto, listarItens } from "./revisar_previa.ts";
import type { Nivel } from "./revisar_previa.ts";

export const VERSAO = "1.2.0";
const USER_AGENT = `lattes-maxx/${VERSAO} (https://github.com/arthurafaria/lattes-maxx)`;
const TIMEOUT_MS = 20_000;

const DOI_RE = /10\.\d{4,9}\/[^\s"<>\][{}|\\^`]+/g;
const PREFIXO_DOI = /^(?:https?:\/\/)?(?:dx\.)?(?:doi\.org\/)?(?:doi:\s*)?/i;
const PONTUACAO_FINAL = /[.,;:)’”'"]+$/;
const PARTICULAS = new Set([
  "de", "da", "do", "das", "dos", "e", "di", "du", "del", "della", "van", "von", "der", "den",
  "la", "le", "y",
]);
const IDIOMAS: Record<string, string> = {
  pt: "Português", en: "Inglês", es: "Espanhol", fr: "Francês", de: "Alemão", it: "Italiano",
};
const PREPRINT_DOMINIOS = [
  "10.48550/", "10.1590/scielopreprints", "10.31219/", "10.2139/ssrn", "10.1101/",
  "10.21203/", "10.31235/", "10.31234/",
];
const ROTULO_CONTAINER: Record<string, string> = {
  artigo: "Periódico", anais: "Evento / anais", capitulo: "Livro (ou série)", livro: "Série / coleção",
};

export class Erro extends Error {
  // Erro com mensagem pronta para a pessoa.
}

// --------------------------------------------------------------------------
// Tipos
// --------------------------------------------------------------------------

interface DataParts {
  "date-parts"?: (number | null)[][];
}

interface AutorCrossref {
  given?: string;
  family?: string;
  name?: string;
  literal?: string;
  ORCID?: string;
  sequence?: string;
}

/** Subconjunto da resposta da Crossref que o script usa. */
export interface Crossref {
  DOI?: string;
  type?: string;
  title?: string[];
  subtitle?: string[];
  "container-title"?: string[];
  ISSN?: string[];
  "issn-type"?: { type?: string; value?: string }[];
  volume?: string | null;
  issue?: string | null;
  page?: string | null;
  "article-number"?: string;
  language?: string | null;
  publisher?: string | null;
  issued?: DataParts;
  "published-online"?: DataParts;
  "published-print"?: DataParts;
  resource?: { primary?: { URL?: string } };
  author?: AutorCrossref[];
  "updated-by"?: { type?: string }[];
}

/** Resposta do doi.org no formato CSL-JSON. */
interface Csl {
  DOI?: string;
  type?: string;
  title?: string | string[];
  "container-title"?: string | string[];
  author?: AutorCrossref[];
  volume?: string;
  issue?: string;
  page?: string;
  issued?: DataParts;
  language?: string;
  ISSN?: string | string[];
  publisher?: string;
  URL?: string;
}

export interface Autor {
  nome: string;
  given: string;
  family: string;
  citado: string;
  orcid: string;
  institucional?: boolean;
}

export interface Aviso {
  nivel: Nivel;
  texto: string;
}

export interface Ficha {
  doi: string;
  tipo_crossref: string;
  tipo: string;
  onde_cadastrar: string;
  titulo: string;
  ano: number | null;
  anos: { emitido: number | null; online: number | null; impresso: number | null };
  idioma: string;
  periodico: string;
  issn: Record<string, string>;
  volume: string;
  fasciculo: string;
  pagina_inicial: string;
  pagina_final: string;
  numero_artigo_eletronico: string;
  home_page: string;
  editora: string;
  autores: Autor[];
  avisos: Aviso[];
  confere_com_pdf: { titulo: boolean; autores: number } | null;
  meio: string;
}

export interface Voce {
  informado: boolean;
  posicoes?: number[];
}

export interface Achado {
  secao: string;
  subsecao: string;
  motivo: string;
  trecho: string;
}

export interface Resultado {
  fontes: string[];
  avisos: Aviso[];
  ficha?: Ficha;
  voce?: Voce;
  ja_no_lattes?: Achado[];
  texto_inicial?: string;
}

// --------------------------------------------------------------------------
// DOI
// --------------------------------------------------------------------------

/** Extrai o DOI de «https://doi.org/10.x/y», «doi:10.x/y» ou do próprio «10.x/y». */
export function limparDoi(texto: string): string | null {
  if (!texto) return null;
  let t = texto.trim();
  try {
    t = decodeURIComponent(t);
  } catch {
    /* texto com «%» solto: usa como está */
  }
  t = t.replace(PREFIXO_DOI, "");
  const m = new RegExp(DOI_RE.source).exec(t);
  return m ? m[0].replace(PONTUACAO_FINAL, "") : null;
}

/** DOIs na ordem em que aparecem, sem repetir. */
export function doisNoTexto(texto: string): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const m of texto.matchAll(DOI_RE)) {
    const doi = m[0].replace(PONTUACAO_FINAL, "");
    if (!vistos.has(doi.toLowerCase())) {
      vistos.add(doi.toLowerCase());
      saida.push(doi);
    }
  }
  return saida;
}

// --------------------------------------------------------------------------
// PDF
// --------------------------------------------------------------------------

function lerPdf(caminho: string, paginas = 3): { texto: string; tituloMeta: string } {
  const exe = acharPrograma("pdftotext");
  if (!exe) {
    throw new Erro(
      "Para ler PDF o script precisa do «pdftotext» (macOS: brew install poppler). " +
        "Sem ele, abra o PDF, copie o DOI da primeira página e rode o script só com o DOI.",
    );
  }
  const res = spawnSync(exe, ["-l", String(paginas), "-enc", "UTF-8", caminho, "-"], {
    encoding: "utf8", maxBuffer: 64 << 20,
  });
  if (res.status !== 0 || !res.stdout.trim()) {
    throw new Erro(
      "Não consegui extrair texto deste PDF (pode ser só imagem escaneada). " +
        "Copie o DOI da primeira página e rode o script só com o DOI.",
    );
  }
  let tituloMeta = "";
  const info = acharPrograma("pdfinfo");
  if (info) {
    const r = spawnSync(info, [caminho], { encoding: "utf8" });
    const m = /^Title:\s*(.+)$/m.exec(r.stdout ?? "");
    if (m) tituloMeta = (m[1] as string).trim();
  }
  return { texto: res.stdout, tituloMeta };
}

/** Minúsculas, sem acentos nem pontuação, hifenização de fim de linha desfeita. */
export function normalizar(texto: string): string {
  const semHifen = texto.replace(/-\s*\n\s*/g, "");
  return fold(decodeEntities(semHifen)).replace(/[^a-z0-9]+/g, " ").trim();
}

export function tituloNoTexto(titulo: string, texto: string): boolean {
  const t = normalizar(titulo).slice(0, 70);
  return t.length >= 10 && normalizar(texto).includes(t);
}

/** Fração (0–1) dos sobrenomes dos primeiros autores que aparecem no texto. */
export function autoresNoTexto(autores: Autor[], texto: string): number {
  const alvo = autores
    .slice(0, 10)
    .filter((a) => a.family)
    .map((a) => normalizar(a.family))
    .filter((a) => a.length > 1);
  if (alvo.length === 0) return 0;
  const base = normalizar(texto);
  return alvo.filter((a) => base.includes(a)).length / alvo.length;
}

/** Melhor palpite para o título, só para buscar a Crossref quando o PDF não traz DOI. */
function candidatoATitulo(texto: string, tituloMeta: string): string {
  if (tituloMeta.length > 15 && !tituloMeta.toLowerCase().endsWith(".pdf")) return tituloMeta;
  for (const linha of texto.split(/\r?\n/).slice(0, 40)) {
    const l = linha.trim();
    if (l.length >= 25 && l.length <= 200 && !/doi|http|www|@|copyright|issn/i.test(l)) return l;
  }
  return "";
}

// --------------------------------------------------------------------------
// Consulta à Crossref / doi.org
// --------------------------------------------------------------------------

export class ErroHttp extends Error {
  status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function baixarJsonReal(url: string, aceitar = "application/json"): Promise<unknown> {
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: aceitar },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new ErroHttp(resp.status);
  return JSON.parse(await resp.text()) as unknown;
}

/** Ponto único de acesso à rede (os testes trocam `baixarJson` por uma resposta pronta). */
export const rede: { baixarJson: (url: string, aceitar?: string) => Promise<unknown> } = {
  baixarJson: baixarJsonReal,
};

const caminhoDoi = (doi: string): string => doi.split("/").map(encodeURIComponent).join("/");

async function buscarCrossref(doi: string): Promise<Crossref | null> {
  const url = "https://api.crossref.org/works/" + caminhoDoi(doi);
  try {
    const corpo = (await rede.baixarJson(url)) as { message?: Crossref };
    return corpo.message ?? null;
  } catch (erro) {
    if (erro instanceof ErroHttp) {
      if (erro.status === 404) return null;
      throw new Erro(`A Crossref respondeu com erro ${erro.status}. Tente de novo em instantes.`);
    }
    throw new Erro(
      "Sem acesso à Crossref (internet fora do ar?). Use --offline ou cadastre " +
        "à mão com os dados do PDF.",
    );
  }
}

/** Plano B para DOIs que não são da Crossref (DataCite: arXiv, Zenodo, SSRN…). */
async function buscarCsl(doi: string): Promise<Csl | null> {
  const url = "https://doi.org/" + caminhoDoi(doi);
  try {
    return (await rede.baixarJson(url, "application/vnd.citationstyles.csl+json")) as Csl;
  } catch {
    return null;
  }
}

async function buscarPorTitulo(titulo: string): Promise<Crossref[]> {
  const url = "https://api.crossref.org/works?rows=3&select=DOI,title,author,container-title,issued" +
    "&query.bibliographic=" + encodeURIComponent(titulo);
  try {
    const corpo = (await rede.baixarJson(url)) as { message?: { items?: Crossref[] } };
    return corpo.message?.items ?? [];
  } catch {
    return [];
  }
}

const comoLista = (v: string | string[] | undefined): string[] =>
  typeof v === "string" ? (v ? [v] : []) : (v ?? []);

/** Converte CSL-JSON (doi.org) para o formato mínimo da Crossref que o script usa. */
export function cslParaCrossref(csl: Csl): Crossref {
  const tipos: Record<string, string> = {
    "article-journal": "journal-article", article: "posted-content",
    "paper-conference": "proceedings-article", chapter: "book-chapter", book: "book",
    thesis: "dissertation",
  };
  const tipo = csl.type ?? "";
  return {
    DOI: csl.DOI ?? "",
    type: tipos[tipo] ?? tipo,
    title: comoLista(csl.title),
    "container-title": comoLista(csl["container-title"]),
    author: (csl.author ?? []).map((a) => ({
      given: a.given ?? "", family: a.family ?? "", ...(a.literal ? { name: a.literal } : {}),
    })),
    volume: csl.volume, issue: csl.issue, page: csl.page, issued: csl.issued,
    language: csl.language, ISSN: comoLista(csl.ISSN), publisher: csl.publisher,
    resource: { primary: { URL: csl.URL ?? "" } },
  };
}

// --------------------------------------------------------------------------
// Ficha
// --------------------------------------------------------------------------

export function limparMarcacao(s: string): string {
  return decodeEntities((s ?? "").replace(/<\/?[a-zA-Z][^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

export function nomeCitado(given: string, family: string): string {
  const iniciais = given
    .split(/[\s-]+/)
    .filter((p) => p && !PARTICULAS.has(p.toLowerCase()) && /\p{L}/u.test(p[0] as string))
    .map((p) => `${(p[0] as string).toUpperCase()}.`)
    .join(" ");
  const sobrenome = family.toUpperCase();
  return iniciais ? `${sobrenome}, ${iniciais}` : sobrenome;
}

function anoDe(campo: DataParts | undefined): number | null {
  const v = campo?.["date-parts"]?.[0]?.[0];
  return typeof v === "number" ? v : null;
}

function secaoDoLattes(tipo: string, doi: string): [string, string] {
  const pre = doi.toLowerCase();
  if (tipo === "posted-content" || PREPRINT_DOMINIOS.some((p) => pre.startsWith(p))) {
    return ["preprint", "Sem regra no manual do CNPq. Preprint não é artigo publicado nem aceito"];
  }
  if (tipo === "journal-article") {
    return ["artigo", "Produções › Produção bibliográfica › Artigos completos publicados em periódicos"];
  }
  if (tipo === "proceedings-article") {
    return ["anais", "Produções › Produção bibliográfica › Trabalhos publicados em anais " +
      "de eventos (Natureza: Completo, Resumo ou Resumo expandido)"];
  }
  if (tipo === "book-chapter") {
    return ["capitulo", "Produções › Produção bibliográfica › Livros e capítulos › Capítulo de livro"];
  }
  if (["book", "monograph", "edited-book", "reference-book"].includes(tipo)) {
    return ["livro", "Produções › Produção bibliográfica › Livros e capítulos › Livro"];
  }
  if (tipo === "dissertation") {
    return ["tcc", "Não é produção: título e orientador ficam no curso, em Formação"];
  }
  return ["outro", "Confira o tipo no PDF; ver references/producoes.md (tabela «Escolher a " +
    "seção certa»)"];
}

const todoMaiusculo = (s: string): boolean => s === s.toUpperCase() && s !== s.toLowerCase();

export function montarFicha(msg: Crossref, doiPedido: string, textoPdf = ""): Ficha {
  const doi = doiPedido && (!msg.DOI || doiPedido.toLowerCase() === msg.DOI.toLowerCase())
    ? doiPedido
    : (msg.DOI || doiPedido);
  const titulos = msg.title ?? [];
  let titulo = titulos.length > 0 ? limparMarcacao(titulos[0] as string) : "";
  const sub = msg.subtitle ?? [];
  const subtitulo = sub.length > 0 ? limparMarcacao(sub[0] as string) : "";
  if (subtitulo && !titulo.toLowerCase().includes(subtitulo.toLowerCase())) {
    titulo = `${titulo}: ${subtitulo}`;
  }
  const tipo = msg.type ?? "";
  const [rotulo, onde] = secaoDoLattes(tipo, doi);

  let issn: Record<string, string> = {};
  for (const item of msg["issn-type"] ?? []) issn[item.type ?? ""] = item.value ?? "";
  const todosIssn = msg.ISSN ?? [];
  if (Object.keys(issn).length === 0 && todosIssn.length > 0) issn = { "": todosIssn[0] as string };

  const pagina = (msg.page ?? "").trim();
  let pagIni = "";
  let pagFim = "";
  if (pagina) {
    const partes = pagina.split(/\s*[-–—]\s*/);
    pagIni = partes[0] as string;
    pagFim = partes.length > 1 ? partes.slice(1).join("-") : "";
  }
  let artigoEletronico = msg["article-number"] ?? "";
  if (!artigoEletronico && /^e\d+/i.test(pagIni) && !pagFim) {
    artigoEletronico = pagIni;
    pagIni = "";
  }

  const anos = {
    emitido: anoDe(msg.issued), online: anoDe(msg["published-online"]),
    impresso: anoDe(msg["published-print"]),
  };
  const ano = anos.impresso || anos.emitido || anos.online || null;

  const autores: Autor[] = [];
  for (const a of msg.author ?? []) {
    if (a.family || a.given) {
      autores.push({
        nome: `${a.given ?? ""} ${a.family ?? ""}`.trim(), given: a.given ?? "",
        family: a.family ?? "", citado: nomeCitado(a.given ?? "", a.family ?? ""),
        orcid: a.ORCID ?? "",
      });
    } else if (a.name) {
      autores.push({ nome: a.name, given: "", family: "", citado: a.name, orcid: "", institucional: true });
    }
  }

  const url = msg.resource?.primary?.URL || `https://doi.org/${doi}`;
  const lingua = (msg.language ?? "").toLowerCase().slice(0, 2);
  const periodico = limparMarcacao((msg["container-title"] ?? [""])[0] ?? "");

  const ficha: Ficha = {
    doi, tipo_crossref: tipo, tipo: rotulo, onde_cadastrar: onde,
    titulo, ano, anos, idioma: IDIOMAS[lingua] ?? "", periodico,
    issn, volume: msg.volume ?? "", fasciculo: msg.issue ?? "",
    pagina_inicial: pagIni, pagina_final: pagFim, numero_artigo_eletronico: artigoEletronico,
    home_page: url.replace(/^https?:\/\//, ""), editora: msg.publisher ?? "",
    autores, avisos: [], confere_com_pdf: null, meio: "",
  };
  const chaves = Object.keys(issn);
  ficha.meio = chaves.length === 1 && chaves[0] === "electronic" ? "Meio digital" : "";
  if (textoPdf) {
    ficha.confere_com_pdf = {
      titulo: tituloNoTexto(titulo, textoPdf),
      autores: Math.round(autoresNoTexto(autores, textoPdf) * 100) / 100,
    };
  }
  ficha.avisos = avisosDaFicha(ficha, msg);
  return ficha;
}

function avisosDaFicha(f: Ficha, msg: Crossref): Aviso[] {
  const av: Aviso[] = [];
  const add = (nivel: Nivel, texto: string): void => {
    av.push({ nivel, texto });
  };

  if (f.tipo === "preprint") {
    add("ATENÇÃO", "É um preprint. Não vai em «Artigos completos» nem em «Artigos aceitos». " +
      "O manual do CNPq não diz onde registrar: confirme com o orientador ou o programa " +
      "(a opção mais usada é «Outra produção bibliográfica», dizendo que é preprint). " +
      "Se for a versão prévia de um artigo que você já cadastrou, não duplique.");
  }
  if (f.tipo === "tcc") {
    add("ATENÇÃO", "Tese, dissertação ou TCC não é produção bibliográfica: fica no curso, " +
      "em Formação (título e orientador).");
  }
  for (const u of msg["updated-by"] ?? []) {
    if (String(u.type ?? "").toLowerCase().includes("retract")) {
      add("ERRO", "A Crossref marca este artigo como RETRATADO. Não o cadastre sem " +
        "falar com o orientador.");
    }
  }
  const conf = f.confere_com_pdf;
  if (conf) {
    if (!conf.titulo) {
      add("ATENÇÃO", "O título da Crossref não aparece no texto do PDF. Confira se o DOI " +
        "é mesmo deste artigo (um PDF pode citar DOIs de outros).");
    }
    if (conf.autores < 0.5) {
      add("ATENÇÃO", "Poucos autores da Crossref aparecem no PDF. Confira a lista de " +
        "autores com o PDF antes de cadastrar.");
    }
  }
  if (f.tipo === "artigo") {
    if (!(f.volume || f.pagina_inicial || f.numero_artigo_eletronico)) {
      add("INFO", "Sem volume, páginas ou número do artigo: pode ser publicação online " +
        "adiantada (online first). Cadastre pelo DOI e confira se o volume saiu " +
        "depois; se o Lattes não aceitar, é «Artigo aceito».");
    }
    if (Object.keys(f.issn).length > 1) {
      add("INFO", "A revista tem ISSN impresso e eletrônico. O Lattes dá erro se o ISSN " +
        "não for da versão certa: escolha o que está no PDF ou no rodapé.");
    }
    if (!f.idioma) add("INFO", "A Crossref não informou o idioma: veja no PDF.");
  }
  const a = f.anos;
  if (a.online && a.impresso && a.online !== a.impresso) {
    add("INFO", `Publicado online em ${a.online} e no fascículo de ${a.impresso}. Use o ` +
      "ano que está no PDF (capa do fascículo).");
  }
  if (f.titulo && todoMaiusculo(f.titulo) && f.titulo.length > 12) {
    add("INFO", "O título veio todo em maiúsculas: copie do PDF como foi publicado.");
  }
  if (f.autores.length === 0) {
    add("ATENÇÃO", "A Crossref não trouxe autores. Copie a lista do PDF, na ordem.");
  }
  if (f.autores.length > 30) {
    add("INFO", `São ${f.autores.length} autores (colaboração grande). O manual do CNPq ` +
      "não trata esse caso: a lista deve seguir o artigo. Se a importação cortar ou " +
      "travar, mande um print em vez de encurtar a lista.");
  }
  return av;
}

/** Procura a pessoa entre os autores: mesmo sobrenome e mesma inicial do prenome. */
export function marcarVoce(autores: Autor[], nomes: string[]): Voce {
  if (nomes.length === 0) return { informado: false };
  const achados = new Set<number>();
  for (const nome of nomes) {
    const palavras = nome.trim().split(/\s+/).filter(Boolean);
    if (palavras.length < 2) continue;
    const sobre = fold(palavras[palavras.length - 1] as string);
    const pren = fold(palavras[0] as string);
    autores.forEach((a, i) => {
      const fam = fold(a.family);
      const giv = fold(a.given);
      if (!fam) return;
      const famOk = sobre === fam || fam.endsWith(" " + sobre) || fam.split(" ").includes(sobre);
      if (famOk && giv.slice(0, 1) === pren.slice(0, 1)) achados.add(i);
    });
  }
  return { informado: true, posicoes: [...achados].sort((x, y) => x - y).map((i) => i + 1) };
}

// --------------------------------------------------------------------------
// Já está no Lattes?
// --------------------------------------------------------------------------

export function procurarNaPrevia(previa: string, doi: string, titulo: string): Achado[] {
  const { linhas } = lerTexto(previa);
  const secoes = dividirSecoes(linhas);
  const achados: Achado[] = [];
  const alvoTitulo = normalizar(titulo).slice(0, 120);
  const doiN = doi.toLowerCase();
  for (const { secao, sub, texto } of listarItens(secoes)) {
    let motivo = "";
    if (doiN && texto.toLowerCase().includes(doiN)) {
      motivo = "mesmo DOI";
    } else if (alvoTitulo.length > 20) {
      const nt = normalizar(texto);
      if (nt.includes(alvoTitulo) || razao(alvoTitulo, nt.slice(0, alvoTitulo.length + 40)) > 0.85) {
        motivo = "título igual ou muito parecido";
      }
    }
    if (motivo) achados.push({ secao, subsecao: sub, motivo, trecho: texto.slice(0, 200) });
  }
  return achados;
}

// --------------------------------------------------------------------------
// Saída
// --------------------------------------------------------------------------

export function passos(f: Pick<Ficha, "tipo">, temDoi = true): string[] {
  const tipo = f.tipo;
  if (tipo === "preprint") {
    return ["Confirme com o orientador ou o programa onde o preprint deve entrar. Até lá, " +
      "não cadastre como artigo publicado nem aceito."];
  }
  if (tipo === "outro") {
    return ["Confira o tipo de produção no PDF e escolha a seção em references/producoes.md " +
      "(tabela «Escolher a seção certa»). Se não houver regra, diga que não há e " +
      "confirme com o orientador ou o programa."];
  }
  if (tipo === "tcc") {
    return ["Edite o curso em Formação › Formação acadêmica/titulação e preencha o título " +
      "do trabalho e o orientador."];
  }
  if (tipo === "capitulo" || tipo === "livro") {
    return [
      "Entre pelo portal lattes.cnpq.br › «Atualizar currículo».",
      "Menu «Produções» › «Produção bibliográfica» › «Livros e capítulos» › «Incluir novo item».",
      "Cole o ISBN do livro (ou o DOI, se houver) para o Lattes preencher; confira com a " +
        "ficha de catalogação do livro: título do capítulo, título do livro, " +
        "organizadores, edição, cidade, editora, ano, ISBN e páginas.",
      "Aba «Autores»: todos, na ordem, com o seu nome entre eles.",
      "«Salvar» (o «Excluir» fica ao lado). Salvar não publica: ao final, «Enviar» › «Li " +
        "e estou de acordo…» › «Enviar ao CNPq».",
    ];
  }
  let secao = "«Artigos completos publicados em periódicos»";
  let extra = "";
  if (tipo === "anais") {
    secao = "«Trabalhos publicados em anais de eventos»";
    extra = "Natureza: Completo, Resumo ou Resumo expandido. O título é o do trabalho, " +
      "não o do evento. Preencha também o nome do evento, cidade, ano e os anais.";
  }
  const primeiro = temDoi
    ? "Cole o DOI (só a parte a partir de «10.», sem «https://doi.org/») no campo DOI e " +
      "clique em outro campo: o Lattes busca e preenche os dados."
    : "Sem DOI: use o ISSN ou o nome do periódico (lupa) e preencha à mão com a ficha.";
  const lista = [
    "Antes, veja se o artigo já está no seu Lattes (Produções) ou se um coautor já o " +
      "cadastrou: nesse caso use «Importação de produção» (menu lateral) em vez de digitar.",
    "Entre pelo portal lattes.cnpq.br › «Atualizar currículo».",
    `Menu «Produções» › «Produção bibliográfica» › ${secao} › «Incluir novo item».`,
    primeiro,
    "Confira cada campo com a ficha e com o PDF publicado: título como saiu, ano, idioma, " +
      "meio de divulgação, periódico e ISSN (da versão certa), volume, fascículo, páginas." +
      (extra ? " " + extra : ""),
    "Link («Home page»): digite sem «http://»; o Lattes acrescenta.",
    "Aba «Autores»: todos, na ordem do artigo, com o seu nome entre eles. «Listar todos» " +
      "para quem já está no seu currículo; «Incluir novo» (Nome completo + Nome como citado, " +
      "com pelo menos duas partes, ex.: SILVA, M. E.). Para coautor com Lattes, use «Identificar " +
      "co-autor» (menu lateral).",
    "Opcional: palavras-chave e áreas do conhecimento. A estrela de «um dos 10 trabalhos " +
      "mais relevantes» use com parcimônia.",
    "«Salvar» (o «Excluir» fica ao lado). Itens cadastrados por DOI não têm a aba " +
      "«Traduções»; para título em inglês, cadastre à mão.",
    "Salvar não publica: ao terminar tudo, «Enviar» (alto, à direita) › «Li e estou de " +
      "acordo…» › «Enviar ao CNPq». O Sucupira compara título, DOI e autores com o Lattes do " +
      "orientador.",
  ];
  if (temDoi) {
    lista.push("Se o Lattes não achar o DOI: use o ISSN ou o nome do periódico (lupa) e " +
      "preencha à mão com a ficha.");
  }
  return lista;
}

const ORDEM_AVISO: Record<Nivel, number> = { ERRO: 0, "ATENÇÃO": 1, INFO: 2 };

export function paraMarkdown(res: Resultado): string {
  const out: string[] = ["# Ficha do artigo para o Lattes", ""];
  for (const linha of res.fontes) out.push(`- ${linha}`);
  const f = res.ficha;
  if (!f) {
    out.push("");
    for (const av of res.avisos) out.push(`- **${av.nivel}:** ${av.texto}`);
    if (res.texto_inicial) {
      out.push("", "## Início do texto do PDF (para você ler os dados)", "", "```", res.texto_inicial, "```");
    }
    return out.join("\n");
  }

  out.push(`- Tipo: ${f.tipo} → ${f.onde_cadastrar}`);
  const conf = f.confere_com_pdf;
  if (conf) {
    out.push(`- Conferência com o PDF: título ${conf.titulo ? "confere" : "NÃO encontrado"}; ` +
      `autores encontrados: ${Math.trunc(conf.autores * 100)}%`);
  }
  const avisos = [...f.avisos, ...res.avisos];
  if (avisos.length > 0) {
    out.push("", "## Avisos", "");
    for (const av of [...avisos].sort((a, b) => ORDEM_AVISO[a.nivel] - ORDEM_AVISO[b.nivel])) {
      out.push(`- **${av.nivel}:** ${av.texto}`);
    }
  }
  const ja = res.ja_no_lattes;
  if (ja !== undefined) {
    out.push("", "## Já está no seu Lattes?", "");
    if (ja.length > 0) {
      for (const j of ja) {
        out.push(`- **Sim** (${j.motivo}), em ${j.secao}${j.subsecao ? " › " + j.subsecao : ""}: \`${j.trecho}\``);
      }
      out.push("- Não cadastre de novo. Se o item está em «Artigos aceitos» e já saiu, " +
        "exclua-o de lá e cadastre em «Artigos completos».");
    } else {
      out.push("- Não achei na prévia enviada.");
    }
  }

  const rotuloIssn = (k: string): string =>
    k === "print" ? "impresso" : k === "electronic" ? "eletrônico" : "ISSN";
  const issn = Object.entries(f.issn).map(([k, v]) => `${v} (${rotuloIssn(k)})`).join(" · ") || "—";
  const pag = [f.pagina_inicial, f.pagina_final].filter(Boolean).join(" / ") || "—";
  const linhas: [string, string | number][] = [
    ["DOI (cole a partir do «10.»)", f.doi || "—"],
    ["Título (como publicado)", f.titulo || "—"],
    ["Ano", f.ano ?? "—"],
    ["Idioma", f.idioma || "veja no PDF"],
    ["Meio de divulgação", f.meio || "veja no PDF (Impresso, Meio digital ou Vários)"],
    ["Home page (sem «http://»)", f.home_page || "—"],
    [ROTULO_CONTAINER[f.tipo] ?? "Periódico / evento / livro", f.periodico || "—"],
    ["ISSN (escolha o do PDF)", issn],
    ["Volume", f.volume || "—"],
    ["Fascículo / edição", f.fasciculo || "—"],
    ["Página inicial / final", pag],
    ["Número do artigo eletrônico", f.numero_artigo_eletronico || "—"],
  ];
  out.push("", "## Campos do formulário", "", "| Campo do Lattes | Valor |", "|---|---|");
  for (const [c, v] of linhas) out.push(`| ${c} | ${String(v).replaceAll("|", "/")} |`);

  const voce = res.voce ?? { informado: false };
  const pos = new Set(voce.posicoes ?? []);
  out.push("", `## Autores, na ordem (${f.autores.length})`, "",
    "| # | Nome completo | Nome como citado (sugestão) | |", "|---|---|---|---|");
  let aut = f.autores.map((a, i) => ({ i: i + 1, a }));
  const cortados = aut.length > 12;
  if (cortados) aut = [...aut.slice(0, 8), ...aut.slice(-3)];
  for (const { i, a } of aut) {
    out.push(`| ${i} | ${a.nome} | ${a.citado} | ${pos.has(i) ? "← você" : ""} |`);
  }
  if (cortados) out.push(`\n(Lista resumida: use \`--json\` para os ${f.autores.length} autores.)`);
  if (voce.informado) {
    if (pos.size > 0) {
      out.push(`\nVocê aparece na posição ${[...pos].sort((x, y) => x - y).join(", ")}.`);
    } else {
      out.push("\n**Não encontrei você entre os autores.** O Lattes exige o seu nome; " +
        "confira a grafia (outras formas do nome entram em «Nome em citações»).");
    }
  }
  out.push("\n_«Nome como citado» é só uma sugestão no formato do Lattes; use as formas " +
    "que você já tem em «Nome em citações bibliográficas»._");

  out.push("", "## Passo a passo no Lattes", "");
  passos(f, Boolean(f.doi)).forEach((p, n) => out.push(`${n + 1}. ${p}`));
  out.push("", "_Dados da Crossref: confira sempre com o PDF publicado antes de salvar._");
  return out.join("\n");
}

// --------------------------------------------------------------------------
// Fluxo principal
// --------------------------------------------------------------------------

export async function analisar(
  entradas: string[], eu: string[], previa: string | undefined, offline: boolean,
): Promise<Resultado> {
  const res: Resultado = { fontes: [], avisos: [] };
  let textoPdf = "";
  let tituloMeta = "";
  const dois: string[] = [];
  for (const ent of entradas) {
    if (existsSync(ent) && statSync(ent).isFile()) {
      const dados = lerPdf(ent);
      textoPdf += "\n" + dados.texto;
      tituloMeta ||= dados.tituloMeta;
      const achados = doisNoTexto(dados.texto);
      res.fontes.push(`PDF lido: ${basename(ent)} (${achados.length} DOI(s) encontrado(s) no texto)`);
      dois.push(...achados);
    } else {
      const doi = limparDoi(ent);
      if (!doi) throw new Erro(`Não entendi «${ent}»: não é um DOI (10.xxxx/…) nem um PDF existente.`);
      dois.unshift(doi);
      res.fontes.push(`DOI informado: ${doi}`);
    }
  }

  const vistos = new Set<string>();
  const candidatos: string[] = [];
  for (const d of dois) {
    if (!vistos.has(d.toLowerCase())) {
      vistos.add(d.toLowerCase());
      candidatos.push(d);
    }
  }

  let msg: Crossref | null = null;
  let doiUsado = "";
  if (candidatos.length > 0 && !offline) {
    for (const d of candidatos.slice(0, 4)) {
      let m = await buscarCrossref(d);
      let origem = "Crossref";
      if (m === null) {
        const csl = await buscarCsl(d);
        if (csl) {
          m = cslParaCrossref(csl);
          origem = "doi.org (DataCite)";
        }
      }
      if (m === null) continue;
      const okTitulo = !textoPdf || tituloNoTexto(limparMarcacao((m.title ?? [""])[0] ?? ""), textoPdf);
      if (msg === null || (okTitulo && textoPdf)) {
        msg = m;
        doiUsado = d;
        res.fontes.push(`Dados de ${origem} para o DOI ${d}`);
        if (okTitulo || !textoPdf) break;
      }
    }
    if (msg === null) {
      res.avisos.push({ nivel: "ATENÇÃO", texto: "Nenhum dos DOIs encontrados existe na Crossref/DataCite. " +
        "Confira o DOI no PDF." });
    }
  } else if (candidatos.length > 0 && offline) {
    res.avisos.push({ nivel: "INFO", texto: `Modo offline: DOI encontrado (${candidatos[0]}), mas os dados não ` +
      "foram consultados. Leia título, autores e periódico no PDF." });
  }

  if (msg === null && textoPdf && candidatos.length === 0 && !offline) {
    const palpite = candidatoATitulo(textoPdf, tituloMeta);
    if (palpite) {
      res.fontes.push(`PDF sem DOI: busquei na Crossref pelo título «${palpite.slice(0, 80)}»`);
      for (const it of await buscarPorTitulo(palpite)) {
        const t = limparMarcacao((it.title ?? [""])[0] ?? "");
        if (tituloNoTexto(t, textoPdf) && it.DOI) {
          const m = await buscarCrossref(it.DOI);
          if (m) {
            msg = m;
            doiUsado = it.DOI;
            res.fontes.push(`Candidato confirmado pelo texto do PDF: ${doiUsado}`);
            res.avisos.push({ nivel: "ATENÇÃO", texto: "O PDF não traz DOI; achei este pela busca de título " +
              "e o título bate com o PDF. Confira antes de usar." });
            break;
          }
        }
      }
    }
  }

  if (msg === null) {
    if (textoPdf) {
      res.avisos.push({ nivel: "ATENÇÃO", texto: "Sem os dados da Crossref. Leia o início do PDF " +
        "abaixo e cadastre à mão: «Produções › Produção bibliográfica › " +
        "Artigos completos publicados em periódicos» pelo ISSN ou nome " +
        "do periódico (lupa)." });
      res.texto_inicial = textoPdf.trim().slice(0, 2500);
    } else if (candidatos.length === 0) {
      throw new Erro("Nada para analisar: passe um DOI ou o caminho de um PDF.");
    }
    return res;
  }

  if (candidatos.length > 1) {
    res.avisos.push({ nivel: "INFO", texto: `O PDF traz ${candidatos.length} DOIs (${candidatos.slice(0, 4).join(", ")}). ` +
      `Usei ${doiUsado}; confira se é o do próprio artigo.` });
  }
  const ficha = montarFicha(msg, doiUsado, textoPdf);
  res.ficha = ficha;
  res.voce = marcarVoce(ficha.autores, eu);
  if (previa !== undefined) {
    try {
      res.ja_no_lattes = procurarNaPrevia(previa, ficha.doi, ficha.titulo);
    } catch (erro) {
      res.avisos.push({ nivel: "INFO", texto: `Não consegui ler a prévia: ${(erro as Error).message}` });
    }
  }
  return res;
}

const AJUDA = "uso: node extrair_artigo.ts ENTRADA [ENTRADA ...] [--eu \"Nome\"] [--previa ARQUIVO]\n" +
  "                           [--json] [--offline]\n\n" +
  "Ficha do artigo para cadastrar no Lattes. ENTRADA: DOI e/ou caminho do PDF.\n" +
  "  --eu NOME      seu nome completo (repetível) para achar sua posição nos autores\n" +
  "  --previa ARQ   prévia do Lattes (HTML/.txt) para ver se o artigo já está lá\n" +
  "  --json         saída em JSON\n  --offline      não consulta a internet\n  -h, --help";

export async function main(argv: string[], saida: Saida = saidaPadrao): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        eu: { type: "string", multiple: true },
        previa: { type: "string" },
        json: { type: "boolean" },
        offline: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
  } catch (erro) {
    saida.err(`${AJUDA}\n\nerro: ${(erro as Error).message}`);
    return 2;
  }
  if (args.values.help) {
    saida.out(AJUDA);
    return 0;
  }
  if (args.positionals.length === 0) {
    saida.err(`${AJUDA}\n\nerro: informe um DOI ou o caminho de um PDF.`);
    return 2;
  }
  try {
    const res = await analisar(args.positionals, args.values.eu ?? [], args.values.previa, Boolean(args.values.offline));
    saida.out(args.values.json ? JSON.stringify(res, null, 2) : paraMarkdown(res));
    return 0;
  } catch (erro) {
    if (erro instanceof Erro) {
      saida.err(erro.message);
      return 2;
    }
    throw erro;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((codigo) => {
    process.exitCode = codigo;
  });
}
