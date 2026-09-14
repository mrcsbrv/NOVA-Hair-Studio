/* Flujo público remoto con el DOM mínimo y respuestas asíncronas controladas.
 * No accede a Supabase, la red ni el almacenamiento real de ningún navegador.
 * Ejecutar desde la raíz con JavaScriptCore: jsc tests/remote-ui.test.js
 */
"use strict";
load("tests/dom-lite.js");
load("data.js");
load("salon-time.js");
load("booking-core.js");
load("supabase-config.js");
load("supabase-repository.js");

let passed = 0;
let repository;
let storageTouches;
let consoleCalls;
const $remote = selector => document.querySelector(selector);
const remoteAll = selector => document.querySelectorAll(selector);
function assert(condition, message) { if (!condition) throw new Error(message); }
function test(name, run) {
  run();
  drainMicrotasks();
  assert(storageTouches === 0, "El flujo remoto ha accedido a localStorage");
  assert(consoleCalls.length === 0, "La interfaz ha escrito información en consola");
  passed += 1;
  print("OK · " + name);
}
function click(selector) {
  const element = $remote(selector);
  assert(element, "No existe " + selector);
  assert(!element.disabled, "Control desactivado: " + selector);
  element.click();
  drainMicrotasks();
}
function change(selector, value) {
  const element = $remote(selector);
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
  drainMicrotasks();
}
function submit(selector) {
  $remote(selector).dispatchEvent(new Event("submit", { bubbles: true }));
  drainMicrotasks();
}
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function futureDate(offset = 12) {
  const date = NovaCore.parseDateKey(NovaTime.dateKey(new Date()));
  date.setDate(date.getDate() + offset);
  while (!NovaData.business.hours[date.getDay()]) date.setDate(date.getDate() + 1);
  return NovaCore.toDateKey(date);
}
function firstWorkingDateInMonth(range) {
  const date = NovaCore.parseDateKey(range.startDate);
  while (!NovaData.business.hours[date.getDay()]) date.setDate(date.getDate() + 1);
  return NovaCore.toDateKey(date);
}
function busyDay(date, professionalId = "carlos") {
  const hours = NovaData.business.hours[NovaCore.parseDateKey(date).getDay()];
  return { professionalId, date, start: hours.start, end: hours.end };
}
function fakeRepository(options = {}) {
  const listeners = new Set();
  const repo = {
    mode: "supabase", rows: options.rows || [], calls: [], inserts: [], pending: [],
    deferLists: Boolean(options.deferLists), readError: null, createError: null,
    cancelCalls: 0, resetCalls: 0,
    listBookings(range) {
      repo.calls.push({ ...range });
      if (repo.deferLists) return new Promise((resolve, reject) => repo.pending.push({ range: { ...range }, resolve, reject }));
      if (repo.readError) return Promise.reject(repo.readError);
      return Promise.resolve(repo.rows.filter(row => row.date >= range.startDate && row.date < range.endDate).map(row => ({ ...row })));
    },
    async createBooking(input) {
      repo.inserts.push({ ...input, customer: { ...input.customer } });
      if (repo.createError) throw repo.createError;
      // La escritura no devuelve ID ni datos de otras personas; solo el resumen
      // construido por el adaptador a partir de la solicitud de este cliente.
      const service = NovaData.services.find(item => item.id === input.serviceId);
      const booking = { ...input, duration: service.duration, end: input.start + service.duration, price: service.price };
      delete booking.id;
      repo.rows.push({ professionalId: booking.professionalId, date: booking.date, start: booking.start, end: booking.end });
      return booking;
    },
    async cancelBooking() { repo.cancelCalls += 1; throw failure("ADMIN_DISABLED", "La administración requiere un panel privado."); },
    async resetDemo() { repo.resetCalls += 1; throw failure("ADMIN_DISABLED", "La administración requiere un panel privado."); },
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    notify() { listeners.forEach(callback => callback()); drainMicrotasks(); }
  };
  return repo;
}
function boot(options = {}) {
  load("tests/dom-lite.js");
  storageTouches = 0;
  consoleCalls = [];
  for (const name of ["getItem", "setItem", "removeItem", "clear"]) {
    localStorage[name] = () => { storageTouches += 1; throw new Error("localStorage prohibido en modo remoto"); };
  }
  for (const name of ["log", "warn", "error"]) console[name] = (...args) => consoleCalls.push({ name, args });
  repository = fakeRepository(options);
  globalThis.NovaStorage = { createRepository: () => repository };
  load("script.js");
  drainMicrotasks();
  return repository;
}
function resolveRequest(request, rows = []) { request.resolve(rows); drainMicrotasks(); }
function resolveAll() {
  while (repository.pending.length) {
    const request = repository.pending.shift();
    resolveRequest(request, repository.rows.filter(row => row.date >= request.range.startDate && row.date < request.range.endDate));
  }
}
function chooseDate(date) {
  let attempts = 0;
  while (!$remote('[data-date="' + date + '"]') && attempts++ < 4) click("#calendar-next");
  click('[data-date="' + date + '"]');
}
function fillCustomer() {
  $remote("#customer-name").value = "Álex Remoto";
  $remote("#customer-phone").value = "+34 612 345 678";
  $remote("#customer-email").value = "alex@prueba.example";
}
function prepareReview() {
  change("#service-select", "corte-caballero");
  const date = futureDate();
  chooseDate(date);
  const slot = remoteAll("[data-slot]")[0];
  assert(slot, "Falta un hueco futuro para probar");
  const chosen = { date, start: Number(slot.dataset.slot), professionalId: slot.dataset.professional };
  slot.click();
  fillCustomer();
  submit("#customer-form");
  assert(!$remote("#booking-review").hidden, "No aparece el resumen");
  return chosen;
}
function slotSelector(chosen) { return '[data-slot="' + chosen.start + '"][data-professional="' + chosen.professionalId + '"]'; }

