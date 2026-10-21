import { describe, expect, it } from "vitest";

import { locationIdSchema, orgIdSchema } from "../location-id";

// Ids del seed de desarrollo (UUID v4 con prefijos fijos) y un UUID v7 como los
// que genera el cliente (DD-31): los dos tienen que pasar.
const SEED_LOCATION_NORTE_CENTRO = "00000000-0000-4000-b000-000000000001";
const SEED_LOCATION_SUR_ESTE = "00000000-0000-4000-b000-000000000003";
const SEED_ORG_NORTE = "00000000-0000-4000-a000-000000000001";
const SEED_ORG_SUR = "00000000-0000-4000-a000-000000000002";
const UUID_V7 = "0192f3c4-7b1e-7c3a-9d2e-5a6b7c8d9e0f";

const NOT_UUIDS: ReadonlyArray<[string, unknown]> = [
  ["texto que no es un uuid", "no-es-un-uuid"],
  ["cadena vacía", ""],
  ["undefined", undefined],
  ["null", null],
  ["un número", 12345],
  ["un array con un uuid válido", [SEED_LOCATION_NORTE_CENTRO]],
  ["un uuid cortado", "00000000-0000-4000-b000-00000000000"],
  ["un uuid con un espacio al final", `${SEED_LOCATION_NORTE_CENTRO} `],
  [
    "un uuid con un carácter que no es hexadecimal",
    "0000000g-0000-4000-b000-000000000001",
  ],
];

describe("locationIdSchema", () => {
  it.each([
    ["seed: Local Centro de Norte", SEED_LOCATION_NORTE_CENTRO],
    ["seed: Local Este de Sur", SEED_LOCATION_SUR_ESTE],
    ["un UUID v7", UUID_V7],
  ])("acepta %s", (_name, value) => {
    expect(locationIdSchema.safeParse(value)).toEqual({
      success: true,
      data: value,
    });
  });

  it.each(NOT_UUIDS)("rechaza %s sin lanzar", (_name, value) => {
    expect(locationIdSchema.safeParse(value).success).toBe(false);
  });

  it("normaliza a minúsculas un id escrito en mayúsculas (el de Postgres es minúscula)", () => {
    expect(
      locationIdSchema.safeParse(SEED_LOCATION_NORTE_CENTRO.toUpperCase()),
    ).toEqual({ success: true, data: SEED_LOCATION_NORTE_CENTRO });
    expect(locationIdSchema.safeParse(UUID_V7.toUpperCase())).toEqual({
      success: true,
      data: UUID_V7,
    });
  });
});

describe("orgIdSchema", () => {
  it.each([
    ["seed: Kiosco Demo Norte", SEED_ORG_NORTE],
    ["seed: Almacén Demo Sur", SEED_ORG_SUR],
    ["un UUID v7", UUID_V7],
  ])("acepta %s", (_name, value) => {
    expect(orgIdSchema.safeParse(value)).toEqual({
      success: true,
      data: value,
    });
  });

  it.each(NOT_UUIDS)("rechaza %s sin lanzar", (_name, value) => {
    expect(orgIdSchema.safeParse(value).success).toBe(false);
  });

  it("normaliza a minúsculas un id escrito en mayúsculas (el de Postgres es minúscula)", () => {
    expect(orgIdSchema.safeParse(SEED_ORG_NORTE.toUpperCase())).toEqual({
      success: true,
      data: SEED_ORG_NORTE,
    });
    expect(orgIdSchema.safeParse(UUID_V7.toUpperCase())).toEqual({
      success: true,
      data: UUID_V7,
    });
  });
});
