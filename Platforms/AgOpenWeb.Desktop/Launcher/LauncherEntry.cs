// AgOpenWeb
// Copyright (C) 2024-2025 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Diagnostics;
using System.Threading.Tasks;
using AgOpenWeb.RemoteWiring;
using Photino.NET;

namespace AgOpenWeb.Desktop.Launcher;

/// <summary>
/// Entry for the in-process launcher mode (Windows and macOS default; <c>--launcher</c> on any
/// OS). The window is a Photino.NET <see cref="PhotinoWindow"/>: WebView2 on Windows, WKWebView on
/// macOS, WebKitGTK on Linux. The default window is the all-in-one app — the guidance backend
/// (<see cref="BackendHost"/>) in this process and the web UI filling the window. <c>--console</c>
/// instead shows the small supervisor page (<see cref="ConsolePage"/>) for a box that only serves
/// other devices. Distinct from <see cref="HeadlessHost"/> (display-less daemon).
/// </summary>
internal static class LauncherEntry
{
    public static void Run(string[] args)
    {
        bool console = Array.IndexOf(args, "--console") >= 0;
        // Fork (start time): WebView2 paints its own background before the first page; dark
        // like the loading screen instead of a white flash. Windows only (WebView2 reads it).
        if (OperatingSystem.IsWindows() && Environment.GetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR") == null)
            Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF0B1020");
        StartupTrace.Mark("launcher: creating window");
        var window = new PhotinoWindow()
            .SetTitle(Brand.ProductName)
            .SetUseOsDefaultLocation(false)
            .SetUseOsDefaultSize(false)
            .SetLogVerbosity(0);
        var icon = IconPath();
        if (icon != null) window.SetIconFile(icon);
        // Fork (autostart): started with Windows → fullscreen straight away.
        if (Array.IndexOf(args, "--autostart") >= 0) window.SetFullScreen(true);
        // Fork: a second start brings this window to the front (SingleInstance).
        SingleInstance.ListenForShow(() => BringToFront(window));

        if (console) new ConsolePage(window, args).Show();
        else new WebViewLauncher(window, args).Show();
        window.WaitForClose();
    }

    /// <summary>Restore and activate the window (a second start of the app asked for it).</summary>
    private static void BringToFront(PhotinoWindow window)
    {
        try
        {
            window.Invoke(() =>
            {
                if (window.Minimized) window.SetMinimized(false);
                if (OperatingSystem.IsWindows()) WindowFront.Activate(window.WindowHandle);
                else { window.SetTopMost(true); window.SetTopMost(false); }
            });
        }
        catch { /* the window is not there yet or already closing */ }
    }

    /// <summary>The window icon file, next to the executable (Windows and Linux; the macOS
    /// bundle carries its own).</summary>
    private static string? IconPath()
    {
        if (OperatingSystem.IsMacOS()) return null;
        var p = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "agopenweb.ico");
        return System.IO.File.Exists(p) ? p : null;
    }

    public static void OpenUrl(string url)
    {
        try
        {
            if (OperatingSystem.IsWindows()) Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            else if (OperatingSystem.IsMacOS()) Process.Start("open", url);
            else Process.Start("xdg-open", url);
        }
        catch { /* no browser available */ }
    }

    /// <summary>A start failure is written to a temp log (a WinExe has no console) and returned
    /// as a one-line message for the window.</summary>
    public static string LogStartFailure(Exception ex)
    {
        var log = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "agopenweb-launcher-error.log");
        try { System.IO.File.WriteAllText(log, ex.ToString()); } catch { }
        return $"{ex.Message} (details: {log})";
    }

    /// <summary>Closing the window must stop the backend first so its save runs. Photino asks
    /// before closing: confirm (a stray click on X mid-job, #348), cancel, stop off the UI
    /// thread, then close for real.</summary>
    public static bool StopThenClose(PhotinoWindow window, BackendHost? backend, ref bool closing)
    {
        if (backend is not { IsRunning: true } || closing) return false; // let it close
        // Same wording as the Android head's Back prompt
        if (window.ShowMessage($"Exit {Brand.ProductName}?", "Guidance stops, and other devices lose the web view.",
                PhotinoDialogButtons.YesNo, PhotinoDialogIcon.Question) != PhotinoDialogResult.Yes)
            return true; // stay open
        closing = true;
        _ = Task.Run(async () =>
        {
            try { await backend.StopAsync(); } catch { /* close regardless */ }
            window.Invoke(window.Close);
        });
        return true; // cancel this close
    }

    // Fork: the loading screen shows the product name and logo (as wwwroot index.html #tui-boot).
    private const string SplashCss = "html,body{margin:0;height:100%;background:#0b1020;color:#fff;font:16px system-ui,sans-serif}" +
        "body{display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center;text-align:center}" +
        "h1{margin:0;font:800 30px system-ui,sans-serif;letter-spacing:.02em}p{margin:0;max-width:560px;white-space:pre-line;line-height:1.5;color:#b9c3d6}";

    private const string SplashLogo = "<svg viewBox=\"0 0 96 96\" width=\"96\" height=\"96\" aria-hidden=\"true\"><rect x=\"4\" y=\"4\" width=\"88\" height=\"88\" rx=\"22\" fill=\"#c995e0\"/>" +
        "<g fill=\"none\" stroke=\"#1d0b26\" stroke-width=\"5\" stroke-linecap=\"round\" opacity=\".55\"><path d=\"M20 76 C30 52 34 38 36 20\"/><path d=\"M36 78 C42 54 46 38 48 20\"/><path d=\"M64 78 C58 54 54 38 52 20\"/><path d=\"M80 76 C70 52 66 38 64 20\"/></g>" +
        "<path d=\"M50 18 V62\" stroke=\"#1d0b26\" stroke-width=\"7\" stroke-linecap=\"round\"/><circle cx=\"50\" cy=\"70\" r=\"9\" fill=\"#1d0b26\"/></svg>";

    public static string SplashHtml(string text) =>
        $"<!doctype html><html><head><meta charset=\"utf-8\"><style>{SplashCss}</style></head><body>{SplashLogo}<h1>{System.Net.WebUtility.HtmlEncode(Brand.ProductName)}</h1><p>{System.Net.WebUtility.HtmlEncode(text)}</p></body></html>";

    /// <summary>"Starting …" in the system's language (German or English); the app's own
    /// language setting is not loaded yet.</summary>
    public static string StartingText() =>
        System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "de" ? "Wird gestartet …" : "Starting …";
}
