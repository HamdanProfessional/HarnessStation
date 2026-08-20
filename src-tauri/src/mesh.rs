//! Device mesh.
//!
//! Lets one HarnessStation reach another — the desktop with the big GPU, the
//! laptop, a machine at the office — so that models, tools and knowledge on one
//! device can be used from another. The long game is a single system spread
//! across whatever hardware the user owns.
//!
//! Shape of it:
//!
//! * **Discovery** is a UDP broadcast on the LAN. Each node shouts its id, name
//!   and port every few seconds and listens for the same. No router config, no
//!   central directory. Machines that aren't on the same LAN (a VPN, a tunnel,
//!   a public host) are added by address instead.
//!
//! * **Transport** is a WebSocket, one connection per call. Long-lived links
//!   would need reconnection, backoff and liveness tracking to buy latency we
//!   don't need yet; a connection per request is far easier to reason about and
//!   cannot leave a half-dead link in the table.
//!
//! * **Trust** is a pairing code the user carries from one device to the other,
//!   exchanged once for a long-lived token. Neither the code nor the token ever
//!   crosses the wire: the server sends a nonce and the client proves it knows
//!   the secret by hashing the two together. Pairing has to be armed explicitly
//!   and expires, so an unpaired machine on the same network gets nothing.
//!
//! * **Bodies are encrypted.** Both ends derive a per-connection key from the
//!   shared secret and the server's nonce (`body_key`) and seal the request and
//!   reply with ChaCha20-Poly1305. A listener on the LAN sees that two devices
//!   talked and how much they said, and nothing else — not the method, not the
//!   arguments, not the result, and not the token minted during pairing.
//!
//!   This is deliberately *not* a substitute for a tunnel when crossing the
//!   internet. There is no forward secrecy: the key derives from a long-lived
//!   token, so recording traffic today and stealing that token later reads it
//!   all. There are no certificates, so this authenticates a *secret*, not a
//!   host. The UI still says to use a VPN or tunnel (Tailscale, WireGuard, SSH)
//!   rather than forwarding a port, and that advice stands.
//!
//! Nothing executes on its own: an inbound request is handed to the frontend,
//! which applies the user's sharing rules and answers. Rust only moves bytes.

use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{oneshot, Mutex};
use tokio_tungstenite::tungstenite::Message;

/// WebSocket port peers call. Deliberately not the browser bridge's loopback
/// port — this one is reachable from the network.
pub const MESH_PORT: u16 = 8793;
/// UDP port LAN announcements go out on.
pub const DISCOVERY_PORT: u16 = 8794;

const ANNOUNCE_SECS: u64 = 4;
/// A peer not heard from for this long is shown as offline rather than dropped —
/// a sleeping laptop is still a device you own.
const STALE_SECS: u64 = 15;
const CALL_TIMEOUT_SECS: u64 = 60;
/// How long an inbound request may wait for the frontend to answer it.
const HANDLER_TIMEOUT_SECS: u64 = 90;
/// Bumped to 2 when body encryption landed. There is no negotiation and no
/// plaintext fallback: a v1 peer gets a clear "update both" error rather than a
/// silent downgrade, which is the one failure mode worth being rude about.
const PROTOCOL: u32 = 2;

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill(&mut buf[..]);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Proof of knowing a secret, without sending it: `sha256(nonce:secret)`.
///
/// The nonce is fresh per connection, so a captured proof can't be replayed, and
/// a passive listener never sees the token itself.
fn proof(nonce: &str, secret: &str) -> String {
    let mut h = Sha256::new();
    h.update(nonce.as_bytes());
    h.update(b":");
    h.update(secret.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Body key for one connection: `sha256(nonce : secret : "hs-mesh-body-v2")`.
///
/// Separate derivation from `proof` on purpose. `proof` is *sent*, so if the two
/// shared an input a listener would hold a hash of the encryption key. The
/// trailing label makes the two hashes structurally different even though both
/// commit to the same nonce and secret.
///
/// Binding to the per-connection nonce means every connection gets a fresh key,
/// so a key recovered from one call buys nothing on the next.
fn body_key(nonce: &str, secret: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(nonce.as_bytes());
    h.update(b":");
    h.update(secret.as_bytes());
    h.update(b":hs-mesh-body-v2");
    h.finalize().into()
}

/// Encrypt a request or reply body.
///
/// Auth was already sound before this — the secret never crosses the wire and a
/// fresh nonce blocks replay — but the *bodies* went out as readable JSON, so
/// anyone on the LAN could watch which tools ran, with which arguments, and what
/// came back. On a product whose entire pitch is that your data stays yours,
/// that was the gap that mattered.
///
/// ChaCha20-Poly1305: AEAD, so this is integrity as well as secrecy. A flipped
/// byte fails to open rather than decrypting to something plausible.
fn seal(key: &[u8; 32], plaintext: &[u8]) -> Result<Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use chacha20poly1305::aead::{Aead, KeyInit};
    use chacha20poly1305::{ChaCha20Poly1305, Nonce};

    let cipher = ChaCha20Poly1305::new(key.into());
    // 96-bit nonce, fresh per message. Random rather than a counter because a
    // connection carries one message each way; there is no sequence to track,
    // and a counter that restarted would be a nonce reuse.
    let mut n = [0u8; 12];
    rand::Rng::fill(&mut rand::thread_rng(), &mut n[..]);
    let ct = cipher
        .encrypt(Nonce::from_slice(&n), plaintext)
        .map_err(|_| "could not encrypt the message body".to_string())?;
    Ok(json!({ "n": STANDARD.encode(n), "ct": STANDARD.encode(ct) }))
}

/// Decrypt a body produced by `seal`.
///
/// Every failure returns the same message. Distinguishing "wrong key" from
/// "corrupt ciphertext" from "malformed base64" would hand an attacker a probe.
fn open_sealed(key: &[u8; 32], envelope: &Value) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use chacha20poly1305::aead::{Aead, KeyInit};
    use chacha20poly1305::{ChaCha20Poly1305, Nonce};

    let fail = || "could not read the message body — is the other device paired?".to_string();
    let n = envelope.get("n").and_then(Value::as_str).ok_or_else(fail)?;
    let ct = envelope.get("ct").and_then(Value::as_str).ok_or_else(fail)?;
    let n = STANDARD.decode(n).map_err(|_| fail())?;
    let ct = STANDARD.decode(ct).map_err(|_| fail())?;
    if n.len() != 12 {
        return Err(fail());
    }
    let cipher = ChaCha20Poly1305::new(key.into());
    cipher
        .decrypt(Nonce::from_slice(&n), ct.as_ref())
        .map_err(|_| fail())
}

