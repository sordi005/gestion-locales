"use client";

// Punto único donde cada feature registra la limpieza de sus datos locales al
// cerrar sesión (D10). Vive en la capa `app` porque es la única que puede
// importar de varias features, y el layout raíz lo monta en TODAS las páginas,
// así que las tareas existen también en una carga fresca de `/login` (a donde
// vuelve la persona cuando se le venció la sesión).
//
// Vacío en C-05 y en C-06. Cada change que guarda datos en el navegador suma su
// línea al lado de este comentario:
//
//   import { registerLogoutCleanup } from "@/features/auth/logout-cleanup";
//   import { clearOfflineCache } from "@/features/offline";
//
//   registerLogoutCleanup("offline-cache", clearOfflineCache);
//
// - C-06: NO registra nada, a propósito: el local activo va en la URL (`/l/<id>`,
//   DD-24), el rol y el contexto se leen del servidor en cada pedido, y el marco
//   (`AppShell`) no guarda estado en el navegador (sin cookie ni `localStorage`
//   del menú lateral: ver `shared/ui/sidebar.tsx`). No hay nada que limpiar.
// - C-11: la base local de IndexedDB (catálogo en caché y cola de ventas).
// - C-19: el carrito y el borrador de la venta en curso.
//
// El nombre identifica la tarea: registrar el mismo nombre dos veces deja solo la
// última (el recargado en caliente no la duplica). Cada tarea tiene un tope de 3
// segundos; una que falla o se cuelga no frena a las demás ni el cierre de sesión.

/** No dibuja nada: existe para que este módulo se cargue en todas las páginas. */
export function LogoutCleanups() {
  return null;
}
