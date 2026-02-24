import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useTestHook } from '@/hooks/usePlatformHooks';
import type { PlatformHook, TestHookResponse } from '@/lib/platformHooksApi';

interface HookTestButtonProps {
  hook: PlatformHook;
}

export const HookTestButton: React.FC<HookTestButtonProps> = ({ hook }) => {
  const { t } = useTranslation('hooks');
  const testMutation = useTestHook();
  const [result, setResult] = useState<TestHookResponse | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const handleTest = () => {
    setResult(null);
    if (hideTimer.current) clearTimeout(hideTimer.current);

    testMutation.mutate(hook.id, {
      onSuccess: (data) => {
        setResult(data);
        hideTimer.current = setTimeout(() => setResult(null), 10000);
      },
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleTest}
        disabled={testMutation.isPending}
        aria-label={t('actions.test')}
        className="h-8 w-8"
      >
        {testMutation.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
      </Button>

      {result && (
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
          result.result.success
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
        }`}>
          {result.result.success ? (
            <CheckCircle className="w-3 h-3" />
          ) : (
            <XCircle className="w-3 h-3" />
          )}
          {result.result.success ? t('test.success') : t('test.failure')}
          <span className="text-gray-500 dark:text-gray-400 ml-1">
            {t('test.duration', { ms: result.result.duration })}
          </span>
          {result.result.timedOut && (
            <span className="text-amber-600 dark:text-amber-400 ml-1">{t('test.timedOut')}</span>
          )}
        </span>
      )}
    </div>
  );
};
