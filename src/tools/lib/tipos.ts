export interface Correo {
  id: string
  de: string
  asunto: string
  fecha: string
}

export interface Solicitud {
  solicitud_id: string
  solicitante: string
  proveedor_nombre: string
  proveedor_nit?: string
  descripcion: string
  centro_costo: string
  subarea: string
  cantidad: number
  valor_unitario: number
  valor_total: number
  moneda: string
  indicador_iva?: string
  condiciones_pago?: string
  fecha_solicitud: string
}

export interface Cotizacion {
  proveedor: string
  nit: string | null
  numero: string | null
  total: number
  moneda: string
  validez_hasta: string | null
  texto: string
}

export interface Aprobacion {
  de: string
  fecha: string
  aprobado: boolean
  texto: string
}

export interface Factura {
  numero: string
  fecha: string
  total: number
}

export interface Paquete {
  correo: Correo
  solicitud: Solicitud
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
  faltantes: string[]
}

export interface Proveedor {
  codigo_sap: string
  nit: string
  nombre: string
  condiciones_pago_default: string
  indicador_iva_default: string
  activo: boolean
}

export interface Aprobador {
  email: string
  nombre?: string
  tope: number
}

export interface CentroCosto {
  centro_costo: string
  nombre?: string
  subareas: string[]
  aprobadores: Aprobador[]
}

export interface IndicadorIva {
  codigo: string
  descripcion: string
  tasa: number
}

export interface CondicionPago {
  codigo: string
  descripcion: string
  dias: number
}

export interface Maestros {
  proveedores: Proveedor[]
  centrosCosto: CentroCosto[]
  indicadoresIva: IndicadorIva[]
  condicionesPago: CondicionPago[]
}

export interface Bloqueo {
  codigo: string
  detalle: string
  sugerencia: string
}

export interface Confirmacion {
  codigo: string
  detalle: string
  valores?: Record<string, string>
}

export interface Derivados {
  indicador_iva?: string
  condiciones_pago?: string
}

export interface ResultadoValidacion {
  apta: boolean
  bloqueos: Bloqueo[]
  confirmaciones: Confirmacion[]
  derivados: Derivados
  retroactiva: boolean
  proveedor: Proveedor | null
}
