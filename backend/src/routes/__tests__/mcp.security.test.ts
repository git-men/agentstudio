/**
 * Security tests for MCP route input validation.
 * Tests validateMcpCommand and validateMcpArgs against injection attacks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../config/sdkConfig.js', () => ({
  getSdkConfigPath: vi.fn(() => '/tmp/test-sdk'),
}));

vi.mock('../../config/engineConfig.js', () => ({
  isCursorEngine: vi.fn(() => false),
  isCodebuddyEngine: vi.fn(() => false),
  isCodexEngine: vi.fn(() => false),
  getEnginePaths: vi.fn(() => ({})),
  getEngineType: vi.fn(() => 'claude'),
}));

import { validateMcpCommand, validateMcpArgs } from '../mcp';

describe('validateMcpCommand', () => {
  describe('valid commands', () => {
    const validCommands = [
      'node',
      'python3',
      'npx',
      '/usr/bin/node',
      '/usr/local/bin/python3',
      'uvx',
      '~/.local/bin/mcp-server',
      'node_modules/.bin/tsx',
      '@scope/package',
      '/opt/homebrew/bin/mcp-server',
    ];

    it.each(validCommands)('should accept: %s', (cmd) => {
      expect(validateMcpCommand(cmd)).toBe(true);
    });
  });

  describe('malicious commands', () => {
    const maliciousCommands = [
      'node; rm -rf /',
      'python3 && curl evil.com',
      'cmd | cat /etc/passwd',
      '$(whoami)',
      '`id`',
      'node\nnew-command',
      'command with spaces',
      '../../etc/passwd',
      '../../../bin/sh',
      'node>output.txt',
      'cmd<input.txt',
      'echo $HOME',
      'rm -rf /',
    ];

    it.each(maliciousCommands)('should reject: %s', (cmd) => {
      expect(validateMcpCommand(cmd)).toBe(false);
    });
  });

  it('should reject path traversal', () => {
    expect(validateMcpCommand('bin/../etc/passwd')).toBe(false);
    expect(validateMcpCommand('../../../bin/sh')).toBe(false);
  });
});

describe('validateMcpArgs', () => {
  describe('valid args', () => {
    it('should accept normal args', () => {
      expect(validateMcpArgs(['--port', '3000'])).toBe(true);
      expect(validateMcpArgs(['-v', '--config', '/path/to/config.json'])).toBe(true);
      expect(validateMcpArgs(['run', 'server'])).toBe(true);
      expect(validateMcpArgs([])).toBe(true);
    });

    it('should accept file paths', () => {
      expect(validateMcpArgs(['/usr/local/bin/script', './config.yml'])).toBe(true);
    });
  });

  describe('malicious args', () => {
    it('should reject backtick injection', () => {
      expect(validateMcpArgs(['`whoami`'])).toBe(false);
      expect(validateMcpArgs(['--name', '`id`'])).toBe(false);
    });

    it('should reject $() substitution', () => {
      expect(validateMcpArgs(['$(cat /etc/passwd)'])).toBe(false);
      expect(validateMcpArgs(['--output', '$(rm -rf /)'])).toBe(false);
    });

    it('should reject pipe operators', () => {
      expect(validateMcpArgs(['--flag', 'value | cat /etc/passwd'])).toBe(false);
    });

    it('should reject semicolons (command chaining)', () => {
      expect(validateMcpArgs(['--flag', 'value; rm -rf /'])).toBe(false);
    });

    it('should reject & (background execution)', () => {
      expect(validateMcpArgs(['--flag', 'value & malicious'])).toBe(false);
    });

    it('should reject redirects', () => {
      expect(validateMcpArgs(['> /etc/passwd'])).toBe(false);
      expect(validateMcpArgs(['< /etc/shadow'])).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(validateMcpArgs([123 as any])).toBe(false);
      expect(validateMcpArgs([null as any])).toBe(false);
      expect(validateMcpArgs([{} as any])).toBe(false);
    });
  });
});

describe('MCP route integration - input validation', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();

    vi.doMock('../../config/paths.js', () => ({
      MCP_SERVER_CONFIG_FILE: '/tmp/test-mcp-config.json',
      CLAUDE_AGENT_DIR: '/tmp/test-agent-dir',
    }));

    const mcpModule = await import('../mcp');
    const router = mcpModule.default;

    app = express();
    app.use(express.json());
    app.use('/api/mcp', router);
  });

  describe('POST /api/mcp - add MCP config', () => {
    it('should reject command with shell metacharacters', async () => {
      const res = await request(app)
        .post('/api/mcp')
        .send({
          name: 'malicious-server',
          type: 'stdio',
          command: 'node; rm -rf /',
          args: ['--port', '3000'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid command');
    });

    it('should reject args with injection characters', async () => {
      const res = await request(app)
        .post('/api/mcp')
        .send({
          name: 'malicious-server',
          type: 'stdio',
          command: 'node',
          args: ['--eval', '`rm -rf /`'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid args');
    });

    it('should reject command with path traversal', async () => {
      const res = await request(app)
        .post('/api/mcp')
        .send({
          name: 'traversal-server',
          type: 'stdio',
          command: '../../etc/passwd',
          args: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid command');
    });
  });

  describe('PUT /api/mcp/:name - update MCP config', () => {
    it('should reject command with shell metacharacters', async () => {
      const res = await request(app)
        .put('/api/mcp/test-server')
        .send({
          type: 'stdio',
          command: '$(whoami)',
          args: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid command');
    });

    it('should reject args with $() substitution', async () => {
      const res = await request(app)
        .put('/api/mcp/test-server')
        .send({
          type: 'stdio',
          command: 'node',
          args: ['$(cat /etc/passwd)'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid args');
    });
  });
});
