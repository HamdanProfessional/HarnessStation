use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const RESULT_MARKER: &str = "__HS_RESULT__";

const RUN_HARNESS: &str = r#"

if __name__ == "__main__":
    import json as _json, sys as _sys
    _args = _json.loads(_sys.argv[1])
    _fn = globals().get(_sys.argv[2])
    if _fn is None:
        _sys.stderr.write("function '" + _sys.argv[2] + "' not found in code")
        _sys.exit(1)
    _res = _fn(**_args)
    _sys.stdout.write("__HS_RESULT__" + _json.dumps(_res, default=str))
"#;

const SCHEMA_SCRIPT: &str = r#"
import json, sys, inspect, importlib.util
spec = importlib.util.spec_from_file_location("usertool", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(mod)
except Exception as e:
    print(json.dumps({"error": "code failed to load: %s" % e})); sys.exit(0)
fns = [(n, f) for n, f in vars(mod).items() if inspect.isfunction(f) and f.__module__ == "usertool" and not n.startswith("_")]
if not fns:
    print(json.dumps({"error": "no top-level function found in the code"})); sys.exit(0)
name, fn = fns[0]
sig = inspect.signature(fn)
TYPES = {str: "string", int: "integer", float: "number", bool: "boolean", list: "array", dict: "object"}
props, req = {}, []
for pn, p in sig.parameters.items():
    t = TYPES.get(p.annotation, "string") if p.annotation is not inspect.Parameter.empty else "string"
    props[pn] = {"type": t}
    if p.default is inspect.Parameter.empty:
        req.append(pn)
doc = (inspect.getdoc(fn) or "").strip().split("\n")[0]
print(json.dumps({"name": name, "description": doc, "parameters": {"type": "object", "properties": props, "required": req}}))
"#;

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
}

fn python_exe() -> Result<String, String> {
    for candidate in ["python", "python3", "py"] {
        let mut cmd = Command::new(candidate);
        cmd.arg("--version").stdout(Stdio::null()).stderr(Stdio::null());
        no_window(&mut cmd);
        if cmd.status().map(|s| s.success()).unwrap_or(false) {
            return Ok(candidate.to_string());
        }
    }
    Err("Python not found — install Python 3 and make sure `python` is on PATH.".into())
}

/// Sequence number so two concurrent invocations (a swarm, a battle) never
/// clobber each other's script file. The old fixed names made a parallel
/// python tool call overwrite the other's code mid-run.
static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn tmp_file(name: &str, content: &str) -> Result<std::path::PathBuf, String> {
    let dir = crate::local::harness_root().join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // <stem>_<pid>_<seq>.<ext> — unique per invocation, still recognisable in a dir listing.
    let p = std::path::Path::new(name);
    let seq = TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let unique = format!(
        "{}_{}_{}.{}",
        p.file_stem().and_then(|s| s.to_str()).unwrap_or("hs_pytool"),
        std::process::id(),
        seq,
        p.extension().and_then(|s| s.to_str()).unwrap_or("tmp"),
    );
    let path = dir.join(unique);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path)
}

fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<(String, String, bool), String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => {
                let mut out = String::new();
                let mut err = String::new();
                use std::io::Read;
                if let Some(mut s) = child.stdout.take() {
                    let _ = s.read_to_string(&mut out);
                }
                if let Some(mut s) = child.stderr.take() {
                    let _ = s.read_to_string(&mut err);
                }
                return Ok((out, err, status.success()));
            }
            None => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err(format!("Python timed out after {}s", timeout.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(60));
            }
        }
    }
}

/// Derive an OpenAI-style tool schema from a Python function (Agents SDK @function_tool style).
#[tauri::command]
pub async fn python_schema(code: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || python_schema_blocking(code))
        .await
        .map_err(|e| e.to_string())?
}

fn python_schema_blocking(code: String) -> Result<String, String> {
    let exe = python_exe()?;
    let user = tmp_file("hs_pytool_schema_target.py", &code)?;
    let script = tmp_file("hs_pytool_schema.py", SCHEMA_SCRIPT)?;
    let mut cmd = Command::new(exe);
    cmd.arg(&script).arg(&user);
    let (out, err, ok) = run_with_timeout(cmd, Duration::from_secs(20))?;
    if !ok {
        return Err(format!("schema introspection failed: {}", err.chars().take(400).collect::<String>()));
    }
    Ok(out.trim().to_string())
}

/// Run a Python tool function with JSON kwargs; returns its JSON-serialized result.
#[tauri::command]
pub async fn python_run(code: String, func: String, args: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || python_run_blocking(code, func, args))
        .await
        .map_err(|e| e.to_string())?
}

fn python_run_blocking(code: String, func: String, args: String) -> Result<String, String> {
    let exe = python_exe()?;
    let full = format!("{code}\n{RUN_HARNESS}");
    let file = tmp_file("hs_pytool_run.py", &full)?;
    let mut cmd = Command::new(exe);
    cmd.arg(&file).arg(&args).arg(&func);
    let (out, err, ok) = run_with_timeout(cmd, Duration::from_secs(60))?;
    if !ok {
        return Err(format!(
            "Python error: {}",
            err.chars().take(600).collect::<String>()
        ));
    }
    match out.rfind(RESULT_MARKER) {
        Some(idx) => Ok(out[idx + RESULT_MARKER.len()..].to_string()),
        None => Ok(out.trim().to_string()),
    }
}
