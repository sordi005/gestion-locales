import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestPasswordReset } from "../../actions";
import type { RecoveryState } from "../../form-state";
import { RecoveryForm } from "../recovery-form";

// Spec auth-password-links "Pedido de recupero con respuesta neutra" y "Link
// vencido, usado o adulterado": campo de email, mensaje neutro tras el envío y
// aviso de link inválido con `role="alert"`. La acción (probada en
// `actions.test.ts`) se simula acá: solo importa cómo se muestra.

vi.mock("../../actions", () => ({ requestPasswordReset: vi.fn() }));

const NEUTRAL_MESSAGE =
  "Si ese email tiene una cuenta, te mandamos un link para elegir una contraseña nueva. Revisá también el correo no deseado.";
const INVALID_LINK_MESSAGE =
  "El link venció o ya se usó. Escribí tu email y te mandamos uno nuevo.";

function respondWith(state: RecoveryState) {
  vi.mocked(requestPasswordReset).mockResolvedValueOnce(state);
}

async function fillAndSubmit(email: string) {
  const user = userEvent.setup();
  if (email !== "") await user.type(screen.getByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: "Mandarme el link" }));
  return user;
}

beforeEach(() => {
  vi.mocked(requestPasswordReset).mockReset();
});

describe("RecoveryForm: estructura", () => {
  it("tiene el campo Email con su etiqueta y el botón Mandarme el link", () => {
    render(<RecoveryForm />);

    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("name", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(
      screen.getByRole("button", { name: "Mandarme el link" }),
    ).toHaveAttribute("type", "submit");
  });

  it("ofrece volver al ingreso", () => {
    render(<RecoveryForm />);

    expect(
      screen.getByRole("link", { name: "Volver a ingresar" }),
    ).toHaveAttribute("href", "/login");
  });

  it("no muestra ningún aviso ni error al abrirse", () => {
    render(<RecoveryForm />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("RecoveryForm: aviso de link inválido", () => {
  it("lo muestra arriba del formulario con role=alert cuando llega con error de link", () => {
    render(<RecoveryForm notice="link-invalid" />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(INVALID_LINK_MESSAGE);
    // Y la persona puede pedir otro link ahí mismo.
    const form = screen
      .getByRole("button", {
        name: "Mandarme el link",
      })
      .closest("form");
    expect(
      alert.compareDocumentPosition(form as HTMLFormElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sin el parámetro no muestra el aviso", () => {
    render(<RecoveryForm />);

    expect(screen.queryByText(INVALID_LINK_MESSAGE)).not.toBeInTheDocument();
  });
});

describe("RecoveryForm: envío", () => {
  it("manda el email a la acción", async () => {
    respondWith({});
    render(<RecoveryForm />);

    await fillAndSubmit("duena@e2e.test");

    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledTimes(1));
    const form = vi.mocked(requestPasswordReset).mock.calls[0]?.[1];
    expect(form?.get("email")).toBe("duena@e2e.test");
  });

  it("muestra el mensaje neutro como estado (no como error) y conserva el email", async () => {
    respondWith({
      sentMessage: NEUTRAL_MESSAGE,
      values: { email: "duena@e2e.test" },
    });
    render(<RecoveryForm />);

    await fillAndSubmit("duena@e2e.test");

    expect(await screen.findByRole("status")).toHaveTextContent(
      NEUTRAL_MESSAGE,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("duena@e2e.test");
  });

  it("el aviso de link inválido y el mensaje neutro no se pisan: tras pedir otro link queda el neutro", async () => {
    respondWith({
      sentMessage: NEUTRAL_MESSAGE,
      values: { email: "duena@e2e.test" },
    });
    render(<RecoveryForm notice="link-invalid" />);

    await fillAndSubmit("duena@e2e.test");

    expect(await screen.findByRole("status")).toHaveTextContent(
      NEUTRAL_MESSAGE,
    );
    expect(screen.queryByText(INVALID_LINK_MESSAGE)).not.toBeInTheDocument();
  });

  it("deshabilita el botón mientras la acción está en curso", async () => {
    let finish: (state: RecoveryState) => void = () => {};
    vi.mocked(requestPasswordReset).mockReturnValueOnce(
      new Promise<RecoveryState>((resolve) => {
        finish = resolve;
      }),
    );
    render(<RecoveryForm />);

    await fillAndSubmit("duena@e2e.test");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Mandarme el link" }),
      ).toBeDisabled(),
    );
    finish({});
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Mandarme el link" }),
      ).toBeEnabled(),
    );
  });
});

describe("RecoveryForm: errores del campo", () => {
  it("muestra el error asociado al campo, conserva lo escrito y le manda el foco", async () => {
    respondWith({
      fieldErrors: { email: "Escribí un email válido." },
      values: { email: "no-es-un-email" },
    });
    render(<RecoveryForm />);

    await fillAndSubmit("no-es-un-email");

    const email = await screen.findByLabelText("Email");
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Escribí un email válido.");
    expect(email).toHaveValue("no-es-un-email");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("un email vacío muestra su error", async () => {
    respondWith({ fieldErrors: { email: "Escribí tu email." } });
    render(<RecoveryForm />);

    await fillAndSubmit("");

    expect(await screen.findByLabelText("Email")).toHaveAccessibleDescription(
      "Escribí tu email.",
    );
  });
});
