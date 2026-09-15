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

El cliente de la **web pública** se crea una sola vez, con persistencia de sesión, detección de sesión en URL, refresco de tokens y reintentos automáticos de consultas desactivados. El panel privado utiliza la misma configuración con sesión administrada por Auth, como se explica abajo. Se carga supabase-js v2 desde el [CDN compatible indicado por Supabase](https://supabase.com/docs/reference/javascript/installing). No se instala nada en el proyecto.

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

En las herramientas de red del navegador puedes comprobar que las consultas a `nova_bookings` piden exclusivamente `professional_id,start_at,end_at,status`, filtran `status=confirmed` y limitan el rango. Las consultas públicas a `nova_blocks` piden solo `professional_id,start_at,end_at,active`, con `active=true` y el mismo rango. Los POST de reservas deben contener únicamente las seis columnas de creación descritas abajo. No copies ni compartas datos de contacto reales durante las pruebas.

No se ejecuta SQL ni se modifica la base de datos, RLS, sus políticas o sus validaciones desde este proyecto. Las pruebas reales requieren la configuración manual y el esquema existente; las pruebas automáticas incluidas usan respuestas controladas.

## Qué consulta y guarda la web pública

**Lectura de reservas:** solo intervalos confirmados que se solapan con el mes visible, usando un fin de rango exclusivo. Antes de insertar se consulta además el día concreto. Se seleccionan exclusivamente:

```text
professional_id, start_at, end_at, status
```

Las respuestas se transforman a `{ professionalId, date, start, end }`, el formato mínimo que necesita el motor. No se solicitan identificadores de reserva, nombres, teléfonos ni emails de otros clientes. Las lecturas están paginadas; si se detectan resultados incompletos, inconsistentes o una correspondencia inválida, la interfaz no ofrece disponibilidad.

**Lectura de bloqueos:** `nova_blocks` se consulta con `active=true`, únicamente para intervalos solapados con el mismo rango. Se seleccionan exclusivamente:

```text
professional_id, start_at, end_at, active
```

El repositorio devuelve `{ bookings, blocks }` mediante `listAvailability(range)`. Los dos conjuntos se conservan por separado; el motor recibe intervalos y trata `professionalId: null` como tiempo ocupado para todo el salón. Un ID concreto afecta únicamente a esa persona. Se respetan las duraciones completas, el calendario, los días llenos y «Cualquiera disponible». Ni el tipo, ni el motivo, ni el autor del bloqueo se consultan o muestran públicamente.

La disponibilidad no está lista hasta que terminan **ambas lecturas**. Si falla alguna, no se ofrecen horas ni se confirma usando una lista parcial. Bloqueos iguales pueden existir en la base de datos: se cuentan todas sus filas al paginar y solo se deduplica el efecto de los intervalos.

**Creación:** al confirmar se envían exclusivamente:

```text
service_id, professional_id, start_at,
customer_name, customer_phone, customer_email
```

No se envían `end_at`, `status`, `source`, `created_at` ni `id`. El INSERT no encadena `.select()`, de forma que no intenta leer el registro privado recién creado. El SDK [no devuelve filas insertadas salvo que se soliciten](https://supabase.com/docs/reference/javascript/insert).

Justo antes de insertar se releen las reservas **y los bloqueos** del día y se comprueba toda la duración. La protección atómica contra solapamientos corresponde a la base de datos existente. Si devuelve `HORARIO_BLOQUEADO`, la interfaz muestra «Este horario acaba de dejar de estar disponible.», refresca los datos y vuelve al selector de horas. Después de un guardado correcto se actualizan la agenda y la confirmación. Si una escritura fue aceptada pero todavía no aparece en la consulta pública, una comprobación en memoria impide presentar ese día como libre hasta poder verificarlo. Solo conserva metadatos del intervalo, sin datos de cliente.

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

Con Supabase activo esas herramientas están ocultas y sus operaciones rechazan cualquier intento desde el repositorio público. La cancelación y la gestión telefónica remotas están disponibles en `admin.html`, después de autenticar una cuenta administradora.

El salón, las fotografías, reseñas, dirección y contactos siguen siendo ficticios. No hay correo real, pagos, mapa real ni cuentas de clientes. `sendConfirmationEmail(booking)` continúa desacoplada del guardado y no envía nada. La confirmación no se recupera tras recargar porque la web pública no consulta reservas personales; la ocupación del intervalo sí se conserva en Supabase.

## Panel privado de administración

Abre **`admin.html`** en el navegador desde la carpeta del proyecto. En GitHub Pages se abre añadiendo `/admin.html` a la dirección del proyecto, por ejemplo `https://TU_USUARIO.github.io/NOVA-Hair-Studio/admin.html`. No hay enlace destacado desde la web pública y no se necesita compilación. La apertura directa necesita acceso al CDN y a Supabase; si el navegador restringe la persistencia de sesión en `file://`, utiliza la URL HTTPS de GitHub Pages.

El panel reutiliza `supabase-config.js`, el SDK y las correspondencias de `data.js`. **No tiene modo local ni crea administradores**. Deben existir el usuario de Auth, `nova_is_admin()`, las tablas y las políticas ya configuradas. No ejecuta SQL ni altera esos permisos.

### Acceso, sesión y privacidad

1. Al abrir se muestra «Comprobando sesión…» y se llama a `auth.getSession()`. Sin sesión aparece únicamente el acceso.
2. Introduce el email y la contraseña de tu administrador existente. Se utiliza [`auth.signInWithPassword()`](https://supabase.com/docs/reference/javascript/auth-signinwithpassword); una contraseña incorrecta muestra un error y limpia ese campo.
3. Antes de mostrar el panel o consultar reservas se exige que `rpc('nova_is_admin')` devuelva el booleano `true`. Una cuenta sin autorización se desconecta y ve «Esta cuenta no está autorizada para administrar NOVA.».
4. «Cerrar sesión» solicita a Auth el cierre en este navegador y borra inmediatamente las reservas del estado y del DOM, incluido cualquier formulario o diálogo. Las consultas antiguas no pueden volver a mostrarlas. Si falla el cierre, hay un botón de reintento y una renovación del token no reabre el panel automáticamente.

La sesión la persiste **el SDK de Supabase Auth**, con la clave de almacenamiento independiente `nova-admin-auth-v1`; también gestiona el refresco del token. No hay almacenamiento manual de contraseñas o tokens, ni se guardan reservas o datos de clientes en localStorage. El cliente público no carga esta sesión. Los observadores de Auth son síncronos y difieren la comprobación de red para [evitar bloqueos del SDK](https://supabase.com/docs/guides/troubleshooting/why-is-my-supabase-api-call-not-returning-PGzXw0).

Cada operación privada vuelve a comprobar sesión y permiso en el servidor. RLS sigue siendo la protección real: conocer la URL o alterar el HTML no concede permisos sobre las tablas. Los rechazos de autorización retiran los datos del panel; los errores mostrados no incluyen detalles privados del servidor. No se imprimen reservas o sesiones en consola.

### Agenda y comprobación de una cita telefónica

La vista inicial es **Próximas**. Los filtros **Hoy**, **Todas**, **Canceladas** y profesional permiten revisar el resto. «Historial / canceladas» abre las canceladas; «Todas» incluye también citas pasadas. El resumen cuenta las citas de toda la agenda, con las de hoy y próximas limitadas a confirmadas. Las fechas, horas, límites del día y disponibilidad utilizan **Europe/Madrid**, con independencia de la zona del dispositivo.

1. Abre «Nueva cita telefónica». Elige un servicio: si solo tiene un profesional, se asigna automáticamente; si tiene varios, puedes elegir entre los compatibles.
2. Elige un día laborable futuro y una hora. Solo se ofrecen intervalos donde cabe el servicio completo, dentro de 09:00–20:00 de lunes a viernes o 09:00–14:00 el sábado, con comienzos cada 30 minutos. Los domingos y el pasado no admiten citas. «Actualizar horas» permite repetir la consulta.
3. Introduce datos de cliente ficticios para la prueba y pulsa «Crear cita telefónica». Elegir los campos no inserta nada. Se releen las reservas y los bloqueos activos, y se comprueba otra vez toda la duración antes de enviar. Un bloqueo de última hora rechazado por el servidor se trata como un conflicto recuperable y conserva los datos del cliente.
4. Tras «Cita telefónica creada.», el formulario se limpia y la agenda se actualiza. Abre la web pública, selecciona el mismo servicio, profesional y fecha, y vuelve a consultar: ese intervalo ya no debe ofrecerse. También hay refresco público cada 30 segundos mientras la página está visible.
5. Para comprobar un conflicto, prepara el mismo horario en otra pestaña antes de guardarlo. Si el servidor rechaza el segundo intento, se muestra «Ese horario acaba de dejar de estar disponible.»; se actualizan las horas y se conservan los datos del formulario.

La lectura privada solicita exclusivamente:

```text
id, service_id, professional_id, start_at, end_at,
customer_name, customer_phone, customer_email, source, status, created_at
```

La creación telefónica envía únicamente:

```text
service_id, professional_id, start_at,
customer_name, customer_phone, customer_email, source: 'phone'
```

No envía `end_at`, `id`, `created_at` ni `status`, ni añade una lectura al INSERT. El servidor calcula la duración definitiva y valida la operación. Una respuesta perdida puede dejar el resultado incierto: se bloquean nuevas creaciones en esa página hasta recargar. Comprueba antes la agenda para evitar duplicar una cita que sí se haya guardado. Un fallo de refresco posterior a una escritura confirmada no transforma el éxito en un fallo de creación.

### Comprobar una cancelación

1. En una cita confirmada pulsa «Cancelar cita». El diálogo identifica al cliente, servicio, fecha y hora. «Mantener cita» cierra el diálogo sin modificar nada.
2. «Sí, cancelar cita» realiza `update({ status: 'cancelled' }).eq('id', id)` y comprueba que se actualizó la fila. **No elimina registros ni permite reactivarlos**.
3. Tras «Cita cancelada.», la reserva aparece en el filtro «Canceladas». Vuelve a consultar esa fecha en la web pública: el intervalo estará libre si ninguna otra cita o bloqueo ocupa ese tiempo.

«Llamar» y «Enviar email» abren `tel:` y `mailto:`. No se envían avisos automáticamente al crear o cancelar.

La agenda se refresca al pedirlo, después de crear/cancelar, al volver a la pestaña y cada 30 segundos mientras está visible. Las lecturas privadas están paginadas y rechazan resultados incompletos o inconsistentes; esta primera versión admite hasta 20.000 filas por consulta completa. No utiliza Realtime ni añade roles, pagos, SMS o correo automático.

### Disponibilidad: ausencias, vacaciones y cierres

En `admin.html`, inicia sesión y abre **Disponibilidad**. Esta sección usa la tabla existente `nova_blocks`, con las mismas comprobaciones de Auth y `nova_is_admin()` que el resto del panel. No modifica SQL, RLS ni triggers. No guarda bloqueos ni motivos en localStorage.

| Necesidad | Selección en el formulario |
| --- | --- |
| Ausencia de unas horas | Selecciona a la persona, tipo **Ausencia**, la misma fecha de inicio y fin y las horas, por ejemplo 12:00–15:00. |
| Un día de ausencia | Selecciona a la persona, **Ausencia**, la misma fecha de inicio y fin y activa **Día completo**. |
| Vacaciones de varios días | Selecciona a la persona, **Vacaciones**, fecha inicial y última fecha de vacaciones; activa **Día completo**. |
| Cerrar todo el salón | Selecciona **Todo el salón**, tipo **Cierre**, las fechas y las horas o **Día completo**. |
| Otro periodo ocupado | Selecciona el alcance, tipo **Otro** y el periodo correspondiente. |

El motivo es opcional, admite hasta 500 caracteres y solo aparece en el panel autenticado. Pulsa **Bloquear disponibilidad**. Si no afecta a citas existentes, se guarda el bloqueo, aparece «Disponibilidad actualizada.», se limpia el formulario y se actualizan las listas y las horas del panel.

**Día completo incluye ambas fechas elegidas.** Por ejemplo, del 20 al 25 significa desde el día 20 a las 00:00 hasta el día 26 a las 00:00, siempre en Madrid. No se suman periodos fijos de 24 horas: `salon-time.js` convierte cada extremo por separado, contemplando días de 23 o 25 horas. Las horas inexistentes o ambiguas de los cambios de hora muestran un error para elegir otra; un final anterior o igual al inicio también se rechaza.

#### Si hay citas afectadas

Antes de crear se consultan únicamente las citas confirmadas que se solapan con el periodo y, si corresponde, con el profesional elegido. El diálogo muestra **«Este bloqueo afecta a X citas ya reservadas.»**, junto con fecha, hora, profesional, servicio y cliente.

- **Volver:** conserva el formulario sin guardar el bloqueo ni modificar citas.
- **Crear bloqueo igualmente:** vuelve a consultar las citas, guarda el bloqueo si el impacto sigue reconocido y mantiene todas las reservas intactas. Puedes contactar después con sus clientes desde **Agenda**.

Si se detecta una cita nueva en la última comprobación, aparece otra vez el aviso para revisarla. La consulta y el INSERT son operaciones independientes: una reserva podría entrar en el intervalo entre ambas. El cliente no puede eliminar esa ventana sin una operación transaccional en el servidor; los triggers existentes siguen siendo la protección final para nuevas reservas. Este trabajo no los modifica.

El INSERT de un bloqueo contiene exactamente:

```text
professional_id, start_at, end_at, kind, reason, active: true
```

`professional_id: null` significa todo el salón. `id`, `created_by` y `created_at` se dejan al servidor. No se actualiza ni cancela ninguna fila de `nova_bookings` al crear un bloqueo.

#### Desactivar y comprobar el resultado

En **Bloqueos activos**, cada tarjeta indica a quién afecta, tipo, periodo y motivo. Pulsa **Eliminar bloqueo** y confirma. Se ejecuta `update({ active: false }).eq('id', id)`, comprobando que se actualizó la fila. Se conserva el historial en Supabase; la lista solo muestra activos. Tras «Bloqueo eliminado.», el horario vuelve a estar libre si no queda otra reserva o bloqueo.

Para probarlo, abre también `index.html` en otra pestaña:

1. Bloquea un día de Laura. Consulta **Corte mujer** con «Cualquiera disponible»: María debe seguir apareciendo. Selecciona Laura: ese día debe quedar completo para ella.
2. Crea vacaciones de Laura de varios días. Revisa **Balayage**: todos los días laborables de ese periodo deben quedar completos.
3. Bloquea todo el salón durante un día: no debe quedar ningún hueco para ninguno de sus servicios.
4. Prueba un bloqueo de Laura de 12:00 a 15:00 con **Color completo** (120 minutos). 10:00 puede terminar justo al inicio del bloqueo; 10:30 no puede ofrecerse. 15:00 vuelve a ser posible si no hay más ocupaciones y cabe antes del cierre.
5. Desactiva el bloqueo y vuelve a consultar. Las horas libres deben reaparecer. Comprueba lo mismo en **Nueva cita telefónica**.
6. Para probar el aviso, crea primero una cita con datos ficticios y después un bloqueo que la incluya: deberá pedir confirmación y la cita seguirá confirmada.

Cambiar de fecha o profesional, recargar o esperar el refresco de la pestaña visible vuelve a consultar ambos conjuntos. En la web pública nunca se verá el motivo. Si falla la red al crear y se pierde la respuesta, el panel avisa del resultado incierto y bloquea repetir la creación hasta recargar; actualiza primero **Bloqueos activos** para comprobar si ya se guardó. Un fallo de lectura posterior a un guardado confirmado no borra la confirmación de éxito.

## Archivos y arquitectura

- `index.html`: estructura, formularios, estados y orden de carga de scripts.
- `styles.css`: diseño original conservado en esta fase.
- `data.js`: catálogo, profesionales, precios, duraciones, reseñas y correspondencias opcionales.
- `salon-time.js`: conversión entre el horario de Madrid e instantes UTC.
- `booking-core.js`: motor común de disponibilidad con reservas y bloques separados, validación y adaptador explícitamente local.
- `supabase-config.js`: las dos constantes públicas editables.
- `supabase-repository.js`: selección de modo, cliente único y adaptador remoto.
- `script.js`: interfaz compartida por ambos repositorios, estados de red y refrescos.
- `admin.html` y `admin.css`: acceso y panel responsive independientes de la página pública.
- `admin.js`: interfaz privada, filtros, citas telefónicas, editor de disponibilidad, avisos de impacto y descarte de respuestas tras cerrar sesión.
- `admin-repository.js`: operaciones Auth, comprobación de administrador, agenda privada, bloques y mutaciones autorizadas. Reutiliza `NovaStorage.createAdminContext()` y el motor existente.
- `tests/`: pruebas sin dependencias ni acceso a la base de datos real.

La interfaz utiliza `NovaStorage.createRepository()`:

```js
const repository = NovaStorage.createRepository();
repository.mode; // 'local' o 'supabase'
// Fechas YYYY-MM-DD y fin exclusivo. El modo remoto exige ambas lecturas.
if (repository.mode === 'supabase') {
  const { bookings, blocks } = await repository.listAvailability({ startDate, endDate });
} else {
  const bookings = await repository.listBookings(); // demo local, sin bloques administrativos
}
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
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/admin-repository.test.js
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/admin-ui.test.js
python3 tests/check_structure.py
python3 tests/check_admin_structure.py
```

Las pruebas cubren duración real, solapamientos, guardado y cancelación locales, permisos de columnas del adaptador, aislamiento de almacenamiento, estados asíncronos, conflictos, errores, paginación y cambios horarios. El panel añade pruebas de login, denegación de permisos, RPC antes de leer datos privados, logout, renovación de sesión, respuestas tardías, recuperación de navegación, filtros, payload telefónico, cancelación y liberación de disponibilidad pública. Los bloqueos incluyen ausencias individuales, cierres globales, vacaciones, duración larga, «Cualquiera disponible», DST, creación/desactivación, advertencia de citas afectadas, `HORARIO_BLOQUEADO`, fallos de red y privacidad de los motivos. Los fixtures son independientes de la configuración real del proyecto.

Las pruebas de interfaz utilizan un DOM mínimo y repositorios controlados: no sustituyen una comprobación visual/táctil en navegador ni validan Auth, RLS o reservas del proyecto Supabase real. Para comprobarlos, utiliza los pasos manuales anteriores con la cuenta administradora ya creada. Las suites no acceden a esa cuenta ni insertan reservas en la base de datos real.
