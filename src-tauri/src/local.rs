use futures_util::StreamExt;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct LocalServer(pub Mutex<Option<ServerInfo>>);

pub struct ServerInfo {
    child: Child,
    model: String,
    port: u16,
}

fn home_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home)
}

pub(crate) fn harness_root() -> PathBuf {
    home_dir().join(".harnessx")
}

/// Resolve `path` against `base` and refuse anything that lands outside it.
///
/// This is the fs tools' whole sandbox. The README promises "file access is
/// confined to a working directory you choose", which used to be enforced
/// nowhere at all: absolute paths passed straight through and `..` climbed
/// freely, so `read_file("C:/anywhere")` or `read_file("../../secrets")` from
/// the model walked out of the workspace. Now:
///
///   - relative paths are normalized lexically (`a/../b` -> `b`); a `..` that
///     would climb above the base is an error, not a silent clamp;
///   - absolute paths are allowed *only* when, canonically, they are inside
///     the base — an absolute path into the workspace stays convenient, one
///     pointing elsewhere is refused;
///   - both sides are canonicalized through their deepest existing ancestor
///     (the target itself may not exist yet — fs_write creates it), which
///     also collapses symlinks, `\\?\` prefixes and case differences on
///     Windows.
///
/// Empty `base` means the home directory, matching every caller that predates
/// per-chat working directories.
fn resolve_in_base(base: &str, path: &str) -> Result<PathBuf, String> {
    let target = Path::new(path);
    if path.trim().is_empty() {
        return Err("empty path".into());
    }
    let base_path = if base.trim().is_empty() { home_dir() } else { PathBuf::from(base) };
    let joined = if target.is_absolute() { target.to_path_buf() } else { base_path.join(target) };

    // Lexical pass: collapse `.` and `..` without touching the filesystem, so
    // an escaping `..` is caught even when nothing along the way exists.
    let mut stack: Vec<std::ffi::OsString> = Vec::new();
    for comp in joined.components() {
        use std::path::Component;
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                // Popping past the root (a leading `..` on an absolute path)
                // leaves the stack at the prefix — the prefix check below
                // still rejects it.
                stack.pop();
            }
            other => stack.push(other.as_os_str().to_os_string()),
        }
    }
    let normalized = stack.iter().collect::<PathBuf>();

    // Canonical pass: walk up to the deepest ancestor that exists, canonicalize
    // it, and re-attach the tail that doesn't exist yet.
    let canonical = |p: &Path| -> Option<PathBuf> {
        let mut probe = p.to_path_buf();
        let mut tail: Vec<std::ffi::OsString> = Vec::new();
        loop {
            match std::fs::canonicalize(&probe) {
                Ok(real) => {
                    let mut out = real;
                    for part in tail.iter().rev() {
                        out.push(part);
                    }
                    return Some(out);
                }
                Err(_) => {
                    let last = probe.file_name()?.to_os_string();
                    probe.pop();
                    tail.push(last);
                }
            }
        }
    };

    let base_real = std::fs::canonicalize(&base_path)
        .map_err(|_| format!("working directory does not exist: {}", base_path.display()))?;
    let target_real = canonical(&normalized)
        .ok_or_else(|| "could not resolve the path".to_string())?;

    #[cfg(windows)]
    let inside = target_real
        .to_string_lossy()
        .to_lowercase()
        .starts_with(&base_real.to_string_lossy().to_lowercase());
    #[cfg(not(windows))]
    let inside = target_real.starts_with(&base_real);
    if !inside {
        return Err(format!(
            "path escapes the working directory: {}",
            target_real.display()
        ));
    }
    Ok(target_real)
}

#[cfg(test)]
mod confinement_tests {
    use super::*;

