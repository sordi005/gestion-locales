import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/features/auth/server";
import { createClient } from "@/shared/db/server";

import {
  LOC_NORTE_CENTRO,
  LOC_SUR_CENTRO,
  LOC_SUR_ESTE,
  ORG_NORTE,
  ORG_SUR,
  rowsFor,
  userId,
} from "../domain/__tests__/fixtures";
import type {
  SeedUserKey,
  TenantRowsFixture,
} from "../domain/__tests__/fixtures";
import { TenantReadError } from "../queries";
import {
  getTenantContext,
  requireLocationContext,
  requireLocationRole,
  requireOrgContext,
  requirePlatformAdmin,
} from "../server";
import { createFakeSupabase, resultsFromRows } from "./fake-supabase";

// Spec tenant-context "Acceso a un local por la URL" y "Guardas de servidor"
// (D2, D3): cada guarda lee el contexto memoizado de la request y decide con las
// funciones puras. Mal formado, ajeno, inexistente, no asignado, inactivo o con
// rol que no alcanza dan el MISMO `notFound()`; solo "ningún local" va a la
// salida. Solo se simulan los bordes: `next/navigation`, la identidad
// (`@/features/auth/server`) y Supabase.

// `React.cache` solo memoiza dentro del render de un Server Component: en Vitest
// nunca memoiza (verificado en 0.3d). Se simula en el borde con un memoizador
// propio que se vacía entre "renders".
const renderScope = vi.hoisted(() => {
  const memos = new Set<Map<string, unknown>>();
  return {
    memos,
    /** Empieza un "render" nuevo (una request nueva): la caché queda vacía. */
    startNewRender: () => {
      for (const memo of memos) memo.clear();
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <Args extends unknown[], Result>(
      fn: (...args: Args) => Result,
    ): ((...args: Args) => Result) => {
      const memo = new Map<string, unknown>();
      renderScope.memos.add(memo);
      return (...args: Args): Result => {
        const key = JSON.stringify(args);
        if (!memo.has(key)) memo.set(key, fn(...args));
        return memo.get(key) as Result;
      };
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/server");
vi.mock("@/features/auth/server", () => ({ requireUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  // Como los reales, no vuelven: lanzan para cortar el render.
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const SIN_ACCESO = "/auth/sin-acceso";
const OTHER_UUID = "00000000-0000-4000-b000-0000000000ff";

type Outcome<T> =
  | { kind: "returned"; value: T }
  | { kind: "not-found" }
  | { kind: "redirect"; to: string };

/** Corre la guarda y dice cómo terminó: devolvió, `notFound()` o `redirect()`. */
async function outcomeOf<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { kind: "returned", value: await run() };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NEXT_NOT_FOUND") return { kind: "not-found" };
      if (error.message.startsWith("NEXT_REDIRECT:")) {
        return {
          kind: "redirect",
          to: error.message.slice("NEXT_REDIRECT:".length),
        };
      }
    }
    throw error;
  }
}

/** La persona de la request: `requireUser` devuelve su identidad y Supabase sus filas. */
function signInWith(rows: TenantRowsFixture) {
  vi.mocked(requireUser).mockResolvedValue(rows.user);
  const fake = createFakeSupabase(resultsFromRows(rows));
  vi.mocked(createClient).mockResolvedValue(fake.client);
  return fake;
}

const signInAs = (user: SeedUserKey) => signInWith(rowsFor(user));

/** `owner.norte` con una membresía más: `employee` en Sur, asignado a "Local Este". */
function ownerNorteAlsoEmployeeInSur(): TenantRowsFixture {
  const base = rowsFor("owner.norte");
  const membershipId = "20000000-0000-4000-8000-0000000000aa";
  return {
    ...base,
    memberships: [
      ...base.memberships,
      {
        id: membershipId,
        organization_id: ORG_SUR,
        user_id: base.user.id,
        role: "employee",
        status: "active",
      },
    ],
    membershipLocations: [
      { membership_id: membershipId, location_id: LOC_SUR_ESTE },
    ],
    organizations: [
      ...base.organizations,
      { id: ORG_SUR, name: "Almacén Demo Sur", status: "active" },
    ],
    locations: [
      ...base.locations,
      {
        id: LOC_SUR_ESTE,
        name: "Local Este",
        status: "active",
        organization_id: ORG_SUR,
      },
    ],
  };
}

/** `employee.norte` cuya membresía fue deshabilitada: ya no ve organizaciones ni locales. */
function disabledEmployee(): TenantRowsFixture {
  const base = rowsFor("employee.norte");
  return {
    ...base,
    memberships: base.memberships.map((m) => ({ ...m, status: "disabled" })),
    organizations: [],
    locations: [],
  };
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  vi.mocked(createClient).mockReset();
  renderScope.startNewRender();
});

describe("getTenantContext", () => {
  it("verifica la identidad con requireUser y arma el contexto con las lecturas de esa persona", async () => {
    const fake = signInAs("owner.sur");

    const context = await getTenantContext();

    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(context.user).toMatchObject({
      id: userId("owner.sur"),
      displayName: "Dueño Demo Sur",
    });
    expect(context.organizations.map((o) => o.name)).toEqual([
      "Almacén Demo Sur",
    ]);
    expect(fake.queryOn("memberships").filters).toEqual([
      { column: "user_id", value: userId("owner.sur") },
    ]);
  });

  it("sin sesión, requireUser corta antes de leer nada de la base", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(getTenantContext()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("dos llamadas en el mismo render cargan UNA vez (una identidad y seis lecturas)", async () => {
    const fake = signInAs("owner.sur");

    const first = await getTenantContext();
    const second = await getTenantContext();

    expect(second).toBe(first);
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(fake.from).toHaveBeenCalledTimes(6);
  });

  it("las guardas de un mismo render comparten la carga con getTenantContext", async () => {
    const fake = signInAs("owner.sur");

    await getTenantContext();
    await requireLocationContext(LOC_SUR_CENTRO);
    await requireLocationRole(LOC_SUR_ESTE, ["owner"]);
    await requireOrgContext(ORG_SUR, ["owner"]);

    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(fake.from).toHaveBeenCalledTimes(6);
  });

  it("en el render siguiente vuelve a leer y ve los datos nuevos", async () => {
    signInAs("owner.sur");
    expect((await getTenantContext()).organizations).toHaveLength(1);

    renderScope.startNewRender();
    signInWith(disabledEmployee());

    const context = await getTenantContext();

    expect(context.organizations).toEqual([]);
    expect(requireUser).toHaveBeenCalledTimes(2);
  });

  it("si una lectura falla, lanza un error de la app: no lo confunde con 'sin acceso'", async () => {
    vi.mocked(requireUser).mockResolvedValue(rowsFor("owner.sur").user);
    const fake = createFakeSupabase({
      ...resultsFromRows(rowsFor("owner.sur")),
      locations: {
        data: null,
        error: { message: "boom", code: "08006" },
      },
    });
    vi.mocked(createClient).mockResolvedValue(fake.client);

    // Ni notFound ni redirect: la falla se propaga como error (500 de la app).
    await expect(requireLocationContext(LOC_SUR_ESTE)).rejects.toBeInstanceOf(
      TenantReadError,
    );
    renderScope.startNewRender();
    await expect(getTenantContext()).rejects.toBeInstanceOf(TenantReadError);
  });
});

describe("requireLocationContext", () => {
  it("con acceso devuelve el contexto del local: nombre, organización, rol y lista para cambiar", async () => {
    signInAs("owner.sur");

    const context = await requireLocationContext(LOC_SUR_ESTE);

    expect(context.location).toEqual({ id: LOC_SUR_ESTE, name: "Local Este" });
    expect(context.organization).toMatchObject({
      id: ORG_SUR,
      name: "Almacén Demo Sur",
      writable: true,
    });
    expect(context.role).toBe("owner");
    expect(context.locations.map((l) => l.id)).toEqual([
      LOC_SUR_CENTRO,
      LOC_SUR_ESTE,
    ]);
  });

  it("un empleado entra a su local asignado", async () => {
    signInAs("employee.sur");

    const context = await requireLocationContext(LOC_SUR_CENTRO);

    expect(context.role).toBe("employee");
    expect(context.locations).toHaveLength(1);
  });

  it.each([
    ["texto que no es un UUID", "no-es-un-uuid"],
    ["cadena vacía", ""],
    ["undefined", undefined],
    ["un array con un UUID válido", [LOC_SUR_CENTRO]],
    ["un UUID con espacio al final", `${LOC_SUR_CENTRO} `],
  ])(
    "id mal formado (%s): primero se identifica a la persona, después notFound()",
    async (_name, id) => {
      signInAs("owner.sur");

      const outcome = await outcomeOf(() => requireLocationContext(id));

      expect(outcome).toEqual({ kind: "not-found" });
      expect(requireUser).toHaveBeenCalledTimes(1);
    },
  );

  it("un id mal formado, uno ajeno y uno inexistente dan exactamente el mismo resultado", async () => {
    const results = [];
    for (const id of ["basura", LOC_SUR_CENTRO, OTHER_UUID]) {
      renderScope.startNewRender();
      signInAs("owner.norte");
      results.push(await outcomeOf(() => requireLocationContext(id)));
    }

    expect(results).toEqual([
      { kind: "not-found" },
      { kind: "not-found" },
      { kind: "not-found" },
    ]);
  });

  it.each([
    ["texto que no es un UUID", "basura"],
    ["undefined", undefined],
  ])(
    "sin sesión y con un id mal formado (%s): va a /login, no al 404",
    async (_name, id) => {
      vi.mocked(requireUser).mockRejectedValue(
        new Error("NEXT_REDIRECT:/login"),
      );

      expect(await outcomeOf(() => requireLocationContext(id))).toEqual({
        kind: "redirect",
        to: "/login",
      });
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["un local de otra organización", "owner.norte", LOC_SUR_CENTRO],
    ["un UUID que no existe", "owner.norte", OTHER_UUID],
    ["un local de su organización sin asignar", "employee.sur", LOC_SUR_ESTE],
    ["un local de su organización sin asignar", "manager.sur", LOC_SUR_ESTE],
  ] as const)("%s (%s): notFound()", async (_name, user, id) => {
    signInAs(user);

    expect(await outcomeOf(() => requireLocationContext(id))).toEqual({
      kind: "not-found",
    });
  });

  it("un local ajeno y uno inexistente dan exactamente el mismo resultado", async () => {
    signInAs("owner.norte");
    const foreign = await outcomeOf(() => requireLocationContext(LOC_SUR_ESTE));
    renderScope.startNewRender();
    signInAs("owner.norte");
    const missing = await outcomeOf(() => requireLocationContext(OTHER_UUID));

    expect(foreign).toEqual(missing);
  });

  it("un local inactivo no se abre, ni para el dueño, y los demás siguen abriendo", async () => {
    const rows = rowsFor("owner.sur");
    const withEsteInactive = {
      ...rows,
      locations: rows.locations.map((l) =>
        l.id === LOC_SUR_ESTE ? { ...l, status: "inactive" } : l,
      ),
    };
    signInWith(withEsteInactive);

    expect(await outcomeOf(() => requireLocationContext(LOC_SUR_ESTE))).toEqual(
      { kind: "not-found" },
    );

    const centro = await requireLocationContext(LOC_SUR_CENTRO);
    expect(centro.locations.map((l) => l.id)).toEqual([LOC_SUR_CENTRO]);
  });

  it("sin ningún local (membresía deshabilitada): redirige a la salida, no es 404", async () => {
    signInWith(disabledEmployee());

    expect(
      await outcomeOf(() => requireLocationContext(LOC_NORTE_CENTRO)),
    ).toEqual({ kind: "redirect", to: SIN_ACCESO });
  });

  it("sin acceso y con un id mal formado: igual va a la salida (no es 404)", async () => {
    signInWith(disabledEmployee());

    expect(await outcomeOf(() => requireLocationContext("basura"))).toEqual({
      kind: "redirect",
      to: SIN_ACCESO,
    });
  });

  it("el super-admin con un id mal formado: 404, no la salida", async () => {
    signInAs("admin");

    expect(await outcomeOf(() => requireLocationContext("basura"))).toEqual({
      kind: "not-found",
    });
  });

  it("el super-admin no recibe locales por serlo: 404 en cualquier id, no la salida", async () => {
    signInAs("admin");

    expect(
      await outcomeOf(() => requireLocationContext(LOC_NORTE_CENTRO)),
    ).toEqual({ kind: "not-found" });
  });

  it("con dos organizaciones, el rol es el de la organización de ESE local", async () => {
    signInWith(ownerNorteAlsoEmployeeInSur());

    expect((await requireLocationContext(LOC_NORTE_CENTRO)).role).toBe("owner");
    expect((await requireLocationContext(LOC_SUR_ESTE)).role).toBe("employee");
  });
});

describe("requireLocationRole", () => {
  it("con un rol permitido devuelve el contexto del local", async () => {
    signInAs("manager.norte");

    const context = await requireLocationRole(LOC_NORTE_CENTRO, [
      "owner",
      "manager",
    ]);

    expect(context.role).toBe("manager");
    expect(context.location.id).toBe(LOC_NORTE_CENTRO);
  });

  it("con un rol que no alcanza responde 404, igual que un local ajeno", async () => {
    signInAs("employee.norte");

    expect(
      await outcomeOf(() =>
        requireLocationRole(LOC_NORTE_CENTRO, ["owner", "manager"]),
      ),
    ).toEqual({ kind: "not-found" });
  });

  it("id mal formado: notFound() (con la persona ya identificada)", async () => {
    signInAs("owner.norte");

    expect(
      await outcomeOf(() => requireLocationRole("nope", ["owner"])),
    ).toEqual({ kind: "not-found" });
    expect(requireUser).toHaveBeenCalledTimes(1);
  });

  it("sin sesión y con un id mal formado: va a /login, no al 404", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    expect(
      await outcomeOf(() => requireLocationRole("nope", ["owner"])),
    ).toEqual({ kind: "redirect", to: "/login" });
  });

  it("sin ningún local y con un id mal formado: la salida", async () => {
    signInWith(disabledEmployee());

    expect(
      await outcomeOf(() => requireLocationRole("nope", ["owner"])),
    ).toEqual({ kind: "redirect", to: SIN_ACCESO });
  });

  it("sin ningún local: la salida", async () => {
    signInWith(disabledEmployee());

    expect(
      await outcomeOf(() => requireLocationRole(LOC_NORTE_CENTRO, ["owner"])),
    ).toEqual({ kind: "redirect", to: SIN_ACCESO });
  });

  it("cuenta el rol de la organización del local: dueño de Norte pero empleado en Sur no alcanza en Sur", async () => {
    signInWith(ownerNorteAlsoEmployeeInSur());

    expect(
      (await requireLocationRole(LOC_NORTE_CENTRO, ["owner"])).organization.id,
    ).toBe(ORG_NORTE);
    expect(
      await outcomeOf(() => requireLocationRole(LOC_SUR_ESTE, ["owner"])),
    ).toEqual({ kind: "not-found" });
  });
});

describe("requireOrgContext", () => {
  it("la organización propia con un rol permitido devuelve su contexto", async () => {
    signInAs("owner.norte");

    const context = await requireOrgContext(ORG_NORTE, ["owner", "manager"]);

    expect(context.organization).toMatchObject({
      id: ORG_NORTE,
      name: "Kiosco Demo Norte",
    });
    expect(context.role).toBe("owner");
    expect(context.locations.map((l) => l.id)).toEqual([LOC_NORTE_CENTRO]);
  });

  it.each([
    ["una organización ajena", "owner.norte", ORG_SUR, ["owner"]],
    ["una que no existe", "owner.norte", OTHER_UUID, ["owner"]],
    ["un rol que no alcanza", "employee.norte", ORG_NORTE, ["owner"]],
  ] as const)("%s: notFound()", async (_name, user, orgId, roles) => {
    signInAs(user);

    expect(await outcomeOf(() => requireOrgContext(orgId, roles))).toEqual({
      kind: "not-found",
    });
  });

  it.each([
    ["texto", "no-es-un-uuid"],
    ["undefined", undefined],
    ["un array", [ORG_NORTE]],
  ])(
    "id mal formado (%s): primero se identifica a la persona, después notFound()",
    async (_name, orgId) => {
      signInAs("owner.norte");

      expect(
        await outcomeOf(() => requireOrgContext(orgId, ["owner"])),
      ).toEqual({ kind: "not-found" });
      expect(requireUser).toHaveBeenCalledTimes(1);
    },
  );

  it("sin sesión y con un id mal formado: va a /login, no al 404", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    expect(
      await outcomeOf(() => requireOrgContext("basura", ["owner"])),
    ).toEqual({ kind: "redirect", to: "/login" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("dueño de una organización y empleado de otra: solo vale en la suya", async () => {
    signInWith(ownerNorteAlsoEmployeeInSur());

    expect((await requireOrgContext(ORG_NORTE, ["owner"])).role).toBe("owner");
    expect(
      await outcomeOf(() => requireOrgContext(ORG_SUR, ["owner"])),
    ).toEqual({ kind: "not-found" });
  });

  it("sin ningún local (membresía deshabilitada): la salida, igual que en los locales", async () => {
    signInWith(disabledEmployee());

    expect(
      await outcomeOf(() => requireOrgContext(ORG_NORTE, ["owner"])),
    ).toEqual({ kind: "redirect", to: SIN_ACCESO });
  });

  it("sin ningún local y con un id mal formado: igual va a la salida (no es 404)", async () => {
    signInWith(disabledEmployee());

    expect(
      await outcomeOf(() => requireOrgContext("basura", ["owner"])),
    ).toEqual({ kind: "redirect", to: SIN_ACCESO });
  });

  it("el super-admin no tiene organizaciones propias: 404 (no la salida), con id bien o mal formado", async () => {
    signInAs("admin");

    expect(
      await outcomeOf(() => requireOrgContext(ORG_NORTE, ["owner"])),
    ).toEqual({ kind: "not-found" });
    renderScope.startNewRender();
    signInAs("admin");
    expect(
      await outcomeOf(() => requireOrgContext("basura", ["owner"])),
    ).toEqual({ kind: "not-found" });
  });
});

describe("requirePlatformAdmin", () => {
  it("el super-admin pasa y recibe su identidad", async () => {
    signInAs("admin");

    const user = await requirePlatformAdmin();

    expect(user).toEqual({
      id: userId("admin"),
      email: "admin@demo.test",
      displayName: "Admin Demo",
    });
  });

  it.each(["owner.norte", "employee.sur"] as const)(
    "%s no es super-admin: notFound()",
    async (who) => {
      signInAs(who);

      expect(await outcomeOf(() => requirePlatformAdmin())).toEqual({
        kind: "not-found",
      });
    },
  );

  it("sin sesión, requireUser corta antes", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    expect(await outcomeOf(() => requirePlatformAdmin())).toEqual({
      kind: "redirect",
      to: "/login",
    });
  });
});
