import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProductsPage from "@/app/(app)/l/[locationId]/productos/page";
import { buildTenantContext, resolveLocationAccess } from "@/features/tenancy";
import type { LocationContext } from "@/features/tenancy";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_ESTE,
  rowsFor,
} from "@/features/tenancy/domain/__tests__/fixtures";
import type { SeedUserKey } from "@/features/tenancy/domain/__tests__/fixtures";
import { requireLocationContext } from "@/features/tenancy/server";

// Spec product-quick-create "Pantalla Productos": la página llama a la guarda del
// local por su cuenta y cruza al cliente SOLO `orgId`, `role` y `writable` (nunca
// el contexto entero). Se simulan la guarda y la pantalla cliente.

vi.mock("@/features/tenancy/server", () => ({
  requireLocationContext: vi.fn(),
}));

const received = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("@/features/catalog/components", () => ({
  ProductsScreen: (props: Record<string, unknown>) => {
    received.props.push(props);
    return <p>pantalla de productos</p>;
  },
}));

function enter(user: SeedUserKey, locationId: string): LocationContext {
  const access = resolveLocationAccess(
    buildTenantContext(rowsFor(user)),
    locationId,
  );
  if (access.kind !== "ok") throw new Error(`${user} no entra a ${locationId}`);
  vi.mocked(requireLocationContext).mockResolvedValue(access.context);
  return access.context;
}

function renderPage(locationId: string) {
  return ProductsPage({
    params: Promise.resolve({ locationId }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.mocked(requireLocationContext).mockReset();
  received.props = [];
});

describe("página /l/[locationId]/productos", () => {
  it("llama a requireLocationContext con el id de la URL, tal cual, y dibuja la pantalla", async () => {
    enter("employee.norte", LOC_NORTE_CENTRO);

    render(await renderPage(LOC_NORTE_CENTRO));

    expect(requireLocationContext).toHaveBeenCalledTimes(1);
    expect(requireLocationContext).toHaveBeenCalledWith(LOC_NORTE_CENTRO);
    expect(screen.getByText("pantalla de productos")).toBeInTheDocument();
  });

  it.each([
    ["employee.norte", LOC_NORTE_CENTRO, "employee"],
    ["owner.sur", LOC_SUR_ESTE, "owner"],
  ] as const)(
    "%s: al cliente solo cruzan orgId, role y writable (nada del contexto entero)",
    async (user, locationId, role) => {
      const context = enter(user, locationId);

      render(await renderPage(locationId));
      expect(received.props[0]).toEqual({
        orgId: context.organization.id,
        role,
        writable: context.organization.writable,
      });
    },
  );

  it("un local ajeno: la guarda corta con su 404 y no se dibuja nada", async () => {
    vi.mocked(requireLocationContext).mockRejectedValue(
      new Error("NEXT_NOT_FOUND"),
    );

    await expect(
      renderPage("00000000-0000-4000-8000-000000000999"),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(received.props).toEqual([]);
  });
});
