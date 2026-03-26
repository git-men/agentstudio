/**
 * AgentStudio Admin CLI
 *
 * Provides CLI access to all AgentStudio Admin MCP tools.
 * The CLI is a thin wrapper that calls the MCP Admin HTTP endpoint,
 * consuming ~94% fewer tokens than loading MCP schemas into agent context.
 *
 * Design:
 * - `tools`          — Discover available tools (grouped by category)
 * - `describe <tool>` — Show tool schema and usage
 * - `call <tool>`     — Execute any tool with --key value or JSON args
 *
 * All output is JSON by default (agent-friendly, pipeable to jq).
 */

import { Command } from 'commander';
import { McpAdminClient, resolveClientConfig } from './adminClient.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TOOL_CATEGORIES: Record<string, { label: string; prefix: string[] }> = {
  projects:   { label: 'Projects',          prefix: ['list_projects', 'get_project', 'register_project', 'update_project'] },
  agents:     { label: 'Agents',            prefix: ['list_agents', 'get_agent', 'create_agent', 'update_agent', 'delete_agent', 'toggle_agent_tool', 'preview_agent', 'get_agent_chat_url'] },
  mcp:        { label: 'MCP Servers',       prefix: ['list_mcp_servers', 'get_mcp_server', 'add_mcp_server', 'remove_mcp_server'] },
  system:     { label: 'System',            prefix: ['get_system_status', 'get_active_sessions', 'health_check'] },
  providers:  { label: 'Providers',         prefix: ['list_providers', 'get_provider', 'create_provider', 'update_provider', 'delete_provider', 'get_default_provider', 'set_default_provider'] },
  tasks:      { label: 'Scheduled Tasks',   prefix: ['list_scheduled_tasks', 'get_scheduled_task', 'create_scheduled_task', 'update_scheduled_task', 'delete_scheduled_task', 'toggle_scheduled_task', 'run_scheduled_task', 'get_task_history', 'get_scheduler_status', 'get_running_executions', 'stop_task_execution', 'enable_scheduler', 'disable_scheduler'] },
  skills:     { label: 'Skills',            prefix: ['list_skills', 'get_skill', 'create_skill', 'update_skill', 'delete_skill'] },
  rules:      { label: 'Rules',             prefix: ['list_rules', 'get_rule', 'create_rule', 'update_rule', 'delete_rule'] },
  commands:   { label: 'Commands',          prefix: ['list_commands', 'get_command', 'create_command', 'update_command', 'delete_command'] },
  hooks:      { label: 'Hooks',             prefix: ['list_hooks', 'get_hook', 'create_hook', 'update_hook', 'delete_hook'] },
  marketplace:{ label: 'Marketplace',       prefix: ['list_marketplaces', 'list_marketplace_plugins', 'list_installed_plugins', 'install_plugin', 'uninstall_plugin'] },
  a2a:        { label: 'A2A Protocol',      prefix: ['get_a2a_endpoint', 'list_a2a_api_keys', 'create_a2a_api_key', 'allow_a2a_call'] },
  tunnel:     { label: 'Tunnel',            prefix: ['configure_tunnel', 'create_tunnel', 'get_tunnel_status', 'connect_tunnel', 'disconnect_tunnel'] },
  wecom:      { label: 'WeCom Bots',        prefix: ['list_wecom_bots', 'get_wecom_bot', 'create_wecom_bot', 'update_wecom_bot'] },
  enterprise: { label: 'Enterprise Auth',   prefix: ['login_enterprise', 'check_enterprise_auth', 'refresh_enterprise_token'] },
};

function toDashCase(s: string): string {
  return s.replace(/_/g, '-');
}

function toSnakeCase(s: string): string {
  return s.replace(/-/g, '_');
}

function camelToKebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function categorize(toolName: string): string {
  for (const [cat, { prefix }] of Object.entries(TOOL_CATEGORIES)) {
    if (prefix.includes(toolName)) return cat;
  }
  return 'other';
}

