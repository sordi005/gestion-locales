import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { login } from "../../actions";
import type { LoginState } from "../../form-state";
import { runLogoutCleanups } from "../../logout-cleanup";
import { LoginForm } from "../login-form";

// Spec auth-session "Ingreso con email y contraseña": etiquetas, `autocomplete`,
// errores anunciados con `role="alert"` y foco en el lugar del error. La acción
// (probada en `actions.test.ts`) se simula acá: solo importa cómo se muestra.

vi.mock("../../actions", () => ({ login: vi.fn() }));
vi.mock("../../logout-cleanup", () => ({
  runLogoutCleanups: vi.fn(async () => {}),
}));

const INVALID_CREDENTIALS = "El email o la contraseña no son correctos.";

function respondWith(state: LoginState) {
  vi.mocked(login).mockResolvedValueOnce(state);
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  if (email !== "") await user.type(screen.getByLabelText("Email"), email);
  if (password !== "") {
    await user.type(screen.getByLabelText("Contraseña"), password);
  }
  await user.click(screen.getByRole("button", { name: "Ingresar" }));
  return user;
}

beforeEach(() => {
  vi.mocked(login).mockReset();
  vi.mocked(runLogoutCleanups).mockClear();
});

describe("LoginForm: estructura", () => {
  it("tiene los campos Email y Contraseña con su etiqueta y autocomplete", () => {
    render(<LoginForm />);

    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("name", "email");
    expect(email).toHaveAttribute("autocomplete", "username");

    const password = screen.getByLabelText("Contraseña");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
  });

  it("tiene el botón Ingresar y el enlace para recuperar la contraseña", () => {
    render(<LoginForm />);

    expect(screen.getByRole("button", { name: "Ingresar" })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(
      screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" }),
    ).toHaveAttribute("href", "/recuperar-contrasena");
  });

  it("no muestra ningún aviso ni error al abrirse", () => {
    render(<LoginForm />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("LoginForm: aviso de contraseña guardada", () => {
  it("muestra el aviso como estado (no como error) cuando viene de definir la contraseña", () => {
    render(<LoginForm notice="password-saved" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Listo, guardamos tu contraseña. Ingresá con la nueva.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("LoginForm: envío", () => {
  it("manda email, contraseña y el next recibido a la acción", async () => {
    respondWith({});
    render(<LoginForm next="/l/123/vender?tab=1" />);

    await fillAndSubmit("duena@e2e.test", "mi-clave");

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    const form = vi.mocked(login).mock.calls[0]?.[1];
    expect(form?.get("email")).toBe("duena@e2e.test");
    expect(form?.get("password")).toBe("mi-clave");
    expect(form?.get("next")).toBe("/l/123/vender?tab=1");
  });

  it("sin next no manda ese campo (la acción vuelve a /)", async () => {
    respondWith({});
    render(<LoginForm />);

    await fillAndSubmit("duena@e2e.test", "mi-clave");

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(vi.mocked(login).mock.calls[0]?.[1].has("next")).toBe(false);
  });

  it("deshabilita el botón mientras la acción está en curso", async () => {
    let finish: (state: LoginState) => void = () => {};
    vi.mocked(login).mockReturnValueOnce(
      new Promise<LoginState>((resolve) => {
        finish = resolve;
      }),
    );
    render(<LoginForm />);

    await fillAndSubmit("duena@e2e.test", "mi-clave");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ingresar" })).toBeDisabled(),
    );
    finish({});
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ingresar" })).toBeEnabled(),
    );
  });
});

describe("LoginForm: errores", () => {
  it("anuncia el error general con role=alert, conserva el email y manda el foco a la contraseña", async () => {
    respondWith({
      formError: INVALID_CREDENTIALS,
      values: { email: "duena@e2e.test" },
    });
    render(<LoginForm />);

    await fillAndSubmit("duena@e2e.test", "equivocada");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      INVALID_CREDENTIALS,
    );
    expect(screen.getByLabelText("Email")).toHaveValue("duena@e2e.test");
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
    expect(screen.getByLabelText("Contraseña")).toHaveFocus();
  });

  it("muestra el error de cada campo asociado a su entrada y enfoca el primero con error", async () => {
    respondWith({
      fieldErrors: {
        email: "Escribí un email válido.",
        password: "Escribí tu contraseña.",
      },
      values: { email: "no-es-un-email" },
    });
    render(<LoginForm />);

    await fillAndSubmit("no-es-un-email", "");

    const email = await screen.findByLabelText("Email");
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Escribí un email válido.");

    const password = screen.getByLabelText("Contraseña");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAccessibleDescription("Escribí tu contraseña.");
  });

  it("enfoca la contraseña cuando solo ese campo tiene error", async () => {
    respondWith({
      fieldErrors: { password: "Escribí tu contraseña." },
      values: { email: "duena@e2e.test" },
    });
    render(<LoginForm />);

    await fillAndSubmit("duena@e2e.test", "");

    await waitFor(() =>
      expect(screen.getByLabelText("Contraseña")).toHaveFocus(),
    );
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Email")).toHaveValue("duena@e2e.test");
  });

  it("el mensaje de demasiados intentos también se anuncia como alerta", async () => {
    respondWith({
      formError: "Demasiados intentos. Esperá unos minutos y probá de nuevo.",
      values: { email: "duena@e2e.test" },
    });
    render(<LoginForm />);

    await fillAndSubmit("duena@e2e.test", "x");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Demasiados intentos. Esperá unos minutos y probá de nuevo.",
    );
  });
});

describe("LoginForm: limpieza de datos locales", () => {
  it("corre la limpieza de la persona anterior al abrirse, una sola vez", () => {
    render(<LoginForm />);

    expect(runLogoutCleanups).toHaveBeenCalledTimes(1);
  });

  it("no la vuelve a correr cuando el formulario se actualiza con un error", async () => {
    respondWith({
      formError: INVALID_CREDENTIALS,
      values: { email: "duena@e2e.test" },
    });
    render(<LoginForm />);

    await fillAndSubmit("duena@e2e.test", "equivocada");
    await screen.findByRole("alert");

    expect(runLogoutCleanups).toHaveBeenCalledTimes(1);
  });
});
