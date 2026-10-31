using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Infrastructure.Execution;

/// <summary>
/// Yürütücünün kullandığı HttpClient'ın kaynağı. Sunucuda SSRF korumalı fabrika istemcisi; masaüstü ajanı
/// kullanıcının proxy/SSL ayarlarıyla kurulan kendi istemcisini verir.
/// </summary>
public interface IExecutionHttpClientSource
{
    HttpClient CreateClient();
}

internal sealed class FactoryHttpClientSource(IHttpClientFactory factory) : IExecutionHttpClientSource
{
    public HttpClient CreateClient() => factory.CreateClient(HttpRequestExecutor.HttpClientName);
}
