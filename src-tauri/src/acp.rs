//! Relay for ACP (Agent Client Protocol) agents: newline-delimited JSON-RPC
//! over a child process's stdio.
//!
//! Unlike `claudecode.rs`, several agents may run at once, so children live in
//! a map keyed by a caller-chosen `id`, and every event echoes that id so the
//! frontend can route lines to the right session.
//!
//! Rust is a dumb pipe here exactly as in `claudecode.rs` and `localapi.rs`:
//! every stdout line is forwarded verbatim as an `acp-event`, and nothing in
//! this module parses ACP semantics. The JSON-RPC conversation — initialize,
//! session/new, session/update, permission requests — lives entirely in
//! `src/lib/acp.ts`, because the protocol changes on its own release schedule
//! and a Rust struct per message type would need a release of this app to
//! keep up.
//!
//! Exit handling has one twist: the reader thread notices death as stdout EOF
//! and drops the map entry, but guards that removal with `try_wait` — if a
//! respawn already put a fresh child under the same id, that child's
//! `try_wait` still reports alive and the stale reader leaves it alone.
//! Commands also reap dead entries themselves (the same pattern as
//! `claude_status`), which covers a child that died while a grandchild kept
//! its stdout open — in that case EOF never arrives and no exit event fires.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
}

pub struct AcpChild {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct AcpState(pub Mutex<HashMap<String, AcpChild>>);

/// Overlay the agent's requested env onto a snapshot of our environment.
///
/// Pure and separate from spawning so the merge rules can be tested without a
/// process. Later writes win per key; an empty variable name is dropped rather
/// than handed to `Command::envs`, which rejects it. Case conflicts (e.g.
/// `Path` vs `PATH`) are left to the OS: Windows folds them itself when it
/// builds the child's environment block.
pub(crate) fn merge_env(
    base: &HashMap<String, String>,
    extra: &HashMap<String, String>,
) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> =
        base.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    for (k, v) in extra {
        if k.is_empty() {
            continue;
        }
        env.retain(|(ek, _)| ek != k);
        env.push((k.clone(), v.clone()));
    }
    env
}

/// Kill one child, dropping its stdin first so a well-behaved agent sees EOF
/// and can shut down before the kill lands (same reasoning as claudecode's
/// `stop_inner`).
fn stop_child(mut c: AcpChild) {
    drop(c.stdin);
    let _ = c.child.kill();
    let _ = c.child.wait();
}

/// A stdout line longer than this is treated as a runaway agent (a debug dump
/// that lost its newlines), not a frame: it is dropped and logged rather than
/// being accumulated into memory without bound. Real ACP frames are kilobytes.
const MAX_LINE: usize = 16 * 1024 * 1024;

/// Start an agent under `id`. Replaces any child already running under it.
#[tauri::command]
pub fn acp_spawn(
    app: AppHandle,
    state: State<AcpState>,
    id: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
) -> Result<(), String> {
    // Replace, not race: a second spawn for a live id kills the first child.
    if let Some(old) = state.0.lock().unwrap().remove(&id) {
        stop_child(old);
    }

    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd.envs(merge_env(&std::env::vars().collect(), &env));
    no_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start `{command}`: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout on the agent process")?;
    let stderr = child.stderr.take().ok_or("no stderr on the agent process")?;
    let stdin = child.stdin.take().ok_or("no stdin on the agent process")?;

    // stdout: one JSON-RPC frame per line, forwarded verbatim. Read with a
    // length cap — `BufRead::lines` would accumulate an unbounded line, and a
    // runaway agent must not take this app's memory with it.
    let a = app.clone();
    let rid = id.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break, // EOF
                Ok(_) => {
                    while buf.last() == Some(&b'\n') || buf.last() == Some(&b'\r') {
                        buf.pop();
                    }
                    if buf.len() > MAX_LINE {
                        let dropped = buf.len();
                        buf.clear();
                        eprintln!("[acp {rid}] dropped an oversized frame ({dropped} bytes)");
                        continue;
                    }
                    let line = String::from_utf8_lossy(&buf);
                    if line.trim().is_empty() {
                        continue;
                    }
                    let _ = a.emit("acp-event", json!({ "id": rid, "line": line }));
                }
                Err(_) => break,
            }
        }
        // EOF means the child is gone (or closed stdout). Announce it, then
        // remove the entry unless a respawn replaced it meanwhile — try_wait
        // tells us whose death this actually was. See module docs.
        let _ = a.emit("acp-exit", json!({ "id": rid }));
        let state: State<AcpState> = tauri::Manager::state(&a);
        let mut map = state.0.lock().unwrap();
        let dead = match map.get_mut(&rid) {
            Some(c) => matches!(c.child.try_wait(), Ok(Some(_))),
            None => false,
        };
        if dead {
            map.remove(&rid);
        }
    });

    // stderr: not part of the protocol — usage errors and crash traces land
    // there. Logged, never forwarded; ACP frames travel on stdout only.
    let aid = id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            eprintln!("[acp {aid}] {line}");
        }
    });

    state.0.lock().unwrap().insert(id, AcpChild { child, stdin });
    Ok(())
}

