/**
 * Integration tests for Admin CLI
 *
 * These tests call the real AgentStudio backend (must be running on localhost:4936).
 * Skip with: SKIP_INTEGRATION=true pnpm test
 *
 * Requires:
 *   - AgentStudio backend running on http://127.0.0.1:4936
 *   - AGENTSTUDIO_ADMIN_API_KEY env var set
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const SKIP = process.env.SKIP_INTEGRATION === 'true' || !process.env.AGENTSTUDIO_ADMIN_API_KEY;

const CLI_PATH = path.resolve(__dirname, '../../bin/agentstudio.ts');

function runCli(args: string): { stdout: string; stderr: string; exitCode: number } {
  const env = {
    ...process.env,
    NODE_OPTIONS: '',
  };
  try {
    const stdout = execSync(`npx tsx ${CLI_PATH} ${args}`, {
      encoding: 'utf8',
      timeout: 15000,
      env,
      cwd: path.resolve(__dirname, '../../../'),
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status || 1,
    };
  }
}

describe.skipIf(SKIP)('Admin CLI Integration', () => {
  beforeAll(async () => {
    // Verify server is reachable
    try {
      const res = await fetch('http://127.0.0.1:4936/api/health');
      if (!res.ok) throw new Error('Server not healthy');
    } catch {
      throw new Error(
        'AgentStudio backend must be running on localhost:4936 for integration tests',
      );
    }
  });

  describe('admin ping', () => {
    it('should connect to the server', () => {
      const result = runCli('admin ping');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connected');
    });
  });

  describe('admin tools', () => {
    it('should list tools grouped by category', () => {
      const result = runCli('admin tools');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Admin Tools');
      expect(result.stdout).toContain('Projects');
      expect(result.stdout).toContain('Agents');
      expect(result.stdout).toContain('list-projects');
      expect(result.stdout).toContain('list-agents');
    });

    it('should filter by category', () => {
      const result = runCli('admin tools --category system');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('System');
      expect(result.stdout).toContain('get-system-status');
      // Should not contain other categories
      expect(result.stdout).not.toContain('Projects');
    });

    it('should output JSON with --json flag', () => {
      const result = runCli('admin tools --json');
      expect(result.exitCode).toBe(0);
      const tools = JSON.parse(result.stdout);
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0]).toHaveProperty('name');
      expect(tools[0]).toHaveProperty('description');
      expect(tools[0]).toHaveProperty('inputSchema');
    });
  });

  describe('admin describe', () => {
    it('should show tool schema with kebab-case name', () => {
      const result = runCli('admin describe create-agent');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('create-agent');
      expect(result.stdout).toContain('Parameters');
      expect(result.stdout).toContain('--id');
      expect(result.stdout).toContain('--name');
      expect(result.stdout).toContain('--system-prompt');
      expect(result.stdout).toContain('(required)');
    });

    it('should accept snake_case name too', () => {
      const result = runCli('admin describe list_projects');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('list-projects');
    });

    it('should output JSON schema with --json', () => {
      const result = runCli('admin describe get-agent --json');
      expect(result.exitCode).toBe(0);
      const schema = JSON.parse(result.stdout);
      expect(schema.name).toBe('get_agent');
      expect(schema.inputSchema.required).toContain('agentId');
    });

    it('should error on unknown tool', () => {
      const result = runCli('admin describe nonexistent-tool');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('admin call', () => {
    it('should call list-projects with --limit', () => {
      const result = runCli('admin call list-projects --limit 2');
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty('projects');
      expect(data).toHaveProperty('total');
      expect(data.projects.length).toBeLessThanOrEqual(2);
    });

    it('should call list-agents', () => {
      const result = runCli('admin call list-agents');
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty('agents');
      expect(data).toHaveProperty('total');
      expect(Array.isArray(data.agents)).toBe(true);
    });

    it('should call get-system-status', () => {
      const result = runCli('admin call get-system-status');
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.status).toBe('healthy');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('memory');
    });

    it('should accept JSON argument', () => {
      const result = runCli(`admin call list-projects '{"limit":1}'`);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.projects.length).toBeLessThanOrEqual(1);
    });

    it('should call health-check', () => {
      const result = runCli('admin call health-check');
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty('status');
      expect(data.status).toBe('healthy');
    });

    it('should error on nonexistent tool', () => {
      const result = runCli('admin call nonexistent-tool');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should fail without API key', () => {
      const env = { ...process.env, AGENTSTUDIO_ADMIN_API_KEY: '' };
      try {
        execSync(`npx tsx ${CLI_PATH} admin call list-agents`, {
          encoding: 'utf8',
          timeout: 10000,
          env: { ...env, NODE_OPTIONS: '' },
          cwd: path.resolve(__dirname, '../../../'),
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.status).toBe(1);
        expect(err.stderr || err.stdout).toContain('API key is required');
      }
    });

    it('should fail with bad API key', () => {
      const env = { ...process.env, AGENTSTUDIO_ADMIN_API_KEY: 'bad-key' };
      try {
        execSync(`npx tsx ${CLI_PATH} admin call list-agents`, {
          encoding: 'utf8',
          timeout: 10000,
          env: { ...env, NODE_OPTIONS: '' },
          cwd: path.resolve(__dirname, '../../../'),
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.status).toBe(1);
      }
    });
  });
});
