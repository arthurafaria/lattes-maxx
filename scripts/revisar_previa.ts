#!/usr/bin/env node
// Revisa a prévia (ou a página pública) de um Currículo Lattes salva em HTML.
//
// Uso:
//     node revisar_previa.ts CAMINHO_DO_ARQUIVO.html [--json]
//
// Como obter o arquivo: no editor do Lattes, use "Gerar arquivo para visualização
// e conferência" (menu lateral) e salve a página aberta (Cmd/Ctrl + S, "Página da
// Web, somente HTML"). Também funciona com a página pública do currículo salva em
// HTML, com um .txt copiado da página e, se o programa `pdftotext` estiver
// instalado, com um PDF.
//
// Precisa de Node.js 22.18 ou mais novo (`node -v`). Só usa a biblioteca padrão e
// não envia nada para a internet. Ele aponta problemas prováveis; quem decide é a
// pessoa dona do currículo.

import { readFileSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import {
  FIM_PALAVRA, INICIO_PALAVRA, acharPrograma, decodeEntities, decodeWindows1252, escapeRegExp, fold,
  normalizeSpace, razao, saidaPadrao,
} from "./comum.ts";
import type { Saida } from "./comum.ts";

// --------------------------------------------------------------------------
// Leitura e linearização do HTML
// --------------------------------------------------------------------------

const BLOCK_TAGS = new Set([
  "p", "div", "tr", "table", "li", "ul", "ol", "h1", "h2", "h3", "h4",
  "br", "em", "section", "article", "header", "footer",
]);
const SKIP_TAGS = new Set(["script", "style", "noscript"]);
const RAW_TEXT_TAGS = new Set(["script", "style"]);
// Contêineres de navegação da página do Lattes (menus repetem nomes de seções).
const SKIP_CLASSES = new Set(["header", "megamenu", "menuPrincipal", "menu-header"]);

export interface Linearizado {
  parts: string[];
  resumoParts: string[];
}

/** Converte HTML em texto, preservando quebras de bloco. */
export function linearizar(html: string): Linearizado {
  const parts: string[] = [];
  const resumoParts: string[] = [];
  let skipDepth = 0;
  let navTag: string | null = null;
  let navDepth = 0;
  let resumoDepth = 0;

  const aoAbrir = (tag: string, attrs: Map<string, string>): void => {
    if (navTag) {
      if (tag === navTag) navDepth += 1;
      return;
    }
    if (SKIP_TAGS.has(tag)) {
      skipDepth += 1;
      return;
    }
    const cls = attrs.get("class") ?? "";
    const classes = cls.split(/\s+/).filter(Boolean);
    if ((tag === "div" || tag === "ul" || tag === "nav") && classes.some((c) => SKIP_CLASSES.has(c))) {
      navTag = tag;
      navDepth = 1;
      return;
    }
    if (tag === "p" && classes.includes("resumo")) resumoDepth = 1;
    if (BLOCK_TAGS.has(tag)) parts.push("\n");
    if (tag === "td") parts.push(" ");
  };

  const aoFechar = (tag: string): void => {
    if (navTag) {
      if (tag === navTag) {
        navDepth -= 1;
        if (navDepth === 0) navTag = null;
      }
      return;
    }
    if (SKIP_TAGS.has(tag) && skipDepth) {
      skipDepth -= 1;
      return;
    }
    if (tag === "p" && resumoDepth) resumoDepth = 0;
    if (BLOCK_TAGS.has(tag)) parts.push("\n");
  };

  const aoTexto = (texto: string): void => {
    if (skipDepth || navTag) return;
    parts.push(texto);
    if (resumoDepth) resumoParts.push(texto);
  };

  const n = html.length;
  let i = 0;
  while (i < n) {
    if (html[i] !== "<") {
      let prox = html.indexOf("<", i);
      if (prox < 0) prox = n;
      aoTexto(decodeEntities(html.slice(i, prox)));
      i = prox;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      const fim = html.indexOf("-->", i + 4);
      i = fim < 0 ? n : fim + 3;
      continue;
    }
    const seguinte = html[i + 1] ?? "";
    if (seguinte === "!" || seguinte === "?") {
      const fim = html.indexOf(">", i);
      i = fim < 0 ? n : fim + 1;
      continue;
    }
    if (seguinte === "/") {
      const m = /^<\/([a-zA-Z][^\s/>]*)[^>]*>/.exec(html.slice(i, i + 200));
      if (m) {
        aoFechar((m[1] as string).toLowerCase());
        i += m[0].length;
        continue;
      }
      aoTexto("<");
      i += 1;
      continue;
    }
    if (/[a-zA-Z]/.test(seguinte)) {
      const nome = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(i, i + 100)) as RegExpExecArray;
      const tag = (nome[1] as string).toLowerCase();
      let j = i + nome[0].length;
      let aspas = "";
      while (j < n) {
        const c = html[j] as string;
        if (aspas) {
          if (c === aspas) aspas = "";
        } else if (c === '"' || c === "'") {
          aspas = c;
        } else if (c === ">") {
          break;
        }
        j += 1;
      }
      const bruto = html.slice(i + nome[0].length, j);
      const autoFechada = bruto.trimEnd().endsWith("/");
      const attrs = new Map<string, string>();
      for (const a of bruto.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        attrs.set((a[1] as string).toLowerCase(), decodeEntities(a[2] ?? a[3] ?? a[4] ?? ""));
      }
      i = j < n ? j + 1 : n;
      aoAbrir(tag, attrs);
      if (autoFechada) {
        aoFechar(tag);
      } else if (RAW_TEXT_TAGS.has(tag)) {
        const fecho = new RegExp(`</${tag}[\\s>]`, "i").exec(html.slice(i));
        i = fecho ? i + fecho.index : n; // conteúdo de script/style é ignorado
      }
      continue;
    }
    aoTexto("<");
    i += 1;
  }
  return { parts, resumoParts };
}

