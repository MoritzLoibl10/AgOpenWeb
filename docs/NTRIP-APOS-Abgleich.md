# NTRIP: früherer APOS-Fix gegen upstreams neue Schicht (November 2026)

Der Fork-Fix (c698ca8b, ee1d3844, d6500287; „GGA für VRS-Caster (APOS) auch ohne RTK-Fix, NTRIP 1/2
wählbar, Caster-Antwort im Status“) ist mit dem Upstream-Abgleich (upstream bis f8ee280a) durch
upstreams NTRIP-Schicht (`Services/Ntrip/`, `NtripClientService`) ersetzt. Je Punkt: abgedeckt
oder nicht, mit Codestelle (Stand `feature/installer`). **Nichts geändert**, nur gemeldet.

| # | Fork-Fix | Upstream | Codestelle |
|---|---|---|---|
| 1 | GGA aus jedem Fix (Qualität > 0), nicht nur aus dem Lenk-Qualitätstor (`IsValid`) | abgedeckt | `NtripClientService.cs:670` `NextGgaSentence`, `:692` `HasFix` (Qualität > 0, Position ≠ 0,0) |
| 2 | Ohne Fix die letzte Position mit Fix, aber **höchstens 300 s alt** | teilweise: letzte Position ja, **ohne Altersgrenze** | `NtripClientService.cs:682` |
| 3 | Ohne jeden Fix **keine** GGA (nie eine erfundene Position) | anders: vor dem ersten Fix der **Ursprung des offenen Schlags**, sonst keine GGA (keine erfundene Position mehr, kein „Kansas“) | `NtripClientService.cs:684`, `MainViewModel.Ntrip.cs:112` |
| 4 | Erste GGA sofort bei Annahme, dann alle 10 s | abgedeckt: NTRIP 2.0 schon in der Anfrage (`Ntrip-GGA`), danach alle `GgaIntervalSeconds` (10) | `NtripRequest.cs:38`, `NtripSession.cs:161` |
| 5 | NTRIP 1: GGA **direkt nach der Anfrage** (manche VRS-Caster antworten erst mit Position) | **nicht abgedeckt**: GGA erst nach der Antwort | `NtripSession.cs:157` |
| 6 | GGA-Minuten runden nicht auf 60 (47° 59,99999' → 48° 00,0000') | **nicht abgedeckt**: `00.0000` ohne Übertrag, ergibt „60.0000“ | `NtripClientService.cs:761` (Länge analog) |
| 7 | NTRIP 2-Anfrage: `HTTP/1.1`, `Host`, `Ntrip-Version: Ntrip/2.0`; `User-Agent: NTRIP …` | abgedeckt | `NtripRequest.cs:31–35` |
| 8 | Version pro Profil wählbar (Standard 1) | ersetzt: erst 2.0, bei „nicht verstanden“ einmal 1.0; die Version, die geliefert hat, wird je Dienst gemerkt | `NtripConnection.cs:64`, `NtripSession.cs:81` |
| 9 | NTRIP 2 „200 OK“ mit `Content-Type: …sourcetable` = Mountpoint unbekannt | abgedeckt (auch am Inhalt erkannt) | `NtripResponse.cs:61` |
| 10 | Einzeilige NTRIP 1-Ablehnung („ERROR - Bad Password“ ohne Leerzeile, dann Schließen) und „ICY 401“ beenden statt endlos neu zu versuchen | abgedeckt: unvollständiger Kopf wird bewertet, Text mit „password“/„unauthor“ → Anmeldung abgelehnt (Ende) | `NtripConnection.cs:145`, `NtripResponse.cs:24, :50` |
| 11 | Status und Log zeigen die ersten Zeilen (bis 3) der Caster-Antwort und frühe Textbytes | teilweise: die **erste Zeile** („caster said“) und die eingeordnete Meldung; weitere Zeilen und ob eine GGA gesendet wurde: nein | `NtripClientService.cs:416–436` |
| 12 | Anmeldung in zitierten Caster-Antworten als `***` | abgedeckt (Passwort und Base64-Wert werden geschwärzt) | `NtripClientService.cs:394, :416` |
| 13 | Verbindungstest wie die echte Verbindung | abgedeckt (gleicher Aufbau; wie im Fork ohne GGA) | `NtripConnectionTester.cs:32` |

**Nachtrag 02.11.2026:** 2 (300 s) und 6 (Minuten-Übertrag) sind eingebaut (genehmigte Ausnahme,
`NtripClientService.NextGgaSentence`/`NmeaDegreesMinutes`, Tests `NtripGgaRoundingAndAgeTests`;
Upstream-Entwürfe Nr. 5 und 6 in `docs/Upstream-PRs.md`). **Offen (nicht geändert):** 5 (NTRIP 1:
GGA vor der Antwort), 11 (mehr Antwortzeilen). Betrifft 5 nur Caster, die NTRIP 2.0 nicht
verstehen; APOS ist bei diesem Stand nicht nachgetestet. Kandidaten für einen Upstream-Hinweis.
