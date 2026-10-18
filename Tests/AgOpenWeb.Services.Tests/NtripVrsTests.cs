using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using AgOpenWeb.Models;
using AgOpenWeb.Services;
using AgOpenWeb.Services.Interfaces;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace AgOpenWeb.Services.Tests;

/// <summary>
/// Network RTK (VRS) casters such as APOS (BEV, Austria): the request in NTRIP 1 and 2, the
/// GGA position the caster needs, and the caster's own words when it turns us away.
/// </summary>
[TestFixture]
[NonParallelizable]
public class NtripVrsTests
{
    // ── Request ──────────────────────────────────────────────────────────

    [Test]
    public void Request_Ntrip1()
    {
        string r = NtripRequest.Build(1, "aposrtk.bev.gv.at", 2201, "APOS_Standard", "user", "pass");
        var lines = r.Split("\r\n");
        Assert.That(lines[0], Is.EqualTo("GET /APOS_Standard HTTP/1.0"));
        Assert.That(r, Does.Not.Contain("Ntrip-Version"));
        Assert.That(lines.Single(l => l.StartsWith("User-Agent: ")), Does.StartWith("User-Agent: NTRIP "));
        Assert.That(lines, Does.Contain("Authorization: Basic " + Convert.ToBase64String(Encoding.ASCII.GetBytes("user:pass"))));
        Assert.That(lines, Does.Contain("Authorization: Basic dXNlcjpwYXNz"));
        Assert.That(r, Does.EndWith("\r\n\r\n"));
        Assert.That(r.Replace("\r\n", ""), Does.Not.Contain("\n"), "every line ends in CRLF");
    }

    [Test]
    public void Request_Ntrip2()
    {
        string r = NtripRequest.Build(2, "aposrtk.bev.gv.at", 2201, "APOS_Standard", "user", "pass");
        var lines = r.Split("\r\n");
        Assert.That(lines[0], Is.EqualTo("GET /APOS_Standard HTTP/1.1"));
        Assert.That(lines, Does.Contain("Host: aposrtk.bev.gv.at:2201"));
        Assert.That(lines, Does.Contain("Ntrip-Version: Ntrip/2.0"));
        Assert.That(lines.Single(l => l.StartsWith("User-Agent: ")), Does.StartWith("User-Agent: NTRIP "));
        Assert.That(lines, Does.Contain("Authorization: Basic dXNlcjpwYXNz"));
        Assert.That(r, Does.EndWith("\r\n\r\n"));
    }

    [Test]
    public void Request_WithoutLogin_HasNoAuthorization()
    {
        Assert.That(NtripRequest.Build(1, "h", 2101, "M", "", ""), Does.Not.Contain("Authorization"));
    }

    [TestCase(0, 1)]
    [TestCase(1, 1)]
    [TestCase(2, 2)]
    [TestCase(3, 1)]
    public void UnknownVersions_UseNtrip1(int given, int used) =>
        Assert.That(NtripRequest.NormalizeVersion(given), Is.EqualTo(used));

    // ── Reply ────────────────────────────────────────────────────────────

    [TestCase("ICY 200 OK", NtripReply.Accepted)]
    [TestCase("HTTP/1.1 200 OK\r\nNtrip-Version: Ntrip/2.0\r\nContent-Type: gnss/data", NtripReply.Accepted)]
    [TestCase("HTTP/1.1 200 OK\r\nNtrip-Version: Ntrip/2.0\r\nContent-Type: gnss/sourcetable", NtripReply.Rejected)]
    public void Classify_Ntrip1And2(string header, NtripReply expected) =>
        Assert.That(NtripResponse.Classify(header).Reply, Is.EqualTo(expected));

    [Test]
    public void Preview_ShowsTheFirstLines()
    {
        var raw = Encoding.ASCII.GetBytes("HTTP/1.1 403 Forbidden\r\nServer: Caster\r\n\r\nPosition outside network\r\nmore\r\n");
        Assert.That(NtripResponse.Preview(raw), Is.EqualTo("HTTP/1.1 403 Forbidden | Server: Caster | Position outside network"));
        Assert.That(NtripResponse.Preview(new byte[] { 0xD3, 0x00, 0x41 }), Is.EqualTo("··A"));
        Assert.That(NtripResponse.Preview(Array.Empty<byte>()), Is.EqualTo(""));
    }

    // ── GGA ──────────────────────────────────────────────────────────────

