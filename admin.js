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
    uncertain: false, cancelId: null, cancelTrigger: null, tab: 'agenda',
    blocks: [], blocksRequest: 0, blocksLoading: false, blockUncertain: false,
    blockPending: null, blockAcknowledged: [], blockRemovingId: null, blockTrigger: null, blockFocusError: null
  };
  var blockKinds = { absence: 'Ausencia', vacation: 'Vacaciones', closed: 'Cierre', other: 'Otro' };
  var blockFields = {
    professionalId: 'block-professional', kind: 'block-kind', startDate: 'block-start-date',
    startTime: 'block-start-time', endDate: 'block-end-date', endTime: 'block-end-time', reason: 'block-reason'
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
    state.blocks = [];
    state.blocksRequest += 1;
    state.blocksLoading = state.blockUncertain = false;
    state.blockRemovingId = state.blockTrigger = null;
    if (repository) repository.invalidateAuth();
    $('#dashboard').hidden = true;
    $('#auth-screen').hidden = false;
    $('#agenda-list').innerHTML = '';
    $('#blocks-list').innerHTML = '';
    $('#block-impact-list').innerHTML = '';
    resetBlockForm();
    ['blocks-feedback', 'block-form-feedback', 'block-impact-message', 'block-impact-feedback', 'block-remove-description', 'block-remove-feedback'].forEach(function (id) { message('#' + id, ''); });
    ['#block-impact-dialog', '#block-remove-dialog'].forEach(function (selector) { if ($(selector).open) $(selector).close(); });
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
    $('#agenda-view').hidden = tab === 'phone' || tab === 'availability';
    $('#phone-view').hidden = tab !== 'phone';
    $('#availability-view').hidden = tab !== 'availability';
    if (tab === 'phone') refreshTimes();
    else if (tab === 'availability') refreshBlocks();
    else { $('#agenda-filter').value = tab === 'history' ? 'cancelled' : 'upcoming'; renderAgenda(); }
  }

  function updatePhoneControls() {
    var service = serviceById($('#phone-service').value);
    all('#phone-form input, #phone-form select').forEach(function (input) { input.disabled = state.mutating; });
    $('#phone-professional').disabled = state.mutating || !service || service.professionals.length === 1;
    $('#phone-time').disabled = state.mutating || state.timeLoading || !state.slots.length;
    $('#refresh-phone-hours').disabled = !state.authorized || state.mutating || state.timeLoading;
    $('#phone-submit').disabled = !state.authorized || state.mutating || state.timeLoading || state.uncertain || !state.slots.length || $('#phone-time').value === '';
    $('#phone-submit').textContent = state.mutating ? 'Guardando…' : 'Crear cita telefónica';
    $('#refresh-agenda').disabled = state.mutating || state.agendaLoading;
    all('[data-cancel-id]').forEach(function (button) { button.disabled = state.mutating; });
    updateBlockControls();
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
    message('#cancel-description', 'Vas a cancelar la cita de ' + booking.customer.name + ': ' + serviceName(booking.serviceId) + ', ' + formatDate(booking.date) + ' a las ' + core.timeLabel(booking.start) + '. El horario quedará libre si no hay otra reserva o bloqueo.');
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

  /* Bloqueos administrativos: periodo independiente de las reservas. Nunca se
   * cancelan citas al bloquear; los motivos permanecen en esta página privada.
   */
  function clearBlockErrors() {
    state.blockFocusError = null;
    Object.keys(blockFields).forEach(function (field) {
      $('#' + blockFields[field]).removeAttribute('aria-invalid');
      message('#' + blockFields[field] + '-error', '');
    });
  }

  function updateBlockControls() {
    var locked = state.mutating || Boolean(state.blockPending);
    all('#block-form input, #block-form select, #block-form textarea').forEach(function (input) { input.disabled = locked; });
    var allDay = $('#block-all-day').checked;
    ['start', 'end'].forEach(function (edge) {
      $('#block-' + edge + '-time-field').hidden = allDay;
      $('#block-' + edge + '-time').disabled = locked || allDay;
    });
    message('#block-range-note', allDay ? 'Se incluyen todos los días, desde la fecha de inicio hasta la de fin, en horario de Madrid.' : 'Fechas y horas de Madrid. Puedes seleccionar un periodo de varios días.');
    $('#block-submit').disabled = !state.authorized || locked || state.blockUncertain;
    $('#block-submit').textContent = state.mutating ? 'Comprobando y guardando…' : 'Bloquear disponibilidad';
    $('#refresh-blocks').disabled = !state.authorized || state.blocksLoading || state.mutating;
    $('#block-impact-confirm').disabled = state.mutating || state.blockUncertain || !state.blockPending;
    $('#block-impact-back').disabled = state.mutating;
    $('#block-remove-confirm').disabled = state.mutating;
    $('#block-remove-back').disabled = state.mutating;
    all('[data-remove-block]').forEach(function (button) { button.disabled = state.mutating; });
  }

  function resetBlockForm() {
    state.blockPending = null;
    state.blockAcknowledged = [];
    $('#block-form').reset();
    $('#block-all-day').checked = false;
    $('#block-start-date').value = time.dateKey();
    $('#block-end-date').value = time.dateKey();
    $('#block-start-time').value = '09:00';
    $('#block-end-time').value = '20:00';
    // Evita que el navegador recupere el motivo escrito al volver a una página.
    $('#block-reason').value = '';
    clearBlockErrors();
    updateBlockControls();
  }

  function readBlockForm() {
    return {
      professionalId: $('#block-professional').value === 'all' ? null : $('#block-professional').value,
      kind: $('#block-kind').value, startDate: $('#block-start-date').value, startTime: $('#block-start-time').value,
      endDate: $('#block-end-date').value, endTime: $('#block-end-time').value,
      allDay: $('#block-all-day').checked, reason: $('#block-reason').value.trim()
    };
  }

  function blockError(error, selector) {
    if (error && ['AUTH_REQUIRED', 'STALE_AUTH', 'NOT_ADMIN', 'FORBIDDEN'].indexOf(error.code) !== -1) {
      handlePrivateError(error, selector);
      return;
    }
    if (error && error.code === 'BLOCK_VALIDATION_ERROR') {
      var fields = error.fields || {};
      Object.keys(fields).forEach(function (field) {
        if (!blockFields[field]) return;
        $('#' + blockFields[field]).setAttribute('aria-invalid', 'true');
        message('#' + blockFields[field] + '-error', fields[field]);
      });
      message(selector, 'Revisa los datos del bloqueo. El fin debe ser posterior al inicio.');
      var first = Object.keys(fields).find(function (field) { return blockFields[field]; });
      // El envío mantiene los campos desactivados hasta terminar la comprobación.
      // El foco se restaura después de volver a habilitarlos.
      state.blockFocusError = first ? blockFields[first] : null;
    } else if (error && error.code === 'BLOCK_UNCERTAIN') {
      message(selector, 'No se pudo verificar si el bloqueo se guardó. Actualiza la lista para comprobarlo antes de recargar y crear otro. La creación queda bloqueada para evitar duplicados.');
    } else message(selector, 'No se pudo actualizar la disponibilidad.');
  }

  function blockPeriod(block) {
    var start = time.parts(block.startAt);
    var end = time.parts(block.endAt);
    var startDate = time.dateKey(block.startAt);
    var endDate = time.dateKey(block.endAt);
    if (start.hour === 0 && start.minute === 0 && start.second === 0 && end.hour === 0 && end.minute === 0 && end.second === 0) {
      var lastDay = time.addDays(endDate, -1);
      return startDate === lastDay ? formatDate(startDate) + ' · Día completo' : formatDate(startDate) + ' — ' + formatDate(lastDay) + ' · Días completos';
    }
    return formatDate(startDate) + ' · ' + core.timeLabel(start.hour * 60 + start.minute) + ' — ' +
      (startDate === endDate ? '' : formatDate(endDate) + ' · ') + core.timeLabel(end.hour * 60 + end.minute);
  }

  function renderBlocks() {
    if (!state.authorized) return;
    var focused = document.activeElement;
    var focusedId = focused && focused.dataset.removeBlock;
    $('#blocks-list').innerHTML = state.blocks.filter(function (block) { return block.active; }).slice().sort(function (a, b) {
      return new Date(a.startAt) - new Date(b.startAt) || String(a.id).localeCompare(String(b.id));
    }).map(function (block) {
      return '<article class="booking-card block-card" data-block-id="' + escapeHTML(block.id) + '">' +
        '<div class="booking-card-head"><h4>' + escapeHTML(block.professionalId === null ? 'Todo el salón' : professionalName(block.professionalId)) + '</h4>' +
        '<span class="booking-status">' + escapeHTML(blockKinds[block.kind] || 'Otro') + '</span></div>' +
        '<p class="block-period">' + escapeHTML(blockPeriod(block)) + '</p>' +
        (block.reason ? '<p class="block-reason">' + escapeHTML(block.reason) + '</p>' : '') +
        '<div class="booking-actions"><button class="btn btn-secondary btn-small" type="button" data-remove-block="' + escapeHTML(block.id) + '">Eliminar bloqueo<span class="sr-only"> de ' + escapeHTML(block.professionalId === null ? 'todo el salón' : professionalName(block.professionalId)) + '</span></button></div></article>';
    }).join('');
    $('#blocks-empty').hidden = state.blocks.some(function (block) { return block.active; });
    updateBlockControls();
    if (focusedId) {
      var replacement = all('[data-remove-block]').find(function (button) { return button.dataset.removeBlock === focusedId; });
      if (replacement && !replacement.disabled) replacement.focus();
      else $('#refresh-blocks').focus();
    }
  }

  async function refreshBlocks(successMessage) {
    if (!state.authorized) return;
    var epoch = state.epoch;
    var request = ++state.blocksRequest;
    state.blocksLoading = true;
    $('#blocks-list').setAttribute('aria-busy', 'true');
    message('#blocks-feedback', 'Cargando disponibilidad…');
    updateBlockControls();
    try {
      var blocks = await repository.listBlocks();
      if (!current(epoch) || request !== state.blocksRequest) return;
      state.blocks = blocks;
      renderBlocks();
      message('#blocks-feedback', successMessage || 'Disponibilidad actualizada.');
    } catch (error) {
      if (current(epoch) && request === state.blocksRequest) blockError(error, '#blocks-feedback');
    } finally {
      if (current(epoch) && request === state.blocksRequest) {
        state.blocksLoading = false;
        $('#blocks-list').setAttribute('aria-busy', 'false');
        updateBlockControls();
      }
    }
  }

  function showBlockImpact(input, affected, changed) {
    state.blockPending = input;
    state.blockAcknowledged = affected.map(function (booking) { return String(booking.id); });
    message('#block-impact-message', 'Este bloqueo afecta a ' + affected.length + ' citas ya reservadas.');
    $('#block-impact-list').innerHTML = affected.map(function (booking) {
      return '<li><strong>' + escapeHTML(booking.customer.name) + '</strong><span>' + escapeHTML(formatDate(booking.date)) + ' · ' + escapeHTML(core.timeLabel(booking.start)) + '</span>' +
        '<span>' + escapeHTML(professionalName(booking.professionalId)) + ' · ' + escapeHTML(serviceName(booking.serviceId)) + '</span></li>';
    }).join('');
    message('#block-impact-feedback', changed ? 'La agenda ha cambiado. Revisa las citas afectadas antes de confirmar de nuevo.' : '');
    if (!$('#block-impact-dialog').open) $('#block-impact-dialog').showModal();
    updateBlockControls();
    $('#block-impact-back').focus();
  }

  async function saveBlock(input, acknowledgedIds, epoch) {
    try {
      await repository.createBlock(input, { acknowledgedBookingIds: acknowledgedIds || [] });
      if (!current(epoch)) return;
      state.blockPending = null;
      if ($('#block-impact-dialog').open) $('#block-impact-dialog').close();
      resetBlockForm();
      message('#block-form-feedback', 'Disponibilidad actualizada.');
      await refreshBlocks('Disponibilidad actualizada.');
      if (current(epoch)) await refreshAgenda();
      if (current(epoch) && $('#phone-service').value) await refreshTimes();
    } catch (error) {
      if (!current(epoch)) return;
      if (error && error.code === 'AFFECTED_BOOKINGS' && Array.isArray(error.affectedBookings)) {
        showBlockImpact(input, error.affectedBookings, true);
      } else {
        if (error && error.code === 'BLOCK_UNCERTAIN') {
          state.blockUncertain = true;
          state.blockPending = null;
          if ($('#block-impact-dialog').open) $('#block-impact-dialog').close();
        }
        blockError(error, $('#block-impact-dialog').open ? '#block-impact-feedback' : '#block-form-feedback');
      }
    }
  }

  async function prepareBlock(event) {
    event.preventDefault();
    if (!state.authorized || state.mutating || state.blockUncertain || state.blockPending) return;
    clearBlockErrors();
    var input = readBlockForm();
    var epoch = state.epoch;
    state.mutating = true;
    updatePhoneControls();
    message('#block-form-feedback', 'Comprobando citas afectadas…');
    try {
      var prepared = await repository.prepareBlock(input);
      if (!current(epoch)) return;
      if (prepared.affectedBookings.length) {
        message('#block-form-feedback', 'Revisa las citas afectadas antes de crear el bloqueo.');
        showBlockImpact(input, prepared.affectedBookings, false);
      } else await saveBlock(input, [], epoch);
    } catch (error) {
      if (current(epoch)) blockError(error, '#block-form-feedback');
    } finally {
      if (current(epoch)) {
        state.mutating = false;
        updatePhoneControls();
        if (state.blockFocusError) $('#' + state.blockFocusError).focus();
        else if ($('#block-impact-dialog').open) $('#block-impact-back').focus();
      }
    }
  }

  async function confirmBlockImpact() {
    if (!state.authorized || state.mutating || !state.blockPending || state.blockUncertain) return;
    var epoch = state.epoch;
    state.mutating = true;
    updatePhoneControls();
    message('#block-impact-feedback', 'Comprobando y guardando el bloqueo…');
    try { await saveBlock(state.blockPending, state.blockAcknowledged.slice(), epoch); }
    finally {
      if (current(epoch)) {
        state.mutating = false;
        updatePhoneControls();
        if ($('#block-impact-dialog').open) $('#block-impact-back').focus();
        else $('#block-submit').focus();
      }
    }
  }

  function openRemoveBlock(button) {
    if (!state.authorized || state.mutating) return;
    var block = state.blocks.find(function (item) { return item.active && String(item.id) === button.dataset.removeBlock; });
    if (!block) return;
    state.blockRemovingId = block.id;
    state.blockTrigger = button;
    message('#block-remove-description', (block.professionalId === null ? 'Todo el salón' : professionalName(block.professionalId)) + ' · ' + blockKinds[block.kind] + '. ' + blockPeriod(block));
    message('#block-remove-feedback', '');
    $('#block-remove-dialog').showModal();
    $('#block-remove-back').focus();
  }

  async function removeBlock() {
    if (!state.authorized || state.mutating || state.blockRemovingId === null) return;
    var epoch = state.epoch;
    state.mutating = true;
    updatePhoneControls();
    message('#block-remove-feedback', 'Actualizando disponibilidad…');
    try {
      await repository.deactivateBlock(state.blockRemovingId);
      if (!current(epoch)) return;
      $('#block-remove-dialog').close();
      message('#admin-notice', 'Bloqueo eliminado.');
      await refreshBlocks('Bloqueo eliminado.');
      if (current(epoch)) await refreshAgenda();
      if (current(epoch) && $('#phone-service').value) await refreshTimes();
    } catch (error) {
      if (current(epoch)) {
        if (error && error.code === 'BLOCK_UNCERTAIN') message('#block-remove-feedback', 'No se pudo verificar si se eliminó el bloqueo. Vuelve a la lista y actualízala antes de intentarlo de nuevo.');
        else blockError(error, '#block-remove-feedback');
      }
    } finally {
      if (current(epoch)) {
        state.mutating = false;
        updatePhoneControls();
        if (!$('#block-remove-dialog').open) $('#refresh-blocks').focus();
      }
    }
  }

  $('#block-professional').innerHTML = '<option value="all">Todo el salón</option>' + data.professionals.map(function (person) {
    return '<option value="' + escapeHTML(person.id) + '">' + escapeHTML(person.name) + '</option>';
  }).join('');
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
  $('#block-form').addEventListener('submit', prepareBlock);
  $('#block-all-day').addEventListener('change', function () { clearBlockErrors(); updateBlockControls(); });
  $('#refresh-blocks').addEventListener('click', function () { if (!state.mutating) refreshBlocks(); });
  $('#blocks-list').addEventListener('click', function (event) {
    var button = event.target.closest('[data-remove-block]');
    if (button) openRemoveBlock(button);
  });
  $('#block-impact-confirm').addEventListener('click', confirmBlockImpact);
  $('#block-impact-back').addEventListener('click', function () { if (!state.mutating) $('#block-impact-dialog').close(); });
  $('#block-remove-confirm').addEventListener('click', removeBlock);
  $('#block-remove-back').addEventListener('click', function () { if (!state.mutating) $('#block-remove-dialog').close(); });
  ['#block-impact-dialog', '#block-remove-dialog'].forEach(function (selector) {
    $(selector).addEventListener('cancel', function (event) { if (state.mutating) event.preventDefault(); });
  });
  $('#block-impact-dialog').addEventListener('close', function () {
    state.blockPending = null;
    state.blockAcknowledged = [];
    $('#block-impact-list').innerHTML = '';
    message('#block-impact-message', '');
    message('#block-impact-feedback', '');
    updateBlockControls();
    if (state.authorized && !state.mutating) $('#block-submit').focus();
  });
  $('#block-remove-dialog').addEventListener('close', function () {
    state.blockRemovingId = null;
    message('#block-remove-description', '');
    message('#block-remove-feedback', '');
    if (state.blockTrigger && state.blockTrigger.isConnected) state.blockTrigger.focus();
    state.blockTrigger = null;
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.authorized && !state.mutating) {
      refreshAgenda();
      if (state.tab === 'phone') refreshTimes();
      if (state.tab === 'availability') refreshBlocks();
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
    if (document.visibilityState === 'visible' && state.authorized && !state.mutating && !state.agendaLoading && !state.timeLoading && !state.blocksLoading) {
      refreshAgenda();
      if (state.tab === 'phone') refreshTimes();
      if (state.tab === 'availability') refreshBlocks();
    }
  }, 30000);
  checkSession();
}(window));
