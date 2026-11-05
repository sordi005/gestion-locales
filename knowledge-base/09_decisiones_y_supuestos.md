# 09 — Decisiones y Supuestos

**Estado de cada decisión:** **Decidida** = definida por el fundador (relevamiento del pivot) · **Propuesta (LT)** = propuesta del lead técnico en el relevamiento; **el fundador la valida** (PQ-06) · **Propuesta (KB)** = diseño de esta KB, se valida en el primer change de OpenSpec que la toque · **Abierta** = falta decidir.

> La numeración de riesgos, decisiones y supuestos se reinició con el pivot (2026-10-01).

## Historia: por qué pivoteamos

La primera versión del producto era una "capa de control" que funcionaba al lado del POS del cliente e importaba sus ventas, pensada para un kiosco franquiciado de Mendoza que cobraba con **DEBO** (ERP + POS de Foca Software). En el relevamiento apareció que DEBO ya trae stock, lotes, compras y alertas: el problema de ese kiosco no era la falta de software, sino que **no lo usaban**, y otro sistema no arreglaba eso. El 2026-10-01 el fundador decidió **pivotar a comercios independientes** (kioscos y almacenes sin sistema, a mano o en Excel) con un sistema de gestión simple **que incluye el registro de ventas**. Se mantienen el stack, el multi-tenant con RLS, los roles, el catálogo, las compras con lotes y vencimientos, las mermas, los conteos, el motor de importación (ahora solo de catálogo), Strict TDD y OpenSpec. Se descartan el adaptador de ventas del POS, la importación de ventas y todo lo específico de ese cliente. Fuente histórica: `docs/relevamiento-inicial.md`.

## Riesgos estratégicos

### RE-01 — Venta sin conexión: ahora somos la caja — **ALTO**
Si se cae internet, el comercio **no puede dejar de vender**. Con el diseño online-first anterior, un corte deja al cajero sin poder registrar ventas. **Estado:** **decidida** el 2026-10-01 (DD-31, resuelve DD-20 y **PQ-01**): el piloto de la Etapa 0 es **solo en línea** (aviso + reintento) con pilotos de internet estable; la cola de ventas sin conexión es de la Etapa 1. El riesgo residual (un corte en el mostrador durante el piloto) sigue siendo ALTO y se mitiga con la elección de los pilotos y el respaldo móvil. **Mitigación ya decidida (KB):** invariantes que hacen posible cualquier opción desde el día 1 (id de venta generado en el cliente, RPC idempotente, `sold_at` del dispositivo, carrito persistido, stock por snapshot + delta que tolera ventas tardías). **Mitigación operativa:** relevar la conexión de cada piloto (PQ-03) y recomendar un respaldo (datos móviles del celular como hotspot).

### RE-02 — Adopción: el comercio tiene que cambiar su forma de cobrar
Si vender con el sistema es más lento que la calculadora y el cajón, no lo usan (el mismo problema que motivó el pivot). **Mitigación:** pantalla de venta optimizada para el celular con una mano (cámara y búsqueda por nombre, DD-33) y para teclado en la PC, con lector USB si hay; objetivos de velocidad medibles (01 §Métricas); venta rápida e ítem manual para que nada frene el cobro; configuración y capacitación en persona; tablero de uso (US-088) y seguimiento semanal.

### RE-03 — Competencia con facturación ARCA
Muchos competidores traen factura electrónica. Un comercio que necesita facturar cada venta tendría que hacerlo por fuera, lo que puede frenar la adopción. **Mitigación:** competir en simplicidad; relevar cómo facturan hoy los pilotos (PQ-10); la arquitectura deja lista la puerta fiscal (DD-05) para priorizarla si el mercado lo exige. **Legal:** el sistema es de control interno y el comerciante sigue siendo responsable de facturar (RN-GL-01).

### RE-04 — Carga inicial del catálogo
Sin catálogo con precios no se puede vender el día 1, y un kiosco tiene 1.000–3.000 productos. La mayoría de los kioscos chicos no tiene lector ni lista en Excel (DD-33), pero unos 200–300 productos hacen la mayor parte de las ventas. **Mitigación:** base de productos compartida desde el piloto (DD-34): al escanear, el nombre aparece ya escrito y solo se pone el precio; carga asistida con el celular de los productos más vendidos en la visita del piloto; alta rápida con precio desde la venta para el resto; botones de venta rápida para golosinas sueltas y productos sin código; ítem manual como red de seguridad; importación desde Excel/CSV (11) solo para quien tenga lista (franquicias, comercios que vienen de otro sistema).

