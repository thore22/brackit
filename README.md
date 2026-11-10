# Turnierleitung

Deutschsprachige Progressive Web App für Spielplanung, Schiedsgericht, Live-Ergebnisse und Tabellen. Die mitgelieferte Volleyballvorlage bildet 14 Teams auf zwei Spielfeldern ab. Andere Formate werden im Assistenten eingerichtet.

## Lokal starten

Voraussetzungen sind Node.js ab 22.13 und pnpm. Dieses Projekt wurde mit Node.js 24 und pnpm 11 geprüft.

```sh
pnpm install
pnpm dev
```

Öffne `http://127.0.0.1:5173`. Ohne Supabase-Variablen startet der lokale Arbeitsplatz mit der veröffentlichten Volleyballvorlage und leeren Ergebnissen. Im lokalen Modus werden Daten im Browser gespeichert. Tabs desselben Browserprofils erhalten Änderungen über Browserereignisse. Die geräteübergreifende Synchronisierung und die produktiven Rollenrechte stehen mit Supabase zur Verfügung. Die beiden Speicher sind getrennt. Exportiere lokale Daten bei Bedarf vor einem Wechsel.

Für die installierbare Fassung:

```sh
pnpm build
pnpm preview
```

## Supabase einrichten

### Lokale Supabase-Instanz

Installiere die Supabase CLI und starte Docker. Führe im Projektverzeichnis aus:

```sh
supabase start
supabase db reset
supabase status
```

`db reset` setzt die lokale Entwicklungsdatenbank auf den Migrationsstand zurück. Lege im lokalen Studio unter **Authentication → Users** einen Benutzer mit E-Mail und Passwort an und aktiviere ihn. Verwende für die App die ausgegebene API-URL und den Publishable Key beziehungsweise den lokalen Anon Key. Die Konfiguration in `supabase/config.toml` aktiviert anonyme Anmeldungen für Schiedsrichter.

### Gehostetes Supabase-Projekt

1. Erstelle ein Supabase-Projekt. Aktiviere E-Mail-Anmeldung und **Anonymous Sign-Ins** unter Authentication. Lege ein bestätigtes Administratorkonto an und beschränke öffentliche E-Mail-Registrierung entsprechend deinem Betrieb.
2. Verknüpfe die CLI und wende die Migrationen in `supabase/migrations/` an.

   ```sh
   supabase login
   supabase link --project-ref DEINE_PROJEKT_REFERENZ
   supabase db push
   ```

3. Kopiere `.env.example` nach `.env.local`. Trage beide Werte ein und starte Vite neu. `VITE_SUPABASE_URL` ist die Projekt-API-URL. `VITE_SUPABASE_PUBLISHABLE_KEY` ist der öffentlich vorgesehene Projekt-Schlüssel. Die App benötigt keinen Service-Role-Schlüssel. Lege DB-Passwörter und administrative Schlüssel außerhalb des Frontend-Builds ab.
4. Melde dich in der Turnierverwaltung mit dem eingerichteten Konto an. Das anlegende Konto bekommt die Admin-Rolle für sein Turnier. Ein anonymer Auth-Benutzer kann mit einer Feld-PIN oder mit einem spielbezogenen QR-Token samt PIN eine zeitlich begrenzte Schreibfreigabe für genau ein Spiel erhalten.

