import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminSharedProductsPage from "@/app/(app)/admin/base-de-productos/page";
import { AdminBaseScreen } from "@/features/shared-products/components";
import { requirePlatformAdmin } from "@/features/tenancy/server";

// Spec shared-product-review "Persona que no es admin": quien no es super-admin
// recibe el mismo "no encontrado" que el resto de /admin. La página llama a la
// guarda por su cuenta, primero, y le pasa a la pantalla lo que vino en la URL.

vi.mock("@/features/tenancy/server", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/features/shared-products/components", () => ({
  AdminBaseScreen: vi.fn(() => <p>pantalla del admin</p>),
}));

function renderPage(searchParams: Record<string, string | string[]> = {}) {
  return AdminSharedProductsPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  });
}

beforeEach(() => {
  vi.mocked(requirePlatformAdmin)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(AdminBaseScreen).mockClear();
});

describe("página /admin/base-de-productos", () => {
  it("llama a requirePlatformAdmin y dibuja la pantalla dentro del main", async () => {
    render(await renderPage());

    expect(requirePlatformAdmin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("main")).toHaveTextContent("pantalla del admin");
  });

  it("si la guarda corta (no es admin: 404), no dibuja ni lee nada", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(
      new Error("NEXT_NOT_FOUND"),
    );

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(AdminBaseScreen).not.toHaveBeenCalled();
  });

  it("pasa el cursor y el código de la URL a la pantalla", async () => {
    render(await renderPage({ cursor: "123", codigo: "7791234567898" }));

    expect(vi.mocked(AdminBaseScreen).mock.calls[0]?.[0]).toEqual({
      cursor: "123",
      barcode: "7791234567898",
    });
  });

  it("si un parámetro viene repetido toma el primero", async () => {
    render(await renderPage({ codigo: ["111", "222"] }));

    expect(vi.mocked(AdminBaseScreen).mock.calls[0]?.[0]).toEqual({
      cursor: undefined,
      barcode: "111",
    });
  });
});
