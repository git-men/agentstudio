use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// ── AppState ──────────────────────────────────────────────────────────────────

pub struct AppState {
    /// The port the backend sidecar is listening on; None until parsed from stdout.
    pub backend_port: Mutex<Option<u16>>,
    /// Handle to the running sidecar child process so we can kill it on exit.
    pub sidecar_child: Arc<Mutex<Option<CommandChild>>>,
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

/// Spawn the backend sidecar, parse BACKEND_PORT from its stdout, then
/// close the splashscreen and show the main window.
///
/// On success: emits `backend-ready` event with the port number.
/// On timeout (30 s): emits `backend-start-failed` event to the splashscreen.
fn start_sidecar(app: AppHandle) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
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
                            // Write port to AppState
                            let state = app_clone.state::<AppState>();
                            *state.backend_port.lock().unwrap() = Some(port);
                            port_found = true;

                            // Rust is the sole owner of splashscreen close
                            close_splashscreen_internal(&app_clone);

                            // Notify frontend
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

/// Emit `backend-start-failed` to the splashscreen window so it can show an error.
fn notify_start_failed(app: &AppHandle, reason: &str) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        if let Err(e) = splash.emit("backend-start-failed", reason) {
            log::warn!("Failed to emit backend-start-failed: {e}");
        }
    }
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
        // Register AppState
        .manage(AppState {
            backend_port: Mutex::new(None),
            sidecar_child: sidecar_child_arc,
        })
        // Register IPC command handlers
        .invoke_handler(tauri::generate_handler![
            get_backend_port,
            close_splashscreen,
            show_main_window,
            quit_app,
        ])
        // Start the sidecar after Tauri is fully ready
        .setup(|app| {
            start_sidecar(app.handle().clone());
            Ok(())
        })
        // Handle app exit: kill sidecar gracefully
        .build(tauri::generate_context!())
        .expect("error while building Tauri application")
        .run(move |app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Kill sidecar on exit
                if let Ok(mut guard) = sidecar_child_for_exit.lock() {
                    if let Some(child) = guard.take() {
                        log::info!("Killing backend sidecar on exit");
                        if let Err(e) = child.kill() {
                            log::warn!("Failed to kill sidecar on exit: {e}");
                        }
                    }
                }
                // Allow exit to proceed
                let _ = app_handle;
            }
        });
}
