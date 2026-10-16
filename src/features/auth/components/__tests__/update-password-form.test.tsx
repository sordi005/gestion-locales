import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logout, updatePassword } from "../../actions";
import type { UpdatePasswordState } from "../../form-state";
import { UpdatePasswordForm } from "../update-password-form";

// Spec auth-password-links "Definir la contraseña": dos campos `new-password`,
// "Guardar contraseña" y "Cancelar" (cierra la sesión). Las acciones (probadas
// en `update-password-action.test.ts` y `actions.test.ts`) se simulan acá.

vi.mock("../../actions", () => ({ updatePassword: vi.fn(), logout: vi.fn() }));

const MISMATCH = "Las contraseñas no coinciden.";

function respondWith(state: UpdatePasswordState) {
  vi.mocked(updatePassword).mockResolvedValueOnce(state);
}

async function fillAndSubmit(password: string, confirmPassword: string) {
  const user = userEvent.setup();
  if (password !== "") {
    await user.type(screen.getByLabelText("Contraseña nueva"), password);
  }
  if (confirmPassword !== "") {
    await user.type(
      screen.getByLabelText("Repetir contraseña"),
      confirmPassword,
    );
  }
  await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
  return user;
}

beforeEach(() => {
  vi.mocked(updatePassword).mockReset();
  vi.mocked(logout).mockReset();
});

describe("UpdatePasswordForm: estructura", () => {
  it("tiene los dos campos de contraseña nueva con su etiqueta y autocomplete", () => {
    render(<UpdatePasswordForm />);

    const password = screen.getByLabelText("Contraseña nueva");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");

    const confirm = screen.getByLabelText("Repetir contraseña");
    expect(confirm).toHaveAttribute("type", "password");
    expect(confirm).toHaveAttribute("name", "confirmPassword");
    expect(confirm).toHaveAttribute("autocomplete", "new-password");
  });

  it("tiene los botones Guardar contraseña y Cancelar", () => {
    render(<UpdatePasswordForm />);

    expect(
      screen.getByRole("button", { name: "Guardar contraseña" }),
    ).toHaveAttribute("type", "submit");
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
  });

  it("dice cuál es el mínimo de la contraseña", () => {
    render(<UpdatePasswordForm />);

    expect(screen.getByText(/al menos 8 caracteres/i)).toBeInTheDocument();
  });

  it("no muestra ningún aviso ni error al abrirse", () => {
    render(<UpdatePasswordForm />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("UpdatePasswordForm: envío", () => {
  it("manda las dos contraseñas a la acción", async () => {
    respondWith({});
    render(<UpdatePasswordForm />);

    await fillAndSubmit("una clave larga", "una clave larga");

    await waitFor(() => expect(updatePassword).toHaveBeenCalledTimes(1));
    const form = vi.mocked(updatePassword).mock.calls[0]?.[1];
    expect(form?.get("password")).toBe("una clave larga");
    expect(form?.get("confirmPassword")).toBe("una clave larga");
    expect(logout).not.toHaveBeenCalled();
  });

  it("deshabilita Guardar mientras la acción está en curso", async () => {
    let finish: (state: UpdatePasswordState) => void = () => {};
    vi.mocked(updatePassword).mockReturnValueOnce(
      new Promise<UpdatePasswordState>((resolve) => {
        finish = resolve;
      }),
    );
    render(<UpdatePasswordForm />);

    await fillAndSubmit("una clave larga", "una clave larga");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Guardar contraseña" }),
      ).toBeDisabled(),
    );
    finish({});
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Guardar contraseña" }),
      ).toBeEnabled(),
    );
  });
});

describe("UpdatePasswordForm: Cancelar", () => {
  it("llama a la acción de cerrar sesión y no guarda ninguna contraseña", async () => {
    render(<UpdatePasswordForm />);

    // Aunque haya algo escrito, Cancelar no manda las contraseñas a ningún lado.
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Contraseña nueva"),
      "a medio escribir",
    );
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("no manda el contenido de los campos de contraseña a la acción de cerrar sesión", async () => {
    render(<UpdatePasswordForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Contraseña nueva"), "secreta-12345");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    const args = vi.mocked(logout).mock.calls[0] as unknown[];
    const form = args[0] as FormData | undefined;
    expect(form?.get("password") ?? null).toBeNull();
  });
});

describe("UpdatePasswordForm: errores", () => {
  it("anuncia el error de la acción con role=alert y manda el foco a la contraseña nueva", async () => {
    respondWith({
      formError: "Elegí una contraseña distinta de la anterior.",
    });
    render(<UpdatePasswordForm />);

    await fillAndSubmit("una clave larga", "una clave larga");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elegí una contraseña distinta de la anterior.",
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Contraseña nueva")).toHaveFocus(),
    );
  });

  it("muestra el error de cada campo asociado a su entrada y enfoca el primero con error", async () => {
    respondWith({
      fieldErrors: {
        password: "La contraseña tiene que tener al menos 8 caracteres.",
        confirmPassword: MISMATCH,
      },
    });
    render(<UpdatePasswordForm />);

    await fillAndSubmit("corta", "otra");

    const password = await screen.findByLabelText("Contraseña nueva");
    await waitFor(() => expect(password).toHaveFocus());
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAccessibleDescription(
      "La contraseña tiene que tener al menos 8 caracteres.",
    );
    expect(
      screen.getByLabelText("Repetir contraseña"),
    ).toHaveAccessibleDescription(MISMATCH);
  });

  it("si solo la repetición tiene error, enfoca ese campo", async () => {
    respondWith({ fieldErrors: { confirmPassword: MISMATCH } });
    render(<UpdatePasswordForm />);

    await fillAndSubmit("una clave larga", "otra distinta");

    await waitFor(() =>
      expect(screen.getByLabelText("Repetir contraseña")).toHaveFocus(),
    );
    expect(screen.getByLabelText("Contraseña nueva")).not.toHaveAttribute(
      "aria-invalid",
    );
  });
});
