using Apivator.Application.Activity;
using Apivator.Application.ApiKeys;
using Apivator.Application.Collections;
using Apivator.Application.Comments;
using Apivator.Application.Environments;
using Apivator.Application.Examples;
using Apivator.Application.Execution;
using Apivator.Application.Forks;
using Apivator.Application.History;
using Apivator.Application.Import;
using Apivator.Application.Mocks;
using Apivator.Application.Monitors;
using Apivator.Application.Onboarding;
using Apivator.Application.Runs;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<IWorkspaceService, WorkspaceService>();
        services.AddScoped<IPersonalSpaceProvisioner, PersonalSpaceProvisioner>();
        services.AddScoped<IWorkspaceAccess, WorkspaceAccess>();
        services.AddScoped<IOrganizationAccess, OrganizationAccess>();
        services.AddScoped<IOrganizationService, OrganizationService>();
        services.AddScoped<ITeamService, TeamService>();
        services.AddScoped<ICollectionService, CollectionService>();
        services.AddScoped<ICollectionAccessService, CollectionAccessService>();
        services.AddScoped<IEnvironmentService, EnvironmentService>();
        services.AddScoped<IHistoryService, HistoryService>();
        services.AddScoped<IImportService, ImportService>();
        services.AddScoped<CollectionSourceService>();
        services.AddScoped<ICollectionSourceService>(sp => sp.GetRequiredService<CollectionSourceService>());
        services.AddScoped<ISourceChecker>(sp => sp.GetRequiredService<CollectionSourceService>());
        services.AddScoped<IExampleService, ExampleService>();
        services.AddScoped<ICollectionTreeService, CollectionTreeService>();
        services.AddScoped<CollectionRunner>();
        services.AddScoped<ICollectionRunner>(sp => sp.GetRequiredService<CollectionRunner>());
        services.AddScoped<IMonitorService, MonitorService>();
        services.AddScoped<IMonitorExecutor, MonitorExecutor>();
        services.AddScoped<ForkEngine>();
        services.AddScoped<ForkService>();
        services.AddScoped<IForkService>(sp => sp.GetRequiredService<ForkService>());
        services.AddScoped<IMergeRequestService, MergeRequestService>();
        services.AddScoped<GitSync.GitSyncService>();
        services.AddScoped<GitSync.IGitSyncService>(sp => sp.GetRequiredService<GitSync.GitSyncService>());
        services.AddScoped<GitSync.IGitChecker>(sp => sp.GetRequiredService<GitSync.GitSyncService>());
        services.AddScoped<IRunService, RunService>();
        services.AddScoped<IActivityService, ActivityService>();
        services.AddScoped<ICommentService, CommentService>();
        services.AddScoped<IApiKeyService, ApiKeyService>();
        services.AddScoped<IMockService, MockService>();
        services.AddScoped<Docs.IDocumentationService, Docs.DocumentationService>();
        services.AddScoped<IMockRuntime, MockRuntime>();
        services.AddScoped<MockSource>();
        services.AddScoped<RunSourceLoader>();
        return services.AddExecutionServices();
    }

    /// <summary>Veritabanı gerektirmeyen yürütme servisleri; masaüstü ajanı yalnızca bunları kullanır.</summary>
    public static IServiceCollection AddExecutionServices(this IServiceCollection services)
    {
        services.AddMemoryCache();
        services.AddScoped<IOAuth2TokenService, OAuth2TokenService>();
        services.AddScoped<RunEngine>();
        return services;
    }
}
