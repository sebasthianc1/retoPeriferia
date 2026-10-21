import path from "node:path"
import { z } from "zod"
import { appendLog, fileExists, readJsonFile, readTextFile, resolveFromRoot, FIXTURES_ROOT, OUT_ROOT } from "./lib/fs-helpers.js"
import { listarBuzon, cargarCorreo } from "./lib/buzon.js"
import { extraerContrato } from "./lib/extraccion.js"
import { camposParaRevision, clasificarContrato } from "./lib/clasificacion.js"
import { cargarMaestro, registrarContrato } from "./lib/registro.js"
import { generarAlertas } from "./lib/alertas.js"
import type { Comercial, ContratoExtraido } from "./lib/tipos.js"

export interface Ctx {
  directory: string
  sessionId: string
}

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

async function ejecutarSeguro<T>(
  herramienta: string,
  mensajeId: string | null,
  ctx: Ctx,
  resumenOk: (data: T) => string,
  tarea: () => Promise<T>
): Promise<string> {
  try {
    const data = await tarea()
    await appendLog(ctx.directory, herramienta, mensajeId, true, resumenOk(data))
    const resultado: Resultado<T> = { ok: true, data }
    return JSON.stringify(resultado)
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err)
    await appendLog(ctx.directory, herramienta, mensajeId, false, mensaje)
    const resultado: Resultado<T> = { ok: false, error: mensaje }
    return JSON.stringify(resultado)
  }
}

function nombreAdjuntoContrato(adjuntos: string[]): string | undefined {
  return adjuntos.find((a) => /contrato|otrosi/i.test(a)) ?? adjuntos[0]
}

export const leer_buzon = {
  description: "Lista los mensajes pendientes (no procesados aún) del buzón único de contratos, con metadatos básicos de cada uno.",
  args: {},
  async execute(_args: Record<string, never>, ctx: Ctx): Promise<string> {
    return ejecutarSeguro("contratos_leer_buzon", null, ctx, (data) => `${data.mensajes.length} mensajes pendientes`, () =>
      listarBuzon(ctx.directory).then((mensajes) => ({ mensajes }))
    )
  },
}

export const extraer = {
  description:
    "Extrae del contrato (o documento asociado) de un mensaje sus datos estructurados — partes, objeto, valor, plazo, póliza — con un nivel de confianza por campo. Nunca inventa un valor ausente.",
  args: {
    mensaje_id: z.string().describe("Id del mensaje en fixtures/reto-02/buzon/, p. ej. 'msg-001'"),
  },
  async execute(args: { mensaje_id: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      "contratos_extraer",
      args.mensaje_id,
      ctx,
      (data) => `id=${data.id_contrato.valor ?? "?"} cliente=${data.cliente.valor ?? "?"}`,
      async () => {
        const carpeta = resolveFromRoot(ctx.directory, FIXTURES_ROOT, "buzon", args.mensaje_id)
        if (!fileExists(carpeta)) throw new Error(`No se encontró el mensaje "${args.mensaje_id}" en ${FIXTURES_ROOT}/buzon/`)
        const correo = await cargarCorreo(ctx.directory, args.mensaje_id)
        const adjunto = nombreAdjuntoContrato(correo.adjuntos)
        if (!adjunto) throw new Error("El mensaje no tiene ningún adjunto.")
        const rutaAdjunto = path.join(carpeta, adjunto)
        if (!fileExists(rutaAdjunto)) throw new Error(`El adjunto "${adjunto}" no existe en el mensaje.`)
        const texto = await readTextFile(rutaAdjunto)
        if (!texto.trim()) throw new Error(`El adjunto "${adjunto}" está vacío.`)
        const comerciales = await readJsonFile<Comercial[]>(resolveFromRoot(ctx.directory, FIXTURES_ROOT, "comerciales.json"))
        return extraerContrato(texto, correo.de, comerciales)
      }
    )
  },
}

export const validar = {
  description:
    "Clasifica un contrato ya extraído como nuevo, actualización, duplicado o rechazado comparándolo contra el maestro, y lista los campos que requieren revisión humana por baja confianza.",
  args: {
    mensaje_id: z.string().describe("Id del mensaje al que pertenece el contrato"),
    contrato: z.any().describe("El objeto ContratoExtraido devuelto por contratos_extraer"),
  },
  async execute(args: { mensaje_id: string; contrato: ContratoExtraido }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      "contratos_validar",
      args.mensaje_id,
      ctx,
      (data) => `${data.clasificacion}, revision=[${data.requiere_revision.join(",")}]`,
      async () => {
        const maestro = await cargarMaestro(ctx.directory)
        const resultado = clasificarContrato(args.contrato, maestro)
        const esActualizacion = resultado.clasificacion === "actualizacion"
        const requiere_revision =
          resultado.clasificacion === "nuevo" || esActualizacion ? camposParaRevision(args.contrato, esActualizacion) : []
        const avisos: string[] = []
        if (args.contrato.comercial_desconocido) avisos.push("El remitente no está registrado en comerciales.json.")
        if (resultado.motivoRechazo) avisos.push(resultado.motivoRechazo)
        return {
          clasificacion: resultado.clasificacion,
          id_contrato_existente: resultado.filaExistente?.id_contrato ?? null,
          requiere_revision,
          diferencias: resultado.diferencias,
          avisos,
        }
      }
    )
  },
}

