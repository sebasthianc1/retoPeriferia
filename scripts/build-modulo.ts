/**
 * Genera modulo/agent.md y modulo/skill/ordenes-compra/SKILL.md a partir de
 * agent/prompt.md y src/knowledge/ordenes-compra.md — nunca se editan a mano,
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
const conocimiento = readFileSync(path.join(ROOT, "src", "knowledge", "ordenes-compra.md"), "utf8").trimEnd()

const agentMd = `---
description: Agente administrativo que prepara y crea órdenes de compra en SAP (simulado) a partir del paquete de correo, cotización y aprobación de una compra de Periferia IT Group.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}
`

const skillMd = `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia IT Group — los diez controles (RC1-RC10), cómo se derivan IVA y condiciones de pago, idempotencia y qué es una OC retroactiva.
---

${conocimiento}
`

mkdirSync(path.join(ROOT, "modulo", "skill", "ordenes-compra"), { recursive: true })
writeFileSync(path.join(ROOT, "modulo", "agent.md"), agentMd, "utf8")
writeFileSync(path.join(ROOT, "modulo", "skill", "ordenes-compra", "SKILL.md"), skillMd, "utf8")

console.log("✅ modulo/agent.md y modulo/skill/ordenes-compra/SKILL.md generados desde agent/prompt.md y src/knowledge/ordenes-compra.md")
