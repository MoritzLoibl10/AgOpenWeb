// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace AgOpenWeb.RemoteWiring;

/// <summary>
/// Fork (feature/installer, start time): time stamps of the start phases, measured from the
/// process start (so the .NET runtime's own start counts too). Each mark goes to the console
/// and, once <see cref="Write"/> runs, into <c>%TEMP%\agopenweb-startup.log</c>
/// (<c>$TMPDIR</c> elsewhere), overwritten on every start. Only measures: nothing waits on it.
/// </summary>
public static class StartupTrace
{
    private static readonly object Gate = new();
    private static readonly StringBuilder Lines = new();
    private static readonly DateTime ProcessStart = GetProcessStart();
    private static double _last;

    /// <summary>Milliseconds since the process started.</summary>
    public static double Now => (DateTime.Now - ProcessStart).TotalMilliseconds;

    /// <summary>Record one phase as reached now.</summary>
    public static void Mark(string phase) => MarkAt(phase, Now);

    /// <summary>Record a phase at a given time since the process start (marks the web page
    /// reports, converted to the process clock).</summary>
    public static void MarkAt(string phase, double ms)
    {
        string line;
        lock (Gate)
        {
            line = string.Create(CultureInfo.InvariantCulture, $"[startup] {ms,8:0} ms  (+{ms - _last,6:0})  {phase}");
            _last = Math.Max(_last, ms);
            Lines.AppendLine(line);
        }
        Console.WriteLine(line);
    }

    /// <summary>Record a phase at a wall-clock time in Unix milliseconds (the web page's
    /// <c>performance.timeOrigin</c> plus its own mark).</summary>
    public static void MarkUnixMs(string phase, double unixMs) =>
        MarkAt(phase, unixMs - new DateTimeOffset(ProcessStart).ToUnixTimeMilliseconds());

    /// <summary>Write all marks so far to the log file (best effort).</summary>
    public static void Write()
    {
        try
        {
            string text;
            lock (Gate) text = Lines.ToString();
            File.WriteAllText(Path.Combine(Path.GetTempPath(), "agopenweb-startup.log"), text);
        }
        catch { /* measuring must never break the start */ }
    }

    private static DateTime GetProcessStart()
    {
        try { return Process.GetCurrentProcess().StartTime; }
        catch { return DateTime.Now; }
    }
}
