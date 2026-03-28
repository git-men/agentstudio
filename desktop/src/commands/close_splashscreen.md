# IPC Command: `close_splashscreen`

## 签名

```rust
#[tauri::command]
async fn close_splashscreen(app: AppHandle) -> Result<(), String>
```

## 描述

关闭 splashscreen 窗口并显示主窗口。

**重要**：在 MVP 实现中，此命令**由 Rust 自动调用**（`start_sidecar()` 解析到
`BACKEND_PORT` 后），前端**不应**主动调用此命令。前端可通过监听 `"backend-ready"`
Tauri event 感知后端就绪状态。

## 入参

无。

## 返回值

| 类型 | 说明 |
|------|------|
| `void` | 成功关闭 splashscreen 并显示主窗口 |
| `string` (error) | 操作失败时的错误信息 |

## 调用方

- **Rust 内部**（`start_sidecar()` 在 `lib.rs` 中）— 主要调用方
- `frontend/` — **不推荐**直接调用，避免与 Rust 产生所有权冲突（H1）

## 权限要求

需要 `core:window:allow-close` 和 `core:window:allow-show`（已在 `capabilities/default.json` 中声明）。

## 时序说明

```
sidecar stdout → "BACKEND_PORT=4936"
  → Rust 解析端口
  → 写入 AppState.backend_port
  → 调用 close_splashscreen (内部)
  → 关闭 splashscreen 窗口
  → 显示 main 窗口
  → emit("backend-ready", port)
```
