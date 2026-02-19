import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCodexHistorySession, readCodexHistorySessions } from '../historyParser.js';

function writeJsonl(filePath: string, rows: Array<Record<string, unknown>>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

describe('codex historyParser', () => {
  const originalHome = process.env.HOME;
  let testHome: string;
  let projectA: string;
  let projectB: string;

  beforeEach(() => {
    testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-test-'));
    process.env.HOME = testHome;

    projectA = path.join(testHome, 'workspace-a');
    projectB = path.join(testHome, 'workspace-b');
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });

    const sessionsDir = path.join(testHome, '.codex', 'sessions', '2026', '02', '18');

    writeJsonl(path.join(sessionsDir, 'session-a.jsonl'), [
      {
        timestamp: '2026-02-18T10:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'session-a',
          cwd: projectA,
        },
      },
      {
        timestamp: '2026-02-18T10:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'text', text: '  hello   codex world  ' }],
        },
      },
      {
        timestamp: '2026-02-18T10:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'thinking here' },
            { type: 'text', text: 'final answer' },
          ],
        },
      },
    ]);

    writeJsonl(path.join(sessionsDir, 'session-b.jsonl'), [
      {
        timestamp: '2026-02-18T11:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'session-b',
          cwd: projectB,
        },
      },
      {
        timestamp: '2026-02-18T11:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'text', text: 'other project' }],
        },
      },
    ]);
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    fs.rmSync(testHome, { recursive: true, force: true });
  });

  it('reads sessions for the requested project only', async () => {
    const sessions = await readCodexHistorySessions(projectA);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('session-a');
    expect(sessions[0].title).toBe('hello codex world');
    expect(sessions[0].messages).toHaveLength(2);
    expect(sessions[0].messages[0].type).toBe('user');
    expect(sessions[0].messages[1].type).toBe('assistant');
    expect(sessions[0].messages[1].messageParts?.map((p: any) => p.type)).toEqual(['thinking', 'text']);
  });

  it('reads a single session and supports codex- prefix', async () => {
    const session = await readCodexHistorySession(projectA, 'codex-session-a');

    expect(session).not.toBeNull();
    expect(session?.id).toBe('session-a');
    expect(session?.messages).toHaveLength(2);
  });

  it('returns null when session is missing', async () => {
    const session = await readCodexHistorySession(projectA, 'non-existent-session');
    expect(session).toBeNull();
  });
});
