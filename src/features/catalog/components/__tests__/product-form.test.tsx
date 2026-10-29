import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProduct, updateProduct } from "../../actions";
import {
  CATEGORY_ID,
  LOCATION_CENTRO,
  LOCATION_ESTE,
  ORG_ID,
  PRODUCT_ID,
  SUPPLIER_ID,
  adminRow,
} from "../../__tests__/fixtures";
import { catalogError } from "../../domain/errors";
import { toProductView } from "../../domain/product-view";
import { err, ok } from "@/shared/lib/result";
import { toQuantityMilli } from "@/shared/lib/money";

import { ProductForm } from "../product-form";
import type { ProductFormProduct } from "../product-form";

// Specs catalog-management "Alta de producto por dueño o encargado", "Stock mínimo
// por local", "Edición de producto" y catalog-price-editing "Margen y aviso por
// debajo del costo". Se simulan las Server Actions y el router (los límites).

// Los flujos largos (muchos campos y listas desplegables escritos tecla por tecla)
// pasan los 5 s por defecto cuando corren muchos archivos en paralelo.
vi.setConfig({ testTimeout: 20_000 });

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../actions", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

const CATEGORIES = [{ id: CATEGORY_ID, name: "Golosinas" }];
const SUPPLIERS = [{ id: SUPPLIER_ID, name: "Distribuidora del Norte" }];
const NEW_PRODUCT_ID = "00000000-0000-4000-8000-00000000c0aa";
const BLANK_STOCKS = [
  {
    locationId: LOCATION_CENTRO,
    locationName: "Local Centro",
    minStockMilli: null,
  },
  {
    locationId: LOCATION_ESTE,
    locationName: "Local Este",
    minStockMilli: null,
  },
];

const createdView = toProductView(
  adminRow({ id: NEW_PRODUCT_ID, name: "Agua Mineral 2 L" }),
  "owner",
);

function renderCreate(over: { writable?: boolean } = {}) {
  return render(
    <ProductForm
      orgId={ORG_ID}
      writable={over.writable ?? true}
      categories={CATEGORIES}
      suppliers={SUPPLIERS}
      minStocks={BLANK_STOCKS}
    />,
  );
}

const EDITING: ProductFormProduct = {
  id: PRODUCT_ID,
  name: "Alfajor triple",
  brand: "Havanna",
  categoryId: CATEGORY_ID,
  unit: "unit",
  tracksStock: true,
  tracksExpiry: true,
  referenceCostCents: 80000,
  referenceCostSource: "import",
  preferredSupplierId: SUPPLIER_ID,
};

/** Lo que `renderEdit` mostraba al abrirse (mínimo del Local Centro: 10). */
const LOADED_SNAPSHOT = {
  name: "Alfajor triple",
  brand: "Havanna",
  categoryId: CATEGORY_ID,
  unit: "unit",
  tracksStock: true,
  tracksExpiry: true,
  referenceCostCents: 80000,
  preferredSupplierId: SUPPLIER_ID,
  minStocks: { [LOCATION_CENTRO]: 10000, [LOCATION_ESTE]: null },
} as const;

function renderEdit(
  over: { writable?: boolean; product?: ProductFormProduct } = {},
) {
  return render(
    <ProductForm
      orgId={ORG_ID}
      writable={over.writable ?? true}
      categories={CATEGORIES}
      suppliers={SUPPLIERS}
      minStocks={[
        { ...BLANK_STOCKS[0]!, minStockMilli: toQuantityMilli(10) },
        BLANK_STOCKS[1]!,
      ]}
      product={over.product ?? EDITING}
    />,
  );
}

