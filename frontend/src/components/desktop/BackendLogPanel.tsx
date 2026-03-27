import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { BackendLogEntry } from '../../hooks/useBackendLogs';

interface BackendLogPanelProps {
  backendLogs: BackendLogEntry[];
  getFrontendLogs: () => BackendLogEntry[];
  onClearBackend: () => void;
  onClearFrontend: () => void;
  onClose: () => void;
}

type TabType = 'backend' | 'frontend';
type LevelFilter = 'all' | 'stdout' | 'stderr' | 'error' | 'system' | 'log' | 'warn' | 'info';

const LEVEL_COLORS: Record<string, string> = {
  stdout: 'text-gray-300',
  stderr: 'text-yellow-400',
  error: 'text-red-400',
  system: 'text-blue-400',
  log: 'text-gray-300',
  warn: 'text-yellow-400',
  info: 'text-cyan-400',
  debug: 'text-gray-500',
};

export const BackendLogPanel: React.FC<BackendLogPanelProps> = ({
  backendLogs,
  getFrontendLogs,
  onClearBackend,
  onClearFrontend,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('backend');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [frontendLogs, setFrontendLogs] = useState<BackendLogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (activeTab === 'frontend') {
      setFrontendLogs(getFrontendLogs());
      refreshTimerRef.current = setInterval(() => {
        setFrontendLogs(getFrontendLogs());
      }, 1000);
    }
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [activeTab, getFrontendLogs]);

  const logs = activeTab === 'backend' ? backendLogs : frontendLogs;

  const filteredLogs = useMemo(
    () => (levelFilter === 'all' ? logs : logs.filter((l) => l.level === levelFilter)),
    [logs, levelFilter],
  );

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  const handleClear = () => {
    if (activeTab === 'backend') onClearBackend();
    else {
      onClearFrontend();
      setFrontendLogs([]);
    }
  };

  const backendFilters: LevelFilter[] = ['all', 'stdout', 'stderr', 'error', 'system'];
  const frontendFilters: LevelFilter[] = ['all', 'log', 'warn', 'error', 'info'];
  const filters = activeTab === 'backend' ? backendFilters : frontendFilters;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-[#1e1e2e] border-t border-[#313244] shadow-2xl"
         style={{ height: '280px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#181825] border-b border-[#313244] select-none">
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5">
            <button
              onClick={() => { setActiveTab('backend'); setLevelFilter('all'); }}
              className={`px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                activeTab === 'backend' ? 'bg-[#1e1e2e] text-[#cdd6f4]' : 'text-[#6c7086] hover:text-[#a6adc8]'
              }`}
            >
              Backend
            </button>
            <button
              onClick={() => { setActiveTab('frontend'); setLevelFilter('all'); }}
              className={`px-3 py-1 text-xs rounded-t font-medium transition-colors ${
                activeTab === 'frontend' ? 'bg-[#1e1e2e] text-[#cdd6f4]' : 'text-[#6c7086] hover:text-[#a6adc8]'
              }`}
            >
              Frontend
            </button>
          </div>
          <div className="flex gap-1 ml-2">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setLevelFilter(f)}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                  levelFilter === f
                    ? 'bg-[#45475a] text-[#cdd6f4]'
                    : 'text-[#6c7086] hover:text-[#a6adc8]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#6c7086]">{filteredLogs.length} entries</span>
          <button onClick={handleClear} className="text-[10px] text-[#6c7086] hover:text-[#f38ba8] transition-colors px-1">
            Clear
          </button>
          <button onClick={onClose} className="text-[#6c7086] hover:text-[#cdd6f4] transition-colors px-1">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Log content */}
      <div ref={scrollRef} onScroll={handleScroll}
           className="flex-1 overflow-y-auto font-mono text-xs leading-5 px-3 py-1">
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#6c7086] text-xs">
            {activeTab === 'backend' ? 'Waiting for backend logs...' : 'No frontend logs captured'}
          </div>
        ) : (
          filteredLogs.map((entry, i) => (
            <div key={i} className="flex gap-2 hover:bg-[#181825] rounded px-1">
              <span className="text-[#585b70] whitespace-nowrap shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 })}
              </span>
              <span className={`shrink-0 w-12 text-right ${LEVEL_COLORS[entry.level] || 'text-gray-400'}`}>
                {entry.level}
              </span>
              <span className="text-[#cdd6f4] whitespace-pre-wrap break-all">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