/**
 * Try to parse a value as the most specific JSON type.
 * "true"/"false" → boolean, numeric strings → number, otherwise string.
 */
function coerceValue(val: string): unknown {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  // Try JSON array/object
  if ((val.startsWith('[') && val.endsWith(']')) || (val.startsWith('{') && val.endsWith('}'))) {
    try { return JSON.parse(val); } catch { /* fall through */ }
  }
  return val;
}

/**
 * Parse variadic CLI args into a params object.
 * Supports:
 *   --key value        → { key: value }
 *   --kebab-key value  → { kebabKey: value } (auto camelCase)
 *   --flag             → { flag: true }
 *   --no-flag          → { flag: false }
 *   '{"json":"str"}'   → merged as-is
 */
function parseToolArgs(args: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--no-')) {
      const key = kebabToCamel(arg.slice(5));
      result[key] = false;
      i++;
    } else if (arg.startsWith('--')) {
      const rawKey = arg.slice(2);
      const key = kebabToCamel(rawKey);

      // Check if next arg is a value or another flag
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        const val = args[i + 1];
        // Handle repeated keys as arrays
        if (key in result) {
          const existing = result[key];
          result[key] = Array.isArray(existing) ? [...existing, coerceValue(val)] : [existing, coerceValue(val)];
        } else {
          result[key] = coerceValue(val);
        }
        i += 2;
      } else {
        result[key] = true;
        i++;
      }
    } else {
      // Positional argument — try to parse as JSON
      try {
        const parsed = JSON.parse(arg);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          Object.assign(result, parsed);
        }
      } catch {
        // Ignore non-JSON positional args
      }
      i++;
    }
  }

  return result;
}

function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function outputError(message: string): void {
  console.error(`\x1b[31mError:\x1b[0m ${message}`);
}

