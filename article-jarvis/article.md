# 打造 Jarvis这块，Clawdbot很野，但Agent Studio简直丧心病狂

> **TL;DR**: Clawdbot 通过消息应用桥接 AI Agent，配置复杂但功能强大。Agent Studio 则是一套完整的本地 Agent 工作台——企业微信一键接入（5 分钟）、定时任务自动化、A2A 多 Agent 协作、MCP Admin 元操作能力。更疯狂的是：所有代码开源，在 AI Coding 加持下，每个人都可以打造自己的 Jarvis。

---

## 前言：每个人都想要一个 Jarvis

还记得《钢铁侠》里的 Jarvis 吗？一个随时在线、无所不能的 AI 助手——它能帮你处理工作、管理项目、分析数据、甚至还能和你闲聊几句。这不就是我们一直梦想的终极 AI 助手吗？

在 AI Agent 领域，有不少项目都在朝着这个方向努力。比如 **Clawdbot**，它确实很"野"——把 AI Agent 和 WhatsApp、Telegram、Discord 等消息应用打通，让你能在手机上随时随地和 AI 对话。听起来很酷对吧？

但今天我要给你介绍一个更加"丧心病狂"的方案：**Agent Studio**。

## 场景对比：从手机访问你的 AI Agent

### Clawdbot 的方案

Clawdbot 的核心思路是：通过 **消息应用网关** 来访问 AI Agent。

它支持多个平台：
- 📱 WhatsApp (通过 Baileys 协议)
- ✈️ Telegram (Bot API)
- 🎮 Discord (Bot API)
- 💬 iMessage (通过 imsg CLI)
- 🧩 Mattermost (插件方式)

听起来很强大，但实际使用时你会发现：

1. **配置复杂**：需要配置 Gateway、Pi、Channel，还要处理 WebSocket 连接、Canvas 服务
2. **多平台分散**：每个平台都需要单独配置，管理起来很麻烦
3. **技术门槛高**：需要理解 RPC、Baileys、grammY 等技术细节
4. **调试困难**：命令行日志，出问题不好排查

**简单来说**：Clawdbot 给了你一堆零件，你需要自己组装。

### Agent Studio 的方案：企业微信一键接入

**Agent Studio 的核心定位是：打造一套完整的个人 Agent 工作台**。在众多功能中，**IM 接入**（目前已接入企业微信机器人）只是一个非常微小的特性。

对于腾讯内部或使用企业微信的团队来说，这个功能简直是杀手级体验。

#### Agent Studio接入企微的完整流程（只需 5 分钟）

**Step 1: 安装 Agent Studio**

```bash
npm install -g agentstudio
agentstudio start
```

**Step 2: 启用隧道（让企微机器人可以调用你本地的 Agent）**

访问 `http://localhost:4936/settings/tunnel`，使用 **Tunely (WebSocket)** 隧道：

![Tunely 隧道接入](screenshot-tunnel.png)

1. 点击 **"Tunely (WebSocket)"** 标签
2. 配置隧道名称和服务器地址
3. 点击 **"连接"** 按钮
4. 连接成功后会显示隧道地址（如 `https://kongjie.tunnel`）

**Step 3: 进入项目管理，配置 IM 接入**

1. 访问 `http://localhost:4936/projects`
2. 进入 **"项目管理"**
3. 选择要接入的项目，点击 **"A2A Protocol 管理"**, 倒数第三个图标
4. 切换到 **"IM 接入"** 标签

![IM 接入界面](screenshot-a2a-im.png)

5. 点击 **"生成接入命令"**，系统会自动：
   - ✅ 创建安全的 API 密钥
   - ✅ 检测网络状态（隧道或本地网络）
   - ✅ 生成完整的企微机器人接入命令，形如 `/ap my-project http://kongjie.tunnel/a2a/xxxx-agent-id/messages --api-key your-key`
6. 复制生成的命令

**Step 4: 加入群聊，开始使用**

1. 扫描下方二维码加入测试群聊（或在你的企微群里）

   ![扫码加入测试群聊](add_chat.png)

2. 在群里找到 **"agent studio"** 机器人（或私聊机器人）
3. 发送刚才复制的命令，将项目添加到企微中

   ![添加项目到企微](add-project.jpg)

4. 机器人会回复确认信息，项目添加成功
5. 现在你可以直接和机器人对话，使用你的本地 Agent 了！

   ![使用项目开始聊天](use-project.png)

**从此**：
- 📱 在手机上随时向本地 Agent 发送任务
- 💻 Agent 在你的电脑上执行，结果通过企微返回
- 📊 支持文件、代码、数据分析等各种工作场景
- 🔒 数据完全本地，不上传云端

