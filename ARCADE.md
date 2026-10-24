# Mini-Spiele – Architektur

Sechs Spiele, ein gemeinsamer Rahmen. Alles ist reines DOM bzw. Canvas, ohne Frameworks.

```
public/assets/arcade/
  arcade.js / arcade.css      gemeinsamer Rahmen (LZArcade)
  stacker.js / .css           Turmbau zu Babel        → /stacker/
  pong.js / .css              Curve-Ball              → /pong/
  viergewinnt.js / .css       Vier gewinnt            → /viergewinnt/
  kaesekaestchen.js / .css    Käsekästchen            → /kaesekaestchen/
  memory.js / .css            Speed-Memory            → /memory/
  dungeon.js / .css           Karten-Dungeon          → /dungeon/
```

## Der Rahmen (`LZArcade.define`)

Jedes Spiel liefert drei strikt getrennte Teile:

| Teil | Aufgabe | Regeln |
|---|---|---|
| `logic` | Zustandsmaschine | kein DOM. `init(cfg)`, `act(state, seat, type, arg)` gibt einen neuen Zustand zurück oder `null` (ungültig). Dazu `tick(state, dt)` für Zeit und Physik, `turn(state)` und `over(state)`. |
| `bot` | Heuristik | `think()` für rundenbasierte Spiele (ein Zug), `control()` für Echtzeit (pro Frame), `observe()` für Bots mit Gedächtnis. |
| `view` | Darstellung | `mount()`, `render()` nach jeder Änderung, `frame()` für Canvas pro Frame. |

**Einheitlicher Input:** Maus, Touch, Tastatur, Bot und Netzwerk landen alle in `act(seat, type, arg)`.
- Ein Bot „drückt“ dieselben Knöpfe wie ein Mensch, zum Beispiel `act(1, 'drop', {c: 3})`.
- Pong-Tastatur, Touch und Bot benutzen dieselben Aktionen `move` und `aim`.

**Modi:**
- **Solo:** ein Sitz. Hat das Spiel einen eingebauten Gegner (`soloBot`), steuert der Bot Sitz 1, zum Beispiel beim Vier-gewinnt-Puzzle.
- **Zu zweit hier** (nur noch Memory): Beide Sitze werden von diesem Gerät gesteuert. Der Sitz ergibt sich aus `turn()`.
- **Gegen Bot:** Sitz 1 ist der Bot, mit den Stufen Leicht, Mittel und Schwer.
- **Online (nur rundenbasiert):** Die Spielleitung (Sitz 0) rechnet und veröffentlicht den Zustand. Der Gast (Sitz 1) schickt seine Eingaben. Weitere Personen schauen zu. Verborgene Felder (`logic.hide`) werden verschleiert übertragen. Raum-Codes haben die Form `ar-xxxx`, die Lobby heißt `lobby-ar`.

**Bestenliste:** Online-Siege meldet die Spielleitung an `/api/scores`; der Server prüft über den Raum, wer wirklich mitgespielt hat. Solo-Rekorde (`over().record`) gehen an `/api/records`, pro Person zählt der beste Wert im Monat.

**Was der Rahmen außerdem erledigt:** Modus-Menü, Ergebnis-Karte, Revanche, Bestwerte (im Browser), Spielzeit für „Zeitverschwendung in Zahlen“, Sound, Screenreader-Ansagen, Sicherheitsfrage beim Verlassen, Wiederverbinden nach Neuladen. Sternennacht, Kaminabend und der 8-Bit-Modus funktionieren automatisch.

---

## 1 · Turmbau zu Babel (Block-Stacker) – nur Solo

- **Daten:** `tower: [{x, w}]` (Feldbreite 100) und `cur: {x, w, dir, v}` für den gleitenden Block. Dazu `cut` (das abgeschnittene Stück fürs Fall-Bild) sowie `perfect` und `streak`.
- **Loop:**
  - `tick` schiebt den Block mit `v = 42 + 2,6·Höhe` hin und her und lässt ihn an den Rändern abprallen.
  - `drop` berechnet die Überlappung mit dem Block darunter. Die Überlappung bleibt, der Rest fällt.
  - Liegt der Block auf ±1,6 genau, schnappt er perfekt ein. Drei perfekte Blöcke in Folge lassen die Plattform um bis zu 6 wachsen.
- **Bestenliste:** Die Turmhöhe zählt als Monatsrekord.

## 2 · Curve-Ball (Pixel-Pong)

- **Daten:** Feld 160 × 100.
  - `ball: {x, y, vx, vy, spin}` und `pads: [{y, v, dir, aim, max}]`
  - dazu `score`, `lives` (Solo), `hits`, `serveAt`
- **Loop pro Frame:**
  - Zuerst bewegen sich die Schläger: `dir` kommt von der Tastatur, `aim` von Touch oder Bot.
  - Der Schnitt krümmt die Bahn (`vy += spin·dt`) und klingt ab.
  - Der Ball bewegt sich in feinen Teilschritten, damit er bei hohem Tempo nicht durch den Schläger rutscht.
  - Treffer: Der Abprallwinkel ergibt sich aus der Trefferstelle (±57°). Jeder Treffer macht den Ball 5,5 % schneller (Obergrenze). Die Schlägerbewegung gibt Schnitt mit.
  - Solo ist Squash mit Rückwand und 3 Leben (die Treffer zählen als Rekord). Gegen den Bot gewinnt, wer zuerst 7 Punkte hat.
