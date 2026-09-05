# Hörspielbeutel

Ein persönlicher Hörspiel-Zufallsgenerator ohne Zurücklegen. Der Fortschritt liegt zentral in PostgreSQL, deshalb sehen Handy, Desktop und mehrere offene Browser immer dieselbe aktive Folge.

## Funktionen

- freie Serienauswahl und gespeicherte Presets
- globaler Fortschritt pro Serie und Runde
- genau eine atomar reservierte Folge pro Account
- gehörte, übersprungene und korrigierte Ziehungen
- geplante, einmal priorisierte Neuerscheinungen
- Sonderfolgen ohne Nummer
- mehrere Hör-Links, Favoriten und private Notizen
- optionale Bewertungen von 1 bis 10 pro echtem Hördurchlauf
- CSV-Import mit Vorschau und vollständigem Rollback bei Fehlern
- tägliche Online-Importe für Die drei ???, TKKG sowie öffentliche CSV-, JSON- und RSS-Feeds
- Suche, Filter, Bulk-Status und Archivierung
- Hörzeit, Skipquote, Streaks, Zeitdiagramme und Serienfortschritt
- installierbare, responsive PWA; Ziehungen bleiben bewusst online

## VPS-Installation

Vorausgesetzt werden Docker mit Compose, eine Domain und ein vorhandener Caddy-Container.

1. Repository auf die VPS kopieren und Konfiguration anlegen:

   ```sh
   cp .env.example .env
   openssl rand -hex 32     # PostgreSQL-Passwort, sicher in der DATABASE_URL
   openssl rand -base64 48  # SESSION_SECRET und SETUP_TOKEN
   ```

   Die erzeugten Werte für `SESSION_SECRET`, `SETUP_TOKEN` und das PostgreSQL-Passwort in `.env` eintragen. Beide Anwendungsschlüssel müssen mindestens 32 Bytes lang sein. Dasselbe PostgreSQL-Passwort muss URL-sicher in `DATABASE_URL` stehen. `APP_ORIGIN` muss exakt die öffentliche HTTPS-Origin ohne Pfad enthalten.

2. Namen des Docker-Netzes prüfen, in dem Caddy läuft, und als `CADDY_NETWORK` setzen. Falls noch kein gemeinsames Proxy-Netz existiert:

   ```sh
   docker network create caddy
   ```

3. Den Block aus `deploy/Caddyfile.example` in den vorhandenen Caddyfile übernehmen. `AUDIOBOOK_DOMAIN` im Caddy-Container setzen oder die Domain direkt anstelle des Platzhalters eintragen.

4. Anwendung bauen und starten:

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

   Der einmalige Migrationsdienst beendet sich erfolgreich; App, Import-Worker und Datenbank bleiben aktiv. Die Datenbank und der Worker besitzen keinen veröffentlichten Host-Port. Caddy benötigt für den Worker keine neue Regel.

5. `https://deine-domain.example/setup` öffnen und mit dem `SETUP_TOKEN` den Eigentümer-Account anlegen. Danach liefert die Setup-Seite nur noch die Anmeldung aus und kann nicht erneut verwendet werden.

## Aktualisierung

```sh
git pull --ff-only
docker compose up -d --build
```

Neue SQL-Migrationen werden vor dem Start der neuen App-Version angewendet. Bereits angewendete Migrationen dürfen nicht nachträglich verändert werden.

## CSV-Import

Eine Beispieldatei liegt unter `examples/episodes.csv`. Pflichtspalten:

```text
series_key,series_name,episode_key,title
```

Optionale Spalten:

```text
number_label,sort_order,release_date,duration_minutes,priority_on_release,link_label,link_url,archived
```

- Schlüssel bestehen aus Kleinbuchstaben, Zahlen, `_` und `-` und bleiben bei späteren Aktualisierungen stabil.
- `release_date` verwendet `JJJJ-MM-TT`.
- Leere Nummern sind ausdrücklich erlaubt und kennzeichnen Sonderfolgen.
- Mehrere Zeilen mit demselben Serien-/Folgen-Schlüssel dürfen verschiedene Links enthalten, müssen aber sonst identische Metadaten besitzen.
- Ohne expliziten Wert wird `priority_on_release` für zukünftige Termine aktiviert, für alte Folgen nicht.

## Online-Quellen

Unter **Bibliothek → Online-Quellen** lassen sich die offiziellen Kataloge von Die drei ??? und TKKG oder eine öffentliche Feed-URL hinzufügen. Der Erstimport ist immer eine Vorschau: Neue Folgen, mögliche Treffer und Konflikte müssen bestätigt oder ignoriert werden. Erst danach wird die tägliche Synchronisierung aktiviert.

Der interne Worker prüft minütlich, ob der tägliche Lauf fällig ist. Standardmäßig synchronisiert er um `04:15` Uhr in der mit `TZ` konfigurierten Zeitzone und holt einen nach einem Neustart verpassten Lauf nach:

