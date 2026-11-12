import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  approveSharedProduct,
  rejectSharedProduct,
  retireSharedProduct,
  updateSharedProduct,
} from "../actions";
import { ProductDialog } from "../components/product-dialog";
import { ReasonDialog } from "../components/reason-dialog";

// Spec shared-product-review "Pantalla de revisión": un diálogo para aprobar con
// nombre, marca y presentación editables; otro para rechazar con motivo; corregir,
// retirar y reactivar desde la búsqueda. Las acciones están simuladas.

vi.mock("../actions", () => ({
  approveSharedProduct: vi.fn(),
  rejectSharedProduct: vi.fn(),
  retireSharedProduct: vi.fn(),
  updateSharedProduct: vi.fn(),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const CODE = "7791234567898";
const OK = { ok: true, value: null } as const;

beforeEach(() => {
  vi.mocked(approveSharedProduct).mockReset().mockResolvedValue(OK);
  vi.mocked(updateSharedProduct).mockReset().mockResolvedValue(OK);
  vi.mocked(rejectSharedProduct).mockReset().mockResolvedValue(OK);
  vi.mocked(retireSharedProduct).mockReset().mockResolvedValue(OK);
  refresh.mockReset();
});

describe("ProductDialog (aprobar)", () => {
  function renderApprove() {
    return render(
      <ProductDialog
        mode="approve"
        barcode={CODE}
        initialName="Alfajor Triple"
        initialBrand="Marca Demo"
        initialPresentation=""
        proposedNames={["Alfajor Triple", "Alfajor Triple 70 g"]}
      />,
    );
  }

  it("abre con el nombre y la marca propuestos y deja editarlos", async () => {
    const user = userEvent.setup();
    renderApprove();

    await user.click(screen.getByRole("button", { name: "Aprobar" }));

    const dialog = screen.getByRole("dialog", { name: /Aprobar el código/ });
    expect(dialog).toHaveTextContent(CODE);
    expect(screen.getByLabelText("Nombre")).toHaveValue("Alfajor Triple");
    expect(screen.getByLabelText("Marca")).toHaveValue("Marca Demo");
    expect(screen.getByLabelText("Presentación")).toHaveValue("");
  });

  it("al guardar manda lo editado a la acción de aprobar, cierra y refresca", async () => {
    const user = userEvent.setup();
    renderApprove();
    await user.click(screen.getByRole("button", { name: "Aprobar" }));

    const name = screen.getByLabelText("Nombre");
    await user.clear(name);
    await user.type(name, "Alfajor Triple 70 g");
    await user.type(screen.getByLabelText("Presentación"), "70 g");
    await user.click(
      screen.getByRole("button", { name: "Aprobar y publicar" }),
    );

    await waitFor(() =>
      expect(approveSharedProduct).toHaveBeenCalledWith({
        barcode: CODE,
        name: "Alfajor Triple 70 g",
        brand: "Marca Demo",
        presentation: "70 g",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalled();
    expect(updateSharedProduct).not.toHaveBeenCalled();
  });

  it("los nombres propuestos se pueden elegir con un botón", async () => {
    const user = userEvent.setup();
    renderApprove();
    await user.click(screen.getByRole("button", { name: "Aprobar" }));

    await user.click(
      screen.getByRole("button", { name: "Usar: Alfajor Triple 70 g" }),
    );

    expect(screen.getByLabelText("Nombre")).toHaveValue("Alfajor Triple 70 g");
  });

  it("un error por campo (SP-A01) se muestra bajo el campo y el diálogo sigue abierto", async () => {
    vi.mocked(approveSharedProduct).mockResolvedValue({
      ok: false,
      error: {
        code: "SP-A01",
        message: "Revisá los datos marcados.",
        fieldErrors: { name: "Escribí el nombre." },
      },
    });
    const user = userEvent.setup();
    renderApprove();
    await user.click(screen.getByRole("button", { name: "Aprobar" }));
    await user.clear(screen.getByLabelText("Nombre"));

    await user.click(
      screen.getByRole("button", { name: "Aprobar y publicar" }),
    );

    expect(await screen.findByText("Escribí el nombre.")).toBeVisible();
    expect(screen.getByLabelText("Nombre")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("un error general (SP-A02) se muestra en una alerta en español", async () => {
    vi.mocked(approveSharedProduct).mockResolvedValue({
      ok: false,
      error: { code: "SP-A02", message: "Ese código no se puede cargar." },
    });
    const user = userEvent.setup();
    renderApprove();
    await user.click(screen.getByRole("button", { name: "Aprobar" }));

    await user.click(
      screen.getByRole("button", { name: "Aprobar y publicar" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ese código no se puede cargar.",
    );
  });
});

describe("ProductDialog (corregir y reactivar)", () => {
  it("corregir llama a la acción de actualizar, no a la de aprobar", async () => {
    const user = userEvent.setup();
    render(
      <ProductDialog
        mode="update"
        barcode={CODE}
        initialName="Alfajor"
        initialBrand=""
        initialPresentation="70 g"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Corregir" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(updateSharedProduct).toHaveBeenCalledWith({
        barcode: CODE,
        name: "Alfajor",
        brand: "",
        presentation: "70 g",
      }),
    );
    expect(approveSharedProduct).not.toHaveBeenCalled();
  });

  it("reactivar es aprobar de nuevo: usa la acción de aprobar", async () => {
    const user = userEvent.setup();
    render(
      <ProductDialog
        mode="reactivate"
        barcode={CODE}
        initialName="Alfajor"
        initialBrand=""
        initialPresentation=""
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reactivar" }));
    expect(
      screen.getByRole("dialog", { name: /Reactivar el código/ }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Reactivar y publicar" }),
    );

    await waitFor(() => expect(approveSharedProduct).toHaveBeenCalledTimes(1));
    expect(updateSharedProduct).not.toHaveBeenCalled();
  });
});

describe("ReasonDialog", () => {
  it("rechazar manda el motivo a la acción de rechazar", async () => {
    const user = userEvent.setup();
    render(<ReasonDialog mode="reject" barcode={CODE} />);

    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    await user.type(screen.getByLabelText("Motivo"), "Nombre ofensivo");
    await user.click(
      screen.getByRole("button", { name: "Rechazar el código" }),
    );

    await waitFor(() =>
      expect(rejectSharedProduct).toHaveBeenCalledWith({
        barcode: CODE,
        reason: "Nombre ofensivo",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalled();
    expect(retireSharedProduct).not.toHaveBeenCalled();
  });

  it("retirar manda el motivo a la acción de retirar", async () => {
    const user = userEvent.setup();
    render(<ReasonDialog mode="retire" barcode={CODE} />);

    await user.click(screen.getByRole("button", { name: "Retirar" }));
    await user.type(screen.getByLabelText("Motivo"), "Mal cargado");
    await user.click(
      screen.getByRole("button", { name: "Retirar de la base" }),
    );

    await waitFor(() =>
      expect(retireSharedProduct).toHaveBeenCalledWith({
        barcode: CODE,
        reason: "Mal cargado",
      }),
    );
    expect(rejectSharedProduct).not.toHaveBeenCalled();
  });

  it("sin motivo muestra el error del campo que devuelve la acción", async () => {
    vi.mocked(rejectSharedProduct).mockResolvedValue({
      ok: false,
      error: {
        code: "SP-A01",
        message: "Revisá los datos marcados.",
        fieldErrors: { reason: "Escribí el motivo (hasta 500 caracteres)." },
      },
    });
    const user = userEvent.setup();
    render(<ReasonDialog mode="reject" barcode={CODE} />);
    await user.click(screen.getByRole("button", { name: "Rechazar" }));

    await user.click(
      screen.getByRole("button", { name: "Rechazar el código" }),
    );

    expect(
      await screen.findByText("Escribí el motivo (hasta 500 caracteres)."),
    ).toBeVisible();
    expect(screen.getByLabelText("Motivo")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
