//! Drive the `opencode` CLI and relay its JSON events.
//!
//! Same job as `claudecode.rs`, different protocol. Claude Code holds one
//! long-lived process and takes turns over stdin; opencode's `run` is one-shot —
//! a process per turn, chained by passing `--session <id>` back. So there is no
//! stdin to write to and no session state here: the frontend reads `sessionID`
//! off the events and hands it to the next call, which keeps this module a relay
//! rather than a protocol participant.
//!
//! Injection works differently too, and better for our purposes. opencode has no
//! `--agents` flag, but `OPENCODE_CONFIG_DIR` points it at a whole config
//! directory — agents *and* skills — outside the user's project, so we never
//! write into their repo. Verified against opencode 1.18.19.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
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

#[derive(Default)]
pub struct Opencode(pub Mutex<Option<Child>>);

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RunSpec {
    /// The turn to send. Positional, not a flag.
    pub message: String,
    /// Working directory (`--dir`). Empty = inherit ours.
    pub cwd: String,
    /// `provider/model`, e.g. `minimax/MiniMax-M2.5`. Empty = their configured default.
    pub model: String,
    /// Which agent to run as (`--agent`) — a name from the injected kit or theirs.
    pub agent: String,
    /// Provider-specific reasoning effort (`--variant`), e.g. high, max, minimal.
    pub variant: String,
    /// Continue an existing session (`--session`). Empty = start a new one.
    pub session: String,
    /// Branch rather than extend the session (`--fork`).
    pub fork: bool,
    /// Auto-approve every permission that isn't explicitly denied (`--auto`).
    ///
    /// opencode's own help calls this dangerous, and it is: it lets the agent
    /// edit files and run commands with no prompt. Off unless asked for.
    pub auto: bool,
    /// Skip external plugins (`--pure`).
    ///
    /// Not an isolation control despite the name — a live run confirmed skills
    /// and agents still load under it. It only drops external plugins.
    pub pure: bool,
    /// Files to attach to the message (`--file`, repeatable).
    pub files: Vec<String>,
    /// Directory to inject agents and skills from, as `OPENCODE_CONFIG_DIR`.
    ///
    /// Layout is opencode's: `agent/<name>.md` and `skills/<name>/SKILL.md`.
    pub config_dir: String,
}

/// Build the argument list for one turn.
///
/// Pure and separate so it can be tested without an `opencode` binary. A wrong
/// flag is a process that exits with a usage error, which looks the same from
/// the UI as "opencode isn't installed".
pub(crate) fn build_args(spec: &RunSpec) -> Vec<String> {
    let mut a: Vec<String> = vec!["run".into(), "--format".into(), "json".into()];
    let mut push = |flag: &str, value: &str| {
        if !value.trim().is_empty() {
            a.push(flag.into());
            a.push(value.into());
        }
    };
    push("--model", &spec.model);
    push("--agent", &spec.agent);
    push("--variant", &spec.variant);
    push("--session", &spec.session);
    push("--dir", &spec.cwd);

    for f in spec.files.iter().filter(|f| !f.trim().is_empty()) {
        a.push("--file".into());
        a.push(f.clone());
    }
    // --fork is only meaningful with a session to fork from; alone it is a
    // usage error rather than a no-op.
    if spec.fork && !spec.session.trim().is_empty() {
        a.push("--fork".into());
    }
    if spec.auto {
        a.push("--auto".into());
    }
    if spec.pure {
        a.push("--pure".into());
    }
    // The message is positional and must come last, or a message that starts
    // with a dash would be parsed as a flag.
    if !spec.message.is_empty() {
        a.push(spec.message.clone());
    }
    a
}

#[derive(Serialize, Clone)]
struct Event {
    run_id: u64,
    line: Option<String>,
    notice: Option<String>,
    done: bool,
}

fn emit(app: &AppHandle, ev: Event) {
    let _ = app.emit("opencode-event", ev);
}

