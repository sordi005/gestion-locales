import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/lib/result";
import type { Scan } from "@/shared/lib/scanner/scan-result";

import {
  createProduct,
  findProductByBarcode,
  findProductById,
  setInitialSalePrice,
} from "../../actions";
import { barcodeTakenMessage, catalogError } from "../../domain/errors";
import { QuickCreateProduct } from "../quick-create-product";
import type { QuickCreateProductProps } from "../quick-create-product";
import {
  INVALID_CHECK_CODE,
  ORG_ID,
  VALID_CODE,
  makeProduct,
  makeScan,
} from "./fixtures";

// Spec product-quick-create: la hoja del alta rápida. Se simulan las Server Actions,
// la base compartida y la caché (los límites).

vi.setConfig({ testTimeout: 20_000 });

const refresh = vi.hoisted(() => vi.fn(() => Promise.resolve("synced")));

vi.mock("../../actions", () => ({
  createProduct: vi.fn(),
  findProductByBarcode: vi.fn(),
  findProductById: vi.fn(),
  setInitialSalePrice: vi.fn(),
}));
vi.mock("@/features/shared-products/server", () => ({
  lookupSharedProduct: vi.fn(),
}));
vi.mock("../../cache", () => ({ useCatalogCache: () => ({ refresh }) }));

const { lookupSharedProduct } =
  await import("@/features/shared-products/server");

const MISREAD = "Revisá que el número coincida con el de la caja";
const SUGGESTION = {
  barcode_norm: VALID_CODE,
  name: "Galletitas de limón",
  brand: "Campo Verde",
  presentation: "120 g",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookupSharedProduct).mockResolvedValue(ok(null));
});

function renderSheet(over: Partial<QuickCreateProductProps> = {}) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const props = {
    orgId: ORG_ID,
    scan: makeScan(),
    origin: "catalog",
    mode: "create",
    open: true,
    onDone,
    onCancel,
    ...over,
  } as QuickCreateProductProps;
  const view = render(<QuickCreateProduct {...props} />);
  return {
    onDone,
    onCancel,
    scan: props.scan,
    /** Vuelve a dibujar la hoja con otras props (p. ej. el origen la cierra). */
    rerender: (next: Partial<QuickCreateProductProps>) =>
      view.rerender(
        <QuickCreateProduct
          {...({ ...props, ...next } as QuickCreateProductProps)}
        />,
      ),
  };
}

/** El `timeStamp` de la última tecla vista (el de jsdom no sigue al reloj). */
let lastKeyStamp = 0;
window.addEventListener(
  "keydown",
  (event) => {
    lastKeyStamp = event.timeStamp;
  },
  { capture: true },
);

