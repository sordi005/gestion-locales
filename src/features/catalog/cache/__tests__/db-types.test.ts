import { describe, expectTypeOf, it } from "vitest";

import type { Database } from "@/shared/db/types";

import type {
  CacheBarcodeRow,
  CacheCategoryRow,
  CacheProductRow,
} from "../domain/cached-entities";

type Tables = Database["public"]["Tables"];

// El dominio no puede importar `shared/db` (regla de capas), así que define a
// mano la forma de las filas que lee el delta. Estos tests de TIPOS (los chequea
// `tsc`) avisan si una migración nueva cambia una columna y la fila de la caché
// queda desfasada (mismo patrón que `catalog/__tests__/db-types.test.ts`).
describe("filas de la caché vs tipos generados de la base", () => {
  it("la fila de products de la base calza con CacheProductRow", () => {
    expectTypeOf<Tables["products"]["Row"]>().toExtend<CacheProductRow>();
  });

  it("la fila de product_barcodes de la base calza con CacheBarcodeRow", () => {
    expectTypeOf<
      Tables["product_barcodes"]["Row"]
    >().toExtend<CacheBarcodeRow>();
  });

  it("la fila de categories de la base calza con CacheCategoryRow", () => {
    expectTypeOf<Tables["categories"]["Row"]>().toExtend<CacheCategoryRow>();
  });
});
