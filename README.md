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
- CSV-Import mit Vorschau und vollständigem Rollback bei Fehlern
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

   Der einmalige Migrationsdienst beendet sich erfolgreich; App und Datenbank bleiben aktiv. Die Datenbank besitzt keinen veröffentlichten Host-Port.

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

## Backup und Wiederherstellung

```sh
chmod +x scripts/backup.sh scripts/restore.sh
./scripts/backup.sh /srv/backups/hoerspielbeutel
./scripts/restore.sh /srv/backups/hoerspielbeutel/hoerspielbeutel-YYYYMMDDTHHMMSSZ.dump
```

Die Wiederherstellung ersetzt den Inhalt der Anwendungsdatenbank. Vorher sollte zusätzlich eine Kopie des aktuellen Dumps angelegt werden.
Während der Wiederherstellung stoppt das Skript die App kurz, führt den Restore in einer Transaktion aus, wendet fehlende Migrationen an und startet sie wieder.

## Interne JSON-API

Die Oberfläche verwendet authentifizierte, nicht gecachte Endpunkte unter `/api`. Dazu gehören Ziehung und aktiver Zustand, Gehört/Skip, Rundenreset, Serien, Folgen, einzelne Hörlinks, Presets, CSV-Vorschau und -Commit, Verlauf mit Korrektur sowie Analytics. Schreibzugriffe akzeptieren ausschließlich Anfragen mit passender `Origin` und einer gültigen Sitzung.

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

Integrationstests verwenden eine separate `TEST_DATABASE_URL`; E2E-Tests erwarten eine vollständig gestartete Testinstanz unter `PLAYWRIGHT_BASE_URL`.
