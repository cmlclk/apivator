using System.Net;
using System.Net.Http.Json;
using Apivator.Api.IntegrationTests.Fixtures;
using Apivator.Application.ApiKeys;
using Apivator.Application.Sso;
using Apivator.Application.Teams;
using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Persistence;
using Apivator.Infrastructure.Sso;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests;

/// <summary>SSO yönetimi: kimlik sağlayıcı ayarı, alan adı doğrulama, açma/zorunlu kılma ve denetim kaydı.</summary>
[Collection(ApiCollection.Name)]
public class SsoTests(ApivatorApiFactory factory) : SsoTestBase(factory)
{
    [Fact]
    public async Task OnlyOwnerConfigures_AdminReads_AndSecretIsNeverReturned()
    {
        var owner = await UserAsync(name: "Sahip");
        var (org, _) = await OrganizationAsync(owner);
        var admin = await UserAsync(name: "Yönetici");
        await MemberAsync(owner, org.Id, admin, OrganizationRole.Admin);
        var member = await UserAsync(name: "Üye");
        await MemberAsync(owner, org.Id, member);
        var outsider = await UserAsync(name: "Dışarıdan");

        var empty = await owner.Client.GetFromJsonAsync<SsoSettingsDto>($"/api/organizations/{org.Id}/sso");
        Assert.Equal((false, false, false, false), (empty!.Configured, empty.Enabled, empty.Enforced, empty.HasClientSecret));
        Assert.Equal(RedirectUri, empty.RedirectUri);

        Assert.Equal(HttpStatusCode.Forbidden, (await ConfigureAsync(admin, org.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync($"/api/organizations/{org.Id}/sso")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync($"/api/organizations/{org.Id}/sso")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ConfigureAsync(outsider, org.Id)).StatusCode);

        var saved = await (await ConfigureAsync(owner, org.Id, autoProvision: false, defaultRole: OrganizationRole.Admin)).ReadAsync<SsoSettingsDto>();
        Assert.Equal((true, Idp.BaseUrl, Idp.ClientId, true, false, OrganizationRole.Admin), (saved.Configured, saved.Authority, saved.ClientId, saved.HasClientSecret, saved.AutoProvision, saved.DefaultRole));

        // Yönetici okur ama secret'ın kendisi hiçbir yanıtta yer almaz.
        var asAdmin = await admin.Client.GetAsync($"/api/organizations/{org.Id}/sso");
        var raw = await asAdmin.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, asAdmin.StatusCode);
        Assert.DoesNotContain(Idp.ClientSecret, raw, StringComparison.Ordinal);
        Assert.True((await asAdmin.Content.ReadFromJsonAsync<SsoSettingsDto>())!.HasClientSecret);
        Assert.Equal(HttpStatusCode.Forbidden, (await SetStateAsync(admin, org.Id, false)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/sso/domains", new AddSsoDomainRequest(NewDomain()))).StatusCode);

        // null secret'ı korur, boş dize siler (public client).
        var kept = await (await owner.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/sso", new UpdateSsoRequest(Idp.BaseUrl + "/", "yeni-istemci", null))).ReadAsync<SsoSettingsDto>();
        Assert.Equal((Idp.BaseUrl, "yeni-istemci", true), (kept.Authority, kept.ClientId, kept.HasClientSecret));
        var cleared = await (await owner.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/sso", new UpdateSsoRequest(Idp.BaseUrl, "yeni-istemci", string.Empty))).ReadAsync<SsoSettingsDto>();
        Assert.False(cleared.HasClientSecret);

        var ownerRole = await owner.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/sso", new UpdateSsoRequest(Idp.BaseUrl, "x", null, true, OrganizationRole.Owner));
        Assert.Equal(HttpStatusCode.BadRequest, ownerRole.StatusCode);

        var entries = await AuditAsync(owner, org.Id, "sso.configured");
        Assert.Equal(["değiştirildi", null, "kaldırıldı"], entries.Select(e => e.Data.GetValueOrDefault("client_secret")).Reverse());
        Assert.DoesNotContain(entries, e => e.Data.Values.Any(v => v.Contains(Idp.ClientSecret, StringComparison.Ordinal)));
        Assert.Equal((Idp.BaseUrl, Idp.ClientId, "false", "Admin"), (entries[^1].Data["authority"], entries[^1].Data["client_id"], entries[^1].Data["auto_provision"], entries[^1].Data["default_role"]));
    }

    [Fact]
    public async Task ApiKeys_CannotReadOrChangeSso()
    {
        var owner = await UserAsync();
        var (org, _) = await OrganizationAsync(owner);
        var key = await (await owner.Client.PostAsJsonAsync("/api/me/api-keys", new CreateApiKeyRequest("CI"))).ReadAsync<CreatedApiKeyDto>();
        var keyClient = Factory.CreateClient();
        keyClient.DefaultRequestHeaders.Add("X-Api-Key", key.Secret);

        Assert.Equal(HttpStatusCode.Forbidden, (await keyClient.GetAsync($"/api/organizations/{org.Id}/sso")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await ConfigureAsync(new User(keyClient, owner.Id, owner.Email), org.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await keyClient.GetAsync($"/api/organizations/{org.Id}/audit")).StatusCode);
    }

    [Fact]
    public async Task DailyRecheck_UnverifiesDomainAfterThreeMisses_AndDisablesSso()
    {
        var s = await SsoOrgAsync();
        var domain = (await s.Owner.Client.GetFromJsonAsync<SsoSettingsDto>($"/api/organizations/{s.Org.Id}/sso"))!.Domains.Single();
        var recheck = Factory.Services.GetRequiredService<SsoDomainRecheck>();

        // Kontrol yalnızca son kontrolü 24 saatten eski alan adlarında çalışır; her turda geriye çekilir.
        async Task RecheckAsync()
        {
            using (var scope = Factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.SsoDomains.Where(d => d.Id == domain.Id).ExecuteUpdateAsync(u => u.SetProperty(d => d.LastCheckedAt, DateTimeOffset.UtcNow.AddDays(-2)));
            }

            await recheck.RecheckDomainsAsync();
        }

        async Task<bool> VerifiedAsync() =>
            (await s.Owner.Client.GetFromJsonAsync<SsoSettingsDto>($"/api/organizations/{s.Org.Id}/sso"))!.Domains.Single().Verified;

        // İki kayıp + DNS hatası (sayılmaz) + kaydın geri gelmesi sayacı sıfırlar.
        Factory.Dns.Remove(domain.RecordName);
        await RecheckAsync();
        Factory.Dns.Fail(domain.RecordName);
        await RecheckAsync();
        Factory.Dns.Remove(domain.RecordName);
        await RecheckAsync();
        Assert.True(await VerifiedAsync());
        Factory.Dns.Publish(domain.RecordName, domain.RecordValue);
        await RecheckAsync();

        Factory.Dns.Remove(domain.RecordName);
        await RecheckAsync();
        await RecheckAsync();
        Assert.True(await VerifiedAsync());
        await RecheckAsync();

        Assert.False(await VerifiedAsync());
        var settings = await s.Owner.Client.GetFromJsonAsync<SsoSettingsDto>($"/api/organizations/{s.Org.Id}/sso");
        Assert.Equal((false, false), (settings!.Enabled, settings.Enforced));
        Assert.False((await Factory.CreateClient().GetFromJsonAsync<SsoDiscoveryDto>($"/api/auth/sso/discover?email=ali@{s.Domain}"))!.Available);

        var unverified = Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.domain_unverified"));
        Assert.Equal(s.Domain, unverified.Data["domain"]);
        Assert.Contains(await AuditAsync(s.Owner, s.Org.Id, "sso.disabled"), e => e.Data.ContainsKey("reason"));
    }

    [Fact]
    public async Task DiscoveryEndpoints_MustBeWebAddresses_OnSaveAndLater()
    {
        var owner = await UserAsync();
        var (org, _) = await OrganizationAsync(owner);

        // Tarayıcı authorization_endpoint'e yönlendirilir: javascript:/ftp:/file: gibi şemalar kabul edilmez.
        foreach (var (set, value) in new (Action<string?> Set, string Value)[]
                 {
                     (v => Idp.AdvertisedAuthorizationEndpoint = v, "javascript:alert(document.cookie)"),
                     (v => Idp.AdvertisedTokenEndpoint = v, "ftp://127.0.0.1/token"),
                     (v => Idp.AdvertisedJwksUri = v, "file:///etc/passwd"),
                 })
        {
            set(value);
            var response = await ConfigureAsync(owner, org.Id);
            Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"{value}: {(int)response.StatusCode}");
            Assert.Contains("authority", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            set(null);
        }

        Assert.False((await owner.Client.GetFromJsonAsync<SsoSettingsDto>($"/api/organizations/{org.Id}/sso"))!.Configured);
        Assert.Empty(await AuditAsync(owner, org.Id));
    }

    [Fact]
    public async Task DiscoveryDocumentTurningUnsafeLater_StopsNewLogins()
    {
        var s = await SsoOrgAsync();
        var email = $"kisi@{s.Domain}";
        Assert.Equal(HttpStatusCode.OK, (await StartAsync(email)).StatusCode);

        // Belge önbellekte 12 saat tutulur; yenilenmesini önbelleği boşaltarak taklit ederiz.
        Idp.AdvertisedAuthorizationEndpoint = "javascript:alert(1)";
        ForgetDiscovery();
        var start = await StartAsync(email);
        Assert.Equal(HttpStatusCode.BadRequest, start.StatusCode);
        Assert.Contains("sso.provider_unreachable", await start.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Belge düzelince (hatalı belge önbellekte tutulmaz) giriş yeniden başlar.
        Idp.AdvertisedAuthorizationEndpoint = null;
        Assert.Equal(HttpStatusCode.OK, (await StartAsync(email)).StatusCode);
    }

    private void ForgetDiscovery()
    {
        var managers = (System.Collections.IDictionary)typeof(OidcClient)
            .GetField("Managers", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!.GetValue(null)!;
        managers.Remove(Idp.BaseUrl);
    }

    [Fact]
    public async Task ConcurrentRechecks_CountOneMissPerRound_AndAuditOnce()
    {
        var s = await SsoOrgAsync();
        var domain = (await s.Owner.Client.GetFromJsonAsync<SsoSettingsDto>($"/api/organizations/{s.Org.Id}/sso"))!.Domains.Single();
        var recheck = Factory.Services.GetRequiredService<SsoDomainRecheck>();
        Factory.Dns.Remove(domain.RecordName);

        // Üç örnek (ör. üç API sunucusu) aynı anda çalışır; her turda alan adını yalnızca biri sayar.
        async Task<int> RoundAsync()
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.SsoDomains.Where(d => d.Id == domain.Id).ExecuteUpdateAsync(u => u.SetProperty(d => d.LastCheckedAt, DateTimeOffset.UtcNow.AddDays(-2)));
            await Task.WhenAll(recheck.RecheckDomainsAsync(), recheck.RecheckDomainsAsync(), recheck.RecheckDomainsAsync());
            return await db.SsoDomains.Where(d => d.Id == domain.Id).Select(d => d.FailedChecks).SingleAsync();
        }

        Assert.Equal(1, await RoundAsync());
        Assert.Equal(2, await RoundAsync());
        await RoundAsync();

        Assert.False((await s.Owner.Client.GetFromJsonAsync<SsoSettingsDto>($"/api/organizations/{s.Org.Id}/sso"))!.Domains.Single().Verified);
        Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.domain_unverified"));
        Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.disabled"));
    }

    [Fact]
    public async Task PersonalOrganization_CannotUseSso()
    {
        var owner = await UserAsync();
        var personal = (await owner.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!.Single(o => o.IsPersonal);

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.GetAsync($"/api/organizations/{personal.Id}/sso")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ConfigureAsync(owner, personal.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync($"/api/organizations/{personal.Id}/sso/domains", new AddSsoDomainRequest(NewDomain()))).StatusCode);
    }

    [Fact]
    public async Task InvalidOrUnreachableAuthority_IsNotSaved()
    {
        var owner = await UserAsync();
        var (org, _) = await OrganizationAsync(owner);

        // Özel ağ ve bulut metadata adresleri ağ korumasına takılır (yalnızca 127.0.0.1/32 açık).
        var ssrf = new[] { "http://10.0.0.1", "https://10.0.0.1", "http://169.254.169.254", "http://192.168.1.1/tenant" };
        foreach (var authority in ssrf.Concat(["http://127.0.0.1:1", Idp.BaseUrl + "/yok", "ftp://idp.example", Idp.BaseUrl + "?tenant=1", "issuer"]))
        {
            var response = await ConfigureAsync(owner, org.Id, authority: authority);
            Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"{authority}: {(int)response.StatusCode}");
            Assert.Contains("authority", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }

        // Keşif belgesindeki issuer, istenen adresle aynı olmalı (OIDC Discovery 4.3).
        var impostor = new FakeOidcProvider { AdvertisedIssuer = "https://login.baska-kiraci.example" };
        await impostor.InitializeAsync();
        try
        {
            var mismatch = await ConfigureAsync(owner, org.Id, authority: impostor.BaseUrl);
            Assert.Equal(HttpStatusCode.BadRequest, mismatch.StatusCode);
            Assert.Contains("authority", await mismatch.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
        finally
        {
            await impostor.DisposeAsync();
        }

        var missingClient = await owner.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/sso", new UpdateSsoRequest(Idp.BaseUrl, " ", null));
        Assert.Equal(HttpStatusCode.BadRequest, missingClient.StatusCode);

        Assert.False((await owner.Client.GetFromJsonAsync<SsoSettingsDto>($"/api/organizations/{org.Id}/sso"))!.Configured);
        Assert.Empty(await AuditAsync(owner, org.Id));
    }

    [Fact]
    public async Task DomainVerification_RequiresTxtRecord()
    {
        var owner = await UserAsync();
        var (org, _) = await OrganizationAsync(owner);
        var domain = NewDomain();

        var added = await AddDomainAsync(owner, org.Id, "@" + domain.ToUpperInvariant() + ".");
        Assert.Equal((domain, false, null), (added.Domain, added.Verified, added.VerifiedAt));
        Assert.Equal("_apivator." + domain, added.RecordName);
        Assert.StartsWith("apivator-verification=", added.RecordValue, StringComparison.Ordinal);

        var missing = await VerifyAsync(owner, org.Id, added.Id);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        var body = await missing.Content.ReadAsStringAsync();
        Assert.Contains("sso.domain_unverified", body, StringComparison.Ordinal);
        Assert.Contains(added.RecordName, body, StringComparison.Ordinal);

        Factory.Dns.Publish(added.RecordName, "apivator-verification=yanlis");
        Assert.Equal(HttpStatusCode.BadRequest, (await VerifyAsync(owner, org.Id, added.Id)).StatusCode);

        Factory.Dns.Publish(added.RecordName, added.RecordValue);
        var verified = (await (await VerifyAsync(owner, org.Id, added.Id)).ReadAsync<SsoSettingsDto>()).Domains.Single();
        Assert.True(verified.Verified);
        Assert.NotNull(verified.VerifiedAt);

        // Tekrar doğrulamak zararsızdır; aynı alan adı ikinci kez eklenemez; geçersiz adlar reddedilir.
        Assert.Equal(HttpStatusCode.OK, (await VerifyAsync(owner, org.Id, added.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/sso/domains", new AddSsoDomainRequest(domain))).StatusCode);
        foreach (var invalid in new[] { "localhost", "bosluk var.com", "-tire.com", "a..b.com", string.Empty })
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/sso/domains", new AddSsoDomainRequest(invalid))).StatusCode);
        }

        Assert.Equal(HttpStatusCode.NotFound, (await VerifyAsync(owner, org.Id, Guid.NewGuid())).StatusCode);
        Assert.Equal(["sso.domain_added", "sso.domain_verified"], (await AuditAsync(owner, org.Id)).Select(e => e.Action).Reverse());
    }

    [Fact]
    public async Task VerifiedDomain_BelongsToOneOrganization()
    {
        var a = await UserAsync(name: "A Sahibi");
        var (orgA, _) = await OrganizationAsync(a, "A A.Ş.");
        var b = await UserAsync(name: "B Sahibi");
        var (orgB, _) = await OrganizationAsync(b, "B A.Ş.");

        // A doğruladıktan sonra B aynı alan adını ekleyemez.
        var taken = NewDomain();
        await VerifiedDomainAsync(a, orgA.Id, taken);
        var conflict = await b.Client.PostAsJsonAsync($"/api/organizations/{orgB.Id}/sso/domains", new AddSsoDomainRequest(taken));
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Contains("sso.domain_taken", await conflict.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // İkisi de doğrulanmadan eklediyse ilk doğrulayan kazanır; ikincinin TXT kaydı olsa bile doğrulanmaz.
        var contested = NewDomain();
        var forA = await AddDomainAsync(a, orgA.Id, contested);
        var forB = await AddDomainAsync(b, orgB.Id, contested);
        Assert.NotEqual(forA.RecordValue, forB.RecordValue);
        Factory.Dns.Publish(forA.RecordName, forA.RecordValue);
        (await VerifyAsync(a, orgA.Id, forA.Id)).EnsureSuccessStatusCode();
        Factory.Dns.Publish(forB.RecordName, forB.RecordValue);
        Assert.Equal(HttpStatusCode.Conflict, (await VerifyAsync(b, orgB.Id, forB.Id)).StatusCode);

        // Başka organizasyonun alan adı kaydı üzerinden işlem yapılamaz.
        Assert.Equal(HttpStatusCode.NotFound, (await VerifyAsync(b, orgB.Id, forA.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.Client.DeleteAsync($"/api/organizations/{orgB.Id}/sso/domains/{forA.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.Client.DeleteAsync($"/api/organizations/{orgA.Id}/sso/domains/{forA.Id}")).StatusCode);
    }

    [Fact]
    public async Task Enabling_RequiresConfigAndVerifiedDomain_AndRemovingLastDomainDisables()
    {
        var owner = await UserAsync();
        var (org, _) = await OrganizationAsync(owner, "Açık Kapalı A.Ş.");
        var domain = NewDomain();

        var notConfigured = await SetStateAsync(owner, org.Id, true);
        Assert.Equal(HttpStatusCode.BadRequest, notConfigured.StatusCode);
        Assert.Contains("sso.not_configured", await notConfigured.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        (await ConfigureAsync(owner, org.Id)).EnsureSuccessStatusCode();
        var pending = await AddDomainAsync(owner, org.Id, domain);
        var noDomain = await SetStateAsync(owner, org.Id, true);
        Assert.Equal(HttpStatusCode.BadRequest, noDomain.StatusCode);
        Assert.Contains("sso.no_verified_domain", await noDomain.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.False((await Factory.CreateClient().GetFromJsonAsync<SsoDiscoveryDto>($"/api/auth/sso/discover?email=ali@{domain}"))!.Available);

        Factory.Dns.Publish(pending.RecordName, pending.RecordValue);
        (await VerifyAsync(owner, org.Id, pending.Id)).EnsureSuccessStatusCode();

        // Kapalıyken zorunlu olamaz.
        var off = await (await SetStateAsync(owner, org.Id, false, enforced: true)).ReadAsync<SsoSettingsDto>();
        Assert.Equal((false, false), (off.Enabled, off.Enforced));
        var on = await (await SetStateAsync(owner, org.Id, true, enforced: true)).ReadAsync<SsoSettingsDto>();
        Assert.Equal((true, true), (on.Enabled, on.Enforced));

        var discovery = await Factory.CreateClient().GetFromJsonAsync<SsoDiscoveryDto>($"/api/auth/sso/discover?email={Uri.EscapeDataString("Ali@" + domain.ToUpperInvariant())}");
        Assert.Equal(new SsoDiscoveryDto(true, true, "Açık Kapalı A.Ş."), discovery);
        Assert.Equal(new SsoDiscoveryDto(false, false, null), await Factory.CreateClient().GetFromJsonAsync<SsoDiscoveryDto>("/api/auth/sso/discover?email=ali@baska.example"));
        Assert.Equal(new SsoDiscoveryDto(false, false, null), await Factory.CreateClient().GetFromJsonAsync<SsoDiscoveryDto>("/api/auth/sso/discover?email=gecersiz"));

        // Son doğrulanmış alan adı kalkınca SSO kapanır (giriş yapılamayacak bir ayar açık kalmaz).
        (await owner.Client.DeleteAsync($"/api/organizations/{org.Id}/sso/domains/{pending.Id}")).EnsureSuccessStatusCode();
        var after = await owner.Client.GetFromJsonAsync<SsoSettingsDto>($"/api/organizations/{org.Id}/sso");
        Assert.Equal((true, false, false), (after!.Configured, after.Enabled, after.Enforced));
        Assert.Empty(after.Domains);
        Assert.False((await Factory.CreateClient().GetFromJsonAsync<SsoDiscoveryDto>($"/api/auth/sso/discover?email=ali@{domain}"))!.Available);

        // Aynı kaydetmede yazılan olayların kendi aralarındaki sırası önemli değil.
        var entries = await AuditAsync(owner, org.Id);
        var actions = entries.Select(e => e.Action).Reverse().ToList();
        Assert.Equal(["sso.configured", "sso.domain_added", "sso.domain_verified"], actions[..3]);
        Assert.Equal(["sso.enabled", "sso.enforced"], actions[3..5].Order());
        Assert.Equal(["sso.disabled", "sso.domain_removed"], actions[5..].Order());
        Assert.All(entries, e => Assert.Equal((org.Id, "Açık Kapalı A.Ş."), (e.TargetId, e.TargetName)));
        Assert.Equal(domain, entries.Single(e => e.Action == "sso.domain_removed").Data["domain"]);
        Assert.Contains("alan adı", entries.Single(e => e.Action == "sso.disabled").Data["reason"], StringComparison.Ordinal);

        // Ayar ve doğrulama sonrası yeniden açılabilir, zorunluluk ayrıca kaldırılabilir.
        await VerifiedDomainAsync(owner, org.Id, NewDomain());
        await (await SetStateAsync(owner, org.Id, true, enforced: true)).ReadAsync<SsoSettingsDto>();
        var relaxed = await (await SetStateAsync(owner, org.Id, true, enforced: false)).ReadAsync<SsoSettingsDto>();
        Assert.Equal((true, false), (relaxed.Enabled, relaxed.Enforced));
        var latest = (await AuditAsync(owner, org.Id)).Select(e => e.Action).ToList();
        Assert.Equal("sso.unenforced", latest[0]);
        Assert.Equal(["sso.enabled", "sso.enforced"], latest[1..3].Order());
    }
}
