// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace AgOpenWeb.Desktop;

/// <summary>
/// A machine-wide named mutex held for the life of the process. "Global\" makes it one per
/// computer on Windows (the service and a desktop session see the same one); .NET implements
/// named mutexes on macOS and Linux too. A copy that crashed leaves it abandoned, which the
/// next start takes over.
/// </summary>
static class SingleInstance
{
    private const string Name = @"Global\AgOpenWeb.Desktop";

    /// <summary>The held mutex, or null when another copy holds it.</summary>
    public static Mutex? TryAcquire()
    {
        var m = new Mutex(false, Name);
        try
        {
            if (m.WaitOne(0)) return m;
        }
        catch (AbandonedMutexException)
        {
            return m; // the last holder died without releasing; it's ours now
        }
        m.Dispose();
        return null;
    }

    // Fork (autostart, #377 kept): a second start no longer only exits. It asks the running
    // window to come to the front over a named pipe (Windows: a pipe; macOS/Linux: a socket), so
    // a double-click on the desktop icon while the app runs (e.g. from autostart) shows it.
    private const string ShowPipe = "AgOpenWeb.Desktop.Show";

    /// <summary>Ask the running copy to bring its window to the front. True when it took the
    /// request (a launcher window is running); false for a headless copy or none.</summary>
    public static bool AskRunningToShow()
    {
        try
        {
            // This process was started by the user, so it may hand the foreground on.
            if (OperatingSystem.IsWindows()) AllowSetForegroundWindow(AsfwAny);
            using var pipe = new NamedPipeClientStream(".", ShowPipe, PipeDirection.Out);
            pipe.Connect(1500);
            pipe.WriteByte(1);
            pipe.Flush();
            return true;
        }
        catch { return false; }
    }

    /// <summary>Serve show requests for the life of the process (launcher modes only).</summary>
    public static void ListenForShow(Action show)
    {
        _ = Task.Run(async () =>
        {
            while (true)
            {
                try
                {
                    using var pipe = new NamedPipeServerStream(ShowPipe, PipeDirection.In, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                    await pipe.WaitForConnectionAsync().ConfigureAwait(false);
                    if (pipe.ReadByte() == 1) show();
                }
                catch
                {
                    await Task.Delay(1000).ConfigureAwait(false); // pipe busy or failed: try again
                }
            }
        });
    }

    private const int AsfwAny = -1;

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);
}
