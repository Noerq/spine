# Spine

Private Web-App zur Inventarisierung von Büchern. Barcode scannen, Daten kommen automatisch aus der Deutschen Nationalbibliothek (Rückfall: Open Library).

## Entwicklung

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # Ausgabe in dist/
```

Ein Push auf `main` deployt automatisch per GitHub Actions auf GitHub Pages (`/spine/`).

## Aufbau

- `src/main.js`: Oberfläche (Liste, Suche, Filter, Buch-Sheet, Sicherung)
- `src/scanner.js`: Kamera + Barcode-Erkennung (zxing-wasm, selbst gehostet)
- `src/lookup.js`: ISBN-Suche: DNB (SRU/MARC21) → Open Library. Cover: Google Books (Bild-Endpoint, ohne Key) → Open Library. Die DNB-Cover gehen im Browser nicht, weil sie hinter einem Bot-Schutz liegen.
- `src/db.js`: IndexedDB, gelöschte Bücher als Tombstones (für sauberes Zusammenführen)
- `src/backup.js`: Export/Import als JSON (`spine-JJJJ-MM-TT.json`)

## Datenschutz

- Alle Bücher liegen nur lokal im Browser (IndexedDB). Es gibt keinen eigenen Server und keine Anmeldung.
- Bei der Suche geht nur die ISBN an die DNB bzw. Open Library, beim Laden von Covern an Google Books bzw. Open Library. Die sehen dabei deine IP-Adresse. Einen Referrer schicken wir nicht mit.
- Selbst fotografierte Cover werden verkleinert lokal gespeichert und kommen in die Sicherungsdatei mit.
- Sicherungsdateien enthalten deinen kompletten Bestand im Klartext. In iCloud Drive sind sie so geschützt wie dein Apple-Account.
