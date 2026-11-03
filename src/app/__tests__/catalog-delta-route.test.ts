import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as route from "@/app/api/catalog/delta/route";
import { GET } from "@/app/api/catalog/delta/route";
import {
  createFakeCatalogDb,
  pgError,
} from "@/features/catalog/__tests__/fake-supabase";
import type { FakeCatalogDb } from "@/features/catalog/__tests__/fake-supabase";
import { catalogDeltaSchema } from "@/features/catalog/cache/datasets";
import {
  ORGANIZATION_ID as CACHE_TEST_ORG,
  uuidFor,
} from "@/features/catalog/cache/__tests__/fixtures";
import { getAuthState } from "@/features/auth/server";
import type { AuthState } from "@/features/auth/server";
import { buildTenantContext } from "@/features/tenancy";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_CENTRO,
  LOC_SUR_ESTE,
  ORG_NORTE,
  leakyRowsFor,
  rowsFor,
  userId,
} from "@/features/tenancy/domain/__tests__/fixtures";
import type { SeedUserKey } from "@/features/tenancy/domain/__tests__/fixtures";
import { getTenantContext } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";

// Spec catalog-delta-api: `GET /api/catalog/delta`. Se simulan solo los bordes:
// la verificación de identidad (`getAuthState`), el contexto de tenant
// (`getTenantContext`, con las filas del seed y la decisión de acceso real) y el
// cliente de servidor de Supabase.

vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/server", () => ({ getAuthState: vi.fn() }));
vi.mock("@/features/tenancy/server", () => ({ getTenantContext: vi.fn() }));
vi.mock("@/shared/db/server");

type TenantContext = Awaited<ReturnType<typeof getTenantContext>>;

let db: FakeCatalogDb;
let consoleError: ReturnType<typeof vi.spyOn>;

function signIn(user: SeedUserKey, context?: TenantContext) {
  vi.mocked(getAuthState).mockResolvedValue({
    kind: "full",
    user: { id: userId(user), email: `${user}@demo.test` },
  });
  vi.mocked(getTenantContext).mockResolvedValue(
    context ?? buildTenantContext(rowsFor(user)),
  );
}

function signedOut(kind: Exclude<AuthState["kind"], "full">) {
  vi.mocked(getAuthState).mockResolvedValue(
    kind === "none"
      ? { kind, user: null }
      : { kind, user: { id: userId("employee.norte"), email: "e@demo.test" } },
  );
}

const request = (query: string) =>
  new NextRequest(`http://localhost:3000/api/catalog/delta${query}`);

const forLocation = (location: string, extra = "") =>
  request(`?location=${encodeURIComponent(location)}${extra}`);

const UPDATED = "2026-10-21T08:00:00+00:00";

function queueCatalog() {
  db.queue("products", "select", {
    data: [
      {
        id: uuidFor("product", 1),
        name: "Alfajor",
        brand: "Arcor",
        category_id: null,
        unit: "unit",
        status: "active",
        tracks_stock: true,
        tracks_expiry: false,
        sale_price: 900,
        sale_price_updated_at: UPDATED,
        quick_sale_position: 2,
        quick_sale_label: "Alf",
        updated_at: UPDATED,
        // Una fuga a propósito: el handler no la deja pasar.
        reference_cost: 500,
        preferred_supplier_id: uuidFor("category", 1),
      },
    ],
  });
  db.queue("product_barcodes", "select", {
    data: [
      {
        id: uuidFor("barcode", 1),
        product_id: uuidFor("product", 1),
        barcode_norm: "7790001000019",
        is_primary: true,
        updated_at: UPDATED,
      },
    ],
  });
  db.queue("categories", "select", {
    data: [
      { id: uuidFor("category", 1), name: "Golosinas", updated_at: UPDATED },
    ],
  });
}

