/* Fechas civiles y horas del salón: siempre Europe/Madrid, también desde otro país. */
(function (global) {
  'use strict';

  var TIME_ZONE = 'Europe/Madrid';
  var formatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  var offsetsByDate = new Map();

  function timeError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function parts(instant) {
    var date = instant === undefined ? new Date() : new Date(instant);
    if (!Number.isFinite(date.getTime())) throw timeError('INVALID_DATE', 'El instante no es válido.');
    var result = {};
    formatter.formatToParts(date).forEach(function (part) {
      if (['year', 'month', 'day', 'hour', 'minute', 'second'].indexOf(part.type) !== -1) {
        result[part.type] = Number(part.value);
      }
    });
    return result;
  }

  function formatDate(value) {
    return String(value.year).padStart(4, '0') + '-' + String(value.month).padStart(2, '0') + '-' + String(value.day).padStart(2, '0');
  }

  function dateKey(instant) { return formatDate(parts(instant)); }

  function utcTimestamp(value) {
    var date = new Date(0);
    date.setUTCFullYear(value.year, value.month - 1, value.day);
    date.setUTCHours(value.hour || 0, value.minute || 0, value.second || 0, 0);
    return date.getTime();
  }

  function civilParts(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      throw timeError('INVALID_DATE', 'Usa una fecha válida con formato AAAA-MM-DD.');
    }
    var values = key.split('-').map(Number);
    var result = { year: values[0], month: values[1], day: values[2] };
    var date = new Date(utcTimestamp(result));
    if (result.year < 1 || date.getUTCFullYear() !== result.year || date.getUTCMonth() + 1 !== result.month || date.getUTCDate() !== result.day) {
      throw timeError('INVALID_DATE', 'La fecha no existe en el calendario.');
    }
    return result;
  }

  function addDays(key, amount) {
    if (!Number.isInteger(amount)) throw timeError('INVALID_DATE', 'El número de días debe ser entero.');
    var date = new Date(utcTimestamp(civilParts(key)));
    date.setUTCDate(date.getUTCDate() + amount);
    var result = formatDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
    civilParts(result);
    return result;
  }

  /* Se prueban los offsets de ambos lados del día, nunca el huso del dispositivo.
   * La validación inversa detecta el salto de primavera y la hora repetida de otoño.
   * La caché evita repetir el cálculo al mostrar muchos huecos del mismo día.
   */
  function dayOffsets(key, civil) {
    if (offsetsByDate.has(key)) return offsetsByDate.get(key);
    var midnight = utcTimestamp(civil);
    var offsets = [];
    [-36, 0, 36].forEach(function (hours) {
      var sample = midnight + hours * 3600000;
      var offset = utcTimestamp(parts(sample)) - sample;
      if (offsets.indexOf(offset) === -1) offsets.push(offset);
    });
    if (offsetsByDate.size >= 64) offsetsByDate.delete(offsetsByDate.keys().next().value);
    offsetsByDate.set(key, offsets);
    return offsets;
  }

  function toInstant(key, minutes) {
    var civil = civilParts(key);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) {
      throw timeError('INVALID_TIME', 'La hora debe estar entre las 00:00 y las 23:59.');
    }
    var requested = utcTimestamp(civil) + minutes * 60000;
    var matches = dayOffsets(key, civil).map(function (offset) { return requested - offset; }).filter(function (candidate) {
      var actual = parts(candidate);
      return formatDate(actual) === key && actual.hour * 60 + actual.minute === minutes && actual.second === 0;
    });
    if (!matches.length) throw timeError('INVALID_TIME', 'Esta hora no existe en Madrid por el cambio de horario.');
    if (matches.length > 1) throw timeError('AMBIGUOUS_TIME', 'Esta hora se repite en Madrid por el cambio de horario.');
    return new Date(matches[0]);
  }

  function dayRange(key) {
    return { startAt: toInstant(key, 0).toISOString(), endAt: toInstant(addDays(key, 1), 0).toISOString() };
  }

  global.NovaTime = {
    TIME_ZONE: TIME_ZONE, parts: parts, dateKey: dateKey,
    toInstant: toInstant, addDays: addDays, dayRange: dayRange
  };
}(typeof window !== 'undefined' ? window : globalThis));
