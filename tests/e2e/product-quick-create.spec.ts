import type { Page } from "@playwright/test";

import { signInThroughUi } from "./support/auth-ui";
import {
  ean13,
  enter,
  expect,
  hydrated,
  press,
  seedProduct,
  signInAsNewOwner,
  typeMoney,
  uniqueEan13,
} from "./support/catalog-ui";
import { createAdminClient } from "./support/supabase-admin";
import { createTenant, test } from "./support/tenant-fixture";
import type { Tenant } from "./support/tenant-fixture";
import { readerBurst } from "./support/usb-reader";
import { EAN13_FIXTURE_PATH } from "./global-setup";

// Specs product-quick-create "Pantalla Productos" y "Alta rápida" (C-12): escanear (tipeo
// y cámara falsa) o buscar por nombre, dar de alta con la hoja y poner el primer precio.
// Cada test arma su propio tenant descartable (`tenant-fixture`) y usa códigos únicos: el
// seed solo se lee (por eso no se usa `owner.norte` para escribir) y no hay nada que
// limpiar ni orden entre tests.

test.describe.configure({ timeout: 120_000 });

// `launchOptions` es opción de worker: va arriba del archivo. La cámara falsa solo la usa
// el test de la cámara (los demás tipean el código).
test.use({
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${EAN13_FIXTURE_PATH}`,
    ],
  },
});

const MISREAD = "Revisá que el número coincida con el de la caja";
/** Primer código de la base compartida del seed (`779700000001`): "Galletitas de limón" / "Campo Verde". */
const SHARED_CODE = ean13("779700000001");
const NO_RESULTS =
  "No encontramos productos con ese nombre. Escaneá el código para cargarlo.";

function productsPath(locationId: string): string {
  return `/l/${locationId}/productos`;
}

/** Abre "Productos" y espera a que el campo del código esté hidratado. */
async function openProducts(page: Page, locationId: string): Promise<void> {
  await page.goto(productsPath(locationId));
  await expect(
    page.getByRole("heading", { level: 1, name: "Productos" }),
  ).toBeVisible();
  await hydrated(page.getByLabel("Código de barras"));
}

/** Tipea un código en el campo del escáner y confirma con Enter, como un lector USB. */
async function typeCode(page: Page, code: string): Promise<void> {
  const field = await hydrated(page.getByLabel("Código de barras"));
  await field.fill(code);
  await field.press("Enter");
}

const sheet = (page: Page) => page.getByRole("dialog");
const card = (page: Page, name: string | RegExp) =>
  page.getByRole("article", { name });

/** Ingresa como un empleado nuevo del tenant y llega a "Productos". */
async function signInAsNewEmployee(page: Page, tenant: Tenant) {
  const location = await tenant.addLocation("Local Centro");
  const employee = await tenant.addMember({
    role: "employee",
    locations: [location],
    fullName: "Empleada E2E Productos",
  });
  await signInThroughUi(page, employee);
  await expect(page).toHaveURL(`/l/${location.id}`);
  return location;
}

test.describe("dueño: alta con sugerencia de la base compartida", () => {
  test("código de la base compartida: la hoja trae nombre y marca editables, se corrige la marca, se guarda con precio y después se encuentra por código y por nombre sin acentos", async ({
    page,
    tenant,
  }) => {
    const { location } = await signInAsNewOwner(page, tenant);
    await openProducts(page, location.id);

    await typeCode(page, SHARED_CODE);

    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByText(SHARED_CODE)).toBeVisible();
    const name = sheet(page).getByLabel("Nombre", { exact: true });
    const brand = sheet(page).getByLabel("Marca", { exact: true });
    await expect(name).toHaveValue("Galletitas de limón 120 g");
    await expect(brand).toHaveValue("Campo Verde");
    // Con la sugerencia no hay aviso de "revisá el número".
    await expect(sheet(page).getByText(MISREAD)).toHaveCount(0);

    await enter(brand, "Campo Verde Plus");
    await typeMoney(sheet(page).getByLabel("Precio", { exact: true }), "900");
    await press(sheet(page).getByRole("button", { name: "Guardar" }));

    await expect(sheet(page)).toHaveCount(0);
    const created = card(page, "Galletitas de limón 120 g");
    await expect(created).toBeVisible();
    await expect(created.getByText("Campo Verde Plus")).toBeVisible();
    await expect(created).toContainText(/\$\s900,00/);
    // El dueño ve el enlace a la ficha del catálogo.
    await expect(created.getByRole("link", { name: /ficha/i })).toBeVisible();

    // Volver a tipearlo: lo encuentra sin abrir la hoja.
    await typeCode(page, SHARED_CODE);
    await expect(created).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);

    // Por nombre y sin acentos ("limon"): el resultado aparece en la lista.
    await enter(page.getByLabel("Buscar por nombre"), "limon");
    await expect(
      page
        .getByRole("list", { name: "Resultados de la búsqueda" })
        .getByRole("button", { name: /Galletitas de limón 120 g/ }),
    ).toBeVisible();
  });
});

test.describe("empleado", () => {
  test("da de alta con precio y ve el producto, sin datos de administración ni controles para editar sus datos", async ({
    page,
    tenant,
  }) => {
    const location = await signInAsNewEmployee(page, tenant);
    await openProducts(page, location.id);
    const code = uniqueEan13();

    await typeCode(page, code);
    await expect(sheet(page)).toBeVisible();
    await enter(
      sheet(page).getByLabel("Nombre", { exact: true }),
      "Chicle E2E",
    );
    await typeMoney(sheet(page).getByLabel("Precio", { exact: true }), "150");
    await press(sheet(page).getByRole("button", { name: "Guardar" }));

    const created = card(page, "Chicle E2E");
    await expect(created).toBeVisible();
    await expect(created).toContainText(/\$\s150,00/);
    await expect(created.getByRole("link")).toHaveCount(0);
    await expect(created.getByRole("textbox")).toHaveCount(0);
    await expect(created.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(
      /costo|proveedor|margen/i,
    );
  });

  test("'Se vende por peso': el campo pasa a 'Precio por kilo' y la tarjeta muestra '/ kg'", async ({
    page,
    tenant,
  }) => {
    const location = await signInAsNewEmployee(page, tenant);
    await openProducts(page, location.id);

    await typeCode(page, uniqueEan13());
    await expect(sheet(page)).toBeVisible();
    await enter(sheet(page).getByLabel("Nombre", { exact: true }), "Queso E2E");
    await press(sheet(page).getByLabel("Se vende por peso"));
    await typeMoney(sheet(page).getByLabel("Precio por kilo"), "4500");
    await press(sheet(page).getByRole("button", { name: "Guardar" }));

    const created = card(page, "Queso E2E");
    await expect(created).toContainText(/\$\s4\.500,00 \/ kg/);
  });

  test("precio $0 bloqueado: la hoja marca el error y no crea nada; con un precio válido guarda", async ({
    page,
    tenant,
    admin,
  }) => {
    const location = await signInAsNewEmployee(page, tenant);
    await openProducts(page, location.id);

    await typeCode(page, uniqueEan13());
    await expect(sheet(page)).toBeVisible();
    await enter(
      sheet(page).getByLabel("Nombre", { exact: true }),
      "Alfajor cero E2E",
    );
    await typeMoney(sheet(page).getByLabel("Precio", { exact: true }), "0");
    await press(sheet(page).getByRole("button", { name: "Guardar" }));

    await expect(
      sheet(page).getByText("El precio tiene que ser mayor a $0."),
    ).toBeVisible();
    await expect(sheet(page)).toBeVisible();
    const { data: none, error } = await admin
      .from("products")
      .select("id")
      .eq("organization_id", tenant.organization.id)
      .eq("name", "Alfajor cero E2E");
    expect(error).toBeNull();
    expect(none).toHaveLength(0);

    await typeMoney(sheet(page).getByLabel("Precio", { exact: true }), "800");
    await press(sheet(page).getByRole("button", { name: "Guardar" }));

    const created = card(page, "Alfajor cero E2E");
    await expect(created).toBeVisible();
    await expect(created).toContainText(/\$\s800,00/);
  });

  test("código desconocido sin sugerencia: hoja vacía con el aviso del número y la atribución, se guarda igual sin precio y después se le pone el precio", async ({
    page,
    tenant,
  }) => {
    const location = await signInAsNewEmployee(page, tenant);
    await openProducts(page, location.id);
    const code = uniqueEan13();

    await typeCode(page, code);

    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByLabel("Nombre", { exact: true })).toHaveValue(
      "",
    );
    await expect(sheet(page).getByText(MISREAD)).toBeVisible();
    await expect(
      sheet(page).getByText(/Nombres sugeridos con datos públicos/),
    ).toBeVisible();
    await expect(
      sheet(page).getByRole("link", { name: "ver fuentes" }),
    ).toHaveAttribute("href", "/fuentes-de-datos");

    await enter(
      sheet(page).getByLabel("Nombre", { exact: true }),
      "Turrón sin sugerencia E2E",
    );
    await press(sheet(page).getByRole("button", { name: "Guardar" }));

    const created = card(page, "Turrón sin sugerencia E2E");
    await expect(
      created.getByText("Sin precio", { exact: true }),
    ).toBeVisible();
    await press(created.getByRole("button", { name: "Poner precio" }));
    await expect(
      sheet(page).getByRole("heading", { name: "Poné el precio" }),
    ).toBeVisible();
    await typeMoney(sheet(page).getByLabel("Precio", { exact: true }), "700");
    await press(sheet(page).getByRole("button", { name: "Guardar" }));

    await expect(sheet(page)).toHaveCount(0);
    await expect(created).toContainText(/\$\s700,00/);
    await expect(
      created.getByRole("button", { name: "Poner precio" }),
    ).toHaveCount(0);
  });

  test("un producto sin precio encontrado por nombre (sin código): 'Poner precio' le pone el primer precio y la tarjeta lo muestra", async ({
    page,
    tenant,
    admin,
  }) => {
    // Cargado sin precio y sin código (como desde el catálogo): solo se encuentra por nombre.
    await seedProduct(admin, tenant.organization.id, {
      name: "Yerba sin precio E2E",
      salePrice: null,
    });
    const location = await signInAsNewEmployee(page, tenant);
    await openProducts(page, location.id);

    await enter(page.getByLabel("Buscar por nombre"), "yerba sin precio");
    await press(
      page
        .getByRole("list", { name: "Resultados de la búsqueda" })
        .getByRole("button", { name: /Yerba sin precio E2E/ }),
    );

    const found = card(page, "Yerba sin precio E2E");
    await expect(found.getByText("Sin precio", { exact: true })).toBeVisible();
    await expect(found).not.toContainText(/Escaneá su código/);
    await press(found.getByRole("button", { name: "Poner precio" }));
    await expect(
      sheet(page).getByRole("heading", { name: "Poné el precio" }),
    ).toBeVisible();
    await typeMoney(sheet(page).getByLabel("Precio", { exact: true }), "2300");
    await press(sheet(page).getByRole("button", { name: "Guardar" }));

    await expect(sheet(page)).toHaveCount(0);
    await expect(found).toContainText(/\$\s2\.300,00/);
    await expect(
      found.getByRole("button", { name: "Poner precio" }),
    ).toHaveCount(0);
  });

  test("dígito verificador inválido tipeado: aviso y 'Cargar igual' muestra el formulario", async ({
    page,
    tenant,
  }) => {
    const location = await signInAsNewEmployee(page, tenant);
    await openProducts(page, location.id);
    const valid = uniqueEan13();
    const wrong = `${valid.slice(0, 12)}${(Number(valid[12]) + 1) % 10}`;

    await typeCode(page, wrong);

    await expect(sheet(page).getByText("Revisá el código")).toBeVisible();
    await expect(
      sheet(page).getByRole("button", { name: "Volver a escanear" }),
    ).toBeVisible();
    await press(sheet(page).getByRole("button", { name: "Cargar igual" }));
    await expect(
      sheet(page).getByLabel("Nombre", { exact: true }),
    ).toBeVisible();
  });
});

// Las ráfagas del lector van por `readerBurst` (`support/usb-reader.ts`): la página ve la
// temporización de un lector real (5 ms entre teclas) aunque la máquina esté cargada.
test.describe("lector USB (ráfaga de teclas)", () => {
  test("con la hoja abierta la ráfaga no se escribe en el nombre ni guarda nada", async ({
    page,
    tenant,
  }) => {
    const location = await signInAsNewEmployee(page, tenant);
    await openProducts(page, location.id);
    await typeCode(page, uniqueEan13());
    await expect(sheet(page)).toBeVisible();
    const name = sheet(page).getByLabel("Nombre", { exact: true });
    await name.click();
    await page.keyboard.type("Coca", { delay: 150 });
    await expect(name).toHaveValue("Coca");

    await readerBurst(page, uniqueEan13());

    // El campo queda como estaba, la hoja sigue abierta y no se creó nada.
    await expect(name).toHaveValue("Coca");
    await expect(sheet(page)).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
  });

  test("con el foco en 'Buscar por nombre' la ráfaga se toma como lectura y el buscador conserva su texto", async ({
    page,
    tenant,
  }) => {
    const location = await signInAsNewEmployee(page, tenant);
    await openProducts(page, location.id);
    const search = page.getByLabel("Buscar por nombre");
    await search.click();
    await page.keyboard.type("turr", { delay: 150 });
    await expect(search).toHaveValue("turr");
    const code = uniqueEan13();

    await readerBurst(page, code);

    // Era un código desconocido: se abre la hoja de alta con ese código.
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByText(code)).toBeVisible();
    await press(sheet(page).getByRole("button", { name: "Cancelar" }));
    await expect(sheet(page)).toHaveCount(0);
    await expect(search).toHaveValue("turr");
  });
});

test.describe("aislamiento entre comercios", () => {
  test("el dueño de otra organización no encuentra el producto: el mismo código le aparece como desconocido y no sale en su búsqueda", async ({
    page,
    tenant,
    admin,
  }) => {
    const code = uniqueEan13();
    const other = await createTenant(createAdminClient());
    try {
      await seedProduct(admin, other.tenant.organization.id, {
        name: "Producto ajeno E2E",
        salePrice: 100,
        barcode: code,
      });
      const { location } = await signInAsNewOwner(page, tenant);
      await openProducts(page, location.id);

      await typeCode(page, code);
      await expect(sheet(page)).toBeVisible();
      await expect(card(page, "Producto ajeno E2E")).toHaveCount(0);
      await press(sheet(page).getByRole("button", { name: "Cancelar" }));

      await enter(page.getByLabel("Buscar por nombre"), "ajeno");
      await expect(page.getByText(NO_RESULTS)).toBeVisible();
    } finally {
      await other.dispose();
    }
  });
});

test.describe("cámara falsa (celular)", () => {
  test("leer un código desconocido con la cámara abre la hoja con el código leído", async ({
    page,
    tenant,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "La cámara es la entrada del celular: solo corre en el proyecto mobile",
    );
    const { location } = await signInAsNewOwner(page, tenant);
    await openProducts(page, location.id);

    await press(page.getByRole("button", { name: "Escanear con la cámara" }));

    await expect(sheet(page)).toBeVisible();
    // El video falso empieza con `7790001000019` (desconocido en un tenant nuevo).
    await expect(sheet(page).getByText("7790001000019")).toBeVisible();
    // "Guardar" se alcanza sin desplazar la hoja.
    await expect(
      sheet(page).getByRole("button", { name: "Guardar" }),
    ).toBeInViewport();
  });
});
