"""Testes do revisor de prévia. Rode com: python3 -m unittest discover tests"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import revisar_previa  # noqa: E402

FIX = ROOT / "tests" / "fixtures"


def messages(rep):
    return [f"{i['nivel']}|{i['area']}|{i['mensagem']}" for i in rep.items]


class TestPreviaComErros(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rep = revisar_previa.run(FIX / "previa_com_erros.html")
        cls.msgs = "\n".join(messages(cls.rep))

    def test_le_nomes_em_citacoes(self):
        self.assertIn("SILVA, M. E.", self.rep.facts["nomes_em_citacoes"])

    def test_ignora_menu_de_navegacao(self):
        self.assertNotIn("Orientações", self.rep.facts["secoes_encontradas"])

    def test_extensao_misturada_com_pibic(self):
        self.assertIn("mistura bolsa de extensão", self.msgs)

    def test_frases_repetidas(self):
        self.assertIn("quase a mesma coisa", self.msgs)

    def test_erro_de_digitacao(self):
        self.assertIn("aquirida", self.msgs)

    def test_ordinal_perdido(self):
        self.assertIn("2 lugar", self.msgs)

    def test_ic_em_formacao_complementar(self):
        self.assertIn("Formação complementar", self.msgs)

    def test_graduacao_sem_situacao(self):
        self.assertIn("Graduação com só um ano", self.msgs)

    def test_instituicao_laboratorio(self):
        self.assertIn("instituição parece ser laboratório", self.msgs)

    def test_linha_com_nome_de_grupo(self):
        self.assertIn("linha de pesquisa parece ser o nome do grupo", self.msgs)

    def test_atividades_duplicadas(self):
        self.assertIn("Duas atividades iguais", self.msgs)

    def test_bolsista_sem_projeto(self):
        self.assertIn("nenhum projeto de pesquisa", self.msgs)

    def test_autor_ausente(self):
        self.assertIn("não aparece entre os autores", self.msgs)

    def test_itens_duplicados(self):
        self.assertIn("mesmo trabalho", self.msgs)

    def test_http_repetido(self):
        self.assertIn("http://» repetido", self.msgs)


class TestPreviaCorreta(unittest.TestCase):
    def test_sem_alertas(self):
        rep = revisar_previa.run(FIX / "previa_correta.html")
        self.assertEqual(rep.items, [], messages(rep))


if __name__ == "__main__":
    unittest.main()