/** Una ráfaga del lector USB en modo teclado: dígitos a 8 ms y un Enter. */
function readerBurst(target: HTMLInputElement, code: string) {
  // Mucho después de lo último que se tipeó: la ráfaga es una candidata nueva.
  const start = lastKeyStamp + 10_000;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  const send = (key: string, time: number) => {
    const event = new KeyboardEvent("keydown", {
      key,
      code: /[0-9]/.test(key) ? `Digit${key}` : key,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "timeStamp", { value: time });
    target.dispatchEvent(event);
    return event;
  };
  [...code].forEach((digit, index) => {
    const event = send(digit, start + index * 8);
    if (!event.defaultPrevented) {
      setter?.call(target, target.value + digit);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  return send("Enter", start + code.length * 8);
}

/** Una promesa que se resuelve a mano, para dejar una acción "en vuelo". */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function created(over: Parameters<typeof makeProduct>[0] = {}) {
  const product = makeProduct(over);
  vi.mocked(createProduct).mockResolvedValue(ok({ product, warnings: [] }));
  return product;
}

describe("QuickCreateProduct: alta feliz", () => {
  it("abre con el código, guarda con nombre y precio, avisa created y refresca la caché", async () => {
    const user = userEvent.setup();
    const product = created({ name: "Galletitas", salePriceCents: 90000 });
    const scan = makeScan();
    const { onDone } = renderSheet({ scan });

    expect(screen.getByText(scan.raw)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Nombre"), "Galletitas");
    await user.type(screen.getByLabelText("Precio"), "900");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(createProduct).toHaveBeenCalledExactlyOnceWith(ORG_ID, {
      name: "Galletitas",
      brand: null,
      unit: "unit",
      salePriceCents: 90000,
      barcodes: [scan.raw],
    });
    expect(onDone).toHaveBeenCalledWith({ kind: "created", product, scan });
    expect(refresh).toHaveBeenCalled();
  });
});

describe("QuickCreateProduct: precio según el origen", () => {
  it("desde la venta sin precio no envía y marca el precio", async () => {
    const user = userEvent.setup();
    const { onDone } = renderSheet({ origin: "sale" });

    await user.type(screen.getByLabelText("Nombre"), "Galletitas");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Poné el precio.")).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("desde un conteo sin precio crea el producto igual", async () => {
    const user = userEvent.setup();
    created();
    const { onDone } = renderSheet({ origin: "count" });

    await user.type(screen.getByLabelText("Nombre"), "Galletitas");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(createProduct).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ salePriceCents: null }),
    );
  });
});

describe("QuickCreateProduct: precio $0 bloqueado", () => {
  it.each(["sale", "count"] as const)(
    "desde %s con precio 0 no envía y marca el precio; con uno válido guarda",
    async (origin) => {
      const user = userEvent.setup();
      created();
      const { onDone } = renderSheet({ origin });

      await user.type(screen.getByLabelText("Nombre"), "Galletitas");
      await user.type(screen.getByLabelText("Precio"), "0");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      expect(
        await screen.findByText("El precio tiene que ser mayor a $0."),
      ).toBeInTheDocument();
      expect(createProduct).not.toHaveBeenCalled();

      await user.clear(screen.getByLabelText("Precio"));
      await user.type(screen.getByLabelText("Precio"), "500");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
      expect(createProduct).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ salePriceCents: 50000 }),
      );
    },
  );

  it("por peso, precio por kilo 0 también se rechaza", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("Nombre"), "Queso");
    await user.click(screen.getByLabelText("Se vende por peso"));
    await user.type(screen.getByLabelText("Precio por kilo"), "0");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("El precio tiene que ser mayor a $0."),
    ).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });
});

describe("QuickCreateProduct: Se vende por peso", () => {
  it("cambia la etiqueta a 'Precio por kilo' y crea con unit kg", async () => {
    const user = userEvent.setup();
    created({ unit: "kg" });
    const { onDone } = renderSheet();

    await user.type(screen.getByLabelText("Nombre"), "Queso");
    await user.click(screen.getByLabelText("Se vende por peso"));
    await user.type(screen.getByLabelText("Precio por kilo"), "1200");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(createProduct).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ unit: "kg", salePriceCents: 120000 }),
    );
  });
});

