# Custom AI: kombinierbare Regeln und ein klarer Launch

Stand: 23. Oktober 2026. Planungsgrundlage: Commit b28841a873b31a815cfd13e4d139af013b272d95 und die lokale Abnahmeprüfung vom selben Tag. Dieses Dokument beschreibt das Ziel; es behauptet keine vorhandene Produktionsfreigabe.

## Nutzerziel

Ein Nutzer beschreibt eine Coin-Idee in normaler Sprache. Der Chat setzt alle vereinbarten Regeln zusammen um, prüft sie selbst und zeigt eine kurze Zusammenfassung mit einem eindeutigen Launch-Button. Der Nutzer bearbeitet keine technischen Checklisten und richtet keine Datenanbieter, Relayer oder Vertragsbausteine ein.

Referenz: 10 % Swap-Gebühr mit einem Verlauf über zehn Minuten, anschließend eine wetterabhängige Regel für London und Wiederanlage der dafür bestimmten Gebühren als Pool-Liquidität. Die Regeln müssen zusammen funktionieren. Eine Umsetzung nur der Gebührenkurve erfüllt den Auftrag nicht.

Wesentliche Unklarheiten werden mit einer konkreten Frage geklärt. Der Chat bietet nach Möglichkeit eine verständliche vollständige Auslegung an. Gebühren, Empfänger und Verteilung werden nie stillschweigend erfunden. Die abschließende Launch-Handlung bestätigt die sichtbare, unveränderte Konfiguration; es gibt keine zusätzliche Pflicht-Checkbox.

Gleichrangiges Nutzerziel: Das Team muss die AI laufend verbessern und Fähigkeiten wie Hook-Suche, neue APIs und zusätzliche Regeln mit kleinen Änderungen ergänzen können. Erweiterbarkeit und kurze, verlässliche Update-Wege sind Teil der Produktabnahme. Eine kleine Erweiterung darf keinen Umbau des gesamten Chats oder eine erneute vollständige Finanzfreigabe auslösen.

## Tatsächlicher Ausgangspunkt

- Gesprächsspeicherung, Überarbeitung vorhandener Entwürfe, Streaming, begrenzte Recherche, Gebührenprüfungen und wiederaufnehmbare Wallet-Schritte existieren.
- `lib/custom-ai/feed.ts` schließt Zeitregeln zusammen mit Ereignissen ausdrücklich aus.
- `lib/custom-ai/program.ts` kennt nur Ausschüttung, Staking und Buyback.
- `CustomAILiquidityVaultV1` nimmt die Startposition einmalig auf. Er hat keine Funktion für nachträgliches Auffüllen.
- `CustomAIHookV1.getHookPermissions()` registriert keine Einschränkung zusätzlicher Liquiditätspositionen. Eine getrennte, gesperrte Zusatzposition im selben Pool ist deshalb der bevorzugte Ansatz. Die Kompatibilität ist im echten Core zu prüfen.
- Der aktuelle Ablauf verlangt eine Regel-Checkbox und hat getrennte Wallet-Schritte für Programm, Modul, Wrapping, Freigabe und Launch.
- Der lokale Anthropic-Test scheiterte an unzureichendem Guthaben. Daraus folgt keine Aussage über jeden produktiven Zugang.
- Die bisherige Änderung hat keinen Londoner Datenfeed oder dauerhaften Ausführungsdienst in Betrieb genommen.

## Technische Entscheidung

Empfehlung: Die AI übersetzt Sprache in eine versionierte, typisierte Regelbeschreibung. Ein deterministischer Compiler verbindet daraus die geprüften Zeit-, Daten- und Gebührenbausteine. Geldbewegungen bleiben in eng begrenzten, geprüften Verträgen. Die UI, Tests, Vertragskonfiguration und Launch-Bindung beziehen sich auf dieselbe Beschreibung.

Verglichene Ansätze:

