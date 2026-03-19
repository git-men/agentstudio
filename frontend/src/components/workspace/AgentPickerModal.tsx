import React, { useState, useMemo } from 'react';
import { X, Search, Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgents } from '../../hooks/useAgents';
import type { AgentConfig } from '../../types/index.js';

interface AgentPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (agent: AgentConfig) => void;
}

export const AgentPickerModal: React.FC<AgentPickerModalProps> = ({
  open,
  onClose,
  onSelect,
}) => {
  const { t } = useTranslation('components');
  const { data: agentsData, isLoading } = useAgents(true);
  const [search, setSearch] = useState('');

  const filteredAgents = useMemo(() => {
    const agents = agentsData?.agents ?? [];
    if (!search.trim()) return agents;
    const term = search.toLowerCase();
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(term) ||
        a.id.toLowerCase().includes(term),
    );
  }, [agentsData, search]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('workspace.selectAgent', 'Select Agent')}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('workspace.searchAgents', 'Search agents…')}
              className="w-full pl-10 pr-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
              {t('workspace.noAgentsFound', 'No agents found')}
            </div>
          ) : (
            filteredAgents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelect(agent)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="w-9 h-9 flex items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex-shrink-0">
                  {agent.icon ? (
                    <span className="text-lg">{agent.icon}</span>
                  ) : (
                    <Bot className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {agent.name}
                  </div>
                  {agent.description && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {agent.description}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
