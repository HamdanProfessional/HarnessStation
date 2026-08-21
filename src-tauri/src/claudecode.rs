//! Drive the `claude` CLI as a child process and relay its JSON stream.
//!
//! Claude Code speaks newline-delimited JSON in both directions when run as
//! `claude -p --input-format stream-json --output-format stream-json`. That is
//! the whole integration surface: we spawn it, write user turns to its stdin,
//! and forward every line it writes to stdout as a Tauri event.
//!
//! This module deliberately knows nothing about what the events *mean*. It does
//! not parse assistant messages, count tokens, or interpret tool calls — it
//! moves lines. Everything that understands the protocol lives in
//! `src/lib/claudeCode.ts`, for the same reason `localapi.rs` stays a dumb SSE
//! relay: the CLI's event vocabulary changes on its own release schedule, and a
//! Rust struct per event type would need a release of this app to keep up.
//!
//! One process at a time, matching `LocalServer`. A second `start` replaces the
//! first rather than racing it for stdin.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
}

pub struct ClaudeSession {
    child: Child,
    stdin: Option<ChildStdin>,
    /// Echoed back on every event so a late event from a replaced session can
    /// be told apart from one belonging to the current run.
    run_id: u64,
}

#[derive(Default)]
pub struct ClaudeCode(pub Mutex<Option<ClaudeSession>>);

/// What the frontend may configure about a run.
///
/// Everything here is optional and omitted when unset, so a default launch is
/// the CLI's own default. The fields map one-to-one onto documented flags —
/// see the table in `docs/coding-cli-wrappers.md`.
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct LaunchSpec {
    /// Working directory for the session. Empty = inherit ours.
    pub cwd: String,
    /// Model alias or full id (`--model`). Empty = the CLI's default.
    pub model: String,
    /// Effort level (`--effort`): low | medium | high | xhigh | max.
    pub effort: String,
    /// Permission mode (`--permission-mode`).
    pub permission_mode: String,
    /// Custom agents as the JSON object `--agents` expects, already stringified.
    pub agents_json: String,
    /// Directories to load as session-scoped plugins (`--plugin-dir`), which is
    /// how skills get injected — a plugin dir carries `skills/<name>/SKILL.md`.
    pub plugin_dirs: Vec<String>,
    /// Extra MCP config files or JSON strings (`--mcp-config`).
    pub mcp_configs: Vec<String>,
    /// Appended to the default system prompt (`--append-system-prompt`).
    pub append_system_prompt: String,
    /// Restrict built-in tools (`--tools`). Empty vec = leave the default set.
    pub tools: Vec<String>,
    /// Which settings files to read (`--setting-sources`), e.g. "" for none.
    ///
    /// The isolation control, and the reason it is exposed at all: without it a
    /// run picks up whatever that developer happens to have installed, so the
    /// same session behaves differently on every machine.
    ///
    /// Partial, not total. A live run with "" reset the output style and dropped
    /// the user's own agents, but Claude Code's built-in agents and bundled
    /// skills still loaded — those do not come from settings files. `safe_mode`
    /// is what removes those.
    pub setting_sources: Option<String>,
    /// Hard spend ceiling in dollars (`--max-budget-usd`).
    pub max_budget_usd: Option<f64>,
    /// Resume an existing session by id (`--resume`).
    pub resume: String,
    /// Disable *all* customization (`--safe-mode`): the user's CLAUDE.md, skills,
    /// plugins, hooks, MCP servers, custom agents and output styles.
    ///
    /// Stronger than `setting_sources: Some("")`, which only stops settings
    /// files being read — built-in agents and bundled skills still load under
    /// it, as a live run confirmed. Note this also suppresses *our* injections,
    /// so it is an inspection tool rather than the default.
    pub safe_mode: bool,
    /// Emit token-level deltas (`--include-partial-messages`).
    pub partial_messages: bool,
    /// Surface subagent output as messages (`--forward-subagent-text`).
    pub forward_subagent_text: bool,
}

