# 06 — Funcionalidades

Organizadas por **épica** e **historia de usuario** (US-NNN). Cada criterio de aceptación es candidato directo a escenario de spec y a test (Strict TDD).

**Prioridad (derivada del piloto, ver 12):** **[D1]** tiene que estar el Día 1 del piloto · **[M1]** puede llegar durante el mes del piloto · **[D30]** tiene que estar el Día 30 · **[E1]** Etapa 1 · **[COND PQ-NN]** depende de una pregunta abierta. **(LT)** marca las historias que nacen de una propuesta del lead técnico que el fundador tiene que validar (PQ-06).

> La numeración se reinició con el pivot (2026-10-01).

## Mapa de épicas

| Épica | Historias | Prioridad dominante |
|---|---|---|
| E1 Plataforma, tenancy y acceso | US-001 a US-005 | D1 |
| E2 Catálogo y precios | US-010 a US-018 | D1 (alta y precios) / M1 (masiva) |
| E3 Ventas | US-020 a US-026 | D1 |
| E4 Pagos | US-030 a US-033 | D1 |
| E5 Caja | US-040 a US-045 | D1 |
| E6 Proveedores y compras | US-050 a US-054 | D1 |
| E7 Vencimientos y mermas | US-060 a US-064 | D1 |
| E8 Stock y conteos | US-070 a US-073 | D1 (inicial) / D30 (final) |
| E9 Estadísticas | US-080 a US-088 | M1 → D30 |
| E10 PWA, dispositivos y UX | US-090 a US-095 | D1 |

---

## E1 — Plataforma, tenancy y acceso

### US-001 — Alta de cliente [D1]
**Como** super-admin **quiero** crear una organización con sus locales e invitar a sus usuarios con su rol **para** dejar operativo a un comercio en la visita de configuración.
- [ ] Crear una organización (nombre, slug, zona horaria) y uno o más locales.
- [ ] Al crear la organización se generan los 6 medios de pago por defecto; al crear un local, su "Caja 1".
- [ ] Invitar por email con rol `owner`/`manager`/`employee` y locales asignados. El invitado define su contraseña en `/actualizar-contrasena`.
- [ ] Deshabilitar una membresía corta el acceso en la siguiente consulta.
- [ ] Cada acción queda en `audit_events`.
**Reglas:** RN-TE-04, RN-AU-01, RN-AU-04, RN-AU-05, RN-PA-02, RN-CJ-02.

### US-002 — Ingreso [D1]
**Como** usuario invitado **quiero** entrar con email y contraseña **para** operar en mis locales.
- [ ] Credenciales inválidas → mensaje genérico, sin revelar si el email existe.
- [ ] `employee` con un solo local entra directo a `/l/[id]/vender`; `owner` entra a estadísticas en el celular y a la venta en la PC (**Suposición**). Con varios locales, selector.
- [ ] La sesión persiste en el dispositivo; el nombre del usuario activo está siempre visible.
**Reglas:** RN-AU-02, RN-AU-03.

### US-003 — Recuperar contraseña [D1]
**Como** usuario **quiero** recuperar mi contraseña por email **para** no depender del fundador.
- [ ] El link de recupero pasa por `/auth/confirm` y lleva a `/actualizar-contrasena`.
- [ ] Un link vencido o usado muestra un error claro con la opción de pedir otro.

### US-004 — Contexto de local [D1]
**Como** `owner` con varios locales **quiero** cambiar de local **para** operar o ver cada uno.
- [ ] El local activo va en la URL. Acceder a un local sin permiso → 404 (sin filtrar su existencia).
**Reglas:** RN-TE-03, DD-24.

### US-005 — Aislamiento verificado [D1]
**Como** fundador **quiero** la garantía de que un comercio nunca ve datos de otro **para** operar como SaaS desde el día 1.
- [ ] Tests pgTAP por tabla: un usuario de la organización A no lee, no inserta y no actualiza filas de B (incluye ventas, pagos, sesiones y movimientos de caja).
- [ ] Test de que las FKs compuestas impiden referenciar un producto, un medio de pago o una sesión de otra organización.
- [ ] El CI falla si una tabla de `public` no tiene RLS habilitado.
**Reglas:** RN-TE-02, RN-TE-08.

