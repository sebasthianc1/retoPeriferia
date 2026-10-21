const chat = document.getElementById("chat")
const form = document.getElementById("form-chat")
const input = document.getElementById("input-mensaje")
const estadoSalud = document.getElementById("estado-salud")
const confirmacionBanner = document.getElementById("confirmacion-banner")

let sessionId = localStorage.getItem("sessionId") || null

function agregarMensaje(texto, clase) {
  const el = document.createElement("div")
  el.className = `mensaje ${clase}`
  el.textContent = texto
  chat.appendChild(el)
  chat.scrollTop = chat.scrollHeight
  return el
}

function agregarLlamadaHerramienta(llamada) {
  const el = document.createElement("div")
  const fallo = llamada.resultado.includes('"ok":false')
  el.className = `tool-call${fallo ? " fallo" : ""}`
  el.innerHTML = `<strong>${llamada.nombre}</strong>(${JSON.stringify(llamada.argumentos)}) → ${llamada.resultado}`
  chat.appendChild(el)
  chat.scrollTop = chat.scrollHeight
}

async function revisarSalud() {
  try {
    const res = await fetch("/api/health")
    const data = await res.json()
    estadoSalud.textContent = data.ok ? `${data.provider} · ${data.model}` : "no disponible"
    estadoSalud.className = `badge ${data.ok ? "ok" : "error"}`
  } catch {
    estadoSalud.textContent = "sin conexión"
    estadoSalud.className = "badge error"
  }
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault()
  const mensaje = input.value.trim()
  if (!mensaje) return

  agregarMensaje(mensaje, "usuario")
  input.value = ""
  input.disabled = true
  confirmacionBanner.classList.add("oculto")

  const pensando = agregarMensaje("Pensando…", "pensando")

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: mensaje }),
    })
    const data = await res.json()
    pensando.remove()

    if (!res.ok) {
      agregarMensaje(`Error: ${data.error ?? "desconocido"}`, "agente")
      return
    }

    sessionId = data.sessionId
    localStorage.setItem("sessionId", sessionId)

    for (const llamada of data.toolCalls ?? []) agregarLlamadaHerramienta(llamada)
    agregarMensaje(data.reply, "agente")

    confirmacionBanner.classList.toggle("oculto", !data.needsConfirmation)
  } catch (err) {
    pensando.remove()
    agregarMensaje(`Error de red: ${err.message}`, "agente")
  } finally {
    input.disabled = false
    input.focus()
  }
})

revisarSalud()
agregarMensaje(
  'Hola, soy el agente de órdenes de compra. Pídeme por ejemplo: "Procesa la solicitud sol-004".',
  "agente"
)
