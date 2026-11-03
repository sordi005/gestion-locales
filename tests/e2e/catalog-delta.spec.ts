import type { APIResponse } from "@playwright/test";
import { z } from "zod";

import { SEED, expect, seedProduct } from "./support/catalog-ui";
import { signInThroughUi } from "./support/auth-ui";
import { storageStateFor } from "./support/storage-state";
import { createPublishableClient } from "./support/supabase-admin";
import { test } from "./support/tenant-fixture";

// Specs catalog-delta-api (C-11): `GET /api/catalog/delta?location=<uuid>[&since=<ISO>]`
// con sesiones reales. Las pruebas de 10.1, 10.2 y 10.5 solo leen con las sesiones
// guardadas del seed; la 10.3 cambia datos, y lo hace en un tenant descartable `e2e-…`
// (nada del seed se toca, así que no hay nada que restaurar).
//
// Son pruebas por HTTP: el tamaño de pantalla no cambia nada, así que corren una sola
// vez (en `desktop-keyboard`) y el proyecto `mobile` las omite.

test.describe.configure({ timeout: 90_000 });

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, "prueba por HTTP: el tamaño de pantalla no cambia nada");
});

const DELTA_PATH = "/api/catalog/delta";

/** Las claves que tiene un producto de la caché, en cualquier rol. */
const PRODUCT_KEYS = [
  "brand",
  "categoryId",
  "id",
  "name",
  "quickSale",
  "salePriceCents",
  "salePriceUpdatedAt",
  "status",
  "tracksExpiry",
  "tracksStock",
  "unit",
  "updatedAt",
] as const;

/** Nada de esto puede aparecer como clave en ninguna parte de la respuesta. */
const FORBIDDEN_KEY =
  /cost|supplier|proveedor|origin|source|stock_?min|history/i;

const deltaResponseSchema = z.looseObject({
  version: z.literal(1),
  mode: z.enum(["full", "delta"]),
  organizationId: z.string(),
  // El id de quien pidió (la identidad verificada de la request).
  userId: z.string().min(1),
  cursor: z.string().nullable(),
  products: z.array(z.looseObject({ id: z.string() })),
  barcodes: z.array(z.looseObject({ id: z.string() })),
  categories: z.array(z.looseObject({ id: z.string() })),
});

const errorBodySchema = z.strictObject({ error: z.string() });

function deltaUrl(location: string, since?: string): string {
  const params = new URLSearchParams({ location });
  // `URLSearchParams` codifica el `+` de la zona horaria como `%2B`.
  if (since !== undefined) params.set("since", since);
  return `${DELTA_PATH}?${params.toString()}`;
}

/** Todas las claves de un valor JSON, a cualquier profundidad. */
function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      allKeys(item, into);
    }
  }
  return into;
}

async function readDelta(response: APIResponse) {
  expect(response.status()).toBe(200);
  return deltaResponseSchema.parse(await response.json());
}

/** Los headers que toda respuesta del endpoint lleva (200 y errores). */
function expectJsonNoCache(response: APIResponse): void {
  const headers = response.headers();
  expect(headers["content-type"]).toMatch(/^application\/json/);
  const cacheControl = headers["cache-control"] ?? "";
  for (const directive of [
    "private",
    "no-cache",
    "no-store",
    "must-revalidate",
  ]) {
    expect(cacheControl).toContain(directive);
  }
  expect(cacheControl).toContain("max-age=0");
  expect(headers["pragma"]).toBe("no-cache");
  expect(headers["expires"]).toBe("0");
}

test.describe("sin sesión", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("responde 401 en JSON, sin redirigir a /login", async ({ request }) => {
    const response = await request.get(deltaUrl(SEED.localCentroNorte), {
      maxRedirects: 0,
    });

    // Un `fetch` no puede seguir una redirección a una página HTML: tiene que ser un 401.
    expect(response.status()).toBe(401);
    expect(response.headers()["location"]).toBeUndefined();
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expectJsonNoCache(response);
  });
});

