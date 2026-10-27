# Herkunft der Symbole und Töne (`wwwroot/icons`, `wwwroot/sounds`)

Stand 27.10.2026. **Methode:** Jede Datei wurde über ihren Git-Inhalt (Blob-Hash) verglichen:
1. mit dem Abbild von AgOpenGPS v6.4.0, das upstream am 24.01.2026 als `AgOpen_Snapshot/` eingecheckt
   hatte (Commit `6bb2d41c`; dessen `GPS/License.txt`: eine Copyleft-Lizenz, nicht Apache 2.0; AgOpenGPS v6.4.0, 12.12.2024);
2. mit dem heutigen AgOpenGPS (`AgOpenGPS-Official/AgOpenGPS`, Zweig `develop`, Pfad `SourceCode/…`,
   abgerufen 27.10.2026), dessen `LICENSE` Apache License 2.0 ist;
3. für die übrigen: erster Commit, der die Datei ins Repo brachte (`git log --diff-filter=A`).

## Ergebnis
| | Anzahl | Herkunft | Lizenz |
|---|---|---|---|
| Töne | 10 von 11 | byte-gleich in AgOpenGPS `develop` (`SourceCode/GPS/Resources/`) | Apache 2.0 (AgOpenGPS) |
| Ton `Headland.wav` | 1 | byte-gleich mit AgOpenGPS v6.4.0; in `develop` inzwischen eine andere Fassung | **offen**: v6.4.0 stand nicht unter Apache 2.0 |
| Symbole | 164 von 190 | byte-gleich in AgOpenGPS `develop` (`SourceCode/GPS/…`, meist `btnImages/`) | Apache 2.0 (AgOpenGPS) |
| Symbole aus der Projektarbeit | 22 | erstmals im AgOpenWeb-/AgValoniaGPS-Repo, nicht in AgOpenGPS gefunden; Autor laut Commit | wie das Projekt, Apache 2.0; vor dem 17.05.2026 hinzugefügte fallen unter die Zustimmung der Autoren aus upstream `Plans/LICENSE_HEADERS_PLAN.md` |
| Symbole mit offener Quelle | 2 | `ST_NerdAdv.png`, `AutoSteerGray.png` aus der „button images library“ (`3c389d19`) ohne Quellenangabe | **offen** |
| Fork-eigene Symbole | 2 | `brand-192.png`, `brand-512.png` (Fork, Commit `7ac7cd3e`) | Apache 2.0 |

**Offen bleibt:** `Headland.wav` (die alte Fassung ist in AgOpenGPS `develop` nicht mehr enthalten;
ob AgOpenGPS sie auch unter Apache 2.0 veröffentlicht hat, ist nicht belegt; Ersatz: die heutige
Datei aus AgOpenGPS `develop` übernehmen); die Quelle der zwei Symbole aus der „button images
library“; die Zustimmung der Autoren für Dateien vor dem 17.05.2026 (upstream-Aufgabe).