### RE-05 — Exactitud de los pagos marcados a mano
El cajero puede marcar mal el medio (por ejemplo, un QR como efectivo). El arqueo de efectivo y los totales por medio no cierran. **Mitigación:** cobro por defecto en efectivo con el desglose visible; totales por medio al cerrar y carga opcional de lo declarado por cada plataforma (RN-CJ-10); control de diferencias por usuario (RN-ES-09). La integración con MP Point / posnet (Etapa 2) elimina el riesgo.

## Decisiones documentadas

### DD-01 — Sistema de gestión simple que incluye el registro de ventas ("somos la caja") — **Decidida**
**Decisión:** las ventas nacen en la app (escanear → carrito → cobrar), junto con caja, stock y estadísticas. **Contexto:** el segmento son comercios sin sistema; no hay un POS del cual importar. **Alternativas:** capa de control al lado de un POS existente (diseño anterior; descartado con el pivot). **Trade-offs:** asumimos la criticidad de la caja (RE-01) y la comparación directa con los POS del mercado (RE-03).

### DD-02 — Multi-tenant desde el día 1: esquema compartido + `organization_id` + RLS — **Decidida**
**Alternativas:** schema o base por tenant (costo operativo); single-tenant y migrar después (reescritura riesgosa). **Trade-offs:** disciplina obligatoria (tests de cruce por tabla, FKs compuestas); un error de política es crítico.

### DD-03 — Next.js App Router + TypeScript + Supabase + Vercel, monolito modular — **Decidida** (el modular es Propuesta (KB))
**Justificación:** un solo lenguaje, servicios gestionados, sin infraestructura propia. **Trade-offs:** lock-in moderado con Supabase (mitigado: Postgres estándar + SQL versionado).

### DD-04 — PWA responsive para celular y PC — **Decidida**
**Decisión:** el mismo producto en ambos; en el celular (entrada principal, DD-33), cámara, búsqueda por nombre, botones grandes y una mano; en la PC (opcional), venta con teclado y atajos, sin mouse, con lector USB si hay. **Alternativas:** app nativa (costo doble, tiendas); solo celular (los kioscos con PC y lector quedan peor servidos). **Trade-offs:** dos layouts de la pantalla de venta sobre el mismo dominio.

### DD-05 — Sin ARCA ni integración con Mercado Pago / posnet en la Etapa 0, con puertas abiertas — **Decidida**
**Decisión:** `sales.fiscal_document_id` (NULL) hacia una tabla placeholder `fiscal_documents`; `payments.external_provider` / `external_id` (NULL). **Justificación:** validar el producto sin la complejidad fiscal ni de integraciones; no rediseñar después. **Trade-offs:** RE-03 y RE-05 mientras tanto. Diseño futuro en 13 §9.

### DD-06 — Stock derivado de documentos inmutables, no editable — **Decidida** (se mantiene)
**Decisión:** `stock_events` une compras, **ventas**, mermas y observaciones; el stock y el saldo por lote se calculan. **Justificación:** una sola fuente de verdad; anular un documento corrige todo; tolera ventas tardías (cola sin conexión). **Trade-offs:** costo de cálculo (aceptable a escala de kiosco; se materializa si hace falta).

### DD-07 — Los conteos son observaciones con timestamp (snapshot + delta) — **Propuesta (KB)** (se mantiene)
**Decisión:** el conteo guarda "a las T había N"; la diferencia se calcula contra el teórico en T y se congela al cerrar (`stock_count_results`), con recálculo explícito si llegan ventas tardías. **Trade-offs:** versionado de resultados.

### DD-08 — Vencimiento por lote de compra como diferencial — **Decidida**
**Trade-offs:** más carga en la recepción (una fecha por ítem), mitigada con la entrada rápida de fechas (US-094).

