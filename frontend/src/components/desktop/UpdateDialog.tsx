import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Download, X, RefreshCw, AlertCircle } from 'lucide-react';

export interface UpdatePayload {
  version: string;
  notes: string;
}

interface UpdateDialogProps {
  version: string;
  notes: string;
  onDismiss: () => void;
}

type InstallState = 'idle' | 'downloading' | 'error';

export const UpdateDialog: React.FC<UpdateDialogProps> = ({
  version,
  notes,
  onDismiss,
}) => {
  const [installState, setInstallState] = useState<InstallState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleInstall = async () => {
    setInstallState('downloading');
    setErrorMessage('');
    try {
      await invoke('install_update');
    } catch (err) {
      setInstallState('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRetry = () => {
    handleInstall();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={`发现新版本 v${version}`}
    >
      <div className="relative w-full max-w-md rounded-xl bg-white dark:bg-gray-900 shadow-2xl p-6 mx-4">
        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
          aria-label="关闭"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
            <Download className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              发现新版本
            </h2>
            <p className="text-sm text-blue-600 dark:text-blue-400 font-mono">
              v{version}
            </p>
          </div>
        </div>

        {/* Release notes */}
        {notes && (
          <div className="mb-5 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
            {notes}
          </div>
        )}

        {/* Error state */}
        {installState === 'error' && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">下载失败</p>
              {errorMessage && (
                <p className="mt-0.5 text-xs opacity-80">{errorMessage}</p>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          {installState === 'error' ? (
            <>
              <button
                onClick={handleRetry}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                重试
              </button>
              <button
                onClick={onDismiss}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors"
              >
                稍后提醒
              </button>
            </>
          ) : installState === 'downloading' ? (
            <button
              disabled
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 opacity-75 text-white text-sm font-medium cursor-not-allowed"
            >
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              正在下载...
            </button>
          ) : (
            <>
              <button
                onClick={handleInstall}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                立即更新
              </button>
              <button
                onClick={onDismiss}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors"
              >
                稍后提醒
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