async function choose(user: UserEvent, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

const save = () => screen.getByRole("button", { name: /^Guardar|^Guardando/ });

beforeEach(() => {
  vi.mocked(createProduct).mockReset();
  vi.mocked(updateProduct).mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});

describe("ProductForm (alta)", () => {
  it("dibuja los campos del alta, con sus etiquetas", () => {
    renderCreate();

    for (const label of [
      "Nombre",
      "Marca",
      "Precio de venta",
      "Costo de referencia",
      "Código de barras 1",
      "Stock mínimo en Local Centro",
      "Stock mínimo en Local Este",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    for (const label of ["Categoría", "Unidad", "Proveedor habitual"]) {
      expect(screen.getByRole("combobox", { name: label })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("checkbox", { name: "Controla stock" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Controla vencimientos" }),
    ).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "Proveedor habitual" }),
    ).toHaveTextContent("Sin proveedor");
    expect(
      screen.getByRole("combobox", { name: "Categoría" }),
    ).toHaveTextContent("Sin categoría");
  });

  describe("stock mínimo y vencimiento", () => {
    it("sin controlar stock desaparecen los mínimos y el vencimiento queda deshabilitado y apagado", async () => {
      const user = userEvent.setup();
      renderCreate();

      await user.click(
        screen.getByRole("checkbox", { name: "Controla stock" }),
      );

      expect(
        screen.queryByLabelText(/^Stock mínimo en/),
      ).not.toBeInTheDocument();
      const expiry = screen.getByRole("checkbox", {
        name: "Controla vencimientos",
      });
      expect(expiry).toBeDisabled();
      expect(expiry).not.toBeChecked();
    });

    it("al volver a controlar stock vuelven los mínimos y el vencimiento se puede elegir", async () => {
      const user = userEvent.setup();
      renderCreate();
      const stock = screen.getByRole("checkbox", { name: "Controla stock" });

      await user.click(stock);
      await user.click(stock);

      expect(
        screen.getByLabelText("Stock mínimo en Local Centro"),
      ).toBeVisible();
      expect(
        screen.getByRole("checkbox", { name: "Controla vencimientos" }),
      ).toBeEnabled();
    });

    it("el pedido de un producto sin stock lleva vencimiento apagado y ningún mínimo", async () => {
      const user = userEvent.setup();
      vi.mocked(createProduct).mockResolvedValue(
        ok({ product: createdView, warnings: [] }),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Servicio");
      await user.type(
        screen.getByLabelText("Stock mínimo en Local Centro"),
        "5",
      );
      await user.click(
        screen.getByRole("checkbox", { name: "Controla stock" }),
      );
      await user.click(save());

      await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
      expect(createProduct).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({
          tracksStock: false,
          tracksExpiry: false,
          minStocks: {},
        }),
      );
    });
  });

  describe("margen en vivo", () => {
    it("con costo y precio muestra el margen y no avisa", async () => {
      const user = userEvent.setup();
      renderCreate();

      await user.type(screen.getByLabelText("Costo de referencia"), "800");
      await user.type(screen.getByLabelText("Precio de venta"), "1000");

      expect(screen.getByText("Margen: 20,0 %")).toBeVisible();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("por debajo del costo avisa, y 'Guardar' sigue habilitado", async () => {
      const user = userEvent.setup();
      renderCreate();

      await user.type(screen.getByLabelText("Costo de referencia"), "800");
      await user.type(screen.getByLabelText("Precio de venta"), "750");

      expect(screen.getByText("Margen: -6,7 %")).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent(
        /El precio queda por debajo del costo/,
      );
      expect(save()).toBeEnabled();
    });

    it("sin costo dice que no se puede calcular y no avisa", async () => {
      const user = userEvent.setup();
      renderCreate();

      await user.type(screen.getByLabelText("Precio de venta"), "750");

      expect(
        screen.getByText("Sin costo: no se puede calcular el margen"),
      ).toBeVisible();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("un producto por peso muestra el sufijo '/ kg' en el aviso", async () => {
      const user = userEvent.setup();
      renderCreate();

      await choose(user, "Unidad", "Por kilo");
      await user.type(screen.getByLabelText("Costo de referencia"), "800");
      await user.type(screen.getByLabelText("Precio de venta"), "750");

      expect(screen.getByRole("status")).toHaveTextContent("/ kg");
    });
  });

  describe("guardar", () => {
    it("manda el pedido completo y va a la ficha del producto creado", async () => {
      const user = userEvent.setup();
      vi.mocked(createProduct).mockResolvedValue(
        ok({ product: createdView, warnings: [] }),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Agua Mineral 2 L");
      await user.type(screen.getByLabelText("Marca"), "Villavicencio");
      await choose(user, "Categoría", "Golosinas");
      await choose(user, "Proveedor habitual", "Distribuidora del Norte");
      await user.type(screen.getByLabelText("Precio de venta"), "1200");
      await user.type(screen.getByLabelText("Costo de referencia"), "800");
      await user.type(
        screen.getByLabelText("Código de barras 1"),
        "7790895000782",
      );
      await user.type(
        screen.getByLabelText("Stock mínimo en Local Centro"),
        "6",
      );
      await user.click(save());

      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      expect(createProduct).toHaveBeenCalledWith(ORG_ID, {
        name: "Agua Mineral 2 L",
        brand: "Villavicencio",
        categoryId: CATEGORY_ID,
        unit: "unit",
        tracksStock: true,
        tracksExpiry: true,
        salePriceCents: 120000,
        referenceCostCents: 80000,
        preferredSupplierId: SUPPLIER_ID,
        barcodes: ["7790895000782"],
        minStocks: { [LOCATION_CENTRO]: 6000, [LOCATION_ESTE]: null },
      });
      expect(router.push).toHaveBeenCalledWith(
        `/org/${ORG_ID}/catalogo/${NEW_PRODUCT_ID}`,
      );
    });

    it("con lo mínimo (solo el nombre) manda campos vacíos como null, sin códigos", async () => {
      const user = userEvent.setup();
      vi.mocked(createProduct).mockResolvedValue(
        ok({ product: createdView, warnings: [] }),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.click(save());

      await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
      expect(createProduct).toHaveBeenCalledWith(ORG_ID, {
        name: "Chicle",
        brand: null,
        categoryId: null,
        unit: "unit",
        tracksStock: true,
        tracksExpiry: true,
        salePriceCents: null,
        referenceCostCents: null,
        preferredSupplierId: null,
        barcodes: [],
        minStocks: { [LOCATION_CENTRO]: null, [LOCATION_ESTE]: null },
      });
    });

    it("se puede agregar y quitar renglones de códigos de barras", async () => {
      const user = userEvent.setup();
      vi.mocked(createProduct).mockResolvedValue(
        ok({ product: createdView, warnings: [] }),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.click(
        screen.getByRole("button", { name: "Agregar otro código" }),
      );
      await user.type(
        screen.getByLabelText("Código de barras 1"),
        "7790895000782",
      );
      await user.type(screen.getByLabelText("Código de barras 2"), "77908950");
      await user.click(screen.getByRole("button", { name: "Quitar código 1" }));

      expect(
        screen.queryByLabelText("Código de barras 2"),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText("Código de barras 1")).toHaveValue(
        "77908950",
      );

      await user.click(save());
      await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
      expect(createProduct).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ barcodes: ["77908950"] }),
      );
    });

    it("mientras guarda deshabilita el botón y cambia su texto", async () => {
      const user = userEvent.setup();
      let finish: (
        value: Awaited<ReturnType<typeof createProduct>>,
      ) => void = () => {};
      vi.mocked(createProduct).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.click(save());

      const busy = await screen.findByRole("button", { name: "Guardando…" });
      expect(busy).toBeDisabled();

      finish(ok({ product: createdView, warnings: [] }));
      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    });

    it("un stock mínimo que no es una cantidad se marca en su campo y no se manda", async () => {
      const user = userEvent.setup();
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.type(
        screen.getByLabelText("Stock mínimo en Local Centro"),
        "abc",
      );
      await user.click(save());

      const field = screen.getByLabelText("Stock mínimo en Local Centro");
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(/cantidad/i);
      expect(createProduct).not.toHaveBeenCalled();
    });

    it("con la organización suspendida no se puede guardar y se explica por qué", () => {
      renderCreate({ writable: false });

      expect(save()).toBeDisabled();
      expect(
        screen.getByText(
          "La cuenta está suspendida: el catálogo es solo de lectura.",
        ),
      ).toBeVisible();
    });
  });

  describe("errores del servidor", () => {
    it("CA-E01: marca cada campo con su mensaje y no navega", async () => {
      const user = userEvent.setup();
      vi.mocked(createProduct).mockResolvedValue(
        err(
          catalogError("CA-E01", {
            fieldErrors: {
              name: "Escribí el nombre del producto.",
              "barcodes.0": "El código tiene que tener solo números.",
              [`minStocks.${LOCATION_ESTE}`]:
                "Para un producto por unidad el stock mínimo tiene que ser un número entero.",
            },
          }),
        ),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Código de barras 1"), "abc");
      await user.click(save());

      const name = await screen.findByLabelText("Nombre");
      await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
      expect(name).toHaveAccessibleDescription(
        "Escribí el nombre del producto.",
      );
      expect(
        screen.getByLabelText("Código de barras 1"),
      ).toHaveAccessibleDescription("El código tiene que tener solo números.");
      expect(
        screen.getByLabelText("Stock mínimo en Local Este"),
      ).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Revisá los datos marcados.",
      );
      expect(router.push).not.toHaveBeenCalled();
    });

    it("CA-E01 en un monto: el error aparece en el campo de dinero", async () => {
      const user = userEvent.setup();
      vi.mocked(createProduct).mockResolvedValue(
        err(
          catalogError("CA-E01", {
            fieldErrors: { salePriceCents: "El monto es demasiado grande." },
          }),
        ),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.click(save());

      const price = await screen.findByLabelText("Precio de venta");
      await waitFor(() =>
        expect(price).toHaveAttribute("aria-invalid", "true"),
      );
      expect(price).toHaveAccessibleDescription(
        "El monto es demasiado grande.",
      );
    });

    it("CA-E02: muestra el mensaje del código ya usado, con el producto que lo tiene", async () => {
      const user = userEvent.setup();
      const message = "El código 7790895000782 ya es de «Alfajor triple».";
      vi.mocked(createProduct).mockResolvedValue(
        err(
          catalogError("CA-E02", {
            message,
            fieldErrors: { "barcodes.0": message },
          }),
        ),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.type(
        screen.getByLabelText("Código de barras 1"),
        "7790895000782",
      );
      await user.click(save());

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByLabelText("Código de barras 1")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(router.push).not.toHaveBeenCalled();
    });

    it.each([
      ["CA-E04", "No tenés permiso para hacer esto."],
      ["CA-E05", "La cuenta está suspendida: el catálogo es solo de lectura."],
      ["CA-E10", "No se pudo guardar. Probá de nuevo en un momento."],
    ] as const)(
      "%s: muestra el mensaje tal cual lo manda el servidor",
      async (code, message) => {
        const user = userEvent.setup();
        vi.mocked(createProduct).mockResolvedValue(err(catalogError(code)));
        renderCreate();

        await user.type(screen.getByLabelText("Nombre"), "Chicle");
        await user.click(save());

        expect(await screen.findByRole("alert")).toHaveTextContent(message);
        await waitFor(() => expect(save()).toBeEnabled());
      },
    );

    it("con un aviso (código que no se pudo cargar) igual va a la ficha, llevando solo el código del aviso y el de barras", async () => {
      const user = userEvent.setup();
      vi.mocked(createProduct).mockResolvedValue(
        ok({
          product: createdView,
          warnings: [
            {
              code: "CA-E02",
              barcode: "7790895000782",
              message:
                "El código 7790895000782 no se cargó: ese código ya es de otro producto.",
            },
            {
              code: "invalid_check_digit",
              barcode: "7790895000799",
              message: "El dígito verificador no coincide.",
            },
          ],
        }),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.click(save());

      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      const [href] = router.push.mock.calls[0] as [string];
      const url = new URL(href, "http://localhost");
      expect(url.pathname).toBe(`/org/${ORG_ID}/catalogo/${NEW_PRODUCT_ID}`);
      expect(url.searchParams.get("avisos")).toBe(
        "CA-E02:7790895000782,invalid_check_digit:7790895000799",
      );
      // Ningún texto de aviso viaja en la URL.
      expect(href).not.toMatch(/no se carg|verificador/i);
    });

    it.each([
      ["sin avisos", []],
      [
        "con un aviso",
        [{ code: "CA-E02", barcode: "7790895000782", message: "x" }],
      ],
    ] as const)(
      "tras crear (%s) el botón no deja crear dos veces el mismo producto",
      async (_label, warnings) => {
        const user = userEvent.setup();
        vi.mocked(createProduct).mockResolvedValue(
          ok({ product: createdView, warnings: [...warnings] }),
        );
        renderCreate();

        await user.type(screen.getByLabelText("Nombre"), "Chicle");
        await user.click(save());

        await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
        expect(save()).toBeDisabled();
        await user.click(save());
        expect(createProduct).toHaveBeenCalledTimes(1);
        // Los avisos se muestran en la ficha, no en este formulario.
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      },
    );

    it("un monto mal escrito en el precio no se manda: se marca con su motivo y no se crea el producto", async () => {
      const user = userEvent.setup();
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.type(screen.getByLabelText("Precio de venta"), "12a");
      await user.click(save());

      const price = screen.getByLabelText("Precio de venta");
      expect(createProduct).not.toHaveBeenCalled();
      expect(price).toHaveAttribute("aria-invalid", "true");
      expect(price).toHaveAccessibleDescription(
        "Escribí un monto, por ejemplo 1.250,50",
      );
      expect(price).toHaveFocus();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Revisá los datos marcados.",
      );
    });

    it("lo mismo con un costo mal escrito, y se marcan los dos montos si los dos están mal", async () => {
      const user = userEvent.setup();
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.type(screen.getByLabelText("Precio de venta"), "1,234");
      await user.type(screen.getByLabelText("Costo de referencia"), "-5");
      await user.click(save());

      expect(createProduct).not.toHaveBeenCalled();
      expect(
        screen.getByLabelText("Precio de venta"),
      ).toHaveAccessibleDescription("Usá hasta 2 decimales");
      expect(
        screen.getByLabelText("Costo de referencia"),
      ).toHaveAccessibleDescription("El monto no puede ser negativo");
      // El foco va al primero que está mal.
      expect(screen.getByLabelText("Precio de venta")).toHaveFocus();
    });

    it("al corregir el monto se va el error y se puede guardar", async () => {
      const user = userEvent.setup();
      vi.mocked(createProduct).mockResolvedValue(
        ok({ product: createdView, warnings: [] }),
      );
      renderCreate();
      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.type(screen.getByLabelText("Precio de venta"), "12a");
      await user.click(save());

      await user.clear(screen.getByLabelText("Precio de venta"));
      await user.type(screen.getByLabelText("Precio de venta"), "1200");
      expect(screen.getByLabelText("Precio de venta")).not.toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await user.click(save());

      await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
      expect(createProduct).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ salePriceCents: 120000 }),
      );
    });

    it("un renglón de código en blanco no corre los errores: el error del servidor queda en el renglón que lo causó", async () => {
      const user = userEvent.setup();
      const message = "El código 7790895000782 ya es de «Alfajor triple».";
      vi.mocked(createProduct).mockResolvedValue(
        err(
          catalogError("CA-E02", {
            message,
            // El servidor numera la lista que recibió: sin el renglón en blanco.
            fieldErrors: { "barcodes.0": message },
          }),
        ),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      await user.click(
        screen.getByRole("button", { name: "Agregar otro código" }),
      );
      await user.type(
        screen.getByLabelText("Código de barras 2"),
        "7790895000782",
      );
      await user.click(save());

      await waitFor(() =>
        expect(screen.getByLabelText("Código de barras 2")).toHaveAttribute(
          "aria-invalid",
          "true",
        ),
      );
      expect(createProduct).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ barcodes: ["7790895000782"] }),
      );
      expect(
        screen.getByLabelText("Código de barras 2"),
      ).toHaveAccessibleDescription(message);
      expect(screen.getByLabelText("Código de barras 1")).not.toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("con varios renglones en blanco intercalados cada error vuelve a su renglón", async () => {
      const user = userEvent.setup();
      vi.mocked(createProduct).mockResolvedValue(
        err(
          catalogError("CA-E01", {
            fieldErrors: {
              "barcodes.0": "El código tiene que tener solo números.",
              "barcodes.1": "Este código está repetido en el formulario.",
            },
          }),
        ),
      );
      renderCreate();

      await user.type(screen.getByLabelText("Nombre"), "Chicle");
      const add = screen.getByRole("button", { name: "Agregar otro código" });
      await user.click(add);
      await user.click(add);
      await user.click(add);
      // Renglones: 1 en blanco, 2 con código, 3 en blanco, 4 con código.
      await user.type(screen.getByLabelText("Código de barras 2"), "abc");
      await user.type(screen.getByLabelText("Código de barras 4"), "abc");
      await user.click(save());

      await waitFor(() =>
        expect(screen.getByLabelText("Código de barras 2")).toHaveAttribute(
          "aria-invalid",
          "true",
        ),
      );
      expect(
        screen.getByLabelText("Código de barras 2"),
      ).toHaveAccessibleDescription("El código tiene que tener solo números.");
      expect(
        screen.getByLabelText("Código de barras 4"),
      ).toHaveAccessibleDescription(
        "Este código está repetido en el formulario.",
      );
      for (const blank of ["Código de barras 1", "Código de barras 3"]) {
        expect(screen.getByLabelText(blank)).not.toHaveAttribute(
          "aria-invalid",
          "true",
        );
      }
    });
  });
});

describe("ProductForm (edición)", () => {
  it("arranca con los datos del producto y sin campos de precio ni de códigos", () => {
    renderEdit();

    expect(screen.getByLabelText("Nombre")).toHaveValue("Alfajor triple");
    expect(screen.getByLabelText("Marca")).toHaveValue("Havanna");
    expect(screen.getByLabelText("Costo de referencia")).toHaveValue("800,00");
    expect(
      screen.getByRole("combobox", { name: "Categoría" }),
    ).toHaveTextContent("Golosinas");
    expect(
      screen.getByRole("combobox", { name: "Proveedor habitual" }),
    ).toHaveTextContent("Distribuidora del Norte");
    expect(screen.getByLabelText("Stock mínimo en Local Centro")).toHaveValue(
      "10",
    );
    expect(screen.getByLabelText("Stock mínimo en Local Este")).toHaveValue("");
    expect(screen.queryByLabelText("Precio de venta")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/^Código de barras/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Costo de referencia (importado)")).toBeVisible();
  });

  it("guarda con el id del producto y los mínimos por local, y refresca la ficha", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProduct).mockResolvedValue(
      ok({ product: toProductView(adminRow(), "owner") }),
    );
    renderEdit();

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Alfajor triple negro");
    await user.clear(screen.getByLabelText("Stock mínimo en Local Centro"));
    await user.type(
      screen.getByLabelText("Stock mínimo en Local Centro"),
      "12",
    );
    await user.click(save());

    expect(await screen.findByText("Cambios guardados.")).toBeVisible();
    expect(updateProduct).toHaveBeenCalledWith(ORG_ID, {
      productId: PRODUCT_ID,
      name: "Alfajor triple negro",
      brand: "Havanna",
      categoryId: CATEGORY_ID,
      unit: "unit",
      tracksStock: true,
      tracksExpiry: true,
      referenceCostCents: 80000,
      preferredSupplierId: SUPPLIER_ID,
      minStocks: { [LOCATION_CENTRO]: 12000, [LOCATION_ESTE]: null },
      // Lo que la ficha mostraba al abrirse: el servidor compara contra esto.
      loaded: LOADED_SNAPSHOT,
    });
    expect(router.refresh).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("tras guardar, lo guardado pasa a ser lo visto: el siguiente guardado compara contra eso", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProduct).mockResolvedValue(
      ok({
        product: toProductView(
          adminRow({ name: "Alfajor negro", tracks_expiry: true }),
          "owner",
        ),
      }),
    );
    renderEdit();

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Alfajor negro");
    await user.clear(screen.getByLabelText("Stock mínimo en Local Centro"));
    await user.type(
      screen.getByLabelText("Stock mínimo en Local Centro"),
      "12",
    );
    await user.click(save());
    await screen.findByText("Cambios guardados.");
    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());

    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(2));
    expect(updateProduct).toHaveBeenLastCalledWith(
      ORG_ID,
      expect.objectContaining({
        name: "Alfajor negro",
        loaded: {
          ...LOADED_SNAPSHOT,
          name: "Alfajor negro",
          minStocks: { [LOCATION_CENTRO]: 12000, [LOCATION_ESTE]: null },
        },
      }),
    );
  });

  it("tras guardar muestra lo que devolvió el servidor, no lo que la persona escribió: lo que otra persona cambió en el medio se ve y se respeta", async () => {
    const user = userEvent.setup();
    // Mientras tanto, otra persona cambió la marca (y el servidor la conservó).
    vi.mocked(updateProduct).mockResolvedValue(
      ok({
        product: toProductView(
          adminRow({
            name: "Alfajor negro",
            brand: "Arcor",
            tracks_expiry: true,
          }),
          "owner",
        ),
      }),
    );
    renderEdit();

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Alfajor negro");
    await user.click(save());
    await screen.findByText("Cambios guardados.");

    // La pantalla muestra la marca del servidor, no la que se vio al abrir.
    expect(screen.getByLabelText("Marca")).toHaveValue("Arcor");
    expect(screen.getByLabelText("Nombre")).toHaveValue("Alfajor negro");

    // Y el siguiente guardado compara contra lo que devolvió el servidor.
    await waitFor(() => expect(save()).toBeEnabled());
    await user.type(screen.getByLabelText("Nombre"), " XL");
    await user.click(save());
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(2));
    expect(updateProduct).toHaveBeenLastCalledWith(
      ORG_ID,
      expect.objectContaining({
        name: "Alfajor negro XL",
        brand: "Arcor",
        loaded: expect.objectContaining({
          name: "Alfajor negro",
          brand: "Arcor",
        }),
      }),
    );
  });

  it("tras guardar toma del servidor también el costo y su origen, y deja los mínimos que se guardaron", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProduct).mockResolvedValue(
      ok({
        product: toProductView(
          adminRow({
            reference_cost: 900,
            reference_cost_source: "manual",
            tracks_expiry: true,
          }),
          "owner",
        ),
      }),
    );
    renderEdit();

    await user.clear(screen.getByLabelText("Costo de referencia"));
    await user.type(screen.getByLabelText("Costo de referencia"), "900");
    await user.clear(screen.getByLabelText("Stock mínimo en Local Centro"));
    await user.type(
      screen.getByLabelText("Stock mínimo en Local Centro"),
      "12",
    );
    await user.click(save());
    await screen.findByText("Cambios guardados.");

    expect(screen.getByLabelText("Costo de referencia")).toHaveValue("900,00");
    expect(screen.getByText("Costo de referencia (manual)")).toBeVisible();
    expect(screen.getByLabelText("Stock mínimo en Local Centro")).toHaveValue(
      "12",
    );
    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(2));
    expect(updateProduct).toHaveBeenLastCalledWith(
      ORG_ID,
      expect.objectContaining({
        loaded: expect.objectContaining({
          referenceCostCents: 90000,
          minStocks: { [LOCATION_CENTRO]: 12000, [LOCATION_ESTE]: null },
        }),
      }),
    );
  });

  it("un costo mal escrito no se guarda como si fuera 'sin costo': se marca con su motivo y no se llama a la acción", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.clear(screen.getByLabelText("Costo de referencia"));
    await user.type(screen.getByLabelText("Costo de referencia"), "8oo");
    await user.click(save());

    const cost = screen.getByLabelText("Costo de referencia");
    expect(updateProduct).not.toHaveBeenCalled();
    expect(cost).toHaveAttribute("aria-invalid", "true");
    expect(cost).toHaveAccessibleDescription(
      "Escribí un monto, por ejemplo 1.250,50",
    );
    expect(cost).toHaveFocus();
    expect(screen.queryByText("Cambios guardados.")).not.toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("vaciar el costo a propósito sí es válido: se manda null", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProduct).mockResolvedValue(
      ok({ product: toProductView(adminRow(), "owner") }),
    );
    renderEdit();

    await user.clear(screen.getByLabelText("Costo de referencia"));
    await user.click(save());

    expect(await screen.findByText("Cambios guardados.")).toBeVisible();
    expect(updateProduct).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        referenceCostCents: null,
        loaded: expect.objectContaining({ referenceCostCents: 80000 }),
      }),
    );
  });

  it("vaciar el stock mínimo y el proveedor manda null (quita el valor)", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProduct).mockResolvedValue(
      ok({ product: toProductView(adminRow(), "owner") }),
    );
    renderEdit();

    await user.clear(screen.getByLabelText("Stock mínimo en Local Centro"));
    await choose(user, "Proveedor habitual", "Sin proveedor");
    await user.click(save());

    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    expect(updateProduct).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        preferredSupplierId: null,
        minStocks: { [LOCATION_CENTRO]: null, [LOCATION_ESTE]: null },
      }),
    );
  });

  it("si cambia el costo, la base pasa a 'manual'", async () => {
    const user = userEvent.setup();
    renderEdit();

    await user.clear(screen.getByLabelText("Costo de referencia"));
    await user.type(screen.getByLabelText("Costo de referencia"), "900");

    expect(screen.getByText("Costo de referencia (manual)")).toBeVisible();
  });

  it("un producto que no controla stock no muestra mínimos", () => {
    renderEdit({
      product: { ...EDITING, tracksStock: false, tracksExpiry: false },
    });

    expect(screen.queryByLabelText(/^Stock mínimo en/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Controla vencimientos" }),
    ).toBeDisabled();
  });

  it("CA-E04 de la edición se muestra y el formulario sigue editable", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProduct).mockResolvedValue(err(catalogError("CA-E04")));
    renderEdit();

    await user.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permiso para hacer esto.",
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("con la organización suspendida los campos quedan en solo lectura", () => {
    renderEdit({ writable: false });

    expect(save()).toBeDisabled();
    expect(screen.getByLabelText("Nombre")).toBeDisabled();
  });
});
