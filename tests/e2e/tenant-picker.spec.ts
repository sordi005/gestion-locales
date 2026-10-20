import { signInThroughUi } from "./support/auth-ui";
import { storageStateFor } from "./support/storage-state";
import { expect, test } from "./support/tenant-fixture";

// Spec tenant-context "Selector de local".

const LOCAL_CENTRO_SUR = "00000000-0000-4000-b000-000000000002";
const LOCAL_ESTE_SUR = "00000000-0000-4000-b000-000000000003";

test.describe("owner.sur elige su local", () => {
  test.use({ storageState: storageStateFor("owner.sur") });

  test("/locales lista los dos locales de su organización", async ({
    page,
  }) => {
    await page.goto("/locales");

    await expect(
      page.getByRole("heading", { level: 1, name: "Elegí un local" }),
    ).toBeVisible();
    const organization = page.getByRole("region", { name: "Almacén Demo Sur" });
    await expect(organization.getByRole("link")).toHaveText([
      "Local Centro",
      "Local Este",
    ]);
    await expect(
      organization.getByRole("link", { name: "Local Centro" }),
    ).toHaveAttribute("href", `/l/${LOCAL_CENTRO_SUR}`);
  });

  test(
    "elige 'Local Este' solo con el teclado y llega a su inicio",
    { tag: "@keyboard" },
    async ({ page }) => {
      await page.goto("/locales");
      const centro = page.getByRole("link", { name: "Local Centro" });
      const este = page.getByRole("link", { name: "Local Este" });

      await page.keyboard.press("Tab"); // "Saltar al contenido"
      await page.keyboard.press("Tab");
      await expect(centro).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(este).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(`/l/${LOCAL_ESTE_SUR}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Local Este" }),
      ).toBeVisible();
    },
  );
});

test.describe("en el tenant descartable", () => {
  test("un empleado con dos de tres locales ve solo esos dos", async ({
    page,
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const este = await tenant.addLocation("Local Este");
    const oeste = await tenant.addLocation("Local Oeste");
    const employee = await tenant.addMember({
      role: "employee",
      locations: [centro, oeste],
    });

    // Con dos locales, `/` lo lleva al selector.
    await signInThroughUi(page, employee);
    await expect(page).toHaveURL("/locales");

    const organization = page.getByRole("region", {
      name: tenant.organization.name,
    });
    await expect(organization.getByRole("link")).toHaveText([
      "Local Centro",
      "Local Oeste",
    ]);
    await expect(page.getByRole("link", { name: "Local Este" })).toHaveCount(0);

    // El que no tiene asignado tampoco abre por la URL.
    const response = await page.goto(`/l/${este.id}`);
    expect(response?.status()).toBe(404);
  });
});
