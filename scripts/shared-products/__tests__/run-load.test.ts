import { describe, expect, it, vi } from "vitest";

import {
  checkLicenseGate,
  isLocalSupabaseUrl,
  parseArgs,
  runLoad,
} from "../run-load";
import type { LoadDeps } from "../run-load";
import type { ParsedProduct } from "../types";

const LOCAL = "http://127.0.0.1:54321";
const REMOTE = "https://abcdefgh.supabase.co";
const KEY = "test-secret-key";

const PRODUCTS: ParsedProduct[] = [
  {
    barcode: "7791234567898",
    name: "Alfajor",
    brand: "M",
    presentation: "50 g",
  },
  {
    barcode: "7791234567899",
    name: "Mal dígito",
    brand: null,
    presentation: null,
  },
];

function makeDeps(overrides: Partial<LoadDeps> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  const parseFile = vi.fn<LoadDeps["parseFile"]>(() =>
    Promise.resolve({ products: PRODUCTS, notes: [] }),
  );
  const loadBatch = vi.fn<LoadDeps["loadBatch"]>(() =>
    Promise.resolve({
      inserted: 1,
      updated: 0,
      skipped_ineligible: 0,
      skipped_protected: 0,
    }),
  );
  const deps: LoadDeps = {
    parseFile,
    loadBatch,
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    ...overrides,
  };
  return { deps, parseFile, loadBatch, logs, errors };
}

const env = (
  url: string | undefined = LOCAL,
  key: string | undefined = KEY,
) => ({
  NEXT_PUBLIC_SUPABASE_URL: url,
  SUPABASE_SECRET_KEY: key,
});

describe("isLocalSupabaseUrl", () => {
  it.each([
    ["http://127.0.0.1:54321", true],
    ["http://localhost:54321", true],
    ["http://[::1]:54321", true],
    ["https://abcdefgh.supabase.co", false],
    ["https://localhost.evil.example", false],
    ["http://127.0.0.1.evil.example", false],
    ["no es una url", false],
    ["", false],
  ])("%s -> %s", (url, expected) => {
    expect(isLocalSupabaseUrl(url)).toBe(expected);
  });
});

