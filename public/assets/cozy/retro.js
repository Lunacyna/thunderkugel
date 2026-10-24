/* ==========================================================================
   Lunacynas Spielezimmer – 8-Bit / Retro-Modus (JS)
   Einbinden im <head> direkt nach cozy.js (synchron, damit der Look vor dem
   ersten Bild steht):
     <link rel="stylesheet" href="/assets/cozy/retro.css?v=1">
     <script src="/assets/cozy/retro.js?v=1"></script>

   Zustand:  <html class="retro-mode">  +  localStorage "lz_retro" = "1"
   API:      LZRetro.get() · LZRetro.set(true|false) · LZRetro.toggle()
             window-Event "lzretro" (detail: {on}) für Seiten, die z. B. Canvas-
             Auflösung umstellen wollen
   Platzhalter (optional): [data-lz-retro] -> dort wird der Schalter eingesetzt,
             sonst direkt hinter dem Farbstimmungs-Knopf bzw. vor #muteBtn.
   ========================================================================== */
(function () {
  'use strict';
  if (window.LZRetro) return;
  var root = document.documentElement, KEY = 'lz_retro';
  function read() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function write(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {} }
  var on = read();
  if (on) root.classList.add('retro-mode');          // sofort, noch vor dem ersten Rendern

  var switches = [];
  function say(t) { if (window.LZCozy) LZCozy.announce(t); }
  function snd(name) { if (window.LZSound) LZSound.play(name); }
  function voice() { if (window.LZSound && LZSound.setVoice) LZSound.setVoice(on ? 'chip' : 'soft'); }

  function apply(next, opts) {
    opts = opts || {};
    next = !!next;
    var changed = next !== on;
    on = next;
    root.classList.toggle('retro-mode', on);
    if (!opts.fromStorage) write(on);
    voice();
    sync();
    if (changed) {
      try { window.dispatchEvent(new CustomEvent('lzretro', { detail: { on: on } })); } catch (e) {}
      if (!opts.silent) {
        snd('klack');
        setTimeout(function () { snd(on ? 'powerup' : 'powerdown'); }, 70);
        say(on ? '8-Bit-Modus an' : '8-Bit-Modus aus');
      }
    }
  }
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(e.newValue === '1', { fromStorage: true, silent: true }); });

  /* ---- Schalter ---------------------------------------------------------- */
  function sync() {
    switches.forEach(function (b) {
      b.setAttribute('aria-checked', String(on));
      b.title = on ? '8-Bit-Modus ausschalten' : '8-Bit-Modus einschalten';
    });
  }
  function mount() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lz-retro';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-label', '8-Bit Retro-Modus umschalten');
    b.innerHTML = '<span class="lz-retro-led" aria-hidden="true"></span><span class="lz-retro-track" aria-hidden="true"><span class="lz-retro-knob"></span></span><span class="lz-retro-txt" aria-hidden="true">8-BIT</span>';
    b.addEventListener('click', function () { apply(!on); });
    var slot = document.querySelector('[data-lz-retro]'), theme = document.querySelector('.lz-theme'), mute = document.getElementById('muteBtn');
    if (slot) slot.appendChild(b);
    else if (theme && theme.parentNode && !theme.classList.contains('lz-theme-fixed')) theme.parentNode.insertBefore(b, theme.nextSibling);
    else if (mute && mute.parentNode) mute.parentNode.insertBefore(b, mute);
    else { b.classList.add('lz-retro-fixed'); document.body.appendChild(b); }
    switches.push(b); sync();
  }

  /* ---- Arcade-Töne: Hover-"Blip" und Klick-"Select" ------------------------
     Nur im Retro-Modus, nur mit echter Maus (kein Blip beim Scrollen am Handy),
     Hover-Töne nur, wenn Audio schon durch einen Klick freigeschaltet ist. */
  var HOT = 'a[href],button:not([disabled]),[role=button],.choice,a.game,button.tile,.clue[data-toggle],summary,label[for]';
  var lastHot = null, lastBlip = 0;
  document.addEventListener('pointerover', function (e) {
    if (!on || e.pointerType !== 'mouse' || !e.target.closest) return;
    var el = e.target.closest(HOT);
    if (el === lastHot) return;
    lastHot = el;
    if (!el || el.classList.contains('lz-retro')) return;
    var now = performance.now(); if (now - lastBlip < 60) return; lastBlip = now;
    if (window.LZSound && LZSound.playIfReady) LZSound.playIfReady('blip');
  }, { passive: true });
  document.addEventListener('click', function (e) {
    if (!on || !e.target.closest) return;
    var el = e.target.closest(HOT);
    if (!el || el.classList.contains('lz-retro') || el.closest('#muteBtn') || el.hasAttribute('disabled')) return;
    snd('select');
  }, true);

  /* ---- Easter Egg: Konami-Code ↑ ↑ ↓ ↓ ← → ← → B A ------------------------- */
  var CODE = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  var pos = 0;
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (window.LZCozy && LZCozy.isTyping(e) && !/^Arrow/.test(e.key)) { pos = 0; return; }
    var k = String(e.key || '').toLowerCase();
    if (k === CODE[pos]) pos++;
    else pos = k === CODE[0] ? 1 : 0;
    if (pos === CODE.length) { pos = 0; konami(); }
  });
  function konami() {
    var cls = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'lz-flash' : 'lz-shake';
    root.classList.remove('lz-shake', 'lz-flash'); void root.offsetWidth; root.classList.add(cls);
    setTimeout(function () { root.classList.remove(cls); }, 600);
    if (!on) apply(true, { silent: true });
    snd('coin');
    setTimeout(function () { snd('powerup'); }, 420);
    say('Konami-Code! 8-Bit-Modus an. Player 1 ready.');
  }

  /* ---- Start --------------------------------------------------------------- */
  function boot() {
    // CRT-Overlay: ein einziges Element, unsichtbar außerhalb des Retro-Modus
    var crt = document.createElement('div');
    crt.className = 'lz-crt'; crt.setAttribute('aria-hidden', 'true');
    document.body.appendChild(crt);
    mount();
    voice();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.LZRetro = { get: function () { return on; }, set: function (v) { apply(v); }, toggle: function () { apply(!on); } };
})();
