# 03 — Actores y Roles

> Los actores salen del relevamiento del pivot. La matriz RBAC es una **propuesta de la KB**: las celdas no confirmadas se marcan con **Suposición:** y se validan con los pilotos (PQ-05, PQ-07).

## Actores del sistema

| Actor | Rol técnico | Alcance | Descripción | Cómo interactúa |
|---|---|---|---|---|
| Super-admin de plataforma | `platform_admin` (tabla aparte, no es un rol de organización) | Toda la plataforma | El fundador. Da de alta comercios, locales y usuarios; importa el catálogo en la visita de configuración; da soporte. | Panel `/admin` desde PC o celular. |
| Dueño del comercio | `owner` | Su organización y todos sus locales | Decide, ve estadísticas, actualiza precios, controla caja y anulaciones. En un kiosco chico **muchas veces también atiende** el mostrador. | Celular (remoto) y PC del mostrador. |
| Encargado/a | `manager` | Los locales asignados | Opera el local: caja, compras, vencimientos, conteos, anulaciones. | PC del mostrador y celular. |
| Empleado / cajero | `employee` | Los locales asignados | Cobra, abre y cierra la caja de su turno, registra gastos, mermas, compras y líneas de conteo. | PC con lector USB o celular con cámara. |
| Cliente final | Ninguno (no es usuario) | — | Compra en el mostrador. Recibe el comprobante interno *"no válido como factura"* si lo pide. | Indirecta. |
| Mercado Pago / banco / posnet | Sistemas externos (sin integración en la Etapa 0) | — | Por donde entran los cobros electrónicos. El cajero marca el medio a mano y controla los totales por fuera. | Indirecta: control manual con los totales por medio (RN-CJ-10). |

**Suposición:** hay más de un turno y, a veces, más de un empleado por local; el número exacto se releva en cada piloto (PQ-05).
**Suposición:** cada persona tiene su **usuario individual** (email + contraseña) para que cada venta, anulación y arqueo quede trazable (RN-AU-02). El cambio rápido de usuario con PIN en la PC compartida es candidato para la Etapa 1 (PQ-05).

## Modelo de pertenencia

```
auth.users ──1:N── memberships (organization_id, role) ──N:M── locations (membership_locations)
auth.users ──1:0..1── platform_admins
```

- El rol se asigna **por organización**. Un usuario puede pertenecer a más de una organización con roles distintos (raro, pero el modelo lo soporta sin costo).
- `owner` accede a **todos** los locales de su organización. `manager` y `employee` acceden solo a los locales asignados en `membership_locations`.
- `platform_admin` **no** es una membresía: no aparece en la lista de usuarios del cliente y sus escrituras quedan auditadas (RN-AU-05).
- Una membresía con `status = disabled` pierde el acceso de inmediato, porque RLS la evalúa en cada consulta (RN-AU-04).

## RBAC — Matriz de permisos

Leyenda: **C** crear · **R** leer · **U** editar · **A** anular/desactivar · **X** ejecutar acción · **—** sin acceso. Para `manager` y `employee`, el alcance siempre se limita a sus locales.

