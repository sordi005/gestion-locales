import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DataSourcesPage from "@/app/(app)/fuentes-de-datos/page";
import { decideAccess, routeKindOf } from "@/features/auth/routing";
import { requireUser } from "@/features/auth/server";

// Spec shared-product-base "Atribución de las fuentes": `/fuentes-de-datos` cita el
// SEPA / Precios Claros (CC BY 4.0 y CC BY 2.5 AR) y Open Food Facts (ODbL 1.0 para
// la base, DbCL para los contenidos), con enlaces a sus licencias. Es una página
// protegida: sin sesión el proxy manda a /login.

vi.mock("@/features/auth/server", () => ({ requireUser: vi.fn() }));

beforeEach(() => {
  vi.mocked(requireUser)
    .mockReset()
    .mockResolvedValue({} as never);
});

async function renderPage() {
  return render(await DataSourcesPage());
}

function linkNamed(name: string | RegExp): HTMLAnchorElement {
  const link = screen.getByRole("link", { name });
  if (!(link instanceof HTMLAnchorElement)) throw new Error("no es un enlace");
  return link;
}

describe("página /fuentes-de-datos", () => {
  it("llama a requireUser por su cuenta y dibuja el título dentro del main", async () => {
    await renderPage();

    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("main")).toContainElement(
      screen.getByRole("heading", { level: 1, name: "Fuentes de datos" }),
    );
  });

  it("si la guarda corta (sin sesión), no dibuja nada", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(DataSourcesPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("cita el SEPA / Precios Claros con la Secretaría de Comercio y sus licencias", async () => {
    await renderPage();

    const section = screen.getByRole("region", {
      name: "SEPA / Precios Claros",
    });
    expect(section).toHaveTextContent("Secretaría de Comercio");
    expect(section).toHaveTextContent("CC BY 4.0");
    expect(section).toHaveTextContent("CC BY 2.5 AR");
    expect(
      within(section).getByRole("link", { name: /Página del dataset/ }),
    ).toHaveAttribute(
      "href",
      "https://datos.gob.ar/dataset/precios-claros-base-sepa",
    );
    expect(
      within(section).getByRole("link", { name: "CC BY 4.0" }),
    ).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by/4.0/deed.es",
    );
    expect(
      within(section).getByRole("link", { name: "CC BY 2.5 AR" }),
    ).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by/2.5/ar/",
    );
  });

  it("cita Open Food Facts con ODbL 1.0 para la base y DbCL para los contenidos", async () => {
    await renderPage();

    const section = screen.getByRole("region", { name: "Open Food Facts" });
    expect(section).toHaveTextContent("ODbL 1.0");
    expect(section).toHaveTextContent("DbCL");
    expect(
      within(section).getByRole("link", { name: "Open Food Facts" }),
    ).toHaveAttribute("href", "https://world.openfoodfacts.org");
    expect(
      within(section).getByRole("link", { name: "ODbL 1.0" }),
    ).toHaveAttribute("href", "https://opendatacommons.org/licenses/odbl/1-0/");
    expect(within(section).getByRole("link", { name: "DbCL" })).toHaveAttribute(
      "href",
      "https://opendatacommons.org/licenses/dbcl/1-0/",
    );
  });

  it("no promete una separación que la base no tiene: avisa que una corrección del equipo deja de contar como dato de la fuente", async () => {
    await renderPage();

    const section = screen.getByRole("region", { name: "Open Food Facts" });
    expect(section).not.toHaveTextContent(/separadas del resto/i);
    expect(section).not.toHaveTextContent(/quedan identificadas/i);
    expect(section).toHaveTextContent(
      /si el equipo corrige una a mano, deja de contar como dato de Open Food Facts/i,
    );
  });

  it("aclara qué se usa y qué no: sin precios, sin imágenes y sin datos de comercios", async () => {
    await renderPage();

    const main = screen.getByRole("main");
    expect(main).toHaveTextContent(/no usamos precios/i);
    expect(main).toHaveTextContent(/imágenes/i);
    expect(main).toHaveTextContent(/nombre, la marca y la presentación/i);
  });

  it("los enlaces externos abren sin pasar el origen (rel noopener)", async () => {
    await renderPage();

    for (const link of screen.getAllByRole("link")) {
      if (link.getAttribute("href")?.startsWith("https://")) {
        expect(link.getAttribute("rel")).toContain("noopener");
      }
    }
    expect(linkNamed("Volver al inicio")).toHaveAttribute("href", "/");
  });
});

describe("la ruta es protegida en el proxy", () => {
  it("/fuentes-de-datos es una ruta protegida y sin sesión redirige a /login con el next", () => {
    expect(routeKindOf("/fuentes-de-datos")).toBe("protected");

    const decision = decideAccess(routeKindOf("/fuentes-de-datos"), "none", {
      method: "GET",
      pathname: "/fuentes-de-datos",
      search: "",
    });

    expect(decision).toMatchObject({ type: "redirect" });
    expect(decision.type === "redirect" ? decision.to : "").toBe(
      "/login?next=%2Ffuentes-de-datos",
    );
  });

  it("lo mismo vale para /admin/base-de-productos", () => {
    const decision = decideAccess(
      routeKindOf("/admin/base-de-productos"),
      "none",
      { method: "GET", pathname: "/admin/base-de-productos", search: "" },
    );

    expect(decision.type === "redirect" ? decision.to : "").toBe(
      "/login?next=%2Fadmin%2Fbase-de-productos",
    );
  });
});