## E2 — Catálogo y precios

### US-010 — Importar el catálogo desde Excel/CSV [D1]
**Como** super-admin u `owner` **quiero** importar la lista de productos del comercio **para** no cargarla a mano en el alta.
- [ ] Mapeo de columnas (código, nombre, precio, costo, categoría, proveedor) con plantilla autodetectada o asistente.
- [ ] Previsualización con altas, actualizaciones, sin cambios, conflictos y errores, antes de confirmar.
- [ ] En una reimportación, el usuario elige qué campos actualizar; nunca se pisan los campos locales ni se borran productos.
- [ ] **Alternativa** si el comercio no tiene lista: el catálogo se arma escaneando (US-012) durante el conteo inicial o las primeras ventas.
**Reglas:** RN-IM-01 a RN-IM-12. Ver 11.

### US-011 — Encontrar un producto escaneando o buscando [D1]
**Como** cajero **quiero** escanear con el lector USB o la cámara, o buscar por nombre, **para** encontrar el producto al instante.
- [ ] El lector USB (modo teclado + Enter) funciona en la pantalla de venta aunque el foco no esté en el campo (detección por velocidad de tipeo).
- [ ] Cámara: `BarcodeDetector` si existe; si no, ZXing (iOS).
- [ ] La búsqueda usa la caché local del catálogo: < 200 ms, tolera ceros a la izquierda y busca por texto parcial sin acentos.
**Reglas:** RN-CA-03.

### US-012 — Alta rápida de un producto desconocido [D1]
**Como** cajero **quiero** dar de alta un producto que no está, sin salir del flujo, **para** no frenar la venta, la recepción ni el conteo.
- [ ] Un código desconocido abre una hoja con el código precargado; pide nombre y, desde la venta, precio.
- [ ] Desde la venta, también ofrece "vender como ítem manual" sin dar de alta.
- [ ] Al guardar, vuelve al flujo con el producto agregado.
**Reglas:** RN-CA-05, RN-VT-05.

### US-013 — Editar producto [D1]
**Como** `manager` **quiero** editar nombre, códigos, categoría, unidad, si controla stock y vencimiento, stock mínimo, costo de referencia y proveedor habitual **para** ajustar el catálogo.
- [ ] Agregar o quitar códigos, validando unicidad en la organización.
- [ ] Desactivar en lugar de borrar.
**Reglas:** RN-CA-02, RN-CA-06, RN-CA-07, RN-CA-09, RN-CA-11.

### US-014 — Código interno [M1]
**Como** `manager` **quiero** generar un código interno para un producto sin código **para** imprimirlo o escanearlo.
- [ ] Genera un EAN-13 con prefijo 20–29 y dígito verificador válido.
**Reglas:** RN-CA-04.

### US-015 — Botones de venta rápida [D1] (LT)
**Como** `owner` **quiero** armar una grilla de botones para los productos sin código (sueltos, granel, servicios) **para** venderlos con un toque o una tecla.
- [ ] Asignar posición y etiqueta corta; reordenar.
- [ ] En la PC, cada botón tiene una tecla de acceso.
**Reglas:** RN-CA-08, RN-CA-09.

### US-016 — Cambiar el precio de un producto [D1]
**Como** `owner` o `manager` **quiero** cambiar el precio de venta **para** reflejar un aumento.
- [ ] Muestra el costo y el margen resultante; avisa si queda por debajo del costo.
- [ ] El cambio queda en el historial.
**Reglas:** RN-PC-01, RN-PC-02, RN-PC-08.

### US-017 — Actualización masiva de precios por % [M1] (LT)
**Como** `owner` **quiero** aumentar (o bajar) por % los precios de una categoría, de un proveedor o de una selección **para** actualizar rápido cuando hay aumentos.
- [ ] Elegir alcance, porcentaje y redondeo; previsualización obligatoria con precio actual, nuevo y margen; excluir productos.
- [ ] Aplicar en una sola transacción; la pantalla de venta toma los precios nuevos en la siguiente sincronización de la caché.
**Reglas:** RN-PC-03, RN-PC-04, RN-PC-06.

