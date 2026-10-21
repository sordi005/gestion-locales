// Una organización suspendida queda en solo lectura (RN-TE-06): sus miembros
// consultan, pero no cargan ventas ni cambios. Esta es la única definición; el
// contexto la copia a `writable` y cada Server Action de escritura la consulta
// antes de escribir (RLS ya rechaza las escrituras: `org_is_active`). Falla
// cerrado: cualquier estado que no sea `active` no se puede escribir.
export function isWritable(organizationStatus: string): boolean {
  return organizationStatus === "active";
}
