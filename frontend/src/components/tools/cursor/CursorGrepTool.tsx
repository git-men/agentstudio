import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent, ToolInput } from '../BaseToolComponent';
import { File, ChevronDown, ChevronRight } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { GrepToolCallArgs, GrepToolCallResult, FileMatch, LineMatch } from './types';
import { getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorGrepToolProps {
  execution: BaseToolExecution;
}

/**
 * 匹配行组件
 */
const MatchLine: React.FC<{ match: LineMatch; pattern: string }> = ({ match, pattern }) => {
  // 高亮匹配的模式
  const highlightPattern = (content: string, pattern: string) => {
    try {
      const regex = new RegExp(`(${pattern})`, 'gi');
      const parts = content.split(regex);
      return parts.map((part, index) =>
        regex.test(part) ? (
          <mark key={index} className="bg-yellow-200 dark:bg-yellow-900 text-yellow-900 dark:text-yellow-200">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      );
    } catch {
      return content;
    }
  };

  return (
    <div
      className={`flex py-0.5 ${
        match.isContextLine
          ? 'text-gray-400 dark:text-gray-500'
          : 'text-gray-700 dark:text-gray-300'
      }`}
    >
      <span className="w-12 text-right pr-2 text-gray-400 dark:text-gray-500 flex-shrink-0 font-mono text-xs">
        {match.lineNumber}
      </span>
      <span className="font-mono text-xs whitespace-pre-wrap break-all">
        {match.isContextLine ? match.content : highlightPattern(match.content, pattern)}
        {match.contentTruncated && (
          <span className="text-gray-400 dark:text-gray-500">...</span>
        )}
      </span>
    </div>
  );
};

/**
 * 文件匹配组件
 */
const FileMatchSection: React.FC<{ fileMatch: FileMatch; pattern: string }> = ({
  fileMatch,
  pattern,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
      {/* 文件头 */}
      <div
        className="flex items-center py-1.5 px-2 bg-gray-100 dark:bg-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-gray-400 mr-1" />
        ) : (
          <ChevronRight className="w-3 h-3 text-gray-400 mr-1" />
        )}
        <File className="w-4 h-4 text-gray-400 mr-1.5" />
        <span className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate">
          {fileMatch.file}
        </span>
        <span className="ml-2 text-xs text-gray-400">({fileMatch.matches.length})</span>
      </div>

      {/* 匹配内容 */}
      {isExpanded && (
        <div className="bg-gray-50 dark:bg-gray-800 px-2 py-1">
          {fileMatch.matches.map((match, index) => (
            <MatchLine key={index} match={match} pattern={pattern} />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Cursor Grep 内容搜索工具组件
 */
export const CursorGrepTool: React.FC<CursorGrepToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const args = getCursorToolArgs(execution, 'grepToolCall') as GrepToolCallArgs;
  const result = getCursorToolResult(execution, 'grepToolCall') as GrepToolCallResult | undefined;

  // 获取所有匹配
  const getAllMatches = (): FileMatch[] => {
    if (!result?.success?.workspaceResults) return [];
    const matches: FileMatch[] = [];
    Object.values(result.success.workspaceResults).forEach((workspace) => {
      if (workspace.content?.matches) {
        matches.push(...workspace.content.matches);
      }
    });
    return matches;
  };

  // 获取文件列表（files_with_matches 模式）
  const getFilesList = (): string[] => {
    if (!result?.success?.workspaceResults) return [];
    const files: string[] = [];
    Object.values(result.success.workspaceResults).forEach((workspace) => {
      if (workspace.files?.files) {
        files.push(...workspace.files.files);
      }
    });
    return files;
  };

  const matches = getAllMatches();
  const files = getFilesList();
  const totalMatches = matches.reduce((sum, fm) => sum + fm.matches.length, 0);

  // 显示模式和匹配数作为副标题
  const getSubtitle = () => {
    const pattern = args?.pattern || '';
    if (result?.success?.outputMode === 'files_with_matches') {
      return `"${pattern}" (${files.length} files)`;
    }
    return `"${pattern}" (${totalMatches} matches)`;
  };

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="Grep"
    >
      <div className="space-y-3">
        {/* 搜索模式 */}
        <ToolInput label={t('cursorGrepTool.pattern')} value={args?.pattern} isCode />

        {/* 搜索路径 */}
        <ToolInput label={t('cursorGrepTool.path')} value={args?.path} />

        {/* 搜索选项 */}
        <div className="flex flex-wrap gap-2 text-xs">
          {args?.glob && (
            <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
              glob: {args.glob}
            </span>
          )}
          {args?.caseInsensitive && (
            <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
              {t('cursorGrepTool.caseInsensitive')}
            </span>
          )}
          {args?.multiline && (
            <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded">
              {t('cursorGrepTool.multiline')}
            </span>
          )}
        </div>

        {/* 搜索结果 */}
        {result?.success && (
          <>
            {/* Content 模式 - 显示匹配内容 */}
            {result.success.outputMode === 'content' && matches.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-96 overflow-auto">
                {matches.map((fileMatch, index) => (
                  <FileMatchSection
                    key={index}
                    fileMatch={fileMatch}
                    pattern={args?.pattern || ''}
                  />
                ))}
              </div>
            )}

            {/* files_with_matches 模式 - 只显示文件列表 */}
            {result.success.outputMode === 'files_with_matches' && files.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-48 overflow-auto bg-gray-50 dark:bg-gray-800">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center py-1 px-2 hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                  >
                    <File className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
                    <span className="text-sm text-gray-600 dark:text-gray-400 truncate font-mono">
                      {file}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 无结果提示 */}
            {matches.length === 0 && files.length === 0 && (
              <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                {t('cursorGrepTool.noMatchesFound')}
              </div>
            )}
          </>
        )}
      </div>
    </BaseToolComponent>
  );
};