### US-018 — Historial y reversión de precios [M1]
**Como** `owner` **quiero** ver el historial de precios y revertir una actualización masiva **para** corregir un error.
- [ ] Revertir solo restaura los productos que no cambiaron de precio después.
**Reglas:** RN-PC-02, RN-PC-05.

## E3 — Ventas

### US-020 — Vender en la PC con teclado y lector [D1]
**Como** cajero en la PC **quiero** escanear, ajustar cantidades y cobrar sin tocar el mouse **para** atender rápido.
- [ ] Foco permanente en el campo de escaneo; atajos para cantidad, quitar línea, buscar, venta rápida, cobrar y cancelar (08 §Pantalla de venta).
- [ ] Repetir un escaneo suma 1 a la línea.
- [ ] Objetivo: 3 ítems + efectivo en < 10 s (**Suposición**).
**Reglas:** RN-VT-01 a RN-VT-03, RN-GL-07.

### US-021 — Vender en el celular con la cámara [D1]
**Como** cajero con el celular **quiero** escanear con la cámara y cobrar con una mano **para** vender sin PC.
- [ ] Cámara continua en la pantalla de venta; botones grandes; carrito y total siempre visibles.
**Reglas:** RN-VT-01, RN-GL-07.

### US-022 — Venta rápida e ítem manual [D1] (LT)
**Como** cajero **quiero** vender productos sin código con un botón, o cargar un ítem manual (descripción + importe), **para** no frenar la venta.
- [ ] El ítem manual no descuenta stock y queda identificado.
**Reglas:** RN-VT-04, RN-CA-08.

### US-023 — Comprobante interno [D1]
**Como** cajero **quiero** mostrar o imprimir un comprobante de la venta **para** dárselo al cliente si lo pide.
- [ ] Incluye la leyenda **"Comprobante no válido como factura"**, número interno, fecha y hora, ítems, total y pagos (recibido y vuelto).
- [ ] Impresión del navegador con formato para papel térmico (opcional según PQ-03).
**Reglas:** RN-VT-08.

### US-024 — Anular una venta [D1] (LT)
**Como** `manager` (o el cajero dentro de la ventana) **quiero** anular una venta con motivo **para** corregir un error o una devolución.
- [ ] Exige motivo; la venta y sus pagos quedan `voided`; el stock y el efectivo esperado se recalculan.
- [ ] Si la sesión de la venta ya cerró: se informa "posterior al cierre" y se ofrece registrar la devolución de efectivo en la sesión abierta.
- [ ] Botón "anular y rehacer": abre un carrito nuevo con las mismas líneas.
**Reglas:** RN-VT-09, RN-VT-10, RN-VT-14.

### US-025 — Historial de ventas [D1]
**Como** cajero o `manager` **quiero** ver las ventas del turno y del día con su desglose de pagos **para** encontrar una venta y reimprimirla o anularla.
- [ ] Filtros por sesión, fecha, medio de pago, estado y número.
**Reglas:** RN-VT-12.

### US-026 — Precio modificado en el carrito [COND PQ-11]
**Como** `manager` **quiero** cambiar el precio de una línea antes de cobrar **para** resolver un precio desactualizado sin frenar la venta.
- [ ] La línea queda marcada y aparece en el control del dueño.
**Reglas:** RN-VT-13.

## E4 — Pagos

### US-030 — Cobrar con pagos combinados [D1]
**Como** cajero **quiero** dividir el cobro en varios medios (por ejemplo, mitad Mercado Pago y mitad efectivo) **para** aceptar cómo quiera pagar el cliente.
- [ ] Por defecto "todo en efectivo"; al agregar otro medio se propone el saldo pendiente.
- [ ] No se confirma hasta que el pendiente sea $0. Cada venta muestra su desglose por medio.
- [ ] En la PC, cada medio tiene una tecla (1–9).
**Reglas:** RN-PA-01, RN-PA-04, RN-PA-06, RN-PA-10.

