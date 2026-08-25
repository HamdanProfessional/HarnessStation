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
use tokio::sync::{mpsc, oneshot, Mutex};

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
    /// Streaming requests: each chunk the frontend pushes is relayed to the
    /// still-open socket. Separate from `inbox` because a stream is many
    /// messages and a oneshot is, by definition, one.
    streams: Mutex<HashMap<u64, mpsc::UnboundedSender<Value>>>,
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

/// Open a streaming request: emit it to the frontend and return the channel
/// its chunks will arrive on.
async fn ask_frontend_stream(
    api: &Arc<LocalApi>,
    app: &AppHandle,
    method: &str,
    params: Value,
) -> Result<(u64, mpsc::UnboundedReceiver<Value>), String> {
    let rid = api.next_rid.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, rx) = mpsc::unbounded_channel();
    api.streams.lock().await.insert(rid, tx);
    app.emit(
        "localapi-request",
        json!({ "rid": rid, "method": method, "params": params }),
    )
    .map_err(|e| e.to_string())?;
    Ok((rid, rx))
}

/// Server-sent-events headers. No Content-Length: the body ends when we close.
fn sse_headers() -> String {
    concat!(
        "HTTP/1.1 200 OK\r\n",
        "Content-Type: text/event-stream\r\n",
        // Without this, proxies and the browser buffer the whole stream and
        // deliver it at the end — which looks exactly like no streaming at all.
        "Cache-Control: no-cache\r\n",
        "Access-Control-Allow-Origin: *\r\n",
        "Connection: close\r\n",
        // No Content-Length: the body ends when the socket closes. Sending one
        // would tell the client the response is already complete.
        "\r\n",
    )
    .to_string()
}

/// Relay a streaming completion to the socket as SSE, then close it.
///
/// Rust stays a dumb pipe here. In the OpenAI style the frontend pushes
/// fully-formed chunk objects and this wraps them in `data: ...` framing. In
/// the Anthropic style the frontend pushes *preformatted frames as strings*
/// (named events can't be reconstructed from a JSON blob), which are written
/// verbatim. Either way, the shape lives on the side that knows what a model
/// is.
async fn stream_chat(
    api: Arc<LocalApi>,
    app: AppHandle,
    method: &str,
    params: Value,
    stream: &mut tokio::net::TcpStream,
) {
    let (rid, mut rx) = match ask_frontend_stream(&api, &app, method, params).await {
        Ok(v) => v,
        Err(e) => {
            let _ = stream.write_all(http_error("500 Internal Server Error", &e).as_bytes()).await;
            return;
        }
    };

    if stream.write_all(sse_headers().as_bytes()).await.is_err() {
        api.streams.lock().await.remove(&rid);
        return;
    }

    let anthropic = method == "anthropic_messages_stream";
    // Not a `while let`: the timeout arm must still tell the client why the
    // stream stopped before breaking.
    #[allow(clippy::while_let_loop)]
    loop {
        let next = tokio::time::timeout(
            std::time::Duration::from_secs(HANDLER_TIMEOUT_SECS),
            rx.recv(),
        )
        .await;
        let chunk = match next {
            Ok(Some(c)) => c,
            // Channel closed by local_api_end, or the frontend went away.
            Ok(None) => break,
            Err(_) => {
                let msg = format!("timed out after {HANDLER_TIMEOUT_SECS}s");
                let frame = if anthropic {
                    format!(
                        "event: error\ndata: {}\n\n",
                        json!({ "type": "error", "error": { "type": "api_error", "message": msg } })
                    )
                } else {
                    format!("data: {}\n\n", json!({ "error": { "message": msg } }))
                };
                let _ = stream.write_all(frame.as_bytes()).await;
                break;
            }
        };
        // A string chunk on the Anthropic path is a preformatted named-event
        // frame, written verbatim; everything else gets OpenAI `data:` framing.
        let frame = sse_frame(&chunk, anthropic);
        // A write failure means the client hung up. Dropping the sender is what
        // tells the frontend to stop generating, via local_api_push's return.
        if stream.write_all(frame.as_bytes()).await.is_err() {
            break;
        }
        let _ = stream.flush().await;
    }

    api.streams.lock().await.remove(&rid);
    if !anthropic {
        let _ = stream.write_all(b"data: [DONE]\n\n").await;
    }
    let _ = stream.flush().await;
}