/// Constant-time-ish comparison. These are hex digests of equal length, so the
/// only thing worth hiding is *where* they differ.
fn same_secret(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A device we know about: discovered on the LAN, added by hand, or both.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Peer {
    pub id: String,
    pub name: String,
    /// "host:port" — how to reach it. Filled by discovery or typed by the user.
    pub addr: String,
    /// Shared secret from pairing. Absent means discovered but not yet trusted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    /// Unix seconds we last heard an announcement or a successful call.
    #[serde(default)]
    pub seen: u64,
    /// Whatever the peer said it can do, from its last `describe`.
    #[serde(default)]
    pub capabilities: Value,
}

impl Peer {
    fn paired(&self) -> bool {
        self.token.is_some()
    }
}

#[derive(Default)]
struct Identity {
    id: String,
    name: String,
}

/// A pairing code the user is currently showing on this device.
struct Arming {
    code: String,
    expires: u64,
}

/// How exposed an address is. Mirrors `addressExposure` in the frontend.
///
/// Worth doing in both places: the frontend judges an address the user typed,
/// before anything is sent, while this judges the address a connection actually
/// arrived from — which is the only way to learn that the port is reachable from
/// outside the LAN. A user behind a router they thought was closed finds out
/// here, not from a guess.
fn classify(ip: std::net::IpAddr) -> &'static str {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            if v4.is_loopback() {
                "loopback"
            } else if v4.is_private() || v4.is_link_local() {
                "private"
            } else if o[0] == 100 && (64..=127).contains(&o[1]) {
                "vpn" // carrier-grade NAT: Tailscale and friends live here
            } else {
                "public"
            }
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() {
                "loopback"
            } else if let Some(v4) = v6.to_ipv4_mapped() {
                // A dual-stack listener reports IPv4 peers this way, and reading
                // the raw v6 form would call every LAN address public.
                classify(IpAddr::V4(v4))
            } else {
                let seg = v6.segments()[0];
                if (seg & 0xffc0) == 0xfe80 || (seg & 0xfe00) == 0xfc00 {
                    "private" // link-local or unique-local
                } else {
                    "public"
                }
            }
        }
    }
}

/// A connection that arrived from beyond the local network.
#[derive(Clone, Serialize)]
pub struct Exposure {
    /// The address it came from, so the user can recognise (or not) the source.
    from: String,
    class: String,
    at: u64,
    /// How many such connections since the mesh started.
    count: u64,
    /// Whether it got as far as authenticating.
    authenticated: bool,
}

#[derive(Default)]
pub struct Mesh {
    identity: Mutex<Identity>,
    peers: Mutex<HashMap<String, Peer>>,
    /// Set while the listener is up; aborting these stops the mesh.
    tasks: Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>,
    running: std::sync::atomic::AtomicBool,
    arming: Mutex<Option<Arming>>,
    /// Inbound requests waiting for the frontend to answer.
    inbox: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    /// Set once something outside the LAN has connected to us.
    exposure: Mutex<Option<Exposure>>,
    next_rid: AtomicU64,
}

impl Mesh {
    pub fn new() -> Self {
        Self::default()
    }

