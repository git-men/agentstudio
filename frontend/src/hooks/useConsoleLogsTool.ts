/**
 * useConsoleLogsTool
 *
 * Registers a `collect_console_logs` frontend tool via `useFrontendTool`.
 * When the AI calls the tool, NO UI is rendered in the chat — instead a
 * hidden component runs a useEffect that reads the in-memory console buffer
 * and immediately submits the result back to the agent.
 *
 * Tool arguments (sent by the AI):
 *   - limit  {number}  — Max number of recent log entries to return (default 50)
 *   - levels {string[]} — Filter by level: 'log' | 'warn' | 'error' | 'info' | 'debug'
 *                         If omitted, all levels are returned.
 */

import React, { useEffect } from 'react';
import { useFrontendTool } from './useFrontendTool.js';
import { getCapturedLogs, type LogLevel } from '../utils/consoleCapture.js';

// ─── Silent executor component ────────────────────────────────────────────────

interface CollectLogsProps {
  limit: number;
  levels: LogLevel[] | null;
  onSubmit: (result: unknown) => void;
}

function CollectLogs({ limit, levels, onSubmit }: CollectLogsProps) {
  useEffect(() => {
    const allLogs = getCapturedLogs(limit);
    const filtered = levels
      ? allLogs.filter(e => levels.includes(e.level))
      : allLogs;

    onSubmit({
      count: filtered.length,
      logs: filtered,
      capturedAt: new Date().toISOString(),
    });
    // Run once on mount — no deps needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null; // no visible UI in the chat
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useConsoleLogsTool(): void {
  useFrontendTool({
    name: 'collect_console_logs',
    description:
      '收集浏览器最近的 console 日志（log / warn / error / info / debug）并返回给 AI。' +
      '调用此工具不会在界面上显示任何 UI，结果将直接作为工具返回值发送给 AI。',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: '最多返回多少条最新的日志，默认 50，最大 200',
        },
        levels: {
          type: 'array',
          description: '过滤日志级别，如 ["error","warn"]。不传则返回所有级别',
          items: { type: 'string', enum: ['log', 'warn', 'error', 'info', 'debug'] },
        },
      },
    },
    render: ({ args, onSubmit }) => {
      const limit = typeof args.limit === 'number' ? Math.min(args.limit, 200) : 50;
      const levels =
        Array.isArray(args.levels) && args.levels.length > 0
          ? (args.levels as LogLevel[])
          : null;

      return React.createElement(CollectLogs, { limit, levels, onSubmit });
    },
  });
}