    #[test]
    fn relative_paths_stay_inside() {
        let dir = std::env::temp_dir().join("hs_confine_rel");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let p = resolve_in_base(dir.to_str().unwrap(), "sub/file.txt").unwrap();
        assert!(p.to_string_lossy().to_lowercase().contains("sub"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn dot_dot_climbing_out_is_refused() {
        let dir = std::env::temp_dir().join("hs_confine_up");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let err = resolve_in_base(dir.join("sub").to_str().unwrap(), "..\\..\\etc\\passwd").unwrap_err();
        assert!(err.contains("escapes"), "{err}");
        let err = resolve_in_base(dir.join("sub").to_str().unwrap(), "../../../etc/passwd").unwrap_err();
        assert!(err.contains("escapes"), "{err}");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn internal_dot_dot_that_stays_inside_is_fine() {
        let dir = std::env::temp_dir().join("hs_confine_in");
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        let p = resolve_in_base(dir.to_str().unwrap(), "a/b/../../a/c.txt").unwrap();
        assert!(p.ends_with("a/c.txt"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn absolute_outside_is_refused_even_without_dotdot() {
        let dir = std::env::temp_dir().join("hs_confine_abs");
        std::fs::create_dir_all(&dir).unwrap();
        let elsewhere = if cfg!(windows) { "C:\\Windows\\system.ini" } else { "/etc/hostname" };
        assert!(resolve_in_base(dir.to_str().unwrap(), elsewhere).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn absolute_inside_is_allowed_and_canonicalized() {
        let dir = std::env::temp_dir().join("hs_confine_absin");
        std::fs::create_dir_all(&dir).unwrap();
        let real = std::fs::canonicalize(&dir).unwrap();
        let file = real.join("t.txt");
        std::fs::write(&file, "x").unwrap();
        let p = resolve_in_base(dir.to_str().unwrap(), file.to_str().unwrap()).unwrap();
        assert!(p.ends_with("t.txt"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn missing_target_under_base_resolves_for_creation() {
        let dir = std::env::temp_dir().join("hs_confine_new");
        std::fs::create_dir_all(&dir).unwrap();
        let p = resolve_in_base(dir.to_str().unwrap(), "new/nested/f.txt").unwrap();
        assert!(p.ends_with("f.txt"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn empty_path_is_an_error() {
        let dir = std::env::temp_dir().join("hs_confine_empty");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(resolve_in_base(dir.to_str().unwrap(), "").is_err());
        std::fs::remove_dir_all(dir).ok();
    }
}

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
}

// ---------- hardware info ----------

#[derive(Serialize)]
pub struct HwInfo {
    total_ram_mb: u64,
    avx2: bool,
    gpu_name: Option<String>,
    vram_mb: Option<u64>,
}

#[tauri::command]
pub fn hw_info() -> HwInfo {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let total_ram_mb = sys.total_memory() / (1024 * 1024);

    #[cfg(target_arch = "x86_64")]
    let avx2 = std::arch::is_x86_feature_detected!("avx2");
    #[cfg(not(target_arch = "x86_64"))]
    let avx2 = false;

    let (gpu_name, vram_mb) = detect_nvidia().unwrap_or((None, None));
    HwInfo {
        total_ram_mb,
        avx2,
        gpu_name,
        vram_mb,
    }
}

fn detect_nvidia() -> Option<(Option<String>, Option<u64>)> {
    let mut cmd = Command::new("nvidia-smi");
    cmd.args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
    no_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout).lines().next()?.to_string();
    let mut parts = line.rsplitn(2, ',');
    let vram: u64 = parts.next()?.trim().parse().ok()?;
    let name = parts.next()?.trim().to_string();
    Some((Some(name), Some(vram)))
}

// ---------- downloads ----------

#[derive(Clone, Serialize)]
struct Progress {
    id: String,
    received: u64,
    total: Option<u64>,
    done: bool,
}

/// Stream a URL to a path relative to ~/.harnessx, emitting `download-progress` events.
#[tauri::command]
pub async fn download(app: AppHandle, url: String, dest: String, id: String) -> Result<(), String> {
    let path = harness_root().join(&dest);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {url}", resp.status()));
    }
    let total = resp.content_length();
    let tmp = path.with_extension("part");
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if last_emit.elapsed().as_millis() > 250 {
            let _ = app.emit(
                "download-progress",
                Progress { id: id.clone(), received, total, done: false },
            );
            last_emit = std::time::Instant::now();
        }
    }
    drop(file);
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    let _ = app.emit("download-progress", Progress { id, received, total, done: true });
    Ok(())
}

/// Extract an archive (relative to ~/.harnessx) into a folder, then delete the archive.
/// Handles .zip and .tar.gz/.tgz in-process, so it behaves the same on every platform.
#[tauri::command]
pub fn extract_zip(zip: String, dest: String) -> Result<(), String> {
    let archive = harness_root().join(&zip);
    let dest_path = harness_root().join(&dest);
    std::fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;

    let lower = zip.to_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        extract_tar_gz(&archive, &dest_path)?;
    } else {
        extract_zip_file(&archive, &dest_path)?;
    }
    let _ = std::fs::remove_file(&archive);
    Ok(())
}

fn extract_zip_file(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        // enclosed_name() rejects "../" traversal, so a hostile archive can't escape.
        let Some(rel) = entry.enclosed_name() else { continue };
        let out = dest.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut w = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut w).map_err(|e| e.to_string())?;
        restore_mode(&out, entry.unix_mode());
    }
    Ok(())
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    tar.unpack(dest).map_err(|e| e.to_string())
}

/// Keep the executable bit on Unix — a downloaded engine that isn't +x won't run.
#[cfg(unix)]
fn restore_mode(path: &Path, mode: Option<u32>) {
    use std::os::unix::fs::PermissionsExt;
    if let Some(m) = mode {
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(m));
    }
}
#[cfg(not(unix))]
fn restore_mode(_path: &Path, _mode: Option<u32>) {}

/// Platform-correct executable file name ("piper" vs "piper.exe").
pub fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// Which OS the app is running on, for the frontend's platform branches.
#[tauri::command]
pub fn platform() -> String {
    std::env::consts::OS.to_string()
}

// ---------- working-directory file ops + terminal (arbitrary paths) ----------

#[derive(Serialize)]
pub struct CmdResult {
    stdout: String,
    stderr: String,
    code: i32,
}

/// Run a shell command in `cwd` (empty = home). Returns combined output, 60s timeout.
/// Runs on a worker thread so the UI never blocks.
#[tauri::command]
pub async fn run_command(command: String, cwd: String) -> Result<CmdResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_command_blocking(command, cwd))
        .await
        .map_err(|e| e.to_string())?
}

fn run_command_blocking(command: String, cwd: String) -> Result<CmdResult, String> {
    let dir = if cwd.trim().is_empty() { home_dir() } else { PathBuf::from(&cwd) };
    if !dir.exists() {
        return Err(format!("working directory does not exist: {}", dir.display()));
    }
    // Run through PowerShell (Windows) / sh, passing the command as a single argument
    // so the shell — not the process launcher — parses pipes, quotes, and variables.
    #[cfg(windows)]
    let mut cmd = {
        // PowerShell aliases `curl`/`wget` to Invoke-WebRequest, which doesn't accept
        // real curl flags (-L, -o, ...) and breaks downloads. Drop those aliases first so
        // the genuine System32 curl.exe is used when a command calls `curl`/`wget`.
        let full = format!(
            "Remove-Item -Path Alias:curl, Alias:wget -Force -ErrorAction SilentlyContinue; {command}"
        );
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", &full]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-c", &command]);
        c
    };
    cmd.current_dir(&dir).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            use std::io::Read;
            let mut out = String::new();
            let mut err = String::new();
            if let Some(mut s) = child.stdout.take() {
                let _ = s.read_to_string(&mut out);
            }
            if let Some(mut s) = child.stderr.take() {
                let _ = s.read_to_string(&mut err);
            }
            return Ok(CmdResult {
                stdout: out.chars().take(12000).collect(),
                stderr: err.chars().take(4000).collect(),
                code: status.code().unwrap_or(-1),
            });
        }
        if start.elapsed().as_secs() > 60 {
            let _ = child.kill();
            return Err("command timed out after 60s".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    dir: bool,
}

#[tauri::command]
pub fn fs_write(base: String, path: String, content: String, append: bool) -> Result<(), String> {
    use std::io::Write;
    let target = resolve_in_base(&base, &path)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&target)
        .map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_read(base: String, path: String) -> Result<String, String> {
    std::fs::read_to_string(resolve_in_base(&base, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_mkdir(base: String, path: String) -> Result<(), String> {
    std::fs::create_dir_all(resolve_in_base(&base, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_remove(base: String, path: String) -> Result<(), String> {
    let target = resolve_in_base(&base, &path)?;
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn fs_exists(base: String, path: String) -> bool {
    resolve_in_base(&base, &path).is_ok_and(|p| p.exists())
}

#[tauri::command]
pub fn fs_list(base: String, path: String) -> Result<Vec<DirEntry>, String> {
    let dir = resolve_in_base(&base, &path)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            dir: entry.path().is_dir(),
        });
    }
    Ok(out)
}

// ---------- speech to text (whisper.cpp) ----------

/// Find an executable by name, honouring the caller's priority order: the whole tree is
/// searched for the first name before falling back to the next. (Directory order must not
/// decide — e.g. whisper.cpp ships a deprecated `main.exe` stub alongside `whisper-cli.exe`.)
fn find_exe_named(dir: &Path, names: &[String]) -> Option<PathBuf> {
    names.iter().find_map(|name| find_one_named(dir, name))
}

/// Public helper: locate a single executable by name under `dir`.
pub fn find_exe(dir: &Path, name: &str) -> Option<PathBuf> {
    find_one_named(dir, name)
}

fn find_one_named(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            subdirs.push(path);
        } else if path.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(path);
        }
    }
    subdirs.iter().find_map(|d| find_one_named(d, name))
}

// ---------- persistent whisper server (keeps the model in memory) ----------

pub struct SttServer(pub Mutex<Option<SttState>>);

pub struct SttState {
    child: Child,
    model: String,
    port: u16,
}

/// Start (or reuse) whisper-server so the model isn't reloaded for every utterance.
/// Returns the port it is listening on.
#[tauri::command]
pub fn stt_serve(
    engine_dir: String,
    model: String,
    port: u16,
    state: State<SttServer>,
) -> Result<u16, String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(cur) = guard.as_mut() {
        let alive = matches!(cur.child.try_wait(), Ok(None));
        if alive && cur.model == model && cur.port == port {
            return Ok(cur.port);
        }
        let _ = cur.child.kill();
        let _ = cur.child.wait();
        *guard = None;
    }
    let root = harness_root();
    let exe = find_exe_named(&root.join(&engine_dir), &[exe_name("whisper-server")])
        .ok_or("whisper-server executable not found in the engine folder")?;
    let model_path = root.join(&model);
    if !model_path.exists() {
        return Err(format!("speech model missing at {}", model_path.display()));
    }
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .to_string();
    let mut cmd = Command::new(&exe);
    cmd.args([
        "-m",
        &model_path.to_string_lossy(),
        "--host",
        "127.0.0.1",
        "--port",
        &port.to_string(),
        "-t",
        &threads,
        // Tuned for short conversational turns on modest hardware, where the wait
        // between speaking and being answered is the thing that matters:
        //   -bo 1  decode one candidate instead of whisper's default two
        //   -nf    skip the temperature-fallback re-decode when a segment scores
        //          badly — a retry costs more than the occasional worse guess here
        //   -nt    no timestamps; only the text is ever read back
        // Verified against the flags this whisper-server build actually accepts —
        // an unknown flag stops the server booting, which silently drops every
        // utterance onto the far slower one-shot CLI path.
        "-bo",
        "1",
        "-nf",
        "-nt",
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    no_window(&mut cmd);
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    *guard = Some(SttState { child, model, port });
    Ok(port)
}

#[tauri::command]
pub fn stt_stop(state: State<SttServer>) {
    if let Some(mut s) = state.0.lock().unwrap().take() {
        let _ = s.child.kill();
        let _ = s.child.wait();
    }
}

pub fn kill_stt(app: &AppHandle) {
    let state: State<SttServer> = tauri::Manager::state(app);
    // Take the child out and drop the guard before killing it.
    let taken = state.0.lock().unwrap().take();
    if let Some(mut s) = taken {
        let _ = s.child.kill();
        let _ = s.child.wait();
    }
}

#[tauri::command]
pub async fn transcribe(
    engine_dir: String,
    model: String,
    wav: String,
    language: Option<String>,
    translate: Option<bool>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        transcribe_blocking(engine_dir, model, wav, language, translate)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn transcribe_blocking(
    engine_dir: String,
    model: String,
    wav: String,
    language: Option<String>,
    translate: Option<bool>,
) -> Result<String, String> {
    let root = harness_root();
    let wav_path = root.join(&wav);
    let model_path = root.join(&model);

    // Too little audio to contain speech (a tapped push-to-talk key): not an error.
    // 44-byte header + 16-bit mono @16 kHz — ~0.15 s is 4.8 KB.
    match std::fs::metadata(&wav_path) {
        Ok(m) if m.len() < 5_000 => return Ok(String::new()),
        Err(e) => return Err(format!("recording not found: {e}")),
        _ => {}
    }
    // A truncated model (interrupted download) loads as garbage and exits non-zero,
    // so treat "too small to be a real model" as a clear, actionable error.
    match std::fs::metadata(&model_path) {
        Ok(m) if m.len() < 20_000_000 => {
            return Err(format!(
                "speech model looks incomplete ({} MB) — delete {} and it will re-download",
                m.len() / 1_000_000,
                model_path.display()
            ))
        }
        Err(_) => {
            return Err(format!(
                "speech model missing at {} — it will re-download on the next try",
                model_path.display()
            ))
        }
        _ => {}
    }
    let exe = find_exe_named(
        &root.join(&engine_dir),
        &[exe_name("whisper-cli"), exe_name("main")],
    )
    .ok_or("whisper executable not found in engine folder")?;

    // Greedy decoding (1 beam) and all cores: several times faster than the default
    // 5-beam search, which matters a lot for a live voice loop.
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .to_string();
    let mut cmd = Command::new(&exe);
    cmd.args([
        "-m",
        &model_path.to_string_lossy(),
        "-f",
        &wav_path.to_string_lossy(),
        "-t",
        &threads,
        "-bs",
        "1",
        "-bo",
        "1",
        "--no-timestamps",
    ]);
    // Spoken language. "auto" lets whisper detect it per utterance; naming the
    // language explicitly is both faster and much more accurate.
    let lang = language.unwrap_or_default();
    let lang = if lang.trim().is_empty() { "auto".to_string() } else { lang };
    cmd.args(["-l", &lang]);
    if translate.unwrap_or(false) {
        cmd.arg("-tr"); // transcribe straight into English
    }
    // Run from the engine folder so its ggml-*.dll backends resolve reliably.
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    no_window(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let so = String::from_utf8_lossy(&out.stdout);
        let mut tail = err.trim().lines().rev().take(3).collect::<Vec<_>>().join(" | ");
        if tail.is_empty() {
            tail = so.trim().lines().rev().take(3).collect::<Vec<_>>().join(" | ");
        }
        if tail.is_empty() {
            tail = format!("no output from {}", exe.display());
        }
        return Err(format!(
            "whisper exited with {}: {}",
            out.status.code().unwrap_or(-1),
            tail.chars().take(400).collect::<String>()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// ---------- llama-server supervision ----------

fn find_server_exe(dir: &Path) -> Option<PathBuf> {
    for entry in std::fs::read_dir(dir).ok()? {
        let path = entry.ok()?.path();
        if path.is_dir() {
            if let Some(found) = find_server_exe(&path) {
                return Some(found);
            }
        } else if path.file_name().and_then(|n| n.to_str()) == Some(exe_name("llama-server").as_str()) {
            return Some(path);
        }
    }
    None
}

/// Optional performance flags for llama-server.
///
/// All are opt-in: only what the caller sets is passed. Newer flags
/// (`--n-cpu-moe`, `--fit-target`, `--flash-attn on`) fail on an old engine
/// that doesn't know them, so leaving a field unset keeps the launch compatible.
/// Which llama.cpp lineage the engine directory holds.
///
/// They share a binary name (`llama-server`), a port, and an OpenAI-compatible
/// API, so everything downstream of the launch is identical. What differs is the
/// command line, and the differences are silent failures rather than warnings:
/// an unknown flag makes the server exit during load, which surfaces here as
/// "exited while loading — model may not fit in memory" and sends the user off
/// hunting a memory problem they don't have.
///
/// Verified against ik_llama.cpp's `common/common.cpp` rather than assumed, and
/// the overlap is larger than the fork's age suggests: `--threads`, `--cpu-moe`,
/// `--n-cpu-moe`, `--flash-attn on`, `--mlock`, `--no-mmap`, `--jinja`,
/// `--ctx-size` and `--n-gpu-layers` all parse identically. Three things do not,
/// and each is handled in `launch_flag_args`.
#[derive(serde::Deserialize, Default, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Engine {
    /// Upstream ggml-org/llama.cpp. The default, and what `install_engine` downloads.
    #[default]
    #[serde(rename = "llama.cpp")]
    LlamaCpp,
    /// ikawrakow/ik_llama.cpp — the CPU-focused fork.
    #[serde(rename = "ik_llama")]
    IkLlama,
}

impl Engine {
    fn is_ik(self) -> bool {
        self == Engine::IkLlama
    }
}

#[derive(serde::Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct LaunchOpts {
    /// CPU threads for inference (`--threads`). Best around physical core count.
    threads: Option<u32>,
    /// MoE expert offload to system RAM: 0 = all experts (`--cpu-moe`), N =
    /// first N layers (`--n-cpu-moe N`). The trick for big MoE models on a small
    /// GPU: keep attention on the GPU, experts in RAM.
    cpu_moe: Option<u32>,
    /// Flash attention (`--flash-attn on`) — a near-universal speed/memory win.
    flash_attn: bool,
    /// Lock the model in RAM so it can't be swapped to disk (`--mlock`).
    mlock: bool,
    /// Load fully into RAM instead of memory-mapping (`--no-mmap`).
    no_mmap: bool,
    /// Turn off llama.cpp's auto-fit (`--fit off`); it's on by default.
    fit_off: bool,
    /// Memory margin per GPU in MB for auto-fit (`--fit-target`).
    fit_target: Option<u32>,
    /// Multi-token prediction (`--spec-type draft-mtp`): speculative decoding
    /// using heads baked into the model, so there's no second draft model and no
    /// second VRAM budget. Roughly 1.5–2x tokens/sec.
    ///
    /// Two hard requirements, both silent when unmet: llama.cpp **build 9200+**
    /// (merged 2026-05-16), and a **model whose GGUF carries MTP heads** — a
    /// normal GGUF has none and the flag simply does nothing. The flag was also
    /// renamed from `--draft-mtp` before the stable merge, so older write-ups
    /// give a form that errors.
    mtp: bool,
    /// Tokens the MTP head drafts per step (`--spec-draft-n-max`). 2 suits dense
    /// models, 3 MoE. Ignored unless `mtp` is set.
    spec_draft_n_max: Option<u32>,
    /// Minimum acceptance probability for a drafted token (`--spec-draft-p-min`).
    /// Not optional in practice: without it, rejection rates on long contexts eat
    /// the speedup. ~0.75 is the reported sweet spot. Ignored unless `mtp` is set.
    spec_draft_p_min: Option<f32>,

    // ---- ik_llama.cpp only. Ignored on upstream builds, which would reject them. ----
    /// Run-time repack (`-rtr`): rewrites tensors into row-interleaved layout as
    /// the model loads, so CPU GEMM hits the fast IQK kernels. The headline
    /// reason to run this fork on a CPU-only box.
    ///
    /// Costs load time and disables mmap (the fork forces `use_mmap = false`
    /// itself, since a repacked tensor can't be shared with the file on disk),
    /// so the model is read in full and held in RAM.
    rtr: bool,
    /// Smart expert reduction (`-ser`), as the fork's `min_experts,thresh` pair,
    /// e.g. `"5,1"`. Drops MoE experts below a probability threshold: fewer
    /// experts per token, some quality given up for speed. Passed through as a
    /// string because the shape is the fork's, not ours to reinterpret.
    ser: Option<String>,
    /// Attention max batch in MB (`-amb`) — caps the attention compute buffer.
    /// The fork silently raises anything below 128 to 128.
    amb: Option<u32>,
}

/// Build just the optional flag arguments for a set of launch options.
///
/// Pure and separate so the flag translation — the part that silently breaks a
/// launch if a name or shape is wrong — can be unit-tested without spawning a
/// process. Nothing is emitted for an unset field, keeping older engines happy.
fn launch_flag_args(o: &LaunchOpts, engine: Engine) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    if let Some(t) = o.threads {
        a.push("--threads".into());
        a.push(t.to_string());
    }
    match o.cpu_moe {
        Some(0) => a.push("--cpu-moe".into()),
        Some(n) => {
            a.push("--n-cpu-moe".into());
            a.push(n.to_string());
        }
        None => {}
    }
    if o.flash_attn {
        a.push("--flash-attn".into());
        a.push("on".into());
    }
    if o.mlock {
        a.push("--mlock".into());
    }
    if o.no_mmap {
        a.push("--no-mmap".into());
    }
    // Auto-fit is the sharpest divergence. Upstream has it *on* by default and
    // takes a value (`--fit off`); the fork has it *off* by default and takes
    // none (`--fit` opts in). So "the user asked for fit off" is a flag upstream
    // and silence on the fork — pushing `--fit off` there would leave a bare
    // `off` as a positional argument and abort the launch.
    if o.fit_off && !engine.is_ik() {
        a.push("--fit".into());
        a.push("off".into());
    }
    if let Some(m) = o.fit_target {
        // Same knob, different name: `--fit-target` upstream, `--fit-margin` on
        // the fork.
        a.push(if engine.is_ik() { "--fit-margin".into() } else { "--fit-target".into() });
        a.push(m.to_string());
    }
    // The draft tuning knobs only mean anything alongside a speculative type, so
    // they're gated on `mtp` rather than emitted independently — passing them
    // alone would be a launch that looks configured and isn't.
    if o.mtp {
        a.push("--spec-type".into());
        // The stage is named `draft-mtp` upstream and plain `mtp` on the fork.
        a.push(if engine.is_ik() { "mtp".into() } else { "draft-mtp".into() });
        // The fork has no `--spec-draft-*` flags at all — it tunes stages with
        // an inline `key=value` syntax on --spec-type instead. Emitting them
        // would abort the launch, so MTP there is on-or-off with no knobs.
        if engine.is_ik() {
            return a;
        }
        if let Some(n) = o.spec_draft_n_max {
            a.push("--spec-draft-n-max".into());
            a.push(n.to_string());
        }
        if let Some(p) = o.spec_draft_p_min {
            a.push("--spec-draft-p-min".into());
            // Trim the float so 0.75 doesn't reach the CLI as "0.75000000000001".
            a.push(format!("{p}"));
        }
    }

    // Fork-only flags. Guarded rather than merely unset by default, so a config
    // carried over from an ik_llama engine can't abort an upstream launch.
    if engine.is_ik() {
        if o.rtr {
            a.push("-rtr".into());
        }
        if let Some(s) = o.ser.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            a.push("-ser".into());
            a.push(s.to_string());
        }
        if let Some(m) = o.amb {
            a.push("-amb".into());
            a.push(m.to_string());
        }
    }
    a
}

/// Report whether an engine directory actually contains a `llama-server`.
///
/// Worth a round trip before launching. An engine path that resolves to nothing
/// fails at spawn, and the failure the user sees is the *next* check —
/// "llama-server exited while loading, model may not fit in memory" — which
/// sends them off tuning context size for a problem that is a wrong folder.
/// Especially so for ik_llama.cpp, where the path is hand-typed rather than
/// produced by the installer.
#[tauri::command]
pub fn probe_engine(engine_dir: String) -> Option<String> {
    let root = harness_root().join(&engine_dir);
    find_server_exe(&root).map(|p| p.to_string_lossy().into_owned())
}

// A Tauri command's argument list is its wire format — each parameter is a
// named field the frontend passes by name. Collapsing them into a struct
// would just move the eight names into a type while keeping the invoke site
// unchanged, so the lint's usual remedy buys nothing here.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn start_server(
    state: State<LocalServer>,
    engine_dir: String,
    model_path: String,
    port: u16,
    ctx: u32,
    gpu_layers: i32,
    opts: Option<LaunchOpts>,
    engine: Option<Engine>,
) -> Result<(), String> {
    stop_inner(&state);
    let engine_root = harness_root().join(&engine_dir);
    let exe = find_server_exe(&engine_root)
        .ok_or_else(|| format!("{} not found under {}", exe_name("llama-server"), engine_root.display()))?;
    let model_abs = harness_root().join(&model_path);
    if !model_abs.exists() {
        return Err(format!("model file not found: {}", model_abs.display()));
    }

    // Base args, always safe.
    let mut args: Vec<String> = vec![
        "--model".into(),
        model_abs.to_string_lossy().into_owned(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "--ctx-size".into(),
        ctx.to_string(),
        "--n-gpu-layers".into(),
        gpu_layers.to_string(),
        "--jinja".into(),
    ];

    // Optional performance flags, added only when requested.
    args.extend(launch_flag_args(&opts.unwrap_or_default(), engine.unwrap_or_default()));

    let mut cmd = Command::new(&exe);
    cmd.args(&args).stdout(Stdio::null()).stderr(Stdio::null());
    no_window(&mut cmd);
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(ServerInfo { child, model: model_path, port });
    Ok(())
}

#[tauri::command]
pub fn stop_server(state: State<LocalServer>) {
    stop_inner(&state);
}

#[derive(Serialize)]
pub struct ServerStatus {
    running: bool,
    model: Option<String>,
    port: Option<u16>,
}

#[tauri::command]
pub fn server_status(state: State<LocalServer>) -> ServerStatus {
    let mut guard = state.0.lock().unwrap();
    if let Some(info) = guard.as_mut() {
        // try_wait returns Some(status) if the process exited (e.g. crashed on load)
        match info.child.try_wait() {
            Ok(None) => ServerStatus {
                running: true,
                model: Some(info.model.clone()),
                port: Some(info.port),
            },
            _ => {
                *guard = None;
                ServerStatus { running: false, model: None, port: None }
            }
        }
    } else {
        ServerStatus { running: false, model: None, port: None }
    }
}

pub fn stop_inner(state: &State<LocalServer>) {
    if let Some(mut info) = state.0.lock().unwrap().take() {
        let _ = info.child.kill();
        let _ = info.child.wait();
    }
}

pub fn kill_on_exit(app: &AppHandle) {
    let state: State<LocalServer> = tauri::Manager::state(app);
    stop_inner(&state);
}

#[cfg(test)]
mod launch_tests {
    use super::*;

    #[test]
    fn unset_options_emit_nothing() {
        // The compatibility guarantee: a default launch adds no new flags, so an
        // older engine that doesn't know them still starts.
        assert!(launch_flag_args(&LaunchOpts::default(), Engine::LlamaCpp).is_empty());
    }

    #[test]
    fn cpu_moe_zero_means_all_experts() {
        let o = LaunchOpts { cpu_moe: Some(0), ..Default::default() };
        assert_eq!(launch_flag_args(&o, Engine::LlamaCpp), vec!["--cpu-moe"]);
    }

    #[test]
    fn cpu_moe_n_offloads_first_n_layers() {
        let o = LaunchOpts { cpu_moe: Some(24), ..Default::default() };
        assert_eq!(launch_flag_args(&o, Engine::LlamaCpp), vec!["--n-cpu-moe", "24"]);
    }

    #[test]
    fn flash_attention_is_on_not_a_bare_flag() {
        // --flash-attn takes on/off in recent llama.cpp; a bare --flash-attn errors.
        let o = LaunchOpts { flash_attn: true, ..Default::default() };
        assert_eq!(launch_flag_args(&o, Engine::LlamaCpp), vec!["--flash-attn", "on"]);
    }

    #[test]
    fn boolean_flags_are_bare() {
        let o = LaunchOpts { mlock: true, no_mmap: true, ..Default::default() };
        assert_eq!(launch_flag_args(&o, Engine::LlamaCpp), vec!["--mlock", "--no-mmap"]);
    }

    #[test]
    fn fit_controls() {
        let off = LaunchOpts { fit_off: true, ..Default::default() };
        assert_eq!(launch_flag_args(&off, Engine::LlamaCpp), vec!["--fit", "off"]);
        let target = LaunchOpts { fit_target: Some(256), ..Default::default() };
        assert_eq!(launch_flag_args(&target, Engine::LlamaCpp), vec!["--fit-target", "256"]);
    }

    #[test]
    fn mtp_uses_the_renamed_spec_type_form() {
        // Pre-merge llama.cpp took a bare `--draft-mtp`, and one widely-copied
        // tutorial says `--spec-type mtp`. Both error on a current build. If this
        // assertion is ever "fixed" to match a tutorial, MTP silently stops.
        let o = LaunchOpts { mtp: true, ..Default::default() };
        assert_eq!(launch_flag_args(&o, Engine::LlamaCpp), vec!["--spec-type", "draft-mtp"]);
    }

    #[test]
    fn draft_knobs_are_ignored_without_mtp() {
        // Emitting these alone would produce a launch that looks tuned and isn't.
        let o = LaunchOpts {
            spec_draft_n_max: Some(3),
            spec_draft_p_min: Some(0.75),
            ..Default::default()
        };
        assert!(launch_flag_args(&o, Engine::LlamaCpp).is_empty());
    }

    #[test]
    fn mtp_carries_its_draft_knobs() {
        let o = LaunchOpts {
            mtp: true,
            spec_draft_n_max: Some(2),
            spec_draft_p_min: Some(0.75),
            ..Default::default()
        };
        assert_eq!(
            launch_flag_args(&o, Engine::LlamaCpp),
            vec!["--spec-type", "draft-mtp", "--spec-draft-n-max", "2", "--spec-draft-p-min", "0.75"]
        );
    }

    #[test]
    fn a_full_moe_setup_composes_in_order() {
        let o = LaunchOpts {
            threads: Some(8),
            cpu_moe: Some(0),
            flash_attn: true,
            mlock: true,
            ..Default::default()
        };
        assert_eq!(
            launch_flag_args(&o, Engine::LlamaCpp),
            vec!["--threads", "8", "--cpu-moe", "--flash-attn", "on", "--mlock"]
        );
    }
    // ---- ik_llama.cpp ----
    //
    // Every expectation below was read out of the fork's common/common.cpp, not
    // inferred from the flag's upstream meaning.

    #[test]
    fn shared_flags_are_identical_on_both_engines() {
        // The reason this integration is small: most of the command line needs
        // no translation at all.
        let o = LaunchOpts {
            threads: Some(8),
            cpu_moe: Some(24),
            flash_attn: true,
            mlock: true,
            no_mmap: true,
            ..Default::default()
        };
        assert_eq!(
            launch_flag_args(&o, Engine::IkLlama),
            launch_flag_args(&o, Engine::LlamaCpp)
        );
    }

    #[test]
    fn fit_off_is_silence_on_ik_not_a_flag() {
        // The fork's --fit takes no value and defaults off, so "off" is already
        // the state; upstream's takes one and defaults on. Passing `--fit off`
        // to the fork leaves a bare `off` positional and kills the launch.
        let o = LaunchOpts { fit_off: true, ..Default::default() };
        assert_eq!(launch_flag_args(&o, Engine::LlamaCpp), vec!["--fit", "off"]);
        assert!(launch_flag_args(&o, Engine::IkLlama).is_empty());
    }

    #[test]
    fn fit_target_is_renamed_not_dropped() {
        let o = LaunchOpts { fit_target: Some(256), ..Default::default() };
        assert_eq!(launch_flag_args(&o, Engine::LlamaCpp), vec!["--fit-target", "256"]);
        assert_eq!(launch_flag_args(&o, Engine::IkLlama), vec!["--fit-margin", "256"]);
    }

    #[test]
    fn mtp_uses_the_forks_stage_name_and_drops_knobs_it_lacks() {
        let o = LaunchOpts {
            mtp: true,
            spec_draft_n_max: Some(2),
            spec_draft_p_min: Some(0.75),
            ..Default::default()
        };
        assert_eq!(
            launch_flag_args(&o, Engine::LlamaCpp),
            vec!["--spec-type", "draft-mtp", "--spec-draft-n-max", "2", "--spec-draft-p-min", "0.75"]
        );
        // The fork names the stage `mtp` and has no --spec-draft-* flags at all.
        assert_eq!(launch_flag_args(&o, Engine::IkLlama), vec!["--spec-type", "mtp"]);
    }

    #[test]
    fn ik_only_flags_never_reach_upstream() {
        let o = LaunchOpts {
            rtr: true,
            ser: Some("5,1".into()),
            amb: Some(512),
            ..Default::default()
        };
        assert_eq!(
            launch_flag_args(&o, Engine::IkLlama),
            vec!["-rtr", "-ser", "5,1", "-amb", "512"]
        );
        // Carrying an ik config to an upstream engine must not abort the launch.
        assert!(launch_flag_args(&o, Engine::LlamaCpp).is_empty());
    }

    #[test]
    fn a_blank_ser_is_not_a_flag() {
        // The field is a free-text box in the UI; an empty one means "unset",
        // not "-ser with no value" (which would eat the next argument).
        let o = LaunchOpts { ser: Some("  ".into()), ..Default::default() };
        assert!(launch_flag_args(&o, Engine::IkLlama).is_empty());
    }

    #[test]
    fn a_cpu_only_ik_launch_composes_in_order() {
        let o = LaunchOpts {
            threads: Some(16),
            rtr: true,
            cpu_moe: Some(0),
            flash_attn: true,
            ..Default::default()
        };
        assert_eq!(
            launch_flag_args(&o, Engine::IkLlama),
            vec!["--threads", "16", "--cpu-moe", "--flash-attn", "on", "-rtr"]
        );
    }

    #[test]
    fn engine_deserializes_from_the_names_the_ui_sends() {
        assert_eq!(serde_json::from_str::<Engine>("\"ik_llama\"").unwrap(), Engine::IkLlama);
        assert_eq!(serde_json::from_str::<Engine>("\"llama.cpp\"").unwrap(), Engine::LlamaCpp);
        // An absent engine must mean upstream, so old callers keep working.
        assert_eq!(Engine::default(), Engine::LlamaCpp);
    }
}
