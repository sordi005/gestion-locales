import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addBarcode, correctBarcode } from "../../actions";
import { BARCODE_ID, ORG_ID, PRODUCT_ID } from "../../__tests__/fixtures";
import { barcodeTakenMessage, catalogError, invalidBarcodeError } from "../..";
import { barcodeWarningMessage } from "../../domain/barcode-messages";
import { err, ok } from "@/shared/lib/result";

import { BarcodeList } from "../barcode-list";

// Spec catalog-management "Códigos de barras: agregar y corregir": la ficha lista
// los códigos, deja agregar y corregir (sin quitar ni mover), avisa sin bloquear
// el dígito verificador y muestra CA-E02 / CA-E09 con su motivo.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../actions", () => ({
  addBarcode: vi.fn(),
  correctBarcode: vi.fn(),
}));

const SECOND_ID = "00000000-0000-4000-8000-00000000d002";
const EAN13 = "7790895000782";
const EAN8 = "77908950";

const BARCODES = [
  { id: BARCODE_ID, norm: EAN13, raw: EAN13, isPrimary: true },
  { id: SECOND_ID, norm: EAN8, raw: EAN8, isPrimary: false },
];

function renderList(
  over: { writable?: boolean; barcodes?: typeof BARCODES } = {},
) {
  return render(
    <BarcodeList
      orgId={ORG_ID}
      productId={PRODUCT_ID}
      barcodes={over.barcodes ?? BARCODES}
      writable={over.writable ?? true}
    />,
  );
}

function savedBarcode(id: string, norm: string) {
  return { id, norm, raw: norm, isPrimary: false, productId: PRODUCT_ID };
}

beforeEach(() => {
  vi.mocked(addBarcode).mockReset();
  vi.mocked(correctBarcode).mockReset();
  router.refresh.mockReset();
});

