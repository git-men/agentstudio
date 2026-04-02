import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import { showError } from '../utils/toast';
import { CSVPreview } from './CSVPreview';
import { JSONLPreview } from './JSONLPreview';
import { useMobileContext } from '../contexts/MobileContext';
import {
  Folder,
  File,
  ArrowUp,
  Home,
  X,
  Eye,
  EyeOff,
  ChevronRight,
  FolderPlus,
  FileText,
  FileJson,
  CheckSquare,
  Square
} from 'lucide-react';

const LAST_BROWSE_PATH_KEY = 'fileBrowser_lastBrowsePath';

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number | null;
  modified: string;
  isHidden: boolean;
}

interface FileBrowserData {
  currentPath: string;
  parentPath: string | null;
  items: FileItem[];
}

interface FileBrowserProps {
  title?: string;
  initialPath?: string;
  allowFiles?: boolean;
  allowDirectories?: boolean;
  allowNewDirectory?: boolean;
  restrictToProject?: boolean;
  multiSelect?: boolean;
  onSelect: (path: string, isDirectory: boolean) => void;
  onMultiSelect?: (items: { path: string; isDirectory: boolean }[]) => void;
  onClose: () => void;
}

export const FileBrowser: React.FC<FileBrowserProps> = ({
  title,
  initialPath,
  allowFiles = true,
  allowDirectories = true,
  allowNewDirectory = false,
  restrictToProject = false,
  multiSelect = false,
  onSelect,
  onMultiSelect,
  onClose
}) => {
  const { t } = useTranslation('components');
  const { isMobile } = useMobileContext();
  const [data, setData] = useState<FileBrowserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Map<string, boolean>>(new Map());
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [csvPreviewPath, setCsvPreviewPath] = useState<string | null>(null);
  const [jsonlPreviewPath, setJsonlPreviewPath] = useState<string | null>(null);

  const fetchDirectory = async (path?: string) => {
    setLoading(true);
    setError(null);

    try {
      const searchParams = new URLSearchParams();
      if (path) {
        searchParams.set('path', path);
      }

      const url = `${API_BASE}/files/browse?${searchParams.toString()}`;
      const response = await authFetch(url);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t('fileBrowser.errors.browseFailed'));
      }

      const result: FileBrowserData = await response.json();
      setData(result);

      try {
        localStorage.setItem(LAST_BROWSE_PATH_KEY, result.currentPath);
      } catch { /* ignore */ }
    } catch (error) {
      console.error('Failed to fetch directory:', error);
      setError(error instanceof Error ? error.message : t('fileBrowser.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const effectivePath = initialPath || (() => {
      try {
        return localStorage.getItem(LAST_BROWSE_PATH_KEY) || undefined;
      } catch { return undefined; }
    })();
    fetchDirectory(effectivePath);
  }, [initialPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSelection = useCallback((item: FileItem) => {
    const isSelectable = (item.isDirectory && allowDirectories) || (!item.isDirectory && allowFiles);
    if (!isSelectable) return;

    setSelectedPaths(prev => {
      const next = new Map(prev);
      if (next.has(item.path)) {
        next.delete(item.path);
      } else {
        next.set(item.path, item.isDirectory);
      }
      return next;
    });
  }, [allowDirectories, allowFiles]);

  const handleItemClick = (item: FileItem) => {
    if (item.isDirectory) {
      fetchDirectory(item.path);
    } else if (multiSelect) {
      toggleSelection(item);
    } else {
      setSelectedPath(item.path);
    }
  };

  const handleItemSelect = (item: FileItem) => {
    if ((item.isDirectory && allowDirectories) || (!item.isDirectory && allowFiles)) {
      if (multiSelect) {
        toggleSelection(item);
      } else {
        onSelect(item.path, item.isDirectory);
      }
    }
  };

  const handleConfirmMultiSelect = useCallback(() => {
    if (selectedPaths.size === 0) return;
    if (onMultiSelect) {
      const items = Array.from(selectedPaths.entries()).map(([path, isDir]) => ({
        path,
        isDirectory: isDir,
      }));
      onMultiSelect(items);
    } else {
      for (const [path, isDir] of selectedPaths.entries()) {
        onSelect(path, isDir);
      }
    }
    onClose();
  }, [selectedPaths, onMultiSelect, onSelect, onClose]);

  const goToParent = () => {
    if (data?.parentPath && (!restrictToProject || data.parentPath.startsWith(initialPath || ''))) {
      fetchDirectory(data.parentPath);
    }
  };

  const goToHome = () => {
    if (!restrictToProject) {
      fetchDirectory();
    } else if (initialPath) {
      fetchDirectory(initialPath);
    }
  };

  const handleCreateNewFolder = async () => {
    if (!newFolderName.trim() || !data?.currentPath) return;

    setCreatingFolder(true);
    try {
      const response = await authFetch(`${API_BASE}/files/create-directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          parentPath: data.currentPath,
          directoryName: newFolderName.trim()
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t('fileBrowser.errors.createFailed'));
      }

      // Refresh current directory to show new folder
      await fetchDirectory(data.currentPath);

      // Reset dialog state
      setShowNewFolderDialog(false);
      setNewFolderName('');
    } catch (error) {
      console.error('Failed to create directory:', error);
      showError(t('fileBrowser.errors.createFailed'), error instanceof Error ? error.message : undefined);
    } finally {
      setCreatingFolder(false);
    }
  };

  const filteredItems = data?.items.filter(item => showHidden || !item.isHidden) || [];

  const selectableItems = filteredItems.filter(
    item => (item.isDirectory && allowDirectories) || (!item.isDirectory && allowFiles)
  );
  const allSelected = multiSelect && selectableItems.length > 0 && selectableItems.every(item => selectedPaths.has(item.path));

  const handleToggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedPaths(prev => {
        const next = new Map(prev);
        for (const item of selectableItems) {
          next.delete(item.path);
        }
        return next;
      });
    } else {
      setSelectedPaths(prev => {
        const next = new Map(prev);
        for (const item of selectableItems) {
          next.set(item.path, item.isDirectory);
        }
        return next;
      });
    }
  }, [allSelected, selectableItems]);

  const formatSize = (size: number | null) => {
    if (size === null) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const isCSVFile = (filename: string) => {
    return filename.toLowerCase().endsWith('.csv');
  };

  const isJSONLFile = (filename: string) => {
    return filename.toLowerCase().endsWith('.jsonl');
  };

  const handlePreviewCSV = (path: string) => {
    setCsvPreviewPath(path);
  };

  const handleCloseCSVPreview = () => {
    setCsvPreviewPath(null);
  };

  const handlePreviewJSONL = (path: string) => {
    setJsonlPreviewPath(path);
  };

  const handleCloseJSONLPreview = () => {
    setJsonlPreviewPath(null);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={`bg-white dark:bg-gray-900 rounded-lg w-full ${isMobile ? 'max-w-sm max-h-[70vh] mx-2' : 'max-w-4xl max-h-[80vh] mx-4'} flex flex-col`}>
        {/* Header */}
        <div className={`flex items-center justify-between ${isMobile ? 'px-3 py-2' : 'p-4'} bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700`}>
          <h3 className={`${isMobile ? 'text-sm' : 'text-lg'} font-semibold text-gray-900 dark:text-white truncate`}>{title || t('fileBrowser.title')}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className={`flex items-center space-x-1 ${isMobile ? 'px-2 py-1.5' : 'p-4 space-x-2'} border-b border-gray-100 dark:border-gray-700`}>
          {!restrictToProject && (
            <button
              onClick={goToHome}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title={t('fileBrowser.toolbar.homeDirectory')}
            >
              <Home className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          )}

          <button
            onClick={goToParent}
            disabled={!data?.parentPath || (restrictToProject && data?.currentPath === initialPath)}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('fileBrowser.toolbar.parentDirectory')}
          >
            <ArrowUp className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>

          <div className={`flex-1 px-2 py-1 bg-gray-50 dark:bg-gray-900 rounded ${isMobile ? 'text-xs' : 'text-sm'} text-gray-600 dark:text-gray-400 font-mono truncate`}>
            {isMobile ? (data?.currentPath?.split('/').pop() || '...') : (data?.currentPath || t('fileBrowser.toolbar.loadingPath'))}
          </div>

          {allowNewDirectory && !isMobile && (
            <button
              onClick={() => setShowNewFolderDialog(true)}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title={t('fileBrowser.toolbar.newDirectory')}
            >
              <FolderPlus className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          )}

          {!isMobile && (
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title={showHidden ? t('fileBrowser.toolbar.hideHidden') : t('fileBrowser.toolbar.showHidden')}
            >
              {showHidden ? <EyeOff className="w-4 h-4 text-gray-600 dark:text-gray-400" /> : <Eye className="w-4 h-4 text-gray-600 dark:text-gray-400" />}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64 text-red-600">
              <p>{t('fileBrowser.errors.error')}: {error}</p>
            </div>
          ) : (
            <div
              className="flex-1 overflow-y-auto"
              onWheel={(e) => {
                e.stopPropagation();
              }}
            >
              {isMobile ? (
                /* Compact list for small screens - filenames only */
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredItems.map((item, index) => {
                    const isSelected = multiSelect && selectedPaths.has(item.path);
                    const isSelectable = (item.isDirectory && allowDirectories) || (!item.isDirectory && allowFiles);
                    return (
                    <button
                      key={index}
                      onClick={() => {
                        if (item.isDirectory) {
                          handleItemClick(item);
                        } else if (multiSelect && allowFiles) {
                          toggleSelection(item);
                        } else if (allowFiles) {
                          handleItemSelect(item);
                        }
                      }}
                      disabled={!item.isDirectory && !allowFiles}
                      className={`w-full flex items-center space-x-2 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 ${
                        isSelected ? 'bg-blue-50 dark:bg-blue-900/30' :
                        selectedPath === item.path ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                      }`}
                    >
                      {multiSelect && isSelectable && !item.isDirectory && (
                        isSelected ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        )
                      )}
                      {item.isDirectory ? (
                        <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      ) : (
                        <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      )}
                      <span className={`text-sm truncate flex-1 ${
                        item.isHidden ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'
                      }`}>
                        {item.name}
                      </span>
                      {item.isDirectory && (
                        <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      )}
                    </button>
                    );
                  })}
                </div>
              ) : (
                /* Full table for desktop */
                <table className="w-full">
                  <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                    <tr>
                      {multiSelect && (
                        <th className="w-10 px-2 py-2">
                          {selectableItems.length > 0 && (
                            <button
                              onClick={handleToggleSelectAll}
                              className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              title={allSelected ? t('fileBrowser.actions.deselectAll') : t('fileBrowser.actions.selectAll')}
                            >
                              {allSelected ? (
                                <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </th>
                      )}
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('fileBrowser.table.name')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('fileBrowser.table.size')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('fileBrowser.table.modified')}</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('fileBrowser.table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredItems.map((item, index) => {
                      const isSelected = multiSelect && selectedPaths.has(item.path);
                      const isSelectable = (item.isDirectory && allowDirectories) || (!item.isDirectory && allowFiles);
                      return (
                      <tr
                        key={index}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                          isSelected ? 'bg-blue-50 dark:bg-blue-900/30' :
                          selectedPath === item.path ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                        }`}
                      >
                        {multiSelect && (
                          <td className="w-10 px-2 py-3 text-center">
                            {isSelectable && (
                              <button
                                onClick={() => toggleSelection(item)}
                                className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 flex items-center space-x-2">
                          <div className="flex items-center space-x-2 flex-1 min-w-0">
                            {item.isDirectory ? (
                              <Folder className="w-4 h-4 text-blue-600 flex-shrink-0" />
                            ) : isCSVFile(item.name) ? (
                              <FileText className="w-4 h-4 text-green-600 flex-shrink-0" />
                            ) : isJSONLFile(item.name) ? (
                              <FileJson className="w-4 h-4 text-amber-500 flex-shrink-0" />
                            ) : (
                              <File className="w-4 h-4 text-gray-600 dark:text-gray-400 flex-shrink-0" />
                            )}
                            <button
                              onClick={() => {
                                if (item.isDirectory) {
                                  handleItemClick(item);
                                } else if (multiSelect) {
                                  toggleSelection(item);
                                } else if (allowFiles) {
                                  handleItemSelect(item);
                                }
                              }}
                              className={`text-left truncate hover:text-blue-600 dark:hover:text-blue-400 ${
                                item.isHidden ? 'text-gray-400' : 'text-gray-900 dark:text-white'
                              } ${
                                !item.isDirectory && allowFiles ? 'cursor-pointer font-medium' : ''
                              }`}
                            >
                              {item.name}
                            </button>
                            {item.isDirectory && (
                              <ChevronRight className="w-3 h-3 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                          {formatSize(item.size)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                          {new Date(item.modified).toLocaleDateString('zh-CN')}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            {!item.isDirectory && isCSVFile(item.name) && (
                              <button
                                onClick={() => handlePreviewCSV(item.path)}
                                className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                                title={t('fileBrowser.actions.previewCSV')}
                              >
                                {t('fileBrowser.actions.preview')}
                              </button>
                            )}
                            {!item.isDirectory && isJSONLFile(item.name) && (
                              <button
                                onClick={() => handlePreviewJSONL(item.path)}
                                className="px-3 py-1 text-sm bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors"
                                title={t('fileBrowser.actions.previewJSONL')}
                              >
                                {t('fileBrowser.actions.preview')}
                              </button>
                            )}
                            {!multiSelect && (
                              <button
                                onClick={() => handleItemSelect(item)}
                                disabled={!isSelectable}
                                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                {t('fileBrowser.actions.select')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {filteredItems.length === 0 && (
                <div className={`text-center ${isMobile ? 'py-8' : 'py-12'} text-gray-500 dark:text-gray-400`}>
                  <Folder className={`${isMobile ? 'w-8 h-8' : 'w-12 h-12'} text-gray-300 dark:text-gray-600 mx-auto mb-3`} />
                  <p>{t('fileBrowser.emptyDirectory')}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`${isMobile ? 'px-3 py-2' : 'p-4'} border-t border-gray-200 dark:border-gray-700 flex justify-between items-center`}>
          <div className={`${isMobile ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
            {multiSelect && selectedPaths.size > 0 ? (
              <span>{t('fileBrowser.footer.selectedCount', { count: selectedPaths.size })}</span>
            ) : filteredItems.length > 0 ? (
              <span>{t('fileBrowser.footer.itemsCount', { count: filteredItems.length })}</span>
            ) : null}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className={`${isMobile ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'} text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors`}
            >
              {t('fileBrowser.actions.cancel')}
            </button>
            {multiSelect && (
              <button
                onClick={handleConfirmMultiSelect}
                disabled={selectedPaths.size === 0}
                className={`${isMobile ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'} bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
              >
                {t('fileBrowser.actions.confirm', { count: selectedPaths.size })}
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* New Folder Dialog */}
      {showNewFolderDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('fileBrowser.dialog.newFolder')}</h3>
              <button
                onClick={() => {
                  setShowNewFolderDialog(false);
                  setNewFolderName('');
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                {t('fileBrowser.dialog.createAt')}
              </p>
              <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded text-sm font-mono text-gray-800 dark:text-gray-200 break-all">
                {data?.currentPath}
              </div>
            </div>

            <div className="mb-6">
              <label htmlFor="folderName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('fileBrowser.dialog.folderName')}
              </label>
              <input
                id="folderName"
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={t('fileBrowser.dialog.folderNamePlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                autoFocus
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && newFolderName.trim() && !creatingFolder) {
                    handleCreateNewFolder();
                  }
                }}
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowNewFolderDialog(false);
                  setNewFolderName('');
                }}
                disabled={creatingFolder}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
              >
                {t('fileBrowser.actions.cancel')}
              </button>
              <button
                onClick={handleCreateNewFolder}
                disabled={!newFolderName.trim() || creatingFolder}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creatingFolder ? t('fileBrowser.actions.creating') : t('fileBrowser.actions.createFolder')}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* CSV Preview */}
      {csvPreviewPath && (
        <CSVPreview
          filePath={csvPreviewPath}
          onClose={handleCloseCSVPreview}
          projectPath={data?.currentPath}
        />
      )}

      {/* JSONL Preview */}
      {jsonlPreviewPath && (
        <JSONLPreview
          filePath={jsonlPreviewPath}
          onClose={handleCloseJSONLPreview}
          projectPath={data?.currentPath}
        />
      )}
    </div>
  );
};