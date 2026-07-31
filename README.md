# Bertollo–Raisch Tarot 1.3.3

Dieses Projekt stellt drei Zugangswege bereit:

1. **Familien-Web-App** unter `/` – grafische Kartenauswahl und direkte OpenAI-Deutung.
2. **MCP-/ChatGPT-App** unter `/mcp` – interaktive Oberfläche innerhalb von ChatGPT.
3. **Custom-GPT-Action** unter `/api/reveal` mit Schema `/api/openapi.json`.

## Lokale Entwicklung

```bash
npm install
OPENAI_API_KEY=... FAMILY_ACCESS_CODE=... npm start
```

## Render

Siehe `FAMILIENAPP-SETUP.md`. Der API-Schlüssel wird nur als Render-Umgebungsvariable gespeichert.

## Datenschutz

Fragen und Deutungen werden von der Anwendung nicht dauerhaft in einer eigenen Datenbank gespeichert. Für die direkte Deutung werden Frage, Legungsart und Karten an die OpenAI-API übermittelt. Technische Nutzungszähler liegen nur im Arbeitsspeicher.
