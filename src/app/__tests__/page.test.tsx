import { render, screen } from "@testing-library/react";
import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Page from "@/app/page";
import { buildTenantContext } from "@/features/tenancy";
import type { Section, SectionKey } from "@/features/tenancy";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_CENTRO,
  ORG_NORTE,
  rowsFor,
} from "@/features/tenancy/domain/__tests__/fixtures";
import type { SeedUserKey } from "@/features/tenancy/domain/__tests__/fixtures";
import { getTenantContext } from "@/features/tenancy/server";

// Spec tenant-context "Redirección de inicio por rol y dispositivo" y
// "Pantalla provisoria del super-admin": `/` lee el contexto y las pistas del
// dispositivo (headers) y redirige según `decideHome`; solo el super-admin sin
// locales ve una pantalla. Se simulan los bordes: el contexto (lecturas), los
// headers, la navegación y el registro de secciones (para "construir" secciones
// en el test sin tocar el real).

// El registro real tiene construida solo la sección de inicio: para probar el
// resto de la tabla de D7 los tests reemplazan sus `built` en este arreglo.
const registry = vi.hoisted(() => ({ sections: [] as Section[] }));

vi.mock("@/features/tenancy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/tenancy")>();
  registry.sections.push(...actual.SECTIONS);
  return { ...actual, SECTIONS: registry.sections };
});
vi.mock("@/features/tenancy/server", () => ({ getTenantContext: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  // Como el real, `redirect` no vuelve: lanza para cortar el render.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/features/auth/actions", () => ({ logout: vi.fn() }));
vi.mock("@/features/auth/logout-cleanup", () => ({
  runLogoutCleanups: vi.fn(async () => {}),
}));

type RequestHeaders = Awaited<ReturnType<typeof headers>>;

const PIXEL_7 =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

function requestFrom(hints: { chUaMobile?: string; userAgent?: string }) {
  const requestHeaders = new Headers();
  if (hints.chUaMobile !== undefined) {
    requestHeaders.set("sec-ch-ua-mobile", hints.chUaMobile);
  }
  if (hints.userAgent !== undefined) {
    requestHeaders.set("user-agent", hints.userAgent);
  }
  vi.mocked(headers).mockResolvedValue(
    requestHeaders as unknown as RequestHeaders,
  );
}

const asDesktop = () =>
  requestFrom({ chUaMobile: "?0", userAgent: WINDOWS_CHROME });

function signInAs(user: SeedUserKey) {
  vi.mocked(getTenantContext).mockResolvedValue(
    buildTenantContext(rowsFor(user)),
  );
}

/** Deja construidas solo las secciones `keys` (más el inicio, que ya lo está). */
function build(...keys: SectionKey[]) {
  const real = registry.sections.map((s) => ({
    ...s,
    built: s.key === "inicio" || keys.includes(s.key),
  }));
  registry.sections.splice(0, registry.sections.length, ...real);
}

/** Corre la página y devuelve a dónde redirigió (o `null` si dibujó algo). */
async function redirectTarget(): Promise<string | null> {
  try {
    await Page();
    return null;
  } catch (error) {
    const prefix = "NEXT_REDIRECT:";
    if (error instanceof Error && error.message.startsWith(prefix)) {
      return error.message.slice(prefix.length);
    }
    throw error;
  }
}

beforeEach(() => {
  vi.mocked(getTenantContext).mockReset();
  vi.mocked(headers).mockReset();
  build();
  asDesktop();
});

describe("página de inicio: redirección", () => {
  it.each([
    ["employee.norte", `/l/${LOC_NORTE_CENTRO}`],
    ["manager.sur", `/l/${LOC_SUR_CENTRO}`],
    ["owner.norte", `/l/${LOC_NORTE_CENTRO}`],
  ] as const)(
    "%s con un local y nada construido todavía va al inicio de su local",
    async (user, destination) => {
      signInAs(user);

      expect(await redirectTarget()).toBe(destination);
    },
  );

  it("owner.sur (dos locales) va al selector", async () => {
    signInAs("owner.sur");

    expect(await redirectTarget()).toBe("/locales");
  });

  it("quien no tiene ningún local ni es super-admin va a la salida por falta de acceso", async () => {
    const rows = rowsFor("employee.norte");
    rows.memberships = rows.memberships.map((m) => ({
      ...m,
      status: "disabled",
    }));
    vi.mocked(getTenantContext).mockResolvedValue(buildTenantContext(rows));

    expect(await redirectTarget()).toBe("/auth/sin-acceso");
  });

  it("el empleado entra directo a vender cuando esa sección se construye", async () => {
    build("vender");
    signInAs("employee.norte");

    expect(await redirectTarget()).toBe(`/l/${LOC_NORTE_CENTRO}/vender`);
  });

  describe("el dispositivo sale de los headers de la request", () => {
    beforeEach(() => {
      build("estadisticas", "caja", "vender");
      signInAs("owner.norte");
    });

    it("la pista Sec-CH-UA-Mobile ?1 es celular: el dueño va a las estadísticas de su organización", async () => {
      requestFrom({ chUaMobile: "?1" });

      expect(await redirectTarget()).toBe(`/org/${ORG_NORTE}/estadisticas`);
    });

    it("sin la pista, el User-Agent de un celular también cuenta", async () => {
      requestFrom({ userAgent: PIXEL_7 });

      expect(await redirectTarget()).toBe(`/org/${ORG_NORTE}/estadisticas`);
    });

    it("la PC (?0 y Chrome de escritorio) manda al dueño a vender", async () => {
      asDesktop();

      expect(await redirectTarget()).toBe(`/l/${LOC_NORTE_CENTRO}/vender`);
    });

    it("sin ninguna pista se asume PC", async () => {
      requestFrom({});

      expect(await redirectTarget()).toBe(`/l/${LOC_NORTE_CENTRO}/vender`);
    });
  });

  it("lee el contexto una sola vez por request", async () => {
    signInAs("employee.norte");

    await redirectTarget();

    expect(getTenantContext).toHaveBeenCalledTimes(1);
  });

  it("sin sesión, la verificación redirige a /login antes de decidir nada", async () => {
    vi.mocked(getTenantContext).mockRejectedValue(
      new Error("NEXT_REDIRECT:/login"),
    );

    expect(await redirectTarget()).toBe("/login");
  });

  it("si la lectura del contexto falla, la página falla: no manda a ningún lado", async () => {
    vi.mocked(getTenantContext).mockRejectedValue(
      new Error("Could not read memberships (08006)"),
    );

    await expect(Page()).rejects.toThrow("Could not read");
  });
});

describe("página de inicio: super-admin", () => {
  it("dibuja la pantalla provisoria con su nombre, el texto del panel y Cerrar sesión", async () => {
    signInAs("admin");

    render(await Page());

    expect(
      screen.getByRole("heading", { level: 1, name: "Hola, Admin Demo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("El panel de administración llega en un próximo paso."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });

  it("con el peor caso de RLS (filas de todos) sigue sin locales: ve la pantalla, no una redirección", async () => {
    const rows = rowsFor("admin");
    const all = rowsFor("owner.sur");
    vi.mocked(getTenantContext).mockResolvedValue(
      buildTenantContext({
        ...rows,
        organizations: all.organizations,
        locations: all.locations,
        memberships: all.memberships,
        membershipLocations: all.membershipLocations,
      }),
    );

    render(await Page());

    expect(
      screen.getByRole("heading", { level: 1, name: "Hola, Admin Demo" }),
    ).toBeInTheDocument();
  });

  it("el super-admin sin nombre es saludado por su email", async () => {
    const rows = rowsFor("admin");
    rows.profile = { id: rows.user.id, full_name: null };
    vi.mocked(getTenantContext).mockResolvedValue(buildTenantContext(rows));

    render(await Page());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Hola, admin@demo.test",
      }),
    ).toBeInTheDocument();
  });
});
