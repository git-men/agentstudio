# IPC Command: `show_main_window`

## 签名

```rust
#[tauri::command]
async fn show_main_window(app: AppHandle) -> Result<(), String>
```

## 描述

显示并聚焦主窗口。主要用于系统托盘菜单（Phase 4）和单实例回调。

## 入参

无。

## 返回值

| 类型 | 说明 |
|------|------|
| `void` | 成功显示主窗口 |
| `string` (error) | 主窗口不存在或操作失败 |

## 调用方

- `desktop/src-tauri/src/lib.rs` — single-instance 回调（自动调用）
- 系统托盘"打开 AgentStudio"菜单项（Phase 4 US4）
- 前端可调用：`invoke('show_main_window')`

## 权限要求

需要 `core:window:allow-show` 和 `core:window:allow-set-focus`
（已在 `capabilities/default.json` 中声明）。

## 使用示例

```typescript
import { invoke } from '@tauri-apps/api/core';

// 从系统托盘或快捷键触发
await invoke('show_main_window');
```
