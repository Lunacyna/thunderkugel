# Lunacynas Spielezimmer auf Cloudflare

Kleine Browser-Spiele mit Online-Multiplayer:
- **Kugelblitz** – Murmel-Geschicklichkeitsspiel für 2–4 Spieler, nur mit der Maus.
- **20 Questions** – Rate-Spiel in 20 Hinweisen für 2–6 Spieler.
- **Nur Einer!** – kooperatives Wort-Spiel (Just-One-Prinzip) für 2–8 Spieler: Jede*r gibt ein Hinweiswort, doppelte fliegen raus.

## Was drin ist

| Datei | Zweck |
|---|---|
| `public/index.html` | Startseite „Spielezimmer“ mit Spielauswahl |
| `public/kugelblitz/index.html` | Das Spiel Kugelblitz |
| `public/zwanzig/index.html` | Das Rate-Spiel 20 Questions (2–6 Spieler, leichte und schwere Karten) |
| `public/nureiner/index.html` | Das kooperative Wort-Spiel Nur Einer! (über 300 Begriffe) |
| `public/stacker/`, `pong/`, `viergewinnt/`, `kaesekaestchen/`, `stadtlandfluss/`, `memory/`, `dungeon/` | Die sieben Mini-Spiele (je Solo, zu zweit, gegen Bots; die rundenbasierten auch online) |
| `public/assets/arcade/` | Gemeinsamer Rahmen der Mini-Spiele + ein Skript/Stylesheet pro Spiel – Aufbau siehe `ARCADE.md` |
| `public/zwanzig/karten/index.html` | Eigene Karten für 20 Questions: Vorschläge einschicken und (mit Admin-Schlüssel) verwalten |
| `public/assets/og.jpg` | Vorschaubild, das Discord & Co. beim Teilen des Links zeigen |
| `public/favicon.ico`, `public/assets/icons/`, `public/site.webmanifest` | Favicons, Touch-Icons fürs Handy und Web-App-Manifest |
| `public/assets/cozy/cozy.css`, `cozy.js` | Gemeinsames Modul für alle Seiten: Farbstimmung (Sternennacht/Kaminabend), Focus-Ringe, Screenreader-Ansagen, Pfeiltasten, Feedback-Dialog |
| `public/assets/cozy/retro.css`, `retro.js` | 8-Bit-/Retro-Modus: Pixel-Look, CRT-Effekt, Chip-Sounds, Konami-Code |
| `public/assets/fonts/` | Pixel-Schriften (Press Start 2P, VT323) – selbst gehostet, Lizenz liegt daneben |
| `public/assets/cozy/sky.js` | Interaktiver Sternenhimmel der Startseite (Pfotenabdrücke bei Klick auf freie Flächen) |
| `src/worker.js` | Cloudflare Worker: liefert die Seiten aus, betreibt die Online-Räume und speichert eigene Karten und die Bestenliste (Durable Objects) |
| `wrangler.jsonc` | Cloudflare-Konfiguration |
| `package.json` | Installiert `wrangler`, das Cloudflare-Kommandozeilenwerkzeug |

## Veröffentlichen (ca. 5 Minuten)

