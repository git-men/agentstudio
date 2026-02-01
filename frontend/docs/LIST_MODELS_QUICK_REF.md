# List Models - 快速参考

## 🚀 快速开始

### 查看所有可用模型

**方式 1: Web UI (推荐)**
```
访问: http://localhost:3000/models
```

**方式 2: 命令行**
```bash
pnpm run list-models
```

**方式 3: API**
```bash
curl http://127.0.0.1:4936/api/agui/engines
```

## 📋 CLI 命令

```bash
# 查看所有模型
pnpm run list-models

# 只看 Claude 引擎
pnpm run list-models -- --engine claude

# 只看 Cursor 引擎  
pnpm run list-models -- --engine cursor

# JSON 输出
pnpm run list-models -- --json

# 自定义 API 地址
pnpm run list-models -- --api-url http://custom-host:port

# 帮助信息
pnpm run list-models -- --help
```

## 🔧 API 端点

```bash
# 所有引擎
GET /api/agui/engines

# 特定引擎
GET /api/agui/engines/claude
GET /api/agui/engines/cursor

# 健康检查
GET /api/agui/health

# 状态
GET /api/agui/status
```

## 📦 Claude Engine 模型

| ID | 名称 | 视觉 | 思维 |
|----|------|------|------|
| sonnet | Claude Sonnet | ✓ | - |
| sonnet-thinking | Claude Sonnet (Thinking) | ✓ | ✓ |
| opus | Claude Opus | ✓ | - |
| opus-thinking | Claude Opus (Thinking) | ✓ | ✓ |
| haiku | Claude Haiku | - | - |

**能力**: MCP ✓ | 子代理 ✓ | 多权限模式 ✓

## 🎯 Cursor Engine 模型

| ID | 名称 | 视觉 | 思维 |
|----|------|------|------|
| sonnet-4.5 | Claude Sonnet 4.5 | ✓ | - |
| sonnet-4.5-thinking | Claude Sonnet 4.5 (Thinking) | ✓ | ✓ |
| opus-4.5 | Claude Opus 4.5 | ✓ | - |
| opus-4.5-thinking | Claude Opus 4.5 (Thinking) | ✓ | ✓ |
| gpt-5.2 | GPT 5.2 | ✓ | - |
| gemini-3-pro | Gemini 3 Pro | ✓ | - |

**能力**: 多提供商 ✓ | 仅 bypassPermissions 模式

## 🔍 JSON 响应格式

```typescript
{
  engines: [{
    type: 'claude' | 'cursor',
    isDefault: boolean,
    capabilities: {
      features: {
        multiTurn: boolean,
        thinking: boolean,
        vision: boolean,
        streaming: boolean,
        subagents: boolean,
        codeExecution: boolean
      },
      mcp: { supported: boolean }
    },
    models: [{
      id: string,
      name: string,
      isVision: boolean,
      isThinking?: boolean,
      description?: string
    }],
    activeSessions: number
  }],
  defaultEngine: string,
  totalActiveSessions: number
}
```

## 💡 使用示例

### JavaScript/TypeScript
```typescript
const response = await fetch('http://127.0.0.1:4936/api/agui/engines');
const { engines, defaultEngine } = await response.json();

// 获取默认引擎的模型
const defaultEngineInfo = engines.find(e => e.type === defaultEngine);
console.log(`Default engine: ${defaultEngine}`);
console.log('Available models:', defaultEngineInfo.models.map(m => m.id));
```

### Bash
```bash
# 获取所有 Claude 模型 ID
curl -s http://127.0.0.1:4936/api/agui/engines | \
  jq -r '.engines[] | select(.type=="claude") | .models[].id'

# 检查 Cursor 引擎是否支持 MCP
curl -s http://127.0.0.1:4936/api/agui/engines/cursor | \
  jq '.capabilities.mcp.supported'
```

### Python
```python
import requests

response = requests.get('http://127.0.0.1:4936/api/agui/engines')
data = response.json()

# 列出所有支持视觉的模型
for engine in data['engines']:
    vision_models = [m['name'] for m in engine['models'] if m['isVision']]
    print(f"{engine['type']}: {', '.join(vision_models)}")
```

## ❓ 故障排除

### 后端未运行
```bash
# 检查后端状态
curl http://127.0.0.1:4936/api/agui/health

# 如果无响应,启动后端
cd backend && pnpm run dev
```

### CLI 工具报错
```bash
# 检查脚本权限
ls -la scripts/list-models.js

# 添加执行权限
chmod +x scripts/list-models.js
```

### Web 页面 404
```bash
# 确认路由已添加
grep -r "ModelsPage" src/App.tsx

# 重启开发服务器
pnpm run dev
```

## 📚 相关文档

- **详细文档**: `docs/MODELS.md`
- **实现总结**: `docs/LIST_MODELS_SUMMARY.md`
- **AGUI 协议**: `../../backend/src/engines/types.ts`

## 🎨 Web UI 特性

- ✓ 实时更新(每 10 秒)
- ✓ 深色模式支持
- ✓ 响应式设计
- ✓ 图标化特性标识
- ✓ 彩色能力标签
- ✓ 活跃会话计数
- ✓ 渐变色卡片设计

## 🔗 快捷链接

- **Web UI**: http://localhost:3000/models
- **API Docs**: http://localhost:4936/api/agui/engines
- **Health Check**: http://localhost:4936/api/agui/health
