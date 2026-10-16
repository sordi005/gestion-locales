import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormField } from "../form-field";

// Pieza compartida por los formularios de auth: etiqueta + campo + mensaje de error
// asociados de forma que un lector de pantalla los lea juntos.

describe("FormField", () => {
  it("asocia la etiqueta con el campo y pasa los atributos al <input>", () => {
    render(
      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        defaultValue="duena@e2e.test"
      />,
    );

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("name", "email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("autocomplete", "username");
    expect(input).toHaveValue("duena@e2e.test");
  });

  it("sin error no marca el campo como inválido ni lo describe", () => {
    render(<FormField label="Contraseña" name="password" type="password" />);

    const input = screen.getByLabelText("Contraseña");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAccessibleDescription();
  });

  it("con error lo muestra, marca el campo inválido y lo usa como su descripción", () => {
    render(
      <FormField
        label="Contraseña"
        name="password"
        type="password"
        error="Escribí tu contraseña."
      />,
    );

    const input = screen.getByLabelText("Contraseña");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Escribí tu contraseña.");
    expect(screen.getByText("Escribí tu contraseña.")).toBeVisible();
  });

  it("dos campos en la misma pantalla no comparten ids", () => {
    render(
      <>
        <FormField
          label="Contraseña nueva"
          name="password"
          error="Muy corta."
        />
        <FormField
          label="Repetir contraseña"
          name="confirmPassword"
          error="No coinciden."
        />
      </>,
    );

    expect(
      screen.getByLabelText("Contraseña nueva"),
    ).toHaveAccessibleDescription("Muy corta.");
    expect(
      screen.getByLabelText("Repetir contraseña"),
    ).toHaveAccessibleDescription("No coinciden.");
  });
});
