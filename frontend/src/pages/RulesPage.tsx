/**
 * Rules Management Page
 * 
 * Supports both Claude Code (.claude/rules/*.md) and Cursor (.cursor/rules/*.mdc)
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  FileCode,
  Globe,
  FolderOpen,
  AlertCircle,
  RefreshCw,
  CheckCircle,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import useEngine from '../hooks/useEngine';

// Types
interface RuleFrontmatter {
  description?: string;
  globs?: string;
  alwaysApply?: boolean;
  paths?: string[];
}

interface RuleListItem {
  id: string;
  name: string;
  filename: string;
  scope: 'global' | 'project';
  description?: string;
  globs?: string;
  paths?: string[];
  alwaysApply?: boolean;
  source?: string;
}

interface RulesResponse {
  rules: RuleListItem[];
  readOnly: boolean;
  engine: string;
}

interface Rule {
  id: string;
  name: string;
  filename: string;
  path: string;
  scope: 'global' | 'project';
  frontmatter: RuleFrontmatter;
  content: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

// API functions
async function fetchRules(): Promise<RulesResponse> {
  const response = await authFetch(`${API_BASE}/rules`);
  if (!response.ok) {
    throw new Error('Failed to fetch rules');
  }
  return response.json();
}

async function fetchRule(id: string): Promise<{ rule: Rule }> {
  const response = await authFetch(`${API_BASE}/rules/${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new Error('Failed to fetch rule');
  }
  return response.json();
}

async function createRule(data: {
  name: string;
  scope: 'global' | 'project';
  content: string;
  frontmatter?: RuleFrontmatter;
}): Promise<{ rule: Rule }> {
  const response = await authFetch(`${API_BASE}/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create rule');
  }
  return response.json();
}

async function updateRule(id: string, data: {
  content?: string;
  frontmatter?: RuleFrontmatter;
}): Promise<{ rule: Rule }> {
  const response = await authFetch(`${API_BASE}/rules/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update rule');
  }
  return response.json();
}

async function deleteRule(id: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete rule');
  }
}

export const RulesPage: React.FC = () => {
  const { engineType } = useEngine();
  const queryClient = useQueryClient();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [viewingRule, setViewingRule] = useState<Rule | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<RuleListItem | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    scope: 'global' as 'global' | 'project',
    content: '',
    description: '',
    globs: '',
    alwaysApply: false,
  });

  // Queries
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['rules'],
    queryFn: fetchRules,
  });

  const rules = data?.rules || [];
  const readOnly = data?.readOnly || false;

  // Mutations
  const createMutation = useMutation({
    mutationFn: createRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      setShowForm(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { content?: string; frontmatter?: RuleFrontmatter } }) =>
      updateRule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      setShowForm(false);
      setEditingRule(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      setShowDeleteConfirm(null);
    },
  });

  // Helpers
  const resetForm = () => {
    setFormData({
      name: '',
      scope: 'global',
      content: '',
      description: '',
      globs: '',
      alwaysApply: false,
    });
  };

  const handleViewRule = async (rule: RuleListItem) => {
    try {
      const { rule: fullRule } = await fetchRule(rule.id);
      setViewingRule(fullRule);
    } catch (error) {
      console.error('Failed to fetch rule:', error);
    }
  };

  const handleEditRule = async (rule: RuleListItem) => {
    try {
      const { rule: fullRule } = await fetchRule(rule.id);
      setEditingRule(fullRule);
      setFormData({
        name: fullRule.name,
        scope: fullRule.scope,
        content: fullRule.content,
        description: fullRule.frontmatter.description || '',
        globs: fullRule.frontmatter.globs || '',
        alwaysApply: fullRule.frontmatter.alwaysApply || false,
      });
      setShowForm(true);
    } catch (error) {
      console.error('Failed to fetch rule:', error);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const frontmatter: RuleFrontmatter = {};
    if (formData.description) frontmatter.description = formData.description;
    if (formData.globs) frontmatter.globs = formData.globs;
    if (formData.alwaysApply) frontmatter.alwaysApply = formData.alwaysApply;
    
    if (editingRule) {
      updateMutation.mutate({
        id: editingRule.id,
        data: {
          content: formData.content,
          frontmatter,
        },
      });
    } else {
      createMutation.mutate({
        name: formData.name,
        scope: formData.scope,
        content: formData.content,
        frontmatter,
      });
    }
  };

  // Filter rules
  const filteredRules = rules.filter(rule =>
    rule.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    rule.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>加载失败: {error instanceof Error ? error.message : '未知错误'}</span>
          </div>
          <button
            onClick={() => refetch()}
            className="mt-2 text-sm text-red-600 hover:text-red-700 dark:text-red-400"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Rules</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {engineType === 'cursor-cli' 
                ? '管理 Cursor 规则 (~/.cursor/rules/*.mdc)' 
                : '管理 Claude Code 规则 (~/.claude/rules/*.md)'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!readOnly ? (
              <button
                onClick={() => {
                  setEditingRule(null);
                  resetForm();
                  setShowForm(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>添加规则</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-700 dark:text-yellow-400 text-sm">
                <Eye className="w-4 h-4" />
                <span>只读模式 ({engineType === 'cursor-cli' ? 'Cursor' : 'Claude'})</span>
              </div>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索规则..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
          />
        </div>
      </div>

      {/* Rules Table */}
      {filteredRules.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <FileCode className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {searchTerm ? '没有找到匹配的规则' : '暂无规则'}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchTerm ? '尝试调整搜索条件' : '创建第一个规则开始'}
          </p>
          {!readOnly && !searchTerm && (
            <button
              onClick={() => {
                setEditingRule(null);
                resetForm();
                setShowForm(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              添加规则
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>范围</TableHead>
                <TableHead>描述</TableHead>
                <TableHead>匹配模式</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-blue-500" />
                      {rule.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                      rule.scope === 'global' 
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                    }`}>
                      {rule.scope === 'global' ? <Globe className="w-3 h-3" /> : <FolderOpen className="w-3 h-3" />}
                      {rule.scope === 'global' ? '全局' : '项目'}
                    </span>
                  </TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400 max-w-xs truncate">
                    {rule.description || '-'}
                  </TableCell>
                  <TableCell className="text-gray-500 dark:text-gray-400 text-sm">
                    {rule.globs || rule.paths?.join(', ') || '-'}
                    {rule.alwaysApply && (
                      <span className="ml-2 inline-flex items-center gap-1 text-green-600">
                        <CheckCircle className="w-3 h-3" />
                        始终应用
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleViewRule(rule)}
                        className="p-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title="查看"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {!readOnly && (
                        <>
                          <button
                            onClick={() => handleEditRule(rule)}
                            className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded transition-colors"
                            title="编辑"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm(rule)}
                            className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingRule ? '编辑规则' : '创建规则'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {!editingRule && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      规则名称
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      placeholder="my-rule"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      范围
                    </label>
                    <select
                      value={formData.scope}
                      onChange={(e) => setFormData({ ...formData, scope: e.target.value as 'global' | 'project' })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    >
                      <option value="global">全局</option>
                      <option value="project">项目</option>
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  描述
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  placeholder="规则描述"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  匹配模式 (globs)
                </label>
                <input
                  type="text"
                  value={formData.globs}
                  onChange={(e) => setFormData({ ...formData, globs: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  placeholder="**/*.ts, src/**/*.tsx"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="alwaysApply"
                  checked={formData.alwaysApply}
                  onChange={(e) => setFormData({ ...formData, alwaysApply: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="alwaysApply" className="text-sm text-gray-700 dark:text-gray-300">
                  始终应用此规则
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  规则内容
                </label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white font-mono text-sm"
                  rows={12}
                  placeholder="# 规则内容 (Markdown)"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingRule(null);
                    resetForm();
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Rule Modal */}
      {viewingRule && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {viewingRule.name}
              </h2>
              <span className={`px-2 py-1 rounded-full text-xs ${
                viewingRule.scope === 'global'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                  : 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
              }`}>
                {viewingRule.scope === 'global' ? '全局' : '项目'}
              </span>
            </div>
            <div className="p-6 space-y-4">
              {viewingRule.frontmatter.description && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">描述</h3>
                  <p className="text-gray-900 dark:text-white">{viewingRule.frontmatter.description}</p>
                </div>
              )}
              {viewingRule.frontmatter.globs && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">匹配模式</h3>
                  <code className="text-sm bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                    {viewingRule.frontmatter.globs}
                  </code>
                </div>
              )}
              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">内容</h3>
                <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg overflow-x-auto text-sm text-gray-800 dark:text-gray-200">
                  {viewingRule.content}
                </pre>
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                路径: {viewingRule.path}
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                onClick={() => setViewingRule(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">确认删除</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              确定要删除规则 "{showDeleteConfirm.name}" 吗？此操作无法撤销。
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => deleteMutation.mutate(showDeleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleteMutation.isPending ? '删除中...' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
