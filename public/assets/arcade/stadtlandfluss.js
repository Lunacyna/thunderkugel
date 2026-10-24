/* ==========================================================================
   Stadt, Land, Fluss – Blitz-Variante – Lunacynas Spielezimmer
   Datenstruktur:
     letter, round/rounds, phase: 'write' | 'pass' (Gerät weitergeben) | 'review' | 'end'
     ans:   [{0:'',1:'',2:'',3:''}, {…}]   Antworten je Sitz (online verdeckt)
     deadline, buzz (wer gebuzzert hat), res (Punkte der Runde), total
   Ablauf:
     Solo   – 45 s Zeit, dann Auswertung.
     Bot / online – beide tippen gleichzeitig; wer alle 4 Felder hat, buzzert:
              der Gegner hat noch 10 s. 3 Runden.
     Zu zweit hier – erst Spieler 1 (45 s), Gerät weitergeben, dann Spieler 2.
   Punkte: Begriff aus der Liste 10, unbekannter (aber passender) Begriff 5;
           allein in der Kategorie ×2, gleiche Antwort ÷2.
   Bot: kennt Begriffe aus der eingebauten Wortliste mit Wahrscheinlichkeit
        je Stufe, überlegt pro Feld eine Weile und "tippt" Buchstabe für Buchstabe.
   ========================================================================== */
