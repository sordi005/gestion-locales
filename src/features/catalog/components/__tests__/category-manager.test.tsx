import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCategory, renameCategory } from "../../actions";
import { CATEGORY_ID, ORG_ID } from "../../__tests__/fixtures";
import { catalogError } from "../../domain/errors";
import { err, ok } from "@/shared/lib/result";

import { CategoryManager } from "../category-manager";

// Spec catalog-management "Categorías: alta y cambio de nombre": lista con la
// cantidad de productos activos, alta y cambio de nombre para dueño y encargado,
// `CA-E03` cuando el nombre ya existe.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../actions", () => ({
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
}));

const BEBIDAS_ID = "00000000-0000-4000-8000-00000000e002";
const VACIA_ID = "00000000-0000-4000-8000-00000000e003";

const CATEGORIES = [
  { id: BEBIDAS_ID, name: "Bebidas", activeProductCount: 5 },
  { id: CATEGORY_ID, name: "Golosinas", activeProductCount: 1 },
  { id: VACIA_ID, name: "Limpieza", activeProductCount: 0 },
];

function renderManager(
  over: { writable?: boolean; categories?: typeof CATEGORIES } = {},
) {
  return render(
    <CategoryManager
      orgId={ORG_ID}
      categories={over.categories ?? CATEGORIES}
      writable={over.writable ?? true}
    />,
  );
}

beforeEach(() => {
  vi.mocked(createCategory).mockReset();
  vi.mocked(renameCategory).mockReset();
  router.refresh.mockReset();
});

describe("CategoryManager", () => {
  it("lista cada categoría con la cantidad de productos activos", () => {
    renderManager();

    const items = within(
      screen.getByRole("list", { name: "Categorías" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Bebidas");
    expect(items[0]).toHaveTextContent("5 productos activos");
    expect(items[1]).toHaveTextContent("1 producto activo");
    expect(items[2]).toHaveTextContent("0 productos activos");
  });

  it("sin categorías lo dice", () => {
    renderManager({ categories: [] });

    expect(screen.getByText("Todavía no hay categorías.")).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  describe("crear", () => {
    it("manda el nombre, avisa y refresca la lista", async () => {
      const user = userEvent.setup();
      vi.mocked(createCategory).mockResolvedValue(
        ok({ category: { id: "n1", name: "Lácteos" } }),
      );
      renderManager();

      await user.type(
        screen.getByLabelText("Nombre de la categoría nueva"),
        "Lácteos",
      );
      await user.click(screen.getByRole("button", { name: "Crear categoría" }));

      expect(await screen.findByText("Categoría creada.")).toBeVisible();
      expect(createCategory).toHaveBeenCalledWith(ORG_ID, { name: "Lácteos" });
      expect(router.refresh).toHaveBeenCalled();
      expect(screen.getByLabelText("Nombre de la categoría nueva")).toHaveValue(
        "",
      );
    });

    it("CA-E03: muestra que ya existe una categoría con ese nombre, en el campo", async () => {
      const user = userEvent.setup();
      vi.mocked(createCategory).mockResolvedValue(err(catalogError("CA-E03")));
      renderManager();

      await user.type(
        screen.getByLabelText("Nombre de la categoría nueva"),
        "bebidas",
      );
      await user.click(screen.getByRole("button", { name: "Crear categoría" }));

      const field = screen.getByLabelText("Nombre de la categoría nueva");
      await waitFor(() =>
        expect(field).toHaveAttribute("aria-invalid", "true"),
      );
      expect(field).toHaveAccessibleDescription(
        "Ya existe una categoría con ese nombre.",
      );
      expect(field).toHaveValue("bebidas");
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it("CA-E01: el error por campo del nombre queda en el campo", async () => {
      const user = userEvent.setup();
      vi.mocked(createCategory).mockResolvedValue(
        err(
          catalogError("CA-E01", {
            fieldErrors: { name: "Escribí el nombre de la categoría." },
          }),
        ),
      );
      renderManager();

      await user.click(screen.getByRole("button", { name: "Crear categoría" }));

      const field = screen.getByLabelText("Nombre de la categoría nueva");
      await waitFor(() =>
        expect(field).toHaveAccessibleDescription(
          "Escribí el nombre de la categoría.",
        ),
      );
    });

    it.each([
      ["CA-E04", "No tenés permiso para hacer esto."],
      ["CA-E10", "No se pudo guardar. Probá de nuevo en un momento."],
    ] as const)("%s se muestra como mensaje general", async (code, message) => {
      const user = userEvent.setup();
      vi.mocked(createCategory).mockResolvedValue(err(catalogError(code)));
      renderManager();

      await user.type(
        screen.getByLabelText("Nombre de la categoría nueva"),
        "X",
      );
      await user.click(screen.getByRole("button", { name: "Crear categoría" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    });
  });

  describe("renombrar", () => {
    it("abre el campo con el nombre actual, manda el nuevo y refresca", async () => {
      const user = userEvent.setup();
      vi.mocked(renameCategory).mockResolvedValue(
        ok({ category: { id: CATEGORY_ID, name: "Golosinas y chocolates" } }),
      );
      renderManager();

      await user.click(
        screen.getByRole("button", {
          name: "Renombrar la categoría Golosinas",
        }),
      );
      const field = screen.getByLabelText("Nuevo nombre de Golosinas");
      expect(field).toHaveValue("Golosinas");
      await user.clear(field);
      await user.type(field, "Golosinas y chocolates");
      await user.click(screen.getByRole("button", { name: "Guardar nombre" }));

      expect(await screen.findByText("Nombre cambiado.")).toBeVisible();
      expect(renameCategory).toHaveBeenCalledWith(ORG_ID, {
        categoryId: CATEGORY_ID,
        name: "Golosinas y chocolates",
      });
      expect(router.refresh).toHaveBeenCalled();
      expect(
        screen.queryByLabelText("Nuevo nombre de Golosinas"),
      ).not.toBeInTheDocument();
    });

    it("CA-E03: el nombre repetido queda marcado y el campo sigue abierto", async () => {
      const user = userEvent.setup();
      vi.mocked(renameCategory).mockResolvedValue(err(catalogError("CA-E03")));
      renderManager();

      await user.click(
        screen.getByRole("button", {
          name: "Renombrar la categoría Golosinas",
        }),
      );
      const field = screen.getByLabelText("Nuevo nombre de Golosinas");
      await user.clear(field);
      await user.type(field, "bebidas");
      await user.click(screen.getByRole("button", { name: "Guardar nombre" }));

      await waitFor(() =>
        expect(field).toHaveAttribute("aria-invalid", "true"),
      );
      expect(field).toHaveAccessibleDescription(
        "Ya existe una categoría con ese nombre.",
      );
    });

    it("cancelar cierra el campo sin llamar a la acción", async () => {
      const user = userEvent.setup();
      renderManager();

      await user.click(
        screen.getByRole("button", { name: "Renombrar la categoría Bebidas" }),
      );
      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(
        screen.queryByLabelText("Nuevo nombre de Bebidas"),
      ).not.toBeInTheDocument();
      expect(renameCategory).not.toHaveBeenCalled();
    });
  });

  it("con la organización suspendida no hay controles de escritura", () => {
    renderManager({ writable: false });

    expect(
      screen.queryByLabelText("Nombre de la categoría nueva"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Renombrar la categoría/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Bebidas")).toBeVisible();
  });
});
