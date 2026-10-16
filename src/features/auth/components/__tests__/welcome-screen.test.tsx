import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WelcomeScreen } from "../welcome-screen";

// Spec auth-session "Pantalla de bienvenida provisoria": el saludo con el nombre
// (o el email si no hay nombre) y el botón para cerrar sesión.

vi.mock("../../actions", () => ({ logout: vi.fn() }));

describe("WelcomeScreen", () => {
  it("saluda por su nombre en un encabezado de nivel 1 y ofrece cerrar sesión", () => {
    render(
      <WelcomeScreen
        fullName="Dueño Demo Norte"
        email="owner.norte@demo.test"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Hola, Dueño Demo Norte" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Muy pronto vas a ver acá tu local."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });

  it("saluda por otro nombre sin mostrar el email", () => {
    render(<WelcomeScreen fullName="Lucía Pérez" email="lucia@e2e.test" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Hola, Lucía Pérez" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/lucia@e2e.test/)).not.toBeInTheDocument();
  });

  it("sin nombre (NULL) saluda por el email", () => {
    render(<WelcomeScreen fullName={null} email="sin.nombre@e2e.test" />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Hola, sin.nombre@e2e.test",
      }),
    ).toBeInTheDocument();
  });

  it.each(["", "   "])(
    "un nombre vacío (%j) tampoco sirve para saludar: usa el email",
    (fullName) => {
      render(<WelcomeScreen fullName={fullName} email="vacio@e2e.test" />);

      expect(
        screen.getByRole("heading", { level: 1, name: "Hola, vacio@e2e.test" }),
      ).toBeInTheDocument();
    },
  );

  it("ignora los espacios que rodean al nombre", () => {
    render(<WelcomeScreen fullName="  Ana  " email="ana@e2e.test" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Hola, Ana" }),
    ).toBeInTheDocument();
  });
});
