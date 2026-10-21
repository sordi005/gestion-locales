// Entrada pública del lado servidor de la feature auth (RSC, Server Actions y
// Route Handlers). Para la tabla de rutas pura que usa el proxy, ver `routing.ts`.
export { getAuthState, requirePasswordSetup, requireUser } from "./session";
export { signOutThisDevice } from "./sign-out";
export type { AuthState, AuthUser } from "./session";
