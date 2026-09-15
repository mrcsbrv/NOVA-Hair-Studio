/* Adaptador público: solo intervalos ocupados; nunca lee datos de otros clientes. */
(function (global) {
  'use strict';

  var core = global.NovaCore;
  var time = global.NovaTime;
  var data = global.NovaData;
  var PUBLIC_COLUMNS = 'professional_id,start_at,end_at,status';
  var PUBLIC_BLOCK_COLUMNS = 'professional_id,start_at,end_at,active';
  var PAGE_SIZE = 200;
  var MAX_ROWS = 20000;
  var REQUEST_TIMEOUT = 15000;
  var sharedClient = null;
  var sharedConfiguration = null;
  var safeErrors = new WeakSet();

  function fail(code, message, fields) {
    var error = new Error(message);
    error.code = code;
    if (fields) error.fields = fields;
    safeErrors.add(error);
    return error;
  }

  function configurationError() {
    return fail('CONFIG_ERROR', 'No se pudo conectar la configuración de Supabase. Revisa Project URL y Publishable key en supabase-config.js y la carga de la biblioteca.');
  }

  function connectionError() {
    return fail('CONNECTION_ERROR', 'Error de conexión. No se pudo comprobar toda la disponibilidad. Vuelve a intentarlo.');
  }

  function unavailableError() {
    return fail('SLOT_UNAVAILABLE', 'Este horario acaba de dejar de estar disponible.');
  }

  function uncertainError() {
    return fail('BOOKING_UNCERTAIN', 'Se perdió la respuesta del servidor. La reserva podría haberse guardado. Comprueba con el salón antes de volver a reservar.');
  }

  /* No se propagan message/details/hint del servidor: pueden contener datos privados. */
  function serverError(error, status, mutation) {
    var code = error && String(error.code || '');
    var message = error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
    if (code === '23P01' || code === 'HORARIO_BLOQUEADO' || (code === 'P0001' && /horario_bloqueado|overlap|solap|not available|unavailable|no (?:est[aá] )?disponible|no (?:est[aá] )?libre|past|pasad[oa]|already booked|ya reservad/.test(message))) {
      return unavailableError();
    }
    if (status === 401 || status === 403 || ['42501', '42P01', '42703', 'PGRST204', 'PGRST301', 'PGRST302'].indexOf(code) !== -1) {
      return configurationError();
    }
    if (/^(?:22|23)/.test(code) || code === 'P0001') {
      return fail('VALIDATION_ERROR', 'El servidor no ha aceptado estos datos. Revisa el servicio, profesional, fecha y datos de contacto.');
    }
    if (mutation && (!status || status >= 500 || status === 408)) return uncertainError();
    return connectionError();
  }

  function isUnconfigured(value, placeholder) {
    // Solo placeholders/vacíos explícitos activan la demo. Un archivo ausente o
    // con un error de sintaxis no debe convertir una web remota en una agenda local.
    return typeof value === 'string' && (!value.trim() || value.trim() === placeholder);
  }

  function validConfiguration(url, key) {
    // Solo una URL HTTPS sin credenciales, rutas ni parámetros; la clave pública nueva evita confundir tipos de clave.
    return typeof url === 'string' && /^https:\/\/[a-z\d](?:[a-z\d.-]*[a-z\d])?(?::\d{1,5})?\/?$/i.test(url) &&
      typeof key === 'string' && /^sb_publishable_[a-z\d_-]+$/i.test(key);
  }

  function getClient(config, sdk, mode) {
    if (!validConfiguration(config.url, config.key) || !sdk || typeof sdk.createClient !== 'function') throw configurationError();
    var identity = config.url + '\n' + config.key + '\n' + (mode || 'public');
    if (sharedClient) {
      if (sharedConfiguration !== identity) throw configurationError();
      return sharedClient;
    }
    try {
      sharedClient = sdk.createClient(config.url, config.key, {
        // Cada página usa un solo cliente. El público nunca recupera la sesión privada.
        auth: mode === 'admin' ? {
          persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'nova-admin-auth-v1'
        } : { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        db: { retry: false }
      });
      if (!sharedClient || typeof sharedClient.from !== 'function') throw configurationError();
      sharedConfiguration = identity;
      return sharedClient;
    } catch (error) {
      sharedClient = null;
      throw configurationError();
    }
  }

  async function execute(query, mutation, privateAccess) {
    // v2 recientes reintentan también POST: una reserva no se retransmite automáticamente.
    if (typeof query.retry === 'function') query = query.retry(false);
    var timer = null;
    var controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
    if (controller && typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);
    var timeout;
    if (typeof global.setTimeout === 'function' && typeof global.clearTimeout === 'function') {
      timeout = new Promise(function (_, reject) {
        timer = global.setTimeout(function () {
          if (controller) controller.abort();
          reject(mutation ? uncertainError() : connectionError());
        }, REQUEST_TIMEOUT);
      });
    }
    try {
      var response = await (timeout ? Promise.race([Promise.resolve(query), timeout]) : query);
      if (!response || typeof response !== 'object') throw mutation ? uncertainError() : connectionError();
      if (privateAccess && (response.status === 401 || response.status === 403 ||
        (response.error && ['42501', 'PGRST301', 'PGRST302'].indexOf(String(response.error.code)) !== -1))) {
        throw fail('AUTH_REQUIRED', 'Inicia sesión de nuevo para acceder a la agenda.');
      }
      if (response.error) throw serverError(response.error, response.status, mutation);
      if (mutation && !Number.isInteger(response.status)) throw uncertainError();
      if (response.status && (response.status < 200 || response.status >= 300)) throw serverError(null, response.status, mutation);
      return response;
    } catch (error) {
      if (error && safeErrors.has(error)) throw error;
      throw mutation ? uncertainError() : connectionError();
    } finally {
      if (timer !== null && typeof global.clearTimeout === 'function') global.clearTimeout(timer);
    }
  }

  function validateRange(range) {
    if (!range || !core.parseDateKey(range.startDate) || !core.parseDateKey(range.endDate) || range.startDate >= range.endDate ||
      range.endDate > time.addDays(range.startDate, 62)) {
      throw fail('VALIDATION_ERROR', 'Selecciona un rango válido de hasta 62 días para consultar la agenda.');
    }
    return { start: time.dayRange(range.startDate).startAt, end: time.dayRange(range.endDate).startAt };
  }

  function normalizedId(id) {
    if (typeof id === 'string' && id.trim()) return id.trim();
    if (typeof id === 'number' && Number.isSafeInteger(id)) return String(id);
    return null;
  }

  function databaseId(record) {
    // supabaseId admite UUID/texto o enteros. No se sustituye un mapping vacío/incorrecto por el ID local.
    var id = record && (Object.prototype.hasOwnProperty.call(record, 'supabaseId') ? record.supabaseId : record.id);
    if (normalizedId(id) === null) throw configurationError();
    return typeof id === 'string' ? id.trim() : id;
  }

  function validateMappings() {
    // Incluso con una agenda vacía, dos entradas locales no pueden apuntar a la misma entrada de BD.
    [data.professionals, data.services].forEach(function (records) {
      var ids = new Set();
      records.forEach(function (record) {
        var id = normalizedId(databaseId(record));
        if (ids.has(id)) throw fail('CONFIG_ERROR', 'Hay correspondencias de Supabase duplicadas. Revisa los campos supabaseId de data.js.');
        ids.add(id);
      });
    });
  }

  function professionalFromDatabase(id) {
    var normalized = normalizedId(id);
    if (normalized === null) throw connectionError();
    var matches = data.professionals.filter(function (person) { return normalizedId(databaseId(person)) === normalized; });
    if (matches.length !== 1) {
      throw fail('CONFIG_ERROR', 'La agenda contiene un profesional sin correspondencia. Revisa los campos supabaseId de data.js.');
    }
    return matches[0].id;
  }

  function splitInterval(row, range, professionalId) {
    var startAt = row && new Date(row.start_at);
    var endAt = row && new Date(row.end_at);
    // Sin offset explícito, Date interpretaría la hora en la zona del dispositivo y abriría huecos incorrectos.
    var timestampWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
    if (!row ||
      typeof row.start_at !== 'string' || typeof row.end_at !== 'string' ||
      !timestampWithZone.test(row.start_at) || !timestampWithZone.test(row.end_at) ||
      !Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || startAt >= endAt) throw connectionError();
    var firstDate = time.dateKey(startAt);
    var lastDate = time.dateKey(endAt);
    var cursor = firstDate < range.startDate ? range.startDate : firstDate;
    var result = [];
    // Recortamos intervalos que crucen el borde del rango o la medianoche sin inventar datos de reserva.
    while (cursor < range.endDate && cursor <= lastDate) {
      var startParts = cursor === firstDate ? time.parts(startAt) : null;
      var endParts = cursor === lastDate ? time.parts(endAt) : null;
      var start = startParts ? startParts.hour * 60 + startParts.minute + startParts.second / 60 + startAt.getUTCMilliseconds() / 60000 : 0;
      var end = endParts ? endParts.hour * 60 + endParts.minute + endParts.second / 60 + endAt.getUTCMilliseconds() / 60000 : 1440;
      if (end > start) result.push({ professionalId: professionalId, date: cursor, start: start, end: end });
      cursor = time.addDays(cursor, 1);
    }
    return result;
  }

  function intervalRows(row, range) {
    if (!row || row.status !== 'confirmed' || normalizedId(row.professional_id) === null) throw connectionError();
    return splitInterval(row, range, professionalFromDatabase(row.professional_id));
  }

  function blockRows(row, range) {
    if (!row || row.active !== true || (row.professional_id !== null && normalizedId(row.professional_id) === null)) throw connectionError();
    return splitInterval(row, range, row.professional_id === null ? null : professionalFromDatabase(row.professional_id));
  }

  function createRemoteRepository(config, options) {
    var listeners = new Set();
    var clock = typeof options.now === 'function' ? options.now : function () { return new Date(); };
    // Solo metadatos públicos de escrituras confirmadas aún no observadas. Si RLS oculta la fila,
    // una lectura vacía no vuelve a ofrecer su hora. Nunca se persisten ni se inventan ocupaciones.
    var pendingConfirmations = [];

    function client() { return getClient(config, options.sdk || global.supabase); }

    function notify() {
      listeners.forEach(function (callback) {
        try { callback(); } catch (error) { /* Un observador no convierte una reserva guardada en un fallo. */ }
      });
    }

    async function listBookings(range) {
      try {
        var supabase = client();
        validateMappings();
        var bounds = validateRange(range);
        var rows = [];
        var expectedCount = null;
        var seen = new Set();
        while (true) {
          var query = supabase.from('nova_bookings').select(PUBLIC_COLUMNS, { count: 'exact' })
            .eq('status', 'confirmed').lt('start_at', bounds.end).gt('end_at', bounds.start)
            .order('start_at', { ascending: true }).order('professional_id', { ascending: true }).order('end_at', { ascending: true })
            .range(rows.length, rows.length + PAGE_SIZE - 1);
          var response = await execute(query, false);
          if (!Array.isArray(response.data) || !Number.isInteger(response.count) || response.count < 0 || response.count > MAX_ROWS) throw connectionError();
          if (expectedCount === null) expectedCount = response.count;
          if (response.count !== expectedCount || rows.length + response.data.length > expectedCount) throw connectionError();
          response.data.forEach(function (row) {
            var signature = row && JSON.stringify([row.professional_id, row.start_at, row.end_at]);
            if (!signature || seen.has(signature)) throw connectionError();
            seen.add(signature);
            rows.push(row);
          });
          if (rows.length === expectedCount) break;
          if (!response.data.length) throw connectionError();
          // Se avanza por lo recibido, no por 1000 ni por PAGE_SIZE: respeta límites reducidos del servidor.
        }
        // PostgREST no ofrece snapshot entre páginas; cambios detectados invalidan toda la lectura.
        // La última comprobación y la exclusión atómica en BD siguen siendo obligatorias al reservar.
        var bookings = rows.reduce(function (bookings, row) { return bookings.concat(intervalRows(row, range)); }, []);
        var confirmationsInRange = pendingConfirmations.filter(function (confirmation) {
          return confirmation.date >= range.startDate && confirmation.date < range.endDate;
        });
        var allVisible = confirmationsInRange.every(function (confirmation) {
          return bookings.some(function (booking) {
            return booking.professionalId === confirmation.professionalId && booking.date === confirmation.date && booking.start === confirmation.start;
          });
        });
        if (!allVisible) throw fail('CONNECTION_ERROR', 'La reserva se ha guardado, pero la agenda todavía no permite verificar el horario. Actualiza la disponibilidad.');
        pendingConfirmations = pendingConfirmations.filter(function (confirmation) { return confirmationsInRange.indexOf(confirmation) === -1; });
        return bookings;
      } catch (error) {
        if (error && safeErrors.has(error)) throw error;
        throw connectionError();
      }
    }

    async function listBlocks(range) {
      try {
        var supabase = client();
        validateMappings();
        var bounds = validateRange(range);
        var rows = [];
        var expectedCount = null;
        while (true) {
          var response = await execute(supabase.from('nova_blocks').select(PUBLIC_BLOCK_COLUMNS, { count: 'exact' })
            .eq('active', true).lt('start_at', bounds.end).gt('end_at', bounds.start)
            .order('start_at', { ascending: true }).order('professional_id', { ascending: true, nullsFirst: true }).order('end_at', { ascending: true })
            .range(rows.length, rows.length + PAGE_SIZE - 1), false);
          if (!Array.isArray(response.data) || !Number.isInteger(response.count) || response.count < 0 || response.count > MAX_ROWS) throw connectionError();
          if (expectedCount === null) expectedCount = response.count;
          if (response.count !== expectedCount || rows.length + response.data.length > expectedCount) throw connectionError();
          rows = rows.concat(response.data);
          if (rows.length === expectedCount) break;
          if (!response.data.length) throw connectionError();
        }
        var seen = new Set();
        return rows.reduce(function (blocks, row) {
          // Dos bloques administrativos pueden cubrir exactamente el mismo intervalo.
          // La paginación cuenta todas las filas; solo se deduplica su efecto público.
          blockRows(row, range).forEach(function (interval) {
            var signature = JSON.stringify([interval.professionalId, interval.date, interval.start, interval.end]);
            if (!seen.has(signature)) { seen.add(signature); blocks.push(interval); }
          });
          return blocks;
        }, []);
      } catch (error) {
        if (error && safeErrors.has(error)) throw error;
        throw connectionError();
      }
    }

    async function listAvailability(range) {
      // Una lectura parcial jamás se publica como disponibilidad completa.
      var result = await Promise.all([listBookings(range), listBlocks(range)]);
      return { bookings: result[0], blocks: result[1] };
    }

    async function createBooking(input) {
      var mutationStarted = false;
      try {
        var supabase = client();
        // Congela los valores de la solicitud antes de esperar a la red.
        input = input && {
          serviceId: input.serviceId, professionalId: input.professionalId, date: input.date, start: input.start, source: input.source,
          customer: input.customer && { name: input.customer.name, phone: input.customer.phone, email: input.customer.email }
        };
        var service = input && data.services.find(function (item) { return item.id === input.serviceId; });
        var person = input && data.professionals.find(function (item) { return item.id === input.professionalId; });
        if (!service || !person || !core.parseDateKey(input.date) || !Number.isInteger(input.start) || service.professionals.indexOf(person.id) === -1) {
          throw fail('VALIDATION_ERROR', 'Completa el servicio, profesional, fecha y hora de la reserva.');
        }
        var fields = core.validateCustomer(input.customer);
        if (Object.keys(fields).length) throw fail('VALIDATION_ERROR', 'Revisa los datos de contacto.', fields);
        if (input.source && input.source !== 'online') throw fail('ADMIN_DISABLED', 'Las citas telefónicas se gestionan únicamente desde una agenda privada.');
        validateMappings();
        var range = { startDate: input.date, endDate: time.addDays(input.date, 1) };
        var occupied = await listAvailability(range);
        var availability = core.getAvailability({ serviceId: service.id, professionalId: person.id, date: input.date, bookings: occupied.bookings, blocks: occupied.blocks, now: clock() });
        if (!availability.slots.some(function (slot) { return slot.start === input.start && slot.professionalId === person.id; })) throw unavailableError();
        var customer = {
          name: input.customer.name.trim().replace(/\s+/g, ' '), phone: input.customer.phone.trim(), email: input.customer.email.trim().toLowerCase()
        };
        var payload = {
          service_id: databaseId(service), professional_id: databaseId(person), start_at: time.toInstant(input.date, input.start).toISOString(),
          customer_name: customer.name, customer_phone: customer.phone, customer_email: customer.email
        };
        // INSERT sin .select(): RLS y permisos de columna impiden devolver los datos privados.
        // end_at/status/id/created_at se calculan en BD; nunca se mandan desde la web.
        var insertion = supabase.from('nova_bookings').insert(payload);
        mutationStarted = true;
        await execute(insertion, true);
        pendingConfirmations.push({ professionalId: person.id, date: input.date, start: input.start });
        var summary = {
          serviceId: service.id, professionalId: person.id, date: input.date, start: input.start, end: input.start + service.duration,
          duration: service.duration, price: service.price, customer: customer
        };
        // El resumen procede exclusivamente de esta solicitud y vive en memoria, sin fingir un ID del servidor.
        try {
          var refreshed = await listBookings(range);
          var occupied = refreshed.find(function (booking) {
            return booking.professionalId === summary.professionalId && booking.date === summary.date && booking.start === summary.start;
          });
          if (!occupied) throw connectionError();
          summary.end = occupied.end; summary.duration = occupied.end - summary.start;
        }
        catch (error) { summary.refreshWarning = 'La reserva está guardada, pero no se pudo actualizar la disponibilidad. Recarga la agenda para comprobarla.'; }
        notify();
        return summary;
      } catch (error) {
        if (error && safeErrors.has(error)) throw error;
        throw mutationStarted ? uncertainError() : connectionError();
      }
    }

    function adminDisabled() {
      return Promise.reject(fail('ADMIN_DISABLED', 'Las herramientas de demostración solo están disponibles en el modo local.'));
    }

    return {
      mode: 'supabase', listBookings: listBookings, listAvailability: listAvailability, createBooking: createBooking,
      cancelBooking: adminDisabled, resetDemo: adminDisabled,
      subscribe: function (callback) {
        if (typeof callback !== 'function') throw new TypeError('El observador de agenda debe ser una función.');
        listeners.add(callback);
        // La interfaz refresca al recuperar foco y periódicamente. Sin Realtime ni payloads con datos personales.
        return function () { listeners.delete(callback); };
      }
    };
  }

  function createRepository(options) {
    options = options || {};
    var url = Object.prototype.hasOwnProperty.call(options, 'url') ? options.url :
      typeof NOVA_SUPABASE_URL !== 'undefined' ? NOVA_SUPABASE_URL : undefined;
    var key = Object.prototype.hasOwnProperty.call(options, 'publishableKey') ? options.publishableKey :
      typeof NOVA_SUPABASE_PUBLISHABLE_KEY !== 'undefined' ? NOVA_SUPABASE_PUBLISHABLE_KEY : undefined;
    if (isUnconfigured(url, 'PEGA_AQUI_PROJECT_URL') && isUnconfigured(key, 'PEGA_AQUI_PUBLISHABLE_KEY')) {
      var local = core.createRepository(options);
      local.mode = 'local';
      return local;
    }
    return createRemoteRepository({ url: typeof url === 'string' ? url.trim() : url, key: typeof key === 'string' ? key.trim() : key }, options);
  }

  function createAdminContext(options) {
    options = options || {};
    var url = Object.prototype.hasOwnProperty.call(options, 'url') ? options.url :
      typeof NOVA_SUPABASE_URL !== 'undefined' ? NOVA_SUPABASE_URL : undefined;
    var key = Object.prototype.hasOwnProperty.call(options, 'publishableKey') ? options.publishableKey :
      typeof NOVA_SUPABASE_PUBLISHABLE_KEY !== 'undefined' ? NOVA_SUPABASE_PUBLISHABLE_KEY : undefined;
    var config = { url: typeof url === 'string' ? url.trim() : url, key: typeof key === 'string' ? key.trim() : key };
    // Comparte configuración, transporte y conversiones; nunca activa datos demo ni consulta por sí solo.
    return {
      client: function () { return getClient(config, options.sdk || global.supabase, 'admin'); },
      execute: function (query, mutation) { return execute(query, mutation, true); },
      databaseId: databaseId, normalizedId: normalizedId,
      validateMappings: validateMappings, intervalRows: intervalRows, blockRows: blockRows,
      professionalFromDatabase: professionalFromDatabase,
      isSafeError: function (error) { return !!error && safeErrors.has(error); }
    };
  }

  global.NovaStorage = { createRepository: createRepository, createAdminContext: createAdminContext };
}(typeof window !== 'undefined' ? window : globalThis));
