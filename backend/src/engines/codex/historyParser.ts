/**
 * Codex History Parser
 *
 * Reads Codex local sessions from ~/.codex/sessions/**.jsonl and converts
 * them to the unified SessionDetail format used by AgentStudio.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SessionDetail, SessionMessage } from '../types.js';

interface CodexHistoryLine {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

interface ParsedCodexSession {
  id: string;
  cwd: string;
  createdAt: string;
  lastUpdated: string;
  messages: SessionMessage[];
}

function normalizePath(input: string): string {
  try {
    return fs.realpathSync(input);
  } catch {
    return path.resolve(input);
  }
}

function listJsonlFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonlFilesRecursively(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractTextParts(content: unknown): Array<{ type: 'text' | 'thinking'; text: string }> {
  if (typeof content === 'string' && content.trim()) {
    return [{ type: 'text', text: content }];
  }

  if (!Array.isArray(content)) return [];

  const parts: Array<{ type: 'text' | 'thinking'; text: string }> = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    const blockType = typeof block.type === 'string' ? block.type : '';
    const text = typeof block.text === 'string'
      ? block.text
      : typeof block.content === 'string'
        ? block.content
        : null;

    if (!text || !text.trim()) continue;

    if (blockType.includes('reasoning')) {
      parts.push({ type: 'thinking', text });
    } else {
      parts.push({ type: 'text', text });
    }
  }

  return parts;
}

function toSessionMessage(
  sessionId: string,
  index: number,
  timestamp: string,
  role: 'user' | 'assistant',
  parts: Array<{ type: 'text' | 'thinking'; text: string }>
): SessionMessage {
  const messageParts = parts.map((part, partIndex) => ({
    id: `part_${sessionId}_${index}_${partIndex}`,
    type: part.type,
    content: part.text,
    order: partIndex,
  }));
  const mergedText = parts.map(part => part.text).join('');

  return {
    type: role,
    uuid: `msg_${sessionId}_${index}`,
    timestamp,
    sessionId,
    message: {
      role,
      content: mergedText,
    },
    messageParts,
  };
}

const SYSTEM_INJECTED_PREFIXES = [
  '# AGENTS.md instructions for ',
  '<environment_context>',
  '<INSTRUCTIONS>',
  '<permissions instructions>',
];

function isSystemInjectedMessage(parts: Array<{ type: 'text' | 'thinking'; text: string }>): boolean {
  const merged = parts.map(p => p.text).join('').trimStart();
  return SYSTEM_INJECTED_PREFIXES.some(prefix => merged.startsWith(prefix));
}

function parseCodexSessionFile(filePath: string): ParsedCodexSession | null {
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = raw.split('\n').filter(line => line.trim().length > 0);
  if (lines.length === 0) return null;

  let sessionId: string | null = null;
  let cwd: string | null = null;
  let createdAt: string | null = null;
  let lastUpdated: string | null = null;
  const messages: SessionMessage[] = [];

  for (let i = 0; i < lines.length; i++) {
    let parsed: CodexHistoryLine | null = null;
    try {
      parsed = JSON.parse(lines[i]) as CodexHistoryLine;
    } catch {
      continue;
    }
    if (!parsed) continue;

    const lineTs = parsed.timestamp || new Date().toISOString();
    if (!createdAt || lineTs < createdAt) createdAt = lineTs;
    if (!lastUpdated || lineTs > lastUpdated) lastUpdated = lineTs;

    if (parsed.type === 'session_meta') {
      const payload = parsed.payload || {};
      sessionId = typeof payload.id === 'string' ? payload.id : sessionId;
      cwd = typeof payload.cwd === 'string' ? payload.cwd : cwd;
      continue;
    }

    if (parsed.type !== 'response_item') continue;

    const payload = parsed.payload || {};
    const payloadType = typeof payload.type === 'string' ? payload.type : '';
    const role = typeof payload.role === 'string' ? payload.role : '';
    if (payloadType !== 'message') continue;
    if (role !== 'user' && role !== 'assistant') continue;

    const parts = extractTextParts(payload.content);
    if (parts.length === 0) continue;

    if (role === 'user' && isSystemInjectedMessage(parts)) continue;

    const effectiveSessionId = sessionId || 'unknown';
    messages.push(
      toSessionMessage(
        effectiveSessionId,
        messages.length,
        lineTs,
        role,
        parts
      )
    );
  }

  if (!sessionId || !cwd) return null;

  return {
    id: sessionId,
    cwd,
    createdAt: createdAt || new Date().toISOString(),
    lastUpdated: lastUpdated || new Date().toISOString(),
    messages,
  };
}

function sessionTitle(sessionId: string, messages: SessionMessage[]): string {
  const firstUser = messages.find(msg => msg.type === 'user');
  const text = typeof firstUser?.message?.content === 'string'
    ? firstUser.message.content
    : '';
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return `Session ${sessionId.slice(0, 8)}`;
  return compact.length > 60 ? `${compact.slice(0, 60)}...` : compact;
}

function convertToSessionDetail(parsed: ParsedCodexSession): SessionDetail {
  return {
    id: parsed.id,
    title: sessionTitle(parsed.id, parsed.messages),
    createdAt: parsed.createdAt,
    lastUpdated: parsed.lastUpdated,
    messages: parsed.messages,
  };
}

function getCodexSessionsDir(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

export async function readCodexHistorySessions(projectPath: string): Promise<SessionDetail[]> {
  const targetPath = normalizePath(projectPath);
  const files = listJsonlFilesRecursively(getCodexSessionsDir());

  const sessions: SessionDetail[] = [];
  for (const filePath of files) {
    const parsed = parseCodexSessionFile(filePath);
    if (!parsed) continue;
    if (normalizePath(parsed.cwd) !== targetPath) continue;
    sessions.push(convertToSessionDetail(parsed));
  }

  sessions.sort((a, b) => {
    const ta = new Date(a.lastUpdated).getTime();
    const tb = new Date(b.lastUpdated).getTime();
    return tb - ta;
  });
  return sessions;
}

export async function readCodexHistorySession(projectPath: string, sessionId: string): Promise<SessionDetail | null> {
  const targetPath = normalizePath(projectPath);
  const normalizedSessionId = sessionId.startsWith('codex-') ? sessionId.slice(6) : sessionId;
  const files = listJsonlFilesRecursively(getCodexSessionsDir());
  const prioritizedFiles = [
    ...files.filter(filePath => filePath.includes(normalizedSessionId)),
    ...files.filter(filePath => !filePath.includes(normalizedSessionId)),
  ];

  for (const filePath of prioritizedFiles) {
    const parsed = parseCodexSessionFile(filePath);
    if (!parsed) continue;
    if (parsed.id !== normalizedSessionId) continue;
    if (normalizePath(parsed.cwd) !== targetPath) continue;
    return convertToSessionDetail(parsed);
  }

  return null;
}
