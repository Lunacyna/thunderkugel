/* ==========================================================================
   Katzenthron – Logikrätsel des Tages (Browser-Teil)
   Setze n Katzen auf das n×n-Feld: genau eine pro Zeile, Spalte und Farbzone,
   und keine zwei dürfen sich berühren (auch nicht schräg).
   Das Rätsel kommt vom Server (/api/thron), die Zeit misst der Server ab dem
   ersten Klick; gelöst prüft er selbst. Regeln-Check im Browser: KTCore.check.
   Bedienung: 1. Klick = Kreuz, 2. Klick = Katze, 3. Klick = leer.
   Über leere Felder ziehen setzt Kreuze. Tastatur: Pfeile, Leertaste, K, X, Entf.
   ========================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (t, a) => { if (window.LZCozy) LZCozy.announce(t, { assertive: !!a }); };
  const snd = n => { if (window.LZSound) LZSound.play(n); };
  const ZC = ['#C9B6FF', '#FFB3C7', '#FFD59E', '#A8E6CF', '#9AD0F5', '#F7A6A6', '#D9EC9E', '#E9C9AE', '#B8F0F0'];
  const ZN = ['Lila', 'Rosa', 'Orange', 'Mint', 'Blau', 'Rot', 'Hellgrün', 'Sand', 'Türkis'];
  const CAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3.5l4.2 3.6a9 9 0 0 1 7.6 0L20 3.5v8.2a8 8 0 1 1-16 0z" fill="currentColor"/><circle cx="9" cy="12.2" r="1.3" fill="#fff"/><circle cx="15" cy="12.2" r="1.3" fill="#fff"/><path d="M10.6 15.2h2.8l-1.4 1.4z" fill="#fff"/></svg>';
  const S = { st: null, marks: [], undo: [], focus: 0, auto: false, board: 'day', boardData: null, nextAt: 0, t0: 0, busy: false };
  try { S.auto = localStorage.getItem('lz_kt_auto') === '1'; } catch (e) {}

  function uid() { let u = null; try { u = localStorage.getItem('kb_uid'); } catch (e) {} if (!u || !/^u_[a-z0-9]{10}$/.test(u)) { u = 'u_' + Math.random().toString(36).slice(2, 12).padEnd(10, '0'); try { localStorage.setItem('kb_uid', u); } catch (e) {} } return u; }
  const myName = () => (window.kbName && kbName.get()) || '';
  async function api(body) {
    const opt = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ u: uid(), name: myName(), ...body }), credentials: 'same-origin' } : { credentials: 'same-origin', cache: 'no-store' };
    const r = await fetch(body ? '/api/thron' : '/api/thron?u=' + uid(), opt);
    return r.json().catch(() => ({ error: 'Server antwortet nicht.' }));
  }
  const saveMarks = () => { try { localStorage.setItem('lz_kt_m', JSON.stringify({ date: S.st.date, m: S.marks })); } catch (e) {} };
  function remember() { const st = S.st; try { localStorage.setItem('lz_kt', JSON.stringify({ nr: st.nr, date: st.date, done: st.done, ms: st.ms, streak: st.stats ? st.stats.cur : 0 })); } catch (e) {} }
  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 3600 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : Math.floor(s / 3600) + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

  // ---- Regeln im Browser ----------------------------------------------------------------
  function analyse() {
    const { n, r } = S.st, cats = [], bad = new Set(), blocked = new Set();
    S.marks.forEach((v, i) => { if (v === 2) cats.push(i); });
    for (let a = 0; a < cats.length; a++) for (let b = a + 1; b < cats.length; b++) {
      const i = cats[a], j = cats[b], yi = Math.floor(i / n), xi = i % n, yj = Math.floor(j / n), xj = j % n;
      if (yi === yj || xi === xj || r[i] === r[j] || (Math.abs(yi - yj) <= 1 && Math.abs(xi - xj) <= 1)) { bad.add(i); bad.add(j); }
    }
    if (S.auto) for (const i of cats) { const y = Math.floor(i / n), x = i % n;
      for (let j = 0; j < n * n; j++) { if (j === i) continue; const yj = Math.floor(j / n), xj = j % n;
        if (yj === y || xj === x || r[j] === r[i] || (Math.abs(yj - y) <= 1 && Math.abs(xj - x) <= 1)) blocked.add(j); } }
    return { cats, bad, blocked };
  }
  function solvedNow() {
    const { n } = S.st, cats = new Array(n).fill(-1);
    let k = 0; S.marks.forEach((v, i) => { if (v === 2) { k++; cats[Math.floor(i / n)] = i % n; } });
    return k === n && window.KTCore && KTCore.check(S.st, cats) ? cats : null;
  }

  // ---- Darstellung --------------------------------------------------------------------------
  function dateLabel(d) { try { return new Date(d + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch (e) { return d; } }
  function cellLabel(i, a) {
    const { n, r } = S.st, y = Math.floor(i / n), x = i % n, v = S.marks[i];
    return `Zeile ${y + 1}, Spalte ${x + 1}, Zone ${ZN[r[i]] || r[i] + 1}: ${v === 2 ? 'Katze' + (a.bad.has(i) ? ', Konflikt' : '') : v === 1 ? 'Kreuz' : a.blocked.has(i) ? 'gesperrt' : 'leer'}`;
  }
  function render() {
    const m = $('main'); if (!m) return;
    const st = S.st;
    if (!st) { m.innerHTML = `<div class="panel sheet"><h2>Katzenthron</h2><p><span class="dots">Das Rätsel des Tages wird geholt</span></p></div>`; return; }
    if (st.error) { m.innerHTML = `<div class="panel sheet"><h2>Katzenthron</h2><p>${esc(st.error)}</p><div class="row"><button class="btn" type="button" data-kt="retry">Nochmal versuchen</button></div></div>`; return; }
    const { n, r } = st, a = analyse();
    m.innerHTML = `<div class="kt">
      <div class="ar-bar"><div class="ar-status">Katzenthron <em>#${st.nr}</em> <span class="mw-date">· ${esc(dateLabel(st.date))} · ${n}×${n}</span></div>
        <div class="row"><span class="kt-time" id="ktTime" aria-label="Zeit">${st.done ? fmt(st.ms) : S.t0 ? fmt(Date.now() - S.t0) : '0:00'}</span></div></div>
      <div class="kt-board" id="ktBoard" role="grid" aria-label="Spielfeld ${n} mal ${n}" style="--n:${n}">${[...Array(n)].map((_, y) => `<div role="row" class="kt-row">${[...Array(n)].map((_, x) => {
        const i = y * n + x, z = r[i], v = S.marks[i];
        const bt = y === 0 || r[i - n] !== z, bb = y === n - 1 || r[i + n] !== z, bl = x === 0 || r[i - 1] !== z, br = x === n - 1 || r[i + 1] !== z;
        return `<button type="button" role="gridcell" class="kt-c${v === 2 ? ' cat' : v === 1 ? ' x' : a.blocked.has(i) ? ' bl' : ''}${a.bad.has(i) ? ' bad' : ''}${bt ? ' bt' : ''}${bb ? ' bb' : ''}${bl ? ' bl2' : ''}${br ? ' br' : ''}" style="--z:${ZC[z % ZC.length]}" data-i="${i}" tabindex="${i === S.focus ? 0 : -1}" aria-label="${esc(cellLabel(i, a))}" ${st.done ? 'aria-disabled="true"' : ''}>${v === 2 ? CAT : v === 1 || a.blocked.has(i) ? '<i class="kx" aria-hidden="true">✕</i>' : ''}</button>`;
      }).join('')}</div>`).join('')}</div>
      <p class="mw-msg" id="ktMsg" role="status">${a.bad.size ? 'Da stimmt was nicht: Rot markierte Katzen sehen sich.' : ''}</p>
      ${st.done ? doneHtml() : `<div class="row kt-tools"><button class="btn small ghost" type="button" data-kt="undo" ${S.undo.length ? '' : 'disabled'}>↶ Rückgängig</button><button class="btn small ghost" type="button" data-kt="clear">Feld leeren</button><button class="btn small ghost" type="button" data-kt="auto" aria-pressed="${S.auto}" title="Felder automatisch ausgrauen, auf die keine Katze mehr darf">Hilfskreuze: ${S.auto ? 'an' : 'aus'}</button></div>`}
    </div>`;
    tick();
  }
  function doneHtml() {
    const st = S.st;
    return `<div class="panel mw-done" role="region" aria-labelledby="ktDoneT"><h2 id="ktDoneT">Alle Katzen sitzen!</h2>
      <p>Gelöst in <b class="mw-ans">${fmt(st.ms)}</b></p>
      ${st.counted === false && !st.v ? '<p class="hint">Zählt nicht für die Bestenliste: Unter diesem Namen steht heute schon ein Ergebnis, oder der Name ist zu allgemein. Trag rechts einen eigenen Namen ein – ab morgen zählt er.</p>' : ''}
      <div class="row"><button class="btn" type="button" data-kt="share">Ergebnis teilen</button><a class="btn ghost" href="#ktBoardSide">Bestenliste</a><a class="btn ghost" href="/mondwort/">Zum Mondwort</a></div>
      <p class="mw-next">Neues Rätsel in <b id="ktCount">–</b></p></div>`;
  }
  function tick() {
    clearInterval(tick.t);
    tick.t = setInterval(() => {
      const st = S.st; if (!st || st.error) return;
      if (Date.now() >= S.nextAt) { clearInterval(tick.t); load(); return; }
      const t = $('ktTime'); if (t && !st.done && S.t0) t.textContent = fmt(Date.now() - S.t0);
      const c = $('ktCount'); if (c) { const s = Math.floor((S.nextAt - Date.now()) / 1000); c.textContent = String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
    }, 1000);
  }

  // ---- Seitenleiste ---------------------------------------------------------------------------
  function renderSide() {
    const s = $('side'); if (!s) return;
    const st = S.st, stats = st && st.stats, verified = window.kbName && kbName.verified();
    s.innerHTML = `<div class="panel" id="ktBoardSide"><h3>Bestenliste <span>Katzenthron</span></h3>
      <div class="seg mw-tabs" role="tablist" aria-label="Zeitraum">${[['day', 'Heute'], ['month', 'Monat'], ['last', 'Vormonat']].map(([k, l]) => `<button type="button" role="tab" data-board="${k}" aria-selected="${S.board === k}" aria-pressed="${S.board === k}">${l}</button>`).join('')}</div>
      <div id="ktBoardBody" role="tabpanel">${boardHtml()}</div>
      <p class="hint mw-bhint">${S.board === 'day' ? 'Schnellste Zeit vom ersten Klick bis zur letzten Katze.' : 'Mehr gelöste Tage vor besserer Durchschnittszeit.'}</p>
      <div class="field mw-name"><span class="label">Dein Name in der Liste</span><div class="row" style="flex-wrap:nowrap"><input class="txt" id="ktName" value="${esc(myName())}" maxlength="24" autocomplete="off" ${verified ? 'disabled' : ''} aria-label="Dein Name"><button class="btn small ghost" type="button" data-kt="name" ${verified ? 'disabled' : ''}>Speichern</button></div>
      ${verified ? '<p class="hint">Mit Twitch angemeldet ✓</p>' : '<p class="hint">Zählt mit dem Namen, der beim Lösen eingetragen ist.</p>'}</div></div>
      <div class="panel"><h3>Deine Statistik</h3>${stats && stats.solved ? `<dl class="mw-stats"><div><dt>Gelöst</dt><dd>${stats.solved}</dd></div><div><dt>Serie</dt><dd>${stats.cur}</dd></div><div><dt>Bestzeit</dt><dd>${fmt(stats.bestMs)}</dd></div><div><dt>Schnitt</dt><dd>${fmt(stats.sumMs / stats.solved)}</dd></div></dl>` : '<p class="hint">Noch kein Rätsel gelöst.</p>'}</div>
      <div class="panel"><h3>So geht's</h3><ol class="rules">
        <li><span>Setze eine <b>Katze</b> in jede <b>Zeile</b>, jede <b>Spalte</b> und jede <b>Farbzone</b>.</span></li>
        <li><span>Katzen sind Einzelgänger: Keine zwei dürfen sich <b>berühren</b> – auch nicht schräg.</span></li>
        <li><span>Einmal tippen setzt ein <b>✕</b> (hier sicher keine Katze), zweimal eine <b>Katze</b>, dreimal leert das Feld. Über leere Felder ziehen setzt viele Kreuze auf einmal.</span></li>
        <li><span>Es gibt immer genau <b>eine</b> Lösung. Mo–Do 7×7, Fr–So 8×8. Neues Rätsel um <b>0:00 Uhr</b>.</span></li>
      </ol><p class="kbdhint">Tasten: Pfeile bewegen · Leertaste wechselt · K Katze · X Kreuz · Entf leert · Strg+Z rückgängig</p></div>`;
  }
  function boardHtml() {
    const d = S.boardData;
    if (!d) return '<p class="hint"><span class="dots">Lade</span></p>';
    if (!d.rows.length) return `<div class="empty">${d.kind === 'day' ? 'Heute hat noch niemand gelöst. Sei die erste Person!' : 'In diesem Monat noch keine Einträge.'}</div>`;
    const me = myName().toLowerCase(), vb = r => r.v ? ' <span class="vb" title="Mit Twitch bestätigt">✓</span>' : '';
    if (d.kind === 'day') return `<table class="mw-lb"><thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Zeit</th></tr></thead><tbody>${d.rows.map((r, i) => `<tr class="${r.name.toLowerCase() === me ? 'me' : ''}"><td>${i + 1}</td><td class="nm">${esc(r.name)}${vb(r)}</td><td>${fmt(r.ms)}</td></tr>`).join('')}</tbody></table>`;
    return `<table class="mw-lb"><thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Gelöst</th><th scope="col" title="Durchschnittszeit">Ø</th><th scope="col">Best</th><th scope="col">Serie</th></tr></thead><tbody>${d.rows.map((r, i) => `<tr class="${r.name.toLowerCase() === me ? 'me' : ''}"><td>${i + 1}</td><td class="nm">${esc(r.name)}${vb(r)}</td><td><b>${r.solved}</b></td><td>${fmt(r.avg)}</td><td>${fmt(r.best)}</td><td>${r.cur ? r.cur + '🔥' : '–'}</td></tr>`).join('')}</tbody></table>`;
  }
  async function loadBoard() {
    const st = S.st; if (!st || !st.date) return;
    const m = st.date.slice(0, 7); let q = 'd=' + st.date;
    if (S.board === 'month') q = 'm=' + m;
    if (S.board === 'last') { const [y, mo] = m.split('-').map(Number); q = 'm=' + (mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0')); }
    try { S.boardData = await (await fetch('/api/thron/board?' + q, { cache: 'no-store' })).json(); } catch (e) { S.boardData = { kind: 'day', rows: [] }; }
    const b = $('ktBoardBody'); if (b) b.innerHTML = boardHtml();
  }

  // ---- Spielen ------------------------------------------------------------------------------
  async function load() {
    const j = await api();
    if (j.error) { S.st = { error: j.error }; render(); return; }
    S.st = j; S.nextAt = Date.now() + j.next; S.undo = [];
    S.marks = new Array(j.n * j.n).fill(0);
    try { const saved = JSON.parse(localStorage.getItem('lz_kt_m') || 'null'); if (saved && saved.date === j.date && saved.m.length === j.n * j.n) S.marks = saved.m; } catch (e) {}
    if (j.done && !S.marks.some(v => v === 2) && window.KTCore) { const sol = KTCore.count(j.n, j.r, 1).sol; if (sol) sol.forEach((c, y) => { S.marks[y * j.n + c] = 2; }); }
    S.t0 = j.started && !j.done ? Date.now() - j.elapsed : 0;
    remember(); render(); renderSide(); loadBoard();
  }
  async function begin() {
    if (S.t0 || S.st.done) return;
    S.t0 = Date.now();
    const j = await api({ start: true, nr: S.st.nr }).catch(() => null);
    if (j && j.reload) { load(); return; }
    if (j && !j.error && j.elapsed) S.t0 = Date.now() - j.elapsed;
  }
  function setMark(i, v, silent) {
    if (!S.st || S.st.done || S.marks[i] === v) return;
    if (!silent) S.undo.push(S.marks.slice()); if (S.undo.length > 200) S.undo.shift();
    S.marks[i] = v; begin(); saveMarks();
  }
  async function afterChange(i) {
    S.focus = i; render(); focusCell();
    const v = S.marks[i];
    if (v === 2) { const a = analyse(); snd(a.bad.has(i) ? 'wrong' : 'pop'); say(cellLabel(i, a)); } else snd('blip');
    const cats = solvedNow();
    if (cats && !S.busy) {
      S.busy = true;
      const j = await api({ cats, nr: S.st.nr }).catch(() => ({ error: 'Keine Verbindung – versuch es gleich noch mal.' }));
      S.busy = false;
      if (j.reload) { load(); return; }
      if (j.error) { const el = $('ktMsg'); if (el) el.textContent = j.error; return; }
      S.st = j; remember(); render(); renderSide(); loadBoard();
      snd('fanfare'); say('Gelöst in ' + fmt(j.ms) + '!', true);
      setTimeout(() => { const b = document.querySelector('.mw-done .btn'); if (b) b.focus({ preventScroll: true }); }, 200);
    }
  }
  const focusCell = () => { const c = document.querySelector(`.kt-c[data-i="${S.focus}"]`); if (c) c.focus({ preventScroll: true }); };

  // Ziehen über das Feld setzt Kreuze
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const c = e.target.closest('.kt-c'); if (!c || !S.st || S.st.done) return;
    drag = { start: +c.dataset.i, moved: false, snap: S.marks.slice() };
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY), c = el && el.closest && el.closest('.kt-c'); if (!c) return;
    const i = +c.dataset.i;
    if (i !== drag.start && !drag.moved) { drag.moved = true; if (S.marks[drag.start] === 0) { S.undo.push(drag.snap); S.marks[drag.start] = 1; } }
    if (drag.moved && S.marks[i] === 0) { S.marks[i] = 1; begin(); saveMarks(); c.classList.add('x'); c.innerHTML = '<i class="kx" aria-hidden="true">✕</i>'; }
  });
  document.addEventListener('pointerup', () => { if (drag && drag.moved) { saveMarks(); render(); } setTimeout(() => { drag = null; }, 0); });

  document.addEventListener('click', e => {
    const c = e.target.closest('.kt-c');
    if (c) { if (drag && drag.moved) return; const i = +c.dataset.i; setMark(i, (S.marks[i] + 1) % 3); afterChange(i); return; }
    const bt = e.target.closest('[data-board]');
    if (bt) { S.board = bt.dataset.board; document.querySelectorAll('[data-board]').forEach(x => { const on = x === bt; x.setAttribute('aria-selected', on); x.setAttribute('aria-pressed', on); }); S.boardData = null; $('ktBoardBody').innerHTML = boardHtml(); loadBoard(); return; }
    const b = e.target.closest('[data-kt]'); if (!b || b.disabled) return;
    const a = b.dataset.kt;
    if (a === 'retry') load();
    else if (a === 'undo') { if (S.undo.length) { S.marks = S.undo.pop(); saveMarks(); render(); } }
    else if (a === 'clear') { if (S.marks.some(v => v)) { S.undo.push(S.marks.slice()); S.marks = S.marks.map(() => 0); saveMarks(); render(); say('Feld geleert.'); } }
    else if (a === 'auto') { S.auto = !S.auto; try { localStorage.setItem('lz_kt_auto', S.auto ? '1' : '0'); } catch (_) {} render(); }
    else if (a === 'share') share();
    else if (a === 'name') { const i = $('ktName'); if (i && window.kbName) { kbName.set(i.value); i.value = myName(); toast('Name gespeichert'); const bb = $('ktBoardBody'); if (bb) bb.innerHTML = boardHtml(); } }
  });
  document.addEventListener('keydown', e => {
    if (window.LZCozy ? LZCozy.isTyping(e) : /INPUT|TEXTAREA/.test(e.target.tagName)) { if (e.target.id === 'ktName' && e.key === 'Enter') document.querySelector('[data-kt="name"]').click(); return; }
    if (!S.st || S.st.error) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); document.querySelector('[data-kt="undo"]') && document.querySelector('[data-kt="undo"]').click(); return; }
    const cell = e.target.closest && e.target.closest('.kt-c'); if (!cell || S.st.done) return;
    const n = S.st.n, i = +cell.dataset.i, y = Math.floor(i / n), x = i % n, k = e.key;
    const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    if (mv) { e.preventDefault(); e.stopPropagation(); const ny = Math.max(0, Math.min(n - 1, y + mv[0])), nx = Math.max(0, Math.min(n - 1, x + mv[1])); S.focus = ny * n + nx;
      document.querySelectorAll('.kt-c').forEach(b => b.tabIndex = -1); const t = document.querySelector(`.kt-c[data-i="${S.focus}"]`); t.tabIndex = 0; t.focus(); return; }
    let v = null;
    if (k === ' ' || k === 'Enter') v = (S.marks[i] + 1) % 3; else if (k.toLowerCase() === 'k' || k.toLowerCase() === 'c') v = 2; else if (k.toLowerCase() === 'x') v = 1; else if (k === 'Delete' || k === 'Backspace') v = 0;
    if (v != null) { e.preventDefault(); setMark(i, v); afterChange(i); }
  }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.st && !S.st.error && Date.now() > S.nextAt) load(); });

  function share() {
    const st = S.st, t = `Katzenthron #${st.nr} 🐈👑 ${fmt(st.ms)} (${st.n}×${st.n})\n${location.origin}/katzenthron/`;
    (async () => {
      try { if (navigator.share && matchMedia('(hover:none)').matches) { await navigator.share({ text: t }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(t); toast('Ergebnis kopiert – ab in den Chat damit!'); } catch (e) { toast('Kopieren ging nicht.'); }
    })();
  }
  function toast(m) { const t = $('arToast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1900); say(m); }

  async function boot() {
    document.title = 'Katzenthron · Lunacynas Spielezimmer';
    if (window.LZSound) LZSound.mountToggle($('muteBtn'));
    $('btnBack').onclick = () => { location.href = '/'; };
    render(); renderSide();
    try { await window.kbAuthReady; } catch (e) {}
    load();
    setInterval(() => { if (!document.hidden && S.board === 'day') loadBoard(); }, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
