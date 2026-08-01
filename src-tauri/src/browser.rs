//! Bridge to the user's real browser.
//!
//! Automating a *fresh* browser (Playwright, a CDP-launched Chrome, an embedded
//! webview) gives you a blank profile: no logins, no cookies, no sessions. Every
//! useful task then starts with "sign in", which the user has to do again in a
//! window that isn't theirs.
//!
//! So instead a small WebExtension runs inside the browser they already use, and
//! this is the app's end of the wire. Actions execute in their real tabs, with
//! their real sessions, and nothing about their browser has to change — no debug
//! flags, no relaunch, no separate profile.
//!
//! The transport is a WebSocket on loopback. The app sends
//! `{"id":N,"action":"...","args":{...}}` and the extension answers
//! `{"id":N,"ok":true,"result":...}` or `{"id":N,"ok":false,"error":"..."}`.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use tokio_tungstenite::tungstenite::Message;

/// Loopback only. Nothing outside this machine can reach the bridge.
pub const BRIDGE_PORT: u16 = 8791;
const CALL_TIMEOUT_SECS: u64 = 45;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;
type Outbox = Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<Message>>>>;

#[derive(Default)]
pub struct BrowserBridge {
    pending: Pending,
    outbox: Outbox,
    next_id: AtomicU64,
}

impl BrowserBridge {
    pub fn new() -> Self {
        Self::default()
    }

    async fn connected(&self) -> bool {
        self.outbox.lock().await.is_some()
    }
}

/// Start the bridge listener. Failure to bind is not fatal — the app simply
/// reports the browser as unavailable rather than refusing to start.
pub fn spawn(bridge: Arc<BrowserBridge>) {
    tauri::async_runtime::spawn(async move {
        let addr = format!("127.0.0.1:{BRIDGE_PORT}");
        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[browser] cannot bind {addr}: {e} — browser tools disabled");
                return;
            }
        };
        println!("[browser] bridge listening on {addr}");
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            let bridge = bridge.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = serve(bridge, stream).await {
                    eprintln!("[browser] extension disconnected: {e}");
                }
            });
        }
    });
}

async fn serve(
    bridge: Arc<BrowserBridge>,
    stream: tokio::net::TcpStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use futures_util::{SinkExt, StreamExt};

    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (mut write, mut read) = ws.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Only one extension at a time; a new connection replaces the old one, which
    // is what happens when the browser restarts or the extension reloads.
    *bridge.outbox.lock().await = Some(tx);
    println!("[browser] extension connected");

    let writer = tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(msg).await.is_err() {
                break;
            }
        }
    });

    while let Some(msg) = read.next().await {
        let Ok(Message::Text(text)) = msg else { continue };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let Some(id) = value.get("id").and_then(Value::as_u64) else {
            continue;
        };
        if let Some(tx) = bridge.pending.lock().await.remove(&id) {
            let _ = tx.send(value);
        }
    }

    *bridge.outbox.lock().await = None;
    writer.abort();
    // Anything still waiting will time out on its own rather than hang forever.
    Ok(())
}

/// Send one action to the extension and wait for its reply.
#[tauri::command]
pub async fn browser_call(
    action: String,
    args: Value,
    state: tauri::State<'_, Arc<BrowserBridge>>,
) -> Result<Value, String> {
    let bridge = state.inner().clone();

    let tx = {
        let guard = bridge.outbox.lock().await;
        guard.clone().ok_or_else(|| {
            "The browser extension isn't connected. Open the Browser panel for setup instructions."
                .to_string()
        })?
    };

    let id = bridge.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let (reply_tx, reply_rx) = oneshot::channel();
    bridge.pending.lock().await.insert(id, reply_tx);

    let payload = json!({ "id": id, "action": action, "args": args });
    tx.send(Message::Text(payload.to_string()))
        .map_err(|_| "the browser extension went away mid-request".to_string())?;

    let reply = tokio::time::timeout(
        std::time::Duration::from_secs(CALL_TIMEOUT_SECS),
        reply_rx,
    )
    .await;

    // Never leave an orphan waiting in the map.
    bridge.pending.lock().await.remove(&id);

    let value = match reply {
        Ok(Ok(v)) => v,
        Ok(Err(_)) => return Err("the browser extension closed before replying".into()),
        Err(_) => {
            return Err(format!(
                "the browser didn't respond within {CALL_TIMEOUT_SECS}s — the page may be blocked or still loading"
            ))
        }
    };

    if value.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(value.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("the browser reported an unknown error")
            .to_string())
    }
}

/// Whether the extension is connected, for the setup panel.
#[tauri::command]
pub async fn browser_status(
    state: tauri::State<'_, Arc<BrowserBridge>>,
) -> Result<Value, String> {
    Ok(json!({
        "connected": state.inner().connected().await,
        "port": BRIDGE_PORT,
    }))
}
