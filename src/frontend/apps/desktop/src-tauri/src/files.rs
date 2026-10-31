use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Başlıktaki dosya adı (URL kodlu). Yol ayırıcıları ve geçersiz karakterler atılır; diyalog yalnızca öneri olarak gösterir.
pub fn suggested_name(header: Option<&str>) -> String {
    let decoded = header.and_then(urlencoding_decode).unwrap_or_default();
    let cleaned: String = decoded
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if trimmed.is_empty() {
        "dosya".into()
    } else {
        trimmed
    }
}

fn urlencoding_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// "Farklı kaydet" diyaloğunu açar ve gövdedeki baytları seçilen yola yazar. İptal edilirse false döner.
/// Dosya JSON'a çevrilmeden ham gövde olarak gelir (büyük Excel dosyaları için).
#[tauri::command]
pub async fn save_file(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err(crate::coded_error("fileBodyInvalid", &[]));
    };
    let name = suggested_name(
        request
            .headers()
            .get("x-file-name")
            .and_then(|v| v.to_str().ok()),
    );

    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some(extension) = PathBuf::from(&name).extension().and_then(|e| e.to_str()) {
        dialog = dialog.add_filter(extension.to_uppercase(), &[extension]);
    }
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, data)
        .map_err(|e| crate::coded_error("fileWriteFailed", &[("detail", &e.to_string())]))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggested_name_is_decoded_and_cleaned() {
        assert_eq!(
            suggested_name(Some("Sipari%C5%9Fler%202026.xlsx")),
            "Siparişler 2026.xlsx"
        );
        assert_eq!(
            suggested_name(Some("..%2F..%2Fetc%2Fpasswd")),
            ".._.._etc_passwd"
        );
        assert_eq!(suggested_name(Some("a%3Ab.csv.")), "a_b.csv");
        assert_eq!(suggested_name(None), "dosya");
        assert_eq!(suggested_name(Some("%ZZ")), "dosya");
    }
}
