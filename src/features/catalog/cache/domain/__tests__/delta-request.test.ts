import { describe, expect, it } from "vitest";

import {
  LOCATION_ID,
  ORGANIZATION_ID,
  OTHER_LOCATION_ID,
  OTHER_LOCATION_UNASSIGNED_ID,
  OTHER_ORGANIZATION_ID,
  makeTenantContext,
} from "../../__tests__/fixtures";
import {
  DELTA_FAILURE_STATUS,
  decideDeltaRequest,
  deltaFailureBody,
} from "../delta-request";

// Spec catalog-delta-api "Endpoint del delta con identidad verificada y local
// validado": la decisión de la respuesta es una función pura (tarea 6.5). El
// handler solo lee la request, autentica y le pasa el contexto de tenant.

const query = (init: Record<string, string>) => new URLSearchParams(init);

// La persona de la organización A, asignada solo a su local.
const employeeA = makeTenantContext();
// La de la organización B, asignada a su local pero no al otro de la misma organización.
const employeeB = makeTenantContext({
  organizationId: OTHER_ORGANIZATION_ID,
  locationIds: [OTHER_LOCATION_ID],
});

describe("decideDeltaRequest: local propio", () => {
  it.each([
    ["employee", "employee"],
    ["manager", "manager"],
    ["owner", "owner"],
  ] as const)(
    "%s en su local: ok, con la organización de ESE local (no la que diga la URL)",
    (_name, role) => {
      expect(
        decideDeltaRequest(
          query({ location: LOCATION_ID, organization: OTHER_ORGANIZATION_ID }),
          makeTenantContext({ role }),
        ),
      ).toEqual({ ok: true, organizationId: ORGANIZATION_ID, since: null });
    },
  );

  it("la persona de otra organización recibe la suya", () => {
    expect(
      decideDeltaRequest(query({ location: OTHER_LOCATION_ID }), employeeB),
    ).toEqual({
      ok: true,
      organizationId: OTHER_ORGANIZATION_ID,
      since: null,
    });
  });

  it("el id del local en mayúsculas es el mismo local", () => {
    expect(
      decideDeltaRequest(
        query({ location: LOCATION_ID.toUpperCase() }),
        employeeA,
      ),
    ).toMatchObject({ ok: true, organizationId: ORGANIZATION_ID });
  });

  it("devuelve `since` tal cual lo recibió (el solape lo resta la lectura)", () => {
    expect(
      decideDeltaRequest(
        query({
          location: LOCATION_ID,
          since: "2026-10-21T08:00:00.123456+00:00",
        }),
        employeeA,
      ),
    ).toEqual({
      ok: true,
      organizationId: ORGANIZATION_ID,
      since: "2026-10-21T08:00:00.123456+00:00",
    });
  });

  it("una organización suspendida sigue leyendo (la suspensión es solo lectura)", () => {
    expect(
      decideDeltaRequest(
        query({ location: LOCATION_ID }),
        makeTenantContext({ status: "suspended" }),
      ),
    ).toMatchObject({ ok: true, organizationId: ORGANIZATION_ID });
  });
});

describe("decideDeltaRequest: 404 uniforme", () => {
  const notFound = { ok: false, failure: "not_found" } as const;

  it.each([
    ["local de otra organización", employeeA, OTHER_LOCATION_ID],
    [
      "local de la misma organización pero no asignado",
      employeeB,
      OTHER_LOCATION_UNASSIGNED_ID,
    ],
    ["uuid que no existe", employeeA, "00000000-0000-4000-b000-0000000000ff"],
    ["texto que no es un uuid", employeeB, "no-es-un-uuid"],
    ["id vacío", employeeA, ""],
    [
      "super-admin (no recibe locales por serlo) en un local existente",
      makeTenantContext({ isPlatformAdmin: true, withOrganization: false }),
      LOCATION_ID,
    ],
    [
      "super-admin en un texto que no es un uuid",
      makeTenantContext({ isPlatformAdmin: true, withOrganization: false }),
      "no-es-un-uuid",
    ],
    [
      "persona sin ningún local (no una salida distinta)",
      makeTenantContext({ withOrganization: false }),
      LOCATION_ID,
    ],
    [
      "organización sin locales activos",
      makeTenantContext({ locationIds: [] }),
      LOCATION_ID,
    ],
  ])("%s", (_name, context, location) => {
    expect(decideDeltaRequest(query({ location }), context)).toEqual(notFound);
  });

  it("un local ajeno con `since` inválido sigue siendo 404 (el 400 no sirve para sondear)", () => {
    expect(
      decideDeltaRequest(
        query({ location: OTHER_LOCATION_ID, since: "ayer" }),
        employeeA,
      ),
    ).toEqual(notFound);
  });
});

