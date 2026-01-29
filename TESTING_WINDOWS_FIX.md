# Windows Claude-Internal SDK 修复测试指引

## 问题描述

Windows 用户使用 `agentstudio start --sdk claude-internal` 启动时遇到以下错误：

```
Error: Failed to spawn Claude Code process: spawn C:\Users\julianwu\AppData\Roaming\npm\claude-internal ENOENT
```

**根本原因**：
- 系统尝试启动 `claude-internal` 时没有添加 `.cmd` 扩展名
- Windows 上 npm 全局安装的包会创建 `.cmd` 包装器，必须使用正确的扩展名

## 修复分支

```bash
fix/windows-claude-internal-sdk
```

## 测试步骤

### 1. 获取修复代码

```bash
# Clone 仓库（如果还没有）
git clone https://github.com/okguitar/agentstudio.git
cd agentstudio

# 切换到修复分支
git fetch origin
git checkout fix/windows-claude-internal-sdk
```

### 2. 安装依赖

```bash
# 安装依赖（使用 pnpm）
pnpm install
```

### 3. 构建项目

```bash
# 构建 backend
cd backend
pnpm run build
cd ..
```

### 4. 启动测试

#### 测试场景 1: 使用 claude-internal SDK（问题场景）

```bash
cd backend
node dist/bin/agentstudio.js start --port 4094 --sdk claude-internal
```

**期望结果**：
- ✅ 服务成功启动，没有 ENOENT 错误
- ✅ 控制台输出类似：
  ```
  [System] Found claude-internal CLI at: ...
  ```
  或
  ```
  [System] Initialized Claude version without executable path
  ```
  (这是正常的，SDK 会使用 bundled CLI)
- ✅ 可以访问 `http://localhost:4094`

#### 测试场景 2: 使用默认 claude SDK（对照测试）

```bash
cd backend
node dist/bin/agentstudio.js start --port 4094
```

**期望结果**：
- ✅ 服务正常启动

#### 测试场景 3: 实际使用测试

1. 打开浏览器访问 `http://localhost:4094`
2. 创建一个新的 Agent
3. 发送消息测试 Agent 是否能正常工作

## 需要收集的日志

### 启动日志

请提供完整的启动日志，特别是以下部分：

```bash
[System] Found claude-internal CLI at: ...
[System] Initialized Claude version from: ...
🔧 Agent SDK Configuration:
   Engine: ...
   Directory: ...
```

### 错误日志（如果有）

如果仍然出现错误，请提供：
1. 完整的错误堆栈
2. `where claude-internal` 命令的输出（Windows）
3. Node.js 版本：`node --version`
4. npm 版本：`npm --version`
5. 操作系统版本

### 测试命令

```powershell
# 1. 检查 claude-internal 安装位置
where claude-internal

# 2. 检查文件是否存在
dir "C:\Users\<your-username>\AppData\Roaming\npm\claude-internal*"

# 3. 查看 Node 和 npm 版本
node --version
npm --version

# 4. 查看系统信息
systeminfo | findstr /B /C:"OS Name" /C:"OS Version"
```

## 预期修复效果

修复后，AgentStudio 将：
1. 根据 `--sdk` 参数正确查找对应的 CLI（`claude` 或 `claude-internal`）
2. 在 Windows 上自动检测并处理 `.cmd` 文件
3. 如果找到 `.cmd` 包装器，自动让 SDK 使用 bundled CLI（更可靠）
4. 避免 ENOENT 错误

## 联系方式

如果测试过程中遇到问题，请提供：
- 完整的启动日志
- 上述测试命令的输出
- 错误截图（如果有）

通过企业微信或 GitHub Issue 反馈。
