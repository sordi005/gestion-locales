# 08 — Arquitectura Propuesta

> El stack (Next.js App Router + TypeScript + Supabase + Vercel), el multi-tenant con RLS, la PWA para celular y PC y el Strict TDD con OpenSpec están **decididos**. La organización interna, las librerías, los atajos y las convenciones de este archivo son una **propuesta de la KB**: se confirman en el primer change de OpenSpec que los toque.

## Patrones aplicados

| Patrón | Dónde | Por qué |
|---|---|---|
| Monolito modular por features (vertical slices) | `src/features/*` | Cada dominio (venta, pagos, caja, compras…) evoluciona y se testea aislado; mapea 1:1 con los changes de OpenSpec |
| Núcleo funcional, cáscara imperativa | `features/*/domain/*.ts` (puro) + `actions.ts` / `queries.ts` (I/O) | Carrito, pagos combinados, vuelto, efectivo esperado, stock, FEFO, valorización, precios masivos y estadísticas son funciones puras → TDD rápido y determinístico |
| RLS como frontera de autorización | Todas las tablas + helpers `private.*` | La seguridad no depende de que cada acción recuerde filtrar por tenant |
| Defensa en profundidad | Guardas en SA/RSC + RLS + CHECK + constraint triggers | UX con mensajes claros; la base garantiza las invariantes de dinero |
| Comando idempotente con id del cliente | `register_sale(payload)` con `sales.id` generado en el cliente | Reintentos seguros ante cortes; habilita la cola sin conexión sin rediseño (RN-OF-01) |
| RPC transaccionales | `register_sale`, `void_sale`, `open/close_cash_session`, `register_purchase`, `close_count`, `apply_price_bulk_update`, `commit_catalog_import` | Operaciones multi-tabla atómicas |
| Documentos inmutables + anulación | Ventas, pagos, movimientos, compras, mermas, conteos, importaciones | Auditabilidad; los derivados se recalculan sin perder historia (DD-25) |
| Derivados en vistas (snapshot + delta) | `stock_events`, `cash_session_balances` + `domain/stock.ts`, `domain/cash.ts` | El stock y el efectivo esperado no se tipean ni se desincronizan (DD-06, DD-14) |
| Snapshot al cerrar | `cash_sessions.closing_snapshot`, `stock_count_results` | Lo entregado (arqueo, diferencias) no cambia solo; los recálculos son explícitos |
| Caché local del catálogo + delta | `features/catalog/cache` (IndexedDB) + `GET /api/catalog/delta?since=` | Escaneo → línea en < 200 ms sin red; base de la venta sin conexión |
| Outbox (Etapa 1) | `features/offline/outbox` | Cola de ventas sin conexión, opción B (DD-31, DD-20) |
| Adapter / plantillas de mapeo | `features/imports/engine` + `profiles` | Un motor genérico para cualquier lista de productos (DD-18) |
| Server Actions tipadas | `actions.ts` por feature, entrada Zod, salida `Result<T, E>` | Contrato explícito; errores de dominio con código (13 §10) sin excepciones |
| Tipos generados | `supabase gen types` → `src/shared/db/types.ts` | El esquema es la fuente de verdad de los tipos |

## Estructura de directorios

