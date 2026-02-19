# AgentStudio Hook System 设计方案

> 最后更新: 2026-02-19
> 状态: RFC (Request for Comments)

## 1. 背景与动机

当前 AgentStudio 的 hook 能力分散在两个层面：
- **Claude Code Hooks** (`feature/unified-agent-hooks`)：绑定 Claude SDK，存储在 `~/.claude/settings.json`，仅 Claude Code 引擎支持
- **Agent Hooks** (`onRunFinished`)：简单的会话结束回调，硬编码在路由层

**核心问题**：hook 逻辑耦合在引擎实现或协议层上，换引擎就不可用，换协议（AGUI→A2A）也不触发。

**设计目标**：在 AgentStudio **服务层**建立统一的 Hook 系统——引擎无关、协议无关，无论通过 AGUI（用户交互）还是 A2A（Agent 间调用）触发的会话，hooks 都能生效。

## 2. 架构概览

关键原则：**事件源在服务层，不在协议层**。

AGUI 和 A2A 都是协议层的消费者，不是事件的来源。事件从业务服务中产生。

```
┌──────────────────────────────────────────────────────────────┐
│                      AgentStudio Services                     │
│                                                              │
│  SessionManager ────┐                                         │
│  Engine Runner  ────┤                                         │
│  TaskExecutor   ────┼──> PlatformEventBus ──> HookManager    │
│  Scheduler      ────┤         │                    │          │
│  TunnelService  ────┘         │               ┌────v────┐    │
│                               │               │Executors│    │
│  ┌──────────┐  ┌──────────┐  │               │ Shell   │    │
│  │AGUI Route│  │A2A Route │  │               │ Script  │    │
│  │(SSE push)│  │(callback)│  │               │ Webhook │    │
│  └──────────┘  └──────────┘  │               └─────────┘    │
│       │              │       │                               │
│       └──────────────┘       │        ┌──────────────┐      │
│       协议层消费者，            │        │ Hook Storage │      │
│       不是事件来源             │        │   (JSON)     │      │
│                              │        └──────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

## 3. 事件模型

### 3.1 事件分类

事件从 **业务服务** 直接产生，不依赖任何协议层（AGUI/A2A）：

| 分类 | 事件名 | 说明 | 事件源（Service） |
|------|--------|------|-------------------|
| **运行** | `run.start` | Agent 执行开始 | SessionManager |
| | `run.end` | Agent 执行正常结束 | SessionManager |
| | `run.error` | Agent 执行出错 | SessionManager |
| **消息** | `message.user_submit` | 用户/调用方提交消息 | SessionManager / A2A handler |
| | `message.agent_reply` | Agent 完成回复 | Engine Runner (回调) |
| **工具** | `tool.call_start` | 工具开始执行 | Engine Runner (回调) |
| | `tool.call_end` | 工具执行完成 | Engine Runner (回调) |
| **任务** | `task.submit` | 异步任务提交 | TaskExecutor |
| | `task.complete` | 异步任务完成 | TaskExecutor |
| | `task.fail` | 异步任务失败 | TaskExecutor |
| **调度** | `schedule.trigger` | 定时任务触发 | Scheduler |
| | `schedule.complete` | 定时任务完成 | Scheduler |
| **系统** | `system.tunnel.connect` | Tunnel 连接 | TunnelService |
| | `system.tunnel.disconnect` | Tunnel 断开 | TunnelService |

### 3.2 事件结构

```typescript
interface HookEvent {
  type: string;              // e.g. "run.end"
  timestamp: string;         // ISO 8601
  sessionId?: string;        // 关联的 session
  projectId?: string;        // 关联的项目
  agentId?: string;          // 关联的 agent
  source: string;            // 事件来源服务标识
  data: Record<string, any>; // 事件载荷
}
```

### 3.3 事件源独立于协议

```
                 ┌─────────────────┐
   AGUI Client ──┤                 │
                 │ SessionManager  ├──emit──> run.start / run.end
   A2A Client  ──┤ (业务服务层)     │
                 └─────────────────┘

                 ┌─────────────────┐
                 │  Engine Runner  ├──emit──> tool.call_start / message.agent_reply
                 │ (引擎执行层)     │
                 └─────────────────┘
```

无论请求来自 AGUI（用户在浏览器操作）还是 A2A（另一个 Agent 调用），SessionManager 都会发射相同的事件，HookManager 都会匹配并执行对应的 hooks。

## 4. Hook 配置

### 4.1 Hook 定义

```typescript
interface Hook {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;

  // 触发条件
  event: string;                // 事件类型
  filter?: HookFilter;         // 过滤条件（可选）

  // 执行动作
  action: HookAction;

  // 作用域
  scope: 'global' | 'project' | 'agent';
  projectId?: string;          // scope=project 时指定
  agentId?: string;            // scope=agent 时指定