describe("BarcodeList", () => {
  it("lista los códigos y marca el principal con texto", () => {
    renderList();

    const items = within(
      screen.getByRole("list", { name: "Códigos de barras" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText(EAN13)).toBeVisible();
    expect(within(items[0]!).getByText("Principal")).toBeVisible();
    expect(within(items[1]!).getByText(EAN8)).toBeVisible();
    expect(within(items[1]!).queryByText("Principal")).not.toBeInTheDocument();
  });

  it("sin códigos lo dice", () => {
    renderList({ barcodes: [] });

    expect(
      screen.getByText("Este producto no tiene códigos de barras."),
    ).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  describe("agregar", () => {
    it("manda el texto escrito tal cual, avisa que se agregó y refresca la ficha", async () => {
      const user = userEvent.setup();
      vi.mocked(addBarcode).mockResolvedValue(
        ok({ barcode: savedBarcode(SECOND_ID, "12345670"), warnings: [] }),
      );
      renderList();

      await user.type(screen.getByLabelText("Nuevo código"), " 1234 5670 ");
      await user.click(screen.getByRole("button", { name: "Agregar código" }));

      expect(await screen.findByText("Código agregado.")).toBeVisible();
      expect(addBarcode).toHaveBeenCalledWith(ORG_ID, {
        productId: PRODUCT_ID,
        raw: " 1234 5670 ",
      });
      expect(router.refresh).toHaveBeenCalled();
      expect(screen.getByLabelText("Nuevo código")).toHaveValue("");
    });

    it("con dígito verificador dudoso lo guarda y avisa sin bloquear", async () => {
      const user = userEvent.setup();
      const warning = barcodeWarningMessage(
        "invalid_check_digit",
        "7790895000783",
      );
      vi.mocked(addBarcode).mockResolvedValue(
        ok({
          barcode: savedBarcode(SECOND_ID, "7790895000783"),
          warnings: [
            {
              code: "invalid_check_digit",
              message: warning,
              barcode: "7790895000783",
            },
          ],
        }),
      );
      renderList();

      await user.type(screen.getByLabelText("Nuevo código"), "7790895000783");
      await user.click(screen.getByRole("button", { name: "Agregar código" }));

      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent(warning);
      expect(status).toHaveTextContent("El código 7790895000783:");
      expect(status).toHaveTextContent("Código agregado.");
      expect(router.refresh).toHaveBeenCalled();
    });

    it("CA-E09: muestra el motivo en el campo y no refresca", async () => {
      const user = userEvent.setup();
      vi.mocked(addBarcode).mockResolvedValue(
        err(invalidBarcodeError("scientific_notation")),
      );
      renderList();

      await user.type(screen.getByLabelText("Nuevo código"), "7.79E+12");
      await user.click(screen.getByRole("button", { name: "Agregar código" }));

      const field = screen.getByLabelText("Nuevo código");
      await waitFor(() =>
        expect(field).toHaveAttribute("aria-invalid", "true"),
      );
      expect(field).toHaveAccessibleDescription(/perdió dígitos/);
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it("CA-E02: muestra el producto que ya tiene el código", async () => {
      const user = userEvent.setup();
      const message = barcodeTakenMessage("12345670", "Chicle");
      vi.mocked(addBarcode).mockResolvedValue(
        err(catalogError("CA-E02", { message })),
      );
      renderList();

      await user.type(screen.getByLabelText("Nuevo código"), "12345670");
      await user.click(screen.getByRole("button", { name: "Agregar código" }));

      await waitFor(() =>
        expect(
          screen.getByLabelText("Nuevo código"),
        ).toHaveAccessibleDescription(message),
      );
    });

    it("mientras guarda deshabilita el botón", async () => {
      const user = userEvent.setup();
      let finish: (
        value: Awaited<ReturnType<typeof addBarcode>>,
      ) => void = () => {};
      vi.mocked(addBarcode).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      renderList();

      await user.type(screen.getByLabelText("Nuevo código"), "12345670");
      await user.click(screen.getByRole("button", { name: "Agregar código" }));

      expect(
        await screen.findByRole("button", { name: "Agregando…" }),
      ).toBeDisabled();
      finish(
        ok({ barcode: savedBarcode(SECOND_ID, "12345670"), warnings: [] }),
      );
      await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    });
  });

  describe("corregir", () => {
    it("abre el campo con el código actual, manda la corrección y refresca", async () => {
      const user = userEvent.setup();
      vi.mocked(correctBarcode).mockResolvedValue(
        ok({ barcode: savedBarcode(SECOND_ID, "12345670"), warnings: [] }),
      );
      renderList();

      await user.click(
        screen.getByRole("button", { name: `Corregir el código ${EAN8}` }),
      );
      const field = screen.getByLabelText(`Código corregido de ${EAN8}`);
      expect(field).toHaveValue(EAN8);
      await user.clear(field);
      await user.type(field, "12345670");
      await user.click(
        screen.getByRole("button", { name: "Guardar corrección" }),
      );

      expect(await screen.findByText("Código corregido.")).toBeVisible();
      expect(correctBarcode).toHaveBeenCalledWith(ORG_ID, {
        barcodeId: SECOND_ID,
        raw: "12345670",
      });
      expect(router.refresh).toHaveBeenCalled();
      expect(
        screen.queryByLabelText(`Código corregido de ${EAN8}`),
      ).not.toBeInTheDocument();
    });

    it("cancelar cierra el campo sin llamar a la acción", async () => {
      const user = userEvent.setup();
      renderList();

      await user.click(
        screen.getByRole("button", { name: `Corregir el código ${EAN8}` }),
      );
      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(
        screen.queryByLabelText(`Código corregido de ${EAN8}`),
      ).not.toBeInTheDocument();
      expect(correctBarcode).not.toHaveBeenCalled();
    });

    it("un error de la corrección queda en su campo y el campo sigue abierto", async () => {
      const user = userEvent.setup();
      vi.mocked(correctBarcode).mockResolvedValue(
        err(invalidBarcodeError("invalid_characters")),
      );
      renderList();

      await user.click(
        screen.getByRole("button", { name: `Corregir el código ${EAN13}` }),
      );
      const field = screen.getByLabelText(`Código corregido de ${EAN13}`);
      await user.clear(field);
      await user.type(field, "abc");
      await user.click(
        screen.getByRole("button", { name: "Guardar corrección" }),
      );

      await waitFor(() =>
        expect(field).toHaveAttribute("aria-invalid", "true"),
      );
      expect(field).toHaveAccessibleDescription(/solo puede tener números/);
      expect(router.refresh).not.toHaveBeenCalled();
    });
  });

  it("con la organización suspendida no hay controles de escritura", () => {
    renderList({ writable: false });

    expect(screen.queryByLabelText("Nuevo código")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Corregir el código/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(EAN13)).toBeVisible();
  });
});
