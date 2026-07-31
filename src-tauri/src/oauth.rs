//! OAuth 2.0 (PKCE + dynamic client registration) for remote MCP servers.
//! Best-effort per the MCP auth spec: discover metadata, register a public client,
//! open the browser, capture the loopback redirect, exchange the code for a token.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::Duration;

fn origin(url: &str) -> String {
    // scheme://host[:port]
    if let Some(rest) = url.split_once("://") {
        let host = rest.1.split('/').next().unwrap_or("");
        return format!("{}://{}", rest.0, host);
    }
    url.to_string()
}

fn rand_string(len: usize) -> String {
    const CH: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..len).map(|_| CH[rng.gen_range(0..CH.len())] as char).collect()
}

async fn get_json(client: &reqwest::Client, url: &str) -> Option<Value> {
    let r = client.get(url).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    r.json().await.ok()
}

/// Run the full OAuth flow for a remote MCP `server_url`. Returns an access token.
#[tauri::command]
pub async fn mcp_oauth(server_url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let base = origin(&server_url);

    // 1. Discover the authorization server metadata.
    let meta = get_json(&client, &format!("{base}/.well-known/oauth-authorization-server"))
        .await
        .or(get_json(&client, &format!("{base}/.well-known/openid-configuration")).await)
        .ok_or("could not discover OAuth metadata (no /.well-known/oauth-authorization-server)")?;
    let authorize_ep = meta["authorization_endpoint"].as_str().ok_or("no authorization_endpoint")?.to_string();
    let token_ep = meta["token_endpoint"].as_str().ok_or("no token_endpoint")?.to_string();
    let reg_ep = meta["registration_endpoint"].as_str().map(String::from);

    // 2. Start a loopback listener for the redirect.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    // 3. Register a public client (dynamic client registration) or fall back to a static id.
    let client_id = if let Some(reg) = reg_ep {
        let body = serde_json::json!({
            "client_name": "HarnessStation",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none"
        });
        let r = client.post(&reg).json(&body).send().await.map_err(|e| e.to_string())?;
        let j: Value = r.json().await.map_err(|e| e.to_string())?;
        j["client_id"].as_str().ok_or("registration returned no client_id")?.to_string()
    } else {
        "harnessstation".to_string()
    };

    // 4. PKCE.
    let verifier = rand_string(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = rand_string(24);

    let auth_url = format!(
        "{authorize_ep}?response_type=code&client_id={}&redirect_uri={}&state={}&code_challenge={}&code_challenge_method=S256",
        urlencoding(&client_id),
        urlencoding(&redirect_uri),
        state,
        challenge
    );

    // 5. Open the browser and wait for the redirect (2 min timeout).
    let _ = open::that(&auth_url);
    listener.set_nonblocking(false).ok();
    let code = wait_for_code(&listener, &state)?;

    // 6. Exchange the code for a token.
    let params = [
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect_uri),
        ("client_id", &client_id),
        ("code_verifier", &verifier),
    ];
    let r = client.post(&token_ep).form(&params).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        let t = r.text().await.unwrap_or_default();
        return Err(format!("token exchange failed: {}", t.chars().take(300).collect::<String>()));
    }
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    j["access_token"].as_str().map(String::from).ok_or("no access_token in response".into())
}

fn wait_for_code(listener: &TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(false).ok();
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    for conn in listener.incoming() {
        if std::time::Instant::now() > deadline {
            return Err("timed out waiting for authorization".into());
        }
        let mut stream = match conn {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut reader = BufReader::new(&stream);
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        // line: "GET /callback?code=...&state=... HTTP/1.1"
        let target = line.split_whitespace().nth(1).unwrap_or("");
        let query = target.split_once('?').map(|x| x.1).unwrap_or("");
        let mut code = None;
        let mut state_ok = false;
        for kv in query.split('&') {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            match k {
                "code" => code = Some(v.to_string()),
                "state" => state_ok = v == expected_state,
                _ => {}
            }
        }
        let body = "<html><body style='font-family:sans-serif;background:#0b0d13;color:#e8eaf2;text-align:center;padding-top:20vh'><h2>Authorized</h2><p>You can close this tab and return to HarnessStation.</p></body></html>";
        let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
        let _ = stream.write_all(resp.as_bytes());
        if let Some(c) = code {
            if state_ok {
                return Ok(c);
            }
            return Err("state mismatch — possible CSRF, aborted".into());
        }
    }
    Err("authorization window closed without a code".into())
}

fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}