/// Build the argument list for a run.
///
/// Pure and separate from spawning so the flag translation can be tested
/// without a `claude` binary present — the same reason `launch_flag_args` in
/// local.rs is split out. A wrong flag name here is a process that exits
/// immediately with a usage error, which is indistinguishable at a glance from
/// "Claude Code isn't installed".
pub(crate) fn build_args(spec: &LaunchSpec) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-p".into(),
        // --verbose is not optional with stream-json: without it the CLI
        // collapses to a single result line and every intermediate event —
        // including system/init, which is how we learn what actually loaded —
        // is dropped.
        "--verbose".into(),
        "--input-format".into(),
        "stream-json".into(),
        "--output-format".into(),
        "stream-json".into(),
    ];
    let mut push = |flag: &str, value: &str| {
        if !value.trim().is_empty() {
            a.push(flag.into());
            a.push(value.into());
        }
    };
    push("--model", &spec.model);
    push("--effort", &spec.effort);
    push("--permission-mode", &spec.permission_mode);
    push("--agents", &spec.agents_json);
    push("--append-system-prompt", &spec.append_system_prompt);
    push("--resume", &spec.resume);

    for dir in spec.plugin_dirs.iter().filter(|d| !d.trim().is_empty()) {
        a.push("--plugin-dir".into());
        a.push(dir.clone());
    }
    for cfg in spec.mcp_configs.iter().filter(|c| !c.trim().is_empty()) {
        a.push("--mcp-config".into());
        a.push(cfg.clone());
    }
    if !spec.tools.is_empty() {
        a.push("--tools".into());
        a.push(spec.tools.join(","));
    }
    // Distinguished from "unset": Some("") means *no* setting sources, which is
    // a meaningful request for an isolated session and must still emit the flag.
    if let Some(src) = spec.setting_sources.as_deref() {
        a.push("--setting-sources".into());
        a.push(src.to_string());
    }
    if let Some(b) = spec.max_budget_usd {
        a.push("--max-budget-usd".into());
        a.push(b.to_string());
    }
    if spec.safe_mode {
        a.push("--safe-mode".into());
    }
    if spec.partial_messages {
        a.push("--include-partial-messages".into());
    }
    if spec.forward_subagent_text {
        a.push("--forward-subagent-text".into());
    }
    a
}

/// Frame a user turn the way `--input-format stream-json` expects.
///
/// The CLI wants a full message envelope, not a bare string: a `user` message
/// whose content is the standard block list. Sending `{"text": ...}` or a plain
/// line is accepted by the pipe and then silently ignored.
pub(crate) fn user_turn(text: &str) -> String {
    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": text }] },
    });
    format!("{msg}\n")
}

#[derive(Serialize, Clone)]
struct Event {
    run_id: u64,
    /// One raw JSON line from the CLI, unparsed. `null` for our own notices.
    line: Option<String>,
    /// Set when the relay itself has something to say (exit, spawn failure).
    notice: Option<String>,
    done: bool,
}

fn emit(app: &AppHandle, ev: Event) {
    let _ = app.emit("claude-code-event", ev);
}

/// Start a session. Replaces any session already running.
#[tauri::command]
pub fn claude_start(
    app: AppHandle,
    state: State<ClaudeCode>,
    spec: LaunchSpec,
    run_id: u64,
) -> Result<(), String> {
    stop_inner(&state);

    let mut cmd = Command::new("claude");
    cmd.args(build_args(&spec));
    if !spec.cwd.trim().is_empty() {
        cmd.current_dir(&spec.cwd);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| {
        format!("could not start `claude`: {e}. Install Claude Code, or check it is on PATH.")
    })?;

    let stdout = child.stdout.take().ok_or("no stdout on the claude process")?;
    let stderr = child.stderr.take().ok_or("no stderr on the claude process")?;
    let stdin = child.stdin.take();

    // stdout: one JSON object per line, forwarded verbatim.
    let a = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(l) if l.trim().is_empty() => continue,
                Ok(l) => emit(&a, Event { run_id, line: Some(l), notice: None, done: false }),
                Err(_) => break,
            }
        }
        emit(&a, Event { run_id, line: None, notice: None, done: true });
    });

    // stderr: not JSON, but it carries the reason a run died — a usage error
    // from a bad flag, or an auth prompt. Dropping it turns every failure into
    // a silent exit.
    let a = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            emit(&a, Event { run_id, line: None, notice: Some(line), done: false });
        }
    });

    *state.0.lock().unwrap() = Some(ClaudeSession { child, stdin, run_id });
    Ok(())
}

