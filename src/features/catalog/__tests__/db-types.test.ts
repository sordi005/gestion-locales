import { describe, expectTypeOf, it } from "vitest";

import type { Database } from "@/shared/db/types";

import type {
  PriceHistoryEntry,
  ProductAdminRow,
  ProductBasicRow,
} from "../index";
import { toPriceHistoryEntry } from "../index";

type Tables = Database["public"]["Tables"];

// El dominio no puede importar `shared/db` (regla de capas), así que define a
// mano la forma de las filas que lee. Estos tests de TIPOS (los chequea `tsc`)
// avisan si una migración nueva cambia una columna y la fila del dominio queda
// desfasada.
describe("filas del dominio vs tipos generados de la base", () => {
  it("la fila de products de la base calza con ProductAdminRow y ProductBasicRow", () => {
    expectTypeOf<Tables["products"]["Row"]>().toExtend<ProductAdminRow>();
    expectTypeOf<Tables["products"]["Row"]>().toExtend<ProductBasicRow>();
  });

  it("la fila de price_changes de la base calza con lo que lee el historial", () => {
    type HistoryRow = Parameters<typeof toPriceHistoryEntry>[0];

    expectTypeOf<Tables["price_changes"]["Row"]>().toExtend<HistoryRow>();
    expectTypeOf(
      toPriceHistoryEntry,
    ).returns.toEqualTypeOf<PriceHistoryEntry>();
  });
});
