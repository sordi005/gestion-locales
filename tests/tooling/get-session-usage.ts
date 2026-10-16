import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Busca llamadas a `getSession()` en el código. Esa función lee la sesión de la
 * cookie SIN verificarla: en el servidor se usa `getClaims()` o `getUser()`
 * (regla dura 6). Funciones puras sobre texto, más un recorrido de carpeta.
 *
 * Es aproximado a propósito: no distingue comentarios ni cadenas (un comentario
 * que escriba la llamada completa también dispara, y está bien: se reescribe) y
 * no ve accesos por texto (`auth["getSession"]()`).
 */

// `\b` evita `mygetSession(`; el nombre completo evita `getSessionToken(`.
// `\s*` cubre `getSession (` y el paréntesis en la línea siguiente.
const GET_SESSION_CALL = /\bgetSession\s*\(/g;

export type GetSessionUsage = {
  /** Ruta del archivo, tal como se la pasó al buscador. */
  file: string;
  /** Línea (desde 1) donde empieza el nombre `getSession`. */
  line: number;
  /** Texto de esa línea, sin sangría. */
  snippet: string;
};

export function findGetSessionUsages(
  source: string,
  file: string,
): GetSessionUsage[] {
  const lines = source.split("\n");
  const usages: GetSessionUsage[] = [];

  for (const match of source.matchAll(GET_SESSION_CALL)) {
    const line = source.slice(0, match.index).split("\n").length;
    usages.push({ file, line, snippet: (lines[line - 1] ?? "").trim() });
  }

  return usages;
}

/** `archivo:línea  texto`, para que el mensaje del test diga dónde está. */
export function describeUsage(usage: GetSessionUsage): string {
  return `${usage.file}:${usage.line}  ${usage.snippet}`;
}

/** Recorre `root` y revisa los `.ts` y `.tsx`; devuelve rutas relativas con `/`. */
export function findGetSessionUsagesInDir(root: string): GetSessionUsage[] {
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => name.replaceAll("\\", "/"))
    .filter((name) => statSync(join(root, name)).isFile())
    .sort();

  return files.flatMap((name) =>
    findGetSessionUsages(readFileSync(join(root, name), "utf8"), name),
  );
}
