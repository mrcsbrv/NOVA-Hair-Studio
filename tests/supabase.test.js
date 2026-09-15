/* Contratos del adaptador con Supabase simulado. Sin red, paquetes ni credenciales reales.
 * macOS: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/supabase.test.js
 * Node: node tests/supabase.test.js
 */
(function () {
  'use strict';
  var output = typeof print === 'function' ? print : console.log.bind(console);
  function readScript(path) {
    if (typeof load === 'function') load(path);
    else {
      var resolved = require.resolve('../' + path);
      delete require.cache[resolved];
      require(resolved);
    }
  }
  readScript('data.js');
  readScript('salon-time.js');
  readScript('booking-core.js');
  var tests = [];
  var now = new Date('2030-01-07T07:00:00Z');
  var date = '2030-01-07';
  var range = { startDate: date, endDate: '2030-01-08' };
  var publicColumns = 'professional_id,start_at,end_at,status';
  var publicBlockColumns = 'professional_id,start_at,end_at,active';
  var customer = { name: 'Álex Prueba', phone: '+34 612 345 678', email: 'alex@prueba.example' };
  function test(name, run) { tests.push({ name: name, run: run }); }
  function assert(value, message) { if (!value) throw new Error(message || 'Condición incorrecta.'); }
  function equal(actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Resultado distinto: ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected));
  }
  async function rejects(operation, code) {
    try { await operation(); }
    catch (error) { equal(error.code, code); return error; }
    throw new Error('Falta rechazo ' + code);
  }
  function input(overrides) {
    return Object.assign({ serviceId: 'corte-caballero', professionalId: 'carlos', date: date, start: 540, customer: Object.assign({}, customer), source: 'online' }, overrides || {});
  }
  function row(professional, start, end, day) {
    return {
      professional_id: professional === undefined ? 'carlos' : professional, start_at: NovaTime.toInstant(day || date, start).toISOString(),
      end_at: NovaTime.toInstant(day || date, end).toISOString(), status: 'confirmed'
    };
  }
  function block(professional, start, end, day) {
    var result = row(professional, start, end, day);
    delete result.status;
    result.active = true;
    return result;
  }
  function setup(options) {
    options = options || {};
    readScript('supabase-repository.js');
    var state = { rows: options.rows || [], blocks: options.blocks || [], calls: [], clients: [], reads: 0, blockReads: 0, inserts: 0 };
    var sdk = {
      createClient: function (url, key, settings) {
        state.clients.push({ url: url, key: key, settings: settings });
        if (options.clientError) throw new Error('Detalle privado de inicialización');
        return {
          from: function (table) {
            assert(table === 'nova_bookings' || table === 'nova_blocks', 'Consulta una tabla no autorizada.');
            var call = { table: table, filters: [], orders: [] };
            state.calls.push(call);
            var builder = {
              select: function (columns, settings) {
                assert(!call.insert, 'INSERT intenta devolver columnas.');
                call.select = columns; call.settings = settings; return builder;
              },
              insert: function (payload) { call.insert = payload; return builder; },
              eq: function (key, value) { call.filters.push(['eq', key, value]); return builder; },
              lt: function (key, value) { call.filters.push(['lt', key, value]); return builder; },
              gt: function (key, value) { call.filters.push(['gt', key, value]); return builder; },
              order: function (key, settings) { call.orders.push([key, settings]); return builder; },
              range: function (first, last) { call.range = [first, last]; return builder; },
              retry: function (value) { call.retry = value; return builder; },
              abortSignal: function () { return builder; },
              then: function (resolve, reject) {
                return Promise.resolve().then(function () {
                  if (call.insert) {
                    assert(table === 'nova_bookings', 'El público no puede escribir bloqueos.');
                    state.inserts += 1;
                    if (options.onInsert) return options.onInsert(call, state);
                    var service = NovaData.services.find(function (service) {
                      return (Object.prototype.hasOwnProperty.call(service, 'supabaseId') ? service.supabaseId : service.id) === call.insert.service_id;
                    });
                    state.rows.push({
                      professional_id: call.insert.professional_id, start_at: call.insert.start_at,
                      end_at: new Date(Date.parse(call.insert.start_at) + service.duration * 60000).toISOString(), status: 'confirmed'
                    });
                    return { data: null, error: null, status: 201 };
                  }
                  if (table === 'nova_blocks') state.blockReads += 1;
                  else state.reads += 1;
                  var reader = table === 'nova_blocks' ? options.onBlockRead : options.onRead;
                  if (reader) {
                    var custom = reader(call, state);
                    if (custom !== undefined) return custom;
                  }
                  var rows = (table === 'nova_blocks' ? state.blocks : state.rows).filter(function (row) {
                    return call.filters.every(function (filter) {
                      if (filter[0] === 'eq') return row[filter[1]] === filter[2];
                      if (filter[0] === 'lt') return Date.parse(row[filter[1]]) < Date.parse(filter[2]);
                      return Date.parse(row[filter[1]]) > Date.parse(filter[2]);
                    });
                  }).slice().sort(function (a, b) {
                    return Date.parse(a.start_at) - Date.parse(b.start_at) || String(a.professional_id).localeCompare(String(b.professional_id)) || Date.parse(a.end_at) - Date.parse(b.end_at);
                  });
                  var take = Math.min(call.range[1] - call.range[0] + 1, options.serverPageLimit || 1000);
                  return { data: rows.slice(call.range[0], call.range[0] + take), count: rows.length, error: null, status: 200 };
                }).then(resolve, reject);
              }
            };
            return builder;
          }
        };
      }
    };
    state.sdk = sdk;
    state.repo = NovaStorage.createRepository({ url: 'https://nova-demo.supabase.co', publishableKey: 'sb_publishable_demo_only', sdk: sdk, now: function () { return new Date(now); } });
    return state;
  }
  function assertPublicReads(state) {
    state.calls.filter(function (call) { return call.select; }).forEach(function (call) {
      equal(call.select, call.table === 'nova_blocks' ? publicBlockColumns : publicColumns);
      equal(call.settings, { count: 'exact' });
      equal(call.filters[0], call.table === 'nova_blocks' ? ['eq', 'active', true] : ['eq', 'status', 'confirmed']);
      equal(call.orders.map(function (order) { return order[0]; }), ['start_at', 'professional_id', 'end_at']);
      assert(call.range, 'Falta paginación.');
    });
  }

  test('Placeholders vacíos usan exclusivamente la demo local', async function () {
    setup();
    var storage = { value: null, getItem: function () { return this.value; }, setItem: function (_, value) { this.value = value; } };
    var local = NovaStorage.createRepository({ url: 'PEGA_AQUI_PROJECT_URL', publishableKey: 'PEGA_AQUI_PUBLISHABLE_KEY', storage: storage, locks: null, now: function () { return now; } });
    equal(local.mode, 'local');
    assert((await local.listBookings()).length > 0);
    assert(storage.value);
  });
  test('Configuración ausente o de tipo incorrecto no activa una agenda local', async function () {
    setup();
    var touches = 0;
    var storage = { getItem: function () { touches += 1; }, setItem: function () { touches += 1; } };
    // Esta suite no carga supabase-config.js: reproduce que el archivo falte o no se ejecute.
    var absent = NovaStorage.createRepository({ storage: storage });
    equal(absent.mode, 'supabase');
    await rejects(function () { return absent.listBookings(range); }, 'CONFIG_ERROR');
    var invalid = NovaStorage.createRepository({ url: null, publishableKey: null, storage: storage });
    equal(invalid.mode, 'supabase');
    await rejects(function () { return invalid.createBooking(input()); }, 'CONFIG_ERROR');
    equal(touches, 0);
  });
  test('Cliente reutilizable sin sesión, persistencia de auth ni reintentos automáticos', async function () {
    var state = setup();
    await state.repo.listBookings(range);
    var second = NovaStorage.createRepository({ url: 'https://nova-demo.supabase.co', publishableKey: 'sb_publishable_demo_only', sdk: state.sdk });
    await second.listBookings(range);
    equal(state.clients.length, 1);
    equal(state.clients[0].settings.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
    equal(state.clients[0].settings.db.retry, false);
  });
  test('Configuración parcial o inválida jamás recurre al modo local', async function () {
    var state = setup();
    var cases = [
      ['https://nova-demo.supabase.co', 'PEGA_AQUI_PUBLISHABLE_KEY'],
      ['PEGA_AQUI_PROJECT_URL', 'sb_publishable_demo_only'],
      ['http://nova-demo.supabase.co', 'sb_publishable_demo_only'],
      ['https://nova-demo.supabase.co', 'tipo_de_clave_no_admitido'],
      ['https://user:pass@nova-demo.supabase.co', 'sb_publishable_demo_only']
    ];
    for (var index = 0; index < cases.length; index += 1) {
      var repository = NovaStorage.createRepository({ url: cases[index][0], publishableKey: cases[index][1], sdk: state.sdk });
      equal(repository.mode, 'supabase');
      await rejects(function () { return repository.listBookings(range); }, 'CONFIG_ERROR');
    }
    equal(state.clients.length, 0);
  });
  test('Biblioteca CDN ausente e inicialización fallida bloquean Supabase', async function () {
    setup();
    var repository = NovaStorage.createRepository({ url: 'https://nova-demo.supabase.co', publishableKey: 'sb_publishable_demo_only', sdk: {} });
    await rejects(function () { return repository.listBookings(range); }, 'CONFIG_ERROR');
    var broken = setup({ clientError: true });
    var error = await rejects(function () { return broken.repo.listBookings(range); }, 'CONFIG_ERROR');
    assert(!error.message.includes('privado'));
  });
  test('SELECT usa cuatro columnas públicas, rango semiabierto y orden estable', async function () {
    var state = setup({ rows: [row('carlos', 540, 570), Object.assign(row('maria', 600, 630), { status: 'cancelled' }), row('carlos', 540, 570, '2030-01-08')] });
    equal(await state.repo.listBookings(range), [{ professionalId: 'carlos', date: date, start: 540, end: 570 }]);
    assertPublicReads(state);
    equal(state.calls[0].filters.slice(1), [['lt', 'start_at', '2030-01-07T23:00:00.000Z'], ['gt', 'end_at', '2030-01-06T23:00:00.000Z']]);
  });
  test('Disponibilidad consulta solo columnas públicas de bloqueos activos y separa sus intervalos', async function () {
    var state = setup({ rows: [row('carlos', 540, 570)], blocks: [
      Object.assign(block('laura', 720, 900), { reason: 'Motivo privado de salud', created_by: 'usuario-privado' }),
      Object.assign(block('maria', 540, 630), { active: false }), block(null, 660, 690), block('carlos', 540, 570, '2030-01-08')
    ] });
    var result = await state.repo.listAvailability(range);
    equal(result.bookings, [{ professionalId: 'carlos', date: date, start: 540, end: 570 }]);
    equal(result.blocks, [{ professionalId: null, date: date, start: 660, end: 690 }, { professionalId: 'laura', date: date, start: 720, end: 900 }]);
    assert(!JSON.stringify(result).includes('privado'));
    equal(state.blockReads, 1);
    assertPublicReads(state);
    equal(state.calls.find(function (call) { return call.table === 'nova_blocks'; }).filters.slice(1), [
      ['lt', 'start_at', '2030-01-07T23:00:00.000Z'], ['gt', 'end_at', '2030-01-06T23:00:00.000Z']
    ]);
  });
  test('Bloqueos duplicados y solapados se paginan completos sin confundir duplicados legítimos', async function () {
    var blocks = [];
    for (var index = 0; index < 241; index += 1) blocks.push(block(null, 540, 600));
    blocks.push(block('laura', 570, 630));
    var state = setup({ blocks: blocks, serverPageLimit: 37 });
    var result = await state.repo.listAvailability(range);
    equal(result.blocks, [{ professionalId: null, date: date, start: 540, end: 600 }, { professionalId: 'laura', date: date, start: 570, end: 630 }]);
    equal(state.blockReads, 7);
    equal(state.calls.filter(function (call) { return call.table === 'nova_blocks'; })[1].range[0], 37);
    assertPublicReads(state);
  });
  test('Vacaciones se recortan al rango y se dividen en días de Madrid', async function () {
    var state = setup({ blocks: [{ professional_id: 'laura', start_at: '2030-01-06T22:00:00Z', end_at: '2030-01-09T11:00:00Z', active: true }] });
    var result = await state.repo.listAvailability({ startDate: date, endDate: '2030-01-10' });
    equal(result.blocks, [
      { professionalId: 'laura', date: date, start: 0, end: 1440 },
      { professionalId: 'laura', date: '2030-01-08', start: 0, end: 1440 },
      { professionalId: 'laura', date: '2030-01-09', start: 0, end: 720 }
    ]);
    equal((await state.repo.listAvailability(range)).blocks, [result.blocks[0]]);
  });
  test('Un bloqueo completo en el cambio de hora cubre 24 horas civiles de Madrid', async function () {
    for (var dateKey of ['2030-03-31', '2030-10-27']) {
      var day = NovaTime.dayRange(dateKey);
      var state = setup({ blocks: [{ professional_id: null, start_at: day.startAt, end_at: day.endAt, active: true }] });
      var result = await state.repo.listAvailability({ startDate: dateKey, endDate: NovaTime.addDays(dateKey, 1) });
      equal(result.blocks, [{ professionalId: null, date: dateKey, start: 0, end: 1440 }]);
    }
  });
  test('Una lectura de bloqueos incompleta impide publicar horas y crear reservas', async function () {
    var responses = [{ data: [], count: 1, status: 200 }, { data: [], count: null, status: 200 }, { data: [], count: 20001, status: 200 },
      { error: { code: '42501', message: 'Motivo privado' }, status: 403 }];
    for (var response of responses) {
      var state = setup({ onBlockRead: function () { return response; } });
      var expected = response.status === 403 ? 'CONFIG_ERROR' : 'CONNECTION_ERROR';
      await rejects(function () { return state.repo.listAvailability(range); }, expected);
      var error = await rejects(function () { return state.repo.createBooking(input()); }, expected);
      assert(!error.message.includes('privado'));
      equal(state.inserts, 0);
    }
    var changed = setup({ onBlockRead: function (_, state) {
      return state.blockReads === 1 ? { data: [block('carlos', 540, 570)], count: 2, status: 200 } : { data: [], count: 1, status: 200 };
    } });
    await rejects(function () { return changed.repo.listAvailability(range); }, 'CONNECTION_ERROR');
  });
  test('Bloqueos malformados, inactivos inesperados o sin mapping fallan de forma cerrada', async function () {
    for (var invalid of [Object.assign(block(null, 540, 570), { start_at: '2030-01-07T09:00:00' }),
      Object.assign(block(null, 540, 570), { active: false }), block({}, 540, 570), block('carlos', 570, 540)]) {
      var state = setup({ onBlockRead: function () { return { data: [invalid], count: 1, status: 200 }; } });
      await rejects(function () { return state.repo.listAvailability(range); }, 'CONNECTION_ERROR');
    }
    var unknown = setup({ blocks: [block('profesional-desconocido', 540, 570)] });
    await rejects(function () { return unknown.repo.listAvailability(range); }, 'CONFIG_ERROR');
  });
  test('Una nueva reserva relee bloques, respeta duración real y no inserta horarios bloqueados', async function () {
    var state = setup({ blocks: [block('laura', 720, 900)] });
    await rejects(function () { return state.repo.createBooking(input({ serviceId: 'color-completo', professionalId: 'laura', start: 630 })); }, 'SLOT_UNAVAILABLE');
    equal(state.inserts, 0);
    var booking = await state.repo.createBooking(input({ serviceId: 'color-completo', professionalId: 'laura', start: 600 }));
    equal(booking.duration, 120);
    assert(state.blockReads >= 2);
    assertPublicReads(state);
    var all = setup({ blocks: [block(null, 540, 1200)] });
    await rejects(function () { return all.repo.createBooking(input()); }, 'SLOT_UNAVAILABLE');
    equal(all.inserts, 0);
  });
  test('Desactivar bloqueos devuelve disponibilidad sin alterar reservas existentes', async function () {
    var state = setup({ rows: [row('carlos', 600, 630)], blocks: [block(null, 540, 600)] });
    var before = await state.repo.listAvailability(range);
    assert(!NovaCore.getAvailability(Object.assign({ serviceId: 'corte-caballero', date: date, now: now }, before)).slots.some(function (slot) { return slot.start === 540; }));
    state.blocks[0].active = false;
    var after = await state.repo.listAvailability(range);
    equal(after.blocks, []);
    equal(after.bookings, before.bookings);
    assert(NovaCore.getAvailability(Object.assign({ serviceId: 'corte-caballero', date: date, now: now }, after)).slots.some(function (slot) { return slot.start === 540; }));
  });
  test('HORARIO_BLOQUEADO se muestra de forma segura y pide elegir otro horario', async function () {
    for (var error of [{ code: 'P0001', message: 'HORARIO_BLOQUEADO: Motivo privado' }, { code: 'HORARIO_BLOQUEADO', message: 'Motivo privado' }]) {
      var state = setup({ onInsert: function () { return { error: error, status: 409 }; } });
      var result = await rejects(function () { return state.repo.createBooking(input()); }, 'SLOT_UNAVAILABLE');
      equal(result.message, 'Este horario acaba de dejar de estar disponible.');
      equal(state.inserts, 1);
      assertPublicReads(state);
    }
  });
  test('Rangos de verano/invierno respetan las transiciones de Madrid', async function () {
    var state = setup();
    await state.repo.listBookings({ startDate: '2030-03-31', endDate: '2030-04-01' });
    equal(state.calls[0].filters.slice(1), [['lt', 'start_at', '2030-03-31T22:00:00.000Z'], ['gt', 'end_at', '2030-03-30T23:00:00.000Z']]);
    await state.repo.listBookings({ startDate: '2030-10-27', endDate: '2030-10-28' });
    equal(state.calls[1].filters.slice(1), [['lt', 'start_at', '2030-10-27T23:00:00.000Z'], ['gt', 'end_at', '2030-10-26T22:00:00.000Z']]);
  });
  test('La lectura exige zona explícita y rechaza intervalos públicos malformados', async function () {
    var invalidRows = [
      Object.assign(row('carlos', 540, 570), { start_at: '2030-01-07T08:00:00' }),
      Object.assign(row('carlos', 540, 570), { end_at: '2030-01-07T08:30:00' }),
      Object.assign(row('carlos', 540, 570), { start_at: '2030-01-07' }),
      Object.assign(row('carlos', 540, 570), { start_at: '2030-01-07T08:00:00+0100' }),
      Object.assign(row('carlos', 540, 570), { end_at: 'fecha incorrecta' }),
      row('carlos', 570, 540), row(null, 540, 570), row({}, 540, 570),
      Object.assign(row('carlos', 540, 570), { status: 'cancelled' })
    ];
    for (var invalidRow of invalidRows) {
      var invalid = setup({ onRead: function () { return { data: [invalidRow], count: 1, status: 200 }; } });
      await rejects(function () { return invalid.repo.listBookings(range); }, 'CONNECTION_ERROR');
    }
    var zoned = setup({ rows: [{ professional_id: 'carlos', start_at: '2030-01-07T09:00:00+01:00', end_at: '2030-01-07T09:30:00+01:00', status: 'confirmed' }] });
    equal(await zoned.repo.listBookings(range), [{ professionalId: 'carlos', date: date, start: 540, end: 570 }]);
  });
  test('Las lecturas sin rango válido nunca consultan todas las reservas', async function () {
    var state = setup();
    for (var invalid of [undefined, {}, { startDate: date, endDate: date }, { startDate: date, endDate: '2031-01-07' }, { startDate: '2030-02-30', endDate: '2030-03-01' }]) {
      await rejects(function () { return state.repo.listBookings(invalid); }, 'VALIDATION_ERROR');
    }
    equal(state.calls.length, 0);
  });
  test('Más de 1000 ocupaciones se cargan completas con límite de servidor de 37', async function () {
    var rows = [];
    for (var index = 0; index < 1201; index += 1) rows.push(row('carlos', index, index + 1));
    var state = setup({ rows: rows, serverPageLimit: 37 });
    equal((await state.repo.listBookings(range)).length, 1201);
    equal(state.reads, 33);
    equal(state.calls[1].range[0], 37);
    assertPublicReads(state);
  });
  test('Conteos incompletos, límites y cambios entre páginas fallan de forma cerrada', async function () {
    for (var response of [
      { data: [], count: null, status: 200 }, { data: [], count: 1, status: 200 },
      { data: [], count: 20001, status: 200 }
    ]) {
      var state = setup({ onRead: function () { return response; } });
      await rejects(function () { return state.repo.listBookings(range); }, 'CONNECTION_ERROR');
    }
    var changed = setup({ onRead: function (_, state) { return state.reads === 1 ? { data: [row('carlos', 540, 570)], count: 2 } : { data: [], count: 1 }; } });
    await rejects(function () { return changed.repo.listBookings(range); }, 'CONNECTION_ERROR');
    var duplicate = setup({ onRead: function () { return { data: [row('carlos', 540, 570)], count: 2 }; } });
    await rejects(function () { return duplicate.repo.listBookings(range); }, 'CONNECTION_ERROR');
  });
  test('Errores remotos y excepciones nunca muestran detalles privados', async function () {
    var state = setup({ onRead: function () { return { error: { code: '42501', message: 'cliente@example.com', details: '+34600123456' }, status: 403 }; } });
    var error = await rejects(function () { return state.repo.listBookings(range); }, 'CONFIG_ERROR');
    assert(!JSON.stringify(error).includes('cliente@') && !error.message.includes('cliente@'));
    var broken = setup({ onRead: function () { throw Object.assign(new Error('privado cliente@example.com'), { code: 'VALIDATION_ERROR' }); } });
    var sanitized = await rejects(function () { return broken.repo.listBookings(range); }, 'CONNECTION_ERROR');
    assert(!sanitized.message.includes('cliente@'));
  });
  test('INSERT guarda únicamente seis campos, refresca y devuelve solo resumen propio', async function () {
    var state = setup();
    var notifications = 0;
    var unsubscribe = state.repo.subscribe(function () { notifications += 1; });
    var booking = await state.repo.createBooking(input());
    equal(state.reads, 2);
    equal(state.inserts, 1);
    var insert = state.calls.find(function (call) { return call.insert; });
    equal(Object.keys(insert.insert).sort(), ['customer_email', 'customer_name', 'customer_phone', 'professional_id', 'service_id', 'start_at']);
    equal(insert.insert.start_at, '2030-01-07T08:00:00.000Z');
    equal(insert.retry, false);
    equal(insert.select, undefined);
    equal(booking.id, undefined);
    equal(booking.duration, 30);
    equal(booking.customer, customer);
    equal(notifications, 1);
    unsubscribe();
    var occupied = await state.repo.listBookings(range);
    assert(!NovaCore.getAvailability({ serviceId: 'corte-caballero', professionalId: 'carlos', date: date, bookings: occupied, now: now }).slots.some(function (slot) { return slot.start === 540; }));
    assertPublicReads(state);
  });
  test('Datos propios viven en memoria y no acceden a localStorage en modo remoto', async function () {
    var state = setup();
    var descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    var accesses = 0;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: function () { accesses += 1; throw new Error('No se puede acceder.'); } });
    try {
      await state.repo.listBookings(range);
      await state.repo.createBooking(input());
      await rejects(function () { return state.repo.cancelBooking('cualquiera'); }, 'ADMIN_DISABLED');
      await rejects(function () { return state.repo.resetDemo(); }, 'ADMIN_DISABLED');
      equal(accesses, 0);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else delete globalThis.localStorage;
    }
  });
  test('Validación de cliente y compatibilidad impiden consultas e INSERT', async function () {
    var state = setup();
    await rejects(function () { return state.repo.createBooking(input({ customer: { name: '1', phone: '2', email: '3' } })); }, 'VALIDATION_ERROR');
    await rejects(function () { return state.repo.createBooking(input({ professionalId: 'maria' })); }, 'VALIDATION_ERROR');
    await rejects(function () { return state.repo.createBooking(input({ source: 'phone' })); }, 'ADMIN_DISABLED');
    equal(state.calls.length, 0);
  });
  test('Relectura previa impide 90 minutos que invaden una reserva de 30', async function () {
    var state = setup({ rows: [row('maria', 660, 690)] });
    await rejects(function () { return state.repo.createBooking(input({ serviceId: 'tinte-raiz', professionalId: 'maria', start: 600 })); }, 'SLOT_UNAVAILABLE');
    equal(state.inserts, 0);
    var booking = await state.repo.createBooking(input({ serviceId: 'tinte-raiz', professionalId: 'maria', start: 540 }));
    equal(booking.duration, 90);
    equal(booking.end, 630);
  });
  test('Domingos, horas pasadas y citas que invaden el cierre nunca se insertan', async function () {
    var state = setup();
    for (var appointment of [input({ date: '2030-01-06' }), input({ date: '2030-01-13' }), input({ start: 510 }), input({ start: 1200 }), input({ serviceId: 'tinte-raiz', professionalId: 'maria', start: 1140 })]) {
      await rejects(function () { return state.repo.createBooking(appointment); }, 'SLOT_UNAVAILABLE');
    }
    equal(state.inserts, 0);
  });
  test('Conflicto atómico del servidor y rechazo por hora pasada piden otra hora', async function () {
    for (var error of [{ code: '23P01', message: 'Detalles sensibles' }, { code: 'P0001', message: 'La hora ya no está disponible' }, { code: 'P0001', message: 'Booking start_at is in the past' }]) {
      var state = setup({ onInsert: function () { return { error: error, status: 409 }; } });
      var failure = await rejects(function () { return state.repo.createBooking(input()); }, 'SLOT_UNAVAILABLE');
      assert(!failure.message.includes('sensibles'));
      equal(state.inserts, 1);
    }
  });
  test('Fallo de red antes de INSERT no crea cita; respuesta perdida no se reintenta', async function () {
    var before = setup({ onRead: function () { throw new Error('Red caída'); } });
    await rejects(function () { return before.repo.createBooking(input()); }, 'CONNECTION_ERROR');
    equal(before.inserts, 0);
    var during = setup({ onInsert: function () { throw new Error('Conexión interrumpida con datos privados'); } });
    var error = await rejects(function () { return during.repo.createBooking(input()); }, 'BOOKING_UNCERTAIN');
    equal(during.inserts, 1);
    assert(!error.message.includes('privados'));
  });
  test('Un INSERT sin estado HTTP fiable o con error del servidor tiene resultado incierto', async function () {
    for (var response of [{}, { error: null, data: null }, { status: 500 }, { status: 408 }, { error: { message: 'Detalle privado' }, status: 503 }]) {
      var state = setup({ onInsert: function () { return response; } });
      var error = await rejects(function () { return state.repo.createBooking(input()); }, 'BOOKING_UNCERTAIN');
      equal(state.inserts, 1);
      assert(!error.message.includes('privado'));
    }
  });
  test('Error de actualización posterior conserva la reserva confirmada', async function () {
    var state = setup({ onRead: function (_, state) { if (state.inserts) throw new Error('Error al refrescar'); } });
    var booking = await state.repo.createBooking(input());
    equal(state.inserts, 1);
    assert(booking.refreshWarning);
    equal(booking.customer.email, customer.email);
  });
  test('Una escritura confirmada ausente en SELECT bloquea su rango hasta observarla', async function () {
    var state = setup({ onInsert: function () { return { data: null, error: null, status: 201 }; } });
    var notifications = 0;
    state.repo.subscribe(function () { notifications += 1; });
    var booking = await state.repo.createBooking(input());
    assert(booking.refreshWarning, 'Falta aviso de lectura posterior incompleta.');
    equal(notifications, 1);
    await rejects(function () { return state.repo.listBookings(range); }, 'CONNECTION_ERROR');
    await rejects(function () { return state.repo.listBookings({ startDate: '2030-01-01', endDate: '2030-02-01' }); }, 'CONNECTION_ERROR');
    await rejects(function () { return state.repo.createBooking(input()); }, 'CONNECTION_ERROR');
    equal(state.inserts, 1);
    equal(await state.repo.listBookings({ startDate: '2030-01-08', endDate: '2030-01-09' }), []);
    state.rows.push(row('carlos', 540, 570));
    equal(await state.repo.listBookings(range), [{ professionalId: 'carlos', date: date, start: 540, end: 570 }]);
    // Una vez observada, una cancelación posterior en la agenda privada sí puede liberar la hora.
    state.rows = [];
    equal(await state.repo.listBookings(range), []);
    assertPublicReads(state);
  });
  test('Correspondencias opcionales de IDs traducen INSERT y ocupaciones públicas', async function () {
    var person = NovaData.professionals.find(function (item) { return item.id === 'carlos'; });
    var service = NovaData.services.find(function (item) { return item.id === 'corte-caballero'; });
    person.supabaseId = 'professional-database-id'; service.supabaseId = 'service-database-id';
    try {
      var state = setup();
      var booking = await state.repo.createBooking(input());
      equal(state.calls.find(function (call) { return call.insert; }).insert.professional_id, 'professional-database-id');
      equal(state.calls.find(function (call) { return call.insert; }).insert.service_id, 'service-database-id');
      equal(booking.professionalId, 'carlos');
      equal((await state.repo.listBookings(range))[0].professionalId, 'carlos');
    } finally { delete person.supabaseId; delete service.supabaseId; }
    var unknown = setup({ rows: [row('profesional-desconocido', 540, 570)] });
    await rejects(function () { return unknown.repo.listBookings(range); }, 'CONFIG_ERROR');
  });
  test('IDs enteros, incluido cero, se conservan al insertar y se normalizan al leer', async function () {
    var person = NovaData.professionals.find(function (item) { return item.id === 'carlos'; });
    var service = NovaData.services.find(function (item) { return item.id === 'corte-caballero'; });
    person.supabaseId = 0; service.supabaseId = 12;
    try {
      var state = setup();
      await state.repo.createBooking(input());
      var payload = state.calls.find(function (call) { return call.insert; }).insert;
      equal(payload.professional_id, 0);
      equal(payload.service_id, 12);
      state.rows[0].professional_id = '0';
      equal((await state.repo.listBookings(range))[0].professionalId, 'carlos');
      person.supabaseId = '42';
      var numericResponse = setup({ rows: [row(42, 540, 570)] });
      equal((await numericResponse.repo.listBookings(range))[0].professionalId, 'carlos');
      var unknown = setup({ rows: [row(999, 540, 570)] });
      await rejects(function () { return unknown.repo.listBookings(range); }, 'CONFIG_ERROR');
    } finally { delete person.supabaseId; delete service.supabaseId; }
  });
  test('Correspondencias duplicadas se rechazan incluso antes de leer una agenda vacía', async function () {
    var person = NovaData.professionals.find(function (item) { return item.id === 'maria'; });
    var service = NovaData.services.find(function (item) { return item.id === 'corte-mujer'; });
    for (var mapping of [{ record: person, id: 'carlos' }, { record: service, id: 'corte-caballero' }]) {
      mapping.record.supabaseId = mapping.id;
      try {
        var state = setup();
        await rejects(function () { return state.repo.createBooking(input()); }, 'CONFIG_ERROR');
        await rejects(function () { return state.repo.listBookings(range); }, 'CONFIG_ERROR');
        equal(state.calls.length, 0);
        equal(state.inserts, 0);
      } finally { delete mapping.record.supabaseId; }
    }
    var otherPerson = NovaData.professionals.find(function (item) { return item.id === 'carlos'; });
    person.supabaseId = 0; otherPerson.supabaseId = '0';
    try {
      var duplicated = setup();
      await rejects(function () { return duplicated.repo.createBooking(input()); }, 'CONFIG_ERROR');
      equal(duplicated.calls.length, 0);
    } finally { delete person.supabaseId; delete otherPerson.supabaseId; }
  });
  test('Un mapping explícito inválido no se sustituye por un ID local', async function () {
    var person = NovaData.professionals.find(function (item) { return item.id === 'carlos'; });
    try {
      for (var invalid of ['', '  ', null, false, {}, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        person.supabaseId = invalid;
        var state = setup();
        await rejects(function () { return state.repo.createBooking(input()); }, 'CONFIG_ERROR');
        equal(state.calls.length, 0);
      }
    } finally { delete person.supabaseId; }
  });
  test('La duración final puede actualizarse desde el intervalo calculado por servidor', async function () {
    var state = setup({ onInsert: function (call, state) {
      state.rows.push({ professional_id: call.insert.professional_id, start_at: call.insert.start_at, end_at: '2030-01-07T08:45:00Z', status: 'confirmed' });
      return { data: null, error: null, status: 201 };
    } });
    var booking = await state.repo.createBooking(input());
    equal(booking.duration, 45);
    equal(booking.end, 585);
  });
  test('No se expone administración ni se envían solicitudes para cancelar/restaurar', async function () {
    var state = setup();
    await rejects(function () { return state.repo.cancelBooking('id'); }, 'ADMIN_DISABLED');
    await rejects(function () { return state.repo.resetDemo(); }, 'ADMIN_DISABLED');
    equal(state.clients.length, 0);
    equal(state.calls.length, 0);
  });

  (async function () {
    var passed = 0;
    for (var current of tests) {
      try { await current.run(); passed += 1; output('OK · ' + current.name); }
      catch (error) { output('ERROR · ' + current.name + ': ' + error.message); throw error; }
    }
    output(passed + '/' + tests.length + ' pruebas Supabase correctas.');
  }()).catch(function (error) {
    output(error.stack || error.message);
    if (typeof quit === 'function') quit(1);
    if (typeof process !== 'undefined') process.exitCode = 1;
  });
  if (typeof drainMicrotasks === 'function') drainMicrotasks();
}());
