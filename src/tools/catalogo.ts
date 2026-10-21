import type { z } from "zod"
import * as contratos from "./contratos.js"
import type { Ctx } from "./contratos.js"

export interface HerramientaEjecutable {
  nombre: string
  descripcion: string
  args: z.ZodRawShape
  ejecutar: (argumentos: unknown, ctx: Ctx) => Promise<string>
}

type Exportable = { description: string; args: z.ZodRawShape; execute: (argumentos: never, ctx: Ctx) => Promise<string> }

/** Construye el registro de herramientas: cada export de contratos.ts se expone como `contratos_<export>`. */
export function construirHerramientas(): HerramientaEjecutable[] {
  const herramientas: HerramientaEjecutable[] = []
  for (const [nombreExport, valor] of Object.entries(contratos)) {
    const tool = valor as Exportable
    if (typeof tool !== "object" || tool === null || typeof tool.execute !== "function") continue
    herramientas.push({
      nombre: `contratos_${nombreExport}`,
      descripcion: tool.description,
      args: tool.args,
      ejecutar: (argumentos, ctx) => tool.execute(argumentos as never, ctx),
    })
  }
  return herramientas
}
