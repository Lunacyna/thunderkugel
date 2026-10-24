/* ==========================================================================
   Lunacynas Spielezimmer – gemeinsames Cozy-Modul (JS)
   Einbinden im <head> (synchron, damit das Theme vor dem ersten Bild steht):
     <link rel="stylesheet" href="/assets/cozy/cozy.css?v=1">
     <script src="/assets/cozy/cozy.js?v=1"></script>

   API (window.LZCozy):
     LZCozy.theme.get()            -> 'nacht' | 'kamin'
     LZCozy.theme.set(t)           -> 'nacht' | 'kamin' | 'auto' (auto = Systemeinstellung)
     LZCozy.theme.toggle()
     LZCozy.theme.onChange(fn)     -> fn(theme)
     LZCozy.announce(text, {assertive:true})   Screenreader-Ansage
     LZCozy.keys(fn)               -> Tastenkürzel der Seite; fn(e) wird nur aufgerufen,
                                      wenn niemand gerade tippt und kein Dialog offen ist
     LZCozy.isTyping(e)
     LZCozy.feedback.open()
   Platzhalter im Markup (optional):
     [data-lz-theme]     -> hier wird der Theme-Schalter eingesetzt (sonst vor #muteBtn)
     [data-lz-feedback]  -> eigener Button, der den Feedback-Dialog öffnet
   ========================================================================== */
