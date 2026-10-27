// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System.IO;
using AgOpenWeb.Models;
using NSubstitute;

namespace AgOpenWeb.ViewModels.Tests;

/// <summary>Fork, eAMA import: field.fromGeo creates a field the From KML way (outer + inner
/// boundary, origin from the boundary) and never overwrites an existing one.</summary>
[TestFixture]
public class EamaFromGeoTests
{
    [Test]
    public void FromGeo_CreatesFieldWithInnerBoundary_AndNeverOverwrites()
    {
        var dir = Path.Combine(Path.GetTempPath(), "aow-geo-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var b = new MainViewModelBuilder();
            b.SettingsService.Settings.FieldsDirectory = dir;
            var saved = new List<Field>();
            b.FieldService.LoadField(Arg.Any<string>()).Returns(_ => new Field());
            b.FieldService.When(x => x.SaveField(Arg.Any<Field>())).Do(ci => saved.Add(ci.Arg<Field>()));
            var vm = b.Build();
            void Send(string outer)
            {
                vm.RemoteFromGeo("begin");
                vm.RemoteFromGeo("ring\t0\t" + outer);
                vm.RemoteFromGeo("ring\t0\t48.571,16.574;48.571,16.572"); // a ring may come in several pieces
                vm.RemoteFromGeo("ring\t1\t48.5703,16.5730;48.5705,16.5730;48.5705,16.5733;48.5703,16.5733");
                vm.RemoteFromGeo("create\tFS 12 · S 1 Ölkürbis");
            }

            Send("48.5702,16.572;48.5702,16.574");
            Assert.That(Directory.Exists(Path.Combine(dir, "FS 12 · S 1 Ölkürbis")), Is.True);
            Assert.That(saved, Has.Count.EqualTo(1));
            var bd = saved[0].Boundary!;
            Assert.That(bd.OuterBoundary!.Points, Has.Count.EqualTo(4));
            Assert.That(bd.InnerBoundaries, Has.Count.EqualTo(1));
            Assert.That(bd.InnerBoundaries[0].Points, Has.Count.EqualTo(4));
            Assert.That(vm.KmlCenterLatitude, Is.EqualTo((48.5702 * 2 + 48.571 * 2 + 48.5703 * 2 + 48.5705 * 2) / 8).Within(1e-12));
            Assert.That(vm.KmlCenterLongitude, Is.EqualTo((16.572 * 2 + 16.574 * 2 + 16.5730 * 2 + 16.5733 * 2) / 8).Within(1e-12));

            // Same name again, other geometry: refused, nothing saved over the field.
            Send("48.6,16.6;48.6,16.7");
            Assert.That(saved, Has.Count.EqualTo(1));
            Assert.That(vm.StatusMessage, Does.Contain("already exists"));
        }
        finally { Directory.Delete(dir, true); }
    }
}
