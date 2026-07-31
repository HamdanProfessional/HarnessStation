//! Built-in text-to-speech, per platform.
//!
//! Windows: SAPI voices via System.Speech. A single long-lived PowerShell host is kept
//! alive and fed utterances over stdin — spawning a process per sentence costs 1–2 s and
//! made streamed replies stutter. Voices installed through Settings live in a second
//! registry (OneCore) that System.Speech cannot see, so those go through WinRT instead.
//!
//! Linux: speech-dispatcher (`spd-say`) if present, else `espeak-ng`. Both start in
//! milliseconds, so there is no persistent host to keep — each utterance is its own
//! process, tracked so barge-in can kill it. espeak-ng understands the same SSML we
//! generate, so the breath pauses and prosody carry over.

use std::io::Write; // piper_speak feeds text over stdin on every platform
#[cfg(windows)]
use std::io::{BufRead, BufReader};
#[cfg(windows)]
use std::process::{Child, ChildStdin, ChildStdout};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::State;

#[cfg(windows)]
const HOST_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq '<<QUIT>>') { break }
  if ($line.StartsWith('<<RATE>>')) {
    try { $synth.Rate = [int]$line.Substring(8) } catch { }
    [Console]::Out.WriteLine('<<DONE>>'); [Console]::Out.Flush(); continue
  }
  if ($line.StartsWith('<<VOICE>>')) {
    try { $synth.SelectVoice($line.Substring(9)) } catch { }
    [Console]::Out.WriteLine('<<DONE>>'); [Console]::Out.Flush(); continue
  }
  $text = $line.Replace([char]1, "`n")
  # SSML gets us real pauses and pitch/rate shaping; plain text is the fallback.
  try {
    if ($text.StartsWith('<speak')) { $synth.SpeakSsml($text) } else { $synth.Speak($text) }
  } catch {
    try { $synth.Speak(($text -replace '<[^>]+>','')) } catch { }
  }
  [Console]::Out.WriteLine('<<DONE>>')
  [Console]::Out.Flush()
}
"#;

#[cfg(windows)]
pub struct Host {
    child: Child,
    stdin: ChildStdin,
    out: BufReader<ChildStdout>,
    voice: String,
    rate: i32,
}

#[derive(Default)]
pub struct Speaker(pub Arc<Mutex<Option<Host>>>);

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

#[cfg(windows)]
fn script_path() -> Result<std::path::PathBuf, String> {
    let dir = crate::local::harness_root().join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("tts-host.ps1");
    // Rewrite each launch so an updated script always wins.
    std::fs::write(&path, HOST_SCRIPT.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(windows)]
fn spawn_host(voice: &str, rate: i32) -> Result<Host, String> {
    let script = script_path()?;
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &script.to_string_lossy(),
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("no stdin on speech host")?;
    let out = BufReader::new(child.stdout.take().ok_or("no stdout on speech host")?);
    let mut host = Host {
        child,
        stdin,
        out,
        voice: String::new(),
        rate: i32::MIN,
    };
    host.configure(voice, rate)?;
    Ok(host)
}

#[cfg(windows)]
impl Host {
    fn send(&mut self, line: &str) -> Result<(), String> {
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|e| e.to_string())
    }

    fn await_done(&mut self) -> Result<(), String> {
        let mut buf = String::new();
        loop {
            buf.clear();
            let n = self.out.read_line(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("speech host exited".into());
            }
            if buf.trim_end() == "<<DONE>>" {
                return Ok(());
            }
        }
    }

    fn configure(&mut self, voice: &str, rate: i32) -> Result<(), String> {
        if self.rate != rate {
            self.send(&format!("<<RATE>>{}", rate.clamp(-10, 10)))?;
            self.await_done()?;
            self.rate = rate;
        }
        if self.voice != voice {
            if !voice.trim().is_empty() {
                self.send(&format!("<<VOICE>>{voice}"))?;
                self.await_done()?;
            }
            self.voice = voice.to_string();
        }
        Ok(())
    }

    fn speak(&mut self, text: &str) -> Result<(), String> {
        // The protocol is line-based; encode newlines as \x01 and restore them in PowerShell.
        let one_line = text.replace("\r\n", "\n").replace('\n', "\u{1}");
        self.send(&one_line)?;
        self.await_done()
    }
}


