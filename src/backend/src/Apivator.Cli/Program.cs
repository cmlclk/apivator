namespace Apivator.Cli;

/// <summary>Giriş noktası (API projesinin Program sınıfıyla çakışmasın diye ayrı ad).</summary>
internal static class CliProgram
{
    public static async Task<int> Main(string[] args)
    {
        using var cancel = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            // İlk Ctrl+C çalıştırmayı durdurur; ikincisi süreci sonlandırır.
            e.Cancel = !cancel.IsCancellationRequested;
            cancel.Cancel();
        };

        Console.OutputEncoding = System.Text.Encoding.UTF8;
        return await CliApp.RunAsync(args, CliConsole.System(), cancel.Token);
    }
}