### DD-09 — Un lote sale de las alertas solo por confirmación humana — **Propuesta (KB)**
**Contexto:** con ventas en tiempo real la estimación FEFO mejora, pero sigue suponiendo que se vende primero lo que vence primero. **Justificación:** una alerta de más es barata; una de menos cuesta plata. **Revisión:** el cierre automático por saldo estimado en 0 es candidato para la Etapa 1, con datos del piloto.

### DD-10 — Una venta no se edita: se anula y se rehace — **Propuesta (LT)**
**Decisión:** anulación con motivo, por roles determinados (RN-VT-09), con "anular y rehacer". **Justificación:** auditabilidad de la caja; evita fraudes por edición; coherente con DD-25 y con la futura nota de crédito fiscal. **Trade-offs:** una corrección son dos operaciones (mitigado con "anular y rehacer"); el cajero sin encargado presente depende de la ventana de anulación (PQ-07).

### DD-11 — Pagos combinados: N pagos por venta, medios configurables, marcado manual — **Decidida**
**Decisión:** `payments` por venta con `payment_method_id`; medios por organización con un `kind` que define el comportamiento (RN-PA-03). **Alternativas:** un solo medio por venta (no resuelve "mitad MP, mitad efectivo"). **Trade-offs:** el cajero puede marcar mal (RE-05).

### DD-12 — Efectivo con monto recibido y vuelto — **Propuesta (LT)**
**Decisión:** el pago en efectivo guarda el monto aplicado, el recibido y el vuelto; el esperado de caja usa el **aplicado**. **Justificación:** evita errores de vuelto y explica diferencias de caja. **Trade-offs:** un paso más en el cobro (mitigado: el recibido es opcional si es exacto).

### DD-13 — Venta rápida e ítem manual para productos sin código — **Propuesta (LT)**
**Decisión:** botones de venta rápida (productos reales, con o sin stock) e ítem manual (descripción + importe, sin stock). **Justificación:** nunca frenar la venta. **Trade-offs:** el ítem manual no aporta stock ni margen; se controla en calidad de datos (RN-ES-10).

### DD-14 — Sesión de caja por turno; el efectivo esperado se deriva — **Decidida** (la derivación es Propuesta (KB))
**Decisión:** las ventas en efectivo **no** generan movimientos de caja: el esperado se calcula desde los pagos y los movimientos manuales (`cash_session_balances`), y se congela al cerrar. **Justificación:** una sola fuente de verdad (como el stock); anular una venta corrige la caja sola. **Trade-offs:** el detalle de la caja es una consulta, no una tabla.

### DD-15 — Arqueo ciego — **Propuesta (KB)**
**Decisión:** se pide lo contado antes de mostrar el esperado. **Justificación:** práctica estándar de control: evita "ajustar" el conteo al número esperado. **Trade-offs:** puede generar diferencias que el cajero vería "a mano"; se valida con los pilotos (PQ-15).

### DD-16 — Una caja por local en la Etapa 0, con el modelo listo para varias — **Propuesta (KB)**
**Decisión:** `cash_registers` con una "Caja 1" por local; una sesión abierta por caja; varios dispositivos venden en la misma sesión. **Justificación:** un kiosco tiene un cajón; agregar cajas después no requiere migración. **Trade-offs:** dos cajeros simultáneos comparten responsabilidad del arqueo (PQ-05).

### DD-17 — Actualización masiva de precios por % — **Propuesta (LT)**
**Decisión:** por categoría, proveedor habitual, selección o todo; previsualización obligatoria; redondeo opcional; historial y reversión. **Justificación:** en Argentina los precios cambian seguido; es una función de alto valor para el dueño. **Trade-offs:** un error afecta muchos precios (gobernanza HIGH, reversión).

### DD-18 — Importador genérico solo de catálogo — **Decidida** (reutiliza el motor ya diseñado)
**Decisión:** el motor (leer → mapear → normalizar → validar → resolver → confirmar) queda para el **alta del catálogo**; parseo en el navegador y confirmación en el servidor. **Alternativas:** carga manual (inviable con miles de productos). **Trade-offs:** archivos muy heterogéneos entre comercios (mitigado con el asistente de mapeo).

### DD-19 — Valorización al costo con alternativa al precio de venta; costo congelado por línea de venta — **Decidida** (las cascadas son Propuesta (KB))
**Decisión:** mermas y faltantes: costo del lote → último costo → costo de referencia → precio de venta (rotulado) → sin valorizar. Ventas: costo congelado en la línea al vender. **Trade-offs:** la valorización a precio de venta sobreestima la pérdida (se rotula y se desglosa); la ganancia bruta depende de que se carguen costos (cobertura informada).

