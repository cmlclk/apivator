//! İşletim sisteminin anahtar zinciri (Windows Credential Manager, macOS Keychain, Linux Secret Service).
//! Arayüz yalnızca izin verilen anahtar adlarını kullanabilir.

const SERVICE: &str = "Apivator";

/// `refresh_token:<sunucu adresi>`, `network:proxy_password`, `local_key:variables` gibi; önek listesi dışındaki
/// anahtarlar reddedilir. `local_key:` yerel olarak şifrelenen verilerin (değişkenlerin güncel değerleri) anahtarıdır.
fn validate(key: &str) -> Result<(), String> {
    const PREFIXES: [&str; 3] = ["refresh_token:", "network:", "local_key:"];
    if key.len() > 512 || !PREFIXES.iter().any(|p| key.starts_with(p)) {
        return Err(crate::coded_error("secretKeyNotAllowed", &[("key", key)]));
    }
    Ok(())
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    validate(key)?;
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn only_known_keys_are_allowed() {
        assert!(validate("refresh_token:https://api.example.com").is_ok());
        assert!(validate("network:proxy_password").is_ok());
        assert!(validate("local_key:variables").is_ok());
        assert!(validate("ssh_key").is_err());
        assert!(validate(&format!("refresh_token:{}", "x".repeat(600))).is_err());
    }
}
