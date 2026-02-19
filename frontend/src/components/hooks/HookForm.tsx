import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/Button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { EventTypeSelector } from './EventTypeSelector';
import { useCreateHook, useUpdateHook } from '@/hooks/usePlatformHooks';
import type { PlatformHook, HookCreateRequest, HookUpdateRequest } from '@/lib/platformHooksApi';

interface HookFormProps {
  mode: 'create' | 'edit';
  initialData?: PlatformHook;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  name: string;
  description: string;
  event: string;
  actionType: 'shell' | 'script' | 'webhook';
  scope: 'global' | 'project' | 'agent';
  projectId: string;
  agentId: string;
  shellCommand: string;
  shellCwd: string;
  scriptPath: string;
  scriptArgs: string;
  webhookUrl: string;
  webhookMethod: 'GET' | 'POST' | 'PUT';
  webhookHeaders: string;
  webhookBodyTemplate: string;
  timeout: number;
  failurePolicy: 'ignore' | 'warn' | 'abort';
  priority: number;
  enabled: boolean;
}

function hookToFormState(hook: PlatformHook): FormState {
  const base: FormState = {
    name: hook.name,
    description: hook.description ?? '',
    event: hook.event,
    actionType: hook.action.type,
    scope: hook.scope,
    projectId: hook.projectId ?? '',
    agentId: hook.agentId ?? '',
    shellCommand: '',
    shellCwd: '',
    scriptPath: '',
    scriptArgs: '',
    webhookUrl: '',
    webhookMethod: 'POST',
    webhookHeaders: '',
    webhookBodyTemplate: '',
    timeout: hook.timeout,
    failurePolicy: hook.failurePolicy,
    priority: hook.priority,
    enabled: hook.enabled,
  };

  if (hook.action.type === 'shell') {
    base.shellCommand = hook.action.command;
    base.shellCwd = hook.action.cwd ?? '';
  } else if (hook.action.type === 'script') {
    base.scriptPath = hook.action.path;
    base.scriptArgs = hook.action.args?.join(', ') ?? '';
  } else if (hook.action.type === 'webhook') {
    base.webhookUrl = hook.action.url;
    base.webhookMethod = hook.action.method ?? 'POST';
    base.webhookHeaders = hook.action.headers ? JSON.stringify(hook.action.headers, null, 2) : '';
    base.webhookBodyTemplate = hook.action.bodyTemplate ?? '';
  }

  return base;
}

const DEFAULT_STATE: FormState = {
  name: '',
  description: '',
  event: '',
  actionType: 'shell',
  scope: 'global',
  projectId: '',
  agentId: '',
  shellCommand: '',
  shellCwd: '',
  scriptPath: '',
  scriptArgs: '',
  webhookUrl: '',
  webhookMethod: 'POST',
  webhookHeaders: '',
  webhookBodyTemplate: '',
  timeout: 30000,
  failurePolicy: 'warn',
  priority: 10,
  enabled: true,
};

function buildRequest(form: FormState): HookCreateRequest {
  const base = {
    name: form.name,
    description: form.description || undefined,
    event: form.event,
    scope: form.scope,
    projectId: form.scope === 'project' ? form.projectId : undefined,
    agentId: form.scope === 'agent' ? form.agentId : undefined,
    timeout: form.timeout,
    failurePolicy: form.failurePolicy,
    priority: form.priority,
    enabled: form.enabled,
  };

  if (form.actionType === 'shell') {
    return {
      ...base,
      action: {
        type: 'shell',
        command: form.shellCommand,
        ...(form.shellCwd ? { cwd: form.shellCwd } : {}),
      },
    } as HookCreateRequest;
  }

  if (form.actionType === 'script') {
    const args = form.scriptArgs
      ? form.scriptArgs.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    return {
      ...base,
      action: {
        type: 'script',
        path: form.scriptPath,
        runtime: 'node' as const,
        ...(args?.length ? { args } : {}),
      },
    } as HookCreateRequest;
  }

  let headers: Record<string, string> | undefined;
  if (form.webhookHeaders.trim()) {
    try { headers = JSON.parse(form.webhookHeaders); } catch { /* validated elsewhere */ }
  }

  return {
    ...base,
    action: {
      type: 'webhook',
      url: form.webhookUrl,
      method: form.webhookMethod,
      ...(headers ? { headers } : {}),
      ...(form.webhookBodyTemplate ? { bodyTemplate: form.webhookBodyTemplate } : {}),
    },
  } as HookCreateRequest;
}