beforeEach(() => {
  db = createFakeCatalogDb();
  vi.mocked(createClient).mockReset();
  vi.mocked(createClient).mockResolvedValue(db.client);
  vi.mocked(getAuthState).mockReset();
  vi.mocked(getTenantContext).mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/catalog/delta: sin sesión (401)", () => {
  it.each(["none", "password-setup-expired", "password-setup"] as const)(
    "sesión %s: 401 en JSON, sin redirigir y sin leer nada",
    async (kind) => {
      signedOut(kind);

      const response = await GET(forLocation(LOC_NORTE_CENTRO));

      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.json()).toEqual({ error: "unauthenticated" });
      expect(getTenantContext).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("sin sesión gana sobre cualquier otro error de la request (ni 400 ni 404)", async () => {
    signedOut("none");

    const response = await GET(request("?location=no-es-un-uuid&since=ayer"));

    expect(response.status).toBe(401);
  });
});

describe("GET /api/catalog/delta: local y parámetros", () => {
  it("el 404 es idéntico (estado y cuerpo) para local mal formado, inexistente, ajeno, no asignado, inactivo y super-admin", async () => {
    const outcomes: { status: number; body: string }[] = [];
    const attempt = async (query: string) => {
      const response = await GET(request(query));
      outcomes.push({ status: response.status, body: await response.text() });
    };

    signIn("employee.norte");
    await attempt("?location=no-es-un-uuid");
    await attempt("?location=00000000-0000-4000-b000-0000000000ff");
    await attempt(`?location=${LOC_SUR_CENTRO}`); // de otra organización

    signIn("employee.sur");
    await attempt(`?location=${LOC_SUR_ESTE}`); // misma organización, no asignado

    const rows = rowsFor("employee.norte");
    signIn(
      "employee.norte",
      buildTenantContext({
        ...rows,
        locations: rows.locations.map((l) => ({ ...l, status: "inactive" })),
      }),
    );
    await attempt(`?location=${LOC_NORTE_CENTRO}`); // inactivo

    signIn("admin", buildTenantContext(leakyRowsFor("admin")));
    await attempt(`?location=${LOC_NORTE_CENTRO}`); // super-admin

    expect(outcomes).toHaveLength(6);
    for (const outcome of outcomes) {
      expect(outcome).toEqual({
        status: 404,
        body: JSON.stringify({ error: "not_found" }),
      });
    }
    // Un 404 nunca llega a leer el catálogo.
    expect(db.calls).toHaveLength(0);
  });

  it("since inválido en un local propio: 400", async () => {
    signIn("employee.norte");

    const response = await GET(forLocation(LOC_NORTE_CENTRO, "&since=ayer"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_request" });
    expect(db.calls).toHaveLength(0);
  });

  it.each([["9999-12-31T23:59:59Z"], ["0001-01-01T00:00:00Z"]])(
    "since=%s (fuera de rango): 400 y nunca llega a la base",
    async (since) => {
      signIn("employee.norte");

      const response = await GET(
        forLocation(LOC_NORTE_CENTRO, `&since=${since}`),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_request" });
      expect(db.calls).toHaveLength(0);
    },
  );

  it("sin `location`: 400", async () => {
    signIn("employee.norte");

    const response = await GET(request(""));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_request" });
  });
});

describe("GET /api/catalog/delta: local propio (200)", () => {
  it.each([["employee.norte"], ["manager.norte"], ["owner.norte"]] as const)(
    "%s recibe el catálogo completo que valida el esquema",
    async (user) => {
      signIn(user);
      queueCatalog();

      const response = await GET(forLocation(LOC_NORTE_CENTRO));

      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      const parsed = catalogDeltaSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body).toMatchObject({
        version: 1,
        mode: "full",
        organizationId: ORG_NORTE,
        userId: userId(user),
        cursor: UPDATED,
      });
    },
  );

  it("userId es la identidad ya verificada de la request: sin otra verificación y nunca la de la URL", async () => {
    signIn("employee.norte");
    queueCatalog();

    const response = await GET(
      forLocation(LOC_NORTE_CENTRO, `&userId=${userId("owner.norte")}`),
    );

    expect(((await response.json()) as { userId: string }).userId).toBe(
      userId("employee.norte"),
    );
    expect(getAuthState).toHaveBeenCalledTimes(1);
  });

  it("dos personas de la misma organización reciben cada una su propio userId", async () => {
    const ids: string[] = [];
    for (const user of ["employee.norte", "owner.norte"] as const) {
      signIn(user);
      queueCatalog();
      const response = await GET(forLocation(LOC_NORTE_CENTRO));
      ids.push(((await response.json()) as { userId: string }).userId);
    }

    expect(ids).toEqual([userId("employee.norte"), userId("owner.norte")]);
  });

  it("los tres roles reciben exactamente las mismas claves por producto, sin costo ni proveedor", async () => {
    const keysByRole: string[][] = [];
    for (const user of [
      "employee.norte",
      "manager.norte",
      "owner.norte",
    ] as const) {
      signIn(user);
      queueCatalog();
      const response = await GET(forLocation(LOC_NORTE_CENTRO));
      const body = (await response.json()) as { products: object[] };
      keysByRole.push(Object.keys(body.products[0] ?? {}).sort());
    }

    expect(keysByRole[0]).toEqual(keysByRole[1]);
    expect(keysByRole[1]).toEqual(keysByRole[2]);
    expect(keysByRole[0]?.join(" ")).not.toMatch(/cost|supplier|reference/i);
    expect(keysByRole[0]).toContain("quickSale");
  });

  it("la organización de la lectura sale del local, no de la URL", async () => {
    signIn("employee.norte");
    queueCatalog();

    await GET(forLocation(LOC_NORTE_CENTRO, `&organization=${CACHE_TEST_ORG}`));

    for (const call of db.calls) {
      expect(
        call.filters.find((f) => f.column === "organization_id")?.value,
      ).toBe(ORG_NORTE);
    }
  });

  it("con `since` pide el delta y devuelve ese cursor si no hubo cambios", async () => {
    signIn("employee.norte");
    db.queue("products", "select", { data: [] });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("categories", "select", { data: [] });

    const since = "2026-10-21T08:00:00.5+00:00";
    const response = await GET(
      forLocation(LOC_NORTE_CENTRO, `&since=${encodeURIComponent(since)}`),
    );

    expect(await response.json()).toMatchObject({
      mode: "delta",
      cursor: since,
      products: [],
    });
  });

  it("una organización suspendida sigue leyendo", async () => {
    const rows = rowsFor("employee.norte");
    signIn(
      "employee.norte",
      buildTenantContext({
        ...rows,
        organizations: rows.organizations.map((o) => ({
          ...o,
          status: "suspended",
        })),
      }),
    );
    queueCatalog();

    const response = await GET(forLocation(LOC_NORTE_CENTRO));

    expect(response.status).toBe(200);
  });
});

describe("GET /api/catalog/delta: errores (503)", () => {
  const unavailable = JSON.stringify({ error: "unavailable" });

  it("getTenantContext lanza: 503 sin texto de la base", async () => {
    vi.mocked(getAuthState).mockResolvedValue({
      kind: "full",
      user: { id: userId("employee.norte"), email: "e@demo.test" },
    });
    vi.mocked(getTenantContext).mockRejectedValue(
      new Error('relation "memberships" does not exist'),
    );

    const response = await GET(forLocation(LOC_NORTE_CENTRO));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe(unavailable);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "memberships",
    );
  });

  it("un redirect() que se escapa (carrera de sesión) es 503, no una redirección HTML", async () => {
    vi.mocked(getAuthState).mockResolvedValue({
      kind: "full",
      user: { id: userId("employee.norte"), email: "e@demo.test" },
    });
    vi.mocked(getTenantContext).mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/login;307;",
      }),
    );

    const response = await GET(forLocation(LOC_NORTE_CENTRO));

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });

  it("getAuthState lanza: 503", async () => {
    vi.mocked(getAuthState).mockRejectedValue(new Error("boom"));

    const response = await GET(forLocation(LOC_NORTE_CENTRO));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe(unavailable);
  });

  it("la lectura del catálogo falla: 503, sin el mensaje ni el código de Postgres en la respuesta", async () => {
    signIn("employee.norte");
    db.queue("products", "select", {
      error: pgError("42501", 'permission denied for table "products"'),
    });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("categories", "select", { data: [] });

    const response = await GET(forLocation(LOC_NORTE_CENTRO));

    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toBe(unavailable);
    expect(text).not.toMatch(/42501|permission|products/);
    // En el servidor sí queda el código, para diagnosticar.
    expect(JSON.stringify(consoleError.mock.calls)).toContain("42501");
  });

  it("createClient lanza: 503", async () => {
    signIn("employee.norte");
    vi.mocked(createClient).mockRejectedValue(new Error("sin cookies"));

    const response = await GET(forLocation(LOC_NORTE_CENTRO));

    expect(response.status).toBe(503);
  });
});

