# IPC Command: `check_update`

## 签名

> **Phase 5 (US2) 实现** — MVP 阶段占位，完整实现在 T037

```rust
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String>

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub pub_date: Option<String>,
}
```

## 描述

手动触发更新检查（用于设置页"检查更新"按钮）。与启动时自动检查互补。

## 入参

无。

## 返回值

| 类型 | 说明 |
|------|------|
| `UpdateInfo` | 发现新版本，含版本号和更新说明 |
| `null` | 当前已是最新版本 |
| `string` (error) | 网络请求失败或签名验证失败 |

```typescript
interface UpdateInfo {
  version: string;  // e.g. "1.2.3"
  notes: string;    // Release notes
  pub_date?: string; // ISO 8601
}
```

## 调用方

- 前端设置页"检查更新"按钮

## 权限要求

需要 `updater:allow-check`（已在 `capabilities/default.json` 中声明）。

## 使用示例

```typescript
import { invoke } from '@tauri-apps/api/core';

const updateInfo = await invoke<UpdateInfo | null>('check_update');
if (updateInfo) {
  // 显示 UpdateDialog
  setUpdateInfo(updateInfo);
}
```
