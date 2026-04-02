use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_BACKEND_PORT: u16 = 4200;

const ALLOWED_NPM_PACKAGES: &[&str] = &[
    "@anthropic-ai/claude-code",
    "@tencent/claude-code-internal",
    "@openai/codex",
];

// ── Mutex helper ──────────────────────────────────────────────────────────────

fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ── AppState ──────────────────────────────────────────────────────────────────

pub struct AppState {
    /// The port the backend sidecar is listening on; None until parsed from stdout.
    pub backend_port: Mutex<Option<u16>>,
    /// Handle to the running sidecar child process so we can kill it on exit.
    pub sidecar_child: Arc<Mutex<Option<CommandChild>>>,
    /// Cached pending update from Tauri updater (preferred path).
    pub pending_update: Mutex<Option<tauri_plugin_updater::Update>>,
    /// Cached pending update from custom check (fallback when Tauri updater fails).
    pub pending_custom_update: Mutex<Option<CustomUpdateInfo>>,
    /// Engine/SDK configuration selected at launch (prod mode only).
    pub launch_config: Mutex<Option<LaunchConfig>>,
}

// ── Update types ──────────────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
}

#[derive(Clone, serde::Serialize)]
pub struct UpdateDownloadProgress {
    pub downloaded: usize,
    pub total: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct CustomUpdateInfo {
    pub version: String,
    pub notes: String,
    pub download_url: String,
    pub signature: String,
}

#[derive(serde::Deserialize)]
struct LatestJsonPlatform {
    url: String,
    signature: String,
}

#[derive(serde::Deserialize)]
struct LatestJson {
    version: String,
    notes: Option<String>,
    platforms: Option<std::collections::HashMap<String, LatestJsonPlatform>>,
    url: Option<String>,
    signature: Option<String>,
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
    *lock_or_recover(&state.backend_port)
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
///
/// Tries the built-in Tauri updater first; if that fails (known issue with
/// tauri-plugin-updater v2.10 + reqwest 0.13 vs certain COS/CDN endpoints),
/// falls back to fetching latest.json with our own HTTP client.
#[tauri::command]
async fn check_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<UpdateInfo>, String> {
    log::info!("Checking for updates...");

    // ── Attempt 1: Tauri built-in updater ────────────────────────────────────
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            log::info!("Update available (tauri updater): v{}", update.version);
            let info = UpdateInfo {
                version: update.version.clone(),
                notes: update.body.clone().unwrap_or_default(),
            };
            *lock_or_recover(&state.pending_update) = Some(update);
            *lock_or_recover(&state.pending_custom_update) = None;
            return Ok(Some(info));
        }
        Ok(None) => {
            log::info!("Already up to date (tauri updater)");
            return Ok(None);
        }
        Err(e) => {
            log::warn!("Tauri updater failed: {e}, falling back to custom check");
        }
    }