1. Weitere einzelne Spezialvorlagen ergänzen: kleinster Umbau, aber jede neue Kombination erzeugt wieder eine Sonderlösung. Erfüllt das Kombinationsziel nicht.
2. Frei erzeugtes Solidity auch für Geldverwahrung und externe Aufrufe: ausdrucksstark, aber jede Ausgabe verlangt eine neue umfassende Sicherheitsprüfung. Passt nicht zum schnellen Standardpfad.
3. Komponierbare Regelbeschreibung mit deterministischer Übersetzung und geprüften Geldaktionen: empfohlener Standardpfad. Bestehende unterstützte Zeit- und Gebührenentwürfe dürfen dadurch keine Funktionen verlieren.

Außerhalb des unterstützten Vokabulars wird eine Idee vollständig gespeichert und konkret als noch nicht ausführbar erklärt. Sie wird weder vereinfacht noch mit einem grünen Status versehen. Neue Fähigkeiten erweitern künftig das Vokabular und seine Tests.

## Einfache Erweiterung und laufende Verbesserung

Die Struktur bleibt im bestehenden Repository. Ein kleiner gemeinsamer Ablauf verarbeitet Chat, Planung, Prüfung und Launch. Ein statisch registrierter Fähigkeitskatalog liefert die Erweiterungen. API-Zugriffe liegen bei der jeweiligen Fähigkeit und verwenden die vorhandenen gemeinsamen HTTP-/Fehlerfunktionen. Ein separater Erweiterungsserver, dynamisch geladenes Fremdprogramm oder eigener Plugin-Marktplatz ist dafür nicht nötig.

Jede Fähigkeit hat einen eigenen Ordner mit Beschreibung, Ein-/Ausgabeformat, Implementierung und wenigen fachlichen Beispielen. Vier feste Arten genügen zunächst: Recherchewerkzeug, Datenfeed, Regelbaustein und Geldaktion. Neue Einträge innerhalb einer Art erfordern keinen neuen Ablauf im zentralen Chat. Die AI erhält die verfügbaren Werkzeuge und Beschreibungen aus diesem Katalog; keine zweite handgeschriebene Funktionsliste im Prompt oder UI.

Der Katalog definiert Fähigkeit und Version; Netzwerkfreigabe und tatsächliche Betriebsbereitschaft werden daraus zusammen mit der laufenden Konfiguration bestimmt. Eine installierte, aber nicht angeschlossene API wird nicht als verfügbar angeboten. Relevante Werkzeuge werden passend zum Auftrag ausgewählt, damit ein wachsender Katalog nicht jeden Prompt aufbläht. Suche liefert belegte Informationen; ihre Ergebnisse erhalten dadurch keine Berechtigung zur Ausführung von Verträgen.

Antwortstil, Modelleinsatz und Planungsanweisungen haben eine eigene, versionierte AI-Konfiguration. Sie können aktualisiert werden, ohne Gebührenarithmetik, Geldverwahrung oder Wallet-Autorisierung anzufassen. Feste Produktregeln bleiben im ausführenden Kern erzwungen. Die Konfiguration erweitert keine Berechtigungen.

Ein normaler neuer API-/Suchbaustein berührt nach dem einmaligen Umbau nur seinen Ordner, einen Registrierungseintrag und gegebenenfalls die zugehörige Betreiberkonfiguration. Bestehende Aufträge speichern ihre verwendeten Versionen. Eine neue Version gilt für neue Arbeit; sie schreibt weder einen laufenden Launch noch einen bereits veröffentlichten Coin um. Ein Update kann für neue Aufträge deaktiviert und auf die vorherige Version zurückgesetzt werden. Onchain veröffentlichte Verträge und die Versorgung alter Coins bleiben ausdrücklich separat erhalten.

### Prüfung passend zur Änderung

Ein bestehender CI-Ablauf ermittelt aus den geänderten Dateien und ihren Abhängigkeiten die nötigen Prüfungen. Die Einstufung darf nicht allein einer Selbstauskunft der Erweiterung vertrauen. Ergebnisse werden für denselben unveränderten Stand wiederverwendet; keine zweite manuelle Abarbeitung derselben Prüfung.

