import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LocationLayout from "@/app/(app)/l/[locationId]/layout";
import {
  SECTIONS,
  buildTenantContext,
  resolveLocationAccess,
} from "@/features/tenancy";
import type { ShellModel } from "@/features/tenancy";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_CENTRO,
  LOC_SUR_ESTE,
  ORG_NORTE,
  ORG_SUR,
  rowsFor,
} from "@/features/tenancy/domain/__tests__/fixtures";
import type { SeedUserKey } from "@/features/tenancy/domain/__tests__/fixtures";
import { requireLocationContext } from "@/features/tenancy/server";

// Spec app-shell "Marco responsive de la app" (D11): el layout de `/l/[locationId]`
// llama a la guarda y le pasa al marco SOLO lo que dibuja (nombres, ids, rol,
// `writable` y secciones), porque eso cruza al cliente. Se simulan la guarda y el
// marco (para capturar el modelo que recibe).

const shell = vi.hoisted(() => ({ received: [] as unknown[] }));

vi.mock("@/features/tenancy/server", () => ({
  requireLocationContext: vi.fn(),
}));
vi.mock("@/features/tenancy/components", () => ({
  AppShell: ({ model, children }: { model: unknown; children: ReactNode }) => {
    shell.received.push(model);
    return <div data-testid="app-shell">{children}</div>;
  },
}));

function enter(user: SeedUserKey, locationId: string) {
  const access = resolveLocationAccess(
    buildTenantContext(rowsFor(user)),
    locationId,
  );
  if (access.kind !== "ok") throw new Error(`${user} no entra a ${locationId}`);
  vi.mocked(requireLocationContext).mockResolvedValue(access.context);
}

function renderLayout(locationId: string, children: ReactNode = "contenido") {
  return LocationLayout({
    children,
    params: Promise.resolve({ locationId }),
  });
}

beforeEach(() => {
  vi.mocked(requireLocationContext).mockReset();
  shell.received.length = 0;
});

describe("layout /l/[locationId]", () => {
  it("llama a requireLocationContext con el id de la URL, tal cual", async () => {
    enter("employee.norte", LOC_NORTE_CENTRO);

    render(await renderLayout(LOC_NORTE_CENTRO));

    expect(requireLocationContext).toHaveBeenCalledTimes(1);
    expect(requireLocationContext).toHaveBeenCalledWith(LOC_NORTE_CENTRO);
  });

  it("dibuja las páginas hijas dentro del marco", async () => {
    enter("employee.norte", LOC_NORTE_CENTRO);

    render(await renderLayout(LOC_NORTE_CENTRO, <p>página del local</p>));

    expect(
      within(screen.getByTestId("app-shell")).getByText("página del local"),
    ).toBeVisible();
  });

  it("le pasa al marco el modelo mínimo: nombres, ids, rol, writable y secciones", async () => {
    enter("employee.norte", LOC_NORTE_CENTRO);

    render(await renderLayout(LOC_NORTE_CENTRO));

    const expected: ShellModel = {
      userName: "Empleado Demo Norte",
      location: { id: LOC_NORTE_CENTRO, name: "Local Centro" },
      organization: {
        id: ORG_NORTE,
        name: "Kiosco Demo Norte",
        writable: true,
      },
      role: "employee",
      canSwitchLocation: false,
      sections: [
        { key: "inicio", label: "Inicio", href: `/l/${LOC_NORTE_CENTRO}` },
      ],
    };
    expect(shell.received).toStrictEqual([expected]);
  });

  it("nada fuera de eso cruza al cliente: ni el email, ni el id de la persona, ni locales de otros", async () => {
    enter("owner.sur", LOC_SUR_CENTRO);

    render(await renderLayout(LOC_SUR_CENTRO));

    const serialized = JSON.stringify(shell.received);
    expect(serialized).not.toContain("owner.sur@demo.test");
    expect(serialized).not.toContain("10000000-0000-4000-8000-000000000004");
    expect(serialized).not.toContain("Kiosco Demo Norte");
    expect(serialized).not.toContain(LOC_NORTE_CENTRO);
    // Los otros locales de la organización no viajan: solo "se puede cambiar".
    expect(serialized).not.toContain(LOC_SUR_ESTE);
    expect(shell.received).toMatchObject([
      {
        organization: { id: ORG_SUR },
        canSwitchLocation: true,
        role: "owner",
      },
    ]);
  });

  it("el modelo usa el registro real de secciones (hoy, solo el inicio)", async () => {
    enter("owner.norte", LOC_NORTE_CENTRO);

    render(await renderLayout(LOC_NORTE_CENTRO));

    const [model] = shell.received as ShellModel[];
    expect(model?.sections.map((s) => s.key)).toEqual(
      SECTIONS.filter((s) => s.built).map((s) => s.key),
    );
  });

  it("si la guarda corta (404 o salida), el layout no dibuja el marco", async () => {
    vi.mocked(requireLocationContext).mockRejectedValue(
      new Error("NEXT_NOT_FOUND"),
    );

    await expect(renderLayout("no-es-un-uuid")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(shell.received).toEqual([]);
  });
});
