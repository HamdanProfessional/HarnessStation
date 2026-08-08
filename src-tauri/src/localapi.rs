//! Local OpenAI-compatible API server.
//!
//! Exposes the app's configured models and agents at
//! `http://127.0.0.1:<port>/v1` so other tools — an editor, a script, another
//! app that only speaks the OpenAI API — can call them like any OpenAI endpoint.
//!
//! Like the mesh, Rust is only the front door. It parses the HTTP request and
//! hands the work to the frontend, which owns the providers, the keys and the
//! actual model call, and answers via `local_api_reply`. Rust never sees a key
//! and has no idea what a "model" is.
//!
//! Bound to `127.0.0.1` on purpose: this is a loopback service for other
//! programs on the same machine, not a networked one. Sharing across devices is
//! the mesh's job, with its own pairing and trust.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{oneshot, Mutex};

/// How long an inbound request may wait for the frontend to answer it. Model
/// calls can be slow, so this is generous.
const HANDLER_TIMEOUT_SECS: u64 = 300;
/// Cap on request bodies, so a runaway client can't exhaust memory.
const MAX_BODY: usize = 4 * 1024 * 1024;

#[derive(Default)]
pub struct LocalApi {
    /// The accept loop; aborting it stops the server.
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// Inbound requests waiting for the frontend to answer.
    inbox: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    next_rid: AtomicU64,
    /// The port we're bound to, or None when stopped.
    port: Mutex<Option<u16>>,
}

impl LocalApi {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Emit a request to the frontend and wait for its answer.
async fn ask_frontend(
    api: &Arc<LocalApi>,
    app: &AppHandle,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let rid = api.next_rid.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, rx) = oneshot::channel();
    api.inbox.lock().await.insert(rid, tx);

    app.emit(
        "localapi-request",
        json!({ "rid": rid, "method": method, "params": params }),
    )
    .map_err(|e| e.to_string())?;

    let answer =
        tokio::time::timeout(std::time::Duration::from_secs(HANDLER_TIMEOUT_SECS), rx).await;
    api.inbox.lock().await.remove(&rid);

    match answer {
        Ok(Ok(v)) => {
            if let Some(err) = v.get("error").and_then(Value::as_str) {
                Err(err.to_string())
            } else {
                Ok(v.get("result").cloned().unwrap_or(Value::Null))
            }
        }
        // The window is closed, or the frontend never replied.
        Ok(Err(_)) => Err("the HarnessStation window isn't answering — is it open?".into()),
        Err(_) => Err(format!("timed out after {HANDLER_TIMEOUT_SECS}s")),
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Build a full HTTP/1.1 response with the JSON body and permissive CORS.
fn http_json(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: application/json\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Authorization, Content-Type\r\n\
         Content-Length: {len}\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        len = body.as_bytes().len(),
    )
}

/// An OpenAI-shaped error object, so clients that parse it show a sensible message.
fn http_error(status: &str, message: &str) -> String {
    let body = json!({ "error": { "message": message, "type": "harnessstation_error" } });
    http_json(status, &body.to_string())
}

/// Read one HTTP request off the socket, route it, write the response, close.
async fn handle_conn(api: Arc<LocalApi>, app: AppHandle, mut stream: tokio::net::TcpStream) {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];

    // Read until the end of the headers.
    let header_end = loop {
        let n = match stream.read(&mut tmp).await {
            Ok(0) => return,
            Ok(n) => n,
            Err(_) => return,
        };
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > 64 * 1024 {
            let _ = stream
                .write_all(http_error("431 Request Header Fields Too Large", "headers too large").as_bytes())
                .await;
            return;
        }
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    let mut content_length = 0usize;
    for line in lines {
        let low = line.to_ascii_lowercase();
        if let Some(v) = low.strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }
    if content_length > MAX_BODY {
        let _ = stream
            .write_all(http_error("413 Payload Too Large", "request body too large").as_bytes())
            .await;
        return;
    }

    // Read the rest of the body, if any.
    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        let n = match stream.read(&mut tmp).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        body.extend_from_slice(&tmp[..n]);
    }

    let response = route(&api, &app, &method, &path, &body).await;
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

/// Map a method + path to an answer.
async fn route(
    api: &Arc<LocalApi>,
    app: &AppHandle,
    method: &str,
    path: &str,
    body: &[u8],
) -> String {
    // Strip any query string; we don't use one.
    let path = path.split('?').next().unwrap_or(path);

    if method == "OPTIONS" {
        // CORS preflight.
        return http_json("204 No Content", "");
    }

    match (method, path) {
        ("GET", "/v1/models") | ("GET", "/models") => {
            match ask_frontend(api, app, "models", Value::Null).await {
                Ok(v) => http_json("200 OK", &v.to_string()),
                Err(e) => http_error("500 Internal Server Error", &e),
            }
        }
        ("POST", "/v1/chat/completions") | ("POST", "/chat/completions") => {
            let params: Value = match serde_json::from_slice(body) {
                Ok(v) => v,
                Err(_) => return http_error("400 Bad Request", "request body is not valid JSON"),
            };
            match ask_frontend(api, app, "chat", params).await {
                Ok(v) => http_json("200 OK", &v.to_string()),
                Err(e) => http_error("502 Bad Gateway", &e),
            }
        }
        ("GET", "/") | ("GET", "/v1") => http_json(
            "200 OK",
            &json!({ "service": "harnessstation", "openai_compatible": true }).to_string(),
        ),
        _ => http_error("404 Not Found", "unknown endpoint"),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Start the loopback API server on `port` (rebinding if already running).
#[tauri::command]
pub async fn local_api_start(
    app: AppHandle,
    state: State<'_, Arc<LocalApi>>,
    port: u16,
) -> Result<u16, String> {
    let api = state.inner().clone();
    // Replace any existing server (e.g. the user changed the port).
    if let Some(t) = api.task.lock().await.take() {
        t.abort();
    }

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("couldn't bind 127.0.0.1:{port} — is another program using it? ({e})"))?;
    *api.port.lock().await = Some(port);

    let api2 = api.clone();
    let app2 = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        println!("[localapi] OpenAI-compatible server on http://127.0.0.1:{port}/v1");
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let a = api2.clone();
                    let ap = app2.clone();
                    tauri::async_runtime::spawn(async move {
                        handle_conn(a, ap, stream).await;
                    });
                }
                Err(_) => break,
            }
        }
    });
    *api.task.lock().await = Some(handle);
    Ok(port)
}

#[tauri::command]
pub async fn local_api_stop(state: State<'_, Arc<LocalApi>>) -> Result<(), String> {
    let api = state.inner().clone();
    if let Some(t) = api.task.lock().await.take() {
        t.abort();
    }
    *api.port.lock().await = None;
    Ok(())
}

/// The port the server is bound to, or null when stopped — lets the UI show state.
#[tauri::command]
pub async fn local_api_status(state: State<'_, Arc<LocalApi>>) -> Result<Option<u16>, String> {
    Ok(*state.inner().port.lock().await)
}

/// The frontend's answer to a `localapi-request` event.
#[tauri::command]
pub async fn local_api_reply(
    state: State<'_, Arc<LocalApi>>,
    rid: u64,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    let api = state.inner().clone();
    let Some(tx) = api.inbox.lock().await.remove(&rid) else {
        // The caller already timed out; nothing to do.
        return Ok(());
    };
    let payload = match error {
        Some(e) => json!({ "error": e }),
        None => json!({ "result": result.unwrap_or(Value::Null) }),
    };
    let _ = tx.send(payload);
    Ok(())
}
