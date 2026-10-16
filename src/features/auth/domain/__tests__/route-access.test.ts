import { describe, expect, it } from "vitest";

import { decideAccess, routeKindOf } from "../route-access";
import type { AccessDecision, RouteKind } from "../route-access";
import type { SessionKind } from "../session-kind";

describe("routeKindOf", () => {
  it.each([
    ["/login", "guest"],
    ["/recuperar-contrasena", "guest"],
    ["/auth/confirm", "link"],
    ["/auth/callback", "link"],
    ["/actualizar-contrasena", "password-setup"],
    ["/", "protected"],
    ["/l/123/vender", "protected"],
    ["/admin", "protected"],
    ["/caja", "protected"],
  ] satisfies [string, RouteKind][])("%s es %s", (pathname, expected) => {
    expect(routeKindOf(pathname)).toBe(expected);
  });

  it("ignora la barra final (Next la normaliza con una redirección)", () => {
    expect(routeKindOf("/login/")).toBe("guest");
    expect(routeKindOf("/recuperar-contrasena/")).toBe("guest");
    expect(routeKindOf("/auth/confirm/")).toBe("link");
    expect(routeKindOf("/actualizar-contrasena/")).toBe("password-setup");
  });

  it("lo que no es exactamente una ruta conocida es protegido (falla cerrado)", () => {
    expect(routeKindOf("/login/otra")).toBe("protected");
    expect(routeKindOf("/loginx")).toBe("protected");
    expect(routeKindOf("/LOGIN")).toBe("protected");
    expect(routeKindOf("/%6Cogin")).toBe("protected");
    expect(routeKindOf("/auth")).toBe("protected");
    expect(routeKindOf("/auth/otra")).toBe("protected");
    expect(routeKindOf("/auth/confirm/x")).toBe("protected");
    expect(routeKindOf("/l/1/login")).toBe("protected");
    expect(routeKindOf("//login")).toBe("protected");
    expect(routeKindOf("")).toBe("protected");
  });
});

