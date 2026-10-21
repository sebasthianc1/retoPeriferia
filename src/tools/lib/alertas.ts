import { OUT_ROOT, resolveFromRoot, writeTextFile } from "./fs-helpers.js"
import { cargarMaestro } from "./registro.js"
import type { FilaMaestro } from "./tipos.js"

const FECHA_CORTE = "2026-05-30"

function diasEntre(desde: string, hasta: string): number {
  const a = new Date(`${desde}T00:00:00Z`).getTime()
  const b = new Date(`${hasta}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

export interface ResultadoAlertas {
  ruta: string
  vencen: FilaMaestro[]
  polizas_pendientes: FilaMaestro[]
  registrados_desde_corte: FilaMaestro[]
}

export async function generarAlertas(directory: string, hoy: string): Promise<ResultadoAlertas> {
  const filas = await cargarMaestro(directory)

  const vencen = filas
    .filter((f) => f.fecha_fin && diasEntre(hoy, f.fecha_fin) >= 0 && diasEntre(hoy, f.fecha_fin) <= 60)
    .sort((a, b) => a.fecha_fin.localeCompare(b.fecha_fin))

  const polizas_pendientes = filas.filter((f) => f.requiere_poliza === "true" && f.estado_poliza !== "vigente")

  const registrados_desde_corte = filas
    .filter((f) => f.fecha_registro >= FECHA_CORTE)
    .sort((a, b) => a.fecha_registro.localeCompare(b.fecha_registro))

  const lineas: string[] = [
    "# Reporte de alertas — Contratos vigentes",
    "",
    `Generado con fecha de referencia: ${hoy}`,
    "",
    "## Contratos que vencen en los próximos 60 días",
    "",
  ]
  if (vencen.length === 0) lineas.push("Ninguno.")
  else {
    lineas.push("| Contrato | Cliente | Vence | Días restantes |", "|---|---|---|---|")
    for (const f of vencen) lineas.push(`| ${f.id_contrato} | ${f.cliente} | ${f.fecha_fin} | ${diasEntre(hoy, f.fecha_fin)} |`)
  }

  lineas.push("", "## Pólizas pendientes o vencidas", "")
  if (polizas_pendientes.length === 0) lineas.push("Ninguna.")
  else {
    lineas.push("| Contrato | Cliente | Tipo de póliza | Estado |", "|---|---|---|---|")
    for (const f of polizas_pendientes) lineas.push(`| ${f.id_contrato} | ${f.cliente} | ${f.tipo_poliza} | ${f.estado_poliza} |`)
  }

  lineas.push("", `## Contratos registrados desde el corte (${FECHA_CORTE})`, "")
  if (registrados_desde_corte.length === 0) lineas.push("Ninguno todavía — el gap de junio–agosto de 2026 sigue sin cerrar.")
  else {
    lineas.push("| Contrato | Cliente | Fecha de registro | Fuente |", "|---|---|---|---|")
    for (const f of registrados_desde_corte) lineas.push(`| ${f.id_contrato} | ${f.cliente} | ${f.fecha_registro} | ${f.fuente} |`)
  }

  const ruta = resolveFromRoot(directory, OUT_ROOT, "alertas.md")
  await writeTextFile(ruta, lineas.join("\n") + "\n")

  return { ruta: `${OUT_ROOT}/alertas.md`, vencen, polizas_pendientes, registrados_desde_corte }
}
