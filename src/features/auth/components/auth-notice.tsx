import { Alert, AlertDescription } from "@/shared/ui/alert";

const NOTICES = {
  // Error: el link del email no se pudo usar (US-003). Se anuncia de inmediato.
  "link-invalid": {
    role: "alert",
    text: "El link venció o ya se usó. Escribí tu email y te mandamos uno nuevo.",
  },
  // Estado: no es un error, así que no interrumpe al lector de pantalla.
  "password-saved": {
    role: "status",
    text: "Listo, guardamos tu contraseña. Ingresá con la nueva.",
  },
} as const;

/** Avisos que llegan por la URL (`?error=link`, `?aviso=contrasena-actualizada`). */
export type PageNoticeKind = keyof typeof NOTICES;

type AuthNoticeProps =
  | { kind: PageNoticeKind }
  // El texto del "link mandado" lo decide el servidor (siempre el mismo, exista o
  // no la cuenta): acá solo se muestra.
  | { kind: "reset-sent"; message: string };

/**
 * Único aviso de las pantallas de auth: "link inválido", "contraseña guardada" y
 * "link mandado". Los errores usan `role="alert"` y los estados `role="status"`.
 */
export function AuthNotice(props: AuthNoticeProps) {
  if (props.kind === "reset-sent") {
    return (
      <Alert role="status">
        <AlertDescription>{props.message}</AlertDescription>
      </Alert>
    );
  }

  const { role, text } = NOTICES[props.kind];
  return (
    <Alert role={role}>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}
