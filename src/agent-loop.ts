import { z } from "zod"
import type { AdaptadorLLM, MensajeAgente } from "./llm/adapter.js"
import type { HerramientaEjecutable } from "./tools/catalogo.js"
import type { Ctx } from "./tools/contratos.js"

export interface LlamadaHerramientaResumen {
  nombre: string
  argumentos: unknown
  resultado: string
}

export interface ResultadoTurno {
  reply: string
  toolCalls: LlamadaHerramientaResumen[]
  needsConfirmation: boolean
}

export interface SesionAgente {
  id: string
  historial: MensajeAgente[]
}

const NOMBRE_HERRAMIENTA_CONFIRMACION = "contratos_solicitar_confirmacion"

function resumirResultado(crudo: string, limite = 220): string {
  return crudo.length > limite ? crudo.slice(0, limite) + "…" : crudo
}

/**
 * Ejecuta un turno completo del ciclo del agente: manda el historial al modelo,
 * ejecuta las herramientas que pida, y repite hasta que el modelo responda con
 * texto final o se alcance el tope de iteraciones (CA1).
 */
export async function ejecutarTurno(opciones: {
  sesion: SesionAgente
  mensajeUsuario: string
  systemPrompt: string
  herramientas: HerramientaEjecutable[]
  adaptador: AdaptadorLLM
  ctx: Ctx
  maxIteraciones: number
}): Promise<ResultadoTurno> {
  const { sesion, mensajeUsuario, systemPrompt, herramientas, adaptador, ctx, maxIteraciones } = opciones

  if (sesion.historial.length === 0) {
    sesion.historial.push({ rol: "system", contenido: systemPrompt })
  }
  sesion.historial.push({ rol: "user", contenido: mensajeUsuario })

  const herramientasPorNombre = new Map(herramientas.map((h) => [h.nombre, h]))
  const herramientasSpec = herramientas.map((h) => ({ nombre: h.nombre, descripcion: h.descripcion, args: h.args }))

  const llamadasDelTurno: LlamadaHerramientaResumen[] = []
  let needsConfirmation = false

  for (let iteracion = 0; iteracion < maxIteraciones; iteracion++) {
    let respuesta
    try {
      respuesta = await adaptador.enviar(sesion.historial, herramientasSpec)
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err)
      return {
        reply: `Hubo un problema al contactar al modelo de lenguaje (${adaptador.proveedor}): ${mensaje}. Intenta de nuevo en un momento.`,
        toolCalls: llamadasDelTurno,
        needsConfirmation: false,
      }
    }

    if (!respuesta.toolCalls || respuesta.toolCalls.length === 0) {
      const texto = respuesta.contenido ?? "(el modelo no devolvió texto)"
      sesion.historial.push({ rol: "assistant", contenido: texto })
      return { reply: texto, toolCalls: llamadasDelTurno, needsConfirmation }
    }

    sesion.historial.push({ rol: "assistant", contenido: respuesta.contenido ?? "", toolCalls: respuesta.toolCalls })

    for (const llamada of respuesta.toolCalls) {
      const herramienta = herramientasPorNombre.get(llamada.nombre)
      let resultado: string

      if (!herramienta) {
        resultado = JSON.stringify({ ok: false, error: `herramienta desconocida: ${llamada.nombre}` })
      } else {
        const esquema = z.object(herramienta.args)
        const validacion = esquema.safeParse(llamada.argumentos)
        if (!validacion.success) {
          resultado = JSON.stringify({ ok: false, error: `argumentos inválidos para ${llamada.nombre}: ${validacion.error.message}` })
        } else {
          try {
            resultado = await herramienta.ejecutar(validacion.data, ctx)
          } catch (err) {
            // Red de seguridad: las herramientas no deberían lanzar (HU-6), pero si ocurre, no tumba la sesión.
            resultado = JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          if (llamada.nombre === NOMBRE_HERRAMIENTA_CONFIRMACION) needsConfirmation = true
        }
      }

      llamadasDelTurno.push({ nombre: llamada.nombre, argumentos: llamada.argumentos, resultado: resumirResultado(resultado) })
      sesion.historial.push({ rol: "tool", contenido: resultado, toolCallId: llamada.id })
    }
  }

  const resumenPendiente = llamadasDelTurno.map((l) => `- ${l.nombre}: ${l.resultado}`).join("\n")
  const reply = `Llegué al límite de pasos permitidos en este turno (${maxIteraciones}). Esto es lo que alcancé a hacer:\n${resumenPendiente}\n\nDime cómo quieres que continúe.`
  sesion.historial.push({ rol: "assistant", contenido: reply })
  return { reply, toolCalls: llamadasDelTurno, needsConfirmation: false }
}
