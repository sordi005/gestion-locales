import {
  chooseOption,
  ean13,
  enter,
  expect,
  press,
  productRow,
  seedProduct,
  signInAsNewOwner,
  typeMoney,
  uniqueEan13,
  upcA,
} from "./support/catalog-ui";
import { test } from "./support/tenant-fixture";

// Specs catalog-management "Alta de producto", "Código de barras único por organización"
// (CA-E02), "Búsqueda por nombre o código" y "Desactivar y reactivar". Cada test arma su
// propio tenant descartable (`tenant-fixture`) y escribe solo ahí: el seed no se toca.

// Cada paso espera a `next dev` (compila al primer uso): margen de sobra por test.
test.describe.configure({ timeout: 90_000 });

test.describe("alta de un producto", () => {
  test("crea un producto con precio y un código, va a su ficha y el listado muestra el código principal", async ({
    page,
    tenant,
  }) => {
    const session = await signInAsNewOwner(page, tenant);
    const code = uniqueEan13();

    await page.goto(`${session.catalogUrl}/nuevo`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Nuevo producto" }),
    ).toBeVisible();
    await enter(page.getByLabel("Nombre", { exact: true }), "Alfajor E2E");
    await enter(page.getByLabel("Marca", { exact: true }), "Marca E2E");
    await typeMoney(page.getByLabel("Precio de venta"), "1250");
    await typeMoney(page.getByLabel("Costo de referencia"), "1000");
    await expect(page.getByText("Margen: 20,0 %")).toBeVisible();
    await enter(page.getByLabel("Código de barras 1"), code);
    await press(page.getByRole("button", { name: "Guardar producto" }));

    // Va a la ficha: nombre, códigos y precio.
    await expect(page).toHaveURL(/\/catalogo\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Alfajor E2E" }),
    ).toBeVisible();
    const codes = page.getByRole("list", { name: "Códigos de barras" });
    await expect(codes).toContainText(code);
    await expect(codes.getByText("Principal")).toBeVisible();

    // El listado: la fila con su precio y su código principal.
    await page.goto(session.catalogUrl);
    const row = productRow(page, "Alfajor E2E");
    await expect(row).toContainText(/\$\s1\.250,00/);
    await expect(row).toContainText(`Código ${code}`);
    await expect(row.getByText("Activo")).toBeVisible();
  });

  test("un producto sin código y sin precio se crea igual y queda marcado 'Sin precio'", async ({
    page,
    tenant,
  }) => {
    const session = await signInAsNewOwner(page, tenant);

    await page.goto(`${session.catalogUrl}/nuevo`);
    await enter(
      page.getByLabel("Nombre", { exact: true }),
      "Caramelo suelto E2E",
    );
    await press(page.getByRole("button", { name: "Guardar producto" }));
    await expect(
      page.getByRole("heading", { level: 1, name: "Caramelo suelto E2E" }),
    ).toBeVisible();

    await page.goto(session.catalogUrl);
    const row = productRow(page, "Caramelo suelto E2E");
    await expect(row.getByText("Sin precio")).toBeVisible();
    await expect(row.getByText(/Código/)).toHaveCount(0);
  });

  test("Alta con un código ya usado: dice de qué producto es y no crea nada", async ({
    page,
    tenant,
    admin,
  }) => {
    const session = await signInAsNewOwner(page, tenant);
    const code = uniqueEan13();
    await seedProduct(admin, session.orgId, {
      name: "Producto dueño del código",
      salePrice: 900,
      barcode: code,
    });

    await page.goto(`${session.catalogUrl}/nuevo`);
    await enter(
      page.getByLabel("Nombre", { exact: true }),
      "Producto repetido",
    );
    await enter(page.getByLabel("Código de barras 1"), code);
    await press(page.getByRole("button", { name: "Guardar producto" }));

    const message = `El código ${code} ya es de «Producto dueño del código».`;
    await expect(
      page.getByRole("alert").filter({ hasText: message }),
    ).toBeVisible();
    await expect(page.getByLabel("Código de barras 1")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // Sigue en el formulario con lo escrito...
    await expect(page).toHaveURL(/\/catalogo\/nuevo$/);
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(
      "Producto repetido",
    );

    // ...y no se creó nada: el listado solo tiene el producto original.
    await page.goto(session.catalogUrl);
    await expect(productRow(page, "Producto dueño del código")).toBeVisible();
    await expect(productRow(page, "Producto repetido")).toHaveCount(0);
    const { count } = await admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.orgId);
    expect(count).toBe(1);
  });

  test("el mismo código con un cero inicial también cuenta como usado", async ({
    page,
    tenant,
    admin,
  }) => {
    const session = await signInAsNewOwner(page, tenant);
    const upc = upcA("04000012345");
    await seedProduct(admin, session.orgId, {
      name: "Producto UPC",
      salePrice: 500,
      barcode: upc,
    });

    await page.goto(`${session.catalogUrl}/nuevo`);
    await enter(
      page.getByLabel("Nombre", { exact: true }),
      "Producto con cero",
    );
    await enter(page.getByLabel("Código de barras 1"), `0${upc}`);
    await press(page.getByRole("button", { name: "Guardar producto" }));

    await expect(
      page.getByRole("alert").filter({ hasText: /ya es de «Producto UPC»\./ }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/catalogo\/nuevo$/);
  });
});

test.describe("búsqueda", () => {
  test("encuentra por el código con y sin cero inicial, y por nombre", async ({
    page,
    tenant,
    admin,
  }) => {
    const session = await signInAsNewOwner(page, tenant);
    const upc = upcA("04000012345");
    await seedProduct(admin, session.orgId, {
      name: "Galletita UPC E2E",
      salePrice: 700,
      barcode: upc,
    });
    await seedProduct(admin, session.orgId, {
      name: "Otro producto E2E",
      salePrice: 300,
      barcode: uniqueEan13(),
    });

    // Sin cero: el UPC-A de 12 dígitos tal cual.
    await page.goto(`${session.catalogUrl}?q=${upc}`);
    await expect(productRow(page, "Galletita UPC E2E")).toBeVisible();
    await expect(productRow(page, "Otro producto E2E")).toHaveCount(0);

    // Con cero inicial (EAN-13): el mismo producto, escrito en la caja de búsqueda.
    await page.goto(session.catalogUrl);
    await enter(page.getByRole("searchbox", { name: "Buscar" }), `0${upc}`);
    await press(page.getByRole("button", { name: "Buscar", exact: true }));
    await expect(page).toHaveURL(/q=0\d{11}/);
    await expect(productRow(page, "Galletita UPC E2E")).toBeVisible();
    await expect(productRow(page, "Otro producto E2E")).toHaveCount(0);

    // Por nombre (parte del texto, sin importar mayúsculas).
    await enter(page.getByRole("searchbox", { name: "Buscar" }), "otro prod");
    await press(page.getByRole("button", { name: "Buscar", exact: true }));
    await expect(productRow(page, "Otro producto E2E")).toBeVisible();
    await expect(productRow(page, "Galletita UPC E2E")).toHaveCount(0);

    // Sin coincidencias: mensaje y salida para limpiar.
    await enter(
      page.getByRole("searchbox", { name: "Buscar" }),
      "zzz-no-existe",
    );
    await press(page.getByRole("button", { name: "Buscar", exact: true }));
    await expect(
      page.getByText("No encontramos productos con esos filtros."),
    ).toBeVisible();
    await press(page.getByRole("link", { name: "Limpiar filtros" }));
    await expect(productRow(page, "Otro producto E2E")).toBeVisible();
  });

  test("texto con comodines o caracteres de filtro se busca como texto, no rompe nada", async ({
    page,
    tenant,
    admin,
  }) => {
    const session = await signInAsNewOwner(page, tenant);
    await seedProduct(admin, session.orgId, {
      name: "Jugo 50% fruta E2E",
      salePrice: 800,
    });
    await seedProduct(admin, session.orgId, {
      name: "Jugo 500 E2E",
      salePrice: 800,
    });

    await page.goto(`${session.catalogUrl}?q=${encodeURIComponent("50%")}`);
    await expect(productRow(page, "Jugo 50% fruta E2E")).toBeVisible();
    await expect(productRow(page, "Jugo 500 E2E")).toHaveCount(0);

    await page.goto(`${session.catalogUrl}?q=${encodeURIComponent("x,y)")}`);
    await expect(
      page.getByText("No encontramos productos con esos filtros."),
    ).toBeVisible();
  });
});

test.describe("desactivar y reactivar", () => {
  test("se desactiva con confirmación, deja el listado de activos y se reactiva", async ({
    page,
    tenant,
    admin,
  }) => {
    const session = await signInAsNewOwner(page, tenant);
    const product = await seedProduct(admin, session.orgId, {
      name: "Producto a desactivar E2E",
      salePrice: 1500,
      referenceCost: 900,
    });
    const productUrl = `${session.catalogUrl}/${product.id}`;

    await page.goto(productUrl);
    await expect(
      page.getByRole("heading", { level: 1, name: product.name }),
    ).toBeVisible();

    // Cancelar no cambia nada.
    await press(page.getByRole("button", { name: "Desactivar producto" }));
    const dialog = page.getByRole("dialog", {
      name: `¿Desactivar «${product.name}»?`,
    });
    await expect(dialog).toBeVisible();
    await press(dialog.getByRole("button", { name: "Cancelar" }));
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Desactivar producto" }),
    ).toBeVisible();

    // Confirmar: queda inactivo.
    await press(page.getByRole("button", { name: "Desactivar producto" }));
    await press(
      dialog.getByRole("button", { name: "Desactivar", exact: true }),
    );
    await expect(
      page.getByRole("button", { name: "Reactivar producto" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "Estado del producto" })
        .getByText("Inactivo"),
    ).toBeVisible();

    // Ya no está entre los activos del listado; sí entre los inactivos.
    await page.goto(session.catalogUrl);
    await expect(productRow(page, product.name)).toHaveCount(0);
    await chooseOption(page, "Estado", "Inactivos");
    await press(page.getByRole("button", { name: "Buscar", exact: true }));
    await expect(page).toHaveURL(/estado=inactivos/);
    const inactiveRow = productRow(page, product.name);
    await expect(inactiveRow).toBeVisible();
    await expect(inactiveRow.getByText("Inactivo")).toBeVisible();

    // Reactivar desde la ficha: vuelve a los activos.
    await press(inactiveRow.getByRole("link", { name: product.name }));
    await press(page.getByRole("button", { name: "Reactivar producto" }));
    await expect(
      page.getByRole("button", { name: "Desactivar producto" }),
    ).toBeVisible();
    await page.goto(session.catalogUrl);
    const activeRow = productRow(page, product.name);
    await expect(activeRow).toBeVisible();
    await expect(activeRow.getByText("Activo")).toBeVisible();
  });
});

test.describe("códigos de barras de la ficha", () => {
  test("agrega un segundo código y rechaza uno que es de otro producto", async ({
    page,
    tenant,
    admin,
  }) => {
    const session = await signInAsNewOwner(page, tenant);
    const mine = await seedProduct(admin, session.orgId, {
      name: "Producto con códigos E2E",
      salePrice: 1000,
      barcode: uniqueEan13(),
    });
    const takenCode = uniqueEan13();
    await seedProduct(admin, session.orgId, {
      name: "Producto ajeno E2E",
      salePrice: 1000,
      barcode: takenCode,
    });

    await page.goto(`${session.catalogUrl}/${mine.id}`);
    const secondCode = ean13("779800000007");

    await enter(page.getByLabel("Nuevo código"), takenCode);
    await press(page.getByRole("button", { name: "Agregar código" }));
    await expect(
      page.getByText(`El código ${takenCode} ya es de «Producto ajeno E2E».`),
    ).toBeVisible();

    await enter(page.getByLabel("Nuevo código"), secondCode);
    await press(page.getByRole("button", { name: "Agregar código" }));
    await expect(page.getByText("Código agregado.")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Códigos de barras" }),
    ).toContainText(secondCode);
  });
});