```
./
├── knowledge-base/            # esta KB (fuente de verdad de dominio)
├── openspec/                  # specs y changes (OpenSpec)
├── docs/                      # fuentes del relevamiento
├── supabase/
│   ├── migrations/            # SQL versionado (única vía para cambiar el esquema)
│   ├── tests/                 # pgTAP: RLS cruzado por tabla, RPCs, constraints, invariantes de dinero
│   ├── seed.sql               # 2 organizaciones demo, usuarios por rol, ventas, cajas, lotes
│   └── config.toml
├── src/
│   ├── app/                   # SOLO ruteo y composición (delgado)
│   │   ├── (auth)/login | recuperar-contrasena | actualizar-contrasena
│   │   ├── auth/callback/route.ts, auth/confirm/route.ts, api/catalog/delta/route.ts
│   │   ├── (app)/l/[locationId]/{vender,caja,ventas,vencimientos,compras,mermas,conteos,stock}
│   │   ├── (app)/org/{catalogo,precios,proveedores,medios-de-pago,importaciones,estadisticas,configuracion}
│   │   ├── admin/{organizaciones,usuarios,plantillas,uso,auditoria}
│   │   └── manifest.ts, layout.tsx
│   ├── features/
│   │   ├── tenancy/           # contexto org/local, membresías, guardas
│   │   ├── catalog/           # products, barcodes, categories, venta rápida, cache/ (IndexedDB + delta)
│   │   ├── pricing/           # precio individual, actualización masiva, historial
│   │   ├── suppliers/
│   │   ├── pos/               # carrito, pantalla de venta, atajos, registro y anulación de ventas, comprobante
│   │   ├── payments/          # medios de pago, cobro combinado, vuelto
│   │   ├── cash/              # sesiones, movimientos, arqueo, totales por medio
│   │   ├── purchases/
│   │   ├── lots/              # alertas, FEFO, acciones
│   │   ├── waste/
│   │   ├── counts/
│   │   ├── stock/             # stock teórico, inconsistencias
│   │   ├── stats/             # estadísticas, control, calidad de datos
│   │   ├── imports/
│   │   │   ├── engine/        # read → map → normalize → validate → resolve → dedupe (puro)
│   │   │   └── profiles/      # presets: generic-catalog
│   │   ├── offline/           # conectividad; outbox y sincronizador (Etapa 1, DD-31)
│   │   └── admin/
│   │   #   cada feature: components/ actions.ts queries.ts schemas.ts domain/ __tests__/
│   └── shared/
│       ├── db/                # clientes Supabase (server, browser, admin server-only), types.ts
│       ├── ui/                # componentes base, <Scanner/>, <ExpiryDateInput/>, <MoneyInput/>, <Hotkeys/>
│       └── lib/               # barcode.ts, money.ts (centavos), dates.ts (TZ), result.ts, hid-scanner.ts
├── tests/
│   ├── e2e/                   # Playwright: venta PC (solo teclado), venta mobile, caja, compras, conteo
│   └── fixtures/imports/      # catálogos sintéticos y reales anonimizados
└── middleware.ts              # (proxy.ts en Next.js 16+) refresco de sesión
```

**Reglas de dependencia:** `app/` → `features/` → `shared/`. Una feature no importa la carpeta interna de otra: usa su `index.ts` público. `domain/` no importa nada de I/O (ni Supabase, ni Next, ni IndexedDB).

## Pantalla de venta (POS)

La pantalla más usada y la que define la adopción (RE-02). Dos layouts sobre el mismo dominio (`features/pos/domain`):

| Aspecto | PC (teclado + lector USB) | Celular (cámara) |
|---|---|---|
| Entrada principal | Lector USB en modo teclado; captura global por velocidad de tipeo (< 30 ms entre teclas + Enter), aunque el foco esté en otro lado | Cámara continua en la parte superior |
| Carrito | Tabla con línea seleccionada; total grande siempre visible | Lista colapsable; total y botón "Cobrar" fijos abajo |
| Venta rápida | Grilla con tecla por botón | Grilla de botones grandes |
| Cobro | Teclas `1`–`9` para medios, dígitos para montos, `Enter` confirma | Botones de medios, teclado numérico propio, montos sugeridos |
| Indicadores | Usuario, caja abierta, conexión, contador de vencimientos | Igual, compactos |

**Atajos de teclado propuestos (PC)** — evitan teclas reservadas del navegador (`F5`, `F11`, `F12`, `Ctrl+W/T/N/P`); se validan con los pilotos:

| Tecla | Acción |
|---|---|
| dígitos + `Enter` | Agregar producto por código (lector o tipeo) |
| `N` `*` (por ejemplo `3*`) y escanear | Agregar N unidades |
| `+` / `-` | Sumar / restar 1 en la línea seleccionada |
| `↑` / `↓` | Seleccionar línea |
| `Supr` | Quitar la línea seleccionada |
| `F2` | Buscar por nombre |
| `F4` | Venta rápida (grilla; luego la tecla del botón) |
| `F8` | Ítem manual (descripción + importe) |
| `F9` | **Cobrar** |
| `1`–`9` (en el cobro) | Elegir medio de pago (según `sort_order`) |
| `Enter` (en el cobro) | Confirmar si el pendiente es $0 |
| `Esc` | Volver / cancelar el carrito (con confirmación) |
| `?` | Mostrar los atajos |

## Seguridad

