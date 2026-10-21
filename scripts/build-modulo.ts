/**
 * Genera modulo/agent.md y modulo/skill/registro-proveedor/SKILL.md a partir de
 * agent/prompt.md y src/knowledge/registro-proveedor.md — nunca se editan a mano,
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
const conocimiento = readFileSync(path.join(ROOT, "src", "knowledge", "registro-proveedor.md"), "utf8").trimEnd()

const agentMd = `---
description: Agente administrativo que automatiza el registro de Periferia IT Group como proveedor ante clientes (lee solicitudes, cruza campos contra el maestro, genera el formulario y arma el paquete de firma).
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}
`

const skillMd = `---
name: registro-proveedor
description: Conocimiento del proceso de registro como proveedor de Periferia IT Group — equivalencias de identificador tributario por país, estados de mapeo de campos (lleno/faltante/requiere_confirmacion) y reglas de vigencia de soportes.
---

${conocimiento}
`

mkdirSync(path.join(ROOT, "modulo", "skill", "registro-proveedor"), { recursive: true })
writeFileSync(path.join(ROOT, "modulo", "agent.md"), agentMd, "utf8")
writeFileSync(path.join(ROOT, "modulo", "skill", "registro-proveedor", "SKILL.md"), skillMd, "utf8")

console.log("✅ modulo/agent.md y modulo/skill/registro-proveedor/SKILL.md generados desde agent/prompt.md y src/knowledge/registro-proveedor.md")
