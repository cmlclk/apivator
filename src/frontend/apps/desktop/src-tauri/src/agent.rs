//! Yerel .NET ajanı: uygulamayla birlikte gelen `apivator-agent` sidecar'ını başlatır, hazır olmasını bekler
//! ve uygulama kapanınca sonlandırır (süreç yönetimi `sidecar.rs`'te).

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;

use crate::sidecar::{session_token, Sidecar, SidecarInfo};

const READY_PREFIX: &str = "APIVATOR_AGENT_READY ";
const START_TIMEOUT: Duration = Duration::from_secs(20);

pub struct AgentState(pub Arc<Sidecar>);

impl Default for AgentState {
    fn default() -> Self {
        Self(Sidecar::new(READY_PREFIX, "agent"))
    }
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let token = session_token()?;
    let mut command = app
        .shell()
        .sidecar("apivator-agent")
        .map_err(|e| e.to_string())?
        .args(["--parent-pid", &std::process::id().to_string()])
        .env("APIVATOR_AGENT_TOKEN", &token);
    // Geliştirmede arayüz vite'tan (http://localhost:5173) gelir; ajan bu kökeni zaten kabul ediyor.
    if let Ok(origin) = std::env::var("APIVATOR_DEV_ORIGIN") {
        command = command.args(["--origin", &origin]);
    }
    app.state::<AgentState>().0.start(command, token)
}

pub fn stop(app: &AppHandle) {
    app.state::<AgentState>().0.stop();
}

/// Arayüz ajanın adresini ve token'ını buradan alır; ajan henüz hazır değilse bekler.
#[tauri::command]
pub async fn agent_info(state: State<'_, AgentState>) -> Result<SidecarInfo, String> {
    state.0.wait_info(START_TIMEOUT).await
}