/// One SSE frame. On the Anthropic path a string chunk is already a complete
/// `event:` + `data:` frame from the frontend; everything else — and every
/// chunk on the OpenAI path — is a JSON value wrapped in `data:` framing.
fn sse_frame(chunk: &Value, anthropic: bool) -> String {
    match (anthropic, chunk) {
        (true, Value::String(s)) => s.clone(),
        (_, other) => format!("data: {other}\n\n"),
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
         Access-Control-Allow-Headers: Authorization, Content-Type, x-api-key, anthropic-version, anthropic-beta\r\n\
         Content-Length: {len}\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        len = body.len(),
    )
}

/// An OpenAI-shaped error object, so clients that parse it show a sensible message.
fn http_error(status: &str, message: &str) -> String {
    let body = json!({ "error": { "message": message, "type": "harnessstation_error" } });
    http_json(status, &body.to_string())
}

/// Anthropic-shaped error: `{ type: "error", error: { type, message } }`.
fn http_error_anthropic(status: &str, message: &str) -> String {
    let body = json!({ "type": "error", "error": { "type": "api_error", "message": message } });
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

    // Streaming completions keep the socket open and write SSE frames, so they
    // cannot go through `route`, which returns one finished response string.
    let clean_path = path.split('?').next().unwrap_or(&path);
    let stream_method = if method == "POST" {
        match clean_path {
            "/v1/chat/completions" | "/chat/completions" => Some("chat_stream"),
            // The Anthropic Messages protocol — what Claude Code speaks.
            "/v1/messages" | "/messages" => Some("anthropic_messages_stream"),
            _ => None,
        }
    } else {
        None
    };
    if let Some(stream_method) = stream_method {
        if let Ok(params) = serde_json::from_slice::<Value>(&body) {
            if params.get("stream").and_then(Value::as_bool) == Some(true) {
                stream_chat(api, app, stream_method, params, &mut stream).await;
                return;
            }
        }
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
        // The Anthropic Messages protocol (Claude Code, and anything speaking
        // anthropic-sdk). Errors use Anthropic's error shape on this route —
        // its SDKs read `error.type`, not OpenAI's `error.message`.
        ("POST", "/v1/messages") | ("POST", "/messages") => {
            let params: Value = match serde_json::from_slice(body) {
                Ok(v) => v,
                Err(_) => return http_error_anthropic("400 Bad Request", "request body is not valid JSON"),
            };
            match ask_frontend(api, app, "anthropic_messages", params).await {
                Ok(v) => http_json("200 OK", &v.to_string()),
                Err(e) => http_error_anthropic("502 Bad Gateway", &e),
            }
        }
        // Claude Code calls this before big requests; a real tokenizer we do
        // not have, so the estimate lives on the frontend with everything else.
        ("POST", "/v1/messages/count_tokens") | ("POST", "/messages/count_tokens") => {
            let params: Value = match serde_json::from_slice(body) {
                Ok(v) => v,
                Err(_) => return http_error_anthropic("400 Bad Request", "request body is not valid JSON"),
            };
            match ask_frontend(api, app, "anthropic_count_tokens", params).await {
                Ok(v) => http_json("200 OK", &v.to_string()),
                Err(e) => http_error_anthropic("502 Bad Gateway", &e),
            }
        }
        ("GET", "/") | ("GET", "/v1") => http_json(
            "200 OK",
            &json!({ "service": "harnessstation", "openai_compatible": true, "anthropic_compatible": true }).to_string(),
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
        // An accept error (EMFILE, EBADF during shutdown) ends the server.
        while let Ok((stream, _)) = listener.accept().await {
            let a = api2.clone();
            let ap = app2.clone();
            tauri::async_runtime::spawn(async move {
                handle_conn(a, ap, stream).await;
            });
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

/// Push one chunk of a streaming completion.
///
/// Returns whether the client is still connected. The frontend uses a `false`
/// to abort generation — otherwise a client that hung up mid-reply would leave
/// us paying a provider to finish a response nobody will read.
#[tauri::command]
pub async fn local_api_push(
    state: State<'_, Arc<LocalApi>>,
    rid: u64,
    chunk: Value,
) -> Result<bool, String> {
    let api = state.inner().clone();
    let map = api.streams.lock().await;
    let Some(tx) = map.get(&rid) else {
        return Ok(false);
    };
    Ok(tx.send(chunk).is_ok())
}

/// Finish a streaming completion, optionally with a final error frame.
#[tauri::command]
pub async fn local_api_end(
    state: State<'_, Arc<LocalApi>>,
    rid: u64,
    error: Option<String>,
) -> Result<(), String> {
    let api = state.inner().clone();
    if let Some(tx) = api.streams.lock().await.remove(&rid) {
        if let Some(e) = error {
            let _ = tx.send(json!({ "error": { "message": e, "type": "harnessstation_error" } }));
        }
        // Dropping the sender ends the relay loop.
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_headers_declare_a_stream_and_no_length() {
        let h = sse_headers();
        // text/event-stream is what makes a client parse frames instead of
        // waiting for one JSON body — the exact mistake this server used to make.
        assert!(h.contains("Content-Type: text/event-stream"));
        // A Content-Length would tell the client the body is already complete.
        assert!(!h.to_lowercase().contains("content-length"));
        // Proxies and browsers will buffer a stream without this.
        assert!(h.contains("Cache-Control: no-cache"));
        assert!(h.ends_with("\r\n\r\n"));
    }

    #[test]
    fn json_responses_carry_a_length_and_cors() {
        let r = http_json("200 OK", "{\"a\":1}");
        assert!(r.contains("Content-Length: 7"));
        assert!(r.contains("Access-Control-Allow-Origin: *"));
        assert!(r.ends_with("{\"a\":1}"));
    }

    #[test]
    fn errors_are_shaped_the_way_openai_clients_parse_them() {
        // Clients read error.message; a bare string here shows as "undefined".
        let r = http_error("404 Not Found", "unknown endpoint");
        let body = r.split("\r\n\r\n").nth(1).unwrap();
        let v: Value = serde_json::from_str(body).unwrap();
        assert_eq!(v["error"]["message"], "unknown endpoint");
        assert!(v["error"]["type"].is_string());
    }

    #[test]
    fn content_length_counts_bytes_not_characters() {
        // A multi-byte reply truncated by a char-count length is the classic
        // way a JSON body arrives unparseable.
        let body = "{\"m\":\"héllo — ok\"}";
        let r = http_json("200 OK", body);
        assert!(r.contains(&format!("Content-Length: {}", body.as_bytes().len())));
        assert!(body.as_bytes().len() > body.chars().count());
    }

    #[test]
    fn find_subslice_locates_the_header_break() {
        assert_eq!(find_subslice(b"GET / HTTP/1.1\r\n\r\nbody", b"\r\n\r\n"), Some(14));
        assert_eq!(find_subslice(b"no break here", b"\r\n\r\n"), None);
    }

    #[test]
    fn anthropic_frames_pass_preformatted_strings_through_verbatim() {
        // Named events cannot be rebuilt from a JSON blob, so the frontend
        // sends the whole frame; Rust must not wrap it again.
        let raw = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\"}\n\n";
        assert_eq!(sse_frame(&Value::String(raw.to_string()), true), raw);
    }

    #[test]
    fn object_chunks_get_data_framing_on_both_paths() {
        let c = json!({ "type": "ping" });
        assert_eq!(sse_frame(&c, true), "data: {\"type\":\"ping\"}\n\n");
        assert_eq!(sse_frame(&c, false), "data: {\"type\":\"ping\"}\n\n");
        // And a string on the OpenAI path is still framed as JSON data.
        assert_eq!(sse_frame(&Value::String("hi".into()), false), "data: \"hi\"\n\n");
    }

    #[test]
    fn anthropic_errors_use_the_anthropic_shape() {
        let r = http_error_anthropic("502 Bad Gateway", "boom");
        let body = r.split("\r\n\r\n").nth(1).unwrap();
        let v: Value = serde_json::from_str(body).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["error"]["message"], "boom");
        assert!(v["error"]["type"].is_string());
    }
}
