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
- Serien mit Name und Folgenanzahl anlegen: Folgen 1 bis N sind sofort ziehbar
- Folgennummer im Mittelpunkt; Online-Suche und optionale Angaben direkt bei der Ziehung
- Suche, Filter, Bulk-Status und endgültiges Löschen von Folgen und Serien
- Löschen entfernt auch zugehörigen Verlauf, Bewertungen und Notizen für alle Nutzer; beim Löschen einer Serie werden auch deren Importquellen entfernt
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

Nach einem erfolgreichen Qualitätslauf für einen Push auf `main` kann die GitHub Action **Deployment** diese Aktualisierung automatisch auf der VPS ausführen. Dafür werden folgende Repository-Secrets benötigt:

- `DEPLOY_HOST`: Hostname der VPS
- `DEPLOY_USER`: SSH-Benutzer mit Zugriff auf Docker und das Repository
- `DEPLOY_SSH_KEY`: privater SSH-Schlüssel für diesen Benutzer
- `DEPLOY_KNOWN_HOSTS`: mit `ssh-keyscan -H <hostname>` geprüfter Host-Schlüssel
- `DEPLOY_PATH`: absoluter Pfad des Repositorys auf der VPS

Fehlt eines dieser Secrets, wird das Deployment mit einem Hinweis übersprungen. Die Action verwendet ausschließlich Fast-Forward-Updates und bricht bei lokalen Änderungen auf der VPS ab.

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

**Sherlock Holmes – Titania Medien** ist ebenfalls als Apple-Music-Quelle verfügbar. Die tägliche Synchronisierung erfasst neue Einzelveröffentlichungen dieser Reihe. Auf mehrere Alben verteilte Folgen werden mit allen Teil-Hörlinks als eine Folge importiert; Sammelboxen bleiben außen vor. Unvollständige Mehrteiler stoppen die automatische Übernahme zur Prüfung.

Zusätzlich stehen Apple-Music-Kataloge für **Professor van Dusen – Originalserie**, **Professor van Dusen – Die neuen Fälle**, **Point Whitmark** und **Pater Brown (Maritim)** zur Auswahl. Sie übernehmen nummerierte Einzelalben mit Titel, Veröffentlichungsdatum und Hörlink aus dem deutschen Katalog; Sammelboxen werden ausgelassen. Bei van Dusen bleiben die beiden Nummernkreise durch separate Quellen getrennt. Der Katalog enthält nicht zwingend alle jemals erschienenen Folgen. Bei Erreichen des API-Limits von 200 Alben wird die Automatik zur Prüfung gestoppt.

Live-Prüfung dieser Quellen: `LIVE_IMPORT_TEST=1 npm test -- live-apple-catalog-smoke`.

Unter **Bibliothek → Online-Quellen** lassen sich die offiziellen Kataloge von Die drei ??? und TKKG oder eine öffentliche Feed-URL hinzufügen. Die TKKG-Quelle umfasst auch die 96 offiziell wiederveröffentlichten Folgen des Retro-Archivs; die drei nicht neu veröffentlichten Folgen 19, 20 und 37 fehlen entsprechend auch hier. Der Erstimport ist immer eine Vorschau: Neue Folgen, mögliche Treffer und Konflikte müssen bestätigt oder ignoriert werden. Erst danach wird die tägliche Synchronisierung aktiviert.

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

Die manuelle Prüfung zeigt für jede Änderung die bisherigen und vorgeschlagenen Werte, einschließlich Hörlinks. Metadatenänderungen lassen sich einzeln oder gemeinsam auswählen und in einer Transaktion annehmen oder ablehnen. Fehlende Quellenangaben löschen keine vorhandenen Metadaten; ein Update priorisiert eine bereits importierte Folge nicht erneut. Der Abgleich ignoriert JSON-Feld- und Linkreihenfolgen. Migration `0006` bereinigt bestehende Fehlmeldungen aus dem früheren Hashvergleich, ohne Folgen zu ändern. Auch alte Hörspiele können echte Katalogkorrekturen oder neue Hörlinks erhalten; diese bleiben sichtbar und bestätigungspflichtig.

## Bewertungen

Unter **Bibliothek → Gezielt hören** lässt sich eine bestimmte Folge auswählen und nach dem Hören mit optionaler Bewertung speichern. Manuelle Hördurchläufe zählen in Hörzeit, Aktivitätsdiagramm, Streaks und Bewertungen. Die Folge ist danach in der aktuellen Runde gehört. Wiederholungen zählen als weitere Hördurchläufe, ohne den Rundenfortschritt mehrfach zu erhöhen. Eine andere aktive Ziehung bleibt offen; ist die gewählte Folge selbst aktiv, wird diese Ziehung abgeschlossen. Im Verlauf sind diese Einträge als **Manuell** gekennzeichnet und können korrigiert werden. Bulk-Statusänderungen zählen weiterhin nicht als echte Hördurchläufe.

Wird die Laufzeit einer Folge nachträglich ergänzt, zählt sie auch für frühere Hördurchläufe, bei denen noch keine Laufzeit gespeichert war: in der gesamten Hörzeit, im Zeitdiagramm und in der Serienstatistik. Bereits beim Hören gespeicherte Laufzeiten bleiben maßgeblich. Die Ergänzung gilt für jeden früheren Hördurchlauf dieser Folge; rückgängig gemachte Abschlüsse und Bulk-Markierungen bleiben aus der Statistik ausgeschlossen.

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

Online-Quellen lassen sich pausieren oder endgültig löschen. Löschen entfernt die Quelle mit ihren Läufen, Vorschlägen und Zuordnungen; importierte Folgen, Hörlinks und Hörverlauf bleiben erhalten. Während eines laufenden Abrufs ist das Löschen gesperrt. Für einzeln gelöschte Importfolgen werden nur die externen Kennungen als Ausschluss gespeichert, damit dieselbe Quelle sie nicht erneut anlegt. Beim Löschen der Quelle verschwinden auch diese Ausschlüsse.
