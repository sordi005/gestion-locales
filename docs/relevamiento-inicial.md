> ⚠️ Histórico — reemplazado por `relevamiento-pivot-2026-10-01.md`

# Relevamiento inicial — 2026-09-28 / 2026-09-30

> Notas de discovery consolidadas de la sesión con el fundador y de las respuestas de un empleado del kiosco piloto.
> Fuente para `kb-creator`. Todo lo no confirmado está marcado como **Pendiente** o **Suposición**.

## 1. Contexto y visión

- **Producto propio (SaaS)** del fundador, pensado como el de un estudio de desarrollo. Se ofrece a **cualquier kiosco o comercio minorista chico**, no solo a YES.
- **Primer cliente (piloto):** un kiosco de la red de franquicias **"YES"** en Mendoza, Argentina. El franquiciado paga la franquicia y abre el local con esa marca.
- **Nombre del producto:** Pendiente. "gestion-yes" es solo el nombre del repositorio. **No se puede usar la marca YES** en el producto porque es de la franquicia.

## 2. Problema

- El kiosco solo tiene un **sistema de cobro (POS)**: escanean el código de barras y cobran.
- **No gestionan nada más:** no controlan el stock, no ven las pérdidas y no registran a los proveedores ni las compras de forma estructurada.
- **La mayor pérdida son los productos VENCIDOS.**
- El stock **casi nunca se cuenta**.

## 3. Situación actual (operación del kiosco)

- **POS:** se llama **"DEBO"** (nombre confirmado; antes figuraba como "Deboi" o "Debi"). Es la suite ERP + POS de **Foca Software** (Mendoza). Ver sección 12. **Pendiente:** foto de la pantalla para confirmar edición y módulos habilitados. Emite la factura (fiscal) y, según el empleado, "exporta a Excel".
- **Excel manual:** en una planilla anotan los **gastos**, los **pagos a proveedores** y **la plata en efectivo que dejó el turno anterior**.
- **AMBIGÜEDAD CRÍTICA (Pendiente):** no está confirmado que DEBO exporte **las ventas producto por producto** (código de barras, cantidad, precio, fecha y hora). El "Excel" que se mencionó puede ser la planilla manual. Hay que conseguir un Excel real exportado de DEBO.
- **Pendiente:** si DEBO es el sistema actual o uno nuevo. La encargada dijo que "están haciendo cambios en el sistema".
- **Proveedores:** compran a cualquier proveedor, sin una lista fija.

## 4. Actores (a validar)

- **Dueño / franquiciado:** decide, ve reportes y pérdidas. Todavía no respondió; la aprobación del piloto está pendiente.
- **Encargada:** gestiona el local. Le gustó la idea y lo está consultando con los dueños.
- **Empleado (por turno):** cobra, recibe mercadería y podría cargar compras, conteos y productos vencidos.
- **Super-admin de la plataforma (el fundador):** da de alta a los clientes y da soporte.
- **Suposición:** hay más de un turno y varios empleados. El número exacto está pendiente.

## 5. Acuerdo comercial del piloto

- **Un mes GRATIS.** Primero se ofrecieron 3 semanas; se amplió a un mes y hay que comunicarlo como una mejora.
- El piloto se diseña **empezando por su reporte final**: conteo inicial → compras (con vencimiento) → ventas importadas → productos vencidos → conteo final → **pérdida valorizada en $ del mes**.
- El sistema tiene que estar listo **antes** del día 1 del piloto.
- **Pendiente:** la propuesta y el precio después del piloto. Se definen antes de que termine.

## 6. Propuesta de valor / diferencial

- **No reemplaza al POS.** Es la **capa de control que va al lado de cualquier sistema de cobro**: "Seguí cobrando como cobrás. Nosotros te decimos qué se vence, qué perdés y qué reponer."
- **Sin ARCA ni facturación electrónica** de nuestro lado: la factura la hace el POS.
- El núcleo (el control de vencimientos) **entrega valor aunque falle la importación de ventas**.

## 7. Alcance del MVP (piloto)

1. Catálogo de productos por **código de barras**. La carga es rápida con un lector USB o la cámara del celular.
2. **Proveedores** con alta en segundos, sin catálogo fijo.
3. **Compras / ingreso de mercadería** con **fecha de vencimiento por lote**.
4. **Alertas de vencimiento** ("vencen en N días"), para poner en oferta o rotar antes de que venzan.
5. **Registro de mermas** (vencidos, roturas, otros), valorizadas en $.
6. **Conteos de stock** (inicial, final y parciales), rápidos escaneando y cargando la cantidad.
7. **Importador de ventas desde Excel**, genérico y con **mapeo de columnas configurable**. **DEBO es el primer adaptador.**
8. **Reporte mensual:** pérdidas por vencimiento y merma, diferencias de stock, qué reponer y margen por producto (si hay costo y ventas).

**Fuera del piloto (etapas siguientes):** suscripciones y cobro, registro por cuenta propia, landing, módulo de caja y gastos por turno (candidato para la etapa 1), reemplazo del POS, facturación electrónica.

## 8. Etapas del producto

- **Etapa 0 (ahora):** piloto en el kiosco YES. La arquitectura ya es multi-tenant. No hay cobros ni registro por cuenta propia: el fundador da de alta a los clientes.
- **Etapa 1:** de 2 a 5 kioscos, con incorporación asistida y cobro manual.
- **Etapa 2:** SaaS con registro por cuenta propia, suscripciones (candidato: Mercado Pago) y landing.
- Regla: **pensar como empresa, construir como startup**. Nada de funciones de la etapa 2 antes de validar.

