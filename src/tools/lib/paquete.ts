import path from "node:path"
import { FIXTURES_ROOT, OUT_ROOT, copyFile, ensureDir, readJsonFile, resolveFromRoot, writeTextFile } from "./fs-helpers.js"
import { cargarIndiceSoportes, cargarSolicitud, mapearCamposInterno } from "./mapeo.js"
import { formularioYaGenerado, generarFormularioInterno, rutaFormularioExistente } from "./generar.js"
import type { Checklist } from "./tipos.js"

export interface ResultadoPaquete {
  ruta: string
  listo_para_firma: boolean
  checklist: Checklist
}

function soporteVigente(vigencia_hasta: string | null, ahora: Date): boolean {
  if (!vigencia_hasta) return true
  return new Date(vigencia_hasta) >= ahora
}

function nombreSoporte(tipo: string): string {
  return tipo.replaceAll("_", " ")
}

export async function armarPaqueteInterno(directory: string, caso: string): Promise<ResultadoPaquete> {
  const solicitud = await cargarSolicitud(directory, caso)
  const soportesExigidosArchivo = resolveFromRoot(directory, FIXTURES_ROOT, "casos", caso, "soportes-exigidos.json")
  const soportesExigidos = await readJsonFile<string[]>(soportesExigidosArchivo)
  const indice = await cargarIndiceSoportes(directory)
  const mapeo = await mapearCamposInterno(directory, caso)

  if (!formularioYaGenerado(directory, caso, solicitud.formato)) {
    await generarFormularioInterno(directory, caso, mapeo)
  }

  const ahora = new Date()
  const presentes: string[] = []
  const ausentes: string[] = []
  const vencidos: string[] = []

  const rutaPaquete = resolveFromRoot(directory, OUT_ROOT, caso, "paquete")
  const rutaSoportesPaquete = path.join(rutaPaquete, "soportes")
  await ensureDir(rutaSoportesPaquete)

  for (const tipo of soportesExigidos) {
    const entrada = indice.find((s) => s.tipo === tipo)
    if (!entrada) {
      ausentes.push(tipo)
      continue
    }
    const vigente = soporteVigente(entrada.vigencia_hasta, ahora)
    if (!vigente) vencidos.push(tipo)
    else presentes.push(tipo)

    const origen = resolveFromRoot(directory, FIXTURES_ROOT, "repositorio", "soportes", entrada.archivo)
    const destino = path.join(rutaSoportesPaquete, entrada.archivo)
    await copyFile(origen, destino)
  }

  const rutaFormularioOrigen = rutaFormularioExistente(directory, caso, solicitud.formato)
  const nombreFormulario = path.basename(rutaFormularioOrigen)
  await copyFile(rutaFormularioOrigen, path.join(rutaPaquete, nombreFormulario))

  const listo_para_firma = ausentes.length === 0 && vencidos.length === 0

  const checklistLineas = [
    `# Checklist de soportes — ${caso}`,
    "",
    `Cliente: ${solicitud.cliente} (${solicitud.pais})`,
    `Generado: ${ahora.toISOString()}`,
    "",
    "## Soportes",
    "",
    ...presentes.map((t) => `- ✅ ${nombreSoporte(t)} — presente y vigente`),
    ...vencidos.map((t) => `- ⚠️ ${nombreSoporte(t)} — presente pero VENCIDO`),
    ...ausentes.map((t) => `- ❌ ${nombreSoporte(t)} — ausente en el repositorio`),
    "",
    "## Campos del formulario",
    "",
    `- Llenos desde el maestro: ${mapeo.llenos.length}`,
    `- Requieren confirmación: ${mapeo.requiere_confirmacion.length}${
      mapeo.requiere_confirmacion.length ? " (" + mapeo.requiere_confirmacion.map((c) => c.etiqueta).join(", ") + ")" : ""
    }`,
    `- Faltantes (no inventados, quedan en blanco): ${mapeo.faltantes.length}${
      mapeo.faltantes.length ? " (" + mapeo.faltantes.map((c) => c.etiqueta).join(", ") + ")" : ""
    }`,
    "",
    `## Estado: ${listo_para_firma ? "✅ LISTO PARA FIRMA" : "⛔ NO LISTO PARA FIRMA"}`,
    "",
    ...(listo_para_firma
      ? []
      : ["Motivo: hay soportes vencidos o ausentes. Los campos faltantes no bloquean la firma, solo los soportes."]),
  ]
  await writeTextFile(path.join(rutaPaquete, "checklist.md"), checklistLineas.join("\n") + "\n")

  const correoLineas = [
    `Para: ${solicitud.de}`,
    `Asunto: Re: ${solicitud.asunto}`,
    "",
    "Estimados,",
    "",
    `Adjuntamos el formulario de registro como proveedor de Periferia IT Group diligenciado, junto con los soportes solicitados.`,
    "",
    "Soportes incluidos:",
    ...presentes.concat(vencidos).map((t) => `- ${nombreSoporte(t)}`),
    ...(ausentes.length
      ? ["", `Nota: aún no contamos con ${ausentes.map(nombreSoporte).join(", ")}; lo haremos llegar en cuanto esté disponible.`]
      : []),
    "",
    "Quedamos atentos a cualquier observación.",
    "",
    "Saludos cordiales,",
    "Periferia IT Group S.A.S.",
  ]
  await writeTextFile(path.join(rutaPaquete, "borrador-correo.md"), correoLineas.join("\n") + "\n")

  return {
    ruta: path.relative(directory, rutaPaquete).replaceAll("\\", "/") + "/",
    listo_para_firma,
    checklist: { presentes, ausentes, vencidos },
  }
}

export function rutaPaqueteExiste(directory: string, caso: string): string {
  return resolveFromRoot(directory, OUT_ROOT, caso, "paquete")
}