    async fn upsert_discovered(&self, id: String, name: String, addr: String) {
        if id.is_empty() {
            return;
        }
        let mut peers = self.peers.lock().await;
        let entry = peers.entry(id.clone()).or_insert_with(|| Peer {
            id,
            name: name.clone(),
            addr: addr.clone(),
            token: None,
            seen: 0,
            capabilities: Value::Null,
        });
        // A device that moved to a new IP is still the same device.
        entry.addr = addr;
        entry.name = name;
        entry.seen = now();
    }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/// Announce ourselves on the LAN and listen for others.
///
/// Binding the same port for both send and receive means we hear our own
/// broadcasts; they're dropped by id. A failure to bind (another instance, a
/// firewall) disables discovery without touching the rest of the mesh — peers
/// added by address still work.
async fn discovery(mesh: Arc<Mesh>, port: u16) {
    let socket = match tokio::net::UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[mesh] LAN discovery unavailable ({e}) — peers can still be added by address");
            return;
        }
    };
    if let Err(e) = socket.set_broadcast(true) {
        eprintln!("[mesh] cannot broadcast: {e}");
        return;
    }

    // Announcing and listening share one task on purpose. Spawning the announcer
    // separately would survive `mesh_stop` aborting this one, and the device
    // would keep broadcasting after the user switched the mesh off.
    let mut beat = tokio::time::interval(std::time::Duration::from_secs(ANNOUNCE_SECS));
    let mut buf = vec![0u8; 2048];
    loop {
        tokio::select! {
            _ = beat.tick() => {
                let (id, name) = {
                    let ident = mesh.identity.lock().await;
                    (ident.id.clone(), ident.name.clone())
                };
                let msg = json!({ "v": PROTOCOL, "id": id, "name": name, "port": port });
                let _ = socket
                    .send_to(msg.to_string().as_bytes(), ("255.255.255.255", DISCOVERY_PORT))
                    .await;
            }
            got = socket.recv_from(&mut buf) => {
                let Ok((n, from)) = got else { continue };
                let Ok(value) = serde_json::from_slice::<Value>(&buf[..n]) else {
                    continue;
                };
                let id = value.get("id").and_then(Value::as_str).unwrap_or_default();
                if id.is_empty() || id == mesh.identity.lock().await.id {
                    continue; // our own broadcast
                }
                let name = value
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Unnamed device");
                let peer_port = value
                    .get("port")
                    .and_then(Value::as_u64)
                    .unwrap_or(MESH_PORT as u64) as u16;
                mesh.upsert_discovered(
                    id.to_string(),
                    name.to_string(),
                    format!("{}:{}", from.ip(), peer_port),
                )
                .await;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Server: handling calls from other devices
// ---------------------------------------------------------------------------

async fn listen(mesh: Arc<Mesh>, app: tauri::AppHandle, port: u16) {
    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[mesh] cannot bind port {port}: {e} — this device can't be reached");
            return;
        }
    };
    println!("[mesh] listening on 0.0.0.0:{port}");
    loop {
        let Ok((stream, from)) = listener.accept().await else {
            continue;
        };
        // Note anything reaching us from off the LAN before doing any work with
        // it. Unauthenticated scans count: they're evidence the port is open to
        // the internet, which is exactly what the user needs telling.
        let class = classify(from.ip());
        if class == "public" {
            let mut slot = mesh.exposure.lock().await;
            let count = slot.as_ref().map(|e| e.count).unwrap_or(0) + 1;
            let authenticated = slot.as_ref().is_some_and(|e| e.authenticated);
            *slot = Some(Exposure {
                from: from.ip().to_string(),
                class: class.to_string(),
                at: now(),
                count,
                authenticated,
            });
            eprintln!("[mesh] connection from a public address ({}) — the port is reachable from the internet", from.ip());
        }
        let mesh = mesh.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = serve_one(mesh, app, stream).await {
                eprintln!("[mesh] request from {from} failed: {e}");
            }
        });
    }
}

