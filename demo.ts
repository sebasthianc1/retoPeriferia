/**
 * Ejecuta todas las herramientas directamente, sin modelo de lenguaje, sobre
 * los 6 casos de fixtures/reto-03/solicitudes/. Sirve para verificar el
 * comportamiento determinista de las herramientas (sección 6.6 del PRD).
 *
 *   npm run demo
 */
import { rm } from "node:fs/promises"
import path from "node:path"
import * as oc from "./src/tools/oc.js"

const ROOT = process.cwd()

function ctx(sessionId: string) {
  return { directory: ROOT, sessionId }
}

async function limpiarOut(): Promise<void> {
  await rm(path.join(ROOT, "out"), { recursive: true, force: true })
}

async function procesarCaso(caso: string): Promise<void> {
  console.log(`\n=== ${caso} ===`)
  const c = ctx(`demo-${caso}`)

  const lectura = JSON.parse(await oc.leer_paquete.execute({ caso }, c))
  if (!lectura.ok) {
    console.log(`  ❌ leer_paquete: ${lectura.error}`)
    return
  }
  console.log(`  ✅ leer_paquete: solicitud=${lectura.data.solicitud.solicitud_id} proveedor=${lectura.data.solicitud.proveedor_nombre}`)

  const validacion = JSON.parse(await oc.validar.execute({ caso, paquete: lectura.data }, c))
  if (!validacion.ok) {
    console.log(`  ❌ validar: ${validacion.error}`)
    return
  }
  console.log(
    `  ✅ validar: apta=${validacion.data.apta} bloqueos=[${validacion.data.bloqueos.map((b: { codigo: string }) => b.codigo).join(", ")}] confirmaciones=[${validacion.data.confirmaciones.map((cf: { codigo: string }) => cf.codigo).join(", ")}] retroactiva=${validacion.data.retroactiva}`
  )
  for (const b of validacion.data.bloqueos as { codigo: string; detalle: string }[]) console.log(`      🚫 ${b.codigo}: ${b.detalle}`)
  for (const cf of validacion.data.confirmaciones as { codigo: string; detalle: string }[]) console.log(`      ❓ ${cf.codigo}: ${cf.detalle}`)

  if (validacion.data.apta) {
    const payload = JSON.parse(await oc.construir_payload.execute({ caso, paquete: lectura.data }, c))
    console.log(payload.ok ? `  ✅ construir_payload: proveedor=${payload.data.payload.proveedor.nombre} excepciones=${payload.data.payload.excepciones.length}` : `  ❌ construir_payload: ${payload.error}`)
  }

  const intento1 = JSON.parse(await oc.crear.execute({ caso, payload: {} }, c))
  if (intento1.ok) {
    console.log(`  ✅ crear: OC ${intento1.data.numero_oc} (idempotente=${intento1.data.idempotente})`)
  } else if (validacion.data.confirmaciones.length > 0) {
    console.log(`  ⏸️  crear (primera pasada): ${intento1.error} — queda sin crear hasta confirmar`)
    const intento2 = JSON.parse(await oc.crear.execute({ caso, payload: {}, confirmado: true }, c))
    console.log(intento2.ok ? `  ✅ crear (confirmado=true): OC ${intento2.data.numero_oc}` : `  ❌ crear confirmado: ${intento2.error}`)
  } else {
    console.log(`  🚫 crear: ${intento1.error}`)
  }
}

async function main(): Promise<void> {
  await limpiarOut()

  const casos = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]
  for (const caso of casos) await procesarCaso(caso)

  console.log("\n=== Idempotencia: reprocesar sol-001 ===")
  const segunda = JSON.parse(await oc.crear.execute({ caso: "sol-001", payload: {} }, ctx("demo-idempotencia")))
  console.log(segunda.ok ? `  ✅ segunda creación de sol-001: OC ${segunda.data.numero_oc} (idempotente=${segunda.data.idempotente})` : `  ❌ ${segunda.error}`)

  console.log("\n=== HU-6: manejo de errores (caso inexistente) ===")
  const error = JSON.parse(await oc.leer_paquete.execute({ caso: "sol-999" }, ctx("demo-errores")))
  console.log(error.ok ? "  ❌ debería fallar" : `  ✅ error controlado: ${error.error}`)

  console.log("\nListo. Revisa out/ para payloads de trazabilidad, evidencia, out/sap/ordenes.jsonl y out/control.csv.")
}

main().catch((err) => {
  console.error("Fallo inesperado en demo.ts:", err)
  process.exit(1)
})
