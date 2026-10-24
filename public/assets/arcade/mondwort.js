/* ==========================================================================
   Mondwort – das deutsche Wort des Tages (Browser-Teil)
   Die Lösung kennt nur der Server (/api/wort). Der Browser prüft nur, ob ein
   Wort im Wörterbuch steht (mondwort-words.js), schickt den Versuch und malt
   die Farben, die zurückkommen. Neues Wort jeden Tag um 0:00 Uhr deutscher Zeit.
   ========================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (t, a) => { if (window.LZCozy) LZCozy.announce(t, { assertive: !!a }); };
  const snd = n => { if (window.LZSound) LZSound.play(n); };
  const ROWS = [['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p', 'ü'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä'], ['enter', 'y', 'x', 'c', 'v', 'b', 'n', 'm', 'back']];
  const WORD = { 2: 'richtig', 1: 'kommt vor', 0: 'nicht drin' };
  const S = { st: null, cur: '', busy: false, board: 'day', boardData: null, nextAt: 0, reveal: -1 };
  let hc = false; try { hc = localStorage.getItem('lz_mw_hc') === '1'; } catch (e) {}

  function uid() { let u = null; try { u = localStorage.getItem('kb_uid'); } catch (e) {} if (!u || !/^u_[a-z0-9]{10}$/.test(u)) { u = 'u_' + Math.random().toString(36).slice(2, 12).padEnd(10, '0'); try { localStorage.setItem('kb_uid', u); } catch (e) {} } return u; }
  const myName = () => (window.kbName && kbName.get()) || '';

  async function api(body) {
    const opt = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ u: uid(), name: myName(), ...body }), credentials: 'same-origin' }
      : { credentials: 'same-origin', cache: 'no-store' };
    const r = await fetch(body ? '/api/wort' : '/api/wort?u=' + uid(), opt);
    const j = await r.json().catch(() => ({ error: 'Server antwortet nicht.' }));
    return j;
  }
  function remember() {               // kleiner Merkzettel für die Startseite
    const st = S.st; if (!st) return;
    try { localStorage.setItem('lz_mw', JSON.stringify({ nr: st.nr, date: st.date, done: st.done, won: st.won, n: st.guesses.length, streak: st.stats ? st.stats.cur : 0 })); } catch (e) {}
  }

  // ---- Darstellung -------------------------------------------------------------------------
  function keyState() {
    const k = {};
    (S.st ? S.st.guesses : []).forEach(g => [...g.w].forEach((ch, i) => { k[ch] = Math.max(k[ch] == null ? -1 : k[ch], g.p[i]); }));
    return k;
  }
  function dateLabel(d) { try { return new Date(d + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch (e) { return d; } }
  function rowHtml(i) {
    const st = S.st, g = st.guesses[i], active = !st.done && i === st.guesses.length;
    const letters = g ? [...g.w] : active ? [...S.cur] : [];
    const label = g ? `Versuch ${i + 1}: ${g.w.toUpperCase()} – ${[...g.w].map((c, j) => c.toUpperCase() + ' ' + WORD[g.p[j]]).join(', ')}` : active ? `Versuch ${i + 1}, aktuelle Eingabe: ${S.cur.toUpperCase() || 'leer'}` : `Versuch ${i + 1}, leer`;
    return `<div class="mw-row${active ? ' act' : ''}" role="img" aria-label="${esc(label)}" data-row="${i}">${[0, 1, 2, 3, 4].map(j => {
      const ch = letters[j] || '', cls = g ? ' s' + g.p[j] + (S.reveal === i ? ' flip' : '') : ch ? ' fill' : '';
      return `<span class="mw-t${cls}" style="--d:${j * 140}ms" aria-hidden="true">${esc(ch.toUpperCase())}</span>`;
    }).join('')}</div>`;
  }
  function render() {
    const m = $('main'); if (!m) return;
    const st = S.st;
    if (!st) { m.innerHTML = `<div class="panel sheet"><h2>Mondwort</h2><p><span class="dots">Das Wort des Tages wird geholt</span></p></div>`; return; }
    if (st.error) { m.innerHTML = `<div class="panel sheet"><h2>Mondwort</h2><p>${esc(st.error)}</p><div class="row"><button class="btn" type="button" data-mw="retry">Nochmal versuchen</button></div></div>`; return; }
    const ks = keyState();
    m.innerHTML = `<div class="mw${hc ? ' hc' : ''}">
      <div class="ar-bar"><div class="ar-status">Mondwort <em>#${st.nr}</em> <span class="mw-date">· ${esc(dateLabel(st.date))}</span></div>
        <div class="row"><button class="btn small ghost" type="button" data-mw="hc" aria-pressed="${hc}" title="Farben mit stärkerem Kontrast (Orange/Blau)">Kontrast</button></div></div>
      <div class="mw-grid" role="group" aria-label="Spielfeld, 6 Versuche">${[0, 1, 2, 3, 4, 5].map(rowHtml).join('')}</div>
      <p class="mw-msg" id="mwMsg" role="status"></p>
      ${st.done ? doneHtml() : `<div class="mw-kb" role="group" aria-label="Tastatur">${ROWS.map(r => `<div class="mw-kr">${r.map(k => {
        if (k === 'enter') return '<button type="button" class="mw-k wide" data-k="enter">Raten</button>';
        if (k === 'back') return '<button type="button" class="mw-k wide" data-k="back" aria-label="Löschen">⌫</button>';
        const s = ks[k]; return `<button type="button" class="mw-k${s != null ? ' s' + s : ''}" data-k="${k}" aria-label="${k.toUpperCase()}${s != null ? ', ' + WORD[s] : ''}">${k.toUpperCase()}</button>`;
      }).join('')}</div>`).join('')}</div>`}
    </div>`;
    if (S.reveal >= 0) setTimeout(() => { S.reveal = -1; }, 900);
    tickCountdown();
  }
  function doneHtml() {
    const st = S.st, n = st.guesses.length;
    const head = st.won ? ['Gelöst in ' + n + ' von 6!', ['Unglaublich!', 'Grandios!', 'Stark!', 'Sehr schön!', 'Geschafft!', 'Puh, knapp!'][n - 1]] : ['Diesmal nicht', 'Morgen klappt es bestimmt.'];
    const time = st.ms != null ? fmtMs(st.ms) : '';
    return `<div class="panel mw-done" role="region" aria-labelledby="mwDoneT">
      <h2 id="mwDoneT">${esc(head[0])}</h2>
      <p>${st.won ? esc(head[1]) + (time ? ' · ' + time : '') : 'Das Wort war'} ${st.won ? '' : `<b class="mw-ans">${esc((st.answer || '').toUpperCase())}</b>`}</p>
      ${st.won ? `<p class="hint">Das Wort: <b class="mw-ans small">${esc((st.answer || '').toUpperCase())}</b></p>` : ''}
      ${st.counted === false && !st.v ? '<p class="hint">Zählt nicht für die Bestenliste: Unter diesem Namen steht heute schon ein Ergebnis, oder der Name ist zu allgemein („Spieler 2“ & Co.). Trag rechts einen eigenen Namen ein – ab morgen zählt er.</p>' : ''}
      <div class="row"><button class="btn" type="button" data-mw="share">Ergebnis teilen</button><a class="btn ghost" href="#mwBoard">Bestenliste</a><a class="btn ghost" href="/katzenthron/">Zum Katzenthron</a></div>
      <p class="mw-next">Neues Mondwort in <b id="mwCount">–</b></p></div>`;
  }
  const fmtMs = ms => { const s = Math.round(ms / 1000); return s < 3600 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' Min.' : Math.floor(s / 3600) + ' Std. ' + Math.floor(s % 3600 / 60) + ' Min.'; };
  function msg(t, bad) {
    const el = $('mwMsg'); if (el) { el.textContent = t; el.classList.toggle('bad', !!bad); clearTimeout(msg.t); msg.t = setTimeout(() => { if (el.textContent === t) el.textContent = ''; }, 2600); }
    if (bad) { const r = document.querySelector('.mw-row.act'); if (r) { r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake'); } }
  }
  function updateActiveRow() {
    const st = S.st; if (!st || st.done) return;
    const i = st.guesses.length, r = document.querySelector(`.mw-row[data-row="${i}"]`); if (!r) return;
    r.outerHTML = rowHtml(i);
  }
  function tickCountdown() {
    clearInterval(tickCountdown.t);
    const el = () => $('mwCount');
    const step = () => {
      const left = S.nextAt - Date.now();
      if (left <= 0) { clearInterval(tickCountdown.t); load(); return; }
      const e = el(); if (!e) return;
      const s = Math.floor(left / 1000);
      e.textContent = String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    };
    step(); tickCountdown.t = setInterval(step, 1000);
  }

  // ---- Seitenleiste: Name, Bestenliste, Statistik, Regeln -------------------------------------
  function renderSide() {
    const s = $('side'); if (!s) return;
    const st = S.st, stats = st && st.stats, verified = window.kbName && kbName.verified();
    const dist = stats ? stats.dist : [0, 0, 0, 0, 0, 0], maxD = Math.max(1, ...dist);
    s.innerHTML = `<div class="panel" id="mwBoard"><h3>Bestenliste <span>Mondwort</span></h3>
      <div class="seg mw-tabs" role="tablist" aria-label="Zeitraum">
        <button type="button" role="tab" data-board="day" aria-selected="${S.board === 'day'}" aria-pressed="${S.board === 'day'}">Heute</button>
        <button type="button" role="tab" data-board="month" aria-selected="${S.board === 'month'}" aria-pressed="${S.board === 'month'}">Monat</button>
        <button type="button" role="tab" data-board="last" aria-selected="${S.board === 'last'}" aria-pressed="${S.board === 'last'}">Vormonat</button></div>
      <div id="mwBoardBody" role="tabpanel">${boardHtml()}</div>
      <p class="hint mw-bhint">${S.board === 'day' ? 'Weniger Versuche vor schnellerer Zeit.' : 'Punkte pro Tag: 6 für einen Versuch … 1 für sechs Versuche. Gleichstand: mehr gelöst, dann weniger Versuche im Schnitt.'}</p>
      <div class="field mw-name"><span class="label">Dein Name in der Liste</span><div class="row" style="flex-wrap:nowrap"><input class="txt" id="mwName" value="${esc(myName())}" maxlength="24" autocomplete="off" ${verified ? 'disabled' : ''} aria-label="Dein Name"><button class="btn small ghost" type="button" data-mw="name" ${verified ? 'disabled' : ''}>Speichern</button></div>
      ${verified ? '<p class="hint">Mit Twitch angemeldet ✓</p>' : '<p class="hint">Zählt mit dem Namen, der beim letzten Versuch eingetragen ist. Mit Twitch-Login bekommst du ein ✓.</p>'}</div></div>
      <div class="panel"><h3>Deine Statistik</h3>${stats ? `<dl class="mw-stats"><div><dt>Gespielt</dt><dd>${stats.played}</dd></div><div><dt>Gelöst</dt><dd>${stats.played ? Math.round(stats.wins / stats.played * 100) : 0}&nbsp;%</dd></div><div><dt>Serie</dt><dd>${stats.cur}</dd></div><div><dt>Beste Serie</dt><dd>${stats.best}</dd></div></dl>
        <div class="mw-dist" aria-label="Verteilung der Versuche">${dist.map((n, i) => `<div class="mw-dr"><span>${i + 1}</span><i style="--w:${Math.max(6, n / maxD * 100)}%" class="${st.won && st.guesses.length === i + 1 ? 'me' : ''}"><b>${n}</b></i></div>`).join('')}</div>` : '<p class="hint">Noch keine Runde gespielt.</p>'}</div>
      <div class="panel"><h3>So geht's</h3><ol class="rules">
        <li><span>Errate das Wort des Tages mit <b>fünf Buchstaben</b> in höchstens <b>sechs Versuchen</b>. Jeder Versuch muss ein echtes Wort sein.</span></li>
        <li><span><b class="mw-lg s2">Grün</b> – Buchstabe stimmt und steht richtig. <b class="mw-lg s1">Gelb</b> – kommt vor, aber woanders. <b class="mw-lg s0">Grau</b> – kommt nicht vor.</span></li>
        <li><span>Ä, Ö und Ü sind eigene Buchstaben, ß gibt es nicht. Um <b>0:00 Uhr</b> kommt ein neues Wort – für alle dasselbe.</span></li>
      </ol><p class="kbdhint">Tippen mit der Tastatur · Enter rät · Rücktaste löscht</p></div>`;
  }
  function boardHtml() {
    const d = S.boardData;
    if (!d) return '<p class="hint"><span class="dots">Lade</span></p>';
    if (!d.rows.length) return `<div class="empty">${d.kind === 'day' ? 'Heute hat noch niemand gelöst. Sei die erste Person!' : 'In diesem Monat noch keine Einträge.'}</div>`;
    const me = myName().toLowerCase();
    if (d.kind === 'day') return `<table class="mw-lb"><thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Versuche</th><th scope="col">Zeit</th></tr></thead><tbody>${d.rows.map((r, i) =>
      `<tr class="${r.name.toLowerCase() === me ? 'me' : ''}"><td>${r.won ? i + 1 : '–'}</td><td class="nm">${esc(r.name)}${r.v ? ' <span class="vb" title="Mit Twitch bestätigt">✓</span>' : ''}</td><td>${r.won ? r.n + '/6' : '✗'}</td><td>${r.won ? fmtMs(r.ms).replace(' Min.', '') : ''}</td></tr>`).join('')}</tbody></table>`;
    return `<table class="mw-lb"><thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col" title="Punkte">Pkt.</th><th scope="col" title="gelöst von gespielt">Gelöst</th><th scope="col" title="Versuche im Schnitt">Ø</th><th scope="col" title="aktuelle Serie">Serie</th></tr></thead><tbody>${d.rows.map((r, i) =>
      `<tr class="${r.name.toLowerCase() === me ? 'me' : ''}"><td>${i + 1}</td><td class="nm">${esc(r.name)}${r.v ? ' <span class="vb" title="Mit Twitch bestätigt">✓</span>' : ''}</td><td><b>${r.p}</b></td><td>${r.won}/${r.played}</td><td>${r.avg == null ? '–' : String(r.avg).replace('.', ',')}</td><td>${r.cur ? r.cur + '🔥' : '–'}</td></tr>`).join('')}</tbody></table>`;
  }
  async function loadBoard() {
    const st = S.st; if (!st || !st.date) return;
    const m = st.date.slice(0, 7);
    let q = 'd=' + st.date;
    if (S.board === 'month') q = 'm=' + m;
    if (S.board === 'last') { const [y, mo] = m.split('-').map(Number); q = 'm=' + (mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0')); }
    try { S.boardData = await (await fetch('/api/wort/board?' + q, { cache: 'no-store' })).json(); } catch (e) { S.boardData = { kind: 'day', rows: [] }; }
    const b = $('mwBoardBody'); if (b) b.innerHTML = boardHtml();
  }

  // ---- Spielen -------------------------------------------------------------------------------
  async function load() {
    const j = await api();
    if (j.error) { S.st = { error: j.error }; render(); return; }
    S.st = j; S.cur = ''; S.nextAt = Date.now() + j.next;
    remember(); render(); renderSide(); loadBoard();
  }
  function type(k) {
    const st = S.st; if (!st || st.error || st.done || S.busy) return;
    if (k === 'enter') return submit();
    if (k === 'back') { S.cur = S.cur.slice(0, -1); updateActiveRow(); return; }
    if (/^[a-zäöü]$/.test(k) && S.cur.length < 5) { S.cur += k; updateActiveRow(); snd('blip'); }
  }
  async function submit() {
    const st = S.st, w = S.cur;
    if (w.length < 5) { msg('Zu kurz – es braucht fünf Buchstaben.', true); say('Zu kurz.'); snd('wrong'); return; }
    if (window.MW_ALLOWED && !MW_ALLOWED.has(w)) { msg(`„${w.toUpperCase()}“ steht nicht im Wörterbuch.`, true); say(w.toUpperCase() + ' steht nicht im Wörterbuch.'); snd('wrong'); return; }
    S.busy = true;
    const j = await api({ guess: w, nr: st.nr }).catch(() => ({ error: 'Keine Verbindung.' }));
    S.busy = false;
    if (j.reload) { msg(j.error); setTimeout(load, 1200); return; }
    if (j.error) { msg(j.error, true); snd('wrong'); return; }
    S.st = j; S.cur = ''; S.reveal = j.guesses.length - 1; S.nextAt = Date.now() + j.next;
    remember(); render();
    const g = j.guesses[S.reveal];
    say(`Versuch ${S.reveal + 1}: ${[...g.w].map((c, i) => c.toUpperCase() + ' ' + WORD[g.p[i]]).join(', ')}.` + (j.done ? (j.won ? ' Gelöst!' : ' Das Wort war ' + (j.answer || '').toUpperCase() + '.') : ''), true);
    snd(j.done ? (j.won ? 'fanfare' : 'lose') : g.p.every(x => x === 2) ? 'fanfare' : g.p.some(x => x === 2) ? 'correct' : 'pop');
    if (j.done) { renderSide(); setTimeout(loadBoard, 300); setTimeout(() => { const b = document.querySelector('.mw-done .btn'); if (b) b.focus({ preventScroll: true }); }, 900); }
  }
  function shareText() {
    const st = S.st, sq = hc ? ['⬛', '🟦', '🟧'] : ['⬛', '🟨', '🟩'];
    return `Mondwort #${st.nr} ${st.won ? st.guesses.length : 'X'}/6 🌙\n` + st.guesses.map(g => g.p.map(x => sq[x]).join('')).join('\n') + '\n' + location.origin + '/mondwort/';
  }
  async function share() {
    const t = shareText();
    try { if (navigator.share && matchMedia('(hover:none)').matches) { await navigator.share({ text: t }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(t); toast('Ergebnis kopiert – ab in den Chat damit!'); } catch (e) { toast('Kopieren ging nicht.'); }
  }
  function toast(m) { const t = $('arToast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1900); say(m); }

  document.addEventListener('click', e => {
    const k = e.target.closest('[data-k]'); if (k) { type(k.dataset.k); return; }
    const bt = e.target.closest('[data-board]');
    if (bt) { S.board = bt.dataset.board; document.querySelectorAll('[data-board]').forEach(x => { const on = x === bt; x.setAttribute('aria-selected', on); x.setAttribute('aria-pressed', on); }); S.boardData = null; $('mwBoardBody').innerHTML = boardHtml(); loadBoard(); return; }
    const b = e.target.closest('[data-mw]'); if (!b || b.disabled) return;
    const a = b.dataset.mw;
    if (a === 'retry') load();
    else if (a === 'share') share();
    else if (a === 'hc') { hc = !hc; try { localStorage.setItem('lz_mw_hc', hc ? '1' : '0'); } catch (_) {} render(); }
    else if (a === 'name') { const i = $('mwName'); if (i && window.kbName) { kbName.set(i.value); i.value = myName(); toast('Name gespeichert'); const bb = $('mwBoardBody'); if (bb) bb.innerHTML = boardHtml(); } }
  });
  // Bildschirm-Tasten nehmen keinen Fokus: sonst würde Enter die zuletzt geklickte Taste noch einmal drücken
  document.addEventListener('mousedown', e => { if (e.target.closest('[data-k]')) e.preventDefault(); });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (window.LZCozy ? LZCozy.isTyping(e) : /INPUT|TEXTAREA/.test(e.target.tagName)) { if (e.target.id === 'mwName' && e.key === 'Enter') document.querySelector('[data-mw="name"]').click(); return; }
    if (document.querySelector('dialog[open]')) return;
    const k = e.key;
    if (k === 'Enter') { if (e.target.closest && e.target.closest('button,a')) return; e.preventDefault(); type('enter'); }
    else if (k === 'Backspace') { e.preventDefault(); type('back'); }
    else if (k.length === 1 && /^[a-zA-ZäöüÄÖÜ]$/.test(k)) type(k.toLowerCase());
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.st && !S.st.error && Date.now() > S.nextAt) load(); if (!document.hidden && S.st && S.st.date) loadBoard(); });

  async function boot() {
    document.title = 'Mondwort · Lunacynas Spielezimmer';
    if (window.LZSound) LZSound.mountToggle($('muteBtn'));
    $('btnBack').onclick = () => { location.href = '/'; };
    render(); renderSide();
    try { await window.kbAuthReady; } catch (e) {}
    load();
    setInterval(() => { if (!document.hidden && S.board === 'day') loadBoard(); }, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