    private static GpsData Fix(int quality, double lat = 48.2082, double lon = 16.3738, int sats = 9) => new()
    {
        CurrentPosition = new Position { Latitude = lat, Longitude = lon, Altitude = 171.4 },
        FixQuality = quality,
        SatellitesInUse = sats,
        // What the guidance gate does to anything below RTK fixed (default MinFixQuality 4).
        IsValid = quality == 4,
    };

    private static NtripClientService Client(IGpsService gps, out ConcurrentQueue<NtripConnectionEventArgs> events)
    {
        var svc = new NtripClientService(gps, NullLogger<NtripClientService>.Instance);
        var q = new ConcurrentQueue<NtripConnectionEventArgs>();
        svc.ConnectionStatusChanged += (_, e) => q.Enqueue(e);
        events = q;
        return svc;
    }

    private static IGpsService Gps(GpsData? data)
    {
        var gps = Substitute.For<IGpsService>();
        gps.CurrentData.Returns(data!);
        return gps;
    }

    private static void AssertValidGga(string gga)
    {
        Assert.That(gga, Does.Match(@"^\$GPGGA,[^*]+\*[0-9A-F]{2}$"), gga);
        string body = gga[1..gga.IndexOf('*')];
        byte sum = 0;
        foreach (char c in body) sum ^= (byte)c;
        Assert.That(gga[^2..], Is.EqualTo(sum.ToString("X2")), "checksum");
        var f = body.Split(',');
        Assert.That(int.Parse(f[6]), Is.GreaterThan(0), "fix quality");
        Assert.That(f, Has.Length.EqualTo(15));
    }

    [Test]
    public void Gga_UsesAFixBelowTheGuidanceGate()
    {
        // A receiver without corrections has a plain GPS fix: IsValid is false (the guidance
        // gate wants RTK fixed), but it is exactly the position the VRS caster needs.
        var svc = Client(Gps(Fix(1)), out _);
        SetConfig(svc, new NtripConfiguration());
        Assert.That(svc.TryBuildGga(out string gga), Is.True);
        AssertValidGga(gga);
        var f = gga.Split('*')[0].Split(',');
        Assert.That(f[2], Is.EqualTo("4812.4920"));
        Assert.That(f[3], Is.EqualTo("N"));
        Assert.That(f[4], Is.EqualTo("01622.4280"));
        Assert.That(f[5], Is.EqualTo("E"));
        Assert.That(f[6], Is.EqualTo("1"));
    }

    [Test]
    public void Gga_WithoutAnyFix_IsNotSent_NeverAMadeUpPosition()
    {
        var svc = Client(Gps(Fix(0)), out _);
        SetConfig(svc, new NtripConfiguration());
        Assert.That(svc.TryBuildGga(out _), Is.False);
    }

    [Test]
    public void Gga_KeepsTheLastFix_WhenTheReceiverLosesIt()
    {
        var data = Fix(5);
        var svc = Client(Gps(data), out _);
        SetConfig(svc, new NtripConfiguration());
        Assert.That(svc.TryBuildGga(out _), Is.True);
        data.FixQuality = 0;
        Assert.That(svc.TryBuildGga(out string gga), Is.True);
        Assert.That(gga.Split(',')[6], Is.EqualTo("5"));
    }

    [Test]
    public void Gga_MinutesNeverRoundTo60()
    {
        var svc = Client(Gps(Fix(1, lat: 47.99999999, lon: 15.99999999)), out _);
        SetConfig(svc, new NtripConfiguration());
        Assert.That(svc.TryBuildGga(out string gga), Is.True);
        var f = gga.Split(',');
        Assert.That(f[2], Is.EqualTo("4800.0000"));
        Assert.That(f[4], Is.EqualTo("01600.0000"));
    }

