//! Uygulamayla birlikte gelen .NET sidecar'ları (yerel ajan, yerel API) için ortak süreç yönetimi: başlatır,
//! stdout'taki hazır satırından portu okur, son stderr satırlarını hata için saklar ve kapatır. Her başlatmada
//! rastgele bir oturum token'ı üretilir; sidecar yalnızca bu token'ı taşıyan istekleri kabul eder.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};

#[derive(Clone, Serialize)]
pub struct SidecarInfo {
    pub url: String,
    pub token: String,
}

/// Bir sidecar'ın durumu. `error_prefix` hata kodlarının önekidir (ör. "agent" → agentExited, agentTimeout).
pub struct Sidecar {
    ready_prefix: &'static str,
    error_prefix: &'static str,
    info: Mutex<Option<SidecarInfo>>,
    error: Mutex<Option<String>>,
    child: Mutex<Option<CommandChild>>,
    /// Her başlatmada artar; durdurulmuş eski sürecin geç gelen olayları yenisinin durumunu ezmesin.
    generation: AtomicU64,
}

pub fn session_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// `<önek>{"port":12345}` satırından portu okur.
pub fn parse_ready(prefix: &str, line: &str) -> Option<u16> {
    let json = line.trim().strip_prefix(prefix)?;
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

impl Sidecar {
    pub fn new(ready_prefix: &'static str, error_prefix: &'static str) -> Arc<Self> {
        Arc::new(Self {
            ready_prefix,
            error_prefix,
            info: Mutex::new(None),
            error: Mutex::new(None),
            child: Mutex::new(None),
            generation: AtomicU64::new(0),
        })
    }

    fn code(&self, suffix: &str) -> String {
        format!("{}{suffix}", self.error_prefix)
    }

    pub fn is_running(&self) -> bool {
        self.child.lock().unwrap().is_some()
    }

    /// Hazırlanmış komutu (token ortam değişkeni dahil) başlatır; önceki süreç varsa önce kapatılır.
    pub fn start(self: &Arc<Self>, command: Command, token: String) -> Result<(), String> {
        self.stop();
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *self.info.lock().unwrap() = None;
        *self.error.lock().unwrap() = None;

        let (mut events, child) = command.spawn().map_err(|e| {
            crate::coded_error(&self.code("StartFailed"), &[("detail", &e.to_string())])
        })?;
        *self.child.lock().unwrap() = Some(child);

        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let current = || this.generation.load(Ordering::SeqCst) == generation;
            let mut stderr = String::new();
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        if let Some(port) = parse_ready(this.ready_prefix, &line) {
                            if current() {
                                *this.info.lock().unwrap() = Some(SidecarInfo {
                                    url: format!("http://127.0.0.1:{port}"),
                                    token: token.clone(),
                                });
                            }
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
                        if !current() {
                            break;
                        }
                        *this.info.lock().unwrap() = None;
                        this.child.lock().unwrap().take();
                        let code = payload.code.map(|c| c.to_string()).unwrap_or_default();
                        *this.error.lock().unwrap() = Some(crate::coded_error(
                            &this.code("Exited"),
                            &[("code", &code), ("detail", stderr.trim())],
                        ));
                    }
                    _ => {}
                }
            }
        });
        Ok(())
    }

    /// Başlatılamadıysa (ör. yedek alınamadı) bekleyenlere dönecek hata.
    pub fn fail(&self, error: String) {
        *self.error.lock().unwrap() = Some(error);
    }

    pub fn stop(&self) {
        // Kapatılan sürecin "çıktı" olayı hata sayılmasın.
        self.generation.fetch_add(1, Ordering::SeqCst);
        *self.info.lock().unwrap() = None;
        if let Some(child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }

    /// Adres ve token; sidecar henüz hazır değilse `timeout` kadar bekler.
    pub async fn wait_info(&self, timeout: Duration) -> Result<SidecarInfo, String> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if let Some(info) = self.info.lock().unwrap().clone() {
                return Ok(info);
            }
            if let Some(error) = self.error.lock().unwrap().clone() {
                return Err(error);
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(crate::coded_error(
                    &self.code("Timeout"),
                    &[("seconds", &timeout.as_secs().to_string())],
                ));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_port_from_the_ready_line() {
        let prefix = "APIVATOR_AGENT_READY ";
        assert_eq!(
            parse_ready(prefix, "APIVATOR_AGENT_READY {\"port\":43210}\n"),
            Some(43210)
        );
        assert_eq!(parse_ready(prefix, "başka bir satır"), None);
        assert_eq!(
            parse_ready(prefix, "APIVATOR_AGENT_READY {\"port\":99999}"),
            None
        );
        assert_eq!(
            parse_ready("APIVATOR_API_READY ", "APIVATOR_API_READY {\"port\":5001}"),
            Some(5001)
        );
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
