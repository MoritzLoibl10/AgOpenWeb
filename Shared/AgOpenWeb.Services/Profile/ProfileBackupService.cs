// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace AgOpenWeb.Services.Profile;

/// <summary>
/// Profile backup (fork, feature/profil-backup): the vehicle, tool and field profiles of the data
/// root as one ZIP, and back again. Export: <c>Vehicles/*.json</c>, <c>Tools/*.json</c> and
/// <c>Fields/&lt;field&gt;/…</c> without the jobs' worked area (<c>jobs/</c>), with a
/// <c>manifest.json</c> (format, app version, date, every file with size and SHA-256), and the
/// NTRIP profiles (<c>NtripProfiles/*.json</c>) with the password blanked, and the work log
/// (<c>WorkLog/worklog.json</c>, merged on import rather than replaced). The app settings are
/// not in it (the AgShare key); JSON properties that look like a secret are blanked anyway. On
/// import an NTRIP profile keeps the password already stored on this device; one left without
/// is reported (<see cref="ApplyResult.NeedPassword"/>). Import: a ZIP of this format only, checked
/// against its manifest; a preview says per profile and field whether it is new, overwrites
/// or is the same; applying first writes a backup of the current state, then only the chosen
/// entries. The caller checks standstill, steering off and control (<see cref="CheckApply"/>).
/// </summary>
public static class ProfileBackupService
{
    public const string Format = "agopenweb.profile-backup";
    public const int FormatVersion = 1;
    public const string ExportPrefix = "backup_";
    public const string AutoPrefix = "before-import_";
    private const string ManifestName = "manifest.json";
    private const long MaxTotalBytes = 1L << 30; // 1 GB uncompressed: more is not a profile backup
    private static readonly string[] Roots = { "Vehicles", "Tools", "Fields", "NtripProfiles", WorkLog.WorkLogStore.Folder };
    private static readonly Regex Secret = new("(password|passwd|apikey|api_key|secret|token|username)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    // NTRIP profiles keep the user name (it is no secret on its own; the password is re-entered).
    private static readonly Regex NtripSecret = new("(password|passwd|apikey|api_key|secret|token)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public enum ItemState { New, Overwrites, Same }

    public sealed record Item(string Kind, string Name, ItemState State, IReadOnlyList<string> Changes)
    {
        public string Key => Kind + ":" + Name;
    }

    /// <param name="NeedPassword">NTRIP profiles (their name) that have no password after the import.</param>
    public sealed record ApplyResult(string AutoBackup, IReadOnlyList<string> Written, IReadOnlyList<string> NeedPassword);

    /// <summary>A refused or damaged backup. <see cref="Code"/> is what the client translates
    /// (notzip, nomanifest, version, nolist, notallowed, twice, missing, size, toolarge, damaged,
    /// checksum, extra, badname, notfound, empty); <see cref="Detail"/> is the file concerned.</summary>
    public sealed class BackupException : Exception
    {
        public string Code { get; }
        public string Detail { get; }
        public BackupException(string code, string detail = "") : base(code + (detail.Length > 0 ? ": " + detail : "")) { Code = code; Detail = detail; }
    }

    // --- Export -----------------------------------------------------------------------------

    /// <summary>Writes <c>&lt;prefix&gt;&lt;date&gt;.zip</c> into <paramref name="outDir"/> and
    /// returns its path.</summary>
    public static string Create(string dataRoot, string outDir, string appVersion, string prefix = ExportPrefix, DateTime? now = null)
    {
        var t = now ?? DateTime.Now;
        Directory.CreateDirectory(outDir);
        var name = prefix + t.ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture);
        var path = Path.Combine(outDir, name + ".zip");
        for (int i = 2; File.Exists(path); i++) path = Path.Combine(outDir, name + "_" + i + ".zip");
        var tmp = path + ".tmp";
        var files = new JsonArray();
        using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write))
        using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
        {
            foreach (var (rel, full) in Collect(dataRoot))
            {
                var bytes = Scrub(rel, File.ReadAllBytes(full));
                var e = zip.CreateEntry(rel, CompressionLevel.Optimal);
                using (var s = e.Open()) s.Write(bytes, 0, bytes.Length);
                files.Add(new JsonObject { ["path"] = rel, ["size"] = bytes.LongLength, ["sha256"] = Sha(bytes) });
            }
            var manifest = new JsonObject
            {
                ["format"] = Format, ["formatVersion"] = FormatVersion, ["appVersion"] = appVersion,
                ["created"] = t.ToString("o", CultureInfo.InvariantCulture), ["files"] = files,
            };
            var mb = Encoding.UTF8.GetBytes(manifest.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            using var ms = zip.CreateEntry(ManifestName, CompressionLevel.Optimal).Open();
            ms.Write(mb, 0, mb.Length);
        }
        File.Move(tmp, path);
        return path;
    }

