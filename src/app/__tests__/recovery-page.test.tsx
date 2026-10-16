import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RecoveryPage from "@/app/(auth)/recuperar-contrasena/page";

// Spec auth-password-links "Link vencido, usado o adulterado": `/recuperar-contrasena`
// muestra el aviso de link inválido arriba del formulario solo cuando llega con
// `?error=link`. La acción se simula: acá solo importa lo que muestra la página.

vi.mock("@/features/auth/actions", () => ({ requestPasswordReset: vi.fn() }));

const INVALID_LINK_MESSAGE =
  "El link venció o ya se usó. Escribí tu email y te mandamos uno nuevo.";

async function renderPage(searchParams: Record<string, string | string[]>) {
  render(
    await RecoveryPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

describe("página /recuperar-contrasena", () => {
  it("sin parámetros muestra el formulario de pedido y ningún aviso", async () => {
    await renderPage({});

    expect(
      screen.getByRole("button", { name: "Mandarme el link" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(INVALID_LINK_MESSAGE)).not.toBeInTheDocument();
  });

  it("con error=link muestra el aviso de link inválido con role=alert", async () => {
    await renderPage({ error: "link" });

    expect(screen.getByRole("alert")).toHaveTextContent(INVALID_LINK_MESSAGE);
    expect(
      screen.getByRole("button", { name: "Mandarme el link" }),
    ).toBeInTheDocument();
  });

  it("con el parámetro repetido toma el primero", async () => {
    await renderPage({ error: ["link", "otro"] });

    expect(screen.getByRole("alert")).toHaveTextContent(INVALID_LINK_MESSAGE);
  });

  it.each(["otro", "", "LINK"])(
    "con error=%j no muestra el aviso (solo se reconoce exactamente link)",
    async (error) => {
      await renderPage({ error });

      expect(screen.queryByText(INVALID_LINK_MESSAGE)).not.toBeInTheDocument();
    },
  );
});
