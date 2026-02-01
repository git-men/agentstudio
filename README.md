# AgentStudio

<div align="center">

![AgentStudio](./frontend/public/cc-studio.png)

**Agent for Work — Your Local Agent Workspace**

Powered by Claude Agent SDK & Cursor CLI

[![GPL v3 License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://opensource.org/licenses/GPL-3.0)
[![GitHub stars](https://img.shields.io/github/stars/okguitar/agentstudio.svg)](https://github.com/okguitar/agentstudio/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/okguitar/agentstudio.svg)](https://github.com/okguitar/agentstudio/issues)

[English](README.md) | [中文](README.zh-CN.md)

</div>

---

## 📖 Overview

AgentStudio is a **local Agent workspace** running on your computer — a true personal AI assistant. Your data stays completely private, secure, and under your control. It supports scheduled task automation and multi-agent collaboration.

AgentStudio transforms the CLI experience into a friendly Web interface, making AI agents accessible to everyone, not just developers.

### 🔌 Dual Engine Support

AgentStudio supports two AI engines:

| Engine | Description | Best For |
|--------|-------------|----------|
| **Claude Agent SDK** | Full-featured engine with complete read/write capabilities | Power users who need full control |
| **Cursor CLI** | Read-only integration with Cursor's configuration | Users who manage configs via Cursor IDE |

<div align="center">

![Chat Interface](./frontend/public/screenshot-chat.png)

</div>

## 🚀 Quick Start

Install and run with npm:

```bash
# Install globally
npm install -g agentstudio

# Start the server
agentstudio start
```

Then open [http://localhost:4936](http://localhost:4936) in your browser.

**More commands:**

```bash
agentstudio start --port 8080  # Custom port
agentstudio install            # Install as system service (auto-start)
agentstudio upgrade            # Upgrade to latest version
agentstudio doctor             # Check system status
agentstudio --help             # Show all commands
```

## ✨ Core Features

### 🖥️ Local Agent Workspace

- **Runs on your computer** — A true local workspace
- **Data stays private** — Nothing uploaded to the cloud
- **Full control** — Files, code, and conversations remain in your hands

### 🌐 Web-Based Experience

- **Say goodbye to CLI** — Embrace a friendly Web interface
- **Visual tool execution** — See what your Agent is doing in real-time
- **Built-in file browser** — View project files alongside conversations

### 🧰 Configuration Management

Manage your AI configurations through a friendly interface:

| Feature | Claude SDK | Cursor CLI |
|---------|------------|------------|
| **MCP** | Full CRUD | Read-only (view `~/.cursor/mcp.json`) |
| **Rules** | Full CRUD | Read-only (view `~/.cursor/rules/`) |
| **Commands** | Full CRUD | Read-only (view `~/.cursor/commands/`) |
| **Skills** | Full CRUD | Read-only (view `~/.cursor/skills/`) |
| **Hooks** | Full CRUD | Not available |
| **Plugin Ecosystem** | ✅ | ✅ |
| **Project Memory** | ✅ | ✅ |
| **Subagents** | ✅ | ✅ |
| **Multi-Model** | Claude, GLM, DeepSeek, Kimi K2, MiniMax, and more | Cursor models |

### ⏰ Scheduled Tasks

Let your Agent work automatically on a schedule — true AI work automation!

**Example scenarios:**
- 📊 **Daily progress reports** — Generate project updates every morning at 9am
- 🔍 **Automated code review** — Check repositories every 2 hours
- 📝 **Weekly meeting notes** — Summarize and archive every Friday
- 📈 **Monthly analytics** — Generate business data reports on the 1st

### 🔗 A2A Protocol (Agent-to-Agent)

Build a collaborative network of intelligent agents:

- **Secretary Agent dispatch** — One Agent receives tasks and delegates to project-specific Agents
- **Local ↔ Remote collaboration** — Agents on your computer communicate with Agents on remote dev machines
- **Mobile access** — Interact with local Agents from mobile messaging apps (beta)

### 🎨 Custom Agents

Create your own specialized Agents without writing code:

- **PPT creation Agent**
- **Secretary Agent**
- **Document writing Agent**
- **Code review Agent**
- And any other workflow you need!

## 📊 AgentStudio vs Claude Code

| Feature | AgentStudio | Claude Code |
|---------|-------------|-------------|
| Interface | Web UI | Command Line (CLI) |
| Target Users | Everyone | Primarily developers |
| Tool Display | Visual rendering | Plain text |
| File Browser | ✅ | ❌ |
| Agent Customization | ✅ | ❌ |
| Scheduled Tasks | ✅ | ❌ |
| A2A Protocol | ✅ | ❌ |
| Mobile Access | Beta | ❌ |

Same Claude Agent SDK, friendlier experience.

## 📦 Alternative Installation

### Docker

```bash
docker build -t agentstudio:latest .
docker-compose up -d
```

See [DOCKER.md](DOCKER.md) for details.

### One-Click Install

**macOS/Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/okguitar/agentstudio/main/scripts/install-macos.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/okguitar/agentstudio/main/scripts/windows-install.ps1 | iex
```

### Development Setup

```bash
git clone https://github.com/okguitar/agentstudio.git
cd agentstudio
pnpm install
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys
pnpm run dev
```

## 🔧 Engine Configuration

AgentStudio supports two AI engines. Choose the one that fits your workflow.

### Selecting an Engine

Set the `ENGINE` environment variable before starting the server:

```bash
# Use Claude Agent SDK (default, full features)
ENGINE=claude-sdk pnpm run dev

# Use Cursor CLI (read-only config management)
ENGINE=cursor-cli pnpm run dev
```

Or set it in your `backend/.env` file:

```env
# Choose: claude-sdk or cursor-cli
ENGINE=claude-sdk
```

### Engine Comparison

| Feature | Claude SDK | Cursor CLI |
|---------|------------|------------|
| **MCP Management** | Create, edit, delete | View only |
| **Rules Management** | Create, edit, delete | View only |
| **Commands Management** | Create, edit, delete | View only |
| **Skills Management** | Create, edit, delete | View only |
| **Hooks** | ✅ Supported | ❌ Not available |
| **Provider Selection** | ✅ Multiple providers | ❌ Cursor only |
| **Config Location** | `~/.claude/` | `~/.cursor/` |
| **File Extension** | `.md` | `.mdc` |

### When to Use Each Engine

**Claude Agent SDK** is recommended when:
- You want full control over configurations
- You need to create/edit MCP servers, rules, commands, skills
- You want to use Hooks for automation
- You prefer managing everything through AgentStudio

**Cursor CLI** is recommended when:
- You primarily use Cursor IDE for configuration
- You want AgentStudio as a read-only dashboard
- You need to view your Cursor configurations in a web interface
- You want to avoid accidental config modifications

### Important Notes

1. **Config Isolation**: Each engine uses its own config directory
   - Claude SDK: `~/.claude/`
   - Cursor CLI: `~/.cursor/`

2. **Read-Only Mode**: In Cursor CLI mode, write operations are blocked with a "Read-only mode" indicator

3. **Feature Visibility**: Some features (like Hooks) are automatically hidden in Cursor CLI mode

4. **Switching Engines**: Restart the server when changing engines

## 🧪 Development

```bash
pnpm run dev          # Start development servers
pnpm run test         # Run tests
pnpm run type-check   # Type checking
pnpm run lint         # Linting
pnpm run build        # Production build
```

## 📦 Tech Stack

**Frontend:** React 19, TypeScript, Vite, TailwindCSS, Zustand, React Query

**Backend:** Node.js, Express, TypeScript, Claude Agent SDK, Cursor CLI, JWT

**Supported Engines:**
- Claude Agent SDK — Full-featured AI agent capabilities
- Cursor CLI — Integration with Cursor IDE configurations

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

GPL v3 License — see [LICENSE](LICENSE) for details.

## 📮 Support

- 🐛 [Report Issues](https://github.com/okguitar/agentstudio/issues)
- 💬 [Discussions](https://github.com/okguitar/agentstudio/discussions)
- 📧 Email: okguitar@gmail.com

---

<div align="center">

Made with ❤️ by the AgentStudio Team

</div>
