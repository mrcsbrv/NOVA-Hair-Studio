/* Pruebas de interacción de script.js con un DOM mínimo (sin layout).
 * Desde la raíz: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/ui.test.js
 * Se usa almacenamiento de memoria: nunca modifica la agenda de tu navegador.
 */
"use strict";
load("tests/dom-lite.js");
load("data.js");
load("booking-core.js");
load("script.js");
drainMicrotasks();

const $test = selector => document.querySelector(selector);
const all = selector => document.querySelectorAll(selector);
let passed = 0;
function assert(condition, message) { if (!condition) throw new Error(message); }
function test(name, callback) {
  callback();
  drainMicrotasks();
  passed += 1;
  print("OK · " + name);
}
function click(selector) {
  const element = $test(selector);
  assert(element, "No existe " + selector);
  assert(!element.disabled, "El control está desactivado: " + selector);
  element.click();
  drainMicrotasks();
}
function change(selector, value) {
  const element = $test(selector);
  assert(element, "No existe " + selector);
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
  drainMicrotasks();
}
function submit(selector) {
  $test(selector).dispatchEvent(new Event("submit", { bubbles: true }));
  drainMicrotasks();
}
function saved() { return JSON.parse(localStorage.getItem(NovaCore.STORAGE_KEY)).bookings; }
function fillCustomer(prefix = "customer") {
  $test("#" + prefix + "-name").value = "Álex Prueba";
  $test(prefix === "phone" ? "#phone-number" : "#customer-phone").value = "+34 612 345 678";
  $test("#" + prefix + "-email").value = "alex@prueba.example";
}
function selectService(id) { change("#service-select", id); }
function showDate(key) {
  for (let attempts = 0; !$test('[data-date="' + key + '"]') && attempts < 3; attempts += 1) click("#calendar-next");
  click('[data-date="' + key + '"]');
}
function slotSelector(start, professional = "carlos") { return '[data-slot="' + start + '"][data-professional="' + professional + '"]'; }
const date = new Date();
date.setDate(date.getDate() + 10);
while (!NovaData.business.hours[date.getDay()]) date.setDate(date.getDate() + 1);
const dateKey = NovaCore.toDateKey(date);
const initialCount = saved().length;
let chosenStart;
let newId;