(function () {
  'use strict';
  const CATS = ['Stadt', 'Land', 'Tier', 'Beruf'];
  const SOLO_MS = 45000, HOT_MS = 45000, DUO_MS = 90000, BUZZ_MS = 10000, ROUNDS = 3;
  // Wortliste (Bot + Prüfung). Je Buchstabe: Stadt | Land | Tier | Beruf
  const W = {
    A: ['Aachen,Augsburg,Amsterdam,Athen,Ankara,Antwerpen,Aalen,Arnsberg,Alicante,Algier,Aschaffenburg', 'Ägypten,Albanien,Algerien,Argentinien,Australien,Armenien,Angola,Andorra,Afghanistan,Aserbaidschan,Äthiopien', 'Affe,Adler,Ameise,Alpaka,Antilope,Aal,Amsel,Assel,Axolotl,Ameisenbär,Alligator', 'Arzt,Apotheker,Architekt,Anwalt,Astronaut,Altenpfleger,Augenoptiker,Autor,Archäologe,Animateur'],
    B: ['Berlin,Bremen,Bonn,Bochum,Bielefeld,Braunschweig,Barcelona,Brüssel,Bern,Budapest,Bamberg,Basel', 'Belgien,Brasilien,Bulgarien,Bolivien,Bangladesch,Belarus,Bhutan,Bosnien,Botswana,Burkina Faso', 'Bär,Biene,Biber,Bison,Büffel,Barsch,Bussard,Blaumeise,Buntspecht,Bachstelze,Blauwal', 'Bäcker,Bauer,Bankkaufmann,Busfahrer,Bibliothekar,Bauarbeiter,Bildhauer,Bestatter,Briefträger,Biologe'],
    D: ['Dresden,Düsseldorf,Dortmund,Duisburg,Darmstadt,Dublin,Danzig,Dessau,Delhi,Detroit', 'Deutschland,Dänemark,Dominikanische Republik,Dschibuti,Dominica', 'Dachs,Delfin,Dohle,Dromedar,Drossel,Dingo,Dorsch,Damhirsch,Dackel', 'Dachdecker,Detektiv,Dirigent,Dolmetscher,Drogist,Designer,Dozent,Drucker,Dramaturg'],
    E: ['Essen,Erfurt,Erlangen,Emden,Esslingen,Edinburgh,Eindhoven,Eisenach,Erding', 'Estland,England,Ecuador,Eritrea,El Salvador,Elfenbeinküste', 'Elefant,Esel,Eule,Eichhörnchen,Ente,Elch,Emu,Eidechse,Erdmännchen,Eisbär', 'Elektriker,Erzieher,Ergotherapeut,Entwickler,Eventmanager,Einzelhändler'],
    F: ['Frankfurt,Freiburg,Fulda,Flensburg,Fürth,Florenz,Frankenthal,Friedrichshafen,Freising', 'Frankreich,Finnland,Fidschi', 'Fuchs,Frosch,Falke,Flamingo,Fledermaus,Forelle,Fasan,Fink,Faultier,Flusspferd', 'Friseur,Fotograf,Feuerwehrmann,Fleischer,Fliesenleger,Förster,Fluglotse,Fahrlehrer,Florist'],
    G: ['Göttingen,Gelsenkirchen,Gießen,Görlitz,Gera,Genf,Graz,Glasgow,Gotha,Göteborg', 'Griechenland,Georgien,Ghana,Guatemala,Gabun,Gambia,Guinea,Grenada,Guyana', 'Giraffe,Gans,Gorilla,Gepard,Goldfisch,Gazelle,Grille,Geier,Gämse,Gürteltier', 'Gärtner,Goldschmied,Grafiker,Gastwirt,Geologe,Glaser,Gerichtsvollzieher,Gamedesigner'],
    H: ['Hamburg,Hannover,Heidelberg,Halle,Hagen,Hamm,Helsinki,Hildesheim,Heilbronn,Havanna', 'Haiti,Honduras,Holland', 'Hund,Hase,Hamster,Hai,Hirsch,Huhn,Hummel,Hering,Hyäne,Hummer,Habicht', 'Hebamme,Hausmeister,Hotelfachmann,Historiker,Heilpraktiker,Hufschmied,Hörgeräteakustiker'],
    I: ['Ingolstadt,Innsbruck,Istanbul,Iserlohn,Itzehoe,Ilmenau,Islamabad', 'Italien,Indien,Irland,Island,Indonesien,Iran,Irak,Israel', 'Igel,Iltis,Impala,Ibis,Irbis', 'Ingenieur,Informatiker,Imker,Installateur,Innenarchitekt,Illustrator,Industriemechaniker'],
    K: ['Köln,Kiel,Kassel,Karlsruhe,Koblenz,Konstanz,Kopenhagen,Krakau,Kairo,Kempten', 'Kanada,Kroatien,Kenia,Kolumbien,Kuba,Kamerun,Kambodscha,Kasachstan,Katar,Kosovo,Kirgisistan', 'Katze,Kuh,Känguru,Koala,Krokodil,Kamel,Käfer,Kranich,Krake,Kolibri,Kröte', 'Koch,Klempner,Krankenpfleger,Kellner,Kassierer,Konditor,Kfz-Mechaniker,Kameramann,Kapitän,Künstler'],
    L: ['Leipzig,Lübeck,Ludwigshafen,Lüneburg,Leverkusen,London,Lissabon,Lyon,Luzern,Linz', 'Lettland,Litauen,Luxemburg,Libanon,Libyen,Liechtenstein,Laos,Liberia', 'Löwe,Luchs,Lama,Leopard,Libelle,Lachs,Lerche,Lemming,Leguan,Laubfrosch', 'Lehrer,Lokführer,Landwirt,Logopäde,Lackierer,Lektor,Lagerist,Laborant'],
    M: ['München,Mainz,Mannheim,Magdeburg,Münster,Mailand,Madrid,Marseille,Moskau,Marburg', 'Mexiko,Marokko,Malta,Mongolei,Monaco,Mali,Madagaskar,Malaysia,Moldau,Montenegro', 'Maus,Murmeltier,Marder,Möwe,Maulwurf,Meise,Molch,Marienkäfer,Mücke,Mantarochen', 'Maler,Maurer,Mechatroniker,Metzger,Musiker,Mediengestalter,Moderator,Meteorologe,Müller'],
    N: ['Nürnberg,Neuss,Nizza,Neapel,New York,Nairobi,Naumburg,Nordhausen,Neubrandenburg', 'Norwegen,Niederlande,Neuseeland,Nepal,Nigeria,Nicaragua,Niger,Namibia,Nordkorea', 'Nashorn,Nilpferd,Nachtigall,Nandu,Nerz,Natter,Nacktschnecke,Narwal', 'Notar,Nachtwächter,Näher,Neurologe,Notfallsanitäter'],
    O: ['Oldenburg,Osnabrück,Offenbach,Oberhausen,Oslo,Oxford,Odessa,Ottawa,Offenburg', 'Österreich,Oman', 'Otter,Ochse,Orca,Orang-Utan,Ozelot,Okapi,Oktopus,Opossum', 'Optiker,Orthopäde,Organist,Ofenbauer,Oberarzt'],
    P: ['Paris,Potsdam,Passau,Paderborn,Pforzheim,Prag,Palermo,Porto,Peking,Pisa', 'Polen,Portugal,Peru,Pakistan,Panama,Paraguay,Philippinen', 'Pferd,Pinguin,Papagei,Panda,Pfau,Puma,Pelikan,Pavian,Python,Piranha', 'Polizist,Pilot,Pfarrer,Physiotherapeut,Programmierer,Psychologe,Postbote,Professor,Parkettleger'],
    R: ['Rostock,Regensburg,Rom,Rotterdam,Riga,Reutlingen,Remscheid,Rosenheim,Rio de Janeiro', 'Russland,Rumänien,Ruanda', 'Rabe,Reh,Ratte,Robbe,Rentier,Rotkehlchen,Rochen,Regenwurm,Raupe,Rind', 'Richter,Reporter,Rettungssanitäter,Raumausstatter,Rechtsanwalt,Reiseleiter,Restaurator'],
    S: ['Stuttgart,Saarbrücken,Schwerin,Siegen,Solingen,Salzburg,Stockholm,Sevilla,Sydney,Sofia', 'Spanien,Schweden,Schweiz,Slowakei,Slowenien,Serbien,Syrien,Somalia,Sudan,Senegal,Singapur', 'Schaf,Schwein,Schlange,Schildkröte,Storch,Spinne,Schwan,Seehund,Specht,Strauß,Salamander', 'Schreiner,Schlosser,Schneider,Sekretär,Steuerberater,Sozialarbeiter,Schauspieler,Sänger,Sanitäter,Schornsteinfeger'],
    T: ['Trier,Tübingen,Tokio,Toronto,Turin,Tallinn,Tunis,Teheran,Torgau', 'Türkei,Tschechien,Thailand,Tunesien,Tansania,Togo,Taiwan,Tadschikistan', 'Tiger,Taube,Truthahn,Tintenfisch,Tapir,Thunfisch,Tukan,Termite,Tarantel', 'Tischler,Tierarzt,Taxifahrer,Tänzer,Tontechniker,Tätowierer,Tankwart,Trainer'],
    U: ['Ulm,Uelzen,Utrecht,Udine,Ulan-Bator', 'Ungarn,Ukraine,Uruguay,Usbekistan,Uganda', 'Uhu,Unke,Uferschwalbe,Uakari', 'Uhrmacher,Unternehmer,Übersetzer,Urologe,Umweltberater'],
    W: ['Wien,Würzburg,Wiesbaden,Wuppertal,Weimar,Wolfsburg,Warschau,Washington,Wismar', 'Weißrussland,Wales', 'Wolf,Wal,Wespe,Waschbär,Wiesel,Wildschwein,Wellensittich,Walross,Wachtel', 'Winzer,Wirt,Webdesigner,Wissenschaftler,Werkzeugmacher,Wachmann'],
    Z: ['Zürich,Zwickau,Zagreb,Zittau,Zweibrücken', 'Zypern,Zentralafrikanische Republik', 'Zebra,Ziege,Zander,Zecke,Zaunkönig,Zitronenfalter', 'Zahnarzt,Zimmermann,Zollbeamter,Zahntechniker,Zauberer']
  };
  const LETTERS = Object.keys(W);
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
  const LIST = {}; for (const L of LETTERS) LIST[L] = W[L].map(x => new Set(x.split(',').map(norm)));
  const words = (L, c) => W[L][c].split(',');
  function judge(t, L, c) {
    const n = norm(t); if (n.length < 2 || n[0] !== norm(L)) return 0;        // falscher Anfangsbuchstabe
    const set = LIST[L][c];
    if (set.has(n) || (c === 3 && n.endsWith('in') && set.has(n.slice(0, -2))) || (c === 3 && n.endsWith('frau') && set.has(n.slice(0, -4) + 'mann'))) return 10;
    return 5;                                                                       // passt, steht aber nicht in der Liste
  }
  function score(s) {
    const seats = s.solo ? 1 : 2, res = [[], []];
    for (let c = 0; c < 4; c++) for (let p = 0; p < seats; p++) {
      const t = (s.ans[p][c] || '').trim(), base = judge(t, s.letter, c);
      let pts = base, note = base === 10 ? 'ok' : base === 5 ? 'neu' : (t ? 'falsch' : 'leer');
      if (base && !s.solo) {
        const o = (s.ans[1 - p][c] || '').trim(), ob = judge(o, s.letter, c);
        if (!ob) { pts = base * 2; note += ' allein'; } else if (norm(o) === norm(t)) { pts = base / 2; note += ' gleich'; }
      }
      res[p].push({ t, pts, note });
    }
    return res;
  }
  const blank = () => ({ 0: '', 1: '', 2: '', 3: '' });
  function newRound(s, now, rnd) {
    const free = LETTERS.filter(l => !s.used.includes(l)), letter = free[Math.floor((rnd || Math.random)() * free.length)];
    const ms = s.solo ? SOLO_MS : s.hot ? HOT_MS : DUO_MS;
    return { ...s, letter, used: s.used.concat(letter), round: s.round + 1, phase: 'write', ans: [blank(), blank()], writer: 0, deadline: now + ms, startAt: now, buzz: -1, res: null };
  }
  function toReview(s) { const res = score(s), total = s.total.slice(); res.forEach((r, p) => total[p] += r.reduce((a, x) => a + x.pts, 0)); return { ...s, phase: 'review', res, total, deadline: 0 }; }
  const filledAll = a => [0, 1, 2, 3].every(c => (a[c] || '').trim().length >= 2);

  const logic = {
    hide: ['ans'],
    init(cfg, rnd) {
      const s = { mode: cfg.mode, solo: cfg.mode === 'solo', hot: cfg.mode === 'local', round: 0, rounds: cfg.mode === 'solo' ? 1 : ROUNDS, used: [], total: [0, 0], hist: [] };
      return newRound(s, Date.now(), rnd);
    },
    act(s, seat, type, arg, now) {
      if (type === 'type') {
        if (s.phase !== 'write' || (s.hot ? seat !== s.writer : false) || (s.solo && seat !== 0)) return null;
        const c = arg && arg.c | 0, t = String(arg && arg.t || '').slice(0, 30);
        if (c < 0 || c > 3 || s.ans[seat][c] === t) return null;
        const ans = s.ans.slice(); ans[seat] = { ...ans[seat], [c]: t };
        return { ...s, ans };
      }
      if (type === 'buzz') {
        if (s.phase !== 'write') return null;
        if (s.solo || s.hot) { if (s.hot && seat !== s.writer) return null; return { ...s, deadline: now, buzz: seat }; }   // "Fertig"
        if (s.buzz >= 0 || !filledAll(s.ans[seat])) return null;
        return { ...s, buzz: seat, deadline: Math.min(s.deadline, now + BUZZ_MS) };
      }
      if (type === 'ready') { if (s.phase !== 'pass') return null; return { ...s, phase: 'write', writer: 1, deadline: now + HOT_MS, startAt: now, buzz: -1 }; }
      if (type === 'next') {
        if (s.phase !== 'review' || s.solo) return null;
        if (s.mode === 'online' && seat !== 0) return null;          // online entscheidet die Spielleitung
        const hist = s.hist.concat({ letter: s.letter, res: s.res });
        if (s.round >= s.rounds) return { ...s, phase: 'end', hist };
        return newRound({ ...s, hist }, now);
      }
      return null;
    },
    tick(s, dt, now) {
      if (s.phase !== 'write' || now < s.deadline) return null;
      if (s.hot && s.writer === 0) return { ...s, phase: 'pass', deadline: 0 };
      return toReview(s);
    },
    // Rundenbasiert ist hier nur das Weitergeben am selben Gerät
    turn: s => s.hot && s.phase === 'write' ? s.writer : (s.phase === 'pass' ? 1 : -1),
    over(s) {
      if (s.solo && s.phase === 'review') { const p = s.total[0]; return { title: p >= 30 ? 'Stark!' : 'Zeit um!', text: `<b>${p}</b> Punkte mit „${s.letter}“.`, best: { key: 'solo', value: p, fmt: v => v + ' Punkte' } }; }
      if (s.phase !== 'end') return null;
      const [a, b] = s.total;
      return a === b ? { winner: -1, title: 'Unentschieden', text: `${a} : ${b} Punkte` } : { winner: a > b ? 0 : 1, text: `${a} : ${b} Punkte nach ${s.rounds} Runden` };
    }
  };

  // ---- Bot: Wortliste, Bedenkzeit, Tippen ----
  const KNOW = { 1: 0.55, 2: 0.75, 3: 0.92 }, THINK = { 1: [6, 13], 2: [4, 9], 3: [2.5, 6] }, CPS = { 1: 5, 2: 7, 3: 9 };
  const bot = {
    control(s, seat, level, mem, dt, now) {
      if (s.phase !== 'write' || s.hot) return [];
      if (mem.round !== s.round) {          // Plan für die Runde
        mem.round = s.round; mem.plan = []; let t = s.startAt;
        for (let c = 0; c < 4; c++) {
          const list = words(s.letter, c), known = list.length && Math.random() < KNOW[level];
          const [a, b] = THINK[level]; t += (a + Math.random() * (b - a)) * 1000;
          const w = known ? list[Math.floor(Math.random() * list.length)] : '';
          mem.plan.push({ c, w, start: t, end: t + w.length / CPS[level] * 1000 }); t += w.length / CPS[level] * 1000;
        }
        mem.buzzAt = mem.plan.every(p => p.w) ? t + 400 + Math.random() * 600 : Infinity;
        mem.sent = {};
      }
      const out = [];
      for (const p of mem.plan) {
        if (!p.w || now < p.start) continue;
        const n = Math.min(p.w.length, Math.ceil((now - p.start) / (p.end - p.start) * p.w.length));
        const txt = p.w.slice(0, n);
        if (mem.sent[p.c] !== txt) { mem.sent[p.c] = txt; out.push(['type', { c: p.c, t: txt }]); }
      }
      if (now >= mem.buzzAt && s.buzz < 0) { mem.buzzAt = Infinity; out.push(['buzz']); }
      return out;
    }
  };

  // ---- View ----
  let el, seen = {};
  const esc = t => LZArcade.esc(t);
  function myFieldsSeat(s, ctx) { if (s.hot) return s.writer; return ctx.mode === 'online' ? ctx.me : 0; }
  const view = {
    mount(root, ctx) {
      el = root; seen = {};
      root.innerHTML = '<div class="sl-wrap" id="slBox"></div>';
      root.addEventListener('input', e => { const f = e.target.closest('[data-c]'); if (f) ctx.act('type', { c: +f.dataset.c, t: f.value }, +f.dataset.seat); });
      root.addEventListener('keydown', e => {
        const f = e.target.closest('[data-c]'); if (!f || e.key !== 'Enter') return; e.preventDefault();
        const next = root.querySelector(`[data-c="${+f.dataset.c + 1}"]`); if (next) next.focus(); else root.querySelector('[data-sl=buzz]') && root.querySelector('[data-sl=buzz]').click();
      });
      root.addEventListener('click', e => { const b = e.target.closest('[data-sl]'); if (!b || b.disabled) return; const a = b.dataset.sl; if (a === 'buzz') ctx.act('buzz', null, +b.dataset.seat); else ctx.act(a); });
    },
    render(s, ctx) {
      const box = el.querySelector('#slBox'), key = s.round + ':' + s.phase + ':' + s.writer;
      if (seen.key !== key) {
        seen.key = key;
        if (s.phase === 'write') {
          const seat = myFieldsSeat(s, ctx), mine = seat >= 0 && ctx.canAct(seat);
          box.innerHTML = `<div class="sl-head"><div class="sl-letter" aria-label="Buchstabe ${s.letter}">${s.letter}</div><div class="sl-info"><div class="label">Runde ${s.round} von ${s.rounds}${s.hot ? ' · ' + esc(ctx.names[s.writer]) + ' schreibt' : ''}</div><div class="ar-timer" id="slTimer"><i></i></div><div class="sl-opp" id="slOpp"></div></div></div>
            ${mine ? `<div class="sl-fields">${CATS.map((c, i) => `<label class="sl-field"><span class="label">${c}</span><input class="txt" data-c="${i}" data-seat="${seat}" maxlength="30" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="${s.letter} …" enterkeyhint="${i < 3 ? 'next' : 'done'}"></label>`).join('')}</div>
            <div class="row sl-row"><button class="btn big sl-buzz" type="button" data-sl="buzz" data-seat="${seat}">${s.solo || s.hot ? 'Fertig!' : 'Buzzer!'}</button><span class="hint">${s.solo ? 'Je Begriff 10 Punkte (5, wenn er nicht in unserer Liste steht).' : s.hot ? 'Danach ist die andere Person mit demselben Buchstaben dran.' : 'Wer alle vier Felder hat, darf buzzern – dann bleiben dem Gegner 10 Sekunden.'}</span></div>`
            : `<p class="hint">Du schaust zu.</p>`}`;
          const first = box.querySelector('[data-c="0"]'); if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
          ctx.sound('go'); ctx.say(`Runde ${s.round}. Buchstabe ${s.letter}.`, true);
        } else if (s.phase === 'pass') {
          box.innerHTML = `<div class="panel sheet sl-pass"><h2>Gerät weitergeben</h2><p>${esc(ctx.names[1])} ist dran – mit demselben Buchstaben. ${esc(ctx.names[0])}, nicht verraten!</p><div class="row"><button class="btn big" type="button" data-sl="ready">Ich bin ${esc(ctx.names[1])} – los!</button></div></div>`;
          setTimeout(() => { const b = box.querySelector('[data-sl=ready]'); b && b.focus(); }, 50);
          ctx.sound('turn');
        } else if (s.phase === 'review' || s.phase === 'end') {
          const seats = s.solo ? [0] : [0, 1], res = s.res || (s.hist.length ? s.hist[s.hist.length - 1].res : null);
          const note = n => ({ ok: '✓', neu: '?', falsch: '✗', leer: '–' })[n.split(' ')[0]] + (n.includes('allein') ? ' ×2' : n.includes('gleich') ? ' ½' : '');
          const canNext = !s.solo && s.phase === 'review' && (ctx.mode !== 'online' || ctx.me === 0);
          box.innerHTML = `<div class="sl-head"><div class="sl-letter small">${s.letter}</div><div class="sl-info"><div class="label">Auswertung · Runde ${s.round} von ${s.rounds}</div>${s.buzz >= 0 && !s.solo && !s.hot ? `<div class="hint">${esc(ctx.names[s.buzz])} hat gebuzzert.</div>` : ''}</div></div>
            <table class="sl-res"><thead><tr><th scope="col">Kategorie</th>${seats.map(p => `<th scope="col">${esc(ctx.names[p])}</th>`).join('')}</tr></thead><tbody>
            ${CATS.map((c, i) => `<tr><th scope="row">${c}</th>${seats.map(p => { const r = res[p][i]; return `<td class="n-${r.note.split(' ')[0]}"><span class="w">${r.t ? esc(r.t) : '—'}</span><span class="pts">${r.pts} <small>${note(r.note)}</small></span></td>`; }).join('')}</tr>`).join('')}
            <tr class="sum"><th scope="row">Runde</th>${seats.map(p => `<td><span class="pts">${res[p].reduce((a, x) => a + x.pts, 0)}</span></td>`).join('')}</tr></tbody></table>
            <p class="hint sl-legend">✓ steht in der Liste (10) · ? unbekannt, aber passend (5) · ×2 allein in der Kategorie · ½ gleiche Antwort</p>
            ${canNext ? `<div class="row"><button class="btn" type="button" data-sl="next">${s.round >= s.rounds ? 'Zum Ergebnis' : 'Nächste Runde'}</button></div>` : (!s.solo && s.phase === 'review' ? '<p class="hint">Die Spielleitung startet die nächste Runde.</p>' : '')}`;
          ctx.sound('magic');
          if (canNext) setTimeout(() => { const b = box.querySelector('[data-sl=next]'); b && b.focus(); }, 60);
        }
      }
      // Live-Teile ohne neu zu zeichnen
      if (s.phase === 'write') {
        const seat = myFieldsSeat(s, ctx);
        box.querySelectorAll('[data-c]').forEach(f => { const v = s.ans[seat] ? s.ans[seat][f.dataset.c] || '' : ''; if (document.activeElement !== f && f.value !== v && v) f.value = v; f.classList.toggle('bad', f.value.trim().length > 0 && norm(f.value)[0] !== norm(s.letter)); });
        const bz = box.querySelector('[data-sl=buzz]');
        if (bz) bz.disabled = !(s.solo || s.hot) && (s.buzz >= 0 || !filledAll(s.ans[seat] || {}));
        const opp = box.querySelector('#slOpp');
        if (opp && !s.solo && !s.hot) {
          const o = ctx.mode === 'online' ? 1 - ctx.me : 1, cnt = [0, 1, 2, 3].filter(c => (s.ans[o][c] || '').trim()).length;
          const txt = s.buzz >= 0 ? `${s.buzz === seat ? 'Du hast' : esc(ctx.names[s.buzz]) + ' hat'} gebuzzert – letzte Sekunden!` : `${esc(ctx.names[o])}: ${cnt}/4 Felder${ctx.isBot(o) && cnt < 4 ? ' <span class="dots">tippt</span>' : ''}`;
          if (opp._t !== txt) { opp._t = txt; opp.innerHTML = txt; }
        }
        if (s.buzz >= 0 && seen.buzz !== s.round) { seen.buzz = s.round; if (!s.solo && !s.hot) { ctx.sound('buzz'); ctx.say(`${ctx.names[s.buzz]} hat gebuzzert! Noch 10 Sekunden.`, true); } }
      }
    },
    frame(s, ctx) {
      if (s.phase !== 'write') return;
      const t = el.querySelector('#slTimer'); if (!t) return;
      const total = s.buzz >= 0 && !s.solo && !s.hot ? BUZZ_MS : (s.solo ? SOLO_MS : s.hot ? HOT_MS : DUO_MS);
      const left = Math.max(0, s.deadline - ctx.now());
      t.querySelector('i').style.transform = `scaleX(${Math.min(1, left / total)})`; t.classList.toggle('hot', left < 10000);
      t.title = Math.ceil(left / 1000) + ' Sekunden';
    }
  };

  LZArcade.define({
    id: 'slf', title: 'Stadt, Land, Fluss', sub: 'Blitz-Variante',
    modes: {
      solo: { desc: '45 Sekunden, ein Buchstabe, vier Kategorien – wie viele Punkte schaffst du?' },
      local: { desc: 'Nacheinander an einem Gerät: erst du, dann die andere Person – gleicher Buchstabe, 3 Runden.' },
      bot: { desc: 'Ihr tippt gleichzeitig. Der Bot kennt viele Begriffe und buzzert, sobald er alle hat.' },
      online: { desc: 'Beide tippen gleichzeitig am eigenen Gerät. Wer zuerst alles hat, buzzert.' }
    },
    rules: ['Zu jeder Kategorie ein Begriff mit dem Buchstaben: Stadt, Land, Tier, Beruf.', 'Begriffe aus unserer Liste geben 10 Punkte, andere passende 5. Allein in der Kategorie: doppelt. Gleiche Antwort: halb.', 'Zu zweit: Wer alle vier Felder hat, drückt den Buzzer – dann bleiben dem Gegner nur noch 10 Sekunden.'],
    keys: '<b>Tastatur:</b> <kbd class="lz-kbd">Enter</kbd> springt ins nächste Feld, im letzten Feld wird gebuzzert',
    logic, bot, view,
    scores(s, ctx) {
      if (s.solo) return [{ name: ctx.names[0], value: s.total[0], sub: 'Punkte', on: true }];
      return [0, 1].map(i => ({ name: ctx.names[i], vb: ctx.vb && ctx.vb[i], value: s.total[i], sub: 'Punkte gesamt', on: s.hot && s.phase === 'write' && s.writer === i }));
    },
    status(s, ctx) {
      if (s.phase === 'write') return `Buchstabe <em>${s.letter}</em>${s.buzz >= 0 && !s.solo && !s.hot ? ' · Buzzer!' : ''}`;
      if (s.phase === 'pass') return 'Gerät weitergeben';
      if (s.phase === 'review') return `Auswertung Runde ${s.round}`;
      return 'Spielende';
    }
  });
})();
