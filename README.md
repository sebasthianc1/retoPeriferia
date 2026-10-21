# Agente de Órdenes de Compra SAP

Agente conversacional que lee el paquete de una compra (solicitud, cotización del proveedor y correo de aprobación), lo valida contra los maestros de SAP y diez controles de negocio, arma el payload de la orden de compra exactamente como quedaría en el sistema, genera la evidencia de aprobación, y la crea en un SAP simulado — pidiendo confirmación humana para todo lo que no es un sí o no automático.

## Requisitos

- Node 20+ (probado también en Node 18.19).
- Una clave de API de Anthropic (único proveedor implementado por ahora).

## Cómo levantar en local (un comando)

```bash
npm install
cp .env.example .env   # agrega tu ANTHROPIC_API_KEY
npm run dev
```

Abre `http://localhost:3000`. El mismo comando levanta el backend (API de chat) y sirve el front estático en `web/`.

## Variables de entorno

Ver `.env.example`. Las importantes:

| Variable | Qué hace |
|---|---|
| `ANTHROPIC_API_KEY` | Clave del modelo. Nunca se versiona, nunca llega al front ni a los logs. |
| `LLM_PROVIDER` | Proveedor del modelo (solo `anthropic` implementado por ahora). |
| `LLM_MODEL` | Modelo de Anthropic a usar (por defecto `claude-sonnet-5-5`). |
| `MAX_TOOL_ITERATIONS` | Tope de llamadas herramienta→modelo por turno (CA1 del PRD). |
| `PORT` | Puerto del servidor (por defecto 3000). |
| `ACCESS_KEY` | Opcional. Si se define, el front/API exige el header `x-access-key` con este valor. |

## Cómo correr `demo.ts` (sin modelo, sin clave)

Ejecuta las herramientas directamente sobre los 6 casos de `fixtures/reto-03/solicitudes/`, en orden, e imprime un resumen determinista:

```bash
npm run demo
```

`out/` se limpia al inicio de cada corrida. La demo muestra:

- `sol-001`: apto sin excepciones → OC creada directamente.
- `sol-002`: bloqueado (proveedor inexistente, RC1).
- `sol-003`: bloqueado (aprobador sin autoridad en ese centro de costos, RC2).
- `sol-004`: requiere confirmación (cotización difiere >2% de la solicitud, RC5) — se bloquea en la primera pasada y se crea en una segunda llamada con `confirmado: true`.
- `sol-005`: requiere confirmación (factura anterior a la solicitud → OC retroactiva, RC8).
- `sol-006`: requiere confirmación (IVA no informado, derivado del proveedor, RC6).
- Idempotencia: reprocesar `sol-001` devuelve el mismo número de OC en vez de crear una segunda.

Al terminar, revisa:

- `out/sap/ordenes.jsonl` — el SAP simulado: cada OC creada con su payload completo.
- `out/<caso>/trazabilidad.json` — de dónde salió cada campo del payload (`solicitud`, `cotizacion`, `maestro.*` o `derivado`).
- `out/<caso>/aprobacion.txt` y `.pdf` — evidencia de aprobación con su hash sha256.
- `out/control.csv` — una fila por cada intento de creación (exitoso, bloqueado o pendiente), con el flag `retroactiva`.
- `out/log.jsonl` — log de toda llamada a herramienta.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión (mensajes y llamadas a herramienta) |
| `GET` | `/api/health` | `{ ok, provider, model }`, nunca expone la clave |

## Estructura

```
agent/prompt.md                  → system prompt (comportamiento)
src/knowledge/ordenes-compra.md  → conocimiento del proceso (los 10 controles)
src/tools/oc.ts                  → herramientas (ejecución), contrato { ok, data } / { ok:false, error }
src/tools/lib/                   → paquete, maestros, controles (RC1-RC10), payload, evidencia, control.csv
src/sap/adapter.ts + mock.ts      → interfaz SapAdapter y su implementación simulada sobre archivos
src/llm/adapter.ts + anthropic.ts → adaptador del proveedor LLM
src/agent-loop.ts                → ciclo del agente (tope de iteraciones, confirmación)
src/server.ts                    → API HTTP + front estático
web/                               → chat (HTML/CSS/JS plano)
demo.ts                            → corre las herramientas sin modelo sobre los 6 casos
modulo/                            → agente empaquetado reutilizable (bonus, sección 9.4 del PRD)
```

## Link de prueba

Ver `SOLUCION.md` (sección "Cobertura") para el estado del despliegue público. Si no hay link activo, se corre en local con los comandos de arriba.

## Documentación de la solución

Ver `SOLUCION.md` para arquitectura, matriz de controles, diseño del adaptador SAP real, decisiones y trade-offs, supuestos, cobertura de historias de usuario y uso de IA.