(function () {
  'use strict';
  if (window.LZCozy) return;
  var root = document.documentElement;
  var KEY = 'lz_theme';
  var THEMES = { nacht: 'Sternennacht', kamin: 'Kaminabend' };
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;

  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) {} }
  // Beide Themes sind dunkel. Systemeinstellung "hell" -> der wärmere, weichere Kaminabend.
  function systemTheme() { return mq && mq.matches ? 'kamin' : 'nacht'; }
  function resolve() { var s = read(); return THEMES[s] ? s : systemTheme(); }

  var subs = [];
  function apply(t, animate) {
    if (animate) {
      root.classList.add('lz-theme-anim');
      clearTimeout(apply._t); apply._t = setTimeout(function () { root.classList.remove('lz-theme-anim'); }, 420);
    }
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'kamin' ? '#1C1916' : '#16123A');
    syncButtons();
    subs.forEach(function (fn) { try { fn(t); } catch (e) {} });
  }
  // Sofort setzen – dieses Script läuft im <head>, also vor dem ersten Rendern.
  root.setAttribute('data-theme', resolve());

  var theme = {
    get: function () { return root.getAttribute('data-theme') || 'nacht'; },
    set: function (t) {
      if (t === 'auto') write(null); else if (THEMES[t]) write(t); else return;
      apply(resolve(), true);
    },
    toggle: function () { theme.set(theme.get() === 'kamin' ? 'nacht' : 'kamin'); },
    onChange: function (fn) { subs.push(fn); },
    names: THEMES
  };
  if (mq) {
    var onSys = function () { if (!THEMES[read()]) apply(systemTheme(), true); };
    mq.addEventListener ? mq.addEventListener('change', onSys) : mq.addListener(onSys);
  }
  // Andere Tabs halten Schritt
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(resolve(), true); });

  /* ---- Theme-Schalter --------------------------------------------------- */
  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/><path d="M17 3.5v3M15.5 5h3" stroke-width="1.6"/></svg>';
  var ICON_FLAME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.4 2.6-5.2 3.6-8.4.4 1.8 1.6 2.8 2.6 3.2C12.6 7.4 14 5 13.6 3c3 2 4.4 6.2 4.4 9.6 0 .4 0 .7-.1 1 0 4.6-2.4 7.4-5.9 7.4z"/><path d="M12 21c-1.5 0-2.6-1-2.6-2.5 0-1.6 1.4-2.4 2-3.9.9 1 3.2 2 3.2 4 0 1.4-1.1 2.4-2.6 2.4z"/></svg>';
  var buttons = [];
  function syncButtons() {
    var t = theme.get(), other = t === 'kamin' ? 'nacht' : 'kamin';
    buttons.forEach(function (b) {
      b.innerHTML = t === 'kamin' ? ICON_FLAME : ICON_MOON;
      b.setAttribute('aria-pressed', String(t === 'kamin'));
      b.setAttribute('aria-label', 'Farbstimmung: ' + THEMES[t] + '. Zu ' + THEMES[other] + ' wechseln');
      b.title = THEMES[t] + ' – klicken für ' + THEMES[other];
    });
  }
  function mountThemeButton() {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'lz-theme';
    b.addEventListener('click', function () {
      theme.toggle();
      if (window.LZSound) LZSound.play('magic');
      announce('Farbstimmung ' + THEMES[theme.get()]);
    });
    var slot = document.querySelector('[data-lz-theme]');
    var mute = document.getElementById('muteBtn');
    if (slot) slot.appendChild(b);
    else if (mute && mute.parentNode) mute.parentNode.insertBefore(b, mute);
    else { b.classList.add('lz-theme-fixed'); document.body.appendChild(b); }
    buttons.push(b); syncButtons();
  }

  /* ---- Screenreader-Ansagen ------------------------------------------- */
  var live = {};
  function region(kind) {
    if (live[kind]) return live[kind];
    var d = document.createElement('div');
    d.className = 'lz-sr';
    d.setAttribute('aria-live', kind);
    d.setAttribute('aria-atomic', 'true');
    if (kind === 'assertive') d.setAttribute('role', 'alert'); else d.setAttribute('role', 'status');
    (document.body || root).appendChild(d);
    return (live[kind] = d);
  }
  var lastText = '', lastAt = 0;
  function announce(text, opts) {
    if (!text) return;
    text = String(text).replace(/\s+/g, ' ').trim();
    var now = Date.now();
    if (text === lastText && now - lastAt < 1500) return;   // keine Doppelansagen bei Re-Renders
    lastText = text; lastAt = now;
    var r = region(opts && opts.assertive ? 'assertive' : 'polite');
    r.textContent = '';
    // kurze Pause, damit gleiche Texte erneut vorgelesen werden
    setTimeout(function () { r.textContent = text; }, 60);
  }

  /* ---- Tastatur -------------------------------------------------------- */
  function isTyping(e) {
    var t = e && e.target;
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    var tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !/^(button|submit|reset|checkbox|radio|range|color)$/i.test(t.type);
    return false;
  }
  function modalOpen() {
    if (document.querySelector('dialog[open]')) return true;
    var m = document.querySelectorAll('[aria-modal="true"]');
    for (var i = 0; i < m.length; i++) { if (m[i].offsetParent !== null) return true; }
    return false;
  }
  function keys(fn) {
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (isTyping(e) || modalOpen()) return;
      fn(e);
    });
  }

  /* ---- Pfeiltasten in Button-Gruppen ------------------------------------
     Innerhalb einer Gruppe (Segment-Schalter, Auswahlkarten, Zahlenfelder,
     Hinweis-Zettel …) springt der Fokus mit den Pfeiltasten zum nächsten
     Element in Pfeilrichtung – geometrisch, funktioniert also für Reihen
     und Raster gleichermaßen. Home/End springen an den Anfang/das Ende. */
  var arrowGroups = ['.seg', '.chips', '.choices', '.tiles', '.clues', '[data-lz-arrows]'];
  var ITEM = 'button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    var k = e.key; if (!/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(k)) return;
    var cur = document.activeElement; if (!cur || !cur.closest) return;
    var group = cur.closest(arrowGroups.join(',')); if (!group || !cur.matches(ITEM)) return;
    var items = Array.prototype.filter.call(group.querySelectorAll(ITEM), function (el) { return el.offsetParent !== null; });
    if (items.length < 2) return;
    var next = null;
    if (k === 'Home') next = items[0];
    else if (k === 'End') next = items[items.length - 1];
    else {
      var r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, best = Infinity;
      var dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      items.forEach(function (el) {
        if (el === cur) return;
        var q = el.getBoundingClientRect(), x = q.left + q.width / 2 - cx, y = q.top + q.height / 2 - cy;
        var along = x * dx + y * dy; if (along <= 2) return;                       // muss in Pfeilrichtung liegen
        var across = Math.abs(dx ? y : x), score = along + across * 3;              // gerade Linie bevorzugen
        if (score < best) { best = score; next = el; }
      });
      // am Rand einer Reihe: links/rechts läuft weiter in die nächste/vorige Reihe
      if (!next && dx) next = items[(items.indexOf(cur) + dx + items.length) % items.length];
    }
    if (next) { e.preventDefault(); next.focus(); }
  });

  /* ---- Fokus über ein Neu-Rendern retten -------------------------------
     Die Spiele bauen ihren Inhalt per innerHTML neu. Ohne Hilfe landet der
     Tastaturfokus dann im Nichts. saveFocus(container) merkt sich das
     fokussierte Element anhand seiner data-Attribute und gibt eine
     Funktion zurück, die es nach dem Rendern wieder fokussiert. */
  var KEY_ATTRS = ['data-do', 'data-pick', 'data-toggle', 'data-code', 'data-v', 'data-i', 'data-name', 'id'];
  function selectorFor(el) {
    var parts = [];
    KEY_ATTRS.forEach(function (a) { if (el.hasAttribute(a)) parts.push('[' + a + '="' + String(el.getAttribute(a)).replace(/"/g, '\\"') + '"]'); });
    if (!parts.length) return null;
    var seg = el.closest('[data-seg],[data-filter]');
    var pre = seg ? (seg.hasAttribute('data-seg') ? '[data-seg="' + seg.getAttribute('data-seg') + '"] ' : '[data-filter="' + seg.getAttribute('data-filter') + '"] ') : '';
    return pre + el.tagName.toLowerCase() + parts.join('');
  }
  function saveFocus(container) {
    var ae = document.activeElement;
    if (!container || !ae || ae === document.body || !container.contains(ae)) return function () { return false; };
    var sel = selectorFor(ae), wasKeyboard = ae.matches(':focus-visible');
    return function (fallback) {
      if (document.activeElement && document.activeElement !== document.body && container.contains(document.activeElement)) return true;
      var el = sel && container.querySelector(sel);
      if (!el && fallback) el = container.querySelector(fallback);
      if (el && el.focus) { el.focus({ preventScroll: !wasKeyboard }); return true; }
      return false;
    };
  }
  function text(html) { var d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').replace(/\s+/g, ' ').trim(); }

  /* ---- Fun Metrics: abgeschlossene Runden melden -----------------------
     LZCozy.stats.round({ game:'zw'|'ne'|'kb', id:'<spiel-id>:<runde>',
                          start:<Date.now() beim Rundenstart>  ODER  sec:<gemessene Sekunden>,
                          cards:0|1, balls:n, shakes:n })
     Spielzeit = Rundenende − Rundenstart, abzüglich der Zeit, in der dieser
     Tab im Hintergrund lag, gedeckelt pro Spiel (der Server deckelt nochmal).
     Fire-and-forget: Fehler stören das Spiel nie. */
  var STAT_CAP = { kb: 900, zw: 1800, ne: 900, stack: 1200, pong: 1200, c4: 1200, dots: 1200, memo: 1200, dung: 1800, sf: 1800 };
  var hiddenSpans = [], hiddenSince = document.hidden ? Date.now() : null;
  document.addEventListener('visibilitychange', function () {
    var now = Date.now();
    if (document.hidden) hiddenSince = now;
    else if (hiddenSince != null) { hiddenSpans.push([hiddenSince, now]); if (hiddenSpans.length > 60) hiddenSpans.shift(); hiddenSince = null; }
  });
  function visibleMs(start, end) {
    var ms = end - start, spans = hiddenSpans.concat(hiddenSince != null ? [[hiddenSince, end]] : []);
    spans.forEach(function (s) { var a = Math.max(s[0], start), b = Math.min(s[1], end); if (b > a) ms -= b - a; });
    return Math.max(0, ms);
  }
  var stats = {
    round: function (o) {
      try {
        if (!o || !STAT_CAP[o.game] || !o.id) return;
        var sec = o.sec != null ? +o.sec : (o.start ? visibleMs(+o.start, Date.now()) / 1000 : 0);
        // Uhren verschiedener Geräte (Spielleitung wechselt) können abweichen -> nie negativ, nie über der Grenze
        sec = Math.max(0, Math.min(STAT_CAP[o.game], Math.round(sec || 0)));
        var body = JSON.stringify({ game: o.game, id: String(o.id).toLowerCase().replace(/[^a-z0-9:]/g, '').slice(0, 30),
                                    sec: sec, cards: o.cards ? 1 : 0, balls: o.balls | 0, shakes: o.shakes | 0 });
        fetch('/api/stats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true, credentials: 'same-origin' }).catch(function () {});
      } catch (e) {}
    },
    newId: function () { return (Math.random().toString(36).slice(2, 10) + Date.now().toString(36)).slice(0, 18); },
    visibleMs: visibleMs
  };

  /* ---- Feedback-Dialog -------------------------------------------------- */
  var ICON_BUG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 18c1-1.6 2.4-2.6 4-3M19 18c-1-1.6-2.4-2.6-4-3"/><path d="M8 10.5C8 7 9.8 5 12 5s4 2 4 5.5V14a4 4 0 0 1-8 0z"/><path d="M8.5 6 7 4.5M15.5 6 17 4.5M12 10v8"/></svg>';
  var MAXLEN = 2000;
  var dlg, form, opener, openedAt = 0;
  function buildDialog() {
    dlg = document.createElement('dialog');
    dlg.className = 'lz-fb';
    dlg.setAttribute('aria-labelledby', 'lzFbTitle');
    dlg.innerHTML =
      '<form novalidate>' +
        '<button type="button" class="lz-x" data-fb-close aria-label="Schließen">×</button>' +
        '<h2 id="lzFbTitle">Erzähl mal!</h2>' +
        '<p class="lz-fb-sub">Bug gefunden oder eine Idee für ein Spiel? Ich lese alles.</p>' +
        '<fieldset><legend>Worum geht\'s?</legend><div class="lz-seg">' +
          '<label><input type="radio" name="type" value="bug" checked><span>🐞 Bug</span></label>' +
          '<label><input type="radio" name="type" value="idee"><span>💡 Idee</span></label>' +
          '<label><input type="radio" name="type" value="sonstiges"><span>💬 Sonstiges</span></label>' +
        '</div></fieldset>' +
        '<div><label for="lzFbName">Name / Nick</label><input id="lzFbName" name="name" type="text" maxlength="40" autocomplete="nickname" required></div>' +
        '<div><label for="lzFbMail">E-Mail <span class="lz-opt">(optional, nur für Rückfragen)</span></label><input id="lzFbMail" name="email" type="email" maxlength="120" autocomplete="email" inputmode="email"></div>' +
        '<div><label for="lzFbMsg">Nachricht</label><textarea id="lzFbMsg" name="msg" maxlength="' + MAXLEN + '" required aria-describedby="lzFbCount" placeholder="Was ist passiert? In welchem Spiel? Oder: Was hättest du gern?"></textarea></div>' +
        '<div class="lz-count" id="lzFbCount" aria-live="off">0 / ' + MAXLEN + '</div>' +
        '<div class="lz-hp" aria-hidden="true"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>' +
        '<p class="lz-msg" role="status" aria-live="polite"></p>' +
        '<div class="lz-row"><button type="button" class="lz-btn ghost" data-fb-close>Abbrechen</button><button type="submit" class="lz-btn primary">Abschicken</button></div>' +
        '<p class="lz-note">Die aktuelle Seite wird automatisch mitgeschickt. Deine E-Mail sehe nur ich.</p>' +
      '</form>';
    document.body.appendChild(dlg);
    form = dlg.querySelector('form');
    var msg = form.querySelector('.lz-msg'), ta = form.msg, cnt = form.querySelector('.lz-count');
    ta.addEventListener('input', function () { cnt.textContent = ta.value.length + ' / ' + MAXLEN; });
    dlg.addEventListener('click', function (e) {
      if (e.target.closest('[data-fb-close]')) close();
      else if (e.target === dlg) close();            // Klick auf den Hintergrund
    });
    dlg.addEventListener('close', function () { if (opener && opener.focus) opener.focus(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.name.value.trim(), mail = form.email.value.trim(), text = ta.value.trim();
      var bad = null;
      if (!name) bad = [form.name, 'Wie heißt du? Ein Nick reicht.'];
      else if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) bad = [form.email, 'Die E-Mail sieht nicht ganz richtig aus.'];
      else if (text.length < 5) bad = [ta, 'Schreib bitte ein paar Worte mehr.'];
      [form.name, form.email, ta].forEach(function (el) { el.removeAttribute('aria-invalid'); });
      if (bad) { bad[0].setAttribute('aria-invalid', 'true'); bad[0].focus(); setMsg(bad[1], 'err'); return; }
      var btn = form.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Wird gesendet …'; setMsg('', '');
      var body = {
        type: (form.querySelector('input[name=type]:checked') || {}).value || 'bug',
        name: name, email: mail, msg: text,
        page: location.pathname + location.search,
        theme: theme.get(),
        ua: navigator.userAgent.slice(0, 200),
        website: form.website.value,          // Honeypot – bleibt bei Menschen leer
        dt: Date.now() - openedAt              // Bots schicken in < 2 s ab
      };
      fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j.error || 'Senden hat nicht geklappt.');
          ta.value = ''; cnt.textContent = '0 / ' + MAXLEN;
          setMsg('Danke! Deine Nachricht ist angekommen. 💜', 'ok');
          if (window.LZSound) LZSound.play('correct');
          announce('Feedback gesendet. Danke!');
          setTimeout(close, 1800);
        })
        .catch(function (err) {
          setMsg((err && err.message && !/fetch|network/i.test(err.message)) ? err.message : 'Keine Verbindung. Dein Text bleibt stehen – versuch es gleich nochmal.', 'err');
          if (window.LZSound) LZSound.play('wrong');
        })
        .then(function () { btn.disabled = false; btn.textContent = 'Abschicken'; });
    });
    function setMsg(t, cls) { msg.textContent = t; msg.className = 'lz-msg' + (cls ? ' ' + cls : ''); }
  }
  function open() {
    if (!dlg) buildDialog();
    opener = document.activeElement;
    if (!form.name.value && window.kbName && kbName.get) form.name.value = kbName.get() || '';
    form.querySelector('.lz-msg').textContent = '';
    openedAt = Date.now();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    (form.name.value ? form.msg : form.name).focus();
  }
  function close() { if (dlg && dlg.open) { dlg.close ? dlg.close() : dlg.removeAttribute('open'); } }

  function mountFeedback() {
    var own = document.querySelectorAll('[data-lz-feedback]');
    if (own.length) { own.forEach(function (b) { b.addEventListener('click', open); }); return; }
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'lz-fb-open';
    b.innerHTML = ICON_BUG + '<span>Bug gefunden oder Spiel-Idee?</span>';
    b.setAttribute('aria-haspopup', 'dialog');
    b.addEventListener('click', open);
    var foot = document.querySelector('footer');
    if (foot) foot.appendChild(b);
    else { foot = document.createElement('footer'); foot.className = 'lz-foot'; foot.appendChild(b); document.body.appendChild(foot); }
  }

  /* ---- Start ------------------------------------------------------------ */
  function boot() {
    region('polite'); region('assertive');
    mountThemeButton();
    mountFeedback();
    // Sprungmarke zum Hauptinhalt
    var main = document.querySelector('main, #main, [role=main]');
    if (main) {
      if (!main.id) main.id = 'lzMain';
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      var a = document.createElement('a');
      a.className = 'lz-skip'; a.href = '#' + main.id; a.textContent = 'Zum Inhalt springen';
      document.body.insertBefore(a, document.body.firstChild);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.LZCozy = { theme: theme, announce: announce, keys: keys, isTyping: isTyping, saveFocus: saveFocus, text: text,
                    arrowGroups: arrowGroups, stats: stats, feedback: { open: open, close: close } };
})();
