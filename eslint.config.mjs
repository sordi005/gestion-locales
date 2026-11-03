import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const KB = "knowledge-base/08_arquitectura_propuesta.md";

// Reglas de capas (KB 08): app -> features -> shared.
// Con flat config, un bloque posterior que reconfigura la misma regla REEMPLAZA
// al anterior: por eso cada bloque repite los patrones heredados.
// Las cookies de sesión son `httpOnly`: el cliente de Supabase del navegador no
// las ve, así que no se usa en `src/` (el archivo y su test quedan; los usará un
// change de Realtime o C-11 si lo diseña). Cada bloque que configura
// `no-restricted-imports` lo repite (la config posterior reemplaza a la anterior).
const browserClientPattern = {
  group: ["@/shared/db/browser", "**/shared/db/browser"],
  message: `Prohibido en src/: las cookies de sesión son httpOnly y el cliente de navegador (@/shared/db/browser) no ve la sesión. Leé los datos desde el servidor (@/shared/db/server) (${KB}).`,
};

const sharedPatterns = [
  browserClientPattern,
  {
    group: ["@/features", "@/features/**", "**/features/**"],
    message: `Capa prohibida: "shared/" no puede importar de "features/". La dirección es app → features → shared (${KB}).`,
  },
  {
    group: ["@/app", "@/app/**", "**/app/**"],
    message: `Capa prohibida: "shared/" no puede importar de "app/". La dirección es app → features → shared (${KB}).`,
  },
];

// Una feature se consume por su API pública: `index.ts` ("@/features/x") o una de
// las entradas `server`, `components` y `routing` (las negaciones `!` las dejan
// pasar; el dominio, `session`, `actions`, `schemas`, `queries` y todo archivo
// interno siguen prohibidos). Además hay entradas PUNTUALES, una por feature que
// las necesita (nunca un comodín `*`: abriría `cache` y `logout-cleanup` en todas):
// - `@/features/catalog/cache`: la entrada cliente de la caché local del catálogo
//   (C-11), solo el provider y el hook. La usan la capa `app` y otras features (la
//   venta lee el hook).
const featureInteriorGroup = [
  "@/features/*/**",
  "!@/features/*/server",
  "!@/features/*/components",
  "!@/features/*/routing",
  "!@/features/catalog/cache",
];

// Las entradas de limpieza al cerrar sesión son SOLO de la capa `app`: la única que
// las consume es `src/app/logout-cleanups.tsx`, el punto de registro. Una feature no
// las importa (su `login-form` y su botón usan rutas relativas dentro de `auth`).
// - `@/features/auth/logout-cleanup`: el contrato de limpieza (C-05).
// - `@/features/catalog/logout-cleanup`: la limpieza de la caché del catálogo,
//   angosta a propósito (se carga en TODAS las páginas).
const appFeatureInteriorGroup = [
  ...featureInteriorGroup,
  "!@/features/auth/logout-cleanup",
  "!@/features/catalog/logout-cleanup",
];

// Los alias (`@/features/...`) son la única forma de llegar a otra capa: una ruta
// relativa que pase por `features/` esquivaría la regla del interior.
const relativeIntoFeaturesPattern = {
  group: ["../**/features/**"],
  message: `Importá features con el alias "@/features/..." (su API pública), no con una ruta relativa que pase por features/ (${KB}).`,
};

const featuresPatterns = [
  browserClientPattern,
  {
    group: ["@/app", "@/app/**", "**/app/**"],
    message: `Capa prohibida: "features/" no puede importar de "app/". La dirección es app → features → shared (${KB}).`,
  },
  {
    // Cada feature usa rutas relativas para su propio interior; las demás
    // features solo se consumen por su API pública.
    group: featureInteriorGroup,
    message: `Una feature no importa el interior de otra: usá su API pública (index.ts, o las entradas server, components y routing), por ejemplo "@/features/payments" o "@/features/auth/server" (${KB}).`,
  },
  relativeIntoFeaturesPattern,
];

