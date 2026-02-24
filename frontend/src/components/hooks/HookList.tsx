import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Terminal,
  FileCode,
  Globe,
  FolderOpen,
  Bot,
  Webhook,
  Edit,
  Trash2,
  Play,
  RefreshCw,
  Package,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/Button';
import { usePlatformHooks, useToggleHook, useTestHook, useDeleteHook } from '@/hooks/usePlatformHooks';
import { HookDeleteConfirm } from './HookDeleteConfirm';
import { HookTestButton } from './HookTestButton';
import type { PlatformHook, HookListFilter } from '@/lib/platformHooksApi';

interface HookListProps {
  filters: HookListFilter;
  onFiltersChange: (filters: HookListFilter) => void;
  onEdit: (hook: PlatformHook) => void;
}

const EVENT_CATEGORIES = ['run', 'message', 'tool', 'task', 'schedule', 'system'] as const;

const ACTION_ICON: Record<string, React.ReactNode> = {
  shell: <Terminal className="w-3.5 h-3.5" />,
  script: <FileCode className="w-3.5 h-3.5" />,
  webhook: <Webhook className="w-3.5 h-3.5" />,
};

const SCOPE_ICON: Record<string, React.ReactNode> = {
  global: <Globe className="w-3.5 h-3.5" />,
  project: <FolderOpen className="w-3.5 h-3.5" />,
  agent: <Bot className="w-3.5 h-3.5" />,
};

export const HookList: React.FC<HookListProps> = ({ filters, onFiltersChange, onEdit }) => {
  const { t } = useTranslation('hooks');
  const { data: hooks = [], isLoading } = usePlatformHooks(filters);
  const toggleMutation = useToggleHook();
  const deleteMutation = useDeleteHook();

  const [eventCategory, setEventCategory] = useState<string>('');
  const [deletingHook, setDeletingHook] = useState<PlatformHook | null>(null);

  const filteredHooks = useMemo(() => {
    if (!eventCategory) return hooks;
    return hooks.filter(h => h.event.startsWith(eventCategory + '.'));
  }, [hooks, eventCategory]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <Select
          value={filters.scope ?? ''}
          onValueChange={(v) => onFiltersChange({ ...filters, scope: v ? v as HookListFilter['scope'] : undefined })}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('list.filters.allScopes')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('list.filters.allScopes')}</SelectItem>
            <SelectItem value="global">{t('scope.global')}</SelectItem>
            <SelectItem value="project">{t('scope.project')}</SelectItem>
            <SelectItem value="agent">{t('scope.agent')}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={eventCategory}
          onValueChange={setEventCategory}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('list.filters.allCategories')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('list.filters.allCategories')}</SelectItem>
            {EVENT_CATEGORIES.map(cat => (
              <SelectItem key={cat} value={cat}>{t(`events.categories.${cat}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table or empty state */}
      {filteredHooks.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <Webhook className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {t('list.emptyState.title')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {t('list.emptyState.description')}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('list.columns.name')}</TableHead>
                <TableHead>{t('list.columns.eventType')}</TableHead>
                <TableHead>{t('list.columns.actionType')}</TableHead>
                <TableHead>{t('list.columns.scope')}</TableHead>
                <TableHead>{t('list.columns.source', '来源')}</TableHead>
                <TableHead>{t('list.columns.enabled')}</TableHead>
                <TableHead className="text-right">{t('list.columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredHooks.map(hook => {
                const category = hook.event.split('.')[0];
                const isMarketplace = hook.source?.type === 'marketplace';
                return (
                  <TableRow key={hook.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{hook.name}</div>
                        {hook.description && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs" title={hook.description}>
                            {hook.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          {t(`events.categories.${category}`, category)}
                        </span>
                        <code className="text-xs text-gray-600 dark:text-gray-400">{hook.event}</code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                        {ACTION_ICON[hook.action.type]}
                        {t(`actionType.${hook.action.type}`)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                        {SCOPE_ICON[hook.scope]}
                        {t(`scope.${hook.scope}`)}
                        {hook.scope === 'project' && hook.projectId && (
                          <span className="text-gray-500">: {hook.projectId}</span>
                        )}
                        {hook.scope === 'agent' && hook.agentId && (
                          <span className="text-gray-500">: {hook.agentId}</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      {isMarketplace ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                          title={`${hook.source!.marketplace}/${hook.source!.plugin}`}
                        >
                          <Package className="w-3 h-3" />
                          {hook.source!.plugin}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">{t('list.source.manual', '手动')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={hook.enabled}
                        onCheckedChange={(checked) => toggleMutation.mutate({ id: hook.id, enabled: checked })}
                        aria-label={t('actions.toggle')}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <HookTestButton hook={hook} />
                        {isMarketplace ? (
                          <span
                            className="text-xs text-gray-400 px-2"
                            title={t('list.source.managedByMarketplace', '由 Marketplace 管理')}
                          >
                            {t('list.source.managed', 'Marketplace')}
                          </span>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onEdit(hook)}
                              aria-label={t('actions.edit')}
                              className="h-8 w-8"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingHook(hook)}
                              aria-label={t('actions.delete')}
                              className="h-8 w-8 text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {deletingHook && (
        <HookDeleteConfirm
          hook={deletingHook}
          open={!!deletingHook}
          onClose={() => setDeletingHook(null)}
          onConfirm={() => {
            deleteMutation.mutate(deletingHook.id, {
              onSuccess: () => setDeletingHook(null),
            });
          }}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
};
