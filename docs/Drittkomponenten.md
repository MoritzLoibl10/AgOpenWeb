# Drittkomponenten (Auslieferung, Teil B)

Die Seite in der App: Einrichtung → Info → „Drittkomponenten“. Der Text steht in
`wwwroot/index.html` zwischen `<!-- third-party:begin -->` und `<!-- third-party:end -->`; nur diesen
Block nimmt `Tools/license-headers.py` von der Prüfung auf fremde Lizenznamen aus.

## Woher die Liste stammt (Stand Oktober 2026)
| Komponente | Quelle im Repo | Lizenz laut |
|---|---|---|
| CanvasKit (`wwwroot/vendor`) | Dateien im Repo | nur `docs/Offene-Punkte.md` #20 (BSD-3); **keine Lizenzdatei im Repo** |
| BEV-Gitter AT_GIS_GRID | `docs/Geodaten-Herkunft.md` (eAMA-Branch) | `at_bev_README.txt` in PROJ-data: CC BY 4.0 |
| NuGet-Pakete | `PackageReference` in `Shared/*/*.csproj`, `Platforms/*/*.csproj` | `.nuspec` im lokalen NuGet-Cache; Clipper2 und ISOXML aus der Lizenzdatei im Paket |
| .NET-Laufzeit | `deploy/windows/package.sh` (`--self-contained true`) | nicht im Cache geprüft |

## Offen
1. **CanvasKit:** Lizenztext (BSD-3-Clause von Skia/Google) im Repo ablegen und Version festhalten.
2. **StbImageSharp 2.30.15:** Das Paket nennt keine Lizenz. Beim Projekt nachsehen und eintragen.
3. **.NET-Laufzeit:** Lizenz (MIT) an den Paketdaten der Laufzeit bestätigen.
4. **Android und iOS:** Indirekte Pakete (AndroidX, Mono-Laufzeit u. a.) sind nicht aufgelistet;
   eine Liste ließe sich aus `project.assets.json` eines Release-Builds erzeugen.
5. **Symbole (`wwwroot/icons`) und Töne (`wwwroot/sounds`):** stammen aus upstream bzw. AgOpenGPS.
   Ob sie unter Apache 2.0 stehen (upstream hat die Lizenz in #360/#363 vereinheitlicht), ist nicht
   eigens belegt.
6. Die Lizenztexte selbst (MIT, Boost, CC BY 4.0) liegen nicht in der App; die Seite nennt sie nur.
