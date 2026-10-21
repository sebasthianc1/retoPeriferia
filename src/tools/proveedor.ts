import { z } from "zod"
import { appendLog } from "./lib/fs-helpers.js"
import { leerSolicitudInterno, mapearCamposInterno } from "./lib/mapeo.js"
import { generarFormularioInterno } from "./lib/generar.js"
import { armarPaqueteInterno } from "./lib/paquete.js"
import { simularEnvioInterno } from "./lib/envio.js"
import type { MapeoCampos } from "./lib/tipos.js"

export interface Ctx {
  directory: string
  sessionId: string
}

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

async function ejecutarSeguro<T>(
  caso: string,
  herramienta: string,
  ctx: Ctx,
  resumenOk: (data: T) => string,
  tarea: () => Promise<T>
): Promise<string> {
  try {
    const data = await tarea()
    await appendLog(ctx.directory, caso, herramienta, true, resumenOk(data))
    const resultado: Resultado<T> = { ok: true, data }
    return JSON.stringify(resultado)
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err)
    await appendLog(ctx.directory, caso, herramienta, false, mensaje)
    const resultado: Resultado<T> = { ok: false, error: mensaje }
    return JSON.stringify(resultado)
  }
}

export const leer_solicitud = {
  description:
    "Lee la solicitud de un cliente y su plantilla; devuelve país, cliente, formato de salida, campos pedidos (marcando los ambiguos) y soportes exigidos.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/, p. ej. 'co-industrias-delta'"),
  },
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      args.caso,
      "proveedor_leer_solicitud",
      ctx,
      (data) => `${data.campos.length} campos, ${data.soportes.length} soportes, formato ${data.formato}`,
      () => leerSolicitudInterno(ctx.directory, args.caso)
    )
  },
}

export const mapear_campos = {
  description:
    "Cruza los campos solicitados de un caso con el repositorio maestro usando el glosario; clasifica cada campo en lleno, faltante o requiere_confirmacion. Nunca inventa valores.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
    campos: z
      .array(z.string())
      .optional()
      .describe("Etiquetas a mapear; si se omite, se toman todas las de la plantilla del caso"),
  },
  async execute(args: { caso: string; campos?: string[] }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      args.caso,
      "proveedor_mapear_campos",
      ctx,
      (data) => `${data.llenos.length} llenos, ${data.faltantes.length} faltantes, ${data.requiere_confirmacion.length} por confirmar`,
      () => mapearCamposInterno(ctx.directory, args.caso, args.campos)
    )
  },
}

export const generar_formulario = {
  description:
    "Genera el formulario lleno en el formato pedido por el cliente (xlsx, pdf, o un archivo de valores para portal web) dentro de out/<caso>/.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
    mapeo: z
      .any()
      .optional()
      .describe("Resultado previo de proveedor_mapear_campos; si se omite, se recalcula internamente"),
  },
  async execute(args: { caso: string; mapeo?: MapeoCampos }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      args.caso,
      "proveedor_generar_formulario",
      ctx,
      (data) => `formulario ${data.formato} en ${data.ruta}`,
      () => generarFormularioInterno(ctx.directory, args.caso, args.mapeo)
    )
  },
}

export const armar_paquete = {
  description:
    "Arma el paquete para firma de un caso: copia el formulario y los soportes vigentes, genera checklist.md y borrador-correo.md, y determina si queda listo_para_firma.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
  },
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      args.caso,
      "proveedor_armar_paquete",
      ctx,
      (data) => `listo_para_firma=${data.listo_para_firma}, ausentes=${data.checklist.ausentes.length}, vencidos=${data.checklist.vencidos.length}`,
      () => armarPaqueteInterno(ctx.directory, args.caso)
    )
  },
}

export const simular_envio = {
  description:
    "Simula el envío del paquete ya armado. Solo escribe ENVIO-SIMULADO.md si 'confirmado' es true; nunca envía nada real.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
    confirmado: z.boolean().describe("true solo si el usuario confirmó explícitamente el envío en su último mensaje"),
  },
  async execute(args: { caso: string; confirmado: boolean }, ctx: Ctx): Promise<string> {
    if (!args.confirmado) {
      await appendLog(ctx.directory, args.caso, "proveedor_simular_envio", false, "intento sin confirmación explícita")
      const resultado: Resultado<never> = { ok: false, error: "requiere confirmación explícita" }
      return JSON.stringify(resultado)
    }
    return ejecutarSeguro(
      args.caso,
      "proveedor_simular_envio",
      ctx,
      (data) => `envío simulado en ${data.ruta}`,
      () => simularEnvioInterno(ctx.directory, args.caso)
    )
  },
}

export const solicitar_confirmacion = {
  description:
    "Registra que el agente está esperando una confirmación explícita del usuario antes de una acción externa (por ejemplo, simular el envío). Úsala siempre justo antes de preguntar.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
    accion: z.string().describe("Acción que requiere confirmación, p. ej. 'simular_envio'"),
    resumen: z.string().describe("Resumen breve de lo que se va a hacer si el usuario confirma"),
  },
  async execute(args: { caso: string; accion: string; resumen: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      args.caso,
      "proveedor_solicitar_confirmacion",
      ctx,
      () => `pendiente: ${args.accion}`,
      async () => ({ pendiente: true, accion: args.accion, resumen: args.resumen })
    )
  },
}
