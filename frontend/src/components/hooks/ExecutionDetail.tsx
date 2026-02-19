import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Clock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { HookExecutionRecord } from '@/lib/platformHooksApi';

interface ExecutionDetailProps {
  execution: HookExecutionRecord;
  open: boolean;
  onClose: () => void;
}

export const ExecutionDetail: React.FC<ExecutionDetailProps> = ({ execution, open, onClose }) => {
  const { t } = useTranslation('hooks');
  const { result } = execution;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('history.detail.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Status header */}
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full ${
              result.success
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
            }`}>
              {result.success ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {result.success ? t('test.success') : t('test.failure')}
            </span>
            <span className="text-sm text-gray-500 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {result.duration}ms
            </span>
            {result.timedOut && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                {t('test.timedOut')}
              </span>
            )}
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">{t('history.columns.hookName')}</span>
              <p className="font-medium">{execution.hookName}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">{t('history.columns.eventType')}</span>
              <p className="font-mono text-xs">{execution.eventType}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">{t('history.columns.timestamp')}</span>
              <p>{new Date(execution.timestamp).toLocaleString()}</p>
            </div>
            {result.exitCode !== undefined && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">{t('history.detail.exitCode')}</span>
                <p className="font-mono">{result.exitCode}</p>
              </div>
            )}
            {result.httpStatus !== undefined && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">{t('history.detail.httpStatus')}</span>
                <p className="font-mono">{result.httpStatus}</p>
              </div>
            )}
          </div>

          {/* Output */}
          {result.output && (
            <div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('history.detail.output')}</span>
              <pre className="mt-1 p-3 bg-gray-50 dark:bg-gray-900 rounded-md text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700">
                {result.output}
              </pre>
            </div>
          )}

          {/* Error */}
          {result.error && (
            <div>
              <span className="text-sm font-medium text-red-600 dark:text-red-400">{t('history.detail.error')}</span>
              <pre className="mt-1 p-3 bg-red-50 dark:bg-red-900/20 rounded-md text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
                {result.error}
              </pre>
            </div>
          )}

          {/* No output or error */}
          {!result.output && !result.error && (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">{t('history.detail.noOutput')}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
