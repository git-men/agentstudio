/**
 * useFrontendTool
 *
 * Register a custom frontend tool that can be called by the AI agent.
 * The tool schema is sent to the backend with each chat request so the
 * agent can use it as an MCP tool.
 *
 * Two modes:
 *
 * 1. **Interactive** — provide a `render` function that shows UI and calls `onSubmit`:
 * ```tsx
 * useFrontendTool({
 *   name: 'pick_color',
 *   description: 'Let the user choose a color',
 *   parameters: { type: 'object', properties: { colors: { type: 'array' } }, required: ['colors'] },
 *   render: ({ args, onSubmit }) => (
 *     <ColorPicker colors={args.colors as string[]} onSelect={onSubmit} />
 *   ),
 * });
 * ```
 *
 * 2. **Silent** — provide a `handler` function that runs automatically and returns a result:
 * ```tsx
 * useFrontendTool({
 *   name: 'collect_logs',
 *   description: 'Collect browser console logs',
 *   parameters: { type: 'object', properties: { limit: { type: 'integer' } } },
 *   handler: async (args) => {
 *     const logs = getRecentLogs(args.limit as number);
 *     return { logs };
 *   },
 * });
 * ```
 */

import React, { useEffect, useRef } from 'react';
import {
  registerTool,
  unregisterTool,
  type FrontendToolSchema,
  type FrontendToolRenderFn,
  type FrontendToolRenderProps,
} from '../services/frontendToolRegistry.js';

export type FrontendToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

export interface UseFrontendToolOptions extends FrontendToolSchema {
  /** Render function for interactive tools. Mutually exclusive with `handler`. */
  render?: FrontendToolRenderFn;
  /** Handler function for silent (no-UI) tools. Runs automatically and submits the return value. */
  handler?: FrontendToolHandler;
}

/**
 * Internal component that executes a handler function and submits the result.
 * Renders nothing visible; used as the implicit render function for handler-mode tools.
 */
const SilentHandler: React.FC<{
  handler: FrontendToolHandler;
  renderProps: FrontendToolRenderProps;
}> = ({ handler, renderProps }) => {
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    Promise.resolve(handler(renderProps.args))
      .then((result) => renderProps.onSubmit(result))
      .catch((err) => renderProps.onSubmit({ error: err instanceof Error ? err.message : String(err) }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
};

/**
 * Register a custom frontend tool for the current component's lifetime.
 * The tool is unregistered when the component unmounts.
 */
export function useFrontendTool(options: UseFrontendToolOptions): void {
  const { render, handler, ...schema } = options;

  if (!render && !handler) {
    throw new Error(`useFrontendTool("${schema.name}"): either render or handler must be provided`);
  }

  const effectiveRender: FrontendToolRenderFn = render || ((props: FrontendToolRenderProps) =>
    React.createElement(SilentHandler, { handler: handler!, renderProps: props })
  );

  const toolName = schema.name;

  useEffect(() => {
    registerTool({ schema, render: effectiveRender });

    return () => {
      unregisterTool(toolName);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolName]);
}