## Alle Dateien
| Datei | Herkunft | Stand gegenüber AgOpenGPS `develop` |
|---|---|---|
| `sounds/Alarm10.wav` | AgOpenGPS `SourceCode/GPS/Resources/Alarm10.wav` | gleich |
| `sounds/Headland.wav` | AgOpenGPS `SourceCode/GPS/Resources/Headland.wav` | v6.4-Fassung; in develop geändert |
| `sounds/HydDown.wav` | AgOpenGPS `SourceCode/GPS/Resources/HydDown.wav` | gleich |
| `sounds/HydUp.wav` | AgOpenGPS `SourceCode/GPS/Resources/HydUp.wav` | gleich |
| `sounds/SectionOff.wav` | AgOpenGPS `SourceCode/GPS/Resources/SectionOff.wav` | gleich |
| `sounds/SectionOn.wav` | AgOpenGPS `SourceCode/GPS/Resources/SectionOn.wav` | gleich |
| `sounds/SteerOff.wav` | AgOpenGPS `SourceCode/GPS/Resources/SteerOff.wav` | gleich |
| `sounds/SteerOn.wav` | AgOpenGPS `SourceCode/GPS/Resources/SteerOn.wav` | gleich |
| `sounds/TF012.wav` | AgOpenGPS `SourceCode/AgIO/Source/Resources/TF012.WAV` | gleich |
| `sounds/rtk_back.wav` | AgOpenGPS `SourceCode/GPS/Resources/rtk_back.wav` | gleich |
| `sounds/rtk_lost.wav` | AgOpenGPS `SourceCode/GPS/Resources/rtk_lost.wav` | gleich |
| `icons/ABDraw.png` | AgOpenGPS `SourceCode/GPS/btnImages/ABDraw.png` | gleich |
| `icons/ABLineCycle.png` | AgOpenGPS `SourceCode/GPS/btnImages/ABLineCycle.png` | gleich |
| `icons/ABLineCycleBk.png` | AgOpenGPS `SourceCode/GPS/btnImages/ABLineCycleBk.png` | gleich |
| `icons/ABSmooth.png` | AgOpenGPS `SourceCode/GPS/btnImages/ABSmooth.png` | gleich |
| `icons/ABSnapNudgeMenu.png` | AgOpenGPS `SourceCode/GPS/btnImages/ABSnapNudgeMenu.png` | gleich |
| `icons/ABSwapPoints.png` | AgOpenGPS `SourceCode/GPS/btnImages/ABSwapPoints.png` | gleich |
| `icons/ABTrackAB.png` | AgOpenGPS `SourceCode/GPS/btnImages/ABTrackAB.png` | gleich |
| `icons/ABTrackAPlus.png` | AgOpenGPS `SourceCode/GPS/btnImages/ABTrackA+.png` | gleich |
| `icons/ABTrackCurve.png` | AgOpenGPS `SourceCode/GPS/btnImages/ABTrackCurve.png` | gleich |
| `icons/ABTracks.png` | AgOpenGPS `SourceCode/AgIO/Source/btnImages/LogViewer.png` | gleich |
| `icons/APlusMinusA.png` | AgOpenGPS `SourceCode/GPS/btnImages/APlusMinusA.png` | gleich |
| `icons/APlusMinusB.png` | AgOpenGPS `SourceCode/GPS/btnImages/APlusMinusB.png` | gleich |
| `icons/APlusPlusA.png` | AgOpenGPS `SourceCode/GPS/btnImages/APlusPlusA.png` | gleich |
| `icons/APlusPlusB.png` | AgOpenGPS `SourceCode/GPS/btnImages/APlusPlusB.png` | gleich |
| `icons/AgShare.png` | AgOpenGPS `SourceCode/GPS/btnImages/AgShare.png` | gleich |
| `icons/AntennaArticulatedOffset.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/AntennaArticulatedTop.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/AntennaHarvesterOffset.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/AntennaHarvesterTop.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/AntennaTractorOffset.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/AntennaTractorTop.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/ArticulatedFrontAoG.png` | AgOpenGPS `SourceCode/GPS/ResourcesBrands/Brands/Articulated/ArticulatedFrontAoG.png` | gleich |
| `icons/ArticulatedRearAoG.png` | AgOpenGPS `SourceCode/GPS/ResourcesBrands/Brands/Articulated/ArticulatedRearAoG.png` | gleich |
| `icons/AutoSteerConf.png` | AgOpenGPS `SourceCode/GPS/btnImages/AutoSteerConf.png` | gleich |
| `icons/AutoSteerGray.png` | **offen:** chriskinal, 2025-12-09, `63770638` „Add RightNavigationPanel with guidance control buttons“; gleiche Datei auch in der „button images library“ (`3c389d19`), Quelle nicht genannt, nicht in AgOpenGPS gefunden | — |
| `icons/AutoSteerOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/AutoSteerOff.png` | gleich |
| `icons/AutoSteerOn.png` | AgOpenGPS `SourceCode/GPS/btnImages/AutoSteerOn.png` | gleich |
| `icons/AutoTrack.png` | AgOpenGPS `SourceCode/GPS/btnImages/AutoTrack.png` | gleich |
| `icons/AutoTrackOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/AutoTrackOff.png` | gleich |
| `icons/Boundary.png` | AgOpenGPS `SourceCode/GPS/btnImages/Boundary.png` | gleich |
| `icons/BoundaryByMap.png` | erstmals im Repo: chriskinal, 2025-11-28, `85194c66` „Initial commit: Cross-platform AgValoniaGPS3 with clean arch“ | — |
| `icons/BoundaryFromTracks.png` | AgOpenGPS `SourceCode/GPS/btnImages/BoundaryFromTracks.png` | gleich |
| `icons/BoundaryLeft.png` | AgOpenGPS `SourceCode/GPS/btnImages/BoundaryLeft.png` | gleich |
| `icons/BoundaryLoadFromGE.png` | AgOpenGPS `SourceCode/GPS/btnImages/BoundaryLoadFromGE.png` | gleich |
| `icons/BoundaryRecord.png` | AgOpenGPS `SourceCode/GPS/btnImages/BoundaryRecord.png` | gleich |
| `icons/BoundaryRecordPivot.png` | AgOpenGPS `SourceCode/GPS/btnImages/BoundaryRecordPivot.png` | gleich |
| `icons/BoundaryRecordTool.png` | AgOpenGPS `SourceCode/GPS/btnImages/BoundaryRecordTool.png` | gleich |
| `icons/BoundaryRight.png` | AgOpenGPS `SourceCode/GPS/btnImages/BoundaryRight.png` | gleich |
| `icons/BoundarySectionControlOnOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/BoundarySectionControlOnOff.png` | gleich |
| `icons/Chart.png` | AgOpenGPS `SourceCode/GPS/btnImages/Chart.png` | gleich |
| `icons/ColorLocked.png` | AgOpenGPS `SourceCode/GPS/btnImages/ColorLocked.png` | gleich |
| `icons/ColorUnlocked.png` | AgOpenGPS `SourceCode/GPS/btnImages/ColorUnlocked.png` | gleich |
| `icons/ConD_AutoDayNight.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConD_AutoDayNight.png` | gleich |
| `icons/ConD_ExtraGuides.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConD_ExtraGuides.png` | gleich |
| `icons/ConD_FloorTexture.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConD_FloorTexture.png` | gleich |
| `icons/ConD_Grid.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConD_Grid.png` | gleich |
| `icons/ConD_HeadlandDistance.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/HeadlandDistance.png` | gleich |
| `icons/ConD_LightBar.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConD_LightBar.png` | gleich |
| `icons/ConD_RollHelper.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConD_RollHelper.png` | gleich |
| `icons/ConD_SteerBarBar.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConD_SteerBarBar.png` | gleich |
| `icons/ConD_SvennArrow.png` | AgOpenGPS `SourceCode/GPS/btnImages/SvennArrow.png` | gleich |
| `icons/ConDa_InvertRoll.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConDa_InvertRoll.png` | gleich |
| `icons/ConDa_RollSetZero.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConDa_RollSetZero.png` | gleich |
| `icons/ConF_HydLiftSound.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConF_HydLiftSound.png` | gleich |
| `icons/ConF_SoundSections.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConF_SoundSections.png` | gleich |
| `icons/ConF_SteerSound.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConF_SteerSound.png` | gleich |
| `icons/ConF_TurnSound.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConF_TurnSound.png` | gleich |
| `icons/ConMa_LiftLowerTime.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConMa_LiftLowerTime.png` | gleich |
| `icons/ConMa_LiftRaiseTime.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConMa_LiftRaiseTime.png` | gleich |
| `icons/ConST_Danfoss.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConST_Danfoss.png` | gleich |
| `icons/ConS_Alarm.png` | erstmals im Repo: chriskinal, 2026-01-02, `bd1297b8` „Add AutoSteer configuration panel with 9-tab interface“ | — |
| `icons/ConS_ImplementConfig.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConS_ImplementConfig.png` | gleich |
| `icons/ConS_ModulesSteer.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConS_ModulesSteer.png` | gleich |
| `icons/ConS_Pins.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConS_Pins.png` | gleich |
| `icons/ConSt_InvertDirection.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConSt_InvertDirection.png` | gleich |
| `icons/ConSt_InvertRelay.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConSt_InvertRelay.png` | gleich |
| `icons/ConSt_InvertWAS.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConSt_InvertWAS.png` | gleich |
| `icons/ConSt_Mandatory.png` | AgOpenGPS `SourceCode/AgIO/Source/btnImages/ConSt_Mandatory.png` | gleich |
| `icons/ConSt_TurnSensor.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConSt_TurnSensor.png` | gleich |
| `icons/ConSt_TurnSensorCurrent.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConSt_TurnSensorCurrent.png` | gleich |
| `icons/ConSt_TurnSensorPressure.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConSt_TurnSensorPressure.png` | gleich |
| `icons/ConT_TramOverride.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConT_TramOverride.png` | gleich |
| `icons/ConT_TramOverrideDisplay.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConT_TramOverrideDisplay.png` | gleich |
| `icons/ConT_TramSpacing.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConT_TramSpacing.png` | gleich |
| `icons/ConU_UturnDistance.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConU_UturnDistance.png` | gleich |
| `icons/ConU_UturnLength.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConU_UturnLength.png` | gleich |
| `icons/ConU_UturnRadius.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConU_UturnRadius.png` | gleich |
| `icons/ConU_UturnSmooth.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConU_UturnSmooth.png` | gleich |
| `icons/ConV_CmPixel.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConV_CmPixel.png` | gleich |
| `icons/ConV_GuidanceLookAhead.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConV_GuidanceLookAhead.png` | gleich |
| `icons/ConV_LineWith.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConV_LineWith.png` | gleich |
| `icons/ConV_MaxAutoSteer.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConV_MaxAutoSteer.png` | gleich |
| `icons/ConV_MinAutoSteer.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConV_MinAutoSteer.png` | gleich |
| `icons/ConV_SnapDistance.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ConV_SnapDistance.png` | gleich |
| `icons/Con_UTurnMenu.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/Con_UTurnMenu.png` | gleich |
| `icons/ContourOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/ContourOff.png` | gleich |
| `icons/ContourOn.png` | AgOpenGPS `SourceCode/GPS/btnImages/ContourOn.png` | gleich |
| `icons/FieldTools.png` | AgOpenGPS `SourceCode/GPS/btnImages/FieldTools.png` | gleich |
| `icons/FileClose.png` | AgOpenGPS `SourceCode/GPS/btnImages/FileClose.png` | gleich |
| `icons/FileExisting.png` | AgOpenGPS `SourceCode/GPS/btnImages/FileExisting.png` | gleich |
| `icons/FileNew.png` | AgOpenGPS `SourceCode/GPS/btnImages/FileNew.png` | gleich |
| `icons/FileOpen.png` | AgOpenGPS `SourceCode/GPS/btnImages/FileExplorerWindows.png` | gleich |
| `icons/FilePrevious.png` | AgOpenGPS `SourceCode/GPS/btnImages/FilePrevious.png` | gleich |
| `icons/FlagRed.png` | AgOpenGPS `SourceCode/GPS/btnImages/FlagRed.png` | gleich |
| `icons/FrontWheels.png` | AgOpenGPS `SourceCode/GPS/btnImages/Images/z_FrontWheels.png` | gleich |
| `icons/GoogleEarth.png` | AgOpenGPS `SourceCode/GPS/btnImages/GoogleEarth.png` | gleich |
| `icons/GroundTextureDark.png` | erstmals im Repo: Xyntexx, 2026-04-05, `9e0017a0` „Increase grid line contrast in day mode (#181)“ | — |
| `icons/GroundTextureLight.png` | AgOpenGPS `SourceCode/GPS/btnImages/Images/z_Floor.png` | gleich |
| `icons/HarvesterAoG.png` | AgOpenGPS `SourceCode/GPS/ResourcesBrands/Brands/Harvester/HarvesterAoG.png` | gleich |
| `icons/HeadlandOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/HeadlandOff.png` | gleich |
| `icons/HeadlandOn.png` | AgOpenGPS `SourceCode/GPS/btnImages/HeadlandOn.png` | gleich |
| `icons/HeadlandSectionOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/HeadlandSectionOff.png` | gleich |
| `icons/HeadlandSectionOn.png` | AgOpenGPS `SourceCode/GPS/btnImages/HeadlandSectionOn.png` | gleich |
| `icons/Hitch.png` | erstmals im Repo: chriskinal, 2026-06-01, `7423b42d` „Config UI: ISO hitch types, dimension diagram cards, layout “ | — |
| `icons/HitchArticulated.png` | erstmals im Repo: chriskinal, 2026-06-01, `ad2b6a44` „Config UI polish: GPS/antenna dimension cards, GPS+Roll clea“ | — |
| `icons/ISOXML.png` | AgOpenGPS `SourceCode/GPS/btnImages/ISOXML.png` | gleich |
| `icons/IsobusSectionControlIdle.png` | erstmals im Repo: chriskinal, 2026-10-11, `a1e8f3ec` „ISOBUS task controller: read PGN 240, send PGN 241 (#312)“ | — |
| `icons/IsobusSectionControlOff.png` | erstmals im Repo: chriskinal, 2026-10-11, `a1e8f3ec` „ISOBUS task controller: read PGN 240, send PGN 241 (#312)“ | — |
| `icons/IsobusSectionControlOn.png` | erstmals im Repo: chriskinal, 2026-10-11, `a1e8f3ec` „ISOBUS task controller: read PGN 240, send PGN 241 (#312)“ | — |
| `icons/JobActive.png` | AgOpenGPS `SourceCode/GPS/btnImages/JobActive.png` | gleich |
| `icons/ManualOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/ManualOff.png` | gleich |
| `icons/ManualOn.png` | AgOpenGPS `SourceCode/GPS/btnImages/ManualOn.png` | gleich |
| `icons/ModePurePursuit.png` | AgOpenGPS `SourceCode/GPS/btnImages/ModePurePursuit.png` | gleich |
| `icons/ModeStanley.png` | AgOpenGPS `SourceCode/GPS/btnImages/ModeStanley.png` | gleich |
| `icons/NavigationSettings.png` | AgOpenGPS `SourceCode/GPS/btnImages/NavigationSettings.png` | gleich |
| `icons/OK64.png` | AgOpenGPS `SourceCode/GPS/btnImages/OK64.png` | gleich |
| `icons/PointAdd.png` | AgOpenGPS `SourceCode/GPS/btnImages/PointAdd.png` | gleich |
| `icons/PointDelete.png` | AgOpenGPS `SourceCode/GPS/btnImages/PointDelete.png` | gleich |
| `icons/RecPath.png` | AgOpenGPS `SourceCode/GPS/btnImages/RecPath.png` | gleich |
| `icons/RecPathPlay.png` | AgOpenGPS `SourceCode/GPS/btnImages/boundaryPlay.png` | gleich |
| `icons/RecPathRecord.png` | AgOpenGPS `SourceCode/GPS/btnImages/BoundaryRecord.png` | gleich |
| `icons/RecPathResumeStart.png` | AgOpenGPS `SourceCode/GPS/btnImages/pathResumeStart.png` | gleich |
| `icons/RecPathStop.png` | AgOpenGPS `SourceCode/GPS/btnImages/boundaryStop.png` | gleich |
| `icons/ResetTool.png` | AgOpenGPS `SourceCode/GPS/btnImages/ResetTool.png` | gleich |
| `icons/Reset_Default.png` | AgOpenGPS `SourceCode/GPS/btnImages/Reset_Default.png` | gleich |
| `icons/ST_GainTab.png` | AgOpenGPS `SourceCode/GPS/btnImages/Steer/ST_GainTab.png` | gleich |
| `icons/ST_NerdAdv.png` | **offen:** erstmals in der „button images library“, chriskinal, 2025-12-09, `3c389d19` „Added button images library.“; Quelle der Bibliothek nicht genannt, nicht in AgOpenGPS gefunden | — |
| `icons/ST_SteerTab.png` | AgOpenGPS `SourceCode/GPS/btnImages/Steer/ST_SteerTab.png` | gleich |
| `icons/SectionLookAheadDelay.gif` | AgOpenGPS `SourceCode/GPS/btnImages/Config/SectionLookAheadDelay.gif` | gleich |
| `icons/SectionLookAheadOff.gif` | AgOpenGPS `SourceCode/GPS/btnImages/Config/SectionLookAheadOff.gif` | gleich |
| `icons/SectionMapping.png` | AgOpenGPS `SourceCode/GPS/btnImages/SectionMapping.png` | gleich |
| `icons/SectionMasterOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/SectionMasterOff.png` | gleich |
| `icons/SectionMasterOn.png` | AgOpenGPS `SourceCode/GPS/btnImages/SectionMasterOn.png` | gleich |
| `icons/SectionOnLookAhead.gif` | AgOpenGPS `SourceCode/GPS/btnImages/Config/SectionOnLookAhead.gif` | gleich |
| `icons/Sensors.png` | AgOpenGPS `SourceCode/GPS/btnImages/Steer/Sensors.png` | gleich |
| `icons/Settings48.png` | AgOpenGPS `SourceCode/GPS/btnImages/Settings48.png` | gleich |
| `icons/SnapLeft.png` | AgOpenGPS `SourceCode/GPS/btnImages/SnapLeft.png` | gleich |
| `icons/SnapRight.png` | AgOpenGPS `SourceCode/GPS/btnImages/SnapRight.png` | gleich |
| `icons/SnapToPivot.png` | AgOpenGPS `SourceCode/GPS/btnImages/SnapToPivot.png` | gleich |
| `icons/SpecialFunctions.png` | AgOpenGPS `SourceCode/GPS/btnImages/SpecialFunctions.png` | gleich |
| `icons/SteerDriveOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/SteerDriveOff.png` | gleich |
| `icons/SteerDriveOn.png` | AgOpenGPS `SourceCode/GPS/btnImages/SteerDriveOn.png` | gleich |
| `icons/SwitchActiveClosed.png` | AgOpenGPS `SourceCode/GPS/btnImages/SwitchActiveClosed.png` | gleich |
| `icons/SwitchActiveOpen.png` | AgOpenGPS `SourceCode/GPS/btnImages/SwitchActiveOpen.png` | gleich |
| `icons/SwitchOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/SwitchOff.png` | gleich |
| `icons/SwitchOn.png` | AgOpenGPS `SourceCode/GPS/btnImages/SwitchOn.png` | gleich |
| `icons/ToolAcceptChange.png` | AgOpenGPS `SourceCode/GPS/btnImages/ToolAcceptChange.png` | gleich |
| `icons/ToolChkFront.png` | AgOpenGPS `SourceCode/GPS/btnImages/ToolChkFront.png` | gleich |
| `icons/ToolChkRear.png` | AgOpenGPS `SourceCode/GPS/btnImages/ToolChkRear.png` | gleich |
| `icons/ToolChkTBT.png` | AgOpenGPS `SourceCode/GPS/btnImages/ToolChkTBT.png` | gleich |
| `icons/ToolChkTrailing.png` | AgOpenGPS `SourceCode/GPS/btnImages/ToolChkTrailing.png` | gleich |
| `icons/ToolGap.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ToolGap.png` | gleich |
| `icons/ToolHitchPageFront.png` | AgOpenGPS `SourceCode/GPS/btnImages/ToolHitchPageFront.png` | gleich |
| `icons/ToolHitchPageRear.png` | AgOpenGPS `SourceCode/GPS/btnImages/ToolHitchPageRear.png` | gleich |
| `icons/ToolHitchPageTBT.png` | AgOpenGPS `SourceCode/GPS/btnImages/ToolHitchPageTBT.png` | gleich |
| `icons/ToolHitchPageTrailing.png` | AgOpenGPS `SourceCode/GPS/btnImages/ToolHitchPageTrailing.png` | gleich |
| `icons/ToolHitchPivotOffsetNeg.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ToolHitchPivotOffsetNeg.png` | gleich |
| `icons/ToolHitchPivotOffsetPos.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ToolHitchPivotOffsetPos.png` | gleich |
| `icons/ToolOffsetPositiveRight.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ToolOffsetPositiveRight.png` | gleich |
| `icons/ToolOverlap.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/ToolOverlap.png` | gleich |
| `icons/TrackOn.png` | AgOpenGPS `SourceCode/GPS/btnImages/TrackOn.png` | gleich |
| `icons/TrackWidthArticulated.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/TrackWidthHarvester.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/TrackWidthTractor.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/TractorAoG.png` | AgOpenGPS `SourceCode/GPS/ResourcesBrands/Brands/Tractor/TractorAoG.png` | gleich |
| `icons/TramAll.png` | AgOpenGPS `SourceCode/GPS/btnImages/TramAll.png` | gleich |
| `icons/TramLines.png` | AgOpenGPS `SourceCode/GPS/btnImages/TramLines.png` | gleich |
| `icons/TramMulti.png` | AgOpenGPS `SourceCode/GPS/btnImages/TramMulti.png` | gleich |
| `icons/TramOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/TramOff.png` | gleich |
| `icons/TramOuter.png` | AgOpenGPS `SourceCode/GPS/btnImages/TramOuter.png` | gleich |
| `icons/Trash.png` | AgOpenGPS `SourceCode/GPS/btnImages/Trash.png` | gleich |
| `icons/TrashContourRef.png` | AgOpenGPS `SourceCode/GPS/btnImages/TrashContourRef.png` | gleich |
| `icons/WheelbaseArticulated.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/WheelbaseHarvester.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/WheelbaseTractor.png` | erstmals im Repo: Xyntexx, 2026-04-19, `329165d4` „Vehicle Simulator, UDP auto-discovery, GPS fixes, wizard WIP“ | — |
| `icons/YouSkipOff.png` | AgOpenGPS `SourceCode/GPS/btnImages/YouSkipOff.png` | gleich |
| `icons/YouSkipOn.png` | AgOpenGPS `SourceCode/GPS/btnImages/YouSkipOn.png` | gleich |
| `icons/YouSkipWorkedTracks.png` | AgOpenGPS `SourceCode/GPS/btnImages/YouSkipWorkedTracks.png` | gleich |
| `icons/YouTurnNo.png` | AgOpenGPS `SourceCode/GPS/btnImages/YouTurnNo.png` | gleich |
| `icons/YouTurnYes.png` | AgOpenGPS `SourceCode/GPS/btnImages/YouTurn80.png` | gleich |
| `icons/appicon-192.png` | erstmals im Repo: chriskinal, 2026-06-16, `99c3057f` „Web UI Phase 9b (3/3): full Tool dialog + tablet layout + PW“ | — |
| `icons/appicon-512.png` | erstmals im Repo: chriskinal, 2026-06-16, `99c3057f` „Web UI Phase 9b (3/3): full Tool dialog + tablet layout + PW“ | — |
| `icons/boundaryPause.png` | AgOpenGPS `SourceCode/GPS/btnImages/boundaryPause.png` | gleich |
| `icons/brand-192.png` | Fork: Commit `7ac7cd3e` (2026-10-19, Kit Phase 4a, eigene Darstellung) | — |
| `icons/brand-512.png` | Fork: Commit `7ac7cd3e` (2026-10-19, Kit Phase 4a, eigene Darstellung) | — |
| `icons/con_VehicleFunctionSpeedLimit.png` | AgOpenGPS `SourceCode/GPS/btnImages/Config/con_VehicleFunctionSpeedLimit.png` | gleich |
| `icons/fileMenu.png` | AgOpenGPS `SourceCode/GPS/btnImages/fileMenu.png` | gleich |
| `icons/vehiclePageArticulated.png` | AgOpenGPS `SourceCode/GPS/btnImages/vehiclePageArticulated.png` | gleich |
| `icons/vehiclePageHarvester.png` | AgOpenGPS `SourceCode/GPS/btnImages/vehiclePageHarvester.png` | gleich |
| `icons/vehiclePageTractor.png` | AgOpenGPS `SourceCode/GPS/btnImages/vehiclePageTractor.png` | gleich |
