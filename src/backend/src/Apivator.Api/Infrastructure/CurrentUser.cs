using Apivator.Application.Abstractions;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Apivator.Api.Infrastructure;

internal sealed class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? Id =>
        Guid.TryParse(accessor.HttpContext?.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var id) ? id : null;

    public string? DisplayName => accessor.HttpContext?.User.FindFirst(JwtRegisteredClaimNames.Name)?.Value;

    public Guid? ApiKeyId =>
        Guid.TryParse(accessor.HttpContext?.User.FindFirst("api_key_id")?.Value, out var id) ? id : null;
}
