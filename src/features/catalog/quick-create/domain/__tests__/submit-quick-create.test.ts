import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { err, ok } from "@/shared/lib/result";

import { adminRow } from "../../../__tests__/fixtures";
import { barcodeTakenMessage, catalogError } from "../../../domain/errors";
import type { CatalogError } from "../../../domain/errors";
import { toProductView } from "../../../domain/product-view";
import {
  ORG_ID,
  VALID_CODE,
  makeProduct,
  makeScan,
} from "../../__tests__/fixtures";
import type { QuickCreateInput, QuickCreateOrigin } from "../quick-create-form";
import { submitQuickCreate } from "../submit-quick-create";
import type { SubmitQuickCreateDeps } from "../submit-quick-create";

// Spec product-quick-create "Alta rápida", "Código ya cargado" y "Poné el precio".

const scan = makeScan(VALID_CODE, { multiplier: 3 });
const create: QuickCreateInput = {
  name: "Galletitas",
  brand: null,
  unit: "unit",
  salePriceCents: 90000,
  barcodes: [scan.raw],
};
const mine = makeProduct({ id: "00000000-0000-4000-8000-0000000000a1" });
const theirs = makeProduct({
  id: "00000000-0000-4000-8000-0000000000b2",
  name: "Galletitas de limón",
});

type MockedDeps = SubmitQuickCreateDeps & {
  createProduct: Mock;
  findProductByBarcode: Mock;
  setInitialSalePrice: Mock;
};

function deps(over: Partial<Record<keyof MockedDeps, Mock>> = {}): MockedDeps {
  return {
    createProduct: vi.fn(() =>
      Promise.resolve(ok({ product: mine, warnings: [] })),
    ),
    findProductByBarcode: vi.fn(() => Promise.resolve(ok(theirs))),
    setInitialSalePrice: vi.fn(() =>
      Promise.resolve(ok({ product: { ...theirs, salePriceCents: 90000 } })),
    ),
    ...over,
  };
}

function run(
  d: SubmitQuickCreateDeps,
  over: { origin?: QuickCreateOrigin; create?: QuickCreateInput } = {},
) {
  return submitQuickCreate(
    {
      orgId: ORG_ID,
      scan,
      origin: over.origin ?? "catalog",
      create: over.create ?? create,
    },
    d,
  );
}

const takenError = catalogError("CA-E02", {
  message: barcodeTakenMessage(VALID_CODE, theirs.name),
});
const raceWarning = {
  code: "CA-E02" as const,
  message: "El código ya es de otro producto.",
  barcode: VALID_CODE,
};
const rejectingTaken = () => vi.fn(() => Promise.resolve(err(takenError)));

describe("submitQuickCreate: alta feliz", () => {
  it("crea el producto con una sola llamada y devuelve created", async () => {
    const product = makeProduct({ salePriceCents: 90000 });
    const d = deps({
      createProduct: vi.fn(() =>
        Promise.resolve(ok({ product, warnings: [] })),
      ),
    });

    const result = await run(d);

    expect(d.createProduct).toHaveBeenCalledExactlyOnceWith(ORG_ID, create);
    expect(d.findProductByBarcode).not.toHaveBeenCalled();
    expect(result).toEqual(ok({ kind: "created", product, scan }));
  });

  it("por peso manda unit kg con el precio por kilo", async () => {
    const d = deps();
    const kg: QuickCreateInput = {
      ...create,
      unit: "kg",
      salePriceCents: 120000,
    };

    await run(d, { create: kg });

    expect(d.createProduct).toHaveBeenCalledExactlyOnceWith(ORG_ID, kg);
  });

  it("el Scan vuelve intacto, con su multiplicador", async () => {
    const result = await run(deps());

    expect(result.ok && result.value.scan).toBe(scan);
    expect(result.ok && result.value.scan.multiplier).toBe(3);
  });

  it("para el dueño devuelve solo la vista básica (sin claves de administración)", async () => {
    const adminView = toProductView(adminRow({ sale_price: 900 }), "owner");
    const d = deps({
      createProduct: vi.fn(() =>
        Promise.resolve(ok({ product: adminView, warnings: [] })),
      ),
    });

    const result = await run(d);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.product).not.toHaveProperty("referenceCostCents");
    expect(result.value.product).not.toHaveProperty("preferredSupplierId");
    expect(result.value.product).not.toHaveProperty("quickSaleLabel");
    expect(result.value.product.name).toBe(adminView.name);
  });
});

