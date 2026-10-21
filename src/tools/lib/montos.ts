/** Convierte un monto en texto ("11.400.000", "1,700,000.00") a número, detectando el separador decimal. */
export function parseMonto(crudo: string): number {
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

export function limpiarNit(crudo: string): string {
  const conDigitoVerificacion = crudo.match(/^([\d.]+)-(\d)$/)
  if (conDigitoVerificacion) return conDigitoVerificacion[1]!.replace(/\./g, "")
  return crudo.replace(/[.\-\s]/g, "")
}

export function normalizarNombre(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}
