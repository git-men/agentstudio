# Codex SDK Engine 适配设计方案

> 最后更新: 2026-02-19
> 状态: 设计中

## 1. 背景

AgentStudio 已在 `feature/codex-engine` worktree 中完成了 Codex CLI 引擎的适配（`codex-cli`），通过 `child_process.spawn()` 调用 `codex exec --json` 实现。

OpenAI 发布了 [Codex SDK](https://developers.openai.com/codex/sdk/)（`@openai/codex-sdk`），提供了 TypeScript 原生的封装。SDK 本质上也是 CLI 的薄封装（每个 turn 仍 spawn 一个 CLI 进程），但提供了：

- 完整的 TypeScript 类型系统
- 结构化的 Item 事件模型（替代扁平 JSONL）
- 更多新特性支持（FileChange、TodoList、WebSearch、Structured Output）
- 自动化的 CLI 路径解析（npm 平台包）
- 更优雅的 config 传递和 Thread 管理

**目标**: 新增 `codex-sdk` 引擎类型，与现有 `codex-cli` 并存，逐步迁移。

---

## 2. 架构概览

### 2.1 现有架构（codex-cli）

```
                   agui/chat (POST)
                        │
                        ▼
                  EngineManager
                        │
                        ▼
                   CodexEngine
                        │
              spawn('codex exec --json')
                        │
                  stdin / stdout
                        │
                        ▼
              CodexAguiAdapter
          (扁平 JSONL → AGUI Events)
```

### 2.2 新增架构（codex-sdk）

```
                   agui/chat (POST)
                        │
                        ▼
                  EngineManager
                        │
                        ▼
                 CodexSdkEngine          ◄── 新增
                        │
          Codex.startThread().runStreamed()
                        │
              AsyncGenerator<ThreadEvent>
                        │
                        ▼
             CodexSdkAguiAdapter         ◄── 新增
          (Typed Item → AGUI Events)
```

### 2.3 两种引擎并存

```
ServiceEngineType     →  EngineType  →  Engine Class
──────────────────────────────────────────────────────
'claude-sdk'          →  'claude'    →  ClaudeEngine
'cursor-cli'          →  'cursor'    →  CursorEngine
'codebuddy-sdk'       →  'codebuddy' →  CodeBuddyEngine
'codex-cli'           →  'codex'     →  CodexEngine        (现有)
'codex-sdk'           →  'codex-sdk' →  CodexSdkEngine     (新增)
```

---

## 3. 事件映射设计

### 3.1 SDK ThreadEvent → AGUI Event 映射

| SDK Event | SDK Item Type | AGUI Event(s) | toolName |
|-----------|---------------|----------------|----------|
| `thread.started` | - | `RUN_STARTED` + `CUSTOM(session_id_updated)` | - |
| `turn.started` | - | (内部状态更新) | - |
| `item.started` | `agent_message` | `TEXT_MESSAGE_START` | - |
| `item.updated` | `agent_message` | `TEXT_MESSAGE_CONTENT` | - |
| `item.completed` | `agent_message` | `TEXT_MESSAGE_END` | - |
| `item.started` | `reasoning` | `THINKING_START` | - |
| `item.updated` | `reasoning` | `THINKING_CONTENT` | - |
| `item.completed` | `reasoning` | `THINKING_END` | - |
| `item.started` | `command_execution` | `TOOL_CALL_START` + `TOOL_CALL_ARGS` | `shellToolCall` |
| `item.updated` | `command_execution` | (收集 output) | `shellToolCall` |
| `item.completed` | `command_execution` | `TOOL_CALL_END` + `TOOL_CALL_RESULT` | `shellToolCall` |
| `item.started` | `mcp_tool_call` | `TOOL_CALL_START` + `TOOL_CALL_ARGS` | `mcp__<server>__<tool>` |
| `item.completed` | `mcp_tool_call` | `TOOL_CALL_END` + `TOOL_CALL_RESULT` | `mcp__<server>__<tool>` |
| `item.started` | `file_change` | `TOOL_CALL_START` + `TOOL_CALL_ARGS` | `fileChangeToolCall` |
| `item.completed` | `file_change` | `TOOL_CALL_END` + `TOOL_CALL_RESULT` | `fileChangeToolCall` |
| `item.started` | `web_search` | `TOOL_CALL_START` + `TOOL_CALL_ARGS` | `webSearchToolCall` |
| `item.completed` | `web_search` | `TOOL_CALL_END` + `TOOL_CALL_RESULT` | `webSearchToolCall` |
| `item.started` | `todo_list` | `TOOL_CALL_START` + `TOOL_CALL_ARGS` | `todoListToolCall` |
| `item.updated` | `todo_list` | `TOOL_CALL_ARGS` (更新内容) | `todoListToolCall` |
| `item.completed` | `todo_list` | `TOOL_CALL_END` + `TOOL_CALL_RESULT` | `todoListToolCall` |
| `item.completed` | `error` | `RUN_ERROR` | - |
| `turn.completed` | - | `RUN_FINISHED` | - |
| `turn.failed` | - | `RUN_ERROR` + `RUN_FINISHED` | - |
| `error` | - | `RUN_ERROR` | - |

**工具命名规范**: Codex SDK 特有的工具类型使用 `xxxToolCall` 后缀（与 Cursor 工具命名对齐），便于前端 `isCodexSdkTool()` 识别。

### 3.2 Item 状态机

```
item.started (status: 'in_progress')
     │
     ▼
item.updated (status: 'in_progress')  ←─ 可能多次
     │
     ▼
item.completed (status: 'completed' | 'failed')
```

---

## 4. 前端工具组件设计

### 4.1 现有架构

前端工具渲染由 `ToolRenderer.tsx` 统一路由：

```
ToolRenderer
  ├── MCP 工具 → parseMcpToolName() → McpTool / CustomMcpTool / FrontendToolRender
  ├── Cursor 工具 → isCursorTool() → CursorToolRenderer
  │     ├── shellToolCall → CursorShellTool
  │     ├── readToolCall → CursorReadTool
  │     ├── editToolCall → CursorEditTool
  │     ├── updateTodosToolCall → CursorTodoTool
  │     └── ... (13 种)
  ├── Claude SDK 工具 → switch(toolName) → Bash/Read/Edit/TodoWrite/...
  └── 未知工具 → BaseToolComponent (JSON 展示)
```

### 4.2 Codex SDK 新增工具组件

新增 `frontend/src/components/tools/codex-sdk/` 目录，遵循 Cursor 工具组件的模式：

```
frontend/src/components/tools/codex-sdk/
├── CodexSdkToolRenderer.tsx     # 路由组件（仅路由 Codex SDK 特有的 3 种工具）
├── CodexFileChangeTool.tsx      # file_change 展示
├── CodexWebSearchTool.tsx       # web_search 展示
├── CodexTodoListTool.tsx        # todo_list 展示
├── types.ts                     # Codex SDK 工具类型定义
├── utils.ts                     # 工具名判断、转换工具
└── index.ts                     # 导出
```

#### 工具名 → 组件映射

| toolName | 组件 | 说明 |
|----------|------|------|
| `shellToolCall` | **复用** `CursorShellTool` | Shell 命令执行，结构一致 |
| `mcp__*__*` | **复用** `McpTool` | MCP 工具调用，格式一致 |
| `fileChangeToolCall` | **新增** `CodexFileChangeTool` | 文件变更列表展示 |
| `webSearchToolCall` | **新增** `CodexWebSearchTool` | 网络搜索查询展示 |
| `todoListToolCall` | **新增** `CodexTodoListTool` | 任务列表展示（含 checkbox 状态） |

#### 识别函数

```typescript
// codex-sdk/utils.ts
const CODEX_SDK_TOOLS = new Set([
  'fileChangeToolCall',
  'webSearchToolCall',
  'todoListToolCall',
]);

export function isCodexSdkTool(toolName: string): boolean {
  return CODEX_SDK_TOOLS.has(toolName);
}
```

#### ToolRenderer 集成

```diff
// ToolRenderer.tsx
+ import { CodexSdkToolRenderer, isCodexSdkTool } from './codex-sdk';

  // 检查是否为 Cursor 工具
  if (isCursorTool(execution.toolName)) {
    return <CursorToolRenderer execution={execution} />;
  }

+ // 检查是否为 Codex SDK 工具
+ if (isCodexSdkTool(execution.toolName)) {
+   return <CodexSdkToolRenderer execution={execution} />;
+ }
```

#### 组件 UI 设计

**CodexFileChangeTool**:
```
┌───────────────────────────────────┐
│ 📁 File Changes (3 files)         │
├───────────────────────────────────┤
│ + src/utils/helper.ts    (added)  │
│ ~ src/main.ts            (updated)│
│ - src/old.ts             (deleted)│
│                                   │
│ Status: ✅ completed              │
└───────────────────────────────────┘
```

**CodexTodoListTool**:
```
┌───────────────────────────────────┐
│ 📋 Task Plan                      │
├───────────────────────────────────┤
│ ☑ Read existing code              │
│ ☑ Implement new feature           │
│ ☐ Write tests                     │
│ ☐ Update documentation            │
└───────────────────────────────────┘
```

**CodexWebSearchTool**:
```
┌───────────────────────────────────┐
│ 🔍 Web Search                     │
├───────────────────────────────────┤
│ Query: "React 19 new features"    │
│ Status: ✅ completed              │
└───────────────────────────────────┘
```

---

## 5. 前端工具体系（Frontend Tools）支持

### 5.1 现有架构

Frontend Tools 通过 Provider 模式支持不同引擎：

```
前端 useFrontendTool() 注册工具
     ↓
随 chat 请求发送 frontendTools[]
     ↓
后端 integrateFrontendTools()
     ├── InProcessProvider → Claude SDK / CodeBuddy SDK
     │     创建 in-process MCP Server 对象
     │     直接传入 queryOptions.mcpServers
     │
     └── HttpMcpProvider → Cursor CLI
           注册到 HTTP MCP 端点
           写入 .cursor/mcp.json（JSON 格式）
           CLI 通过 HTTP MCP 调用
```

### 5.2 Codex SDK 的 Frontend Tools 方案

**核心观察**: Codex CLI/SDK 与 Cursor CLI 一样是**外部 CLI 进程**，不能在进程内驻留。因此同样需要 HTTP MCP 方式来暴露前端工具给 CLI 进程调用。

两者唯一的区别是 **MCP 配置写入格式**：
- Cursor CLI → `.cursor/mcp.json`（JSON 格式，项目级别）
- Codex CLI/SDK → `~/.codex/config.toml`（TOML 格式，全局级别）

**方案：扩展 `HttpMcpProvider`，支持不同配置写入策略**

```
HttpMcpProvider
  ├── ConfigWriter: CursorConfigWriter  → .cursor/mcp.json (JSON)
  └── ConfigWriter: CodexConfigWriter   → ~/.codex/config.toml (TOML)
```

具体实现：

```typescript
// frontendToolProviders.ts

/**
 * MCP 配置写入策略接口
 */
interface McpConfigWriter {
  write(workspace: string, backendBaseUrl: string, sessionId: string): Promise<void>;
  cleanup?(workspace: string, sessionId: string): Promise<void>;
}

/**
 * Cursor: 写入项目级 .cursor/mcp.json (JSON)
 */
class CursorConfigWriter implements McpConfigWriter {
  async write(workspace: string, backendBaseUrl: string, sessionId: string) {
    await writeCursorMcpConfig(workspace, backendBaseUrl, sessionId);
  }
}

/**
 * Codex: 写入全局 ~/.codex/config.toml (TOML)
 * 使用 [mcp_servers.frontend-tools] 段
 */
class CodexConfigWriter implements McpConfigWriter {
  async write(workspace: string, backendBaseUrl: string, sessionId: string) {
    await writeCodexMcpToml(backendBaseUrl, sessionId);
  }

  async cleanup(workspace: string, sessionId: string) {
    await removeCodexMcpTomlEntry(sessionId);
  }
}

/**
 * HttpMcpProvider 扩展，接受不同的 ConfigWriter
 */
export class HttpMcpProvider implements IFrontendToolProvider {
  constructor(private configWriter: McpConfigWriter) {}

  async setup(sessionId, agentId, clientTools, context) {
    // 注册到 HTTP MCP 端点（与 Cursor 相同）
    httpMcpToolRegistry.registerSession(sessionId, agentId, allTools);

    // 使用引擎特定的 ConfigWriter 写入配置
    if (context?.workspace && context?.backendBaseUrl) {
      await this.configWriter.write(context.workspace, context.backendBaseUrl, sessionId);
    }
    // ...
  }

  cleanup(sessionId: string): void {
    httpMcpToolRegistry.unregisterSession(sessionId);
    this.configWriter.cleanup?.();
  }
}
```

### 5.3 Provider 选择逻辑

```typescript
// frontendToolProviders.ts

const cursorHttpProvider = new HttpMcpProvider(new CursorConfigWriter());
const codexHttpProvider = new HttpMcpProvider(new CodexConfigWriter());
const inProcessProvider = new InProcessProvider();

export type ProviderType = 'in-process' | 'http-mcp-cursor' | 'http-mcp-codex';

export function getFrontendToolProvider(type: ProviderType): IFrontendToolProvider {
  switch (type) {
    case 'http-mcp-cursor': return cursorHttpProvider;
    case 'http-mcp-codex': return codexHttpProvider;
    default: return inProcessProvider;
  }
}
```

**路由侧的选择**:

```typescript
// agui.ts 或 integration.ts
function getProviderType(engineType: EngineType): ProviderType {
  switch (engineType) {
    case 'cursor': return 'http-mcp-cursor';
    case 'codex':
    case 'codex-sdk': return 'http-mcp-codex';
    default: return 'in-process'; // claude, codebuddy
  }
}
```

### 5.4 TOML 配置写入

```toml
# ~/.codex/config.toml 中新增的段

[mcp_servers.frontend-tools]
type = "http"
url = "http://localhost:4936/api/mcp-bridge/frontend-tools/{sessionId}"
```

**依赖**: 需引入 TOML 解析/序列化库（`smol-toml` 或 `@iarna/toml`）。

**并发注意**: `~/.codex/config.toml` 是全局文件，多 session 并发时需：
- 使用带 session 信息的唯一 server name（如 `frontend-tools-{sessionId}`）
- 或在 session 结束时清理对应条目

---

## 6. Marketplace 同步支持

### 6.1 现有架构

Marketplace 插件安装通过 `pluginInstallStrategy.ts` 路由到引擎特定的安装器：

```
pluginInstallStrategy.ts (Router)
  ├── cursor-cli  → pluginCopyInstall.ts  (文件拷贝模式)
  │     - Skills: 拷贝到 ~/.cursor/skills-cursor/
  │     - MCP: 累积写入统一 mcp.json
  │     - Commands: 拷贝并重命名
  │     - cleanBeforeInstall() / flushMCPConfig()
  │
  └── claude-sdk  → pluginSymlink.ts     (符号链接模式)
        - Skills: symlink 到 ~/.claude/skills/
        - MCP: 合并写入 mcp.json
        - Commands: symlink 到 ~/.claude/commands/
```

### 6.2 Codex SDK 方案：独立的安装器文件

**遵循每种引擎都有自己单独同步逻辑文件的惯例**，新增 `pluginCodexInstall.ts`。

```
pluginInstallStrategy.ts (Router)
  ├── cursor-cli   → pluginCopyInstall.ts    (文件拷贝 + JSON MCP)
  ├── claude-sdk   → pluginSymlink.ts        (符号链接 + JSON MCP)
  ├── codebuddy-sdk → pluginSymlink.ts       (复用 claude-sdk 逻辑)
  └── codex-cli/sdk → pluginCodexInstall.ts  (符号链接 + TOML MCP) ◄── 新增
```

```
backend/src/services/pluginCodexInstall.ts    ◄── 新增
```

#### pluginCodexInstall.ts 设计

```typescript
/**
 * Plugin Install Service for Codex CLI/SDK Engine
 *
 * Similar to pluginSymlink.ts but handles Codex's TOML MCP config format.
 * - Commands/Agents/Skills: symlink (same as claude-sdk)
 * - MCP servers: merge into ~/.codex/config.toml (TOML format)
 */
class PluginCodexInstall implements PluginInstaller {
  async createSymlinks(parsedPlugin: ParsedPlugin): Promise<void> {
    // Commands → symlink to ~/.codex/commands/
    // Agents → symlink to ~/.codex/agents/
    // Skills → symlink to ~/.codex/skills/
    // MCP → installMcpServersToml()
  }

  private async installMcpServersToml(parsedPlugin: ParsedPlugin): Promise<void> {
    // 1. 读取 plugin/.mcp.json
    // 2. 解析 server entries
    // 3. 读取 ~/.codex/config.toml
    // 4. 合并到 [mcp_servers.xxx] 段（含 _installedBy 标记）
    // 5. 写回 TOML
  }

  private async removeMcpServersToml(parsedPlugin: ParsedPlugin): Promise<void> {
    // 根据 _installedBy 标记删除对应段
  }
}
```

#### pluginInstallStrategy.ts 更新

```diff
+ import { isCodexEngine, isCodexSdkEngine } from '../config/engineConfig.js';
+ import { pluginCodexInstall } from './pluginCodexInstall.js';

  export function getPluginInstaller(): PluginInstaller {
+   if (isCodexEngine() || isCodexSdkEngine()) return pluginCodexInstall;
    return isCursorEngine() ? pluginCopyInstall : pluginSymlink;
  }
```

### 6.3 Codex TOML MCP 格式

Codex CLI 的 `config.toml` MCP 格式：

```toml
# ~/.codex/config.toml

[mcp_servers.my-server]
type = "stdio"
command = "npx"
args = ["-y", "@some/mcp-server"]

[mcp_servers.my-http-server]
type = "http"
url = "http://localhost:8080/mcp"
```

对应的 plugin `.mcp.json` 转换：

```json
// plugin/.mcp.json (输入)
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@some/mcp-server"]
    }
  }
}
```

→ 转换为 TOML 段：

```toml
# 输出
[mcp_servers.my-server]
type = "stdio"
command = "npx"
args = ["-y", "@some/mcp-server"]
```

### 6.4 兼容性矩阵

| 组件 | Codex 兼容性 | 方式 | 说明 |
|------|-------------|------|------|
| Commands (`.md`) | ✅ 兼容 | symlink | `~/.codex/commands/` |
| Agents (`.md`) | ✅ 兼容 | symlink | `~/.codex/agents/` |
| Skills (目录) | ✅ 兼容 | symlink | `~/.codex/skills/` |
| MCP (config) | ⚠️ 需适配 | TOML 写入 | `~/.codex/config.toml` |

---

## 7. 详细实现设计

### 7.1 CodexSdkEngine 类

```typescript
import { Codex, type ThreadOptions } from '@openai/codex-sdk';
import type { IAgentEngine, EngineType, EngineConfig, AGUIEvent, ModelInfo } from '../types.js';
import { CodexSdkAguiAdapter } from './codexSdkAguiAdapter.js';

export class CodexSdkEngine implements IAgentEngine {
  readonly type: EngineType = 'codex-sdk';
  readonly capabilities: EngineCapabilities = {
    mcp: { supported: true, configPath: '~/.codex/config.toml', dynamicToolLoading: false },
    skills: { supported: true, skillsPath: '~/.codex/skills', ruleFormat: 'markdown' },
    features: {
      multiTurn: true, thinking: true, vision: true,
      streaming: true, subagents: false, codeExecution: true,
    },
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    ui: {
      showMcpToolSelector: false, showImageUpload: true,
      showPermissionSelector: true, showProviderSelector: false,
      showModelSelector: true, showEnvVars: true,
    },
  };

  private codex: Codex;
  private activeAbortControllers = new Map<string, AbortController>();

  constructor() {
    this.codex = new Codex();
  }

  async sendMessage(
    message: string, config: EngineConfig,
    onAguiEvent: (event: AGUIEvent) => void
  ): Promise<{ sessionId: string }> {
    const adapter = new CodexSdkAguiAdapter();
    const abortController = new AbortController();

    const threadOptions: ThreadOptions = {
      model: config.model,
      workingDirectory: config.workspace,
      skipGitRepoCheck: true,
      sandboxMode: this.mapSandboxMode(config.permissionMode),
      approvalPolicy: 'never',
    };

    const thread = config.sessionId
      ? this.codex.resumeThread(config.sessionId, threadOptions)
      : this.codex.startThread(threadOptions);

    const trackingId = config.sessionId || crypto.randomUUID();
    this.activeAbortControllers.set(trackingId, abortController);

    try {
      const input = this.buildInput(message, config);
      const { events } = await thread.runStreamed(input, {
        signal: abortController.signal,
      });

      for await (const event of events) {
        const aguiEvents = adapter.convertThreadEvent(event);
        for (const aguiEvent of aguiEvents) {
          onAguiEvent(aguiEvent);
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        adapter.handleError(error as Error).forEach(onAguiEvent);
      }
    } finally {
      this.activeAbortControllers.delete(trackingId);
      adapter.finalize().forEach(onAguiEvent);
    }

    return { sessionId: thread.id || trackingId };
  }

  async interruptSession(sessionId: string): Promise<void> {
    const controller = this.activeAbortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(sessionId);
    }
  }

  // 复用 codex-cli 的模型缓存读取
  async getSupportedModels(): Promise<ModelInfo[]> { /* ... */ }

  getActiveSessionCount(): number {
    return this.activeAbortControllers.size;
  }

  // 复用 codex-cli 的历史读取
  async readSessions(projectPath: string) { /* ... */ }
  async readSession(projectPath: string, sessionId: string) { /* ... */ }

  private mapSandboxMode(permissionMode?: string) {
    switch (permissionMode) {
      case 'plan': return 'read-only' as const;
      case 'bypassPermissions': return 'danger-full-access' as const;
      default: return 'workspace-write' as const;
    }
  }

  private buildInput(message: string, config: EngineConfig) {
    if (config.images?.length) {
      return [
        { type: 'text' as const, text: message },
        ...config.images.map(img => ({
          type: 'local_image' as const,
          path: saveImageToHiddenDir(img.data, img.mediaType, 1, config.workspace),
        })),
      ];
    }
    return message;
  }
}
```

### 7.2 EngineConfig 扩展（预留）

```typescript
interface EngineConfig {
  // ... 现有字段 ...

  // Codex SDK 特有（预留）
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  outputSchema?: Record<string, unknown>;
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
  additionalDirectories?: string[];
  codexConfig?: Record<string, unknown>;
}
```

---

## 8. 文件变更清单

### 8.1 新增文件

| 文件 | 说明 |
|------|------|
| **后端核心** | |
| `backend/src/engines/codex-sdk/codexSdkEngine.ts` | 主引擎类 |
| `backend/src/engines/codex-sdk/codexSdkAguiAdapter.ts` | ThreadEvent → AGUI 适配器 |
| `backend/src/engines/codex-sdk/index.ts` | 模块导出 |
| `backend/src/engines/codex-sdk/__tests__/codexSdkEngine.test.ts` | Engine 测试 |
| `backend/src/engines/codex-sdk/__tests__/codexSdkAguiAdapter.test.ts` | Adapter 测试 |
| **Marketplace** | |
| `backend/src/services/pluginCodexInstall.ts` | Codex 插件安装器（symlink + TOML MCP） |
| `backend/src/services/__tests__/pluginCodexInstall.test.ts` | 安装器测试 |
| **前端组件** | |
| `frontend/src/components/tools/codex-sdk/CodexSdkToolRenderer.tsx` | 工具路由组件 |
| `frontend/src/components/tools/codex-sdk/CodexFileChangeTool.tsx` | 文件变更展示 |
| `frontend/src/components/tools/codex-sdk/CodexWebSearchTool.tsx` | 网络搜索展示 |
| `frontend/src/components/tools/codex-sdk/CodexTodoListTool.tsx` | 任务列表展示 |
| `frontend/src/components/tools/codex-sdk/types.ts` | 工具类型定义 |
| `frontend/src/components/tools/codex-sdk/utils.ts` | 工具识别函数 |
| `frontend/src/components/tools/codex-sdk/index.ts` | 导出 |

### 8.2 修改文件

| 文件 | 变更 |
|------|------|
| **依赖** | |
| `backend/package.json` | 添加 `@openai/codex-sdk` + TOML 库 |
| **类型** | |
| `backend/src/engines/types.ts` | EngineType 新增 `codex-sdk`；EngineConfig 扩展 |
| `backend/src/types/engine.ts` | ServiceEngineType 新增 `codex-sdk` |
| `frontend/src/types/engine.ts` | 前端类型同步 |
| **引擎注册** | |
| `backend/src/config/engineConfig.ts` | codex-sdk 配置、路径、capabilities |
| `backend/src/engines/index.ts` | 注册 codexSdkEngine + 映射 |
| **路由** | |
| `backend/src/routes/agui.ts` | 路由支持 + Schema 更新 |
| **Frontend Tools** | |
| `backend/src/services/frontendTools/frontendToolProviders.ts` | 扩展 HttpMcpProvider + CodexConfigWriter |
| `backend/src/services/frontendTools/mcpConfigManager.ts` | 新增 TOML 写入方法 |
| **Marketplace** | |
| `backend/src/services/pluginInstallStrategy.ts` | 路由到 pluginCodexInstall |
| **前端** | |
| `frontend/src/components/tools/ToolRenderer.tsx` | 集成 CodexSdkToolRenderer |
| `frontend/src/components/EngineGate.tsx` | 支持 codex-sdk |

---

## 9. 开发计划

### Phase 1: 核心引擎（1-2 天）

| # | 任务 | 优先级 |
|---|------|--------|
| 1.1 | 安装 `@openai/codex-sdk` + TOML 依赖 | P0 |
| 1.2 | 更新 EngineType / ServiceEngineType 类型 | P0 |
| 1.3 | 实现 `CodexSdkAguiAdapter`（所有 8 种 Item 映射） | P0 |
| 1.4 | 实现 `CodexSdkEngine` | P0 |
| 1.5 | Engine 注册 + 配置 | P0 |

### Phase 2: 路由与前端工具体系（1 天）

| # | 任务 | 优先级 |
|---|------|--------|
| 2.1 | agui.ts 路由适配 | P0 |
| 2.2 | 扩展 HttpMcpProvider + CodexConfigWriter（TOML 写入） | P1 |
| 2.3 | Frontend Tools 集成测试 | P1 |
| 2.4 | EngineConfig 预留字段 | P2 |

### Phase 3: 前端工具组件（1 天）

| # | 任务 | 优先级 |
|---|------|--------|
| 3.1 | `CodexSdkToolRenderer` + 工具识别 | P0 |
| 3.2 | `CodexFileChangeTool` 组件 | P0 |
| 3.3 | `CodexTodoListTool` 组件 | P0 |
| 3.4 | `CodexWebSearchTool` 组件 | P1 |
| 3.5 | ToolRenderer 集成 | P0 |
| 3.6 | 前端类型同步 | P0 |

### Phase 4: Marketplace 兼容（0.5 天）

| # | 任务 | 优先级 |
|---|------|--------|
| 4.1 | 新增 `pluginCodexInstall.ts` | P1 |
| 4.2 | 更新 `pluginInstallStrategy.ts` 路由 | P1 |
| 4.3 | Marketplace 同步测试 | P1 |

### Phase 5: 测试（1 天）

| # | 任务 | 优先级 |
|---|------|--------|
| 5.1 | Adapter 单元测试（所有 Item 映射） | P0 |
| 5.2 | Engine 单元测试 | P0 |
| 5.3 | 前端组件测试 | P1 |
| 5.4 | pluginCodexInstall 单元测试 | P1 |
| 5.5 | 集成测试：`ENGINE=codex-sdk pnpm run dev` | P0 |

### 总计：约 4.5-5.5 天

---

## 10. 启动方式

```bash
# 使用 Codex SDK 引擎
ENGINE=codex-sdk pnpm run dev

# 使用 Codex CLI 引擎（保持不变）
ENGINE=codex-cli pnpm run dev

# 别名
ENGINE=codex pnpm run dev   # → codex-cli（默认，向后兼容）
```

---

## 11. 风险与注意事项

1. **SDK CLI flag**: SDK 使用 `--experimental-json`（非 `--json`），事件格式可能仍在演进中
2. **SDK 版本兼容**: 需关注 `@openai/codex-sdk` 的更新频率和 breaking changes
3. **平台包**: SDK 通过 npm optional dependencies 下载平台特定 CLI 二进制
4. **模型列表**: SDK 不提供 `getSupportedModels()`，复用 `models_cache.json`
5. **Session 历史**: SDK 不提供历史读取 API，复用 `historyParser.ts`
6. **Approval 限制**: SDK 无审批回调，建议默认 `never`
7. **TOML 依赖**: 需引入第三方 TOML 库（`smol-toml`），增加依赖
8. **全局 config.toml 并发**: 多 session 并发写入全局 `~/.codex/config.toml` 时需注意：
   - 使用带 sessionId 的唯一 server name 避免冲突
   - session 结束时清理对应条目
   - 考虑文件锁（flock）机制
