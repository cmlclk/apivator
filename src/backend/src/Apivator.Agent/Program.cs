namespace Apivator.Agent;

public static class AgentProgram
{
    public static async Task<int> Main(string[] args)
    {
        AgentOptions options;
        try
        {
            options = AgentOptions.Parse(args, Environment.GetEnvironmentVariable);
        }
        catch (ArgumentException ex)
        {
            await Console.Error.WriteLineAsync(ex.Message);
            return 2;
        }

        await using var app = AgentHost.Build(options);
        var port = await AgentHost.StartAsync(app);

        // Masaüstü kabuğu bu satırı bekler; portu buradan öğrenir.
        Console.WriteLine($"{AgentOptions.ReadyPrefix}{{\"port\":{port}}}");
        await Console.Out.FlushAsync();

        await app.WaitForShutdownAsync();
        return 0;
    }
}
