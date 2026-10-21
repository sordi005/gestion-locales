import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthNotice } from "../auth-notice";

// Un solo componente para los avisos de las pantallas de auth: "link inválido"
// (error: `role="alert"`), "contraseña guardada" y "link mandado" (estados:
// `role="status"`, no interrumpen al lector de pantalla como un error).

describe("AuthNotice", () => {
  it("link-invalid: se anuncia como alerta con el texto de US-003", () => {
    render(<AuthNotice kind="link-invalid" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "El link venció o ya se usó. Escribí tu email y te mandamos uno nuevo.",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("password-saved: se anuncia como estado (no como error)", () => {
    render(<AuthNotice kind="password-saved" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Listo, guardamos tu contraseña. Ingresá con la nueva.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("no-access: se anuncia como estado, sin nombrar al comercio", () => {
    render(<AuthNotice kind="no-access" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Tu usuario no tiene acceso a ningún local. Si creés que es un error, hablá con el dueño del comercio.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    "Si ese email tiene una cuenta, te mandamos un link.",
    "Otro texto que decide el servidor.",
  ])(
    "reset-sent: muestra como estado el mensaje que recibe (%s)",
    (message) => {
      render(<AuthNotice kind="reset-sent" message={message} />);

      expect(screen.getByRole("status")).toHaveTextContent(message);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );
});
