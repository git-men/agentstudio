# IPC Command: `get_backend_port`

## 签名

```rust
#[tauri::command]
fn get_backend_port(state: tauri::State<AppState>) -> Option<u16>
```

## 描述

查询 backend sidecar 的实际监听端口。在 sidecar 启动并向 stdout 写入
`BACKEND_PORT=<port>` 信号之前，返回 `null`。

## 入参

无。

## 返回值

| 类型 | 说明 |
|------|------|
| `number` | 后端实际监听的 TCP 端口（1–65535） |
| `null` | 后端尚未就绪 |

## 调用方

- `frontend/src/lib/environment.ts` — `getBackendBaseUrl()` 轮询此命令
- `frontend/src/hooks/useBackendReady.ts` — 间接通过 `getBackendBaseUrl()`

## 权限要求

无需额外 capability 声明（Tauri 内置命令访问 AppState）。

## 使用示例

```typescript
import { invoke } from '@tauri-apps/api/core';

const port = await invoke<number | null>('get_backend_port');
if (port !== null) {
  const baseUrl = `http://127.0.0.1:${port}`;
}
```

## 注意事项

- 应轮询调用（间隔 200ms），直到返回非 null 值
- 超时上限为 30 秒（在 `getBackendBaseUrl()` 中实现）
- 不要在 splashscreen 仍显示时调用此命令来触发关闭——splashscreen 关闭权属于 Rust（见 T022）
