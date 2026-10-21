import "dotenv/config"
import express from "express"
import path from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { ejecutarTurno, type SesionAgente } from "./agent-loop.js"
import { construirHerramientas } from "./tools/catalogo.js"
import { AdaptadorAnthropic } from "./llm/anthropic.js"
import type { AdaptadorLLM } from "./llm/adapter.js"

const DIRECTORIO_PROYECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const PORT = Number(process.env.PORT ?? 3000)
const MAX_TOOL_ITERATIONS = Number(process.env.MAX_TOOL_ITERATIONS ?? 25)
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 4096)
const LLM_PROVIDER = process.env.LLM_PROVIDER ?? "anthropic"
const LLM_MODEL = process.env.LLM_MODEL ?? "claude-sonnet-5-5"
const ACCESS_KEY = process.env.ACCESS_KEY ?? ""

function construirAdaptador(): AdaptadorLLM {
  if (LLM_PROVIDER === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en el entorno")
    return new AdaptadorAnthropic({ apiKey, modelo: LLM_MODEL, maxOutputTokens: MAX_OUTPUT_TOKENS })
  }
  throw new Error(`Proveedor LLM no soportado: ${LLM_PROVIDER}. Implementa src/llm/${LLM_PROVIDER}.ts y regístralo aquí.`)
}

function cargarSystemPrompt(): string {
  const prompt = readFileSync(path.join(DIRECTORIO_PROYECTO, "agent", "prompt.md"), "utf8")
  const conocimiento = readFileSync(path.join(DIRECTORIO_PROYECTO, "src", "knowledge", "registro-contratos.md"), "utf8")
  return `${prompt}\n\n---\n\n${conocimiento}`
}

const herramientas = construirHerramientas()
const systemPrompt = cargarSystemPrompt()
const sesiones = new Map<string, SesionAgente>()

let adaptador: AdaptadorLLM | null = null
let errorAdaptador: string | null = null
try {
  adaptador = construirAdaptador()
} catch (err) {
  errorAdaptador = err instanceof Error ? err.message : String(err)
  console.error("[server] No se pudo inicializar el proveedor LLM:", errorAdaptador)
}

const app = express()
app.use(express.json())

app.use("/api", (req, res, next) => {
  if (!ACCESS_KEY) return next()
  if (req.headers["x-access-key"] === ACCESS_KEY) return next()
  res.status(401).json({ ok: false, error: "clave de acceso inválida" })
})

app.get("/api/health", (_req, res) => {
  res.json({ ok: adaptador !== null, provider: LLM_PROVIDER, model: LLM_MODEL, error: errorAdaptador ?? undefined })
})

app.get("/api/sessions/:id", (req, res) => {
  const sesion = sesiones.get(req.params.id)
  if (!sesion) {
    res.status(404).json({ ok: false, error: "sesión no encontrada" })
    return
  }
  res.json({ ok: true, data: sesion.historial })
})

app.post("/api/chat", async (req, res) => {
  if (!adaptador) {
    res.status(503).json({ ok: false, error: `El agente no está disponible: ${errorAdaptador}` })
    return
  }

  const { sessionId, message } = req.body as { sessionId?: string; message?: string }
  if (!message || typeof message !== "string") {
    res.status(400).json({ ok: false, error: "falta 'message' en el cuerpo de la petición" })
    return
  }

  const id = sessionId && sesiones.has(sessionId) ? sessionId : sessionId ?? randomUUID()
  let sesion = sesiones.get(id)
  if (!sesion) {
    sesion = { id, historial: [] }
    sesiones.set(id, sesion)
  }

  try {
    const resultado = await ejecutarTurno({
      sesion,
      mensajeUsuario: message,
      systemPrompt,
      herramientas,
      adaptador,
      ctx: { directory: DIRECTORIO_PROYECTO, sessionId: id },
      maxIteraciones: MAX_TOOL_ITERATIONS,
    })
    res.json({ sessionId: id, reply: resultado.reply, toolCalls: resultado.toolCalls, needsConfirmation: resultado.needsConfirmation })
  } catch (err) {
    console.error("[server] error en /api/chat:", err)
    res.status(500).json({ ok: false, error: "error interno procesando el mensaje; la sesión sigue activa, intenta de nuevo" })
  }
})

app.use(express.static(path.join(DIRECTORIO_PROYECTO, "web")))

app.listen(PORT, () => {
  console.log(`Agente de Registro de Contratos escuchando en http://localhost:${PORT}`)
  console.log(`Proveedor LLM: ${LLM_PROVIDER} (${LLM_MODEL})${errorAdaptador ? " — NO DISPONIBLE: " + errorAdaptador : ""}`)
})
