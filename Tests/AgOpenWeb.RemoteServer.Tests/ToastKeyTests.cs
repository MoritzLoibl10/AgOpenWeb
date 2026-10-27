// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System.IO;
using System.Text;
using AgOpenWeb.RemoteServer;
using NUnit.Framework;

namespace AgOpenWeb.RemoteServer.Tests;

/// <summary>The toast frame carries the English text, then the key and the values as JSON; a
/// plain toast has both empty (read in this order by transport.js).</summary>
[TestFixture]
public class ToastKeyTests
{
    [Test]
    public void Toast_TextKeyAndValues()
    {
        using var r = new BinaryReader(new MemoryStream(WireCodec.EncodeToast("Save failed: x", "Save failed: {error}", "{\"error\":\"x\"}")));
        string Str() => Encoding.UTF8.GetString(r.ReadBytes(r.ReadInt32()));
        Assert.That(r.ReadByte(), Is.EqualTo(WireCodec.Toast));
        Assert.That(new[] { Str(), Str(), Str() }, Is.EqualTo(new[] { "Save failed: x", "Save failed: {error}", "{\"error\":\"x\"}" }));
        using var p = new BinaryReader(new MemoryStream(WireCodec.EncodeToast("No field open")));
        p.ReadByte();
        Assert.That(Encoding.UTF8.GetString(p.ReadBytes(p.ReadInt32())), Is.EqualTo("No field open"));
        Assert.That(p.ReadInt32(), Is.Zero); Assert.That(p.ReadInt32(), Is.Zero);
    }
}