async function createClient(options: { server?: string; apiKey?: string }): Promise<McpAdminClient> {
  const config = resolveClientConfig(options);
  const client = new McpAdminClient(config.baseUrl, config.apiKey);
  await client.initialize();
  return client;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * Create the `admin` command group for the AgentStudio CLI.
 */
export function createAdminCommand(): Command {
  const admin = new Command('admin')
    .description('Manage AgentStudio via Admin API (replaces MCP with lightweight CLI)')
    .option('-s, --server <url>', 'Server URL (env: AGENTSTUDIO_SERVER)', process.env.AGENTSTUDIO_SERVER || 'http://127.0.0.1:4936')
    .option('-k, --api-key <key>', 'Admin API key (env: AGENTSTUDIO_ADMIN_API_KEY)');

  // ── agentstudio admin tools ────────────────────────────────────────────────

  admin
    .command('tools')
    .description('List all available admin tools (grouped by category)')
    .option('-c, --category <cat>', 'Filter by category')
    .option('--json', 'Output raw JSON')
    .action(async (opts) => {
      try {
        const parentOpts = admin.opts();
        const client = await createClient(parentOpts);
        const tools = await client.listTools();

        if (opts.json) {
          outputJson(tools);
          return;
        }

        // Group by category
        const grouped: Record<string, typeof tools> = {};
        for (const tool of tools) {
          const cat = categorize(tool.name);
          if (opts.category && cat !== opts.category) continue;
          if (!grouped[cat]) grouped[cat] = [];
          grouped[cat].push(tool);
        }

        // Display
        const categoryOrder = Object.keys(TOOL_CATEGORIES);
        const sortedKeys = Object.keys(grouped).sort((a, b) => {
          const ia = categoryOrder.indexOf(a);
          const ib = categoryOrder.indexOf(b);
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });

        console.log('');
        console.log(`\x1b[1mAgentStudio Admin Tools\x1b[0m (${tools.length} total)`);
        console.log('');

        if (opts.category && sortedKeys.length === 0) {
          console.log(`  No tools found in category "${opts.category}".`);
          console.log(`  Available categories: ${categoryOrder.join(', ')}`);
          return;
        }

        for (const cat of sortedKeys) {
          const catInfo = TOOL_CATEGORIES[cat];
          const label = catInfo?.label || cat;
          console.log(`\x1b[36m  ${label}\x1b[0m`);

          for (const tool of grouped[cat]) {
            const cliName = toDashCase(tool.name);
            const required = tool.inputSchema.required || [];
            const paramHint = required.length > 0
              ? ` \x1b[33m<${required.map(camelToKebab).join('> <')}>\x1b[0m`
              : '';
            console.log(`    \x1b[32m${cliName}\x1b[0m${paramHint}`);
            console.log(`      ${tool.description}`);
          }
          console.log('');
        }

        console.log('\x1b[90m  Usage:\x1b[0m');
        console.log('    agentstudio admin call <tool-name> [--param value ...]');
        console.log('    agentstudio admin describe <tool-name>');
        console.log('');
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── agentstudio admin describe <tool> ──────────────────────────────────────

  admin
    .command('describe <tool>')
    .description('Show detailed schema and usage for a specific tool')
    .option('--json', 'Output raw JSON schema')
    .action(async (toolNameRaw: string, opts) => {
      try {
        const parentOpts = admin.opts();
        const client = await createClient(parentOpts);
        const tools = await client.listTools();

        // Normalize: accept both dash-case and snake_case
        const toolName = toSnakeCase(toolNameRaw);
        const tool = tools.find((t) => t.name === toolName);

        if (!tool) {
          outputError(`Tool not found: ${toolNameRaw}`);
          console.error('');
          console.error('Run \x1b[33magistentstudio admin tools\x1b[0m to see available tools.');
          process.exit(1);
        }

        if (opts.json) {
          outputJson(tool);
          return;
        }

        const cliName = toDashCase(tool.name);
        const props = tool.inputSchema.properties || {};
        const required = new Set(tool.inputSchema.required || []);

        console.log('');
        console.log(`\x1b[1m${cliName}\x1b[0m`);
        console.log(`  ${tool.description}`);
        console.log('');

        const paramKeys = Object.keys(props);
        if (paramKeys.length > 0) {
          console.log('\x1b[36m  Parameters:\x1b[0m');

          for (const key of paramKeys) {
            const prop = props[key] as Record<string, unknown>;
            const flagName = camelToKebab(key);
            const isRequired = required.has(key);
            const typeStr = String(prop.type || 'string');
            const desc = String(prop.description || '');
            const reqLabel = isRequired ? ' \x1b[31m(required)\x1b[0m' : '';

            console.log(`    \x1b[32m--${flagName}\x1b[0m <${typeStr}>${reqLabel}`);
            if (desc) {
              console.log(`      ${desc}`);
            }

            // Show enum values if present
            if (prop.enum) {
              console.log(`      Values: ${(prop.enum as string[]).join(', ')}`);
            }

            // Show items type for arrays
            if (prop.items) {
              const items = prop.items as Record<string, unknown>;
              console.log(`      Items: ${items.type || 'any'}`);
            }
          }
        } else {
          console.log('  \x1b[90mNo parameters required.\x1b[0m');
        }

        console.log('');
        console.log('\x1b[36m  Example:\x1b[0m');

        // Build example command
        const exampleParts = [`agentstudio admin call ${cliName}`];
        for (const key of paramKeys) {
          const flagName = camelToKebab(key);
          const prop = props[key] as Record<string, unknown>;
          const typeStr = String(prop.type || 'string');
          if (required.has(key)) {
            const placeholder = typeStr === 'number' ? '1' : typeStr === 'boolean' ? 'true' : `<${flagName}>`;
            exampleParts.push(`--${flagName} ${placeholder}`);
          }
        }
        console.log(`    ${exampleParts.join(' ')}`);

        // Also show JSON variant
        if (paramKeys.length > 0) {
          const jsonExample: Record<string, unknown> = {};
          for (const key of Array.from(required)) {
            const prop = props[key] as Record<string, unknown>;
            const typeStr = String(prop.type || 'string');
            jsonExample[key] = typeStr === 'number' ? 1 : typeStr === 'boolean' ? true : `<${key}>`;
          }
          console.log(`    agentstudio admin call ${cliName} '${JSON.stringify(jsonExample)}'`);
        }

        console.log('');
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── agentstudio admin call <tool> [args...] ────────────────────────────────

  admin
    .command('call <tool> [args...]')
    .description('Call any admin tool with parameters')
    .option('--stdin', 'Read JSON parameters from stdin')
    .allowUnknownOption(true)
    .action(async (toolNameRaw: string, args: string[], opts) => {
      try {
        const parentOpts = admin.opts();
        const client = await createClient(parentOpts);

        const toolName = toSnakeCase(toolNameRaw);
        let params: Record<string, unknown>;

        if (opts.stdin) {
          // Read from stdin
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          const input = Buffer.concat(chunks).toString('utf8').trim();
          params = JSON.parse(input);
        } else {
          params = parseToolArgs(args);
        }

        const result = await client.callTool(toolName, params);

        if (result.isError) {
          const errorText = result.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
          outputError(errorText);
          process.exit(1);
        }

        // Extract text content and try to parse as JSON for pretty output
        for (const content of result.content) {
          if (content.type === 'text' && content.text) {
            try {
              const parsed = JSON.parse(content.text);
              outputJson(parsed);
            } catch {
              console.log(content.text);
            }
          }
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── agentstudio admin ping ─────────────────────────────────────────────────

  admin
    .command('ping')
    .description('Check connectivity to the AgentStudio server')
    .action(async () => {
      try {
        const parentOpts = admin.opts();
        const config = resolveClientConfig(parentOpts);
        const client = new McpAdminClient(config.baseUrl, config.apiKey);

        const ok = await client.ping();

        if (ok) {
          console.log(`\x1b[32m✓\x1b[0m Connected to ${config.baseUrl}`);
        } else {
          console.log(`\x1b[31m✗\x1b[0m Cannot connect to ${config.baseUrl}`);
          process.exit(1);
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ── agentstudio admin batch ────────────────────────────────────────────────

  admin
    .command('batch')
    .description('Execute multiple tool calls from a JSON file or stdin')
    .option('--file <path>', 'JSON file containing an array of {tool, args} objects')
    .option('--parallel', 'Execute calls in parallel (default: sequential)')
    .option('--stop-on-error', 'Stop execution on first error')
    .action(async (opts) => {
      try {
        const parentOpts = admin.opts();
        const client = await createClient(parentOpts);

        let input: string;

        if (opts.file) {
          const fs = await import('fs/promises');
          input = await fs.readFile(opts.file, 'utf8');
        } else {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          input = Buffer.concat(chunks).toString('utf8').trim();
        }

        const calls = JSON.parse(input) as Array<{ tool: string; args?: Record<string, unknown> }>;

        if (!Array.isArray(calls)) {
          outputError('Input must be a JSON array of {tool, args} objects');
          process.exit(1);
        }

        const results: Array<{ tool: string; success: boolean; result?: unknown; error?: string }> = [];

        const executeCall = async (call: { tool: string; args?: Record<string, unknown> }) => {
          const toolName = toSnakeCase(call.tool);
          try {
            const result = await client.callTool(toolName, call.args || {});
            const textContent = result.content
              .filter((c) => c.type === 'text')
              .map((c) => {
                try { return JSON.parse(c.text!); } catch { return c.text; }
              });

            return {
              tool: call.tool,
              success: !result.isError,
              result: textContent.length === 1 ? textContent[0] : textContent,
              ...(result.isError ? { error: String(textContent[0]) } : {}),
            };
          } catch (err) {
            return {
              tool: call.tool,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        };

        if (opts.parallel) {
          const promises = calls.map(executeCall);
          results.push(...await Promise.all(promises));
        } else {
          for (const call of calls) {
            const result = await executeCall(call);
            results.push(result);
            if (opts.stopOnError && !result.success) break;
          }
        }

        outputJson(results);

        const hasErrors = results.some((r) => !r.success);
        if (hasErrors) process.exit(1);
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return admin;
}
