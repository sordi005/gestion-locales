import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSharedProduct, listSharedProductQueue } from "../actions";
import { AdminBaseScreen } from "../components/admin-screen";
import type { QueueItem } from "../domain/rows";

// Spec shared-product-review "Pantalla de revisión en el panel del admin": cola
// paginada (sin comercios), aprobar y rechazar por fila, búsqueda de un código de
// la base para corregirlo, retirarlo o reactivarlo, y el botón de la promoción.

vi.mock("../actions", () => ({
  listSharedProductQueue: vi.fn(),
  getSharedProduct: vi.fn(),
  approveSharedProduct: vi.fn(),
  rejectSharedProduct: vi.fn(),
  updateSharedProduct: vi.fn(),
  retireSharedProduct: vi.fn(),
  runSharedProductConsensus: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    barcode: "7791234567898",
    barcodeKey: "7791234567898",
    eligibility: "eligible",
    organizationCount: 2,
    proposedNames: ["Alfajor Triple", "Alfajor Triple 70 g"],
    proposedBrands: ["Marca Demo"],
    hasSimilarNames: true,
    firstVoteAt: "2026-11-01T10:00:00+00:00",
    ...overrides,
  };
}

function queueOf(items: QueueItem[]) {
  return { ok: true, value: items } as const;
}

beforeEach(() => {
  vi.mocked(listSharedProductQueue).mockReset();
  vi.mocked(getSharedProduct).mockReset();
  vi.mocked(listSharedProductQueue).mockResolvedValue(queueOf([item()]));
  vi.mocked(getSharedProduct).mockResolvedValue({ ok: true, value: null });
});

async function renderScreen(props: { cursor?: string; barcode?: string } = {}) {
  return render(await AdminBaseScreen(props));
}

describe("cola de revisión", () => {
  it("pide una página de 25 más una (para saber si hay otra) desde el cursor de la URL", async () => {
    await renderScreen({ cursor: "123" });

    expect(listSharedProductQueue).toHaveBeenCalledWith({
      limit: 26,
      cursor: "123",
    });
  });

  it("dibuja el código, la cantidad de comercios, los nombres y la marca de parecidos", async () => {
    await renderScreen();

    const row = screen.getByRole("row", { name: /7791234567898/ });
    expect(row).toHaveTextContent("2 comercios");
    expect(row).toHaveTextContent("Alfajor Triple");
    expect(row).toHaveTextContent("Alfajor Triple 70 g");
    expect(row).toHaveTextContent("Marca Demo");
    expect(within(row).getByText("Nombres parecidos")).toBeVisible();
    expect(within(row).getByRole("button", { name: "Aprobar" })).toBeEnabled();
    expect(within(row).getByRole("button", { name: "Rechazar" })).toBeEnabled();
  });

  it("con un solo comercio dice '1 comercio' y sin parecidos no marca nada", async () => {
    vi.mocked(listSharedProductQueue).mockResolvedValue(
      queueOf([item({ organizationCount: 1, hasSimilarNames: false })]),
    );

    await renderScreen();

    const row = screen.getByRole("row", { name: /7791234567898/ });
    expect(row).toHaveTextContent("1 comercio");
    expect(row).not.toHaveTextContent("2 comercios");
    expect(within(row).queryByText("Nombres parecidos")).toBeNull();
  });

  it("un código que no es elegible no se puede aprobar (solo rechazar) y dice por qué", async () => {
    vi.mocked(listSharedProductQueue).mockResolvedValue(
      queueOf([item({ eligibility: "restricted_internal" })]),
    );

    await renderScreen();

    const row = screen.getByRole("row", { name: /7791234567898/ });
    expect(within(row).queryByRole("button", { name: "Aprobar" })).toBeNull();
    expect(row).toHaveTextContent("Código interno de un comercio");
    expect(within(row).getByRole("button", { name: "Rechazar" })).toBeVisible();
  });

  it("no muestra ningún dato de comercios: solo la cantidad", async () => {
    const { container } = await renderScreen();

    expect(container.textContent).not.toMatch(
      /organization|Kiosco|[0-9a-f]{8}-[0-9a-f]{4}/i,
    );
  });

  it("sin votos pendientes dice que la cola está vacía", async () => {
    vi.mocked(listSharedProductQueue).mockResolvedValue(queueOf([]));

    await renderScreen();

    expect(screen.getByText("No hay códigos para revisar.")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("si la cola no se pudo leer, muestra el error en español y no rompe la pantalla", async () => {
    vi.mocked(listSharedProductQueue).mockResolvedValue({
      ok: false,
      error: {
        code: "SP-A05",
        message: "No se pudo completar. Probá de nuevo.",
      },
    });

    await renderScreen();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo completar. Probá de nuevo.",
    );
    expect(
      screen.getByRole("button", { name: "Correr la promoción" }),
    ).toBeVisible();
  });
});

describe("paginación", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, index) =>
      item({
        barcode: `77900000000${String(index).padStart(2, "0")}`,
        barcodeKey: `77900000000${String(index).padStart(2, "0")}`,
      }),
    );

  it("con 26 filas muestra 25 y un 'Siguiente' con el cursor de la última mostrada", async () => {
    vi.mocked(listSharedProductQueue).mockResolvedValue(queueOf(many(26)));

    await renderScreen();

    expect(screen.getAllByRole("row")).toHaveLength(1 + 25);
    expect(screen.getByRole("link", { name: "Siguiente" })).toHaveAttribute(
      "href",
      "/admin/base-de-productos?cursor=7790000000024",
    );
  });

  it("con 25 o menos no hay 'Siguiente'", async () => {
    vi.mocked(listSharedProductQueue).mockResolvedValue(queueOf(many(25)));

    await renderScreen();

    expect(screen.queryByRole("link", { name: "Siguiente" })).toBeNull();
  });

  it("estando en una página con cursor hay un enlace para volver al principio", async () => {
    await renderScreen({ cursor: "123" });

    expect(
      screen.getByRole("link", { name: "Volver al principio" }),
    ).toHaveAttribute("href", "/admin/base-de-productos");
  });

  it("el 'Siguiente' conserva el código que se estaba buscando", async () => {
    vi.mocked(listSharedProductQueue).mockResolvedValue(queueOf(many(26)));

    await renderScreen({ barcode: "7791234567898" });

    expect(screen.getByRole("link", { name: "Siguiente" })).toHaveAttribute(
      "href",
      "/admin/base-de-productos?cursor=7790000000024&codigo=7791234567898",
    );
  });
});

