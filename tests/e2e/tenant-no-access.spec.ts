import { SESSION_COOKIE, signInThroughUi } from "./support/auth-ui";
import { goBackToEntry } from "./support/history";
import { accountControls, shellText } from "./support/shell-ui";
import { storageStateFor } from "./support/storage-state";
import { createTenant, expect, test } from "./support/tenant-fixture";

// Spec tenant-context "Salida por falta de acceso". Las personas que pierden el
// acceso en medio de la sesión son del tenant descartable (nunca un usuario del seed:
// sus membresías no se tocan). `/auth/sin-acceso` es una página que envía sola una
// Server Action de cierre (plan B de D8); el botón "Volver al ingreso" funciona sin
// JavaScript.

const NO_ACCESS_NOTICE =
  "Tu usuario no tiene acceso a ningún local. Si creés que es un error, hablá con el dueño del comercio.";

const LOCAL_CENTRO_NORTE = "00000000-0000-4000-b000-000000000001";

test.describe("membresía deshabilitada en medio de la sesión", () => {
  test("al navegar termina en /login con el aviso, sin cookies de sesión, y / vuelve a pedir el ingreso", async ({
    page,
    context,
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const employee = await tenant.addMember({
      role: "employee",
      locations: [centro],
    });
    await signInThroughUi(page, employee);
    await expect(page).toHaveURL(`/l/${centro.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toBeVisible();
    expect(
      (await context.cookies()).some(({ name }) => SESSION_COOKIE.test(name)),
    ).toBe(true);

    // El dueño (o el super-admin) la deshabilita mientras la persona tiene el local abierto.
    await tenant.setMembershipStatus(employee, "disabled");
    await page.goto(`/l/${centro.id}`);

    await expect(page).toHaveURL("/login?aviso=sin-acceso");
    await expect(
      page.getByRole("status").filter({ hasText: "no tiene acceso" }),
    ).toHaveText(NO_ACCESS_NOTICE);
    expect(
      (await context.cookies()).filter(({ name }) => SESSION_COOKIE.test(name)),
    ).toEqual([]);

    await page.goto("/");
    await expect(page).toHaveURL("/login?next=%2F");
  });

  // Una salida deja varias entradas en el historial (la ruta que redirige, la
  // pantalla de salida y `/login`): un solo `goBack()` caería en la de salida y no en
  // la pantalla protegida que mostraba el local. Se retrocede hasta ESA entrada.
  test("'Atrás' hasta la pantalla protegida de antes no la vuelve a mostrar: pide el ingreso", async ({
    page,
    isMobile,
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const este = await tenant.addLocation("Local Este");
    const manager = await tenant.addMember({
      role: "manager",
      locations: [centro, este],
      fullName: "Persona Sin Acceso",
    });
    await signInThroughUi(page, manager);
    await expect(page).toHaveURL("/locales");
    await page.getByRole("link", { name: "Local Centro" }).click();
    await expect(page).toHaveURL(`/l/${centro.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toBeVisible();
    await expect(shellText(page, "Persona Sin Acceso")).toBeVisible();

    // Pierde el acceso y sale por un enlace del marco (navegación del cliente).
    await tenant.setMembershipStatus(manager, "disabled");
    const controls = await accountControls(page, { isMobile });
    await controls.getByRole("link", { name: "Cambiar de local" }).click();
    await expect(page).toHaveURL("/login?aviso=sin-acceso");

    await goBackToEntry(page, `/l/${centro.id}`);

    // Esperar ESTA URL hace observable la navegación: mientras sigue en
    // `/login?aviso=sin-acceso` (antes del retroceso) las afirmaciones de abajo
    // pasarían igual. El proxy pide el ingreso para la ruta protegida a la que volvió.
    await expect(page).toHaveURL(`/login?next=%2Fl%2F${centro.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toHaveCount(0);
    await expect(page.getByText("Persona Sin Acceso")).toHaveCount(0);
  });

  test("también al navegar desde la misma pantalla, sin recargar (enlace del marco)", async ({
    page,
    isMobile,
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const este = await tenant.addLocation("Local Este");
    const manager = await tenant.addMember({
      role: "manager",
      locations: [centro, este],
    });
    await signInThroughUi(page, manager);
    await expect(page).toHaveURL("/locales");
    await page.getByRole("link", { name: "Local Centro" }).click();
    await expect(page).toHaveURL(`/l/${centro.id}`);

    await tenant.setMembershipStatus(manager, "disabled");
    // "Cambiar de local" es un enlace del marco: navegación del cliente, no recarga.
    // En PC está en el menú lateral y en celular dentro del panel de "Cuenta".
    const controls = await accountControls(page, { isMobile });
    await controls.getByRole("link", { name: "Cambiar de local" }).click();

    await expect(page).toHaveURL("/login?aviso=sin-acceso");
  });
});

test.describe("la salida por falta de acceso sin JavaScript", () => {
  test("el botón 'Volver al ingreso' cierra la sesión de este dispositivo y lleva a /login con el aviso", async ({
    browser,
    baseURL,
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const employee = await tenant.addMember({
      role: "employee",
      locations: [centro],
    });
    // Se ingresa con JavaScript, y la misma sesión se abre en un contexto sin él.
    const withScripts = await browser.newContext({ baseURL });
    const withoutScripts = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      storageState: await (async () => {
        const page = await withScripts.newPage();
        await signInThroughUi(page, employee);
        await expect(page).toHaveURL(`/l/${centro.id}`);
        return withScripts.storageState();
      })(),
    });
    try {
      await tenant.setMembershipStatus(employee, "disabled");
      const page = await withoutScripts.newPage();

      await page.goto(`/l/${centro.id}`);

      // Sin JavaScript nada se envía solo: queda la pantalla con el botón visible y
      // un texto que no afirma nada falso (todavía no se cerró nada).
      await expect(page).toHaveURL("/auth/sin-acceso");
      await expect(
        page.getByText("Tu usuario no tiene acceso a ningún local."),
      ).toBeVisible();
      await expect(page.getByText("Cerrando sesión")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Volver al ingreso", exact: true })
        .click();

      await expect(page).toHaveURL("/login?aviso=sin-acceso");
      expect(
        (await withoutScripts.cookies()).filter(({ name }) =>
          SESSION_COOKIE.test(name),
        ),
      ).toEqual([]);
    } finally {
      await withScripts.close();
      await withoutScripts.close();
    }
  });
});

// Una asignación (`membership_locations`) no se puede borrar ni con la secret key (no hay
// DELETE sobre esa tabla), así que el "local que ya no es suyo" se reproduce con las dos
// formas en que hoy puede pasar: el local se desactiva, o se deshabilita su membresía en
// una de dos organizaciones.
test.describe("pierde un local pero conserva otro", () => {
  test("un local desactivado da 404 y deja de ofrecerse (el selector ya no hace falta), el otro sigue abriendo y la sesión queda abierta", async ({
    page,
    context,
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const este = await tenant.addLocation("Local Este");
    const manager = await tenant.addMember({
      role: "manager",
      locations: [centro, este],
    });
    await signInThroughUi(page, manager);
    await expect(page).toHaveURL("/locales");

    await tenant.setLocationStatus(este, "inactive");

    const response = await page.goto(`/l/${este.id}`);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "No encontramos esta página",
      }),
    ).toBeVisible();

    // Su sesión sigue abierta y "Local Centro" sigue siendo suyo.
    expect(
      (await context.cookies()).some(({ name }) => SESSION_COOKIE.test(name)),
    ).toBe(true);
    // Con un solo local a la vista, el selector ya no hace falta: `/locales` lo salta.
    await page.goto("/locales");
    await expect(page).toHaveURL(`/l/${centro.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toBeVisible();
  });

  test("con una membresía en cada una de dos organizaciones, deshabilitar la de una da 404 en sus locales y deja la otra", async ({
    page,
    context,
    admin,
    tenant,
  }) => {
    const second = await createTenant(admin);
    try {
      const centro = await tenant.addLocation("Local Centro");
      const sucursal = await second.tenant.addLocation("Sucursal");
      const person = await tenant.addMember({
        role: "employee",
        locations: [centro],
      });
      const otherMembership = await second.tenant.addMember({
        role: "employee",
        locations: [sucursal],
        user: person,
      });
      await signInThroughUi(page, person);
      await expect(page).toHaveURL("/locales");

      await second.tenant.setMembershipStatus(otherMembership, "disabled");

      const response = await page.goto(`/l/${sucursal.id}`);
      expect(response?.status()).toBe(404);
      expect(
        (await context.cookies()).some(({ name }) => SESSION_COOKIE.test(name)),
      ).toBe(true);
      await page.goto("/");
      await expect(page).toHaveURL(`/l/${centro.id}`);
    } finally {
      await second.dispose();
    }
  });
});

test.describe("enlace a la salida con acceso", () => {
  test.describe("employee.norte, con acceso", () => {
    test.use({ storageState: storageStateFor("employee.norte") });

    test("/auth/sin-acceso lo manda a su inicio y su sesión sigue abierta", async ({
      page,
      context,
    }) => {
      await page.goto("/auth/sin-acceso");

      await expect(page).toHaveURL(`/l/${LOCAL_CENTRO_NORTE}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Local Centro" }),
      ).toBeVisible();
      expect(
        (await context.cookies()).some(({ name }) => SESSION_COOKIE.test(name)),
      ).toBe(true);
      // Y la sesión sigue sirviendo: otra pantalla protegida abre sin pedir el ingreso.
      await page.goto("/locales");
      await expect(page).toHaveURL(`/l/${LOCAL_CENTRO_NORTE}`);
    });
  });

  test.describe("sin sesión", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("/auth/sin-acceso lleva a /login y el next nunca vuelve a la salida", async ({
      page,
    }) => {
      await page.goto("/auth/sin-acceso");

      await expect(page).toHaveURL("/login?next=%2F");
    });
  });
});
