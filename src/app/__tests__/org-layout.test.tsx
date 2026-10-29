import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OrgLayout from "@/app/(app)/org/[orgId]/layout";
import { ORG_ID, makeOrgContext } from "@/features/catalog/__tests__/fixtures";
import { SECTIONS, buildOrgShellModel } from "@/features/tenancy";
import type { ShellModel } from "@/features/tenancy";
import { requireOrgContext } from "@/features/tenancy/server";

// Spec app-shell "Marco responsive de la app" (D1, D4, D11): el layout de
// `/org/[orgId]` llama a la guarda de la organización (dueño y encargado) y le
// pasa al marco SOLO el modelo que dibuja. Se simulan la guarda y el marco.

const shell = vi.hoisted(() => ({ received: [] as unknown[] }));

vi.mock("@/features/tenancy/server", () => ({
  requireOrgContext: vi.fn(),
}));
vi.mock("@/features/tenancy/components", () => ({
  AppShell: ({ model, children }: { model: unknown; children: ReactNode }) => {
    shell.received.push(model);
    return <div data-testid="app-shell">{children}</div>;
  },
}));

function renderLayout(orgId: string, children: ReactNode = "contenido") {
  return OrgLayout({ children, params: Promise.resolve({ orgId }) });
}

beforeEach(() => {
  vi.mocked(requireOrgContext).mockReset();
  shell.received.length = 0;
});

describe("layout /org/[orgId]", () => {
  it("llama a requireOrgContext con el id de la URL y solo para dueño y encargado", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());

    render(await renderLayout(ORG_ID));

    expect(requireOrgContext).toHaveBeenCalledTimes(1);
    expect(requireOrgContext).toHaveBeenCalledWith(ORG_ID, [
      "owner",
      "manager",
    ]);
  });

  it("dibuja las páginas hijas dentro del marco", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());

    render(await renderLayout(ORG_ID, <p>página del catálogo</p>));

    expect(
      within(screen.getByTestId("app-shell")).getByText("página del catálogo"),
    ).toBeVisible();
  });

  it.each(["owner", "manager"] as const)(
    "le pasa al marco el modelo de organización armado con el registro real (%s)",
    async (role) => {
      const context = makeOrgContext({ role });
      vi.mocked(requireOrgContext).mockResolvedValue(context);

      render(await renderLayout(ORG_ID));

      const expected: ShellModel = buildOrgShellModel(context, SECTIONS);
      expect(shell.received).toStrictEqual([expected]);
      expect(expected.location).toBeNull();
      expect(expected.sections.map((s) => s.key)).toContain("catalogo");
    },
  );

  it("una organización suspendida llega al marco como no escribible", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ writable: false }),
    );

    render(await renderLayout(ORG_ID));

    expect(shell.received).toMatchObject([
      { organization: { id: ORG_ID, writable: false } },
    ]);
  });

  it("si la guarda corta (404 o salida), el layout no dibuja el marco", async () => {
    vi.mocked(requireOrgContext).mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(renderLayout("no-es-un-uuid")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(shell.received).toEqual([]);
  });
});
