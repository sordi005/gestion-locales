import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PRODUCT_NAME } from "@/shared/lib/brand";

import { PlatformAdminHome } from "../platform-admin-home";

// Spec tenant-context "Pantalla provisoria del super-admin" (D9): nombre del
// producto, "Hola, {nombre}", el texto del panel que llega después y "Cerrar
// sesión". Mientras C-07 no construya `/admin`, esta pantalla reemplaza al panel.

vi.mock("@/features/auth/actions", () => ({ logout: vi.fn() }));
vi.mock("@/features/auth/logout-cleanup", () => ({
  runLogoutCleanups: vi.fn(async () => {}),
}));

describe("PlatformAdminHome", () => {
  it("saluda por el nombre en un encabezado de nivel 1", () => {
    render(<PlatformAdminHome displayName="Admin Demo" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Hola, Admin Demo" }),
    ).toBeInTheDocument();
  });

  it('dibuja un único <main id="contenido"> con el saludo adentro', () => {
    render(<PlatformAdminHome displayName="Admin Demo" />);

    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute("id", "contenido");
    expect(mains[0]).toContainElement(
      screen.getByRole("heading", { level: 1 }),
    );
    expect(mains[0]).toContainElement(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    );
  });

  it("muestra el nombre del producto, el texto del panel y el botón Cerrar sesión", () => {
    render(<PlatformAdminHome displayName="Admin Demo" />);

    expect(screen.getByText(PRODUCT_NAME)).toBeVisible();
    expect(
      screen.getByText("El panel de administración llega en un próximo paso."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });

  it("saluda por otro nombre, y por el email cuando el nombre mostrado es el email", () => {
    const { rerender } = render(
      <PlatformAdminHome displayName="Lucía Pérez" />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Hola, Lucía Pérez" }),
    ).toBeInTheDocument();

    rerender(<PlatformAdminHome displayName="admin@e2e.test" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Hola, admin@e2e.test" }),
    ).toBeInTheDocument();
  });
});