/// Run one turn. Replaces any turn still in flight.
#[tauri::command]
pub fn opencode_run(
    app: AppHandle,
    state: State<Opencode>,
    spec: RunSpec,
    run_id: u64,
) -> Result<(), String> {
    stop_inner(&state);

    let mut cmd = Command::new("opencode");
    cmd.args(build_args(&spec));
    if !spec.cwd.trim().is_empty() {
        cmd.current_dir(&spec.cwd);
    }
    if !spec.config_dir.trim().is_empty() {
        cmd.env("OPENCODE_CONFIG_DIR", &spec.config_dir);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| {
        format!("could not start `opencode`: {e}. Install opencode, or check it is on PATH.")
    })?;
    let stdout = child.stdout.take().ok_or("no stdout on the opencode process")?;
    let stderr = child.stderr.take().ok_or("no stderr on the opencode process")?;

    let a = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            emit(&a, Event { run_id, line: Some(line), notice: None, done: false });
        }
        emit(&a, Event { run_id, line: None, notice: None, done: true });
    });

    // opencode writes provider warnings and auth problems here; dropping it
    // turns a misconfigured provider into a run that just produces nothing.
    let a = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            emit(&a, Event { run_id, line: None, notice: Some(line), done: false });
        }
    });

    *state.0.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
pub fn opencode_stop(state: State<Opencode>) {
    stop_inner(&state);
}

/// Whether an `opencode` binary is reachable, and its version.
#[tauri::command]
pub fn opencode_probe() -> Option<String> {
    let mut cmd = Command::new("opencode");
    cmd.arg("--version").stdin(Stdio::null());
    no_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!v.is_empty()).then_some(v)
}

pub fn stop_inner(state: &State<Opencode>) {
    if let Some(mut child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub fn kill_on_exit(app: &AppHandle) {
    let state: State<Opencode> = tauri::Manager::state(app);
    stop_inner(&state);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> RunSpec {
        RunSpec { message: "hi".into(), ..Default::default() }
    }

    #[test]
    fn a_minimal_turn_asks_for_json_and_passes_the_message_last() {
        assert_eq!(build_args(&spec()), vec!["run", "--format", "json", "hi"]);
    }

    #[test]
    fn the_message_stays_last_so_a_leading_dash_is_not_a_flag() {
        // "--help me" as a prompt would otherwise be parsed as an option.
        let s = RunSpec { message: "--help me".into(), model: "a/b".into(), ..Default::default() };
        let a = build_args(&s);
        assert_eq!(a.last().unwrap(), "--help me");
    }

    #[test]
    fn an_empty_message_is_not_appended() {
        // Sending "" would be a turn with no content rather than no turn.
        let s = RunSpec::default();
        assert_eq!(build_args(&s), vec!["run", "--format", "json"]);
    }

    #[test]
    fn empty_options_do_not_become_empty_flags() {
        let a = build_args(&spec());
        for flag in ["--model", "--agent", "--variant", "--session", "--dir"] {
            assert!(!a.contains(&flag.to_string()), "{flag} should be absent");
        }
    }

    #[test]
    fn a_session_id_is_how_a_turn_chains() {
        let s = RunSpec { session: "ses_abc".into(), ..spec() };
        let a = build_args(&s);
        let i = a.iter().position(|x| x == "--session").unwrap();
        assert_eq!(a[i + 1], "ses_abc");
    }

    #[test]
    fn fork_without_a_session_is_dropped() {
        // opencode rejects --fork unless --continue or --session is present, so
        // emitting it alone would fail the turn rather than start a fresh one.
        let alone = RunSpec { fork: true, ..spec() };
        assert!(!build_args(&alone).contains(&"--fork".to_string()));

        let paired = RunSpec { fork: true, session: "ses_abc".into(), ..spec() };
        assert!(build_args(&paired).contains(&"--fork".to_string()));
    }

    #[test]
    fn each_file_gets_its_own_flag() {
        let s = RunSpec { files: vec!["a.txt".into(), "".into(), "b.png".into()], ..spec() };
        let a = build_args(&s);
        assert_eq!(a.iter().filter(|x| *x == "--file").count(), 2);
    }

    #[test]
    fn the_dangerous_flags_are_opt_in() {
        let a = build_args(&spec());
        assert!(!a.contains(&"--auto".to_string()));
        assert!(!a.contains(&"--pure".to_string()));

        let on = RunSpec { auto: true, pure: true, ..spec() };
        let a = build_args(&on);
        assert!(a.contains(&"--auto".to_string()) && a.contains(&"--pure".to_string()));
    }

    #[test]
    fn the_config_dir_is_not_an_argument() {
        // Injection travels as OPENCODE_CONFIG_DIR in the environment; there is
        // no flag for it, and adding one would be a usage error.
        let s = RunSpec { config_dir: "/tmp/kit".into(), ..spec() };
        let a = build_args(&s);
        assert!(!a.iter().any(|x| x.contains("kit")));
    }
}
