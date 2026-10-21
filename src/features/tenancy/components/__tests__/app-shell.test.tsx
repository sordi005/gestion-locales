import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ShellModel } from "../../domain/shell-model";
import { AppShell } from "../app-shell";

// Spec app-shell "Marco responsive de la app" (D11): menú lateral en PC y barra
// inferior en celular (los dos están en el DOM y el CSS elige: en jsdom no hay
// CSS, así que cada parte se busca por su landmark), el nombre de la persona, el
// local y la organización siempre visibles, "Cambiar de local" solo con más de un
// local, "Cerrar sesión", `nav` con nombre, `aria-current="page"` en la sección
// actual y la cuenta del celular en un `Sheet` con título. Se simulan los bordes:
// la ruta actual, la Server Action de cierre y la limpieza local.

const route = vi.hoisted(() => ({ pathname: "/l/loc-1" }));

vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/features/auth/actions", () => ({ logout: vi.fn() }));
vi.mock("@/features/auth/logout-cleanup", () => ({
  runLogoutCleanups: vi.fn(async () => {}),
}));

function makeModel(overrides: Partial<ShellModel> = {}): ShellModel {
  return {
    userName: "Empleado Demo Norte",
    location: { id: "loc-1", name: "Local Centro" },
    organization: { id: "org-1", name: "Kiosco Demo Norte", writable: true },
    role: "employee",
    canSwitchLocation: false,
    sections: [{ key: "inicio", label: "Inicio", href: "/l/loc-1" }],
    ...overrides,
  };
}

function renderShell(
  model: ShellModel = makeModel(),
  children = <h1>Hola</h1>,
) {
  render(<AppShell model={model}>{children}</AppShell>);
  return {
    sidebar: screen.getByRole("complementary", { name: "Menú lateral" }),
    header: screen.getByRole("banner"),
    sideNav: screen.getByRole("navigation", { name: "Menú principal" }),
    bottomNav: screen.getByRole("navigation", { name: "Menú inferior" }),
  };
}

beforeEach(() => {
  route.pathname = "/l/loc-1";
});

