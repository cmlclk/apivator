using System.Net;
using System.Net.Sockets;
using System.Text;
using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Activity;
using Apivator.Application.Auth;
using Apivator.Application.Execution;
using Apivator.Application.Mocks;
using Apivator.Application.Monitors;
using Apivator.Application.Realtime;
using Apivator.Infrastructure.Activity;
using Apivator.Infrastructure.Email;
using Apivator.Infrastructure.Execution;
using Apivator.Infrastructure.Identity;
using Apivator.Infrastructure.Monitors;
using Apivator.Infrastructure.Persistence;
using Apivator.Infrastructure.Realtime;
using Apivator.Infrastructure.Scripting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Apivator.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        // Bağlantı cümlesi servis çözülürken okunur; böylece testler ve ortam değişkenleri onu ezebilir.
        services.TryAddSingleton<IRealtimeNotifier, NullRealtimeNotifier>();
        services.AddScoped<ChangeNotificationInterceptor>();
        services.AddScoped<ChangeLogScope>();
        services.AddScoped<ChangeLogInterceptor>();
        services.AddScoped<Audit.AuditActorSource>();
        services.AddScoped<Audit.AuditInterceptor>();
        services.AddDbContext<AppDbContext>((sp, options) => options
            .UseNpgsql(
                sp.GetRequiredService<IConfiguration>().GetConnectionString("Postgres")
                    ?? throw new InvalidOperationException("ConnectionStrings:Postgres tanımlı değil."),
                npgsql => npgsql.MigrationsHistoryTable("__ef_migrations_history"))
            .AddInterceptors(
                // Sıra önemli: değişiklik kaydı önce eklenir, bildirim onu da görür.
                sp.GetRequiredService<ChangeLogInterceptor>(),
                sp.GetRequiredService<Audit.AuditInterceptor>(),
                sp.GetRequiredService<ChangeNotificationInterceptor>()));
        services.AddScoped<IApplicationDbContext>(sp => sp.GetRequiredService<AppDbContext>());

        services.AddOptions<JwtOptions>().Bind(configuration.GetSection(JwtOptions.SectionName)).ValidateDataAnnotations().ValidateOnStart();
        services.AddOptions<AppOptions>().Bind(configuration.GetSection(AppOptions.SectionName)).ValidateDataAnnotations().ValidateOnStart();
        services.AddSingleton<IPublicLinks, PublicLinks>();
        services.AddOptions<SmtpOptions>().Bind(configuration.GetSection(SmtpOptions.SectionName)).ValidateDataAnnotations().ValidateOnStart();

        services
            .AddIdentityCore<ApplicationUser>(options =>
            {
                options.User.RequireUniqueEmail = true;
                options.Password.RequiredLength = 8;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = false;
                options.Password.RequireNonAlphanumeric = false;
                options.Lockout.MaxFailedAccessAttempts = 5;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);
                options.Lockout.AllowedForNewUsers = true;
            })
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders()
            .AddErrorDescriber<LocalizedIdentityErrorDescriber>();

        // E-posta doğrulama/şifre sıfırlama token'ları container yeniden başlasa da geçerli kalsın diye anahtarlar DB'de.
        services.AddDataProtection().SetApplicationName("Apivator").PersistKeysToDbContext<AppDbContext>();

        services.AddSingleton<TokenService>();
        services.AddMemoryCache();
        services.AddScoped<AuthService>();
        services.AddScoped<IAuthService>(sp => sp.GetRequiredService<AuthService>());

        // SSO (OIDC): giriş, yönetim, alan adı doğrulaması.
        services.AddOptions<Application.Sso.SsoOptions>().Bind(configuration.GetSection(Application.Sso.SsoOptions.SectionName));
        services.AddScoped<Sso.SsoPolicy>();
        services.AddScoped<Sso.OidcClient>();
        services.TryAddSingleton<Sso.IDomainVerifier, Sso.DnsDomainVerifier>();
        services.AddScoped<Application.Sso.ISsoAdminService, Sso.SsoAdminService>();
        services.AddScoped<Application.Sso.ISsoLoginService, Sso.SsoLoginService>();
        services.AddScoped<Sso.SsoAccounts>();
        services.AddSingleton<Sso.SsoDomainRecheck>();
        services.AddHostedService(sp => sp.GetRequiredService<Sso.SsoDomainRecheck>());
        // Email:Mode = "Console" ise e-postalar gönderilmez, API konsoluna yazılır (Docker'sız geliştirme).
        services.AddScoped<SmtpEmailSender>();
        services.AddScoped<ConsoleEmailSender>();
        services.AddScoped<IEmailSender>(sp =>
            string.Equals(sp.GetRequiredService<IConfiguration>()["Email:Mode"], "Console", StringComparison.OrdinalIgnoreCase)
                ? sp.GetRequiredService<ConsoleEmailSender>()
                : sp.GetRequiredService<SmtpEmailSender>());

        services.AddScoped<IUserDirectory, UserDirectory>();
        services.AddScoped<IInvitationSender, InvitationSender>();
        services.AddScoped<IMentionMailer, MentionMailer>();
        services.AddScoped<IMergeRequestMailer, MergeRequestMailer>();
        services.AddScoped<IAccountService, AccountService>();
        services.AddSingleton<TwoFactor>();
        services.AddSecurityLog();
        services.AddScoped<ISecurityService, SecurityService>();
        services.AddOptions<Application.Audit.AuditOptions>().Bind(configuration.GetSection(Application.Audit.AuditOptions.SectionName));
        services.AddScoped<Application.Audit.IAuditLog, Audit.AuditLog>();
        services.AddScoped<Application.Audit.IAuditService, Audit.AuditService>();
        services.AddOptions<Application.History.HistoryOptions>().Bind(configuration.GetSection(Application.History.HistoryOptions.SectionName));
        services.AddSingleton<History.HistoryResponseRetention>();
        services.AddHostedService(sp => sp.GetRequiredService<History.HistoryResponseRetention>());
        services.AddSingleton<Audit.AuditRetention>();
        services.AddHostedService(sp => sp.GetRequiredService<Audit.AuditRetention>());
        services.AddScoped<IMonitorNotifier, MonitorNotifier>();
        services.AddOptions<MonitorOptions>().Bind(configuration.GetSection(MonitorOptions.SectionName));
        services.AddSingleton<MonitorScheduler>();
        services.AddSingleton<IMonitorScheduler>(sp => sp.GetRequiredService<MonitorScheduler>());
        services.AddHostedService(sp => sp.GetRequiredService<MonitorScheduler>());
        services.AddOptions<Import.SourceCheckOptions>().Bind(configuration.GetSection(Import.SourceCheckOptions.SectionName));
        services.AddSingleton<Import.SourceCheckScheduler>();
        services.AddSingleton<Application.Import.ISourceCheckScheduler>(sp => sp.GetRequiredService<Import.SourceCheckScheduler>());
        services.AddHostedService(sp => sp.GetRequiredService<Import.SourceCheckScheduler>());
        services.AddOptions<Application.GitSync.GitSyncOptions>().Bind(configuration.GetSection(Application.GitSync.GitSyncOptions.SectionName));
        services.AddSingleton<Application.GitSync.IGitRemote, GitSync.LibGitRemote>();
        services.AddScoped<Application.GitSync.IGitRemoteGuard, GitSync.GitRemoteGuard>();
        services.AddSingleton<Application.GitSync.IGitSecretProtector, GitSync.GitSecretProtector>();
        services.AddScoped<Application.GitSync.IGitLock, GitSync.PgGitLock>();
        services.AddSingleton<GitSync.GitCheckScheduler>();
        services.AddHostedService(sp => sp.GetRequiredService<GitSync.GitCheckScheduler>());
        services.AddRequestExecution(configuration);

        return services;
    }

    /// <summary>
    /// HTTP yürütücü, script sandbox'ı ve istek zinciri. Veritabanı gerektirmez; masaüstü ajanı da bunu kullanır.
    /// </summary>
    public static IServiceCollection AddRequestExecution(this IServiceCollection services, IConfiguration configuration)
    {
        services.TryAddSingleton(TimeProvider.System);

        // Hedef API'lerin döndürdüğü windows-1254, iso-8859-9 gibi karakter setlerini çözebilmek için.
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        services.AddOptions<ProxyOptions>().Bind(configuration.GetSection(ProxyOptions.SectionName)).ValidateDataAnnotations().ValidateOnStart();
        services.AddSingleton<NetworkGuard>();
        services.AddScoped<HttpRequestExecutor>();
        services.AddScoped<IRequestExecutor>(sp => sp.GetRequiredService<HttpRequestExecutor>());
        services.AddScoped<IRequestStreamer>(sp => sp.GetRequiredService<HttpRequestExecutor>());
        services.AddScoped<IWebSocketRelay, WebSocketRelay>();
        services.AddScoped<IGrpcRelay, Grpc.GrpcRelay>();
        services.AddScoped<IGrpcService, Grpc.GrpcService>();
        services.AddScoped<Application.Import.IApiSpecFetcher, ApiSpecFetcher>();
        // Masaüstü ajanı kendi kaynağını önceden kaydeder; yoksa SSRF korumalı fabrika istemcisi kullanılır.
        services.TryAddSingleton<IExecutionHttpClientSource, FactoryHttpClientSource>();
        services.AddOptions<MockOptions>().Bind(configuration.GetSection(MockOptions.SectionName));
        services.AddOptions<ScriptOptions>().Bind(configuration.GetSection(ScriptOptions.SectionName)).ValidateDataAnnotations().ValidateOnStart();
        services.AddScoped<ScriptSandbox>();
        services.AddScoped<IRequestPipeline, RequestPipeline>();

        services
            .AddHttpClient(HttpRequestExecutor.HttpClientName, client => client.Timeout = Timeout.InfiniteTimeSpan)
            .RemoveAllLoggers() // URL'lerdeki token'lar loglara düşmesin
            .ConfigurePrimaryHttpMessageHandler(sp =>
            {
                var guard = sp.GetRequiredService<NetworkGuard>();
                return new SocketsHttpHandler
                {
                    AllowAutoRedirect = true,
                    MaxAutomaticRedirections = 10,
                    AutomaticDecompression = DecompressionMethods.All,
                    UseCookies = false,
                    UseProxy = false,
                    PooledConnectionLifetime = TimeSpan.FromMinutes(2),
                    // ASCII dışı header değerleri (ör. "Ayşe") Postman'deki gibi UTF-8 gönderilir; varsayılan davranış hata verir.
                    RequestHeaderEncodingSelector = (_, _) => System.Text.Encoding.UTF8,
                    ConnectTimeout = TimeSpan.FromSeconds(15),
                    ConnectCallback = async (context, ct) =>
                    {
                        var host = context.DnsEndPoint.Host;
                        var addresses = IPAddress.TryParse(host, out var literal)
                            ? [literal]
                            : await Dns.GetHostAddressesAsync(host, ct);

                        // Yalnızca izin verilen adreslere bağlan; yönlendirmelerde de her bağlantı yeniden kontrol edilir.
                        var allowed = addresses.Where(guard.IsAllowed).ToArray();
                        if (allowed.Length == 0)
                        {
                            throw new BlockedDestinationException(host);
                        }

                        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                        try
                        {
                            await socket.ConnectAsync(allowed, context.DnsEndPoint.Port, ct);
                            return new NetworkStream(socket, ownsSocket: true);
                        }
                        catch
                        {
                            socket.Dispose();
                            throw;
                        }
                    },
                };
            });
        return services;
    }
}