describe("decideDeltaRequest: 400", () => {
  const badRequest = { ok: false, failure: "bad_request" } as const;

  it.each([
    ["ayer"],
    [""],
    ["2026-10-21"],
    // Sin zona horaria no se sabe de qué instante habla.
    ["2026-10-21T08:00:00"],
    ["2026-13-45T25:61:61Z"],
    ["1; drop table products"],
  ])("since=%j inválido", (since) => {
    expect(
      decideDeltaRequest(query({ location: LOCATION_ID, since }), employeeA),
    ).toEqual(badRequest);
  });

  it.each([
    ["2026-10-21T08:00:00Z"],
    ["2026-10-21T08:00:00+00:00"],
    ["2026-10-21T05:00:00.123-03:00"],
  ])("since=%j válido", (since) => {
    expect(
      decideDeltaRequest(query({ location: LOCATION_ID, since }), employeeA),
    ).toMatchObject({ ok: true, since });
  });

  it("sin el parámetro `location`", () => {
    expect(decideDeltaRequest(query({}), employeeA)).toEqual(badRequest);
  });
});

describe("decideDeltaRequest: `since` dentro de rango (nunca llega a Postgres fuera de rango)", () => {
  const badRequest = { ok: false, failure: "bad_request" } as const;
  const NOW = Date.parse("2026-11-02T15:00:00Z");
  const decide = (since: string) =>
    decideDeltaRequest(query({ location: LOCATION_ID, since }), employeeA, NOW);

  it.each([
    ["antes del 2000", "1999-12-31T23:59:59Z"],
    ["el año 0001", "0001-01-01T00:00:00Z"],
    ["el año 9999", "9999-12-31T23:59:59Z"],
    ["más de un día en el futuro", "2026-11-03T15:00:01Z"],
    ["con zona que lo deja antes del 2000", "2000-01-01T00:00:00+03:00"],
  ])("since de %s: 400", (_name, since) => {
    expect(decide(since)).toEqual(badRequest);
  });

  it.each([
    ["el 1 de enero del 2000", "2000-01-01T00:00:00Z"],
    ["ahora", "2026-11-02T15:00:00Z"],
    [
      "justo un día en el futuro (reloj atrasado del servidor)",
      "2026-11-03T15:00:00Z",
    ],
  ])("since de %s: válido", (_name, since) => {
    expect(decide(since)).toMatchObject({ ok: true, since });
  });

  it("un local ajeno con since fuera de rango sigue siendo 404 (el orden no cambia)", () => {
    expect(
      decideDeltaRequest(
        query({ location: OTHER_LOCATION_ID, since: "9999-12-31T23:59:59Z" }),
        employeeA,
        NOW,
      ),
    ).toEqual({ ok: false, failure: "not_found" });
  });
});

describe("respuestas de falla", () => {
  it("cada falla tiene su código HTTP", () => {
    expect(DELTA_FAILURE_STATUS).toEqual({
      unauthenticated: 401,
      bad_request: 400,
      not_found: 404,
      unavailable: 503,
    });
  });

  it.each([
    "unauthenticated",
    "bad_request",
    "not_found",
    "unavailable",
  ] as const)("el cuerpo de %s es solo el código, sin más datos", (failure) => {
    expect(deltaFailureBody(failure)).toEqual({ error: failure });
  });
});