describe("QuickCreateProduct: código ya cargado", () => {
  it("CA-E02 → existing con el aviso del dueño del código", async () => {
    const user = userEvent.setup();
    const theirs = makeProduct({ name: "Galletitas de limón" });
    vi.mocked(createProduct).mockResolvedValue(
      err(
        catalogError("CA-E02", {
          message: barcodeTakenMessage(VALID_CODE, theirs.name),
        }),
      ),
    );
    vi.mocked(findProductByBarcode).mockResolvedValue(ok(theirs));
    const { onDone, scan } = renderSheet();

    await user.type(screen.getByLabelText("Nombre"), "Otra");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledWith({
      kind: "existing",
      product: theirs,
      scan,
      notice: "Ese código ya lo cargó otra persona: Galletitas de limón",
    });
  });

  it("un error por campo se muestra y conserva lo escrito, sin cerrar", async () => {
    const user = userEvent.setup();
    vi.mocked(createProduct).mockResolvedValue(
      err(
        catalogError("CA-E01", {
          fieldErrors: { name: "El nombre ya existe en el servidor." },
        }),
      ),
    );
    const { onDone } = renderSheet();

    await user.type(screen.getByLabelText("Nombre"), "Galletitas");
    await user.type(screen.getByLabelText("Precio"), "900");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("El nombre ya existe en el servidor."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Galletitas");
    expect(screen.getByLabelText("Precio")).toHaveValue("900,00");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("un error general se muestra en un aviso y no cierra", async () => {
    const user = userEvent.setup();
    vi.mocked(createProduct).mockResolvedValue(err(catalogError("CA-E05")));
    const { onDone } = renderSheet();

    await user.type(screen.getByLabelText("Nombre"), "Galletitas");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La cuenta está suspendida",
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("QuickCreateProduct: sugerencia de la base compartida", () => {
  it("a tiempo: nombre y marca editables, foco en el precio, sin aviso de número", async () => {
    const user = userEvent.setup();
    vi.mocked(lookupSharedProduct).mockResolvedValue(ok(SUGGESTION));
    created();
    const { onDone } = renderSheet();

    await waitFor(() =>
      expect(screen.getByLabelText("Nombre")).toHaveValue(
        "Galletitas de limón 120 g",
      ),
    );
    expect(screen.getByLabelText("Marca")).toHaveValue("Campo Verde");
    await waitFor(() => expect(screen.getByLabelText("Precio")).toHaveFocus());
    expect(screen.queryByText(MISREAD)).not.toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Marca"));
    await user.type(screen.getByLabelText("Marca"), "Otra marca");
    await user.type(screen.getByLabelText("Precio"), "900");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(createProduct).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        name: "Galletitas de limón 120 g",
        brand: "Otra marca",
      }),
    );
  });

  it("tardía: no pisa el nombre que ya se escribió y completa la marca", async () => {
    const user = userEvent.setup();
    let resolveLookup: (value: ReturnType<typeof ok>) => void = () => {};
    vi.mocked(lookupSharedProduct).mockReturnValue(
      new Promise((resolve) => {
        resolveLookup = resolve as typeof resolveLookup;
      }),
    );
    renderSheet();

    await user.type(screen.getByLabelText("Nombre"), "Mi galletita");
    resolveLookup(ok(SUGGESTION));

    await waitFor(() =>
      expect(screen.getByLabelText("Marca")).toHaveValue("Campo Verde"),
    );
    expect(screen.getByLabelText("Nombre")).toHaveValue("Mi galletita");
  });

  it("tardía con la persona escribiendo en Marca: completa el nombre y el foco no se mueve", async () => {
    const user = userEvent.setup();
    const lookup = deferred<ReturnType<typeof ok>>();
    vi.mocked(lookupSharedProduct).mockReturnValue(
      lookup.promise as ReturnType<typeof lookupSharedProduct>,
    );
    renderSheet();

    await user.type(screen.getByLabelText("Marca"), "Ma");
    lookup.resolve(ok(SUGGESTION));

    await waitFor(() =>
      expect(screen.getByLabelText("Nombre")).toHaveValue(
        "Galletitas de limón 120 g",
      ),
    );
    expect(screen.getByLabelText("Marca")).toHaveFocus();
    expect(screen.getByLabelText("Marca")).toHaveValue("Ma");
  });

  it("tardía con la persona en el precio: tampoco le roba el foco", async () => {
    const user = userEvent.setup();
    const lookup = deferred<ReturnType<typeof ok>>();
    vi.mocked(lookupSharedProduct).mockReturnValue(
      lookup.promise as ReturnType<typeof lookupSharedProduct>,
    );
    renderSheet();

    await user.type(screen.getByLabelText("Marca"), "Ma");
    await user.click(screen.getByLabelText("Precio"));
    lookup.resolve(ok(SUGGESTION));

    await waitFor(() =>
      expect(screen.getByLabelText("Nombre")).toHaveValue(
        "Galletitas de limón 120 g",
      ),
    );
    expect(screen.getByLabelText("Precio")).toHaveFocus();
  });

  it.each([
    [
      "el enlace 'ver fuentes'",
      () => screen.getByRole("link", { name: "ver fuentes" }),
    ],
    ["la X de cerrar", () => screen.getByRole("button", { name: "Cerrar" })],
    ["Cancelar", () => screen.getByRole("button", { name: "Cancelar" })],
  ])(
    "tardía con el foco en %s: no se lo mueve al precio",
    async (_name, target) => {
      const lookup = deferred<ReturnType<typeof ok>>();
      vi.mocked(lookupSharedProduct).mockReturnValue(
        lookup.promise as ReturnType<typeof lookupSharedProduct>,
      );
      renderSheet();
      act(() => target().focus());

      await act(async () => {
        lookup.resolve(ok(SUGGESTION));
        await lookup.promise;
      });

      await waitFor(() =>
        expect(screen.getByLabelText("Nombre")).toHaveValue(
          "Galletitas de limón 120 g",
        ),
      );
      expect(target()).toHaveFocus();
    },
  );

  it("tardía con el foco todavía en el nombre sin tocar: pasa al precio", async () => {
    const lookup = deferred<ReturnType<typeof ok>>();
    vi.mocked(lookupSharedProduct).mockReturnValue(
      lookup.promise as ReturnType<typeof lookupSharedProduct>,
    );
    renderSheet();
    screen.getByLabelText("Nombre").focus();

    lookup.resolve(ok(SUGGESTION));

    await waitFor(() => expect(screen.getByLabelText("Precio")).toHaveFocus());
  });

  it.each([
    ["ok(null)", () => Promise.resolve(ok(null))],
    [
      "SP-E01",
      () => Promise.resolve(err({ code: "SP-E01", message: "No disponible" })),
    ],
    ["rechazo de red", () => Promise.reject(new Error("offline"))],
  ])(
    "%s: sin error visible, con el aviso de número y Guardar habilitado",
    async (_name, lookup) => {
      vi.mocked(lookupSharedProduct).mockImplementation(
        lookup as unknown as typeof lookupSharedProduct,
      );
      renderSheet();

      expect(await screen.findByText(MISREAD)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    },
  );

  it("el aviso de número no aparece mientras la consulta está en curso", async () => {
    const lookup = deferred<ReturnType<typeof ok>>();
    vi.mocked(lookupSharedProduct).mockReturnValue(
      lookup.promise as ReturnType<typeof lookupSharedProduct>,
    );
    renderSheet();

    expect(screen.queryByText(MISREAD)).not.toBeInTheDocument();
    // Se termina la consulta: React une las transiciones asíncronas, y una que
    // nunca termina dejaría "colgadas" a las de los tests que siguen.
    await act(async () => {
      lookup.resolve(ok(null));
      await lookup.promise;
    });
  });

  it("el pie atribuye la fuente y enlaza a /fuentes-de-datos", () => {
    renderSheet();

    expect(
      screen.getByText(/Nombres sugeridos con datos públicos/),
    ).toHaveTextContent("Nombres sugeridos con datos públicos (ver fuentes)");
    expect(screen.getByRole("link", { name: "ver fuentes" })).toHaveAttribute(
      "href",
      "/fuentes-de-datos",
    );
  });
});

describe("QuickCreateProduct: dígito verificador inválido", () => {
  function renderInvalid() {
    const scan: Scan = makeScan(INVALID_CHECK_CODE);
    return renderSheet({ scan });
  }

  it("avisa y ofrece 'Volver a escanear' sin crear nada", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderInvalid();

    expect(screen.getByText(/parece mal leído/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Volver a escanear" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("'Cargar igual' muestra el formulario, también con el aviso de número", async () => {
    const user = userEvent.setup();
    renderInvalid();

    await user.click(screen.getByRole("button", { name: "Cargar igual" }));

    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(await screen.findByText(MISREAD)).toBeInTheDocument();
  });
});

describe("QuickCreateProduct: ítem manual", () => {
  it("solo con origen sale y con el callback", async () => {
    const user = userEvent.setup();
    const onSellAsManualItem = vi.fn();
    const { scan } = renderSheet({ origin: "sale", onSellAsManualItem });

    await user.click(
      screen.getByRole("button", { name: "Vender como ítem manual" }),
    );

    expect(onSellAsManualItem).toHaveBeenCalledExactlyOnceWith(scan);
  });

  it("con un guardado en vuelo queda deshabilitado", async () => {
    const user = userEvent.setup();
    const save = deferred<Awaited<ReturnType<typeof createProduct>>>();
    vi.mocked(createProduct).mockReturnValue(save.promise);
    const onSellAsManualItem = vi.fn();
    renderSheet({ origin: "sale", onSellAsManualItem });

    await user.type(screen.getByLabelText("Nombre"), "Galletitas");
    await user.type(screen.getByLabelText("Precio"), "900");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Vender como ítem manual" }),
      ).toBeDisabled(),
    );
    await act(async () => {
      save.resolve(ok({ product: makeProduct(), warnings: [] }));
      await save.promise;
    });
  });

  it.each([
    ["otro origen", { origin: "count", onSellAsManualItem: vi.fn() }],
    ["sin callback", { origin: "sale" }],
  ] as const)("no se ofrece con %s", (_name, over) => {
    renderSheet(over as Partial<QuickCreateProductProps>);

    expect(
      screen.queryByRole("button", { name: "Vender como ítem manual" }),
    ).not.toBeInTheDocument();
  });
});

describe("QuickCreateProduct: modo precio", () => {
  const noPrice = makeProduct({ name: "Queso cremoso", unit: "kg" });

  it("pide solo el precio (por kilo si es kg) y llama a setInitialSalePrice", async () => {
    const user = userEvent.setup();
    const priced = { ...noPrice, salePriceCents: 150000 };
    vi.mocked(setInitialSalePrice).mockResolvedValue(ok({ product: priced }));
    const { onDone, scan } = renderSheet({ mode: "price", product: noPrice });

    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Marca")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Se vende por peso"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Queso cremoso/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Precio por kilo"), "1500");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(setInitialSalePrice).toHaveBeenCalledExactlyOnceWith(ORG_ID, {
      productId: noPrice.id,
      salePriceCents: 150000,
    });
    expect(createProduct).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({
      kind: "existing",
      product: priced,
      scan,
    });
  });

  it("producto por unidad: la etiqueta es 'Precio'; sin precio no envía", async () => {
    const user = userEvent.setup();
    renderSheet({ mode: "price", product: makeProduct() });

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByLabelText("Precio")).toBeInTheDocument();
    expect(await screen.findByText("Poné el precio.")).toBeInTheDocument();
    expect(setInitialSalePrice).not.toHaveBeenCalled();
  });

  it("con precio 0 no envía y marca el precio; con uno válido guarda", async () => {
    const user = userEvent.setup();
    const priced = { ...noPrice, salePriceCents: 50000 };
    vi.mocked(setInitialSalePrice).mockResolvedValue(ok({ product: priced }));
    const { onDone } = renderSheet({ mode: "price", product: noPrice });

    await user.type(screen.getByLabelText("Precio por kilo"), "0");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("El precio tiene que ser mayor a $0."),
    ).toBeInTheDocument();
    expect(setInitialSalePrice).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Precio por kilo"));
    await user.type(screen.getByLabelText("Precio por kilo"), "500");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(setInitialSalePrice).toHaveBeenCalledExactlyOnceWith(ORG_ID, {
      productId: noPrice.id,
      salePriceCents: 50000,
    });
  });

  it.each([
    ["con el código leído", makeScan()],
    ["elegido por nombre (sin código)", null],
  ])(
    "CA-E08 (%s): relee por id y sigue con el precio que puso la otra persona",
    async (_label, scan) => {
      const user = userEvent.setup();
      const product = makeProduct();
      const current = makeProduct({ salePriceCents: 70000 });
      vi.mocked(setInitialSalePrice).mockResolvedValue(
        err(
          catalogError("CA-E08", {
            message: "Otra persona ya le puso precio.",
          }),
        ),
      );
      vi.mocked(findProductById).mockResolvedValue(ok(current));
      const { onDone } = renderSheet({ mode: "price", product, scan });

      await user.type(screen.getByLabelText("Precio"), "900");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
      expect(findProductById).toHaveBeenCalledExactlyOnceWith(ORG_ID, {
        productId: product.id,
      });
      expect(findProductByBarcode).not.toHaveBeenCalled();
      expect(onDone).toHaveBeenCalledWith({
        kind: "existing",
        product: current,
        scan,
        notice: "Otra persona ya le puso precio.",
      });
      expect(refresh).toHaveBeenCalled();
    },
  );

  it.each([
    ["la relectura da null", () => Promise.resolve(ok(null))],
    ["la relectura rechaza", () => Promise.reject(new Error("offline"))],
  ])(
    "CA-E08 sin poder releer (%s): la hoja sigue abierta con el aviso, sin Guardar, y refresca",
    async (_label, reread) => {
      const user = userEvent.setup();
      const product = makeProduct();
      vi.mocked(setInitialSalePrice).mockResolvedValue(
        err(
          catalogError("CA-E08", {
            message: "Otra persona ya le puso precio.",
          }),
        ),
      );
      vi.mocked(findProductById).mockImplementation(
        reread as unknown as typeof findProductById,
      );
      const { onDone } = renderSheet({ mode: "price", product, scan: null });

      await user.type(screen.getByLabelText("Precio"), "900");
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      expect(
        await screen.findByText("Otra persona ya le puso precio."),
      ).toBeInTheDocument();
      // Nunca se cierra con el producto viejo ("Sin precio") ni se puede reintentar en bucle.
      expect(onDone).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
      expect(refresh).toHaveBeenCalled();
    },
  );

  it("elegido por nombre (sin código): no muestra código, guarda y devuelve scan null", async () => {
    const user = userEvent.setup();
    const product = makeProduct({ name: "Turrón Arcor" });
    const priced = { ...product, salePriceCents: 50000 };
    vi.mocked(setInitialSalePrice).mockResolvedValue(ok({ product: priced }));
    const { onDone } = renderSheet({ mode: "price", product, scan: null });

    expect(
      screen.getByRole("heading", { name: "Poné el precio" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Turrón Arcor")).toBeInTheDocument();
    expect(screen.queryByText(/Código/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Precio"), "500");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(setInitialSalePrice).toHaveBeenCalledExactlyOnceWith(ORG_ID, {
      productId: product.id,
      salePriceCents: 50000,
    });
    expect(onDone).toHaveBeenCalledWith({
      kind: "existing",
      product: priced,
      scan: null,
    });
  });

  it("elegido por nombre y por peso: la etiqueta es 'Precio por kilo'", () => {
    renderSheet({
      mode: "price",
      product: makeProduct({ name: "Queso", unit: "kg" }),
      scan: null,
    });

    expect(screen.getByLabelText("Precio por kilo")).toBeInTheDocument();
  });
});

describe("QuickCreateProduct: ráfaga del lector con la hoja abierta", () => {
  it("no se escribe en el nombre, no guarda y el Enter se frena", async () => {
    const user = userEvent.setup();
    renderSheet();
    const name = screen.getByLabelText("Nombre");
    await user.type(name, "Coca");

    const enter = readerBurst(name as HTMLInputElement, VALID_CODE);

    expect(enter.defaultPrevented).toBe(true);
    expect(name).toHaveValue("Coca");
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("tampoco ensucia el precio ni la marca", async () => {
    const user = userEvent.setup();
    renderSheet();
    const brand = screen.getByLabelText("Marca");
    await user.type(brand, "Ma");

    readerBurst(brand as HTMLInputElement, VALID_CODE);

    expect(brand).toHaveValue("Ma");
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("al cerrar la hoja deja de capturar: la ráfaga ya no se frena", () => {
    const { rerender } = renderSheet();
    rerender({ open: false });
    const outside = document.createElement("input");
    document.body.append(outside);

    const enter = readerBurst(outside, VALID_CODE);

    expect(enter.defaultPrevented).toBe(false);
    outside.remove();
  });
});

describe("QuickCreateProduct: cerrar mientras se guarda", () => {
  it("alta: Cancelar queda deshabilitado, Escape no cierra y al terminar avisa onDone una vez", async () => {
    const user = userEvent.setup();
    const save = deferred<Awaited<ReturnType<typeof createProduct>>>();
    vi.mocked(createProduct).mockReturnValue(save.promise);
    const { onDone, onCancel } = renderSheet();

    await user.type(screen.getByLabelText("Nombre"), "Galletitas");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled(),
    );
    await user.keyboard("{Escape}");

    expect(onCancel).not.toHaveBeenCalled();
    save.resolve(ok({ product: makeProduct(), warnings: [] }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("alta: si la hoja se cierra igual (el origen la desmonta), el resultado tardío no se entrega", async () => {
    const user = userEvent.setup();
    const save = deferred<Awaited<ReturnType<typeof createProduct>>>();
    vi.mocked(createProduct).mockReturnValue(save.promise);
    const { onDone, rerender } = renderSheet();

    await user.type(screen.getByLabelText("Nombre"), "Galletitas");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    rerender({ open: false });
    save.resolve(ok({ product: makeProduct(), warnings: [] }));
    await act(async () => {
      await save.promise;
    });

    expect(onDone).not.toHaveBeenCalled();
  });

  it("modo precio: Cancelar deshabilitado, Escape no cierra y al terminar avisa onDone una vez", async () => {
    const user = userEvent.setup();
    const save = deferred<Awaited<ReturnType<typeof setInitialSalePrice>>>();
    vi.mocked(setInitialSalePrice).mockReturnValue(save.promise);
    const product = makeProduct();
    const { onDone, onCancel } = renderSheet({
      mode: "price",
      product,
      scan: null,
    });

    await user.type(screen.getByLabelText("Precio"), "500");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled(),
    );
    await user.keyboard("{Escape}");

    expect(onCancel).not.toHaveBeenCalled();
    save.resolve(ok({ product: { ...product, salePriceCents: 50000 } }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("modo precio: si la hoja se cierra igual, el resultado tardío no se entrega", async () => {
    const user = userEvent.setup();
    const save = deferred<Awaited<ReturnType<typeof setInitialSalePrice>>>();
    vi.mocked(setInitialSalePrice).mockReturnValue(save.promise);
    const product = makeProduct();
    const { onDone, rerender } = renderSheet({
      mode: "price",
      product,
      scan: null,
    });

    await user.type(screen.getByLabelText("Precio"), "500");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    rerender({ open: false });
    save.resolve(ok({ product: { ...product, salePriceCents: 50000 } }));
    await act(async () => {
      await save.promise;
    });

    expect(onDone).not.toHaveBeenCalled();
  });

  it("tras un error el botón Cancelar vuelve a estar habilitado", async () => {
    const user = userEvent.setup();
    vi.mocked(createProduct).mockResolvedValue(err(catalogError("CA-E10")));
    renderSheet();

    await user.type(screen.getByLabelText("Nombre"), "Galletitas");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await screen.findByRole("alert");
    await waitFor(
      () =>
        expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled(),
      { timeout: 5000 },
    );
  });
});

describe("QuickCreateProduct: cierre", () => {
  it("'Cancelar' avisa onCancel", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderSheet();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cerrada no dibuja nada", () => {
    renderSheet({ open: false });

    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });
});
