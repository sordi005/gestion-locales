import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

import ts from "typescript";

/**
 * Buscador puro de la convención de guardas (D13.1): cada página, layout,
 * template, `default`, Route Handler y cada función exportada de un archivo
 * `"use server"` verifica la identidad en el servidor con una guarda conocida,
 * independientemente del proxy. Usa la API del compilador de TypeScript (ya
 * instalada), así que entiende alias de import, `export const x = async () => ...`
 * y `export { a as b }`, que un buscador de texto no ve.
 *
 * Reglas:
 * - Página, layout, template o `default` (`src/app/**`): la guarda se llama en el
 *   cuerpo del `export default` (no en `generateMetadata`, ni en un auxiliar, ni
 *   en una función anidada). Route Handler (`route.ts`): CADA método HTTP
 *   exportado la llama en SU cuerpo.
 * - Archivo con `"use server"` arriba: CADA función exportada llama a una guarda
 *   en SU cuerpo. Un export que no se puede auditar (re-export, valor que no es
 *   una función) también es un hallazgo.
 * - Una guarda solo cuenta si se importa de `@/features/auth/server` o de
 *   `@/features/tenancy/server` (o de esos mismos módulos por ruta relativa
 *   desde dentro de la feature): una función local o de otro módulo con el mismo
 *   nombre no es una guarda.
 * - Bajo `/l/[locationId]/**` la guarda tiene que ser `requireLocationContext` o
 *   `requireLocationRole`; bajo `/org/[orgId]/**`, `requireOrgContext` (una guarda
 *   general como `requireUser` no valida el id de la URL).
 * - `"use server"` dentro de una función (acciones en línea) está prohibido en
 *   todo `src/`: difíciles de auditar.
 * - Las excepciones (rutas y marcos públicos, acciones sin sesión) viven en una
 *   lista con su motivo; una excepción que ya no existe, o sin motivo, es un
 *   hallazgo.
 */

/** Guardas conocidas: auth (C-05) y tenancy (C-06, D3). */
export const GUARD_NAMES: ReadonlySet<string> = new Set([
  "requireUser",
  "requirePasswordSetup",
  "getTenantContext",
  "requireLocationContext",
  "requireLocationRole",
  "requireOrgContext",
  "requirePlatformAdmin",
]);

/** Módulos de los que se importan las guardas (sin extensión, desde la raíz del repo). */
const GUARD_MODULES: ReadonlySet<string> = new Set([
  "src/features/auth/server",
  "src/features/tenancy/server",
]);

const LOCATION_GUARDS: ReadonlySet<string> = new Set([
  "requireLocationContext",
  "requireLocationRole",
]);
const ORG_GUARDS: ReadonlySet<string> = new Set(["requireOrgContext"]);

const HTTP_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
]);

const LOCATION_TREE = /(?:^|\/)src\/app\/(?:.+\/)?l\/\[locationId\](?:\/|$)/;
const ORG_TREE = /(?:^|\/)src\/app\/(?:.+\/)?org\/\[orgId\](?:\/|$)/;

/**
 * Las guardas que valen en `file`: bajo `/l/[locationId]/` las del local, bajo
 * `/org/[orgId]/` la de la organización y en el resto cualquiera de las conocidas.
 */
export function requiredGuardsFor(file: string): ReadonlySet<string> {
  const path = file.replaceAll("\\", "/");
  if (LOCATION_TREE.test(path)) return LOCATION_GUARDS;
  if (ORG_TREE.test(path)) return ORG_GUARDS;
  return GUARD_NAMES;
}

export type GuardFinding = {
  /** Ruta del archivo, tal como se la pasó al buscador. */
  file: string;
  /** Nombre del export (`default`, `*` para un re-export total); sin valor si es el módulo entero. */
  export?: string;
  message: string;
};

export type SourceInput = { file: string; source: string };

/** `archivo` o `archivo#export`, seguido de dos espacios y el motivo. */
export function describeFinding(finding: GuardFinding): string {
  const target =
    finding.export === undefined
      ? finding.file
      : `${finding.file}#${finding.export}`;
  return `${target}  ${finding.message}`;
}

