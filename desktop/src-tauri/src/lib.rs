use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

// ── AppState ──────────────────────────────────────────────────────────────────

pub struct AppState {
    /// The port the backend sidecar is listening on; None until parsed from stdout.
    pub backend_port: Mutex<Option<u16>>,
    /// Handle to the running sidecar child process so we can kill it on exit.
    pub sidecar_child: Arc<Mutex<Option<CommandChild>>>,
    /// Cached pending update (populated by background update check task).
    pub pending_update: Mutex<Option<tauri_plugin_updater::Update>>,
    /// Engine/SDK configuration selected at launch (prod mode only).
    pub launch_config: Mutex<Option<LaunchConfig>>,
}

// ── Update types ──────────────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct BackendLogEntry {
    pub level: String,
    pub message: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct LaunchConfig {
    pub engine: String,
}

impl Default for LaunchConfig {
    fn default() -> Self {
        Self {
            engine: "claude-sdk".to_string(),
        }
    }
}

// ── IPC Commands ──────────────────────────────────────────────────────────────

/// Query the backend port. Returns None while the sidecar is still starting.
#[tauri::command]
fn get_backend_port(state: tauri::State<AppState>) -> Option<u16> {
    *state.backend_port.lock().unwrap()
}

/// Close the splashscreen window and show the main window.
/// Rust is the sole owner of splashscreen lifecycle (T022 / H1 fix).
#[tauri::command]
async fn close_splashscreen(app: AppHandle) -> Result<(), String> {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        splash.close().map_err(|e| e.to_string())?;
    }
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show and focus the main window (used by tray / single-instance callback).
#[tauri::command]
async fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Terminate the sidecar and exit the application.
#[tauri::command]
async fn quit_app(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    kill_sidecar(&state);
    app.exit(0);
    Ok(())
}

/// Manually check for updates. Returns info if an update is available.
#[tauri::command]
async fn check_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<UpdateInfo>, String> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| e.to_string())?;

    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let info = UpdateInfo {
                version: update.version.clone(),
                notes: update.body.clone().unwrap_or_default(),
            };
            *state.pending_update.lock().unwrap() = Some(update);
            Ok(Some(info))
        }
        None => Ok(None),
    }
}

/// Download and install the cached pending update, then restart the app.
#[tauri::command]
async fn install_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let update = state
        .pending_update
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "No pending update available".to_string())?;

    update
        .download_and_install(|_chunk_length, _content_length| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}

/// Send a native system notification.
#[tauri::command]
async fn send_notification(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Config persistence ───────────────────────────────────────────────────────

fn get_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    Ok(config_dir.join("launch-config.json"))
}

fn read_launch_config_from_file(app: &AppHandle) -> LaunchConfig {
    match get_config_path(app) {
        Ok(path) => match std::fs::read_to_string(&path) {
            Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
            Err(_) => LaunchConfig::default(),
        },
        Err(_) => LaunchConfig::default(),
    }
}

fn write_launch_config_to_file(app: &AppHandle, config: &LaunchConfig) -> Result<(), String> {
    let path = get_config_path(app)?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Load saved launch configuration (engine + SDK selection).
#[tauri::command]
fn load_launch_config(app: AppHandle) -> LaunchConfig {
    read_launch_config_from_file(&app)
}

/// Save config and start the backend sidecar.
/// Guards against double invocation — returns error if sidecar is already running.
/// Engine config is injected via Command::envs() (thread-safe), not set_var.
#[tauri::command]
fn start_backend(
    app: AppHandle,
    state: tauri::State<AppState>,
    engine: String,
) -> Result<(), String> {
    {
        let guard = state.sidecar_child.lock().unwrap();
        if guard.is_some() {
            return Err("Backend is already running".to_string());
        }
        if state.backend_port.lock().unwrap().is_some() {
            return Err("Backend is already running".to_string());
        }
    }

    let config = LaunchConfig { engine: engine.clone() };
    write_launch_config_to_file(&app, &config)?;
    *state.launch_config.lock().unwrap() = Some(config);
    log::info!("Starting backend with ENGINE={engine}");
    spawn_backend_sidecar(app);
    Ok(())
}

// ── Sidecar helpers ───────────────────────────────────────────────────────────

fn kill_sidecar(state: &AppState) {
    if let Ok(mut guard) = state.sidecar_child.lock() {
        if let Some(child) = guard.take() {
            if let Err(e) = child.kill() {
                log::warn!("Failed to kill sidecar: {e}");
            }
        }
    }
}

/// Try to connect to an already-running backend (dev mode) before falling back
/// to spawning the sidecar binary.
async fn try_detect_running_backend(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/health");
    match reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_secs(2))
        .send()
        .await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

/// Dev mode: poll for a running backend started by beforeDevCommand,
/// then fall back to spawning the sidecar binary.
fn start_sidecar_dev(app: AppHandle) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let default_port: u16 = 4936;
        log::info!("Dev mode: polling for backend on port {default_port}...");
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        loop {
            if try_detect_running_backend(default_port).await {
                log::info!("Dev mode: backend detected on port {default_port}");
                let state = app_clone.state::<AppState>();
                *state.backend_port.lock().unwrap() = Some(default_port);
                close_splashscreen_internal(&app_clone);
                if let Err(e) = app_clone.emit("backend-ready", default_port) {
                    log::warn!("Failed to emit backend-ready: {e}");
                }
                return;
            }
            if std::time::Instant::now() > deadline {
                log::warn!("Dev mode: backend not found after 30s, falling back to sidecar");
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        spawn_backend_sidecar_inner(app_clone, true).await;
    });
}