| Änderung | Nötiger Prüfbereich |
| --- | --- |
| Reine Darstellung | Bestehender Präsentationsweg und Sichtprüfung; keine neuen Tests auf CSS-Werte oder Wortlaut |
| Antwortstil, Modell, Planer | Betroffene Antwort-/Intent-Beispiele und kurzer Chat-Durchlauf |
| Neue lesende Suche/API | Adapter, Eingabe-/Ausgabeformat, Fehler/Timeout, Werkzeugauswahl und Integration in den Chat |
| Datenfeed oder Regelbaustein | Zusätzlich Frische, Semantik, betroffene Kombinationen und zugehörige Vertragsausführung |
| Geldaktion, Signatur, Verwahrung oder Core | Betroffene Finanz-/Wallet-Prüfungen, Versionsbindung und erforderliche Netzwerknachweise |

Gemeinsame Laufzeit-, Berechtigungs- oder Compileränderungen erweitern den Prüfbereich automatisch auf ihre Nutzer. Unklare Auswirkungen werden sichtbar und fachlich passend geprüft. Eine reine Such- oder Promptänderung benötigt keine neuen finanzierten Launches. Die umfangreiche Erstabnahme des neuen Liquiditätspfads ist kein wiederkehrender Pflichtprozess für jede AI-Verbesserung.

### Lernen aus Fehlern und Nachweis der einfachen Struktur

Ein relevanter Fehler oder eine Nutzerkorrektur wird als bereinigtes Beispiel mit erwartetem Verhalten in die vorhandene Beispielsammlung aufgenommen. Das Team passt Fähigkeit oder AI-Konfiguration an, prüft alte und neue Fälle und veröffentlicht die gezielte Änderung. Das Produkt schreibt seine eigenen Regeln nicht ungeprüft um. Laufzeit, Fehler und Kosten werden mit der verwendeten Version erfasst; private Gesprächsinhalte und Schlüssel gehören nicht in öffentliche Fixtures.

Abnahme der Erweiterbarkeit: Nach Fertigstellung des gemeinsamen Ablaufs wird exemplarisch `search_hooks` mit einem festen Testkatalog ergänzt. Dafür dürfen Chat-Orchestrierung, Launch-UI, Wallet und Verträge nicht angepasst werden. Ein API-Ausfall betrifft die abhängigen Fähigkeiten; unabhängige Entwürfe funktionieren weiter. Ein zweiter Test ändert nur die AI-Konfiguration und weist nach, dass keine Vertragsfreigabe ausgelöst wird. Echte Suchverfügbarkeit wird erst mit angeschlossener Quelle behauptet.

## Funktionsumfang

### Regeln

- Kauf- und Verkaufsgebühren, feste Werte, lineare Verläufe, Stufen, Startverzögerung, Laufzeit und Wiederholung.
- Kombination mit numerischen Schwellen, benannten Zuständen und Zustandswechseln eines angebundenen Feeds.
- Explizite Reihenfolge und Priorität: erst eine Zeitphase, danach eine Ereignisphase; UND, ODER und NICHT innerhalb begrenzter Bedingungen.
- Ein Zustandswechsel ist ein eigenes Ereignis mit Identität und Zeitpunkt. Er ist nicht gleichbedeutend mit einem unveränderten, wiederholt gemeldeten Zustand. Eine separate Übergangssequenz bleibt bei solchen Wiederholungen gleich. Ereignisaktionen besitzen ein definiertes Ausführungsfenster; überholte oder verfallene Ereignisse werden nach einem Ausfall nicht blind nachgeholt.
- Zuweisung zusätzlicher Gebühren zu Creator, Ausschüttung, Staking, Buyback und gesperrter Zusatzliquidität. Mehrere Anteile dürfen zusammen verwendet werden; ihre Summe ist exakt 100 %.
- Wiederholungen, Rundung, Grenzwerte und Verhalten bei fehlenden Daten sind Bestandteil der gespeicherten Regel.

### Feste Produktregeln

