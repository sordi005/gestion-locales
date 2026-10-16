import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ErrorPage from "@/app/error";
import { logout } from "@/features/auth/actions";

// Pantalla de error inesperado (`src/app/error.tsx`): en la PC compartida del
// mostrador una falla no puede dejar a la persona trabada. Ofrece reintentar y
// "Cerrar sesión" (un formulario común hacia la Server Action `logout`, que
// funciona aunque la sesión ya no exista). Solo se simula el borde: la acción.

vi.mock("@/features/auth/actions", () => ({ logout: vi.fn() }));

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(logout).mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

function renderError(
  error: Error & { digest?: string } = new Error("falla interna"),
  reset: () => void = vi.fn(),
) {
  render(<ErrorPage error={error} reset={reset} />);
  return { reset };
}

describe("error.tsx", () => {
  it("avisa en castellano que algo salió mal, con un encabezado", () => {
    renderError();

    expect(
      screen.getByRole("heading", { level: 1, name: "Algo salió mal" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Ocurrió un problema inesperado/),
    ).toBeInTheDocument();
  });

  it("no muestra el mensaje técnico del error ni su digest", () => {
    renderError(
      Object.assign(new Error("password=secreto relation profiles"), {
        digest: "1234567890",
      }),
    );

    expect(screen.queryByText(/secreto/)).not.toBeInTheDocument();
    expect(screen.queryByText(/relation profiles/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1234567890/)).not.toBeInTheDocument();
  });

  it("registra el error en la consola para poder diagnosticarlo", () => {
    const error = new Error("falla interna");

    renderError(error);

    expect(consoleError).toHaveBeenCalledWith(error);
  });

  describe("Probar de nuevo", () => {
    it("vuelve a intentar con reset, una sola vez por toque", async () => {
      const { reset } = renderError();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Probar de nuevo" }));

      expect(reset).toHaveBeenCalledTimes(1);
      expect(logout).not.toHaveBeenCalled();
    });

    it("se puede usar con el teclado (Enter)", async () => {
      const { reset } = renderError();
      const user = userEvent.setup();

      await user.tab();
      expect(
        screen.getByRole("button", { name: "Probar de nuevo" }),
      ).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  describe("Cerrar sesión", () => {
    it("es un botón de envío dentro de un formulario común (funciona sin que corra el resto de la app)", () => {
      renderError();

      const button = screen.getByRole("button", { name: "Cerrar sesión" });

      expect(button).toHaveAttribute("type", "submit");
      expect(button.closest("form")).not.toBeNull();
    });

    it("al enviarlo llama a la Server Action logout, sin reintentar", async () => {
      const { reset } = renderError();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Cerrar sesión" }));

      await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
      expect(reset).not.toHaveBeenCalled();
    });

    it("también con el teclado: Tab hasta el botón y Enter", async () => {
      renderError();
      const user = userEvent.setup();

      await user.tab();
      await user.tab();
      expect(
        screen.getByRole("button", { name: "Cerrar sesión" }),
      ).toHaveFocus();
      await user.keyboard("{Enter}");

      await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    });
  });
});
