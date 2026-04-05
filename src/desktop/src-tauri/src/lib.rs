//! MXF Desktop — Tauri Library Entry Point
//!
//! Registers all IPC command handlers and Tauri plugins.
//! The frontend communicates with these handlers via `invoke()`.
//!
//! @author Brad Anderson <BradA1878@pm.me>

mod commands;

use commands::{config, session, shell};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            // Shell commands
            shell::get_project_root,
            shell::execute_shell_command,
            shell::execute_shell_streaming,
            // Config
            config::read_config,
            config::get_config_value,
            config::get_config_path,
            // Session persistence
            session::save_session,
            session::load_session,
            session::list_sessions,
            session::delete_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MXF desktop application");
}
