import React, { useState, useEffect } from 'react';
import { Save, X } from 'lucide-react';
import { useCreateAgent, useUpdateAgent } from '../hooks/useAgents';
import { useQueryClient } from '@tanstack/react-query';
import { UnifiedToolSelector } from './UnifiedToolSelector';
import { SystemPromptEditor } from './SystemPromptEditor';
import type { AgentConfig, AgentTool } from '../types/index.js';

const BUILTIN_AGENT_IDS = ['claude-code', 'meta-agent'];
const isBuiltinAgent = (agent: AgentConfig) => BUILTIN_AGENT_IDS.includes(agent.id);
const isReadonlyAgent = (agent: AgentConfig) => isBuiltinAgent(agent) || agent.source === 'plugin';

interface AgentEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Agent to edit — null means create mode */
  agent?: AgentConfig | null;
  /** All agents list, used to find the general-chat template for defaults */
  agents: AgentConfig[];
}

export const AgentEditModal: React.FC<AgentEditModalProps> = ({
  isOpen,
  onClose,
  agent,
  agents,
}) => {
  const queryClient = useQueryClient();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();

  const isCreating = !agent;
  const readonly = agent ? isReadonlyAgent(agent) : false;

  const [editForm, setEditForm] = useState<Partial<AgentConfig>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showToolSelector, setShowToolSelector] = useState(false);
  const [selectedRegularTools, setSelectedRegularTools] = useState<string[]>([]);
  const [selectedMcpTools, setSelectedMcpTools] = useState<string[]>([]);
  const [mcpToolsEnabled, setMcpToolsEnabled] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    if (agent) {
      setEditForm(agent);
      const allEnabled = agent.allowedTools?.filter((t: AgentTool) => t.enabled).map((t: AgentTool) => t.name) || [];
      setSelectedRegularTools(allEnabled.filter((t: string) => !t.startsWith('mcp__')));
      const mcp = allEnabled.filter((t: string) => t.startsWith('mcp__'));
      setSelectedMcpTools(mcp);
      setMcpToolsEnabled(mcp.length > 0);
    } else {
      const tpl = agents.find(a => a.id === 'general-chat');
      const defaultAgent: Partial<AgentConfig> = {
        id: `agent-${Date.now()}`,
        name: '',
        description: '',
        version: '1.0.0',
        systemPrompt: tpl?.systemPrompt || `You are a general-purpose AI assistant. You can help with:
- General questions and conversations
- Problem-solving and brainstorming
- Information and explanations
- Creative tasks and writing
- Analysis and research
- File operations when needed

You are helpful, harmless, and honest. Always strive to provide accurate and useful information.
Please respond in Chinese unless the user specifically requests another language.`,
        maxTurns: tpl?.maxTurns || undefined,
        permissionMode: tpl?.permissionMode || 'bypassPermissions',
        allowedTools: tpl?.allowedTools || [
          { name: 'Write', enabled: true },
          { name: 'Read', enabled: true },
          { name: 'Edit', enabled: true },
          { name: 'Glob', enabled: true },
          { name: 'MultiEdit', enabled: true },
          { name: 'Bash', enabled: true },
          { name: 'Task', enabled: true },
          { name: 'WebFetch', enabled: true },
          { name: 'WebSearch', enabled: true },
        ],
        ui: { icon: '🤖', headerTitle: '', headerDescription: '' },
        author: 'User',
        tags: ['custom'],
        enabled: true,
      };
      setEditForm(defaultAgent);
      const regularTools = defaultAgent.allowedTools?.filter((t: AgentTool) => t.enabled).map((t: AgentTool) => t.name) || [];
      setSelectedRegularTools(regularTools);
      setSelectedMcpTools([]);
      setMcpToolsEnabled(false);
    }
    setSaveError(null);
  }, [isOpen, agent, agents]);

  const handleSave = async () => {
    if (!editForm.name?.trim()) {
      setSaveError('请输入名称');
      return;
    }
    if (editForm.maxTurns !== undefined && (editForm.maxTurns < 1 || editForm.maxTurns > 100)) {
      setSaveError('最大轮次必须在 1–100 之间');
      return;
    }
    setSaveError(null);

    const allSelectedTools = [...selectedRegularTools];
    if (mcpToolsEnabled) allSelectedTools.push(...selectedMcpTools);
    const allowedTools: AgentTool[] = allSelectedTools.map(name => ({ name, enabled: true }));

    try {
      if (isCreating) {
        if (!editForm.id?.trim()) { setSaveError('请输入 Agent ID'); return; }
        if (!/^[a-zA-Z0-9_-]+$/.test(editForm.id)) { setSaveError('ID 只能包含字母、数字、连字符和下划线'); return; }

        await createAgent.mutateAsync({
          ...editForm,
          allowedTools,
          maxTurns: editForm.maxTurns,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ui: {
            ...editForm.ui,
            headerTitle: editForm.ui?.headerTitle || editForm.name,
            headerDescription: editForm.ui?.headerDescription || editForm.description,
          },
        } as any);
      } else {
        if (!agent) return;
        await updateAgent.mutateAsync({
          agentId: agent.id,
          data: {
            ...editForm,
            allowedTools,
            maxTurns: editForm.maxTurns !== undefined ? editForm.maxTurns : null,
            enabled: agent.enabled,
          } as any,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      onClose();
    } catch (error: any) {
      let msg = isCreating ? '创建失败' : '保存失败';
      if (error?.response?.data?.details?.issues?.length > 0) {
        msg = error.response.data.details.issues[0].message || msg;
      } else if (error?.response?.data?.error) {
        msg = error.response.data.error;
      } else if (error?.message) {
        msg = error.message;
      }
      setSaveError(msg);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              {isCreating ? '创建助手' : readonly ? `查看助手：${agent?.name}` : `编辑助手：${agent?.name}`}
            </h1>
            {readonly && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                只读
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {!readonly && (
              <button
                onClick={handleSave}
                disabled={updateAgent.isPending || createAgent.isPending}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>保存</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="flex items-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <X className="w-4 h-4" />
              <span>{readonly ? '关闭' : '取消'}</span>
            </button>
          </div>
        </div>

        {/* Error */}
        {saveError && (
          <div className="p-4 bg-red-50 dark:bg-red-900/50 border-b border-red-200 dark:border-red-800">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-800 dark:text-red-200">{saveError}</p>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ID</label>
                  <input
                    type="text"
                    value={editForm.id || ''}
                    onChange={(e) => setEditForm({ ...editForm, id: e.target.value })}
                    disabled={!isCreating}
                    placeholder={isCreating ? '例如: my-custom-agent' : 'ID 在编辑模式下不可修改'}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${
                      !isCreating ? 'bg-gray-100 border-gray-300 text-gray-500 cursor-not-allowed' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {isCreating && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      ID 用于唯一标识这个助手，只能包含字母、数字和连字符
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">名称</label>
                  <input
                    type="text"
                    value={editForm.name || ''}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">描述</label>
                  <textarea
                    value={editForm.description || ''}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>

              {/* Advanced Settings */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">最大轮次</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={editForm.maxTurns !== undefined ? editForm.maxTurns : ''}
                    placeholder="不限制"
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') setEditForm({ ...editForm, maxTurns: undefined });
                      else { const n = parseInt(v); if (!isNaN(n)) setEditForm({ ...editForm, maxTurns: n }); }
                    }}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${
                      editForm.maxTurns !== undefined && (editForm.maxTurns < 1 || editForm.maxTurns > 100)
                        ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
                    }`}
                  />
                  {editForm.maxTurns !== undefined && (editForm.maxTurns < 1 || editForm.maxTurns > 100) && (
                    <p className="text-red-500 dark:text-red-400 text-sm mt-1">最大轮次必须在1-100之间</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">权限模式</label>
                  <select
                    value={editForm.permissionMode || 'default'}
                    onChange={(e) => setEditForm({ ...editForm, permissionMode: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="default">默认</option>
                    <option value="acceptEdits">自动接受编辑</option>
                    <option value="bypassPermissions">绕过权限检查</option>
                    <option value="plan">规划模式</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">图标</label>
                    <input
                      type="text"
                      value={editForm.ui?.icon || ''}
                      onChange={(e) => setEditForm({ ...editForm, ui: { ...editForm.ui, icon: e.target.value } as any })}
                      placeholder="🤖"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Tool selector */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">启用的工具</label>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowToolSelector(!showToolSelector)}
                  className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors text-sm"
                >
                  选择工具
                </button>
                {(selectedRegularTools.length > 0 || selectedMcpTools.length > 0) && (
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    常规工具 {selectedRegularTools.length} 个
                    {selectedMcpTools.length > 0 && `, MCP工具 ${selectedMcpTools.length} 个`}
                  </span>
                )}
                <UnifiedToolSelector
                  isOpen={showToolSelector}
                  onClose={() => setShowToolSelector(false)}
                  selectedRegularTools={selectedRegularTools}
                  onRegularToolsChange={setSelectedRegularTools}
                  selectedMcpTools={selectedMcpTools}
                  onMcpToolsChange={setSelectedMcpTools}
                  mcpToolsEnabled={mcpToolsEnabled}
                  onMcpEnabledChange={setMcpToolsEnabled}
                />
              </div>
            </div>

            {/* System Prompt */}
            <div>
              <SystemPromptEditor
                value={editForm.systemPrompt || ''}
                onChange={(systemPrompt) => setEditForm({ ...editForm, systemPrompt })}
                disabled={agent ? isBuiltinAgent(agent) : false}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
