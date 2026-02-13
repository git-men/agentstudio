# Pre-Send Guard (Pluggable)

Pre-send guard is an optional pipeline that runs before `/api/agents/chat` sends user text to the model.

Default behavior is unchanged: if not configured, requests go through directly.

## Decision Model

A provider returns one of:

- `allow`: continue
- `block`: reject request with HTTP `403`
- `rewrite`: replace message and continue
- `require_confirm`: treated as blocked (HTTP `403`) for now

## Config Layers

Resolution order:

1. Agent (`agent.preSendGuard.enabled`)  
2. Global dedicated file (`~/.agentstudio/config/pre-send-guard.json`)

Providers are resolved by: `agent.preSendGuard.providers ?? matchedGlobal.providers`.

## Dedicated Global Guard File (Recommended)

Path:

- default: `~/.agentstudio/config/pre-send-guard.json`
- if started with `--data-dir /path/to/dir`: `/path/to/dir/config/pre-send-guard.json`

Example:

```json
{
  "version": 1,
  "default": {
    "enabled": false,
    "providers": [
      {
        "name": "http-audit",
        "enabled": true,
        "timeoutMs": 3000,
        "onError": "allow",
        "options": {
          "url": "https://your-audit-service.example.com/check",
          "method": "POST",
          "headers": {
            "x-api-key": "<token>"
          }
        }
      }
    ]
  },
  "rules": [
    {
      "id": "customer-support-web",
      "enabled": true,
      "matcher": {
        "agentIds": ["customer-support-agent"],
        "channels": ["web"],
        "projectPathPrefixes": ["/Users/example/projects/support"]
      },
      "config": {
        "enabled": true,
        "providers": [
          {
            "name": "http-audit",
            "timeoutMs": 2000,
            "onError": "block",
            "options": {
              "url": "https://biz-audit.example.com/moderate"
            }
          }
        ]
      }
    }
  ]
}
```

`rules` uses first-match semantics (top to bottom).

## Agent-Level Override Example

In agent JSON:

```json
{
  "preSendGuard": {
    "enabled": true,
    "providers": [
      {
        "name": "http-audit",
        "timeoutMs": 2000,
        "onError": "block",
        "options": {
          "url": "https://biz-audit.example.com/moderate"
        }
      }
    ]
  }
}
```

## Built-in Providers

- `noop`: always allow
- `http-audit`: call an external HTTP endpoint and normalize response

Accepted `http-audit` response formats:

```json
{ "decision": "allow" }
```

```json
{ "decision": "block", "reason": "Sensitive content", "code": "policy_violation" }
```

```json
{ "decision": "rewrite", "rewrittenMessage": "masked text" }
```

or legacy-style:

```json
{ "allow": false, "reason": "Blocked" }
```
