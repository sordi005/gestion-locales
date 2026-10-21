import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTenantContext } from "@/features/tenancy/server";
import type { TenantContext } from "@/features/tenancy";
import { createClient } from "@/shared/db/server";

import { signOutNoAccess } from "../actions";

// Spec tenant-context "Salida por falta de acceso" (D8): la acción VUELVE a
// verificar el acceso (sin la memoización de la página) y solo cierra la sesión
// de este dispositivo cuando de verdad no hay ningún local y no es super-admin.
// Con acceso, o con una lectura que falla, no se desloguea a nadie. Se simulan
// los bordes: las lecturas (`getTenantContext`), Supabase, las cookies y la
// navegación; `signOutThisDevice` y las rutas son las reales.

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/server");
vi.mock("next/headers");
vi.mock("@/features/tenancy/server", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/navigation", () => ({
  // Como el real, `redirect` no vuelve: lanza para cortar la acción.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type CookieStore = Awaited<ReturnType<typeof cookies>>;

const USER = {
  id: "10000000-0000-4000-8000-000000000003",
  email: "empleado@demo.test",
  displayName: "Empleado",
};

const WITH_ACCESS: TenantContext = {
  user: USER,
  isPlatformAdmin: false,
  organizations: [
    {
      id: "00000000-0000-4000-a000-000000000001",
      name: "Kiosco",
      status: "active",
      writable: true,
      role: "employee",
      locations: [
        { id: "00000000-0000-4000-b000-000000000001", name: "Centro" },
      ],
    },
  ],
};
const NO_MEMBERSHIPS: TenantContext = {
  user: USER,
  isPlatformAdmin: false,
  organizations: [],
};
/** Membresía activa pero sin ningún local asignado (o todos inactivos). */
const NO_LOCATIONS: TenantContext = {
  ...WITH_ACCESS,
  organizations: [{ ...WITH_ACCESS.organizations[0]!, locations: [] }],
};
const PLATFORM_ADMIN: TenantContext = {
  user: { ...USER, email: "admin@demo.test", displayName: "Admin" },
  isPlatformAdmin: true,
  organizations: [],
};

const SESSION_COOKIES = ["sb-127-auth-token", "sb-127-auth-token.0"];

function simulateSignOut(outcome: "ok" | "error" | "throws" = "ok") {
  const signOut = vi.fn(async () => {
    if (outcome === "throws") throw new TypeError("fetch failed");
    return {
      error:
        outcome === "error"
          ? { code: "unexpected_failure", status: 503, message: "x" }
          : null,
    };
  });
  vi.mocked(createClient).mockResolvedValue({
    auth: { signOut },
  } as unknown as ServerClient);
  return { signOut };
}

function simulateCookies() {
  const set = vi.fn();
  vi.mocked(cookies).mockResolvedValue({
    getAll: () =>
      [...SESSION_COOKIES, "theme"].map((name) => ({ name, value: "v" })),
    set,
  } as unknown as CookieStore);
  return { set };
}

/** Corre la acción y devuelve a dónde redirigió. */
async function redirectTarget(): Promise<string> {
  try {
    await signOutNoAccess();
  } catch (error) {
    const prefix = "NEXT_REDIRECT:";
    if (error instanceof Error && error.message.startsWith(prefix)) {
      return error.message.slice(prefix.length);
    }
    throw error;
  }
  throw new Error("signOutNoAccess no redirigió");
}

beforeEach(() => {
  vi.mocked(getTenantContext).mockReset();
  vi.mocked(createClient).mockReset();
  vi.mocked(cookies).mockReset();
  vi.mocked(redirect).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("signOutNoAccess: con acceso no desloguea a nadie", () => {
  it.each([
    ["una persona con un local", WITH_ACCESS],
    ["el super-admin sin locales", PLATFORM_ADMIN],
  ])("%s: redirige a / sin llamar a signOut", async (_name, context) => {
    vi.mocked(getTenantContext).mockResolvedValue(context);
    const { signOut } = simulateSignOut();

    expect(await redirectTarget()).toBe("/");

    expect(signOut).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("signOutNoAccess: sin acceso", () => {
  it.each([
    [
      "sin ninguna organización (membresía deshabilitada o sin membresías)",
      NO_MEMBERSHIPS,
    ],
    ["con la organización pero sin ningún local", NO_LOCATIONS],
  ])(
    "%s: cierra solo la sesión de este dispositivo y va a /login con el aviso",
    async (_name, context) => {
      vi.mocked(getTenantContext).mockResolvedValue(context);
      const { signOut } = simulateSignOut();
      const { set } = simulateCookies();

      expect(await redirectTarget()).toBe("/login?aviso=sin-acceso");

      expect(signOut).toHaveBeenCalledTimes(1);
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      // Si Supabase cerró bien, ya borró sus cookies: no hay nada que limpiar a mano.
      expect(set).not.toHaveBeenCalled();
    },
  );

  it.each([
    { caso: "Supabase devuelve un error", outcome: "error" as const },
    { caso: "la llamada a Supabase lanza", outcome: "throws" as const },
  ])(
    "$caso: igual va a /login con el aviso y borra a mano las cookies de sesión",
    async ({ outcome }) => {
      vi.mocked(getTenantContext).mockResolvedValue(NO_MEMBERSHIPS);
      simulateSignOut(outcome);
      const { set } = simulateCookies();

      expect(await redirectTarget()).toBe("/login?aviso=sin-acceso");

      expect(set.mock.calls.map(([name]) => name).sort()).toEqual(
        [...SESSION_COOKIES].sort(),
      );
      for (const [, value, options] of set.mock.calls) {
        expect(value).toBe("");
        expect(options).toMatchObject({ maxAge: 0, httpOnly: true });
      }
    },
  );
});

describe("signOutNoAccess: verificación y fallas", () => {
  it("sin sesión, la verificación redirige a /login y no se llama a signOut", async () => {
    vi.mocked(getTenantContext).mockRejectedValue(
      new Error("NEXT_REDIRECT:/login"),
    );
    const { signOut } = simulateSignOut();

    expect(await redirectTarget()).toBe("/login");

    expect(signOut).not.toHaveBeenCalled();
  });

  it("si la lectura del contexto falla, el error se propaga y NO se cierra la sesión", async () => {
    vi.mocked(getTenantContext).mockRejectedValue(
      new Error("Could not read memberships (08006)"),
    );
    const { signOut } = simulateSignOut();

    await expect(signOutNoAccess()).rejects.toThrow("Could not read");

    expect(signOut).not.toHaveBeenCalled();
  });

  // Con `getTenantContext` simulado, esto prueba que la acción lo consulta en CADA
  // ejecución y decide con el último resultado (no recuerda el anterior). Que
  // `React.cache` no memoiza dentro de una Server Action se verificó contra Next
  // real en la tarea 0.3d: este test no lo puede probar.
  it("consulta el contexto en cada ejecución y decide con el último resultado: si ya recuperó el acceso, no lo desloguea", async () => {
    simulateSignOut();
    simulateCookies();
    vi.mocked(getTenantContext)
      .mockResolvedValueOnce(NO_MEMBERSHIPS)
      .mockResolvedValueOnce(WITH_ACCESS);

    expect(await redirectTarget()).toBe("/login?aviso=sin-acceso");
    expect(await redirectTarget()).toBe("/");

    expect(getTenantContext).toHaveBeenCalledTimes(2);
  });
});
