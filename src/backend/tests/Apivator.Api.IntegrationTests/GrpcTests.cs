using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text.Json;
using System.Text.Json.Nodes;
using Apivator.Api.IntegrationTests.Grpc;
using Apivator.Api.IntegrationTests.Grpc.Magaza;
using Apivator.Application.Execution;
using Apivator.Infrastructure.Grpc;
using Google.Protobuf;

namespace Apivator.Api.IntegrationTests;

/// <summary>gRPC: JSON↔protobuf kodlayıcı, .proto/reflection ile tanım çıkarma ve WebSocket köprüsü üzerinden çağrılar.</summary>
[Collection(ApiCollection.Name)]
public class GrpcTests(ApivatorApiFactory factory, TestGrpcServer server)
    : IClassFixture<TestGrpcServer>, IClassFixture<TestGrpcServerWithoutReflection>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static string ProtoText => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Grpc", "katalog.proto"));

    private static ProtoSchema Schema()
    {
        var (schema, errors) = ProtoSchema.FromProtoFiles([("katalog.proto", ProtoText)]);
        Assert.Empty(errors);
        return schema!;
    }

    // ------------------------------------------------------------------ kodlayıcı

    [Fact]
    public void Codec_EncodesJson_ThatTheOfficialLibraryReads()
    {
        var codec = new ProtoJson(Schema());
        using var json = JsonDocument.Parse("""
            {
              "id": "u1", "ad": "Kalem", "fiyat": 12.5, "stok": "9007199254740993", "durum": "STOKTA",
              "etiketler": ["a", "b"], "depolar": { "ankara": 3 },
              "eklenme": "2026-01-31T10:00:00.250Z", "not": "kırılgan",
              "ozellikler": { "renk": "mavi", "liste": [1, null, true] },
              "indirim": -15, "resim": "AQID", "tedarikci": "Acme", "puanlar": [5, 300],
              "boyut": { "en": 1.5, "boy": 2 }
            }
            """);

        var urun = Urun.Parser.ParseFrom(codec.Encode(".magaza.v1.Urun", json.RootElement));

        Assert.Equal(("u1", "Kalem", 12.5, 9_007_199_254_740_993L, Durum.Stokta), (urun.Id, urun.Ad, urun.Fiyat, urun.Stok, urun.Durum));
        Assert.Equal(["a", "b"], urun.Etiketler);
        Assert.Equal(3, urun.Depolar["ankara"]);
        Assert.Equal(new DateTime(2026, 1, 31, 10, 0, 0, 250, DateTimeKind.Utc), urun.Eklenme.ToDateTime());
        Assert.Equal("kırılgan", urun.Not);
        Assert.Equal("mavi", urun.Ozellikler.Fields["renk"].StringValue);
        Assert.Equal(3, urun.Ozellikler.Fields["liste"].ListValue.Values.Count);
        Assert.Equal((-15, "Acme"), (urun.Indirim, urun.Tedarikci));
        Assert.Equal([1, 2, 3], urun.Resim.ToByteArray());
        Assert.Equal([5, 300], urun.Puanlar);
        Assert.Equal((1.5f, 2f), (urun.Boyut.En, urun.Boyut.Boy));
    }

    [Fact]
    public void Codec_DecodesOfficialBytes_ToProto3Json_WithDefaults()
    {
        var codec = new ProtoJson(Schema());
        var bytes = new Urun
        {
            Id = "u2",
            Stok = -4,
            Durum = Durum.Tukendi,
            Eklenme = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(new DateTime(2026, 1, 31, 10, 0, 0, DateTimeKind.Utc)),
            Fabrika = 7,
            Puanlar = { 1, 2 },
            Depolar = { ["izmir"] = 0 },
        }.ToByteArray();

        var json = codec.Decode(".magaza.v1.Urun", bytes);

        Assert.Equal("u2", (string?)json["id"]);
        Assert.Equal("-4", (string?)json["stok"]); // 64 bit sayılar metin
        Assert.Equal("TUKENDI", (string?)json["durum"]);
        Assert.Equal("2026-01-31T10:00:00Z", (string?)json["eklenme"]);
        Assert.Equal(7, (int?)json["fabrika"]);
        Assert.Equal("[1,2]", json["puanlar"]!.ToJsonString());
        Assert.Equal(0, (int?)json["depolar"]!["izmir"]);
        // Varsayılanlar da yazılır; oneof'un gelmeyen üyesi ve boş mesaj alanları yazılmaz.
        Assert.Equal(string.Empty, (string?)json["ad"]);
        Assert.Equal(0, (double?)json["fiyat"]);
        Assert.Equal("[]", json["etiketler"]!.ToJsonString());
        Assert.False(json.ContainsKey("tedarikci"));
        Assert.False(json.ContainsKey("boyut"));
        // Tanımdaki sırayla: gelmeyen "ad" id'den hemen sonra.
        Assert.Equal(["id", "ad", "fiyat"], json.Select(p => p.Key).Take(3));
    }

    [Fact]
    public void Codec_ExplainsBadInput()
    {
        var codec = new ProtoJson(Schema());
        string Error(string text)
        {
            using var json = JsonDocument.Parse(text);
            return Assert.Throws<ProtoException>(() => codec.Encode(".magaza.v1.Urun", json.RootElement)).Message;
        }

        Assert.Contains("\"renkk\" alanı magaza.v1.Urun mesajında yok", Error("""{"renkk": 1}"""), StringComparison.Ordinal);
        Assert.Contains("STOKTA", Error("""{"durum": "VAR"}"""), StringComparison.Ordinal);
        Assert.Contains("\"bekleme_ms\"", new ProtoJson(Schema()).Sample(".magaza.v1.ListeIstegi")!.ToJsonString().Replace("beklemeMs", "\"bekleme_ms\"", StringComparison.Ordinal), StringComparison.Ordinal);
        Assert.StartsWith("boyut.en:", Error("""{"boyut": {"en": "x"}}"""), StringComparison.Ordinal);
        Assert.Contains("RFC 3339", Error("""{"eklenme": "dün"}"""), StringComparison.Ordinal);
    }

    [Fact]
    public void ProtoFiles_ReportSyntaxErrorsWithLine_AndSamplesAreGenerated()
    {
        var (schema, errors) = ProtoSchema.FromProtoFiles([("bozuk.proto", "syntax = \"proto3\";\nmessage A {\n  strin ad = 1;\n}\n")]);
        Assert.Null(schema);
        Assert.Contains(errors, e => e.StartsWith("bozuk.proto:3:", StringComparison.Ordinal));

        var sample = new ProtoJson(Schema()).Sample(".magaza.v1.Urun")!.AsObject();
        Assert.Equal("DURUM_BELIRSIZ", (string?)sample["durum"]);
        Assert.True(sample.ContainsKey("tedarikci"));
        Assert.False(sample.ContainsKey("fabrika")); // oneof'tan yalnızca ilk üye
        Assert.Equal("0", (string?)sample["stok"]);
        Assert.IsType<JsonObject>(sample["boyut"]);
    }

    [Fact]
    public void JsonSchema_DescribesTheJsonMapping_ForModelGeneration()
    {
        var schema = new ProtoJson(Schema()).JsonSchema(".magaza.v1.Urun");

        Assert.Equal("Urun", (string?)schema["title"]);
        Assert.Equal("#/$defs/Urun", (string?)schema["$ref"]);
        var defs = schema["$defs"]!.AsObject();
        Assert.Equal(["DURUM_BELIRSIZ", "STOKTA", "TUKENDI"], defs["Durum"]!["enum"]!.AsArray().Select(v => (string?)v));

        var urun = defs["Urun"]!["properties"]!.AsObject();
        Assert.Equal("#/$defs/Durum", (string?)urun["durum"]!["$ref"]);
        Assert.Equal(("string", "int64"), ((string?)urun["stok"]!["type"], (string?)urun["stok"]!["format"]));
        Assert.Equal("date-time", (string?)urun["eklenme"]!["format"]);
        Assert.Equal("[\"string\",\"null\"]", urun["not"]!["type"]!.ToJsonString());
        Assert.Equal("integer", (string?)urun["depolar"]!["additionalProperties"]!["type"]);
        Assert.Equal("array", (string?)urun["puanlar"]!["type"]);
        Assert.Equal("#/$defs/Boyut", (string?)urun["boyut"]!["$ref"]);
        Assert.True(defs.ContainsKey("Boyut"));

        // Skalerler zorunlu (varsayılan değer yazılır); mesaj ve oneof alanları opsiyonel.
        var required = defs["Urun"]!["required"]!.AsArray().Select(v => (string?)v).ToList();
        Assert.Contains("ad", required);
        Assert.Contains("etiketler", required);
        Assert.DoesNotContain("tedarikci", required);
        Assert.DoesNotContain("boyut", required);
        Assert.DoesNotContain("eklenme", required);
    }

    // ------------------------------------------------------------------ tanımlar

    private static async Task<GrpcSchemaDto> DescribeAsync(HttpClient client, GrpcDescribeRequest request)
    {
        var response = await client.PostAsJsonAsync("/api/grpc/describe", request);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<GrpcSchemaDto>(Json))!;
    }

    [Fact]
    public async Task Describe_ViaReflection_ListsServicesMethodsAndSamples()
    {
        var (client, _) = await factory.CreateUserAsync();

        var schema = await DescribeAsync(client, new GrpcDescribeRequest(server.Address, [], null, UseReflection: true));

        var service = Assert.Single(schema.Services);
        Assert.Equal("magaza.v1.Katalog", service.Name);
        Assert.Equal(["UrunGetir", "UrunleriListele", "TopluEkle", "Sohbet"], service.Methods.Select(m => m.Name));
        var sohbet = service.Methods[3];
        Assert.Equal(("/magaza.v1.Katalog/Sohbet", true, true), (sohbet.Path, sohbet.ClientStreaming, sohbet.ServerStreaming));
        Assert.Contains("\"metin\": \"\"", sohbet.Sample, StringComparison.Ordinal);
        Assert.Equal("Mesaj", (string?)sohbet.InputSchema!["title"]);
        Assert.NotNull(sohbet.OutputSchema);
        Assert.NotEmpty(schema.DescriptorSet);
        Assert.Empty(schema.Warnings);
    }

    [Fact]
    public async Task Describe_FromProtoFiles_AndExplainsMissingReflection()
    {
        var (client, _) = await factory.CreateUserAsync();
        var plain = new TestGrpcServerWithoutReflection();
        await plain.InitializeAsync();
        try
        {
            var schema = await DescribeAsync(client, new GrpcDescribeRequest(null, null, [new ProtoFileDto("katalog.proto", ProtoText)], false));
            Assert.Equal(4, schema.Services.Single().Methods.Count);

            var response = await client.PostAsJsonAsync("/api/grpc/describe", new GrpcDescribeRequest(plain.Address, [], null, true));
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Contains("reflection servisini sunmuyor", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);

            var broken = await client.PostAsJsonAsync("/api/grpc/describe", new GrpcDescribeRequest(null, null, [new ProtoFileDto("a.proto", "import \"yok.proto\";")], false));
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, broken.StatusCode);
        }
        finally
        {
            await plain.DisposeAsync();
        }
    }

    [Fact]
    public async Task Describe_IsProtectedByTheNetworkGuard()
    {
        var (client, _) = await factory.CreateUserAsync();
        var response = await client.PostAsJsonAsync("/api/grpc/describe", new GrpcDescribeRequest("169.254.169.254:80", [], null, true));
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("izin verilmiyor", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------ köprü

    private async Task<(WebSocket Socket, string DescriptorSet)> RelayAsync()
    {
        var (client, _) = await factory.CreateUserAsync();
        var schema = await DescribeAsync(client, new GrpcDescribeRequest(server.Address, [], null, true));
        var token = client.DefaultRequestHeaders.Authorization!.Parameter;
        var socket = await factory.Server.CreateWebSocketClient()
            .ConnectAsync(new Uri(factory.Server.BaseAddress, $"/hubs/grpc-proxy?access_token={token}"), CancellationToken.None);
        return (socket, schema.DescriptorSet);
    }

    private static Task SendAsync(WebSocket socket, object envelope) =>
        socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(envelope, Json), WebSocketMessageType.Text, true, CancellationToken.None);

    /// <summary>"status" gelene kadar tüm olaylar.</summary>
    private static async Task<List<JsonElement>> UntilStatusAsync(WebSocket socket)
    {
        var events = new List<JsonElement>();
        var buffer = new byte[256 * 1024];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (true)
        {
            using var stream = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, timeout.Token);
                stream.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (result.MessageType == WebSocketMessageType.Close)
            {
                return events;
            }

            var item = JsonDocument.Parse(stream.ToArray()).RootElement.Clone();
            events.Add(item);
            if (item.GetProperty("type").GetString() == "status")
            {
                return events;
            }
        }
    }

    private static IEnumerable<JsonNode> Messages(List<JsonElement> events) =>
        events.Where(e => e.GetProperty("type").GetString() == "message").Select(e => JsonNode.Parse(e.GetProperty("data").GetString()!)!);

    private static JsonElement Status(List<JsonElement> events) => events[^1];

    [Fact]
    public async Task Unary_SendsMetadata_AndReturnsMessageHeadersAndTrailers()
    {
        var (socket, descriptors) = await RelayAsync();
        await SendAsync(socket, new
        {
            type = "start",
            url = $"grpc://{server.Address}",
            method = "/magaza.v1.Katalog/UrunGetir",
            descriptorSet = descriptors,
            metadata = new[] { new HttpHeaderDto("x-kullanici", "Ayşe") },
            deadlineSeconds = 10,
        });
        await SendAsync(socket, new { type = "send", message = """{"id": "u1"}""" });

        var events = await UntilStatusAsync(socket);

        Assert.Equal(["sent", "headers", "message", "status"], events.Select(e => e.GetProperty("type").GetString()));
        Assert.Contains(events[1].GetProperty("metadata").EnumerateArray(), h => h.GetProperty("key").GetString() == "x-sunucu");
        var urun = Messages(events).Single();
        Assert.Equal(("u1", "Ayşe", "9007199254740993", "STOKTA"), ((string?)urun["id"], (string?)urun["ad"], (string?)urun["stok"], (string?)urun["durum"]));
        Assert.Equal("2026-01-31T10:00:00.250Z", (string?)urun["eklenme"]);
        Assert.Equal("mavi", (string?)urun["ozellikler"]!["renk"]);
        Assert.Equal((-15, "AQID", 7), ((int?)urun["indirim"], (string?)urun["resim"], (int?)urun["fabrika"]));
        Assert.Equal(("OK", 0), (Status(events).GetProperty("name").GetString(), Status(events).GetProperty("code").GetInt32()));
        Assert.Contains(Status(events).GetProperty("metadata").EnumerateArray(), h => h.GetProperty("value").GetString() == "def-456");
    }

    [Fact]
    public async Task Unary_ReportsServerErrorsAndBadMessages()
    {
        var (socket, descriptors) = await RelayAsync();
        await SendAsync(socket, new { type = "start", url = server.Address, method = "/magaza.v1.Katalog/UrunGetir", descriptorSet = descriptors });
        await SendAsync(socket, new { type = "send", message = """{"idd": 1}""" });
        await SendAsync(socket, new { type = "send", message = """{"id": "yok"}""" });

        var events = await UntilStatusAsync(socket);

        Assert.Equal("error", events[0].GetProperty("type").GetString());
        Assert.Contains("\"idd\"", events[0].GetProperty("message").GetString(), StringComparison.Ordinal);
        var status = Status(events);
        Assert.Equal(("NOT_FOUND", "Ürün bulunamadı: yok"), (status.GetProperty("name").GetString(), status.GetProperty("message").GetString()));
        // Trailers-only yanıt: ayrı "headers" olayı yok; HTTP'nin kendi header'ları trailer sayılmaz.
        Assert.DoesNotContain(events, e => e.GetProperty("type").GetString() == "headers");
        Assert.Equal(["x-iz"], status.GetProperty("metadata").EnumerateArray().Select(h => h.GetProperty("key").GetString()));
        Assert.Equal("abc-123", status.GetProperty("metadata")[0].GetProperty("value").GetString());
    }

    [Fact]
    public async Task ServerStreaming_DeliversMessagesAsTheyArrive_AndHonoursDeadline()
    {
        var (socket, descriptors) = await RelayAsync();
        await SendAsync(socket, new { type = "start", url = server.Address, method = "/magaza.v1.Katalog/UrunleriListele", descriptorSet = descriptors });
        await SendAsync(socket, new { type = "send", message = """{"adet": 3}""" });
        var events = await UntilStatusAsync(socket);
        Assert.Equal(["1", "2", "3"], Messages(events).Select(m => (string?)m["id"]));
        Assert.Equal("OK", Status(events).GetProperty("name").GetString());

        var (slow, slowDescriptors) = await RelayAsync();
        await SendAsync(slow, new { type = "start", url = server.Address, method = "/magaza.v1.Katalog/UrunleriListele", descriptorSet = slowDescriptors, deadlineSeconds = 0.5 });
        await SendAsync(slow, new { type = "send", message = """{"adet": 20, "beklemeMs": 200}""" });
        var timedOut = await UntilStatusAsync(slow);
        Assert.InRange(Messages(timedOut).Count(), 1, 4);
        Assert.Equal("DEADLINE_EXCEEDED", Status(timedOut).GetProperty("name").GetString());
    }

    [Fact]
    public async Task ClientAndBidiStreaming_Work()
    {
        var (socket, descriptors) = await RelayAsync();
        await SendAsync(socket, new { type = "start", url = server.Address, method = "/magaza.v1.Katalog/TopluEkle", descriptorSet = descriptors });
        await SendAsync(socket, new { type = "send", message = """{"fiyat": 10}""" });
        await SendAsync(socket, new { type = "send", message = """{"fiyat": 2.5}""" });
        await SendAsync(socket, new { type = "end" });
        var events = await UntilStatusAsync(socket);
        var ozet = Messages(events).Single();
        Assert.Equal((2, 12.5), ((int?)ozet["adet"], (double?)ozet["toplam"]));

        var (chat, chatDescriptors) = await RelayAsync();
        await SendAsync(chat, new { type = "start", url = server.Address, method = "/magaza.v1.Katalog/Sohbet", descriptorSet = chatDescriptors });
        await SendAsync(chat, new { type = "send", message = """{"metin": "merhaba"}""" });
        var buffer = new byte[64 * 1024];
        // İlk yanıt, istemci akışı açıkken gelir (gerçek çift yönlü akış).
        string? firstReply = null;
        while (firstReply is null)
        {
            var result = await chat.ReceiveAsync(buffer, new CancellationTokenSource(TimeSpan.FromSeconds(10)).Token);
            var item = JsonDocument.Parse(buffer.AsMemory(0, result.Count)).RootElement;
            if (item.GetProperty("type").GetString() == "message")
            {
                firstReply = (string?)JsonNode.Parse(item.GetProperty("data").GetString()!)!["metin"];
            }
        }

        Assert.Equal("yankı: merhaba", firstReply);
        await SendAsync(chat, new { type = "send", message = """{"metin": "görüşürüz"}""" });
        await SendAsync(chat, new { type = "end" });
        var rest = await UntilStatusAsync(chat);
        Assert.Equal(["yankı: görüşürüz"], Messages(rest).Select(m => (string?)m["metin"]));
        Assert.Equal("OK", Status(rest).GetProperty("name").GetString());
    }

    [Fact]
    public async Task Cancel_EndsTheCall()
    {
        var (socket, descriptors) = await RelayAsync();
        await SendAsync(socket, new { type = "start", url = server.Address, method = "/magaza.v1.Katalog/Sohbet", descriptorSet = descriptors });
        await SendAsync(socket, new { type = "cancel" });
        var events = await UntilStatusAsync(socket);
        Assert.Equal("CANCELLED", Status(events).GetProperty("name").GetString());
    }

    [Fact]
    public async Task Agent_DescribesAndCalls()
    {
        var options = new Agent.AgentOptions { Port = 0, Token = "ajan-anahtari", AllowedOrigins = [] };
        await using var app = Agent.AgentHost.Build(options);
        var port = await Agent.AgentHost.StartAsync(app);
        using var http = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{port}") };
        http.DefaultRequestHeaders.Add(Agent.AgentOptions.TokenHeader, options.Token);

        var describe = await http.PostAsJsonAsync("/grpc/describe", new GrpcDescribeRequest(server.Address, [], null, true));
        var schema = (await describe.Content.ReadFromJsonAsync<GrpcSchemaDto>(Json))!;

        using var socket = new ClientWebSocket();
        await socket.ConnectAsync(new Uri($"ws://127.0.0.1:{port}{Agent.AgentHost.GrpcPath}?token={options.Token}"), CancellationToken.None);
        await SendAsync(socket, new { type = "start", url = server.Address, method = "/magaza.v1.Katalog/UrunGetir", descriptorSet = schema.DescriptorSet });
        await SendAsync(socket, new { type = "send", message = """{"id": "a1"}""" });
        var events = await UntilStatusAsync(socket);
        Assert.Equal("a1", (string?)Messages(events).Single()["id"]);
    }
}
