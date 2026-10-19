// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
//
// Licensed under GNU GPL v3. See LICENSE.md.

using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using AgOpenWeb.Models.Configuration;
using AgOpenWeb.Models.YouTurn;
using AgOpenWeb.Services.Profile;

namespace AgOpenWeb.Services.Tests;

/// <summary>Fork: the one-time copy of the U-Turn/Tram values from an old-format vehicle
/// profile into the tool profiles (upstream #330 moved them there).</summary>
[TestFixture]
public class ToolUTurnTramMigrationTests
{
    private string _root = null!, _vehicles = null!, _tools = null!, _fields = null!;

    [SetUp]
    public void SetUp()
    {
        _root = Path.Combine(Path.GetTempPath(), "aow-uturnmig-" + Guid.NewGuid().ToString("N"));
        _vehicles = Path.Combine(_root, "Vehicles");
        _tools = Path.Combine(_root, "Tools");
        _fields = Path.Combine(_root, "Fields");
        Directory.CreateDirectory(_vehicles);
        Directory.CreateDirectory(_tools);
        Directory.CreateDirectory(_fields);
    }

    [TearDown]
    public void TearDown() { try { Directory.Delete(_root, true); } catch { } }

    // The vehicle file as builds before upstream #330 wrote it: U-Turn under youTurn,
    // tram passes/display/first pass under guidance.
    private void OldVehicle(string name, double radius = 6.5) => File.WriteAllText(Path.Combine(_vehicles, name + ".json"), $$"""
        {
          "formatVersion": 2,
          "guidance": { "lookAhead": 4.0, "tramPasses": 4, "tramDisplay": false, "tramLine": 2 },
          "youTurn": { "turnRadius": {{radius.ToString(System.Globalization.CultureInfo.InvariantCulture)}}, "extensionLength": 15.5,
                       "distanceFromBoundary": 1.25, "skipWidth": 1, "style": {{(int)YouTurnType.KStyle}}, "smoothing": 9 }
        }
        """);

    // A tool file as builds before #330 wrote it: no youTurn / tram sections.
    private void OldTool(string name)
    {
        var s = new ConfigurationStore();
        s.Tool.Overlap = 0.07;
        ToolProfileJsonService.Save(_tools, name, s);
        var path = Path.Combine(_tools, name + ".json");
        var o = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        o.Remove("youTurn"); o.Remove("tram");
        File.WriteAllText(path, o.ToJsonString());
        File.Delete(path + ".bak");
    }

    private ToolUTurnTramMigration.Result Run(string? last = "Traktor") =>
        ToolUTurnTramMigration.Run(_root, _vehicles, _tools, _fields, last);

    private ConfigurationStore LoadTool(string name)
    {
        var s = new ConfigurationStore();
        Assert.That(ToolProfileJsonService.Load(_tools, name, s), Is.True);
        return s;
    }

    [Test]
    public void OldValues_LoadIdentically_AfterMigration()
    {
        OldVehicle("Traktor");
        OldTool("Spritze"); OldTool("Grubber");
        Directory.CreateDirectory(Path.Combine(_fields, "Acker1"));
        File.WriteAllText(Path.Combine(_fields, "Acker1", "TramConfig.json"), """{ "tramWidth": 24.0, "startPass": 0 }""");

        var r = Run();

        Assert.That(r.Migrated, Is.EquivalentTo(new[] { "Spritze", "Grubber" }));
        foreach (var t in new[] { "Spritze", "Grubber" })
        {
            var s = LoadTool(t);
            Assert.Multiple(() =>
            {
                Assert.That(s.Guidance.UTurnRadius, Is.EqualTo(6.5));
                Assert.That(s.Guidance.UTurnExtension, Is.EqualTo(15.5));
                Assert.That(s.Guidance.UTurnDistanceFromBoundary, Is.EqualTo(1.25));
                Assert.That(s.Guidance.UTurnStyle, Is.EqualTo((int)YouTurnType.KStyle));
                Assert.That(s.Guidance.UTurnSmoothing, Is.EqualTo(9));
                Assert.That(s.Guidance.TramPasses, Is.EqualTo(4));
                Assert.That(s.Guidance.TramDisplay, Is.False);
                Assert.That(s.Guidance.TramLine, Is.EqualTo(2));
                Assert.That(s.Tram.TramWidth, Is.EqualTo(24.0));
                Assert.That(s.Tool.Overlap, Is.EqualTo(0.07), "the rest of the tool file is kept");
            });
        }
    }

