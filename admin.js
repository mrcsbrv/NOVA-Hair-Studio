/* Panel privado. El permiso se comprueba en el servidor; RLS protege cada consulta.
 * Las reservas solo viven en memoria. La sesión la gestiona Supabase Auth.
 */
(function (global) {
  'use strict';

  var data = global.NovaData;
  var core = global.NovaCore;
  var time = global.NovaTime;
  var $ = function (selector) { return document.querySelector(selector); };
  var all = function (selector) { return Array.from(document.querySelectorAll(selector)); };
  var repository;
  var unsubscribe;
  var state = {
    authorized: false, userId: null, epoch: 0, authBusy: false, authRun: 0, autoAuthBlocked: false,
    bookings: [], slots: [], agendaRequest: 0, timeRequest: 0,
    agendaLoading: false, timeLoading: false, mutating: false,
    uncertain: false, cancelId: null, cancelTrigger: null, tab: 'agenda'
  };
  var dateFormat = new Intl.DateTimeFormat('es-ES', {
    timeZone: time.TIME_ZONE, weekday: 'short', day: 'numeric', month: 'long', year: 'numeric'
  });

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function message(selector, text) { $(selector).textContent = text == null ? '' : text; }
  function serviceById(id) { return data.services.find(function (item) { return item.id === id; }); }
  function serviceName(id) { var service = serviceById(id); return service ? service.name : 'Servicio fuera del catálogo'; }
  function professionalName(id) {
    var person = data.professionals.find(function (item) { return item.id === id; });
    return person ? person.name : 'Profesional fuera del catálogo';
  }
  function formatDate(date) { return dateFormat.format(time.toInstant(date, 720)); }
  function current(epoch) { return state.authorized && state.epoch === epoch; }
  function clearFieldErrors(prefix, fields) {
    fields.forEach(function (field) {
      $('#' + prefix + field).removeAttribute('aria-invalid');
      message('#' + prefix + field + '-error', '');
    });
  }

  // Invalida también las respuestas en vuelo: cerrar sesión nunca permite que
  // una consulta anterior vuelva a pintar nombres, teléfonos o correos.
  function clearPrivateView() {
    state.epoch += 1;
    state.authorized = false;
    state.userId = null;
    state.bookings = [];
    state.slots = [];
    state.agendaRequest += 1;
    state.timeRequest += 1;
    state.agendaLoading = state.timeLoading = state.mutating = false;
    state.uncertain = false;
    state.cancelId = state.cancelTrigger = null;
    if (repository) repository.invalidateAuth();
    $('#dashboard').hidden = true;
    $('#auth-screen').hidden = false;
    $('#agenda-list').innerHTML = '';
    $('#phone-form').reset();
    $('#login-password').value = '';
    clearFieldErrors('phone-', ['name', 'phone', 'email']);
    ['agenda-feedback', 'phone-feedback', 'phone-availability', 'cancel-feedback', 'cancel-description', 'admin-notice'].forEach(function (id) { message('#' + id, ''); });
    ['today', 'upcoming', 'confirmed', 'cancelled'].forEach(function (id) { message('#stats-' + id, '—'); });
    if ($('#cancel-dialog').open) $('#cancel-dialog').close();
    $('#cancel-confirm').disabled = false;
    $('#cancel-dismiss').disabled = false;
    resetPhoneSelection();
  }

  function showLogin(text, retry) {
    $('#auth-screen').hidden = false;
    $('#dashboard').hidden = true;
    $('#login-form').hidden = false;
    $('#login-submit').disabled = false;
    $('#login-submit').textContent = 'Iniciar sesión';
    $('#auth-retry').hidden = !retry;
    $('#auth-retry').textContent = 'Volver a comprobar';
    $('#auth-retry').dataset.action = '';
    message('#auth-status', 'Acceso exclusivo para administración.');
    message('#login-feedback', text);
  }

  function safeMessage(error) {
    var code = error && error.code;
    if (code === 'NOT_ADMIN' || code === 'FORBIDDEN') return 'Esta cuenta no está autorizada para administrar NOVA.';
    if (code === 'AUTH_REQUIRED' || code === 'STALE_AUTH') return 'Tu sesión ha terminado. Vuelve a iniciar sesión.';
    if (code === 'INVALID_CREDENTIALS' || code === 'AUTH_ERROR') return 'No se pudo iniciar sesión. Revisa el email y la contraseña.';
    if (code === 'CONFIG_ERROR') return 'No se pudo conectar con la agenda. Revisa la configuración pública de Supabase y la conexión.';
    if (code === 'SLOT_UNAVAILABLE') return 'Ese horario acaba de dejar de estar disponible.';
    if (code === 'CANCEL_NOT_ALLOWED') return 'No se pudo cancelar la cita. Actualiza la agenda y comprueba el estado.';
    if (code === 'BOOKING_UNCERTAIN') return 'No se ha podido verificar el resultado. Actualiza la agenda y comprueba si la cita se guardó antes de volver a intentarlo. Para evitar duplicados, la creación queda bloqueada hasta recargar esta página.';
    if (code === 'VALIDATION_ERROR') return 'Revisa el servicio, profesional, fecha y datos de contacto.';
    return 'No se pudo conectar con la agenda.';
  }

  function handlePrivateError(error, selector) {
    if (error && ['AUTH_REQUIRED', 'STALE_AUTH', 'NOT_ADMIN', 'FORBIDDEN'].indexOf(error.code) !== -1) {
      clearPrivateView();
      showLogin(safeMessage(error));
      $('#login-email').focus();
    } else message(selector, safeMessage(error));
  }

  function ensureRepository() {
    if (repository) return;
    repository = global.NovaAdmin.createRepository();
    try {
      unsubscribe = repository.onAuthStateChange(function (event, session) {
        if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
          clearPrivateView();
          showLogin('Tu sesión ha terminado. Vuelve a iniciar sesión.');
          return;
        }
        // El callback de Auth es síncrono. Las llamadas de red se difieren para
        // no bloquear el candado interno del SDK durante una notificación.
        if (session && !state.authBusy && !state.autoAuthBlocked && (session.user.id !== state.userId || event === 'TOKEN_REFRESHED')) {
          clearPrivateView();
          $('#login-form').hidden = true;
          message('#auth-status', 'Comprobando sesión…');
          global.setTimeout(function () { checkSession(); }, 0);
        }
      });
    } catch (error) {
      // Un reintento debe registrar de nuevo el observador; nunca se abre el
      // panel con un repositorio que no pueda notificar cierres de sesión.
      repository.invalidateAuth();
      repository = null;
      unsubscribe = null;
      throw error;
    }
  }

  async function enterWithSession(session, epoch) {
    if (!session) { showLogin(); return; }
    var allowed = await repository.authorize(session);
    if (!allowed) {
      if (!state.authorized) showLogin('Esta cuenta no está autorizada para administrar NOVA.');
      return;
    }
    if (state.epoch !== epoch) return;
    state.authorized = true;
    state.userId = session.user.id;
    state.authBusy = false;
    $('#login-form').reset();
    $('#auth-screen').hidden = true;
    $('#dashboard').hidden = false;
    $('#agenda-filter').value = 'upcoming';
    $('#professional-filter').value = 'any';
    setTab('agenda');
    resetPhoneSelection();
    $('#dashboard-heading').focus();
    await refreshAgenda();
  }

  async function checkSession() {
    if (state.authBusy) return;
    if (state.autoAuthBlocked) { showLogin('Panel cerrado. Inicia sesión para volver a entrar.'); return; }
    clearPrivateView();
    var epoch = state.epoch;
    var authRun = ++state.authRun;
    state.authBusy = true;
    $('#login-form').hidden = true;
    $('#auth-retry').hidden = true;
    message('#login-feedback', '');
    message('#auth-status', 'Comprobando sesión…');
    try {
      ensureRepository();
      var session = await repository.getSession();
      if (state.epoch === epoch) await enterWithSession(session, epoch);
    } catch (error) {
      if (state.epoch === epoch) showLogin(safeMessage(error), true);
    } finally {
      if (state.authRun === authRun) state.authBusy = false;
    }
  }

  async function login(event) {
    event.preventDefault();
    if (state.authBusy) return;
    clearFieldErrors('login-', ['email', 'password']);
    var email = $('#login-email').value.trim();
    var password = $('#login-password').value;
    var invalid = [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid.push(['email', 'Introduce un email válido.']);
    if (!password) invalid.push(['password', 'Introduce la contraseña.']);
    invalid.forEach(function (item) {
      $('#login-' + item[0]).setAttribute('aria-invalid', 'true');
      message('#login-' + item[0] + '-error', item[1]);
    });
    if (invalid.length) { $('#login-' + invalid[0][0]).focus(); return; }
    clearPrivateView();
    var epoch = state.epoch;
    var authRun = ++state.authRun;
    state.autoAuthBlocked = false;
    state.authBusy = true;
    $('#login-submit').disabled = true;
    $('#login-submit').textContent = 'Iniciando sesión…';
    message('#login-feedback', '');
    try {
      ensureRepository();
      var pending = repository.signIn(email, password);
      password = null;
      var session = await pending;
      if (state.epoch === epoch) await enterWithSession(session, epoch);
    } catch (error) {
      if (state.epoch === epoch) { showLogin(safeMessage(error)); $('#login-password').focus(); }
    } finally {
      password = null;
      if (state.authRun === authRun) {
        $('#login-password').value = '';
        state.authBusy = false;
        $('#login-submit').disabled = false;
        $('#login-submit').textContent = 'Iniciar sesión';
      }
    }
  }

  async function logout() {
    state.autoAuthBlocked = true;
    clearPrivateView();
    var authRun = ++state.authRun;
    state.authBusy = true;
    $('#login-form').reset();
    $('#login-form').hidden = true;
    message('#auth-status', 'Cerrando sesión…');
    var failure;
    try { await repository.signOut(); } catch (error) { failure = error; }
    if (state.authRun !== authRun) return;
    state.authBusy = false;
    showLogin(failure ? 'El panel está cerrado, pero no se pudo cerrar la sesión en el servidor. Vuelve a intentarlo.' : 'Has cerrado sesión.', Boolean(failure));
    if (failure) {
      $('#auth-retry').textContent = 'Reintentar cierre de sesión';
      $('#auth-retry').dataset.action = 'logout';
    }
    $('#login-email').focus();
  }

  function upcoming(booking) {
    return booking.status === 'confirmed' && new Date(booking.startAt).getTime() >= Date.now();
  }

  function renderAgenda() {
    if (!state.authorized) return;
    var focused = document.activeElement;
    var focusedCard = focused && focused.closest('.booking-card');
    var focusReference = focusedCard && focused.matches('a, button') ? {
      id: focusedCard.dataset.bookingId, action: focused.dataset.contact || 'cancel'
    } : null;
    var today = time.dateKey();
    var confirmed = state.bookings.filter(function (booking) { return booking.status === 'confirmed'; });
    message('#stats-today', confirmed.filter(function (booking) { return booking.date === today; }).length);
    message('#stats-upcoming', state.bookings.filter(upcoming).length);
    message('#stats-confirmed', confirmed.length);
    message('#stats-cancelled', state.bookings.filter(function (booking) { return booking.status === 'cancelled'; }).length);
    var filter = $('#agenda-filter').value;
    var professional = $('#professional-filter').value;
    var rows = state.bookings.filter(function (booking) {
      if (professional !== 'any' && booking.professionalId !== professional) return false;
      if (filter === 'upcoming') return upcoming(booking);
      if (filter === 'today') return booking.status === 'confirmed' && booking.date === today;
      if (filter === 'cancelled') return booking.status === 'cancelled';
      return true;
    }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.start - b.start || String(a.id).localeCompare(String(b.id)); });
    $('#agenda-list').innerHTML = rows.map(function (booking) {
      var customer = booking.customer;
      var cancelled = booking.status === 'cancelled';
      var title = serviceName(booking.serviceId);
      var telephone = String(customer.phone).replace(/[^+\d]/g, '');
      var emailLink = encodeURIComponent(customer.email).replace(/%40/g, '@');
      return '<article class="booking-card" data-booking-id="' + escapeHTML(booking.id) + '"><div class="booking-card-head"><div>' +
        '<p class="booking-date">' + escapeHTML(formatDate(booking.date)) + '</p>' +
        '<p class="booking-time">' + escapeHTML(core.timeLabel(booking.start)) + ' <span>· ' + escapeHTML(booking.duration) + ' min</span></p></div>' +
        '<span class="booking-status' + (cancelled ? ' cancelled' : '') + '">' + (cancelled ? 'Cancelada' : 'Confirmada') + '</span></div>' +
        '<h3>' + escapeHTML(title) + '</h3><dl class="booking-meta"><div><dt>Profesional</dt><dd>' + escapeHTML(professionalName(booking.professionalId)) + '</dd></div>' +
        '<div><dt>Origen</dt><dd>' + ({ online: 'Online', phone: 'Teléfono', admin: 'Administración' }[booking.source] || 'Sin especificar') + '</dd></div></dl>' +
        '<div class="booking-customer"><strong>' + escapeHTML(customer.name) + '</strong><span>' + escapeHTML(customer.phone) + '</span><span>' + escapeHTML(customer.email) + '</span></div>' +
        '<div class="booking-actions"><a class="btn btn-secondary btn-small" data-contact="phone" href="tel:' + escapeHTML(telephone) + '">Llamar<span class="sr-only"> a ' + escapeHTML(customer.name) + '</span></a>' +
        '<a class="btn btn-secondary btn-small" data-contact="email" href="mailto:' + escapeHTML(emailLink) + '">Enviar email<span class="sr-only"> a ' + escapeHTML(customer.name) + '</span></a>' +
        (cancelled ? '' : '<button class="btn btn-danger btn-small" type="button" data-cancel-id="' + escapeHTML(booking.id) + '"' + (state.mutating ? ' disabled' : '') + '>Cancelar cita<span class="sr-only"> de ' + escapeHTML(customer.name) + '</span></button>') + '</div></article>';
    }).join('');
    $('#agenda-empty').hidden = rows.length > 0;
    message('#agenda-empty', filter === 'upcoming' ? 'No hay citas próximas.' : 'No hay citas para estos filtros.');
    // El refresco periódico conserva el lugar de quien navega con teclado.
    if (focusReference) {
      var replacementCard = all('.booking-card').find(function (card) { return card.dataset.bookingId === focusReference.id; });
      var replacement = replacementCard && replacementCard.querySelector(focusReference.action === 'cancel' ? '[data-cancel-id]' : '[data-contact="' + focusReference.action + '"]');
      if (replacement && !replacement.disabled) replacement.focus();
      else $('#agenda-filter').focus();
    }
  }

  async function refreshAgenda(successMessage) {
    if (!state.authorized) return;
    var epoch = state.epoch;
    var request = ++state.agendaRequest;
    state.agendaLoading = true;
    $('#refresh-agenda').disabled = true;
    $('#agenda-list').setAttribute('aria-busy', 'true');
    message('#agenda-feedback', 'Cargando agenda…');
    try {
      var bookings = await repository.listBookings();
      if (!current(epoch) || request !== state.agendaRequest) return;
      state.bookings = bookings;
      renderAgenda();
      message('#agenda-feedback', successMessage || 'Agenda actualizada. Horario de Madrid.');
    } catch (error) {
      if (current(epoch) && request === state.agendaRequest) handlePrivateError(error, '#agenda-feedback');
    } finally {
      if (current(epoch) && request === state.agendaRequest) {
        state.agendaLoading = false;
        $('#refresh-agenda').disabled = state.mutating;
        $('#agenda-list').setAttribute('aria-busy', 'false');
      }
    }
  }

  function setTab(tab) {
    state.tab = tab;
    all('[data-admin-tab]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.adminTab === tab)); });
    $('#agenda-view').hidden = tab === 'phone';
    $('#phone-view').hidden = tab !== 'phone';
    if (tab !== 'phone') { $('#agenda-filter').value = tab === 'history' ? 'cancelled' : 'upcoming'; renderAgenda(); }
    else refreshTimes();
  }

  function updatePhoneControls() {
    var service = serviceById($('#phone-service').value);
    all('#phone-form input, #phone-form select').forEach(function (input) { input.disabled = state.mutating; });
    $('#phone-professional').disabled = state.mutating || !service || service.professionals.length === 1;
    $('#phone-time').disabled = state.mutating || state.timeLoading || !state.slots.length;
    $('#refresh-phone-hours').disabled = !state.authorized || state.mutating || state.timeLoading;
    $('#phone-submit').disabled = !state.authorized || state.mutating || state.timeLoading || state.uncertain || !state.slots.length || $('#phone-time').value === '';
    $('#phone-submit').textContent = state.mutating ? 'Guardando…' : 'Crear cita telefónica';
  }

  function resetPhoneSelection() {
    $('#phone-date').min = time.dateKey();
    $('#phone-date').value = time.dateKey();
    $('#phone-professional').innerHTML = '<option value="">Elige primero un servicio</option>';
    $('#phone-time').innerHTML = '<option value="">Elige una hora</option>';
    state.slots = [];
    updatePhoneControls();
  }

  function changeService() {
    var service = serviceById($('#phone-service').value);
    $('#phone-professional').innerHTML = service ? service.professionals.map(function (id) {
      return '<option value="' + escapeHTML(id) + '">' + escapeHTML(professionalName(id)) + '</option>';
    }).join('') : '<option value="">Elige primero un servicio</option>';
    refreshTimes();
  }

  async function refreshTimes() {
    var epoch = state.epoch;
    var request = ++state.timeRequest;
    var previous = $('#phone-time').value;
    state.slots = [];
    state.timeLoading = false;
    $('#phone-time').innerHTML = '<option value="">Elige una hora</option>';
    var service = serviceById($('#phone-service').value);
    var date = $('#phone-date').value;
    var professional = $('#phone-professional').value;
    if (!state.authorized || !service || !core.parseDateKey(date) || !professional) {
      message('#phone-availability', 'Elige servicio, profesional y fecha para consultar las horas.');
      updatePhoneControls();
      return;
    }
    state.timeLoading = true;
    message('#phone-availability', 'Consultando horas disponibles…');
    updatePhoneControls();
    try {
      var availability = await repository.getAvailability({ serviceId: service.id, professionalId: professional, date: date });
      if (!current(epoch) || request !== state.timeRequest) return;
      state.slots = availability.slots;
      $('#phone-time').innerHTML = '<option value="">Elige una hora</option>' + state.slots.map(function (slot) {
        return '<option value="' + slot.start + '">' + core.timeLabel(slot.start) + ' · hasta ' + core.timeLabel(slot.end) + '</option>';
      }).join('');
      if (previous !== '' && state.slots.some(function (slot) { return slot.start === Number(previous); })) $('#phone-time').value = previous;
      var labels = { past: 'No se pueden reservar citas en el pasado.', closed: 'Cerrado. Los domingos no hay citas.', full: 'Día completo. No quedan citas disponibles para este servicio.' };
      message('#phone-availability', labels[availability.status] || service.duration + ' minutos continuos disponibles. Horario de Madrid.');
    } catch (error) {
      if (current(epoch) && request === state.timeRequest) handlePrivateError(error, '#phone-availability');
    } finally {
      if (current(epoch) && request === state.timeRequest) { state.timeLoading = false; updatePhoneControls(); }
    }
  }

  async function createPhone(event) {
    event.preventDefault();
    if (!state.authorized || state.mutating || state.uncertain || state.timeLoading) return;
    clearFieldErrors('phone-', ['name', 'phone', 'email']);
    var customer = { name: $('#phone-name').value.trim(), phone: $('#phone-phone').value.trim(), email: $('#phone-email').value.trim() };
    var errors = core.validateCustomer(customer);
    Object.keys(errors).forEach(function (field) {
      $('#phone-' + field).setAttribute('aria-invalid', 'true');
      message('#phone-' + field + '-error', errors[field]);
    });
    if (Object.keys(errors).length) { $('#phone-' + Object.keys(errors)[0]).focus(); return; }
    var startValue = $('#phone-time').value;
    if (startValue === '' || !state.slots.some(function (slot) { return slot.start === Number(startValue); })) {
      message('#phone-feedback', 'Selecciona una hora disponible.');
      $('#phone-time').focus();
      return;
    }
    var input = { serviceId: $('#phone-service').value, professionalId: $('#phone-professional').value, date: $('#phone-date').value, start: Number(startValue), customer: customer };
    var epoch = state.epoch;
    state.mutating = true;
    updatePhoneControls();
    message('#phone-feedback', 'Comprobando y guardando la cita…');
    try {
      await repository.createPhoneBooking(input);
      if (!current(epoch)) return;
      $('#phone-form').reset();
      clearFieldErrors('phone-', ['name', 'phone', 'email']);
      resetPhoneSelection();
      message('#phone-feedback', 'Cita telefónica creada.');
      message('#phone-availability', 'Elige un servicio para añadir otra cita.');
      await refreshAgenda('Cita telefónica creada.');
    } catch (error) {
      if (!current(epoch)) return;
      if (error && error.code === 'BOOKING_UNCERTAIN') state.uncertain = true;
      handlePrivateError(error, '#phone-feedback');
      if (error && error.code === 'SLOT_UNAVAILABLE') {
        $('#phone-time').value = '';
        await refreshTimes();
        if (current(epoch)) $('#phone-time').focus();
      }
    } finally {
      if (current(epoch)) { state.mutating = false; updatePhoneControls(); $('#refresh-agenda').disabled = state.agendaLoading; }
    }
  }

  function openCancel(button) {
    if (!state.authorized || state.mutating) return;
    var booking = state.bookings.find(function (item) { return String(item.id) === button.dataset.cancelId && item.status === 'confirmed'; });
    if (!booking) return;
    state.cancelId = booking.id;
    state.cancelTrigger = button;
    message('#cancel-description', 'Vas a cancelar la cita de ' + booking.customer.name + ': ' + serviceName(booking.serviceId) + ', ' + formatDate(booking.date) + ' a las ' + core.timeLabel(booking.start) + '. El horario volverá a estar disponible.');
    message('#cancel-feedback', '');
    $('#cancel-dialog').showModal();
    $('#cancel-dismiss').focus();
  }

  async function cancelBooking() {
    if (!state.authorized || state.mutating || state.cancelId === null) return;
    var epoch = state.epoch;
    var id = state.cancelId;
    state.mutating = true;
    $('#cancel-confirm').disabled = true;
    $('#cancel-dismiss').disabled = true;
    message('#cancel-feedback', 'Cancelando cita…');
    try {
      await repository.cancelBooking(id);
      if (!current(epoch)) return;
      $('#cancel-dialog').close();
      state.cancelId = null;
      message('#admin-notice', 'Cita cancelada.');
      await refreshAgenda('Cita cancelada.');
      if (current(epoch) && state.tab === 'phone') await refreshTimes();
    } catch (error) {
      if (current(epoch)) {
        if (error && error.code === 'BOOKING_UNCERTAIN') message('#cancel-feedback', 'No se pudo verificar la cancelación. Actualiza la agenda para comprobar el estado.');
        else handlePrivateError(error, '#cancel-feedback');
      }
    } finally {
      if (current(epoch)) {
        state.mutating = false;
        $('#cancel-confirm').disabled = false;
        $('#cancel-dismiss').disabled = false;
        $('#refresh-agenda').disabled = state.agendaLoading;
        updatePhoneControls();
        renderAgenda();
        if (!$('#cancel-dialog').open) $('#refresh-agenda').focus();
      }
    }
  }

  $('#phone-service').innerHTML = '<option value="">Elige un servicio</option>' + data.services.map(function (service) {
    return '<option value="' + escapeHTML(service.id) + '">' + escapeHTML(service.name) + ' · ' + service.duration + ' min · ' + service.price + ' €</option>';
  }).join('');
  $('#professional-filter').innerHTML = '<option value="any">Todos los profesionales</option>' + data.professionals.map(function (person) {
    return '<option value="' + escapeHTML(person.id) + '">' + escapeHTML(person.name) + '</option>';
  }).join('');
  $('#login-form').addEventListener('submit', login);
  $('#logout-button').addEventListener('click', logout);
  $('#auth-retry').addEventListener('click', function () {
    if ($('#auth-retry').dataset.action === 'logout') logout();
    else checkSession();
  });
  all('[data-admin-tab]').forEach(function (button) { button.addEventListener('click', function () { setTab(button.dataset.adminTab); }); });
  $('#agenda-filter').addEventListener('change', renderAgenda);
  $('#professional-filter').addEventListener('change', renderAgenda);
  $('#refresh-agenda').addEventListener('click', function () { if (!state.mutating) refreshAgenda(); });
  $('#agenda-list').addEventListener('click', function (event) {
    var button = event.target.closest('[data-cancel-id]');
    if (button) openCancel(button);
  });
  $('#phone-service').addEventListener('change', changeService);
  ['#phone-professional', '#phone-date'].forEach(function (selector) { $(selector).addEventListener('change', function () { $('#phone-time').value = ''; refreshTimes(); }); });
  $('#phone-time').addEventListener('change', updatePhoneControls);
  $('#refresh-phone-hours').addEventListener('click', function () { if (!state.mutating) refreshTimes(); });
  $('#phone-form').addEventListener('submit', createPhone);
  $('#cancel-confirm').addEventListener('click', cancelBooking);
  $('#cancel-dismiss').addEventListener('click', function () { if (!state.mutating) $('#cancel-dialog').close(); });
  $('#cancel-dialog').addEventListener('cancel', function (event) { if (state.mutating) event.preventDefault(); });
  $('#cancel-dialog').addEventListener('close', function () {
    message('#cancel-description', '');
    if (state.cancelTrigger && state.cancelTrigger.isConnected) state.cancelTrigger.focus();
    state.cancelTrigger = null;
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.authorized && !state.mutating) {
      refreshAgenda();
      if (state.tab === 'phone') refreshTimes();
    }
  });
  global.addEventListener('pagehide', function () {
    clearPrivateView();
    // BFcache puede volver antes de que termine Auth: una promesa antigua no
    // debe bloquear la comprobación nueva ni cambiar sus controles al terminar.
    state.authRun += 1;
    state.authBusy = false;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    repository = null;
  });
  global.addEventListener('pageshow', function (event) { if (event.persisted) checkSession(); });
  global.setInterval(function () {
    if (document.visibilityState === 'visible' && state.authorized && !state.mutating && !state.agendaLoading && !state.timeLoading) {
      refreshAgenda();
      if (state.tab === 'phone') refreshTimes();
    }
  }, 30000);
  checkSession();
}(window));
