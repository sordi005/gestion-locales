import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NoAccessPage from "@/app/auth/sin-acceso/page";
import type { TenantContext } from "@/features/tenancy";
import { getTenantContext } from "@/features/tenancy/server";

import { signOutNoAccess } from "../actions";

// Spec tenant-context "Salida por falta de acceso" (D8): la PÁGINA nunca cierra
// la sesión (un GET no puede escribir cookies ni debe desloguear a nadie): con
// acceso (o super-admin) redirige a `/`; sin acceso dibuja el texto de estado y un
// formulario con "Volver al ingreso" (funciona sin JavaScript) más el envío
// automático. Se simulan la lectura del contexto, la acción y el componente que
// envía solo (en jsdom dispararía la acción de verdad).

vi.mock("@/features/tenancy/server", () => ({ getTenantContext: vi.fn() }));
vi.mock("../actions", () => ({ signOutNoAccess: vi.fn() }));
vi.mock("../auto-submit", () => ({
  AutoSubmit: () => <span data-testid="auto-submit" />,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const USER = {
  id: "10000000-0000-4000-8000-000000000003",
  email: "empleado@demo.test",
  displayName: "Empleado",
};

const WITH_ACCESS: TenantContext = {
  user: USER,
  isPlatformAdmin: false,
  organizations: [
    {
      id: "00000000-0000-4000-a000-000000000001",
      name: "Kiosco",
      status: "active",
      writable: true,
      role: "employee",
      locations: [
        { id: "00000000-0000-4000-b000-000000000001", name: "Centro" },
      ],
    },
  ],
};
const NO_ACCESS: TenantContext = {
  user: USER,
  isPlatformAdmin: false,
  organizations: [],
};
const PLATFORM_ADMIN: TenantContext = {
  user: { ...USER, email: "admin@demo.test", displayName: "Admin" },
  isPlatformAdmin: true,
  organizations: [],
};

beforeEach(() => {
  vi.mocked(getTenantContext).mockReset();
  vi.mocked(signOutNoAccess).mockReset();
});

describe("página /auth/sin-acceso", () => {
  it.each([
    ["una persona con un local", WITH_ACCESS],
    ["el super-admin", PLATFORM_ADMIN],
  ])(
    "con acceso (%s) redirige a / sin dibujar nada",
    async (_name, context) => {
      vi.mocked(getTenantContext).mockResolvedValue(context);

      await expect(NoAccessPage()).rejects.toThrow("NEXT_REDIRECT:/");
      expect(signOutNoAccess).not.toHaveBeenCalled();
    },
  );

  it("sin acceso explica la situación con un texto que vale con y sin JavaScript (nunca 'Cerrando sesión…': eso lo dice el envío automático)", async () => {
    vi.mocked(getTenantContext).mockResolvedValue(NO_ACCESS);

    render(await NoAccessPage());

    expect(
      screen.getByText(/Tu usuario no tiene acceso a ningún local/),
    ).toBeVisible();
    expect(screen.queryByText(/Cerrando sesión/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("sin acceso dibuja el botón visible y el envío automático dentro del formulario", async () => {
    vi.mocked(getTenantContext).mockResolvedValue(NO_ACCESS);

    const { container } = render(await NoAccessPage());

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    const button = within(form as HTMLFormElement).getByRole("button", {
      name: "Volver al ingreso",
    });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toBeVisible();
    expect(
      within(form as HTMLFormElement).getByTestId("auto-submit"),
    ).toBeInTheDocument();
  });

  it("dibujarla NO cierra la sesión: no llama a la acción ni a ningún signOut", async () => {
    vi.mocked(getTenantContext).mockResolvedValue(NO_ACCESS);

    render(await NoAccessPage());

    expect(signOutNoAccess).not.toHaveBeenCalled();
  });

  it("sin sesión, la verificación redirige a /login (el proxy ya lo habría hecho)", async () => {
    vi.mocked(getTenantContext).mockRejectedValue(
      new Error("NEXT_REDIRECT:/login"),
    );

    await expect(NoAccessPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("si la lectura del contexto falla, la página falla (no dibuja la salida)", async () => {
    vi.mocked(getTenantContext).mockRejectedValue(
      new Error("Could not read memberships (08006)"),
    );

    await expect(NoAccessPage()).rejects.toThrow("Could not read");
  });

  it("lee el contexto una sola vez", async () => {
    vi.mocked(getTenantContext).mockResolvedValue(NO_ACCESS);

    await NoAccessPage();

    expect(getTenantContext).toHaveBeenCalledTimes(1);
  });
});
