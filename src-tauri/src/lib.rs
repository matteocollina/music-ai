use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";

#[derive(Default, Deserialize, Serialize)]
struct AppSettings {
    openai_api_key: Option<String>,
}

#[derive(Serialize)]
struct ApiKeyStatus {
    configured: bool,
    last_four: Option<String>,
}

fn settings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("unable to resolve app data directory: {error}"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings_dir(app)?.join(SETTINGS_FILE))
}

fn ensure_secure_dir(path: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| format!("unable to create settings directory: {error}"))?;

    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("unable to protect settings directory: {error}"))?;

    Ok(())
}

fn read_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let raw = fs::read_to_string(&path).map_err(|error| format!("unable to read settings: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("unable to parse settings: {error}"))
}

fn write_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let dir = settings_dir(app)?;
    ensure_secure_dir(&dir)?;

    let path = dir.join(SETTINGS_FILE);
    let body = serde_json::to_string_pretty(settings).map_err(|error| format!("unable to serialize settings: {error}"))?;
    fs::write(&path, body).map_err(|error| format!("unable to write settings: {error}"))?;

    #[cfg(unix)]
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("unable to protect settings file: {error}"))?;

    Ok(())
}

#[tauri::command]
fn get_api_key_status(app: AppHandle) -> Result<ApiKeyStatus, String> {
    let settings = read_settings(&app)?;
    let last_four = settings
        .openai_api_key
        .as_ref()
        .map(|key| key.chars().rev().take(4).collect::<Vec<char>>())
        .map(|chars| chars.into_iter().rev().collect::<String>());

    Ok(ApiKeyStatus {
        configured: settings.openai_api_key.is_some(),
        last_four,
    })
}

#[tauri::command]
fn save_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("api key cannot be empty".into());
    }

    let mut settings = read_settings(&app)?;
    settings.openai_api_key = Some(trimmed.to_string());
    write_settings(&app, &settings)
}

#[tauri::command]
fn delete_api_key(app: AppHandle) -> Result<(), String> {
    let mut settings = read_settings(&app)?;
    settings.openai_api_key = None;
    write_settings(&app, &settings)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            delete_api_key,
            get_api_key_status,
            save_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
