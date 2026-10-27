// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System.IO;
using System.Text;
using AgOpenWeb.RemoteServer;
using NUnit.Framework;

namespace AgOpenWeb.RemoteServer.Tests;

/// <summary>Fork (host-paket C): each job row of the FieldOps frame ends with the job's start
/// and end as Unix ms (f64, 0 = none), read in this order by transport.js.</summary>
[TestFixture]
public class FieldOpsJobTimesTests
{
    [Test]
    public void JobRow_CarriesStartAndEnd_AfterTheNotes()
    {
        var dto = new FieldOpsDto(
            new FieldEntryDto[0],
            new[] { new JobEntryDto("Acker", "Mähen", "Mähen", 1, "2026-10-27 08:00", "", 1_793_000_000_000, 1_793_001_800_000),
                    new JobEntryDto("Acker", "Walzen", "", 0, "2026-10-27 09:00", "") },
            new string[0], new string[0], new string[0], "Acker");
        using var r = new BinaryReader(new MemoryStream(WireCodec.EncodeFieldOps(dto)));
        string Str() => Encoding.UTF8.GetString(r.ReadBytes(r.ReadInt32()));
        Assert.That(r.ReadByte(), Is.EqualTo(WireCodec.FieldOps));
        Assert.That(r.ReadInt32(), Is.Zero);
        Assert.That(r.ReadInt32(), Is.EqualTo(2));
        Assert.Multiple(() =>
        {
            Assert.That(new[] { Str(), Str(), Str() }, Is.EqualTo(new[] { "Acker", "Mähen", "Mähen" }));
            Assert.That(r.ReadInt32(), Is.EqualTo(1));
            Assert.That(new[] { Str(), Str() }, Is.EqualTo(new[] { "2026-10-27 08:00", "" }));
            Assert.That(r.ReadDouble(), Is.EqualTo(1_793_000_000_000d));
            Assert.That(r.ReadDouble(), Is.EqualTo(1_793_001_800_000d));
            Assert.That(new[] { Str(), Str(), Str() }, Is.EqualTo(new[] { "Acker", "Walzen", "" }));
            Assert.That(r.ReadInt32(), Is.Zero);
            Assert.That(new[] { Str(), Str() }, Is.EqualTo(new[] { "2026-10-27 09:00", "" }));
            Assert.That(r.ReadDouble(), Is.Zero, "no start known");
            Assert.That(r.ReadDouble(), Is.Zero, "running: no end");
        });
    }
}
