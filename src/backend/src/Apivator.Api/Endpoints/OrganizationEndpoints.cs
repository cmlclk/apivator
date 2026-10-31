using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Common;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;

namespace Apivator.Api.Endpoints;

internal static class OrganizationEndpoints
{
    public static void MapOrganizationEndpoints(this IEndpointRouteBuilder routes)
    {
        var orgs = routes.MapGroup("/organizations").WithTags("Organizations").RequireAuthorization();

        orgs.MapGet("/", async (IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
            Results.Ok(await service.ListAsync(user.RequiredId, ct)));

        orgs.MapPost("/", async (CreateOrganizationRequest request, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
            Created(await service.CreateAsync(request, user.RequiredId, ct)));

        orgs.MapPatch("/{id:guid}", async (Guid id, RenameRequest request, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RenameAsync(id, request, user.RequiredId, ct)).ToHttp());

        orgs.MapPut("/{id:guid}/language", async (Guid id, SetOrganizationLanguageRequest request, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
            (await service.SetLanguageAsync(id, request, user.RequiredId, ct)).ToHttp());

        orgs.MapGet("/{id:guid}/members", async (Guid id, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.MembersAsync(id, user.RequiredId, ct)));

        orgs.MapPatch("/{id:guid}/members/{userId:guid}", async (Guid id, Guid userId, ChangeOrganizationRoleRequest request, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ChangeRoleAsync(id, userId, request, user.RequiredId, ct)).ToHttp());

        orgs.MapDelete("/{id:guid}/members/{userId:guid}", async (Guid id, Guid userId, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RemoveMemberAsync(id, userId, user.RequiredId, ct)).ToHttp());

        // Güvenlik (6.4): iki adımlı doğrulama zorunluluğu ve üyeler için yönetici işlemleri.
        orgs.MapPut("/{id:guid}/security", async (Guid id, OrganizationSecurityRequest request, ISecurityService security, ICurrentUser user, CancellationToken ct) =>
            (await security.SetOrganizationSecurityAsync(id, request, user.RequiredId, ct)).ToHttp());
        orgs.MapPost("/{id:guid}/members/{userId:guid}/revoke-sessions", async (Guid id, Guid userId, ISecurityService security, ICurrentUser user, CancellationToken ct) =>
            (await security.RevokeMemberSessionsAsync(id, userId, user.RequiredId, ct)).ToHttp());
        orgs.MapPost("/{id:guid}/members/{userId:guid}/password-reset", async (Guid id, Guid userId, ISecurityService security, ICurrentUser user, CancellationToken ct) =>
                (await security.SendMemberPasswordResetAsync(id, userId, user.RequiredId, ct)).ToHttp())
            .RequireRateLimiting(RateLimitPolicies.Auth);

        orgs.MapPost("/{id:guid}/invitations", async (Guid id, InviteRequest request, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
                Created(await service.InviteAsync(id, request, user.RequiredId, ct)))
            .RequireRateLimiting(RateLimitPolicies.Runs);

        orgs.MapGet("/{id:guid}/teams", async (Guid id, ITeamService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.ListAsync(id, user.RequiredId, ct)));

        orgs.MapPost("/{id:guid}/teams", async (Guid id, CreateTeamRequest request, ITeamService service, ICurrentUser user, CancellationToken ct) =>
            Created(await service.CreateAsync(id, request, user.RequiredId, ct)));

        orgs.MapPost("/{id:guid}/workspaces", async (Guid id, CreateWorkspaceRequest request, IWorkspaceService service, ICurrentUser user, CancellationToken ct) =>
            Created(await service.CreateAsync(id, request, user.RequiredId, ct)));

        var teams = routes.MapGroup("/teams").WithTags("Teams").RequireAuthorization();

        teams.MapPatch("/{id:guid}", async (Guid id, RenameRequest request, ITeamService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RenameAsync(id, request, user.RequiredId, ct)).ToHttp());

        teams.MapDelete("/{id:guid}", async (Guid id, ITeamService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteAsync(id, user.RequiredId, ct)).ToHttp());

        teams.MapPost("/{id:guid}/members", async (Guid id, AddTeamMemberRequest request, ITeamService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.AddMemberAsync(id, request, user.RequiredId, ct)));

        teams.MapDelete("/{id:guid}/members/{userId:guid}", async (Guid id, Guid userId, ITeamService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.RemoveMemberAsync(id, userId, user.RequiredId, ct)));

        var invitations = routes.MapGroup("/invitations").WithTags("Invitations");

        // Bağlantıyı açan herkes daveti görebilir (kayıt/giriş ekranında göstermek için).
        invitations.MapGet("/preview", async (string token, IOrganizationService service, CancellationToken ct) =>
                Ok(await service.PreviewInvitationAsync(token, ct)))
            .RequireRateLimiting(RateLimitPolicies.Auth);

        invitations.MapPost("/accept", async (AcceptInvitationRequest request, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
                Ok(await service.AcceptByTokenAsync(request.Token, user.RequiredId, ct)))
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Auth);

        invitations.MapPost("/{id:guid}/accept", async (Guid id, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
                Ok(await service.AcceptByIdAsync(id, user.RequiredId, ct)))
            .RequireAuthorization();

        invitations.MapPost("/{id:guid}/resend", async (Guid id, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
                Ok(await service.ResendInvitationAsync(id, user.RequiredId, ct)))
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Runs);

        invitations.MapDelete("/{id:guid}", async (Guid id, IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
                (await service.RevokeInvitationAsync(id, user.RequiredId, ct)).ToHttp())
            .RequireAuthorization();

        routes.MapGet("/me/invitations", async (IOrganizationService service, ICurrentUser user, CancellationToken ct) =>
                Results.Ok(await service.MyInvitationsAsync(user.RequiredId, ct)))
            .WithTags("Invitations")
            .RequireAuthorization();
    }

    private static IResult Ok<T>(Result<T> result) => result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();

    private static IResult Created<T>(Result<T> result) => result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
}