### DD-20 — Venta sin conexión — **Decidida** (PQ-01; resolución en DD-31)
**Resolución (2026-10-01):** ver DD-31. Etapa 0: solo en línea con aviso y reintento (opción A sin modo contingencia propio) más los invariantes de RN-OF; la cola (opción B) pasa a la Etapa 1; C sigue descartada; D se recomienda como respaldo operativo. Se conserva el análisis original de abajo como contexto.
**Contexto:** RE-01. **Opciones** (detalle en 13 §8): **A.** mínimo (aviso, reintento idempotente, carrito persistido y contingencia en papel); **B.** cola de ventas sin conexión (catálogo en caché, outbox con sincronización idempotente); **C.** offline-first completo con motor de sincronización (descartada para la Etapa 0 por complejidad); **D.** respaldo de conectividad (complementa a A o B). **Recomendación de la KB:** construir A el día 1 con los invariantes de RN-OF y dejar B lista para activarse antes del piloto si PQ-03 muestra conexiones inestables. **Decide:** fundador con el lead técnico.

### DD-21 — Alta de clientes a cargo del super-admin; sin registro propio ni cobro en el producto — **Decidida**
**Justificación:** "pensar como empresa, construir como startup"; la configuración en persona es parte del diferencial. **Trade-offs:** no escala más allá de la Etapa 1 (5–20 locales).

### DD-22 — El super-admin está fuera del modelo de membresías — **Propuesta (KB)**
**Decisión:** tabla `platform_admins`; lectura transversal para soporte; escrituras auditadas; secret key solo server-only. **Trade-offs:** la lectura transversal requiere transparencia legal (PQ-18).

### DD-23 — Identificadores en inglés; UI y documentación en español — **Propuesta (KB)**
**Trade-offs:** doble vocabulario, mitigado con el glosario de 04.

### DD-24 — El contexto de local va en la URL (`/l/[locationId]`) — **Propuesta (KB)**
**Alternativas:** cookie de "local activo" (estado oculto, problemas con varias pestañas).
**Extensión (C-06):** la organización también va en la URL, `/org/[orgId]/…`, validada con `requireOrgContext` (mismo 404 uniforme que un local ajeno): una persona puede ser `owner` de A y `employee` de B, y un "organización activa" en una cookie sería el mismo estado oculto que esta decisión descarta.

### DD-25 — Documentos inmutables con anulación, sin borrado físico — **Propuesta (KB)**
**Alcance:** ventas, pagos, movimientos de caja, compras, mermas, conteos, importaciones. **Trade-offs:** corregir = anular y rehacer.

### DD-26 — Strict TDD + OpenSpec + KB como fuente de dominio — **Decidida**
**Trade-offs:** más tiempo inicial en tests, que se compensa en dinero, stock y caja, donde los bugs son caros.

### DD-27 — Catálogo, precios y medios de pago por organización; ventas, caja y stock por local — **Propuesta (KB)**
**Trade-offs:** no hay precio por local (**Suposición:** no hace falta en la Etapa 0).

### DD-28 — Estadísticas calculadas a demanda desde los documentos — **Propuesta (KB)**
**Decisión:** RPC de agregados con índices; sin data warehouse ni tablas resumen en la Etapa 0. **Revisión:** materializar agregados diarios si las consultas superan los 3 s.

### DD-29 — Proveedor habitual explícito en el producto — **Propuesta (KB)**
**Contexto:** la actualización masiva por proveedor necesita saber qué productos son de quién, pero se compra a cualquiera. **Decisión:** `preferred_supplier_id` editable, que se completa con la primera compra o la importación. **Alternativas:** derivarlo de la última compra (cambia solo y sorprende). **Trade-offs:** un dato más para mantener.

### DD-30 — Caché local del catálogo en el dispositivo — **Propuesta (KB)**
**Decisión:** productos, códigos, precios, botones y medios de pago en IndexedDB, sincronizados por delta. **Justificación:** escaneo instantáneo sin depender de la red; base de la opción B de DD-20. **Trade-offs:** precios desactualizados unos segundos tras un cambio (sincronización al volver al foco y periódica).