describe("checkLicenseGate", () => {
  it("sepa contra un proyecto no local sin --license-confirmed: cerrada", () => {
    const gate = checkLicenseGate({
      source: "sepa",
      supabaseUrl: REMOTE,
      licenseConfirmed: false,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toContain("--license-confirmed");
  });

  it.each([
    ["sepa", REMOTE, true],
    ["off", REMOTE, true],
    ["sepa", LOCAL, false],
    ["off", LOCAL, false],
  ] as const)(
    "%s en %s con confirmación=%s: abierta",
    (source, url, confirmed) => {
      expect(
        checkLicenseGate({
          source,
          supabaseUrl: url,
          licenseConfirmed: confirmed,
        }).ok,
      ).toBe(true);
    },
  );
});

describe("checkLicenseGate: Open Food Facts", () => {
  it("off contra un proyecto no local sin --license-confirmed: cerrada, y el mensaje nombra la fuente y su licencia", () => {
    const gate = checkLicenseGate({
      source: "off",
      supabaseUrl: REMOTE,
      licenseConfirmed: false,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.message).toContain("--license-confirmed");
      expect(gate.message).toContain("Open Food Facts");
      expect(gate.message).toContain("ODbL");
    }
  });

  it("el mensaje de sepa nombra el SEPA / Precios Claros", () => {
    const gate = checkLicenseGate({
      source: "sepa",
      supabaseUrl: REMOTE,
      licenseConfirmed: false,
    });
    expect(!gate.ok && gate.message).toContain("SEPA / Precios Claros");
  });

  it("off contra la base local no pide la bandera", () => {
    expect(
      checkLicenseGate({
        source: "off",
        supabaseUrl: LOCAL,
        licenseConfirmed: false,
      }).ok,
    ).toBe(true);
  });
});

describe("parseArgs", () => {
  it("lee fuente, archivo, versión y banderas", () => {
    const parsed = parseArgs([
      "--source",
      "sepa",
      "--file",
      "data/shared-products/productos.csv",
      "--source-ref",
      "sepa-2026-11-04",
      "--license-confirmed",
      "--dry-run",
    ]);
    expect(parsed).toEqual({
      ok: true,
      value: {
        source: "sepa",
        file: "data/shared-products/productos.csv",
        sourceRef: "sepa-2026-11-04",
        licenseConfirmed: true,
        dryRun: true,
      },
    });
  });

  it("sin banderas opcionales", () => {
    const parsed = parseArgs(["--source", "off", "--file", "x.csv.gz"]);
    expect(parsed).toEqual({
      ok: true,
      value: {
        source: "off",
        file: "x.csv.gz",
        sourceRef: null,
        licenseConfirmed: false,
        dryRun: false,
      },
    });
  });

  it.each([
    [[], "falta --source"],
    [["--source", "sepa"], "falta --file"],
    [["--source", "otra", "--file", "x"], "fuente inválida"],
    [["--source", "off", "--file", "x", "--cosa"], "argumento desconocido"],
    [["--source", "off", "--file"], "--file sin valor"],
  ])("%j da error (%s)", (argv) => {
    expect(parseArgs(argv).ok).toBe(false);
  });
});

describe("runLoad", () => {
  const SEPA_ARGS = ["--source", "sepa", "--file", "f.csv"];

  it("la compuerta cerrada termina con error y NO lee el archivo ni carga nada", async () => {
    const { deps, parseFile, loadBatch, errors } = makeDeps();
    const code = await runLoad(SEPA_ARGS, env(REMOTE), deps);
    expect(code).toBe(1);
    expect(parseFile).not.toHaveBeenCalled();
    expect(loadBatch).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("--license-confirmed");
  });

  it("con --license-confirmed carga contra un proyecto no local", async () => {
    const { deps, loadBatch } = makeDeps();
    const code = await runLoad(
      [...SEPA_ARGS, "--license-confirmed"],
      env(REMOTE),
      deps,
    );
    expect(code).toBe(0);
    expect(loadBatch).toHaveBeenCalledTimes(1);
  });

  it("carga las filas aceptadas con la fuente y la versión, y suma los conteos de la base", async () => {
    const { deps, loadBatch, logs } = makeDeps();
    const code = await runLoad(
      [...SEPA_ARGS, "--source-ref", "c64-test"],
      env(),
      deps,
    );
    expect(code).toBe(0);
    expect(loadBatch).toHaveBeenCalledExactlyOnceWith(
      [
        {
          barcode_norm: "7791234567898",
          name: "Alfajor",
          brand: "M",
          presentation: "50 g",
        },
      ],
      "sepa",
      "c64-test",
    );
    const text = logs.join("\n");
    expect(text).toContain("Leídos: 2");
    expect(text).toContain("invalid_check_digit: 1");
    expect(text).toContain("inserted: 1");
  });

  it("suma los conteos de varios lotes", async () => {
    const many: ParsedProduct[] = Array.from({ length: 1500 }, (_, i) => {
      const body = `779${String(i).padStart(9, "0")}`;
      let sum = 0;
      for (let k = 0; k < body.length; k++) {
        sum += Number(body[body.length - 1 - k]) * (k % 2 === 0 ? 3 : 1);
      }
      return {
        barcode: `${body}${(10 - (sum % 10)) % 10}`,
        name: `P ${i}`,
        brand: null,
        presentation: null,
      };
    });
    const { deps, loadBatch, logs } = makeDeps({
      parseFile: () => Promise.resolve({ products: many, notes: [] }),
    });
    await runLoad(SEPA_ARGS, env(), deps);
    expect(loadBatch).toHaveBeenCalledTimes(2);
    expect(logs.join("\n")).toContain("inserted: 2");
  });

  it("--dry-run muestra el reporte y no carga", async () => {
    const { deps, loadBatch, logs } = makeDeps();
    const code = await runLoad([...SEPA_ARGS, "--dry-run"], env(), deps);
    expect(code).toBe(0);
    expect(loadBatch).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Aceptados para cargar: 1");
  });

  it("falta la URL o la secret key: error sin cargar y sin imprimir la clave", async () => {
    for (const bad of [
      { SUPABASE_SECRET_KEY: KEY },
      { NEXT_PUBLIC_SUPABASE_URL: LOCAL },
      env(LOCAL, ""),
    ]) {
      const { deps, loadBatch, errors, logs } = makeDeps();
      expect(await runLoad(SEPA_ARGS, bad, deps)).toBe(1);
      expect(loadBatch).not.toHaveBeenCalled();
      expect([...errors, ...logs].join("\n")).not.toContain(KEY);
    }
  });

  it("argumentos inválidos: error y uso", async () => {
    const { deps, loadBatch, errors } = makeDeps();
    expect(await runLoad([], env(), deps)).toBe(1);
    expect(loadBatch).not.toHaveBeenCalled();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("un archivo con formato inesperado termina con error y sin cargar", async () => {
    const { deps, loadBatch, errors } = makeDeps({
      parseFile: () =>
        Promise.reject(new Error("le faltan las columnas: productos_marca")),
    });
    expect(await runLoad(SEPA_ARGS, env(), deps)).toBe(1);
    expect(loadBatch).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("productos_marca");
  });

  it("si la carga falla a mitad de camino, avisa cuántos lotes entraron y termina con error", async () => {
    const many: ParsedProduct[] = Array.from({ length: 1001 }, (_, i) => {
      const body = `779${String(i).padStart(9, "0")}`;
      let sum = 0;
      for (let k = 0; k < body.length; k++) {
        sum += Number(body[body.length - 1 - k]) * (k % 2 === 0 ? 3 : 1);
      }
      return {
        barcode: `${body}${(10 - (sum % 10)) % 10}`,
        name: `P ${i}`,
        brand: null,
        presentation: null,
      };
    });
    const loadBatch = vi
      .fn<LoadDeps["loadBatch"]>()
      .mockResolvedValueOnce({
        inserted: 1000,
        updated: 0,
        skipped_ineligible: 0,
        skipped_protected: 0,
      })
      .mockRejectedValueOnce(new Error("boom"));
    const { deps, errors } = makeDeps({
      parseFile: () => Promise.resolve({ products: many, notes: [] }),
      loadBatch,
    });
    expect(await runLoad(SEPA_ARGS, env(), deps)).toBe(1);
    expect(errors.join("\n")).toMatch(/lote 2/);
    expect(errors.join("\n")).toMatch(/1 lote/);
  });
});