function parse(source: string, file: string): ts.SourceFile {
  const kind = file.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : file.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : file.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

/** ¿El texto empieza (como directiva) con `"use server"`? Solo el prólogo cuenta. */
function hasUseServerDirective(statements: readonly ts.Statement[]): boolean {
  for (const statement of statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

export function isUseServerFile(source: string, file: string): boolean {
  return hasUseServerDirective(parse(source, file).statements);
}

type Imports = {
  /** Nombre local → guarda original (`import { requireUser as ru }` → `ru` → `requireUser`). */
  guards: Map<string, string>;
  /** Nombres locales de `import * as ns`: `ns.requireUser()` cuenta. */
  namespaces: Set<string>;
};

/** Ruta del módulo importado desde la raíz del repo, sin extensión (`null` si es un paquete). */
function resolveModule(specifier: string, file: string): string | null {
  const withoutExtension = (path: string) => path.replace(/\.tsx?$/, "");
  if (specifier.startsWith("@/")) {
    return withoutExtension(`src/${specifier.slice(2)}`);
  }
  if (specifier.startsWith(".")) {
    const dir = posix.dirname(file.replaceAll("\\", "/"));
    return withoutExtension(posix.normalize(posix.join(dir, specifier)));
  }
  return null;
}

function readImports(sf: ts.SourceFile, file: string): Imports {
  const guards = new Map<string, string>();
  const namespaces = new Set<string>();

  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const resolved = resolveModule(statement.moduleSpecifier.text, file);
    if (resolved === null || !GUARD_MODULES.has(resolved)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;

    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const original = (element.propertyName ?? element.name).text;
      if (GUARD_NAMES.has(original)) guards.set(element.name.text, original);
    }
  }

  return { guards, namespaces };
}

function bindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNames(element.name, into);
  }
}

/**
 * Nombres que la función declara por su cuenta (parámetros, variables y
 * funciones internas): si uno coincide con el de una guarda importada, la
 * tapa y la llamada ya no es a la guarda.
 */
function declaredInside(fn: ts.SignatureDeclaration): Set<string> {
  const names = new Set<string>();
  for (const parameter of fn.parameters) bindingNames(parameter.name, names);

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) bindingNames(node.name, names);
    if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  const body = (fn as { body?: ts.Node }).body;
  if (body) visit(body);
  return names;
}

function isGuardCall(
  call: ts.CallExpression,
  imports: Imports,
  shadowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
): boolean {
  let callee: ts.Expression = call.expression;
  while (
    ts.isParenthesizedExpression(callee) ||
    ts.isNonNullExpression(callee)
  ) {
    callee = callee.expression;
  }

  if (ts.isIdentifier(callee)) {
    const original = imports.guards.get(callee.text);
    return (
      original !== undefined &&
      required.has(original) &&
      !shadowed.has(callee.text)
    );
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression)
  ) {
    return (
      imports.namespaces.has(callee.expression.text) &&
      !shadowed.has(callee.expression.text) &&
      required.has(callee.name.text)
    );
  }
  return false;
}

/** ¿Hay una llamada a una guarda bajo `root`? Con `intoFunctions: false` no entra a funciones anidadas. */
function containsGuardCall(
  root: ts.Node,
  imports: Imports,
  shadowed: ReadonlySet<string>,
  intoFunctions: boolean,
  required: ReadonlySet<string>,
): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (!intoFunctions && node !== root && ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      isGuardCall(node, imports, shadowed, required)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

type FunctionNode =
  ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function asFunction(
  expression: ts.Expression | undefined,
): FunctionNode | null {
  if (expression === undefined) return null;
  const inner = unwrap(expression);
  return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)
    ? inner
    : null;
}

type ExportedItem =
  { name: string; fn: FunctionNode } | { name: string; problem: string };

const NOT_AUDITABLE =
  "export que no se puede auditar: tiene que ser una función declarada en este archivo (sin re-exports ni valores)";

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
  );
}

