/* NOVA · Interfaz. La agenda se consulta exclusivamente mediante el repositorio.
   Para conectar Supabase se sustituye el adaptador, sin cambiar las vistas. */
(function () {
  'use strict';
  const data = window.NovaData;
  const core = window.NovaCore;
  const repository = core.createRepository();
  const $ = (id) => document.getElementById(id);
  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const money = (value) => new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0
  }).format(value);
  const dateLabel = (date) => core.parseDateKey(date).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const today = () => core.toDateKey(new Date());
  const firstOfMonth = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  };
  const state = {
    bookings: [], serviceId: '', professionalId: 'any', date: '', slot: null,
    month: firstOfMonth(), stage: 'selection', customer: null, confirmed: null,
    busy: false, storageReady: false
  };
  const serviceById = (id) => data.services.find((service) => service.id === id);
  const professionalById = (id) => data.professionals.find((person) => person.id === id);
  const selectedService = () => serviceById(state.serviceId);
  const availability = (date = state.date, overrides = {}) => core.getAvailability({
    serviceId: state.serviceId, professionalId: state.professionalId,
    date, bookings: state.bookings, ...overrides
  });

  function announce(message, target = 'booking-status', error = false) {
    $(target).textContent = message;
    $(target).classList.toggle('is-error', error);
  }
  function focusElement(element, scroll = true) {
    if (!element) return;
    if (scroll) element.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    element.focus({ preventScroll: true });
  }
  function placeholder(kind, label, monogram = '') {
    return `<span class="placeholder placeholder-${escapeHTML(kind)}" role="img" aria-label="${escapeHTML(label)}. Imagen de demostración"><span class="placeholder-monogram" aria-hidden="true">${escapeHTML(monogram || 'N')}</span><span class="placeholder-label">${escapeHTML(label)} · foto pendiente</span></span>`;
  }
  function visualKind(service) {
    const kinds = { 'corte-caballero': 'corte', 'corte-barba': 'barba', 'corte-mujer': 'peinado', 'lavado-corte-peinado': 'peinado', peinado: 'peinado', 'tinte-raiz': 'color', 'color-completo': 'color', mechas: 'mechas', balayage: 'balayage', tratamiento: 'color' };
    return kinds[service.id] || 'color';
  }
  // Los datos de contacto y el horario visible proceden de la misma configuración
  // que usa la agenda. El HTML conserva contenido legible antes de iniciar JS.
  function renderBusinessInfo() {
    const business = data.business;
    const values = { name: business.name, address: business.address, phone: business.phone, email: business.email };
    Object.entries(values).forEach(([key, value]) => {
      document.querySelectorAll(`[data-business-${key}]`).forEach((element) => { element.textContent = value; });
    });
    document.querySelectorAll('a[href^="tel:"]').forEach((link) => link.setAttribute('href', `tel:${business.phone.replace(/\s/g, '')}`));
    document.querySelectorAll('a[href^="mailto:"]').forEach((link) => link.setAttribute('href', `mailto:${business.email}`));
    const names = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const groups = [];
    [1, 2, 3, 4, 5, 6, 0].forEach((day) => {
      const hours = business.hours[day];
      const label = hours ? `${core.timeLabel(hours.start)}–${core.timeLabel(hours.end)}` : 'Cerrado';
      const previous = groups[groups.length - 1];
      if (previous && previous.label === label) previous.last = day;
      else groups.push({ first: day, last: day, label });
    });
    $('business-hours').innerHTML = groups.map((group) => {
      const label = group.first === group.last ? names[group.first] : `${names[group.first]}–${names[group.last].toLowerCase()}`;
      return `<div><dt>${label}</dt><dd>${group.label}</dd></div>`;
    }).join('');
  }
  function renderServices() {
    $('services-grid').innerHTML = data.services.map((service, index) => `
      <article class="service-card">
        <div class="service-card-top"><span class="service-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span class="service-duration">${service.duration} min aprox.</span></div>
        <h3>${escapeHTML(service.name)}</h3><p>${escapeHTML(service.description)}</p>
        <div class="service-meta"><strong>${money(service.price)}</strong><span>Un momento para ti</span></div>
        <div class="service-actions"><button type="button" class="btn btn-text" data-examples="${service.id}" aria-label="Ver ejemplos de ${escapeHTML(service.name)}">Ver ejemplos <span aria-hidden="true">↗</span></button><button type="button" class="btn btn-secondary btn-small" data-book-service="${service.id}">Reservar este servicio</button></div>
      </article>`).join('');
    const options = data.services.map((service) => `<option value="${service.id}">${escapeHTML(service.name)} · ${service.duration} min · ${money(service.price)}</option>`).join('');
    $('service-select').innerHTML = `<option value="">Elige tu servicio</option>${options}`;
    $('phone-service').innerHTML = options;
  }
  function renderProfessionals() {
    $('team-grid').innerHTML = data.professionals.map((person) => `
      <article class="team-card">${placeholder(person.id, `Retrato de ${person.name}`, person.name.charAt(0))}<div class="team-content"><span class="eyebrow">El equipo NOVA</span><h3>${escapeHTML(person.name)}</h3><p>${escapeHTML(person.description)}</p><details class="team-details"><summary>Ver especialidades</summary><ul>${person.specialties.map((specialty) => `<li>${escapeHTML(specialty)}</li>`).join('')}</ul></details></div></article>`).join('');
  }
  function renderGallery() {
    $('gallery-grid').innerHTML = ['balayage', 'corte-caballero', 'mechas', 'peinado', 'color-completo', 'corte-barba'].map((id) => {
      const service = serviceById(id);
      return `<button type="button" class="gallery-card" data-examples="${id}" aria-label="Ver ejemplos de ${escapeHTML(service.name)}">${placeholder(visualKind(service), service.name)}<span class="gallery-caption">${escapeHTML(service.name)} <span aria-hidden="true">↗</span></span></button>`;
    }).join('');
  }

  let dialogTrigger = null;
  function openDialog(content) {
    dialogTrigger = document.activeElement;
    $('dialog-content').innerHTML = content;
    $('example-dialog').showModal();
    document.body.classList.add('dialog-open');
    $('close-dialog').focus();
  }
  function showExamples(id) {
    const service = serviceById(id);
    if (!service) return;
    const reviews = data.reviews.filter((review) => review.serviceId === id).slice(0, 3);
    openDialog(`<span class="eyebrow">Una idea de tu próximo estilo</span><h2 id="dialog-title">${escapeHTML(service.name)}</h2><p>${escapeHTML(service.description)} En el salón adaptaremos el acabado a tu cabello y a tus preferencias.</p><p class="demo-note">Datos de demostración. Las imágenes y opiniones son ilustrativas; las fotografías reales se añadirán más adelante.</p><div class="example-grid">${['Acabado natural', 'Detalle del resultado', 'Otra inspiración'].map((label) => placeholder(visualKind(service), label)).join('')}</div><div class="example-reviews">${reviews.map((review) => `<blockquote class="example-review"><span class="stars" aria-label="5 de 5 estrellas">★★★★★</span><p>“${escapeHTML(review.text)}”</p><footer>${escapeHTML(review.name)} · ${escapeHTML(service.name)} · Reseña ficticia</footer></blockquote>`).join('')}</div><button type="button" class="btn btn-primary" data-book-service="${id}">Reservar este servicio · ${money(service.price)}</button>`);
  }
  function renderProfessionalChoices() {
    const service = selectedService();
    const multiple = service && service.professionals.length > 1;
    $('professional-field').hidden = !multiple;
    $('single-professional').hidden = !service || multiple;
    if (!service) return;
    if (!multiple) {
      state.professionalId = service.professionals[0];
      $('single-professional').textContent = `Te atenderá ${professionalById(state.professionalId).name}, especialista en este servicio.`;
      return;
    }
    const choices = [{ id: 'any', name: 'Cualquiera disponible' }, ...service.professionals.map(professionalById)];
    $('professional-options').innerHTML = choices.map((person) => `<label class="choice-chip"><input type="radio" name="professional" value="${person.id}" ${state.professionalId === person.id ? 'checked' : ''}><span>${escapeHTML(person.name)}</span></label>`).join('');
  }
  function updateProgress() {
    const active = state.stage === 'success' || state.stage === 'review' ? 'review' : state.slot ? 'details' : 'selection';
    const order = ['selection', 'details', 'review'];
    document.querySelectorAll('#booking-progress [data-step]').forEach((element) => {
      const step = element.dataset.step;
      element.classList.toggle('is-active', step === active);
      element.classList.toggle('is-complete', order.indexOf(step) < order.indexOf(active) || state.stage === 'success');
      if (step === active) element.setAttribute('aria-current', 'step');
      else element.removeAttribute('aria-current');
    });
    $('booking-selection').hidden = state.stage !== 'selection';
    $('customer-form').hidden = state.stage !== 'selection' || !state.slot;
    $('booking-review').hidden = state.stage !== 'review';
    $('booking-success').hidden = state.stage !== 'success';
  }
  function selectService(id, navigate = false) {
    if (state.busy) return;
    state.serviceId = serviceById(id) ? id : '';
    state.professionalId = 'any';
    state.slot = null;
    state.stage = 'selection';
    state.confirmed = null;
    $('service-select').value = state.serviceId;
    renderProfessionalChoices();
    renderCalendar();
    renderSlots();
    updateProgress();
    announce(state.serviceId ? 'Elige un día para consultar los horarios disponibles.' : 'Selecciona un servicio para consultar la agenda.');
    if (navigate) {
      if ($('example-dialog').open) {
        // El evento close es asíncrono: no debe devolver el foco a la galería.
        dialogTrigger = null;
        $('example-dialog').close();
      }
      focusElement($('service-select'));
    }
  }
  function renderCalendar() {
    const minimumMonth = firstOfMonth();
    if (state.month < minimumMonth) state.month = minimumMonth;
    $('calendar-label').textContent = state.month.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    $('calendar-prev').disabled = state.month <= minimumMonth;
    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const labels = { past: 'Fecha pasada', closed: 'Cerrado', full: 'Día completo', available: 'Disponible' };
    let html = '<span class="calendar-empty" aria-hidden="true"></span>'.repeat(offset);
    for (let day = 1; day <= days; day += 1) {
      const key = core.toDateKey(new Date(year, month, day));
      const status = key < today() ? 'past' : state.serviceId ? availability(key).status : 'pending';
      const disabled = status === 'past' || !state.serviceId || !state.storageReady;
      const label = labels[status] || 'Elige primero un servicio';
      html += `<button type="button" class="calendar-day is-${status}${key === today() ? ' is-today' : ''}${key === state.date ? ' is-selected' : ''}" data-date="${key}" ${disabled ? 'disabled' : ''} ${['closed', 'full'].includes(status) ? 'aria-disabled="true"' : ''} aria-pressed="${key === state.date}" ${key === today() ? 'aria-current="date"' : ''} aria-label="${escapeHTML(dateLabel(key))}. ${label}" title="${label}"><span>${day}</span><i aria-hidden="true"></i></button>`;
    }
    $('calendar-grid').innerHTML = html;
  }
  function renderSlots() {
    $('slots-title').textContent = state.date ? `Horarios · ${core.parseDateKey(state.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}` : 'Tu próximo hueco';
    if (!state.storageReady || !state.serviceId || !state.date) {
      $('slots-grid').innerHTML = `<p class="empty-state">${!state.storageReady ? 'La agenda todavía no está disponible.' : !state.serviceId ? 'Empieza eligiendo el servicio que te apetece.' : 'Selecciona un día en el calendario para ver las horas.'}</p>`;
      $('day-status').textContent = '';
      return;
    }
    const result = availability();
    const messages = {
      closed: 'Cerrado. Los domingos descansamos. Elige otro día.',
      full: 'Día completo. No quedan citas disponibles para este servicio.',
      past: 'Esta fecha ya ha pasado. Elige otro día.',
      available: `${result.slots.length} opciones disponibles. Duración del servicio: ${selectedService().duration} minutos.`
    };
    $('day-status').textContent = messages[result.status];
    if (result.status !== 'available') {
      $('slots-grid').innerHTML = `<p class="empty-state">${result.status === 'full' ? 'Prueba otra fecha o consulta otro profesional compatible.' : 'Te esperamos en nuestro próximo día disponible.'}</p>`;
      return;
    }
    const options = result.slots.map((slot) => ({ ...slot, available: true }));
    (result.unavailable || []).forEach((slot) => {
      if (!result.slots.some((availableSlot) => availableSlot.start === slot.start)) options.push({ ...slot, available: false });
    });
    options.sort((a, b) => a.start - b.start || String(a.professionalId || '').localeCompare(String(b.professionalId || '')));
    $('slots-grid').innerHTML = options.map((slot) => {
      if (!slot.available) return `<button type="button" class="slot-button is-unavailable" disabled title="${escapeHTML(slot.reason || 'Sin disponibilidad para este servicio')}"><span class="slot-time">${core.timeLabel(slot.start)}</span><span class="slot-professional">No disponible</span></button>`;
      const person = professionalById(slot.professionalId);
      const selected = state.slot && state.slot.start === slot.start && state.slot.professionalId === slot.professionalId;
      return `<button type="button" class="slot-button${selected ? ' is-selected' : ''}" data-slot="${slot.start}" data-professional="${slot.professionalId}" aria-pressed="${Boolean(selected)}" aria-label="${core.timeLabel(slot.start)}, con ${escapeHTML(person.name)}, hasta las ${core.timeLabel(slot.end)}"><span class="slot-time">${core.timeLabel(slot.start)}</span><span class="slot-professional">${escapeHTML(person.name)}</span></button>`;
    }).join('');
  }
  function selectDate(date) {
    state.date = date;
    state.slot = null;
    state.stage = 'selection';
    renderCalendar();
    renderSlots();
    updateProgress();
    document.querySelector(`[data-date="${date}"]`)?.focus({ preventScroll: true });
    announce('');
  }
  function selectSlot(start, professionalId) {
    const slot = availability().slots.find((option) => option.start === start && option.professionalId === professionalId);
    if (!slot) { announce('Este hueco ya no está disponible. Selecciona otra hora.', 'booking-status', true); return; }
    state.slot = slot;
    renderSlots();
    $('selected-appointment').textContent = `${selectedService().name} · ${dateLabel(state.date)} · ${core.timeLabel(slot.start)} · ${professionalById(slot.professionalId).name}`;
    updateProgress();
    announce('Hora seleccionada. Completa tus datos para revisar la reserva.');
    focusElement($('customer-name'));
  }
  function summaryMarkup(booking) {
    const rows = [
      ['Servicio', serviceById(booking.serviceId)?.name || 'Servicio no disponible'],
      ['Profesional', professionalById(booking.professionalId)?.name || 'Profesional no disponible'],
      ['Fecha', dateLabel(booking.date)], ['Hora', `${core.timeLabel(booking.start)} – ${core.timeLabel(booking.end)}`],
      ['Duración aproximada', `${booking.duration} minutos`], ['Precio', money(booking.price)]
    ];
    return `<dl class="summary-list">${rows.map(([label, value]) => `<div class="summary-row"><dt>${label}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>`;
  }
  function customerValues(prefix = 'customer') {
    return { name: $(`${prefix}-name`).value.trim(), phone: $(prefix === 'phone' ? 'phone-number' : 'customer-phone').value.trim(), email: $(`${prefix}-email`).value.trim() };
  }
  function validateCustomerForm(focus = true) {
    const customer = customerValues();
    const errors = core.validateCustomer(customer);
    ['name', 'phone', 'email'].forEach((field) => {
      $(`error-${field}`).textContent = errors[field] || '';
      $(`customer-${field}`).setAttribute('aria-invalid', String(Boolean(errors[field])));
    });
    const firstError = Object.keys(errors)[0];
    if (firstError && focus) {
      announce('Revisa los campos indicados antes de continuar.', 'booking-status', true);
      focusElement($(`customer-${firstError}`));
    }
    return firstError ? null : customer;
  }
  function candidateBooking() {
    const service = selectedService();
    return { serviceId: service.id, professionalId: state.slot.professionalId, date: state.date, start: state.slot.start, end: state.slot.end, duration: service.duration, price: service.price, customer: state.customer, source: 'online' };
  }
  function reviewBooking(event) {
    event.preventDefault();
    if (state.busy) return;
    const customer = validateCustomerForm();
    if (!customer || !state.slot) return;
    state.customer = customer;
    state.stage = 'review';
    $('review-summary').innerHTML = summaryMarkup(candidateBooking()) + `<p class="summary-customer">A nombre de <strong>${escapeHTML(customer.name)}</strong><br>${escapeHTML(customer.phone)} · ${escapeHTML(customer.email)}</p>`;
    updateProgress();
    announce('Revisa tu reserva. La cita se guardará cuando pulses Confirmar reserva.');
    focusElement($('confirm-booking'));
  }

  /* Integración futura del correo, independiente del guardado. Conectar aquí un
     backend sin secretos en el cliente. La demo declara que NO envía mensajes. */
  async function sendConfirmationEmail(booking) {
    return { sent: false, mode: 'demo', bookingId: booking.id };
  }
  window.NovaNotifications = Object.freeze({ sendConfirmationEmail });
  async function confirmBooking() {
    if (state.busy || !state.slot || state.stage !== 'review') return;
    state.busy = true;
    $('confirm-booking').disabled = true;
    $('modify-booking').disabled = true;
    $('confirm-booking').textContent = 'Confirmando…';
    try {
      // El repositorio relee la agenda y comprueba TODO el intervalo al guardar.
      const booking = await repository.createBooking(candidateBooking());
      state.confirmed = booking;
      state.stage = 'success';
      state.slot = null;
      $('success-summary').innerHTML = summaryMarkup(booking) + `<p class="confirmation-location"><strong>${escapeHTML(data.business.name)}</strong><br>${escapeHTML(data.business.address)}<br>Teléfono ficticio: <a href="tel:${escapeHTML(data.business.phone.replace(/\s/g, ''))}">${escapeHTML(data.business.phone)}</a></p>`;
      $('success-email').textContent = `Te enviaremos la confirmación a ${booking.customer.email}`;
      updateProgress();
      announce('Reserva guardada en este navegador. Tu cita está confirmada en la demo.');
      $('customer-form').reset();
      clearCustomerErrors();
      // Un fallo futuro del correo nunca debe deshacer una reserva ya confirmada.
      try { await sendConfirmationEmail(booking); } catch (_) {
        $('success-email').textContent = `Reserva guardada. El correo a ${booking.customer.email} está pendiente de envío.`;
      }
      await refreshData(false);
      focusElement($('success-title'));
    } catch (error) {
      if (error.code === 'SLOT_UNAVAILABLE') {
        state.slot = null;
        state.stage = 'selection';
        await refreshData(false);
        updateProgress();
        announce('La hora elegida ya no está disponible. Selecciona otro hueco para continuar.', 'booking-status', true);
        focusElement($('service-select'));
      } else announce(error.message || 'No se ha podido guardar la reserva. Inténtalo de nuevo.', 'booking-status', true);
    } finally {
      state.busy = false;
      $('confirm-booking').disabled = false;
      $('modify-booking').disabled = false;
      $('confirm-booking').textContent = 'Confirmar reserva';
    }
  }
  function clearCustomerErrors() {
    ['name', 'phone', 'email'].forEach((field) => {
      $(`error-${field}`).textContent = '';
      $(`customer-${field}`).removeAttribute('aria-invalid');
    });
  }
  function renderAgenda() {
    if (!state.storageReady) {
      $('agenda-list').innerHTML = '<p class="empty-state">No se ha podido leer la agenda. Si los datos locales están dañados, puedes restaurar la demo.</p>';
      return;
    }
    const bookings = [...state.bookings].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    if (!bookings.length) { $('agenda-list').innerHTML = '<p class="empty-state">La agenda está vacía. Prueba a reservar una cita o añade una por teléfono.</p>'; return; }
    $('agenda-list').innerHTML = bookings.map((booking) => {
      const service = serviceById(booking.serviceId);
      const person = professionalById(booking.professionalId);
      const origin = booking.source === 'phone' ? 'Telefónica demo' : booking.source === 'online' ? 'Reserva web demo' : 'Cita de ejemplo';
      return `<article class="agenda-item"><div><span class="badge">${origin}</span><h4>${escapeHTML(service?.name || booking.serviceId)} · ${escapeHTML(person?.name || booking.professionalId)}</h4><p class="agenda-meta">${escapeHTML(dateLabel(booking.date))} · ${core.timeLabel(booking.start)}–${core.timeLabel(booking.end)} · ${booking.duration} min</p><p class="agenda-customer">${escapeHTML(booking.customer.name)}</p></div><div class="agenda-actions"><button type="button" class="btn btn-text" data-cancel-booking="${escapeHTML(booking.id)}" aria-label="Cancelar cita de ${escapeHTML(booking.customer.name)}, ${escapeHTML(service?.name)}, ${escapeHTML(dateLabel(booking.date))} a las ${core.timeLabel(booking.start)}">Cancelar cita</button></div></article>`;
    }).join('');
  }
  function renderPhoneProfessionals() {
    const service = serviceById($('phone-service').value);
    if (!service) return;
    const previous = $('phone-professional').value;
    $('phone-professional').innerHTML = service.professionals.map((id) => `<option value="${id}">${escapeHTML(professionalById(id).name)}</option>`).join('');
    if (service.professionals.includes(previous)) $('phone-professional').value = previous;
    renderPhoneTimes();
  }
  function renderPhoneTimes() {
    $('phone-date').min = today();
    const previous = $('phone-time').value;
    const date = $('phone-date').value;
    if (!date || !state.storageReady) { $('phone-time').innerHTML = '<option value="">Elige una fecha</option>'; return; }
    if (!core.parseDateKey(date)) {
      $('phone-time').innerHTML = '<option value="">Introduce una fecha válida</option>';
      $('phone-date').setAttribute('aria-invalid', 'true');
      return;
    }
    $('phone-date').setAttribute('aria-invalid', 'false');
    const result = availability(date, { serviceId: $('phone-service').value, professionalId: $('phone-professional').value });
    $('phone-time').innerHTML = result.slots.length ? '<option value="">Elige una hora</option>' + result.slots.map((slot) => `<option value="${slot.start}">${core.timeLabel(slot.start)} – ${core.timeLabel(slot.end)}</option>`).join('') : `<option value="">${result.status === 'closed' ? 'Cerrado' : result.status === 'past' ? 'Fecha pasada' : 'No hay huecos para este servicio'}</option>`;
    if (result.slots.some((slot) => String(slot.start) === previous)) $('phone-time').value = previous;
  }
  async function addPhoneBooking(event) {
    event.preventDefault();
    if (state.busy) return;
    const customer = customerValues('phone');
    const errors = core.validateCustomer(customer);
    const fieldIds = { name: 'phone-name', phone: 'phone-number', email: 'phone-email' };
    Object.keys(fieldIds).forEach((field) => $(fieldIds[field]).setAttribute('aria-invalid', String(Boolean(errors[field]))));
    if (Object.keys(errors).length) {
      announce(Object.values(errors).join(' '), 'phone-errors', true);
      focusElement($(fieldIds[Object.keys(errors)[0]]));
      return;
    }
    if (!$('phone-date').value || !$('phone-time').value) {
      announce('Selecciona una fecha y una hora disponibles.', 'phone-errors', true);
      focusElement(!$('phone-date').value ? $('phone-date') : $('phone-time'));
      return;
    }
    state.busy = true;
    const submit = $('phone-form').querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await repository.createBooking({ serviceId: $('phone-service').value, professionalId: $('phone-professional').value, date: $('phone-date').value, start: Number($('phone-time').value), customer, source: 'phone' });
      announce('Cita telefónica guardada. El horario ya está bloqueado en la agenda pública.', 'demo-status');
      announce('', 'phone-errors');
      ['phone-name', 'phone-number', 'phone-email'].forEach((id) => { $(id).value = ''; });
      await refreshData(true);
    } catch (error) {
      announce(error.message || 'No se pudo añadir la cita.', 'phone-errors', true);
      await refreshData(true);
    } finally { state.busy = false; submit.disabled = false; }
  }
  async function cancelDemoBooking(id) {
    if (state.busy) return;
    state.busy = true;
    try {
      await repository.cancelBooking(id);
      if (state.confirmed?.id === id) {
        state.confirmed = null;
        state.stage = 'selection';
        announce('La cita se ha cancelado en la agenda demo. Puedes elegir un nuevo horario.');
      }
      await refreshData(true);
      updateProgress();
      announce('Cita cancelada. Su horario vuelve a estar disponible si todavía no ha pasado.', 'demo-status');
      focusElement($('toggle-phone-form'), false);
    } catch (error) {
      // Otra pestaña puede haber cancelado la cita antes de pulsar el botón.
      // Releer también en ese caso evita conservar una confirmación obsoleta.
      await refreshData(true);
      announce(error.message || 'No se pudo cancelar la cita.', 'demo-status', true);
    }
    finally { state.busy = false; }
  }
  async function resetDemo() {
    if (state.busy) return;
    state.busy = true;
    const button = $('confirm-reset');
    if (button) button.disabled = true;
    try {
      await repository.resetDemo();
      state.slot = null;
      state.confirmed = null;
      state.stage = 'selection';
      state.date = '';
      state.month = firstOfMonth();
      await refreshData(false);
      updateProgress();
      $('example-dialog').close();
      announce('Datos restaurados con citas de ejemplo para los próximos días.', 'demo-status');
      announce('Agenda de demostración restaurada. Ya puedes reservar.');
    } catch (error) {
      if ($('reset-status')) $('reset-status').textContent = error.message || 'No se pudo restaurar la demo.';
    } finally { state.busy = false; if (button) button.disabled = false; }
  }
  async function refreshData(validateSelection = true) {
    try {
      state.bookings = await repository.listBookings();
      state.storageReady = true;
      if (validateSelection && state.slot && !availability().slots.some((slot) => slot.start === state.slot.start && slot.professionalId === state.slot.professionalId)) {
        state.slot = null;
        state.stage = 'selection';
        announce('La agenda ha cambiado y tu hora ya no está disponible. Selecciona otra.', 'booking-status', true);
      }
      if (state.confirmed && !state.bookings.some((booking) => booking.id === state.confirmed.id)) {
        state.confirmed = null;
        state.stage = 'selection';
        announce('Esta cita se ha cancelado o la agenda se ha restaurado. Puedes reservar de nuevo.');
      }
    } catch (error) {
      state.storageReady = false;
      state.slot = null;
      if (state.stage === 'review') state.stage = 'selection';
      // Un fallo de lectura puede ocurrir después de un guardado correcto.
      announce(`${error.message || 'No se puede acceder al almacenamiento local.'} La disponibilidad no puede actualizarse en este momento.`, 'booking-status', true);
      announce('La agenda requiere almacenamiento local. Permite su uso en el navegador o restaura los datos si están dañados.', 'demo-status', true);
    }
    const focused = document.activeElement;
    const focusSelector = focused?.dataset.date ? `[data-date="${focused.dataset.date}"]`
      : focused?.dataset.slot ? `[data-slot="${focused.dataset.slot}"][data-professional="${focused.dataset.professional}"]`
      : focused?.dataset.cancelBooking ? `[data-cancel-booking="${focused.dataset.cancelBooking}"]` : null;
    renderCalendar();
    renderSlots();
    renderAgenda();
    renderPhoneTimes();
    updateProgress();
    // Las actualizaciones de otra pestaña o del reloj conservan el foco de teclado.
    if (focusSelector && !focused.isConnected) document.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  // Carrusel: pausa explícita, pausa al usarlo y respeto al movimiento reducido.
  function setupReviews() {
    const reviews = data.reviews.filter((review, index, all) => all.findIndex((item) => item.serviceId === review.serviceId) === index).slice(0, 6);
    let index = 0;
    let paused = reducedMotion.matches;
    let hovered = false;
    let focused = false;
    let timer = null;
    const region = $('resenas');
    function schedule() {
      window.clearInterval(timer);
      timer = null;
      if (!paused && !hovered && !focused && !document.hidden && reviews.length > 1) timer = window.setInterval(() => change(index + 1, false), 6500);
    }
    function render() {
      const review = reviews[index];
      // Los cambios automáticos no interrumpen al lector de pantalla.
      $('review-content').setAttribute('aria-live', paused ? 'polite' : 'off');
      $('review-position').setAttribute('aria-live', paused ? 'polite' : 'off');
      $('review-content').innerHTML = `<figure class="review-card"><div class="stars" aria-label="5 de 5 estrellas">★★★★★</div><blockquote>“${escapeHTML(review.text)}”</blockquote><figcaption><strong>${escapeHTML(review.name)}</strong><span>${escapeHTML(serviceById(review.serviceId).name)} · Reseña de demostración</span></figcaption></figure>`;
      $('review-position').textContent = `${index + 1} de ${reviews.length}`;
      $('review-dots').innerHTML = reviews.map((_, dot) => `<button type="button" class="review-dot${dot === index ? ' is-active' : ''}" data-review="${dot}" aria-label="Ver reseña ${dot + 1} de ${reviews.length}" ${dot === index ? 'aria-current="true"' : ''}></button>`).join('');
      $('review-toggle').textContent = paused ? 'Reanudar carrusel' : 'Pausar carrusel';
      $('review-toggle').setAttribute('aria-pressed', String(paused));
    }
    function change(next, manual = true) {
      index = (next + reviews.length) % reviews.length;
      if (manual) paused = true;
      render();
      schedule();
    }
    $('review-prev').addEventListener('click', () => change(index - 1));
    $('review-next').addEventListener('click', () => change(index + 1));
    $('review-dots').addEventListener('click', (event) => {
      const button = event.target.closest('[data-review]');
      if (!button) return;
      change(Number(button.dataset.review));
      $('review-dots').querySelector(`[data-review="${index}"]`).focus({ preventScroll: true });
    });
    $('review-toggle').addEventListener('click', () => { paused = !paused; render(); schedule(); });
    region.addEventListener('mouseenter', () => { hovered = true; schedule(); });
    region.addEventListener('mouseleave', () => { hovered = false; schedule(); });
    region.addEventListener('focusin', () => { focused = true; schedule(); });
    region.addEventListener('focusout', (event) => { if (!region.contains(event.relatedTarget)) { focused = false; schedule(); } });
    document.addEventListener('visibilitychange', schedule);
    reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) paused = true; render(); schedule(); });
    render();
    schedule();
  }
  function bindEvents() {
    document.addEventListener('click', (event) => {
      const example = event.target.closest('[data-examples]');
      if (example) showExamples(example.dataset.examples);
      const service = event.target.closest('[data-book-service]');
      if (service) selectService(service.dataset.bookService, true);
      const cancel = event.target.closest('[data-cancel-booking]');
      if (cancel) cancelDemoBooking(cancel.dataset.cancelBooking);
      if (event.target.closest('#confirm-reset')) resetDemo();
      if (event.target.closest('[data-close-dialog]')) $('example-dialog').close();
    });
    $('service-select').addEventListener('change', (event) => selectService(event.target.value));
    $('professional-options').addEventListener('change', (event) => {
      if (event.target.name !== 'professional') return;
      state.professionalId = event.target.value;
      state.slot = null;
      renderCalendar();
      renderSlots();
      updateProgress();
      announce('Disponibilidad actualizada para el profesional elegido.');
    });
    $('calendar-prev').addEventListener('click', () => changeMonth(-1));
    $('calendar-next').addEventListener('click', () => changeMonth(1));
    $('calendar-grid').addEventListener('click', (event) => {
      const button = event.target.closest('[data-date]');
      if (button && !button.disabled) selectDate(button.dataset.date);
    });
    $('slots-grid').addEventListener('click', (event) => {
      const button = event.target.closest('[data-slot]');
      if (button) selectSlot(Number(button.dataset.slot), button.dataset.professional);
    });
    $('customer-form').addEventListener('submit', reviewBooking);
    ['name', 'phone', 'email'].forEach((field) => {
      $(`customer-${field}`).addEventListener('input', () => {
        if ($(`customer-${field}`).getAttribute('aria-invalid') === 'true') {
          const error = core.validateCustomer(customerValues())[field];
          $(`error-${field}`).textContent = error || '';
          $(`customer-${field}`).setAttribute('aria-invalid', String(Boolean(error)));
        }
      });
    });
    $('back-to-selection').addEventListener('click', () => { state.slot = null; renderSlots(); updateProgress(); focusElement($('service-select')); });
    $('modify-booking').addEventListener('click', () => { state.stage = 'selection'; updateProgress(); announce('Puedes cambiar el servicio, el horario o tus datos antes de confirmar.'); focusElement($('service-select')); });
    $('confirm-booking').addEventListener('click', confirmBooking);
    $('new-booking').addEventListener('click', () => { state.date = ''; state.month = firstOfMonth(); state.customer = null; selectService('', true); });
    $('toggle-phone-form').addEventListener('click', () => {
      const open = $('phone-form').hidden;
      $('phone-form').hidden = !open;
      $('toggle-phone-form').setAttribute('aria-expanded', String(open));
      if (open) { if (!$('phone-date').value || $('phone-date').value < today()) $('phone-date').value = today(); renderPhoneProfessionals(); focusElement($('phone-service')); }
    });
    $('close-phone-form').addEventListener('click', () => { $('phone-form').hidden = true; $('toggle-phone-form').setAttribute('aria-expanded', 'false'); focusElement($('toggle-phone-form'), false); });
    $('phone-service').addEventListener('change', renderPhoneProfessionals);
    $('phone-professional').addEventListener('change', renderPhoneTimes);
    $('phone-date').addEventListener('change', renderPhoneTimes);
    $('phone-form').addEventListener('submit', addPhoneBooking);
    $('reset-demo').addEventListener('click', () => openDialog(`<span class="eyebrow">Herramientas de demostración</span><h2 id="dialog-title">Restaurar la agenda demo</h2><p>Se eliminarán las citas guardadas en este navegador y se crearán de nuevo las citas de ejemplo a partir de la fecha actual.</p><p>Esta acción también elimina las reservas que hayas creado durante las pruebas.</p><p id="reset-status" role="alert"></p><div class="dialog-actions"><button id="confirm-reset" type="button" class="btn btn-primary">Restaurar datos demo</button><button type="button" class="btn btn-secondary" data-close-dialog>Volver sin restaurar</button></div>`));
    $('directions-button').addEventListener('click', () => openDialog('<span class="eyebrow">Ubicación de demostración</span><h2 id="dialog-title">Nos vemos en la próxima fase</h2><p>NOVA Hair Studio y Calle Ejemplo 23, Madrid son ficticios. Por eso esta demo no abre indicaciones hacia una dirección real.</p><p>Este espacio está preparado para añadir el mapa y la ruta cuando el salón tenga una ubicación real.</p><button type="button" class="btn btn-primary" data-close-dialog>Entendido</button>'));
    $('close-dialog').addEventListener('click', () => $('example-dialog').close());
    $('example-dialog').addEventListener('close', () => { document.body.classList.remove('dialog-open'); if (dialogTrigger?.isConnected && !$('example-dialog').open) dialogTrigger.focus({ preventScroll: true }); });
    $('example-dialog').addEventListener('click', (event) => {
      if (event.target !== $('example-dialog')) return;
      const bounds = $('example-dialog').getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('example-dialog').close();
    });
  }
  function changeMonth(delta) {
    const next = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
    if (next < firstOfMonth()) return;
    state.month = next;
    state.date = '';
    state.slot = null;
    renderCalendar();
    renderSlots();
    updateProgress();
  }
  async function init() {
    renderBusinessInfo();
    renderServices();
    renderProfessionals();
    renderGallery();
    setupReviews();
    bindEvents();
    renderProfessionalChoices();
    renderPhoneProfessionals();
    await refreshData(false);
    repository.subscribe(() => { if (!state.busy) refreshData(true); });
    // Actualiza huecos que han vencido y cambios recibidos al volver a la pestaña.
    window.setInterval(() => { if (!document.hidden && !state.busy) refreshData(true); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.busy) refreshData(true); });
    if ('ResizeObserver' in window) new ResizeObserver((entries) => {
      document.documentElement.style.setProperty('--header-height', `${Math.ceil(entries[0].target.getBoundingClientRect().height)}px`);
    }).observe($('site-header'));
  }
  init().catch((error) => {
    announce('No se pudo iniciar la agenda. Recarga la página para intentarlo de nuevo.', 'booking-status', true);
    console.error('NOVA: error al iniciar la aplicación.', error);
  });
}());
