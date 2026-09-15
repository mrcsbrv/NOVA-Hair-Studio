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
function blockRow(id = 'bloque-prueba', overrides = {}) {
  return {
    id, professionalId: 'laura', kind: 'absence', reason: 'Motivo privado de prueba', active: true,
    startAt: NovaTime.toInstant(futureDate(), 720).toISOString(),
    endAt: NovaTime.toInstant(futureDate(), 900).toISOString(), ...overrides
  };
}
function normalizedBlock(input) {
  const minute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return {
    ...input, professionalId: input.professionalId === 'all' ? null : input.professionalId,
    startAt: NovaTime.toInstant(input.startDate, input.allDay ? 0 : minute(input.startTime)).toISOString(),
    endAt: NovaTime.toInstant(input.allDay ? NovaTime.addDays(input.endDate, 1) : input.endDate, input.allDay ? 0 : minute(input.endTime)).toISOString(), active: true
  };
}
function blockIntervals(blocks, date) {
  const range = NovaTime.dayRange(date);
  const minute = value => {
    const parts = NovaTime.parts(new Date(value));
    return parts.hour * 60 + parts.minute + parts.second / 60;
  };
  return blocks.filter(item => item.active && item.startAt < range.endAt && item.endAt > range.startAt).map(item => ({
    professionalId: item.professionalId, date,
    start: item.startAt <= range.startAt ? 0 : minute(item.startAt),
    end: item.endAt >= range.endAt ? 1440 : minute(item.endAt)
  }));
}
function fakeRepository(options = {}) {
  let observer;
  let allowed = false;
  const repo = {
    session: options.session || null, rows: options.rows || [], blocks: options.blocks || [], permitted: options.permitted !== false,
    reads: 0, rpcs: 0, signouts: 0, creates: [], cancellations: [], pending: [], pendingTimes: [],
    readError: null, createError: null, cancelError: null, authError: options.authError,
    deferRead: false, deferTimes: false, pendingSessions: [], subscriptions: 0,
    blockReads: 0, blockPrepares: [], blockCreates: [], blockDeactivations: [], pendingBlocks: [], pendingBlockCreates: [],
    blockReadError: null, blockPrepareError: null, blockCreateError: null, blockDeactivateError: null,
    deferBlocks: false, deferBlockCreate: false,
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
      const result = NovaCore.getAvailability({ ...input, bookings: repo.rows.filter(item => item.status === 'confirmed'), blocks: blockIntervals(repo.blocks, input.date) });
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
    },
    listBlocks() {
      assert(allowed && repo.session, 'Bloqueos privados consultados antes del permiso');
      repo.blockReads += 1;
      if (repo.deferBlocks) return new Promise((resolve, reject) => repo.pendingBlocks.push({ resolve, reject }));
      if (repo.blockReadError) return Promise.reject(repo.blockReadError);
      return Promise.resolve(repo.blocks.filter(item => item.active).map(item => ({ ...item })));
    },
    async prepareBlock(input) {
      assert(allowed && repo.session, 'Impacto consultado antes del permiso');
      repo.blockPrepares.push({ ...input });
      if (repo.blockPrepareError) throw repo.blockPrepareError;
      const block = normalizedBlock(input);
      const affectedBookings = repo.rows.filter(item => item.status === 'confirmed' &&
        (block.professionalId === null || item.professionalId === block.professionalId) &&
        item.startAt < block.endAt && item.endAt > block.startAt);
      return { block, affectedBookings };
    },
    async createBlock(input, confirmation = {}) {
      assert(allowed && repo.session, 'Bloqueo creado antes del permiso');
      repo.blockCreates.push({ input: { ...input }, confirmation });
      if (repo.deferBlockCreate) return new Promise((resolve, reject) => repo.pendingBlockCreates.push({ resolve, reject }));
      if (repo.blockCreateError) throw repo.blockCreateError;
      const block = { ...normalizedBlock(input), id: 'creado-' + repo.blockCreates.length };
      repo.blocks.push(block);
      if (options.failAfterBlockCreate) repo.blockReadError = failure('CONNECTION_ERROR');
      return block;
    },
    async deactivateBlock(id) {
      assert(allowed && repo.session, 'Bloqueo eliminado antes del permiso');
      repo.blockDeactivations.push(id);
      if (repo.blockDeactivateError) throw repo.blockDeactivateError;
      repo.blocks.find(item => String(item.id) === String(id)).active = false;
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
function chooseBlock(overrides = {}) {
  click('[data-admin-tab="availability"]');
  const input = {
    professional: 'laura', kind: 'absence', 'start-date': futureDate(), 'start-time': '12:00',
    'end-date': futureDate(), 'end-time': '15:00', reason: 'Motivo privado de prueba', ...overrides
  };
  Object.keys(input).forEach(field => change('#block-' + field, input[field]));
}
function setAllDay(value) {
  $('#block-all-day').checked = value;
  $('#block-all-day').dispatchEvent(new Event('change', { bubbles: true }));
  drainMicrotasks();
}

test('Sin sesión solo aparece el acceso, sin consultar permisos ni datos privados', () => {
  boot();
  assert(!$('#login-form').hidden && $('#dashboard').hidden, 'Pantalla de acceso incorrecta');
  assert(repository.rpcs === 0 && repository.reads === 0 && repository.blockReads === 0, 'Se consultan datos antes de autenticarse');
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
  assert(repository.signouts === 1 && repository.reads === 0 && repository.blockReads === 0, 'Cuenta sin permisos ha leído datos privados');
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

test('Disponibilidad abre una vista propia sin ocultar la navegación anterior', () => {
  boot({ session: adminSession }); click('[data-admin-tab="availability"]');
  assert(!$('#availability-view').hidden && $('#agenda-view').hidden && $('#phone-view').hidden, 'Las vistas se mezclan');
  assert($('[data-admin-tab="availability"]').getAttribute('aria-pressed') === 'true', 'No anuncia la sección seleccionada');
  assert(repository.blockReads > 0 && !$('#blocks-empty').hidden, 'No carga la lista vacía');
  click('[data-admin-tab="agenda"]');
  assert($('#availability-view').hidden && !$('#agenda-view').hidden, 'No vuelve a la agenda');
});
test('La lista activa distingue profesional, salón completo, tipo y motivo privado', () => {
  boot({ session: adminSession, blocks: [blockRow(), blockRow('cierre', { professionalId: null, kind: 'closed', reason: '' }), blockRow('inactivo', { active: false })] });
  click('[data-admin-tab="availability"]');
  assert(all('[data-block-id]').length === 2 && $('#blocks-empty').hidden, 'Incluye bloques inactivos o pierde activos');
  assert($('#blocks-list').textContent.includes('Laura') && $('#blocks-list').textContent.includes('Todo el salón'), 'No indica a quién afecta');
  assert($('#blocks-list').textContent.includes('Ausencia') && $('#blocks-list').textContent.includes('Cierre'), 'Tipos sin traducir');
  assert($('#blocks-list').textContent.includes('Motivo privado de prueba'), 'Motivo no disponible para el administrador');
});
test('Crear una ausencia parcial valida impacto, conserva el intervalo y actualiza la lista', () => {
  boot({ session: adminSession }); chooseBlock(); submit('#block-form');
  assert(repository.blockPrepares.length === 1 && repository.blockCreates.length === 1, 'No comprueba y guarda una sola vez');
  const input = repository.blockCreates[0].input;
  assert(input.professionalId === 'laura' && input.kind === 'absence' && input.startTime === '12:00' && input.endTime === '15:00', 'Entrada de ausencia incorrecta');
  assert(input.startDate === futureDate() && input.endDate === futureDate() && !input.allDay, 'Pierde fecha o inventa día completo');
  assert(repository.blocks[0].startAt === NovaTime.toInstant(futureDate(), 720).toISOString(), 'No interpreta Madrid');
  assert($('#blocks-list').textContent.includes('Motivo privado de prueba'), 'La lista no se actualiza');
  assert($('#block-reason').value === '', 'No limpia el motivo tras guardar');
  assert($('#block-form-feedback').textContent.includes('Disponibilidad actualizada'), 'No muestra éxito');
  assert(repository.cancellations.length === 0, 'La ausencia cancela citas');
});
test('Día completo simplifica horas y vacaciones admite fecha final inclusiva', () => {
  boot({ session: adminSession }); chooseBlock({ kind: 'vacation', 'end-date': NovaTime.addDays(futureDate(), 4) });
  setAllDay(true);
  assert($('#block-start-time').disabled && $('#block-end-time').disabled, 'Las horas siguen siendo obligatorias al bloquear el día');
  submit('#block-form');
  const input = repository.blockCreates[0].input;
  assert(input.allDay && input.kind === 'vacation', 'Pierde opción de días completos');
  assert(input.endDate === NovaTime.addDays(futureDate(), 4), 'No permite varios días');
  assert(repository.blocks[0].startAt === NovaTime.toInstant(futureDate(), 0).toISOString(), 'Inicio de día incorrecto');
  assert(repository.blocks[0].endAt === NovaTime.toInstant(NovaTime.addDays(futureDate(), 5), 0).toISOString(), 'No incluye completo el último día');
});
test('Todo el salón envía un profesional nulo y conserva el tipo cierre', () => {
  boot({ session: adminSession }); chooseBlock({ professional: 'all', kind: 'closed', reason: '' });
  setAllDay(true); submit('#block-form');
  assert(repository.blockCreates[0].input.professionalId === null, 'No usa null para todo el salón');
  assert(repository.blocks[0].kind === 'closed' && repository.blocks[0].reason === '', 'Pierde cierre o exige motivo');
});
test('Un intervalo rechazado por el repositorio tiene error accesible y no se guarda', () => {
  boot({ session: adminSession }); chooseBlock({ 'start-time': '15:00', 'end-time': '12:00' });
  repository.blockPrepareError = Object.assign(failure('BLOCK_VALIDATION_ERROR'), { fields: { endDate: 'El final debe ser posterior al inicio.' } });
  submit('#block-form');
  assert(repository.blockCreates.length === 0, 'Guarda un intervalo rechazado');
  assert(all('#block-form [aria-invalid="true"]').length > 0, 'No identifica el campo incorrecto');
  assert(document.activeElement.closest('#block-form'), 'No enfoca el error de formulario');
});
test('Las fechas vacías y un motivo demasiado largo se rechazan sin guardar', () => {
  boot({ session: adminSession }); chooseBlock({ 'start-date': '', reason: 'x'.repeat(501) });
  repository.blockPrepareError = Object.assign(failure('BLOCK_VALIDATION_ERROR'), { fields: { startDate: 'Introduce una fecha válida.', reason: 'El motivo debe tener como máximo 500 caracteres.' } });
  submit('#block-form');
  assert(repository.blockCreates.length === 0, 'Guarda un formulario rechazado');
  assert($('#block-start-date').getAttribute('aria-invalid') === 'true', 'Fecha vacía sin error');
  assert($('#block-reason').getAttribute('aria-invalid') === 'true', 'No valida límite del motivo');
});
test('Las citas afectadas se explican y Volver no crea ni cancela nada', () => {
  boot({ session: adminSession, rows: [row('afectada', { professionalId: 'laura', serviceId: 'corte-mujer', start: 750, end: 795, duration: 45 })] });
  chooseBlock(); submit('#block-form');
  assert($('#block-impact-dialog').open && repository.blockCreates.length === 0, 'Guarda antes de advertir');
  assert($('#block-impact-message').textContent.includes('1') && $('#block-impact-message').textContent.includes('cita'), 'No explica cantidad');
  const text = $('#block-impact-list').textContent;
  assert(text.includes('Laura') && text.includes('Corte mujer') && text.includes('Álex Prueba') && text.includes('12:30'), 'Aviso sin detalles de la cita');
  click('#block-impact-back');
  assert(!$('#block-impact-dialog').open && repository.blockCreates.length === 0 && repository.cancellations.length === 0, 'Volver cambia datos');
  assert($('#block-reason').value === 'Motivo privado de prueba', 'Volver pierde formulario');
});
test('Crear igualmente reconoce las citas mostradas y mantiene sus reservas', () => {
  boot({ session: adminSession, rows: [row('afectada', { professionalId: 'laura', start: 750, end: 780 })] });
  chooseBlock(); submit('#block-form'); click('#block-impact-confirm');
  const sent = repository.blockCreates[0];
  assert(sent.confirmation.acknowledgedBookingIds.length === 1 && sent.confirmation.acknowledgedBookingIds[0] === 'afectada', 'No identifica el impacto confirmado');
  assert(repository.rows[0].status === 'confirmed' && repository.cancellations.length === 0, 'Cancela automáticamente una cita');
  assert(repository.blocks.length === 1 && !$('#block-impact-dialog').open, 'No termina la creación');
});
test('Una cita nueva durante la creación obliga a revisar de nuevo el impacto', () => {
  boot({ session: adminSession }); chooseBlock();
  const affected = row('reciente', { professionalId: 'laura', start: 750, end: 780 });
  repository.blockCreateError = Object.assign(failure('AFFECTED_BOOKINGS'), { affectedBookings: [affected], block: blockRow() });
  submit('#block-form');
  assert($('#block-impact-dialog').open && $('#block-impact-list').textContent.includes('Álex Prueba'), 'No muestra la nueva cita afectada');
  assert(repository.blocks.length === 0 && repository.cancellations.length === 0, 'Guarda o cancela sin nuevo consentimiento');
  repository.blockCreateError = null;
  click('#block-impact-confirm');
  assert(repository.blockCreates[1].confirmation.acknowledgedBookingIds[0] === 'reciente', 'No actualiza citas reconocidas');
  assert(repository.blocks.length === 1, 'No guarda tras revisar el impacto nuevo');
});
test('Eliminar bloqueo pide confirmación y Volver conserva el bloqueo activo', () => {
  boot({ session: adminSession, blocks: [blockRow()] }); click('[data-admin-tab="availability"]');
  click('[data-remove-block="bloque-prueba"]');
  assert($('#block-remove-dialog').open && repository.blockDeactivations.length === 0, 'Elimina sin confirmar');
  assert($('#block-remove-description').textContent.includes('Laura'), 'Confirmación no identifica el bloqueo');
  click('#block-remove-back');
  assert(repository.blocks[0].active && repository.blockDeactivations.length === 0, 'Volver elimina');
});
test('Confirmar eliminación desactiva sin borrar ni cancelar citas', () => {
  boot({ session: adminSession, blocks: [blockRow()] }); click('[data-admin-tab="availability"]');
  click('[data-remove-block="bloque-prueba"]'); click('#block-remove-confirm');
  assert(repository.blocks.length === 1 && !repository.blocks[0].active, 'No conserva el historial inactivo');
  assert(repository.blockDeactivations[0] === 'bloque-prueba' && repository.cancellations.length === 0, 'Acción incorrecta');
  assert(!$('#block-remove-dialog').open && !$('#blocks-empty').hidden, 'No actualiza lista tras eliminar');
  assert($('#blocks-feedback').textContent.includes('Bloqueo eliminado') || $('#admin-notice').textContent.includes('Bloqueo eliminado'), 'No comunica eliminación');
});
test('El fallo de eliminación mantiene el diálogo recuperable y el bloqueo activo', () => {
  boot({ session: adminSession, blocks: [blockRow()] }); click('[data-admin-tab="availability"]');
  repository.blockDeactivateError = failure('CONNECTION_ERROR');
  click('[data-remove-block="bloque-prueba"]'); click('#block-remove-confirm');
  assert($('#block-remove-dialog').open && repository.blocks[0].active, 'Inventa eliminación');
  assert($('#block-remove-feedback').textContent.includes('No se pudo') && !$('#block-remove-back').disabled, 'Error sin recuperación');
  assert(!$('#block-remove-feedback').textContent.includes('Detalle privado'), 'Muestra detalles del servidor');
});
test('Los estados de carga y error de disponibilidad permiten reintentar sin filtrar detalles', () => {
  boot({ session: adminSession }); repository.deferBlocks = true; click('[data-admin-tab="availability"]');
  assert($('#blocks-feedback').textContent.includes('Cargando disponibilidad') && $('#refresh-blocks').disabled, 'Carga sin estado o permite duplicarla');
  repository.pendingBlocks.shift().reject(failure('CONNECTION_ERROR')); drainMicrotasks();
  assert($('#blocks-feedback').textContent === 'No se pudo actualizar la disponibilidad.', 'Error no saneado');
  assert(!$('#refresh-blocks').disabled, 'No permite reintentar');
  repository.deferBlocks = false; click('#refresh-blocks');
  assert(!$('#blocks-empty').hidden && !$('#blocks-feedback').textContent.includes('No se pudo'), 'No recupera lista');
});
test('Fallar al comprobar impacto conserva el formulario y no crea el bloqueo', () => {
  boot({ session: adminSession }); chooseBlock(); repository.blockPrepareError = failure('CONNECTION_ERROR'); submit('#block-form');
  assert(repository.blockCreates.length === 0 && $('#block-reason').value === 'Motivo privado de prueba', 'Guarda sin impacto o pierde formulario');
  assert($('#block-form-feedback').textContent === 'No se pudo actualizar la disponibilidad.' && !$('#block-submit').disabled, 'No permite corregir o reintentar');
});
test('Los motivos del administrador se escapan antes de renderizar HTML', () => {
  boot({ session: adminSession, blocks: [blockRow('texto-html', { reason: '<img src=x onerror=alert(1)><script>privado()</script>' })] });
  click('[data-admin-tab="availability"]');
  assert(all('#blocks-list img, #blocks-list script').length === 0, 'Inyección en motivo');
  assert($('#blocks-list').innerHTML.includes('&lt;img'), 'No representa el motivo como texto');
});
test('Cerrar sesión borra motivos, listas y diálogos privados de impacto', () => {
  boot({ session: adminSession, blocks: [blockRow()], rows: [row('afectada', { professionalId: 'laura', start: 750, end: 780 })] });
  chooseBlock(); submit('#block-form');
  repository.emit('SIGNED_OUT', null);
  assert($('#dashboard').hidden && $('#blocks-list').textContent === '' && $('#block-reason').value === '', 'Mantiene motivos tras salir');
  assert(!$('#block-impact-dialog').open && !$('#block-remove-dialog').open, 'Deja diálogo privado abierto');
  assert($('#block-impact-list').textContent === '' && $('#block-remove-description').textContent === '', 'Conserva datos en diálogos ocultos');
});
test('Una lectura de bloques pendiente no restaura datos tras cerrar sesión', () => {
  boot({ session: adminSession }); repository.deferBlocks = true; click('[data-admin-tab="availability"]');
  const pending = repository.pendingBlocks.shift(); repository.emit('SIGNED_OUT', null);
  pending.resolve([blockRow()]); drainMicrotasks();
  assert($('#dashboard').hidden && $('#blocks-list').textContent === '', 'La respuesta antigua vuelve a mostrar motivos');
});
test('Una escritura pendiente tampoco reabre el panel después de salir', () => {
  boot({ session: adminSession }); chooseBlock(); repository.deferBlockCreate = true; submit('#block-form');
  const pending = repository.pendingBlockCreates.shift(); assert(pending, 'No alcanza la escritura pendiente');
  repository.emit('SIGNED_OUT', null); pending.resolve(blockRow()); drainMicrotasks();
  assert($('#dashboard').hidden && $('#block-form-feedback').textContent === '' && $('#blocks-list').textContent === '', 'La respuesta tardía publica datos o éxito privado');
});
test('Perder autorización en bloques retira también la agenda y los datos del formulario', () => {
  boot({ session: adminSession, rows: [row()] }); chooseBlock(); repository.blockReadError = failure('FORBIDDEN'); click('#refresh-blocks');
  assert($('#dashboard').hidden && $('#agenda-list').textContent === '' && $('#block-reason').value === '', 'Deja datos tras revocación');
  assert($('#login-feedback').textContent === 'Esta cuenta no está autorizada para administrar NOVA.', 'Revocación sin explicación');
});
test('La cita telefónica descarta un servicio largo que invade parcialmente un bloque', () => {
  let date = futureDate();
  while ([0, 6].includes(NovaCore.parseDateKey(date).getDay())) date = NovaTime.addDays(date, 1);
  boot({ session: adminSession, blocks: [blockRow('parcial', {
    startAt: NovaTime.toInstant(date, 720).toISOString(), endAt: NovaTime.toInstant(date, 900).toISOString()
  })] }); choosePhone('color-completo', date);
  const offered = all('#phone-time option').map(item => item.value);
  assert(offered.includes('600') && !offered.includes('630') && !offered.includes('720') && offered.includes('900'), 'No exige 120 minutos libres antes o después del bloqueo');
});
test('La ausencia de Laura no impide elegir a María para una cita telefónica', () => {
  const date = futureDate();
  boot({ session: adminSession, blocks: [blockRow('dia-laura', { startAt: NovaTime.dayRange(date).startAt, endAt: NovaTime.dayRange(date).endAt })] });
  choosePhone('tinte-raiz');
  assert($('#phone-submit').disabled && $('#phone-availability').textContent.includes('Día completo'), 'Laura ofrece horas durante su ausencia');
  change('#phone-professional', 'maria');
  assert(all('#phone-time option').length > 1, 'La ausencia de Laura bloquea también a María');
});
test('El cierre de todo el salón impide horas telefónicas y eliminarlo las devuelve', () => {
  const date = futureDate();
  boot({ session: adminSession, blocks: [blockRow('salon', { professionalId: null, startAt: NovaTime.dayRange(date).startAt, endAt: NovaTime.dayRange(date).endAt })] });
  choosePhone();
  assert($('#phone-submit').disabled && all('#phone-time option').length === 1, 'Carlos ofrece citas durante el cierre');
  click('[data-admin-tab="availability"]'); click('[data-remove-block="salon"]'); click('#block-remove-confirm');
  choosePhone();
  assert(all('#phone-time option').length > 1, 'No libera las horas telefónicas');
});
test('Una creación de bloqueo incierta impide repetir la escritura', () => {
  boot({ session: adminSession }); chooseBlock();
  repository.blockCreateError = failure('BLOCK_UNCERTAIN'); submit('#block-form');
  assert($('#block-submit').disabled && $('#block-form-feedback').textContent.includes('evitar duplicados'), 'No bloquea duplicados');
  submit('#block-form');
  assert(repository.blockCreates.length === 1 && $('#block-reason').value === 'Motivo privado de prueba', 'Reenvía o pierde los datos pendientes');
});
test('Un bloqueo guardado conserva el éxito si falla el refresco posterior', () => {
  boot({ session: adminSession, failAfterBlockCreate: true }); chooseBlock(); submit('#block-form');
  assert($('#block-form-feedback').textContent === 'Disponibilidad actualizada.', 'Convierte una escritura confirmada en fallo');
  assert($('#blocks-feedback').textContent === 'No se pudo actualizar la disponibilidad.', 'Oculta fallo de lectura');
  assert($('#block-reason').value === '' && !$('#refresh-blocks').disabled, 'No limpia o no permite refrescar');
});
test('Guardar un bloqueo deja operativas las acciones anteriores de agenda', () => {
  boot({ session: adminSession, rows: [row()] }); chooseBlock(); submit('#block-form');
  click('[data-admin-tab="agenda"]');
  assert(!$('#refresh-agenda').disabled && !$('[data-cancel-id="prueba-1"]').disabled, 'La agenda se queda bloqueada tras guardar');
  click('#refresh-agenda'); click('[data-cancel-id="prueba-1"]');
  assert($('#cancel-dialog').open, 'Cancelar cita deja de funcionar tras guardar bloqueo');
});
print('\n' + passed + '/' + passed + ' pruebas de interfaz administrativa superadas.');