// ---------- Linux ----------

#[cfg(unix)]
pub struct Host {
    voice: String,
    rate: i32,
}

/// The utterance currently playing, so speak_stop can kill it without waiting on the
/// lock that speak() holds for the whole of playback.
#[cfg(unix)]
static SPEAKING: Mutex<Option<u32>> = Mutex::new(None);

/// First engine actually installed. spd-say honours the user's desktop speech settings,
/// so it wins when available.
#[cfg(unix)]
fn pick_engine() -> Option<&'static str> {
    for exe in ["spd-say", "espeak-ng", "espeak"] {
        if Command::new("which")
            .arg(exe)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Some(exe);
        }
    }
    None
}

#[cfg(unix)]
fn spawn_host(voice: &str, rate: i32) -> Result<Host, String> {
    if pick_engine().is_none() {
        return Err("No speech engine found. Install one with `sudo apt install espeak-ng` \
                    (or speech-dispatcher), or pick the Piper neural voice in Settings — \
                    Piper is self-contained and needs nothing from the system."
            .into());
    }
    Ok(Host { voice: voice.to_string(), rate })
}

#[cfg(unix)]
impl Host {
    fn configure(&mut self, voice: &str, rate: i32) -> Result<(), String> {
        self.voice = voice.to_string();
        self.rate = rate;
        Ok(())
    }

    fn speak(&mut self, text: &str) -> Result<(), String> {
        let engine = pick_engine().ok_or("no speech engine installed")?;
        let mut cmd = Command::new(engine);
        if engine == "spd-say" {
            // -w waits for playback so the caller's await matches reality.
            cmd.arg("-w");
            if !self.voice.trim().is_empty() {
                cmd.args(["-y", &self.voice]);
            }
            // SAPI rate is -10..10; spd-say is -100..100.
            cmd.args(["-r", &(self.rate.clamp(-10, 10) * 10).to_string()]);
            // spd-say has no SSML mode, so strip the tags rather than reading them aloud.
            cmd.arg("--").arg(strip_tags(text));
        } else {
            if !self.voice.trim().is_empty() {
                cmd.args(["-v", &self.voice]);
            }
            // espeak default is 175 wpm; map -10..10 onto roughly 95..255.
            cmd.args(["-s", &(175 + self.rate.clamp(-10, 10) * 8).to_string()]);
            // -m enables SSML, so our breath pauses and prosody survive.
            if text.starts_with("<speak") {
                cmd.arg("-m");
            }
            cmd.arg("--").arg(text);
        }
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("{engine}: {e}"))?;
        *SPEAKING.lock().unwrap() = Some(child.id());
        let out = child.wait_with_output().map_err(|e| e.to_string());
        *SPEAKING.lock().unwrap() = None;
        let out = out?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            // A killed process is a barge-in, not a failure.
            if out.status.code().is_some() && !err.trim().is_empty() {
                return Err(format!("{engine}: {}", err.trim().chars().take(200).collect::<String>()));
            }
        }
        Ok(())
    }
}

