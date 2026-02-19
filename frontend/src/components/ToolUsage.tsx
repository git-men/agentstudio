import React, { useMemo } from 'react';
import { ToolRenderer, type ToolExecution } from './tools';

interface ToolUsageProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult?: string;
  toolUseResult?: Record<string, unknown>;
  isError?: boolean;
  isExecuting?: boolean;
  claudeId?: string;
  onFrontendToolSubmit?: (toolCallId: string, result: unknown) => Promise<{ success: boolean; error?: string }>;
  onFrontendToolCancel?: (toolCallId: string, reason?: string) => void;
}

export const ToolUsage: React.FC<ToolUsageProps> = (props) => {
  const execution = useMemo((): ToolExecution & { claudeId?: string } => ({
    id: props.claudeId || `tool_${props.toolName}`,
    toolName: props.toolName,
    toolInput: props.toolInput,
    toolResult: props.toolResult,
    toolUseResult: props.toolUseResult,
    isExecuting: props.isExecuting || false,
    isError: props.isError || false,
    timestamp: new Date(),
    claudeId: props.claudeId,
  }), [props.toolName, props.toolInput, props.toolResult, props.toolUseResult,
       props.isExecuting, props.isError, props.claudeId]);

  return <ToolRenderer execution={execution} onFrontendToolSubmit={props.onFrontendToolSubmit} onFrontendToolCancel={props.onFrontendToolCancel} />;
};