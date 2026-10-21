import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LocationHomePage from "@/app/(app)/l/[locationId]/page";
import { buildTenantContext, resolveLocationAccess } from "@/features/tenancy";
import type { LocationContext, Section, SectionKey } from "@/features/tenancy";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_ESTE,
  ORG_NORTE,
  rowsFor,
} from "@/features/tenancy/domain/__tests__/fixtures";
import type { SeedUserKey } from "@/features/tenancy/domain/__tests__/fixtures";
import { requireLocationContext } from "@/features/tenancy/server";

// Spec app-shell "Inicio del local provisorio": `/l/[locationId]` llama a la guarda
// por su cuenta (no confía en el layout), muestra el nombre del local en un h1 y,
// mientras no haya secciones construidas, el texto de "muy pronto"; con secciones
// construidas, la lista. Se simulan la guarda y el registro de secciones.

const registry = vi.hoisted(() => ({ sections: [] as Section[] }));

vi.mock("@/features/tenancy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/tenancy")>();
  registry.sections.push(...actual.SECTIONS);
  return { ...actual, SECTIONS: registry.sections };
});
vi.mock("@/features/tenancy/server", () => ({
  requireLocationContext: vi.fn(),
}));
// La entrada de componentes de tenancy trae el botón de cerrar sesión (auth): se
// simula la acción que ese botón importa.
vi.mock("@/features/auth/actions", () => ({ logout: vi.fn() }));

function build(...keys: SectionKey[]) {
  const next = registry.sections.map((s) => ({
    ...s,
    built: s.key === "inicio" || keys.includes(s.key),
  }));
  registry.sections.splice(0, registry.sections.length, ...next);
}

function enter(user: SeedUserKey, locationId: string): LocationContext {
  const access = resolveLocationAccess(
    buildTenantContext(rowsFor(user)),
    locationId,
  );
  if (access.kind !== "ok") throw new Error(`${user} no entra a ${locationId}`);
  vi.mocked(requireLocationContext).mockResolvedValue(access.context);
  return access.context;
}

function renderPage(locationId: string) {
  return LocationHomePage({
    params: Promise.resolve({ locationId }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.mocked(requireLocationContext).mockReset();
  build();
});

describe("página /l/[locationId] (inicio del local)", () => {
  it("llama a requireLocationContext con el id de la URL, tal cual", async () => {
    enter("employee.norte", LOC_NORTE_CENTRO);

    await renderPage(LOC_NORTE_CENTRO);

    expect(requireLocationContext).toHaveBeenCalledTimes(1);
    expect(requireLocationContext).toHaveBeenCalledWith(LOC_NORTE_CENTRO);
  });

  it("el encabezado de nivel 1 es el nombre del local", async () => {
    enter("employee.norte", LOC_NORTE_CENTRO);

    render(await renderPage(LOC_NORTE_CENTRO));

    expect(
      screen.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toBeInTheDocument();
  });

  it("otro local, otro encabezado (no hay un nombre fijo)", async () => {
    enter("owner.sur", LOC_SUR_ESTE);

    render(await renderPage(LOC_SUR_ESTE));

    expect(
      screen.getByRole("heading", { level: 1, name: "Local Este" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Almacén Demo Sur")).toBeVisible();
  });

  it("mientras no haya secciones construidas muestra el texto de 'muy pronto' y ninguna lista", async () => {
    enter("employee.norte", LOC_NORTE_CENTRO);

    render(await renderPage(LOC_NORTE_CENTRO));

    expect(
      screen.getByText(
        "Muy pronto vas a poder vender y manejar la caja desde acá.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("con secciones construidas muestra la lista con su enlace y sin el texto de 'muy pronto'", async () => {
    build("vender", "caja");
    enter("employee.norte", LOC_NORTE_CENTRO);

    render(await renderPage(LOC_NORTE_CENTRO));

    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Vender", `/l/${LOC_NORTE_CENTRO}/vender`],
      ["Caja", `/l/${LOC_NORTE_CENTRO}/caja`],
    ]);
    expect(screen.queryByText(/Muy pronto/)).not.toBeInTheDocument();
  });

  it("la lista respeta el rol: el empleado no ve las secciones de organización, el dueño sí", async () => {
    build("vender", "estadisticas");

    enter("employee.norte", LOC_NORTE_CENTRO);
    const { unmount } = render(await renderPage(LOC_NORTE_CENTRO));
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Vender",
    ]);
    unmount();

    enter("owner.norte", LOC_NORTE_CENTRO);
    render(await renderPage(LOC_NORTE_CENTRO));
    expect(
      screen
        .getAllByRole("link")
        .map((l) => [l.textContent, l.getAttribute("href")]),
    ).toEqual([
      ["Vender", `/l/${LOC_NORTE_CENTRO}/vender`],
      ["Estadísticas", `/org/${ORG_NORTE}/estadisticas`],
    ]);
  });

  it("si la guarda corta (404 o salida), la página no dibuja nada", async () => {
    vi.mocked(requireLocationContext).mockRejectedValue(
      new Error("NEXT_NOT_FOUND"),
    );

    await expect(renderPage("no-es-un-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