| Recurso | platform_admin | owner | manager | employee |
|---|---|---|---|---|
| Organizaciones (configuración) | C R U A (suspender) | R U | R | R (solo el nombre) |
| Locales | C R U A | R U | R | R |
| Usuarios y membresías | C R U A | R (Etapa 0). **Suposición:** C U A en la Etapa 1 | R (su local) | — |
| Productos y códigos de barras | R | C R U A | C R U A | C R (alta rápida con precio, RN-CA-05). **Suposición:** sin U |
| Categorías | R | C R U A | C R U | R |
| Botones de venta rápida | R | C R U A | C R U A | R |
| Precio de venta individual | R | U | U | **Suposición:** U solo si el producto no tiene precio (RN-PC-01) |
| Actualización masiva de precios | R | X (aplicar, revertir) | **Suposición:** X | — |
| Historial de precios | R | R | R | — |
| Costos (último y de referencia) | R | R U | R U | **Suposición:** C al cargar una compra; sin lectura agregada |
| Proveedores | R | C R U A | C R U | C R (alta rápida) |
| **Ventas** | R | C R A | C R A | C R (las de su local). A: **Suposición:** solo las propias, de la sesión abierta y dentro de la ventana de anulación (RN-VT-09, PQ-07) |
| Precio de línea modificado en el carrito | — | X | X | **Suposición:** — (PQ-11) |
| **Medios de pago** (configuración) | R | C R U A | R | R (al cobrar) |
| Pagos de una venta | R | C R (con la venta) | C R | C R |
| **Sesiones de caja**: abrir / cerrar con arqueo | R | X | X | X |
| Sesiones de caja: cierre sin arqueo (forzado) | R | X | X | — |
| Diferencia del arqueo | R | R | R | **Suposición:** R después de cerrar (arqueo ciego, RN-CJ-08, PQ-15) |
| **Movimientos de caja** (gasto, pago a proveedor, retiro, aporte) | R | C R A | C R A | C R. **Suposición:** sin A |
| Compras (ingresos) | R | C R A | C R A | C R. **Suposición:** anula solo su propio borrador |
| Lotes y acciones sobre alertas | R | R X | R X | R X |
| Mermas | R | C R A | C R A | C R |
| Conteos: abrir y cerrar | R | X | X | **Suposición:** — (solo verificaciones de lote) |
| Conteos: cargar líneas | R | C | C | C |
| Stock (consulta) | R | R | R | R (cantidad, sin valorizar) |
| Importación de catálogo | R X (soporte, onboarding) | C R X A | C R X A | — |
| Plantillas de mapeo | C R U A (presets globales) | C R U | C R U | — |
| **Estadísticas** | R (métricas de uso) | R (todos los locales) | **Suposición:** R (sus locales) | **Suposición:** — salvo los totales de su sesión de caja (RN-ES-11) |
| Control (anulaciones, diferencias, precios modificados) | R | R | **Suposición:** R (sus locales) | — |
| Auditoría | R | **Suposición:** R (su organización) | — | — |

**Notas:**
- La matriz se implementa **dos veces**: con políticas RLS en la base (la frontera real) y con guardas en Server Actions y en la UI (para UX y mensajes claros). Si una difiere de la otra, es un bug (RN-TE-02).
- "Anular" nunca borra físicamente: marca el documento como anulado con motivo, usuario y fecha (RN-GL-04).
- Las acciones de soporte del `platform_admin` que escriben datos de un cliente se registran en `audit_events`.
- En un kiosco donde el dueño atiende el mostrador, el `owner` usa la misma pantalla de venta que el `employee`.

## Rutas públicas (sin autenticación)

| Ruta | Propósito |
|---|---|
| `/login` | Ingreso con email y contraseña |
| `/recuperar-contrasena` | Pedido de email de recupero |
| `/auth/callback` | Intercambio de código de Supabase Auth (Route Handler) |
| `/auth/confirm` | Confirmación de invitación y de recupero (token hash) |
| `/actualizar-contrasena` | Definir contraseña tras una invitación o recupero (requiere sesión temporal válida) |
| `/manifest.webmanifest`, `/sw.js`, íconos | Activos de la PWA |

No hay landing, registro público ni páginas legales en la Etapa 0. Los términos de uso y la política de privacidad son requisito antes de cobrar (PQ-18).

## Rutas protegidas (propuesta)

| Prefijo | Quién | Contenido |
|---|---|---|
| `/l/[locationId]/vender` | Miembros del local | **Pantalla de venta** (POS). Inicio para `employee`; si no hay caja abierta, lleva a abrirla |
| `/l/[locationId]/caja` | Miembros del local | Sesión actual, movimientos, cierre con arqueo, historial de cajas |
| `/l/[locationId]/ventas` | Miembros del local | Historial de ventas y anulación |
| `/l/[locationId]/{vencimientos,compras,mermas,conteos,stock}` | Miembros del local | Operación de stock y vencimientos |
| `/org/{catalogo,precios,proveedores,medios-de-pago,importaciones,configuracion}` | `owner` (y `manager` según la matriz) | Catálogo, precios, configuración |
| `/org/estadisticas` | `owner` (y `manager` en sus locales) | Estadísticas y control. Inicio sugerido para `owner` en el celular |
| `/admin/…` | `platform_admin` | Organizaciones, locales, usuarios, presets de importación, uso de los pilotos, auditoría |

**Suposición:** el local activo va en la URL (no en una cookie) para que los links sean compartibles y funcionen varias pestañas a la vez (DD-24).
