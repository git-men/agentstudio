---
name: command-designer
description: Guide for designing effective slash commands in AgentStudio. Use when creating custom /commands or prompt templates. Triggers include "创建命令", "创建command", "添加斜杠命令", "create command", "slash command".
---

# Command Designer

Guide the user through creating a slash command (prompt template).

## What Commands Are

Commands are `/command-name` templates that expand into pre-defined prompts. They're simpler than Skills — just a markdown template with optional YAML frontmatter.

## Guided Creation Flow

### Step 1: Purpose
Ask: "这个命令做什么？（如：代码审查、生成测试、格式化等）"

### Step 2: Arguments
Ask: "需要参数吗？（如：文件路径、类名等）"
- No arguments → simple template
- With arguments → add `argument-hint` in frontmatter

### Step 3: Tools
Ask: "需要限制可用工具吗？"
- Default: all tools available
- Restrict: add `allowed-tools` in frontmatter

### Step 4: Scope
Ask: "个人使用还是项目共享？"
- Personal → `scope: "user"` (stored in `~/.cursor/commands/`)
- Shared → `scope: "project"` (stored in `.cursor/commands/`)

## Command Format

```markdown
---
description: 审查当前文件的代码质量
argument-hint: <file_path>
allowed-tools: Read, Grep, Glob
---

请审查以下文件的代码质量：$ARGUMENTS

关注：
1. 代码规范
2. 潜在 bug
3. 性能问题

输出格式：
- 🔴 严重 / 🟡 建议 / 🟢 可选
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `description` | Yes | Command description (shown in picker) |
| `argument-hint` | No | Hint for arguments |
| `allowed-tools` | No | Comma-separated tool names |
| `model` | No | Model override |
| `namespace` | No | Hierarchical namespace (e.g., `code:test`) |

## Template Variables

- `$ARGUMENTS` — user input after command name

## Examples

**Review command**: `/review <file>` → code review prompt
**Test command**: `/test <function>` → generate unit tests
**Doc command**: `/doc` → generate documentation for current file

## After Generation

1. Show command preview
2. Ask: "命令名和内容 OK 吗？"
3. On confirmation → call `create_command` MCP tool
