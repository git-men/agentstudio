# Tauri Native E2E Tests

Tests the desktop app running as a real Tauri application with actual IPC calls.

## Setup

### 1. Install WebdriverIO dependencies

```bash
pnpm add -D @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter webdriverio
```

### 2. Build Tauri app with WebDriver feature

```bash
cd desktop/src-tauri
cargo tauri build --debug --features webdriver
```

This enables `tauri-plugin-webdriver` which embeds a W3C WebDriver server (port 4445) in the app.

### 3. Run tests

```bash
pnpm test:e2e:tauri
```

## How It Works

- `tauri-plugin-webdriver` runs inside the Tauri app, exposing standard WebDriver protocol
- WebdriverIO connects to `http://127.0.0.1:4445` and controls the app via W3C WebDriver
- Tests exercise real IPC calls (CLI detection, domain checks) rather than mocks
- The `wdio.tauri.conf.ts` config auto-launches the Tauri binary before tests

## Platform Support

Works on macOS, Linux, and Windows (cross-platform, no platform-specific driver needed).

## Comparison with Playwright Web E2E

| Aspect | Playwright (Web) | WebdriverIO (Tauri) |
|--------|-------------------|---------------------|
| IPC calls | Mocked via `__TAURI_INTERNALS__` | Real Tauri IPC |
| Environment | Standard browser | Tauri WKWebView |
| Build required | No (uses dev server) | Yes (debug build) |
| Speed | Fast (~15s) | Slower (build + launch) |
| CI friendly | Yes | Yes (all platforms) |
