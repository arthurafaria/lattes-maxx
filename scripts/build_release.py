#!/usr/bin/env python3
"""Gera os pacotes de distribuição da skill.

Cria em dist/:
  - lattes-maxx.zip           só a skill (pasta lattes-maxx/ com o SKILL.md na raiz do zip),
                              para Claude.ai, ChatGPT, Gemini e para mandar a amigos
  - lattes-maxx-completo.md   SKILL.md + todas as referências num arquivo só (para IAs
                              sem skills ou sem acesso à internet)

Uso: python3 scripts/build_release.py
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "lattes-maxx"
DIST = ROOT / "dist"
SKIP = {".DS_Store", "__pycache__"}


def check_frontmatter() -> None:
    text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        sys.exit("SKILL.md sem frontmatter YAML")
    fm = m.group(1)
    name = re.search(r"^name:\s*(\S+)", fm, re.M)
    desc = re.search(r"^description:\s*(.+)$", fm, re.M)
    if not name or name.group(1) != SKILL.name:
        sys.exit("O campo name precisa ser igual ao nome da pasta")
    if not desc or len(desc.group(1)) > 1024:
        sys.exit("description ausente ou com mais de 1024 caracteres")
    allowed = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
    keys = set(re.findall(r"^([a-z][a-z-]*):", fm, re.M))
    extra = keys - allowed
    if extra:
        sys.exit(f"Campos fora do padrão no frontmatter: {sorted(extra)}")
    lines = text.count("\n")
    if lines > 500:
        sys.exit(f"SKILL.md tem {lines} linhas (recomendado: até 500)")


def build_zip() -> Path:
    DIST.mkdir(exist_ok=True)
    out = DIST / "lattes-maxx.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(SKILL.rglob("*")):
            if path.is_dir() or any(p in SKIP for p in path.parts) or path.suffix == ".pyc":
                continue
            z.write(path, Path("lattes-maxx") / path.relative_to(SKILL))
    return out


def build_single_markdown() -> Path:
    parts = [(SKILL / "SKILL.md").read_text(encoding="utf-8")]
    for folder in ("references", "assets"):
        for path in sorted((ROOT / folder).glob("*.md")):
            parts.append(f"\n\n---\n\n<!-- arquivo: {folder}/{path.name} -->\n\n")
            parts.append(path.read_text(encoding="utf-8"))
    out = DIST / "lattes-maxx-completo.md"
    out.write_text("".join(parts), encoding="utf-8")
    return out


def main() -> int:
    check_frontmatter()
    z = build_zip()
    md = build_single_markdown()
    print(f"OK: {z.relative_to(ROOT)} ({z.stat().st_size // 1024} KB)")
    print(f"OK: {md.relative_to(ROOT)} ({md.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
