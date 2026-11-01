import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NewProductPage from "@/app/(app)/org/[orgId]/catalogo/nuevo/page";
import {
  CATEGORY_ID,
  LOCATION_CENTRO,
  ORG_ID,
  SUPPLIER_ID,
  makeOrgContext,
} from "@/features/catalog/__tests__/fixtures";
import { listCategories, listSuppliers } from "@/features/catalog/server";
import { requireOrgContext } from "@/features/tenancy/server";

// Specs catalog-management "Alta de producto por dueño o encargado", "Stock mínimo
// por local" y "Organización suspendida en solo lectura". La página llama a la
// guarda por su cuenta, lee categorías y proveedores y arma el formulario con un
// campo de stock mínimo por cada local de la persona.

vi.mock("@/features/tenancy/server", () => ({ requireOrgContext: vi.fn() }));
vi.mock("@/features/catalog/server", () => ({
  listCategories: vi.fn(),
  listSuppliers: vi.fn(),
}));
vi.mock("@/features/catalog/actions", () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderPage() {
  return NewProductPage({
    params: Promise.resolve({ orgId: ORG_ID }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.mocked(requireOrgContext).mockReset();
  vi.mocked(listCategories).mockReset();
  vi.mocked(listSuppliers).mockReset();
  vi.mocked(listCategories).mockResolvedValue([
    { id: CATEGORY_ID, name: "Golosinas", activeProductCount: 2 },
  ]);
  vi.mocked(listSuppliers).mockResolvedValue([
    { id: SUPPLIER_ID, name: "Distribuidora del Norte" },
  ]);
});

describe("página /org/[orgId]/catalogo/nuevo", () => {
  it("llama a requireOrgContext por su cuenta, solo para dueño y encargado", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());

    await renderPage();

    expect(requireOrgContext).toHaveBeenCalledWith(ORG_ID, [
      "owner",
      "manager",
    ]);
  });

  it("si la guarda corta (404 o salida), no lee nada", async () => {
    vi.mocked(requireOrgContext).mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listCategories).not.toHaveBeenCalled();
    expect(listSuppliers).not.toHaveBeenCalled();
  });

  it("tiene el encabezado 'Nuevo producto', el formulario y un enlace para volver", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());

    render(await renderPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Nuevo producto" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Volver al catálogo" }),
    ).toHaveAttribute("href", `/org/${ORG_ID}/catalogo`);
  });

  it("ofrece un stock mínimo por cada local de la persona", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({
        locations: [
          { id: LOCATION_CENTRO, name: "Local Centro" },
          { id: "00000000-0000-4000-b000-000000000003", name: "Local Este" },
        ],
      }),
    );

    render(await renderPage());

    expect(screen.getByLabelText("Stock mínimo en Local Centro")).toHaveValue(
      "",
    );
    expect(screen.getByLabelText("Stock mínimo en Local Este")).toHaveValue("");
  });

  it("un encargado de un solo local ve solo el mínimo de ese local", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({
        role: "manager",
        locations: [{ id: LOCATION_CENTRO, name: "Local Centro" }],
      }),
    );

    render(await renderPage());

    expect(screen.getByLabelText("Stock mínimo en Local Centro")).toBeVisible();
    expect(
      screen.queryByLabelText("Stock mínimo en Local Este"),
    ).not.toBeInTheDocument();
  });

  it("con la organización suspendida el formulario no deja guardar", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ writable: false }),
    );

    render(await renderPage());

    expect(
      screen.getByRole("button", { name: "Guardar producto" }),
    ).toBeDisabled();
  });
});
