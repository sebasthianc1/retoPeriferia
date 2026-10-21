import { z } from "zod"
import { appendLog, fileExists, readJsonFile, resolveFromRoot } from "./lib/fs-helpers.js"
import { leerPaquete } from "./lib/paquete.js"
import { cargarMaestros } from "./lib/maestros.js"
import { validarPaquete } from "./lib/controles.js"
import { construirPayload, OrdenCompraSchema } from "./lib/payload.js"
import { calcularSha256, generarEvidencia } from "./lib/evidencia.js"
import { registrarControl } from "./lib/control.js"
import { SapMock } from "../sap/mock.js"
import { OUT_ROOT, writeTextFile } from "./lib/fs-helpers.js"
import type { Paquete, ResultadoValidacion } from "./lib/tipos.js"

export interface Ctx {
  directory: string
  sessionId: string
}

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

async function ejecutarSeguro<T>(
  herramienta: string,
  caso: string | null,
  ctx: Ctx,
  resumenOk: (data: T) => string,
  tarea: () => Promise<T>
): Promise<string> {
  try {
    const data = await tarea()
    await appendLog(ctx.directory, herramienta, caso, true, resumenOk(data))
    const resultado: Resultado<T> = { ok: true, data }
    return JSON.stringify(resultado)
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err)
    await appendLog(ctx.directory, herramienta, caso, false, mensaje)
    const resultado: Resultado<T> = { ok: false, error: mensaje }
    return JSON.stringify(resultado)
  }
}

export const leer_paquete = {
  description: "Lee el correo, la solicitud, la cotización, la aprobación y la factura (si existe) de un caso, normalizados en un solo objeto.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. 'sol-001'"),
  },
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      "oc_leer_paquete",
      args.caso,
      ctx,
      (data) => `solicitud=${data.solicitud.solicitud_id} proveedor=${data.solicitud.proveedor_nombre} faltantes=[${data.faltantes.join(",")}]`,
      () => leerPaquete(ctx.directory, args.caso)
    )
  },
}

export const validar = {
  description:
    "Valida un paquete contra los maestros y los controles RC1–RC10: existencia y vigencia del proveedor, autoridad y tope del aprobador, consistencia de cotización y cantidades, IVA/condiciones de pago derivados, y si la OC sería retroactiva.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
    paquete: z.any().describe("El objeto Paquete devuelto por oc_leer_paquete"),
  },
  async execute(args: { caso: string; paquete: Paquete }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      "oc_validar",
      args.caso,
      ctx,
      (data) => `apta=${data.apta} bloqueos=[${data.bloqueos.map((b) => b.codigo).join(",")}] confirmaciones=[${data.confirmaciones.map((c) => c.codigo).join(",")}] retroactiva=${data.retroactiva}`,
      async () => {
        const maestros = await cargarMaestros(ctx.directory)
        return validarPaquete(args.paquete, maestros)
      }
    )
  },
}

export const construir_payload = {
  description:
    "Construye el payload de la orden de compra exactamente como quedaría en SAP, con trazabilidad de cada campo a su fuente. No crea la OC, solo la arma para revisión.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
    paquete: z.any().describe("El objeto Paquete devuelto por oc_leer_paquete"),
    derivados: z.any().optional().describe("Derivados sugeridos por oc_validar (informativo; se recalculan internamente)"),
  },
  async execute(args: { caso: string; paquete: Paquete }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      "oc_construir_payload",
      args.caso,
      ctx,
      (data) => `proveedor=${data.payload.proveedor.nombre} condiciones_pago=${data.payload.condiciones_pago} excepciones=${data.payload.excepciones.length}`,
      async () => {
        const maestros = await cargarMaestros(ctx.directory)
        const validacion = validarPaquete(args.paquete, maestros)
        if (!validacion.proveedor) throw new Error("No se puede construir el payload: el proveedor no existe en el maestro (RC1).")
        if (!args.paquete.aprobacion) throw new Error("No se puede construir el payload: falta el correo de aprobación.")

        const sha256 = calcularSha256(args.paquete.aprobacion, args.paquete.correo.asunto)
        const { payload, trazabilidad } = construirPayload(args.paquete, validacion, sha256)
        OrdenCompraSchema.parse(payload)

        const rutaTrazabilidad = resolveFromRoot(ctx.directory, OUT_ROOT, args.caso, "trazabilidad.json")
        await writeTextFile(rutaTrazabilidad, JSON.stringify(trazabilidad, null, 2) + "\n")

        return { payload, ruta_trazabilidad: `${OUT_ROOT}/${args.caso}/trazabilidad.json` }
      }
    )
  },
}