    /// <summary>The files a backup takes, as (path in the ZIP with '/', full path).</summary>
    private static IEnumerable<(string Rel, string Full)> Collect(string dataRoot)
    {
        var log = WorkLog.WorkLogStore.PathFor(dataRoot);
        if (File.Exists(log)) yield return (WorkLog.WorkLogStore.Folder + "/" + WorkLog.WorkLogStore.FileName, log);
        foreach (var root in new[] { "Vehicles", "Tools", "NtripProfiles" })
        {
            var dir = Path.Combine(dataRoot, root);
            if (!Directory.Exists(dir)) continue;
            foreach (var f in Directory.GetFiles(dir, "*.json").OrderBy(f => f, StringComparer.Ordinal))
                yield return (root + "/" + Path.GetFileName(f), f);
        }
        var fields = Path.Combine(dataRoot, "Fields");
        if (!Directory.Exists(fields)) yield break;
        foreach (var fd in Directory.GetDirectories(fields).OrderBy(f => f, StringComparer.Ordinal))
            foreach (var f in Directory.GetFiles(fd, "*", SearchOption.AllDirectories).OrderBy(f => f, StringComparer.Ordinal))
            {
                var rel = "Fields/" + Path.GetRelativePath(fields, f).Replace('\\', '/');
                if (IsAllowed(rel)) yield return (rel, f);
            }
    }

    /// <summary>Blanks JSON properties named like a secret (string values only).</summary>
    private static byte[] Scrub(string rel, byte[] bytes)
    {
        if (!rel.EndsWith(".json", StringComparison.OrdinalIgnoreCase) && !rel.EndsWith(".geojson", StringComparison.OrdinalIgnoreCase)) return bytes;
        JsonNode? n;
        try { n = JsonNode.Parse(bytes); } catch (JsonException) { return bytes; }
        if (n is null || !Blank(n, rel.StartsWith("NtripProfiles/", StringComparison.Ordinal) ? NtripSecret : Secret)) return bytes;
        return Encoding.UTF8.GetBytes(n.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }

    private static bool Blank(JsonNode n, Regex secret)
    {
        bool changed = false;
        if (n is JsonObject o)
            foreach (var kv in o.ToList())
            {
                if (secret.IsMatch(kv.Key) && kv.Value is JsonValue v && v.TryGetValue(out string? s) && s.Length > 0) { o[kv.Key] = ""; changed = true; }
                else if (kv.Value is not null) changed |= Blank(kv.Value, secret);
            }
        else if (n is JsonArray a)
            foreach (var x in a) if (x is not null) changed |= Blank(x, secret);
        return changed;
    }

    // --- Import: list, check, preview, apply --------------------------------------------------

    /// <summary>The ZIPs in <paramref name="importDir"/> that carry a manifest of this format.</summary>
    public static IReadOnlyList<string> List(string importDir)
    {
        if (!Directory.Exists(importDir)) return Array.Empty<string>();
        var r = new List<string>();
        foreach (var f in Directory.GetFiles(importDir, "*.zip").OrderByDescending(File.GetLastWriteTimeUtc))
        {
            try
            {
                using var zip = ZipFile.OpenRead(f);
                if (ReadManifest(zip) is not null) r.Add(Path.GetFileName(f));
            }
            catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException or BackupException) { /* not ours */ }
        }
        return r;
    }