export class ArquivoInvalido extends Error {
  // Arquivo que o revisor não consegue ler (mensagem pronta para a pessoa).
}

function pdfParaTexto(caminho: string): string {
  const exe = acharPrograma("pdftotext");
  if (!exe) {
    throw new ArquivoInvalido(
      "Este arquivo é um PDF e o programa «pdftotext» não está instalado. " +
        "Salve a prévia como HTML (Cmd/Ctrl + S › «Página da Web, somente HTML»), " +
        "copie o texto da página para um arquivo .txt ou instale o pdftotext " +
        "(macOS: brew install poppler).",
    );
  }
  const res = spawnSync(exe, ["-enc", "UTF-8", caminho, "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (res.status !== 0 || !res.stdout.trim()) {
    throw new ArquivoInvalido(
      "Não consegui extrair texto deste PDF (pode ser só imagem). " +
        "Salve a prévia como HTML ou copie o texto para um .txt.",
    );
  }
  return res.stdout;
}

const LATIN1 = new Set(["windows-1252", "cp1252", "iso-8859-1", "iso8859-1", "latin1", "latin-1", "l1", "us-ascii", "ascii"]);

export function decodificar(bruto: Uint8Array): string {
  const cabeca = Buffer.from(bruto.subarray(0, 4000)).toString("latin1");
  const m = /charset=["']?([A-Za-z0-9_-]+)/.exec(cabeca);
  const candidatos: string[] = [];
  if (m) candidatos.push((m[1] as string).toLowerCase());
  candidatos.push("utf-8", "windows-1252");
  for (const enc of candidatos) {
    if (LATIN1.has(enc)) return decodeWindows1252(bruto);
    try {
      return new TextDecoder(enc, { fatal: true }).decode(bruto);
    } catch {
      /* codificação desconhecida ou bytes inválidos: tenta a próxima */
    }
  }
  return decodeWindows1252(bruto);
}

function linhasDeTexto(texto: string): string[] {
  return texto.split(/\r\n|\r|\n/).map(normalizeSpace).filter(Boolean);
}

function comecaComoPdf(caminho: string): boolean {
  const fd = openSync(caminho, "r");
  try {
    const buf = Buffer.alloc(5);
    readSync(fd, buf, 0, 5, 0);
    return buf.toString("latin1") === "%PDF-";
  } finally {
    closeSync(fd);
  }
}

export function lerTexto(caminho: string): { linhas: string[]; resumo: string } {
  const bruto = readFileSync(caminho);
  const ext = extname(caminho).toLowerCase();
  if (bruto.subarray(0, 5).toString("latin1") === "%PDF-" || ext === ".pdf") {
    return { linhas: linhasDeTexto(pdfParaTexto(caminho)), resumo: "" };
  }
  const texto = decodificar(bruto);
  if (ext === ".txt" || ext === ".md") return { linhas: linhasDeTexto(texto), resumo: "" };
  const { parts, resumoParts } = linearizar(texto);
  const linhas = parts.join("").split("\n").map(normalizeSpace).filter(Boolean);
  return { linhas, resumo: normalizeSpace(resumoParts.join("")) };
}

// --------------------------------------------------------------------------
// Segmentação em seções
// --------------------------------------------------------------------------

// Títulos de seção que aparecem na prévia e na página pública.
const SECTION_TITLES = [
  "Identificação", "Endereço", "Idiomas", "Prêmios e títulos",
  "Formação acadêmica/titulação", "Pós-doutorado", "Formação Complementar",
  "Atuação profissional", "Linhas de pesquisa", "Projetos de pesquisa",
  "Projetos de extensão", "Projetos de ensino",
  "Projetos de desenvolvimento", "Outros Projetos", "Membro de corpo editorial",
  "Revisor de periódico", "Áreas de atuação", "Produção", "Produções",
  "Produção bibliográfica", "Produção técnica", "Produção artística/cultural",
  "Patentes e registros", "Inovação", "Educação e Popularização de C & T",
  "Educação e Popularização de C&T", "Eventos", "Orientações", "Bancas",
  "Citações", "Outras informações relevantes",
];
const SECTION_KEYS: Map<string, string> = new Map(SECTION_TITLES.map((t) => [fold(t), t]));
// A prévia escreve "Producão" (sic) em alguns casos.
SECTION_KEYS.set(fold("Producão"), "Produção");

export type Secoes = Map<string, string[]>;

export function dividirSecoes(linhas: string[]): Secoes {
  const secoes: Secoes = new Map([["_cabecalho", []]]);
  let atual = "_cabecalho";
  for (const linha of linhas) {
    const titulo = SECTION_KEYS.get(fold(linha));
    if (titulo !== undefined) {
      atual = titulo;
      if (!secoes.has(atual)) secoes.set(atual, []);
      continue;
    }
    (secoes.get(atual) as string[]).push(linha);
  }
  return secoes;
}

const secao = (secoes: Secoes, nome: string): string[] => secoes.get(nome) ?? [];

// --------------------------------------------------------------------------
// Relatório
// --------------------------------------------------------------------------

export type Nivel = "ERRO" | "ATENÇÃO" | "INFO";

export interface Ponto {
  nivel: Nivel;
  area: string;
  mensagem: string;
  dica: string;
  trecho: string;
}

export interface Fatos {
  secoes_encontradas?: string[];
  nomes_em_citacoes?: string[];
  ultima_atualizacao?: string;
  previa_gerada_em?: string;
  tipo?: string;
  lattes_id?: string;
  resumo_caracteres?: number;
  tem_vinculo_bolsista?: boolean;
  secoes_de_projeto?: string[];
  itens_de_producao?: number;
}

export class Relatorio {
  itens: Ponto[] = [];
  fatos: Fatos = {};

  add(nivel: Nivel, area: string, mensagem: string, dica = "", trecho = ""): void {
    this.itens.push({ nivel, area, mensagem, dica, trecho: trecho.slice(0, 220) });
  }
}

const COMMON_TYPOS: [string, string][] = [
  // erro, forma correta
  ["aquirida", "adquirida"], ["aquirido", "adquirido"], ["auxliando", "auxiliando"],
  ["concerteza", "com certeza"], ["derrepente", "de repente"], ["excessão", "exceção"],
  ["previlégio", "privilégio"], ["beneficiente", "beneficente"],
  ["asterístico", "asterisco"], ["impecilho", "empecilho"], ["mal-criado", "malcriado"],
  ["advinhar", "adivinhar"], ["metereologia", "meteorologia"],
  ["iniciação cientifica", "iniciação científica"], ["academico", "acadêmico"],
  ["pesquisa cientifica", "pesquisa científica"], ["graduaçao", "graduação"],
  ["comunicaçao", "comunicação"], ["orientaçao", "orientação"], ["participaçao", "participação"],
];

const ORDINAL_LOST = new RegExp(
  INICIO_PALAVRA + "(\\d{1,3}) (lugar|colocação|congresso|encontro|seminário|seminario|simpósio|" +
    "simposio|semana|edição|edicao|colóquio|coloquio|jornada|mostra|festival|" +
    "conferência|conferencia|fórum|forum|salão|salao)" + FIM_PALAVRA,
  "giu",
);

const LAB_LIKE = new RegExp(
  "(laborat[óo]rio|grupo de (pesquisa|estudos?)|n[úu]cleo|" + INICIO_PALAVRA + "lab" + FIM_PALAVRA +
    "|lab/|/u[a-z]{2,4}" + FIM_PALAVRA + "|observat[óo]rio|" + INICIO_PALAVRA + "colab" + FIM_PALAVRA + ")",
  "iu",
);

const ITEM_NUMBER = /^(\d{1,3})\.\s*(.*)$/;

function sentencas(texto: string): string[] {
  return texto.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter((p) => p.length > 25);
}

// ---- datas ----------------------------------------------------------------

/** Dia civil em UTC (meia-noite). */
function dia(ano: number, mes: number, d: number): Date | null {
  const data = new Date(Date.UTC(ano, mes - 1, d));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === d
    ? data
    : null;
}

export function formatarData(d: Date): string {
  const p = (n: number, t = 2) => String(n).padStart(t, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCFullYear(), 4)}`;
}

/** Datas «dd/mm/aaaa» e «mm/aaaa» (esta, no último dia do mês). */
export function datasNoTexto(texto: string): Date[] {
  const achadas: Date[] = [];
  for (const m of texto.matchAll(/(?<![\d/])(\d{2})\/(\d{2})\/(\d{4})(?!\d)/g)) {
    const d = dia(Number(m[3]), Number(m[2]), Number(m[1]));
    if (d) achadas.push(d);
  }
  const semCompletas = texto.replace(/\d{2}\/\d{2}\/\d{4}/g, " ");
  for (const m of semCompletas.matchAll(/(?<![\d/])(\d{2})\/(\d{4})(?!\d)/g)) {
    const mes = Number(m[1]);
    const ano = Number(m[2]);
    if (mes >= 1 && mes <= 12) {
      const fim = new Date(Date.UTC(ano, mes, 0)); // dia 0 do mês seguinte = último dia deste
      achadas.push(fim);
    }
  }
  return achadas;
}

function dataDeReferencia(rep: Relatorio): Date {
  for (const valor of [rep.fatos.previa_gerada_em, rep.fatos.ultima_atualizacao]) {
    const m = valor ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor) : null;
    if (m) {
      const d = dia(Number(m[3]), Number(m[2]), Number(m[1]));
      if (d) return d;
    }
  }
  const agora = new Date();
  return new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
}

// ---- checagens ---------------------------------------------------------------

function checarCabecalho(linhas: string[], rep: Relatorio): void {
  const inicio = linhas.slice(0, 80).join(" ");
  let m = /Última atualização do currículo em (\d{2}\/\d{2}\/\d{4})/.exec(inicio);
  if (m) rep.fatos.ultima_atualizacao = m[1] as string;
  m = /Página gerada pelo sistema Currículo Lattes em (\d{2}\/\d{2}\/\d{4})/.exec(linhas.join(" "));
  if (m) {
    rep.fatos.previa_gerada_em = m[1] as string;
    rep.fatos.tipo = "prévia (não publicada)";
  }
  m = /lattes\.cnpq\.br\/(\d{16})/.exec(inicio);
  if (m) rep.fatos.lattes_id = m[1] as string;
}

function nomesEmCitacoes(secoes: Secoes): string[] {
  const ident = secao(secoes, "Identificação");
  for (let i = 0; i < ident.length; i++) {
    const linha = ident[i] as string;
    if (fold(linha).startsWith("nome em citacoes bibliograficas")) {
      const depois = linha.split("bibliográficas").slice(1).join("bibliográficas");
      let valor = (linha.includes("bibliográficas") ? depois : linha).replace(/^[ :]+|[ :]+$/g, "");
      if (!valor && i + 1 < ident.length) valor = ident[i + 1] as string;
      return valor.split(";").map((n) => n.trim()).filter(Boolean);
    }
  }
  return [];
}

function checarResumo(resumoHtml: string, secoes: Secoes, rep: Relatorio): void {
  let resumo = resumoHtml;
  if (!resumo) {
    // .txt e PDF não marcam o resumo: ele é o texto depois de «Última atualização…»
    // (em PDF as linhas vêm quebradas, então junta todas até a primeira seção).
    const cab = secao(secoes, "_cabecalho");
    const idx = cab.findIndex((l) => fold(l).startsWith("ultima atualizacao do curriculo"));
    if (idx >= 0) {
      resumo = normalizeSpace(cab.slice(idx + 1).join(" "));
      resumo = resumo.replace(/\s*\(Texto informado pelo autor\)\s*$/, "");
    }
    if (!resumo) resumo = cab.find((l) => l.length > 300) ?? "";
  }
  rep.fatos.resumo_caracteres = resumo.length;
  if (!resumo) {
    rep.add("ATENÇÃO", "Resumo", "Não encontrei o texto inicial (resumo) do currículo.",
      "Escreva um resumo em Dados gerais › Texto inicial do Currículo Lattes.");
    return;
  }
  if (resumo.includes("Texto gerado automaticamente")) {
    rep.add("ATENÇÃO", "Resumo", "O resumo é o texto gerado automaticamente pelo Lattes.",
      "Escreva um texto próprio (ver references/dados-gerais-e-resumo.md).");
  }
  if (resumo.length > 4000) {
    rep.add("ERRO", "Resumo", `O resumo tem ${resumo.length} caracteres (limite 4.000).`);
  }

  const vistas: string[] = [];
  for (const s of sentencas(resumo)) {
    for (const anterior of vistas) {
      if (razao(fold(s), fold(anterior)) > 0.8) {
        rep.add("ATENÇÃO", "Resumo", "Duas frases do resumo dizem quase a mesma coisa.",
          "Junte as duas numa só.", `«${anterior.slice(0, 100)}» / «${s.slice(0, 100)}»`);
        break;
      }
    }
    vistas.push(s);
  }

  const f = fold(resumo);
  if (/bolsista de extensao[^.]{0,60}(pibic|iniciacao cientifica)/.test(f) ||
      /(pibic|iniciacao cientifica)[^.]{0,60}extensao/.test(f)) {
    rep.add("ERRO", "Resumo", "O resumo mistura bolsa de extensão com PIBIC/iniciação científica.",
      "PIBIC/PIBITI são bolsas de iniciação científica/tecnológica, não de extensão.");
  }

  for (const [errado, certo] of COMMON_TYPOS) {
    if (new RegExp(INICIO_PALAVRA + escapeRegExp(errado) + FIM_PALAVRA, "iu").test(resumo)) {
      rep.add("ATENÇÃO", "Resumo", `Possível erro de digitação: «${errado}» → «${certo}».`);
    }
  }
  if (new RegExp(INICIO_PALAVRA + "aonde" + FIM_PALAVRA, "iu").test(resumo)) {
    rep.add("INFO", "Resumo", "«aonde» só se usa com verbos de movimento; em geral o certo é «onde».");
  }

  for (const m of resumo.matchAll(ORDINAL_LOST)) {
    rep.add("INFO", "Resumo", `Possível «º» perdido em «${m[0]}».`,
      "O Lattes às vezes remove «º»/«ª». Prefira «quarto lugar», «36.ª edição» " +
        "ou o nome oficial do evento.");
  }

  // bolsa citada nos vínculos mas não no resumo
  const atuacao = secao(secoes, "Atuação profissional").join(" ");
  if (/V[íi]nculo: Bolsista/.test(atuacao) && !/bols/.test(f)) {
    rep.add("ATENÇÃO", "Resumo", "Há vínculo de bolsista em Atuação, mas o resumo não menciona a bolsa.");
  }
}

function checarFormacao(secoes: Secoes, rep: Relatorio): void {
  const form = secao(secoes, "Formação acadêmica/titulação");
  for (let i = 0; i < form.length; i++) {
    const linha = form[i] as string;
    const m = /^(\d{4})( - (\d{4}|Atual))?\s*(.*)$/.exec(linha);
    if (!m) continue;
    const resto = m[4] || (i + 1 < form.length ? (form[i + 1] as string) : "");
    let j = i + 1;
    while (j < form.length && !/^\d{4}( - |\s|$)/.test(form[j] as string)) j++;
    const bloco = form.slice(i, j).join(" ");
    const nivel = /(Graduação|Mestrado|Doutorado|Especialização)/.exec(resto + " " + bloco);
    if (!nivel) continue;
    const umAno = m[2] === undefined;
    const andamento = fold(bloco).includes("em andamento");
    const obtido = fold(bloco).includes("ano de obtencao") || (m[3] !== undefined && m[3] !== "Atual");
    if (umAno && !andamento && !obtido) {
      rep.add("ATENÇÃO", "Formação",
        `${nivel[1]} com só um ano (${m[1]}) e sem «em andamento» nem ano de obtenção.`,
        "Confira se a situação está «Em andamento» (curso atual) ou se falta o ano de conclusão.",
        bloco);
    }
  }

  const comp = secao(secoes, "Formação Complementar").join(" ");
  if (/(inicia[çc][ãa]o cient|pibic|pibiti|monitori|est[áa]gio|bolsista)/i.test(comp)) {
    rep.add("ERRO", "Formação complementar",
      "Há IC, monitoria, estágio ou bolsa em Formação complementar.",
      "Formação complementar é para cursos (curta duração, extensão, MBA). " +
        "Bolsas e funções vão em Atuação profissional (vínculo + atividade).");
  }
}

function checarAtuacao(secoes: Secoes, rep: Relatorio): void {
  const atu = secao(secoes, "Atuação profissional");
  const linhas = secao(secoes, "Linhas de pesquisa");
  rep.fatos.tem_vinculo_bolsista = /V[íi]nculo: Bolsista/.test(atu.join(" "));

  // instituições que parecem laboratório/grupo: a linha da instituição é a que
  // vem logo antes de uma linha «AAAA - AAAA Vínculo: ...».
  for (let idx = 0; idx < atu.length - 1; idx++) {
    const linha = atu[idx] as string;
    if (!/^\d{4}( - (\d{4}|Atual))?\s+V[íi]nculo:/.test(atu[idx + 1] as string)) continue;
    if (LAB_LIKE.test(linha) &&
        !/(universidade|instituto federal|faculdade|fundação|centro universitário)/i.test(linha)) {
      rep.add("ATENÇÃO", "Atuação", "Uma instituição parece ser laboratório ou grupo.",
        "A instituição deve ser a universidade; o laboratório/grupo vai em " +
          "Outras informações ou na atividade.", linha);
    }
  }

  // atividades duplicadas: mesma natureza e mesma unidade, ambas 'Atual'
  const vistas = new Map<string, string>();
  atu.forEach((linha, idx) => {
    const m = /^((\d{2}\/)?\d{4}) - (Atual|(\d{2}\/)?\d{4})\s*(.*)$/.exec(linha);
    if (!m) return;
    const ini = m[1] as string;
    const fim = m[3] as string;
    const desc = fold(m[5] || (idx + 1 < atu.length ? (atu[idx + 1] as string) : ""));
    if (!desc || desc.startsWith("vinculo")) return;
    const chave = `${desc}|${fim === "Atual"}`;
    if (vistas.has(chave) && fim === "Atual") {
      rep.add("ATENÇÃO", "Atuação",
        `Duas atividades iguais em andamento (${vistas.get(chave)} e ${ini}).`,
        "Se for o mesmo trabalho, mantenha só a com a data correta (uma mesma " +
          "atividade aceita várias linhas de pesquisa).", desc);
    } else {
      vistas.set(chave, ini);
    }
  });

  // monitoria ou estágio cadastrados com a natureza «Outro»
  atu.forEach((linha, idx) => {
    if (!/^(\d{2}\/)?\d{4} - (Atual|(\d{2}\/)?\d{4})\s+Outro(?![\p{L}\p{N}_])/iu.test(linha)) return;
    const perto = fold(atu.slice(idx, idx + 4).join(" "));
    if (perto.includes("monitor")) {
      rep.add("ATENÇÃO", "Atuação", "Monitoria cadastrada como atividade de natureza «Outro».",
        "Monitoria é atividade de Ensino: edite e escolha a natureza «Ensino» " +
          "(«Monitoria da disciplina X, sob orientação de Y»).", linha);
    } else if (perto.includes("estagi")) {
      rep.add("ATENÇÃO", "Atuação", "Estágio cadastrado como atividade de natureza «Outro».",
        "Use a natureza «Estágio».", linha);
    }
  });

  // linhas de pesquisa que parecem nome de grupo
  const pool = [...linhas, ...atu.filter((l) => l.startsWith("Linhas de pesquisa"))];
  for (const linha of pool) {
    const txt = linha.replace(/^(\d+\.\s*|Linhas de pesquisa:\s*)/, "");
    if (LAB_LIKE.test(txt)) {
      rep.add("ERRO", "Linhas de pesquisa",
        "Uma linha de pesquisa parece ser o nome do grupo/laboratório.",
        "Linha de pesquisa é um tema (ex.: «Jornalismo de dados»); " +
          "o grupo não é linha. Exclua a atividade/linha errada.", txt);
    }
  }
  if (new Set(linhas.map(fold)).size < linhas.length) {
    rep.add("ATENÇÃO", "Linhas de pesquisa", "Há linhas de pesquisa repetidas.");
  }

  for (const linha of atu) {
    for (const m of linha.matchAll(ORDINAL_LOST)) {
      rep.add("INFO", "Atuação", `Possível «º» perdido em «${m[0]}».`,
        "O Lattes às vezes remove «º»/«ª»; reescreva sem o símbolo.", linha);
    }
  }
}

/** Vínculo «Atual» cuja vigência, descrita em «Outras informações», já terminou. */
function checarVigencias(secoes: Secoes, rep: Relatorio): void {
  const atu = secao(secoes, "Atuação profissional");
  const ref = dataDeReferencia(rep);
  atu.forEach((linha, idx) => {
    if (!/^\d{4} - Atual\s+Vínculo:/.test(linha)) return;
    const bloco: string[] = [];
    let j = idx + 1;
    while (j < atu.length && !/^((\d{2}\/)?\d{4})( - |\s)/.test(atu[j] as string) &&
           fold(atu[j] as string) !== "atividades") {
      bloco.push(atu[j] as string);
      j++;
    }
    const texto = bloco.join(" ");
    if (!fold(texto).includes("vigenc")) return;
    const datas = datasNoTexto(texto);
    if (datas.length === 0) return;
    const maxima = datas.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
    if (maxima.getTime() < ref.getTime()) {
      rep.add("ATENÇÃO", "Atuação",
        `A vigência descrita termina em ${formatarData(maxima)}, mas o vínculo continua «Atual».`,
        "Se a bolsa foi renovada, acrescente a nova vigência em «Outras " +
          "informações»; se terminou, ponha o mês de fim no vínculo e na atividade " +
          "(e use o passado no resumo).", linha);
    }
  });
}

function checarProjetos(secoes: Secoes, rep: Relatorio): void {
  const chaves = [...secoes.keys()].filter((k) => k.startsWith("Projetos"));
  rep.fatos.secoes_de_projeto = chaves;
  if (rep.fatos.tem_vinculo_bolsista && !secoes.has("Projetos de pesquisa")) {
    rep.add("ATENÇÃO", "Projetos", "Há vínculo de bolsista, mas nenhum projeto de pesquisa aparece.",
      "Cadastre o projeto real do orientador em Projetos › Projeto de pesquisa " +
        "(se foi salvo como Privado, ele não aparece).");
  }
  for (const k of chaves) {
    for (const linha of secao(secoes, k)) {
      if (/^(\d{4} - (Atual|\d{4}) )?(inicia[çc][ãa]o cient[íi]fica|pibic|pibiti)\.?$/i.test(linha)) {
        rep.add("ERRO", "Projetos", "Projeto com nome genérico de IC.",
          "IC não é projeto: use o título real do projeto do orientador.", linha);
      }
    }
  }
}

const PRODUCTION_SECTIONS = [
  "Produção", "Produções", "Produção bibliográfica", "Produção técnica",
  "Produção artística/cultural", "Patentes e registros", "Eventos",
  "Educação e Popularização de C & T", "Educação e Popularização de C&T",
];

const SUBSECAO = new RegExp(
  "^(artigos? (completos|aceitos)|livros|capitulos|textos? em jornais?|trabalhos " +
    "(completos )?publicados|resumos|apresentac|demais|outras? producoes|programa de " +
    "computador|redes sociais|relatorio)",
);
const PREPRINT = /preprint|pre-print|arxiv|biorxiv|medrxiv|ssrn|research ?square|osf\.io/i;

export interface ItemProducao {
  secao: string;
  sub: string;
  texto: string;
}

/** Itens numerados das seções de produção, com a subseção em que estão. */
export function listarItens(secoes: Secoes): ItemProducao[] {
  const itens: ItemProducao[] = [];
  for (const sec of PRODUCTION_SECTIONS) {
    let sub = "";
    for (const linha of secao(secoes, sec)) {
      const m = ITEM_NUMBER.exec(linha);
      if (m && (m[2] as string).length > 15) {
        itens.push({ secao: sec, sub, texto: m[2] as string });
      } else if (!m && linha.length < 110 && SUBSECAO.test(fold(linha))) {
        sub = linha;
      }
    }
  }
  return itens;
}

function checarArtigos(itens: ItemProducao[], rep: Relatorio): void {
  const aceitos: string[] = [];
  const completos: string[] = [];
  for (const { secao: sec, sub, texto } of itens) {
    const fs = fold(sub);
    const ehAceito = fs.startsWith("artigos aceitos");
    const ehCompleto = fs.startsWith("artigos completos");
    if (ehAceito) {
      aceitos.push(texto);
      if (/(?<![\p{L}\p{N}_])doi(?![\p{L}\p{N}_])|10\.\d{4,9}\/|(?<![\p{L}\p{N}_])v\.\s?\d|(?<![\p{L}\p{N}_])p\.\s?\d/iu.test(texto)) {
        rep.add("ATENÇÃO", sec,
          "Artigo em «aceitos» já traz dados de publicação (DOI, volume ou páginas).",
          "Se já saiu, exclua este item e cadastre em «Artigos completos» pelo DOI.", texto);
      }
      if (/submetid|em avaliac|under review|em revisao/.test(fold(texto))) {
        rep.add("ERRO", sec, "Artigo apenas submetido cadastrado como aceito.",
          "Submetido ou em avaliação não entra no Lattes; só com carta de aceite.", texto);
      }
    }
    if (ehCompleto) completos.push(texto);
    if ((ehAceito || ehCompleto) && PREPRINT.test(texto)) {
      rep.add("ATENÇÃO", sec, "Parece um preprint cadastrado como artigo.",
        "Preprint não é artigo publicado nem aceito. Confirme com o orientador ou " +
          "o programa onde registrar (ver references/producoes.md).", texto);
    }
  }
  for (const a of aceitos) {
    for (const c of completos) {
      const ta = fold(a).slice(0, 120);
      const tc = fold(c).slice(0, 120);
      if (ta.length > 20 && razao(ta, tc) > 0.85) {
        rep.add("ATENÇÃO", "Produção bibliográfica",
          "O mesmo artigo está em «aceitos» e em «completos».",
          "Exclua o item de «Artigos aceitos»: ele já foi publicado.", a);
      }
    }
  }
}

function tituloDe(texto: string): string {
  const partes = texto.split(/\.\s/);
  const resto = partes.length > 1 ? partes.slice(1).join(". ") : texto;
  return fold(resto).slice(0, 120);
}

function checarProducoes(secoes: Secoes, nomes: string[], rep: Relatorio): void {
  const itens = listarItens(secoes);
  rep.fatos.itens_de_producao = itens.length;
  checarArtigos(itens, rep);

  const nomesFold = nomes.map(fold);
  if (nomesFold.length > 0) {
    for (const { secao: sec, texto } of itens) {
      const ft = fold(texto);
      if (!nomesFold.some((n) => n && ft.includes(n))) {
        rep.add("ATENÇÃO", sec, "Seu nome em citação não aparece entre os autores deste item.",
          "Inclua-se como autor/participante (o Lattes exige) ou acrescente essa " +
            "forma do seu nome em «Nome em citações bibliográficas».", texto);
      }
    }
  }

  // duplicatas por título parecido
  for (let i = 0; i < itens.length; i++) {
    for (let j = i + 1; j < itens.length; j++) {
      const subs = new Set([
        fold((itens[i] as ItemProducao).sub).slice(0, 15),
        fold((itens[j] as ItemProducao).sub).slice(0, 15),
      ]);
      if (subs.size === 2 && subs.has("artigos aceitos") && subs.has("artigos complet")) continue;
      const a = tituloDe((itens[i] as ItemProducao).texto);
      const b = tituloDe((itens[j] as ItemProducao).texto);
      if (a.length > 20 && razao(a, b) > 0.9) {
        rep.add("ATENÇÃO", "Produções", "Dois itens parecem ser o mesmo trabalho.",
          "Se for duplicata, exclua um. Se for o mesmo trabalho em formas " +
            "diferentes (ex.: apresentação e publicação em anais), está certo.",
          `${(itens[i] as ItemProducao).texto.slice(0, 90)} | ${(itens[j] as ItemProducao).texto.slice(0, 90)}`);
      }
    }
  }

  for (const { secao: sec, texto } of itens) {
    if (texto.includes("http://http") || texto.includes("https://http")) {
      rep.add("ERRO", sec, "Link com «http://» repetido.",
        "O Lattes já acrescenta «http://»; apague o prefixo do campo.", texto);
    }
    for (const m of texto.matchAll(ORDINAL_LOST)) {
      rep.add("INFO", sec, `Possível «º» perdido em «${m[0]}».`, "", texto);
    }
  }

  if (!secoes.has("Eventos")) {
    rep.add("INFO", "Eventos", "A seção Eventos não aparece neste arquivo.",
      "Na prévia gerada pelo editor, Eventos pode não aparecer mesmo quando há itens " +
        "salvos e públicos. Confira no editor (Eventos › Participação/Organização) e, " +
        "depois do envio, no currículo público.");
  }
}

export function executar(caminho: string): Relatorio {
  const { linhas, resumo } = lerTexto(caminho);
  const secoes = dividirSecoes(linhas);
  const encontradas = [...secoes.keys()].filter((k) => !k.startsWith("_"));
  if (encontradas.length < 2) {
    throw new ArquivoInvalido(
      "Este arquivo não parece ser a prévia nem a página de um Currículo Lattes: " +
        `achei ${encontradas.length} seção(ões) conhecida(s) (como «Formação ` +
        "acadêmica/titulação» e «Atuação profissional»). Confira se salvou a página " +
        "certa («Gerar arquivo para visualização e conferência») e se o arquivo é " +
        "HTML, .txt ou PDF com texto.",
    );
  }
  const rep = new Relatorio();
  rep.fatos.secoes_encontradas = encontradas;
  const nomes = nomesEmCitacoes(secoes);
  rep.fatos.nomes_em_citacoes = nomes;
  checarCabecalho(linhas, rep);
  if (comecaComoPdf(caminho)) {
    rep.add("INFO", "Arquivo",
      "A leitura de PDF é aproximada: o texto quebra em linhas e os itens de " +
        "produção podem não ser contados.",
      "Para uma revisão completa, salve a prévia como HTML (Cmd/Ctrl + S).");
  }
  checarResumo(resumo, secoes, rep);
  checarFormacao(secoes, rep);
  checarAtuacao(secoes, rep);
  checarVigencias(secoes, rep);
  checarProjetos(secoes, rep);
  checarProducoes(secoes, nomes, rep);
  if (nomes.length === 0) {
    rep.add("ATENÇÃO", "Identificação", "Não encontrei «Nome em citações bibliográficas».",
      "Preencha em Dados gerais › Identificação; sem isso não dá para conferir autorias.");
  }
  return rep;
}

const ORDEM: Record<Nivel, number> = { ERRO: 0, "ATENÇÃO": 1, INFO: 2 };

export function paraMarkdown(rep: Relatorio): string {
  const f = rep.fatos;
  const out: string[] = ["# Revisão automática do Lattes", ""];
  out.push(`- Tipo de arquivo: ${f.tipo ?? "página do currículo"}`);
  const rotulos: [keyof Fatos, string][] = [
    ["previa_gerada_em", "Prévia gerada em"],
    ["ultima_atualizacao", "Última atualização informada"],
    ["lattes_id", "ID Lattes"],
  ];
  for (const [chave, rotulo] of rotulos) {
    if (f[chave]) out.push(`- ${rotulo}: ${String(f[chave])}`);
  }
  out.push(`- Nomes em citações: ${(f.nomes_em_citacoes ?? []).join("; ") || "—"}`);
  out.push(`- Seções encontradas: ${(f.secoes_encontradas ?? []).join(", ")}`);
  out.push(`- Resumo: ${f.resumo_caracteres ?? 0} caracteres`);
  out.push(`- Itens de produção numerados: ${f.itens_de_producao ?? 0}`);
  const cont = (n: Nivel) => rep.itens.filter((i) => i.nivel === n).length;
  out.push(`- Resultado: ${cont("ERRO")} erro(s), ${cont("ATENÇÃO")} atenção(ões), ${cont("INFO")} informação(ões)`);
  out.push("");
  if (rep.itens.length === 0) {
    out.push("Nenhum problema automático encontrado. Ainda vale uma leitura humana.");
    return out.join("\n");
  }
  out.push("## Pontos a conferir", "");
  const ordenados = [...rep.itens].sort((a, b) => (ORDEM[a.nivel] ?? 9) - (ORDEM[b.nivel] ?? 9));
  for (const it of ordenados) {
    let linha = `- **${it.nivel} · ${it.area}:** ${it.mensagem}`;
    if (it.dica) linha += ` ${it.dica}`;
    if (it.trecho) linha += `\n  - Trecho: \`${it.trecho}\``;
    out.push(linha);
  }
  out.push("");
  out.push("_Checagem automática por heurísticas: confirme cada ponto antes de mudar o currículo._");
  return out.join("\n");
}

const AJUDA = "uso: node revisar_previa.ts ARQUIVO [--json]\n\n" +
  "Revisa a prévia de um Currículo Lattes (HTML, .txt ou PDF com texto).\n" +
  "  --json   saída em JSON\n  -h, --help";

export function main(argv: string[], saida: Saida = saidaPadrao): number {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
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
  const [arquivo] = args.positionals;
  if (!arquivo || args.positionals.length > 1) {
    saida.err(`${AJUDA}\n\nerro: informe um único arquivo.`);
    return 2;
  }
  if (!existsSync(arquivo)) {
    saida.err(`Arquivo não encontrado: ${arquivo}`);
    return 2;
  }
  if (statSync(arquivo).isDirectory()) {
    saida.err(`${arquivo} é uma pasta. Indique o arquivo da prévia (.html, .txt ou .pdf).`);
    return 2;
  }
  let rep: Relatorio;
  try {
    rep = executar(arquivo);
  } catch (erro) {
    if (erro instanceof ArquivoInvalido) {
      saida.err(erro.message);
      return 3;
    }
    saida.err(`Não consegui ler o arquivo: ${(erro as Error).message}`);
    return 2;
  }
  saida.out(args.values.json
    ? JSON.stringify({ fatos: rep.fatos, pontos: rep.itens }, null, 2)
    : paraMarkdown(rep));
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
