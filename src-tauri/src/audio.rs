//! Native microphone capture via cpal — avoids the WebView2 getUserMedia permission prompt.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::State;

pub struct Recorder(pub Mutex<Option<RecState>>);

pub struct RecState {
    stop: Arc<AtomicBool>,
    /// Most recent input RMS (f32 bits) — drives the voice orb + silence detection.
    level: Arc<AtomicU32>,
    /// Live capture buffer, shared with the recording thread so a segment can be
    /// taken mid-flight. Without this the mic has to stop to produce a WAV, which
    /// is what made the avatar deaf while it was transcribing and replying.
    samples: Arc<Mutex<Vec<f32>>>,
    /// Device sample rate, published once the stream is open (0 until then).
    rate: Arc<AtomicU32>,
    handle: JoinHandle<Result<(Vec<f32>, u32), String>>,
}

fn store_level(level: &AtomicU32, block: &[f32]) {
    if block.is_empty() {
        return;
    }
    let sum: f32 = block.iter().map(|s| s * s).sum();
    let rms = (sum / block.len() as f32).sqrt();
    level.store(rms.to_bits(), Ordering::Relaxed);
}

/// List the names of available input devices (first entry is the system default).
#[tauri::command]
pub fn mic_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let default = host.default_input_device().and_then(|d| d.name().ok());
    let mut names: Vec<String> = host
        .input_devices()
        .map_err(|e| e.to_string())?
        .filter_map(|d| d.name().ok())
        .collect();
    names.sort();
    names.dedup();
    if let Some(d) = default {
        names.retain(|n| n != &d);
        names.insert(0, d);
    }
    Ok(names)
}

fn record_thread(
    stop: Arc<AtomicBool>,
    level: Arc<AtomicU32>,
    samples: Arc<Mutex<Vec<f32>>>,
    rate_out: Arc<AtomicU32>,
    want: Option<String>,
) -> Result<(Vec<f32>, u32), String> {
    let host = cpal::default_host();
    // Use the requested device when it's still present, else fall back to the default.
    let device = want
        .and_then(|name| {
            host.input_devices()
                .ok()?
                .find(|d| d.name().map(|n| n == name).unwrap_or(false))
        })
        .or_else(|| host.default_input_device())
        .ok_or("no microphone / input device found")?;
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    rate_out.store(sample_rate, Ordering::Relaxed);
    let s2 = samples.clone();
    let err_fn = |e| eprintln!("mic stream error: {e}");
    let l_f32 = level.clone();
    let l_i16 = level.clone();
    let l_u16 = level.clone();

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &_| {
                let mut buf = s2.lock().unwrap();
                let start = buf.len();
                for frame in data.chunks(channels) {
                    buf.push(frame.iter().sum::<f32>() / channels as f32);
                }
                store_level(&l_f32, &buf[start..]);
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _: &_| {
                let mut buf = s2.lock().unwrap();
                let start = buf.len();
                for frame in data.chunks(channels) {
                    let sum: f32 = frame.iter().map(|&x| x as f32 / 32768.0).sum();
                    buf.push(sum / channels as f32);
                }
                store_level(&l_i16, &buf[start..]);
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config.into(),
            move |data: &[u16], _: &_| {
                let mut buf = s2.lock().unwrap();
                let start = buf.len();
                for frame in data.chunks(channels) {
                    let sum: f32 = frame.iter().map(|&x| (x as f32 - 32768.0) / 32768.0).sum();
                    buf.push(sum / channels as f32);
                }
                store_level(&l_u16, &buf[start..]);
            },
            err_fn,
            None,
        ),
        _ => return Err("unsupported audio sample format".into()),
    }
    .map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    drop(stream);
    let data = samples.lock().unwrap().clone();
    Ok((data, sample_rate))
}

/// Wait for a capture thread to finish, off the main thread and with a deadline.
///
/// Joining a thread from a synchronous command runs on the UI thread, and
/// tearing down a cpal stream can stall — a device removed mid-recording, a
/// driver that doesn't return. That froze the whole window: no CPU burned, no
/// message pump, nothing to see. Now the wait happens on a blocking worker and
/// gives up after a few seconds; a thread that won't die costs one pool thread
/// instead of the application.
async fn join_capture(
    handle: JoinHandle<Result<(Vec<f32>, u32), String>>,
) -> Result<(Vec<f32>, u32), String> {
    let joined = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::task::spawn_blocking(move || handle.join()),
    )
    .await
    .map_err(|_| {
        "the microphone didn't release — the device may have been unplugged".to_string()
    })?
    .map_err(|e| e.to_string())?;

    joined.map_err(|_| "recording thread panicked".to_string())?
}