### DD-31 — Venta sin conexión en la Etapa 0: solo en línea, con ventas listas para la cola — **Decidida** (2026-10-01; resuelve PQ-01 y DD-20)
**Decisión:** el piloto de la Etapa 0 es **solo en línea**. Sin conexión, la pantalla de venta muestra un indicador permanente y un aviso, conserva el carrito (RN-OF-03), nunca da por registrada una venta que el servidor no confirmó (RN-OF-04) y permite **reintentar** con el mismo `id`. Los pilotos se eligen con **internet estable** (PQ-03) y se recomienda un respaldo de datos móviles (opción D). Desde el día 1 las ventas se diseñan **listas para la cola**: `id` de venta (UUID) generado en el cliente (RN-OF-01), `register_sale` idempotente, `sold_at` del dispositivo (RN-OF-02) y catálogo en caché local (DD-30). **La cola sin conexión (outbox + sincronizador, opción B) es de la Etapa 1** y se construye si los pilotos muestran cortes relevantes; no se construye modo contingencia propio en la Etapa 0. **Contexto:** founder, después de escribir esta KB. **Alternativas:** B ya en la Etapa 0 (más trabajo antes del piloto, ventas tardías, token vencido); A con contingencia en papel documentada (descartada: los pilotos se eligen con internet estable). **Trade-offs:** un corte prolongado frena el cobro (RE-01 residual), mitigado con la elección de los pilotos y el respaldo móvil; las reglas RN-OF-05 y RN-OF-06 y 13 §8.4 quedan como diseño para la Etapa 1. **Revisión:** al cierre del piloto, con los cortes reales observados.

### DD-32 — Infraestructura pagada desde el piloto (Etapa 0, Día 1) — **Decidida** (2026-10-01; resuelve PQ-19)
**Decisión:** planes **pagos** de Supabase (Pro: backups automáticos, sin pausas por inactividad) y Vercel (Pro: uso comercial permitido) desde el Día 1 del piloto. El costo se asume del fundador o se negocia con el cliente. **Justificación:** en la Etapa 0 el tráfico es bajo pero real; los backups y la disponibilidad son críticos para un negocio. **Trade-offs:** costo operativo inicial de ~USD 50/mes (Supabase Pro ~$25, Vercel Pro ~$20; 2026-10-01). **Alternativa descartada:** planes gratuitos en desarrollo y migración a pago en la Etapa 1 (riesgo de pausa o límites sorpresa durante el piloto; reescritura de entorno de producción).

### DD-33 — Entrada principal: cámara del celular y búsqueda por nombre; PC y lector USB opcionales — **Decidida** (2026-11-04; responde la parte de dispositivos de PQ-03)
**Decisión:** la entrada principal es la cámara del celular y la búsqueda por nombre. La PC es opcional; si hay lector USB se usa, pero no es requisito. **Contexto:** el fundador relevó que la mayoría de los kioscos chicos de Argentina no tiene lector; muchos no tienen PC y trabajan solo con el celular; algunos tienen PC. Solo las estaciones de servicio y las franquicias tienen lector, y ya usan (mal) un sistema de stock. **Consecuencias:** la pantalla de venta del celular es la principal; los botones de venta rápida y la búsqueda por nombre pesan más; el componente de escaneo soporta el lector USB, pero ninguna historia depende de él. **Trade-offs:** escanear con la cámara es algo más lento que con el lector; la métrica de < 10 s en la PC se mide solo donde haya lector.

