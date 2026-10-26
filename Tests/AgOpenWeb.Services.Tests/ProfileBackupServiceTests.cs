// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System.IO.Compression;
using System.Text;
using AgOpenWeb.Services.Profile;
using B = AgOpenWeb.Services.Profile.ProfileBackupService;

namespace AgOpenWeb.Services.Tests;

/// <summary>
/// Profile backup (fork, feature/profil-backup): export → import round trip, preview states,
/// refusals before anything is written, damaged ZIPs, and no secrets in the export.
/// </summary>
[TestFixture]
public class ProfileBackupServiceTests
{
    private string _tmp = null!, _src = null!, _dst = null!, _out = null!, _bak = null!;

    [SetUp]
    public void SetUp()
    {
        _tmp = Path.Combine(Path.GetTempPath(), "aow-backup-" + Guid.NewGuid().ToString("N"));
        _src = Path.Combine(_tmp, "src"); _dst = Path.Combine(_tmp, "dst");
        _out = Path.Combine(_tmp, "out"); _bak = Path.Combine(_tmp, "bak");
        Write(_src, "Vehicles/Fendt.json", "{ \"Vehicle\": { \"Wheelbase\": 2.9, \"TrackWidth\": 1.9 } }");
        Write(_src, "Vehicles/Fendt.AutoSteer.json", "{ \"Kp\": 50 }");
        Write(_src, "Tools/Spritze.json", "{ \"Tool\": { \"Width\": 24 } }");
        Write(_src, "Fields/Acker 1/field.geojson", "{ \"type\": \"FeatureCollection\", \"features\": [] }");
        Write(_src, "Fields/Acker 1/background.png", "PNG");
        Write(_src, "Fields/Acker 1/jobs/Mais/coverage/0_0.bin", "COVERAGE");
        Write(_src, "NtripProfiles/Apos.json", "{ \"name\": \"Apos\", \"casterHost\": \"apos.at\", \"username\": \"bauer\", \"password\": \"geheim\" }");
        Write(_src, "appsettings.json", "{ \"AgShareApiKey\": \"schluessel\" }");
    }

    [TearDown]
    public void TearDown() { try { Directory.Delete(_tmp, true); } catch (IOException) { } }

