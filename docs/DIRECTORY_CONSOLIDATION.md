# AgentStudio 用户目录整合方案

> 状态: 待实施 | 日期: 2026-02-10

## 1. 背景

AgentStudio 当前在用户目录下创建了 **3 个分散的目录**，职责划分不清晰，命名不统一：

| 目录 | 用途 | 定义位置 |
|------|------|----------|
| `~/.claude-agent/` | Agent 配置、项目元数据、MCP、A2A 映射、定时任务 | `config/paths.ts` |
| `~/.agent-studio/` | 应用配置（端口、密码、JWT）、幻灯片数据 | `config/index.ts` (硬编码) |
| `~/.agentstudio/` | 运行时数据（日志、PID、遥测 ID、语音转文字配置） | `serviceManager.ts` 等 (硬编码) |

### 主要问题

1. **命名不统一** - `.agent-studio`（有连字符）vs `.agentstudio`（无连字符）vs `.claude-agent`
2. **路径大多硬编码** - 缺乏统一的配置入口
3. **遥测和语音转文字** 完全忽略 `--data-dir` 参数
4. **日志管理** - 自行管理日志文件，没有 logrotate，应该交给系统日志管理
5. **Windows 脚本** 甚至用了第四个名字 `.agent-studio-config`

## 2. 目标

将所有目录统一到 `~/.agentstudio/`，支持环境变量自定义，并简化日志管理。

## 3. 新目录结构

```
~/.agentstudio/
├── config/
│   └── config.json              # 应用配置（端口、密码、JWT、CORS、Slack 等）
├── agents/                      # Agent 配置文件
├── data/
│   ├── slides/                  # 幻灯片存储
│   ├── projects.json            # 项目元数据
│   ├── claude-versions.json     # Claude 版本配置
│   ├── mcp-server.json          # MCP 服务器配置
│   ├── a2a-agent-mappings.json  # A2A Agent 映射注册表
│   ├── admin-api-keys.json      # Admin API 密钥
│   ├── tunnel-config.json       # 隧道配置
│   └── speech-to-text.json      # 语音转文字配置
├── run/                         # 运行时文件（可清理）
│   ├── instance_id              # 遥测实例 ID
│   └── agentstudio.pid          # PID 文件
├── scripts/                     # 服务管理脚本 (Linux)
├── slack-session-locks/         # Slack 会话锁
└── scheduled-tasks/             # 定时任务
    ├── tasks.json
    └── history/
```

### 不变的部分

- **`~/.claude/`** 和 **`~/.cursor/`** - 由 Claude SDK 和 Cursor IDE 管理，AgentStudio 只读取
- **项目级 `.a2a/`** 和 **`.agentstudio-images/`** - 属于项目级别，不变
- **`~/Library/LaunchAgents/`** 和 **`~/.config/systemd/user/`** - 系统服务注册，不变
- **`~/claude-code-projects/`** - 默认项目目录，不变

## 4. 路径映射

| 旧路径 | 新路径 |
|--------|--------|
| `~/.agent-studio/config/config.json` | `~/.agentstudio/config/config.json` |
| `~/.agent-studio/data/slides/` | `~/.agentstudio/data/slides/` |
| `~/.claude-agent/agents/` | `~/.agentstudio/agents/` |
| `~/.claude-agent/projects.json` | `~/.agentstudio/data/projects.json` |
| `~/.claude-agent/claude-versions.json` | `~/.agentstudio/data/claude-versions.json` |
| `~/.claude-agent/mcp-server.json` | `~/.agentstudio/data/mcp-server.json` |
| `~/.claude-agent/a2a-agent-mappings.json` | `~/.agentstudio/data/a2a-agent-mappings.json` |
| `~/.claude-agent/admin-api-keys.json` | `~/.agentstudio/data/admin-api-keys.json` |
| `~/.claude-agent/tunnel-config*.json` | `~/.agentstudio/data/tunnel-config*.json` |
| `~/.claude-agent/slack-session-locks/` | `~/.agentstudio/slack-session-locks/` |
| `~/.claude-agent/scheduled-tasks/` | `~/.agentstudio/scheduled-tasks/` |
| `~/.agentstudio/speech-to-text.json` | `~/.agentstudio/data/speech-to-text.json` |
| `~/.agentstudio/instance_id` | `~/.agentstudio/run/instance_id` |
| `~/.agentstudio/agentstudio.pid` | `~/.agentstudio/run/agentstudio.pid` |
| `~/.agentstudio/scripts/` | `~/.agentstudio/scripts/` (保持) |
| `~/.agentstudio/logs/` | **删除**（改用系统日志） |

