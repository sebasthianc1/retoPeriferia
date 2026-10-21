import { OUT_ROOT, fileExists, resolveFromRoot, writeTextFile } from "./fs-helpers.js"
import { readFile } from "node:fs/promises"

const COLUMNAS = ["solicitud_id", "resultado", "numero_oc", "retroactiva", "bloqueos", "confirmaciones", "ts"] as const

export type ResultadoControl = "creada" | "idempotente" | "bloqueada" | "pendiente_confirmacion"

export interface FilaControl {
  solicitud_id: string
  resultado: ResultadoControl
  numero_oc: string
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

function escaparCampo(valor: string): string {
  return valor.includes(",") || valor.includes('"') ? `"${valor.replace(/"/g, '""')}"` : valor
}

export async function registrarControl(directory: string, fila: FilaControl): Promise<void> {
  const ruta = resolveFromRoot(directory, OUT_ROOT, "control.csv")
  const existe = fileExists(ruta)
  const valores = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc,
    String(fila.retroactiva),
    fila.bloqueos.join(";"),
    fila.confirmaciones.join(";"),
    new Date().toISOString(),
  ].map(escaparCampo)

  const linea = valores.join(",") + "\n"
  if (!existe) {
    await writeTextFile(ruta, COLUMNAS.join(",") + "\n" + linea)
    return
  }
  const actual = await readFile(ruta, "utf8")
  await writeTextFile(ruta, actual + linea)
}
