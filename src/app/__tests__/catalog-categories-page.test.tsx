import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CategoriesPage from "@/app/(app)/org/[orgId]/catalogo/categorias/page";
import {
  CATEGORY_ID,
  ORG_ID,
  makeOrgContext,
} from "@/features/catalog/__tests__/fixtures";
import { listCategories } from "@/features/catalog/server";
import { requireOrgContext } from "@/features/tenancy/server";

// Spec catalog-management "Categorías: alta y cambio de nombre" y "Acceso a las
// pantallas del catálogo por rol": la página llama a la guarda por su cuenta,
// lee las categorías con su cantidad de productos activos y arma la pantalla.

vi.mock("@/features/tenancy/server", () => ({ requireOrgContext: vi.fn() }));
vi.mock("@/features/catalog/server", () => ({ listCategories: vi.fn() }));
vi.mock("@/features/catalog/actions", () => ({
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderPage() {
  return CategoriesPage({
    params: Promise.resolve({ orgId: ORG_ID }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.mocked(requireOrgContext).mockReset();
  vi.mocked(listCategories).mockReset();
  vi.mocked(listCategories).mockResolvedValue([
    { id: CATEGORY_ID, name: "Golosinas", activeProductCount: 3 },
  ]);
});

describe("página /org/[orgId]/catalogo/categorias", () => {
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
  });

  it("tiene el encabezado 'Categorías', la lista con la cantidad de activos y un enlace para volver", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());

    render(await renderPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Categorías" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Golosinas")).toBeVisible();
    expect(screen.getByText("3 productos activos")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Volver al catálogo" }),
    ).toHaveAttribute("href", `/org/${ORG_ID}/catalogo`);
  });

  it("con la organización activa deja crear; suspendida, no", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    const active = render(await renderPage());
    expect(
      screen.getByRole("button", { name: "Crear categoría" }),
    ).toBeVisible();
    active.unmount();

    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ writable: false }),
    );
    render(await renderPage());
    expect(
      screen.queryByRole("button", { name: "Crear categoría" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "La cuenta está suspendida: el catálogo es solo de lectura.",
      ),
    ).toBeVisible();
  });
});
