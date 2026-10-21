import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import UpdatePasswordPage from "@/app/(auth)/actualizar-contrasena/page";
import { requirePasswordSetup } from "@/features/auth/server";

// Spec auth-session "Sesión de definir contraseña" y auth-password-links
// "Definir la contraseña": `/actualizar-contrasena` verifica en el servidor que
// haya una sesión de definir contraseña vigente (sin depender del proxy) antes de
// mostrar el formulario; si no la hay, `requirePasswordSetup` redirige y no vuelve.

vi.mock("@/features/auth/server", () => ({ requirePasswordSetup: vi.fn() }));
vi.mock("@/features/auth/actions", () => ({
  updatePassword: vi.fn(),
  logout: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(requirePasswordSetup).mockReset();
});

describe("página /actualizar-contrasena", () => {
  it("con una sesión de definir contraseña vigente muestra el formulario", async () => {
    vi.mocked(requirePasswordSetup).mockResolvedValue({
      id: "9c2f0c1e-user",
      email: "duena@e2e.test",
    });

    render(await UpdatePasswordPage());

    expect(requirePasswordSetup).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Cuenta: duena@e2e.test")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña nueva")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar contraseña" }),
    ).toBeInTheDocument();
  });

  it("el email sale de la sesión verificada en el servidor y llega al formulario como username", async () => {
    vi.mocked(requirePasswordSetup).mockResolvedValue({
      id: "11111111-user",
      email: "otra.persona@e2e.test",
    });

    const { container } = render(await UpdatePasswordPage());

    expect(
      screen.getByText("Cuenta: otra.persona@e2e.test"),
    ).toBeInTheDocument();
    expect(container.querySelector('input[name="username"]')).toHaveValue(
      "otra.persona@e2e.test",
    );
  });

  it("sin sesión vigente no muestra el formulario: deja pasar la redirección", async () => {
    vi.mocked(requirePasswordSetup).mockImplementation(async () => {
      throw new Error("NEXT_REDIRECT:/login");
    });

    await expect(UpdatePasswordPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(screen.queryByLabelText("Contraseña nueva")).not.toBeInTheDocument();
  });
});
