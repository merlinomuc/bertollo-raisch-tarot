# Änderungen in Version 1.3.7

- Firefox-Fallback für Spracheingabe ergänzt.
- Firefox nutzt `MediaRecorder` und sendet die bewusst gestartete Aufnahme an `/api/transcribe`.
- Chrome und Edge verwenden weiterhin ausschließlich `SpeechRecognition`.
- Maximale Firefox-Aufnahmezeit: 60 Sekunden.
- Unterstützte Aufnahmeformate werden automatisch gewählt (`ogg`, `webm` oder `mp4`).
- Serverseitige Transkription mit `gpt-4o-mini-transcribe` und deutscher Sprachvorgabe.
- Familiencode ist auch für den Transkriptionsendpunkt erforderlich.
- Separates tägliches Transkriptionslimit pro IP, standardmäßig 60.
- Datenschutztext um die Firefox-Audioverarbeitung ergänzt.
- PWA-Cache auf 1.3.7 erhöht.