Die Migration legt `tournaments` in die Publikation `supabase_realtime`. Clients abonnieren die Turnierrevision und lesen nach einer Änderung einen konsistenten Datenbank-Snapshot. Die App liest außerdem nach Wiederverbindung, Fensterfokus und periodisch nach. Schreibvorgänge prüfen Auth-Rolle, Turnierzustand und erwartete Version. Spieloperationen protokollieren ihren Anfrage-UUID für idempotente Wiederholungen. Direktes Schreiben in die Tabellen ist für Browserrollen gesperrt. [Supabase Realtime](https://supabase.com/docs/guides/realtime/postgres-changes), [Supabase Auth für anonyme Benutzer](https://supabase.com/docs/guides/auth/auth-anonymous)

### Deployment und PWA

Baue die App mit den beiden Supabase-Variablen und stelle `dist/` über HTTPS bereit. Der Host muss Pfade wie `/t/<id>/live`, `/feld/<id>` und `/admin/<id>` an `index.html` weiterleiten. Vorhandene Dateien wie `sw.js`, das Manifest und die Icons müssen direkt ausgeliefert werden. Die App erwartet Bereitstellung im Root-Pfad der Domain. Hinterlege die öffentliche URL in den Supabase-Auth-Einstellungen. Erzeuge die QR-Codes auf der URL, die Smartphones in der Halle tatsächlich erreichen.

Auf iPhone und iPad öffnest du in Safari das Teilen-Menü und wählst **Zum Home-Bildschirm**. Auf Android und Desktop verwendest du die Installationsfunktion des Browsers. Die Produktionsfassung enthält Manifest, Standalone-Start, Icons und Service Worker. Das App-Gerüst wird vorab gespeichert. Besuchte veröffentlichte Turniere werden als letztes synchronisiertes Abbild im Browser vorgehalten. Bei Verbindungsverlust erscheint ein Offline-Hinweis. Eingaben in der Schiedsrichteransicht lassen sich als lokale Entwürfe sichern. Nach Wiederverbindung prüft die App die Spielversion und verlangt eine bewusste Übernahme des aktuellen Stands bei Konflikten.

Beim Start öffnet die App das zuletzt besuchte Live-Turnier. Die Auswahl unter **Spielplan → Team** bleibt für dieses Turnier gespeichert. In einer frischen Browser-Sitzung kannst du den Live-Link über **Turnier öffnen** eingeben oder den Zuschauer-QR scannen. Über das Logo der Live-Ansicht gelangst du zurück zu **Turnier öffnen** und von dort zur **Turnierverwaltung**.

## Turnierbetrieb

1. Öffne **Neues Turnier** und lade bei Bedarf die Volleyballvorlage. Trage Turniertag und Teamnamen ein. Teamlisten lassen sich als CSV oder Textdatei importieren.
2. Definiere Felder, Phasen, Gruppen, Qualifikation, Runden, Zielspielzahl, Zeitfenster und Wertung. Für Qualifikationen wählst du Rangplätze aus früheren Gruppen. **Plan erzeugen** prüft die Machbarkeit. Prüfe die Vorschau und speichere einen Entwurf oder veröffentliche direkt.
3. Starte Spiele in der Spielverwaltung. Bei Ablauf zeigt der Countdown zunächst die abgelaufene Spielzeit. Beende die reguläre Zeit in der Spielverwaltung. Wenn der Stand gleich ist und Unentschieden deaktiviert sind, wechselt der Status zum entscheidenden Zusatzpunkt. Ein abgelaufener Timer speichert kein Ergebnis.
4. Lege unter **QR-Codes** einen dauerhaften QR-Code pro Spielfeld an und drucke ihn zusammen mit dem Zuschauer-QR-Code aus. Der Feld-QR öffnet das laufende Spiel. Gib die achtstellige Feld-PIN separat weiter. Sie gilt zwölf Stunden und muss für jedes Spiel erneut eingegeben werden. Für ein späteres Turnier kannst du denselben QR-Code mit demselben Veranstalterkonto neu zuordnen. Eine neue Zuordnung oder PIN widerruft die Schreibfreigaben des Feld-QR. Spielbezogene QR-Zugänge sind weiterhin verfügbar.
5. Bestätige eingereichte Ergebnisse oder korrigiere sie. Die Standardvorlage wertet nur bestätigte Endstände. Bei vollständigen Quellgruppen werden Rangplätze automatisch aufgelöst. Die Folgephase wird von der Turnierleitung freigegeben. Ab dem Start einer Folgephase sind frühere Ergebnisse gegen Änderungen gesperrt.
6. Öffne **Hallenbildschirm** für die automatische Rotation im 16:9-Format. Der Bildschirm zeigt laufende Spiele, die nächsten zwei Slots und die Tabellen. Rotation und Vollbild lassen sich am Bildschirm steuern.
7. Exportiere den Spielplan als CSV oder drucke ihn. Einstellungen bieten JSON-Export, Teamlistenexport, Duplizieren und Archivierung nach Abschluss aller Spiele. Eine Duplikation kopiert die Konfiguration. Sie erzeugt einen unabhängigen Plan ohne alte Ergebnisse. Unbegonnene Begegnungen können innerhalb vorhandener Slots ihrer Phase umgelegt werden. Neue Regelsätze werden als Entwurf konfiguriert.

## Engine und Datenmodell

`src/engine/` enthält die von React und Supabase unabhängige TypeScript-Engine. `generate.ts` prüft Kapazität, Phasenregeln, Qualifikationen und Spielzahlen. `pairings.ts` berechnet Round-Robin-Begegnungen, exakte Spielgrade und logische Runden. `slots.ts` verwendet deterministisches Backtracking für gleichzeitige Feld- und Pfeifzuordnung. Feldpräferenzen, kürzere Serien und ausgeglichene Pfeifeinsätze beeinflussen die Suchreihenfolge. Ein erreichtes Suchlimit ist eine eigene Fehlermeldung. `validate.ts` prüft die erzeugten Zeit- und Ressourcenbelegungen. Neue Turniersysteme ergänzen Paarungslogik und Konfigurationsschema.

Die Version unterstützt Turniere an einem Kalendertag mit bis zu 80 Teams, 16 Feldern und zehn Phasen. Jede Gruppe hat zwei bis 32 Teilnehmer. Ergebnisübernahme über Rangplätze setzt eine vollständige Quellgruppe voraus. Die exakte Zielspielzahl setzt für aus einer Gruppe qualifizierte Teams gleich viele bisherige Spiele voraus. Die Vorlage verwendet fünf logische Klassenrunden und ein anschließendes Crossover. Die mathematische Herleitung steht in [Machbarkeit](docs/feasibility.md). Die [Spielplanmatrix](docs/example-schedule.md) lässt sich mit `pnpm matrix` reproduzieren.

PostgreSQL speichert getrennte Datensätze für Turniere, Konfigurationsversionen, Teams, Felder, Phasen, Gruppen, Qualifikationsplätze, Slots, Spiele, Belegungen, offizielle Ergebnisse, Einreichungen, QR-Zugänge und das Änderungsprotokoll. Benutzer kommen aus Supabase Auth. Ränge werden aus den offiziellen Ergebnissen berechnet. Übernahmen referenzieren bestehende Gruppenspiele. Das Crossover ist eine reguläre Begegnung ohne Tabellenzuordnung.

## Prüfungen

```sh
pnpm test
pnpm test:db
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Die Unit-Tests prüfen die Vorlage und weitere gültige und ungültige Formate. Der Datenbanktest spielt die Migrationen in PGlite ein, nutzt echte PostgreSQL-Rollen und RPCs und schließt die 49 Begegnungen ab. Der lokale Playwright-Test deckt Assistent, mobile Ansichten, QR- und Freigabeablauf, Tab-Synchronisierung, TV-Rotation und den Service Worker ab. Optional kann `PLAYWRIGHT_CHROMIUM_EXECUTABLE` auf einen vorhandenen Chromium-Browser zeigen.

Für einen Test mit echten getrennten Clients, Auth und WebSockets setze `TEST_BASE_URL`, `TEST_ADMIN_EMAIL` und `TEST_ADMIN_PASSWORD` und führe `pnpm test:e2e` aus. Verwende ein separates Testprojekt. Der Test legt dort ein veröffentlichtes Testturnier an. Der Betrieb mit einem Supabase-Projekt sowie die Installation auf physischen Mobilgeräten benötigen die entsprechende externe Umgebung.
