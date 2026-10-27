// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using AgOpenWeb.Services.Interfaces;
using NSubstitute;

namespace AgOpenWeb.ViewModels.Tests;

/// <summary>Fork (feature/host-paket): autosteer.off and sections.alloff only switch off. Off
/// stays off when they are sent again, and when the client's state was stale (it thought
/// something was on that the host already had off).</summary>
[TestFixture]
public class SwitchOffTests
{
    [Test]
    public void AutoSteerOff_DisengagesOnce_AndRepeatsAreHarmless()
    {
        var b = new MainViewModelBuilder();
        var vm = b.Build();
        vm.IsAutoSteerEngaged = true;

        for (int i = 0; i < 5; i++) vm.AutoSteerOff();

        Assert.That(vm.IsAutoSteerEngaged, Is.False);
        b.AutoSteerService.Received(1).Disengage();
        b.AutoSteerService.DidNotReceive().Engage();
    }

    [Test]
    public void AutoSteerOff_WhenAlreadyOff_StaysOff()
    {
        var b = new MainViewModelBuilder();
        var vm = b.Build();
        Assume.That(vm.IsAutoSteerEngaged, Is.False);

        vm.AutoSteerOff(); vm.AutoSteerOff();

        Assert.That(vm.IsAutoSteerEngaged, Is.False);
        b.AutoSteerService.DidNotReceive().Engage();
        b.AutoSteerService.DidNotReceive().Disengage();
    }

    [TestCase(true, false)]
    [TestCase(false, true)]
    public void AllSectionsOff_SwitchesTheModeOff_AndRepeatsAreHarmless(bool auto, bool manual)
    {
        var b = new MainViewModelBuilder();
        var vm = b.Build();
        vm.IsSectionMasterOn = auto;
        vm.IsManualSectionMode = manual;

        for (int i = 0; i < 5; i++) vm.AllSectionsOff();

        Assert.Multiple(() =>
        {
            Assert.That(vm.IsSectionMasterOn, Is.False);
            Assert.That(vm.IsManualSectionMode, Is.False);
        });
        b.SectionControlService.Received(1).SetAllSections(SectionButtonState.Off);
        b.SectionControlService.DidNotReceive().SetAllSections(SectionButtonState.Auto);
        b.SectionControlService.DidNotReceive().SetAllSections(SectionButtonState.On);
    }

    [Test]
    public void AllSectionsOff_WhenAllOff_DoesNothing()
    {
        var b = new MainViewModelBuilder();
        var vm = b.Build();
        b.SectionControlService.SectionStates.Returns(new[] { new SectionControlState { Index = 0 } });

        vm.AllSectionsOff(); vm.AllSectionsOff();

        Assert.That(vm.IsSectionMasterOn || vm.IsManualSectionMode, Is.False);
        b.SectionControlService.DidNotReceive().SetAllSections(Arg.Any<SectionButtonState>());
    }

    // #316: a section switched on by its own button, with neither master on.
    [Test]
    public void AllSectionsOff_ASectionOnByItsOwnButton_IsSwitchedOff()
    {
        var b = new MainViewModelBuilder();
        var vm = b.Build();
        var states = new[] { new SectionControlState { Index = 0 }, new SectionControlState { Index = 1 } };
        states[1].ButtonState = SectionButtonState.On;
        states[1].IsOn = true;
        b.SectionControlService.SectionStates.Returns(states);

        vm.AllSectionsOff();

        b.SectionControlService.Received(1).SetAllSections(SectionButtonState.Off);
        b.SectionControlService.DidNotReceive().SetAllSections(SectionButtonState.On);
        b.SectionControlService.DidNotReceive().SetAllSections(SectionButtonState.Auto);
    }
}
