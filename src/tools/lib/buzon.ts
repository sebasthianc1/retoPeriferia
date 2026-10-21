import { FIXTURES_ROOT, listDirs, readJsonFile, resolveFromRoot } from "./fs-helpers.js"
import { mensajesProcesados } from "./registro.js"
import type { Correo, MensajeBuzon } from "./tipos.js"

function pareceContrato(adjunto: string): boolean {
  return /contrato|otrosi/i.test(adjunto)
}

export async function cargarCorreo(directory: string, mensajeId: string): Promise<Correo> {
  const ruta = resolveFromRoot(directory, FIXTURES_ROOT, "buzon", mensajeId, "correo.json")
  return readJsonFile<Correo>(ruta)
}

export async function listarBuzon(directory: string): Promise<MensajeBuzon[]> {
  const carpetaBuzon = resolveFromRoot(directory, FIXTURES_ROOT, "buzon")
  const ids = await listDirs(carpetaBuzon)
  const procesados = await mensajesProcesados(directory)

  const mensajes: MensajeBuzon[] = []
  for (const id of ids) {
    if (procesados.has(id)) continue
    const correo = await cargarCorreo(directory, id)
    const tieneContrato = correo.adjuntos.some(pareceContrato)
    mensajes.push({
      id: correo.id,
      de: correo.de,
      asunto: correo.asunto,
      fecha: correo.fecha,
      adjuntos: correo.adjuntos,
      tiene_contrato: tieneContrato,
      ...(tieneContrato ? {} : { motivo_rechazo: "El mensaje no trae un adjunto de contrato u otrosí reconocible." }),
    })
  }
  return mensajes
}
