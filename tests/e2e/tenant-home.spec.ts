import { expect, test } from "@playwright/test";

import { SESSION_COOKIE } from "./support/auth-ui";
import { storageStateFor } from "./support/storage-state";
import type { StorageStateUser } from "./support/storage-state";

// Spec tenant-context "Redirección de inicio por rol y dispositivo" y "Pantalla
// provisoria del super-admin": cada persona del seed entra por `/` y llega a su
// inicio. Corre en `desktop-keyboard` y en `mobile` (Pixel 7, `Sec-CH-UA-Mobile: ?1`):
// mientras vender, caja y estadísticas no existan, el destino es el mismo en los dos.
// Las sesiones guardadas son de solo lectura: acá solo se abre `/`.

const LOCAL_CENTRO_NORTE = "00000000-0000-4000-b000-000000000001";
const LOCAL_CENTRO_SUR = "00000000-0000-4000-b000-000000000002";

const WITH_ONE_LOCATION: ReadonlyArray<{
  user: StorageStateUser;
  role: string;
  locationId: string;
}> = [
  {
    user: "employee.norte",
    role: "empleado",
    locationId: LOCAL_CENTRO_NORTE,
  },
  { user: "manager.sur", role: "encargado", locationId: LOCAL_CENTRO_SUR },
  { user: "owner.norte", role: "dueño", locationId: LOCAL_CENTRO_NORTE },
];

for (const { user, role, locationId } of WITH_ONE_LOCATION) {
  test.describe(`${user} (${role} con un solo local)`, () => {
    test.use({ storageState: storageStateFor(user) });

    test("/ termina en el inicio de su local", async ({ page }) => {
      await page.goto("/");

      await expect(page).toHaveURL(`/l/${locationId}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Local Centro" }),
      ).toBeVisible();
      await expect(
        page.getByText("Muy pronto vas a poder vender y manejar la caja"),
      ).toBeVisible();
    });
  });
}

test.describe("owner.sur (dueño con dos locales)", () => {
  test.use({ storageState: storageStateFor("owner.sur") });

  test("/ termina en el selector de local", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL("/locales");
    await expect(
      page.getByRole("heading", { level: 1, name: "Elegí un local" }),
    ).toBeVisible();
  });
});

test.describe("admin (super-admin sin locales)", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("/ muestra la pantalla provisoria con su nombre y sigue con la sesión abierta", async ({
    page,
    context,
  }) => {
    await page.goto("/");

    // No es falta de acceso: no se lo manda a la salida ni se le cierra la sesión.
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Hola, Admin Demo" }),
    ).toBeVisible();
    await expect(
      page.getByText("El panel de administración llega en un próximo paso."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeVisible();

    expect(
      (await context.cookies()).some(({ name }) => SESSION_COOKIE.test(name)),
    ).toBe(true);
    // Y la sesión sigue sirviendo al recargar.
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Hola, Admin Demo" }),
    ).toBeVisible();
  });
});
