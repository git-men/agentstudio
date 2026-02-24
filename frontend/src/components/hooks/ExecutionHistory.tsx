import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, RefreshCw, ChevronLeft, ChevronRight, History } from 'lucide-react';
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
import { Button } from '@/components/ui/Button';
import { useExecutionHistory, usePlatformHooks } from '@/hooks/usePlatformHooks';
import { ExecutionDetail } from './ExecutionDetail';
import type { HookExecutionRecord } from '@/lib/platformHooksApi';
import type { ExecutionHistoryFilter } from '@/lib/platformHooksApi';

const PAGE_SIZE = 50;

function formatTimeAgo(timestamp: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('history.timeAgo.justNow');
  if (minutes < 60) return t('history.timeAgo.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('history.timeAgo.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('history.timeAgo.daysAgo', { count: days });
}

export const ExecutionHistory: React.FC = () => {
  const { t } = useTranslation('hooks');
  const { data: hooks = [] } = usePlatformHooks();

  const [filters, setFilters] = useState<ExecutionHistoryFilter>({});
  const [offset, setOffset] = useState(0);
  const [selectedExecution, setSelectedExecution] = useState<HookExecutionRecord | null>(null);

  const { data, isLoading } = useExecutionHistory(filters, { limit: PAGE_SIZE, offset });

  const executions = data?.executions ?? [];
  const total = data?.total ?? 0;

  if (isLoading && executions.length === 0) {
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
          value={filters.hookId ?? ''}
          onValueChange={v => { setFilters({ ...filters, hookId: v || undefined }); setOffset(0); }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t('history.filters.allHooks')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('history.filters.allHooks')}</SelectItem>
            {hooks.map(h => (
              <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.success === undefined ? '' : String(filters.success)}
          onValueChange={v => {
            setFilters({
              ...filters,
              success: v === '' ? undefined : v === 'true',
            });
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t('history.filters.allStatuses')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('history.filters.allStatuses')}</SelectItem>
            <SelectItem value="true">{t('history.filters.success')}</SelectItem>
            <SelectItem value="false">{t('history.filters.failed')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {executions.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <History className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {t('history.emptyState.title')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {t('history.emptyState.description')}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('history.columns.hookName')}</TableHead>
                  <TableHead>{t('history.columns.eventType')}</TableHead>
                  <TableHead>{t('history.columns.timestamp')}</TableHead>
                  <TableHead>{t('history.columns.duration')}</TableHead>
                  <TableHead>{t('history.columns.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map(exec => (
                  <TableRow
                    key={exec.id}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    onClick={() => setSelectedExecution(exec)}
                  >
                    <TableCell className="font-medium">{exec.hookName}</TableCell>
                    <TableCell>
                      <code className="text-xs text-gray-600 dark:text-gray-400">{exec.eventType}</code>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500" title={exec.timestamp}>
                      {formatTimeAgo(exec.timestamp, t)}
                    </TableCell>
                    <TableCell className="text-sm">{exec.result.duration}ms</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        exec.result.success
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      }`}>
                        {exec.result.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {exec.result.success ? t('history.filters.success') : t('history.filters.failed')}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-gray-500">
                {t('history.pagination.showing', {
                  from: offset + 1,
                  to: Math.min(offset + PAGE_SIZE, total),
                  total,
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  {t('history.pagination.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total}
                >
                  {t('history.pagination.next')}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {selectedExecution && (
        <ExecutionDetail
          execution={selectedExecution}
          open={!!selectedExecution}
          onClose={() => setSelectedExecution(null)}
        />
      )}
    </div>
  );
};
