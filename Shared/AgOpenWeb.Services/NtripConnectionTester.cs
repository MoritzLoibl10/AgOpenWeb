// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

using System;
using System.Threading.Tasks;

namespace AgOpenWeb.Services;

/// <summary>
/// One-shot NTRIP caster reachability probe: opens a TCP connection, sends the
/// mount-point request in the profile's NTRIP version, and classifies the response. Returns a
/// human-readable status string (success / auth-failed / not-found / timeout /
/// error). Pure network IO with no UI or VM dependency, so the native profile
/// editor and the remote (web) Network IO editor share the exact same logic.
/// </summary>
public static class NtripConnectionTester
{
    public static async Task<string> TestAsync(string host, int port, string mountPoint,
        string username, string password, int ntripVersion = 1)
    {
        if (string.IsNullOrWhiteSpace(host)) return "Error: Caster host is required";
        if (string.IsNullOrWhiteSpace(mountPoint)) return "Error: Mount point is required";

        try
        {
            using var tcpClient = new System.Net.Sockets.TcpClient();
            var connectTask = tcpClient.ConnectAsync(host, port);

            if (await Task.WhenAny(connectTask, Task.Delay(5000)) != connectTask)
                return "Error: Connection timed out";
            if (!tcpClient.Connected)
                return "Error: Could not connect to caster";

            using var stream = tcpClient.GetStream();
            var request = NtripRequest.Build(ntripVersion, host, port, mountPoint, username, password);

            var requestBytes = System.Text.Encoding.ASCII.GetBytes(request);
            await stream.WriteAsync(requestBytes, 0, requestBytes.Length);

            var buffer = new byte[1024];
            var readTask = stream.ReadAsync(buffer, 0, buffer.Length);
            if (await Task.WhenAny(readTask, Task.Delay(3000)) != readTask)
                return "Error: No reply from the caster";
            var bytesRead = await readTask;
            if (bytesRead == 0)
                return "Error: Caster closed the connection without answering";

            var response = System.Text.Encoding.ASCII.GetString(buffer, 0, bytesRead);
            var (reply, reason) = NtripResponse.Classify(response);
            if (reply == NtripReply.Accepted)
                return "Success: Connected to caster and mount point";
            // The caster's own words, so the reason for a refusal is visible.
            string raw = NtripResponse.Preview(buffer.AsSpan(0, bytesRead));
            return reason.Contains(raw, StringComparison.Ordinal)
                ? "Error: " + reason
                : $"Error: {reason}. Caster replied: \"{raw}\"";
        }
        catch (Exception ex)
        {
            return $"Error: {ex.Message}";
        }
    }
}