export const generar_evidencia = {
  description: "Genera la evidencia de aprobación (texto y PDF) con su hash sha256, para adjuntarla a la orden de compra.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
  },
  async execute(args: { caso: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro("oc_generar_evidencia", args.caso, ctx, (data) => `${data.ruta} sha256=${data.sha256.slice(0, 12)}…`, async () => {
      const paquete = await leerPaquete(ctx.directory, args.caso)
      if (!paquete.aprobacion) throw new Error("No hay correo de aprobación para generar evidencia.")
      return generarEvidencia(ctx.directory, args.caso, paquete.aprobacion, paquete.correo.asunto)
    })
  },
}

function resumenValidacion(v: ResultadoValidacion): string {
  const partes = [
    ...v.bloqueos.map((b) => `${b.codigo}: ${b.detalle}`),
    ...v.confirmaciones.map((c) => `${c.codigo}: ${c.detalle}`),
  ]
  return partes.join(" | ")
}

export const crear = {
  description:
    "Crea la orden de compra en el SAP simulado. Solo procede si el caso está apto y, si hay confirmaciones pendientes, si el usuario confirmó explícitamente. Si el solicitud_id ya tiene una OC creada, devuelve el número existente (idempotencia).",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso"),
    payload: z.any().describe("El payload previsualizado por oc_construir_payload (se revalida internamente antes de crear)"),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente pese a las confirmaciones pendientes"),
  },
  async execute(args: { caso: string; payload: unknown; confirmado?: boolean }, ctx: Ctx): Promise<string> {
    const sap = new SapMock(ctx.directory)
    const paquete = await leerPaquete(ctx.directory, args.caso)
    const maestros = await cargarMaestros(ctx.directory)

    const existente = await sap.buscarOrdenPorReferencia(paquete.solicitud.solicitud_id)
    if (existente) {
      await registrarControl(ctx.directory, {
        solicitud_id: paquete.solicitud.solicitud_id,
        resultado: "idempotente",
        numero_oc: existente.numero_oc,
        retroactiva: false,
        bloqueos: [],
        confirmaciones: [],
      })
      await appendLog(ctx.directory, "oc_crear", args.caso, true, `idempotente: ya existía ${existente.numero_oc}`)
      const resultado: Resultado<{ numero_oc: string; fecha: string; idempotente: boolean }> = {
        ok: true,
        data: { numero_oc: existente.numero_oc, fecha: "", idempotente: true },
      }
      return JSON.stringify(resultado)
    }

    const validacion = validarPaquete(paquete, maestros)

    if (!validacion.apta) {
      await registrarControl(ctx.directory, {
        solicitud_id: paquete.solicitud.solicitud_id,
        resultado: "bloqueada",
        numero_oc: "",
        retroactiva: validacion.retroactiva,
        bloqueos: validacion.bloqueos.map((b) => b.codigo),
        confirmaciones: validacion.confirmaciones.map((c) => c.codigo),
      })
      const mensaje = `bloqueado: ${resumenValidacion(validacion)}`
      await appendLog(ctx.directory, "oc_crear", args.caso, false, mensaje)
      const resultado: Resultado<never> = { ok: false, error: mensaje }
      return JSON.stringify(resultado)
    }

    if (validacion.confirmaciones.length > 0 && !args.confirmado) {
      await registrarControl(ctx.directory, {
        solicitud_id: paquete.solicitud.solicitud_id,
        resultado: "pendiente_confirmacion",
        numero_oc: "",
        retroactiva: validacion.retroactiva,
        bloqueos: [],
        confirmaciones: validacion.confirmaciones.map((c) => c.codigo),
      })
      const mensaje = `requiere confirmación: ${resumenValidacion(validacion)}`
      await appendLog(ctx.directory, "oc_crear", args.caso, false, mensaje)
      const resultado: Resultado<never> = { ok: false, error: mensaje }
      return JSON.stringify(resultado)
    }

    return ejecutarSeguro(
      "oc_crear",
      args.caso,
      ctx,
      (data) => `OC ${data.numero_oc} creada (retroactiva=${validacion.retroactiva})`,
      async () => {
        if (!paquete.aprobacion) throw new Error("No hay correo de aprobación.")
        const evidencia = await generarEvidencia(ctx.directory, args.caso, paquete.aprobacion, paquete.correo.asunto)
        const { payload, trazabilidad } = construirPayload(paquete, validacion, evidencia.sha256)
        payload.excepciones = payload.excepciones.map((e) => ({ ...e, confirmado_por: "analista (chat)" }))
        OrdenCompraSchema.parse(payload)

        await writeTextFile(
          resolveFromRoot(ctx.directory, OUT_ROOT, args.caso, "trazabilidad.json"),
          JSON.stringify(trazabilidad, null, 2) + "\n"
        )

        const creada = await sap.crearOrden(payload)
        await registrarControl(ctx.directory, {
          solicitud_id: paquete.solicitud.solicitud_id,
          resultado: "creada",
          numero_oc: creada.numero_oc,
          retroactiva: validacion.retroactiva,
          bloqueos: [],
          confirmaciones: validacion.confirmaciones.map((c) => c.codigo),
        })

        return { numero_oc: creada.numero_oc, fecha: creada.fecha, idempotente: false }
      }
    )
  },
}