describe("AppShell — menú lateral (PC)", () => {
  it("muestra el nombre de la persona, el local, la organización y Cerrar sesión", () => {
    const { sidebar } = renderShell();

    expect(within(sidebar).getByText("Empleado Demo Norte")).toBeVisible();
    expect(within(sidebar).getByText("Local Centro")).toBeVisible();
    expect(within(sidebar).getByText("Kiosco Demo Norte")).toBeVisible();
    expect(
      within(sidebar).getByRole("button", { name: "Cerrar sesión" }),
    ).toBeEnabled();
  });

  it("muestra el email cuando no hay nombre (el modelo ya trae el email como nombre)", () => {
    const { sidebar } = renderShell(
      makeModel({ userName: "sin.nombre@demo.test" }),
    );

    expect(within(sidebar).getByText("sin.nombre@demo.test")).toBeVisible();
  });

  it("lista las secciones visibles como enlaces a su dirección", () => {
    const { sideNav } = renderShell(
      makeModel({
        sections: [
          { key: "inicio", label: "Inicio", href: "/l/loc-1" },
          { key: "vender", label: "Vender", href: "/l/loc-1/vender" },
          { key: "catalogo", label: "Catálogo", href: "/org/org-1/catalogo" },
        ],
      }),
    );

    const links = within(sideNav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Inicio",
      "Vender",
      "Catálogo",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/l/loc-1",
      "/l/loc-1/vender",
      "/org/org-1/catalogo",
    ]);
  });

  it("marca con aria-current=page solo la sección actual", () => {
    route.pathname = "/l/loc-1/vender";
    const { sideNav } = renderShell(
      makeModel({
        sections: [
          { key: "inicio", label: "Inicio", href: "/l/loc-1" },
          { key: "vender", label: "Vender", href: "/l/loc-1/vender" },
        ],
      }),
    );

    expect(
      within(sideNav).getByRole("link", { name: "Vender" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(sideNav).getByRole("link", { name: "Inicio" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("en el inicio del local marca Inicio", () => {
    const { sideNav } = renderShell();

    expect(
      within(sideNav).getByRole("link", { name: "Inicio" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("ofrece Cambiar de local (enlace a /locales) solo si hay más de un local", () => {
    const { sidebar } = renderShell(makeModel({ canSwitchLocation: true }));

    expect(
      within(sidebar).getByRole("link", { name: "Cambiar de local" }),
    ).toHaveAttribute("href", "/locales");
  });

  it("no ofrece Cambiar de local con un solo local", () => {
    const { sidebar } = renderShell(makeModel({ canSwitchLocation: false }));

    expect(
      within(sidebar).queryByRole("link", { name: "Cambiar de local" }),
    ).not.toBeInTheDocument();
  });

  it("se recorre con Tab en orden visible: secciones, Cambiar de local y Cerrar sesión", async () => {
    renderShell(makeModel({ canSwitchLocation: true }));
    const user = userEvent.setup();

    const order: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await user.tab();
      order.push(document.activeElement?.textContent ?? "");
    }

    expect(order).toEqual(["Inicio", "Cambiar de local", "Cerrar sesión"]);
  });
});

describe("AppShell — celular", () => {
  it("el encabezado muestra el nombre de la persona y el local", () => {
    const { header } = renderShell();

    expect(within(header).getByText("Empleado Demo Norte")).toBeVisible();
    expect(within(header).getByText("Local Centro")).toBeVisible();
  });

  it("la barra inferior es un nav con las secciones (la actual marcada) y el botón Cuenta", () => {
    const { bottomNav } = renderShell();

    expect(
      within(bottomNav).getByRole("link", { name: "Inicio" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(bottomNav).getByRole("button", { name: "Cuenta" }),
    ).toBeEnabled();
  });

  it("los objetivos táctiles de la barra inferior miden al menos 44 px (min-h-11 o más)", () => {
    const { bottomNav } = renderShell();

    for (const target of [
      within(bottomNav).getByRole("link", { name: "Inicio" }),
      within(bottomNav).getByRole("button", { name: "Cuenta" }),
    ]) {
      expect(target.className).toMatch(/\bmin-h-(1[1-9]|[2-9]\d)\b/);
    }
  });

  it("Cuenta abre un diálogo con título, el nombre y Cerrar sesión; sin Cambiar de local con un solo local", async () => {
    const { bottomNav } = renderShell();

    await userEvent
      .setup()
      .click(within(bottomNav).getByRole("button", { name: "Cuenta" }));

    const dialog = await screen.findByRole("dialog", { name: "Cuenta" });
    expect(within(dialog).getByText(/Empleado Demo Norte/)).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Cerrar sesión" }),
    ).toBeEnabled();
    expect(
      within(dialog).queryByRole("link", { name: "Cambiar de local" }),
    ).not.toBeInTheDocument();
  });

  it("el diálogo de Cuenta ofrece Cambiar de local (a /locales) con más de un local y se cierra con Escape", async () => {
    const { bottomNav } = renderShell(makeModel({ canSwitchLocation: true }));
    const user = userEvent.setup();

    await user.click(within(bottomNav).getByRole("button", { name: "Cuenta" }));

    const dialog = await screen.findByRole("dialog", { name: "Cuenta" });
    expect(
      within(dialog).getByRole("link", { name: "Cambiar de local" }),
    ).toHaveAttribute("href", "/locales");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("AppShell — revisión de interfaz (7.6)", () => {
  it("el diálogo de Cuenta tiene un botón Cerrar de al menos 44 px que lo cierra", async () => {
    const { bottomNav } = renderShell();
    const user = userEvent.setup();
    await user.click(within(bottomNav).getByRole("button", { name: "Cuenta" }));

    const dialog = await screen.findByRole("dialog", { name: "Cuenta" });
    const close = within(dialog).getByRole("button", { name: /^Cerrar$/ });
    expect(close.className).toMatch(/(^| )h-11( |$)/);

    await user.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("el nombre del producto del menú no se traduce automáticamente", () => {
    const { sidebar } = renderShell();

    expect(within(sidebar).getByText("[NOMBRE-PRODUCTO]")).toHaveAttribute(
      "translate",
      "no",
    );
  });

  it("los ítems de la barra inferior tienen foco visible de alto contraste y evitan el zoom por doble toque", () => {
    const { bottomNav } = renderShell();

    for (const target of [
      within(bottomNav).getByRole("link", { name: "Inicio" }),
      within(bottomNav).getByRole("button", { name: "Cuenta" }),
    ]) {
      expect(target).toHaveClass("focus-visible:ring-2");
      expect(target).toHaveClass("focus-visible:ring-foreground");
      expect(target).toHaveClass("touch-manipulation");
    }
  });
});

describe("AppShell — contenido principal", () => {
  it('dibuja un único <main id="contenido"> con la página adentro y la navegación afuera', () => {
    const { sidebar, header, bottomNav } = renderShell(
      makeModel(),
      <h1>Local Centro</h1>,
    );

    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    const main = mains[0]!;
    expect(main).toHaveAttribute("id", "contenido");
    expect(main).toContainElement(
      screen.getByRole("heading", { level: 1, name: "Local Centro" }),
    );
    for (const outside of [sidebar, header, bottomNav]) {
      expect(main).not.toContainElement(outside);
    }
  });
});

describe("AppShell — aviso de organización suspendida", () => {
  it("no muestra ningún aviso con la organización activa", () => {
    renderShell();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/está suspendida/)).not.toBeInTheDocument();
  });

  it("muestra el aviso con el nombre de la organización cuando no es writable", () => {
    renderShell(
      makeModel({
        organization: {
          id: "org-1",
          name: "Kiosco Demo Norte",
          writable: false,
        },
      }),
    );

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(
      "La cuenta de Kiosco Demo Norte está suspendida: podés consultar tus datos, pero no cargar ventas ni cambios. Para reactivarla, comunicate con [NOMBRE-PRODUCTO].",
    );
  });

  it('el aviso va ADENTRO de <main id="contenido">, antes de la página: "Saltar al contenido" no lo esconde', () => {
    renderShell(
      makeModel({
        organization: {
          id: "org-1",
          name: "Kiosco Demo Norte",
          writable: false,
        },
      }),
      <h1>Local Centro</h1>,
    );

    const main = screen.getByRole("main");
    const banner = screen.getByRole("status");
    expect(main).toContainElement(banner);
    expect(main.firstElementChild).toBe(banner);
    expect(
      banner.compareDocumentPosition(
        screen.getByRole("heading", { level: 1, name: "Local Centro" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
