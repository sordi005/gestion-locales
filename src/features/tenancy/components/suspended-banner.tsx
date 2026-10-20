import { TriangleAlertIcon } from "lucide-react";

import { PRODUCT_NAME } from "@/shared/lib/brand";

type SuspendedBannerProps = {
  organizationName: string;
};

/**
 * Aviso de organización suspendida (D10): arriba del contenido de todas las
 * pantallas del marco mientras la organización no sea `writable`. Se puede
 * consultar todo, pero no cargar nada (RN-TE-06). El texto no depende del color:
 * el ícono es decorativo y el aviso se anuncia con rol `status`.
 */
export function SuspendedBanner({ organizationName }: SuspendedBannerProps) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-l-4 border-l-destructive bg-muted px-4 py-3 text-sm text-foreground"
    >
      <TriangleAlertIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <p>
        La cuenta de {organizationName} está suspendida: podés consultar tus
        datos, pero no cargar ventas ni cambios. Para reactivarla, comunicate
        con <span translate="no">{PRODUCT_NAME}</span>.
      </p>
    </div>
  );
}
