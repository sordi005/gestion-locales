import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const KB = "knowledge-base/08_arquitectura_propuesta.md";

// Reglas de capas (KB 08): app -> features -> shared.
// Con flat config, un bloque posterior que reconfigura la misma regla REEMPLAZA
// al anterior: por eso cada bloque repite los patrones heredados.
const sharedPatterns = [
  {
    group: ["@/features", "@/features/**", "**/features/**"],
    message: `Capa prohibida: "shared/" no puede importar de "features/". La dirección es app → features → shared (${KB}).`,
  },
  {
    group: ["@/app", "@/app/**", "**/app/**"],
    message: `Capa prohibida: "shared/" no puede importar de "app/". La dirección es app → features → shared (${KB}).`,
  },
];

const featuresPatterns = [
  {
    group: ["@/app", "@/app/**", "**/app/**"],
    message: `Capa prohibida: "features/" no puede importar de "app/". La dirección es app → features → shared (${KB}).`,
  },
  {
    // Cada feature usa rutas relativas para su propio interior; las demás
    // features solo se consumen por su API pública (index.ts).
    group: ["@/features/*/*"],
    message: `Una feature no importa carpetas internas de otra: usá su API pública (index.ts), por ejemplo "@/features/payments" (${KB}).`,
  },
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
    ],
    message: `"domain/" no puede importar módulos de I/O (Supabase, Next, React, IndexedDB, shared/db): la lógica de dominio es pura (${KB}).`,
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: sharedPatterns }],
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: featuresPatterns }],
    },
  },
  {
    files: ["src/features/*/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: domainPatterns }],
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
  ]),
]);

export default eslintConfig;
