import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProductPage from "@/app/(app)/org/[orgId]/catalogo/[productId]/page";
import {
  BARCODE_ID,
  CATEGORY_ID,
  LOCATION_CENTRO,
  LOCATION_ESTE,
  ORG_ID,
  PRODUCT_ID,
  SUPPLIER_ID,
  adminRow,
  makeOrgContext,
} from "@/features/catalog/__tests__/fixtures";
import { toProductView } from "@/features/catalog/domain/product-view";
import type { ProductDetail, ProductDetailAdmin } from "@/features/catalog";
import { getProductDetail } from "@/features/catalog/server";
import { requireOrgContext } from "@/features/tenancy/server";
import { notFound } from "next/navigation";

// Specs catalog-management (ficha, códigos, stock mínimo, desactivar, suspendida,
// 404 uniforme), catalog-price-editing (costo y base, historial, "/ kg"). La
// página llama a la guarda por su cuenta y lee con `getProductDetail`; si no hay
// ficha (id inválido o ajeno) responde `notFound()`.

vi.mock("@/features/tenancy/server", () => ({ requireOrgContext: vi.fn() }));
vi.mock("@/features/catalog/server", () => ({ getProductDetail: vi.fn() }));
vi.mock("@/features/catalog/actions", () => ({
  updateProduct: vi.fn(),
  changeSalePrice: vi.fn(),
  addBarcode: vi.fn(),
  correctBarcode: vi.fn(),
  deactivateProduct: vi.fn(),
  reactivateProduct: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const plain = (text: string) => text.replace(/ /g, " ");

function adminDetail(
  rowOver: Parameters<typeof adminRow>[0] = {},
  over: Partial<ProductDetailAdmin> = {},
): ProductDetailAdmin {
  return {
    access: "admin",
    product: toProductView(adminRow(rowOver), "owner"),
    barcodes: [
      {
        id: BARCODE_ID,
        norm: "7790895000782",
        raw: "7790895000782",
        isPrimary: true,
      },
    ],
    minStocks: [
      {
        locationId: LOCATION_CENTRO,
        locationName: "Local Centro",
        minStockMilli: 10000,
      },
      {
        locationId: LOCATION_ESTE,
        locationName: "Local Este",
        minStockMilli: null,
      },
    ],
    categories: [{ id: CATEGORY_ID, name: "Golosinas" }],
    suppliers: [{ id: SUPPLIER_ID, name: "Distribuidora del Norte" }],
    priceHistory: [
      {
        id: "h2",
        changedAtLabel: "28/10/2026 10:30",
        oldPriceLabel: "$ 9,00",
        newPriceLabel: "$ 10,00",
        sourceLabel: "Cambio manual",
        actorLabel: "Otra persona",
      },
      {
        id: "h1",
        changedAtLabel: "01/10/2026 09:00",
        oldPriceLabel: "—",
        newPriceLabel: "$ 9,00",
        sourceLabel: "Importación",
        actorLabel: "Sistema",
      },
    ],
    ...over,
  };
}

function renderPage(
  productId: string = PRODUCT_ID,
  searchParams: Record<string, string | string[] | undefined> = {},
) {
  return ProductPage({
    params: Promise.resolve({ orgId: ORG_ID, productId }),
    searchParams: Promise.resolve(searchParams),
  });
}

function setup(detail: ProductDetail | null, writable = true) {
  vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext({ writable }));
  vi.mocked(getProductDetail).mockResolvedValue(detail);
}

beforeEach(() => {
  vi.mocked(requireOrgContext).mockReset();
  vi.mocked(getProductDetail).mockReset();
  vi.mocked(notFound).mockClear();
});

describe("página /org/[orgId]/catalogo/[productId]", () => {
  describe("acceso", () => {
    it("llama a requireOrgContext por su cuenta, solo para dueño y encargado", async () => {
      setup(adminDetail());

      await renderPage();

      expect(requireOrgContext).toHaveBeenCalledWith(ORG_ID, [
        "owner",
        "manager",
      ]);
    });

    it("si la guarda corta (404 o salida), no lee el producto", async () => {
      vi.mocked(requireOrgContext).mockRejectedValue(
        new Error("NEXT_NOT_FOUND"),
      );

      await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(getProductDetail).not.toHaveBeenCalled();
    });

    it("lee la ficha con el contexto y el id de la URL, tal cual (lo valida la lectura)", async () => {
      setup(adminDetail());

      await renderPage("no-es-un-uuid");

      expect(getProductDetail).toHaveBeenCalledWith(
        expect.objectContaining({ role: "owner" }),
        "no-es-un-uuid",
      );
    });

    it("sin ficha (id inválido, inexistente o de otra organización) responde notFound()", async () => {
      setup(null);

      await expect(renderPage("no-es-un-uuid")).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
      expect(notFound).toHaveBeenCalledTimes(1);
    });

    it("una ficha básica (de empleado) nunca se dibuja: notFound()", async () => {
      const basic: ProductDetail = {
        access: "basic",
        product: {
          id: PRODUCT_ID,
          name: "Alfajor triple",
          brand: null,
          categoryId: null,
          unit: "unit",
          status: "active",
          tracksStock: true,
          tracksExpiry: false,
          salePriceCents: 100000,
          salePriceUpdatedAt: null,
        },
        barcodes: [],
        minStocks: [],
        categories: [],
      };
      setup(basic);

      await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    });
  });

  describe("contenido", () => {
    it("el encabezado de nivel 1 es el nombre del producto, con un enlace para volver", async () => {
      setup(adminDetail());

      render(await renderPage());

      expect(
        screen.getByRole("heading", { level: 1, name: "Alfajor triple" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Volver al catálogo" }),
      ).toHaveAttribute("href", `/org/${ORG_ID}/catalogo`);
    });

    it("arma el formulario con los datos y el stock mínimo por local", async () => {
      setup(adminDetail());

      render(await renderPage());

      expect(screen.getByLabelText("Nombre")).toHaveValue("Alfajor triple");
      expect(screen.getByLabelText("Marca")).toHaveValue("Havanna");
      expect(screen.getByLabelText("Stock mínimo en Local Centro")).toHaveValue(
        "10",
      );
      expect(screen.getByLabelText("Stock mínimo en Local Este")).toHaveValue(
        "",
      );
    });

    it("lista los códigos de barras con el principal marcado", async () => {
      setup(adminDetail());

      render(await renderPage());

      const list = screen.getByRole("list", { name: "Códigos de barras" });
      expect(within(list).getByText("7790895000782")).toBeVisible();
      expect(within(list).getByText("Principal")).toBeVisible();
    });

    it("muestra el panel de precio con el costo y su base", async () => {
      setup(adminDetail());

      render(await renderPage());

      expect(screen.getByText("Precio actual")).toBeVisible();
      expect(
        screen.getByText(plain("Costo de referencia (importado): $ 800,00")),
      ).toBeVisible();
    });

    it("sin precio muestra 'Sin precio' en el encabezado y ofrece 'Poner precio'", async () => {
      setup(adminDetail({ sale_price: null }));

      render(await renderPage());

      const header = screen.getByRole("group", { name: "Estado del producto" });
      expect(within(header).getByText("Sin precio")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Poner precio" }),
      ).toBeVisible();
    });

    it("un producto por peso muestra su precio con '/ kg'", async () => {
      setup(adminDetail({ unit: "kg", sale_price: 18500 }));

      render(await renderPage());

      const header = screen.getByRole("group", { name: "Estado del producto" });
      expect(within(header).getByText(plain("$ 18.500,00 / kg"))).toBeVisible();
    });

    it("sin costo, el panel de precio dice que no se puede calcular el margen", async () => {
      setup(adminDetail({ reference_cost: null, reference_cost_source: null }));

      render(await renderPage());

      expect(
        screen.getAllByText("Sin costo: no se puede calcular el margen").length,
      ).toBeGreaterThan(0);
    });

    it("muestra el historial con 'Otra persona' y 'Sistema'", async () => {
      setup(adminDetail());

      render(await renderPage());

      const history = screen.getByRole("region", {
        name: "Historial de precios",
      });
      expect(within(history).getByText("Otra persona")).toBeVisible();
      expect(within(history).getByText("Sistema")).toBeVisible();
      expect(within(history).getAllByRole("row")).toHaveLength(3);
    });

    it("muestra el botón de venta rápida en solo lectura", async () => {
      setup(adminDetail({ quick_sale_position: 3, quick_sale_label: "Pan" }));

      render(await renderPage());

      const region = screen.getByRole("region", { name: "Venta rápida" });
      expect(within(region).getByText("Botón 3: Pan")).toBeVisible();
      expect(within(region).queryByRole("button")).not.toBeInTheDocument();
      expect(within(region).queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("sin botón de venta rápida lo dice", async () => {
      setup(adminDetail({ quick_sale_position: null, quick_sale_label: null }));

      render(await renderPage());

      const region = screen.getByRole("region", { name: "Venta rápida" });
      expect(
        within(region).getByText(
          "Este producto no tiene botón de venta rápida.",
        ),
      ).toBeVisible();
    });

    it("un producto inactivo lo marca y ofrece reactivar", async () => {
      setup(adminDetail({ status: "inactive" }));

      render(await renderPage());

      const header = screen.getByRole("group", { name: "Estado del producto" });
      expect(within(header).getByText("Inactivo")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Reactivar producto" }),
      ).toBeVisible();
    });

    it("un producto activo ofrece desactivar", async () => {
      setup(adminDetail());

      render(await renderPage());

      expect(
        screen.getByRole("button", { name: "Desactivar producto" }),
      ).toBeEnabled();
    });
  });

  describe("avisos de un alta (?avisos=)", () => {
    const EAN = "7790895000782";
    const EAN_2 = "7790895000799";

    it("sin el parámetro no dibuja ningún aviso", async () => {
      setup(adminDetail());

      render(await renderPage());

      expect(screen.queryByText(/El producto se creó/)).not.toBeInTheDocument();
    });

    it("muestra, en castellano, cada aviso válido que trae la URL", async () => {
      setup(adminDetail());

      render(
        await renderPage(PRODUCT_ID, {
          avisos: `CA-E02:${EAN},invalid_check_digit:${EAN_2}`,
        }),
      );

      const notice = screen.getByRole("status");
      expect(notice).toHaveTextContent("El producto se creó");
      expect(notice).toHaveTextContent(
        `El código ${EAN} no se cargó: ese código ya es de otro producto.`,
      );
      expect(notice).toHaveTextContent(
        `El código ${EAN_2}: el dígito verificador no coincide`,
      );
      expect(within(notice).getAllByRole("listitem")).toHaveLength(2);
    });

    it.each([
      ["texto libre", "<b>hola</b>"],
      ["un aviso inventado", `CA-E99:${EAN}`],
      ["un código de barras con letras", "CA-E02:abc"],
      ["un parámetro vacío", ""],
    ])("ignora %s: no dibuja el aviso", async (_label, avisos) => {
      setup(adminDetail());

      render(await renderPage(PRODUCT_ID, { avisos }));

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByText(/hola/)).not.toBeInTheDocument();
    });

    it("de una lista mezclada muestra solo los avisos válidos", async () => {
      setup(adminDetail());

      render(
        await renderPage(PRODUCT_ID, {
          avisos: `basura,CA-E02:${EAN},CA-E99:${EAN_2}`,
        }),
      );

      const notice = screen.getByRole("status");
      expect(within(notice).getAllByRole("listitem")).toHaveLength(1);
      expect(notice).toHaveTextContent(EAN);
      expect(notice).not.toHaveTextContent(EAN_2);
    });
  });

  it("con la organización suspendida se ve todo y no se puede escribir", async () => {
    setup(adminDetail(), false);

    render(await renderPage());

    expect(screen.getByLabelText("Nombre")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Cambiar precio" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Desactivar producto" }),
    ).toBeDisabled();
    expect(screen.queryByLabelText("Nuevo código")).not.toBeInTheDocument();
    // Los datos siguen a la vista.
    expect(screen.getByText("7790895000782")).toBeVisible();
  });

  it("no manda a los componentes cliente nada que no dibujen (props mínimas, sin filas)", async () => {
    setup(adminDetail());

    const tree = await renderPage();

    // Las props que la página le pasa a sus hijos no llevan columnas de la base.
    const keys = propKeys(tree, new Set());
    for (const column of [
      "reference_cost",
      "sale_price",
      "preferred_supplier_id",
      "organization_id",
    ]) {
      expect(keys).not.toContain(column);
    }
    expect(keys).toContain("referenceCostCents");
  });
});

// Todas las claves de las props (y de los objetos adentro) de un árbol de React.
function propKeys(node: unknown, seen: Set<unknown>): string[] {
  if (typeof node !== "object" || node === null || seen.has(node)) return [];
  seen.add(node);
  if (Array.isArray(node)) return node.flatMap((item) => propKeys(item, seen));
  const record = node as Record<string, unknown>;
  if ("props" in record && "$$typeof" in record) {
    return propKeys(record.props, seen);
  }
  return Object.entries(record).flatMap(([key, value]) => [
    key,
    ...propKeys(value, seen),
  ]);
}
