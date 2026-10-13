#!/usr/bin/env python3
"""Revisa a prévia (ou a página pública) de um Currículo Lattes salva em HTML.

Uso:
    python3 revisar_previa.py CAMINHO_DO_ARQUIVO.html [--json]

Como obter o arquivo: no editor do Lattes, use "Gerar arquivo para visualização
e conferência" (menu lateral) e salve a página aberta (Cmd/Ctrl + S, "Página da
Web, somente HTML"). Também funciona com a página pública do currículo salva em
HTML ou com um .txt copiado da página.

O script só usa a biblioteca padrão do Python 3.8+ e não envia nada para a
internet. Ele aponta problemas prováveis; quem decide é a pessoa dona do
currículo.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

# --------------------------------------------------------------------------
# Leitura e linearização do HTML
# --------------------------------------------------------------------------

BLOCK_TAGS = {
    "p", "div", "tr", "table", "li", "ul", "ol", "h1", "h2", "h3", "h4",
    "br", "em", "section", "article", "header", "footer",
}
SKIP_TAGS = {"script", "style", "noscript"}
# Contêineres de navegação da página do Lattes (menus repetem nomes de seções).
SKIP_CLASSES = {"header", "megamenu", "menuPrincipal", "menu-header"}


class _Linearizer(HTMLParser):
    """Converte HTML em linhas de texto, preservando quebras de bloco."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0
        self.nav_tag = None
        self.nav_depth = 0
        self.resumo_depth = 0
        self.resumo_parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if self.nav_tag:
            if tag == self.nav_tag:
                self.nav_depth += 1
            return
        if tag in SKIP_TAGS:
            self.skip_depth += 1
            return
        cls = dict(attrs).get("class", "") or ""
        if tag in {"div", "ul", "nav"} and SKIP_CLASSES & set(cls.split()):
            self.nav_tag, self.nav_depth = tag, 1
            return
        if tag == "p" and "resumo" in cls.split():
            self.resumo_depth = 1
        if tag in BLOCK_TAGS:
            self.parts.append("\n")
        if tag == "td":
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if self.nav_tag:
            if tag == self.nav_tag:
                self.nav_depth -= 1
                if self.nav_depth == 0:
                    self.nav_tag = None
            return
        if tag in SKIP_TAGS and self.skip_depth:
            self.skip_depth -= 1
            return
        if tag == "p" and self.resumo_depth:
            self.resumo_depth = 0
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if self.skip_depth or self.nav_tag:
            return
        self.parts.append(data)
        if self.resumo_depth:
            self.resumo_parts.append(data)


def read_text(path: Path) -> tuple[list[str], str]:
    raw = path.read_bytes()
    match = re.search(rb'charset=["\']?([A-Za-z0-9_\-]+)', raw[:4000])
    encodings = []
    if match:
        encodings.append(match.group(1).decode("ascii", "ignore"))
    encodings += ["utf-8", "cp1252", "latin-1"]
    text = None
    for enc in encodings:
        try:
            text = raw.decode(enc)
            break
        except (LookupError, UnicodeDecodeError):
            continue
    if text is None:
        text = raw.decode("utf-8", errors="replace")

    if path.suffix.lower() in {".txt", ".md"}:
        lines = [normalize_space(l) for l in text.splitlines()]
        return [l for l in lines if l], ""

    parser = _Linearizer()
    parser.feed(text)
    joined = "".join(parser.parts)
    lines = [normalize_space(l) for l in joined.split("\n")]
    resumo = normalize_space("".join(parser.resumo_parts))
    return [l for l in lines if l], resumo


