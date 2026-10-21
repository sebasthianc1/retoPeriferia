/**
 * Ejecuta todas las herramientas directamente, sin modelo de lenguaje, sobre
 * los 6 mensajes de fixtures/reto-02/buzon/, en orden. Sirve para verificar el
 * comportamiento determinista de las herramientas (sección 6.6 del PRD).
 *
 *   npm run demo
 */
import { rm } from "node:fs/promises"
import path from "node:path"
import * as contratos from "./src/tools/contratos.js"

const ROOT = process.cwd()
const HOY_DEMO = "2026-09-03"

function ctx(sessionId: string) {
  return { directory: ROOT, sessionId }
}

async function limpiarOut(): Promise<void> {
  await rm(path.join(ROOT, "out"), { recursive: true, force: true })
}

async function procesarMensaje(mensajeId: string): Promise<void> {
  console.log(`\n=== ${mensajeId} ===`)
  const c = ctx(`demo-${mensajeId}`)

  const extraccion = JSON.parse(await contratos.extraer.execute({ mensaje_id: mensajeId }, c))
  if (!extraccion.ok) {
    console.log(`  ❌ extraer: ${extraccion.error}`)
    return
  }
  console.log(`  ✅ extraer: id=${extraccion.data.id_contrato.valor ?? "—"} cliente=${extraccion.data.cliente.valor ?? "—"}`)

  const validacion = JSON.parse(await contratos.validar.execute({ mensaje_id: mensajeId, contrato: extraccion.data }, c))
  if (!validacion.ok) {
    console.log(`  ❌ validar: ${validacion.error}`)
    return
  }
  console.log(
    `  ✅ validar: clasificacion=${validacion.data.clasificacion} requiere_revision=[${validacion.data.requiere_revision.join(", ")}] avisos=[${validacion.data.avisos.join(" | ")}]`
  )

  const registro = JSON.parse(await contratos.registrar.execute({ mensaje_id: mensajeId, contrato: extraccion.data }, c))
  if (!registro.ok) {
    console.log(`  ⏸️  registrar (primera pasada): ${registro.error} — queda SIN registrar hasta confirmar`)

    const confirmacion = JSON.parse(
      await contratos.solicitar_confirmacion.execute(
        { mensaje_id: mensajeId, campos: validacion.data.requiere_revision, resumen: "registrar con los valores extraídos tal cual" },
        c
      )
    )
    console.log(`  ✅ solicitar_confirmacion: ${confirmacion.ok}`)

    const registroConfirmado = JSON.parse(
      await contratos.registrar.execute({ mensaje_id: mensajeId, contrato: extraccion.data, confirmado: true }, c)
    )
    console.log(
      registroConfirmado.ok
        ? `  ✅ registrar (segunda pasada, confirmado=true): ${registroConfirmado.data.accion} ${registroConfirmado.data.id_contrato}`
        : `  ❌ registrar confirmado: ${registroConfirmado.error}`
    )
    return
  }
  console.log(`  ✅ registrar: ${registro.data.accion} ${registro.data.id_contrato} -> ${registro.data.ruta_archivo ?? "(sin archivo)"}`)
}

async function main(): Promise<void> {
  await limpiarOut()

  const buzon = JSON.parse(await contratos.leer_buzon.execute({}, ctx("demo-buzon")))
  console.log(`Mensajes pendientes: ${buzon.data.mensajes.map((m: { id: string }) => m.id).join(", ")}`)

  for (const mensaje of buzon.data.mensajes as { id: string }[]) {
    await procesarMensaje(mensaje.id)
  }

  console.log("\n=== Reporte de alertas ===")
  const alertas = JSON.parse(await contratos.alertas.execute({ hoy: HOY_DEMO }, ctx("demo-alertas")))
  console.log(
    alertas.ok
      ? `  ✅ alertas: vencen=${alertas.data.vencen.length} polizas_pendientes=${alertas.data.polizas_pendientes.length} registrados_desde_corte=${alertas.data.registrados_desde_corte.length} -> ${alertas.data.ruta}`
      : `  ❌ alertas: ${alertas.error}`
  )

  console.log("\n=== HU-6: manejo de errores (mensaje inexistente) ===")
  const error = JSON.parse(await contratos.extraer.execute({ mensaje_id: "msg-999" }, ctx("demo-errores")))
  console.log(error.ok ? "  ❌ debería fallar" : `  ✅ error controlado: ${error.error}`)

  console.log("\nListo. Revisa out/ para el maestro, el historial, los archivos y las alertas generadas.")
}

main().catch((err) => {
  console.error("Fallo inesperado en demo.ts:", err)
  process.exit(1)
})
