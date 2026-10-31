mod agent;
mod files;
mod secrets;
mod updates;

use tauri::RunEvent;

/// Arayüze dönen hata: metin yerine kod ve parametreler (JSON). Arayüz bunu etkin dilde gösterir
/// (`lib/desktop.ts`); böylece arayüz dili sonradan değişse de hata doğru dilde görünür.
pub(crate) fn coded_error(code: &str, params: &[(&str, &str)]) -> String {
    let params: serde_json::Map<String, serde_json::Value> = params
        .iter()
        .map(|(k, v)| (k.to_string(), serde_json::Value::from(*v)))
        .collect();
    serde_json::json!({ "code": code, "params": params }).to_string()
}

/// OAuth girişi gibi işlemler için bağlantıyı sistem tarayıcısında açar (yalnızca http/https).
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| coded_error("invalidUrl", &[]))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(coded_error("urlScheme", &[]));
    }
    tauri_plugin_opener::open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(feature = "updater")]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    let app = builder
        .manage(agent::AgentState::default())
        .setup(|app| {
            // Ajan başlatılamasa da pencere açılır; arayüz agent_info'dan gelen hatayı gösterir.
            if let Err(error) = agent::start(app.handle()) {
                eprintln!("{error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            agent::agent_info,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            updates::updates_enabled,
            updates::enabled::update_check,
            updates::enabled::update_install,
            files::save_file,
            open_external
        ])
        .build(tauri::generate_context!())
        .expect("Apivator başlatılamadı");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            agent::stop(handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::coded_error;

    #[test]
    fn coded_errors_are_json_with_params() {
        let value: serde_json::Value = serde_json::from_str(&coded_error(
            "agentExited",
            &[("code", "1"), ("detail", "\"x\"")],
        ))
        .unwrap();
        assert_eq!(value["code"], "agentExited");
        assert_eq!(value["params"]["code"], "1");
        assert_eq!(value["params"]["detail"], "\"x\"");
        assert_eq!(
            coded_error("noUpdate", &[]),
            r#"{"code":"noUpdate","params":{}}"#
        );
    }
}