async fn serve_one(
    mesh: Arc<Mesh>,
    app: tauri::AppHandle,
    stream: tokio::net::TcpStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use futures_util::{SinkExt, StreamExt};

    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (mut write, mut read) = ws.split();

    let nonce = random_hex(16);
    let (my_id, my_name) = {
        let ident = mesh.identity.lock().await;
        (ident.id.clone(), ident.name.clone())
    };
    write
        .send(Message::Text(
            json!({ "t": "hello", "v": PROTOCOL, "nonce": nonce, "id": my_id, "name": my_name })
                .to_string(),
        ))
        .await?;

    // One auth-plus-request frame, or we're done. The timeout stops a connection
    // that opens and says nothing from holding a task forever.
    let frame = tokio::time::timeout(std::time::Duration::from_secs(20), read.next()).await;
    let Ok(Some(Ok(Message::Text(text)))) = frame else {
        return Ok(());
    };
    let msg: Value = serde_json::from_str(&text)?;

    let reply = match authorize(&mesh, &nonce, &msg).await {
        // An auth failure is answered in the clear: there is no shared key to
        // seal with, and the strings are deliberately generic anyway.
        Err(err) => json!({ "t": "err", "error": err }),
        Ok(Authorized { peer_id, peer_name, issued, key }) => {
            let opened = msg
                .get("body")
                .ok_or_else(|| "malformed request".to_string())
                .and_then(|b| open_sealed(&key, b))
                .and_then(|pt| {
                    serde_json::from_slice::<Value>(&pt).map_err(|_| "malformed request".to_string())
                });

            match opened {
                Err(e) => json!({ "t": "err", "error": e }),
                Ok(req) => {
                    let method = req
                        .get("method")
                        .and_then(Value::as_str)
                        .unwrap_or("ping")
                        .to_string();
                    let params = req.get("params").cloned().unwrap_or(Value::Null);

                    match dispatch(&mesh, &app, &peer_id, &peer_name, &method, params).await {
                        Ok(result) => {
                            let mut inner = json!({ "result": result });
                            // The freshly minted token goes back only on the
                            // pairing call — and inside the sealed body. It used
                            // to ride in the clear, which handed anyone watching
                            // the long-term credential for this device.
                            if let Some(token) = issued {
                                inner["token"] = json!(token);
                            }
                            match seal(&key, inner.to_string().as_bytes()) {
                                Ok(body) => {
                                    json!({ "t": "ok", "id": my_id, "name": my_name, "body": body })
                                }
                                Err(e) => json!({ "t": "err", "error": e }),
                            }
                        }
                        Err(e) => json!({ "t": "err", "error": e }),
                    }
                }
            }
        }
    };

    write.send(Message::Text(reply.to_string())).await?;
    let _ = write.close().await;
    Ok(())
}

struct Authorized {
    peer_id: String,
    peer_name: String,
    /// Some(token) when this call just paired the peer.
    issued: Option<String>,
    /// Body key for this connection, derived from whichever secret authenticated
    /// the caller. Carried out of `authorize` because that is the only place
    /// that knows which secret was used — the pairing code or the peer's token.
    key: [u8; 32],
}

/// Check the caller's proof, and on a pairing call mint and store their token.
async fn authorize(mesh: &Arc<Mesh>, nonce: &str, msg: &Value) -> Result<Authorized, String> {
    let peer_id = msg
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let peer_name = msg
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Unnamed device")
        .to_string();
    let given = msg.get("proof").and_then(Value::as_str).unwrap_or_default();
    let mode = msg.get("mode").and_then(Value::as_str).unwrap_or("token");

    if peer_id.is_empty() || given.is_empty() {
        return Err("malformed handshake".into());
    }

    if mode == "pair" {
        let code = {
            let armed = mesh.arming.lock().await;
            match armed.as_ref() {
                Some(a) if a.expires > now() => a.code.clone(),
                Some(_) => return Err("that pairing code has expired — start pairing again".into()),
                None => {
                    return Err(
                        "this device isn't accepting new pairings. Open Settings › Devices on it and press Pair."
                            .into(),
                    )
                }
            }
        };
        if !same_secret(&proof(nonce, &code), given) {
            return Err("that pairing code is wrong".into());
        }
        // The code is a short thing a human retypes; the token that replaces it
        // is full strength and never shown.
        let token = random_hex(32);
        let mut peers = mesh.peers.lock().await;
        let entry = peers.entry(peer_id.clone()).or_insert_with(|| Peer {
            id: peer_id.clone(),
            name: peer_name.clone(),
            addr: String::new(),
            token: None,
            seen: 0,
            capabilities: Value::Null,
        });
        entry.name = peer_name.clone();
        entry.token = Some(token.clone());
        entry.seen = now();
        // One code, one device: consume it so a code seen over someone's
        // shoulder can't be used twice.
        *mesh.arming.lock().await = None;
        // Keyed on the pairing code, which is the only secret both ends share at
        // this point. It is short and human-typed, so this leg is the weakest
        // link in the chain — but it is one connection, it carries a `ping`, and
        // the full-strength token it returns is sealed rather than sent bare.
        return Ok(Authorized { peer_id, peer_name, issued: Some(token), key: body_key(nonce, &code) });
    }

    let known = {
        let peers = mesh.peers.lock().await;
        peers.get(&peer_id).and_then(|p| p.token.clone())
    };
    let Some(token) = known else {
        return Err("this device doesn't know you — pair first".into());
    };
    if !same_secret(&proof(nonce, &token), given) {
        return Err("authentication failed".into());
    }
    if let Some(p) = mesh.peers.lock().await.get_mut(&peer_id) {
        p.seen = now();
        p.name = peer_name.clone();
    }
    // A paired device calling in over the internet is a weaker warning than an
    // anonymous one — the bodies are sealed either way now. What the warning is
    // about is the port being reachable from the internet at all, plus the lack
    // of forward secrecy and host authentication. The UI distinguishes.
    if let Some(e) = mesh.exposure.lock().await.as_mut() {
        if e.at + 5 >= now() {
            e.authenticated = true;
        }
    }
    Ok(Authorized { peer_id, peer_name, issued: None, key: body_key(nonce, &token) })
}

