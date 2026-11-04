// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System.Text;
using System.Text.Json.Nodes;
using AgOpenWeb.Services.WorkLog;
using B = AgOpenWeb.Services.Profile.ProfileBackupService;

namespace AgOpenWeb.Services.Tests;

/// <summary>Work log on the guidance computer (fork, feature/host-paket): merge by id without
/// duplicates, the later change wins, deletions stick, open sessions are not stored, and the
/// profile backup takes the log and merges it back.</summary>
[TestFixture]
public class WorkLogStoreTests
{
    private string _tmp = null!;

    [SetUp] public void SetUp() => _tmp = Path.Combine(Path.GetTempPath(), "aow-worklog-" + Guid.NewGuid().ToString("N"));
    [TearDown] public void TearDown() { try { Directory.Delete(_tmp, true); } catch (IOException) { } }

    private static JsonObject Doc(string entries, string deleted = "") =>
        WorkLogStore.Parse(Encoding.UTF8.GetBytes($"{{\"format\":\"aow-worklog\",\"version\":1,\"entries\":[{entries}],\"deleted\":[{deleted}]}}"))!;

    private static string E(string id, long start, long end, long mod = 0, string note = "", bool open = false) =>
        $"{{\"id\":\"{id}\",\"field\":\"Acker\",\"start\":{start},\"end\":{end},\"mod\":{mod},\"note\":\"{note}\",\"open\":{(open ? "true" : "false")}}}";

    private static List<string> Ids(JsonObject d) => d["entries"]!.AsArray().Select(e => (string)e!["id"]!).ToList();

    [Test]
    public void Merge_SameEntryTwice_IsKeptOnce()
    {
        var m = WorkLogStore.Merge(Doc(E("a", 1, 5) + "," + E("b", 2, 6)), Doc(E("a", 1, 5) + "," + E("c", 3, 7)));
        Assert.That(Ids(m), Is.EqualTo(new[] { "a", "b", "c" }));
        Assert.That(Ids(WorkLogStore.Merge(m, m)), Is.EqualTo(new[] { "a", "b", "c" }), "merging again changes nothing");
    }

    [Test]
    public void Merge_TheLaterEditWins_FromEitherSide()
    {
        var older = Doc(E("a", 1, 5, mod: 10, note: "alt"));
        var newer = Doc(E("a", 1, 5, mod: 20, note: "neu"));
        Assert.That((string)WorkLogStore.Merge(older, newer)["entries"]![0]!["note"]!, Is.EqualTo("neu"));
        Assert.That((string)WorkLogStore.Merge(newer, older)["entries"]![0]!["note"]!, Is.EqualTo("neu"));
    }

    [Test]
    public void Merge_ADeletedEntry_StaysDeleted_AndOpenSessionsAreNotStored()
    {
        var m = WorkLogStore.Merge(Doc(E("a", 1, 5) + "," + E("b", 2, 6)), Doc(E("o", 3, 4, open: true), "\"a\""));
        Assert.That(Ids(m), Is.EqualTo(new[] { "b" }));
        Assert.That(m["deleted"]!.AsArray().Select(x => (string)x!), Is.EqualTo(new[] { "a" }));
        Assert.That(Ids(WorkLogStore.Merge(m, Doc(E("a", 1, 5)))), Is.EqualTo(new[] { "b" }), "a tablet's old copy doesn't bring it back");
    }

    [Test]
    public void Parse_RefusesOtherDocuments()
    {
        Assert.That(WorkLogStore.Parse("{\"format\":\"other\",\"entries\":[]}"u8), Is.Null);
        Assert.That(WorkLogStore.Parse("{\"format\":1,\"entries\":[]}"u8), Is.Null);
        Assert.That(WorkLogStore.Parse("not json"u8), Is.Null);
    }

    [Test]
    public void MergeInto_WritesTheFile_AndKeepsAnUnreadableOneAside()
    {
        Directory.CreateDirectory(Path.Combine(_tmp, WorkLogStore.Folder));
        File.WriteAllText(WorkLogStore.PathFor(_tmp), "kaputt");
        var m = WorkLogStore.MergeInto(_tmp, Doc(E("a", 1, 5)));
        Assert.That(Ids(m), Is.EqualTo(new[] { "a" }));
        Assert.That(Ids(WorkLogStore.Read(_tmp)), Is.EqualTo(new[] { "a" }));
        Assert.That(Directory.GetFiles(Path.Combine(_tmp, WorkLogStore.Folder), "worklog.json.unreadable-*"), Has.Length.EqualTo(1));
    }

    [Test]
    public void Backup_TakesTheLog_AndMergesItOnImport()
    {
        string src = Path.Combine(_tmp, "src"), dst = Path.Combine(_tmp, "dst");
        WorkLogStore.MergeInto(src, Doc(E("a", 1, 5) + "," + E("b", 2, 6)));
        WorkLogStore.MergeInto(dst, Doc(E("c", 3, 7)));
        var zip = B.Create(src, Path.Combine(_tmp, "out"), "26.7.0-test");

        var item = B.Preview(zip, dst).Single(i => i.Kind == "worklog");
        Assert.That(item.State, Is.EqualTo(B.ItemState.Overwrites));
        Assert.That(item.Changes, Is.EqualTo(new[] { "+ 2" }));

        B.Apply(zip, dst, new[] { item.Key }, Path.Combine(_tmp, "bak"), "26.7.0-test");
        Assert.That(Ids(WorkLogStore.Read(dst)), Is.EqualTo(new[] { "a", "b", "c" }), "sessions recorded here since stay");
        Assert.That(B.Preview(zip, dst).Single(i => i.Kind == "worklog").State, Is.EqualTo(B.ItemState.Same));
    }
}