test("La aplicación arranca, renderiza 10 servicios y 3 profesionales", () => {
  assert(all("#services-grid [data-book-service]").length === 10, "Servicios incompletos");
  assert(all("#team-grid .team-card").length === 3, "Equipo incompleto");
  assert(!$test("#booking-status").textContent.includes("No se pudo iniciar"), "Error al iniciar la interfaz");
});
test("Controles renderizados conservan nombres accesibles y referencias ARIA válidas", () => {
  for (const control of all("input, select, textarea")) {
    const named = control.getAttribute("aria-label") || control.getAttribute("aria-labelledby") || control.closest("label") || (control.id && $test('label[for="' + control.id + '"]'));
    assert(named, "Control sin nombre accesible: " + control.id);
    for (const reference of (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)) assert($test("#" + reference), "Referencia ARIA inexistente: " + reference);
  }
  for (const button of all("button")) assert(button.getAttribute("aria-label") || button.getAttribute("aria-labelledby") || button.textContent.trim(), "Botón sin nombre accesible: " + button.id);
});
test("Calendario inicia en el mes actual y bloquea retroceso y fechas pasadas", () => {
  assert($test("#calendar-prev").disabled, "Se puede retroceder antes del mes actual");
  assert(all(".calendar-day.is-past").every(element => element.disabled), "Una fecha pasada es seleccionable");
  assert(all(".calendar-day.is-today").length === 1, "No está marcado hoy");
});
test("Reservar desde una tarjeta preselecciona el servicio y asigna Carlos", () => {
  click('[data-book-service="corte-caballero"]');
  assert($test("#service-select").value === "corte-caballero", "El servicio no queda seleccionado");
  assert($test("#professional-field").hidden, "Se exige elegir profesional único");
  assert($test("#single-professional").textContent.includes("Carlos"), "No se asignó Carlos");
  assert(document.activeElement === $test("#service-select"), "No se enfoca la reserva");
});
test("Servicios compartidos ofrecen cualquiera, Laura y María; la elección filtra horas", () => {
  selectService("corte-mujer");
  assert(!$test("#professional-field").hidden, "No se muestran profesionales compatibles");
  assert(all('#professional-options input[name="professional"]').length === 3, "Opciones compatibles incorrectas");
  showDate(dateKey);
  assert(all("[data-slot]").some(element => element.dataset.professional === "laura"), "Faltan horas de Laura");
  assert(all("[data-slot]").some(element => element.dataset.professional === "maria"), "Faltan horas de María");
  change('#professional-options input[value="maria"]', "maria");
  assert(all("[data-slot]").every(element => element.dataset.professional === "maria"), "No se filtran los profesionales");
});
test("Domingos y días completos explican por qué no hay horas", () => {
  selectService("corte-caballero");
  let closed = all(".calendar-day.is-closed").find(element => !element.disabled);
  if (!closed) { click("#calendar-next"); closed = all(".calendar-day.is-closed").find(element => !element.disabled); }
  assert(closed, "No hay domingo futuro para probar");
  closed.click();
  assert($test("#day-status").textContent.includes("Cerrado"), "Domingo sin explicación");
  assert(all("[data-slot]").length === 0, "Se ofrecen horas en domingo");
  // Las semillas pueden quedar en el mes anterior al actualmente mostrado.
  while (!$test("#calendar-prev").disabled) click("#calendar-prev");
  let full = all(".calendar-day.is-full").find(element => !element.disabled);
  if (!full) { click("#calendar-next"); full = all(".calendar-day.is-full").find(element => !element.disabled); }
  assert(full, "No se encuentra el día demo lleno");
  full.click();
  assert($test("#day-status").textContent.includes("No quedan citas disponibles para este servicio."), "Día completo sin explicación");
  while (!$test("#calendar-prev").disabled) click("#calendar-prev");
});
test("Seleccionar una hora revela los datos; las horas ocupadas están desactivadas", () => {
  showDate(dateKey);
  const first = all("[data-slot]")[0];
  assert(first, "No hay huecos libres en una fecha futura sin semillas");
  chosenStart = Number(first.dataset.slot);
  first.click();
  assert(!$test("#customer-form").hidden, "No se muestran los datos del cliente");
  assert(document.activeElement === $test("#customer-name"), "No se enfoca el nombre");
  assert(all(".slot-button.is-unavailable").every(element => element.disabled), "Hora no disponible seleccionable");
});
test("Los tres campos vacíos muestran errores accesibles y no guardan", () => {
  submit("#customer-form");
  for (const field of ["name", "phone", "email"]) {
    assert($test("#error-" + field).textContent, "Falta error " + field);
    assert($test("#customer-" + field).getAttribute("aria-invalid") === "true", "Falta aria-invalid " + field);
  }
  assert(saved().length === initialCount, "Se ha guardado un formulario vacío");
  assert($test("#booking-review").hidden, "Se permite revisar datos vacíos");
});
test("Nombre, teléfono y email incorrectos se rechazan; corregir limpia los errores", () => {
  $test("#customer-name").value = "1234";
  $test("#customer-phone").value = "abc";
  $test("#customer-email").value = "sin-arroba";
  submit("#customer-form");
  assert(["name", "phone", "email"].every(field => $test("#error-" + field).textContent), "Falta validación de formato");
  fillCustomer();
  for (const field of ["name", "phone", "email"]) $test("#customer-" + field).dispatchEvent(new Event("input", { bubbles: true }));
  assert(["name", "phone", "email"].every(field => !$test("#error-" + field).textContent), "La corrección no limpia los errores");
});
test("El resumen muestra todos los datos y todavía no persiste la reserva", () => {
  submit("#customer-form");
  assert(!$test("#booking-review").hidden, "No aparece el resumen");
  for (const label of ["Servicio", "Profesional", "Fecha", "Hora", "Duración aproximada", "Precio"]) assert($test("#review-summary").textContent.includes(label), "Falta " + label);
  assert(saved().length === initialCount, "El resumen guarda antes de confirmar");
});
test("Modificar vuelve al formulario manteniendo los datos", () => {
  click("#modify-booking");
  assert(!$test("#customer-form").hidden && $test("#booking-review").hidden, "Modificar no vuelve a los datos");
  assert($test("#customer-name").value === "Álex Prueba", "Modificar pierde los datos");
  submit("#customer-form");
});
test("Confirmar crea una única cita de 30 minutos y presenta confirmación demo", () => {
  click("#confirm-booking");
  const bookings = saved();
  assert(bookings.length === initialCount + 1, "La confirmación no guarda exactamente una cita");
  const booking = bookings.find(item => item.source === "online");
  newId = booking.id;
  assert(booking.duration === 30 && booking.end - booking.start === 30, "Duración guardada incorrecta");
  assert(!$test("#booking-success").hidden, "No aparece la confirmación");
  assert($test("#success-email").textContent.includes("alex@prueba.example"), "Falta el email en confirmación");
  assert(!$test(slotSelector(chosenStart)), "La nueva cita sigue disponible");
  click("#confirm-booking");
  assert(saved().length === initialCount + 1, "Se duplica la cita tras confirmar");
});
test("Cancelar desde la agenda devuelve el hueco y retira la confirmación", () => {
  click('[data-cancel-booking="' + newId + '"]');
  assert(saved().length === initialCount, "Cancelar no elimina la cita");
  assert($test(slotSelector(chosenStart)), "Cancelar no devuelve el hueco");
  assert($test("#booking-success").hidden, "Sigue mostrándose confirmada una cita cancelada");
});
test("Cancelar una cita ya eliminada desde otra pestaña retira la confirmación obsoleta", () => {
  click(slotSelector(chosenStart));
  fillCustomer();
  submit("#customer-form");
  click("#confirm-booking");
  const booking = saved().find(item => item.source === "online");
  NovaCore.createRepository().cancelBooking(booking.id);
  drainMicrotasks();
  // No se emite storage: se comprueba la carrera entre lectura y cancelación.
  click('[data-cancel-booking="' + booking.id + '"]');
  assert(!$test('[data-cancel-booking="' + booking.id + '"]'), "Sigue mostrándose una cita ya eliminada");
  assert($test("#booking-success").hidden, "La confirmación obsoleta sigue visible");
  assert($test(slotSelector(chosenStart)), "No se recupera el hueco cancelado desde otra pestaña");
  assert($test("#demo-status").textContent.includes("ya no existe"), "No se explica la cancelación previa");
});
test("Un error de escritura no confirma la cita y permite reintentar", () => {
  click(slotSelector(chosenStart));
  fillCustomer();
  submit("#customer-form");
  const originalSet = localStorage.setItem;
  try {
    localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    click("#confirm-booking");
  } finally { localStorage.setItem = originalSet; }
  assert(saved().length === initialCount, "Se guarda una cita aunque falla el almacenamiento");
  assert($test("#booking-success").hidden && !$test("#booking-review").hidden, "Se confirma una cita no guardada");
  assert(!$test("#confirm-booking").disabled, "El botón de confirmación no permite reintentar");
  assert($test("#booking-status").textContent.includes("No se pudo guardar"), "No se comunica el error de escritura");
});
test("Fallar la lectura después de guardar conserva el éxito y no niega la reserva", () => {
  const originalGet = localStorage.getItem;
  const originalSet = localStorage.setItem;
  try {
    localStorage.setItem = (key, value) => {
      originalSet(key, value);
      localStorage.getItem = () => { throw new Error("Storage temporarily unavailable"); };
    };
    click("#confirm-booking");
  } finally { localStorage.getItem = originalGet; localStorage.setItem = originalSet; }
  assert(saved().length === initialCount + 1, "No se completó el guardado anterior al fallo de lectura");
  assert(!$test("#booking-success").hidden, "Se pierde la confirmación de una cita guardada");
  assert(!$test("#booking-status").textContent.includes("No se ha guardado"), "El aviso niega incorrectamente el guardado");
  assert($test("#booking-status").textContent.includes("no puede actualizarse"), "No se explica el fallo de actualización");
  assert(all("[data-slot]").length === 0, "Se ofrecen horas sin poder consultar la agenda");
  dispatchEvent(new Event("storage", { key: NovaCore.STORAGE_KEY }));
  drainMicrotasks();
  const booking = saved().find(item => item.source === "online");
  assert(!$test(slotSelector(chosenStart)), "Tras recuperarse, el hueco reservado se ofrece como libre");
  click('[data-cancel-booking="' + booking.id + '"]');
  assert(saved().length === initialCount, "No se puede cancelar tras recuperar el almacenamiento");
});
test("El formulario telefónico se abre, valida datos y comunica errores", () => {
  click("#toggle-phone-form");
  assert(!$test("#phone-form").hidden, "No se abre el formulario telefónico");
  submit("#phone-form");
  assert($test("#phone-errors").textContent, "No muestra errores telefónicos");
  assert(saved().length === initialCount, "Se guarda una cita telefónica inválida");
});
test("Una fecha telefónica fuera del formato admitido se rechaza sin lanzar errores JS", () => {
  change("#phone-date", "20260-01-01");
  assert($test("#phone-time").textContent.includes("fecha válida"), "Falta explicación para la fecha no válida");
  assert($test("#phone-date").getAttribute("aria-invalid") === "true", "Fecha incorrecta sin aria-invalid");
});
test("La cita telefónica bloquea inmediatamente la disponibilidad pública", () => {
  change("#phone-service", "corte-caballero");
  change("#phone-date", dateKey);
  change("#phone-time", String(chosenStart));
  fillCustomer("phone");
  submit("#phone-form");
  assert(saved().length === initialCount + 1, "No se guarda la cita telefónica");
  const booking = saved().find(item => item.source === "phone");
  assert(booking && booking.start === chosenStart, "Origen u horario telefónico incorrecto");
  newId = booking.id;
  assert(!$test(slotSelector(chosenStart)), "La cita telefónica no bloquea el horario público");
  click("#close-phone-form");
  assert($test("#phone-form").hidden, "No se cierra el formulario telefónico");
});
test("Cancelar una cita telefónica vuelve a ofrecer su horario", () => {
  click('[data-cancel-booking="' + newId + '"]');
  assert($test(slotSelector(chosenStart)), "Cancelar la telefónica no libera el hueco");
});
test("Una cita concurrente se detecta justo al confirmar y pide otra hora", () => {
  click(slotSelector(chosenStart));
  fillCustomer();
  submit("#customer-form");
  NovaCore.createRepository().createBooking({ serviceId: "corte-caballero", professionalId: "carlos", date: dateKey, start: chosenStart, customer: { name: "Otra Persona", phone: "612345679", email: "otra@prueba.example" }, source: "online" });
  drainMicrotasks();
  const countBefore = saved().length;
  click("#confirm-booking");
  assert(saved().length === countBefore, "Se guarda sobre un hueco ocupado");
  assert($test("#booking-review").hidden && $test("#booking-success").hidden, "No se abandona la confirmación inválida");
  assert($test("#booking-status").textContent.includes("ya no está disponible"), "Falta aviso de conflicto");
});
test("Cambios recibidos de otra pestaña actualizan la selección pendiente", () => {
  const available = all("[data-slot]")[0];
  const start = Number(available.dataset.slot);
  available.click();
  fillCustomer();
  submit("#customer-form");
  NovaCore.createRepository().createBooking({ serviceId: "corte-caballero", professionalId: "carlos", date: dateKey, start, customer: { name: "Otra Persona", phone: "612345679", email: "otra@prueba.example" }, source: "online" });
  drainMicrotasks();
  dispatchEvent(new Event("storage", { key: NovaCore.STORAGE_KEY }));
  drainMicrotasks();
  assert($test("#booking-review").hidden, "La selección no reacciona al cambio de almacenamiento");
  assert(!$test(slotSelector(start)), "La disponibilidad sigue desactualizada");
});
test("Los ejemplos abren una galería con tres placeholders y dos reseñas identificadas", () => {
  const opener = $test('[data-examples="balayage"]');
  opener.focus();
  opener.click();
  assert($test("#example-dialog").open, "No se abre la galería");
  assert(all("#dialog-content .placeholder").length === 3, "Faltan imágenes placeholder");
  assert(all("#dialog-content .example-review").length === 2, "Faltan reseñas del servicio");
  assert($test("#dialog-content").textContent.includes("Datos de demostración"), "Las reseñas no están identificadas como demo");
  click("#close-dialog");
  assert(!$test("#example-dialog").open && document.activeElement === opener, "Cerrar no devuelve el foco al botón de origen");
});
test("Reservar desde ejemplos cierra el modal y selecciona Balayage", () => {
  click('[data-examples="balayage"]');
  click('#dialog-content [data-book-service="balayage"]');
  assert(!$test("#example-dialog").open, "El modal sigue abierto al reservar");
  assert($test("#service-select").value === "balayage", "No se preselecciona Balayage");
  assert(document.activeElement === $test("#service-select"), "No se enfoca la selección");
});
test("El carrusel automático respeta movimiento reducido, hover, foco y pestañas ocultas", () => {
  const browser = NovaTestEnvironment;
  assert(browser.countIntervals(6500) === 0, "Hay autoavance con movimiento reducido inicial");
  browser.setReducedMotion(false);
  click("#review-toggle");
  assert(browser.countIntervals(6500) === 1, "Reanudar no programa el carrusel");
  assert($test("#review-content").getAttribute("aria-live") === "off" && $test("#review-position").getAttribute("aria-live") === "off", "El autoavance interrumpe al lector de pantalla");
  const before = $test("#review-content").textContent;
  browser.tickIntervals(6500);
  assert($test("#review-content").textContent !== before, "El temporizador no cambia de reseña");
  const region = $test("#resenas");
  region.dispatchEvent(new Event("mouseenter"));
  assert(browser.countIntervals(6500) === 0, "El carrusel no se pausa al posar el cursor");
  region.dispatchEvent(new Event("mouseleave"));
  assert(browser.countIntervals(6500) === 1, "El carrusel no se reanuda al retirar el cursor");
  region.dispatchEvent(new Event("focusin"));
  assert(browser.countIntervals(6500) === 0, "El carrusel no se pausa mientras tiene foco");
  region.dispatchEvent(new Event("focusout", { relatedTarget: document.body }));
  assert(browser.countIntervals(6500) === 1, "El carrusel no se reanuda al salir con teclado");
  document.hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  assert(browser.countIntervals(6500) === 0, "El carrusel avanza en una pestaña oculta");
  document.hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  drainMicrotasks();
  assert(browser.countIntervals(6500) === 1, "El carrusel no se reanuda al volver a la pestaña");
  browser.setReducedMotion(true);
  assert(browser.countIntervals(6500) === 0, "Activar movimiento reducido no detiene el carrusel");
  assert($test("#review-toggle").getAttribute("aria-pressed") === "true", "No se refleja la pausa automática");
});
test("Carrusel tiene flechas, indicadores y control de pausa funcionales", () => {
  const before = $test("#review-content").textContent;
  click("#review-next");
  assert($test("#review-content").textContent !== before, "La flecha siguiente no cambia de reseña");
  click("#review-prev");
  assert($test("#review-content").textContent === before, "La flecha anterior no vuelve a la reseña");
  click('[data-review="2"]');
  assert($test("#review-position").textContent.startsWith("3 de"), "El indicador no cambia de reseña");
  assert($test("#review-toggle").getAttribute("aria-pressed") === "true", "La interacción no pausa el carrusel");
  assert($test("#review-content").getAttribute("aria-live") === "polite", "La elección manual no comunica la nueva reseña");
  click("#review-toggle");
  assert($test("#review-toggle").getAttribute("aria-pressed") === "false", "No se puede reanudar el carrusel");
});
test("Cómo llegar explica la dirección ficticia sin abrir un destino engañoso", () => {
  click("#directions-button");
  assert($test("#example-dialog").open && $test("#dialog-content").textContent.includes("ficticios"), "Falta información sobre la dirección demo");
  click("#dialog-content [data-close-dialog]");
  assert(!$test("#example-dialog").open, "Entendido no cierra la información");
});
test("Restaurar requiere su acción explícita y vuelve a generar solo las semillas", () => {
  const countBefore = saved().length;
  click("#reset-demo");
  assert(saved().length === countBefore, "Abrir el diálogo ya restaura los datos");
  click("#dialog-content [data-close-dialog]");
  assert(saved().length === countBefore, "Cancelar el restablecimiento cambia la agenda");
  click("#reset-demo");
  click("#confirm-reset");
  assert(saved().every(booking => booking.source === "demo"), "Restaurar mantiene reservas creadas");
  assert(saved().length === initialCount, "Restaurar no repone las semillas originales");
  assert(!$test("#example-dialog").open, "Restaurar no cierra el diálogo");
});

print("Interfaz: " + passed + "/" + passed + " pruebas correctas (DOM mínimo, sin comprobación visual).");
