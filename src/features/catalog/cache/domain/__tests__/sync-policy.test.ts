import { describe, expect, it } from "vitest";

import { CACHE_FORMAT_VERSION } from "../../datasets";
import {
  OTHER_ORGANIZATION_ID,
  OTHER_USER_ID,
  ORGANIZATION_ID,
  USER_ID,
} from "../../__tests__/fixtures";
import { FULL_SYNC_MAX_AGE_MS, decideSyncMode } from "../sync-policy";
import type { CacheMeta } from "../sync-policy";

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-02T15:00:00Z");
const CURSOR = "2026-11-02T14:58:30.123456+00:00";

const scope = { userId: USER_ID, organizationId: ORGANIZATION_ID };

/** Una `meta` sana: misma persona y organización, con cursor y una completa de hace 1 hora. */
const meta = (overrides: Partial<CacheMeta> = {}): CacheMeta => ({
  formatVersion: CACHE_FORMAT_VERSION,
  userId: USER_ID,
  organizationId: ORGANIZATION_ID,
  cursor: CURSOR,
  lastFullSyncAt: NOW - HOUR_MS,
  lastSyncAt: NOW - 60_000,
  ...overrides,
});

describe("decideSyncMode", () => {
  it("la red de seguridad es de 6 horas", () => {
    expect(FULL_SYNC_MAX_AGE_MS).toBe(6 * HOUR_MS);
  });

  it.each([
    ["sin meta (primera vez o el navegador borró el almacenamiento)", null],
    ["otra persona", meta({ userId: OTHER_USER_ID })],
    ["otra organización", meta({ organizationId: OTHER_ORGANIZATION_ID })],
    ["otra versión del formato (vieja)", meta({ formatVersion: 0 })],
    [
      "otra versión del formato (nueva)",
      meta({ formatVersion: CACHE_FORMAT_VERSION + 1 }),
    ],
    ["sin cursor", meta({ cursor: null })],
    [
      "una sincronización completa de hace 7 horas",
      meta({ lastFullSyncAt: NOW - 7 * HOUR_MS }),
    ],
    [
      "una completa un milisegundo más vieja que 6 horas",
      meta({ lastFullSyncAt: NOW - 6 * HOUR_MS - 1 }),
    ],
    [
      "una completa con la hora en el futuro (el reloj del dispositivo se atrasó)",
      meta({ lastFullSyncAt: NOW + 1 }),
    ],
  ])("%s: sincronización completa", (_label, current) => {
    expect(decideSyncMode(current, scope, NOW)).toEqual({ mode: "full" });
  });

  it.each([
    ["una completa de hace 1 hora", meta()],
    ["una completa recién hecha", meta({ lastFullSyncAt: NOW })],
    [
      "una completa de hace exactamente 6 horas (el borde no es más de 6)",
      meta({ lastFullSyncAt: NOW - 6 * HOUR_MS }),
    ],
    [
      "una completa de hace 5 horas y 59 minutos",
      meta({ lastFullSyncAt: NOW - 6 * HOUR_MS + 60_000 }),
    ],
  ])("%s: delta con since = cursor", (_label, current) => {
    expect(decideSyncMode(current, scope, NOW)).toEqual({
      mode: "delta",
      since: CURSOR,
    });
  });

  it("el since es el cursor tal cual lo guardó el servidor (sin tocarlo)", () => {
    const decision = decideSyncMode(
      meta({ cursor: "2026-10-30T09:15:00+00:00" }),
      scope,
      NOW,
    );

    expect(decision).toEqual({
      mode: "delta",
      since: "2026-10-30T09:15:00+00:00",
    });
  });

  it("la hora de la última sincronización (no completa) no cambia la decisión", () => {
    expect(
      decideSyncMode(meta({ lastSyncAt: NOW - 30 * HOUR_MS }), scope, NOW),
    ).toEqual({ mode: "delta", since: CURSOR });
  });
});