  // 执行选项
  timeout: number;             // 超时（ms），默认 30000
  failurePolicy: 'ignore' | 'warn' | 'abort';
  priority: number;            // 执行优先级，越小越先执行

  // 元数据
  createdAt: string;
  updatedAt: string;
}
```

### 4.2 过滤器

```typescript
interface HookFilter {
  toolName?: string | string[];     // 工具名匹配
  pathPattern?: string;             // 文件路径 glob 匹配
  agentId?: string | string[];      // Agent 匹配
  projectId?: string | string[];    // 项目匹配
  condition?: string;               // JS 表达式（高级用法）
}
```

### 4.3 执行动作

```typescript
type HookAction =
  | ShellAction
  | ScriptAction
  | WebhookAction;

interface ShellAction {
  type: 'shell';
  command: string;
  cwd?: string;                    // 工作目录，默认项目目录
  env?: Record<string, string>;    // 额外环境变量
}

interface ScriptAction {
  type: 'script';
  path: string;                    // 脚本文件路径
  runtime: 'node';                 // 运行时
  args?: string[];                 // 命令行参数
}

interface WebhookAction {
  type: 'webhook';
  url: string;
  method?: 'GET' | 'POST' | 'PUT';  // 默认 POST
  headers?: Record<string, string>;
  bodyTemplate?: string;             // JSON 模板，支持 {{event.data.xxx}} 插值
}
```

## 5. 存储设计

### 5.1 存储位置

```
~/.agentstudio/
  hooks/
    global-hooks.json          # 全局 hooks
    projects/
      <projectId>/
        hooks.json             # 项目级 hooks
```

Agent 级 hooks 存储在 Agent 配置中（现有的 agent JSON 文件），不另外开文件。

### 5.2 存储格式

```json
{
  "version": "1.0.0",
  "hooks": [
    {
      "id": "hook_abc123",
      "name": "代码格式化",
      "event": "run.end",
      "action": {
        "type": "shell",
        "command": "npm run format"
      },
      "scope": "project",
      "enabled": true,
      "timeout": 30000,
      "failurePolicy": "warn",
      "priority": 10,
      "createdAt": "2026-02-19T00:00:00Z",
      "updatedAt": "2026-02-19T00:00:00Z"
    }
  ]
}
```

## 6. 核心组件

### 6.1 PlatformEventBus

基于现有 `sessionEventBus` 扩展，增加平台级事件支持：

```typescript
class PlatformEventBus {
  // 发射事件（由引擎适配器和系统服务调用）
  emit(event: HookEvent): void;

  // 订阅事件（HookManager 用）
  on(eventType: string, handler: (event: HookEvent) => void): () => void;

  // 通配符订阅
  on('*', handler: (event: HookEvent) => void): () => void;
}
```

### 6.2 HookManager

核心调度器：

```typescript
class HookManager {
  // 加载所有 hooks
  async initialize(): Promise<void>;

  // 事件到来时，匹配并执行相关 hooks
  async handleEvent(event: HookEvent): Promise<HookExecutionResult[]>;

  // CRUD
  async createHook(hook: Omit<Hook, 'id' | 'createdAt' | 'updatedAt'>): Promise<Hook>;
  async updateHook(id: string, updates: Partial<Hook>): Promise<Hook>;
  async deleteHook(id: string): Promise<void>;
  async listHooks(filter?: { scope?: string; event?: string }): Promise<Hook[]>;
}
```

### 6.3 Executors

```typescript
interface HookExecutor {
  type: string;
  execute(action: HookAction, event: HookEvent, options: ExecutionOptions): Promise<HookExecutionResult>;
}

// Shell 执行器
class ShellExecutor implements HookExecutor { ... }

// Script 执行器
class ScriptExecutor implements HookExecutor { ... }

// Webhook 执行器
class WebhookExecutor implements HookExecutor { ... }
```

### 6.4 事件上下文传递

所有执行器都能访问事件数据：

- **Shell**: 通过 `HOOK_EVENT` 环境变量（JSON）+ stdin
- **Script**: 通过 `process.argv[2]`（JSON）或 `process.env.HOOK_EVENT`
- **Webhook**: 通过 HTTP body（JSON）

## 7. API 设计

```
GET    /api/hooks                    # 列出所有 hooks
GET    /api/hooks/:id                # 获取单个 hook
POST   /api/hooks                    # 创建 hook
PUT    /api/hooks/:id                # 更新 hook
DELETE /api/hooks/:id                # 删除 hook
POST   /api/hooks/:id/test           # 测试执行 hook（模拟事件）
GET    /api/hooks/events             # 列出可用事件类型
GET    /api/hooks/executions         # 查看执行历史
```

## 8. 服务层集成

### 8.1 集成方式

事件从业务服务中发射，不通过协议层中转：

```typescript
// SessionManager 中
class SessionManager {
  async createSession(projectId: string, agentId: string) {
    const session = /* 创建 session */;
    platformEventBus.emit({
      type: 'run.start',
      sessionId: session.id,
      projectId, agentId,
      source: 'SessionManager',
      data: { engine: session.engineType },
    });
    return session;
  }
}

