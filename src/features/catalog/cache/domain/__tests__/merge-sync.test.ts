import { describe, expect, it } from "vitest";

import {
  ORGANIZATION_ID,
  USER_ID,
  makeBarcode,
  makeCategory,
  makeProduct,
} from "../../__tests__/fixtures";
import { CACHE_FORMAT_VERSION } from "../../datasets";
import type { CatalogPayload } from "../../datasets";
import { buildMeta, hasChanges, mergeSyncResult } from "../merge-sync";
import type { CatalogData } from "../merge-sync";
import { decideSyncMode } from "../sync-policy";
import type { CacheMeta } from "../sync-policy";

const NOW = Date.parse("2026-11-02T15:00:00Z");
const scope = { userId: USER_ID, organizationId: ORGANIZATION_ID };

const response = (overrides: Partial<CatalogPayload> = {}): CatalogPayload => ({
  version: CACHE_FORMAT_VERSION,
  mode: "delta",
  organizationId: ORGANIZATION_ID,
  cursor: "2026-11-02T14:59:00+00:00",
  products: [],
  barcodes: [],
  categories: [],
  ...overrides,
});

const emptyData: CatalogData = { products: [], barcodes: [], categories: [] };

describe("mergeSyncResult", () => {
  const p1 = makeProduct(1, { name: "Alfajor" });
  const p2 = makeProduct(2, { name: "Gaseosa" });
  const b1 = makeBarcode(1, p1.id, "7790001000019");
  const c1 = makeCategory(1, { name: "Golosinas" });
  const current: CatalogData = {
    products: [p1, p2],
    barcodes: [b1],
    categories: [c1],
  };

  describe("sincronización completa", () => {
    it("reemplaza todo el contenido: lo que no vino ya no está", () => {
      const p3 = makeProduct(3, { name: "Turrón" });
      const c2 = makeCategory(2, { name: "Bebidas" });

      const merged = mergeSyncResult(
        current,
        response({ mode: "full", products: [p3], categories: [c2] }),
      );

      expect(merged).toEqual({
        products: [p3],
        barcodes: [],
        categories: [c2],
      });
    });

    it("sobre una caché vacía deja exactamente lo recibido", () => {
      const merged = mergeSyncResult(
        emptyData,
        response({ mode: "full", products: [p1, p2], barcodes: [b1] }),
      );

      expect(merged.products).toEqual([p1, p2]);
      expect(merged.barcodes).toEqual([b1]);
      expect(merged.categories).toEqual([]);
    });

    it("una completa vacía deja la caché vacía", () => {
      expect(mergeSyncResult(current, response({ mode: "full" }))).toEqual(
        emptyData,
      );
    });
  });

  describe("delta", () => {
    it("reemplaza por id: el producto con otro precio pisa al anterior y los demás quedan", () => {
      const repriced = makeProduct(1, {
        name: "Alfajor",
        salePriceCents: 250_00,
        updatedAt: "2026-11-02T14:59:00+00:00",
      });

      const merged = mergeSyncResult(
        current,
        response({ products: [repriced] }),
      );

      expect(merged.products).toHaveLength(2);
      expect(merged.products).toContainEqual(repriced);
      expect(merged.products).toContainEqual(p2);
      expect(merged.products).not.toContainEqual(p1);
      expect(merged.barcodes).toEqual([b1]);
      expect(merged.categories).toEqual([c1]);
    });

    it("una fila repetida por el solape (mismo id y mismo updated_at) deja una sola entrada", () => {
      const merged = mergeSyncResult(current, response({ products: [p1, p1] }));

      expect(merged.products.filter((p) => p.id === p1.id)).toHaveLength(1);
      expect(merged.products).toHaveLength(2);
    });

    it("el mismo id dos veces en la respuesta: gana la última", () => {
      const first = makeProduct(5, { name: "Primero" });
      const last = makeProduct(5, { name: "Último" });

      const merged = mergeSyncResult(
        emptyData,
        response({ products: [first, last] }),
      );

      expect(merged.products).toEqual([last]);
    });

    it("un producto que llega inactivo queda guardado con ese estado (no se borra)", () => {
      const deactivated = { ...p1, status: "inactive" } as const;

      const merged = mergeSyncResult(
        current,
        response({ products: [deactivated] }),
      );

      expect(merged.products).toContainEqual(deactivated);
      expect(merged.products).toHaveLength(2);
    });

    it("un código pasado a otro producto reemplaza la fila con el mismo id", () => {
      const moved = makeBarcode(1, p2.id, "7790001000019", {
        updatedAt: "2026-11-02T14:59:00+00:00",
      });

      const merged = mergeSyncResult(current, response({ barcodes: [moved] }));

      expect(merged.barcodes).toEqual([moved]);
    });

    it("las filas nuevas se suman", () => {
      const p3 = makeProduct(3);
      const b2 = makeBarcode(2, p3.id, "7790009990001");
      const c2 = makeCategory(2);

      const merged = mergeSyncResult(
        current,
        response({ products: [p3], barcodes: [b2], categories: [c2] }),
      );

      expect(merged.products).toHaveLength(3);
      expect(merged.barcodes).toHaveLength(2);
      expect(merged.categories).toHaveLength(2);
    });

    it("un delta sin cambios deja los datos como estaban", () => {
      expect(mergeSyncResult(current, response())).toEqual(current);
    });

    it("no modifica los datos de entrada", () => {
      const before = structuredClone(current);

      mergeSyncResult(
        current,
        response({ products: [makeProduct(9)], barcodes: [], categories: [] }),
      );

      expect(current).toEqual(before);
    });
  });
});