describe("GET /api/catalog/delta: headers", () => {
  async function responses() {
    const out: Response[] = [];

    signedOut("none");
    out.push(await GET(forLocation(LOC_NORTE_CENTRO))); // 401

    signIn("employee.norte");
    out.push(await GET(forLocation(LOC_NORTE_CENTRO, "&since=ayer"))); // 400
    out.push(await GET(forLocation(LOC_SUR_CENTRO))); // 404

    queueCatalog();
    out.push(await GET(forLocation(LOC_NORTE_CENTRO))); // 200

    vi.mocked(getTenantContext).mockRejectedValue(new Error("x"));
    out.push(await GET(forLocation(LOC_NORTE_CENTRO))); // 503
    return out;
  }

  it("todas las respuestas (200, 400, 401, 404, 503) son JSON y no se guardan en ninguna caché", async () => {
    const all = await responses();

    expect(all.map((r) => r.status)).toEqual([401, 400, 404, 200, 503]);
    for (const response of all) {
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("cache-control")).toBe(
        "private, no-cache, no-store, must-revalidate, max-age=0",
      );
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("expires")).toBe("0");
    }
  });
});

describe("GET /api/catalog/delta: solo GET", () => {
  it("el módulo exporta únicamente GET (Next responde 405 al resto)", () => {
    expect(Object.keys(route)).toEqual(["GET"]);
  });
});
