// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System;
using System.IO;
using System.Text;

namespace AgOpenWeb.RemoteServer;

/// <summary>
/// Fork (host-paket D, #7): joins the pieces of one WebSocket text message into the whole
/// command. Before, every 1 KB piece was run as a command of its own (the tail of a long one as
/// a "command" too). A message over <see cref="MaxBytes"/> is dropped whole, never cut.
/// </summary>
internal sealed class CommandAssembler
{
    /// <summary>Longest command accepted (the largest today, a bug report text, is far below).</summary>
    public const int MaxBytes = 64 * 1024;

    private readonly MemoryStream _buf = new();
    private bool _tooLong;

    /// <summary>Adds one piece; returns the whole command at the message's end, else null
    /// (also for an empty or too long message).</summary>
    public string? Add(ReadOnlySpan<byte> piece, bool endOfMessage)
    {
        if (!_tooLong)
        {
            if (_buf.Length + piece.Length > MaxBytes) { _tooLong = true; _buf.SetLength(0); }
            else _buf.Write(piece);
        }
        if (!endOfMessage) return null;
        string? msg = !_tooLong && _buf.Length > 0 ? Encoding.UTF8.GetString(_buf.GetBuffer(), 0, (int)_buf.Length) : null;
        _buf.SetLength(0);
        _tooLong = false;
        return msg;
    }
}
