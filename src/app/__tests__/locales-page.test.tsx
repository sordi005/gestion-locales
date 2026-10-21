import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LocationsPage from "@/app/(app)/locales/page";
import { buildTenantContext } from "@/features/tenancy";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_CENTRO,
  LOC_SUR_ESTE,
  leakyRowsFor,
  rowsFor,
} from "@/features/tenancy/domain/__tests__/fixtures";
import type {
  SeedUserKey,
  TenantRowsFixture,
} from "@/features/tenancy/domain/__tests__/fixtures";
import { getTenantContext } from "@/features/tenancy/server";

// Spec tenant-context "Selector de local": `/locales` es una página protegida que
// lista los locales del contexto agrupados por organización. Con un solo local
// redirige a su inicio; sin ninguno, a la salida por falta de acceso (o, para el
// super-admin, a `/`, que dibuja su pantalla). Se simulan el contexto y la navegación.

vi.mock("@/features/tenancy/server", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/navigation", () => ({
  // Como el real, `redirect` no vuelve: lanza para cortar el render.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/features/auth/actions", () => ({ logout: vi.fn() }));
vi.mock("@/features/auth/logout-cleanup", () => ({
  runLogoutCleanups: vi.fn(async () => {}),
}));

function signInWith(rows: TenantRowsFixture) {
  vi.mocked(getTenantContext).mockResolvedValue(buildTenantContext(rows));
}
const signInAs = (user: SeedUserKey) => signInWith(rowsFor(user));

async function redirectTarget(): Promise<string | null> {
  try {
    await LocationsPage();
    return null;
  } catch (error) {
    const prefix = "NEXT_REDIRECT:";
    if (error instanceof Error && error.message.startsWith(prefix)) {
      return error.message.slice(prefix.length);
    }
    throw error;
  }
}

beforeEach(() => {
  vi.mocked(getTenantContext).mockReset();
});

describe("página /locales: con varios locales", () => {
  it("owner.sur ve los dos locales de su organización con su enlace", async () => {
    signInAs("owner.sur");

    render(await LocationsPage());

    const group = screen.getByRole("region", { name: "Almacén Demo Sur" });
    expect(
      within(group)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Local Centro", `/l/${LOC_SUR_CENTRO}`],
      ["Local Este", `/l/${LOC_SUR_ESTE}`],
    ]);
  });

  it("muestra el nombre de la persona y Cerrar sesión", async () => {
    signInAs("owner.sur");

    render(await LocationsPage());

    expect(screen.getByText("Dueño Demo Sur")).toBeVisible();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });

  it("un empleado asignado a dos de los tres locales ve solo esos dos", async () => {
    const rows = rowsFor("employee.sur");
    const membershipId = rows.memberships[0]?.id ?? "";
    rows.membershipLocations = [
      { membership_id: membershipId, location_id: LOC_SUR_CENTRO },
      { membership_id: membershipId, location_id: LOC_SUR_ESTE },
    ];
    rows.locations = [
      ...rows.locations,
      {
        id: "00000000-0000-4000-b000-0000000000ee",
        name: "Local Oeste",
        status: "active",
        organization_id: rows.organizations[0]?.id ?? "",
      },
    ];
    signInWith(rows);

    render(await LocationsPage());

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["Local Centro", "Local Este"],
    );
    expect(screen.queryByText("Local Oeste")).not.toBeInTheDocument();
  });

  it("con el peor caso de RLS (filas de todos) sigue mostrando solo los suyos", async () => {
    signInWith(leakyRowsFor("owner.sur"));

    render(await LocationsPage());

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual([`/l/${LOC_SUR_CENTRO}`, `/l/${LOC_SUR_ESTE}`]);
    expect(screen.queryByText("Kiosco Demo Norte")).not.toBeInTheDocument();
  });

  it("una organización suspendida aparece marcada", async () => {
    const rows = rowsFor("owner.sur");
    rows.organizations = rows.organizations.map((o) => ({
      ...o,
      status: "suspended",
    }));
    signInWith(rows);

    render(await LocationsPage());

    expect(
      within(
        screen.getByRole("region", { name: "Almacén Demo Sur" }),
      ).getByText("Suspendida"),
    ).toBeVisible();
  });
});

describe("página /locales: redirecciones", () => {
  it("con un solo local redirige a su inicio", async () => {
    signInAs("employee.norte");

    expect(await redirectTarget()).toBe(`/l/${LOC_NORTE_CENTRO}`);
  });

  it("sin ningún local y sin ser super-admin va a la salida por falta de acceso", async () => {
    const rows = rowsFor("employee.norte");
    rows.memberships = rows.memberships.map((m) => ({
      ...m,
      status: "disabled",
    }));
    signInWith(rows);

    expect(await redirectTarget()).toBe("/auth/sin-acceso");
  });

  it("el super-admin sin locales vuelve a / (que dibuja su pantalla), no a la salida", async () => {
    signInAs("admin");

    expect(await redirectTarget()).toBe("/");
  });

  it("sin sesión, la verificación redirige a /login", async () => {
    vi.mocked(getTenantContext).mockRejectedValue(
      new Error("NEXT_REDIRECT:/login"),
    );

    expect(await redirectTarget()).toBe("/login");
  });

  it("si la lectura del contexto falla, la página falla", async () => {
    vi.mocked(getTenantContext).mockRejectedValue(
      new Error("Could not read memberships (08006)"),
    );

    await expect(LocationsPage()).rejects.toThrow("Could not read");
  });
});
