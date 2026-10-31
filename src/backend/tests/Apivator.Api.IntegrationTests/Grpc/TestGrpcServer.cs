using Apivator.Api.IntegrationTests.Grpc.Magaza;
using Grpc.Core;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Apivator.Api.IntegrationTests.Grpc;

/// <summary>Gerçek bir gRPC sunucusu (TLS'siz HTTP/2, 127.0.0.1, rastgele port); reflection açık ya da kapalı.</summary>
public class TestGrpcServer : IAsyncLifetime
{
    private WebApplication? _app;

    protected virtual bool Reflection => true;

    public string Address { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(k => k.Listen(System.Net.IPAddress.Loopback, 0, o => o.Protocols = HttpProtocols.Http2));
        builder.Services.AddGrpc();
        if (Reflection)
        {
            builder.Services.AddGrpcReflection();
        }

        _app = builder.Build();
        _app.MapGrpcService<KatalogService>();
        if (Reflection)
        {
            _app.MapGrpcReflectionService();
        }

        await _app.StartAsync();
        var address = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        Address = new Uri(address).Authority;
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            await _app.DisposeAsync();
        }
    }

    private sealed class KatalogService : Katalog.KatalogBase
    {
        public override async Task<Urun> UrunGetir(UrunIstegi request, ServerCallContext context)
        {
            if (request.Id == "yok")
            {
                throw new RpcException(new Status(StatusCode.NotFound, "Ürün bulunamadı: yok"), new Metadata { { "x-iz", "abc-123" } });
            }

            await context.WriteResponseHeadersAsync(new Metadata { { "x-sunucu", "katalog" } });
            context.ResponseTrailers.Add("x-iz", "def-456");
            var urun = new Urun
            {
                Id = request.Id,
                Ad = context.RequestHeaders.GetValue("x-kullanici") ?? "isimsiz",
                Fiyat = 12.5,
                Stok = 9_007_199_254_740_993,
                Durum = Durum.Stokta,
                Etiketler = { "yeni", "indirimli" },
                Depolar = { ["ankara"] = 3, ["izmir"] = 0 },
                Eklenme = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(new DateTime(2026, 1, 31, 10, 0, 0, 250, DateTimeKind.Utc)),
                Not = "kırılgan",
                Ozellikler = Google.Protobuf.WellKnownTypes.Struct.Parser.ParseJson("{\"renk\":\"mavi\",\"agirlik\":1.5,\"etiket\":[true,null]}"),
                Indirim = -15,
                Resim = Google.Protobuf.ByteString.CopyFrom(1, 2, 3),
                Fabrika = 7,
                Puanlar = { 5, 4, 300 },
                Boyut = new Urun.Types.Boyut { En = 1.5f, Boy = 2 },
            };
            return urun;
        }

        public override async Task UrunleriListele(ListeIstegi request, IServerStreamWriter<Urun> responseStream, ServerCallContext context)
        {
            for (var i = 1; i <= request.Adet; i++)
            {
                await Task.Delay(request.BeklemeMs, context.CancellationToken);
                await responseStream.WriteAsync(new Urun { Id = i.ToString(System.Globalization.CultureInfo.InvariantCulture), Ad = $"Ürün {i}" });
            }
        }

        public override async Task<Ozet> TopluEkle(IAsyncStreamReader<Urun> requestStream, ServerCallContext context)
        {
            var ozet = new Ozet();
            await foreach (var urun in requestStream.ReadAllAsync(context.CancellationToken))
            {
                ozet.Adet++;
                ozet.Toplam += urun.Fiyat;
            }

            return ozet;
        }

        public override async Task Sohbet(IAsyncStreamReader<Mesaj> requestStream, IServerStreamWriter<Mesaj> responseStream, ServerCallContext context)
        {
            await foreach (var mesaj in requestStream.ReadAllAsync(context.CancellationToken))
            {
                await responseStream.WriteAsync(new Mesaj { Metin = "yankı: " + mesaj.Metin });
            }
        }
    }
}

/// <summary>Reflection servisi olmayan sunucu (.proto yükleme yolu ve "reflection yok" hatası için).</summary>
public sealed class TestGrpcServerWithoutReflection : TestGrpcServer
{
    protected override bool Reflection => false;
}
