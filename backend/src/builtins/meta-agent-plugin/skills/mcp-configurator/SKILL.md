---
name: mcp-configurator
description: Guide for configuring MCP (Model Context Protocol) servers in AgentStudio. Use when adding, configuring, or troubleshooting MCP server connections. Triggers include "配置MCP", "添加MCP服务", "MCP server", "configure mcp".
---

# MCP Configurator

Guide the user through configuring an MCP server connection.

## MCP Server Types

### stdio (Local)
Runs a local process. Best for local tools.

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "env": {}
}
```

### http (Remote)
Connects to remote HTTP endpoint. Best for shared services.

```json
{
  "url": "https://mcp-server.example.com/mcp",
  "headers": { "Authorization": "Bearer <token>" }
}
```

## Guided Configuration Flow

### Step 1: Identify Service
Ask: "要连接什么服务？（GitHub/文件系统/数据库/自定义...）"

### Step 2: Type Selection
Based on service:
- Local CLI tool → stdio
- Remote API → http
Ask: "是本地命令还是远程服务？"

### Step 3: Connection Details
**For stdio**: "运行命令是什么？需要什么参数？"
**For http**: "服务 URL 是什么？需要认证吗？"

### Step 4: Environment Variables
Ask: "需要配置环境变量吗？（如 API Key）"
- ⚠️ Never hardcode secrets in config
- Use environment variable references

## Common Configurations

### GitHub MCP
```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_TOKEN": "your-token" }
}
```

### Filesystem MCP
```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"],
  "env": {}
}
```

### Custom HTTP MCP
```json
{
  "url": "http://localhost:8080/mcp",
  "headers": {}
}
```

## Security Best Practices

- ✅ Store secrets in environment variables
- ✅ Limit filesystem access paths
- ✅ Validate MCP server connections before use
- ❌ Never hardcode API keys in config
- ❌ Don't expose internal services without auth

## After Configuration

1. Show config preview
2. Ask: "确认添加这个 MCP 服务吗？"
3. On confirmation → call `add_mcp_server` MCP tool
4. Recommend: "建议运行验证确认连接正常"
