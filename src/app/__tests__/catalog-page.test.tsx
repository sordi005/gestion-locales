import { render, screen, within } from "@testing-library/react";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CatalogPage from "@/app/(app)/org/[orgId]/catalogo/page";
import {
  CATEGORY_ID,
  ORG_ID,
  OTHER_PRODUCT_ID,
  PRODUCT_ID,
  makeOrgContext,
} from "@/features/catalog/__tests__/fixtures";
import type {
  CatalogListItem,
  CatalogProductPage,
  CategoryWithCount,
  ProductAdminView,
} from "@/features/catalog";
import { listCatalogProducts, listCategories } from "@/features/catalog/server";
import { requireOrgContext } from "@/features/tenancy/server";
import { formatArs, toCents } from "@/shared/lib/money";

// Specs catalog-management "Acceso por rol", "Listado con búsqueda y filtros",
// "Productos sin precio claramente indicados", "Organización suspendida en solo
// lectura" y catalog-price-editing "Precio de productos por peso". La página
// llama a la guarda por su cuenta y lee con las consultas del catálogo; se
// simulan las dos.

vi.mock("@/features/tenancy/server", () => ({ requireOrgContext: vi.fn() }));
// `redirect()` de Next corta la página lanzando: acá lanza con el destino.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
// El barril de componentes trae los formularios, que importan las acciones.
vi.mock("@/features/catalog/actions", () => ({}));
vi.mock("@/features/catalog/server", () => ({
  listCatalogProducts: vi.fn(),
  listCategories: vi.fn(),
}));

// `formatArs` separa el `$` con un espacio no separable; Testing Library compara
// el texto del DOM con los espacios normalizados.
const plain = (text: string) => text.replace(/ /g, " ");

const THIRD_ID = "00000000-0000-4000-8000-00000000c003";

type ListedProduct = ProductAdminView & CatalogListItem;

function product(over: Partial<ListedProduct> = {}): ListedProduct {
  return {
    primaryBarcode: null,
    id: PRODUCT_ID,
    name: "Alfajor triple",
    brand: "Havanna",
    categoryId: CATEGORY_ID,
    unit: "unit",
    status: "active",
    tracksStock: true,
    tracksExpiry: false,
    salePriceCents: toCents(120000),
    salePriceUpdatedAt: "2026-10-20T12:00:00+00:00",
    referenceCostCents: toCents(80000),
    referenceCostSource: "manual",
    referenceCostUpdatedAt: null,
    preferredSupplierId: null,
    quickSalePosition: null,
    quickSaleLabel: null,
    ...over,
  };
}

function pageOf(
  items: ListedProduct[],
  over: Partial<CatalogProductPage> = {},
): CatalogProductPage {
  return { items, total: items.length, page: 1, pageSize: 50, ...over };
}

const CATEGORIES: CategoryWithCount[] = [
  { id: CATEGORY_ID, name: "Golosinas", activeProductCount: 3 },
  { id: OTHER_PRODUCT_ID, name: "Bebidas", activeProductCount: 5 },
];

type SearchParams = Record<string, string | string[] | undefined>;

function renderPage(searchParams: SearchParams = {}) {
  return CatalogPage({
    params: Promise.resolve({ orgId: ORG_ID }),
    searchParams: Promise.resolve(searchParams),
  });
}

function setup(
  items: ListedProduct[] = [product()],
  over: { writable?: boolean; page?: Partial<CatalogProductPage> } = {},
) {
  vi.mocked(requireOrgContext).mockResolvedValue(
    makeOrgContext({ writable: over.writable ?? true }),
  );
  vi.mocked(listCatalogProducts).mockResolvedValue(pageOf(items, over.page));
  vi.mocked(listCategories).mockResolvedValue(CATEGORIES);
}

beforeEach(() => {
  vi.mocked(requireOrgContext).mockReset();
  vi.mocked(listCatalogProducts).mockReset();
  vi.mocked(listCategories).mockReset();
  vi.mocked(redirect).mockClear();
});

