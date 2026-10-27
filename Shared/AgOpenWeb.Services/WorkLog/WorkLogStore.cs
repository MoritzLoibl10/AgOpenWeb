// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace AgOpenWeb.Services.WorkLog;

/// <summary>
/// Work log on the guidance computer (fork, feature/host-paket): one file,
/// <c>WorkLog/worklog.json</c> in the data root, in the client's format
/// (<c>{format:"aow-worklog", version:1, entries:[…], deleted:[ids]}</c>). The host does not
/// interpret an entry beyond its <c>id</c>, <c>start</c>, <c>end</c>, <c>mod</c> and <c>open</c>;
/// the rest is kept as sent. Tablets keep their own copy and merge with this one: entries are
/// matched by id (no duplicates), the one changed last wins (<c>mod</c>, then <c>end</c>), a
/// deleted id stays deleted, and only closed sessions are stored. Same rule as
/// <c>WorkLogCore.merge</c> in the web client.
/// </summary>
public static class WorkLogStore
{
    public const string Folder = "WorkLog";
    public const string FileName = "worklog.json";
    public const string Format = "aow-worklog";
    public const int Version = 1;
    /// <summary>Largest document accepted from a client (a season of sessions is far smaller).</summary>
    public const int MaxBytes = 8 << 20;

    private static readonly object Gate = new();

    public static string PathFor(string dataRoot) => Path.Combine(dataRoot, Folder, FileName);

    public static JsonObject Empty() => new()
    {
        ["format"] = Format, ["version"] = Version, ["entries"] = new JsonArray(), ["deleted"] = new JsonArray(),
    };

    /// <summary>Parses a document of this format; null when it isn't one.</summary>
    public static JsonObject? Parse(ReadOnlySpan<byte> json)
    {
        try
        {
            var reader = new Utf8JsonReader(json);
            if (JsonNode.Parse(ref reader) is not JsonObject o || (string?)o["format"] != Format || o["entries"] is not JsonArray) return null;
            return o;
        }
        catch (JsonException) { return null; }
        catch (InvalidOperationException) { return null; } // "format" not a string
    }

    /// <summary>The stored document, or an empty one when there is none yet.</summary>
    public static JsonObject Read(string dataRoot)
    {
        lock (Gate) return ReadUnlocked(dataRoot) ?? Empty();
    }

    /// <summary>Merges <paramref name="incoming"/> into the stored document, writes it and returns it.
    /// A stored file that can't be read is kept beside as <c>worklog.json.unreadable-…</c>.</summary>
    public static JsonObject MergeInto(string dataRoot, JsonObject incoming, DateTime? now = null)
    {
        lock (Gate)
        {
            var path = PathFor(dataRoot);
            var cur = ReadUnlocked(dataRoot);
            if (cur is null && File.Exists(path))
                File.Move(path, path + ".unreadable-" + (now ?? DateTime.Now).ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture));
            var merged = Merge(cur ?? Empty(), incoming);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var tmp = path + ".tmp";
            File.WriteAllBytes(tmp, Encoding.UTF8.GetBytes(merged.ToJsonString()));
            File.Move(tmp, path, overwrite: true);
            return merged;
        }
    }

    private static JsonObject? ReadUnlocked(string dataRoot)
    {
        var path = PathFor(dataRoot);
        return File.Exists(path) ? Parse(File.ReadAllBytes(path)) : null;
    }

    /// <summary>Union of both by id, the later change winning; deleted ids from either side removed.</summary>
    public static JsonObject Merge(JsonObject a, JsonObject b)
    {
        var deleted = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var d in new[] { a, b })
            if (d["deleted"] is JsonArray del)
                foreach (var x in del)
                    if (x is JsonValue v && v.TryGetValue(out string? id) && id.Length > 0) deleted.Add(id);
        var byId = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        foreach (var d in new[] { a, b })
            if (d["entries"] is JsonArray list)
                foreach (var x in list)
                {
                    if (x is not JsonObject e || Str(e, "id") is not { Length: > 0 } id || Num(e, "start") is null) continue;
                    if (deleted.Contains(id) || (e["open"] is JsonValue ov && ov.TryGetValue(out bool open) && open)) continue;
                    if (!byId.TryGetValue(id, out var have) || Newer(e, have)) byId[id] = e;
                }
        var entries = new JsonArray();
        foreach (var e in byId.Values.OrderBy(e => Num(e, "start")).ThenBy(e => Str(e, "id"), StringComparer.Ordinal))
            entries.Add(e.DeepClone());
        var dels = new JsonArray();
        foreach (var id in deleted) dels.Add(id);
        return new JsonObject { ["format"] = Format, ["version"] = Version, ["entries"] = entries, ["deleted"] = dels };
    }

    private static bool Newer(JsonObject x, JsonObject y)
    {
        double mx = Num(x, "mod") ?? 0, my = Num(y, "mod") ?? 0;
        if (mx != my) return mx > my;
        return (Num(x, "end") ?? 0) > (Num(y, "end") ?? 0);
    }

    private static string? Str(JsonObject o, string k) => o[k] is JsonValue v && v.TryGetValue(out string? s) ? s : null;
    private static double? Num(JsonObject o, string k) => o[k] is JsonValue v && v.TryGetValue(out double d) && double.IsFinite(d) ? d : null;
}
