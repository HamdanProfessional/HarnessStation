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
    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
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

#[tauri::command]
pub fn mic_start(device: Option<String>, state: State<Recorder>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    // Never fail with "already recording": a stale session (view switch, aborted turn,
    // leftover mic test) is simply discarded so the new one can start cleanly.
    if let Some(old) = guard.take() {
        old.stop.store(true, Ordering::Relaxed);
        let _ = old.handle.join();
    }
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let level = Arc::new(AtomicU32::new(0));
    let level2 = level.clone();
    let want = device.filter(|d| !d.trim().is_empty());
    let handle = std::thread::spawn(move || record_thread(stop2, level2, want));
    *guard = Some(RecState { stop, level, handle });
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
pub fn mic_stop(state: State<Recorder>) -> Result<String, String> {
    let rec = state.0.lock().unwrap().take().ok_or("not recording")?;
    rec.stop.store(true, Ordering::Relaxed);
    let (samples, rate) = rec
        .handle
        .join()
        .map_err(|_| "recording thread panicked")??;
    let pcm = if rate == 16000 { samples } else { resample(&samples, rate, 16000) };
    let dir = crate::local::harness_root().join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("dictation.wav");
    write_wav(&path, &pcm, 16000).map_err(|e| e.to_string())?;
    Ok("tmp/dictation.wav".into())
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
