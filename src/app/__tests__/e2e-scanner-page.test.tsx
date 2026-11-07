import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import E2eScannerPage from "@/app/e2e/escaner/page";
import { requireUser } from "@/features/auth/server";

// Tarea 9.2: la página de prueba del escáner (`/e2e/escaner`) solo existe con
// `E2E_HARNESS=1` (Playwright la define en el `webServer`; Vercel nunca): sin la
// variable da 404 y NO consulta la sesión. Con la variable pide sesión como
// cualquier página protegida y dibuja el escáner.

vi.mock("@/features/auth/server", () => ({ requireUser: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({
  // Como el real, `notFound` no vuelve: lanza para cortar el render.
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

beforeEach(() => {
  vi.mocked(requireUser).mockResolvedValue({
    id: "u1",
    email: "empleado@example.com",
  } as Awaited<ReturnType<typeof requireUser>>);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/e2e/escaner: la guarda", () => {
  it.each([
    ["sin la variable", undefined],
    ["vacía", ""],
    ["en 0", "0"],
    ["en true", "true"],
  ])(
    "responde 404 y no mira la sesión con E2E_HARNESS %s",
    async (_, value) => {
      vi.stubEnv("E2E_HARNESS", value);

      await expect(E2eScannerPage()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(requireUser).not.toHaveBeenCalled();
    },
  );

  it("con E2E_HARNESS=1 exige la sesión y dibuja la página", async () => {
    vi.stubEnv("E2E_HARNESS", "1");

    render(await E2eScannerPage());

    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("textbox", { name: "Código de barras" }),
    ).toBeVisible();
  });

  it("con E2E_HARNESS=1 y sin sesión, la redirección de requireUser corta la página", async () => {
    vi.stubEnv("E2E_HARNESS", "1");
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(E2eScannerPage()).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("/e2e/escaner: el arnés", () => {
  async function setup() {
    vi.stubEnv("E2E_HARNESS", "1");
    render(await E2eScannerPage());
    return userEvent.setup({ delay: 40 });
  }

  it("lista una lectura tipeada con origen, código y multiplicador", async () => {
    const user = await setup();
    const input = screen.getByRole("textbox", { name: "Código de barras" });

    await user.type(input, "7790001000019{Enter}");
    await user.type(input, "3*7791234567898{Enter}");

    const list = screen.getByRole("list", { name: "Lecturas" });
    const items = Array.from(list.querySelectorAll("li")).map(
      (li) => li.textContent,
    );
    expect(items).toEqual(["manual 7790001000019", "manual 7791234567898 x3"]);
  });

  it("lista los avisos: rechazos con su motivo", async () => {
    const user = await setup();
    const input = screen.getByRole("textbox", { name: "Código de barras" });

    await user.type(input, "12ab{Enter}");

    const items = Array.from(
      screen.getByRole("list", { name: "Lecturas" }).querySelectorAll("li"),
    ).map((li) => li.textContent);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatch(/^rejected manual /);
  });

  it("el botón de prueba cuenta los clics", async () => {
    const user = await setup();
    const button = screen.getByRole("button", { name: "Botón de prueba" });
    expect(screen.getByTestId("clicks")).toHaveTextContent("0");

    await user.click(button);
    await user.click(button);

    expect(screen.getByTestId("clicks")).toHaveTextContent("2");
  });

  it("la cámara solo se monta al prender 'Mostrar cámara' y 'Continuo' / 'Un disparo' elige el modo", async () => {
    const user = await setup();
    expect(
      screen.queryByRole("button", { name: "Escanear con la cámara" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Mostrar cámara" }));

    const camera = document.querySelector("[data-mode]");
    expect(camera).toHaveAttribute("data-mode", "continuous");
    expect(
      screen.getByRole("button", { name: "Escanear con la cámara" }),
    ).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "Un disparo" }));
    expect(document.querySelector("[data-mode]")).toHaveAttribute(
      "data-mode",
      "single",
    );

    await user.click(screen.getByRole("checkbox", { name: "Mostrar cámara" }));
    expect(document.querySelector("[data-mode]")).toBeNull();
  });
});

describe("/e2e/escaner: señal de hidratación", () => {
  it("marca data-ready en el <main> cuando el escáner ya escucha", async () => {
    vi.stubEnv("E2E_HARNESS", "1");
    render(await E2eScannerPage());

    expect(screen.getByRole("main")).toHaveAttribute("data-ready", "true");
  });
});
