// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

namespace AgOpenWeb.Android;

/// <summary>
/// Fork: the product name the Android shell shows (launcher label, notification, start and
/// exit texts). The web app has its own single place (<c>BRAND</c> in wwwroot/app.js); the
/// csproj's ApplicationTitle repeats this name because MSBuild cannot read a C# constant.
/// </summary>
internal static class Brand
{
    public const string ProductName = "[PRODUKTNAME]";
}
