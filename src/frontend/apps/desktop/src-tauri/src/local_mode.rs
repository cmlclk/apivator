//! Çalışma modu: "local" (kişisel kullanım; API uygulamanın içinde, veriler bu bilgisayarda) ya da "server"
//! (bir Apivator sunucusuna bağlanılır). Yerel modda `apivator-api` sidecar'ı başlatılır; veri klasörü:
//! Windows `%APPDATA%\Apivator`, macOS `~/Library/Application Support/Apivator`, Linux `~/.local/share/Apivator`.
//! Uygulama sürümü değiştiyse API başlamadan (migration'lardan önce) veritabanı `backups/` altına kopyalanır.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;

use crate::sidecar::{session_token, Sidecar, SidecarInfo};

const READY_PREFIX: &str = "APIVATOR_API_READY ";
/// İlk açılışta veritabanı oluşturulur ve migration'lar uygulanır; ajandan uzun sürebilir.
const START_TIMEOUT: Duration = Duration::from_secs(90);
const DATABASE_FILE: &str = "apivator.db";
const SETTINGS_FILE: &str = "desktop.json";
const BACKUPS_DIR: &str = "backups";
const KEEP_BACKUPS: usize = 5;

#[derive(Default, Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// "local" | "server"; ilk açılışta seçilene kadar boş.
    #[serde(default)]
    pub mode: Option<String>,
    /// Veritabanını en son açan uygulama sürümü (sürüm değişince yedek alınır).
    #[serde(default)]
    pub data_version: Option<String>,
}

pub struct LocalModeState {
    api: Arc<Sidecar>,
    dir: PathBuf,
    settings: Mutex<Settings>,
}

impl LocalModeState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let dir = app
            .path()
            .data_dir()
            .map_err(|e| e.to_string())?
            .join("Apivator");
        let settings = read_settings(&dir.join(SETTINGS_FILE));
        Ok(Self {
            api: Sidecar::new(READY_PREFIX, "localApi"),
            dir,
            settings: Mutex::new(settings),
        })
    }

    fn save(&self, settings: &Settings) -> Result<(), String> {
        let write = || -> io::Result<()> {
            fs::create_dir_all(&self.dir)?;
            let json = serde_json::to_string_pretty(settings).map_err(io::Error::other)?;
            // Yarım yazılmış dosya kalmasın: önce geçici dosyaya, sonra yerine.
            let temp = self.dir.join(format!("{SETTINGS_FILE}.tmp"));
            fs::write(&temp, json)?;
            fs::rename(&temp, self.dir.join(SETTINGS_FILE))
        };
        write().map_err(|e| crate::coded_error("dataDirFailed", &[("detail", &e.to_string())]))
    }
}

fn read_settings(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Veritabanı varsa ve onu son açan sürüm bundan farklıysa `backups/apivator-<eski sürüm>-<zaman>.db` olarak
/// kopyalar (WAL dosyası da); en yeni `KEEP_BACKUPS` yedek kalır. Yedek alındıysa yolunu döner.
pub fn backup_if_upgraded(
    dir: &Path,
    last_version: Option<&str>,
    current_version: &str,
    now_secs: u64,
) -> io::Result<Option<PathBuf>> {
    let db = dir.join(DATABASE_FILE);
    if !db.exists() || last_version == Some(current_version) {
        return Ok(None);
    }

    let backups = dir.join(BACKUPS_DIR);
    fs::create_dir_all(&backups)?;
    let old = last_version
        .unwrap_or("unknown")
        .replace(['/', '\\', ':'], "_");
    let target = backups.join(format!("apivator-{old}-{now_secs}.db"));
    fs::copy(&db, &target)?;
    let wal = dir.join(format!("{DATABASE_FILE}-wal"));
    if wal.exists() {
        fs::copy(
            &wal,
            backups.join(format!("apivator-{old}-{now_secs}.db-wal")),
        )?;
    }
    prune_backups(&backups)?;
    Ok(Some(target))
}

fn prune_backups(backups: &Path) -> io::Result<()> {
    let mut databases: Vec<(SystemTime, PathBuf)> = fs::read_dir(backups)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "db"))
        .filter_map(|path| Some((fs::metadata(&path).ok()?.modified().ok()?, path)))
        .collect();
    databases.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    for (_, path) in databases.into_iter().skip(KEEP_BACKUPS) {
        let _ = fs::remove_file(path.with_extension("db-wal"));
        fs::remove_file(path)?;
    }
    Ok(())
}

/// SQLite bağlantı cümlesi; yol tırnak içinde (boşluk ve noktalı virgül içerebilir).
fn connection_string(db: &Path) -> String {
    format!(
        "Data Source=\"{}\"",
        db.display().to_string().replace('"', "\"\"")
    )
}