- **Bot:**
  - Er sieht den Ball nur alle 0,34 / 0,19 / 0,09 s neu.
  - Er sagt den Auftreffpunkt samt Bandenabprallern voraus. Den Schnitt rechnet er nur auf Schwer ein.
  - Pro Ballwechsel streut er (σ 9 / 5 / 2,4) und macht mit 25 / 12 / 4 % einen groben Stellungsfehler.
  - Sein Schläger ist auf 58 / 84 / 112 Einheiten/s gedrosselt (ein Mensch hat 120).

## 3 · Vier gewinnt

- **Daten:**
  - `b: Array(42)` mit Index `spalte·6 + zeile` (zeile 0 = unten) und den Werten 0, 1, 2
  - dazu `turn`, `win`, `line`, `last`
  - Puzzle zusätzlich `need` (erlaubte eigene Züge) und `used`
- **Loop:** Rundenbasiert. `drop {c}` legt den Chip auf die Spaltenhöhe und prüft dann vier Richtungen ab dem neuen Chip.
- **Bot:**
  - Negamax mit Alpha-Beta-Pruning, Züge von der Mitte nach außen sortiert.
  - Ein sofortiger Sieg wird vorab erkannt, schnellere Siege werden bevorzugt (WIN − Tiefe).
  - Bewertung über alle 69 Viererfenster: eigene 3 → +5, eigene 2 → +2, gegnerische 3 → −4, dazu ein Bonus für die Mittelspalte.
  - Tiefe 1 / 4 / 7. Leicht spielt zusätzlich in 25 % der Fälle zufällig.
  - Schwer braucht etwa 10.000 Knoten bzw. 70 ms pro Zug.
- **Puzzles:**
  - 9 Stellungen (Sieg in 1, 2 oder 3 Zügen), automatisch erzeugt und mit einem exakten Solver geprüft.
  - Der Verteidiger rechnet 8 Halbzüge tief.
  - Der Fortschritt wird im Browser gespeichert.

## 4 · Käsekästchen

- **Daten** (n × n Punkte, b = n − 1):
  - `h: Array(n·b)` und `v: Array(b·n)` für die Kanten (−1 frei, sonst der Sitz)
  - `box: Array(b²)` für die Besitzer
  - dazu `turn`, `score`, `last`
- **Loop:** `line {k, i}` setzt eine Kante und prüft die höchstens zwei angrenzenden Kästchen. Wer etwas schließt, bekommt den Punkt und bleibt dran. Gespielt wird gegen den Bot oder online.
- **Bot (Heuristik):**
  1. Kästchen schließen. Schwer bevorzugt dabei Schließ-Züge, nach denen sofort das nächste Kästchen schließbar ist, und folgt so Ketten.
  2. Eine sichere Kante wählen, die kein Kästchen auf drei Seiten bringt.
  3. Gibt es keine sichere Kante mehr: jede Kante durchsimulieren, den Gegner gierig einsammeln lassen und das kleinste Geschenk wählen.
  - Leicht greift nur in 70 % der Fälle zu und meidet die dritte Seite nur halbherzig.

## 5 · Speed-Memory

- **Daten:**
  - `cards: Array(16)` mit den Motiven 0–7, online verborgen
  - `up` für die aufgedeckten Karten, `found[]` mit dem Sitz, der das Paar gefunden hat
  - dazu `hideAt`, `score`, `misses`, `t0` und `tEnd`
- **Loop:** `flip {i}`. Bei zwei aufgedeckten Karten gilt: Ein Paar bleibt liegen und derselbe Sitz ist nochmal dran. Sonst setzt der Fehlversuch `hideAt`, und `tick` deckt nach 0,65 s (Solo) bzw. 0,95 s wieder zu. Solo zählt Zeit plus 1 s pro Fehlversuch.
- **Bot:**
  - `observe` merkt sich jede neu aufgedeckte Karte nur mit 50 / 75 / 95 % Wahrscheinlichkeit, gefundene Paare fliegen aus dem Gedächtnis.
  - Kennt er ein Paar, nimmt er es. Sonst deckt er eine unbekannte Karte auf und dann den Partner aus dem Gedächtnis oder wieder eine unbekannte.

## 6 · Karten-Dungeon

- **Daten:**
  - `deck` (online verborgen) und `grid: Array(9)` für die 3×3-Auslage
  - `pl[]: {hp, max, gold, weapon, shield, forced}`
  - Karte `{k, v}` mit den Arten Monster, Waffe, Schild, Trank, Gold und im Duell zusätzlich Dolch und Köder
- **Loop:**
  - `take {i}` wendet die Karte an und füllt die Lücke sofort aus dem Stapel nach.
  - **Monster:** Schaden = Wert − Waffe, der Schild fängt den Rest ab und verbraucht sich. Die Waffe stumpft um 1 ab. Wer überlebt, bekommt Kopfgeld.
  - **Köder:** Der Gegner muss als Nächstes das stärkste Monster nehmen.
  - Die Balance stammt aus 2.000 simulierten Partien je Variante:
    - Solo gewinnt ein gieriger Bot etwa die Hälfte der Partien.
    - Im Duell startet, wer als Zweites zieht, mit 16 statt 13 HP. Damit stehen die Siege bei etwa 52:48.
- **Bot:**
  - Er bewertet jede legale Karte: erwarteter Schaden ×2,1 gegen Kopfgeld, fehlende Heilung, Ausrüstungsgewinn, Schaden beim Gegner. Ein tödlicher Zug ergibt −1000, ein tödlicher Treffer beim Gegner +1000.
  - Leicht wählt zufällig aus den besten drei Karten, Mittel nimmt immer die beste.
  - Schwer zieht zusätzlich 0,6 × den besten Gegenzug des Gegners ab (1 Halbzug Vorausschau).
