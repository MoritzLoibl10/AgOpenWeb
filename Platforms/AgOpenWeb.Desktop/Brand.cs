// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

namespace AgOpenWeb.Desktop;

/// <summary>
/// Fork: the product name the desktop shell shows (window title, start and exit texts, console
/// page). The web app has its own single place (<c>BRAND</c> in wwwroot/app.js), the Android
/// shell its <c>Brand</c>, the Windows installer <c>AppName</c>. Assembly, namespaces, folders,
/// data folder (Documents\AgOpenWeb) and port keep the AgOpenWeb names.
/// </summary>
internal static class Brand
{
    public const string ProductName = "LM Steering Solutions";
}
