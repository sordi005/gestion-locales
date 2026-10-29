import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeSalePrice } from "../../actions";
import { ORG_ID, PRODUCT_ID } from "../../__tests__/fixtures";
import { catalogError, priceChangedMessage } from "../../domain/errors";
import { err, ok } from "@/shared/lib/result";

import { PriceChangePanel } from "../price-change-panel";

// Spec catalog-price-editing "Margen y aviso por debajo del costo" y "Cambio de
// precio individual": el panel muestra el costo y su base, el margen en vivo, el
// aviso sin bloquear, y trata CA-E08 mostrando el precio actual y actualizando
// el precio esperado. Montos en centavos: $ 1.000,00 = 100000.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../actions", () => ({ changeSalePrice: vi.fn() }));

const plain = (text: string) => text.replace(/ /g, " ");

type PanelOverrides = {
  priceCents?: number | null;
  costCents?: number | null;
  unit?: "unit" | "kg";
  writable?: boolean;
};

function renderPanel(over: PanelOverrides = {}) {
  return render(
    <PriceChangePanel
      orgId={ORG_ID}
      productId={PRODUCT_ID}
      unit={over.unit ?? "unit"}
      priceCents={over.priceCents === undefined ? 100000 : over.priceCents}
      costCents={over.costCents === undefined ? 80000 : over.costCents}
      costBasis="Costo de referencia (importado)"
      writable={over.writable ?? true}
    />,
  );
}

const apply = () =>
  screen.getByRole("button", {
    name: /^Cambiar precio|^Poner precio|^Guardando/,
  });

beforeEach(() => {
  vi.mocked(changeSalePrice).mockReset();
  router.refresh.mockReset();
});

