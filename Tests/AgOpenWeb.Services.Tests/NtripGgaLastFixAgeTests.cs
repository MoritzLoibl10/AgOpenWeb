// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using AgOpenWeb.Models;
using AgOpenWeb.Models.Timing;
using AgOpenWeb.Services;
using AgOpenWeb.Services.Interfaces;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace AgOpenWeb.Services.Tests;

/// <summary>
/// The GGA for a VRS caster after the fix is lost: the last fix stands in for at most 300 s, then
/// the field origin as before a fix (or no GGA without one).
/// </summary>
[TestFixture]
[NonParallelizable] // swaps the global clock
public class NtripGgaLastFixAgeTests
{
    private IGpsService _gps = null!;
    private NtripClientService _svc = null!;
    private TestClock _clock = null!;

    [SetUp]
    public void SetUp()
    {
        _clock = new TestClock();
        Clock.Set(_clock);
        _gps = Substitute.For<IGpsService>();
        _svc = new NtripClientService(_gps, NullLogger<NtripClientService>.Instance);
    }

    [TearDown]
    public void TearDown()
    {
        _svc.Dispose();
        Clock.Reset();
    }

    private static GpsData Fix(double lat, double lon) => new()
    {
        CurrentPosition = new Position { Latitude = lat, Longitude = lon, Altitude = 200 },
        FixQuality = 1,
        SatellitesInUse = 10,
    };

    private static string Lat(string gga) => gga.Split(',')[2];

    [Test]
    public void A_lost_fix_stands_in_for_300_s_then_the_field_origin()
    {
        var config = new NtripConfiguration { FallbackPositionProvider = () => (48.5, 16.5) };
        _gps.CurrentData.Returns(Fix(48.2, 17.1));
        Assert.That(Lat(_svc.NextGgaSentence(config)!), Is.EqualTo("4812.0000"));

        _gps.CurrentData.Returns(new GpsData()); // fix lost
        _clock.AdvanceSeconds(300);
        Assert.That(Lat(_svc.NextGgaSentence(config)!), Is.EqualTo("4812.0000"), "300 s: still the last fix");

        _clock.AdvanceSeconds(1);
        Assert.That(Lat(_svc.NextGgaSentence(config)!), Is.EqualTo("4830.0000"), "older: the field origin");
    }

    [Test]
    public void A_stale_fix_without_a_field_origin_sends_nothing()
    {
        _gps.CurrentData.Returns(Fix(48.2, 17.1));
        Assert.That(_svc.NextGgaSentence(new NtripConfiguration()), Is.Not.Null);
        _gps.CurrentData.Returns(new GpsData());
        _clock.AdvanceSeconds(301);
        Assert.That(_svc.NextGgaSentence(new NtripConfiguration()), Is.Null);
    }
}
