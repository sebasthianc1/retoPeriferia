# SOLUCION.md — Reto 01: Agente de Registro como Proveedor

## 1. Problema en una frase

La analista administrativa de Periferia transcribe a mano, varias veces al mes, los mismos datos de la empresa en formularios de clientes distintos; este agente lee la solicitud, llena el formulario desde el repositorio maestro y arma el paquete de firma, sin inventar nunca un dato que no exista.

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
                               src/tools/registro.ts
                          (registra cada export de proveedor.ts
                           como herramienta `proveedor_<export>`)
                                       │
                               src/tools/proveedor.ts
                          (contrato { ok, data } / { ok:false, error })
                                       │
                         src/tools/lib/ (mapeo, generar, paquete, envio)
                                       │
                         fixtures/ (solo lectura)   out/ (escritura)
```

- **Comportamiento** (cómo debe actuar el agente, reglas de confirmación, tono de error): `agent/prompt.md`.
- **Conocimiento** (reglas de país, estados de mapeo, vigencia de soportes): `src/knowledge/registro-proveedor.md`.
- **Ejecución** (la única fuente de valores reales): `src/tools/proveedor.ts` y sus helpers en `src/tools/lib/`.

`src/server.ts` concatena `agent/prompt.md` + `src/knowledge/registro-proveedor.md` en un único system prompt al arrancar; cambiar una regla de negocio no toca el servidor ni el ciclo del agente.

## 3. Ciclo del agente

`src/agent-loop.ts` implementa `ejecutarTurno(...)`:

1. Agrega el mensaje del usuario al historial de la sesión (en memoria, `Map<sessionId, SesionAgente>` dentro de `src/server.ts`).
2. Llama a `adaptador.enviar(historial, herramientas)`.
3. Si el modelo no pidió herramientas, el texto es la respuesta final del turno.
4. Si pidió herramientas, cada una se valida con `z.object(herramienta.args).safeParse(...)` antes de ejecutarse (si falla, el error vuelve al modelo como `tool_result`, nunca se ejecuta con datos inválidos); el resultado (`{ok,data}` o `{ok:false,error}`) se agrega al historial como mensaje `tool`, y se vuelve a llamar al modelo.
5. Se repite hasta `MAX_TOOL_ITERATIONS` (CA1, por defecto 25). Si se alcanza el tope, el agente responde con un resumen de lo que logró hacer en vez de seguir llamando herramientas.

**Confirmación humana (CA3/RN4):** además de las 5 herramientas del contrato mínimo, agregué una sexta herramienta, `proveedor_solicitar_confirmacion`, que el prompt instruye llamar justo antes de preguntar algo que requiere confirmación (como enviar el paquete). El backend marca `needsConfirmation: true` en la respuesta de la API si esa herramienta se invocó en el turno — así el front puede resaltar el estado sin depender de heurísticas sobre el texto libre del modelo. La barrera real, sin embargo, está en la propia herramienta: `proveedor_simular_envio` exige `confirmado: true` y devuelve `{ok:false, error:"requiere confirmación explícita"}` si no lo recibe; el modelo solo debe poner `true` cuando el mensaje inmediatamente anterior del usuario confirmó explícitamente (regla en `agent/prompt.md`).

## 4. Elección del modelo

**Proveedor:** Anthropic. **Modelo:** `claude-sonnet-5-5` (configurable por `LLM_MODEL`).

**Por qué:** la tarea es un flujo de *tool calling* de complejidad moderada (leer JSON, cruzar contra un glosario, decidir si un campo es ambiguo) — no requiere el razonamiento de un modelo de gama alta. Sonnet 5.5 tiene soporte maduro de tool use, buen seguimiento de instrucciones para las reglas "nunca inventes / siempre confirma", y es sensiblemente más barato que un modelo tope de gama, lo cual importa porque este proceso se repite 8–12 veces al mes y debe ser sostenible en costo.

**Costo estimado por caso:** con prompt (`agent/prompt.md` + conocimiento) de ~2 000 tokens y un flujo típico de 4–5 llamadas a herramienta (leer → mapear → generar → armar paquete, más la respuesta final), el historial acumulado por caso ronda 15 000–20 000 tokens de entrada y 1 500–2 500 de salida. A $2 / $10 por millón de tokens, eso es **del orden de $0.05–0.10 USD por caso procesado** (sin incluir el turno adicional de "confirmar envío"). Esto es una estimación de orden de magnitud, no una medición de facturación real; el adaptador no implementa todavía *prompt caching* (`cache_control`), que bajaría el costo del system prompt repetido en cada llamada — ver sección 6 (trade-offs) y sección 10 (riesgos).

## 5. Diseño del portal web (sección 7.4 del PRD)

No se automatiza el llenado de `pa-logistica-istmo` (formato `portal`). Diseño propuesto para una fase posterior:

- **Estrategia:** navegador controlado por el agente (Playwright) operando sobre una sesión que el humano ya autenticó, no RPA de escritorio ni extensión de navegador — es lo más fácil de mantener cuando cada cliente tiene un portal distinto. El agente navega y llena campos; **nunca** decide el envío final.
- **Límites:** CAPTCHA y MFA no son automatizables de forma confiable ni deseable (son controles de seguridad del cliente); cambios de layout del portal rompen selectores sin aviso — se necesita monitoreo y un "modo manual" de respaldo (el `valores-portal.md` que sí se genera hoy).
- **Credenciales:** nunca viven en el repositorio, el prompt o los logs. Las ingresa el humano directamente en el navegador (gestor de contraseñas corporativo o bóveda de secretos), en una sesión que el agente no puede leer.
- **División de trabajo:** el agente prepara los valores (ya lo hace, vía `valores-portal.md`) y, en una fase futura, podría posicionar el cursor/resaltar el campo a llenar; el **ingreso de credenciales y el clic en "Enviar" son siempre humanos**, sin excepción.

## 6. Decisiones y trade-offs

1. **Mapeo determinista (glosario exacto + normalización de mayúsculas/espacios) en vez de *fuzzy matching* o un segundo llamado al LLM para resolver sinónimos.**
   Alternativa descartada: pedirle al modelo que decida a qué clave del maestro corresponde una etiqueta ambigua. Se descartó porque el PRD exige que "el agente nunca inventa un valor" y que `demo.ts` sea determinista sin modelo — una resolución basada en LLM no es ni reproducible ni auditable de la misma forma. El costo es que una etiqueta con una redacción no prevista en el glosario (ni en su forma normalizada) termina como `faltante`, aunque un humano la reconocería.

2. **Herramienta adicional `proveedor_solicitar_confirmacion`, más allá del contrato mínimo de 5 herramientas.**
   Alternativa descartada: inferir `needsConfirmation` con una heurística sobre el texto de la respuesta (p. ej. "¿termina en signo de pregunta?"). Se descartó por frágil y por mezclar "formato de redacción" con "estado de la máquina". La herramienta extra convierte la detección en un hecho verificable (se llamó o no se llamó), al costo de un tool call adicional por turno de confirmación.

3. **El módulo reutilizable (`modulo/`) reexporta en vez de duplicar código.**
   `modulo/tools/proveedor.ts` es `export * from "../../src/tools/proveedor.js"`, y `modulo/agent.md` / `modulo/skill/.../SKILL.md` se generan con `npm run build:modulo` a partir de `agent/prompt.md` y `src/knowledge/registro-proveedor.md` (ver `scripts/build-modulo.ts`). Alternativa descartada: escribir esos tres archivos a mano dentro de `modulo/`. Se descartó porque el PRD evalúa explícitamente que "las tres piezas sean las mismas que usa tu aplicación, no copias divergentes" — con archivos a mano, un cambio en el prompt real se olvida de replicar tarde o temprano.

4. **Front de chat en HTML/CSS/JS plano, sin framework ni build step.**
   Alternativa descartada: React/Vite. Se descartó porque el front no tiene estado complejo (una lista de mensajes y un flag de confirmación) y un build step adicional no aporta valor frente al requisito de "un comando levanta todo en menos de 2 minutos"; `express.static` sirve `web/` directamente.

## 7. Supuestos

- El formato de `plantilla-celdas.json` asume una sola celda de valor por etiqueta (no hay fusión de celdas ni fórmulas); se genera un libro Excel nuevo por caso en vez de rellenar un archivo adjunto real, porque los fixtures no incluyen el binario `.xlsx` original, solo su descripción de celdas.
- "Campo ambiguo" (HU-1) se interpreta como una etiqueta genérica de identificación tributaria que no indica el país (p. ej. "Identificación tributaria", "Número de identificación fiscal"); ninguno de los 4 casos de ejemplo usa esas etiquetas literales, así que esta ruta se valida con el caso agregado en `demo.ts`... en realidad no se agregó un fixture ambiguo adicional — queda cubierta por el código y su lógica, pero no por una aserción automática sobre datos reales (ver cobertura, HU-1 parcial).
- "Listo para firma" (RN3) se basa solo en soportes (vencidos/ausentes); un campo `faltante` nunca bloquea, tal como indica el PRD, incluso si ese campo era `obligatorio: true` en la plantilla PDF/portal.
- El correo de respuesta (`borrador-correo.md`) se dirige al remitente original de la solicitud (`solicitud.de`); en producción probablemente haya una lista de distribución distinta.
- La fecha de "hoy" para calcular vigencia de soportes es la fecha real del sistema en el momento de la ejecución (no una fecha fija de los fixtures) — esto es correcto por diseño, pero significa que los resultados de `demo.ts` sobre vigencia cambian con el tiempo (ver sección 8, Determinismo).

## 8. Cobertura de historias de usuario

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 (Leer la solicitud) | Hecho | Detección de ambigüedad probada con fixtures sintéticos adicionales, no solo con los 4 casos entregados. |
| HU-2 (Mapear campos) | Hecho | Mapeo fuzzy/semántico para sinónimos no listados en el glosario (hoy son `faltante`, nunca inventados — correcto pero conservador). |
| HU-3 — xlsx (P0) | Hecho | Validado contra un archivo de plantilla real del cliente (hoy se genera un libro nuevo, no se rellena el adjunto original). |
| HU-3 — pdf (P1) | Hecho | Mismo punto: PDF generado, no un AcroForm del cliente rellenado. |
| HU-3 — portal (P2) | Hecho (según alcance: diseño + archivo de valores, no automatización) | Implementación real del diseño de la sección 5 cuando se apruebe. |
| HU-4 (Armar paquete) | Hecho | Verificación con soportes reales (hoy son placeholders de texto). |
| HU-5 (Manejo de errores) | Hecho | Más casos de plantilla corrupta además de "caso inexistente" (cubierto en `demo.ts`). |
| Front de chat (6.1) | Hecho | Streaming de la respuesta (quedó fuera por tiempo; hoy la respuesta llega completa al final del turno). |
| Backend + API mínima (6.1/6.4) | Hecho | Persistencia de sesiones en archivo (hoy es solo memoria; se pierde al reiniciar el proceso). |
| Adaptador LLM (6.1) | Hecho (Anthropic) | Un segundo proveedor implementado para probar que el ciclo del agente no cambia. |
| `demo.ts` (6.6) | Hecho | — |
| Bonus `modulo/` (9.4) | Hecho | — |
| Despliegue público (9.3) | **No hecho en este entorno** | Desplegar en Render/Railway/Fly.io; aquí se corrió y verificó en local (`npm run dev` + `npm run demo`). |

## 9. Uso de IA

Esta solución fue construida con **Claude (Claude Code, modelo Sonnet 5)**, usado para:

- Leer el PRD y los fixtures, y traducir el contrato de herramientas de la sección 6.2 a `src/tools/proveedor.ts` y sus helpers.
- Escribir el ciclo del agente, el adaptador de Anthropic (incluida la conversión de herramientas `zod` a `input_schema` de la API de mensajes) y el servidor Express.
- Escribir el front de chat, el `demo.ts`, y este documento.
- Ejecutar `npm run demo` de forma iterativa para verificar el comportamiento contra los 4 casos de fixtures (conteo de campos llenos/faltantes, vigencia de soportes, bloqueo de `simular_envio` sin confirmación) antes de dar por terminada cada pieza.

No se usó ningún otro asistente de IA en esta sesión. Lo que **no** se adoptó de las primeras ideas: una resolución de campos ambiguos basada en un segundo llamado al LLM dentro de la herramienta de mapeo (se descartó por el requisito de determinismo, ver sección 6, decisión 1).

> Nota para quien presente este reto: revisa cada archivo de `src/` antes de la defensa — el PRD pide poder explicar cada línea entregada, y el código fue escrito por el asistente bajo la dirección de quien lo presenta, no al revés.

## 10. Riesgos de llevar esto a producción

- **El modelo podría, en teoría, redactar un valor en su texto en vez de llamar a la herramienta.** Mitigación ya aplicada: el prompt lo prohíbe explícitamente y el diseño hace que no haga falta (toda la información vive en los `tool_result`, nunca en el prompt). Mitigación adicional recomendada: un chequeo post-hoc que busque patrones de "dato inventado" en la respuesta final antes de mostrarla.
- **Plantillas reales son más desordenadas que los fixtures** (celdas fusionadas, encabezados multi-fila, columnas adicionales). El parser de `plantilla-celdas.json` asume una fila por campo; un fixture real probablemente requiera un parser más tolerante.
- **Credenciales y datos bancarios**: hoy viven en `fixtures/reto-01/repositorio/maestro.json` en texto plano porque son datos ficticios de prueba. En producción, el maestro debe vivir en un sistema con control de acceso, no en un archivo JSON versionable.
- **Sin prompt caching**: cada llamada al modelo reenvía el system prompt completo; en volumen (8–12 casos/mes esto es irrelevante, pero si el proceso crece) conviene agregar `cache_control` al system prompt.
- **Sesiones solo en memoria**: un reinicio del proceso pierde el historial de conversación en curso. Para producción, persistir en archivo o base de datos ligera.
- **Dependencia de un solo proveedor de LLM**: el adaptador aísla esto (sección 3 del PRD), pero solo hay una implementación (`AdaptadorAnthropic`); un corte del proveedor detiene el agente hasta configurar un segundo adaptador.