/** Todo lo que el archivo exporta como valor (los tipos no cuentan). */
function listExports(sf: ts.SourceFile): ExportedItem[] {
  // Funciones y valores del nivel superior, para resolver `export { a as b }`.
  const localFunctions = new Map<string, FunctionNode>();
  const localValues = new Set<string>();
  for (const statement of sf.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      statement.body
    ) {
      localFunctions.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const fn = asFunction(declaration.initializer);
        if (fn) localFunctions.set(declaration.name.text, fn);
        else localValues.add(declaration.name.text);
      }
    }
  }

  const items: ExportedItem[] = [];
  const isExported = (node: ts.Node) =>
    hasModifier(node, ts.SyntaxKind.ExportKeyword);
  const isDefault = (node: ts.Node) =>
    hasModifier(node, ts.SyntaxKind.DefaultKeyword);

  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      // Las firmas de sobrecarga no tienen cuerpo: las cubre la implementación.
      if (!isExported(statement) || !statement.body) continue;
      items.push({
        name: isDefault(statement)
          ? "default"
          : (statement.name?.text ?? "default"),
        fn: statement,
      });
    } else if (ts.isVariableStatement(statement)) {
      if (!isExported(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const fn = asFunction(declaration.initializer);
        const name = ts.isIdentifier(declaration.name)
          ? declaration.name.text
          : declaration.name.getText(sf);
        items.push(fn ? { name, fn } : { name, problem: NOT_AUDITABLE });
      }
    } else if (ts.isExportAssignment(statement)) {
      const target = unwrap(statement.expression);
      const fn = asFunction(target);
      const named = ts.isIdentifier(target)
        ? localFunctions.get(target.text)
        : undefined;
      const resolved = fn ?? named;
      items.push(
        resolved
          ? { name: "default", fn: resolved }
          : { name: "default", problem: NOT_AUDITABLE },
      );
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;

      if (statement.moduleSpecifier !== undefined) {
        if (clause !== undefined && ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            if (element.isTypeOnly) continue;
            items.push({ name: element.name.text, problem: NOT_AUDITABLE });
          }
        } else {
          items.push({ name: "*", problem: NOT_AUDITABLE });
        }
        continue;
      }

      if (clause === undefined || !ts.isNamedExports(clause)) continue;
      for (const element of clause.elements) {
        if (element.isTypeOnly) continue;
        const localName = (element.propertyName ?? element.name).text;
        const fn = localFunctions.get(localName);
        if (fn) {
          items.push({ name: element.name.text, fn });
        } else if (localValues.has(localName)) {
          items.push({ name: element.name.text, problem: NOT_AUDITABLE });
        }
        // Lo que no es ni función ni valor del archivo es un tipo: no cuenta.
      }
    }
  }

  return items;
}

function guardList(required: ReadonlySet<string>): string {
  return [...required].join(" o ");
}

/**
 * Páginas, layouts, templates, `default` y Route Handlers (`src/app/**`): la
 * guarda se llama en el cuerpo del `export default`, o en el de CADA método HTTP
 * exportado si es un `route.*`. Los hallazgos son del archivo (sin `export`): la
 * excepción de una ruta es de todo el archivo.
 */
export function checkRouteModule(source: string, file: string): GuardFinding[] {
  const sf = parse(source, file);
  const imports = readImports(sf, file);
  const required = requiredGuardsFor(file);
  const list = guardList(required);
  const isHandler = /(?:^|\/)route\.[jt]sx?$/.test(file);

  const targets = listExports(sf).filter((item) =>
    isHandler ? HTTP_METHODS.has(item.name) : item.name === "default",
  );
  if (targets.length === 0) {
    return [
      {
        file,
        message: isHandler
          ? `no exporta ningún método HTTP (${[...HTTP_METHODS].join(", ")}) auditable: un Route Handler protegido llama a una guarda (${list}) en cada método`
          : `no tiene un export default auditable: una ruta protegida llama a una guarda (${list}) en el cuerpo de su export default; si es pública, agregala a las excepciones con su motivo`,
      },
    ];
  }

  const findings: GuardFinding[] = [];
  for (const item of targets) {
    const label = isHandler ? `el método ${item.name}` : "el export default";
    if ("problem" in item) {
      findings.push({ file, message: `${label}: ${item.problem}` });
      continue;
    }
    const body = item.fn.body;
    const guarded =
      body !== undefined &&
      containsGuardCall(
        body,
        imports,
        declaredInside(item.fn),
        false,
        required,
      );
    if (!guarded) {
      findings.push({
        file,
        message: `${label} no llama a ninguna guarda (${list}) en su propio cuerpo (una llamada en generateMetadata, en un auxiliar o en una función anidada no cuenta); si es público, agregalo a las excepciones con su motivo`,
      });
    }
  }
  return findings;
}

/** Nombres de todo lo que exporta un archivo `"use server"` (vacío si no lo es). */
export function listServerActionExports(
  source: string,
  file: string,
): string[] {
  const sf = parse(source, file);
  if (!hasUseServerDirective(sf.statements)) return [];
  return listExports(sf).map((item) => item.name);
}