describe("buildMeta", () => {
  const previous: CacheMeta = {
    formatVersion: CACHE_FORMAT_VERSION,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    cursor: "2026-11-02T10:00:00+00:00",
    lastFullSyncAt: NOW - 3_600_000,
    lastSyncAt: NOW - 60_000,
  };

  it("guarda el cursor del servidor tal cual, sin recalcularlo", () => {
    const meta = buildMeta(
      previous,
      scope,
      response({ cursor: "2026-11-02T14:59:00.987654+00:00" }),
      NOW,
    );

    expect(meta.cursor).toBe("2026-11-02T14:59:00.987654+00:00");
  });

  it("una completa actualiza las dos horas", () => {
    expect(buildMeta(previous, scope, response({ mode: "full" }), NOW)).toEqual(
      {
        formatVersion: CACHE_FORMAT_VERSION,
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        cursor: "2026-11-02T14:59:00+00:00",
        lastFullSyncAt: NOW,
        lastSyncAt: NOW,
      },
    );
  });

  it("un delta conserva la hora de la última completa y actualiza la de la última sincronización", () => {
    const meta = buildMeta(previous, scope, response(), NOW);

    expect(meta.lastFullSyncAt).toBe(previous.lastFullSyncAt);
    expect(meta.lastSyncAt).toBe(NOW);
  });

  it("sin meta anterior, la completa fija ambas horas y el alcance sale de la persona actual", () => {
    const meta = buildMeta(null, scope, response({ mode: "full" }), NOW);

    expect(meta).toMatchObject({
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      lastFullSyncAt: NOW,
      lastSyncAt: NOW,
    });
  });

  it("un full vacío deja el cursor en null (la próxima vez vuelve a ser completa)", () => {
    expect(
      buildMeta(null, scope, response({ mode: "full", cursor: null }), NOW)
        .cursor,
    ).toBeNull();
  });

  it("un delta sin meta anterior no se hace pasar por una completa: la próxima sincronización será completa", () => {
    const meta = buildMeta(null, scope, response({ mode: "delta" }), NOW);

    expect(meta.lastFullSyncAt).toBe(0);
    expect(decideSyncMode(meta, scope, NOW)).toEqual({ mode: "full" });
  });
});

describe("hasChanges", () => {
  const p1 = makeProduct(1, { name: "Alfajor" });
  const p2 = makeProduct(2, { name: "Gaseosa" });
  const b1 = makeBarcode(1, p1.id, "7790001000019");
  const c1 = makeCategory(1, { name: "Golosinas" });
  const current: CatalogData = {
    products: [p1, p2],
    barcodes: [b1],
    categories: [c1],
  };

  it("un delta vacío no cambia nada", () => {
    expect(hasChanges(current, response())).toBe(false);
  });

  it("las filas del solape, idénticas a las guardadas, no cambian nada", () => {
    expect(
      hasChanges(
        current,
        response({
          products: [{ ...p1 }, { ...p2 }],
          barcodes: [{ ...b1 }],
          categories: [{ ...c1 }],
        }),
      ),
    ).toBe(false);
  });

  it.each([
    [
      "un producto con otro precio",
      { products: [{ ...p1, salePriceCents: 1 }] },
    ],
    [
      "un producto con otra marca de tiempo",
      { products: [{ ...p1, updatedAt: "2026-11-02T14:00:00+00:00" }] },
    ],
    [
      "un producto con el botón de venta rápida",
      { products: [{ ...p1, quickSale: { position: 1, label: null } }] },
    ],
    ["un producto desactivado", { products: [{ ...p1, status: "inactive" }] }],
    ["un producto nuevo", { products: [makeProduct(3)] }],
    [
      "un código pasado a otro producto",
      { barcodes: [{ ...b1, productId: p2.id }] },
    ],
    ["un código nuevo", { barcodes: [makeBarcode(2, p2.id, "7790001000026")] }],
    ["una categoría renombrada", { categories: [{ ...c1, name: "Dulces" }] }],
    ["una categoría nueva", { categories: [makeCategory(2)] }],
  ] as const)("%s cuenta como cambio", (_name, over) => {
    expect(
      hasChanges(current, response(over as unknown as Partial<CatalogPayload>)),
    ).toBe(true);
  });

  it("una completa siempre cuenta como cambio (reemplaza todo)", () => {
    expect(
      hasChanges(
        current,
        response({
          mode: "full",
          products: [p1, p2],
          barcodes: [b1],
          categories: [c1],
        }),
      ),
    ).toBe(true);
  });

  it("no depende del orden de las claves de la fila", () => {
    const reordered = Object.fromEntries(
      Object.entries(p1).reverse(),
    ) as typeof p1;

    expect(hasChanges(current, response({ products: [reordered] }))).toBe(
      false,
    );
  });
});