    // ── Attempt 2: Custom HTTP check with reqwest 0.12 ──────────────────────
    let current_version = app.config().version.clone().unwrap_or_default();
    let target = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);

    let endpoints: Vec<String> = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("endpoints"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| {
                    s.replace("{{target}}", &target)
                     .replace("{{current_version}}", &current_version)
                     .replace("{{arch}}", std::env::consts::ARCH)
                }))
                .collect()
        })
        .unwrap_or_default();

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    for endpoint in &endpoints {
        log::info!("[custom-check] Fetching: {endpoint}");
        let resp = match client.get(endpoint).send().await {
            Ok(r) => r,
            Err(e) => {
                log::warn!("[custom-check] Request failed for {endpoint}: {e}");
                continue;
            }
        };

        if !resp.status().is_success() {
            log::warn!("[custom-check] Non-200 status {} from {endpoint}", resp.status());
            continue;
        }

        let json: LatestJson = match resp.json().await {
            Ok(j) => j,
            Err(e) => {
                log::warn!("[custom-check] JSON parse failed: {e}");
                continue;
            }
        };

        let remote_ver = match semver::Version::parse(&json.version) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("[custom-check] Invalid remote version '{}': {e}", json.version);
                continue;
            }
        };
        let local_ver = semver::Version::parse(&current_version).unwrap_or(semver::Version::new(0, 0, 0));

        if remote_ver <= local_ver {
            log::info!("[custom-check] Already up to date (local={local_ver}, remote={remote_ver})");
            return Ok(None);
        }

        let (dl_url, sig) = if let Some(platforms) = &json.platforms {
            if let Some(p) = platforms.get(&target) {
                (p.url.clone(), p.signature.clone())
            } else {
                log::warn!("[custom-check] No platform entry for '{target}'");
                continue;
            }
        } else if let (Some(u), Some(s)) = (&json.url, &json.signature) {
            (u.clone(), s.clone())
        } else {
            log::warn!("[custom-check] No url/signature in response");
            continue;
        };

        log::info!("[custom-check] Update available: v{} → v{}", local_ver, remote_ver);

        let custom = CustomUpdateInfo {
            version: json.version.clone(),
            notes: json.notes.clone().unwrap_or_default(),
            download_url: dl_url,
            signature: sig,
        };
        *lock_or_recover(&state.pending_custom_update) = Some(custom);
        *lock_or_recover(&state.pending_update) = None;

        return Ok(Some(UpdateInfo {
            version: json.version,
            notes: json.notes.unwrap_or_default(),
        }));
    }

    Err("Could not fetch update info from any endpoint".into())
}

/// Download and install the cached pending update, then restart the app.
///
/// Prefers the Tauri updater path (handles signature verification + atomic update).
/// Falls back to custom download + NSIS installer when Tauri updater is unavailable.
#[tauri::command]
async fn install_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // ── Path A: Tauri updater ────────────────────────────────────────────────
    let tauri_update = lock_or_recover(&state.pending_update).take();
    if let Some(update) = tauri_update {
        let emitter = app.clone();
        let mut downloaded: usize = 0;
        update
            .download_and_install(
                move |chunk_length, content_length| {
                    downloaded += chunk_length;
                    let _ = emitter.emit(
                        "update-download-progress",
                        UpdateDownloadProgress {
                            downloaded,
                            total: content_length,
                        },
                    );
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;

        app.restart();
    }

    // ── Path B: Custom download + run installer ──────────────────────────────
    let custom = lock_or_recover(&state.pending_custom_update)
        .take()
        .ok_or_else(|| "No pending update available".to_string())?;

    log::info!("[custom-install] Downloading {} ...", custom.download_url);

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&custom.download_url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status {}", resp.status()));
    }

    let total_size = resp.content_length();
    let emitter = app.clone();
    let mut downloaded: usize = 0;

    let temp_dir = std::env::temp_dir();
    let filename = custom
        .download_url
        .rsplit('/')
        .next()
        .unwrap_or("ClawStudio-setup.exe");
    let installer_path = temp_dir.join(filename);

    let mut file = tokio::fs::File::create(&installer_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {e}"))?;

    use tokio::io::AsyncWriteExt;
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len();
        let _ = emitter.emit(
            "update-download-progress",
            UpdateDownloadProgress {
                downloaded,
                total: total_size,
            },
        );
    }
    file.flush().await.map_err(|e| format!("Flush error: {e}"))?;
    drop(file);

    log::info!(
        "[custom-install] Downloaded {} ({} bytes), launching installer",
        installer_path.display(),
        downloaded
    );

    std::process::Command::new(&installer_path)
        .arg("/SILENT")
        .spawn()
        .map_err(|e| format!("Failed to launch installer: {e}"))?;

    app.exit(0);
    Ok(())
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

// ── Engine setup helpers ─────────────────────────────────────────────────────

/// Check if a domain is accessible (HTTP GET with short timeout).
#[tauri::command]
async fn check_domain_accessible(domain: String) -> bool {
    let url = if domain.starts_with("http") {
        domain
    } else {
        format!("https://{domain}")
    };

    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5));
    #[cfg(debug_assertions)]
    { builder = builder.danger_accept_invalid_certs(true); }
    let client = match builder.build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    client.get(&url).send().await.is_ok()
}

