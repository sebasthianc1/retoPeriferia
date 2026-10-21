import type { CampoConfianza, Comercial, ContratoExtraido, Moneda, Pais } from "./tipos.js"

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10",
  noviembre: "11", diciembre: "12",
}

const CIUDAD_A_PAIS: Record<string, Pais> = {
  "bogotá": "CO", "bogota": "CO", "medellín": "CO", "medellin": "CO", "barranquilla": "CO", "cali": "CO",
  "quito": "EC", "guayaquil": "EC",
  "lima": "PE", "arequipa": "PE",
  "panamá": "PA", "panama": "PA",
  "tegucigalpa": "HN", "san pedro sula": "HN",
}

function campo<T>(valor: T | null, confianza: number): CampoConfianza<T> {
  return { valor, confianza: valor === null ? 0 : confianza }
}

/**
 * Captura el cuerpo de una cláusula. Soporta dos formatos: el directo de un contrato
 * ("<ORDINAL>. <PALABRA_CLAVE>. <texto>", hasta el siguiente título de cláusula o el
 * final del documento) y el de un otrosí que la modifica
 * ("...cláusula ... (<PALABRA_CLAVE>), la cual quedará así: "<texto>"").
 */
function extraerClausula(texto: string, palabraClave: string): string | null {
  // Sin "i": un encabezado de cláusula real siempre va en mayúsculas ("OBJETO.", "PLAZO.");
  // en minúsculas, la misma palabra aparece como prosa normal ("...el nuevo plazo.") y no debe confundirse con un encabezado.
  const patronDirecto = new RegExp(`${palabraClave}\\.\\s*([\\s\\S]*?)(?:\\n\\n[A-ZÁÉÍÓÚÑ]{4,}\\.|$)`)
  const directo = texto.match(patronDirecto)
  if (directo) return directo[1]!.trim().replace(/\s+/g, " ")

  const patronOtrosi = new RegExp(`\\(${palabraClave}\\)[^"]*"([^"]+)"`)
  const otrosi = texto.match(patronOtrosi)
  return otrosi ? otrosi[1]!.trim().replace(/\s+/g, " ") : null
}

function fechaIso(dia: string, mesNombre: string, anio: string): string | null {
  const mes = MESES[mesNombre.toLowerCase()]
  if (!mes) return null
  return `${anio}-${mes}-${dia.padStart(2, "0")}`
}

function sumarMeses(fechaIsoInicio: string, meses: number): string {
  const [anio, mes, dia] = fechaIsoInicio.split("-").map(Number) as [number, number, number]
  const fin = new Date(Date.UTC(anio, mes - 1 + meses, dia))
  fin.setUTCDate(fin.getUTCDate() - 1)
  return fin.toISOString().slice(0, 10)
}

function primerDiaSiguienteMes(mesNombre: string, anio: string): string | null {
  const mes = MESES[mesNombre.toLowerCase()]
  if (!mes) return null
  const siguiente = new Date(Date.UTC(Number(anio), Number(mes), 1))
  return siguiente.toISOString().slice(0, 10)
}

interface PartesContrato {
  clienteNombre: string | null
  clienteNit: string | null
  tipoId: "NIT" | "RUC" | "RTN" | null
  /** Segmento del texto que describe solo al cliente, para inferir su país sin leer el domicilio de Periferia. */
  segmentoCliente: string
}

const PERIFERIA_NIT = "9001234567"

function limpiarNit(crudo: string): string {
  const conDigitoVerificacion = crudo.match(/^([\d.]+)-(\d)$/)
  if (conDigitoVerificacion) return conDigitoVerificacion[1]!.replace(/\./g, "")
  return crudo.replace(/[.\-\s]/g, "")
}

