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
}

// ── Update types ──────────────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
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

/// Spawn the backend sidecar, parse BACKEND_PORT from its stdout, then
/// close the splashscreen and show the main window.
/// In dev mode, first polls for an already-running backend started by beforeDevCommand.
fn start_sidecar(app: AppHandle) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        // In dev builds, the backend is started by beforeDevCommand.
        // Poll for it before attempting to spawn the sidecar binary.
        if cfg!(debug_assertions) {
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
        }

        let shell = app_clone.shell();
        let sidecar_result = shell.sidecar("agentstudio-backend");

        let sidecar_cmd = match sidecar_result {
            Ok(cmd) => cmd,
            Err(e) => {
                log::error!("Failed to create sidecar command: {e}");
                notify_start_failed(&app_clone, &e.to_string());
                return;
            }
        };

        let spawn_result = sidecar_cmd.spawn();
        let (mut rx, child) = match spawn_result {
            Ok(pair) => pair,
            Err(e) => {
                log::error!("Failed to spawn sidecar: {e}");
                notify_start_failed(&app_clone, &e.to_string());
                return;
            }
        };

        // Store child handle so ExitRequested handler can kill it
        {
            let state = app_clone.state::<AppState>();
            *state.sidecar_child.lock().unwrap() = Some(child);
        }

        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        let mut port_found = false;

        while let Some(event) = rx.recv().await {
            use tauri_plugin_shell::process::CommandEvent;
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    log::debug!("[sidecar stdout] {line}");
                    if let Some(port_str) = line.trim().strip_prefix("BACKEND_PORT=") {
                        if let Ok(port) = port_str.parse::<u16>() {
                            let state = app_clone.state::<AppState>();
                            *state.backend_port.lock().unwrap() = Some(port);
                            port_found = true;

                            close_splashscreen_internal(&app_clone);

                            if let Err(e) = app_clone.emit("backend-ready", port) {
                                log::warn!("Failed to emit backend-ready: {e}");
                            }
                            log::info!("Backend sidecar ready on port {port}");
                        }
                    }
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    log::debug!("[sidecar stderr] {line}");
                }
                CommandEvent::Error(e) => {
                    log::error!("[sidecar error] {e}");
                }
                CommandEvent::Terminated(status) => {
                    log::warn!("[sidecar terminated] code={:?}", status.code);
                    if !port_found {
                        notify_start_failed(&app_clone, "Backend process terminated unexpectedly");
                    }
                    break;
                }
                _ => {}
            }

            if !port_found && std::time::Instant::now() > deadline {
                log::error!("Backend sidecar timed out after 30 seconds");
                notify_start_failed(&app_clone, "Backend startup timed out (30s)");
                break;
            }
        }
    });
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

/// Emit `backend-start-failed` to the splashscreen window.
fn notify_start_failed(app: &AppHandle, reason: &str) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        if let Err(e) = splash.emit("backend-start-failed", reason) {
            log::warn!("Failed to emit backend-start-failed: {e}");
        }
    }
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
        ])
        // Start the sidecar, update check, and tray after Tauri is fully ready
        .setup(|app| {
            start_sidecar(app.handle().clone());
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
