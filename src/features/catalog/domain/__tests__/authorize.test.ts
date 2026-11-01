import { describe, expect, it } from "vitest";

import { isErr, isOk } from "@/shared/lib/result";

import { CATALOG_ACTIONS, authorizeCatalogAction } from "../authorize";
import type { CatalogAction } from "../authorize";
import type { CatalogErrorCode } from "../errors";

const ROLES = ["owner", "manager", "employee"] as const;

function codeOf(
  action: CatalogAction,
  role: (typeof ROLES)[number],
  writable: boolean,
): CatalogErrorCode | "ok" {
  const decision = authorizeCatalogAction(action, { role, writable });
  return isErr(decision) ? decision.error.code : "ok";
}

describe("authorizeCatalogAction: catálogo de acciones", () => {
  it("son las nueve acciones del catálogo", () => {
    expect([...CATALOG_ACTIONS].sort()).toEqual(
      [
        "addBarcode",
        "changeSalePrice",
        "correctBarcode",
        "createCategory",
        "createProduct",
        "deactivateProduct",
        "reactivateProduct",
        "renameCategory",
        "updateProduct",
      ].sort(),
    );
  });
});

describe("authorizeCatalogAction: decisión por acción", () => {
  it.each(CATALOG_ACTIONS)(
    "%s con la organización activa: owner y manager sí",
    (action) => {
      expect(codeOf(action, "owner", true)).toBe("ok");
      expect(codeOf(action, "manager", true)).toBe("ok");
    },
  );

  it("solo createProduct admite al empleado", () => {
    expect(codeOf("createProduct", "employee", true)).toBe("ok");

    const others = CATALOG_ACTIONS.filter(
      (action) => action !== "createProduct",
    );
    expect(others).toHaveLength(CATALOG_ACTIONS.length - 1);
    for (const action of others) {
      expect(codeOf(action, "employee", true), action).toBe("CA-E04");
    }
  });

  it.each(CATALOG_ACTIONS)(
    "%s con la organización suspendida da CA-E05 para todos los roles",
    (action) => {
      for (const role of ROLES) {
        expect(codeOf(action, role, false), `${action}/${role}`).toBe("CA-E05");
      }
    },
  );

  it("la suspensión se mira antes que el rol: un empleado sin permiso también recibe CA-E05", () => {
    expect(codeOf("updateProduct", "employee", false)).toBe("CA-E05");
  });

  it("el éxito no lleva valor y el error es un CatalogError con su mensaje", () => {
    const granted = authorizeCatalogAction("createProduct", {
      role: "owner",
      writable: true,
    });
    const denied = authorizeCatalogAction("changeSalePrice", {
      role: "employee",
      writable: true,
    });

    expect(isOk(granted)).toBe(true);
    expect(denied).toStrictEqual({
      ok: false,
      error: { code: "CA-E04", message: "No tenés permiso para hacer esto." },
    });
  });

  it("un rol desconocido que llegara de afuera falla cerrado", () => {
    const decision = authorizeCatalogAction("createProduct", {
      // @ts-expect-error el rol es un tipo cerrado; esto simula un valor de afuera
      role: "admin",
      writable: true,
    });

    expect(isErr(decision) && decision.error.code).toBe("CA-E04");
  });
});
