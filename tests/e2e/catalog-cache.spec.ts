import type { Page } from "@playwright/test";

import { SEED, expect } from "./support/catalog-ui";
import { signInThroughUi } from "./support/auth-ui";
import { readSeedPassword } from "./support/seed";
import { logOutThroughShell } from "./support/shell-ui";
import { seedEmailFor } from "./support/storage-state";
import { test } from "./support/tenant-fixture";

// Spec catalog-local-cache (C-11) "Sincronización al entrar al local" y "Limpieza al
// cerrar sesión", en PC y en celular (los dos proyectos de navegador). Se lee la base de
// IndexedDB `catalog-cache` directamente con `page.evaluate`, que es lo que de verdad
// queda guardado en el dispositivo.
//
// Ingresa por la UI con `employee.norte` en una sesión NUEVA (no la guardada): cerrar
// sesión solo revoca la de este dispositivo (`scope: "local"`), así que las sesiones
// guardadas del seed, que comparten todos los tests, siguen vivas.

test.describe.configure({ timeout: 90_000 });

const DB_NAME = "catalog-cache";
const STORES = ["meta", "products", "barcodes", "categories"] as const;
type StoreName = (typeof STORES)[number];

/** Lo que ningún almacén puede tener como clave: costo, origen del costo ni proveedor. */
const FORBIDDEN_KEY =
  /cost|supplier|proveedor|origin|source|stock_?min|history/i;

type CacheDump = Record<StoreName, unknown[]>;

/**
 * Lee todos los almacenes de la base `catalog-cache` SIN crearla: si no existe (o no
 * tiene los almacenes) devuelve `null`, así "la base está vacía" no se confunde con
 * "se creó una base nueva al preguntar".
 */
async function dumpCache(page: Page): Promise<CacheDump | null> {
  return page.evaluate(
    async ({ name, stores }) => {
      const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => {
          // La base no existía: se cancela para no dejar una vacía.
          request.transaction?.abort();
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => reject(new Error("blocked"));
      });
      if (db === null) return null;
      try {
        if (!stores.every((store) => db.objectStoreNames.contains(store))) {
          return null;
        }
        const entries = await Promise.all(
          stores.map(
            (store) =>
              new Promise<[string, unknown[]]>((resolve, reject) => {
                const read = db
                  .transaction(store, "readonly")
                  .objectStore(store)
                  .getAll();
                read.onsuccess = () => resolve([store, read.result]);
                read.onerror = () => reject(read.error);
              }),
          ),
        );
        return Object.fromEntries(entries);
      } finally {
        db.close();
      }
    },
    { name: DB_NAME, stores: [...STORES] },
  ) as Promise<CacheDump | null>;
}

function keysOf(value: unknown): string[] {
  return typeof value === "object" && value !== null ? Object.keys(value) : [];
}

test.describe("caché local del catálogo", () => {
  // Sin sesión guardada: ingresa por la UI y cierra sesión.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("employee.norte entra a su local: la caché guarda 40 productos sin claves de costo; el botón de cerrar sesión la vacía antes de salir (sin esperar a /login) y sigue vacía", async ({
    page,
    isMobile,
  }) => {
    await signInThroughUi(page, {
      email: seedEmailFor("employee.norte"),
      password: readSeedPassword(),
    });
    await expect(page).toHaveURL(`/l/${SEED.localCentroNorte}`);

    // El proveedor sincroniza al montarse: se espera a que la caché se llene.
    await expect
      .poll(async () => (await dumpCache(page))?.products.length ?? 0, {
        message: "la caché todavía no tiene los 40 productos",
        timeout: 30_000,
      })
      .toBe(40);

    const cache = await dumpCache(page);
    expect(cache).not.toBeNull();
    if (cache === null) return;

    expect(cache.categories).toHaveLength(7);
    expect(cache.barcodes.length).toBeGreaterThan(0);
    expect(cache.meta).toHaveLength(1);

    // Ningún registro de ningún almacén tiene una clave de costo, origen o proveedor.
    for (const store of STORES) {
      for (const entry of cache[store]) {
        const forbidden = keysOf(entry).filter((key) =>
          FORBIDDEN_KEY.test(key),
        );
        expect(
          forbidden,
          `${store}: ${JSON.stringify(entry).slice(0, 120)}`,
        ).toEqual([]);
      }
    }
    // Los productos guardan exactamente las claves de la caché (con `quickSale`).
    const [first] = cache.products;
    expect(keysOf(first).sort()).toEqual([
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
    ]);

    // El botón limpia ANTES de llamar a la Server Action que cierra la sesión
    // (`LogoutButton`). La pantalla de ingreso también limpia al montarse, así que
    // para probar que la del botón alcanza se retiene el pedido de la Server Action:
    // mientras está retenida, la persona sigue en el local, `/login` no se montó y la
    // base ya tiene que estar vacía.
    const local = new URL(page.url()).pathname;
    let releaseLogoutAction: () => void = () => {};
    const logoutActionReleased = new Promise<void>((resolve) => {
      releaseLogoutAction = resolve;
    });
    let logoutActionHeld = false;
    await page.route(
      (url) => url.pathname === local,
      async (route) => {
        const request = route.request();
        if (
          request.method() === "POST" &&
          request.headers()["next-action"] !== undefined
        ) {
          logoutActionHeld = true;
          await logoutActionReleased;
        }
        await route.continue();
      },
    );

    await logOutThroughShell(page, { isMobile });

    await expect
      .poll(() => dumpCache(page), {
        message:
          "la limpieza del botón no vació la base antes de cerrar la sesión",
      })
      .toEqual({ meta: [], products: [], barcodes: [], categories: [] });
    // Sigue en el local y el pedido que cierra la sesión sigue retenido: lo que
    // vació la base fue el botón, no la pantalla de ingreso.
    expect(logoutActionHeld).toBe(true);
    await expect(page).toHaveURL(local);

    releaseLogoutAction();
    await expect(page).toHaveURL("/login");
    // Y se queda vacía (la base sigue ahí, a propósito: otra pestaña podría tenerla
    // abierta).
    await expect
      .poll(() => dumpCache(page), {
        message: "la base de la caché no quedó vacía",
      })
      .toEqual({ meta: [], products: [], barcodes: [], categories: [] });
  });
});
