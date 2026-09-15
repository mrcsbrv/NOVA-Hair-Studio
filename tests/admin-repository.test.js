/* Contratos privados con SDK simulado: no red, no credenciales ni datos reales. */
(function () {
  'use strict';
  var output = typeof print === 'function' ? print : console.log.bind(console);
  function readScript(path) {
    if (typeof load === 'function') load(path);
    else { var resolved = require.resolve('../' + path); delete require.cache[resolved]; require(resolved); }
  }
  readScript('data.js'); readScript('salon-time.js'); readScript('booking-core.js');
  var tests = [];
  var now = new Date('2030-01-07T07:00:00Z');
  var date = '2030-01-07';
  var customer = { name: 'Álex Prueba', phone: '+34 612 345 678', email: 'alex@prueba.example' };
  var columns = 'id,service_id,professional_id,start_at,end_at,customer_name,customer_phone,customer_email,source,status,created_at';
  function test(name, run) { tests.push({ name: name, run: run }); }
  function assert(value, message) { if (!value) throw new Error(message || 'Condición incorrecta.'); }
  function equal(actual, expected) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Resultado distinto.'); }
  async function rejects(operation, code) {
    try { await operation(); } catch (error) { equal(error.code, code); return error; }
    throw new Error('Falta rechazo ' + code);
  }
  function deferred() { var resolve; var promise = new Promise(function (done) { resolve = done; }); return { promise: promise, resolve: resolve }; }
  function session(user) { return { user: { id: user || 'admin-test' }, access_token: 'token-test-' + (user || 'admin'), expires_at: 2000000000 }; }
  function input(overrides) {
    return Object.assign({ serviceId: 'corte-caballero', professionalId: 'carlos', date: date, start: 540, customer: Object.assign({}, customer) }, overrides || {});
  }
  function row(id, professional, start, duration, extra) {
    return Object.assign({
      id: id, service_id: 'corte-caballero', professional_id: professional || 'carlos',
      start_at: NovaTime.toInstant(date, start || 540).toISOString(), end_at: NovaTime.toInstant(date, (start || 540) + (duration || 30)).toISOString(),
      customer_name: customer.name, customer_phone: customer.phone, customer_email: customer.email,
      status: 'confirmed', source: 'online', created_at: '2030-01-06T10:00:00Z'
    }, extra || {});
  }
  function setup(options) {
    options = options || {};
    readScript('supabase-repository.js'); readScript('admin-repository.js');
    var state = {
      rows: options.rows || [], session: options.session === undefined ? session() : options.session,
      admin: options.admin === undefined ? true : options.admin, clients: [], calls: [], events: [], callbacks: [],
      signouts: 0, reads: 0, inserts: 0, updates: 0, rpc: 0, privateAllowed: false
    };
    state.emit = function (event, nextSession) {
      state.session = nextSession;
      state.callbacks.slice().forEach(function (callback) { callback(event, nextSession); });
    };
    var sdk = { createClient: function (_, __, settings) {
      state.clients.push(settings);
      return {
        auth: {
          getSession: function () {
            state.events.push('session');
            if (options.onSession) { var custom = options.onSession(state); if (custom !== undefined) return custom; }
            return Promise.resolve({ data: { session: state.session }, error: null });
          },
          signInWithPassword: function (credentials) {
            assert(Object.keys(credentials).sort().join(',') === 'email,password');
            if (options.loginError) return Promise.resolve({ error: { status: 400, code: 'invalid_credentials', message: 'privado@example.com' } });
            if (options.onLogin) return options.onLogin(state);
            state.emit('SIGNED_IN', session());
            return Promise.resolve({ data: { session: state.session }, error: null });
          },
          signOut: function (settings) { equal(settings, { scope: 'local' }); state.signouts += 1; state.privateAllowed = false; state.emit('SIGNED_OUT', null); return Promise.resolve({ error: null }); },
          onAuthStateChange: function (callback) {
            state.callbacks.push(callback);
            return { data: { subscription: { unsubscribe: function () { state.callbacks = state.callbacks.filter(function (item) { return item !== callback; }); } } } };
          }
        },
        rpc: function (name) {
          equal(name, 'nova_is_admin'); state.rpc += 1; state.events.push('rpc');
          if (options.onRPC) return options.onRPC(state);
          state.privateAllowed = !!state.session && state.admin === true;
          return Promise.resolve({ data: state.admin, status: 200, error: null });
        },
        from: function (table) {
          equal(table, 'nova_bookings');
          var call = { filters: [], orders: [] }; state.calls.push(call);
          var builder = {
            select: function (selection, settings) { assert(!call.insert, 'INSERT devuelve columnas.'); call.select = selection; call.settings = settings; return builder; },
            insert: function (payload) { call.insert = payload; return builder; },
            update: function (payload) { call.update = payload; return builder; },
            eq: function (key, value) { call.filters.push(['eq', key, value]); return builder; },
            lt: function (key, value) { call.filters.push(['lt', key, value]); return builder; },
            gt: function (key, value) { call.filters.push(['gt', key, value]); return builder; },
            order: function (key) { call.orders.push(key); return builder; },
            range: function (first, last) { call.range = [first, last]; return builder; },
            retry: function (retry) { call.retry = retry; return builder; },
            abortSignal: function () { return builder; },
            then: function (resolve, reject) {
              return Promise.resolve().then(function () {
                if (call.select === columns || call.insert || call.update) assert(state.privateAllowed, 'Operación privada antes de Auth y RPC true.');
                if (call.insert) {
                  state.inserts += 1;
                  if (options.onInsert) return options.onInsert(call, state);
                  var service = NovaData.services.find(function (item) { return (item.supabaseId === undefined ? item.id : item.supabaseId) === call.insert.service_id; });
                  state.rows.push(Object.assign({}, call.insert, {
                    id: 'created-' + state.inserts, status: 'confirmed', created_at: now.toISOString(),
                    end_at: new Date(Date.parse(call.insert.start_at) + service.duration * 60000).toISOString()
                  }));
                  return { data: null, error: null, status: 201 };
                }
                if (call.update) {
                  state.updates += 1;
                  if (options.onUpdate) return options.onUpdate(call, state);
                  var matching = state.rows.filter(function (item) { return String(item.id) === String(call.filters[0][2]); });
                  matching.forEach(function (item) { item.status = call.update.status; });
                  return { data: matching.map(function (item) { return { id: item.id }; }), status: 200, error: null };
                }
                state.events.push('read'); state.reads += 1;
                if (options.onRead) { var custom = options.onRead(call, state); if (custom !== undefined) return custom; }
                var rows = state.rows.filter(function (item) {
                  return call.filters.every(function (filter) {
                    if (filter[0] === 'eq') return item[filter[1]] === filter[2];
                    if (filter[0] === 'lt') return Date.parse(item[filter[1]]) < Date.parse(filter[2]);
                    return Date.parse(item[filter[1]]) > Date.parse(filter[2]);
                  });
                }).slice().sort(function (a, b) { return Date.parse(a.start_at) - Date.parse(b.start_at) || String(a.id).localeCompare(String(b.id)); });
                return { data: rows.slice(call.range[0], call.range[0] + Math.min(options.pageLimit || 200, call.range[1] - call.range[0] + 1)), count: rows.length, status: 200 };
              }).then(resolve, reject);
            }
          };
          return builder;
        }
      };
    } };
    state.sdk = sdk;
    state.settings = { url: 'https://nova-demo.supabase.co', publishableKey: 'sb_publishable_demo_only', sdk: sdk, now: function () { return new Date(now); } };
    state.repo = NovaAdmin.createRepository(state.settings);
    return state;
  }

  test('Sin sesión no se consulta ni una columna privada', async function () {
    var state = setup({ session: null });
    equal(await state.repo.getSession(), null);
    await rejects(function () { return state.repo.listBookings(); }, 'AUTH_REQUIRED');
    await rejects(function () { return state.repo.cancelBooking('a'); }, 'AUTH_REQUIRED');
    equal(state.calls.length, 0); equal(state.rpc, 0);
  });
  test('Contraseña incorrecta se maneja sin detalles privados', async function () {
    var state = setup({ session: null, loginError: true });
    var error = await rejects(function () { return state.repo.signIn('prueba@example.com', 'incorrecta'); }, 'INVALID_CREDENTIALS');
    assert(!error.message.includes('privado@')); equal(state.calls.length, 0);
  });
  test('Usuario no administrador cierra sesión y nunca lee reservas', async function () {
    var state = setup({ admin: false });
    equal(await state.repo.authorize(await state.repo.getSession()), false);
    equal(state.signouts, 1); equal(state.session, null); equal(state.calls.length, 0);
  });
  test('La RPC debe devolver true booleano, no valores aproximados', async function () {
    for (var value of ['true', 1, null, { is_admin: true }]) {
      var state = setup({ admin: value });
      equal(await state.repo.authorize(await state.repo.getSession()), false);
      equal(state.signouts, 1); equal(state.calls.length, 0);
    }
  });
  test('Login válido solo concede panel después de RPC', async function () {
    var state = setup({ session: null });
    var unsubscribe = state.repo.onAuthStateChange(function () {});
    var authenticated = await state.repo.signIn('prueba@example.com', 'prueba');
    equal(state.rpc, 0); equal(state.calls.length, 0);
    equal(await state.repo.authorize(authenticated), true);
    equal(await state.repo.listBookings(), []);
    equal(state.events.slice(-2), ['rpc', 'read']); unsubscribe(); equal(state.callbacks.length, 0);
  });
  test('INITIAL_SESSION y TOKEN_REFRESHED dentro de getSession aceptan la misma sesión', async function () {
    var state = setup({ onSession: function (current) {
      if (!current.initialEmitted) { current.initialEmitted = true; current.emit('INITIAL_SESSION', session()); }
    } });
    state.repo.onAuthStateChange(function () {});
    assert(await state.repo.getSession());
    var refreshed = setup({ onSession: function (current) {
      if (!current.initialEmitted) { current.initialEmitted = true; current.emit('TOKEN_REFRESHED', session()); }
    } });
    refreshed.repo.onAuthStateChange(function () {});
    equal((await refreshed.repo.listBookings()).length, 0);
  });
  test('Cliente admin comparte configuración, persiste solo Auth y rechaza mezcla pública', async function () {
    var state = setup();
    await state.repo.getSession();
    equal(state.clients[0].auth, { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'nova-admin-auth-v1' });
    equal(state.clients[0].db.retry, false);
    var second = NovaAdmin.createRepository(state.settings); await second.getSession(); equal(state.clients.length, 1);
    var publicRepo = NovaStorage.createRepository(state.settings);
    await rejects(function () { return publicRepo.listBookings({ startDate: date, endDate: '2030-01-08' }); }, 'CONFIG_ERROR');
  });
  test('Placeholders nunca habilitan una agenda admin local', async function () {
    setup();
    var repo = NovaAdmin.createRepository({ url: 'PEGA_AQUI_PROJECT_URL', publishableKey: 'PEGA_AQUI_PUBLISHABLE_KEY' });
    await rejects(function () { return repo.getSession(); }, 'CONFIG_ERROR');
  });
  test('Agenda privada usa columnas exactas, orden estable y Madrid', async function () {
    var state = setup({ rows: [row('b', 'maria', 600, 90, { service_id: 'tinte-raiz', source: 'phone' }), row('a')] });
    var bookings = await state.repo.listBookings();
    equal(bookings.map(function (item) { return item.id; }), ['a', 'b']);
    equal(bookings[1].customer, customer); equal(bookings[1].duration, 90); equal(bookings[1].date, date);
    equal(bookings[1].start, 600); equal(bookings[1].professionalId, 'maria'); equal(bookings[1].source, 'phone');
    equal(state.calls[0].select, columns); equal(state.calls[0].settings, { count: 'exact' }); equal(state.calls[0].orders, ['start_at', 'id']);
  });
  test('Revocar permiso exige otra RPC y bloquea lectura y mutación', async function () {
    var state = setup(); await state.repo.listBookings();
    state.admin = false;
    var error = await rejects(function () { return state.repo.listBookings(); }, 'FORBIDDEN');
    equal(error.message, 'Esta cuenta no está autorizada para administrar NOVA.'); equal(state.reads, 1);
    await rejects(function () { return state.repo.cancelBooking('a'); }, 'AUTH_REQUIRED'); equal(state.updates, 0);
  });
  test('Sesión expirada o rechazo privado por permisos exige volver al login', async function () {
    var expired = setup({ onSession: function () { return { error: { status: 401, message: 'privado@example.com' } }; } });
    await rejects(function () { return expired.repo.listBookings(); }, 'AUTH_REQUIRED'); equal(expired.calls.length, 0);
    var denied = setup({ onRead: function () { return { error: { code: '42501', message: 'privado@example.com' }, status: 403 }; } });
    await rejects(function () { return denied.repo.listBookings(); }, 'AUTH_REQUIRED');
  });
  test('Logout descarta lecturas privadas en vuelo', async function () {
    var pending = deferred(); var started = deferred();
    var state = setup({ onRead: function () { started.resolve(); return pending.promise; } });
    state.repo.onAuthStateChange(function () {});
    var reading = state.repo.listBookings(); await started.promise;
    await state.repo.signOut();
    pending.resolve({ data: [row('a')], count: 1, status: 200 });
    await rejects(function () { return reading; }, 'AUTH_REQUIRED'); equal(state.signouts, 1);
  });
  test('Cambio de cuenta invalida la respuesta privada anterior', async function () {
    var pending = deferred(); var started = deferred();
    var state = setup({ onRead: function () { started.resolve(); return pending.promise; } });
    state.repo.onAuthStateChange(function () {});
    var reading = state.repo.listBookings(); await started.promise;
    state.emit('SIGNED_IN', session('other'));
    pending.resolve({ data: [row('a')], count: 1, status: 200 });
    await rejects(function () { return reading; }, 'AUTH_REQUIRED');
  });
  test('invalidateAuth impide devolver un login anterior', async function () {
    var pending = deferred(); var state = setup({ session: null, onLogin: function () { return pending.promise; } });
    var login = state.repo.signIn('prueba@example.com', 'prueba');
    state.repo.invalidateAuth(); pending.resolve({ data: { session: session() } });
    await rejects(function () { return login; }, 'AUTH_REQUIRED'); equal(state.calls.length, 0); equal(state.session, null);
  });
  test('Paginación respeta límites pequeños y rechaza duplicados o cambios de conteo', async function () {
    var state = setup({ rows: [row('a'), row('b', 'maria'), row('c', 'laura')], pageLimit: 1 });
    equal((await state.repo.listBookings()).length, 3); equal(state.reads, 3); equal(state.calls[1].range[0], 1);
    var duplicate = setup({ onRead: function () { return { data: [row('a')], count: 2, status: 200 }; } });
    await rejects(function () { return duplicate.repo.listBookings(); }, 'CONNECTION_ERROR');
    var changed = setup({ onRead: function (_, current) { return { data: current.reads === 1 ? [row('a')] : [], count: current.reads === 1 ? 2 : 1, status: 200 }; } });
    await rejects(function () { return changed.repo.listBookings(); }, 'CONNECTION_ERROR');
  });
  test('Servicio histórico tiene fallback; profesional desconocido bloquea disponibilidad', async function () {
    var state = setup({ rows: [row('a', 'carlos', 540, 30, { service_id: 'historical' })] });
    var booking = (await state.repo.listBookings())[0]; equal(booking.serviceId, 'historical'); equal(booking.serviceName, 'Servicio fuera del catálogo');
    var invalid = setup({ rows: [row('a', 'unknown')] });
    await rejects(function () { return invalid.repo.getAvailability(input()); }, 'CONFIG_ERROR');
  });
  test('Timestamps sin zona o intervalos inválidos no abren huecos', async function () {
    for (var extra of [{ start_at: '2030-01-07T09:00:00' }, { end_at: '2030-01-07T08:00:00Z' }, { status: 'unknown' }]) {
      var state = setup({ rows: [row('a', 'carlos', 540, 30, extra)] });
      await rejects(function () { return state.repo.listBookings(); }, 'CONNECTION_ERROR');
    }
  });
  test('Cita telefónica envía siete campos y bloquea la disponibilidad siguiente', async function () {
    var state = setup(); var created = await state.repo.createPhoneBooking(input());
    equal(created.duration, 30); equal(created.id, undefined); equal(state.inserts, 1);
    var call = state.calls.find(function (item) { return item.insert; });
    equal(Object.keys(call.insert).sort(), ['customer_email', 'customer_name', 'customer_phone', 'professional_id', 'service_id', 'source', 'start_at']);
    equal(call.insert.source, 'phone'); equal(call.insert.start_at, '2030-01-07T08:00:00.000Z'); equal(call.select, undefined); equal(call.retry, false);
    assert(!(await state.repo.getAvailability(input())).slots.some(function (slot) { return slot.start === 540; }));
  });
  test('90 minutos requieren todo el intervalo libre, contiguas permitidas', async function () {
    var state = setup({ rows: [row('a', 'maria', 660, 30)] });
    await rejects(function () { return state.repo.createPhoneBooking(input({ serviceId: 'tinte-raiz', professionalId: 'maria', start: 600 })); }, 'SLOT_UNAVAILABLE');
    equal(state.inserts, 0);
    equal((await state.repo.createPhoneBooking(input({ serviceId: 'tinte-raiz', professionalId: 'maria', start: 570 }))).duration, 90);
  });
  test('Pasado, domingo y final fuera del cierre se rechazan', async function () {
    var state = setup();
    for (var change of [{ date: '2030-01-06' }, { date: '2030-01-13' }, { start: 510 }, { start: 1200 }, { serviceId: 'balayage', professionalId: 'laura', start: 1080 }]) {
      await rejects(function () { return state.repo.createPhoneBooking(input(change)); }, 'SLOT_UNAVAILABLE');
    }
    equal(state.inserts, 0);
  });
  test('Validación de cliente y profesional ocurre antes de leer o insertar', async function () {
    var state = setup();
    var error = await rejects(function () { return state.repo.createPhoneBooking(input({ customer: { name: '1', phone: '2', email: '3' } })); }, 'VALIDATION_ERROR');
    equal(Object.keys(error.fields).sort(), ['email', 'name', 'phone']);
    await rejects(function () { return state.repo.createPhoneBooking(input({ professionalId: 'maria' })); }, 'VALIDATION_ERROR');
    equal(state.calls.length, 0);
  });
  test('Conflicto atómico del servidor muestra texto exacto sin PII', async function () {
    var state = setup({ onInsert: function () { return { error: { code: '23P01', message: 'privado@example.com' }, status: 409 }; } });
    var error = await rejects(function () { return state.repo.createPhoneBooking(input()); }, 'SLOT_UNAVAILABLE');
    equal(error.message, 'Ese horario acaba de dejar de estar disponible.'); equal(state.inserts, 1);
  });
  test('Respuesta perdida de escritura permanece incierta sin reintentar', async function () {
    var state = setup({ onInsert: function () { throw new Error('privado@example.com'); } });
    var error = await rejects(function () { return state.repo.createPhoneBooking(input()); }, 'BOOKING_UNCERTAIN');
    assert(!error.message.includes('privado@')); equal(state.inserts, 1);
  });
  test('Cancelar cambia status, no borra filas y libera consulta pública', async function () {
    var state = setup({ rows: [row('a')] });
    await state.repo.cancelBooking('a');
    equal(state.rows.length, 1); equal(state.rows[0].status, 'cancelled');
    var update = state.calls.find(function (item) { return item.update; });
    equal(update.update, { status: 'cancelled' }); equal(update.filters, [['eq', 'id', 'a']]); equal(update.select, 'id'); equal(update.retry, false);
    readScript('supabase-repository.js');
    var publicRepo = NovaStorage.createRepository(state.settings);
    var occupied = await publicRepo.listBookings({ startDate: date, endDate: '2030-01-08' });
    equal(occupied, []);
    assert(NovaCore.getAvailability(Object.assign(input(), { bookings: occupied, now: now })).slots.some(function (slot) { return slot.start === 540; }));
  });
  test('RLS que actualiza cero filas nunca produce confirmación de cancelación', async function () {
    var state = setup({ onUpdate: function () { return { data: [], error: null, status: 200 }; } });
    await rejects(function () { return state.repo.cancelBooking('a'); }, 'CANCEL_NOT_ALLOWED');
  });
  test('Errores RPC y privados se sanea y no se persisten reservas', async function () {
    var descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); var touches = 0;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: function () { touches += 1; throw new Error('No permitido.'); } });
    try {
      var state = setup({ onRPC: function () { return { status: 403, error: { code: '42501', message: 'privado@example.com' } }; } });
      var error = await rejects(function () { return state.repo.listBookings(); }, 'AUTH_REQUIRED');
      assert(!error.message.includes('privado@')); equal(state.calls.length, 0);
      var authorized = setup(); await authorized.repo.createPhoneBooking(input()); await authorized.repo.listBookings(); equal(touches, 0);
    } finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; }
  });

  (async function () {
    var passed = 0;
    for (var current of tests) {
      try { await current.run(); passed += 1; output('OK · ' + current.name); }
      catch (error) { output('ERROR · ' + current.name + ': ' + error.message); throw error; }
    }
    output(passed + '/' + tests.length + ' pruebas del repositorio admin correctas.');
  }()).catch(function (error) {
    output(error.stack || error.message);
    if (typeof quit === 'function') quit(1);
    if (typeof process !== 'undefined') process.exitCode = 1;
  });
  if (typeof drainMicrotasks === 'function') drainMicrotasks();
}());