test("La disponibilidad remota empieza en carga y no ofrece horas hasta recibir datos", () => {
  boot({ deferLists: true });
  assert(repository.pending.length === 1, "No se pide la disponibilidad inicial");
  assert(remoteAll("[data-slot]").length === 0, "Se ofrecen horas antes de consultar el servidor");
  assert(remoteAll("[data-date]").every(day => day.disabled), "Un día es seleccionable antes de cargar");
  assert($remote("#booking-status").textContent.includes("Cargando disponibilidad"), "No se explica la carga inicial");
  resolveAll();
  assert(!$remote("#booking-status").textContent.includes("Error"), "Cargar la agenda vacía produce un error");
});

test("La agenda pública remota oculta y bloquea las herramientas administrativas demo", () => {
  boot();
  assert($remote("#demo-tools").closest(".demo-section").hidden, "La agenda demo es visible en modo remoto");
  assert($remote("#phone-form").hidden, "El formulario telefónico es visible en modo remoto");
  $remote("#toggle-phone-form").click();
  submit("#phone-form");
  $remote("#reset-demo").click();
  drainMicrotasks();
  assert($remote("#phone-form").hidden, "Un control oculto activa la administración remota");
  assert(repository.inserts.length === 0 && repository.cancelCalls === 0 && repository.resetCalls === 0, "Las herramientas demo llaman al repositorio remoto");
  assert($remote("#storage-mode-note").textContent.includes("Agenda compartida"), "No se identifica el almacenamiento remoto");
});

test("El calendario consulta solo el mes mostrado, con fin exclusivo y hoy de Madrid", () => {
  boot();
  const current = NovaTime.dateKey(new Date());
  const range = repository.calls[0];
  const nextMonth = NovaCore.parseDateKey(current.slice(0, 7) + "-01");
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  assert(range.startDate === current.slice(0, 7) + "-01", "El rango no empieza en el mes de Madrid");
  assert(range.endDate === NovaCore.toDateKey(nextMonth), "El rango no termina al inicio del siguiente mes");
  assert($remote('.is-today[data-date="' + current + '"]'), "El calendario no marca hoy en Madrid");
  assert($remote("#calendar-prev").disabled, "Permite retroceder antes del mes actual");
});

