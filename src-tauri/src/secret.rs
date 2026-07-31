//! API-key storage backed by the OS keychain (Windows Credential Manager).

const SERVICE: &str = "HarnessStation";

fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_set(id: String, value: String) -> Result<(), String> {
    let e = entry(&id)?;
    if value.is_empty() {
        let _ = e.delete_credential();
        return Ok(());
    }
    e.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(id: String) -> Option<String> {
    entry(&id).ok().and_then(|e| e.get_password().ok())
}

#[tauri::command]
pub fn secret_delete(id: String) -> Result<(), String> {
    if let Ok(e) = entry(&id) {
        let _ = e.delete_credential();
    }
    Ok(())
}
