import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PRODUCT_NAME } from "@/shared/lib/brand";

import { AuthShell } from "../auth-shell";

// Spec test-harness "Test de humo de componentes" y project-scaffold "Nombre del
// producto en la pantalla de ingreso": el marco de las pantallas de auth.

describe("AuthShell", () => {
  it("muestra el nombre del producto como encabezado de nivel 1 y el contenido", () => {
    render(
      <AuthShell>
        <p>Contenido de prueba</p>
      </AuthShell>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "[NOMBRE-PRODUCTO]" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Contenido de prueba")).toBeVisible();
  });

  it("toma el nombre de PRODUCT_NAME y deja un único encabezado de nivel 1 aunque el contenido tenga títulos", () => {
    render(
      <AuthShell>
        <h2>Ingresar</h2>
        <button type="button">Seguir</button>
      </AuthShell>,
    );

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(PRODUCT_NAME);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Ingresar",
    );
    expect(screen.getByRole("button", { name: "Seguir" })).toBeVisible();
  });

  it('dibuja un único <main id="contenido"> con el encabezado y el contenido adentro', () => {
    render(
      <AuthShell>
        <p>x</p>
      </AuthShell>,
    );

    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute("id", "contenido");
    expect(mains[0]).toContainElement(
      screen.getByRole("heading", { level: 1 }),
    );
    expect(mains[0]).toContainElement(screen.getByText("x"));
  });
});