test("Los intervalos públicos remotos marcan días completos y conservan domingos cerrados", () => {
  const date = futureDate();
  boot({ rows: [busyDay(date)] });
  change("#service-select", "corte-caballero");
  chooseDate(date);
  assert($remote('[data-date="' + date + '"]').classList.contains("is-full"), "La ocupación remota no marca el día completo");
  assert($remote("#day-status").textContent.includes("Día completo"), "Falta la explicación del día completo");
  assert(remoteAll("[data-slot]").length === 0, "Se ofrecen horas en un día remoto completo");
  let sunday = remoteAll(".is-closed").find(day => !day.disabled);
  if (!sunday) { click("#calendar-next"); sunday = remoteAll(".is-closed").find(day => !day.disabled); }
  sunday.click();
  drainMicrotasks();
  assert($remote("#day-status").textContent.includes("Cerrado"), "Un domingo remoto se considera abierto");
});

test("Cualquiera disponible combina profesionales; el filtro respeta sus intervalos remotos", () => {
  const date = futureDate();
  boot({ rows: [{ professionalId: "laura", date, start: 540, end: 600 }] });
  change("#service-select", "corte-mujer");
  chooseDate(date);
  assert(!$remote('[data-slot="540"][data-professional="laura"]'), "Se ofrece la hora ocupada de Laura");
  assert($remote('[data-slot="540"][data-professional="maria"]'), "Se pierde la hora libre de María");
  const before = repository.calls.length;
  change('#professional-options input[value="laura"]', "laura");
  assert(repository.calls.length > before, "El cambio de profesional no consulta disponibilidad actualizada");
  assert(remoteAll("[data-slot]").every(slot => slot.dataset.professional === "laura"), "El filtro mezcla profesionales");
});

test("Un intervalo remoto intermedio bloquea todos los comienzos que invaden los 90 minutos", () => {
  const date = futureDate();
  boot({ rows: [{ professionalId: "maria", date, start: 600, end: 630 }] });
  change("#service-select", "tinte-raiz");
  change('#professional-options input[value="maria"]', "maria");
  chooseDate(date);
  assert(!$remote('[data-slot="540"][data-professional="maria"]'), "09:00 invade el intervalo remoto de 10:00");
  assert(!$remote('[data-slot="570"][data-professional="maria"]'), "09:30 invade el intervalo remoto de 10:00");
  assert($remote('[data-slot="630"][data-professional="maria"]'), "No se permite empezar al terminar la cita anterior");
});

test("Una respuesta tardía de otro mes no sustituye la disponibilidad del mes actual", () => {
  boot();
  change("#service-select", "corte-caballero");
  repository.deferLists = true;
  click("#calendar-next");
  click("#calendar-next");
  assert(repository.pending.length === 2, "No hay dos consultas de mes independientes");
  const older = repository.pending.shift();
  const newer = repository.pending.shift();
  const date = firstWorkingDateInMonth(newer.range);
  resolveRequest(newer, [busyDay(date)]);
  assert($remote('[data-date="' + date + '"]').classList.contains("is-full"), "La respuesta reciente no se aplica");
  resolveRequest(older, []);
  assert($remote('[data-date="' + date + '"]').classList.contains("is-full"), "Una respuesta antigua sobrescribe el mes visible");
});

