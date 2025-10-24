import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showError, showSuccess } from '../../utils/toast';
import { useClaudeVersions, useCreateClaudeVersion, useUpdateClaudeVersion, useDeleteClaudeVersion, useSetDefaultClaudeVersion } from '../../hooks/useClaudeVersions';
import { ClaudeVersion, ClaudeVersionCreate, ClaudeVersionUpdate, ModelConfig } from '../../types/claude-versions';
import { FileBrowser } from '../../components/FileBrowser';
import { type VersionTemplate } from '../../types/versionTemplates';
import { generateClaudeCommand, copyToClipboard } from '../../utils/commandGenerator';
import { useBackendServices } from '../../hooks/useBackendServices';
import { resetClaudeSetup } from '../../utils/onboardingStorage';
import { VersionTemplateSelector } from '../../components/settings/version/VersionTemplateSelector';
import { ClaudeVersionList } from '../../components/settings/version/ClaudeVersionList';
import { ClaudeVersionForm } from '../../components/settings/version/ClaudeVersionForm';
import { ReinitializeSetupButton } from '../../components/settings/version/ReinitializeSetupButton';

export const VersionSettingsPage: React.FC = () => {
  const { t } = useTranslation('pages');
  const { currentServiceId } = useBackendServices();
  
  // Claude版本管理相关状态
  const [isCreating, setIsCreating] = useState(false);
  const [editingVersion, setEditingVersion] = useState<ClaudeVersion | null>(null);
  const [formData, setFormData] = useState<Partial<ClaudeVersionCreate>>({
    name: '',
    alias: '',
    description: '',
    executablePath: '',
    environmentVariables: {},
    models: []
  });
  const [envVarInput, setEnvVarInput] = useState({ key: '', value: '' });
  const [modelInput, setModelInput] = useState({ id: '', name: '', isVision: false });
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [currentTemplateTokenUrl, setCurrentTemplateTokenUrl] = useState<string | null>(null);
  
  // Claude版本数据和操作
  const { data: claudeVersionsData, isLoading: isLoadingClaudeVersions } = useClaudeVersions();
  const createClaudeVersion = useCreateClaudeVersion();
  const updateClaudeVersion = useUpdateClaudeVersion();
  const deleteClaudeVersion = useDeleteClaudeVersion();
  const setDefaultClaudeVersion = useSetDefaultClaudeVersion();


  // Claude版本管理处理函数
  const resetForm = () => {
    setFormData({
      name: '',
      alias: '',
      description: '',
      executablePath: '',
      environmentVariables: {},
      models: []
    });
    setEnvVarInput({ key: '', value: '' });
    setModelInput({ id: '', name: '', isVision: false });
  };

  const handleAddVersion = () => {
    setIsCreating(true);
    setEditingVersion(null);
    resetForm();
  };

  const handleQuickCreateWithTemplate = (template: VersionTemplate) => {
    // 先打开创建表单
    setIsCreating(true);
    setEditingVersion(null);
    resetForm();

    // 然后应用模板
    setTimeout(() => {
      handleApplyTemplate(template);
    }, 0);
  };

  const handleApplyTemplate = (template: VersionTemplate) => {
    // 自动填充所有字段
    const envVars: Record<string, string> = {};
    template.envVars.forEach(envVar => {
      // 所有环境变量都添加，包括空值的必填字段
      envVars[envVar.key] = envVar.value;
    });

    // 使用i18n获取翻译后的名称和描述
    const translatedName = t(`settings.version.templates.providers.${template.id}.name`);
    const translatedDescription = t(`settings.version.templates.providers.${template.id}.description`);

    setFormData(prev => ({
      ...prev,
      name: translatedName,
      alias: template.alias,
      description: translatedDescription,
      environmentVariables: envVars,
      models: template.models || [] // 应用模板的模型配置
    }));

    // 保存模板的 token URL
    setCurrentTemplateTokenUrl(template.apiTokenUrl || null);
  };

  const handleEdit = (version: ClaudeVersion) => {
    setEditingVersion(version);
    setIsCreating(false);
    setFormData({
      name: version.name,
      alias: version.alias,
      description: version.description || '',
      executablePath: version.executablePath,
      environmentVariables: version.environmentVariables || {},
      models: version.models || []
    });
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingVersion(null);
    resetForm();
  };

  const handleReinitializeSetup = () => {
    if (currentServiceId) {
      resetClaudeSetup(currentServiceId);
      showSuccess(t('settings.version.reinitializeSuccess'));
      // Reload page to trigger the setup wizard
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  };

  const addEnvironmentVariable = () => {
    if (envVarInput.key && envVarInput.value) {
      setFormData(prev => ({
        ...prev,
        environmentVariables: {
          ...prev.environmentVariables,
          [envVarInput.key]: envVarInput.value
        }
      }));
      setEnvVarInput({ key: '', value: '' });
    }
  };

  // 模型管理函数
  const addModel = () => {
    if (modelInput.id && modelInput.name) {
      setFormData(prev => ({
        ...prev,
        models: [
          ...(prev.models || []),
          {
            id: modelInput.id,
            name: modelInput.name,
            isVision: modelInput.isVision,
            description: modelInput.name // 使用名称作为默认描述
          }
        ]
      }));
      setModelInput({ id: '', name: '', isVision: false });
    }
  };

  const removeModel = (modelId: string) => {
    setFormData(prev => ({
      ...prev,
      models: (prev.models || []).filter(model => model.id !== modelId)
    }));
  };

  const updateModel = (modelId: string, updates: Partial<ModelConfig>) => {
    setFormData(prev => ({
      ...prev,
      models: (prev.models || []).map(model =>
        model.id === modelId ? { ...model, ...updates } : model
      )
    }));
  };

  const removeEnvironmentVariable = (key: string) => {
    setFormData(prev => {
      if (!prev.environmentVariables) {
        return prev;
      }

      const newEnvVars = { ...prev.environmentVariables };
      delete newEnvVars[key];

      return {
        ...prev,
        environmentVariables: newEnvVars
      };
    });
  };

  const selectExecutablePath = () => {
    setShowFileBrowser(true);
  };

  const handleFileSelect = (path: string, isDirectory: boolean) => {
    if (!isDirectory) {
      setFormData(prev => ({
        ...prev,
        executablePath: path
      }));
    }
    setShowFileBrowser(false);
  };

  const handleSave = async () => {
    try {
      if (!formData.name || !formData.alias) {
        showError(t('settings.version.errors.requiredFields'));
        return;
      }

      // 将空字符串转换为 undefined，以便正确删除字段
      const dataToSave: ClaudeVersionUpdate | ClaudeVersionCreate = {
        ...formData,
        executablePath: formData.executablePath?.trim() || undefined,
        description: formData.description?.trim() || undefined,
      };

      if (editingVersion) {
        // 更新现有版本
        await updateClaudeVersion.mutateAsync({
          id: editingVersion.id,
          data: dataToSave as ClaudeVersionUpdate
        });
        showSuccess(t('settings.version.success.updateVersion'));
      } else {
        // 创建新版本
        await createClaudeVersion.mutateAsync(dataToSave as ClaudeVersionCreate);
        showSuccess(t('settings.version.success.createVersion'));
      }

      handleCancel();
    } catch (error) {
      console.error('Error saving version:', error);
      showError(t('settings.version.errors.saveFailed'), error instanceof Error ? error.message : undefined);
    }
  };

  const handleDelete = async (version: ClaudeVersion) => {
    if (version.isSystem) {
      showError(t('settings.version.errors.cannotDeleteSystem'));
      return;
    }

    if (confirm(t('settings.version.confirmDelete', { alias: version.alias }))) {
      try {
        await deleteClaudeVersion.mutateAsync(version.id);
        showSuccess(t('settings.version.success.deleteVersion'));
      } catch (error) {
        console.error('Error deleting version:', error);
        showError(t('settings.version.errors.deleteFailed'), error instanceof Error ? error.message : undefined);
      }
    }
  };

  const handleSetDefault = async (version: ClaudeVersion) => {
    try {
      await setDefaultClaudeVersion.mutateAsync(version.id);
      showSuccess(t('settings.version.success.setDefault', { alias: version.alias }));
    } catch (error) {
      console.error('Error setting default version:', error);
      showError(t('settings.version.errors.setDefaultFailed'), error instanceof Error ? error.message : undefined);
    }
  };

  const handleCopyCommand = async (version: ClaudeVersion) => {
    try {
      const command = generateClaudeCommand(version);
      const success = await copyToClipboard(command);

      if (success) {
        showSuccess(t('settings.version.success.copyCommand'));
      } else {
        // 如果复制失败，显示命令让用户手动复制
        showError(t('settings.version.errors.copyFailed'), command);
      }
    } catch (error) {
      console.error('Error copying command:', error);
      showError(t('settings.version.errors.copyFailed'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('settings.version.title')}</h2>
          <p className="text-gray-600 dark:text-gray-400">{t('settings.version.subtitle')}</p>
        </div>
        <div className="flex items-center space-x-3">
          <VersionTemplateSelector
            onQuickCreateWithTemplate={handleQuickCreateWithTemplate}
            onAddVersion={handleAddVersion}
          />
          <ReinitializeSetupButton
            onReinitializeSetup={handleReinitializeSetup}
          />
        </div>
      </div>

  
      {/* Claude版本管理 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="space-y-6">

          {/* 版本列表 */}
          <ClaudeVersionList
            versions={claudeVersionsData?.versions || []}
            defaultVersionId={claudeVersionsData?.defaultVersionId || ''}
            isLoading={isLoadingClaudeVersions}
            onCopyCommand={handleCopyCommand}
            onSetDefault={handleSetDefault}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />

        </div>
      </div>

      {/* 创建/编辑版本模态窗口 */}
      {(isCreating || editingVersion) && (
        <ClaudeVersionForm
          editingVersion={editingVersion}
          isCreating={isCreating}
          formData={formData}
          envVarInput={envVarInput}
          modelInput={modelInput}
          currentTemplateTokenUrl={currentTemplateTokenUrl}
          isSaving={createClaudeVersion.isPending || updateClaudeVersion.isPending}
          onApplyTemplate={handleApplyTemplate}
          onCancel={handleCancel}
          onSave={handleSave}
          onSelectExecutablePath={selectExecutablePath}
          onFormDataChange={setFormData}
          onEnvVarInputChange={setEnvVarInput}
          onModelInputChange={setModelInput}
          onAddEnvironmentVariable={addEnvironmentVariable}
          onUpdateEnvironmentVariable={(key, value) => {
            setFormData(prev => ({
              ...prev,
              environmentVariables: {
                ...prev.environmentVariables,
                [key]: value
              }
            }));
          }}
          onRemoveEnvironmentVariable={removeEnvironmentVariable}
          onAddModel={addModel}
          onUpdateModel={updateModel}
          onRemoveModel={removeModel}
        />
      )}

      {/* FileBrowser 组件 */}
      {showFileBrowser && (
        <FileBrowser
          title={t('settings.version.form.selectExecutable')}
          allowFiles={true}
          allowDirectories={false}
          onSelect={handleFileSelect}
          onClose={() => setShowFileBrowser(false)}
        />
      )}
    </div>
  );
};