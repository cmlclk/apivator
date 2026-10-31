using Apivator.Application.Common.Localization;
using Jint.Native;
using Jint.Native.Object;

namespace Apivator.Infrastructure.Scripting;

/// <summary>
/// sandbox'ın (Sandbox/*.js) kendi yazdığı iletiler (Faz 8.3): script <c>__msg('kimlik', { ad: değer })</c> ister, burada
/// etkin dildeki metne çevrilir. <c>pm.expect</c> (chai) iletileri bunun dışındadır ve İngilizce kalır; böylece
/// Postman uyumluluğu bozulmaz. Kimlik düz sabit olmalı ki <c>LocalizationTests</c> metinleri denetleyebilsin.
/// Bilinmeyen kimlikte kimliğin kendisi döner. Olumsuz ileti (<c>pm.response.to.not...</c>) kimliğe <c>.not</c> ekler.
/// </summary>
internal static class ScriptMessages
{
    public static string Get(string id, JsValue? args)
    {
        string P(string name) => args is ObjectInstance obj ? obj.Get(name).ToString() : string.Empty;
        return id switch
        {
            "env_missing" => L.T("script.env_missing", "Aktif bir environment yok; pm.environment kullanılamaz."),
            "request_readonly" => L.T("script.request_readonly", "İstek yalnızca pre-request script'inde değiştirilebilir."),
            "skip_prerequest" => L.T("script.skip_prerequest", "skipRequest yalnızca pre-request script'inde kullanılabilir."),
            "expect_unavailable" => L.T("script.expect_unavailable", "pm.expect kullanılamıyor (chai yüklenemedi)."),
            "schema_unavailable" => L.T("script.schema_unavailable", "jsonSchema kullanılamıyor (tv4 yüklenemedi)."),
            "module_unsupported" => L.T("script.module_unsupported", "\"{name}\" modülü desteklenmiyor. Desteklenenler: chai, lodash, crypto-js, moment, tv4, uuid, atob, btoa.", ("name", P("name"))),
            "async_incomplete" => L.T("script.async_incomplete", "Asenkron test tamamlanmadı."),
            "btoa_latin1" => L.T("script.btoa_latin1", "btoa: Latin-1 dışı karakter."),
            "json_invalid" => L.T("script.json_invalid", "Yanıt geçerli bir JSON değil: {detail}", ("detail", P("detail"))),
            "xml_comment" => L.T("script.xml_comment", "kapanmayan yorum"),
            "xml_pi" => L.T("script.xml_pi", "kapanmayan işlem talimatı"),
            "xml_element" => L.T("script.xml_element", "öğe bekleniyordu"),
            "xml_name" => L.T("script.xml_name", "öğe adı bekleniyordu"),
            "xml_attr" => L.T("script.xml_attr", "geçersiz öznitelik"),
            "xml_unclosed" => L.T("script.xml_unclosed", "\"{name}\" kapanmadı", ("name", P("name"))),
            "xml_pos" => L.T("script.xml_pos", "konum {pos}", ("pos", P("pos"))),
            "status_in" => L.T("script.status_in", "yanıtın {label} olması bekleniyordu, durum kodu {status}", ("label", Label(P("label"))), ("status", P("status"))),
            "status_in.not" => L.T("script.status_in_not", "yanıtın {label} olmaması bekleniyordu, durum kodu {status}", ("label", Label(P("label"))), ("status", P("status"))),
            "status_code" => L.T("script.status_code", "durum kodunun {expected} olması bekleniyordu, gelen {actual}", ("expected", P("expected")), ("actual", P("actual"))),
            "status_code.not" => L.T("script.status_code_not", "durum kodunun {expected} olmaması bekleniyordu", ("expected", P("expected"))),
            "status_text" => L.T("script.status_text", "durumun \"{expected}\" olması bekleniyordu, gelen \"{actual}\"", ("expected", P("expected")), ("actual", P("actual"))),
            "status_text.not" => L.T("script.status_text_not", "durumun \"{expected}\" olmaması bekleniyordu", ("expected", P("expected"))),
            "header_has" => L.T("script.header_has", "\"{key}\" header'ı bekleniyordu", ("key", P("key"))),
            "header_has.not" => L.T("script.header_has_not", "\"{key}\" header'ı beklenmiyordu", ("key", P("key"))),
            "header_value" => L.T("script.header_value", "\"{key}\" header'ının \"{value}\" olması bekleniyordu, gelen \"{actual}\"", ("key", P("key")), ("value", P("value")), ("actual", P("actual"))),
            "header_value.not" => L.T("script.header_value_not", "\"{key}\" header'ının \"{value}\" olmaması bekleniyordu", ("key", P("key")), ("value", P("value"))),
            "body_present" => L.T("script.body_present", "yanıtın gövdesi olması bekleniyordu"),
            "body_present.not" => L.T("script.body_present_not", "yanıtın gövdesi olmaması bekleniyordu"),
            "body_regex" => L.T("script.body_regex", "gövdenin {expected} ile eşleşmesi bekleniyordu", ("expected", P("expected"))),
            "body_regex.not" => L.T("script.body_regex_not", "gövdenin {expected} ile eşleşmemesi bekleniyordu", ("expected", P("expected"))),
            "body_equal" => L.T("script.body_equal", "gövdenin \"{expected}\" olması bekleniyordu", ("expected", P("expected"))),
            "body_equal.not" => L.T("script.body_equal_not", "gövdenin \"{expected}\" olmaması bekleniyordu", ("expected", P("expected"))),
            "body_json" => L.T("script.body_json", "gövdenin JSON olması bekleniyordu"),
            "schema_invalid" => L.T("script.schema_invalid", "yanıt şemaya uymuyor: {detail}", ("detail", P("detail"))),
            "schema_invalid.not" => L.T("script.schema_invalid_not", "yanıtın şemaya uymaması bekleniyordu"),
            "json_path" => L.T("script.json_path", "JSON gövdesinde \"{path}\" bekleniyordu", ("path", P("path"))),
            "json_value" => L.T("script.json_value", "\"{path}\" değerinin {value} olması bekleniyordu, gelen {actual}", ("path", P("path")), ("value", P("value")), ("actual", P("actual"))),
            "json_value.not" => L.T("script.json_value_not", "\"{path}\" değerinin {value} olmaması bekleniyordu", ("path", P("path")), ("value", P("value"))),
            "type_html" => L.T("script.type_html", "HTML yanıt bekleniyordu, Content-Type \"{type}\"", ("type", P("type"))),
            "type_html.not" => L.T("script.type_html_not", "HTML olmayan yanıt bekleniyordu"),
            "type_xml" => L.T("script.type_xml", "XML yanıt bekleniyordu, Content-Type \"{type}\"", ("type", P("type"))),
            "type_xml.not" => L.T("script.type_xml_not", "XML olmayan yanıt bekleniyordu"),
            "type_json" => L.T("script.type_json", "JSON yanıt bekleniyordu, Content-Type \"{type}\"", ("type", P("type"))),
            "type_json.not" => L.T("script.type_json_not", "JSON olmayan yanıt bekleniyordu"),
            _ => id,
        };
    }

    /// <summary>Durum sınıfı adı (pm.response.to.be.success vb.); sayısal etiketler olduğu gibi kalır.</summary>
    private static string Label(string key) => key switch
    {
        "success" => L.T("script.class_success", "başarılı (2xx)"),
        "redirection" => L.T("script.class_redirection", "yönlendirme (3xx)"),
        "client_error" => L.T("script.class_client_error", "istemci hatası (4xx)"),
        "server_error" => L.T("script.class_server_error", "sunucu hatası (5xx)"),
        "error" => L.T("script.class_error", "hata (4xx/5xx)"),
        _ => key,
    };
}