    private static void Write(string root, string rel, string text)
    {
        var p = Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(p)!);
        File.WriteAllText(p, text);
    }

    private static string Read(string root, string rel) => File.ReadAllText(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));

    private string Export() => B.Create(_src, _out, "26.7.0-test");

    private static List<string> AllFiles(string root) => Directory.Exists(root)
        ? Directory.GetFiles(root, "*", SearchOption.AllDirectories).Select(f => Path.GetRelativePath(root, f).Replace('\\', '/')).OrderBy(f => f).ToList()
        : new List<string>();

    [Test]
    public void Export_TakesProfilesFieldsAndNtrip_NotJobsOrSettings()
    {
        using var zip = ZipFile.OpenRead(Export());
        var names = zip.Entries.Select(e => e.FullName).OrderBy(n => n).ToList();
        Assert.That(names, Is.EqualTo(new[] { "Fields/Acker 1/background.png", "Fields/Acker 1/field.geojson", "manifest.json",
            "NtripProfiles/Apos.json", "Tools/Spritze.json", "Vehicles/Fendt.AutoSteer.json", "Vehicles/Fendt.json" }));
    }

    [Test]
    public void Export_BlanksSecretsInProfiles()
    {
        Write(_src, "Vehicles/Fendt.json", "{ \"Vehicle\": { \"Wheelbase\": 2.9 }, \"Gps\": { \"NtripPassword\": \"geheim\", \"AgShareApiKey\": \"schluessel\" } }");
        var path = Export();
        var all = Encoding.UTF8.GetString(ReadAllEntries(path));
        Assert.That(all, Does.Not.Contain("geheim"));
        Assert.That(all, Does.Not.Contain("schluessel"));
        Assert.That(all, Does.Contain("Wheelbase"));
    }

    private static byte[] ReadAllEntries(string zipPath)
    {
        using var zip = ZipFile.OpenRead(zipPath);
        using var ms = new MemoryStream();
        foreach (var e in zip.Entries) using (var s = e.Open()) s.CopyTo(ms);
        return ms.ToArray();
    }

    [Test]
    public void RoundTrip_NewThenSame_AndOverwriteShowsTheChange()
    {
        var zip = Export();
        var items = B.Preview(zip, _dst);
        Assert.That(items.Select(i => i.Key), Is.EqualTo(new[] { "field:Acker 1", "ntrip:Apos", "tool:Spritze", "vehicle:Fendt" }));
        Assert.That(items.All(i => i.State == B.ItemState.New), Is.True);

        var r = B.Apply(zip, _dst, items.Select(i => i.Key), _bak, "26.7.0-test");
        Assert.That(r.Written, Has.Count.EqualTo(4));
        Assert.That(r.NeedPassword, Is.EqualTo(new[] { "Apos" }), "new NTRIP profile: password to enter again");
        Assert.That(File.Exists(r.AutoBackup), Is.True, "a backup of the state before the import");
        foreach (var rel in new[] { "Vehicles/Fendt.json", "Vehicles/Fendt.AutoSteer.json", "Tools/Spritze.json", "Fields/Acker 1/field.geojson", "Fields/Acker 1/background.png" })
            Assert.That(Read(_dst, rel), Is.EqualTo(Read(_src, rel)), rel);
        Assert.That(AllFiles(_dst).Any(f => f.Contains("jobs/") || f == "appsettings.json"), Is.False);
        Assert.That(Read(_dst, "NtripProfiles/Apos.json"), Does.Contain("apos.at").And.Contain("bauer").And.Not.Contain("geheim"));
        Assert.That(B.Preview(zip, _dst).All(i => i.State == B.ItemState.Same), Is.True);

        Write(_dst, "Vehicles/Fendt.json", "{ \"Vehicle\": { \"Wheelbase\": 3.1, \"TrackWidth\": 1.9 } }");
        var v = B.Preview(zip, _dst).Single(i => i.Key == "vehicle:Fendt");
        Assert.That(v.State, Is.EqualTo(B.ItemState.Overwrites));
        Assert.That(v.Changes, Is.EqualTo(new[] { "Vehicle.Wheelbase: 3.1 → 2.9" }));

        // A deleted profile that left its companion file: overwrites, the profile file is "+".
        File.Delete(Path.Combine(_dst, "Vehicles", "Fendt.json"));
        v = B.Preview(zip, _dst).Single(i => i.Key == "vehicle:Fendt");
        Assert.That(v.State, Is.EqualTo(B.ItemState.Overwrites));
        Assert.That(v.Changes, Is.EqualTo(new[] { "+ Fendt.json" }));
    }

    [Test]
    public void Ntrip_ExportedWithoutPassword_KeepsUserName()
    {
        var all = Encoding.UTF8.GetString(ReadAllEntries(Export()));
        Assert.That(all, Does.Not.Contain("geheim"));
        Assert.That(all, Does.Contain("bauer"));
    }

    [Test]
    public void Ntrip_ImportKeepsTheStoredPassword_AndPreviewIgnoresIt()
    {
        Write(_dst, "NtripProfiles/Apos.json", "{ \"name\": \"Apos\", \"casterHost\": \"apos.at\", \"username\": \"bauer\", \"password\": \"lokal\" }");
        var zip = Export();
        Assert.That(B.Preview(zip, _dst).Single(i => i.Key == "ntrip:Apos").State, Is.EqualTo(B.ItemState.Same), "the password alone is no difference");

        Write(_dst, "NtripProfiles/Apos.json", "{ \"name\": \"Apos\", \"casterHost\": \"alt.at\", \"username\": \"bauer\", \"password\": \"lokal\" }");
        var it = B.Preview(zip, _dst).Single(i => i.Key == "ntrip:Apos");
        Assert.That(it.State, Is.EqualTo(B.ItemState.Overwrites));
        Assert.That(it.Changes, Is.EqualTo(new[] { "casterHost: \"alt.at\" → \"apos.at\"" }));

        var r = B.Apply(zip, _dst, new[] { "ntrip:Apos" }, _bak, "t");
        Assert.That(r.NeedPassword, Is.Empty);
        var now = Read(_dst, "NtripProfiles/Apos.json");
        Assert.That(now, Does.Contain("apos.at").And.Contain("lokal"));
    }

    [Test]
    public void Apply_OnlySelected_AndAutoBackupHoldsTheOldState()
    {
        Write(_dst, "Vehicles/Fendt.json", "{ \"Vehicle\": { \"Wheelbase\": 3.1 } }");
        Write(_dst, "Tools/Spritze.json", "{ \"Tool\": { \"Width\": 12 } }");
        var zip = Export();
        var r = B.Apply(zip, _dst, new[] { "vehicle:Fendt" }, _bak, "t");
        Assert.That(Read(_dst, "Vehicles/Fendt.json"), Is.EqualTo(Read(_src, "Vehicles/Fendt.json")));
        Assert.That(Read(_dst, "Tools/Spritze.json"), Does.Contain("12"), "not selected: unchanged");
        Assert.That(Directory.Exists(Path.Combine(_dst, "Fields")), Is.False);
        // The automatic backup restores the old vehicle.
        var back = Path.Combine(_tmp, "back");
        B.Apply(r.AutoBackup, back, B.Preview(r.AutoBackup, back).Select(i => i.Key), _bak, "t");
        Assert.That(Read(back, "Vehicles/Fendt.json"), Does.Contain("3.1"));
    }

    [Test]
    public void Abort_EmptySelection_WritesNothing_NotEvenTheAutoBackup()
    {
        var zip = Export();
        var e = Assert.Throws<B.BackupException>(() => B.Apply(zip, _dst, Array.Empty<string>(), _bak, "t"));
        Assert.That(e!.Code, Is.EqualTo("empty"));
        Assert.That(AllFiles(_dst), Is.Empty);
        Assert.That(AllFiles(_bak), Is.Empty);
    }

    [Test]
    public void CheckApply_RefusesSteeringMovingAndTheOpenField()
    {
        var sel = new[] { "vehicle:Fendt", "field:Acker 1" };
        Assert.That(B.CheckApply(true, 0, null, sel), Is.EqualTo("steer"));
        Assert.That(B.CheckApply(false, 0.6, null, sel), Is.EqualTo("moving"));
        Assert.That(B.CheckApply(false, -0.6, null, sel), Is.EqualTo("moving"));
        Assert.That(B.CheckApply(false, 0.2, "acker 1", sel), Is.EqualTo("fieldopen"));
        Assert.That(B.CheckApply(false, 0.2, "Acker 2", sel), Is.Null);
        Assert.That(B.CheckApply(false, 0, null, sel), Is.Null);
    }

    // --- Damaged or foreign ZIPs: refused before anything is written --------------------------

    private void AssertRefused(string zip, string code)
    {
        var e = Assert.Throws<B.BackupException>(() => B.Apply(zip, _dst, new[] { "vehicle:Fendt", "tool:Spritze", "field:Acker 1", "ntrip:Apos" }, _bak, "t"));
        Assert.That(e!.Code, Is.EqualTo(code));
        Assert.Throws<B.BackupException>(() => B.Preview(zip, _dst));
        Assert.That(AllFiles(_dst), Is.Empty, "nothing written");
        Assert.That(AllFiles(_bak), Is.Empty, "no auto-backup either");
    }

    /// <summary>Copies the export, letting <paramref name="edit"/> change entries.</summary>
    private string Tampered(Action<ZipArchive> edit)
    {
        var src = Export();
        var p = Path.Combine(_tmp, "tampered.zip");
        File.Copy(src, p, true);
        using (var z = ZipFile.Open(p, ZipArchiveMode.Update)) edit(z);
        return p;
    }

    private static void Put(ZipArchive z, string name, string text)
    {
        z.GetEntry(name)?.Delete();
        using var w = new StreamWriter(z.CreateEntry(name).Open());
        w.Write(text);
    }

    [Test]
    public void Damaged_NotAZip()
    {
        var p = Path.Combine(_tmp, "kaputt.zip");
        File.WriteAllText(p, "das ist keine ZIP-Datei");
        AssertRefused(p, "notzip");
    }

    [Test]
    public void Damaged_TruncatedZip()
    {
        var src = Export();
        var p = Path.Combine(_tmp, "halb.zip");
        var b = File.ReadAllBytes(src);
        File.WriteAllBytes(p, b.AsSpan(0, b.Length / 2).ToArray());
        AssertRefused(p, "notzip");
    }

    [Test]
    public void Damaged_ChangedFile_WrongSize()
        => AssertRefused(Tampered(z => Put(z, "Tools/Spritze.json", "{ \"Tool\": { \"Width\": 99 } }  ")), "size");

    [Test]
    public void Damaged_SameSizeOtherContent_ChecksumWrong()
        => AssertRefused(Tampered(z =>
        {
            string t; using (var r = new StreamReader(z.GetEntry("Tools/Spritze.json")!.Open())) t = r.ReadToEnd();
            Put(z, "Tools/Spritze.json", t.Replace("24", "99"));
        }), "checksum");

    [Test]
    public void Damaged_NoManifest()
        => AssertRefused(Tampered(z => z.GetEntry("manifest.json")!.Delete()), "nomanifest");

    [Test]
    public void Damaged_ExtraEntry()
        => AssertRefused(Tampered(z => Put(z, "Vehicles/Untergeschoben.json", "{}")), "extra");

    [Test]
    public void Damaged_PathOutsideTheDataRoot()
    {
        var p = Tampered(z =>
        {
            string m; using (var r = new StreamReader(z.GetEntry("manifest.json")!.Open())) m = r.ReadToEnd();
            Put(z, "manifest.json", m.Replace("\"Tools/Spritze.json\"", "\"Tools/../../evil.json\""));
        });
        AssertRefused(p, "notallowed");
        Assert.That(File.Exists(Path.Combine(_tmp, "evil.json")), Is.False);
    }

    [Test]
    public void List_OnlyBackupsOfThisFormat()
    {
        var import = Path.Combine(_tmp, "Import");
        Directory.CreateDirectory(import);
        File.Copy(Export(), Path.Combine(import, "backup_a.zip"));
        File.WriteAllText(Path.Combine(import, "kaputt.zip"), "x");
        using (var z = ZipFile.Open(Path.Combine(import, "felder.zip"), ZipArchiveMode.Update)) Put(z, "doc.kml", "<kml/>");
        Assert.That(B.List(import), Is.EqualTo(new[] { "backup_a.zip" }));
        Assert.Throws<B.BackupException>(() => B.ImportPath(import, "../backup_a.zip"));
        Assert.That(B.ImportPath(import, "backup_a.zip"), Is.EqualTo(Path.Combine(import, "backup_a.zip")));
    }
}
