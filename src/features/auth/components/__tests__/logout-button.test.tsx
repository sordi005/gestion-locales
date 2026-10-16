import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logout } from "../../actions";
import { runLogoutCleanups } from "../../logout-cleanup";
import { LogoutButton } from "../logout-button";

// Spec auth-session "Cerrar sesión en el dispositivo actual con limpieza local":
// primero la limpieza de datos locales y después la Server Action.

vi.mock("../../actions", () => ({ logout: vi.fn() }));
vi.mock("../../logout-cleanup", () => ({ runLogoutCleanups: vi.fn() }));

/** Promesa que se resuelve desde afuera, para controlar cuándo termina cada paso. */
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(logout).mockReset();
  vi.mocked(runLogoutCleanups).mockReset();
});

describe("LogoutButton", () => {
  it("muestra el botón Cerrar sesión", () => {
    render(<LogoutButton />);

    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });

  it("corre la limpieza local y recién cuando termina llama a la acción de cerrar sesión", async () => {
    const calls: string[] = [];
    const cleanup = deferred();
    vi.mocked(runLogoutCleanups).mockImplementation(async () => {
      calls.push("limpieza: empieza");
      await cleanup.promise;
      calls.push("limpieza: termina");
    });
    vi.mocked(logout).mockImplementation(async () => {
      calls.push("logout");
      return undefined as never;
    });
    render(<LogoutButton />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(calls).toEqual(["limpieza: empieza"]));
    expect(logout).not.toHaveBeenCalled();

    cleanup.resolve();

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["limpieza: empieza", "limpieza: termina", "logout"]);
    expect(runLogoutCleanups).toHaveBeenCalledTimes(1);
  });

  it("deshabilita el botón mientras cierra la sesión, para no enviarlo dos veces", async () => {
    const cleanup = deferred();
    vi.mocked(runLogoutCleanups).mockReturnValue(cleanup.promise);
    vi.mocked(logout).mockResolvedValue(undefined as never);
    render(<LogoutButton />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Cerrar sesión" }),
      ).toBeDisabled(),
    );
    cleanup.resolve();
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });
});