| Aspecto | Enfoque |
|---|---|
| Autenticación | Supabase Auth con email y contraseña; invitaciones; sesión en cookies httpOnly (`@supabase/ssr`); refresco en el middleware. En el servidor se valida con `getUser()`/`getClaims()`, nunca con `getSession()`. |
| Autorización | RLS en todas las tablas con los helpers `private.*` (`security definer`, `set search_path = ''`). Guardas espejo en SA/RSC (matriz de 03). RPCs de negocio `security invoker`. |
| Integridad del dinero | CHECK por fila (montos > 0, vuelto coherente) + **constraint triggers diferidos** (Σ pagos = total, ≥ 1 línea, ≤ 1 efectivo) + `UPDATE` restringido a columnas de anulación. Idempotencia por `sales.id`. |
| Integridad multi-tenant | FKs compuestas con `organization_id` (RN-TE-08). Tests pgTAP de cruce A↔B por tabla. En CI, chequeo de RLS habilitado en toda tabla de `public`. |
| Validación de entrada | Esquemas Zod compartidos UI/SA; `CHECK` en la DB como última línea. |
| Secretos | Variables de entorno de Vercel. La secret key solo en `shared/db/admin.ts` con `import 'server-only'`. Nada sensible en `NEXT_PUBLIC_*`. |
| Datos locales | La caché del catálogo y el carrito viven en IndexedDB del dispositivo; se borran al cerrar sesión. **Sin** costos ni datos de otros locales en la caché del `employee`. |
| Storage | Bucket `imports` privado; subida por URL firmada; políticas por prefijo `{organization_id}/`. |
| Super-admin | Acciones auditadas en `audit_events`. Lectura de datos de clientes solo para soporte (DD-22). |
| Headers | CSP estricta, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. |
| Legal | El sistema es de control interno; leyenda "no válido como factura"; términos, privacidad (Ley 25.326) y acuerdo de piloto antes de cobrar (PQ-18). |

## Estrategia de testing (Strict TDD)

| Capa | Herramienta | Qué cubre | Obligatorio |
|---|---|---|---|
| Unidad (dominio) | Vitest | `domain/*`: carrito, totales, pagos combinados, vuelto, esperado y diferencia de caja, stock, FEFO, valorización, actualización masiva y redondeo, buckets horarios por zona, márgenes, normalización de códigos, parseo de fechas, motor de mapeo | Sí: RED → GREEN → TRIANGULATE → REFACTOR por cada regla RN |
| Base de datos | pgTAP (`supabase test db`) | RLS cruzado por tabla; RPCs (`register_sale` idempotente, `void_sale` con ventana, `close_cash_session`); constraint triggers de dinero; FKs compuestas; índice de una sesión abierta por caja | Sí, por cada tabla, política o RPC nueva |
| Componentes | Vitest + Testing Library | `<Scanner/>`, `<Hotkeys/>`, `<MoneyInput/>`, pantalla de cobro, `<ExpiryDateInput/>` | Componentes con lógica |
| E2E | Playwright (viewport PC **solo teclado** y viewport mobile) | Abrir caja → vender con pago combinado → anular → movimiento → cerrar con arqueo; compra con vencimiento; conteo; login | Los flujos D1 antes del piloto |
| Fixtures de importación | Vitest + `tests/fixtures/imports/` | Preset genérico contra catálogos sintéticos y reales anonimizados | Sí |

**Flujo de trabajo:** cada cambio es un change de OpenSpec (`/opsx:propose` → `/opsx:apply` → `/opsx:archive`). Los CA de 06 y las RN de 05 son los escenarios de las specs; cada escenario tiene al menos un test. **Suposición:** Conventional Commits y un PR por change.

## Criticidad por dominio (gobernanza de agentes)

| Nivel | Dominios | Comportamiento esperado |
|---|---|---|
| CRITICAL | Auth, RLS y helpers `private.*`, membresías, secret key, `audit_events`, operaciones del super-admin | Solo análisis y propuesta; se escribe con aprobación humana explícita |
| HIGH | **RPCs de dinero** (`register_sale`, `void_sale`, `open/close_cash_session`) y sus constraint triggers; **actualización masiva de precios** y su reversión; cola y sincronización sin conexión; migraciones que tocan datos existentes; commit de importación | Proponer y esperar revisión |
| MEDIUM | Pantalla de venta y cobro (UX), stock/FEFO, valorización, estadísticas, motor de importación, caché local | Implementar por pasos con checkpoints |
| LOW | CRUD de catálogo, proveedores, categorías y medios de pago; listados; tipos | Autonomía si los tests pasan |

## Variables de entorno

