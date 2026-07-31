# Einreichungsunterlagen – Bertollo–Raisch Tarot

## Stammdaten

- App-Name: Bertollo–Raisch Tarot
- Öffentlicher Anbieter: Bertollo
- Land: Deutschland
- Support: tarot@bertollo.de
- Sprache: Deutsch
- Kartenmotive: 78 eigene Werke von Bertollo
- Speicherung von Fragen/Legungen: keine dauerhafte serverseitige Speicherung
- Umgekehrte Karten: aktiv; Darstellung durch Drehung des Kartenmotivs um 180 Grad

## URLs nach Deployment

- Website: `https://bertollo-raisch-tarot.onrender.com/`
- MCP: `https://bertollo-raisch-tarot.onrender.com/mcp`
- Datenschutz: `https://bertollo-raisch-tarot.onrender.com/privacy`
- Nutzungsbedingungen: `https://bertollo-raisch-tarot.onrender.com/terms`
- Support: `https://bertollo-raisch-tarot.onrender.com/support`
- Impressum: `https://bertollo-raisch-tarot.onrender.com/imprint`
- Health: `https://bertollo-raisch-tarot.onrender.com/health`

## Kurzbeschreibung

Interaktive deutschsprachige Tarot-App mit 78 eigenen Kartenmotiven, fünf Legungsarten und der Möglichkeit, physisch gelegte Karten einzugeben. Die Deutung erfolgt im aktuellen ChatGPT-Gespräch und wird als nicht-deterministischer Impuls zur Selbstreflexion formuliert.

## Ausführliche Beschreibung

Bertollo–Raisch Tarot bietet eine visuelle Tarotoberfläche direkt in ChatGPT. Verfügbar sind Tageskarte, Ja/Nein, Kleines Kreuz, Keltisches Kreuz und Eigene Karten. Bei „Eigene Karten“ können bis zu 20 physisch gezogene Karten in Reihenfolge und Ausrichtung erfasst werden. Die App speichert Fragen und Legungen nicht dauerhaft. Tarot dient der Unterhaltung und Selbstreflexion und ersetzt keine medizinische, psychologische, rechtliche oder finanzielle Beratung.

## Starter-Prompts

- Öffne Bertollo–Raisch Tarot.
- Ziehe mir eine Tageskarte.
- Ich möchte ein Keltisches Kreuz legen.
- Ich habe eigene Karten physisch gelegt.
- Hilf mir bei einer Ja/Nein-Legung.

## Testfälle

1. `tools/list` liefert `open_tarot_app` und `tarot_app_help`.
2. `tools/call open_tarot_app` liefert die UI-Ressource `ui://widget/bertollo-raisch-tarot-v1.html`.
3. `resources/read` liefert HTML mit MIME-Typ `text/html;profile=mcp-app`.
4. Auf der Startseite erscheinen genau fünf Legungsarten.
5. Tageskarte zieht genau eine Karte.
6. Ja/Nein zieht genau drei eindeutige Karten.
7. Kleines Kreuz zieht fünf eindeutige Karten.
8. Keltisches Kreuz zieht zehn eindeutige Karten.
9. Eigene Karten erlaubt 1–20 Karten mit aufrechter oder umgekehrter Ausrichtung.
10. Startseite setzt den Legungszustand zurück.
11. Der Button zur Deutung übergibt Frage, Positionen, Karten und Ausrichtungen an den aktuellen Chat.
12. `/privacy`, `/terms`, `/support` und `/health` sind öffentlich erreichbar.

## Offener Blocker

Vor einer öffentlichen Einreichung muss im Impressum eine vollständige ladungsfähige Postanschrift ergänzt werden. Die Texte sind Entwürfe und keine Rechtsberatung.
