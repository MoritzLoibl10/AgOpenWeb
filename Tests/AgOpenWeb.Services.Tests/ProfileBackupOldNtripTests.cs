// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using AgOpenWeb.Services.Interfaces;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using B = AgOpenWeb.Services.Profile.ProfileBackupService;

namespace AgOpenWeb.Services.Tests;

/// <summary>
/// Profile backup (fork): a backup made before the upstream sync of November 2026, when an
/// NTRIP profile still carried the fork's own protocol version ("ntripVersion": 1 or 2), no
/// fallback service and the fork's naming, is shown, imported and then loaded without an error.
/// Upstream's NTRIP layer chooses the version itself; the old field is simply not read.
/// </summary>
[TestFixture]
[NonParallelizable] // sets AGOPENWEB_DATA for the profile service
public class ProfileBackupOldNtripTests
{
    private string _tmp = null!, _src = null!, _root = null!, _dst = null!, _out = null!, _bak = null!;
    private string? _envBefore;

    // An NTRIP profile as the fork wrote it up to 26.7.0-moritz.29 (camelCase, NtripVersion 2).
    private const string OldProfile = """
        {
          "id": "6f1d6a3e-4b8c-4f3e-9d43-2a1c0e5b7a11",
          "name": "APOS",
          "casterHost": "apos.bev.gv.at",
          "casterPort": 2101,
          "mountPoint": "VRS_3_4G_AT",
          "username": "bauer",
          "password": "",
          "ntripVersion": 2,
          "associatedFields": [ "Acker 1" ],
          "autoConnectOnFieldLoad": true,
          "isDefault": true
        }
        """;

    [SetUp]
    public void SetUp()
    {
        _tmp = Path.Combine(Path.GetTempPath(), "aow-oldntrip-" + Guid.NewGuid().ToString("N"));
        _src = Path.Combine(_tmp, "src"); _root = Path.Combine(_tmp, "root");
        _dst = Path.Combine(_root, "AgOpenWeb"); _out = Path.Combine(_tmp, "out"); _bak = Path.Combine(_tmp, "bak");
        Directory.CreateDirectory(Path.Combine(_src, "NtripProfiles"));
        File.WriteAllText(Path.Combine(_src, "NtripProfiles", "APOS.json"), OldProfile);
        Directory.CreateDirectory(_dst);
        _envBefore = Environment.GetEnvironmentVariable(AppDataRoot.EnvVar);
        Environment.SetEnvironmentVariable(AppDataRoot.EnvVar, _root);
    }

    [TearDown]
    public void TearDown()
    {
        Environment.SetEnvironmentVariable(AppDataRoot.EnvVar, _envBefore);
        try { Directory.Delete(_tmp, true); } catch (IOException) { }
    }

    [Test]
    public async Task OldBackupWithNtripVersion_ImportsAndLoads()
    {
        var zip = B.Create(_src, _out, "26.7.0-moritz.29");

        var items = B.Preview(zip, _dst);
        Assert.That(items.Select(i => i.Key), Is.EqualTo(new[] { "ntrip:APOS" }));
        Assert.That(items[0].State, Is.EqualTo(B.ItemState.New));

        var r = B.Apply(zip, _dst, items.Select(i => i.Key), _bak, "26.7.0-moritz.30");
        Assert.That(r.Written, Is.EqualTo(new[] { "ntrip:APOS" }));
        Assert.That(r.NeedPassword, Is.EqualTo(new[] { "APOS" }));

        var svc = new NtripProfileService(Substitute.For<ISettingsService>(), NullLogger<NtripProfileService>.Instance);
        Assert.That(svc.ProfilesDirectory, Is.EqualTo(Path.Combine(_dst, "NtripProfiles")));
        await svc.LoadProfilesAsync();

        var p = svc.Profiles.Single();
        Assert.That(p.Name, Is.EqualTo("APOS"));
        Assert.That(p.CasterHost, Is.EqualTo("apos.bev.gv.at"));
        Assert.That(p.CasterPort, Is.EqualTo(2101));
        Assert.That(p.MountPoint, Is.EqualTo("VRS_3_4G_AT"));
        Assert.That(p.Username, Is.EqualTo("bauer"));
        Assert.That(p.AssociatedFields, Is.EqualTo(new[] { "Acker 1" }));
        Assert.That(p.IsDefault, Is.True);
        Assert.That(p.Fallback, Is.Null, "an old profile has no fallback service");

        // Imported again over itself: nothing differs, nothing to write.
        Assert.That(B.Preview(zip, _dst).Single().State, Is.EqualTo(B.ItemState.Same));
    }
}