    /// <summary>A file name from the client: no path, a ZIP in the import folder.</summary>
    public static string ImportPath(string importDir, string file)
    {
        if (string.IsNullOrEmpty(file) || file.Contains('/') || file.Contains('\\') || file.Contains("..")
            || !file.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            throw new BackupException("badname", file);
        var p = Path.Combine(importDir, file);
        if (!File.Exists(p)) throw new BackupException("notfound", file);
        return p;
    }

    public static IReadOnlyList<Item> Preview(string zipPath, string dataRoot)
    {
        var entries = ReadChecked(zipPath);
        return Group(entries.Keys).Select(g => Compare(g.Kind, g.Name, g.Files, entries, dataRoot)).ToList();
    }

    /// <summary>Why applying is refused now (steer, moving, fieldopen), or null. Checked by the
    /// host on <c>backup.apply</c>, on top of the client's lock and the control gate.</summary>
    public static string? CheckApply(bool steeringOn, double speedKmh, string? openField, IEnumerable<string> selection)
    {
        if (steeringOn) return "steer";
        if (Math.Abs(speedKmh) >= 0.5) return "moving";
        if (!string.IsNullOrEmpty(openField) && selection.Contains("field:" + openField, StringComparer.OrdinalIgnoreCase))
            return "fieldopen";
        return null;
    }

    /// <summary>Backs up the current state into <paramref name="backupDir"/>, then writes the
    /// chosen entries (keys as in <see cref="Item.Key"/>). Throws before writing anything if the
    /// ZIP fails its check or the selection is empty.</summary>
    public static ApplyResult Apply(string zipPath, string dataRoot, IEnumerable<string> selection, string backupDir, string appVersion)
    {
        var entries = ReadChecked(zipPath);
        var want = new HashSet<string>(selection, StringComparer.OrdinalIgnoreCase);
        var groups = Group(entries.Keys).Where(g => want.Contains(g.Kind + ":" + g.Name)).ToList();
        if (groups.Count == 0) throw new BackupException("empty");
        var auto = Create(dataRoot, backupDir, appVersion, AutoPrefix);
        var written = new List<string>();
        var needPassword = new List<string>();
        foreach (var g in groups)
            foreach (var rel in g.Files)
            {
                var full = Path.Combine(dataRoot, rel.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(full)!);
                var bytes = entries[rel];
                if (g.Kind == "ntrip") bytes = KeepPassword(bytes, full, g.Name, needPassword);
                // The work log is merged, not replaced: sessions recorded since the backup stay.
                if (g.Kind == "worklog")
                {
                    if (WorkLog.WorkLogStore.Parse(bytes) is not { } doc) throw new BackupException("damaged", rel);
                    WorkLog.WorkLogStore.MergeInto(dataRoot, doc);
                    continue;
                }
                var tmp = full + ".import.tmp";
                File.WriteAllBytes(tmp, bytes);
                File.Move(tmp, full, overwrite: true);
            }
        written.AddRange(groups.Select(g => g.Kind + ":" + g.Name));
        return new ApplyResult(auto, written, needPassword);
    }

    /// <summary>An imported NTRIP profile comes without its password: take the one this device
    /// has stored for the same file, else report the profile.</summary>
    private static byte[] KeepPassword(byte[] imported, string currentPath, string fileName, List<string> needPassword)
    {
        JsonObject? imp;
        try { imp = JsonNode.Parse(imported) as JsonObject; } catch (JsonException) { return imported; }
        if (imp is null) return imported;
        var key = imp.Select(kv => kv.Key).FirstOrDefault(k => k.Equals("password", StringComparison.OrdinalIgnoreCase)) ?? "password";
        string? old = null;
        if (File.Exists(currentPath))
            try
            {
                var cur = JsonNode.Parse(File.ReadAllBytes(currentPath)) as JsonObject;
                var ck = cur?.Select(kv => kv.Key).FirstOrDefault(k => k.Equals("password", StringComparison.OrdinalIgnoreCase));
                if (ck != null && cur![ck] is JsonValue v && v.TryGetValue(out string? s) && s.Length > 0) old = s;
            }
            catch (JsonException) { /* unreadable: treated as no password */ }
        var name = imp.FirstOrDefault(kv => kv.Key.Equals("name", StringComparison.OrdinalIgnoreCase)).Value is JsonValue nv && nv.TryGetValue(out string? n) && n.Length > 0 ? n : fileName;
        if (old is null)
        {
            var has = imp[key] is JsonValue pv && pv.TryGetValue(out string? p) && p.Length > 0;
            if (!has) needPassword.Add(name);
            return imported;
        }
        imp[key] = old;
        return Encoding.UTF8.GetBytes(imp.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }

    /// <summary>Opens the ZIP and checks it fully: format, every entry in the manifest with the
    /// right size and SHA-256, nothing else, only allowed paths. Returns path → bytes.</summary>
    private static Dictionary<string, byte[]> ReadChecked(string zipPath)
    {
        ZipArchive zip;
        try { zip = ZipFile.OpenRead(zipPath); }
        catch (InvalidDataException) { throw new BackupException("notzip"); }
        using (zip)
        {
            var m = ReadManifest(zip) ?? throw new BackupException("nomanifest");
            var files = m["files"] as JsonArray ?? throw new BackupException("nolist");
            var r = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            long total = 0;
            foreach (var f in files)
            {
                var rel = (string?)f?["path"] ?? "";
                var sha = (string?)f?["sha256"] ?? "";
                var size = f?["size"] is JsonValue sv && sv.TryGetValue(out long l) ? l : -1;
                if (!IsAllowed(rel)) throw new BackupException("notallowed", rel);
                if (r.ContainsKey(rel)) throw new BackupException("twice", rel);
                var e = zip.GetEntry(rel) ?? throw new BackupException("missing", rel);
                if (size < 0 || e.Length != size) throw new BackupException("size", rel);
                total += size;
                if (total > MaxTotalBytes) throw new BackupException("toolarge");
                byte[] bytes;
                try
                {
                    using var s = e.Open(); using var ms = new MemoryStream();
                    s.CopyTo(ms); bytes = ms.ToArray();
                }
                catch (InvalidDataException) { throw new BackupException("damaged", rel); }
                if (!string.Equals(Sha(bytes), sha, StringComparison.OrdinalIgnoreCase)) throw new BackupException("checksum", rel);
                r[rel] = bytes;
            }
            foreach (var e in zip.Entries)
                if (e.FullName != ManifestName && !e.FullName.EndsWith('/') && !r.ContainsKey(e.FullName))
                    throw new BackupException("extra", e.FullName);
            return r;
        }
    }

    private static JsonObject? ReadManifest(ZipArchive zip)
    {
        var e = zip.GetEntry(ManifestName);
        if (e is null || e.Length > 16 << 20) return null;
        try
        {
            using var s = e.Open();
            var m = JsonNode.Parse(s) as JsonObject;
            if (m is null || (string?)m["format"] != Format) return null;
            if (m["formatVersion"] is not JsonValue v || !v.TryGetValue(out int ver) || ver != FormatVersion)
                throw new BackupException("version");
            return m;
        }
        catch (JsonException) { return null; }
    }

    /// <summary>Vehicles/&lt;file&gt;.json, Tools/&lt;file&gt;.json, Fields/&lt;field&gt;/… (not jobs/).</summary>
    private static bool IsAllowed(string rel)
    {
        if (string.IsNullOrEmpty(rel) || rel.Contains('\\') || rel.StartsWith('/') || rel.Contains(':')) return false;
        var p = rel.Split('/');
        if (p.Any(s => s.Length == 0 || s == "." || s == "..") || !Roots.Contains(p[0])) return false;
        if (p[0] == WorkLog.WorkLogStore.Folder) return p.Length == 2 && p[1] == WorkLog.WorkLogStore.FileName;
        if (p[0] is "Vehicles" or "Tools" or "NtripProfiles") return p.Length == 2 && p[1].EndsWith(".json", StringComparison.OrdinalIgnoreCase);
        if (p.Length < 3 || p[2].Equals("jobs", StringComparison.OrdinalIgnoreCase)) return false;
        return !p[^1].EndsWith(".tmp", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Files per entry: a vehicle or tool is its profile JSON plus companion files
    /// (<c>name.AutoSteer.json</c>); a field is its folder.</summary>
    private static IEnumerable<(string Kind, string Name, List<string> Files)> Group(IEnumerable<string> rels)
    {
        var d = new SortedDictionary<(string, string), List<string>>();
        foreach (var rel in rels)
        {
            var p = rel.Split('/');
            (string kind, string name) k = p[0] switch
            {
                "Vehicles" => ("vehicle", ProfileName(p[1])),
                "Tools" => ("tool", ProfileName(p[1])),
                "NtripProfiles" => ("ntrip", p[1][..^".json".Length]),
                WorkLog.WorkLogStore.Folder => ("worklog", WorkLog.WorkLogStore.FileName),
                _ => ("field", p[1]),
            };
            if (!d.TryGetValue(k, out var l)) d[k] = l = new List<string>();
            l.Add(rel);
        }
        return d.Select(kv => (kv.Key.Item1, kv.Key.Item2, kv.Value));
    }

    private static string ProfileName(string file)
    {
        var n = file[..^".json".Length];
        return n.EndsWith(".AutoSteer", StringComparison.OrdinalIgnoreCase) ? n[..^".AutoSteer".Length] : n;
    }

    private static Item Compare(string kind, string name, List<string> files, Dictionary<string, byte[]> entries, string dataRoot)
    {
        bool any = false, same = true;
        var changes = new List<string>();
        foreach (var rel in files)
        {
            var full = Path.Combine(dataRoot, rel.Replace('/', Path.DirectorySeparatorChar));
            // A missing file is added (a deleted profile can leave its .AutoSteer.json behind).
            if (!File.Exists(full)) { same = false; changes.Add("+ " + (kind == "field" ? rel[(rel.IndexOf('/', 7) + 1)..] : rel[(rel.IndexOf('/') + 1)..])); continue; }
            any = true;
            var cur = File.ReadAllBytes(full);
            // An NTRIP profile is compared without its password (the backup carries none, and the
            // stored one is kept on import).
            if (kind == "ntrip") cur = Scrub(rel, cur);
            if (cur.AsSpan().SequenceEqual(entries[rel])) continue;
            if (kind == "worklog")
            {
                // Merged on import: say how many sessions it adds, "same" if none.
                var added = WorkLogAdds(cur, entries[rel]);
                if (added == 0) continue;
                same = false;
                changes.Add("+ " + added.ToString(CultureInfo.InvariantCulture));
                continue;
            }
            same = false;
            if (kind == "field") changes.Add("~ " + rel[(rel.IndexOf('/', 7) + 1)..]);
            else changes.AddRange(JsonChanges(cur, entries[rel]));
        }
        var state = !any ? ItemState.New : same ? ItemState.Same : ItemState.Overwrites;
        if (state == ItemState.New) changes.Clear();
        return new Item(kind, name, state, changes.Take(8).ToList());
    }

    /// <summary>Sessions (or newer versions of them) the backup's work log adds to the stored one.</summary>
    private static int WorkLogAdds(byte[] cur, byte[] imp)
    {
        var c = WorkLog.WorkLogStore.Parse(cur) ?? WorkLog.WorkLogStore.Empty();
        var i = WorkLog.WorkLogStore.Parse(imp);
        if (i is null) return 0;
        var before = c["entries"]!.AsArray().Select(e => e!.ToJsonString()).ToHashSet(StringComparer.Ordinal);
        return WorkLog.WorkLogStore.Merge(c, i)["entries"]!.AsArray().Count(e => !before.Contains(e!.ToJsonString()));
    }

    /// <summary>"Vehicle.Wheelbase: 2.5 → 3" for the leaves that differ.</summary>
    private static IEnumerable<string> JsonChanges(byte[] cur, byte[] imp)
    {
        var a = new Dictionary<string, string>(); var b = new Dictionary<string, string>();
        try { Flatten(JsonNode.Parse(cur), "", a); Flatten(JsonNode.Parse(imp), "", b); }
        catch (JsonException) { return new[] { "(file differs)" }; }
        var r = new List<string>();
        foreach (var k in a.Keys.Union(b.Keys).OrderBy(k => k, StringComparer.Ordinal))
        {
            a.TryGetValue(k, out var x); b.TryGetValue(k, out var y);
            if (x != y) r.Add(k + ": " + (x ?? "—") + " → " + (y ?? "—"));
        }
        return r.Count > 0 ? r : new[] { "(formatting only)" };
    }

    private static void Flatten(JsonNode? n, string path, Dictionary<string, string> into)
    {
        switch (n)
        {
            case JsonObject o: foreach (var kv in o) Flatten(kv.Value, path.Length == 0 ? kv.Key : path + "." + kv.Key, into); break;
            case JsonArray a: for (int i = 0; i < a.Count; i++) Flatten(a[i], path + "[" + i + "]", into); break;
            case null: into[path] = "null"; break;
            default: into[path] = n.ToJsonString(); break;
        }
    }

    private static string Sha(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
}
