// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
//
// Licensed under GNU GPL v3. See LICENSE.md.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using AgOpenWeb.Services.Storage;

namespace AgOpenWeb.Services.Profile;

/// <summary>
/// Fork, one time: upstream #330/#331 moved the U-Turn and Tram tabs from the vehicle profile
/// into the tool profile, and a tool file without those sections loads the defaults (radius
/// 8 m …). Tool files written before that have no sections, so every existing setup would
/// silently turn with the defaults. This copies the values the vehicle file still carries
/// (old format) into each tool file that lacks them, before the first load, so the turn and
/// tram settings stay as they were.
///
/// Source: the last used vehicle (that pair was what the operator drove), else the only
/// vehicle, else none (no guess). Tram width lived per field (TramConfig.json); it is taken
/// only when every field that has one agrees on it. Vehicles and Tools are copied to
/// <c>Backups/</c> first; a marker file makes it run once. See docs/Host-Aenderungen.md.
/// </summary>
public static class ToolUTurnTramMigration
{
    public const string MarkerName = "uturn-tram-to-tool.done";

    public sealed record Result(bool Ran, string? SourceVehicle, IReadOnlyList<string> Migrated, string? BackupDirectory, string Note);

    public static Result Run(string dataRoot, string vehiclesDir, string toolsDir, string? fieldsDir,
        string? lastUsedVehicle, ILogger? logger = null)
    {
        string markerDir = Path.Combine(dataRoot, ".fork-migrations");
        string marker = Path.Combine(markerDir, MarkerName);
        if (File.Exists(marker)) return new Result(false, null, Array.Empty<string>(), null, "already done");

        var toolFiles = Directory.Exists(toolsDir) ? Directory.GetFiles(toolsDir, "*.json") : Array.Empty<string>();
        var pending = toolFiles.Where(f => { var o = ReadObject(f); return o != null && (o["youTurn"] == null || o["tram"] == null); }).ToList();
        string? source = PickVehicle(vehiclesDir, lastUsedVehicle);
        JsonObject? veh = source == null ? null : ReadObject(Path.Combine(vehiclesDir, source + ".json"));
        var youTurn = veh?["youTurn"] as JsonObject;
        var guidance = veh?["guidance"] as JsonObject;
        bool hasOld = youTurn?["turnRadius"] != null || guidance?["tramPasses"] != null;

        if (pending.Count == 0 || !hasOld)
        {
            string why = pending.Count == 0 ? "no tool file without U-Turn/Tram sections"
                : source == null ? "no unambiguous source vehicle" : $"vehicle '{source}' carries no old U-Turn/Tram values";
            WriteMarker(markerDir, marker, why);
            logger?.LogInformation("[Migration] U-Turn/Tram to tool profiles: nothing to do ({Why})", why);
            return new Result(true, source, Array.Empty<string>(), null, why);
        }

        string backup = Backup(dataRoot, vehiclesDir, toolsDir);
        double? tramWidth = AgreedTramWidth(fieldsDir);
        var done = new List<string>();
        foreach (var file in pending)
        {
            var tool = ReadObject(file)!;
            if (tool["youTurn"] == null && youTurn != null)
            {
                var yt = new JsonObject();
                foreach (var k in new[] { "turnRadius", "extensionLength", "distanceFromBoundary", "style", "smoothing" })
                    if (youTurn[k] != null) yt[k] = youTurn[k]!.DeepClone();
                tool["youTurn"] = yt;
            }
            if (tool["tram"] == null && guidance != null)
            {
                var tr = new JsonObject();
                if (tramWidth is double w) tr["width"] = w;
                if (guidance["tramPasses"] != null) tr["passes"] = guidance["tramPasses"]!.DeepClone();
                if (guidance["tramDisplay"] != null) tr["display"] = guidance["tramDisplay"]!.DeepClone();
                if (guidance["tramLine"] != null) tr["line"] = guidance["tramLine"]!.DeepClone();
                tool["tram"] = tr;
            }
            AtomicJsonFile.WriteAtomic(file, tool.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            done.Add(Path.GetFileNameWithoutExtension(file));
        }
        string note = tramWidth is double tw ? $"tram width {tw} m from the fields" : "tram width: fields disagree or have none, default kept";
        WriteMarker(markerDir, marker, $"source {source}; tools {string.Join(", ", done)}; {note}; backup {backup}");
        logger?.LogInformation("[Migration] U-Turn/Tram values of vehicle {Vehicle} copied into tool profiles {Tools}; {Note}; backup in {Backup}",
            source, string.Join(", ", done), note, backup);
        return new Result(true, source, done, backup, note);
    }

    private static string? PickVehicle(string vehiclesDir, string? lastUsed)
    {
        if (!Directory.Exists(vehiclesDir)) return null;
        var names = Directory.GetFiles(vehiclesDir, "*.json")
            .Where(f => !f.EndsWith(".AutoSteer.json", StringComparison.OrdinalIgnoreCase)) // as VehicleProfileService
            .Select(Path.GetFileNameWithoutExtension).ToList();
        if (!string.IsNullOrEmpty(lastUsed) && names.Contains(lastUsed)) return lastUsed;
        return names.Count == 1 ? names[0] : null;
    }

    private static double? AgreedTramWidth(string? fieldsDir)
    {
        if (string.IsNullOrEmpty(fieldsDir) || !Directory.Exists(fieldsDir)) return null;
        var widths = new HashSet<double>();
        foreach (var f in Directory.GetFiles(fieldsDir, "TramConfig.json", SearchOption.AllDirectories))
        {
            var o = ReadObject(f);
            var v = o?.FirstOrDefault(p => string.Equals(p.Key, "tramWidth", StringComparison.OrdinalIgnoreCase)).Value;
            if (v is JsonValue jv && jv.TryGetValue(out double d) && d > 0) widths.Add(d);
        }
        return widths.Count == 1 ? widths.First() : null;
    }

    private static string Backup(string dataRoot, string vehiclesDir, string toolsDir)
    {
        string dir = Path.Combine(dataRoot, "Backups", "profiles-before-uturn-tram-migration-"
            + DateTime.Now.ToString("yyyyMMdd-HHmmss", System.Globalization.CultureInfo.InvariantCulture));
        foreach (var (src, name) in new[] { (vehiclesDir, "Vehicles"), (toolsDir, "Tools") })
        {
            if (!Directory.Exists(src)) continue;
            string dst = Path.Combine(dir, name);
            Directory.CreateDirectory(dst);
            foreach (var f in Directory.GetFiles(src, "*.json")) File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), overwrite: true);
        }
        return dir;
    }

    private static JsonObject? ReadObject(string path)
    {
        try { return JsonNode.Parse(File.ReadAllText(path)) as JsonObject; }
        catch { return null; } // unreadable: left alone, the normal load handles it
    }

    private static void WriteMarker(string dir, string path, string text)
    {
        Directory.CreateDirectory(dir);
        File.WriteAllText(path, DateTime.Now.ToString("o", System.Globalization.CultureInfo.InvariantCulture) + " " + text + Environment.NewLine);
    }
}
