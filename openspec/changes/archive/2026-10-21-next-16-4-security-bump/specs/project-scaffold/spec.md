## ADDED Requirements

### Requirement: Piso de versión de Next.js por seguridad
El proyecto SHALL usar una versión instalada de `next` igual o mayor al piso de seguridad vigente, hoy `16.4.1` (la primera que corrige GHSA-p3m5-59mp-jv5r, GHSA-673q-mjm6-r5xr y GHSA-2464-fhr4-w9xw). `eslint-config-next` MUST estar instalado en la misma versión que `next`. Un test de Vitest MUST verificar ambas condiciones leyendo las versiones instaladas, de modo que `pnpm test` falle si alguna no se cumple. El piso se sube cuando aparezcan nuevos avisos de seguridad de Next.js.

#### Scenario: Versión instalada por debajo del piso
- **WHEN** la versión instalada de `next` es menor que `16.4.1` (por ejemplo, `16.3.8`)
- **THEN** `pnpm test` falla con un mensaje que indica la versión instalada y el piso requerido

#### Scenario: Versiones de `next` y `eslint-config-next` desparejas
- **WHEN** la versión instalada de `eslint-config-next` no es igual a la de `next`
- **THEN** `pnpm test` falla con un mensaje que muestra ambas versiones

#### Scenario: Instalación actual en o por encima del piso
- **WHEN** `next` y `eslint-config-next` están instalados en `16.4.2`
- **THEN** el test de piso de versión pasa y `pnpm test` termina con código 0
