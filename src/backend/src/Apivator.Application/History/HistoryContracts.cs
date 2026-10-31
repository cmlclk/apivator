using Apivator.Domain.Collections;

namespace Apivator.Application.History;

public sealed class HistoryOptions
{
    public const string SectionName = "History";

    /// <summary>Saklanan yanıt gövdeleri bu kadar gün sonra silinir (kayıt kalır); 0 ise silinmez.</summary>
    public int ResponseRetentionDays { get; set; } = 30;
}

/// <summary>Geçmişe yazılacak yanıt gövdesi; kullanıcının "yanıtları sakla" tercihi kapalıysa yok sayılır.</summary>
public sealed record HistoryResponseBody(string Body, string? ContentType, bool Truncated);

public sealed record RecordHistoryRequest(
    RequestDefinition Definition,
    Guid? RequestId,
    int? Status,
    double? TimeMs,
    long? Size,
    HistoryResponseBody? Response = null);

public sealed record HistoryEntryDto(
    Guid Id,
    Guid? RequestId,
    string Method,
    string Url,
    RequestDefinition Definition,
    int? Status,
    double? TimeMs,
    long? Size,
    DateTimeOffset ExecutedAt,
    bool HasResponse = false);

public sealed record HistoryResponseDto(string Body, string? ContentType, bool Truncated);
