using Apivator.Application.Abstractions;

namespace Apivator.Agent;

/// <summary>Ajan tek kullanıcılıdır; OAuth token önbelleği bu sabit kimlikle anahtarlanır.</summary>
internal sealed class LocalUser : ICurrentUser
{
    public static readonly Guid LocalId = new("00000000-0000-0000-0000-00000000a6e7");

    public Guid? Id => LocalId;
}
