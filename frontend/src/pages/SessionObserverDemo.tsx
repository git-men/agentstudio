/**
 * Session Observer Demo Page
 * 
 * A standalone demo page for testing the inject + observe flow.
 * Provides:
 * - Observe SSE connection (watch a session in real-time)
 * - Inject form (simulate Facilitator Agent sending requirements)
 * - Real-time event display (both user messages and AI responses)
 * 
 * Access via: /demo/observe
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Eye,
  Send,
  Wifi,
  WifiOff,
  Trash2,
  Play,
  Square,
  MessageSquare,
  Bot,
  Wrench,
  AlertCircle,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';

interface EventLogEntry {
  id: number;
  timestamp: string;
  eventType: string;
  data: any;
  direction: 'in' | 'out'; // in = from observe, out = injected
}

const SessionObserverDemo: React.FC = () => {
  // Connection state
  const [sessionId, setSessionId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Inject state
  const [injectMessage, setInjectMessage] = useState('');
  const [isInjecting, setIsInjecting] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const [engineType, setEngineType] = useState('cursor');

  // Event log
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const eventIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const addEvent = useCallback((eventType: string, data: any, direction: 'in' | 'out') => {
    const entry: EventLogEntry = {
      id: eventIdRef.current++,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false, fractionalSecondDigits: 3 }),
      eventType,
      data,
      direction,
    };
    setEvents(prev => [...prev, entry]);
  }, []);

  // ===========================================================================
  // Observe Connection
  // ===========================================================================

  const connect = useCallback(() => {
    if (!sessionId.trim()) return;

    setIsConnecting(true);

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `${API_BASE}/api/agui/sessions/${encodeURIComponent(sessionId)}/observe?clientId=demo-observer`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    // Connected event
    es.addEventListener('connected', (e) => {
      setIsConnected(true);
      setIsConnecting(false);
      try {
        addEvent('connected', JSON.parse(e.data), 'in');
      } catch { /* */ }
    });

    // User message events
    es.addEventListener('USER_MESSAGE', (e) => {
      try {
        addEvent('USER_MESSAGE', JSON.parse(e.data), 'in');
      } catch { /* */ }
    });

    // AGUI events
    const eventTypes = [
      'RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR',
      'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END',
      'THINKING_START', 'THINKING_CONTENT', 'THINKING_END',
      'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT',
      'RAW', 'CUSTOM',
    ];

    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (e) => {
        try {
          addEvent(eventType, JSON.parse(e.data), 'in');
        } catch { /* */ }
      });
    }

    es.onerror = () => {
      setIsConnected(false);
      setIsConnecting(false);
      addEvent('connection_error', { message: 'Connection lost' }, 'in');
    };
  }, [sessionId, addEvent]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    addEvent('disconnected', { message: 'Disconnected by user' }, 'in');
  }, [addEvent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // ===========================================================================
  // Inject
  // ===========================================================================

  const handleInject = async () => {
    if (!injectMessage.trim() || !sessionId.trim() || !workspace.trim()) return;

    setIsInjecting(true);
    addEvent('inject_request', { message: injectMessage, sender: 'demo-facilitator' }, 'out');

    try {
      const response = await authFetch(
        `${API_BASE}/api/agui/sessions/${encodeURIComponent(sessionId)}/inject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: injectMessage.trim(),
            sender: 'demo-facilitator',
            engineType,
            workspace: workspace.trim(),
          }),
        }
      );

      const result = await response.json();
      addEvent('inject_response', result, 'out');
      
      if (response.ok) {
        setInjectMessage('');
      }
    } catch (error: any) {
      addEvent('inject_error', { error: error.message }, 'out');
    } finally {
      setIsInjecting(false);
    }
  };

  // ===========================================================================
  // Event rendering
  // ===========================================================================

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'USER_MESSAGE':
      case 'inject_request':
        return <MessageSquare className="w-3.5 h-3.5" />;
      case 'TEXT_MESSAGE_CONTENT':
      case 'TEXT_MESSAGE_START':
      case 'TEXT_MESSAGE_END':
        return <Bot className="w-3.5 h-3.5" />;
      case 'TOOL_CALL_START':
      case 'TOOL_CALL_ARGS':
      case 'TOOL_CALL_END':
      case 'TOOL_CALL_RESULT':
        return <Wrench className="w-3.5 h-3.5" />;
      case 'RUN_ERROR':
      case 'inject_error':
      case 'connection_error':
        return <AlertCircle className="w-3.5 h-3.5" />;
      case 'RUN_FINISHED':
      case 'connected':
      case 'inject_response':
        return <CheckCircle className="w-3.5 h-3.5" />;
      default:
        return <Eye className="w-3.5 h-3.5" />;
    }
  };

  const getEventColor = (entry: EventLogEntry) => {
    if (entry.direction === 'out') return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20';
    switch (entry.eventType) {
      case 'USER_MESSAGE': return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
      case 'TEXT_MESSAGE_CONTENT': return 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20';
      case 'RUN_ERROR':
      case 'connection_error': return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
      case 'TOOL_CALL_START':
      case 'TOOL_CALL_RESULT': return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20';
      case 'connected':
      case 'RUN_FINISHED': return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20';
      default: return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20';
    }
  };

  const getEventSummary = (entry: EventLogEntry): string => {
    const d = entry.data;
    switch (entry.eventType) {
      case 'USER_MESSAGE': return `[${d.sender}] ${d.content?.substring(0, 100)}`;
      case 'TEXT_MESSAGE_CONTENT': return d.content?.substring(0, 120) || '';
      case 'TOOL_CALL_START': return `Tool: ${d.toolName}`;
      case 'TOOL_CALL_RESULT': return `Result: ${(d.result || '').substring(0, 80)}`;
      case 'RUN_ERROR': return d.error || 'Unknown error';
      case 'inject_request': return d.message?.substring(0, 100) || '';
      case 'inject_response': return `Success: ${d.eventsCount} events`;
      case 'inject_error': return d.error || 'Unknown error';
      case 'connected': return `Session: ${d.sessionId}`;
      default: return JSON.stringify(d).substring(0, 100);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Eye className="w-7 h-7 text-purple-600" />
            Session Observer Demo
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            测试 inject（注入消息）+ observe（观战）的完整流程
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Connection & Inject */}
          <div className="space-y-4">
            {/* Connection Panel */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                {isConnected ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-gray-400" />}
                观战连接
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Session ID</label>
                  <input
                    type="text"
                    value={sessionId}
                    onChange={(e) => setSessionId(e.target.value)}
                    placeholder="输入 AGUI session ID"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    disabled={isConnected}
                  />
                </div>

                <div className="flex gap-2">
                  {!isConnected ? (
                    <button
                      onClick={connect}
                      disabled={!sessionId.trim() || isConnecting}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm rounded-lg"
                    >
                      {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      连接观战
                    </button>
                  ) : (
                    <button
                      onClick={disconnect}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg"
                    >
                      <Square className="w-4 h-4" />
                      断开
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Inject Panel */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <Send className="w-4 h-4 text-blue-500" />
                注入消息（模拟 Facilitator Agent）
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Workspace 路径</label>
                  <input
                    type="text"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    placeholder="/path/to/project"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">引擎类型</label>
                  <select
                    value={engineType}
                    onChange={(e) => setEngineType(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="cursor">Cursor</option>
                    <option value="claude">Claude</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">注入消息</label>
                  <textarea
                    value={injectMessage}
                    onChange={(e) => setInjectMessage(e.target.value)}
                    placeholder="输入要注入的消息..."
                    rows={4}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                  />
                </div>

                <button
                  onClick={handleInject}
                  disabled={isInjecting || !injectMessage.trim() || !sessionId.trim() || !workspace.trim()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm rounded-lg"
                >
                  {isInjecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  注入消息
                </button>
              </div>
            </div>
          </div>

          {/* Right: Event Log */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm flex flex-col" style={{ height: 'calc(100vh - 160px)' }}>
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Eye className="w-4 h-4 text-purple-500" />
                  实时事件流
                  <span className="text-xs text-gray-400 font-normal">({events.length} events)</span>
                </h2>
                <button
                  onClick={() => setEvents([])}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  清空
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs">
                {events.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400">
                    <div className="text-center">
                      <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>等待事件...</p>
                      <p className="text-xs mt-1">连接观战后，事件会实时显示在这里</p>
                    </div>
                  </div>
                ) : (
                  events.map((entry) => (
                    <div
                      key={entry.id}
                      className={`flex items-start gap-2 px-2 py-1.5 rounded ${getEventColor(entry)}`}
                    >
                      <span className="flex-shrink-0 mt-0.5">{getEventIcon(entry.eventType)}</span>
                      <span className="text-gray-400 flex-shrink-0">{entry.timestamp}</span>
                      <span className="font-semibold flex-shrink-0 w-40 truncate">
                        {entry.direction === 'out' ? '→ ' : '← '}
                        {entry.eventType}
                      </span>
                      <span className="truncate opacity-80">{getEventSummary(entry)}</span>
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SessionObserverDemo;
