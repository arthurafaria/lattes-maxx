// Utilitários dos testes.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Saida } from "../scripts/comum.ts";

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FIX = join(RAIZ, "tests", "fixtures");

/** Saída que guarda o que o script imprimiu. */
export function capturar(): Saida & { out_: string[]; err_: string[] } {
  const out_: string[] = [];
  const err_: string[] = [];
  return {
    out_,
    err_,
    out: (t) => {
      out_.push(t);
    },
    err: (t) => {
      err_.push(t);
    },
  };
}
