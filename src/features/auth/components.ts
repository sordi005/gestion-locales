// Entrada pública de los componentes de la feature auth, para la capa `app`.
// Los componentes de acá adentro se importan entre sí con rutas relativas.

// Server Action de cierre de sesión: para los formularios de las pantallas que no
// usan `LogoutButton` (por ejemplo la pantalla de error de la app).
export { logout } from "./actions";
export { AuthShell } from "./components/auth-shell";
export { ConfirmLinkForm } from "./components/confirm-link-form";
export { LoginForm } from "./components/login-form";
export { LogoutButton } from "./components/logout-button";
export { RecoveryForm } from "./components/recovery-form";
export { UpdatePasswordForm } from "./components/update-password-form";
