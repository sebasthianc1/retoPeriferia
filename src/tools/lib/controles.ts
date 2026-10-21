import { limpiarNit, normalizarNombre } from "./montos.js"
import type { Aprobador, Bloqueo, CentroCosto, Confirmacion, Maestros, Paquete, Proveedor, ResultadoValidacion } from "./tipos.js"

function buscarProveedor(paquete: Paquete, proveedores: Proveedor[]): Proveedor | null {
  const nit = paquete.solicitud.proveedor_nit ? limpiarNit(paquete.solicitud.proveedor_nit) : null
  if (nit) return proveedores.find((p) => p.nit === nit) ?? null
  const nombreNorm = normalizarNombre(paquete.solicitud.proveedor_nombre)
  return proveedores.find((p) => normalizarNombre(p.nombre) === nombreNorm) ?? null
}

function soloFecha(fechaIso: string): string {
  return fechaIso.slice(0, 10)
}

/** Aplica RC1–RC10 (sección 7.3 del PRD) y devuelve el veredicto completo de un paquete. */
export function validarPaquete(paquete: Paquete, maestros: Maestros): ResultadoValidacion {
  const bloqueos: Bloqueo[] = []
  const confirmaciones: Confirmacion[] = []
  const derivados: ResultadoValidacion["derivados"] = {}
  const { solicitud, cotizacion, aprobacion, factura } = paquete

  // RC1 — el proveedor debe existir (por NIT, o por nombre si no hay NIT) y estar activo.
  const proveedor = buscarProveedor(paquete, maestros.proveedores)
  if (!proveedor) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `No se encontró el proveedor "${solicitud.proveedor_nombre}"${solicitud.proveedor_nit ? ` (NIT ${solicitud.proveedor_nit})` : ""} en el maestro de proveedores.`,
      sugerencia: "Verificar el NIT con el solicitante, o si es un proveedor nuevo, solicitar su alta en el maestro antes de continuar.",
    })
  } else if (!proveedor.activo) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `El proveedor "${proveedor.nombre}" existe pero está marcado como inactivo.`,
      sugerencia: "Confirmar con el área de proveedores si debe reactivarse antes de comprarle.",
    })
  }

  // RC4 — la subárea debe pertenecer al centro de costos.
  const centro = maestros.centrosCosto.find((c) => c.centro_costo === solicitud.centro_costo) ?? null
  if (!centro) {
    bloqueos.push({
      codigo: "RC4",
      detalle: `El centro de costos "${solicitud.centro_costo}" no existe en el maestro.`,
      sugerencia: "Confirmar el código de centro de costos con el solicitante.",
    })
  } else if (!centro.subareas.includes(solicitud.subarea)) {
    bloqueos.push({
      codigo: "RC4",
      detalle: `La subárea "${solicitud.subarea}" no pertenece al centro de costos "${solicitud.centro_costo}".`,
      sugerencia: `Subáreas válidas para ${solicitud.centro_costo}: ${centro.subareas.join(", ")}.`,
    })
  }

  // RC2 — debe existir aprobación, contener "Aprobado", y venir de un aprobador autorizado para ese centro.
  let aprobador: Aprobador | null = null
  if (!aprobacion) {
    bloqueos.push({ codigo: "RC2", detalle: "No se encontró el correo de aprobación.", sugerencia: "Pedir al solicitante el correo de aprobación de su líder." })
  } else if (!aprobacion.aprobado) {
    bloqueos.push({ codigo: "RC2", detalle: "El correo de aprobación no contiene la palabra 'Aprobado'.", sugerencia: "Confirmar con el líder si la solicitud está realmente aprobada." })
  } else if (centro) {
    aprobador = centro.aprobadores.find((a) => a.email.toLowerCase() === aprobacion.de.toLowerCase()) ?? null
    if (!aprobador) {
      bloqueos.push({
        codigo: "RC2",
        detalle: `"${aprobacion.de}" no es un aprobador autorizado para el centro de costos "${solicitud.centro_costo}".`,
        sugerencia: `Aprobadores válidos para ${solicitud.centro_costo}: ${centro.aprobadores.map((a) => a.email).join(", ")}.`,
      })
    }
  }

  // RC3 — el monto debe estar dentro del tope del aprobador (solo evaluable si RC2 encontró un aprobador válido).
  if (aprobador && solicitud.valor_total > aprobador.tope) {
    bloqueos.push({
      codigo: "RC3",
      detalle: `El valor total (${solicitud.valor_total}) supera el tope de aprobación de ${aprobacion!.de} (${aprobador.tope}).`,
      sugerencia: "Escalar a un aprobador con tope suficiente para ese centro de costos.",
    })
  }

  // RC10 — cantidad × valor_unitario debe igualar valor_total (± 1 unidad monetaria).
  const esperado = solicitud.cantidad * solicitud.valor_unitario
  if (Math.abs(esperado - solicitud.valor_total) > 1) {
    bloqueos.push({
      codigo: "RC10",
      detalle: `cantidad × valor_unitario (${esperado}) no coincide con valor_total (${solicitud.valor_total}).`,
      sugerencia: "Pedir al solicitante que corrija la solicitud: alguno de los tres valores está mal digitado.",
    })
  }

  // RC5 — la cotización debe coincidir con la solicitud dentro de un 2%; sin cotización, siempre se confirma.
  if (!cotizacion) {
    confirmaciones.push({ codigo: "RC5", detalle: "No hay cotización adjunta; no se puede verificar el valor contra un tercero." })
  } else {
    const diferencia = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total
    if (diferencia > 0.02) {
      confirmaciones.push({
        codigo: "RC5",
        detalle: `El total de la cotización difiere más de 2% del valor de la solicitud (${(diferencia * 100).toFixed(1)}%).`,
        valores: { solicitud: String(solicitud.valor_total), cotizacion: String(cotizacion.total) },
      })
    }
  }

  // RC6 — IVA ausente: se deriva del proveedor y se confirma.
  if (!solicitud.indicador_iva) {
    if (proveedor) {
      derivados.indicador_iva = proveedor.indicador_iva_default
      confirmaciones.push({
        codigo: "RC6",
        detalle: `La solicitud no trae indicador de IVA; se propone "${proveedor.indicador_iva_default}" (valor por defecto del proveedor).`,
        valores: { indicador_iva_propuesto: proveedor.indicador_iva_default },
      })
    } else {
      confirmaciones.push({ codigo: "RC6", detalle: "La solicitud no trae indicador de IVA y no se pudo derivar porque el proveedor no existe." })
    }
  }

  // RC7 — condiciones de pago ausentes: se derivan del proveedor, solo se informa.
  if (!solicitud.condiciones_pago && proveedor) {
    derivados.condiciones_pago = proveedor.condiciones_pago_default
  }

  // RC8 — existe factura con fecha anterior a la solicitud: posible OC retroactiva.
  const retroactiva = factura !== null && factura.fecha !== "" && factura.fecha < solicitud.fecha_solicitud
  if (retroactiva) {
    confirmaciones.push({
      codigo: "RC8",
      detalle: `La factura (${factura!.numero}, ${factura!.fecha}) es anterior a la fecha de la solicitud (${solicitud.fecha_solicitud}): posible OC retroactiva.`,
    })
  }

  // RC9 — la fecha de aprobación debe ser posterior o igual a la fecha de la solicitud.
  if (aprobacion && soloFecha(aprobacion.fecha) < solicitud.fecha_solicitud) {
    confirmaciones.push({
      codigo: "RC9",
      detalle: `La aprobación (${soloFecha(aprobacion.fecha)}) es anterior a la fecha de la solicitud (${solicitud.fecha_solicitud}).`,
    })
  }

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva, proveedor }
}