## 9. Stack y arquitectura (decididos)

- **Next.js (App Router) + TypeScript**, full stack en un solo lenguaje.
- **Supabase:** PostgreSQL + Auth + **Row Level Security** para aislar a cada tenant.
- **Vercel** para el deploy. **PWA mobile-first**, pensada para usar desde el celular o la tablet en el local.
- **Multi-tenant desde el día 1:** `organización → locales`. Todos los datos de negocio pertenecen a una organización (y a un local cuando corresponde), aislados con RLS.
- **Roles:** dueño, encargado, empleado y super-admin de la plataforma.
- **Calidad:** **Strict TDD**, specs con OpenSpec y desarrollo guiado por esta base de conocimiento. Git desde el día 1.

## 10. Suposiciones

- **Suposición:** el kiosco tiene un **lector de códigos de barras USB** (lo usan para cobrar).
- **Suposición:** en el local hay un celular o tablet con internet. La estabilidad de la conexión está pendiente.
- **Suposición:** el dueño consulta los reportes de forma remota.

## 11. Preguntas abiertas

0. **Bloqueante estratégica (prioridad máxima):** ¿Tienen contratado el módulo de inventario de DEBO? Si lo tienen, ¿por qué no lo usan? ¿Los cambios en el sistema son activar inventario? ¿DEBO maneja vencimientos por lote en su configuración?
1. ¿DEBO exporta las ventas **por producto**? ¿Qué columnas trae? (Hace falta un Excel real.) **Crítica.**
2. ¿DEBO es el sistema actual o el nuevo?
2b. Confirmar el nombre exacto del POS (DEBO) con una foto de la pantalla (el nombre ya está confirmado; la foto sirve para ver la edición y los módulos habilitados).
2c. ¿DEBO guarda **precios de costo** por producto? ¿Se pueden exportar junto con el catálogo? (Las pérdidas se valorizan idealmente al costo; si no hay costo, se usa el precio de venta.)
3. ¿Los dueños aprueban el piloto de un mes? ¿Cuándo arranca?
4. ¿Cuántos empleados y turnos hay? ¿Quién cargaría las compras y los productos vencidos?
5. ¿Qué dispositivos hay en el local (PC, tablet, celular) y qué tan estable es internet? ¿Hace falta funcionar sin conexión?
6. ¿Cómo se organiza el conteo inicial de stock sin frenar la operación?
7. ¿Con qué detalle se registran los lotes? (¿Un vencimiento por ingreso? ¿Se consume el lote que vence primero?)
8. ¿Cuál es el nombre del producto?
9. ¿Cuál es el precio y la propuesta después del piloto?
10. Legal: inscripción para facturar, términos de uso y política de privacidad (Ley 25.326). Se necesitan antes de cobrar.

## 12. Addendum 2026-09-30 — DEBO (información del proveedor y del fundador)

> Lo que describe el producto DEBO es **según el sitio del proveedor** y no está verificado en el kiosco.
> Fuentes: https://focasoftware.com/suite-debo/ · https://focasoftware.com/debo-retail-2/ · https://focasoftware.com/debo-cloud/ · https://deboretail.com/

- **DEBO** es una suite **ERP + POS** de **Foca Software**, empresa de Mendoza con más de 30 años, orientada a estaciones de servicio, tiendas de conveniencia y retail.
- Según el proveedor, **ya incluye**: gestión de inventario/stock, conteos de inventario con tablet, transferencias entre sucursales, **partidas/lotes**, alertas por email de stock mínimo, compras, contabilidad y cobranzas (cuentas corrientes).
- Tiene una **versión en la nube (DEBO Cloud)**.
- **Según el fundador:** el **catálogo completo** (código de barras + descripción + precio de venta) **ya está cargado en DEBO**. El personal solo escanea el código; DEBO da el precio y emite la factura. El kiosco usa **solo la parte POS** de DEBO.
- **Implicancias:**
  1. El primer adaptador del importador es DEBO. Al ser un ERP profesional, **es probable** que exporte ventas detalladas y que ofrezca una API (DEBO Cloud). **Hay que verificarlo.**
  2. **Onboarding:** el catálogo se **importa** desde un Excel exportado de DEBO, no se carga a mano. El importador pasa a ser de **catálogo + ventas**.
  3. **Valorización:** las pérdidas se valorizan idealmente **al costo**. No se sabe si DEBO guarda costos (pregunta 2c). Si no hay costo, se usa el **precio de venta** como alternativa, rotulado como tal.
  4. **Riesgo estratégico:** el POS del cliente piloto ya tiene un módulo de inventario. El producto solo tiene sentido para este cliente si (a) no tienen el módulo contratado o es caro; o (b) lo tienen pero no lo usan porque es complejo o poco práctico para el personal del kiosco (entonces el valor es una UX mobile muy simple, enfocada en vencimientos y pérdidas). No tiene sentido (c) si "los cambios en el sistema" significan que están activando el inventario de DEBO ahora. En ese caso la visión SaaS genérica sigue siendo válida, pero el kiosco YES quizás no sea el primer cliente adecuado. Que usen solo la parte POS refuerza que la pregunta 0 es la número 1.
