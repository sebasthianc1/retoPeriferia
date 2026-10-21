/**
 * Genera modulo/agent.md y modulo/skill/registro-contratos/SKILL.md a partir de
 * agent/prompt.md y src/knowledge/registro-contratos.md — nunca se editan a mano,
 * para que el módulo reutilizable (bonus, sección 9.4 del PRD) nunca diverja de
 * lo que usa la aplicación principal.
 *
 *   npm run build:modulo
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const prompt = readFileSync(path.join(ROOT, "agent", "prompt.md"), "utf8").trimEnd()
const conocimiento = readFileSync(path.join(ROOT, "src", "knowledge", "registro-contratos.md"), "utf8").trimEnd()

const agentMd = `---
description: Agente administrativo que registra contratos vigentes de Periferia IT Group desde un buzón único (extrae datos, clasifica, archiva y alerta vencimientos).
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}
`

const skillMd = `---
name: registro-contratos
description: Conocimiento del proceso de registro de contratos vigentes de Periferia IT Group — reglas de clasificación (nuevo/actualización/duplicado/rechazado), convenciones de extracción determinista y vigencia de pólizas.
---

${conocimiento}
`

mkdirSync(path.join(ROOT, "modulo", "skill", "registro-contratos"), { recursive: true })
writeFileSync(path.join(ROOT, "modulo", "agent.md"), agentMd, "utf8")
writeFileSync(path.join(ROOT, "modulo", "skill", "registro-contratos", "SKILL.md"), skillMd, "utf8")

console.log("✅ modulo/agent.md y modulo/skill/registro-contratos/SKILL.md generados desde agent/prompt.md y src/knowledge/registro-contratos.md")
