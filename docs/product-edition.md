# Product Edition System

AgentStudio supports product editions to control which features are available in a deployment. This is useful for:

- **Business deployments**: Only expose chat functionality, hide management UI
- **Lite deployments**: Core features without heavy extensions
- **Custom profiles**: Fine-grained control per customer

## Quick Start

Set the `PRODUCT_EDITION` environment variable before starting the service:

```bash
# Full edition (default) - all features
PRODUCT_EDITION=full pnpm run dev

# Chat-only edition - only chat, sessions, file access
PRODUCT_EDITION=chat-only pnpm run dev

# Lite edition - core + basic management
PRODUCT_EDITION=lite pnpm run dev

# Custom edition - reads from product-profile.json
PRODUCT_EDITION=custom pnpm run dev
```

Or use the `--product` CLI argument:

```bash
pnpm run dev -- --product=chat-only
```

## Editions

### Full (default)

All features enabled. Suitable for internal teams and full deployments.

### Chat-Only

Minimal deployment focused on the chat experience:

| Module | Access |
|--------|--------|
| core.chat | Full |
| core.sessions | Full |
| core.files | Full |
| manage.agents | Readonly (can view agents, not create/edit/delete) |
| manage.projects | Readonly (can view projects, not create/edit/delete) |
| Everything else | Disabled |

### Lite

Core features with basic management, without marketplace, scheduler, or tunnel:

| Module | Access |
|--------|--------|
| core.* | Full |
| manage.* | Full |
| extend.commands | Full |
| extend.rules | Full |
| system.settings | Full |
| system.versions | Readonly |
| Everything else | Disabled |

### Custom

Reads module access from `~/.agentstudio/data/product-profile.json`. See below.

## Custom Profile Configuration

Create `~/.agentstudio/data/product-profile.json`:

```json
{
  "name": "My Custom Edition",
  "description": "Custom deployment for Project X",
  "modules": {
    "core.chat": "full",
    "core.sessions": "full",
    "core.files": "full",
    "manage.agents": "readonly",
    "manage.projects": "readonly",
    "manage.dashboard": "full",
    "system.scheduler": "full"
  }
}
```

**Notes:**
- Core modules (`core.chat`, `core.sessions`, `core.files`) are always at least readonly
- Modules not listed default to `disabled`
- Access levels: `full`, `readonly`, `disabled`

## Feature Modules

### Core (essential infrastructure)

| Module ID | Description | Backend Routes |
|-----------|-------------|----------------|
| `core.chat` | Chat interface and AGUI protocol | `/api/agents/chat`, `/api/agents/user-response`, `/api/agui/*` |
| `core.sessions` | Session management | `/api/sessions/*`, `/api/agents/sessions` |
| `core.files` | File operations and media | `/api/files/*`, `/media/*` |

### Management

| Module ID | Description | Backend Routes | Frontend Page |
|-----------|-------------|----------------|---------------|
| `manage.dashboard` | Overview dashboard | - | `/dashboard` |
| `manage.agents` | Agent CRUD | `/api/agents` | `/agents` |
| `manage.projects` | Project CRUD | `/api/projects` | `/projects` |
| `manage.mcp` | MCP server config | `/api/mcp` | `/mcp` |

### Extensions

| Module ID | Description | Backend Routes | Frontend Page |
|-----------|-------------|----------------|---------------|
| `extend.commands` | Slash commands | `/api/commands` | `/settings/commands` |
| `extend.subagents` | Subagent config | `/api/subagents` | `/settings/subagents` |
| `extend.skills` | Skills management | `/api/skills` | `/skills` |
| `extend.plugins` | Plugin marketplace | `/api/plugins`, `/api/marketplace-skills` | `/plugins` |
| `extend.rules` | Rules management | `/api/rules` | `/rules` |
| `extend.hooks` | Hooks management | `/api/hooks` | `/hooks` |

### System

| Module ID | Description | Backend Routes | Frontend Page |
|-----------|-------------|----------------|---------------|
| `system.settings` | General settings | `/api/settings`, `/api/config` | `/settings/*` |
| `system.scheduler` | Scheduled tasks | `/api/scheduled-tasks` | `/scheduled-tasks` |
| `system.tunnel` | Tunnel config | `/api/tunnel`, `/api/cloudflare-tunnel` | `/settings/tunnel` |
| `system.a2a` | A2A protocol | `/api/a2a`, `/a2a/*` | - |
| `system.mcp-admin` | MCP admin | `/api/mcp-admin*` | `/settings/mcp-admin` |
| `system.versions` | Version management | `/api/version` | - |
| `system.voice` | Voice input | `/api/speech-to-text` | `/settings/voice` |

## Architecture

The product edition system layers on top of the existing engine capabilities:

```
┌─────────────────────────────────────────────────┐
│  Product Edition (what it offers)               │
│  full | chat-only | lite | custom               │
│  → Controls which feature modules are available │
├─────────────────────────────────────────────────┤
│  Engine Capabilities (how it runs)              │
│  claude-sdk | cursor-cli | codebuddy-sdk        │
│  → Controls which engine features are supported │
└─────────────────────────────────────────────────┘
```

Both layers are checked:
- **Backend**: `productGateMiddleware` runs before route handlers, blocks disabled modules
- **Frontend**: `useProduct` hook + `PageGate`/`ModuleGate` components hide disabled pages

### Backend Flow

```
Request → CORS → JSON Parser → productGateMiddleware → authMiddleware → Route Handler
                                      ↓
                              Resolve path → module
                              Check module access
                              full → pass
                              readonly → GET only
                              disabled → 403
```

### Frontend Flow

```
App.tsx Routes → PageGate → ProtectedRoute → Layout → Page Component
                    ↓
            Check module enabled
            enabled → render page
            disabled → redirect to /
```

Sidebar navigation items have `requireModule` property that hides them when the module is disabled.

## API

### GET /api/engine

Returns engine config including product info:

```json
{
  "engine": "claude-sdk",
  "name": "Claude Agent SDK",
  "capabilities": { ... },
  "paths": { ... },
  "product": {
    "edition": "chat-only",
    "name": "Chat Edition",
    "description": "Chat-focused deployment...",
    "modules": {
      "core.chat": "full",
      "core.sessions": "full",
      "manage.agents": "readonly",
      ...
    },
    "availableModules": [
      {
        "id": "core.chat",
        "name": "Chat",
        "category": "core",
        "access": "full",
        "frontendPaths": ["/chat"]
      },
      ...
    ]
  }
}
```
