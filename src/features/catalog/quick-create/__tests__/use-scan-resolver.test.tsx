import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/lib/result";

import { findProductByBarcode } from "../../actions";
import { catalogError } from "../../domain/errors";
import { useScanResolver } from "../use-scan-resolver";
import { ORG_ID, VALID_CODE, makeProduct, makeScan } from "./fixtures";

// Spec product-quick-create "Resolución de un código": el hook conecta la caché de C-11,
// `findProductByBarcode` y `resolveScan`. Se simulan la caché y la acción (los límites).

const cache = vi.hoisted(() => ({
  findByBarcode: vi.fn(),
  refresh: vi.fn(() => Promise.resolve("synced")),
}));

vi.mock("../../actions", () => ({ findProductByBarcode: vi.fn() }));
vi.mock("../../cache", () => ({ useCatalogCache: () => cache }));

beforeEach(() => {
  vi.clearAllMocks();
  cache.findByBarcode.mockReturnValue(null);
});

function resolver() {
  return renderHook(() => useScanResolver(ORG_ID)).result.current;
}

describe("useScanResolver", () => {
  it("un producto de la caché se resuelve sin consultar la base ni refrescar", async () => {
    const cached = {
      ...makeProduct({ name: "Alfajor", salePriceCents: 90000 }),
      quickSale: { position: 1, label: null },
      updatedAt: "2026-11-18T10:00:00Z",
    };
    cache.findByBarcode.mockReturnValue(cached);
    const scan = makeScan();

    const resolution = await resolver()(scan);

    expect(cache.findByBarcode).toHaveBeenCalledWith(scan.norm);
    expect(findProductByBarcode).not.toHaveBeenCalled();
    expect(cache.refresh).not.toHaveBeenCalled();
    expect(resolution).toEqual({
      kind: "found",
      via: "cache",
      // Sin `quickSale` ni `updatedAt`: solo la vista básica.
      product: makeProduct({ name: "Alfajor", salePriceCents: 90000 }),
    });
  });

  it("caché atrasada: lo encuentra en la base (con el código tal como se leyó) y refresca la caché", async () => {
    const product = makeProduct({ name: "Turrón" });
    vi.mocked(findProductByBarcode).mockResolvedValue(ok(product));
    const scan = makeScan(VALID_CODE);

    const resolution = await resolver()(scan);

    expect(findProductByBarcode).toHaveBeenCalledWith(ORG_ID, {
      barcode: scan.raw,
    });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
    expect(resolution).toEqual({ kind: "found", via: "db", product });
  });

  it("un producto inactivo de la caché vuelve con su estado", async () => {
    cache.findByBarcode.mockReturnValue({
      ...makeProduct({ status: "inactive" }),
      quickSale: null,
      updatedAt: "2026-11-18T10:00:00Z",
    });

    const resolution = await resolver()(makeScan());

    expect(resolution).toMatchObject({
      kind: "found",
      product: { status: "inactive" },
    });
  });

  it.each([
    ["no está en la base", () => ok(null)],
    ["la base responde un error", () => err(catalogError("CA-E10"))],
  ])("desconocido cuando %s, sin refrescar", async (_name, answer) => {
    vi.mocked(findProductByBarcode).mockResolvedValue(answer());

    const resolution = await resolver()(makeScan());

    expect(resolution).toEqual({ kind: "unknown" });
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("sin conexión (la acción rechaza) es desconocido y no rechaza", async () => {
    vi.mocked(findProductByBarcode).mockRejectedValue(new Error("offline"));

    await expect(resolver()(makeScan())).resolves.toEqual({
      kind: "unknown",
    });
  });
});
