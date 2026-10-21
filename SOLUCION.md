# SOLUCION.md — Reto 03: Órdenes de Compra SAP

## 1. Problema en una frase

La analista administrativa digita a mano, en SAP GUI, los mismos datos que ya están en la solicitud, la cotización y el correo de aprobación de cada compra; este agente valida y arma la orden de compra automáticamente, y solo le pregunta a ella lo que de verdad requiere criterio humano.

## 2. Arquitectura

```
┌──────────────┐  HTTP        ┌──────────────────────────────────────────────┐
│  web/ (chat) │ ───────────▶ │  src/server.ts (Express)                     │
│  index.html  │ ◀─────────── │   - POST /api/chat, GET /api/sessions/:id,   │
│  app.js      │              │     GET /api/health                          │
└──────────────┘              │   - carga agent/prompt.md + knowledge        │
                               └───────┬───────────────────────┬──────────────┘
                                       │                       │
                             src/agent-loop.ts          src/llm/adapter.ts
                          (ciclo: modelo ↔ herramientas)  + anthropic.ts
                                       │
                               src/tools/catalogo.ts
                          (registra cada export de oc.ts
                           como herramienta `oc_<export>`)
                                       │
                               src/tools/oc.ts
                          (contrato { ok, data } / { ok:false, error })
                                       │
      src/tools/lib/ (paquete, maestros, controles, payload, evidencia, control)
                                       │                       │
                         fixtures/ (solo lectura)      src/sap/mock.ts (implementa SapAdapter)
                                                                │
                                                        out/sap/ (SAP simulado)
```

- **Comportamiento** (reglas de confirmación, tono de error, flujo sugerido): `agent/prompt.md`.
- **Conocimiento** (qué significa cada control, cómo se deriva IVA/condiciones de pago, qué es una OC retroactiva): `src/knowledge/ordenes-compra.md`.
- **Ejecución** (única fuente de valores reales): `src/tools/oc.ts` y sus helpers en `src/tools/lib/`; el SAP simulado vive aparte, en `src/sap/`, detrás de la interfaz `SapAdapter` (sección 7.4 del PRD), para que una integración real solo implique escribir un nuevo archivo.

## 3. Ciclo del agente

Misma estructura que en los retos 01 y 02: `src/agent-loop.ts` manda el historial al modelo, ejecuta las herramientas que pida (validando argumentos con `zod` antes de ejecutar), y repite hasta `MAX_TOOL_ITERATIONS` (CA1, por defecto 25) o hasta que el modelo responda con texto final.

**Confirmación humana (CA3):** se agregó una sexta herramienta, `oc_solicitar_confirmacion`, que el prompt instruye llamar justo antes de preguntar cuando `oc_validar` devuelve `confirmaciones` no vacías. El backend marca `needsConfirmation: true` si esa herramienta se invocó en el turno. La barrera real está en `oc_crear`: revalida internamente el caso completo (no confía en el `payload` que pasa el modelo) y rechaza con `{ ok:false, error }` si hay bloqueos, o si hay confirmaciones pendientes sin `confirmado: true` — el modelo solo debe pasar `confirmado:true` cuando el mensaje inmediatamente anterior del usuario confirmó explícitamente.

## 4. Elección del modelo

**Proveedor:** Anthropic. **Modelo:** `claude-sonnet-5-5` (configurable por `LLM_MODEL`).

**Por qué:** igual razonamiento que en los retos anteriores — el agente orquesta llamadas a herramientas con reglas mecánicas (los diez controles son código, no criterio del modelo); lo que exige comprensión de lenguaje es decidir qué herramienta llamar y cómo explicarle a la analista por qué algo está bloqueado. Sonnet 5.5 cubre eso bien y es sustancialmente más barato que un modelo tope de gama para un proceso que hoy es de pocas compras al día.

**Costo estimado por caso:** con el prompt + conocimiento (~2 600 tokens) y un flujo típico de 3–4 llamadas (`leer_paquete`, `validar`, `construir_payload`, `crear` — a veces dos veces si hay confirmación), un caso individual ronda 10 000–15 000 tokens de entrada acumulados y 1 000–1 500 de salida. A $2 / $10 por millón de tokens, eso es del orden de **$0.03–0.06 USD por caso procesado** — estimación de orden de magnitud, no medición real de facturación.

## 5. Matriz de controles

