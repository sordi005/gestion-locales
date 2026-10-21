import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar, SidebarProvider, SidebarTrigger } from "@/shared/ui/sidebar";

// D11: el `sidebar.tsx` copiado de shadcn se EDITÓ a mano para no guardar nada en
// el navegador (D12): borramos la cookie `sidebar_state` y el atajo Ctrl/Cmd+B.
// Estos tests fijan esas dos ediciones: si alguien vuelve a copiar el archivo con
// la CLI y las pierde, fallan.

function clearCookies() {
  for (const cookie of document.cookie.split("; ")) {
    const [name] = cookie.split("=");
    if (name) document.cookie = `${name}=; max-age=0; path=/`;
  }
}

function renderSidebar() {
  render(
    <SidebarProvider>
      <Sidebar>
        <p>Contenido del menú</p>
      </Sidebar>
      <SidebarTrigger />
    </SidebarProvider>,
  );
  return document.querySelector<HTMLElement>("[data-slot=sidebar]");
}

beforeEach(() => {
  clearCookies();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearCookies();
});

describe("sidebar.tsx (copia editada de shadcn)", () => {
  it("al alternar el menú no escribe ninguna cookie", async () => {
    const sidebar = renderSidebar();
    expect(sidebar).toHaveAttribute("data-state", "expanded");

    const user = userEvent.setup();
    const trigger = document.querySelector<HTMLElement>(
      "[data-slot=sidebar-trigger]",
    );
    expect(trigger).not.toBeNull();
    await user.click(trigger!);
    expect(sidebar).toHaveAttribute("data-state", "collapsed");
    await user.click(trigger!);
    expect(sidebar).toHaveAttribute("data-state", "expanded");

    expect(document.cookie).toBe("");
  });

  it("no intercepta el teclado con un atajo global: Ctrl+B y Cmd+B no cambian nada", () => {
    const sidebar = renderSidebar();

    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const event = new KeyboardEvent("keydown", {
        key: "b",
        cancelable: true,
        bubbles: true,
        ...modifier,
      });
      act(() => {
        window.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
    }

    expect(sidebar).toHaveAttribute("data-state", "expanded");
  });

  it("no registra ningún oyente global de teclado al montarse", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");

    renderSidebar();

    const events = addEventListener.mock.calls.map(([type]) => type);
    expect(events).not.toContain("keydown");
    expect(events).not.toContain("keyup");
  });

  it("sus textos visibles están en castellano", () => {
    renderSidebar();

    expect(screen.queryByText("Toggle Sidebar")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mostrar u ocultar el menú" }),
    ).toBeInTheDocument();
  });
});
