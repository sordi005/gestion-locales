import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmLink } from "../../actions";
import { ConfirmLinkForm } from "../confirm-link-form";

// Spec auth-password-links "Confirmación del link en dos pasos": el GET muestra un
// texto según el tipo y el botón "Continuar"; recién al enviarlo (POST) la acción
// verifica el token. La acción (probada en `actions.test.ts`) se simula acá.

vi.mock("../../actions", () => ({ confirmLink: vi.fn() }));

const TOKEN_HASH = "pkce_3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c";

beforeEach(() => {
  vi.mocked(confirmLink).mockReset();
});

describe("ConfirmLinkForm: texto según el tipo", () => {
  it("invitación: te invitaron y crear la contraseña", () => {
    render(<ConfirmLinkForm type="invite" tokenHash={TOKEN_HASH} />);

    expect(
      screen.getByText(
        "Te invitaron a [NOMBRE-PRODUCTO]. Tocá Continuar para crear tu contraseña.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continuar" }),
    ).toBeInTheDocument();
  });

  it("recupero: elegir una contraseña nueva", () => {
    render(<ConfirmLinkForm type="recovery" tokenHash={TOKEN_HASH} />);

    expect(
      screen.getByText("Tocá Continuar para elegir una contraseña nueva."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continuar" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Te invitaron/)).not.toBeInTheDocument();
  });

  it("no muestra ningún error ni aviso al abrirse", () => {
    render(<ConfirmLinkForm type="recovery" tokenHash={TOKEN_HASH} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("ConfirmLinkForm: envío", () => {
  it.each(["invite", "recovery"] as const)(
    "no llama a la acción hasta que se toca Continuar y entonces manda el token y el tipo (%s)",
    async (type) => {
      render(<ConfirmLinkForm type={type} tokenHash={TOKEN_HASH} />);

      // Solo mostrar la pantalla no verifica nada.
      expect(confirmLink).not.toHaveBeenCalled();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Continuar" }));

      await waitFor(() => expect(confirmLink).toHaveBeenCalledTimes(1));
      const form = vi.mocked(confirmLink).mock.calls[0]?.[0];
      expect(form?.get("token_hash")).toBe(TOKEN_HASH);
      expect(form?.get("type")).toBe(type);
    },
  );

  it("deshabilita el botón mientras la acción corre (un doble toque gastaría el link dos veces)", async () => {
    let finish: () => void = () => {};
    vi.mocked(confirmLink).mockReturnValueOnce(
      new Promise<never>((resolve) => {
        finish = () => resolve(undefined as never);
      }),
    );
    render(<ConfirmLinkForm type="recovery" tokenHash={TOKEN_HASH} />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled(),
    );
    finish();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled(),
    );
  });
});