- 1.000.000.000 Token, 18 Dezimalstellen, kein späteres Minting, kein Burn, keine Blacklist, kein Pause-Schalter und keine Transfersteuer.
- Gesamtgebühren von mindestens 0,5 % und höchstens 15 %; die feste Plattformkomponente beträgt 0,5 %. Zusätzliche Protokollgebühren dürfen die Obergrenze nicht umgehen.
- Start-FDV gemäß bestehendem Core: 15.000 USD, einschließlich vorhandener Tick-Rundungsgrenze bis 15.091,50 USD.
- Die Startliquidität bleibt dauerhaft gesperrt. Neue Zusatzpositionen werden ebenfalls dauerhaft gesperrt.
- Ethereum (1) und Robinhood (4663) werden separat geprüft. Weitere Netzwerke werden nicht aus diesen Nachweisen abgeleitet.
- Bestehende Coins und aktive Wallet-Journale bleiben mit ihren ursprünglichen Vertragsversionen lesbar und wiederaufnehmbar.
- Fehlt ein in der aktiven Gebührenphase benötigtes gültiges Datum, beträgt die Gesamtgebühr 0,5 %. Eine vorherige reine Zeitphase bleibt von einem dort unbenutzten Feed unabhängig.
- Kein Ausfall einer Geldaktion oder eines Keepers darf den normalen Verkauf blockieren.
- Operatoren erhalten weder Zugriff auf Wallet-Schlüssel noch beliebige Aufrufe, unbegrenzte Tokenfreigaben oder Zugriff auf LP-Prinzipal.

### Daten und laufender Betrieb

Der Plattformbetrieb übernimmt Anbietervertrag, Abfrage, Normalisierung, Signatur, Onchain-Übertragung, Gasversorgung, Wiederaufnahme und Alarmierung. Der Nutzer entscheidet über die gewünschte Bedingung, nicht über Anbieter-Schlüssel.

London ist der erste vollständige Referenzfeed. Ort, Größe, Einheit, Beobachtungszeit, Gültigkeit, Quellenversion und Datenart (Messung, Modell oder Prognose) werden fest gebunden. Wiederholtes Abrufen desselben alten Wertes macht ihn nicht frisch. Signaturen belegen den Reporter; sie beweisen nicht die Wahrheit des Wetters.

