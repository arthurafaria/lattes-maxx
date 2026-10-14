#!/usr/bin/env node
// Extrai quadros (imagens) de uma gravação de tela para a IA poder "ver" o vídeo.
//
// Muitos assistentes leem imagens, mas não vídeos. Quando a pessoa grava a tela do
// Lattes rolando um formulário, este script tira um quadro a cada N segundos.
//
// Uso:
//     node extrair_quadros.ts VIDEO.mp4 [--intervalo 1] [--largura 1600]
//                                       [--max 20] [--saida PASTA]
//
// Requer o ffmpeg instalado (macOS: `brew install ffmpeg`; Windows: winget install
// ffmpeg; Linux: pelo gerenciador de pacotes). Sem ffmpeg, peça prints da tela.
// Precisa de Node.js 22.18 ou mais novo; só biblioteca padrão.

import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { acharPrograma, saidaPadrao } from "./comum.ts";
import type { Saida } from "./comum.ts";

function duracaoEmSegundos(video: string): number | null {
  const ffprobe = acharPrograma("ffprobe");
  if (!ffprobe) return null;
  const r = spawnSync(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", video],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  const n = Number.parseFloat(r.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

const AJUDA = "uso: node extrair_quadros.ts VIDEO [--intervalo S] [--largura PX] [--max N] [--saida PASTA]\n\n" +
  "Extrai quadros de um vídeo de tela (precisa do ffmpeg).\n" +
  "  --intervalo S  segundos entre quadros (padrão: 1)\n" +
  "  --largura PX   largura das imagens em pixels (padrão: 1600)\n" +
  "  --max N        número máximo de quadros (padrão: 20)\n" +
  "  --saida PASTA  pasta de saída (padrão: uma pasta temporária nova)";

export function main(argv: string[], saida: Saida = saidaPadrao): number {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        intervalo: { type: "string", default: "1" },
        largura: { type: "string", default: "1600" },
        max: { type: "string", default: "20" },
        saida: { type: "string" },
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
  const [video] = args.positionals;
  const largura = Number.parseInt(args.values.largura as string, 10);
  const maximo = Number.parseInt(args.values.max as string, 10);
  const intervaloPedido = Number.parseFloat(args.values.intervalo as string);
  if (!video || args.positionals.length > 1 || !Number.isFinite(largura) || !Number.isFinite(maximo) ||
      !Number.isFinite(intervaloPedido)) {
    saida.err(`${AJUDA}\n\nerro: argumentos inválidos.`);
    return 2;
  }
  if (!existsSync(video)) {
    saida.err(`Vídeo não encontrado: ${video}`);
    return 2;
  }
  const ffmpeg = acharPrograma("ffmpeg");
  if (!ffmpeg) {
    saida.err("O ffmpeg não está instalado. Instale-o ou peça prints da tela.");
    return 3;
  }

  const pasta = args.values.saida ?? mkdtempSync(join(tmpdir(), "quadros_lattes_"));
  mkdirSync(pasta, { recursive: true });

  let intervalo = Math.max(intervaloPedido, 0.1);
  const dur = duracaoEmSegundos(video);
  if (dur && dur / intervalo > maximo) intervalo = dur / maximo; // espaça os quadros para caber no máximo

  const r = spawnSync(
    ffmpeg,
    ["-v", "error", "-i", video, "-vf", `fps=1/${intervalo.toFixed(3)},scale=${largura}:-1`,
      "-frames:v", String(maximo), join(pasta, "quadro_%03d.png")],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (r.status !== 0) {
    saida.err(`O ffmpeg falhou (código ${r.status ?? "?"}).`);
    return 4;
  }

  const quadros = readdirSync(pasta).filter((f) => /^quadro_.*\.png$/.test(f)).sort();
  if (dur) saida.out(`Duração do vídeo: ${dur.toFixed(1)} s; um quadro a cada ${intervalo.toFixed(1)} s.`);
  saida.out(`${quadros.length} quadros em: ${pasta}`);
  for (const q of quadros) saida.out(join(pasta, q));
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
