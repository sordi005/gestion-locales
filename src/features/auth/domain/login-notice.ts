/** Avisos que `/login` puede mostrar arriba del formulario. */
export type LoginNotice = "password-saved" | "no-access";

/**
 * Qué aviso pide `/login?aviso=…`. Solo valores EXACTOS conocidos (el parámetro
 * viene de la URL y no es de fiar); cualquier otro no muestra nada. Un `switch`
 * y no un objeto: así `aviso=toString` o `__proto__` no encuentran nada.
 */
export function loginNoticeFromAviso(
  aviso: string | undefined,
): LoginNotice | undefined {
  switch (aviso) {
    case "contrasena-actualizada":
      return "password-saved";
    case "sin-acceso":
      return "no-access";
    default:
      return undefined;
  }
}