| Código | Implementación | Tipo |
|---|---|---|
| RC1 | Busca el proveedor por NIT limpio (sin puntos ni dígito de verificación); si no hay NIT, por nombre normalizado. Bloquea si no existe o si `activo=false`. | Bloqueo |
| RC2 | Exige que exista `aprobacion.json`, que su cuerpo contenga la palabra "Aprobado", y que el remitente esté en la lista de aprobadores **del centro de costos de la solicitud** (no de cualquier centro). | Bloqueo |
| RC3 | Solo se evalúa si RC2 encontró un aprobador válido; compara `valor_total` contra su `tope`. | Bloqueo |
| RC4 | La `subarea` debe estar en la lista `subareas` del centro de costos. | Bloqueo |
| RC10 | `cantidad × valor_unitario` vs `valor_total`, con margen de ±1. | Bloqueo |
| RC5 | `abs(cotizacion.total − valor_total) / valor_total` vs 2%; sin cotización, confirmación directa. | Confirmación |
| RC6 | IVA ausente → se deriva del proveedor y se marca como confirmación con el valor propuesto. | Confirmación + derivado |
| RC7 | Condiciones de pago ausentes → se derivan del proveedor; a diferencia de RC6, **no** genera confirmación, solo se informa (no cambia cuánto se paga, solo cuándo). | Derivado |
| RC8 | Existe `factura.txt` con fecha anterior a `fecha_solicitud` → `retroactiva=true` + confirmación. | Confirmación |
| RC9 | Fecha de aprobación anterior a la fecha de la solicitud → confirmación. | Confirmación |

**La más difícil:** RC2. La primera versión solo verificaba "¿el remitente está en la lista de aprobadores de *algún* centro?", lo cual habría dejado pasar `sol-003` (Felipe Vargas es aprobador legítimo, pero de Comercial, no de Administración). Hubo que acotar la búsqueda al centro de costos exacto de la solicitud — es la diferencia entre "tiene autoridad" y "tiene autoridad *ahí*".

## 6. Diseño del adaptador SAP real

- **Opción elegida:** OData `API_PURCHASEORDER_PROCESS_SRV` (servicio estándar de SAP S/4HANA Cloud/On-Premise para órdenes de compra) sobre RFC/BAPI `BAPI_PO_CREATE1`. Razón: con la viabilidad de conexión sin confirmar, OData es más fácil de probar de forma aislada (REST sobre HTTPS, sin necesitar una pasarela RFC dedicada) y expone mejor los errores de validación campo por campo que un BAPI clásico — importante cuando el consumidor es un agente que necesita explicarle el error a un humano, no solo registrar un código de retorno.
- **Mapeo del payload (sección 7.4) a la estructura real:** `sociedad`/`organizacion_compras` → `CompanyCode`/`PurchasingOrganization` de la entidad `A_PurchaseOrder`; `proveedor.codigo_sap` → `Supplier`; `posiciones[]` → la entidad hija `A_PurchaseOrderItem` (uno por línea, mismo `numero` como `PurchaseOrderItem`); `indicador_iva` → `TaxCode` a nivel de ítem; `condiciones_pago` → `PaymentTerms` a nivel de cabecera. El PDF de evidencia se adjunta vía el servicio de `Attachment` asociado al documento (`API_CV_ATTACHMENT_SRV` o equivalente), referenciado por el número de OC ya creado.
- **Autenticación:** OAuth2 client credentials contra el SAP Cloud Connector / API Hub, con el `client_id`/`client_secret` en el gestor de secretos del entorno de despliegue (nunca en variables del agente ni en el prompt) — el backend los lee en tiempo de ejecución, igual que hoy lee `ANTHROPIC_API_KEY`.
- **Idempotencia frente a reintentos:** el mismo patrón que ya implementa `SapMock.buscarOrdenPorReferencia` — antes de crear, se consulta si ya existe una OC con ese número de solicitud (vía un campo de referencia libre en la cabecera, p. ej. `PurchaseOrderNote` o un campo Z custom). Si SAP responde error parcial (algunas posiciones se crearon, otras no — posible en BAPI con respuesta de mensajes por ítem), el agente no reintenta a ciegas: reporta el estado parcial y pide confirmación explícita antes de reintentar solo las posiciones fallidas.
- **Plan B si la conexión no es viable:** el agente igual ahorra tiempo generando, por cada caso aprobado, una fila lista para un archivo de carga masiva (`BAPI_PO_CREATE1` vía LSMW, o la plantilla de carga por Excel que ya usa el equipo de compras) — es literalmente el mismo payload que ya arma `oc_construir_payload`, solo cambia el destino de escritura de "llamar a SAP" a "agregar una fila a un CSV de carga". El `SapAdapter` ya aísla esto: una tercera implementación (`src/sap/carga-masiva.ts`) cubriría ese caso sin tocar las herramientas.

## 7. Lectura del proceso: OC retroactivas

