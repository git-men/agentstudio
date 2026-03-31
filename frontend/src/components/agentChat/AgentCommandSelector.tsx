/* eslint-disable react-refresh/only-export-components */
import React, { useCallback } from 'react';
import { CommandSelector } from '../CommandSelector';
import { FileBrowser } from '../FileBrowser';
import { useTranslation } from 'react-i18next';
import type { CommandType } from '../../utils/commandFormatter';

export interface AgentCommandSelectorProps {
  showCommandSelector: boolean;
  showFileBrowser: boolean;
  commandSearch: string;
  selectedCommand: CommandType | null;
  selectedCommandIndex: number;
  atSymbolPosition: number | null;
  projectPath?: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputMessage: string;
  onCommandSelect: (command: CommandType) => void;
  onSetInputMessage: (value: string) => void;
  onSetShowCommandSelector: (show: boolean) => void;
  onSetSelectedCommandIndex: (index: number) => void;
  onSetShowFileBrowser: (show: boolean) => void;
  onSetAtSymbolPosition: (position: number | null) => void;
  onFileReferencesAdd: (items: { path: string; isDirectory: boolean }[]) => void;
}

// 为键盘处理器单独定义接口，包含所有需要的参数
export interface AgentCommandSelectorKeyHandlerProps {
  showCommandSelector: boolean;
  showFileBrowser: boolean;
  commandSearch: string;
  selectedCommand: CommandType | null;
  selectedCommandIndex: number;
  atSymbolPosition: number | null;
  projectPath?: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputMessage: string;
  allCommands: CommandType[];
  onCommandSelect: (command: CommandType) => void;
  onSetInputMessage: (value: string) => void;
  onSetShowCommandSelector: (show: boolean) => void;
  onSetSelectedCommandIndex: (index: number) => void;
  onSetShowFileBrowser: (show: boolean) => void;
  onSetAtSymbolPosition: (position: number | null) => void;
  onHandleKeyDown: (e: React.KeyboardEvent) => void;
}

export const AgentCommandSelector: React.FC<AgentCommandSelectorProps> = ({
  showCommandSelector,
  showFileBrowser,
  commandSearch,
  selectedCommandIndex,
  atSymbolPosition,
  projectPath,
  textareaRef,
  inputMessage,
  onCommandSelect,
  onSetInputMessage,
  onSetShowCommandSelector,
  onSetSelectedCommandIndex,
  onSetShowFileBrowser,
  onSetAtSymbolPosition,
  onFileReferencesAdd
}) => {
  const { t } = useTranslation('components');

  const handleCommandSelect = (command: CommandType) => {
    // 命令选择器只是帮助填入命令名称，不立即执行
    onCommandSelect(command);
    // 只填入命令名称（带斜杠），不填入完整的 content
    onSetInputMessage(`/${command.name}`);
    onSetShowCommandSelector(false);

    // 让用户手动点击发送来执行命令
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleCommandSelectorClose = () => {
    onSetShowCommandSelector(false);
  };

  const closeFileBrowserAndCleanup = useCallback(() => {
    if (atSymbolPosition !== null) {
      const beforeAt = inputMessage.substring(0, atSymbolPosition);
      const afterAt = inputMessage.substring(atSymbolPosition + 1);
      onSetInputMessage((beforeAt + afterAt).trim());
    }
    onSetShowFileBrowser(false);
    onSetAtSymbolPosition(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [atSymbolPosition, inputMessage, onSetInputMessage, onSetShowFileBrowser, onSetAtSymbolPosition, textareaRef]);

  const handleFileSelect = useCallback((filePath: string, isDirectory: boolean) => {
    onFileReferencesAdd([{ path: filePath, isDirectory }]);
    closeFileBrowserAndCleanup();
  }, [onFileReferencesAdd, closeFileBrowserAndCleanup]);

  const handleMultiFileSelect = useCallback((items: { path: string; isDirectory: boolean }[]) => {
    onFileReferencesAdd(items);
    closeFileBrowserAndCleanup();
  }, [onFileReferencesAdd, closeFileBrowserAndCleanup]);

  const handleFileBrowserClose = () => {
    onSetShowFileBrowser(false);
    onSetAtSymbolPosition(null);
    // Re-focus the textarea when file browser is closed
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const getInputPosition = () => {
    if (!textareaRef.current) return { top: 0, left: 0 };
    
    const rect = textareaRef.current.getBoundingClientRect();
    return {
      top: rect.top, // CommandSelector will calculate the actual position
      left: rect.left
    };
  };

  return (
    <>
      <CommandSelector
        isOpen={showCommandSelector}
        onSelect={handleCommandSelect}
        onClose={handleCommandSelectorClose}
        searchTerm={commandSearch}
        position={getInputPosition()}
        projectId={projectPath} // Pass projectPath as projectId, will be detected as path
        selectedIndex={selectedCommandIndex}
        onSelectedIndexChange={onSetSelectedCommandIndex}
      />
      
      {/* File Browser for @ symbol */}
      {showFileBrowser && (
        <FileBrowser
          title={t('agentChat.fileBrowser.title', { projectPath: projectPath ? projectPath.split('/').pop() : t('agentChat.fileBrowser.currentProject') })}
          initialPath={projectPath}
          allowFiles={true}
          allowDirectories={true}
          restrictToProject={false}
          multiSelect={true}
          onSelect={handleFileSelect}
          onMultiSelect={handleMultiFileSelect}
          onClose={handleFileBrowserClose}
        />
      )}
      
    </>
  );
};

// 导出键盘处理函数供父组件使用
export const createAgentCommandSelectorKeyHandler = (props: AgentCommandSelectorKeyHandlerProps) => {
  return (e: React.KeyboardEvent) => {
    // Handle Escape key for file browser
    if (e.key === 'Escape' && props.showFileBrowser) {
      e.preventDefault();
      props.onSetShowFileBrowser(false);
      props.onSetAtSymbolPosition(null);
      return;
    }
    
    // Handle Enter key for command selector
    if (e.key === 'Enter' && !e.shiftKey && props.showCommandSelector && props.allCommands.length > 0) {
      e.preventDefault();
      const selectedCmd = props.allCommands[props.selectedCommandIndex];
      if (selectedCmd) {
        // 调用父组件的 onCommandSelect 来更新状态
        props.onCommandSelect(selectedCmd);
        // 同时更新输入框内容（与点击时的行为保持一致）
        props.onSetInputMessage(`/${selectedCmd.name}`);
        // 关闭命令选择器
        props.onSetShowCommandSelector(false);
        // 重新聚焦到输入框
        setTimeout(() => {
          props.textareaRef.current?.focus();
        }, 0);
      }
      return;
    }

    // Handle command selector navigation
    if (props.showCommandSelector && props.allCommands.length > 0) {
      if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
        e.preventDefault();
        props.onSetSelectedCommandIndex(
          props.selectedCommandIndex > 0 ? props.selectedCommandIndex - 1 : props.allCommands.length - 1
        );
        return;
      }
      
      if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
        e.preventDefault();
        props.onSetSelectedCommandIndex(
          props.selectedCommandIndex < props.allCommands.length - 1 ? props.selectedCommandIndex + 1 : 0
        );
        return;
      }
      
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onSetShowCommandSelector(false);
        return;
      }
    }

    // 传递其他键盘事件给父组件
    props.onHandleKeyDown(e);
  };
};