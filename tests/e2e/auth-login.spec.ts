import {
  SESSION_COOKIE,
  loginFields,
  signInThroughUi,
  submitLogin,
} from "./support/auth-ui";
import { expect, test } from "./support/fixtures";
import { readSeedPassword } from "./support/seed";
import { createIsolatedUser, deleteUser } from "./support/supabase-admin";

// Spec auth-session: "Ingreso con email y contraseña", "Redirecciones internas
// seguras" y "Cookies de sesión httpOnly". Los usuarios del seed solo ingresan y
// leen (nunca cambian su contraseña ni piden un recupero).

const OWNER = {
  email: "owner.norte@demo.test",
  fullName: "Dueño Demo Norte",
};
const INVALID_CREDENTIALS = "El email o la contraseña no son correctos.";

test.describe("ingreso con email y contraseña", () => {
  test("el dueño del seed ingresa y la bienvenida lo saluda por su nombre", async ({
    page,
  }) => {
    await signInThroughUi(page, {
      email: OWNER.email,
      password: readSeedPassword(),
    });

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { level: 1, name: `Hola, ${OWNER.fullName}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeVisible();
  });

  test("contraseña equivocada y email inexistente muestran exactamente el mismo mensaje y no crean sesión", async ({
    page,
    context,
    isolatedUser,
  }) => {
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "El email o la contraseña" });

    await signInThroughUi(page, {
      email: isolatedUser.email,
      password: "no-es-la-contraseña",
    });
    await expect(alert).toHaveText(INVALID_CREDENTIALS);
    // El email no se pierde (React vacía el formulario al terminar la acción); la contraseña sí.
    await expect(loginFields(page).email).toHaveValue(isolatedUser.email);
    await expect(loginFields(page).password).toHaveValue("");

    await signInThroughUi(page, {
      email: "no-existe-e2e@e2e.test",
      password: "no-es-la-contraseña",
    });
    await expect(alert).toHaveText(INVALID_CREDENTIALS);

    await expect(page).toHaveURL(/\/login$/);
    const cookies = await context.cookies();
    expect(cookies.filter(({ name }) => SESSION_COOKIE.test(name))).toEqual([]);
  });

  test("una entrada inválida muestra el error del campo y no inicia sesión", async ({
    page,
  }) => {
    await page.goto("/login");
    const fields = loginFields(page);

    await fields.email.fill("no-es-un-email");
    await fields.submit.click();

    await expect(page.getByText("Escribí un email válido.")).toBeVisible();
    await expect(page.getByText("Escribí tu contraseña.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("después de ingresar vuelve a la página que había pedido (next) con su query", async ({
    page,
    isolatedUser,
  }) => {
    // Esa ruta todavía no existe (C-06): alcanza con ver a dónde llega.
    await page.goto("/l/123/vender?tab=1");
    await expect(page).toHaveURL("/login?next=%2Fl%2F123%2Fvender%3Ftab%3D1");

    const fields = loginFields(page);
    await fields.email.fill(isolatedUser.email);
    await fields.password.fill(isolatedUser.password);
    await fields.submit.click();

    await expect(page).toHaveURL("/l/123/vender?tab=1");
  });

  test("un next hacia otro sitio se ignora y termina en /", async ({
    page,
    isolatedUser,
  }) => {
    await signInThroughUi(
      page,
      { email: isolatedUser.email, password: isolatedUser.password },
      "/login?next=%2F%2Fevil.example",
    );

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /^Hola, / }),
    ).toBeVisible();
  });

  test("un next con caracteres fuera de ASCII se ignora y el ingreso termina en / (no en un error 500)", async ({
    page,
    isolatedUser,
  }) => {
    // `/€` en un header de redirección hace fallar a Node: tiene que descartarse.
    await signInThroughUi(
      page,
      { email: isolatedUser.email, password: isolatedUser.password },
      "/login?next=%2F%E2%82%AC",
    );

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /^Hola, / }),
    ).toBeVisible();
  });

  // Next manda la Server Action como un `fetch` POST: si el proxy la contestara con
  // una redirección HTTP, el cliente lanzaría "An unexpected response was received
  // from the server" y la persona vería la pantalla de error en lugar de entrar.
  test("una pestaña de ingreso vieja que envía el formulario después de ingresar en otra pestaña termina en / sin pantalla de error", async ({
    page,
    context,
    isolatedUser,
  }) => {
    const credentials = {
      email: isolatedUser.email,
      password: isolatedUser.password,
    };
    // Pestaña A: abierta en /login y olvidada (todavía no hay sesión).
    await page.goto("/login");
    await expect(loginFields(page).submit).toBeEnabled();

    // Pestaña B, del mismo navegador: ingresa y comparte la sesión por las cookies.
    const otherTab = await context.newPage();
    await signInThroughUi(otherTab, credentials);
    await expect(otherTab).toHaveURL("/");

    // La pestaña A, que sigue mostrando el formulario, lo envía.
    await submitLogin(page, credentials);

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `Hola, ${isolatedUser.email}`,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Algo salió mal" }),
    ).toHaveCount(0);
  });

  test("con sesión, /login lleva a /", async ({ page, isolatedUser }) => {
    await signInThroughUi(page, {
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    await expect(page).toHaveURL("/");

    await page.goto("/login");

    await expect(page).toHaveURL("/");
  });

  // Solo corre en `desktop-keyboard` (el proyecto `mobile` excluye @keyboard).
  test(
    "se ingresa solo con teclado: Tab, escribir y Enter",
    { tag: "@keyboard" },
    async ({ page, isolatedUser }) => {
      await page.goto("/login");
      const fields = loginFields(page);

      await page.keyboard.press("Tab"); // "Saltar al contenido"
      await page.keyboard.press("Tab");
      await expect(fields.email).toBeFocused();
      await page.keyboard.type(isolatedUser.email);
      await page.keyboard.press("Tab");
      await expect(fields.password).toBeFocused();
      await page.keyboard.type(isolatedUser.password);
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL("/");
      await expect(
        page.getByRole("heading", { level: 1, name: /^Hola, / }),
      ).toBeVisible();
    },
  );
});

test.describe("bienvenida", () => {
  test("un usuario sin full_name es saludado por su email", async ({
    page,
    isolatedUser,
  }) => {
    // La fixture crea al usuario sin nombre: su perfil queda con full_name NULL.
    await signInThroughUi(page, {
      email: isolatedUser.email,
      password: isolatedUser.password,
    });

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `Hola, ${isolatedUser.email}`,
      }),
    ).toBeVisible();
  });

  test("un usuario con full_name es saludado por su nombre", async ({
    page,
    admin,
  }) => {
    const user = await createIsolatedUser(admin, { fullName: "Ana E2E" });
    try {
      await signInThroughUi(page, {
        email: user.email,
        password: user.password,
      });

      await expect(
        page.getByRole("heading", { level: 1, name: "Hola, Ana E2E" }),
      ).toBeVisible();
    } finally {
      await deleteUser(admin, user.id);
    }
  });
});

test.describe("cookies de sesión", () => {
  test("las cookies sb-*-auth-token son httpOnly, SameSite=Lax y JavaScript no las ve", async ({
    page,
    context,
    isolatedUser,
  }) => {
    await signInThroughUi(page, {
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    await expect(page).toHaveURL("/");

    const sessionCookies = (await context.cookies()).filter(({ name }) =>
      SESSION_COOKIE.test(name),
    );
    expect(sessionCookies.length).toBeGreaterThan(0);
    for (const cookie of sessionCookies) {
      expect(cookie.httpOnly, cookie.name).toBe(true);
      expect(cookie.sameSite, cookie.name).toBe("Lax");
    }

    const visibleToScripts = await page.evaluate(() => document.cookie);
    expect(visibleToScripts).not.toContain("auth-token");
  });

  test("la sesión sigue en una página nueva del mismo contexto", async ({
    page,
    context,
    isolatedUser,
  }) => {
    await signInThroughUi(page, {
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    await expect(page).toHaveURL("/");

    const secondPage = await context.newPage();
    await secondPage.goto("/");

    await expect(secondPage).toHaveURL("/");
    await expect(
      secondPage.getByRole("heading", { level: 1, name: /^Hola, / }),
    ).toBeVisible();
  });
});
