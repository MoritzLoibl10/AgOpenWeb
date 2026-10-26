# Prüfstand-Checkliste (AiO v4.5 + Keya)

Branch `feature/pruefstand-checkliste`, nur `wwwroot`, reine Anzeige.

> Board und Motor sind noch nicht auf echter Hardware getestet. Die Checkliste ist dafür gedacht,
> das auf dem Prüfstand nachzuholen; was „richtig“ aussieht, ist bis dahin eine Erwartung.

**Aufruf:** Einrichtung → Menü → Kachel „Prüfstand-Checkliste“. Beim Wechsel in den Fahrmodus schließt sie sich.

**Schritte.** Jeder Schritt zeigt Live-Werte, was „richtig“ aussieht, die Knöpfe „OK“ und „Problem“ und ein Notizfeld:

| # | Schritt | Live-Werte (alles, was der Host schon sendet) |
|---|---------|-----------------------------------------------|
| 1 | Verbindung Lenkmodul | PGN-Empfang, Adresse, in Netzwerk eingerichtet, IMU-Modul. Die Firmware-Version überträgt der Host nicht. |
| 2 | Lenkwinkelsensor | Lenkwinkel, Sensor %, WAS-Versatz, Zähler pro Grad. Hinweis: Räder gerade = nahe 0°, Vorzeichen links/rechts prüfen. |
| 3 | Kurs-Prüfung | Die Werte der bestehenden Kurs-Prüfung (`TabletHeadingCheck`), mit deren Warnungen. |
| 4 | Querneigung | Live-Wert, Nullpunkt, umgekehrt. Warnung, wenn mit IMU 5 s lang genau 0,00° kommt (seit #356 gilt 0 als gültig). Kalibrieren: Fahrzeug & Gerät → Querneigung → „Jetzt nullen“. |
| 5 | GPS | Fix-Qualität, Satelliten, Korrekturalter, HDOP, Datensatz |
| 6 | Lenkung ein/aus | bereit, ein, „Modul meldet lenkt nicht“, Soll-/Ist-Winkel, PWM |
| 7 | Rückwärtsstart (absichtlich) | Geschwindigkeit, Host „rückwärts“, Richtungskarte offen, Simulator-Warnung, Zwei Antennen |

**Schritt 7** stellt die Richtungsfalle mit Einzelantenne nach (siehe `Bericht-Simulator-Richtung.md`). Die Lenkung bleibt dabei AUS:

1. Host neu starten oder aufs Fahrzeug tippen.
2. Zuerst rückwärts fahren.
3. Erwartet: kein „RÜCKWÄRTS“, Pfeil zeigt zur Spur; im Simulator kommt die Warnung.
4. Auf der Karte „Nein – Richtung neu lernen“ tippen, dann vorwärts fahren.
5. Erwartet: richtig.

Dazu steht die Regel „Nach dem Start erst vorwärts fahren oder die Richtung auf der Karte bestätigen“. Die Hilfeseite „Richtung“ verweist auf diesen Schritt.

**Ergebnis.** Es bleibt auf diesem Gerät gespeichert (`localStorage` `aow.tui.bench`) und geht in die „Diagnose für Support“ ein: eine Statuszeile und dahinter die Notizen, je bis 60 Zeichen. Die Zusammenfassung ist auf 1 KB begrenzt; lange Notizen werden am Ende abgeschnitten. „Alle Haken löschen“ braucht zwei Tipps.

**Sendet nichts.** Die Checkliste ändert keine Werte; im Test kam außer dem normalen `control.presence` nichts. Wo ein Schritt eine Handlung braucht (Nullpunkt, Richtung), nennt er den bestehenden Knopf.
