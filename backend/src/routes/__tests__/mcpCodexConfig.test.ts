import { describe, it, expect } from 'vitest';
import { parseCodexTomlMcpConfig } from '../mcp';

describe('parseCodexTomlMcpConfig', () => {
  it('returns empty config when mcp_servers is missing', () => {
    const parsed = parseCodexTomlMcpConfig('model = "gpt-5"\n');
    expect(parsed).toEqual({ mcpServers: {} });
  });

  it('parses stdio servers from Codex config.toml', () => {
    const toml = `
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

[mcp_servers.filesystem.env]
LOG_LEVEL = "debug"
`;

    const parsed = parseCodexTomlMcpConfig(toml);

    expect(parsed.mcpServers.filesystem).toMatchObject({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { LOG_LEVEL: 'debug' },
      source: 'local',
    });
  });

  it('parses http servers and normalizes optional fields', () => {
    const toml = `
[mcp_servers.github]
url = "https://mcp.example.com"
headers = { Authorization = "Bearer abc" }
auto_approve = ["repos/list", "repos/get"]
status = "active"
`;

    const parsed = parseCodexTomlMcpConfig(toml);

    expect(parsed.mcpServers.github).toMatchObject({
      type: 'http',
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer abc' },
      autoApprove: ['repos/list', 'repos/get'],
      status: 'active',
      source: 'local',
    });
  });

  it('returns empty config on malformed TOML', () => {
    const parsed = parseCodexTomlMcpConfig('[mcp_servers.bad\ncommand = "x"');
    expect(parsed).toEqual({ mcpServers: {} });
  });
});
