/*
 * Pruebas sin dependencias. Desde la raíz del proyecto:
 *   node tests/availability.test.js
 * o en macOS:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/availability.test.js
 */
(function () {
  'use strict';
  var output = typeof print === 'function' ? print : console.log.bind(console);
  if (typeof load === 'function') {
    load('data.js');
    load('salon-time.js');
    load('booking-core.js');
  } else if (typeof require === 'function') {
    require('../data.js');
    require('../salon-time.js');
    require('../booking-core.js');
  }
  var core = globalThis.NovaCore;
  var data = globalThis.NovaData;
  var tests = [];
  var fixedNow = new Date('2030-01-07T08:00:00+01:00'); // Lunes, hora del salón en Madrid.
  var monday = globalThis.NovaTime.dateKey(fixedNow);
  var tuesday = '2030-01-08';
  var customer = { name: 'María Pérez', phone: '+34 612 345 678', email: 'maria@example.com' };

  function test(name, run) { tests.push({ name: name, run: run }); }
  function assert(condition, message) { if (!condition) throw new Error(message || 'La condición no se cumple.'); }
  function equal(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error((message || 'Resultado inesperado') + ': ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected));
    }
  }
  function hasSlot(result, start, professionalId) {
    return result.slots.some(function (slot) { return slot.start === start && (!professionalId || slot.professionalId === professionalId); });
  }
  function availability(serviceId, bookings, overrides) {
    return core.getAvailability(Object.assign({ serviceId: serviceId, professionalId: 'any', date: monday, bookings: bookings || [], now: fixedNow }, overrides || {}));
  }
  function memoryStorage(empty) {
    var values = {};
    if (empty !== false) values[core.STORAGE_KEY] = JSON.stringify({ version: 1, bookings: [] });
    return {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
      setItem: function (key, value) { values[key] = String(value); },
      removeItem: function (key) { delete values[key]; }
    };
  }
  function repository(storage, options) {
    return core.createRepository(Object.assign({ storage: storage || memoryStorage(), now: function () { return new Date(fixedNow); }, locks: null }, options || {}));
  }
  function input(overrides) {
    return Object.assign({ serviceId: 'corte-caballero', professionalId: 'carlos', date: monday, start: 540, customer: Object.assign({}, customer), source: 'online' }, overrides || {});
  }
  async function rejectsCode(operation, code) {
    try { await operation(); }
    catch (error) { equal(error.code, code); return error; }
    throw new Error('Se esperaba el error ' + code + '.');
  }

  test('Datos completos: diez servicios y dos reseñas ficticias por servicio', function () {
    equal(data.services.length, 10);
    equal(data.professionals.length, 3);
    data.services.forEach(function (service) {
      equal(data.reviews.filter(function (review) { return review.serviceId === service.id; }).length, 2);
      assert(service.professionals.every(function (id) { return data.professionals.some(function (person) { return person.id === id; }); }));
    });
  });
  test('Fechas locales, año bisiesto y fechas imposibles', function () {
    equal(core.toDateKey(core.parseDateKey('2032-02-29')), '2032-02-29');
    equal(core.parseDateKey('2030-02-29'), null);
    equal(core.parseDateKey('2030-04-31'), null);
    equal(core.parseDateKey('2030-13-01'), null);
    equal(core.parseDateKey('08/01/2030'), null);
    equal(core.timeLabel(570), '09:30');
  });
  test('Solapamientos detectan intersección y contención, permiten límites contiguos', function () {
    assert(core.overlaps(540, 630, 600, 660));
    assert(core.overlaps(540, 720, 600, 630));
    assert(core.overlaps(600, 630, 540, 720));
    assert(!core.overlaps(540, 600, 600, 630));
    assert(!core.overlaps(630, 660, 600, 630));
  });
  test('Servicio de 30 minutos ofrece todo el intervalo libre hasta el cierre', function () {
    var result = availability('corte-caballero');
    equal(result.status, 'available');
    equal(result.slots.length, 22);
    assert(hasSlot(result, 540, 'carlos'));
    assert(hasSlot(result, 1170, 'carlos'));
    assert(!hasSlot(result, 1200));
    assert(result.slots.every(function (slot) { return slot.end - slot.start === 30 && slot.end <= 1200; }));
  });
  test('Una cita de 30 minutos bloquea solo el intervalo afectado', function () {
    var bookings = [{ date: monday, professionalId: 'maria', start: 660, end: 690 }];
    var result = availability('peinado', bookings);
    assert(hasSlot(result, 600));
    assert(hasSlot(result, 630));
    assert(!hasSlot(result, 660));
    assert(hasSlot(result, 690));
  });
  test('Servicio de 90 minutos necesita sus 90 minutos libres', function () {
    var bookings = [{ date: monday, professionalId: 'maria', start: 660, end: 690 }];
    var result = availability('tinte-raiz', bookings, { professionalId: 'maria' });
    assert(hasSlot(result, 540));
    assert(hasSlot(result, 570)); // Termina justo a las 11:00.
    assert(!hasSlot(result, 600)); // 10:00–11:30 invadiría la cita.
    assert(!hasSlot(result, 630));
    assert(!hasSlot(result, 660));
    assert(hasSlot(result, 690));
    assert(hasSlot(result, 1110)); // 18:30–20:00 es válido.
    assert(!hasSlot(result, 1140));
  });
  test('Duraciones de 45 minutos mantienen su final exacto con comienzos cada 30', function () {
    var result = availability('corte-barba', [{ date: monday, professionalId: 'carlos', start: 540, end: 585 }]);
    assert(!hasSlot(result, 540));
    assert(!hasSlot(result, 570));
    assert(hasSlot(result, 600));
    assert(result.slots.every(function (slot) { return slot.end - slot.start === 45; }));
  });
  test('Sábados cierran a las 14:00 y los domingos no tienen citas', function () {
    var saturday = availability('balayage', [], { date: '2030-01-12' });
    assert(hasSlot(saturday, 690));
    assert(!hasSlot(saturday, 720));
    assert(saturday.slots.every(function (slot) { return slot.end <= 840; }));
    equal(availability('corte-caballero', [], { date: '2030-01-13' }).status, 'closed');
  });
  test('Se excluyen días anteriores y horas que ya han empezado hoy', function () {
    equal(availability('corte-caballero', [], { date: '2030-01-05' }).status, 'past');
    var result = availability('corte-caballero', [], { now: new Date('2030-01-07T10:15:00+01:00') });
    assert(!hasSlot(result, 600));
    assert(hasSlot(result, 630));
    var elapsed = availability('corte-caballero', [], { now: new Date('2030-01-07T09:00:01+01:00') });
    assert(!hasSlot(elapsed, 540));
    equal(availability('corte-caballero', [], { now: new Date('2030-01-07T20:00:00+01:00') }).status, 'full');
  });
  test('Cualquiera disponible combina profesionales compatibles y conserva la asignación', function () {
    var result = availability('corte-mujer', [{ date: monday, professionalId: 'laura', start: 540, end: 600 }]);
    assert(!hasSlot(result, 540, 'laura'));
    assert(hasSlot(result, 540, 'maria'));
    assert(hasSlot(result, 600, 'laura'));
    assert(hasSlot(result, 600, 'maria'));
    assert(!result.slots.some(function (slot) { return slot.professionalId === 'carlos'; }));
  });
  test('Citas de otro día o profesional no bloquean al seleccionado', function () {
    var result = availability('corte-caballero', [
      { date: monday, professionalId: 'laura', start: 540, end: 1200 },
      { date: tuesday, professionalId: 'carlos', start: 540, end: 1200 }
    ]);
    equal(result.slots.length, 22);
  });
  test('Un día lleno para 150 minutos puede mantener huecos para 45 minutos', function () {
    var bookings = [
      { date: monday, professionalId: 'laura', start: 630, end: 900 },
      { date: monday, professionalId: 'laura', start: 990, end: 1200 }
    ];
    equal(availability('balayage', bookings).status, 'full');
    assert(hasSlot(availability('corte-mujer', bookings, { professionalId: 'laura' }), 540));
    assert(hasSlot(availability('corte-mujer', bookings, { professionalId: 'laura' }), 900));
  });
  test('Un día lleno para 90 minutos puede mantener huecos para 30 minutos', function () {
    var bookings = [
      { date: monday, professionalId: 'maria', start: 600, end: 900 },
      { date: monday, professionalId: 'maria', start: 960, end: 1200 }
    ];
    equal(availability('tinte-raiz', bookings, { professionalId: 'maria' }).status, 'full');
    assert(hasSlot(availability('peinado', bookings), 540));
    assert(hasSlot(availability('peinado', bookings), 930));
  });
  test('Nombres, teléfono y email obligatorios y validados', function () {
    equal(Object.keys(core.validateCustomer({})).sort(), ['email', 'name', 'phone']);
    equal(core.validateCustomer(customer), {});
    equal(core.validateCustomer({ name: 'Ana-María O’Neill', phone: '0034 612 345 678', email: 'ana.maria+reserva@example.es' }), {});
    assert(core.validateCustomer({ name: 'A', phone: '123', email: 'no-es-email' }).name);
    assert(core.validateCustomer({ name: '1234', phone: '612 abc 789', email: 'a..b@example.com' }).phone);
    assert(core.validateCustomer({ name: 'Ana', phone: '612345678', email: 'ana@-correo.es' }).email);
    assert(core.validateCustomer({ name: 'Ana', phone: '612345678', email: 'ana@correo' }).email);
  });
  test('Crear una reserva de 30 minutos guarda sus datos calculados y quita disponibilidad', async function () {
    var repo = repository();
    var created = await repo.createBooking(input());
    equal(created.start, 540);
    equal(created.end, 570);
    equal(created.duration, 30);
    equal(created.price, 18);
    assert(created.id);
    var bookings = await repo.listBookings();
    equal(bookings.length, 1);
    assert(!hasSlot(availability('corte-caballero', bookings), 540));
    assert(hasSlot(availability('corte-caballero', bookings), 570));
  });
  test('Revalidación al confirmar rechaza una hora ocupada desde otra instancia', async function () {
    var storage = memoryStorage();
    var first = repository(storage);
    var second = repository(storage);
    assert(hasSlot(availability('corte-caballero', await first.listBookings()), 540));
    await second.createBooking(input());
    await rejectsCode(function () { return first.createBooking(input()); }, 'SLOT_UNAVAILABLE');
    equal((await first.listBookings()).length, 1);
  });
  test('Altas simultáneas locales: solo una obtiene la misma hora', async function () {
    var storage = memoryStorage();
    var first = repository(storage);
    var second = repository(storage);
    var results = await Promise.allSettled([first.createBooking(input()), second.createBooking(input())]);
    equal(results.filter(function (result) { return result.status === 'fulfilled'; }).length, 1);
    equal(results.filter(function (result) { return result.status === 'rejected'; })[0].reason.code, 'SLOT_UNAVAILABLE');
    equal((await first.listBookings()).length, 1);
  });
  test('Una reserva de 90 minutos bloquea todas las horas que la invadirían', async function () {
    var repo = repository();
    var created = await repo.createBooking(input({ serviceId: 'tinte-raiz', professionalId: 'maria', start: 600 }));
    equal(created.end, 690);
    var result = availability('peinado', await repo.listBookings());
    assert(hasSlot(result, 570));
    assert(!hasSlot(result, 600));
    assert(!hasSlot(result, 630));
    assert(!hasSlot(result, 660));
    assert(hasSlot(result, 690));
    await rejectsCode(function () {
      return repo.createBooking(input({ serviceId: 'tinte-raiz', professionalId: 'maria', start: 570 }));
    }, 'SLOT_UNAVAILABLE');
  });
  test('Cancelar una cita devuelve inmediatamente su disponibilidad', async function () {
    var repo = repository();
    var created = await repo.createBooking(input());
    await repo.cancelBooking(created.id);
    equal((await repo.listBookings()).length, 0);
    assert(hasSlot(availability('corte-caballero', await repo.listBookings()), 540));
    await rejectsCode(function () { return repo.cancelBooking(created.id); }, 'NOT_FOUND');
  });
  test('Una cita telefónica persiste y bloquea el mismo calendario público', async function () {
    var storage = memoryStorage();
    var repo = repository(storage);
    var created = await repo.createBooking(input({ source: 'phone' }));
    equal(created.source, 'phone');
    var reloaded = repository(storage);
    var bookings = await reloaded.listBookings();
    equal(bookings[0].id, created.id);
    assert(!hasSlot(availability('corte-caballero', bookings), 540));
    await reloaded.cancelBooking(created.id);
    assert(hasSlot(availability('corte-caballero', await repo.listBookings()), 540));
  });
  test('Reservas contiguas y profesionales distintos se permiten', async function () {
    var repo = repository();
    await repo.createBooking(input());
    await repo.createBooking(input({ start: 570 }));
    await repo.createBooking(input({ serviceId: 'peinado', professionalId: 'maria' }));
    equal((await repo.listBookings()).length, 3);
  });
  test('No se guardan reservas antes de abrir, tras el cierre, en domingo o en el pasado', async function () {
    var repo = repository();
    var invalidInputs = [
      input({ start: 510 }), input({ start: 1200 }), input({ start: 550 }),
      input({ date: '2030-01-06' }), input({ date: '2030-01-13' }),
      input({ date: '2030-01-12', start: 840 }),
      input({ serviceId: 'tinte-raiz', professionalId: 'laura', start: 1140 })
    ];
    for (var index = 0; index < invalidInputs.length; index += 1) {
      await rejectsCode(function () { return repo.createBooking(invalidInputs[index]); }, 'SLOT_UNAVAILABLE');
    }
    equal((await repo.listBookings()).length, 0);
  });
  test('Validar formulario y compatibilidad falla antes de guardar', async function () {
    var repo = repository();
    var error = await rejectsCode(function () { return repo.createBooking(input({ customer: {} })); }, 'VALIDATION_ERROR');
    equal(Object.keys(error.fields).sort(), ['email', 'name', 'phone']);
    await rejectsCode(function () { return repo.createBooking(input({ professionalId: 'laura' })); }, 'VALIDATION_ERROR');
    await rejectsCode(function () { return repo.createBooking(input({ professionalId: 'any' })); }, 'VALIDATION_ERROR');
    await rejectsCode(function () { return repo.createBooking(input({ serviceId: 'inexistente' })); }, 'VALIDATION_ERROR');
    equal((await repo.listBookings()).length, 0);
  });
  test('Una hora se vuelve a rechazar si ya ha pasado al pulsar confirmar', async function () {
    var now = new Date(fixedNow);
    var repo = repository(null, { now: function () { return new Date(now); } });
    assert(hasSlot(availability('corte-caballero'), 540));
    now = new Date('2030-01-07T09:00:01+01:00');
    await rejectsCode(function () { return repo.createBooking(input()); }, 'SLOT_UNAVAILABLE');
    equal((await repo.listBookings()).length, 0);
  });
  test('Los datos demo se crean una sola vez y siempre en próximos días laborales', async function () {
    var storage = memoryStorage(false);
    var repo = repository(storage);
    var initial = await repo.listBookings();
    assert(initial.length >= 10);
    assert(initial.every(function (booking) { return booking.date > monday && core.parseDateKey(booking.date).getDay() !== 0; }));
    equal(await repository(storage).listBookings(), initial);
    var newBooking = await repo.createBooking(input());
    assert((await repository(storage).listBookings()).some(function (booking) { return booking.id === newBooking.id; }));
    var reset = await repo.resetDemo();
    assert(!reset.some(function (booking) { return booking.id === newBooking.id; }));
    equal(reset.length, initial.length);
  });
  test('Semillas desde viernes, sábado y domingo respetan jornadas y duraciones', async function () {
    for (var day = 11; day <= 13; day += 1) {
      var now = new Date('2030-01-' + String(day).padStart(2, '0') + 'T18:00:00+01:00');
      var repo = repository(memoryStorage(false), { now: function () { return new Date(now); } });
      var initial = await repo.listBookings();
      equal((await repo.listBookings()).length, initial.length); // Valida también la lectura del documento guardado.
      assert(initial.every(function (booking) {
        var date = core.parseDateKey(booking.date);
        var hours = data.business.hours[date.getDay()];
        return booking.date > globalThis.NovaTime.dateKey(now) && hours && booking.start >= hours.start && booking.end <= hours.end;
      }));
      var fullDate = initial.map(function (booking) { return booking.date; }).sort().pop();
      data.services.forEach(function (service) {
        equal(core.getAvailability({ serviceId: service.id, professionalId: 'any', date: fullDate, bookings: initial, now: now }).status, 'full');
      });
    }
  });
  test('Las suscripciones avisan de alta, cancelación, restauración y storage externo', async function () {
    var storageHandler;
    var calls = 0;
    var removals = 0;
    var eventTarget = {
      addEventListener: function (type, callback) { equal(type, 'storage'); storageHandler = callback; },
      removeEventListener: function (type, callback) { equal(callback, storageHandler); removals += 1; }
    };
    var repo = repository(null, { eventTarget: eventTarget });
    var unsubscribe = repo.subscribe(function () { calls += 1; });
    var created = await repo.createBooking(input());
    await repo.cancelBooking(created.id);
    await repo.resetDemo();
    equal(calls, 3);
    storageHandler({ key: 'otro-proyecto' });
    equal(calls, 3);
    storageHandler({ key: core.STORAGE_KEY });
    storageHandler({ key: null });
    equal(calls, 5);
    unsubscribe();
    equal(removals, 1);
    await repo.resetDemo();
    equal(calls, 5);
  });
  test('Fallo de almacenamiento no confirma ni mantiene una reserva ficticia en memoria', async function () {
    var storage = memoryStorage();
    var repo = repository(storage);
    var notifications = 0;
    repo.subscribe(function () { notifications += 1; });
    var setItem = storage.setItem;
    storage.setItem = function () { throw new Error('QuotaExceededError'); };
    await rejectsCode(function () { return repo.createBooking(input()); }, 'STORAGE_ERROR');
    equal(notifications, 0);
    storage.setItem = setItem;
    equal((await repo.listBookings()).length, 0);
    await rejectsCode(function () { return repository(null, { storage: null }).listBookings(); }, 'STORAGE_ERROR');
  });
  test('Almacenamiento corrupto se informa y puede recuperarse mediante restauración', async function () {
    var storage = memoryStorage();
    storage.setItem(core.STORAGE_KEY, '{json roto');
    var repo = repository(storage);
    await rejectsCode(function () { return repo.listBookings(); }, 'CORRUPT_STORAGE');
    var seeded = await repo.resetDemo();
    assert(seeded.length > 0);
    equal((await repo.listBookings()).length, seeded.length);
    var duplicate = Object.assign({}, seeded[0], { id: 'duplicada' });
    storage.setItem(core.STORAGE_KEY, JSON.stringify({ version: 1, bookings: seeded.concat(duplicate) }));
    await rejectsCode(function () { return repo.listBookings(); }, 'CORRUPT_STORAGE');
  });
  test('Las copias devueltas no permiten cambiar datos persistidos accidentalmente', async function () {
    var repo = repository();
    var created = await repo.createBooking(input());
    created.customer.name = 'Modificado';
    var first = await repo.listBookings();
    equal(first[0].customer.name, customer.name);
    first[0].start = 900;
    equal((await repo.listBookings())[0].start, 540);
  });
  test('Web Locks se usa si existe y file:// puede recurrir a la cola local', async function () {
    var calls = 0;
    var repo = repository(null, { locks: { request: function (name, options, operation) { calls += 1; equal(options.mode, 'exclusive'); return Promise.resolve(operation()); } } });
    await repo.createBooking(input());
    equal((await repo.listBookings()).length, 1);
    equal(calls, 2);
    var denied = repository(null, { locks: { request: function () { var error = new Error('Origen local'); error.name = 'SecurityError'; return Promise.reject(error); } } });
    await denied.createBooking(input());
    equal((await denied.listBookings()).length, 1);
  });

  (async function () {
    var failed = 0;
    for (var index = 0; index < tests.length; index += 1) {
      try { await tests[index].run(); output('✓ ' + tests[index].name); }
      catch (error) { failed += 1; output('✗ ' + tests[index].name + '\n  ' + (error.stack || error.message)); }
    }
    output('\n' + (tests.length - failed) + '/' + tests.length + ' pruebas correctas.');
    globalThis.NovaTestResult = { total: tests.length, failed: failed };
    if (failed) {
      if (typeof quit === 'function') quit(1);
      else if (typeof process !== 'undefined') process.exitCode = 1;
    }
  }());
}());