describe("página /org/[orgId]/catalogo", () => {
  it("llama a requireOrgContext por su cuenta, con el id de la URL y solo para dueño y encargado", async () => {
    setup();

    await renderPage();

    expect(requireOrgContext).toHaveBeenCalledTimes(1);
    expect(requireOrgContext).toHaveBeenCalledWith(ORG_ID, [
      "owner",
      "manager",
    ]);
  });

  it("si la guarda corta (404 o salida), no lee ni dibuja nada", async () => {
    vi.mocked(requireOrgContext).mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listCatalogProducts).not.toHaveBeenCalled();
    expect(listCategories).not.toHaveBeenCalled();
  });

  it("tiene un encabezado de nivel 1 'Catálogo'", async () => {
    setup();

    render(await renderPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Catálogo" }),
    ).toBeInTheDocument();
  });

  describe("filtros desde la URL", () => {
    it("sin parámetros busca solo los activos, página 1", async () => {
      setup();

      await renderPage();

      expect(listCatalogProducts).toHaveBeenCalledWith(expect.anything(), {
        q: "",
        status: "active",
        categoryId: null,
        withoutPrice: false,
        page: 1,
      });
    });

    it("lee texto, estado, categoría, 'sin precio' y página de la URL", async () => {
      // 120 productos: la página 2 existe (con una sola no habría página 2).
      setup([product()], { page: { total: 120, page: 2 } });

      await renderPage({
        q: "coca",
        estado: "inactivos",
        categoria: CATEGORY_ID,
        sinPrecio: "1",
        pagina: "2",
      });

      expect(listCatalogProducts).toHaveBeenCalledWith(expect.anything(), {
        q: "coca",
        status: "inactive",
        categoryId: CATEGORY_ID,
        withoutPrice: true,
        page: 2,
      });
    });

    it("el formulario de filtros refleja lo que dice la URL", async () => {
      setup();

      render(
        await renderPage({ q: "coca", estado: "inactivos", sinPrecio: "1" }),
      );

      const filters = screen.getByRole("search", { name: "Filtros" });
      expect(within(filters).getByRole("searchbox")).toHaveValue("coca");
      expect(
        within(filters).getByRole("checkbox", { name: "Solo sin precio" }),
      ).toBeChecked();
      expect(
        within(filters).getByRole("combobox", { name: "Estado" }),
      ).toHaveTextContent("Inactivos");
    });

    it("con otros filtros, el formulario queda con los valores por defecto", async () => {
      setup();

      render(await renderPage());

      const filters = screen.getByRole("search", { name: "Filtros" });
      expect(within(filters).getByRole("searchbox")).toHaveValue("");
      expect(
        within(filters).getByRole("checkbox", { name: "Solo sin precio" }),
      ).not.toBeChecked();
      expect(
        within(filters).getByRole("combobox", { name: "Estado" }),
      ).toHaveTextContent("Activos");
      expect(
        within(filters).getByRole("combobox", { name: "Categoría" }),
      ).toHaveTextContent("Todas");
    });

    it("envía los filtros por GET a la misma página (la URL guarda el estado)", async () => {
      setup();

      render(await renderPage());

      const filters = screen.getByRole("search", { name: "Filtros" });
      expect(filters).toHaveAttribute("method", "get");
      expect(filters).toHaveAttribute("action", `/org/${ORG_ID}/catalogo`);
    });
  });

  describe("tabla de productos", () => {
    it("marca 'Sin precio' con texto en el producto sin precio y no muestra un monto", async () => {
      setup([product({ salePriceCents: null })]);

      render(await renderPage());

      const row = screen.getByRole("row", { name: /Alfajor triple/ });
      expect(within(row).getByText("Sin precio")).toBeVisible();
      expect(within(row).queryByText(/\$/)).not.toBeInTheDocument();
    });

    it("muestra el precio de un producto por unidad sin sufijo", async () => {
      setup([product({ salePriceCents: toCents(120000) })]);

      render(await renderPage());

      const row = screen.getByRole("row", { name: /Alfajor triple/ });
      expect(
        within(row).getByText(plain(formatArs(toCents(120000)))),
      ).toBeVisible();
      expect(within(row).queryByText(/\/ kg/)).not.toBeInTheDocument();
      expect(within(row).queryByText("Sin precio")).not.toBeInTheDocument();
    });

    it("muestra el precio de un producto por peso con el sufijo '/ kg'", async () => {
      setup([
        product({
          id: THIRD_ID,
          name: "Jamón cocido",
          unit: "kg",
          salePriceCents: toCents(1850000),
        }),
      ]);

      render(await renderPage());

      const row = screen.getByRole("row", { name: /Jamón cocido/ });
      expect(
        within(row).getByText(plain(`${formatArs(toCents(1850000))} / kg`)),
      ).toBeVisible();
    });

    it("muestra marca, categoría (o 'Sin categoría') y estado, con el nombre enlazando a la ficha", async () => {
      setup([
        product(),
        product({
          id: THIRD_ID,
          name: "Chicle",
          brand: null,
          categoryId: null,
          status: "inactive",
        }),
      ]);

      render(await renderPage());

      const first = screen.getByRole("row", { name: /Alfajor triple/ });
      expect(within(first).getByText("Havanna")).toBeVisible();
      expect(within(first).getByText("Golosinas")).toBeVisible();
      expect(within(first).getByText("Activo")).toBeVisible();
      expect(
        within(first).getByRole("link", { name: "Alfajor triple" }),
      ).toHaveAttribute("href", `/org/${ORG_ID}/catalogo/${PRODUCT_ID}`);

      const second = screen.getByRole("row", { name: /Chicle/ });
      expect(within(second).getByText("Sin categoría")).toBeVisible();
      expect(within(second).getByText("Inactivo")).toBeVisible();
      expect(
        within(second).getByRole("link", { name: "Chicle" }),
      ).toHaveAttribute("href", `/org/${ORG_ID}/catalogo/${THIRD_ID}`);
    });

    it("muestra el código principal del producto que lo tiene y nada en el que no", async () => {
      setup([
        product({ primaryBarcode: "7790001000019" }),
        product({ id: THIRD_ID, name: "Chicle", primaryBarcode: null }),
      ]);

      render(await renderPage());

      const first = screen.getByRole("row", { name: /Alfajor triple/ });
      expect(within(first).getByText("Código 7790001000019")).toBeVisible();
      const second = screen.getByRole("row", { name: /Chicle/ });
      expect(within(second).queryByText(/Código/)).not.toBeInTheDocument();
    });

    it("el código es texto del producto: se ve igual aunque no tenga marca", async () => {
      setup([product({ brand: null, primaryBarcode: "40000123456" })]);

      render(await renderPage());

      const row = screen.getByRole("row", { name: /Alfajor triple/ });
      expect(within(row).getByText("Código 40000123456")).toBeVisible();
      expect(within(row).queryByText("Havanna")).not.toBeInTheDocument();
    });

    it("no dibuja costo ni datos de administración", async () => {
      setup([product({ referenceCostCents: toCents(80000) })]);

      render(await renderPage());

      expect(screen.queryByText(plain(formatArs(toCents(80000))))).toBeNull();
      expect(screen.queryByText(/costo/i)).toBeNull();
    });
  });

  describe("estados vacíos", () => {
    it("sin productos y sin filtros invita a cargar el primero", async () => {
      setup([]);

      render(await renderPage());

      expect(screen.getByText("Todavía no cargaste productos.")).toBeVisible();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("sin resultados con filtros dice que no hay coincidencias y ofrece limpiar", async () => {
      setup([]);

      render(await renderPage({ q: "zzz" }));

      expect(
        screen.getByText("No encontramos productos con esos filtros."),
      ).toBeVisible();
      expect(
        screen.getByRole("link", { name: "Limpiar filtros" }),
      ).toHaveAttribute("href", `/org/${ORG_ID}/catalogo`);
    });
  });

  describe("una página más allá del final", () => {
    it("lleva a la última página que existe, conservando los filtros", async () => {
      // 120 productos = 3 páginas; se pidió la 9: la consulta no trae filas pero sí el total real.
      setup([], { page: { total: 120, page: 9 } });

      await expect(
        renderPage({ q: "coca", sinPrecio: "1", pagina: "9" }),
      ).rejects.toThrow("NEXT_REDIRECT");

      expect(redirect).toHaveBeenCalledWith(
        `/org/${ORG_ID}/catalogo?q=coca&sinPrecio=1&pagina=3`,
      );
    });

    it("si la última es la primera, lleva a la página 1 sin el parámetro de página", async () => {
      setup([], { page: { total: 30, page: 4 } });

      await expect(renderPage({ pagina: "4" })).rejects.toThrow(
        "NEXT_REDIRECT",
      );

      expect(redirect).toHaveBeenCalledWith(`/org/${ORG_ID}/catalogo`);
    });

    it("sin ningún producto (total 0), vuelve a la página 1 en vez de decir que no hay productos", async () => {
      setup([], { page: { total: 0, page: 2 } });

      await expect(renderPage({ pagina: "2" })).rejects.toThrow(
        "NEXT_REDIRECT",
      );

      expect(redirect).toHaveBeenCalledWith(`/org/${ORG_ID}/catalogo`);
    });

    it("una página que existe no redirige", async () => {
      setup([product()], { page: { total: 120, page: 3 } });

      render(await renderPage({ pagina: "3" }));

      expect(redirect).not.toHaveBeenCalled();
    });

    it("la lista realmente vacía en la página 1 muestra el estado vacío, sin redirigir", async () => {
      setup([], { page: { total: 0, page: 1 } });

      render(await renderPage());

      expect(redirect).not.toHaveBeenCalled();
      expect(screen.getByText("Todavía no cargaste productos.")).toBeVisible();
    });
  });

  describe("acciones de escritura", () => {
    it("con la organización activa ofrece 'Nuevo producto' y 'Categorías'", async () => {
      setup();

      render(await renderPage());

      expect(
        screen.getByRole("link", { name: "Nuevo producto" }),
      ).toHaveAttribute("href", `/org/${ORG_ID}/catalogo/nuevo`);
      expect(screen.getByRole("link", { name: "Categorías" })).toHaveAttribute(
        "href",
        `/org/${ORG_ID}/catalogo/categorias`,
      );
    });

    it("con la organización suspendida no hay 'Nuevo producto' y se aclara el motivo", async () => {
      setup([product()], { writable: false });

      render(await renderPage());

      expect(
        screen.queryByRole("link", { name: "Nuevo producto" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          "La cuenta está suspendida: el catálogo es solo de lectura.",
        ),
      ).toBeVisible();
      // La lectura sigue: el producto se ve.
      expect(
        screen.getByRole("link", { name: "Alfajor triple" }),
      ).toBeVisible();
    });
  });

  describe("paginación", () => {
    it("con una sola página no dibuja la paginación", async () => {
      setup([product()], { page: { total: 1 } });

      render(await renderPage());

      expect(
        screen.queryByRole("navigation", { name: "Paginación" }),
      ).not.toBeInTheDocument();
    });

    it("en la página 2 de 3 enlaza a la anterior y a la siguiente conservando los filtros", async () => {
      setup([product()], { page: { total: 120, page: 2 } });

      render(await renderPage({ q: "coca", sinPrecio: "1", pagina: "2" }));

      const nav = screen.getByRole("navigation", { name: "Paginación" });
      expect(within(nav).getByText("Página 2 de 3")).toBeVisible();
      expect(
        within(nav).getByRole("link", { name: "Anterior" }),
      ).toHaveAttribute("href", `/org/${ORG_ID}/catalogo?q=coca&sinPrecio=1`);
      expect(
        within(nav).getByRole("link", { name: "Siguiente" }),
      ).toHaveAttribute(
        "href",
        `/org/${ORG_ID}/catalogo?q=coca&sinPrecio=1&pagina=3`,
      );
    });

    it("en la primera página no hay 'Anterior' y en la última no hay 'Siguiente'", async () => {
      setup([product()], { page: { total: 120, page: 1 } });
      const first = render(await renderPage());
      const firstNav = screen.getByRole("navigation", { name: "Paginación" });
      expect(
        within(firstNav).queryByRole("link", { name: "Anterior" }),
      ).not.toBeInTheDocument();
      expect(
        within(firstNav).getByRole("link", { name: "Siguiente" }),
      ).toBeVisible();
      first.unmount();

      setup([product()], { page: { total: 120, page: 3 } });
      render(await renderPage({ pagina: "3" }));
      const lastNav = screen.getByRole("navigation", { name: "Paginación" });
      expect(
        within(lastNav).queryByRole("link", { name: "Siguiente" }),
      ).not.toBeInTheDocument();
      expect(
        within(lastNav).getByRole("link", { name: "Anterior" }),
      ).toBeVisible();
    });
  });
});