// Engine Runner 中（引擎回调）
function onEngineResult(result, context) {
  if (result.type === 'tool_call') {
    platformEventBus.emit({
      type: 'tool.call_end',
      sessionId: context.sessionId,
      projectId: context.projectId,
      source: 'EngineRunner',
      data: { toolName: result.toolName, success: result.success },
    });
  }
}
```

### 8.2 引擎无关性

引擎不需要知道 hook 系统的存在。事件发射点在引擎 **之上** 的服务层：

```
  Claude Engine ──┐
                  ├── Engine Runner (统一回调) ──emit──> tool.call_end
  Cursor Engine ──┘

  AGUI route ────┐
                 ├── SessionManager (统一入口) ──emit──> run.start
  A2A handler ───┘
```

每个引擎的适配器（claudeAguiAdapter / cursorAguiAdapter）继续做自己的事（转换为 AGUI/A2A 格式推送给客户端），hook 事件发射与它们**完全解耦**。

## 9. 与现有 Hook 的兼容

### 9.1 迁移策略

| 现有 Hook | 迁移方式 |
|-----------|----------|
| `onRunFinished` (Agent 配置) | 转换为 `run.end` 事件的 hook，内置 `create_version` 作为 shell 动作 |
| Claude Code Hooks (SDK 文件) | 保持引擎内部机制不变，平台 hook 在更高层运行 |

### 9.2 不冲突原则

平台 Hook 和引擎原生 Hook **可以共存**：
- 引擎原生 Hook（如 Claude SDK 的 PreToolUse）在引擎内部执行
- 平台 Hook 在 AgentStudio 层执行
- 两者互不影响

## 10. 实施计划

### Phase 1: 基础框架（1-2 周）

- [ ] `PlatformEventBus` 服务
- [ ] `HookManager` 核心调度
- [ ] `HookStorage` JSON 文件存储
- [ ] `ShellExecutor` shell 命令执行器
- [ ] Hook CRUD REST API
- [ ] AGUI → HookEvent 转换桥接
- [ ] 基础事件：`run.start`, `run.end`, `message.agent_reply`

### Phase 2: 执行器扩展（1 周）

- [ ] `ScriptExecutor` JS/TS 脚本执行器
- [ ] `WebhookExecutor` HTTP 回调执行器
- [ ] 执行历史记录与查询
- [ ] 超时和错误处理完善

### Phase 3: 前端管理 UI（1 周）

- [ ] Hook 管理页面（列表、创建、编辑、删除）
- [ ] 事件类型选择器
- [ ] 执行动作配置表单
- [ ] 执行历史查看器
- [ ] Hook 测试功能

### Phase 4: 系统事件集成（1 周）

- [ ] 工具调用事件：`tool.call_start`, `tool.call_end`
- [ ] 任务事件：`task.submit`, `task.complete`, `task.fail`
- [ ] 调度事件：`schedule.trigger`, `schedule.complete`
- [ ] 系统事件：`system.tunnel.connect`, `system.tunnel.disconnect`

### Phase 5: 高级功能（后续迭代）

- [ ] Hook 过滤器（toolName, pathPattern, condition）
- [ ] Hook 模板/预设
- [ ] Hook 链式执行（一个 hook 的输出作为另一个的输入）
- [ ] 在线 JS 编辑器（内联脚本）
- [ ] 执行日志和调试工具

## 11. 使用场景示例

### 场景 1: 会话结束后自动格式化代码

```json
{
  "name": "Auto Format",
  "event": "run.end",
  "action": { "type": "shell", "command": "npm run format" },
  "scope": "project",
  "failurePolicy": "warn"
}
```

### 场景 2: Agent 回复后发送通知

```json
{
  "name": "Reply Notification",
  "event": "message.agent_reply",
  "action": {
    "type": "webhook",
    "url": "https://hooks.slack.com/services/xxx",
    "method": "POST",
    "bodyTemplate": "{\"text\": \"Agent replied in project {{event.data.projectId}}\"}"
  },
  "scope": "global"
}
```

### 场景 3: 特定工具调用后运行测试

```json
{
  "name": "Auto Test After Write",
  "event": "tool.call_end",
  "filter": { "toolName": ["Write", "Edit"] },
  "action": { "type": "shell", "command": "npm test -- --changed" },
  "scope": "project",
  "failurePolicy": "ignore"
}
```

### 场景 4: 定时任务完成后生成报告

```json
{
  "name": "Daily Report",
  "event": "schedule.complete",
  "action": {
    "type": "script",
    "path": "./scripts/generate-report.ts",
    "runtime": "node"
  },
  "scope": "global"
}
```
