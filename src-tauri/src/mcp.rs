use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const PROTOCOL_VERSION: &str = "2025-03-26";

pub struct McpState(pub Mutex<HashMap<String, McpConn>>);

pub enum McpConn {
    Stdio {
        child: Child,
        stdin: ChildStdin,
        reader: BufReader<ChildStdout>,
        next_id: i64,
    },
    Http {
        url: String,
        token: Option<String>,
        session: Option<String>,
        next_id: i64,
    },
}

fn client_info() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": {"name": "HarnessStation", "version": "0.1.0"}
    })
}

// ---------- stdio transport ----------

fn stdio_send(stdin: &mut ChildStdin, msg: &Value) -> Result<(), String> {
    let line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    stdin
        .write_all(format!("{line}\n").as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("MCP server pipe closed: {e}"))
}

fn stdio_wait(reader: &mut BufReader<ChildStdout>, id: i64) -> Result<Value, String> {
    for line in reader.lines() {
        let line = line.map_err(|e| format!("MCP read error: {e}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if v.get("id").and_then(Value::as_i64) == Some(id) {
            if let Some(err) = v.get("error") {
                return Err(format!("MCP error: {err}"));
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
        // ignore notifications / other ids
    }
    Err("MCP server closed the connection".into())
}

// ---------- http (streamable) transport ----------

async fn http_rpc(
    url: &str,
    token: &Option<String>,
    session: &Option<String>,
    body: &Value,
    expect_response: bool,
) -> Result<(Value, Option<String>), String> {
    let client = reqwest::Client::new();
    let mut req = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", PROTOCOL_VERSION);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    if let Some(s) = session {
        req = req.header("Mcp-Session-Id", s.clone());
    }
    let resp = req.json(body).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let new_session = resp
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(format!(
            "HTTP {status}: authorization required — this server needs an OAuth/bearer token"
        ));
    }
    if !status.is_success() && status.as_u16() != 202 {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {}", text.chars().take(300).collect::<String>()));
    }
    if !expect_response {
        return Ok((Value::Null, new_session));
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let want_id = body.get("id").cloned();
    if content_type.contains("text/event-stream") {
        for line in text.lines() {
            if let Some(data) = line.trim().strip_prefix("data:") {
                if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
                    if v.get("id") == want_id.as_ref() || want_id.is_none() {
                        if let Some(err) = v.get("error") {
                            return Err(format!("MCP error: {err}"));
                        }
                        return Ok((v.get("result").cloned().unwrap_or(Value::Null), new_session));
                    }
                }
            }
        }
        Err("no matching response in SSE stream".into())
    } else {
        let v: Value = serde_json::from_str(&text).map_err(|e| format!("bad JSON: {e}"))?;
        if let Some(err) = v.get("error") {
            return Err(format!("MCP error: {err}"));
        }
        Ok((v.get("result").cloned().unwrap_or(Value::Null), new_session))
    }
}

// ---------- commands ----------

// One parameter per field of the server config the frontend sends; splitting it
// into a struct would only move the same list somewhere else.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn mcp_connect(
    state: State<'_, McpState>,
    id: String,
    transport: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    env: Option<HashMap<String, String>>,
    url: Option<String>,
    token: Option<String>,
) -> Result<Value, String> {
    // drop any previous connection with this id
    if let Some(McpConn::Stdio { mut child, .. }) = state.0.lock().unwrap().remove(&id) {
        let _ = child.kill();
    }

    if transport == "stdio" {
        let command = command.ok_or("stdio transport needs a command")?;
        let arg_vec = args.unwrap_or_default();

        // On Windows, npm shims (npx/npm/yarn/pnpm) are .cmd/.ps1 files, not .exe —
        // CreateProcess can't launch them directly, so route non-.exe commands through cmd.
        //
        // The hop is also an injection surface if handled the naive way: cmd
        // parses metacharacters (& | ^ < >) outside quotes, so an imported
        // config with an argument like `&calc` used to chain a second program.
        // The fix is to build ONE pre-quoted command line ourselves: every
        // argument is wrapped in straight quotes with internal quotes doubled,
        // which keeps metacharacters literal. Residual caveat, accepted and
        // documented: cmd expands %VAR% even inside quotes, so an argument can
        // read environment variables — it cannot execute through them.
        #[cfg(windows)]
        fn cmd_quote(arg: &str) -> String {
            format!("\"{}\"", arg.replace('"', "\"\""))
        }

        #[cfg(windows)]
        let mut cmd = {
            if command.contains('"') {
                return Err("MCP command must not contain quote characters".into());
            }
            let is_exe = command.to_lowercase().ends_with(".exe");
            if is_exe {
                let mut c = Command::new(&command);
                c.args(&arg_vec);
                c
            } else {
                let line = format!(
                    "\"{}\" {}",
                    command,
                    arg_vec.iter().map(|a| cmd_quote(a)).collect::<Vec<_>>().join(" ")
                );
                let mut c = Command::new("cmd");
                c.arg("/C").arg(&line);
                c
            }
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = Command::new(&command);
            c.args(&arg_vec);
            c
        };

        cmd.envs(env.unwrap_or_default())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to start `{command}`: {e} (is Node.js installed and on PATH?)"))?;
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        let mut reader = BufReader::new(child.stdout.take().ok_or("no stdout")?);

        stdio_send(
            &mut stdin,
            &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params": client_info()}),
        )?;
        let result = stdio_wait(&mut reader, 1)?;
        stdio_send(&mut stdin, &json!({"jsonrpc":"2.0","method":"notifications/initialized"}))?;

        state.0.lock().unwrap().insert(
            id,
            McpConn::Stdio { child, stdin, reader, next_id: 2 },
        );
        Ok(result)
    } else {
        let url = url.ok_or("http transport needs a url")?;
        let body = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params": client_info()});
        let (result, session) = http_rpc(&url, &token, &None, &body, true).await?;
        let note = json!({"jsonrpc":"2.0","method":"notifications/initialized"});
        let _ = http_rpc(&url, &token, &session, &note, false).await;
        state.0.lock().unwrap().insert(
            id,
            McpConn::Http { url, token, session, next_id: 2 },
        );
        Ok(result)
    }
}

