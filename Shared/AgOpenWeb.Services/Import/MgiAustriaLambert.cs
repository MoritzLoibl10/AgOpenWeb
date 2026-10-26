// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System;

namespace AgOpenWeb.Services.Import;

/// <summary>
/// EPSG:31287 (MGI / Austria Lambert) → WGS84, the system the AMA publishes INVEKOS in.
/// The same operation PROJ picks for all of Austria: inverse Lambert Conformal Conic 2SP on
/// Bessel 1841, then "MGI to WGS 84 (3)" (EPSG:1618), a 7-parameter Helmert in the
/// position-vector convention, EPSG accuracy 1.5 m. Height is taken as 0 on the Bessel
/// ellipsoid and dropped, as in PROJ's 2D pipeline.
/// </summary>
public static class MgiAustriaLambert
{
    // Austria Lambert (EPSG:3416 conversion)
    private const double Lat0 = 47.5, Lon0 = 13.0 + 20.0 / 60.0, Lat1 = 49.0, Lat2 = 46.0;
    private const double FalseEasting = 400000.0, FalseNorthing = 400000.0;

    // Bessel 1841 and WGS84
    private const double BesselA = 6377397.155, BesselInvF = 299.1528128;
    private const double Wgs84A = 6378137.0, Wgs84InvF = 298.257223563;

    // EPSG:1618 MGI to WGS 84 (3), position vector
    private const double Tx = 577.326, Ty = 90.129, Tz = 463.919;
    private const double RxSec = 5.137, RySec = 1.474, RzSec = 5.297, ScalePpm = 2.4232;

    private static readonly double BesselE2, BesselE, N, F, Rho0;

    static MgiAustriaLambert()
    {
        double f = 1.0 / BesselInvF;
        BesselE2 = f * (2 - f);
        BesselE = Math.Sqrt(BesselE2);
        double phi0 = ToRad(Lat0), phi1 = ToRad(Lat1), phi2 = ToRad(Lat2);
        double m1 = M(phi1), m2 = M(phi2);
        double t0 = T(phi0), t1 = T(phi1), t2 = T(phi2);
        N = (Math.Log(m1) - Math.Log(m2)) / (Math.Log(t1) - Math.Log(t2));
        F = m1 / (N * Math.Pow(t1, N));
        Rho0 = BesselA * F * Math.Pow(t0, N);
    }

    /// <summary>Easting/northing in metres → WGS84 latitude/longitude in degrees.</summary>
    public static (double Latitude, double Longitude) ToWgs84(double easting, double northing)
    {
        var (phi, lam) = InverseLambert(easting, northing);
        var (x, y, z) = GeodeticToCartesian(phi, lam, BesselA, BesselE2);

        const double secToRad = Math.PI / (180.0 * 3600.0);
        double rx = RxSec * secToRad, ry = RySec * secToRad, rz = RzSec * secToRad;
        double s = 1.0 + ScalePpm * 1e-6;
        double x2 = Tx + s * (x - rz * y + ry * z);
        double y2 = Ty + s * (rz * x + y - rx * z);
        double z2 = Tz + s * (-ry * x + rx * y + z);

        double wf = 1.0 / Wgs84InvF;
        var (lat, lon) = CartesianToGeodetic(x2, y2, z2, Wgs84A, wf * (2 - wf));
        return (lat * 180.0 / Math.PI, lon * 180.0 / Math.PI);
    }

    private static (double Phi, double Lambda) InverseLambert(double easting, double northing)
    {
        double dx = easting - FalseEasting;
        double dy = Rho0 - (northing - FalseNorthing);
        double rho = Math.Sign(N) * Math.Sqrt(dx * dx + dy * dy);
        double theta = Math.Atan2(dx, dy);
        double t = Math.Pow(rho / (BesselA * F), 1.0 / N);

        double phi = Math.PI / 2 - 2 * Math.Atan(t);
        for (int i = 0; i < 15; i++)
        {
            double es = BesselE * Math.Sin(phi);
            double next = Math.PI / 2 - 2 * Math.Atan(t * Math.Pow((1 - es) / (1 + es), BesselE / 2));
            if (Math.Abs(next - phi) < 1e-14) { phi = next; break; }
            phi = next;
        }
        return (phi, theta / N + ToRad(Lon0));
    }

    private static (double X, double Y, double Z) GeodeticToCartesian(double phi, double lam, double a, double e2)
    {
        double sin = Math.Sin(phi);
        double nu = a / Math.Sqrt(1 - e2 * sin * sin);
        return (nu * Math.Cos(phi) * Math.Cos(lam), nu * Math.Cos(phi) * Math.Sin(lam), nu * (1 - e2) * sin);
    }

    private static (double Phi, double Lambda) CartesianToGeodetic(double x, double y, double z, double a, double e2)
    {
        double p = Math.Sqrt(x * x + y * y);
        double phi = Math.Atan2(z, p * (1 - e2));
        for (int i = 0; i < 10; i++)
        {
            double sin = Math.Sin(phi);
            double nu = a / Math.Sqrt(1 - e2 * sin * sin);
            double next = Math.Atan2(z + e2 * nu * sin, p);
            if (Math.Abs(next - phi) < 1e-14) { phi = next; break; }
            phi = next;
        }
        return (phi, Math.Atan2(y, x));
    }

    private static double M(double phi)
    {
        double sin = Math.Sin(phi);
        return Math.Cos(phi) / Math.Sqrt(1 - BesselE2 * sin * sin);
    }

    private static double T(double phi)
    {
        double es = BesselE * Math.Sin(phi);
        return Math.Tan(Math.PI / 4 - phi / 2) / Math.Pow((1 - es) / (1 + es), BesselE / 2);
    }

    private static double ToRad(double deg) => deg * Math.PI / 180.0;
}
