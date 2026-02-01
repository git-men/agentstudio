# Models Information

本文档介绍如何查看和管理 AgentStudio 中可用的 AI 模型。

## 概述

AgentStudio 支持多个 AI 引擎,每个引擎提供不同的模型和能力:

- **Claude Engine**: Claude Agent SDK,支持 MCP 工具、子代理等高级功能
- **Cursor Engine**: Cursor CLI 包装器,支持多种 AI 模型

## 查看可用模型

### 方法 1: 使用 Web 界面

访问 `/models` 页面查看所有可用模型的图形化界面:

```
http://localhost:3000/models
```

该页面显示:
- 所有注册的引擎及其能力
- 每个引擎支持的模型列表
- 模型特性(视觉能力、思维模式等)
- 活跃的会话数量

### 方法 2: 使用 CLI 工具

从终端运行以下命令:

```bash
# 显示所有引擎的模型
pnpm run list-models

# 只显示特定引擎的模型
pnpm run list-models -- --engine claude

# 输出 JSON 格式(用于脚本处理)
pnpm run list-models -- --json

# 指定后端 API 地址
pnpm run list-models -- --api-url http://localhost:4936
```

### 方法 3: 使用 API

直接调用后端 API:

```bash
# 获取所有引擎和模型
curl http://127.0.0.1:4936/api/agui/engines

# 获取特定引擎的信息
curl http://127.0.0.1:4936/api/agui/engines/claude
curl http://127.0.0.1:4936/api/agui/engines/cursor
```

## 引擎能力对比

### Claude Engine

**特性:**
- ✅ 多轮对话
- ✅ 思维模式
- ✅ 视觉能力
- ✅ 流式输出
- ✅ 子代理支持
- ✅ MCP 工具集成
- ✅ 代码执行

**支持的模型:**
- `sonnet`: Claude Sonnet(支持视觉)
- `sonnet-thinking`: Claude Sonnet 思维模式
- `opus`: Claude Opus(支持视觉)
- `opus-thinking`: Claude Opus 思维模式
- `haiku`: Claude Haiku(轻量级)

**配置:**
- 提供商(Claude 版本)可配置
- 支持环境变量配置
- 权限模式可选(default/acceptEdits/bypassPermissions/plan)

### Cursor Engine

**特性:**
- ✅ 多轮对话
- ✅ 思维模式(取决于模型)
- ✅ 视觉能力
- ✅ 流式输出
- ❌ 子代理支持
- ❌ MCP 工具(使用自己的工具系统)
- ✅ 代码执行

**支持的模型:**
- `sonnet-4.5`: Claude Sonnet 4.5
- `sonnet-4.5-thinking`: Claude Sonnet 4.5 思维模式
- `opus-4.5`: Claude Opus 4.5
- `opus-4.5-thinking`: Claude Opus 4.5 思维模式
- `gpt-5.2`: GPT 5.2
- `gemini-3-pro`: Gemini 3 Pro

**配置:**
- 需要安装 Cursor CLI
- 只支持 `bypassPermissions` 权限模式(--force)

## 模型特性说明

### 视觉能力 (Vision)

带有 👁️ 标记的模型支持图像输入,可以:
- 分析图片内容
- 理解图表和可视化数据
- 处理截图和设计稿

### 思维模式 (Thinking)

带有 🧠 标记的模型支持扩展思考模式,会:
- 显示详细的推理过程
- 在响应前进行深度思考
- 适合复杂问题和任务

## API 响应格式

```typescript
interface EnginesResponse {
  engines: Array<{
    type: 'claude' | 'cursor';
    isDefault: boolean;
    capabilities: {
      features: {
        multiTurn: boolean;
        thinking: boolean;
        vision: boolean;
        streaming: boolean;
        subagents: boolean;
        codeExecution: boolean;
      };
      mcp: {
        supported: boolean;
      };
      permissionModes: string[];
      ui: {
        showMcpToolSelector: boolean;
        showImageUpload: boolean;
        showPermissionSelector: boolean;
        showProviderSelector: boolean;
        showModelSelector: boolean;
        showEnvVars: boolean;
      };
    };
    models: Array<{
      id: string;
      name: string;
      isVision: boolean;
      isThinking?: boolean;
      description?: string;
    }>;
    activeSessions: number;
  }>;
  defaultEngine: string;
  totalActiveSessions: number;
}
```

## 使用示例

### 通过 AGUI 协议发送消息

```typescript
// 使用 Claude engine
const response = await fetch('http://127.0.0.1:4936/api/agui/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    engineType: 'claude',
    workspace: '/path/to/project',
    message: 'Hello, Claude!',
    model: 'sonnet',
    providerId: 'your-claude-version-id',
    permissionMode: 'acceptEdits'
  })
});

// 使用 Cursor engine
const response = await fetch('http://127.0.0.1:4936/api/agui/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    engineType: 'cursor',
    workspace: '/path/to/project',
    message: 'Hello, Cursor!',
    model: 'sonnet-4.5',
    timeout: 600000
  })
});
```

## 故障排除

### CLI 工具无法连接

1. 确保后端正在运行:
   ```bash
   curl http://127.0.0.1:4936/api/agui/health
   ```

2. 检查端口配置是否正确

3. 如果使用自定义端口,使用 `--api-url` 参数

### Web 页面无法加载

1. 检查路由配置是否正确
2. 确保已启动前端开发服务器: `pnpm run dev`
3. 查看浏览器控制台的错误信息

### Cursor 引擎不可用

1. 安装 Cursor CLI:
   ```bash
   # 参考 Cursor 官方文档安装 CLI
   ```

2. 设置环境变量(如需要):
   ```bash
   export CURSOR_CLI_PATH=/path/to/cursor
   export CURSOR_API_KEY=your_api_key
   ```

## 相关文件

- **Web 页面**: `frontend/src/pages/ModelsPage.tsx`
- **CLI 工具**: `frontend/scripts/list-models.js`
- **后端路由**: `backend/src/routes/agui.ts`
- **引擎实现**:
  - Claude: `backend/src/engines/claude/claudeEngine.ts`
  - Cursor: `backend/src/engines/cursor/cursorEngine.ts`
- **类型定义**: `backend/src/engines/types.ts`

## 更多信息

查看项目根目录的 `CLAUDE.md` 获取完整的开发文档。
