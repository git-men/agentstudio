/**
 * Models Information Page
 * 
 * Displays all available AI models from all registered engines
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import { Cpu, Eye, Brain, Zap, Users, Activity } from 'lucide-react';

interface ModelInfo {
  id: string;
  name: string;
  isVision: boolean;
  isThinking?: boolean;
  description?: string;
}

interface EngineInfo {
  type: string;
  isDefault: boolean;
  capabilities: {
    features: {
      multiTurn: boolean;
      thinking: boolean;
      vision: boolean;
      streaming: boolean;
      subagents: boolean;
      codeExecution: boolean;
    };
    mcp: {
      supported: boolean;
    };
  };
  models: ModelInfo[];
  activeSessions: number;
}

interface EnginesResponse {
  engines: EngineInfo[];
  defaultEngine: string;
  totalActiveSessions: number;
}

const ModelsPage: React.FC = () => {
  const { data, isLoading, error } = useQuery<EnginesResponse>({
    queryKey: ['engines'],
    queryFn: async () => {
      const response = await authFetch(`${API_BASE}/agui/engines`);
      if (!response.ok) {
        throw new Error('Failed to fetch engines');
      }
      return response.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading models...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center text-red-600 dark:text-red-400">
          <p className="text-xl font-semibold mb-2">Failed to load models</p>
          <p className="text-sm">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Available AI Models
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            All models supported by registered engines
          </p>
        </div>

        {/* Summary Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-center space-x-3">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <Cpu className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Engines</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {data.engines.length}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
                <Zap className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Default Engine</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white capitalize">
                  {data.defaultEngine}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
                <Activity className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Active Sessions</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {data.totalActiveSessions}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Engines Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.engines.map((engine) => (
            <div
              key={engine.type}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden"
            >
              {/* Engine Header */}
              <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Cpu className="w-6 h-6 text-white" />
                    <h2 className="text-xl font-bold text-white capitalize">
                      {engine.type}
                    </h2>
                    {engine.isDefault && (
                      <span className="px-2 py-1 bg-white bg-opacity-20 rounded text-xs font-semibold text-white">
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 text-white">
                    <Users className="w-4 h-4" />
                    <span className="text-sm">{engine.activeSessions}</span>
                  </div>
                </div>
              </div>

              {/* Capabilities */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  Capabilities
                </h3>
                <div className="flex flex-wrap gap-2">
                  {engine.capabilities.features.multiTurn && (
                    <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs rounded-full">
                      Multi-turn
                    </span>
                  )}
                  {engine.capabilities.features.thinking && (
                    <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                      Thinking
                    </span>
                  )}
                  {engine.capabilities.features.vision && (
                    <span className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs rounded-full">
                      Vision
                    </span>
                  )}
                  {engine.capabilities.features.streaming && (
                    <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 text-xs rounded-full">
                      Streaming
                    </span>
                  )}
                  {engine.capabilities.features.subagents && (
                    <span className="px-2 py-1 bg-pink-100 dark:bg-pink-900 text-pink-700 dark:text-pink-300 text-xs rounded-full">
                      Subagents
                    </span>
                  )}
                  {engine.capabilities.mcp.supported && (
                    <span className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs rounded-full">
                      MCP
                    </span>
                  )}
                </div>
              </div>

              {/* Models List */}
              <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  Models ({engine.models.length})
                </h3>
                <div className="space-y-2">
                  {engine.models.map((model) => (
                    <div
                      key={model.id}
                      className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            {model.isVision && (
                              <Eye className="w-4 h-4 text-green-600 dark:text-green-400" />
                            )}
                            {model.isThinking && (
                              <Brain className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                            )}
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {model.name}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-400 font-mono">
                            {model.id}
                          </p>
                          {model.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                              {model.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ModelsPage;