test("Cambiar servicio y fecha vuelve a cargar antes de habilitar nuevas horas", () => {
  boot();
  change("#service-select", "corte-caballero");
  const date = futureDate();
  chooseDate(date);
  repository.deferLists = true;
  const before = repository.calls.length;
  change("#service-select", "corte-barba");
  assert(repository.calls.length > before, "Cambiar servicio no refresca el servidor");
  assert(remoteAll("[data-slot]").length === 0, "Se ofrecen huecos antiguos durante el refresco");
  resolveAll();
  chooseDate(date);
  assert(repository.pending.length > 0, "Elegir fecha no consulta datos actuales");
  assert(remoteAll("[data-slot]").length === 0, "Se ofrecen horas mientras la fecha está cargando");
  resolveAll();
  assert(remoteAll("[data-slot]").length > 0, "No se recuperan las horas después del refresco");
});

test("El formulario remoto mantiene validaciones y el resumen no inserta antes de confirmar", () => {
  boot();
  change("#service-select", "corte-caballero");
  chooseDate(futureDate());
  remoteAll("[data-slot]")[0].click();
  submit("#customer-form");
  assert(["name", "phone", "email"].every(field => $remote("#error-" + field).textContent), "Se pierden las validaciones");
  assert(repository.inserts.length === 0 && $remote("#booking-review").hidden, "Un formulario vacío crea la reserva");
  fillCustomer();
  submit("#customer-form");
  assert(!$remote("#booking-review").hidden, "No se presenta el resumen");
  assert(repository.inserts.length === 0, "Revisar datos ya inserta una reserva");
});

test("Confirmar una reserva remota sin ID conserva el éxito y bloquea inmediatamente el hueco", () => {
  boot();
  const chosen = prepareReview();
  click("#confirm-booking");
  assert(repository.inserts.length === 1, "No se crea exactamente una reserva");
  assert(!$remote("#booking-success").hidden, "El refresco elimina la confirmación sin ID");
  assert(!$remote(slotSelector(chosen)), "La reserva remota sigue disponible");
  assert($remote("#success-email").textContent.includes("alex@prueba.example"), "Falta el correo de este cliente en el resumen");
  assert(!$remote("#booking-status").textContent.includes("en este navegador"), "La confirmación remota se anuncia como local");
  $remote("#confirm-booking").click();
  drainMicrotasks();
  assert(repository.inserts.length === 1, "Una confirmación repetida crea otra cita");
  repository.notify();
  assert(!$remote("#booking-success").hidden, "Consultar solo intervalos hace desaparecer el éxito");
});

test("Al recargar otra sesión la reserva remota anterior sigue ocupando su intervalo", () => {
  boot();
  const chosen = prepareReview();
  click("#confirm-booking");
  const savedRows = repository.rows.map(row => ({ ...row }));
  boot({ rows: savedRows });
  change("#service-select", "corte-caballero");
  chooseDate(chosen.date);
  assert(!$remote(slotSelector(chosen)), "Otra sesión considera libre la cita remota guardada");
});

test("Un conflicto del servidor vuelve al selector y actualiza el intervalo ocupado", () => {
  boot();
  const chosen = prepareReview();
  repository.rows.push({ ...chosen, end: chosen.start + 30 });
  repository.createError = failure("SLOT_UNAVAILABLE", "La hora elegida ya no está disponible.");
  click("#confirm-booking");
  assert($remote("#booking-review").hidden && $remote("#booking-success").hidden, "El conflicto deja una confirmación inválida");
  assert(!$remote(slotSelector(chosen)), "Tras el conflicto se sigue ofreciendo el hueco ocupado");
  assert($remote("#booking-status").textContent.includes("ya no está disponible"), "Falta el aviso de conflicto");
});

test("Una revisión queda bloqueada durante el refresco y se invalida si el hueco cambia", () => {
  boot();
  const chosen = prepareReview();
  repository.deferLists = true;
  repository.notify();
  assert($remote("#confirm-booking").disabled, "Se permite confirmar disponibilidad que se está actualizando");
  $remote("#confirm-booking").dispatchEvent(new Event("click", { bubbles: true }));
  drainMicrotasks();
  assert(repository.inserts.length === 0, "Se confirma programáticamente durante la carga");
  repository.rows.push({ ...chosen, end: chosen.start + 30 });
  resolveAll();
  assert($remote("#booking-review").hidden, "La revisión obsoleta sigue confirmable");
  assert(!$remote(slotSelector(chosen)), "El hueco recibido como ocupado sigue seleccionable");
});

