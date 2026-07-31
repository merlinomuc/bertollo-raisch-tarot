# Version 1.3.6

- Kritischen Mikrofonfehler behoben: Der Server blockierte das Mikrofon versehentlich mit `Permissions-Policy: microphone=()`.
- Mikrofon ist nun für die eigene App-Domain freigegeben.
- Spracherkennung für die eigene Origin freigegeben.
- Berechtigungsdialog wird direkt durch einen Nutzerklick ausgelöst.
- Mikrofonstream bleibt bis zum Start der Spracherkennung aktiv.
- Verständliche Diagnose bei eingebetteter/Frame-Weiterleitung ergänzt.
