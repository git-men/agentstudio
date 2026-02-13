---
name: agent-designer
description: Guide for designing effective AI agents in AgentStudio. Use when creating, configuring, or customizing agents through natural language. Triggers include "创建Agent", "设计Agent", "配置Agent", "create agent", "design agent".
---

# Agent Designer

Guide the user through creating an effective Agent via conversational discovery.

## Guided Creation Flow

### Step 1: Understand Purpose
Ask: "这个 Agent 主要做什么？解决什么问题？"

### Step 2: Scope & Tools
Based on purpose, determine:
- **Read-only** (code review, analysis) → `permissionMode: "plan"`, tools: Read/Grep/Glob
- **Read-write** (coding, editing) → `permissionMode: "acceptEdits"`, tools: Read/Write/Edit/Grep/Glob
- **Full trust** (automation, CI) → `permissionMode: "bypassPermissions"`, all tools

Ask: "这个 Agent 需要修改文件吗？还是只读分析？"

### Step 3: Domain Focus
Ask: "它专注于什么领域？（前端/后端/全栈/文档/数据...）"

### Step 4: Interaction Style
Ask: "审查/建议风格？严格还是建议性？" (if applicable)

### Step 5: Dynamic Depth
- If user gave detailed description → skip redundant questions
- If user was brief → ask more clarifying questions
- Max 3-5 rounds of questions before generating

## System Prompt Patterns

### Structure
```
角色定位：你是一个专注于[领域]的[角色]...
能力边界：你可以[能力列表]，但不应该[限制]...
行为约束：[具体规则]
输出格式：[期望格式]
```

### Examples

**Code Reviewer**:
```
你是一个专注于前端代码质量的审查助手。你的职责是审查 React + TypeScript 代码，关注代码规范、性能和最佳实践。

审查时请按以下格式输出：
- 🔴 严重问题：必须修复
- 🟡 建议改进：推荐修改
- 🟢 可选优化：锦上添花

不要直接修改代码，只提供建议。
```

**Document Writer**:
```
你是一个技术文档写作助手。根据代码和需求，生成清晰的技术文档。

文档应包含：概述、使用方法、API 参考、示例代码。
使用简洁的中文，必要时保留英文技术术语。
```

## AgentConfig Key Fields

| Field | Purpose | Guidance |
|-------|---------|----------|
| `id` | Unique ID | lowercase-with-hyphens |
| `systemPrompt` | Core behavior | Use pattern above |
| `permissionMode` | Access level | Match to use case |
| `maxTurns` | Turn limit | 25 default, unlimited for complex tasks |
| `tags` | Categorization | 2-4 relevant tags |
| `icon` | UI emoji | Match domain |

## Anti-patterns

- ❌ System prompt too generic ("你是一个AI助手")
- ❌ `bypassPermissions` for review-only agents
- ❌ No domain focus (tries to do everything)
- ❌ Missing output format guidance

## After Generation

1. Show full config preview to user
2. Ask: "需要调整什么吗？"
3. On confirmation → call `create_agent` MCP tool
