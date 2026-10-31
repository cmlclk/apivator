using Apivator.Application.Abstractions;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Identity;

internal sealed class PublicLinks(IOptions<AppOptions> options) : IPublicLinks
{
    public string Docs(string slug) => $"{options.Value.PublicUrl.TrimEnd('/')}/docs/{slug}";
}
