/* Ejecutar desde la raíz: node tests/timezone.test.js; sin dependencias.
 * También compatible con jsc. Repetir con TZ=UTC, America/Los_Angeles y Asia/Tokyo.
 */
(function () {
  'use strict';
  var output = typeof print === 'function' ? print : console.log.bind(console);
  if (typeof load === 'function') {
    load('data.js'); load('salon-time.js'); load('booking-core.js');
  } else if (typeof require === 'function') {
    require('../data.js'); require('../salon-time.js'); require('../booking-core.js');
  }
  var time = globalThis.NovaTime;
  var core = globalThis.NovaCore;
  var tests = [];
  function test(name, run) { tests.push({ name: name, run: run }); }
  function assert(value, message) { if (!value) throw new Error(message || 'La condición no se cumple.'); }
  function equal(actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(JSON.stringify(actual) + ' !== ' + JSON.stringify(expected));
  }
  function throwsCode(run, code) {
    try { run(); }
    catch (error) { equal(error.code, code); return; }
    throw new Error('Se esperaba ' + code + '.');
  }
  function available(options) {
    return core.getAvailability(Object.assign({ serviceId: 'corte-caballero', professionalId: 'carlos', bookings: [] }, options));
  }
  function hasSlot(result, start) { return result.slots.some(function (slot) { return slot.start === start; }); }

  test('Madrid determina fecha y hora al cruzar medianoche UTC', function () {
    equal(time.TIME_ZONE, 'Europe/Madrid');
    equal(time.dateKey(new Date('2026-07-06T22:30:00Z')), '2026-07-07');
    equal(time.dateKey(new Date('2026-07-06T21:30:00Z')), '2026-07-06');
    equal(time.dateKey(new Date('2026-01-11T23:30:00Z')), '2026-01-12');
    var value = time.parts(new Date('2026-07-06T22:30:45Z'));
    equal([value.year, value.month, value.day, value.hour, value.minute, value.second], [2026, 7, 7, 0, 30, 45]);
  });
  test('Un comienzo a las 09:00 se convierte a UTC con el offset de cada estación', function () {
    equal(time.toInstant('2026-01-12', 540).toISOString(), '2026-01-12T08:00:00.000Z');
    equal(time.toInstant('2026-07-06', 540).toISOString(), '2026-07-06T07:00:00.000Z');
    equal(time.toInstant('2026-03-28', 540).toISOString(), '2026-03-28T08:00:00.000Z');
    equal(time.toInstant('2026-03-30', 540).toISOString(), '2026-03-30T07:00:00.000Z');
    equal(time.toInstant('2026-10-24', 540).toISOString(), '2026-10-24T07:00:00.000Z');
    equal(time.toInstant('2026-10-26', 540).toISOString(), '2026-10-26T08:00:00.000Z');
  });
  test('Primavera rechaza la hora inexistente; otoño rechaza la hora ambigua', function () {
    throwsCode(function () { time.toInstant('2026-03-29', 150); }, 'INVALID_TIME');
    throwsCode(function () { time.toInstant('2026-10-25', 150); }, 'AMBIGUOUS_TIME');
    equal(time.toInstant('2026-03-29', 119).toISOString(), '2026-03-29T00:59:00.000Z');
    equal(time.toInstant('2026-03-29', 180).toISOString(), '2026-03-29T01:00:00.000Z');
    equal(time.toInstant('2026-10-25', 119).toISOString(), '2026-10-24T23:59:00.000Z');
    equal(time.toInstant('2026-10-25', 180).toISOString(), '2026-10-25T02:00:00.000Z');
  });
  test('Los rangos de consulta abarcan 23 y 25 horas en los cambios de horario', function () {
    var spring = time.dayRange('2026-03-29');
    var autumn = time.dayRange('2026-10-25');
    equal(spring, { startAt: '2026-03-28T23:00:00.000Z', endAt: '2026-03-29T22:00:00.000Z' });
    equal(autumn, { startAt: '2026-10-24T22:00:00.000Z', endAt: '2026-10-25T23:00:00.000Z' });
    equal((Date.parse(spring.endAt) - Date.parse(spring.startAt)) / 3600000, 23);
    equal((Date.parse(autumn.endAt) - Date.parse(autumn.startAt)) / 3600000, 25);
  });
  test('Las fechas civiles suman días sin depender de cambios de horario o mes', function () {
    equal(time.addDays('2026-03-28', 2), '2026-03-30');
    equal(time.addDays('2026-10-24', 2), '2026-10-26');
    equal(time.addDays('2028-02-28', 1), '2028-02-29');
    equal(time.addDays('2026-12-31', 1), '2027-01-01');
    equal(time.addDays('2026-01-01', -1), '2025-12-31');
    equal(core.toDateKey(core.parseDateKey('2026-07-07')), '2026-07-07');
  });
  test('Fechas y horas imposibles se rechazan sin normalización silenciosa', function () {
    ['2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '0000-01-01', '07/07/2026'].forEach(function (key) {
      throwsCode(function () { time.toInstant(key, 540); }, 'INVALID_DATE');
    });
    [-1, 1440, 540.5, NaN, '540'].forEach(function (minutes) {
      throwsCode(function () { time.toInstant('2026-07-07', minutes); }, 'INVALID_TIME');
    });
    throwsCode(function () { time.dateKey(new Date(NaN)); }, 'INVALID_DATE');
  });
  test('Los timestamps remotos de invierno y verano recuperan la misma hora del salón', function () {
    ['2026-01-12T09:30:00+00:00', '2026-07-06T08:30:00+00:00'].forEach(function (startAt) {
      var value = time.parts(startAt);
      var minutes = value.hour * 60 + value.minute;
      equal(minutes, 630);
      equal(time.toInstant(time.dateKey(startAt), minutes).getTime(), Date.parse(startAt));
    });
  });
  test('Un día pasado en Madrid queda bloqueado aunque el dispositivo aún esté en ese día', function () {
    var now = new Date('2026-07-06T22:30:00Z');
    equal(available({ date: '2026-07-06', now: now }).status, 'past');
    assert(hasSlot(available({ date: '2026-07-07', now: now }), 540));
    equal(available({ date: '2026-07-12', now: new Date('2026-07-11T22:30:00Z') }).status, 'closed');
  });
  test('Hoy descarta las horas pasadas de Madrid en ambas estaciones', function () {
    [{ date: '2026-01-12', instant: '2026-01-12T08:30:01Z' }, { date: '2026-07-06', instant: '2026-07-06T07:30:01Z' }].forEach(function (scenario) {
      var result = available({ date: scenario.date, now: new Date(scenario.instant) });
      assert(!hasSlot(result, 540));
      assert(!hasSlot(result, 570));
      assert(hasSlot(result, 600));
    });
  });
  test('El modo local calcula semillas desde mañana en Madrid y se identifica explícitamente', async function () {
    var saved = null;
    var now = new Date('2026-07-10T22:30:00Z'); // Ya es sábado en Madrid.
    var repo = core.createRepository({
      storage: { getItem: function () { return saved; }, setItem: function (key, value) { saved = value; } },
      locks: null, now: function () { return now; }
    });
    equal(repo.mode, 'local');
    var bookings = await repo.listBookings();
    equal(bookings[0].date, '2026-07-13');
    assert(bookings.every(function (booking) { return booking.date > '2026-07-11'; }));
    var created = await repo.createBooking({
      serviceId: 'corte-caballero', professionalId: 'carlos', date: '2026-07-11', start: 540,
      customer: { name: 'Ana Demo', phone: '+34 610 000 000', email: 'ana@nova.example' }
    });
    equal(created.date, '2026-07-11');
    assert(!hasSlot(available({ date: created.date, now: now, bookings: await repo.listBookings() }), 540));
  });

  (async function () {
    var failed = 0;
    for (var index = 0; index < tests.length; index += 1) {
      try { await tests[index].run(); output('✓ ' + tests[index].name); }
      catch (error) { failed += 1; output('✗ ' + tests[index].name + '\n  ' + (error.stack || error.message)); }
    }
    output('\n' + (tests.length - failed) + '/' + tests.length + ' pruebas de zona horaria correctas.');
    globalThis.NovaTimezoneTestResult = { total: tests.length, failed: failed };
    if (failed) {
      if (typeof quit === 'function') quit(1);
      else if (typeof process !== 'undefined') process.exitCode = 1;
    }
  }());
}());
