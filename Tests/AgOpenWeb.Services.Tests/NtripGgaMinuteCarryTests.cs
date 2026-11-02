// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using AgOpenWeb.Models;
using AgOpenWeb.Services;
using AgOpenWeb.Services.Interfaces;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace AgOpenWeb.Services.Tests;

/// <summary>
/// The GGA for a VRS caster: minutes that round up to 60 carry into the degrees, for latitude
/// and longitude, instead of "4760.0000".
/// </summary>
[TestFixture]
public class NtripGgaMinuteCarryTests
{
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
        var gps = Substitute.For<IGpsService>();
        gps.CurrentData.Returns(new GpsData
        {
            CurrentPosition = new Position { Latitude = 47.99999933, Longitude = 16.99999933, Altitude = 200 },
            FixQuality = 1, SatellitesInUse = 10,
        });
        using var svc = new NtripClientService(gps, NullLogger<NtripClientService>.Instance);
        var f = svc.NextGgaSentence(new NtripConfiguration())!.Split(',');
        Assert.That(f[2], Is.EqualTo("4800.0000"));
        Assert.That(f[4], Is.EqualTo("01700.0000"));
    }
}