/// Send a user turn to the running session.
#[tauri::command]
pub fn claude_send(state: State<ClaudeCode>, text: String) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    let session = guard.as_mut().ok_or("no claude session is running")?;
    let stdin = session.stdin.as_mut().ok_or("claude session has no stdin")?;
    stdin
        .write_all(user_turn(&text).as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("could not write to claude: {e}"))
}

/// Close stdin, which tells the CLI no more turns are coming and lets it exit
/// cleanly. Distinct from `claude_stop`, which kills it.
#[tauri::command]
pub fn claude_end_input(state: State<ClaudeCode>) {
    if let Some(session) = state.0.lock().unwrap().as_mut() {
        session.stdin.take();
    }
}

#[tauri::command]
pub fn claude_stop(state: State<ClaudeCode>) {
    stop_inner(&state);
}

#[derive(Serialize)]
pub struct ClaudeStatus {
    running: bool,
    run_id: Option<u64>,
}

#[tauri::command]
pub fn claude_status(state: State<ClaudeCode>) -> ClaudeStatus {
    let mut guard = state.0.lock().unwrap();
    if let Some(s) = guard.as_mut() {
        // try_wait is Some(_) once the process has exited — a session that died
        // on its own would otherwise still report as running.
        if matches!(s.child.try_wait(), Ok(None)) {
            return ClaudeStatus { running: true, run_id: Some(s.run_id) };
        }
        *guard = None;
    }
    ClaudeStatus { running: false, run_id: None }
}

/// Whether a `claude` binary is reachable, and its version.
#[tauri::command]
pub fn claude_probe() -> Option<String> {
    let mut cmd = Command::new("claude");
    cmd.arg("--version").stdin(Stdio::null());
    no_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!v.is_empty()).then_some(v)
}

pub fn stop_inner(state: &State<ClaudeCode>) {
    if let Some(mut s) = state.0.lock().unwrap().take() {
        // Drop stdin first: the CLI treats EOF as "no more turns" and will
        // usually exit on its own, which is a cleaner end than a kill.
        drop(s.stdin.take());
        let _ = s.child.kill();
        let _ = s.child.wait();
    }
}

