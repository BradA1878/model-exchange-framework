//! MXF Desktop — Session IPC Handler
//!
//! Manages session persistence to ~/.mxf/sessions/. Saves and loads
//! conversation history so sessions survive app restarts.
//!
//! @author Brad Anderson <BradA1878@pm.me>

use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// Get the sessions directory (~/.mxf/sessions/)
fn sessions_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let dir = home.join(".mxf").join("sessions");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create sessions directory: {}", e))?;
    }
    Ok(dir)
}

/// Save session data to a JSON file
#[tauri::command]
pub fn save_session(session_id: String, data: Value) -> Result<(), String> {
    let dir = sessions_dir()?;
    let path = dir.join(format!("{}.json", session_id));
    let contents = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;
    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write session: {}", e))?;
    Ok(())
}

/// Load session data from a JSON file
#[tauri::command]
pub fn load_session(session_id: String) -> Result<Value, String> {
    let dir = sessions_dir()?;
    let path = dir.join(format!("{}.json", session_id));
    if !path.exists() {
        return Err(format!("Session not found: {}", session_id));
    }
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read session: {}", e))?;
    let data: Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse session: {}", e))?;
    Ok(data)
}

/// List all saved session IDs
#[tauri::command]
pub fn list_sessions() -> Result<Vec<String>, String> {
    let dir = sessions_dir()?;
    let mut sessions = Vec::new();

    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read sessions directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            if let Some(stem) = path.file_stem() {
                sessions.push(stem.to_string_lossy().to_string());
            }
        }
    }

    sessions.sort();
    Ok(sessions)
}

/// Delete a saved session
#[tauri::command]
pub fn delete_session(session_id: String) -> Result<(), String> {
    let dir = sessions_dir()?;
    let path = dir.join(format!("{}.json", session_id));
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete session: {}", e))?;
    }
    Ok(())
}
