# Relevamiento — PIVOT del producto (2026-10-01)

> **Este documento es la fuente AUTORITATIVA.** Reemplaza la visión de `relevamiento-inicial.md`, que queda como contexto histórico (caso YES/DEBO).
> Decisiones del fundador + propuestas del lead técnico (marcadas como **Propuesta**).

## 1. Por qué pivoteamos

- El kiosco YES usa **DEBO** (ERP de Foca Software), que ya trae stock, lotes, compras y alertas. El problema de YES no es la falta de software: es que **no lo usan**. Otro sistema no arregla eso.
- **Nuevo foco:** **comercios independientes** (kioscos, almacenes) que hoy no tienen sistema o lo llevan a mano o en Excel. Hay varios kioscos en la zona del fundador (Mendoza) para ofrecer el piloto.

## 2. Visión

Un **sistema de gestión SIMPLE** para el comercio independiente: **ventas + stock + caja + estadísticas**. Tiene que **convencer y ser fácil de usar**. Es SaaS multi-tenant y escalable.

- **Sin facturación fiscal (ARCA) por ahora**, pero la arquitectura deja la puerta abierta para sumarla después.
- **Sin integración con Mercado Pago ni posnet por ahora**, con la puerta abierta para el futuro.
- **Diferencial:** ultra simple; funciona igual de bien en celular y en PC; pagos combinados bien resueltos; control de vencimientos y pérdidas; **atención y configuración en persona en Mendoza**.
- **Competencia** (ya relevada): KioscoSoft, Tikket POS, Fácil Virtual, Donkiosco, Cobrando.app, Gestión Comercio y Líder Gestión, entre otros. Muchos traen factura de ARCA. No competimos en cantidad de funciones sino en simplicidad.

## 3. Módulos requeridos (Etapa 0)

### 3.1 Ventas (registro dentro de la app)
- Escanear el código de barras o buscar el producto → carrito (por ejemplo, Coca-Cola + alfajor) → total → cobrar.
- **Productos sin código de barras** (sueltos, a granel, servicios): botones de venta rápida o ítem manual. **Propuesta.**
- El ticket o comprobante interno dice **"Comprobante no válido como factura"**.
- Una venta **no se edita**: se **anula** (con motivo y solo ciertos roles) y se crea una nueva. **Propuesta.**
- La venta tiene una relación opcional con un "documento fiscal" (null por ahora), para sumar ARCA después sin rediseñar.

### 3.2 Pagos (combinados)
- **Una venta puede tener VARIOS pagos con distintos medios.** Ejemplo: mitad Mercado Pago y mitad efectivo. Cada venta muestra su desglose por medio de pago.
- **Medios configurables por organización.** Por defecto: Efectivo, **Transferencia/Alias** (muchos kioscos cobran por alias), Mercado Pago (QR), Débito, Crédito, Otro.
- El cajero **marca el medio a mano** después de cobrar por fuera (QR, alias, posnet).
- Efectivo: monto recibido y **vuelto**. **Propuesta.**
- Cada pago guarda `referencia` opcional (por ejemplo, el número de operación) y `proveedor_externo` / `id_externo` en null, que quedan listos para integrar Mercado Pago Point o un posnet en el futuro.

### 3.3 Caja y movimientos de dinero
- **Sesión de caja por turno:** apertura con monto inicial → durante el turno, las ventas en efectivo suman solas → **movimientos manuales** (gasto, pago a proveedor, retiro, aporte) → **cierre con arqueo**: lo que debería haber contra lo contado, y la diferencia queda registrada.
- **Totales por medio de pago** del turno, para controlar a mano contra lo que entró en Mercado Pago o el banco.
- El dinero se anota manualmente; el objetivo es que **se organicen**.

### 3.4 Stock
- **Se calcula, no se edita a mano.** Las ventas restan y las compras suman; las mermas y los conteos ajustan. Se mantiene la decisión DD de la KB anterior.
- Los conteos (inicial, parciales y finales) siguen existiendo: las diferencias son pérdidas sin explicar.