/// Launch the sidecar in a background task (called by `start_backend` IPC).
fn spawn_backend_sidecar(app: AppHandle) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        spawn_backend_sidecar_inner(app_clone, false).await;
    });
}

/// Core sidecar lifecycle: spawn process, stream logs, detect port.
/// When `close_splash` is true (dev-mode fallback), the splashscreen
/// is closed once the backend port is detected.
async fn spawn_backend_sidecar_inner(app: AppHandle, close_splash: bool) {
    let shell = app.shell();
    let sidecar_result = shell.sidecar("agentstudio-backend");

    let mut sidecar_cmd = match sidecar_result {
        Ok(cmd) => cmd,
        Err(e) => {
            log::error!("Failed to create sidecar command: {e}");
            let _ = app.emit("backend-log", BackendLogEntry {
                level: "error".to_string(),
                message: format!("Failed to create sidecar command: {e}"),
            });
            notify_start_failed(&app, &e.to_string());
            return;
        }
    };

    // Inject launch config as sidecar env vars (thread-safe, no set_var)
    {
        let state = app.state::<AppState>();
        let config = state.launch_config.lock().unwrap().clone();
        if let Some(config) = config {
            let mut env_map = std::collections::HashMap::new();
            env_map.insert("ENGINE".to_string(), config.engine);
            sidecar_cmd = sidecar_cmd.envs(env_map);
        }
    }

    let spawn_result = sidecar_cmd.spawn();
    let (mut rx, child) = match spawn_result {
        Ok(pair) => pair,
        Err(e) => {
            log::error!("Failed to spawn sidecar: {e}");
            let _ = app.emit("backend-log", BackendLogEntry {
                level: "error".to_string(),
                message: format!("Failed to spawn sidecar: {e}"),
            });
            notify_start_failed(&app, &e.to_string());
            return;
        }
    };

    {
        let state = app.state::<AppState>();
        *state.sidecar_child.lock().unwrap() = Some(child);
    }

    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    let mut port_found = false;
    let mut log_buffer: Vec<BackendLogEntry> = Vec::new();
    let mut flush_ticker = tokio::time::interval(Duration::from_millis(100));
    flush_ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            event = rx.recv() => {
                use tauri_plugin_shell::process::CommandEvent;
                match event {
                    Some(CommandEvent::Stdout(line_bytes)) => {
                        let line = String::from_utf8_lossy(&line_bytes).to_string();
                        log::debug!("[sidecar stdout] {line}");
                        log_buffer.push(BackendLogEntry {
                            level: "stdout".to_string(),
                            message: line.clone(),
                        });
                        if let Some(port_str) = line.trim().strip_prefix("BACKEND_PORT=") {
                            if let Ok(port) = port_str.parse::<u16>() {
                                let state = app.state::<AppState>();
                                *state.backend_port.lock().unwrap() = Some(port);
                                port_found = true;
                                flush_log_buffer(&app, &mut log_buffer);
                                if close_splash {
                                    close_splashscreen_internal(&app);
                                }
                                if let Err(e) = app.emit("backend-ready", port) {
                                    log::warn!("Failed to emit backend-ready: {e}");
                                }
                                log::info!("Backend sidecar ready on port {port}");
                            }
                        }
                    }
                    Some(CommandEvent::Stderr(line_bytes)) => {
                        let line = String::from_utf8_lossy(&line_bytes).to_string();
                        log::debug!("[sidecar stderr] {line}");
                        log_buffer.push(BackendLogEntry {
                            level: "stderr".to_string(),
                            message: line,
                        });
                    }
                    Some(CommandEvent::Error(e)) => {
                        log::error!("[sidecar error] {e}");
                        log_buffer.push(BackendLogEntry {
                            level: "error".to_string(),
                            message: e,
                        });
                    }
                    Some(CommandEvent::Terminated(status)) => {
                        log::warn!("[sidecar terminated] code={:?}", status.code);
                        log_buffer.push(BackendLogEntry {
                            level: "system".to_string(),
                            message: format!("Backend process terminated (code: {:?})", status.code),
                        });
                        flush_log_buffer(&app, &mut log_buffer);
                        if !port_found {
                            notify_start_failed(&app, "Backend process terminated unexpectedly");
                        }
                        return;
                    }
                    None => {
                        flush_log_buffer(&app, &mut log_buffer);
                        return;
                    }
                    _ => {}
                }
                if log_buffer.len() >= 50 {
                    flush_log_buffer(&app, &mut log_buffer);
                }
            }
            _ = flush_ticker.tick(), if !log_buffer.is_empty() => {
                flush_log_buffer(&app, &mut log_buffer);
            }
        }

        if !port_found && std::time::Instant::now() > deadline {
            log::error!("Backend sidecar timed out after 30 seconds");
            log_buffer.push(BackendLogEntry {
                level: "error".to_string(),
                message: "Backend startup timed out (30s)".to_string(),
            });
            flush_log_buffer(&app, &mut log_buffer);
            notify_start_failed(&app, "Backend startup timed out (30s)");
            return;
        }
    }
}