Voraussetzungen: ein kostenloses Cloudflare-Konto und [Node.js](https://nodejs.org) (Version 18 oder neuer).

1. ZIP entpacken und im Terminal in den Ordner wechseln:
   ```
   cd kugelblitz-cloudflare
   ```
2. Abhängigkeiten installieren:
   ```
   npm install
   ```
3. Bei Cloudflare anmelden (öffnet den Browser):
   ```
   npx wrangler login
   ```
4. Hochladen:
   ```
   npx wrangler deploy
   ```

Am Ende steht die Adresse im Terminal, z. B. `https://kugelblitz.<dein-name>.workers.dev`.
Diesen Link an die Mitspieler schicken – fertig.

Beim allerersten Deploy fragt Cloudflare evtl. nach einer `workers.dev`-Subdomain; einfach einen Namen wählen.

## Ohne Terminal: über GitHub (nur im Browser)

1. Auf github.com ein neues Repository anlegen und den **Inhalt** dieses Ordners hochladen
   („Add file“ → „Upload files“). Wichtig: `wrangler.jsonc` muss ganz oben im Repo liegen, nicht in einem Unterordner.
2. Im Cloudflare-Dashboard: **Workers & Pages** → **Erstellen** → Reiter **Workers** → **Repository importieren** (Import a repository).
3. GitHub verbinden, das Repo auswählen, Einstellungen so lassen (Deploy-Befehl: `npx wrangler deploy`) und **Bereitstellen** klicken.

Wichtig: **nicht** „Pages“ wählen. Pages kann nur statische Seiten – dort funktioniert nur „Am selben Computer“, nicht Online.

## Häufiger Fehler: 404 bei Cloudflare Pages

Wer die ZIP-Datei per Drag & Drop bei **Pages** hochlädt, bekommt eine 404-Seite, weil die `index.html` dort im Unterordner `public/` liegt.
Pages ist für dieses Spiel der falsche Weg (kein Online-Server möglich). Nimm einen der beiden Wege oben.

## Admin-Schlüssel für eigene Karten (einmalig)

Damit nur du Vorschläge freigeben und Karten bearbeiten kannst, braucht der Server ein Passwort:

1. Cloudflare-Dashboard → **Workers & Pages** → dein Worker (`kugelblitz`) → **Einstellungen**.
2. **Variablen und Geheimnisse** → **Hinzufügen**.
3. Typ **Geheimnis** (Secret), Name `ADMIN_KEY`, Wert: ein eigenes, langes Passwort → **Bereitstellen**.

Danach unter `/zwanzig/karten/` → Reiter **Verwalten** mit diesem Passwort anmelden.
Vorschläge einschicken kann jede Person ohne Passwort.

## Twitch-Login (optional, einmalig einrichten)

Ohne diese Einrichtung läuft alles wie bisher – der Button „Mit Twitch einloggen“ erscheint dann einfach nicht.

**1. Twitch-App anlegen**
1. <https://dev.twitch.tv/console> öffnen (mit deinem Twitch-Konto; Twitch verlangt dafür ggf. Zwei-Faktor-Anmeldung).
2. **Anwendungen → Deine Anwendung registrieren**:
   - Name: z. B. `Lunacynas Spielezimmer`
   - OAuth-Redirect-URL: `https://kugelblitz.<dein-name>.workers.dev/auth/twitch/callback` (genau deine Adresse + `/auth/twitch/callback`)
   - Kategorie: *Website Integration*, Client-Typ: *Vertraulich*
3. Danach **Verwalten** → **Client-ID** kopieren und **Neues Geheimnis** erzeugen und kopieren.

**2. In Cloudflare als Geheimnisse eintragen** (Worker → Einstellungen → Variablen und Geheimnisse, Typ „Geheimnis“):

| Name | Wert |
|---|---|
| `TWITCH_CLIENT_ID` | Client-ID aus der Twitch-Konsole |
| `TWITCH_CLIENT_SECRET` | Geheimnis aus der Twitch-Konsole |
| `SESSION_SECRET` | ein langes Zufallspasswort (mind. 32 Zeichen), nur für den Server |

Optional `TWITCH_REDIRECT_URI`, falls du später eine eigene Domain nutzt.

**So funktioniert es**
- Login per OAuth-Code-Flow mit dem kleinstmöglichen Scope `openid` – es wird nur Twitch-ID und Anzeigename abgefragt, keine E-Mail, keine Rechte am Kanal.
- Der Server tauscht den Code gegen ein Token, liest damit einmal den Namen und widerruft das Token sofort wieder.
- Der Browser bekommt nur ein signiertes, `HttpOnly`-Cookie (30 Tage) mit Twitch-ID und Name.
- In Online-Räumen setzt der Server den bestätigten Namen selbst – niemand kann ihn per Browser fälschen.
- Beim Eintrag in die Bestenliste prüft der Server, ob die Twitch-Person wirklich im Spielraum war. Bestätigte Einträge bekommen ein ✓. Ein ungeprüfter Name, der wie eine bestätigte Person heißt, erscheint mit „(Gast)“.
- Eigene 20-Questions-Karten von eingeloggten Personen werden automatisch mit ihrem Namen (✓) versehen.

## Vorschaubild für Discord, Twitch-Chat & Co.

- Datei: `public/assets/og.jpg`, **1200 × 630 Pixel** (Seitenverhältnis 1,91:1), JPG oder PNG, möglichst unter 1 MB (aktuell ca. 130 KB).
- Wichtiges in die Mitte legen – manche Apps schneiden die Ränder ab.
- Das Bild liegt auf derselben Domain wie die Seite; der Worker setzt automatisch die volle `https://…`-Adresse in die Meta-Tags (Discord braucht absolute Links).
- Discord merkt sich Vorschauen eine Weile. Wenn du das Bild austauschst: in `meta.py` `OG_VERSION` hochzählen (bzw. in allen Seiten `og.jpg?v=2` → `?v=3`), dann holt Discord das neue Bild.
- Testen: Link in einen privaten Discord-Kanal posten, oder mit <https://www.opengraph.xyz>.

## Ton

Alle Seiten haben oben einen Lautsprecher-Knopf. Stumm bleibt stumm – auch nach Neuladen und auf allen Seiten des Spielezimmers (gespeichert im Browser).
Töne starten erst nach dem ersten Klick (so verlangen es die Browser).

## Farbstimmung: Sternennacht & Kaminabend

Oben neben dem Lautsprecher sitzt ein runder Knopf: **Mond** = Sternennacht (lila), **Flamme** = Kaminabend (warmes Anthrazit mit Bernstein).
- Ohne Auswahl richtet sich die Seite nach dem Gerät: Dunkelmodus → Sternennacht, Hellmodus → Kaminabend.
- Die Wahl wird im Browser gespeichert (`lz_theme`) und gilt auf allen Seiten und in allen offenen Tabs.
- Farben anpassen: `public/assets/cozy/cozy.css`, Abschnitt „Tokens“. Danach in `theme.py` `COZY_VERSION` hochzählen (oder in allen Seiten `cozy.css?v=1` → `?v=2`), damit Browser die neue Datei laden.

## 8-Bit-Modus

Der kleine Schiebeschalter „8-BIT“ (mit roter Power-LED) neben dem Mond/Flamme-Knopf schaltet den Retro-Look ein: Pixel-Schriften, eckige Pixel-Rahmen, Scanlines, Arcade-„Eindrücken“ beim Klicken und Töne wie aus einem alten Soundchip.
- Gilt auf allen Seiten und bleibt beim Neuladen erhalten (`lz_retro` im Browser). Funktioniert mit beiden Farbstimmungen: Sternennacht → Arcade-Nacht, Kaminabend → Bernstein-Terminal.
- Die Schriften liegen auf deinem eigenen Server (nicht bei Google) und werden erst geladen, wenn der Modus an ist.
- Stumm bleibt stumm. Hover-Töne gibt es nur mit Maus und erst nach dem ersten Klick (Browser-Regeln).
- Easter Egg: ↑ ↑ ↓ ↓ ← → ← → B A schaltet den Modus mit Münz-Sound und Wackel-Effekt ein.
- Wer „Bewegung reduzieren“ eingestellt hat, bekommt kein Wackeln (nur ein kurzes Aufblitzen); bei „Mehr Kontrast“ entfallen die Scanlines.

## Tastatur & Barrierefreiheit

- Alle Knöpfe, Links und Felder haben einen sichtbaren Fokus-Ring (nur bei Tastaturbedienung).
- **20 Questions:** Zahl tippen wählt ein Feld (1–20), Pfeiltasten wandern übers Raster, Leertaste springt ins Antwortfeld, Enter bestätigt/weiter.
- **Nur Einer!:** Leertaste springt ins Eingabefeld, Enter gibt ab/weiter, beim Prüfen streichen 1–7 den passenden Zettel.
- **Kugelblitz:** Leertaste oder J = Joker (Wackeln), 1–3 = Auswahl im Menü, Enter = Weiter. Das Greifen der Kugeln bleibt Maus/Touch – das ist der Kern des Spiels.
- Spielzüge, Hinweise, Punkte und Rundenwechsel werden für Screenreader angesagt (zeitkritische Wechsel wie „Du bist dran“ sofort, der Rest höflich).

## Mini-Spiele

Turmbau zu Babel, Curve-Ball, Vier gewinnt, Käsekästchen, Stadt-Land-Fluss, Speed-Memory und Karten-Dungeon. Alle haben Solo, „Zu zweit hier“ und „Gegen den Bot“ (Leicht/Mittel/Schwer). Vier gewinnt, Käsekästchen, Stadt-Land-Fluss, Memory und Dungeon gehen auch online zu zweit (über die bestehenden Räume, keine neue Einrichtung nötig).
Solo-Rekorde merkt sich der Browser. Gespielte Zeit fließt in „Zeitverschwendung in Zahlen“ ein.
Wie die Spiele aufgebaut sind (Datenstruktur, Spielschleife, Bot-Logik): `ARCADE.md`.

## Zeitverschwendung in Zahlen (Fun Metrics)

Über der Bestenliste stehen drei Kacheln: gemeinsam verschwendete Zeit, erratene Karten (20 Questions + Nur Einer!) und Kugelblitz-Chaos (gesammelte Kugeln + Wackler). Sie folgen dem Monats-Umschalter; darüber steht die Summe seit Start.
- Gemeldet wird jede fertige Karte/Runde einmal (`POST /api/stats`), von der Spielleitung bzw. dem lokalen Gerät – auch solo und bei Nur Einer!.
- Spielzeit = Rundenende − Rundenstart, ohne die Zeit, in der der Tab im Hintergrund lag. Obergrenze pro Runde: 15 Min. (Kugelblitz, Nur Einer!), 30 Min. (20 Questions) – im Browser und nochmal im Server.
- Gespeichert als einfache Zähler im bestehenden Store (`st:JJJJ-MM`, `st:all`); doppelte Meldungen werden über die Runden-ID erkannt.

## Feedback-Formular (Discord)

Unten auf jeder Seite: „Bug gefunden oder Spiel-Idee?“. Die Nachrichten landen in einem **privaten Discord-Kanal** – deine Adresse/URL steht nirgends im Quellcode.
1. In Discord: Server-Einstellungen → **Integrationen** → **Webhooks** → **Neuer Webhook**, Kanal wählen (am besten ein privater), **Webhook-URL kopieren**.
2. Cloudflare → Worker **kugelblitz** → Einstellungen → **Variablen und Geheimnisse** → Hinzufügen: Typ **Geheimnis**, Name `FEEDBACK_WEBHOOK`, Wert = die kopierte URL → Bereitstellen.
3. Die URL niemals in `wrangler.jsonc` oder auf GitHub eintragen – wer sie kennt, kann in deinen Kanal schreiben. Falls sie doch mal öffentlich wird: Webhook in Discord löschen und neu anlegen.

Schutz eingebaut: nur Anfragen von der eigenen Seite, höchstens 5 Nachrichten pro Stunde und Person (60 insgesamt), unsichtbares Spam-Feld, keine @everyone-Pings.

## Lokal testen

```
npm run dev
```
Dann `http://localhost:8787` in zwei Browserfenstern öffnen.

## Online spielen

1. Alle öffnen den Link und klicken auf **Online**.
2. Einer klickt **Neues Spiel eröffnen** und ist damit Spielleiter.
3. Die anderen klicken bei seinem Spiel auf **Mitspielen**. Mit **Neuer Name** kann man sich einen anderen Spielernamen würfeln.
4. Der Spielleiter wählt Kartenart und Rundenzahl und startet.

Hinweise:
- Das Spiel läuft im Browser der Spielleitung. Verlässt sie die Partie, übernimmt automatisch die nächste Person – das Spiel läuft weiter.
- Kugelblitz: Im Warteraum lassen sich Bots (Leicht/Normal/Schwer) dazuholen. Im Menü gibt es außerdem **Solo gegen Bots**.
- Bestenliste auf der Startseite: Gezählt wird jede fertig gespielte Partie mit mindestens zwei echten Menschen – online, bei 20 Questions auch am selben Bildschirm mit eingetragenen Namen. Bots und Namen wie „Spieler 2“ zählen nicht.
- Jeder hat 3 Joker pro Partie. Ein Klick auf den Schalenrand (oder „Wackeln!“) schüttelt die Schale für alle.
- Wer die falsche Kugel nimmt, ist 2 Sekunden gesperrt.
- Jeder, der den Link hat, sieht die offenen Spiele. Es gibt keine Anmeldung.

## Kosten

Läuft im kostenlosen Cloudflare-Workers-Tarif (Durable Objects mit SQLite sind dort enthalten).
Für Spielrunden im Freundes- und Familienkreis reichen die Gratis-Kontingente locker.
