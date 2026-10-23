# Kugelblitz auf Cloudflare

Murmel-Geschicklichkeitsspiel für 2–4 Spieler, nur mit der Maus.
Spielbar am selben Computer oder online mit gemeinsamer Schale.

## Was drin ist

| Datei | Zweck |
|---|---|
| `public/index.html` | Startseite „Spielezimmer“ mit Spielauswahl |
| `public/kugelblitz/index.html` | Das Spiel Kugelblitz |
| `public/assets/header.webp` | Twitch-Header für die Startseite |
| `src/worker.js` | Cloudflare Worker: liefert die Seite aus und betreibt die Online-Räume (Durable Objects + WebSockets) |
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
- Die Schale wird im Browser des Spielleiters berechnet. Er sollte das Fenster offen und im Vordergrund lassen; schließt er es, endet die Partie.
- Jeder hat 3 Joker pro Partie. Ein Klick auf den Schalenrand (oder „Wackeln!“) schüttelt die Schale für alle.
- Wer die falsche Kugel nimmt, ist 2 Sekunden gesperrt.
- Jeder, der den Link hat, sieht die offenen Spiele. Es gibt keine Anmeldung.

## Kosten

Läuft im kostenlosen Cloudflare-Workers-Tarif (Durable Objects mit SQLite sind dort enthalten).
Für Spielrunden im Freundes- und Familienkreis reichen die Gratis-Kontingente locker.
