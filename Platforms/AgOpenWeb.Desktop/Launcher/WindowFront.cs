// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Runtime.InteropServices;

namespace AgOpenWeb.Desktop.Launcher;

/// <summary>
/// Fork (autostart): bring the launcher window to the front on Windows when the app is started
/// a second time. The second process allowed this one to take the foreground
/// (<c>AllowSetForegroundWindow</c> in <see cref="SingleInstance"/>).
/// </summary>
internal static class WindowFront
{
    private const int SwRestore = 9;

    public static void Activate(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        if (IsIconic(hwnd)) ShowWindow(hwnd, SwRestore);
        SetForegroundWindow(hwnd);
    }

    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
}
