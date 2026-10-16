import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/features/auth/server";
import { createClient } from "@/shared/db/server";

import Page from "@/app/page";

// Spec auth-session "Pantalla de bienvenida provisoria": `/` verifica la identidad
// con `requireUser()` y lee el `full_name` del propio perfil con la Data API
// (cliente de servidor + RLS). Solo se simulan los bordes: la identidad y Supabase.

vi.mock("@/features/auth/server", () => ({ requireUser: vi.fn() }));
vi.mock("@/shared/db/server");
vi.mock("@/features/auth/actions", () => ({ login: vi.fn(), logout: vi.fn() }));

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type ProfileResult = {
  data: { full_name: string | null } | null;
  error: { message: string; code: string } | null;
};

const USER = { id: "3f6c1f0e-user", email: "duena@e2e.test" };

/** Cliente simulado: `from("profiles").select(..).eq(..).maybeSingle()` devuelve `result`. */
function simulateProfileQuery(result: ProfileResult) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  vi.mocked(createClient).mockResolvedValue({
    from,
  } as unknown as ServerClient);
  return { from, select, eq };
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset().mockResolvedValue(USER);
  vi.mocked(createClient).mockReset();
});

describe("página de inicio (bienvenida provisoria)", () => {
  it("saluda por el nombre de su perfil y ofrece cerrar sesión", async () => {
    simulateProfileQuery({ data: { full_name: "Dueña E2E" }, error: null });

    render(await Page());

    expect(
      screen.getByRole("heading", { level: 1, name: "Hola, Dueña E2E" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
  });

  it("lee solo el full_name del perfil de la persona con sesión", async () => {
    const query = simulateProfileQuery({
      data: { full_name: "Dueña E2E" },
      error: null,
    });

    await Page();

    expect(query.from).toHaveBeenCalledWith("profiles");
    expect(query.select).toHaveBeenCalledWith("full_name");
    expect(query.eq).toHaveBeenCalledWith("id", USER.id);
  });

  it("con full_name NULL saluda por el email", async () => {
    simulateProfileQuery({ data: { full_name: null }, error: null });

    render(await Page());

    expect(
      screen.getByRole("heading", { level: 1, name: "Hola, duena@e2e.test" }),
    ).toBeInTheDocument();
  });

  it("si la consulta falla, la página falla: no tapa el problema con el email", async () => {
    simulateProfileQuery({
      data: null,
      error: { message: "permission denied for table profiles", code: "42501" },
    });

    await expect(Page()).rejects.toThrow(/perfil/i);
  });

  it("si no aparece ninguna fila de perfil, la página falla", async () => {
    simulateProfileQuery({ data: null, error: null });

    await expect(Page()).rejects.toThrow(/perfil/i);
  });

  it("sin sesión válida, requireUser corta antes de leer nada de la base", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(createClient).not.toHaveBeenCalled();
  });
});
