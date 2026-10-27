// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System.Globalization;
using AgOpenWeb.Models.Configuration;

namespace AgOpenWeb.Services.Gps;

/// <summary>
/// Fix-quality gate extracted from <c>NmeaParserService.ParsePANDA</c>. A fix
/// is acceptable when its quality, HDOP, and differential age are all within
/// the user-configured thresholds. Called by the cycle worker at the top of
/// each tick — rejected fixes abort the cycle without writing state.
/// </summary>
public static class GpsFixQualityValidator
{
    /// <summary>
    /// Evaluate a parsed fix against <see cref="ConnectionConfig"/> thresholds.
    /// </summary>
    /// <param name="fixQuality">GGA fix-quality value (0 = invalid … 4 = RTK fixed); compared with
    /// the minimum by <see cref="Rank"/>.</param>
    /// <param name="hdop">Horizontal dilution of precision.</param>
    /// <param name="differentialAge">Age of differential corrections, seconds.
    /// Zero means no differential, which passes the age check.</param>
    /// <param name="rejectionReason">Populated with a human-readable reason
    /// when the method returns false; null on success.</param>
    /// <param name="configStore">Configuration store providing the connection thresholds.</param>
    public static bool IsAcceptable(int fixQuality, double hdop, double differentialAge,
        out string? rejectionReason, ConfigurationStore configStore)
    {
        var config = configStore.Connections;

        // By goodness, not by number: the GGA scale is not ordered (5 = RTK float is worse than
        // 4 = RTK fixed; 6–8 are estimated, manual and simulated positions).
        if (Rank(fixQuality) < Rank(config.MinFixQuality))
        {
            rejectionReason = $"Fix quality {fixQuality} below minimum {config.MinFixQuality}";
            return false;
        }

        if (hdop > config.MaxHdop)
        {
            rejectionReason = $"HDOP {hdop.ToString("F1", CultureInfo.InvariantCulture)} "
                + $"exceeds maximum {config.MaxHdop.ToString("F1", CultureInfo.InvariantCulture)}";
            return false;
        }

        // differentialAge == 0 means no differential fix at all — not an age problem.
        if (differentialAge > 0 && differentialAge > config.MaxDifferentialAge)
        {
            rejectionReason = $"Differential age {differentialAge.ToString("F1", CultureInfo.InvariantCulture)}s "
                + $"exceeds maximum {config.MaxDifferentialAge.ToString("F1", CultureInfo.InvariantCulture)}s";
            return false;
        }

        rejectionReason = null;
        return true;
    }

    /// <summary>
    /// How good a GGA fix quality is: RTK fixed (4) > RTK float (5) > DGPS (2) and PPS (3) >
    /// estimated (6) > autonomous GPS (1) > none (0); manual (7), simulation (8) and unknown
    /// values rank as none. The order for 0–6 is the one NmeaParserServiceFast already uses to
    /// pick the best GNS mode; a minimum of 0 still accepts every fix.
    /// </summary>
    public static int Rank(int fixQuality) => fixQuality switch { 4 => 5, 5 => 4, 2 => 3, 3 => 3, 6 => 2, 1 => 1, _ => 0 };
}
