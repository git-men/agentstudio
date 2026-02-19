# Frontend Tools 开发指南

> **适用分支**: `feature/frontend-tools`  
> **最后更新**: 2026-02-19

Frontend Tools 是一种让 AI Agent 能够调用前端自定义能力的机制。通过这套系统，AI 可以：

- 在聊天界面渲染交互式 UI 组件（如评分、表单、选择器）
- 触发前端静默操作（如收集 console 日志、弹出全局 Modal）
- 将用户交互结果或执行结果回传给 AI，让 AI 继续推理

---

## 整体架构

```
┌──────────────┐   useFrontendTool()   ┌─────────────────────────┐
│  React 组件  │ ─────注册工具──────► │ frontendToolRegistry.ts  │
└──────────────┘                       │  (客户端单例 Map)         │
                                       └──────────┬──────────────┘
                                                  │ 每次 chat 请求
                                                  │ schemas 随 body 发送
                                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Backend: FrontendToolProvider 抽象                                   │
│                                                                      │
│  ┌─────────────────────────┐   ┌──────────────────────────────┐     │
│  │ InProcessProvider       │   │ HttpMcpProvider               │     │
│  │ (Claude / CodeBuddy)    │   │ (Cursor CLI)                  │     │
│  │ SDK MCP Server 对象     │   │ HTTP MCP endpoint             │     │
│  │ → queryOptions          │   │ + .cursor/mcp.json 注入        │     │
│  └───────────┬─────────────┘   └──────────────┬───────────────┘     │
│              │                                 │                     │
│              └───────────┬─────────────────────┘                     │
│                          ▼                                           │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ frontendToolBridge (共享，传输无关)                              │  │
│  │ waitForResult() / submitResult() / cancel()                    │  │
│  └───────────┬────────────────────────────────────────────────────┘  │
└──────────────┼───────────────────────────────────────────────────────┘
               │
               │ tool_invocation 事件
               ▼
┌──────────────────────────────┐   ┌────────────────────────────────┐
│  Claude: SSE event           │   │  AGUI: CUSTOM event             │
│  data: { type:               │   │  { name: 'frontend_tool_call',  │
│    'frontend_tool_call' }    │   │    data: { toolCallId, ... } }  │
└──────────┬───────────────────┘   └───────────┬────────────────────┘
           │                                    │
           └────────────┬───────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  前端: ToolRenderer 渲染自定义 render fn → 用户交互 → onSubmit      │
│  POST /agents/frontend-tool-result → Bridge.submitResult()          │
│  → Promise 解除阻塞 → MCP tool 返回给 AI                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 快速上手

### 方式一：交互式工具（render 模式）

```tsx
import { useFrontendTool } from './useFrontendTool';

export function useRatingTool(): void {
  useFrontendTool({
    name: 'rate_response',
    description: '展示评分组件，让用户给结果打星',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '评分问题文字' },
        max_stars: { type: 'integer', description: '最高星数，默认 5' },
      },
      required: ['question'],
    },
    render: ({ args, status, onSubmit, onCancel }) => (
      <StarRatingTool
        question={args.question as string}
        maxStars={args.max_stars as number ?? 5}
        status={status}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    ),
  });
}
```

### 方式二：静默工具（handler 模式）

无需编写组件，直接提供 handler 函数：

```tsx
useFrontendTool({
  name: 'collect_logs',
  description: '收集浏览器 console 日志',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: '最多收集条数' },
    },
  },
  handler: async (args) => {
    const logs = getRecentLogs(args.limit as number || 50);
    return { logs, count: logs.length };
  },
});
```

### 在 ChatPanel 中注册

在 `AGUIChatPanel.tsx` 或 `AgentChatPanel.tsx` 的组件顶部调用：

```tsx
export const AGUIChatPanel = ({ agent, ... }) => {
  useRatingTool();
  useConsoleLogsTool();
  // ...
};
```

---

## 核心 API

### `useFrontendTool(options)`

```typescript
interface UseFrontendToolOptions {
  name: string;                    // 工具名（唯一）
  description: string;             // 向 AI 描述此工具的作用
  parameters: {                    // JSON Schema，定义 AI 传入的参数
    type: 'object';
    properties: Record<string, FrontendToolParameter>;
    required?: string[];
  };
  // 二选一：render（交互式）或 handler（静默式）
  render?: (props: FrontendToolRenderProps) => React.ReactNode;
  handler?: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}