function extraerPartes(texto: string): PartesContrato {
  // Se acota la búsqueda a partir de la primera vez que aparece "Entre": antes de
  // ese punto solo hay título/encabezado del documento, nunca el nombre de una parte.
  const indiceEntre = texto.search(/\bentre\b/i)
  const textoPartes = indiceEntre >= 0 ? texto.slice(indiceEntre) : texto
  // Periferia es siempre la segunda parte del contrato; su propio domicilio (casi
  // siempre "Medellín, Colombia") no debe contaminar la inferencia del país del cliente.
  const indicePeriferia = textoPartes.search(/periferia/i)
  const segmentoCliente = indicePeriferia >= 0 ? textoPartes.slice(0, indicePeriferia) : textoPartes

  const patron = /([A-ZÁÉÍÓÚÑÜ][^,]*),\s*(?:identificad[oa]\s+con\s+)?(NIT|RUC|RTN)\s*([\d.\-]+)/gi
  for (const m of textoPartes.matchAll(patron)) {
    const nombre = m[1]!.trim().replace(/^entre\s+(los\s+suscritos,?\s*)?/i, "").trim()
    const tipoId = m[2]!.toUpperCase() as "NIT" | "RUC" | "RTN"
    const nit = limpiarNit(m[3]!.trim())
    if (nombre.toUpperCase().includes("PERIFERIA") || nit === PERIFERIA_NIT) continue
    return { clienteNombre: nombre, clienteNit: nit, tipoId, segmentoCliente }
  }
  return { clienteNombre: null, clienteNit: null, tipoId: null, segmentoCliente }
}

function inferirPais(texto: string, tipoId: "NIT" | "RUC" | "RTN" | null, nit: string | null): Pais | null {
  const textoNorm = texto.toLowerCase()
  if (/colombia/.test(textoNorm)) return "CO"
  if (/ecuador/.test(textoNorm)) return "EC"
  if (/per[úu]\b/.test(textoNorm)) return "PE"
  if (/panam[áa]/.test(textoNorm)) return "PA"
  if (/honduras/.test(textoNorm)) return "HN"
  for (const [ciudad, pais] of Object.entries(CIUDAD_A_PAIS)) {
    if (textoNorm.includes(ciudad)) return pais
  }
  if (tipoId === "NIT") return "CO"
  if (tipoId === "RTN") return "HN"
  if (tipoId === "RUC" && nit) {
    if (nit.length >= 13) return "EC"
    if (nit.length === 11) return "PE"
    if (nit.length === 9) return "PA"
  }
  return null
}

function extraerIdContrato(texto: string): string | null {
  const m = texto.match(/CONTRATO[^\n]*?No\.?\s*([A-Z]{2,4}-\d{4}-\d{1,3})/i)
  return m ? m[1]!.toUpperCase() : null
}

interface ValorExtraido {
  valor: number | null
  moneda: Moneda | null
  indeterminado: boolean
}

function parseMonto(crudo: string): number {
  const s = crudo.trim()
  const ultimaComa = s.lastIndexOf(",")
  const ultimoPunto = s.lastIndexOf(".")
  let separadorDecimal: "," | "." | null = null
  if (ultimaComa > -1 && ultimoPunto > -1) separadorDecimal = ultimaComa > ultimoPunto ? "," : "."
  else if (ultimaComa > -1 && s.length - ultimaComa - 1 <= 2) separadorDecimal = ","
  else if (ultimoPunto > -1 && s.length - ultimoPunto - 1 <= 2) separadorDecimal = "."

  let limpio = s
  if (separadorDecimal === ",") limpio = s.replace(/\./g, "").replace(",", ".")
  else if (separadorDecimal === ".") limpio = s.replace(/,/g, "")
  else limpio = s.replace(/[.,]/g, "")
  return Math.round(parseFloat(limpio))
}

