import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LogoutCleanups } from "@/app/logout-cleanups";
import { runLogoutCleanups } from "@/features/auth/logout-cleanup";
import { clearCatalogCache } from "@/features/catalog/logout-cleanup";

// Spec auth-session "Cerrar sesión...": el punto único de registro de las tareas
// de limpieza vive en la capa `app` y se monta en todas las páginas. C-11 registra
// ahí la limpieza de la caché del catálogo (`catalog-cache`); C-19 sumará el carrito.

vi.mock("@/features/catalog/logout-cleanup", () => ({
  clearCatalogCache: vi.fn(async () => {}),
}));

describe("LogoutCleanups", () => {
  it("no dibuja nada: solo existe para cargar el registro de tareas en toda página", () => {
    const { container } = render(<LogoutCleanups />);

    expect(container).toBeEmptyDOMElement();
  });

  it("registra la limpieza de la caché del catálogo: cerrar sesión la corre", async () => {
    vi.mocked(clearCatalogCache).mockClear();

    await runLogoutCleanups();

    expect(clearCatalogCache).toHaveBeenCalledTimes(1);
  });

  it("si la limpieza de la caché falla, no frena el cierre de sesión", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(clearCatalogCache).mockRejectedValueOnce(
      new Error("sin IndexedDB"),
    );

    await expect(runLogoutCleanups()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("catalog-cache"),
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});
