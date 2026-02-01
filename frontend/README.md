# AgentStudio Frontend

React + TypeScript + Vite 前端应用,为 AgentStudio AI 代理工作台提供现代化 Web 界面。

## 功能特性

- 🤖 多引擎支持 (Claude, Cursor)
- 💬 实时流式聊天界面
- 🔧 MCP 工具集成
- 📊 项目和代理管理
- 🎨 深色模式支持
- 🌐 国际化 (中文/英文)
- 📱 响应式设计

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm run dev

# 构建生产版本
pnpm run build

# 预览生产构建
pnpm run preview
```

## 开发命令

```bash
# 开发
pnpm run dev              # 启动开发服务器 (端口 3000)

# 构建
pnpm run build           # TypeScript 检查 + Vite 构建
pnpm run type-check      # 仅 TypeScript 检查

# 测试
pnpm test                # 运行测试 (watch 模式)
pnpm run test:run        # 运行测试 (单次)
pnpm run test:coverage   # 生成覆盖率报告
pnpm run test:ui         # 启动测试 UI

# 代码质量
pnpm run lint            # ESLint 检查和修复

# Storybook
pnpm run storybook       # 启动 Storybook (端口 6006)
pnpm run build-storybook # 构建 Storybook

# 实用工具
pnpm run list-models     # 列出所有可用 AI 模型
```

## 查看可用模型

### 方式 1: Web UI
访问 http://localhost:3000/models 查看图形化界面

### 方式 2: CLI
```bash
# 查看所有模型
pnpm run list-models

# 只看 Claude 引擎
pnpm run list-models -- --engine claude

# JSON 输出
pnpm run list-models -- --json

# 帮助
pnpm run list-models -- --help
```

详细文档: [docs/MODELS.md](docs/MODELS.md)

## 项目结构

```
src/
├── components/          # React 组件
│   ├── agentChat/      # 聊天相关组件
│   ├── tools/          # 工具可视化组件
│   ├── ui/             # 通用 UI 组件
│   └── ...
├── hooks/              # React Hooks
│   ├── agentChat/     # 聊天相关 hooks
│   └── ...
├── pages/              # 页面组件
│   ├── ChatPage.tsx
│   ├── ModelsPage.tsx
│   └── ...
├── stores/             # Zustand 状态管理
├── types/              # TypeScript 类型定义
├── utils/              # 工具函数
├── i18n/               # 国际化配置
└── App.tsx             # 应用入口
```

## 技术栈

- **框架**: React 19 + TypeScript
- **构建**: Vite 7
- **状态管理**: 
  - Zustand (客户端状态)
  - TanStack Query (服务器状态)
- **路由**: React Router v7
- **样式**: Tailwind CSS
- **图标**: Lucide React
- **测试**: Vitest + Testing Library
- **国际化**: react-i18next

## 环境变量

创建 `.env` 文件:

```env
# Telemetry (可选)
VITE_POSTHOG_API_KEY=phc_your_api_key_here
VITE_POSTHOG_HOST=https://app.posthog.com
VITE_APP_VERSION=0.1.0
```

## API 端点

默认连接到本地后端:
- 开发环境: http://127.0.0.1:4936
- 生产环境: 用户可配置

相关端点:
- `/api/agents/*` - 代理管理
- `/api/agui/*` - AGUI 协议 (统一引擎接口)
- `/api/projects/*` - 项目管理
- `/api/mcp/*` - MCP 工具
- `/api/sessions/*` - 会话历史

## 开发指南

### 代码风格

- 使用 ESLint 和 TypeScript 严格模式
- 组件使用函数式组件 + Hooks
- 样式使用 Tailwind CSS
- 所有用户可见文本使用 i18n

### 类型安全

类型定义必须与后端保持同步:
- `src/types/agents.ts` ↔ `backend/src/types/agents.ts`
- `src/types/commands.ts` ↔ `backend/src/types/commands.ts`
- 其他类型文件同理

### 测试

测试文件位于 `__tests__/` 目录或与源文件同级。

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test src/hooks/agentChat/useAIStreamHandler.test.ts

# 查看覆盖率
pnpm run test:coverage
```

## 文档

- [MODELS.md](docs/MODELS.md) - 模型信息完整指南
- [LIST_MODELS_QUICK_REF.md](docs/LIST_MODELS_QUICK_REF.md) - 快速参考
- [LIST_MODELS_SUMMARY.md](docs/LIST_MODELS_SUMMARY.md) - 实现总结
- [CLAUDE.md](../CLAUDE.md) - 项目整体开发文档

## 故障排除

### 开发服务器无法启动

1. 检查端口 3000 是否被占用
2. 清除缓存: `rm -rf node_modules/.vite`
3. 重新安装依赖: `pnpm install`

### 后端连接失败

1. 确保后端正在运行: `curl http://127.0.0.1:4936/api/agui/health`
2. 检查 API 配置: 设置 > API 设置
3. 查看浏览器控制台错误

### 类型错误

```bash
# 运行类型检查
pnpm run type-check

# 如果是后端类型不匹配,同步更新前后端类型定义
```

## 部署

### Vercel (推荐)

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel
```

配置已包含在 `vercel.json` 中。

### 其他平台

```bash
# 构建生产版本
pnpm run build

# dist/ 目录包含静态文件,可部署到任何静态托管服务
```

## 许可证

MIT

## 相关链接

- [AgentStudio 主仓库](https://github.com/agent-studio/agentstudio)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [文档](../CLAUDE.md)
