//! Otomatik güncelleme. Yalnızca `updater` özelliğiyle derlenince etkin; değilse komutlar "kapalı" döner.

use serde::Serialize;

#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn updates_enabled() -> bool {
    cfg!(feature = "updater")
}

#[cfg(feature = "updater")]
pub mod enabled {
    use super::UpdateInfo;
    use tauri::AppHandle;
    use tauri_plugin_updater::UpdaterExt;

    #[tauri::command]
    pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
        let update = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?;
        Ok(update.map(|u| UpdateInfo {
            version: u.version,
            notes: u.body,
        }))
    }

    /// Güncellemeyi indirip kurar ve uygulamayı yeniden başlatır.
    #[tauri::command]
    pub async fn update_install(app: AppHandle) -> Result<(), String> {
        let Some(update) = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?
        else {
            return Err(crate::coded_error("noUpdate", &[]));
        };
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        crate::agent::stop(&app);
        app.restart();
    }
}

#[cfg(not(feature = "updater"))]
pub mod enabled {
    use super::UpdateInfo;

    #[tauri::command]
    pub async fn update_check() -> Result<Option<UpdateInfo>, String> {
        Ok(None)
    }

    #[tauri::command]
    pub async fn update_install() -> Result<(), String> {
        Err(crate::coded_error("updatesDisabled", &[]))
    }
}