/// Write one JSON-RPC frame to the agent's stdin.
#[tauri::command]
pub fn acp_write(state: State<AcpState>, id: String, line: String) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    let Some(c) = map.get_mut(&id) else {
        return Err(format!("no such agent: {id}"));
    };
    // An entry whose process already exited is as good as absent — otherwise a
    // write to a just-died agent surfaces as a pipe error instead of the truth.
    if !matches!(c.child.try_wait(), Ok(None)) {
        map.remove(&id);
        return Err(format!("no such agent: {id}"));
    }
    c.stdin
        .write_all(format!("{line}\n").as_bytes())
        .and_then(|_| c.stdin.flush())
        .map_err(|e| format!("could not write to agent {id}: {e}"))
}

/// Kill the agent registered under `id`. Ok when there is none.
#[tauri::command]
pub fn acp_kill(state: State<AcpState>, id: String) -> Result<(), String> {
    if let Some(c) = state.0.lock().unwrap().remove(&id) {
        stop_child(c);
    }
    Ok(())
}

/// Whether a live child is running under `id`.
#[tauri::command]
pub fn acp_running(state: State<AcpState>, id: String) -> bool {
    let mut map = state.0.lock().unwrap();
    let live = match map.get_mut(&id) {
        // try_wait is Some(_) once the process has exited; without this a child
        // that died on its own would still report as running.
        Some(c) => matches!(c.child.try_wait(), Ok(None)),
        None => false,
    };
    if !live {
        map.remove(&id);
    }
    live
}

/// Kill every agent on app exit, mirroring `claudecode::kill_on_exit`.
pub fn kill_on_exit(app: &AppHandle) {
    let state: State<AcpState> = tauri::Manager::state(app);
    let mut map = state.0.lock().unwrap();
    for (_, c) in map.drain() {
        stop_child(c);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn lookup<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
        env.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    #[test]
    fn extra_env_overrides_keys_and_keeps_the_rest() {
        let merged = merge_env(
            &env(&[("PATH", "/usr/bin"), ("LANG", "en_GB.UTF-8")]),
            &env(&[("ANTHROPIC_API_KEY", "sk-test"), ("LANG", "en_US.UTF-8")]),
        );
        assert_eq!(lookup(&merged, "PATH"), Some("/usr/bin"));
        assert_eq!(lookup(&merged, "LANG"), Some("en_US.UTF-8"));
        assert_eq!(lookup(&merged, "ANTHROPIC_API_KEY"), Some("sk-test"));
        assert_eq!(merged.len(), 3, "an overridden key must not appear twice");
    }

    #[test]
    fn an_empty_variable_name_is_dropped_not_passed_through() {
        // Command::envs rejects empty names; ignoring them at merge time beats
        // failing a whole spawn over one malformed config row.
        let merged = merge_env(&HashMap::new(), &env(&[("", "x"), ("K", "v")]));
        assert_eq!(merged.len(), 1);
        assert_eq!(lookup(&merged, "K"), Some("v"));
    }

    #[test]
    fn merging_an_empty_overlay_leaves_the_base_alone() {
        let base = env(&[("A", "1"), ("B", "2")]);
        let merged = merge_env(&base, &HashMap::new());
        assert_eq!(lookup(&merged, "A"), Some("1"));
        assert_eq!(lookup(&merged, "B"), Some("2"));
        assert_eq!(merged.len(), 2);
    }
}
