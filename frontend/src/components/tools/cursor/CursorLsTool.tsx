import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent, ToolInput } from '../BaseToolComponent';
import { Folder, File, ChevronDown, ChevronRight } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { LsToolCallArgs, LsToolCallResult, DirectoryNode, FileNode } from './types';
import { extractDirName, getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorLsToolProps {
  execution: BaseToolExecution;
}

/**
 * 目录树节点组件
 */
const DirectoryTreeNode: React.FC<{
  node: DirectoryNode;
  depth: number;
  defaultExpanded?: boolean;
}> = ({ node, depth, defaultExpanded = false }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || depth === 0);
  const dirName = extractDirName(node.absPath);

  const hasChildren = node.childrenDirs.length > 0 || node.childrenFiles.length > 0;

  return (
    <div className="select-none">
      {/* 目录行 */}
      <div
        className={`flex items-center py-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded ${
          hasChildren ? 'cursor-pointer' : ''
        }`}
        style={{ paddingLeft: `${depth * 16}px` }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="w-3 h-3 text-gray-400 mr-1 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-gray-400 mr-1 flex-shrink-0" />
          )
        ) : (
          <span className="w-4 mr-1" />
        )}
        <Folder className="w-4 h-4 text-yellow-500 dark:text-yellow-400 mr-1.5 flex-shrink-0" />
        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{dirName}</span>
        <span className="ml-2 text-xs text-gray-400">({node.numFiles})</span>
      </div>

      {/* 子节点 */}
      {isExpanded && (
        <div>
          {/* 子目录 */}
          {node.childrenDirs.map((childDir, index) => (
            <DirectoryTreeNode
              key={`dir-${index}-${childDir.absPath}`}
              node={childDir}
              depth={depth + 1}
            />
          ))}
          {/* 文件 */}
          {node.childrenFiles.map((file, index) => (
            <FileTreeNode
              key={`file-${index}-${file.name}`}
              file={file}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 文件节点组件
 */
const FileTreeNode: React.FC<{
  file: FileNode;
  depth: number;
}> = ({ file, depth }) => {
  return (
    <div
      className="flex items-center py-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
      style={{ paddingLeft: `${depth * 16 + 16}px` }}
    >
      <File className="w-4 h-4 text-gray-400 mr-1.5 flex-shrink-0" />
      <span className="text-sm text-gray-600 dark:text-gray-400 truncate">{file.name}</span>
    </div>
  );
};

/**
 * Cursor 目录列表工具组件
 */
export const CursorLsTool: React.FC<CursorLsToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const args = getCursorToolArgs(execution, 'lsToolCall') as LsToolCallArgs;
  const result = getCursorToolResult(execution, 'lsToolCall') as LsToolCallResult | undefined;

  // 提取目录名作为副标题
  const getSubtitle = () => {
    if (!args?.path) return undefined;
    const root = result?.success?.directoryTreeRoot;
    if (root) {
      return `${extractDirName(args.path)} (${root.numFiles} files)`;
    }
    return extractDirName(args.path);
  };

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="LS"
    >
      <div className="space-y-3">
        {/* 路径 */}
        <ToolInput label={t('cursorLsTool.path')} value={args?.path} />

        {/* 忽略模式 */}
        {args?.ignore && args.ignore.length > 0 && (
          <ToolInput label={t('cursorLsTool.ignore')} value={args.ignore.join(', ')} />
        )}

        {/* 目录树 */}
        {result?.success?.directoryTreeRoot && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2 max-h-64 overflow-auto bg-gray-50 dark:bg-gray-800">
            <DirectoryTreeNode
              node={result.success.directoryTreeRoot}
              depth={0}
              defaultExpanded
            />
          </div>
        )}

        {/* 扩展名统计 */}
        {result?.success?.directoryTreeRoot?.fullSubtreeExtensionCounts && (
          <div className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-2">
            <span className="font-medium">{t('cursorLsTool.extensionStats')}:</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(result.success.directoryTreeRoot.fullSubtreeExtensionCounts)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10)
                .map(([ext, count]) => (
                  <span
                    key={ext}
                    className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded"
                  >
                    {ext}: {count}
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
