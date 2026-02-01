# List Models 功能实现总结

## 实现内容

为 AgentStudio 添加了多种方式来查看和管理可用的 AI 模型。

## 新增文件

### 1. Web 界面: ModelsPage.tsx
**路径**: `frontend/src/pages/ModelsPage.tsx`

**功能**:
- 图形化展示所有可用引擎和模型
- 显示引擎能力(多轮对话、思维模式、视觉、流式输出等)
- 实时显示活跃会话数量
- 响应式设计,支持深色模式
- 每 10 秒自动刷新数据

**特色**:
- 使用图标标识模型特性(👁️ 视觉, 🧠 思维)
- 漂亮的渐变色卡片设计
- 能力标签使用彩色徽章
- 统计概览卡片

**访问路径**: http://localhost:3000/models

### 2. CLI 工具: list-models.js
**路径**: `frontend/scripts/list-models.js`

**功能**:
- 命令行查看所有可用模型
- 支持按引擎类型过滤
- 支持 JSON 输出格式
- 美化的表格输出
- 可配置 API 地址

**使用方法**:
```bash
# 查看所有模型
pnpm run list-models

# 只看 Claude 引擎
pnpm run list-models -- --engine claude

# JSON 格式输出
pnpm run list-models -- --json

# 自定义 API 地址
pnpm run list-models -- --api-url http://localhost:4936

# 查看帮助
pnpm run list-models -- --help
```

**输出示例**:
```
╔═══════════════════════════════════════════════════════════════╗
║                    Available AI Models                        ║
╚═══════════════════════════════════════════════════════════════╝

📊 Summary:
   • Total Engines: 2
   • Default Engine: claude
   • Active Sessions: 0

─────────────────────────────────────────────────────────────────
🚀 Engine: CLAUDE [DEFAULT]
─────────────────────────────────────────────────────────────────

   Capabilities:
   • Multi-turn: ✓
   • Thinking: ✓
   • Vision: ✓
   • Streaming: ✓
   • Subagents: ✓
   • MCP: ✓
   • Active Sessions: 0

   Available Models (5):
   1. 👁️   Claude Sonnet
      ID: sonnet
   2. 👁️ 🧠 Claude Sonnet (Thinking)
      ID: sonnet-thinking
   ...
```

### 3. 文档: MODELS.md
**路径**: `frontend/docs/MODELS.md`

**内容**:
- 完整的使用指南
- 引擎能力对比
- API 响应格式说明
- 使用示例代码
- 故障排除指南

## 修改的文件

### 1. frontend/src/App.tsx
- 添加 ModelsPage 的懒加载导入
- 添加 `/models` 路由配置

### 2. frontend/src/pages/index.ts
- 导出 ModelsPage 组件

### 3. frontend/package.json
- 添加 `list-models` npm 脚本

## 后端 API 端点

使用现有的 AGUI API 端点:

### GET /api/agui/engines
返回所有引擎和模型信息:
- 引擎类型和能力
- 支持的模型列表
- 活跃会话数量
- 默认引擎标识

### GET /api/agui/engines/:type
返回特定引擎的详细信息。

## 数据结构

### 引擎信息
```typescript
interface EngineInfo {
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
    mcp: { supported: boolean };
  };
  models: ModelInfo[];
  activeSessions: number;
}
```

### 模型信息
```typescript
interface ModelInfo {
  id: string;              // 模型 ID,如 'sonnet', 'gpt-5.2'
  name: string;            // 显示名称
  isVision: boolean;       // 是否支持视觉
  isThinking?: boolean;    // 是否支持思维模式
  description?: string;    // 模型描述
}
```

## 支持的引擎和模型

### Claude Engine
**默认引擎,支持高级功能**

模型列表:
- `sonnet` - Claude Sonnet (视觉 ✓)
- `sonnet-thinking` - Claude Sonnet 思维模式 (视觉 ✓, 思维 ✓)
- `opus` - Claude Opus (视觉 ✓)
- `opus-thinking` - Claude Opus 思维模式 (视觉 ✓, 思维 ✓)
- `haiku` - Claude Haiku (轻量级)

能力:
- ✓ MCP 工具集成
- ✓ 子代理支持
- ✓ 多种权限模式
- ✓ 环境变量配置
- ✓ 提供商(Claude 版本)管理

### Cursor Engine
**Cursor CLI 包装器**

模型列表:
- `sonnet-4.5` - Claude Sonnet 4.5 (视觉 ✓)
- `sonnet-4.5-thinking` - Claude Sonnet 4.5 思维模式 (视觉 ✓, 思维 ✓)
- `opus-4.5` - Claude Opus 4.5 (视觉 ✓)
- `opus-4.5-thinking` - Claude Opus 4.5 思维模式 (视觉 ✓, 思维 ✓)
- `gpt-5.2` - GPT 5.2 (视觉 ✓)
- `gemini-3-pro` - Gemini 3 Pro (视觉 ✓)

能力:
- ✓ 多种 AI 提供商模型
- ✓ 原生 Cursor 工具集成
- ⚠️ 仅支持 bypassPermissions 模式
- ⚠️ 不支持 MCP 工具
- ⚠️ 不支持子代理

## 使用场景

### 1. 开发者查看可用模型
```bash
pnpm run list-models
```

### 2. 用户在 Web UI 中选择模型
访问 http://localhost:3000/models 查看详细信息

### 3. 脚本自动化
```bash
# 获取 JSON 格式数据并处理
pnpm run list-models -- --json | jq '.engines[0].models[].id'
```

### 4. API 集成
```bash
curl http://127.0.0.1:4936/api/agui/engines | jq
```

## 技术栈

- **前端**: React + TypeScript + TanStack Query
- **样式**: Tailwind CSS + Lucide Icons
- **CLI**: Node.js (纯 JavaScript,无依赖)
- **后端**: 使用现有的 AGUI API

## 亮点功能

1. **三种访问方式**: Web UI、CLI、API
2. **实时更新**: Web UI 每 10 秒自动刷新
3. **美观易用**: 图标化展示、彩色标签、渐变设计
4. **灵活过滤**: CLI 支持按引擎类型过滤
5. **多格式输出**: 支持人类可读和机器可读(JSON)格式
6. **完整文档**: 包含使用指南和故障排除
7. **零额外依赖**: CLI 工具使用 Node.js 内置模块

## 下一步建议

1. **添加模型搜索**: Web UI 中添加搜索框
2. **模型收藏**: 允许用户标记常用模型
3. **性能对比**: 显示不同模型的性能指标
4. **使用统计**: 追踪各模型的使用频率
5. **模型测试**: 在 Web UI 中直接测试模型
6. **导出功能**: 导出模型列表为 CSV/PDF

## 相关文档

- **完整使用文档**: `frontend/docs/MODELS.md`
- **AGUI 协议**: `backend/src/engines/types.ts`
- **路由配置**: `backend/src/routes/agui.ts`
- **引擎实现**: `backend/src/engines/*/`
