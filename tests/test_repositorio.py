"""Verificações do repositório (limites e consistência). Rode com: python3 -m unittest discover tests"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "lattes-maxx" / "SKILL.md"


class TestSkill(unittest.TestCase):
    def setUp(self):
        self.text = SKILL.read_text(encoding="utf-8")

    def test_menos_de_500_linhas(self):
        self.assertLess(self.text.count("\n"), 500)

    def test_descricao_cabe_no_limite(self):
        desc = re.search(r"^description:\s*(.+)$", self.text, re.M).group(1)
        self.assertLessEqual(len(desc), 1024)

    def test_versao_igual_ao_changelog(self):
        versao = re.search(r'^\s+version:\s*"([^"]+)"', self.text, re.M).group(1)
        topo = re.search(r"^## (\d+\.\d+\.\d+)", (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"), re.M)
        self.assertEqual(versao, topo.group(1))

    def test_referencias_citadas_existem(self):
        citadas = set(re.findall(r"`([a-z0-9-]+\.md)`", self.text))
        citadas |= set(re.findall(r"references/([a-z0-9-]+\.md)", self.text))
        for nome in citadas:
            if nome in {"SKILL.md", "README.md"}:
                continue
            self.assertTrue((ROOT / "references" / nome).exists()
                            or (ROOT / "assets" / nome).exists(), nome)


class TestFallback(unittest.TestCase):
    def test_instrucoes_menos_de_8000_caracteres(self):
        texto = (ROOT / "fallback" / "INSTRUCOES.md").read_text(encoding="utf-8")
        self.assertLess(len(texto), 8000)

    def test_prompt_curto_menos_de_1500_caracteres(self):
        texto = (ROOT / "fallback" / "PROMPT-CURTO.md").read_text(encoding="utf-8")
        self.assertLess(len(texto), 1500)


if __name__ == "__main__":
    unittest.main()
