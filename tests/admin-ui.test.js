/* Controladores reales del panel, DOM mínimo y Auth/red controlados.
 * No lee configuración, contraseñas, reservas ni sesiones reales.
 */
'use strict';
globalThis.NOVA_TEST_HTML = 'admin.html';
load('tests/dom-lite.js');
load('data.js');
load('salon-time.js');
load('booking-core.js');
const adminSession = { user: { id: 'administrador-prueba' }, access_token: 'token-solo-fixture' };
let passed = 0;
let repository;
let storageTouches;
let consoleCalls;
const $ = selector => document.querySelector(selector);
const all = selector => document.querySelectorAll(selector);
function assert(condition, text) { if (!condition) throw new Error(text); }
function failure(code) { return Object.assign(new Error('Detalle privado que no debe llegar a la interfaz'), { code }); }
function test(name, callback) {
  callback(); drainMicrotasks();
  assert(storageTouches === 0, 'Se ha accedido al almacenamiento de reservas');
  assert(consoleCalls === 0, 'Se ha escrito información en consola');
  passed += 1; print('OK · ' + name);
}
function click(selector) { assert($(selector) && !$(selector).disabled, 'Control no disponible: ' + selector); $(selector).click(); drainMicrotasks(); }
function change(selector, value) { $(selector).value = value; $(selector).dispatchEvent(new Event('change', { bubbles: true })); drainMicrotasks(); }
function submit(selector) { $(selector).dispatchEvent(new Event('submit', { bubbles: true })); drainMicrotasks(); }
function futureDate() {
  let date = NovaTime.addDays(NovaTime.dateKey(), 10);
  while (!NovaData.business.hours[NovaCore.parseDateKey(date).getDay()]) date = NovaTime.addDays(date, 1);
  return date;
}
function row(id = 'prueba-1', overrides = {}) {
  const base = {
    id, serviceId: 'corte-caballero', professionalId: 'carlos', date: futureDate(), start: 660, end: 690, duration: 30,
    source: 'online', status: 'confirmed', customer: { name: 'Álex Prueba', phone: '+34 612 345 678', email: 'alex@prueba.example' }
  };
  Object.assign(base, overrides);
  base.startAt = NovaTime.toInstant(base.date, base.start).toISOString();
  base.endAt = NovaTime.toInstant(base.date, base.end).toISOString();
  return base;
}
function fakeRepository(options = {}) {
  let observer;
  let allowed = false;
  const repo = {
    session: options.session || null, rows: options.rows || [], permitted: options.permitted !== false,
    reads: 0, rpcs: 0, signouts: 0, creates: [], cancellations: [], pending: [], pendingTimes: [],
    readError: null, createError: null, cancelError: null, authError: options.authError,
    deferRead: false, deferTimes: false, pendingSessions: [], subscriptions: 0,
    async getSession() {
      if (repo.authError) throw repo.authError;
      if (options.deferSession) return new Promise(resolve => repo.pendingSessions.push(resolve));
      return repo.session;
    },
    async signIn() {
      if (options.wrongPassword) throw failure('INVALID_CREDENTIALS');
      repo.session = adminSession;
      if (observer) observer('SIGNED_IN', repo.session);
      return repo.session;
    },
    async authorize() {
      repo.rpcs += 1;
      if (options.deferAuthorize) return new Promise(resolve => { repo.resolveAuthorization = value => { allowed = value; resolve(value); }; });
      if (!repo.permitted) { await repo.signOut(); return false; }
      allowed = Boolean(repo.session);
      return allowed;
    },
    invalidateAuth() { allowed = false; },
    onAuthStateChange(callback) {
      repo.subscriptions += 1;
      if (options.subscriptionFailsOnce && repo.subscriptions === 1) throw failure('CONNECTION_ERROR');
      observer = callback;
      return () => { observer = null; };
    },
    async signOut() {
      repo.signouts += 1;
      if (options.signOutFails) throw failure('CONNECTION_ERROR');
      repo.session = null; allowed = false; if (observer) observer('SIGNED_OUT', null);
    },
    emit(event, session) { repo.session = session; if (observer) observer(event, session); drainMicrotasks(); },
    listBookings() {
      assert(allowed && repo.session, 'SELECT privado anterior al permiso');
      repo.reads += 1;
      if (repo.deferRead) return new Promise((resolve, reject) => repo.pending.push({ resolve, reject }));
      if (repo.readError) return Promise.reject(repo.readError);
      return Promise.resolve(repo.rows.map(item => ({ ...item, customer: { ...item.customer } })));
    },
    getAvailability(input) {
      assert(allowed && repo.session, 'Horas consultadas antes del permiso');
      const result = NovaCore.getAvailability({ ...input, bookings: repo.rows.filter(item => item.status === 'confirmed') });
      if (repo.deferTimes) return new Promise((resolve, reject) => repo.pendingTimes.push({ resolve, reject, input, result }));
      if (repo.readError) return Promise.reject(repo.readError);
      return Promise.resolve(result);
    },
    async createPhoneBooking(input) {
      assert(allowed && repo.session, 'Creación sin permiso');
      repo.creates.push(input);
      if (repo.createError) throw repo.createError;
      const service = NovaData.services.find(item => item.id === input.serviceId);
      const booking = row('phone-' + repo.creates.length, { ...input, end: input.start + service.duration, duration: service.duration, source: 'phone' });
      repo.rows.push(booking);
      if (options.failAfterCreate) repo.readError = failure('CONNECTION_ERROR');
      return booking;
    },
    async cancelBooking(id) {
      assert(allowed && repo.session, 'Cancelación sin permiso');
      repo.cancellations.push(id);
      if (repo.cancelError) throw repo.cancelError;
      repo.rows.find(item => item.id === id).status = 'cancelled';
    }
  };
  return repo;
}
function boot(options = {}) {
  load('tests/dom-lite.js');
  storageTouches = consoleCalls = 0;
  ['getItem', 'setItem', 'removeItem', 'clear'].forEach(name => { localStorage[name] = () => { storageTouches += 1; throw new Error('Almacenamiento prohibido'); }; });
  ['log', 'warn', 'error'].forEach(name => { console[name] = () => { consoleCalls += 1; }; });
  repository = fakeRepository(options);
  globalThis.NovaAdmin = { createRepository: () => repository };
  load('admin.js'); drainMicrotasks();
  return repository;
}
function login() {
  $('#login-email').value = 'admin@prueba.example';
  $('#login-password').value = 'solo-fixture';
  submit('#login-form');
}
function choosePhone(service = 'corte-caballero', date = futureDate()) {
  click('[data-admin-tab="phone"]');
  change('#phone-service', service);
  change('#phone-date', date);
  const available = all('#phone-time option').find(option => option.value !== '');
  if (available) change('#phone-time', available.value);
}
function fillCustomer() {
  $('#phone-name').value = 'Marina Prueba';
  $('#phone-phone').value = '+34 612 345 678';
  $('#phone-email').value = 'marina@prueba.example';
}