    [Test]
    public void BacksUpFirst_AndRunsOnce()
    {
        OldVehicle("Traktor");
        OldTool("Spritze");
        string before = File.ReadAllText(Path.Combine(_tools, "Spritze.json"));

        var r = Run();

        Assert.That(r.BackupDirectory, Is.Not.Null);
        Assert.That(File.ReadAllText(Path.Combine(r.BackupDirectory!, "Tools", "Spritze.json")), Is.EqualTo(before));
        Assert.That(File.Exists(Path.Combine(r.BackupDirectory!, "Vehicles", "Traktor.json")), Is.True);
        // A second start changes nothing, even with a new old-style tool file.
        OldTool("Neu");
        var r2 = Run();
        Assert.That(r2.Ran, Is.False);
        Assert.That(LoadTool("Neu").Guidance.UTurnRadius, Is.EqualTo(new GuidanceConfig().UTurnRadius));
    }

    [Test]
    public void ToolWithOwnSections_IsLeftAlone()
    {
        OldVehicle("Traktor");
        var s = new ConfigurationStore();
        s.Guidance.UTurnRadius = 11.0;
        ToolProfileJsonService.Save(_tools, "Neu", s);
        OldTool("Alt");

        var r = Run();

        Assert.That(r.Migrated, Is.EquivalentTo(new[] { "Alt" }));
        Assert.That(LoadTool("Neu").Guidance.UTurnRadius, Is.EqualTo(11.0));
        Assert.That(LoadTool("Alt").Guidance.UTurnRadius, Is.EqualTo(6.5));
    }

    [Test]
    public void NoGuess_WithSeveralVehiclesAndNoLastUsed()
    {
        OldVehicle("A", 5.0); OldVehicle("B", 7.0);
        OldTool("Spritze");

        var r = Run(last: null);

        Assert.That(r.Migrated, Is.Empty);
        Assert.That(LoadTool("Spritze").Guidance.UTurnRadius, Is.EqualTo(new GuidanceConfig().UTurnRadius));
        Assert.That(Run(last: "A").Ran, Is.False, "marker written: the choice is not made later behind the operator's back");
    }

    [Test]
    public void OnlyVehicle_IsTheSource_BesideItsAutoSteerFile()
    {
        OldVehicle("Traktor");
        File.WriteAllText(Path.Combine(_vehicles, "Traktor.AutoSteer.json"), "{}");
        OldTool("Spritze");

        Assert.That(Run(last: null).SourceVehicle, Is.EqualTo("Traktor"));
        Assert.That(LoadTool("Spritze").Guidance.UTurnRadius, Is.EqualTo(6.5));
    }

    [Test]
    public void TramWidth_OnlyWhenTheFieldsAgree()
    {
        OldVehicle("Traktor");
        OldTool("Spritze");
        foreach (var (f, w) in new[] { ("A", 24.0), ("B", 18.0) })
        {
            Directory.CreateDirectory(Path.Combine(_fields, f));
            File.WriteAllText(Path.Combine(_fields, f, "TramConfig.json"), $$"""{ "tramWidth": {{w}} }""");
        }

        Run();

        var s = LoadTool("Spritze");
        Assert.That(s.Tram.TramWidth, Is.EqualTo(new TramConfig().TramWidth));
        Assert.That(s.Guidance.TramPasses, Is.EqualTo(4));
    }

    [Test]
    public void NewFormatVehicle_NothingToCopy()
    {
        var s = new ConfigurationStore();
        VehicleProfileJsonService.Save(_vehicles, "Traktor", s);
        OldTool("Spritze");

        var r = Run();

        Assert.That(r.Migrated, Is.Empty);
        Assert.That(Directory.Exists(Path.Combine(_root, "Backups")), Is.False);
    }
}