def normalize_space(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def fold(s: str) -> str:
    """Minúsculas sem acentos, para comparações tolerantes."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.lower()).strip()


# --------------------------------------------------------------------------
# Segmentação em seções
# --------------------------------------------------------------------------

# Títulos de seção que aparecem na prévia e na página pública.
SECTION_TITLES = [
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
]
_SECTION_KEYS = {fold(t): t for t in SECTION_TITLES}
# A prévia escreve "Producão" (sic) em alguns casos.
_SECTION_KEYS[fold("Producão")] = "Produção"


def split_sections(lines: list[str]) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {"_cabecalho": []}
    current = "_cabecalho"
    for line in lines:
        key = fold(line)
        if key in _SECTION_KEYS:
            current = _SECTION_KEYS[key]
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)
    return sections


# --------------------------------------------------------------------------
# Checagens
# --------------------------------------------------------------------------

class Report:
    def __init__(self) -> None:
        self.items: list[dict] = []
        self.facts: dict = {}

    def add(self, nivel: str, area: str, msg: str, dica: str = "", trecho: str = ""):
        self.items.append({
            "nivel": nivel, "area": area, "mensagem": msg,
            "dica": dica, "trecho": trecho[:220],
        })


COMMON_TYPOS = {
    # erro: forma correta
    "aquirida": "adquirida", "aquirido": "adquirido", "auxliando": "auxiliando",
    "concerteza": "com certeza", "derrepente": "de repente", "excessão": "exceção",
    "previlégio": "privilégio", "beneficiente": "beneficente",
    "asterístico": "asterisco", "impecilho": "empecilho", "mal-criado": "malcriado",
    "advinhar": "adivinhar", "metereologia": "meteorologia", "iniciação cientifica":
    "iniciação científica", "academico": "acadêmico", "pesquisa cientifica":
    "pesquisa científica", "graduaçao": "graduação", "comunicaçao": "comunicação",
    "orientaçao": "orientação", "participaçao": "participação",
}

ORDINAL_LOST = re.compile(
    r"\b(\d{1,3}) (lugar|colocação|congresso|encontro|seminário|seminario|simpósio|"
    r"simposio|semana|edição|edicao|colóquio|coloquio|jornada|mostra|festival|"
    r"conferência|conferencia|fórum|forum|salão|salao)\b",
    re.IGNORECASE,
)

LAB_LIKE = re.compile(
    r"(laborat[óo]rio|grupo de (pesquisa|estudos?)|n[úu]cleo|\blab\b|lab/|/u[a-z]{2,4}\b|"
    r"observat[óo]rio|\bcolab\b)",
    re.IGNORECASE,
)

DATE_RANGE = re.compile(r"^(\d{2}/)?\d{4}( - (\d{2}/)?\d{4}| - Atual)?$")
ITEM_NUMBER = re.compile(r"^(\d{1,3})\.\s*(.*)$")


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if len(p.strip()) > 25]


def check_header(lines, rep: Report):
    joined = " ".join(lines[:80])
    m = re.search(r"Última atualização do currículo em (\d{2}/\d{2}/\d{4})", joined)
    if m:
        rep.facts["ultima_atualizacao"] = m.group(1)
    m = re.search(r"Página gerada pelo sistema Currículo Lattes em (\d{2}/\d{2}/\d{4})",
                  " ".join(lines))
    if m:
        rep.facts["previa_gerada_em"] = m.group(1)
        rep.facts["tipo"] = "prévia (não publicada)"
    m = re.search(r"lattes\.cnpq\.br/(\d{16})", joined)
    if m:
        rep.facts["lattes_id"] = m.group(1)


def citation_names(sections) -> list[str]:
    ident = sections.get("Identificação", [])
    for i, line in enumerate(ident):
        if fold(line).startswith("nome em citacoes bibliograficas"):
            value = line.split("bibliográficas", 1)[-1].strip(" :")
            if not value and i + 1 < len(ident):
                value = ident[i + 1]
            names = [n.strip() for n in value.split(";") if n.strip()]
            return names
    return []


def check_resumo(resumo: str, lines, sections, rep: Report):
    if not resumo:
        # tenta achar o texto longo no cabeçalho
        candidates = [l for l in sections.get("_cabecalho", []) if len(l) > 300]
        resumo = candidates[0] if candidates else ""
    rep.facts["resumo_caracteres"] = len(resumo)
    if not resumo:
        rep.add("ATENÇÃO", "Resumo", "Não encontrei o texto inicial (resumo) do currículo.",
                "Escreva um resumo em Dados gerais › Texto inicial do Currículo Lattes.")
        return
    if "Texto gerado automaticamente" in resumo:
        rep.add("ATENÇÃO", "Resumo", "O resumo é o texto gerado automaticamente pelo Lattes.",
                "Escreva um texto próprio (ver references/dados-gerais-e-resumo.md).")
    if len(resumo) > 4000:
        rep.add("ERRO", "Resumo", f"O resumo tem {len(resumo)} caracteres (limite 4.000).")

    sents = sentences(resumo)
    seen = []
    for s in sents:
        for prev in seen:
            ratio = difflib.SequenceMatcher(None, fold(s), fold(prev)).ratio()
            if ratio > 0.8:
                rep.add("ATENÇÃO", "Resumo", "Duas frases do resumo dizem quase a mesma coisa.",
                        "Junte as duas numa só.", f"«{prev[:100]}» / «{s[:100]}»")
                break
        seen.append(s)

    f = fold(resumo)
    if re.search(r"bolsista de extensao[^.]{0,60}(pibic|iniciacao cientifica)", f) or \
       re.search(r"(pibic|iniciacao cientifica)[^.]{0,60}extensao", f):
        rep.add("ERRO", "Resumo", "O resumo mistura bolsa de extensão com PIBIC/iniciação científica.",
                "PIBIC/PIBITI são bolsas de iniciação científica/tecnológica, não de extensão.")

    for wrong, right in COMMON_TYPOS.items():
        if re.search(r"\b" + re.escape(wrong) + r"\b", resumo, re.IGNORECASE):
            rep.add("ATENÇÃO", "Resumo", f"Possível erro de digitação: «{wrong}» → «{right}».")
    if re.search(r"\baonde\b", resumo, re.IGNORECASE):
        rep.add("INFO", "Resumo", "«aonde» só se usa com verbos de movimento; em geral o certo é «onde».")

    for m in ORDINAL_LOST.finditer(resumo):
        rep.add("INFO", "Resumo", f"Possível «º» perdido em «{m.group(0)}».",
                "O Lattes às vezes remove «º»/«ª». Prefira «quarto lugar», «36.ª edição» "
                "ou o nome oficial do evento.")

    # bolsa citada nos vínculos mas não no resumo
    atuacao = " ".join(sections.get("Atuação profissional", []))
    if re.search(r"V[íi]nculo: Bolsista", atuacao) and not re.search(r"bols", f):
        rep.add("ATENÇÃO", "Resumo", "Há vínculo de bolsista em Atuação, mas o resumo não menciona a bolsa.")


def check_formacao(sections, rep: Report):
    form = sections.get("Formação acadêmica/titulação", [])
    i = 0
    while i < len(form):
        line = form[i]
        m = re.match(r"^(\d{4})( - (\d{4}|Atual))?\s*(.*)$", line)
        if m:
            rest = m.group(4) or (form[i + 1] if i + 1 < len(form) else "")
            j = i + 1
            while j < len(form) and not re.match(r"^\d{4}( - |\s|$)", form[j]):
                j += 1
            block = " ".join(form[i:j])
            nivel = re.search(r"(Graduação|Mestrado|Doutorado|Especialização)", rest + " " + block)
            if nivel:
                single_year = m.group(2) is None
                andamento = "em andamento" in fold(block)
                obtido = "ano de obtencao" in fold(block) or m.group(3) not in (None, "Atual")
                if single_year and not andamento and not obtido:
                    rep.add("ATENÇÃO", "Formação",
                            f"{nivel.group(1)} com só um ano ({m.group(1)}) e sem «em andamento» "
                            "nem ano de obtenção.",
                            "Confira se a situação está «Em andamento» (curso atual) ou se falta "
                            "o ano de conclusão.", block)
        i += 1

    comp = " ".join(sections.get("Formação Complementar", []))
    if re.search(r"(inicia[çc][ãa]o cient|pibic|pibiti|monitori|est[áa]gio|bolsista)", comp, re.I):
        rep.add("ERRO", "Formação complementar",
                "Há IC, monitoria, estágio ou bolsa em Formação complementar.",
                "Formação complementar é para cursos (curta duração, extensão, MBA). "
                "Bolsas e funções vão em Atuação profissional (vínculo + atividade).")


def check_atuacao(sections, rep: Report):
    atu = sections.get("Atuação profissional", [])
    linhas = sections.get("Linhas de pesquisa", [])
    joined = " ".join(atu)
    rep.facts["tem_vinculo_bolsista"] = bool(re.search(r"V[íi]nculo: Bolsista", joined))

    # instituições que parecem laboratório/grupo: a linha da instituição é a que
    # vem logo antes de uma linha «AAAA - AAAA Vínculo: ...».
    for idx, line in enumerate(atu[:-1]):
        nxt = atu[idx + 1]
        if not re.match(r"^\d{4}( - (\d{4}|Atual))?\s+V[íi]nculo:", nxt):
            continue
        if LAB_LIKE.search(line) and not re.search(
                r"(universidade|instituto federal|faculdade|fundação|centro universitário)",
                line, re.I):
            rep.add("ATENÇÃO", "Atuação", "Uma instituição parece ser laboratório ou grupo.",
                    "A instituição deve ser a universidade; o laboratório/grupo vai em "
                    "Outras informações ou na atividade.", line)

    # atividades duplicadas: mesma natureza e mesma unidade, ambas 'Atual'
    acts = []
    for idx, line in enumerate(atu):
        m = re.match(r"^((\d{2}/)?\d{4}) - (Atual|(\d{2}/)?\d{4})\s*(.*)$", line)
        if m:
            desc = m.group(5) or (atu[idx + 1] if idx + 1 < len(atu) else "")
            acts.append((m.group(1), m.group(3), fold(desc)))
    seen = {}
    for ini, fim, desc in acts:
        if not desc or desc.startswith("vinculo"):
            continue
        key = (desc, fim == "Atual")
        if key in seen and fim == "Atual":
            rep.add("ATENÇÃO", "Atuação",
                    f"Duas atividades iguais em andamento ({seen[key]} e {ini}).",
                    "Se for o mesmo trabalho, mantenha só a com a data correta (uma mesma "
                    "atividade aceita várias linhas de pesquisa).", desc)
        else:
            seen[key] = ini

    # linhas de pesquisa que parecem nome de grupo
    pool = linhas + [l for l in atu if l.startswith("Linhas de pesquisa")]
    for line in pool:
        txt = re.sub(r"^(\d+\.\s*|Linhas de pesquisa:\s*)", "", line)
        if LAB_LIKE.search(txt):
            rep.add("ERRO", "Linhas de pesquisa",
                    "Uma linha de pesquisa parece ser o nome do grupo/laboratório.",
                    "Linha de pesquisa é um tema (ex.: «Jornalismo de dados»); "
                    "o grupo não é linha. Exclua a atividade/linha errada.", txt)
    if len({fold(l) for l in linhas}) < len(linhas):
        rep.add("ATENÇÃO", "Linhas de pesquisa", "Há linhas de pesquisa repetidas.")

    for line in atu:
        for m in ORDINAL_LOST.finditer(line):
            rep.add("INFO", "Atuação", f"Possível «º» perdido em «{m.group(0)}».",
                    "O Lattes às vezes remove «º»/«ª»; reescreva sem o símbolo.", line)


def check_projetos(sections, rep: Report):
    proj_keys = [k for k in sections if k.startswith("Projetos")]
    rep.facts["secoes_de_projeto"] = proj_keys
    if rep.facts.get("tem_vinculo_bolsista") and "Projetos de pesquisa" not in sections:
        rep.add("ATENÇÃO", "Projetos",
                "Há vínculo de bolsista, mas nenhum projeto de pesquisa aparece.",
                "Cadastre o projeto real do orientador em Projetos › Projeto de pesquisa "
                "(se foi salvo como Privado, ele não aparece).")
    for k in proj_keys:
        for line in sections[k]:
            if re.fullmatch(r"(\d{4} - (Atual|\d{4}) )?(inicia[çc][ãa]o cient[íi]fica|pibic|pibiti)\.?",
                            line, re.I):
                rep.add("ERRO", "Projetos", "Projeto com nome genérico de IC.",
                        "IC não é projeto: use o título real do projeto do orientador.", line)


PRODUCTION_SECTIONS = ("Produção", "Produções", "Produção bibliográfica", "Produção técnica",
                       "Produção artística/cultural", "Patentes e registros", "Eventos",
                       "Educação e Popularização de C & T", "Educação e Popularização de C&T")


def check_producoes(sections, names, rep: Report):
    items = []
    for sec in PRODUCTION_SECTIONS:
        for line in sections.get(sec, []):
            m = ITEM_NUMBER.match(line)
            if m and len(m.group(2)) > 15:
                items.append((sec, m.group(2)))
    rep.facts["itens_de_producao"] = len(items)

    folded_names = [fold(n) for n in names]
    if folded_names:
        for sec, text in items:
            ft = fold(text)
            if not any(n and n in ft for n in folded_names):
                rep.add("ATENÇÃO", sec,
                        "Seu nome em citação não aparece entre os autores deste item.",
                        "Inclua-se como autor/participante (o Lattes exige) ou acrescente essa "
                        "forma do seu nome em «Nome em citações bibliográficas».", text)

    # duplicatas por título parecido
    def title_of(t):
        parts = re.split(r"\.\s", t, maxsplit=1)
        return fold(parts[1] if len(parts) > 1 else t)[:120]

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a, b = title_of(items[i][1]), title_of(items[j][1])
            if len(a) > 20 and difflib.SequenceMatcher(None, a, b).ratio() > 0.9:
                rep.add("ATENÇÃO", "Produções", "Dois itens parecem ser o mesmo trabalho.",
                        "Se for duplicata, exclua um. Se for o mesmo trabalho em formas "
                        "diferentes (ex.: apresentação e publicação em anais), está certo.",
                        f"{items[i][1][:90]} | {items[j][1][:90]}")

    for sec, text in items:
        if "http://http" in text or "https://http" in text:
            rep.add("ERRO", sec, "Link com «http://» repetido.",
                    "O Lattes já acrescenta «http://»; apague o prefixo do campo.", text)
        for m in ORDINAL_LOST.finditer(text):
            rep.add("INFO", sec, f"Possível «º» perdido em «{m.group(0)}».", trecho=text)

    if "Eventos" not in sections:
        rep.add("INFO", "Eventos",
                "A seção Eventos não aparece neste arquivo.",
                "Na prévia gerada pelo editor, Eventos pode não aparecer mesmo quando há itens "
                "salvos e públicos. Confira no editor (Eventos › Participação/Organização) e, "
                "depois do envio, no currículo público.")


def run(path: Path) -> Report:
    lines, resumo = read_text(path)
    sections = split_sections(lines)
    rep = Report()
    rep.facts["secoes_encontradas"] = [k for k in sections if not k.startswith("_")]
    names = citation_names(sections)
    rep.facts["nomes_em_citacoes"] = names
    check_header(lines, rep)
    check_resumo(resumo, lines, sections, rep)
    check_formacao(sections, rep)
    check_atuacao(sections, rep)
    check_projetos(sections, rep)
    check_producoes(sections, names, rep)
    if not names:
        rep.add("ATENÇÃO", "Identificação",
                "Não encontrei «Nome em citações bibliográficas».",
                "Preencha em Dados gerais › Identificação; sem isso não dá para conferir autorias.")
    return rep


def to_markdown(rep: Report) -> str:
    order = {"ERRO": 0, "ATENÇÃO": 1, "INFO": 2}
    out = ["# Revisão automática do Lattes", ""]
    f = rep.facts
    out.append(f"- Tipo de arquivo: {f.get('tipo', 'página do currículo')}")
    for key, label in [("previa_gerada_em", "Prévia gerada em"),
                       ("ultima_atualizacao", "Última atualização informada"),
                       ("lattes_id", "ID Lattes")]:
        if f.get(key):
            out.append(f"- {label}: {f[key]}")
    out.append(f"- Nomes em citações: {'; '.join(f.get('nomes_em_citacoes') or []) or '—'}")
    out.append(f"- Seções encontradas: {', '.join(f.get('secoes_encontradas', []))}")
    out.append(f"- Resumo: {f.get('resumo_caracteres', 0)} caracteres")
    out.append(f"- Itens de produção numerados: {f.get('itens_de_producao', 0)}")
    out.append("")
    if not rep.items:
        out.append("Nenhum problema automático encontrado. Ainda vale uma leitura humana.")
        return "\n".join(out)
    out.append("## Pontos a conferir")
    out.append("")
    for it in sorted(rep.items, key=lambda x: order.get(x["nivel"], 9)):
        line = f"- **{it['nivel']} · {it['area']}:** {it['mensagem']}"
        if it["dica"]:
            line += f" {it['dica']}"
        if it["trecho"]:
            line += f"\n  - Trecho: `{it['trecho']}`"
        out.append(line)
    out.append("")
    out.append("_Checagem automática por heurísticas: confirme cada ponto antes de mudar o "
               "currículo._")
    return "\n".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Revisa a prévia de um Currículo Lattes.")
    ap.add_argument("arquivo", type=Path, help="HTML da prévia/página pública, ou .txt")
    ap.add_argument("--json", action="store_true", help="saída em JSON")
    args = ap.parse_args(argv)
    if not args.arquivo.exists():
        print(f"Arquivo não encontrado: {args.arquivo}", file=sys.stderr)
        return 2
    rep = run(args.arquivo)
    if args.json:
        print(json.dumps({"fatos": rep.facts, "pontos": rep.items}, ensure_ascii=False, indent=2))
    else:
        print(to_markdown(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())
