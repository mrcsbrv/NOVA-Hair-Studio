# NOVA Hair Studio · reservas compartidas

Aplicación de una peluquería ficticia con HTML5, CSS y JavaScript vanilla, sin npm, frameworks ni compilación. Conserva el diseño y el flujo de reserva. Con la configuración completa utiliza Supabase; con ambos valores sin configurar conserva la demostración local.

## Configurar Supabase

Edita **`supabase-config.js`**. Solo contiene estas dos líneas:

```js
const NOVA_SUPABASE_URL = "PEGA_AQUI_PROJECT_URL";
const NOVA_SUPABASE_PUBLISHABLE_KEY = "PEGA_AQUI_PUBLISHABLE_KEY";
```

Sustituye los textos entre comillas por el **Project URL** HTTPS de tu proyecto y su **Publishable key**, cuyo prefijo es `sb_publishable_`. Guarda y recarga la página. No necesitas ninguna credencial privada.

| Configuración | Comportamiento |
| --- | --- |
| Ambos placeholders intactos o ambos valores vacíos | Demo local con localStorage y herramientas de agenda. |
| Solo un valor configurado, configuración inválida o archivo de configuración ausente | Modo remoto bloqueado con mensaje de configuración; no se usa la agenda local. |
| Ambos valores válidos | Agenda compartida de Supabase. Se espera la disponibilidad del servidor antes de permitir reservar. |
| Supabase o su CDN no responde con configuración activa | Error visible y posibilidad de actualizar disponibilidad; nunca se guarda una reserva local como alternativa. |