### 3.5 Proveedores y compras
- Alta rápida de proveedores (compran a cualquiera).
- Compras con **costo** y **fecha de vencimiento por lote**: vencimientos y alertas siguen siendo un diferencial.
- Una compra puede pagarse desde la caja, como un egreso vinculado.

### 3.6 Estadísticas
- Ventas por día, turno y medio de pago; ticket promedio; horas pico.
- **Ganancia bruta** (ventas − costo), margen por producto.
- **Productos más vendidos** y los que menos rotan.
- **Pérdidas:** vencidos, mermas y diferencias de conteo, valorizadas.
- **Compras por proveedor.**

### 3.7 Catálogo y precios
- Productos con código de barras, precio de venta y costo (que sale de las compras).
- **Actualización masiva de precios por % (por categoría o proveedor).** En Argentina los precios cambian seguido, y un kiosco necesita actualizar rápido. **Propuesta** de alto valor.
- **Importación del catálogo desde Excel/CSV** para el alta del cliente (muchos kioscos tienen su lista en Excel). Reutiliza el motor de importación genérico ya diseñado.

## 4. Dispositivos (decidido)

- **Ambos: celular Y PC.** Diseño responsive; app web instalable (PWA).
- **PC:** pantalla de venta optimizada para teclado + **lector de código de barras USB** (funciona como teclado), con atajos y sin depender del mouse.
- **Celular:** escaneo con la cámara, botones grandes, una mano.

## 5. Riesgos y temas a definir

- **Sin conexión:** ahora SOMOS la caja registradora. Si se cae internet, **no se puede dejar de vender**. Hay que definir para la Etapa 0 entre un mínimo (avisar y reintentar) y una cola de ventas sin conexión. **Riesgo alto, hay que decidirlo.**
- **"Fiado" (cuenta corriente de clientes):** es muy común en los kioscos y almacenes argentinos. ¿Entra en la Etapa 0, la 1 o nunca? **A preguntar a los pilotos.**
- **Cuenta corriente con proveedores** (deudas): ¿Etapa 1?
- **Catálogo maestro compartido** (código de barras → nombre del producto, armado entre todos los clientes) para acelerar el alta: es una idea para la Etapa 1. Ojo con la privacidad entre tenants.
- **Fiscal / legal:** el sistema es de control interno y el comerciante sigue siendo responsable de facturar. Hacen falta términos de uso y una política de privacidad antes de cobrar.
- **Nombre del producto:** pendiente. El repositorio "gestion-yes" ya no representa el producto.
- **Precio** para kioscos independientes: pendiente.

## 6. Piloto y etapas

- **Piloto:** de 1 a 3 kioscos independientes de la zona, **un mes gratis**, con configuración en persona.
- **Etapa 0:** ventas + pagos combinados + caja + stock + compras/vencimientos + estadísticas básicas + importación de catálogo. Multi-tenant desde el día 1, sin registro por cuenta propia ni suscripciones.
- **Etapa 1:** de 5 a 20 locales; fiado y cuenta corriente con proveedores (según lo que digan los pilotos); catálogo maestro; cobro manual.
- **Etapa 2:** registro por cuenta propia, suscripciones, **facturación ARCA**, **integración con Mercado Pago Point / posnet**.

## 7. Lo que se cae del diseño anterior

- El adaptador de **ventas de DEBO** y la importación de ventas como fuente principal del stock. Ahora las ventas nacen en la app.
- Todo lo específico de YES/DEBO (riesgo RE-01, Gate 0 de DEBO, PQ-01/02 sobre DEBO).
- **Se mantiene:** el stack, multi-tenant + RLS, los roles, el catálogo, las compras con lotes y vencimientos, las mermas, los conteos, el motor de importación genérico (ahora solo para el catálogo), Strict TDD y OpenSpec.
