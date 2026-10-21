export type Pais = "CO" | "EC" | "PE" | "PA" | "HN"
export type Moneda = "COP" | "USD" | "PEN" | "PAB" | "HNL"
export type EstadoPoliza = "vigente" | "pendiente" | "vencida" | "no_aplica"
export type Fuente = "buzon" | "manual" | "migracion"
export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado"

export interface Correo {
  id: string
  de: string
  para: string
  asunto: string
  fecha: string
  cuerpo: string
  adjuntos: string[]
}

export interface Comercial {
  email: string
  nombre: string
  region: string
}

/** Un campo extraído del texto, con su nivel de confianza en [0,1]. */
export interface CampoConfianza<T> {
  valor: T | null
  confianza: number
}

export interface ContratoExtraido {
  id_contrato: CampoConfianza<string>
  cliente: CampoConfianza<string>
  nit_cliente: CampoConfianza<string>
  pais: CampoConfianza<Pais>
  objeto: CampoConfianza<string>
  valor: CampoConfianza<number>
  valor_indeterminado: boolean
  moneda: CampoConfianza<Moneda>
  fecha_inicio: CampoConfianza<string>
  fecha_fin: CampoConfianza<string>
  requiere_poliza: CampoConfianza<boolean>
  tipo_poliza: CampoConfianza<string>
  comercial: CampoConfianza<string>
  comercial_desconocido: boolean
  es_otrosi: boolean
}

/** Una fila del maestro de contratos (fixtures/reto-02/maestro-contratos.csv). */
export interface FilaMaestro {
  id_contrato: string
  cliente: string
  nit_cliente: string
  pais: string
  objeto: string
  valor: string
  moneda: string
  fecha_inicio: string
  fecha_fin: string
  requiere_poliza: string
  tipo_poliza: string
  estado_poliza: string
  comercial: string
  ruta_sharepoint: string
  fecha_registro: string
  fuente: string
}

export const COLUMNAS_MAESTRO: (keyof FilaMaestro)[] = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
  "comercial",
  "ruta_sharepoint",
  "fecha_registro",
  "fuente",
]

export interface MensajeBuzon {
  id: string
  de: string
  asunto: string
  fecha: string
  adjuntos: string[]
  tiene_contrato: boolean
  motivo_rechazo?: string
}

export interface ResultadoValidacion {
  clasificacion: Clasificacion
  id_contrato_existente: string | null
  requiere_revision: string[]
  diferencias?: Record<string, { anterior: string; nuevo: string }>
  avisos: string[]
}
