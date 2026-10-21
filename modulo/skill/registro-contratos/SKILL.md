---
name: registro-contratos
description: Conocimiento del proceso de registro de contratos vigentes de Periferia IT Group — reglas de clasificación (nuevo/actualización/duplicado/rechazado), convenciones de extracción determinista y vigencia de pólizas.
---

# Conocimiento del proceso — Registro de Contratos Vigentes

## Qué es el proceso

El registro maestro de contratos vigentes de Periferia está congelado desde el 2026-05-30. Este agente es el punto único de recepción: lee el buzón, extrae los datos del contrato, decide si es nuevo, una actualización de uno existente, un duplicado o un documento que no es un contrato, y alimenta el maestro con trazabilidad completa.

## Clasificación de un mensaje

- **nuevo**: no hay ningún contrato en el maestro con el mismo `id_contrato`, ni con el mismo `nit_cliente` y un `objeto` con similitud ≥ 0.9. Se inserta una fila.
- **actualización**: mismo `id_contrato` con algún campo distinto, el documento se identifica como un otrosí (empieza con la palabra "OTROSÍ"), o mismo `nit_cliente` + objeto muy similar. Se modifica la fila existente y se deja constancia del cambio en `historial.jsonl`.
- **duplicado**: mismo `id_contrato` y los mismos `valor`, `fecha_inicio` y `fecha_fin` que ya están en el maestro. No se escribe nada.
- **rechazado**: el documento no tiene partes (CONTRATANTE/CONTRATISTA), ni `id_contrato`, ni una cláusula de objeto identificable — típicamente porque el adjunto no es un contrato (una cotización, por ejemplo).

## Campos que requieren revisión humana

Cualquier campo con confianza menor a 0.8 detiene el registro hasta que la analista confirme explícitamente. Dos excepciones:

- El campo `comercial` (resuelto contra `comerciales.json`) nunca bloquea: un remitente desconocido se reporta como aviso, pero el registro continúa.
- En una actualización (otrosí), un campo que el documento no modifica queda como `null` en la extracción — eso no cuenta como "baja confianza", simplemente se conserva el valor que ya tenía el maestro.

## Convenciones de extracción determinista

- El valor del contrato casi siempre viene acompañado de su cifra exacta entre paréntesis junto al monto en palabras, p. ej. "DOSCIENTOS SESENTA Y CINCO MILLONES DE PESOS (COP $265.000.000)". Se usa esa cifra, nunca se interpreta el texto en palabras.
- Un contrato "por demanda" o sin valor fijo (p. ej. un contrato marco) se registra con `valor = 0` y `valor_indeterminado = true`, con confianza baja (requiere revisión).
- Cuando el plazo da fecha de inicio y fin explícitas ("desde el X hasta el Y"), ambas tienen confianza alta. Cuando el fin se debe derivar sumando los meses de plazo a la fecha de inicio (porque el texto no da una fecha de término explícita), la fecha derivada tiene confianza baja (requiere revisión) — una suma de meses sobre una fecha aproximada no es un dato cerrado.
- Si el texto solo menciona el mes y año de la firma (sin día exacto), se asume como fecha de inicio el primer día del mes siguiente — una convención conservadora, documentada, nunca una fecha inventada al azar.
- El identificador tributario del cliente (`nit_cliente`) se registra sin puntos ni dígito de verificación. El dígito de verificación colombiano (el número después del guion en "890.900.111-4") se descarta.
- El país se infiere, en orden: del nombre del país si aparece explícito en el texto; si no, de la ciudad de domicilio conocida; si no, del tipo de identificador (NIT → Colombia, RTN → Honduras); si no, de la longitud del RUC (13 dígitos → Ecuador, 11 → Perú, 9 → Panamá).

## Pólizas y vigencia

- Un contrato nuevo que exige póliza queda con `estado_poliza = pendiente` (se asume que aún no se ha constituido).
- Un soporte de póliza vencido o pendiente bloquea las alertas de "pólizas al día", pero nunca bloquea el registro del contrato en sí — el registro y la gestión de la póliza son procesos distintos.
- El reporte de alertas (`contratos_alertas`) usa una fecha de referencia explícita (`hoy`) para que sea determinista entre ejecuciones; nunca usa la fecha real del sistema.
