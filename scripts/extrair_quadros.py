#!/usr/bin/env python3
"""Extrai quadros (imagens) de uma gravação de tela para a IA poder "ver" o vídeo.

Muitos assistentes leem imagens, mas não vídeos. Quando a pessoa grava a tela do
Lattes rolando um formulário, este script tira um quadro a cada N segundos.

Uso:
    python3 extrair_quadros.py VIDEO.mp4 [--intervalo 1] [--largura 1600]
                                         [--max 20] [--saida PASTA]

Requer o ffmpeg instalado (macOS: `brew install ffmpeg`; Windows: winget install
ffmpeg; Linux: pelo gerenciador de pacotes). Sem ffmpeg, peça prints da tela.
Só usa a biblioteca padrão do Python 3.8+.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def duration_seconds(video: Path) -> float | None:
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(video)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return float(out)
    except (subprocess.CalledProcessError, ValueError):
        return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Extrai quadros de um vídeo de tela.")
    ap.add_argument("video", type=Path)
    ap.add_argument("--intervalo", type=float, default=1.0,
                    help="segundos entre quadros (padrão: 1)")
    ap.add_argument("--largura", type=int, default=1600,
                    help="largura das imagens em pixels (padrão: 1600)")
    ap.add_argument("--max", type=int, default=20,
                    help="número máximo de quadros (padrão: 20)")
    ap.add_argument("--saida", type=Path, default=None,
                    help="pasta de saída (padrão: uma pasta temporária nova)")
    args = ap.parse_args(argv)

    if not args.video.exists():
        print(f"Vídeo não encontrado: {args.video}", file=sys.stderr)
        return 2
    if not shutil.which("ffmpeg"):
        print("O ffmpeg não está instalado. Instale-o ou peça prints da tela.",
              file=sys.stderr)
        return 3

    out_dir = args.saida or Path(tempfile.mkdtemp(prefix="quadros_lattes_"))
    out_dir.mkdir(parents=True, exist_ok=True)

    intervalo = max(args.intervalo, 0.1)
    dur = duration_seconds(args.video)
    if dur and dur / intervalo > args.max:
        intervalo = dur / args.max  # espaça os quadros para caber no máximo

    cmd = [
        "ffmpeg", "-v", "error", "-i", str(args.video),
        "-vf", f"fps=1/{intervalo:.3f},scale={args.largura}:-1",
        "-frames:v", str(args.max),
        str(out_dir / "quadro_%03d.png"),
    ]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as exc:
        print(f"O ffmpeg falhou: {exc}", file=sys.stderr)
        return 4

    frames = sorted(out_dir.glob("quadro_*.png"))
    if dur:
        print(f"Duração do vídeo: {dur:.1f} s; um quadro a cada {intervalo:.1f} s.")
    print(f"{len(frames)} quadros em: {out_dir}")
    for f in frames:
        print(f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
