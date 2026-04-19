// Calendar Engine — Economic event fetch + high-volatility suppression
(function (global) {
  'use strict';

  // ForexFactory publishes a free JSON calendar used by many community tools
  var FF_URL       = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  var CACHE_TTL_MS = 15 * 60 * 1000; // refresh every 15 min

  // ±5 minutes around a high-impact event: spreads typically widen 2–3× and price
  // can gap 20–50 pips in either direction within seconds, making model-generated
  // signals unreliable. Signals are suppressed for the full 10-minute window.
  var SUPPRESS_MS  = 5 * 60 * 1000;

  var TARGET_CCY   = { USD: true, EUR: true };
  var HIGH_IMPACT  = { High: true };

  var cachedEvents = [];
  var lastFetch    = 0;

  function fetchWithTimeout(url, options, timeoutMs) {
    var timeout = timeoutMs || 8000;
    if (window.AbortController) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeout);
      var requestOptions = options || {};
      requestOptions.signal = controller.signal;
      return fetch(url, requestOptions).then(function (res) {
        clearTimeout(timer);
        return res;
      }, function (err) {
        clearTimeout(timer);
        throw err;
      });
    }
    return Promise.race([
      fetch(url, options),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Request timeout')); }, timeout);
      }),
    ]);
  }

  // ── Fetch & parse ────────────────────────────────────────────────────────────
  function fetchCalendar() {
    var now = Date.now();
    if (cachedEvents.length && now - lastFetch < CACHE_TTL_MS) {
      return Promise.resolve(cachedEvents);
    }

    return fetchWithTimeout(FF_URL, null, 8000)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) throw new Error('Unexpected format');
        cachedEvents = data
          .filter(function (e) {
            return TARGET_CCY[e.country] && HIGH_IMPACT[e.impact];
          })
          .map(function (e) {
            return {
              title:    e.title    || 'Event',
              currency: e.country  || '',
              impact:   e.impact   || 'High',
              ts:       new Date(e.date).getTime(),
              forecast: e.forecast || '—',
              previous: e.previous || '—',
            };
          })
          .sort(function (a, b) { return a.ts - b.ts; });
        lastFetch = now;
        return cachedEvents;
      })
      .catch(function () {
        // Return cached or empty — never crash the signal pipeline
        return cachedEvents;
      });
  }

  // ── Suppression check ────────────────────────────────────────────────────────
  function isHighVolatilityPeriod(events) {
    var now = Date.now();
    return events.some(function (e) { return Math.abs(e.ts - now) <= SUPPRESS_MS; });
  }

  // ── Filter to upcoming events within `limitMinutes` ──────────────────────────
  function getUpcomingEvents(events, limitMinutes) {
    var mins   = limitMinutes !== undefined ? limitMinutes : 240;
    var now    = Date.now();
    var cutoff = now + mins * 60 * 1000;
    return events.filter(function (e) {
      return e.ts >= now - 60 * 1000 && e.ts <= cutoff;
    });
  }

  // ── Human-readable countdown ─────────────────────────────────────────────────
  function formatCountdown(ts) {
    var diff = ts - Date.now();
    if (diff < 0) return 'NOW';
    var h = Math.floor(diff / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000)   / 1000);
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  global.CalendarEngine = {
    fetchCalendar:          fetchCalendar,
    isHighVolatilityPeriod: isHighVolatilityPeriod,
    getUpcomingEvents:      getUpcomingEvents,
    formatCountdown:        formatCountdown,
  };

}(window));
# Deployment test 2026-04-19 06:58:49