El cliente se crea una sola vez, con persistencia de sesión, detección de sesión en URL, refresco de tokens y reintentos automáticos de consultas desactivados. Se carga supabase-js v2 desde el [CDN compatible indicado por Supabase](https://supabase.com/docs/reference/javascript/installing). No se instala nada en el proyecto.

## Correspondencia de servicios y profesionales

El catálogo sigue en `data.js`. Por defecto, sus identificadores se envían tal cual: `corte-caballero`, `tinte-raiz`, `laura`, `maria`, `carlos`, etc. Deben coincidir con los identificadores de `nova_services` y `nova_professionals` de tu base de datos.

Si las tablas usan UUID u otros identificadores, añade un campo **`supabaseId`** al objeto correspondiente de `data.js`. Conserva su `id` actual, porque lo utiliza la interfaz y la relación entre servicios y profesionales. Por ejemplo, al objeto de Carlos:

```js
{
  id: 'carlos',
  supabaseId: 'ID_REAL_DE_CARLOS_EN_NOVA_PROFESSIONALS',
  name: 'Carlos',
  // Conserva aquí sus campos description y specialties actuales.
}
```

La misma opción existe en cada servicio. Se admiten identificadores de texto o enteros seguros; las correspondencias deben ser únicas. Un profesional recibido sin correspondencia bloquea la disponibilidad y muestra un error, en lugar de considerar su agenda vacía. No se modifican ni se completan automáticamente las tablas.

Mantén los precios, duraciones y compatibilidades de `data.js` alineados con la base de datos. El servidor es quien valida y calcula la duración definitiva; tras guardar, se utiliza el intervalo público devuelto por la siguiente consulta para actualizar la duración del resumen cuando está disponible.

## Cómo comprobar la integración real

1. Completa las dos constantes y comprueba los identificadores anteriores. Abre `index.html` con conexión a Internet o utiliza la web publicada en GitHub Pages.
2. En reservas debe aparecer **«Agenda compartida con Supabase»**. Las herramientas demo estarán ocultas. Espera a que termine **«Cargando disponibilidad…»**.
3. Abre la misma web y configuración en un segundo navegador o dispositivo. Elige el mismo servicio y profesional. Usa un día futuro laborable y datos de cliente ficticios.
4. En el primer navegador selecciona una hora, completa los datos y pulsa «Revisar mi reserva». Todavía no se inserta nada. Pulsa **«Confirmar reserva»** para guardarla.
5. Tras el éxito, ese intervalo debe desaparecer de las horas disponibles. En el segundo navegador cambia de fecha o recarga; también se actualiza cada 30 segundos mientras la pestaña está visible. El horario debe estar ocupado allí.
6. Para probar un conflicto, deja el resumen de la misma hora preparado en ambos navegadores antes de confirmar. Solo debe guardarse una cita. El segundo intento debe mostrar que el hueco dejó de estar disponible y ofrecer otros horarios.
7. Para probar errores, desconecta la red antes de actualizar disponibilidad. Las horas y la confirmación deben quedar bloqueadas, con opción de reintentar. No se crea ningún registro local. Si se pierde la respuesta después de enviar una reserva, la página explica que el resultado es incierto y bloquea repetirla; comprueba el registro desde tu proyecto antes de intentar otra reserva.

En las herramientas de red del navegador puedes comprobar que las consultas a `nova_bookings` piden exclusivamente `professional_id,start_at,end_at,status`, filtran `status=confirmed` y limitan el rango. Los POST deben contener únicamente las seis columnas de creación descritas abajo. No copies ni compartas datos de contacto reales durante las pruebas.

No se ejecuta SQL ni se modifica la base de datos, RLS, sus políticas o sus validaciones desde este proyecto. Las pruebas reales requieren la configuración manual y el esquema existente; las pruebas automáticas incluidas usan respuestas controladas.

## Qué consulta y guarda la web pública

**Lectura:** solo intervalos confirmados que se solapan con el mes visible, usando un fin de rango exclusivo. Antes de insertar se consulta además el día concreto. Se seleccionan exclusivamente:

```text
professional_id, start_at, end_at, status
```

Las respuestas se transforman a `{ professionalId, date, start, end }`, el formato mínimo que necesita el motor. No se solicitan identificadores de reserva, nombres, teléfonos ni emails de otros clientes. Las lecturas están paginadas; si se detectan resultados incompletos, inconsistentes o una correspondencia inválida, la interfaz no ofrece disponibilidad.

**Creación:** al confirmar se envían exclusivamente:

```text
service_id, professional_id, start_at,
customer_name, customer_phone, customer_email
```

No se envían `end_at`, `status`, `source`, `created_at` ni `id`. El INSERT no encadena `.select()`, de forma que no intenta leer el registro privado recién creado. El SDK [no devuelve filas insertadas salvo que se soliciten](https://supabase.com/docs/reference/javascript/insert).

Justo antes de insertar se releen los intervalos del día y se comprueba toda la duración. La protección atómica contra solapamientos corresponde a la base de datos existente. Después se actualizan la agenda y la confirmación. Si una escritura fue aceptada pero todavía no aparece en la consulta pública, una comprobación en memoria impide presentar ese día como libre hasta poder verificarlo. Solo conserva metadatos del intervalo, sin datos de cliente.

Los datos de la propia confirmación permanecen en memoria de la página. En modo Supabase no se leen, escriben ni mezclan las reservas de localStorage. Tampoco se migran automáticamente las citas de pruebas anteriores. Estas seguirán disponibles únicamente al volver expresamente al modo local.

## Refresco, errores y zona horaria

- Carga inicial y cambios de mes, fecha, servicio o profesional consultan disponibilidad remota actualizada. Durante la consulta no se puede confirmar.
- Las respuestas antiguas se descartan si una petición posterior ya corresponde a otra selección.
- Se refresca cada 30 segundos, al volver a la pestaña y después de confirmar. No se utilizan suscripciones Realtime de filas completas, evitando recibir datos personales por ese canal.
- Los conflictos vuelven al selector de horas. Un fallo de lectura posterior a un guardado no anula una confirmación válida. Las escrituras de resultado incierto no se reenvían automáticamente.
- Los errores del servidor se convierten a mensajes seguros; no se imprimen sus detalles, claves o datos privados en consola.
- Tanto el modo local como el remoto utilizan **Europe/Madrid** para «hoy», horas pasadas y citas. `salon-time.js` convierte las fechas civiles y minutos del salón a instantes ISO UTC, contemplando horario de verano/invierno. Los rangos diarios pueden tener 23 o 25 horas. Las horas inexistentes o ambiguas se rechazan; el horario comercial actual no pasa por ellas.

## Demo local y funciones pendientes

Con ambos valores sin configurar, las citas de ejemplo se generan para los tres próximos días laborables de Madrid. Se utiliza la clave `nova-hair-studio.bookings.v1`. Las reservas sobreviven a la recarga dentro del mismo navegador/origen. Desde «Herramientas de demostración» puedes añadir citas telefónicas, cancelar y restaurar los ejemplos.

Con Supabase activo esas herramientas están ocultas y sus operaciones rechazan cualquier intento desde el repositorio público. La cancelación y la gestión telefónica remotas se incorporarán al futuro panel privado con autenticación.

El salón, las fotografías, reseñas, dirección y contactos siguen siendo ficticios. No hay correo real, pagos, mapa real ni cuentas de clientes. `sendConfirmationEmail(booking)` continúa desacoplada del guardado y no envía nada. La confirmación no se recupera tras recargar porque la web pública no consulta reservas personales; la ocupación del intervalo sí se conserva en Supabase.

## Archivos y arquitectura

- `index.html`: estructura, formularios, estados y orden de carga de scripts.
- `styles.css`: diseño original conservado en esta fase.
- `data.js`: catálogo, profesionales, precios, duraciones, reseñas y correspondencias opcionales.
- `salon-time.js`: conversión entre el horario de Madrid e instantes UTC.
- `booking-core.js`: disponibilidad, validación y adaptador explícitamente local.
- `supabase-config.js`: las dos constantes públicas editables.
- `supabase-repository.js`: selección de modo, cliente único y adaptador remoto.
- `script.js`: interfaz compartida por ambos repositorios, estados de red y refrescos.
- `tests/`: pruebas sin dependencias ni acceso a la base de datos real.

La interfaz utiliza `NovaStorage.createRepository()`:

```js
const repository = NovaStorage.createRepository();
repository.mode; // 'local' o 'supabase'
await repository.listBookings({ startDate, endDate }); // fechas YYYY-MM-DD; fin exclusivo
await repository.createBooking({
  serviceId, professionalId, date, start,
  customer: { name, phone, email }, source: 'online'
});
const unsubscribe = repository.subscribe(refreshView);
// cancelBooking(id) y resetDemo() solo funcionan en modo local.
```

`start`, `end` y las duraciones internas están en minutos. `source` pertenece al contrato de la interfaz local y no se envía a Supabase. El repositorio remoto devuelve únicamente el resumen de la solicitud de este cliente, sin inventar un ID de servidor.

## Publicación y pruebas sin instalación

Los scripts son clásicos, con rutas relativas, y no requieren build. El HTML carga el SDK desde CDN y conserva la apertura directa mediante `file://`; para compartirlo basta publicar los archivos estáticos en GitHub Pages. El modo Supabase requiere conexión al CDN y al proyecto configurado. Este trabajo no publica ni hace commit/push.

Desde la raíz del proyecto, en macOS:

```sh
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/availability.test.js
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/timezone.test.js
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/supabase.test.js
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/ui.test.js
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/remote-ui.test.js
python3 tests/check_structure.py
```

Las pruebas cubren duración real, solapamientos, guardado y cancelación locales, permisos de columnas del adaptador, aislamiento de almacenamiento, estados asíncronos, conflictos, errores, paginación y cambios horarios. Las pruebas de interfaz utilizan un DOM mínimo y repositorios controlados: no sustituyen una comprobación en navegador ni validan las políticas del proyecto Supabase real.