### US-031 — Efectivo con vuelto [D1] (LT)
**Como** cajero **quiero** cargar con cuánto paga el cliente y ver el vuelto **para** no equivocarme.
- [ ] Atajos de billetes comunes; el vuelto se muestra grande.
**Reglas:** RN-PA-05.

### US-032 — Configurar medios de pago [D1]
**Como** `owner` **quiero** activar, renombrar, ordenar o agregar medios (por ejemplo, "Cuenta DNI") **para** que el cobro refleje cómo cobra mi comercio.
- [ ] El efectivo no se puede desactivar. Un medio desactivado se mantiene en el historial.
**Reglas:** RN-PA-02, RN-PA-03, RN-PA-08, RN-PA-09.

### US-033 — Referencia del pago [M1]
**Como** cajero **quiero** anotar el número de operación de una transferencia o QR **para** encontrarlo si hay un reclamo.
**Reglas:** RN-PA-07, RN-PA-09.

## E5 — Caja

### US-040 — Abrir la caja [D1]
**Como** cajero **quiero** abrir la caja de mi turno con el monto inicial **para** empezar a vender.
- [ ] Propone lo contado en el cierre anterior; si cambio el monto, queda la diferencia entre turnos.
- [ ] Si hay una sesión olvidada abierta, pide cerrarla primero.
**Reglas:** RN-CJ-01 a RN-CJ-03, RN-CJ-12.

### US-041 — Movimientos de caja [D1]
**Como** cajero **quiero** registrar un gasto, un pago a proveedor, un retiro o un aporte **para** que la caja cierre.
- [ ] Gasto con descripción obligatoria; pago a proveedor con proveedor y compra opcional.
- [ ] Anular un movimiento: `owner`/`manager`, con la sesión abierta.
**Reglas:** RN-CJ-04, RN-CJ-05, RN-CJ-13.

### US-042 — Cerrar la caja con arqueo [D1]
**Como** cajero **quiero** contar el efectivo y cerrar mi turno **para** dejar registrado si sobra o falta.
- [ ] Arqueo ciego: ingreso lo contado (con ayuda por billetes) antes de ver el esperado.
- [ ] Muestra esperado, contado y diferencia; si supera la tolerancia, pide una nota.
- [ ] Guarda el resumen congelado del turno.
**Reglas:** RN-CJ-06 a RN-CJ-09, RN-CJ-11.

### US-043 — Totales por medio para control [D1]
**Como** `owner` **quiero** ver cuánto entró por cada medio en el turno y, opcionalmente, cargar lo que dice Mercado Pago o el banco **para** controlar a mano.
**Reglas:** RN-CJ-10.

### US-044 — Historial de cajas [M1]
**Como** `owner` **quiero** ver las sesiones cerradas con su diferencia, sus movimientos y quién las abrió y cerró **para** detectar problemas.
**Reglas:** RN-CJ-11, RN-ES-09.

### US-045 — Cierre forzado [M1]
**Como** `manager` **quiero** cerrar sin arqueo una sesión olvidada **para** destrabar la caja; queda marcado.
**Reglas:** RN-CJ-12.

## E6 — Proveedores y compras

### US-050 — Alta rápida de proveedor [D1]
**Como** empleado **quiero** crear un proveedor escribiendo solo su nombre **para** registrar el ingreso sin demora.
- [ ] Un nombre parecido a uno existente genera un aviso antes de crear.
**Reglas:** RN-PR-01, RN-PR-02.

### US-051 — Gestión de proveedores [M1]
**Como** `manager` **quiero** editar y unificar proveedores duplicados **para** tener compras por proveedor confiables.