export const registrar = {
  description:
    "Registra el contrato en el maestro y archiva el documento. Rechaza el registro si hay campos pendientes de revisión y no se confirmó explícitamente.",
  args: {
    mensaje_id: z.string().describe("Id del mensaje a registrar"),
    contrato: z.any().describe("El objeto ContratoExtraido devuelto por contratos_extraer"),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente registrar pese a los campos en revisión"),
  },
  async execute(args: { mensaje_id: string; contrato: ContratoExtraido; confirmado?: boolean }, ctx: Ctx): Promise<string> {
    const maestro = await cargarMaestro(ctx.directory)
    const resultadoClasificacion = clasificarContrato(args.contrato, maestro)
    const esActualizacion = resultadoClasificacion.clasificacion === "actualizacion"

    if (resultadoClasificacion.clasificacion === "nuevo" || esActualizacion) {
      const revision = camposParaRevision(args.contrato, esActualizacion)
      if (revision.length > 0 && !args.confirmado) {
        const mensaje = `requiere revisión: ${revision.join(", ")}`
        await appendLog(ctx.directory, "contratos_registrar", args.mensaje_id, false, mensaje)
        const resultado: Resultado<never> = { ok: false, error: mensaje }
        return JSON.stringify(resultado)
      }
    }

    return ejecutarSeguro(
      "contratos_registrar",
      args.mensaje_id,
      ctx,
      (data) => `${data.accion} ${data.id_contrato}`,
      async () => {
        const correo = await cargarCorreo(ctx.directory, args.mensaje_id)
        return registrarContrato(ctx.directory, args.mensaje_id, correo, args.contrato, resultadoClasificacion)
      }
    )
  },
}

export const alertas = {
  description: "Genera el reporte de alertas: contratos que vencen en 60 días, pólizas pendientes o vencidas, y contratos registrados desde el corte del 2026-05-30.",
  args: {
    hoy: z.string().describe("Fecha de referencia en formato YYYY-MM-DD, para que el reporte sea determinista"),
  },
  async execute(args: { hoy: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      "contratos_alertas",
      null,
      ctx,
      (data) => `vencen=${data.vencen.length} polizas=${data.polizas_pendientes.length} desde_corte=${data.registrados_desde_corte.length}`,
      () => generarAlertas(ctx.directory, args.hoy)
    )
  },
}

export const solicitar_confirmacion = {
  description:
    "Registra que el agente está esperando una confirmación explícita del usuario antes de registrar un contrato con campos en revisión. Úsala siempre justo antes de preguntar.",
  args: {
    mensaje_id: z.string().describe("Id del mensaje sobre el que se pide confirmación"),
    campos: z.array(z.string()).describe("Campos en revisión que se confirmarían"),
    resumen: z.string().describe("Resumen breve de lo que se registraría si el usuario confirma"),
  },
  async execute(args: { mensaje_id: string; campos: string[]; resumen: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      "contratos_solicitar_confirmacion",
      args.mensaje_id,
      ctx,
      () => `pendiente: ${args.campos.join(", ")}`,
      async () => ({ pendiente: true, campos: args.campos, resumen: args.resumen })
    )
  },
}

export const leer_pdf = {
  description: "Lee el texto de un adjunto (contrato u otrosí) a partir de su ruta relativa dentro de fixtures/ u out/. Útil cuando el modelo necesita releer el documento original.",
  args: {
    ruta: z.string().describe("Ruta relativa al proyecto, p. ej. 'fixtures/reto-02/buzon/msg-001/contrato.txt'"),
  },
  async execute(args: { ruta: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro("contratos_leer_pdf", null, ctx, () => `leído ${args.ruta}`, async () => {
      const normalizada = path.normalize(args.ruta)
      if (normalizada.startsWith("..") || path.isAbsolute(normalizada)) {
        throw new Error("Ruta no permitida: debe ser relativa y dentro del proyecto.")
      }
      if (!normalizada.startsWith(FIXTURES_ROOT) && !normalizada.startsWith(OUT_ROOT)) {
        throw new Error(`Ruta no permitida: debe estar dentro de ${FIXTURES_ROOT}/ o ${OUT_ROOT}/.`)
      }
      const absoluta = resolveFromRoot(ctx.directory, normalizada)
      if (!fileExists(absoluta)) throw new Error(`No existe el archivo "${args.ruta}".`)
      const texto = await readTextFile(absoluta)
      return { texto }
    })
  },
}
