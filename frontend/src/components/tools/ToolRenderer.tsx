import React, { useCallback, useEffect, useRef } from 'react';
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
import { getToolRender, type FrontendToolSubmitResult, type FrontendToolStatus } from '../../services/frontendToolRegistry';
import { useAgentStore } from '../../stores/useAgentStore';

interface ToolRendererProps {
  execution: BaseToolExecution;
  onFrontendToolSubmit?: (toolCallId: string, result: unknown) => Promise<FrontendToolSubmitResult>;
  onFrontendToolCancel?: (toolCallId: string, reason?: string) => void;
}

/**
 * 根据工具名称渲染对应的工具组件
 */
export const ToolRenderer: React.FC<ToolRendererProps> = ({ execution, onFrontendToolSubmit, onFrontendToolCancel }) => {
  const { t } = useTranslation('components');
  const pendingFrontendTools = useAgentStore(state => state.pendingFrontendTools);

  const [submitStatuses, setSubmitStatuses] = React.useState<Record<string, FrontendToolStatus>>({});

  /**
   * Buffered result for custom frontend tools that call onSubmit before the
   * `frontend_tool_call` SSE event has arrived and populated pendingFrontendTools.
   * When the store is later updated, the effect below drains this buffer.
   */
  const bufferedResultRef = useRef<{
    executionId: string;
    toolName: string;
    result: unknown;
    resolve: (r: FrontendToolSubmitResult) => void;
  } | null>(null);

  /**
   * Find the bridge's toolCallId by looking up pendingFrontendTools by toolName.
   * The MCP context doesn't carry the SDK's tool_use ID, so the bridge generates
   * its own `ft_xxx` ID while the SDK stream uses `toolu_xxx`. We correlate them
   * via toolName (FIFO — first matching entry wins).
   */
  const findBridgeToolCallId = useCallback((toolName: string): string | null => {
    for (const [bridgeId, pending] of pendingFrontendTools) {
      if (pending.toolName === toolName) return bridgeId;
    }
    return null;
  }, [pendingFrontendTools]);

  // Drain the buffer whenever pendingFrontendTools is updated
  useEffect(() => {
    if (!bufferedResultRef.current || !onFrontendToolSubmit) return;
    const { toolName, result, resolve } = bufferedResultRef.current;
    const bridgeId = findBridgeToolCallId(toolName);
    if (bridgeId) {
      bufferedResultRef.current = null;
      onFrontendToolSubmit(bridgeId, result).then(resolve);
    }
  }, [pendingFrontendTools, onFrontendToolSubmit, findBridgeToolCallId]);

  /**
   * Submit result for a custom frontend tool.
   * Looks up the bridge's toolCallId by toolName since the MCP bridge and
   * the SDK stream use different ID schemes.
   */
  const handleCustomToolSubmit = useCallback(async (executionId: string, toolName: string, result: unknown): Promise<FrontendToolSubmitResult> => {
    if (!onFrontendToolSubmit) return { success: false, error: 'No submit handler' };

    setSubmitStatuses(prev => ({ ...prev, [executionId]: 'submitted' }));

    const bridgeId = findBridgeToolCallId(toolName);
    if (bridgeId) {
      try {
        return await onFrontendToolSubmit(bridgeId, result);
      } catch {
        setSubmitStatuses(prev => ({ ...prev, [executionId]: 'error' }));
        return { success: false, error: 'Submit failed' };
      }
    }

    // Bridge event hasn't arrived yet — buffer and wait
    return new Promise<FrontendToolSubmitResult>((resolve) => {
      bufferedResultRef.current = { executionId, toolName, result, resolve };
    });
  }, [onFrontendToolSubmit, findBridgeToolCallId]);

  const handleCustomToolCancel = useCallback((executionId: string, toolName: string, reason?: string) => {
    const bridgeId = findBridgeToolCallId(toolName);
    if (bridgeId) {
      onFrontendToolCancel?.(bridgeId, reason);
    }
  }, [onFrontendToolCancel, findBridgeToolCallId]);

  const getStatus = (toolCallId: string): FrontendToolStatus => submitStatuses[toolCallId] || 'pending';

  // 首先检查是否是MCP工具
  const mcpToolInfo = parseMcpToolName(execution.toolName);
  if (mcpToolInfo) {
    if (mcpToolInfo.serverName === 'ask-user-question' && mcpToolInfo.toolName === 'ask_user_question') {
      return <AskUserQuestionTool execution={execution} onSubmit={onFrontendToolSubmit as any} />;
    }

    // Check dynamic frontend tool registry (tools registered via useFrontendTool)
    const customRender = getToolRender(mcpToolInfo.toolName);
    if (customRender) {
      return (
        <>
          {customRender({
            args: (execution.toolInput as Record<string, unknown>) || {},
            toolCallId: execution.id,
            status: getStatus(execution.id),
            onSubmit: (result) => handleCustomToolSubmit(execution.id, mcpToolInfo.toolName, result),
            onCancel: (reason) => handleCustomToolCancel(execution.id, mcpToolInfo.toolName, reason),
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