/// Stub sentinel written by build-sidecar.mjs when the npm package was unavailable.
const STUB_SENTINEL: &str = "was not bundled in this build";

/// Resolve the user's home directory.
fn home_dir() -> Option<String> {
    std::env::var("HOME").ok()
}

/// Build a list of well-known Node.js binary directories for common version
/// managers (fnm, nvm, volta, n) so that CLI lookups work even when launched
/// from a macOS GUI app with a minimal inherited PATH.
fn node_manager_bin_dirs() -> Vec<std::path::PathBuf> {
    let Some(home) = home_dir() else { return vec![] };
    let h = std::path::PathBuf::from(&home);
    let mut dirs = Vec::new();

    // fnm — stable alias symlink (not the per-session multishell path)
    dirs.push(h.join(".local/share/fnm/aliases/default/bin"));
    // fnm — also check each installed version
    if let Ok(entries) = std::fs::read_dir(h.join(".local/share/fnm/node-versions")) {
        for entry in entries.flatten() {
            dirs.push(entry.path().join("installation/bin"));
        }
    }

    // nvm
    if let Ok(entries) = std::fs::read_dir(h.join(".nvm/versions/node")) {
        for entry in entries.flatten() {
            dirs.push(entry.path().join("bin"));
        }
    }
    dirs.push(h.join(".nvm/current/bin"));

    // volta
    dirs.push(h.join(".volta/bin"));

    // n (tj/n)
    dirs.push(h.join("n/bin"));

    // Global npm / homebrew
    dirs.push(std::path::PathBuf::from("/usr/local/bin"));
    dirs.push(std::path::PathBuf::from("/opt/homebrew/bin"));

    dirs
}