export const HookForm: React.FC<HookFormProps> = ({ mode, initialData, onClose, onSuccess }) => {
  const { t } = useTranslation('hooks');
  const createMutation = useCreateHook();
  const updateMutation = useUpdateHook();

  const [form, setForm] = useState<FormState>(
    initialData ? hookToFormState(initialData) : DEFAULT_STATE
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');

  const update = (field: keyof FormState, value: string | number | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = t('form.validation.nameRequired');
    else if (form.name.length > 200) e.name = t('form.validation.nameTooLong');
    if (!form.event) e.event = t('form.validation.eventRequired');
    if (form.actionType === 'shell' && !form.shellCommand.trim()) e.shellCommand = t('form.validation.commandRequired');
    if (form.actionType === 'script' && !form.scriptPath.trim()) e.scriptPath = t('form.validation.scriptPathRequired');
    if (form.actionType === 'webhook') {
      if (!form.webhookUrl.trim()) e.webhookUrl = t('form.validation.webhookUrlRequired');
      else if (!/^https?:\/\//.test(form.webhookUrl)) e.webhookUrl = t('form.validation.webhookUrlInvalid');
    }
    if (form.scope === 'project' && !form.projectId.trim()) e.projectId = t('form.validation.projectIdRequired');
    if (form.scope === 'agent' && !form.agentId.trim()) e.agentId = t('form.validation.agentIdRequired');
    if (form.timeout < 1000 || form.timeout > 300000) e.timeout = t('form.validation.timeoutRange');
    if (form.priority < 0 || form.priority > 100) e.priority = t('form.validation.priorityRange');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    if (!validate()) return;

    try {
      if (mode === 'create') {
        await createMutation.mutateAsync(buildRequest(form));
      } else if (initialData) {
        await updateMutation.mutateAsync({ id: initialData.id, data: buildRequest(form) as HookUpdateRequest });
      }
      onSuccess();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('form.createTitle') : t('form.editTitle')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <Label htmlFor="hook-name">{t('form.name')}</Label>
            <Input
              id="hook-name"
              value={form.name}
              onChange={e => update('name', e.target.value)}
              placeholder={t('form.namePlaceholder')}
              className={errors.name ? 'border-red-500' : ''}
            />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="hook-desc">{t('form.description')}</Label>
            <Textarea
              id="hook-desc"
              value={form.description}
              onChange={e => update('description', e.target.value)}
              placeholder={t('form.descriptionPlaceholder')}
              rows={2}
            />
          </div>

          {/* Event type */}
          <div>
            <Label>{t('form.eventType')}</Label>
            <EventTypeSelector value={form.event} onChange={v => update('event', v)} />
            {errors.event && <p className="text-xs text-red-500 mt-1">{errors.event}</p>}
          </div>

          {/* Action type */}
          <div>
            <Label>{t('form.actionType')}</Label>
            <div className="flex gap-2 mt-1">
              {(['shell', 'script', 'webhook'] as const).map(at => (
                <button
                  key={at}
                  type="button"
                  onClick={() => update('actionType', at)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    form.actionType === at
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
                  }`}
                >
                  {t(`form.${at}.label`)}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic action fields */}
          {form.actionType === 'shell' && (
            <div className="space-y-3 pl-3 border-l-2 border-blue-200 dark:border-blue-800">
              <div>
                <Label htmlFor="shell-cmd">{t('form.shell.command')}</Label>
                <Input
                  id="shell-cmd"
                  value={form.shellCommand}
                  onChange={e => update('shellCommand', e.target.value)}
                  placeholder={t('form.shell.commandPlaceholder')}
                  className={`font-mono ${errors.shellCommand ? 'border-red-500' : ''}`}
                />
                {errors.shellCommand && <p className="text-xs text-red-500 mt-1">{errors.shellCommand}</p>}
              </div>
              <div>
                <Label htmlFor="shell-cwd">{t('form.shell.cwd')}</Label>
                <Input
                  id="shell-cwd"
                  value={form.shellCwd}
                  onChange={e => update('shellCwd', e.target.value)}
                  placeholder={t('form.shell.cwdPlaceholder')}
                />
              </div>
            </div>
          )}

          {form.actionType === 'script' && (
            <div className="space-y-3 pl-3 border-l-2 border-blue-200 dark:border-blue-800">
              <div>
                <Label htmlFor="script-path">{t('form.script.path')}</Label>
                <Input
                  id="script-path"
                  value={form.scriptPath}
                  onChange={e => update('scriptPath', e.target.value)}
                  placeholder={t('form.script.pathPlaceholder')}
                  className={errors.scriptPath ? 'border-red-500' : ''}
                />
                {errors.scriptPath && <p className="text-xs text-red-500 mt-1">{errors.scriptPath}</p>}
              </div>
              <div>
                <Label htmlFor="script-args">{t('form.script.args')}</Label>
                <Input
                  id="script-args"
                  value={form.scriptArgs}
                  onChange={e => update('scriptArgs', e.target.value)}
                  placeholder={t('form.script.argsPlaceholder')}
                />
              </div>
            </div>
          )}

          {form.actionType === 'webhook' && (
            <div className="space-y-3 pl-3 border-l-2 border-blue-200 dark:border-blue-800">
              <div>
                <Label htmlFor="webhook-url">{t('form.webhook.url')}</Label>
                <Input
                  id="webhook-url"
                  value={form.webhookUrl}
                  onChange={e => update('webhookUrl', e.target.value)}
                  placeholder={t('form.webhook.urlPlaceholder')}
                  className={errors.webhookUrl ? 'border-red-500' : ''}
                />
                {errors.webhookUrl && <p className="text-xs text-red-500 mt-1">{errors.webhookUrl}</p>}
              </div>
              <div>
                <Label>{t('form.webhook.method')}</Label>
                <Select value={form.webhookMethod} onValueChange={v => update('webhookMethod', v)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="webhook-headers">{t('form.webhook.headers')}</Label>
                <Textarea
                  id="webhook-headers"
                  value={form.webhookHeaders}
                  onChange={e => update('webhookHeaders', e.target.value)}
                  placeholder={t('form.webhook.headersPlaceholder')}
                  rows={2}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="webhook-body">{t('form.webhook.bodyTemplate')}</Label>
                <Textarea
                  id="webhook-body"
                  value={form.webhookBodyTemplate}
                  onChange={e => update('webhookBodyTemplate', e.target.value)}
                  placeholder={t('form.webhook.bodyTemplatePlaceholder')}
                  rows={2}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          )}

          {/* Scope */}
          <div>
            <Label>{t('form.scope')}</Label>
            <div className="flex gap-2 mt-1">
              {(['global', 'project', 'agent'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update('scope', s)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    form.scope === s
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
                  }`}
                >
                  {t(`form.scope${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                </button>
              ))}
            </div>
          </div>

          {form.scope === 'project' && (
            <div>
              <Label htmlFor="project-id">{t('form.projectId')}</Label>
              <Input
                id="project-id"
                value={form.projectId}
                onChange={e => update('projectId', e.target.value)}
                placeholder={t('form.projectIdPlaceholder')}
                className={errors.projectId ? 'border-red-500' : ''}
              />
              {errors.projectId && <p className="text-xs text-red-500 mt-1">{errors.projectId}</p>}
            </div>
          )}

          {form.scope === 'agent' && (
            <div>
              <Label htmlFor="agent-id">{t('form.agentId')}</Label>
              <Input
                id="agent-id"
                value={form.agentId}
                onChange={e => update('agentId', e.target.value)}
                placeholder={t('form.agentIdPlaceholder')}
                className={errors.agentId ? 'border-red-500' : ''}
              />
              {errors.agentId && <p className="text-xs text-red-500 mt-1">{errors.agentId}</p>}
            </div>
          )}

          {/* Execution options */}
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 select-none">
              {t('form.options.title')}
            </summary>
            <div className="mt-3 space-y-3 pl-3 border-l-2 border-gray-200 dark:border-gray-700">
              <div>
                <Label htmlFor="timeout">{t('form.options.timeout')}</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={form.timeout}
                  onChange={e => update('timeout', parseInt(e.target.value, 10) || 30000)}
                  min={1000}
                  max={300000}
                  className={errors.timeout ? 'border-red-500' : ''}
                />
                {errors.timeout && <p className="text-xs text-red-500 mt-1">{errors.timeout}</p>}
              </div>
              <div>
                <Label>{t('form.options.failurePolicy')}</Label>
                <Select value={form.failurePolicy} onValueChange={v => update('failurePolicy', v)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ignore">{t('form.options.failurePolicyIgnore')}</SelectItem>
                    <SelectItem value="warn">{t('form.options.failurePolicyWarn')}</SelectItem>
                    <SelectItem value="abort">{t('form.options.failurePolicyAbort')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="priority">{t('form.options.priority')}</Label>
                <Input
                  id="priority"
                  type="number"
                  value={form.priority}
                  onChange={e => update('priority', parseInt(e.target.value, 10) || 10)}
                  min={0}
                  max={100}
                  className={errors.priority ? 'border-red-500' : ''}
                />
                <p className="text-xs text-gray-500 mt-1">{t('form.options.priorityHelp')}</p>
                {errors.priority && <p className="text-xs text-red-500 mt-1">{errors.priority}</p>}
              </div>
            </div>
          </details>

          {/* Server error */}
          {serverError && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md p-3">
              {serverError}
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('form.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t('form.saving') : t('form.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