Open-Meteo eignet sich als Kandidat für die technische Erprobung. Seine aktuellen Bedingungen beruhen laut [Dokumentation](https://open-meteo.com/en/docs) auf Wettermodelldaten; die angebotenen Zeitraster sind keine Garantie minutengenauer Beobachtungen. Für kommerziellen Betrieb gelten die [Anbieterbedingungen](https://open-meteo.com/en/pricing). Vor Aktivierung muss der Plattformbetrieb einen geeigneten Datenvertrag und eine ehrliche Aktualitätsregel festlegen. Falls echte Beobachtungen verlangt werden, darf eine Modellquelle diese nicht still ersetzen.

Vorgeschlagener erster Betriebsmodus: feste, veröffentlichte Quelle mit eindeutigem Reporter und Reservebetrieb derselben Semantik. Ein Anbieterwechsel mit anderer Bedeutung wird als neue Feed-Version behandelt. Wetterwechsel wirken nach Veröffentlichung und Onchain-Bestätigung, nicht rückwirkend zum hypothetischen ersten Regentropfen.

## Gebühren zu Liquidität

Ein neuer `CustomAILiquidityProgramV1` erhält ausschließlich den vereinbarten Anteil bereits vereinnahmter Zusatzgebühren. Er kauft begrenzt die benötigte Gegenseite und fügt beide Token einer zusätzlichen Position im selben kanonischen Pool hinzu. Die Position ist nicht übertragbar und besitzt keine Funktion zum Abziehen des Prinzipals.

Ausführungen haben Batch-Obergrenze, Mindest-Liquiditätszuwachs, Zeitgrenze, Preis- und Slippage-Grenze. Das Programm akzeptiert nur eine frische, zur konkreten Ausführung gehörende Preisreferenz aus einem geprüften Beobachter. Eine einzelne manipulierbare Spot-Abfrage genügt nicht. Fehlt die erforderliche Referenz oder ausreichende Historie, bleibt das Geld erhalten und die Wiederanlage wartet. Aufrufer können die vertraglichen Preisgrenzen nicht durch lockere Parameter umgehen. Wetterbedingungen für Geldaktionen werden ebenfalls onchain überprüft.

Ausführung und vollständige Abrechnung erfolgen atomar. Restbeträge bleiben dem Programm zurechenbar. Plattformgebühren, Creator-Anteile und Staking-Prinzipal sind ausgeschlossen. Wiederholte Ausführungsaufträge und Reorganisationen erzeugen keine doppelte Auszahlung. Auch die zusätzlichen Gebühren eines internen Kaufs müssen korrekt abgerechnet werden, ohne rekursive Wiederanlage.

Der bestehende Core bleibt zunächst unverändert. Die neue Regel-, Verteiler- und Liquiditätsversion wird für neue Launches separat gebunden. Eine Erweiterung des Core wird nur nötig, falls die gezielten Integrationsnachweise eine echte Schnittstellengrenze zeigen; sie wäre eine neue, getrennt auszurollende Core-Version.

## Produktoberfläche und Bereitschaft

Sichtbarer Normalablauf:

1. Idee beschreiben oder vorhandene Idee ändern.
2. Eine kompakte Rückmeldung während der Arbeit; keine technischen Freigaben.
3. Kurze, überprüfbare Regelzusammenfassung und genau eine primäre Aktion.
4. `Ready to launch` / `Launch coin`, danach notwendige Wallet-Autorisierung.
5. `Launching…`, anschließend Link zum bestätigten Coin.

Die bestehende englische Produktsprache bleibt erhalten. Deutschsprachige Wünsche werden vollständig verstanden.

Interne Zustände: `needs-input`, `working`, `blocked`, `ready`, `signing`, `confirming`, `live`. Gründe und Prüfdetails sind bei Bedarf einsehbar.

`ready` setzt voraus: vollständige Anforderungen, passende Vertragsartefakte und Simulationen, aktivierte Netzwerkversion, gebundene und frische Datenfeeds, betriebsbereite Ausführung für automatische Aktionen, Preis/Quote/Token-Verträglichkeit, vollständige Metadaten und eine gültige Launch-Vorbereitung. Wallet-Guthaben und tatsächliche Gasbereitschaft werden nach Verbindung und nochmals vor Signatur überprüft.

Ohne verbundene Wallet darf eine fertige Konstruktion `Design ready` heißen; sie erhält keinen unberechtigten Status einer signierbaren Transaktion. Kurze Preisbelege werden erst kurz vor der Signatur ausgestellt. Kein nutzerseitiger Refresh-Marathon.

Jede Bestätigung bindet Regelrevision, Spezifikationshash, Quellcode, Programmversionen, Netzwerk, Paar, Empfänger und Beträge. Eine neue Änderung entwertet alte Bereitschaft. Während eines begonnenen Launches bleibt dessen eingefrorene Konfiguration separat erhalten.

Wallet-Bündelung wird nach [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792) erkannt und genutzt, sofern die vollständige Transaktionssemantik unterstützt ist. Der Fallback behält denselben einen Produktoberflächen-Ablauf und die bestehenden Journale. Es wird keine universelle einzelne Wallet-Signatur versprochen; unvermeidbare Freigaben werden nicht versteckt.

## Geschwindigkeit und Zuverlässigkeit

Dies sind vorgeschlagene Abnahmeziele, keine gemessenen Leistungen und keine Entwicklungsdauer:

- Erste sichtbare UI-Reaktion: p95 unter 300 ms.
- Erste inhaltliche AI-Rückmeldung: p95 unter 3 s bei verfügbarer Provider-Kapazität.
- Unterstützte Standardkombination fertig konstruiert und geprüft: p95 unter 15 s warm, unter 30 s kalt, ohne Nutzerantworten, Wallet-Bestätigung oder Chain-Finalität.
- Fehlerantwort bei bekannt gesperrtem Provider vor teurer Reservierung oder Wiederholung.
- Fortschritt ohne festhängende Anzeige; Abbruch, Reload und Wiederaufnahme behalten die Arbeit.
- Getrennte Messung für Provider-Zeit, Planung, Kompilierung, Simulation, Live-Abfragen, Signatur und Bestätigung.

Bestehende geprüfte Artefakte werden nach exakter Konfiguration wiederverwendet. Unabhängige Prüfungen laufen parallel. Neue oder geänderte Daten werden erneut geprüft; alte Preise und alte Beobachtungen werden nicht durch Caching verlängert.

Provider-Budgetfehler, ungültige Zugangsdaten, Ratenlimit, Timeout und Stream-Abbruch werden getrennt behandelt. Nur bestätigte, sichere und begrenzte Wiederholungen laufen automatisch. Ein unklar abgeschickter Wallet-Auftrag wird zuerst rekonstruiert. Produktseitiges Guthaben wird bei einem bestätigten Infrastrukturfehler genau einmal freigegeben; interner Provider-Verbrauch wird separat bilanziert.

Die [Anthropic-Fehlerdokumentation](https://platform.claude.com/docs/en/api/errors) und die tatsächlich beobachtete Fehlermeldung sind die Grundlage für Fehlerklassifizierung; ein HTTP-200-Stream kann später noch fehlschlagen.

## Konkreter Abnahmefall

Die folgenden Zusatzwerte sind ein vorgeschlagenes Testfixture, keine vom Nutzer beauftragte wirtschaftliche Konfiguration:

- Start 10 % Gesamtgebühr auf Kauf und Verkauf.
- Linear auf 1 % innerhalb von 600 Sekunden; danach 5 % bei gemeldetem Regen in London, sonst 1 %.
- Bei ungültigem Wetterdatum nach Sekunde 600: 0,5 %.
- 100 % der Zusatzgebühren gehen in gesperrte Zusatzliquidität.
- Die Plattformkomponente von 0,5 % wird separat verbucht.
- Technische Wiederanlagegrenzen werden vor dem finanzierten Versuch explizit im Testauftrag festgelegt.

Rundung der Zeitphase in Basispunkten: `1000 - floor(900 * min(elapsed,600) / 600)`.

| Zeitpunkt / Zustand | Gesamtgebühr |
| --- | --- |
| 0 s | 10 % |
| 300 s | 5,5 % |
| 599 s | 1,02 % |
| 600 s, kein Regen | 1 % |
| 600 s, Regen | 5 % |
| nach 600 s, Daten veraltet | 0,5 % |

Zusätzlich: Regen endet, wiederholter Wetterwert, echter Zustandswechsel, geänderte Regel bei Minute 5, Browser-Reload, Provider-Abbruch, falsches Netzwerk, Reorganisation, leere Gebühren, minimaler Betrag und manipulierte Preisreferenz. Ein zweites Fixture bindet die Geldaktion selbst an einen Wetterwechsel, damit nicht nur die Gebühren wetterabhängig sind.

Abnahme erfolgt in vier getrennten Ebenen: deterministische Tests, echter Core/Pool im lokalen oder Fork-Lauf, finanzierter Canary je freigegebenem Netzwerk und öffentlicher Produktdurchlauf. Kein einzelner Teil ersetzt die anderen.

## Umsetzung und offene Betreiberentscheidungen

Die Aufgaben stehen im zugehörigen Implementierungsplan. Der Plan benötigt keine zusätzlichen Nutzerentscheidungen, um mit Regeln, Compiler, UX und lokalen Tests zu beginnen.

Vor Inbetriebnahme werden konkret festgelegt: Produktionsquelle mit passender Wettersemantik, Provider-Finanzierung und Budgetalarme, signierende Betriebsidentitäten, Keeper-Gasbudget und wirtschaftliche Ausführungsgrenzen. Vor finanzierten Versuchen werden Netzwerk, Wallet, Maximalbetrag und Abbruchkriterien dokumentiert. Diese Planung kauft keine Dienste und startet keine Transaktionen.