test('Sin sesión solo aparece el acceso, sin consultar permisos ni datos privados', () => {
  boot();
  assert(!$('#login-form').hidden && $('#dashboard').hidden, 'Pantalla de acceso incorrecta');
  assert(repository.rpcs === 0 && repository.reads === 0, 'Se consultan datos antes de autenticarse');
});
test('Email y contraseña vacíos tienen errores accesibles y no inician sesión', () => {
  boot(); submit('#login-form');
  assert($('#login-email').getAttribute('aria-invalid') === 'true', 'Email sin error');
  assert($('#login-password').getAttribute('aria-invalid') === 'true', 'Contraseña sin error');
  assert(document.activeElement === $('#login-email'), 'No se enfoca el primer error');
  assert(repository.reads === 0, 'Se consultan clientes');
});
test('Una contraseña incorrecta se maneja y se borra del formulario', () => {
  boot({ wrongPassword: true }); login();
  assert($('#login-feedback').textContent.includes('Revisa el email'), 'No explica credenciales');
  assert($('#login-password').value === '' && repository.reads === 0, 'Credenciales o lectura indebida');
});
test('Una cuenta no administradora se desconecta con el mensaje exacto', () => {
  boot({ permitted: false }); login();
  assert(repository.signouts === 1 && repository.reads === 0, 'Cuenta sin permisos ha leído reservas');
  assert($('#login-feedback').textContent === 'Esta cuenta no está autorizada para administrar NOVA.', 'Mensaje de denegación incorrecto');
  assert($('#dashboard').hidden, 'Panel abierto sin autorización');
});
test('Una sesión existente espera a RPC antes de mostrar o leer clientes', () => {
  boot({ session: adminSession, deferAuthorize: true, rows: [row()] });
  assert($('#dashboard').hidden && repository.reads === 0, 'Panel expuesto durante RPC');
  repository.resolveAuthorization(true); drainMicrotasks();
  assert(!$('#dashboard').hidden && repository.reads === 1, 'Admin válido no carga');
  assert($('#agenda-list').textContent.includes('Álex Prueba'), 'No renderiza respuesta');
});
test('Login válido muestra resumen, ceros, citas y acciones de contacto', () => {
  boot({ rows: [row()] }); login();
  assert(!$('#dashboard').hidden && $('#auth-screen').hidden, 'No entra');
  assert($('#stats-upcoming').textContent === '1' && $('#stats-cancelled').textContent === '0', 'Contadores incorrectos');
  assert($('#agenda-filter').value === 'upcoming', 'Vista inicial incorrecta');
  assert(all('#agenda-list a[href^="tel:"]').length === 1 && all('#agenda-list a[href^="mailto:"]').length === 1, 'Contactos no funcionales');
});
test('Cerrar sesión purga el DOM, formulario y diálogo, descartando una lectura tardía', () => {
  boot({ session: adminSession, rows: [row()] });
  repository.deferRead = true; click('#refresh-agenda');
  fillCustomer(); click('[data-cancel-id="prueba-1"]');
  click('#logout-button');
  repository.pending[0].resolve([row()]); drainMicrotasks();
  assert($('#dashboard').hidden && $('#agenda-list').textContent === '', 'Datos privados reaparecen tras logout');
  assert(!$('#cancel-dialog').open && $('#cancel-description').textContent === '' && $('#phone-name').value === '', 'Persisten datos ocultos');
  assert(repository.signouts === 1, 'No se llama a Auth signOut');
});
test('Una autorización tardía tras SIGNED_OUT nunca abre el panel', () => {
  boot({ session: adminSession, deferAuthorize: true });
  repository.emit('SIGNED_OUT', null);
  repository.resolveAuthorization(true); drainMicrotasks();
  assert($('#dashboard').hidden && repository.reads === 0, 'RPC antiguo expone agenda');
});
test('Filtros por hoy, próximas, todas, canceladas y profesional funcionan', () => {
  const today = NovaTime.dateKey();
  boot({ session: adminSession, rows: [row(), row('pasada', { date: NovaTime.addDays(today, -2) }), row('cancelada', { status: 'cancelled' }), row('hoy', { date: today, professionalId: 'laura', serviceId: 'corte-mujer' })] });
  change('#agenda-filter', 'all'); assert(all('.booking-card').length === 4, 'Todas');
  change('#agenda-filter', 'today'); assert(all('.booking-card').length === 1, 'Hoy');
  change('#professional-filter', 'carlos'); assert(all('.booking-card').length === 0, 'Profesional');
  change('#professional-filter', 'any'); click('[data-admin-tab="history"]');
  assert(all('.booking-card').length === 1 && all('[data-cancel-id]').length === 0, 'Canceladas no deben poder reactivarse');
});
test('Una profesional se asigna automáticamente y varios compatibles se pueden elegir', () => {
  boot({ session: adminSession }); choosePhone('balayage');
  assert($('#phone-professional').value === 'laura' && $('#phone-professional').disabled, 'No se asigna Laura');
  change('#phone-service', 'tinte-raiz');
  assert(!$('#phone-professional').disabled && all('#phone-professional option').length === 2, 'No ofrece profesionales compatibles');
  change('#phone-professional', 'maria');
  assert($('#phone-professional').value === 'maria', 'No cambia profesional');
});
test('Los 90 minutos deben caber completos y no pueden invadir la cita de las 11', () => {
  boot({ session: adminSession, rows: [row('color-previo', { professionalId: 'laura', serviceId: 'corte-mujer' })] });
  choosePhone('tinte-raiz');
  assert(all('#phone-time option').some(item => item.value === '540'), 'No ofrece 09:00');
  assert(!all('#phone-time option').some(item => item.value === '600'), 'Ofrece 10:00 y se solapa a las 11:00');
  assert(repository.creates.length === 0, 'Seleccionar no debe guardar');
});
test('Domingos, días pasados y días completos bloquean la creación', () => {
  boot({ session: adminSession }); choosePhone();
  let sunday = futureDate();
  while (NovaCore.parseDateKey(sunday).getDay() !== 0) sunday = NovaTime.addDays(sunday, 1);
  change('#phone-date', sunday);
  assert($('#phone-submit').disabled && $('#phone-availability').textContent.includes('Cerrado'), 'Domingo abierto');
  change('#phone-date', NovaTime.addDays(NovaTime.dateKey(), -1));
  assert($('#phone-submit').disabled && $('#phone-availability').textContent.includes('pasado'), 'Día pasado abierto');
  const date = futureDate();
  const hours = NovaData.business.hours[NovaCore.parseDateKey(date).getDay()];
  repository.rows = [row('dia-completo', { date, start: hours.start, end: hours.end, duration: hours.end - hours.start })];
  change('#phone-date', date);
  assert($('#phone-submit').disabled && $('#phone-availability').textContent.includes('Día completo'), 'Día lleno no identificado');
});
test('Nombre, teléfono y email se validan antes de insertar', () => {
  boot({ session: adminSession }); choosePhone(); submit('#phone-form');
  ['name', 'phone', 'email'].forEach(field => assert($('#phone-' + field).getAttribute('aria-invalid') === 'true', 'Falta error ' + field));
  assert(repository.creates.length === 0, 'Se guardan datos vacíos');
});
test('Crear cita telefónica de 30 minutos refresca agenda y limpia formulario', () => {
  boot({ session: adminSession }); choosePhone(); fillCustomer(); submit('#phone-form');
  assert(repository.creates.length === 1 && repository.rows[0].duration === 30 && repository.rows[0].source === 'phone', 'Creación incorrecta');
  assert($('#phone-feedback').textContent === 'Cita telefónica creada.', 'Falta éxito');
  assert($('#phone-name').value === '' && $('#phone-service').value === '', 'No limpia formulario');
  assert($('#stats-upcoming').textContent === '1', 'Agenda no actualizada');
  choosePhone();
  assert(!all('#phone-time option').some(item => item.value === String(repository.rows[0].start)), 'La cita nueva no bloquea el horario');
});
test('El rechazo por conflicto actualiza horas y conserva datos del cliente', () => {
  boot({ session: adminSession }); choosePhone('tinte-raiz'); fillCustomer();
  const selected = Number($('#phone-time').value);
  repository.rows.push(row('competidora', { professionalId: 'laura', serviceId: 'tinte-raiz', start: selected, end: selected + 90, duration: 90 }));
  repository.createError = failure('SLOT_UNAVAILABLE'); submit('#phone-form');
  assert($('#phone-feedback').textContent === 'Ese horario acaba de dejar de estar disponible.', 'Conflicto sin mensaje');
  assert($('#phone-name').value === 'Marina Prueba' && $('#phone-time').value === '', 'Pierde datos o mantiene hora ocupada');
  assert(!all('#phone-time option').some(item => item.value === String(selected)), 'No actualiza el hueco');
});
test('Una escritura confirmada conserva el éxito aunque falle la lectura posterior', () => {
  boot({ session: adminSession, failAfterCreate: true }); choosePhone(); fillCustomer(); submit('#phone-form');
  assert($('#phone-feedback').textContent === 'Cita telefónica creada.', 'Convierte éxito en error');
  assert($('#agenda-feedback').textContent === 'No se pudo conectar con la agenda.', 'No muestra fallo de refresco');
  assert($('#phone-name').value === '', 'No se limpia una creación confirmada');
});
test('Una respuesta de creación incierta bloquea reintentos automáticos y manuales', () => {
  boot({ session: adminSession }); choosePhone(); fillCustomer();
  repository.createError = failure('BOOKING_UNCERTAIN'); submit('#phone-form');
  assert($('#phone-submit').disabled && $('#phone-feedback').textContent.includes('evitar duplicados'), 'No bloquea duplicados');
  submit('#phone-form'); assert(repository.creates.length === 1, 'Reenvía una escritura incierta');
});
test('Cancelar exige confirmación; mantener cita no ejecuta UPDATE', () => {
  boot({ session: adminSession, rows: [row()] }); click('[data-cancel-id="prueba-1"]');
  assert($('#cancel-dialog').open && repository.cancellations.length === 0, 'Cancela antes de confirmar');
  click('#cancel-dismiss');
  assert(!$('#cancel-dialog').open && repository.cancellations.length === 0, 'Mantener cancela');
});
test('Confirmar cancelación conserva la fila y libera el intervalo', () => {
  boot({ session: adminSession, rows: [row()] }); click('[data-cancel-id="prueba-1"]'); click('#cancel-confirm');
  assert(repository.rows.length === 1 && repository.rows[0].status === 'cancelled', 'Borra o no cancela');
  assert($('#admin-notice').textContent === 'Cita cancelada.' && !$('#cancel-dialog').open, 'No confirma cancelación');
  choosePhone();
  assert(all('#phone-time option').some(item => item.value === '660'), 'No libera las 11:00');
});
test('Un error de cancelación no se presenta como éxito', () => {
  boot({ session: adminSession, rows: [row()] });
  repository.cancelError = failure('CANCEL_NOT_ALLOWED');
  click('[data-cancel-id="prueba-1"]'); click('#cancel-confirm');
  assert($('#cancel-dialog').open && $('#cancel-feedback').textContent.includes('No se pudo cancelar'), 'Error no visible');
  assert(repository.rows[0].status === 'confirmed' && !$('#cancel-dismiss').disabled, 'No permite salir o inventa cancelación');
});
test('Los errores de red tienen recuperación y no exponen detalles privados', () => {
  boot({ session: adminSession }); repository.readError = failure('CONNECTION_ERROR'); click('#refresh-agenda');
  assert($('#agenda-feedback').textContent === 'No se pudo conectar con la agenda.', 'Error sin sanear');
  repository.readError = null; click('#refresh-agenda');
  assert($('#agenda-feedback').textContent.includes('actualizada'), 'No recupera');
});
test('Un fallo al comprobar sesión mantiene acceso y botón de reintento', () => {
  boot({ authError: failure('CONNECTION_ERROR') });
  assert(!$('#login-form').hidden && !$('#auth-retry').hidden && $('#dashboard').hidden, 'Pantalla en blanco');
  repository.authError = null; click('#auth-retry');
  assert(!$('#login-form').hidden && repository.reads === 0, 'Reintento sin sesión lee clientes');
});
test('Se escapan los datos del cliente antes de crear tarjetas y enlaces', () => {
  boot({ session: adminSession, rows: [row('html', { customer: { name: '<img src=x onerror=alert(1)>', phone: '+34 612 345 678', email: 'a?subject=injected@prueba.example' } })] });
  assert(all('#agenda-list img, #agenda-list script').length === 0, 'Inyección HTML');
  assert($('#agenda-list').innerHTML.includes('&lt;img'), 'No escapa nombre');
  assert(!$('#agenda-list a[href^="mailto:"]').getAttribute('href').includes('?subject='), 'Inyección mailto');
});
test('Una respuesta de horas antigua no reemplaza la selección más reciente', () => {
  boot({ session: adminSession }); choosePhone(); repository.deferTimes = true;
  change('#phone-date', NovaTime.addDays(futureDate(), 2));
  const old = repository.pendingTimes.shift();
  change('#phone-date', futureDate()); const recent = repository.pendingTimes.shift();
  recent.resolve(recent.result); drainMicrotasks();
  const html = $('#phone-time').innerHTML;
  old.resolve({ status: 'full', slots: [] }); drainMicrotasks();
  assert($('#phone-time').innerHTML === html, 'Respuesta vieja sobrescribe');
});
test('Una renovación de token retira datos mientras vuelve a autorizar', () => {
  boot({ session: adminSession, rows: [row()] });
  repository.emit('TOKEN_REFRESHED', { user: adminSession.user, access_token: 'token-renovado-fixture' });
  assert($('#dashboard').hidden && $('#agenda-list').textContent === '', 'No retira datos al renovar');
  NovaTestEnvironment.runTimeouts(0); drainMicrotasks();
  assert(!$('#dashboard').hidden && repository.rpcs >= 2, 'No reautoriza tras renovación');
});
test('La revocación detectada en una consulta retira todo el panel', () => {
  boot({ session: adminSession, rows: [row()] });
  repository.readError = failure('FORBIDDEN'); click('#refresh-agenda');
  assert($('#dashboard').hidden && $('#agenda-list').textContent === '', 'Mantiene datos sin permiso');
  assert($('#login-feedback').textContent === 'Esta cuenta no está autorizada para administrar NOVA.', 'No comunica revocación');
});
test('Un cierre de sesión fallido no permite reabrir el panel al renovar el token', () => {
  boot({ session: adminSession, rows: [row()], signOutFails: true }); click('#logout-button');
  assert($('#dashboard').hidden && !$('#auth-retry').hidden, 'No cierra el panel tras fallo');
  repository.emit('TOKEN_REFRESHED', adminSession);
  NovaTestEnvironment.runTimeouts(0); drainMicrotasks();
  assert($('#dashboard').hidden && $('#agenda-list').textContent === '', 'Reabre sin intención de iniciar sesión');
  login(); assert(!$('#dashboard').hidden, 'No permite volver con un login explícito');
});
test('Volver con BFcache durante Auth pendiente inicia una comprobación nueva', () => {
  boot({ deferSession: true });
  dispatchEvent(new Event('pagehide')); dispatchEvent(new Event('pageshow', { persisted: true })); drainMicrotasks();
  assert(repository.pendingSessions.length === 2, 'No inicia nueva comprobación');
  repository.pendingSessions[0](null); drainMicrotasks();
  assert($('#login-form').hidden, 'Respuesta antigua cambia la nueva carga');
  repository.pendingSessions[1](null); drainMicrotasks();
  assert(!$('#login-form').hidden && $('#dashboard').hidden, 'Pantalla bloqueada al volver');
});
test('Reintentar tras fallar el observador vuelve a registrarlo antes de abrir', () => {
  boot({ session: adminSession, subscriptionFailsOnce: true });
  assert($('#dashboard').hidden && !$('#auth-retry').hidden, 'Abre sin observador');
  click('#auth-retry');
  assert(repository.subscriptions === 2 && !$('#dashboard').hidden, 'No reintenta suscripción');
  repository.emit('SIGNED_OUT', null);
  assert($('#dashboard').hidden, 'No escucha cierre de sesión tras recuperar');
});
test('El refresco automático mantiene el foco de teclado en la misma acción', () => {
  boot({ session: adminSession, rows: [row()] });
  const previous = $('[data-cancel-id="prueba-1"]'); previous.focus();
  NovaTestEnvironment.tickIntervals(30000); drainMicrotasks();
  assert(document.activeElement === $('[data-cancel-id="prueba-1"]') && document.activeElement !== previous, 'Se pierde el foco al refrescar');
});
print('\n' + passed + '/' + passed + ' pruebas de interfaz administrativa superadas.');
