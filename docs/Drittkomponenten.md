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
Erledigt (Oktober 2026): Lizenztext von CanvasKit liegt in `wwwroot/vendor/canvaskit-LICENSE.txt`
(LICENSE von google/skia, Version laut Code-Kommentar 0.41); StbImageSharp laut README des Projekts
„Public Domain or MIT“; .NET-Laufzeit laut `LICENSE.TXT` von dotnet/runtime MIT.

1. **Android und iOS:** Indirekte Pakete (AndroidX, Mono-Laufzeit u. a.) sind nicht aufgelistet;
   eine Liste ließe sich aus `project.assets.json` eines Release-Builds erzeugen.
2. **Symbole (`wwwroot/icons`) und Töne (`wwwroot/sounds`):** belegt in
   `docs/Herkunft-Symbole-Toene.md` (Oktober 2026): alle 11 Töne und 164 Symbole sind byte-gleich im
   heutigen AgOpenGPS (Apache 2.0), 22 Symbole sind im Projekt entstanden, 4 sind Fork-eigen.
   **Offen:** die Quelle von `ST_NerdAdv.png` und `AutoSteerGray.png` (die App nutzt Fork-eigenen
   Ersatz, die Dateien bleiben im Repo) und die Zustimmung der Autoren für Dateien vor dem
   17.05.2026 (upstream).
3. Die Lizenztexte selbst (MIT, Boost, CC BY 4.0) liegen nicht in der App; die Seite nennt sie nur.
4. Die CanvasKit-Version steht nur im Code-Kommentar; die Datei selbst trägt keine Versionsnummer.