### DD-34 — Base de productos compartida en dos niveles, desde el piloto — **Decidida** (2026-11-04; resuelve PQ-21)
**Decisión:** una base de productos común a todos los clientes (código de barras → nombre, marca, presentación) para que ningún kiosco arranque de cero. **Nunca** guarda precios, costos ni qué comercio carga o vende cada producto. Funciona en dos niveles. **Nivel 1:** el catálogo de cada comercio acepta lo que el comercio cargue, y sus errores no afectan a nadie más. **Nivel 2:** la base compartida acepta solo productos **verificados**, que vienen de una fuente oficial o pública (candidata: el dataset SEPA / Precios Claros, ~70.000 productos con código y descripción; Open Food Facts como respaldo) o de un código que cargaron 2 o más comercios distintos con el mismo nombre, o que aprobó el super-admin en una cola de revisión. Lo que crea un comercio entra "en revisión"; nunca pasa directo a la base compartida. Se rechazan automáticamente los códigos con dígito verificador inválido, los internos (prefijo 20–29, RN-CA-04) y los de peso variable. **Contexto:** el fundador pidió que la base "esté tal cual como están los productos", sin productos ni códigos inexistentes. Un dígito verificador válido prueba que el código está bien escrito, no que el producto exista: el registro oficial completo es de GS1 Argentina y no es público. **Alternativas:** catálogo maestro recién en la Etapa 1 (descartado: sin lector, la carga inicial es el mayor freno); usar listas de terceros (por ejemplo, el Excel de una franquicia) sin permiso escrito (descartado: son datos internos de otra empresa); consultar Open Food Facts en vivo en cada escaneo (descartado: poca cobertura de productos argentinos y servicio inestable). **Trade-offs:** toca la separación entre tenants, así que su change es de governance **ALTO** y su diseño se aprueba antes de programar. Al principio van a faltar productos, pero todo lo que esté en la base va a estar bien. Hay que verificar la licencia del SEPA (PQ-27) y citar la fuente que se use (Open Food Facts exige atribución y licencia ODbL).

## Supuestos inferidos

| ID | Supuesto | Origen | Riesgo si es falso | Cómo validar |
|---|---|---|---|---|
| SU-01 | Los pilotos tienen **PC o celular con internet** en el mostrador | Relevamiento §4 | No hay dónde vender; offline más urgente | PQ-03 |
| SU-02 | En el mostrador alcanza la **cámara del celular**; la PC y el lector USB son opcionales (DD-33) | Fundador (2026-11-04) | Con mala luz o un celular viejo, el escaneo por cámara frena la venta | Probar la cámara en el mostrador de cada piloto en la visita |
| SU-03 | Hay **un solo cajón** de efectivo por local | KB | El modelo de una caja por local queda corto | PQ-05 |
| SU-04 | Hay **varios turnos** y la caja se cierra en cada cambio | KB | El arqueo por turno sobra o no refleja la operación | PQ-05 |
| SU-05 | Los comercios tienen su **lista de productos en Excel/CSV** o similar | Relevamiento §3.7 | Alta del catálogo por escaneo, más lenta | PQ-08 |
| SU-06 | Volumen: 1.000–3.000 productos; 150–500 ventas por día; 1–3 ítems por venta | KB | Rendimiento de la venta y de las estadísticas | Primer mes de un piloto |
| SU-07 | En la práctica se vende primero lo que vence primero (**FEFO**) | KB | Saldo por lote inexacto; mitigado por DD-09 | Verificaciones de lote en el piloto |
| SU-08 | Umbrales de alerta de **7 días (próximo) y 3 días (crítico)** | KB | Demasiadas o muy pocas alertas | PQ-20; ajustar en la semana 1 |
| SU-09 | El personal conoce el **costo** al recibir (factura o remito con precios) | KB | Sin ganancia bruta ni valorización al costo | PQ-08; foto de un remito |
| SU-10 | Los envases con solo **mes/año** vencen el último día del mes | KB (práctica habitual) | Alertas corridas hasta 30 días | Validar en la visita |
| SU-11 | Región São Paulo; **planes pagos** de Supabase y Vercel desde el piloto | KB | Latencia; pausa; sin backups; uso comercial no permitido | PQ-19 |
| SU-12 | **No** se asume impresora térmica: el comprobante se muestra en pantalla y se imprime solo si hay impresora | KB | Clientes que exigen ticket impreso | PQ-03, PQ-24 |
| SU-13 | Los cobros por QR, alias y posnet se verifican **en el celular del dueño o en el posnet**, fuera del sistema | Relevamiento §3.2 | El control por medio requiere integración antes | PQ-04 |
| SU-14 | Los comercios redondean precios (a $10, $50 o $100) | KB | Redondeo innecesario o insuficiente | PQ-13 |
| SU-15 | Categorías sin vencimiento relevante (cigarrillos, recargas, accesorios) se marcan `tracks_expiry = false`; servicios, `tracks_stock = false` | KB | Carga innecesaria o alertas faltantes | Configurar con el dueño en la visita |
