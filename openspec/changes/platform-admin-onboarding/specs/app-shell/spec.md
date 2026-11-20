## MODIFIED Requirements

### Requirement: Contenido principal y salto en cada marco
El layout raíz SHALL conservar el enlace "Saltar al contenido" y dejar de envolver todo en `<main>`: cada marco (`AuthShell`, `AppShell`, el selector, el marco del admin `AdminShell` y las páginas de error y de "no encontrada") MUST dibujar un único `<main id="contenido">`, así la navegación del marco queda fuera del contenido principal. Las páginas que se dibujan dentro de un marco MUST NOT dibujar otro `<main>`.

#### Scenario: Un solo main por pantalla
- **WHEN** se dibujan `/login`, el inicio de un local y la página 404
- **THEN** cada una tiene exactamente un `<main id="contenido">` y el enlace "Saltar al contenido" lleva a él

#### Scenario: Un solo main en el admin
- **WHEN** se dibujan `/admin/organizaciones` y `/admin/base-de-productos`
- **THEN** cada una tiene exactamente un `<main id="contenido">`, el de `AdminShell`, y el menú del admin queda fuera de él
