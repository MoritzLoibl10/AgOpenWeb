// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Globalization;
using System.Text;

namespace AgOpenWeb.Services;

/// <summary>
/// The mount-point request a client sends (the client and the connection tester share it).
/// NTRIP 1: "GET /mount HTTP/1.0", the caster answers "ICY 200 OK". NTRIP 2: "GET /mount
/// HTTP/1.1" with "Host" and "Ntrip-Version: Ntrip/2.0", the caster answers "HTTP/1.1 200 OK".
/// Casters recognise NTRIP clients by a User-Agent that starts with "NTRIP ".
/// </summary>
public static class NtripRequest
{
    public const string UserAgent = "NTRIP AgOpenWeb/1.0";

    /// <summary>1 or 2; anything else is treated as 1 (the most widely supported).</summary>
    public static int NormalizeVersion(int version) => version == 2 ? 2 : 1;

    public static string Build(int version, string host, int port, string mountPoint,
        string username, string password, string userAgent = UserAgent)
    {
        // NTRIP is invariant: interpolations must not pick up locale formatting.
        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        string mount = (mountPoint ?? "").Trim().TrimStart('/');
        if (NormalizeVersion(version) == 2)
        {
            sb.Append(inv, $"GET /{mount} HTTP/1.1\r\n");
            sb.Append(inv, $"Host: {host}{(port == 80 ? "" : ":" + port.ToString(inv))}\r\n");
            sb.Append("Ntrip-Version: Ntrip/2.0\r\n");
        }
        else
        {
            sb.Append(inv, $"GET /{mount} HTTP/1.0\r\n");
        }
        sb.Append(inv, $"User-Agent: {userAgent}\r\n");
        if (!string.IsNullOrEmpty(username) || !string.IsNullOrEmpty(password))
        {
            string credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{username}:{password}"));
            sb.Append(inv, $"Authorization: Basic {credentials}\r\n");
        }
        sb.Append("Accept: */*\r\n");
        sb.Append("Connection: close\r\n");
        sb.Append("\r\n");
        return sb.ToString();
    }
}
