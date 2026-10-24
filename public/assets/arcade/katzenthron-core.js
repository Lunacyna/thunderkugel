/* ==========================================================================
   Katzenthron – Rätsel-Erzeugung und Prüfung (Worker; Prüfung auch im Browser)
   Ein n×n-Gitter ist in n Farbzonen geteilt. Gesucht: n Katzen, genau eine pro
   Zeile, Spalte und Farbzone, und keine zwei dürfen sich berühren (auch nicht
   schräg). Jedes erzeugte Rätsel hat genau EINE Lösung.
   Rätsel: {n, r:[zone je Feld, zeilenweise]}  Lösung: cats[zeile] = spalte
   ========================================================================== */
(function (root) {
  'use strict';
  function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  function shuffled(a, rnd) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // zufällige gültige Katzen-Aufstellung (eine pro Zeile/Spalte, keine Nachbarn)
  function placeCats(n, rnd) {
    const p = [], used = new Array(n).fill(false);
    const go = r => {
      if (r === n) return true;
      for (const c of shuffled([...Array(n).keys()], rnd)) {
        if (used[c] || (r && Math.abs(p[r - 1] - c) < 2)) continue;
        used[c] = true; p[r] = c; if (go(r + 1)) return true; used[c] = false;
      }
      return false;
    };
    return go(0) ? p : null;
  }
  // Zonen von den Katzen aus wachsen lassen
  function growZones(n, cats, rnd) {
    const r = new Array(n * n).fill(-1), size = new Array(n).fill(1);
    cats.forEach((c, row) => { r[row * n + c] = row; });
    let left = n * n - n;
    const nb = i => { const y = Math.floor(i / n), x = i % n, o = []; if (y) o.push(i - n); if (y < n - 1) o.push(i + n); if (x) o.push(i - 1); if (x < n - 1) o.push(i + 1); return o; };
    const want = [...Array(n)].map(() => 0.4 + rnd() * 1.6);       // unterschiedlich große Zonen
    while (left) {
      // Zone auswählen: gewichtet nach Wunschgröße, kleine Zonen etwas bevorzugt
      const fr = [];
      for (let i = 0; i < n * n; i++) if (r[i] === -1) for (const j of nb(i)) if (r[j] >= 0) fr.push([i, r[j]]);
      let tot = 0; const w = fr.map(([, z]) => { const v = want[z] / size[z]; tot += v; return v; });
      let x = rnd() * tot, k = 0; while (x > w[k]) { x -= w[k]; k++; }
      const [cell, z] = fr[Math.min(k, fr.length - 1)];
      r[cell] = z; size[z]++; left--;
    }
    return r;
  }
  // Lösungen zählen (bis max)
  function count(n, r, max) {
    let found = 0, sol = null; const colU = new Array(n).fill(false), zoneU = new Array(n).fill(false), p = [];
    const go = row => {
      if (row === n) { found++; if (!sol) sol = p.slice(); return found >= max; }
      for (let c = 0; c < n; c++) {
        const z = r[row * n + c];
        if (colU[c] || zoneU[z] || (row && Math.abs(p[row - 1] - c) < 2)) continue;
        colU[c] = zoneU[z] = true; p[row] = c;
        if (go(row + 1)) return true;
        colU[c] = zoneU[z] = false;
      }
      return false;
    };
    go(0); return { found, sol };
  }
  // eine Lösung finden, die NICHT die gewünschte ist (oder null)
  function other(n, r, cats) {
    const colU = new Array(n).fill(false), zoneU = new Array(n).fill(false), p = [];
    let res = null;
    const go = row => {
      if (row === n) { if (p.some((c, i) => c !== cats[i])) { res = p.slice(); return true; } return false; }
      for (let c = 0; c < n; c++) {
        const z = r[row * n + c];
        if (colU[c] || zoneU[z] || (row && Math.abs(p[row - 1] - c) < 2)) continue;
        colU[c] = zoneU[z] = true; p[row] = c;
        if (go(row + 1)) return true;
        colU[c] = zoneU[z] = false;
      }
      return false;
    };
    go(0); return res;
  }
  function connected(n, r, z, without) {
    const cells = []; for (let i = 0; i < n * n; i++) if (r[i] === z && i !== without) cells.push(i);
    if (!cells.length) return false;
    const seen = new Set([cells[0]]), st = [cells[0]];
    while (st.length) { const i = st.pop(), y = Math.floor(i / n), x = i % n;
      for (const j of [y ? i - n : -1, y < n - 1 ? i + n : -1, x ? i - 1 : -1, x < n - 1 ? i + 1 : -1]) if (j >= 0 && j !== without && r[j] === z && !seen.has(j)) { seen.add(j); st.push(j); } }
    return seen.size === cells.length;
  }
  // Rätsel erzeugen: Zonen wachsen lassen, dann so lange Felder umfärben, bis nur noch EINE Lösung übrig ist
  function generate(n, seedText) {
    const rnd = rng(hash(seedText));
    for (let t = 0; t < 200; t++) {
      const cats = placeCats(n, rnd); if (!cats) continue;
      const r = growZones(n, cats, rnd), isCat = new Set(cats.map((c, y) => y * n + c));
      for (let step = 0; step < 400; step++) {
        const alt = other(n, r, cats);
        if (!alt) return { n, r, tries: t + 1 };
        // ein Feld der falschen Lösung einer Nachbarzone zuschlagen (die echte Lösung bleibt gültig)
        const rows = shuffled([...Array(n).keys()].filter(y => alt[y] !== cats[y]), rnd);
        let done = false;
        for (const y of rows) {
          const i = y * n + alt[y]; if (isCat.has(i)) continue;
          const x = i % n, nbz = shuffled([y ? i - n : -1, y < n - 1 ? i + n : -1, x ? i - 1 : -1, x < n - 1 ? i + 1 : -1].filter(j => j >= 0 && r[j] !== r[i]).map(j => r[j]), rnd);
          if (!nbz.length || !connected(n, r, r[i], i)) continue;
          r[i] = nbz[0]; done = true; break;
        }
        if (!done) break;
      }
    }
    return null;
  }
  // Prüft eine Aufstellung: cats[zeile] = spalte  -> true/false
  function check(p, cats) {
    const n = p.n; if (!Array.isArray(cats) || cats.length !== n) return false;
    const cols = new Set(), zones = new Set();
    for (let y = 0; y < n; y++) {
      const c = cats[y]; if (!Number.isInteger(c) || c < 0 || c >= n) return false;
      if (cols.has(c)) return false; cols.add(c);
      const z = p.r[y * n + c]; if (zones.has(z)) return false; zones.add(z);
      if (y && Math.abs(cats[y - 1] - c) < 2) return false;
    }
    return true;
  }
  root.KTCore = { generate, check, count, hash };
})(typeof globalThis !== 'undefined' ? globalThis : window);
