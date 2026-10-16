import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Configuración local de Auth versionada en `supabase/config.toml` (D12). La
// prueba de comportamiento la dan los tests `api` de Playwright (alta cerrada,
// contraseña de 8, invitación en castellano); este test impide que alguien
// revierta un valor sin querer.
//
// Lector mínimo de TOML a propósito: solo `[sección]` y `clave = valor`, con
// textos, números, booleanos y listas de textos en una línea. Sin dependencia nueva.

type TomlValue = string | number | boolean | string[];
type Toml = Record<string, Record<string, TomlValue>>;

/** Corta el comentario `# ...` del final de la línea, sin tocar un `#` dentro de comillas. */
function stripComment(line: string): string {
  let insideString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (char === "\\" && insideString) {
      index += 1;
    } else if (char === '"') {
      insideString = !insideString;
    } else if (char === "#" && !insideString) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseValue(raw: string): TomlValue {
  const text = raw.trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
    ) {
      return parsed;
    }
  } catch {
    // Valor que este lector no entiende: queda como texto crudo.
  }
  return text;
}

function parseToml(text: string): Toml {
  const result: Toml = {};
  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line === "") continue;

    const header = /^\[([^\][]+)\]$/.exec(line);
    if (header?.[1] !== undefined) {
      section = header[1].trim();
      result[section] ??= {};
      continue;
    }

    const pair = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (pair?.[1] !== undefined && pair[2] !== undefined) {
      (result[section] ??= {})[pair[1]] = parseValue(pair[2]);
    }
  }
  return result;
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const config = parseToml(
  readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8"),
);

function value(section: string, key: string): TomlValue | undefined {
  return config[section]?.[key];
}

describe("lector mínimo de TOML (de este test)", () => {
  it("lee secciones, textos, números, booleanos y listas, ignorando comentarios", () => {
    const parsed = parseToml(
      [
        "# comentario suelto",
        "[auth]",
        'site_url = "http://localhost:3000"  # comentario al final',
        "enable_signup = false",
        "jwt_expiry = 3600",
        'urls = ["http://a/**", "http://b/#x"]',
        "",
        "[auth.email.template.invite]",
        'subject = "Hola # no es un comentario"',
      ].join("\n"),
    );

    expect(parsed).toEqual({
      auth: {
        site_url: "http://localhost:3000",
        enable_signup: false,
        jwt_expiry: 3600,
        urls: ["http://a/**", "http://b/#x"],
      },
      "auth.email.template.invite": {
        subject: "Hola # no es un comentario",
      },
    });
  });

  it("no toma como valor una línea comentada", () => {
    expect(
      parseToml("[auth]\n# enable_signup = true\nenable_signup = false"),
    ).toEqual({ auth: { enable_signup: false } });
  });
});

describe("supabase/config.toml: Auth local", () => {
  it("cierra el alta pública (RN-AU-01, RN-TE-04)", () => {
    expect(value("auth", "enable_signup")).toBe(false);
  });

  it("deja encendido el proveedor de email: apagarlo rompería el ingreso con contraseña", () => {
    expect(
      value("auth.email", "enable_signup"),
      "[auth.email] enable_signup tiene que seguir en true: en la CLI es el interruptor del proveedor de email entero y apagarlo rompe el ingreso con contraseña (la invitación por la API admin no depende de este valor). El alta pública se cierra con [auth] enable_signup = false.",
    ).toBe(true);
  });

  it("pide contraseñas de al menos 8 caracteres, sin reglas de símbolos", () => {
    expect(value("auth", "minimum_password_length")).toBe(8);
    expect(value("auth", "password_requirements")).toBe("");
  });

  it("usa el mismo host que Playwright y la app: localhost:3000", () => {
    expect(value("auth", "site_url")).toBe("http://localhost:3000");
  });

  it("permite volver a localhost y a 127.0.0.1", () => {
    const redirectUrls = value("auth", "additional_redirect_urls");

    expect(redirectUrls).toEqual(
      expect.arrayContaining([
        "http://localhost:3000/**",
        "http://127.0.0.1:3000/**",
      ]),
    );
  });

  it("sube los límites de la sección rate_limit por encima de los de Supabase (solo local)", () => {
    // Supabase hospedado: 30 ingresos / 30 verificaciones cada 5 minutos por IP y
    // 2 emails por hora con el SMTP por defecto. La suite E2E sale de una sola IP.
    const limits = config["auth.rate_limit"] ?? {};

    expect(limits.sign_in_sign_ups).toBeGreaterThan(30);
    expect(limits.token_verifications).toBeGreaterThan(30);
    expect(limits.email_sent).toBeGreaterThan(2);
  });
});

describe.each([
  {
    type: "invite",
    section: "auth.email.template.invite",
    subject: /invitaron/i,
  },
  {
    type: "recovery",
    section: "auth.email.template.recovery",
    subject: /contraseña/i,
  },
])("supabase/config.toml: plantilla de $type", ({ type, section, subject }) => {
  const templateConfig = config[section] ?? {};
  const contentPath = templateConfig.content_path;
  const html =
    typeof contentPath === "string" && existsSync(`${ROOT}${contentPath}`)
      ? readFileSync(`${ROOT}${contentPath}`, "utf8")
      : undefined;

  it("tiene el asunto en castellano con el nombre del producto", () => {
    expect(templateConfig.subject).toEqual(expect.stringMatching(subject));
    expect(templateConfig.subject).toContain("[NOMBRE-PRODUCTO]");
  });

  it("apunta a un archivo que existe en supabase/templates", () => {
    expect(contentPath).toBe(`./supabase/templates/${type}.html`);
    expect(
      html,
      `Falta el archivo de la plantilla ${String(contentPath)}`,
    ).toBeDefined();
  });

  it("arma el botón con /auth/confirm y el token_hash, sin ConfirmationURL", () => {
    expect(html).toContain(
      `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}`,
    );
    // Ese link se gasta con un simple GET: lo abren los antivirus por adelantado.
    expect(html).not.toContain("ConfirmationURL");
  });

  it("está escrita en castellano y nombra el producto", () => {
    expect(html).toContain("[NOMBRE-PRODUCTO]");
    expect(html).toContain("contraseña");
    expect(html).toMatch(/<html[^>]*lang="es"/);
  });
});
