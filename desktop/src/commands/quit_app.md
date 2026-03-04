# IPC Command: `quit_app`

## 签名

```rust
#[tauri::command]
async fn quit_app(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String>
```

## 描述

终止 backend sidecar 进程并退出应用。确保 sidecar 不残留为孤儿进程。

## 入参

无。

## 返回值

此命令调用 `app.exit(0)`，进程直接退出，不会返回值。

## 调用方

- 系统托盘"退出"菜单项（Phase 4 US4）
- 前端（如设置页"退出应用"按钮）：`invoke('quit_app')`

## 权限要求

无需额外声明（AppState 访问为内置权限）。

## 退出流程

```
invoke('quit_app')
  → kill sidecar (child.kill())
  → app.exit(0)
  → RunEvent::ExitRequested 触发（作为兜底）
```

## 注意事项

- 正常关闭窗口（Cmd+W / 点×）不会触发此命令
- 强制退出时，`RunEvent::ExitRequested` 处理器作为兜底确保 sidecar 被清理
