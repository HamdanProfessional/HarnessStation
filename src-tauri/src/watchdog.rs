//! Detects a wedged UI and restarts, instead of waiting for Windows to kill it.
//!
//! The app has been dying with exit code 0xcfffffff and Application Hang
//! (Event ID 1002) — "stopped interacting with Windows and was closed". That is
//! not a fault: no panic, no unwind, no crash handler runs. The message loop
//! simply stops being pumped, Windows notices, and terminates the process. From
//! the user's side the window goes white or vanishes with nothing explaining it.
//!
//! Nothing in JavaScript can catch this. Once the webview's thread is stuck, no
//! error boundary, no `unhandledrejection` handler and no timer will ever run
//! again. It has to be watched from outside, by a thread that is not the one
//! that gets stuck — which is what this is.
//!
//! The loop is deliberately dumb: emit a ping, expect the frontend to answer.
//! When enough consecutive pings go unanswered, record what happened and
//! relaunch. The interesting part is not the detection, it is refusing to fire
//! on the several things that look identical to a hang and are not.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

/// How often to ping the webview.
const PING_EVERY: Duration = Duration::from_secs(5);

/// Silence beyond this counts as wedged.
///
/// Generous on purpose. A long synchronous render, a large paste being
/// highlighted, or a slow disk write can all stall the frontend for a couple of
/// seconds, and restarting someone's app mid-conversation because a render took
/// too long is far worse than the hang this is trying to fix.
const HANG_AFTER: Duration = Duration::from_secs(30);

/// Ignore everything until the app has been up this long.
///
/// Boot does a lot of synchronous work — reading settings, hydrating chats,
/// mounting the tree — and a machine under load can genuinely take a while.
/// Firing here would produce a restart loop out of a slow start.
const GRACE: Duration = Duration::from_secs(60);

/// A gap larger than this between ticks means the clock jumped, not that the
/// frontend stopped answering.
///
/// The laptop was suspended, or the host was paused. Every timer in the process
/// stalls together, so the frontend looks unresponsive for the whole sleep. This
/// is the difference between "your app restarted itself overnight" and not.
const SLEEP_GAP: Duration = Duration::from_secs(90);

/// Milliseconds since the epoch of the last message from the frontend.
static LAST_PONG: AtomicU64 = AtomicU64::new(0);

/// Set once a restart is under way, so two detections cannot both relaunch.
static RESTARTING: AtomicBool = AtomicBool::new(false);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The frontend answering a ping. Also called once on boot to start the clock.
#[tauri::command]
pub fn watchdog_pong() {
    LAST_PONG.store(now_ms(), Ordering::Relaxed);
}

/// Where the hang is recorded, so the next launch can explain itself.
fn marker_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().home_dir().ok().map(|h| h.join(".harnessx").join("last-hang.json"))
}

/// Leave a note for the instance that replaces us.
///
/// Written before the relaunch rather than after, because this process is about
/// to exit and may not get another chance.
fn record(app: &tauri::AppHandle, silent_ms: u64) {
    let Some(path) = marker_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let body = format!(
        r#"{{"at":{},"silentMs":{},"version":"{}"}}"#,
        now_ms(),
        silent_ms,
        env!("CARGO_PKG_VERSION")
    );
    let _ = std::fs::write(&path, body);
    eprintln!("[watchdog] UI unresponsive for {silent_ms}ms — restarting. Recorded at {path:?}");
}

/// Was the previous run killed by a hang? Clears the marker as it reads it.
///
/// One-shot on purpose: the notice should appear on the launch after the hang,
/// not on every launch from then on.
#[tauri::command]
pub fn take_hang_report(app: tauri::AppHandle) -> Option<String> {
    let path = marker_path(&app)?;
    let body = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    Some(body)
}

/// Start watching. Call once, from `setup`.
pub fn start(app: tauri::AppHandle) {
    LAST_PONG.store(now_ms(), Ordering::Relaxed);
    let started = now_ms();

    std::thread::spawn(move || {
        // Tracks the previous iteration so a stalled clock can be told apart
        // from a stalled frontend.
        let mut last_tick = now_ms();

        loop {
            std::thread::sleep(PING_EVERY);
            let now = now_ms();
            let tick_gap = now.saturating_sub(last_tick);
            last_tick = now;

            // The whole process was frozen, not just the frontend. Treat the
            // frontend as fine and start the clock again from here.
            if tick_gap > SLEEP_GAP.as_millis() as u64 {
                eprintln!("[watchdog] {tick_gap}ms gap between ticks — clock jumped, not a hang");
                LAST_PONG.store(now, Ordering::Relaxed);
                continue;
            }

            if now.saturating_sub(started) < GRACE.as_millis() as u64 {
                continue;
            }

            // Judge before pinging, not after. `emit` reaches the webview, and
            // against a wedged one it can itself take a long time to return —
            // so pinging first folded that delay into every detection. Measured
            // against a deliberately blocked UI, this ordering was the
            // difference between noticing at ~62s and noticing at the 30s the
            // threshold actually asks for.
            let silent = now.saturating_sub(LAST_PONG.load(Ordering::Relaxed));

            if silent < HANG_AFTER.as_millis() as u64 {
                // Healthy: ask again for the next round.
                let _ = app.emit("watchdog-ping", ());
                continue;
            }

            if RESTARTING.swap(true, Ordering::SeqCst) {
                continue;
            }
            record(&app, silent);

            // Restarting is release-only, and not out of caution.
            //
            // Under `tauri dev` the frontend is served by the vite dev server
            // and this process is a child of the dev supervisor. Re-execing the
            // binary from here makes the supervisor see its child exit and tear
            // the whole toolchain down, vite included — so the "recovered" app
            // comes back to a dead dev server and a genuinely white window,
            // which is the exact symptom the watchdog exists to prevent.
            // Confirmed by doing it: port 1420 was gone afterwards.
            //
            // A packaged build embeds the frontend in the binary and has no
            // supervisor, so there is nothing to lose and restart is correct.
            #[cfg(not(debug_assertions))]
            {
                // Safe from here precisely because this thread is not the wedged
                // one — it is the only part of the process still able to act.
                app.cleanup_before_exit();
                tauri::process::restart(&app.env());
            }
            #[cfg(debug_assertions)]
            {
                eprintln!(
                    "[watchdog] dev build — not restarting (it would kill the vite dev server). \
                     Recorded the hang; restart the app yourself."
                );
            }
        }
    });
}
