// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System.Linq;
using System.Text;
using AgOpenWeb.RemoteServer;
using NUnit.Framework;

namespace AgOpenWeb.RemoteServer.Tests;

/// <summary>Fork (host-paket D, #7): a command sent in pieces is run once, whole; a too long one
/// is dropped whole and the next command is read normally; a piece split inside a UTF-8 character
/// is joined correctly.</summary>
[TestFixture]
public class CommandAssemblerTests
{
    [Test]
    public void PiecesMakeOneCommand_OnlyAtTheEnd()
    {
        var a = new CommandAssembler();
        var text = "bugreport.send|" + new string('x', 3000) + "Größe";
        var bytes = Encoding.UTF8.GetBytes(text);
        var pieces = Enumerable.Range(0, (bytes.Length + 1023) / 1024).Select(i => bytes.Skip(i * 1024).Take(1024).ToArray()).ToList();
        for (int i = 0; i < pieces.Count - 1; i++) Assert.That(a.Add(pieces[i], false), Is.Null);
        Assert.That(a.Add(pieces[^1], true), Is.EqualTo(text));
    }

    [Test]
    public void UTF8SplitAcrossPieces_IsJoined()
    {
        var a = new CommandAssembler();
        var b = Encoding.UTF8.GetBytes("note|ä");
        Assert.That(a.Add(b.AsSpan(0, b.Length - 1), false), Is.Null);
        Assert.That(a.Add(b.AsSpan(b.Length - 1), true), Is.EqualTo("note|ä"));
    }

    [Test]
    public void TooLong_IsDroppedWhole_AndTheNextIsRead()
    {
        var a = new CommandAssembler();
        var piece = new byte[16 * 1024];
        for (int i = 0; i < 4; i++) Assert.That(a.Add(piece, false), Is.Null);
        Assert.That(a.Add(new byte[] { 1 }, true), Is.Null, "64 KB + 1 byte: dropped");
        Assert.That(a.Add("autosteer.off"u8, true), Is.EqualTo("autosteer.off"));
    }
}
