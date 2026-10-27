// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using AgOpenWeb.Models.Configuration;
using AgOpenWeb.Services.Gps;

namespace AgOpenWeb.Services.Tests.Gps;

[TestFixture]
[NonParallelizable] // ConfigurationStore is a singleton
public class GpsFixQualityValidatorTests
{
    [SetUp]
    public void SetUp()
    {
        var c = ConfigurationStore.Instance.Connections;
        c.MinFixQuality = 2;   // require DGPS or better
        c.MaxHdop = 2.0;
        c.MaxDifferentialAge = 5.0;
    }

    [Test]
    public void Accepts_a_good_fix()
    {
        bool ok = GpsFixQualityValidator.IsAcceptable(
            fixQuality: 4, hdop: 0.8, differentialAge: 1.0, out var reason,
            ConfigurationStore.Instance);

        Assert.Multiple(() =>
        {
            Assert.That(ok, Is.True);
            Assert.That(reason, Is.Null);
        });
    }

    [Test]
    public void Rejects_fix_quality_below_minimum()
    {
        bool ok = GpsFixQualityValidator.IsAcceptable(
            fixQuality: 1, hdop: 0.8, differentialAge: 1.0, out var reason,
            ConfigurationStore.Instance);

        Assert.Multiple(() =>
        {
            Assert.That(ok, Is.False);
            Assert.That(reason, Does.Contain("Fix quality"));
            Assert.That(reason, Does.Contain("below minimum"));
        });
    }

    [Test]
    public void Rejects_hdop_above_maximum()
    {
        bool ok = GpsFixQualityValidator.IsAcceptable(
            fixQuality: 4, hdop: 3.0, differentialAge: 1.0, out var reason,
            ConfigurationStore.Instance);

        Assert.Multiple(() =>
        {
            Assert.That(ok, Is.False);
            Assert.That(reason, Does.Contain("HDOP"));
            Assert.That(reason, Does.Contain("exceeds"));
        });
    }

    [Test]
    public void Rejects_differential_age_above_maximum()
    {
        bool ok = GpsFixQualityValidator.IsAcceptable(
            fixQuality: 4, hdop: 0.8, differentialAge: 10.0, out var reason,
            ConfigurationStore.Instance);

        Assert.Multiple(() =>
        {
            Assert.That(ok, Is.False);
            Assert.That(reason, Does.Contain("Differential age"));
        });
    }

    [Test]
    public void Zero_differential_age_is_allowed()
    {
        // differentialAge=0 means "no differential fix", not "age expired".
        bool ok = GpsFixQualityValidator.IsAcceptable(
            fixQuality: 4, hdop: 0.8, differentialAge: 0.0, out var reason,
            ConfigurationStore.Instance);

        Assert.Multiple(() =>
        {
            Assert.That(ok, Is.True);
            Assert.That(reason, Is.Null);
        });
    }

    // The GGA scale is not ordered by quality: compare by goodness.
    [TestCase(4, 4, true)]
    [TestCase(5, 4, false)]   // RTK float is not RTK fixed
    [TestCase(6, 4, false)]   // estimated (dead reckoning)
    [TestCase(7, 4, false)]   // manual input
    [TestCase(8, 4, false)]   // simulation
    [TestCase(4, 5, true)]    // RTK fixed is better than the RTK float minimum
    [TestCase(5, 5, true)]
    [TestCase(2, 5, false)]
    [TestCase(5, 2, true)]
    [TestCase(3, 2, true)]    // PPS counts as DGPS
    [TestCase(6, 2, false)]
    [TestCase(1, 2, false)]
    [TestCase(0, 0, true)]    // no minimum: every fix
    [TestCase(8, 0, true)]
    public void Fix_quality_is_compared_by_goodness(int fixQuality, int minimum, bool accepted)
    {
        ConfigurationStore.Instance.Connections.MinFixQuality = minimum;
        bool ok = GpsFixQualityValidator.IsAcceptable(fixQuality, 0.8, 1.0, out _, ConfigurationStore.Instance);
        Assert.That(ok, Is.EqualTo(accepted));
    }
}