**对比 Clawdbot**：
- **配置时间**：Clawdbot 需要 30 分钟+ vs Agent Studio 只需 5 分钟
- **技术门槛**：Clawdbot 需要懂技术 vs Agent Studio 点几个按钮
- **维护成本**：Clawdbot 需要管理多个配置 vs Agent Studio 自动管理
- **体验**：Clawdbot 纯文本 vs Agent Studio 可视化 + 企微原生体验

**而且**，对于腾讯内部用户，企业微信是最自然的选择——你不需要切换到 WhatsApp 或 Telegram，就在日常工作的企微里，呼叫你的 AI 助手。

## Agent Studio：不止是 IM 接入

如果你以为 Agent Studio 只是 IM 接入那就太小看它了。这是一个 **完整的本地 Agent 工作台**。

![Agent Studio 首页](screenshot-homepage.png)

### 一行命令，立即启动

```bash
npm install -g agentstudio && agentstudio start
```

访问 `http://localhost:4936`，你会看到一个完整的 Web 工作台：

![Agent Studio 工作台](screenshot-dashboard.png)

- 🎨 **现代化界面**：精心设计的专业 UI
- 📁 **文件浏览器**：对话的同时可以直接查看项目文件
- 🔍 **可视化工具执行**：AI 调用了什么工具、传了什么参数、返回了什么结果，一目了然
- 📊 **项目管理**：多项目支持，每个项目独立配置、独立记忆

![项目管理](screenshot-projects.png)

## 三大核心功能：让 Agent Studio 成为真正的 Jarvis

### 1. 定时任务：让 AI 按计划自动工作

这是 Agent Studio 最"丧心病狂"的功能之一——**让 AI Agent 按计划自动执行任务**。

![定时任务](screenshot-scheduled-tasks.png)

你可以配置：
- 📊 **每天早上 9 点**，自动生成项目进度日报
- 🔍 **每 2 小时**，检查代码仓库并提交审查意见
- 📝 **每周五**，自动整理本周会议纪要并归档
- 📈 **每月 1 号**，自动生成业务数据分析报告

**支持的调度规则**：
- Cron 表达式 (`0 22 * * *`)
- 简单表达式 (`每 30 分钟`)
- 一次性任务 (`2026/1/8 02:00:00`)

**执行历史和监控**：
- 查看每次执行的成功/失败状态
- 查看执行日志和结果
- 手动触发立即执行
- 启用/暂停任务

这不就是 Jarvis 该做的事吗？你只需要设定好规则，它就会在后台默默工作，完全不需要你操心。

### 2. A2A 协议：多 Agent 协作网络

Agent Studio 支持 **Agent-to-Agent (A2A) 协议**，让多个 Agent 形成协作网络。

这意味着：

1. **秘书 Agent 模式**
   - 一个统一的秘书 Agent 接收所有任务
   - 根据任务类型，自动调度到对应的项目 Agent
   - 比如：文档任务 → 文档 Agent，代码任务 → 代码 Agent

2. **本地 ↔ 远程协作**
   - 本地电脑上的 Agent 可以调用远程开发机上的 Agent
   - 远程 Agent 也可以访问本地 Agent
   - 形成分布式 Agent 网络

3. **移动端随时访问**
   - 通过 IM 接入（如企业微信）访问本地 Agent
   - Agent 在本地执行，结果通过 A2A 返回给 IM
   - 数据不上传，完全安全

**A2A 管理功能**：
- API 密钥管理（自动生成、一键复制）
- 外部 Agent 配置（添加远程 Agent）
- 任务历史追踪
- IM 接入命令生成

### 3. MCP Admin：Agent Studio 的元操作能力

这是最"黑科技"的功能——**让 AI Agent 管理 Agent Studio 本身**。

![MCP Admin](screenshot-mcp-admin.png)

Agent Studio 提供了一个特殊的 MCP 服务：**agentstudio-admin**，包含 22 个管理工具：

- `list_projects` / `get_project` / `register_project` / `update_project`
- `list_agents` / `get_agent` / `create_agent` / `update_agent`
- `list_mcp_servers` / `get_mcp_server` / `add_mcp_server`
- `list_scheduled_tasks` / `create_scheduled_task`
- ... 等等

**当你把这个 MCP 工具挂载到 Jarvis Agent 上时，会发生什么？**

**你的 AI Agent 可以自己管理 Agent Studio！**

举几个例子：

**场景 1：动态创建项目**
> 你："Jarvis，帮我创建一个新项目叫 my-blog，路径是 ~/projects/my-blog"  
> Jarvis：调用 `register_project` 工具，自动创建项目并配置 Agent