/// Answer a peer's request.
///
/// `ping` is handled here because liveness shouldn't depend on the window being
/// open. Everything else goes to the frontend, which owns the user's sharing
/// rules — Rust deliberately has no idea what a "tool" is.
async fn dispatch(
    mesh: &Arc<Mesh>,
    app: &tauri::AppHandle,
    peer_id: &str,
    peer_name: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    if method == "ping" {
        let ident = mesh.identity.lock().await;
        return Ok(json!({ "pong": true, "id": ident.id, "name": ident.name, "at": now() }));
    }

    let rid = mesh.next_rid.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, rx) = oneshot::channel();
    mesh.inbox.lock().await.insert(rid, tx);

    app.emit(
        "mesh-request",
        json!({ "rid": rid, "peerId": peer_id, "peerName": peer_name, "method": method, "params": params }),
    )
    .map_err(|e| e.to_string())?;

    let answer = tokio::time::timeout(
        std::time::Duration::from_secs(HANDLER_TIMEOUT_SECS),
        rx,
    )
    .await;
    mesh.inbox.lock().await.remove(&rid);

    match answer {
        Ok(Ok(v)) => {
            if let Some(err) = v.get("error").and_then(Value::as_str) {
                Err(err.to_string())
            } else {
                Ok(v.get("result").cloned().unwrap_or(Value::Null))
            }
        }
        // No window open, or the frontend never replied.
        Ok(Err(_)) => Err("that device didn't answer — its window may be closed".into()),
        Err(_) => Err(format!("that device took longer than {HANDLER_TIMEOUT_SECS}s to answer")),
    }
}

// ---------------------------------------------------------------------------
// Client: calling another device
// ---------------------------------------------------------------------------

/// Open a connection, authenticate, send one request, return the reply.
async fn request(
    mesh: &Arc<Mesh>,
    addr: &str,
    secret: &str,
    mode: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    use futures_util::{SinkExt, StreamExt};

    let url = format!("ws://{addr}/");
    let connect = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio_tungstenite::connect_async(&url),
    )
    .await
    .map_err(|_| format!("{addr} didn't answer — is HarnessStation running and the mesh on?"))?;
    let (ws, _) = connect.map_err(|e| format!("could not reach {addr}: {e}"))?;
    let (mut write, mut read) = ws.split();

    // The server speaks first, with the nonce we have to prove against.
    let hello = tokio::time::timeout(std::time::Duration::from_secs(10), read.next())
        .await
        .map_err(|_| "the other device stopped responding during the handshake".to_string())?;
    let Some(Ok(Message::Text(text))) = hello else {
        return Err("the other device closed the connection".into());
    };
    let hello: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let nonce = hello
        .get("nonce")
        .and_then(Value::as_str)
        .ok_or("that isn't a HarnessStation device")?;
    if hello.get("v").and_then(Value::as_u64) != Some(PROTOCOL as u64) {
        return Err("that device runs a different mesh version — update both".into());
    }

    let (my_id, my_name) = {
        let ident = mesh.identity.lock().await;
        (ident.id.clone(), ident.name.clone())
    };
    // Everything outside `body` is what the server needs before it can derive a
    // key: who is calling, and the proof that they hold the secret. The method
    // and its arguments are sealed.
    let key = body_key(nonce, secret);
    let body = seal(&key, json!({ "method": method, "params": params }).to_string().as_bytes())?;
    let payload = json!({
        "t": "auth",
        "v": PROTOCOL,
        "id": my_id,
        "name": my_name,
        "mode": mode,
        "proof": proof(nonce, secret),
        "body": body,
    });
    write
        .send(Message::Text(payload.to_string()))
        .await
        .map_err(|e| e.to_string())?;

    let reply = tokio::time::timeout(
        std::time::Duration::from_secs(CALL_TIMEOUT_SECS),
        read.next(),
    )
    .await
    .map_err(|_| format!("no reply within {CALL_TIMEOUT_SECS}s"))?;
    let Some(Ok(Message::Text(text))) = reply else {
        return Err("the other device closed the connection without replying".into());
    };
    let reply: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    if reply.get("t").and_then(Value::as_str) == Some("err") {
        return Err(reply
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("that device refused the request")
            .to_string());
    }

    // Unseal and fold `result` / `token` back to the top level, so callers see
    // the same shape they always did and encryption stays a transport concern.
    let sealed = reply.get("body").ok_or("that device sent an unreadable reply")?;
    let inner: Value = serde_json::from_slice(&open_sealed(&key, sealed)?)
        .map_err(|_| "that device sent an unreadable reply".to_string())?;
    let mut out = reply;
    out["result"] = inner.get("result").cloned().unwrap_or(Value::Null);
    if let Some(token) = inner.get("token") {
        out["token"] = token.clone();
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Start the mesh: bind the listener and begin announcing on the LAN.
///
/// `peers` re-seeds devices the frontend has persisted, so a restart doesn't
/// mean pairing everything again.
#[tauri::command]
pub async fn mesh_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mesh>>,
    id: String,
    name: String,
    port: Option<u16>,
    peers: Option<Vec<Peer>>,
) -> Result<Value, String> {
    let mesh = state.inner().clone();
    if mesh.running.swap(true, Ordering::SeqCst) {
        return mesh_status_inner(&mesh).await;
    }
    {
        let mut ident = mesh.identity.lock().await;
        ident.id = id;
        ident.name = name;
    }
    if let Some(list) = peers {
        let mut map = mesh.peers.lock().await;
        for p in list {
            map.insert(p.id.clone(), p);
        }
    }

    let port = port.unwrap_or(MESH_PORT);
    let mut tasks = mesh.tasks.lock().await;
    tasks.push(tauri::async_runtime::spawn(listen(mesh.clone(), app, port)));
    tasks.push(tauri::async_runtime::spawn(discovery(mesh.clone(), port)));
    drop(tasks);

    mesh_status_inner(&mesh).await
}

