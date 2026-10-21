import type { z } from "zod"

export type Rol = "system" | "user" | "assistant" | "tool"

export interface ToolCallSolicitada {
  id: string
  nombre: string
  argumentos: unknown
}

/** Mensaje en el formato interno del ciclo del agente, independiente del proveedor LLM. */
export interface MensajeAgente {
  rol: Rol
  contenido: string
  /** Solo en mensajes con rol "tool": a qué tool_call responde. */
  toolCallId?: string
  /** Solo en mensajes con rol "assistant": llamadas a herramienta que pidió el modelo. */
  toolCalls?: ToolCallSolicitada[]
}

export interface HerramientaSpec {
  nombre: string
  descripcion: string
  /** Forma de los argumentos como objeto de esquemas zod (ver contrato de herramientas del PRD). */
  args: z.ZodRawShape
}

export type RazonParada = "tool_calls" | "fin" | "max_tokens"

export interface RespuestaModelo {
  contenido: string | null
  toolCalls: ToolCallSolicitada[] | null
  razonParada: RazonParada
}

/**
 * Interfaz única que debe implementar cualquier proveedor de modelo de lenguaje.
 * Cambiar de proveedor implica escribir un nuevo archivo que cumpla esta interfaz;
 * el ciclo del agente (src/server.ts) nunca cambia.
 */
export interface AdaptadorLLM {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: MensajeAgente[], herramientas: HerramientaSpec[]): Promise<RespuestaModelo>
}