#[tauri::command]
pub async fn mic_start(
    device: Option<String>,
    state: State<'_, Recorder>,
) -> Result<(), String> {
    // Never fail with "already recording": a stale session (view switch, aborted turn,
    // leftover mic test) is simply discarded so the new one can start cleanly.
    // The guard is scoped so it can't be held across the await below.
    let old = {
        let mut guard = state.0.lock().unwrap();
        guard.take()
    };
    if let Some(old) = old {
        old.stop.store(true, Ordering::Relaxed);
        // A previous device that won't let go must not stop us opening a new one.
        let _ = join_capture(old.handle).await;
    }
    let mut guard = state.0.lock().unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let level = Arc::new(AtomicU32::new(0));
    let level2 = level.clone();
    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
    let samples2 = samples.clone();
    let rate = Arc::new(AtomicU32::new(0));
    let rate2 = rate.clone();
    let want = device.filter(|d| !d.trim().is_empty());
    let handle = std::thread::spawn(move || record_thread(stop2, level2, samples2, rate2, want));
    *guard = Some(RecState {
        stop,
        level,
        samples,
        rate,
        handle,
    });
    Ok(())
}

/// Current microphone RMS level (0..~1). Returns 0 when not recording.
#[tauri::command]
pub fn mic_level(state: State<Recorder>) -> f32 {
    match &*state.0.lock().unwrap() {
        Some(rec) => f32::from_bits(rec.level.load(Ordering::Relaxed)),
        None => 0.0,
    }
}

/// True while a recording is in progress.
#[tauri::command]
pub fn mic_active(state: State<Recorder>) -> bool {
    state.0.lock().unwrap().is_some()
}

/// Stop recording, write a 16 kHz mono WAV to ~/.harnessx/tmp/dictation.wav, return its relative path.
#[tauri::command]
pub async fn mic_stop(state: State<'_, Recorder>) -> Result<String, String> {
    let rec = {
        let mut guard = state.0.lock().unwrap();
        guard.take()
    }
    .ok_or("not recording")?;
    rec.stop.store(true, Ordering::Relaxed);
    let (samples, rate) = join_capture(rec.handle).await?;
    let pcm = if rate == 16000 { samples } else { resample(&samples, rate, 16000) };
    let dir = crate::local::harness_root().join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("dictation.wav");
    write_wav(&path, &pcm, 16000).map_err(|e| e.to_string())?;
    Ok("tmp/dictation.wav".into())
}

/// Write the captured audio so far to a WAV without stopping the recording.
///
/// `take` clears the buffer afterwards, so the next segment starts fresh; leaving
/// it false gives a rolling snapshot for live transcription. Either way the mic
/// keeps running, which is what lets the avatar hear you while it is still
/// transcribing or answering the previous thing you said.
fn dump(state: &State<Recorder>, name: &str, take: bool) -> Result<String, String> {
    let guard = state.0.lock().unwrap();
    let rec = guard.as_ref().ok_or("not recording")?;
    let rate = rec.rate.load(Ordering::Relaxed);
    if rate == 0 {
        return Err("microphone still opening".into());
    }
    let pcm_raw = {
        let mut buf = rec.samples.lock().unwrap();
        if take {
            std::mem::take(&mut *buf)
        } else {
            buf.clone()
        }
    };
    if pcm_raw.is_empty() {
        return Err("no audio captured".into());
    }
    let pcm = if rate == 16000 {
        pcm_raw
    } else {
        resample(&pcm_raw, rate, 16000)
    };
    let dir = crate::local::harness_root().join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_wav(&dir.join(name), &pcm, 16000).map_err(|e| e.to_string())?;
    Ok(format!("tmp/{name}"))
}

/// Take the audio so far as a segment and keep recording. Used per utterance.
#[tauri::command]
pub fn mic_take(state: State<Recorder>) -> Result<String, String> {
    dump(&state, "segment.wav", true)
}

/// Copy the audio so far without consuming it — for rolling live transcription.
#[tauri::command]
pub fn mic_snapshot(state: State<Recorder>) -> Result<String, String> {
    dump(&state, "partial.wav", false)
}

fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f32 / to as f32;
    let out_len = (input.len() as f32 / ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f32 * ratio;
        let i0 = pos as usize;
        let i1 = (i0 + 1).min(input.len() - 1);
        let frac = pos - i0 as f32;
        out.push(input[i0] + (input[i1] - input[i0]) * frac);
    }
    out
}

fn write_wav(path: &std::path::Path, pcm: &[f32], sample_rate: u32) -> std::io::Result<()> {
    let mut f = std::fs::File::create(path)?;
    let data_len = (pcm.len() * 2) as u32;
    let byte_rate = sample_rate * 2;
    f.write_all(b"RIFF")?;
    f.write_all(&(36 + data_len).to_le_bytes())?;
    f.write_all(b"WAVE")?;
    f.write_all(b"fmt ")?;
    f.write_all(&16u32.to_le_bytes())?;
    f.write_all(&1u16.to_le_bytes())?; // PCM
    f.write_all(&1u16.to_le_bytes())?; // mono
    f.write_all(&sample_rate.to_le_bytes())?;
    f.write_all(&byte_rate.to_le_bytes())?;
    f.write_all(&2u16.to_le_bytes())?; // block align
    f.write_all(&16u16.to_le_bytes())?; // bits per sample
    f.write_all(b"data")?;
    f.write_all(&data_len.to_le_bytes())?;
    for &s in pcm {
        let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        f.write_all(&v.to_le_bytes())?;
    }
    Ok(())
}
