using Apivator.Application.Account;

namespace Apivator.Api.Infrastructure;

/// <summary>İsteği yapan istemci (User-Agent, IP, X-Apivator-App); güvenlik geçmişine yazılır.</summary>
internal sealed class CurrentClient(IHttpContextAccessor accessor) : ICurrentClient
{
    public ClientInfo Info => accessor.HttpContext is { } http ? ClientInfoReader.From(http) : ClientInfo.Unknown;
}