### US-052 — Registrar un ingreso con vencimientos [D1]
**Como** empleado **quiero** escanear cada producto recibido y cargar cantidad, vencimiento y costo **para** que el sistema sepa qué entra, cuánto cuesta y cuándo vence.
- [ ] Flujo: proveedor (opcional) → escanear → cantidad → vencimiento → costo → siguiente.
- [ ] Si el producto controla vencimiento, la fecha es obligatoria; otra fecha va en otra línea.
- [ ] Al confirmar: crea un lote por ítem con vencimiento y ofrece **"Pagado desde la caja: $…"**.
- [ ] Objetivo: 10 ítems en < 3 min (**Suposición**).
**Reglas:** RN-CO-01 a RN-CO-06, RN-CO-08, RN-CO-09, RN-VE-01.

### US-053 — Anular un ingreso [M1]
**Como** `manager` **quiero** anular un ingreso cargado con error **para** corregir el stock y los lotes.
**Reglas:** RN-CO-07, RN-CO-10, RN-GL-04.

### US-054 — Historial de ingresos [M1]
**Como** `manager` **quiero** ver los ingresos por fecha y proveedor **para** controlarlos contra las facturas.

## E7 — Vencimientos y mermas

### US-060 — Panel de vencimientos [D1]
**Como** empleado **quiero** ver qué está vencido, qué vence hoy, qué es crítico y qué es próximo **para** retirarlo u ofertarlo a tiempo.
- [ ] Grupos por nivel; fila = producto + fecha, con saldo estimado "≈ N u.".
- [ ] Contador visible en la pantalla de venta (sin interrumpirla).
**Reglas:** RN-VE-02, RN-VE-03, RN-VE-05, RN-VE-08.

### US-061 — Actuar sobre una alerta [D1]
**Como** empleado **quiero** marcar "puse en oferta", "retiré N", "no queda" o "quedan N" **para** mantener la lista al día.
**Reglas:** RN-VE-04, RN-VE-06, RN-ME-02.

### US-062 — Configurar umbrales [M1]
**Como** `owner` **quiero** ajustar los días de aviso y de estado crítico, por organización y por categoría.
**Reglas:** RN-VE-03.

### US-063 — Registrar una merma [D1]
**Como** empleado **quiero** registrar un producto vencido, roto u otra pérdida escaneándolo **para** que la pérdida quede valorizada.
**Reglas:** RN-ME-01 a RN-ME-06.

### US-064 — Anular una merma [M1]
**Como** `manager` **quiero** anular una merma cargada por error, con motivo.
**Reglas:** RN-GL-04.

## E8 — Stock y conteos

### US-070 — Consultar stock [M1]
**Como** `owner` o `manager` **quiero** ver el stock calculado por producto, con los que están bajo mínimo, negativos o sin conteo **para** reponer y detectar errores.
**Reglas:** RN-ST-01, RN-ST-04, RN-ST-08.

### US-071 — Conteo inicial con vencimientos [D1, puede completarse en la semana 1]
**Como** `manager` **quiero** abrir el conteo inicial y que el equipo escanee cantidades y fechas de vencimiento **para** tener la base de stock y alertas.
- [ ] Carga por sectores; varios usuarios en paralelo; alta rápida de desconocidos.
- [ ] Cada fecha declarada crea un lote de apertura.
**Reglas:** RN-ST-03, RN-ST-05, RN-VE-07, RN-ST-11.

### US-072 — Conteos parciales y final [M1 parcial · D30 final]
**Como** `manager` **quiero** hacer conteos parciales y el final **para** medir diferencias.
- [ ] Los productos no contados no se asumen en cero.
**Reglas:** RN-ST-02, RN-ST-06, RN-ST-07.

### US-073 — Diferencias de un conteo [M1]
**Como** `owner` **quiero** ver por producto la diferencia entre lo contado y el stock teórico, valorizada **para** detectar faltantes.
- [ ] Resultado congelado al cerrar; aviso y recálculo si llegaron ventas tardías.
**Reglas:** RN-ST-09, RN-ES-06.

## E9 — Estadísticas

### US-080 — Resumen de ventas [D1 básico · M1 completo]
**Como** `owner` **quiero** ver ventas por día, turno y medio de pago, y el ticket promedio **para** saber cómo va el negocio.
- [ ] D1: ventas de hoy por medio de pago. M1: rangos y comparación con el período anterior.
**Reglas:** RN-ES-01, RN-ES-08, RN-ES-12.

