//! Yerel .NET ajanı: uygulamayla birlikte gelen `apivator-agent` sidecar'ını başlatır, hazır olmasını bekler
//! ve uygulama kapanınca sonlandırır. Her oturum için rastgele bir token üretilir; ajan yalnızca bu token'ı
//! taşıyan istekleri kabul eder.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const READY_PREFIX: &str = "APIVATOR_AGENT_READY ";
const START_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Serialize)]
pub struct AgentInfo {
    pub url: String,
    pub token: String,
}

#[derive(Default)]
pub struct AgentState {
    info: Mutex<Option<AgentInfo>>,
    error: Mutex<Option<String>>,
    child: Mutex<Option<CommandChild>>,
}

fn session_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// `APIVATOR_AGENT_READY {"port":12345}` satırından portu okur.
pub fn parse_ready(line: &str) -> Option<u16> {
    let json = line.trim().strip_prefix(READY_PREFIX)?;
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    value
        .get("port")?
        .as_u64()
        .and_then(|p| u16::try_from(p).ok())
}

/// Metnin son `max` baytı kadarını, UTF-8 karakter sınırından keserek döner.
fn tail(text: &str, max: usize) -> &str {
    let mut start = text.len().saturating_sub(max);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
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

    let (mut events, child) = command
        .spawn()
        .map_err(|e| crate::coded_error("agentStartFailed", &[("detail", &e.to_string())]))?;
    *app.state::<AgentState>().child.lock().unwrap() = Some(child);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<AgentState>();
        let mut stderr = String::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(port) = parse_ready(&line) {
                        *state.info.lock().unwrap() = Some(AgentInfo {
                            url: format!("http://127.0.0.1:{port}"),
                            token: token.clone(),
                        });
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    // Son birkaç satır hata mesajı için saklanır.
                    stderr.push_str(&String::from_utf8_lossy(&bytes));
                    if stderr.len() > 4000 {
                        stderr = tail(&stderr, 2000).to_string();
                    }
                }
                CommandEvent::Terminated(payload) => {
                    *state.info.lock().unwrap() = None;
                    let detail = stderr.trim();
                    let code = payload.code.map(|c| c.to_string()).unwrap_or_default();
                    *state.error.lock().unwrap() = Some(crate::coded_error(
                        "agentExited",
                        &[("code", &code), ("detail", detail)],
                    ));
                }
                _ => {}
            }
        }
    });
    Ok(())
}

pub fn stop(app: &AppHandle) {
    if let Some(child) = app.state::<AgentState>().child.lock().unwrap().take() {
        let _ = child.kill();
    }
}

/// Arayüz ajanın adresini ve token'ını buradan alır; ajan henüz hazır değilse bekler.
#[tauri::command]
pub async fn agent_info(state: State<'_, AgentState>) -> Result<AgentInfo, String> {
    let deadline = tokio::time::Instant::now() + START_TIMEOUT;
    loop {
        if let Some(info) = state.info.lock().unwrap().clone() {
            return Ok(info);
        }
        if let Some(error) = state.error.lock().unwrap().clone() {
            return Err(error);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(crate::coded_error(
                "agentTimeout",
                &[("seconds", &START_TIMEOUT.as_secs().to_string())],
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_port_from_the_ready_line() {
        assert_eq!(
            parse_ready("APIVATOR_AGENT_READY {\"port\":43210}\n"),
            Some(43210)
        );
        assert_eq!(parse_ready("başka bir satır"), None);
        assert_eq!(parse_ready("APIVATOR_AGENT_READY {\"port\":99999}"), None);
    }

    #[test]
    fn tail_respects_character_boundaries() {
        let text = "ğğğ"; // her biri 2 bayt
        assert_eq!(tail(text, 3), "ğ");
        assert_eq!(tail(text, 10), "ğğğ");
    }

    #[test]
    fn session_tokens_are_long_and_random() {
        let a = session_token().unwrap();
        assert_eq!(a.len(), 64);
        assert_ne!(a, session_token().unwrap());
    }
}
