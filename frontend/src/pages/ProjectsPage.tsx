import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import { showError } from '../utils/toast';
import { isTauri } from '../lib/environment';
import {
  Plus,
  Search,
  Folder,
  X,
  FolderOpen
} from 'lucide-react';
import { ProjectTable } from '../components/ProjectTable';
import { useAgents } from '../hooks/useAgents';
import { FileBrowser } from '../components/FileBrowser';
import { useConfirm } from '../hooks/useConfirm';

interface Project {
  id: string;
  name: string;
  dirName: string;
  path: string;
  realPath?: string;
  agents: string[];
  defaultAgent: string;
  defaultAgentName: string;
  defaultAgentIcon: string;
  defaultProviderId?: string;
  defaultModel?: string;
  createdAt: string;
  lastAccessed: string;
  description?: string;
}

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: { 
    name: string; 
    agentId: string; 
    directory: string; 
    description: string; 
  }) => void;
  agents: Array<{
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    ui: {
      icon: string;
    };
  }>;
}

const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  agents
}) => {
  const { t } = useTranslation('pages');
  const [formData, setFormData] = useState({
    name: '',
    agentId: '',
    directory: '~/claude-code-projects',
    description: ''
  });
  const [showFileBrowser, setShowFileBrowser] = useState(false);


  useEffect(() => {
    if (isOpen) {
      // Reset form when modal opens
      setFormData({
        name: '',
        agentId: agents.length > 0 ? agents[0].id : '',
        directory: '~/claude-code-projects',
        description: ''
      });
    }
  }, [isOpen, agents]);

  // Function to expand tilde in path for the file browser
  const getAbsolutePath = (path: string) => {
    if (path.startsWith('~/')) {
      // For the file browser, we need to use an absolute path
      // We'll pass undefined to let the backend handle the default
      return undefined;
    }
    return path;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.agentId) {
      onConfirm(formData);
    }
  };

  const selectedAgent = agents.find(agent => agent.id === formData.agentId);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('projects.form.create')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            {/* Project Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('projects.form.nameRequired')}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('projects.form.namePlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                required
              />
            </div>

            {/* Agent Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('projects.form.agentType')}
              </label>
              <select
                value={formData.agentId}
                onChange={(e) => setFormData({ ...formData, agentId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                required
              >
                {agents.filter(agent => agent.enabled).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.ui.icon} {agent.name}
                  </option>
                ))}
              </select>
              {selectedAgent && (
                <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="text-2xl">{selectedAgent.ui.icon}</div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{selectedAgent.name}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">{selectedAgent.description}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Project Directory */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('projects.form.directory')}
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={formData.directory}
                  onChange={(e) => setFormData({ ...formData, directory: e.target.value })}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowFileBrowser(true)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                  title={t('projects.form.directory')}
                >
                  <Folder className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('projects.form.directoryNote')}
              </p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('projects.form.description')}
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t('projects.form.descriptionPlaceholder')}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t('projects.form.cancel')}
            </button>
            <button
              type="submit"
              disabled={!formData.name || !formData.agentId}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('projects.createButton')}
            </button>
          </div>
        </form>
      </div>
      
      {/* FileBrowser Modal */}
      {showFileBrowser && (
        <FileBrowser
          title={t('projects.form.directory')}
          initialPath={getAbsolutePath(formData.directory)}
          allowFiles={false}
          allowDirectories={true}
          allowNewDirectory={true}
          onSelect={(path, isDirectory) => {
            if (isDirectory) {
              setFormData({ ...formData, directory: path });
              setShowFileBrowser(false);
            }
          }}
          onClose={() => setShowFileBrowser(false)}
        />
      )}
    </div>
  );
};