function extraerValor(clausulaValor: string | null): ValorExtraido {
  if (!clausulaValor) return { valor: null, moneda: null, indeterminado: false }
  if (/no tiene\s+(?:un\s+)?valor determinado|valor indeterminado|por demanda/i.test(clausulaValor)) {
    return { valor: 0, moneda: null, indeterminado: true }
  }
  const m = clausulaValor.match(/\(\s*(COP|USD|PEN|PAB|HNL)\s*\$?\s*([\d.,]+)\s*\)/i)
  if (!m) return { valor: null, moneda: null, indeterminado: false }
  return { valor: parseMonto(m[2]!), moneda: m[1]!.toUpperCase() as Moneda, indeterminado: false }
}

interface PlazoExtraido {
  fechaInicio: string | null
  fechaInicioAproximada: boolean
  fechaFin: string | null
  fechaFinDerivada: boolean
  meses: number | null
}

function extraerPlazo(clausulaPlazo: string | null, textoCompleto: string): PlazoExtraido {
  if (!clausulaPlazo) return { fechaInicio: null, fechaInicioAproximada: false, fechaFin: null, fechaFinDerivada: false, meses: null }

  const patronFecha = /\((\d{1,2})\)\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/gi
  let fechaInicio: string | null = null
  let fechaFin: string | null = null
  for (const m of clausulaPlazo.matchAll(patronFecha)) {
    const iso = fechaIso(m[1]!, m[2]!, m[3]!)
    if (!iso) continue
    // Se busca en todo el texto anterior a la fecha, no en una ventana fija de caracteres:
    // frases como "hasta el primero (1) de..." alejan la palabra clave del paréntesis.
    const antes = clausulaPlazo.slice(0, m.index!).toLowerCase()
    const posHasta = antes.lastIndexOf("hasta")
    const posDesde = antes.lastIndexOf("desde")
    if (posHasta === -1 && posDesde === -1) {
      if (!fechaInicio) fechaInicio = iso
      else fechaFin = iso
    } else if (posHasta > posDesde) {
      fechaFin = iso
    } else {
      fechaInicio = iso
    }
  }

  const mesesMatch = clausulaPlazo.match(/\((\d{1,2})\)\s*meses/i)
  const meses = mesesMatch ? Number(mesesMatch[1]) : null

  let fechaInicioAproximada = false
  if (!fechaInicio) {
    // Sin día exacto de firma en el texto: se asume el primer día del mes
    // siguiente al de la firma (convención conservadora, documentada en SOLUCION.md).
    const mFirma = textoCompleto.match(/en el mes de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i)
    if (mFirma) {
      fechaInicio = primerDiaSiguienteMes(mFirma[1]!, mFirma[2]!)
      fechaInicioAproximada = true
    }
  }

  let fechaFinDerivada = false
  if (!fechaFin && fechaInicio && meses) {
    fechaFin = sumarMeses(fechaInicio, meses)
    fechaFinDerivada = true
  }

  return { fechaInicio, fechaInicioAproximada, fechaFin, fechaFinDerivada, meses }
}

function extraerPoliza(texto: string): { requiere: boolean; tipos: string[] } {
  const tipos = new Set<string>()
  const patron = /p[óo]liza(?:s)?\s+de\s+([a-záéíóúñ][a-záéíóúñ\s]*?)(?=\s+por\b|,|\.)/gi
  for (const m of texto.matchAll(patron)) {
    tipos.add(m[1]!.trim().toLowerCase().replace(/\s+/g, "_"))
  }
  return { requiere: tipos.size > 0, tipos: [...tipos] }
}

function resolverComercial(deEmail: string, comerciales: Comercial[]): Comercial | null {
  return comerciales.find((c) => c.email.toLowerCase() === deEmail.toLowerCase()) ?? null
}

// Deliberadamente no incluye "los"/"las"/"la": son demasiado comunes como parte propia
// del nombre de un cliente (p. ej. "Minera Los Andes") para asumir que son artículos.
const CONECTORES_MINUSCULA = new Set(["de", "del", "y"])