### US-081 — Horas pico [M1]
**Como** `owner` **quiero** ver en qué horas y días se vende más **para** organizar turnos y reposición.
**Reglas:** RN-ES-02.

### US-082 — Ganancia bruta y margen por producto [M1]
**Como** `owner` **quiero** ver cuánto gané y el margen de cada producto **para** decidir precios.
- [ ] Muestra la cobertura de costo.
**Reglas:** RN-ES-03, RN-ES-04.

### US-083 — Más vendidos y baja rotación [M1]
**Como** `owner` **quiero** ver qué se vende más y qué no rota **para** comprar mejor.
**Reglas:** RN-ES-05.

### US-084 — Pérdidas valorizadas [D30]
**Como** `owner` **quiero** ver cuánto perdí por vencidos, mermas y faltantes de conteo **para** atacar la causa.
- [ ] Desglose por tipo y por base de valorización; sobrantes aparte.
**Reglas:** RN-ES-06, RN-ME-03.

### US-085 — Compras por proveedor [M1]
**Como** `owner` **quiero** ver cuánto le compré a cada proveedor en el período.
**Reglas:** RN-ES-07.

### US-086 — Control del dueño [M1]
**Como** `owner` **quiero** ver anulaciones, diferencias de caja, cierres forzados, precios modificados e ítems manuales, por usuario **para** detectar errores o abusos.
**Reglas:** RN-ES-09, RN-ES-10.

### US-087 — Resumen del dueño en el celular [M1]
**Como** `owner` **quiero** un resumen en el celular (ventas de hoy, caja abierta, ganancia del mes, vencidos de la semana) **para** consultar de forma remota.
- [ ] Imprimible / PDF para la reunión de cierre del piloto (D30).
**Reglas:** RN-ES-11, RN-ES-13.

### US-088 — Tablero de uso del piloto [M1]
**Como** super-admin **quiero** ver la adopción por local (días con ventas, cajas cerradas con arqueo, compras cargadas, alertas atendidas) **para** intervenir a tiempo.
- [ ] Solo metadatos agregados; sin montos en la UI por defecto (**Suposición**).

## E10 — PWA, dispositivos y UX

### US-090 — Instalar como app [D1]
- [ ] Manifest con nombre `[NOMBRE-PRODUCTO]`, íconos y `display: standalone`; se instala en Android, iOS y en la PC (Chrome/Edge).

### US-091 — Componente de escaneo único [D1]
- [ ] Un solo componente para lector USB y cámara, reutilizado en venta, compras, mermas y conteos, con feedback sonoro o háptico.

### US-092 — Atajos de teclado de la pantalla de venta [D1]
- [ ] Mapa de atajos visible (tecla `?`), sin usar teclas reservadas del navegador (08 §Pantalla de venta).

### US-093 — Sin conexión [D1 · decidida (DD-31)]
- [ ] **Etapa 0 (Día 1):** indicador permanente de conexión, carrito persistido, reintento idempotente y nunca una venta "fantasma" (RN-OF-01 a RN-OF-04; el piloto elige pilotos con internet estable).
- [ ] **Cola sin conexión (Etapa 1):** vender sin conexión con el catálogo en caché y sincronizar al volver (RN-OF-05, RN-OF-06; 13 §8; se construye si los pilotos muestran cortes relevantes).

### US-094 — Entrada rápida de vencimientos [D1]
- [ ] Teclado numérico que acepta `DDMMAA`, `DDMMAAAA` o `MMAA` (último día del mes), con vista previa "vence en N días".
**Reglas:** RN-CO-05, RN-CO-06.

### US-095 — Layout responsive [D1]
- [ ] La pantalla de venta tiene un layout de PC (carrito + total + atajos) y uno de celular (cámara + carrito colapsable + botón de cobro); el resto de las pantallas es responsive.
**Reglas:** RN-GL-07, DD-04.
