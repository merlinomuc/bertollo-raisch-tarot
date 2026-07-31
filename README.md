# Bertollo–Raisch Tarot – ChatGPT App

Diese Version ist eine echte **ChatGPT App (Apps SDK / MCP)**. Sie enthält die 78 eigenen Kartenbilder aus dem Originalprojekt und fünf Startoptionen:

1. Tageskarte
2. Ja / Nein
3. Kleines Kreuz
4. Keltisches Kreuz
5. Eigene Karten (physisch gelegte Karten eingeben)

## Funktionsweise

Die Oberfläche zieht bzw. erfasst die Karten. Beim Klick auf **„Von ChatGPT deuten lassen“** wird die fertige Legung mit `window.openai.sendFollowUpMessage` an den aktuellen Chat übergeben. Dadurch stammt die Deutung aus dem ChatGPT-Konto der Person, die die App verwendet. Es ist kein OpenAI-API-Schlüssel im Projekt erforderlich.

## Voraussetzungen

- Node.js 20 oder neuer
- npm
- Für den Test in ChatGPT: ein ChatGPT-Tarif mit Apps-SDK-Entwicklermodus
- Ein HTTPS-Tunnel (z. B. ngrok) oder ein öffentliches Hosting

## Lokal starten

```bash
npm install
npm run dev
```

Der MCP-Endpunkt läuft dann unter:

```text
http://localhost:8000/mcp
```

## In ChatGPT testen

1. Starte den Server mit `npm run dev`.
2. Öffne einen HTTPS-Tunnel, zum Beispiel:
   ```bash
   ngrok http 8000
   ```
3. Kopiere die öffentliche HTTPS-Adresse und ergänze `/mcp`, zum Beispiel:
   ```text
   https://abc123.ngrok-free.app/mcp
   ```
4. Öffne ChatGPT im Web.
5. Aktiviere unter **Einstellungen → Apps → Erweiterte Einstellungen** den Entwicklermodus.
6. Erstelle eine neue App und trage den öffentlichen MCP-Endpunkt ein.
7. Lass die Tools scannen und speichere die App.
8. Öffne einen neuen Chat, wähle die App und schreibe: „Öffne Bertollo–Raisch Tarot.“

## Dauerhaft hosten

Der Server muss öffentlich über HTTPS erreichbar sein. Geeignet sind Plattformen, die einen dauerhaft laufenden Node-HTTP-Server unterstützen, z. B. Render, Railway, Fly.io oder ein eigener Server.

Startbefehl:

```bash
npm start
```

Port: Die App verwendet automatisch `process.env.PORT`.

## Familie / Weitergabe

Für unabhängige private ChatGPT-Konten gibt es nicht automatisch einen privaten Installationslink wie bei einem Custom GPT. Für eine breite Weitergabe muss die App entweder:

- in einem gemeinsamen Business-/Enterprise-/Edu-Workspace veröffentlicht werden, oder
- für die öffentliche Distribution gemäß den jeweils aktuellen OpenAI-App-Regeln eingereicht werden.

Während der Entwicklung kann jedes berechtigte Familienmitglied den gleichen öffentlichen MCP-Endpunkt im eigenen Entwicklermodus als App hinzufügen. Jede Person nutzt dann ihr eigenes ChatGPT-Konto für die Deutung.

## Wichtige Dateien

- `src/server.ts` – MCP-Server und Tool-Definitionen
- `public/widget.html` – vollständige eingebettete App-Oberfläche
- `data/cards.json` – 78 Karten samt eingebetteter Bilder

## Submission-Version 1.1.1

Öffentlicher Anbieter: **Bertollo**, Deutschland  
Support: **tarot@bertollo.de**

Zusätzliche öffentliche Seiten:

- `/privacy`
- `/terms`
- `/support`
- `/imprint`
- `/health`

Fragen und Legungen werden nicht dauerhaft serverseitig gespeichert. Vor einer öffentlichen Veröffentlichung muss die ladungsfähige Postanschrift im Impressum ergänzt werden.
