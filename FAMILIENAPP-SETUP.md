# Bertollo–Raisch Tarot Familien-App 1.3.0

## Neue Funktionen

- Eigenständige Web-App unter `/`
- 78 sichtbare eigene Kartenbilder
- automatische Ziehung oder eigene verdeckte Auswahl
- ausschließlich aufrechte Karten
- Deutung direkt in der Web-App über die OpenAI Responses API
- optionaler Familiencode
- Tageslimit pro IP und monatliches Gesamtkontingent
- installierbare PWA für Smartphone und Tablet
- bestehende MCP-/ChatGPT-App bleibt unter `/mcp` erhalten

## Render-Umgebungsvariablen

Diese Werte unter **Environment** eintragen:

- `OPENAI_API_KEY`: geheimer OpenAI-API-Schlüssel
- `FAMILY_ACCESS_CODE`: selbst gewählter Familiencode, beispielsweise ein langes Passwort
- `OPENAI_MODEL`: `gpt-5-mini`
- `DAILY_IP_LIMIT`: `20`
- `MONTHLY_REQUEST_LIMIT`: `300`

Der API-Schlüssel darf niemals in GitHub oder in eine Browserdatei kopiert werden.

## Test

1. `/health` öffnen. `aiConfigured` muss `true` sein.
2. Startseite öffnen.
3. Familiencode eintragen und speichern.
4. Eine Tageskarte auswählen.
5. `Legung deuten` drücken.
6. Prüfen, dass die Deutung unter den Karten erscheint.

## PWA installieren

- iPhone/iPad: Teilen → Zum Home-Bildschirm
- Android/Chrome: Menü → App installieren oder Zum Startbildschirm hinzufügen

## Grenzen

Die eingebauten Zähler werden im Arbeitsspeicher geführt. Sie setzen sich bei einem Render-Neustart zurück und gelten nicht zuverlässig bei mehreren Serverinstanzen. Für eine kleine private Familien-App ist das eine erste Schutzschicht. Für öffentliche Nutzung sollte später Redis oder eine Datenbank verwendet werden.
