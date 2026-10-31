using System.Diagnostics;

namespace Apivator.Agent;

/// <summary>Masaüstü uygulaması kapanır ya da çökerse ajanı da kapatır.</summary>
internal sealed class ParentWatcher(AgentOptions options, IHostApplicationLifetime lifetime) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (options.ParentProcessId is not { } pid)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            if (!IsAlive(pid))
            {
                lifetime.StopApplication();
                return;
            }
        }
    }

    private static bool IsAlive(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }
}
