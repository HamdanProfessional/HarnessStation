//! In-app browser.
//!
//! A real webview embedded in the app window, positioned over the content pane.
//! The user watches the page and can click it themselves; the model drives it by
//! evaluating JavaScript in the same view. No second application, nothing to
//! install.
//!
//! Sessions live inside the app: the webview uses the app's own WebView2/WebKit
//! data directory, so a login persists across restarts and belongs to
//! HarnessStation rather than to the user's Chrome profile.
//!
//! Reading values back uses `eval_with_callback`, which serialises the
//! expression's result to JSON. Exceptions are swallowed by the platform, so
//! every injected snippet catches its own errors and returns them as data.

use serde_json::Value;
use std::time::Duration;
use tauri::{Manager, WebviewUrl};

const LABEL: &str = "inapp-browser";
const EVAL_TIMEOUT: Duration = Duration::from_secs(20);

fn webview<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<tauri::Webview<R>> {
    app.webviews().get(LABEL).cloned()
}

/// Run JS in the page and return its JSON result.
///
/// The snippet is wrapped so a thrown error comes back as `{"__error": "..."}`
/// instead of vanishing — on Windows the platform drops exceptions silently,
/// which would otherwise look like a hang.
///
/// This *must* stay async, and must never block a thread waiting for the reply.
/// WebView2 delivers the callback on the thread that owns the window — the main
/// thread — so a blocking wait anywhere it can reach deadlocks the whole app:
/// the waiter is holding the thread that would deliver the value it waits for.
/// The window stops pumping messages and the app freezes having burned no CPU,
/// which is precisely how it presented. Awaiting a oneshot parks the task rather
/// than the thread, so the main thread stays free to deliver the callback.
async fn eval_json<R: tauri::Runtime>(
    view: &tauri::Webview<R>,
    expr: &str,
) -> Result<Value, String> {
    let wrapped = format!(
        "(() => {{ try {{ return JSON.stringify({{ ok: (function(){{ {expr} }})() }}); }} \
         catch (e) {{ return JSON.stringify({{ __error: String(e && e.message || e) }}); }} }})()"
    );
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    // The callback is `Fn`, not `FnOnce`, so the sender lives in a slot it takes.
    let tx = std::sync::Mutex::new(Some(tx));
    view.eval_with_callback(wrapped, move |raw| {
        if let Ok(mut slot) = tx.lock() {
            if let Some(tx) = slot.take() {
                let _ = tx.send(raw);
            }
        }
    })
    .map_err(|e| e.to_string())?;

    let raw = tokio::time::timeout(EVAL_TIMEOUT, rx)
        .await
        .map_err(|_| "the page didn't respond — it may still be loading".to_string())?
        .map_err(|_| "the page went away before replying".to_string())?;

    // The callback gives us a JSON string *containing* our JSON string.
    let inner: String = serde_json::from_str(&raw).unwrap_or(raw);
    let value: Value = serde_json::from_str(&inner)
        .map_err(|e| format!("could not read the page's reply: {e}"))?;

    if let Some(err) = value.get("__error").and_then(Value::as_str) {
        return Err(err.to_string());
    }
    Ok(value.get("ok").cloned().unwrap_or(Value::Null))
}

/// Create the browser pane, or move it if it already exists.
#[tauri::command]
pub async fn inapp_open(
    app: tauri::AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("url must start with http:// or https://".into());
    }
    let parsed: url::Url = url.parse().map_err(|_| "that isn't a valid URL".to_string())?;

    if let Some(view) = webview(&app) {
        view.navigate(parsed).map_err(|e| e.to_string())?;
        view.set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        view.set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        view.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let builder = tauri::webview::WebviewBuilder::new(LABEL, WebviewUrl::External(parsed))
        // The pane is a plain browser: the app's own IPC is not exposed to it, so
        // a page can't reach HarnessStation's commands.
        .initialization_script(
            "window.__HARNESS_PANE__ = true;",
        );

    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Keep the pane aligned with the React layout as the window resizes.
#[tauri::command]
pub async fn inapp_bounds(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let Some(view) = webview(&app) else { return Ok(()) };
    view.set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    view.set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Hide the pane when the user navigates away from the Browser view.
#[tauri::command]
pub async fn inapp_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(view) = webview(&app) {
        view.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn inapp_show(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(view) = webview(&app) {
        view.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn inapp_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(view) = webview(&app) {
        view.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Whether the pane exists, and where it is.
#[tauri::command]
pub async fn inapp_status(app: tauri::AppHandle) -> Result<Value, String> {
    let Some(view) = webview(&app) else {
        return Ok(serde_json::json!({ "open": false }));
    };
    let url = view.url().map(|u| u.to_string()).unwrap_or_default();
    let title = eval_json(&view, "return document.title;")
        .await
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    Ok(serde_json::json!({ "open": true, "url": url, "title": title }))
}

/// Evaluate a snippet in the page and return its value. Used by the tools.
#[tauri::command]
pub async fn inapp_eval(app: tauri::AppHandle, expr: String) -> Result<Value, String> {
    let view = webview(&app)
        .ok_or_else(|| "the in-app browser isn't open — call open_url first".to_string())?;
    eval_json(&view, &expr).await
}

/// Navigate the existing pane.
#[tauri::command]
pub async fn inapp_navigate(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let view = webview(&app)
        .ok_or_else(|| "the in-app browser isn't open — call open_url first".to_string())?;
    let parsed: url::Url = url.parse().map_err(|_| "that isn't a valid URL".to_string())?;
    view.navigate(parsed).map_err(|e| e.to_string())
}
