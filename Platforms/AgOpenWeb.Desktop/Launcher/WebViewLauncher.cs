// AgOpenWeb
// Copyright (C) 2024-2025 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Text.Json;
using System.Threading.Tasks;
using AgOpenWeb.RemoteWiring;
using Photino.NET;

namespace AgOpenWeb.Desktop.Launcher;

/// <summary>
/// The all-in-one launcher (the desktop twin of the iOS and Android heads): one maximized window
/// that starts the in-process guidance backend and then fills itself with the local web UI. One
/// double-click = host + UI on this box, no separate browser. The host still binds 0.0.0.0, so
/// other devices on the LAN can connect too.
/// </summary>
internal sealed class WebViewLauncher
{
    private readonly PhotinoWindow _window;
    private readonly string[] _args;
    private BackendHost? _backend;
    private bool _closing;
    // Fork (start time): the backend starts at once, in parallel with the window and its web
    // view, instead of after the window exists; the window waits for it before loading the UI.
    private Task<Exception?>? _backendStart;

    public WebViewLauncher(PhotinoWindow window, string[] args)
    {
        _window = window;
        _args = args;
    }

    public void Show()
    {
        _backendStart = Task.Run(StartBackendAsync);
        _window
            .SetMaximized(true)
            .RegisterWebMessageReceivedHandler(OnWebMessage)
            .RegisterWindowClosingHandler((_, _) => LauncherEntry.StopThenClose(_window, _backend, ref _closing))
            .RegisterWindowCreatedHandler((_, _) => { StartupTrace.Mark("launcher: window created"); _ = StartAsync(); })
            .LoadRawString(LauncherEntry.SplashHtml(LauncherEntry.StartingText()));
    }

    // Off the UI thread: StartAsync builds the DI graph + VM pipeline and binds the host.
    private async Task<Exception?> StartBackendAsync()
    {
        var backend = new BackendHost();
        try
        {
            await backend.StartAsync(_args);
            _backend = backend;
            return null;
        }
        catch (Exception ex)
        {
            try { await backend.StopAsync(); } catch { /* best effort */ }
            return ex;
        }
    }

    private async Task StartAsync()
    {
        var failure = await _backendStart!;
        StartupTrace.Mark("launcher: backend ready for the window");
        if (failure != null || _backend is not { } backend)
        {
            var msg = LauncherEntry.LogStartFailure(failure ?? new InvalidOperationException("backend not started"));
            _window.Invoke(() => _window.LoadRawString(LauncherEntry.SplashHtml($"{Brand.ProductName} failed to start.\n\n{msg}")));
            StartupTrace.Write();
            return;
        }

        var port = backend.Server?.Port ?? 5174;
        // App Settings › Start Fullscreen (AgOpenGPS isStartFullScreen): the settings are loaded
        // now, so go fullscreen instead of the default maximized window (#110).
        // Fork (autostart): started with Windows (--autostart) is fullscreen too (LauncherEntry);
        // ?winfs=1 tells the page's ⛶ button the window's state.
        bool fullscreen = AgOpenWeb.Models.Configuration.ConfigurationStore.Instance.Display.StartFullscreen
            || Array.IndexOf(_args, "--autostart") >= 0;
        _window.Invoke(() =>
        {
            if (fullscreen) _window.SetFullScreen(true);
            _window.Load(new Uri($"http://localhost:{port}/" + (fullscreen ? "?winfs=1" : "")));
            StartupTrace.Mark("launcher: web UI requested");
            ScreenAwake.Hold();
        });
        Console.WriteLine($"[launcher] Backend up; window -> http://localhost:{port}/");
        StartupTrace.Write(); // again when the page reports its own phases
    }

    // The page talks to its host through window.external.sendMessage (Photino's channel):
    //   open|<url>   open a link in the system browser (window.open can't leave the web view)
    //   fullscreen|1 / fullscreen|0   window fullscreen on / off (fork: the client's ⛶ button)
    //   startup|{json}   fork: the page's start phases (wwwroot app.js, block startup:begin)
    private void OnWebMessage(object? sender, string message)
    {
        if (message.StartsWith("startup|", StringComparison.Ordinal))
        {
            LogPageMarks(message[8..]);
            _ = WarnIfFirewallMissingAsync(); // the page is ready for messages now
            return;
        }
        if (message == "fullscreen|1" || message == "fullscreen|0")
        {
            _window.SetFullScreen(message == "fullscreen|1");
            return;
        }
        if (message.StartsWith("open|", StringComparison.Ordinal))
        {
            var url = message[5..];
            if (Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https"))
                LauncherEntry.OpenUrl(url);
        }
    }

    // Fork (installer): the setup's firewall rules are missing → the page shows how to fix it.
    private bool _firewallChecked;
    private async Task WarnIfFirewallMissingAsync()
    {
        if (_firewallChecked) return;
        _firewallChecked = true;
        if (!await FirewallCheck.RulesMissingAsync()) return;
        try { _window.Invoke(() => _window.SendWebMessage("firewall|missing")); } catch { /* window closing */ }
    }

    // The page's marks are milliseconds from its own time origin (Unix ms): into the start log
    // on the process clock, then the log is written.
    private static void LogPageMarks(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            double origin = doc.RootElement.GetProperty("origin").GetDouble();
            foreach (var m in doc.RootElement.GetProperty("marks").EnumerateArray())
                StartupTrace.MarkUnixMs(m[0].GetString() ?? "page", origin + m[1].GetDouble());
        }
        catch { /* a malformed report only loses the page's marks */ }
        StartupTrace.Write();
    }
}