A la dirección: hoy no se sabe qué porcentaje de compras se formaliza en SAP *después* de que la factura ya llegó, porque nadie lo mide — solo se nota cuando alguien necesita radicar una factura sin OC y tiene que crearla corriendo. Con los 6 casos de este reto, 1 de 6 (`sol-005`, ~17%) fue retroactiva; en producción esa cifra probablemente sea mayor, porque los casos que *sí* llegan completos con cotización son justamente los que siguieron el proceso.

El cambio de proceso que propondría no es prohibir las OC retroactivas de un día para otro (congelarían la operación si la causa raíz — falta de un canal único y de un plazo claro — no se corrige primero), sino: (1) medir el % mensual desde ya con el campo `retroactiva` que este agente ya produce, (2) fijar una meta de reducción trimestral, no un umbral binario, y (3) exigir, en los casos retroactivos, que el solicitante explique en una línea por qué se saltó la cotización — ese campo de texto libre, acumulado, es lo que eventualmente revela si el problema es de un proveedor recurrente, de un tipo de compra urgente mal cubierto por el proceso actual, o de falta de disciplina.

## 8. Decisiones y trade-offs

1. **`oc_crear` revalida internamente en vez de confiar en el `payload` que pasa el modelo.**
   Alternativa descartada: usar el `payload` recibido tal cual para decidir si hay bloqueos/confirmaciones pendientes (leyendo su propio arreglo `excepciones`). Se descartó porque el contrato de herramientas (CA2) exige que el modelo nunca pueda afirmar un valor no verificado — confiar en un payload que el modelo pudo haber alterado entre `oc_construir_payload` y `oc_crear` abriría esa puerta. `oc_crear` vuelve a leer el caso, lo revalida contra los maestros, y solo entonces decide; el `payload` recibido se acepta en el esquema por compatibilidad con el contrato del PRD, pero no es la fuente de la decisión.

2. **RC2 compara contra los aprobadores del centro de costos exacto de la solicitud, no contra la lista completa de aprobadores de la empresa.**
   Alternativa descartada (y la que se implementó primero, por error): validar solo que el remitente *sea* aprobador de *algún* centro. Se corrigió durante las pruebas contra `sol-003`, que existe específicamente para probar este caso — un aprobador real, pero sin autoridad ahí.

3. **`oc_leer_excel` (P1) lee un JSON de filas, no un `.xlsx` real.**
   Alternativa descartada: incorporar una librería de parseo de Excel (`xlsx`/`exceljs`) para esta única herramienta opcional. Se descartó porque ningún fixture trae un `.xlsx` real (todos vienen normalizados a `solicitud.json`) — añadir esa dependencia sin un caso de prueba real habría sido código sin forma de verificarse end-to-end, solo para marcar una casilla.

4. **`modulo/tools/oc.ts` reexporta en vez de duplicar**, igual que en los retos 01 y 02 (`export * from "../../src/tools/oc.js"`), y `modulo/agent.md` / `SKILL.md` se generan con `npm run build:modulo` desde los mismos `agent/prompt.md` y `src/knowledge/ordenes-compra.md`.

5. **Front de chat en HTML/CSS/JS plano**, sin build step, por la misma razón de los dos retos anteriores: no hay estado complejo que justifique un framework, y cumple mejor "un comando, menos de 2 minutos".

## 9. Supuestos

- Los maestros de los fixtures son la fuente de verdad completa para esta demo; en producción se consultarían en SAP en tiempo real (de hecho, `SapAdapter.consultarProveedor` ya modela esa consulta como una llamada independiente, aunque hoy lea el mismo fixture).
- El correo de aprobación es evidencia suficiente tal como lo pide el PRD; en una auditoría real podría exigirse firma digital, lo cual no cambia el payload, solo la fuente de `evidencia_sha256`.
- Cuando `oc_crear` resuelve un caso por idempotencia (la OC ya existía), no se vuelve a consultar la fecha de creación original — se reporta el número de OC con `fecha: ""`, porque el contrato de `SapAdapter.buscarOrdenPorReferencia` (sección 7.4 del PRD) solo devuelve `{ numero_oc }`, no la fecha.
- La unidad de medida de cada posición (`UN`/`H`/`MES`) se infiere de la palabra "horas" en la descripción; ningún caso de los fixtures necesitaba realmente `MES` como unidad (las menciones de "meses" en las descripciones son plazos de vigencia, no la unidad de cobro), así que esa rama no se ejerció contra un fixture real.

