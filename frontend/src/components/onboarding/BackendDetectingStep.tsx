import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

export const BackendDetectingStep: React.FC = () => {
  const { t } = useTranslation('onboarding');

  return (
    <div className="text-center py-8 space-y-6">
      <Loader2 className="w-12 h-12 mx-auto animate-spin text-blue-600 dark:text-blue-400" />
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {t('backend.detecting.title')}
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          {t('backend.detecting.description')}
        </p>
      </div>

      {/* Detecting endpoints */}
      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 space-y-2 text-left">
        <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
          <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
          <span>http://127.0.0.1:4936</span>
        </div>
        <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
          <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
          <span>http://localhost:4936</span>
        </div>
      </div>
    </div>
  );
};