```

### `FrontendToolRenderProps`

```typescript
interface FrontendToolRenderProps {
  args: Record<string, unknown>;      // AI 传来的参数
  toolCallId: string;                  // 本次调用的唯一 ID
  status: 'pending' | 'submitted' | 'error';  // 提交状态
  onSubmit: (result: unknown) => Promise<{ success: boolean; error?: string }>;
  onCancel: (reason?: string) => void; // 取消本次调用
}
```

### `onSubmit(result)`

返回 `Promise<{ success, error? }>`，组件可以据此显示提交成功/失败状态。
`result` 可以是任意可 JSON 序列化的值。

### `onCancel(reason?)`

取消当前工具调用。Agent 会收到一个错误，可以选择重试或跳过。

---

## 工具类型

### 类型 A：交互式 UI 工具

用户主动参与、提供输入，AI 根据输入继续推理。

```tsx
render: ({ args, onSubmit }) => (
  <ColorPicker
    colors={args.colors as string[]}
    onSelect={(color) => onSubmit({ selectedColor: color })}
  />
),
```

**用例**：评分、表单填写、选项选择、文件上传确认。

### 类型 B：静默执行工具（推荐使用 handler 模式）

无需用户参与，工具自动完成并立即返回结果。

```tsx
handler: async (args) => {
  const logs = collectConsoleLogs(args.limit as number);
  return { logs };
},
```

**用例**：收集 console 日志、截图、读取本地存储、调用浏览器 API。

### 类型 C：全局 Modal（Portal）

工具渲染到 `document.body`，形成全局弹层，不受聊天框容器限制。

```tsx
render: ({ args, onSubmit }) =>
  ReactDOM.createPortal(
    <ConfirmModal
      message={args.message as string}
      onConfirm={() => onSubmit({ confirmed: true })}
      onCancel={() => onSubmit({ confirmed: false })}
    />,
    document.body,
  ),
```

---

## 示例代码

以下示例实现已包含在 worktree 中，可直接参考：

| 文件 | 说明 |
|------|------|
| `src/components/tools/StarRatingTool.tsx` | 交互式评分 UI 组件 |
| `src/hooks/useRatingTool.ts` | 评分工具 Hook |
| `src/utils/consoleCapture.ts` | Console 日志拦截器 |
| `src/hooks/useConsoleLogsTool.ts` | 静默日志收集工具 |

如需启用这些工具，在 `AGUIChatPanel.tsx` 中取消注释对应的 hook 调用，并在 `App.tsx` 中启用 `startConsoleCapture()`。

---

## 架构设计

### Provider 模式

后端通过 `IFrontendToolProvider` 接口抽象了不同引擎的前端工具集成方式：

```typescript
interface IFrontendToolProvider {
  setup(sessionId, agentId, clientTools, context?): Promise<FrontendToolProviderResult>;
  cleanup(sessionId): void;
}
```

| Provider | 引擎 | 原理 |
|----------|------|------|
| `InProcessProvider` | Claude SDK, CodeBuddy SDK | 创建 SDK MCP Server 对象，直接加入 `queryOptions.mcpServers` |
| `HttpMcpProvider` | Cursor CLI | 启动 HTTP MCP endpoint，写入 `.cursor/mcp.json` |

两种 Provider 共享同一个 `frontendToolBridge`，实现传输无关的工具协调。

### Inline 工具注册

前端工具 schema 随每条 chat 请求一起发送（不需要单独的注册接口）：

```http
POST /agents/{agentId}/chat
{
  "message": "帮我评估一下这段代码",
  "frontendTools": [
    {
      "name": "rate_response",
      "description": "...",
      "parameters": { ... }
    }
  ]
}
```

AGUI 路由同理：

```http
POST /api/agui/chat
{
  "message": "...",
  "engineType": "cursor",
  "workspace": "/path/to/project",
  "frontendTools": [ ... ]
}
```

### 引擎兼容性

| 引擎 | 前端工具支持 | Provider | 实现方式 |
|------|------------|----------|---------|
| **Claude** (SDK) | ✅ 完整支持 | `InProcessProvider` | in-process MCP Server → queryOptions |
| **CodeBuddy** (SDK) | ✅ 完整支持 | `InProcessProvider` | 同上（SDK API 兼容） |
| **Cursor** (CLI) | ✅ 完整支持 | `HttpMcpProvider` | HTTP MCP endpoint + `.cursor/mcp.json` |

#### Claude / CodeBuddy 引擎

SDK 引擎支持传入 MCP Server 对象，`InProcessProvider` 直接创建 SDK MCP Server 并加入 `queryOptions.mcpServers`：

```
前端 → POST /api/agui/chat { frontendTools: [...] }
后端 → InProcessProvider.setup()
     → createUnifiedFrontendToolServer() → SDK MCP Server
     → queryOptions.mcpServers['frontend-tools'] = server
     → sdk.query({ prompt, options: queryOptions })
     → AI 调用工具 → frontendToolBridge → AGUI CUSTOM event → 前端
