// AgOpenWeb
// Copyright (C) 2024-2026 AgOpenWeb Contributors
// SPDX-License-Identifier: Apache-2.0

using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using AgOpenWeb.RemoteServer;
using NUnit.Framework;

namespace AgOpenWeb.RemoteServer.Tests;

/// <summary>Fork (start time): a route with an ETag answers 304 without a body when the client
/// already holds that ETag, and the full file otherwise; routes without one are unchanged.</summary>
[TestFixture]
public class SimpleWebServerETagTests
{
    private SimpleWebServer _server = null!;
    private HttpClient _http = null!;

    [SetUp]
    public async Task SetUp()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        int port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        _server = new SimpleWebServer(port);
        _server.MapGet("/tagged", () => SimpleWebServer.Response.Text("body", "text/plain",
            new[] { ("Cache-Control", "no-cache"), ("ETag", "\"abc\"") }));
        _server.MapGet("/plain", () => SimpleWebServer.Response.Text("body", "text/plain"));
        await _server.StartAsync();
        _http = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{port}") };
    }

    [TearDown]
    public async Task TearDown()
    {
        _http.Dispose();
        await _server.StopAsync();
    }

    private Task<HttpResponseMessage> Get(string path, string? ifNoneMatch)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, path);
        if (ifNoneMatch != null) req.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
        return _http.SendAsync(req);
    }

    [Test]
    public async Task SameETag_Is304_WithoutBody()
    {
        var res = await Get("/tagged", "\"abc\"");
        Assert.That((int)res.StatusCode, Is.EqualTo(304));
        Assert.That((await res.Content.ReadAsByteArrayAsync()).Length, Is.EqualTo(0));
        Assert.That(res.Headers.ETag?.Tag, Is.EqualTo("\"abc\""));
    }

    [Test]
    public async Task OtherOrNoETag_GetsTheFile()
    {
        foreach (var inm in new[] { "\"old\"", null })
        {
            var res = await Get("/tagged", inm);
            Assert.That(res.StatusCode, Is.EqualTo(HttpStatusCode.OK));
            Assert.That(await res.Content.ReadAsStringAsync(), Is.EqualTo("body"));
        }
    }

    [Test]
    public async Task RouteWithoutETag_IsUnchanged()
    {
        var res = await Get("/plain", "\"abc\"");
        Assert.That(res.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(await res.Content.ReadAsStringAsync(), Is.EqualTo("body"));
    }

    [Test]
    public async Task KeepAlive_ServesTheNextRequestAfterA304()
    {
        Assert.That((int)(await Get("/tagged", "\"abc\"")).StatusCode, Is.EqualTo(304));
        Assert.That(await _http.GetStringAsync("/plain"), Is.EqualTo("body"));
    }
}
