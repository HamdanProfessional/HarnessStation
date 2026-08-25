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
/// How long a fresh WebSocket has to prove it is the extension.
const HELLO_TIMEOUT_SECS: u64 = 10;

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

/// The credential the extension must present on connect.
///
/// Loopback is not authentication: a WebSocket is not subject to CORS, so any
/// webpage the user has open can open `ws://127.0.0.1:8791` and — because a
/// new connection replaces the old one — silently become the "extension",
/// feeding the agent fabricated page contents and click results. The token is
/// generated once, persisted next to the rest of the app's state, and pasted
/// into the extension's options page; the handshake below refuses anything
/// that cannot present it.
fn bridge_token() -> String {
    use rand::Rng;
    let path = crate::local::harness_root().join("bridge-token");
    if let Ok(t) = std::fs::read_to_string(&path) {
        let t = t.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    let mut buf = [0u8; 24];
    rand::thread_rng().fill(&mut buf);
    let token: String = buf.iter().map(|b| format!("{b:02x}")).collect();
    let _ = std::fs::write(&path, &token);
    token
}

/// The token, for the setup UI to show with a copy button.
#[tauri::command]
pub fn browser_bridge_token() -> String {
    bridge_token()
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

    // First gate, free with every WebSocket handshake: a real extension's
    // service worker sends `Origin: chrome-extension://…` (or moz-extension on
    // Firefox). A webpage's JS sends its own site's origin instead, and is
    // dropped here before the WebSocket even finishes opening.
    //
    // `result_large_err` is the tungstenite callback's signature, not ours —
    // its Err variant carries a whole Response by value.
    type WsStream = tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>;
    #[allow(clippy::result_large_err)]
    let origin_ok: Result<WsStream, _> = tokio_tungstenite::accept_hdr_async(
        stream,
        |req: &tokio_tungstenite::tungstenite::handshake::server::Request,
         resp: tokio_tungstenite::tungstenite::handshake::server::Response| {
            // Returning Err aborts the handshake with the given response.
            // This tungstenite aliases the accept-side Response to Response<()>
            // and takes rejections as Response<Option<String>>.
            let ok = req
                .headers()
                .get("Origin")
                .and_then(|o| o.to_str().ok())
                .is_some_and(|o| {
                    o.starts_with("chrome-extension://") || o.starts_with("moz-extension://")
                });
            if ok {
                return Ok(resp);
            }
            let rejection: tauri::http::Response<Option<String>> = tauri::http::Response::builder()
                .status(tauri::http::StatusCode::FORBIDDEN)
                .body(None)
                .unwrap_or_else(|_| tauri::http::Response::new(None));
            Err(rejection)
        },
    )
    .await;
    let ws = match origin_ok {
        Ok(ws) => ws,
        Err(e) => {
            return Err(format!("rejected a non-extension WebSocket client: {e}").into());
        }
    };
    let (mut write, mut read) = ws.split();

    // Second gate: prove knowledge of the shared token. Origin headers can be
    // forged by anything that isn't a browser; the token can only be copied
    // out of the app's setup panel or the extension's own storage.
    let token = bridge_token();
    let hello = tokio::time::timeout(
        std::time::Duration::from_secs(HELLO_TIMEOUT_SECS),
        read.next(),
    )
    .await;
    let proven = match hello {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                let t = v.get("token").and_then(Value::as_str)?;
                Some(t == token)
            })
            .unwrap_or(false),
        _ => false,
    };
    if !proven {
        let _ = write.send(Message::Text(
            json!({ "type": "error", "error": "missing or invalid bridge token" }).to_string(),
        ))
        .await;
        return Err("connection could not present the bridge token".into());
    }

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Only one extension at a time; a new connection replaces the old one, which
    // is what happens when the browser restarts or the extension reloads. Both
    // gates above passed, so what replaces the real extension is the real
    // extension reconnecting — not a drive-by.
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
