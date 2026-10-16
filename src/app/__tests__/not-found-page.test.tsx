import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";

// Pantalla de "página inexistente" (`src/app/not-found.tsx`). Regla dura 4: todo
// texto visible al usuario va en castellano (sin esta pantalla Next mostraba su
// 404 en inglés). Se usa con teclado en la PC del mostrador: el enlace de
// vuelta al inicio tiene que ser alcanzable con Tab.

describe("not-found.tsx", () => {
  it("avisa en castellano que la página no existe, con un encabezado", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "No encontramos esta página",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/La dirección no existe o ya no está disponible/),
    ).toBeInTheDocument();
  });

  it("no deja ningún texto en inglés de la pantalla por defecto de Next", () => {
    render(<NotFound />);

    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/could not be found/i)).not.toBeInTheDocument();
  });

  it("ofrece un enlace para volver al inicio, que apunta a /", () => {
    render(<NotFound />);

    const link = screen.getByRole("link", { name: "Volver al inicio" });

    expect(link).toHaveAttribute("href", "/");
  });

  it("el enlace se alcanza con el teclado: es lo primero que recibe el foco con Tab", async () => {
    render(<NotFound />);

    await userEvent.setup().tab();

    expect(
      screen.getByRole("link", { name: "Volver al inicio" }),
    ).toHaveFocus();
  });

  it("no crea otro <main> ni otro enlace de más (el landmark es el del layout raíz)", () => {
    render(<NotFound />);

    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
