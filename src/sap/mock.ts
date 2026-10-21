import { FIXTURES_ROOT, OUT_ROOT, appendLineToFile, readJsonFile, readLines, resolveFromRoot } from "../tools/lib/fs-helpers.js"
import { limpiarNit } from "../tools/lib/montos.js"
import type { OrdenCompra } from "../tools/lib/payload.js"
import type { Proveedor } from "../tools/lib/tipos.js"
import type { SapAdapter } from "./adapter.js"

const PRIMER_NUMERO_OC = 4_500_000_001

interface EntradaOrdenes {
  numero_oc: string
  fecha: string
  solicitud_id: string
  orden: OrdenCompra
}

/** Implementación simulada de SapAdapter sobre archivos en out/sap/ (sección 7.4 del PRD). */
export class SapMock implements SapAdapter {
  constructor(private readonly directory: string) {}

  private rutaOrdenes(): string {
    return resolveFromRoot(this.directory, OUT_ROOT, "sap", "ordenes.jsonl")
  }

  private async leerOrdenes(): Promise<EntradaOrdenes[]> {
    const lineas = await readLines(this.rutaOrdenes())
    return lineas.map((l) => JSON.parse(l) as EntradaOrdenes)
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const ruta = resolveFromRoot(this.directory, FIXTURES_ROOT, "maestros", "proveedores.json")
    const proveedores = await readJsonFile<Proveedor[]>(ruta)
    const limpio = limpiarNit(nit)
    const proveedor = proveedores.find((p) => p.nit === limpio)
    return proveedor ? { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const ordenes = await this.leerOrdenes()
    const encontrada = ordenes.find((o) => o.solicitud_id === solicitud_id)
    return encontrada ? { numero_oc: encontrada.numero_oc } : null
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const ordenes = await this.leerOrdenes()
    const numero_oc = String(PRIMER_NUMERO_OC + ordenes.length)
    const fecha = new Date().toISOString()
    const entrada: EntradaOrdenes = { numero_oc, fecha, solicitud_id: orden.referencia.solicitud_id, orden }
    await appendLineToFile(this.rutaOrdenes(), JSON.stringify(entrada))
    return { numero_oc, fecha }
  }
}
