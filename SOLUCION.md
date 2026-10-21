# SOLUCION.md — Reto 02: Registro de Contratos Vigentes

## 1. Problema en una frase

El maestro de contratos de Periferia está congelado desde el 2026-05-30 porque dependía de una persona que ya no está; este agente es el punto único de recepción que vuelve a alimentarlo sin depender de nadie, extrayendo los datos del contrato que llega al buzón en vez de transcribirlos a mano.

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
                          (registra cada export de contratos.ts
                           como herramienta `contratos_<export>`)
                                       │
                               src/tools/contratos.ts
                          (contrato { ok, data } / { ok:false, error })
                                       │
         src/tools/lib/ (extraccion, clasificacion, csv, registro, alertas, buzon)
                                       │
                         fixtures/ (solo lectura)   out/ (escritura)
```

- **Comportamiento** (reglas de confirmación, tono de error, flujo sugerido): `agent/prompt.md`.
- **Conocimiento** (reglas de clasificación, convenciones de extracción, vigencia de pólizas): `src/knowledge/registro-contratos.md`.
- **Ejecución** (única fuente de valores reales): `src/tools/contratos.ts` y sus helpers en `src/tools/lib/`.

`src/server.ts` concatena `agent/prompt.md` + `src/knowledge/registro-contratos.md` en un único system prompt; cambiar una regla de clasificación o de extracción no toca el servidor ni el ciclo del agente.

## 3. Ciclo del agente

Idéntico en estructura al del reto 01: `src/agent-loop.ts` manda el historial al modelo, ejecuta las herramientas que pida (validando argumentos con `zod` antes de ejecutar), y repite hasta `MAX_TOOL_ITERATIONS` (CA1, por defecto 25) o hasta que el modelo responda con texto final.

**Confirmación humana (CA3/RN5):** se agregó una sexta herramienta, `contratos_solicitar_confirmacion`, que el prompt instruye llamar justo antes de preguntar si hay campos en `requiere_revision`. El backend marca `needsConfirmation: true` en la respuesta de la API cuando esa herramienta se invocó en el turno. La barrera real está en `contratos_registrar`: si `requiere_revision` no está vacío y `confirmado` no es `true`, devuelve `{ ok:false, error:"requiere revisión: ..." }` sin escribir nada — el modelo solo debe volver a llamarla con `confirmado:true` cuando el mensaje inmediatamente anterior del usuario confirmó explícitamente.

## 4. Elección del modelo

**Proveedor:** Anthropic. **Modelo:** `claude-sonnet-5-5` (configurable por `LLM_MODEL`).

**Por qué:** el agente orquesta llamadas a herramientas con reglas relativamente mecánicas (leer, extraer, validar, registrar, alertar); la parte que de verdad exige comprensión de lenguaje — decidir qué herramienta llamar y cuándo pedir confirmación — no necesita un modelo de gama alta. Sonnet 5.5 tiene buen soporte de tool use y es sustancialmente más barato que un modelo tope de gama, lo cual importa porque este proceso corre sobre un buzón que recibe pocos mensajes al mes mezclados con picos de regularización (el cierre del gap de junio–agosto).

**Costo estimado por caso:** con el prompt + conocimiento (~2 300 tokens) y un flujo típico de 4 llamadas por mensaje (leer_buzon una vez por lote, extraer, validar, registrar) más el reporte de alertas al final, un lote de 6 mensajes como el de los fixtures ronda 20 000–28 000 tokens de entrada y 2 000–3 000 de salida acumulados en toda la sesión. A $2 / $10 por millón de tokens, eso es del orden de **$0.07–0.10 USD por lote completo de 6 mensajes** (no por mensaje individual) — una estimación de orden de magnitud, no una medición real de facturación. El adaptador no implementa *prompt caching* todavía; es la optimización de costo más obvia si el volumen crece (ver sección 11).

## 5. Estrategia de extracción

La extracción es 100% determinista (regex y heurísticas sobre `contrato.txt`/`otrosi.txt`), sin ningún llamado al modelo — cumple el requisito P0 de HU-2 y hace que `demo.ts` corra sin clave. El modelo del agente nunca ve el texto crudo del contrato para "adivinar" un dato: solo ve lo que `contratos_extraer` ya estructuró.

- **Partes (cliente/NIT):** se busca el patrón `<NOMBRE>, [identificado(a) con] (NIT|RUC|RTN) <número>` a partir de la primera aparición de la palabra "Entre" (antes de eso solo hay título del documento). Se descarta cualquier parte cuyo nombre contenga "PERIFERIA" o cuyo NIT limpio sea el de Periferia — así queda siempre la contraparte, sin importar si aparece primero o segundo. El NIT se limpia de puntos y, si tiene el formato colombiano con dígito de verificación (`890.900.111-4`), se descarta ese último dígito.
- **País:** en orden — nombre de país explícito *dentro del segmento del cliente* (nunca el domicilio de Periferia, que casi siempre dice "Medellín, Colombia" y contaminaría la inferencia si se buscara en todo el documento), luego ciudad conocida, luego tipo de identificador (NIT→CO, RTN→HN), luego longitud del RUC (13→EC, 11→PE, 9→PA).
- **Objeto:** se captura el cuerpo de la cláusula "OBJETO." tal como aparece, hasta la siguiente cláusula en mayúsculas o el final del documento; se trunca a 200 caracteres en el último espacio (nunca a mitad de palabra).
- **Valor:** el texto siempre repite el monto en cifras entre paréntesis junto al monto en palabras (p. ej. "DOSCIENTOS SESENTA Y CINCO MILLONES... (COP $265.000.000)"). Se usa esa cifra — nunca se interpreta el monto en palabras. Un contrato "por demanda" sin valor fijo se detecta por frase ("no tiene un valor determinado") y se registra como `valor=0, valor_indeterminado=true` con confianza baja.
- **Plazo:** se buscan fechas con el patrón `(DD) de MES de AAAA` dentro de la cláusula PLAZO, clasificando cada una como inicio o fin según si la palabra "desde" o "hasta" aparece más cerca antes de ella (buscando en todo el texto anterior, no en una ventana fija — una frase como "hasta el primero (1) de..." aleja la palabra clave del paréntesis lo suficiente para que una ventana corta la pierda). Si no hay fecha de fin explícita pero sí una duración en meses, se deriva sumando los meses y restando un día — la misma convención que usan los propios contratos cuando si dan ambas fechas. Si ni siquiera hay un día exacto de firma (solo "en el mes de agosto de 2026"), se asume el primer día del mes siguiente como fecha de inicio.
- **Otrosíes:** un documento que empieza con "OTROSÍ" y que modifica una cláusula no repite el formato "<ORDINAL>. <PALABRA_CLAVE>. <texto>"; en su lugar dice `"...cláusula X (VALOR), la cual quedará así: "<texto nuevo>""`. La extracción de cláusulas prueba primero el formato directo y si no encuentra nada, prueba este segundo formato entre comillas.
- **Póliza:** se busca `póliza(s) de <tipo>` en todo el documento. Si no hay cláusula de objeto identificable (típico de un otrosí que no la repite), no se afirma ni la presencia ni la ausencia de póliza — queda `null` para que la actualización conserve el valor ya existente en el maestro en vez de borrarlo con un falso negativo.

### Cálculo de confianza

No hay un modelo de confianza estadístico: es una tabla de reglas, documentada y reproducible.

| Situación | Confianza |
|---|---|
| Coincidencia directa de regex sobre un valor explícito (NIT, fecha con día exacto, monto entre paréntesis) | 0.9–0.95 |
| Inferencia razonable pero no textual (fecha de inicio asumida al primer día del mes siguiente; moneda asumida por país cuando el valor es indeterminado) | 0.8–0.85 |
| Dato detectado pero inherentemente incierto (valor indeterminado; fecha de fin derivada sumando meses a una fecha ya aproximada) | 0.5–0.6 |
| Campo no encontrado en el texto | 0 |

Cualquier campo con confianza < 0.8 entra a `requiere_revision` (RN5) — **excepto** `comercial`, que nunca bloquea (HU-3: "un remitente desconocido se reporta pero no bloquea"), y excepto los campos que un otrosí simplemente no toca (quedan `null`, se conservan del maestro, no se evalúan como "dudosos").

## 6. Regla de gobierno propuesta

1. **Canal único:** `contratos@periferia-ficticia.com`. Lo administra la analista administrativa (hoy dueña del maestro); es también la única destinataria autorizada para decidir excepciones.
2. **Obligación del comercial:** enviar el PDF firmado por ambas partes dentro de los 3 días hábiles siguientes a la firma, y cualquier otrosí u acta de terminación dentro del mismo plazo desde su firma. Asunto con formato `Contrato <cliente> - <objeto corto>` o `Otrosí <id_contrato> - <cliente>`, siempre con el PDF como adjunto (nunca solo un enlace a una carpeta personal).
3. **Acuse automático:** el agente responde en menos de 5 minutos con la clasificación (nuevo/actualización/duplicado/rechazado) y, si quedó pendiente de revisión, qué campos faltan — nunca confirma que "ya quedó registrado" sin que la analista lo haya revisado cuando aplica.
4. **Excepciones y escalamiento:** un contrato sin firma o sin valor definido no se rechaza automáticamente: queda `requiere_revision` y se escala a la analista administrativa; si after 5 días hábiles no hay respuesta del comercial para completar el dato, se escala a su gerente comercial directo.
5. **Cierre del gap (junio–agosto 2026):** una campaña única donde cada comercial reenvía al buzón todos los contratos firmados desde el 2026-06-01 que aún no están en el maestro (la lista de comerciales y sus clientes activos ya existe en el CRM de ventas); el agente los procesa exactamente igual que el flujo normal, y el reporte de alertas (`registrados_desde_corte`) sirve como checklist de avance de esa campaña.
6. **Indicador mensual:** % de contratos facturados en el mes que existen en el maestro con `ruta_sharepoint` no vacía — se calcula cruzando el maestro contra el sistema de facturación; es la métrica que demuestra que el proceso sigue vivo, no solo que existió una vez.

## 7. Decisiones y trade-offs

1. **Extracción 100% determinista (regex/heurísticas), sin llamar al modelo desde la herramienta.**
   Alternativa descartada: pedirle al modelo que lea el contrato y devuelva el JSON estructurado directamente. Se descartó porque el PRD exige que `demo.ts` corra sin clave y sea determinista entre corridas, y porque HU-2 es explícita en que el valor final registrado debe pasar por `contratos_validar` — una extracción por LLM sería más tolerante a redacciones nuevas, pero mezclaría "qué dice el documento" con "qué cree el modelo que dice", exactamente lo que CA2 prohíbe.

2. **El país se infiere solo del segmento de texto del cliente, nunca del documento completo.**
   Se descubrió durante las pruebas: buscar "Colombia"/"Ecuador"/etc. en todo el texto fallaba porque el domicilio de Periferia (casi siempre "Medellín, Colombia") aparece en el mismo documento y ganaba por estar primero en el orden de comprobación. Alternativa descartada: extraer el país únicamente del tipo de identificador (NIT/RUC/RTN), que es más simple pero menos preciso cuando varios países comparten "RUC" como nombre del identificador (Ecuador, Perú, Panamá). Se prefirió acotar el texto de búsqueda al segmento del cliente y mantener el identificador como respaldo.

3. **`comercial` nunca entra a `requiere_revision`, aunque su confianza sea 0 cuando el remitente no está en `comerciales.json`.**
   Alternativa descartada: aplicar la misma regla de confianza < 0.8 a todos los campos por igual, incluyendo `comercial`. Se descartó porque HU-3 es explícita en que un remitente desconocido "se reporta pero no bloquea" — tratarlo igual que un campo del contrato habría bloqueado el registro de `msg-006` por una razón ajena al contrato mismo (quién lo reenvió, no qué dice).

4. **`modulo/tools/contratos.ts` reexporta en vez de duplicar.**
   Igual que en el reto 01: `export * from "../../src/tools/contratos.js"`, y `modulo/agent.md` / `modulo/skill/.../SKILL.md` se generan con `npm run build:modulo` desde los mismos `agent/prompt.md` y `src/knowledge/registro-contratos.md`. Evita que el módulo reutilizable diverja silenciosamente del agente real.

5. **Front de chat en HTML/CSS/JS plano.**
   Igual razón que en el reto 01: el front no tiene estado complejo, y evitar un build step cumple mejor el requisito de "un comando levanta todo en menos de 2 minutos".

## 8. Supuestos

- Los 6 fixtures representan la variabilidad real de redacción (contrato directo, contrato marco, otrosí); en producción habrá formatos de plantilla de cliente que ningún regex determinista va a cubrir sin ajuste — por diseño, esos casos caen en `requiere_revision` o incluso `rechazado`, nunca en un dato inventado.
- El dígito de verificación del NIT colombiano siempre viene después de un guion pegado al número (`890.900.111-4`); otros países no usan ese formato en los fixtures entregados.
- Un documento que empieza con la palabra "OTROSÍ" siempre es una actualización de un contrato ya existente (RN2); no se contempla un otrosí que en realidad sea el primer documento de un contrato nuevo.
- La similitud de objeto (RN2, umbral ≥ 0.9) se calcula con un Jaccard simple de palabras normalizadas — no es NLP semántico. Es determinista y suficiente para los fixtures, pero dos objetos muy distintos redactados con las mismas palabras comunes podrían superar el umbral por casualidad en producción.

## 9. Cobertura de historias de usuario

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 (Leer el buzón) | Hecho | — |
| HU-2 (Extraer datos) | Hecho | Extracción fuzzy/semántica para formatos de contrato que no sigan la estructura de cláusulas numeradas de los fixtures. |
| HU-3 (Validar y clasificar) | Hecho | Similitud de objeto con embeddings en vez de Jaccard de palabras, para reducir falsos negativos en producción. |
| HU-4 (Registrar y archivar) | Hecho | Probado solo contra adjuntos de texto plano (`contrato.txt`); `contratos_leer_pdf` (P1) lee texto ya extraído, no hace OCR ni parseo de PDF real. |
| HU-5 (Alertar) | Hecho | — |
| HU-6 (Manejo de errores) | Hecho | Más casos de entrada corrupta además de "mensaje inexistente" (cubierto en `demo.ts`). |
| Front de chat (6.1) | Hecho | Streaming de la respuesta (quedó fuera por tiempo). |
| Backend + API mínima (6.1/6.4) | Hecho | Persistencia de sesiones en archivo (hoy es solo memoria). |
| Adaptador LLM (6.1) | Hecho (Anthropic) | Un segundo proveedor implementado para probar que el ciclo del agente no cambia. |
| `demo.ts` (6.6) | Hecho | Determinismo verificado corriendo la demo dos veces y comparando el maestro resultante (idéntico, salvo `fecha_registro`, que usa la fecha real del sistema). |
| Regla de gobierno (7.5) | Hecho | — |
| Bonus `modulo/` (9.4) | Hecho | — |
| Despliegue público (9.3) | **No hecho en este entorno** | Desplegar en Render/Railway/Fly.io; aquí se corrió y verificó en local (`npm run dev` + `npm run demo`). |

## 10. Uso de IA

Esta solución fue construida con **Claude (Claude Code, modelo Sonnet 5)**, usado para:

- Leer el PRD y los fixtures, y diseñar el contrato de herramientas (`src/tools/contratos.ts`) y la estrategia de extracción determinista.
- Escribir todo el código: extracción, clasificación, manejo del CSV del maestro, archivado, alertas, ciclo del agente, adaptador de Anthropic, servidor y front.
- Ejecutar `npm run demo` de forma iterativa contra los 6 mensajes reales del buzón, lo que permitió encontrar y corregir tres errores reales antes de entregar: (1) la extracción de "cliente" capturaba todo el encabezado del documento cuando no había coma antes de "identificado con NIT"; (2) el país se inferior incorrectamente como Colombia en contratos de Ecuador porque el domicilio de Periferia contaminaba la búsqueda; (3) el otrosí de `msg-003` no actualizaba `valor` ni `fecha_fin` porque su formato de cláusula ("...(VALOR), la cual quedará así: ...") no coincidía con el patrón usado en los contratos originales, y además el texto de prosa normal ("conforme al nuevo plazo.") se confundía con un encabezado de cláusula.

No se usó ningún otro asistente de IA en esta sesión. Lo que **no** se adoptó de las primeras ideas: resolver la similitud de objeto (RN2) con un segundo llamado al LLM en vez de Jaccard de palabras — se descartó por el mismo requisito de determinismo que llevó a no usar el modelo en la extracción (sección 7, decisión 1).

> Nota para quien presente este reto: revisa cada archivo de `src/` antes de la defensa, en particular `src/tools/lib/extraccion.ts` — es la pieza más densa y la que tuvo más iteraciones de corrección contra los fixtures reales.

## 11. Riesgos de llevar esto a producción

- **Plantillas de contrato que no sigan la estructura de cláusulas numeradas de los fixtures** romperán la extracción determinista silenciosamente (los campos quedarán `null`/baja confianza, nunca inventados, pero el volumen de `requiere_revision` subiría mucho). Mitigación: monitorear la tasa de campos en revisión por mes; si sube de forma sostenida, es señal de que apareció un formato nuevo que necesita un patrón adicional.
- **Falsos duplicados o falsas actualizaciones por variaciones de redacción del nombre del cliente.** Mitigación ya aplicada: la comparación RN1/RN2 prioriza `id_contrato` y `nit_cliente` sobre el nombre; el nombre solo entra como segundo criterio (similitud de objeto) cuando no hay coincidencia de identificador.
- **El modelo podría, en teoría, redondear un valor o inventar una fecha en su respuesta de chat.** Mitigación: el valor que se escribe en el maestro sale siempre de `contratos_registrar`, nunca del texto libre del modelo; el prompt lo refuerza explícitamente.
- **Sin prompt caching**, cada llamada reenvía el system prompt completo — irrelevante al volumen actual (8–12 contratos/mes), relevante si el proceso crece a múltiples buzones o países.
- **Sesiones solo en memoria**: un reinicio del proceso pierde el historial de conversación en curso.
- **Dependencia de un solo proveedor de LLM**: el adaptador aísla esto, pero solo hay una implementación (`AdaptadorAnthropic`).
- **Quién es el dueño del maestro cuando no hay área legal** (pregunta abierta del PRD): en la regla de gobierno propuesta (sección 6) se asigna a la analista administrativa por defecto, pero es una decisión de negocio que Periferia debe ratificar formalmente, no algo que el agente pueda decidir.
