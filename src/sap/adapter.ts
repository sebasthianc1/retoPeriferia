import type { OrdenCompra } from "../tools/lib/payload.js"

/** Interfaz del adaptador SAP (sección 7.4 del PRD). Una implementación real reemplaza src/sap/mock.ts sin tocar las herramientas. */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}
