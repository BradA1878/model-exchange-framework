//! MXF Desktop — Session IPC Handler
//!
//! Manages session persistence to ~/.mxf/sessions/. Saves and loads
//! conversation history so sessions survive app restarts.
//!
//! @author Brad Anderson <BradA1878@pm.me>

use serde_json::Value;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

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

/// Resolve one session filename and reject existing or dangling symlink targets.
/// This preflight check does not make subsequent filesystem operations atomic.
fn session_path(dir: &Path, session_id: &str) -> Result<PathBuf, String> {
    let mut components = Path::new(session_id).components();
    if session_id.is_empty()
        || session_id.contains(['/', '\\', '\0', ':'])
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        return Err("Session ID must be a single filename component".to_string());
    }

    let path = dir.join(format!("{}.json", session_id));
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("Session file must not be a symbolic link".to_string())
        }
        Ok(_) => Ok(path),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(path),
        Err(error) => Err(format!("Failed to inspect session file: {}", error)),
    }
}

/// Save session data to a JSON file
#[tauri::command]
pub fn save_session(session_id: String, data: Value) -> Result<(), String> {
    let dir = sessions_dir()?;
    let path = session_path(&dir, &session_id)?;
    let contents = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;
    fs::write(&path, contents).map_err(|e| format!("Failed to write session: {}", e))?;
    Ok(())
}

/// Load session data from a JSON file
#[tauri::command]
pub fn load_session(session_id: String) -> Result<Value, String> {
    let dir = sessions_dir()?;
    let path = session_path(&dir, &session_id)?;
    if !path.exists() {
        return Err(format!("Session not found: {}", session_id));
    }
    let contents =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read session: {}", e))?;
    let data: Value =
        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse session: {}", e))?;
    Ok(data)
}

/// List all saved session IDs
#[tauri::command]
pub fn list_sessions() -> Result<Vec<String>, String> {
    let dir = sessions_dir()?;
    let mut sessions = Vec::new();

    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to read sessions directory: {}", e))?;

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
    let path = session_path(&dir, &session_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete session: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::session_path;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mxf-session-path-test-{}-{}",
                std::process::id(),
                NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).expect("create isolated test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).expect("remove isolated test directory");
        }
    }

    #[test]
    fn accepts_generated_and_existing_filename_ids() {
        let dir = TestDirectory::new();
        for id in [
            "f861d20a",
            "review-2026_09",
            "old session",
            "session.v1",
            "révision",
        ] {
            let expected = dir.0.join(format!("{}.json", id));
            assert_eq!(session_path(&dir.0, id).unwrap(), expected);
            fs::write(&expected, "{}").unwrap();
            assert_eq!(session_path(&dir.0, id).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_paths_instead_of_resolving_outside_the_sessions_directory() {
        let dir = TestDirectory::new();
        let sessions = dir.0.join("sessions");
        fs::create_dir(&sessions).unwrap();
        let config = dir.0.join("config.json");
        fs::write(&config, "private configuration").unwrap();

        for id in [
            "",
            ".",
            "..",
            "../config",
            "..\\config",
            "nested/session",
            "nested\\session",
            "/tmp/session",
            "\\session",
            "C:\\session",
            "C:session",
            "session:stream",
            "\\\\server\\share",
            "session\0hidden",
            "./session",
            "session/",
        ] {
            assert!(session_path(&sessions, id).is_err(), "accepted {id:?}");
        }
        let absolute = dir.0.join("config");
        assert!(session_path(&sessions, absolute.to_str().unwrap()).is_err());
        assert_eq!(fs::read_to_string(config).unwrap(), "private configuration");
        assert_eq!(fs::read_dir(sessions).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_existing_and_dangling_symlink_targets() {
        use std::os::unix::fs::symlink;

        let dir = TestDirectory::new();
        let sessions = dir.0.join("sessions");
        fs::create_dir(&sessions).unwrap();
        let outside = dir.0.join("config.json");
        let absent = dir.0.join("absent.json");
        fs::write(&outside, "private configuration").unwrap();
        symlink(&outside, sessions.join("existing.json")).unwrap();
        symlink(&absent, sessions.join("dangling.json")).unwrap();

        assert!(session_path(&sessions, "existing").is_err());
        assert!(session_path(&sessions, "dangling").is_err());
        assert_eq!(
            fs::read_to_string(outside).unwrap(),
            "private configuration"
        );
        assert!(!absent.exists());
        assert!(fs::symlink_metadata(sessions.join("dangling.json"))
            .unwrap()
            .file_type()
            .is_symlink());
    }
}