test("Error de red oculta horas, desactiva confirmar y permite reintentar sin fallback local", () => {
  boot();
  prepareReview();
  repository.readError = failure("NETWORK_ERROR", "Error de conexión. Inténtalo de nuevo.");
  repository.notify();
  assert(remoteAll("[data-slot]").length === 0, "Se ofrecen horas sin consultar el servidor");
  assert($remote("#booking-review").hidden && $remote("#booking-success").hidden, "Un error conserva una revisión o éxito falsos");
  assert(!$remote("#retry-availability").hidden, "No se ofrece reintentar la carga");
  $remote("#confirm-booking").dispatchEvent(new Event("click", { bubbles: true }));
  drainMicrotasks();
  assert(repository.inserts.length === 0, "Se intenta reservar sin disponibilidad conocida");
  repository.readError = null;
  click("#retry-availability");
  assert($remote("#retry-availability").hidden, "El reintento correcto no limpia el error");
  assert(remoteAll("[data-slot]").length > 0, "No vuelven las horas al recuperar la conexión");
});

test("Una escritura de resultado incierto no anuncia éxito ni permite repetirla automáticamente", () => {
  boot();
  prepareReview();
  repository.createError = failure("BOOKING_UNCERTAIN", "No se pudo comprobar si la reserva se guardó. Contacta con el salón antes de repetirla.");
  click("#confirm-booking");
  assert($remote("#booking-success").hidden, "Se confirma un guardado cuyo resultado se desconoce");
  assert($remote("#confirm-booking").disabled || $remote("#booking-review").hidden, "La escritura incierta sigue confirmable");
  $remote("#confirm-booking").dispatchEvent(new Event("click", { bubbles: true }));
  drainMicrotasks();
  assert(repository.inserts.length === 1, "Se repite una escritura cuyo resultado es incierto");
  assert(!$remote("#booking-uncertain-note").hidden && $remote("#booking-uncertain-note").textContent.includes("salón"), "No se explica cómo resolver la incertidumbre");
});

test("Un error al refrescar tras insertar conserva la confirmación de la reserva ya guardada", () => {
  boot();
  prepareReview();
  const originalCreate = repository.createBooking;
  repository.createBooking = async input => {
    const result = await originalCreate(input);
    repository.readError = failure("NETWORK_ERROR", "Error de conexión.");
    return result;
  };
  click("#confirm-booking");
  assert(repository.inserts.length === 1, "No se completó el guardado");
  assert(!$remote("#booking-success").hidden, "Un fallo posterior niega la reserva ya guardada");
  assert(remoteAll("[data-slot]").length === 0, "Se ofrecen horas con el refresco fallido");
  assert(!$remote("#retry-availability").hidden, "No se puede recuperar la consulta después del guardado");
});

test("El refresco remoto recupera el foco del día sin quitárselo a otro control", () => {
  boot();
  change("#service-select", "corte-caballero");
  const date = futureDate();
  chooseDate(date);
  repository.deferLists = true;
  const selector = '[data-date="' + date + '"]';
  $remote(selector).focus();
  $remote(selector).click();
  // El DOM mínimo conserva referencias retiradas; el navegador pasa a body.
  document.activeElement = document.body;
  resolveAll();
  assert(document.activeElement === $remote(selector), "La carga pierde el foco de teclado del día seleccionado");
  $remote(selector).click();
  $remote("#service-select").focus();
  resolveAll();
  assert(document.activeElement === $remote("#service-select"), "La respuesta tardía roba el foco a otro control");
});

print("Interfaz remota: " + passed + "/" + passed + " pruebas correctas (repositorio controlado; sin conexión real).");
