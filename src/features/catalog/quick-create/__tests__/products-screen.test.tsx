import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/features/tenancy";

import {
  buildCatalogIndex,
  searchCatalog,
} from "../../cache/domain/catalog-index";
import type { CachedProduct } from "../../cache";
import type { ScanResolution } from "../domain/resolve-scan";
import { ProductsScreen } from "../products-screen";
import * as actions from "../../actions";
import { lookupSharedProduct } from "@/features/shared-products/server";
import { ORG_ID, VALID_CODE, makeProduct, makeScan } from "./fixtures";

// Spec product-quick-create "Pantalla Productos": escanear o buscar por nombre. Se
// simulan la resolución, la caché y la hoja (los límites); el escáner es el real.

const resolve = vi.hoisted(() => vi.fn());
const cache = vi.hoisted(() => ({
  status: "ready" as string,
  all: [] as unknown[],
  search: vi.fn(),
}));
const rootEnabled = vi.hoisted(() => ({
  values: [] as (boolean | undefined)[],
}));
const sheet = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
const rootScan = vi.hoisted(() => ({
  current: null as ((scan: unknown) => void) | null,
}));

vi.mock("../../actions", () => ({
  createProduct: vi.fn(),
  findProductByBarcode: vi.fn(),
  findProductById: vi.fn(),
  setInitialSalePrice: vi.fn(),
}));
vi.mock("@/features/shared-products/server", () => ({
  lookupSharedProduct: vi.fn(),
}));
vi.mock("../use-scan-resolver", () => ({ useScanResolver: () => resolve }));
vi.mock("../../cache", () => ({
  useCatalogCache: () => ({
    status: cache.status,
    search: cache.search,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/shared/ui/scanner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/ui/scanner")>();
  const ActualRoot = actual.Scanner.Root;
  return {
    Scanner: {
      ...actual.Scanner,
      // Sin cámara real en jsdom; la `Root` es la verdadera y se anota su `enabled`.
      Camera: () => null,
      Root: (props: ComponentProps<typeof ActualRoot>) => {
        rootEnabled.values.push(props.enabled);
        rootScan.current = props.onScan as (scan: unknown) => void;
        return <ActualRoot {...props} />;
      },
    },
  };
});
vi.mock("../quick-create-product", () => ({
  QuickCreateProduct: (props: Record<string, unknown>) => {
    sheet.props.push(props);
    return props.open === true ? (
      <div role="dialog" aria-label="hoja">
        {/* Estado propio de la hoja: se pierde si la hoja se vuelve a montar. */}
        <input aria-label="nombre de la hoja" />
        <button
          type="button"
          onClick={() =>
            (props.onDone as (o: unknown) => void)({
              kind: "created",
              product: makeProduct({
                name: "Recién creado",
                salePriceCents: 1500,
              }),
              scan: props.scan,
            })
          }
        >
          terminar
        </button>
        <button type="button" onClick={props.onCancel as () => void}>
          cerrar
        </button>
      </div>
    ) : null;
  },
}));

function cached(over: Parameters<typeof makeProduct>[0] = {}): CachedProduct {
  return {
    ...makeProduct(over),
    quickSale: null,
    updatedAt: "2026-11-18T10:00:00Z",
  };
}

function found(
  over: Parameters<typeof makeProduct>[0] = {},
): Promise<ScanResolution> {
  return Promise.resolve({
    kind: "found",
    via: "cache",
    product: makeProduct(over),
  });
}

const UNKNOWN: Promise<ScanResolution> = Promise.resolve({ kind: "unknown" });

function lastSheet() {
  return sheet.props[sheet.props.length - 1] ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  cache.status = "ready";
  cache.search.mockReturnValue([]);
  rootEnabled.values = [];
  rootScan.current = null;
  sheet.props = [];
});

function renderScreen(over: { role?: Role; writable?: boolean } = {}) {
  return render(
    <ProductsScreen
      orgId={ORG_ID}
      role={over.role ?? "employee"}
      writable={over.writable ?? true}
    />,
  );
}

async function scanCode(
  user: ReturnType<typeof userEvent.setup>,
  code: string,
) {
  await user.type(screen.getByLabelText("Código de barras"), `${code}{Enter}`);
}

describe("ProductsScreen: escaneo", () => {
  it.each([
    [
      "unidad con precio",
      { name: "Alfajor", brand: "Campo Verde", salePriceCents: 90000 },
      /\$\s?900,00/,
    ],
    [
      "por peso",
      {
        name: "Queso",
        brand: null,
        unit: "kg" as const,
        salePriceCents: 450000,
      },
      /\$\s?4\.500,00 \/ kg/,
    ],
  ])(
    "un código conocido (%s) muestra nombre, marca y precio",
    async (_n, over, price) => {
      const user = userEvent.setup();
      resolve.mockReturnValue(found(over));
      renderScreen();

      await scanCode(user, VALID_CODE);

      const card = await screen.findByRole("article", { name: over.name });
      expect(card).toHaveTextContent(`Código ${VALID_CODE}`);
      expect(within(card).getByText(price)).toBeInTheDocument();
      if (over.brand !== null) {
        expect(within(card).getByText(over.brand)).toBeInTheDocument();
      }
      expect(sheet.props.some((p) => p.open === true)).toBe(false);
    },
  );

  it("sin precio: 'Sin precio' y 'Poner precio' abre el modo precio con el código leído", async () => {
    const user = userEvent.setup();
    const product = makeProduct({ salePriceCents: null });
    resolve.mockReturnValue(
      Promise.resolve({ kind: "found", via: "cache", product }),
    );
    renderScreen();

    await scanCode(user, VALID_CODE);
    const card = await screen.findByRole("article", { name: product.name });
    expect(within(card).getByText("Sin precio")).toBeInTheDocument();
    await user.click(
      within(card).getByRole("button", { name: "Poner precio" }),
    );

    expect(lastSheet()).toMatchObject({
      open: true,
      mode: "price",
      product,
      origin: "catalog",
      orgId: ORG_ID,
      scan: { raw: VALID_CODE },
    });
  });

  it("desactivado: 'Desactivado', sin alta ni 'Poner precio' (aunque no tenga precio)", async () => {
    const user = userEvent.setup();
    resolve.mockReturnValue(
      found({ status: "inactive", salePriceCents: null }),
    );
    renderScreen({ role: "owner" });

    await scanCode(user, VALID_CODE);

    const card = await screen.findByRole("article");
    expect(within(card).getByText("Desactivado")).toBeInTheDocument();
    expect(
      within(card).queryByRole("button", { name: "Poner precio" }),
    ).not.toBeInTheDocument();
    expect(sheet.props.some((p) => p.open === true)).toBe(false);
  });

  it("un código desconocido abre la hoja de alta (origen catalog) y el lector queda apagado mientras está abierta", async () => {
    const user = userEvent.setup();
    resolve.mockReturnValue(UNKNOWN);
    renderScreen();

    await scanCode(user, VALID_CODE);

    await waitFor(() =>
      expect(lastSheet()).toMatchObject({
        open: true,
        origin: "catalog",
        orgId: ORG_ID,
        scan: { raw: VALID_CODE },
      }),
    );
    expect(lastSheet().mode ?? "create").toBe("create");
    expect(rootEnabled.values[rootEnabled.values.length - 1]).toBe(false);

    // Al cerrarla el lector vuelve a escuchar.
    await user.click(screen.getByRole("button", { name: "cerrar" }));
    await waitFor(() =>
      expect(rootEnabled.values[rootEnabled.values.length - 1]).toBe(true),
    );
  });

  it("al terminar el alta muestra el producto creado y cierra la hoja", async () => {
    const user = userEvent.setup();
    resolve.mockReturnValue(UNKNOWN);
    renderScreen();
    await scanCode(user, VALID_CODE);
    await user.click(await screen.findByRole("button", { name: "terminar" }));

    expect(
      await screen.findByRole("article", { name: "Recién creado" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("código ya cargado por otra persona (CA-E02): el aviso se muestra junto al producto", async () => {
    const user = userEvent.setup();
    resolve.mockReturnValue(UNKNOWN);
    renderScreen();
    await scanCode(user, VALID_CODE);
    await screen.findByRole("dialog");
    // El stub de la hoja termina con el aviso que armaría `submitQuickCreate`.
    act(() => {
      (lastSheet().onDone as (o: unknown) => void)({
        kind: "existing",
        product: makeProduct({ salePriceCents: 1000 }),
        scan: lastSheet().scan,
        notice: "Ese código ya lo cargó otra persona: Alfajor",
      });
    });

    expect(
      await screen.findByText("Ese código ya lo cargó otra persona: Alfajor"),
    ).toBeInTheDocument();
  });
});

function deferredResolution() {
  let resolveIt: (value: ScanResolution) => void = () => {};
  const promise = new Promise<ScanResolution>((res) => {
    resolveIt = res;
  });
  return { promise, resolve: resolveIt };
}

describe("ProductsScreen: lecturas seguidas", () => {
  const CODE_B = "7790001000026";

  it("la resolución de una lectura vieja que llega tarde se ignora: queda la última", async () => {
    const user = userEvent.setup();
    const a = deferredResolution();
    const b = deferredResolution();
    resolve.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    renderScreen();

    await scanCode(user, VALID_CODE);
    await scanCode(user, CODE_B);
    await act(async () => {
      b.resolve({
        kind: "found",
        via: "cache",
        product: makeProduct({ name: "Producto B", salePriceCents: 100 }),
      });
      await b.promise;
    });
    await act(async () => {
      a.resolve({ kind: "unknown" });
      await a.promise;
    });

    expect(
      await screen.findByRole("article", { name: "Producto B" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sheet.props.some((p) => p.open === true)).toBe(false);
  });

  it("un desconocido tardío con 'Poner precio' ya abierto no reemplaza la hoja de precio", async () => {
    const user = userEvent.setup();
    const late = deferredResolution();
    const product = makeProduct({ name: "Sin precio", salePriceCents: null });
    resolve
      .mockReturnValueOnce(
        Promise.resolve({ kind: "found", via: "cache", product }),
      )
      .mockReturnValueOnce(late.promise);
    renderScreen();
    await scanCode(user, VALID_CODE);
    const card = await screen.findByRole("article", { name: "Sin precio" });
    await scanCode(user, CODE_B);
    await user.click(
      within(card).getByRole("button", { name: "Poner precio" }),
    );
    await screen.findByRole("dialog");
    const before = lastSheet();

    await act(async () => {
      late.resolve({ kind: "unknown" });
      await late.promise;
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(lastSheet()).toMatchObject({ mode: "price", product });
    expect(lastSheet().scan).toBe(before.scan);
  });

  it("un encontrado tardío después de elegir por nombre deja la tarjeta elegida", async () => {
    const user = userEvent.setup();
    const late = deferredResolution();
    resolve.mockReturnValueOnce(late.promise);
    const index = buildCatalogIndex(
      [cached({ id: "00000000-0000-4000-8000-00000000c0bb", name: "Turrón" })],
      [],
      [],
    );
    cache.search.mockImplementation((query: string) =>
      searchCatalog(index, query),
    );
    renderScreen();
    await scanCode(user, CODE_B);
    await user.type(screen.getByLabelText("Buscar por nombre"), "turron");
    await user.click(await screen.findByRole("button", { name: /Turrón/ }));
    await screen.findByRole("article", { name: "Turrón" });

    await act(async () => {
      late.resolve({
        kind: "found",
        via: "cache",
        product: makeProduct({ name: "Producto B", salePriceCents: 100 }),
      });
      await late.promise;
    });

    expect(screen.getByRole("article", { name: "Turrón" })).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "Producto B" }),
    ).not.toBeInTheDocument();
  });
});

describe("ProductsScreen: resultado de una hoja que ya no es la actual", () => {
  it("un onDone tardío de una hoja cerrada no muestra ni cambia nada", async () => {
    const user = userEvent.setup();
    resolve.mockReturnValue(UNKNOWN);
    renderScreen();
    await scanCode(user, VALID_CODE);
    await screen.findByRole("dialog");
    const staleDone = lastSheet().onDone as (o: unknown) => void;
    await user.click(screen.getByRole("button", { name: "cerrar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    act(() => {
      staleDone({
        kind: "created",
        product: makeProduct({ name: "Fantasma" }),
        scan: makeScan(),
      });
    });

    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});

describe("ProductsScreen: aviso CA-E08 con el código leído", () => {
  it("'Otra persona ya le puso precio.' se muestra junto al producto con su precio y su código", async () => {
    const user = userEvent.setup();
    const product = makeProduct({ salePriceCents: null });
    resolve.mockReturnValue(
      Promise.resolve({ kind: "found", via: "cache", product }),
    );
    renderScreen();
    await scanCode(user, VALID_CODE);
    await user.click(
      within(
        await screen.findByRole("article", { name: product.name }),
      ).getByRole("button", { name: "Poner precio" }),
    );
    act(() => {
      (lastSheet().onDone as (o: unknown) => void)({
        kind: "existing",
        product: { ...product, salePriceCents: 70000 },
        scan: lastSheet().scan,
        notice: "Otra persona ya le puso precio.",
      });
    });

    const card = await screen.findByRole("article", { name: product.name });
    expect(
      within(card).getByText("Otra persona ya le puso precio."),
    ).toBeInTheDocument();
    expect(within(card).getByText(/\$\s?700,00/)).toBeInTheDocument();
    expect(card).toHaveTextContent(`Código ${VALID_CODE}`);
    expect(
      within(card).queryByRole("button", { name: "Poner precio" }),
    ).not.toBeInTheDocument();
  });
});

describe("ProductsScreen: permisos", () => {
  it.each([
    ["owner", true],
    ["manager", true],
    ["employee", false],
  ] as const)(
    "enlace a la ficha del catálogo para %s: %s",
    async (role, link) => {
      const user = userEvent.setup();
      const product = makeProduct({ salePriceCents: 100 });
      resolve.mockReturnValue(
        Promise.resolve({ kind: "found", via: "cache", product }),
      );
      renderScreen({ role });

      await scanCode(user, VALID_CODE);

      const card = await screen.findByRole("article");
      const anchor = within(card).queryByRole("link", { name: /ficha/i });
      if (link) {
        expect(anchor).toHaveAttribute(
          "href",
          `/org/${ORG_ID}/catalogo/${product.id}`,
        );
      } else {
        expect(anchor).not.toBeInTheDocument();
        // Ningún control para cambiar nombre, marca ni presentación.
        expect(
          within(card).queryByRole("button", { name: /editar|cambiar/i }),
        ).not.toBeInTheDocument();
        expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
      }
    },
  );

  it("con la cuenta suspendida: aviso, el desconocido no abre la hoja y no ofrece 'Poner precio'", async () => {
    const user = userEvent.setup();
    resolve.mockReturnValue(UNKNOWN);
    renderScreen({ writable: false });

    expect(
      screen.getByText(
        "La cuenta está suspendida: el catálogo es solo de lectura.",
      ),
    ).toBeInTheDocument();
    await scanCode(user, VALID_CODE);

    expect(
      await screen.findByText(/No encontramos ese código/),
    ).toBeInTheDocument();
    expect(sheet.props.some((p) => p.open === true)).toBe(false);

    resolve.mockReturnValue(found({ salePriceCents: null }));
    await scanCode(user, "7790001000026");
    const card = await screen.findByRole("article");
    expect(
      within(card).queryByRole("button", { name: "Poner precio" }),
    ).not.toBeInTheDocument();
  });
});

describe("ProductsScreen: búsqueda por nombre", () => {
  /** Detrás de la caché simulada corre el `searchCatalog` de verdad. */
  function fakeSearch(items: CachedProduct[]) {
    const index = buildCatalogIndex(items, [], []);
    cache.search.mockImplementation((query: string) =>
      searchCatalog(index, query),
    );
  }

  function expectNoServerCalls() {
    for (const action of Object.values(actions)) {
      expect(action).not.toHaveBeenCalled();
    }
    expect(lookupSharedProduct).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  }

  it("encuentra sin acentos ni mayúsculas, muestra la misma tarjeta al tocar y no llama al servidor", async () => {
    const user = userEvent.setup();
    fakeSearch([cached({ name: "Turrón Arcor", salePriceCents: 50000 })]);
    renderScreen();

    await user.type(screen.getByLabelText("Buscar por nombre"), "TURRON");
    await user.click(
      await screen.findByRole("button", { name: /Turrón Arcor/ }),
    );

    const card = await screen.findByRole("article", { name: "Turrón Arcor" });
    expect(within(card).getByText(/\$\s?500,00/)).toBeInTheDocument();
    expect(cache.search).toHaveBeenCalledWith("TURRON");
    expectNoServerCalls();
  });

  it.each(["employee", "manager", "owner"] as const)(
    "un producto sin precio elegido por nombre (%s): 'Poner precio' abre el modo precio sin código",
    async (role) => {
      const user = userEvent.setup();
      const product = cached({ name: "Turrón Arcor", salePriceCents: null });
      fakeSearch([product]);
      renderScreen({ role });

      await user.type(screen.getByLabelText("Buscar por nombre"), "turron");
      await user.click(
        await screen.findByRole("button", { name: /Turrón Arcor/ }),
      );

      const card = await screen.findByRole("article");
      expect(within(card).getByText("Sin precio")).toBeInTheDocument();
      expect(
        within(card).queryByText(/Escaneá su código/),
      ).not.toBeInTheDocument();
      await user.click(
        within(card).getByRole("button", { name: "Poner precio" }),
      );

      expect(lastSheet()).toMatchObject({
        open: true,
        mode: "price",
        origin: "catalog",
        orgId: ORG_ID,
        scan: null,
        product: { id: product.id, name: "Turrón Arcor" },
      });
      expect(rootEnabled.values[rootEnabled.values.length - 1]).toBe(false);
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it("al ponerle precio desde la búsqueda, la tarjeta muestra el precio nuevo y el aviso", async () => {
    const user = userEvent.setup();
    const product = cached({ name: "Turrón Arcor", salePriceCents: null });
    fakeSearch([product]);
    renderScreen();

    await user.type(screen.getByLabelText("Buscar por nombre"), "turron");
    await user.click(
      await screen.findByRole("button", { name: /Turrón Arcor/ }),
    );
    await user.click(
      within(await screen.findByRole("article")).getByRole("button", {
        name: "Poner precio",
      }),
    );
    act(() => {
      (lastSheet().onDone as (o: unknown) => void)({
        kind: "existing",
        product: makeProduct({ name: "Turrón Arcor", salePriceCents: 70000 }),
        scan: null,
        notice: "Otra persona ya le puso precio.",
      });
    });

    const card = await screen.findByRole("article", { name: "Turrón Arcor" });
    expect(within(card).getByText(/\$\s?700,00/)).toBeInTheDocument();
    expect(
      within(card).getByText("Otra persona ya le puso precio."),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/^Código/)).not.toBeInTheDocument();
    expect(
      within(card).queryByRole("button", { name: "Poner precio" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("con la cuenta suspendida, el elegido por nombre sin precio no ofrece 'Poner precio'", async () => {
    const user = userEvent.setup();
    fakeSearch([cached({ name: "Turrón Arcor", salePriceCents: null })]);
    renderScreen({ writable: false });

    await user.type(screen.getByLabelText("Buscar por nombre"), "turron");
    await user.click(
      await screen.findByRole("button", { name: /Turrón Arcor/ }),
    );

    const card = await screen.findByRole("article");
    expect(
      within(card).queryByRole("button", { name: "Poner precio" }),
    ).not.toBeInTheDocument();
  });

  it("sin resultados: avisa y no ofrece alta", async () => {
    const user = userEvent.setup();
    fakeSearch([]);
    renderScreen();

    await user.type(screen.getByLabelText("Buscar por nombre"), "zzz");

    expect(
      await screen.findByText(
        "No encontramos productos con ese nombre. Escaneá el código para cargarlo.",
      ),
    ).toBeInTheDocument();
    expect(sheet.props.some((p) => p.open === true)).toBe(false);
  });

  it("palabras parciales en cualquier orden y sin acentos (searchCatalog de verdad)", async () => {
    const user = userEvent.setup();
    fakeSearch([
      cached({
        id: "00000000-0000-4000-8000-00000000c001",
        name: "Turrón de maní",
        brand: "Arcor",
      }),
      cached({
        id: "00000000-0000-4000-8000-00000000c002",
        name: "Maní con chocolate",
      }),
      cached({
        id: "00000000-0000-4000-8000-00000000c003",
        name: "Turrón de menta",
      }),
    ]);
    renderScreen();

    await user.type(screen.getByLabelText("Buscar por nombre"), "mani tur");

    expect(
      await screen.findByRole("button", { name: /Turrón de maní/ }),
    ).toBeInTheDocument();
    // Faltan palabras: no entran.
    expect(
      screen.queryByRole("button", { name: /Maní con chocolate/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Turrón de menta/ }),
    ).not.toBeInTheDocument();
    expectNoServerCalls();
  });

  it("una palabra parcial sin acento encuentra por la marca también", async () => {
    const user = userEvent.setup();
    fakeSearch([
      cached({ name: "Galletitas de limón", brand: "Campo Verde" }),
      cached({
        id: "00000000-0000-4000-8000-00000000c0bb",
        name: "Limón en polvo",
        brand: null,
      }),
    ]);
    renderScreen();

    await user.type(screen.getByLabelText("Buscar por nombre"), "campo lim");

    expect(
      await screen.findByRole("button", { name: /Galletitas de limón/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Limón en polvo/ }),
    ).not.toBeInTheDocument();
  });

  it("con la caché cargando y sin datos: 'Cargando el catálogo…' en lugar de 'sin resultados'", async () => {
    const user = userEvent.setup();
    cache.status = "loading";
    renderScreen();

    await user.type(screen.getByLabelText("Buscar por nombre"), "turron");

    expect(
      await screen.findByText("Cargando el catálogo…"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No encontramos productos/),
    ).not.toBeInTheDocument();
  });
});