/** Archivos con `"use server"`: cada función exportada llama a una guarda en SU cuerpo. */
export function checkServerActionsFile(
  source: string,
  file: string,
): GuardFinding[] {
  const sf = parse(source, file);
  if (!hasUseServerDirective(sf.statements)) return [];

  const imports = readImports(sf, file);
  const required = requiredGuardsFor(file);
  const findings: GuardFinding[] = [];

  for (const item of listExports(sf)) {
    if ("problem" in item) {
      findings.push({ file, export: item.name, message: item.problem });
      continue;
    }
    const body = item.fn.body;
    const guarded =
      body !== undefined &&
      containsGuardCall(
        body,
        imports,
        declaredInside(item.fn),
        false,
        required,
      );
    if (!guarded) {
      findings.push({
        file,
        export: item.name,
        message: `la acción exportada no llama a ninguna guarda (${guardList(required)}) en su propio cuerpo; si no necesita sesión, agregala a las excepciones con su motivo`,
      });
    }
  }

  return findings;
}

/** `"use server"` dentro de una función (acciones en línea): prohibido en todo `src/`. */
export function findInlineUseServer(
  source: string,
  file: string,
): GuardFinding[] {
  const sf = parse(source, file);
  const findings: GuardFinding[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionLike(node) &&
      (node as { body?: ts.Node }).body !== undefined
    ) {
      const body = (node as { body: ts.Node }).body;
      if (ts.isBlock(body) && hasUseServerDirective(body.statements)) {
        const { line } = sf.getLineAndCharacterOfPosition(body.getStart(sf));
        findings.push({
          file,
          message: `"use server" dentro de una función (línea ${line + 1}): las acciones en línea son difíciles de auditar; movela a un archivo "use server" con la guarda en su cuerpo`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return findings;
}

function isRouteFile(file: string): boolean {
  return /(?:^|\/)src\/app\/(?:.+\/)?(?:page|route|layout|template|default)\.(?:tsx?|jsx?)$/.test(
    file,
  );
}

/**
 * Recorre los archivos y devuelve los hallazgos. `exceptions` va de
 * `archivo` (página, layout, template, default o handler) o `archivo#export` (acción) a su motivo; una
 * excepción cuyo blanco ya no existe, o sin motivo, es un hallazgo. Las acciones
 * en línea no se pueden exceptuar.
 */
export function auditRouteGuards(
  files: readonly SourceInput[],
  exceptions: Readonly<Record<string, string>>,
): GuardFinding[] {
  const findings: GuardFinding[] = [];
  const targets = new Set<string>();
  const isExcepted = (key: string) => Object.hasOwn(exceptions, key);

  for (const { file, source } of files) {
    findings.push(...findInlineUseServer(source, file));

    if (isRouteFile(file)) {
      targets.add(file);
      if (!isExcepted(file)) findings.push(...checkRouteModule(source, file));
    }

    for (const name of listServerActionExports(source, file)) {
      targets.add(`${file}#${name}`);
    }
    for (const finding of checkServerActionsFile(source, file)) {
      const key = `${finding.file}#${finding.export ?? ""}`;
      if (!isExcepted(key)) findings.push(finding);
    }
  }

  for (const [key, reason] of Object.entries(exceptions)) {
    const [file = key, exported] = key.split("#");
    if (!targets.has(key)) {
      findings.push({
        file,
        export: exported,
        message:
          "excepción que ya no existe: borrala de la lista (la página, el handler o la acción cambió o se eliminó)",
      });
    } else if (reason.trim() === "") {
      findings.push({
        file,
        export: exported,
        message:
          "excepción sin motivo: toda excepción explica por qué no lleva guarda",
      });
    }
  }

  return findings;
}

/** Los `.ts` y `.tsx` de `dir` (relativo a `root`), sin tests; rutas con `/` y prefijo `dir`. */
export function readSourceFiles(root: string, dir: string): SourceInput[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
    .map((name) => name.replaceAll("\\", "/"))
    .filter(
      (name) =>
        /\.tsx?$/.test(name) &&
        !/(?:^|\/)__tests__\//.test(name) &&
        !/\.test\.tsx?$/.test(name),
    )
    .filter((name) => statSync(join(root, dir, name)).isFile())
    .sort()
    .map((name) => ({
      file: `${dir}/${name}`,
      source: readFileSync(join(root, dir, name), "utf8"),
    }));
}