    private static void SetConfig(NtripClientService svc, NtripConfiguration c) =>
        typeof(NtripClientService).GetField("_config",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.SetValue(svc, c);

    // ── A VRS caster on loopback ─────────────────────────────────────────

    /// <summary>Accepts each connection, records what the client sends, and runs the script
    /// with the stream and the received text so far.</summary>
    private sealed class FakeCaster : IDisposable
    {
        private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
        private readonly CancellationTokenSource _cts = new();
        public int Port => ((IPEndPoint)_listener.LocalEndpoint).Port;
        public readonly ConcurrentQueue<string> Received = new();
        public int Accepted;

        public FakeCaster(Func<NetworkStream, FakeCaster, Task> script)
        {
            _listener.Start();
            _ = Task.Run(async () =>
            {
                while (!_cts.IsCancellationRequested)
                {
                    TcpClient client;
                    try { client = await _listener.AcceptTcpClientAsync(_cts.Token); }
                    catch { return; }
                    Interlocked.Increment(ref Accepted);
                    _ = Task.Run(async () =>
                    {
                        using (client)
                        {
                            var stream = client.GetStream();
                            _ = Task.Run(async () =>
                            {
                                var buf = new byte[4096];
                                try
                                {
                                    int n;
                                    while ((n = await stream.ReadAsync(buf, 0, buf.Length)) > 0)
                                        Received.Enqueue(Encoding.ASCII.GetString(buf, 0, n));
                                }
                                catch { /* closed */ }
                            });
                            try { await script(stream, this); } catch { /* client went away */ }
                        }
                    });
                }
            });
        }

        public string All => string.Concat(Received);
        public string[] Ggas => All.Split("\r\n").Where(l => l.StartsWith("$GPGGA")).ToArray();

        public void Dispose() { _cts.Cancel(); _listener.Stop(); }
    }

    private static async Task Send(NetworkStream s, string text)
    {
        var b = Encoding.Latin1.GetBytes(text);
        await s.WriteAsync(b, 0, b.Length);
        await s.FlushAsync();
    }

    private static bool WaitFor(Func<bool> cond, int ms)
    {
        var until = DateTime.UtcNow.AddMilliseconds(ms);
        while (DateTime.UtcNow < until) { if (cond()) return true; Thread.Sleep(20); }
        return cond();
    }

    private static NtripConfiguration Config(int port, int version, int ggaSeconds = 10) => new()
    {
        CasterAddress = "127.0.0.1", CasterPort = port, MountPoint = "APOS_Standard",
        Username = "user", Password = "pass", SubnetAddress = "127.0.0", UdpForwardPort = 0,
        GgaIntervalSeconds = ggaSeconds, NtripVersion = version,
    };

    /// <summary>Like a VRS caster: accept, then close unless a GGA arrives within 2 s; with
    /// one, stream RTCM.</summary>
    private static async Task VrsScript(NetworkStream s, FakeCaster c, string reply)
    {
        await Send(s, reply);
        if (!WaitFor(() => c.Ggas.Length > 0, 2000)) return; // close: no position, no VRS
        for (int i = 0; i < 10; i++) { await Send(s, "\xD3\x00\x13rtcm-epoch"); await Task.Delay(200); }
    }

    [TestCase(1, "ICY 200 OK\r\n")]
    [TestCase(2, "HTTP/1.1 200 OK\r\nNtrip-Version: Ntrip/2.0\r\nContent-Type: gnss/data\r\n\r\n")]
    public async Task VrsCaster_GetsAGgaRightAway_AndSendsCorrections(int version, string reply)
    {
        using var caster = new FakeCaster((s, c) => VrsScript(s, c, reply));
        var svc = Client(Gps(Fix(1)), out var events);
        await svc.ConnectAsync(Config(caster.Port, version));

        Assert.That(WaitFor(() => svc.TotalBytesReceived > 0, 3000), Is.True,
            string.Join(" / ", events.Select(e => e.Message)));
        Assert.That(svc.IsConnected, Is.True);
        Assert.That(caster.All, Does.StartWith(version == 2 ? "GET /APOS_Standard HTTP/1.1\r\n" : "GET /APOS_Standard HTTP/1.0\r\n"));
        Assert.That(caster.All, Does.Contain("\r\nUser-Agent: NTRIP "));
        var gga = caster.Ggas.First();
        AssertValidGga(gga);
        Assert.That(caster.All, Does.Contain(gga + "\r\n"), "GGA ends in CRLF");
        Assert.That(caster.Accepted, Is.EqualTo(1));
        svc.Dispose();
    }

    [Test]
    public async Task Ntrip1_SendsTheGgaWithTheRequest_ForCastersThatAnswerOnlyThen()
    {
        using var caster = new FakeCaster(async (s, c) =>
        {
            if (!WaitFor(() => c.Ggas.Length > 0, 2000)) return;
            await Send(s, "ICY 200 OK\r\n");
            await Send(s, "\xD3\x00\x13rtcm");
            await Task.Delay(2000);
        });
        var svc = Client(Gps(Fix(2)), out _);
        await svc.ConnectAsync(Config(caster.Port, 1));
        Assert.That(WaitFor(() => svc.TotalBytesReceived > 0, 3000), Is.True);
        svc.Dispose();
    }

    [Test]
    public async Task Gga_IsRepeatedEveryInterval()
    {
        using var caster = new FakeCaster(async (s, c) =>
        {
            await Send(s, "ICY 200 OK\r\n");
            for (int i = 0; i < 20; i++) { await Send(s, "\xD3\x00\x13rtcm"); await Task.Delay(200); }
        });
        var svc = Client(Gps(Fix(1)), out _);
        await svc.ConnectAsync(Config(caster.Port, 2, ggaSeconds: 1));
        Assert.That(WaitFor(() => caster.Ggas.Length >= 3, 3500), Is.True, $"{caster.Ggas.Length} GGAs");
        foreach (var g in caster.Ggas) AssertValidGga(g);
        svc.Dispose();
    }

    [Test]
    public async Task NoFix_NoGga_AndTheCloseSaysWhy()
    {
        using var caster = new FakeCaster((s, c) => VrsScript(s, c, "ICY 200 OK\r\n"));
        var svc = Client(Gps(Fix(0)), out var events);
        await svc.ConnectAsync(Config(caster.Port, 1));

        Assert.That(WaitFor(() => events.Any(e => e.Message?.Contains("before sending corrections") == true), 4000), Is.True);
        string msg = events.First(e => e.Message!.Contains("before sending corrections")).Message!;
        Assert.That(msg, Does.Contain("Caster replied: \"ICY 200 OK\""));
        Assert.That(msg, Does.Contain("no GGA position sent"));
        Assert.That(caster.Ggas, Is.Empty, "no made-up position");
        await svc.DisconnectAsync();
        svc.Dispose();
    }

    [Test]
    public async Task TextAfterTheReply_IsShownWhenTheCasterCloses()
    {
        using var caster = new FakeCaster(async (s, c) =>
        {
            await Send(s, "ICY 200 OK\r\n");
            await Send(s, "Position outside of the network\r\n");
        });
        var svc = Client(Gps(Fix(1)), out var events);
        await svc.ConnectAsync(Config(caster.Port, 1));
        Assert.That(WaitFor(() => events.Any(e => e.Message?.Contains("Position outside of the network") == true), 3000), Is.True,
            string.Join(" / ", events.Select(e => e.Message)));
        Assert.That(events.Last(e => e.Message!.Contains("outside")).Message, Does.Contain("GGA position sent"));
        await svc.DisconnectAsync();
        svc.Dispose();
    }

    [Test]
    public async Task Rejection_ShowsTheRawReply()
    {
        using var caster = new FakeCaster(async (s, c) =>
            await Send(s, "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"/APOS_Standard\"\r\n\r\n"));
        var svc = Client(Gps(Fix(1)), out var events);
        await svc.ConnectAsync(Config(caster.Port, 2));
        Assert.That(WaitFor(() => events.Any(e => e.Message?.StartsWith("Rejected") == true), 3000), Is.True);
        string msg = events.Last().Message!;
        Assert.That(msg, Does.Contain("Authentication failed"));
        Assert.That(msg, Does.Contain("HTTP/1.1 401 Unauthorized | WWW-Authenticate: Basic realm=\"/APOS_Standard\""));
        svc.Dispose();
    }

    [Test]
    public async Task Tester_ShowsTheRawReply_AndUsesTheVersion()
    {
        using var caster = new FakeCaster(async (s, c) =>
        {
            WaitFor(() => c.All.Contains("\r\n\r\n"), 1000);
            await Send(s, "ERROR - Bad Mountpoint\r\n");
        });
        string result = await NtripConnectionTester.TestAsync("127.0.0.1", caster.Port, "APOS_Standard", "user", "pass", 1);
        Assert.That(result, Is.EqualTo("Error: ERROR - Bad Mountpoint"));
        Assert.That(WaitFor(() => caster.All.StartsWith("GET /APOS_Standard HTTP/1.0\r\n"), 1000), Is.True, caster.All);

        using var caster2 = new FakeCaster(async (s, c) =>
        {
            WaitFor(() => c.All.Contains("\r\n\r\n"), 1000);
            await Send(s, "HTTP/1.1 403 Forbidden\r\nServer: X\r\n\r\n");
        });
        result = await NtripConnectionTester.TestAsync("127.0.0.1", caster2.Port, "M", "u", "p", 2);
        Assert.That(result, Does.Contain("Caster replied: \"HTTP/1.1 403 Forbidden | Server: X\""));
        Assert.That(WaitFor(() => caster2.All.Contains("Ntrip-Version: Ntrip/2.0\r\n"), 1000), Is.True, caster2.All);
    }
}
