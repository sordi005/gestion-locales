import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deactivateProduct, reactivateProduct } from "../../actions";
import { ORG_ID, PRODUCT_ID } from "../../__tests__/fixtures";
import { catalogError } from "../../domain/errors";
import { err, ok } from "@/shared/lib/result";

import { ProductStatusControl } from "../product-status-control";

// Spec catalog-management "Desactivar y reactivar en lugar de borrar": desactivar
// pide confirmación y, si tiene botón de venta rápida, avisa que se quita;
// reactivar vuelve a activo (sin botón). No hay ninguna acción de borrar.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../actions", () => ({
  deactivateProduct: vi.fn(),
  reactivateProduct: vi.fn(),
}));

type Over = {
  status?: "active" | "inactive";
  quickSale?: string | null;
  writable?: boolean;
};

function renderControl(over: Over = {}) {
  return render(
    <ProductStatusControl
      orgId={ORG_ID}
      productId={PRODUCT_ID}
      productName="Alfajor triple"
      status={over.status ?? "active"}
      quickSaleButton={over.quickSale === undefined ? null : over.quickSale}
      writable={over.writable ?? true}
    />,
  );
}

beforeEach(() => {
  vi.mocked(deactivateProduct).mockReset();
  vi.mocked(reactivateProduct).mockReset();
  router.refresh.mockReset();
});

describe("ProductStatusControl (producto activo)", () => {
  it("pide confirmación antes de desactivar, sin llamar a la acción todavía", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(
      screen.getByRole("button", { name: "Desactivar producto" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "¿Desactivar «Alfajor triple»?",
    });
    expect(
      within(dialog).getByText(/deja de aparecer en el listado/),
    ).toBeVisible();
    expect(deactivateProduct).not.toHaveBeenCalled();
  });

  it("sin botón de venta rápida no avisa nada del botón", async () => {
    const user = userEvent.setup();
    renderControl({ quickSale: null });

    await user.click(
      screen.getByRole("button", { name: "Desactivar producto" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/venta rápida/)).not.toBeInTheDocument();
  });

  it("con botón de venta rápida avisa que se quita, nombrando el botón", async () => {
    const user = userEvent.setup();
    renderControl({ quickSale: "Botón 3: Alfajor" });

    await user.click(
      screen.getByRole("button", { name: "Desactivar producto" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Tiene el botón de venta rápida «Botón 3: Alfajor»: se va a quitar.",
      ),
    ).toBeVisible();
  });

  it("al confirmar llama a la acción, cierra y refresca la ficha", async () => {
    const user = userEvent.setup();
    vi.mocked(deactivateProduct).mockResolvedValue(
      ok({ productId: PRODUCT_ID, status: "inactive" }),
    );
    renderControl();

    await user.click(
      screen.getByRole("button", { name: "Desactivar producto" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Desactivar" }),
    );

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(deactivateProduct).toHaveBeenCalledWith(ORG_ID, {
      productId: PRODUCT_ID,
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("cancelar cierra el diálogo y no llama a la acción", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(
      screen.getByRole("button", { name: "Desactivar producto" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(deactivateProduct).not.toHaveBeenCalled();
  });

  it("si la acción falla, deja el diálogo abierto con el mensaje", async () => {
    const user = userEvent.setup();
    vi.mocked(deactivateProduct).mockResolvedValue(err(catalogError("CA-E06")));
    renderControl();

    await user.click(
      screen.getByRole("button", { name: "Desactivar producto" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Desactivar" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "El producto no existe o ya no está disponible.",
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("ProductStatusControl (producto inactivo)", () => {
  it("ofrece reactivar, aclara que el botón no vuelve, y llama a la acción", async () => {
    const user = userEvent.setup();
    vi.mocked(reactivateProduct).mockResolvedValue(
      ok({ productId: PRODUCT_ID, status: "active" }),
    );
    renderControl({ status: "inactive" });

    expect(
      screen.queryByRole("button", { name: "Desactivar producto" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/sin botón de venta rápida/)).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Reactivar producto" }),
    );

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(reactivateProduct).toHaveBeenCalledWith(ORG_ID, {
      productId: PRODUCT_ID,
    });
  });

  it("si reactivar falla muestra el mensaje", async () => {
    const user = userEvent.setup();
    vi.mocked(reactivateProduct).mockResolvedValue(err(catalogError("CA-E04")));
    renderControl({ status: "inactive" });

    await user.click(
      screen.getByRole("button", { name: "Reactivar producto" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permiso para hacer esto.",
    );
  });
});

describe("ProductStatusControl (organización suspendida)", () => {
  it.each(["active", "inactive"] as const)(
    "con un producto %s los botones quedan deshabilitados",
    (status) => {
      renderControl({ status, writable: false });

      expect(screen.getByRole("button")).toBeDisabled();
    },
  );
});
