// Entrada pública de los componentes de la feature tenancy, para la capa `app`
// (y otras features). Los componentes de acá adentro se importan entre sí con
// rutas relativas.

export { PlatformAdminHome } from "./components/platform-admin-home";
export { LocationPicker } from "./components/location-picker";
export type { PickerOrganization } from "./components/location-picker";
export { LocationHome } from "./components/location-home";
export { AppShell } from "./components/app-shell";
