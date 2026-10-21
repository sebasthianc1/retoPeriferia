# Conocimiento del proceso — Registro como Proveedor

## Qué es el proceso

Un cliente de Periferia IT Group pide, por correo, que Periferia se registre como su proveedor. Adjunta una plantilla (Excel, PDF, o indica un portal web) con los campos que necesita y una lista de soportes legales/financieros. La analista administrativa debe diligenciar la plantilla con datos reales de Periferia (desde el repositorio maestro) y armar un paquete para que el representante legal lo firme.

## Identificador tributario por país

El campo de identificación fiscal cambia de nombre según el país del cliente que pide el registro:

| País | Código | Nombre del identificador |
|---|---|---|
| Colombia | CO | NIT |
| Ecuador | EC | RUC |
| Perú | PE | RUC |
| Panamá | PA | RUC |
| Honduras | HN | RTN |

Periferia es una empresa colombiana y solo tiene **NIT** en el repositorio maestro. Cuando un cliente de otro país pide su identificador local (RUC, RTN), se usa el NIT como valor tentativo, pero **siempre** se marca como `requiere_confirmacion` con la nota de que es un identificador extranjero — nunca se presenta como un dato cerrado.

Algunas plantillas piden el campo con un nombre genérico ("Identificación tributaria", "Número de identificación fiscal") sin indicar el equivalente del país. Esos campos son ambiguos: se reporta la ambigüedad y se propone el equivalente según la tabla anterior.

## Estados de un campo mapeado

Cada campo de la plantilla termina en uno de tres estados, nunca se inventa un cuarto:

- **lleno**: existe en el repositorio maestro y el mapeo es directo (sinónimo exacto del glosario).
- **faltante**: no existe ningún dato en el maestro para ese campo. Se deja en blanco en el formulario y aparece en el checklist. No bloquea la firma por sí solo.
- **requiere_confirmacion**: el valor existe pero necesita que un humano lo valide antes de usarse (identificador extranjero, campo ambiguo de plantilla). Si el formulario se genera igual, se usa el valor propuesto pero debe quedar visible que necesita confirmación.

## Soportes y vigencia

Cada soporte tiene una fecha `vigencia_hasta` (o `null` si no vence, como el RUT). Un soporte con `vigencia_hasta` anterior a la fecha de hoy está **vencido**. Un soporte que el cliente exige pero que no existe en el repositorio está **ausente**.

Reglas de bloqueo del paquete (`listo_para_firma`):
- Un soporte **vencido** bloquea.
- Un soporte **ausente** bloquea.
- Un campo **faltante** del formulario **no** bloquea — solo queda anotado en el checklist para que la analista decida.

## Datos sensibles

Los datos bancarios (banco, tipo de cuenta, número de cuenta, titular, SWIFT) solo se incluyen en el formulario cuando la plantilla los pide explícitamente como campo. Nunca se repiten en el borrador de correo ni en el resumen de chat, para evitar exponer datos sensibles fuera del documento formal.

## Formatos de salida

- **xlsx**: la plantilla indica hoja y celda exactas para cada etiqueta y su valor. Se escribe tal cual, sin reformatear.
- **pdf**: la plantilla es una lista ordenada de etiquetas (algunas obligatorias). Se genera un documento con etiqueta y valor en ese orden.
- **portal**: Periferia no automatiza el llenado de portales web con usuario y contraseña en este proceso (requiere credenciales e interacción humana: ver diseño en SOLUCION.md). Se preparan los valores en un archivo para que la analista los copie manualmente.
