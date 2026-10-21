import type { Clasificacion, ContratoExtraido, FilaMaestro } from "./tipos.js"

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
}

/** Similitud de Jaccard sobre conjuntos de palabras — determinista, sin dependencias. */
export function similitudTexto(a: string, b: string): number {
  const tokensA = new Set(normalizar(a).split(/\s+/).filter(Boolean))
  const tokensB = new Set(normalizar(b).split(/\s+/).filter(Boolean))
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let interseccion = 0
  for (const t of tokensA) if (tokensB.has(t)) interseccion++
  const union = tokensA.size + tokensB.size - interseccion
  return union === 0 ? 0 : interseccion / union
}

export interface ResultadoClasificacion {
  clasificacion: Clasificacion
  filaExistente: FilaMaestro | null
  diferencias: Record<string, { anterior: string; nuevo: string }> | undefined
  motivoRechazo?: string
}

function calcularDiferencias(fila: FilaMaestro, contrato: ContratoExtraido): Record<string, { anterior: string; nuevo: string }> | undefined {
  const diffs: Record<string, { anterior: string; nuevo: string }> = {}
  const comparar = (campo: keyof FilaMaestro, nuevoValor: string | null) => {
    if (nuevoValor === null) return
    if (fila[campo] !== nuevoValor) diffs[campo] = { anterior: fila[campo], nuevo: nuevoValor }
  }
  comparar("cliente", contrato.cliente.valor)
  comparar("nit_cliente", contrato.nit_cliente.valor)
  comparar("pais", contrato.pais.valor)
  comparar("objeto", contrato.objeto.valor)
  comparar("valor", contrato.valor.valor === null ? null : String(contrato.valor.valor))
  comparar("moneda", contrato.moneda.valor)
  comparar("fecha_inicio", contrato.fecha_inicio.valor)
  comparar("fecha_fin", contrato.fecha_fin.valor)
  return Object.keys(diffs).length > 0 ? diffs : undefined
}

export function clasificarContrato(contrato: ContratoExtraido, maestro: FilaMaestro[]): ResultadoClasificacion {
  const sinDatosEstructurales = !contrato.id_contrato.valor && !contrato.cliente.valor && !contrato.objeto.valor
  if (sinDatosEstructurales) {
    return {
      clasificacion: "rechazado",
      filaExistente: null,
      diferencias: undefined,
      motivoRechazo: "El documento no contiene partes (CONTRATANTE/CONTRATISTA) ni una cláusula de objeto identificables.",
    }
  }

  let filaExistente: FilaMaestro | null = null
  if (contrato.id_contrato.valor) {
    filaExistente = maestro.find((f) => f.id_contrato === contrato.id_contrato.valor) ?? null
  }
  if (!filaExistente && contrato.nit_cliente.valor && contrato.objeto.valor) {
    filaExistente =
      maestro.find((f) => f.nit_cliente === contrato.nit_cliente!.valor && similitudTexto(f.objeto, contrato.objeto.valor!) >= 0.9) ?? null
  }

  if (!filaExistente) {
    return { clasificacion: "nuevo", filaExistente: null, diferencias: undefined }
  }

  if (contrato.es_otrosi) {
    return { clasificacion: "actualizacion", filaExistente, diferencias: calcularDiferencias(filaExistente, contrato) }
  }

  const valorIgual = contrato.valor.valor === null || Number(filaExistente.valor) === contrato.valor.valor
  const inicioIgual = contrato.fecha_inicio.valor === null || filaExistente.fecha_inicio === contrato.fecha_inicio.valor
  const finIgual = contrato.fecha_fin.valor === null || filaExistente.fecha_fin === contrato.fecha_fin.valor

  if (valorIgual && inicioIgual && finIgual) {
    return { clasificacion: "duplicado", filaExistente, diferencias: undefined }
  }
  return { clasificacion: "actualizacion", filaExistente, diferencias: calcularDiferencias(filaExistente, contrato) }
}

const CAMPOS_EVALUABLES = [
  "id_contrato", "cliente", "nit_cliente", "pais", "objeto",
  "valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza",
] as const

/**
 * Campos con confianza < 0.8 que detienen el registro (RN5). El campo `comercial`
 * nunca entra aquí: un remitente desconocido se reporta (ver `avisos`) pero no bloquea,
 * tal como exige HU-3. En una actualización, un campo que el documento no tocó
 * (valor null) tampoco bloquea: se conserva el dato existente del maestro.
 */
export function camposParaRevision(contrato: ContratoExtraido, esActualizacion: boolean): string[] {
  const resultado: string[] = []
  for (const campo of CAMPOS_EVALUABLES) {
    const c = contrato[campo] as { valor: unknown; confianza: number }
    if (esActualizacion && c.valor === null) continue
    if (c.confianza < 0.8) resultado.push(campo)
  }
  return resultado
}