#[cfg(unix)]
fn strip_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Kill whatever is speaking right now (barge-in).
#[cfg(unix)]
fn kill_speaking() {
    if let Some(pid) = SPEAKING.lock().unwrap().take() {
        let _ = Command::new("kill").arg("-TERM").arg(pid.to_string()).status();
    }
    // spd-say queues server-side, so also tell the daemon to shut up.
    let _ = Command::new("spd-say")
        .arg("-C")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// espeak-ng exposes its voice table directly; format matches the Windows one.
#[cfg(unix)]
fn list_voices_unix() -> Vec<String> {
    let out = match Command::new("espeak-ng").arg("--voices").output() {
        Ok(o) if o.status.success() => o,
        _ => match Command::new("espeak").arg("--voices").output() {
            Ok(o) if o.status.success() => o,
            _ => return Vec::new(),
        },
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .skip(1) // header row
        .filter_map(|l| {
            let cols: Vec<&str> = l.split_whitespace().collect();
            // Pty Language Age/Gender VoiceName File Other
            if cols.len() < 4 {
                return None;
            }
            Some(format!("{}	{}", cols[3], cols[1]))
        })
        .collect()
}

/// Speak `text` aloud, resolving when playback finishes.
#[tauri::command]
pub async fn speak(
    text: String,
    voice: Option<String>,
    rate: Option<i32>,
    state: State<'_, Speaker>,
) -> Result<(), String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Ok(());
    }
    let slot = state.0.clone();
    let want_voice = voice.unwrap_or_default();
    let want_rate = rate.unwrap_or(1);

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut guard = slot.lock().unwrap();
        if guard.is_none() {
            *guard = Some(spawn_host(&want_voice, want_rate)?);
        }
        // A dead or misconfigured host is replaced transparently.
        let needs_restart = match guard.as_mut() {
            Some(h) => h.configure(&want_voice, want_rate).is_err(),
            None => true,
        };
        if needs_restart {
            *guard = Some(spawn_host(&want_voice, want_rate)?);
        }
        let host = guard.as_mut().ok_or("speech host unavailable")?;
        if host.speak(&trimmed).is_err() {
            // Host died mid-utterance (usually a barge-in kill): respawn and retry once.
            let mut fresh = spawn_host(&want_voice, want_rate)?;
            let res = fresh.speak(&trimmed);
            *guard = Some(fresh);
            return res;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop speaking immediately (barge-in) by dropping the host; the next call respawns it.
#[tauri::command]
pub fn speak_stop(state: State<Speaker>) {
    #[cfg(windows)]
    if let Some(mut host) = state.0.lock().unwrap().take() {
        let _ = host.child.kill();
        let _ = host.child.wait();
    }
    // Don't take the lock here — speak() holds it for the whole utterance, which is
    // exactly the thing being interrupted.
    #[cfg(unix)]
    {
        let _ = &state;
        kill_speaking();
    }
}

/// Voices installed through Windows Settings ("Speech" / language packs) register under
/// Speech_OneCore and are invisible to System.Speech — which is why non-English speech
/// silently does nothing. These are reachable only through the WinRT synthesizer, so we
/// drive that from PowerShell and hand back a WAV.
#[cfg(windows)]
const WINRT_PRELUDE: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
"#;

/// Every voice the WinRT synthesizer can use, as "DisplayName<TAB>language".
#[tauri::command]
pub async fn winrt_voices() -> Result<Vec<String>, String> {
    winrt_voices_impl().await
}

/// WinRT is a Windows API; on Linux every voice already came from speak_voices.
#[cfg(unix)]
async fn winrt_voices_impl() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

#[cfg(windows)]
async fn winrt_voices_impl() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<String>, String> {
        let script = format!(
            "{WINRT_PRELUDE}\n[Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | \
             ForEach-Object {{ \"$($_.DisplayName)`t$($_.Language)\" }}"
        );
        let out = run_ps(&script)?;
        Ok(out
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Synthesize with a WinRT voice into `out_wav` (relative to ~/.harnessx).
#[tauri::command]
pub async fn winrt_speak(text: String, voice: String, out_wav: String) -> Result<String, String> {
    winrt_speak_impl(text, voice, out_wav).await
}

#[cfg(unix)]
async fn winrt_speak_impl(_t: String, _v: String, _o: String) -> Result<String, String> {
    Err("WinRT speech is Windows-only".into())
}

#[cfg(windows)]
async fn winrt_speak_impl(text: String, voice: String, out_wav: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let out_path = crate::local::harness_root().join(&out_wav);
        if let Some(dir) = out_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        // Text and voice go in as base64 so quoting and non-Latin scripts survive.
        let enc = |s: &str| base64_encode(s.as_bytes());
        let script = format!(
            r#"{WINRT_PRELUDE}
$text  = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}'))
$vname = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}'))
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
if ($vname) {{
  $v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
       Where-Object {{ $_.DisplayName -eq $vname }} | Select-Object -First 1
  if ($v) {{ $synth.Voice = $v }} else {{ throw "voice not installed: $vname" }}
}}
$stream = Await $synth.SynthesizeTextToStreamAsync($text) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = New-Object Windows.Storage.Streams.DataReader($stream)
Await $reader.LoadAsync([uint32]$stream.Size) ([uint32]) | Out-Null
$bytes = New-Object byte[] ([int]$stream.Size)
$reader.ReadBytes($bytes)
[IO.File]::WriteAllBytes('{}', $bytes)
"#,
            enc(&text),
            enc(&voice),
            out_path.to_string_lossy().replace('\'', "''"),
        );
        run_ps(&script)?;
        if !out_path.exists() {
            return Err("the Windows voice produced no audio".into());
        }
        Ok(out_wav)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Run a PowerShell script from a temp file (avoids -Command quoting limits).
#[cfg(windows)]
fn run_ps(script: &str) -> Result<String, String> {
    let dir = crate::local::harness_root().join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("winrt-tts.ps1");
    // UTF-8 BOM so PowerShell 5.1 reads non-ASCII in the script correctly.
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(script.as_bytes());
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &path.to_string_lossy(),
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    no_window(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let tail = err.trim().lines().take(3).collect::<Vec<_>>().join(" | ");
        return Err(if tail.is_empty() {
            "Windows speech failed".to_string()
        } else {
            tail.chars().take(300).collect::<String>()
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg(windows)]
fn base64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for c in input.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Synthesize `text` to a WAV with Piper (offline neural TTS) and return the file path
/// relative to ~/.harnessx. Paths are relative to that root, like the whisper commands.
#[tauri::command]
pub async fn piper_speak(
    engine_dir: String,
    model: String,
    text: String,
    out_wav: String,
    length_scale: Option<f32>,
    noise_w: Option<f32>,
    sentence_silence: Option<f32>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let root = crate::local::harness_root();
        let exe = crate::local::find_exe(&root.join(&engine_dir), "piper.exe")
            .ok_or("piper.exe not found — the voice engine may still be downloading")?;
        let model_path = root.join(&model);
        if !model_path.exists() {
            return Err(format!("voice model missing at {}", model_path.display()));
        }
        let out_path = root.join(&out_wav);
        if let Some(dir) = out_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let mut cmd = Command::new(&exe);
        cmd.args([
            "--model",
            &model_path.to_string_lossy(),
            "--output_file",
            &out_path.to_string_lossy(),
        ]);
        // Naturalness knobs: pacing, per-phoneme duration variability (less robotic
        // metronome feel), and the pause left between sentences.
        if let Some(v) = length_scale {
            cmd.args(["--length_scale", &v.to_string()]);
        }
        if let Some(v) = noise_w {
            cmd.args(["--noise_w", &v.to_string()]);
        }
        if let Some(v) = sentence_silence {
            cmd.args(["--sentence_silence", &v.to_string()]);
        }
        cmd.stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
        if let Some(dir) = exe.parent() {
            cmd.current_dir(dir); // espeak-ng-data sits next to the exe
        }
        no_window(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        {
            let mut stdin = child.stdin.take().ok_or("no stdin on piper")?;
            stdin
                .write_all(text.replace('\n', " ").as_bytes())
                .map_err(|e| e.to_string())?;
        } // dropping stdin signals EOF
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            let tail = err.trim().lines().rev().take(2).collect::<Vec<_>>().join(" | ");
            return Err(format!("piper failed: {}", tail.chars().take(300).collect::<String>()));
        }
        Ok(out_wav)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Names of the installed Windows voices, for the voice picker in Settings.
#[tauri::command]
pub async fn speak_voices() -> Result<Vec<String>, String> {
    voices_impl().await
}

#[cfg(unix)]
async fn voices_impl() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(list_voices_unix)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
async fn voices_impl() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<String>, String> {
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            // "Name<TAB>culture" so the picker can match a voice to the spoken language.
            "Add-Type -AssemblyName System.Speech; \
             (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | \
             ForEach-Object { \"$($_.VoiceInfo.Name)`t$($_.VoiceInfo.Culture.Name)\" }",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
        no_window(&mut cmd);
        let out = cmd.output().map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