describe("PriceChangePanel", () => {
  it("muestra el precio actual, el costo con su base y el margen", () => {
    renderPanel();

    expect(screen.getByText("Precio actual")).toBeVisible();
    expect(screen.getByText(plain("$ 1.000,00"))).toBeVisible();
    expect(
      screen.getByText(plain("Costo de referencia (importado): $ 800,00")),
    ).toBeVisible();
    expect(screen.getByText("Margen: 20,0 %")).toBeVisible();
    expect(screen.getByLabelText("Nuevo precio")).toHaveValue("1.000,00");
  });

  it("un producto por peso muestra el precio con '/ kg'", () => {
    renderPanel({ unit: "kg" });

    expect(screen.getByText(plain("$ 1.000,00 / kg"))).toBeVisible();
  });

  it("sin precio muestra 'Sin precio', el campo vacío y ofrece 'Poner precio'", () => {
    renderPanel({ priceCents: null });

    expect(screen.getByText("Sin precio")).toBeVisible();
    expect(screen.getByLabelText("Nuevo precio")).toHaveValue("");
    expect(apply()).toHaveTextContent("Poner precio");
  });

  it("sin costo dice que no se puede calcular el margen", () => {
    renderPanel({ costCents: null });

    expect(
      screen.getByText("Sin costo: no se puede calcular el margen"),
    ).toBeVisible();
  });

  it("mientras se escribe, recalcula el margen y avisa por debajo del costo sin bloquear", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.clear(screen.getByLabelText("Nuevo precio"));
    await user.type(screen.getByLabelText("Nuevo precio"), "750");

    expect(screen.getByText("Margen: -6,7 %")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      /El precio queda por debajo del costo/,
    );
    expect(apply()).toBeEnabled();
  });

  it("cambia el precio con el precio que se vio como esperado y refresca la ficha", async () => {
    const user = userEvent.setup();
    vi.mocked(changeSalePrice).mockResolvedValue(
      ok({ productId: PRODUCT_ID, salePriceCents: 115000, changed: true }),
    );
    renderPanel();

    await user.clear(screen.getByLabelText("Nuevo precio"));
    await user.type(screen.getByLabelText("Nuevo precio"), "1150");
    await user.click(apply());

    expect(await screen.findByText("Precio actualizado.")).toBeVisible();
    expect(changeSalePrice).toHaveBeenCalledWith(ORG_ID, {
      productId: PRODUCT_ID,
      newPriceCents: 115000,
      expectedPriceCents: 100000,
    });
    expect(router.refresh).toHaveBeenCalled();
    // El precio visto pasa a ser el nuevo: un segundo cambio ya parte de ahí.
    expect(screen.getByText(plain("$ 1.150,00"))).toBeVisible();
  });

  it("el primer precio de un producto sin precio va con expectedPriceCents null", async () => {
    const user = userEvent.setup();
    vi.mocked(changeSalePrice).mockResolvedValue(
      ok({ productId: PRODUCT_ID, salePriceCents: 90000, changed: true }),
    );
    renderPanel({ priceCents: null });

    await user.type(screen.getByLabelText("Nuevo precio"), "900");
    await user.click(apply());

    await waitFor(() => expect(changeSalePrice).toHaveBeenCalledTimes(1));
    expect(changeSalePrice).toHaveBeenCalledWith(ORG_ID, {
      productId: PRODUCT_ID,
      newPriceCents: 90000,
      expectedPriceCents: null,
    });
    await waitFor(() =>
      expect(screen.queryByText("Sin precio")).not.toBeInTheDocument(),
    );
  });

  it("si el precio ya era ese, lo dice", async () => {
    const user = userEvent.setup();
    vi.mocked(changeSalePrice).mockResolvedValue(
      ok({ productId: PRODUCT_ID, salePriceCents: 100000, changed: false }),
    );
    renderPanel();

    await user.click(apply());

    expect(await screen.findByText("El precio ya era ese.")).toBeVisible();
  });

  describe("CA-E08 (cambio concurrente)", () => {
    it("muestra el precio actual, lo toma como el esperado y el siguiente intento lo manda", async () => {
      const user = userEvent.setup();
      vi.mocked(changeSalePrice)
        .mockResolvedValueOnce(
          err(
            catalogError("CA-E08", {
              message: priceChangedMessage(110000),
              details: { currentPriceCents: 110000 },
            }),
          ),
        )
        .mockResolvedValueOnce(
          ok({ productId: PRODUCT_ID, salePriceCents: 120000, changed: true }),
        );
      renderPanel();

      await user.clear(screen.getByLabelText("Nuevo precio"));
      await user.type(screen.getByLabelText("Nuevo precio"), "1200");
      await user.click(apply());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        plain("El precio cambió mientras lo editabas: ahora es $ 1.100,00."),
      );
      // El precio mostrado es el nuevo, y lo escrito se conserva.
      expect(screen.getByText(plain("$ 1.100,00"))).toBeVisible();
      expect(screen.getByLabelText("Nuevo precio")).toHaveValue("1.200,00");
      // La ficha se vuelve a leer: el resto de la pantalla no queda con el precio viejo.
      expect(router.refresh).toHaveBeenCalledTimes(1);

      await waitFor(() => expect(apply()).toBeEnabled());
      await user.click(apply());

      await waitFor(() => expect(changeSalePrice).toHaveBeenCalledTimes(2));
      expect(changeSalePrice).toHaveBeenLastCalledWith(ORG_ID, {
        productId: PRODUCT_ID,
        newPriceCents: 120000,
        expectedPriceCents: 110000,
      });
      expect(await screen.findByText("Precio actualizado.")).toBeVisible();
    });

    it("si ahora el producto no tiene precio, el esperado pasa a null", async () => {
      const user = userEvent.setup();
      vi.mocked(changeSalePrice).mockResolvedValueOnce(
        err(
          catalogError("CA-E08", {
            message: priceChangedMessage(null),
            details: { currentPriceCents: null },
          }),
        ),
      );
      renderPanel();

      await user.clear(screen.getByLabelText("Nuevo precio"));
      await user.type(screen.getByLabelText("Nuevo precio"), "1200");
      await user.click(apply());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "ahora el producto no tiene precio",
      );
      expect(screen.getByText("Sin precio")).toBeVisible();
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("otros errores", () => {
    it("CA-E07: un precio vacío en un producto con precio muestra el mensaje en el campo", async () => {
      const user = userEvent.setup();
      vi.mocked(changeSalePrice).mockResolvedValue(err(catalogError("CA-E07")));
      renderPanel();

      await user.clear(screen.getByLabelText("Nuevo precio"));
      await user.click(apply());

      const field = screen.getByLabelText("Nuevo precio");
      await waitFor(() =>
        expect(field).toHaveAttribute("aria-invalid", "true"),
      );
      expect(field).toHaveAccessibleDescription(/no puede quedar sin precio/);
      // Un error del propio campo no cambia nada de la ficha: no se relee.
      expect(router.refresh).not.toHaveBeenCalled();
      expect(changeSalePrice).toHaveBeenCalledWith(ORG_ID, {
        productId: PRODUCT_ID,
        newPriceCents: null,
        expectedPriceCents: 100000,
      });
    });

    it.each([
      ["abc", "Escribí un monto, por ejemplo 1.250,50"],
      ["0,999", "Usá hasta 2 decimales"],
      ["-5", "El monto no puede ser negativo"],
    ])(
      "un texto que no es un monto (%j) no se manda: se marca el campo con su motivo, no con CA-E07",
      async (typed, message) => {
        const user = userEvent.setup();
        renderPanel();

        await user.clear(screen.getByLabelText("Nuevo precio"));
        await user.type(screen.getByLabelText("Nuevo precio"), typed);
        await user.click(apply());

        const field = screen.getByLabelText("Nuevo precio");
        expect(changeSalePrice).not.toHaveBeenCalled();
        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(field).toHaveAccessibleDescription(message);
        expect(screen.queryByText(/no puede quedar sin precio/)).toBeNull();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(apply()).toBeEnabled();
      },
    );

    it("al corregir el texto inválido se manda el precio nuevo", async () => {
      const user = userEvent.setup();
      vi.mocked(changeSalePrice).mockResolvedValue(
        ok({ productId: PRODUCT_ID, salePriceCents: 115000, changed: true }),
      );
      renderPanel();
      await user.clear(screen.getByLabelText("Nuevo precio"));
      await user.type(screen.getByLabelText("Nuevo precio"), "abc");
      await user.click(apply());

      await user.clear(screen.getByLabelText("Nuevo precio"));
      await user.type(screen.getByLabelText("Nuevo precio"), "1150");
      await user.click(apply());

      await waitFor(() => expect(changeSalePrice).toHaveBeenCalledTimes(1));
      expect(changeSalePrice).toHaveBeenCalledWith(ORG_ID, {
        productId: PRODUCT_ID,
        newPriceCents: 115000,
        expectedPriceCents: 100000,
      });
    });

    it.each([
      ["CA-E04", "No tenés permiso para hacer esto."],
      ["CA-E06", "El producto no existe o ya no está disponible."],
    ] as const)(
      "%s: muestra el mensaje del servidor",
      async (code, message) => {
        const user = userEvent.setup();
        vi.mocked(changeSalePrice).mockResolvedValue(err(catalogError(code)));
        renderPanel();

        await user.click(apply());

        expect(await screen.findByRole("alert")).toHaveTextContent(message);
      },
    );
  });

  it("con la organización suspendida el campo y el botón quedan deshabilitados", () => {
    renderPanel({ writable: false });

    expect(screen.getByLabelText("Nuevo precio")).toBeDisabled();
    expect(apply()).toBeDisabled();
    expect(screen.getByText(plain("$ 1.000,00"))).toBeVisible();
  });
});