```

#### Cursor CLI 引擎

CLI 引擎通过外部进程运行，`HttpMcpProvider` 将工具注册到 HTTP MCP endpoint 并写入 `.cursor/mcp.json`：

```
前端 → POST /api/agui/chat { frontendTools: [...] }
后端 → HttpMcpProvider.setup()
     → httpMcpToolRegistry.registerSession(tools)
     → writeMcpConfig(workspace) → .cursor/mcp.json
     → spawn('agent', ['agent', '--approve-mcps', ...])
     → CLI 读取 .mcp.json → 连接 HTTP MCP endpoint
     → AI 调用工具 → HTTP endpoint → frontendToolBridge → AGUI CUSTOM event → 前端
```

`.cursor/mcp.json` 示例：
```json
{
  "mcpServers": {
    "frontend-tools": {
      "type": "http",
      "url": "http://localhost:4936/api/mcp-bridge/frontend-tools/{sessionId}"
    }
  }
}
```

### AGUI 事件通知

对于 AGUI 引擎（Cursor/CodeBuddy），`frontendToolBridge` 的 `tool_invocation` 事件通过 AGUI CUSTOM 事件转发给前端：

```json
{
  "type": "CUSTOM",
  "name": "frontend_tool_call",
  "data": {
    "toolCallId": "ft_xxx",
    "toolName": "rate_response",
    "args": { "question": "..." },
    "sessionId": "session-123",
    "agentId": "codebuddy"
  }
}
```

前端 `useMessageSender` 的 `handleAguiEvent` 处理此事件，调用 `addPendingFrontendTool` 触发工具渲染。

### 工具命名

动态工具的 MCP 工具名格式为 `mcp__frontend-tools__<tool_name>`，例如：
- `mcp__frontend-tools__rate_response`
- `mcp__frontend-tools__collect_logs`

内置工具保持独立命名：
- `mcp__ask-user-question__ask_user_question`

---

## 生命周期管理

1. **注册**：`useFrontendTool` 所在组件挂载时注册，卸载时自动反注册。

2. **提交状态**：`render` 的 `status` prop 反映提交进度（`pending` → `submitted`/`error`）。

3. **取消**：用户可通过 `onCancel` 取消等待中的工具调用，Agent 会收到错误。

4. **重连恢复**：SSE 断连后重连时，后端自动重新发送 pending 的 `frontend_tool_call` 事件。

5. **超时清理**：后端 24 小时后自动清理过期的 pending 请求。

6. **CLI 会话同步**：Cursor CLI 的真实 session ID 通过 `system.init` 消息获取，HTTP MCP registry 自动更新。

---

## 注意事项

1. **时序与 ID 映射**：SDK 流中的 tool_use ID（`toolu_xxx`）与 MCP bridge 内部 ID（`ft_xxx`）不同。`ToolRenderer` 通过 `toolName` 匹配 `pendingFrontendTools` 中的 bridge ID，而非直接使用 `execution.id`。如果 `onSubmit` 在 `frontend_tool_call` SSE 到达前调用，框架会自动缓冲并在事件到达后重试。

2. **结果格式**：`onSubmit` 的参数会被 JSON 序列化后作为 MCP tool result 返回给 AI。

3. **工具名冲突**：同一 `agentId` 下不能有同名工具（后注册会覆盖前者）。

4. **AGUI vs 原版**：两个 ChatPanel 都需要调用工具 hook，确保行为一致。

5. **`.cursor/mcp.json` 管理**：HttpMcpProvider 写入时做去重合并，不会覆盖已有配置。

---

## 测试

```bash
cd backend
npx vitest run src/services/frontendTools/__tests__/
```

覆盖的测试模块：
- `frontendToolBridge.test.ts` — Promise 协调、会话验证、取消、迁移
- `frontendToolMcp.test.ts` — MCP Server 创建、工具名识别、统一 Server
- `frontendToolProviders.test.ts` — Provider 抽象、InProcess / HttpMcp 策略
- `httpMcpServer.test.ts` — HTTP MCP 路由、JSON-RPC 协议、Bridge 集成
