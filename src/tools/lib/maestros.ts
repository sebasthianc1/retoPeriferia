import { FIXTURES_ROOT, readJsonFile, resolveFromRoot } from "./fs-helpers.js"
import type { CentroCosto, CondicionPago, IndicadorIva, Maestros, Proveedor } from "./tipos.js"

export async function cargarMaestros(directory: string): Promise<Maestros> {
  const base = resolveFromRoot(directory, FIXTURES_ROOT, "maestros")
  const [proveedores, centrosCosto, indicadoresIva, condicionesPago] = await Promise.all([
    readJsonFile<Proveedor[]>(`${base}/proveedores.json`),
    readJsonFile<CentroCosto[]>(`${base}/centros-costo.json`),
    readJsonFile<IndicadorIva[]>(`${base}/indicadores-iva.json`),
    readJsonFile<CondicionPago[]>(`${base}/condiciones-pago.json`),
  ])
  return { proveedores, centrosCosto, indicadoresIva, condicionesPago }
}