export const solicitar_confirmacion = {
  description:
    "Registra que el agente está esperando una confirmación explícita del usuario antes de crear una OC con confirmaciones pendientes. Úsala siempre justo antes de preguntar.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso sobre el que se pide confirmación"),
    codigos: z.array(z.string()).describe("Códigos de control (RC5, RC6, RC8, RC9...) que se confirmarían"),
    resumen: z.string().describe("Resumen breve de lo que se crearía si el usuario confirma"),
  },
  async execute(args: { caso: string; codigos: string[]; resumen: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro(
      "oc_solicitar_confirmacion",
      args.caso,
      ctx,
      () => `pendiente: ${args.codigos.join(", ")}`,
      async () => ({ pendiente: true, codigos: args.codigos, resumen: args.resumen })
    )
  },
}

export const leer_excel = {
  description:
    "Lee un archivo de solicitud en formato JSON (representación normalizada del Excel original) y devuelve sus filas. Soporte P1 opcional para formatos de entrada adicionales.",
  args: {
    ruta: z.string().describe("Ruta relativa al proyecto de un archivo .json con un arreglo de filas"),
  },
  async execute(args: { ruta: string }, ctx: Ctx): Promise<string> {
    return ejecutarSeguro("oc_leer_excel", null, ctx, (data) => `${data.filas.length} filas`, async () => {
      const normalizada = args.ruta.replace(/\\/g, "/")
      if (normalizada.includes("..") || normalizada.startsWith("/")) throw new Error("Ruta no permitida.")
      const absoluta = resolveFromRoot(ctx.directory, normalizada)
      if (!fileExists(absoluta)) throw new Error(`No existe el archivo "${args.ruta}".`)
      const filas = await readJsonFile<unknown[]>(absoluta)
      return { filas }
    })
  },
}
