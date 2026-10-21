---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia IT Group — los diez controles (RC1-RC10), cómo se derivan IVA y condiciones de pago, idempotencia y qué es una OC retroactiva.
---

# Conocimiento del proceso — Órdenes de Compra SAP

## Qué es el proceso

Cada compra llega a administración por correo con tres piezas: la solicitud (hoy un Excel, aquí ya normalizada en JSON), la cotización del proveedor, y el correo de aprobación del líder del centro de costos. El agente lee las tres, valida contra los maestros de SAP, arma el payload de la orden de compra tal como quedaría en el sistema, y la crea solo si pasa los controles (o si la analista confirma las excepciones).

## Los diez controles (RC1–RC10)

| Código | Qué verifica | Tipo |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT, o por nombre si no hay NIT) y está activo. | Bloqueo |
| RC2 | Hay un correo de aprobación, contiene la palabra "Aprobado", y viene de alguien autorizado para aprobar en ese centro de costos específico — no basta con ser aprobador en general, debe serlo para ese centro. | Bloqueo |
| RC3 | El valor de la solicitud no supera el tope de aprobación de quien aprobó. | Bloqueo |
| RC4 | La subárea pertenece al centro de costos de la solicitud. | Bloqueo |
| RC10 | cantidad × valor_unitario coincide con valor_total (con un margen de redondeo de ±1). | Bloqueo |
| RC5 | El total de la cotización no difiere más de 2% del valor de la solicitud. Si no hay cotización, siempre se pide confirmar. | Confirmación |
| RC6 | Si falta el indicador de IVA, se propone el valor por defecto del proveedor — pero se pide confirmar, nunca se asume en silencio. | Confirmación + derivado |
| RC7 | Si faltan las condiciones de pago, se completan con el valor por defecto del proveedor — esto solo se informa, no bloquea ni pide confirmación (a diferencia del IVA, no cambia cuánto se paga, solo cuándo). | Derivado |
| RC8 | Si existe una factura con fecha anterior a la solicitud, la OC es retroactiva: la cotización se saltó y la compra ya ocurrió. Se pide confirmar y queda marcada en el log de control — es la métrica que la dirección quiere ver. | Confirmación |
| RC9 | La fecha de aprobación no puede ser anterior a la fecha de la solicitud (un líder no puede aprobar algo que todavía no se ha pedido). | Confirmación |

Un caso puede tener varios bloqueos y varias confirmaciones a la vez; se reportan todos juntos, no solo el primero que falla.

## Por qué "apta" no es lo mismo que "lista para crear sin preguntar"

`apta = true` significa que no hay bloqueos — pero si hay confirmaciones pendientes, igual hace falta que la analista las confirme antes de `oc_crear`. Solo cuando no hay bloqueos **ni** confirmaciones pendientes (o ya se confirmaron) se crea la OC sin fricción.

## Idempotencia

Crear la OC dos veces para la misma solicitud nunca duplica nada: `oc_crear` primero busca si ya existe una orden para ese `solicitud_id` y, si la encuentra, devuelve ese mismo número en vez de crear una nueva. Esto es importante porque la analista puede reintentar un caso sin saber si ya se había creado.

## OC retroactivas

Una orden de compra se vuelve "retroactiva" cuando la factura del proveedor ya existe (y tiene fecha anterior) al momento de crear la OC — es decir, la compra ya se hizo sin pasar por el control previo. No se rechaza automáticamente (el gasto ya ocurrió, bloquearlo no lo deshace), pero se marca explícitamente para que la dirección pueda medir qué tan frecuente es este desvío de proceso.