describe("decideAccess", () => {
  const getRequest = {
    method: "GET",
    pathname: "/l/123/vender",
    search: "?tab=1",
  };
  const LOGIN_WITH_NEXT = "/login?next=%2Fl%2F123%2Fvender%3Ftab%3D1";

  const proceed: AccessDecision = { type: "continue", signOut: false };
  const proceedSigningOut: AccessDecision = { type: "continue", signOut: true };
  const redirectTo = (to: string, signOut = false): AccessDecision => ({
    type: "redirect",
    to,
    signOut,
  });

  // Las 16 celdas de la tabla de D5, una por una.
  const cells: [RouteKind, SessionKind, AccessDecision][] = [
    // guest
    ["guest", "none", proceed],
    ["guest", "password-setup", proceed],
    ["guest", "password-setup-expired", proceedSigningOut],
    ["guest", "full", redirectTo("/")],
    // link
    ["link", "none", proceed],
    ["link", "password-setup", proceed],
    ["link", "password-setup-expired", proceed],
    ["link", "full", proceed],
    // password-setup
    ["password-setup", "none", redirectTo("/login")],
    ["password-setup", "password-setup", proceed],
    [
      "password-setup",
      "password-setup-expired",
      redirectTo("/recuperar-contrasena?error=link", true),
    ],
    ["password-setup", "full", redirectTo("/")],
    // protected
    ["protected", "none", redirectTo(LOGIN_WITH_NEXT)],
    ["protected", "password-setup", redirectTo("/actualizar-contrasena")],
    ["protected", "password-setup-expired", redirectTo(LOGIN_WITH_NEXT, true)],
    ["protected", "full", proceed],
  ];

  it("cubre las 16 combinaciones de ruta y sesión", () => {
    const routes = new Set(cells.map(([route]) => route));
    const sessions = new Set(cells.map(([, session]) => session));

    expect(cells).toHaveLength(16);
    expect(routes.size).toBe(4);
    expect(sessions.size).toBe(4);
    expect(new Set(cells.map(([r, s]) => `${r}|${s}`)).size).toBe(16);
  });

  it.each(cells)("ruta %s con sesión %s", (route, session, expected) => {
    expect(decideAccess(route, session, getRequest)).toEqual(expected);
  });

  describe("?next= de la redirección a /login", () => {
    it("se arma con la ruta y su query, codificados", () => {
      expect(decideAccess("protected", "none", getRequest)).toEqual(
        redirectTo("/login?next=%2Fl%2F123%2Fvender%3Ftab%3D1"),
      );
    });

    it("la raíz lleva next=%2F", () => {
      expect(
        decideAccess("protected", "none", {
          method: "GET",
          pathname: "/",
          search: "",
        }),
      ).toEqual(redirectTo("/login?next=%2F"));
    });

    it("una ruta sin query no lleva signo de pregunta de más", () => {
      expect(
        decideAccess("protected", "none", {
          method: "GET",
          pathname: "/caja",
          search: "",
        }),
      ).toEqual(redirectTo("/login?next=%2Fcaja"));
    });

    it("solo en GET: una acción (POST) vuelve a /login sin next", () => {
      expect(
        decideAccess("protected", "none", { ...getRequest, method: "POST" }),
      ).toEqual(redirectTo("/login"));
      expect(
        decideAccess("protected", "password-setup-expired", {
          ...getRequest,
          method: "POST",
        }),
      ).toEqual(redirectTo("/login", true));
    });

    it("el next pasa por safeNextPath: un destino sospechoso se reemplaza por /", () => {
      expect(
        decideAccess("protected", "none", {
          method: "GET",
          pathname: "//evil.example",
          search: "",
        }),
      ).toEqual(redirectTo("/login?next=%2F"));
    });
  });

  describe("el método no cambia las demás decisiones", () => {
    it.each(["POST", "PUT", "DELETE"])(
      "%s en una ruta protegida con sesión completa sigue",
      (method) => {
        expect(
          decideAccess("protected", "full", { ...getRequest, method }),
        ).toEqual(proceed);
      },
    );

    it("POST a una pantalla de invitado con sesión completa redirige a /", () => {
      expect(
        decideAccess("guest", "full", { ...getRequest, method: "POST" }),
      ).toEqual(redirectTo("/"));
    });

    it("POST a /actualizar-contrasena con sesión vencida cierra la sesión y manda al aviso", () => {
      expect(
        decideAccess("password-setup", "password-setup-expired", {
          ...getRequest,
          method: "POST",
        }),
      ).toEqual(redirectTo("/recuperar-contrasena?error=link", true));
    });
  });

  // Una Server Action invocada por el JavaScript de Next (POST con `Next-Action`)
  // no puede seguir una redirección HTTP: el cliente lanza "An unexpected response
  // was received from the server". Cada acción verifica por su cuenta y redirige
  // con `redirect()`, así que el proxy deja pasar siempre y no cierra ninguna sesión.
  describe("Server Actions (isServerAction)", () => {
    const actionRequest = { ...getRequest, method: "POST" };

    it.each(cells)(
      "ruta %s con sesión %s: sigue, sin redirigir y sin cerrar la sesión",
      (route, session) => {
        expect(
          decideAccess(route, session, {
            ...actionRequest,
            isServerAction: true,
          }),
        ).toEqual(proceed);
      },
    );

    it("también en las rutas reales de cada clase (la clase de ruta no importa)", () => {
      for (const [pathname, session] of [
        ["/", "none"],
        ["/login", "full"],
        ["/actualizar-contrasena", "password-setup-expired"],
        ["/actualizar-contrasena", "none"],
        ["/auth/confirm", "full"],
      ] satisfies [string, SessionKind][]) {
        expect(
          decideAccess(routeKindOf(pathname), session, {
            method: "POST",
            pathname,
            search: "",
            isServerAction: true,
          }),
        ).toEqual(proceed);
      }
    });

    it("sin la marca (o con false) las mismas requests siguen la tabla de D5", () => {
      expect(
        decideAccess("protected", "none", {
          ...actionRequest,
          isServerAction: false,
        }),
      ).toEqual(redirectTo("/login"));
      expect(decideAccess("protected", "none", actionRequest)).toEqual(
        redirectTo("/login"),
      );
      expect(
        decideAccess("password-setup", "password-setup-expired", {
          ...actionRequest,
          isServerAction: false,
        }),
      ).toEqual(redirectTo("/recuperar-contrasena?error=link", true));
      expect(
        decideAccess("guest", "full", {
          ...actionRequest,
          isServerAction: false,
        }),
      ).toEqual(redirectTo("/"));
    });
  });

  it("solo marca cerrar sesión en las celdas de sesión vencida", () => {
    const signingOut = cells
      .filter(([, , decision]) => decision.signOut)
      .map(([route, session]) => `${route}|${session}`);

    expect(signingOut).toEqual([
      "guest|password-setup-expired",
      "password-setup|password-setup-expired",
      "protected|password-setup-expired",
    ]);
  });
});
