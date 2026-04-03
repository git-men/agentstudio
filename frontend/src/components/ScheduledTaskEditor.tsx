import React, { useState, useEffect, useMemo } from 'react';
import { Save, Clock, Bot, FolderOpen, MessageSquare, Play, Cpu, ChevronDown, Bell, Check, Globe, Settings } from 'lucide-react';
import { useCreateScheduledTask, useUpdateScheduledTask, useRunScheduledTask } from '../hooks/useScheduledTasks';
import { useProjects } from '../hooks/useProjects';
import { useClaudeVersions } from '../hooks/useClaudeVersions';
import type {
  ScheduledTask,
  CreateScheduledTaskRequest,
  TaskSchedule,
  ModelOverride,
  NotificationConfig,
  NotificationStrategy,
} from '../types/scheduledTasks';
import type { AgentConfig } from '../types/index';
import { CRON_PRESETS, DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from '../types/scheduledTasks';
import { showSuccess, showError } from '../utils/toast';

const formatDateTimeLocal = (isoString?: string): string => {
  const date = isoString ? new Date(isoString) : new Date();
  if (!isoString) {
    date.setHours(date.getHours() + 1);
    date.setMinutes(0);
    date.setSeconds(0);
    date.setMilliseconds(0);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const getLocalNow = (): string => formatDateTimeLocal();

const parseDateTimeLocal = (value: string): string => {
  return new Date(value).toISOString();
};

// Compact toggle component
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; size?: 'sm' | 'md' }> = ({ checked, onChange, size = 'sm' }) => {
  const h = size === 'md' ? 'h-6 w-11' : 'h-5 w-9';
  const dot = size === 'md' ? 'h-4 w-4' : 'h-3 w-3';
  const translate = size === 'md' ? 'translate-x-6' : 'translate-x-5';
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex ${h} items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
    >
      <span className={`inline-block ${dot} transform rounded-full bg-white transition-transform ${checked ? translate : 'translate-x-1'}`} />
    </button>
  );
};

interface ScheduledTaskEditorProps {
  task: ScheduledTask | null;
  agents: AgentConfig[];
  onSave: () => void;
  onCancel: () => void;
}

export const ScheduledTaskEditor: React.FC<ScheduledTaskEditorProps> = ({
  task,
  agents,
  onSave,
  onCancel,
}) => {
  const isEditing = !!task;
  const createTask = useCreateScheduledTask();
  const updateTask = useUpdateScheduledTask();
  const runTask = useRunScheduledTask();
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects || [];
  const { data: claudeVersionsData } = useClaudeVersions();

  // Form state
  const [name, setName] = useState(task?.name || '');
  const [description, setDescription] = useState(task?.description || '');
  const [agentId, setAgentId] = useState(task?.agentId || '');
  const [projectPath, setProjectPath] = useState(task?.projectPath || '');
  const [scheduleType, setScheduleType] = useState<'interval' | 'cron' | 'once'>(task?.schedule.type || 'interval');
  const [intervalMinutes, setIntervalMinutes] = useState(task?.schedule.intervalMinutes || 30);
  const [cronExpression, setCronExpression] = useState(task?.schedule.cronExpression || '*/30 * * * *');
  const [executeAt, setExecuteAt] = useState(formatDateTimeLocal(task?.schedule.executeAt));
  const [timezone, setTimezone] = useState(task?.schedule.timezone || DEFAULT_TIMEZONE);
  const [triggerMessage, setTriggerMessage] = useState(task?.triggerMessage || '');
  const [enabled, setEnabled] = useState(task?.enabled ?? true);

  // Model override
  const [overrideModel, setOverrideModel] = useState(!!task?.modelOverride?.modelId);
  const [selectedVersionId, setSelectedVersionId] = useState(task?.modelOverride?.versionId || '');
  const [selectedModelId, setSelectedModelId] = useState(task?.modelOverride?.modelId || '');

  // Notification
  const [notifyEnabled, setNotifyEnabled] = useState(task?.notification?.enabled ?? false);
  const [notifyStrategy, setNotifyStrategy] = useState<NotificationStrategy>(task?.notification?.strategy ?? 'always');

  // Advanced
  const [timeoutMinutes, setTimeoutMinutes] = useState(task?.timeoutMs ? Math.round(task.timeoutMs / 60000) : 30);
  const [maxTurns, setMaxTurns] = useState(task?.maxTurns || 0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);

  const availableModels = useMemo(() => {
    if (!claudeVersionsData?.versions) return [];
    if (selectedVersionId) {
      const version = claudeVersionsData.versions.find(v => v.id === selectedVersionId);
      return version?.models || [];
    }
    const defaultVersion = claudeVersionsData.versions.find(v => v.id === claudeVersionsData.defaultVersionId) || claudeVersionsData.versions[0];
    return defaultVersion?.models || [];
  }, [claudeVersionsData, selectedVersionId]);

  useEffect(() => {
    if (overrideModel && claudeVersionsData?.versions && selectedVersionId) {
      const versionExists = claudeVersionsData.versions.some(v => v.id === selectedVersionId);
      if (!versionExists) {
        setSelectedVersionId(claudeVersionsData.defaultVersionId || '');
        setSelectedModelId('');
      }
    }
  }, [claudeVersionsData, selectedVersionId, overrideModel]);

  useEffect(() => {
    if (overrideModel && availableModels.length > 0) {
      if (!availableModels.some(m => m.id === selectedModelId)) {
        setSelectedModelId(availableModels[0].id);
      }
    }
  }, [availableModels, selectedModelId, overrideModel]);

  useEffect(() => { if (!agentId && agents.length > 0) setAgentId(agents[0].id); }, [agentId, agents]);
  useEffect(() => { if (!projectPath && projects.length > 0) setProjectPath(projects[0].path); }, [projectPath, projects]);

  const buildSchedule = (): TaskSchedule => {
    if (scheduleType === 'interval') return { type: 'interval', intervalMinutes };
    if (scheduleType === 'once') return { type: 'once', executeAt: parseDateTimeLocal(executeAt) };
    return { type: 'cron', cronExpression, timezone };
  };

  const buildModelOverride = (): ModelOverride | undefined => {
    if (!overrideModel || !selectedModelId) return undefined;
    return { versionId: selectedVersionId || undefined, modelId: selectedModelId };
  };

  const buildNotification = (): NotificationConfig | undefined => {
    if (!notifyEnabled) return undefined;
    return { enabled: true, strategy: notifyStrategy };
  };

  const buildPayload = () => ({
    name: name.trim(),
    description: description.trim() || undefined,
    agentId,
    projectPath,
    schedule: buildSchedule(),
    triggerMessage: triggerMessage.trim(),
    enabled,
    modelOverride: buildModelOverride(),
    notification: buildNotification(),
    timeoutMs: timeoutMinutes > 0 ? timeoutMinutes * 60000 : undefined,
    maxTurns: maxTurns > 0 ? maxTurns : undefined,
  });

  const validate = (): boolean => {
    if (!name.trim()) { showError('请输入任务名称'); return false; }
    if (!agentId) { showError('请选择 Agent'); return false; }
    if (!projectPath) { showError('请选择项目路径'); return false; }
    if (!triggerMessage.trim()) { showError('请输入触发消息'); return false; }
    if (scheduleType === 'interval' && (!intervalMinutes || intervalMinutes < 1)) { showError('间隔时间必须大于 0'); return false; }
    if (scheduleType === 'cron' && !cronExpression.trim()) { showError('请输入 Cron 表达式'); return false; }
    if (scheduleType === 'once') {
      const t = new Date(executeAt).getTime();
      if (isNaN(t)) { showError('请选择有效的执行时间'); return false; }
      if (t <= Date.now()) { showError('执行时间必须在未来'); return false; }
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    try {
      if (isEditing) {
        await updateTask.mutateAsync({ taskId: task.id, data: buildPayload() });
        showSuccess('任务已更新');
      } else {
        await createTask.mutateAsync(buildPayload() as CreateScheduledTaskRequest);
        showSuccess('任务已创建');
      }
      onSave();
    } catch { showError(isEditing ? '更新失败' : '创建失败'); }
    finally { setIsSaving(false); }
  };

  const handleSaveAndRun = async () => {
    if (!validate()) return;
    setIsRunning(true);
    try {
      let taskId: string;
      if (isEditing) {
        await updateTask.mutateAsync({ taskId: task.id, data: buildPayload() });
        taskId = task.id;
      } else {
        const newTask = await createTask.mutateAsync(buildPayload() as CreateScheduledTaskRequest);
        taskId = newTask.id;
      }
      await runTask.mutateAsync(taskId);
      showSuccess('任务已开始执行');
      onSave();
    } catch { showError('操作失败'); }
    finally { setIsRunning(false); }
  };

  const selectedAgent = agents.find(a => a.id === agentId);
  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
              {isEditing ? '编辑定时任务' : '创建定时任务'}
            </h1>
            <div className="flex items-center gap-2">
              <Toggle checked={enabled} onChange={setEnabled} size="md" />
              <span className={`text-xs font-medium ${enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                {enabled ? '已启用' : '已禁用'}
              </span>
            </div>
          </div>
          <button onClick={onCancel} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* ── Body: Two-Column Layout ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x divide-gray-200 dark:divide-gray-700">

            {/* ══ Left Column: Schedule & Message ══ */}
            <div className="p-6 space-y-5">

              {/* Name + Description */}
              <div className="space-y-3">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="任务名称 *"
                  className="w-full px-3 py-2.5 text-base font-medium border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-400"
                />
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述（可选）"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-400"
                />
              </div>

              {/* Schedule Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-500" />
                  调度规则
                </h3>

                {/* Type tabs */}
                <div className="flex bg-gray-100 dark:bg-gray-700/50 rounded-lg p-0.5">
                  {([
                    { value: 'interval' as const, label: '间隔' },
                    { value: 'cron' as const, label: 'Cron' },
                    { value: 'once' as const, label: '单次' },
                  ]).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setScheduleType(opt.value)}
                      className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                        scheduleType === opt.value
                          ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Interval */}
                {scheduleType === 'interval' && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">每</span>
                    <input
                      type="number"
                      min={1} max={10080}
                      value={intervalMinutes}
                      onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 30)}
                      className="w-24 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-center"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-400">分钟执行一次</span>
                  </div>
                )}

                {/* Cron */}
                {scheduleType === 'cron' && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={cronExpression}
                        onChange={(e) => setCronExpression(e.target.value)}
                        placeholder="*/30 * * * *"
                        className="flex-1 px-3 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                      />
                      {/* Timezone selector */}
                      <div className="relative">
                        <select
                          value={timezone}
                          onChange={(e) => setTimezone(e.target.value)}
                          className="appearance-none pl-7 pr-6 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 cursor-pointer"
                        >
                          {TIMEZONE_OPTIONS.map(tz => (
                            <option key={tz.value} value={tz.value}>{tz.label}</option>
                          ))}
                        </select>
                        <Globe className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {CRON_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setCronExpression(preset.value)}
                          className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                            cronExpression === preset.value
                              ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300'
                              : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Once */}
                {scheduleType === 'once' && (
                  <div>
                    <input
                      type="datetime-local"
                      value={executeAt}
                      onChange={(e) => setExecuteAt(e.target.value)}
                      min={getLocalNow()}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-xs text-gray-400">执行一次后自动禁用（使用浏览器本地时区）</p>
                  </div>
                )}
              </div>

              {/* Trigger Message */}
              <div className="space-y-2 flex-1">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-green-500" />
                  触发消息
                </h3>
                <textarea
                  value={triggerMessage}
                  onChange={(e) => setTriggerMessage(e.target.value)}
                  placeholder="请检查代码质量并生成报告..."
                  rows={8}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
                />
                <p className="text-xs text-gray-400">定时触发时发送给 Agent 的消息</p>
              </div>
            </div>

            {/* ══ Right Column: Execution & Options ══ */}
            <div className="p-6 space-y-5">

              {/* Agent Selector */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Bot className="w-4 h-4 text-purple-500" />
                  执行配置
                </h3>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAgentDropdown(v => !v)}
                    className="w-full flex items-center gap-3 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition-colors"
                  >
                    {selectedAgent ? (
                      <>
                        <span className="text-lg flex-shrink-0">{selectedAgent.ui?.icon || '🤖'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{selectedAgent.name}</div>
                          {selectedAgent.description && <div className="text-xs text-gray-400 truncate">{selectedAgent.description}</div>}
                        </div>
                      </>
                    ) : (
                      <span className="text-sm text-gray-400 flex-1">选择 Agent</span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${showAgentDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showAgentDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowAgentDropdown(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 max-h-48 overflow-y-auto">
                        {agents.map((agent) => (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => { setAgentId(agent.id); setShowAgentDropdown(false); }}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors first:rounded-t-lg last:rounded-b-lg ${agentId === agent.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                          >
                            <span className="text-lg flex-shrink-0">{agent.ui?.icon || '🤖'}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{agent.name}</div>
                              {agent.description && <div className="text-xs text-gray-400 line-clamp-1">{agent.description}</div>}
                            </div>
                            {agentId === agent.id && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Project */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    <FolderOpen className="w-3 h-3 inline mr-1" />项目路径
                  </label>
                  <select
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    {projects.map((project) => (
                      <option key={project.path} value={project.path}>{project.name || project.path}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Model Override */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOverrideModel(!overrideModel)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">覆盖模型</span>
                  </div>
                  <Toggle checked={overrideModel} onChange={setOverrideModel} />
                </button>

                {overrideModel && (
                  <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-gray-700 pt-2">
                    {claudeVersionsData?.versions && claudeVersionsData.versions.length > 1 && (
                      <select
                        value={selectedVersionId}
                        onChange={(e) => setSelectedVersionId(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      >
                        <option value="">默认供应商</option>
                        {claudeVersionsData.versions.map(v => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    )}
                    {availableModels.length > 0 && (
                      <div className="grid grid-cols-2 gap-1.5">
                        {availableModels.map(model => (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => setSelectedModelId(model.id)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-all ${
                              selectedModelId === model.id
                                ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300'
                                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                            }`}
                          >
                            <Cpu className="w-3 h-3 opacity-60" />
                            <span className="font-medium truncate">{model.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Notification */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setNotifyEnabled(!notifyEnabled)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">IM 通知</span>
                  </div>
                  <Toggle checked={notifyEnabled} onChange={setNotifyEnabled} />
                </button>

                {notifyEnabled && (
                  <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700 pt-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      {([
                        { value: 'always' as const, label: '始终通知' },
                        { value: 'on_success' as const, label: '成功时' },
                        { value: 'on_error' as const, label: '失败时' },
                        { value: 'agent_decided' as const, label: 'Agent 决定' },
                      ]).map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setNotifyStrategy(opt.value)}
                          className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                            notifyStrategy === opt.value
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                              : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Advanced (collapsible) */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">高级配置</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                </button>

                {showAdvanced && (
                  <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700 pt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">超时（分钟）</label>
                        <input
                          type="number" min={1} max={120}
                          value={timeoutMinutes}
                          onChange={(e) => setTimeoutMinutes(parseInt(e.target.value) || 30)}
                          className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">最大轮次（0=默认）</label>
                        <input
                          type="number" min={0} max={200}
                          value={maxTurns}
                          onChange={(e) => setMaxTurns(parseInt(e.target.value) || 0)}
                          className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer Actions ── */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleSaveAndRun}
              disabled={isSaving || isRunning}
              className="inline-flex items-center px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 mr-1.5" />
              {isRunning ? '执行中...' : '保存并执行'}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isRunning}
              className="inline-flex items-center px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScheduledTaskEditor;
