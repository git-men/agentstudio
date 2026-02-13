# SDK Mock Testing Framework

> Drop-in replacement for Claude Agent SDK's `query()` function, enabling full-stack testing without a real Claude Code CLI or API key.

## Quick Start

```bash
# Start backend with mock SDK
MOCK_SDK=true pnpm run dev

# Then use the frontend normally — it will use mock responses
```

## How It Works

### Architecture

```
Normal flow:
  Frontend → /api/agents/chat → agents.ts → ClaudeSession → query() → Claude Code CLI → Anthropic API

Mock flow:
  Frontend → /api/agents/chat → agents.ts → ClaudeSession → createMockQuery() → JSONL scenario replay
```

The mock replaces `query()` at the lowest possible level — inside `ClaudeSession.initializeClaudeStream()`. All downstream code runs unchanged:
- `agents.ts` still detects `compact_boundary` events
- AGUI adapter still converts SDK messages
- SSE output is still formatted the same way
- Frontend receives identical data

### Modes

| Environment Variable | Behavior |
|---|---|
| `MOCK_SDK=true` | Use mock scenarios (JSONL replay) |
| `MOCK_SDK=record` | Use real SDK + record to JSONL (planned) |
| (not set) | Normal operation, no impact |

## Scenario Files

Scenarios are `.jsonl` files in `testing/scenarios/`. Each file represents a complete SDK conversation flow.

### File Format

```jsonl
{"_meta":{"name":"auto-compact","description":"Auto-compaction scenario","trigger":"auto-compact","version":"1.0"}}
{"_delay":100,"type":"system","subtype":"init","session_id":"{{SESSION_ID}}","tools":["Read","Write"],"model":"claude-sonnet-4-20250514"}
{"_delay":200,"type":"stream_event","session_id":"{{SESSION_ID}}","event":{"type":"message_start","message":{"id":"msg_001","role":"assistant","content":[]}}}
{"_delay":30,"type":"stream_event","session_id":"{{SESSION_ID}}","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}}
...
{"_delay":100,"type":"result","subtype":"success","session_id":"{{SESSION_ID}}","is_error":false,"duration_ms":3500}
```

### Special Fields

| Field | Description |
|---|---|
| `_meta` | First line only. Scenario metadata (name, description, trigger keyword) |
| `_delay` | Milliseconds to wait before yielding this message. Simulates network latency |
| `{{SESSION_ID}}` | Template variable, replaced with actual session ID at runtime |

### Trigger Matching

When a user sends a message, the `ScenarioLoader` matches it against scenario triggers:

1. If the message contains a scenario's `trigger` keyword → use that scenario
2. Otherwise → use the `normal` scenario (trigger: `__default__`)

### Available Scenarios

| File | Trigger | Description |
|---|---|---|
| `normal.jsonl` | (default) | Basic conversation with streaming text output |
| `auto-compact.jsonl` | `auto-compact` | Auto-compaction: text → compact_boundary → continue |
| `manual-compact.jsonl` | `/compact` | Manual compact: compact_boundary + summary |
| `tool-use.jsonl` | `use-tool` | Tool use flow (Read tool) |

## Adding New Scenarios

### Method 1: Write manually

Create a new `.jsonl` file in `testing/scenarios/`:

```bash
# Copy an existing scenario as a template
cp scenarios/normal.jsonl scenarios/my-scenario.jsonl
# Edit the file
```

Key rules:
- First line must be `{"_meta": {...}}` with at least `name` and `trigger`
- Each subsequent line is one SDK message
- Use `{{SESSION_ID}}` for session IDs (auto-replaced)
- `_delay` values are in milliseconds

### Method 2: Record from real sessions (planned)

```bash
# Start in record mode
MOCK_SDK=record pnpm run dev

# Use the app normally — SDK messages are captured
# Scenarios saved to testing/scenarios/_recorded/
```

## Module Structure

```
backend/src/testing/
├── index.ts              # Public API exports
├── mockSdkQuery.ts       # Mock query factory (createMockQuery, isMockEnabled)
├── scenarioLoader.ts     # JSONL parser, trigger matching, replay generator
├── README.md             # This file
└── scenarios/            # Scenario files
    ├── normal.jsonl
    ├── auto-compact.jsonl
    ├── manual-compact.jsonl
    ├── tool-use.jsonl
    └── _recorded/        # Recorded scenarios (gitignored)
```

## Usage in Unit Tests

The mock can also be used with vitest for automated testing:

```typescript
import { createMockQuery } from '../testing/mockSdkQuery.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (params: any) => createMockQuery(params),
  Options: {},
}));
```

## Code Changes Required

Only two files are modified to enable the mock:

### `claudeSession.ts` (primary path)

```typescript
import { createMockQuery, isMockEnabled } from '../testing/mockSdkQuery.js';

// In initializeClaudeStream():
if (isMockEnabled()) {
  this.queryObject = createMockQuery({ prompt: this.messageQueue, options: queryOptions });
} else {
  this.queryObject = query({ prompt: this.messageQueue, options: queryOptions });
}
```

### `claudeEngine.ts` (model list)

```typescript
import { isMockEnabled } from '../../testing/mockSdkQuery.js';

// In fetchModelsFromSdk():
if (isMockEnabled()) {
  return [{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (Mock)', ... }];
}
```

## Future Plans

- **AGUI-level recording**: Record at the AGUI event stream level, which can serve as both test fixtures and chat history replay
- **Scenario composer**: Visual tool to compose scenarios by mixing and matching message blocks
- **CI integration**: Run scenarios as part of the CI pipeline for regression testing
