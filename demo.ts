/**
 * Ejecuta todas las herramientas directamente, sin modelo de lenguaje, sobre
 * todos los casos de fixtures/reto-01/casos/. Sirve para verificar el
 * comportamiento determinista de las herramientas (sección 6.6 del PRD).
 *
 *   npm run demo
 */
import { readdir, rm } from "node:fs/promises"
import path from "node:path"
import * as proveedor from "./src/tools/proveedor.js"

const ROOT = process.cwd()
const CASOS_DIR = path.join(ROOT, "fixtures/reto-01/casos")

function ctx(sessionId: string) {
  return { directory: ROOT, sessionId }
}

async function limpiarOut(): Promise<void> {
  await rm(path.join(ROOT, "out"), { recursive: true, force: true })
}

async function listarCasos(): Promise<string[]> {
  const entradas = await readdir(CASOS_DIR, { withFileTypes: true })
  return entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}

async function procesarCaso(caso: string): Promise<void> {
  console.log(`\n=== ${caso} ===`)
  const c = ctx(`demo-${caso}`)

  const solicitud = JSON.parse(await proveedor.leer_solicitud.execute({ caso }, c))
  if (!solicitud.ok) {
    console.log(`  ❌ leer_solicitud: ${solicitud.error}`)
    return
  }
  console.log(`  ✅ leer_solicitud: formato=${solicitud.data.formato} pais=${solicitud.data.pais} campos=${solicitud.data.campos.length} soportes=${solicitud.data.soportes.length}`)

  const mapeo = JSON.parse(await proveedor.mapear_campos.execute({ caso }, c))
  if (!mapeo.ok) {
    console.log(`  ❌ mapear_campos: ${mapeo.error}`)
    return
  }
  console.log(
    `  ✅ mapear_campos: llenos=${mapeo.data.llenos.length} faltantes=${mapeo.data.faltantes.length} (${mapeo.data.faltantes.map((f: { etiqueta: string }) => f.etiqueta).join(", ") || "—"}) requiere_confirmacion=${mapeo.data.requiere_confirmacion.length} (${mapeo.data.requiere_confirmacion.map((f: { etiqueta: string }) => f.etiqueta).join(", ") || "—"})`
  )

  const formulario = JSON.parse(await proveedor.generar_formulario.execute({ caso, mapeo: mapeo.data }, c))
  console.log(formulario.ok ? `  ✅ generar_formulario: ${formulario.data.formato} -> ${formulario.data.ruta}` : `  ❌ generar_formulario: ${formulario.error}`)

  const paquete = JSON.parse(await proveedor.armar_paquete.execute({ caso }, c))
  console.log(
    paquete.ok
      ? `  ✅ armar_paquete: listo_para_firma=${paquete.data.listo_para_firma} ausentes=[${paquete.data.checklist.ausentes.join(", ")}] vencidos=[${paquete.data.checklist.vencidos.join(", ")}]`
      : `  ❌ armar_paquete: ${paquete.error}`
  )

  await proveedor.solicitar_confirmacion.execute({ caso, accion: "simular_envio", resumen: "enviar el paquete al cliente" }, c)

  const envioSinConfirmar = JSON.parse(await proveedor.simular_envio.execute({ caso, confirmado: false }, c))
  console.log(
    envioSinConfirmar.ok
      ? "  ❌ simular_envio sin confirmar: NO debería haber ejecutado"
      : `  ✅ simular_envio sin confirmar bloqueado: ${envioSinConfirmar.error}`
  )

  const envio = JSON.parse(await proveedor.simular_envio.execute({ caso, confirmado: true }, c))
  console.log(envio.ok ? `  ✅ simular_envio confirmado: ${envio.data.ruta}` : `  ❌ simular_envio confirmado: ${envio.error}`)
}

async function probarErrores(): Promise<void> {
  console.log("\n=== HU-5: manejo de errores ===")
  const c = ctx("demo-errores")

  const casoInexistente = JSON.parse(await proveedor.leer_solicitud.execute({ caso: "no-existe-xyz" }, c))
  console.log(
    casoInexistente.ok
      ? "  ❌ caso inexistente: debería fallar"
      : `  ✅ caso inexistente maneja error: ${casoInexistente.error}`
  )

  const envioNoArmado = JSON.parse(await proveedor.simular_envio.execute({ caso: "no-existe-xyz", confirmado: true }, c))
  console.log(
    envioNoArmado.ok ? "  ❌ envío sobre caso inexistente: debería fallar" : `  ✅ error controlado: ${envioNoArmado.error}`
  )
}

async function main(): Promise<void> {
  await limpiarOut()
  const casos = await listarCasos()
  console.log(`Casos encontrados: ${casos.join(", ")}`)
  for (const caso of casos) {
    await procesarCaso(caso)
  }
  await probarErrores()
  console.log("\nListo. Revisa out/<caso>/ para los artefactos generados (formulario, paquete/, log.jsonl).")
}

main().catch((err) => {
  console.error("Fallo inesperado en demo.ts:", err)
  process.exit(1)
})
