// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using AgOpenWeb.Services.Import;
using NUnit.Framework;

namespace AgOpenWeb.Services.Tests.Import;

[TestFixture]
public class MgiAustriaLambertTests
{
    public record RefPoint(string Name, double Easting, double Northing, double Lat, double Lon)
    {
        public override string ToString() => Name;
    }

    // EPSG:31287 → 4326 with PROJ 9.8 / pyproj, operation "MGI to WGS 84 (3)" (EPSG:1618).
    // Regenerate with Tools/mgi-lambert-refpoints.py.
    private static readonly RefPoint[] Points =
    {
        new("Bregenz", 130050.988, 406632.816, 47.503000011, 9.746999991),
        new("Feldkirch", 117425.342, 377743.408, 47.238000007, 9.597999993),
        new("Landeck", 190243.200, 363791.128, 47.140000008, 10.565999999),
        new("Innsbruck", 254118.422, 376201.086, 47.269000002, 11.404000003),
        new("Lienz", 357007.982, 325752.147, 46.830000005, 12.768999999),
        new("Salzburg", 378463.925, 433442.370, 47.800000008, 13.045000004),
        new("Villach", 440006.841, 301276.487, 46.610000004, 13.855000002),
        new("Klagenfurt", 474681.530, 303165.117, 46.624000009, 14.308000005),
        new("Linz", 470711.926, 490078.677, 48.306000010, 14.286000003),
        new("Freistadt", 486609.786, 513088.327, 48.511000011, 14.505000006),
        new("Gmuend", 521306.788, 542407.907, 48.769000008, 14.983000005),
        new("Graz", 559921.502, 354538.885, 47.071000004, 15.439000001),
        new("Bad Radkersburg", 603040.845, 313273.068, 46.688000007, 15.988000004),
        new("St. Poelten", 570181.749, 480809.516, 48.204000010, 15.623000006),
        new("Wien", 625864.808, 483162.663, 48.208000008, 16.373000003),
        new("Eisenstadt", 638950.574, 443415.775, 47.846000009, 16.527000015),
        new("Oberwart", 617013.903, 380494.388, 47.288000007, 16.203000002),
        new("Hollabrunn", 602641.315, 521792.451, 48.563000013, 16.079000003),
        new("Laa an der Thaya", 624600.782, 539968.570, 48.719000008, 16.386000010),
        new("Mistelbach", 639037.822, 523972.430, 48.570000009, 16.573000014),
        new("Poysdorf", 642778.248, 535035.551, 48.668000007, 16.630000009),
        new("Hohenau an der March", 663264.535, 528817.771, 48.604000011, 16.904000003),
        new("Gaenserndorf", 651066.819, 498780.071, 48.339000011, 16.721000005),
        new("Retz", 592254.679, 543017.772, 48.757000007, 15.948000012),
    };

    [TestCaseSource(nameof(Points))]
    public void MatchesProjWithinOneCentimetre(RefPoint p)
    {
        var (lat, lon) = MgiAustriaLambert.ToWgs84(p.Easting, p.Northing);
        double dNorth = (lat - p.Lat) * 111_320.0;
        double dEast = (lon - p.Lon) * 111_320.0 * Math.Cos(p.Lat * Math.PI / 180.0);
        Assert.That(Math.Sqrt(dNorth * dNorth + dEast * dEast), Is.LessThan(0.01));
    }
}
