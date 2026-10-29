import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as catalog from "../index";

// `@/features/catalog` es la entrada PÚBLICA y PURA: la pueden importar páginas,
// componentes cliente y otras features. Nada de I/O (eso va en `./queries`,
// `./mutations` y `./actions`).
describe("@/features/catalog (entrada pública)", () => {
  it("exporta solo las funciones y constantes puras del dominio", () => {
    expect(Object.keys(catalog).sort()).toEqual([
      "BARCODE_REJECTIONS",
      "CATALOG_ACTIONS",
      "CATALOG_ERROR_CODES",
      "CATALOG_ERROR_MESSAGES",
      "CATALOG_PAGE_SIZE",
      "PRICE_CHANGE_COLUMNS",
      "PRICE_HISTORY_LIMIT",
      "PRICE_SOURCE_LABELS",
      "PRODUCT_COLUMNS_ADMIN",
      "PRODUCT_COLUMNS_BASIC",
      "WARNINGS_PARAM",
      "addBarcodeSchema",
      "authorizeCatalogAction",
      "barcodeRejectionMessage",
      "barcodeSearchKey",
      "barcodeTakenMessage",
      "barcodeWarningMessage",
      "belowCost",
      "buildCatalogSearch",
      "buildMinStocksInsert",
      "buildProductInsert",
      "buildProductUpdate",
      "catalogError",
      "centsSchema",
      "changeSalePriceSchema",
      "correctBarcodeSchema",
      "costBasisLabel",
      "createCategorySchema",
      "createProductSchema",
      "dbErrorLogFields",
      "deactivateProductSchema",
      "diffMinStocks",
      "escapeLike",
      "historyActorLabel",
      "invalidBarcodeError",
      "isCatalogErrorCode",
      "likePattern",
      "mapCatalogDbError",
      "parseCatalogInput",
      "parseCatalogSearchParams",
      "parseWarningsParam",
      "priceChangedMessage",
      "priceSourceLabel",
      "quantityMilliSchema",
      "reactivateProductSchema",
      "renameCategorySchema",
      "resolveProductCost",
      "toPriceHistoryEntry",
      "toProductView",
      "updateProductSchema",
      "uuidSchema",
      "warningMessage",
      "warningsToSearch",
    ]);
  });

  it("ningún archivo del dominio ni el barril importa server-only, Next, React ni Supabase", () => {
    const dir = join(__dirname, "..");
    const files = [
      join(dir, "index.ts"),
      ...readdirSync(join(dir, "domain"))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => join(dir, "domain", name)),
    ];
    const forbidden =
      /from\s+["'](server-only|next[/"']|react|@supabase\/|@\/shared\/db\/(server|client|admin))/;

    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(forbidden);
    }
  });

  it("el dominio no lee el reloj ni el azar (pureza)", () => {
    const dir = join(__dirname, "..", "domain");
    const impure =
      /\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(\s*\)|\bMath\s*\.\s*random\s*\(/;

    for (const name of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const source = readFileSync(join(dir, name), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      expect(source, name).not.toMatch(impure);
    }
  });
});
