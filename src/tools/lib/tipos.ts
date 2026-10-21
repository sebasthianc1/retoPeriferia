export type FormatoSalida = "xlsx" | "pdf" | "portal"

export interface Solicitud {
  id: string
  de: string
  para: string
  asunto: string
  fecha: string
  pais: string
  cliente: string
  formato: FormatoSalida
  cuerpo: string
  adjuntos: string[]
}

export interface PlantillaCelda {
  hoja: string
  celda_etiqueta: string
  etiqueta: string
  celda_valor: string
}

export interface PlantillaCampo {
  etiqueta: string
  obligatorio: boolean
}

export interface CampoDetalle {
  etiqueta: string
  obligatorio: boolean | null
  ambiguo: boolean
  equivalente_pais?: string
}

export interface SolicitudLeida {
  pais: string
  cliente: string
  formato: FormatoSalida
  campos: string[]
  campos_detalle: CampoDetalle[]
  soportes: string[]
}

export interface CampoLleno {
  etiqueta: string
  clave_maestro: string
  valor: string
}

export interface CampoFaltante {
  etiqueta: string
  nota?: string
}

export interface CampoRequiereConfirmacion {
  etiqueta: string
  clave_maestro: string
  valor_propuesto: string
  razon: string
}

export interface MapeoCampos {
  llenos: CampoLleno[]
  faltantes: CampoFaltante[]
  requiere_confirmacion: CampoRequiereConfirmacion[]
}

export interface SoporteIndexado {
  tipo: string
  archivo: string
  vigencia_hasta: string | null
  pais_emisor: string
  descripcion: string
}

export interface Checklist {
  presentes: string[]
  ausentes: string[]
  vencidos: string[]
}
