import { describe, expect, it } from "vitest";

import { isStickyStatus, nextStatus } from "../sync-policy";
import type { CatalogCacheStatus, SyncOutcome } from "../sync-policy";

const STATUSES = [
  "loading",
  "ready",
  "stale",
  "unauthenticated",
  "no-access",
  "memory-only",
] as const satisfies readonly CatalogCacheStatus[];

describe("nextStatus: transición del estado de la caché", () => {
  // Resultados que no dependen del estado anterior: la última información manda.
  it.each(STATUSES)("success desde %s: ready", (current) => {
    expect(nextStatus(current, "success")).toBe("ready");
  });

  it.each(STATUSES)("401 desde %s: unauthenticated", (current) => {
    expect(nextStatus(current, "unauthorized")).toBe("unauthenticated");
  });

  it.each(STATUSES)("404 desde %s: no-access", (current) => {
    expect(nextStatus(current, "not-found")).toBe("no-access");
  });

  it.each(STATUSES)(
    "error de almacenamiento desde %s: memory-only",
    (current) => {
      expect(nextStatus(current, "storage-error")).toBe("memory-only");
    },
  );

  // Fallas transitorias: la caché se conserva y queda desactualizada...
  it.each([
    ["red caída", "network-error"],
    ["5xx (incluido el 503)", "server-error"],
    ["respuesta que no valida", "invalid-response"],
  ] satisfies [string, SyncOutcome][])(
    "%s desde un estado sano (loading, ready, stale): stale",
    (_label, outcome) => {
      for (const current of ["loading", "ready", "stale"] as const) {
        expect(nextStatus(current, outcome), current).toBe("stale");
      }
    },
  );

  // ...pero no tapan un problema más grave que sigue sin resolverse.
  it.each([
    ["red caída", "network-error"],
    ["5xx (incluido el 503)", "server-error"],
    ["respuesta que no valida", "invalid-response"],
  ] satisfies [string, SyncOutcome][])(
    "%s no pisa unauthenticated, no-access ni memory-only",
    (_label, outcome) => {
      for (const current of [
        "unauthenticated",
        "no-access",
        "memory-only",
      ] as const) {
        expect(nextStatus(current, outcome), current).toBe(current);
      }
    },
  );

  it("cubre todas las combinaciones de estado y resultado (6 x 7)", () => {
    const outcomes = [
      "success",
      "network-error",
      "server-error",
      "invalid-response",
      "unauthorized",
      "not-found",
      "storage-error",
    ] as const satisfies readonly SyncOutcome[];

    for (const current of STATUSES) {
      for (const outcome of outcomes) {
        expect(STATUSES, `${current} + ${outcome}`).toContain(
          nextStatus(current, outcome),
        );
      }
    }
  });
});

describe("isStickyStatus: lo que solo resuelve el servidor", () => {
  it.each([
    ["unauthenticated", true],
    ["no-access", true],
    ["loading", false],
    ["ready", false],
    ["stale", false],
    ["memory-only", false],
  ] as const)("%s: %s", (status, sticky) => {
    expect(isStickyStatus(status)).toBe(sticky);
  });
});
