# 02 — Descripción General

## Resumen técnico

Aplicación web **SaaS multi-tenant**, **PWA responsive** (celular **y** PC), full stack en TypeScript. **Next.js (App Router)** sirve la UI y la lógica de servidor sobre **Vercel**; **Supabase** aporta PostgreSQL, Auth y Storage. El aislamiento entre clientes se garantiza en la base con **Row Level Security (RLS)**. No hay backend separado ni infraestructura propia: solo servicios gestionados. El producto es la **caja registradora** del comercio, así que la pantalla de venta tiene requisitos de velocidad y de tolerancia a fallas propios (ver §Requisitos no funcionales y PQ-01).

## Stack tecnológico

| Capa | Tecnología | Versión mínima | Estado |
|---|---|---|---|
| Lenguaje | TypeScript (`strict: true`) | 5.x | Decidido |
| Framework | Next.js App Router (RSC + Server Actions + Route Handlers) | 15 (usar la última estable al iniciar) | Decidido |
| UI runtime | React | 19 | Decidido (viene con Next.js) |
| Base de datos | Supabase PostgreSQL + RLS | PG 15+ | Decidido |
| Autenticación | Supabase Auth vía `@supabase/ssr` (sesión en cookies) | — | Decidido |
| Archivos | Supabase Storage (bucket privado para archivos de importación de catálogo) | — | **Suposición** (RN-IM-10) |
| Hosting | Vercel | — | Decidido |
| PWA | Web App Manifest + service worker (Serwist o equivalente) | — | Decidido (PWA); librería **Suposición** (`next-pwa` está sin mantenimiento) |
| Caché local del catálogo | IndexedDB (por ejemplo, Dexie) con sincronización incremental por `updated_at` | — | **Propuesta (KB)**: búsqueda instantánea en la pantalla de venta; base de la venta sin conexión si se adopta (DD-20) |
| Estilos / componentes | Tailwind CSS + shadcn/ui | — | **Suposición** |
| Validación | Zod (esquemas compartidos cliente/servidor) | 3.x+ | **Suposición** |
| Lectura de Excel/CSV | SheetJS (`xlsx`) instalado desde el CDN oficial de SheetJS | — | **Suposición** (ver gotcha en 08) |
| Escaneo por cámara (celular) | `BarcodeDetector` nativo + fallback ZXing (`@zxing/browser`) | — | **Suposición** (iOS Safari no tiene `BarcodeDetector`) |
| Escaneo por lector (PC) | Lector USB en modo teclado (HID): dígitos + Enter | — | Decidido (PC con lector USB) |
| Impresión de comprobante | Impresión del navegador con CSS para papel térmico de 58/80 mm | — | **Suposición** (SU-12, PQ-24) |
| Testing | Vitest + Testing Library, Playwright (E2E, viewports PC y mobile), pgTAP (`supabase test db`) | — | Strict TDD decidido; herramientas **Suposición** |
| Tooling | Supabase CLI (migraciones, tipos generados), pnpm, ESLint + Prettier | — | **Suposición** (salvo Supabase CLI) |
| Especificación | OpenSpec (changes → specs) + esta KB | — | Decidido |

## Arquitectura general

```
 [PC del mostrador]            [Celular del local]           [Celular / PC del dueño, remoto]
  teclado + lector USB (HID)    cámara, una mano               estadísticas, precios, caja
        │ PWA (HTTPS)                │ PWA (HTTPS)                    │
        └──────────────┬─────────────┴────────────────────────────────┘
                       │  caché local del catálogo (IndexedDB) + carrito persistido
                       ▼
 ┌──────────────────────────── Vercel ─────────────────────────────┐
 │ Next.js App Router                                               │
 │  • Server Components ─ lecturas (cliente Supabase con JWT user)  │
 │  • Server Actions   ─ escrituras validadas con Zod → RPC         │
 │  • Route Handlers   ─ /auth/callback, /auth/confirm, catálogo delta │
 │  • middleware/proxy ─ refresco de sesión + guardas de ruta       │
 │  • módulo server-only ─ secret key, SOLO operaciones super-admin │
 └───────────────┬──────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────── Supabase ───────────────────────────┐
 │ Auth │ PostgreSQL + RLS (RPC: register_sale, void_sale,          │
 │      │ open/close_cash_session, register_purchase, close_count,  │
 │      │ apply_price_bulk_update, commit_catalog_import, stats_*)  │
 │      │ Storage (archivos de importación de catálogo)             │
 └──────────────────────────────────────────────────────────────────┘

 Fuera del sistema (Etapa 0): QR de Mercado Pago, alias/transferencias, posnet.
 El cajero cobra por fuera y marca el medio a mano (RN-PA-04).
```

**Decisiones de alto nivel** (detalle en `09_decisiones_y_supuestos.md`):
- **Somos la caja registradora** del comercio (DD-01): las ventas nacen en la app.
- **RLS es la frontera de autorización.** El servidor consulta con el JWT del usuario, nunca con la secret key, salvo en operaciones de plataforma del super-admin (DD-02, DD-22).
- **Monolito modular en Next.js**, organizado por features y con la lógica de dominio en funciones puras testeables (DD-03).
- **Stock y efectivo esperado derivados**, no editables: se calculan a partir de documentos inmutables (DD-06, DD-14).
- **Operaciones de dinero atómicas e idempotentes**: una venta (líneas + pagos) se registra en una sola RPC transaccional, con el `id` generado en el cliente (RN-OF-01).
- **Venta sin conexión: decidida** (DD-31, resuelve DD-20 y PQ-01): Etapa 0 solo en línea, Etapa 1 cola. Los invariantes se aplican desde el día 1.