/// Check if a CLI tool is installed. Returns the absolute path if found.
/// Priority: (1) bundled binary, (2) inherited PATH, (3) well-known node
/// manager paths, (4) login shell lookup.
#[tauri::command]
async fn check_cli_installed(cli_name: String) -> Option<String> {
    if !cli_name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.') {
        return None;
    }

    // 1. Prefer the binary bundled alongside this executable (Tauri externalBin).
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let bundled = exe_dir.join(&cli_name);
            if bundled.exists() {
                let is_stub = tokio::fs::read_to_string(&bundled)
                    .await
                    .map(|s| s.contains(STUB_SENTINEL))
                    .unwrap_or(false);
                if !is_stub {
                    return Some(bundled.to_string_lossy().to_string());
                }
            }
        }
    }

    // 2. Try the process-inherited PATH (works when launched from terminal).
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    if let Ok(output) = tokio::process::Command::new(cmd)
        .arg(&cli_name)
        .output()
        .await
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }

    // 3. Scan well-known node version manager directories (fnm, nvm, volta, n).
    //    This is the most reliable method for GUI-launched apps where the
    //    inherited PATH is minimal and login shells don't include fnm multishell.
    for dir in node_manager_bin_dirs() {
        let candidate = dir.join(&cli_name);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    // 4. Last resort: ask a user's default login shell (zsh on modern macOS).
    if cfg!(not(target_os = "windows")) {
        for shell in &["zsh", "bash", "sh"] {
            if let Ok(output) = tokio::process::Command::new(shell)
                .args(["-lc", &format!("command -v {}", cli_name)])
                .output()
                .await
            {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}

#[derive(Clone, serde::Serialize)]
struct InstallProgress {
    stage: String,
    message: String,
    done: bool,
    success: bool,
}

/// Locate the npm binary on macOS, where GUI apps have a minimal PATH.
/// Checks well-known static locations first, then falls back to a shell lookup.
async fn find_npm_binary() -> Option<String> {
    let static_paths = [
        "/opt/homebrew/bin/npm",
        "/usr/local/bin/npm",
        "/usr/bin/npm",
        "/opt/local/bin/npm",
    ];
    for path in &static_paths {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // Fallback: ask a login shell (handles nvm, volta, fnm, etc.)
    if let Ok(output) = tokio::process::Command::new("sh")
        .args(["-lc", "command -v npm"])
        .output()
        .await
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}

/// Install an npm package globally and stream progress.
/// Only packages in ALLOWED_NPM_PACKAGES are permitted.
#[tauri::command]
async fn install_npm_package(app: AppHandle, package_name: String) -> Result<String, String> {
    if !ALLOWED_NPM_PACKAGES.iter().any(|p| *p == package_name) {
        return Err(format!("Package '{}' is not in the allowed list", package_name));
    }

    let npm_path = find_npm_binary().await.ok_or_else(|| {
        "npm not found. Please ensure Node.js is installed (https://nodejs.org).".to_string()
    })?;

    let _ = app.emit("install-progress", InstallProgress {
        stage: "installing".to_string(),
        message: format!("Running: npm install -g {package_name}"),
        done: false,
        success: false,
    });

    let output = tokio::process::Command::new(&npm_path)
        .args(["install", "-g", &package_name])
        .output()
        .await
        .map_err(|e| format!("Failed to run npm: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        let _ = app.emit("install-progress", InstallProgress {
            stage: "done".to_string(),
            message: "Installation completed successfully".to_string(),
            done: true,
            success: true,
        });
        Ok(stdout)
    } else {
        let msg = if stderr.is_empty() { stdout } else { stderr };
        let _ = app.emit("install-progress", InstallProgress {
            stage: "error".to_string(),
            message: msg.clone(),
            done: true,
            success: false,
        });
        Err(msg)
    }
}

// run_shell_command removed — arbitrary shell execution is an RCE risk.
// Use install_npm_package with allowlisted packages instead.

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
/// Always persists the selected engine so the next session uses it.
#[tauri::command]
fn start_backend(
    app: AppHandle,
    state: tauri::State<AppState>,
    engine: String,
) -> Result<(), String> {
    let config = LaunchConfig { engine: engine.clone() };
    write_launch_config_to_file(&app, &config)?;
    *lock_or_recover(&state.launch_config) = Some(config);

    // Hold sidecar lock across the check-and-mark to prevent TOCTOU race
    {
        let guard = lock_or_recover(&state.sidecar_child);
        if guard.is_some() {
            return Err("Backend is already running".to_string());
        }
        if lock_or_recover(&state.backend_port).is_some() {
            return Err("Backend is already running".to_string());
        }
    }

    log::info!("Starting backend with ENGINE={engine}");

    if cfg!(debug_assertions) {
        // Dev mode: the backend is started by beforeDevCommand (tsx watch).
        // Do NOT cleanup_port — it would kill the running dev backend.
        // Dev mode: detect the backend started by beforeDevCommand,
        // then verify its ENGINE matches the user's selection.
        start_sidecar_dev(app, engine);
    } else {
        // Prod mode: clean up any residual process on the default port
        // from a previous session before spawning the sidecar binary.
        cleanup_port(DEFAULT_BACKEND_PORT);
        spawn_backend_sidecar(app);
    }
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

/// Kill any process listening on the given port.
/// Prevents "address already in use" when restarting the sidecar.
/// Works on macOS/Linux (lsof + kill) and Windows (netstat + taskkill).
fn cleanup_port(port: u16) {
    if cfg!(target_os = "windows") {
        cleanup_port_windows(port);
    } else {
        cleanup_port_unix(port);
    }
}

/// Windows 实现：通过 netstat 查找占用端口的 PID，再用 taskkill 终止。
fn cleanup_port_windows(port: u16) {
    // netstat -ano 输出示例:
    //   TCP    127.0.0.1:4200    0.0.0.0:0    LISTENING    12345
    let output = std::process::Command::new("netstat")
        .args(["-ano"])
        .output();
    let out = match output {
        Ok(o) => o,
        Err(e) => {
            log::warn!("Failed to run netstat: {e}");
            return;
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let port_str = format!(":{port}");
    let mut killed_pids = std::collections::HashSet::new();

    for line in stdout.lines() {
        // 只匹配 LISTENING 状态的行
        if !line.contains("LISTENING") {
            continue;
        }
        // 检查本地地址列是否包含目标端口
        let parts: Vec<&str> = line.split_whitespace().collect();
        // 格式: [协议, 本地地址, 外部地址, 状态, PID]
        if parts.len() < 5 {
            continue;
        }
        let local_addr = parts[1];
        // 精确匹配端口号（地址以 :port 结尾）
        if !local_addr.ends_with(&port_str) {
            continue;
        }
        let pid_str = parts[parts.len() - 1];
        if let Ok(pid) = pid_str.parse::<u32>() {
            if pid == 0 || !killed_pids.insert(pid) {
                continue; // 跳过 PID 0（系统）和已处理的 PID
            }
            log::info!("Cleaning up residual process {pid} on port {port}");
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/PID", pid_str])
                .output();
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }
}

/// macOS/Linux 实现：通过 lsof 查找占用端口的 PID，再用 kill 终止。
fn cleanup_port_unix(port: u16) {
    let output = std::process::Command::new("lsof")
        .args(["-ti", &format!(":{port}")])
        .output();
    if let Ok(out) = output {
        let pids = String::from_utf8_lossy(&out.stdout);
        for pid_str in pids.split_whitespace() {
            if let Ok(_pid) = pid_str.trim().parse::<i32>() {
                log::info!("Cleaning up residual process {pid_str} on port {port}");
                let _ = std::process::Command::new("kill")
                    .arg(pid_str.trim())
                    .output();
                std::thread::sleep(std::time::Duration::from_millis(200));
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
/// then verify its ENGINE matches the user's selected engine.
fn start_sidecar_dev(app: AppHandle, expected_engine: String) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        log::info!("Dev mode: polling for backend on port {DEFAULT_BACKEND_PORT}...");
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        loop {
            if try_detect_running_backend(DEFAULT_BACKEND_PORT).await {
                log::info!("Dev mode: backend detected on port {DEFAULT_BACKEND_PORT}");
                let state = app_clone.state::<AppState>();
                *lock_or_recover(&state.backend_port) = Some(DEFAULT_BACKEND_PORT);

                // Verify the running backend's engine matches user selection
                let actual_engine = detect_running_engine(DEFAULT_BACKEND_PORT).await;
                if let Some(ref actual) = actual_engine {
                    if actual != &expected_engine {
                        log::warn!(
                            "Dev mode: engine mismatch! User selected '{}' but backend is running '{}'",
                            expected_engine, actual
                        );
                        let _ = app_clone.emit("engine-mismatch", serde_json::json!({
                            "expected": expected_engine,
                            "actual": actual,
                        }).to_string());
                    }
                }

                if let Err(e) = app_clone.emit("backend-ready", DEFAULT_BACKEND_PORT) {
                    log::warn!("Failed to emit backend-ready: {e}");
                }
                return;
            }
            if std::time::Instant::now() > deadline {
                log::warn!("Dev mode: backend not found after 30s");
                let _ = app_clone.emit("backend-start-failed", "Dev backend not detected after 30s");
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    });
}

/// Query the health endpoint of a running backend to determine its ENGINE type.
async fn detect_running_engine(port: u16) -> Option<String> {
    let url = format!("http://127.0.0.1:{port}/api/health");
    match reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                body.get("serviceEngine")
                    .or_else(|| body.get("engine"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            } else {
                None
            }
        }
        _ => None,
    }
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
    let sidecar_result = shell.sidecar("clawstudio-backend");

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

    // Inject launch config and default port as sidecar env vars.
    // Engine is passed both as --engine=<value> CLI arg (highest priority in
    // engineConfig.ts) AND as the ENGINE env var, to guarantee the selection
    // made in DesktopLaunchConfig is never overridden by a stale config file.
    {
        let state = app.state::<AppState>();
        let config = lock_or_recover(&state.launch_config).clone();
        let mut env_map = std::collections::HashMap::new();
        env_map.insert("PORT".to_string(), DEFAULT_BACKEND_PORT.to_string());
        env_map.insert("TAURI_DESKTOP".to_string(), "1".to_string());
        env_map.insert("NO_UPDATE_NOTIFIER".to_string(), "1".to_string());
        if let Some(ref config) = config {
            env_map.insert("ENGINE".to_string(), config.engine.clone());
            // Pass engine as CLI arg (top priority in backend's detectEngineType)
            sidecar_cmd = sidecar_cmd.args([format!("--engine={}", config.engine)]);
        }
        // Build a comprehensive PATH for the sidecar:
        // (a) bundled binaries next to this .app executable
        // (b) well-known node version manager dirs (fnm, nvm, volta)
        // (c) login shell PATH
        // (d) system defaults
        //
        // macOS GUI apps inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
        // fnm uses per-session "multishell" temp dirs that login shells won't
        // include, so we explicitly add the stable fnm/nvm/volta bin paths.
        let mut path_parts: Vec<String> = Vec::new();
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                path_parts.push(exe_dir.display().to_string());
            }
        }
        // Add well-known node manager directories (fnm default alias, nvm, volta)
        for dir in node_manager_bin_dirs() {
            if dir.exists() {
                path_parts.push(dir.display().to_string());
            }
        }
        // Also try login shell PATH (zsh on modern macOS) for anything we missed
        for shell in &["zsh", "bash", "sh"] {
            if let Ok(output) = std::process::Command::new(shell)
                .args(["-lc", "echo $PATH"])
                .output()
            {
                if output.status.success() {
                    let shell_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !shell_path.is_empty() {
                        path_parts.push(shell_path);
                        break;
                    }
                }
            }
        }
        // Fallback system PATH
        let sys_path = std::env::var("PATH")
            .unwrap_or_else(|_| "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin".to_string());
        path_parts.push(sys_path);
        env_map.insert("PATH".to_string(), path_parts.join(":"));
        sidecar_cmd = sidecar_cmd.envs(env_map);
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
        *lock_or_recover(&state.sidecar_child) = Some(child);
    }

    let deadline = std::time::Instant::now() + Duration::from_secs(60);
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
                                *lock_or_recover(&state.backend_port) = Some(port);
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
            log::error!("Backend sidecar timed out after 60 seconds");
            let state = app.state::<AppState>();
            kill_sidecar(&state);
            log_buffer.push(BackendLogEntry {
                level: "error".to_string(),
                message: "Backend startup timed out (60s)".to_string(),
            });
            flush_log_buffer(&app, &mut log_buffer);
            notify_start_failed(&app, "Backend startup timed out (60s)");
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

        match tray_check_update(&app).await {
            Ok(Some(info)) => {
                log::info!("Update available (startup): v{}", info.version);
                if let Err(e) = app.emit("update-available", &info) {
                    log::warn!("Failed to emit update-available: {e}");
                }
            }
            Ok(None) => {
                log::info!("No updates available (startup)");
            }
            Err(e) => {
                log::warn!("Startup update check failed: {e}");
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

/// Tray-menu update check — reuses the same Tauri-first + custom-fallback logic.
async fn tray_check_update(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    // Try Tauri updater first
    if let Ok(updater) = app.updater_builder().timeout(Duration::from_secs(30)).build() {
        match updater.check().await {
            Ok(Some(update)) => {
                log::info!("Update available (tray, tauri): v{}", update.version);
                let info = UpdateInfo {
                    version: update.version.clone(),
                    notes: update.body.clone().unwrap_or_default(),
                };
                let state = app.state::<AppState>();
                *lock_or_recover(&state.pending_update) = Some(update);
                *lock_or_recover(&state.pending_custom_update) = None;
                return Ok(Some(info));
            }
            Ok(None) => {
                log::info!("Already up to date (tray, tauri)");
                return Ok(None);
            }
            Err(e) => {
                log::warn!("Tauri updater failed (tray): {e}, trying custom check");
            }
        }
    }

    // Custom fallback
    let current_version = app.config().version.clone().unwrap_or_default();
    let target = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let endpoints: Vec<String> = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("endpoints"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| {
                    s.replace("{{target}}", &target)
                     .replace("{{current_version}}", &current_version)
                     .replace("{{arch}}", std::env::consts::ARCH)
                }))
                .collect()
        })
        .unwrap_or_default();

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    for endpoint in &endpoints {
        let resp = match client.get(endpoint).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };
        let json: LatestJson = match resp.json().await {
            Ok(j) => j,
            _ => continue,
        };
        let remote_ver = match semver::Version::parse(&json.version) {
            Ok(v) => v,
            _ => continue,
        };
        let local_ver = semver::Version::parse(&current_version).unwrap_or(semver::Version::new(0, 0, 0));
        if remote_ver <= local_ver {
            return Ok(None);
        }
        let (dl_url, sig) = if let Some(platforms) = &json.platforms {
            if let Some(p) = platforms.get(&target) {
                (p.url.clone(), p.signature.clone())
            } else { continue; }
        } else if let (Some(u), Some(s)) = (&json.url, &json.signature) {
            (u.clone(), s.clone())
        } else { continue; };

        log::info!("[tray custom-check] Update: v{} → v{}", local_ver, remote_ver);
        let state = app.state::<AppState>();
        *lock_or_recover(&state.pending_custom_update) = Some(CustomUpdateInfo {
            version: json.version.clone(),
            notes: json.notes.clone().unwrap_or_default(),
            download_url: dl_url,
            signature: sig,
        });
        *lock_or_recover(&state.pending_update) = None;
        return Ok(Some(UpdateInfo {
            version: json.version,
            notes: json.notes.unwrap_or_default(),
        }));
    }
    Err("Could not fetch update info from any endpoint".into())
}

/// Build and register the system tray icon with menu.
fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, "open", "打开 ClawStudio", true, None::<&str>)?;
    let check_update_item = MenuItem::with_id(app, "check_update", "检查更新…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_item, &check_update_item, &separator, &quit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("default window icon must be configured").clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            "check_update" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    log::info!("Manual update check from tray menu");
                    match tray_check_update(&handle).await {
                        Ok(Some(info)) => {
                            let _ = handle.emit("update-available", &info);
                            if let Some(main) = handle.get_webview_window("main") {
                                let _ = main.show();
                                let _ = main.set_focus();
                            }
                        }
                        Ok(None) => {
                            let _ = handle.emit("update-check-result", serde_json::json!({"status": "up_to_date"}));
                        }
                        Err(e) => {
                            let _ = handle.emit("update-check-result", serde_json::json!({"status": "error", "message": e}));
                        }
                    }
                });
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

    let builder = tauri::Builder::default()
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
        .plugin(tauri_plugin_notification::init());

    // WebDriver automation plugin (E2E testing only, enable with --features webdriver)
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    builder
        // Register AppState
        .manage(AppState {
            backend_port: Mutex::new(None),
            sidecar_child: sidecar_child_arc,
            pending_update: Mutex::new(None),
            pending_custom_update: Mutex::new(None),
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
            check_domain_accessible,
            check_cli_installed,
            install_npm_package,
            load_launch_config,
            start_backend,
        ])
        .setup(|app| {
            // Close splash, show main with launch config UI.
            // The frontend DesktopLaunchConfig handles engine selection.
            // Backend detection/startup is deferred to start_backend IPC
            // so the user's engine choice is respected.
            close_splashscreen_internal(app.handle());

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
            // macOS: user clicks the Dock icon when all windows are hidden —
            // bring the main window back to the foreground.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows,
                ..
            } if !has_visible_windows => {
                if let Some(main) = app_handle.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
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
            }
            _ => {}
        });
}
