/** Parser/escritor CSV mínimo pero consciente de comillas (RFC 4180 simplificado). */

function parseLinea(linea: string): string[] {
  const campos: string[] = []
  let actual = ""
  let entreComillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (entreComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') {
          actual += '"'
          i++
        } else {
          entreComillas = false
        }
      } else {
        actual += c
      }
    } else if (c === '"') {
      entreComillas = true
    } else if (c === ",") {
      campos.push(actual)
      actual = ""
    } else {
      actual += c
    }
  }
  campos.push(actual)
  return campos
}

export function parseCsv(contenido: string): Record<string, string>[] {
  const lineas = contenido.split(/\r\n|\n/).filter((l) => l.length > 0)
  if (lineas.length === 0) return []
  const encabezados = parseLinea(lineas[0]!)
  return lineas.slice(1).map((linea) => {
    const valores = parseLinea(linea)
    const fila: Record<string, string> = {}
    encabezados.forEach((col, i) => {
      fila[col] = valores[i] ?? ""
    })
    return fila
  })
}

function escaparCampo(valor: string): string {
  if (valor.includes(",") || valor.includes('"') || valor.includes("\n")) {
    return `"${valor.replace(/"/g, '""')}"`
  }
  return valor
}

export function stringifyCsv(filas: Record<string, string>[], columnas: string[]): string {
  const encabezado = columnas.join(",")
  const lineas = filas.map((fila) => columnas.map((col) => escaparCampo(fila[col] ?? "")).join(","))
  return [encabezado, ...lineas].join("\n") + "\n"
}