test.describe("404 uniforme", () => {
  test.describe("employee.norte", () => {
    test.use({ storageState: storageStateFor("employee.norte") });

    test("pedir el Local Centro de Sur da 404 not_found", async ({
      request,
    }) => {
      const response = await request.get(deltaUrl(SEED.localCentroSur), {
        maxRedirects: 0,
      });

      expect(response.status()).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
      expectJsonNoCache(response);
    });
  });

  test.describe("employee.norte: parámetros", () => {
    test.use({ storageState: storageStateFor("employee.norte") });

    test("un since fuera de rango da 400 bad_request, nunca un 503 de la base", async ({
      request,
    }) => {
      for (const since of ["9999-12-31T23:59:59Z", "0001-01-01T00:00:00Z"]) {
        const response = await request.get(
          deltaUrl(SEED.localCentroNorte, since),
          { maxRedirects: 0 },
        );

        expect(response.status()).toBe(400);
        expect(await response.json()).toEqual({ error: "bad_request" });
        expectJsonNoCache(response);
      }
    });
  });

  test.describe("employee.sur", () => {
    test.use({ storageState: storageStateFor("employee.sur") });

    test("un local no asignado, uno inexistente y un texto que no es uuid dan el mismo 404 byte a byte", async ({
      request,
    }) => {
      const responses = await Promise.all(
        [
          SEED.localEsteSur, // de su organización, pero no asignado
          SEED.uuidInexistente, // con forma de uuid y sin local
          "no-es-un-uuid", // mal formado
        ].map((location) =>
          request.get(deltaUrl(location), { maxRedirects: 0 }),
        ),
      );

      const bodies: string[] = [];
      for (const response of responses) {
        expect(response.status()).toBe(404);
        expectJsonNoCache(response);
        bodies.push(await response.text());
      }
      expect(new Set(bodies).size).toBe(1);
      expect(errorBodySchema.parse(JSON.parse(bodies[0] ?? ""))).toEqual({
        error: "not_found",
      });
    });

    test("su propio local sí responde 200 (la 404 de arriba no es un endpoint roto)", async ({
      request,
    }) => {
      const delta = await readDelta(
        await request.get(deltaUrl(SEED.localCentroSur)),
      );

      expect(delta.organizationId).toBe(SEED.orgSur);
      expect(delta.products).toHaveLength(8);
      expect(delta.categories).toHaveLength(2);
    });
  });

  test.describe("super-admin", () => {
    test.use({ storageState: storageStateFor("admin") });

    test("admin@demo.test no tiene locales: cualquier local da 404", async ({
      request,
    }) => {
      const responses = await Promise.all(
        [SEED.localCentroNorte, SEED.localCentroSur].map((location) =>
          request.get(deltaUrl(location), { maxRedirects: 0 }),
        ),
      );

      for (const response of responses) {
        expect(response.status()).toBe(404);
        expect(await response.json()).toEqual({ error: "not_found" });
        expectJsonNoCache(response);
      }
    });
  });
});

test.describe("local inactivo", () => {
  test("un local inactivo asignado da el mismo 404 que uno inexistente, y el activo sí responde 200", async ({
    page,
    tenant,
  }) => {
    const active = await tenant.addLocation("Local Activo");
    const inactive = await tenant.addLocation("Local Inactivo", {
      status: "inactive",
    });
    const manager = await tenant.addMember({
      role: "manager",
      locations: [active, inactive],
      fullName: "Encargada E2E Inactivo",
    });
    await signInThroughUi(page, manager);
    await expect(page).toHaveURL(`/l/${active.id}`);

    const [inactiveResponse, missingResponse] = await Promise.all(
      [inactive.id, SEED.uuidInexistente].map((location) =>
        page.request.get(deltaUrl(location), { maxRedirects: 0 }),
      ),
    );

    for (const response of [inactiveResponse, missingResponse]) {
      expect(response?.status()).toBe(404);
      if (response !== undefined) expectJsonNoCache(response);
    }
    // Byte a byte igual al de un local que no existe: el 404 no filtra el estado.
    expect(await inactiveResponse?.text()).toBe(await missingResponse?.text());
    expect(errorBodySchema.parse(await inactiveResponse?.json())).toEqual({
      error: "not_found",
    });
    // Y el local activo de la misma persona responde (no es un endpoint roto).
    const delta = await readDelta(await page.request.get(deltaUrl(active.id)));
    expect(delta.organizationId).toBe(tenant.organization.id);
  });
});

test.describe("catálogo completo del seed", () => {
  for (const user of ["employee.norte", "owner.norte"] as const) {
    test.describe(user, () => {
      test.use({ storageState: storageStateFor(user) });

      test("recibe 40 productos y 7 categorías con las mismas claves y ninguna de costo ni proveedor", async ({
        request,
      }) => {
        const response = await request.get(deltaUrl(SEED.localCentroNorte));
        const delta = await readDelta(response);

        expect(delta.mode).toBe("full");
        expect(delta.organizationId).toBe(SEED.orgNorte);
        expect(delta.cursor).not.toBeNull();
        expect(delta.products).toHaveLength(40);
        expect(delta.categories).toHaveLength(7);
        expect(delta.barcodes.length).toBeGreaterThan(0);
        expectJsonNoCache(response);

        // Cada producto trae exactamente las claves de la caché (ni una más ni una menos).
        for (const product of delta.products) {
          expect(Object.keys(product).sort()).toEqual([...PRODUCT_KEYS]);
        }
        // Y en ninguna parte de la respuesta hay una clave de costo, origen o proveedor.
        const forbidden = [...allKeys(delta)].filter((key) =>
          FORBIDDEN_KEY.test(key),
        );
        expect(forbidden).toEqual([]);
      });
    });
  }

  test.describe("las dos personas ven lo mismo", () => {
    test("employee.norte y owner.norte reciben los mismos ids", async ({
      browser,
    }) => {
      const ids: string[][] = [];
      const userIds: string[] = [];
      for (const user of ["employee.norte", "owner.norte"] as const) {
        const context = await browser.newContext({
          storageState: storageStateFor(user),
        });
        try {
          const delta = await readDelta(
            await context.request.get(deltaUrl(SEED.localCentroNorte)),
          );
          ids.push(delta.products.map(({ id }) => id).sort());
          userIds.push(delta.userId);
        } finally {
          await context.close();
        }
      }
      expect(ids[0]).toEqual(ids[1]);
      // Mismo catálogo, pero cada respuesta dice a quién se le respondió.
      expect(new Set(userIds).size).toBe(2);
    });
  });
});

