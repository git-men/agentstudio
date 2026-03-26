/**
 * MCP Admin HTTP Client
 *
 * Thin HTTP client that calls the AgentStudio MCP Admin endpoint.
 * Used by the CLI to execute admin operations via JSON-RPC 2.0.
 */

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolCallResult {
  content: Array<{
    type: string;
    text?: string;
  }>;
  isError?: boolean;
}

export class McpAdminClient {
  private baseUrl: string;
  private apiKey: string;
  private requestId = 0;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    };

    const url = `${this.baseUrl}/api/mcp-admin`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Authentication failed (${response.status}). Check your API key.`);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();

    // Handle MCP endpoint that may return multiple JSON-RPC responses (newline-delimited)
    const lines = text.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as JsonRpcResponse;
        if (parsed.id === body.id) {
          return parsed;
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    // If we didn't find a matching response, try parsing the whole text
    return JSON.parse(text) as JsonRpcResponse;
  }

  async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'agentstudio-cli',
        version: '1.0.0',
      },
    });
  }

  /**
   * Fetch all tool definitions from the server
   */
  async listTools(): Promise<McpTool[]> {
    const response = await this.sendRequest('tools/list');

    if (response.error) {
      throw new Error(`Failed to list tools: ${response.error.message}`);
    }

    const result = response.result as { tools: McpTool[] };
    return result.tools;
  }

  /**
   * Call a tool by name with arguments
   */
  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
    const response = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    });

    if (response.error) {
      throw new Error(
        response.error.data
          ? `${response.error.message}: ${response.error.data}`
          : response.error.message
      );
    }

    return response.result as McpToolCallResult;
  }

  /**
   * Health check - verify the server is reachable and authenticated
   */
  async ping(): Promise<boolean> {
    try {
      const response = await this.sendRequest('ping');
      return !response.error;
    } catch {
      return false;
    }
  }
}

/**
 * Resolve the MCP Admin client configuration from CLI options and environment.
 */
export function resolveClientConfig(options: {
  server?: string;
  apiKey?: string;
}): { baseUrl: string; apiKey: string } {
  const baseUrl = options.server
    || process.env.AGENTSTUDIO_SERVER
    || 'http://127.0.0.1:4936';

  const apiKey = options.apiKey
    || process.env.AGENTSTUDIO_ADMIN_API_KEY
    || '';

  if (!apiKey) {
    throw new Error(
      'Admin API key is required.\n' +
      'Set it via --api-key flag or AGENTSTUDIO_ADMIN_API_KEY environment variable.\n' +
      'Generate one at: http://localhost:4936/settings/mcp-admin'
    );
  }

  return { baseUrl, apiKey };
}
