/*
 * RAS events engine.
 *
 * One file, two jobs:
 *  1. In the browser it reads /data/events.json and /data/venues.json and
 *     renders the next event, upcoming lists, the What's On programme, the
 *     past archive and the "Add to calendar" buttons, always using the
 *     visitor's current date and time.
 *  2. In Node (tools/build.js) the same functions pre-render those lists and
 *     generate one static page per event, so every page works without
 *     JavaScript and search engines see real content.
 *
 * All event times in events.json are UK local time (Europe/London).
 */
(function (root) {
  'use strict';

  var TZ = 'Europe/London';
  var SITE_URL = 'https://redditchastro.org.uk';

  var TYPE_PLURALS = {
    'Meeting': 'Meetings',
    'Public Event': 'Public Events',
    'Observing': 'Observing',
    'Workshop': 'Workshops',
    'Social': 'Social',
    'Trip': 'Trips'
  };
  var TYPE_ORDER = ['Meeting', 'Public Event', 'Observing', 'Workshop', 'Social', 'Trip'];

  /* ---------- helpers ---------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function parseDate(str) {
    var p = String(str).split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }

  function parseTime(str) {
    if (!str) return null;
    var p = String(str).split(':');
    return { h: +p[0], min: +p[1] };
  }

  // Milliseconds that Europe/London is ahead of UTC at a given instant.
  var offsetFormatter = null;
  function londonOffset(ms) {
    if (!offsetFormatter) {
      offsetFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    var parts = {};
    offsetFormatter.formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = p.value; });
    var asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return asUTC - Math.floor(ms / 1000) * 1000;
  }

  // Convert a UK local date + time to a real Date instant.
  function londonToDate(dateStr, timeStr) {
    var d = parseDate(dateStr);
    var t = parseTime(timeStr) || { h: 0, min: 0 };
    var guess = Date.UTC(d.y, d.m - 1, d.d, t.h, t.min);
    var off = londonOffset(guess);
    var result = guess - off;
    var off2 = londonOffset(result);
    if (off2 !== off) result = guess - off2;
    return new Date(result);
  }

  // ISO 8601 with the correct UK offset, e.g. 2026-10-06T19:00:00+01:00
  function isoLocal(dateStr, timeStr) {
    var instant = londonToDate(dateStr, timeStr);
    var offMin = Math.round(londonOffset(instant.getTime()) / 60000);
    var sign = offMin >= 0 ? '+' : '-';
    var a = Math.abs(offMin);
    return dateStr + 'T' + (timeStr || '00:00') + ':00' + sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  }

  function utcStamp(date) {
    return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) +
      'T' + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + '00Z';
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function dateParts(dateStr) {
    var d = parseDate(dateStr);
    var dow = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
    return {
      year: d.y, month: d.m, day: d.d,
      dayName: DAYS[dow], dayShort: DAYS[dow].slice(0, 3),
      monthName: MONTHS[d.m - 1], monthShort: MONTHS[d.m - 1].slice(0, 3)
    };
  }

  function formatDate(dateStr) {
    var p = dateParts(dateStr);
    return p.dayName + ' ' + p.day + ' ' + p.monthName + ' ' + p.year;
  }

  function formatTime(timeStr) {
    var t = parseTime(timeStr);
    if (!t) return '';
    var suffix = t.h >= 12 ? 'pm' : 'am';
    var h = t.h % 12 || 12;
    return h + ':' + pad(t.min) + suffix;
  }

  function formatTimeRange(ev) {
    if (!ev.startTime) return '';
    return formatTime(ev.startTime) + (ev.endTime ? ' to ' + formatTime(ev.endTime) : '');
  }

  /* ---------- event model ---------- */

  function eventStart(ev) { return londonToDate(ev.date, ev.startTime || '00:00'); }

  // When an event stops counting as "upcoming". Events stay listed while in
  // progress: until their end time, or the end of the day if no end is given.
  function eventEnd(ev) {
    if (ev.endTime) return londonToDate(ev.date, ev.endTime);
    return londonToDate(ev.date, '23:59');
  }

  function eventUrl(ev) {
    if (ev.url) return ev.url;
    var d = parseDate(ev.date);
    return '/events/' + d.y + '/' + pad(d.m) + '/' + ev.slug + '/';
  }

  function isUpcoming(ev, now) { return eventEnd(ev).getTime() >= now.getTime(); }

  function sortAsc(a, b) { return eventStart(a) - eventStart(b); }

  function upcoming(events, now) {
    return events.filter(function (ev) { return !ev.hidden && isUpcoming(ev, now); }).sort(sortAsc);
  }

  function past(events, now) {
    return events.filter(function (ev) { return !ev.hidden && !isUpcoming(ev, now); })
      .sort(function (a, b) { return sortAsc(b, a); });
  }

  function nextEvent(events, now) {
    var list = upcoming(events, now).filter(function (ev) { return !ev.cancelled; });
    return list[0] || null;
  }

  function venueIndex(venues) {
    var idx = {};
    (venues || []).forEach(function (v) { idx[v.id] = v; });
    return idx;
  }

  function venueName(ev, venues) {
    var v = ev.venueId && venues[ev.venueId];
    return v ? v.name : '';
  }

  function venueAddressLine(v) {
    return [v.name, v.address, v.town, v.postcode].filter(Boolean).join(', ');
  }

  function venueMapUrl(v) {
    if (!v) return '';
    if (v.mapUrl) return v.mapUrl;
    if (v.online) return '';
    var q = [v.name, v.address, v.town, v.postcode].filter(Boolean).join(', ');
    if (!v.postcode && !v.address) return '';
    return 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(q);
  }

  function typeSlug(type) { return String(type || '').toLowerCase().replace(/[^a-z]+/g, '-'); }

  function paragraphs(text) {
    if (!text) return '';
    return String(text).split(/\n\s*\n/).map(function (p) { return '<p>' + esc(p.trim()) + '</p>'; }).join('');
  }

  /* ---------- calendar ---------- */

  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  function icsFold(line) {
    var out = [];
    while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
    out.push(line);
    return out.join('\r\n');
  }

  function buildICS(ev, venues, siteUrl) {
    siteUrl = siteUrl || SITE_URL;
    var v = ev.venueId && venues[ev.venueId];
    var url = siteUrl + eventUrl(ev);
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Redditch Astronomical Society//Events//EN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:' + ev.id + '@redditchastro.org.uk',
      'DTSTAMP:' + utcStamp(new Date())
    ];
    if (ev.startTime) {
      lines.push('DTSTART:' + utcStamp(eventStart(ev)));
      if (ev.endTime) lines.push('DTEND:' + utcStamp(londonToDate(ev.date, ev.endTime)));
    } else {
      var d = parseDate(ev.date);
      var next = new Date(Date.UTC(d.y, d.m - 1, d.d + 1));
      lines.push('DTSTART;VALUE=DATE:' + d.y + pad(d.m) + pad(d.d));
      lines.push('DTEND;VALUE=DATE:' + next.getUTCFullYear() + pad(next.getUTCMonth() + 1) + pad(next.getUTCDate()));
    }
    lines.push('SUMMARY:' + icsEscape('RAS: ' + ev.title));
    var desc = (ev.shortDescription || '') + (ev.speaker ? '\nSpeaker: ' + ev.speaker : '') + '\n' + url;
    lines.push('DESCRIPTION:' + icsEscape(desc.trim()));
    if (v) lines.push('LOCATION:' + icsEscape(venueAddressLine(v)));
    lines.push('URL:' + url, 'END:VEVENT', 'END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  function googleCalendarUrl(ev, venues, siteUrl) {
    siteUrl = siteUrl || SITE_URL;
    var v = ev.venueId && venues[ev.venueId];
    var dates;
    if (ev.startTime) {
      var start = eventStart(ev);
      var end = ev.endTime ? londonToDate(ev.date, ev.endTime) : start;
      dates = utcStamp(start) + '/' + utcStamp(end);
    } else {
      var d = parseDate(ev.date);
      var n = new Date(Date.UTC(d.y, d.m - 1, d.d + 1));
      dates = '' + d.y + pad(d.m) + pad(d.d) + '/' + n.getUTCFullYear() + pad(n.getUTCMonth() + 1) + pad(n.getUTCDate());
    }
    var details = (ev.shortDescription || '') + '\n\n' + siteUrl + eventUrl(ev);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent('RAS: ' + ev.title) +
      '&dates=' + dates +
      '&details=' + encodeURIComponent(details.trim()) +
      (v ? '&location=' + encodeURIComponent(venueAddressLine(v)) : '') +
      '&ctz=' + encodeURIComponent(TZ);
  }

  /* ---------- structured data ---------- */

  function eventJsonLd(ev, venues, siteUrl) {
    siteUrl = siteUrl || SITE_URL;
    var v = ev.venueId && venues[ev.venueId];
    var data = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: ev.title,
      startDate: ev.startTime ? isoLocal(ev.date, ev.startTime) : ev.date,
      url: siteUrl + eventUrl(ev),
      eventStatus: ev.cancelled ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
      organizer: { '@type': 'Organization', name: 'Redditch Astronomical Society', url: siteUrl + '/' }
    };
    if (ev.endTime) data.endDate = isoLocal(ev.date, ev.endTime);
    var description = ev.shortDescription || (ev.description ? String(ev.description).split(/\n\s*\n/)[0] : '');
    if (description) data.description = description;
    if (ev.image) data.image = [siteUrl + ev.image];
    if (v && v.online) {
      data.eventAttendanceMode = 'https://schema.org/OnlineEventAttendanceMode';
      data.location = { '@type': 'VirtualLocation', url: siteUrl + eventUrl(ev) };
    } else if (v) {
      data.eventAttendanceMode = 'https://schema.org/OfflineEventAttendanceMode';
      var place = { '@type': 'Place', name: v.name };
      var addr = { '@type': 'PostalAddress', addressCountry: 'GB' };
      if (v.address) addr.streetAddress = v.address;
      if (v.town) addr.addressLocality = v.town;
      if (v.postcode) addr.postalCode = v.postcode;
      place.address = addr;
      data.location = place;
    }
    if (ev.speaker) data.performer = { '@type': 'Person', name: ev.speaker };
    if (ev.bookingUrl && ev.price) {
      var offer = { '@type': 'Offer', url: ev.bookingUrl };
      if (/^free$/i.test(ev.price)) { offer.price = 0; offer.priceCurrency = 'GBP'; }
      data.offers = offer;
    }
    return data;
  }

  function jsonLdScript(data) {
    return '<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>';
  }

  /* ---------- HTML rendering (shared by browser and build) ---------- */

  function renderDateBlock(ev) {
    var p = dateParts(ev.date);
    return '<p class="date-block" aria-hidden="true"><span class="date-block__dow">' + p.dayShort +
      '</span><span class="date-block__day">' + p.day + '</span><span class="date-block__mon">' +
      p.monthShort + ' ' + p.year + '</span></p>';
  }

  function renderMeta(ev, venues) {
    var bits = [];
    var time = formatTimeRange(ev);
    if (time) bits.push(esc(time));
    var vn = venueName(ev, venues);
    if (vn) bits.push(esc(vn));
    else if (!ev.url && eventEnd(ev).getTime() >= Date.now()) bits.push('Venue to be confirmed');
    return bits.join(' <span aria-hidden="true">·</span> ');
  }

  function renderBadges(ev) {
    var out = '<span class="badge badge--' + typeSlug(ev.type) + '">' + esc(ev.type) + '</span>';
    if (ev.cancelled) out += ' <span class="badge badge--warn">Cancelled</span>';
    if (ev.membersOnly) out += ' <span class="badge">Members only</span>';
    return out;
  }

  function renderCard(ev, venues, opts) {
    opts = opts || {};
    var h = opts.headingLevel || 3;
    return '<article class="event-card" data-type="' + esc(ev.type) + '">' +
      renderDateBlock(ev) +
      '<div class="event-card__body">' +
      '<p class="event-card__badges">' + renderBadges(ev) + '</p>' +
      '<h' + h + ' class="event-card__title"><a href="' + esc(eventUrl(ev)) + '">' + esc(ev.title) + '</a></h' + h + '>' +
      '<p class="event-card__when"><time datetime="' + esc(ev.startTime ? isoLocal(ev.date, ev.startTime) : ev.date) + '">' +
      esc(formatDate(ev.date)) + '</time></p>' +
      '<p class="event-card__meta">' + renderMeta(ev, venues) + '</p>' +
      (ev.speaker ? '<p class="event-card__speaker">With ' + esc(ev.speaker) + '</p>' : '') +
      (ev.shortDescription ? '<p class="event-card__desc">' + esc(ev.shortDescription) + '</p>' : '') +
      '</div></article>';
  }

  function renderNextEvent(ev, venues) {
    if (!ev) {
      return '<div class="next-event next-event--empty"><h2 class="next-event__label">Next event</h2>' +
        '<p>Our next meeting will be announced soon. Monthly meetings are usually held on the first Tuesday of the month (except August).</p>' +
        '<p><a class="btn btn--ghost" href="/contact/">Ask us about the next meeting</a></p></div>';
    }
    var p = dateParts(ev.date);
    var url = eventUrl(ev);
    var booking = ev.bookingUrl
      ? '<a class="btn btn--ghost" href="' + esc(ev.bookingUrl) + '" rel="noopener">' + esc(ev.bookingText || 'Book a place') +
        '<span class="visually-hidden"> for ' + esc(ev.title) + ' (opens external site)</span></a>'
      : '';
    return '<div class="next-event">' +
      '<div class="next-event__date" aria-hidden="true"><span class="next-event__dow">' + p.dayName + '</span>' +
      '<span class="next-event__day">' + p.day + '</span><span class="next-event__mon">' + p.monthName + ' ' + p.year + '</span></div>' +
      '<div class="next-event__body">' +
      '<h2 class="next-event__label">Next event</h2>' +
      '<p class="event-card__badges">' + renderBadges(ev) + '</p>' +
      '<h3 class="next-event__title"><a href="' + esc(url) + '">' + esc(ev.title) + '</a></h3>' +
      (ev.subtitle ? '<p class="next-event__subtitle">' + esc(ev.subtitle) + '</p>' : '') +
      '<p class="next-event__when"><time datetime="' + esc(ev.startTime ? isoLocal(ev.date, ev.startTime) : ev.date) + '">' +
      esc(formatDate(ev.date)) + '</time></p>' +
      '<p class="event-card__meta">' + renderMeta(ev, venues) + '</p>' +
      (ev.shortDescription ? '<p>' + esc(ev.shortDescription) + '</p>' : '') +
      '<p class="next-event__actions"><a class="btn btn--primary" href="' + esc(url) + '">Event details<span class="visually-hidden">: ' + esc(ev.title) + '</span></a>' +
      booking + '</p>' +
      '</div></div>';
  }

  function renderList(list, venues, emptyHtml, headingLevel) {
    if (!list.length) return emptyHtml || '<p class="empty">No events to show.</p>';
    return '<ul class="event-list" role="list">' + list.map(function (ev) {
      return '<li>' + renderCard(ev, venues, { headingLevel: headingLevel || 3 }) + '</li>';
    }).join('') + '</ul>';
  }

  function presentTypes(list) {
    var seen = {};
    list.forEach(function (ev) { seen[ev.type] = true; });
    return TYPE_ORDER.filter(function (t) { return seen[t]; })
      .concat(Object.keys(seen).filter(function (t) { return TYPE_ORDER.indexOf(t) < 0; }));
  }

  function renderFilters(list, targetId) {
    var types = presentTypes(list);
    if (types.length < 2) return '';
    var btn = function (value, label, pressed) {
      return '<button type="button" class="filter" data-filter="' + esc(value) + '" aria-pressed="' + pressed + '">' + esc(label) + '</button>';
    };
    return '<div class="filters" role="group" aria-label="Filter events by type" data-filter-target="' + esc(targetId) + '">' +
      btn('all', 'All', true) + types.map(function (t) { return btn(t, TYPE_PLURALS[t] || t, false); }).join('') + '</div>';
  }

  function renderArchive(list, venues) {
    if (!list.length) return '<p class="empty">No past events yet.</p>';
    var byYear = {};
    var years = [];
    list.forEach(function (ev) {
      var y = ev.date.slice(0, 4);
      if (!byYear[y]) { byYear[y] = []; years.push(y); }
      byYear[y].push(ev);
    });
    return years.map(function (y) {
      return '<section class="archive-year" aria-labelledby="year-' + y + '"><h2 id="year-' + y + '">' + y + '</h2>' +
        renderList(byYear[y], venues, '', 3) + '</section>';
    }).join('');
  }

  // Full body of an individual event page.
  function renderEventPage(ev, venues, siteUrl) {
    var v = ev.venueId && venues[ev.venueId];
    var isPast = eventEnd(ev).getTime() < Date.now();
    var time = formatTimeRange(ev);
    var facts = '<dl class="facts">' +
      '<div><dt>Date</dt><dd><time datetime="' + esc(ev.date) + '">' + esc(formatDate(ev.date)) + '</time></dd></div>' +
      (time ? '<div><dt>Time</dt><dd>' + esc(time) + '</dd></div>' : '') +
      '<div><dt>Venue</dt><dd>' + (v ? esc(v.name) : (isPast ? 'Not recorded' : 'To be confirmed')) + '</dd></div>' +
      '<div><dt>Event type</dt><dd>' + esc(ev.type) + '</dd></div>' +
      (ev.speaker ? '<div><dt>Speaker</dt><dd>' + esc(ev.speaker) + '</dd></div>' : '') +
      (ev.price ? '<div><dt>Price</dt><dd>' + esc(ev.price) + '</dd></div>' : '') +
      '</dl>';

    var booking = '';
    if (ev.bookingUrl) {
      booking = '<section class="panel" aria-labelledby="booking-h" data-hide-when-past><h2 id="booking-h">Booking</h2>' +
        (ev.bookingNote ? '<p>' + esc(ev.bookingNote) + '</p>' : '') +
        '<p><a class="btn btn--primary" href="' + esc(ev.bookingUrl) + '" rel="noopener">' + esc(ev.bookingText || 'Book a place') +
        '<span class="visually-hidden"> (opens external site)</span></a></p></section>';
    }

    var calendar = '<div class="calendar-actions" data-hide-when-past>' +
      '<h2 class="visually-hidden">Add to calendar</h2>' +
      '<a class="btn btn--ghost" href="' + esc(googleCalendarUrl(ev, venues, siteUrl)) + '" rel="noopener">Add to Google Calendar</a>' +
      '<button type="button" class="btn btn--ghost" data-ics="' + esc(ev.id) + '" hidden>Download calendar file (.ics)</button>' +
      '<p class="calendar-actions__hint">The calendar file works with Apple Calendar, Outlook and most other calendar apps.</p>' +
      '</div>';

    var links = (ev.links && ev.links.length)
      ? '<ul class="link-list">' + ev.links.map(function (l) {
          return '<li><a href="' + esc(l.url) + '" rel="noopener">' + esc(l.text) + '</a></li>';
        }).join('') + '</ul>'
      : '';

    var about = (ev.description || links)
      ? '<section aria-labelledby="about-h"><h2 id="about-h">About this event</h2>' + paragraphs(ev.description) + links + '</section>'
      : '<section aria-labelledby="about-h"><h2 id="about-h">About this event</h2><p>Further details for this event have not been published yet. <a href="/contact/">Contact us</a> if you have a question.</p></section>';

    var speaker = ev.speaker
      ? '<section aria-labelledby="speaker-h"><h2 id="speaker-h">Speaker</h2><h3>' +
        (ev.speakerUrl ? '<a href="' + esc(ev.speakerUrl) + '" rel="noopener">' + esc(ev.speaker) + '</a>' : esc(ev.speaker)) + '</h3>' +
        paragraphs(ev.speakerBio) + '</section>'
      : '';

    var venue;
    if (v) {
      var mapUrl = venueMapUrl(v);
      venue = '<section class="panel" aria-labelledby="venue-h"><h2 id="venue-h">Venue</h2>' +
        '<p class="venue-name">' + esc(v.name) + (v.room ? ' (' + esc(v.room) + ')' : '') + '</p>' +
        ((v.address || v.town || v.postcode) ? '<p>' + [v.address, v.town, v.postcode].filter(Boolean).map(esc).join('<br>') + '</p>' : '') +
        (ev.venueNote ? '<p>' + esc(ev.venueNote) + '</p>' : '') +
        (mapUrl ? '<p><a href="' + esc(mapUrl) + '" rel="noopener">View ' + esc(v.name) + ' on a map</a></p>' : '') +
        (v.online ? '' : '<h3>Parking</h3><p>' + (v.parking ? esc(v.parking) : 'Parking details to be confirmed.') + '</p>' +
        '<h3>Accessibility</h3><p>' + (ev.accessibility || v.accessibility ? esc(ev.accessibility || v.accessibility) : 'Accessibility details to be confirmed. Please <a href="/contact/">contact us</a> if you have any access needs and we will do our best to help.') + '</p>') +
        '</section>';
    } else if (isPast) {
      venue = '';
    } else {
      venue = '<section class="panel" aria-labelledby="venue-h"><h2 id="venue-h">Venue</h2>' +
        '<p>The venue for this event has not been confirmed yet.' + (ev.venueNote ? ' ' + esc(ev.venueNote) : '') + '</p>' +
        '<p>Please check back or <a href="/contact/">contact us</a> before attending.</p></section>';
    }

    var image = ev.image
      ? '<figure class="event-hero"><img src="' + esc(ev.image) + '" alt="' + esc(ev.imageAlt || '') + '" width="1200" height="675"></figure>'
      : '';

    return '<article class="event-page" data-ras="event-actions" data-event-id="' + esc(ev.id) + '" data-event-end="' + esc(eventEnd(ev).toISOString()) + '">' +
      '<nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/events/">What\'s On</a></li><li><a href="/events/past/">' +
      esc(String(parseDate(ev.date).y)) + ' events</a></li><li aria-current="page">' + esc(ev.title) + '</li></ol></nav>' +
      '<header class="event-page__header"><p class="event-card__badges">' + renderBadges(ev) + '</p>' +
      '<h1>' + esc(ev.title) + '</h1>' + (ev.subtitle ? '<p class="lede">' + esc(ev.subtitle) + '</p>' : '') + '</header>' +
      '<div class="event-status" role="status" data-event-status></div>' +
      image +
      '<div class="event-page__grid"><div class="event-page__main">' + facts + calendar + about + speaker + '</div>' +
      '<aside class="event-page__side">' + booking + venue + '</aside></div>' +
      '<p class="back-link"><a href="/events/">See all upcoming events</a> <span aria-hidden="true">·</span> <a href="/events/past/">Browse past events</a></p>' +
      '</article>';
  }

  var api = {
    SITE_URL: SITE_URL,
    esc: esc,
    londonToDate: londonToDate,
    isoLocal: isoLocal,
    formatDate: formatDate,
    formatTime: formatTime,
    formatTimeRange: formatTimeRange,
    eventStart: eventStart,
    eventEnd: eventEnd,
    eventUrl: eventUrl,
    upcoming: upcoming,
    past: past,
    nextEvent: nextEvent,
    venueIndex: venueIndex,
    venueMapUrl: venueMapUrl,
    buildICS: buildICS,
    googleCalendarUrl: googleCalendarUrl,
    eventJsonLd: eventJsonLd,
    jsonLdScript: jsonLdScript,
    renderCard: renderCard,
    renderNextEvent: renderNextEvent,
    renderList: renderList,
    renderFilters: renderFilters,
    renderArchive: renderArchive,
    renderEventPage: renderEventPage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  root.RASEvents = api;

  /* ---------- browser boot ---------- */

  // The site root, worked out from this script's own address, so data and
  // links work whether the site is served from / or from a sub-folder.
  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/js\/events\.js(\?.*)?$/, '') : location.origin + '/';
  })();

  function fixLinks(el) {
    Array.prototype.forEach.call(el.querySelectorAll('a[href^="/"]'), function (a) {
      if (a.getAttribute('href').charAt(1) !== '/') a.setAttribute('href', BASE + a.getAttribute('href').slice(1));
    });
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  function wireFilters(scope) {
    var groups = scope.querySelectorAll('[data-filter-target]');
    Array.prototype.forEach.call(groups, function (group) {
      var target = document.getElementById(group.getAttribute('data-filter-target'));
      if (!target) return;
      var status = document.getElementById(group.getAttribute('data-filter-target') + '-status');
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        var value = btn.getAttribute('data-filter');
        Array.prototype.forEach.call(group.querySelectorAll('button[data-filter]'), function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        var shown = 0;
        Array.prototype.forEach.call(target.querySelectorAll('.event-card'), function (card) {
          var match = value === 'all' || card.getAttribute('data-type') === value;
          card.parentNode.hidden = !match;
          if (match) shown++;
        });
        Array.prototype.forEach.call(target.querySelectorAll('.archive-year'), function (sec) {
          sec.hidden = !sec.querySelector('li:not([hidden])');
        });
        if (status) status.textContent = 'Showing ' + shown + ' event' + (shown === 1 ? '' : 's') + '.';
      });
    });
  }

  function downloadICS(ev, venues) {
    var blob = new Blob([buildICS(ev, venues, BASE.replace(/\/$/, ''))], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ev.slug + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function boot() {
    var targets = document.querySelectorAll('[data-ras]');
    if (!targets.length) return;
    Promise.all([fetchJson(BASE + 'data/events.json'), fetchJson(BASE + 'data/venues.json')]).then(function (res) {
      var events = res[0];
      var venues = venueIndex(res[1]);
      var now = new Date();
      Array.prototype.forEach.call(targets, function (el) {
        var kind = el.getAttribute('data-ras');
        var limit = parseInt(el.getAttribute('data-limit') || '0', 10);
        if (kind === 'next-event') {
          el.innerHTML = renderNextEvent(nextEvent(events, now), venues);
        } else if (kind === 'upcoming') {
          var list = upcoming(events, now);
          var nextEv = nextEvent(events, now);
          if (el.hasAttribute('data-skip-next') && nextEv) list = list.filter(function (e) { return e !== nextEv; });
          if (limit) list = list.slice(0, limit);
          el.innerHTML = renderList(list, venues,
            '<p class="empty">No further events have been announced yet. Check back soon, or follow us on Facebook for updates.</p>');
        } else if (kind === 'programme') {
          var prog = upcoming(events, now);
          el.innerHTML = renderFilters(prog, 'programme-list') +
            '<p class="visually-hidden" id="programme-list-status" aria-live="polite"></p>' +
            '<div id="programme-list">' + renderList(prog, venues,
              '<p class="empty">No upcoming events have been announced yet. Our monthly meetings are usually on the first Tuesday of the month (except August).</p>') + '</div>';
        } else if (kind === 'past') {
          var arch = past(events, now);
          el.innerHTML = renderFilters(arch, 'archive-list') +
            '<p class="visually-hidden" id="archive-list-status" aria-live="polite"></p>' +
            '<div id="archive-list">' + renderArchive(arch, venues) + '</div>';
        } else if (kind === 'event-actions') {
          var id = el.getAttribute('data-event-id');
          var ev = events.filter(function (e) { return e.id === id; })[0];
          if (!ev) return;
          var btn = el.querySelector('[data-ics]');
          if (btn) {
            btn.hidden = false;
            btn.addEventListener('click', function () { downloadICS(ev, venues); });
          }
          var status = el.querySelector('[data-event-status]');
          if (ev.cancelled) {
            status.innerHTML = '<p class="notice notice--warn"><strong>This event has been cancelled.</strong></p>';
          } else if (!isUpcoming(ev, now)) {
            status.innerHTML = '<p class="notice">This event has already taken place. <a href="/events/">See what\'s coming up</a>.</p>';
            Array.prototype.forEach.call(el.querySelectorAll('[data-hide-when-past]'), function (n) { n.hidden = true; });
          }
        }
      });
      Array.prototype.forEach.call(targets, fixLinks);
      wireFilters(document);
    }).catch(function (err) {
      Array.prototype.forEach.call(targets, function (el) {
        if (el.getAttribute('data-ras') === 'event-actions') return;
        // Keep any pre-rendered content; only replace an empty container.
        if (!el.textContent.trim()) {
          el.innerHTML = '<p class="notice">Sorry, the events list could not be loaded. Please try again later or <a href="/contact/">contact us</a>.</p>';
        }
      });
      if (window.console) console.error(err);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : this);
