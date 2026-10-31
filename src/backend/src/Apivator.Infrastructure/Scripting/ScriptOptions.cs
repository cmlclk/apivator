using System.ComponentModel.DataAnnotations;

namespace Apivator.Infrastructure.Scripting;

public sealed class ScriptOptions
{
    public const string SectionName = "Scripts";

    /// <summary>Bir aşamadaki (pre-request ya da post-response) tüm script'lerin toplam süresi.</summary>
    [Range(1, 120)]
    public int TimeoutSeconds { get; set; } = 15;

    /// <summary>Script motorunun bir aşamada ayırabileceği bellek (MB).</summary>
    [Range(16, 2048)]
    public int MemoryLimitMb { get; set; } = 256;

    /// <summary>Bir aşamada <c>pm.sendRequest</c> ile atılabilecek en fazla istek.</summary>
    [Range(0, 100)]
    public int MaxSendRequests { get; set; } = 10;
}
