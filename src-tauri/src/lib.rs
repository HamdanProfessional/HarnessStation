mod audio;
mod local;
mod mcp;
mod oauth;
mod py;
mod secret;
mod speech;

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Emitter;

/// Whether closing the window hides to the tray instead of quitting.
static BACKGROUND: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// Frontend mirrors the user's "keep running in the tray" setting here.
#[tauri::command]
fn set_background_mode(enabled: bool) {
    BACKGROUND.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

/// Bring the window back from the tray and focus it.
fn reveal(app: &tauri::AppHandle) {
    if let Some(win) = tauri::Manager::get_webview_window(app, "main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Tray icon: the app keeps running (voice avatar, schedules) with no window open,
/// so there has to be a way back in and an explicit way out.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open = MenuItem::with_id(app, "open", "Open HarnessStation", true, None::<&str>)?;
    let voice = MenuItem::with_id(app, "voice", "Talk to avatar (Ctrl+Shift+V)", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "New chat (Ctrl+Shift+Space)", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &voice, &quick, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::AssetNotFound("default window icon".into())
        })?)
        .tooltip("HarnessStation")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => reveal(app),
            "voice" => {
                reveal(app);
                let _ = app.emit("tray-voice", ());
            }
            "quick" => {
                reveal(app);
                let _ = app.emit("quick-entry", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click restores, matching what every other tray app does.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Frontend-triggered reveal (used when a background reply needs attention).
#[tauri::command]
fn show_main(app: tauri::AppHandle) {
    reveal(&app);
}

/// Reflect live state (listening, spend) in the tray tooltip.
#[tauri::command]
fn set_tray_title(app: tauri::AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(if text.is_empty() {
            "HarnessStation".to_string()
        } else {
            format!("HarnessStation — {text}")
        }));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(local::LocalServer(Mutex::new(None)))
        .manage(local::SttServer(Mutex::new(None)))
        .manage(mcp::McpState(Mutex::new(HashMap::new())))
        .manage(audio::Recorder(Mutex::new(None)))
        .manage(speech::Speaker::default())
        .setup(|app| {
            // Register the quick-entry hotkey after startup. If another instance
            // (or a leftover process) already holds it, log and continue rather
            // than crashing the whole app.
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            if let Err(e) = app.global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+Space",
                |app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(win) = tauri::Manager::get_webview_window(app, "main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                            let _ = app.emit("quick-entry", ());
                        }
                    }
                },
            ) {
                eprintln!("Global quick-entry shortcut unavailable (already registered?): {e}");
            }
            // Push-to-talk: hold Ctrl+Shift+V to talk to the voice avatar from anywhere.
            // Emits both press and release so the frontend can record only while held.
            if let Err(e) = app.global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+V",
                |app, _shortcut, event| {
                    let down = event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed;
                    let _ = app.emit("voice-ptt", down);
                },
            ) {
                eprintln!("Global push-to-talk shortcut unavailable (already registered?): {e}");
            }
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|win, event| {
            // Closing the window hides it instead of quitting, so the voice avatar
            // and schedules keep running in the background. Quit is on the tray menu.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // The frontend clears this flag when background mode is switched off,
                // in which case closing the window really does quit.
                if win.label() == "main" && BACKGROUND.load(std::sync::atomic::Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = win.hide();
                    let _ = win.emit("window-hidden", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            local::hw_info,
            local::platform,
            local::download,
            local::extract_zip,
            local::start_server,
            local::stop_server,
            local::server_status,
            local::transcribe,
            local::stt_serve,
            local::stt_stop,
            local::run_command,
            local::fs_write,
            local::fs_read,
            local::fs_mkdir,
            local::fs_remove,
            local::fs_exists,
            local::fs_list,
            mcp::mcp_connect,
            mcp::mcp_request,
            mcp::mcp_disconnect,
            py::python_schema,
            py::python_run,
            secret::secret_set,
            secret::secret_get,
            secret::secret_delete,
            audio::mic_start,
            audio::mic_stop,
            audio::mic_level,
            audio::mic_active,
            audio::mic_devices,
            speech::speak,
            speech::speak_stop,
            speech::speak_voices,
            speech::winrt_voices,
            speech::winrt_speak,
            speech::piper_speak,
            oauth::mcp_oauth,
            show_main,
            set_tray_title,
            set_background_mode
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                local::kill_on_exit(app);
                local::kill_stt(app);
                let state: tauri::State<mcp::McpState> = tauri::Manager::state(app);
                mcp::kill_all(&state);
            }
        });
}
