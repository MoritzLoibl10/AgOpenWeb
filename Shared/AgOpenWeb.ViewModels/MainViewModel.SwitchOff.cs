// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using AgOpenWeb.Services.Interfaces;

namespace AgOpenWeb.ViewModels;

/// <summary>
/// MainViewModel partial (fork, feature/host-paket): explicit off for autosteer and sections, for
/// the web commands <c>autosteer.off</c> and <c>sections.alloff</c>. They only call the existing
/// off paths, and only while something is on, so sending them again, or from a stale client
/// state, never switches anything on: the same guarded toggles the host runs when control is
/// released (RemoteServerWiring, AuthorityChangedHandler), and for a section switched on by its
/// own button with neither master on (#316) the same SetAllSections(Off) as GPS lost.
/// </summary>
public partial class MainViewModel
{
    /// <summary>Autosteer off if engaged; nothing otherwise.</summary>
    public void AutoSteerOff()
    {
        if (IsAutoSteerEngaged && ToggleAutoSteerCommand?.CanExecute(null) == true)
            ToggleAutoSteerCommand.Execute(null);
    }

    /// <summary>Manual and auto section mode off, then any section still on off; nothing if all are off.</summary>
    public void AllSectionsOff()
    {
        if (IsManualSectionMode && ToggleManualModeCommand?.CanExecute(null) == true)
            ToggleManualModeCommand.Execute(null);
        if (IsSectionMasterOn && ToggleSectionMasterCommand?.CanExecute(null) == true)
            ToggleSectionMasterCommand.Execute(null);
        if (AnySectionNotOff())
            _sectionControlService.SetAllSections(SectionButtonState.Off);
    }
}
