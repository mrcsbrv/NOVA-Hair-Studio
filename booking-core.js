/* Motor de agenda y adaptador local. Scripts clásicos para funcionar también con file://. */
(function (global) {
  'use strict';

  var data = global.NovaData;
  var STORAGE_KEY = 'nova-hair-studio.bookings.v1';
  var LOCK_NAME = 'nova-hair-studio:bookings';
  var VERSION = 1;
  var fallbackQueue = Promise.resolve();

  function bookingError(code, message, fields) {
    var error = new Error(message);
    error.code = code;
    if (fields) error.fields = fields;
    return error;
  }

  function getService(id) {
    return data.services.find(function (service) { return service.id === id; });
  }

  function toDateKey(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw bookingError('VALIDATION_ERROR', 'La fecha no es válida.');
    }
    return String(date.getFullYear()).padStart(4, '0') + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function parseDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var parts = value.split('-').map(Number);
    var date = new Date(0);
    date.setFullYear(parts[0], parts[1] - 1, parts[2]);
    date.setHours(0, 0, 0, 0);
    return toDateKey(date) === value ? date : null;
  }

  function timeLabel(minutes) {
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  }

  /* Intervalos semiabiertos: una cita puede empezar exactamente cuando termina otra. */
  function overlaps(startA, endA, startB, endB) {
    return startA < endB && endA > startB;
  }

  function getAvailability(options) {
    var service = getService(options.serviceId);
    var date = parseDateKey(options.date);
    var now = options.now instanceof Date ? options.now : new Date();
    var bookings = options.bookings || [];
    var professionalId = options.professionalId || 'any';
    if (!service || !date || !Array.isArray(bookings)) {
      throw bookingError('VALIDATION_ERROR', 'Selecciona un servicio y una fecha válidos.');
    }
    var professionals = professionalId === 'any' ? service.professionals : [professionalId];
    if (professionals.some(function (id) { return service.professionals.indexOf(id) === -1; })) {
      throw bookingError('VALIDATION_ERROR', 'Ese profesional no realiza el servicio seleccionado.');
    }
    if (options.date < toDateKey(now)) return { status: 'past', slots: [], unavailable: [] };
    var hours = data.business.hours[date.getDay()];
    if (!hours) return { status: 'closed', slots: [], unavailable: [] };

    var slots = [];
    var unavailable = [];
    var dayBookings = bookings.filter(function (booking) { return booking.date === options.date; });
    for (var start = hours.start; start < hours.end; start += data.business.slotInterval) {
      var end = start + service.duration;
      var appointmentDate = new Date(date.getTime());
      appointmentDate.setMinutes(start);
      if (appointmentDate.getTime() < now.getTime()) {
        unavailable.push({ start: start, reason: 'Hora pasada' });
        continue;
      }
      if (end > hours.end) {
        unavailable.push({ start: start, reason: 'No cabe antes del cierre' });
        continue;
      }
      var availableCount = 0;
      professionals.forEach(function (id) {
        var busy = dayBookings.some(function (booking) {
          return booking.professionalId === id && overlaps(start, end, booking.start, booking.end);
        });
        if (!busy) {
          slots.push({ start: start, end: end, professionalId: id });
          availableCount += 1;
        }
      });
      if (!availableCount) unavailable.push({ start: start, reason: 'Ocupado' });
    }
    return { status: slots.length ? 'available' : 'full', slots: slots, unavailable: unavailable };
  }

  function validateCustomer(customer) {
    customer = customer || {};
    var errors = {};
    var name = typeof customer.name === 'string' ? customer.name.trim() : '';
    var phone = typeof customer.phone === 'string' ? customer.phone.trim() : '';
    var email = typeof customer.email === 'string' ? customer.email.trim() : '';
    var letters = name.match(/\p{L}/gu) || [];
    if (!name) errors.name = 'Escribe tu nombre.';
    else if (name.length > 80 || letters.length < 2 || !/^[\p{L}\p{M}\s.'’\-]+$/u.test(name)) {
      errors.name = 'Escribe un nombre de al menos dos letras, sin números ni símbolos.';
    }
    var normalizedPhone = phone.replace(/[\s().\-]/g, '');
    if (!phone) errors.phone = 'Escribe tu teléfono.';
    else if (phone.length > 30 || !/^(?:\+|00)?\d{9,15}$/.test(normalizedPhone)) {
      errors.phone = 'Introduce un teléfono válido, con prefijo si es internacional.';
    }
    if (!email) errors.email = 'Escribe tu email.';
    else {
      var emailParts = email.split('@');
      var emailValid = email.length <= 254 && emailParts.length === 2 &&
        emailParts[0].length > 0 && emailParts[0].length <= 64 &&
        !/(\s|^\.|\.$|\.\.)/.test(emailParts[0]) &&
        /^[^<>(),;:\\"\[\]\s]+$/.test(emailParts[0]) &&
        emailParts[1].split('.').length >= 2 &&
        emailParts[1].split('.').every(function (part) { return /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(part); }) &&
        /^[a-z]{2,63}$/i.test(emailParts[1].split('.').pop());
      if (!emailValid) errors.email = 'Introduce un email válido, por ejemplo nombre@correo.es.';
    }
    return errors;
  }

  function normalizeCustomer(customer) {
    return {
      name: customer.name.trim().replace(/\s+/g, ' '),
      phone: customer.phone.trim(),
      email: customer.email.trim().toLowerCase()
    };
  }

  function makeId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'cita-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function buildBooking(input, now) {
    var service = getService(input.serviceId);
    return {
      id: makeId(), serviceId: service.id, professionalId: input.professionalId,
      date: input.date, start: input.start, end: input.start + service.duration,
      duration: service.duration, price: service.price,
      customer: normalizeCustomer(input.customer), source: input.source || 'online',
      createdAt: now.toISOString()
    };
  }

  function createDemoBookings(now) {
    var dates = [];
    var cursor = new Date(now.getTime());
    cursor.setHours(0, 0, 0, 0);
    while (dates.length < 3) {
      cursor.setDate(cursor.getDate() + 1);
      if (data.business.hours[cursor.getDay()]) dates.push(toDateKey(cursor));
    }
    var bookings = [];
    var sequence = 0;
    function add(date, start, serviceId, professionalId) {
      sequence += 1;
      var booking = buildBooking({
        date: date, start: start, serviceId: serviceId, professionalId: professionalId, source: 'demo',
        customer: { name: 'Cliente Demo', phone: '+34 610 000 000', email: 'cliente' + sequence + '@nova.example' }
      }, now);
      booking.id = 'demo-' + date + '-' + sequence;
      bookings.push(booking);
    }
    add(dates[0], 660, 'corte-barba', 'carlos');
    add(dates[0], 660, 'tinte-raiz', 'laura');
    add(dates[0], 750, 'tratamiento', 'maria');
    add(dates[1], 540, 'balayage', 'laura');
    add(dates[1], 600, 'corte-caballero', 'carlos');
    add(dates[1], 660, 'peinado', 'maria');

    /* Un día lleno real: citas normales, compatibles y sin invadir el cierre. */
    var fullDate = dates[2];
    var hours = data.business.hours[parseDateKey(fullDate).getDay()];
    for (var start = hours.start; start + 45 <= hours.end; start += 60) {
      add(fullDate, start, 'corte-barba', 'carlos');
    }
    [{ id: 'laura', serviceId: 'balayage', duration: 150 }, { id: 'maria', serviceId: 'color-completo', duration: 120 }].forEach(function (professional) {
      var current = hours.start;
      while (current + professional.duration <= hours.end) {
        add(fullDate, current, professional.serviceId, professional.id);
        current += professional.duration;
      }
      if (current + 60 <= hours.end) add(fullDate, current, 'lavado-corte-peinado', professional.id);
    });
    return bookings;
  }

  /*
   * Único punto de persistencia. Un futuro adaptador Supabase debe conservar:
   * listBookings, createBooking, cancelBooking, resetDemo y subscribe.
   * La comprobación de solapamientos deberá ser atómica en el servidor/base de datos.
   * Nunca se reemplaza un fallo de localStorage por una persistencia ficticia en memoria.
   */
  function createRepository(options) {
    options = options || {};
    var listeners = new Set();
    var eventTarget = options.eventTarget || global;
    var hasInjectedStorage = Object.prototype.hasOwnProperty.call(options, 'storage');
    var clock = typeof options.now === 'function' ? options.now : function () { return new Date(); };
    var locks = Object.prototype.hasOwnProperty.call(options, 'locks') ? options.locks : global.navigator && global.navigator.locks;
    var attachedStorageListener = false;

    function getStorage() {
      try {
        var storage = hasInjectedStorage ? options.storage : global.localStorage;
        if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('Storage unavailable');
        return storage;
      } catch (error) {
        throw bookingError('STORAGE_ERROR', 'El navegador no permite guardar la agenda. Habilita el almacenamiento local para usar la demo.');
      }
    }

    function saveBookings(bookings) {
      try { getStorage().setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, bookings: bookings })); }
      catch (error) {
        if (error.code === 'STORAGE_ERROR') throw error;
        throw bookingError('STORAGE_ERROR', 'No se pudo guardar la agenda en este navegador. La reserva no se ha confirmado.');
      }
    }

    function isValidBooking(booking) {
      if (!booking || typeof booking !== 'object') return false;
      var service = getService(booking.serviceId);
      var date = parseDateKey(booking.date);
      var hours = date && data.business.hours[date.getDay()];
      return Boolean(service && hours && typeof booking.id === 'string' && booking.id.length > 0 &&
        service.professionals.indexOf(booking.professionalId) !== -1 &&
        Number.isInteger(booking.start) && booking.start >= hours.start &&
        (booking.start - hours.start) % data.business.slotInterval === 0 &&
        Number.isInteger(booking.duration) && booking.duration > 0 && booking.end === booking.start + booking.duration &&
        booking.end <= hours.end && Number.isFinite(booking.price) && booking.price >= 0 &&
        ['online', 'phone', 'demo'].indexOf(booking.source) !== -1 &&
        typeof booking.createdAt === 'string' && Number.isFinite(Date.parse(booking.createdAt)) &&
        Object.keys(validateCustomer(booking.customer)).length === 0);
    }

    function loadBookings() {
      var raw;
      try { raw = getStorage().getItem(STORAGE_KEY); }
      catch (error) {
        if (error.code === 'STORAGE_ERROR') throw error;
        throw bookingError('STORAGE_ERROR', 'No se puede leer la agenda guardada en este navegador.');
      }
      if (raw === null) {
        var seeded = createDemoBookings(clock());
        saveBookings(seeded);
        return seeded;
      }
      var payload;
      try { payload = JSON.parse(raw); }
      catch (error) { throw bookingError('CORRUPT_STORAGE', 'Los datos locales no se pueden leer. Puedes restaurar la demo desde Herramientas de demostración.'); }
      if (!payload || payload.version !== VERSION || !Array.isArray(payload.bookings) || !payload.bookings.every(isValidBooking)) {
        throw bookingError('CORRUPT_STORAGE', 'La agenda local contiene datos no válidos. Puedes restaurar la demo desde Herramientas de demostración.');
      }
      var ids = new Set();
      var invalid = payload.bookings.some(function (booking, index, bookings) {
        if (ids.has(booking.id)) return true;
        ids.add(booking.id);
        return bookings.slice(0, index).some(function (other) {
          return other.date === booking.date && other.professionalId === booking.professionalId &&
            overlaps(other.start, other.end, booking.start, booking.end);
        });
      });
      if (invalid) throw bookingError('CORRUPT_STORAGE', 'La agenda local contiene citas duplicadas o solapadas. Restaura los datos de demostración.');
      return payload.bookings;
    }

    function notify() {
      listeners.forEach(function (listener) {
        try { listener(); }
        catch (error) { if (global.console) global.console.error('No se pudo actualizar una vista de la agenda.', error); }
      });
    }

    function onStorage(event) {
      if (event.key === STORAGE_KEY || event.key === null) notify();
    }

    function withLock(operation) {
      // Web Locks coordina las pestañas del mismo origen; file:// depende del navegador.
      function serialOperation() {
        var result = fallbackQueue.then(operation);
        fallbackQueue = result.catch(function () {});
        return result;
      }
      if (!locks || typeof locks.request !== 'function') return serialOperation();
      return Promise.resolve().then(function () {
        return locks.request(LOCK_NAME, { mode: 'exclusive' }, operation);
      }).catch(function (error) {
        // Algunos navegadores exponen Web Locks pero lo deniegan a los archivos locales.
        if (error.name === 'SecurityError' || error.name === 'NotSupportedError') return serialOperation();
        throw error;
      });
    }

    function listBookings() {
      return withLock(function () {
        return clone(loadBookings()).sort(function (a, b) {
          return a.date.localeCompare(b.date) || a.start - b.start || a.professionalId.localeCompare(b.professionalId);
        });
      });
    }

    function createBooking(input) {
      return withLock(function () {
        if (!input || !getService(input.serviceId) || !parseDateKey(input.date) || !Number.isInteger(input.start)) {
          throw bookingError('VALIDATION_ERROR', 'Completa el servicio, la fecha y la hora de la reserva.');
        }
        var fields = validateCustomer(input.customer);
        if (Object.keys(fields).length) throw bookingError('VALIDATION_ERROR', 'Revisa los datos de contacto.', fields);
        if (input.source && ['online', 'phone'].indexOf(input.source) === -1) {
          throw bookingError('VALIDATION_ERROR', 'El origen de la reserva no es válido.');
        }
        var service = getService(input.serviceId);
        if (service.professionals.indexOf(input.professionalId) === -1) {
          throw bookingError('VALIDATION_ERROR', 'Selecciona un profesional compatible con el servicio.');
        }
        var now = clock();
        // Se vuelve a leer y comprobar justo antes de escribir, nunca desde una copia de la interfaz.
        var bookings = loadBookings();
        var availability = getAvailability({
          serviceId: input.serviceId, professionalId: input.professionalId, date: input.date, bookings: bookings, now: now
        });
        if (!availability.slots.some(function (slot) { return slot.start === input.start && slot.professionalId === input.professionalId; })) {
          throw bookingError('SLOT_UNAVAILABLE', 'Esta hora ya no está disponible. Elige otra para continuar.');
        }
        var booking = buildBooking(input, now);
        bookings.push(booking);
        saveBookings(bookings);
        notify();
        return clone(booking);
      });
    }

    function cancelBooking(id) {
      return withLock(function () {
        var bookings = loadBookings();
        var booking = bookings.find(function (item) { return item.id === id; });
        if (!booking) throw bookingError('NOT_FOUND', 'La cita ya no existe en esta agenda.');
        saveBookings(bookings.filter(function (item) { return item.id !== id; }));
        notify();
        return clone(booking);
      });
    }

    function resetDemo() {
      return withLock(function () {
        var bookings = createDemoBookings(clock());
        saveBookings(bookings);
        notify();
        return clone(bookings);
      });
    }

    function subscribe(callback) {
      if (typeof callback !== 'function') throw new TypeError('El observador de agenda debe ser una función.');
      listeners.add(callback);
      if (!attachedStorageListener && typeof eventTarget.addEventListener === 'function') {
        eventTarget.addEventListener('storage', onStorage);
        attachedStorageListener = true;
      }
      return function () {
        listeners.delete(callback);
        if (!listeners.size && attachedStorageListener && typeof eventTarget.removeEventListener === 'function') {
          eventTarget.removeEventListener('storage', onStorage);
          attachedStorageListener = false;
        }
      };
    }

    return {
      listBookings: listBookings, createBooking: createBooking, cancelBooking: cancelBooking,
      resetDemo: resetDemo, subscribe: subscribe
    };
  }

  global.NovaCore = {
    STORAGE_KEY: STORAGE_KEY,
    toDateKey: toDateKey,
    parseDateKey: parseDateKey,
    timeLabel: timeLabel,
    overlaps: overlaps,
    getAvailability: getAvailability,
    getDayState: function (options) { return getAvailability(options).status; },
    validateCustomer: validateCustomer,
    createRepository: createRepository
  };
}(typeof window !== 'undefined' ? window : globalThis));