## Integraciones externas

| Servicio | Propósito | Tipo | Etapa |
|---|---|---|---|
| Supabase Auth | Usuarios, sesiones, invitaciones, recupero de contraseña | SDK (`@supabase/ssr`, `supabase-js`) | 0 |
| Supabase PostgreSQL | Datos de negocio con RLS; RPCs transaccionales y de estadísticas | SDK / PostgREST + migraciones SQL | 0 |
| Supabase Storage | Archivos originales de importación de catálogo (auditoría y reprocesamiento) | SDK, URL de subida firmada | 0 |
| Vercel | Hosting, previews por PR, variables de entorno | Plataforma | 0 |
| SMTP transaccional | Emails de invitación y recupero (Auth) | SMTP configurado en Supabase | 0. **Suposición:** proveedor tipo Resend (el SMTP por defecto de Supabase tiene un límite de envíos muy bajo) |
| Mercado Pago / bancos / posnet | Cobros electrónicos | **Ninguna en la Etapa 0**: marcado manual del medio | **2**: MP Point / QR o posnet vía `external_provider` / `external_id` (13 §9) |
| ARCA (ex AFIP) | Facturación electrónica | **Ninguna en la Etapa 0** | **2**: vía `fiscal_documents` (13 §9) |
| Mercado Pago (suscripciones) | Cobro del servicio a los clientes | — | **2** (cobro manual en la Etapa 1) |

## Superficie de API

No hay API REST pública. La interacción es:

| Mecanismo | Uso | Ejemplos |
|---|---|---|
| Server Components | Lecturas por página, con RLS | Historial de ventas, caja actual, vencimientos, estadísticas |
| Server Actions (por feature) | Mutaciones validadas con Zod; devuelven `Result<T, E>` | `registerSale`, `voidSale`, `openCashSession`, `registerCashMovement`, `closeCashSession`, `createProduct`, `updatePrice`, `previewBulkPriceUpdate`, `applyBulkPriceUpdate`, `registerPurchase`, `registerWaste`, `recordCountLine`, `closeCount`, `commitCatalogImport` |
| Route Handlers | Flujos de Auth por URL; delta del catálogo para la caché local | `GET /auth/callback`, `GET /auth/confirm`, `GET /api/catalog/delta?since=` |
| Supabase Storage directo | Subida del archivo de importación (evita el límite de body de Server Actions) | URL firmada al bucket `imports` |
| Funciones SQL (RPC, `security invoker`) | Operaciones atómicas multi-tabla y agregados | `register_sale(payload)`, `void_sale(id, reason)`, `open_cash_session`, `close_cash_session`, `register_purchase`, `close_count`, `apply_price_bulk_update`, `commit_catalog_import`, `stats_sales_summary(location, from, to)` y demás `stats_*` |

## Entornos

| Entorno | App | Base | Notas |
|---|---|---|---|
| Local | `next dev` | Supabase CLI local (**Suposición:** requiere Docker solo para desarrollo) | Seed con 2 organizaciones para probar aislamiento |
| Preview | Vercel Preview por PR | Proyecto Supabase de staging | Nunca apuntar previews a producción |
| Producción | Vercel Production | Proyecto Supabase de producción | **Suposición:** región `sa-east-1` (São Paulo) para Supabase y `gru1` para las funciones de Vercel, por latencia desde Mendoza |

## Requisitos no funcionales

| Tema | Requisito |
|---|---|
| Dispositivos | **PC del mostrador** (navegador Chromium, lector USB) **y celular** (Android/iOS, cámara). El mismo producto, layout responsive (DD-04). |
| UX de venta en PC | Usable **sin mouse**: foco permanente en el campo de escaneo, atajos de teclado (08 §Pantalla de venta). |
| UX de venta en celular | Escaneo con la cámara, botones grandes, operable con una mano. |
| Latencia de la venta | **Suposición:** escaneo → línea en el carrito < 200 ms (búsqueda contra la caché local, sin red); confirmar el cobro < 1 s con buena conexión. |
| Tolerancia a fallas | Un corte de internet **no puede impedir vender** (RE-01). El carrito nunca se pierde (RN-OF-03). Estrategia final en PQ-01. |
| Volumen por local | **Suposición** (SU-06): 1.000–3.000 productos activos; 150–500 ventas por día; 1–3 ítems por venta (≈ 30.000 líneas de venta por mes). |
| Rendimiento de lecturas | **Suposición:** caja actual y vencimientos < 1 s; estadísticas de un mes < 3 s. |
| Disponibilidad | La de Vercel y Supabase (servicios gestionados); sin SLA propio en la Etapa 0. |
| Backups | **Suposición:** plan Supabase Pro desde el piloto (backups diarios y sin pausa por inactividad), PQ-19. |
| Zona horaria | Almacenamiento en UTC (`timestamptz`); presentación y agrupamiento (día, hora pico) en la zona del local (por defecto `America/Argentina/Mendoza`). |
| Moneda | ARS únicamente. |
| Idioma | UI en español (Argentina). Código y base de datos en inglés (DD-23). |
