"""Testes do revisor de prévia. Rode com: python3 -m unittest discover tests"""

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from datetime import date
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


class TestBolsaEArtigos(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rep = revisar_previa.run(FIX / "previa_bolsa_artigos.html")
        cls.msgs = "\n".join(messages(cls.rep))

    def test_monitoria_como_outro(self):
        self.assertIn("Monitoria cadastrada como atividade de natureza", self.msgs)

    def test_vigencia_vencida_com_vinculo_atual(self):
        self.assertIn("termina em 31/07/2026", self.msgs)

    def test_aceito_com_dados_de_publicacao(self):
        self.assertIn("já traz dados de publicação", self.msgs)

    def test_mesmo_artigo_em_aceitos_e_completos(self):
        self.assertIn("em «aceitos» e em «completos»", self.msgs)

    def test_aceito_e_completo_nao_viram_duplicata_generica(self):
        self.assertNotIn("Dois itens parecem ser o mesmo trabalho", self.msgs)

    def test_submetido_como_aceito(self):
        self.assertIn("apenas submetido cadastrado como aceito", self.msgs)

    def test_preprint_como_artigo(self):
        self.assertIn("preprint cadastrado como artigo", self.msgs)

    def test_conta_itens_de_producao(self):
        self.assertEqual(self.rep.facts["itens_de_producao"], 5)


class TestDatas(unittest.TestCase):
    def test_datas_completas_e_mes_ano(self):
        achadas = revisar_previa.datas_no_texto(
            "Vigências: 01/03/2026 a 31/08/2026 e, após renovação, 09/2026 a 08/2027.")
        self.assertEqual(max(achadas), date(2027, 8, 31))
        self.assertIn(date(2026, 8, 31), achadas)

    def test_renovacao_cobre_a_data_de_referencia(self):
        # a vigência mais recente é posterior à prévia: não deve haver alerta
        achadas = revisar_previa.datas_no_texto("Vigências: 08/2025 a 07/2026 e 08/2026 a 07/2027")
        self.assertGreater(max(achadas), date(2026, 10, 10))


class TestEntradasInvalidas(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def roda(self, caminho):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            code = revisar_previa.main([str(caminho)])
        return code, err.getvalue()

    def test_arquivo_inexistente(self):
        code, err = self.roda(self.tmp / "nao_existe.html")
        self.assertEqual(code, 2)
        self.assertIn("não encontrado", err)

    def test_pasta(self):
        code, err = self.roda(self.tmp)
        self.assertEqual(code, 2)
        self.assertIn("é uma pasta", err)

    def test_arquivo_que_nao_e_lattes(self):
        f = self.tmp / "qualquer.html"
        f.write_text("<html><body>Lista de compras: pão, leite</body></html>", encoding="utf-8")
        code, err = self.roda(f)
        self.assertEqual(code, 3)
        self.assertIn("não parece ser a prévia", err)

    def test_arquivo_vazio(self):
        f = self.tmp / "vazio.html"
        f.write_bytes(b"")
        code, _ = self.roda(f)
        self.assertEqual(code, 3)

    def test_pdf_sem_texto_ou_sem_pdftotext(self):
        f = self.tmp / "previa.pdf"
        f.write_bytes(b"%PDF-1.4\n%fake\n")
        code, err = self.roda(f)
        self.assertEqual(code, 3)
        self.assertIn("PDF", err)

    def test_txt_minimo_com_duas_secoes_e_valido(self):
        f = self.tmp / "previa.txt"
        f.write_text("Formação acadêmica/titulação\n2023 Graduação em andamento em Direito.\n"
                     "Atuação profissional\nUniversidade X\n", encoding="utf-8")
        code, _ = self.roda(f)
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