**场景 2：自动配置定时任务**
> 你："Jarvis，每天晚上 10 点帮我总结今天的 Git 提交记录"  
> Jarvis：调用 `create_scheduled_task` 工具，自动创建定时任务

**场景 3：智能 Agent 管理**
> 你："Jarvis，创建一个专门处理 Python 代码的 Agent"  
> Jarvis：调用 `create_agent` 工具，配置合适的系统提示词和工具

**这意味着**：
- 🤖 **Agent 可以自我管理**：根据需要动态创建项目、Agent、任务
- 🧠 **智能化配置**：不需要你手动点界面，AI 自己完成配置
- 🚀 **工作流自动化**：一句话描述需求，AI 自动完成所有配置

**这就是真正的元操作能力**——不仅是 AI 帮你做事，而是 AI 帮你管理 AI 工作台本身。

## Agent Studio vs Clawdbot：全面对比

| 维度 | Agent Studio | Clawdbot |
|-----|-------------|----------|
| **安装难度** | ⭐ 一行命令 | ⭐⭐⭐ 需配置多个组件 |
| **界面** | Web UI | CLI + 可选 Web UI |
| **目标用户** | 所有人 | 开发者为主 |
| **IM 接入** | ✅ 企业微信一键接入（腾讯内部最佳） | ⚠️ 需手动配置多个平台 |
| **定时任务** | ✅ 图形化配置 + Cron 支持 | ❌ |
| **A2A 协议** | ✅ 完整支持 + 可视化管理 | ❌ |
| **MCP Admin** | ✅ 元操作能力（AI 管理 AI） | ❌ |
| **工具可视化** | ✅ 实时展示 | ❌ 纯文本 |
| **项目管理** | ✅ 多项目支持 | ⚠️ 需手动配置 |
| **数据隐私** | ✅ 完全本地 | ✅ 完全本地 |

## 立即开始

### 安装

```bash
npm install -g agentstudio
agentstudio start
```

### 访问

打开浏览器，访问：
```
http://localhost:4936
```

### 开始使用

1. **配置 API Key**：在设置中添加你的 Anthropic/OpenAI API Key
2. **创建项目**：导入现有项目或创建新项目
3. **配置 IM 接入**：在项目 A2A 管理中生成企微接入命令
4. **创建定时任务**：让 AI 按计划自动工作
5. **启用 MCP Admin**：让 AI 管理 Agent Studio 本身

## 摊牌了：这是我的 Jarvis

说实话，**Agent Studio 就是我在打造自己的 Jarvis 时顺便产品化的小玩具**。

作为一个工程师，我深刻体会到：在这个 AI 时代，每个人都需要、并且有机会打造自己趁手的 Agent 工作台。而在 AI Coding 的加持下，这个成本已经低到令人难以置信。

我的建议是：**拿起 AI，和 AI 一起合作，尝试打磨更适合自己的 Agent 工作台**。

不要等待完美的产品出现，因为只有你最了解自己的需求：
- 也许你需要一个专门处理财务报表的 Agent
- 也许你需要一个能自动整理会议纪要的助手
- 也许你需要一个能帮你写代码、审代码、部署代码的工程师

**好消息是**：Agent Studio 所有代码开源（GPL v3），如果你有兴趣自己部署企微服务和隧道，可以进一步了解技术细节。你可以基于它改造出更适合自己的版本，也可以从零开始，用 AI 帮你写代码，快速搭建起自己的 Jarvis。

这不是科幻，这是现实。而且比你想象的要简单得多。

## 总结：你的 Jarvis，现在就可以拥有

**Clawdbot** 是一个出色的项目，为开发者提供了强大的工具箱。

但 **Agent Studio** 是一个**完整的解决方案**：

- 🚀 **开箱即用**：一行命令，立即启动
- 🎨 **用户友好**：Web UI，可视化操作
- 📱 **IM 接入**：企业微信一键接入（腾讯内部最佳体验）
- ⏰ **定时任务**：让 AI 按计划自动工作
- 🤝 **A2A 协议**：多 Agent 协作网络
- 🧠 **MCP Admin**：AI 管理 AI 的元操作能力
- 🔒 **数据安全**：完全本地运行，隐私可控

如果你想要一个 **真正可用的、全功能的、用户友好的** 本地 AI Agent 工作台，Agent Studio 就是你的最佳选择。

---

**项目链接：**
- GitHub: https://github.com/okguitar/agentstudio
- 文档: https://github.com/okguitar/agentstudio/blob/main/docs/USER_MANUAL.md
- 问题反馈: https://github.com/okguitar/agentstudio/issues

---

*Agent for Work — 本地的 Agent 工作台，由 Claude Agent SDK 强力驱动。*

*© 2026 AgentStudio. GPL v3 License.*
