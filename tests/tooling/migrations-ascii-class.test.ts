import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Spec tenancy-model (normalización de textos): la lista de caracteres invisibles y de
// espacios de `private.normalize_text` se escribe SOLO con escapes ASCII (\uXXXX). Un
// caracter invisible pegado literal en una migración es un bug esperando a pasar: no se
// ve en la revisión, un editor o un formateador lo puede cambiar, y copiarlo a otro lado
// lo pierde. Las letras con acento y la puntuación visible de los comentarios y mensajes
// en español sí están permitidas.

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

// Rellenos invisibles que Unicode NO clasifica como formato (Cf) ni como espacio.
const FILLERS = [
  0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x2800, 0x3164, 0xffa0,
];

const INVISIBLE = new RegExp(
  "[\\p{Cf}\\p{Cc}\\p{Zs}\\p{Zl}\\p{Zp}" +
    FILLERS.map((cp) => String.fromCodePoint(cp)).join("") +
    "]",
  "gu",
);

/**
 * Caracteres invisibles, de formato, de control o espacios Unicode (salvo el espacio
 * común, el salto de línea, el retorno de carro y el tab) que hay literales en el SQL,
 * como "U+XXXX" en el orden en que aparecen.
 */
function findInvisibleLiterals(sql: string): string[] {
  const allowed = new Set([0x20, 0x0a, 0x0d, 0x09]);
  return [...sql.matchAll(INVISIBLE)]
    .map((m) => m[0].codePointAt(0) ?? 0)
    .filter((cp) => !allowed.has(cp))
    .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
}

/** Lee todas las migraciones (.sql) del repo, por nombre de archivo. */
function readMigrations(): Record<string, string> {
  return Object.fromEntries(
    readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => [name, readFileSync(new URL(name, MIGRATIONS), "utf8")]),
  );
}

describe("findInvisibleLiterals", () => {
  const ch = (cp: number) => String.fromCodePoint(cp);

  it("detecta el guion blando, el ancho cero y la inversión de texto", () => {
    const sql = `select 'a${ch(0xad)}b${ch(0x200b)}c${ch(0x202e)}d';`;
    expect(findInvisibleLiterals(sql)).toEqual(["U+00AD", "U+200B", "U+202E"]);
  });

  it("detecta espacios Unicode, rellenos y caracteres de etiqueta", () => {
    const sql = [0xa0, 0x3000, 0x3164, 0xffa0, 0x2800, 0xe0001, 0x0085]
      .map(ch)
      .join("x");
    expect(findInvisibleLiterals(sql)).toEqual([
      "U+00A0",
      "U+3000",
      "U+3164",
      "U+FFA0",
      "U+2800",
      "U+E0001",
      "U+0085",
    ]);
  });

  it("acepta ASCII, el espacio, los saltos de línea, el tab y las letras con acento", () => {
    const sql =
      "-- Organización: dirección y señal\n\tselect 'ñandú' as x;\r\n";
    expect(findInvisibleLiterals(sql)).toEqual([]);
  });

  it("no confunde un escape ASCII con el caracter", () => {
    const backslash = String.fromCharCode(92);
    expect(findInvisibleLiterals(`'[${backslash}u00ad]'`)).toEqual([]);
  });
});

describe("supabase/migrations", () => {
  it("no tiene caracteres invisibles, de formato ni espacios Unicode literales", () => {
    const found: Record<string, string[]> = {};
    for (const [name, sql] of Object.entries(readMigrations())) {
      const hits = findInvisibleLiterals(sql);
      if (hits.length > 0) found[name] = hits;
    }
    expect(found).toEqual({});
  });
});