pub fn kill_on_exit(app: &AppHandle) {
    let state: State<ClaudeCode> = tauri::Manager::state(app);
    stop_inner(&state);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> LaunchSpec {
        LaunchSpec::default()
    }

    #[test]
    fn a_default_run_still_speaks_the_streaming_protocol() {
        let a = build_args(&spec());
        assert_eq!(
            a,
            vec![
                "-p",
                "--verbose",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json"
            ]
        );
    }

    #[test]
    fn verbose_is_present_because_stream_json_needs_it() {
        // Without --verbose the CLI emits only the final result line, so
        // system/init never arrives and the wrapper cannot tell what loaded.
        assert!(build_args(&spec()).contains(&"--verbose".to_string()));
    }

    #[test]
    fn empty_strings_do_not_become_empty_flags() {
        // Every optional field defaults to "", and `--model ""` is a usage
        // error rather than a no-op.
        let a = build_args(&spec());
        assert!(!a.contains(&"--model".to_string()));
        assert!(!a.contains(&"--agents".to_string()));
        assert!(!a.contains(&"--resume".to_string()));
    }

    #[test]
    fn agents_are_passed_as_one_json_argument() {
        let s = LaunchSpec {
            agents_json: r#"{"critic":{"description":"d","prompt":"p"}}"#.into(),
            ..spec()
        };
        let a = build_args(&s);
        let i = a.iter().position(|x| x == "--agents").expect("--agents");
        assert_eq!(a[i + 1], r#"{"critic":{"description":"d","prompt":"p"}}"#);
    }

    #[test]
    fn each_plugin_dir_gets_its_own_flag() {
        // --plugin-dir is repeatable, not comma-separated; joining them would
        // produce one nonexistent path.
        let s = LaunchSpec { plugin_dirs: vec!["a".into(), "".into(), "b".into()], ..spec() };
        let a = build_args(&s);
        assert_eq!(a.iter().filter(|x| *x == "--plugin-dir").count(), 2);
        assert!(a.contains(&"a".to_string()) && a.contains(&"b".to_string()));
    }

    #[test]
    fn tools_are_comma_joined_into_one_argument() {
        let s = LaunchSpec { tools: vec!["Read".into(), "Bash".into()], ..spec() };
        let a = build_args(&s);
        let i = a.iter().position(|x| x == "--tools").unwrap();
        assert_eq!(a[i + 1], "Read,Bash");
    }

    #[test]
    fn an_empty_setting_source_list_is_still_emitted() {
        // Some("") is the isolation request — inherit none of the user's own
        // config — and is entirely different from None, which means "leave the
        // CLI's default behaviour alone".
        let isolated = LaunchSpec { setting_sources: Some(String::new()), ..spec() };
        let a = build_args(&isolated);
        let i = a.iter().position(|x| x == "--setting-sources").expect("flag present");
        assert_eq!(a[i + 1], "");

        assert!(!build_args(&spec()).contains(&"--setting-sources".to_string()));
    }

    #[test]
    fn boolean_flags_take_no_value() {
        let s = LaunchSpec { partial_messages: true, forward_subagent_text: true, ..spec() };
        let a = build_args(&s);
        let i = a.iter().position(|x| x == "--include-partial-messages").unwrap();
        // The next entry must be another flag, not a stray value.
        assert!(a.get(i + 1).is_none_or(|n| n.starts_with("--")));
        assert!(a.contains(&"--forward-subagent-text".to_string()));
    }

    #[test]
    fn safe_mode_is_a_bare_flag() {
        let s = LaunchSpec { safe_mode: true, ..spec() };
        assert!(build_args(&s).contains(&"--safe-mode".to_string()));
        assert!(!build_args(&spec()).contains(&"--safe-mode".to_string()));
    }

    #[test]
    fn a_budget_reaches_the_cli_as_a_number() {
        let s = LaunchSpec { max_budget_usd: Some(1.5), ..spec() };
        let a = build_args(&s);
        let i = a.iter().position(|x| x == "--max-budget-usd").unwrap();
        assert_eq!(a[i + 1], "1.5");
    }

    #[test]
    fn a_user_turn_is_a_full_message_envelope() {
        // A bare string, or {"text": ...}, is accepted by the pipe and then
        // ignored — the CLI wants the same shape the API uses.
        let line = user_turn("hello");
        assert!(line.ends_with('\n'), "must be newline-delimited");
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["type"], "user");
        assert_eq!(v["message"]["role"], "user");
        assert_eq!(v["message"]["content"][0]["type"], "text");
        assert_eq!(v["message"]["content"][0]["text"], "hello");
    }

    #[test]
    fn a_turn_containing_json_survives_the_round_trip() {
        // Newline-delimited framing plus user text that is itself JSON with
        // newlines is the obvious way to corrupt the stream.
        let text = "{\"a\": 1}\nsecond line\t\"quoted\"";
        let line = user_turn(text);
        assert_eq!(line.matches('\n').count(), 1, "only the frame terminator");
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["message"]["content"][0]["text"], text);
    }
}
