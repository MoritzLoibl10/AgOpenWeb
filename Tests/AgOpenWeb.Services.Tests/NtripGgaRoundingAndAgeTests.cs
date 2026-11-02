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
/// The GGA for a VRS caster: minutes that round up to 60 carry into the degrees (latitude and
/// longitude), and a lost fix stands in for at most 300 s, then the field origin as before a fix.
/// </summary>
[TestFixture]
[NonParallelizable] // swaps the global clock
public class NtripGgaRoundingAndAgeTests
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

    private static string[] Fields(string gga) => gga.Split(',');

    [TestCase(47.9999999, 2, "4800.0000")]   // 59.999994' rounds to 60 → next degree
    [TestCase(47.99999933, 2, "4800.0000")]  // 59.99996'
    [TestCase(47.9999983, 2, "4759.9999")]   // 59.9999' stays
    [TestCase(48.0, 2, "4800.0000")]
    [TestCase(16.9999999, 3, "01700.0000")]  // longitude, three degree digits
    [TestCase(-16.9999999, 3, "01700.0000")] // the sign is the hemisphere letter
    [TestCase(9.5, 3, "00930.0000")]
    public void Minutes_carry_into_degrees(double value, int digits, string expected) =>
        Assert.That(NtripClientService.NmeaDegreesMinutes(value, digits), Is.EqualTo(expected));

    [Test]
    public void Gga_never_says_60_minutes_for_latitude_or_longitude()
    {
        _gps.CurrentData.Returns(Fix(47.99999933, 16.99999933));
        var f = Fields(_svc.NextGgaSentence(new NtripConfiguration())!);
        Assert.That(f[2], Is.EqualTo("4800.0000"));
        Assert.That(f[3], Is.EqualTo("N"));
        Assert.That(f[4], Is.EqualTo("01700.0000"));
        Assert.That(f[5], Is.EqualTo("E"));
    }

    [Test]
    public void A_lost_fix_stands_in_for_300_s_then_the_field_origin()
    {
        var config = new NtripConfiguration { FallbackPositionProvider = () => (48.5, 16.5) };
        _gps.CurrentData.Returns(Fix(48.2, 17.1));
        Assert.That(Fields(_svc.NextGgaSentence(config)!)[2], Is.EqualTo("4812.0000"));

        _gps.CurrentData.Returns(new GpsData()); // fix lost
        _clock.AdvanceSeconds(300);
        Assert.That(Fields(_svc.NextGgaSentence(config)!)[2], Is.EqualTo("4812.0000"), "300 s: still the last fix");

        _clock.AdvanceSeconds(1);
        Assert.That(Fields(_svc.NextGgaSentence(config)!)[2], Is.EqualTo("4830.0000"), "older: the field origin");
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