## 10. Cobertura de historias de usuario

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 (Leer el paquete) | Hecho | — |
| HU-2 (Validar contra maestros y controles) | Hecho | RC1–RC10 implementados y verificados contra los 6 casos. |
| HU-3 (Construir el payload) | Hecho | Validación con el esquema `zod` real (`OrdenCompraSchema.parse`), trazabilidad persistida en `out/<caso>/trazabilidad.json`. |
| HU-4 (Evidencia de aprobación) | Hecho (P0 txt + P1 pdf) | PDF generado con `pdf-lib`, texto simple sin membrete corporativo. |
| HU-5 (Crear la OC en SAP simulado) | Hecho | Idempotencia verificada reprocesando `sol-001`; `out/control.csv` registra los 4 resultados posibles. |
| HU-6 (Manejo de errores) | Hecho | Más casos de entrada corrupta además de "caso inexistente" (cubierto en `demo.ts`). |
| Front de chat (6.1) | Hecho | Streaming de la respuesta (quedó fuera por tiempo). |
| Backend + API mínima (6.1/6.4) | Hecho | Persistencia de sesiones en archivo (hoy es solo memoria). |
| Adaptador LLM (6.1) | Hecho (Anthropic) | Un segundo proveedor implementado para probar que el ciclo del agente no cambia. |
| `oc_leer_excel` (P1) | Parcial | Lee JSON de filas, no `.xlsx` real (ver decisión 3). |
| `demo.ts` (6.6) | Hecho | Determinismo verificado corriendo la demo dos veces y comparando `out/sap/ordenes.jsonl` (idéntico salvo `fecha`). |
| Diseño adaptador SAP real (7.5) | Hecho | — |
| Bonus `modulo/` (9.4) | Hecho | — |
| Despliegue público (9.3) | **No hecho en este entorno** | Desplegar en Render/Railway/Fly.io; aquí se corrió y verificó en local (`npm run dev` + `npm run demo`). |

## 11. Uso de IA

Esta solución fue construida con **Claude (Claude Code, modelo Sonnet 5)**, usado para:

- Leer el PRD y los fixtures, diseñar el contrato de herramientas (`src/tools/oc.ts`), la matriz de controles y el esquema `zod` del payload.
- Escribir todo el código: lectura/normalización del paquete, maestros, controles, construcción del payload, evidencia (txt + PDF con `pdf-lib`), adaptador SAP simulado, ciclo del agente, servidor y front.
- Ejecutar `npm run demo` de forma iterativa contra los 6 casos reales antes de dar por cerrado cada módulo. A diferencia del reto 02, la primera corrida completa ya coincidió con los seis resultados esperados por el PRD (incluida la idempotencia) — el único ajuste de diseño, no de bug, fue acotar RC2 al centro de costos exacto en vez de "cualquier centro" (ver decisión 2), encontrado leyendo con cuidado el fixture `sol-003` antes de escribir el código, no después.

No se usó ningún otro asistente de IA en esta sesión. Lo que **no** se adoptó de las primeras ideas: usar el `payload` que pasa el modelo a `oc_crear` como fuente de verdad para decidir si hay bloqueos — se descartó por el requisito de CA2 (ver decisión 1).

> Nota para quien presente este reto: revisa cada archivo de `src/` antes de la defensa, en particular `src/tools/lib/controles.ts` — es donde vive toda la matriz RC1–RC10, y es la pieza que más preguntas suele generar en la sustentación.

## 12. Riesgos de llevar esto a producción

- **Los maestros de los fixtures son estáticos; en producción cambian constantemente** (nuevos proveedores, aprobadores que rotan de cargo). Mitigación: el `SapAdapter` ya aísla la consulta de proveedor como una llamada independiente (`consultarProveedor`), lista para apuntar a SAP real sin tocar `oc_validar`.
- **RC5 (cotización vs. solicitud) con un umbral fijo de 2% puede ser demasiado estricto o laxo según el tipo de compra.** Mitigación recomendada: hacer el umbral configurable por centro de costos o por rango de valor, no una constante global.
- **El modelo podría, en teoría, "ajustar" un monto para que la cotización cuadre con la solicitud.** Mitigación ya aplicada: el valor que se registra en la OC sale siempre de `oc_construir_payload`/`oc_crear` (que revalida internamente), nunca del texto libre del modelo.
- **Sin prompt caching**, cada llamada reenvía el system prompt completo; irrelevante al volumen actual, relevante si el proceso escala a todas las compras del grupo.
- **Sesiones solo en memoria**: un reinicio del proceso pierde el historial de conversación en curso.
- **Dependencia de un solo proveedor de LLM**: el adaptador aísla esto, pero solo hay una implementación (`AdaptadorAnthropic`).
- **Quién decide la política sobre OC retroactivas** (tolerarlas con marca, o rechazarlas) es una decisión de negocio fuera del alcance de este reto — el agente las mide (RC8 + `control.csv`), no las resuelve.
