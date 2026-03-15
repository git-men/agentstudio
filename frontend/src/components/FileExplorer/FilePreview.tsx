import React, { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaFile } from 'react-icons/fa';
import { VscCode } from 'react-icons/vsc';
import { Loader2, Code2, MonitorPlay } from 'lucide-react';

// 动态导入Monaco Editor
const Editor = React.lazy(() => import('@monaco-editor/react'));

import { ImagePreview } from './ImagePreview';
import { FileTab } from './fileTypes';
import { getLanguageForFile, getFileType } from './fileTypes';

const isHtmlFile = (fileName: string): boolean => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return ext === 'html' || ext === 'htm';
};

interface FilePreviewProps {
  activeTab: FileTab | null;
  fileContentData?: { content: string };
  isContentLoading: boolean;
  contentError: Error | null;
  isDarkMode: boolean;
  projectPath?: string;
  apiUrl: string;
}

export const FilePreview: React.FC<FilePreviewProps> = ({
  activeTab,
  fileContentData,
  isContentLoading,
  contentError,
  isDarkMode,
  projectPath,
  apiUrl
}) => {
  const { t } = useTranslation('components');
  const [htmlPreviewMode, setHtmlPreviewMode] = useState<'source' | 'preview'>('preview');

  if (!activeTab) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        <div className="text-center">
          <FaFile className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <p>{t('fileExplorer.selectFile')}</p>
        </div>
      </div>
    );
  }

  if (isContentLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center space-x-2 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>{t('fileExplorer.loading')}</span>
        </div>
      </div>
    );
  }

  if (contentError) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 dark:text-red-400">
        <div className="text-center">
          <p className="font-medium">{t('fileExplorer.loadFailed')}</p>
          <p className="text-sm mt-2 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded border border-red-200 dark:border-red-800">
            {contentError.message}
          </p>
          <p className="text-xs mt-2 text-gray-500 dark:text-gray-400">
            {activeTab.path}
          </p>
        </div>
      </div>
    );
  }

  const fileType = getFileType(activeTab.name);

  switch (fileType) {
    case 'image': {
      const imageParams = new URLSearchParams();
      imageParams.append('path', activeTab.path);
      if (projectPath) {
        imageParams.append('projectPath', projectPath);
      }
      imageParams.append('binary', 'true');
      const imageUrl = `${apiUrl}/files/read?${imageParams.toString()}`;
      
      return <ImagePreview imageUrl={imageUrl} fileName={activeTab.name} />;
    }

    case 'text': {
      if (!fileContentData) {
        return (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <p>{t('fileExplorer.cannotReadFile')}</p>
          </div>
        );
      }

      const isHtml = isHtmlFile(activeTab.name);

      return (
        <div className="flex flex-col h-full">
          {isHtml && (
            <div className="flex items-center px-3 py-1 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div className="flex items-center bg-gray-200 dark:bg-gray-700 rounded-md p-0.5">
                <button
                  onClick={() => setHtmlPreviewMode('source')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    htmlPreviewMode === 'source'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  {t('fileExplorer.sourceCode', 'Source')}
                </button>
                <button
                  onClick={() => setHtmlPreviewMode('preview')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    htmlPreviewMode === 'preview'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  <MonitorPlay className="w-3.5 h-3.5" />
                  {t('fileExplorer.preview', 'Preview')}
                </button>
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0">
            {isHtml && htmlPreviewMode === 'preview' ? (
              <iframe
                srcDoc={fileContentData.content}
                sandbox="allow-scripts"
                className="w-full h-full border-0 bg-white"
                title={`${activeTab.name} preview`}
              />
            ) : (
              <Suspense fallback={
                <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
                </div>
              }>
                <Editor
                  height="100%"
                  theme={isDarkMode ? 'vs-dark' : 'vs-light'}
                  language={getLanguageForFile(activeTab.name)}
                  value={fileContentData.content}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 14,
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                  }}
                />
              </Suspense>
            )}
          </div>
        </div>
      );
    }

    default:
      return (
        <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <VscCode className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
            <p>{t('fileExplorer.previewNotSupported')}</p>
            <p className="text-sm mt-2">{t('fileExplorer.fileLabel')}: {activeTab.name}</p>
          </div>
        </div>
      );
  }
};