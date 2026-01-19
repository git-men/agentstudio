# @tencent/agentstudio-tc-installer

一键安装 AgentStudio 和腾讯内部 Claude Code 的安装程序。

## 使用方法

只需运行一条命令：

```bash
npx --registry=https://mirrors.tencent.com/npm/ @tencent/agentstudio-tc-installer
```

## 功能

这个安装程序会自动完成以下步骤：

1. ✅ 全局安装 `agentstudio`
2. ✅ 使用腾讯内部 registry 安装 `@tencent/claude-code-internal`
3. ✅ 在 `~/.claude-agent/claude-versions.json` 中配置 `claude-tc` 版本
4. ✅ 启动 AgentStudio 服务
5. ✅ 自动打开浏览器访问 http://localhost:4936

## 跨平台支持

- ✅ macOS
- ✅ Linux
- ✅ Windows

## 系统要求

- Node.js >= 18.0.0
- npm

## 后续使用

安装完成后，下次启动只需运行：

```bash
agentstudio start
```

## 配置说明

安装程序会在 `~/.claude-agent/claude-versions.json` 中创建一个名为 `claude-tc` 的配置：

- **别名**: `claude-tc`
- **描述**: 腾讯内部 Claude Code 版本
- **可执行路径**: 自动检测 `claude-internal` 的安装位置

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 本地测试
node dist/index.js
```

## 发布

```bash
# 确保登录到腾讯内部 npm registry
npm login --registry=https://mirrors.tencent.com/npm/

# 发布
npm publish --access public
```
