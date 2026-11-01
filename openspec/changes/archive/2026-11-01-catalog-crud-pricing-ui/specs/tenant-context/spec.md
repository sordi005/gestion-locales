## ADDED Requirements

### Requirement: 404 uniforme en el área de organización
El 404 de `requireOrgContext` SHALL responder con estado HTTP 404 real en todas las rutas de `/org/[orgId]/**`: ningún `loading.tsx` MUST envolver ese segmento (ni en él, ni en un ancestro como `org/`, `(app)/` o la raíz, ni en un descendiente), porque con streaming un `notFound()` lanzado después del primer byte responde 200. El test de tooling que hoy vigila `/l/[locationId]` MUST cubrir también `/org/[orgId]`. Una organización ajena, una inexistente, un id mal formado y un rol que no alcanza MUST dar la misma respuesta.

#### Scenario: Sin loading en el área de organización
- **WHEN** corre el test de tooling de segmentos sin `loading`
- **THEN** falla si aparece un `loading.tsx` en `src/app/(app)/org/[orgId]/**`, en `org/`, en `(app)/` o en la raíz

#### Scenario: Mismo 404 para todo lo que no es propio
- **WHEN** `owner.norte@demo.test` abre `/org/<Almacén Demo Sur>/catalogo`, `/org/<uuid inexistente>/catalogo` y `/org/no-es-uuid/catalogo`, y `employee.norte@demo.test` abre `/org/<Kiosco Demo Norte>/catalogo`
- **THEN** las cuatro respuestas tienen estado 404 y el mismo contenido