| Variable | Descripción | Ejemplo | Sensible |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | `https://xyz.supabase.co` | N |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave pública (la "anon key" en proyectos con claves legacy) | `sb_publishable_…` | N (pública, con RLS) |
| `SUPABASE_SECRET_KEY` | Clave secreta (la "service_role" en las legacy). **Solo server-only** | `sb_secret_…` | **Y** |
| `NEXT_PUBLIC_SITE_URL` | URL base para los redirects de Auth | `https://app.ejemplo.com` | N |
| `SUPABASE_PROJECT_ID` | Solo para desarrollo y CI (`gen types`) | `xyz` | N |
| `SENTRY_DSN` | **Suposición:** observabilidad de errores (muy recomendable: somos la caja) | `https://…` | Y |

El SMTP (invitaciones) se configura en el panel de Supabase Auth, no en variables de la app.

## Gotchas técnicos conocidos

1. **Dinero en JavaScript:** nunca `number` con decimales. En el dominio TS los montos van en **centavos enteros** (`money.ts`); en la DB, `numeric(14,2)`; la conversión ocurre solo en los bordes.
2. **Vistas y RLS:** una vista corre con los permisos de su dueño y **se saltea RLS**. `stock_events`, `product_costs` y `cash_session_balances` se crean `WITH (security_invoker = true)`.
3. **FKs y RLS:** las FKs no respetan RLS; sin FKs compuestas se puede referenciar un dato de otro tenant (RN-TE-08).
4. **Invariantes de varias filas:** una política RLS no puede garantizar "Σ pagos = total". Usar `CREATE CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`, que se evalúa al `COMMIT`.
5. **Rendimiento de RLS:** envolver `auth.uid()` y los helpers en `(select …)` e indexar `organization_id` y `location_id`.
6. **PostgREST devuelve como máximo 1000 filas por defecto:** las estadísticas usan RPC con agregados; nunca asumir que una consulta trae "todo".
7. **Número de venta correlativo:** se asigna con un `UPDATE locations SET last_sale_number = last_sale_number + 1 … RETURNING` dentro de `register_sale` (lock de fila por local; aceptable a escala de kiosco). Nunca `max()+1`.
8. **Lector USB (HID):** envía dígitos como teclas muy rápidas + `Enter`. Detectarlo por tiempo entre teclas para no depender del foco; desactivar autocompletar; cuidado con lectores configurados con otra distribución de teclado (afecta símbolos, no dígitos).
9. **Cámara en iOS:** Safari no implementa `BarcodeDetector` → fallback con ZXing. La cámara requiere HTTPS y un gesto del usuario.
10. **IndexedDB en iOS:** Safari puede borrar el almacenamiento de sitios no instalados tras días sin uso. Instalar la PWA y pedir `navigator.storage.persist()`. La caché se reconstruye desde el servidor; la **outbox** (si existe) es lo único que no se puede perder.
11. **Sesión de Supabase sin conexión:** el access token vence (1 h por defecto). Con la cola sin conexión, el sincronizador refresca la sesión antes de enviar.
12. **Impresión térmica:** `@page { size: 80mm auto; margin: 0 }` (o 58 mm). El navegador muestra el diálogo de impresión en cada ticket; la impresión silenciosa requiere configurar el navegador del puesto (por ejemplo, Chrome con `--kiosk-printing`) (PQ-24).
13. **Límite de body de Server Actions (1 MB) y de funciones de Vercel (~4,5 MB):** el archivo de importación se sube directo a Storage; las filas se validan en lotes.
14. **Códigos de barras en Excel:** una columna numérica muestra `7.79123E+12` y pierde dígitos o ceros. Se leen como texto crudo; en notación científica se rechaza la fila (RN-IM-03).
15. **SheetJS:** el paquete `xlsx` del registro de npm está desactualizado; se instala desde el CDN oficial de SheetJS con versión fijada.
16. **Zona horaria:** "hoy", los días de las estadísticas y las horas pico se calculan en la zona del local (`America/Argentina/Mendoza`, UTC−3, sin horario de verano), con `AT TIME ZONE` en SQL; nunca en UTC del servidor.
17. **SMTP de Supabase por defecto:** límite de envíos muy bajo. Configurar un SMTP propio antes de la primera visita.
18. **Planes pagados desde Día 1:** Supabase Free pausa proyectos inactivos y no tiene backups; Vercel Hobby no admite uso comercial. **Decidido (DD-32):** Supabase Pro y Vercel Pro desde el Día 1 del piloto (costo ~USD 50/mes).
19. **Next.js 16:** `middleware.ts` pasa a llamarse `proxy.ts`. Seguir la convención de la versión instalada.
