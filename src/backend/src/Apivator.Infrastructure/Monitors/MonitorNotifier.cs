using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;
using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Common.Localization;
using Apivator.Application.Monitors;
using Apivator.Domain.Monitors;
using Apivator.Infrastructure.Email;
using Apivator.Infrastructure.Execution;
using Apivator.Infrastructure.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Monitors;

/// <summary>
/// Monitör bildirimlerini e-posta ve webhook (Slack, Teams ya da ayrıntılı JSON) ile gönderir. Webhook istekleri
/// normal isteklerle aynı ağ korumasından geçer (iç ağdaki bir adrese ancak izin verilen ağlardaysa gidilir).
/// </summary>
internal sealed class MonitorNotifier(
    IEmailSender email,
    IUserDirectory users,
    IApplicationDbContext db,
    IExecutionHttpClientSource clients,
    IOptions<AppOptions> app,
    ILogger<MonitorNotifier> logger) : IMonitorNotifier
{
    private static readonly TimeSpan WebhookTimeout = TimeSpan.FromSeconds(10);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Encoder = JavaScriptEncoder.Create(UnicodeRanges.All) };

    public async Task NotifyAsync(MonitorAlert alert, MonitorChannels channels, CancellationToken ct = default)
    {
        var link = $"{app.Value.PublicUrl.TrimEnd('/')}/?workspace={alert.WorkspaceId}&monitor={alert.MonitorId}";
        var orgLanguage = await NotificationLanguage.OrganizationAsync(db, alert.WorkspaceId, ct);

        foreach (var to in channels.Emails)
        {
            // Adres bir kullanıcıya aitse ve monitör e-postalarını kapattıysa gönderilmez (webhook etkilenmez).
            if (!await users.EmailAllowedAsync(to, EmailTopic.MonitorAlert, ct))
            {
                continue;
            }

            try
            {
                using var _ = Lang.Use(await users.PreferredLanguageByEmailAsync(to, ct) ?? orgLanguage);
                var (subject, headline, lines) = Describe(alert);
                await email.SendAsync(EmailTemplates.MonitorAlert(to, subject, headline, lines, link), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Monitör e-postası gönderilemedi: {Email}", to);
            }
        }

        if (channels.WebhookUrl is { } url)
        {
            // Webhook'un alıcısı bir kullanıcı değil: organizasyonun varsayılan dili.
            object payload;
            using (Lang.Use(orgLanguage))
            {
                var (_, headline, lines) = Describe(alert);
                payload = Payload(channels.WebhookKind, alert, headline, lines, link);
            }

            await PostWebhookAsync(url, payload, ct);
        }
    }

    internal static (string Subject, string Headline, List<string> Lines) Describe(MonitorAlert alert)
    {
        var lines = new List<string>
        {
            alert.EnvironmentName is null
                ? L.T("monitor.alert.collection", "Collection: {collection}", ("collection", alert.CollectionName))
                : L.T("monitor.alert.collection_env", "Collection: {collection} · Environment: {environment}", ("collection", alert.CollectionName), ("environment", alert.EnvironmentName)),
        };

        if (alert.Reason is not null && alert.RunId == Guid.Empty)
        {
            lines.Add(alert.Reason);
            return (
                L.T("monitor.alert.suspended_subject", "[Apivator] Monitör durduruldu: {name}", ("name", alert.MonitorName)),
                L.T("monitor.alert.suspended_headline", "\"{name}\" monitörü durduruldu", ("name", alert.MonitorName)),
                lines);
        }

        lines.Add(L.T("monitor.alert.time", "Zaman: {time}", ("time", alert.StartedAt.ToUniversalTime().ToString("yyyy-MM-dd HH:mm 'UTC'", CultureInfo.InvariantCulture))));
        lines.Add(L.T("monitor.alert.counts", "{total} istek · {passed} test geçti · {failed} test kaldı", ("total", alert.TotalRequests), ("passed", alert.TestsPassed), ("failed", alert.TestsFailed)));
        if (alert.Recovered)
        {
            return (
                L.T("monitor.alert.recovered_subject", "[Apivator] Düzeldi: {name}", ("name", alert.MonitorName)),
                L.T("monitor.alert.recovered_headline", "\"{name}\" yeniden başarılı", ("name", alert.MonitorName)),
                lines);
        }

        if (alert.Reason is not null)
        {
            lines.Add(alert.Reason);
        }

        if (alert.ConsecutiveFailures > 1)
        {
            lines.Add(L.T("monitor.alert.consecutive", "Art arda {count}. başarısız çalıştırma", ("count", alert.ConsecutiveFailures)));
        }

        foreach (var failure in alert.Failures)
        {
            var status = failure.Error ?? (failure.Status is { } code ? code.ToString(CultureInfo.InvariantCulture) : L.T("monitor.alert.no_response", "yanıt yok"));
            var tests = failure.FailedTests.Count > 0 ? " — " + string.Join("; ", failure.FailedTests) : string.Empty;
            lines.Add($"{failure.Method} {failure.RequestName} ({status}){tests}");
        }

        return (
            L.T("monitor.alert.failed_subject", "[Apivator] Başarısız: {name}", ("name", alert.MonitorName)),
            L.T("monitor.alert.failed_headline", "\"{name}\" monitörü başarısız", ("name", alert.MonitorName)),
            lines);
    }

    internal static object Payload(WebhookKind kind, MonitorAlert alert, string headline, IReadOnlyList<string> lines, string link)
    {
        var action = L.T("email.monitor.action", "Monitörü aç");
        var icon = alert.Recovered ? "✅" : "🔴";
        var markdown = new StringBuilder()
            .Append(icon).Append(' ').Append(kind == WebhookKind.Slack ? $"*{headline}*" : $"**{headline}**").Append('\n')
            .AppendJoin('\n', lines.Select(l => "• " + l))
            .Append('\n')
            .Append(kind == WebhookKind.Slack ? $"<{link}|{action}>" : $"[{action}]({link})")
            .ToString();

        return kind switch
        {
            WebhookKind.Slack or WebhookKind.Teams => new { text = markdown },
            _ => new
            {
                @event = alert.RunId == Guid.Empty ? "monitor.suspended" : alert.Recovered ? "monitor.recovered" : "monitor.failed",
                text = headline,
                link,
                monitor = new { id = alert.MonitorId, name = alert.MonitorName, workspaceId = alert.WorkspaceId },
                collection = alert.CollectionName,
                environment = alert.EnvironmentName,
                run = alert.RunId == Guid.Empty
                    ? null
                    : new
                    {
                        id = alert.RunId,
                        startedAt = alert.StartedAt,
                        totalRequests = alert.TotalRequests,
                        testsPassed = alert.TestsPassed,
                        testsFailed = alert.TestsFailed,
                    },
                consecutiveFailures = alert.ConsecutiveFailures,
                failures = alert.Failures,
                reason = alert.Reason,
            },
        };
    }

    private async Task PostWebhookAsync(string url, object payload, CancellationToken ct)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(WebhookTimeout);
            using var client = clients.CreateClient();
            // Gövde tamponlanır (Content-Length ile): bazı webhook alıcıları parçalı (chunked) gövdeyi kabul etmez.
            using var content = new StringContent(JsonSerializer.Serialize(payload, Json), Encoding.UTF8, "application/json");
            using var response = await client.PostAsync(url, content, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Monitör webhook'u {Status} döndü: {Host}", (int)response.StatusCode, new Uri(url).Host);
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            // Adresin kendisi token içerebilir (Slack); loga yalnızca host yazılır.
            logger.LogWarning("Monitör webhook'u gönderilemedi ({Host}): {Message}", new Uri(url).Host, ex.Message);
        }
    }
}
