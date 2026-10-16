// Entrada pública y PURA del dominio de rutas de auth: es lo único que importa
// `src/proxy.ts` (y lo que las páginas necesitan para leer su URL). No arrastra
// Next, React ni Supabase (`domain/` no puede importarlos; lo hace cumplir ESLint).

export {
  AUTH_LINKS_PREFIX,
  CALLBACK_PATH,
  CONFIRM_PATH,
  HOME_PATH,
  INVALID_LINK_PATH,
  LOGIN_PATH,
  PASSWORD_SETUP_PATH,
  RECOVERY_PATH,
} from "./domain/auth-paths";
export { firstParam } from "./domain/first-param";
export { decideAccess, routeKindOf } from "./domain/route-access";
export type {
  AccessDecision,
  AccessRequest,
  RouteKind,
} from "./domain/route-access";
export { safeNextPath } from "./domain/safe-next-path";
export { classifySession } from "./domain/session-kind";
export type { SessionKind } from "./domain/session-kind";
// Esquemas de entrada que validan las páginas (puros: solo Zod).
export { LINK_TYPES, callbackCodeSchema, linkParamsSchema } from "./schemas";
export type { LinkParams, LinkType } from "./schemas";
