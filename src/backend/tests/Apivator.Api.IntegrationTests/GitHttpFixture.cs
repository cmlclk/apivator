using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text;
using LibGit2Sharp;

namespace Apivator.Api.IntegrationTests;

/// <summary>
/// Gerçek bir git smart-HTTP sunucusu: <c>git http-backend</c> CGI olarak 127.0.0.1'de HttpListener arkasında
/// çalışır. İstenirse Basic kimlik doğrulaması zorunludur (belirtecin gerçekten geldiğini doğrulamak için).
/// Makinede git yoksa <see cref="Create"/> null döner (test atlanır).
/// </summary>
internal sealed class GitHttpFixture : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly string _backend;
    private readonly string _root;
    private readonly string? _basic;
    private int _authorized;
    private int _rejected;

    private GitHttpFixture(string backend, string root, string? user, string? token)
    {
        _backend = backend;
        _root = root;
        _basic = token is null ? null : "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes($"{user}:{token}"));
        var port = Random.Shared.Next(41000, 49000);
        _listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        _listener.Start();
        Url = $"http://127.0.0.1:{port}/repo.git";
        BarePath = Path.Combine(root, "repo.git");
        _ = Task.Run(Loop);
    }

    public string Url { get; }

    public string BarePath { get; }

    /// <summary>Doğru Authorization ile gelen istek sayısı.</summary>
    public int Authorized => _authorized;

    /// <summary>Kimlik doğrulaması reddedilen istek sayısı.</summary>
    public int Rejected => _rejected;

    public static GitHttpFixture? Create(string? user = null, string? token = null)
    {
        var backend = BackendPath();
        if (backend is null)
        {
            return null;
        }

        var root = Path.Combine(Path.GetTempPath(), "apivator-gitcgi-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var path = Path.Combine(root, "repo.git");
        Repository.Init(path, isBare: true);
        using (var repo = new Repository(path))
        {
            repo.Config.Set("http.receivepack", true);
        }

        return new GitHttpFixture(backend, root, user, token);
    }

    public void Dispose()
    {
        _listener.Close();
        if (!Directory.Exists(_root))
        {
            return;
        }

        foreach (var file in Directory.EnumerateFiles(_root, "*", SearchOption.AllDirectories))
        {
            File.SetAttributes(file, FileAttributes.Normal);
        }

        Directory.Delete(_root, true);
    }

    private static string? BackendPath()
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo("git", "--exec-path") { RedirectStandardOutput = true, UseShellExecute = false })!;
            var exec = process.StandardOutput.ReadToEnd().Trim();
            process.WaitForExit();
            var path = Path.Combine(exec, OperatingSystem.IsWindows() ? "git-http-backend.exe" : "git-http-backend");
            return File.Exists(path) ? path : null;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }

    private async Task Loop()
    {
        while (_listener.IsListening)
        {
            try
            {
                var context = await _listener.GetContextAsync();
                _ = Task.Run(() => Handle(context));
            }
            catch (Exception ex) when (ex is HttpListenerException or ObjectDisposedException)
            {
                return;
            }
        }
    }

    private async Task Handle(HttpListenerContext context)
    {
        if (_basic is not null && context.Request.Headers["Authorization"] != _basic)
        {
            Interlocked.Increment(ref _rejected);
            context.Response.StatusCode = 401;
            context.Response.Headers["WWW-Authenticate"] = "Basic realm=\"git\"";
            context.Response.Close();
            return;
        }

        Interlocked.Increment(ref _authorized);
        await RunCgi(context);
    }

    private async Task RunCgi(HttpListenerContext context)
    {
        var request = context.Request;
        var info = new ProcessStartInfo(_backend) { RedirectStandardInput = true, RedirectStandardOutput = true, UseShellExecute = false };
        info.Environment["GIT_PROJECT_ROOT"] = _root;
        info.Environment["GIT_HTTP_EXPORT_ALL"] = "1";
        info.Environment["REQUEST_METHOD"] = request.HttpMethod;
        info.Environment["PATH_INFO"] = request.Url!.AbsolutePath;
        info.Environment["QUERY_STRING"] = request.Url.Query.TrimStart('?');
        info.Environment["CONTENT_TYPE"] = request.ContentType ?? string.Empty;
        info.Environment["CONTENT_LENGTH"] = request.ContentLength64.ToString(CultureInfo.InvariantCulture);
        info.Environment["REMOTE_USER"] = "test";
        info.Environment["REMOTE_ADDR"] = "127.0.0.1";
        if (request.Headers["Content-Encoding"] is { } encoding)
        {
            info.Environment["HTTP_CONTENT_ENCODING"] = encoding;
        }

        using var process = Process.Start(info)!;
        await request.InputStream.CopyToAsync(process.StandardInput.BaseStream);
        process.StandardInput.Close();
        using var output = new MemoryStream();
        await process.StandardOutput.BaseStream.CopyToAsync(output);
        await process.WaitForExitAsync();
        var bytes = output.ToArray();
        var (headerLength, bodyStart) = FindHeaderEnd(bytes);
        context.Response.StatusCode = 200;
        foreach (var line in Encoding.ASCII.GetString(bytes, 0, headerLength).Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = line.Split(':', 2);
            if (parts[0].Equals("Status", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = int.Parse(parts[1].Trim().Split(' ')[0], CultureInfo.InvariantCulture);
            }
            else if (parts[0].Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.ContentType = parts[1].Trim();
            }
        }

        await context.Response.OutputStream.WriteAsync(bytes.AsMemory(bodyStart));
        context.Response.Close();
    }

    private static (int HeaderLength, int BodyStart) FindHeaderEnd(byte[] bytes)
    {
        for (var i = 0; i < bytes.Length - 3; i++)
        {
            if (bytes[i] == '\r' && bytes[i + 1] == '\n' && bytes[i + 2] == '\r' && bytes[i + 3] == '\n')
            {
                return (i, i + 4);
            }

            if (bytes[i] == '\n' && bytes[i + 1] == '\n')
            {
                return (i, i + 2);
            }
        }

        return (bytes.Length, bytes.Length);
    }
}
