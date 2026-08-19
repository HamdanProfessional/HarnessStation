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

/// Resolve `path` against `base`; absolute paths pass through, empty base = home dir.
fn resolve(base: &str, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    let b = if base.trim().is_empty() {
        home_dir()
    } else {
        PathBuf::from(base)
    };
    b.join(path)
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
    let target = resolve(&base, &path);
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
    std::fs::read_to_string(resolve(&base, &path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_mkdir(base: String, path: String) -> Result<(), String> {
    std::fs::create_dir_all(resolve(&base, &path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_remove(base: String, path: String) -> Result<(), String> {
    let target = resolve(&base, &path);
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn fs_exists(base: String, path: String) -> bool {
    resolve(&base, &path).exists()
}

#[tauri::command]
pub fn fs_list(base: String, path: String) -> Result<Vec<DirEntry>, String> {
    let dir = resolve(&base, &path);
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
}

/// Build just the optional flag arguments for a set of launch options.
///
/// Pure and separate so the flag translation — the part that silently breaks a
/// launch if a name or shape is wrong — can be unit-tested without spawning a
/// process. Nothing is emitted for an unset field, keeping older engines happy.
fn launch_flag_args(o: &LaunchOpts) -> Vec<String> {
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
    if o.fit_off {
        a.push("--fit".into());
        a.push("off".into());
    }
    if let Some(m) = o.fit_target {
        a.push("--fit-target".into());
        a.push(m.to_string());
    }
    a
}

#[tauri::command]
pub fn start_server(
    state: State<LocalServer>,
    engine_dir: String,
    model_path: String,
    port: u16,
    ctx: u32,
    gpu_layers: i32,
    opts: Option<LaunchOpts>,
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
    args.extend(launch_flag_args(&opts.unwrap_or_default()));

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
        assert!(launch_flag_args(&LaunchOpts::default()).is_empty());
    }

    #[test]
    fn cpu_moe_zero_means_all_experts() {
        let o = LaunchOpts { cpu_moe: Some(0), ..Default::default() };
        assert_eq!(launch_flag_args(&o), vec!["--cpu-moe"]);
    }

    #[test]
    fn cpu_moe_n_offloads_first_n_layers() {
        let o = LaunchOpts { cpu_moe: Some(24), ..Default::default() };
        assert_eq!(launch_flag_args(&o), vec!["--n-cpu-moe", "24"]);
    }

    #[test]
    fn flash_attention_is_on_not_a_bare_flag() {
        // --flash-attn takes on/off in recent llama.cpp; a bare --flash-attn errors.
        let o = LaunchOpts { flash_attn: true, ..Default::default() };
        assert_eq!(launch_flag_args(&o), vec!["--flash-attn", "on"]);
    }

    #[test]
    fn boolean_flags_are_bare() {
        let o = LaunchOpts { mlock: true, no_mmap: true, ..Default::default() };
        assert_eq!(launch_flag_args(&o), vec!["--mlock", "--no-mmap"]);
    }

    #[test]
    fn fit_controls() {
        let off = LaunchOpts { fit_off: true, ..Default::default() };
        assert_eq!(launch_flag_args(&off), vec!["--fit", "off"]);
        let target = LaunchOpts { fit_target: Some(256), ..Default::default() };
        assert_eq!(launch_flag_args(&target), vec!["--fit-target", "256"]);
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
            launch_flag_args(&o),
            vec!["--threads", "8", "--cpu-moe", "--flash-attn", "on", "--mlock"]
        );
    }
}
