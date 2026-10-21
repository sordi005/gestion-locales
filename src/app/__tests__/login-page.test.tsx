import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LoginPage from "@/app/(auth)/login/page";

// Spec tenant-context "Salida por falta de acceso" y auth-password-links: `/login`
// muestra el aviso que pide `?aviso=…` (como estado, `role="status"`) solo cuando
// el valor es uno de los conocidos. La acción de ingreso se simula.

vi.mock("@/features/auth/actions", () => ({ login: vi.fn() }));
vi.mock("@/features/auth/logout-cleanup", () => ({
  runLogoutCleanups: vi.fn(async () => {}),
}));

const NO_ACCESS =
  "Tu usuario no tiene acceso a ningún local. Si creés que es un error, hablá con el dueño del comercio.";
const PASSWORD_SAVED = "Listo, guardamos tu contraseña. Ingresá con la nueva.";

async function renderPage(searchParams: Record<string, string | string[]>) {
  render(
    await LoginPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

describe("página /login: avisos por ?aviso=", () => {
  it("sin parámetros no muestra ningún aviso", async () => {
    await renderPage({});

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aviso=sin-acceso muestra el texto exacto con role=status", async () => {
    await renderPage({ aviso: "sin-acceso" });

    expect(screen.getByRole("status")).toHaveTextContent(NO_ACCESS);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeVisible();
  });

  it("aviso=contrasena-actualizada sigue mostrando el de contraseña guardada", async () => {
    await renderPage({ aviso: "contrasena-actualizada" });

    expect(screen.getByRole("status")).toHaveTextContent(PASSWORD_SAVED);
  });

  it("con el parámetro repetido toma el primero", async () => {
    await renderPage({ aviso: ["sin-acceso", "contrasena-actualizada"] });

    expect(screen.getByRole("status")).toHaveTextContent(NO_ACCESS);
  });

  it.each(["otro", "", "SIN-ACCESO", "toString"])(
    "aviso=%j desconocido no muestra nada",
    async (aviso) => {
      await renderPage({ aviso });

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );
});
