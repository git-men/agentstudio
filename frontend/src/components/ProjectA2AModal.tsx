import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Key,
  Bot,
  ExternalLink,
  Copy,
  Plus,
  Trash2,
  Loader,
  Shield,
  Clock,
  Activity,
  Settings,
  ToggleLeft,
  ToggleRight,
  Eye,
  EyeOff,
  FolderInput,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { useA2AManagement } from '../hooks/useA2AManagement';
import { useProjects } from '../hooks/useProjects';
import { showError } from '../utils/toast';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import { useConfirm } from '../hooks/useConfirm';

interface Project {
  id: string;
  name: string;
  path: string;
}

interface ProjectA2AModalProps {
  project: Project;
  onClose: () => void;
}

export const ProjectA2AModal: React.FC<ProjectA2AModalProps> = ({ project, onClose }) => {
  const { t } = useTranslation('components');
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<'overview' | 'keys' | 'external' | 'tasks' | 'im'>('overview');

  // Use A2A management hook
  const {
    loading,
    agentMapping,
    agentCard,
    apiKeys,
    config,
    tasks,
    createApiKey,
    deleteApiKey,
    addExternalAgent,
    removeExternalAgent,
    updateExternalAgent,
    toggleExternalAgent,
    copyToClipboard,
    validateAgentUrl,
    formatDate,
    importProjects
  } = useA2AManagement(project);

  // Get all projects for import
  const { data: projectsData } = useProjects();

  // Form states
  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false);
  const [showAddAgentModal, setShowAddAgentModal] = useState(false);
  const [showImportProjectsModal, setShowImportProjectsModal] = useState(false);
  const [selectedProjectsForImport, setSelectedProjectsForImport] = useState<Set<string>>(new Set());
  const [importingProjects, setImportingProjects] = useState(false);
  const [editingAgentIndex, setEditingAgentIndex] = useState<number | null>(null);
  const [newKeyDescription, setNewKeyDescription] = useState('');
  const [keyDescriptionError, setKeyDescriptionError] = useState('');
  const [showNewKeyModal, setShowNewKeyModal] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string>('');
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  
  // IM integration states
  const [networkInfo, setNetworkInfo] = useState<any>(null);
  const [loadingNetworkInfo, setLoadingNetworkInfo] = useState(false);
  const [generatedCommand, setGeneratedCommand] = useState<string>('');
  const [generatingCommand, setGeneratingCommand] = useState(false);

  // Load network info function
  const loadNetworkInfo = React.useCallback(async () => {
    setLoadingNetworkInfo(true);
    try {
      const response = await authFetch(`${API_BASE}/network-info`);
      if (!response.ok) throw new Error('Failed to load network info');
      const data = await response.json();
      setNetworkInfo(data);
    } catch (error) {
      console.error('Error loading network info:', error);
      showError('获取网络信息失败');
    } finally {
      setLoadingNetworkInfo(false);
    }
  }, []);

  // Load network info when IM tab is activated
  React.useEffect(() => {
    if (activeTab === 'im' && !networkInfo && !loadingNetworkInfo) {
      loadNetworkInfo();
    }
  }, [activeTab, networkInfo, loadingNetworkInfo, loadNetworkInfo]);

  // Toggle key visibility
  const toggleKeyVisibility = (keyId: string) => {
    setVisibleKeys(prev => {
      const newSet = new Set(prev);
      if (newSet.has(keyId)) {
        newSet.delete(keyId);
      } else {
        newSet.add(keyId);
      }
      return newSet;
    });
  };

  // Mask API key for display
  const maskApiKey = (key: string | null | undefined) => {
    if (!key) return '••••••••••••••••';
    return '•'.repeat(Math.min(key.length, 40));
  };

  const [newAgent, setNewAgent] = useState({
    name: '',
    url: '',
    apiKey: '',
    description: '',
    enabled: true,
    protocolType: 'a2a-jsonrpc' as 'custom' | 'a2a-jsonrpc',
  });
  const [newCustomHeaders, setNewCustomHeaders] = useState<{ key: string; value: string }[]>([]);
  const [jsonRpcUrlMode, setJsonRpcUrlMode] = useState<'endpoint' | 'agentcard'>('endpoint');
  const [agentCardInput, setAgentCardInput] = useState('');
  const [discoveringCard, setDiscoveringCard] = useState(false);
  const [cardDiscoverError, setCardDiscoverError] = useState('');

  const [agentFormErrors, setAgentFormErrors] = useState({
    name: '',
    url: '',
    apiKey: ''
  });

  const handleDiscoverAgentCard = async () => {
    if (!agentCardInput.trim()) return;
    setDiscoveringCard(true);
    setCardDiscoverError('');
    try {
      const resp = await authFetch(`${API_BASE}/a2a/discover-agent-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: agentCardInput.trim() }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const card = await resp.json();
      if (card.url) {
        let discoveredUrl: string = card.url;
        if (discoveredUrl.startsWith('http://')) {
          try {
            const parsed = new URL(discoveredUrl);
            const h = parsed.hostname;
            if (h !== 'localhost' && h !== '127.0.0.1' && h !== '::1') {
              discoveredUrl = discoveredUrl.replace(/^http:\/\//, 'https://');
            }
          } catch { /* keep original */ }
        }
        setNewAgent(prev => ({
          ...prev,
          url: discoveredUrl,
          name: prev.name || card.name || '',
          description: prev.description || card.description || '',
        }));
      } else {
        setCardDiscoverError('Agent Card 中未找到 url 字段');
      }
    } catch (err: any) {
      setCardDiscoverError(err.message || '无法获取 Agent Card');
    } finally {
      setDiscoveringCard(false);
    }
  };

  // Validate key description
  const validateKeyDescription = (description: string) => {
    if (!description.trim()) {
      setKeyDescriptionError(t('a2aManagement.validation.descriptionRequired'));
      return false;
    }
    if (description.length > 100) {
      setKeyDescriptionError(t('a2aManagement.validation.descriptionTooLong'));
      return false;
    }
    setKeyDescriptionError('');
    return true;
  };

  // Validate agent form
  const validateAgentForm = () => {
    const errors = {
      name: '',
      url: '',
      apiKey: ''
    };

    let isValid = true;

    if (!newAgent.name.trim()) {
      errors.name = t('a2aManagement.validation.agentNameRequired');
      isValid = false;
    } else if (newAgent.name.length > 50) {
      errors.name = t('a2aManagement.validation.agentNameTooLong');
      isValid = false;
    }

    if (!newAgent.url.trim()) {
      errors.url = t('a2aManagement.validation.urlRequired');
      isValid = false;
    } else {
      const urlValidation = validateAgentUrl(newAgent.url);
      if (!urlValidation.valid) {
        errors.url = urlValidation.error || t('a2aManagement.validation.invalidUrl');
        isValid = false;
      }
    }

    if (newAgent.protocolType !== 'a2a-jsonrpc' && !newAgent.apiKey.trim()) {
      errors.apiKey = t('a2aManagement.validation.apiKeyRequired');
      isValid = false;
    }

    setAgentFormErrors(errors);
    return isValid;
  };

  // Handle create API key
  const handleCreateApiKey = async () => {
    if (!validateKeyDescription(newKeyDescription)) return;

    const result = await createApiKey(newKeyDescription);
    if (result && result.key) {
      setNewKeyDescription('');
      setShowCreateKeyModal(false);
      setKeyDescriptionError('');
      // Show the newly created key
      setNewlyCreatedKey(result.key);
      setShowNewKeyModal(true);
    }
  };

  // Handle delete API key
  const handleDeleteApiKey = async (keyId: string) => {
    const confirmed = await confirm({
      title: t('a2aManagement.confirmations.deleteApiKeyTitle', '确认删除'),
      message: t('a2aManagement.confirmations.deleteApiKey'),
      confirmText: t('a2aManagement.actions.delete', '删除'),
      cancelText: t('a2aManagement.actions.cancel', '取消'),
      variant: 'danger'
    });
    if (!confirmed) return;
    await deleteApiKey(keyId);
  };

  const handleSaveExternalAgent = async () => {
    if (!validateAgentForm()) return;

    const headers: Record<string, string> = {};
    for (const h of newCustomHeaders) {
      if (h.key.trim()) headers[h.key.trim()] = h.value;
    }

    const agentData = {
      ...newAgent,
      ...(Object.keys(headers).length > 0 && { customHeaders: headers }),
    };

    if (editingAgentIndex !== null && config) {
      const success = await updateExternalAgent(editingAgentIndex, agentData);
      if (success) {
        setShowAddAgentModal(false);
        resetAgentForm();
      }
    } else {
      const success = await addExternalAgent(agentData);
      if (success) {
        setShowAddAgentModal(false);
        resetAgentForm();
      }
    }
  };

  // Handle delete external agent
  const handleDeleteExternalAgent = async (index: number) => {
    const confirmed = await confirm({
      title: t('a2aManagement.confirmations.deleteExternalAgentTitle', '确认删除'),
      message: t('a2aManagement.confirmations.deleteExternalAgent'),
      confirmText: t('a2aManagement.actions.delete', '删除'),
      cancelText: t('a2aManagement.actions.cancel', '取消'),
      variant: 'danger'
    });
    if (!confirmed) return;
    await removeExternalAgent(index);
  };

  const handleEditExternalAgent = (index: number) => {
    if (!config) return;

    const agent = config.allowedAgents[index] as any;
    setNewAgent({
      name: agent.name,
      url: agent.url,
      apiKey: agent.apiKey,
      description: agent.description || '',
      enabled: agent.enabled,
      protocolType: agent.protocolType || 'custom',
    });
    const ch = agent.customHeaders || {};
    setNewCustomHeaders(Object.entries(ch).map(([key, value]) => ({ key, value: value as string })));
    setEditingAgentIndex(index);
    setShowAddAgentModal(true);
  };

  const resetAgentForm = () => {
    setNewAgent({
      name: '',
      url: '',
      apiKey: '',
      description: '',
      enabled: true,
      protocolType: 'a2a-jsonrpc',
    });
    setNewCustomHeaders([]);
    setJsonRpcUrlMode('endpoint');
    setAgentCardInput('');
    setCardDiscoverError('');
    setEditingAgentIndex(null);
    setAgentFormErrors({ name: '', url: '', apiKey: '' });
  };

  // Handle import projects
  const handleImportProjects = async () => {
    if (selectedProjectsForImport.size === 0) {
      showError('请至少选择一个项目');
      return;
    }

    setImportingProjects(true);
    try {
      const projectPaths = Array.from(selectedProjectsForImport);
      const result = await importProjects(projectPaths);

      if (result) {
        setShowImportProjectsModal(false);
        setSelectedProjectsForImport(new Set());
      }
    } finally {
      setImportingProjects(false);
    }
  };

  // Toggle project selection for import
  const toggleProjectSelection = (projectPath: string) => {
    setSelectedProjectsForImport(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectPath)) {
        newSet.delete(projectPath);
      } else {
        newSet.add(projectPath);
      }
      return newSet;
    });
  };

  // Generate curl command for calling this agent
  const generateCurlCommand = () => {
    if (!agentCard || !apiKeys.length) return '';

    const apiKey = apiKeys[0].key || 'YOUR_API_KEY_HERE';
    // Add /messages endpoint to the agent URL for synchronous messaging
    const endpoint = `${agentCard.url}/messages`;

    const curlCommand = `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "message": "你好，请帮我完成一个任务"
  }'`;

    return curlCommand;
  };

  // Copy curl command to clipboard
  const copyCurlCommand = async () => {
    const command = generateCurlCommand();
    if (command) {
      await copyToClipboard(command);
    } else {
      showError('请先创建至少一个 API 密钥');
    }
  };

  // Render tabs
  const renderTabs = () => (
    <div className="border-b border-gray-200 dark:border-gray-700 px-6">
      <nav className="flex space-x-8">
        {[
          { id: 'overview', label: t('a2aManagement.tabs.overview'), icon: Shield },
          { id: 'keys', label: t('a2aManagement.tabs.apiKeys'), icon: Key },
          { id: 'external', label: t('a2aManagement.tabs.external'), icon: Bot },
          { id: 'tasks', label: t('a2aManagement.tabs.tasks'), icon: Activity },
          { id: 'im', label: t('a2aManagement.tabs.im'), icon: MessageSquare }
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            className={`flex items-center space-x-2 py-4 px-3 border-b-2 font-medium text-sm transition-colors ${
              activeTab === id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );

  // Render overview tab
  const renderOverview = () => {
    // Get project directory name and format agent name
    const projectName = project.path.split('/').pop() || project.path;
    const agentType = agentCard?.context?.agentType || 'claude code';
    const formattedAgentName = `${projectName} (${agentType})`;

    return (
      <div className="space-y-6">
        {/* Quick Stats - Move to first */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center">
              <Key className="w-8 h-8 text-blue-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('a2aManagement.overview.apiKeys')}</p>
                <p className="text-2xl font-semibold text-gray-900 dark:text-white">{apiKeys.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center">
              <Bot className="w-8 h-8 text-green-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('a2aManagement.overview.externalAgents')}</p>
                <p className="text-2xl font-semibold text-gray-900 dark:text-white">{config?.allowedAgents?.length || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center">
              <Activity className="w-8 h-8 text-purple-500" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('a2aManagement.overview.activeTasks')}</p>
                <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                  {tasks.filter(task => task.status === 'running').length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Agent Card Preview */}
        {agentCard && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4 flex items-center">
              <Bot className="w-5 h-5 mr-2" />
              {t('a2aManagement.overview.agentCard')}
            </h3>

            {/* Agent Header */}
            <div className="mb-6">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
                    {formattedAgentName}
                  </h4>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    {agentCard.description}
                  </p>
                </div>
                <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full">
                  {agentCard.version}
                </span>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <div className="flex items-center justify-between text-sm text-blue-800 dark:text-blue-200 mb-1">
                  <div className="flex items-center">
                    <Shield className="w-4 h-4 mr-2" />
                    A2A Endpoint
                  </div>
                  <button
                    onClick={copyCurlCommand}
                    className="flex items-center space-x-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    title="复制 curl 命令"
                  >
                    <Copy className="w-3 h-3" />
                    <span>复制 curl</span>
                  </button>
                </div>
                <code className="text-xs text-blue-700 dark:text-blue-300 font-mono break-all">
                  {agentCard.url}
                </code>
              </div>
            </div>

            {/* Agent Context */}
            <div className="mb-6">
              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                {t('a2aManagement.agentCard.context')}
              </h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 dark:text-gray-400">A2A Agent ID:</span>
                  <div className="flex items-center space-x-2 flex-1 min-w-0">
                    <code className="text-gray-900 dark:text-white font-mono text-xs truncate">
                      {agentCard.context?.a2aAgentId}
                    </code>
                    <button
                      onClick={() => copyToClipboard(agentCard.context?.a2aAgentId || '')}
                      className="p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0"
                      title={t('a2aManagement.actions.copy')}
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Project:</span>
                  <span className="text-gray-900 dark:text-white">{agentCard.context?.projectName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Type:</span>
                  <span className="text-gray-900 dark:text-white">{agentCard.context?.agentType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Category:</span>
                  <span className="text-gray-900 dark:text-white">{agentCard.context?.agentCategory}</span>
                </div>
              </div>
            </div>

            {/* Skills */}
            <div>
              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                {t('a2aManagement.agentCard.skills')} ({agentCard.skills?.length || 0})
              </h5>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                {agentCard.skills?.map((skill: { name: string; description: string }, index: number) => (
                  <div
                    key={index}
                    className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-xs"
                  >
                    <div className="font-medium text-gray-900 dark:text-white mb-1 truncate">
                      {skill.name}
                    </div>
                    <div className="text-gray-500 dark:text-gray-400 line-clamp-2">
                      {skill.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Security */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                <Key className="w-3 h-3 mr-1" />
                {t('a2aManagement.agentCard.security')}: {agentCard.securitySchemes?.[0]?.type}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render API keys tab
  const renderKeys = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">{t('a2aManagement.apiKeys.title')}</h3>
        <button
          onClick={() => setShowCreateKeyModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          <span>{t('a2aManagement.actions.createKey')}</span>
        </button>
      </div>

      {loading.keys ? (
        <div className="flex items-center justify-center py-8">
          <Loader className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : apiKeys.length === 0 ? (
        <div className="text-center py-12">
          <Key className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">{t('a2aManagement.apiKeys.noKeys')}</p>
          <button
            onClick={() => setShowCreateKeyModal(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {t('a2aManagement.apiKeys.createFirstKey')}
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">
                  {t('a2aManagement.apiKeys.description')}
                </th>
                <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">
                  {t('a2aManagement.apiKeys.key')}
                </th>
                <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">
                  {t('a2aManagement.apiKeys.createdAt')}
                </th>
                <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">
                  {t('a2aManagement.apiKeys.lastUsed')}
                </th>
                <th className="text-right py-3 px-4 font-medium text-gray-700 dark:text-gray-300">
                  {t('a2aManagement.apiKeys.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((apiKey) => (
                <tr key={apiKey.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-900 dark:text-white">{apiKey.description}</span>
                      <span className="px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full">
                        Active
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-2">
                      <code className="text-xs text-gray-700 dark:text-gray-300 font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded max-w-xs overflow-hidden">
                        {visibleKeys.has(apiKey.id) && apiKey.key ? apiKey.key : maskApiKey(apiKey.key)}
                      </code>
                      {apiKey.key && (
                        <button
                          onClick={() => toggleKeyVisibility(apiKey.id)}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                          title={visibleKeys.has(apiKey.id) ? t('a2aManagement.apiKeys.hideKey') : t('a2aManagement.apiKeys.showKey')}
                        >
                          {visibleKeys.has(apiKey.id) ? (
                            <EyeOff className="w-4 h-4 text-gray-500" />
                          ) : (
                            <Eye className="w-4 h-4 text-gray-500" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => apiKey.key && copyToClipboard(apiKey.key)}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                        title={t('a2aManagement.actions.copy')}
                      >
                        <Copy className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-500 dark:text-gray-400">
                    {formatDate(apiKey.createdAt)}
                  </td>
                  <td className="py-3 px-4 text-gray-500 dark:text-gray-400">
                    {apiKey.lastUsed ? formatDate(apiKey.lastUsed) : '-'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleDeleteApiKey(apiKey.id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded-lg transition-colors"
                      title={t('a2aManagement.actions.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Key Modal */}
      {showCreateKeyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('a2aManagement.modals.createKey.title')}</h3>
              <button
                onClick={() => {
                  setShowCreateKeyModal(false);
                  setNewKeyDescription('');
                  setKeyDescriptionError('');
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('a2aManagement.modals.createKey.description')} *
                </label>
                <input
                  type="text"
                  value={newKeyDescription}
                  onChange={(e) => {
                    setNewKeyDescription(e.target.value);
                    validateKeyDescription(e.target.value);
                  }}
                  placeholder={t('a2aManagement.modals.createKey.descriptionPlaceholder')}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white ${
                    keyDescriptionError
                      ? 'border-red-300 dark:border-red-600'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                  maxLength={100}
                  autoFocus
                />
                {keyDescriptionError && (
                  <p className="text-red-600 dark:text-red-400 text-sm mt-1">{keyDescriptionError}</p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('a2aManagement.modals.createKey.descriptionHelp')}
                </p>
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <strong>{t('a2aManagement.modals.createKey.important')}:</strong> {t('a2aManagement.modals.createKey.securityNote')}
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowCreateKeyModal(false);
                    setNewKeyDescription('');
                    setKeyDescriptionError('');
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  {t('a2aManagement.actions.cancel')}
                </button>
                <button
                  onClick={handleCreateApiKey}
                  disabled={!newKeyDescription.trim() || !!keyDescriptionError || loading.keys}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading.keys ? (
                    <span className="flex items-center">
                      <Loader className="w-4 h-4 animate-spin mr-2" />
                      {t('a2aManagement.modals.createKey.creating')}
                    </span>
                  ) : (
                    t('a2aManagement.actions.createKey')
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Display Newly Created Key Modal */}
      {showNewKeyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-lg mx-4">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                <Key className="w-5 h-5 mr-2 text-green-500" />
                {t('a2aManagement.modals.newKey.title', 'API密钥创建成功')}
              </h3>
            </div>

            <div className="p-6">
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('a2aManagement.modals.newKey.yourKey', '您的 API 密钥')}
                </label>
                <div className="relative">
                  <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm break-all">
                    {newlyCreatedKey}
                  </div>
                  <button
                    onClick={() => copyToClipboard(newlyCreatedKey)}
                    className="absolute top-2 right-2 p-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    title={t('a2aManagement.actions.copy')}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-6">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>{t('a2aManagement.modals.newKey.usage', '使用方式')}:</strong> {t('a2aManagement.modals.newKey.usageDetail', '在请求头中添加 Authorization: Bearer YOUR_API_KEY')}
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => copyToClipboard(newlyCreatedKey)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
                >
                  <Copy className="w-4 h-4" />
                  <span>{t('a2aManagement.actions.copyKey', '复制密钥')}</span>
                </button>
                <button
                  onClick={() => {
                    setShowNewKeyModal(false);
                    setNewlyCreatedKey('');
                  }}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                >
                  {t('a2aManagement.actions.close', '关闭')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Render external agents tab
  const renderExternal = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">{t('a2aManagement.external.title')}</h3>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowImportProjectsModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <FolderInput className="w-4 h-4" />
            <span>{t('a2aManagement.actions.importProjects')}</span>
          </button>
          <button
            onClick={() => {
              resetAgentForm();
              setShowAddAgentModal(true);
            }}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            <span>{t('a2aManagement.actions.addAgent')}</span>
          </button>
        </div>
      </div>

      {loading.config ? (
        <div className="flex items-center justify-center py-8">
          <Loader className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : !config || config.allowedAgents?.length === 0 ? (
        <div className="text-center py-12">
          <Bot className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">{t('a2aManagement.external.noAgents')}</p>
          <button
            onClick={() => {
              resetAgentForm();
              setShowAddAgentModal(true);
            }}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {t('a2aManagement.external.addFirstAgent')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {config.allowedAgents?.map((agent, index) => (
            <div key={index} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <h4 className="text-medium font-medium text-gray-900 dark:text-white">
                      {agent.name}
                    </h4>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      (agent as any).protocolType === 'a2a-jsonrpc'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    }`}>
                      {(agent as any).protocolType === 'a2a-jsonrpc' ? 'JSON-RPC' : 'REST'}
                    </span>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      agent.enabled
                        ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                        : 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200'
                    }`}>
                      {agent.enabled ? t('a2aManagement.external.enabled') : t('a2aManagement.external.disabled')}
                    </span>
                  </div>

                  {agent.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{agent.description}</p>
                  )}

                  <div className="space-y-1 text-sm">
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-500 dark:text-gray-400">{t('a2aManagement.external.form.url')}:</span>
                      <a
                        href={agent.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline flex items-center"
                      >
                        {agent.url}
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    </div>
                  </div>
                  {(agent as any).customHeaders && Object.keys((agent as any).customHeaders).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {Object.entries((agent as any).customHeaders).map(([key, value]) => (
                        <span key={key} className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-mono text-gray-600 dark:text-gray-300">
                          {key}: {value as string}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => toggleExternalAgent(index)}
                    className={`p-2 rounded-lg transition-colors ${
                      agent.enabled
                        ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/50'
                        : 'text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    title={agent.enabled ? t('a2aManagement.actions.disable') : t('a2aManagement.actions.enable')}
                  >
                    {agent.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleEditExternalAgent(index)}
                    className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title={t('a2aManagement.actions.edit')}
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteExternalAgent(index)}
                    className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded-lg transition-colors"
                    title={t('a2aManagement.actions.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Agent Modal */}
      {showAddAgentModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl mx-4 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {editingAgentIndex !== null ? t('a2aManagement.external.modal.editTitle') : t('a2aManagement.external.modal.addTitle')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {t('a2aManagement.external.modal.subtitle', '配置外部 A2A Agent 的连接信息和认证方式')}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddAgentModal(false);
                  resetAgentForm();
                }}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="px-8 py-6 space-y-6 max-h-[65vh] overflow-y-auto">
              {/* Protocol Type */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  {t('a2aManagement.external.form.protocol', '协议类型')}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewAgent({ ...newAgent, protocolType: 'a2a-jsonrpc' })}
                    className={`relative flex flex-col items-center gap-1.5 px-4 py-4 rounded-xl border-2 transition-all ${
                      newAgent.protocolType === 'a2a-jsonrpc'
                        ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 dark:border-blue-400 shadow-sm'
                        : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    <span className={`text-sm font-semibold ${
                      newAgent.protocolType === 'a2a-jsonrpc'
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-gray-600 dark:text-gray-400'
                    }`}>
                      A2A Standard
                    </span>
                    <span className={`text-xs ${
                      newAgent.protocolType === 'a2a-jsonrpc'
                        ? 'text-blue-500 dark:text-blue-400'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}>
                      JSON-RPC 2.0
                    </span>
                    {newAgent.protocolType === 'a2a-jsonrpc' && (
                      <div className="absolute top-2.5 right-2.5 w-2 h-2 bg-blue-500 rounded-full" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewAgent({ ...newAgent, protocolType: 'custom' })}
                    className={`relative flex flex-col items-center gap-1.5 px-4 py-4 rounded-xl border-2 transition-all ${
                      newAgent.protocolType === 'custom'
                        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 dark:border-amber-400 shadow-sm'
                        : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    <span className={`text-sm font-semibold ${
                      newAgent.protocolType === 'custom'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-gray-600 dark:text-gray-400'
                    }`}>
                      Custom REST
                    </span>
                    <span className={`text-xs ${
                      newAgent.protocolType === 'custom'
                        ? 'text-amber-500 dark:text-amber-400'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}>
                      AgentStudio 专有协议
                    </span>
                    {newAgent.protocolType === 'custom' && (
                      <div className="absolute top-2.5 right-2.5 w-2 h-2 bg-amber-500 rounded-full" />
                    )}
                  </button>
                </div>
              </div>

              <div className="border-t border-gray-100 dark:border-gray-700" />

              {/* Name + Token — two columns */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {t('a2aManagement.external.form.name')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newAgent.name}
                    onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
                    placeholder={t('a2aManagement.external.form.namePlaceholder')}
                    className={`w-full px-3.5 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white text-sm ${
                      agentFormErrors.name
                        ? 'border-red-300 dark:border-red-600'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                    maxLength={50}
                  />
                  {agentFormErrors.name && (
                    <p className="text-red-600 dark:text-red-400 text-xs mt-1">{agentFormErrors.name}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {newAgent.protocolType === 'a2a-jsonrpc'
                      ? 'Bearer Token'
                      : t('a2aManagement.external.form.apiKey')}
                    {newAgent.protocolType !== 'a2a-jsonrpc' && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    type="password"
                    value={newAgent.apiKey}
                    onChange={(e) => setNewAgent({ ...newAgent, apiKey: e.target.value })}
                    placeholder={
                      newAgent.protocolType === 'a2a-jsonrpc'
                        ? 'Bearer Token（可选）'
                        : t('a2aManagement.external.form.apiKeyPlaceholder')
                    }
                    className={`w-full px-3.5 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white text-sm ${
                      agentFormErrors.apiKey
                        ? 'border-red-300 dark:border-red-600'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {agentFormErrors.apiKey && (
                    <p className="text-red-600 dark:text-red-400 text-xs mt-1">{agentFormErrors.apiKey}</p>
                  )}
                </div>
              </div>

              {/* URL section — different by protocol */}
              {newAgent.protocolType === 'a2a-jsonrpc' ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Endpoint <span className="text-red-500">*</span>
                    </label>
                    <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-md p-0.5">
                      <button
                        type="button"
                        onClick={() => setJsonRpcUrlMode('endpoint')}
                        className={`px-2.5 py-1 text-xs rounded transition-colors ${
                          jsonRpcUrlMode === 'endpoint'
                            ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm font-medium'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                        }`}
                      >
                        直接填写
                      </button>
                      <button
                        type="button"
                        onClick={() => setJsonRpcUrlMode('agentcard')}
                        className={`px-2.5 py-1 text-xs rounded transition-colors ${
                          jsonRpcUrlMode === 'agentcard'
                            ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm font-medium'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                        }`}
                      >
                        从 Agent Card 发现
                      </button>
                    </div>
                  </div>

                  {jsonRpcUrlMode === 'agentcard' && (
                    <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <label className="block text-xs font-medium text-blue-700 dark:text-blue-300 mb-1.5">
                        Agent Card 地址
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="url"
                          value={agentCardInput}
                          onChange={(e) => { setAgentCardInput(e.target.value); setCardDiscoverError(''); }}
                          placeholder="https://host/.well-known/agent.json"
                          className="flex-1 px-3 py-2 border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <button
                          type="button"
                          onClick={handleDiscoverAgentCard}
                          disabled={discoveringCard || !agentCardInput.trim()}
                          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                        >
                          {discoveringCard ? <Loader className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                          发现
                        </button>
                      </div>
                      {cardDiscoverError && (
                        <p className="text-red-600 dark:text-red-400 text-xs mt-1.5">{cardDiscoverError}</p>
                      )}
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1.5">
                        将自动从 Agent Card 中读取 name、url、description
                      </p>
                    </div>
                  )}

                  <input
                    type="url"
                    value={newAgent.url}
                    onChange={(e) => setNewAgent({ ...newAgent, url: e.target.value })}
                    placeholder="https://host/agent/a2a/agent-id"
                    className={`w-full px-3.5 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white text-sm font-mono ${
                      agentFormErrors.url
                        ? 'border-red-300 dark:border-red-600'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {agentFormErrors.url && (
                    <p className="text-red-600 dark:text-red-400 text-xs mt-1">{agentFormErrors.url}</p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                    JSON-RPC 请求将直接 POST 到此地址。系统不会追加任何路径。
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Agent Base URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="url"
                    value={newAgent.url}
                    onChange={(e) => setNewAgent({ ...newAgent, url: e.target.value })}
                    placeholder="https://localhost:4936/a2a/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className={`w-full px-3.5 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white text-sm font-mono ${
                      agentFormErrors.url
                        ? 'border-red-300 dark:border-red-600'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {agentFormErrors.url && (
                    <p className="text-red-600 dark:text-red-400 text-xs mt-1">{agentFormErrors.url}</p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                    填写 Agent 的基础地址，<span className="font-semibold">不要</span>包含 <code className="text-gray-500 dark:text-gray-400">/messages</code> 或 <code className="text-gray-500 dark:text-gray-400">/tasks</code>，系统会自动拼接。
                  </p>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t('a2aManagement.external.form.description')}
                </label>
                <input
                  type="text"
                  value={newAgent.description}
                  onChange={(e) => setNewAgent({ ...newAgent, description: e.target.value })}
                  placeholder={t('a2aManagement.external.form.descriptionPlaceholder')}
                  className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white text-sm"
                  maxLength={200}
                />
              </div>

              {/* Custom Headers */}
              <div className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('a2aManagement.external.form.customHeaders', '自定义 Headers')}
                    </label>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {t('a2aManagement.external.form.headersHint', '例如 X-User-Id（用于 AgentHub 用户身份识别）')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewCustomHeaders([...newCustomHeaders, { key: '', value: '' }])}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    {t('a2aManagement.external.form.addHeader', '添加')}
                  </button>
                </div>
                {newCustomHeaders.length === 0 ? (
                  <div className="text-center py-3 text-xs text-gray-400 dark:text-gray-500">
                    暂无自定义 Headers
                  </div>
                ) : (
                  <div className="space-y-2">
                    {newCustomHeaders.map((header, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Header Name"
                          value={header.key}
                          onChange={(e) => {
                            const updated = [...newCustomHeaders];
                            updated[idx] = { ...updated[idx], key: e.target.value };
                            setNewCustomHeaders(updated);
                          }}
                          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <span className="text-gray-400 text-sm">:</span>
                        <input
                          type="text"
                          placeholder="Value"
                          value={header.value}
                          onChange={(e) => {
                            const updated = [...newCustomHeaders];
                            updated[idx] = { ...updated[idx], value: e.target.value };
                            setNewCustomHeaders(updated);
                          }}
                          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <button
                          type="button"
                          onClick={() => setNewCustomHeaders(newCustomHeaders.filter((_, i) => i !== idx))}
                          className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-8 py-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="agent-enabled"
                  checked={newAgent.enabled}
                  onChange={(e) => setNewAgent({ ...newAgent, enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="agent-enabled" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  {t('a2aManagement.external.form.enableThisAgent')}
                </label>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowAddAgentModal(false);
                    resetAgentForm();
                  }}
                  className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {t('a2aManagement.actions.cancel')}
                </button>
                <button
                  onClick={handleSaveExternalAgent}
                  disabled={loading.config}
                  className="px-5 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {editingAgentIndex !== null ? t('a2aManagement.external.modal.saveChanges') : t('a2aManagement.external.modal.addAgent')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Projects Modal */}
      {showImportProjectsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                <FolderInput className="w-5 h-5 mr-2" />
                {t('a2aManagement.external.importModal.title')}
              </h3>
              <button
                onClick={() => {
                  setShowImportProjectsModal(false);
                  setSelectedProjectsForImport(new Set());
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {t('a2aManagement.external.importModal.description')}
              </p>

              {!projectsData || projectsData.projects.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 dark:text-gray-400">{t('a2aManagement.external.importModal.noProjects')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {projectsData.projects
                    .filter(p => p.path !== project.path) // Exclude current project
                    .map((p) => (
                      <label
                        key={p.path}
                        className="flex items-center p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedProjectsForImport.has(p.path)}
                          onChange={() => toggleProjectSelection(p.path)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <div className="ml-3 flex-1">
                          <div className="font-medium text-gray-900 dark:text-white">{p.name}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">{p.path}</div>
                        </div>
                      </label>
                    ))}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('a2aManagement.external.importModal.selected')}: {selectedProjectsForImport.size}
                </span>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowImportProjectsModal(false);
                    setSelectedProjectsForImport(new Set());
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  {t('a2aManagement.actions.cancel')}
                </button>
                <button
                  onClick={handleImportProjects}
                  disabled={selectedProjectsForImport.size === 0 || importingProjects}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {importingProjects ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      <span>{t('a2aManagement.external.importModal.importing')}</span>
                    </>
                  ) : (
                    <>
                      <FolderInput className="w-4 h-4" />
                      <span>{t('a2aManagement.external.importModal.import')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Render tasks tab
  const renderTasks = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-gray-900 dark:text-white">{t('a2aManagement.tasks.title')}</h3>

      {!agentMapping ? (
        <div className="text-center py-12">
          <Activity className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">{t('a2aManagement.tasks.needA2AEnabled')}</p>
        </div>
      ) : loading.tasks ? (
        <div className="flex items-center justify-center py-8">
          <Loader className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12">
          <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">{t('a2aManagement.tasks.noTasks')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <div key={task.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <h4 className="text-medium font-medium text-gray-900 dark:text-white">
                      {task.id}
                    </h4>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      task.status === 'completed'
                        ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                        : task.status === 'running'
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                        : task.status === 'failed'
                        ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                        : 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200'
                    }`}>
                      {task.status}
                    </span>
                  </div>

                  <div className="space-y-1 text-sm text-gray-500 dark:text-gray-400">
                    <div>{t('a2aManagement.tasks.createdAt')}: {formatDate(task.createdAt)}</div>
                    {task.startedAt && <div>{t('a2aManagement.tasks.startedAt')}: {formatDate(task.startedAt)}</div>}
                    {task.completedAt && <div>{t('a2aManagement.tasks.completedAt')}: {formatDate(task.completedAt)}</div>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Generate IM integration command
  const handleGenerateCommand = async () => {
    if (!agentCard?.context?.a2aAgentId) {
      showError('无法获取 A2A Agent ID');
      return;
    }

    setGeneratingCommand(true);
    try {
      // Check if "企微调用" API key already exists
      const existingKey = apiKeys.find(k => k.description === '企微调用');
      let apiKey: string;
      
      if (existingKey && existingKey.key) {
        // Use existing key
        apiKey = existingKey.key;
      } else {
        // Create new API key for WeChat integration
        const result = await createApiKey('企微调用');
        if (!result || !result.key) {
          showError('创建 API 密钥失败');
          return;
        }
        apiKey = result.key;
      }

      // Reload network info to get latest status
      await loadNetworkInfo();

      // Determine the best URL
      let baseUrl: string;
      if (networkInfo?.tunnel?.connected && networkInfo.tunnel.url) {
        baseUrl = networkInfo.tunnel.url;
      } else if (networkInfo?.network?.bestLocalIP) {
        const port = networkInfo.network.port || 4936;
        baseUrl = `http://${networkInfo.network.bestLocalIP}:${port}`;
      } else {
        showError('无法确定访问地址，请先配置隧道服务');
        return;
      }

      const a2aEndpoint = `${baseUrl}/a2a/${agentCard.context.a2aAgentId}/messages`;
      const command = `/ap ${project.name} ${a2aEndpoint} --api-key ${apiKey}`;
      
      setGeneratedCommand(command);
    } catch (error) {
      console.error('Error generating command:', error);
      showError('生成命令失败');
    } finally {
      setGeneratingCommand(false);
    }
  };

  // Render IM integration tab
  const renderIMIntegration = () => (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              {t('a2aManagement.im.title')}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t('a2aManagement.im.description')}
            </p>
          </div>
          <button
            onClick={loadNetworkInfo}
            disabled={loadingNetworkInfo}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loadingNetworkInfo ? 'animate-spin' : ''}`} />
            {t('a2aManagement.im.refresh')}
          </button>
        </div>

        {/* Network Status */}
        {loadingNetworkInfo ? (
          <div className="flex items-center justify-center py-8">
            <Loader className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : networkInfo && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">
              {t('a2aManagement.im.networkStatus')}
            </h4>
            
            {/* Tunnel Status */}
            <div className="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('a2aManagement.im.tunnelStatus')}
                </span>
                {networkInfo.tunnel?.connected ? (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-3 h-3" />
                    {t('a2aManagement.im.connected')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <AlertTriangle className="w-3 h-3" />
                    {t('a2aManagement.im.notConnected')}
                  </span>
                )}
              </div>
              {networkInfo.tunnel?.connected && networkInfo.tunnel.url && (
                <div className="text-xs text-gray-600 dark:text-gray-400 break-all">
                  {networkInfo.tunnel.url}
                </div>
              )}
            </div>

            {/* Local Network */}
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('a2aManagement.im.localNetwork')}
                </span>
                {networkInfo.network?.bestLocalIP ? (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-3 h-3" />
                    {t('a2aManagement.im.available')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <AlertTriangle className="w-3 h-3" />
                    {t('a2aManagement.im.unavailable')}
                  </span>
                )}
              </div>
              {networkInfo.network?.bestLocalIP && (
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  http://{networkInfo.network.bestLocalIP}:{networkInfo.network.port || 4936}
                </div>
              )}
            </div>

            {/* Warning if no tunnel and no local IP */}
            {!networkInfo.tunnel?.connected && !networkInfo.network?.bestLocalIP && (
              <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-yellow-800 dark:text-yellow-200">
                    {t('a2aManagement.im.noAccessWarning')}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Command Generator */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">
            {t('a2aManagement.im.commandGenerator')}
          </h4>
          
          <div className="mb-4">
            <button
              onClick={handleGenerateCommand}
              disabled={generatingCommand || !agentCard?.context?.a2aAgentId || loadingNetworkInfo}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {generatingCommand ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  {t('a2aManagement.im.generating')}
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  {t('a2aManagement.im.generateCommand')}
                </>
              )}
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {t('a2aManagement.im.generateHint')}
            </p>
          </div>

          {generatedCommand && (
            <div className="space-y-3">
              <div className="relative">
                <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm break-all">
                  {generatedCommand}
                </div>
                <button
                  onClick={() => copyToClipboard(generatedCommand)}
                  className="absolute top-2 right-2 p-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                  title={t('a2aManagement.actions.copy')}
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>{t('a2aManagement.im.usage')}:</strong> {t('a2aManagement.im.usageDetail')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-6xl mx-4 h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center">
              <Shield className="w-5 h-5 mr-2" />
              {t('a2aManagement.title')}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('a2aManagement.project')}: {project.name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Tabs */}
          <div className="flex-shrink-0">
            {renderTabs()}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'overview' && renderOverview()}
            {activeTab === 'keys' && renderKeys()}
            {activeTab === 'external' && renderExternal()}
            {activeTab === 'tasks' && renderTasks()}
            {activeTab === 'im' && renderIMIntegration()}
          </div>
        </div>
      </div>
    </div>
  );
};