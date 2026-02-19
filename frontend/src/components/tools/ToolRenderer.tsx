import React, { useCallback } from 'react';
import type { BaseToolExecution } from './sdk-types';
import { useTranslation } from 'react-i18next';

// 导入所有工具组件
import { TaskTool } from './TaskTool';
import { BashTool } from './BashTool';
import { BashOutputTool } from './BashOutputTool';
import { KillBashTool } from './KillBashTool';
import { GlobTool } from './GlobTool';
import { GrepTool } from './GrepTool';
import { LSTool } from './LSTool';
import { ExitPlanModeTool } from './ExitPlanModeTool';
import { ReadTool } from './ReadTool';
import { EditTool } from './EditTool';
import { MultiEditTool } from './MultiEditTool';
import { WriteTool } from './WriteTool';
import { NotebookReadTool } from './NotebookReadTool';
import { NotebookEditTool } from './NotebookEditTool';
import { ListMcpResourcesTool } from './ListMcpResourcesTool';
import { ReadMcpResourceTool } from './ReadMcpResourceTool';
import { TimeMachineTool } from './TimeMachineTool';
import { AskUserQuestionTool } from './AskUserQuestionTool';
import { WebFetchTool } from './WebFetchTool';
import { TodoWriteTool } from './TodoWriteTool';
import { WebSearchTool } from './WebSearchTool';
import { McpTool } from './McpTool';
import { A2ACallTool } from './A2ACallTool';
import { SkillTool } from './SkillTool';
import { AgentOutputTool } from './AgentOutputTool';
import { parseMcpToolName } from './mcpUtils';
import { BaseToolComponent } from './BaseToolComponent';
import { CUSTOM_MCP_TOOLS } from './customMcpTools';
import { CursorToolRenderer, isCursorTool } from './cursor';
import { getToolRender } from '../../services/frontendToolRegistry';
import { useAgentStore } from '../../stores/useAgentStore';

interface ToolRendererProps {
  execution: BaseToolExecution;
  onFrontendToolSubmit?: (toolCallId: string, result: unknown) => void;
}

/**
 * 根据工具名称渲染对应的工具组件
 */
export const ToolRenderer: React.FC<ToolRendererProps> = ({ execution, onFrontendToolSubmit }) => {
  const { t } = useTranslation('components');
  const pendingFrontendTools = useAgentStore(state => state.pendingFrontendTools);

  // Build a stable onSubmit for custom frontend tools that mirrors AskUserQuestionTool
  const handleCustomToolSubmit = useCallback((toolName: string, result: unknown) => {
    if (!onFrontendToolSubmit) return;
    // Find the pending tool call by tool name
    for (const pending of pendingFrontendTools.values()) {
      if (pending.toolName === toolName) {
        onFrontendToolSubmit(pending.toolCallId, result);
        return;
      }
    }
    // Fallback: use claudeId if available
    const claudeId = (execution as any).claudeId as string | undefined;
    if (claudeId && onFrontendToolSubmit) {
      onFrontendToolSubmit(claudeId, result);
    }
  }, [onFrontendToolSubmit, pendingFrontendTools, execution]);

  // 首先检查是否是MCP工具
  const mcpToolInfo = parseMcpToolName(execution.toolName);
  if (mcpToolInfo) {
    if (mcpToolInfo.serverName === 'ask-user-question' && mcpToolInfo.toolName === 'ask_user_question') {
      return <AskUserQuestionTool execution={execution} onSubmit={onFrontendToolSubmit} />;
    }

    // Check dynamic frontend tool registry (tools registered via useFrontendTool)
    // Server name for dynamic tools is either 'frontend-tool-{name}' (default) or custom mcpServerName
    const customRender = getToolRender(mcpToolInfo.toolName);
    if (customRender) {
      return (
        <>
          {customRender({
            args: (execution.toolInput as Record<string, unknown>) || {},
            onSubmit: (result) => handleCustomToolSubmit(mcpToolInfo.toolName, result),
          })}
        </>
      );
    }
    
    // 检查是否有自定义组件
    const customToolKey = `${mcpToolInfo.serverName}__${mcpToolInfo.toolName}`;
    const CustomComponent = CUSTOM_MCP_TOOLS[customToolKey];

    if (CustomComponent) {
      return <CustomComponent execution={execution} />;
    }

    return <McpTool execution={execution} />;
  }

  // 检查是否为 Cursor 工具
  if (isCursorTool(execution.toolName)) {
    return <CursorToolRenderer execution={execution} />;
  }

  switch (execution.toolName) {
    case 'Task':
      return <TaskTool execution={execution} />;

    case 'Bash':
      return <BashTool execution={execution} />;

    case 'BashOutput':
      return <BashOutputTool execution={execution} />;

    case 'KillBash':
      return <KillBashTool execution={execution} />;

    case 'Glob':
      return <GlobTool execution={execution} />;

    case 'Grep':
      return <GrepTool execution={execution} />;

    case 'LS':
      return <LSTool execution={execution} />;

    case 'exit_plan_mode':
      return <ExitPlanModeTool execution={execution} />;

    case 'Read':
      return <ReadTool execution={execution} />;

    case 'Edit':
      return <EditTool execution={execution} />;

    case 'MultiEdit':
      return <MultiEditTool execution={execution} />;

    case 'Write':
      return <WriteTool execution={execution} />;

    case 'NotebookRead':
      return <NotebookReadTool execution={execution} />;

    case 'NotebookEdit':
      return <NotebookEditTool execution={execution} />;

    case 'ListMcpResources':
      return <ListMcpResourcesTool execution={execution} />;

    case 'ReadMcpResource':
      return <ReadMcpResourceTool execution={execution} />;

    case 'TimeMachine':
      return <TimeMachineTool execution={execution} />;

    case 'AskUserQuestion':
      return <AskUserQuestionTool execution={execution} onSubmit={onFrontendToolSubmit} />;

    case 'WebFetch':
      return <WebFetchTool execution={execution} />;

    case 'TodoWrite':
      return <TodoWriteTool execution={execution} />;

    case 'WebSearch':
      return <WebSearchTool execution={execution} />;

    case 'call_external_agent':
      return <A2ACallTool execution={execution} />;

    case 'Skill':
      return <SkillTool execution={execution} />;

    case 'AgentOutput':
      return <AgentOutputTool execution={execution} />;

    default:
      // 对于未知工具，使用基础组件显示
      return (
        <BaseToolComponent execution={execution}>
          <div>
            <p className="text-sm text-gray-600 mb-2">{t('toolRenderer.unknownToolType')}</p>
            <div className="text-xs text-gray-500 bg-gray-100 p-2 rounded font-mono">
              {JSON.stringify(execution.toolInput, null, 2)}
            </div>
          </div>
        </BaseToolComponent>
      );
  }
};