describe("submitQuickCreate: código ya cargado", () => {
  it.each([
    ["chequeo previo (CA-E02)", rejectingTaken],
    [
      "carrera en el INSERT (aviso CA-E02)",
      () =>
        vi.fn(() =>
          Promise.resolve(ok({ product: mine, warnings: [raceWarning] })),
        ),
    ],
  ])(
    "%s → existing con el dueño del código y el aviso",
    async (_name, makeCreate) => {
      const d = deps({ createProduct: makeCreate() });

      // Sin precio escrito: el dueño del código se devuelve tal cual.
      const result = await run(d, {
        create: { ...create, salePriceCents: null },
      });

      expect(d.findProductByBarcode).toHaveBeenCalledExactlyOnceWith(ORG_ID, {
        barcode: scan.raw,
      });
      expect(result).toEqual(
        ok({
          kind: "existing",
          product: theirs,
          scan,
          notice: "Ese código ya lo cargó otra persona: Galletitas de limón",
        }),
      );
    },
  );

  it.each(["sale", "count", "purchase", "waste", "catalog"] as const)(
    "existente sin precio + origen %s + precio escrito → le pone el precio",
    async (origin) => {
      const d = deps({ createProduct: rejectingTaken() });

      const result = await run(d, { origin });

      expect(d.setInitialSalePrice).toHaveBeenCalledExactlyOnceWith(ORG_ID, {
        productId: theirs.id,
        salePriceCents: 90000,
      });
      expect(result.ok && result.value.product.salePriceCents).toBe(90000);
      expect(result.ok && result.value.kind).toBe("existing");
      // El aviso sigue diciendo quién lo cargó, sin hablar de un precio descartado.
      expect(result.ok && result.value.notice).toBe(
        "Ese código ya lo cargó otra persona: Galletitas de limón",
      );
    },
  );

  it("existente sin precio y la persona no escribió precio: no se llama a setInitialSalePrice", async () => {
    const d = deps({ createProduct: rejectingTaken() });

    const result = await run(d, {
      origin: "catalog",
      create: { ...create, salePriceCents: null },
    });

    expect(d.setInitialSalePrice).not.toHaveBeenCalled();
    expect(result.ok && result.value.product).toEqual(theirs);
    expect(result.ok && result.value.notice).toBe(
      "Ese código ya lo cargó otra persona: Galletitas de limón",
    );
  });

  it.each(["sale", "catalog"] as const)(
    "el existente ya tiene precio (%s) y se escribió otro: no se pisa y el aviso lo dice",
    async (origin) => {
      const existing = { ...theirs, salePriceCents: 500 };
      const d = deps({
        createProduct: rejectingTaken(),
        findProductByBarcode: vi.fn(() => Promise.resolve(ok(existing))),
      });

      const result = await run(d, { origin });

      expect(d.setInitialSalePrice).not.toHaveBeenCalled();
      expect(result.ok && result.value.product).toEqual(existing);
      expect(result.ok && result.value.notice).toBe(
        "Ese código ya lo cargó otra persona: Galletitas de limón. No se aplicó el precio que escribiste: ya tenía precio.",
      );
    },
  );

  it.each([
    ["kilo escrito, existente por unidad", "kg", "unit", "por unidad"],
    ["unidad escrita, existente por kilo", "unit", "kg", "por kilo"],
  ] as const)(
    "unidad distinta (%s): no se aplica el precio y el aviso dice cómo se vende",
    async (_label, typedUnit, existingUnit, sold) => {
      const existing = { ...theirs, unit: existingUnit };
      const d = deps({
        createProduct: rejectingTaken(),
        findProductByBarcode: vi.fn(() => Promise.resolve(ok(existing))),
      });

      const result = await run(d, {
        origin: "sale",
        create: { ...create, unit: typedUnit },
      });

      expect(d.setInitialSalePrice).not.toHaveBeenCalled();
      expect(result.ok && result.value.product).toEqual(existing);
      expect(result.ok && result.value.notice).toBe(
        `Ese código ya lo cargó otra persona: Galletitas de limón. No se aplicó el precio que escribiste: ese producto se vende ${sold}.`,
      );
    },
  );

  it("misma unidad por kilo: el precio sí se aplica", async () => {
    const existing = { ...theirs, unit: "kg" as const };
    const d = deps({
      createProduct: rejectingTaken(),
      findProductByBarcode: vi.fn(() => Promise.resolve(ok(existing))),
    });

    await run(d, {
      origin: "sale",
      create: { ...create, unit: "kg", salePriceCents: 120000 },
    });

    expect(d.setInitialSalePrice).toHaveBeenCalledExactlyOnceWith(ORG_ID, {
      productId: existing.id,
      salePriceCents: 120000,
    });
  });

  it("existente desactivado y sin precio: no se le pone precio y el aviso lo dice", async () => {
    const existing = { ...theirs, status: "inactive" as const };
    const d = deps({
      createProduct: rejectingTaken(),
      findProductByBarcode: vi.fn(() => Promise.resolve(ok(existing))),
    });

    const result = await run(d, { origin: "sale" });

    expect(d.setInitialSalePrice).not.toHaveBeenCalled();
    expect(result.ok && result.value.product).toEqual(existing);
    expect(result.ok && result.value.notice).toBe(
      "Ese código ya lo cargó otra persona: Galletitas de limón. No se aplicó el precio que escribiste: el producto está desactivado.",
    );
  });

  it("CA-E08 al poner el precio: relee y sigue con el precio actual", async () => {
    const current = { ...theirs, salePriceCents: 700 };
    const find = vi
      .fn()
      .mockResolvedValueOnce(ok(theirs))
      .mockResolvedValueOnce(ok(current));
    const d = deps({
      createProduct: rejectingTaken(),
      findProductByBarcode: find,
      setInitialSalePrice: vi.fn(() =>
        Promise.resolve(err(catalogError("CA-E08"))),
      ),
    });

    const result = await run(d, { origin: "sale" });

    expect(find).toHaveBeenCalledTimes(2);
    expect(result.ok && result.value.product).toEqual(current);
    expect(result.ok && result.value.notice).toContain(
      "No se aplicó el precio que escribiste",
    );
  });

  it.each([
    ["devuelve error", () => Promise.resolve(err(catalogError("CA-E10")))],
    ["devuelve null", () => Promise.resolve(ok(null))],
    ["rechaza", () => Promise.reject(new Error("offline"))],
  ])(
    "CA-E08 y la relectura %s: error 'Probá de nuevo', no se sigue con el producto viejo",
    async (_name, reread) => {
      const find = vi
        .fn()
        .mockResolvedValueOnce(ok(theirs))
        .mockImplementationOnce(reread);
      const d = deps({
        createProduct: rejectingTaken(),
        findProductByBarcode: find,
        setInitialSalePrice: vi.fn(() =>
          Promise.resolve(err(catalogError("CA-E08"))),
        ),
      });

      const result = await run(d, { origin: "sale" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("Probá de nuevo");
    },
  );

  it("CA-E01 al poner el precio → error por campo", async () => {
    const fieldError = catalogError("CA-E01", {
      fieldErrors: { salePriceCents: "El monto no es válido." },
    });
    const d = deps({
      createProduct: rejectingTaken(),
      setInitialSalePrice: vi.fn(() => Promise.resolve(err(fieldError))),
    });

    const result = await run(d, { origin: "sale" });

    expect(result).toEqual(err(fieldError));
  });

  it.each(["CA-E05", "CA-E04", "CA-E10"] as const)(
    "%s al poner el precio → error general",
    async (code) => {
      const failure = catalogError(code);
      const d = deps({
        createProduct: rejectingTaken(),
        setInitialSalePrice: vi.fn(() => Promise.resolve(err(failure))),
      });

      const result = await run(d, { origin: "sale" });

      expect(result).toEqual(err(failure));
    },
  );

  it.each([
    ["devuelve error", () => Promise.resolve(err(catalogError("CA-E10")))],
    ["devuelve null", () => Promise.resolve(ok(null))],
    ["rechaza", () => Promise.reject(new Error("offline"))],
  ])(
    "si findProductByBarcode %s después de CA-E02 → error 'Probá de nuevo'",
    async (_name, find) => {
      const d = deps({
        createProduct: rejectingTaken(),
        findProductByBarcode: vi.fn(find),
      });

      const result = await run(d);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("Probá de nuevo");
    },
  );
});

describe("submitQuickCreate: otros errores", () => {
  it.each([
    catalogError("CA-E01", {
      fieldErrors: { name: "Escribí el nombre del producto." },
    }),
    catalogError("CA-E05"),
    catalogError("CA-E04"),
    catalogError("CA-E10"),
  ] as CatalogError[])(
    "devuelve el error tal cual (%j) sin buscar nada",
    async (failure) => {
      const d = deps({
        createProduct: vi.fn(() => Promise.resolve(err(failure))),
      });

      const result = await run(d);

      expect(result).toEqual(err(failure));
      expect(d.findProductByBarcode).not.toHaveBeenCalled();
    },
  );

  it("si createProduct rechaza (red) devuelve CA-E10 en vez de lanzar", async () => {
    const d = deps({
      createProduct: vi.fn(() => Promise.reject(new Error("offline"))),
    });

    const result = await run(d);

    expect(result.ok === false && result.error.code).toBe("CA-E10");
  });
});
