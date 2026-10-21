import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import type { AdaptadorLLM, HerramientaSpec, MensajeAgente, RazonParada, RespuestaModelo, ToolCallSolicitada } from "./adapter.js"

function esquemaHerramienta(args: z.ZodRawShape): Anthropic.Tool.InputSchema {
  const json = zodToJsonSchema(z.object(args), { $refStrategy: "none", target: "openApi3" }) as Record<string, unknown>
  return {
    type: "object",
    properties: (json["properties"] as Record<string, unknown>) ?? {},
    required: (json["required"] as string[]) ?? [],
  }
}

function aHerramientasAnthropic(herramientas: HerramientaSpec[]): Anthropic.Tool[] {
  return herramientas.map((h) => ({
    name: h.nombre,
    description: h.descripcion,
    input_schema: esquemaHerramienta(h.args),
  }))
}

/** Agrupa mensajes consecutivos de rol "tool" en un único mensaje "user" con varios tool_result. */
function aMensajesAnthropic(mensajes: MensajeAgente[]): Anthropic.MessageParam[] {
  const resultado: Anthropic.MessageParam[] = []
  let bufferTools: Anthropic.ToolResultBlockParam[] = []

  const flushTools = () => {
    if (bufferTools.length > 0) {
      resultado.push({ role: "user", content: bufferTools })
      bufferTools = []
    }
  }

  for (const m of mensajes) {
    if (m.rol === "system") continue

    if (m.rol === "tool") {
      bufferTools.push({
        type: "tool_result",
        tool_use_id: m.toolCallId ?? "",
        content: m.contenido,
      })
      continue
    }

    flushTools()

    if (m.rol === "user") {
      resultado.push({ role: "user", content: m.contenido })
      continue
    }

    // assistant
    const bloques: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = []
    if (m.contenido) bloques.push({ type: "text", text: m.contenido })
    for (const tc of m.toolCalls ?? []) {
      bloques.push({ type: "tool_use", id: tc.id, name: tc.nombre, input: (tc.argumentos as Record<string, unknown>) ?? {} })
    }
    resultado.push({ role: "assistant", content: bloques })
  }
  flushTools()
  return resultado
}

function sistemaDe(mensajes: MensajeAgente[]): string {
  return mensajes
    .filter((m) => m.rol === "system")
    .map((m) => m.contenido)
    .join("\n\n")
}

function razonParadaDe(stopReason: string | null): RazonParada {
  if (stopReason === "tool_use") return "tool_calls"
  if (stopReason === "max_tokens") return "max_tokens"
  return "fin"
}

export class AdaptadorAnthropic implements AdaptadorLLM {
  readonly proveedor = "anthropic"
  readonly modelo: string
  private cliente: Anthropic
  private maxOutputTokens: number

  constructor(opciones: { apiKey: string; modelo: string; maxOutputTokens?: number }) {
    this.cliente = new Anthropic({ apiKey: opciones.apiKey })
    this.modelo = opciones.modelo
    this.maxOutputTokens = opciones.maxOutputTokens ?? 4096
  }

  async enviar(mensajes: MensajeAgente[], herramientas: HerramientaSpec[]): Promise<RespuestaModelo> {
    const respuesta = await this.cliente.messages.create({
      model: this.modelo,
      max_tokens: this.maxOutputTokens,
      system: sistemaDe(mensajes),
      messages: aMensajesAnthropic(mensajes),
      tools: aHerramientasAnthropic(herramientas),
    })

    const textos: string[] = []
    const toolCalls: ToolCallSolicitada[] = []
    for (const bloque of respuesta.content) {
      if (bloque.type === "text") textos.push(bloque.text)
      else if (bloque.type === "tool_use") toolCalls.push({ id: bloque.id, nombre: bloque.name, argumentos: bloque.input })
    }

    return {
      contenido: textos.length > 0 ? textos.join("\n") : null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      razonParada: razonParadaDe(respuesta.stop_reason),
    }
  }
}
