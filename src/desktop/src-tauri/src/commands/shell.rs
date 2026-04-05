//! MXF Desktop — Shell Command IPC Handler
//!
//! Executes shell commands from the frontend via Tauri IPC.
//! Streams stdout/stderr back to the webview as the command runs.
//! Supports working directory tracking and process termination.
//!
//! @author Brad Anderson <BradA1878@pm.me>

use serde::Serialize;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Get the MXF project root directory.
///
/// In dev mode, walks up from the current directory to find the root
/// (identified by package.json containing "model-exchange-framework").
/// Falls back to env var MXF_PROJECT_ROOT or a relative path from src-tauri.
#[tauri::command]
pub fn get_project_root() -> Result<String, String> {
    // Check env var first
    if let Ok(root) = std::env::var("MXF_PROJECT_ROOT") {
        if std::path::Path::new(&root).join("package.json").exists() {
            return Ok(root);
        }
    }

    // Walk up from the current working directory looking for the MXF root
    let start = std::env::current_dir().map_err(|e| format!("Cannot get cwd: {}", e))?;
    let mut dir = start.as_path();

    loop {
        let pkg = dir.join("package.json");
        if pkg.exists() {
            // Check if this is the MXF project root (has src/desktop/ dir)
            if dir.join("src").join("desktop").exists() {
                return Ok(dir.to_string_lossy().to_string());
            }
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => break,
        }
    }

    // Last resort: relative path from src-tauri (dev mode structure)
    // src/desktop/src-tauri/ -> project root is ../../..
    let fallback = start.join("../../..");
    if fallback.join("package.json").exists() {
        return Ok(
            fallback
                .canonicalize()
                .map_err(|e| format!("Canonicalize failed: {}", e))?
                .to_string_lossy()
                .to_string(),
        );
    }

    Err("Could not determine MXF project root. Set MXF_PROJECT_ROOT env var.".to_string())
}

/// Result of a completed shell command
#[derive(Serialize)]
pub struct ShellResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Execute a shell command and return the combined output.
///
/// Runs the command via the user's default shell (zsh on macOS, sh fallback).
/// The working directory defaults to the user's home but can be overridden.
#[tauri::command]
pub async fn execute_shell_command(
    command: String,
    cwd: Option<String>,
) -> Result<ShellResult, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let work_dir = cwd.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });

    let output = Command::new(&shell)
        .arg("-c")
        .arg(&command)
        .current_dir(&work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    Ok(ShellResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

/// Execute a shell command with streaming output via Tauri events.
///
/// Emits `shell:stdout` and `shell:stderr` events as lines arrive,
/// then emits `shell:exit` with the exit code when the process ends.
#[tauri::command]
pub async fn execute_shell_streaming(
    app: tauri::AppHandle,
    command: String,
    cwd: Option<String>,
) -> Result<i32, String> {
    use tauri::Emitter;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let work_dir = cwd.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });

    let mut child = Command::new(&shell)
        .arg("-c")
        .arg(&command)
        .current_dir(&work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // Stream stdout
    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_clone.emit("shell:stdout", &line);
            }
        });
    }

    // Stream stderr
    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_clone.emit("shell:stderr", &line);
            }
        });
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for command: {}", e))?;

    let exit_code = status.code().unwrap_or(-1);
    let _ = app.emit("shell:exit", exit_code);

    Ok(exit_code)
}
