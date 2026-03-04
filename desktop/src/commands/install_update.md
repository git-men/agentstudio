# IPC Command: `install_update`

## 签名

> **Phase 5 (US2) 实现** — MVP 阶段占位，完整实现在 T037

```rust
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String>
```

## 描述

触发更新下载和安装。仅在 `"update-available"` 事件后调用（已检测到新版本时）。
安装完成后调用 `app.restart()` 重启应用。

## 入参

无。

## 返回值

| 类型 | 说明 |
|------|------|
| `void` | 更新下载安装成功，应用将重启 |
| `string` (error) | 下载失败、签名验证失败或无可用更新 |

## 调用方

- `frontend/src/components/desktop/UpdateDialog.tsx` — 用户点击"立即更新"时触发

## 权限要求

需要 `updater:allow-download-and-install`（已在 `capabilities/default.json` 中声明）。

## 使用示例

```typescript
import { invoke } from '@tauri-apps/api/core';

// 用户确认更新
const handleInstallUpdate = async () => {
  try {
    await invoke('install_update');
    // 应用将自动重启
  } catch (err) {
    // 显示下载失败错误
  }
};
```

## 相关事件

- `"update-available"` — Rust 检测到新版本时向前端发送，payload 含 `{ version, notes }`