fn flush_log_buffer(app: &AppHandle, buffer: &mut Vec<BackendLogEntry>) {
    if buffer.is_empty() { return; }
    let _ = app.emit("backend-log-batch", buffer.as_slice());
    buffer.clear();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_config_default_values() {
        let config = LaunchConfig::default();
        assert_eq!(config.engine, "claude-sdk");
    }

    #[test]
    fn launch_config_serialization_roundtrip() {
        let config = LaunchConfig {
            engine: "claude-internal-sdk".to_string(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: LaunchConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.engine, "claude-internal-sdk");
    }

    #[test]
    fn launch_config_deserialize_with_extra_fields() {
        let json = r#"{"engine":"codex-cli","unknown_field":"value"}"#;
        let config: LaunchConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.engine, "codex-cli");
    }

    #[test]
    fn launch_config_deserialize_invalid_json_falls_back_to_default() {
        let json = "not valid json";
        let config: LaunchConfig = serde_json::from_str(json).unwrap_or_default();
        assert_eq!(config.engine, "claude-sdk");
    }

    #[test]
    fn launch_config_pretty_print() {
        let config = LaunchConfig::default();
        let json = serde_json::to_string_pretty(&config).unwrap();
        assert!(json.contains("claude-sdk"));
        assert!(!json.contains("sdk\":"));
        assert!(json.contains('\n'));
    }

    #[test]
    fn backend_log_entry_serialization() {
        let entry = BackendLogEntry {
            level: "stdout".to_string(),
            message: "Server started on port 4936".to_string(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("stdout"));
        assert!(json.contains("Server started on port 4936"));
    }

    #[test]
    fn backend_log_entry_batch_serialization() {
        let batch = vec![
            BackendLogEntry { level: "stdout".to_string(), message: "line 1".to_string() },
            BackendLogEntry { level: "stderr".to_string(), message: "line 2".to_string() },
        ];
        let json = serde_json::to_string(&batch).unwrap();
        let parsed: Vec<BackendLogEntry> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].level, "stdout");
        assert_eq!(parsed[1].level, "stderr");
    }

    #[test]
    fn config_file_write_and_read() {
        let dir = std::env::temp_dir().join("clawstudio-test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test-launch-config.json");

        let config = LaunchConfig {
            engine: "claude-internal-sdk".to_string(),
        };
        let json = serde_json::to_string_pretty(&config).unwrap();
        std::fs::write(&path, &json).unwrap();

        let read_json = std::fs::read_to_string(&path).unwrap();
        let read_config: LaunchConfig = serde_json::from_str(&read_json).unwrap();
        assert_eq!(read_config.engine, "claude-internal-sdk");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn update_info_serialization() {
        let info = UpdateInfo {
            version: "1.0.0".to_string(),
            notes: "Bug fixes".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("1.0.0"));
        assert!(json.contains("Bug fixes"));
    }
}