/** Si el nombre viene todo en mayúsculas (estilo legal), lo pasa a formato título, preservando siglas con puntos (S.A.S., S.A.). */
function normalizarNombre(nombre: string): string {
  if (nombre !== nombre.toUpperCase()) return nombre
  return nombre
    .split(" ")
    .map((palabra, i) => {
      if (palabra.includes(".")) return palabra
      const minuscula = palabra.toLowerCase()
      if (i > 0 && CONECTORES_MINUSCULA.has(minuscula)) return minuscula
      return palabra.charAt(0) + palabra.slice(1).toLowerCase()
    })
    .join(" ")
}

function truncarEnPalabra(texto: string, limite: number): string {
  if (texto.length <= limite) return texto
  const corte = texto.slice(0, limite)
  const ultimoEspacio = corte.lastIndexOf(" ")
  return (ultimoEspacio > 0 ? corte.slice(0, ultimoEspacio) : corte).trim() + "…"
}

export function extraerContrato(texto: string, deEmail: string, comerciales: Comercial[]): ContratoExtraido {
  const esOtrosi = /^otros[ií]/i.test(texto.trim())
  const idContrato = extraerIdContrato(texto)
  const partes = extraerPartes(texto)
  const pais = inferirPais(partes.segmentoCliente, partes.tipoId, partes.clienteNit)
  const objeto = extraerClausula(texto, "OBJETO")
  const clausulaValor = extraerClausula(texto, "VALOR")
  const clausulaPlazo = extraerClausula(texto, "PLAZO")
  const { valor, moneda, indeterminado } = extraerValor(clausulaValor)
  const plazo = extraerPlazo(clausulaPlazo, texto)
  const poliza = extraerPoliza(texto)
  const comercial = resolverComercial(deEmail, comerciales)

  const objetoRecortado = objeto ? truncarEnPalabra(objeto, 200) : null
  const clienteNormalizado = partes.clienteNombre ? normalizarNombre(partes.clienteNombre) : null

  // Sin cláusula OBJETO identificable (p. ej. un otrosí que no la repite), no se puede
  // afirmar con confianza si el documento exige o no póliza: se deja null para que
  // contratos_validar conserve el valor existente del maestro en vez de sobrescribirlo.
  const tienePolizaInfo = objetoRecortado !== null || poliza.requiere
  const requierePolizaValor = tienePolizaInfo ? poliza.requiere : null
  const tipoPolizaValor = tienePolizaInfo ? (poliza.tipos.length ? poliza.tipos.join(";") : "") : null

  return {
    id_contrato: campo(idContrato, 0.95),
    cliente: campo(clienteNormalizado, clienteNormalizado ? 0.9 : 0),
    nit_cliente: campo(partes.clienteNit, partes.clienteNit ? 0.9 : 0),
    pais: campo(pais, pais ? 0.85 : 0),
    objeto: campo(objetoRecortado, objetoRecortado ? 0.9 : 0),
    valor: campo(valor, indeterminado ? 0.5 : valor !== null ? 0.9 : 0),
    valor_indeterminado: indeterminado,
    moneda: campo(moneda ?? (indeterminado && pais === "CO" ? "COP" : null), moneda ? 0.9 : indeterminado && pais === "CO" ? 0.8 : 0),
    fecha_inicio: campo(plazo.fechaInicio, plazo.fechaInicio ? (plazo.fechaInicioAproximada ? 0.85 : 0.95) : 0),
    fecha_fin: campo(plazo.fechaFin, plazo.fechaFin ? (plazo.fechaFinDerivada ? 0.6 : 0.95) : 0),
    requiere_poliza: campo(requierePolizaValor, requierePolizaValor !== null ? 0.9 : 0),
    tipo_poliza: campo(tipoPolizaValor, tipoPolizaValor !== null ? 0.9 : 0),
    comercial: campo(comercial?.nombre ?? null, comercial ? 1 : 0),
    comercial_desconocido: comercial === null,
    es_otrosi: esOtrosi,
  }
}