describe("búsqueda de un código de la base", () => {
  it("sin código buscado no llama a getSharedProduct y muestra el formulario", async () => {
    await renderScreen();

    expect(getSharedProduct).not.toHaveBeenCalled();
    expect(
      screen.getByRole("searchbox", { name: "Código de barras" }),
    ).toHaveValue("");
    expect(screen.getByRole("button", { name: "Buscar" })).toBeVisible();
  });

  it("una entrada activa ofrece Corregir y Retirar", async () => {
    vi.mocked(getSharedProduct).mockResolvedValue({
      ok: true,
      value: {
        barcode: "7791234567898",
        name: "Alfajor Triple",
        brand: "Marca Demo",
        presentation: "70 g",
        status: "active",
      },
    });

    await renderScreen({ barcode: "7791234567898" });

    expect(getSharedProduct).toHaveBeenCalledWith({ barcode: "7791234567898" });
    const result = screen.getByRole("region", {
      name: "Resultado de la búsqueda",
    });
    expect(result).toHaveTextContent("Alfajor Triple");
    expect(result).toHaveTextContent("Marca Demo");
    expect(result).toHaveTextContent("70 g");
    expect(result).toHaveTextContent("Activo");
    expect(
      within(result).getByRole("button", { name: "Corregir" }),
    ).toBeVisible();
    expect(
      within(result).getByRole("button", { name: "Retirar" }),
    ).toBeVisible();
    expect(
      within(result).queryByRole("button", { name: "Reactivar" }),
    ).toBeNull();
    // El campo vuelve con lo buscado.
    expect(
      screen.getByRole("searchbox", { name: "Código de barras" }),
    ).toHaveValue("7791234567898");
  });

  it("una entrada retirada ofrece Reactivar y no Retirar", async () => {
    vi.mocked(getSharedProduct).mockResolvedValue({
      ok: true,
      value: {
        barcode: "7791234567898",
        name: "Alfajor Triple",
        brand: null,
        presentation: null,
        status: "retired",
      },
    });

    await renderScreen({ barcode: "7791234567898" });

    const result = screen.getByRole("region", {
      name: "Resultado de la búsqueda",
    });
    expect(result).toHaveTextContent("Retirado");
    expect(
      within(result).getByRole("button", { name: "Reactivar" }),
    ).toBeVisible();
    expect(
      within(result).queryByRole("button", { name: "Retirar" }),
    ).toBeNull();
  });

  it("un código que no está en la base lo dice", async () => {
    await renderScreen({ barcode: "7791234567898" });

    expect(
      screen.getByText("Ese código no está en la base de productos."),
    ).toBeVisible();
  });

  it("un código mal escrito muestra el error de la acción junto al campo", async () => {
    vi.mocked(getSharedProduct).mockResolvedValue({
      ok: false,
      error: {
        code: "SP-A01",
        message: "Revisá los datos marcados.",
        fieldErrors: {
          barcode: "El código tiene que tener solo números (hasta 14).",
        },
      },
    });

    await renderScreen({ barcode: "abc" });

    expect(
      screen.getByText("El código tiene que tener solo números (hasta 14)."),
    ).toBeVisible();
  });
});
