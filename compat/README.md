# Postman script uyumluluk seti

Bu klasör, Postman script'lerinin Apivator'da aynı sonucu verdiğini sürekli kontrol eder. Testler backend test
projesinde çalışır (`CompatibilityTests`); her vaka gerçek API'den, gerçek script ortamıyla (Jint sandbox) geçer.

```bash
cd src/backend
APIVATOR_TEST_POSTGRES="Host=localhost;Database=apivator_test;Username=apivator;Password=apivator" \
  dotnet test tests/Apivator.Api.IntegrationTests --filter "FullyQualifiedName~CompatibilityTests"
```

İki tür içerik var:

| Klasör | Ne yapar | Ne zaman başarısız olur |
| --- | --- | --- |
| `cases/*.json` | Script'i belirlenen sahte yanıtla çalıştırır, test sonuçlarını, değişkenleri ve konsolu karşılaştırır | Sonuç beklenenden farklıysa |
| `collections/*.json` | Postman'den dışa aktarılmış collection'ın **her** script'ini çalıştırır | Söz dizimi hatası ya da desteklenmeyen bir API (tanımsız global, desteklenmeyen modül) varsa |

## Ekibin collection'larını taramak

1. Postman'de collection → **Export** → **Collection v2.1**.
2. Dosyayı `compat/collections/` klasörüne koyun (adı önemli değil, uzantısı `.json`).
3. Testleri çalıştırın. Her collection ayrı bir test olur; uyumsuzluklar istek yoluyla listelenir:

   ```
   Sipariş API.postman_collection.json: 1 uyumsuzluk:
   Sipariş API / Raporlar / PDF: Post-response: satır 3: ReferenceError: cheerio is not defined
   ```

Gerçek yanıt olmadığı için script'ler boş bir JSON (`{}`) yanıtıyla çalışır; bu yüzden doğrulamaların kalması
(ör. "beklenen 3, gelen undefined") uyumsuzluk sayılmaz. Gizli bilgi içeren collection'ları depoya eklemeden önce
değerleri temizleyin; tarama yalnızca script'lere bakar.

## Vaka eklemek

`cases/` altındaki dosyalar vaka dizisidir. Yeni bir kalıp gördüğünüzde (özellikle ekipten gelen bir script)
uygun dosyaya ekleyin ya da yeni bir dosya açın:

```json
{
  "name": "Token'ı environment'a yazma",
  "source": "Nereden geldiği (ör. Ödeme ekibi, Giriş isteği)",
  "request": { "url": "/respond", "method": "POST", "headers": { "X-Deneme": "1" }, "body": "{}" },
  "variables": { "environment": { "secret": "x" }, "collection": {}, "globals": {}, "data": {} },
  "response": { "status": 200, "headers": { "Content-Type": "application/json" }, "body": { "access_token": "abc" } },
  "prerequest": ["satır 1", "satır 2"],
  "test": ["pm.environment.set('token', pm.response.json().access_token);", "pm.test('ok', () => {});"],
  "expect": {
    "tests": { "ok": "passed" },
    "environment": { "token": "abc", "silinen": "<yok>", "zaman": "~/^\\d+$/" },
    "console": ["konsolda geçmesi gereken metin"],
    "nextRequest": "Sıradaki istek",
    "error": "beklenen hata metninin bir parçası"
  }
}
```

- Script'ler tek metin ya da satır dizisi olabilir.
- `request.url` `/respond` ise (varsayılan) hedef sunucu `response`'taki durum, header ve gövdeyi döner; `/echo` ise
  gelen isteği JSON olarak geri yansıtır (ön istek script'inin eklediği header'ları kontrol etmek için).
- `expect.tests` verilmezse en az bir test çalışmalı ve hepsi geçmelidir. Değişken beklentisinde `<yok>` silinmiş,
  `~/…/` düzenli ifadeyle eşleşen değer demektir. `error` verilmezse script hatası olmamalıdır.

## Desteklenenler (özet)

`pm.*` (test, expect, response, request, environment, collectionVariables, globals, variables, iterationData,
info, execution, sendRequest, cookies), eski API (`tests[]`, `responseBody`, `responseCode`, `responseHeaders`,
`responseTime`, `postman.*`, `environment`, `globals`, `data`, `iteration`, `request`), `xml2Json`, `atob`/`btoa`,
`setTimeout`, kütüphaneler: chai, lodash (`_`), crypto-js (`CryptoJS`), moment, tv4 (ve
`pm.response.to.have.jsonSchema`, JSON Schema draft-04), uuid (`v4`). Dinamik değişkenler: `$guid`, `$timestamp`,
`$isoTimestamp`, `$randomInt`, `$randomUUID`, `$randomEmail`, `$randomFirstName`, `$randomLastName`,
`$randomFullName`, `$randomUserName`, `$randomPhoneNumber`, `$randomBoolean`, `$randomAlphaNumeric`, `$randomWord`,
`$randomWords`, `$randomCity`, `$randomColor`, `$randomUrl`, `$randomIP`, `$randomPrice`, `$randomDateFuture`,
`$randomDatePast`.

Desteklenmeyenler: `cheerio`, `ajv`, `xml2js` modülü (yerine `xml2Json`), `csv-parse`, `postman-collection`,
`pm.vault`, `pm.visualizer`, `setInterval`. Script'te bunlar kullanılırsa anlaşılır bir hata verilir ve tarama
uyumsuzluk olarak raporlar.