#[tauri::command]
pub async fn mesh_stop(state: tauri::State<'_, Arc<Mesh>>) -> Result<(), String> {
    let mesh = state.inner().clone();
    mesh.running.store(false, Ordering::SeqCst);
    for task in mesh.tasks.lock().await.drain(..) {
        task.abort();
    }
    *mesh.arming.lock().await = None;
    *mesh.exposure.lock().await = None;
    Ok(())
}

async fn mesh_status_inner(mesh: &Arc<Mesh>) -> Result<Value, String> {
    let ident = mesh.identity.lock().await;
    let peers = mesh.peers.lock().await;
    let cutoff = now().saturating_sub(STALE_SECS);
    let mut list: Vec<Value> = peers
        .values()
        .map(|p| {
            json!({
                "id": p.id,
                "name": p.name,
                "addr": p.addr,
                "paired": p.paired(),
                "exposure": p.addr.rsplit_once(':').map(|(h, _)| h.to_string())
                    .and_then(|h| h.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
                    .map(classify)
                    .unwrap_or("unknown"),
                "online": p.seen >= cutoff,
                "seen": p.seen,
                "capabilities": p.capabilities,
            })
        })
        .collect();
    // Paired devices first, then most recently seen — the order the user cares about.
    list.sort_by(|a, b| {
        let key = |v: &Value| {
            (
                !v["paired"].as_bool().unwrap_or(false),
                std::cmp::Reverse(v["seen"].as_u64().unwrap_or(0)),
            )
        };
        key(a).cmp(&key(b))
    });
    Ok(json!({
        "running": mesh.running.load(Ordering::SeqCst),
        "id": ident.id,
        "name": ident.name,
        "port": MESH_PORT,
        "discoveryPort": DISCOVERY_PORT,
        "pairing": mesh.arming.lock().await.as_ref().map(|a| json!({ "expires": a.expires })),
        "exposure": mesh.exposure.lock().await.clone(),
        "peers": list,
    }))
}

#[tauri::command]
pub async fn mesh_status(state: tauri::State<'_, Arc<Mesh>>) -> Result<Value, String> {
    mesh_status_inner(&state.inner().clone()).await
}

/// Accept one incoming pairing for the next `seconds`, using this code.
#[tauri::command]
pub async fn mesh_arm_pairing(
    state: tauri::State<'_, Arc<Mesh>>,
    code: String,
    seconds: Option<u64>,
) -> Result<Value, String> {
    let mesh = state.inner().clone();
    if code.trim().len() < 6 {
        return Err("a pairing code needs at least 6 characters".into());
    }
    let expires = now() + seconds.unwrap_or(300);
    *mesh.arming.lock().await = Some(Arming { code: code.trim().to_string(), expires });
    Ok(json!({ "expires": expires }))
}

#[tauri::command]
pub async fn mesh_disarm_pairing(state: tauri::State<'_, Arc<Mesh>>) -> Result<(), String> {
    *state.inner().arming.lock().await = None;
    Ok(())
}

/// Pair with a device: prove the code, receive a long-lived token, remember it.
#[tauri::command]
pub async fn mesh_pair(
    state: tauri::State<'_, Arc<Mesh>>,
    addr: String,
    code: String,
) -> Result<Value, String> {
    let mesh = state.inner().clone();
    let addr = normalize_addr(&addr);
    let reply = request(&mesh, &addr, code.trim(), "pair", "ping", Value::Null).await?;

    let token = reply
        .get("token")
        .and_then(Value::as_str)
        .ok_or("that device paired but sent no token — versions may differ")?
        .to_string();
    let id = reply
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let name = reply
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Unnamed device")
        .to_string();
    if id.is_empty() {
        return Err("that device didn't identify itself".into());
    }

    let peer = Peer {
        id: id.clone(),
        name,
        addr,
        token: Some(token),
        seen: now(),
        capabilities: Value::Null,
    };
    mesh.peers.lock().await.insert(id, peer.clone());
    Ok(serde_json::to_value(peer).unwrap_or(Value::Null))
}

/// Call a paired device.
#[tauri::command]
pub async fn mesh_call(
    state: tauri::State<'_, Arc<Mesh>>,
    peer_id: String,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let mesh = state.inner().clone();
    let (addr, token) = {
        let peers = mesh.peers.lock().await;
        let peer = peers
            .get(&peer_id)
            .ok_or("no such device — it may have been forgotten")?;
        let token = peer
            .token
            .clone()
            .ok_or("that device isn't paired yet")?;
        (peer.addr.clone(), token)
    };
    if addr.is_empty() {
        return Err("that device has no address yet — it paired with us but we've never reached it. Wait for it to appear on the network, or add it by address.".into());
    }

    let reply = request(
        &mesh,
        &addr,
        &token,
        "token",
        &method,
        params.unwrap_or(Value::Null),
    )
    .await?;
    let result = reply.get("result").cloned().unwrap_or(Value::Null);

    let mut peers = mesh.peers.lock().await;
    if let Some(p) = peers.get_mut(&peer_id) {
        p.seen = now();
        // `describe` is the one call whose answer is worth caching: the UI wants
        // to show what a device offers without asking every time it repaints.
        if method == "describe" {
            p.capabilities = result.clone();
        }
    }
    Ok(result)
}

/// Add a device by address — for machines off the LAN, over a VPN or a tunnel.
#[tauri::command]
pub async fn mesh_add_peer(
    state: tauri::State<'_, Arc<Mesh>>,
    addr: String,
    name: Option<String>,
) -> Result<Value, String> {
    let mesh = state.inner().clone();
    let addr = normalize_addr(&addr);
    // Ask who's there before storing anything, so a typo fails now rather than
    // sitting in the list looking real. Unpaired, so this is refused unless the
    // other end is armed — which is exactly when the user is trying to pair.
    let id = format!("addr:{addr}");
    let mut peers = mesh.peers.lock().await;
    peers.entry(id.clone()).or_insert_with(|| Peer {
        id: id.clone(),
        name: name.unwrap_or_else(|| addr.clone()),
        addr: addr.clone(),
        token: None,
        seen: 0,
        capabilities: Value::Null,
    });
    Ok(json!({ "id": id, "addr": addr }))
}

#[tauri::command]
pub async fn mesh_forget(
    state: tauri::State<'_, Arc<Mesh>>,
    peer_id: String,
) -> Result<(), String> {
    state.inner().peers.lock().await.remove(&peer_id);
    Ok(())
}

/// The frontend's answer to a `mesh-request` event.
#[tauri::command]
pub async fn mesh_reply(
    state: tauri::State<'_, Arc<Mesh>>,
    rid: u64,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    let mesh = state.inner().clone();
    let Some(tx) = mesh.inbox.lock().await.remove(&rid) else {
        // The caller gave up already; nothing to do.
        return Ok(());
    };
    let payload = match error {
        Some(e) => json!({ "error": e }),
        None => json!({ "result": result.unwrap_or(Value::Null) }),
    };
    let _ = tx.send(payload);
    Ok(())
}

/// Everything the frontend persists, so peers survive a restart.
#[tauri::command]
pub async fn mesh_export_peers(state: tauri::State<'_, Arc<Mesh>>) -> Result<Vec<Peer>, String> {
    Ok(state.inner().peers.lock().await.values().cloned().collect())
}

/// `host` → `host:8793`; anything with a port or scheme is left alone.
fn normalize_addr(input: &str) -> String {
    let s = input.trim().trim_end_matches('/');
    let s = s
        .strip_prefix("ws://")
        .or_else(|| s.strip_prefix("http://"))
        .unwrap_or(s);
    // An IPv6 literal is already bracketed, and a bare one has no port to add.
    if s.contains(']') || s.rsplit(':').next().is_some_and(|p| p.parse::<u16>().is_ok()) {
        s.to_string()
    } else {
        format!("{s}:{MESH_PORT}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proof_is_stable_and_secret_dependent() {
        let a = proof("nonce", "secret");
        assert_eq!(a, proof("nonce", "secret"));
        assert_ne!(a, proof("nonce", "other"));
        assert_ne!(a, proof("other-nonce", "secret"));
        // The secret must not be recoverable by inspection.
        assert!(!a.contains("secret"));
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn body_key_is_distinct_from_the_proof_that_travels() {
        // The proof goes out on the wire. If it shared a derivation with the body
        // key, a listener would be holding a hash of the key.
        let key_hex: String = body_key("nonce", "secret").iter().map(|b| format!("{b:02x}")).collect();
        assert_ne!(key_hex, proof("nonce", "secret"));
    }

    #[test]
    fn body_key_changes_with_both_nonce_and_secret() {
        // Per-connection nonce means a key recovered from one call is useless on
        // the next; the secret half is what makes it a shared key at all.
        assert_ne!(body_key("a", "s"), body_key("b", "s"));
        assert_ne!(body_key("a", "s"), body_key("a", "t"));
        assert_eq!(body_key("a", "s"), body_key("a", "s"));
    }

    #[test]
    fn a_sealed_body_round_trips() {
        let k = body_key("nonce", "token");
        let sealed = seal(&k, br#"{"method":"ping"}"#).unwrap();
        assert_eq!(open_sealed(&k, &sealed).unwrap(), br#"{"method":"ping"}"#);
    }

    #[test]
    fn the_plaintext_is_not_visible_in_the_envelope() {
        // The regression this whole change exists to prevent: tool names and
        // arguments used to travel as readable JSON.
        let k = body_key("nonce", "token");
        let secret_arg = "transfer-all-my-money";
        let sealed = seal(&k, format!(r#"{{"params":"{secret_arg}"}}"#).as_bytes()).unwrap();
        assert!(!sealed.to_string().contains(secret_arg));
        assert!(!sealed.to_string().contains("params"));
    }

    #[test]
    fn the_wrong_secret_cannot_open_a_body() {
        let sealed = seal(&body_key("nonce", "token"), b"hello").unwrap();
        assert!(open_sealed(&body_key("nonce", "wrong-token"), &sealed).is_err());
        // Right secret, different connection: also no.
        assert!(open_sealed(&body_key("other-nonce", "token"), &sealed).is_err());
    }

    #[test]
    fn tampering_is_detected_rather_than_decrypted() {
        // AEAD, not a raw stream cipher: a flipped byte must fail to open, not
        // decrypt to something the dispatcher would then act on.
        let k = body_key("nonce", "token");
        let sealed = seal(&k, br#"{"method":"ping"}"#).unwrap();
        let ct = sealed.get("ct").and_then(Value::as_str).unwrap().to_string();
        let mut bytes = ct.into_bytes();
        let mid = bytes.len() / 2;
        bytes[mid] = if bytes[mid] == b'A' { b'B' } else { b'A' };
        let tampered = json!({ "n": sealed.get("n").unwrap(), "ct": String::from_utf8(bytes).unwrap() });
        assert!(open_sealed(&k, &tampered).is_err());
    }

    #[test]
    fn two_seals_of_the_same_text_differ() {
        // Fresh nonce per message, so identical calls aren't linkable by
        // ciphertext equality.
        let k = body_key("nonce", "token");
        let a = seal(&k, b"same").unwrap();
        let b = seal(&k, b"same").unwrap();
        assert_ne!(a.get("ct"), b.get("ct"));
        assert_eq!(open_sealed(&k, &a).unwrap(), open_sealed(&k, &b).unwrap());
    }

    #[test]
    fn a_malformed_envelope_is_rejected_without_panicking() {
        let k = body_key("nonce", "token");
        assert!(open_sealed(&k, &json!({})).is_err());
        assert!(open_sealed(&k, &json!({ "n": "!!!", "ct": "!!!" })).is_err());
        // Right shape, wrong nonce length.
        assert!(open_sealed(&k, &json!({ "n": "AAAA", "ct": "AAAA" })).is_err());
    }

    #[test]
    fn secret_comparison_rejects_near_misses() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
    }

    #[test]
    fn addresses_are_classified_by_how_exposed_they_are() {
        let c = |s: &str| classify(s.parse::<std::net::IpAddr>().unwrap());
        assert_eq!(c("127.0.0.1"), "loopback");
        assert_eq!(c("192.168.1.20"), "private");
        assert_eq!(c("10.4.4.4"), "private");
        assert_eq!(c("172.16.0.9"), "private");
        assert_eq!(c("172.32.0.9"), "public"); // just outside the private block
        assert_eq!(c("169.254.7.7"), "private");
        assert_eq!(c("100.101.102.103"), "vpn"); // Tailscale's range
        assert_eq!(c("100.128.0.1"), "public"); // just outside it
        assert_eq!(c("8.8.8.8"), "public");
        assert_eq!(c("::1"), "loopback");
        assert_eq!(c("fe80::1"), "private");
        assert_eq!(c("fd00::1"), "private");
        assert_eq!(c("2606:4700::1111"), "public");
        // A dual-stack listener reports IPv4 peers mapped into v6; reading the
        // raw form would call every machine on the LAN a public one.
        assert_eq!(c("::ffff:192.168.1.20"), "private");
        assert_eq!(c("::ffff:8.8.8.8"), "public");
    }

    #[test]
    fn addresses_get_the_default_port() {
        assert_eq!(normalize_addr("192.168.1.5"), "192.168.1.5:8793");
        assert_eq!(normalize_addr("192.168.1.5:9000"), "192.168.1.5:9000");
        assert_eq!(normalize_addr("ws://box.local/"), "box.local:8793");
        assert_eq!(normalize_addr(" desk "), "desk:8793");
        // A hostname with a dotted suffix must not be mistaken for a port.
        assert_eq!(normalize_addr("desk.lan"), "desk.lan:8793");
    }
}