```env
TZ=Europe/Berlin
IMPORT_SYNC_TIME=04:15
```

Jeder Abruf ist auf 15 Sekunden, 5 MB und fünf Weiterleitungen begrenzt. Nur öffentliche HTTPS-Ziele ohne Zugangsdaten sind erlaubt; private, Loopback-, Link-Local- und Metadaten-Adressen werden bei jeder Weiterleitung erneut blockiert. Leere Antworten, doppelte externe IDs, starke Mengenabweichungen und mehr als 20 neue Einträge stoppen die Automatik. Entfernte Quelleinträge löschen oder archivieren niemals vorhandene Folgen.

Unterstützte Feedformate:

- **CSV:** dieselben Spalten wie beim Dateiimport; `episode_key` ist die stabile externe ID. Alle Zeilen müssen zur gewählten Zielserie gehören.
- **JSON:** ein Objekt mit `version: 1` und `episodes[]`. Pro Folge sind `external_id` und `title` Pflicht. Optional sind `number_label`, `sort_order`, `release_date`, `duration_minutes`, `priority_on_release`, `canonical_url` und `links: [{label,url}]`.
- **RSS/Podcast:** `guid`, ersatzweise der kanonische Item-Link, wird als externe ID verwendet. `pubDate`, Enclosure, Item-Link und `itunes:duration` werden übernommen. Titel wie `Folge 123: …` liefern zusätzlich eine Nummer.

Beispiele: [`examples/online-feed.json`](examples/online-feed.json), [`examples/online-feed.rss`](examples/online-feed.rss) und [`examples/episodes.csv`](examples/episodes.csv).

Metadatenänderungen an bereits verknüpften Folgen erscheinen als Vorschlag und werden erst nach Bestätigung übernommen. Neu entdeckte Folgen seit Einrichtung der Quelle werden automatisch angelegt, sofern der Lauf eindeutig und unauffällig ist. Die Neuerscheinungs-Priorität gilt auch bei einem verspäteten Sync.

## Bewertungen

Nach **Gehört** wird der Abschluss sofort gespeichert und anschließend optional eine Bewertung von 1 bis 10 angeboten. Bewertungen lassen sich im Verlauf nachtragen, ändern oder entfernen. Jede Runde besitzt ihre eigene Bewertung; korrigierte Abschlüsse behalten den historischen Wert, werden aber nicht mehr bearbeitet oder ausgewertet. Bulk-Markierungen sind nicht bewertbar und Bewertungen verändern die Zufallsauswahl nicht.

## Backup und Wiederherstellung

```sh
chmod +x scripts/backup.sh scripts/restore.sh
./scripts/backup.sh /srv/backups/hoerspielbeutel
./scripts/restore.sh /srv/backups/hoerspielbeutel/hoerspielbeutel-YYYYMMDDTHHMMSSZ.dump
```

Die Wiederherstellung ersetzt den Inhalt der Anwendungsdatenbank. Vorher sollte zusätzlich eine Kopie des aktuellen Dumps angelegt werden.
Während der Wiederherstellung stoppt das Skript App und Import-Worker, führt den Restore in einer Transaktion aus, wendet fehlende Migrationen an und startet beide wieder.

## Interne JSON-API

Die Oberfläche verwendet authentifizierte, nicht gecachte Endpunkte unter `/api`. Dazu gehören Ziehung und aktiver Zustand, Gehört/Skip/Bewertung, Rundenreset, Serien, Folgen, einzelne Hörlinks, Presets, CSV-Vorschau und -Commit, Online-Quellen mit Laufhistorie und Vorschlägen, Verlauf mit Korrektur sowie Analytics. Schreibzugriffe akzeptieren ausschließlich Anfragen mit passender `Origin` und einer gültigen Sitzung.

Bei Quellenfehlern zuerst `docker compose logs --tail=200 import-worker` und die Laufhistorie in der Bibliothek prüfen. Ein fehlerhafter Parser verändert keine Katalogdaten; nach einer externen HTML-Änderung kann die Quelle pausiert bleiben, bis der Adapter aktualisiert wurde.

## Lokale Entwicklung

Node.js 24 und eine PostgreSQL-18-Datenbank werden benötigt. Nach dem Setzen von `DATABASE_URL`, `SESSION_SECRET`, `SETUP_TOKEN` und `APP_ORIGIN=http://localhost:3000`:

```sh
npm ci
npm run db:migrate
npm run dev
```

Qualitätsprüfungen:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Integrationstests verwenden eine separate `TEST_DATABASE_URL`; E2E-Tests erwarten eine vollständig gestartete Testinstanz unter `PLAYWRIGHT_BASE_URL`. Parser- und Feedtests verwenden feste Fixtures und benötigen keinen Live-Zugriff auf fremde Seiten. Ein bewusster Live-Smoke-Test der beiden offiziellen Adapter kann mit `LIVE_IMPORT_TEST=1 npm test -- live-import-smoke` gestartet werden und gehört absichtlich nicht zur CI.