const openProjectWindow = (projectPath: string) => {
  const params = new URLSearchParams();
  params.set('project', projectPath);
  const url = `/project-workspace?${params.toString()}`;
  if (isTauri()) {
    window.location.href = url;
  } else {
    const windowName = `project_${projectPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
    window.open(url, windowName);
  }
};

export const ProjectsPage: React.FC = () => {
  const { t } = useTranslation('pages');
  const { data: agentsData } = useAgents();
  const confirm = useConfirm();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [agentSelectProject, setAgentSelectProject] = useState<Project | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importProjectPath, setImportProjectPath] = useState('');
  const [showImportBrowser, setShowImportBrowser] = useState(false);

  const agents = agentsData?.agents || [];
  const enabledAgents = agents.filter(agent => agent.enabled);

  // Fetch projects function (extracted for reuse)
  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await authFetch(`${API_BASE}/projects`);
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
      } else {
        console.error('Failed to fetch projects:', response.status);
        setProjects([]);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, []);

  const filteredProjects = projects.filter(project => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         project.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         project.defaultAgentName.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesSearch;
  }).sort((a, b) => {
    // 按最后访问时间倒序排列（最近访问的在前面）
    return new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime();
  });

  const handleCreateProject = async (data: {
    name: string;
    agentId: string;
    directory: string;
    description: string;
  }) => {
    try {
      const response = await authFetch(`${API_BASE}/projects/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: data.agentId,
          projectName: data.name,
          parentDirectory: data.directory,
          description: data.description
        })
      });

      if (response.ok) {
        const result = await response.json();

        setProjects(prev => [result.project, ...prev]);
        setShowCreateModal(false);

        openProjectWindow(result.project.path);
      } else {
        const error = await response.json();
        throw new Error(error.error || t('projects.errors.createFailed'));
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      showError(t('projects.errors.createFailed'), error instanceof Error ? error.message : t('errors:common.unknownError'));
    }
  };

  const handleOpenProject = (project: Project) => {
    openProjectWindow(project.path);

    setProjects(prev => prev.map(p => 
      p.id === project.id 
        ? { ...p, lastAccessed: new Date().toISOString() }
        : p
    ));
  };

  const handleDeleteProject = async (project: Project) => {
    const confirmed = await confirm({
      title: t('projects.deleteTitle', '删除确认'),
      message: `${t('projects.deleteConfirm')}\n\n${t('projects.deleteNote')}`,
      confirmText: t('common.delete', '删除'),
      cancelText: t('common.cancel', '取消'),
      variant: 'danger'
    });

    if (confirmed) {
      try {
        const response = await authFetch(`${API_BASE}/projects/by-id/${project.id}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          setProjects(prev => prev.filter(p => p.id !== project.id));
        } else {
          const error = await response.json();
          throw new Error(error.error || t('projects.errors.deleteFailed'));
        }
      } catch (error) {
        console.error('Failed to delete project:', error);
        showError(t('projects.errors.deleteFailed'), error instanceof Error ? error.message : t('errors:common.unknownError'));
      }
    }
  };

  const handleAgentChanged = (projectId: string, newAgent: any) => {
    // 更新项目列表中的助手信息
    setProjects(prev => prev.map(p => 
      p.id === projectId 
        ? { 
            ...p, 
            defaultAgent: newAgent.id,
            defaultAgentName: newAgent.name,
            defaultAgentIcon: newAgent.ui.icon,
            lastAccessed: new Date().toISOString()
          }
        : p
    ));
  };

  const handleAgentSelection = async (agentId: string) => {
    if (!agentSelectProject) return;

    try {
      // Call API to select agent for project using full project path
      const response = await authFetch(`${API_BASE}/projects/${encodeURIComponent(agentSelectProject.path)}/select-agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentId })
      });

      if (response.ok) {
        const data = await response.json();
        // Update projects list with new agent info
        setProjects(prev => prev.map(p =>
          p.id === agentSelectProject.id ? data.project : p
        ));

        setAgentSelectProject(null);

        openProjectWindow(data.project.path);
      } else {
        const error = await response.json();
        showError(t('errors:agent.setFailed'), error.error || t('errors:common.unknownError'));
      }
    } catch (error) {
      console.error('Failed to select agent:', error);
      showError(t('errors:agent.setFailed'), error instanceof Error ? error.message : t('errors:common.unknownError'));
    }
  };

  const handleImportProject = async () => {
    if (!importProjectPath.trim()) return;

    try {
      // Check if the directory exists
      const checkResponse = await authFetch(`${API_BASE}/files/browse?path=${encodeURIComponent(importProjectPath)}`);
      if (!checkResponse.ok) {
        throw new Error('目录不存在或无法访问');
      }

      const dirData = await checkResponse.json();
      if (!dirData.isDirectory) {
        throw new Error('请选择一个目录');
      }

      // Import the project using the first available agent
      const firstAgent = enabledAgents[0];
      if (!firstAgent) {
        throw new Error('没有可用的代理');
      }

      const response = await authFetch(`${API_BASE}/projects/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: firstAgent.id,
          projectPath: importProjectPath
        })
      });

      if (response.ok) {
        const result = await response.json();

        // Add the imported project to the list
        setProjects(prev => [result.project, ...prev]);
        setShowImportModal(false);
        setImportProjectPath('');

        // Show success message and ask if user wants to open the project
        const shouldOpen = await confirm({
          title: '导入成功',
          message: `项目 "${result.project.name}" 导入成功！\n\n是否立即打开该项目？`,
          confirmText: '打开项目',
          cancelText: '稍后',
          variant: 'info'
        });

        if (shouldOpen) {
          openProjectWindow(result.project.path);
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || '导入项目失败');
      }
    } catch (error) {
      console.error('Failed to import project:', error);
      showError('导入项目失败', error instanceof Error ? error.message : '未知错误');
    }
  };

  const handleImportFileSelect = (path: string, isDirectory: boolean) => {
    if (isDirectory) {
      setImportProjectPath(path);
      setShowImportBrowser(false);
    }
  };



  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <div className="text-gray-600 dark:text-gray-400">{t('projects.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('projects.title')}</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">{t('projects.subtitle')}</p>
          </div>
        </div>

        {/* Search and Add Button */}
        <div className="flex items-center space-x-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder={t('projects.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-3 w-full border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
            />
          </div>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 hover:shadow-md active:scale-95 transition-all whitespace-nowrap font-medium"
          >
            <FolderOpen className="w-5 h-5" />
            <span>导入项目</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            <Plus className="w-5 h-5" />
            <span>{t('projects.createButton')}</span>
          </button>
        </div>
      </div>

      {/* Projects Table */}
      {filteredProjects.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="text-6xl mb-4">📁</div>
          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-2">
            {t('projects.noProjects')}
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t('projects.selectType')}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t('projects.createButton')}
            </button>
          )}
        </div>
      ) : (
        <ProjectTable
          projects={filteredProjects}
          agents={enabledAgents}
          onOpenProject={handleOpenProject}
          onDeleteProject={handleDeleteProject}
          onAgentChanged={handleAgentChanged}
        />
      )}

      {/* Import Project Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">导入项目</h2>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportProjectPath('');
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  项目目录路径
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={importProjectPath}
                    onChange={(e) => setImportProjectPath(e.target.value)}
                    placeholder="请选择或输入项目目录路径"
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowImportBrowser(true)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                    title="选择目录"
                  >
                    <Folder className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  选择要导入的现有项目目录
                </p>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>说明：</strong>导入的目录将被添加到项目中，并关联到第一个可用的代理。
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowImportModal(false);
                    setImportProjectPath('');
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleImportProject}
                  disabled={!importProjectPath.trim()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  导入项目
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onConfirm={handleCreateProject}
        agents={enabledAgents}
      />

      {/* Agent Selection Modal */}
      {agentSelectProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('projects.selectType')}</h2>
              <button
                onClick={() => setAgentSelectProject(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="mb-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  {t('projects.selectType')}
                </p>
              </div>

              <div className="space-y-3">
                {enabledAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => handleAgentSelection(agent.id)}
                    className="w-full p-4 text-left border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="text-2xl">{agent.ui.icon}</div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{agent.name}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">{agent.description}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={() => setAgentSelectProject(null)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  {t('projects.form.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FileBrowser for Import */}
      {showImportBrowser && (
        <FileBrowser
          title="选择项目目录"
          allowFiles={false}
          allowDirectories={true}
          onSelect={handleImportFileSelect}
          onClose={() => setShowImportBrowser(false)}
        />
      )}
    </div>
  );
};