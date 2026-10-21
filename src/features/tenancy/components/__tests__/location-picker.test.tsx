import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LocationPicker } from "../location-picker";

// Spec tenant-context "Selector de local": los locales agrupados por organización,
// la suspendida marcada, cada uno con un enlace a `/l/[id]`, el nombre de la
// persona y "Cerrar sesión". Se usa solo con teclado en la PC del mostrador.

vi.mock("@/features/auth/actions", () => ({ logout: vi.fn() }));
vi.mock("@/features/auth/logout-cleanup", () => ({
  runLogoutCleanups: vi.fn(async () => {}),
}));

const SUR = {
  id: "00000000-0000-4000-a000-000000000002",
  name: "Almacén Demo Sur",
  writable: true,
  locations: [
    { id: "00000000-0000-4000-b000-000000000002", name: "Local Centro" },
    { id: "00000000-0000-4000-b000-000000000003", name: "Local Este" },
  ],
};
const NORTE_SUSPENDIDA = {
  id: "00000000-0000-4000-a000-000000000001",
  name: "Kiosco Demo Norte",
  writable: false,
  locations: [
    { id: "00000000-0000-4000-b000-000000000001", name: "Local Centro" },
  ],
};

describe("LocationPicker", () => {
  it("tiene un encabezado de nivel 1 y muestra el nombre de la persona", () => {
    render(<LocationPicker userName="Dueño Demo Sur" organizations={[SUR]} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Elegí un local" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Dueño Demo Sur")).toBeVisible();
  });

  it('dibuja un único <main id="contenido"> con los locales y Cerrar sesión adentro', () => {
    render(
      <LocationPicker
        userName="Dueño Demo Sur"
        organizations={[SUR, NORTE_SUSPENDIDA]}
      />,
    );

    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute("id", "contenido");
    expect(within(mains[0]!).getAllByRole("link")).toHaveLength(3);
    expect(mains[0]).toContainElement(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    );
  });

  it("ofrece Cerrar sesión", () => {
    render(<LocationPicker userName="Dueño Demo Sur" organizations={[SUR]} />);

    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });

  it("lista cada local de la organización con un enlace a su inicio", () => {
    render(<LocationPicker userName="Dueño Demo Sur" organizations={[SUR]} />);

    const group = screen.getByRole("region", { name: "Almacén Demo Sur" });
    const links = within(group).getAllByRole("link");

    expect(links.map((link) => link.textContent)).toEqual([
      "Local Centro",
      "Local Este",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/l/00000000-0000-4000-b000-000000000002",
      "/l/00000000-0000-4000-b000-000000000003",
    ]);
  });

  it("agrupa por organización: el mismo nombre de local en dos organizaciones no se mezcla", () => {
    render(
      <LocationPicker
        userName="Persona"
        organizations={[NORTE_SUSPENDIDA, SUR]}
      />,
    );

    const norte = screen.getByRole("region", { name: "Kiosco Demo Norte" });
    const sur = screen.getByRole("region", { name: "Almacén Demo Sur" });

    expect(within(norte).getAllByRole("link")).toHaveLength(1);
    expect(within(norte).getByRole("link")).toHaveAttribute(
      "href",
      "/l/00000000-0000-4000-b000-000000000001",
    );
    expect(within(sur).getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Local Centro" })).toHaveLength(
      2,
    );
  });

  it("marca la organización suspendida y no marca la activa", () => {
    render(
      <LocationPicker
        userName="Persona"
        organizations={[NORTE_SUSPENDIDA, SUR]}
      />,
    );

    const norte = screen.getByRole("region", { name: "Kiosco Demo Norte" });
    const sur = screen.getByRole("region", { name: "Almacén Demo Sur" });

    expect(within(norte).getByText("Suspendida")).toBeVisible();
    expect(within(sur).queryByText("Suspendida")).not.toBeInTheDocument();
  });

  it("una organización suspendida sigue siendo navegable (todos entran a consultar)", () => {
    render(
      <LocationPicker userName="Persona" organizations={[NORTE_SUSPENDIDA]} />,
    );

    expect(screen.getByRole("link", { name: "Local Centro" })).toHaveAttribute(
      "href",
      "/l/00000000-0000-4000-b000-000000000001",
    );
  });

  it("se recorre solo con teclado: los enlaces reciben el foco con Tab, en orden", async () => {
    const user = userEvent.setup();
    render(<LocationPicker userName="Dueño" organizations={[SUR]} />);

    await user.tab();
    expect(screen.getByRole("link", { name: "Local Centro" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Local Este" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toHaveFocus();
  });
});
