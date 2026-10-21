# Agente de Registro como Proveedor

Agente conversacional que lee la solicitud de registro de un cliente, cruza los campos pedidos contra el repositorio maestro de Periferia, genera el formulario en el formato solicitado (Excel, PDF, o valores para copiar a un portal) y arma el paquete de soportes listo para la firma del representante legal. Nunca firma ni envía nada real sin confirmación explícita.

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

Ejecuta las herramientas directamente sobre todos los casos de `fixtures/reto-01/casos/` e imprime un resumen determinista:

```bash
npm run demo
```

`out/` se limpia al inicio de cada corrida. Al terminar, revisa `out/<caso>/` para ver `formulario.xlsx` o `formulario.pdf` (o `valores-portal.md`), `paquete/` (checklist, borrador de correo, soportes copiados) y `log.jsonl`.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión (mensajes y llamadas a herramienta) |
| `GET` | `/api/health` | `{ ok, provider, model }`, nunca expone la clave |

## Estructura

```
agent/prompt.md                  → system prompt (comportamiento)
src/knowledge/registro-proveedor.md → conocimiento del proceso
src/tools/proveedor.ts           → herramientas (ejecución), contrato { ok, data } / { ok:false, error }
src/llm/adapter.ts + anthropic.ts → adaptador del proveedor LLM
src/agent-loop.ts                → ciclo del agente (tope de iteraciones, confirmación)
src/server.ts                    → API HTTP + front estático
web/                              → chat (HTML/CSS/JS plano)
demo.ts                           → corre las herramientas sin modelo
modulo/                           → agente empaquetado reutilizable (bonus, sección 9.4 del PRD)
```

## Link de prueba

Ver `SOLUCION.md` (sección "Cobertura") para el estado del despliegue público. Si no hay link activo, se corre en local con los comandos de arriba.

## Documentación de la solución

Ver `SOLUCION.md` para arquitectura, decisiones, trade-offs, supuestos, cobertura de historias de usuario y uso de IA.
