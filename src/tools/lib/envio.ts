import { existsSync } from "node:fs"
import { OUT_ROOT, resolveFromRoot, writeTextFile } from "./fs-helpers.js"
import { armarPaqueteInterno, rutaPaqueteExiste } from "./paquete.js"
import { cargarSolicitud } from "./mapeo.js"

export async function simularEnvioInterno(directory: string, caso: string): Promise<{ ruta: string }> {
  const solicitud = await cargarSolicitud(directory, caso)
  if (!existsSync(rutaPaqueteExiste(directory, caso))) {
    await armarPaqueteInterno(directory, caso)
  }

  const contenido = [
    `# Envío simulado — ${caso}`,
    "",
    `Destinatario: ${solicitud.de}`,
    `Fecha de simulación: ${new Date().toISOString()}`,
    "",
    "Este archivo representa el envío simulado del paquete de registro como proveedor.",
    "Ninguna acción externa real fue ejecutada: no se envió correo, no se firmó ni se cargó nada a un portal.",
    "",
    `Paquete: ${OUT_ROOT}/${caso}/paquete/`,
  ].join("\n") + "\n"

  const ruta = resolveFromRoot(directory, OUT_ROOT, caso, "ENVIO-SIMULADO.md")
  await writeTextFile(ruta, contenido)
  return { ruta: `${OUT_ROOT}/${caso}/ENVIO-SIMULADO.md` }
}
