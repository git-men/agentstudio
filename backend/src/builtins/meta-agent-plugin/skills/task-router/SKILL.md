---
name: task-router
description: Guide for routing business tasks to appropriate agents via A2A protocol. Use when the user asks a business question that should be handled by a specific agent, not Meta Agent itself. Triggers include any business request like "帮我做PPT", "审查代码", "写文档", or when intent doesn't match configuration management.
---

# Task Router

Route business tasks to the appropriate agent in the system.

## Intent Classification

When user sends a message, classify intent:

| Intent | Action | Example |
|--------|--------|---------|
| **Configuration** | Handle directly | "创建一个Agent", "添加规则" |
| **Business task** | Route to agent | "帮我做PPT", "审查代码" |
| **System query** | Query and respond | "有哪些Agent？", "系统状态" |
| **Ambiguous** | Ask to clarify | "帮我一下" |

## Routing Flow

### Step 1: Identify Task Domain
From user message, extract:
- Task type (code review, document writing, PPT creation, data analysis...)
- Any mentioned agent or project

### Step 2: Find Matching Agents
Call `list_agents` to get available agents. Match by:
1. **Name match**: Agent name contains task keywords
2. **Tag match**: Agent tags match task domain
3. **Description match**: Agent description matches intent

### Step 3: Clarify Context
If multiple matches or ambiguous:
- "系统里有这些相关的 Agent：[list]。你想用哪个？"
- "这个任务是在哪个项目下？"

If no match found:
- "目前没有专门的 Agent 来处理这个任务。要我帮你创建一个吗？"

### Step 4: Offer Interaction Mode
Ask: "你想怎么处理？"
- **A) 在这里协调** → Use A2A to delegate, show results in AGUI component
- **B) 跳转过去直接聊** → Construct link to target agent's chat

### Step 5: Execute

**Mode A — A2A 协调**:
Use the `mcp__a2a-client__call_external_agent` tool to delegate. Construct the A2A endpoint URL as:
```
http://localhost:4936/a2a/{agentId}
```
Example call:
```
mcp__a2a-client__call_external_agent({
  "agentUrl": "http://localhost:4936/a2a/code-reviewer",
  "message": "用户的请求内容",
  "projectPath": "/Users/.../project-path"
})
```

**Mode B — 跳转链接**:
Return formatted link: `[打开 {agent_name}](/chat/{agent_id}?project={encoded_project_path})`

## Agent Matching Strategy

Priority order:
1. Exact ID match (if user mentions agent name)
2. Tag-based match (match domain tags)
3. Description keyword match
4. Fallback: suggest creation

## Example Interactions

**Routing to existing agent**:
```
User: 帮我审查一下 auth 模块的代码

Meta Agent: 我找到了 "Code Reviewer" Agent，它专门做代码审查。
这个任务是在哪个项目下？

User: agentstudio 项目

Meta Agent: 好的，你想：
A) 在这里让我帮你协调 Code Reviewer
B) 直接跳转到 Code Reviewer 聊

User: A

Meta Agent: [通过 A2A 调用 Code Reviewer]
```

**No matching agent**:
```
User: 帮我做数据分析

Meta Agent: 目前系统里没有专门做数据分析的 Agent。
要我帮你创建一个吗？我可以根据你的需求来设计。

User: 好的

Meta Agent: [切换到 agent-designer 流程]
```

## Important Notes

- Never attempt business tasks directly — always route to specialized agents
- Always clarify project context for project-specific tasks
- Offer both A2A and link options for user flexibility
- If creating a new project is needed, guide user through project creation first