## 5. 环境变量

新增 `AGENTSTUDIO_HOME` 环境变量，允许自定义根目录：

```bash
export AGENTSTUDIO_HOME=/custom/path  # 默认 ~/.agentstudio
```

优先级：`--data-dir` CLI 参数 > `AGENTSTUDIO_HOME` 环境变量 > 默认值 `~/.agentstudio`

## 6. 日志策略

| 运行模式 | 日志方式 |
|----------|----------|
| 前台模式 (`pnpm dev`, `agentstudio start`) | 纯 stdout/stderr |
| macOS 服务 (`agentstudio install`) | 由 launchd 管理，通过 Console.app 或 `log show` 查看 |
| Linux systemd | 由 journald 管理，通过 `journalctl -u agentstudio` 查看 |
| Linux 脚本模式 | nohup 重定向到 `/tmp/agentstudio-*.log` |

`agentstudio logs` 命令将根据运行模式自动选择合适的日志查看方式。

## 7. 代码改动范围

### 核心文件（必改）

| 文件 | 改动内容 |
|------|----------|
| `backend/src/config/paths.ts` | 重写所有路径常量，基于 AGENTSTUDIO_HOME |
| `backend/src/config/index.ts` | 改用 paths.ts 中的常量 |
| `backend/src/bin/serviceManager.ts` | 改用 paths.ts，去掉日志文件 |
| `backend/src/bin/agentstudio.ts` | 更新 --data-dir 默认值 |
| `backend/src/services/telemetry.ts` | 改用 paths.ts |
| `backend/src/services/speechToText/index.ts` | 改用 paths.ts |
| `backend/src/routes/config.ts` | 改用 paths.ts |
| `backend/src/services/mcpAdmin/adminApiKeyService.ts` | 改用 paths.ts |

### 自动生效（已用 paths.ts 常量）

所有导入 `CLAUDE_AGENT_DIR`、`AGENTS_DIR` 等常量的文件（约 12 个），在 paths.ts 更新后自动生效。

### 安装/部署文件

- `install-macos.sh`, `install-linux.sh`
- `Dockerfile`, `Dockerfile.npm` 等
- `windows-install.ps1`, `windows-install-simple.bat`

## 8. 迁移策略

在 paths.ts 中加入启动时迁移逻辑：

1. 检测旧目录（`~/.claude-agent/` 和 `~/.agent-studio/`）是否存在
2. 如果存在且新目录不存在对应文件，复制到新位置
3. 在旧目录下创建 `.migrated` 标记文件（包含迁移时间和版本）
4. 控制台输出迁移日志
5. 旧目录保留，用户确认后手动清理

## 9. 向后兼容

- `--data-dir` 参数继续支持
- 自动迁移保证升级无感
- as-mate 项目不受影响（它有自己的路径配置系统）
- `~/.claude/` 和 `~/.cursor/` 不改（它们是 SDK/IDE 的目录，只读取）
- 项目级 `.a2a/` 和 `.agentstudio-images/` 不改

## 10. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 迁移时文件冲突 | 低 | 中 | 只在新位置不存在时才复制 |
| 旧版本回退 | 低 | 中 | 旧目录保留，回退时仍可用 |
| Docker 容器兼容 | 中 | 低 | 同时更新 Dockerfile |
| 已安装的 launchd/systemd 服务 | 中 | 中 | 更新 install 命令自动重装服务 |
