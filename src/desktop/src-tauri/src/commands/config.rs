//! MXF Desktop — Config IPC Handler
//!
//! Reads and writes the MXF config file (~/.mxf/config.json) from the
//! Rust backend. The frontend calls these via Tauri IPC to get server
//! connection details, LLM settings, and user preferences.
//!
//! @author Brad Anderson <BradA1878@pm.me>

use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// Get the path to the MXF config file (~/.mxf/config.json)
fn config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".mxf").join("config.json"))
}

/// Read the entire MXF config as a JSON value
#[tauri::command]
pub fn read_config() -> Result<Value, String> {
    let path = config_path()?;
    if !path.exists() {
        return Err("MXF config not found. Run `mxf install` first.".to_string());
    }
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let config: Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    Ok(config)
}

/// Get a specific config value by dot-notation path (e.g., "server.port")
#[tauri::command]
pub fn get_config_value(path: String) -> Result<Value, String> {
    let config = read_config()?;
    let mut current = &config;

    for key in path.split('.') {
        current = current.get(key).ok_or_else(|| format!("Config key not found: {}", path))?;
    }

    Ok(current.clone())
}

/// Get the MXF config file path
#[tauri::command]
pub fn get_config_path() -> Result<String, String> {
    let path = config_path()?;
    Ok(path.to_string_lossy().to_string())
}