/// Background task: wait 5 seconds after startup, then check for updates.
fn start_update_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;

        log::info!("Checking for updates...");

        let updater = match app.updater_builder().build() {
            Ok(u) => u,
            Err(e) => {
                log::warn!("Failed to build updater: {e}");
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let info = UpdateInfo {
                    version: update.version.clone(),
                    notes: update.body.clone().unwrap_or_default(),
                };
                log::info!("Update available: v{}", info.version);

                let state = app.state::<AppState>();
                *state.pending_update.lock().unwrap() = Some(update);

                if let Err(e) = app.emit("update-available", &info) {
                    log::warn!("Failed to emit update-available: {e}");
                }
            }
            Ok(None) => {
                log::info!("No updates available");
            }
            Err(e) => {
                log::warn!("Update check failed: {e}");
            }
        }
    });
}

/// Close splashscreen and reveal main window — called from Rust only (T022).
fn close_splashscreen_internal(app: &AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        if let Err(e) = splash.close() {
            log::warn!("Could not close splashscreen: {e}");
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        if let Err(e) = main.show() {
            log::warn!("Could not show main window: {e}");
        }
        let _ = main.set_focus();
    }
}

/// Notify that the backend failed to start.
/// Emits to splashscreen (dev mode) and as a global event (prod mode).
fn notify_start_failed(app: &AppHandle, reason: &str) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.emit("backend-start-failed", reason);
    }
    let _ = app.emit("backend-start-failed", reason);
}

/// Build and register the system tray icon with menu.
fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, "open", "打开 ClawStudio", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_item, &separator, &quit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            "quit" => {
                let state = app.state::<AppState>();
                kill_sidecar(&state);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Double-click on tray icon to show main window
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

// ── Entry Point ───────────────────────────────────────────────────────────────

pub fn run() {
    let sidecar_child_arc: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
    let sidecar_child_for_exit = sidecar_child_arc.clone();

    tauri::Builder::default()
        // Structured logging (replaces console.* in desktop context)
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        // Sidecar management (external binary execution)
        .plugin(tauri_plugin_shell::init())
        // Auto-updater
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Single-instance: if another instance is launched, focus existing window
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        // Window state persistence: restore position/size on relaunch
        .plugin(tauri_plugin_window_state::Builder::new().build())
        // Native system notifications
        .plugin(tauri_plugin_notification::init())
        // Register AppState
        .manage(AppState {
            backend_port: Mutex::new(None),
            sidecar_child: sidecar_child_arc,
            pending_update: Mutex::new(None),
            launch_config: Mutex::new(None),
        })
        // Register IPC command handlers
        .invoke_handler(tauri::generate_handler![
            get_backend_port,
            close_splashscreen,
            show_main_window,
            quit_app,
            check_update,
            install_update,
            send_notification,
            load_launch_config,
            start_backend,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                // Dev mode: auto-detect running backend or fall back to sidecar
                start_sidecar_dev(app.handle().clone());
            } else {
                // Prod mode: show main window with launch config UI;
                // backend will be started when user confirms via start_backend IPC.
                close_splashscreen_internal(app.handle());
            }
            start_update_check(app.handle().clone());
            if let Err(e) = setup_system_tray(app) {
                log::warn!("Failed to setup system tray: {e}");
            }
            Ok(())
        })
        // Handle app exit: kill sidecar gracefully; hide window to tray on close
        .build(tauri::generate_context!())
        .expect("error while building Tauri application")
        .run(move |app_handle, event| match event {
            RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                // Hide to tray instead of closing the window
                api.prevent_close();
                if let Some(main) = app_handle.get_webview_window("main") {
                    let _ = main.hide();
                }
            }
            RunEvent::ExitRequested { .. } => {
                if let Ok(mut guard) = sidecar_child_for_exit.lock() {
                    if let Some(child) = guard.take() {
                        log::info!("Killing backend sidecar on exit");
                        if let Err(e) = child.kill() {
                            log::warn!("Failed to kill sidecar on exit: {e}");
                        }
                    }
                }
                let _ = app_handle;
            }
            _ => {}
        });
}
