// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

namespace AgOpenWeb.Desktop.Launcher;

/// <summary>
/// Fork (installer): are the Windows Firewall rules the setup should have created there? The
/// setup writes <c>firewall-status.txt</c> next to the program (ok | failed | skipped, then the two
/// rule names); without the file (portable ZIP) or with "skipped" nothing is checked. Otherwise
/// both rules are looked up with <c>netsh</c> (no administrator rights needed), so a rule created
/// later with "Firewall freigeben" ends the warning, and one deleted later starts it.
/// </summary>
internal static class FirewallCheck
{
    /// <summary>True when the setup wanted the rules and at least one of them is missing.</summary>
    public static async Task<bool> RulesMissingAsync()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            var file = Path.Combine(AppContext.BaseDirectory, "firewall-status.txt");
            if (!File.Exists(file)) return false;
            var lines = await File.ReadAllLinesAsync(file).ConfigureAwait(false);
            if (lines.Length < 3 || lines[0].Trim() == "skipped") return false;
            foreach (var name in new[] { lines[1].Trim(), lines[2].Trim() })
                if (name.Length > 0 && !await RuleExistsAsync(name).ConfigureAwait(false)) return true;
            return false;
        }
        catch { return false; } // never warn on a failed check
    }

    private static async Task<bool> RuleExistsAsync(string name)
    {
        var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "netsh.exe"),
            $"advfirewall firewall show rule name=\"{name}\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
        };
        using var p = Process.Start(psi);
        if (p == null) return true;
        var output = await p.StandardOutput.ReadToEndAsync().ConfigureAwait(false);
        await p.WaitForExitAsync().ConfigureAwait(false);
        // Found: exit code 0 and the rule's name in the listing (the text itself is localised).
        return p.ExitCode == 0 && output.Contains(name, StringComparison.OrdinalIgnoreCase);
    }
}
