/* Agenda privada: Auth + RPC antes de cada operación. RLS sigue siendo la frontera de seguridad. */
(function (global) {
  'use strict';

  var data = global.NovaData;
  var core = global.NovaCore;
  var time = global.NovaTime;
  var COLUMNS = 'id,service_id,professional_id,start_at,end_at,customer_name,customer_phone,customer_email,source,status,created_at';
  var PAGE_SIZE = 200;
  var MAX_ROWS = 20000;
  var timestampWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

  function createRepository(options) {
    options = options || {};
    var context = global.NovaStorage.createAdminContext(options);
    var clock = typeof options.now === 'function' ? options.now : function () { return new Date(); };
    var epoch = 0;
    var loginVersion = 0;
    var observedSession = null;
    var authorizedSession = null;
    var safeErrors = new WeakSet();

    function fail(code, message, fields) {
      var error = new Error(message);
      error.code = code;
      if (fields) error.fields = fields;
      safeErrors.add(error);
      return error;
    }

    function connectionError() { return fail('CONNECTION_ERROR', 'No se pudo conectar con la agenda.'); }
    function authRequired() { return fail('AUTH_REQUIRED', 'Inicia sesión de nuevo para acceder a la agenda.'); }
    function forbidden() { return fail('FORBIDDEN', 'Esta cuenta no está autorizada para administrar NOVA.'); }
    function unavailable() { return fail('SLOT_UNAVAILABLE', 'Ese horario acaba de dejar de estar disponible.'); }

    function sanitize(error) {
      if (error && safeErrors.has(error)) return error;
      if (context.isSafeError(error)) {
        if (error.code === 'AUTH_REQUIRED') { invalidateAuth(); return authRequired(); }
        if (error.code === 'SLOT_UNAVAILABLE') return unavailable();
        if (error.code === 'CONNECTION_ERROR') return connectionError();
        return error;
      }
      return connectionError();
    }

    function client() {
      var instance = context.client();
      if (!instance.auth || typeof instance.rpc !== 'function') throw fail('CONFIG_ERROR', 'No se pudo cargar el acceso de Supabase.');
      return instance;
    }

    // Un cierre de sesión invalida inmediatamente también las promesas que ya estaban en vuelo.
    function invalidateAuth() { epoch += 1; loginVersion += 1; authorizedSession = null; }

    function sessionIdentity(session) {
      return session && session.user && typeof session.user.id === 'string' &&
        typeof session.access_token === 'string' && session.access_token ? session.user.id + '\n' + session.access_token : null;
    }

    function observe(session) {
      var identity = sessionIdentity(session);
      if (identity !== observedSession) { epoch += 1; authorizedSession = null; observedSession = identity; }
      return identity;
    }

    async function authCall(operation, login) {
      var timer = null;
      var timeout;
      if (typeof global.setTimeout === 'function' && typeof global.clearTimeout === 'function') {
        timeout = new Promise(function (_, reject) {
          timer = global.setTimeout(function () { reject(connectionError()); }, 15000);
        });
      }
      try {
        var response = await (timeout ? Promise.race([Promise.resolve().then(operation), timeout]) : operation());
        if (!response || typeof response !== 'object') throw connectionError();
        if (response.error) {
          if (login && (response.error.status === 400 || response.error.status === 401 || response.error.code === 'invalid_credentials')) {
            throw fail('INVALID_CREDENTIALS', 'No se pudo iniciar sesión. Revisa el email y la contraseña.');
          }
          if (!login && (response.error.status === 401 || response.error.status === 403 ||
            ['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'bad_jwt'].indexOf(response.error.code) !== -1)) {
            invalidateAuth(); throw authRequired();
          }
          throw connectionError();
        }
        return response;
      } catch (error) { throw sanitize(error); }
      finally { if (timer !== null) global.clearTimeout(timer); }
    }

    async function getSession() {
      var generation = epoch;
      var loginGeneration = loginVersion;
      var response = await authCall(function () { return client().auth.getSession(); });
      var session = response.data && response.data.session;
      if (session && !sessionIdentity(session)) throw authRequired();
      // Auth puede emitir INITIAL_SESSION/TOKEN_REFRESHED antes de resolver getSession.
      // Aceptamos esa misma identidad; jamás una respuesta anterior a un logout o a otra cuenta.
      if (generation !== epoch && (loginGeneration !== loginVersion || !sessionIdentity(session) || observedSession !== sessionIdentity(session))) throw authRequired();
      observe(session);
      return session || null;
    }

    async function signIn(email, password) {
      invalidateAuth();
      var attempt = loginVersion;
      if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
        throw fail('VALIDATION_ERROR', 'Introduce tu email y contraseña.');
      }
      // Las credenciales solo se entregan a Auth; nunca se copian a la agenda ni se guardan manualmente.
      var response = await authCall(function () { return client().auth.signInWithPassword({ email: email.trim(), password: password }); }, true);
      var session = response.data && response.data.session;
      if (attempt !== loginVersion) {
        // Un login tardío puede haber persistido su sesión en el SDK después de pulsar salir.
        // Retiramos esa sesión fuera del callback Auth antes de devolver el resultado obsoleto.
        if (!observedSession || observedSession === sessionIdentity(session)) {
          try { await signOut(); } catch (error) { /* El acceso de la interfaz continúa invalidado. */ }
        }
        throw authRequired();
      }
      if (!sessionIdentity(session)) throw authRequired();
      observe(session);
      return session;
    }

    async function signOut() {
      invalidateAuth();
      observedSession = null;
      await authCall(function () { return client().auth.signOut({ scope: 'local' }); });
    }

    async function authorize(session) {
      var current = await getSession();
      var identity = sessionIdentity(current);
      if (!identity || (session && sessionIdentity(session) !== identity)) { invalidateAuth(); return false; }
      var generation = epoch;
      try {
        var response = await context.execute(client().rpc('nova_is_admin'), false);
        if (generation !== epoch || observedSession !== identity) throw authRequired();
        if (response.data !== true) {
          invalidateAuth();
          // Aunque la red falle al revocar el token, nunca se concede acceso local a la cuenta.
          try { await signOut(); } catch (error) { /* El permiso ya está retirado y la UI mostrará el rechazo. */ }
          return false;
        }
        authorizedSession = identity;
        return true;
      } catch (error) { authorizedSession = null; throw sanitize(error); }
    }

    function guard(generation) {
      if (generation !== epoch || !authorizedSession || authorizedSession !== observedSession) throw authRequired();
    }

    async function requireAdmin() {
      var session = await getSession();
      if (!session) throw authRequired();
      if (!(await authorize(session))) throw forbidden();
      return epoch;
    }

    function onAuthStateChange(callback) {
      if (typeof callback !== 'function') throw new TypeError('El observador de sesión debe ser una función.');
      var result = client().auth.onAuthStateChange(function (event, session) {
        if (event === 'SIGNED_OUT' || event === 'USER_DELETED') invalidateAuth();
        observe(session);
        // Callback estrictamente síncrono: la UI difiere cualquier consulta fuera del bloqueo de Auth.
        callback(event, session);
      });
      var subscription = result && result.data && result.data.subscription;
      return function () { if (subscription && typeof subscription.unsubscribe === 'function') subscription.unsubscribe(); };
    }

    function normalize(row) {
      if (!row || context.normalizedId(row.id) === null || context.normalizedId(row.service_id) === null ||
        ['confirmed', 'cancelled'].indexOf(row.status) === -1 ||
        typeof row.start_at !== 'string' || typeof row.end_at !== 'string' ||
        !timestampWithZone.test(row.start_at) || !timestampWithZone.test(row.end_at)) throw connectionError();
      var startAt = new Date(row.start_at);
      var endAt = new Date(row.end_at);
      if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) throw connectionError();
      var professionalId = context.professionalFromDatabase(row.professional_id);
      var service = data.services.find(function (item) { return context.normalizedId(context.databaseId(item)) === context.normalizedId(row.service_id); });
      var startParts = time.parts(startAt);
      var start = startParts.hour * 60 + startParts.minute + startParts.second / 60 + startAt.getUTCMilliseconds() / 60000;
      var duration = (endAt - startAt) / 60000;
      return {
        id: context.normalizedId(row.id), serviceId: service ? service.id : context.normalizedId(row.service_id),
        serviceName: service ? service.name : 'Servicio fuera del catálogo', professionalId: professionalId,
        date: time.dateKey(startAt), start: start, end: start + duration, duration: duration,
        customer: {
          name: typeof row.customer_name === 'string' ? row.customer_name : '',
          phone: typeof row.customer_phone === 'string' ? row.customer_phone : '',
          email: typeof row.customer_email === 'string' ? row.customer_email : ''
        },
        source: row.source === 'phone' || row.source === 'admin' ? row.source : 'online', status: row.status,
        createdAt: typeof row.created_at === 'string' ? row.created_at : '', startAt: row.start_at, endAt: row.end_at
      };
    }

    async function listBookings() {
      try {
        var generation = await requireAdmin();
        context.validateMappings();
        var rows = [];
        var expectedCount = null;
        var seen = new Set();
        while (true) {
          guard(generation);
          var response = await context.execute(client().from('nova_bookings').select(COLUMNS, { count: 'exact' })
            .order('start_at', { ascending: true }).order('id', { ascending: true }).range(rows.length, rows.length + PAGE_SIZE - 1), false);
          guard(generation);
          if (!Array.isArray(response.data) || !Number.isInteger(response.count) || response.count < 0 || response.count > MAX_ROWS) throw connectionError();
          if (expectedCount === null) expectedCount = response.count;
          if (response.count !== expectedCount || rows.length + response.data.length > expectedCount) throw connectionError();
          response.data.forEach(function (row) {
            var id = row && context.normalizedId(row.id);
            if (id === null || seen.has(id)) throw connectionError();
            seen.add(id); rows.push(normalize(row));
          });
          if (rows.length === expectedCount) break;
          if (!response.data.length) throw connectionError();
        }
        guard(generation);
        return rows;
      } catch (error) { throw sanitize(error); }
    }

    function toIntervals(bookings, date) {
      if (!core.parseDateKey(date)) throw fail('VALIDATION_ERROR', 'Selecciona una fecha válida.');
      var range = { startDate: date, endDate: time.addDays(date, 1) };
      return bookings.filter(function (booking) { return booking.status === 'confirmed'; }).reduce(function (intervals, booking) {
        var person = data.professionals.find(function (item) { return item.id === booking.professionalId; });
        return intervals.concat(context.intervalRows({
          professional_id: context.databaseId(person), start_at: booking.startAt, end_at: booking.endAt, status: booking.status
        }, range));
      }, []);
    }

    async function getAvailability(input) {
      var bookings = await listBookings();
      return core.getAvailability({
        serviceId: input.serviceId, professionalId: input.professionalId, date: input.date,
        bookings: toIntervals(bookings, input.date), now: clock()
      });
    }

    async function createPhoneBooking(input) {
      try {
        input = input && {
          serviceId: input.serviceId, professionalId: input.professionalId, date: input.date, start: input.start,
          customer: input.customer && { name: input.customer.name, phone: input.customer.phone, email: input.customer.email }
        };
        var service = input && data.services.find(function (item) { return item.id === input.serviceId; });
        var person = input && data.professionals.find(function (item) { return item.id === input.professionalId; });
        if (!service || !person || service.professionals.indexOf(person.id) === -1 || !core.parseDateKey(input.date) || !Number.isInteger(input.start)) {
          throw fail('VALIDATION_ERROR', 'Completa el servicio, profesional, fecha y hora de la cita.');
        }
        var fields = core.validateCustomer(input.customer);
        if (Object.keys(fields).length) throw fail('VALIDATION_ERROR', 'Revisa los datos de contacto.', fields);
        var availability = await getAvailability(input);
        if (!availability.slots.some(function (slot) { return slot.start === input.start && slot.professionalId === person.id; })) throw unavailable();
        var customer = {
          name: input.customer.name.trim().replace(/\s+/g, ' '), phone: input.customer.phone.trim(), email: input.customer.email.trim().toLowerCase()
        };
        var generation = await requireAdmin();
        guard(generation);
        // Solo siete campos: el servidor decide duración, ID, estado y fecha de creación.
        await context.execute(client().from('nova_bookings').insert({
          service_id: context.databaseId(service), professional_id: context.databaseId(person), start_at: time.toInstant(input.date, input.start).toISOString(),
          customer_name: customer.name, customer_phone: customer.phone, customer_email: customer.email, source: 'phone'
        }), true);
        guard(generation);
        // La UI refresca por separado: un fallo de lectura posterior no convierte un INSERT confirmado en un error.
        return {
          serviceId: service.id, professionalId: person.id, date: input.date, start: input.start, end: input.start + service.duration,
          duration: service.duration, price: service.price, customer: customer, source: 'phone', status: 'confirmed'
        };
      } catch (error) { throw sanitize(error); }
    }

    async function cancelBooking(id) {
      try {
        if (context.normalizedId(id) === null) throw fail('VALIDATION_ERROR', 'Selecciona una cita válida.');
        var generation = await requireAdmin();
        guard(generation);
        var response = await context.execute(client().from('nova_bookings').update({ status: 'cancelled' }).eq('id', id).select('id'), true);
        guard(generation);
        if (!Array.isArray(response.data) || response.data.length !== 1 || context.normalizedId(response.data[0].id) !== context.normalizedId(id)) {
          throw fail('CANCEL_NOT_ALLOWED', 'No se pudo cancelar la cita. Actualiza la agenda y comprueba el estado.');
        }
      } catch (error) { throw sanitize(error); }
    }

    return {
      getSession: getSession, signIn: signIn, authorize: authorize, signOut: signOut, onAuthStateChange: onAuthStateChange,
      invalidateAuth: invalidateAuth, listBookings: listBookings, getAvailability: getAvailability, toIntervals: toIntervals,
      createPhoneBooking: createPhoneBooking, cancelBooking: cancelBooking
    };
  }

  global.NovaAdmin = { createRepository: createRepository };
}(typeof window !== 'undefined' ? window : globalThis));
