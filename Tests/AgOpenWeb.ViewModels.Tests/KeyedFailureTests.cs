// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

namespace AgOpenWeb.ViewModels.Tests;

/// <summary>Fork (host-paket D, #11): a failure with values goes out as English text, with its
/// key and values readable while FailureReported runs, and nothing left over afterwards.</summary>
[TestFixture]
public class KeyedFailureTests
{
    [Test]
    public void KeyedFailure_EnglishText_KeyAndValuesDuringTheEvent()
    {
        var vm = new MainViewModelBuilder().Build();
        string? heard = null; (string Key, (string Name, string Value)[] Args)? key = null;
        vm.FailureReported += m => { heard = m; key = vm.LastFailureKey; };

        vm.ReportFailure("Failed to open field: {error}", ("error", "disk full"));

        Assert.Multiple(() =>
        {
            Assert.That(heard, Is.EqualTo("Failed to open field: disk full"));
            Assert.That(vm.StatusMessage, Is.EqualTo("Failed to open field: disk full"));
            Assert.That(key?.Key, Is.EqualTo("Failed to open field: {error}"));
            Assert.That(key?.Args, Is.EqualTo(new[] { ("error", "disk full") }));
            Assert.That(vm.LastFailureKey, Is.Null);
        });
    }

    [Test]
    public void PlainFailure_HasNoKey()
    {
        var vm = new MainViewModelBuilder().Build();
        bool hadKey = true;
        vm.FailureReported += _ => hadKey = vm.LastFailureKey is not null;
        vm.ReportFailure("No field open");
        Assert.That(hadKey, Is.False);
    }
}
