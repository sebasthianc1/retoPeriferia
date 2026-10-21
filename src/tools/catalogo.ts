import type { z } from "zod"
import * as oc from "./oc.js"
import type { Ctx } from "./oc.js"

export interface HerramientaEjecutable {
  nombre: string
  descripcion: string
  args: z.ZodRawShape
  ejecutar: (argumentos: unknown, ctx: Ctx) => Promise<string>
}

type Exportable = { description: string; args: z.ZodRawShape; execute: (argumentos: never, ctx: Ctx) => Promise<string> }

/** Construye el registro de herramientas: cada export de oc.ts se expone como `oc_<export>`. */
export function construirHerramientas(): HerramientaEjecutable[] {
  const herramientas: HerramientaEjecutable[] = []
  for (const [nombreExport, valor] of Object.entries(oc)) {
    const tool = valor as Exportable
    if (typeof tool !== "object" || tool === null || typeof tool.execute !== "function") continue
    herramientas.push({
      nombre: `oc_${nombreExport}`,
      descripcion: tool.description,
      args: tool.args,
      ejecutar: (argumentos, ctx) => tool.execute(argumentos as never, ctx),
    })
  }
  return herramientas
}
