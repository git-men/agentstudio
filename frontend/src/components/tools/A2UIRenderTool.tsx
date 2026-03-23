/**
 * A2UI Render Tool Component
 * 
 * Custom tool component for the `render_ui` MCP tool.
 * Detects A2UI payloads in tool results and renders them
 * as interactive A2UI surfaces.
 */

import React, { useMemo } from 'react';
import type { BaseToolExecution } from './sdk-types';
import { BaseToolComponent } from './BaseToolComponent';
import { A2UIRenderer } from '../a2ui';
import { Layers } from 'lucide-react';

interface A2UIRenderToolProps {
  execution: BaseToolExecution;
}

/**
 * Parse A2UI payload from tool result
 */
function parseA2UIResult(result: string | undefined): {
  isA2UI: boolean;
  messages: any[];
  description?: string;
} {
  if (!result) return { isA2UI: false, messages: [] };

  try {
    const parsed = JSON.parse(result);
    if (parsed.__a2ui__ && Array.isArray(parsed.messages)) {
      return {
        isA2UI: true,
        messages: parsed.messages,
        description: parsed.description,
      };
    }
  } catch {
    // Not JSON or not A2UI
  }

  return { isA2UI: false, messages: [] };
}

export const A2UIRenderTool: React.FC<A2UIRenderToolProps> = ({ execution }) => {
  const a2uiPayload = useMemo(
    () => parseA2UIResult(execution.toolResult),
    [execution.toolResult]
  );

  // While executing, show a loading state
  if (execution.isExecuting) {
    return (
      <BaseToolComponent
        execution={execution}
        hideToolName={false}
        icon={<Layers className="w-4 h-4" />}
      >
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="animate-pulse flex gap-1">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" />
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0.1s' }} />
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0.2s' }} />
          </div>
          Generating UI...
        </div>
      </BaseToolComponent>
    );
  }

  // If we have A2UI data, render the surface
  if (a2uiPayload.isA2UI && a2uiPayload.messages.length > 0) {
    return (
      <div className="a2ui-render-tool">
        {a2uiPayload.description && (
          <div className="flex items-center gap-1.5 mb-2 text-xs text-gray-400">
            <Layers className="w-3 h-3" />
            <span>{a2uiPayload.description}</span>
          </div>
        )}
        <A2UIRenderer
          messages={a2uiPayload.messages}
          className="rounded-lg"
        />
      </div>
    );
  }

  // Fallback: render as regular tool output
  if (execution.isError) {
    return (
      <BaseToolComponent
        execution={execution}
        hideToolName={false}
        icon={<Layers className="w-4 h-4" />}
      >
        <div className="text-sm text-red-500">
          {execution.toolResult || 'Failed to render UI'}
        </div>
      </BaseToolComponent>
    );
  }

  // Regular tool result (shouldn't happen normally)
  return (
    <BaseToolComponent
      execution={execution}
      hideToolName={false}
      icon={<Layers className="w-4 h-4" />}
    >
      <div className="text-sm text-gray-500">
        {execution.toolResult || 'UI rendered'}
      </div>
    </BaseToolComponent>
  );
};