test.describe("cambios entre dos pedidos", () => {
  test("el delta con el cursor anterior trae el precio nuevo y el producto desactivado", async ({
    page,
    tenant,
    admin,
  }) => {
    const location = await tenant.addLocation("Local Centro");
    const manager = await tenant.addMember({
      role: "manager",
      locations: [location],
      fullName: "Encargada E2E Delta",
    });
    const repriced = await seedProduct(admin, tenant.organization.id, {
      name: "Alfajor delta E2E",
      salePrice: 1000,
      referenceCost: 800,
    });
    const deactivated = await seedProduct(admin, tenant.organization.id, {
      name: "Gaseosa delta E2E",
      salePrice: 2000,
    });

    await signInThroughUi(page, manager);
    await expect(page).toHaveURL(`/l/${location.id}`);

    // 1) Catálogo completo antes de los cambios.
    const first = await readDelta(
      await page.request.get(deltaUrl(location.id)),
    );
    expect(first.mode).toBe("full");
    expect(first.organizationId).toBe(tenant.organization.id);
    expect(first.products).toHaveLength(2);
    expect(first.cursor).not.toBeNull();
    const cursor = first.cursor ?? "";
    const before = new Map(first.products.map((p) => [p.id, p]));
    expect(before.get(repriced.id)).toMatchObject({
      salePriceCents: 100_000,
      status: "active",
    });
    expect(before.get(deactivated.id)).toMatchObject({ status: "active" });

    // 2) El encargado cambia un precio y desactiva un producto con su propia sesión
    //    (Data API + RLS: lo mismo que hacen las acciones de C-09).
    const managerClient = createPublishableClient();
    const signIn = await managerClient.auth.signInWithPassword({
      email: manager.email,
      password: manager.password,
    });
    expect(signIn.error).toBeNull();

    const price = await managerClient
      .from("products")
      .update({ sale_price: 1350 })
      .eq("id", repriced.id)
      .select("id");
    expect(price.error).toBeNull();
    expect(price.data).toHaveLength(1);

    const status = await managerClient
      .from("products")
      .update({
        status: "inactive",
        quick_sale_position: null,
        quick_sale_label: null,
      })
      .eq("id", deactivated.id)
      .select("id");
    expect(status.error).toBeNull();
    expect(status.data).toHaveLength(1);

    // 3) El delta pedido con el cursor anterior trae los dos cambios. La ventana de
    //    solapamiento puede sumar otras filas: se afirma que están, no que son las únicas.
    const second = await readDelta(
      await page.request.get(deltaUrl(location.id, cursor)),
    );
    expect(second.mode).toBe("delta");
    const after = new Map(second.products.map((p) => [p.id, p]));
    expect(after.get(repriced.id)).toMatchObject({
      salePriceCents: 135_000,
      status: "active",
    });
    expect(after.get(deactivated.id)).toMatchObject({ status: "inactive" });
    expect(second.cursor).not.toBeNull();
    expect(Date.parse(second.cursor ?? "")).toBeGreaterThanOrEqual(
      Date.parse(cursor),
    );
  });
});

test.describe("regresión: las páginas siguen redirigiendo a /login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sin sesión, / y /l/<id> mandan a /login con el destino original", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/login?next=%2F");

    await page.goto(`/l/${SEED.localCentroNorte}`);
    await expect(page).toHaveURL(`/login?next=%2Fl%2F${SEED.localCentroNorte}`);
  });

  test("a un pedido que no es de /api/ el proxy le responde con una redirección, no con un 401", async ({
    request,
  }) => {
    const response = await request.get(`/l/${SEED.localCentroNorte}`, {
      maxRedirects: 0,
    });

    // El proxy redirige con 303 (See Other): una página, a diferencia de /api/, sí se redirige.
    expect([303, 307, 308]).toContain(response.status());
    expect(response.headers()["location"]).toContain("/login");
  });
});