/// Yerel API'yi başlatır: veri klasörü oluşturulur, gerekiyorsa yedek alınır.
fn start_api(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<LocalModeState>();
    let data_error =
        |e: io::Error| crate::coded_error("dataDirFailed", &[("detail", &e.to_string())]);
    fs::create_dir_all(&state.dir).map_err(data_error)?;

    let version = app.package_info().version.to_string();
    let mut settings = state.settings.lock().unwrap().clone();
    if settings.data_version.as_deref() != Some(version.as_str()) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or_default();
        backup_if_upgraded(&state.dir, settings.data_version.as_deref(), &version, now)
            .map_err(|e| crate::coded_error("backupFailed", &[("detail", &e.to_string())]))?;
        settings.data_version = Some(version);
        state.save(&settings)?;
        *state.settings.lock().unwrap() = settings;
    }

    let token = session_token()?;
    let mut command = app
        .shell()
        .sidecar("apivator-api")
        .map_err(|e| e.to_string())?
        .current_dir(&state.dir)
        .env("ASPNETCORE_ENVIRONMENT", "Production")
        .env("LocalMode__Enabled", "true")
        .env("LocalMode__Token", &token)
        .env("LocalMode__ParentPid", std::process::id().to_string())
        .env("Database__Provider", "Sqlite")
        .env(
            "ConnectionStrings__Sqlite",
            connection_string(&state.dir.join(DATABASE_FILE)),
        );
    // Geliştirmede arayüz vite'tan gelir; CORS bu kökene açılır.
    if let Ok(origin) = std::env::var("APIVATOR_DEV_ORIGIN") {
        command = command.env("LocalMode__AllowedOrigins__0", origin);
    }
    state.api.start(command, token)
}

/// Uygulama açılışı: yerel mod seçiliyse API başlatılır. Hata arayüze `local_api_info` ile döner.
pub fn start_if_local(app: &AppHandle) {
    let state = app.state::<LocalModeState>();
    if state.settings.lock().unwrap().mode.as_deref() == Some("local") {
        if let Err(error) = start_api(app) {
            state.api.fail(error);
        }
    }
}

pub fn stop(app: &AppHandle) {
    app.state::<LocalModeState>().api.stop();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeInfo {
    mode: Option<String>,
    data_dir: String,
}

/// Seçili mod (ilk açılışta null) ve yerel verilerin klasörü.
#[tauri::command]
pub fn app_mode(state: State<'_, LocalModeState>) -> ModeInfo {
    ModeInfo {
        mode: state.settings.lock().unwrap().mode.clone(),
        data_dir: state.dir.display().to_string(),
    }
}

/// Modu kaydeder; yerel moda geçilince API başlar, sunucu moduna geçilince durur. Yerel veriler silinmez.
#[tauri::command]
pub fn set_app_mode(app: AppHandle, mode: String) -> Result<(), String> {
    if mode != "local" && mode != "server" {
        return Err(crate::coded_error("invalidMode", &[]));
    }
    let state = app.state::<LocalModeState>();
    let mut settings = state.settings.lock().unwrap().clone();
    settings.mode = Some(mode.clone());
    state.save(&settings)?;
    *state.settings.lock().unwrap() = settings;

    if mode == "local" {
        if !state.api.is_running() {
            start_api(&app)?;
        }
    } else {
        state.api.stop();
    }
    Ok(())
}

/// Yerel API'nin adresi ve oturum token'ı; API henüz hazır değilse bekler.
#[tauri::command]
pub async fn local_api_info(state: State<'_, LocalModeState>) -> Result<SidecarInfo, String> {
    if state.settings.lock().unwrap().mode.as_deref() != Some("local") {
        return Err(crate::coded_error("localModeOff", &[]));
    }
    state.api.wait_info(START_TIMEOUT).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "apivator-local-mode-{name}-{}",
            session_token().unwrap()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn backs_up_only_when_the_version_changes() {
        let dir = temp_dir("backup");
        // Veritabanı yoksa (ilk açılış) yedek yok.
        assert_eq!(backup_if_upgraded(&dir, None, "1.0.0", 1).unwrap(), None);

        fs::write(dir.join(DATABASE_FILE), b"db").unwrap();
        fs::write(dir.join("apivator.db-wal"), b"wal").unwrap();
        assert_eq!(
            backup_if_upgraded(&dir, Some("1.0.0"), "1.0.0", 2).unwrap(),
            None
        );

        let backup = backup_if_upgraded(&dir, Some("1.0.0"), "1.1.0", 3)
            .unwrap()
            .unwrap();
        assert_eq!(backup, dir.join("backups").join("apivator-1.0.0-3.db"));
        assert_eq!(fs::read(&backup).unwrap(), b"db");
        assert_eq!(
            fs::read(dir.join("backups").join("apivator-1.0.0-3.db-wal")).unwrap(),
            b"wal"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_only_the_newest_backups() {
        let dir = temp_dir("prune");
        fs::write(dir.join(DATABASE_FILE), b"db").unwrap();
        for i in 0..8u64 {
            backup_if_upgraded(&dir, Some(&format!("0.{i}.0")), "1.0.0", 100 + i).unwrap();
        }
        let left: Vec<_> = fs::read_dir(dir.join("backups"))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert_eq!(left.len(), KEEP_BACKUPS);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn settings_tolerate_missing_or_broken_files() {
        let dir = temp_dir("settings");
        assert_eq!(read_settings(&dir.join("yok.json")), Settings::default());
        fs::write(dir.join("bozuk.json"), "{").unwrap();
        assert_eq!(read_settings(&dir.join("bozuk.json")), Settings::default());
        fs::write(dir.join("ok.json"), r#"{"mode":"local"}"#).unwrap();
        assert_eq!(
            read_settings(&dir.join("ok.json")).mode.as_deref(),
            Some("local")
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn connection_string_quotes_the_path() {
        assert_eq!(
            connection_string(Path::new("C:/Users/Ali Veli/Apivator/apivator.db")),
            "Data Source=\"C:/Users/Ali Veli/Apivator/apivator.db\""
        );
    }
}
