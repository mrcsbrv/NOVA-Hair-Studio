# NOVA Hair Studio · demostración local

Aplicación de una peluquería ficticia, hecha con HTML5, CSS y JavaScript vanilla. No requiere instalación, compilación, cuentas ni servicios externos.

## Abrir y probar

Abre `index.html` en un navegador moderno con JavaScript y almacenamiento local habilitados. La primera apertura crea citas de ejemplo para los tres próximos días laborables, a partir de la fecha del dispositivo. Las nuevas reservas sobreviven a la recarga.

1. Pulsa «Reservar este servicio», elige fecha y hora y completa los datos con información ficticia.
2. «Revisar mi reserva» permite comprobar el resumen; solo «Confirmar reserva» guarda la cita.
3. Abre «Herramientas de demostración» al final de la página para ver la agenda, cancelar o añadir una cita telefónica. Ambos cambios actualizan la disponibilidad pública.
4. «Restaurar datos demo» pide confirmación y sustituye la agenda local por nuevos ejemplos relativos a la fecha actual.

Las llamadas y enlaces de correo usan `tel:` y `mailto:` con datos ficticios. «Cómo llegar» explica que no hay una dirección real. Ninguna confirmación envía un email.

## Archivos y puntos de edición

- `index.html`: secciones, navegación, formularios y contenedores accesibles.
- `styles.css`: paleta, componentes, ilustraciones CSS y adaptación responsive.
- `data.js`: única fuente de servicios, precios, duraciones, profesionales, horarios y reseñas.
- `booking-core.js`: cálculo de intervalos, validación y repositorio asíncrono de reservas.
- `script.js`: renderizado y eventos de la interfaz; función `sendConfirmationEmail(booking)`.
- `tests/`: pruebas sin dependencias del motor, persistencia, estructura y flujo de interfaz.

Los scripts son clásicos y se cargan en ese orden, sin módulos, `fetch` ni recursos remotos, para permitir la apertura mediante `file://`. Las fechas de agenda son `YYYY-MM-DD` locales, sin convertirlas a UTC; las horas son minutos desde medianoche. El sello `createdAt` sí es ISO UTC.

Para incorporar fotografías, sustituye la ilustración del hero en HTML y el contenido de `placeholder()` en `script.js` por imágenes locales con `alt`, dimensiones y `object-fit: cover`. Puedes guardar las fotografías en una carpeta `images/`; no es necesaria mientras se utilicen las ilustraciones CSS.

## Almacenamiento y siguiente fase

`NovaCore.createRepository()` devuelve un contrato asíncrono:

```js
await repository.listBookings();
await repository.createBooking({
  serviceId, professionalId, date, start,
  customer: { name, phone, email }, source: 'online' // o 'phone'
});
await repository.cancelBooking(id);
await repository.resetDemo();
const unsubscribe = repository.subscribe(refreshView);
```

Las reservas usan la clave `nova-hair-studio.bookings.v1` de `localStorage`. Un error de lectura o escritura se muestra al usuario; nunca se presenta una reserva guardada solo en memoria como persistente. El repositorio comprueba de nuevo el intervalo completo inmediatamente antes de guardar. Las pestañas del mismo origen se coordinan con Web Locks cuando el navegador lo permite, y los cambios de almacenamiento actualizan las otras vistas.

Para Supabase, sustituir el adaptador manteniendo el contrato. La exclusión de solapamientos deberá garantizarse de forma atómica en la base de datos o en una operación del servidor; una comprobación en el cliente no basta para una aplicación multiusuario. El servidor deberá aplicar los horarios del salón, validar los datos y proteger la agenda y la información de contacto. La interfaz pública futura debe recibir disponibilidad sin exponer los datos de otros clientes. `resetDemo` y las herramientas de agenda deben retirarse del flujo público o quedar en un panel privado real.

`sendConfirmationEmail(booking)` está desacoplada del guardado y devuelve `{ sent: false, mode: 'demo' }`. Se puede conectar después a un backend de correo. Un error de correo no debe anular una cita ya guardada. No introducir secretos en estos archivos públicos.

## Límites de esta fase

- La agenda pertenece a este navegador y origen; no se comparte entre dispositivos. Borrar datos del navegador elimina las reservas. El almacenamiento de archivos `file://` depende del navegador; cambiar el archivo de ubicación puede crear una agenda distinta. GitHub Pages tendrá su propio almacenamiento, separado del archivo local.
- Sin Web Locks solo se serializan operaciones dentro de la misma página. La garantía multiusuario requiere el servidor indicado arriba.
- No hay correo real, mapa real, pagos, autenticación ni cuentas. El panel demo es público a propósito y debe usarse con datos ficticios.
- El calendario utiliza la fecha, hora y zona horaria del dispositivo. La fase de backend deberá fijar la zona horaria del salón, `Europe/Madrid`.

## Publicar como página estática

Sube estos archivos al repositorio y publica su carpeta raíz con GitHub Pages. Conserva los nombres y rutas relativas. No hay paso de compilación. La publicación no sincronizará las reservas entre visitantes: seguirán siendo locales hasta conectar el backend.

## Pruebas sin dependencias

Desde la raíz del proyecto, el JavaScriptCore disponible en macOS permite ejecutar el motor y la interfaz sin instalar nada:

```sh
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/availability.test.js
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/ui.test.js
python3 tests/check_structure.py
```

Las pruebas se ejecutan con almacenamiento aislado y no alteran la agenda del navegador. Las comprobaciones de interfaz con DOM mínimo no sustituyen una revisión visual en Safari, Chrome y dispositivos reales.

La suite del motor cubre servicios de 30, 45, 90 y 150 minutos, intervalos contiguos y solapados, cierres, fechas pasadas, profesionales compatibles, persistencia, cancelación, citas telefónicas y errores de almacenamiento. La suite de interfaz ejecuta el flujo completo hasta la confirmación, conflictos entre pestañas, ejemplos, carrusel, validaciones y restauración. El comprobador de estructura revisa rutas locales, identificadores, labels, referencias ARIA y reglas responsive esenciales.