// Los tests de una feature pueden ejercitar el contrato de limpieza al cerrar
// sesión de verdad (registrar su tarea y correr `runLogoutCleanups`), como lo hace
// la capa `app` en producción. El resto de las reglas de features sigue igual.
const featuresTestPatterns = featuresPatterns.map((pattern) =>
  pattern.group === featureInteriorGroup
    ? { ...pattern, group: appFeatureInteriorGroup }
    : pattern,
);

const appPatterns = [
  browserClientPattern,
  {
    group: appFeatureInteriorGroup,
    message: `La capa "app/" usa cada feature por su API pública (index.ts, o las entradas server, components y routing), no por su interior: por ejemplo "@/features/auth/server" y no "@/features/auth/session". Si falta un símbolo, exportalo desde la entrada pública que corresponda (${KB}).`,
  },
  relativeIntoFeaturesPattern,
];

const domainPatterns = [
  ...featuresPatterns,
  {
    group: [
      "@supabase/*",
      "next",
      "next/*",
      "react",
      "react-dom",
      "react-dom/*",
      "@/shared/db",
      "@/shared/db/*",
      "dexie",
      "idb",
      "server-only",
    ],
    message: `"domain/" no puede importar módulos de I/O ni "server-only" (Supabase, Next, React, IndexedDB, shared/db): la lógica de dominio es pura y se puede importar desde cualquier lado (${KB}).`,
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // Los bloques de abajo (shared, features, domain) reemplazan esta regla
      // con sus propias listas, que ya incluyen el cliente de navegador.
      "no-restricted-imports": ["error", { patterns: [browserClientPattern] }],
    },
  },
  {
    // `getSession()` lee la cookie sin verificarla (regla dura 6). El test de
    // texto `tests/tooling/get-session-usage` cubre las llamadas directas (y los
    // archivos que ESLint ignora); esto cubre el acceso como propiedad y la
    // desestructuración. Los tests quedan afuera: simulan el cliente con un
    // `getSession` que no debe usarse.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/__tests__/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='getSession']",
          message:
            "auth.getSession() lee la cookie sin verificarla (regla dura 6): usá getClaims() o getUser() en el servidor.",
        },
        {
          selector:
            "MemberExpression[computed=true][property.value='getSession']",
          message:
            "auth.getSession() lee la cookie sin verificarla (regla dura 6): usá getClaims() o getUser() en el servidor.",
        },
        {
          selector: "ObjectPattern > Property[key.name='getSession']",
          message:
            "Desestructurar getSession lo esconde del test de texto y lee la cookie sin verificarla (regla dura 6): usá getClaims() o getUser() en el servidor.",
        },
      ],
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: sharedPatterns }],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: appPatterns }],
    },
  },
  {
    // Los tests de `app` simulan módulos internos de las features
    // (`vi.mock("@/features/auth/actions")`) y usan sus fixtures: solo el
    // cliente de navegador sigue prohibido.
    files: ["src/app/**/__tests__/**", "src/app/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [browserClientPattern] }],
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: featuresPatterns }],
    },
  },
  {
    files: ["src/features/**/__tests__/**", "src/features/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: featuresTestPatterns }],
    },
  },
  {
    // Cualquier `domain/` dentro de una feature, también el de una subcarpeta
    // (`src/features/catalog/cache/domain`).
    files: ["src/features/**/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: domainPatterns }],
    },
  },
  {
    // El test del propio cliente de navegador lo importa a propósito.
    files: ["src/shared/db/__tests__/browser.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: sharedPatterns.filter((p) => p !== browserClientPattern) },
      ],
    },
  },
  // Prettier va al final: apaga las reglas de estilo que chocarían con el formateo.
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generado por `pnpm db:types` (supabase gen types): no se edita ni se lintea.
    "src/shared/db/types.ts",
  ]),
]);

export default eslintConfig;