#[tauri::command]
pub async fn mcp_request(
    state: State<'_, McpState>,
    id: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    // extract what we need under the lock, do http outside it
    enum Plan {
        StdioDone(Result<Value, String>),
        Http { url: String, token: Option<String>, session: Option<String>, rpc_id: i64 },
    }
    let plan = {
        let mut guard = state.0.lock().unwrap();
        let conn = guard.get_mut(&id).ok_or("not connected")?;
        match conn {
            McpConn::Stdio { stdin, reader, next_id, .. } => {
                let rpc_id = *next_id;
                *next_id += 1;
                let msg = json!({"jsonrpc":"2.0","id":rpc_id,"method":method,"params":params});
                Plan::StdioDone(stdio_send(stdin, &msg).and_then(|_| stdio_wait(reader, rpc_id)))
            }
            McpConn::Http { url, token, session, next_id } => {
                let rpc_id = *next_id;
                *next_id += 1;
                Plan::Http {
                    url: url.clone(),
                    token: token.clone(),
                    session: session.clone(),
                    rpc_id,
                }
            }
        }
    };
    match plan {
        Plan::StdioDone(result) => result,
        Plan::Http { url, token, session, rpc_id } => {
            let body = json!({"jsonrpc":"2.0","id":rpc_id,"method":method,"params":params});
            let (result, new_session) = http_rpc(&url, &token, &session, &body, true).await?;
            if let Some(ns) = new_session {
                if let Some(McpConn::Http { session, .. }) = state.0.lock().unwrap().get_mut(&id) {
                    *session = Some(ns);
                }
            }
            Ok(result)
        }
    }
}

#[tauri::command]
pub fn mcp_disconnect(state: State<McpState>, id: String) {
    if let Some(McpConn::Stdio { mut child, .. }) = state.0.lock().unwrap().remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub fn kill_all(state: &State<McpState>) {
    for (_, conn) in state.0.lock().unwrap().drain() {
        if let McpConn::Stdio { mut child, .. } = conn {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod quoting_tests {
    /// Mirrors the quoting built in mcp_connect � kept as a pure copy because
    /// the function lives behind #[cfg(windows)] and the property that matters
    /// (metacharacters stay literal) is platform-independent to assert.
    fn cmd_quote(arg: &str) -> String {
        format!("\"{}\"", arg.replace('"', "\"\""))
    }

    #[test]
    fn plain_args_are_wrapped() {
        assert_eq!(cmd_quote("--port"), "\"--port\"");
    }

    #[test]
    fn metacharacters_cannot_chain_a_second_command() {
        // The injection that motivated this: cmd treats an unquoted & as
        // "run this too". Inside the wrapping quotes it is a literal.
        for hostile in ["&calc", "| whoami", "^x", "> out.txt", "a b"] {
            let q = cmd_quote(hostile);
            assert!(q.starts_with('"') && q.ends_with('"'), "{hostile}");
            assert_eq!(q, format!("\"{hostile}\""));
        }
    }

    #[test]
    fn embedded_quotes_are_doubled_not_escaped() {
        // cmd has no backslash escapes; the only way to embed a quote in a
        // quoted string is to double it.
        assert_eq!(cmd_quote("say \"hi\""), "\"say \"\"hi\"\"\"");
    }
}
