using Apivator.Application.Abstractions;
using Apivator.Domain.Collections;
using Apivator.Domain.Mocks;
using Apivator.Domain.Variables;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Mocks;

/// <summary>Mock'un sunduğu örnekleri ve değişken değerlerini veritabanından okur.</summary>
internal sealed class MockSource(IApplicationDbContext db)
{
    /// <summary>
    /// Örneklerdeki {{değişken}}'ler için: seçili environment, collection değişkenleri, workspace globals.
    /// Gizli işaretli değerler çözülmez; herkese açık bir mock onları asla dışarı vermez.
    /// </summary>
    public async Task<Func<string, string?>> LookupAsync(MockServer mock, CancellationToken ct)
    {
        var layers = new List<IReadOnlyList<Variable>>();
        if (mock.EnvironmentId is { } envId)
        {
            layers.Add(await db.Environments.AsNoTracking()
                .Where(e => e.Id == envId && e.WorkspaceId == mock.WorkspaceId).Select(e => e.Variables).FirstOrDefaultAsync(ct) ?? []);
        }

        layers.Add(await db.Collections.AsNoTracking().Where(c => c.Id == mock.CollectionId).Select(c => c.Variables).FirstOrDefaultAsync(ct) ?? []);
        layers.Add(await db.Workspaces.AsNoTracking().Where(w => w.Id == mock.WorkspaceId).Select(w => w.Globals).FirstOrDefaultAsync(ct) ?? []);

        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var variable in layers.SelectMany(l => l).Where(v => v.Enabled && !v.IsSecret))
        {
            values.TryAdd(variable.Key, variable.Value);
        }

        return name => values.GetValueOrDefault(name);
    }

    public async Task<IReadOnlyList<MockCandidate>> CandidatesAsync(Guid collectionId, CancellationToken ct)
    {
        var rows = await db.Examples.AsNoTracking()
            .Join(db.Requests.AsNoTracking().Where(r => r.CollectionId == collectionId), e => e.RequestId, r => r.Id, (e, r) => new { Example = e, Request = r })
            .OrderBy(x => x.Request.SortOrder).ThenBy(x => x.Request.CreatedAt).ThenBy(x => x.Example.SortOrder).ThenBy(x => x.Example.CreatedAt)
            .ToListAsync(ct);
        return rows.Where(x => x.Request.Definition.Kind is not (RequestKind.WebSocket or RequestKind.Grpc)).Select(x => new MockCandidate(
                x.Example.Id,
                x.Request.Name,
                x.Example.Name,
                x.Example.Status,
                x.Example.Headers,
                x.Example.Body,
                // İçe aktarılan bazı örneklerde istek bilgisi yok; o zaman isteğin kendisi kullanılır.
                string.IsNullOrWhiteSpace(x.Example.Request.Url) ? x.Request.Definition : x.Example.Request,
                x.Request.Id))
            .ToList();
    }

}
